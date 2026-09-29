/* v3.74: a rating for each position a player plays; the headline overall is the one at the position he signed
   up at; the profile's Position picker swaps the overall in place; the hold is six games at a position.
   The database half was rehearsed in Postgres (recorded at the foot of the SQL file). */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-29-position-ratings-v374.sql"), pub = R("src/live/part5a_public.js"), live = R("src/live/part_live.js");

/* ---- SQL ---- */
A("rates are drawn from the games AT one group", /create or replace function public\.cghl_rates\(p_profile uuid, p_grp text\)/.test(sql) &&
  /when 'W' then not gs\.is_goalie and public\.pos_group\(gs\.position\) = 'F' and gs\.position <> 'C'/.test(sql));
A("...and each group is weighted as itself, never blended", /case p_grp when 'G' then w\.w_g when 'W' then w\.w_w when 'C' then w\.w_c else w\.w_d end eff/.test(sql));
A("...and held by the games at that group", /gp := coalesce\(\(public\.cghl_rates\(p_profile, p_grp\)->>'gp'\)::numeric, 0\);\s+if gp <= 0 then return null; end if;\s+conf := public\.cghl_confidence\(gp\);/.test(sql));
A("six games: the settle count and the slope beneath it", /as \$fn\$ select 6 \$fn\$;/.test(sql) && /then \(0\.6 \/ public\.cghl_settle_gp\(\)\) \* p_gp/.test(sql));
A("the headline is the signed-up group: current sign-up, latest sign-up, roster, most played",
  /sr\.season_id = public\.current_season_id\(\) and sr\.status <> 'declined'/.test(sql) && /order by s\.number desc limit 1;[\s\S]{0,400}from public\.roster_spots rs/.test(sql) && /order by x\.n desc, x\.g limit 1;/.test(sql));
A("the breakdown honors the group asked for and says whether it is the headline", /g := case when p_cat in \('C','W','D','G'\) then p_cat else v_head end;/.test(sql) && /'headline', g = v_head/.test(sql));
A("player_rating(p, group) for the picker, readable by the public", /create or replace function public\.player_rating\(p_profile uuid, p_cat text\)/.test(sql) && /grant execute on function public\.player_rating\(uuid, text\) to anon, authenticated;/.test(sql));
A("a row per rated group and one headline, the old headline cleared first",
  /update public\.player_position_overalls set headline = false\s+where profile_id = p_profile and headline and pos_cat <> v_head;/.test(sql) &&
  /create unique index if not exists ppo_one_headline on public\.player_position_overalls \(profile_id\) where headline;/.test(sql));
A("...stale groups are removed", /delete from public\.player_position_overalls where profile_id = p_profile and not \(pos_cat = any\(v_groups\)\);/.test(sql));
A("the engine flag is enough to write an overall (the second revert honors it)", /then new\.overall      := old\.overall;      end if;',\s+'  if new\.overall      is distinct from old\.overall and coalesce\(current_setting\(''app\.ovr_engine'', true\), ''''\) <> ''on''/.test(sql));
A("the norms are built per group and never wiped by an empty league", /select l\.id, l\.grp, public\.cghl_rates\(l\.id, l\.grp\) r/.test(sql) && /return jsonb_build_object\('skipped', 'no league games', 'players', 0\);/.test(sql));
A("a changed sign-up re-rates the player, never refusing the sign-up", /create trigger trg_registration_overall after insert or update of position, status on public\.season_registrations/.test(sql) && /exception when others then\s+raise warning 'rating refresh after a sign-up change failed/.test(sql));
A("the rehearsal is recorded, both catches included", /guard_profile_role's\s+older second revert/.test(sql) && /moved his headline W 72 to C 70/.test(sql));

/* ---- client ---- */
A("the boot loads the per-position ratings into its named slot", /CG\.BOOT_PPO = 17; CG\.BOOT_CAREER = 18; CG\.BOOT_CODES = 19;/.test(live) && /var posOvr = CG\._posOvrMap\(q\[CG\.BOOT_PPO\]\);/.test(live));
A("...a games delta re-reads them", /var ppo = await CG\._posOvrLoad\(\);\s+if \(!ppo\.error\) q\[CG\.BOOT_PPO\] = ppo;/.test(live));
A("...and a player's overall is the headline row when it is there", /\? posOvr\[p\.id\]\[posOvr\[p\.id\]\.head\]\.ovr : \(p\.overall \|\| 70\)/.test(live));
A("the picker offers the signed-up position even before he plays it", /\|\| g\[0\] === posHead;/.test(pub) && /' · signed up'/.test(pub) && /data-head="'\+esc\(posHead\)\+'"/.test(pub));
A("choosing a position swaps the hero overall and the breakdown in place", /ho\.innerHTML = CG\.heroOvrInner\(id, grp, /.test(pub) && /CG\.paintRatingBreak\(id, grp\);/.test(pub));
A("...and a late answer never paints over the position chosen", /if \(cur !== \(grp \|\| ""\)\) return;/.test(pub) && /if \(pk && pk\.value !== "all" && pk\.value !== \(pk\.getAttribute\("data-head"\) \|\| ""\)\) return;/.test(pub));
{
  const ctx = { console, Math, Object, String, Number, JSON, CG: {} }; ctx.esc = (v) => String(v == null ? "" : v);
  vm.createContext(ctx);
  vm.runInContext(pub.match(/CG\.OVR_SETTLE_GP = \d+;/)[0], ctx);
  vm.runInContext(pub.match(/CG\.POS_VIEW_NAME = [^\n]+/)[0], ctx);
  for (const fn of ["ovrProgress", "ovrNote", "heroOvrInner"]) vm.runInContext(pub.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n *\\};"))[0], ctx);
  ctx.CG.lg = { posOvr: { p: { head: "W", W: { ovr: 72, gp: 2 }, C: { ovr: 75, gp: 7 } } } };
  const head = ctx.CG.heroOvrInner("p", null, 70), cen = ctx.CG.heroOvrInner("p", "C", 70), all = ctx.CG.heroOvrInner("p", "all", 70);
  A("hero: the headline shows the signed-up rating, provisional at 2 of 6", />72</.test(head) && />Overall</.test(head) && /2 of 6 games at wing/.test(head));
  A("hero: choosing center shows 75 as the center overall, settled", />75</.test(cen) && />Center overall</.test(cen) && !/Provisional/.test(cen));
  A("hero: All positions is the headline", all === head);
  ctx.CG.lg = null;
  A("hero: no per-position data falls back to the number given", />68</.test(ctx.CG.heroOvrInner("p", null, 68)));
}

/* ---- rulebook ---- */
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const p61 = secs["6.1"].paragraphs[1], e = rb.changelog.find((c) => c.version === "3.74");
A("6.1.2: rated separately at each position, from the games there", /A player is rated separately at each position he plays, center, wing, defense and goal, and each rating is drawn only from the games he played there/.test(p61));
A("...held until the sixth game at that position", /held toward the middle until a player's sixth league game at that position/.test(p61));
A("...the overall is the signed-up position's; the profile shows the others", /The rating shown as a player's overall throughout the site is the one at the position he declared when he signed up/.test(p61));
A("...and these are not the roster groups of Rule 2.1", /These rating positions are not the position groups of Rule 2\.1/.test(p61));
A("changelog records 3.74", !!e && e.dateIso === "2026-09-29");
A("no em dashes or spaced hyphens in the 3.74 entry", !/—| - /.test(JSON.stringify(e)));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
