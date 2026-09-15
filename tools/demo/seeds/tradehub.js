/* seed: tradehub — the Trade Hub mid-season for the Bruins' front office: two incoming offers
   (Red Wings, Kraken), one offer out (Penguins), tradeable draft picks, an Owner-approves policy for
   the GM with a queue of moves, two players on the trade block, and a recording stand-in for the
   trades / roster_spots tables so Propose, Decline, Withdraw, Accept and To block behave the way
   the live page does (the row moves, the success toast shows). Source of the shapes:
   part_live.js hubTradeHubLive (:11865), tPicks/pickLabel (:11857-11863), mgmtQueue (:6267),
   mgmtMoveRow (:7952), mapDraftData (:1023), signedExtensionOf (:9238), renderCapOutlook (part6_hub.js). */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "tradehub", run: function(CG, t, uid){
  var lg = CG.lg, my = t.code, now = CG.now();
  var st = (window.GUIDE.qs.get("state") || "");
  var tid = function(c){ return lg._codeToId[c]; };
  var ago = function(h){ return new Date(now - h*3600000).toISOString(); };
  var names = window.GUIDE.names;

  /* Contracts the way the live build reads them out of the contracts table: each of the three
     management seats carries the season's management salary — the database pays Owner, GM and AGM
     $3.0M apiece (seasons.owner_salary/gm_salary/agm_salary, default 3/3/3) — and every player deal
     sits on the $250K lattice above the $750K minimum (Rule 2.5, v2.31). The prototype engine pays
     the Owner and GM $0 and leaves the rest off the lattice, so both are re-cut here, and each club
     is scaled to sit just under the $40M cap the way a club does in mid-season. */
  var MGMT_PAY = 3000000, STEP = CG.SALARY_STEP || 250000, MIN = CG.MIN_SALARY || 750000;
  var snap = function(v){ return Math.max(MIN, Math.round(v/STEP)*STEP); };
  CG.TEAMS.forEach(function(x, i){
    var all = lg.byTeam[x.code] || [];
    var mgmt = all.filter(function(p){ return p.mgmt; }), sk = all.filter(function(p){ return !p.mgmt; });
    mgmt.forEach(function(p){ p.salary = MGMT_PAY; p.mgmtSalary = true; });
    var target = x.code === my ? 38500000 : 38600000 - i*400000;
    var room = target - mgmt.length*MGMT_PAY, sum = sk.reduce(function(s,p){ return s+(p.salary||0); }, 0) || 1;
    sk.forEach(function(p){ p.salary = snap(p.salary * room/sum); });
    /* the lattice rounds each deal up or down, so walk the biggest contracts back a step at a time
       until the payroll lands on the target from below — no club is ever shown over the cap */
    var total = function(){ return all.reduce(function(s,p){ return s+(p.salary||0); }, 0); };
    for (var n = 0; n < 80 && total() > target; n++){
      var hi = sk.filter(function(p){ return p.salary > MIN; }).sort(function(a,b){ return b.salary - a.salary; })[0];
      if (!hi) break;
      hi.salary -= STEP;
    }
  });

  /* The three management rows on the roster ARE the club's front office: the same gamertags the
     dashboard's My club card, the Owner-approves banner and the Approvals queue name. The prototype
     hands the seats to three unrelated skaters, which read as a different front office. */
  var seatOf = { owner:t.owner, gm:t.gm, agm:t.agm };
  (lg.byTeam[my]||[]).forEach(function(p){ if (p.mgmt && seatOf[p.mgmt] && names[seatOf[p.mgmt]]) p.tag = names[seatOf[p.mgmt]]; });

  /* Games already played are final, so the club's "Next" is tonight's fixture rather than the first
     row of the slate: the prototype leaves lg.schedule unflagged and keeps its finals in lg.results. */
  var done = {}; (lg.results||[]).forEach(function(g){ if (g.id) done[g.id] = g; });
  (lg.schedule||[]).forEach(function(g){
    var r = done[g.id];
    if (!r && g.at >= now) return;
    g.status = "final";
    if (r){ g.score = r.score; g.ot = r.ot; }
  });

  /* the club's own roster the way the hub filters it (no management, no pre-season loans) */
  var roster = function(code, pos){ return (lg.byTeam[code]||[]).filter(function(p){ return !p.mgmt && p.origin!=="preseason_random" && (!pos || p.pos===pos); }); };
  var pid = function(code, pos, n){ return roster(code, pos).slice(n||0, (n||0)+1).map(function(p){ return p.id; }); };

  /* Draft picks for the current draft season: rounds 1–4 for every club. The Bruins' own fourth
     went to the Islanders in the deal that brought back the Islanders' second, so the club's four
     tradeable picks fit one picker screen and the acquired one carries the "(via NYI)" label
     Rule 2.8 gives a traded pick. */
  lg.draftPicks = [];
  CG.TEAMS.forEach(function(x){ [1,2,3,4].forEach(function(r){ lg.draftPicks.push({ id:"pk-"+x.code+"-"+r, season:1, round:r, ownerCode:x.code, origCode:x.code, used:false }); }); });
  var ownPick = function(id, code){ var k = lg.draftPicks.find(function(x){ return x.id===id; }); if (k) k.ownerCode = code; };
  ownPick("pk-NYI-2", my); ownPick("pk-"+my+"-4", "NYI");

  /* a signed extension travels with the Red Wings winger being offered (the chip on the card) */
  var extP = roster("DET","LW")[0];
  lg._contractsRaw = extP ? [{ id:"c-ext-1", profile_id:extP.id, team_id:tid("DET"), status:"signed", is_manager:false, start_season:2, end_season:3, salary:4250000 }] : [];

  /* two incoming offers and one out */
  lg._myTrades = [
    { id:"tr1", season_id:CG.SEASON.id, status:"proposed", from_team_id:tid("DET"), to_team_id:tid(my),
      offered_profile_ids:pid("DET","LW"), requested_profile_ids:pid(my,"RD"), offered_pick_ids:["pk-DET-2"], requested_pick_ids:[],
      note:"We’re loaded up front and thin on the back end — a scorer and a second-rounder for your righty D.", created_at:ago(4) },
    { id:"tr2", season_id:CG.SEASON.id, status:"proposed", from_team_id:tid("SEA"), to_team_id:tid(my),
      offered_profile_ids:pid("SEA","C"), requested_profile_ids:pid(my,"LW",1), offered_pick_ids:[], requested_pick_ids:[],
      note:"Depth-for-depth — a center for a winger, dollar for dollar on the cap.", created_at:ago(27) },
    { id:"tr3", season_id:CG.SEASON.id, status:"proposed", from_team_id:tid(my), to_team_id:tid("PIT"),
      offered_profile_ids:pid(my,"C"), requested_profile_ids:pid("PIT","G"), offered_pick_ids:["pk-"+my+"-3"], requested_pick_ids:[],
      note:null, created_at:ago(9) }
  ];
  /* ?state=twoout — a second offer out (Mammoth), so withdrawing one leaves the list populated */
  if (st === "twoout") lg._myTrades.push({ id:"tr4", season_id:CG.SEASON.id, status:"proposed", from_team_id:tid(my), to_team_id:tid("UTA"),
      offered_profile_ids:pid(my,"RD",1), requested_profile_ids:pid("UTA","LD"), offered_pick_ids:[], requested_pick_ids:["pk-UTA-4"],
      note:"Righty for lefty, and we'll take your fourth to balance it.", created_at:ago(31) });
  if (st === "quiet") lg._myTrades = [];
  CG._trades = lg._myTrades.slice();

  /* two players advertised on the block (roster_spots.on_block) */
  var blocked = st === "noblock" ? [] : roster(my).filter(function(p){ return p.pos==="RW" || p.pos==="G"; }).slice(0,2);
  blocked.forEach(function(p){ p.onBlock = true; });

  /* the Owner's policy: the GM's roster and Trade Hub moves wait for approval; the AGM cannot see
     the draft and his free-agent offers wait */
  lg._mgmtPolicy = { gm:{ roster:"approve", tradehub:"approve", management:"full" }, agm:{ draft:"hidden", freeagents:"approve" } };
  lg._mgmtPolicyAt = ago(26);
  var waiveP = roster(my,"LD")[0], blockP = blocked[0] || roster(my)[0];
  lg._mgmtMoves = [
    { id:"m1", team_id:t.id, page:"tradehub", action:"accept_trade", status:"pending", requested_by:"u-gm", requester:{ gamertag:names["u-gm"] }, summary:"accept the trade offer from Red Wings", created_at:ago(0.4) },
    { id:"m2", team_id:t.id, page:"roster", action:"waive_player", status:"pending", requested_by:"u-gm", requester:{ gamertag:names["u-gm"] }, summary:"waive "+(waiveP?waiveP.tag:"a player"), created_at:ago(3) },
    { id:"m3", team_id:t.id, page:"freeagents", action:"offer_free_agent", status:"pending", requested_by:"u-agm", requester:{ gamertag:names["u-agm"] }, summary:"offer Lemieux4ever $1,250,000 × 2 seasons", created_at:ago(5) },
    { id:"m4", team_id:t.id, page:"roster", action:"roster_block", status:"approved", requested_by:"u-gm", requester:{ gamertag:names["u-gm"] }, summary:"put "+blockP.tag+" on the trade block", created_at:ago(30), decided_at:ago(28), note:"Go ahead" },
    { id:"m5", team_id:t.id, page:"lines", action:"set_game_lineup", status:"failed", requested_by:"u-agm", requester:{ gamertag:names["u-agm"] }, summary:"dress Line 1 vs Stars · Mon Jul 13 9:00 PM ET", created_at:ago(50), decided_at:ago(46), result:"That game is final; its lineup can no longer be changed." },
    { id:"m6", team_id:t.id, page:"tradehub", action:"trade_propose", status:"denied", requested_by:"u-gm", requester:{ gamertag:names["u-gm"] }, summary:"propose a trade to Canucks (2 for 1)", created_at:ago(70), decided_at:ago(69), note:"Not for a first-rounder." }
  ];

  /* ---- the database, stood in: trades and roster_spots writes land in the in-memory league ---- */
  var seq = 100;
  var dropTrade = function(id){ lg._myTrades = lg._myTrades.filter(function(x){ return x.id!==id; }); CG._trades = lg._myTrades.slice(); };
  var applyOps = function(table, ops){
    var op = function(k){ return ops.find(function(o){ return o[0]===k; }); };
    if (table === "trades"){
      var ins = op("insert");
      if (ins){ var row = Object.assign({}, ins[1][0], { id:"tr"+(++seq), status:"proposed", created_at:new Date(CG.now()).toISOString() }); lg._myTrades.push(row); CG._trades = lg._myTrades.slice(); return { data:[{ id:row.id }], error:null }; }
      var upd = op("update"), eq = ops.filter(function(o){ return o[0]==="eq"; }).find(function(o){ return o[1][0]==="id"; });
      if (upd && eq){ var id = eq[1][1], tr = lg._myTrades.find(function(x){ return x.id===id; }); if (!tr) return { data:[], error:null }; Object.assign(tr, upd[1][0]); if (tr.status!=="proposed") dropTrade(id); return { data:[{ id:id }], error:null }; }
      return { data: lg._myTrades.slice(), error:null };
    }
    if (table === "roster_spots" && op("update")) return { data:[{ id:"spot" }], error:null };
    var T = window.GUIDE_TABLES && window.GUIDE_TABLES[table];
    return { data: T ? T.slice() : [], error:null };
  };
  var origFrom = CG.sb.from;
  CG.sb.from = function(table){
    if (table !== "trades" && table !== "roster_spots") return origFrom(table);
    var ops = [];
    var p = new Proxy(function(){}, {
      get: function(_, k){
        if (k === "then") return function(res, rej){ return Promise.resolve(applyOps(table, ops)).then(res, rej); };
        if (k === "catch") return function(){ return p; };
        return function(){ ops.push([k, [].slice.call(arguments)]); return p; };
      },
      apply: function(){ return p; }
    });
    return p;
  };
  window.GUIDE_RPC = window.GUIDE_RPC || {};
  window.GUIDE_RPC.accept_trade = function(a){ dropTrade(a && a.p_trade); return { data:null, error:null }; };
  window.GUIDE_RPC.mgmt_request_move = function(a){
    var id = "m"+(++seq);
    lg._mgmtMoves.unshift({ id:id, team_id:t.id, page:CG.MGMT_ACTION_PAGE[a.p_action]||"roster", action:a.p_action, status:"pending", requested_by:uid, requester:{ gamertag:names[uid] }, summary:a.p_summary, created_at:new Date(CG.now()).toISOString() });
    return { data:id, error:null };
  };
  window.GUIDE_RPC.mgmt_decide_move = function(a){
    var mv = lg._mgmtMoves.find(function(x){ return x.id===a.p_id; });
    if (mv){ mv.status = a.p_approve ? "approved" : "denied"; mv.decided_at = new Date(CG.now()).toISOString(); mv.note = a.p_note || null; if (mv.action==="accept_trade") dropTrade("tr1"); }
    return { data:{ status: a.p_approve ? "approved" : "denied", error:null }, error:null };
  };
  window.GUIDE_RPC.mgmt_withdraw_move = function(a){ lg._mgmtMoves = lg._mgmtMoves.filter(function(x){ return x.id!==a.p_id; }); return { data:null, error:null }; };
  /* the roster page's cap outlook (this season + 3), from the same roster the page shows */
  window.GUIDE_RPC.team_cap_outlook = function(){
    var all = (lg.byTeam[my]||[]), mgmtPay = all.filter(function(p){ return p.mgmt; }).reduce(function(s,p){ return s+(p.salary||0); }, 0);
    return { data:[1,2,3,4].map(function(s){
      var deals = all.filter(function(p){ return !p.mgmt && p.origin!=="preseason_random" && (p.term||1) >= s; });
      var committed = deals.reduce(function(a,p){ return a+p.salary; }, 0) + mgmtPay;
      var ending = deals.filter(function(p){ return (p.term||1) === s; });
      return { season:s, current:s===1, committed:committed, space:CG.CAP-committed, management:mgmtPay,
        deals:deals.map(function(p){ return { name:p.tag, final:(p.term||1)===s }; }), expiring_after:ending.reduce(function(a,p){ return a+p.salary; }, 0) };
    }), error:null };
  };

  /* toasts stay up long enough to be captured (the live 2.6 s is too short for a headless shot) */
  CG.toast = function(msg, kind){
    var el = document.createElement("div");
    el.className = "toast"+(kind==="err"?" err":kind==="ok"?" ok":"");
    el.textContent = msg;
    var root = document.getElementById("toast-root"); if (root) root.appendChild(el);
    setTimeout(function(){ el.remove(); }, 30000);
  };
  /* capture helpers for the shot list: fixed-position chrome (the modal, the toast stack) moves
     when the capture driver grows the viewport to the document, so a shot pins it to document
     coordinates first. Nothing here changes what the page shows — only where a floating layer
     sits while the picture is taken. */
  window.GUIDE_PIN = {
    /* the open modal stays exactly where it is on screen, in document space */
    modal: function(){
      var m = document.querySelector(".modal"); if (!m) return false;
      var r = m.getBoundingClientRect();
      m.style.position = "absolute"; m.style.transform = "none"; m.style.margin = "0";
      m.style.top = (r.top + window.scrollY) + "px"; m.style.left = (r.left + window.scrollX) + "px";
      return true;
    },
    /* wrap an element and park the toast stack just under it, so one clip (#guide-clip) shows the
       control and the toast it produced */
    toastUnder: function(sel){
      var el = document.querySelector(sel), tr = document.getElementById("toast-root"); if (!el || !tr) return false;
      var w = document.getElementById("guide-clip");
      if (!w){ w = document.createElement("div"); w.id = "guide-clip"; w.style.position = "relative"; w.style.paddingBottom = "78px"; el.parentNode.insertBefore(w, el); w.appendChild(el); }
      tr.style.position = "absolute"; tr.style.bottom = "12px"; tr.style.left = "50%"; w.appendChild(tr);
      return true;
    },
    /* float the toast stack just below one element (a table row) without touching the markup */
    toastAt: function(sel, dy){
      var el = document.querySelector(sel), tr = document.getElementById("toast-root"); if (!el || !tr) return false;
      var r = el.getBoundingClientRect();
      tr.style.position = "absolute"; tr.style.bottom = "auto"; tr.style.top = (r.bottom + window.scrollY + (dy==null?14:dy)) + "px"; tr.style.left = (r.left + window.scrollX + r.width/2) + "px";
      return true;
    }
  };
} });
