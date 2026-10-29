/* v4.36: the Stats manager overhaul.
   Run: node tools/stats-manager-v436.test.cjs

   Commissioner, 2026-10-29: "I want you to overhaul that stats manager staff desk to feel easier to use and understand
   for someone who doesn't go in there all the time The search function is a must work feature, and tie the lag-out
   merge function into the search feature similar to how the pickup game inputs work. The dropdown in the correct a
   filed result and the forfeit games are also sort of hard to understand and read at a glance. Can you freshen those
   up and move the forfeit function above the correct result function?"

   Pinned here: the card order (forfeit above correction), the search door that now carries the merge (one list of a
   club's sittings, grouped by game, ticked and merged or imported), the game picker that replaced the dropdowns, the
   desk drawing from one state object with no page resets, the Rule 7.1 warning that never blocks, the house rules on
   the desk's copy and markup, and the desk's pure helpers run in a sandbox. The server half is
   tools/league-sessions-v436.test.mjs and the extended tools/league-merge.test.mjs. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js"), head = R("src/live/part1_head.html"), ui = R("src/live/part4_ui.js");
let ok = true, n = 0, pass = 0;
const A = (l, p, x) => { n++; if (p) pass++; else ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const at = (s) => live.indexOf(s);
const deskFrom = at("CG._smS = function"), deskTo = at("CG._smRenderDetail = function");
const desk = live.slice(deskFrom, deskTo);
const pureFrom = at("/* -- Stats manager desk v4.36: pure helpers (no DOM) -- */"), renderFrom = at("/* -- Stats manager desk v4.36: render -- */"),
      wireFrom = at("/* -- Stats manager desk v4.36: wiring -- */");

console.log("— the desk, top to bottom");
A("the desk exists as one block before the pickup detail editor", deskFrom > 0 && deskTo > deskFrom && pureFrom > deskFrom && renderFrom > pureFrom && wireFrom > renderFrom && wireFrom < deskTo);
A("forfeit renders ABOVE correction (commissioner, 2026-10-29)",
  /'<div class="sm" id="smDesk">'\+CG\._smTodoHtml\(st\)\+CG\._smFindHtml\(st\)\+CG\._smForfeitHtml\(st\)\+CG\._smFixHtml\(st\)\+CG\._smListHtml\(st\)\+'<\/div>'/.test(desk));
for (const [id, t] of [["smTodo", "Needs attention"], ["smForfeit", "Forfeit a game"], ["smFix", "Correct a filed result"], ["smList", "Pickup games on file"]])
  A(`card "${t}"`, desk.indexOf(`CG._smCard("${id}", "${t}"`) > 0);
A('card "Find a game on EA", the one door for EA', /<h3>Find a game on EA<\/h3>/.test(desk));
A("the fixture-dropdown merge card is retired (the search covers it)", !/<h3>League lag-out merge|smLgGame|smLgLoad|lgGames/.test(live));
A("the forfeit kinds still say no-show and three disconnections (review_held_games tells staff to pick them by name)",
  /"No-show or late"/.test(desk) && /"Three disconnections, or abandoned"/.test(desk));
A("Needs attention only shows when something waits", /if \(!all\.length\) return "";/.test(desk));

