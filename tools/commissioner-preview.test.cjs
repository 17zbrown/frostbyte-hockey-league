/* v2.86 — the commissioner's Team HQ preview: it mirrors the club's own screen, and it writes for
   real. Run: node tools/commissioner-preview.test.cjs
 *
 * Two things the commissioner asked for, and what used to break each:
 *   MIRROR. The office's access mode is 'office', which passes every gate, so a preview showed the
 *   fullest possible Team HQ. That is not what a GM sees when the Owner has hidden a page or put it
 *   behind approval, which makes it useless for walking someone through their own screen.
 *   REAL. An explicit preview used to LOSE to a real seat and to the commissioner's own roster spot,
 *   so a commissioner who still plays or manages saw his own club's data under another club's name
 *   (loadManagerData keys its whole fetch on CG.myClub()).
 */
const fs = require("fs"), path = require("path");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const cut = (name) => { const i = live.indexOf("CG." + name + " = function"); return live.slice(i, live.indexOf("\n};", i) + 3); };
const line = (name) => { const i = live.indexOf("CG." + name + " = "); return live.slice(i, live.indexOf("\n", i) + 1); };

/* the club table: BOS is the club being previewed, DAL is a club the commissioner really manages */
const TEAMS = [
  { code: "BOS", name: "Bruins", owner: "u-own", gm: "u-gm", agm: "u-agm" },
  { code: "DAL", name: "Stars", owner: "u-commish", gm: null, agm: null },
];
function world(over = {}) {
  const prefs = {};
  const CG = {
    TEAMS, TEAM: Object.fromEntries(TEAMS.map((t) => [t.code, t])),
    store: { get: (k) => (k === "prefs" ? prefs : null), set: () => {} },
    auth: { user: { id: over.uid || "u-commish" }, role: over.role || "commish" },
    role: () => over.role || "commish",
    me: () => ({ id: over.uid || "u-commish", team: over.ownTeam || null }),
    lg: { _mgmtPolicy: over.policy || {}, _profName: { "u-own": "ItzPeakz", "u-gm": "Mr. Plow", "u-agm": "Jugg_PRKz" }, _mgmtMoves: [] },
    mgmtDefaultMode: () => "full",
    MGMT_ACTION_PAGE: { waive_player: "roster" },
    MGMT_PAGES: [["roster", "Roster"], ["lines", "Lineups"], ["management", "Front office"]],
    sb: { rpc: () => { CG._rpcCalled = true; return Promise.resolve({ data: null, error: null }); } },
    toast: () => {}, closeOverlay: () => {}, reloadLeague: () => {},
  };
  new Function("CG", cut("previewClub") + line("PREVIEW_SEATS") + cut("previewSeat") + cut("setPreviewSeat") +
    cut("previewSeatHolder") + cut("setPreviewClub") + cut("myManagedTeam") + cut("myClub") +
    cut("mySeat") + cut("mgmtAccess") + cut("mgmtQueue"))(CG);
  if (over.preview) { prefs.previewClub = over.preview; }
  if (over.seat) { prefs.previewSeat = over.seat; }
  return CG;
}

console.log("— an explicit preview wins (the club he picked is the club he gets)");
{
  const plain = world({ preview: "BOS" });
  A("myManagedTeam is the previewed club", plain.myManagedTeam().code === "BOS");
  A("myClub is the previewed club", plain.myClub() === "BOS");

  /* the two cases that used to silently show his OWN club under another club's name */
  const seated = world({ preview: "BOS", uid: "u-commish" });   // u-commish owns DAL in this table
  A("...even when he really holds a seat on another club", seated.myManagedTeam().code === "BOS" && seated.myClub() === "BOS",
    seated.myManagedTeam().code + "/" + seated.myClub());
  const playing = world({ preview: "BOS", ownTeam: "UTA" });
  A("...and even when he plays for another club (loadManagerData keys on myClub)", playing.myClub() === "BOS", playing.myClub());

  const off = world({});
  A("with no preview he is back on his own club", off.myManagedTeam().code === "DAL" && off.myClub() === "DAL",
    off.myManagedTeam().code + "/" + off.myClub());
}

console.log("\n— the mirror shows the club's own screen, seat by seat");
{
  const POLICY = { gm: { roster: "approve", management: "hidden" }, agm: { roster: "hidden", lines: "approve" } };
  A("a preview mirrors the OWNER by default", world({ preview: "BOS", policy: POLICY }).mySeat() === "owner");
  const asOwner = world({ preview: "BOS", policy: POLICY });
  A("...and the Owner sees everything of the club's", asOwner.mgmtAccess("roster") === "owner" && asOwner.mgmtAccess("management") === "owner");

  const asGm = world({ preview: "BOS", seat: "gm", policy: POLICY });
  A("mirroring the GM reports HIS access, not the office's",
    asGm.mySeat() === "gm" && asGm.mgmtAccess("roster") === "approve" && asGm.mgmtAccess("management") === "hidden",
    [asGm.mgmtAccess("roster"), asGm.mgmtAccess("management")].join("/"));
  const asAgm = world({ preview: "BOS", seat: "agm", policy: POLICY });
  A("mirroring the AGM reports HIS, which is different again",
    asAgm.mgmtAccess("roster") === "hidden" && asAgm.mgmtAccess("lines") === "approve",
    [asAgm.mgmtAccess("roster"), asAgm.mgmtAccess("lines")].join("/"));
  A("a page the club leaves at default is full for both", asGm.mgmtAccess("lines") === "full");

  const office = world({ preview: "BOS", seat: "office", policy: POLICY });
  A("the office view is still there when he wants it, and hides nothing",
    office.mySeat() === null && office.mgmtAccess("roster") === "office" && office.mgmtAccess("management") === "office");
  A("the bar can name who holds the mirrored seat", world({ preview: "BOS", seat: "gm" }).previewSeatHolder() === "Mr. Plow",
    String(world({ preview: "BOS", seat: "gm" }).previewSeatHolder()));
  A("...and names nobody for the office view", world({ preview: "BOS", seat: "office" }).previewSeatHolder() === null);
}

console.log("\n— the view is a mirror; the authority is not");
{
  const asGm = world({ preview: "BOS", seat: "gm", policy: { gm: { roster: "approve" } } });
  A("the mirrored page reports approve, so the banner and the greying match the GM's screen", asGm.mgmtAccess("roster") === "approve");
  return asGm.mgmtQueue("waive_player", {}, "waive someone").then((queued) => {
    A("...but the commissioner's own move is NOT queued behind the Owner", queued === false, String(queued));
    A("...and nothing was sent to mgmt_request_move", !asGm._rpcCalled);

    /* a real GM on the same club still queues — the mirror must not have disarmed the real path */
    const realGm = world({ role: "mgmt", uid: "u-gm", policy: { gm: { roster: "approve" } } });
    realGm.myManagedTeam = () => TEAMS[0];
    realGm.mySeat = () => "gm";
    return realGm.mgmtQueue("waive_player", {}, "waive someone").then((q2) => {
      A("a real GM under approve still goes to the Owner", q2 === true && realGm._rpcCalled, String(q2));
      console.log(`\n${ok ? "PASS" : "FAIL"}`);
      process.exit(ok ? 0 : 1);
    });
  });
}
