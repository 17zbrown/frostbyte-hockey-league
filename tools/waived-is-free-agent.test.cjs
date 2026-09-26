/* v3.33 — a waived player is a free agent, and clubs can see him.
 *
 * Commissioner, 2026-09-25: "when a player is waived they go to free agency pool for teams to pick
 * up." The rule was right and waive_player was right. What was missing is that NOTHING read the
 * waived_at stamp, so the player never reached the board.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 240))); }
}
const live = R("src/live/part_live.js"), rec = R("sql/2026-09-25-waived-is-a-free-agent.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the stamp is carried all the way to the client");
{
  A("the Control Center select asks for waived_at",
    /season_registrations"\)\.select\("[^"]*,waived_at,/.test(live));
  A("the record notes the public RPC returns it too", /registration_pool/.test(flat) && /waived_at/.test(flat));
}

console.log("\n— a waived player reads as a free agent, whoever he is");
{
  const h = R("index.html");
  const i = h.indexOf("CG.poolState = function"), j = h.indexOf("\n};", i);
  const mk = (regs, returning) => {
    const CG = { TEAMS: [], SEASON: { id: "S1" }, regSeason: () => ({ id: "S1" }),
      contractHeldIds: () => ({}), isDraftEligible: () => true, now: () => Date.now(),
      fmt: () => false, rfaOffseasons: () => 4,
      lg: { _rosteredIds: {}, draftState: { status: "complete" },
            isReturning: () => !!returning, serviceSeasons: () => 0, _registrationsRaw: regs } };
    new Function("CG", h.slice(i, j + 3))(CG);
    return CG;
  };
  const reg = (pid, extra) => Object.assign({ profile_id: pid, season_id: "S1", status: "pending", created_at: "2026-09-01", waived_at: null }, extra || {});
  /* the board's own filter, quoted from hubFreeAgents */
  const onBoard = (ps) => ps.key === "free_agent" || ps.key === "rfa";

  let CG = mk([reg("w", { waived_at: "2026-09-25T23:15:00Z" })], false);
  A("a waived player who was NEVER drafted is a free agent", CG.poolState("w").key === "free_agent", JSON.stringify(CG.poolState("w")));
  A("...labelled Waived, so a manager knows why he is available", CG.poolState("w").label === "Waived");
  A("...and he reaches the free-agent board", onBoard(CG.poolState("w")));

  CG = mk([reg("w", { waived_at: "2026-09-25T23:15:00Z" })], true);
  A("a waived RETURNING player is a free agent too", onBoard(CG.poolState("w")) && CG.poolState("w").label === "Waived");

  CG = mk([reg("u")], false);
  A("an unrostered player who was never waived is still Awaiting placement",
    CG.poolState("u").key === "undrafted_fa", JSON.stringify(CG.poolState("u")));
  A("...and does NOT reach the board, because the league will place him", !onBoard(CG.poolState("u")));

  CG = mk([reg("r")], true);
  A("a returning unrostered player is still a free agent, as before", onBoard(CG.poolState("r")) && CG.poolState("r").label === "Free agent");

  /* being rostered outranks everything: a waived player signed by a new club is Rostered again */
  CG = mk([reg("w", { waived_at: "2026-09-25T23:15:00Z" })], false);
  CG.lg._rosteredIds = { w: true };
  A("once a club signs him he is Rostered, not still Waived", CG.poolState("w").key === "rostered");
  CG = mk([reg("d", { waived_at: "2026-09-25T23:15:00Z", status: "declined" })], false);
  A("a declined registration still reads Declined", CG.poolState("d").key === "declined");
}

console.log("\n— the board's OTHER half still lets him through");
{
  /* hubFreeAgents filters on faFree(r) AND the poolState check above. A waived player must clear
     both, so pin faFree's own conditions against the row waive_player actually leaves behind:
     season kept, status 'pending', roster spot deleted, no rights held (basic holds none). */
  const h = R("index.html");
  const i = h.indexOf("var faFree=function(r){");
  const body = h.slice(i, h.indexOf("};", i) + 2).replace(/^var faFree=/, "");
  A("faFree is still the two-part gate this test assumes",
    /r\.status!=="declined"/.test(body) && /!rosteredIds\[r\.profile_id\]/.test(body) && /!faHeld\[r\.profile_id\]/.test(body), body);
  const faFree = new Function("s", "rosteredIds", "faHeld", "return " + body)({ id: "S1" }, {}, {});
  A("a waived player clears faFree", faFree({ season_id: "S1", status: "pending", profile_id: "w" }));
  A("...and a rostered one does not", !new Function("s", "rosteredIds", "faHeld", "return " + body)({ id: "S1" }, { w: true }, {})({ season_id: "S1", status: "pending", profile_id: "w" }));
}

console.log("\n— the published rule says where he goes");
{
  const content = R("src/live/part3_content.js");
  const rb = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).rulebook;
  const r22 = rb.chapters.find((c) => c.num === 2).sections.find((s) => s.id === "2.2").paragraphs;
  A("it says a waiver makes him a free agent at that moment",
    /A player who is waived becomes a free agent at the moment he is waived/.test(r22[2]));
  A("...and that he enters a pool every club can see",
    /enters the league's pool of free agents, where every club can see him and any club may sign him/.test(r22[2]));
  A("...and what does NOT happen to him",
    /He is not returned to the draft, he is not placed on a club by the league office, and nothing happens to him automatically/.test(r22[2]));
  A("...and that he stays there until signed", /he stays a free agent until a club signs him or the season ends/.test(r22[2]));
  A("the 'no free-agency period' line no longer reads as 'no free agents'",
    /It does have free agents, and the next paragraph but one says who they are/.test(r22[0]));
  A("...while still ruling out a window and a bidding market",
    /no window in the calendar during which contracts are negotiated, and no open market/.test(r22[0]));
  A("the changelog records it", rb.changelog.some((e) => e.version === "3.33"));
}

console.log("\n— the record");
{
  A("it quotes the instruction", /when a player is waived they go to free agency pool for teams to pick up/.test(flat));
  A("it credits waive_player for already being right", /has stamped season_registrations\.waived_at since v3\.06/.test(flat));
  A("...and names the real gap", /NOTHING ever read the stamp/.test(flat));
  A("the live casualty is on the record", /B Bunny/.test(flat) && /invisible to every club/.test(flat));
  A("...including why nothing would have rescued him", /deliberately kept the post-draft sweep from placing him/.test(flat));
  A("the RETURNS TABLE constraint is recorded", /cannot gain a column with CREATE OR REPLACE/.test(flat));
  A("...and that anon had to keep EXECUTE", /anon must keep EXECUTE/.test(flat));
  A("the ordering decision is explained", /outranks/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
