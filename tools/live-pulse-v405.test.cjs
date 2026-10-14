/* v4.05 (2026-10-14). Commissioner: "How can me make the entire website auto refresh changes so people dont have to go
   manually refresh the page all the time?" and "maximize the efficiency of this project so I dont use up all of our
   netlify usage." Rehearsed on production rolled back, then applied as v405_live_pulse: no-op saves marked nothing, a
   lobby-code change marked codes only, two score changes one scores mark, a box-score change its game, the flush folded
   four domains into one pulse update, and members can read the pulse but neither the marks nor write. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-14-live-pulse-v405.sql"), live = R("src/live/part_live.js"), build = R("src/live/build.cjs"),
      toml = R("netlify.toml"), head = R("src/live/part1_head.html");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got))); } };

console.log("— the database");
A("marks are statement-level and never fail the write they ride on",
  /exception when others then\n\s+raise warning 'live pulse mark/.test(sql) && /for each statement execute function public\._live_mark/.test(sql));
A("an update marks only when a row really changed, columns that do not matter left out",
  /select exists \(select to_jsonb\(n\) - \$1 from new_rows n except select to_jsonb\(o\) - \$1 from old_rows o\)/.test(sql));
A("17 public tables are watched, box scores by game, codes on their own",
  (sql.match(/^\s+\('[a-z_]+',\s+'[a-z]+',/gm) || []).length === 17 && /\('game_stats',\s+'stats',\s+'game_id'/.test(sql) &&
  /create trigger live_mark_games_codes after update on public\.games/.test(sql));
A("private profile columns never mark", /'discord_id,discord_username,ban_reason,banned_at,banned_by,is_admin,platform_gamertag'/.test(sql));
A("one pulse update at most every 10 seconds", /cron\.schedule\('live-flush', '10 seconds', 'select public\.live_flush\(\)'\)/.test(sql) &&
  /if v_n > 0 then\n\s+update public\.live_pulse set v = v_new, d = v_d, at = now\(\) where id = 1;/.test(sql));
A("the pulse is readable by everyone and writable by no member; the marks by nobody",
  /create policy live_pulse_read on public\.live_pulse for select to anon, authenticated using \(true\);/.test(sql) &&
  /grant select on public\.live_pulse to anon, authenticated;/.test(sql) && /revoke all on public\.live_marks from public, anon, authenticated;/.test(sql));
A("the site build is read by the database every 10 minutes, never by members' pages",
  /cron\.schedule\('live-site-build', '\*\/10 \* \* \* \*'/.test(sql) && /net\.http_get\(url := 'https:\/\/chelgamingleague\.com\/version\.json'/.test(sql));
A("the watchdog alerts if changes stop reaching pages or the build check stops answering",
  /changes are waiting more than two minutes/.test(sql) && /\(''live-flush'', interval ''10 minutes''\)/.test(sql));
A("the cron history is purged daily (it had reached 82 MB), keeping each job's newest run",
  /cron\.schedule\('cron-history-purge', '23 4 \* \* \*',\n\s+\$\$delete from cron\.job_run_details d where d\.end_time < now\(\) - interval '3 days'\n\s+and d\.runid not in \(select max\(x\.runid\) from cron\.job_run_details x group by x\.jobid\)\$\$\);/.test(sql));
A("review fix: the build check's own requests never count as a dead Discord webhook",
  /insert into public\.live_site_requests \(id\) values \(v_req\)/.test(sql) && /and id not in \(select s\.id from public\.live_site_requests s\);/.test(sql) &&
  /delete from public\.app_config where key = 'wd_webhook_dead';/.test(sql));
A("review fix: an avatar flipping between two writers marks nothing", /'discord_id,discord_username,ban_reason,banned_at,banned_by,is_admin,platform_gamertag,avatar_url'/.test(sql));

console.log("— the build");
A("the live build stamps a content id into the page and version.json; a preview gets none",
  /if \(!LAYER\) \{/.test(build) && /createHash\("sha256"\)\.update\(head \+ "\\n" \+ body\)\.digest\("hex"\)\.slice\(0, 12\)/.test(build) &&
  /<meta name="cg-build" content="\$\{id\}">/.test(build) && /"version\.json"/.test(build));
A("version.json is never cached and never committed", /for = "\/version\.json"\n\s+\[headers\.values\]\n\s+Cache-Control = "no-cache"/.test(toml) && /^version\.json$/m.test(R(".gitignore")));
A("the update pill is styled", /\.cg-update-pill\{position:fixed/.test(head));

console.log("— the page");
A("the public channel listens to the pulse", /table:"live_pulse" \}, function\(p\)\{ CG\.pulseApply\(p && p\.new\); \}\)/.test(live));
A("the pulse is read before the league queries start, so nothing between the two is missed",
  /var pulseRow = \(CG\._readPulse && !CG\._pulseSeen\) \? await CG\._readPulse\(\) : null;\n  try \{\n    CG\.lg = await CG\.buildLiveLeague\(\);/.test(live));
A("review fix: lobby codes re-read through their slot and the boot cache keeps the newest answer",
  /if \(\(m\.codes \|\| k === "scores"\) && signedIn\) slots\[CG\.BOOT_CODES\] = 1;/.test(live) && /if \(CG\._bootCache\) CG\._bootCache\[CG\.BOOT_CODES\] = r;/.test(live));
A("review fix: a re-read sign-up pool or pick list is not overwritten by the office's older copy",
  /if \(slots\.indexOf\(9\) >= 0 \|\| slots\.indexOf\(10\) >= 0\)\{ skipCarry = \["_draftPicksRaw", "_registrationsRaw"\]; manager = true; \}/.test(live) &&
  /if \(!full\) CG\._carryLg\(prev, lg, skipCarry\);/.test(live));
A("review fix: what a delta could not read is retried, at most three times, later each time",
  /CG\._deltaFailed = \(failed\.slots\.length \|\| failed\.statsAll \|\| failed\.statsIds\) \? failed : null;/.test(live) &&
  /if \(f && \(CG\._liveRetries \|\| 0\) < 3\)\{/.test(live) && /if \(slots && \(CG\._liveRetries \|\| 0\) < 3\)\{/.test(live));
A("review fix: a slot the last full load could not read is read again", /q\.forEach\(function\(r, i\)\{ if \(i !== 12 && r && r\.error && slots\.indexOf\(i\) < 0\) slots\.push\(i\); \}\);/.test(live));
A("a hidden tab keeps its queue and runs it when looked at again", /if \(document\.visibilityState === "hidden"\)\{ CG\._liveHiddenOwed = true; return; \}/.test(live));
A("every automatic repaint goes through one door that waits while someone is busy", /\n      CG\.quietRepaint\(\);\n      \/\* what the delta could not read/.test(live) &&
  /if \(pvBusyInteracting\(\)\)\{ CG\._repaintOwed = true; CG\._armRepaintCheck\(\); return; \}/.test(live) && /return CG\._pageDirty\(\);/.test(live));

/* run the pulse code itself, with the page stubbed */
const start = live.indexOf("CG.LIVE_DOMAINS = {"), end = live.indexOf("/* armed once, after the first boot");
const code = live.slice(start, end);
function harness(opts){
  const calls = [], store = {};
  const ctx = {
    CG: { BOOT_PPO: 17, BOOT_CAREER: 18, BOOT_CODES: 19, role: () => opts.role || "guest", lg: { draftState: opts.draft ? { status: "live" } : null }, sb: null,
          liveReload: (o) => calls.push(o), refreshCodes: () => calls.push({ codes: true }) },
    document: { visibilityState: opts.hidden ? "hidden" : "visible", querySelector: () => ({ getAttribute: () => opts.build || "aaaaaaaaaaaa" }),
                getElementById: () => null, body: null, createElement: () => ({ addEventListener(){} }) },
    location: { hash: opts.hash || "#/home", hostname: opts.host || "chelgamingleague.com", reload: () => calls.push({ reload: true }) },
    sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    window: { pageYOffset: 0 }, setTimeout: (f) => f(), clearTimeout(){}, Math, Date, JSON, Object, Array, Number, String,
    pvBusyInteracting: () => !!opts.busy,
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { CG: ctx.CG, calls, store, ctx };
}
{
  const h = harness({});
  h.CG.pulseApply({ v: 5, d: { scores: { v: 5 }, stats: { v: 4, log: [[4, ["g1"]]] } } });
  A("the first pulse a page sees is only its baseline", h.calls.length === 0);
  h.CG.pulseApply({ v: 6, d: { scores: { v: 6 }, stats: { v: 4, log: [[4, ["g1"]]] } } });
  A("a score change re-reads the games and the ratings, nothing else", h.calls.length === 1 && JSON.stringify(h.calls[0].slots.sort((a, b) => a - b)) === "[6,17]", h.calls);
  h.calls.length = 0;
  h.CG.pulseApply({ v: 7, d: { scores: { v: 6 }, stats: { v: 7, log: [[7, ["g2", "g3"]], [4, ["g1"]]] } } });
  A("a box-score change re-reads just those games' lines", h.calls.length === 1 && JSON.stringify(h.calls[0].statsIds.sort()) === '["g2","g3"]' && !h.calls[0].statsAll, h.calls);
  h.calls.length = 0;
  const longLog = Array.from({ length: 24 }, (_, i) => [40 - i, ["x" + i]]);
  h.CG.pulseApply({ v: 40, d: { scores: { v: 6 }, stats: { v: 40, log: longLog } } });
  A("a gap in the box-score log re-reads the season's box scores", h.calls.length === 1 && h.calls[0].statsAll === true, h.calls);
}
{
  const h = harness({ hidden: true });
  h.CG.pulseApply({ v: 1, d: { rosters: { v: 1 } } });
  h.CG.pulseApply({ v: 2, d: { rosters: { v: 2 } } });
  A("a hidden tab fetches nothing and owes it", h.calls.length === 0 && h.CG._pulseOwed.rosters === true);
  h.ctx.document.visibilityState = "visible"; h.CG._pulseFlush();
  A("...and fetches it once looked at", h.calls.length === 1 && JSON.stringify(h.calls[0].slots.sort()) === "[4,5]");
}
{
  const h = harness({ hash: "#/rulebook" });
  h.CG.pulseApply({ v: 1, d: { news: { v: 1 } } });
  h.CG.pulseApply({ v: 2, d: { news: { v: 2 } } });
  A("a page that reads no league data owes the change instead of fetching it", h.calls.length === 0 && h.CG._pulseOwed.news === true);
}
{
  const h = harness({ role: "member" });
  h.CG.pulseApply({ v: 1, d: { codes: { v: 1 }, scores: { v: 1 } } });
  h.CG.pulseApply({ v: 2, d: { codes: { v: 2 }, scores: { v: 1 } } });
  A("a signed-in member re-reads lobby codes through the masked view's slot", h.calls.length === 1 && h.calls[0].slots.indexOf(19) >= 0, h.calls);
  h.calls.length = 0;
  h.CG.pulseApply({ v: 3, d: { codes: { v: 2 }, scores: { v: 3 } } });
  A("...and with every score change, so a rebuild never puts an older code back", h.calls.length === 1 && h.calls[0].slots.indexOf(19) >= 0);
  const g = harness({});
  g.CG.pulseApply({ v: 1, d: { codes: { v: 1 } } }); g.CG.pulseApply({ v: 2, d: { codes: { v: 2 } } });
  A("...a guest never asks", !g.calls.length || g.calls.every((c) => (c.slots || []).indexOf(19) < 0));
}
{
  const h = harness({ role: "mgmt" });
  h.CG.pulseApply({ v: 1, d: { picks: { v: 1 } } }); h.CG.pulseApply({ v: 2, d: { picks: { v: 2 } } });
  A("a pick change re-reads the picks and the office's own copy", h.calls.length === 1 && h.calls[0].manager === true && h.calls[0].slots.indexOf(9) >= 0);
  const d = harness({ draft: true, hash: "#/draft" });
  d.CG.pulseApply({ v: 1, d: { rosters: { v: 1 } } }); d.CG.pulseApply({ v: 2, d: { rosters: { v: 2 } } });
  A("during a live draft the draft room leaves rosters to its own channel", d.calls.length === 0);
  const e = harness({ draft: true, hash: "#/standings" });
  e.CG.pulseApply({ v: 1, d: { rosters: { v: 1 } } }); e.CG.pulseApply({ v: 2, d: { rosters: { v: 2 } } });
  A("...and every other page spreads the re-read over a minute", e.calls.length === 1 && e.calls[0].jitterMs >= 60000);
}
{
  const h = harness({ build: "aaaaaaaaaaaa" });
  h.CG._checkBuild("aaaaaaaaaaaa");
  h.CG._checkBuild("bbbbbbbbbbbb");
  A("a newer build on the live site is ready to take", h.CG._updateReady === "bbbbbbbbbbbb");
  A("...at the next click", h.CG._applyUpdate("nav") === true && h.calls.some((c) => c.reload) && JSON.parse(h.store.cg_update).tries === 1);
  h.store.cg_update = JSON.stringify({ target: "cccccccccccc", tries: 2, at: Date.now() });
  h.CG._updateReady = null; h.CG._checkBuild("cccccccccccc");
  A("...but never in a loop when the edge has not caught up", h.CG._updateReady === null);
  const lag = harness({ build: "bbbbbbbbbbbb" });
  lag.CG._checkBuild("aaaaaaaaaaaa");
  A("review fix: a page that loaded the new build while the database still names the old one does nothing", !lag.CG._updateReady);
  lag.CG._checkBuild("bbbbbbbbbbbb");
  A("...and nothing when the database catches up to it", !lag.CG._updateReady);
  const busy = harness({ build: "aaaaaaaaaaaa", busy: true });
  busy.CG._checkBuild("aaaaaaaaaaaa"); busy.CG._checkBuild("bbbbbbbbbbbb");
  A("an idle or returning page with a half-done form waits", busy.CG._applyUpdate("idle") === false && busy.CG._applyUpdate("return") === false);
  const work = harness({ build: "aaaaaaaaaaaa" });
  work.CG._checkBuild("aaaaaaaaaaaa"); work.CG._checkBuild("bbbbbbbbbbbb");
  work.CG._liveTrade = { offP: ["p1"], reqP: [], offK: [], reqK: [] };
  A("review fix: a trade being built holds the reload, even at the next click", work.CG._applyUpdate("nav") === false);
  work.CG._liveTrade = null; work.CG._lcDraft = { 1: { C: "p2" } };
  A("...and so do unsaved lines", work.CG._applyUpdate("nav") === false);
  const drafting = harness({ build: "aaaaaaaaaaaa", draft: true, hash: "#/hub/draft" });
  drafting.CG._checkBuild("aaaaaaaaaaaa"); drafting.CG._checkBuild("bbbbbbbbbbbb");
  A("review fix: no reload anywhere during a live draft, not only in the spectator room", drafting.CG._applyUpdate("nav") === false);
  const local = harness({ build: "aaaaaaaaaaaa", host: "localhost" });
  local.CG._checkBuild("aaaaaaaaaaaa"); local.CG._checkBuild("bbbbbbbbbbbb");
  A("a local or preview build never reloads itself", !local.CG._updateReady);
  const same = harness({ build: "aaaaaaaaaaaa" });
  same.CG._checkBuild("aaaaaaaaaaaa"); same.CG._checkBuild("aaaaaaaaaaaa");
  A("the same build is nothing to do", !same.CG._updateReady);
}
{
  /* review fix: an untouched single select shows its first enabled option and is clean */
  const pd = live.match(/CG\._pageDirty = function\(\)\{[\s\S]*?\n\};/)[0];
  const mkSel = (opts, idx, multiple) => ({ tagName: "SELECT", type: multiple ? "select-multiple" : "select-one", multiple: !!multiple, selectedIndex: idx, options: opts });
  const run = (els) => { const c = { CG: {}, document: { getElementById: () => ({ querySelectorAll: () => els }) } }; vm.createContext(c); vm.runInContext(pd, c); return c.CG._pageDirty(); };
  A("an untouched 'All clubs' select is clean", run([mkSel([{ defaultSelected: false, selected: true }, { defaultSelected: false, selected: false }], 0)]) === false);
  A("...a changed one is dirty", run([mkSel([{ defaultSelected: false }, { defaultSelected: false }], 1)]) === true);
  A("...one drawn on its second option and left there is clean", run([mkSel([{ defaultSelected: false }, { defaultSelected: true }], 1)]) === false);
  A("...a disabled placeholder first is skipped", run([mkSel([{ disabled: true }, { defaultSelected: false }], 1)]) === false);
  A("typed text is dirty", run([{ tagName: "INPUT", type: "text", value: "ab", defaultValue: "" }]) === true);
}

console.log("— the rulebook and changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const cl = CG.CONTENT.rulebook.changelog.find((c) => c.version === "4.05");
A("changelog 4.05 records it", !!cl && /update themselves/.test(cl.summary) && !/—/.test(JSON.stringify(cl)) && !/—/.test(sql));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
