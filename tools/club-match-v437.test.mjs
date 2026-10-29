// v4.37: matching an outside EA club to a league game from the Stats manager (Rule 4.6).
// Run: node tools/club-match-v437.test.mjs
//
// Commissioner, 2026-10-29: "What I would like you to add is the ability to seach a non-league club and match it to a
// team so we can file the league games by searching the club they used and entering their league game."
//
// What must never break: a club outside the league reads as a CGHL club only through a substitution recorded for ONE
// fixture (Rule 4.6), exactly as the importer reads it; a sitting with an unresolved club is offered the open games it
// could have been; the merge reads a recorded club as that fixture's side, so a game played partly under a club's own
// EA club and partly under a borrowed one is still one game; a borrowed club is never linked as a club's own by
// evidence; and the desk records the substitution through set_game_club_substitution before anything is filed.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.INGEST_KEY ||= "machine-key";
import fs from "node:fs";
import vm from "node:vm";
const { handler } = await import(new URL("../netlify/functions/ingest-stats.js", import.meta.url).pathname);

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  got: " + x : ""}`); };
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDay = (ms) => etFmt.format(new Date(ms));
const H = 3600000, MIN = 60000;
const base = Math.floor((Date.now() - 26 * H) / H) * H;   // yesterday, inside the default ten-day window
const iso = (ms) => new Date(ms).toISOString();

/* a raw EA sitting: clubs [{id, name, goals}], each with one skater carrying its goals */
const raw = (id, endMs, a, b, toi = 3600) => ({ matchId: id, timestamp: Math.floor(endMs / 1000),
  clubs: Object.fromEntries([a, b].map((x, i) => [x.id, { details: { name: x.name }, score: String(x.goals), result: x.goals > [b, a][i].goals ? "1" : "2" }])),
  players: Object.fromEntries([a, b].map((x) => [x.id, { [x.id + "p"]: { playername: x.name + " Skater", position: "center", skgoals: String(x.goals), toiseconds: String(toi) } }])) });
const BOS = (g) => ({ id: "111", name: "Bruins EA", goals: g });
const TOR = (g) => ({ id: "222", name: "Leafs EA", goals: g });
const PEN = (g) => ({ id: "777", name: "LGCHL Penticton Vees", goals: g });
const OUT = (g) => ({ id: "888", name: "Outsiders", goals: g });
const DAL = (g) => ({ id: "333", name: "Stars EA", goals: g });
const NEWC = (g) => ({ id: "555", name: "Pens New", goals: g });
const logRow = (r, status, gameId) => ({ ea_match_id: String(r.matchId), status, game_id: gameId || null, reason: null,
  et_day: etDay(r.timestamp * 1000), ea_club_ids: Object.keys(r.clubs), payload: r });

const TEAMS = [{ id: "T1", code: "BOS", ea_club_id: "111" }, { id: "T2", code: "TOR", ea_club_id: "222" },
  { id: "T3", code: "DAL", ea_club_id: "333" }, { id: "T4", code: "PIT", ea_club_id: null }];
const G = (id, home, away, at, over = {}) => ({ id, season_id: "s1", week: 3, scheduled_at: iso(at), home_team_id: home, away_team_id: away,
  status: "scheduled", ea_match_id: null, voided: false, forfeit_team_id: null, home_score: null, away_score: null, ...over });
let GAMES = [], LOG = [], SUBS = [], writes = [];
const pick = (u, re) => { const m = decodeURIComponent(u).match(re); return m ? m[1].split(",") : null; };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET", d = decodeURIComponent(u);
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  if (u.includes("/auth/v1/user")) return J({ id: "stats" });
  if (u.includes("/rest/v1/profiles?id=eq.stats")) return J([{ role: "staff", departments: ["statistics"], gamertag: "StatsGuy", banned: false }]);
  if (u.includes("proclubs.ea.com")) throw new Error("Netlify must never call EA itself: " + u);
  if (m !== "GET") {
    writes.push({ m, u: d, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes("/rest/v1/ea_ingest_log") && m === "PATCH") { const id = (d.match(/ea_match_id=eq\.([^&]+)/) || [])[1]; return J([{ ea_match_id: id }]); }
    if (u.includes("/rest/v1/ea_ingest_log") && m === "POST") return J(JSON.parse(opts.body).map((r) => ({ ea_match_id: r.ea_match_id })), 201);
    return J(null);
  }
  if (u.includes("/rest/v1/game_club_substitutions?")) {
    const g = (d.match(/game_id=eq\.([^&]+)/) || [])[1], e1 = (d.match(/ea_club_id=eq\.([^&]+)/) || [])[1], ein = pick(u, /ea_club_id=in\.\(([^)]*)\)/);
    return J(SUBS.filter((x) => (!g || x.game_id === g) && (!e1 || x.ea_club_id === e1) && (!ein || ein.includes(x.ea_club_id))));
  }
  if (u.includes("/rest/v1/teams?ea_club_id=eq.")) { const e = d.match(/ea_club_id=eq\.([^&]+)/)[1]; return J(TEAMS.filter((t) => t.ea_club_id === e).map((t) => ({ code: t.code }))); }
  if (u.includes("/rest/v1/teams?id=in.")) { const ids = pick(u, /id=in\.\(([^)]*)\)/); return J(TEAMS.filter((t) => ids.includes(t.id))); }
  if (u.includes("/rest/v1/teams?select=")) return J(TEAMS);
  if (u.includes("/rest/v1/games?id=eq.")) { const id = d.match(/id=eq\.([^&]+)/)[1]; return J(GAMES.filter((g) => g.id === id)); }
  if (u.includes("/rest/v1/games?id=in.")) { const ids = pick(u, /id=in\.\(([^)]*)\)/); return J(GAMES.filter((g) => ids.includes(g.id))); }
  if (u.includes("/rest/v1/games?ea_match_id=in.")) return J([]);
  if (u.includes("/rest/v1/games?status=eq.scheduled")) {
    const lo = Date.parse(d.match(/scheduled_at=gte\.([^&]+)/)[1]), hi = Date.parse(d.match(/scheduled_at=lte\.([^&]+)/)[1]);
    return J(GAMES.filter((g) => g.status === "scheduled" && !g.voided && !g.forfeit_team_id && Date.parse(g.scheduled_at) >= lo && Date.parse(g.scheduled_at) <= hi));
  }
  if (u.includes("/rest/v1/games?or=")) {
    const tl = pick(u, /home_team_id\.in\.\(([^)]*)\)/), lo = Date.parse(d.match(/scheduled_at=gte\.([^&]+)/)[1]), hi = Date.parse(d.match(/scheduled_at=lte\.([^&]+)/)[1]);
    return J(GAMES.filter((g) => (tl.includes(g.home_team_id) || tl.includes(g.away_team_id)) && Date.parse(g.scheduled_at) >= lo && Date.parse(g.scheduled_at) <= hi));
  }
  if (u.includes("/rest/v1/ea_ingest_log?ea_club_ids=cs.")) {
    const club = d.match(/cs\.\{([^}]+)\}/)[1], gte = d.match(/et_day=gte\.([0-9-]+)/)[1], lt = d.match(/et_day=lt\.([0-9-]+)/)[1];
    return J(LOG.filter((r) => r.ea_club_ids.includes(club) && r.et_day >= gte && r.et_day < lt));
  }
  if (u.includes("/rest/v1/ea_ingest_log?ea_match_id=in.")) { const ids = pick(u, /ea_match_id=in\.\(([^)]*)\)/); return J(LOG.filter((r) => ids.includes(r.ea_match_id))); }
  if (u.includes("/rest/v1/ea_ingest_log?game_id=eq.")) { const g = d.match(/game_id=eq\.([^&]+)/)[1]; return J(LOG.filter((r) => r.game_id === g)); }
  if (u.includes("/rest/v1/ea_ingest_log?game_id=in.")) { const ids = pick(u, /game_id=in\.\(([^)]*)\)/); return J(LOG.filter((r) => ids.includes(r.game_id))); }
  return J([]);
};
const post = async (b) => { const r = await handler({ httpMethod: "POST", headers: { authorization: "Bearer jwt" }, body: JSON.stringify(b) }); return { code: r.statusCode, o: JSON.parse(r.body) }; };

