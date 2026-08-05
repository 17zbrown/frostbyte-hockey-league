// The pickup board as an UNLIMITED queue: sign-ups never cap, a game forms once every position
// has two, the first two at each position play, and everyone else keeps their place in line for
// the next lobby. Also covers the kick refill (which now pulls from that queue) and the EA
// gamertags shown beside names. Run: node tools/lfg-queue.test.mjs
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_PUBLIC_KEY ||= "0".repeat(64);

const { _internals: I } = await import(new URL("../netlify/functions/discord-interactions.js", import.meta.url).pathname);

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const POSK = I.POS.map((p) => p.key);              // C LW RW LD RD G
const lobby = (signups) => ({ id: "lb1", status: "open", updated_at: "t0",
  state: { signups: signups.slice(), captains: [], teams: { A: [], B: [] } } });
const S = (id, pos) => ({ id, name: id.toUpperCase(), pos, at: new Date().toISOString() });

console.log("— the board never caps");
{
  const lb = lobby([]);
  for (let i = 0; i < 5; i++) A(`center #${i + 1} is accepted`, !I.applyJoin(lb, `c${i}`, `C${i}`, "C").error);
  A("five players sit at one position", lb.state.signups.filter((x) => x.pos === "C").length === 5);
  A("no lobby forms without every position", !I.applyJoin(lb, "c9", "C9", "C").formed);
}

console.log("\n— a game forms only when every position has two");
{
  const lb = lobby([]);
  let formed = null;
  POSK.forEach((k) => { formed = I.applyJoin(lb, `${k}1`, `${k}1`, k).formed; });
  A("one at every position is not enough", !formed);
  POSK.slice(0, 5).forEach((k) => { formed = I.applyJoin(lb, `${k}2`, `${k}2`, k).formed; });
  A("still short while a position has one", !formed, "missing the second goalie");
  formed = I.applyJoin(lb, "G2", "G2", "G").formed;
  A("the twelfth completing the set forms it", !!formed);
  A("exactly twelve play", formed.chosen.length === 12);
  A("two of every position", POSK.every((k) => formed.chosen.filter((x) => x.pos === k).length === 2));
  A("nobody is left over here", formed.rest.length === 0);
}

console.log("\n— the first two at each position play, the rest stay in line");
{
  const lb = lobby([]);
  /* deep queue at center: c1..c4 signed up in that order */
  ["c1", "c2", "c3", "c4"].forEach((id) => I.applyJoin(lb, id, id, "C"));
  let formed = null;
  POSK.slice(1).forEach((k) => { I.applyJoin(lb, `${k}1`, `${k}1`, k); });
  POSK.slice(1).forEach((k) => { formed = I.applyJoin(lb, `${k}2`, `${k}2`, k).formed; });
  A("the game forms", !!formed);
  const centers = formed.chosen.filter((x) => x.pos === "C").map((x) => x.id);
  A("the FIRST two centers play", centers.join(",") === "c1,c2", centers.join(","));
  A("the later two stay on the board", formed.rest.map((x) => x.id).join(",") === "c3,c4");
  A("the queue keeps its order", formed.rest[0].id === "c3");
  A("everyone is accounted for", formed.chosen.length + formed.rest.length === lb.state.signups.length);
}

console.log("\n— renewing keeps your place in line");
{
  const lb = lobby([]);
  ["a", "b", "c"].forEach((id) => I.applyJoin(lb, id, id, "LW"));
  const before = lb.state.signups.map((x) => x.id).join(",");
  I.applyJoin(lb, "a", "A", "LW");               // renew the earliest signup
  A("array order is untouched by a renewal", lb.state.signups.map((x) => x.id).join(",") === before);
  const r = I.applyJoin(lb, "a", "A", "RD");
  A("changing position is always allowed", r.moved === true && !r.error);
}

console.log("\n— selectTwelve is a pure split");
{
  const rows = [S("x1", "C"), S("x2", "C"), S("x3", "C"), S("g1", "G"), S("g2", "G")];
  const { chosen, rest } = I.selectTwelve(rows);
  A("takes two per position, in order", chosen.map((x) => x.id).join(",") === "x1,x2,g1,g2");
  A("returns the remainder", rest.map((x) => x.id).join(",") === "x3");
  A("readyToForm is honest about a short board", I.readyToForm({ signups: rows }) === false);
}

