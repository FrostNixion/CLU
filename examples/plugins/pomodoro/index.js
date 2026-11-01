// Example CLU plugin: a focus timer.
// Shows every part of the plugin API: a panel, a `clu` subcommand, palette commands
// with a shortcut, toasts, system notifications and sounds.
export default function activate(clu) {
    const { h } = clu;
    const panel = clu.panel({ id: "timer", title: "POMODORO", sub: "IDLE", side: "left" });
    const clock = h("div.clock-digits", "--:--");
    clock.style.fontSize = "3vh";
    const fill = h("div.bar-fill");
    panel.body.append(clock, h("div.bar-row", h("span.bar-label", "FOCUS"), h("div.bar", fill)));

    let endsAt = 0, total = 0;

    const render = () => {
        if (!endsAt) {
            clock.textContent = "--:--";
            fill.style.width = "0%";
            panel.setSub("IDLE");
            return;
        }
        const left = Math.max(0, endsAt - Date.now());
        const m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000);
        clock.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        fill.style.width = `${(1 - left / total) * 100}%`;
        panel.setSub("FOCUSING");
        if (left === 0) {
            endsAt = 0;
            clu.sound("alarm");
            clu.toast("Pomodoro finished - take a break", "info", 8000);
            clu.notify("CLU · Pomodoro", "Time is up. Take a break.");
            render();
        }
    };

    const start = minutes => {
        minutes = Math.max(1, Math.min(180, Number(minutes) || 25));
        total = minutes * 60000;
        endsAt = Date.now() + total;
        clu.sound("granted");
        clu.toast(`Focus for ${minutes} minutes`, "info", 2500);
        render();
    };
    const stop = () => {
        endsAt = 0;
        clu.sound("denied");
        render();
    };

    panel.every(render, 1000);

    clu.cli("pomodoro", args => (args[0] === "stop" ? stop() : start(args[0])));
    clu.command({ id: "start", title: "Pomodoro: start 25 minutes", keys: "Ctrl+Alt+P", run: () => start(25) });
    clu.command({ id: "stop", title: "Pomodoro: stop", run: stop });
}
