/* v3.90: one game-night post instead of one per story. Commissioner, 2026-10-08: "Make sure you combine the best stories
   of the night into one post instead of sending one out for each game. It turns into a spam channel in its current
   format." Oct 7 sent 14 'Player Spotlight' posts to the news channel, and its recap waited until 10:47 the next
   morning behind a held game, cut to 280 characters.
   Rehearsed against production in a rolled-back transaction, with the Discord sender swapped for a capture table: Oct 7
   became ONE post of 1,316 characters (the eight best players, Lokharov14 once with "3 standout games tonight", six
   more pointed to on the site, twelve results, three stars), a second call posted nothing, a spotlight article posted
   nothing, other news still posted, and the sweep did not post an old night. This pins that record and the site. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-08-night-recap-v390.sql"), live = R("src/live/part_live.js");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 240))); } };

console.log("— one post per night");
A("a spotlight article no longer posts on its own; the recap's own article is quiet too", /if new\.category = 'Player Spotlight' or coalesce\(current_setting\('app\.news_quiet', true\), ''\) = 'on' then return new; end if;/.test(sql));
A("...every other article (staff news, awards, playoff series results) still posts", /perform public\.notify_discord\('discord_news_webhook',\s+format\(E'📰 \*\*%s\*\* · %s\\n%s'/.test(sql));
A("one per night: night_recaps (primary key season, night) is claimed first, and a second call posts nothing",
  /insert into public\.night_recaps \(season_id, night_date\) values \(p_season, p_night\) on conflict do nothing;\s+if not found then return false; end if;/.test(sql));
A("the post goes to the news channel in full, with no pings", /perform public\.notify_discord\('discord_news_webhook', v_post, false\);/.test(sql) && !/left\(v_post/.test(sql));
A("the article is quiet while it is written, then the post goes out", /perform set_config\('app\.news_quiet', 'on', true\);[\s\S]{0,300}insert into public\.news[\s\S]{0,200}perform set_config\('app\.news_quiet', '', true\);/.test(sql));

console.log("— the best of the night");
A("the four milestones the spotlights mark: shutout, four goals, hat trick, five points", /stopped all ' \|\| y\.shots_against/.test(sql) && /y\.goals >= 4/.test(sql) && /y\.goals = 3/.test(sql) && /y\.goals < 3 and y\.pts >= 5/.test(sql));
A("ranked: shutout 50+, four goals 40+, hat trick 30+, five points 20+, then goals and assists", /\(50 \+ coalesce\(y\.shots_against, 0\) \* 0\.5\)/.test(sql) && /\(40 \+ y\.goals \* 6 \+ y\.assists \* 3\)/.test(sql) && /\(30 \+ y\.goals \* 6 \+ y\.assists \* 3\)/.test(sql) && /\(20 \+ y\.goals \* 6 \+ y\.assists \* 3\)/.test(sql));
A("one line per player: the biggest game, with the count of standout games", /group by st\.pname order by rank desc/.test(sql) && /' standout games tonight\)'/.test(sql));
A("the top eight that fit in one Discord message; the rest are pointed to on the site", /if i <= 8 and length\(v_best\) \+ length\(r\.line\) \+ 1 <= v_room then/.test(sql) && /…and %s more on the site: https:\/\/chelgamingleague\.com\/#\/news/.test(sql) && /v_room := 1780 - length\(v_head\) - length\(v_tail\);/.test(sql));
A("...and the article on the site carries every story", /if v_more > 0 then   -- the article carries every story/.test(sql));
A("results for every game, an undecided one listed as such, and the three stars", /• %s at %s: not decided yet/.test(sql) && /\*\*Three stars of the night\*\*/.test(sql));
A("an 8–7 win, not a 8–7 win", /in \(8, 11, 18\) or coalesce\(x\.ts, 0\) between 80 and 89 then 'an '/.test(sql));

console.log("— when it goes out");
A("when the night's last game is final (a voided game is not waited for)", /if cnt=0 then perform public\.post_night_recap\(new\.season_id, v_night\); end if;/.test(sql) && /and not coalesce\(g\.voided,false\);/.test(sql));
A("...or four hours after the night's last puck drop, from the sweep every 15 minutes", /or max\(g\.scheduled_at\) < now\(\) - interval '4 hours'\)/.test(sql) && /select cron\.schedule\('night-recap', '\*\/15 \* \* \* \*', 'select public\.night_recap_sweep\(\)'\);/.test(sql));
A("the sweep never posts a night from before this change", /if r\.night < date '2026-10-08' then continue; end if;/.test(sql));
A("the helpers cannot be called through the API; the sweep's Run now is a commissioner's",
  /revoke execute on function public\._night_stories\(uuid, date\) from public, anon, authenticated;/.test(sql) && /revoke execute on function public\.post_night_recap\(uuid, date\) from public, anon, authenticated;/.test(sql)
  && /raise exception 'Only a commissioner can run the game night recap\.';/.test(sql) && /grant execute on function public\.night_recap_sweep\(\) to authenticated;/.test(sql));
A("the Control Center lists it with the other database jobs (heartbeat rl_night-recap, Run now)", /\{ key:"night-recap", staleAfterMin:45,[^}]*rpc:"night_recap_sweep" \}/.test(live) && /'rl_night-recap'/.test(sql));
A("the game-final trigger is patched by anchors, asserted unique", /v3\.90 patch: the recap block anchors were not found/.test(sql) && /v3\.90 patch: the recap block is not unique/.test(sql));

console.log("— the changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const cl = CG.CONTENT.rulebook.changelog.find((c) => c.version === "3.90");
A("changelog 3.90 says what changed", !!cl && /single post instead of one per story/.test(cl.summary) && cl.items.some((i) => /four hours after the night's last puck drop/.test(i)));
A("no em dash in what v3.90 added", !/—/.test(JSON.stringify(cl)) && !/—/.test(sql.slice(sql.indexOf("create or replace function public._night_stories"))));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
