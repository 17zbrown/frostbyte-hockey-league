/* v3.88: the final five minutes of the third period (Rule 4.3.6). Commissioner, 2026-10-07: "Can you add to the lag out
   rules that any disconnects after 5 minutes remaining in the 3rd period is to finish out the game with no reloading?
   Make sure to have the api track any points from the players that lag out as well if possible." Overtime keeps its
   reload ("No, keep the OT reload"). "The only reason a game would end early is if someone either lagged out
   individually or if they manually quit." And when a drop ends the game anyway: "Reload the time left, usual penalty."
   EA (the archive): a skater who drops usually leaves the session running, his line kept and flagged player_dnf; a
   goaltender who drops ends it (all 17 archived goalie drops). This RUNS the importer's own normalizeMatch,
   mergeSegments, segElapsed, gameClock, stopCause, finalStretchHold and sittingsState on games shaped like the real ones
   (lxlantlxi, Oct 7: player_dnf "1", 3202 of 3600 seconds, a goal; wyd_stepsis12: a goalie drop that ended the session),
   and pins the hold paths, the officials' notices, the book and the changelog. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", "netlify/functions/ingest-stats.js"), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 260))); } };
const fn = (name) => { const i = src.indexOf("function " + name + "("); return src.slice(i, src.indexOf("\n}\n", i) + 2); };
const line = (re) => { const m = src.match(re); if (!m) throw new Error("missing " + re); return m[0] + "\n"; };
const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const lib = new Function("etFmt",
  "const etDayUnix = (s) => etFmt.format(new Date(s * 1000));\nconst REGULATION_S = 3600;\n" +
  line(/const THIRD_START_S = \d+;/) + line(/const FINAL_STRETCH_S = \d+;/) + line(/const CLOCK_SLACK_S = \d+;/) +
  line(/const FINAL_STRETCH_FROM_MS = Date\.parse\("[^"]+"\);/) + line(/const inFinalStretch = .*;/) + line(/const clockLeft = .*;/) +
  line(/const finalStretchApplies = .*;/) +
  fn("mapPos") + fn("normalizeMatch") + fn("mergeSegments") + fn("segElapsed") + fn("gameClock") + fn("stopCause") +
  fn("finalStretchHold") + fn("sittingsState") +
  "\nreturn { normalizeMatch, mergeSegments, segElapsed, gameClock, stopCause, finalStretchHold, sittingsState, inFinalStretch, clockLeft, finalStretchApplies, FINAL_STRETCH_S, CLOCK_SLACK_S };")(etFmt);

/* a game between clubs 100 and 200. EA's player id is the player's, the same in every sitting: key it on the name */
const P = (name, pos, toi, g = 0, a = 0, dnf = false) => ({ playername: name, position: pos, toiseconds: String(toi),
  skgoals: String(g), skassists: String(a), player_dnf: dnf ? "1" : "0" });
const game = (id, ts, scores, home, away, o = {}) => ({ matchId: id, timestamp: ts,
  clubs: { "100": { score: String(scores[0]), result: scores[0] > scores[1] ? "1" : "2", winnerByDnf: o.dnf200 ? "1" : "0", winnerByGoalieDnf: o.gdnf200 ? "1" : "0", gfraw: o.gf100 != null ? String(o.gf100) : undefined },
           "200": { score: String(scores[1]), result: scores[1] > scores[0] ? "1" : "2", winnerByDnf: o.dnf100 ? "1" : "0", winnerByGoalieDnf: o.gdnf100 ? "1" : "0", gfraw: o.gf200 != null ? String(o.gf200) : undefined } },
  players: { "100": Object.fromEntries(home.map((p) => ["ea-" + p.playername, p])), "200": Object.fromEntries(away.map((p) => ["ea-" + p.playername, p])) } });
