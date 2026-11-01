// Builds the renderer, then for each suite launches CLU against a throwaway profile, runs the
// suite inside it and reports. Exits non-zero on any failure; failure screenshots go to tests/out/.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "tests", "out");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const SUITES = [
    { name: "smoke", file: "smoke.js" },
    {
        name: "plugins", file: "plugins.js",
        setup: profile => fs.cpSync(path.join(root, "examples", "plugins", "pomodoro"), path.join(profile, "plugins", "pomodoro"), { recursive: true })
    }
];

function runSuite({ name, file, setup }) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "clu-test-"));
    if (setup) setup(profile);
    console.log(`\n${name}`);
    return new Promise(resolve => {
        const child = spawn(electron, [root, "--windowed", "--nointro"], {
            cwd: root,
            env: {
                ...process.env,
                CLU_USER_DATA: profile,
                CLU_DEBUG: "1",
                CLU_EVAL: path.join(root, "tests", file),
                CLU_EVAL_DELAY: "1500",
                CLU_SCREENSHOT: outDir,
                CLU_SCREENSHOT_AT: "999999999"
            },
            stdio: ["ignore", "pipe", "pipe"]
        });
        let done = null;
        const errors = [];
        child.stdout.on("data", buf => {
            for (const line of buf.toString().split(/\r?\n/)) {
                const m = /TEST (PASS|FAIL|DONE) (.*?)(?: \(:\d+\))?$/.exec(line);
                if (!m) {
                    if (/Uncaught|\[renderer:error\]/.test(line)) errors.push(`  ! ${line.trim()}`);
                    continue;
                }
                if (m[1] === "DONE") done = m[2];
                else console.log(`  ${m[1] === "PASS" ? "✓" : "✗"} ${m[2]}`);
            }
            if (done) child.kill();
        });
        child.stderr.on("data", () => {});
        const timer = setTimeout(() => { done = done || "timeout"; child.kill(); }, 180000);
        child.on("exit", () => {
            clearTimeout(timer);
            setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* still locked */ } }, 1000);
            const [passed, total] = String(done).split("/").map(Number);
            const ok = total > 0 && passed === total;
            if (!ok && errors.length) console.log(errors.slice(0, 10).join("\n"));
            resolve({ name, ok, result: done });
        });
    });
}

execFileSync(process.execPath, [path.join(root, "build.mjs")], { cwd: root, stdio: "ignore" });
const results = [];
for (const suite of SUITES) results.push(await runSuite(suite));
const ok = results.every(r => r.ok);
console.log(`\n${ok ? "PASS" : "FAIL"}: ${results.map(r => `${r.name} ${r.result}`).join(", ")}`);
process.exit(ok ? 0 : 1);
