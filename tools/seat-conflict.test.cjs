/* One seat, one holder (Rule 2.6) — the failsafe on management appointments.
   Run: node tools/seat-conflict.test.cjs

   Why this file exists: the approval path called _assign_team_role, which overwrote the seat
   column unconditionally. Staff proved it by getting a second nomination approved for a club
   that already had that seat filled — the incumbent was evicted silently, the club read as
   having two of a position, and two applications sat in the archive both marked "approved".
   The database now refuses the write; CG.seatConflict asks the same question BEFORE the ballot
   so a reviewer never spends a deciding vote on something that cannot be honored. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js");
const desk = R("src/live/part9_staffdesks.js");
const content = R("src/live/part3_content.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, Date };
ctx.window = ctx; ctx.globalThis = ctx; ctx.CG = {};
vm.createContext(ctx);
{
  const m = live.match(/CG\.seatConflict = function[\s\S]*?\n\};/);
  if (!m) { A("located CG.seatConflict", false); process.exit(1); }
  vm.runInContext(m[0], ctx);
}
const CG = ctx.CG;

/* the real shape: NYI have all three seats filled, TOR have only an owner */
const NYI = { id: "t-nyi", code: "NYI", name: "Islanders", owner: "p-easy", gm: "p-chase", agm: "p-lemieux" };
const TOR = { id: "t-tor", code: "TOR", name: "Maple Leafs", owner: "p-fart", gm: null, agm: null };
CG.TEAM = { NYI, TOR };
CG.TEAMS = [NYI, TOR];
const lg = {
  _idToCode: { "t-nyi": "NYI", "t-tor": "TOR" },
  _profName: { "p-easy": "Easy pickins", "p-chase": "Chase Pidgeon", "p-lemieux": "Lemieux4ever",
               "p-new": "IIphostryII", "p-free": "dillybar6787" },
  _mgmtApps: [],
};
const app = (over) => Object.assign({ id: "a1", team_id: "t-nyi", role: "gm", status: "pending",
  nominee_id: "p-new", nominee: { gamertag: "IIphostryII" } }, over || {});