/* ---- the sittings list ---- */
const gS = G("gS", "T1", "T2", base), gS2 = G("gS2", "T2", "T3", base + 35 * MIN), gOld = G("gOld", "T1", "T2", base - 3 * 24 * H, { status: "final" });
const sMix = raw("mPen", base + 50 * MIN, BOS(2), PEN(3)), sBoth = raw("mBoth", base + 60 * MIN, OUT(1), PEN(4));
console.log("# the sittings list reads a recorded substitution, and offers the games an unresolved one could be");
{
  GAMES = [gS, gS2, gOld]; LOG = [logRow(sMix, "unmatched"), logRow(sBoth, "ignored")]; SUBS = [];
  let r = await post({ leagueSessions: { clubId: "777", ea: false } });
  const s = r.o.sessions.find((x) => x.matchId === "mPen");
  A("no substitution yet: BOS against an outside club needs one", r.code === 200 && s && s.kind === "needs-substitution" && s.canMerge === false, JSON.stringify(s && { kind: s.kind }));
  A("...offered BOS's open game in its window, saying TOR is the club that would have played under it", s.subCandidates.length >= 1 && s.subCandidates[0].gameId === "gS" && s.subCandidates[0].borrower === "TOR" && s.subCandidates[0].known === "BOS" && s.subCandidates[0].inWindow === true, JSON.stringify(s.subCandidates));
  A("...never a final game, nor a game BOS is not in", !s.subCandidates.some((c) => c.gameId === "gOld" || c.gameId === "gS2"));
  const b = r.o.sessions.find((x) => x.matchId === "mBoth");
  A("two outside clubs: any open game near it, with no club assumed", b && b.kind === "not-league" && b.subCandidates.some((c) => c.gameId === "gS") && b.subCandidates.some((c) => c.gameId === "gS2") && b.subCandidates.every((c) => c.borrower === null && c.known === null), JSON.stringify(b && b.subCandidates.map((c) => c.gameId)));

  SUBS = [{ game_id: "gS", ea_club_id: "777", team_id: "T2" }];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  const s2 = r.o.sessions.find((x) => x.matchId === "mPen");
  A("with the substitution on record: a league sitting pinned to that fixture", s2 && s2.kind === "league" && s2.fixture.gameId === "gS" && s2.canMerge === true && s2.subCandidates.length === 0, JSON.stringify(s2 && { kind: s2.kind, fx: s2.fixture && s2.fixture.gameId }));
  A("...and its club says it is TOR by substitution", s2.clubs.find((c) => c.eaId === "777").team === "TOR" && s2.clubs.find((c) => c.eaId === "777").via === "substitution" && s2.clubs.find((c) => c.eaId === "111").via === "linked");

  /* a club borrowed all night is recorded on each of its fixtures; overlapping windows go to the earliest open one */
  SUBS = [{ game_id: "gS", ea_club_id: "777", team_id: "T2" }, { game_id: "gS2", ea_club_id: "777", team_id: "T2" }];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  const s3 = r.o.sessions.find((x) => x.matchId === "mPen");
  A("a substitution on a game BOS is not in never pins BOS's sitting there", s3 && s3.kind === "league" && s3.fixture.gameId === "gS" && !s3.alternatives.some((x) => x.gameId === "gS2"), JSON.stringify(s3 && s3.fixture && s3.fixture.gameId));
  A("nothing written by the list", writes.length === 0, JSON.stringify(writes.map((w) => w.u)));
}

