// v4.36: the Stats manager's "Find a game on EA" (leagueSessions in netlify/functions/ingest-stats.js). One EA club's
// sittings from the league archive, and from EA through the bot's server, each tagged with the league fixture it
// belongs to. Run: node tools/league-sessions-v436.test.mjs
//
// What must never break: only statistics staff or a commissioner can list a whole club's sittings; it writes nothing
// but the relay's request row; a filed, struck or pickup-imported sitting is never offered for a merge or a pickup
// import; a disconnected sitting shows the players' goals, never EA's 3-0 placeholder; and EA failing still shows
// what the archive holds.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.INGEST_KEY ||= "machine-key";

const { handler } = await import(new URL("../netlify/functions/ingest-stats.js", import.meta.url).pathname);
const { createLookupsFake } = await import(new URL("./ea-lookups-fake.mjs", import.meta.url).pathname);

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  got: " + x : ""}`); };

/* the same Eastern day the importer stamps on a payload */
const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDay = (ms) => etFmt.format(new Date(ms));
const H = 3600000, D = 86400000, MIN = 60000;
/* every fixture is relative to now: the default window is the ten Eastern days ending tomorrow */
const base = Math.floor((Date.now() - 2 * D) / H) * H;
const iso = (ms) => new Date(ms).toISOString();

/* a raw EA sitting between clubs a and b ({id, name, goals, club?}); the players carry the goals */
const raw = (id, endMs, a, b, toi = 3600) => {
  const club = (x, y) => ({ details: { name: x.name }, score: String(x.goals), result: x.goals > y.goals ? "1" : "2", ...(x.club || {}) });
  const skater = (x) => ({ [x.id + "p"]: { playername: x.name + " Skater", position: "center", skgoals: String(x.goals), toiseconds: String(toi) } });
  return { matchId: id, timestamp: Math.floor(endMs / 1000), clubs: { [a.id]: club(a, b), [b.id]: club(b, a) }, players: { [a.id]: skater(a), [b.id]: skater(b) } };
};
const BOS = (g) => ({ id: "111", name: "Bruins EA", goals: g });
const TOR = (g) => ({ id: "222", name: "Leafs EA", goals: g });
const DAL = (g) => ({ id: "333", name: "Stars EA", goals: g });
const OUT = (g) => ({ id: "999", name: "Outsiders", goals: g });
const PUC = (g) => ({ id: "555", name: "Pickup Crew", goals: g });
const logRow = (r, status, gameId) => ({ ea_match_id: String(r.matchId), status, game_id: gameId || null,
  et_day: etDay(r.timestamp * 1000), ea_club_ids: Object.keys(r.clubs), payload: r });

const TEAMS = [{ id: "T1", code: "BOS", ea_club_id: "111" }, { id: "T2", code: "TOR", ea_club_id: "222" },
  { id: "T3", code: "DAL", ea_club_id: "333" }, { id: "T4", code: "PIT", ea_club_id: null }];
const G = (id, home, away, at, over = {}) => ({ id, week: 3, scheduled_at: iso(at), home_team_id: home, away_team_id: away,
  status: "scheduled", ea_match_id: null, voided: false, forfeit_team_id: null, ...over });
const GAMES = [
  G("gF", "T1", "T2", base, { status: "final", ea_match_id: "mFiled" }),                  // BOS v TOR, filed
  G("gOpen", "T1", "T3", base + 35 * MIN),                                                // BOS v DAL, open
  G("gHeld", "T1", "T2", base - 2 * D, { ea_match_id: "mHeldFirst" }),                    // BOS v TOR, held
  G("gSib", "T1", "T2", base - 2 * D + 35 * MIN),                                         // ...and its open sibling that night
  G("gLate", "T2", "T1", base - 4 * D, { status: "final", ea_match_id: "mLateFiled" }),   // TOR v BOS, final
  G("gPit", "T1", "T4", base - 6 * D),                                                   // BOS v PIT (PIT has no EA club linked)
  G("gPit2", "T1", "T4", base - 5 * D),                                                  // BOS v PIT again, and...
  G("gDal2", "T1", "T3", base - 5 * D + 35 * MIN),                                       // ...BOS v DAL in an overlapping window
];

