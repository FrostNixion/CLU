"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const pty = require("node-pty");

// Output is coalesced before crossing IPC: a burst of tiny writes (e.g. `dir /s`)
// becomes a few large messages instead of thousands of small ones.
const FLUSH_INTERVAL_MS = 5;
const FLUSH_MAX_BYTES = 256 * 1024;
// Flow control: pause the pty when the renderer falls this far behind, resume once it catches up.
const HIGH_WATERMARK = 2 * 1024 * 1024;
const LOW_WATERMARK = 512 * 1024;

const SHELL_DIR = path.join(__dirname, "..", "shell").replace("app.asar", "app.asar.unpacked");
const BIN_DIR = path.join(SHELL_DIR, "bin");

// Shared secret given to shells we spawn; `clu` commands must carry it so that
// arbitrary program output (e.g. `cat`-ing a crafted file) cannot drive the UI.
const TOKEN = crypto.randomBytes(16).toString("hex");

function findInPath(exe) {
    const dirs = (process.env.PATH || "").split(path.delimiter);
    for (const d of dirs) {
        if (!d) continue;
        const p = path.join(d, exe);
        try {
            if (fs.statSync(p).isFile()) return p;
        } catch (e) { /* not here */ }
    }
    return null;
}

function resolveShell(setting) {
    if (setting && setting !== "auto") {
        if (path.isAbsolute(setting)) return setting;
        return findInPath(setting) || findInPath(setting + (process.platform === "win32" ? ".exe" : "")) || setting;
    }
    if (process.platform === "win32") {
        return findInPath("pwsh.exe") || findInPath("powershell.exe") || "powershell.exe";
    }
    return process.env.SHELL || findInPath("bash") || "/bin/sh";
}

function shellKind(shell) {
    const base = path.basename(shell).toLowerCase().replace(/\.exe$/, "");
    if (base === "pwsh" || base === "powershell") return "powershell";
    if (base === "cmd") return "cmd";
    if (base === "bash") return "bash";
    if (base === "zsh") return "zsh";
    return "other";
}

// The help text is inlined as a function so it works under a Restricted execution policy.
function psIntegration() {
    const help = fs.readFileSync(path.join(BIN_DIR, "clu-help.ps1"), "utf-8");
    const main = fs.readFileSync(path.join(SHELL_DIR, "clu-integration.ps1"), "utf-8");
    return `function global:__clu_help {\n${help}\n}\n${main}`;
}

function buildLaunch(shell, userArgs) {
    const kind = shellKind(shell);
    const args = Array.isArray(userArgs) ? userArgs.slice() : String(userArgs || "").split(" ").filter(Boolean);
    const env = {};

    switch (kind) {
        case "powershell": {
            const encoded = Buffer.from(psIntegration(), "utf16le").toString("base64");
            args.push("-NoLogo", "-NoExit", "-EncodedCommand", encoded);
            break;
        }
        case "cmd":
            // OSC 7 with the current path, emitted with every prompt.
            env.PROMPT = "$e]7;file:///$P$e\\$P$G";
            break;
        case "bash":
            if (!args.length) args.push("--rcfile", path.join(SHELL_DIR, "clu-integration.bash"), "-i");
            break;
        case "zsh":
            env.CLU_ORIG_ZDOTDIR = process.env.ZDOTDIR || os.homedir();
            env.ZDOTDIR = path.join(SHELL_DIR, "zsh");
            if (!args.length) args.push("-i");
            break;
        default:
            if (!args.length && process.platform !== "win32") args.push("--login");
    }
    return { args, env, kind };
}

class PtyManager {
    constructor(send) {
        this.send = send;
        this.ptys = new Map();
        this.nextId = 1;
        this.cleanEnv = Object.assign({}, process.env);
        for (const k of ["http_proxy", "https_proxy", "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE"]) delete this.cleanEnv[k];
    }

    create({ shell, shellArgs, cwd, env, cols, rows }) {
        const shellPath = resolveShell(shell);
        const launch = buildLaunch(shellPath, shellArgs);
        let startCwd = cwd;
        try {
            if (!startCwd || !fs.statSync(startCwd).isDirectory()) startCwd = os.homedir();
        } catch (e) {
            startCwd = os.homedir();
        }

        const fullEnv = Object.assign({}, this.cleanEnv, launch.env, env || {}, {
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            TERM_PROGRAM: "CLU",
            TERM_PROGRAM_VERSION: require("../../package.json").version,
            CLU: "1",
            CLU_TOKEN: TOKEN,
            CLU_BIN: BIN_DIR
        });
        const pathKey = Object.keys(fullEnv).find(k => k.toUpperCase() === "PATH") || "PATH";
        fullEnv[pathKey] = BIN_DIR + path.delimiter + (fullEnv[pathKey] || "");

        const proc = pty.spawn(shellPath, launch.args, {
            name: "xterm-256color",
            cols: cols || 80,
            rows: rows || 24,
            cwd: startCwd,
            env: fullEnv,
            useConpty: true,
            useConptyDll: true
        });

        const id = this.nextId++;
        const entry = { id, proc, shell: shellPath, kind: launch.kind, buf: "", timer: null, unacked: 0, paused: false, lastProcess: "" };
        this.ptys.set(id, entry);

        proc.onData(data => {
            entry.buf += data;
            if (entry.buf.length >= FLUSH_MAX_BYTES) {
                this._flush(entry);
            } else if (!entry.timer) {
                entry.timer = setTimeout(() => this._flush(entry), FLUSH_INTERVAL_MS);
            }
        });
        proc.onExit(({ exitCode, signal }) => {
            this._flush(entry);
            this.ptys.delete(id);
            this.send("pty:exit", id, exitCode, signal);
        });

        return { id, pid: proc.pid, shell: shellPath, kind: launch.kind, cwd: startCwd };
    }

    _flush(entry) {
        if (entry.timer) {
            clearTimeout(entry.timer);
            entry.timer = null;
        }
        if (!entry.buf) return;
        const data = entry.buf;
        entry.buf = "";
        entry.unacked += data.length;
        this.send("pty:data", entry.id, data);
        if (!entry.paused && entry.unacked > HIGH_WATERMARK) {
            entry.paused = true;
            try { entry.proc.pause(); } catch (e) { /* exited */ }
        }
    }

    ack(id, bytes) {
        const entry = this.ptys.get(id);
        if (!entry) return;
        entry.unacked = Math.max(0, entry.unacked - bytes);
        if (entry.paused && entry.unacked < LOW_WATERMARK) {
            entry.paused = false;
            try { entry.proc.resume(); } catch (e) { /* exited */ }
        }
    }

    write(id, data) {
        const entry = this.ptys.get(id);
        if (entry) entry.proc.write(data);
    }

    resize(id, cols, rows) {
        const entry = this.ptys.get(id);
        if (!entry || !(cols > 0) || !(rows > 0)) return;
        try { entry.proc.resize(cols, rows); } catch (e) { /* racing with exit */ }
    }

    kill(id) {
        const entry = this.ptys.get(id);
        if (!entry) return;
        try { entry.proc.kill(); } catch (e) { /* already gone */ }
    }

    // Foreground process name (meaningful on unix; on Windows node-pty reports the shell).
    processName(id) {
        const entry = this.ptys.get(id);
        if (!entry) return null;
        try { return entry.proc.process; } catch (e) { return null; }
    }

    killAll() {
        for (const id of [...this.ptys.keys()]) this.kill(id);
    }
}

module.exports = { PtyManager, TOKEN, resolveShell, BIN_DIR };
