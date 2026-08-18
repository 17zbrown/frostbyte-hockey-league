/* The five features shipped 2026-08-13: Road to 5, the Get-set-up checklist, draft spectator
   mode, the deadline-day band, and the board-coverage meter.
   Run: node tools/features-aug13.test.cjs

   The pure functions are extracted and DRIVEN — the audit that preceded this build showed that
   source-grep assertions alone let a computed-then-discarded value ship, so anything with
   arithmetic in it runs here with fixtures. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const live = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");
const pub = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part5a_public.js"), "utf8");
const hub = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part6_hub.js"), "utf8");
const ui = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part4_ui.js"), "utf8");
const sync = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "discord-sync.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, Date, Intl,
  parseFloat, parseInt, isFinite, isNaN, Infinity, encodeURIComponent };
ctx.window = ctx; ctx.globalThis = ctx; ctx.CG = { PRESEASON_MIN_GP: 5 };
ctx.esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
vm.createContext(ctx);
{
  const tm = pub.match(/CG\.TX_MOVE_TYPES = \[.*?\];/);
  if (!tm) { A("located CG.TX_MOVE_TYPES", false); process.exit(1); }
  vm.runInContext(tm[0], ctx);
}
for (const [src, fns] of [[live, ["roadToFive", "setupChecklist", "boardCoverage", "mapDraftData", "dayAdd", "etISO", "etYMD"]],
                          [pub, ["movementDeadlineTs", "deadlineBand", "teamMoves", "txText"]]]) {
  for (const fn of fns) {
    const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};"));
    if (!m) { A("located CG." + fn, false); process.exit(1); }
    vm.runInContext(m[0], ctx);
  }
}
const CG = ctx.CG;
CG.now = () => Date.parse("2026-09-20T18:00:00-04:00");   /* mid-pre-season, fixed */

console.log("— Road to 5: the classification every surface shares");
{
  const lg = {
    byTeam: { SEA: [
      { id: "vet", tag: "Old Guard", pos: "C", origin: "preseason_random" },
      { id: "done", tag: "Finisher", pos: "LW", origin: "preseason_random" },
      { id: "close", tag: "Nearly", pos: "RD", origin: "preseason_random" },
      { id: "stuck", tag: "Benched", pos: "G", origin: "preseason_random" },
      { id: "signed", tag: "Contracted", pos: "RW", origin: "assigned" },   /* not random — not gated */
    ] },
    preGp: { done: { gp: 6 }, close: { gp: 3 }, stuck: { gp: 0 } },
    isVeteran: (pid) => pid === "vet",
    schedule: [
      /* three unplayed pre-season games for SEA: Nearly (needs 2) makes it, Benched (needs 5) cannot */
      { stage: "preseason", status: "scheduled", home: "SEA", away: "BOS" },
      { stage: "preseason", status: "scheduled", home: "VAN", away: "SEA" },
      { stage: "preseason", status: "scheduled", home: "SEA", away: "DAL" },
      { stage: "preseason", status: "final", home: "SEA", away: "COL" },     /* played — not remaining */
      { stage: "regular", status: "scheduled", home: "SEA", away: "BOS" },   /* wrong stage */
    ],
  };
  const rows = CG.roadToFive(lg, "SEA");
  A("only randomly assigned players are gated", rows.length === 4 && !rows.some(r => r.pid === "signed"));
  const by = {}; rows.forEach(r => by[r.pid] = r);
  A("a returning player is exempt and done", by.vet.exempt && by.vet.done);
  A("five games is done", by.done.done && by.done.need === 0);
  A("3 of 5 with 3 games left is reachable", !by.close.done && by.close.need === 2 && by.close.reachable);
  A("0 of 5 with 3 games left cannot reach five", !by.stuck.done && !by.stuck.reachable);
  A("the players in danger sort first, most behind on top",
    rows[0].pid === "stuck" && rows[1].pid === "close", rows.map(r => r.pid).join(","));
  A("an unknown club returns an empty list, never throws", CG.roadToFive(lg, "XXX").length === 0);
  A("a missing league object returns an empty list", CG.roadToFive(null, "SEA").length === 0);
}