const club = (m, id) => m.clubs.find((c) => c.ea_club_id === id);
const who = (m, id, name) => club(m, id).players.find((p) => p.gamertag === name);
const side = (pfx, toi, goals, flags = {}) => ["center", "leftWing", "rightWing", "defenseMen", "defenseMen", "goalie"].map((pos, i) =>
  P(pfx + i, pos, flags.toi && flags.toi[i] != null ? flags.toi[i] : toi, goals[i] || 0, 0, !!(flags.dnf && flags.dnf[i])));
const OCT8 = { scheduled_at: "2026-10-09T01:00:00Z" }, OCT7 = { scheduled_at: "2026-10-08T01:00:00Z" };   // Thu 9 PM ET; Wed 9 PM ET

console.log("— a skater drops in the final five minutes and the game plays on");
/* home leads 3-2: the dropped center scored before he left at 53:22; a second home goal came after he left and no
   player holds it (scored in his place), so EA's official 3 is one more than the players' 2 */
const homeSide = [P("Dropper", "center", 3202, 1, 0, true), P("Wing", "leftWing", 3600, 0, 1), P("Wing2", "rightWing", 3600, 1, 0),
  P("D1", "defenseMen", 3600), P("D2", "defenseMen", 3600, 0, 1), P("G", "goalie", 3600)];
const awaySide = [P("A1", "center", 3600, 1, 1), P("A2", "leftWing", 3600, 1, 0), P("A3", "rightWing", 3600, 0, 1),
  P("A4", "defenseMen", 3600), P("A5", "defenseMen", 3600), P("AG", "goalie", 3600)];
const played = lib.normalizeMatch(game("M1", 1759885000, [3, 2], homeSide, awaySide));
A("the player who dropped keeps his line, with the goal he scored before he left", who(played, "100", "Dropper").goals === 1, who(played, "100", "Dropper"));
A("...his time on ice stops where he left (53:22), and EA's flag rides along", who(played, "100", "Dropper").time_on_ice_seconds === 3202 && who(played, "100", "Dropper").left_early === true && who(played, "100", "Wing").left_early === false);
A("the score is EA's official 3, counting the goal scored in his place", club(played, "100").score === 3 && club(played, "200").score === 2);
A("...that goal is credited to no player, and the statistics desk hears about it", club(played, "100").unattributed === 1 && /await noteUnattributed\(game, homeClub, awayClub, summary\)/.test(src));
const stPlayed = lib.sittingsState([played]);
A("it ran the full clock, so it files at once: nothing held, nothing waits for a reload", stPlayed.finished === true && !stPlayed.wentOt && lib.finalStretchHold(OCT8, stPlayed) === null, stPlayed);

