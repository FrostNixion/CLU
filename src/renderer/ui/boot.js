import { h, delay, formatBytes } from "../lib/util.js";
import { audio } from "../core/audio.js";
import { store } from "../core/store.js";

const SUBSYSTEMS = [
    "acpi: interpreter enabled", "acpi: using IOAPIC for interrupt routing", "pci: probing PCI hardware (bus 00)",
    "clocksource: tsc-early: mask 0xffffffffffffffff", "x86/fpu: enabled xstate features 0x2e7, context size 2440 bytes",
    "smpboot: bringing up secondary CPUs", "devtmpfs: initialized", "NET: registered PF_NETLINK/PF_ROUTE protocol family",
    "audit: initializing netlink subsys (disabled)", "thermal_sys: registered thermal governor 'step_wise'",
    "iommu: default domain type: translated", "SCSI subsystem initialized", "usbcore: registered new interface driver usbfs",
    "pps_core: LinuxPPS API ver. 1 registered", "grid: allocating identity disc buffers", "grid: lightcycle arena mapped at 0xffff8a0000000000",
    "NetLabel: protocols = UNLABELED CIPSOv4 CALIPSO", "vgaarb: loaded", "workingset: timestamp_bits=36 max_order=22",
    "io scheduler mq-deadline registered", "input: Power Button as /devices/LNXSYSTM:00/input/input0",
    "serial8250: ttyS0 at I/O 0x3f8 (irq = 4) is a 16550A", "nvme nvme0: 16/0/0 default/read/poll queues",
    "xhci_hcd 0000:00:14.0: new USB bus registered, assigned bus number 1", "rtc_cmos 00:02: setting system clock",
    "tcp_listen_portaddr_hash hash table entries: 16384", "NET: registered PF_INET6 protocol family",
    "Freeing unused kernel image (initmem) memory", "Write protecting the kernel read-only data", "Run /init as init process",
    "systemd[1]: detected architecture x86-64", "pty: spawning conpty bridge", "pty: shell integration armed (osc 7, osc 7777)",
    "sysinfo: utility process online", "webgl: renderer context acquired", "audio: synthesizer ready",
    "fs: mounting user home", "net: probing default interface", "net: scheduling latency probe", "ui: compositing panels",
    "kbd: loading keymap", "theme: loading accent palette", "security: context isolation enforced", "security: renderer sandbox active"
];

function* bootLines(info) {
    const ts = () => `[${(performance.now() / 1000).toFixed(6).padStart(12, " ")}]`;
    yield `CLU BIOS v${info.version}  ·  Electron ${info.electron}  ·  Chromium ${info.chrome}  ·  Node ${info.node}`;
    yield "Copyright (C) GRID SYSTEMS. All rights reserved.";
    yield "";
    yield `${ts()} CLU kernel ${info.version}-grid boot at ${new Date().toString()}`;
    yield `${ts()} Command line: clu --grid=1 --host=${info.hostname} quiet splash`;
    yield `${ts()} cpu0: ${info.cpuModel || "unknown processor"} · ${info.cpus} logical cores`;
    yield `${ts()} Memory: ${formatBytes(info.totalmem)} available`;
    yield `${ts()} OS: ${info.osVersion} (${info.platform} ${info.release}, ${info.arch})`;
    for (const line of SUBSYSTEMS) yield `${ts()} ${line}`;
    yield `${ts()} shell: ${info.shell}`;
    yield `${ts()} user: ${info.username}@${info.hostname}`;
    yield "";
    yield "Boot Complete";
}

/** Runs the boot log + logo sequence; resolves when the main UI should take over. */
export async function runBoot(root) {
    const info = store.info;
    let skip = false;
    const onSkip = () => { skip = true; };
    window.addEventListener("keydown", onSkip, { once: true });
    window.addEventListener("mousedown", onSkip, { once: true });

    root.className = "boot-log";
    const pre = h("pre");
    root.replaceChildren(pre);
    let i = 0;
    for (const line of bootLines(info)) {
        if (skip) break;
        pre.append(line + "\n");
        if (line === "Boot Complete") audio.play("granted");
        else audio.play("stdout", { throttle: 30 });
        i++;
        await delay(i < 4 ? 220 : i < 9 ? 70 : Math.max(8, 32 - i * 0.4));
    }
    if (!skip) await delay(350);

    root.className = "boot-logo";
    const title = h("h1", { "data-text": "CLU" }, "CLU");
    const subtitle = h("p.boot-sub", "COMMAND LINE UNIVERSE");
    root.replaceChildren(h("div.logo-wrap", title, subtitle));
    audio.play("theme");
    await delay(skip ? 50 : 300);
    title.classList.add("solid");
    await delay(skip ? 50 : 350);
    title.classList.remove("solid");
    title.classList.add("framed");
    await delay(skip ? 50 : 200);
    title.classList.add("glitch");
    await delay(skip ? 150 : 600);
    title.classList.remove("glitch");
    subtitle.classList.add("in");
    await delay(skip ? 100 : 900);

    window.removeEventListener("keydown", onSkip);
    window.removeEventListener("mousedown", onSkip);
    root.classList.add("out");
    await delay(250);
    root.remove();
}
