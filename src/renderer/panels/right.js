import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import land110 from "world-atlas/land-110m.json";
import { Panel, LineGraph, stat } from "./base.js";
import { h, poll, formatBytes } from "../lib/util.js";
import { store, bus } from "../core/store.js";
import { themes } from "../core/theme.js";

const sys = (fn, ...a) => window.clu.sys.call(fn, ...a);

export class NetworkPanel extends Panel {
    constructor(col) {
        super(col, { id: "network", title: "NETWORK STATUS", sub: "" });
        this.state = stat("STATE");
        this.ipv4 = stat("IPv4");
        this.ping = stat("PING");
        this.pub = stat("PUBLIC IP");
        this.loc = stat("LOCATION");
        this.pub.el.classList.add("grow");
        this.body.append(h("div.stat-row", this.state.el, this.ipv4.el, this.ping.el), h("div.stat-row", this.pub.el, this.loc.el));
        this.iface = null;
        this.track(poll(() => this.updateIface(), 15000));
        this.track(poll(() => this.updatePing(), 5000));
        this.track(poll(() => this.updateGeo(), 15 * 60 * 1000));
    }

    async updateIface() {
        const name = await sys("networkInterfaceDefault");
        const list = await sys("networkInterfaces");
        const iface = (Array.isArray(list) ? list : [list]).find(i => i.iface === name) || null;
        this.iface = iface;
        this.sub = iface ? `${iface.ifaceName || iface.iface}`.toUpperCase().slice(0, 32) : "NO INTERFACE";
        this.ipv4.set(iface && iface.ip4 ? iface.ip4 : "--");
        store.iface = name;
        bus.emit("iface", name);
    }

    async updatePing() {
        const ms = await sys("inetLatency", store.get("pingAddr") || "1.1.1.1");
        const online = Number.isFinite(ms) && ms >= 0;
        this.state.set(online ? "ONLINE" : "OFFLINE");
        this.state.el.classList.toggle("bad", !online);
        this.ping.set(online ? `${Math.round(ms)}ms` : "--");
    }

    async updateGeo() {
        if (!store.get("geoLookup")) {
            this.pub.set("DISABLED");
            return;
        }
        try {
            const g = await window.clu.sys.geo();
            if (!g) return;
            this.pub.set(g.ip);
            this.pub.el.title = g.isp ? `${g.ip}\n${g.isp}` : g.ip;
            this.loc.set(g.city ? `${g.city.toUpperCase()}, ${g.countryCode || ""}` : (g.country || "--"));
            bus.emit("geo", g);
        } catch (e) {
            this.pub.set("UNAVAILABLE");
        }
    }
}

export class GlobePanel extends Panel {
    constructor(col) {
        super(col, { id: "globe", title: "WORLD VIEW", sub: "GLOBAL NETWORK MAP" });
        this.canvas = h("canvas.globe");
        this.coords = h("div.globe-coords", "ENDPOINT LAT/LON  --, --");
        this.body.append(this.canvas, this.coords);
        this.ctx = this.canvas.getContext("2d");
        this._buildDots();
        this.rot = -20;
        this.tilt = 18;
        this.home = null;
        this.last = 0;

        this.track(bus.on("geo", g => {
            this.home = [g.lon, g.lat];
            this.coords.textContent = `ENDPOINT LAT/LON  ${g.lat.toFixed(4)}, ${g.lon.toFixed(4)}`;
        }));
        new ResizeObserver(() => this._resize()).observe(this.canvas);
        const frame = t => {
            this.raf = requestAnimationFrame(frame);
            // ~24 fps is plenty for a slow spin.
            if (t - this.last < 41) return;
            const dt = this.last ? Math.min(t - this.last, 100) : 16;
            this.last = t;
            this.rot += dt * 0.006;
            this.draw(t);
        };
        this.raf = requestAnimationFrame(frame);
        this.track(() => cancelAnimationFrame(this.raf));
    }

    _resize() {
        const dpr = window.devicePixelRatio || 1;
        const W = Math.round(this.canvas.clientWidth * dpr), H = Math.round(this.canvas.clientHeight * dpr);
        if (W && H && (this.canvas.width !== W || this.canvas.height !== H)) {
            this.canvas.width = W;
            this.canvas.height = H;
        }
    }

