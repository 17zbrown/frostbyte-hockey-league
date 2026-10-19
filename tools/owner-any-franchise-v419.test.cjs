/* v4.19 (2026-10-18). Commissioner: "Allow people filling out owner applications to pick from any team in the NHL. If a
   the review board staff all vote on an application, do not automatically create the team until a commissioner gives
   the go ahead." Reverses v3.96's "current clubs only" (2026-10-13). The hold is derived (approved, an NHL franchise the
   league does not field, a season not yet started); public.office_found_owner_club is the one door that creates a club
   from an application (v4.19b adds its eligibility and timing gates). Run: node tools/owner-any-franchise-v419.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const strip = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const sqlA = R("sql/2026-10-18-owner-any-franchise-v419.sql"), a = strip(sqlA);
const sqlB = R("sql/2026-10-18-owner-go-ahead-gates-v419b.sql"), b = strip(sqlB);

console.log("\n1. Picks: any of the thirty-two");
A("the pick guard reads public.nhl_franchises (or a current club's own name), not only the clubs", /create or replace function public\.guard_owner_app_picks\(\) returns trigger\s+language plpgsql security definer set search_path to ''/.test(a) && /not exists \(select 1 from public\.nhl_franchises f where lower\(f\.franchise\) = lower\(btrim\(p\)\)\)\s+and not public\._owner_club_exists\(p\);/.test(a) && /% is not an NHL franchise\. Choose from the thirty-two \(32\) NHL franchises\./.test(a));
A("...and the commissioner may still record anything", /if public\.is_commissioner\(\) then return new; end if;/.test(a));
const lit = (a.match(/if v_names is distinct from '([^']+)' then/) || [])[1] || "";
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), desk = R("src/live/part9_staffdesks.js");
const NHL = eval(live.match(/CG\.NHL_FRANCHISES = (\[[\s\S]*?\]);/)[1]);
A("the site's list is the database's, name for name (the migration's self-check pinned the table to the same 32)", NHL.length === 32 && JSON.stringify(NHL.slice().sort()) === JSON.stringify(lit.split("|").sort()), NHL.length + " / " + lit.split("|").length);
{
  /* the form, run for real */
  const C = { TEAMS: [{ code: "BOS", city: "Boston", name: "Bruins" }, { code: "DAL", city: "Dallas", name: "Stars" }] };
  const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const src = ["CG.NHL_FRANCHISES = " + JSON.stringify(NHL) + ";", live.match(/CG\.activeFranchiseSet = function\(\)\{[\s\S]*?\n\};/)[0],
    live.match(/CG\.franchiseOptions = function\(selected\)\{[\s\S]*?\n\};/)[0], live.match(/CG\.ownerAppHeldClub = function\(a\)\{[\s\S]*?\n\};/)[0],
    live.match(/CG\.ownerAppClubStatus = function\(name, a\)\{[\s\S]*?\n\};/)[0], live.match(/CG\.ownersReapply = function\(seasonId\)\{[\s\S]*?\n\};/)[0]].join("\n");
  new Function("CG", "esc", src)(C, esc);
  const html = C.franchiseOptions("Toronto Maple Leafs");
  A("the form offers all 32, the league's clubs first, then the rest", (html.match(/<option value="[^"]+"/g) || []).length === 32 && html.indexOf('<optgroup label="In the CGHL"><option value="Boston Bruins">') > -1 && /<optgroup label="New to the league">/.test(html) && /value="Toronto Maple Leafs" selected/.test(html));
  A("...and a stored pick outside the 32 still shows, so editing never drops it", /value="Quebec Nordiques" selected/.test(C.franchiseOptions("Quebec Nordiques")));
  C.SEASONS = [{ id: "s1", status: "active" }, { id: "s2", status: "upcoming" }];
  A("held: approved, an NHL franchise the league does not field, a season not yet started", C.ownerAppHeldClub({ status: "approved", awarded_club: "toronto maple leafs ", season_id: "s2" }) === "Toronto Maple Leafs");
  A("...not a club the league has, not a pending one, not a season being played (old Season 1 approvals)", C.ownerAppHeldClub({ status: "approved", awarded_club: "Boston Bruins", season_id: "s2" }) === null && C.ownerAppHeldClub({ status: "pending", awarded_club: "Toronto Maple Leafs", season_id: "s2" }) === null && C.ownerAppHeldClub({ status: "approved", awarded_club: "Vegas Golden Knights", season_id: "s1" }) === null);
  const st = C.ownerAppClubStatus("Toronto Maple Leafs", { season_id: "s2" }), bad = C.ownerAppClubStatus("Quebec Nordiques", {});
  A("the review board sees a new franchise as a new club, not a mistake", st.ok === true && /New club: added on the commissioner’s go-ahead/.test(st.chip) && bad.ok === false && /Not an NHL franchise/.test(bad.chip));
}
A("the picks line tags a new club neutrally, and warns only outside the 32", /' <span class="chip chip-chrome" style="font-size:8px;padding:1px 5px">new club<\/span>'/.test(live) && /not an NHL franchise<\/span>'/.test(live) && !/not a CGHL club<\/span>/.test(live));
A("the form's caption says any of the 32, and a new club waits for the go-ahead", /Any of the 32 may be chosen\./.test(live) && /becomes a new club only when a commissioner gives the go-ahead after the review board approves you/.test(live) && !/New clubs are added by the league office\.<\/p>/.test(live));

console.log("\n2. The hold: an approval never creates a club");
A("the hold helper is scoped to a season that has not started", /join public\.seasons s on s\.id = a\.season_id and s\.status = 'upcoming'/.test(a) && /where a\.id = p_app and a\.status = 'approved' and not public\._owner_club_exists\(a\.awarded_club\)/.test(a));
A("_owner_app_autoplace holds instead of founding, and flags the commissioners", /'New club awaits your go-ahead'/.test(a) && /Nothing was created\./.test(a) && /self-check: an approval would create a club by itself/.test(a));
A("the applicant, the board's choose-club and admit replies all carry the held wording (ok, not an error)", /would be a new club for the league: '\s*\|\| 'it is added, and you are seated as its Owner, once a commissioner gives the go-ahead\. You will be told the moment it is yours\.'/.test(a) && /'ok', true, 'held', true, 'awarded', v_club/.test(a) && /'ok', true, 'held', true, 'placed', null/.test(a));
A("every patch is anchored and asserted to match exactly once", (a.match(/if v_n <> 1 then raise exception 'patch % \(%\): anchor found % times'/g) || []).length === 1 && (b.match(/if v_n <> 1 then raise exception 'patch % \(%\): anchor found % times'/g) || []).length === 1);
A("the watchdog and the Staff Desk count name held applications", /coalesce\(' New clubs awaiting your go-ahead: ' \|\| v_held \|\| '\.', ''\)/.test(a) && /'owner_apps_awaiting_go_ahead', \(select count\(\*\) from owner_applications a where public\._owner_app_held_club\(a\.id\) is not null\)/.test(a));
A("the rehearsal caught the Season 1 withdrawn-club approvals and is recorded", /COL, MTL, TBL, VGK/.test(sqlA) && /a member names the Toronto Maple Leafs: accepted; "Quebec Nordiques": refused/.test(sqlA));

console.log("\n3. The go-ahead: one door, commissioner only");
for (const [label, src] of [["v4.19", a], ["v4.19b", b]]) {
  A(label + ": commissioner only, held applications only, the current season only", /if not public\.is_commissioner\(\) then\s+raise exception 'Only a commissioner gives the go-ahead for a new club\.'/.test(src) && /v_club := public\._owner_app_held_club\(p_app\);/.test(src) && /if v_app\.season_id is distinct from public\.current_season_id\(\) then/.test(src));
  A(label + ": creates the club from the reference in the chosen division, then seats the applicant through _owner_app_autoplace", /insert into public\.teams \(code, name, city, division, color, founded_season, league_id\)\s+values \(v_f\.code, v_f\.club_name, v_f\.city, v_div, v_f\.color, v_snum, v_league\);\s+v_placed := public\._owner_app_autoplace\(p_app\);/.test(src));
}
A("v4.19b: waits for the season start, refuses once the draft order or schedule exists", /from public\.season_owner_baseline b where b\.season_id = v_app\.season_id/.test(b) && /from public\.draft_picks dp where dp\.season_number = v_snum\)\s+or exists \(select 1 from public\.games g where g\.season_id = v_app\.season_id\)/.test(b));
A("v4.19b: re-checks eligibility: signed up, in the Discord, not suspended, one of the three picks", /r\.status <> 'declined'/.test(b) && /coalesce\(v_prof\.in_guild, false\)/.test(b) && /public\.is_suspended\(v_prof\.id\)/.test(b) && /is not one of the three franchises this applicant asked for/.test(b));
A("v4.19b: no claim that anyone was told when the call rolls back", !/have been told why/.test(b.slice(b.indexOf("create or replace function public.office_found_owner_club"), b.indexOf("create or replace function public.owner_decision_watch"))));
A("v4.19b: a waitlist admit sends its own notice, and the staff bell names the picks", /perform set_config\('app\.owner_notice', 'rpc', true\);/.test(b) && /'You were admitted from the waitlist\. The '/.test(b) && /v_club := coalesce\('one of: ' \|\| nullif\(concat_ws/.test(b));
A("v4.19b: the watchdog runs with an empty search_path", /create or replace function public\.owner_decision_watch\(\) returns integer\s+language plpgsql security definer set search_path to ''/.test(b));
A("grants: signed-in users may call the go-ahead (it checks the commissioner), nobody else; the helpers are private", /revoke all on function public\.office_found_owner_club\(uuid, text\) from public, anon;\s+grant execute on function public\.office_found_owner_club\(uuid, text\) to authenticated;/.test(a) && /revoke all on function public\._owner_app_held_club\(uuid\) from public, anon, authenticated;/.test(a));
A("the rehearsals are recorded: refusals before the season start, without a sign-up, out of the Discord, after the draft order", /before the season start: refused \("Start Season 2 first"\)/.test(sqlB) && /sign-up declined: refused/.test(sqlB) && /draft order or schedule is already built/.test(sqlB) && /the Toronto Maple Leafs \(TOR, East, #00205b, founded Season 2\)/.test(sqlA));
A("nothing posts to Discord", !/discord_http_post|notify_discord|_announce_once|club_notify\(/.test(a + b));
{
  /* the commissioner's card, run for real */
  const src = live.match(/CG\.ownerGoAheadCard = function\(a\)\{[\s\S]*?\n\};/)[0];
  const C = { SEASON: { id: "s2" }, DIVISIONS: ["East", "West"], role: () => "commish", ownerAppHeldClub: (x) => (x.held ? "Toronto Maple Leafs" : null) };
  new Function("CG", "esc", src)(C, (x) => String(x));
  const card = C.ownerGoAheadCard({ id: "app1", held: true, season_id: "s2", profiles: { gamertag: "Porky" } });
  A("the go-ahead card: the club, a division picker and the button", /Commissioner go-ahead/.test(card) && /<option value="East">East<\/option><option value="West">West<\/option>/.test(card) && /data-go-ahead="app1" data-club="Toronto Maple Leafs">Give the go-ahead<\/button>/.test(card));
  A("...waits while the season before is still being played, and is never shown to anyone but a commissioner or for an unheld application", /Available once the season before this one is complete/.test(C.ownerGoAheadCard({ id: "x", held: true, season_id: "s3", profiles: {} })) && C.ownerGoAheadCard({ id: "x", held: false }) === "" && (C.role = () => "staff", C.ownerGoAheadCard({ id: "x", held: true, season_id: "s2" }) === ""));
}
A("the button calls the one door, colors the toast by d.ok, and repaints the league", /CG\.sb\.rpc\("office_found_owner_club", \{ p_app:id, p_division:div \}\)/.test(live) && /CG\.toast\(d\.message \|\| "Club added", d\.ok === false \? "err" : "ok"\);/.test(live) && /office_found_owner_club "\+/.test(live.slice(live.indexOf("CG.ROLE_RPCS = ("), live.indexOf("CG.ROLE_RPCS = (") + 400)));
A("the Control Center and the Staff Desk list held applications for the commissioner", /waiting on your go-ahead',\s*heldApps\.length===1/.test(live) && /owner_apps_awaiting_go_ahead:\(lg\._ownerApps\|\|\[\]\)\.filter/.test(live) && /waiting on your go-ahead for a new club", go:"#\/admin", warn:true/.test(live));
A("Add a club refuses a franchise a held application waits on, and points to the go-ahead", /An approved owner application is waiting on the go-ahead for this club\./.test(live));
A("the review board's waitlist copy matches (a new club waits for the go-ahead)", /a new one waits for a commissioner’s go-ahead/.test(desk) && /A club the league does not field yet is added only when a commissioner gives the go-ahead\./.test(desk) && !/creates it if it does not exist yet/.test(desk));
A("the ballot and Staff Desk captions state the majority rule, not 'once all reviewers vote'", /it is approved once more than half of all "\+N\+" reviewer/.test(live) && !/once all "\+N\+" reviewer/.test(live) && !/Once all <b>'\+revCount/.test(live));

console.log("\n4. Rules and changelog");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
const pub2 = R("src/live/part5b_public2.js"), c0 = pub2.indexOf("CG.rulebookForFormat = function");
const K = {}; new Function("CG", pub2.slice(c0, pub2.indexOf("\nCG.ROUTES.rulebook", c0)))(K);
const book = K.rulebookForFormat(rb, "basic");
const sec = (id) => [].concat(...book.chapters.map((c) => c.sections || [])).find((x) => x.id === id) || { paragraphs: [] };
const s2 = rb.chapters.find((c) => c.upcomingSeason === 2) || { sections: [] };
const s22 = (s2.sections[1] || { paragraphs: [] }).paragraphs[1] || "";
A("S2.2: any three of the 32, and a new club only on the go-ahead (the binding Season 2 text)", /An applicant may name any three \(3\) of the thirty-two \(32\) franchises of the National Hockey League\./.test(s22) && /only when a commissioner gives the go-ahead, which waits for the start of Season 2 and comes before its draft order and schedule are built \(Rule 2\.6\)\./.test(s22) && !/chooses among the league's current clubs/.test(JSON.stringify(rb.chapters)));
A("...S2.2 keeps the handover and December 19 sentences, and Chapter S2 its seven sections", /hands the club over: the previous Owner's seat ends, and that member keeps their roster spot/.test(s22) && /by Saturday, December 19/.test(s22) && s2.sections.length === 7);
const r26 = sec("2.6");
A("Rule 2.6 [4]: any NHL franchise; the award admits a new club only on the go-ahead, eligibility re-checked then (rendered book)", /An owner application may name any franchise of the National Hockey League, including one the league does not yet have\. An approval for such a franchise takes effect only when a commissioner gives the go-ahead/.test(r26.paragraphs[3]) && /the award admits it as a new club/.test(r26.paragraphs[3]) && /^An owner application is made for one season, and only a member signed up to play in that season may make one;/.test(r26.paragraphs[3]));
A("Rule 2.6 [1]: the majority rule stays, with the go-ahead clause", /approved once more than half of all the reviewers approve it/.test(r26.paragraphs[0]) && /Only a commissioner decides one alone\. An owner application so approved for a franchise the league does not yet field founds no club until a commissioner gives the go-ahead \(paragraph 4 of this rule\)\./.test(r26.paragraphs[0]));
const e = rb.changelog.find((c) => c.version === "4.19") || {};
A("the changelog has its 4.19 entry, right before 4.18", e.version === "4.19" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.18");
A("...naming the 32, the hold, the go-ahead and its timing, with no em dash or gendered pronoun", /32 NHL franchises/.test(e.summary || "") && (e.items || []).some((i) => /Give the go-ahead|gives the go-ahead from the application page/.test(i)) && (e.items || []).some((i) => /waits until Season 2 has started/.test(i)) && !/[—–]/.test(JSON.stringify(e)) && !/\b(he|his|him|she|her)\b/i.test(JSON.stringify(e)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
