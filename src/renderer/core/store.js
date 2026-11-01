import { Emitter } from "../lib/util.js";

// Central app state. Settings changes go through `update` so every module
// (terminal, panels, audio, keyboard) can react live without a reload.
class Store extends Emitter {
    constructor() {
        super();
        this.settings = {};
        this.info = {};
    }

    async init() {
        [this.info, this.settings] = await Promise.all([window.clu.info(), window.clu.settings.get()]);
    }

    get(key) {
        return this.settings[key];
    }

    async update(partial) {
        const prev = { ...this.settings };
        this.settings = await window.clu.settings.set(partial);
        const changed = Object.keys(partial).filter(k => JSON.stringify(prev[k]) !== JSON.stringify(this.settings[k]));
        for (const k of changed) this.emit(`change:${k}`, this.settings[k], prev[k]);
        if (changed.length) this.emit("change", changed);
        return this.settings;
    }
}

export const store = new Store();
export const bus = new Emitter();
