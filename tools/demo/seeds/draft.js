/* seed: draft — the Team HQ Draft desk (#/hub/draft), the public draft room (#/draft), pick trading in
   the Trade Hub and the roster page's "Road to 5" card, populated the way the Bruins' front office
   sees them around draft night. Source of the shapes: part_live.js CG.mapDraftData (:1023),
   CG.hubDraftLive (:4029), CG.ROUTES.draft (:3479), CG.tPicks (:11858), CG.roadToFive (:959).
   The demo's Supabase stand-in answers every read with [] — the draft desk re-reads the two draft
   tables on its first clock beat, so the refresh paths are stubbed here (before the first render)
   or the seeded pool and pick order would be wiped ten milliseconds after they appeared.

   ?state=  ready (default) · the order is generated, the draft has not started, a seven-name board
            locked   · the pre-season has not opened: no pool, no picks, the board card is locked
            covered  · ready + an eighteen-name board (coverage "covered")
            live     · the draft is live, Kraken on the clock at pick 1, Bruins pick 4th
            onclock  · three picks made, the Bruins on the clock at pick 4 (1:37 left)
            makeup   · the Bruins' R1 pick was skipped; live at their R2 pick (12) with a make-up waiting
            paused   · paused at pick 4 with 1:01 left
            approve  · (?as=gm) the Owner set Draft to "Owner approves"; one board save already waiting
            hidden   · (?as=agm) the Owner hid Draft from the AGM seat
            offer    · one incoming trade from Detroit: their #2 overall for the Bruins' #4 and a forward
            roadto5  · three pre-season loans on the roster at 5 / 3 / 1 games with three club games left */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "draft", run: function(CG, t, uid){
  var lg = CG.lg, me = t.code, now = CG.now();
  var st = window.GUIDE.qs.get("state") || "ready";
  var iso = function(ms){ return new Date(ms).toISOString(); };

  /* the demo's empty stand-in must never overwrite what is seeded below */
  CG.refreshDraftLite = function(){ return Promise.resolve(); };
  CG.loadSpectatorDraft = async function(){};
  lg._profName = lg._profName || {};
  lg.preGp = lg.preGp || {};
  lg._mgmtPolicy = lg._mgmtPolicy || {};
  /* the prototype engine rounds contracts to $100K; every real contract sits on the $250K lattice
     above the $750K minimum (Rule 2.5), so the club's own money reads right wherever it shows */
  (lg.byTeam[me]||[]).forEach(function(p){ if (!p.mgmt && p.salary) p.salary = Math.max(CG.MIN_SALARY, Math.round(p.salary/CG.SALARY_STEP)*CG.SALARY_STEP); });

  /* the eight real clubs in a Season 1 order: the commissioner's random draw (Rule 2.8) — the
     Bruins drew fourth. BASIC format (v2.51): the rounds are the season setting the commissioner
     publishes (CG.fmt("draft_rounds") is the working figure) and the order SNAKES — even rounds run
     in reverse. */
  var order = ["SEA","DET","UTA",me,"VAN","PIT","NYI","DAL"];
  var ROUNDS = CG.fmt("draft_rounds");

  /* ---- the registered player pool: 24 prospects with their pre-season lines ---- */
  /* [tag, pos, ovr, gp, g, a, veteran] — gp < 5 and not a veteran = not draft-eligible yet (Rule 2.8) */
  var POOL = [
    ["Sn1p3r_Kid","C",88,5,4,3], ["BlueLineBoss","LD",87,6,1,4,true], ["TopCheddar","RW",86,7,6,2],
    ["GloveSide88","G",85,5,0,0], ["Dangles4Days","LW",84,5,3,3], ["NetFrontNate","C",83,8,5,4],
    ["SauceMaster","RW",82,6,2,6], ["IronCurtain","RD",81,5,0,3,true], ["ClapBomb","LD",80,3,1,1],
    ["CrossCrease","LW",79,5,2,2], ["ToeDragTy","C",78,6,3,2], ["WallPlay","RD",77,2,0,1],
    /* two blue-liners answer a "blue" search: the guide's step-4 panel needs a typed query that
       narrows the pool to more than one name, so an Add button is still in frame after one is taken */
    ["BreakoutBen","RW",76,5,1,3], ["BlueCollarBo","LD",75,7,0,2], ["ButterflyBrad","G",74,4,0,0],
    ["OneTimerOllie","C",73,5,3,1], ["BarDownBilly","LW",72,6,4,0], ["PokeCheckPat","RD",71,5,0,1],
    ["FiveHoleFinn","G",70,5,0,0], ["SlapShotSam","RW",69,7,2,1], ["BackdoorBo","LW",68,5,1,2],
    ["DekeDylan","C",67,6,2,3], ["PadStackPaul","G",66,5,0,0], ["CycleKing","LD",65,5,0,2]
  ];
  var vets = {};
  var pool = POOL.map(function(r, i){
    var pid = "r"+(i+1);
    lg.preGp[pid] = { gp:r[3], g:r[4], a:r[5] };
    lg._profName[pid] = r[0];
    if (r[6]) vets[pid] = true;
    return { profileId:pid, tag:r[0], pos:r[1], ovr:r[2], eaId:null };
  });
  var prevVet = lg.isVeteran;
  lg.isVeteran = function(pid){ return !!vets[pid] || !!(prevVet && prevVet(pid)); };

  /* ---- the pick order: the published rounds, snaking (Rule 2.8 basic) ---- */
  function buildPicks(){
    var picks = [], ov = 0;
    for (var r = 1; r <= ROUNDS; r++) (r % 2 ? order : order.slice().reverse()).forEach(function(c){
      ov++;
      picks.push({ id:"pk"+ov, season:1, round:r, overall:ov, skipped:false, ownerCode:c, origCode:c,
                   playerId:null, playerName:null, used:false, pickedAt:null });
    });
    return picks;
  }
  function pick(id){ return lg.draftPicks.find(function(p){ return p.id===id; }); }
  /* a pick is made: the row fills, the player leaves the pool and joins the club at his round's pay */
  function makePick(id, pid, at){
    var p = pick(id), pr = pool.find(function(x){ return x.profileId===pid; });
    if (!p || !pr) return;
    p.used = true; p.playerId = pid; p.playerName = pr.tag; p.pickedAt = iso(at);
    lg.draftPool = lg.draftPool.filter(function(x){ return x.profileId!==pid; });
    lg.players.push({ id:pid, tag:pr.tag, team:p.ownerCode, pos:pr.pos, salary:CG.draftRoundSalary(p.round, ROUNDS), depth:2,
                      jersey:50+p.overall, platform:"PS5", rookie:true, eaId:pr.tag+"_EA", joined:"Jul 2026", talent:.5 });
    /* the masthead ticker and the leader boards read a stat row for every player on the league */
    if (lg.pstats) lg.pstats[pid] = pr.pos==="G"
      ? { gp:0,gs:0,w:0,l:0,otl:0,sa:0,sv:0,ga:0,so:0,qs:0, weekly:{} }
      : { gp:0,g:0,a:0,p:0,pm:0,shots:0,hits:0,blk:0,gv:0,tk:0,pim:0,fow:0,fot:0,gwg:0, weekly:{} };
  }
  function goLive(overall, secondsLeft){
    lg.draftState.status = "live";
    lg.draftState.current_overall = overall;
    lg.draftState.clock_ends_at = iso(Date.now() + secondsLeft*1000);
    lg.draftState.paused_remaining = null;
  }

  if (st === "locked"){
    /* before the pool is published: nothing to rank yet, no pick order — the board card is locked */
    lg.draftPool = []; lg.draftPicks = []; lg.draftState = null; lg._myBoard = [];
    CG.SEASON.preseason_starts_at = null;
    CG.SEASON.registration_deadline = "2026-07-23T23:59:00-04:00";
    CG.SEASON.draft_at = "2026-07-25T19:00:00-04:00";
    return;
  }

  lg.draftPool = pool.slice();
  lg.draftPicks = buildPicks();
  lg.draftState = { season_number:1, status:"setup", current_overall:0, pick_seconds:120, clock_ends_at:null, paused_remaining:null,
                    order_meta:{ style:"as_drawn", fallback:"random", rounds:ROUNDS, snake:true, codes:order.slice() } };
  /* the Bruins' private board: seven targets (everyone registered by the cutoff is eligible — Rule 2.8) */
  lg._myBoard = ["r1","r3","r4","r7","r9","r10","r13"];
  CG.SEASON.preseason_starts_at = null;
  CG.SEASON.registration_deadline = "2026-07-16T23:59:00-04:00";
  CG.SEASON.draft_at = "2026-07-18T19:00:00-04:00";

  /* the pick RPC, so the one-click and modal picks behave like the real desk: the toast fires, the
     room refreshes with the pick made and the next club on the clock */
  window.GUIDE_RPC = window.GUIDE_RPC || {};
  window.GUIDE_RPC.draft_make_pick = function(args){
    var p = pick(args.p_pick);
    if (!p || p.used) return { data:null, error:{ message:"That pick has already been used." } };
    makePick(p.id, args.p_player, Date.now());
    var nxt = lg.draftPicks.filter(function(x){ return !x.used && !x.skipped && x.overall > p.overall; }).sort(function(a,b){ return a.overall-b.overall; })[0];
    if (nxt && lg.draftState){ lg.draftState.current_overall = nxt.overall; lg.draftState.clock_ends_at = iso(Date.now() + (lg.draftState.pick_seconds||120)*1000); }
    return { data:{ ok:true }, error:null };
  };

  if (st === "covered"){
    lg._myBoard = ["r1","r2","r3","r4","r5","r6","r7","r8","r10","r11","r13","r14","r16","r17","r18","r19","r20","r21"];
  }
  if (st === "live"){
    goLive(1, 97);
  }
  if (st === "onclock" || st === "paused"){
    /* three picks in: BlueLineBoss → SEA, Dangles4Days → DET, TopCheddar → UTA (TopCheddar sat #2 on
       the Bruins' board, so his row is struck through "GONE · UTA") */
    makePick("pk1","r2", now - 3*95000); makePick("pk2","r5", now - 2*95000); makePick("pk3","r3", now - 95000);
    if (st === "onclock") goLive(4, 97);
    else { lg.draftState.status = "paused"; lg.draftState.current_overall = 4; lg.draftState.paused_remaining = 61; }
  }
  if (st === "makeup"){
    /* the Bruins' clock ran out at pick 4 — the pick is still theirs; the room is at their R2 pick */
    pick("pk4").skipped = true;
    var taken = { pk1:"r2", pk2:"r5", pk3:"r3", pk5:"r1", pk6:"r6", pk7:"r8", pk8:"r11", pk9:"r14", pk10:"r10", pk11:"r16" };
    var i = 0;
    Object.keys(taken).forEach(function(id){ makePick(id, taken[id], now - (11-i)*70000); i++; });
    goLive(12, 110);
  }
  if (st === "approve"){
    /* the Owner (ItzPeakz) approves the GM's draft moves; one board save is already in the queue */
    lg._mgmtPolicy.gm = Object.assign({}, lg._mgmtPolicy.gm, { draft:"approve" });
    lg._mgmtMoves = lg._mgmtMoves || [];
    lg._mgmtMoves.push({ id:"m7", team_id:t.id, page:"draft", action:"save_draft_board", status:"pending", requested_by:"u-gm",
      requester:{ gamertag:"Mr. Plow" }, summary:"save the draft board (7 ranked)", created_at:iso(now - 25*60000) });
  }
  if (st === "hidden"){
    lg._mgmtPolicy.agm = Object.assign({}, lg._mgmtPolicy.agm, { draft:"hidden" });
  }
  if (st === "offer"){
    /* Detroit offers its #2 overall for the Bruins' #4 and a depth forward */
    var fwd = (lg.byTeam[me]||[]).filter(function(p){ return !p.mgmt && p.origin!=="preseason_random" && p.pos!=="G" && p.depth===2; })[1]
           || (lg.byTeam[me]||[]).filter(function(p){ return !p.mgmt && p.pos!=="G"; })[0];
    lg._myTrades = [{ id:"tr-det-1", status:"proposed", from_team_id:"t-DET", to_team_id:t.id,
      offered_profile_ids:[], offered_pick_ids:["pk2"], requested_profile_ids:[fwd.id], requested_pick_ids:["pk4"],
      note:"Move up to #2 — we take your #4 and a depth forward for it.", created_at:iso(now - 3*3600000) }];
  }
  if (st === "roadto5"){
    /* the pre-season is still on: three randomly assigned loans on the roster (5 / 3 / 1 games), one
       late sign-up placed the same way, and three club games left to reach five */
    var rs = (lg.byTeam[me]||[]).filter(function(p){ return !p.mgmt; }).slice(-4);
    rs.forEach(function(p, i){ p.origin = i===3 ? "latecomer_random" : "preseason_random"; p.spotId = p.spotId || ("spot-"+p.id); p.term = 1; });
    lg.preGp[rs[0].id] = { gp:5, g:2, a:1 }; lg.preGp[rs[1].id] = { gp:3, g:0, a:2 }; lg.preGp[rs[2].id] = { gp:1, g:0, a:0 }; lg.preGp[rs[3].id] = { gp:2, g:1, a:0 };
    lg.schedule.push(
      { id:"prex1", stage:"preseason", status:"scheduled", week:1, night:"Thu", home:me, away:"DET", at: now + 86400000 },
      { id:"prex2", stage:"preseason", status:"scheduled", week:1, night:"Fri", home:"NYI", away:me, at: now + 2*86400000 },
      { id:"prex3", stage:"preseason", status:"scheduled", week:2, night:"Wed", home:me, away:"PIT", at: now + 7*86400000 });
    lg.draftPicks = []; lg.draftState = null;     /* the order is generated after the pre-season */
  }
} });

