# Changelog

Notable changes to this project are documented here.

## [Unreleased]

- Added multi-file loading with per-file validation and errors; invalid files are skipped without adding them to the library.
- Automatically open and focus Commands when selecting a shared file or Workspace tasks.
- Show the task filename beside Commands and indicate selected libraries with a check icon instead of Active text.
- Split saved sources and runnable tasks into Task Libraries and Commands panels, with a Workspace tasks row to return to the project.
- Added an inline remove button for saved shared files; removing the active entry returns to workspace tasks without deleting the file.
- Remembered loaded shared files in an expandable list for one-click switching, with the active file marked.
- Kept Load in its normal color and removed the Home toolbar button; use the Workspace tasks row to return to the project.
- Added a clickable shared-source row showing the filename and three parent folders, with the full path on hover.
- Added a file-picker button to load a shared `tasks.json`, remember it per workspace, and watch for changes.
- Added a button to return to workspace tasks; the open-file button now opens the active task file.
- Added shared shell/process task execution with dependency ordering and validation.

## [0.3.5] - 2026-10-19

- Updated the Tasks Activity Bar icon with a transparent background and theme-aware outline.

## [0.3.3] - 2026-10-19

- Added the custom icon to the Tasks Activity Bar view and the extension package.

## [0.3.2] - 2026-10-19

- Version bump only; no user-facing changes.

## [0.3.1] - 2026-10-19

- Name sorting now compares numbers numerically, so numbered labels sort in the expected order (for example, `2` before `10`).

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