    /**
     * Rasterize the land polygons once into an equirectangular mask, then keep only
     * a lat/lon dot lattice. Each frame just rotates and projects those few thousand
     * points, instead of clipping and resampling polygons with d3 every frame.
     */
    _buildDots() {
        const MW = 720, MH = 360;
        const mask = new OffscreenCanvas(MW, MH);
        const mctx = mask.getContext("2d", { willReadFrequently: true });
        const proj = geoEquirectangular().translate([MW / 2, MH / 2]).scale(MW / (2 * Math.PI));
        mctx.fillStyle = "#fff";
        mctx.beginPath();
        geoPath(proj, mctx)(feature(land110, land110.objects.land));
        mctx.fill();
        const px = mctx.getImageData(0, 0, MW, MH).data;
        const isLand = (lon, lat) => {
            const x = Math.min(MW - 1, Math.floor((lon + 180) / 360 * MW));
            const y = Math.min(MH - 1, Math.floor((90 - lat) / 180 * MH));
            return px[(y * MW + x) * 4] > 127;
        };

        const land = [], grid = [];
        const STEP = 2;
        for (let lat = -84; lat <= 84; lat += STEP) {
            const n = Math.max(1, Math.round(360 / STEP * Math.cos(lat * Math.PI / 180)));
            for (let i = 0; i < n; i++) {
                const lon = -180 + i * 360 / n;
                if (isLand(lon, lat)) land.push(lon, lat);
            }
        }
        // faint dotted graticule every 30°
        for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 3) grid.push(lon, lat);
        for (let lon = -180; lon < 180; lon += 30) for (let lat = -84; lat <= 84; lat += 3) grid.push(lon, lat);

