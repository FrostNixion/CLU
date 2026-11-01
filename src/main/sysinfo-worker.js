"use strict";
// Runs in an Electron utility process so slow systeminformation calls
// (many spawn PowerShell/WMI on Windows) never block the main or renderer threads.
const os = require("os");
const si = require("systeminformation");

// Note: si.powerShellStart() (persistent PowerShell) is deliberately not used:
// on Windows it deadlocks inside processes() and stalls every queued call behind it.

let swapCache = { at: 0, swaptotal: 0, swapused: 0 };

const ALLOWED = new Set([
    "system", "chassis", "osInfo", "cpu", "cpuCurrentSpeed", "cpuTemperature", "currentLoad",
    "mem", "battery", "graphics", "processes", "networkInterfaces", "networkInterfaceDefault",
    "networkStats", "networkConnections", "inetLatency", "fsSize", "blockDevices", "time",
    "users", "diskLayout", "wifiNetworks", "fsStats", "disksIO", "versions", "uuid"
]);

// Derived calls: trim the (large) process list here instead of shipping it all over IPC.
const DERIVED = {
    // si.mem() spawns PowerShell on Windows (for swap). RAM itself is available natively,
    // so poll that cheaply and refresh swap only every 15s.
    async memQuick() {
        if (process.platform !== "win32") return si.mem();
        if (Date.now() - swapCache.at > 15000) {
            const m = await si.mem();
            swapCache = { at: Date.now(), swaptotal: m.swaptotal, swapused: m.swapused };
        }
        const total = os.totalmem(), available = os.freemem();
        return { total, available, free: available, active: total - available, used: total - available, swaptotal: swapCache.swaptotal, swapused: swapCache.swapused };
    },
    async topProcesses(limit = 6, excludeThreads = true) {
        const p = await si.processes();
        // The idle pseudo-process "uses" all free CPU; it would always top the list.
        let list = p.list.filter(x => x.pid !== 0 && x.name !== "System Idle Process");
        if (excludeThreads) {
            // Merge entries of the same program (e.g. dozens of browser/helper processes).
            const byName = new Map();
            for (const proc of list) {
                const cur = byName.get(proc.name);
                if (cur) {
                    cur.cpu += proc.cpu;
                    cur.mem += proc.mem;
                    cur.count++;
                } else {
                    byName.set(proc.name, { pid: proc.pid, name: proc.name, cpu: proc.cpu, mem: proc.mem, count: 1 });
                }
            }
            list = [...byName.values()];
        }
        list.sort((a, b) => (b.cpu - a.cpu) || (b.mem - a.mem));
        return {
            all: p.all, running: p.running, blocked: p.blocked, sleeping: p.sleeping,
            list: list.slice(0, limit).map(x => ({ pid: x.pid, name: x.name, cpu: x.cpu, mem: x.mem, count: x.count || 1 }))
        };
    },
    async processList() {
        const p = await si.processes();
        return p.list.map(x => ({
            pid: x.pid, parentPid: x.parentPid, name: x.name, cpu: x.cpu, mem: x.mem,
            memRss: x.memRss, started: x.started, state: x.state, user: x.user, command: x.command, path: x.path
        }));
    }
};

process.parentPort.on("message", async ({ data }) => {
    const { id, fn, args } = data;
    if (DERIVED[fn]) {
        try {
            process.parentPort.postMessage({ id, result: await DERIVED[fn](...(args || [])) });
        } catch (e) {
            process.parentPort.postMessage({ id, error: String(e && e.message || e) });
        }
        return;
    }
    if (!ALLOWED.has(fn)) {
        process.parentPort.postMessage({ id, error: `sysinfo: '${fn}' is not allowed` });
        return;
    }
    try {
        const result = fn === "time" ? si.time() : await si[fn](...(args || []));
        process.parentPort.postMessage({ id, result });
    } catch (e) {
        process.parentPort.postMessage({ id, error: String(e && e.message || e) });
    }
});
