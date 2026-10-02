/* v3.79: the league office is held to no clock in a club's Team HQ (Rule 2.6). Commissioner, 2026-10-02: "The freeze
   should remain for regular team managers, but commissioners viewing each team's Team HQ should be able to freely use
   any function." And the same day: "it's asking me to swap a tc player for a roster player when the team I am looking
   at is below the maximum roster requirement" (a position group was full; the button said "Roster full").
   Part 1 runs the client rules that decide (the swap reason, the sheet's close, the night plan); part 2 pins the
   client wiring; part 3 pins the database record, the bot's notice style and the rulebook. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const hub = R("src/live/part6_hub.js"), live = R("src/live/part_live.js"), pub2 = R("src/live/part5b_public2.js");
const sql = R("sql/2026-10-02-office-time-locks-v379.sql"), bot = R("bot/club-notices.mjs"), content = R("src/live/part3_content.js");
const grab = (src, start) => { const i = src.indexOf(start); if (i < 0) return null; const j = src.indexOf("\n};", i); return src.slice(i, j + 3); };

console.log("— the swap says which group is full, or that camp is");
const ctx = { CG: {} };
vm.createContext(ctx);
vm.runInContext("var CG = this.CG;" + grab(hub, "CG.squadSwapWhy = function") + grab(hub, "CG.posGroup = function").split("\n")[0], ctx);
const C = ctx.CG;
Object.assign(C, { ROSTER_QUOTA: { F: 7, D: 5, G: 3 }, ROSTER_MAX: 15, CAMP_MAX: 10, GROUP_NAME: { F: "Forwards", D: "Defensemen", G: "Goaltenders" },
  isWaived: () => false, spotOutsideShape: (x) => x.origin === "preseason_random" });
const row = (pos, squad, i) => ({ id: pos + squad + i, spotId: "s" + pos + squad + i, pos, squad });
/* VAN today: 6 F, 5 D, 3 G active (14 of 15), a goaltender and a defenseman in camp */
const van = [].concat([0,1,2,3,4,5].map((i) => row("C", "pro", i)), [0,1,2,3,4].map((i) => row("LD", "pro", i)), [0,1,2].map((i) => row("G", "pro", i)),
  [row("G", "tc", 9), row("LD", "tc", 9)]);
C.lg = { byTeam: { VAN: van } };
const whyD = C.squadSwapWhy("VAN", row("LD", "tc", 9));
A("a camp defenseman with defense full: names the group and its count", /^Defensemen are full: 5 of 5 on the active roster\./.test(whyD), whyD);
A("...and says the roster as a whole is under its total, which is what misled", /The roster as a whole has 14 of 15, but each position group has its own limit\./.test(whyD), whyD);
A("...and what the swap does", /sending a defenseman to training camp in the same move \(Rule 2\.1\)/.test(whyD), whyD);
A("a camp goaltender: goaltenders, 3 of 3", /^Goaltenders are full: 3 of 3/.test(C.squadSwapWhy("VAN", row("G", "tc", 9))));
const full15 = [].concat([0,1,2,3,4,5,6].map((i) => row("C", "pro", i)), [0,1,2,3,4].map((i) => row("LD", "pro", i)), [0,1,2].map((i) => row("G", "pro", i)), [row("RW", "tc", 9)]);
C.lg = { byTeam: { X: full15 } };
A("a full roster says no 'as a whole' line", !/as a whole/.test(C.squadSwapWhy("X", row("RW", "tc", 9))));
const loans = [].concat([0,1,2,3,4,5,6].map((i) => row("C", "pro", i)), [Object.assign(row("C", "pro", 8), { origin: "preseason_random" })]);
C.lg = { byTeam: { L: loans } };
A("a pre-season loan is not counted against the group", /7 of 7/.test(C.squadSwapWhy("L", row("RW", "tc", 1))));
const camp10 = [row("C", "pro", 0)].concat([0,1,2,3,4,5,6,7,8,9].map((i) => row("RW", "tc", i)));
C.lg = { byTeam: { BOS: camp10 } };
A("a send-down with camp full: training camp, 10 of 10", /^Training camp is full: 10 of 10\./.test(C.squadSwapWhy("BOS", row("C", "pro", 0))));
/* SEA, 2026-10-02 (review): 8 F / 5 D / 2 G = 15 of 15. The goaltender group has room, the roster as a whole does not:
   a plain call-up was offered and check_roster_structure refused it at commit. The legal move is a goaltender swap. */
