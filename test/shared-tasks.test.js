const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { readSharedTasks, runSharedTask } = require('../shared-tasks');

const uri = {
  fsPath: '/shared/tasks.json',
  toString: () => 'file:///shared/tasks.json'
};

function mockVscode(config, folders = [{ uri: { fsPath: '/workspace' }, name: 'project' }]) {
  class ShellExecution {
    constructor(command, args, options) {
      if (Array.isArray(args)) {
        this.command = command;
        this.args = args;
        this.options = options;
      } else {
        this.commandLine = command;
        this.options = args;
      }
    }
  }
  class ProcessExecution {
    constructor(process, args, options) {
      Object.assign(this, { process, args, options });
    }
  }
  class Task {
    constructor(definition, scope, name, source, execution, problemMatchers) {
      Object.assign(this, { definition, scope, name, source, execution, problemMatchers });
    }
  }
  return {
    workspace: {
      fs: { readFile: async () => Buffer.from(typeof config === 'string' ? config : JSON.stringify(config)) },
      workspaceFolders: folders
    },
    Uri: { joinPath: (base, part) => ({ fsPath: path.posix.join(base.fsPath, part) }) },
    TaskScope: { Global: 1 },
    ShellQuoting: { Escape: 1, Strong: 2, Weak: 3 },
    ShellExecution,
    ProcessExecution,
    Task,
    TaskGroup: { Build: { id: 'build' }, Test: { id: 'test' } }
  };
}

function library(tasks, extra = {}) {
  return { version: '2.0.0', tasks, ...extra };
}

test('reads comments, trailing commas, shell command lines and process arguments in file order', async () => {
  const vscode = mockVscode(`{
    // Shared library
    "version": "2.0.0",
    "tasks": [
      { "label": "Build: App", "type": "shell", "command": "dotnet build", },
      { "label": "Test", "type": "process", "command": "dotnet", "args": ["test"], }
    ],
  }`);
  const result = await readSharedTasks(vscode, uri);
  assert.deepEqual(result.tasks.map(task => task.name), ['Build: App', 'Test']);
  assert.equal(result.tasks[0].execution.commandLine, 'dotnet build');
  assert.equal(result.tasks[0].scope, vscode.workspace.workspaceFolders[0]);
  assert.equal(result.tasks[1].execution.process, 'dotnet');
  assert.deepEqual(result.tasks[1].execution.args, ['test']);
  assert.deepEqual(result.tasks[0].problemMatchers, []);
});

test('preserves defaults, platform overrides, quoting and task metadata', async () => {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const vscode = mockVscode(library([{
    label: 'Build',
    command: 'base',
    options: { env: { MODE: 'task' } },
    [platform]: { command: { value: 'tool path', quoting: 'strong' }, args: [{ value: 'two words', quoting: 'weak' }] },
    detail: 'Build everything',
    group: { kind: 'build', isDefault: true },
    presentation: { reveal: 'never' },
    problemMatcher: '$msCompile',
    isBackground: true
  }], { type: 'shell', options: { cwd: '${workspaceFolder}', env: { MODE: 'default' } } }));
  const { tasks: [task] } = await readSharedTasks(vscode, uri);
  assert.deepEqual(task.execution.command, { value: 'tool path', quoting: 2 });
  assert.deepEqual(task.execution.args, [{ value: 'two words', quoting: 3 }]);
  assert.deepEqual(task.execution.options, { cwd: '${workspaceFolder}', env: { MODE: 'task' } });
  assert.deepEqual(task.problemMatchers, ['$msCompile']);
  assert.equal(task.group.id, 'build');
  assert.equal(task.group, vscode.TaskGroup.Build);
  assert.equal(task.detail, 'Build everything');
  assert.equal(task.isBackground, true);
  assert.deepEqual(task.presentationOptions, { reveal: 'never' });
});

test('merges environment and working-directory defaults across platform and task options', async () => {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const vscode = mockVscode(library([{
    label: 'Build', command: 'echo',
    options: { env: { TASK: 'yes' } },
    [platform]: { options: { env: { BASE: 'override' } } }
  }], {
    type: 'shell',
    options: { env: { BASE: 'base' } },
    [platform]: { options: { cwd: '/platform' } }
  }));
  const { tasks: [task] } = await readSharedTasks(vscode, uri);
  assert.deepEqual(task.execution.options, { cwd: '/platform', env: { BASE: 'override', TASK: 'yes' } });
});

test('without a workspace, defaults to the library directory and global scope', async () => {
  const vscode = mockVscode(library([{ label: 'Hello', type: 'shell', command: 'echo hello' }]), []);
  const { tasks: [task] } = await readSharedTasks(vscode, uri);
  assert.equal(task.scope, vscode.TaskScope.Global);
  assert.equal(task.execution.options.cwd, '/shared');
});