console.log("\n— the Get-set-up checklist");
{
  CG.discordJoinLink = () => "https://discord.gg/x";
  const c1 = CG.setupChecklist({ in_guild: true, ea_id: "Z" }, { position: "C" }, true);
  A("all three done reads complete", c1.complete && c1.done === 3);
  const c2 = CG.setupChecklist({ in_guild: false, ea_id: null }, null, true);
  A("nothing done reads 0 of 3", !c2.complete && c2.done === 0);
  A("...the Discord step carries the join link", c2.items[0].href === "https://discord.gg/x" && c2.items[0].ext);
  A("...the register step links the register page", c2.items[2].href === "#/register" && c2.items[2].cta === "Register to play");
  const c3 = CG.setupChecklist({ in_guild: true, ea_id: "Z" }, null, false);
  A("registration closed drops the register CTA but not the item", c3.items[2].cta === null && !c3.complete);
  A("a null profile does not throw", !CG.setupChecklist(null, null, true).complete);
}

console.log("\n— board coverage");
{
  const pool = [{ profileId: "a" }, { profileId: "b" }, { profileId: "c" }, { profileId: "d" }];
  A("a drafted player no longer counts as covered",
    CG.boardCoverage(["a", "gone1", "gone2"], pool, 1).available === 1);
  A("comfortably more names than picks is ok", CG.boardCoverage(["a","b","c","d"], pool, 1).level === "ok");
  A("exactly enough is thin", CG.boardCoverage(["a","b"], pool, 2).level === "thin");
  A("fewer names than picks is short", CG.boardCoverage(["a"], pool, 3).level === "short");
  A("no picks left is done", CG.boardCoverage([], pool, 0).level === "done");
  A("empty inputs never throw", CG.boardCoverage(null, null, 2).level === "short");
}

console.log("\n— the movement deadline, computed like the database computes it");
{
  ctx.CG.SEASON = { trade_deadline_week: 6 };
  ctx.CG.lg = { schedule: [
    { stage: "regular", week: 6, at: Date.parse("2026-11-18T21:00:00-05:00") },
    { stage: "regular", week: 6, at: Date.parse("2026-11-20T22:10:00-05:00") },  /* Friday, last */
    { stage: "regular", week: 7, at: Date.parse("2026-12-02T21:00:00-05:00") },
    { stage: "preseason", week: 6, at: Date.parse("2026-11-21T21:00:00-05:00") }, /* wrong stage */
  ] };
  const ts = CG.movementDeadlineTs();
  A("lands at midnight ET after the last Friday game",
    ts === Date.parse("2026-11-21T00:00:00-05:00"), new Date(ts).toISOString());
  ctx.CG.lg = { schedule: [] };
  A("no schedule = no deadline, never a made-up date", CG.movementDeadlineTs() === null);
  ctx.CG.SEASON = {};
  A("no deadline week = null too", CG.movementDeadlineTs() === null);
}

console.log("\n— the deadline band shows the right face at the right time");
{
  const DAY = 86400000;
  const base = Date.parse("2026-11-21T00:00:00-05:00");
  ctx.CG.SEASON = { trade_deadline_week: 6 };
  ctx.CG.lg = { schedule: [{ stage: "regular", week: 6, at: base - 2 * 3600000 }],
                liveTransactions: [{ type: "trade", text: "<b>Trade</b> happened", at: base - 3600000 }] };
  CG.now = () => base - 10 * DAY;
  A("ten days out: silence", CG.deadlineBand() === "");
  CG.now = () => base - 3 * DAY;
  A("three days out: the countdown, no wire yet",
    /dlClock/.test(CG.deadlineBand()) && !/The wire/.test(CG.deadlineBand()));
  CG.now = () => base - 3 * 3600000;
  A("deadline day: countdown + the wire", /Deadline day/.test(CG.deadlineBand()) && /The wire/.test(CG.deadlineBand()));
  CG.now = () => base + 3600000;
  A("after midnight: rosters are frozen", /Rosters are frozen/.test(CG.deadlineBand()));
  CG.now = () => base + 3 * DAY;
  A("days later: silence again", CG.deadlineBand() === "");
  A("the tick writes textContent only — the countdown can never repaint the page",
    /el\.textContent = \(d\? d\+"d " : ""\)/.test(pub) && !/CG\.router\(\)[\s\S]{0,80}_dlTimer/.test(pub));
  A("the band renders on the home page", /html \+= CG\.deadlineBand\(\);/.test(pub));
}