/* v4.37 review: the resolution reads the importer's way, and the candidates use the same two steps */
console.log("\n# both outside clubs, a club borrowed for two games of one night, and the in-window rule");
{
  GAMES = [gS, gS2]; LOG = [logRow(sBoth, "ignored")];
  SUBS = [{ game_id: "gS", ea_club_id: "888", team_id: "T1" }, { game_id: "gS", ea_club_id: "777", team_id: "T2" }];
  let r = await post({ leagueSessions: { clubId: "777", ea: false } });
  let b = r.o.sessions.find((x) => x.matchId === "mBoth"), c8 = b && b.clubs.find((c) => c.eaId === "888"), c7 = b && b.clubs.find((c) => c.eaId === "777");
  A("both outside clubs recorded on one game: a league sitting of that game", b && b.kind === "league" && b.fixture.gameId === "gS" && b.canMerge === true, JSON.stringify(b && { kind: b.kind, fx: b.fixture && b.fixture.gameId }));
  A("...each club names the game it is recorded on", c8.team === "BOS" && c8.subGame === "gS" && c7.team === "TOR" && c7.subGame === "gS" && c7.via === "substitution", JSON.stringify(b.clubs));
  SUBS = [{ game_id: "gS", ea_club_id: "777", team_id: "T2" }];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  b = r.o.sessions.find((x) => x.matchId === "mBoth"); c7 = b && b.clubs.find((c) => c.eaId === "777");
  A("only one of the two recorded: still waiting on the other club, on that game", b && b.kind === "needs-substitution" && b.fixture.gameId === "gS" && c7.team === "TOR" && c7.subGame === "gS" && b.clubs.find((c) => c.eaId === "888").team === null, JSON.stringify(b && { kind: b.kind, clubs: b.clubs }));
  A("...offered ONLY the game the first club is recorded on, the other club named (never a game where it would stand alone)", b.subCandidates.map((c) => c.gameId).join() === "gS" && b.subCandidates[0].borrower === "BOS" && b.subCandidates[0].known === "TOR", JSON.stringify(b.subCandidates));

  /* DAL and TOR meet twice in one night; TOR borrowed Penticton for both: the earliest still open is the slot */
  const gA = G("gA", "T2", "T3", base), gB = G("gB", "T3", "T2", base + 35 * MIN), sDal = raw("mDal", base + 50 * MIN, DAL(1), PEN(2));
  GAMES = [gA, gB]; LOG = [logRow(sDal, "unmatched")];
  SUBS = [{ game_id: "gA", ea_club_id: "777", team_id: "T2" }, { game_id: "gB", ea_club_id: "777", team_id: "T2" }];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  let d = r.o.sessions.find((x) => x.matchId === "mDal");
  A("a club borrowed for both games of a night: the earliest open one, the other offered", d && d.kind === "league" && d.fixture.gameId === "gA" && d.alternatives.some((x) => x.gameId === "gB") && d.ambiguous === true, JSON.stringify(d && { fx: d.fixture && d.fixture.gameId, alt: d.alternatives.map((x) => x.gameId), amb: d.ambiguous }));
  gA.ea_match_id = "held1";
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  d = r.o.sessions.find((x) => x.matchId === "mDal");
  A("...a held game still counts as open, so a continuation goes to the game it continues", d && d.fixture.gameId === "gA", JSON.stringify(d && d.fixture));
  gA.ea_match_id = null; gA.status = "final";
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  d = r.o.sessions.find((x) => x.matchId === "mDal");
  A("...once the first is final, the second; the final one is listed but not a doubt", d && d.fixture.gameId === "gB" && d.alternatives.some((x) => x.gameId === "gA") && d.ambiguous === false, JSON.stringify(d && { fx: d.fixture && d.fixture.gameId, amb: d.ambiguous }));

  /* v4.37 review: recorded on the FIRST game only, which is final, and the pair's next game is open: a new sitting is not
     pinned to the complete game; it waits to be matched, and the open game is what it is offered */
  SUBS = [{ game_id: "gA", ea_club_id: "777", team_id: "T2" }];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  d = r.o.sessions.find((x) => x.matchId === "mDal");
  A("recorded on a final game only, with the next game open: not pinned to the final one", d && d.kind === "needs-substitution" && d.clubs.find((c) => c.eaId === "777").team === null && d.canMerge === false, JSON.stringify(d && { kind: d.kind, fx: d.fixture && d.fixture.gameId }));
  A("...it is offered the open game, never the final one", d.subCandidates.map((c) => c.gameId).join() === "gB" && d.subCandidates[0].borrower === "TOR", JSON.stringify(d.subCandidates));
  GAMES = [gA];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  d = r.o.sessions.find((x) => x.matchId === "mDal");
  A("...with no open game near, the recorded game still reads it (the office decides)", d && d.kind === "league" && d.fixture.gameId === "gA", JSON.stringify(d && { kind: d.kind, fx: d.fixture && d.fixture.gameId }));
  GAMES = [gA, gB]; LOG = [logRow(sDal, "ingested", "gA")];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  d = r.o.sessions.find((x) => x.matchId === "mDal");
  A("...and a sitting already filed on the final game keeps its club and its game", d && d.kind === "league" && d.fixture.gameId === "gA" && d.onGame === true && d.clubs.find((c) => c.eaId === "777").team === "TOR" && d.clubs.find((c) => c.eaId === "777").subGame === "gA", JSON.stringify(d && { kind: d.kind, onGame: d.onGame, clubs: d.clubs }));

  /* in window first, never cut; the six-hour span only when no open game's window holds the sitting */
  const gE = G("gE", "T3", "T1", base - 4 * H);
  GAMES = [gS, gE]; LOG = [logRow(sMix, "unmatched")]; SUBS = [];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  let m = r.o.sessions.find((x) => x.matchId === "mPen");
  A("candidates: the open games whose window holds the sitting, not every game of the last six hours", m && m.subCandidates.map((c) => c.gameId).join() === "gS", JSON.stringify(m && m.subCandidates.map((c) => c.gameId)));
  GAMES = [{ ...gS, status: "final" }, gE];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  m = r.o.sessions.find((x) => x.matchId === "mPen");
  A("...with none in window, a game played late is still offered from the six-hour span", m && m.subCandidates.map((c) => c.gameId).join() === "gE" && m.subCandidates[0].inWindow === false, JSON.stringify(m && m.subCandidates));

  /* a fixture whose other club has no EA club yet reads as that club's own, unless the club was ever recorded as borrowed */
  const gQ = G("gQ", "T1", "T4", base), sQ = raw("mQ", base + 50 * MIN, BOS(3), PEN(1));
  GAMES = [gQ]; LOG = [logRow(sQ, "unmatched")]; SUBS = [];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  let q = r.o.sessions.find((x) => x.matchId === "mQ");
  A("BOS against an unknown club, PIT unlinked: read as PIT's own club, mergeable", q && q.kind === "league" && q.fixture.gameId === "gQ", JSON.stringify(q && q.kind));
  SUBS = [{ game_id: "gOld", ea_club_id: "777", team_id: "T2" }];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  q = r.o.sessions.find((x) => x.matchId === "mQ");
  A("...but a club once recorded as borrowed is a stand-in: it needs a substitution, never a link", q && q.kind === "needs-substitution" && q.canMerge === false, JSON.stringify(q && q.kind));
  A("nothing written by the list", writes.length === 0, JSON.stringify(writes.map((w) => w.u)));
}

