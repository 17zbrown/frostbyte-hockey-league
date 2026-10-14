// The build id of a Supabase Edge job (v4.06): sha256 over the bundling recipe (esbuild version, flags, defines, banner)
// and every input file's bytes, cut to 12 hex. Two callers compute it and must agree:
//   tools/edge/build.mjs stamps it into the bundle it deploys, and the deployed wrapper reports it on every call
//     (public.job_hosts.edge_build);
//   src/live/build.cjs publishes the id the repo expects in version.json, which the database copies into
//     app_config.edge_expected_builds, so the watchdog pages when a deployed job falls behind the repo.
// CommonJS so build.cjs can require it without a bundler.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SPEC = require("./jobs.json");
const ROOT = path.join(__dirname, "..");

function recipe() {
  return JSON.stringify({ esbuild: SPEC.esbuild, flags: SPEC.flags, defines: SPEC.defines, banner: SPEC.banner });
}

function buildId(job, root = ROOT) {
  const j = SPEC.jobs[job];
  if (!j) throw new Error(`edge/recipe: unknown job ${job}`);
  const h = crypto.createHash("sha256");
  h.update("cghl-edge-1\n" + recipe() + "\n" + job + "\n");
  for (const rel of [...j.inputs].sort()) {
    const bytes = fs.readFileSync(path.join(root, rel));
    h.update(rel + "\n" + crypto.createHash("sha256").update(bytes).digest("hex") + "\n");
  }
  return h.digest("hex").slice(0, 12);
}

function buildIds(root = ROOT) {
  return Object.fromEntries(Object.keys(SPEC.jobs).map((job) => [job, buildId(job, root)]));
}

module.exports = { SPEC, recipe, buildId, buildIds };
