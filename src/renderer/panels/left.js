import { Panel, LineGraph, stat } from "./base.js";
import { h, poll, formatDuration, formatBytes } from "../lib/util.js";
import { store, bus } from "../core/store.js";
import { themes } from "../core/theme.js";

const sys = (fn, ...a) => window.clu.sys.call(fn, ...a);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export class ClockPanel extends Panel {
    constructor(col) {
        super(col, { id: "clock", title: "CLOCK", sub: "" });
        this.digits = h("div.clock-digits");
        this.body.append(this.digits);
        const tick = () => {
            this.render();
            this.timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
        };
        tick();
        this.track(() => clearTimeout(this.timer));
    }

    render() {
        const d = new Date();
        let hh = d.getHours();
        let suffix = "";
        if (store.get("clockHours") === 12) {
            suffix = hh >= 12 ? "PM" : "AM";
            hh = hh % 12 || 12;
        }
        const txt = [hh, d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
        this.digits.replaceChildren(...[...txt].map(c => h(c === ":" ? "em" : "span", c)), suffix ? h("small", suffix) : "");
        this.sub = Intl.DateTimeFormat().resolvedOptions().timeZone.toUpperCase();
    }
}

export class SysinfoPanel extends Panel {
    constructor(col) {
        super(col, { id: "sysinfo", title: "SYSTEM", sub: store.info.hostname.toUpperCase() });
        this.year = stat("2026");
        this.uptime = stat("UPTIME");
        this.type = stat("TYPE", { win32: "win", darwin: "macOS", linux: "linux" }[store.info.platform] || store.info.platform);
        this.power = stat("POWER", "ON");
        this.body.append(h("div.stat-row", this.year.el, this.uptime.el, this.type.el, this.power.el));
        this.track(poll(() => this.update(), 1000));
        this.track(poll(() => this.updatePower(), 10000));
    }

    update() {
        const d = new Date();
        this.year.el.firstChild.textContent = d.getFullYear();
        this.year.set(`${MONTHS[d.getMonth()]} ${d.getDate()}`);
        if (!this._bootAt) {
            sys("time").then(t => { this._bootAt = Date.now() - t.uptime * 1000; });
        } else {
            this.uptime.set(formatDuration((Date.now() - this._bootAt) / 1000));
        }
    }

    async updatePower() {
        const b = await sys("battery");
        if (!b || !b.hasBattery) this.power.set("WIRED");
        else this.power.set(`${Math.round(b.percent)}%${b.isCharging ? " ⚡" : ""}`);
    }
}

export class HardwarePanel extends Panel {
    constructor(col) {
        super(col, { id: "hardware", title: "HARDWARE", sub: "INSPECTOR" });
        this.manufacturer = stat("MANUFACTURER");
        this.model = stat("MODEL");
        this.chassis = stat("CHASSIS");
        this.body.append(h("div.stat-row", this.manufacturer.el, this.model.el, this.chassis.el));
        this.load();
    }

    async load() {
        const [s, c] = await Promise.all([sys("system").catch(() => ({})), sys("chassis").catch(() => ({}))]);
        const clean = v => (v && !/^(default string|to be filled|system product name|o\.e\.m\.|none)/i.test(v) ? v : "");
        this.manufacturer.set(clean(s.manufacturer).split(" ").slice(0, 2).join(" ") || "--");
        this.model.set(clean(s.model) || "--");
        this.chassis.set(clean(c.type) || "--");
    }
}

export class CpuPanel extends Panel {
    constructor(col) {
        super(col, { id: "cpu", title: "CPU USAGE", sub: store.info.cpuModel.replace(/\(R\)|\(TM\)|CPU|Processor|@.*$/gi, "").replace(/\s+/g, " ").trim() });
        this.graphWrap = h("div.cpu-graph");
        this.loadLabel = h("span.cpu-load", "0%");
        this.body.append(h("div.cpu-head", h("span", `${store.info.cpus} THREADS`), this.loadLabel), this.graphWrap);
        this.temp = stat("TEMP");
        this.speed = stat("SPEED");
        this.max = stat("MAX");
        this.tasks = stat("TASKS");
        this.body.append(h("div.stat-row", this.temp.el, this.speed.el, this.max.el, this.tasks.el));

        const cores = Math.min(store.info.cpus, 16);
        const styles = [{ width: 2, alpha: 1 }];
        for (let i = 0; i < cores; i++) styles.push({ width: 1, alpha: 0.22, fill: false });
        this.graph = new LineGraph(this.graphWrap, { points: 60, series: cores + 1, styles, height: "6.5vh" });
        this.cores = cores;

        this.track(poll(() => this.updateLoad(), 1000));
        this.track(poll(() => this.updateSlow(), 4000));
        this.track(bus.on("tasks", n => this.tasks.set(n)));
    }

    async updateLoad() {
        const l = await sys("currentLoad");
        const per = (l.cpus || []).slice(0, this.cores).map(c => c.load);
        this.graph.push(l.currentLoad, ...per);
        this.loadLabel.textContent = `${Math.round(l.currentLoad)}%`;
    }

    async updateSlow() {
        // Most Windows machines expose no temperature sensor without admin rights; stop asking after two misses.
        const wantTemp = (this._tempMisses || 0) < 2;
        const [sp, t] = await Promise.all([sys("cpuCurrentSpeed"), wantTemp ? sys("cpuTemperature").catch(() => null) : null]);
        this.speed.set(sp && sp.avg ? `${sp.avg.toFixed(2)}GHz` : "--");
        this.max.set(sp && sp.max ? `${sp.max.toFixed(2)}GHz` : "--");
        if (t && t.main) this.temp.set(`${Math.round(t.main)}°C`);
        else if (wantTemp) this._tempMisses = (this._tempMisses || 0) + 1;
    }
}

export class RamPanel extends Panel {
    constructor(col) {
        super(col, { id: "ram", title: "MEMORY", sub: "" });
        this.canvas = h("canvas.ram-grid");
        this.swapBar = h("div.bar-fill");
        this.swapText = h("span", "--");
        this.body.append(this.canvas, h("div.bar-row", h("span.bar-label", "SWAP"), h("div.bar", this.swapBar), this.swapText));
        this.ctx = this.canvas.getContext("2d");
        this.mem = null;
        new ResizeObserver(() => this.draw()).observe(this.canvas);
        this.track(themes.on("change", () => this.draw()));
        this.track(poll(() => this.update(), 2000));
    }

    async update() {
        this.mem = await sys("memQuick");
        const m = this.mem;
        this.sub = `USING ${formatBytes(m.total - m.available)} OF ${formatBytes(m.total)}`;
        const swapPct = m.swaptotal ? m.swapused / m.swaptotal * 100 : 0;
        this.swapBar.style.width = swapPct.toFixed(1) + "%";
        this.swapText.textContent = m.swaptotal ? formatBytes(m.swapused) : "N/A";
        this.draw();
    }

    draw() {
        const c = this.canvas, ctx = this.ctx, m = this.mem;
        if (!themes.current) return;
        const dpr = window.devicePixelRatio || 1;
        const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
        if (!W || !H) return;
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        const cols = 40, rows = 10, total = cols * rows;
        const cw = W / cols, ch = H / rows, r = Math.min(cw, ch) * 0.28;
        const [R, G, B] = themes.current.rgb;
        // Each dot is 1/400th of RAM: active (bright), cached/available (dim), free (faint).
        const active = m ? Math.round(m.active / m.total * total) : 0;
        const avail = m ? Math.round((m.total - m.available) / m.total * total) : 0;
        const usedTotal = Math.max(active, avail);
        ctx.clearRect(0, 0, W, H);
        for (let i = 0; i < total; i++) {
            const x = (i % cols) * cw + cw / 2, y = Math.floor(i / cols) * ch + ch / 2;
            const a = i < active ? 1 : i < usedTotal ? 0.45 : 0.12;
            ctx.fillStyle = `rgba(${R},${G},${B},${a})`;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
    }
}

export class TopPanel extends Panel {
    constructor(col, { onOpen }) {
        super(col, { id: "top", title: "TOP PROCESSES", sub: "PID | NAME | CPU | MEM" });
        this.table = h("table.toplist");
        this.body.append(this.table);
        this.el.addEventListener("click", () => onOpen && onOpen());
        this.el.title = "Open process manager";
        this.track(poll(() => this.update(), 4000));
    }

    async update() {
        const p = await sys("topProcesses", 5, store.get("excludeThreadsFromToplist"));
        bus.emit("tasks", p.all);
        this.table.replaceChildren(...p.list.map(x => h("tr",
            h("td", x.pid),
            h("td.name", x.name + (x.count > 1 ? ` ×${x.count}` : "")),
            h("td", `${x.cpu.toFixed(1)}%`),
            h("td", `${x.mem.toFixed(1)}%`)
        )));
    }
}
