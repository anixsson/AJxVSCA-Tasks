const vscode = require('vscode');
const { readSharedTasks, runSharedTask } = require('./shared-tasks');

class TaskProvider {
  constructor(sortBy = 'name') {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    this.sortBy = sortBy;
    this.sourceUri = undefined;
    this.sharedSources = [];
  }

  refresh() {
    this._emitter.fire();
  }

  setSortBy(sortBy) {
    this.sortBy = sortBy;
    this.refresh();
  }

  getTreeItem(el) {
    return el;
  }

  async getChildren(el) {
    if (el && el.contextValue === 'group') return el.children;
    if (el) return [];
    // Tasks from .vscode/tasks.json have source "Workspace" and a WorkspaceFolder scope;
    // user-level tasks use the Global scope (a number), so they are excluded.
    let tasks;
    let dependencies;
    const sourceUri = this.sourceUri;
    if (sourceUri) {
      try {
        const library = await readSharedTasks(vscode, sourceUri);
        tasks = library.tasks;
        dependencies = library.dependencies;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Could not load shared tasks from ${sourceUri.fsPath}: ${message}`);
        return [];
      }
    } else {
      tasks = (await vscode.tasks.fetchTasks()).filter(
        t => t.source === 'Workspace' && t.scope && typeof t.scope === 'object'
      );
    }
    if (this.sortBy === 'name') tasks.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    // A label like "Build: Api" is shown as "Api" under a "Build" heading
    const groups = new Map();
    const loose = [];
    const ordered = [];
    for (const task of tasks) {
      const m = /^([^:]+):\s*(.+)$/.exec(task.name);
      if (!m) {
        const item = this._taskItem(task, task.name, dependencies);
        loose.push(item);
        ordered.push(item);
        continue;
      }
      const heading = m[1].trim();
      if (!groups.has(heading)) {
        const g = new vscode.TreeItem(heading, vscode.TreeItemCollapsibleState.Expanded);
        g.contextValue = 'group';
        g.iconPath = new vscode.ThemeIcon('folder');
        g.tooltip = `Run all tasks in ${heading} in order`;
        g.children = [];
        groups.set(heading, g);
        ordered.push(g);
      }
      groups.get(heading).children.push(this._taskItem(task, m[2].trim(), dependencies));
    }
    if (this.sortBy === 'file') return ordered;
    return [...[...groups.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })), ...loose];
  }

  _taskItem(task, label, dependencies) {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'task';
    item.iconPath = new vscode.ThemeIcon('terminal');
    const command = this._taskCommand(task);
    item.tooltip = command
      ? [command, task.detail].filter(Boolean).join('\n')
      : task.detail || task.name;
    item.description = command || task.detail;
    item.task = task;
    item.dependencies = dependencies;
    return item;
  }

  _taskCommand(task) {
    const execution = task.execution;
    if (!execution) return '';
    if (execution.commandLine) return execution.commandLine;

    const command = execution.command || execution.process;
    if (!command) return '';
    const displayArg = arg => typeof arg === 'string' ? arg : arg.value;
    const args = (execution.args || []).map(displayArg);
    return [displayArg(command), ...args].join(' ');
  }
}

class LibraryProvider {
  constructor(tasks) {
    this.tasks = tasks;
    this.onDidChangeTreeData = tasks.onDidChangeTreeData;
  }

  getTreeItem(item) {
    return item;
  }

  getChildren(item) {
    if (item) return [];
    const workspace = new vscode.TreeItem('Workspace tasks', vscode.TreeItemCollapsibleState.None);
    workspace.id = 'workspaceTasks';
    workspace.contextValue = 'workspaceSource';
    workspace.description = this.tasks.sourceUri ? undefined : 'Active';
    workspace.iconPath = new vscode.ThemeIcon(this.tasks.sourceUri ? 'home' : 'check');
    workspace.tooltip = 'Switch to this project\'s .vscode/tasks.json';
    workspace.command = { command: 'taskAccordion.useWorkspace', title: 'Use Workspace Tasks' };
    return [workspace, ...this.tasks.sharedSources.map(uri => this._sourceItem(uri))];
  }

  _sourceItem(uri) {
    const active = uri.toString() === this.tasks.sourceUri?.toString();
    const parts = uri.fsPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const item = new vscode.TreeItem(parts.pop(), vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'sharedSource';
    item.sourceUri = uri;
    item.id = `sharedSource:${uri.toString()}`;
    item.description = `${parts.length > 3 ? '.../' : ''}${parts.slice(-3).join('/')}`;
    if (active) item.description = ['Active', item.description].filter(Boolean).join(' - ');
    item.iconPath = new vscode.ThemeIcon(active ? 'check' : 'file-code',
      active ? new vscode.ThemeColor('taskAccordion.sharedForeground') : undefined);
    item.tooltip = `Shared command library${active ? ' (active)' : ''}\n${uri.fsPath}\nClick to load this file`;
    item.command = { command: 'taskAccordion.selectSharedFile', title: 'Load Shared tasks.json', arguments: [uri] };
    return item;
  }
}

// "tasks.json" sections describe the file format; "Addon" sections describe this extension
const CHEATSHEET = [
  {
    title: 'tasks.json: Basics',
    icon: 'json',
    rows: [
      ['file', '.vscode/tasks.json'],
      ['label', 'Name shown in the list (unique)'],
      ['type', '"shell" runs in a shell'],
      ['command', 'What to run, e.g. dotnet build'],
      ['args', '["--flag", "value"]'],
      ['options.cwd', 'Folder to run in']
    ]
  },
  {
    title: 'tasks.json: Extras',
    icon: 'json',
    rows: [
      ['dependsOn', '["Build: Compile"] runs first'],
      ['isBackground', 'true for watchers/servers'],
      ['problemMatcher', '[] to skip error parsing'],
      ['presentation.reveal', '"always" | "silent" | "never"']
    ]
  },
  {
    title: 'tasks.json: Example',
    icon: 'code',
    rows: [['{ "label": "Build: Api", "type": "shell", "command": "dotnet build" }', '']]
  },
  {
    title: 'Addon: Grouping',
    icon: 'extensions',
    rows: [
      ['"Build: Api"', 'Shown as Api under Build'],
      ['Group play button', 'Runs all tasks in the group in order'],
      ['"Date"', 'No prefix = top level']
    ]
  },
  {
    title: 'Addon: Using',
    icon: 'extensions',
    rows: [
      ['Green play button', 'Runs the task'],
      ['Group play button', 'Runs each task in the group in order'],
      ['Sort Tasks button', 'Choose name or file order'],
      ['Load Shared tasks.json button', 'Switch to a task file anywhere on the system'],
      ['Use Workspace Tasks button', 'Return to this project\'s tasks'],
      ['Task Libraries panel', 'Select a saved file or Workspace tasks'],
      ['Commands panel', 'Run tasks from the selected source'],
      ['Refresh button', 'Reloads the active tasks.json'],
      ['Scope', 'Workspace tasks or the selected shared file']
    ]
  }
];

async function runTaskAndWait(task) {
  let execution;
  const endedExecutions = new Set();
  const processExitCodes = new Map();
  let resolveEnded;
  const ended = new Promise(resolve => {
    resolveEnded = resolve;
  });
  const endListener = vscode.tasks.onDidEndTask(event => {
    endedExecutions.add(event.execution);
    if (event.execution === execution) resolveEnded();
  });
  const processListener = vscode.tasks.onDidEndTaskProcess(event => {
    processExitCodes.set(event.execution, event.exitCode);
  });

  try {
    execution = await vscode.tasks.executeTask(task);
    if (endedExecutions.has(execution)) resolveEnded();
    await ended;
    const exitCode = processExitCodes.get(execution);
    if (exitCode !== undefined && exitCode !== 0) {
      throw new Error(`Task "${task.name}" exited with code ${exitCode}.`);
    }
  } finally {
    endListener.dispose();
    processListener.dispose();
  }
}

class HelpProvider {
  getTreeItem(el) {
    return el;
  }

  getChildren(el) {
    if (!el) {
      return CHEATSHEET.map(section => {
        const item = new vscode.TreeItem(section.title, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon(section.icon);
        item.section = section;
        return item;
      });
    }
    return el.section.rows.map(([key, text]) => {
      const item = new vscode.TreeItem(key, vscode.TreeItemCollapsibleState.None);
      item.description = text;
      item.tooltip = text ? `${key} - ${text}` : key;
      return item;
    });
  }
}

function activate(context) {
  const sortBy = context.workspaceState.get('sortBy', 'name');
  const provider = new TaskProvider(sortBy);
  const savedSource = context.workspaceState.get('sharedTasksUri');
  const savedSources = [...new Set([
    ...context.workspaceState.get('sharedTasksHistory', []),
    ...(savedSource ? [savedSource] : [])
  ])];
  provider.sharedSources = savedSources.map(value => vscode.Uri.parse(value));
  const view = vscode.window.createTreeView('taskAccordion.tasks', { treeDataProvider: provider });
  const libraryView = vscode.window.createTreeView('taskAccordion.libraries', { treeDataProvider: new LibraryProvider(provider) });
  const helpView = vscode.window.createTreeView('taskAccordion.help', { treeDataProvider: new HelpProvider() });
  const watcher = vscode.workspace.createFileSystemWatcher('**/.vscode/tasks.json');
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  let sharedWatcher;
  const sourceSubscription = { dispose: () => sharedWatcher?.dispose() };
  const setSource = async uri => {
    sharedWatcher?.dispose();
    sharedWatcher = undefined;
    provider.sourceUri = uri;
    view.description = uri ? 'Shared library' : 'Workspace tasks';
    if (uri) {
      sharedWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), uri.path.split('/').pop())
      );
      sharedWatcher.onDidChange(() => provider.refresh());
      sharedWatcher.onDidCreate(() => provider.refresh());
      sharedWatcher.onDidDelete(() => provider.refresh());
    }
    await vscode.commands.executeCommand('setContext', 'taskAccordion.sharedLibrary', Boolean(uri));
    provider.refresh();
  };
  const restoreSource = async () => {
    await setSource(savedSource ? vscode.Uri.parse(savedSource) : undefined);
    if (savedSources.length) await context.workspaceState.update('sharedTasksHistory', savedSources);
  };
  restoreSource().catch(error => {
    vscode.window.showErrorMessage(`Could not restore task source: ${error.message}`);
  });
  const selectSharedFile = async uri => {
    try {
      await readSharedTasks(vscode, uri);
      const history = [...new Set([...provider.sharedSources.map(source => source.toString()), uri.toString()])];
      await context.workspaceState.update('sharedTasksHistory', history);
      await context.workspaceState.update('sharedTasksUri', uri.toString());
      provider.sharedSources = history.map(value => vscode.Uri.parse(value));
      await setSource(uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Could not load shared tasks: ${message}`);
    }
  };

