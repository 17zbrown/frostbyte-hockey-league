/* v2.38 — front-office seats are the Owner's alone, and the Owner sets each manager's access.
   Run: node tools/mgmt-permissions.test.cjs
   Behavior that lives in Postgres (mgmt_access_for, mgmt_gate on every management write, the
   request/decide RPCs, owner_remove_manager) was rehearsed in rolled-back transactions on the live
   database; this file pins the client's side of the contract so a refactor cannot quietly undo it. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), content = R("src/live/part3_content.js");
const head = R("src/live/part1_head.html"), ingest = R("netlify/functions/ingest-stats.js"), desks = R("src/live/part9_staffdesks.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const fnSrc = (src, name) => { const i = src.indexOf(`CG.${name} = function`); if (i < 0) return null; const j = src.indexOf("\n};", i); return src.slice(i, j + 3); };

/* ---- a tiny CG so the pure functions can be exercised ---- */
function harness(seatOf, policy, moves){
  const CG = {
    TEAM:{}, TEAMS:[{ code:"BOS", name:"Bruins", id:"t-bos", owner:"u-own", gm:"u-gm", agm:"u-agm", color:"#000" }],
    auth:{ user:{ id: seatOf }, profile:{ id: seatOf, role:"member" }, role:"mgmt" },
    lg:{ _mgmtPolicy: policy, _mgmtMoves: moves || [], _profName:{ "u-own":"ItzPeakz", "u-gm":"Mr. Plow", "u-agm":"Jugg" }, players:[], byTeam:{ BOS:[] } },
    role(){ return "mgmt"; }, previewClub(){ return null; }, now(){ return 1_800_000_000_000; },
    fmtFull(){ return "x"; }, toast(){}, reloadLeague(){}, closeOverlay(){}, sb:{ rpc(){ return Promise.resolve({ data:null, error:null }); } }
  };
  CG.TEAMS.forEach(t => CG.TEAM[t.code] = t);
  CG.myManagedTeam = () => CG.TEAMS[0]; CG.myClub = () => "BOS";
  const ctx = { CG, esc:(s)=>String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])), Promise, Date, Math, JSON, Object, Array, String, Number };
  const i = live.indexOf("CG.MGMT_PAGES = ["), j = live.indexOf("CG.reloadLeague = async function", i);
  vm.runInNewContext(live.slice(i, j), ctx);
  vm.runInNewContext(fnSrc(live, "mgmtMoveRow") + "\n" + fnSrc(live, "mgmtApprovalsCard") + "\n" + fnSrc(live, "mgmtPermissionsCard") + "\n" + fnSrc(live, "clubMgmt"), ctx);
  return CG;
}

console.log("— the access model mirrors public.mgmt_access_for");
{
  const own = harness("u-own", { gm:{ roster:"approve", tradehub:"hidden" }, agm:{ lines:"approve" } });
  A("the Owner is never gated", own.mgmtAccess("roster") === "owner" && own.mgmtAccess("tradehub") === "owner");
  const gm = harness("u-gm", { gm:{ roster:"approve", tradehub:"hidden", management:"approve", gamestats:"approve" }, agm:{ lines:"approve" } });
  A("a GM reads their own cells", gm.mgmtAccess("roster") === "approve" && gm.mgmtAccess("tradehub") === "hidden");
  A("...and full is the default for everything unset", gm.mgmtAccess("lines") === "full" && gm.mgmtAccess("draft") === "full");
  A("...Management and Game stats never take 'approve' (nothing there to approve)", gm.mgmtAccess("management") === "full" && gm.mgmtAccess("gamestats") === "full");
  const gm0 = harness("u-gm", {});
  A("the Management page is the Owner's by default — hidden from an unset GM, everything else full", gm0.mgmtAccess("management") === "hidden" && gm0.mgmtAccess("roster") === "full" && gm0.mgmtAccess("draft") === "full");
  A("...and the matrix mirrors that default", gm0.mgmtDefaultMode("management") === "hidden" && gm0.mgmtDefaultMode("tradehub") === "full");
  const agm = harness("u-agm", { gm:{ roster:"approve" }, agm:{ lines:"approve" } });
  A("the AGM's cells are the AGM's, not the GM's", agm.mgmtAccess("roster") === "full" && agm.mgmtAccess("lines") === "approve");
  const none = harness("u-nobody", {});
  A("a non-manager has no access at all", none.mgmtAccess("roster") === "none");
  A("every queued action maps to exactly one page", Object.values(none.MGMT_ACTION_PAGE).every(p => none.MGMT_PAGES.some(x => x[0] === p)));
  A("...and the page list matches the database's mgmt_pages()", JSON.stringify(none.MGMT_PAGES.map(x => x[0])) === JSON.stringify(["roster","lines","schedule","gamestats","tradehub","freeagents","draft","management"]));
}

