# CLU plugins

A plugin is a folder in `%APPDATA%\CLU\plugins\` (open it with `clu plugins dir`):

```
plugins/
  pomodoro/
    plugin.json   { "name": "Pomodoro", "description": "...", "main": "index.js" }
    index.js      export default function activate(clu) { ... }
```

Copy `pomodoro` from this folder there and run `clu reload`. `clu plugins` lists what loaded.

**Plugins run with the same rights as CLU's own interface code. Only install plugins you trust.**

## API (`clu` argument)

| Call | Does |
|---|---|
| `clu.panel({ id, title, sub, side })` | adds a panel to the `"left"` or `"right"` column. Returns `{ body, setSub(text), every(fn, ms), graph(opts), stat(label) }` |
| `clu.cli(name, (args, { cwd, session }) => ...)` | adds `clu <name> ...` to every terminal |
| `clu.command({ id, title, keys?, run })` | adds a command palette entry, optionally with a shortcut |
| `clu.terminal.run(cmd)` / `.write(text)` / `.cwd()` / `.newTab(opts)` | drive the active terminal |
| `clu.terminal.onCommandDone(({ cmd, ok, code, ms }) => ...)` | react to finished commands |
| `clu.terminal.onCwd(cwd => ...)` | react to directory changes |
| `clu.web(url)` | open a web tab |
| `clu.toast(text, type?, ms?)`, `clu.notify(title, body)`, `clu.sound(name)` | feedback (`granted`, `denied`, `info`, `alarm`, `error`, `scan`...) |
| `clu.theme.current()`, `clu.theme.onChange(fn)` | accent color as `{ name, rgb: [r, g, b] }` |
| `clu.settings(key)` | read a CLU setting |
| `clu.sys(fn, ...args)` | systeminformation calls (`currentLoad`, `mem`, `networkStats`, ...) |
| `clu.on(event, fn)`, `clu.emit(event, ...args)` | events between plugins |
| `clu.h(tag, attrs, ...children)` | tiny element factory used by CLU itself |

Plugins may `fetch()` https URLs and import other files from their own folder with relative paths.
