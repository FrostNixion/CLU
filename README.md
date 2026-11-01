# CLU

A sci-fi terminal desktop environment for Windows (and Linux/macOS), inspired by
[eDEX-UI](https://github.com/GitSquared/edex-ui) and rebuilt from scratch on a modern, secure,
fast stack. **Command line first, app when you need it**: everything is reachable from the
terminal (`clu ...`), from the keyboard, from the command palette or with the mouse.

```
┌ SYSTEM ────┐┌ TERMINAL (tabs) ───────────────────────┐┌ NETWORK ───┐
│ clock      ││                                        ││ status     │
│ system     ││   PowerShell / cmd / bash / wsl ...    ││ globe      │
│ hardware   ││                                        ││ traffic    │
│ cpu        ││                                        ││ storage    │
│ memory     ││                                        ││            │
│ processes  │└────────────────────────────────────────┘└────────────┘
┌ FILESYSTEM (follows the shell's cwd) ─┐┌ ON-SCREEN KEYBOARD ───────────┐
└───────────────────────────────────────┘└───────────────────────────────┘
```

## Run

```bash
npm install
npm start          # fullscreen, with boot sequence
npm run dev        # windowed, skips the intro
npm run dist       # Windows installer in release/
```

Flags: `--windowed`, `--nointro`, `--devtools`.
Inside the app: **F11** toggles fullscreen, **Ctrl+Shift+Q** quits.

## The `clu` command

Every shell started by CLU gets a `clu` command that drives the UI:

| Command | Does |
|---|---|
| `clu help` | list commands |
| `clu theme [name\|next\|prev\|list]` | switch theme (no name = live-preview picker) |
| `clu bg [name\|next\|prev\|list]` | background design: `grid` `dots` `hex` `circuit` `scanlines` `rain` `none` |
| `clu accent [color\|next\|reset\|list]` | accent color: preset (`cyan` `amber` `pink`…), `ff8800` or `255,136,0` (in PowerShell write hex without `#`, it starts a comment) |
| `clu bind <keys> <command>` | your own shortcut, e.g. `clu bind Ctrl+Alt+M theme matrix` |
| `clu unbind <keys>` | remove it |
| `clu run <command>` | type a command into the active tab (useful with `bind`) |
| `clu app [name]` | launch an installed app (Start menu, incl. Store apps); no name = searchable list |
| `clu pin <app\|url> [name]` | pin an app (`clu pin spotify`) or a site (`clu pin youtube.com`) to the tab bar |
| `clu unpin <name>` | remove a pin |
| `clu web [url\|search]` | browser tab inside CLU |
| `clu lock` | lock CLU now (Ctrl+Alt+L) |
| `clu password [on\|off]` | change the startup password / turn the lock on or off |

**App lock:** CLU asks for a password at startup (default `1001`, change it with `clu password`).
Only a salted scrypt hash is stored, in `%APPDATA%\CLU\lock.json`. While locked, the main process
refuses terminal, file, clipboard and launch requests; 5 wrong attempts start a growing cool-down.
It is an application lock, not disk encryption.
| `clu open <file>` | view inside CLU: image, video, audio, PDF, text |
| `clu edit <file>` | built-in text editor (Ctrl+S saves) |
| `clu x <file\|url>` | open with the system default app |
| `clu fs [path]` | point the file browser somewhere (no path = follow the shell again) |
| `clu tab [command]` | new tab in the current directory, optionally running a command |
| `clu kb [on\|off\|en-US\|tr-TR-Q]` | on-screen keyboard |
| `clu top` | process manager (filter, sort, kill) |
| `clu notify <text>` | toast + system notification |
| `clu font <size>`, `clu sound [on\|off]` | quick settings |
| `clu settings`, `clu palette`, `clu keys`, `clu zen`, `clu fullscreen`, `clu reload`, `clu quit` | |

It works by printing a private OSC escape sequence (`ESC ] 7777 ; <base64 json> BEL`) that the
terminal intercepts. Commands carry a per-session token, so a program that merely *prints*
the sequence (e.g. `cat` of a crafted file) cannot drive the UI.

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+Shift+P | command palette (every action lives here) |
| Ctrl+Shift+T / W | new / close tab |
| Ctrl+Tab, Ctrl+Shift+Tab, Alt+1…9 | switch tabs |
| Ctrl+C (with selection) / Ctrl+V | copy / paste (also Ctrl+Shift+C/V, right click) |
| Ctrl+Shift+F | find in terminal |
| Ctrl+Shift+O | fuzzy-find a file in the current folder |
| Ctrl+= / Ctrl+- / Ctrl+0 | font size |
| Ctrl+Shift+Y | theme picker |
| Ctrl+Shift+J | next theme |
| Ctrl+Shift+G / Ctrl+Alt+G | next / previous background design |
| Ctrl+Shift+U / Ctrl+Alt+U | next / previous accent color |
| Ctrl+Shift+B / E | toggle keyboard / file browser |
| Ctrl+Shift+Enter | focus mode (terminal only) |
| Ctrl+Shift+M | process manager |
| Ctrl+, | settings |
| Ctrl+Shift+K | all shortcuts |

Tab bar: `+` opens a terminal, `▾` opens a menu (new web tab, launch app, pin app, pin current page, unpin).
Pinned apps appear as icons next to it; click to launch, right-click to unpin.
Native apps (Opera, Spotify, ...) open in their own window: Windows does not allow embedding them reliably.
Websites open as real tabs inside CLU (separate locked-down session, logins persist). DRM-protected players
such as Spotify Web or Netflix cannot play inside Electron (no Widevine), so pin their desktop apps instead.
New shortcuts: Ctrl+Shift+N web tab, Ctrl+Shift+D launch app.

File browser: click a folder to `cd` the shell into it, click a file to open it in CLU,
right-click to open with the system, middle-click to paste its path into the terminal.

## Themes

Built in: `tron`, `matrix`, `blade`, `red`, `apollo`, `interstellar`, `cyborg`, `synthwave`, `nord`.
Drop your own JSON into `%APPDATA%\CLU\themes\` (button in Settings), e.g.:

```json
{
  "description": "my theme",
  "rgb": [255, 170, 0],
  "colors": { "light_black": "#0a0700", "grey": "#2a2000" },
  "terminal": { "foreground": "#ffcc66", "background": "#0a0700",
                "ansi": { "red": "#ff5555" } },
  "font": { "main": "Rajdhani", "mono": "Fira Code" },
  "css": "/* optional extra CSS */"
}
```

Settings live in `%APPDATA%\CLU\settings.json` and can be edited in-app (Ctrl+,); changes apply live.

## Architecture

| Piece | Where | Notes |
|---|---|---|
| Main process | `src/main/main.js` | window, IPC, `clu-file://` protocol (with HTTP Range for media seeking), fs helpers |
| PTY manager | `src/main/pty.js` | node-pty (ConPTY DLL on Windows); output coalesced every 5 ms; flow control with watermarks (renderer acks bytes it has drawn) |
| System info | `src/main/sysinfo-worker.js` | `systeminformation` in an Electron **utility process**, so slow WMI/PowerShell calls never block UI or terminal |
| Preload | `src/preload/preload.js` | the only bridge; `contextIsolation`, `sandbox`, no `nodeIntegration`, no `@electron/remote` |
| Shell integration | `src/shell/` | reports the cwd every prompt (OSC 7 / OSC 7777) for PowerShell, cmd, bash, zsh and defines `clu` |
| Renderer | `src/renderer/` | plain ES modules bundled by esbuild: xterm.js 6 + WebGL, panels on `<canvas>`, WebAudio-synthesized sound effects (no sample files) |

Differences from eDEX-UI worth knowing:

- no WebSocket server per terminal (eDEX opened TCP ports 3000+); data goes over IPC
- unlimited-ish tabs (12) instead of 5, renameable, inherit the current directory
- cwd tracking works on Windows (eDEX could only do Linux/macOS)
- settings and themes switch live, no reload
- the globe is a pre-baked dot lattice projected on a 2D canvas (~1% CPU), not a 1 MB WebGL lib
- Turkish Q on-screen keyboard; keys are mapped by physical position so they light up whatever the OS layout

Licensing: CLU is an independent re-implementation; no eDEX-UI code or assets are included.
Fonts: Fira Code and Rajdhani (SIL Open Font License). World map: Natural Earth via `world-atlas`.