/* screenshot helpers for the draft shot list (tools/demo/shoot.mjs steps call these by eval) */
window.GUIDE_SHOT = {
  /* give the .card whose heading starts with `text` an id, so a clip can target it */
  card: function(text, id){
    var hs = [].slice.call(document.querySelectorAll(".card-h h3"));
    var h = hs.find(function(x){ return x.textContent.trim().indexOf(text)===0; });
    if (!h) throw new Error("no card headed "+text);
    h.closest(".card").id = id; return true;
  },
  /* the card headed `text`, capped so it ends on its table's last row — the search/filter panel
     that follows the board table is dropped, and the card's own bottom border closes the crop */
  cardTable: function(text, id){
    this.card(text, id);
    var c = document.getElementById(id), tw = c.querySelector(".tblwrap");
    if (!tw) throw new Error("no table inside "+text);
    c.style.maxHeight = Math.ceil(tw.getBoundingClientRect().bottom - c.getBoundingClientRect().top)+"px";
    c.style.overflow = "hidden"; return true;
  },
  /* the pick-by-pick card cut exactly on a round boundary: the height lands on the "ROUND n" divider
     row, so the last pick above it (the one on the clock) is whole, crest and bottom border included */
  cutAtRound: function(text, id, roundN){
    this.card(text, id);
    var c = document.getElementById(id);
    var td = [].slice.call(c.querySelectorAll("tbody tr td[colspan]"))
      .find(function(x){ return x.textContent.trim() === "ROUND "+roundN; });
    if (!td) throw new Error("no ROUND "+roundN+" divider in "+text);
    c.style.maxHeight = Math.round(td.closest("tr").getBoundingClientRect().top - c.getBoundingClientRect().top)+"px";
    c.style.overflow = "hidden"; return true;
  },
  /* the "You don’t have access to this area" refusal: its .empty block is page-wide with a 40ch
     column floating in the middle, so pull the art/heading/paragraph into a tight column to clip */
  refusal: function(){
    var e = document.querySelector(".empty"); if (!e) throw new Error("no refusal card");
    var w = document.createElement("div"); w.id = "shotRefuse";
    w.style.cssText = "max-width:460px;margin:0 auto";
    while (e.firstChild) w.appendChild(e.firstChild);
    e.appendChild(w); return true;
  },
  /* wrap consecutive siblings from `fromSel` through `toSel` in one div so both clip together */
  wrap: function(fromSel, toSel, id){
    var a = document.querySelector(fromSel), b = document.querySelector(toSel);
    if (!a || !b) throw new Error("wrap: missing "+(a?toSel:fromSel));
    var w = document.createElement("div"); w.id = id;
    a.parentNode.insertBefore(w, a);
    var n = a; while (n){ var nx = n.nextSibling; w.appendChild(n); if (n===b) break; n = nx; }
    return true;
  },
  /* a modal is position:fixed — pin it to page coordinates so an element clip (which grows the
     viewport to the document) captures it where it sat */
  pinModal: function(){
    var m = document.querySelector("#overlay-root .modal"); if (!m) throw new Error("no modal open");
    var r = m.getBoundingClientRect();
    m.style.animation = "none"; m.style.transform = "none"; m.style.position = "absolute";
    m.style.top = (r.top + window.scrollY)+"px"; m.style.left = (r.left + window.scrollX)+"px";
    m.style.maxHeight = "none"; m.style.width = r.width+"px";
    m.id = "shotModal"; return true;
  }
};
