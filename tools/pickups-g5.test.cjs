/* S2 swap, stream g5 (2026-11-24): pickup games on the Season 2 site (src/s2/js/pages/pickups.js) are a PORT of the classic
   pickup tools (src/live: CG.ROUTES["pickup-import"], the Stats manager's pickup list, delete and editor, CG.ROUTES.pickup),
   not a rewrite. The commissioner ruled every tool must be native on the new site before the switch.
   1. The helpers that decide (what a line's Save sends, what Save game sends, what the import's answer says, which
      sittings may combine) run here on fixed inputs; the import's result text is checked word for word against the classic
      CG._puResultHtml on the same answers.
   2. Every write goes through S2.write to one of the four stats_pickup_* doors, with the classic call's argument names;
      the gate is the database's is_stats_staff, never a session flag; the page reads only the two pickup tables and the
      member list, and never a league table (memory pickup-stats-import: pickup lines never count toward league totals).
   3. demo.html carries the two tags where the brief puts them, and the EA calls go through S2.ea (no second fetch path).
   4. A member's pickup lines on their profile (CG.renderPickupStats, ported as S2.pickups.profileHtml for js/pages/profile.js):
      the result of a line, each role's figures, and the classic read's fields.
   The browser checks are tools/ui/pickups.test.cjs (run through tools/ui/run.cjs). Plain Node: node tools/pickups-g5.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "src/s2/js/pages/pickups.js"), "utf8");
const LIVE = fs.readFileSync(path.join(ROOT, "src/live/part_live.js"), "utf8");
const DEMO = fs.readFileSync(path.join(ROOT, "src/s2/demo.html"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "src/s2/css/pickups.css"), "utf8");
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 700) + ")")); if (!cond) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- load the page file with the smallest S2 it needs ---------- */
const pages = {};
const S2 = { esc: (s) => String(s == null ? "" : s), page: (k, d) => { pages[k] = d; }, session: { user: null }, holds: [] };
vm.runInContext(SRC, vm.createContext({ window: { S2 }, document: { addEventListener: () => {} }, Intl, Date, JSON, Math, Object, String, Array, Number, isNaN, parseInt, Promise, console }), { filename: "pickups.js" });
const P = S2._pickups && S2._pickups.pure;
A("the page registers #/pickups and exports the importer and the ported helpers", !!pages.pickups && !!P && typeof S2.pickups.importHtml === "function" && typeof S2.pickups.bindImport === "function");
A("the page repaints its own parts (nothing on it comes from the league read)", pages.pickups.repaintsItself === true);
A("a version reload waits while a write or an import is in flight (S2.holds)", S2.holds.length === 1 && S2.holds[0]() === false);

/* ---------- 1. the import's answer in words, against the classic CG._puResultHtml ---------- */
function classicResult(o) {
  const at = LIVE.indexOf("\nCG._puResultHtml = function"); if (at < 0) throw new Error("part_live.js has no CG._puResultHtml");
  const end = LIVE.indexOf("\n};\n", at);
  const CG = {}, ctx = vm.createContext({ CG, esc: (s) => String(s), Math, Object, String, Array });
  vm.runInContext(LIVE.slice(at + 1, end + 3), ctx, { filename: "part_live.js CG._puResultHtml" });
  const html = CG._puResultHtml(o), strip = (h) => h.replace(/<[^>]+>/g, "").trim();
  const head = strip(html.slice(0, html.indexOf('<div class="tasklist"'))).replace(/^Imported\.\s*/, "");
  const lines = html.split('<div class="titem">').slice(1).map((x) => ({ ok: /t-dot grn/.test(x), text: strip(x) }));
  return { head, lines };
}
const answers = [
  { ok: true, pickupGameId: "g1", sessions: 2, clubA: "Club One", clubB: "Club Two", players: [{ name: "P1", matched: true, side: "A", goals: 2, assists: 1 }, { name: "P2", matched: false, side: "B", goals: 1, assists: 0 }, { name: "P3", matched: true, side: "B", goals: 0, assists: 2 }] },
  { ok: true, pickupGameId: "g2", players: [{ name: "Solo", matched: true, side: "A", goals: 0, assists: 0 }] },
  { ok: true, pickupGameId: "g3", sessions: 1, players: [{ matched: false, side: "C" }, { name: "Z", matched: true, side: "B", goals: "3", assists: null }] },
  { ok: true, pickupGameId: "g4", players: [] }];