const S = {
  filed: raw("mFiled", base + 40 * MIN, BOS(3), TOR(1)),
  struck: raw("mStruck", base + 10 * MIN, BOS(0), TOR(0), 400),
  open: raw("mOpen", base + 75 * MIN, BOS(2), DAL(1)),
  heldFirst: raw("mHeldFirst", base - 2 * D + 20 * MIN, BOS(1), TOR(0), 1200),
  amb: raw("mAmb", base - 2 * D + 40 * MIN, BOS(2), TOR(2), 2400),
  late: raw("mLate", base - 4 * D + 5 * H, TOR(4), BOS(2)),
  scrim: raw("mScrim", base - 3 * D, BOS(5), DAL(4)),
  scrimArch: raw("mScrimArch", base - 3 * D - H, BOS(1), DAL(0)),
  sub: raw("mSub", base + 30 * MIN, BOS(2), OUT(1)),
  neither: raw("mNeither", base - D, PUC(3), OUT(2)),
  pu: raw("mPu", base - D + H, PUC(1), OUT(0)),
  unm: raw("mUnm", base - D + 2 * H, PUC(2), OUT(2)),
  /* a disconnection: EA calls it 3-0 to the Outsiders (winnerByDnf), the players' goals say 2-1 to the Crew */
  dnf: raw("mDnf", base - D + 3 * H, { ...PUC(2), club: { score: "0" } }, { ...OUT(1), club: { score: "3", winnerByDnf: "1" } }, 1500),
  c777: raw("m777", base - D, { id: "777", name: "Seven", goals: 1 }, OUT(0)),
  pit: raw("mPit", base - 6 * D + 50 * MIN, BOS(3), { id: "444", name: "Pens EA", goals: 2 }),
  borrow: raw("mBorrow", base - 5 * D + 75 * MIN, BOS(2), OUT(1)),
};
const LOG = [
  logRow(S.filed, "ingested", "gF"), logRow(S.struck, "struck", "gF"), logRow(S.open, "unmatched"),
  logRow(S.heldFirst, "incomplete", "gHeld"), logRow(S.amb, "unmatched"), logRow(S.late, "unmatched"),
  logRow(S.scrim, "ignored"), logRow(S.scrimArch, "ignored"), logRow(S.unm, "unmatched"), logRow(S.c777, "ignored"),
  logRow(S.pit, "unmatched"), logRow(S.borrow, "unmatched"),
];
const PICKUPS = [{ id: "pu1", ea_match_id: "mPu", ea_match_ids: ["mPu"] }];
const EA = { "111": [S.filed, S.scrim, S.sub], "555": [S.neither, S.pu, S.unm, S.dnf] };

const PROFILES = {
  member: { role: "member", departments: [], gamertag: "Member", banned: false },
  community: { role: "staff", departments: ["community"], gamertag: "Comm", banned: false },
  banned: { role: "staff", departments: ["statistics"], gamertag: "Gone", banned: true },
  "bos-gm": { role: "member", departments: [], gamertag: "BosGM", banned: false },
  stats: { role: "staff", departments: ["statistics"], gamertag: "StatsGuy", banned: false },
  commish: { role: "commissioner", departments: [], gamertag: "Commish", banned: false },
};

