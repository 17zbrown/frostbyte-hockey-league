/* v4.55: the v4.53 club closing, hardened after an adversarial review (commissioner, 2026-11-20: "As soon as that specific
   team's season is over ... that management and roster should have their team roles removed since they no longer play any
   games. Give it 24 hours"; "End quietly"). Pins the SQL record (rehearsed on production, applied as
   v455_club_season_close_hardening), RUNS the shared role rule for a closed club's player, checks the two readers of
   discord_links.season_over, Rules 0.2, 0.9 and 2.6, and the changelog. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 220))); } };
const sql = R("sql/2026-11-20-club-season-close-hardening-v455.sql");

A("1 quiet: the Off the front office club-room notice is skipped while a club is closed", /\/\* v4\.55: a seat that ends with its club's season \(app\.mgmt_quiet, _close_club_season\) posts nothing \*\/\n      if coalesce\(current_setting\('app\.mgmt_quiet', true\), ''\) <> 'on' then\n      perform public\.club_notify\(p_team, 'roster', 'Off the front office: '/.test(sql));
A("2 the seat holders are recorded when the season ends", /insert into public\.club_season_ends \(season_id, team_id, reason, owner_id, gm_id, agm_id\)\n    select p_season, p_team, p_reason, t\.owner_profile_id, t\.gm_profile_id, t\.agm_profile_id from public\.teams t where t\.id = p_team/.test(sql));
A("2 ...and the closing ends only a seat its recorded holder still holds", ["agm", "gm", "owner"].every((k) => new RegExp("if t\\." + k + "_profile_id +is not null and e\\." + k + "_id is not distinct from t\\." + k + "_profile_id").test(sql)) && !/2026-11-21/.test(sql.split("/* REHEARSAL")[0]));
A("3 a ruling that leaves no winner stops both clubs' clocks", /'now', null\)\);\$a\$;[\s\S]*?and e\.team_id in \(new\.home_team_id, new\.away_team_id\);\$b\$/.test(sql));
A("3 a reversal frees the club now advancing and records the club now out", /and e\.team_id = v_winner;\n      perform public\._club_season_over\(new\.season_id, v_loser, 'eliminated'\);\$b\$/.test(sql));
A("3 clearing a round stops its clubs' clocks (round 1: the missed-playoffs ones)", /or \(p_round = 1 and e\.reason = 'missed_playoffs'\)\)/.test(sql));
A("3 a closed club can be reopened, with a reason, audited, and not from the API", /create or replace function public\.reopen_club_season\(p_season uuid, p_team uuid, p_why text\)/.test(sql) &&
  /say why \(it goes in the audit\)/.test(sql) && /log_admin_action\('club_season_reopened'/.test(sql) && /revoke all on function public\.reopen_club_season\(uuid, uuid, text\) from public, anon, authenticated;/.test(sql));
A("4 discord_links.season_over: a roster spot in a season still being played on a closed club", /s\.status <> 'complete'::public\.season_status\n              join public\.club_season_ends e on e\.season_id = rs\.season_id and e\.team_id = rs\.team_id and e\.closed_at is not null\n             where rs\.profile_id = p\.id\) as season_over/.test(sql));
A("each anchored patch must match exactly once", (sql.match(/if n <> 1 then raise exception/g) || []).length >= 6);
A("rehearsal and apply recorded", /T3  a best-of-seven played through trg_conclude_series/.test(sql) && /Result: REHEARSAL OK\./.test(sql) && /Applied as migration v455_club_season_close_hardening; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
A("the sweep and the bot read season_over", /discord_links\?select=profile_id,gamertag,role,discord_id,team_id,discord_username,season_over/.test(R("jobs/discord-sync.js")) &&
  /select=profile_id,role,discord_id,team_id,season_over`/.test(R("bot/role-sync.mjs")));

(async () => {
  const roles = await import(path.join(__dirname, "..", "shared", "roles.mjs"));
  const ctx = { roleId: { player: "rP", "free agent": "rFA", "restricted free agent": "rRFA" }, teamRoleId: { T1: "rBOS" },
    registered: new Set(["p"]), playing: new Set(["p"]), regOpen: false, mgmtRoleByProfile: {}, deptByProfile: {}, posOf: {}, rfa: new Set() };
  const on = [...roles.desiredRolesFor({ profile_id: "p", role: "user", team_id: "T1", season_over: false }, ctx)].sort();
  const closed = [...roles.desiredRolesFor({ profile_id: "p", role: "user", team_id: null, season_over: true }, ctx)].sort();
  const free = [...roles.desiredRolesFor({ profile_id: "p", role: "user", team_id: null, season_over: false }, ctx)].sort();
  const rfa = [...roles.desiredRolesFor({ profile_id: "p", role: "user", team_id: null, season_over: true }, Object.assign({}, ctx, { rfa: new Set(["p"]) }))].sort();
  A("a rostered player wears the club role", JSON.stringify(on) === JSON.stringify(["rBOS", "rP"]), on);
  A("a closed club's player, still registered for the season being played: Player, no club role, no Free Agent", JSON.stringify(closed) === JSON.stringify(["rP"]), closed);
  A("...nor Restricted Free Agent", JSON.stringify(rfa) === JSON.stringify(["rP"]), rfa);
  A("an unrostered registered player off any closed club is still a Free Agent (unchanged)", JSON.stringify(free) === JSON.stringify(["rFA", "rP"]), free);

  global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));   /* the repo's own rulebook source */
  const rb = CG.CONTENT.rulebook, secs = {};
  rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
  const book = JSON.stringify(rb.chapters);
  A("Rule 0.9: front offices no longer continue between seasons", !/Clubs and their front offices continue/.test(book) &&
    /Clubs continue\. Every front-office seat ends with the club's season \(Rule 2\.6\)/.test(secs["0.9"].paragraphs[1]));
  A("Rule 0.2: Owners are appointed for the coming season, not renewed", !/to renew or appoint each club's Owner/.test(book) &&
    ["paragraphs", "full"].every((k) => /to appoint each club's Owner for the coming season/.test((secs["0.2"][k] || [])[0] || "")));
  A("Rule 2.6: a corrected result moves the clock, and a closed club can be reopened", ["paragraphs", "full"].every((k) =>
    /A ruling that changes who lost a playoff series, or a playoff round drawn again, moves the clock to the club now out/.test(secs["2.6"][k][2])));
  const e = rb.changelog.find((c) => c.version === "4.55");
  A("changelog records 4.55, keys in order", !!e && Object.keys(e).join(",") === "version,dateIso,summary,items");
  A("no em dashes or spaced hyphens in 4.55 or the rule text", !!e && !/—|–| - /.test(JSON.stringify(e)) && !/—| - /.test(secs["0.9"].paragraphs[1] + secs["2.6"].paragraphs[2]));
  console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log("FAIL threw: " + (err && err.stack || err)); process.exit(1); });
