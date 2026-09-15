/* seed: management — the Bruins' front office mid-season, the way the Owner / GM / AGM see it:
   all three seats held, an Owner-set policy (GM: Roster + Trade Hub wait for approval, Management
   opened read-only; AGM: Draft hidden, Free agents wait), three moves waiting and three decided,
   the free-agent board and the nominee pool the Nominate picker searches, tonight's lineups filed,
   and a bell with the notices the database would have written. Shapes: part_live.js MGMT_PAGES
   (:6198), mgmtMoveRow (:7952), mgmtSeatsTable (:7913), hubManagement (:8000), seasonPlayerIndex
   (:7061), hubFreeAgents (:11728), poolState (:5056).
   ?state=vacant-gm   → the GM seat is empty (required-seat note, chrome "Nominate", dashboard nudge)
   ?state=nominated   → the GM seat is empty and FigurItOwt25 is nominated (Pending reviewer vote,
                        "Withdraw this nomination", Messages with the league office)
   ?state=defaults    → no policy saved yet (the "Defaults: …" footer sentence) */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "management", run: function(CG, t, uid){
  var lg = CG.lg, now = CG.now(), st = window.GUIDE.qs.get("state") || "";
  var ago = function(h){ return new Date(now - h*3600000).toISOString(); };
  var club = function(code){ return (CG.TEAM[code] || {}).name || code; };
  var roster = lg.byTeam[t.code] || [];
  var tag = function(pos, depth){ var p = roster.find(function(x){ return x.pos===pos && x.depth===depth; }); return p ? p.tag : pos; };
  var names = lg._profName;                                   /* u-own ItzPeakz · u-gm Mr. Plow · u-agm Jugg_PRKz · u-p1 FigurItOwt25 · u-p2 Lemieux4ever */
  names["u-p3"] = "SnowBlindSam"; names["u-p4"] = "Trapezoid_Tom"; names["u-p5"] = "BackhandBecca";
  var GM = names["u-gm"], AGM = names["u-agm"];

  /* ---- the Owner's saved policy (Rule 2.6) ---- */
  if (st === "defaults"){ lg._mgmtPolicy = {}; lg._mgmtPolicyAt = null; }
  else {
    lg._mgmtPolicy = { gm:{ roster:"approve", tradehub:"approve", management:"full" }, agm:{ draft:"hidden", freeagents:"approve" } };
    lg._mgmtPolicyAt = ago(20);
  }

  /* ---- the approval queue: three waiting, three decided ---- */
  var waiveTag = tag("LD", 2), blockTag = tag("RD", 2);
  lg._mgmtMoves = [
    { id:"m1", team_id:t.id, page:"tradehub",   action:"accept_trade",     status:"pending",  requested_by:"u-gm",  requester:{ gamertag:GM },  summary:"accept the trade offer from "+club("DET"), created_at:ago(0.4) },
    { id:"m2", team_id:t.id, page:"roster",     action:"waive_player",     status:"pending",  requested_by:"u-gm",  requester:{ gamertag:GM },  summary:"waive "+waiveTag, created_at:ago(3) },
    { id:"m3", team_id:t.id, page:"freeagents", action:"offer_free_agent", status:"pending",  requested_by:"u-agm", requester:{ gamertag:AGM }, summary:"offer "+names["u-p2"]+" "+CG.fmtMoney(1250000)+" × 2 seasons", created_at:ago(5) },
    { id:"m4", team_id:t.id, page:"roster",     action:"roster_block",     status:"approved", requested_by:"u-gm",  requester:{ gamertag:GM },  summary:"put "+blockTag+" on the trade block", created_at:ago(30), decided_at:ago(28), note:"Go ahead" },
    { id:"m5", team_id:t.id, page:"lines",      action:"set_game_lineup",  status:"failed",   requested_by:"u-agm", requester:{ gamertag:AGM }, summary:"dress Line 1 vs "+club("SEA")+" · Tue Jul 14 9:00 PM ET", created_at:ago(50), decided_at:ago(47), result:"That game is final; its lineup can no longer be changed." },
    { id:"m6", team_id:t.id, page:"tradehub",   action:"trade_propose",    status:"denied",   requested_by:"u-gm",  requester:{ gamertag:GM },  summary:"propose a trade to "+club("PIT")+" (2 for 1)", created_at:ago(70), decided_at:ago(69), note:"Not for a first-rounder." }
  ];

  /* ---- the seats: every seat held unless a state empties the GM chair ---- */
  lg._mgmtApps = []; lg._appMsgs = {};
  if (st === "vacant-gm" || st === "nominated"){
    t.gm = null;
    /* a removed GM's queue goes with the seat: only the AGM's move is still waiting */
    lg._mgmtMoves = lg._mgmtMoves.filter(function(m){ return !(m.status === "pending" && m.requested_by === "u-gm"); });
  }
  if (st === "nominated"){
    lg._mgmtApps = [{ id:"a1", team_id:t.id, role:"gm", status:"pending", nominee_id:"u-p1", nominee:{ gamertag:names["u-p1"] }, submitted_by:"u-own", pitch:"Runs our lines every night and knows the cap.", created_at:ago(26) }];
    lg._appMsgs["management:a1"] = [
      { id:"am1", sender_id:"u-own", sender:{ gamertag:names["u-own"], role:"member" }, body:"He has run our lines all season and he is not under contract anywhere — happy to answer anything before the ballot.", created_at:ago(25) },
      { id:"am2", sender_id:"u-staff", sender:{ gamertag:"RefCam_Official", role:"staff" }, body:"Thanks — the reviewers have it. Ballot closes Friday night; you will see the decision here and on the seat.", created_at:ago(4) }
    ];
  }

  /* ---- the season and the pool the Nominate picker and the free-agent board read ---- */
  CG.SEASON = Object.assign({}, CG.SEASON, {
    roster_max:17, preseason_starts_at:"2026-06-24T00:00:00-04:00", signup_deadline_at:"2026-06-23T20:00:00-04:00",
    free_agency_opens_at:"2026-07-11T20:00:00-04:00", free_agency_closes_at:"2026-07-13T20:00:00-04:00"
  });
  lg.draftState = { status:"complete" };
  lg._rosteredIds = {}; lg.players.forEach(function(p){ lg._rosteredIds[p.id] = true; });
  lg._contractsRaw = []; lg._ownerApps = []; lg._staffApps = [];
  lg.preGp = { "u-p1":{ gp:6, g:4, a:3 }, "u-p2":{ gp:5, g:2, a:6 }, "u-p3":{ gp:4, g:1, a:1 }, "u-p4":{ gp:3, g:0, a:0 }, "u-p5":{ gp:6, g:3, a:2 } };
  lg.careerGp = {};
  var vets = { "u-p2":true, "u-p3":true };
  lg.isVeteran = function(pid){ return !!vets[pid]; };
  lg.isReturning = function(pid){ return !!lg.preGp[pid]; };
  /* profiles: the front office, the free agents, and the rostered prototype players by their own ids */
  lg._profilesRaw = [
    { id:"u-own", gamertag:names["u-own"], role:"member" }, { id:"u-gm", gamertag:names["u-gm"], role:"member" }, { id:"u-agm", gamertag:names["u-agm"], role:"member" },
    { id:"u-p1", gamertag:names["u-p1"], role:"member" }, { id:"u-p2", gamertag:names["u-p2"], role:"member" }, { id:"u-p3", gamertag:names["u-p3"], role:"member" },
    { id:"u-p4", gamertag:names["u-p4"], role:"member" }, { id:"u-p5", gamertag:names["u-p5"], role:"member" }
  ].concat(lg.players.map(function(p){ return { id:p.id, gamertag:p.tag, role:"member" }; }));
  lg._registrationsRaw = [
    { id:"r-p1", profile_id:"u-p1", position:"C",  scout_ovr:84, season_id:CG.SEASON.id, status:"registered", created_at:"2026-06-12T18:10:00-04:00", profiles:{ gamertag:names["u-p1"] } },
    { id:"r-p2", profile_id:"u-p2", position:"LW", scout_ovr:82, season_id:CG.SEASON.id, status:"registered", created_at:"2026-06-09T21:40:00-04:00", profiles:{ gamertag:names["u-p2"] } },
    { id:"r-p3", profile_id:"u-p3", position:"RD", scout_ovr:79, season_id:CG.SEASON.id, status:"registered", created_at:"2026-06-15T19:05:00-04:00", profiles:{ gamertag:names["u-p3"] } },
    { id:"r-p4", profile_id:"u-p4", position:"G",  scout_ovr:77, season_id:CG.SEASON.id, status:"registered", created_at:"2026-06-18T17:30:00-04:00", profiles:{ gamertag:names["u-p4"] } },
    { id:"r-p5", profile_id:"u-p5", position:"RW", scout_ovr:75, season_id:CG.SEASON.id, status:"registered", created_at:"2026-06-20T20:15:00-04:00", profiles:{ gamertag:names["u-p5"] } }
  ].concat(lg.players.map(function(p){ return { id:"r-"+p.id, profile_id:p.id, position:p.pos, season_id:CG.SEASON.id, status:"assigned", created_at:"2026-06-10T12:00:00-04:00", profiles:{ gamertag:p.tag } }; }));

  /* played games are final, so "Next" on the My club card is tonight's game, not week 1 */
  var done = {}; (lg.results || []).forEach(function(r){ done[r.id] = true; });
  (lg.schedule || []).forEach(function(g){ if (done[g.id]) g.status = "final"; });
  /* ---- tonight's lineups are filed, so the dashboard's Management tasks row is calm ---- */
  lg._lineups = lg._lineups || {};
  (lg.tonight || []).filter(function(g){ return g.home===t.code || g.away===t.code; }).forEach(function(g){
    var pick = function(pos){ var p = roster.find(function(x){ return x.pos===pos && x.depth===1; }); return p ? p.id : null; };
    lg._lineups[t.code+":"+g.id] = { team_id:t.id, game_id:g.id, lw:pick("LW"), center:pick("C"), rw:pick("RW"), ld:pick("LD"), rd:pick("RD"), goalie:pick("G") };
  });

  /* ---- the bell: what mgmt_request_move / mgmt_decide_move write for each seat (representative copy) ---- */
  var as = window.GUIDE.as;
  var mgmtRoute = "#/hub/management";
  if (as === "owner") CG._notifs = [
    { id:"n1", t:now - 24*60000,  icon:"flag", title:GM+" sent a move for your approval",  body:"Accept the trade offer from "+club("DET")+" — approve or deny it in Team HQ › Management.", read:false, route:mgmtRoute },
    { id:"n2", t:now - 3*3600000, icon:"flag", title:GM+" sent a move for your approval",  body:"Waive "+waiveTag+" — approve or deny it in Team HQ › Management.", read:false, route:mgmtRoute },
    { id:"n3", t:now - 5*3600000, icon:"flag", title:AGM+" sent a move for your approval", body:"Offer "+names["u-p2"]+" "+CG.fmtMoney(1250000)+" × 2 seasons — approve or deny it in Team HQ › Management.", read:false, route:mgmtRoute }
  ];
  else if (as === "gm") CG._notifs = [
    { id:"n1", t:now - 28*3600000, icon:"check", title:names["u-own"]+" approved your move", body:"Put "+blockTag+" on the trade block — it has been made. Note: Go ahead.", read:false, route:"#/hub/roster" },
    { id:"n2", t:now - 69*3600000, icon:"flag",  title:names["u-own"]+" denied your move",   body:"Propose a trade to "+club("PIT")+" (2 for 1) — nothing changed. Note: Not for a first-rounder.", read:false, route:"#/hub/tradehub" }
  ];
  else if (as === "agm") CG._notifs = [
    { id:"n1", t:now - 47*3600000, icon:"flag", title:names["u-own"]+" approved your move, but it could not be made", body:"Dress Line 1 vs "+club("SEA")+" — that game is final; its lineup can no longer be changed.", read:false, route:"#/hub/lines" }
  ];

  /* ---- the stubbed writes the page makes on this topic ---- */
  window.GUIDE_TABLES = window.GUIDE_TABLES || {};
  window.GUIDE_TABLES.management_applications = lg._mgmtApps.map(function(a){ return { id:a.id }; });
  window.GUIDE_RPC = window.GUIDE_RPC || {};
  window.GUIDE_RPC.mgmt_withdraw_move = function(){ return { data:null, error:null }; };
  window.GUIDE_RPC.owner_remove_manager = function(){ return { data:null, error:null }; };
  /* the roster page's cap outlook (team_cap_outlook): this season + 3, on the $250K lattice */
  var payroll = roster.reduce(function(s, p){ return s + (p.salary || 0); }, 0);
  window.GUIDE_RPC.team_cap_outlook = function(){ return { error:null, data:[
    { season:1, current:true, space:40000000 - payroll, committed:payroll, management:6000000, deals:roster.map(function(p, i){ return { name:p.tag, final:i < 3 }; }), expiring_after: 9250000 },
    { season:2, space:40000000 - 29250000, committed:29250000, management:6000000, deals:roster.slice(3).map(function(p, i){ return { name:p.tag, final:i < 4 }; }), expiring_after: 11500000 },
    { season:3, space:40000000 - 17750000, committed:17750000, management:6000000, deals:roster.slice(7).map(function(p, i){ return { name:p.tag, final:i < 3 }; }), expiring_after: 7250000 },
    { season:4, space:40000000 - 10500000, committed:10500000, management:6000000, deals:roster.slice(10).map(function(p){ return { name:p.tag, final:true }; }), expiring_after: 4500000 }
  ] }; };
} });
