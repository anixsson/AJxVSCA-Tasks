const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createExtension(saved = {}) {
  class Uri {
    constructor(value) {
      this.value = value;
      this.path = new URL(value).pathname;
      this.fsPath = decodeURIComponent(this.path);
    }
    toString() { return this.value; }
    static parse(value) { return new Uri(value); }
    static joinPath(base, ...parts) {
      return new Uri(new URL(path.posix.join(base.path, ...parts), base.value).toString());
    }
  }
  class EventEmitter {
    constructor() {
      this.listeners = new Set();
      this.event = listener => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };
    }
    fire(value) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners.clear(); }
  }
  class ShellExecution {
    constructor(command, args, options) {
      if (Array.isArray(args)) Object.assign(this, { command, args, options });
      else Object.assign(this, { commandLine: command, options: args });
    }
  }
  class Task {
    constructor(definition, scope, name, source, execution, problemMatchers) {
      Object.assign(this, { definition, scope, name, source, execution, problemMatchers });
    }
  }
  const files = new Map();
  const commands = new Map();
  const views = new Map();
  const watchers = [];
  const errors = [];
  const contexts = new Map();
  const state = new Map(Object.entries(saved));
  const opened = [];
  const executed = [];
  const focusedViews = [];
  const dialogs = [];
  const ended = new EventEmitter();
  const processEnded = new EventEmitter();
  let selection;
  const folder = { uri: Uri.parse('file:///workspace'), name: 'Workspace' };
  const workspaceTask = new Task({}, folder, 'Local', 'Workspace', new ShellExecution('echo local'));
  const vscode = {
    Uri, EventEmitter, ShellExecution, Task,
    TaskScope: { Global: 1 },
    ShellQuoting: { Escape: 1, Strong: 2, Weak: 3 },
    TaskGroup: { Build: { id: 'build' }, Test: { id: 'test' } },
    TreeItem: class {
      constructor(label, collapsibleState) { Object.assign(this, { label, collapsibleState }); }
    },
    TreeItemCollapsibleState: { None: 0, Expanded: 2 },
    ThemeIcon: class { constructor(id, color) { Object.assign(this, { id, color }); } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    RelativePattern: class {
      constructor(base, pattern) { Object.assign(this, { base, pattern }); }
    },
    workspace: {
      workspaceFolders: [folder],
      fs: {
        readFile: async uri => {
          if (!files.has(uri.toString())) throw new Error('File not found');
          return Buffer.from(files.get(uri.toString()));
        }
      },
      createFileSystemWatcher: pattern => {
        const change = new EventEmitter();
        const create = new EventEmitter();
        const remove = new EventEmitter();
        const watcher = {
          pattern,
          onDidChange: change.event,
          onDidCreate: create.event,
          onDidDelete: remove.event,
          fire: (kind = 'change') => ({ change, create, remove })[kind].fire(),
          dispose: () => {
            watcher.disposed = true;
            change.dispose();
            create.dispose();
            remove.dispose();
          }
        };
        watchers.push(watcher);
        return watcher;
      }
    },
    tasks: {
      fetchTasks: async () => [workspaceTask, { name: 'User', source: 'Workspace', scope: 1 }],
      executeTask: async task => {
        executed.push(task.name);
        const execution = { task };
        setImmediate(() => {
          processEnded.fire({ execution, exitCode: task.name === 'Fail' ? 1 : 0 });
          ended.fire({ execution });
        });
        return execution;
      },
      onDidEndTask: ended.event,
      onDidEndTaskProcess: processEnded.event
    },
    window: {
      createTreeView: (id, options) => {
        const view = { ...options, dispose() {} };
        views.set(id, view);
        return view;
      },
      showOpenDialog: async options => {
        dialogs.push(options);
        return selection;
      },
      showErrorMessage: message => errors.push(message),
      showTextDocument: async uri => opened.push(uri.toString()),
      showWarningMessage: async () => 'Yes'
    },
    commands: {
      registerCommand: (name, handler) => {
        commands.set(name, handler);
        return { dispose: () => commands.delete(name) };
      },
      executeCommand: async (name, key, value) => {
        if (commands.has(name)) return commands.get(name)(key);
        if (name === 'taskAccordion.tasks.focus') {
          focusedViews.push(name);
          views.get('taskAccordion.tasks').visible = true;
          return;
        }
        assert.equal(name, 'setContext');
        contexts.set(key, value);
      }
    }
  };
  const context = {
    subscriptions: [],
    workspaceState: {
      get: (key, fallback) => state.has(key) ? state.get(key) : fallback,
      update: async (key, value) => {
        if (value === undefined) state.delete(key);
        else state.set(key, value);
      }
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8'), {
    require: name => name === 'vscode' ? vscode : require(path.join(__dirname, '..', name)),
    module, Buffer
  });
  module.exports.activate(context);
  return {
    files, commands, watchers, errors, contexts, state, opened, executed, context, focusedViews, dialogs,
    provider: views.get('taskAccordion.tasks').treeDataProvider,
    libraries: views.get('taskAccordion.libraries').treeDataProvider,
    view: views.get('taskAccordion.tasks'),
    select: value => { selection = value; },
    uri: Uri.parse('file:///shared/tasks.json'),
    parseUri: Uri.parse
  };
}