console.log("— a goaltender drops in the final five minutes and EA ends the game");
/* the away goalie leaves at 57:00 and the session ends there for everyone; EA gives home winnerByGoalieDnf */
const gStop = lib.normalizeMatch(game("M2", 1759885000, [3, 0], side("H", 3420, [1, 1, 0]), side("V", 3420, [1, 1], { dnf: [0, 0, 0, 0, 0, 1] }), { gdnf200: true, gf100: 2, gf200: 2 }));
const stG = lib.sittingsState([gStop]);
A("the sitting is not a result", stG.finished === false && stG.reachedFull === false);
A("stopCause reads it from EA's flags: the goaltender, at the final clock", JSON.stringify(lib.stopCause(gStop)) === JSON.stringify({ kind: "goalie", club: "200", who: "V5" }), lib.stopCause(gStop));
const fG = lib.finalStretchHold(OCT8, stG);
A("held for the reload of the time left, with the usual penalty: not an office matter", fG && fG.office === false && /the goaltender \(V5\) disconnected with 3:00 left in the third and EA ended the game: waiting for the reload of the time left, with the usual penalty \(Rule 4\.3\.6\)/.test(fG.why), fG);
A("the score of a disconnected sitting is EA's raw count, 2-2, never the 3-0 placeholder", club(gStop, "100").score === 2 && club(gStop, "200").score === 2);
/* the reload of the time left, ended by hand on a fast clock */
const reload = (secs, hg, ag, ts = 1759886000) => lib.normalizeMatch(game("R" + secs, ts, [hg, ag], side("H", secs, [hg]), side("V", secs, [ag]), { gf100: hg, gf200: ag }));
const r190 = lib.sittingsState([gStop, reload(190, 1, 0)]);
A("a reload that runs ten seconds past sixty minutes and is won by a goal is a regulation win, not an overtime", r190.finished === true && r190.wentOt === false && r190.lateReload === true && r190.total === 3610, r190);
const r170 = lib.sittingsState([gStop, reload(170, 1, 0)]);
A("a reload ended ten seconds short of sixty minutes still finishes regulation", r170.finished === true && r170.total === 3590 && !r170.wentOt, r170);
const r1200 = lib.sittingsState([gStop, reload(1200, 2, 0)]);
A("a reload that played a whole period instead of the time left is not given the slack: overlong, flagged", r1200.lateReload === false && r1200.overlong === true, r1200);
A("the slack is a minute either side", lib.CLOCK_SLACK_S === 60);
/* EA often flags a second player at the moment a goaltender's drop ends the game (5 of 16 archived): its club flag decides */
const gTwo = lib.normalizeMatch(game("M2b", 1759885000, [3, 0], side("H", 3420, [1, 1]), side("V", 3420, [1, 1], { dnf: [0, 1, 0, 0, 0, 1], toi: [3420, 3418, 3420, 3420, 3420, 3420] }), { gdnf200: true, gf100: 2, gf200: 2 }));
A("a goalie drop with a skater flagged at the same moment is still the goaltender's (EA's winnerByGoalieDnf)", lib.stopCause(gTwo).kind === "goalie" && lib.stopCause(gTwo).who === "V5", lib.stopCause(gTwo));
A("...so it waits for the reload of the time left, not the office", lib.finalStretchHold(OCT8, lib.sittingsState([gTwo])).office === false);
/* the slack is granted once: an overtime after a reload that used it is read as an overtime */
const lvlStop = lib.normalizeMatch(game("L1", 1759885000, [2, 2], side("H", 3420, [2]), side("V", 3420, [2], { dnf: [0, 0, 0, 0, 0, 1] }), { gdnf200: true, gf100: 2, gf200: 2 }));
const handEnd = (secs, hg, ag, ts) => lib.normalizeMatch(game("HE" + secs + ts, ts, [hg, ag], side("H", secs, [hg], { dnf: [1, 1, 1, 1, 1, 1] }), side("V", secs, [ag], { dnf: [1, 1, 1, 1, 1, 1] }), { gf100: hg, gf200: ag }));
const lvl170 = lib.sittingsState([lvlStop, handEnd(170, 0, 0, 1759886000)]);
A("a reload ended by hand 10 seconds short and still level completes regulation: overtime is next", lvl170.reachedFull && lvl170.level && !lvl170.finished, lvl170);
const otAfter = lib.sittingsState([lvlStop, handEnd(170, 0, 0, 1759886000), reload(45, 1, 0, 1759887000)]);
A("...and the 45-second overtime that follows is an overtime result, not a regulation win", otAfter.finished && otAfter.wentOt === true && otAfter.lateReload === false, otAfter);
/* a reload cut short by ANOTHER game-ending drop is not given the short slack: the 50 seconds left are reloaded again */
const cutShort = lib.normalizeMatch(game("C1", 1759886000, [0, 1], side("H", 130, []), side("V", 130, [1], { dnf: [0, 0, 0, 0, 0, 1] }), { gdnf100: true, gf100: 0, gf200: 1 }));
const stCut = lib.sittingsState([lvlStop, cutShort]);
A("a reload cut short by another goalie drop is held for the time still left", stCut.total === 3550 && !stCut.finished && lib.finalStretchHold(OCT8, stCut).office === false && /0:50 left/.test(lib.finalStretchHold(OCT8, stCut).why), stCut);