  context.subscriptions.push(
    view,
    libraryView,
    helpView,
    watcher,
    sourceSubscription,
    vscode.commands.registerCommand('taskAccordion.selectSharedFile', selectSharedFile),
    vscode.commands.registerCommand('taskAccordion.removeSharedFile', async item => {
      try {
        if (!item?.sourceUri || item.contextValue !== 'sharedSource') {
          throw new Error('Select a saved shared task file to remove.');
        }
        const uri = item.sourceUri;
        const history = provider.sharedSources.filter(source => source.toString() !== uri.toString());
        const active = provider.sourceUri?.toString() === uri.toString();
        await context.workspaceState.update('sharedTasksHistory', history.map(source => source.toString()));
        if (active) await context.workspaceState.update('sharedTasksUri', undefined);
        provider.sharedSources = history;
        if (active) await setSource(undefined);
        else provider.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Could not remove shared task file from the library: ${message}`);
      }
    }),
    vscode.commands.registerCommand('taskAccordion.loadFile.shared', () =>
      vscode.commands.executeCommand('taskAccordion.loadFile')),
    vscode.commands.registerCommand('taskAccordion.useWorkspace.shared', () =>
      vscode.commands.executeCommand('taskAccordion.useWorkspace')),
    vscode.commands.registerCommand('taskAccordion.loadFile', async () => {
      const selected = await vscode.window.showOpenDialog({
        title: 'Load Shared tasks.json',
        openLabel: 'Load Tasks',
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'Task files': ['json'] }
      });
      if (!selected?.length) return;
      await selectSharedFile(selected[0]);
    }),
    vscode.commands.registerCommand('taskAccordion.useWorkspace', async () => {
      try {
        await context.workspaceState.update('sharedTasksUri', undefined);
        await setSource(undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Could not switch to workspace tasks: ${message}`);
      }
    }),
    vscode.commands.registerCommand('taskAccordion.sort', async () => {
      const selected = await vscode.window.showQuickPick(
        [
          { label: 'Name (A-Z)', value: 'name' },
          { label: 'File order', value: 'file' }
        ],
        { placeHolder: `Sort tasks by (currently ${provider.sortBy === 'file' ? 'File order' : 'Name (A-Z)'})` }
      );
      if (!selected || selected.value === provider.sortBy) return;
      provider.setSortBy(selected.value);
      await context.workspaceState.update('sortBy', selected.value);
    }),
    vscode.commands.registerCommand('taskAccordion.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('taskAccordion.openFile', async () => {
      if (provider.sourceUri) {
        try {
          await vscode.window.showTextDocument(provider.sourceUri);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Could not open shared tasks.json: ${message}`);
        }
        return;
      }
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || !folders.length) return;
      const configDirectory = vscode.Uri.joinPath(folders[0].uri, '.vscode');
      const uri = vscode.Uri.joinPath(folders[0].uri, '.vscode', 'tasks.json');

      try {
        await vscode.workspace.fs.stat(uri);
      } catch (error) {
        if (error.code !== 'FileNotFound') {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Could not access .vscode/tasks.json: ${message}`);
          return;
        }

        const create = await vscode.window.showWarningMessage(
          '.vscode/tasks.json does not exist. Would you like to create it?',
          { modal: true },
          'Create'
        );
        if (create !== 'Create') return;

        try {
          await vscode.workspace.fs.createDirectory(configDirectory);
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from('{\n  "version": "2.0.0",\n  "tasks": []\n}\n')
          );
        } catch (createError) {
          const message = createError instanceof Error ? createError.message : String(createError);
          vscode.window.showErrorMessage(`Could not create .vscode/tasks.json: ${message}`);
          return;
        }
      }

      try {
        await vscode.window.showTextDocument(uri);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Could not open .vscode/tasks.json: ${message}`);
      }
    }),
    vscode.commands.registerCommand('taskAccordion.run', async arg => {
      // Inline button passes the tree item, which carries the task
      const task = arg && arg.task;
      if (!task) return;
      try {
        if (arg.dependencies) await runSharedTask(task, arg.dependencies, runTaskAndWait);
        else await vscode.tasks.executeTask(task);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Could not run task "${task.name}": ${message}`);
      }
    }),
    vscode.commands.registerCommand('taskAccordion.runGroup', async group => {
      const items = group && group.children
        ? group.children.filter(child => child.task)
        : [];
      const confirmation = await vscode.window.showWarningMessage(
        `Run all ${items.length} tasks in "${group.label}" in order?`,
        { modal: true },
        'Yes'
      );
      if (confirmation !== 'Yes') return;

      try {
        for (const item of items) {
          if (item.dependencies) await runSharedTask(item.task, item.dependencies, runTaskAndWait);
          else await runTaskAndWait(item.task);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Could not run group "${group.label}": ${message}`);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