let UID = "stats";
let LOOKUPS = createLookupsFake();
let ARCHIVE_URLS = [];
let writes = [];
const ids = (u, re) => { const m = decodeURIComponent(u).match(re); return m ? m[1].split(",") : null; };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET", d = decodeURIComponent(u);
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  if (u.includes("/auth/v1/user")) return UID ? J({ id: UID }) : J({ error: "bad" }, 401);
  if (u.includes("proclubs.ea.com")) throw new Error("Netlify must never call EA itself (v4.34): " + u);
  if (u.includes("/rest/v1/ea_lookups")) return LOOKUPS.handle(u, opts);
  if (m !== "GET") { writes.push(`${m} ${d}`); return J([]); }
  if (u.includes("/rest/v1/profiles?id=eq.")) { const id = d.match(/id=eq\.([^&]+)/)[1]; return J(PROFILES[id] ? [PROFILES[id]] : []); }
  if (u.includes("/rest/v1/ea_ingest_log?ea_club_ids=cs.")) {
    ARCHIVE_URLS.push(d);
    const club = d.match(/cs\.\{([^}]+)\}/)[1], gte = d.match(/et_day=gte\.([0-9-]+)/)[1], lt = d.match(/et_day=lt\.([0-9-]+)/)[1];
    return J(LOG.filter((r) => r.ea_club_ids.includes(club) && r.et_day >= gte && r.et_day < lt).sort((x, y) => (x.et_day < y.et_day ? 1 : -1)));
  }
  if (u.includes("/rest/v1/ea_ingest_log?ea_match_id=in.")) { const want = ids(u, /ea_match_id=in\.\(([^)]*)\)/); return J(LOG.filter((r) => want.includes(r.ea_match_id))); }
  if (u.includes("/rest/v1/teams?select=")) return J(TEAMS);
  if (u.includes("/rest/v1/games?ea_match_id=in.")) { const want = ids(u, /ea_match_id=in\.\(([^)]*)\)/); return J(GAMES.filter((g) => want.includes(g.ea_match_id))); }
  if (u.includes("/rest/v1/games?id=in.")) { const want = ids(u, /id=in\.\(([^)]*)\)/); return J(GAMES.filter((g) => want.includes(g.id))); }
  if (u.includes("/rest/v1/games?or=")) {
    const tl = ids(u, /home_team_id\.in\.\(([^)]*)\)/), lo = Date.parse(d.match(/scheduled_at=gte\.([^&]+)/)[1]), hi = Date.parse(d.match(/scheduled_at=lte\.([^&]+)/)[1]);
    return J(GAMES.filter((g) => (tl.includes(g.home_team_id) || tl.includes(g.away_team_id)) && Date.parse(g.scheduled_at) >= lo && Date.parse(g.scheduled_at) <= hi));
  }
  if (u.includes("/rest/v1/pickup_games?or=")) {
    const want = ids(u, /ea_match_id\.in\.\(([^)]*)\)/);
    return J(PICKUPS.filter((p) => want.includes(p.ea_match_id) || p.ea_match_ids.some((x) => want.includes(x))));
  }
  return J([]);
};
const call = async (inner) => {
  const r = await handler({ httpMethod: "POST", headers: { authorization: "Bearer jwt" }, body: JSON.stringify({ leagueSessions: inner }) });
  return { code: r.statusCode, out: JSON.parse(r.body) };
};
const seedEa = () => { LOOKUPS = createLookupsFake(); for (const [club, list] of Object.entries(EA)) LOOKUPS.seed("matches", club, list); };
const by = (out, id) => (out.sessions || []).find((s) => s.matchId === id);

console.log("# the gate: a whole club's sittings are statistics staff's or a commissioner's");
{
  seedEa();
  for (const who of ["member", "community", "banned", "bos-gm"]) {
    UID = who;
    const r = await call({ clubId: "111", ea: false });
    A(`${who} is refused`, r.code === 401 && r.out.error === "Statistics staff or a commissioner only.", JSON.stringify(r.out));
  }
  UID = null;
  A("no session at all is refused", (await call({ clubId: "111", ea: false })).code === 401);
  for (const who of ["stats", "commish"]) { UID = who; A(`${who} passes`, (await call({ clubId: "111", ea: false })).code === 200); }
  UID = "stats";
  A("a club id that is not digits is a plain sentence", (await call({ clubId: "11a", ea: false })).out.error === "Pick a club.");
  A("an unreadable date is a plain sentence", (await call({ clubId: "111", ea: false, before: "2026-02-31" })).out.error === "That date is not readable.");
}

console.log("\n# reads only: the relay's request row is the one write");
{
  seedEa(); writes = [];
  UID = "stats";
  const posts0 = LOOKUPS.posts.length;
  await call({ clubId: "111", ea: false });
  A("ea:false files no EA lookup", LOOKUPS.posts.length === posts0);
  LOOKUPS = createLookupsFake();
  const p = await call({ clubId: "111", ea: true });
  A("ea:true with nothing stored files ONE request and says to wait", typeof p.out.eaPending === "number" && LOOKUPS.posts.length === 1 && LOOKUPS.posts[0].requested_by === "stats" && LOOKUPS.posts[0].kind === "matches" && LOOKUPS.posts[0].arg === "111", JSON.stringify(p.out));
  LOOKUPS.answerAll(() => EA["111"]);
  const done = await call({ clubId: "111", ea: true, eaLookup: p.out.eaPending });
  A("...then reads exactly that answer", done.code === 200 && done.out.ea.ok === true && !!done.out.ea.answeredAt && LOOKUPS.posts.length === 1, JSON.stringify(done.out.ea));
  A("nothing else was written: no archive row, no game, no box score", writes.length === 0, writes.join(" | "));
}

