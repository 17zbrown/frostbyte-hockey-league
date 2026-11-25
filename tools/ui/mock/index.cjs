/* v5.00 swap (j1): the test doubles a Season 2 page suite codes against (PLAN 6.8; contracts/client-api.md).
     const mock = require(process.env.S2_MOCK);       // tools/ui/run.cjs sets S2_MOCK in every mode
     const ctx = await browser.newContext({ ... });
     await mock.install(ctx, { persona: "gm", writes: { market_bid: mock.ok({ ... }), waive_player: mock.fail("23514", "...", "seat") } });
     ... mock.calls(ctx)   // every S2.write, in order: [{rpc, args, approval, persona}]
   Personas: anon, member, gm, staff, commissioner (~/Developer/cghl-private/fixtures/personas/personas.json, PRIVATE:
   the profile ids live only there; recorded with read-only role-impersonation probes). Everything install does is on
   that one browser context:
   - network: every request to a *.supabase.co host is answered here and never reaches production. POST (or GET)
     /rest/v1/rpc/<read> serves the persona's recorded body or its recorded error; /auth/v1 answers as the persona; the
     realtime socket accepts joins and stays quiet (until mock.push). Anything else answers 501 with a "mock:" message, is printed, and is
     listed in mock.unexpected(ctx), so a page that reaches past the recorded reads or past S2.write fails loud. A suite
     adds its own answers with routes: {"GET /rest/v1/notifications": (url, body) => ({status, json})}.
   - page (unless {page: false}): before any page script runs, S2.session is the persona's and S2._writeImpl is the
     write mock. The mock owns both: a later assignment (f's real client) is ignored and listed in window.S2_MOCK.blocked,
     and S2.session hands out a fresh copy, so nothing can edit the persona. S2.write(rpc, args, opts) is recorded, then
     answered from the writes table: {data} resolves {data} after calling opts.repaint({data}) (the real client repaints
     after its re-read; Object.assign(mock.ok(id), {queued: true}) is a move the database sent to the Owner, resolved
     {data, queued: true}); {error: {code, message, hint}} rejects an Error carrying them (league errors: the code, the message and
     the hint the door raises, e.g. "23514" for check_violation); a function (args, {persona, approval, calls}) returns
     either. An rpc the table does not name rejects with code MOCK1: never a fake success.
   Calling install again on a context switches persona, writes and routes (the network at once, the page layer from the
   next navigation; page: false after a page layer removes it). run.cjs --mode live-fixture installs the network layer
   into every context and --mode mock installs both (preload.cjs); fixture mode installs nothing unless a suite calls
   install. Who answers a Supabase request, first to last: routes ("METHOD /path"), rpcs and tables (below; any mode),
   the recorded bodies, /auth/v1, then 501.

   THE REAL SITE (h0, 2026-11-25): live: true, or run.cjs --mode live (every context), runs the page exactly as the site
   build ships it, so a suite tests the path members get once demo mode is gone (stream i3):
     await mock.install(ctx, { live: true, persona: "gm", writes: {...}, tables: {...}, rpcs: {...}, routes: {...} });
     await mock.install(ctx, { live: true, persona: "staff", session: { committees: ["draft"] } });   // a seat or power no persona holds:
       // isStaff, isCommissioner, teamId, seat (owner|gm|agm, on teamId; a teamId alone is a roster spot), committees
     mock.respond(ctx, "table:club_notices", rows | (q) => rows | mock.fail(...));   // a table GET, any time
     mock.respond(ctx, "rpc:has_department", mock.ok(true) | mock.fail(...) | (args, info) => either);   // a read RPC
     mock.respond(ctx, "market_bid", mock.ok(...));   // an S2.write answer, as before (a bare name is always a write)
     mock.league({ p_season: 2 })   // a copy of the recorded s2_league body, to shape one: rpcs: { s2_league: (a) => mock.ok(edit(mock.league(a))) }
     mock.offsite(ctx)              // the pictures a page asked of public storage or other hosts (answered with a blank one)
     mock.push(ctx, "draft_picks", "UPDATE", row, old)   // a Realtime postgres_changes to every channel bound to it; -> channels reached
   - the page: demo.html as served (i3f: it carries no fixture tag now) and, before js/load.js, the build's own
     supabase-js tag (tools/site-build.cjs s2Page: /vendor/supabase-js-<v>.min.js with its integrity hash, served here from
     the repo's vendor/) and window.S2_MODE = "live". So js/load.js reads s2_league (the recording), S2.LIVE is true, and
     js/live.js makes the real supabase-js client, which signs in as the persona from its stored session
     (sb-<project>-auth-token, seeded before any script runs; removed for anon).
   - the session: as in mock mode the persona's S2.session is injected and owned, in live.js's shape (teamCode and
     committees added). With page: false nothing is injected: live.js builds S2.session itself through the network
     answers below (the harness proves both agree), and S2.write goes through f's real client, so a write reaches the
     fence and needs an "rpc:" answer.
   - table reads: GET /rest/v1/<table> answers from the context's table (tables, or respond "table:<name>") with
     PostgREST's semantics: select (projection, aliases, embeds kept as given), eq, neq, gt, gte, lt, lte, like, ilike,
     in, is, not., or=(...), order (nullsfirst/nullslast), limit, offset, single (406 PGRST116 unless one row) and
     maybeSingle. A function gets {table, persona, url, select, filters, single} and returns the table's rows (the
     mock applies the query) or mock.fail(code, message, hint). A filter the mock cannot read answers 501 and is listed,
     never a wrong set of rows. A table nobody answers is unexpected (501), as before.
   - read RPCs: rpcs, or respond "rpc:<name>", win over the recorded bodies; mock.ok(data) or mock.fail(...) (a fail's
     status is its .status, else 403 for 42501, 404 for PGRST202/205, else 400), or a function returning either.
   - the defaults, from the recording and the persona, so a page boots with nothing unexpected: tables profiles (the
     league's people), teams (the persona's seat filled in), seasons, committees [], roster_spots (the current season's),
     notifications [], live_pulse (the recorded pulse); rpcs is_staff, is_commissioner, current_season_id. i3f: a
     profile's reads on any page too (pickup_stats [], and the market before the draft with nothing on: market_calendar
     {}, season_rules with MARKET_RULES, market_pool [], market_club_state null, the six market tables empty), the
     Awards ballot (award_ballots []), season_survey_done true, and an empty league office as it stands before the
     staffing flip (the desk's and Team HQ's tables empty, suspension_requests and is_any_committee_manager 404, the
     gates as the session holds them, ea_lookup_health null), and the title race board (statistical_title_board [], QA
     round 2). A suite's table REPLACES a default (keep the persona's own profiles row if the page needs
     S2.auth.profile).
   - the fence: every request to another host is answered here, never sent: images, and pictures from public storage,
     get a blank picture (mock.offsite), anything else 501 and mock.unexpected. Fonts stay with tools/ui/fonts-fence.cjs.
     A context that went live stays live for its life (install again to switch persona, not to leave live mode).
   Converting a suite that forces S2.LIVE with its own client: drop the S2.LIVE, S2.session and S2.ensureSb stubs; pass
   their reads as tables and rpcs (and an edited mock.league body for model data) to install BEFORE page.goto; push
   Realtime with mock.push instead of calling the page's handlers; keep the writes table. S2.reread is the real one (it
   reads the recording again, p_game_ids narrowed); the write mock resolves without a re-read, as before. */