console.log("\n— the queue wrapper: queued under approve, pass-through otherwise");
{
  const gm = harness("u-gm", { gm:{ roster:"approve" } });
  let sent = null; gm.sb.rpc = (name, args) => { sent = { name, args }; return Promise.resolve({ data:"id-1", error:null }); };
  return_ = gm.mgmtQueue("waive_player", { p_profile:"p1" }, "waive X").then(q => {
    A("a roster move under approve is sent to mgmt_request_move and the caller stops", q === true && sent && sent.name === "mgmt_request_move" && sent.args.p_action === "waive_player" && sent.args.p_team_code === "BOS");
    sent = null;
    return gm.mgmtQueue("accept_trade", { p_trade:"t1" }, "accept").then(q2 => {
      A("a move on a full-access page passes straight through (nothing sent)", q2 === false && sent === null);
      const own = harness("u-own", { gm:{ roster:"approve" } });
      return own.mgmtQueue("waive_player", { p_profile:"p1" }, "waive X").then(q3 => A("the Owner is never queued", q3 === false));
    });
  }).then(() => {
    const gm2 = harness("u-gm", { gm:{ roster:"approve" } });
    gm2.sb.rpc = () => Promise.resolve({ data:null, error:{ message:"nope" } });
    return gm2.mgmtQueue("waive_player", {}, "waive").then(q => A("a refused request is reported as MGMT_FAILED — truthy (the caller stops) but never 'sent'", q === gm2.MGMT_FAILED && q !== true && !!q));
  }).then(finish);
}

