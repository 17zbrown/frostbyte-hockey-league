#!/usr/bin/env node
/* Build the guide demo page: node tools/demo/build-guide-demo.mjs <out.html>
   Bundles clubs.json + guide_seeds.js + guide_layer.js into one layer and hands it to the site build. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const out = process.argv[2]; if (!out) { console.error("usage: build-guide-demo.mjs <out.html>"); process.exit(2); }
const clubs = fs.readFileSync(path.join(HERE, "clubs.json"), "utf8");
/* one seed file per guide topic in tools/demo/seeds/; SEEDS=a,b limits the bundle while a topic is in progress */
const seedDir = path.join(HERE, "seeds");
const only = (process.env.SEEDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const seeds = fs.existsSync(seedDir) ? fs.readdirSync(seedDir).filter((f) => f.endsWith(".js") && (!only.length || only.includes(f.replace(/\.js$/, "")))).sort()
  .map((f) => "/* ---- seed: " + f + " ---- */\ntry {\n" + fs.readFileSync(path.join(seedDir, f), "utf8") + "\n} catch (e) { console.error('[guide] seed file failed: " + f + "', e); }\n").join("\n") : "";
const layer = fs.readFileSync(path.join(HERE, "guide_layer.js"), "utf8");
const bundle = "window.GUIDE_CLUBS = " + clubs.trim() + ";\n" + seeds + "\n" + layer;
const bundlePath = path.join(HERE, "_guide_bundle.js");
fs.writeFileSync(bundlePath, bundle);
const r = spawnSync(process.execPath, [path.join(ROOT, "src/live/build.cjs"), out, "../../tools/demo/_guide_bundle.js"], { stdio: "inherit" });
process.exit(r.status ?? 1);