console.log("— the case staff actually hit: a second nomination for a filled seat");
{
  const c = CG.seatConflict(app(), lg);
  A("a filled GM seat is flagged", c && c.kind === "filled", c && c.kind);
  A("...the chip names the seat", c.chip === "GM seat filled", c.chip);
  A("...the text names who holds it", /Chase Pidgeon/.test(c.text), c.text);
  A("...with no broken possessive on a plural club name", !/Islanders’s|Islanders's/.test(c.text));
  A("...and says approving will not seat the nominee", /will not seat IIphostryII/.test(c.text));
  A("...citing the rule", /Rule 2\.6/.test(c.text));
  const agm = CG.seatConflict(app({ role: "agm" }), lg);
  A("a filled AGM seat is flagged the same way", agm && agm.kind === "filled" && agm.chip === "AGM seat filled",
    agm && agm.chip);
  A("...naming the AGM, not the GM", /Lemieux4ever/.test(agm.text) && !/Chase/.test(agm.text));
  A("...and gets its article right: 'an Assistant GM', not 'a Assistant GM'",
    /holds an Assistant GM/.test(agm.text) && !/holds a Assistant GM/.test(agm.text), agm.text);
  A("a General Manager keeps 'a'", /holds a General Manager/.test(c.text), c.text);
  A("the remedy names who can actually act, not a page reviewers cannot open",
    /commissioner vacates the seat/.test(c.text) && !/Control Center/.test(c.text), c.text);
}

console.log("\n— what must NOT be flagged, or the desk cries wolf");
{
  A("a vacant seat is clean", CG.seatConflict(app({ team_id: "t-tor" }), lg) === null);
  A("re-approving the sitting holder is clean (no self-conflict)",
    CG.seatConflict(app({ nominee_id: "p-chase" }), lg) === null);
  A("an owner application is not a seat nomination", CG.seatConflict({ role: "owner" }, lg) === null);
  A("a club we cannot resolve returns null rather than guessing",
    CG.seatConflict(app({ team_id: "t-ghost" }), lg) === null);
  A("no application at all returns null", CG.seatConflict(null, lg) === null);
  A("a missing league object does not throw", CG.seatConflict(app(), null) === null || true);
}

console.log("— one person, one club seat — including inside a single club");
{
  /* Chase runs NYI; nominating him at Toronto would strip his NYI seat out from under him */
  const c = CG.seatConflict(app({ team_id: "t-tor", nominee_id: "p-chase", nominee: { gamertag: "Chase Pidgeon" } }), lg);
  A("holding a seat at another club is flagged", c && c.kind === "holds-seat", c && c.kind);
  A("...naming the club and the post", /General Manager of Islanders/.test(c.text), c.text);

  /* THE HOLE THE REVIEW FOUND: the club's own AGM moved into its own vacant GM seat. Both the old
     client check and the old SQL excluded the nomination's own club, so this passed every guard —
     and seating them emptied the AGM seat with nobody deciding it. */
  const openGm = { id: "t-nyi2", code: "NYI2", name: "Islanders", owner: "p-easy", gm: null, agm: "p-lemieux" };
  const lgP = { _idToCode: { "t-nyi2": "NYI2" }, _profName: lg._profName, _mgmtApps: [] };
  const savedTeam = CG.TEAM, savedTeams = CG.TEAMS;
  CG.TEAM = { NYI2: openGm }; CG.TEAMS = [openGm];
  const promo = CG.seatConflict({ id: "a5", team_id: "t-nyi2", role: "gm", status: "pending",
    nominee_id: "p-lemieux", nominee: { gamertag: "Lemieux4ever" } }, lgP);
  A("promoting a club's own AGM into its own vacant GM seat is flagged",
    promo && promo.kind === "holds-seat", promo && promo.kind);
  A("...naming the seat they would be vacating", /already the Assistant GM of Islanders/.test(promo.text), promo && promo.text);
  /* and the no-op: re-approving whoever already sits in the very seat is not a conflict */
  const same = CG.seatConflict({ id: "a6", team_id: "t-nyi2", role: "agm", status: "pending",
    nominee_id: "p-lemieux", nominee: { gamertag: "Lemieux4ever" } }, lgP);
  A("re-approving the sitting holder of that same seat is clean", same === null, same && same.kind);
  CG.TEAM = savedTeam; CG.TEAMS = savedTeams;
}

console.log("\n— two nominations racing for the same seat");
{
  const lg2 = Object.assign({}, lg, { _mgmtApps: [
    { id: "a1", team_id: "t-tor", role: "gm", status: "pending", nominee_id: "p-new" },
    { id: "a2", team_id: "t-tor", role: "gm", status: "pending", nominee_id: "p-free" },
    { id: "a3", team_id: "t-tor", role: "agm", status: "pending", nominee_id: "p-free" },   /* other seat */
    { id: "a4", team_id: "t-tor", role: "gm", status: "denied", nominee_id: "p-free" },     /* already decided */
  ] });
  const c = CG.seatConflict({ id: "a1", team_id: "t-tor", role: "gm", status: "pending", nominee_id: "p-new" }, lg2);
  A("rival pending nominations for one seat are flagged", c && c.kind === "contested", c && c.kind);
  A("...counting exactly the live rivals, not other seats or decided rows", c.chip === "2 nominations", c.chip);
  A("a lone nomination is not 'contested'",
    CG.seatConflict({ id: "a3", team_id: "t-tor", role: "agm", status: "pending", nominee_id: "p-free" }, lg2) === null);
}

console.log("\n— a vote that carried but could not be seated stays open and says so");
{
  /* the approval RPC records the obstacle on the row rather than seating anything, so acting on
     the advice (vacating the seat) cannot make the outstanding work disappear */
  const c = CG.seatConflict(app({ seat_block: "The General Manager seat at Islanders is held by Chase Pidgeon." }), lg);
  A("a recorded block is surfaced", c && c.kind === "heldup", c && c.kind);
  A("...verbatim, so the reason cannot drift from the database", /held by Chase Pidgeon/.test(c.text));
  A("...and it survives the seat being vacated (the advice being followed)", (() => {
    const cleared = Object.assign({}, TOR);           /* a club with no GM at all */
    const lgV = Object.assign({}, lg, { _idToCode: { "t-tor": "TOR" } });
    void cleared; void lgV;
    return CG.seatConflict({ id: "a9", team_id: "t-tor", role: "gm", status: "pending",
      nominee_id: "p-free", seat_block: "still blocked" }, lg).kind === "heldup";
  })());
  A("a decided application is history, not a live verdict",
    CG.seatConflict(app({ status: "approved" }), lg) === null);
  A("...denied too", CG.seatConflict(app({ status: "denied" }), lg) === null);
  A("...and withdrawn", CG.seatConflict(app({ status: "withdrawn" }), lg) === null);
}

console.log("\n— the failsafe is wired into every surface a reviewer votes from");
{
  A("the Review Board desk computes it per row", /var seatWarn = \(isMgmt && CG\.seatConflict\)/.test(desk));
  A("...renders the chip on the row", /seatWarn \? '<span class="chip chip-warn chip-xs" title=/.test(desk));
  A("...and leads the board with a banner when something cannot be seated",
    /cannot be seated as things stand/.test(desk) && /blocked\.length/.test(desk));
  A("...counting only true blocks, not merely contested seats", /c\.kind!=="contested"/.test(desk));
  A("...and splits the roll-up by cause, since the remedies differ",
    /kind==="filled"/.test(desk) && /kind==="holds-seat"/.test(desk) && /kind==="heldup"/.test(desk));
  A("...telling the board only a commissioner can vacate a seat", /Only a commissioner can vacate a seat/.test(desk));
  A("Team HQ no longer offers Replace on a held seat", !/\(holder\?"Replace":"Nominate"\)/.test(live));
  A("...saying who clears it instead", /Seat held — a commissioner vacates it/.test(live));
  A("...and the how-it-works note stops promising an automatic overwrite",
    /an approval into a seat that is still held is refused/.test(live));
  A("the Staff Desk queue flags it too", /var sc = isMgmt \? CG\.seatConflict\(a, lg\) : null;/.test(live));
  A("the application detail warns ABOVE the ballot", (() => {
    const i = live.indexOf("That seat is already filled");
    const j = live.indexOf("CG.appBallotSection(type, a, decided)");
    return i > 0 && j > i;
  })());
  A("the conflict text is escaped into the title attribute", /title="'\+esc\(sc\.text\)\+'"/.test(live));
}

console.log("\n— the rulebook says it, so the site and the book agree");
{
  const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
  const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" "); };
  const r26 = sec("2.6");
  A("Rule 2.6 says a seat is held by one person", /Each seat is held by one person and one person only/.test(r26));
  A("...and one club seat per person league-wide", /one person holds at most one club seat league-wide/.test(r26));
  A("...and that appointing into a held seat is refused",
    /appointment through the application process into a seat that is already held is refused/.test(r26));
  A("...and that the incumbent goes first, so nobody is displaced silently",
    /steps down, or is removed by the league office, before a successor can be approved/.test(r26) &&
    /no manager is displaced by an appointment without being told/.test(r26));
  A("the changelog records it", rb.changelog.some((c) => c.version === "2.23" && /refused rather than applied/.test(c.summary)));
  A("...in American spelling", !rb.changelog.some((c) => /practis|colour|centre|organis/i.test(c.summary)));
  A("Rule 2.6 keeps the office's own power to seat and unseat, which set_team_manager still does",
    /league office retains its power to seat and unseat management directly/.test(sec("2.6")));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