const fs = require("fs"), path = require("path"), os = require("os");
const PERSONAS = path.join(os.homedir(), "Developer/cghl-private/fixtures/personas");
const REPO = path.resolve(__dirname, "../../..");
/* supabase-js keeps the sign-in under sb-<project ref>-auth-token (js/live.js and js/load.js read the same key) */
const STORE_KEY = "sb-bzbuyclwdhmhdzujxeqd-auth-token";
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/, FONTS = /^fonts\.(googleapis|gstatic)\.com$/;
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const PW = process.env.PLAYWRIGHT || "/Users/zackbrown/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright";
const SUPABASE = /^https:\/\/[a-z0-9-]+\.supabase\.co\//;
const SUPABASE_WS = /^wss:\/\/[a-z0-9-]+\.supabase\.co\//;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS" };

let book = null;
const files = {};
function personas() {
  if (book) return book;
  const f = path.join(PERSONAS, "personas.json");
  if (!fs.existsSync(f)) throw new Error("mock: " + f + " is missing (j1 records it with read-only probes; it never enters git)");
  return (book = JSON.parse(fs.readFileSync(f, "utf8")));
}
function persona(name) {
  const p = personas().personas[name];
  if (!p) throw new Error("mock: no persona '" + name + "' (known: " + Object.keys(personas().personas).join(", ") + ")");
  return p;
}
function recorded(rel) {
  if (!files[rel]) {
    const f = path.join(PERSONAS, rel);
    if (!fs.existsSync(f)) throw new Error("mock: the recorded body " + f + " is missing");
    files[rel] = JSON.parse(fs.readFileSync(f, "utf8"));
  }
  return files[rel];
}

/* S2.session per the contract; a signed-in persona carries an unsigned token shaped like the user's JWT */
function sessionOf(name) {
  const p = persona(name);
  if (!p.profileId) return Object.assign({}, p.session);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = b64({ alg: "none", typ: "JWT" }) + "." + b64({ sub: p.profileId, role: "authenticated", aud: "authenticated", iss: "s2-mock", exp: 4102444800 }) + ".mock";
  return Object.assign({ user: { id: p.profileId, aud: "authenticated", role: "authenticated", app_metadata: { provider: "discord" }, user_metadata: {} },
    profileId: p.profileId, accessToken: token }, p.session);
}

const ok = (data) => ({ data: data === undefined ? null : data });
const fail = (code, message, hint, details) => ({ error: { code: String(code), message: String(message), hint: hint == null ? null : hint, details: details == null ? null : details } });
const unexpectedBody = (what, who) => fail("MOCK0", "mock: nothing recorded for " + what + " as " + who + "; record it or pass routes to mock.install").error;

