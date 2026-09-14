/* DEMO LAYER — never deployed. Boots the live build against an in-memory league so the Team HQ
   Management page (v2.38 permissions + approvals) can be looked at without a Supabase session.
   Build: node src/live/build.cjs <out.html> ../../tools/demo/mgmt_layer.js
   Open:  out.html?as=owner#/hub/management  |  ?as=gm (Management opened for them)  |  ?as=agm (hidden by default) */
(function(){
  var qs = new URLSearchParams(location.search); var AS = qs.get("as") || "owner";
  var UIDS = { owner:"u-own", gm:"u-gm", agm:"u-agm" };
  var NAMES = { "u-own":"ItzPeakz", "u-gm":"Mr. Plow", "u-agm":"Jugg_PRKz", "u-p1":"FigurItOwt25", "u-p2":"Lemieux4ever" };
  /* a chainable, thenable stand-in for the Supabase client: every read answers empty, every
     write answers success, so buttons can be clicked to see the flow without touching anything */
  function chain(result){
    var p = new Proxy(function(){}, {
      get: function(_, k){
        if (k === "then") return function(res){ return Promise.resolve(result).then(res); };
        if (k === "catch") return function(){ return p; };
        return function(){ return p; };
      },
      apply: function(){ return p; }
    });
    return p;
  }
  CG.sb = {
    rpc: function(name, args){
      console.log("[demo] rpc", name, args);
      if (name === "set_team_mgmt_policy") return Promise.resolve({ data: args.p_policy, error:null });
      if (name === "mgmt_decide_move") return Promise.resolve({ data:{ status:"approved", error:null }, error:null });
      if (name === "mgmt_request_move") return Promise.resolve({ data:"demo-id", error:null });
      return Promise.resolve({ data:null, error:null });
    },
    from: function(){ return chain({ data:[], error:null }); },
    channel: function(){ return chain(null); }, removeChannel: function(){},
    auth: { getSession: function(){ return Promise.resolve({ data:{ session:{ access_token:"demo", user:{ id:UIDS[AS] } } } }); }, onAuthStateChange: function(){ return { data:{ subscription:{ unsubscribe:function(){} } } }; } }
  };
  CG.ensureSb = function(){};
  CG.bootLive = async function(){
    CG.lg = CG.buildLeague({});
    CG.SEASON = Object.assign({}, CG.SEASON, { id:"S1", number:1, registration_open:false });
    var t = CG.TEAMS[0];
    t.id = "t-"+t.code; t.owner = "u-own"; t.gm = "u-gm"; t.agm = "u-agm";
    CG.TEAMS.forEach(function(x){ if (!x.id) x.id = "t-"+x.code; });
    CG.lg._codeToId = {}; CG.lg._idToCode = {};
    CG.TEAMS.forEach(function(x){ CG.lg._codeToId[x.code] = x.id; CG.lg._idToCode[x.id] = x.code; });
    CG.lg._profName = NAMES;
    /* a few pre-season loans on the demo roster, one listed out of position, so the roster page's loan block can be seen */
    (function(){ var rs = (CG.lg.byTeam[t.code]||[]); rs.slice(-4).forEach(function(p, i){ p.origin = i===3 ? "latecomer_random" : "preseason_random"; p.spotId = p.spotId || ("spot-"+p.id); p.term = 1; });
      CG.lg._registrationsRaw = rs.slice(-4).map(function(p, i){ return { profile_id: p.id, position: i===0 ? (p.pos==="C" ? "LW" : "C") : p.pos, season_id: CG.SEASON.id, status: "assigned" }; }); })(); CG.lg._mgmtApps = []; CG.lg._myTrades = []; CG.lg._myOffers = []; CG.lg._appMsgs = {};
    /* the Owner has set a policy: the GM's roster and trades wait for approval, the AGM cannot see the draft */
    /* Management is the Owner's by default: the GM has been given it (read-only), the AGM has not */
    CG.lg._mgmtPolicy = { gm:{ roster:"approve", tradehub:"approve", management:"full" }, agm:{ draft:"hidden", freeagents:"approve" } };
    CG.lg._mgmtPolicyAt = new Date(CG.now() - 26*3600000).toISOString();
    var ago = function(h){ return new Date(CG.now() - h*3600000).toISOString(); };
    CG.lg._mgmtMoves = [
      { id:"m1", team_id:t.id, page:"tradehub", action:"accept_trade", status:"pending", requested_by:"u-gm", requester:{ gamertag:"Mr. Plow" }, summary:"accept the trade offer from Circuit Breakers", created_at:ago(0.4) },
      { id:"m2", team_id:t.id, page:"roster", action:"waive_player", status:"pending", requested_by:"u-gm", requester:{ gamertag:"Mr. Plow" }, summary:"waive FigurItOwt25", created_at:ago(3) },
      { id:"m3", team_id:t.id, page:"freeagents", action:"offer_free_agent", status:"pending", requested_by:"u-agm", requester:{ gamertag:"Jugg_PRKz" }, summary:"offer Lemieux4ever $1,250,000 × 2 seasons", created_at:ago(5) },
      { id:"m4", team_id:t.id, page:"roster", action:"roster_block", status:"approved", requested_by:"u-gm", requester:{ gamertag:"Mr. Plow" }, summary:"put Lemieux4ever on the trade block", created_at:ago(30), decided_at:ago(28), note:"Go ahead" },
      { id:"m5", team_id:t.id, page:"lines", action:"set_game_lineup", status:"failed", requested_by:"u-agm", requester:{ gamertag:"Jugg_PRKz" }, summary:"dress Line 1 vs Tundra Wolves · Tue Jul 14 9:00 PM ET", created_at:ago(50), decided_at:ago(47), result:"That game is final; its lineup can no longer be changed." },
      { id:"m6", team_id:t.id, page:"tradehub", action:"trade_propose", status:"denied", requested_by:"u-gm", requester:{ gamertag:"Mr. Plow" }, summary:"propose a trade to Midnight Icehawks (2 for 1)", created_at:ago(70), decided_at:ago(69), note:"Not for a first-rounder." }
    ];
    var uid = UIDS[AS];
    CG.auth = { user:{ id:uid }, profile:{ id:uid, gamertag:NAMES[uid], display_name:NAMES[uid], role:"member", in_guild:true }, role:"mgmt", registration:null, ownerApp:null };
    CG._notifs = []; CG._trades = [];
    CG.myClub = function(){ return t.code; };
    CG.loadManagerData = async function(){}; CG.loadMyLineups = function(){}; CG.loadAvailability = async function(){}; CG.loadTrades = async function(){}; CG.loadMyOffers = async function(){ return false; };
    CG.reloadLeague = async function(){ CG.renderChrome(); CG.router(); };
    CG.liveReload = function(){};
    CG.renderChrome();
    if (!location.hash) location.hash = "#/hub/management";
    CG.router();
  };
})();
