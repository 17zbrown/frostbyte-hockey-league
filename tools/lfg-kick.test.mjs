// The /kick vote and the stats-import lobby matcher, driven through the real modules.
// Run: node tools/lfg-kick.test.mjs
//
// Two failure modes matter most: a kick that isn't really a two-captain decision (one person
// removing players unilaterally), and the import matcher guessing the WRONG lobby — the cost of a
// wrong guess is deleting a channel mid-draft, so ambiguity must always mean "do nothing".
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";

const { _internals: I } = await import(new URL("../netlify/functions/discord-interactions.js", import.meta.url).pathname);
const { _internals: P } = await import(new URL("../netlify/functions/pickup-import.js", import.meta.url).pathname);

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const mk = (over = {}) => ({ id: "L1", status: "server", state: Object.assign({
  signups: [
    { id: "capA", name: "CapA", pos: "C" },  { id: "capB", name: "CapB", pos: "G" },
    { id: "p3", name: "P3", pos: "LW" }, { id: "p4", name: "P4", pos: "RW" },
    { id: "p5", name: "P5", pos: "LD" }, { id: "p6", name: "P6", pos: "RD" },
    { id: "p7", name: "P7", pos: "C" },  { id: "p8", name: "P8", pos: "LW" },
    { id: "p9", name: "P9", pos: "RW" }, { id: "p10", name: "P10", pos: "LD" },
    { id: "p11", name: "P11", pos: "RD" }, { id: "p12", name: "P12", pos: "G" },
  ],
  captains: ["capA", "capB"],
  teams: { A: ["capA", "p3", "p5", "p7", "p9", "p11"], B: ["capB", "p4", "p6", "p8", "p10", "p12"] },
}, over) });

console.log("— proposing a kick is a captain's move only");
{
  A("a non-captain cannot propose", !!I.applyKickPropose(mk(), "p3", "p4").error);
  A("a captain cannot be the target", !!I.applyKickPropose(mk(), "capA", "capB").error);
  A("you cannot kick yourself", !!I.applyKickPropose(mk(), "capA", "capA").error);
  A("the target must be in the lobby", !!I.applyKickPropose(mk(), "capA", "stranger").error);
  const noCaps = mk({ captains: [] });
  A("no captains yet -> no kicks yet", !!I.applyKickPropose(noCaps, "capA", "p3").error);
  const good = I.applyKickPropose(mk(), "capA", "p7");
  A("a captain proposing a player works", !good.error && good.state.kickVote.target === "p7");
  A("the other captain is named for the vote", good.otherCaptain === "capB");
}

console.log("\n— approval requires the OTHER captain");
{
  const lobby = mk(); I.applyKickPropose(lobby, "capA", "p7");
  A("the proposer cannot approve their own vote", !!I.applyKickApprove(lobby, "capA", []).error);
  const lobby2 = mk(); I.applyKickPropose(lobby2, "capA", "p7");
  A("a random player cannot approve", !!I.applyKickApprove(lobby2, "p3", []).error);
  const lobby3 = mk(); I.applyKickPropose(lobby3, "capA", "p7");
  const out = I.applyKickApprove(lobby3, "capB", []);
  A("the other captain's approval executes", !out.error && out.target === "p7");
  A("the player is out of the signups", !out.state.signups.some((x) => x.id === "p7"));
  A("the kick is remembered", out.state.kicked.includes("p7"));
  A("the vote is consumed", !out.state.kickVote);
}

console.log("\n— decline clears the vote");
{
  const lobby = mk(); I.applyKickPropose(lobby, "capA", "p7");
  A("a non-captain cannot decline", !!I.applyKickDecline(mk({ }), "p3").error);
  const out = I.applyKickDecline(lobby, "capB");
  A("either captain can decline", !out.error && !out.state.kickVote);
  const lobby2 = mk(); I.applyKickPropose(lobby2, "capA", "p7");
  A("the proposer can withdraw too", !I.applyKickDecline(lobby2, "capA").error);
}

