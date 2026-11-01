"use strict";
// Now-playing bridge: one long-lived Windows PowerShell process (src/shell/media.ps1)
// reports the system media session as JSON lines; commands go back over stdin.
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");

const SCRIPT = path.join(__dirname, "..", "shell", "media.ps1").replace("app.asar", "app.asar.unpacked");
const COMMANDS = new Set(["toggle", "play", "pause", "next", "prev"]);

class MediaBridge {
    constructor(send) {
        this.send = send;
        this.proc = null;
        this.restarts = 0;
        this.stopped = true;
    }

    start() {
        if (process.platform !== "win32" || this.proc) return false;
        this.stopped = false;
        const proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT], {
            windowsHide: true, stdio: ["pipe", "pipe", "ignore"]
        });
        this.proc = proc;
        readline.createInterface({ input: proc.stdout }).on("line", line => {
            try {
                this.send("media:state", JSON.parse(line));
                this.restarts = 0;
            } catch (e) { /* partial or non-JSON line */ }
        });
        proc.on("exit", () => {
            if (this.proc === proc) this.proc = null;
            // Crashed (not stopped by us): retry a few times with back-off.
            if (!this.stopped && this.restarts < 5) setTimeout(() => this.start(), 2000 * 2 ** this.restarts++);
        });
        return true;
    }

    command(cmd) {
        if (!COMMANDS.has(cmd) || !this.proc) return false;
        this.proc.stdin.write(cmd + "\n");
        return true;
    }

    stop() {
        this.stopped = true;
        if (this.proc) {
            try { this.proc.stdin.end(); } catch (e) { /* gone */ }
            const p = this.proc;
            setTimeout(() => { try { p.kill(); } catch (e) { /* gone */ } }, 1500);
            this.proc = null;
        }
    }
}

module.exports = { MediaBridge };