answers.forEach((o, i) => {
  const mine = P.result(o), cl = classicResult(o);
  A("result text " + (i + 1) + ": the same sentence as the classic", mine.head === cl.head, [mine.head, cl.head]);
  A("result text " + (i + 1) + ": the same player lines, unmatched first, in the same order", same(mine.lines, cl.lines), [mine.lines, cl.lines]);
});

/* ---------- the line patch (CG._smRenderDetail collect) ---------- */
const vals = { profile_id: "p1", is_goalie: false, goals: "3", assists: "", shots: "abc", plus_minus: "-2" };
let p = P.linePatch(vals, "p1");
A("Save on a line: an unmoved picker sends no member (never a silent unassign)", !("profile_id" in p), p);
A("numbers go as integers in text, a blank or junk as 0, a minus kept; the goaltender mark as true or false", p.goals === "3" && p.assists === "0" && p.shots === "0" && p.plus_minus === "-2" && p.is_goalie === false, p);
A("a moved picker sends the member", P.linePatch(vals, "p0").profile_id === "p1");
A("moving the picker to Unassigned sends the empty value, which the door reads as unlink", P.linePatch({ profile_id: "" }, "p1").profile_id === "");
A("an unlinked line left unlinked sends no member", !("profile_id" in P.linePatch({ profile_id: "" }, null)));

/* ---------- the game patch (Save game) ---------- */
const m = { club_a: "A", club_b: "B", score_a: "6", score_b: "", went_ot: true, played_at: "2026-11-20" };
p = P.metaPatch(m, "2026-11-20");
A("Save game: an unchanged date is not sent", !("played_at" in p), p);
A("a blank score leaves the score as it is; a typed one goes as a number; the overtime mark as true or false", p.score_a === 6 && !("score_b" in p) && p.went_ot === true && p.club_a === "A", p);
A("a changed date is anchored at midday Eastern, so the day shown never moves", P.metaPatch(m, "2026-11-19").played_at === "2026-11-20T17:00:00.000Z");
const g = { club_a: "A", club_b: "B", score_a: 6, score_b: 3, went_ot: true, played_at: "2026-11-20T17:00:00.000Z" };
A("the read back agrees with what was sent: nothing reported", same(P.metaHeld(P.metaPatch(m, "2026-11-19"), g), []), P.metaHeld(P.metaPatch(m, "2026-11-19"), g));
A("a read back that disagrees names each field the league did not take", same(P.metaHeld({ score_a: 7, went_ot: false, played_at: "2026-11-21T17:00:00.000Z", club_b: "C" }, g), ["Club B", "Score A", "Overtime", "Date"]));
A("a blank club name is not compared (the door keeps the old one)", same(P.metaHeld({ club_a: "" }, g), []));

/* ---------- the profile's section (CG.renderPickupStats, review 2026-11-24: "They show on player profiles" was not true) ---------- */
const gm = (o) => Object.assign({ id: "g", club_a: "A", club_b: "B", score_a: 4, score_b: 2, went_ot: false, played_at: "2026-11-20T02:00:00Z" }, o);
A("a line's result is read from its side and the score, as the classic's sideScores", P.lineResult({ team_side: "A", pickup_games: gm() }) === "W" && P.lineResult({ team_side: "b", pickup_games: gm() }) === "L" &&
  P.lineResult({ team_side: "B", pickup_games: gm({ went_ot: true }) }) === "OTL" && P.lineResult({ team_side: null, pickup_games: gm() }) === null && P.lineResult({ team_side: "A", pickup_games: gm({ score_b: null }) }) === null);
const sk = [{ team_side: "A", goals: 2, assists: 1, shots: 5, hits: 3, pim: 2, plus_minus: 1, pickup_games: gm() }, { team_side: "B", goals: 0, assists: 2, shots: 3, hits: 1, pim: 0, plus_minus: -3, pickup_games: gm() }];
A("a skater's figures are the classic's cells: games, goals, assists, points, plus-minus, shots, shooting %, hits, PIM", same(P.roleFigures(sk, false),
  [["Games", 2], ["Goals", 2], ["Assists", 3], ["Points", 5], ["Plus-minus", "-2"], ["Shots", 8], ["Shooting %", "25%"], ["Hits", 4], ["Penalty minutes", 2]]), P.roleFigures(sk, false));
