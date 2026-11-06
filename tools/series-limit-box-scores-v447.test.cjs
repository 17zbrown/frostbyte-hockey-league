/* v4.47: the playoff series limit counts box scores only, and a player who reaches it comes off the club's remaining
   sheets with a site notice to management. Commissioner, 2026-11-06: "only base scheduling off box scores", and "You
   should also only count box scores as games played in the regular season as well." */
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let fails = 0, passed = 0;
const A = (name, cond) => { if (cond) passed++; else { fails++; console.log("FAIL: " + name); } };

const sql = read("sql/2026-11-06-series-limit-box-scores-v447.sql");
const live = read("src/live/part_live.js"), hub = read("src/live/part6_hub.js"), pub2 = read("src/live/part5b_public2.js");

console.log("the database record");
A("the record quotes both rulings", /only base scheduling off box scores/.test(sql) && /only count box scores as games played in the regular season/.test(sql));
A("the rehearsal is recorded", /Result: REHEARSAL OK: T1 T2 T3 T4 T5/.test(sql));
A("the filed-sheet block is the anchor replaced in set_game_lineup", /is already dressed in % games of this series/.test(sql) && /did not match exactly once/.test(sql));
A("the refusal names the rule by stage", /case when v_game\.stage = 'playoff' then '8\.3' else '5\.2' end/.test(sql));
const sweep = sql.slice(sql.indexOf("function public._series_limit_sweep"), sql.indexOf("function public._series_limit_safe"));
A("the sweep counts with player_week_games, the box-score count", /public\.player_week_games\(p_season, 'playoff', p_week, v_pid, null\)/.test(sweep));
A("the sweep reads no filed sheet as a game played", !/count\(\*\)/.test(sweep));
A("the sweep only touches games with no box score yet", /g\.status = 'scheduled' and g\.ea_match_id is null/.test(sweep));
A("a league-office exception keeps the player on", /not public\.has_cap_exception\(s\.game_id, v_pid\)/.test(sweep));
A("management is told on the site and nothing goes to the club room", /public\.club_notify\(s\.team_id, 'lineups', 'Series limit reached: your lineup changed'[\s\S]*?null, 'lineup', s\.game_id::text, null, false\)/.test(sweep));
A("the player is told", /public\._notify_lineup_pulled\(s\.game_id, s\.team_id, array\[v_pid\]/.test(sweep));
A("there is an audit row", /log_admin_action\('series_limit_pull'/.test(sweep));
A("a sweep takes set_game_lineup's own lock", /hashtext\('lineup:' \|\| p_season \|\| ':playoff:' \|\| p_week \|\| ':' \|\| v_team\)/.test(sweep));
A("a failed sweep never blocks a final and is told", /exception when others then[\s\S]*notify_commissioners\(null, 'flag', 'The playoff series limit check failed'/.test(sql));
A("the three triggers exist, on games and on game_stats", /create trigger trg_series_limit_games after update of status, ea_match_id on public\.games/.test(sql) && /create trigger trg_series_limit_stats_ins after insert on public\.game_stats/.test(sql) && /create trigger trg_series_limit_stats_upd after update on public\.game_stats/.test(sql));
A("the games trigger sorts after the one that ends a series", "trg_series_limit_games" > "trg_playoff_series");
A("members cannot run any of it", ["_series_limit_sweep(uuid, integer)", "_series_limit_safe(uuid, integer)", "trg_series_limit_games()", "trg_series_limit_stats()"].every((f) => sql.includes("revoke all on function public." + f + " from public, anon, authenticated")));
A("no Discord door in the record", !/discord_http_post|notify_discord|club_notices/.test(sweep));

console.log("the site");
A("the notice opens that game's builder", /case "lineup":\s+return p \? "#\/hub\/lineup\?game="\+encodeURIComponent\(p\)/.test(live));
A("the audit line has words", /series_limit_pull:"Taken off a lineup at the series limit"/.test(live));
A("the per-game refusal no longer says filed", !/played or filed/.test(hub));
A("Dress the week starts from games played alone", /used\[pid\] = wkRefD \? CG\.weekLedger\(pid, wkRefD, club, \{ excludeGame: "__none__" \}\)\.filter\(function\(r\)\{\s*return r\.verdict === "played";/.test(hub));
A("...and a filed sheet is in no count there", !/r\.verdict === "filed"/.test(hub) && !/drops\[pid\]/.test(hub));
A("the box score flag reads the series cap", /var cap = CG\.seriesCap\(\{ pos: isGoalie \? "G" : "C" \}\)/.test(pub2));

console.log("the ledger counts only a game in the box score, at every stage");
const m = live.match(/CG\.WEEK_VERDICT = \{[\s\S]*?\n\};/);
const sb = { CG: {} }; vm.runInNewContext(m[0], sb);
const counting = Object.keys(sb.CG.WEEK_VERDICT).filter((k) => sb.CG.WEEK_VERDICT[k].counts);
A("only played counts", counting.length === 1 && counting[0] === "played");

console.log("the rulebook");
const ctx = { CG: {}, window: {}, console }; vm.runInNewContext(read("src/live/part3_content.js"), ctx);
const rb = ctx.CG.CONTENT.rulebook;
const para = rb.chapters.flatMap((c) => c.sections || []).flatMap((s) => s.paragraphs || []);
const r83 = para.find((p) => /A playoff appearance cap applies in place of the weekly cap/.test(p)) || "";
A("Rule 8.3 caps games played", /may play in more than four \(4\) games of a single series/.test(r83));
A("Rule 8.3 reads the box scores and not a filed lineup", /read from the box scores/.test(r83) && /a lineup filed for a game still to be played does not count/.test(r83));
A("Rule 8.3 states the removal and the notice", /removed automatically from every lineup filed for the remaining games of that series/.test(r83) && /Owner, General Manager and Assistant General Manager are notified on the site/.test(r83));
A("the stale wording is gone", !para.some((p) => /may be dressed in more than four \(4\) games/.test(p)));
const r52 = para.find((p) => /weekly appearance cap in the regular season/.test(p)) || "";
A("Rule 5.2 already counts box scores in the regular season", /a game counts once its box score is on file with the player in it/.test(r52) && /A lineup filed for a game still to be played does/.test(r52));
const entry = rb.changelog.find((c) => c.version === "4.47");
A("the changelog entry is there", !!entry && entry.items.length >= 3 && /box score/i.test(entry.summary));

console.log(fails ? fails + " FAILED" : "ALL " + passed + " PASSED");
if (fails) process.exit(1);
