const { parse, printParseErrorCode } = require('jsonc-parser');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function commandValue(value) {
  return typeof value === 'string'
    || (isObject(value) && typeof value.value === 'string'
      && ['escape', 'strong', 'weak'].includes(value.quoting));
}

async function readSharedTasks(vscode, uri) {
  const errors = [];
  const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  const config = parse(content, errors, { allowTrailingComma: true });
  if (errors.length) {
    throw new Error(`Invalid JSON: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}.`);
  }
  if (!isObject(config) || config.version !== '2.0.0' || !Array.isArray(config.tasks)) {
    throw new Error('Expected a tasks.json with version "2.0.0" and a tasks array.');
  }
  if (config.inputs !== undefined) {
    throw new Error('Shared task files do not support inputs. Use environment or workspace variables instead.');
  }

  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const defaults = { ...config, ...config[platform] };
  const folder = vscode.workspace.workspaceFolders?.[0];
  const tasksByName = new Map();
  const dependencies = new Map();

  const shellValue = value => {
    if (typeof value === 'string') return value;
    return { value: value.value, quoting: vscode.ShellQuoting[value.quoting[0].toUpperCase() + value.quoting.slice(1)] };
  };

  for (const raw of config.tasks) {
    if (!isObject(raw)) throw new Error('Each task must be an object.');
    const entry = { ...defaults, ...raw, ...raw[platform] };
    const label = raw.label;
    if (typeof label !== 'string' || !label.trim() || tasksByName.has(label)) {
      throw new Error('Each shared task must have a unique, non-empty label.');
    }
    const compound = entry.command === undefined && entry.dependsOn !== undefined;
    if ((!compound || entry.type !== undefined) && !['shell', 'process'].includes(entry.type)) {
      throw new Error(`Task "${label}": only shell and process tasks are supported in shared files.`);
    }
    if (!compound && (!commandValue(entry.command)
      || !(typeof entry.command === 'string' ? entry.command : entry.command.value).trim()
      || (entry.type === 'process' && typeof entry.command !== 'string'))) {
      throw new Error(`Task "${label}": a valid ${entry.type} command is required.`);
    }
    const args = entry.args ?? [];
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' && (entry.type === 'process' || !commandValue(arg)))) {
      throw new Error(`Task "${label}": args must be an array of valid command arguments.`);
    }
    const options = {};
    for (const source of [config, config[platform], raw, raw[platform]]) {
      if (source?.options !== undefined && !isObject(source.options)) {
        throw new Error(`Task "${label}": options must be an object.`);
      }
      if (source?.options) {
        if (source.options.cwd !== undefined && typeof source.options.cwd !== 'string') {
          throw new Error(`Task "${label}": options.cwd must be a string.`);
        }
        if (source.options.env !== undefined && (!isObject(source.options.env)
          || Object.values(source.options.env).some(value => typeof value !== 'string'))) {
          throw new Error(`Task "${label}": options.env must be an object with string values.`);
        }
        const env = { ...options.env, ...source.options.env };
        Object.assign(options, source.options);
        if (source.options.env !== undefined) options.env = env;
      }
      if (entry.problemMatcher !== undefined && typeof entry.problemMatcher !== 'string'
        && (!Array.isArray(entry.problemMatcher) || entry.problemMatcher.some(matcher => typeof matcher !== 'string'))) {
        throw new Error(`Task "${label}": shared problemMatcher must be a string or an array of strings.`);
      }
    }
    if (/\$\{input:/.test(JSON.stringify({ command: entry.command, args, options }))) {
      throw new Error(`Task "${label}": input variables are not supported in shared files.`);
    }
    if (options.shell !== undefined) {
      if (!isObject(options.shell) || typeof options.shell.executable !== 'string'
        || (options.shell.args !== undefined && (!Array.isArray(options.shell.args)
          || options.shell.args.some(arg => typeof arg !== 'string')))) {
        throw new Error(`Task "${label}": options.shell requires an executable and optional string args.`);
      }
      options.executable = options.shell.executable;
      options.shellArgs = options.shell.args;
      delete options.shell;
    }
    if (!folder && options.cwd === undefined) options.cwd = vscode.Uri.joinPath(uri, '..').fsPath;
    const execution = compound ? undefined : entry.type === 'shell'
      ? args.length
        ? new vscode.ShellExecution(shellValue(entry.command), args.map(shellValue), options)
        : typeof entry.command === 'string'
          ? new vscode.ShellExecution(entry.command, options)
          : new vscode.ShellExecution(shellValue(entry.command), [], options)
      : new vscode.ProcessExecution(entry.command, args, options);
    const task = new vscode.Task(
      { type: 'taskAccordion.shared', path: uri.toString(), label },
      folder || vscode.TaskScope.Global,
      label,
      'Shared library',
      execution,
      typeof entry.problemMatcher === 'string' ? [entry.problemMatcher] : entry.problemMatcher ?? []
    );
    task.detail = entry.detail;
    task.isBackground = entry.isBackground === true;
    task.presentationOptions = entry.presentation;
    task.runOptions = entry.runOptions;
    const group = typeof entry.group === 'string' ? entry.group : entry.group?.kind;
    if (group !== undefined) {
      if (!['build', 'test'].includes(group)) throw new Error(`Task "${label}": unsupported task group "${group}".`);
      task.group = group === 'build' ? vscode.TaskGroup.Build : vscode.TaskGroup.Test;
    }
    const dependsOn = entry.dependsOn === undefined ? [] : typeof entry.dependsOn === 'string' ? [entry.dependsOn] : entry.dependsOn;
    if (!Array.isArray(dependsOn) || dependsOn.some(name => typeof name !== 'string')) {
      throw new Error(`Task "${label}": dependsOn must be a label or an array of labels.`);
    }
    if (compound && !dependsOn.length) throw new Error(`Task "${label}": a command or at least one dependency is required.`);
    if (entry.dependsOrder !== undefined && !['parallel', 'sequence'].includes(entry.dependsOrder)) {
      throw new Error(`Task "${label}": dependsOrder must be "parallel" or "sequence".`);
    }
    dependencies.set(task, { names: dependsOn, order: entry.dependsOrder || 'parallel', execute: !compound });
    tasksByName.set(label, task);
  }

  const visited = new Set();
  const visiting = new Set();
  const visit = task => {
    if (visiting.has(task)) throw new Error(`Circular dependency involving task "${task.name}".`);
    if (visited.has(task)) return;
    visiting.add(task);
    const dependency = dependencies.get(task);
    dependency.tasks = dependency.names.map(name => {
      const target = tasksByName.get(name);
      if (!target) throw new Error(`Task "${task.name}": dependency "${name}" was not found in the shared file.`);
      visit(target);
      return target;
    });
    visiting.delete(task);
    visited.add(task);
  };
  for (const task of tasksByName.values()) visit(task);
  return { tasks: [...tasksByName.values()], dependencies };
}

async function runSharedTask(task, dependencies, runTaskAndWait, running = new Map()) {
  if (running.has(task)) return running.get(task);
  const completion = (async () => {
    const dependency = dependencies.get(task);
    if (dependency.order === 'sequence') {
      for (const child of dependency.tasks) await runSharedTask(child, dependencies, runTaskAndWait, running);
    } else {
      await Promise.all(dependency.tasks.map(child => runSharedTask(child, dependencies, runTaskAndWait, running)));
    }
    if (dependency.execute) await runTaskAndWait(task);
  })();
  running.set(task, completion);
  return completion;
}

module.exports = { readSharedTasks, runSharedTask };