const sea = [].concat([0,1,2,3,4,5,6,7].map((i) => row("C", "pro", i)), [0,1,2,3,4].map((i) => row("LD", "pro", i)), [0,1].map((i) => row("G", "pro", i)), [row("G", "tc", 9)]);
C.lg = { byTeam: { SEA: sea } };
const sqSrc = hub.slice(hub.indexOf("function squadRoom(club, p){"), hub.indexOf("\n}\n", hub.indexOf("function squadRoom(club, p){")) + 2);
vm.runInContext(sqSrc + "\nCG.__squadRoom = squadRoom;", ctx);
A("a camp goaltender at a full total gets no plain call-up (the database would refuse it)", C.__squadRoom("SEA", row("G", "tc", 9)) === false);
A("...and the reason names the full total, with the group's room", /^The active roster is full: 15 of 15\. Goaltenders have room \(2 of 3\)/.test(C.squadSwapWhy("SEA", row("G", "tc", 9))), C.squadSwapWhy("SEA", row("G", "tc", 9)));
C.lg = { byTeam: { VAN: van } };
A("a group with room under the total still gets a plain call-up", (C.lg.byTeam.VAN = van.filter((x) => x.id !== "Gpro2"), C.__squadRoom("VAN", row("G", "tc", 9))) === true);

console.log("— the sheet's close and the night plan, for a club and for the office");
const ctx2 = { CG: {} }; vm.createContext(ctx2);
const ec = pub2.match(/CG\.gameUnderWay = function[^\n]*\n/)[0] + pub2.match(/CG\.emergencyClosed = function[^\n]*\n/)[0];
const dress = hub.match(/CG\.lcDressable = function[^\n]*\n/)[0];
vm.runInContext("var CG = this.CG;" + ec + dress, ctx2);
const D = ctx2.CG, AT = 1_000_000_000_000, MIN = 60000;
D.now = () => AT + 20 * MIN;     /* twenty minutes after puck drop */
D.role = () => "manager";
A("a club's sheet is closed ten minutes after puck drop", D.emergencyClosed({ at: AT }) === true);
A("...and its night plan stops at the lock", D.lcDressable({ at: AT }) === false && (D.now = () => AT - 31 * MIN, D.lcDressable({ at: AT }) === true));
D.now = () => AT + 20 * MIN; D.role = () => "commish";
A("the office's sheet never closes while the game is scheduled", D.emergencyClosed({ at: AT }) === false);
A("...but no bulk tool of the office reaches a game being played (review, 2026-10-02)", D.lcDressable({ at: AT }) === false);
D.now = () => AT - 5 * MIN;
A("...while the office's night plan still dresses a game past its lock and not yet under way", D.lcDressable({ at: AT }) === true && D.emergencyClosed({ at: AT }) === false);
A("bulk withdrawal is bounded on the same instant", /\? CG\.nightGames\(club, nightKey\)\.filter\(function\(g\)\{ return !CG\.gameUnderWay\(g\); \}\)/.test(hub));
A("the builder tells the office a game is under way, and offers no whole-night filing then", /var underWay = CG\.gameUnderWay\(game\);/.test(hub) && /if \(underWay\) return "";/.test(hub) && /<b>Game under way\.<\/b> As the league office you can still change this sheet/.test(hub));
A("the code box before release says the clubs do not have it yet", /Releases to the two clubs at '\+CG\.fmtTime\(CG\.codeReleaseAt\(g\)\)\+'\. You see it now as the league office\./.test(pub2));