/* v4.37 third review: a club borrowed all night, recorded on two open games, against an outside club recorded on
   neither; and a held game finished under a borrowed club */
console.log("\n# a club borrowed all night against another outside club, and a held game finished under a borrowed one");
{
  const gX = G("gX", "T1", "T2", base), gY = G("gY", "T3", "T1", base + 35 * MIN), gZ = G("gZ", "T3", "T2", base - 35 * MIN);
  const sXY = raw("mXY", base + 85 * MIN, PEN(2), OUT(1));
  GAMES = [gX, gY, gZ]; LOG = [logRow(sXY, "unmatched")];
  SUBS = [{ game_id: "gX", ea_club_id: "777", team_id: "T1" }, { game_id: "gY", ea_club_id: "777", team_id: "T1" }, { game_id: "gZ", ea_club_id: "888", team_id: "T3" }];
  let r = await post({ leagueSessions: { clubId: "777", ea: false } });
  let x = r.o.sessions.find((y) => y.matchId === "mXY");
  A("BOS's borrowed club on two open games, the other club on neither: still waiting, never filed as certain", x && x.kind === "needs-substitution" && x.canMerge === false, JSON.stringify(x && { kind: x.kind, fx: x.fixture && x.fixture.gameId }));
  A("...BOTH of BOS's games are offered, each naming the club that played under the other outside club there", x.subCandidates.map((c) => c.gameId + ":" + c.borrower).join() === "gX:TOR,gY:DAL" && x.subCandidates.every((c) => c.known === "BOS"), JSON.stringify(x.subCandidates));

  /* the earlier game's opponent has no EA club linked: an unresolved club must not read as PIT's own while BOS's
     record is shared by two open games (the merge would link a stand-in to PIT for good) */
  const gXp = G("gX", "T1", "T4", base), sP = raw("mP", base + 85 * MIN, PEN(2), NEWC(1));
  GAMES = [gXp, gY]; LOG = [logRow(sP, "unmatched")];
  SUBS = [{ game_id: "gX", ea_club_id: "777", team_id: "T1" }, { game_id: "gY", ea_club_id: "777", team_id: "T1" }];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  x = r.o.sessions.find((y) => y.matchId === "mP");
  A("a pin shared by two open games never makes an unknown club an unlinked club's own", x && x.kind === "needs-substitution" && x.canMerge === false, JSON.stringify(x && { kind: x.kind }));
  SUBS = [{ game_id: "gX", ea_club_id: "777", team_id: "T1" }];
  r = await post({ leagueSessions: { clubId: "777", ea: false } });
  x = r.o.sessions.find((y) => y.matchId === "mP");
  A("...with BOS's record on that one game only, the v4.36 reading stands: PIT's own club, mergeable", x && x.kind === "league" && x.fixture.gameId === "gX" && x.canMerge === true, JSON.stringify(x && { kind: x.kind }));

  /* TOR lagged out under its own club (held on gH), then finished under Penticton: Penticton's list carries the held
     sitting too, locked in, so the bar files both and the merge accepts them */
  const tH = Date.parse("2026-10-24T21:00:00-04:00");
  const gH = G("gH", "T1", "T2", tH, { ea_match_id: "mOwnH" });
  const sOwnH = raw("mOwnH", tH + 30 * MIN, BOS(1), TOR(0), 1500), sBorH = raw("mBorH", tH + 75 * MIN, BOS(2), PEN(2), 2100);
  GAMES = [gH]; LOG = [logRow(sOwnH, "incomplete", "gH"), logRow(sBorH, "unmatched")];
  SUBS = [{ game_id: "gH", ea_club_id: "777", team_id: "T2" }];
  r = await post({ leagueSessions: { clubId: "777", ea: false, before: etDay(tH + 2 * 86400000) } });
  const own = r.o.sessions.find((y) => y.matchId === "mOwnH"), bor = r.o.sessions.find((y) => y.matchId === "mBorH");
  A("a held game's sitting under the club's OWN club joins the borrowed club's list, on the game", own && own.kind === "league" && own.onGame === true && own.fixture.gameId === "gH", JSON.stringify(own && { kind: own.kind, onGame: own.onGame }));
  A("...beside the borrowed sitting, mergeable into the same game", bor && bor.kind === "league" && bor.fixture.gameId === "gH" && bor.canMerge === true, JSON.stringify(bor && { kind: bor.kind }));
  writes = [];
  r = await post({ leagueMerge: { gameId: "gH", matchIds: ["mOwnH", "mBorH"], preview: true } });
  A("...and the merge of the two previews as one full game", r.code === 200 && r.o.ok && r.o.minutes === 60 && r.o.held === false, JSON.stringify(r.o));
}

