#!/usr/bin/env node
/* Render the member-guide posters (tools/guides/src/<name>.html) to PNG (docs/guides/<name>.png).
     node tools/guides/build-guides.mjs [name …]      (no names = every poster)
   Uses the same DevTools driver as the demo screenshots (tools/demo/shoot.mjs): full-page capture
   at 1600 CSS px, device scale 1.5 → 2400 px wide PNGs that stay sharp when Discord scales them. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = path.join(HERE, "src");
const OUT = path.join(ROOT, "docs/guides");
fs.mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);
const names = fs.readdirSync(SRC).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, "")).filter((n) => !want.length || want.includes(n));
if (!names.length) { console.error("no posters to build"); process.exit(2); }
const list = {
  base: "file://" + SRC + "/",
  out: OUT,
  shots: names.map((n) => ({ name: n, url: n + ".html", width: 1600, height: 900, scale: 1.5, settle: 1500, full: true, maxHeight: 9000, colorScheme: "light" })),
};
const listPath = path.join(OUT, "_shots-" + (process.env.SHOOT_PORT || "9345") + ".json");
fs.writeFileSync(listPath, JSON.stringify(list, null, 1));
/* SHOOT_PORT lets several posters render at once (each run owns one headless Chrome) */
const r = spawnSync(process.execPath, [path.join(ROOT, "tools/demo/shoot.mjs"), listPath, "--port", process.env.SHOOT_PORT || "9345"], { stdio: "inherit" });
fs.rmSync(listPath, { force: true });
process.exit(r.status ?? 1);