console.log("\n— draft spectator mode wiring");
{
  A("the managers-only wall is gone from the draft room",
    !/Managers only<\/b><p>The draft board and prospect pool/.test(live));
  A("spectators get their own data loader (draft tables are public-read)",
    /CG\.loadSpectatorDraft = async function/.test(live));
  A("refreshDraft picks the loader by role", /role==="mgmt"\|\|role==="commish"\|\|role==="staff"\) \? CG\.loadManagerData\(\) : CG\.loadSpectatorDraft\(\)/.test(live));
  A("spectators subscribe to the live channel too",
    /CG\._spectatorDraftTried = true;[\s\S]{0,220}CG\.subscribeDraft\(\);/.test(live));
  A("the pick ticker exists for every viewer", /Latest picks/.test(live));
  A("spectators never see the scout pool", /what you see is what the league sees/.test(live));
  A("every pick posts to #draft-hub via the sweep-maintained webhook",
    /discord_draft_webhook/.test(sync) && /CGHL Draft/.test(sync));
  A("...and ensurePublicText now returns the channel it ensured",
    /return existing;/.test(sync) && /return ch;[\s\S]{0,200}return null;\n  \}/.test(sync));
}

console.log("\n— the two Road-to-5 surfaces and the checklist are rendered and wired");
{
  A("Team HQ roster page carries the club tracker", /Road to 5 — draft eligibility/.test(hub));
  A("...with the can't-reach flag", /can’t reach 5/.test(hub));
  A("Pre-season Central carries the office view", /Road to 5 — draft eligibility/.test(live) && /Can’t reach 5/.test(live));
  A("the hub dashboard renders the checklist off the shared helper", /CG\.setupChecklist\(p, reg, !!s\.registration_open\)/.test(live));
  A("...and its EA button is actually bound", /clEaBtn[\s\S]{0,120}CG\.promptEaId/.test(live));
  A("the draft desk carries the coverage meter", /Board coverage/.test(live) && /CG\.boardCoverage\(board, pool, picks\.length \? remainingMine : null\)/.test(live));
}

