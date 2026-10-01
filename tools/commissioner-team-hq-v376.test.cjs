/* v3.76: a commissioner who selects a club in Team HQ has full control of it (Rule 2.6). The database half was
   rehearsed in Postgres (recorded at the foot of the SQL file). */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-10-01-commissioner-team-hq-v376.sql"), live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), ing = R("netlify/functions/ingest-stats.js");

console.log("— the database admits the league office");
A("waive_player acts for the player's own club for a commissioner", /if public\.is_commissioner\(\) then\s+select t\.\* into v_team from public\.teams t join public\.roster_spots rs on rs\.team_id = t\.id/.test(sql));
A("sign and offer take a named club; a manager may name only his own", /p_team uuid DEFAULT NULL::uuid\)/.test(sql) && /if not \(public\.is_commissioner\(\) or public\.is_gm_of\(p_team\)\) then/.test(sql) && /drop function public\.sign_free_agent\(uuid, bigint\);/.test(sql) && /drop function public\.offer_free_agent\(uuid, bigint, integer, text\);/.test(sql));
A("...authenticated only, the queue passes its club", /revoke all on function public\.sign_free_agent\(uuid, bigint, uuid\) from public, anon;/.test(sql) && /a->>''p_note'', v\.team_id\);/.test(sql) && /750000\), v\.team_id\);/.test(sql));
A("draft board: write and read", /if not \(public\.is_gm_of\(p_team\) or public\.is_commissioner\(\)\) then/.test(sql) && /create policy "office reads boards" on public\.draft_boards for select using \(public\.is_commissioner\(\)\);/.test(sql));
A("trades: proposed for any club, stamped with his own name", /with check \(\(from_profile_id = \(select auth\.uid\(\)\)\) and \(public\.is_gm_of\(from_team_id\) or public\.is_commissioner\(\)\)\);/.test(sql));
A("management: nominate, remove, permissions, decide, withdraw", /public\.is_commissioner\(\) or exists \(select 1 from public\.teams t/.test(sql) &&
  (sql.match(/and not public\.is_commissioner\(\) then   -- v3\.76: or the league office/g) || []).length === 4);
A("...and the notices name the league office when it acted", /case when v_owner = auth\.uid\(\) then ''owner'' else ''office'' end/.test(sql) && /else ''league office'' end \|\| '' approved your move/.test(sql));
A("the rehearsal is recorded", /REHEARSAL OK: W1 S1 S2 S3 D1 T1 T2 M1 M2 M3 G\./.test(sql));

console.log("— the site lets him use it");
A("one helper decides whether a move queues, never for the office", /CG\.mgmtWillQueue = function\(page\)\{\s+return CG\.role\(\) !== "commish"/.test(live) &&
  /if \(CG\.mgmtWillQueue\("draft"\)\)\{/.test(live) && /if \(CG\.mgmtWillQueue\("roster"\)\)\{/.test(live) && (hub.match(/CG\.mgmtWillQueue \? CG\.mgmtWillQueue\("lines"\)/g) || []).length === 2);
A("every page is reachable whatever seat is mirrored", /&& !\(CG\.role\(\)==="commish" && CG\.previewClub && CG\.previewClub\(\)\)\)\{/.test(live));
A("switching club clears the last club's drafts and reloads its offers", /CG\._lcDraft = \{\}; CG\._lcName = \{\}; CG\._liveTrade = null; CG\._counteringId = null;/.test(live) && /CG\.loadMyOffers \? CG\.loadMyOffers\(\) : null\]\)\.then\(done, done\);/.test(live));
A("the office is not frozen out of squad moves", /var fzOffice = fz\.on && CG\.role\(\)==="commish";\s+if \(fz\.on && !fzOffice\)\{/.test(hub));
A("published sheets can be withdrawn by the office until the game is under way", /CG\.lcClearableGames = function\(club, nightKey\)\{/.test(hub) && /picks = CG\.lcClearableGames\(club, night\);/.test(hub) && /\(dbLu && !shut && \(!rawLocked \|\| CG\.role\(\)==="commish"\)/.test(hub) &&
  /\(CG\.lcClearableGames\(club, n\.key\)\.length \? '<button class="btn btn-ghost btn-sm lc-clear"[^\n]*Clear '\+CG\.lcClearableGames\(club, n\.key\)\.length/.test(hub));
A("the game stats desk names the club; the office may combine sittings", (live.match(/teamId: tid/g) || []).length >= 3 && /var gsMulti = CG\.role\(\)==="commish"/.test(live) && /if \(ids\.length > 1 && !gsMulti\)/.test(live) && /const named = String\(\(body\.leagueEaFetch && body\.leagueEaFetch\.teamId\) \|\| ""\);/.test(ing));
A("free agents sign to the club this Team HQ acts for", /var t=\(CG\.myManagedTeam && CG\.myManagedTeam\(\)\) \|\|/.test(live) && /p_salary:null, p_team:faTeamId \}/.test(live) && /p_note:note, p_team:faTeamId \}/.test(live));
A("the draft room drafts for the previewed club", /var isMgr = role==="mgmt" \|\| \(role==="commish" && !!\(CG\.previewClub && CG\.previewClub\(\)\)\)/.test(live));
A("the Management page acts with the Owner's powers", /isOwner: !!\(uid && t\.owner===uid\) \|\| isOffice, isOffice: isOffice/.test(live) && /League office, acting for the Owner/.test(live));
A("Player requests is wired, in club mode", /if \(param==="clubrequests"\)\{ if \(CG\.AFTER\._complaintsLive\) CG\.AFTER\._complaintsLive\(\); return; \}/.test(live) && (live.match(/CG\.actionCard\(a, true, \{ club:true \}\)/g) || []).length === 2 && /if \(review && !club\)\{/.test(live));
A("the tasks card follows the previewed club", /CG\.gmTasksCard\(\(CG\.hqClub && CG\.hqClub\(\)\) \|\| me\.team\)/.test(hub));
A("the preview bar opens the club's settings", /id="cmClubEdit">Club settings<\/button>/.test(live) && /closest\("#cmClubEdit"\)/.test(live) && /CG\.teamForm\(team\)/.test(live));

global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.76"), last26 = secs["2.6"].paragraphs[secs["2.6"].paragraphs.length - 1];
A("2.6: a commissioner acts for any club with the Owner's full powers", /A commissioner may act for any club from its Team HQ with the full powers of its Owner/.test(last26) && /never queued for an Owner's approval/.test(last26) && /A commissioner may also move a player between the club's active roster and its training camp at any time, the weekly roster freeze included; the freeze binds only the club's own management \(Rule 2\.1\)\./.test(last26));
A("changelog records 3.76", !!e && e.dateIso === "2026-10-01");
A("no em dashes or spaced hyphens in the 3.76 entry or the new paragraph", !/—| - /.test(JSON.stringify(e) + last26));
/* the user's follow-up the same day: "allow commissioners to move players on a team between active roster and
   training camp at any time. Keep the weekly lock for the team management. Only grant the 24/7 capabilities to
   commissioners". The database guard already reads that way; pin it so it stays that way. */
const freezeSql = R("sql/2026-09-29-freeze-followups-v375.sql");
A("24/7: the freeze lets only a commissioner (or the league's own automation) through", /roster_freeze_at\(\) and not \(public\.is_commissioner\(\) or public\.trusted_writer\(\)\)/.test(freezeSql));
A("24/7: the site keeps the office's buttons in the freeze, and only the office's", /var fzOffice = fz\.on && CG\.role\(\)==="commish";/.test(hub) && /as a commissioner you can still call players up and send them down/.test(hub));
A("24/7: Rule 2.1 says the freeze binds only the club's management", /The freeze binds the club's own management only: a commissioner may move a player between any club's active roster and its training camp at any time, the window included/.test(secs["2.1"].paragraphs[3]) && /but never by its own call-up or send-down/.test(secs["2.1"].paragraphs[3]));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
