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


console.log("\n— /join itself renews an existing spot (the warning's promise)");
{
  const MIN = 60000;
  let OPEN = null; const patches = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || "GET";
    const J = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/rest/v1/lfg_lobbies") && m === "GET") return J(OPEN ? [OPEN] : []);
    if (u.includes("/rest/v1/lfg_lobbies") && m === "PATCH") {
      const body = JSON.parse(opts.body); patches.push(body);
      Object.assign(OPEN, body);
      return J([OPEN]);   // return=representation -> CAS won
    }
    return J([]);
  };
  const ix = (uid) => ({ channel_id: "chan", member: { user: { id: uid, username: "U" } } });
  const sheet = () => ({ id: "OL", status: "open", channel_id: "chan", updated_at: new Date(Date.now() - 40 * MIN).toISOString(),
    state: { signups: [{ id: "me", name: "Me", pos: "C", at: new Date(Date.now() - 28 * MIN).toISOString(), warned: true },
                       { id: "other", name: "O", pos: "G", at: new Date(Date.now() - 2 * MIN).toISOString() }],
             captains: [], teams: { A: [], B: [] } } });

  OPEN = sheet(); patches.length = 0;
  const res = JSON.parse((await I.handleJoin(ix("me"))).body);
  const saved = patches.find((p) => p.state);
  const meRow = saved && saved.state.signups.find((x) => x.id === "me");
  A("the renewal is WRITTEN, not just displayed", !!meRow, patches.length + " patches");
  A("the clock is fresh", meRow && (Date.now() - Date.parse(meRow.at)) / MIN < 0.2);
  A("the warned flag is cleared for the next cycle", meRow && meRow.warned === undefined);
  A("position untouched", meRow && meRow.pos === "C");
  A("the other player's clock is untouched", saved && (Date.now() - Date.parse(saved.state.signups.find((x) => x.id === "other").at)) / MIN > 1.5);
  A("the reply SAYS it renewed", /Spot renewed/.test(JSON.stringify(res.data.embeds)));
  A("the reply is ephemeral", (res.data.flags & 64) === 64);
  A("the picker still offers a move", JSON.stringify(res.data.components).includes("lfg:join:chan:"));

  OPEN = sheet(); patches.length = 0;
  const res2 = JSON.parse((await I.handleJoin(ix("stranger"))).body);
  A("someone NOT on the sheet gets the plain picker", patches.length === 0 && /Pick your position/.test(JSON.stringify(res2.data.embeds)));

  OPEN = null; patches.length = 0;
  const res3 = JSON.parse((await I.handleJoin(ix("me"))).body);
  A("no open sheet -> plain picker, no writes", patches.length === 0 && !!res3.data.components);

  // CAS permanently lost: never claim a renewal that didn't persist
  OPEN = sheet();
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || "GET";
    const J = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/rest/v1/lfg_lobbies") && m === "GET") return J([OPEN]);
    if (u.includes("/rest/v1/lfg_lobbies") && m === "PATCH") return J([]);   // 0 rows = CAS lost
    return J([]);
  };
  const res4 = JSON.parse((await I.handleJoin(ix("me"))).body);
  A("a lost CAS never claims a renewal", !/Spot renewed/.test(JSON.stringify(res4.data.embeds)));
  globalThis.fetch = realFetch;
}


console.log("\n— /delete: a majority of the lobby, nothing less");
{
  const lobby = mk();
  A("a stranger cannot vote", !!I.applyDeleteVote(lobby, "stranger").error);
  let out = I.applyDeleteVote(lobby, "capA");
  A("first vote counts 1 of 7", out.votes === 1 && out.needed === 7 && !out.closed);
  out = I.applyDeleteVote(lobby, "capA");
  A("voting twice does not double-count", out.votes === 1 && out.already === true);
  ["capB","p3","p4","p5","p6"].forEach((u) => { out = I.applyDeleteVote(lobby, u); });
  A("six of twelve is not a majority", out.votes === 6 && !out.closed);
  out = I.applyDeleteVote(lobby, "p7");
  A("the seventh vote closes the lobby", out.votes === 7 && out.closed === true);

  const short = mk(); short.state.signups = short.state.signups.slice(0, 11);   // one kicked, 11 left
  let o2 = null; ["capA","capB","p3","p4","p5"].forEach((u) => { o2 = I.applyDeleteVote(short, u); });
  A("majority tracks the CURRENT roster (11 -> 6 needed)", o2.needed === 6 && !o2.closed);
  o2 = I.applyDeleteVote(short, "p6");
  A("...and six closes an 11-player lobby", o2.closed === true);

  const purge = mk(); I.applyDeleteVote(purge, "p3");
  purge.state.signups = purge.state.signups.filter((x) => x.id !== "p3");        // voter got kicked
  const o3 = I.applyDeleteVote(purge, "capA");
  A("a kicked player's vote dies with them", o3.votes === 1);
}

console.log("\n— captains' twins auto-land on the opposite team");
{
  const s = mk().state; s.teams = { A: [], B: [] };
  I.startDraft(s, "capA", "p12");                    // capA is a C, p12 is a G
  A("the other C starts on Team B", s.teams.B.includes("p7"), JSON.stringify(s.teams));
  A("the other G starts on Team A", s.teams.A.includes("capB") && s.teams.A.length === 2, JSON.stringify(s.teams));
  const s2 = mk().state; s2.teams = { A: [], B: [] };
  I.startDraft(s2, "capA", "p7");                    // BOTH captains are centers
  A("same-position captains place no twins", s2.teams.A.length === 1 && s2.teams.B.length === 1);
}

console.log("\n— one of each position per team, and the draft always completes");
{
  const s = mk().state; s.teams = { A: [], B: [] };
  I.startDraft(s, "capA", "p12");                    // C captain vs G captain; twins p7->B, capB(G)->A
  // run the whole draft greedily-legal, probing every illegal pick along the way
  let guard = 0;
  while (guard++ < 20) {
    const cur = s.turn === "A" ? "capA" : "p12";
    const posOf = {}; s.signups.forEach((x) => { posOf[x.id] = x.pos; });
    const filled = s.teams[s.turn].map((id) => posOf[id]);
    const pool = s.signups.filter((x) => x.id !== "capA" && x.id !== "p12" &&
      !s.teams.A.includes(x.id) && !s.teams.B.includes(x.id));
    const illegal = pool.find((x) => filled.includes(x.pos));
    if (illegal) {
      const ref = I.applyPick({ id:"L", status:"drafting", state: s }, cur, illegal.id);
      A("a duplicate-position pick is refused (" + illegal.pos + ")", !!ref.error);
    }
    const legal = pool.find((x) => !filled.includes(x.pos));
    if (!legal) break;
    const out = I.applyPick({ id:"L", status:"drafting", state: s }, cur, legal.id);
    if (out.error) { A("legal pick unexpectedly refused", false, out.error); break; }
    if (out.status === "server") break;
  }
  const posOf = {}; s.signups.forEach((x) => { posOf[x.id] = x.pos; });
  const sig = (side) => s.teams[side].map((id) => posOf[id]).sort().join(",");
  A("Team A ends with one of every position", sig("A") === "C,G,LD,LW,RD,RW", sig("A"));
  A("Team B ends with one of every position", sig("B") === "C,G,LD,LW,RD,RW", sig("B"));
  A("everyone is on a team", s.teams.A.length === 6 && s.teams.B.length === 6);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