/* ---- the merge ---- */
console.log("\n# the merge reads a recorded club as that fixture's side");
{
  const gM = G("gM", "T1", "T2", Date.parse("2026-10-21T21:00:00-04:00"));
  const s1 = raw("mOwn", Date.parse("2026-10-21T21:30:00-04:00"), BOS(1), TOR(0), 1500);   // TOR under its own club, lagged out
  const s2 = raw("mBor", Date.parse("2026-10-21T22:15:00-04:00"), BOS(2), PEN(2), 2100);   // ...and resumed under Penticton
  GAMES = [gM]; LOG = [logRow(s1, "unmatched"), logRow(s2, "unmatched")]; SUBS = []; writes = [];
  let r = await post({ leagueMerge: { gameId: "gM", matchIds: ["mOwn", "mBor"] } });
  A("without a substitution, the borrowed sitting is not this fixture's", r.code === 422 && /not between BOS and TOR \(or a club recorded for one of them in this game under Rule 4\.6\)/.test(r.o.error || ""), r.o.error);
  A("...and nothing was written", writes.length === 0);
  SUBS = [{ game_id: "gM", ea_club_id: "777", team_id: "T2" }];
  r = await post({ leagueMerge: { gameId: "gM", matchIds: ["mOwn", "mBor"], preview: true } });
  A("with it, a sitting under TOR's own club and one under Penticton preview as ONE full game", r.code === 200 && r.o.ok && r.o.held === false && r.o.score === "3-2" && r.o.minutes === 60 && r.o.links === null, JSON.stringify(r.o));
  r = await post({ leagueMerge: { gameId: "gM", matchIds: ["mOwn", "mBor"] } });
  const stats = writes.filter((w) => w.m === "POST" && /game_stats/.test(w.u)).flatMap((w) => w.body);
  const gp = writes.filter((w) => w.m === "PATCH" && /games\?id=eq\.gM/.test(w.u)).map((w) => w.body)[0];
  A("the merge files it final, BOS 3 TOR 2", r.code === 200 && r.o.ok && gp && gp.status === "final" && gp.home_score === 3 && gp.away_score === 2, JSON.stringify(r.o));
  A("...Penticton's players filed as TOR's lines, Boston's as BOS's", stats.some((x) => x.team_id === "T2" && /Penticton/.test(x.skater_name || "")) && stats.some((x) => x.team_id === "T2" && /Leafs/.test(x.skater_name || "")) && stats.every((x) => x.team_id === (/Bruins/.test(x.skater_name || "") ? "T1" : "T2")), JSON.stringify(stats.map((x) => [x.skater_name, x.team_id])));
  A("...and the archive keeps the REAL EA club ids (never the merge's side labels)", !writes.some((w) => JSON.stringify(w.body || "").includes('"ea_club_ids":["H"') || /"H","A"|"A","H"/.test(JSON.stringify(w.body || ""))));

  /* evidence linkage must never make a borrowed club a club's own */
  const gP = G("gP", "T1", "T4", Date.parse("2026-10-22T21:00:00-04:00"));
  const s3 = raw("mPit", Date.parse("2026-10-22T22:05:00-04:00"), BOS(4), PEN(1));
  GAMES = [gP]; LOG = [logRow(s3, "unmatched")]; SUBS = [{ game_id: "gM", ea_club_id: "777", team_id: "T2" }]; writes = [];
  r = await post({ leagueMerge: { gameId: "gP", matchIds: ["mPit"] } });
  A("a club on record as borrowed is never linked as PIT's own", r.code === 422 && /played under as a borrowed club \(Rule 4\.6\)/.test(r.o.error || "") && writes.length === 0, r.o.error);
  SUBS = [];
  r = await post({ leagueMerge: { gameId: "gP", matchIds: ["mPit"], preview: true } });
  A("an unknown club the merge WOULD link is named in the preview", r.code === 200 && r.o.links && r.o.links.team === "PIT" && r.o.links.eaId === "777", JSON.stringify(r.o.links));

  /* v4.37 review: the club with a known side is the AWAY club, known only through a substitution; the home club's new
     EA club is the one linked, to the home club */
  const gR = G("gR", "T4", "T1", Date.parse("2026-10-23T21:00:00-04:00"));
  const s4 = raw("mR", Date.parse("2026-10-23T22:05:00-04:00"), NEWC(2), PEN(1));
  GAMES = [gR]; LOG = [logRow(s4, "unmatched")]; SUBS = [{ game_id: "gR", ea_club_id: "777", team_id: "T1" }]; writes = [];
  r = await post({ leagueMerge: { gameId: "gR", matchIds: ["mR"], preview: true } });
  A("away club under a borrowed club, home club's new club: the preview links it to the HOME club", r.code === 200 && r.o.links && r.o.links.team === "PIT" && r.o.links.eaId === "555" && r.o.score === "2-1", JSON.stringify(r.o));
  r = await post({ leagueMerge: { gameId: "gR", matchIds: ["mR"] } });
  const link = writes.find((w) => w.m === "PATCH" && /teams\?id=eq\./.test(w.u));
  A("...and the merge writes the link to PIT, never to BOS", r.code === 200 && link && /id=eq\.T4/.test(link.u) && link.body.ea_club_id === "555", JSON.stringify(link));
}

