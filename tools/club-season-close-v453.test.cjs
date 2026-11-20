/* v4.53 (commissioner, 2026-11-20): twenty-four hours after a club's season ends, every front-office seat (the Owner's
   included) ends and the club's Discord role comes off its roster; Season 1's clubs were closed at once, quietly.
   Pins the SQL record (rehearsed on production, applied as v453_club_season_close), the Team HQ caption, Rules 1.3 and
   2.6 as rendered, the shared role rule the sweep and the bot use, and the changelog entry. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };

const sql = R("sql/2026-11-20-club-season-close-v453.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const live = R("src/live/part_live.js");

/* the ruling, quoted */
A("ruling quoted", /that management and roster should have their team roles removed since they no longer play any games\. Give it 24 hours to remove the roles for the future though\./.test(sqlF));
A("the quiet choice and Season 1 now are recorded", /End quietly/.test(sql) && /Rosters too, now/.test(sql));
A("supersedes v3.69 Q45", /Supersedes v3\.69/.test(sql) && /Just the GM and AGM seats do\. The Owner stays for now\./.test(sql));

/* the model */
A("club_season_ends: one row per club and season, locked down", /create table if not exists public\.club_season_ends/.test(sql) && /primary key \(season_id, team_id\)/.test(sql) &&
  /alter table public\.club_season_ends enable row level security;/.test(sql) && /revoke all on table public\.club_season_ends from public, anon, authenticated;/.test(sql));
A("the first moment stands", /on conflict \(season_id, team_id\) do nothing;   -- the first moment stands/.test(sql));
A("the three moments record the end instead of ending seats", ["trg_seeds_end_seats", "trg_series_ends_seats", "trg_season_complete_ends_seats"].every((f) =>
  new RegExp("create or replace function public\\." + f + "\\(\\)[\\s\\S]*?_club_season_over[\\s\\S]*?end \\$fn\\$;").test(sql)));
