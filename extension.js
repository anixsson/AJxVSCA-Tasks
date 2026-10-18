const vscode = require('vscode');

class TaskProvider {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  refresh() {
    this._emitter.fire();
  }

  getTreeItem(el) {
    return el;
  }

  async getChildren(el) {
    if (el && el.contextValue === 'group') return el.children;
    if (el) return [];
    // Tasks from .vscode/tasks.json have source "Workspace" and a WorkspaceFolder scope;
    // user-level tasks use the Global scope (a number), so they are excluded.
    const tasks = (await vscode.tasks.fetchTasks()).filter(
      t => t.source === 'Workspace' && t.scope && typeof t.scope === 'object'
    );
    tasks.sort((a, b) => a.name.localeCompare(b.name));

    // A label like "Build: Api" is shown as "Api" under a "Build" heading
    const groups = new Map();
    const loose = [];
    for (const task of tasks) {
      const m = /^([^:]+):\s*(.+)$/.exec(task.name);
      if (!m) {
        loose.push(this._taskItem(task, task.name));
        continue;
      }
      const heading = m[1].trim();
      if (!groups.has(heading)) {
        const g = new vscode.TreeItem(heading, vscode.TreeItemCollapsibleState.Expanded);
        g.contextValue = 'group';
        g.iconPath = new vscode.ThemeIcon('folder');
        g.children = [];
        groups.set(heading, g);
      }
      groups.get(heading).children.push(this._taskItem(task, m[2].trim()));
    }
    return [...[...groups.values()].sort((a, b) => a.label.localeCompare(b.label)), ...loose];
  }

  _taskItem(task, label) {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'task';
    item.iconPath = new vscode.ThemeIcon('terminal');
    const command = this._taskCommand(task);
    item.tooltip = command
      ? [command, task.detail].filter(Boolean).join('\n')
      : task.detail || task.name;
    item.description = command || task.detail;
    item.task = task;
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
      ['"Date"', 'No prefix = top level']
    ]
  },
  {
    title: 'Addon: Using',
    icon: 'extensions',
    rows: [
      ['Green play button', 'Runs the task'],
      ['Refresh button', 'Reloads tasks.json'],
      ['Scope', 'Only this project\'s tasks.json']
    ]
  }
];

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
  const provider = new TaskProvider();
  const view = vscode.window.createTreeView('taskAccordion.tasks', { treeDataProvider: provider });
  const helpView = vscode.window.createTreeView('taskAccordion.help', { treeDataProvider: new HelpProvider() });
  const watcher = vscode.workspace.createFileSystemWatcher('**/.vscode/tasks.json');
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());

  context.subscriptions.push(
    view,
    helpView,
    watcher,
    vscode.commands.registerCommand('taskAccordion.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('taskAccordion.openFile', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || !folders.length) return;
      const uri = vscode.Uri.joinPath(folders[0].uri, '.vscode', 'tasks.json');
      try {
        await vscode.window.showTextDocument(uri);
      } catch {
        vscode.window.showWarningMessage('.vscode/tasks.json not found in this workspace.');
      }
    }),
    vscode.commands.registerCommand('taskAccordion.run', async arg => {
      // Inline button passes the tree item, which carries the task
      const task = arg && arg.task;
      if (task) await vscode.tasks.executeTask(task);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
