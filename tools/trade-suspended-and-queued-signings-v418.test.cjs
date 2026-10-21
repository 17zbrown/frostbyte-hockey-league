/* v4.18 (2026-10-18). Two changes.
   1. Commissioner, 2026-10-18: "Allow teams to be able to trade and trade for suspended players." The database never
      refused it: block_suspended_roster fires on INSERT only, guard_squad_move watches the squad column only (a trade
      moves team_id), _place_trade_arrivals writes as the league (trusted), and block_suspended_actor stops a suspended
      MANAGER, not a suspended player. Rehearsed on production 2026-10-18, rolled back: the Islanders proposed Tager x 72
      (suspended) to Detroit, Detroit accepted, and he landed on Detroit's active roster. What read as a bar was Rule
      7.2's "locked in place on their club's roster". So: the rule says a suspended player may be traded and the
      suspension travels; the Trade Hub marks one; this test keeps any suspension filter out of the trade builder.
   2. A queued signing failed with "Unknown move: sign_free_agent" (_mgmt_describe had no case for it). Fixed with one
      definition each for the signing salary and the open replacement allowance (sql/2026-10-18-queued-signings-v418.sql).
   Run: node tools/trade-suspended-and-queued-signings-v418.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const strip = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

console.log("\n1. Queued signings");
const sql = R("sql/2026-10-18-queued-signings-v418.sql"), body = strip(sql);
A("one definition of the signing salary, moved from sign_free_agent unchanged (basic: the player's own salary, floored; full: the club's figure)", /create or replace function public\._fa_signing_salary\(p_season uuid, p_profile uuid, p_salary bigint\) returns bigint/.test(body) && /return greatest\(coalesce\(v_prior, 750000\), 750000\);/.test(body) && /return greatest\(coalesce\(p_salary, 750000\), 750000\);/.test(body) && /from public\.roster_spot_removals rsr/.test(body));
A("one definition of the open replacement allowance (the v4.16b/v4.17 test)", /create or replace function public\._open_replacement_signing\(p_season uuid, p_team uuid\) returns uuid/.test(body) && /and \(s\.moves_lock_override = 'locked' or x\.created_at >= public\.fa_moves_close_at\(p_season\)\)/.test(body));
A("...neither callable by an API role", /revoke all on function public\._fa_signing_salary\(uuid, uuid, bigint\) from public, anon, authenticated;/.test(body) && /revoke all on function public\._open_replacement_signing\(uuid, uuid\) from public, anon, authenticated;/.test(body));
A("every patch is anchored and asserted to match exactly once", /if v_n <> 1 then raise exception 'patch % \(%\): anchor found % times'/.test(body));
A("sign_free_agent reads both helpers, and re-checks used_at under the row lock (no double spend)", /where rsg\.id = public\._open_replacement_signing\(v_season\.id, v_team\.id\) and rsg\.used_at is null;/.test(body) && /v_salary := public\._fa_signing_salary\(v_season\.id, v_reg\.profile_id, p_salary\);/.test(body));
A("_mgmt_describe has the sign_free_agent case: the player from the registration, the salary from the helper", /when 'sign_free_agent' then[\s\S]*?select r\.profile_id into v_prof from public\.season_registrations r[\s\S]*?v_sal := public\._fa_signing_salary\(v_season, v_prof, \(a->>'p_salary'\)::bigint\);[\s\S]*?o_target := 'sign:' \|\| v_prof;\n  when 'respond_offer', 'respond_extension' then/.test(body));
A("...and past the free-agent close a club without an allowance is told when it asks", /if public\.fa_moves_closed\(v_season\) and public\._open_replacement_signing\(v_season, p_team\) is null then/.test(body) && /', using the club''s replacement signing \(Rule 2\.4\)'/.test(body));
A("the queue intake itself does not refuse sign_free_agent (a replacement stays queueable)", !/p_action in \([^)]*'sign_free_agent'/.test(body));
A("self-checks: no inline salary or allowance rule left, the case exists, helpers private", /self-check: sign_free_agent still carries its own salary or allowance rule/.test(body) && /self-check: _mgmt_describe has no sign_free_agent case/.test(body) && /self-check: a helper is callable by an API role/.test(body));
A("the rolled-back rehearsal is recorded", /salary helper vs the old inline rule, every registrant of both seasons: 0 mismatches/.test(sql) && /"sign AC at \$2M to the end of the season, using the club's replacement signing \(Rule 2\.4\)"/.test(sql) && /Dallas Owner approves: approved, AC on Dallas at 2000000, the allowance spent/.test(sql));
A("nothing posts to Discord", !/discord_http_post|notify_discord|_announce_once|club_notify\(/.test(body));
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js");
A("the site queues the signing with the registration (the move the database now describes)", /CG\.mgmtQueue\("sign_free_agent", \{ p_registration:regId, p_salary:null \}/.test(live));

console.log("\n2. Suspended players can be traded");
A("the trade builder's roster has no suspension filter", /CG\.tRoster = function\(code\)\{ return \(CG\.lg\.byTeam\[code\]\|\|\[\]\)\.filter\(function\(p\)\{ return !p\.mgmt && p\.origin!=="preseason_random"; \}\); \};/.test(live));
A("the Roster tab's Trade button is not gated on a suspension", /\(\(CG\.movesClosedForMe && CG\.movesClosedForMe\(\)\) \? '<button class="btn btn-ghost btn-sm" disabled title="'\+esc\(CG\.MOVES_CLOSED\)\+'">Trade<\/button>'\n\s+: '<button class="btn btn-ghost btn-sm" data-trade="'\+p\.id\+'">Trade<\/button>'\)/.test(hub));
A("the Trade Hub marks a suspended player in the picker and on the offer rows", /CG\.tradeSuspChip = function\(pid\)\{/.test(live) && /\+CG\.tradeSuspChip\(p\.id\)\+'<span class="caption" style="display:block">'\+p\.pos/.test(live) && /\(p\?CG\.tradeSuspChip\(pid\):''\)/.test(live));
/* v4.25 (commissioner, 2026-10-21): the squad lock is lifted and the waiver barred; the trade half of v4.18 stands */
A("the suspension tooltip says they may be traded and the suspension goes with them", /The club may still call them up, send them down or trade them, and the suspension goes with them, but may not waive them \(Rule 7\.2\)/.test(hub) && !/He is locked where he is/.test(hub));
{
  /* run the chip for real */
  const src = live.match(/CG\.tradeSuspChip = function\(pid\)\{[\s\S]*?\n\};/)[0];
  /* v4.25: the chip reads CG.playSuspensionOf (playing scope only), the twin of public.is_suspended */
  const C = { playSuspensionOf: (id) => (id === "s" ? { mode: "games", games: 3, gamesServed: 1 } : null), suspensionText: () => "Suspended, 1 of 3 games served." };
  new Function("CG", "esc", src)(C, (x) => String(x));
  A("the chip shows for a suspended player and nothing for anyone else", /Suspended<\/span>/.test(C.tradeSuspChip("s")) && C.tradeSuspChip("x") === "");
}
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = (id) => [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === id) || { paragraphs: [] };
const r72 = sec("7.2").paragraphs.join(" "), r21 = sec("2.1").paragraphs.join(" ");
A("Rule 7.2: a suspended player may be traded, and the suspension travels", /may trade the player under Rule 2\.3, like any other player, and any club may trade for a suspended player\./.test(r72) && /The suspension goes with the player, who joins the new club by the placement rule of Rule 2\.1 and serves the rest of the suspension on that club's games\./.test(r72) && !/locked in place/.test(r72));
A("Rule 2.1: moved and traded like any other player, never waived (v4.25)", /A suspended player may be called up, sent down and traded like any other player, but may not be waived until their suspension is served \(Rule 7\.2\)\./.test(r21));
const e = rb.changelog.find((c) => c.version === "4.18") || {};
A("the changelog has its 4.18 entry, right before 4.17", e.version === "4.18" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.17");
A("...naming both changes, with no em dash or gendered pronoun", /trade a suspended player/.test(e.summary || "") && (e.items || []).some((i) => /ask to sign a player/.test(i)) && !/[—–]/.test(JSON.stringify(e)) && !/\b(he|his|him|she|her)\b/i.test(JSON.stringify(e)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
