# Changelog

Notable changes to this project are documented here.

## [0.3.0] - 2026-10-19

- Added a **Sort Tasks** button to the Tasks view title bar. It opens a picker with two options:
  - **Name (A-Z)** (default): groups are sorted alphabetically, followed by ungrouped tasks, and tasks within each group are sorted by name.
  - **File order**: tasks and groups follow the order of the workspace task list. A group appears where its first task occurs, and tasks within a group keep their order.
- The chosen sort order is remembered per workspace.
- Running a group with its play button now follows the selected sort order.
- Added the **Sort Tasks** button to the **How to use** view.

## [0.2.0] - 2026-10-19

- Added an inline play button to run all tasks in a group in order, after confirmation.

## [0.1.0] - 2026-10-18

- Added an **Open tasks.json** button to the Tasks view title bar.

## [0.0.1] - 2026-10-18

- Initial release of AJxVSCA Tasks.
- Added a sidebar for listing and running workspace tasks from `.vscode/tasks.json`.
- Added task grouping by the `Group: Task` label format and a built-in usage reference.
