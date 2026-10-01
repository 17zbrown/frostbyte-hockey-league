/* v3.78: a player chooses his own jersey number in his league profile (Rule 2.1). Commissioner, 2026-10-01: "add a
   spot in the players' league profile to choose and edit their jersey number." The database half was rehearsed in
   Postgres (recorded at the foot of the SQL file). */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-10-01-player-jersey-number-v378.sql"), rev = R("sql/2026-10-01-jersey-number-review-v378.sql"), live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), audit = R("tools/sql/grant-audit.sql");

console.log("— the database");
A("his door saves the choice and, on his club, the spot", /create or replace function public\.set_my_jersey_number\(p_number integer\) returns jsonb/.test(sql)
  && /update public\.roster_spots set jersey_number = p_number where id = v_spot\.id;/.test(sql) && /update public\.profiles set jersey_number = p_number where id = v_uid;/.test(sql));
A("...a clash with ANY teammate is refused by name (the unique key spans every spot)", /'#% is already worn by % on your club\. Pick another number\.'/.test(sql)
  && !/set_my_jersey_number[\s\S]*?coalesce\(rs\.status[\s\S]*?end \$f\$;/.test(sql.slice(sql.indexOf("create or replace function public.set_my_jersey_number"))));
A("...1 to 99, signed in, authenticated only", /p_number < 1 or p_number > 99/.test(sql) && /if v_uid is null then raise exception 'You must be signed in\.'/.test(sql)
  && /revoke all on function public\.set_my_jersey_number\(integer\) from public, anon;/.test(sql) && /grant execute on function public\.set_my_jersey_number\(integer\) to authenticated;/.test(sql));
A("the choice follows him: one trigger on every way onto a club, and on a change of club", /create trigger jersey_preference_ins_trg before insert on public\.roster_spots/.test(sql)
  && /create trigger jersey_preference_move_trg before update of team_id on public\.roster_spots\s+for each row when \(old\.team_id is distinct from new\.team_id\)/.test(sql));
A("...it only takes a number nobody else on that club wears", /rs\.jersey_number = v_pref and rs\.profile_id <> new\.profile_id\) then\s+new\.jersey_number := v_pref;/.test(sql));
A("...and is no API role's to call", /revoke all on function public\.apply_jersey_preference\(\) from public, anon, authenticated;/.test(sql));
A("the notices quote the number he actually wears", /returning jersey_number into v_jersey;\$b\$\),\s+\('respond_offer'/.test(sql) && /returning jersey_number into v_j;\$b\$/.test(sql)
  && (sql.match(/returning jersey_number into v_jersey;/g) || []).length === 2);
A("management's door names a clash with any spot too", /\('set_jersey_number', \$a\$and coalesce\(rs\.status,'active'\) = 'active' and rs\.jersey_number = p_number\$a\$,\s+\$b\$and rs\.jersey_number = p_number\$b\$\)/.test(sql));
A("every patch must find its text exactly once, or nothing is applied", /the text to patch is not there exactly once/.test(sql));
A("rehearsed and applied", /REHEARSAL OK: S1 S2 S3 S4 S5 S6 S7 S8 S9 S10 S11/.test(sql) && /APPLIED 2026-10-01 as migration v378_player_jersey_number/.test(sql));
A("the grant audit watches the door's grant", /'can_see_match','set_my_jersey_number'\]/.test(audit));

