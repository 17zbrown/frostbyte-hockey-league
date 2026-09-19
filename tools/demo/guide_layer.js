/* GUIDE LAYER — never deployed. Boots the live build against an in-memory league so the member
   how-to guides (docs/guides) can be screenshotted without a Supabase session (2026-09-14).
   Grows out of mgmt_layer.js: the same thenable stub for CG.sb and the same fake session, plus
   the eight REAL clubs (names, colors, crests — fetched once from the teams table and pinned in
   tools/demo/clubs.json), a fixed clock so "tonight" always has games, a rostered-player persona,
   and per-page seed data so every screen a guide shows is populated the way a member sees it.
   Build: node src/live/build.cjs <out.html> ../../tools/demo/guide_layer.js
   Open:  out.html?as=owner|gm|agm|player&theme=light#/hub/…  */
(function(){
  var qs = new URLSearchParams(location.search); var AS = qs.get("as") || "owner";
  /* the theme is a query flag here so a headless capture never depends on the OS setting */
  var theme = qs.get("theme");
  if (theme){ try { var prefs = CG.store.get("prefs") || {}; prefs.theme = theme; CG.store.set("prefs", prefs); } catch(e){} document.documentElement.setAttribute("data-theme", theme); }
  var UIDS = { owner:"u-own", gm:"u-gm", agm:"u-agm", player:"u-p1" };
  var NAMES = { "u-own":"ItzPeakz", "u-gm":"Mr. Plow", "u-agm":"Jugg_PRKz", "u-p1":"FigurItOwt25", "u-p2":"Lemieux4ever" };
  window.GUIDE = { as: AS, qs: qs, uids: UIDS, names: NAMES };

  /* the real clubs, in the prototype's shape (the engine reads CG.TEAMS dynamically) */
  var CLUBS = window.GUIDE_CLUBS || [];
  if (CLUBS.length){
    CG.TEAMS = CLUBS.map(function(c, i){
      return { code:c.code, name:c.name, city:c.city||"", arena:c.arena||"", div:c.division||"East",
        color:String(c.color||"#8899A6").toUpperCase(), color2:c.color2?String(c.color2).toUpperCase():null,
        est:1, logo:c.logo_url||null, id:"t-"+c.code, leagueCode:"CGHL" };
    });
    CG.TEAM = {}; CG.TEAMS.forEach(function(t){ CG.TEAM[t.code]=t; });
    CG.TEAM_STRENGTH = {}; CG.TEAMS.forEach(function(t, i){ CG.TEAM_STRENGTH[t.code] = [.74,.68,.62,.58,.55,.5,.46,.42][i] || .5; });
    CG.DIVISIONS = ["East","West"];
    /* the prototype's trade seed names its own clubs by code; the live pages read _myTrades instead */
    CG.seedTrades = function(lg){ lg.blockSeed = []; lg.incoming = []; return lg; };
  }
  /* fixed clock: the prototype's demo evening (Wed Jul 15 2026, 8:45 PM ET) so tonight's slate,
     the T-30 lock and "tonight" cards all render the same way on every capture */
  CG._guideEpoch = Date.now();
  CG.now = function(){ return Date.parse(CG.DEMO_NOW_ISO) + (Date.now() - CG._guideEpoch); };

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
      console.log("[guide] rpc", name, args);
      var R = (window.GUIDE_RPC && window.GUIDE_RPC[name]);
      if (R) return Promise.resolve(R(args));
      if (name === "set_team_mgmt_policy") return Promise.resolve({ data: args.p_policy, error:null });
      if (name === "mgmt_decide_move") return Promise.resolve({ data:{ status:"approved", error:null }, error:null });
      if (name === "mgmt_request_move") return Promise.resolve({ data:"demo-id", error:null });
      return Promise.resolve({ data:null, error:null });
    },
    from: function(table){ var T = window.GUIDE_TABLES && window.GUIDE_TABLES[table]; return chain({ data: T ? T.slice() : [], error:null }); },
    channel: function(){ return chain(null); }, removeChannel: function(){},
    auth: { getSession: function(){ return Promise.resolve({ data:{ session:{ access_token:"demo", user:{ id:UIDS[AS] } } } }); }, onAuthStateChange: function(){ return { data:{ subscription:{ unsubscribe:function(){} } } }; } }
  };
  CG.ensureSb = function(){};
  CG.bootLive = async function(){
    CG.lg = CG.buildLeague({});
    /* v2.51: the season is a BASIC-format season (the league standard) — the same fields
       loadLeague derives from the season row, so the cap tiles, Squads meters, Road to N and
       every rule caption read the format in force rather than the prototype's $40M fallback */
    var FR = CG.FORMAT_RULES.basic;
    CG.SEASON = Object.assign({}, CG.SEASON, { id:"S1", number:1, registration_open:false, format:"basic", salary_cap:FR.salary_cap, roster_max:FR.roster_max });
    CG.CAP = FR.salary_cap; CG.ROSTER_MAX = FR.roster_max; CG.ROSTER_QUOTA = Object.assign({}, FR.quota); CG.CAMP_MAX = FR.camp_max;
    /* the prototype schedule carries no stage/status; the live rows always do (the Road to N
       card counts the regular-season games still to play) */
    (CG.lg.schedule||[]).forEach(function(g){ if (!g.stage) g.stage = "regular"; if (!g.status) g.status = g.at < CG.now() - 3*3600000 ? "final" : "scheduled"; });
    var t = CG.TEAMS[0];
    t.owner = "u-own"; t.gm = "u-gm"; t.agm = "u-agm";
    CG.lg._codeToId = {}; CG.lg._idToCode = {};
    CG.TEAMS.forEach(function(x){ CG.lg._codeToId[x.code] = x.id; CG.lg._idToCode[x.id] = x.code; });
    CG.lg._profName = NAMES;
    CG.lg._mgmtApps = []; CG.lg._myTrades = []; CG.lg._myOffers = []; CG.lg._appMsgs = {};
    CG.lg._mgmtPolicy = {}; CG.lg._mgmtPolicyAt = null; CG.lg._mgmtMoves = [];
    var uid = UIDS[AS];
    /* the rostered-player persona IS a player on the club: the session takes the first
       non-management forward's own id (stats and ratings are keyed by it), and his gamertag */
    if (AS === "player"){
      var mine = (CG.lg.byTeam[t.code]||[]).filter(function(p){ return !p.mgmt && p.pos !== "G"; })[0];
      if (mine){ uid = mine.id; NAMES[uid] = mine.tag; UIDS.player = uid; }
    }
    window.GUIDE.uid = uid;
    CG.auth = { user:{ id:uid }, profile:{ id:uid, gamertag:NAMES[uid], display_name:NAMES[uid], role:"member", in_guild:true, ea_id:NAMES[uid].replace(/[^A-Za-z0-9]/g,"")+"_EA", platform:"PS5" }, role: AS==="player" ? "member" : "mgmt", registration:null, ownerApp:null };
    CG._notifs = []; CG._trades = [];
    CG.myClub = function(){ return t.code; };
    CG.loadManagerData = async function(){}; CG.loadMyLineups = function(){}; CG.loadMyWeekLineups = function(){ return Promise.resolve(); }; CG.loadAvailability = async function(){}; CG.loadTrades = async function(){}; CG.loadMyOffers = async function(){ return false; };
    CG.reloadLeague = async function(){ CG.renderChrome(); CG.router(); };
    CG.liveReload = function(){};
    /* per-topic seeds live in tools/demo/seeds/<topic>.js: each pushes { name, run } onto
       window.GUIDE_SEEDS; ?seed=a,b runs only those (every seed runs when the flag is absent) */
    var want = (qs.get("seed")||"").split(",").map(function(s){ return s.trim(); }).filter(Boolean);
    (window.GUIDE_SEEDS||[]).forEach(function(seed){
      if (want.length && want.indexOf(seed.name) < 0) return;
      try { seed.run(CG, t, uid); } catch(e){ console.error("[guide] seed failed: "+seed.name, e); (window.__shootErrors=window.__shootErrors||[]).push("seed "+seed.name+": "+e.message); }
    });
    CG.renderChrome();
    if (!location.hash) location.hash = "#/hub";
    CG.router();
  };
})();