A("missed, eliminated, final", /'missed_playoffs'\)\n     from public\.teams tm/.test(sql) && /_club_season_over\(v_season, v_loser, 'eliminated'\)/.test(sql) && /_club_season_over\(new\.id, tm\.id, 'final'\)/.test(sql));
A("a series names its season from the key, not current_season_id()", /where number::text = v_parts\[2\]/.test(sql));
A("a reseed stops a running clock and flags an already closed club", /e\.reason = 'missed_playoffs' and e\.closed_at is null;/.test(sql) && /A club back in the playoffs had already been closed/.test(sql));
A("the v4.40c reseed trap comment is kept", /v4\.40c: once per club per season\. A reseed \(clear round 1, draw it again\)/.test(sql));
A("the clock is 24 hours, every 10 minutes", /ended_at <= now\(\) - interval '24 hours'/.test(sql) && /cron\.schedule\('club-season-close', '\*\/10 \* \* \* \*', \$\$select public\.close_finished_clubs\(\)\$\$\)/.test(sql));
A("closing ends AGM, GM and Owner through the one seat door", /_set_team_seat\(p_team, 'agm',   null, 'season'\)/.test(sql) && /_set_team_seat\(p_team, 'gm',    null, 'season'\)/.test(sql) && /_set_team_seat\(p_team, 'owner', null, 'season'\)/.test(sql));
A("closing is quiet and records the season the seat belonged to", /set_config\('app\.mgmt_quiet', 'on', true\)/.test(sql) && /set_config\('app\.seat_season', p_season::text, true\)/.test(sql));
A("the GUCs are restored", /set_config\('app\.mgmt_quiet', v_quiet, true\)/.test(sql) && /set_config\('app\.seat_season', v_seat, true\)/.test(sql) && /set_config\('app\.role_grant', v_grant, true\)/.test(sql));
A("closing queues the roster for the bot and is audited", /_rsq\(rs\.profile_id, 'club_closed'\)/.test(sql) && /log_admin_action\('club_season_closed'/.test(sql));
A("quiet guards: management moves, #transactions, access reset", /notify_mgmt_move anchor/.test(sql) && /notify_discord_transaction anchor/.test(sql) && /reset_mgmt_on_owner_change anchor/.test(sql) &&
  (sql.match(/coalesce\(current_setting\('app\.mgmt_quiet', true\), ''\) = 'on' then return new; end if;/g) || []).length === 2);
A("each patch anchors exactly once", (sql.match(/if n <> 1 then raise exception/g) || []).length === 6);
A("the season wording for a seat that ends with the club's season", /'s time as ' \|\| v_seat \|\| ' ended with the club''s season'/.test(sql) &&
  /so its front-office seats have ended \(Rule 2\.6\)\. Each club''s management is decided again for the next season\./.test(sql));
A("discord_links skips a closed club", /create or replace view public\.discord_links as[\s\S]*?not exists \(select 1 from public\.club_season_ends e[\s\S]*?e\.closed_at is not null\)/.test(sql));
A("end_season_mgmt_seats dropped and checked gone", /drop function if exists public\.end_season_mgmt_seats\(uuid, text\);/.test(sql) && /end_season_mgmt_seats still exists/.test(sql));
A("Season 1 recorded at the real moments, 2 missed, 5 eliminated, the Bruins in the final", /key = 'playoff_seeds_1'/.test(sql) && /c\.key like 'series\\_1\\_%'/.test(sql) &&
  /the recorded endings are not 2 missed, 5 eliminated and the Bruins in the final/.test(sql));
A("the two Bruins lines moved back to Season 1, exactly two", /'e396553e-3ad3-4142-992c-5d05374ca521', '5649f409-c3eb-4349-8892-c1ddc0a918a0'/.test(sql) && /expected to move 2 Bruins management lines back/.test(sql));
A("self-checks: no seat held, no Season 1 club role, nothing reachable by the API roles", /a club seat is still held/.test(sql) && /a member still wears a Season 1 club role/.test(sql) &&
  /has_table_privilege\('anon', 'public\.club_season_ends', 'select'\)/.test(sql));
A("rehearsal recorded, the first failure included", /T3 failed: "8 Discord requests queued"/.test(sql) && /Result: REHEARSAL OK\./.test(sql));
A("applied and audited", /Applied as migration v453_club_season_close; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
A("the owner DM is the approved text", /\*\*Chel Gaming: please stay in your NHL 27 club\.\*\* Season 1 is over, so your Owner seat with the /.test(sql) &&
  /until further notice, so the league does not lose the club\. The league office will tell you when that changes\. Thank you for running the /.test(sql) &&
  /and not exists \(select 1 from public\.discord_dms d where d\.profile_id = p\.id and d\.kind = 'season_end'\)/.test(sql));

/* the one role rule: no club on the link, no club role (the sweep and the bot both import it) */
(async () => {
  const roles = await import(path.join(__dirname, "..", "shared", "roles.mjs"));
  const ctx = { roleId: { player: "rP", "free agent": "rFA" }, teamRoleId: { T1: "rBOS" }, registered: new Set(), regOpen: false, mgmtRoleByProfile: {}, deptByProfile: {}, posOf: {} };
  const on = roles.desiredRolesFor({ profile_id: "p", role: "user", team_id: "T1" }, ctx);
  const off = roles.desiredRolesFor({ profile_id: "p", role: "user", team_id: null }, ctx);
  A("a member whose club is closed (team_id null) loses the club role", on.has("rBOS") && !off.has("rBOS"));

  A("Team HQ caption says the new rule and keeps the Q45 quote", /Every seat, the Owner’s included, ends 24 hours after the club’s season ends \(out of the playoffs, eliminated, or the final played\), and the club role comes off the roster then too \(Rule 2\.6\)\./.test(live) &&
    !/the Owner’s seat continues/.test(live) && /Just the GM and AGM seats do\. The Owner stays for now\./.test(live));

  global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
  const rb = CG.CONTENT.rulebook, secs = {};
  rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
  A("Rule 2.6 (both formats): every seat ends 24 hours after the club's season, with the club role", ["paragraphs", "full"].every((k) =>
    /Every front-office seat, the Owner's included, ends with its management contract twenty-four \(24\) hours after the club's season ends: when the club does not qualify for the playoffs once the regular season ends, when it is eliminated, or when the final is played\./.test(secs["2.6"][k][2]) &&
    /comes off every member of the club, since the club plays no more games that season \(Rule 1\.3\)/.test(secs["2.6"][k][2]) &&
    !/The Owner's seat continues/.test(secs["2.6"][k][2]) && !/for what remains of the season/.test(secs["2.6"][k][2])));
  A("Rule 1.3: the club role is worn while the club's season is in play", /A club's role, and with it the club room, is worn by the club's roster and management while the club's season is in play; twenty-four \(24\) hours after the club's season ends, it comes off every member of the club \(Rule 2\.6\)\./.test(secs["1.3"].paragraphs[2]));
  const rendered = JSON.stringify(rb.chapters);
  A("the stale sentence is gone from the whole book", !/The Owner's seat continues/.test(rendered) && !/the Owner’s seat continues/.test(rendered));
  const e = rb.changelog.find((c) => c.version === "4.53");
  A("changelog records 4.53, keys in order", !!e && Object.keys(e).join(",") === "version,dateIso,summary,items");
  A("4.53 names Rules 1.3 and 2.6 and Season 1", !!e && /Rules 1\.3 and 2\.6/.test(e.items.join(" ")) && /Season 1/.test(e.summary));
  A("no em dashes or spaced hyphens in the 4.53 entry or the new rule text", !/—|–| - /.test(JSON.stringify(e)) && !/—| - /.test(secs["2.6"].paragraphs[2] + secs["1.3"].paragraphs[2]));
  A("the private DM is not in the public change record", !/NHL 27 club/.test(JSON.stringify(e)));
  console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log("FAIL threw: " + (err && err.stack || err)); process.exit(1); });
