import { commands } from "./commands.js";
import { store, bus } from "./store.js";
import { themes } from "./theme.js";
import { audio } from "./audio.js";
import { Panel, LineGraph, stat } from "../panels/base.js";
import { h, poll } from "../lib/util.js";
import { toast } from "../ui/modal.js";

/*
 * Plugins are ES modules in <userData>/plugins/<id>/ with a plugin.json:
 *   { "name": "Pomodoro", "description": "...", "main": "index.js" }
 * The module's default export is called with the plugin API below:
 *   export default function activate(clu) { ... }
 * Plugins run with the same rights as CLU's own UI code - only install ones you trust.
 */

/** `clu <name> ...` subcommands contributed by plugins. */
export const pluginCli = new Map();
export const loaded = [];

function makeApi(plugin, host) {
    const prefix = `plugin.${plugin.id}.`;
    return {
        id: plugin.id,
        h,
        /** Add a command to the palette (optionally with a shortcut such as "Ctrl+Alt+P"). */
        command({ id, title, keys, run }) {
            const cmd = { id: prefix + id, title, keys, run, category: plugin.name };
            commands.register(cmd);
            if (keys) host.addShortcut(cmd);
        },
        /** Add a `clu <name>` subcommand: handler(args[], { cwd, session }). */
        cli(name, handler) {
            name = String(name).toLowerCase();
            if (!/^[a-z][\w-]*$/.test(name)) throw new Error(`invalid command name: ${name}`);
            pluginCli.set(name, { plugin: plugin.id, handler });
        },
        /** Add a panel to the "left" or "right" column; returns { el, body, setSub, onTick(fn, ms) }. */
        panel({ id, title, sub = "", side = "right" }) {
            const col = side === "left" ? host.columns.left : host.columns.right;
            const p = new Panel(col, { id: `${plugin.id}-${id}`, title, sub });
            return {
                el: p.el,
                body: p.body,
                setSub: text => { p.sub = text; },
                every: (fn, ms) => p.track(poll(fn, ms)),
                graph: opts => new LineGraph(p.body, opts),
                stat
            };
        },
        terminal: {
            run: cmd => host.tabs.session && host.tabs.session.run(cmd),
            write: text => host.tabs.session && host.tabs.session.write(text),
            cwd: () => host.tabs.session && host.tabs.session.cwd,
            newTab: opts => host.tabs.add(opts || {}),
            onCommandDone: fn => host.tabs.on("command-done", block => fn({ cmd: block.cmd, ok: block.ok, code: block.code, ms: block.ms })),
            onCwd: fn => host.tabs.on("cwd", cwd => fn(cwd))
        },
        web: url => host.tabs.addWeb({ url }),
        toast: (text, type = "info", ms) => toast(text, type, ms),
        notify: (title, body) => window.clu.win.notify(title, body),
        sound: name => audio.play(name),
        theme: {
            current: () => themes.current && { name: themes.current.name, rgb: themes.current.rgb.slice() },
            onChange: fn => themes.on("change", t => fn({ name: t.name, rgb: t.rgb.slice() }))
        },
        settings: key => store.get(key),
        sys: (fn, ...args) => window.clu.sys.call(fn, ...args),
        on: (event, fn) => bus.on(`plugin:${event}`, fn),
        emit: (event, ...args) => bus.emit(`plugin:${event}`, ...args)
    };
}

export async function loadPlugins(host) {
    if (!store.get("pluginsEnabled")) return [];
    const disabled = new Set(store.get("disabledPlugins") || []);
    let list = [];
    try { list = await window.clu.plugins.list(); } catch (e) { return []; }
    for (const p of list) {
        if (p.error) { toast(`Plugin ${p.id}: ${p.error}`, "warn", 6000); continue; }
        if (disabled.has(p.id)) { loaded.push({ ...p, status: "disabled" }); continue; }
        try {
            const mod = await import(/* @vite-ignore */ `clu-plugin://${p.id}/${p.main}`);
            const activate = mod.default || mod.activate;
            if (typeof activate !== "function") throw new Error("no default export function");
            await activate(makeApi(p, host));
            loaded.push({ ...p, status: "loaded" });
        } catch (e) {
            console.error(`[plugin ${p.id}]`, e);
            loaded.push({ ...p, status: `error: ${e.message}` });
            toast(`Plugin "${p.name}" failed: ${e.message}`, "error", 7000);
        }
    }
    return loaded;
}
