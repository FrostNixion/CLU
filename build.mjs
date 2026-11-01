import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");
const outdir = "dist";

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });
fs.copyFileSync("src/renderer/index.html", path.join(outdir, "index.html"));
if (fs.existsSync("build/icon.png")) fs.copyFileSync("build/icon.png", path.join(outdir, "icon.png"));

const options = {
    entryPoints: { renderer: "src/renderer/main.js" },
    bundle: true,
    outdir,
    format: "esm",
    target: "chrome130",
    sourcemap: watch ? "inline" : false,
    minify: !watch,
    legalComments: "none",
    loader: { ".woff2": "file", ".woff": "file", ".svg": "text" },
    assetNames: "assets/[name]-[hash]",
    logLevel: "info"
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("watching renderer...");
} else {
    await esbuild.build(options);
}