console.log("\n# each sitting tagged with its fixture");
seedEa(); UID = "stats";
const R = (await call({ clubId: "111", ea: true })).out;
{
  A("the club is named from its payloads, with its league code", R.club && R.club.eaId === "111" && R.club.name === "Bruins EA" && R.club.team === "BOS", JSON.stringify(R.club));
  A("the window runs ten days to tomorrow (Eastern)", R.archiveTo === etDay(Date.now() + D) && R.archiveFrom === new Date(Date.parse(R.archiveTo + "T12:00:00Z") - 10 * D).toISOString().slice(0, 10), `${R.archiveFrom} to ${R.archiveTo}`);
  A("newest first", R.sessions.every((s, i, a) => i === 0 || Date.parse(a[i - 1].endedAt) >= Date.parse(s.endedAt)));

  const f = by(R, "mFiled");
  A("filed: the game it is on, marked on it", f && f.kind === "league" && f.fixture.gameId === "gF" && f.onGame === true && f.struck === false && f.canMerge === true && f.canPickup === false, JSON.stringify(f));
  A("...in the archive AND on EA", f.source === "both" && f.archive.status === "ingested" && f.archive.gameId === "gF");
  A("...the fixture reads away at home, final, in window", f.fixture.home === "BOS" && f.fixture.away === "TOR" && f.fixture.status === "final" && f.fixture.held === false && f.fixture.inWindow === true && f.fixture.forfeit === null);
  A("...a full game, its length and minutes from the clock", f.length === "full" && f.minutes === 60);

  const o = by(R, "mOpen");
  A("open in window: the open fixture", o && o.kind === "league" && o.fixture.gameId === "gOpen" && o.fixture.inWindow === true && o.ambiguous === false && o.onGame === false && o.canMerge === true, JSON.stringify(o));
  A("...archive only, unmatched: never a pickup import", o.source === "archive" && o.canPickup === false);

  const a = by(R, "mAmb");
  A("a held game with an open sibling that night is ambiguous", a && a.kind === "league" && a.ambiguous === true && a.fixture.gameId === "gSib", JSON.stringify(a));
  A("...the importer's choice (the open sibling) first, the held game as the alternative", a.alternatives.length === 1 && a.alternatives[0].gameId === "gHeld" && a.alternatives[0].held === true);
  A("...level after 40 minutes is a short sitting", a.length === "short" && a.minutes === 40);
  const hf = by(R, "mHeldFirst");
  A("the held game's own sitting is on it, and the fixture says held", hf && hf.onGame === true && hf.fixture.gameId === "gHeld" && hf.fixture.held === true, JSON.stringify(hf && hf.fixture));

  const l = by(R, "mLate");
  A("out of window: the nearest fixture, marked outside", l && l.kind === "league" && l.fixture.gameId === "gLate" && l.fixture.inWindow === false && l.fixture.home === "TOR", JSON.stringify(l && l.fixture));

  const sc = by(R, "mScrim"), sa = by(R, "mScrimArch");
  A("no fixture for the pair that day: not a league game", sc && sc.kind === "not-league" && sc.fixture === null && sc.canMerge === false, JSON.stringify(sc));
  A("...archived `ignored` and on EA: may be imported as a pickup game", sc.source === "both" && sc.archive.status === "ignored" && sc.canPickup === true);
  A("...archive only: EA no longer has it, so no pickup import", sa && sa.source === "archive" && sa.canPickup === false);

  const sb = by(R, "mSub");
  A("one league club with a fixture in window: needs a substitution", sb && sb.kind === "needs-substitution" && sb.fixture && sb.canMerge === false && sb.canPickup === false && /Rule 4\.6/.test(sb.why || ""), JSON.stringify(sb));
  A("...its clubs name the league side only", sb.clubs.find((c) => c.eaId === "111").team === "BOS" && sb.clubs.find((c) => c.eaId === "999").team === null);

  /* v4.36 review: a fixture opponent whose own EA club is not linked yet (a new club) is a league game, not a Rule 4.6
     substitution: leagueMerge takes one linked side and links the opponent from the sittings */
  const pt = by(R, "mPit");
  A("an opponent not linked yet: a league sitting on its fixture, mergeable", pt && pt.kind === "league" && pt.fixture && pt.fixture.gameId === "gPit" && pt.canMerge === true && pt.why === null, JSON.stringify(pt));
  const bw = by(R, "mBorrow");
  A("...but never when another open fixture's window holds it too (a borrowed club against the later slot)", bw && bw.kind === "needs-substitution" && bw.canMerge === false, JSON.stringify(bw && { kind: bw.kind, fx: bw.fixture && bw.fixture.gameId }));
  A("...while an outside club against a linked opponent's fixture still needs a substitution, in words that cover both", /not linked to a league club/.test(by(R, "mSub").why || ""));
  A("an archive-only sitting outside the league says why it can't be imported", /Only in the league archive: EA must still list a sitting to import it\./.test(by(R, "mScrimArch").why || ""), by(R, "mScrimArch").why);

  const st = by(R, "mStruck");
  A("struck: on its old game but off it for good, never mergeable", st && st.struck === true && st.onGame === false && st.canMerge === false && st.canPickup === false && st.fixture.gameId === "gF" && /stays struck/.test(st.why || ""), JSON.stringify(st));
}