console.log("\n— the kick refill pulls the next player in line");
{
  /* a room mid-draft: teams already placed, so a replacement inherits the team slot */
  const room = { id: "r1", status: "drafting", updated_at: "t0", state: {
    signups: [S("cap1", "C"), S("cap2", "LW"), S("v", "RD")],
    captains: ["cap1", "cap2"], teams: { A: ["cap1", "v"], B: ["cap2"] },
    kickVote: { target: "v", by: "cap1", at: new Date().toISOString() } } };
  /* the waiting board, in queue order — two right defense waiting */
  const queue = [S("rd_first", "RD"), S("rd_second", "RD"), S("wing", "LW")];
  const out = I.applyKickApprove(room, "cap2", queue);
  A("the kick goes through", !out.error && out.target === "v");
  A("the NEXT in line at that position steps in", out.replacement && out.replacement.id === "rd_first");
  A("they inherit the kicked player's team slot", out.state.teams.A.includes("rd_first") && !out.state.teams.A.includes("v"));
  A("...on the same side", out.side === "A");
  A("they're on the room roster", out.state.signups.some((x) => x.id === "rd_first"));
}
{
  /* before the draft: no teams yet, so the replacement just joins the lobby */
  const room = { id: "r2", status: "captains", updated_at: "t0", state: {
    signups: [S("cap1", "C"), S("cap2", "LW"), S("v", "G")],
    captains: ["cap1", "cap2"], teams: { A: [], B: [] },
    kickVote: { target: "v", by: "cap1", at: new Date().toISOString() } } };
  const out = I.applyKickApprove(room, "cap2", [S("g_next", "G")]);
  A("a pre-draft kick still refills", out.replacement && out.replacement.id === "g_next");
  A("...with no team assigned", out.side === null && !out.state.teams.A.length && !out.state.teams.B.length);
  A("...and they look like they were always here", out.state.signups.some((x) => x.id === "g_next" && x.pos === "G"));
}
{
  const room = { id: "r3", status: "drafting", updated_at: "t0", state: {
    signups: [S("cap1", "C"), S("cap2", "LW"), S("v", "G")],
    captains: ["cap1", "cap2"], teams: { A: ["cap1", "v"], B: ["cap2"] },
    kicked: ["g_burned"],
    kickVote: { target: "v", by: "cap1", at: new Date().toISOString() } } };
  const out = I.applyKickApprove(room, "cap2", [S("g_burned", "G"), S("g_ok", "G")]);
  A("someone already kicked from this lobby is skipped", out.replacement && out.replacement.id === "g_ok");
  const empty = I.applyKickApprove(
    { id: "r4", status: "drafting", updated_at: "t0", state: { signups: [S("cap1", "C"), S("cap2", "LW"), S("v", "G")],
      captains: ["cap1", "cap2"], teams: { A: ["cap1", "v"], B: ["cap2"] },
      kickVote: { target: "v", by: "cap1", at: new Date().toISOString() } } }, "cap2", []);
  A("an empty queue kicks anyway, short-handed", !empty.error && empty.replacement === null && !empty.state.teams.A.includes("v"));
}

console.log("\n— EA gamertags beside names");
{
  const ea = { u1: "IceWizard99", u2: "NetMinderEA" };
  A("a known player shows their EA name", I.nameWithEa({ id: "u1" }, ea) === "<@u1> `IceWizard99`");
  A("a plain id works too", I.nameWithEa("u2", ea) === "<@u2> `NetMinderEA`");
  A("an unknown player still renders", I.nameWithEa({ id: "u3" }, ea) === "<@u3>");
  A("no map at all never breaks a roster", I.nameWithEa({ id: "u3" }, null) === "<@u3>");
  const view = I.summaryView({ signups: [S("u1", "C"), S("u2", "G")] }, ea);
  const body = JSON.stringify(view);
  A("the queue card carries EA names", body.includes("IceWizard99") && body.includes("NetMinderEA"));
  A("...and numbers the line", body.includes("1. <@u1>"));
  const done = I.doneView({ state: { captains: ["u1", "u2"], teams: { A: ["u1"], B: ["u2"] }, server: "NA East", code: "123456", vetoed: 1 } }, ea);
  const dbody = JSON.stringify(done);
  A("the ready card carries EA names", dbody.includes("IceWizard99"));
  A("...and tells them how to enter a lagged-out game", /Lagged out/.test(dbody) && /Import as one game/.test(dbody));
  A("...and points at the import page", dbody.includes("pickup-import"));
}

console.log("\n— the picker never disables a position now");
{
  const s = { signups: [S("a", "C"), S("b", "C"), S("c", "C")] };
  const pv = I.pickerView("chan", s, "zz");
  const buttons = pv.components.flatMap((r) => r.components).filter((b) => /lfg:join/.test(b.custom_id || ""));
  A("every position stays clickable", buttons.length === 6 && buttons.every((b) => !b.disabled));
  A("the button shows how many are waiting there", buttons.some((b) => b.label === "Center (3)"));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
