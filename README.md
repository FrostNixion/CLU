# CLU

A sci-fi terminal desktop environment for Windows (and Linux/macOS), inspired by
[eDEX-UI](https://github.com/GitSquared/edex-ui) and rebuilt from scratch on a modern, secure,
fast stack. **Command line first, app when you need it**: everything is reachable from the
terminal (`clu ...`), from the keyboard, from the command palette or with the mouse.

```
┌ SYSTEM ────┐┌ TERMINAL (tabs · split panes · web tabs · pinned apps) ┐┌ NETWORK ───┐
│ clock      ││                                                        ││ status     │
│ system     ││   PowerShell / cmd / bash / wsl ...                    ││ globe      │
│ hardware   ││   ✓ 1.2s  command blocks with status and duration      ││ traffic    │
│ cpu        ││                                                        ││ now playing│
│ memory     ││                                                        ││ storage    │
│ processes  │└────────────────────────────────────────────────────────┘└────────────┘
┌ FILESYSTEM (follows the shell's cwd) ─┐┌ ON-SCREEN KEYBOARD ─────────────────────────┐
└───────────────────────────────────────┘└─────────────────────────────────────────────┘
```

## Run

```bash
npm install
npm start          # fullscreen, with boot sequence
npm run dev        # windowed, skips the intro
npm test           # end-to-end smoke tests against a throwaway profile
npm run dist       # Windows installer in release/
npm run dist:dir   # unpacked build: release/win-unpacked/CLU.exe
```

Flags: `--windowed`, `--nointro`, `--devtools`.
Inside the app: **F11** toggles fullscreen, **Ctrl+Shift+Q** quits. Default password: **1001**.

## The `clu` command

Every shell started by CLU gets a `clu` command that drives the UI (`clu help` lists it all).

**Look**

| Command | Does |
|---|---|
| `clu theme [name\|next\|prev\|list]` | switch theme (no name = live-preview picker) |
| `clu bg [name\|next\|prev\|list]` | background: `grid` `dots` `hex` `circuit` `scanlines` `rain` `none` |
| `clu accent [color\|next\|reset\|list]` | accent color: preset (`cyan` `amber` `pink`…), `ff8800` or `255,136,0` (in PowerShell, `#` starts a comment, so omit it) |
| `clu font <size>`, `clu zen`, `clu fullscreen` | font size, focus mode, fullscreen |

**Files**

| Command | Does |
|---|---|
| `clu open <file>` | view inside CLU: image, video, audio, PDF, text |
| `clu edit <file>` | built-in text editor (Ctrl+S saves) |
| `clu x <file\|url>` | open with the system default app |
| `clu fs [path]` | point the file browser somewhere (no path = follow the shell again) |

**Apps, web, media**

| Command | Does |
|---|---|
| `clu app [name]` | launch an installed app (Start menu, incl. Store apps) |
| `clu pin <app\|url> [name]` / `clu unpin <name>` | pin an app (`clu pin spotify`) or site (`clu pin youtube.com`) to the tab bar |
| `clu web [url\|search]` | browser tab inside CLU |
| `clu play` / `pause` / `next` / `prev` | control whatever media Windows is playing |

**Terminal & system**

| Command | Does |
|---|---|
| `clu tab [command]` | new tab in the current directory, optionally running a command |
| `clu split [right\|down]` | split the current pane |
| `clu copy` | copy the last command's output |
| `clu run <command>` | type a command into the active terminal (useful with `bind`) |
| `clu top` | process manager (filter, sort, kill) |
| `clu notify <text>`, `clu kb [...]`, `clu sound [on\|off]` | notification, on-screen keyboard, sound |

**AI**

| Command | Does |
|---|---|
| `clu ask <question>` | ask Claude; answers stream in with Run / Insert / Copy on each command |
| `clu ai explain` | explain the last command (or use "Explain & fix with AI" on a block's badge) |
| `clu ai key` / `clu ai forget` | store / remove your Anthropic API key |

**Shortcuts, security, app**

| Command | Does |
|---|---|
| `clu bind <keys> <command>` / `clu unbind <keys>` | your own shortcuts, e.g. `clu bind Ctrl+Alt+M theme matrix` |
| `clu lock`, `clu password [on\|off]` | lock now, change the password, turn the lock on/off |
| `clu plugins [dir\|reload]` | installed plugins, plugins folder |
| `clu settings`, `clu palette`, `clu keys`, `clu reload`, `clu quit` | |

How it works: `clu` prints a private OSC escape sequence (`ESC ] 7777 ; <base64 json> BEL`) that
the terminal intercepts. Commands carry a per-session token, so a program that merely *prints*
the sequence (e.g. `cat` of a crafted file) cannot drive the UI.

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+Shift+P | command palette (every action lives here) |
| Ctrl+Shift+T / Ctrl+Shift+W | new tab / close pane or tab |
| Alt+Shift+= / Alt+Shift+- | split right / split down |
| Ctrl+Alt+Arrows | move between panes (drag the divider to resize) |
| Ctrl+Tab, Ctrl+Shift+Tab, Alt+1…9 | switch tabs |
| Ctrl+Shift+Up / Down | jump to previous / next command |
| Ctrl+Alt+C | copy last command output |
| Ctrl+C (with selection) / Ctrl+V | copy / paste (also Ctrl+Shift+C/V, right click) |
| Ctrl+Shift+F | find in terminal |
| Ctrl+Shift+Space / Ctrl+Alt+E | ask Claude / explain last command |
| Ctrl+Shift+N / Ctrl+Shift+D | new web tab / launch app |
| Ctrl+Shift+O | fuzzy-find a file in the current folder |
| Ctrl+= / Ctrl+- / Ctrl+0 | font size |
| Ctrl+Shift+Y / Ctrl+Shift+J | theme picker / next theme |
| Ctrl+Shift+G / Ctrl+Alt+G | next / previous background design |
| Ctrl+Shift+U / Ctrl+Alt+U | next / previous accent color |
| Ctrl+Shift+B / E | toggle keyboard / file browser |
| Ctrl+Shift+Enter | focus mode (terminal only) |
| Ctrl+Shift+M | process manager |
| Ctrl+Alt+L | lock |
| Ctrl+, / Ctrl+Shift+K | settings / all shortcuts |

## Features in more detail

- **Command blocks.** The shell reports every prompt with the previous command's text, exit code and
  duration. Each finished command gets a `✓ 1.2s` / `✗ 1 · 3.4s` badge (click: copy command, copy
  output, run again, explain with AI) and a mark in the scrollbar. Commands longer than
  `notifyAfterSeconds` (default 10) play a sound and notify you if you are looking elsewhere.
- **Split panes** in any terminal tab, nested, resizable, up to 6 per tab.
- **Session restore.** Tabs, pane layout, directories, web tabs and the last 1000 lines of each
  terminal are saved (every 30 s and on exit) and restored on start; old output is above the divider.
- **Tab bar apps.** `+` opens a terminal, `▾` opens a menu (web tab, launch / pin app, pin page).
  Pinned apps show their real icons. Native apps (Opera, Spotify...) open in their own window -
  Windows does not allow embedding them reliably. Websites open as real tabs inside CLU, in a
  separate locked-down session. DRM players (Spotify Web, Netflix) cannot play inside Electron
  (no Widevine), so pin their desktop apps instead.
- **Now playing** panel fed by Windows' media session: Spotify, browsers and players, with controls.
- **AI assistant** (Claude Opus 5.5, streamed). It sees your shell, OS, directory and the last
  command's output (last 150 lines), and answers with runnable command blocks. Nothing runs
  without you clicking Run. Server-side fallback is enabled, so a request a safety classifier
  declines is retried on a fallback model. The API key is stored encrypted with Windows data
  protection (`%APPDATA%\CLU\ai.json`); `ANTHROPIC_API_KEY` also works.
- **App lock.** Password at startup (default `1001`), auto-lock after `autoLockMinutes` of
  system-wide idle (default 15) and when Windows locks. Only a salted scrypt hash is stored
  (`%APPDATA%\CLU\lock.json`); while locked the main process refuses terminal, file, clipboard,
  launch, session and AI requests; 5 wrong attempts start a growing cool-down. It is an
  application lock, not disk encryption. Forgot it? Delete `lock.json` (resets to `1001`).
- **Plugins.** ES modules in `%APPDATA%\CLU\plugins\` can add panels, `clu` subcommands, palette
  commands and shortcuts. See [examples/plugins](examples/plugins) (a Pomodoro timer).
  Plugins run with CLU's own rights: install only plugins you trust.
- **File browser** follows the shell: click a folder to `cd`, a file to open it in CLU,
  right-click to open with the system, middle-click to paste its path.

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
| Main process | `src/main/main.js` | window, IPC (gated by the app lock), `clu-file://` media protocol with Range support, `clu-plugin://`, auto-lock, session file |
| PTY manager | `src/main/pty.js` | node-pty (ConPTY DLL on Windows); output coalesced every 5 ms; flow control with watermarks |
| System info | `src/main/sysinfo-worker.js` | `systeminformation` in an Electron **utility process**, so slow WMI/PowerShell calls never block the UI |
| Apps / media | `src/main/apps.js`, `src/main/media.js`, `src/shell/media.ps1` | Start-menu discovery and icons; a persistent PowerShell bridge to the Windows media session |
| AI | `src/main/ai.js` | `@anthropic-ai/sdk`, streaming, encrypted key storage |
| Lock | `src/main/lock.js` | scrypt-hashed password, cool-down |
| Preload | `src/preload/preload.js` | the only bridge; `contextIsolation`, `sandbox`, no `nodeIntegration` |
| Shell integration | `src/shell/` | reports cwd and each command's result every prompt (PowerShell, cmd, bash, zsh) and defines `clu` |
| Renderer | `src/renderer/` | ES modules bundled by esbuild: xterm.js 6 + WebGL, panels on `<canvas>`, WebAudio-synthesized sounds |
| Tests | `tests/` | `npm test` launches CLU with a temporary profile and runs suites inside the renderer |

Licensing: CLU is an independent re-implementation; no eDEX-UI code or assets are included.
Fonts: Fira Code and Rajdhani (SIL Open Font License). World map: Natural Earth via `world-atlas`.