/* s2_league from the shared recording: the season asked for, cut to the sections asked for */
function s2League(args) {
  const sh = personas().shared.s2_league, season = args.p_season == null ? sh.current : +args.p_season, rel = sh[String(season)];
  if (!rel) return { status: 501, json: unexpectedBody("s2_league season " + season, "anyone") };
  const full = recorded(rel), ids = args.p_game_ids;
  if (!args.p_sections && !ids) return { status: 200, json: full };
  const want = args.p_sections || full.sections, missing = want.filter((s) => !(s in full));
  if (missing.length) return { status: 501, json: unexpectedBody("s2_league sections " + missing.join(", ") + " (not in the recording)", "anyone") };
  const out = { generated: full.generated, source: full.source, season: full.season, sections: want, pulse: full.pulse };
  want.forEach((s) => { out[s] = full[s]; });
  /* h0: p_game_ids narrows games and box to those games, as v4.57 does (js/live.js S2.reread merges them by id; serving
     every game there would duplicate them) */
  if (ids) {
    if (out.games) out.games = out.games.filter((g) => ids.indexOf(g.id) >= 0);
    if (out.box) { const by = {}; ids.forEach((g) => { if (full.box.byGame && full.box.byGame[g]) by[g] = full.box.byGame[g]; }); out.box = { cols: full.box.cols, byGame: by }; }
  }
  return { status: 200, json: out };
}

function readRpc(st, name, args) {
  const spec = persona(st.persona).rpc[name];
  if (spec === undefined) return null;
  if (spec === "shared") return s2League(args);
  if (spec.startsWith("error:")) {
    const e = personas().errors[spec.slice(6)];
    if (!e) throw new Error("mock: personas.json names an unknown error " + spec);
    return { status: e.status, json: { code: e.code, details: e.details, hint: e.hint, message: e.message } };
  }
  return { status: 200, json: recorded(spec) };
}

/* ---------- the real site (live: true) ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
const currentBody = () => { const sh = personas().shared.s2_league; return recorded(sh[String(sh.current)]); };
/* a seat or a power no recorded persona holds (install's session option): a committee manager, an Owner, a rostered
   member. Only these keys change; the defaults below follow them, so live.js's own sign-in agrees */
const SESSION_KEYS = ["isStaff", "isCommissioner", "teamId", "seat", "committees"];
function withSession(name, over) {
  const s = sessionOf(name), keys = Object.keys(over || {}), bad = keys.filter((k) => SESSION_KEYS.indexOf(k) < 0);
  if (bad.length) throw new Error("mock: session may set " + SESSION_KEYS.join(", ") + ", not " + bad.join(", "));
  if (keys.length && !s.profileId) throw new Error("mock: anon is signed out; give a seat or a power to a signed-in persona");
  return Object.assign(s, over);
}
/* S2.session in js/live.js's shape (client-api.md: teamCode and committees added), the club's code from the recording */
function liveSessionOf(name, over) {
  const s = withSession(name, over), t = s.teamId ? currentBody().teams.filter((x) => x.id === s.teamId)[0] : null;
  if (s.teamId && !t) throw new Error("mock: " + name + "'s teamId is not a team in the recorded s2_league");
  if (s.seat && (!t || ["owner", "gm", "agm"].indexOf(s.seat) < 0)) throw new Error("mock: a seat is owner, gm or agm, on its club's teamId");
  const committees = s.committees || [];
  delete s.committees;
  return Object.assign(s, { teamCode: t ? t.code : null, committees });
}
/* what js/live.js's sign-in, bell and pulse read, answered as production would for this session (liveSessionOf) */
function liveDefaults(s) {
  const b = currentBody(), cur = b.seasons.filter((x) => x.number === b.season)[0];
  if (!cur) throw new Error("mock: the recorded s2_league has no row for its own season " + b.season);
  /* QA round 2 (2026-11-25): production's teams table carries the EA and Discord link columns the Control Center's club
     links and the game desk read (teams.ea_club_id, ea_club_name, discord_role_id, discord_channel_id); the s2_league
     recording does not, so the default read answered 42703 "column teams.ea_club_id does not exist" and abbr's every-page
     sweep logged it on the Control Center. The default is every club unlinked (null); a suite that needs links answers
     its own (control.test.cjs, gamedesk.test.cjs) */
  const teams = clone(b.teams).map((t) => Object.assign({ ea_club_id: null, ea_club_name: null, discord_role_id: null, discord_channel_id: null }, t));
  /* the recording is anonymous and Season 2 has no seats yet: the seat goes on its club, as live.js looks it up; a club
     without a seat is a roster spot this season */
  if (s.seat) teams.filter((t) => t.id === s.teamId)[0][s.seat + "_profile_id"] = s.profileId;
  const mine = s.teamId && !s.seat ? [{ id: "mock-spot", profile_id: s.profileId, team_id: s.teamId, team: s.teamCode, season_id: cur.id, teams: { code: s.teamCode } }] : [];
  const profiles = b.people.map((x) => ({ id: x.id, gamertag: x.gamertag, display_name: x.display_name, avatar_url: x.avatar_url, role: x.role,
    banned: !!x.banned, ban_reason: null, discord_id: null, discord_username: null, in_guild: true }));
  return {
    tables: { profiles, teams, seasons: clone(b.seasons), notifications: [],
      committees: s.committees.map((k) => ({ key: k, manager_profile_id: s.profileId })),
      roster_spots: ((b.rosters || {}).spots || []).map((x) => Object.assign({ season_id: cur.id, teams: { code: x.team } }, x)).concat(mine),
      live_pulse: [Object.assign({ id: 1, at: b.generated }, clone(b.pulse))],
      /* i3f (2026-11-25): with fixture mode retired every page of every suite is the real site, so the reads a profile
         makes on any page are answered too: a member's pickup lines (js/pages/pickups.js) and the market as it stands
         before Season 2's draft, with nothing on (js/market.js: no bid night, no lot, no waiver, no request, no board).
         A suite that drives the market or the pickups answers its own (market-world.cjs, pickups.test.cjs) */
      pickup_stats: [], market_waivers: [], market_pool_requests: [], market_boards: [], market_bid_nights: [], market_lots: [], market_bids: [],
      /* and the league office as it stands before the Season 2 staffing flip, with nothing in it: the Staff Desk's and the
         Control Center's records, Team HQ's front office (its policy, moves, nominations, notices, trades, lineups and
         server picks). A suite that drives one answers its own (desklive.cjs, hq-market, lineups) */
      /* QA core (2026-11-25): the Inbox reads the member's own cases, their threads and their conversations (js/live.js
         N.mine), on every page once a member is signed in */
      direct_messages: [],
      action_requests: [], action_messages: [], owner_applications: [], staff_applications: [], management_applications: [], committee_applications: [],
      application_ballots: [], application_messages: [], suspension_record: [], team_mgmt_policy: [], team_mgmt_moves: [], club_notices: [], trades: [],
      game_lineups: [], game_vetoes: [], suspension_requests: notYet("table", "suspension_requests"),
      /* the Awards tab's ballot for a signed-in voter: no vote on file (awards.test.cjs answers its own) */
      award_ballots: [] },
    rpcs: { is_staff: ok(!!s.isStaff), is_commissioner: ok(!!s.isCommissioner), current_season_id: ok(cur.id),
      market_calendar: ok({}), market_pool: ok([]), market_club_state: ok(null),
      season_rules: ok({ format: cur.format, roster_max: cur.roster_max, salary_cap: cur.salary_cap, mk: clone(MARKET_RULES) }),
      /* the survey's once-per-member read at sign-in: answered as done, so its pop-up never lands over a page under test
         (flows.test.cjs and the survey's own checks answer it themselves) */
      season_survey_done: ok(true),
      /* the office's gates for this session, as production answers them before the staffing flip (tools/ui/desklive.cjs
         reads them the same way): a commissioner holds every department; staff review applications; 11 voters
         (2026-11-24); is_any_committee_manager does not exist yet (PGRST202, how the desk tells the two apart) */
      has_department: ok(!!s.isCommissioner), is_app_reviewer: ok(!!(s.isStaff || s.isCommissioner)), staff_voter_count: ok(11), can_vote_committee_app: ok(false),
      is_any_committee_manager: notYet("function", "is_any_committee_manager(p_profile)"), season_survey_results: ok({ responses: [] }), ea_lookup_health: ok(null),
      /* QA round 2 (2026-11-25): the title race the Stats page's Leaders and Goaltenders tabs read (and the model reads
         for every page that shows the race): an empty board in the RPC's shape, rows of category, place, profile_id,
         gamertag, gp, total, per_game (sql v4.57), as a season before any final answers. A suite that shows a race
         answers its own (stats.test.cjs) */
      statistical_title_board: ok([]) }
  };
}
/* PostgREST's answer for a table or function the database does not have yet (404, PGRST205 or PGRST202) */
function notYet(kind, name) {
  return Object.assign(kind === "table" ? fail("PGRST205", "Could not find the table 'public." + name + "' in the schema cache") : fail("PGRST202", "Could not find the function public." + name + " in the schema cache"), { status: 404 });
}
/* the season's market rules as season_rules(Season 2).mk answers on production (read 2026-11-25; market-world.cjs reads
   the same figures from here) */