console.log("\n— the replacement comes from the public sheet, same position");
{
  const open = [
    { id: "w1", name: "WrongPos", pos: "G" },
    { id: "w2", name: "RightPos", pos: "C" },
    { id: "w3", name: "AlsoC", pos: "C" },
  ];
  const lobby = mk(); I.applyKickPropose(lobby, "capA", "p7");   // p7 is a C on Team A
  const out = I.applyKickApprove(lobby, "capB", open);
  A("first same-position signup chosen", out.replacement && out.replacement.id === "w2");
  A("replacement joins the signups with a fresh clock", out.state.signups.some((x) => x.id === "w2" && x.at));
  A("replacement inherits the team slot", out.side === "A" && out.state.teams.A.includes("w2") && !out.state.teams.A.includes("p7"));

  const lobby2 = mk(); I.applyKickPropose(lobby2, "capA", "p7");
  const out2 = I.applyKickApprove(lobby2, "capB", [{ id: "w1", name: "OnlyG", pos: "G" }]);
  A("no same-position signup -> kicked anyway, no replacement", !out2.error && out2.replacement === null);
  A("...and the team plays one short", !out2.state.teams.A.includes("p7") && out2.state.teams.A.length === 5);

  const lobby3 = mk({ kicked: ["w2"] });
  I.applyKickPropose(lobby3, "capA", "p7");
  const out3 = I.applyKickApprove(lobby3, "capB", open);
  A("a previously kicked player never comes back as the replacement", out3.replacement && out3.replacement.id === "w3");

  const lobby4 = mk(); I.applyKickPropose(lobby4, "capA", "p7");
  const out4 = I.applyKickApprove(lobby4, "capB", [{ id: "p3", name: "P3", pos: "C" }, { id: "w2", name: "RightPos", pos: "C" }]);
  A("someone already in this lobby is skipped", out4.replacement && out4.replacement.id === "w2");
}

console.log("\n— an undrafted kick just shrinks the pool");
{
  const lobby = mk({ teams: { A: ["capA"], B: ["capB"] },
    order: ["A","B","B","A","A","B","B","A","A","B"], pickIndex: 2, turn: "B" });
  lobby.status = "drafting";
  I.applyKickPropose(lobby, "capA", "p7");
  const out = I.applyKickApprove(lobby, "capB", []);
  A("no team surgery when the target was undrafted", !out.side && out.state.teams.A.length === 1 && out.state.teams.B.length === 1);
  A("draft state untouched", out.state.turn === "B" && out.state.pickIndex === 2);
}

console.log("\n— the import matcher refuses to guess");
{
  const lob = (id, ids) => ({ id, thread_id: "t" + id, status: "done", state: { signups: ids.map((x) => ({ id: x, pos: "C" })) } });
  const A12 = ["a1","a2","a3","a4","a5","a6","a7","a8","a9","a10","a11","a12"];
  const B12 = ["b1","b2","b3","b4","b5","b6","b7","b8","b9","b10","b11","b12"];
  const hit = P.matchLobbyForImport([lob("A", A12), lob("B", B12)], ["a1","a2","a3","a4","a5","a6","a7"]);
  A("seven of twelve matches the right lobby", hit && hit.lobby.id === "A" && hit.overlap === 7);
  A("five of twelve is below the bar", P.matchLobbyForImport([lob("A", A12)], ["a1","a2","a3","a4","a5"]) === null);
  const shared = ["a1","a2","a3","a4","a5","a6"];
  const tie = P.matchLobbyForImport([lob("A", A12), lob("B", [...shared, "x7","x8","x9","x10","x11","x12"])], shared);
  A("a tie between two lobbies means DO NOTHING", tie === null);
  A("an empty lobby list matches nothing", P.matchLobbyForImport([], A12) === null);
  const better = P.matchLobbyForImport(
    [lob("A", A12), lob("B", ["a1","a2","a3","a4","a5","a6","b7","b8","b9","b10","b11","b12"])],
    ["a1","a2","a3","a4","a5","a6","a7","a8"]);
  A("a strictly better overlap wins over a partial one", better && better.lobby.id === "A" && better.overlap === 8);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
