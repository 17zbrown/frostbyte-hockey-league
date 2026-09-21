/* v2.44 — availability is answered PER GAME (Available / Not Available for each of a night's three
   games, note per night), and the whole roster can see the week's set lineups.
   Run: node tools/availability-per-game.test.cjs
   Pins: the binary answer set; the form's per-game controls inside each night's section with the
   note kept; the saved shape (nights[k].games + a derived st); CG.avGame's legacy fallback (an old
   per-night answer counts for every game that night); the grid marks one cell per game; the lineup
   builder checks the exact game; the roster-wide Lineups page, nav item, route and loader. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const hub = R("src/live/part6_hub.js"), live = R("src/live/part_live.js"), content = R("src/live/part3_content.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the answer set and the form");
A("the answer set is binary: Available / Not Available", /CG\.AV_OPTS = \[ \["yes","Available"\], \["no","Not Available"\] \];/.test(hub));
A("each night's section lists the club's games with one control per game", /class="av-game"/.test(hub) && /data-night="'\+n\.key\+'" data-game="'\+esc\(g\.id\)\+'"/.test(hub));
A("the optional note per night is kept", /data-note="'\+n\.key\+'" placeholder="Optional note/.test(hub));
A("the count is in games, and Submit refuses an unanswered game", /answered\(\)\+"\/"\+TOTAL\+" game"/.test(hub) && /Answer all "\+TOTAL\+" game"/.test(hub));
A("the saved shape is per game with the night summary derived", /entry\.nights\[k\] = \{ games: games, st: st, note:/.test(hub) && /yes===ids\.length \? "yes" : yes===0 \? "no" : "part"/.test(hub));
A("the mark-all button says what it does", /id="avCopy">Mark every game available</.test(hub) && !/Copy last week/.test(hub));

console.log("— CG.avGame (the one reader every consumer goes through)");
const src = live.slice(live.indexOf("CG.avGame = function"), live.indexOf("};", live.indexOf("CG.avGame = function")) + 2);
const CG = {}; new Function("CG", src)(CG);
const perGame = { nights: { n1: { games: { g1: "yes", g2: "no" }, st: "part" } } };
A("per-game answer wins", CG.avGame(perGame, "n1", "g1") === "yes" && CG.avGame(perGame, "n1", "g2") === "no");
A("an unanswered game in an answered night is no response, not a guess", CG.avGame(perGame, "n1", "g3") === "nr");
const legacyYes = { nights: { n1: { st: "yes", note: "" } } }, legacyNo = { nights: { n1: { st: "no" } } }, legacyMaybe = { nights: { n1: { st: "late" } } };
A("a legacy per-night Available counts for every game that night", CG.avGame(legacyYes, "n1", "anything") === "yes");
A("a legacy per-night Unavailable counts for every game that night", CG.avGame(legacyNo, "n1", "anything") === "no");
A("a legacy nuanced answer reads as maybe (informational), never as out", CG.avGame(legacyMaybe, "n1", "x") === "maybe");
A("no night, no answer", CG.avGame({ nights: {} }, "n1", "g1") === "nr" && CG.avGame(null, "n1", "g1") === "nr");

console.log("— consumers");
A("the club grid marks one cell per game, oldest first", /One mark per game, in puck-drop order/.test(hub) && /games\.map\(function\(g\)\{\s*var v = CG\.avGame \? CG\.avGame\(av, nk, g\.id\)/.test(hub));
/* v2.76: availability informs, it does not bind — the bench reads the exact game's answer for its chip, and
   placing a player marked out warns instead of refusing */
A("the lineup builder reads the exact game being dressed", /var avv = avKey && CG\.avGame \? CG\.avGame\(av, avKey, game\.id\) : "nr";/.test(hub) && /function avState\(p\)\{ var nk = CG\.nightAvKey\(game\); return \(nk && CG\.avGame\) \? CG\.avGame\(CG\.avFor\(p\.id\), nk, game\.id\) : "nr"; \}/.test(hub));
A("...and a player marked out is dressable, with a warning, never refused", !/is marked not available for this game\."/.test(hub) && /dressed anyway; check that he can play/.test(hub) && /var w = avWarn\(p\); if \(w\)\{ msg\(w, true\); CG\.toast\(w, "err"\); \}/.test(hub) && /\(dis\?" dis":""\)\+\(un\?" warn":""\)/.test(hub));
A("nights carry their ET day so club games match a night", /return \{ key:"n"\+\(i\+1\), at:at, day:nightDays\[i\] \};/.test(live));
A("clubGamesOnNight and avGame are top-level (the demo and every page can reach them)", /^CG\.clubGamesOnNight = function/m.test(live) && /^CG\.avGame = function/m.test(live));

console.log("— the whole roster sees the week's lineups");
A("a Lineups item under My Hub for rostered members", /mine\.push\(\["lineups","Lineups","grid"\]\)/.test(hub));
A("the route is read-only and gated on a roster spot", /if \(section==="lineups"\) return \(CG\.can\("lineup\.viewOwn"\) && CG\.me\(\) && CG\.me\(\)\.team\) \? CG\.hubShell\("lineups", CG\.hubWeekLineups\(\)\)/.test(hub));
A("the page never guesses: Not set yet vs Loading are distinct", /row===null \? '<span class="chip chip-loss">Not set yet<\/span>' : '<span class="chip">Loading<\/span>'/.test(hub));
A("the week loader fetches every night's club games, not just tonight", /^CG\.loadMyWeekLineups = function/m.test(live) && /nights\.forEach\(function\(n\)\{ \(CG\.clubGamesOnNight/.test(live));
A("...and runs on the dashboard and the Lineups page", /if \(\(param==="lineups" \|\| param===""\) && CG\.loadMyWeekLineups\) CG\.loadMyWeekLineups\(\);/.test(hub));
A("the dashboard card tells you which games you are dressed for", /This week’s lineups/.test(hub) && /"you at "\+mySlot/.test(hub));

console.log("— rulebook");
const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" "); };
A("Rule 5.1 says the answer is per game, with a note per night", /Available or Not Available for each of the club’s games that week, with an optional note per night/.test(sec("5.1")));
A("Rule 5.3 says every rostered player can see the week's set lineups", /Every rostered player can see the club’s set lineups for the week from My Hub/.test(sec("5.3")));
const cl = rb.changelog.find((c) => c.version === "2.44");
A("changelog 2.44", !!cl && /Lineups page under My Hub/.test(cl.summary) && /answered per game/.test(cl.summary));
A("...American spelling", !/practis|colour|centre|organis|defence/i.test(cl.summary + sec("5.1") + sec("5.3")));

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