const MARKET_RULES = { opens: "21:00", bid_gp: 6, bid_open: 750000, bid_step: 250000, new_until: "22:00", lot_seconds: 300, waiver_hours: 24 };
/* the build's own tags for supabase-js and the mode, read from tools/site-build.cjs (one definition) */
let buildTags = null;
function liveTags() {
  if (buildTags) return buildTags;
  const html = require(path.join(REPO, "tools/site-build.cjs")).s2Page("s2").html;
  const m = /<script src="\/vendor\/supabase-js-[^"]+"[^\n]*<\/script>\n<script>window\.S2_MODE = "live";<\/script>\n/.exec(html);
  if (!m) throw new Error("mock: the site build no longer puts supabase-js and window.S2_MODE = \"live\" before js/load.js; update the live page here");
  return (buildTags = m[0]);
}
/* i3f (2026-11-25): the shell no longer carries the private fixture's tag (fixture mode is retired), so the build's two
   tags before js/load.js are all the live page adds */
function livePage(html) {
  const load = '<script src="js/load.js"></script>';
  if (/<script[^>]+snapshot\.js/.test(html) || html.split(load).length !== 2) throw new Error("mock: demo.html carries a data/snapshot.js tag, or not exactly one js/load.js tag");
  return html.replace(load, () => liveTags() + load);
}

