import { Modal, confirmModal, toast } from "./modal.js";
import { h, formatBytes } from "../lib/util.js";

let current = null;

export function openProcessManager() {
    if (current) return current;
    let sortKey = "cpu", desc = true, filter = "", list = [], stopped = false;

    const input = h("input.proc-filter", { placeholder: "filter by name, pid or command...", spellcheck: "false" });
    const count = h("span.proc-count");
    const tbody = h("tbody");
    const cols = [["pid", "PID"], ["name", "NAME"], ["cpu", "CPU %"], ["mem", "MEM %"], ["memRss", "RSS"], ["user", "USER"], ["", ""]];
    const thead = h("thead", h("tr", ...cols.map(([k, label]) => h("th", {
        "data-key": k,
        onclick: () => {
            if (!k) return;
            desc = sortKey === k ? !desc : k !== "name";
            sortKey = k;
            render();
        }
    }, label))));

    const kill = async p => {
        const ok = await confirmModal("Terminate process", `Kill ${p.name} (PID ${p.pid})?`, { okLabel: "Kill", type: "error" });
        if (!ok) return;
        try {
            await window.clu.sys.kill(p.pid);
            toast(`Killed ${p.name} (${p.pid})`, "info");
            refresh();
        } catch (e) {
            toast(`Could not kill ${p.pid}: ${e.message.replace(/^.*Error: /, "")}`, "error");
        }
    };

    const render = () => {
        const q = filter.toLowerCase();
        let rows = q ? list.filter(p => String(p.pid) === q || p.name.toLowerCase().includes(q) || (p.command || "").toLowerCase().includes(q)) : list.slice();
        rows.sort((a, b) => {
            const x = a[sortKey], y = b[sortKey];
            const c = typeof x === "string" ? x.localeCompare(y) : (x || 0) - (y || 0);
            return desc ? -c : c;
        });
        count.textContent = `${rows.length} / ${list.length} processes`;
        thead.querySelectorAll("th").forEach(th => th.classList.toggle("sorted", th.dataset.key === sortKey));
        tbody.replaceChildren(...rows.slice(0, 300).map(p => h("tr", { title: p.command || p.path || "" },
            h("td", p.pid),
            h("td.name", p.name),
            h("td", p.cpu.toFixed(1)),
            h("td", p.mem.toFixed(1)),
            h("td", formatBytes((p.memRss || 0) * 1024)),
            h("td", p.user || ""),
            h("td", h("button.mini.danger", { onclick: () => kill(p) }, "KILL"))
        )));
    };

    const refresh = async () => {
        try {
            list = await window.clu.sys.call("processList");
            render();
        } catch (e) { /* worker busy */ }
    };
    const loop = async () => {
        if (stopped) return;
        await refresh();
        if (!stopped) setTimeout(loop, 3000);
    };

    input.addEventListener("input", () => { filter = input.value.trim(); render(); });
    input.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") modal.close(); });

    const modal = new Modal({
        title: "Process Manager",
        className: "proc-modal",
        body: h("div.proc", h("div.proc-top", input, count), h("div.proc-scroll", h("table.proc-table", thead, tbody))),
        buttons: [{ label: "Refresh", keep: true, action: refresh }],
        onClose: () => { stopped = true; current = null; }
    });
    current = modal;
    loop();
    setTimeout(() => input.focus(), 50);
    return modal;
}