console.log("— a game stops in the final five minutes with no game-ending drop (the league office rules)");
const left = lib.normalizeMatch(game("M3", 1759885000, [2, 3], side("H", 3450, [1, 1], { dnf: [1, 1, 1, 1, 1, 1] }), side("V", 3450, [1, 1, 1]), { dnf200: true, gf100: 2, gf200: 3 }));
const fL = lib.finalStretchHold(OCT8, lib.sittingsState([left]));
A("a whole club flagged at once: it left the game", lib.stopCause(left).kind === "club_left" && lib.stopCause(left).club === "100");
A("...held for the league office, said as a stop to rule on, not a finding", fL && fL.office === true && /stopped with 2:30 left in the third when a club left the game: a disconnection in the final five minutes is played out, so the league office rules on it \(Rule 4\.3\.6\)/.test(fL.why), fL);
const none = lib.normalizeMatch(game("M4", 1759885000, [1, 1], side("H", 3500, [1]), side("V", 3500, [1])));
const fN = lib.finalStretchHold(OCT8, lib.sittingsState([none]));
A("nobody flagged: also the office's, and says so", lib.stopCause(none).kind === "unknown" && fN && fN.office === true && /with no disconnection flagged/.test(fN.why), fN);
A("the officials hear about it the same night, from every hold path", /if \(fsh && fsh\.office\) await noteFinalStretch\(game, "stopped", fsh, homeScore, awayScore, summary\);/.test(src)
  && /if \(fshR && fshR\.office\) await noteFinalStretch\(cand, "stopped", fshR, hC\.score, aC\.score, summary\);/.test(src)
  && /else if \(fshM && fshM\.office\) await noteFinalStretch\(cand, "stopped", fshM, homeClub\.score, awayClub\.score, summary\);/.test(src));