/* ---------- PostgREST's GET grammar, as far as the pages use it ---------- */
function splitTop(s) {
  const out = []; let depth = 0, quoted = false, cur = "";
  for (const c of s) {
    if (c === '"') quoted = !quoted;
    if (!quoted && c === "(") depth++;
    if (!quoted && c === ")") depth--;
    if (!quoted && !depth && c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  if (cur !== "") out.push(cur);
  return out;
}
const unquote = (v) => (/^".*"$/.test(v) ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v);
const reEsc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function likeRe(pat, i) {
  let re = "";
  for (let k = 0; k < pat.length; k++) {
    const c = pat[k];
    re += c === "\\" && k + 1 < pat.length ? reEsc(pat[++k]) : c === "%" || c === "*" ? "[\\s\\S]*" : c === "_" ? "[\\s\\S]" : reEsc(c);
  }
  return new RegExp("^" + re + "$", i ? "i" : "");
}
/* main session, 2026-11-25 (review of h0): timestamps compared as text missed an equal instant written two ways
   ("+00:00" against toISOString's ".000Z"), so two ISO times compare as instants */
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
function cmp(a, b) {
  if (ISO.test(String(a)) && ISO.test(String(b))) { const ta = Date.parse(String(a).replace(" ", "T")), tb = Date.parse(String(b).replace(" ", "T")); if (!isNaN(ta) && !isNaN(tb)) return ta - tb; }
  const x = typeof a === "number" ? a : a !== "" && !isNaN(+a) ? +a : NaN, y = b !== "" && !isNaN(+b) ? +b : NaN;
  return !isNaN(x) && !isNaN(y) ? x - y : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
/* a is never null here (SQL: a comparison with null matches nothing, negated or not); only is reads nulls */
const OPS = {
  eq: (a, v) => String(a) === v, neq: (a, v) => String(a) !== v,
  gt: (a, v) => cmp(a, v) > 0, gte: (a, v) => cmp(a, v) >= 0, lt: (a, v) => cmp(a, v) < 0, lte: (a, v) => cmp(a, v) <= 0,
  like: (a, v) => likeRe(v).test(String(a)), ilike: (a, v) => likeRe(v, true).test(String(a)),
  in: (a, v) => splitTop(v.replace(/^\(|\)$/g, "")).map(unquote).indexOf(String(a)) >= 0,
  is: (a, v) => (v === "null" ? a == null : v === "true" ? a === true : a === false)
};
function cond(col, expr) {
  const neg = expr.startsWith("not."), e = neg ? expr.slice(4) : expr, dot = e.indexOf(".");
  const op = dot < 0 ? e : e.slice(0, dot), v = dot < 0 ? "" : e.slice(dot + 1);
  if (!OPS[op] || !/^[a-z_][a-z0-9_]*$/.test(col) || (op === "is" && !/^(null|true|false)$/.test(v)))
    throw new Error("the filter " + col + "=" + expr + " (the mock reads eq, neq, gt, gte, lt, lte, like, ilike, in, is, not. and or=(...) on the table's own columns)");
  const val = op === "in" || op === "is" ? v : unquote(v);
  return (row) => { const a = row[col]; if (a == null && op !== "is") return false; const r = OPS[op](a, val); return neg ? !r : r; };
}
function project(sel, row) {
  if (!sel) return row;
  const o = {};
  for (const item of splitTop(sel)) {
    const name = item.trim().replace(/\([\s\S]*$/, "").replace(/::.*$/, "");
    if (name === "*") return row;
    const k = (name.indexOf(":") >= 0 ? name.split(":")[0] : name.split("!")[0]).trim();
    if (k in row) o[k] = row[k];
  }
  return o;
}
const failStatus = (f) => f.status || { "42501": 403, PGRST202: 404, PGRST205: 404, PGRST116: 406 }[f.error.code] || 400;
const errJson = (e) => ({ code: e.code, message: e.message, hint: e.hint == null ? null : e.hint, details: e.details == null ? null : e.details });
/* -> {status, json} for GET /rest/v1/<table>, or null when this context answers no such table */
async function tableRead(st, table, url, req) {
  const spec = st.tables[table];
  if (spec === undefined) return null;
  const filters = [], keep = [];
  let sel = null, order = null, limit = null, offset = 0;
  url.searchParams.forEach((v, k) => {
    if (k === "select") sel = v; else if (k === "order") order = v; else if (k === "limit") limit = +v; else if (k === "offset") offset = +v;
    else if (k === "or") {
      const any = splitTop(v.replace(/^\(|\)$/g, "")).map((c) => { const d = c.indexOf("."); if (d < 0) throw new Error("the or filter " + v); return cond(c.slice(0, d), c.slice(d + 1)); });
      keep.push((row) => any.some((f) => f(row)));
    } else { filters.push([k, v]); keep.push(cond(k, v)); }
  });
  const single = /vnd\.pgrst\.object\+json/.test(req.headers().accept || "");
  let rows = typeof spec === "function" ? await spec({ table, persona: st.persona, url: url.href, select: sel, filters, single }) : spec;
  if (rows && rows.error) return { status: failStatus(rows), json: errJson(rows.error) };
  if (!Array.isArray(rows)) throw new Error("the answer for table " + table + " is neither rows nor mock.fail(...)");
  /* main session, 2026-11-25 (review of h0): a filter, order or select on a column none of the rows carry answered [] or {}
     quietly; PostgREST answers 400 42703, so a misspelled column now fails as it would on the real site. With no rows the
     columns are unknown and nothing is judged. */
  if (rows.length) {
    const known = new Set(); rows.forEach((r) => Object.keys(r).forEach((k) => known.add(k)));
    const named = filters.map((f) => f[0]).concat(order ? splitTop(order).map((o) => o.split(".")[0]) : [])
      .concat(sel ? splitTop(sel).map((i) => i.trim()).filter((i) => i && i !== "*" && i.indexOf("(") < 0).map((i) => (i.indexOf(":") >= 0 ? i.split(":")[1] : i).split("::")[0].split("!")[0].trim()) : []);
    const bad = named.filter((c) => /^[a-z_][a-z0-9_]*$/.test(c) && !known.has(c));
    if (bad.length) return { status: 400, json: { code: "42703", message: "column " + table + "." + bad[0] + " does not exist", hint: null, details: null } };
  }
  rows = clone(rows).filter((r) => keep.every((f) => f(r)));
  if (order) {
    const keys = splitTop(order).map((o) => {
      const parts = o.split("."), desc = parts.indexOf("desc") > 0;
      if (!/^[a-z_][a-z0-9_]*$/.test(parts[0])) throw new Error("the order " + o);
      return { col: parts[0], desc, nullsFirst: parts.indexOf("nullsfirst") > 0 || (desc && parts.indexOf("nullslast") < 0) };
    });
    rows.sort((x, y) => {
      for (const k of keys) {
        const a = x[k.col], b = y[k.col];
        if (a == null || b == null) { if (a == null && b == null) continue; return (a == null) === k.nullsFirst ? -1 : 1; }
        const c = cmp(a, String(b)); if (c) return k.desc ? -c : c;
      }
      return 0;
    });
  }
  rows = rows.slice(offset, limit == null ? undefined : offset + limit).map((r) => project(sel, r));
  if (!single) return { status: 200, json: rows };
  return rows.length === 1 ? { status: 200, json: rows[0] }
    : { status: 406, json: { code: "PGRST116", details: "The result contains " + rows.length + " rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" } };
}
/* -> {status, json} for a read RPC this context answers itself (rpcs, respond "rpc:<name>"), or null */
async function rpcRead(st, name, args) {
  let spec = st.rpcs[name];
  if (spec === undefined) return null;
  if (typeof spec === "function") spec = await spec(args, { persona: st.persona });
  if (spec && "data" in spec) return { status: 200, json: spec.data === undefined ? null : spec.data };
  if (spec && spec.error) return { status: failStatus(spec), json: errJson(spec.error) };
  return { status: 501, json: fail("MOCK2", "mock: the rpcs answer for " + name + " is neither mock.ok(...) nor mock.fail(...)").error };
}

function authAnswer(st, method, p) {
  const s = sessionOf(st.persona);
  if (method === "GET" && p === "/auth/v1/user") return s.user ? { status: 200, json: s.user } : { status: 401, json: { code: 401, error_code: "no_authorization", msg: "mock: signed out" } };
  if (method === "POST" && p === "/auth/v1/token") return s.user ? { status: 200, json: { access_token: s.accessToken, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "mock-refresh", user: s.user } }
    : { status: 400, json: { error: "invalid_grant", error_description: "mock: signed out" } };
  if (method === "POST" && p === "/auth/v1/logout") return { status: 204 };
  return null;
}

const STATE = new WeakMap();

async function onRequest(st, route) {
  const req = route.request(), url = new URL(req.url()), method = req.method(), p = url.pathname;
  const reply = (r) => route.fulfill({ status: r.status, headers: Object.assign({ "content-type": "application/json" }, CORS), body: r.json === undefined ? "" : JSON.stringify(r.json) });
  if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  let args = {};
  if (method === "GET") url.searchParams.forEach((v, k) => { try { args[k] = JSON.parse(v); } catch (e) { args[k] = v; } });
  else { try { args = req.postData() ? JSON.parse(req.postData()) : {}; } catch (e) { args = {}; } }
  const own = st.routes[method + " " + p];
  let r = own ? await own(url, args) : null, why = "";
  try {
    if (!r && p.startsWith("/rest/v1/rpc/")) r = (await rpcRead(st, p.slice(13), args)) || readRpc(st, p.slice(13), args);
    if (!r && (method === "GET" || method === "HEAD") && /^\/rest\/v1\/[a-z_][a-z0-9_]*$/.test(p)) r = await tableRead(st, p.slice(9), url, req);
  } catch (e) { r = null; why = ": " + e.message; }
  if (!r && p.startsWith("/auth/v1/")) r = authAnswer(st, method, p);
  if (r) return reply(r);
  /* the real site shows club logos and pictures from public storage: a blank picture, never production's */
  if (st.live && method === "GET" && p.startsWith("/storage/v1/object/public/")) { st.offsite.push(method + " " + url.origin + p); return route.fulfill({ status: 200, headers: Object.assign({ "content-type": "image/png" }, CORS), body: BLANK_PNG }); }
  st.unexpected.push(method + " " + p);
  console.error("mock: unexpected " + method + " " + p + " as " + st.persona + " (answered 501)" + why);
  if (req.isNavigationRequest()) return route.fulfill({ status: 501, headers: { "content-type": "text/html" }, body: "<p>mock: " + method + " " + p + " is not available in tests</p>" });
  return reply({ status: 501, json: why ? fail("MOCK0", "mock: cannot answer " + method + " " + p + why).error : unexpectedBody(method + " " + p, st.persona) });
}

/* the real site's page and its fence (live: true); each handler steps aside while the context is not live. Only the
   page run.cjs serves (S2_BASE) is rewritten: a suite serving a built site elsewhere keeps it as built */
async function liveRoutes(ctx, st) {
  if (!process.env.S2_BASE) throw new Error("mock: live needs S2_BASE (run suites through tools/ui/run.cjs)");
  const base = new URL(process.env.S2_BASE), local = (u) => LOCAL.test(u.hostname) && /^https?:$/.test(u.protocol);
  await ctx.route((u) => u.origin === base.origin && (u.pathname === base.pathname || u.pathname === "/"), async (route) => {
    if (!st.live || route.request().resourceType() !== "document") return route.fallback();
    const res = await route.fetch();
    try { return route.fulfill({ response: res, body: livePage(await res.text()) }); }
    catch (e) {
      st.unexpected.push("LIVE PAGE " + e.message); console.error(e.message);
      return route.fulfill({ status: 500, headers: { "content-type": "text/html" }, body: "<p>" + e.message.replace(/</g, "&lt;") + "</p>" });
    }
  });
  await ctx.route((u) => u.origin === base.origin && u.pathname.startsWith("/vendor/"), (route) => {
    if (!st.live) return route.fallback();
    const f = path.join(REPO, "vendor", path.basename(new URL(route.request().url()).pathname));
    if (fs.existsSync(f)) return route.fulfill({ status: 200, headers: { "content-type": "text/javascript; charset=utf-8" }, body: fs.readFileSync(f) });
    st.unexpected.push("GET " + route.request().url());
    return route.fulfill({ status: 404, body: "mock: no such file in vendor/" });
  });
  await ctx.route((u) => /^https?:$/.test(u.protocol) && !local(u) && !SUPABASE.test(u.href) && !FONTS.test(u.hostname), (route) => {
    if (!st.live) return route.fallback();
    const req = route.request(), what = req.method() + " " + req.url().split("?")[0];
    if (req.resourceType() === "image") { st.offsite.push(what); return route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: BLANK_PNG }); }
    st.unexpected.push(what);
    console.error("mock: fenced " + what + " (answered 501)");
    return route.fulfill({ status: 501, headers: { "content-type": "text/plain" }, body: "mock: " + what + " is past the network fence" });
  });
}

/* the realtime socket: every join and heartbeat gets an ok, echoing a join's postgres_changes bindings so supabase-js
   accepts the channel (v1 object frames and v2 array frames); nothing is pushed unless a suite calls mock.push */
function onSocket(st, ws) {
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
    const arr = Array.isArray(m), topic = arr ? m[2] : m.topic, event = arr ? m[3] : m.event, payload = (arr ? m[4] : m.payload) || {};
    const ref = arr ? m[1] : m.ref, joinRef = arr ? m[0] : m.join_ref;
    const binds = ((payload.config || {}).postgres_changes || []).map((b, i) => Object.assign({ id: i + 1 }, b));
    if (event === "phx_join") { st.realtime.push(topic); st.channels.push({ ws, arr, topic, joinRef, binds }); }
    if (event === "phx_leave") st.channels = st.channels.filter((c) => c.ws !== ws || c.topic !== topic);
    const response = event === "phx_join" ? { postgres_changes: binds } : {};
    const rep = { status: "ok", response };
    ws.send(JSON.stringify(arr ? [joinRef, ref, topic, "phx_reply", rep] : { topic, event: "phx_reply", payload: rep, ref, join_ref: joinRef }));
  });
  ws.onClose(() => { st.channels = st.channels.filter((c) => c.ws !== ws); });
}
/* h0: a database change as Realtime sends it, to every joined channel whose binding takes it (table, event, and an
   eq-style filter such as "profile_id=eq.<id>", read like a table filter). -> how many channels it reached */
