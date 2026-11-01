"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { app } = require("electron");

function detectKeyboard() {
    const locale = (app.getLocale() || "").toLowerCase();
    if (locale.startsWith("tr")) return "tr-TR-Q";
    return "en-US";
}

function defaults() {
    return {
        shell: "auto",
        shellArgs: [],
        cwd: os.homedir(),
        env: {},
        username: "",
        theme: "tron",
        background: "grid",
        accent: "",
        shortcuts: {},
        pinnedApps: [],
        notifyAfterSeconds: 10,
        restoreSession: true,
        autoLockMinutes: 15,
        lockWithWindows: true,
        webHome: "https://duckduckgo.com",
        keyboard: detectKeyboard(),
        showKeyboard: true,
        showFilesystem: true,
        termFontSize: 15,
        termFontFamily: "Fira Code",
        termLineHeight: 1.1,
        cursorStyle: "block",
        cursorBlink: true,
        scrollback: 10000,
        audio: true,
        audioVolume: 0.4,
        feedbackAudio: true,
        clockHours: 24,
        pingAddr: "1.1.1.1",
        geoLookup: true,
        nointro: false,
        fullscreen: true,
        hideDotfiles: false,
        fsListView: false,
        excludeThreadsFromToplist: true,
        confirmOnQuit: false
    };
}

class Settings {
    constructor() {
        this.dir = app.getPath("userData");
        this.file = path.join(this.dir, "settings.json");
        this.themesDir = path.join(this.dir, "themes");
        fs.mkdirSync(this.themesDir, { recursive: true });
        this.data = defaults();
        this.load();
    }

    load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, "utf-8"));
            this.data = Object.assign(defaults(), raw);
        } catch (e) {
            if (e.code !== "ENOENT") console.error("[settings] invalid settings.json, using defaults:", e.message);
            this.save();
        }
        return this.data;
    }

    save() {
        const tmp = this.file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 4));
        fs.renameSync(tmp, this.file);
    }

    set(partial) {
        const known = defaults();
        for (const [k, v] of Object.entries(partial || {})) {
            if (!(k in known)) continue;
            this.data[k] = v;
        }
        this.save();
        return this.data;
    }

    reset() {
        this.data = defaults();
        this.save();
        return this.data;
    }

    userThemes() {
        const out = [];
        for (const f of fs.readdirSync(this.themesDir)) {
            if (!f.endsWith(".json")) continue;
            try {
                const t = JSON.parse(fs.readFileSync(path.join(this.themesDir, f), "utf-8"));
                t.name = t.name || f.slice(0, -5);
                out.push(t);
            } catch (e) {
                console.error(`[settings] skipping bad theme ${f}: ${e.message}`);
            }
        }
        return out;
    }
}

module.exports = { Settings, defaults };
