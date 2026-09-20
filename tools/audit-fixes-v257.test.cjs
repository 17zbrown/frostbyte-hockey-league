#!/usr/bin/env node
/* v2.57 — the client half of the 2026-09-17 audit fixes (docs/audits/2026-09-17-stress-test.md).
   The database half is asserted live by tools/sql/grant-audit.sql. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const live = fs.readFileSync(path.join(root, "src/live/part_live.js"), "utf8");
const hub  = fs.readFileSync(path.join(root, "src/live/part6_hub.js"), "utf8");
const pub2 = fs.readFileSync(path.join(root, "src/live/part5b_public2.js"), "utf8");
const ui   = fs.readFileSync(path.join(root, "src/live/part4_ui.js"), "utf8");
const book = fs.readFileSync(path.join(root, "src/live/part3_content.js"), "utf8");
let fails = 0;
function A(name, cond){ console.log((cond ? "ok   " : "FAIL ") + name); if (!cond) fails++; }

console.log("— private lobby codes (P1-3): the client never asks for game_code from the games table");
{
  A("the games boot query names its columns", /CG\.sbAll\("games",CG\.GAME_PUBLIC_COLS,"scheduled_at"\)/.test(live));
  A("...and the column list has no code or server", /CG\.GAME_PUBLIC_COLS = "[^"]*"\+\n\s*"[^"]*"/.test(live) && !/GAME_PUBLIC_COLS = "[^"]*game_code/.test(live));
  A("no select(\"*\") on games anywhere in the client", !/from\("games"\)\.select\("\*"\)/.test(live + hub + pub2) && !/sbAll\("games","\*"/.test(live));
  A("codes and servers come from the masked view", /from\("games_public"\)\.select\("id,game_code,server"\)/.test(live));
  A("the schedule reads them from that view", /code:cc\.game_code\|\|null, server:cc\.server\|\|null/.test(live));
  A("the release moment is the night's first game", /CG\.codeReleaseAt = function\(g\)\{ return CG\.nightFirstAt\(g\) - 30\*60000; \}/.test(pub2));
  A("...and the matchup page uses it", /var released = now >= CG\.codeReleaseAt\(g\);/.test(pub2));
  A("...as do the hub card and the notification copy", /CG\.codeReleaseAt\(myGame\)/.test(hub) && /30 minutes before the night's first game, to the two clubs/.test(ui));
}

console.log("— the herd (P0-3): a games change is a delta rebuild, spread out");
{
  A("the boot keeps its raw results", /CG\._bootCache = q;/.test(live));
  A("a delta re-reads games and the changed game's box score only", /q\[6\] = games;[\s\S]{0,400}from\("game_stats"\)\.select\("\*"\)\.in\("game_id", ids\)/.test(live));
  A("liveReload takes the changed game and jitters 1–9 s", /CG\.liveReload = function\(opts\)\{[\s\S]{0,600}1000 \+ Math\.floor\(Math\.random\(\)\*8000\)/.test(live));
  /* v2.72: a delta (games or roster) skips the manager loads but CARRIES the manager state across the rebuilt lg */
  A("...and skips the manager/availability/trade loads on a delta", /return full \? Promise\.all\(\[CG\.loadManagerData\(\), CG\.loadAvailability\(\), CG\.loadTrades\(\)\]\) : null;/.test(live) && /if \(!full\) CG\._carryLg\(prev, lg\);/.test(live));
  A("a full reload still owes a full rebuild after a delta was queued", /else \{ CG\._liveGames = null; CG\._liveRoster = false; \}/.test(live));
  A("a roster delta re-reads roster_spots and contracts only", /if \(roster\)\{\n    var rs = await CG\.sbAll\("roster_spots","\*","id"\);/.test(live) && /CG\.liveReload\(\{ roster: true \}\);/.test(live));
}

console.log("— the basic format signs a waived player outright (P0-1 as ruled by the commissioner)");
{
  A("the board button says Sign in basic, Offer in full", /\(basicFA\?'Sign':'Offer'\)/.test(live));
  A("Sign calls sign_free_agent at the minimum, through the approval queue first", /CG\.mgmtQueue\("sign_free_agent", \{ p_registration:regId, p_salary:750000 \}/.test(live) && /CG\.sb\.rpc\("sign_free_agent",\{ p_registration:regId, p_salary:750000 \}\)/.test(live));
  A("the queue knows the page for it", /sign_free_agent:"freeagents"/.test(live));
  A("the offer / extension cards are gone in basic", /var offers = CG\.isBasic\(\) \? "" : \(CG\.offersCardHtml\(\)/.test(live));
  A("the copy says players are not asked", /clubs move players, players are not asked \(Rule 2\.2\)/.test(live));
}

console.log("— post-lock lineup changes (P1-4): the opponent can see it");
{
  A("the public lineup fetch carries the post-lock columns", (live.match(/select\("team_id,game_id,center,lw,rw,ld,rd,goalie,post_lock,post_lock_count,post_lock_at,penalties_owed"\)/g) || []).length === 3);
  A("the matchup card shows the change and the penalties owed", /Changed after lock · serves '\+\(lrow\.penalties_owed\|\|0\)/.test(pub2));
}

console.log("— availability (Rule 5.1): late is recorded, not refused");
{
  A("the client loads the server's late flag", /"profile_id,week_key,nights,submitted_at,first_submitted_at,late,late_at"/.test(live));
  A("the form no longer hard-locks at the deadline", /var closed = false;/.test(hub) && /var past = CG\.WEEK8\.open && CG\.now\(\) > CG\.WEEK8\.deadline;/.test(hub));
  A("...and the grid marks a late answer", /recorded as late \(Rule 5\.1\)/.test(hub));
}

console.log("— staff departments are the commissioner's to set");
{
  A("no self-edit button for staff", /var canEdit = isCommish;/.test(live));
}

console.log("— the rulebook says the same things");
{
  A("Rule 4.2: codes at the night's first game, two clubs only", /thirty \(30\) minutes before the night's first scheduled puck drop/.test(book));
  A("Rule 5.3: post-lock changes are reported to the opponent and the officials", /officials desk/.test(book) && /opponent/.test(book));
  A("Rule 2.2: a waived player is signed outright in the basic format", /signs a waived player outright|signed outright/.test(book));
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