test('maps custom shell options to the VS Code API and preserves empty arguments', async () => {
  const vscode = mockVscode(library([{
    label: 'Shell', type: 'shell', command: 'printf',
    args: ['', { value: '', quoting: 'strong' }],
    options: { shell: { executable: '/bin/bash', args: ['-c'] } }
  }]));
  const { tasks: [task] } = await readSharedTasks(vscode, uri);
  assert.deepEqual(task.execution.options, { executable: '/bin/bash', shellArgs: ['-c'] });
  assert.deepEqual(task.execution.args, ['', { value: '', quoting: 2 }]);
});

test('rejects malformed and unsupported files explicitly', async () => {
  const cases = [
    ['{', /Invalid JSON/],
    [{ version: '1.0.0', tasks: [] }, /version "2.0.0"/],
    [library([null]), /must be an object/],
    [library([{ label: 'Npm', type: 'npm', script: 'test' }]), /only shell and process/],
    [library([{ label: 'Missing', type: 'shell' }]), /command is required/],
    [library([{ label: 'Input', type: 'shell', command: '${input:name}' }]), /input variables/],
    [library([], { inputs: [] }), /do not support inputs/],
    [library([{ label: 'Bad args', type: 'process', command: 'echo', args: [42] }]), /args must be/],
    [library([{ label: 'Bad options', type: 'shell', command: 'echo', options: 'bad' }]), /options must be/],
    [library([{ label: 'Bad env', type: 'shell', command: 'echo', options: { env: { BAD: 1 } } }]), /options.env must be/],
    [library([{ label: 'Bad matcher', type: 'shell', command: 'echo', problemMatcher: {} }]), /problemMatcher must be/],
    [library([{ label: 'Bad background', type: 'shell', command: 'echo', isBackground: 'true' }]), /isBackground must be/],
    [library([{ label: 'Bad presentation', type: 'shell', command: 'echo', presentation: [] }]), /presentation must be/],
    [library([{ label: 'Bad reveal', type: 'shell', command: 'echo', presentation: { reveal: 'invalid' } }]), /presentation.reveal/],
    [library([{ label: 'Bad group', type: 'shell', command: 'echo', group: 1 }]), /group must be/],
    [library([{ label: 'Bad run options', type: 'shell', command: 'echo', runOptions: 'invalid' }]), /runOptions must be/],
    [library([{ label: 'Bad platform', type: 'shell', command: 'echo', windows: [] }]), /windows settings must be/],
    [library([{ label: 'Missing dependency', dependsOn: ['Unknown'] }]), /was not found/],
    [library([{ label: 'Bad dependency', dependsOn: [{ task: 'Other' }] }]), /dependsOn must be/],
    [library([{ label: 'Empty compound', dependsOn: [] }]), /at least one dependency/],
    [library([{ label: 'A', dependsOn: 'B' }, { label: 'B', dependsOn: 'A' }]), /Circular dependency/],
    [library([{ label: 'A', type: 'shell', command: 'echo' }, { label: 'A', type: 'shell', command: 'echo' }]), /unique/]
  ];
  for (const [config, expected] of cases) {
    await assert.rejects(readSharedTasks(mockVscode(config), uri), expected);
  }
});

test('runs sequential dependencies before the parent, including compound tasks', async () => {
  const config = library([
    { label: 'All', dependsOn: ['First', 'Second'], dependsOrder: 'sequence' },
    { label: 'First', type: 'shell', command: 'echo first' },
    { label: 'Second', type: 'shell', command: 'echo second', dependsOn: 'First' },
    { label: 'Finish', type: 'shell', command: 'echo done', dependsOn: 'All' }
  ]);
  const { tasks, dependencies } = await readSharedTasks(mockVscode(config), uri);
  const executed = [];
  await runSharedTask(tasks[3], dependencies, async task => executed.push(task.name));
  assert.deepEqual(executed, ['First', 'Second', 'Finish']);
});

test('runs parallel dependencies concurrently and shares diamond dependencies', async () => {
  const config = library([
    { label: 'All', dependsOn: ['A', 'B'] },
    { label: 'A', type: 'shell', command: 'a', dependsOn: 'Shared' },
    { label: 'B', type: 'shell', command: 'b', dependsOn: 'Shared' },
    { label: 'Shared', type: 'shell', command: 'shared' }
  ]);
  const { tasks, dependencies } = await readSharedTasks(mockVscode(config), uri);
  const started = [];
  const releases = new Map();
  const completion = runSharedTask(tasks[0], dependencies, async task => {
    started.push(task.name);
    if (task.name !== 'Shared') await new Promise(resolve => releases.set(task.name, resolve));
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['Shared', 'A', 'B']);
  releases.get('A')();
  releases.get('B')();
  await completion;
});

test('a failing dependency prevents parent execution', async () => {
  const { tasks, dependencies } = await readSharedTasks(mockVscode(library([
    { label: 'Parent', type: 'shell', command: 'parent', dependsOn: 'Fail' },
    { label: 'Fail', type: 'shell', command: 'fail' }
  ])), uri);
  const executed = [];
  await assert.rejects(runSharedTask(tasks[0], dependencies, async task => {
    executed.push(task.name);
    throw new Error('Failed command');
  }), /Failed command/);
  assert.deepEqual(executed, ['Fail']);
});