        const pack = arr => {
            const n = arr.length / 2;
            const out = { n, lam: new Float32Array(n), sinPhi: new Float32Array(n), cosPhi: new Float32Array(n) };
            for (let i = 0; i < n; i++) {
                const phi = arr[i * 2 + 1] * Math.PI / 180;
                out.lam[i] = arr[i * 2] * Math.PI / 180;
                out.sinPhi[i] = Math.sin(phi);
                out.cosPhi[i] = Math.cos(phi);
            }
            return out;
        };
        this.landDots = pack(land);
        this.gridDots = pack(grid);
    }

    /** Orthographic projection of a dot set; buckets by depth so each bucket is one fill. */
    _drawDots(set, cx, cy, R, size, rgb, alphaScale) {
        const { ctx } = this;
        const lam0 = -this.rot * Math.PI / 180, phi0 = this.tilt * Math.PI / 180;
        const sp0 = Math.sin(phi0), cp0 = Math.cos(phi0);
        const buckets = [[], [], [], []];
        for (let i = 0; i < set.n; i++) {
            const dl = set.lam[i] - lam0;
            const cdl = Math.cos(dl);
            const cosc = sp0 * set.sinPhi[i] + cp0 * set.cosPhi[i] * cdl;
            if (cosc <= 0.02) continue;
            const x = cx + R * set.cosPhi[i] * Math.sin(dl);
            const y = cy - R * (cp0 * set.sinPhi[i] - sp0 * set.cosPhi[i] * cdl);
            buckets[Math.min(3, (cosc * 4) | 0)].push(x, y);
        }
        const half = size / 2;
        buckets.forEach((pts, bi) => {
            if (!pts.length) return;
            ctx.fillStyle = `rgba(${rgb},${(0.25 + bi * 0.25) * alphaScale})`;
            ctx.beginPath();
            for (let j = 0; j < pts.length; j += 2) ctx.rect(pts[j] - half, pts[j + 1] - half, size, size);
            ctx.fill();
        });
    }

    _project(lon, lat, cx, cy, R) {
        const lam0 = -this.rot * Math.PI / 180, phi0 = this.tilt * Math.PI / 180;
        const l = lon * Math.PI / 180, p = lat * Math.PI / 180;
        const dl = l - lam0;
        const cosc = Math.sin(phi0) * Math.sin(p) + Math.cos(phi0) * Math.cos(p) * Math.cos(dl);
        if (cosc <= 0) return null;
        return [cx + R * Math.cos(p) * Math.sin(dl), cy - R * (Math.cos(phi0) * Math.sin(p) - Math.sin(phi0) * Math.cos(p) * Math.cos(dl))];
    }

    draw(t) {
        const { ctx, canvas } = this;
        const W = canvas.width, H = canvas.height;
        if (!W || !H || !themes.current) return;
        const rgb = themes.current.rgb.join(",");
        const R = Math.min(W, H) / 2 - 4;
        if (R < 10) return; // collapsed (focus mode)
        const cx = W / 2, cy = H / 2;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, W, H);

        if (!this._halo || this._haloKey !== `${W}x${H}${rgb}`) {
            this._haloKey = `${W}x${H}${rgb}`;
            this._halo = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.06);
            this._halo.addColorStop(0, `rgba(${rgb},0)`);
            this._halo.addColorStop(1, `rgba(${rgb},0.14)`);
        }
        ctx.fillStyle = this._halo;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},0.45)`;
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();

        this._drawDots(this.gridDots, cx, cy, R, Math.max(1, dpr), rgb, 0.35);
        this._drawDots(this.landDots, cx, cy, R, Math.max(1.5, R / 85), rgb, 1);

        if (this.home) {
            const p = this._project(this.home[0], this.home[1], cx, cy, R);
            if (p) {
                const pulse = (t / 1600) % 1;
                ctx.strokeStyle = `rgba(${rgb},${1 - pulse})`;
                ctx.lineWidth = 1.5 * dpr;
                ctx.beginPath();
                ctx.arc(p[0], p[1], (3 + pulse * 14) * dpr, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = `rgb(${rgb})`;
                ctx.beginPath();
                ctx.arc(p[0], p[1], 3 * dpr, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

export class TrafficPanel extends Panel {
    constructor(col) {
        super(col, { id: "traffic", title: "NETWORK TRAFFIC", sub: "UP / DOWN, MB/S" });
        this.up = stat("UP");
        this.down = stat("DOWN");
        this.totalUp = stat("TOTAL UP");
        this.totalDown = stat("TOTAL DOWN");
        this.graph = new LineGraph(this.body, {
            points: 80, series: 2, autoscale: true, height: "6.5vh",
            styles: [{ width: 1.5, alpha: 1 }, { width: 1.2, alpha: 0.55, dash: [3, 2] }]
        });
        this.body.append(h("div.stat-row", this.up.el, this.down.el, this.totalUp.el, this.totalDown.el));
        // networkStats spawns PowerShell on Windows; 2s keeps the graph alive without the cost.
        this.track(poll(() => this.update(), 2000));
    }

    async update() {
        if (!store.iface) return;
        const stats = await sys("networkStats", store.iface);
        const s = Array.isArray(stats) ? stats[0] : stats;
        if (!s) return;
        const tx = Math.max(0, s.tx_sec || 0), rx = Math.max(0, s.rx_sec || 0);
        this.graph.push(tx, rx);
        this.up.set(`${formatBytes(tx)}/s`);
        this.down.set(`${formatBytes(rx)}/s`);
        this.totalUp.set(formatBytes(s.tx_bytes));
        this.totalDown.set(formatBytes(s.rx_bytes));
    }
}

export class StoragePanel extends Panel {
    constructor(col) {
        super(col, { id: "storage", title: "STORAGE", sub: "MOUNTED VOLUMES" });
        this.list = h("div.storage-list");
        this.body.append(this.list);
        this.track(poll(() => this.update(), 30000));
    }

    async update() {
        const vols = (await sys("fsSize")).filter(v => v.size > 0).slice(0, 5);
        this.list.replaceChildren(...vols.map(v => h("div.bar-row",
            h("span.bar-label", v.mount.length > 8 ? v.mount.slice(0, 8) + "…" : v.mount),
            h("div.bar", h("div.bar-fill", { style: { width: `${Math.min(100, v.use || 0)}%` } })),
            h("span", `${formatBytes(v.available)} free`)
        )));
    }
}