console.log("\n# a club that is not a league club");
{
  const R2 = (await call({ clubId: "555", ea: true })).out;
  A("its name comes from EA, no league code", R2.club && R2.club.name === "Pickup Crew" && R2.club.team === null, JSON.stringify(R2.club));
  const n = by(R2, "mNeither");
  A("neither club in the league: not a league game, importable", n && n.kind === "not-league" && n.source === "ea" && n.archive === null && n.canPickup === true && n.canMerge === false, JSON.stringify(n));
  const p = by(R2, "mPu");
  A("already imported as a pickup game: neither door", p && p.pickupGameId === "pu1" && p.canPickup === false && p.canMerge === false && p.why === "Imported as a pickup game.", JSON.stringify(p));
  const u = by(R2, "mUnm");
  A("archived `unmatched` (a possible league game): no pickup import", u && u.source === "both" && u.archive.status === "unmatched" && u.canPickup === false, JSON.stringify(u));
  A("...and it says why, instead of claiming EA dropped it", /possible league game, so it can't be imported as a pickup game/.test(u.why || ""), u.why);
  const d = by(R2, "mDnf");
  const crew = d && d.clubs.find((c) => c.eaId === "555"), outs = d && d.clubs.find((c) => c.eaId === "999");
  A("a disconnected sitting shows the players' goals (2-1), never EA's 3-0 placeholder", crew && crew.score === 2 && outs.score === 1, JSON.stringify(d && d.clubs));
}

console.log("\n# EA failing still shows the archive");
{
  LOOKUPS = createLookupsFake(); UID = "stats";
  const p = await call({ clubId: "777", ea: true });
  A("pending says to wait, with no other work", typeof p.out.eaPending === "number" && Object.keys(p.out).length === 1, JSON.stringify(p.out));
  LOOKUPS.answerAll(() => ({ error: "EA refused the bot server (Akamai 403)." }));
  const r = await call({ clubId: "777", ea: true, eaLookup: p.out.eaPending });
  A("a relay failure is still a 200 with the archive's sittings", r.code === 200 && r.out.ok === true && by(r.out, "m777") && by(r.out, "m777").source === "archive", JSON.stringify(r.out).slice(0, 200));
  A("...and says EA failed, with its sentence", r.out.ea.ok === false && /Akamai 403/.test(r.out.ea.error || ""), JSON.stringify(r.out.ea));
}

console.log("\n# paging: an older window is the archive's alone");
{
  seedEa(); ARCHIVE_URLS = []; UID = "stats";
  const before = etDay(base - 2 * D);
  const posts0 = LOOKUPS.posts.length;
  const r = (await call({ clubId: "111", ea: true, before })).out;
  const want = new Date(Date.parse(before + "T12:00:00Z") - 10 * D).toISOString().slice(0, 10);
  A("before moves the et_day window", ARCHIVE_URLS.length === 1 && ARCHIVE_URLS[0].includes(`et_day=lt.${before}`) && ARCHIVE_URLS[0].includes(`et_day=gte.${want}`) && r.archiveTo === before && r.archiveFrom === want, ARCHIVE_URLS[0]);
  A("...skips EA even when asked", r.ea && r.ea.skipped === true && LOOKUPS.posts.length === posts0);
  A("...and returns only the older sittings", r.sessions.length > 0 && r.sessions.every((s) => s.source === "archive" && etDay(Date.parse(s.endedAt)) < before) && !by(r, "mFiled"), r.sessions.map((s) => s.matchId).join(","));
  A("the archive read is capped and marked as a shortcut",
    /\/\/ shortcut: ea_club_ids has no GIN index and the window is capped at 60 rows, a sequential scan; add the index and paging when ea_ingest_log passes ~20k rows/.test((await import("node:fs")).readFileSync(new URL("../netlify/functions/ingest-stats.js", import.meta.url), "utf8"))
    && /order=et_day\.desc&limit=60/.test(ARCHIVE_URLS[0]));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