function push(st, table, type, row, old) {
  const T = String(type).toUpperCase(), rec = T === "DELETE" ? old || row : row;
  if (["INSERT", "UPDATE", "DELETE"].indexOf(T) < 0) throw new Error("mock.push: type is INSERT, UPDATE or DELETE, not " + type);
  const takes = (b) => b.table === table && (b.schema || "public") === "public" && (b.event === "*" || String(b.event).toUpperCase() === T)
    && (!b.filter || cond(b.filter.slice(0, b.filter.indexOf("=")), b.filter.slice(b.filter.indexOf("=") + 1))(rec || {}));
  let n = 0;
  st.channels.forEach((c) => {
    const ids = c.binds.filter(takes).map((b) => b.id);
    if (!ids.length) return;
    const payload = { ids, data: { schema: "public", table, commit_timestamp: new Date().toISOString(), type: T, columns: [], record: T === "DELETE" ? {} : row || {}, old_record: old || (T === "DELETE" ? row : {}) || {}, errors: null } };
    c.ws.send(JSON.stringify(c.arr ? [c.joinRef, null, c.topic, "postgres_changes", payload] : { topic: c.topic, event: "postgres_changes", payload, ref: null }));
    n++;
  });
  return n;
}

async function onWrite(st, rpc, args, approval) {
  const call = { rpc, args, approval: approval || null, persona: st.persona };
  st.calls.push(call);
  let spec = st.writes[rpc];
  if (typeof spec === "function") spec = await spec(args, { persona: st.persona, approval: call.approval, calls: st.calls });
  if (spec === undefined) {
    const msg = "mock: no answer for S2.write(\"" + rpc + "\") in this suite's writes table: add mock.ok(...) or mock.fail(code, message, hint)";
    console.error(msg);
    return fail("MOCK1", msg);
  }
  if (!spec || (!("data" in spec) && !spec.error)) return fail("MOCK2", "mock: the writes table answer for " + rpc + " is neither {data} nor {error}");
  return spec;
}

