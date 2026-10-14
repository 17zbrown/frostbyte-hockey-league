/* v4.06 (commissioner, 2026-10-14: keep Netlify usage down; "Actually dont use the oracle bot"; the five jobs to
   "Supabase"): discord-sync, twitch-live-sync, lfg-timers, discord-scheduler and discord-welcome move from Netlify scheduled
   functions to Supabase Edge Functions fired by pg_cron. This pins the database record, the Netlify stand-ins, the
   deploy settings and the #rules card that replaced the scheduler's file read. Run: node tools/edge-jobs-v406.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const JOBS = { "discord-sync": 2, "twitch-live-sync": 2, "lfg-timers": 2, "discord-scheduler": 5, "discord-welcome": 5 };

console.log("— the database record (sql/2026-10-14-edge-jobs-v406.sql)");
const sql = R("sql/2026-10-14-edge-jobs-v406.sql");
/* the LAST definition in the file is the live one (Part A2 replaced several of Part A's) */
const fnBody = (name) => { const i = sql.lastIndexOf(`create or replace function public.${name}(`); return i < 0 ? "" : sql.slice(i, sql.indexOf("end $function$;", i)); };
for (const f of ["job_lease", "job_renew", "job_release", "invoke_edge_job", "request_discord_sync", "_job_hosts_host_at"]) {
  A(`${f} runs with an empty search_path`, /set search_path to ''/.test(fnBody(f)));
}
A("job_lease and job_release: service role only",
  /revoke execute on function public\.job_lease\([^)]*\) from public, anon, authenticated;/.test(sql) &&
  /revoke execute on function public\.job_release\([^)]*\) from public, anon, authenticated;/.test(sql) &&
  /grant execute on function public\.job_lease\([^)]*\) to service_role;/.test(sql) && /grant execute on function public\.job_release\([^)]*\) to service_role;/.test(sql));
A("invoke_edge_job: nobody through the API (only pg_cron and request_discord_sync reach it)",
  /revoke execute on function public\.invoke_edge_job\(text, boolean\) from public, anon, authenticated, service_role;/.test(sql) &&
  !/grant execute on function public\.invoke_edge_job/.test(sql));
A("request_discord_sync: signed-in members and the service role, never anonymous",
  /revoke execute on function public\.request_discord_sync\(\) from public, anon;/.test(sql) &&
  /grant execute on function public\.request_discord_sync\(\) to authenticated, service_role;/.test(sql) &&
  /auth\.uid\(\) is null and coalesce\(auth\.role\(\), ''\) <> 'service_role'/.test(fnBody("request_discord_sync")));
A("...debounced to one Edge run per 10 seconds, and none while a run is going",
  /nudge_at < now\(\) - interval '10 seconds'/.test(fnBody("request_discord_sync")) && /lease_until is null or lease_until < now\(\)/.test(fnBody("request_discord_sync")));
