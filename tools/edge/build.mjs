#!/usr/bin/env node
// Bundles the Supabase Edge jobs (v4.06). Each job is one ESM file: edge/<job>.entry.mjs plus everything it imports,
// built with the pinned esbuild and the flags in edge/jobs.json, and stamped with its build id (edge/recipe.cjs).
//
//   node tools/edge/build.mjs                      all five, into supabase/functions/<job>/index.js (what the deploy reads)
//   node tools/edge/build.mjs lfg-timers           one job
//   node tools/edge/build.mjs --out /tmp/edge      somewhere else (the tests build into a temp folder)
//
// It refuses to write a bundle that would not run the same on Supabase: an input that edge/jobs.json does not list (the
// build id would not cover it), a leftover import of anything but a node: module, or an export.
// The deploy runs this and then the Supabase CLI: by hand (supabase/config.toml), or automatically once
// tools/edge/edge-deploy.yml is installed as a GitHub workflow.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import recipe from "../../edge/recipe.cjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { SPEC, buildId } = recipe;

const args = process.argv.slice(2);
let outDir = path.join(ROOT, "supabase", "functions");
const wanted = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") outDir = path.resolve(args[++i]);
  else wanted.push(args[i]);
}
const jobs = wanted.length ? wanted : Object.keys(SPEC.jobs);
for (const j of jobs) if (!SPEC.jobs[j]) { console.error(`unknown job ${j}`); process.exit(2); }

/* The only imports a bundle may keep: Node's own modules, which Supabase's runtime provides. */
const IMPORT_RE = /(?:^|[;\s])import\s*(?:[\w*{}\s,]+from\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

export function bundleJob(job, out = outDir) {
  const id = buildId(job);
  const outfile = path.join(out, job, "index.js");
  const meta = path.join(os.tmpdir(), `cghl-edge-${job}-${process.pid}.meta.json`);
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  const argv = [
    "--yes", `esbuild@${SPEC.esbuild}`, `edge/${job}.entry.mjs`, `--outfile=${outfile}`, `--metafile=${meta}`,
    ...SPEC.flags,
    ...Object.entries(SPEC.defines).map(([k, v]) => `--define:${k}=${JSON.stringify(v)}`),
    `--define:__CGHL_EDGE_BUILD__=${JSON.stringify(id)}`,
    `--banner:js=${SPEC.banner}`,
    "--log-level=warning",
  ];
  const r = spawnSync("npx", argv, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`esbuild failed for ${job}:\n${r.stderr || r.stdout}`);
  const m = JSON.parse(fs.readFileSync(meta, "utf8"));
  fs.rmSync(meta, { force: true });
  const fail = (why) => { fs.rmSync(outfile, { force: true }); throw new Error(`${job}: ${why}`); };

  const inputs = Object.keys(m.inputs).map((p) => p.split(path.sep).join("/")).sort();
  const declared = [...SPEC.jobs[job].inputs].sort();
  if (JSON.stringify(inputs) !== JSON.stringify(declared)) {
    fail(`the bundle reads ${JSON.stringify(inputs)} but edge/jobs.json lists ${JSON.stringify(declared)}. Update the list, so the build id covers every file.`);
  }
  const o = Object.values(m.outputs)[0];
  if (o && o.exports && o.exports.length) fail(`the bundle exports ${o.exports.join(", ")}; an Edge entry exports nothing`);

  const code = fs.readFileSync(outfile, "utf8");
  if (!code.startsWith(SPEC.banner)) fail("the banner is not the first line");
  const bad = [];
  for (const x of code.matchAll(IMPORT_RE)) { const spec = x[1] || x[2]; if (!spec.startsWith("node:")) bad.push(spec); }
  if (bad.length) fail(`imports left in the bundle: ${[...new Set(bad)].join(", ")}`);
  if (!code.includes(JSON.stringify(id))) fail("the build id was not stamped");

  return { job, id, bytes: Buffer.byteLength(code), sha256: crypto.createHash("sha256").update(code).digest("hex"), outfile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = [];
  for (const j of jobs) {
    try { results.push(bundleJob(j)); }
    catch (e) { console.error(String(e.message || e)); process.exit(1); }
  }
  for (const x of results) console.log(`${x.job.padEnd(18)} ${x.id}  ${String(x.bytes).padStart(7)} B  sha256 ${x.sha256.slice(0, 16)}  ${path.relative(ROOT, x.outfile)}`);
}