console.log("\n— the search carries the merge");
A("a club's sittings come from leagueSessions, archive first, then EA", /CG\._smLeagueApi\(\{ leagueSessions:p1 \}\)/.test(desk) && /CG\._smLeagueApi\(\{ leagueSessions:\{ clubId:club, ea:true \} \}\)/.test(desk));
A("...and leagueSessions is only ever sent through the EA-aware caller", (live.match(/leagueSessions/g) || []).length === (live.match(/CG\._smLeagueApi\(\{ leagueSessions/g) || []).length);
A("the merge request keeps its pinned shape", /var req = \{ leagueMerge: \{ gameId: gid, matchIds: ids, restart: restart \} \};/.test(desk));
A("it is previewed (nothing written) before the confirm", /CG\._smLeagueApi\(CG\._smWith\(req, \{ preview:true \}\)\)/.test(desk));
A("...and taking a published final down needs its own confirm and flag", /r\.unpublish \? CG\._smWith\(req, \{ unpublish:true \}\) : req/.test(desk) && /"Hold the game"/.test(desk));
A("one call per merge, never one per sitting (one box score, one notice)", (desk.match(/leagueMerge: \{ gameId/g) || []).length === 1 && !/forEach\([^)]*\)[\s\S]{0,80}leagueMerge/.test(desk));
A("a sitting EA lists but the archive does not is merged from the bot's stored answer", /if \(fromEa\.length\) req\.leagueMerge\.eaClubId = f\.club\.eaId;/.test(desk));
A("pickup sittings import through the pickup door", /CG\._smApi\(\{ action:"import", clubId:f\.club\.eaId, matchIds:sel\.sel \}\)/.test(desk));
A("the restart option is kept (staff only on the server)", /id="smLgRestart"/.test(desk));
A("held merges still say so", /Merged and held\./.test(desk));
A("the bar caption keeps the overtime rule the 2026-09-26 record names", /overtime from the deciding sitting/.test(live));
A("the EA status line: still exactly four on the site, one on this desk", (live.match(/CG\.eaStatusLine\(\)/g) || []).length === 4 && (desk.match(/CG\.eaStatusLine\(\)/g) || []).length === 1);
A("...repainted in place, never blinking back to Checking", /var oldEa = el\.querySelector\("\[data-ea-status\]"\);/.test(desk));

console.log("\n— no page resets: the desk draws from one state object");
A("no CG.router() anywhere in the desk", !/CG\.router\(/.test(desk));
A("every section repaints by id through _smPaint", /CG\._smPaint = function\(id, html\)/.test(desk) && /el\.outerHTML = html;/.test(desk));
A("controls mark themselves drawn, so a live-pulse repaint is not held forever", /t\.defaultChecked = t\.checked/.test(desk) && /t\.defaultValue = t\.value;/.test(desk) && /r\.defaultChecked = r\.checked/.test(desk));
A("selections are real inputs (a game-night repaint sees them), not aria-pressed chips", !/aria-pressed|data-smsel|data-lgsel|smMergeBar/.test(desk) && /name="smSess"/.test(desk));
A("stale replies are dropped when the club changes mid-wait", /if \(req !== st\.seq \|\| !f\.club \|\| f\.club\.eaId !== club\) return;/.test(desk));
A("motion only on what the user caused, never in a render", !/_smEnter\(/.test(live.slice(renderFrom, wireFrom)) && /prefers-reduced-motion: reduce/.test(desk));
A("anchored repaints scroll with behavior instant (the site scrolls smooth)", (desk.match(/scrollBy\(/g) || []).length === (desk.match(/scrollBy\(\{ top:d, left:0, behavior:"instant" \}\)/g) || []).length);
A("a correction is read back before the desk says it worked (the RPC returns nothing)", /CG\.sb\.from\("games"\)\.select\("status,home_score,away_score,went_ot"\)\.eq\("id", id\)\.maybeSingle\(\)/.test(desk));
A("the forfeit result reads the RPC's answer (no more '1-0' on a kept result)", /d\.kept_result/.test(desk) && !/Forfeit ruled — 1–0/.test(live));
A("the pickup list fails loud, never as an empty list", /Could not load the pickup games:/.test(desk) && /if \(r\.error\) L\.err = r\.error\.message;/.test(desk));

console.log("\n— rules the desk keeps");
A("only a commissioner undoes a forfeit; staff report it (v3.52)", /CG\.auth && CG\.auth\.role === "commish"\s*\n\s*\? '<button class="btn btn-ghost" id="smFfUndo">Undo a forfeit<\/button>'/.test(desk));
A("Rule 7.1 warns and never blocks", /Under Rule 7\.1 an official does not rule/.test(desk) && !/disabled/.test(desk.split("\n").filter((l) => /_smInvolved\(/.test(l)).join("\n")));
A("a voided game never appears in the picker", /if \(g\.voided\) return false;/.test(desk));
A("one correction door, one forfeit door", (live.match(/rpc\("stats_game_set_result"/g) || []).length === 1 && /rpc\("forfeit_game"/.test(desk) && /rpc\("unforfeit_game"/.test(desk));
A("the struck rule is shown, not hidden", /A struck sitting stays struck\./.test(desk));

console.log("\n— the review's fixes (v4.36)");
A("after a merge the merged rows read right at once, and the page that holds the game is reloaded", /if \(ids\.indexOf\(s\.matchId\) >= 0\)\{ s\.onGame = true; s\.struck = false;/.test(desk) && /CG\._smLoad\(g && CG\.now\(\) - g\.at >= 9 \* 86400000 \? \{ before:CG\._smEtDay\(g\.at \+ 2 \* 86400000\) \} : \{ ea:false, keep:true \}\);/.test(desk));
A("a merge that lands while EA is still checked keeps that check alive", /if \(opts\.keep && !opts\.before && f\.ea && f\.ea\.state === "wait"\) opts\.ea = true;/.test(desk));
A("a pickup error shows beside the bar that was pressed", /if \(!o \|\| o\.error\)\{ f\.err = \(o && o\.error\) \|\| "The import did not answer\."; paintBar\(\); return; \}/.test(desk));
A("a success must say ok: a crashed function's reply is never read as one", /if \(!r \|\| r\.error \|\| !r\.ok\)/.test(desk) && /if \(!r2 \|\| r2\.error \|\| !r2\.ok\)/.test(desk) &&
  /r\.ok === false && !\(o && o\.error\) \? \{ error:"The server failed \(HTTP "/.test(live));
A("focus comes back to the result after the page refreshes", /var rf = st\.refocus;/.test(desk) && /st\.refocus = "smFindRes";/.test(desk));
A("only the user's own folds are remembered, the Restarted fold too", /if \(d\.open === \(d\.getAttribute\("data-open"\) === "1"\)\) return;/.test(desk) && /if \(d && d\.id === "smAdv"\)\{ CG\._smS\(\)\.find\.adv = d\.open; return; \}/.test(desk));
A("a merge that links a club's EA club says so in the confirm", /if \(r\.links\) ps\.push\("This also links "/.test(desk));
A("the search's live region stays put; only its words change", /'<div id="smClubsOut" aria-live="polite">'\+CG\._smClubsHtml\(st\)\+'<\/div>/.test(desk) && /o\.innerHTML = CG\._smClubsHtml\(CG\._smS\(\)\);/.test(desk));
A("the focus note says EA only when EA was asked", /" \(EA is still being checked\)"/.test(desk) && /" for these dates \(EA was not checked\)"/.test(desk));
A("an unconfirmed correction is not called unsaved", /The correction was sent, but the desk could not read /.test(desk));
A("the unpublish confirm states the server's own reason", /\(r\.heldWhy \|\| "These sittings add up to only "/.test(desk));

console.log("\n— house rules");
A("no em or en dashes, no &mdash; in the desk", !/[–—]|&mdash;|\\u2014|\\u2013/.test(desk));
A("one chrome button on the desk (the action bar)", (desk.match(/btn btn-chrome/g) || []).length === 1);
A("no glass, no gamecard reuse, no radio-cards (not keyboard reachable)", !/backdrop-filter|gamecard|radio-cards/.test(desk));
A("the desk CSS is scoped and token based", /\/\* v4\.36: the Stats manager desk/.test(head) && /\.sm \.card\.sm-sticky\{overflow:visible\}/.test(head) && /#smBarSlot\{display:contents\}/.test(head));
A("...with a reduced-motion fallback", /@media\(prefers-reduced-motion:reduce\)\{\.sm-crest,\.sm-crest:active\{transform:none;transition:none\}/.test(head));
A("CG.confirm takes several facts, each its own escaped paragraph", /var ps = Array\.isArray\(msg\) \? msg : \[msg\];/.test(ui) && /esc\(m\)/.test(ui));
A("the pickup result is one definition, used twice", (live.match(/CG\._puResultHtml\(/g) || []).length === 2 && (live.match(/players matched to CGHL profiles/g) || []).length === 1);
A("the v4.35 club-desk anchor still finds the club desk first", at('btn.textContent = "Pulling sessions…";') > deskTo);
A("the Automations panel names the new door", /the Stats Manager\\u2019s Find a game on EA, the pickup import page/.test(live));

/* ---- the pure helpers, run in a sandbox against fixture games ---- */
console.log("\n— the pure helpers");
const D = 86400000, NOW = Date.parse("2026-10-29T16:00:00Z");
const G = (o) => Object.assign({ week:6, stage:"regular", status:"final", voided:false, forfeit:null, eaMatchId:"m1", ot:false, rescheduledFrom:null }, o);
const sched = [
  G({ id:"f1", away:"DAL", home:"PIT", at:Date.parse("2026-10-29T01:35:00Z"), homeScore:3, awayScore:2, ot:true }),   // last night, final OT
  G({ id:"h1", away:"BOS", home:"SEA", at:Date.parse("2026-10-29T01:00:00Z"), status:"scheduled", homeScore:null, awayScore:null, eaMatchId:"m9" }), // held
  G({ id:"a1", away:"VAN", home:"UTA", at:Date.parse("2026-10-29T02:10:00Z"), status:"scheduled", homeScore:null, awayScore:null, eaMatchId:null }), // awaiting
  G({ id:"s1", away:"NYI", home:"DET", at:NOW + 9 * 3600000, status:"scheduled", homeScore:null, awayScore:null, eaMatchId:null }),                   // tonight
  G({ id:"x1", away:"PIT", home:"DAL", at:Date.parse("2026-10-23T02:10:00Z"), homeScore:0, awayScore:1, forfeit:"DAL", eaMatchId:null }),           // forfeit no-show
  G({ id:"v1", away:"SEA", home:"BOS", at:Date.parse("2026-10-23T01:00:00Z"), voided:true, status:"scheduled", homeScore:null, awayScore:null }),
  G({ id:"m0", away:"DAL", home:"PIT", at:Date.parse("2026-10-22T01:00:00Z"), homeScore:4, awayScore:1, eaMatchId:null }),                          // manual final, no box
  G({ id:"mk", away:"SEA", home:"VAN", at:Date.parse("2026-10-29T00:25:00Z"), homeScore:2, awayScore:1, week:5, rescheduledFrom:1 })              // a make-up, first that night
];
for (let i = 0; i < 40; i++) sched.push(G({ id:"old"+i, away:"DAL", home:"BOS", at:Date.parse("2026-09-01T01:00:00Z") + i * D, homeScore:2, awayScore:1 }));   // Aug 31 to Oct 9 ET
const line = (g) => ({ g, a:0, toi:600 });
const results = [{ id:"f1", box:{ PIT:{ p1:line(2), p2:line(1) }, DAL:{ p3:line(2) } } }];
const TEAMS = ["DAL","PIT","BOS","SEA","VAN","UTA","NYI","DET"].map((c, i) => ({ code:c, name:{ DAL:"Stars", PIT:"Penguins" }[c] || c, city:{ DAL:"Dallas", PIT:"Pittsburgh" }[c] || "", id:"T"+c, eaClubId:String(1000 + i), owner:null, gm:c === "PIT" ? "gm-pit" : null, agm:null }));
const TEAM = Object.fromEntries(TEAMS.map((t) => [t.code, t]));
const auth = { user:{ id:"u1" }, role:"staff" };
const fmtDay = (ts) => new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", weekday:"short", month:"short", day:"numeric" }).format(ts);
const CG = { TEAMS, TEAM, auth, lg:{ schedule:sched, allResults:results }, now:() => NOW, fmtDay,
  fmtTime:(ts) => new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", hour:"numeric", minute:"2-digit" }).format(ts)+" ET",
  boxSides:(g, res) => { const b = res && res.box; return !g || !b ? [] : [b[g.home], b[g.away]].filter(Boolean); },
  boxLines:(b) => (!b ? [] : (b.skate ? [b, b.skate] : [b])),
  forfeitNoIce:(g, res) => !!(g && g.forfeit) && !(res && res.box), me:() => null,
  isMakeUp:(g) => !!(g && g.rescheduledFrom && g.rescheduledFrom < g.at) };   /* the real one (part6_hub.js) also needs another game-week */
const ctx = { CG, Intl, Date, Math, Object, Array, String, JSON };
vm.runInNewContext(live.slice(deskFrom, renderFrom), ctx);
const g = (id) => sched.find((x) => x.id === id);

const s1 = CG._smGameState(g("f1")), s2 = CG._smGameState(g("h1")), s3 = CG._smGameState(g("a1")), s4 = CG._smGameState(g("s1")), s5 = CG._smGameState(g("x1"));
A("states: Final, OT / Held / No result yet / Scheduled", s1.label === "Final, OT" && s2.label === "Held" && s2.chip === "chip-warn" && s3.label === "No result yet" && s4.label === "Scheduled");
A("a forfeit is locked for staff and open to a commissioner", s5.label === "Forfeit: DAL" && s5.lock === true && (auth.role = "commish", CG._smGameState(g("x1")).lock === false));
auth.role = "staff";
let k = CG._smKinds(g("f1"));
A("a played final: no-show refused with the reason, kept result preselected", !k.noshow.ok && /it was played/.test(k.noshow.why) && k.dc3.ok && k.pre === "dc3");
k = CG._smKinds(g("s1"));
A("a game not played yet: no-show preselected, kept result refused", k.noshow.ok && !k.dc3.ok && /merge its sittings first/.test(k.dc3.why) && k.pre === "noshow");
k = CG._smKinds(g("h1"));
A("a held game: kept result only", !k.noshow.ok && k.dc3.ok && k.pre === "dc3");
k = CG._smKinds(g("m0"));
A("a hand-filed final with no box score: both kinds open, nothing preselected", k.noshow.ok && k.dc3.ok && k.pre === null);
A("what posts: a kept result on a final posts nothing, and says so", /Nothing is posted/.test(CG._smFfPosts(g("f1"), "dc3")) && /Final \(forfeit\) posts/.test(CG._smFfPosts(g("s1"), "noshow")) && /Corrected line/.test(CG._smFfPosts(g("m0"), "noshow")));
A("the will-record line reads away first", CG._smFfWill(g("f1"), "dc3", "DAL") === "Will record: DAL 2, PIT 3 stands with every stat line, and DAL takes the forfeit loss (FFL)." &&
  CG._smFfWill(g("s1"), "noshow", "NYI") === "Will record: DET wins 1-0 by forfeit, with no player stats.");

const fx = (h, a, ot) => CG._smFixCheck(g("f1"), { h:String(h), a:String(a), ot:!!ot });
A("correction: blank asks for both scores", !fx("", "").ok && !fx("", "").bad && /Enter both scores/.test(fx("", "").msg));
A("...a level score is refused", !fx(3, 3).ok && fx(3, 3).bad);
A("...overtime needs a one-goal margin", !fx(5, 2, true).ok && fx(5, 2, true).bad);
A("...an unchanged result is not a correction", !fx(3, 2, true).ok && !fx(3, 2, true).bad);
A("...a score change says a Corrected line posts, away first", fx(4, 2, false).ok && /Will read: DAL 2, PIT 4\. A Corrected line posts/.test(fx(4, 2, false).msg));
A("...an overtime-only change says nothing posts", fx(3, 2, false).ok && /nothing is posted in #game-scores/.test(fx(3, 2, false).msg));

const sess = (o) => Object.assign({ minutes:30, length:"short", source:"archive", clubs:[], archive:null, pickupGameId:null, onGame:false, struck:false, kind:"league", ambiguous:false, alternatives:[], canMerge:true, canPickup:false, why:null }, o);
const fxs = (id) => ({ gameId:id, home:g(id).home, away:g(id).away, at:new Date(g(id).at).toISOString(), status:g(id).status, held:false, forfeit:g(id).forfeit, inWindow:true });
const st = { find:{ picked:{}, moved:{}, restart:false, focus:null } };
const list = [
  sess({ matchId:"A1", endedAt:"2026-10-29T01:58:00Z", kind:"league", fixture:fxs("h1"), onGame:true }),
  sess({ matchId:"A2", endedAt:"2026-10-29T02:40:00Z", kind:"league", fixture:fxs("h1"), source:"ea" }),
  sess({ matchId:"B1", endedAt:"2026-10-29T02:40:00Z", kind:"league", fixture:fxs("f1"), onGame:true, alternatives:[fxs("h1")] }),
  sess({ matchId:"P1", endedAt:"2026-10-28T20:00:00Z", kind:"not-league", fixture:null, canMerge:false, canPickup:true, source:"ea", clubs:[{ eaId:"1000" }, { eaId:"777" }] }),
  sess({ matchId:"P2", endedAt:"2026-10-28T20:40:00Z", kind:"not-league", fixture:null, canMerge:false, canPickup:true, source:"ea", clubs:[{ eaId:"777" }, { eaId:"1000" }] }),
];
let groups = CG._smGroups(list, st);
const gh = groups.find((x) => x.gameId === "h1");
A("sittings group under their game, numbered by end time", gh && gh.sessions.map((s) => s.matchId + ":" + s._k).join() === "A1:1,A2:2");
A("pickup sittings group by club pair and night, whichever side is listed first", groups.filter((x) => x.kind === "not-league").length === 1 && groups.find((x) => x.kind === "not-league").sessions.length === 2);
A("a finished game whose every sitting is on it reads complete (folded)", groups.find((x) => x.gameId === "f1").complete === true && gh.complete === false);
st.find.focus = "f1"; groups = CG._smGroups(list, st);
A("a focused game's group comes first", groups[0].gameId === "f1" && groups[0].focus);
st.find.focus = null; st.find.moved = { B1:"h1" }; groups = CG._smGroups(list, st);
A("Move it there regroups a sitting under the other game", groups.find((x) => x.gameId === "h1").sessions.length === 3);
st.find.moved = {};

const bar = (picked, restart) => { st.find.picked = picked; st.find.restart = !!restart; const gs = CG._smGroups(list, st); return CG._smBar(st, gs, CG._smSelection(st, gs)); };
A("nothing ticked: no bar", bar({}) === null);
A("one ticked beside the sitting already on the game: merge 2, keeping it", bar({ A2:true }).title === "Merge 2 sittings into BOS @ SEA" && /1 already on the game, 1 you ticked\. Stats are added up into one game \(Rule 4\.3\)\./.test(bar({ A2:true }).caption));
A("restart re-files from the ticked sittings alone", bar({ A2:true }, true).title === "Re-file BOS @ SEA from 1 sitting" && bar({ A2:true }, true).restart);
A("one pickup sitting", bar({ P1:true }).title === "Import 1 sitting as a pickup game");
A("two pickup sittings import as one game", bar({ P1:true, P2:true }).title === "Import 2 sittings as one pickup game");
A("ticks under two games are refused with the reason", bar({ A2:true, P1:true }).err === true && /one game only/.test(bar({ A2:true, P1:true }).title));
const four = [sess({ matchId:"C1", endedAt:"2026-10-29T03:00:00Z", fixture:fxs("a1"), onGame:true })].concat(["C2","C3","C4"].map((id, i) => sess({ matchId:id, endedAt:"2026-10-29T0"+(4+i)+":00:00Z", fixture:fxs("a1") })));
st.find.picked = { C2:true, C3:true, C4:true };
const g4 = CG._smGroups(four, st), b4 = CG._smBar(st, g4, CG._smSelection(st, g4));
A("four sittings is the most one game takes, and the bar says so", b4.title === "Merge 4 sittings into VAN @ UTA" && /Four sittings is the most/.test(b4.caption));
st.find.picked = {};
/* v4.36 review: a game opened from Needs attention with every sitting already on it but nothing published (held, or
   back to scheduled after a forfeit undo) can be filed again from those sittings, with nothing ticked */
st.find.focus = "h1";
const gR = CG._smGroups(list, st), bR = CG._smBar(st, gR, CG._smSelection(st, gR));
A("a held game's own sittings can be filed again with nothing ticked", bR && bR.title === "File BOS @ SEA from its 1 sitting" && /stays held/.test(bR.caption) && bR.btn === "File the game", JSON.stringify(bR));
st.find.focus = "f1";
const gF = CG._smGroups(list, st);
A("...never for a published final (nothing to file)", CG._smBar(st, gF, CG._smSelection(st, gF)) === null);
st.find.focus = null;

const prev = [sess({ matchId:"E1", endedAt:"2026-10-29T03:00:00Z", source:"ea", kind:"not-league", canPickup:true }), sess({ matchId:"E2", endedAt:"2026-10-29T02:00:00Z", source:"ea" })];
const next = [sess({ matchId:"E1", endedAt:"2026-10-29T03:00:00Z", source:"archive", kind:"not-league", canPickup:false, archive:{ status:"ignored", gameId:null } })];
const u = CG._smUnion(prev, next);
A("an archive-only reload keeps the EA-only sittings", u.length === 2 && u.some((s) => s.matchId === "E2"));
A("...and keeps the pickup door on a sitting EA still lists", u.find((s) => s.matchId === "E1").source === "both" && u.find((s) => s.matchId === "E1").canPickup === true);

auth.user.id = "gm-pit";
A("Rule 7.1: a GM of a club in the game is involved", CG._smInvolved(g("f1")) === "PIT");
auth.user.id = "u1";
A("...anyone else is not", CG._smInvolved(g("f1")) === null);
CG.me = () => ({ team:"SEA" });
A("...nor is a player of a club not in the game, but a player of one in it is", CG._smInvolved(g("f1")) === null && CG._smInvolved(g("h1")) === "SEA");
CG.me = () => null;

let pg = CG._smPickerGames("fix", { q:"", nights:2 });
A("the correction picker shows finals only, two nights by default", pg.nights.length === 2 && pg.nights.every((n) => n.games.every((x) => x.status === "final")));
pg = CG._smPickerGames("ff", { q:"", nights:2 });
A("the forfeit picker shows any game but a voided one, tonight first", pg.nights[0].games.some((x) => x.id === "s1") && !pg.nights.some((n) => n.games.some((x) => x.id === "v1")) && pg.more === true);
pg = CG._smPickerGames("ff", { q:"pit oct 28", nights:2 });
A("a search reaches any game this season by clubs and date", pg.nights.length === 1 && pg.nights[0].games.map((x) => x.id).join() === "f1");
pg = CG._smPickerGames("fix", { q:"dal", nights:2 });
A("...newest 30 at most, nearest to today first", pg.capped === true && pg.nights.reduce((s2, n2) => s2 + n2.games.length, 0) === 30 && pg.nights.some((n2) => n2.games.some((x) => x.id === "f1")));
A("the night header carries the date and the week", /^Last night · Wed, Oct 28 · Week 6$/.test(CG._smPickerGames("fix", { q:"", nights:1 }).nights[0].label));
A("one make-up game never labels its whole night (it is marked on its own row)", CG._smPickerGames("fix", { q:"", nights:1 }).nights[0].label === "Last night · Wed, Oct 28 · Week 6" &&
  /\(CG\.isMakeUp && CG\.isMakeUp\(g\) \? '<small>Make-up<\/small>' : ''\)/.test(live) && !/g\.rescheduledFrom \?/.test(desk));
A("scores read away first, from the home-first answers", CG._smScoreText("DAL", "PIT", 2, 3) === "DAL 2, PIT 3" && CG._smHA("3-2").h === 3 && CG._smHA("3-2").a === 2);
A("club names read in full", CG._smName("DAL") === "Dallas Stars" && CG._smName("SEA") === "SEA");

console.log("\n— the changelog");
{
  const line = R("src/live/part3_content.js");
  const e = (JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1)).rulebook.changelog || []).find((c) => c.version === "4.36");
  A("the 4.36 entry exists", !!e);
  const txt = e ? e.summary + " " + e.items.join(" ") : "";
  A("...in plain words: the search, the merge, the order, the pickers", /Find a game on EA/.test(txt) && /merge/i.test(txt) && /above/.test(txt) && /Forfeit a game/.test(txt) && /Correct a filed result/.test(txt));
  A("...house style: no dashes as punctuation", !/[–—]| - /.test(txt));
}

console.log(`\n${ok ? "PASS" : "FAIL"} ${pass}/${n}`);
process.exit(ok ? 0 : 1);
