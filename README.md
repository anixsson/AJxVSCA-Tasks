# AJxVSCA Tasks

AJxVSCA Tasks is a Visual Studio Code extension that adds a sidebar for browsing and running tasks defined in your workspace's `.vscode/tasks.json`.

## Features

- Lists workspace tasks and lets you sort them by name or by their order in the workspace task list.
- Groups tasks whose labels use the `Group: Task` format. For example, `Build: Api` appears as `Api` under `Build`.
- Shows tasks without a colon at the top level.
- Shows each task's command in lighter secondary text next to its name and the full command on hover.
- Runs a task from its inline play button.
- Runs all tasks in a group, in order, from the group's inline play button after confirmation.
- Opens `.vscode/tasks.json` from the Tasks view title bar.
- Refreshes the task list when `.vscode/tasks.json` is created, changed, or deleted, or when you select the refresh button.
- Includes a collapsed **How to use** view with a brief `tasks.json` reference.

Only tasks scoped to a workspace are shown; user-level tasks are excluded.

## Getting started

1. Open a folder or workspace in VS Code.
2. Add tasks to `.vscode/tasks.json`. For example:

   ```json
   {
     "version": "2.0.0",
     "tasks": [
       {
         "label": "Build: Api",
         "type": "shell",
         "command": "dotnet",
         "args": ["build"]
       },
       {
         "label": "Test: Api",
         "type": "shell",
         "command": "dotnet",
         "args": ["test"]
       },
       {
         "label": "List files",
         "type": "shell",
         "command": "ls"
       }
     ]
   }
   ```

3. Open the **Tasks** activity bar view. Use its **Open tasks.json** title bar button to open the workspace task file, or select a task's play button to run it in the VS Code task terminal. To run a whole group, select the group's play button and confirm; tasks run sequentially in the selected sort order.
4. Use **Sort Tasks** in the view title bar to switch between **Name (A-Z)** and **File order**. The selection is remembered for each workspace. File order follows the order returned by VS Code for the workspace tasks; groups appear where their first task occurs, and tasks within each group keep their order.

**Tip:** When sorting by name, prefix group and task names with zero-padded numbers to keep them in the intended flow. For example, use `1. Setup` and `2. Build` for group names, and `Build: 1. Restore` and `Build: 2. Compile` for tasks. Zero-padding keeps `10` after `9`.

The example tasks use `dotnet` and `ls`; replace commands and arguments with ones available in your environment. VS Code must be version 1.80 or later.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