A("the Edge host must present the Vault key; a wrong one is denied",
  /p_host = 'edge' and \(p_key is null or p_key !~ '\^\[0-9a-f\]\{64\}\$'/.test(fnBody("job_lease")) &&
  /vault\.decrypted_secrets s where s\.name = 'edge_cron_key'/.test(fnBody("job_lease")));
A("a run is granted only to the named host and only when none is in progress",
  /if v\.host <> p_host then return 'standby'; end if;/.test(fnBody("job_lease")) &&
  /if v\.lease_until is not null and v\.lease_until > now\(\) then return 'busy'; end if;/.test(fnBody("job_lease")));
A("...the row is locked while it decides", /for update;/.test(fnBody("job_lease")));
A("only the holder can hand a run back", /where fn = p_fn and holder = p_holder;/.test(fnBody("job_release")));
A("the cron key is made in the database and never written anywhere else",
  /vault\.create_secret\(encode\(extensions\.gen_random_bytes\(32\), 'hex'\), 'edge_cron_key'/.test(sql) && !/app_config[^;]*edge_cron_key/.test(sql));
A("invoke_edge_job allowlists by job_hosts and never names Discord (grant audit check 7)",
  /if not exists \(select 1 from public\.job_hosts h where h\.fn = p_fn\)/.test(fnBody("invoke_edge_job")) && !/discord|webhook/i.test(fnBody("invoke_edge_job")));
A("...waits long enough for the 202 (pg_net's default is 5 s)", /timeout_milliseconds := 15000/.test(fnBody("invoke_edge_job")));
A("...and records its requests so the watchdog reads their answers", /insert into public\.edge_job_requests/.test(fnBody("invoke_edge_job")));
A("both new tables: RLS on, no member grants",
  /alter table public\.job_hosts enable row level security;\s*revoke all on public\.job_hosts from public, anon, authenticated;/.test(sql) &&
  /alter table public\.edge_job_requests enable row level security;\s*revoke all on public\.edge_job_requests from public, anon, authenticated;/.test(sql));
A("every job starts on Netlify", /host\s+text not null default 'netlify'/.test(sql));
for (const [j, every] of Object.entries(JOBS)) A(`${j} is seeded at every ${every} minutes`, sql.includes(`('${j}', ${every})`));
A("the watchdog: section 5 leaves pg_cron's Edge calls out of the dead-webhook count",
  /and id not in \(select s\.id from public\.live_site_requests s\) and id not in \(select e\.id from public\.edge_job_requests e\)/.test(sql));
A("...section 1 points at the Supabase logs for a job that moved", /It runs on Supabase: open the Supabase dashboard, Edge Functions/.test(sql));
A("...section 4 knows the five triggers", Object.keys(JOBS).every((j) => sql.includes(`(''edge-${j}'', interval`)));
A("...section 8: bad answers, runs that stop finishing, failed runs, and a deployed build behind the repo",
  /perform public\._watch_edge_jobs\(\);/.test(sql) && /wd_edge_http/.test(sql) && /wd_edge_stale_/.test(sql) && /wd_edge_fail_/.test(sql) && /wd_edge_drift_/.test(sql));
A("...a run on Netlify before the switch never reads as a Supabase failure (the host that FINISHED the run)",
  /v_j\.last_host = 'edge' and v_j\.last_ok is false/.test(fnBody("_watch_edge_jobs")) && /last_host = run_host/.test(fnBody("job_release")));

console.log("\n— review fixes (Part A2)");
A("the old six-argument job_lease is dropped, so exactly one exists", /drop function if exists public\.job_lease\(text, text, text, int, text, boolean\);/.test(sql));
A("job_lease, job_renew, job_release: service role only",
  ["job_lease(text, text, text, int, text, boolean, boolean)", "job_renew(text, uuid, int)", "job_release(text, uuid, boolean, text, int)"].every((sig) =>
    sql.includes(`revoke execute on function public.${sig} from public, anon, authenticated;`) && sql.includes(`grant execute on function public.${sig} to service_role;`)));
A("only the holder can renew", /where fn = p_fn and holder = p_holder;/.test(fnBody("job_renew")));
A("a grant over a run that never handed itself back records it as lost",
  /v_lost := v\.holder is not null;/.test(fnBody("job_lease")) && /lost_count = lost_count \+ case when v_lost/.test(fnBody("job_lease")) && /lost_host = case when v_lost then v\.run_host/.test(fnBody("job_lease")));
A("...and the watchdog pages on a lost Supabase run", /v_j\.lost_host = 'edge' and v_j\.last_lost_at > now\(\) - interval '1 hour'/.test(fnBody("_watch_edge_jobs")));
A("the Edge function reports whether every secret is set (edge_ready)", /edge_ready = coalesce\(p_ready, edge_ready\)/.test(fnBody("job_lease")));
A("moving a job to Supabase is refused unless Netlify's gate is proven live AND the function answered with its secrets",
  /old\.run_host = 'netlify' and old\.run_ended > now\(\) - interval '15 minutes'/.test(fnBody("_job_hosts_host_at")) &&
  /old\.edge_seen > now\(\) - interval '15 minutes' and old\.edge_ready is true/.test(fnBody("_job_hosts_host_at")) &&
  /current_setting\('app\.job_host_force', true\)/.test(fnBody("_job_hosts_host_at")));
A("...moving back to Netlify is never refused", /if old\.host = 'netlify' and new\.host = 'edge'/.test(fnBody("_job_hosts_host_at")));
A("bad answers page per job, only after four in a row over eight minutes",
  /limit 4\) t;/.test(fnBody("_watch_edge_jobs")) && /v_n = 4 and v_bad = 4 and v_oldest < now\(\) - interval '8 minutes'/.test(fnBody("_watch_edge_jobs")) &&
  /'wd_edge_http_' \|\| v_j\.fn/.test(fnBody("_watch_edge_jobs")));
A("a failure the job's own result row already reports is not paged twice", /'rl_' \|\| v_j\.fn \|\| '_result'/.test(fnBody("_watch_edge_jobs")));
A("the drift clock restarts when either build changes", /v_j\.drift_pair is distinct from v_pair/.test(fnBody("_watch_edge_jobs")));
A("section 1 leaves Supabase jobs to section 8, section 4 gives new triggers a quarter hour",
  /continue when exists \(select 1 from public\.job_hosts h where h\.fn = v_hb\.fn and h\.host = ''edge''\);/.test(sql) &&
  /continue when v_last is null and v_stale\.jobname like ''edge-%''/.test(sql) && /-- insert into public\.app_config \(key, value\) values \('edge_cron_scheduled_at'/.test(sql));
const tw = R("jobs/twitch-live-sync.js");
A("the Twitch client secret goes in the form body, never a URL", !/oauth2\/token\?/.test(tw) && /body: new URLSearchParams\(\{ client_id: TW_ID, client_secret: TW_SECRET/.test(tw));
A("...and a stored error is capped with any query string cut off", /\.replace\(\/\\\?\[\^\\s\)\]\*\/g, "\?\.\.\."\)\.slice\(0, 300\)/.test(tw));
const schedSrc = R("jobs/discord-scheduler.js");
A("the scheduler's fixed windows are half an hour, so one lost tick cannot cost a post",
  /et\.wd === 2 && et\.hr === 17 && et\.mi < 30/.test(schedSrc) && /et\.hr === 12 && et\.mi < 30/.test(schedSrc) && /et\.hr === 18 && et\.mi < 30/.test(schedSrc));
A("the build check copies the #rules card and the expected Edge builds, only when they change",
  /'rules_card', v_card::text/.test(sql) && /'edge_expected_builds', v_edge::text/.test(sql) && (sql.match(/where public\.app_config\.value is distinct from excluded\.value/g) || []).length === 2);
A("the card is seeded so the scheduler has it before the first v4.06 build is read", /values \('rules_card', \$card\$\{"changelog"/.test(sql));

console.log("\n— Netlify: stand-ins that defer to the database, then nothing");
for (const [j, every] of Object.entries(JOBS)) {
  const p = `netlify/functions/${j}.js`;
  const src = fs.existsSync(path.join(ROOT, p)) ? R(p) : "";
  A(`${j}: the stand-in keeps the schedule and runs through the host gate`,
    src.includes(`export const config = { schedule: "*/${every} * * * *" };`) && src.includes(`import job from "../../jobs/${j}.js";`) &&
    src.includes(`onActiveHost("${j}", () => job(req))`));
  const job = R(`jobs/${j}.js`);
  A(`${j}: the job itself carries no schedule`, !/export const config\s*=/.test(job));
}
const gate = R("jobs/host-gate.mjs");
A("the host gate asks as Netlify with a lease longer than Netlify's 30 s", /p_host: "netlify"/.test(gate) && /NETLIFY_LEASE_S = 40/.test(gate));
const toml = R("netlify.toml");
for (const d of ["jobs", "edge", "supabase"]) A(`netlify.toml refuses to serve /${d}/*`, new RegExp(`from = "/${d}/\\*"\\s*\\n\\s*to = "/"\\s*\\n\\s*status = 404\\s*\\n\\s*force = true`).test(toml));
A("the rulebook is no longer shipped to functions", !/included_files[^\n]*part3_content/.test(toml));

console.log("\n— Supabase deploy settings");
const cfg = R("supabase/config.toml");
A("the CLI targets this project", /^project_id = "bzbuyclwdhmhdzujxeqd"$/m.test(cfg));
for (const j of Object.keys(JOBS)) {
  A(`${j}: verify_jwt off (the wrapper checks its own key) and the bundle as entrypoint`,
    new RegExp(`\\[functions\\.${j}\\]\\s*\\nverify_jwt = false\\s*\\nentrypoint = "\\./functions/${j}/index\\.js"`).test(cfg));
}
/* the workflow is kept as a template until the push credential may add workflow files (see its header) */
const wf = R("tools/edge/edge-deploy.yml");
A("the deploy workflow builds, tests on Deno, then deploys all five", /node tools\/edge\/build\.mjs/.test(wf) && /REQUIRE_DENO: "1"/.test(wf) &&
  /functions deploy discord-sync twitch-live-sync lfg-timers discord-scheduler discord-welcome/.test(wf));
A("...fails loudly without its token rather than skipping", /SUPABASE_ACCESS_TOKEN repo secret is missing/.test(wf) && /exit 1/.test(wf));
A("...and runs for every file a bundle is built from", ["jobs/**", "edge/**", "shared/**", "bot/club-notices.mjs", "bot/handlers.mjs", "assets/role-icons/**"].every((x) => wf.includes(`"${x}"`)));
const gi = R(".gitignore");
A("the built bundles are never committed", /^supabase\/functions\/$/m.test(gi));

console.log("\n— the #rules card: published by the build, read from the database");
const build = R("src/live/build.cjs");
A("build.cjs publishes rulesCard and the Edge build ids in version.json", /rulesCard: rulesCard\(\), edge: require\("\.\.\/\.\.\/edge\/recipe\.cjs"\)\.buildIds\(\)/.test(build));
const sched = R("jobs/discord-scheduler.js");
A("the scheduler opens no files any more", !/from "node:fs"|from "node:path"|readFileSync|new Function/.test(sched));
A("...reads the card from app_config", /key=in\.\(rules_sync_hash,rules_message_ids,rules_card\)/.test(sched));
A("...and a missing card is a failed run, never a quiet skip", /errors\.push\("rules card: app_config\.rules_card is missing or malformed/.test(sched) && !/skipped = "rulebook not readable"/.test(sched));
(async () => {
  const { buildRulesLink, readRulesCard } = await import(path.join(ROOT, "jobs/discord-scheduler.js"));
  const crypto = require("crypto");
  const CG = {};
  new Function("CG", R("src/live/part3_content.js"))(CG);
  const full = CG.CONTENT.rulebook;
  const cur = full.changelog[0];
  const slim = { changelog: [{ version: cur.version, date: cur.date || null, dateIso: cur.dateIso || null }], chapters: full.chapters.map((c) => ({ num: c.num, title: c.title })) };
  const h = (x) => crypto.createHash("sha256").update(JSON.stringify(buildRulesLink(x))).digest("hex");
  A("the published card builds the same #rules message as the whole rulebook did", h(slim) === h(full));
  /* jsonb reorders keys; the message must not depend on key order */
  const reordered = JSON.parse(JSON.stringify({ chapters: slim.chapters.map((c) => ({ title: c.title, num: c.num })), changelog: slim.changelog.map((c) => ({ version: c.version, dateIso: c.dateIso, date: c.date })) }));
  A("...whatever order the database returns its keys in", h(readRulesCard(JSON.stringify(reordered))) === h(full));
  A("readRulesCard refuses a card it cannot trust", readRulesCard("") === null && readRulesCard("{}") === null && readRulesCard("not json") === null &&
    readRulesCard(JSON.stringify({ changelog: [], chapters: [{ num: 1, title: "x" }] })) === null &&
    readRulesCard(JSON.stringify({ changelog: [{ version: "1" }], chapters: [] })) === null);
  console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
  process.exit(fail ? 1 : 0);
})();
