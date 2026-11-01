// Smoke test, evaluated inside the CLU renderer by tests/run.mjs (CLU_EVAL).
// Prints "TEST PASS|FAIL <name>" lines and finally "TEST DONE <passed>/<total>".
(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const until = async (fn, ms = 10000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ }
            await wait(150);
        }
        return null;
    };
    let passed = 0, total = 0;
    const check = async (name, fn) => {
        total++;
        try {
            const r = await fn();
            if (r === false) throw new Error("returned false");
            passed++;
            console.log(`TEST PASS ${name}`);
        } catch (e) {
            console.log(`TEST FAIL ${name}: ${e && e.message || e}`);
            console.log(`__SNAP__fail_${total}`);
            await wait(400);
        }
    };
    const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

    await check("lock screen shown and gates the main process", async () => {
        assert(await until(() => document.querySelector(".lock-input")), "no lock screen");
        let refused = false;
        try { await window.clu.pty.create({}); } catch (e) { refused = /locked/i.test(e.message); }
        assert(refused, "pty:create allowed while locked");
    });

    await check("wrong password is rejected", async () => {
        const r = await window.clu.lock.verify("0000");
        assert(!r.ok, "0000 accepted");
    });

    await check("default password unlocks the UI", async () => {
        const input = document.querySelector(".lock-input");
        input.value = "1001";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        assert(await until(() => window.__clu && document.body.classList.contains("ready"), 20000), "UI never became ready");
    });

    const c = window.__clu;
    const s = () => c.tabs.session;

    await check("shell starts and reports its working directory", async () => {
        assert(await until(() => s() && s().cwd && s().blocks.pending, 20000), "no prompt / cwd from shell integration");
    });

    await check("successful command produces a ✓ block with output", async () => {
        s().run("Write-Output clu-smoke-ok");
        const b = await until(() => s().blocks.blocks.find(x => /clu-smoke-ok/.test(x.cmd)));
        assert(b, "no block");
        assert(b.ok && b.code === 0, `ok=${b.ok} code=${b.code}`);
        assert(s().blocks.output(b).includes("clu-smoke-ok"), "output missing");
    });

    await check("failing command produces a ✗ block", async () => {
        s().run("Get-Item C:\\clu_smoke_missing_path");
        const b = await until(() => s().blocks.blocks.find(x => /clu_smoke_missing_path/.test(x.cmd)));
        assert(b && !b.ok, "expected failure");
    });

    await check("file browser follows cd", async () => {
        s().run("Set-Location C:\\Windows");
        assert(await until(() => c.files.dir === "C:\\Windows"), `files.dir=${c.files.dir}`);
    });

    await check("clu command from the shell drives the UI (theme)", async () => {
        s().run("clu theme matrix");
        assert(await until(() => c.themes.current.name === "matrix"), "theme not applied");
        s().run("clu theme tron");
        await until(() => c.themes.current.name === "tron");
    });

    await check("split pane and close it again", async () => {
        const tab = c.tabs.active;
        await c.tabs.split("row");
        assert(tab.root.type === "split", "no split");
        await until(() => s().cwd);
        c.tabs.closePane();
        assert(tab.root.type === "leaf", "pane not closed");
    });

    await check("new tab inherits the directory", async () => {
        const t = await c.tabs.add({});
        assert(await until(() => t.session.cwd === "C:\\Windows"), `cwd=${t.session.cwd}`);
        c.tabs.close(t);
    });

    await check("session serializes tabs and output", async () => {
        const ser = c.tabs.serialize();
        assert(ser.tabs.length >= 1 && ser.tabs[0].layout, "no layout");
        assert(String(ser.tabs[0].layout.output || "").includes("clu-smoke-ok"), "output not captured");
    });

    await check("system info worker answers", async () => {
        const load = await window.clu.sys.call("currentLoad");
        assert(typeof load.currentLoad === "number", "no cpu load");
    });

    await check("clu lock re-engages the gate", async () => {
        s().run("clu lock");
        assert(await until(() => document.getElementById("lock")), "no lock overlay");
        let refused = false;
        try { await window.clu.fs.list("C:\\"); } catch (e) { refused = true; }
        assert(refused, "fs allowed while locked");
        const input = document.querySelector(".lock-input");
        input.value = "1001";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        assert(await until(() => !document.getElementById("lock")), "did not unlock");
    });

    console.log(`TEST DONE ${passed}/${total}`);
})();