/* runs in the page before any script (serialized: no closure over Node values) */
function pageInit(o) {
  var S2 = window.S2 = window.S2 || {};
  var M = window.S2_MOCK = { persona: o.persona, calls: [], blocked: [] };
  function write(rpc, args, opts) {
    opts = opts || {};
    M.calls.push({ rpc: rpc, args: args, approval: opts.approval || null });
    return window.__s2MockWrite(rpc, args || {}, opts.approval || null).then(function (r) {
      if (r.error) { var e = new Error(r.error.message); e.code = r.error.code; e.hint = r.error.hint; e.details = r.error.details; throw e; }
      /* h0: the result goes to the repaint, as js/live.js settle() gives it; {queued: true} is a move sent to the Owner */
      var res = { data: r.data === undefined ? null : r.data };
      if (r.queued) res.queued = true;
      if (typeof opts.repaint === "function") opts.repaint(res);
      return res;
    });
  }
  /* core.js's own "S2.session = S2.session || {...}" hands the persona back unchanged: that is not a block */
  function own(key, get) { Object.defineProperty(S2, key, { configurable: true, enumerable: true, get: get,
    set: function (v) { if (!(key === "session" && JSON.stringify(v) === o.session) && v !== write) M.blocked.push(key); } }); }
  own("session", function () { return JSON.parse(o.session); });
  own("_writeImpl", function () { return write; });
}