const gl = [{ team_side: "A", saves: 20, shots_against: 22, goals_against: 2, shutout: false, pickup_games: gm() }, { team_side: "A", saves: 15, shots_against: 15, goals_against: 0, shutout: true, pickup_games: gm({ score_a: 0, score_b: 1, went_ot: true }) },
  { team_side: "B", saves: 10, shots_against: 14, goals_against: 4, pickup_games: gm() }];
A("a goaltender's figures are the classic's cells: games, record, save %, GAA, saves, goals against, shutouts", same(P.roleFigures(gl, true),
  [["Games", 3], ["Record", "1-1-1"], ["Save %", ".882"], ["GAA", "2.00"], ["Saves", 45], ["Goals against", 6], ["Shutouts", 1]]), P.roleFigures(gl, true));
A("a role with no shots says a dash, never NaN", same(P.roleFigures([{ team_side: "A", pickup_games: gm() }], true)[2], ["Save %", "–"]) && same(P.roleFigures([{ team_side: "A", pickup_games: gm() }], false)[6], ["Shooting %", "–"]));
const PUB = fs.readFileSync(path.join(ROOT, "src/live/part5a_public.js"), "utf8");
const classicSel = (PUB.match(/CG\.sb\.from\("pickup_stats"\)\s*\.select\("([^"]+)"\)\s*\.eq\("profile_id"/) || [])[1] || "";
const mySel = (SRC.match(/PROF_SEL = "([^"]+)"/) || [])[1] || "";
const flat = (sel) => sel.replace(/pickup_games\(([^)]*)\)/, (m, inner) => inner.split(",").map((f) => "pickup_games." + f).join(",")).split(",");
A("the profile reads every field the classic profile's pickup read did, by profile_id", classicSel && mySel && flat(classicSel).every((f) => flat(mySel).indexOf(f) >= 0) &&
  /\.from\("pickup_stats"\)\.select\(PROF_SEL\)\.eq\("profile_id", pid\)/.test(SRC), { classicSel, mySel });
A("a full page of lines is refused, never shown short (the classic CG.sbCapped rule)", /rows\.length >= API_MAX\) throw new Error/.test(SRC));
A("the profile's section is exported for js/pages/profile.js", typeof S2.pickups.profileHtml === "function");
let threw = false; try { S2.pickups.profileHtml(""); } catch (e) { threw = /profile id/.test(e.message); }
A("asked with no profile id, it throws rather than draw nothing", threw);
/* i3d (2026-11-25): the demo and fixture pages had no league client and kept the section out without asking; the site
   always has one, so the read is asked and, until it answers, the section waits hidden (a failure is said: tools/ui/pickups) */
A("the section asks the league for the member's lines, and waits hidden and busy until it answers", /^<section class="pu-sec pu-prof" id="puProf" data-pid="p1" aria-busy="true" hidden><\/section>$/.test(S2.pickups.profileHtml("p1")), S2.pickups.profileHtml("p1"));

/* ---------- the rest ---------- */
A("the editor's date is the Eastern day, as every page shows it", P.etDate("2026-11-21T02:30:00Z") === "2026-11-20" && P.etDate("2026-11-21T17:00:00Z") === "2026-11-21" && P.etDate(null) === "");
A("a game reads as the classic list's line", P.scoreText({ club_a: "A", club_b: "B", score_a: 5, score_b: 3 }) === "A 5, B 3" && P.scoreText({}) === "Club A ?, Club B ?");
const ms = [{ matchId: "1", a: { name: "X" }, b: { name: "Y" } }, { matchId: "2", a: { name: "Y" }, b: { name: "X" } }, { matchId: "3", a: { name: "X" }, b: { name: "Z" } }];
A("sittings combine only between the same two clubs, whichever side EA lists first", P.samePair(ms, { 1: true, 2: true }) && !P.samePair(ms, { 1: true, 3: true }) && P.samePair(ms, {}));