/* ---- the desk ---- */
console.log("\n# the desk: match, record, then file");
const live = read("../src/live/part_live.js");
const deskFrom = live.indexOf("CG._smS = function"), renderFrom = live.indexOf("/* -- Stats manager desk v4.36: render -- */");
const desk = live.slice(deskFrom, live.indexOf("CG._smRenderDetail = function"));
{
  const CG = { TEAM: {}, TEAMS: [], lg: { schedule: [] }, now: () => Date.now(), auth: { role: "staff" } };
  vm.runInNewContext(live.slice(deskFrom, renderFrom), { CG, Intl, Date, Math, Object, Array, String, JSON });
  const cand = (id, home, away, borrower, inWindow) => ({ gameId: id, home, away, at: iso(base), status: "scheduled", held: false, forfeit: null, inWindow, known: borrower ? (borrower === home ? away : home) : null, borrower });
  const grp = (sessions) => ({ key: "s:x", sessions, latest: base + 50 * MIN });
  const sess = (clubs, cands) => ({ matchId: "m" + Math.random(), endedAt: iso(base + 50 * MIN), clubs, subCandidates: cands });
  let info = CG._smMatchInfo(grp([sess([{ eaId: "111", team: "BOS", via: "linked" }, { eaId: "777", name: "Penticton", team: null }], [cand("gS", "BOS", "TOR", "TOR", true)])]));
  A("one league club known: one outside club to name, one candidate", info.unresolved.length === 1 && info.unresolved[0].name === "Penticton" && info.cands.length === 1);
  let mm = CG._smMatchMap(info, { gameId: "gS" });
  A("...the club that played under it is the game's other club, no question asked", mm && mm.map && mm.map["777"] === "TOR");
  info = CG._smMatchInfo(grp([sess([{ eaId: "888", name: "Outsiders", team: null }, { eaId: "777", name: "Penticton", team: null }], [cand("gS", "BOS", "TOR", null, true), cand("gS2", "TOR", "DAL", null, true)])]));
  A("two outside clubs: the desk asks which club the first was", CG._smMatchMap(info, { gameId: "gS" }) === null);
  mm = CG._smMatchMap(info, { gameId: "gS", side: "TOR" });
  A("...and the second is the other club", mm && mm.map["888"] === "TOR" && mm.map["777"] === "BOS", JSON.stringify(mm));
  A("...a side outside the picked game is refused", CG._smMatchMap(info, { gameId: "gS", side: "DAL" }) === null);
  info = CG._smMatchInfo(grp([sess([{ eaId: "111", team: "BOS", via: "linked" }, { eaId: "777", name: "Penticton", team: null }], [cand("gS", "BOS", "TOR", "TOR", true)]),
                               sess([{ eaId: "111", team: "BOS", via: "linked" }, { eaId: "999", name: "Other", team: null }], [cand("gS", "BOS", "TOR", "TOR", true)])]));
  A("two different outside clubs cannot both stand in for one club in one game", CG._smMatchMap(info, { gameId: "gS" }) && /can’t both stand in for TOR/.test(CG._smMatchMap(info, { gameId: "gS" }).err));
}
A("the desk records through set_game_club_substitution with the club's id and the reason", /CG\.sb\.rpc\("set_game_club_substitution", \{ p_game:g\.id, p_ea_club_id:x\.eaId, p_team:tm\.id, p_reason:why \}\)/.test(desk));
A("...after a confirm that says it is one game only, and that the importer may file it by itself", /That EA club counts as that club in this one game and in no other \(Rule 4\.6\)\.", "Nothing is filed by this step\. While the game window is open, the league’s importer may file the game by itself within a few minutes/.test(desk));
A("...then the matched sittings come back ticked for the bar", /f\.tickAfter = \{ gameId:g\.id, ids:/.test(desk) && /CG\._smApplyTicks\(true, tick\)/.test(desk));
A("Remove clears through clear_game_club_substitution", /rpc\("clear_game_club_substitution", \{ p_game:ug, p_ea_club_id:ue \}\)/.test(desk));
{
  /* the whole desk in a sandbox: the substitution note and its Remove button */
  const CG = { TEAM: { BOS: { name: "Boston" }, TOR: { name: "Toronto" } }, TEAMS: [], lg: { schedule: [] }, now: () => Date.now(), auth: { role: "staff" }, AFTER: {}, fmtFull: () => "Oct 28, 9:00 PM ET" };
  const document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };   // no page: the handlers repaint nothing
  vm.runInNewContext(desk, { CG, esc: (x) => String(x), Intl, Date, Math, Object, Array, String, JSON, document });
  const sub = { eaId: "777", name: "Penticton", team: "TOR", via: "substitution", subGame: "gS" };
  const gOpen = { id: "gS", home: "BOS", away: "TOR", status: "scheduled", eaMatchId: null, at: base };
  let h = CG._smSubNotes({ game: gOpen, sessions: [{ onGame: false, clubs: [sub] }] });
  A("a substitution on record shows on its game, with Remove while the game is open", /Penticton counts as Toronto in this game only \(Rule 4\.6\)\./.test(h) && /data-sm-act="unsub" data-game="gS" data-ea="777"/.test(h), h);
  h = CG._smSubNotes({ game: { ...gOpen, eaMatchId: "held1" }, sessions: [{ onGame: false, clubs: [sub] }] });
  A("...no Remove once the game is held (the database refuses statistics staff)", /counts as Toronto/.test(h) && !/unsub/.test(h), h);
  h = CG._smSubNotes({ game: { ...gOpen, status: "final" }, sessions: [{ onGame: true, clubs: [sub] }] });
  A("...nor once it is filed", !/unsub/.test(h), h);
  CG.auth.role = "commish";
  h = CG._smSubNotes({ game: { ...gOpen, status: "final" }, sessions: [{ onGame: true, clubs: [sub] }] });
  A("...nor for a commissioner: a filed game offers Report a mistake (nothing on the desk could record it again)", !/unsub/.test(h) && /data-sm-act="report" data-game="gS"/.test(h), h);
  CG.auth.role = "staff"; CG.lg.schedule = [{ id: "gT", home: "BOS", away: "TOR", status: "scheduled", eaMatchId: null, at: base }];
  h = CG._smSubNotes({ game: gOpen, sessions: [{ onGame: false, clubs: [{ ...sub, subGame: "gT" }] }] });
  A("...Remove names the game the substitution is recorded on, not the group's", /data-game="gT"/.test(h) && /in TOR @ BOS, Oct 28/.test(h), h);
  /* a reload can turn a ticked sitting unmergeable (its substitution removed elsewhere): the bar no longer counts it */
  const lg = (canMerge) => [{ key: "g:gS", kind: "league", locked: false, sessions: [{ matchId: "m1", canMerge, onGame: false, struck: false }] }];
  const stSel = { find: { picked: { m1: true }, restart: false } };
  A("a ticked sitting that can no longer be merged is not counted by the bar", CG._smSelection(stSel, lg(false)).ticked.length === 0 && CG._smSelection(stSel, lg(true)).ticked.join() === "m1");
  /* after a match the game's sittings come back ticked only when they can be one plain game, and only by the load the
     match started (it carries the tick object) */
  const sit = (id, length, minutes, endMin, onGame) => ({ matchId: id, kind: "league", fixture: { gameId: "gS" }, canMerge: true, onGame: !!onGame, struck: false, length, minutes, endedAt: iso(base + endMin * MIN) });
  const st0 = CG._smS();
  const tick = (sess, other) => { st0.find.picked = {}; st0.find.sess = sess; const t = { gameId: "gS", ids: sess.filter((x) => !x.onGame).map((x) => x.matchId) }; st0.find.tickAfter = t; CG._smApplyTicks(true, other ? {} : t); return Object.keys(st0.find.picked).sort().join(); };
  A("after a match, a lag-out (30 minutes, then the other 30) comes back ticked", tick([sit("a", "short", 30, 35), sit("b", "short", 30, 80)]) === "a,b" && st0.find.tickAfter === null);
  A("...a game played in one full sitting too", tick([sit("a", "full", 60, 65)]) === "a");
  A("...two full-length sittings (a rematch in the window) are left for the staffer to pick", tick([sit("a", "full", 60, 65), sit("c", "full-ot", 63, 140)]) === "");
  A("...a restart (a four-minute stub, then the full game) is left for the staffer: the stub is struck, never added (Rule 4.3)", tick([sit("s", "short", 4, 10), sit("r", "full", 60, 80)]) === "");
  A("...and so is a restart whose replay itself lagged out", tick([sit("s", "short", 4, 10), sit("r1", "short", 30, 45), sit("r2", "short", 30, 90)]) === "");
  A("...ticks pending for one load are never applied by another (a merge's own reload, an older page)", tick([sit("a", "short", 30, 35), sit("b", "short", 30, 80)], true) === "");
  A("...a held five-minute stub already on the game, then the full restart: left for the staffer (the stub is struck)", tick([sit("h", "short", 5, 10, true), sit("r", "full", 60, 80)]) === "");
  A("...a held 25 minutes already on the game, then the resumed 35: the resume comes back ticked", tick([sit("h", "short", 25, 30, true), sit("r", "short", 35, 80)]) === "r");
  /* the staffer's own untick ends the automatic ticks: the EA phase never re-ticks what they cleared */
  const t2 = { gameId: "gS", ids: ["a", "b"] };
  st0.find.sess = [sit("a", "short", 30, 35), sit("b", "short", 30, 80)]; st0.find.picked = {}; st0.find.tickAfter = t2;
  CG._smApplyTicks(false, t2);
  const afterPhase1 = Object.keys(st0.find.picked).sort().join();
  CG._smOnChange({ target: { name: "smSess", value: "b", checked: false } });
  CG._smApplyTicks(true, t2);
  A("...the staffer unticks one between the archive and EA phases: it stays unticked", afterPhase1 === "a,b" && st0.find.picked.b === false && st0.find.tickAfter === null, JSON.stringify(st0.find.picked));
  /* the archive holds only the stub; EA then adds the full restart: the EA phase takes back the stub it ticked */
  const t3 = { gameId: "gS", ids: ["s", "r"] }, rSit = sit("r", "full", 60, 80);
  st0.find.sess = [sit("s", "short", 4, 10), { ...rSit, kind: "needs-substitution", canMerge: false }]; st0.find.picked = {}; st0.find.tickAfter = t3;
  CG._smApplyTicks(false, t3);
  const p1 = Object.keys(st0.find.picked).join();
  st0.find.sess = [sit("s", "short", 4, 10), rSit];
  CG._smApplyTicks(true, t3);
  A("...a matched sitting not yet re-read as the game's still counts: the stub is not ticked on the archive phase", p1 === "", JSON.stringify(p1));
  A("...and once the EA phase reads the restart, still nothing is ticked", Object.keys(st0.find.picked).length === 0, JSON.stringify(st0.find.picked));
  /* a league replay of the same game that was not in the match (another club's list) still counts against the stub */
  const t4 = { gameId: "gS", ids: ["s"] };
  st0.find.sess = [sit("s", "short", 4, 10), sit("r", "full", 60, 80)]; st0.find.picked = {}; st0.find.tickAfter = t4;
  CG._smApplyTicks(true, t4);
  A("...a full replay of the game outside the match still keeps the stub unticked", Object.keys(st0.find.picked).length === 0, JSON.stringify(st0.find.picked));
  /* an unrelated earlier sitting tagged to the same fixture (a scrim that afternoon) never hides the restart stub */
  const t6 = { gameId: "gS", ids: ["s", "r1", "r2"] };
  st0.find.sess = [sit("x", "short", 25, -200), sit("s", "short", 4, 10), sit("r1", "short", 30, 45), sit("r2", "short", 30, 90)]; st0.find.picked = {}; st0.find.tickAfter = t6;
  CG._smApplyTicks(true, t6);
  A("...an earlier unrelated sitting tagged to the fixture never hides a restart stub", Object.keys(st0.find.picked).length === 0, JSON.stringify(st0.find.picked));
  const t7 = { gameId: "gS", ids: ["x", "s", "r1", "r2"] };
  st0.find.sess = [{ ...sit("x", "short", 25, -200), kind: "not-league", canMerge: false }, sit("s", "short", 4, 10), sit("r1", "short", 30, 45), sit("r2", "short", 30, 90)]; st0.find.picked = {}; st0.find.tickAfter = t7;
  CG._smApplyTicks(true, t7);
  A("...nor does a matched sitting that re-reads as not this game", Object.keys(st0.find.picked).length === 0, JSON.stringify(st0.find.picked));
  /* a phase that failed takes back the ticks it set */
  const t5 = { gameId: "gS", ids: ["a", "b"] };
  st0.find.sess = [sit("a", "short", 30, 35), sit("b", "short", 30, 80)]; st0.find.picked = {}; st0.find.tickAfter = t5;
  CG._smApplyTicks(false, t5);
  const before5 = Object.keys(st0.find.picked).sort().join(), dropped = CG._smDropTicks(t5);
  A("...a failed EA phase takes back the archive phase's ticks", before5 === "a,b" && dropped === true && Object.keys(st0.find.picked).length === 0 && st0.find.tickAfter === null, JSON.stringify(st0.find.picked));
}
A("the note stands in every kind of group (one club recorded, the other still unknown)", /notes = CG\._smSubNotes\(gr\) \+ \(CG\._smMatchHtml\(gr, st\)/.test(desk) && /notes = CG\._smSubNotes\(gr\) \+ CG\._smMatchHtml\(gr, st\);/.test(desk));
{
  const sql = read("../sql/2026-10-29-substitution-clear-guard-v437.sql");
  A("the database guard for Remove is on record", /already filed or held/.test(sql) && /REHEARSAL OK: P1 P2 P3/.test(sql) && /Applied as migration v437_substitution_clear_guard/.test(sql));
  A("...a commissioner can record one again on a filed game after removing it (part 3)", /g\.status <> 'scheduled' and not public\.is_commissioner\(\) and not exists/.test(sql) && /REHEARSAL OK: U1 U2 U3/.test(sql) && /Applied as migration v437c_substitution_commissioner_rerecord/.test(sql));
  A("...the importer race is a marked shortcut, on the read itself", /\/\/ shortcut: a Remove or re-point landing between this read and the games PATCH/.test(read("../netlify/functions/ingest-stats.js")));
  A("...and CHANGING a substitution on a filed or held game is the commissioner's too", /s\.team_id is distinct from new\.team_id/.test(sql) && /\(g\.status <> 'scheduled' or g\.ea_match_id is not null\) and not public\.is_commissioner\(\)/.test(sql)
    && /REHEARSAL OK: T1 T2 T3 T4 T5/.test(sql) && /Applied as migration v437b_substitution_change_guard/.test(sql));
}
A("after a match or a Remove, the page the game's sittings are on is reloaded", /CG\._smLoad\(g && CG\.now\(\) - g\.at >= 9 \* 86400000 \? \{ before:CG\._smEtDay\(g\.at \+ 2 \* 86400000\), ea:eaOnly, tick:tick \} : \{ ea:true, keep:true, tick:tick \}\);/.test(desk) && /CG\._smReloadFor\(g\);/.test(desk) && /CG\._smReloadFor\(ugm\);/.test(desk));
A("a failed EA phase takes back its own ticks and repaints (a phase that never completed leaves nothing ticked)", desk.split("CG._smDropTicks(tick);").length === 3 && /if \(dropped\) CG\._smPaintSessIdle\(CG\._smPaintSess\);/.test(desk));
A("...and so does a failed archive load", desk.split("CG._smDropTicks(opts.tick);").length === 3);
A("a refused Record is never silent: with its panel closed by a load, the error goes to the list's note", /else if \(f\.match === m\) CG\._smMatchPaint\(\);\n        else \{ f\.err = m\.err;/.test(desk));
A("an older game's reload reads EA too when the matched sittings are ones only EA lists", /var eaOnly = \(f\.sess \|\| \[\]\)\.some\(function\(s\)\{ return s\.source === "ea"/.test(desk) && /before:CG\._smEtDay\(g\.at \+ 2 \* 86400000\), ea:eaOnly, tick:tick/.test(desk));
A("recording a match does not move the desk's focus", !/f\.focus = g\.id/.test(desk.slice(desk.indexOf("CG._smMatchGo = function"), desk.indexOf("CG._smFfGo = function"))));
A("opening the match panel anchors on the live group, not the clicked button", !/t\.closest\("\.sm-grp"\)/.test(desk) && /getAttribute\("data-key"\) === mk/.test(desk));
A("a reply that lands while the match panel is open never rebuilds the reason field (both reply paths)", /CG\._smPaintSessIdle = function\(paint\)\{/.test(desk) && desk.split("CG._smPaintSessIdle(").length - 1 >= 3 && /if \(st\.find\.match && document\.getElementById\("smMatch"\)\)\{ CG\._smPaint\("smEaLine"/.test(desk));
A("every load is the staffer's and closes the match panel first; so does checking EA again", /first = !f\.sess;\n  f\.match = null;/.test(desk) && /else if \(act === "eaagain"\)\{ if \(f\.match\)\{ f\.match = null; CG\._smPaintSess\(\); \} CG\._smLoadEa\(st\.seq\); \}/.test(desk));
A("pending ticks ride the load that applies them, and are spent by a merge, a pickup import, Clear, Move or a Remove", /var f = CG\._smS\(\)\.find, tick = f\.tickAfter \|\| null;/.test(desk) && /CG\._smApplyTicks\(!opts\.ea, opts\.tick\)/.test(desk) && /CG\._smApplyTicks\(true, tick\)/.test(desk) && /CG\._smLoadEa\(req, opts\.tick\)/.test(desk)
  && /delete f\.picked\[t\.getAttribute\("data-match"\)\]; f\.tickAfter = null;/.test(desk) && /f\.match = null; f\.tickAfter = null; CG\._smReloadFor\(g\);/.test(desk)
  && /kind:"merge", gid:gid, r:r2 \}; f\.picked = \{\}; f\.tickAfter = null;/.test(desk) && /kind:"pickup", o:o \}; f\.picked = \{\}; f\.tickAfter = null;/.test(desk) && /act === "clear"\)\{ f\.picked = \{\}; f\.tickAfter = null;/.test(desk) && /f\.picked = \{\}; f\.tickAfter = null; st\.focusNext = "smFindRes";\n        CG\._smReloadFor\(ugm\);/.test(desk));
A("the match panel cannot be opened while a merge or import is in flight (its reload would close it under the typing)", /else if \(act === "match"\)\{\n    if \(f\.busy\) return;/.test(desk));
A("Cancel puts focus back on the group's Match button", /else if \(act === "matchcancel"\)\{\n    var ck = f\.match && f\.match\.key;[\s\S]{0,400}mb\.focus\(\{ preventScroll:true \}\)/.test(desk));
A("recording against a group the list no longer holds says so (never a silent no-op)", /if \(!gr\)\{ f\.match = null; f\.err = "The list changed while the panel was open\. Open Match to a league game again\."; CG\._smPaintSess\(\); return; \}/.test(desk));
A("the desk no longer says it can't file a substituted game", !/this desk can’t/.test(desk));
A("the reason is required, as the database requires it", /String\(m\.why \|\| ""\)\.trim\(\)\.length >= 3/.test(desk));
A("no dashes in the new copy", !/[–—]/.test(desk));

console.log("\n# the changelog");
{
  const line = read("../src/live/part3_content.js");
  const e = (JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1)).rulebook.changelog || []).find((c) => c.version === "4.37");
  A("the 4.37 entry exists", !!e);
  const txt = e ? e.summary + " " + e.items.join(" ") : "";
  A("...in plain words: search the outside club, match it, file the game", /Match to a league game/.test(txt) && /Rule 4\.6/.test(txt) && /file/.test(txt));
  A("...house style: no dashes as punctuation", !/[–—]| - /.test(txt));
  A("...and it names the rule it changed", /Rule 4\.6 now says that once a sitting of the fixture has been filed or is held, only a commissioner may change or withdraw its substitution/.test(txt) && !/No rule changed/.test(txt));
  const r46 = JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1)).rulebook.chapters.flatMap((c) => c.sections).find((x) => x.id === "4.6");
  A("Rule 4.6: after a sitting is filed or held, only a commissioner changes or withdraws the substitution (the database's line)", /Once a sitting of that fixture has been filed, or is held under Rule 4\.3, only a commissioner may change or withdraw the substitution, because which club a box score belonged to is then a ruling\./.test(r46.paragraphs[1]));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
