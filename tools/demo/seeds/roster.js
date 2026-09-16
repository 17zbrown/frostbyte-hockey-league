/* seed: roster — Team HQ → Roster (#/hub/roster) and the Owner's approval queue (#/hub/management)
   populated the way the Bruins' front office sees them mid-season in the BASIC format (v2.51): a
   15-man active roster (two full lines plus three flex, management inside) plus two in camp, on
   the $250K salary lattice, one-season contracts, one player on the trade block, the cap outlook,
   the Owner's permission policy (the GM's roster moves need approval) and a queue of pending /
   decided moves. Games played are spread around the 18-game playoff floor (Rule 8.3) so the Road
   to 18 card shows a player already there, players who can still get there, and one who cannot. The CG.sb
   stub is taught the roster RPCs so a click really moves, waives, queues or approves in memory.
   Shapes: part_live.js rows (:340-370), team_cap_outlook (part6_hub.js:1633), mgmt moves (:7952).
   Variants (?state=):
     campfull   — (full format only: camp is unlimited in basic) three forwards in camp
     preseason  — a pre-season snapshot: five loans (one out of position), Road to 5, future
                  pre-season games, and the page's pre-season wording
     hidden     — the Owner withheld Roster from the AGM seat (?as=agm): the URL is refused */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "roster", run: function(CG, t, uid){
  var lg = CG.lg, club = t.code, st = window.GUIDE.qs.get("state") || "";
  var now = CG.now(), M = 1000000;
  var ago = function(h){ return new Date(now - h*3600000).toISOString(); };
  var names = window.GUIDE.names;

  /* ---- 1. the club: the prototype's twelve, re-tagged, plus six more ---- */
  var rs = lg.byTeam[club];
  function proto(pos, depth){ return rs.filter(function(p){ return p.pos===pos && p.depth===depth; })[0]; }
  /* [prototype slot or null, id (new only), tag, pos, salary, end_season, squad, ovr (new only), regular-season GP] */
  var plan = [
    [proto("RW",1), null,  "ItzPeakz",       "RW", 0,       1, "pro", null, 22],   /* Owner  — $0 (Rule 2.6) */
    [proto("C",1),  null,  "Mr. Plow",       "C",  3.0*M,   1, "pro", null, 20],   /* GM     — flat $3.0M   */
    [proto("LD",1), null,  "Jugg_PRKz",      "LD", 3.0*M,   1, "pro", null, 19],   /* AGM    — flat $3.0M   */
    [proto("LW",1), null,  "Frostbyte",      "LW", 3.75*M,  1, "pro", null, 21],
    [proto("LW",2), null,  "SnipeShowVI",    "LW", 2.25*M,  1, "pro", null, 18],   /* exactly at the floor */
    [proto("C",2),  null,  "TopShelfTy",     "C",  3.25*M,  1, "pro", null, 20],
    [proto("RW",2), null,  "FigurItOwt25",   "RW", 1.5*M,   1, "pro", null, 7],    /* the GM's queued waiver names him; cannot reach 18 */
    [proto("LD",2), null,  "Dangle Dan",     "LD", 2.5*M,   1, "pro", null, 14],
    [proto("RD",1), null,  "GlassEater",     "RD", 3.0*M,   1, "pro", null, 21],
    [proto("RD",2), null,  "CellyKing",      "RD", 1.75*M,  1, "pro", null, 12],   /* on the trade block */
    [proto("G",1),  null,  "IronWall_31",    "G",  3.5*M,   1, "pro", null, 19],
    [proto("G",2),  null,  "StonewallSt4n",  "G",  1.25*M,  1, "pro", null, 9],
    [null, "bx1",  "SauceBoss77",    "C",  2.0*M,   1, "pro", 79, 16],
    [null, "bx2",  "OneTimerOtto",   "RW", 1.5*M,   1, "pro", 74, 11],
    [null, "bx3",  "BodycheckBruno", "LD", 1.75*M,  1, "pro", 76, 20],
    [null, "bx5",  "BreakawayBex",   "LW", 0.75*M,  1, "tc",  68, 3],
    [null, "bx6",  "HipCheckHank",   "RD", 0.75*M,  1, "tc",  66, 2]
  ];
  var roster = [];
  plan.forEach(function(row){
    var p = row[0];
    if (!p){
      var src = rs.filter(function(x){ return x.pos===row[3]; })[0] || rs[0];
      p = JSON.parse(JSON.stringify(src));
      p.id = row[1]; p.mgmt = null; p.mgmtSalary = false; p.depth = 3; p.rookie = row[8] <= 3;   /* the camp pair are rookies */
      p.jersey = 40 + roster.length; p.eaId = row[2].replace(/[^A-Za-z0-9]/g,"")+"_EA";
      lg.ratings[p.id] = JSON.parse(JSON.stringify(lg.ratings[src.id])); lg.ratings[p.id].ovr = row[7];
      lg.pstats[p.id] = JSON.parse(JSON.stringify(lg.pstats[src.id]));
      if (lg.glog) lg.glog[p.id] = [];
      lg.players.push(p);
    }
    if (row[8] != null) lg.pstats[p.id].gp = row[8];   /* regular-season games played so far, around the 18-game floor */
    p.tag = row[2]; p.pos = row[3]; p.salary = row[4]; p.term = row[5]; p.squad = row[6];
    p.spotId = "spot-"+p.id; p.onBlock = false; p.origin = undefined; p.team = club;
    if (p.mgmt==="owner"||p.mgmt==="gm") p.mgmtSalary = true;
    roster.push(p);
  });
  names[roster[0].id] = roster[0].tag; names[roster[1].id] = roster[1].tag; names[roster[2].id] = roster[2].tag;
  var byTag = function(tag){ return roster.filter(function(p){ return p.tag===tag; })[0]; };
  byTag("CellyKing").onBlock = true;

  /* ---- variants ---- */
  if (st === "campfull"){
    /* three forwards in camp: camp is full, so every active-roster row can only "Swap…" */
    byTag("OneTimerOtto").squad = "tc"; byTag("SauceBoss77").squad = "tc";
    roster = roster.filter(function(p){ return p.tag !== "HipCheckHank"; });
  }
  var loans = [];
  if (st === "preseason"){
    /* the pre-season: a smaller contracted core, five loans filling the seats (Rule 0.4) */
    var gone = { SnipeShowVI:1, CellyKing:1, StonewallSt4n:1, FigurItOwt25:1, BreakawayBex:1, HipCheckHank:1 };
    roster = roster.filter(function(p){ return !gone[p.tag]; });
    /* [id, tag, listed pos, registered pos, origin, pre-season GP] */
    [["L1","PylonPete","RD","C","preseason_random",4],
     ["L2","MuffinMits","G","G","preseason_random",2],
     ["L3","NoLookNate","RW","RW","preseason_random",0],
     ["L4","ReboundRex","LW","LW","preseason_random",1],
     ["L5","YardSaleYan","RW","RW","latecomer_random",0]].forEach(function(L, i){
      var src = rs.filter(function(x){ return x.pos===L[2]; })[0] || rs[0];
      var p = JSON.parse(JSON.stringify(src));
      p.id = L[0]; p.tag = L[1]; p.pos = L[2]; p.team = club; p.mgmt = null; p.mgmtSalary = false; p.depth = 4;
      p.salary = 0; p.term = 1; p.squad = "pro"; p.spotId = "spot-"+p.id; p.onBlock = false; p.origin = L[4];   /* a loan is not a contract: no cap hit (Rule 0.4) */
      p.jersey = 60 + i; p.eaId = L[1]+"_EA"; p.rookie = true;
      lg.ratings[p.id] = JSON.parse(JSON.stringify(lg.ratings[src.id])); lg.ratings[p.id].ovr = 70 - i;
      lg.pstats[p.id] = JSON.parse(JSON.stringify(lg.pstats[src.id])); lg.pstats[p.id].gp = 0;
      if (lg.glog) lg.glog[p.id] = [];
      lg.players.push(p); roster.push(p); loans.push({ p:p, reg:L[3], gp:L[5] });
    });
    lg._registrationsRaw = loans.map(function(L){ return { profile_id:L.p.id, position:L.reg, season_id:CG.SEASON.id, status:"assigned" }; });
    lg.preGp = {}; loans.forEach(function(L){ if (L.p.origin==="preseason_random") lg.preGp[L.p.id] = { gp:L.gp }; });
    lg.isVeteran = function(pid){ return pid === "L4"; };   /* ReboundRex played before — exempt (Rule 2.8) */
    /* the club's next games are pre-season games: four left, Thu–Sat this week and next */
    lg.schedule = lg.schedule.filter(function(g){ return !((g.home===club||g.away===club) && g.at > now - 3*3600000); });
    lg.tonight = (lg.tonight||[]).filter(function(g){ return g.home!==club && g.away!==club; });
    [["DET",1],["SEA",3],["PIT",8],["VAN",10]].forEach(function(o, i){
      lg.schedule.push({ id:"pre"+i, week:1, night:"Thu", stage:"preseason", status:"scheduled",
        home:i%2?o[0]:club, away:i%2?club:o[0], at: now + o[1]*86400000 + 15*60000 });
    });
  }
  /* the six others keep the prototype's names; only this club is rewritten — except that the
     prototype's name pool hands some of THESE tags to other clubs too, and a trade offer that
     reads "you receive BreakawayBex" while a BreakawayBex sits in your own camp is a puzzle, so
     any collision on another club takes a spare name */
  var SPARES = ["SaucerPassSam","OneTouchOwen","BigBodyBrent","PointShotPaz","BreakoutBella","HipCheckHugo","GloveSideGus","WristerWes","DekeDoctorDee","CrashTheNetCal","FlowSeasonFinn","TopCheeseTy"];
  var mine = {}; roster.forEach(function(p){ mine[p.tag] = 1; });
  (lg.players||[]).forEach(function(p){ if (p.team !== club && mine[p.tag] && SPARES.length) p.tag = SPARES.shift(); });
  lg.byTeam[club] = roster;
  var ids = {}; roster.forEach(function(p){ ids[p.id] = 1; });
  lg.players = lg.players.filter(function(p){ return p.team!==club || ids[p.id]; });

  /* ---- 2. contracts (every deal runs to the end of this season — basic format, Rule 2.5) ---- */
  lg._contractsRaw = roster.filter(function(p){ return !p.origin; }).map(function(p){
    return { id:"c-"+p.id, profile_id:p.id, team_id:t.id, status:"active", is_manager:!!p.mgmt,
             start_season:1, end_season:p.term, salary:p.salary };
  });

  /* ---- 3. what the CG.sb stub answers: the roster_spots rows (the block toggle's select) ---- */
  window.GUIDE_TABLES = window.GUIDE_TABLES || {};
  function spots(){ return (lg.byTeam[club]||[]).map(function(p){ return { id:p.spotId, profile_id:p.id, team_id:t.id, season_id:CG.SEASON.id, position:p.pos, squad:p.squad, on_block:!!p.onBlock, origin:p.origin||"assigned" }; }); }
  window.GUIDE_TABLES.roster_spots = spots();

  /* ---- 4. the Owner's policy and the approval queue (v2.38) ---- */
  lg._mgmtPolicy = { gm:{ roster:"approve", tradehub:"approve" }, agm:{ freeagents:"approve" } };
  lg._mgmtPolicyAt = ago(26);
  if (st === "hidden") lg._mgmtPolicy.agm.roster = "hidden";   /* ?as=agm&state=hidden → the page is refused (Rule 2.6) */
  lg._mgmtMoves = [
    { id:"m1", team_id:t.id, page:"tradehub",   action:"accept_trade",     status:"pending",  requested_by:"u-gm",  requester:{ gamertag:names["u-gm"] },  summary:"accept the trade offer from Red Wings", created_at:ago(0.4) },
    { id:"m2", team_id:t.id, page:"roster",     action:"waive_player",     status:"pending",  requested_by:"u-gm",  requester:{ gamertag:names["u-gm"] },  summary:"waive FigurItOwt25", created_at:ago(3) },
    { id:"m3", team_id:t.id, page:"freeagents", action:"offer_free_agent", status:"pending",  requested_by:"u-agm", requester:{ gamertag:names["u-agm"] }, summary:"sign waived player Lemieux4ever at $750,000", created_at:ago(5) },
    { id:"m4", team_id:t.id, page:"roster",     action:"roster_block",     status:"approved", requested_by:"u-gm",  requester:{ gamertag:names["u-gm"] },  summary:"put CellyKing on the trade block", created_at:ago(30), decided_at:ago(28), note:"Go ahead" },
    { id:"m5", team_id:t.id, page:"lines",      action:"set_game_lineup",  status:"failed",   requested_by:"u-agm", requester:{ gamertag:names["u-agm"] }, summary:"dress Line 1 vs Kraken · Tue Jul 14 9:00 PM ET", created_at:ago(50), decided_at:ago(47), result:"That game is final; its lineup can no longer be changed." },
    { id:"m6", team_id:t.id, page:"tradehub",   action:"trade_propose",    status:"denied",   requested_by:"u-gm",  requester:{ gamertag:names["u-gm"] },  summary:"propose a trade to Islanders (2 for 1)", created_at:ago(70), decided_at:ago(69), note:"Not for a first-rounder." }
  ];

  /* ---- 5. the RPCs the page calls — each really changes the in-memory league ---- */
  var mgmtSalary = 6*M;   /* Owner $0 + GM $3.0M + AGM $3.0M (Rule 2.6) */
  function outlook(){
    var cs = (lg._contractsRaw||[]).filter(function(c){ return !c.is_manager && ids[c.profile_id] && (lg.byTeam[club]||[]).some(function(p){ return p.id===c.profile_id; }); });
    var tagOf = function(pid){ var p = (lg.byTeam[club]||[]).filter(function(x){ return x.id===pid; })[0]; return p ? p.tag : pid; };
    return [1,2,3,4].map(function(s){
      var deals = cs.filter(function(c){ return c.start_season<=s && c.end_season>=s; }).map(function(c){
        var next = cs.some(function(d){ return d.profile_id===c.profile_id && d.start_season===s+1; });
        return { name:tagOf(c.profile_id), final: c.end_season===s && !next, salary:c.salary };
      });
      var committed = deals.reduce(function(a,d){ return a+d.salary; },0) + mgmtSalary;
      return { season:s, current:s===1, space:CG.CAP-committed, committed:committed, management:mgmtSalary,
               deals:deals.map(function(d){ return { name:d.name, final:d.final }; }),
               expiring_after: deals.filter(function(d){ return d.final; }).reduce(function(a,d){ return a+d.salary; },0) };
    });
  }
  var bySpot = function(id){ return (lg.byTeam[club]||[]).filter(function(p){ return p.spotId===id; })[0]; };
  var moveN = 10;
  window.GUIDE_RPC = window.GUIDE_RPC || {};
  window.GUIDE_RPC.team_cap_outlook = function(){ return { data: outlook(), error:null }; };
  window.GUIDE_RPC.set_roster_squad = function(a){ var p = bySpot(a.p_spot); if (!p) return { data:null, error:{ message:"No such roster spot" } }; p.squad = a.p_squad; window.GUIDE_TABLES.roster_spots = spots(); return { data:true, error:null }; };
  window.GUIDE_RPC.swap_roster_squad = function(a){ var pro = bySpot(a.p_pro_spot), tc = bySpot(a.p_tc_spot); if (!pro||!tc) return { data:null, error:{ message:"No such roster spot" } }; pro.squad = "tc"; tc.squad = "pro"; window.GUIDE_TABLES.roster_spots = spots(); return { data:true, error:null }; };
  window.GUIDE_RPC.waive_player = function(a){
    var p = (lg.byTeam[club]||[]).filter(function(x){ return x.id===a.p_profile; })[0];
    if (!p) return { data:null, error:{ message:"He is not on your roster" } };
    lg.byTeam[club] = lg.byTeam[club].filter(function(x){ return x.id!==p.id; });
    lg.players = lg.players.filter(function(x){ return x.id!==p.id; });
    lg._contractsRaw = (lg._contractsRaw||[]).filter(function(c){ return c.profile_id!==p.id; });
    window.GUIDE_TABLES.roster_spots = spots();
    return { data:p.tag, error:null };
  };
  window.GUIDE_RPC.mgmt_request_move = function(a){
    var id = "m"+(++moveN);
    lg._mgmtMoves.unshift({ id:id, team_id:t.id, page:(CG.MGMT_ACTION_PAGE||{})[a.p_action]||"roster", action:a.p_action, status:"pending",
      requested_by:uid, requester:{ gamertag:names[uid] }, summary:a.p_summary, created_at:new Date(now).toISOString(), args:a.p_args });
    return { data:id, error:null };
  };
  window.GUIDE_RPC.mgmt_withdraw_move = function(a){ lg._mgmtMoves.forEach(function(m){ if (m.id===a.p_id){ m.status="withdrawn"; m.decided_at=new Date(now).toISOString(); } }); return { data:true, error:null }; };
  /* ---- 6. the waived-players board (Rule 2.2, basic): one player another club let go, signable
     at the league minimum until the movement deadline — what Team HQ → Free agents shows ---- */
  lg.draftState = lg.draftState || { status:"complete", season_number:1 };
  lg._registrationsRaw = (lg._registrationsRaw||[]).concat([{ id:"reg-lem", profile_id:"u-p2", season_id:CG.SEASON.id, position:"RD", status:"assigned", scout_ovr:78,
    created_at:new Date(now - 900*3600000).toISOString(), profiles:{ id:"u-p2", gamertag:names["u-p2"] } }]);
  lg._profilesRaw = (lg._profilesRaw||[]).concat([{ id:"u-p2", gamertag:names["u-p2"], display_name:names["u-p2"] }]);
  lg.preGp = lg.preGp || {};
  var waivedIds = { "u-p2":1 };
  var prevRet = lg.isReturning, prevVet = lg.isVeteran;
  lg.isReturning = function(pid){ return !!waivedIds[pid] || (prevRet ? prevRet(pid) : false); };
  lg.isVeteran = function(pid){ return !!waivedIds[pid] || (prevVet ? prevVet(pid) : false); };
  window.GUIDE_RPC.offer_free_agent = function(a){ return { data:"offer-demo", error:null }; };
  window.GUIDE_RPC.mgmt_decide_move = function(a){
    var m = lg._mgmtMoves.filter(function(x){ return x.id===a.p_id; })[0];
    if (!m) return { data:null, error:{ message:"No such move" } };
    m.status = a.p_approve ? "approved" : "denied"; m.decided_at = new Date(now).toISOString(); m.note = a.p_note||null;
    if (a.p_approve && m.action==="waive_player"){
      var tag = String(m.summary).replace(/^waive /,"");
      var p = (lg.byTeam[club]||[]).filter(function(x){ return x.tag===tag; })[0];
      if (p) window.GUIDE_RPC.waive_player({ p_profile:p.id });
    }
    return { data:{ status:m.status, error:null }, error:null };
  };
} });