A("a club's single-sitting attach gives the same reason", /const fshL = st\.finished \? null : finalStretchHold\(game, st\);/.test(src) && /\? `Held: \$\{fshL\.why\}\.`/.test(src));
A("a reload after such a stop is combined as played but NOT published: the office rules first",
  /const officeHold = !!priorHold;/.test(src) && /if \(\(!st\.finished \|\| officeHold\) && cand\.status !== "final"\) \{/.test(src)
  && /if \(officeHold\) await noteFinalStretch\(cand, "reload", priorHold, homeClub\.score, awayClub\.score, summary\);/.test(src));
A("an office hold sticks: any earlier point at which the game stopped for the office keeps it held",
  /for \(let i = 1; i <= priorSorted\.length && !priorHold; i\+\+\) \{\s+const h = finalStretchHold\(cand, sittingsState\(priorSorted\.slice\(0, i\)\)\);\s+if \(h && h\.office\) priorHold = h;/.test(src));
const note = fn("noteFinalStretch");
A("the officiating desk gets a durable bell, the Discord post is the courtesy", /await sbRpc\("notify_department", \{ p_dept: "officiating", p_type: "flag"/.test(note) && /p_view: "game", p_param: game\.id/.test(note));
A("the notice hedges (a drop just before the final five minutes reaching its whistle inside them looks the same)", /If the disconnection came before the final five minutes, a reload is due as usual/.test(note) && !/a club quit/i.test(src));
A("the notice can never fail an import", /try \{ await tellStaff\(text\); \} catch \(e\)/.test(note) && /catch \{ \/\* the names are a courtesy \*\/ \}/.test(note));

console.log("— the clock, and when the rule starts");
A("5:00 left (55:00) is inside the final five minutes; 5:01 left is not; a full game is not a stop", lib.inFinalStretch(3300) && !lib.inFinalStretch(3299) && !lib.inFinalStretch(3600) && lib.FINAL_STRETCH_S === 300);
A("clock left reads minutes and seconds", lib.clockLeft(3420) === "3:00" && lib.clockLeft(3555) === "0:45");
const early3 = lib.normalizeMatch(game("E1", 1759880000, [1, 1], side("H", 2640, [1]), side("V", 2640, [1]), { dnf200: true, gf100: 1, gf200: 1 }));
const e3stop = lib.normalizeMatch(game("E2", 1759881500, [0, 0], side("H", 660, []), side("V", 660, []), { dnf200: true, gf100: 0, gf200: 0 }));
A("after a stop early in the third, the reload replays the whole third: 44:00 then 11:00 of the replay is 51:00, not 55:00", lib.gameClock([early3, e3stop]) === 3060 && lib.finalStretchHold(OCT8, lib.sittingsState([early3, e3stop])) === null);
const e3full = lib.sittingsState([early3, lib.normalizeMatch(game("E3", 1759881500, [1, 0], side("H", 1200, [1]), side("V", 1200, []), { gf100: 1, gf200: 0 }))]);
A("...so the replayed third ends regulation at sixty minutes: a one-goal win there is not read as an overtime", e3full.total === 3600 && e3full.finished && !e3full.wentOt, e3full);
const lvl = lib.normalizeMatch(game("O1", 1759880000, [2, 2], side("H", 3600, [2]), side("V", 3600, [2]), { gf100: 2, gf200: 2 }));
const ot = lib.sittingsState([lvl, lib.normalizeMatch(game("O2", 1759881500, [1, 0], side("H", 120, [1]), side("V", 120, []), { gf100: 1, gf200: 0 }))]);
A("the overtime reload is unchanged: level at sixty, decided in the reload, an overtime result", ot.finished && ot.wentOt === true && ot.lateReload === false, ot);
A("games before Thursday, October 8 were played under the old rule: no final-five handling", lib.finalStretchApplies(OCT7) === false && lib.finalStretchApplies(OCT8) === true && lib.finalStretchHold(OCT7, stG) === null);

console.log("— a merge still credits a dropped player across sittings");
const s1 = lib.normalizeMatch(game("S1", 1759880000, [1, 0], [P("Early", "center", 1500, 1, 0, true), P("G", "goalie", 2400)], [P("AG", "goalie", 2400)], { dnf200: true }));
const s2 = lib.normalizeMatch(game("S2", 1759881500, [1, 1], [P("G", "goalie", 1200), P("Wing", "leftWing", 1200, 1, 0)], [P("A1", "center", 1200, 1, 0), P("AG", "goalie", 1200)]));
A("the player who dropped in the first sitting keeps his goal in the combined game", who(lib.mergeSegments([s1, s2]), "100", "Early").goals === 1);
const gfLost = lib.normalizeMatch(game("G1", 1759885000, [3, 0], side("H", 3420, [1, 1]), side("V", 3420, [1, 1], { dnf: [0, 0, 0, 0, 0, 1] }), { gdnf200: true, gf100: 3, gf200: 2 }));
A("a goal scored in a dropped player's place survives a later disconnect (EA's raw count), and is reported", club(gfLost, "100").score === 3 && club(gfLost, "100").unattributed === 1, club(gfLost, "100"));

console.log("— the book");
global.CG = {}; vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src/live/part3_content.js"), "utf8"));
const rb = CG.CONTENT.rulebook, sec = (id) => rb.chapters.flatMap((c) => c.sections || []).find((x) => x.id === id), s43 = sec("4.3");
const p6 = s43.paragraphs[5];
A("4.3.1: the club leaves at the whistle unless the disconnection comes in the final five minutes", /leaves the game at the next whistle, unless the disconnection comes in the final five \(5\) minutes of the third period, in which case the game is played out instead \(Rule 4\.3\.6\)/.test(s43.paragraphs[0]));
A("4.3.5: the five-minutes-earlier penalty is for the third period before its final five minutes", /Where the disconnection occurs in the third period, before its final five minutes, the owed penalty is taken five \(5\) minutes of game clock earlier/.test(s43.paragraphs[4]));
A("4.3.6: in the final five minutes nobody leaves; no penalty", /in the final five \(5\) minutes of the third period, with five minutes or less left on the game clock, nobody leaves the game: the clubs play it out to the end of regulation/.test(p6) && /no penalty is owed/.test(p6));
A("4.3.6: those disconnections are not counted (4.3.4, 4.3.7, 4.3.10), and 4.3.10 says so too", /are not counted among the club's disconnections under this rule \(Rules 4\.3\.4, 4\.3\.7 and 4\.3\.10\)/.test(p6)
  && /A disconnection in the final five minutes of the third period that the game plays through is not counted \(Rule 4\.3\.6\)\./.test(s43.paragraphs[9]));
A("4.3.6: the player's points before they dropped are theirs; nothing after", /Everything the player recorded before they dropped stands, and the league's import credits it to them/.test(p6) && /nothing that happens in their place after they leave is credited to them/.test(p6));
A("4.3.6: a drop that ends the game is reloaded for the time left, with the usual penalty, and counted", /Where the disconnection ends the game itself, as a goaltender's always does in EA, the clubs reload and play only the time that was left on the game clock, and the disconnecting club takes its owed penalty or penalties as soon as possible after puck drop; that disconnection is counted like any other that causes a reload\./.test(p6));
A("4.3.6: a stop with no disconnection behind it is held for the league office, and 4.3.9 if a club moves on", /A game that stops in those five minutes with no disconnection behind it, such as a club leaving it, is held for the league office, which rules on it from the clubs' reports/.test(p6) && /unfinished game under Rule 4\.3\.9/.test(p6));
A("4.3.6: the reload of the time left is accepted within a minute either side of sixty", /so the league's import accepts it as completing regulation when it lands within a minute either side of sixty minutes; a game level at that point goes to overtime as below/.test(p6));
A("4.3.6: a disconnection just before the final five is dealt with as usual, even when its whistle falls inside them", /A disconnection that came before the final five minutes is dealt with as usual, under Rules 4\.3\.2 and 4\.3\.5, even when its whistle falls inside them\./.test(p6));
A("4.3.6: the date it starts", /These provisions govern games played from October 8, 2026\./.test(p6));
A("4.3.6: overtime keeps its reload, and the early-third period reload is unchanged", /A disconnection in overtime is dealt with the same way as one early in the third: the clubs reload and play the first period of the new game as sudden-death overtime/.test(p6)
  && /within the first five \(5\) minutes of the third period, the clubs do not replay a full game/.test(p6));
A("the paragraphs did not move (4.3.7 is still the third-disconnection forfeit, 4.3.9 the unfinished game)", s43.paragraphs.length === 10
  && /A third disconnection by the same club in the same game ends the game as a forfeit loss/.test(s43.paragraphs[6]) && /A game that is left unfinished is abandoned once either club plays a different opponent/.test(s43.paragraphs[8]));
A("6.2: a disconnected sitting's score is EA's raw count of the goals", /Only where a disconnection leaves EA's score a placeholder is the score taken from EA's raw count of the goals, which matches the goals the players scored and also counts a goal no player holds/.test(sec("6.2").paragraphs[0]));
const cl = rb.changelog.find((c) => c.version === "3.88");
A("changelog 3.88: the rule, the game-ending exception, the points, and when it starts", !!cl && /Rule 4\.3\.6/.test(cl.summary) && /reload the time left/.test(cl.summary) && cl.items.some((i) => /Thursday, October 8/.test(i)) && cl.items.some((i) => /as a goaltender's always does in EA/.test(i)) && cl.items.some((i) => /with no disconnection behind it/.test(i)), cl && cl.summary);
A("no em dash in what v3.88 added", !/—/.test(p6.slice(p6.indexOf("Where the disconnection occurs in the final five"), p6.indexOf("A disconnection in overtime"))) && !/—/.test(JSON.stringify(cl)) && !/—/.test(note) && !/—/.test(fn("finalStretchHold")) && !/—/.test(fn("stopCause")));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