console.log("— client wiring");
A("lcOpenGames reads lcDressable", /CG\.lcOpenGames = function\(club, nightKey\)\{\n  return CG\.nightGames\(club, nightKey\)\.filter\(CG\.lcDressable\);/.test(hub));
A("the night plan rows and Dress the week read it too", /var open = games\.filter\(CG\.lcDressable\);/.test(hub) && /CG\.lcOpenGames\(club, n\.key\)\.length > 0/.test(hub));
A("the whole-night filing is open to the office after the lock", /var wholeNight = \(!emg \|\| CG\.role\(\)==="commish"\)/.test(hub) && /\.filter\(CG\.lcDressable\)\n            : \[game\];/.test(hub));
A("server picks stay open to the office after the lock, with the server in force named", /var officeLate = CG\.now\(\) >= lockAt && CG\.role\(\)==="commish";/.test(hub) && /if \(CG\.now\(\) >= lockAt && !officeLate\)\{/.test(hub) && /data-srv-of="/.test(hub));
A("a late save reads the re-settled server back and fails loud", /CG\.sb\.rpc\("resolve_game_server", \{ p_game:gameId \}\)/.test(hub) && /Saved, but the server could not be read back/.test(hub));
A("minimum service is the club's, not the office's", /var mv = \(CG\.role\(\)!=="commish" && CG\.canMovePlayer\) \? CG\.canMovePlayer\(p\) : null;/.test(hub));
A("the office renumbers in a preview whatever seat is mirrored", /var canEditNum = \(CG\.role\(\)==="commish" && !!\(CG\.previewClub && CG\.previewClub\(\)\)\)/.test(hub));
A("a suspended player is locked for the club, not the office", /if \(sus && CG\.role\(\)!=="commish"\)\{/.test(hub) && /the league office can\. '\+title;/.test(hub));
A("the swap button carries the reason, not 'Roster full'", /data-squad-swap="'\+p\.spotId\+'" title="'\+esc\(CG\.squadSwapWhy\(club, p\)/.test(hub) && !/title="Roster full/.test(hub));
A("the swap dialog says it too", /esc\(CG\.squadSwapWhy \? CG\.squadSwapWhy\(club, me\)/.test(live) && !/Your roster is full, so this is a straight swap/.test(live));
A("a refused swap re-enables the dialog", /if \(r\.error\)\{ swapBtn\.disabled = false; CG\.toast\(r\.error\.message, "err"\); return; \}/.test(live) && /function\(e\)\{ swapBtn\.disabled = false; CG\.toast\("Couldn’t swap/.test(live));
/* review, 2026-10-02: an insert's RETURNING is the row as inserted ("pending"); the trigger approves it after, so re-read */
A("an office nomination reads its decided status back after the insert", !/r\.data\[0\]\.status/.test(grab(live, "CG.submitMgmtApp = function"))
  && /CG\.sb\.from\("management_applications"\)\.select\("status,seat_block"\)\.eq\("id", r\.data\[0\]\.id\)\.maybeSingle\(\)/.test(live) && /m\.isOffice \? "Appoint" : "Submit nomination"/.test(live));
A("a suspended counterpart is not offered to a club in the swap picker", /!\(CG\.role\(\)!=="commish" && CG\.suspensionOf && CG\.suspensionOf\(x\.id\)\)/.test(live));
A("the Depth chip no longer says he never counts against the shape", !/never counts against the 9\/6\/3 shape/.test(hub) && /counts toward the '\+CG\.ROSTER_QUOTA\.F\+' F/.test(hub));
A("the extension window is the club's (never in basic)", /var winOpen = CG\.extensionWindowOpen\(\) \|\| \(CG\.role\(\)==="commish" && !CG\.isBasic\(\)\);/.test(live));
A("the office picks while the draft is paused, both desks", (live.match(/status==="paused" && CG\.role\(\)==="commish"/g) || []).length === 2);
A("the lobby code shows to the office as soon as it is set, both views", /\|\| CG\.role\(\)==="commish";   \/\* v3\.79: the league office reads it/.test(live) && /var released = now >= CG\.codeReleaseAt\(g\) \|\| CG\.role\(\)==="commish";/.test(pub2));

console.log("— the database record");
A("set_game_lineup: the T+10 close skips a commissioner", /interval '10 minutes' and not public\.is_commissioner\(\) then/.test(sql));
A("waive_player: minimum service only for the club", /if not public\.is_commissioner\(\) then\n    v_why := public\.can_move_player/.test(sql));
A("guard_trade_insert: reads the proposer from the row (the accept runs it again)", /public\._is_commissioner_profile\(new\.from_profile_id\)/.test(sql));
A("the extension window: one three-argument definition, the two-argument form delegates", /_extendable_contract\(p_profile uuid, p_season public\.seasons, p_office boolean\)/.test(sql)
  && /select \* from public\._extendable_contract\(p_profile, p_season, false\);/.test(sql) && /coalesce\(p_office, false\) or public\.extension_window_open/.test(sql));
A("offer_extension passes the office", /_extendable_contract\(p_profile, v_season, public\.is_commissioner\(\)\)/.test(sql));
A("respond_offer: the office acting, or the player accepting the office's own terms; never the club's GM", /v_comm or \(v_isplayer and public\._is_commissioner_profile\(o\.from_profile_id\)\)/.test(sql));
A("a club's revision of an offer makes the club its author", /last_actor='team', updated_at=now\(\), from_profile_id=auth\.uid\(\) where id=o\.id;/.test(sql));
A("an office nomination is decided in its own insert, or refused", /apply_application_decision\('management', new\.id, true\)/.test(sql) && /if v_status is distinct from 'approved' then\n      raise exception/.test(sql));
A("a late office server pick re-settles and tells both clubs", /create trigger office_late_server_pick_trg after insert or update on public\.game_vetoes/.test(sql)
  && /update public\.games set server = null where id = new\.game_id;\n  v_new := public\.resolve_game_server\(new\.game_id\);/.test(sql) && /club_notify\(v_t, 'schedule'/.test(sql) && /'server_resettled'/.test(sql));
A("nothing new is the API's", /revoke all on function public\._is_commissioner_profile\(uuid\) from public, anon, authenticated;/.test(sql)
  && /revoke all on function public\.office_late_server_pick\(\) from public, anon, authenticated;/.test(sql)
  && /revoke all on function public\._extendable_contract\(uuid, public\.seasons\) from public, anon, authenticated;/.test(sql));
A("every patch must match exactly once", /the text to patch is not there exactly once/.test(sql));
A("the record says it was rehearsed and applied", /REHEARSED 2026-10-02/.test(sql) && /APPLIED 2026-10-02/.test(sql));

console.log("— the bot's notice and the rulebook");
A("a schedule notice has its own style and links the schedule desk", /schedule: \{ colour: 0x1C7ED6, icon: "🖥️" \}/.test(bot) && /row\.kind === "schedule" \? "schedule"/.test(bot));
global.CG = {}; vm.runInThisContext(content);
const rb = CG.CONTENT.rulebook, sec = (id) => rb.chapters.flatMap((c) => c.sections || []).find((s) => s.id === id);
A("Rule 2.6: no clock binds the office; structure still does", /No clock binds the league office in a club's Team HQ\./.test(sec("2.6").paragraphs[6]) && /What a roster may hold is not a clock/.test(sec("2.6").paragraphs[6]));
A("...the extension clause only where extensions exist (full format)", !/extension window/.test(sec("2.6").paragraphs[6]) && /extension window opens/.test(sec("2.6").full[6]));
A("...and the office's nomination takes effect at once", /one the league office makes takes effect at once/.test(sec("2.6").paragraphs[0]));
A("Rules 2.4, 4.2, 5.3 and 7.2 say the office's exemption", /may waive or trade a player short of it/.test(sec("2.4").paragraphs.join(" "))
  && /The league office may still change a club's picks after it/.test(sec("4.2").paragraphs.join(" "))
  && /The league office may still file or change a club's sheet after that/.test(sec("5.3").paragraphs.join(" "))
  && /The lock binds the club; the league office may move him/.test(sec("7.2").paragraphs.join(" ")));
const i79 = rb.changelog.findIndex((c) => c.version === "3.79"), e79 = rb.changelog[i79];
A("changelog records 3.79, right after 3.78", i79 >= 0 && rb.changelog[i79 + 1].version === "3.78");
const newText = [sec("2.6").paragraphs[6], sec("2.6").full[6]].concat(e79.items, [e79.summary]).join(" ");
A("no em dashes or spaced hyphens in the new text", !/—|–| - /.test(newText.replace(/[^.]*—[^.]*\(the last paragraph of this rule\)/, "")));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