console.log("\n— the adversarial review's confirmed findings stay fixed");
{
  /* 1 · the deadline wire escapes and whitelists like every other transaction surface */
  const DAY = 86400000;
  const base = Date.parse("2026-11-21T00:00:00-05:00");
  ctx.CG.SEASON = { trade_deadline_week: 6 };
  ctx.CG.lg = { schedule: [{ stage: "regular", week: 6, at: base - 2 * 3600000 }],
    liveTransactions: [
      { type: "trade", text: "SEA traded <b>A</b>", at: base - 3600000 },
      { type: "sign", text: "hostile <img src=x onerror=alert(1)> name", at: base - 3600000 },
      { type: "registration", text: "Someone signed up", at: base - 3600000 },  /* member activity, not a move */
    ] };
  CG.now = () => base - 3 * 3600000;
  const band = CG.deadlineBand();
  A("a hostile gamertag in a description renders inert on the wire",
    band.indexOf("<img") === -1 && band.indexOf("&lt;img") >= 0);
  A("...while the DB's <b> emphasis survives", /<b>A<\/b>/.test(band));
  A("non-move activity never reaches the wire", band.indexOf("signed up") === -1);
  A("the band carries the id the tick repaints by", /id="dlBand"/.test(band));
  A("crossing midnight repaints the band frozen and stops the timer",
    /clearInterval\(CG\._dlTimer\); CG\._dlTimer = null;[\s\S]{0,240}band\.outerHTML = CG\.deadlineBand\(\)/.test(pub));

  /* 2 · board coverage knows "no pick order yet" from "no picks left" */
  A("no pick order yet is its own level, not 'done'", CG.boardCoverage(["a"], [], null).level === "pre");
  A("zero remaining picks is still 'done'", CG.boardCoverage(["a"], [], 0).level === "done");
  A("the chip pluralizes a single pick", /pick'\+\(cov\.remaining===1\?'':'s'\)/.test(live));
  A("the spectator note pluralizes the last pick", /leftN===1\?'1 pick remains':leftN\+' picks remain'/.test(live));
  A("the office chip pluralizes one player short", /nShort\+' player'\+\(nShort===1\?'':'s'\)\+' short</.test(live));

  /* 3 · the pool drains as the draft takes players */
  ctx.CG.contractHeldIds = () => ({});
  ctx.CG.SEASON = { id: "s1", number: 1 };
  const dlg = { _idToCode: {}, _profName: { p1: "Taken" }, _rosteredIds: {} };
  CG.mapDraftData(dlg,
    [{ id: "pk1", season_number: 1, round: 1, overall_pick: 1, used: true, player_id: "p1", picked_at: "2026-08-13T01:00:00Z" }],
    [{ profile_id: "p1", profiles: { gamertag: "Taken" } }, { profile_id: "p2", profiles: { gamertag: "Still here" } }]);
  A("a drafted player leaves the pool immediately",
    dlg.draftPool.length === 1 && dlg.draftPool[0].profileId === "p2",
    dlg.draftPool.map(r => r.profileId).join(","));
  A("...and the pick carries its timestamp", dlg.draftPicks[0].pickedAt === "2026-08-13T01:00:00Z");
  A("a prior-season pick does not shadow this season's pool", (() => {
    const l2 = { _idToCode: {}, _profName: {}, _rosteredIds: {} };
    CG.mapDraftData(l2, [{ id: "old", season_number: 0, used: true, player_id: "p1" }],
      [{ profile_id: "p1", profiles: { gamertag: "Back in the pool" } }]);
    return l2.draftPool.length === 1;
  })());

  /* 4 · the ticker orders by when the pick was made, not its number */
  A("the ticker sorts on pickedAt with overall as the legacy fallback",
    /Date\.parse\(b\.pickedAt\|\|""\)\|\|0\)-\(Date\.parse\(a\.pickedAt\|\|""\)\|\|0\) \|\| \(b\.overall\|\|0\)-\(a\.overall\|\|0\)/.test(live));
  A("both draft selects fetch picked_at",
    (live.match(/from\("draft_picks"\)\.select\("[^"]*picked_at/g) || []).length === 2);

  /* 5 · spectator hardening */
  A("only draft-running roles fire the auto-advance RPC",
    /canAdvance && !CG\._draftAdvancing/.test(live) && /r==="mgmt"\|\|r==="commish"\|\|r==="staff"/.test(live));
  A("a dead realtime channel is dropped so the room can resubscribe",
    /CHANNEL_ERROR/.test(live) && /CG\._draftChannel=null;/.test(live));
  A("leaving the draft room clears the one-shot fetch latch",
    /hashchange[\s\S]{0,140}CG\._spectatorDraftTried = false/.test(live));
  A("pre-start copy never says 'your club' to a clubless viewer",
    /spectate \|\| role==="staff" \? 'the first pick goes' : 'your club/.test(live));

  /* 6 · the room is reachable */
  A("the home timeline's draft-night row goes to the draft room", /\["Draft night", sD\.draft_at, "[^"]*", "#\/draft"\]/.test(pub));
  A("the command palette knows the draft room", /route:"#\/draft"/.test(ui));

  /* 7 · the checklist can no longer offer a dead-end button */
  const c4 = CG.setupChecklist({ in_guild: true, ea_id: "Z" }, null, false);
  A("registration closed nulls the href, not just the label", c4.items[2].href === null && c4.items[2].cta === null);
  A("the renderer requires both href and label — no 'Fix' fallback", /it\.href && it\.cta \?/.test(live) && !/it\.cta\|\|"Fix"/.test(live));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