A("review: the trigger guarantees a valid number (choice, else the offered number if free, else the lowest free)", /if new\.jersey_number between 1 and 99\s+and not exists[\s\S]*?then\s+return new;\s+end if;\s+select min\(n\) into v_free/.test(rev));
A("review: a swap settles once everyone has moved, in both trade paths", /create or replace function public\._settle_jersey_choices\(p_season uuid, p_profiles uuid\[\]\)/.test(rev)
  && (rev.match(/perform public\._settle_jersey_choices\(t\.season_id, coalesce\(t\.offered_profile_ids/g) || []).length === 2 && /\('accept_trade',/.test(rev) && /\('reverse_trade',/.test(rev));
A("review: the settle is internal", /revoke all on function public\._settle_jersey_choices\(uuid, uuid\[\]\) from public, anon, authenticated;/.test(rev));
A("review: the door names the wearer even when it loses a race", /exception when unique_violation then[\s\S]*?'#% was just taken by % on your club\. Pick another number\.'/.test(rev));
A("review: the draft and contract inserts no longer swallow a number clash", (rev.match(/on conflict \(season_id, profile_id\) do nothing;\$b\$/g) || []).length === 3 && /\('draft_make_pick'/.test(rev) && /\('use_draft_pick'/.test(rev) && /\('_activate_contract_spot'/.test(rev));
A("review: rehearsed and applied", /REHEARSAL OK: R1 R2 R3 R4 R5 R6/.test(rev) && /APPLIED 2026-10-01 as migration v378_jersey_number_review/.test(rev));

console.log("— the League profile card");
A("a Jersey number field on the League profile card", /<label class="fld"><span>Jersey number<\/span><input id="sJerseyLive" type="number" min="1" max="99" step="1" inputmode="numeric"/.test(live)
  && live.indexOf('id="sJerseyLive"') > live.indexOf("<h3>League profile</h3>") && live.indexOf('id="sJerseyLive"') < live.indexOf('id="sSaveLive">Save profile'));
A("saved through the door, never written to profiles directly by the member", /CG\.sb\.rpc\("set_my_jersey_number", \{ p_number: n \}\)/.test(live) && /CG\.saveMyJersey\(jNum\)/.test(live) && !/from\("profiles"\)\.update\(\{ ea_id[^}]*jersey_number/.test(live));
A("a whole number 1 to 99, or empty to clear the choice", /jNum = jRaw==="" \? null : parseInt\(jRaw,10\);/.test(live) && /if \(jNum!==null && \(jNum<1 \|\| jNum>99\)\)/.test(live));
A("sent only when he changed the field: a save of anything else never touches his number", /jSend = jRaw !== String\(jEl\.dataset\.was\|\|""\);/.test(live) && /data-was="'\+v\+'"/.test(live));
A("a typed '7a' is refused, never read as 'clear my number'", /if \(\(jEl\.validity && jEl\.validity\.badInput\) \|\| \(jRaw!=="" && !\/\^\\d\{1,2\}\$\/\.test\(jRaw\)\)\)/.test(live));
A("the field shows the number he wears (his choice when he has no club)", /var j = CG\.myJersey\(\), v = j\.wearing \|\| j\.chosen \|\| "";/.test(live));
A("a saved choice he does not wear gets its own Wear button (a link, so the label keeps one control)", /<a href="#" role="button" class="btn btn-ghost btn-sm" id="sJerseyWear" data-n="'\+j\.chosen\+'"/.test(live) && /e\.target\.closest\("#sJerseyWear"\)/.test(live) && /CG\.saveMyJersey\(parseInt\(b\.dataset\.n,10\)\)/.test(live));
A("each half reports its own failure; success only when both land", /Promise\.all\(\[saveProfile, saveJersey\]\)/.test(live) && /"Profile saved, but your number did not change: "\+jErr/.test(live));
A("the toast and the page are built from the database's answer, not the snapshot", /d\.wearing!=null \? "Profile saved\. You wear #"\+d\.wearing\+" for the "\+\(jr\.club\|\|"club"\)/.test(live) && /rs\.team_id === d\.team_id/.test(live) && /else if \(CG\.reloadLeague\) CG\.reloadLeague\(\);/.test(live));
A("after any write the field and hint are redrawn in place from what the database holds (no page reset)", /CG\.paintMyJersey\(\);   \/\* in place/.test(live) && /if \(el\)\{ el\.value = v; el\.dataset\.was = String\(v\); \}/.test(live));
A("...and the loaded roster learns the new number (table, cards, crest)", /if \(spot\) spot\.jersey_number = \+d\.wearing;/.test(live) && /if \(lp\.id === uid\) lp\.jersey = \+d\.wearing;/.test(live));
A("the office's Assign button quotes the number the database stored", /\.insert\(\{ season_id:s\.id, team_id:teamId, profile_id:profileId, jersey_number:num, position:position, salary:0 \}\)\.select\("jersey_number"\);/.test(live) && /num = r1\.data\[0\]\.jersey_number;/.test(live) && !/with the next open jersey number and logs/.test(live));
A("the office's editor labels the profile number as the player's choice and sends it only when edited", /fld\("Chosen jersey number","ueJer"/.test(live) && /if \(jerChanged\) payload\.jersey_number = jerRaw === "" \? null : \+jerRaw;/.test(live) && !/jersey_number:isNaN\(jer\)/.test(live));
A("a Team HQ renumber reaches the player's own card", /rs\.profile_id === pid && rs\.team_id === tid && \(!sid \|\| rs\.season_id === sid\)\) rs\.jersey_number = n;/.test(hub));

const grab = (name) => { const i = live.indexOf("CG." + name + " = function"); const j = live.indexOf("\n};\n", i); return live.slice(i, j + 3); };
const box = { CG: { TEAM: { BOS: { name: "Bruins" } } }, esc: (s) => String(s).replace(/[<>&"']/g, "") };
vm.createContext(box); vm.runInContext(grab("myJersey") + "\n" + grab("jerseyHint"), box);
const set = (prof, spot) => { box.CG.auth = { user: { id: "u1" }, profile: prof }; box.CG.SEASON = { id: "s1" }; box.CG.lg = { _rosterRaw: spot ? [spot] : [], _idToCode: { t1: "BOS" } }; };
set({ jersey_number: null }, null);
let j = box.CG.myJersey();
A("no club: no number worn, and the hint says it is his when he joins one", j.wearing === null && j.chosen === null && /When you join a club you wear it there if nobody else does; if somebody does, you get a free number/.test(box.CG.jerseyHint()), JSON.stringify(j));
set({ jersey_number: 12 }, { profile_id: "u1", season_id: "s1", team_id: "t1", jersey_number: 12 });
j = box.CG.myJersey();
A("on a club wearing his choice: the hint names the number and the club", j.wearing === 12 && j.club === "Bruins" && /You wear <b>#12<\/b> for the Bruins\. Enter another number and save/.test(box.CG.jerseyHint()), box.CG.jerseyHint());
set({ jersey_number: 7 }, { profile_id: "u1", season_id: "s1", team_id: "t1", jersey_number: 16 });
A("choice free on his club but not worn: the card says both and offers Wear #7", /You wear <b>#16<\/b> for the Bruins, and your saved choice is <b>#7<\/b>, which is free there\./.test(box.CG.jerseyHint()) && /id="sJerseyWear" data-n="7"/.test(box.CG.jerseyHint()), box.CG.jerseyHint());
set({ jersey_number: 7 }, { profile_id: "u1", season_id: "s1", team_id: "t1", jersey_number: 16 }); box.CG.lg._rosterRaw.push({ profile_id: "u2", season_id: "s1", team_id: "t1", jersey_number: 7 }); box.CG.lg._profName = { u2: "Teammate" };
A("choice worn by a teammate: the card names him and offers no button", /Your saved choice, #7, is worn there by Teammate, so it stays your choice for your next club/.test(box.CG.jerseyHint()) && !/sJerseyWear/.test(box.CG.jerseyHint()), box.CG.jerseyHint());
set({ jersey_number: 7 }, { profile_id: "u1", season_id: "old", team_id: "t1", jersey_number: 16 });
A("last season's spot is not this season's", box.CG.myJersey().wearing === null);

console.log("— the book");
const C = (() => { const t = R("src/live/part3_content.js"); return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); })();
let s21 = null; C.rulebook.chapters.forEach((ch) => (ch.sections || []).forEach((s) => { if (s.id === "2.1") s21 = s; }));
const rule = (arr) => (arr || []).some((p) => /A player chooses his own number in his league profile, and the number he chooses is his/.test(p) && /no two players on a club's roster, active or training camp, wear the same one/.test(p) && /that changes the number a player wears for the club, not the number he has chosen/.test(p)
  && /on a trade the number he was wearing, on a contract rollover the number he wore the season before, and on a reinstatement the number he wore when he was removed/.test(p)
  && /In a trade the numbers are settled once every player in it has moved/.test(p) && /other than a player on a pre-season loan or one placed on the club as depth under Rule 2\.8/.test(p));
A("Rule 2.1 states it, in both formats", rule(s21.paragraphs) && rule(s21.full));
const findCl = (o) => { if (o && typeof o === "object") { if (Array.isArray(o.changelog)) return o.changelog; for (const v of Object.values(o)) { const r = findCl(v); if (r) return r; } } return null; };
const e = (findCl(C) || []).find((x) => x.version === "3.78");
A("the changelog records 3.78", !!e && /chooses his own jersey number in his league profile/.test(e.summary) && e.items.length === 5);
const text = JSON.stringify(e) + s21.paragraphs[s21.paragraphs.length - 1] + rev.split("\n").filter((l) => /^\s*(--|\/\*|\*)/.test(l)).join(" ");
A("no em dashes or spaced hyphens in the new text", !/—|–| - /.test(text));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