/* page: false after a page layer (run.cjs --mode mock or live installs one in every context): the latest install wins,
   so the earlier init script's properties go and core.js and live.js own S2.session and S2._writeImpl again */
function pageOff() { if (window.S2) { delete window.S2.session; delete window.S2._writeImpl; } delete window.S2_MOCK; }

/* runs in the page before any script on a live context: supabase-js's stored sign-in is the persona's (none for anon) */
function storeInit(o) {
  try { if (o.stored) localStorage.setItem(o.key, o.stored); else localStorage.removeItem(o.key); } catch (e) { /* about:blank has no storage */ }
}

async function install(ctx, opts) {
  opts = opts || {};
  const name = opts.persona || process.env.S2_PERSONA || "anon";
  sessionOf(name);   /* fails loud now on an unknown persona or a missing personas.json */
  let st = STATE.get(ctx);
  if (!st) {
    st = { calls: [], unexpected: [], realtime: [], channels: [], offsite: [], live: false };
    STATE.set(ctx, st);
    await ctx.route(SUPABASE, (route) => onRequest(st, route));
    await ctx.routeWebSocket(SUPABASE_WS, (ws) => onSocket(st, ws));
    await ctx.exposeBinding("__s2MockWrite", (source, rpc, args, approval) => onWrite(st, rpc, args, approval));
  }
  const live = opts.live != null ? !!opts.live : process.env.S2_MODE === "live" || st.live;
  if (st.live && !live) throw new Error("mock: this context is live (the real site); open a new context for another mode");
  if (live && !st.live) { st.live = true; await liveRoutes(ctx, st); }
  const session = live ? liveSessionOf(name, opts.session) : withSession(name, opts.session), d = live ? liveDefaults(session) : { tables: {}, rpcs: {} };
  st.persona = name;
  st.writes = Object.assign({}, opts.writes);
  st.routes = Object.assign({}, opts.routes);
  st.tables = Object.assign(d.tables, opts.tables);
  st.rpcs = Object.assign(d.rpcs, opts.rpcs);
  if (live) await ctx.addInitScript(storeInit, { key: STORE_KEY, stored: session.user ? JSON.stringify({ access_token: session.accessToken, token_type: "bearer",
    expires_in: 3600, expires_at: 4102444800, refresh_token: "mock-refresh", user: session.user }) : null });
  if (opts.page !== false) { st.page = true; await ctx.addInitScript(pageInit, { persona: name, session: JSON.stringify(session) }); }
  else if (st.page) { st.page = false; await ctx.addInitScript(pageOff); }
  return st;
}

const state = (ctx) => { const st = STATE.get(ctx); if (!st) throw new Error("mock: install(ctx) was never called on this context"); return st; };
module.exports = {
  PW, install, ok, fail, sessionOf, liveSessionOf, MARKET_RULES,
  personas: () => Object.keys(personas().personas),
  calls: (ctx) => state(ctx).calls,
  unexpected: (ctx) => state(ctx).unexpected,
  realtime: (ctx) => state(ctx).realtime,
  offsite: (ctx) => state(ctx).offsite,
  push: (ctx, table, type, row, old) => push(state(ctx), table, type, row, old),
  /* a bare name answers S2.write; "table:<name>" a table GET; "rpc:<name>" a read RPC over the network */
  respond: (ctx, key, spec) => { const st = state(ctx), m = /^(table|rpc):(.+)$/.exec(key); (m ? st[m[1] === "table" ? "tables" : "rpcs"] : st.writes)[m ? m[2] : key] = spec; },
  league: (args) => { const r = s2League(args || {}); if (r.status !== 200) throw new Error(r.json.message); return clone(r.json); }
};
