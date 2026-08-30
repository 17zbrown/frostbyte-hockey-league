/* Draft night propagation: a pick must appear on every other board the instant it is made.
   Run: node tools/draft-realtime.test.cjs

   Before: the realtime handler called loadManagerData — FIFTEEN queries, of which two concern
   the draft — so every pick made every manager in the league refetch owner applications, staff
   ballots, game vetoes and a resolve_game_server RPC per upcoming game, and the board only
   updated after the slowest round trip. The event payload itself was thrown away.
   Now: the payload is applied in memory (zero network), the room repaints, and one coalesced
   draft-only refetch reconciles behind it.

   This DRIVES the real functions extracted from part_live.js against a fake Supabase channel. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = { console, Math, Object, Array, String, Number, JSON, Date, setTimeout, clearTimeout, Promise };
ctx.window = ctx; ctx.globalThis = ctx;
let queries = 0, repaints = 0;
ctx.location = { hash: "#/hub/draft" };
ctx.document = { getElementById: () => null, activeElement: null };
ctx.CG = {
  now: () => Date.now(),
  SEASON: { number: 1, id: "s1" },
  sb: { from: () => { queries++; return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }; } },
  rerenderKeepScroll: () => { repaints++; },
  router: () => { repaints++; },
  contractHeldIds: () => ({}),
};
vm.createContext(ctx);
for (const fn of ["mapDraftData", "applyDraftRow", "applyDraftState", "repaintDraft", "refreshDraftLite", "reconcileDraftSoon"]) {
  const m = src.match(new RegExp("CG\\." + fn + " = (?:async )?function[\\s\\S]*?\\n\\};"));
  if (!m) { A("located CG." + fn, false); process.exit(1); }
  vm.runInContext(m[0], ctx);
}

const CLUBS = { t1: "TOR", t2: "BOS" };
ctx.CG.lg = {
  _idToCode: CLUBS, _profName: { p1: "Sniper99", p2: "Dangle_47" }, _rosteredIds: {},
  _registrationsRaw: [
    { profile_id: "p1", season_id: "s1", profiles: { gamertag: "Sniper99" }, position: "C", scout_ovr: 80 },
    { profile_id: "p2", season_id: "s1", profiles: { gamertag: "Dangle_47" }, position: "LD", scout_ovr: 75 },
  ],
  _draftPicksRaw: [
    { id: "k1", season_number: 1, round: 1, overall_pick: 1, original_team_id: "t1", current_team_id: "t1", player_id: null, used: false, skipped: false },
    { id: "k2", season_number: 1, round: 1, overall_pick: 2, original_team_id: "t2", current_team_id: "t2", player_id: null, used: false, skipped: false },
  ],
  draftState: { season_number: 1, status: "live", current_overall: 1 },
};
ctx.CG.mapDraftData(ctx.CG.lg, ctx.CG.lg._draftPicksRaw, ctx.CG.lg._registrationsRaw);

(async () => {
  console.log("— another club's pick lands with no network round trip");
  {
    A("both prospects start in the pool", ctx.CG.lg.draftPool.length === 2);
    queries = 0; repaints = 0;
    // exactly what supabase delivers when TOR uses pick #1 on Sniper99
    const applied = ctx.CG.applyDraftRow({ id: "k1", season_number: 1, round: 1, overall_pick: 1,
      original_team_id: "t1", current_team_id: "t1", player_id: "p1", used: true, skipped: false, picked_at: "2026-09-26T23:05:00Z" });
    A("the payload is applied in place", applied === true);
    A("ZERO queries to show it", queries === 0, `${queries} queries`);
    const p1 = ctx.CG.lg.draftPicks.find((p) => p.id === "k1");
    A("the board shows the selection immediately", p1.used === true && p1.playerName === "Sniper99");
    A("...and the drafted player leaves the pool at once",
      ctx.CG.lg.draftPool.length === 1 && ctx.CG.lg.draftPool[0].profileId === "p2");
    ctx.CG.repaintDraft();
    A("the room repaints", repaints === 1);
  }

  console.log("\n— the clock/on-the-clock state is just as immediate");
  {
    queries = 0;
    A("a draft_state payload applies", ctx.CG.applyDraftState({ season_number: 1, status: "live", current_overall: 2 }) === true);
    A("...with no query", queries === 0);
    A("...and the room is on pick 2", ctx.CG.lg.draftState.current_overall === 2);
    A("another season's state is ignored", ctx.CG.applyDraftState({ season_number: 2, current_overall: 9 }) === false);
  }

  console.log("\n— reconcile is coalesced and draft-only");
  {
    queries = 0;
    for (let i = 0; i < 12; i++) ctx.CG.reconcileDraftSoon();   // a burst of picks
    await tick(900);
    A("a burst of 12 events causes ONE refetch", queries === 2, `${queries} queries (2 = picks + state)`);
    A("...not the 15-query manager reload", queries < 15);
  }

  console.log("\n— nothing is repainted out from under an open dialog or a typed field");
  {
    repaints = 0;
    ctx.document.getElementById = (id) => (id === "overlay-root" ? { innerHTML: "<div>a modal</div>" } : null);
    ctx.CG.repaintDraft();
    A("an open modal is never yanked away", repaints === 0);
    ctx.document.getElementById = () => null;
    ctx.location.hash = "#/home";
    ctx.CG.repaintDraft();
    A("...and nothing repaints when nobody is in the draft room", repaints === 0);
    ctx.location.hash = "#/hub/draft";
  }

  console.log("\n— the source no longer routes realtime through the heavy reload");
  {
    const sub = src.match(/CG\.subscribeDraft = function[\s\S]*?\n\};/)[0];
    A("realtime applies the payload instead of refetching everything",
      /applyDraftRow\(p\.new\)/.test(sub) && !/table: ?"draft_picks" ?\}, ?function\(\)\{ ?CG\.refreshDraft\(\)/.test(sub));
    A("a DELETE (key-only payload) falls through to the reconcile", /p\.eventType !== "DELETE"/.test(sub));
    A("the fallback heartbeat uses the light path, not the 15-query one",
      /CG\.refreshDraftLite\(\)\.then\(CG\.repaintDraft\)/.test(src) &&
      !/CG\._draftBeatAt = CG\.now\(\); CG\.refreshDraft\(\);/.test(src));
    A("the raw board is retained everywhere it is loaded",
      (src.match(/_draftPicksRaw = /g) || []).length >= 4);
  }

  console.log(`\n${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
})();