function shared(tasks) {
  return JSON.stringify({ version: '2.0.0', tasks });
}

test('picker switches sources, remembers the file, opens it, watches changes, and returns to workspace', async () => {
  const ext = createExtension();
  assert.deepEqual(Array.from(await ext.provider.getChildren(), item => item.label), ['Local']);
  ext.files.set(ext.uri.toString(), shared([
    { label: 'Build: 10', type: 'shell', command: 'echo ten' },
    { label: 'Build: 2', type: 'shell', command: 'echo two' }
  ]));
  ext.select([ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  assert.equal(ext.state.get('sharedTasksUri'), ext.uri.toString());
  assert.equal(ext.contexts.get('taskAccordion.sharedLibrary'), true);
  const [group] = await ext.provider.getChildren();
  const [workspace, source] = ext.libraries.getChildren();
  assert.equal(workspace.label, 'Workspace tasks');
  assert.equal(workspace.description, undefined);
  assert.equal(ext.view.description, 'tasks.json');
  assert.equal(source.contextValue, 'sharedSource');
  assert.equal(source.label, 'tasks.json');
  assert.equal(source.description, 'shared');
  assert.equal(source.iconPath.color.id, 'taskAccordion.sharedForeground');
  assert.match(source.tooltip, /\/shared\/tasks.json/);
  assert.equal(source.command.command, 'taskAccordion.selectSharedFile');
  assert.equal((await ext.provider.getChildren(source)).length, 0);
  assert.equal(group.label, 'Build');
  assert.deepEqual(Array.from(group.children, child => child.label), ['2', '10']);
  ext.provider.setSortBy('file');
  assert.deepEqual(Array.from((await ext.provider.getChildren())[0].children, child => child.label), ['10', '2']);
  await ext.commands.get('taskAccordion.openFile')();
  assert.deepEqual(ext.opened, [ext.uri.toString()]);
  let refreshes = 0;
  ext.provider.onDidChangeTreeData(() => refreshes++);
  const watcher = ext.watchers[1];
  assert.equal(watcher.pattern.base.fsPath, '/shared');
  assert.equal(watcher.pattern.pattern, 'tasks.json');
  ext.files.set(ext.uri.toString(), shared([{ label: 'Changed', type: 'shell', command: 'echo changed' }]));
  watcher.fire();
  assert.equal(refreshes, 1);
  assert.equal((await ext.provider.getChildren())[0].label, 'Changed');
  await ext.commands.get('taskAccordion.useWorkspace')();
  assert.equal(ext.state.has('sharedTasksUri'), false);
  assert.equal(ext.contexts.get('taskAccordion.sharedLibrary'), false);
  assert.equal(watcher.disposed, true);
  assert.equal(ext.view.message, undefined);
  assert.equal((await ext.provider.getChildren())[0].label, 'Local');
  assert.equal(ext.libraries.getChildren()[1].description, 'shared');
  assert.equal(ext.libraries.getChildren()[0].description, undefined);
  assert.equal(ext.view.description, 'tasks.json');
  assert.deepEqual(ext.errors, []);
});

test('cancelled and invalid selections keep the existing source', async () => {
  const ext = createExtension();
  await ext.commands.get('taskAccordion.loadFile')();
  assert.equal(ext.provider.sourceUri, undefined);
  ext.files.set(ext.uri.toString(), '{bad');
  ext.select([ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  assert.equal(ext.provider.sourceUri, undefined);
  assert.equal(ext.state.has('sharedTasksUri'), false);
  assert.match(ext.errors[0], /Could not load shared tasks/);
  assert.equal((await ext.provider.getChildren())[0].label, 'Local');
});

test('restores saved source and reports missing or invalid files without falling back', async () => {
  const ext = createExtension({ sharedTasksUri: 'file:///shared/tasks.json' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await ext.provider.getChildren()).length, 0);
  assert.equal(ext.libraries.getChildren()[1].contextValue, 'sharedSource');
  assert.match(ext.errors[0], /File not found/);
  assert.equal(ext.provider.sourceUri.toString(), 'file:///shared/tasks.json');
  ext.files.set(ext.uri.toString(), shared([{ label: 'Recovered', type: 'shell', command: 'echo ok' }]));
  ext.watchers[1].fire('create');
  assert.equal((await ext.provider.getChildren())[0].label, 'Recovered');
  ext.files.delete(ext.uri.toString());
  ext.watchers[1].fire('remove');
  assert.equal((await ext.provider.getChildren()).length, 0);
  ext.files.set(ext.uri.toString(), '{bad');
  assert.equal((await ext.provider.getChildren()).length, 0);
  assert.match(ext.errors.at(-1), /Invalid JSON/);
  for (const subscription of ext.context.subscriptions) subscription.dispose();
  assert.equal(ext.watchers[1].disposed, true);
});

test('single and group play buttons execute shared tasks and dependencies in order', async () => {
  const ext = createExtension();
  ext.files.set(ext.uri.toString(), shared([
    { label: 'Prepare', type: 'shell', command: 'echo prepare' },
    { label: 'Run: A', type: 'shell', command: 'echo a', dependsOn: 'Prepare' },
    { label: 'Run: B', type: 'shell', command: 'echo b' }
  ]));
  ext.select([ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  const [group] = await ext.provider.getChildren();
  await ext.commands.get('taskAccordion.run')(group.children[0]);
  assert.deepEqual(ext.executed, ['Prepare', 'Run: A']);
  ext.executed.length = 0;
  await ext.commands.get('taskAccordion.runGroup')(group);
  assert.deepEqual(ext.executed, ['Prepare', 'Run: A', 'Run: B']);
  assert.deepEqual(ext.errors, []);
});

test('non-zero dependency exit codes stop execution and surface an error', async () => {
  const ext = createExtension();
  ext.files.set(ext.uri.toString(), shared([
    { label: 'Fail', type: 'shell', command: 'exit 1' },
    { label: 'Parent', type: 'shell', command: 'echo parent', dependsOn: 'Fail' }
  ]));
  ext.select([ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  const items = await ext.provider.getChildren();
  await ext.commands.get('taskAccordion.run')(items.find(item => item.label === 'Parent'));
  assert.deepEqual(ext.executed, ['Fail']);
  assert.match(ext.errors[0], /exited with code 1/);
});

test('source paths show the filename and last three folders, including spaces and Windows separators', async () => {
  for (const [value, expected] of [
    ['file:///Users/example/Libraries/shared/build/tasks.json', '.../Libraries/shared/build'],
    ['file:///shared/My%20Commands/tasks.json', 'shared/My Commands'],
    ['file:///tasks.json', ''],
    ['file:///C:/Users/example/shared/tasks.json', '.../Users/example/shared']
  ]) {
    const ext = createExtension({ sharedTasksUri: value });
    ext.files.set(value, shared([]));
    const [, source] = ext.libraries.getChildren();
    assert.equal(source.label, 'tasks.json');
    assert.equal(source.description, expected);
    assert.ok(source.tooltip.includes(ext.parseUri(value).fsPath));
    await ext.commands.get(source.command.command)(...source.command.arguments);
    assert.equal(ext.provider.sourceUri.toString(), value);
    await ext.commands.get('taskAccordion.openFile')();
    assert.equal(ext.opened[0], value);
  }
  const ext = createExtension();
  ext.provider.sourceUri = {
    fsPath: 'C:\\Users\\example\\shared\\tasks.json',
    toString: () => 'file:///C:/Users/example/shared/tasks.json'
  };
  ext.files.set(ext.provider.sourceUri.toString(), shared([]));
  ext.provider.sharedSources = [ext.provider.sourceUri];
  const [, source] = ext.libraries.getChildren();
  assert.equal(source.label, 'tasks.json');
  assert.equal(source.description, '.../Users/example/shared');
});

test('workspace row returns to the project and keeps the shared active indicator blue', async () => {
  const ext = createExtension();
  ext.files.set(ext.uri.toString(), shared([]));
  ext.select([ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  assert.equal(ext.state.get('sharedTasksUri'), ext.uri.toString());
  assert.equal(ext.contexts.get('taskAccordion.sharedLibrary'), true);
  assert.equal(ext.libraries.getChildren()[1].iconPath.color.id, 'taskAccordion.sharedForeground');
  await ext.commands.get(ext.libraries.getChildren()[0].command.command)();
  assert.equal(ext.provider.sourceUri, undefined);
  assert.equal(ext.contexts.get('taskAccordion.sharedLibrary'), false);
});

test('remembers every loaded library once and switches by clicking saved rows', async () => {
  const ext = createExtension();
  const other = ext.parseUri('file:///other/tasks.json');
  ext.files.set(ext.uri.toString(), shared([{ label: 'First', type: 'shell', command: 'echo first' }]));
  ext.files.set(other.toString(), shared([{ label: 'Second', type: 'shell', command: 'echo second' }]));
  for (const uri of [ext.uri, other, ext.uri, other]) {
    ext.select([uri]);
    await ext.commands.get('taskAccordion.loadFile')();
  }
  assert.deepEqual(Array.from(ext.state.get('sharedTasksHistory')), [ext.uri.toString(), other.toString()]);
  let [task] = await ext.provider.getChildren();
  let libraries = ext.libraries.getChildren().slice(1);
  assert.equal(task.label, 'Second');
  assert.equal(libraries.length, 2);
  assert.equal(libraries[0].description, 'shared');
  assert.equal(libraries[0].iconPath.color, undefined);
  assert.equal(libraries[1].description, 'other');
  assert.equal(libraries[1].iconPath.color.id, 'taskAccordion.sharedForeground');
  const previousWatcher = ext.watchers.at(-1);
  const first = libraries[0];
  await ext.commands.get(first.command.command)(...first.command.arguments);
  assert.equal(previousWatcher.disposed, true);
  assert.equal(ext.watchers.at(-1).pattern.base.fsPath, '/shared');
  [task] = await ext.provider.getChildren();
  libraries = ext.libraries.getChildren().slice(1);
  assert.equal(task.label, 'First');
  assert.equal(libraries[0].description, 'shared');
  assert.equal(libraries[0].iconPath.color.id, 'taskAccordion.sharedForeground');
  assert.equal(libraries[1].description, 'other');
  await ext.commands.get(ext.libraries.getChildren()[0].command.command)();
  [task] = await ext.provider.getChildren();
  libraries = ext.libraries.getChildren().slice(1);
  assert.equal(task.label, 'Local');
  assert.equal(libraries.length, 2);
  assert.equal(libraries[0].iconPath.color, undefined);
  const second = libraries[1];
  await ext.commands.get(second.command.command)(...second.command.arguments);
  assert.equal((await ext.provider.getChildren())[0].label, 'Second');
  assert.equal(ext.contexts.get('taskAccordion.sharedLibrary'), true);
  assert.deepEqual(ext.errors, []);
});

test('restores history in workspace mode and migrates the previously selected library', async () => {
  const history = ['file:///one/tasks.json', 'file:///two/tasks.json'];
  const ext = createExtension({ sharedTasksHistory: history });
  const [task] = await ext.provider.getChildren();
  const libraries = ext.libraries.getChildren().slice(1);
  assert.equal(task.label, 'Local');
  assert.deepEqual(Array.from(libraries, item => item.command.arguments[0].toString()), history);
  assert.ok(libraries.every(item => item.iconPath.color === undefined));
  const old = createExtension({ sharedTasksUri: 'file:///legacy/tasks.json' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(old.state.get('sharedTasksHistory')), ['file:///legacy/tasks.json']);
  assert.equal(old.libraries.getChildren().length, 2);
});

test('missing or invalid saved selections preserve the current source, history and watcher', async () => {
  const ext = createExtension({ sharedTasksHistory: ['file:///missing/tasks.json'] });
  ext.files.set(ext.uri.toString(), shared([{ label: 'Current', type: 'shell', command: 'echo current' }]));
  ext.select([ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  const watcher = ext.watchers.at(-1);
  const history = Array.from(ext.state.get('sharedTasksHistory'));
  const [, missing] = ext.libraries.getChildren();
  for (const invalidContent of [undefined, '{bad']) {
    if (invalidContent !== undefined) ext.files.set('file:///missing/tasks.json', invalidContent);
    await ext.commands.get(missing.command.command)(...missing.command.arguments);
    assert.equal(ext.provider.sourceUri.toString(), ext.uri.toString());
    assert.equal(ext.state.get('sharedTasksUri'), ext.uri.toString());
    assert.deepEqual(Array.from(ext.state.get('sharedTasksHistory')), history);
    assert.equal(watcher.disposed, undefined);
    assert.equal((await ext.provider.getChildren())[0].label, 'Current');
  }
  assert.equal(ext.errors.length, 2);
});

test('toolbar keeps Load neutral with no Home button in either source mode', () => {
  const manifest = require('../package.json');
  const menus = manifest.contributes.menus['view/title'];
  for (const sharedMode of [false, true]) {
    const visible = menus.filter(item =>
      item.when.includes('!taskAccordion.sharedLibrary') ? !sharedMode
        : item.when.includes('&& taskAccordion.sharedLibrary') ? sharedMode : true
    ).sort((a, b) => a.group.localeCompare(b.group));
    assert.deepEqual(visible.map(item => item.command), [
      'taskAccordion.loadFile',
      'taskAccordion.openFile',
      'taskAccordion.refresh',
      'taskAccordion.sort'
    ]);
    assert.equal(visible[0].when, 'view == taskAccordion.libraries');
    assert.ok(visible.slice(1).every(item => item.when === 'view == taskAccordion.tasks'));
    for (const item of visible) {
      const command = manifest.contributes.commands.find(command => command.command === item.command);
      assert.ok(command);
    }
    assert.equal(manifest.contributes.commands.find(command => command.command === 'taskAccordion.loadFile').icon, '$(folder-opened)');
    assert.ok(!manifest.contributes.commands.some(command => command.command.endsWith('.shared')));
  }
  assert.deepEqual(manifest.contributes.views.taskAccordion.slice(0, 2).map(view => view.name), ['Task Libraries', 'Commands']);
});

test('removing an inactive saved file preserves the active source and file on disk', async () => {
  const ext = createExtension();
  const other = ext.parseUri('file:///other/tasks.json');
  for (const uri of [ext.uri, other]) {
    ext.files.set(uri.toString(), shared([]));
    ext.select([uri]);
    await ext.commands.get('taskAccordion.loadFile')();
  }
  const watcher = ext.watchers.at(-1);
  const [, source] = ext.libraries.getChildren();
  await ext.commands.get('taskAccordion.removeSharedFile')(source);
  assert.deepEqual(Array.from(ext.state.get('sharedTasksHistory')), [other.toString()]);
  assert.equal(ext.state.get('sharedTasksUri'), other.toString());
  assert.equal(ext.provider.sourceUri.toString(), other.toString());
  assert.equal(watcher.disposed, undefined);
  assert.equal(ext.files.has(ext.uri.toString()), true);
  assert.equal(ext.libraries.getChildren().length, 2);
  assert.deepEqual(ext.errors, []);
});

test('removing the active file returns to workspace tasks and persists removal across restarts', async () => {
  const ext = createExtension();
  ext.files.set(ext.uri.toString(), shared([]));
  ext.select([ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  const watcher = ext.watchers.at(-1);
  const [, source] = ext.libraries.getChildren();
  await ext.commands.get('taskAccordion.removeSharedFile')(source);
  assert.deepEqual(Array.from(ext.state.get('sharedTasksHistory')), []);
  assert.equal(ext.state.has('sharedTasksUri'), false);
  assert.equal(ext.provider.sourceUri, undefined);
  assert.equal(ext.contexts.get('taskAccordion.sharedLibrary'), false);
  assert.equal(watcher.disposed, true);
  assert.equal(ext.files.has(ext.uri.toString()), true);
  assert.equal((await ext.provider.getChildren())[0].label, 'Local');
  const restored = createExtension(Object.fromEntries(ext.state));
  assert.equal((await restored.provider.getChildren())[0].label, 'Local');
  await ext.commands.get('taskAccordion.loadFile')();
  assert.equal(ext.libraries.getChildren().length, 2);
  assert.deepEqual(ext.errors, []);
});

test('removes missing saved files in workspace mode without accessing the file', async () => {
  const ext = createExtension({ sharedTasksHistory: ['file:///missing/tasks.json'] });
  await new Promise(resolve => setImmediate(resolve));
  const [, source] = ext.libraries.getChildren();
  await ext.commands.get('taskAccordion.removeSharedFile')(source);
  assert.deepEqual(Array.from(ext.state.get('sharedTasksHistory')), []);
  assert.equal((await ext.provider.getChildren())[0].label, 'Local');
  assert.deepEqual(ext.errors, []);
});

test('remove button is only contributed for saved library rows', () => {
  const manifest = require('../package.json');
  const command = manifest.contributes.commands.find(item => item.command === 'taskAccordion.removeSharedFile');
  assert.equal(command.icon, '$(close)');
  const menu = manifest.contributes.menus['view/item/context'].find(item => item.command === command.command);
  assert.equal(menu.when, 'view == taskAccordion.libraries && viewItem == sharedSource');
  assert.equal(menu.group, 'inline');
});

test('libraries and commands remain separate and both refresh when the source changes', async () => {
  const ext = createExtension();
  assert.deepEqual(Array.from(ext.libraries.getChildren(), item => item.label), ['Workspace tasks']);
  assert.equal(ext.libraries.getChildren(ext.libraries.getChildren()[0]).length, 0);
  let libraryRefreshes = 0;
  let commandRefreshes = 0;
  ext.libraries.onDidChangeTreeData(() => libraryRefreshes++);
  ext.provider.onDidChangeTreeData(() => commandRefreshes++);
  ext.files.set(ext.uri.toString(), shared([{ label: 'Shared command', type: 'shell', command: 'echo hello' }]));
  ext.select([ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  assert.deepEqual(Array.from(ext.libraries.getChildren(), item => item.contextValue), ['workspaceSource', 'sharedSource']);
  assert.deepEqual(Array.from(await ext.provider.getChildren(), item => item.contextValue), ['task']);
  const workspace = ext.libraries.getChildren()[0];
  await ext.commands.get(workspace.command.command)();
  assert.equal(ext.libraries.getChildren()[0].description, undefined);
  assert.deepEqual(Array.from(await ext.provider.getChildren(), item => item.label), ['Local']);
  assert.ok(libraryRefreshes >= 2);
  assert.equal(libraryRefreshes, commandRefreshes);
});

test('Commands header shows the selected filename and library descriptions omit Active text', async () => {
  const ext = createExtension();
  const uri = ext.parseUri('file:///shared/My%20Commands.json');
  ext.files.set(uri.toString(), shared([]));
  ext.select([uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  assert.equal(ext.view.description, 'My Commands.json');
  const [, source] = ext.libraries.getChildren();
  assert.equal(source.description, 'shared');
  assert.equal(source.iconPath.id, 'check');
  assert.equal(source.iconPath.color.id, 'taskAccordion.sharedForeground');
  await ext.commands.get('taskAccordion.useWorkspace')();
  assert.equal(ext.view.description, 'tasks.json');
  assert.equal(ext.libraries.getChildren()[0].description, undefined);
});

test('selecting a shared or workspace list opens Commands without stealing focus on startup or refresh', async () => {
  const ext = createExtension();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ext.focusedViews.length, 0);
  ext.view.visible = false;
  ext.files.set(ext.uri.toString(), shared([]));
  ext.select([ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  assert.equal(ext.view.visible, true);
  assert.equal(ext.focusedViews.length, 1);
  ext.provider.refresh();
  ext.watchers.at(-1).fire();
  assert.equal(ext.focusedViews.length, 1);
  ext.view.visible = false;
  const workspace = ext.libraries.getChildren()[0];
  await ext.commands.get(workspace.command.command)();
  assert.equal(ext.view.visible, true);
  assert.equal(ext.focusedViews.length, 2);
  ext.view.visible = false;
  const source = ext.libraries.getChildren()[1];
  await ext.commands.get(source.command.command)(...source.command.arguments);
  assert.equal(ext.view.visible, true);
  assert.equal(ext.focusedViews.length, 3);
  ext.files.delete(ext.uri.toString());
  await ext.commands.get(source.command.command)(...source.command.arguments);
  assert.equal(ext.focusedViews.length, 3);
});

test('multi-file picker validates every file, skips corrupt files and selects the first valid file', async () => {
  const ext = createExtension();
  const corrupt = ext.parseUri('file:///bad/tasks.json');
  const missing = ext.parseUri('file:///missing/tasks.json');
  const other = ext.parseUri('file:///other/tasks.json');
  ext.files.set(corrupt.toString(), '{broken');
  ext.files.set(ext.uri.toString(), shared([{ label: 'First', type: 'shell', command: 'echo first' }]));
  ext.files.set(other.toString(), shared([{ label: 'Second', type: 'shell', command: 'echo second' }]));
  ext.select([corrupt, ext.uri, missing, other, ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  assert.equal(ext.dialogs[0].canSelectMany, true);
  assert.deepEqual(Array.from(ext.state.get('sharedTasksHistory')), [ext.uri.toString(), other.toString()]);
  assert.equal(ext.state.get('sharedTasksUri'), ext.uri.toString());
  assert.equal((await ext.provider.getChildren())[0].label, 'First');
  assert.equal(ext.focusedViews.length, 1);
  assert.equal(ext.watchers.length, 2);
  assert.equal(ext.errors.length, 2);
  assert.ok(ext.errors.some(message => message.includes('/bad/tasks.json') && message.includes('Invalid JSON')));
  assert.ok(ext.errors.some(message => message.includes('/missing/tasks.json') && message.includes('File not found')));
  assert.deepEqual(ext.executed, []);
  const otherRow = ext.libraries.getChildren()[2];
  await ext.commands.get(otherRow.command.command)(...otherRow.command.arguments);
  assert.equal((await ext.provider.getChildren())[0].label, 'Second');
});

test('rejects an entirely invalid batch without changing the previous source or saved library', async () => {
  const ext = createExtension();
  ext.files.set(ext.uri.toString(), shared([]));
  ext.select([ext.uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  const before = JSON.stringify(Object.fromEntries(ext.state));
  const watcher = ext.watchers.at(-1);
  const bad = ext.parseUri('file:///bad/tasks.json');
  const malformedTask = ext.parseUri('file:///malformed/tasks.json');
  ext.files.set(bad.toString(), '{');
  ext.files.set(malformedTask.toString(), shared([
    { label: 'Valid', type: 'shell', command: 'echo valid' },
    { label: 'Invalid', type: 'shell', command: 'echo invalid', isBackground: 'yes' }
  ]));
  ext.select([bad, malformedTask]);
  await ext.commands.get('taskAccordion.loadFile')();
  assert.equal(JSON.stringify(Object.fromEntries(ext.state)), before);
  assert.equal(ext.provider.sourceUri.toString(), ext.uri.toString());
  assert.equal(ext.watchers.at(-1), watcher);
  assert.equal(watcher.disposed, undefined);
  assert.equal(ext.focusedViews.length, 1);
  assert.equal(ext.errors.length, 2);
  assert.ok(ext.errors.some(message => message.includes('/malformed/tasks.json') && message.includes('isBackground')));
  assert.deepEqual(ext.executed, []);
});

test('the workspace task file can be validated and loaded without executing its commands', async () => {
  const ext = createExtension();
  const uri = ext.parseUri('file:///workspace/.vscode/tasks.json');
  ext.files.set(uri.toString(), fs.readFileSync(path.join(__dirname, '../.vscode/tasks.json'), 'utf8'));
  ext.select([uri]);
  await ext.commands.get('taskAccordion.loadFile')();
  assert.equal(ext.provider.sourceUri.toString(), uri.toString());
  assert.equal((await ext.provider.getChildren()).length, 2);
  assert.deepEqual(ext.errors, []);
  assert.deepEqual(ext.executed, []);
});
