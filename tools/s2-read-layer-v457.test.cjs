/* v4.57: the Season 2 site's league read (sql/2026-11-24-s2-read-layer-v457.sql). public.s2_league is SECURITY INVOKER,
   one data statement, one jsonb; public.league_tenures is the definer that buckets the club-history free text. Pins the
   security mode, grants, the column denylist, the box column header, the sections, the tenure buckets and the
   rehearsal (briefs/data_layer.md sections 1, 2 and 7). */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 220))); } };
const REC = "sql/2026-11-24-s2-read-layer-v457.sql";
const sql = R(REC), reh = R(REC.replace(/\.sql$/, ".rehearsal.sql"));
const live = R("src/live/part_live.js");
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const s2 = (sql.match(/create or replace function public\.s2_league\([\s\S]*?\$function\$;/) || [""])[0];
const lt = (sql.match(/create or replace function public\.league_tenures\(p_season int\)[\s\S]*?\$function\$;/) || [""])[0];
const hin = (sql.match(/create or replace function public\._tenure_how_in\(p_how text, p_drafted boolean\)[\s\S]*?\$function\$;/) || [""])[0];
const hout = (sql.match(/create or replace function public\._tenure_how_out\(p_how text\)[\s\S]*?\$function\$;/) || [""])[0];
const body = noComments(s2);
const applied = sql.slice(0, sql.indexOf("\n/* REHEARSAL") + 1);   // what the migration runs; results are appended after it

// security mode, search_path, grants
A("s2_league: plpgsql, STABLE, SECURITY INVOKER, search_path ''", /returns jsonb\n language plpgsql\n stable\n security invoker\n set search_path to ''/.test(s2));
A("s2_league: (season number, sections, game ids), all optional", /public\.s2_league\(p_season int default null, p_sections text\[\] default null,\s+p_game_ids uuid\[\] default null\)/.test(s2));
A("s2_league: PUBLIC revoked, anon and authenticated granted", /revoke all on function public\.s2_league\(int, text\[\], uuid\[\]\) from public, anon, authenticated;\ngrant execute on function public\.s2_league\(int, text\[\], uuid\[\]\) to anon, authenticated;/.test(sql));
A("league_tenures: SQL, STABLE, SECURITY DEFINER, search_path ''", /language sql\n stable\n security definer\n set search_path to ''/.test(lt));
A("league_tenures: PUBLIC revoked, anon and authenticated granted (league record)", /revoke all on function public\.league_tenures\(int\) from public, anon, authenticated;\ngrant execute on function public\.league_tenures\(int\) to anon, authenticated;/.test(sql));
const code = (body + noComments(lt + hin + hout)).replace(/'[^']*'/g, "''");   // string literals ('moved from another club') are not names
A("every table in both bodies is schema-qualified", !/\b(from|join) (?!public\.|unnest\(|jsonb_each\(|jsonb_array_elements\()[a-z_]+\b/.test(code), code.match(/\b(from|join) (?!public\.|unnest\(|jsonb_each\(|jsonb_array_elements\()[a-z_]+\b/));

// one statement, explicit projection, nothing denied
A("one data statement: the season lookup, then a single return (select ...)", (body.match(/\breturn \(/g) || []).length === 1 && (body.match(/^\s+select /gm) || []).length >= 1);
A("no select * and no to_jsonb of a row", !/select \*|\.\*/.test(body) && !/to_jsonb\((?!v_want\))/.test(body));
const denied = ["discord_", "ea_id", "ea_player_id", "ea_club", "skater_name", "timezone", "departments", "preferred_server", "game_code",
  "server", "payload", "subject", "details", "response", "reason", "grounds", "credit", "command", "ban_reason", "banned_at", "banned_by",
  "is_admin", "platform_gamertag", "playoff_floors", "regular_gp", "gp_credits"];
A("s2_league never names a denied column or source", denied.every((d) => !new RegExp("\\b" + d).test(body)), denied.filter((d) => new RegExp("\\b" + d).test(body)));
A("joined_how and left_how never leave league_tenures: only bucket helper arguments and the drafted test read them", !/joined_how|left_how/.test(body) &&
  (noComments(lt).match(/rt\.joined_how/g) || []).length === 2 && (noComments(lt).match(/rt\.left_how/g) || []).length === 2 &&
  /public\._tenure_how_in\(rt\.joined_how,\n/.test(lt) && /public\._tenure_how_out\(rt\.left_how\) as how_out/.test(lt) &&
  /returns table\(profile_id uuid, team text, team_id uuid, "position" text, squad text, joined_at timestamptz,\n\s+left_at timestamptz, how_in text, how_out text\)/.test(lt));
A("unknown sections and missing seasons fail loud", /errcode = '22023'/.test(body) && /errcode = 'P0002'/.test(body));

// the sections
const all = (body.match(/v_all\s+constant text\[\] := array\[([^\]]+)\]/) || [, ""])[1].replace(/\s/g, "").split(",").map((x) => x.replace(/'/g, ""));
const lazy = (body.match(/v_lazy constant text\[\] := array\[([^\]]+)\]/) || [, ""])[1].replace(/\s/g, "").split(",").map((x) => x.replace(/'/g, ""));
A("the sections the contract names", JSON.stringify(all) === JSON.stringify(["league", "teams", "seasons", "config", "games", "box", "pct", "rosters", "ratings",
  "people", "career", "honors", "tenures", "signups", "suspensions", "draft", "news", "wire"]), all);
A("news and wire are lazy", JSON.stringify(lazy) === JSON.stringify(["news", "wire"]));
A("every section is built once, behind its own guard", all.every((k) => (body.match(new RegExp("case when '" + k + "' = any \\(v_want\\) then jsonb_build_object\\('" + k + "'", "g")) || []).length === 1));
A("pulse comes from live_pulse in the same statement", /'pulse', \(select jsonb_build_object\('v', lp\.v, 'd', lp\.d, 'site_build', lp\.site_build\)\s+from public\.live_pulse lp where lp\.id = 1\)/.test(body));
A("the season on screen: games, box, spots, signups by season id; picks and draft state by number", /where g\.season_id = v_sid and \(p_game_ids is null or g\.id = any \(p_game_ids\)\)/.test(body) &&
  /where bg\.season_id = v_sid and \(p_game_ids is null or bg\.id = any \(p_game_ids\)\)/.test(body) && /where rs\.season_id = v_sid\)/.test(body) &&
  /rp where rp\.season_id = v_sid/.test(body) && /ds where ds\.season_number = v_num/.test(body) && /where dp\.season_number = v_num/.test(body));
A("ratings carry v448: true; tenures come from league_tenures; pct from cghl_settle_gp; career from career_games_played", /'categories', r\.categories, 'v448', true\)/.test(body) &&
  /from public\.league_tenures\(v_num\) tn/.test(body) && /'min_gp', public\.cghl_settle_gp\(\)/.test(body) && /from public\.career_games_played\(\) cg/.test(body));

// the box: one value per column, in order, and only columns the API roles may read
const cols = ((body.match(/'cols', jsonb_build_array\(([\s\S]*?)\),\n/) || [, ""])[1].match(/'[a-z_]+'/g) || []).map((x) => x.slice(1, -1));
const vals = ((body.match(/jsonb_agg\(jsonb_build_array\(gs\.id,([\s\S]*?)\) order by gs\.id\)/) || [, ""])[1]);
const valNames = ["id"].concat(vals.split(",").map((x) => x.trim().replace(/^(gs|bt)\./, "")).map((x) => x === "code" ? "team" : x));
A("box: 42 columns", cols.length === 42, cols.length);
A("box: the header names each value in order", JSON.stringify(cols) === JSON.stringify(valNames), { cols, valNames });
A("box: keyed by club code, never ea_player_id or skater_name", cols[1] === "team" && /left join public\.teams bt on bt\.id = gs\.team_id/.test(body) && !cols.includes("ea_player_id") && !cols.includes("skater_name"));

// games: CG.GAME_PUBLIC_COLS, plus club codes
const gpc = (live.match(/CG\.GAME_PUBLIC_COLS = ([\s\S]*?);\n/) || [, ""])[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/["+\s]/g, "").split(",");
const games = (body.match(/jsonb_build_object\('games', \([\s\S]*?order by g\.scheduled_at, g\.id\)/) || [""])[0];
A("games: every column of CG.GAME_PUBLIC_COLS", gpc.length > 20 && gpc.every((c) => games.includes("'" + c + "', g." + c)), gpc.filter((c) => !games.includes("'" + c + "', g." + c)));
A("games: home, away and forfeit club codes", /'home', h\.code, 'away', a\.code/.test(games) && /'forfeit', f\.code/.test(games));

// people: only columns anon is granted (CG.PROFILE_PUBLIC_COLS), and none of the identity ones
const ppc = (live.match(/CG\.PROFILE_PUBLIC_COLS = ([\s\S]*?);\n/) || [, ""])[1].replace(/["+\s]/g, "").split(",");
const people = ((body.match(/jsonb_build_object\('people', \([\s\S]*?order by p\.id\)/) || [""])[0].match(/'([a-z_]+)', p\.\1/g) || []).map((x) => x.split("'")[1]);
A("people: id, gamertag, display_name, avatar_url, role, jersey_number, platform, banned", JSON.stringify(people) === JSON.stringify(["id", "gamertag", "display_name", "avatar_url", "role", "jersey_number", "platform", "banned"]), people);
A("people: every one is a column anon may read", people.every((c) => ppc.includes(c)));
A("suspensions: never reason, reason_codes, grounds, request_id or created_by", !/x\.(reason|grounds|request_id|created_by)/.test(body));

// league_tenures buckets: the two helpers, RUN here on every value the writers produce
A("the bucket helpers: SQL, IMMUTABLE, search_path '', not callable through the API", [hin, hout].every((t) => /\n language sql\n immutable\n set search_path to ''/.test(t)) &&
  /revoke all on function public\._tenure_how_in\(text, boolean\) from public, anon, authenticated;/.test(sql) && /revoke all on function public\._tenure_how_out\(text\) from public, anon, authenticated;/.test(sql) &&
  !/grant execute on function public\._tenure_how_(in|out)/.test(sql));
// a small reader of the helpers' CASE arms (=, in, like, is null, p_drafted), so the mapping is checked without a database
const caseOf = (fnTxt) => {
  const c = noComments(fnTxt), arms = [];
  for (const m of c.matchAll(/when (.+?) then (null|'([a-z]+)')\n/g)) arms.push({ conds: m[1].split(/ or (?=p_)/), out: m[3] || null });
  const els = (c.match(/else '([a-z]+)'\n\s+end/) || [])[1];
  const like = (pat) => new RegExp("^" + pat.replace(/\\_/g, "\u0000").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".").replace(/\u0000/g, "_") + "$", "s");
  const test = (cond, v, drafted) => {
    let m;
    if (cond === "p_drafted") return !!drafted;
    if (cond === "p_how is null") return v === null;
    if ((m = cond.match(/^p_how = '([^']*)'$/))) return v === m[1];
    if ((m = cond.match(/^p_how in \((.*)\)$/))) return v !== null && m[1].split(/,\s*/).map((x) => x.replace(/^'|'$/g, "")).includes(v);
    if ((m = cond.match(/^p_how like '([^']*)'$/))) return v !== null && like(m[1]).test(v);
    throw new Error("unread condition: " + cond);
  };
  return { arms, els, run: (v, drafted) => { for (const a of arms) if (a.conds.some((x) => test(x.trim(), v, drafted))) return a.out; return els; } };
};
const IN = caseOf(hin), OUT = caseOf(hout);
const pairs = (list) => [...list.matchAll(/\((null|'[^']*'), (null|'[^']*')\)/g)].map((m) => [m[1] === "null" ? null : m[1].slice(1, -1), m[2] === "null" ? null : m[2].slice(1, -1)]);
const lists = [...sql.matchAll(/from \(values ([\s\S]*?)\) v\(how, want\)/g)].map((m) => pairs(m[1]));
const [inList, outList] = [lists[0] || [], lists[1] || []];
A("the self-checks list every value with its bucket (24 joined, 18 left)", lists.length === 2 && inList.length === 24 && outList.length === 18, [inList.length, outList.length]);
A("how_in: the helper gives every listed value its listed bucket", IN.arms.length === 10 && IN.els === "other" && inList.every(([v, w]) => IN.run(v, false) === w), inList.filter(([v, w]) => IN.run(v, false) !== w));
A("how_in: an 'assigned' stint that is a draft pick reads drafted; a seat or an add stays placed", IN.run("assigned", true) === "drafted" && IN.run("assigned", false) === "placed");
A("how_out: the helper gives every listed value its listed bucket", OUT.arms.length === 10 && OUT.els === "office" && outList.every(([v, w]) => OUT.run(v) === w), outList.filter(([v, w]) => OUT.run(v) !== w));
A("a position change is a 'position' stint on both ends, never an office removal or other", IN.run("position changed") === "position" && OUT.run("position changed") === "position");
A("the draft doors' phrases: a reversed pick reads reversed, and the drafted test reads draft_picks on that club at that moment",
  OUT.run("pick reversed") === "reversed" && /rt\.joined_how = 'assigned'\n\s+and \(rt\.left_how is not distinct from 'pick reversed'\n\s+or exists \(select 1 from public\.draft_picks dp\n\s+where dp\.used and dp\.player_id = rt\.profile_id and dp\.season_number = s\.number\n\s+and dp\.current_team_id = rt\.team_id and dp\.picked_at = rt\.joined_at\)\)\) as how_in,/.test(lt));
// every phrase a writer in sql/ produces is listed (so a new phrase fails here until the record gives it a bucket)
const sqlDir = path.join(__dirname, "..", "sql");
const recs = fs.readdirSync(sqlDir).filter((f) => /\.sql$/.test(f) && !/rehearsal/.test(f)).sort();
const trigFile = recs.filter((f) => /create or replace function public\._roster_tenure_track\(\)/.test(R("sql/" + f))).pop();
const trig = trigFile ? (R("sql/" + trigFile).match(/create or replace function public\._roster_tenure_track\(\)[\s\S]*?\$function\$;/) || [""])[0] : "";
const phrases = [...new Set([...noComments(trig).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]).filter((x) => /^[a-z][a-z ]*[a-z]$/.test(x) && x !== "tc" && x !== "pro"))];
const known = new Set(inList.concat(outList).map(([v]) => v));
A("every phrase the newest tenure trigger writes (" + trigFile + ") is listed", phrases.length >= 10 && phrases.includes("position changed") && phrases.every((x) => known.has(x)), phrases.filter((x) => !known.has(x)));
const allRecs = recs.map((f) => R("sql/" + f)).join("\n");
const reasons = [...new Set([...allRecs.matchAll(/app\.roster_reason'\s*,\s*'([^']+)'/g), ...allRecs.matchAll(/_remove_for_discipline\([^;)]*?,\s*'([^']+)'\)/g)].map((m) => m[1]))];
const outKnown = new Set(outList.map(([v]) => v));
A("every roster reason a sql/ record sets is listed with its how_out bucket", reasons.length >= 4 && reasons.every((x) => outKnown.has(x)), reasons.filter((x) => !outKnown.has(x)));
const origins = [...new Set([...allRecs.matchAll(/origin = any \(array\[([^\]]+)\]\)/g)].flatMap((m) => m[1].match(/'[a-z_]+'/g).map((x) => x.slice(1, -1))).concat(["waiver_claim", "market_bid", "market_placed"]))];
const inKnown = new Set(inList.map(([v]) => v));
A("every roster origin (the origin check, with db-guards' three Season 2 origins) is listed with its how_in bucket", origins.length === 12 && origins.every((x) => inKnown.has(x)), origins.filter((x) => !inKnown.has(x)));

// self-checks and rehearsal
A("self-checks: modes, grants, counts against direct reads (as the owner and as a signed-out visitor), buckets, denylist, defaults, narrowing, fail-loud", ["must be SECURITY INVOKER", "must be SECURITY DEFINER",
  "PUBLIC still holds EXECUTE", "games: % in the body", "box: % lines in the body", "box: a line does not have one value per column", "tenures: % in the body",
  "a signed-out visitor reads different counts from s2_league(1)", "how_in buckets are wrong", "how_out buckets are wrong",
  "the tenure trigger writes phrases league_tenures has no bucket for", "roster origins with no league_tenures bucket",
  "a stint began in a way that has no bucket", "used draft picks do not read drafted", "the tenure bucket helpers are callable through the API",
  "returns denied columns", "default sections are wrong", "did not narrow the body", "an unknown section did not raise",
  "a missing season did not raise"].every((t) => sql.includes(t)));
A("self-check: the signed-out read runs as anon with no claims, then returns to the owner", /perform set_config\('request\.jwt\.claims', '', true\);\n  perform set_config\('role', 'anon', true\);\n  ba := public\.s2_league\(1\);\n  perform set_config\('role', 'none', true\);/.test(sql));
A("self-check: the data checks cover every season, not only Season 1", /from public\.seasons x, public\.league_tenures\(x\.number\) t where t\.how_in = 'other'/.test(sql) &&
  /with t as \(select x\.number, lt\.\* from public\.seasons x, public\.league_tenures\(x\.number\) lt\)/.test(sql));
A("rehearsal: anon, a member and a media-only staffer, every season, counts equal direct reads, under 1 s", /array\['anon', 'member', 'media'\]/.test(reh) &&
  /if v_ms >= 1000 then raise exception/.test(reh) && /counts % differ from direct reads/.test(reh));
A("rehearsal: 42501 only where intended (roster_tenures stays closed; league_tenures answers)", /if sqlstate <> '42501' then raise; end if;/.test(reh) && /T4 anon league_tenures\(1\) count differs/.test(reh));
A("rehearsal: every season's stints bucketed, how_out set exactly when the stint closed, every used Season 1 pick drafted", /T4 a stint has no how_in bucket, or how_out disagrees with left_at/.test(reh) &&
  /T4 league_tenures\(1\) has % drafted stints for % used picks/.test(reh));
A("rehearsal: the record's text verbatim, inside the transaction, before the cases", reh.indexOf(applied) > reh.indexOf("\nbegin;\n") && reh.indexOf(applied) + applied.length <= reh.indexOf("do $r$"));
A("rehearsal: expected refusals re-raise anything else; ends in an uncaught REHEARSAL OK", !/exception when others then null/.test(reh) &&
  /raise exception 'REHEARSAL OK: % Slowest s2_league call % ms\.', v_out, round\(v_slow\);\nend \$r\$;\s*$/.test(reh));
A("rehearsal: no dblink, no http, no commit", !/dblink|http_post|http_get|\bcommit\b/i.test(reh.replace(/--.*$/gm, "")));
A("the record carries its rehearsal block", /\/\* REHEARSAL/.test(sql));
A("no recorded body or fixture is in the repo", !fs.readdirSync(path.join(__dirname, "..")).some((f) => /s2_league.*\.json$/.test(f)) &&
  !fs.existsSync(path.join(__dirname, "..", "src", "s2", "data", "s2_league.json")));

console.log(`\n${n - fail}/${n} passed`);
if (fail) process.exit(1);
