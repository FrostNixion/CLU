// Plugin test, evaluated inside CLU by tests/run.mjs with the example plugin installed in the test profile.
(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const until = async (fn, ms = 10000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ } await wait(150); }
        return null;
    };
    let passed = 0, total = 0;
    const check = async (name, fn) => {
        total++;
        try { await fn(); passed++; console.log(`TEST PASS ${name}`); }
        catch (e) { console.log(`TEST FAIL ${name}: ${e.message}`); console.log(`__SNAP__plugin_fail_${total}`); await wait(400); }
    };
    const assert = (c, m) => { if (!c) throw new Error(m); };

    const input = await until(() => document.querySelector(".lock-input"));
    input.value = "1001";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await until(() => window.__clu && document.body.classList.contains("ready"), 20000);
    const c = window.__clu;

    await check("example plugin adds its panel", async () => {
        assert(await until(() => document.getElementById("panel-pomodoro-timer")), "panel missing");
    });
    await check("plugin palette command is registered", async () => {
        assert(c.commands.get("plugin.pomodoro.start"), "command missing");
    });
    await check("plugin clu subcommand runs from the shell", async () => {
        await until(() => c.tabs.session && c.tabs.session.blocks.pending, 20000);
        c.tabs.session.run("clu pomodoro 5");
        assert(await until(() => /FOCUSING/.test(document.querySelector("#panel-pomodoro-timer .sub").textContent)), "timer did not start");
        console.log("__SNAP__plugin_running");
        await wait(500);
    });
    console.log(`TEST DONE ${passed}/${total}`);
})();