function finish(){
  console.log("\n— the pages: hidden means unlisted and unroutable; approve shows the banner");
  {
    A("the Team HQ nav drops pages the Owner withheld", /club = club\.filter\(function\(it\)\{ return CG\.mgmtAccess\(it\[0\]\) !== "hidden"; \}\);/.test(hub));
    A("...and badges Management with the pending count", /it\[0\]==="management" && CG\.mgmtPendingCount && CG\.mgmtPendingCount\(\)/.test(hub));
    A("the hub route refuses a hidden page by URL too", /CG\.mgmtAccess\(pageKey\)==="hidden"/.test(live) && /hasn’t given your seat access to "\+CG\.mgmtPageLabel\(pageKey\)/.test(live));
    A("...treating the unlisted per-game builder as the lineup page", /var pageKey = param==="lineup" \? "lines" : param;/.test(live));
    A("the Owner-approves banner rides above every Team HQ page", /var ban = CG\.mgmtApprovalBanner \? CG\.mgmtApprovalBanner\(section\) : "";/.test(live));
    const gm = harness("u-gm", { gm:{ tradehub:"approve" } }, [{ id:"m1", page:"tradehub", status:"pending", requested_by:"u-gm", summary:"accept the trade offer from Utah", created_at:"2027-01-01T00:00:00Z" }]);
    const ban = gm.mgmtApprovalBanner("tradehub");
    A("...naming the Owner and listing the manager's own waiting moves, with Withdraw", /ItzPeakz approves trade hub moves/.test(ban) && /accept the trade offer from Utah/.test(ban) && /data-mgmt-withdraw-move="m1"/.test(ban));
    A("...and not on a full-access page", gm.mgmtApprovalBanner("roster") === "");
    A("the dashboard tasks card shows the Owner's queue and a manager's own waiting moves", /waiting for your approval\./.test(hub) && /waiting for the Owner’s approval\./.test(hub));
    A("...a manager's row never links into a hidden Management page", /CG\.mgmtAccess\("management"\)!=="hidden" \? "#\/hub\/management" : \("#\/hub\/"\+\(\(firstP && firstP\.page\) \|\| "roster"\)\)/.test(hub));
    A("...nor does the team overview's Front office link", /CG\.mgmtAccess\("management"\)!=="hidden" \? '<a class="sec-link" href="#\/hub\/management">Front office →<\/a>' : ''/.test(live));
    A("...and the GM-vacancy nudge is the Owner's", /if \(to && !to\.gm && \(!CG\.mySeat \|\| CG\.mySeat\(\)==="owner"\)\)/.test(hub));
  }

  console.log("\n— every management write goes through the queue first");
  {
    const sites = [
      ["trade block flag", live, /CG\.mgmtQueue\("roster_block"/], ["squad move", live, /CG\.mgmtQueue\("set_roster_squad"/], ["squad swap", live, /CG\.mgmtQueue\("swap_roster_squad"/],
      ["free-agent offer", live, /CG\.mgmtQueue\("offer_free_agent"/], ["club answers to a counter (accept/deny/revise), on the page the offer belongs to", live, /CG\.mgmtQueue\("respond_offer", \{ p_offer:id, p_action:"accept"[^\n]*\{ page: isExt\?"roster":"freeagents" \}/],
      ["trade proposal", live, /CG\.mgmtQueue\("trade_propose"/], ["trade accept", live, /CG\.mgmtQueue\("accept_trade"/], ["trade decline", live, /CG\.mgmtQueue\("trade_decline"/], ["trade withdraw", live, /CG\.mgmtQueue\("trade_cancel"/],
      ["draft board", live, /CG\.mgmtQueue\("save_draft_board"/], ["draft pick (modal + quick pick)", live, /CG\.mgmtQueue\("draft_make_pick"/],
      ["waiver", hub, /CG\.mgmtQueue\("waive_player"/], ["extension offer", hub, /CG\.mgmtQueue\("offer_extension"/],
      ["per-game lineup", hub, /CG\.mgmtQueue\("set_game_lineup"/], ["saved line", hub, /CG\.mgmtQueue\("set_team_line"/], ["night plan", hub, /CG\.mgmtQueue\("set_team_line_night"/], ["server picks", hub, /CG\.mgmtQueue\("schedule_pick"/]
    ];
    sites.forEach(([l, src, re]) => A(l, re.test(src)));
    A("the draft pick is wrapped at both club-desk sites", (live.match(/CG\.mgmtQueue\("draft_make_pick"/g) || []).length === 2);
    A("the club's three counter answers are all wrapped, each choosing roster vs free agents by the offer", (live.match(/\{ page: isExt[A-Z]?\?"roster":"freeagents" \}/g) || []).length === 3);
    A("...and every one of those buttons carries data-ext so the page choice is never guessed", (live.match(/data-coffer-(deny|counter|accept)="'\+o\.id\+'"[^>]*data-ext="'\+\(ext\?'1':''\)\+'"/g) || []).length === 4);
    A("a rights-held re-sign is queued as free-agent business, as the database gates it", /\{ page: rights\?"freeagents":"roster" \}/.test(hub));
    A("a queued counter-proposal carries the offer it counters, so approval closes the original", /countered_id:CG\._counteringId\|\|null/.test(live));
    A("a refused send is a third outcome (MGMT_FAILED), never counted as sent", /return CG\.MGMT_FAILED;/.test(live) && /if \(q===true\) qN\+\+; else if \(q\) qFail\+\+;/.test(hub) && /if \(q===true\)\{ qN\+\+; sentSlots\.push\(n\); \} else if \(q\) qFail\+\+;/.test(hub));
    A("...and only lines actually sent leave the draft", /sentSlots\.forEach\(function\(n\)\{ delete CG\._lcDraft\[n\];/.test(hub));
    A("...and a refused squad move re-enables its button", /if \(q===CG\.MGMT_FAILED\) btn\.disabled = false;/.test(live) && /if \(q===CG\.MGMT_FAILED\) swapBtn\.disabled = false;/.test(live));
    A("the trade-block toggle decides synchronously and the click skips its success toast when queued", /if \(CG\.setOnBlock\(pid, !on\)\) return;/.test(hub) && /if \(CG\.mgmtAccess && CG\.mgmtAccess\("roster"\)==="approve"\)\{\n    CG\.mgmtQueue\("roster_block"/.test(live));
    A("the draft board under approval sends one request after the ranking settles and keeps the local ranking across reloads", /CG\._boardQueueT = setTimeout\(/.test(live) && /if \(waiting\) CG\.lg\._myBoard = CG\._boardLocal\.slice\(\); else CG\._boardLocal = null;/.test(live));
    /* v3.05: emergency mode no longer exists (a late switch is free), so there is no mode to
       leave. What still matters is that a queued lineup does not claim to be filed. */
    A("a lineup sent for approval says queued, not submitted", /done\(null, "queued"\)/.test(hub));
    A("the last-loaded policy stands in during a rebuild (no raw gate refusal in the window)", /\|\| CG\._mgmtPolicyCache \|\| \{\}/.test(live));
    A("dressing from a saved line reports 'queued' instead of claiming dressed", /done\(null, "queued"\)/.test(hub) && /else if \(queued\) qN\+\+; else okN\+\+;/.test(hub));
    A("the prototype build has a no-op queue so load order never matters", /if \(!CG\.mgmtQueue\) CG\.mgmtQueue = function\(\)\{ return Promise\.resolve\(false\); \};/.test(hub));
  }

  console.log("\n— the Management page: Owner edits, everyone else reads");
  {
    const own = harness("u-own", { gm:{ roster:"approve" } }, [{ id:"m1", page:"roster", status:"pending", requested_by:"u-gm", summary:"waive Jugg", created_at:"2027-01-01T00:00:00Z", requester:{ gamertag:"Mr. Plow" } }]);
    const m = own.clubMgmt();
    const card = own.mgmtPermissionsCard(m);
    A("the Owner gets a three-way control per page per seat", (card.match(/data-perm-mode="approve"/g) || []).length === 12 && (card.match(/data-perm-mode="full"/g) || []).length === 16, String((card.match(/data-perm-mode="approve"/g) || []).length));
    A("...with 'approve' withheld from Management and Game stats", !/data-perm-page="management" data-perm-mode="approve"/.test(card) && !/data-perm-page="gamestats" data-perm-mode="approve"/.test(card));
    A("...the saved policy pre-selected", /data-perm-seat="gm" data-perm-page="roster" data-perm-mode="approve" aria-pressed="true"/.test(card));
    A("...and Management pre-selected as hidden when unset", /data-perm-seat="gm" data-perm-page="management" data-perm-mode="hidden" aria-pressed="true"/.test(card) && /data-perm-seat="agm" data-perm-page="management" data-perm-mode="hidden" aria-pressed="true"/.test(card));
    A("...and a Save button that starts disabled (nothing changed yet)", /id="permSave" disabled/.test(card));
    A("unsaved matrix edits hold the live reload until saved or discarded", /CG\._holdReload = d \? "permissions" : null;/.test(live) && /if \(CG\._holdReload\) return true;/.test(live));
    A("the save toast claims a notification only when a manager is seated", /var seated = !!\(m\.t\.gm \|\| m\.t\.agm\);/.test(live));
    const q = own.mgmtApprovalsCard(m);
    A("the Owner's approvals card offers Approve and Deny on a waiting move", /data-mgmt-decide="m1" data-approve="1"/.test(q) && /data-mgmt-decide="m1" data-approve="0"/.test(q) && /Mr\. Plow · GM/.test(q));
    const gm = harness("u-gm", { gm:{ roster:"approve" } }, [{ id:"m1", page:"roster", status:"pending", requested_by:"u-gm", summary:"waive Jugg", created_at:"2027-01-01T00:00:00Z" }]);
    const gcard = gm.mgmtPermissionsCard(gm.clubMgmt());
    A("a GM sees chips, never controls", !/data-perm-mode/.test(gcard) && /Owner approves/.test(gcard) && /Set by the Owner/.test(gcard));
    const gq = gm.mgmtApprovalsCard(gm.clubMgmt());
    A("...and their own queue with Withdraw, no Approve", /data-mgmt-withdraw-move="m1"/.test(gq) && !/data-mgmt-decide/.test(gq));
    A("the save goes to set_team_mgmt_policy and the decision to mgmt_decide_move", /CG\.sb\.rpc\("set_team_mgmt_policy",\{ p_team_code:m\.club, p_policy:draft \}\)/.test(live) && /CG\.sb\.rpc\("mgmt_decide_move",\{ p_id:id, p_approve:ok, p_note:note \}\)/.test(live));
    A("a failed execution is reported, never toasted as success", /if \(d\.status==="failed"\) CG\.toast\("Approved, but it could not be made: "/.test(live));
    A("the segmented control is styled", /\.seg-b\.on\[data-perm-mode="approve"\]/.test(head));
  }

  console.log("\n— the seats: Owner nominates and removes; the role follows the seat");
  {
    A("the Owner's Remove button calls owner_remove_manager", /CG\.sb\.rpc\("owner_remove_manager", \{ p_team_code:m\.club, p_role:role \}\)/.test(live));
    A("...and a GM/AGM sees who decides instead", /Only the Owner changes this seat/.test(live) && /Only the Owner nominates/.test(live));
    A("the role is re-derived on every league rebuild", /CG\.refreshRole = function\(\)/.test(live) && (live.match(/CG\.refreshRole\(\);/g) || []).length >= 2);
    A("...leaving a View-as preview alone", /if \(CG\._va \|\| !CG\.auth/.test(live));
    A("a seat or request notice refreshes the hub without a reload", /\(n\.type === "role" \|\| n\.type === "request"\) && CG\.liveReload/.test(live));
    A("the approval notice deep-links to Management", /case "mgmtapprovals": return "#\/hub\/management";/.test(live));
    A("the reviewer copy names the Owner as the one who clears a held seat", /the club’s Owner removes the sitting manager \(or a commissioner vacates the seat\) first/.test(live) && /Only the club’s Owner \(or a commissioner\) can vacate a seat/.test(desks));
  }

  console.log("\n— the importer honors a withheld game stats desk");
  {
    A("authForGame asks the database (mgmt_access_for) before letting a manager in", /rpc\/mgmt_access_for/.test(ingest) && /if \(mode === "hidden"\) return \{ ok: false/.test(ingest));
    A("...a failed lookup denies, never allows", /\} catch \{ return deny; \}\n    return \{ ok: true, uid, who, via: "management"/.test(ingest));
    A("...and the reason reaches the desk", (ingest.match(/error: actor\.reason \|\|/g) || []).length === 5);
  }

  console.log("\n— the rulebook says it");
  {
    const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
    const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" "); };
    const r26 = sec("2.6");
    const cl238 = rb.changelog.find((c) => c.version === "2.38");
    A("Rule 2.6: the Owner alone nominates and removes", /The front-office seats are the Owner’s alone/.test(r26) && /A General Manager or Assistant General Manager nominates and removes nobody/.test(r26));
    A("...removal is immediate, no league-office step, office told", /without a league-office step; the removal takes effect at once, the seat falls vacant, and the league office is told/.test(r26));
    A("...the three modes, with full as the default", /full, in which case the manager acts freely/.test(r26) && /subject to the Owner’s approval/.test(r26) && /withheld, in which case the page is hidden/.test(r26) && /The default for every seat and page is full access, with one exception/.test(r26));
    A("...except the Management page, which is the Owner's unless opened", /is the Owner’s alone and is withheld from the General Manager and the Assistant General Manager unless the Owner opens it to them/.test(r26));
    A("...a stale approved move fails loudly, and both are told", /fails rather than half-applies, and both the Owner and the manager are told why/.test(r26));
    A("...every manager has the same Team HQ", /Every member of the management group — Owner, General Manager and Assistant General Manager alike — has the same Team HQ/.test(r26));
    A("...and the league office is untouched", /none of this limits the league office/.test(r26));
    A("...the Owner approves a league-built description, and a newer request supersedes", /never text the manager wrote/.test(r26) && /replaces the older one still waiting/.test(r26));
    A("Team HQ says all three seats before the draft (Rule 2.8), not 'before the first game' with an optional AGM", !/first regular-season game/.test(live) && !/AGM is optional/.test(live) && /row\("agm","Assistant GM",true\)/.test(live));
    A("the changelog no longer lists the game stats desk among approve-able pages", !!cl238 && /the game stats desk is open or hidden only/.test(cl238.summary));
    A("the changelog records v2.38", !!cl238 && /management permissions/.test(cl238.summary));
    A("...in American spelling", !/practis|colour|centre|organis|defence/i.test(rb.changelog[0].summary + r26));
  }
  console.log(`\n${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}