/* ---------- 2. the doors ---------- */
const writes = [...SRC.matchAll(/S2\.write\("([a-z_]+)",\s*\{([^}]*)\}/g)].map((x) => ({ rpc: x[1], keys: x[2].split(",").map((k) => k.split(":")[0].trim()).filter(Boolean) }));
const DOORS = ["stats_pickup_row", "stats_pickup_row_delete", "stats_pickup_update_game", "stats_pickup_delete"];
A("every write goes through S2.write to a stats_pickup_* door", writes.length >= 5 && writes.every((w) => DOORS.indexOf(w.rpc) >= 0), writes);
A("all four classic doors are wired", DOORS.every((d) => writes.some((w) => w.rpc === d)), writes.map((w) => w.rpc));
const classicCalls = [...LIVE.matchAll(/CG\.sb\.rpc\("(stats_pickup_[a-z_]+)",\s*\{([^}]*)\}/g)].map((x) => ({ rpc: x[1], keys: x[2].split(",").map((k) => k.split(":")[0].trim()).filter(Boolean) }));
A("the classic site calls the same four doors", DOORS.every((d) => classicCalls.some((c) => c.rpc === d)), classicCalls.map((c) => c.rpc));
A("each door takes the classic call's argument names", writes.every((w) => classicCalls.some((c) => c.rpc === w.rpc && same(c.keys, w.keys))), { writes, classicCalls });
A("no write opts into Owner approval or a league section re-read (pickup data is not in the league read)", !/S2\.write\([^)]*approval/.test(SRC) && !/sections:/.test(SRC));
A("the page never calls fetch itself: the import goes through S2.ea (g2's port of CG.eaPost)", !/\bfetch\(/.test(SRC) && /ea\(\)\.post\("\/api\/pickup-import"/.test(SRC));
const reads = [...SRC.matchAll(/\.from\("([a-z_]+)"\)/g)].map((x) => x[1]);
A("the page reads only the pickup tables and the member list", reads.length > 0 && reads.every((t) => ["pickup_games", "pickup_stats", "profiles"].indexOf(t) >= 0), reads);
A("no league table and no league door appears in the page (pickup lines never reach league totals)", !/game_stats|stats_game_|"games"|roster_spots|forfeit_game|ingest-stats/.test(SRC));
A("the gate is the database's is_stats_staff, read once per member", /c\.rpc\("is_stats_staff"\)/.test(SRC) && /function gate\(\)/.test(SRC));
A("no session flag or role hint stands in for the gate", !/session\.isStaff|session\.isCommissioner|S2\.has\(/.test(SRC));
A("the classic list's read is kept: newest 60 with their line counts", /pickup_stats\(count\)/.test(SRC) && /order\("played_at", \{ ascending: false \}\)\.limit\(LIST_MAX\)/.test(SRC) && /LIST_MAX = 60/.test(SRC));
A("the classic merge rules are kept: up to four sittings, a sitting under 45 minutes flagged", /MERGE_MAX = 4/.test(SRC) && /SHORT_MIN = 45/.test(SRC));
A("the router is never run to repaint", !/S2\.route\(/.test(SRC) && !/location\.reload/.test(SRC));
A("user text reaches HTML only through esc (no raw template of a row field)", !/\+ (g|x|c|m|o)\.(club_a|club_b|skater_name|name|gamertag) \+/.test(SRC));

/* ---------- 3. the page is on the site ---------- */
const tpl = DEMO.slice(DEMO.indexOf('<template id="s2-scripts">'), DEMO.indexOf("</template>"));
A("demo.html: the script sits inside the template, right after js/pages/gamedesk.js", /<script src="js\/pages\/gamedesk\.js"><\/script>\n<script src="js\/pages\/pickups\.js"><\/script>/.test(tpl));
A("demo.html: the stylesheet sits right after desk.css", /<link rel="stylesheet" href="css\/desk\.css">\n<link rel="stylesheet" href="css\/pickups\.css">/.test(DEMO));
A("the stylesheet keeps to its namespace and the tokens (no glass)", !/backdrop-filter|box-shadow/.test(CSS) && CSS.split("\n").filter((l) => /^\s*\.[a-z]/.test(l)).every((l) => /^\s*\.pu-/.test(l)), CSS.split("\n").filter((l) => /^\s*\.[a-z]/.test(l) && !/^\s*\.pu-/.test(l)));
A("no em dash in the page's words", !/—/.test(SRC) && !/—/.test(CSS));

console.log("\n" + n + " checks, " + fails + " failed");
process.exit(fails ? 1 : 0);
