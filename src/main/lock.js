"use strict";
// App lock: a PIN/password checked in the main process. Only a salted scrypt hash is
// stored (in its own lock.json, never sent to the renderer). While locked, the main
// process refuses terminal, file and launch IPC, so the lock is not just an overlay.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_PIN = "1001";
const SCRYPT = { N: 16384, r: 8, p: 1 };

class AppLock {
    constructor(dir) {
        this.file = path.join(dir, "lock.json");
        this.failures = 0;
        this.blockedUntil = 0;
        this._load();
        this.unlocked = !this.data.enabled;
    }

    _load() {
        try {
            this.data = JSON.parse(fs.readFileSync(this.file, "utf-8"));
            if (!this.data.hash || !this.data.salt) throw new Error("incomplete");
        } catch (e) {
            this.data = { enabled: true };
            this._setPin(DEFAULT_PIN);
        }
    }

    _save() {
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    }

    _hash(pin, salt) {
        return crypto.scryptSync(String(pin), Buffer.from(salt, "hex"), 32, SCRYPT).toString("hex");
    }

    _setPin(pin) {
        const salt = crypto.randomBytes(16).toString("hex");
        this.data.salt = salt;
        this.data.hash = this._hash(pin, salt);
        this._save();
    }

    _matches(pin) {
        const a = Buffer.from(this._hash(pin, this.data.salt), "hex");
        const b = Buffer.from(this.data.hash, "hex");
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    get enabled() {
        return !!this.data.enabled;
    }

    get locked() {
        return this.enabled && !this.unlocked;
    }

    status() {
        return { enabled: this.enabled, locked: this.locked, waitMs: Math.max(0, this.blockedUntil - Date.now()) };
    }

    /** Check a PIN. After 5 misses each further miss doubles a cool-down (max 5 min). */
    verify(pin) {
        const wait = this.blockedUntil - Date.now();
        if (wait > 0) return { ok: false, waitMs: wait };
        if (this._matches(pin)) {
            this.failures = 0;
            this.unlocked = true;
            return { ok: true };
        }
        this.failures++;
        if (this.failures >= 5) {
            this.blockedUntil = Date.now() + Math.min(300000, 15000 * 2 ** (this.failures - 5));
        }
        return { ok: false, waitMs: Math.max(0, this.blockedUntil - Date.now()), failures: this.failures };
    }

    lock() {
        if (this.enabled) this.unlocked = false;
        return this.status();
    }

    /** Change the PIN (requires the current one). */
    change(current, next) {
        const r = this.verify(current);
        if (!r.ok) return { ok: false, error: r.waitMs ? `Too many attempts, wait ${Math.ceil(r.waitMs / 1000)}s` : "Current password is wrong" };
        next = String(next || "");
        if (next.length < 4 || next.length > 64) return { ok: false, error: "Password must be 4-64 characters" };
        this._setPin(next);
        return { ok: true };
    }

    /** Turn the lock on/off (requires the current PIN). */
    setEnabled(current, enabled) {
        const r = this.verify(current);
        if (!r.ok) return { ok: false, error: r.waitMs ? `Too many attempts, wait ${Math.ceil(r.waitMs / 1000)}s` : "Password is wrong" };
        this.data.enabled = !!enabled;
        this._save();
        this.unlocked = true;
        return { ok: true };
    }
}

module.exports = { AppLock };
