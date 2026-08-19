/* The depth pack — the defects the surface survey turned up, plus the features built on top.
   Run: node tools/depth-pack.test.cjs

   Each block names the bug it exists to prevent, because every one of these shipped BROKEN and
   the breakage was invisible: a confident wrong answer, a tiebreaker that returned zeros, a
   health check that said green while a feed was dark. Anything with arithmetic is DRIVEN with
   fixtures — source greps alone let a computed-then-discarded value ship (see the audit that
   preceded this work).

   Note when extracting functions from this codebase: several close with " };" (leading space),
   so the terminator has to be /\n *\};/ and not /\n\};/. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js");
const hub = R("src/live/part6_hub.js");
const pub = R("src/live/part5a_public.js");
const pub2 = R("src/live/part5b_public2.js");
const engine = R("src/live/part2_engine.js");
const ui = R("src/live/part4_ui.js");
const sched = R("netlify/functions/discord-scheduler.js");
const ingest = R("netlify/functions/ingest-stats.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const grab = (src, name) => {
  const m = src.match(new RegExp("CG\\." + name + " = function[\\s\\S]*?\\n *\\};"));
  if (!m) { A("located CG." + name, false); process.exit(1); }
  return m[0];
};

console.log("— a player is told only when he IS playing, never when he is not");
{
  /* Two rounds got us here. First: loadManagerData early-returns for non-management, so
     lg._lineups was never populated for a player, plannedLineup returned all-nulls, and
     tonightCard printed "You're a scratch tonight" to someone in the starting six. Then the
     commissioner's call — drop the not-playing message entirely. The card now makes exactly ONE
     claim, a positive one read off a real lineup row, so there is no longer a wrong thing for it
     to say: an unposted lineup, a failed fetch and a genuine scratch all render the same neutral
     slate note. */
  A("nothing tells a player he is sitting", !/scratch tonight/.test(hub.replace(/\/\*[\s\S]*?\*\//g, "")) &&
    !/not in tonight’s lineup/.test(hub) && !/hasn’t posted tonight’s lineup/.test(hub));
  A("the card only speaks when the player is dressed", /var note = \(myGame && inLineup\)/.test(hub));
  A("...and otherwise falls back to the plain slate note", /Tap any game for confirmed lines/.test(hub));
  A("a player loads his own club's lineups", /CG\.loadMyLineups = function/.test(live));
  A("...through the anon-readable game_lineups table", /loadMyLineups[\s\S]{0,900}from\("game_lineups"\)/.test(live));
  A("...for every signed-in role, not just management",
    /CG\.loadMyLineups\(\);\s+\/\* every role/.test(live));
  A("...and a failed fetch leaves the answer UNKNOWN rather than asserting a scratch",
    /if \(r && r\.error\) return;\s+\/\* leave it UNKNOWN/.test(live));
  A("the now-pointless posted/not-posted helper is gone rather than left dangling",
    !/CG\.lineupPosted = function/.test(live));
  A("...and the card takes only what it uses", /CG\.tonightCard\(me, tonight, inLineup\)/.test(hub));
  A("a cached 'none yet' can become a real lineup — the cache is re-seeded each pass",
    /mine\.forEach\(function\(g\)\{ CG\._pubLineups\[me\.team\+":"\+g\.id\] = null; \}\);/.test(live));
  A("...and the hub re-checks on arrival, throttled", /CG\.now\(\) - \(CG\._myLineupsAt\|\|0\) > 60000/.test(live));
  A("the fetch window covers everything tonight can show", /var from = CG\.now\(\) - 12\*3600000;/.test(live));

  /* plannedLineup is still what decides "dressed", and it must only ever say yes off a real row */
  const ctx = { console, Math, Object, Array, String, Number, JSON };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.CG = { _pubLineups: {}, store: { get: () => ({}) }, lg: { _lineups: {} } };
  vm.createContext(ctx);
  vm.runInContext(grab(live, "plannedLineup"), ctx);
  const g = { id: "g1" };
  const dressed = (slots, id) => Object.values(slots).indexOf(id) >= 0;
  A("nothing fetched -> not dressed, so the card stays silent",
    dressed(ctx.CG.plannedLineup(g, "NYI"), "p1") === false);
  ctx.CG._pubLineups["NYI:g1"] = null;          /* fetched, no lineup exists */
  A("no lineup posted -> still not dressed, still silent",
    dressed(ctx.CG.plannedLineup(g, "NYI"), "p1") === false);
  ctx.CG._pubLineups["BOS:g1"] = { center: "p1", lw: null, rw: null, ld: null, rd: null, goalie: null };
  A("a real row naming the player IS dressed — the one case that speaks",
    dressed(ctx.CG.plannedLineup(g, "BOS"), "p1") === true);
  A("...and a real row NOT naming him stays silent",
    dressed(ctx.CG.plannedLineup(g, "BOS"), "p9") === false);
}

console.log("\n— head-to-head actually breaks ties now");
{
  /* it read r.homeScore / r.awayScore, which the live league object does not carry (rows are
     { home, away, score:{CODE:goals}, ot, forfeit }), so every row hit the null guard and the
     whole tiebreaker returned zeros for everyone. */
  A("it reads the score map, not the fields that never existed",
    /var hs = r\.score\[r\.home\], as = r\.score\[r\.away\];/.test(engine) &&
    !/=\s*r\.homeScore/.test(engine));   /* the phrase survives in the comment explaining the bug */
  const ctx = { console, Math, Object, Array, String, Number, JSON };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.CG = {};
  vm.createContext(ctx);
  vm.runInContext(grab(engine, "h2hPoints"), ctx);
  const res = [
    { home: "A", away: "B", score: { A: 4, B: 1 } },                    /* A reg win  */
    { home: "B", away: "A", score: { B: 3, A: 2 }, ot: true },          /* B OT win   */
    { home: "A", away: "C", score: { A: 5, C: 0 } },                    /* not in pair */
    { home: "A", away: "B", score: { A: 0, B: 6 }, forfeit: "B" },      /* B forfeited */
  ];
  const out = ctx.CG.h2hPoints({ results: res }, ["A", "B"]);
  A("a regulation win is 2, an OT loss is 1, a forfeit hands the win over",
    out.A === 2 + 1 + 2 && out.B === 2, JSON.stringify(out));
  A("games outside the tied group are ignored", !("C" in out));
  A("a forfeit never awards the OT point", (() => {
    const o = ctx.CG.h2hPoints({ results: [{ home: "A", away: "B", score: { A: 1, B: 1 }, ot: true, forfeit: "A" }] }, ["A", "B"]);
    return o.B === 2 && o.A === 0;
  })());
}

console.log("\n— the race is computed, not hand-typed");
{
  A("clinch no longer comes from a config list nobody maintained",
    /CG\.clinchedCodes = function/.test(engine) && /clinchedCfg/.test(live));
  A("...and is resolved only after the table exists", /lg\.race = CG\.raceMath\(lg\);/.test(live));
  const ctx = { console, Math, Object, Array, String, Number, JSON };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.CG = { playoffPerDiv: () => 4 };
  vm.createContext(ctx);
  vm.runInContext(grab(engine, "raceMath"), ctx);
  vm.runInContext(grab(engine, "clinchedCodes"), ctx);
  const codes = ["A", "B", "C", "D", "E", "F"];
  ctx.CG.TEAMS = codes.map((c) => ({ code: c, div: "East" }));
  const rec = (w, l, otl) => ({ w, l, otl });
  const done = { teams: { A: rec(10,0,0), B: rec(9,1,0), C: rec(8,2,0), D: rec(7,3,0), E: rec(2,8,0), F: rec(1,9,0) }, schedule: [] };
  A("a finished season clinches exactly the top four", ctx.CG.clinchedCodes(done).sort().join(",") === "A,B,C,D");
  A("...and eliminates the rest", ctx.CG.raceMath(done).F.eliminated && ctx.CG.raceMath(done).E.eliminated);
  const sch = []; for (let i = 0; i < 10; i++) codes.forEach((c) => sch.push({ stage: "regular", status: "scheduled", home: c, away: "Z" }));
  const fresh = { teams: Object.fromEntries(codes.map((c) => [c, rec(0,0,0)])), schedule: sch };
  const r2 = ctx.CG.raceMath(fresh);
  A("nobody is clinched or eliminated on opening night",
    !Object.values(r2).some((x) => x.clinched) && !Object.values(r2).some((x) => x.eliminated));
  A("...and it says so honestly rather than inventing a magic number", r2.A.magic === null);
  A("a club still alive on its ceiling is not eliminated", (() => {
    const s3 = []; codes.forEach((c) => s3.push({ stage: "regular", status: "scheduled", home: c, away: "Z" }));
    const r3 = ctx.CG.raceMath({ teams: { A: rec(15,0,0), B: rec(0,15,0), C: rec(0,15,0), D: rec(0,15,0), E: rec(0,15,0), F: rec(0,15,0) }, schedule: s3 });
    return r3.A.clinched === true && r3.F.eliminated === false;
  })());
  A("only unplayed REGULAR games count as remaining", (() => {
    const r4 = ctx.CG.raceMath({ teams: { A: rec(1,0,0), B: rec(0,1,0), C: rec(0,0,0), D: rec(0,0,0), E: rec(0,0,0), F: rec(0,0,0) },
      schedule: [{ stage: "preseason", status: "scheduled", home: "A", away: "B" }, { stage: "regular", status: "final", home: "A", away: "B" }] });
    return r4.A.left === 0;
  })());
}

console.log("\n— an unconfigured Discord feed can no longer read as healthy silence");
{
  /* four jobs returned a bare string when their webhook was unset, so sum.errors stayed empty
     and the result row said ok:true while a public feed was dark forever. */
  A("unconfigured is tracked separately from errors", /sum = \{ errors: \[\], unconfigured: \[\] \}/.test(sched));
  A("...and every one of the four names itself",
    (sched.match(/unconfigured\.push\(/g) || []).length === 4);
  A("...and it reaches the persisted result row",
    /unconfigured: sum\.unconfigured, unconfiguredCount: sum\.unconfigured\.length/.test(sched));
  A("errors still drive ok, so an unset feed does not page forever", /ok: errs\.length === 0/.test(sched));
  A("...and the Automations chip actually READS it — otherwise it still painted green",
    /res\.unconfiguredCount > 0/.test(live) && /Feed unset/.test(live));
}

console.log("\n— the small lies");
{
  A("rookie ignores THIS season's draft, so the current class stays rookies",
    /if \(p\.player_id && \(p\.season_number\|\|0\) < curSnR\) draftedBefore\[p\.player_id\] = true;/.test(live) &&
    /p\.rookie = !\(draftedBefore\[p\.id\] \|\| priorSeason\[p\.id\]\)/.test(live));
  A("...and isReturning is untouched, since the pool + free-agency board depend on it",
    /lg\.isReturning = function\(pid\)\{ return !!\(draftedEver\[pid\] \|\| priorSeason\[pid\]\); \};/.test(live));
  A("...so it is no longer hardcoded false", !/rookie: false/.test(live));
  A("the pickup-import page the bot links is findable", /route:"#\/pickup-import"/.test(ui));
  A("...but not parked in the global nav — it writes stats onto other members' profiles",
    !/\["Pickup import","#\/pickup-import"/.test(ui));
}

console.log("\n— recognition: stars survive the night, and radars have something to compare to");
{
  A("there is a season stars board", /if \(tab==="board"\)/.test(pub2));
  A("...as its own tab", /\["board","Stars board"\]/.test(pub2));
  A("...weighted 3/2/1", /t\.pts \+= 3;[\s\S]{0,120}t\.pts \+= 2;[\s\S]{0,80}t\.pts \+= 1;/.test(pub2));

  A("league-average DNA exists", /CG\.leagueDNA = function/.test(pub));
  A("...and the radars actually pass it now",
    /CG\.vizRadar\(CG\.SKATER_DNA_AXES, CG\.skaterDNA\(s\), CG\.leagueDNA\(/.test(pub) &&
    /CG\.vizRadar\(CG\.GOALIE_DNA_AXES, CG\.goalieDNA\(s\), CG\.leagueDNA\(/.test(pub));

  const ctx = { console, Math, Object, Array, String, Number, JSON };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.CG = {};
  vm.createContext(ctx);
  ["skaterDNA", "goalieDNA", "leagueDNA"].forEach((f) => vm.runInContext(grab(pub, f), ctx));
  ctx.CG.posGroup = (p) => p === "G" ? "G" : (p === "LD" || p === "RD") ? "D" : "F";
  const sk = (g, a, sh) => ({ gp: 10, g, a, shots: sh, blk: 5, tk: 5, hits: 10, pim: 6, pm: 2, gwg: 1 });
  const lg = { players: [{ id:"1",pos:"C" },{ id:"2",pos:"C" },{ id:"3",pos:"C" },{ id:"4",pos:"LW" },{ id:"5",pos:"RW" },{ id:"7",pos:"RW" },{ id:"6",pos:"LD" }],
               pstats: { "1": sk(10,10,50), "2": sk(5,5,40), "3": sk(0,0,10), "4": sk(3,3,20), "5": sk(7,2,30), "7": sk(2,6,18), "6": sk(1,4,12) } };
  const fwd = ["1","2","3","4","5","7"];
  const avg = ctx.CG.leagueDNA(lg, false, "F");
  const mean = (ids) => { const v = ids.map((k) => ctx.CG.skaterDNA(lg.pstats[k]));
    return v[0].map((_, i) => Math.round(v.reduce((a, x) => a + x[i], 0) / v.length)); };
  A("the forward average is the mean of the forward lines",
    JSON.stringify(avg) === JSON.stringify(mean(fwd)), JSON.stringify(avg));
  A("...and excluding a player drops exactly him from the mean",
    JSON.stringify(ctx.CG.leagueDNA(lg, false, "F", "1")) === JSON.stringify(mean(["2","3","4","5","7"])));
  A("...which for a 6-man field leaves 5, exactly the floor",
    ctx.CG.leagueDNA(lg, false, "F", "1") !== null);
  A("too few lines returns null rather than a fake average", ctx.CG.leagueDNA(lg, false, "D") === null);
  A("the legend names the group in English, not a raw code",
    /CG\.posGroupLabel = function/.test(pub) && !/League average at "\+/.test(pub));
  A("...and the comparison excludes the player himself", /if \(exceptId && pl\.id === exceptId\) return;/.test(pub));
  A("a player with no games is not averaged in",
    ctx.CG.leagueDNA({ players: [{id:"a",pos:"C"},{id:"b",pos:"C"},{id:"c",pos:"C"}], pstats: { a:{gp:0}, b:{gp:0}, c:{gp:0} } }, false, "F") === null);
  A("no league object never throws", ctx.CG.leagueDNA(null, false) === null);
}

console.log("\n— the night comes back to you");
{
  A("every linked player gets their own line after a game", /async function postGameRecaps/.test(ingest));
  A("...batched into one insert", /sbSend\("POST", "notifications", notes, "return=minimal"\)/.test(ingest));
  A("...and a recap failure can never fail the import",
    /postGameRecaps\([\s\S]{0,120}\.catch\(/.test(ingest));
  A("goalies get saves, skaters get points", /save\$\{sv === 1 \? "" : "s"\}/.test(ingest) && /point\$\{pts === 1 \? "" : "s"\}/.test(ingest));
  A("...told apart by the explicit is_goalie flag, not by sniffing fields", /const isG    = !!r\.is_goalie/.test(ingest));
  A("a re-import replaces the recap instead of stacking another",
    /notifications\?type=eq\.stat&link_view=eq\.game&link_param=eq\./.test(ingest));
  A("...and the lag-out merge REISSUES it, so nobody is left holding the partial score",
    /postGameRecaps\(\{ id: cand\.id/.test(ingest));
  A("...with the dead status guard gone", !/wasFinal/.test(ingest));
  A("a recap that sent is recorded in the run summary", /summary\.recaps = summary\.recaps \|\| \[\]/.test(ingest));
  A("the notification opens the box score", /case "game":\s+return p \? "#\/matchup\/"/.test(live));
  A("...and carries its own icon rather than a generic bell", /stat:"chart"/.test(live));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
