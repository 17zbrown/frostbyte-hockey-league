/* ================================================================
   LIVE DATA ADAPTER
   Replaces the simulated engine with real Supabase data. Builds the
   same CG.lg shape that CG.aggregate + the whole UI already consume,
   from real teams / rosters / contracts / games / transactions.
   Season 1 is pre-season, so results/stats are empty and the derived
   fields come out as clean zeros — the UI renders "not started yet".
   ================================================================ */
CG.LIVE_MODE = true;
CG.SB_URL = "https://bzbuyclwdhmhdzujxeqd.supabase.co";
CG.SB_KEY = "sb_publishable_9OVgiNJSCSKKp0NfnCwbBQ_W1rcrK3Z";
CG.sb = (window.supabase && window.supabase.createClient)
  ? window.supabase.createClient(CG.SB_URL, CG.SB_KEY, { auth:{ persistSession:true, autoRefreshToken:true } })
  : null;

/* real wall clock (the prototype used a frozen demo clock) */
CG._loadEpoch = Date.now();
CG.now = function(){ return Date.now(); };

/* real site identity (the static head still says "Platform Prototype") */
try {
  document.title = "Chel Gaming Hockey League";
  var _md = document.querySelector('meta[name="description"]');
  if (_md) _md.setAttribute("content", "The competitive home of 6v6 EA Sports NHL — schedules, standings, rosters, salary cap, trades, and the league rulebook.");
} catch(e){}

CG.LIVE = { loaded:false, error:null };

CG.buildLiveLeague = async function(){
  var sb = CG.sb;
  if (!sb) throw new Error("Supabase client unavailable");
  var q = await Promise.all([
    sb.from("teams").select("*"),
    sb.from("divisions").select("*").order("sort_order"),
    sb.from("seasons").select("*").order("number", { ascending:false }).limit(1),
    sb.from("profiles").select("*"),
    sb.from("roster_spots").select("*"),
    sb.from("contracts").select("*"),
    sb.from("games").select("*").order("scheduled_at"),
    sb.from("transactions").select("*").order("occurred_at", { ascending:false }),
    sb.from("news").select("*").order("published_at", { ascending:false })
  ]);
  var bad = q.find(function(r){ return r.error; });
  if (bad) throw new Error(bad.error.message || "query failed");
  var teamsRaw=q[0].data||[], divisions=q[1].data||[], season=(q[2].data||[])[0]||null,
      profiles=q[3].data||[], roster=q[4].data||[], contracts=q[5].data||[],
      games=q[6].data||[], transactions=q[7].data||[], news=q[8].data||[];

  /* ---- team registry (rebuilt from the DB: real logos, ids, management) ---- */
  var teamById={}, id2code={};
  CG.TEAMS = teamsRaw.map(function(t){
    var obj = { code:t.code, name:t.name, city:t.city||"", arena:t.arena||"",
      div:t.division||"East", color:(t.color||"#8899A6").toUpperCase(), est:t.founded_season||1,
      logo:t.logo_url||null, id:t.id,
      owner:t.owner_profile_id, gm:t.gm_profile_id, agm:t.agm_profile_id,
      eaClub:t.ea_club_name||null };
    teamById[t.id]=obj; id2code[t.id]=t.code; return obj;
  }).sort(function(a,b){ return (a.div===b.div?0:(a.div<b.div?-1:1)) || (a.code<b.code?-1:1); });
  CG.TEAM={}; CG.TEAMS.forEach(function(t){ CG.TEAM[t.code]=t; });
  CG.DIVISIONS = divisions.map(function(d){ return d.name; });

  /* ---- season + cap ---- */
  CG.SEASON = season || {};
  CG.CAP = (season && season.salary_cap) ? season.salary_cap : 60000000;
  CG.ROSTER_MAX = (season && season.roster_max) || 15;
  var seasonId = season ? season.id : null;

  /* ---- players from roster_spots (+ profile + contract) ---- */
  var profById={}; profiles.forEach(function(p){ profById[p.id]=p; });
  var contractByProf={}; contracts.forEach(function(c){
    /* prefer the active/current-season contract */
    if (!contractByProf[c.profile_id] || c.status==="active") contractByProf[c.profile_id]=c;
  });
  var depth={};
  var players = roster
    .filter(function(rs){ return !seasonId || rs.season_id===seasonId; })
    .map(function(rs){
      var p = profById[rs.profile_id] || {};
      var team = teamById[rs.team_id];
      if (!team) return null;
      var pos = rs.position || "C";
      var dk = team.code+":"+pos; depth[dk]=(depth[dk]||0)+1;
      var c = contractByProf[rs.profile_id];
      var mgmt = null;
      if (p.id===team.owner) mgmt="owner";
      else if (p.id===team.gm) mgmt="gm";
      else if (p.id===team.agm) mgmt="agm";
      else if (c && c.is_manager) mgmt="agm";
      return {
        id: rs.profile_id,
        tag: p.gamertag || p.display_name || "Player",
        team: team.code, pos: pos, depth: depth[dk],
        jersey: rs.jersey_number || p.jersey_number || 0,
        platform: p.platform || "—",
        arch: "Two-Way", shoots: "L", rookie: false, joined: "Season 1",
        overall: p.overall || 70,
        eaId: p.ea_id || "", avatar: p.avatar_url || null,
        banned: !!p.banned, discordId: p.discord_id,
        salary: (c && c.salary!=null) ? c.salary : (rs.salary||0),
        term: c ? Math.max(1, (c.end_season||1) - (c.start_season||1) + 1) : 1,
        mgmt: mgmt, mgmtSalary: (mgmt==="owner"||mgmt==="gm"),
        onBlock: false, status: rs.status || "active"
      };
    })
    .filter(Boolean);

  var byTeam={}; CG.TEAMS.forEach(function(t){ byTeam[t.code]=[]; });
  players.forEach(function(p){ (byTeam[p.team]=byTeam[p.team]||[]).push(p); });

  /* ---- schedule + results ---- */
  var schedule = games.map(function(g){
    return { id:g.id, week:g.week||1,
      home:id2code[g.home_team_id], away:id2code[g.away_team_id],
      at:Date.parse(g.scheduled_at), feature:false,
      code:g.game_code||null, server:g.server||null, status:g.status,
      homeScore:g.home_score, awayScore:g.away_score, ot:!!g.went_ot };
  }).filter(function(g){ return g.home && g.away && g.at; });

  var results = schedule
    .filter(function(g){ return g.status==="final" && g.homeScore!=null && g.awayScore!=null; })
    .map(function(g){
      var score={}; score[g.home]=g.homeScore; score[g.away]=g.awayScore;
      var box={}; box[g.home]={}; box[g.away]={};
      return { id:g.id, week:g.week, home:g.home, away:g.away, at:g.at,
        ot:g.ot, score:score, box:box, stars:[], entered:true };
    });

  var lg = { players:players, byTeam:byTeam, schedule:schedule, results:results,
             suspensions:[], demoNow:CG.now(), season:season, live:true };
  CG.aggregate(lg, {});

  /* stats-derived ratings are all-zero pre-season — use the real overalls */
  players.forEach(function(p){
    lg.ratings[p.id] = lg.ratings[p.id] || { parts:{} };
    lg.ratings[p.id].ovr = p.overall;
    lg.ratings[p.id].parts = lg.ratings[p.id].parts || {};
  });
  lg.teamRatings = lg.teamRatings || {};
  CG.TEAMS.forEach(function(t){
    var r = byTeam[t.code];
    var ovr = r.length ? Math.round(r.reduce(function(s,p){ return s+p.overall; },0)/r.length) : 70;
    lg.teamRatings[t.code] = lg.teamRatings[t.code] || {};
    lg.teamRatings[t.code].ovr = ovr;
  });

  /* tonight (none until the season starts), trades/archive come in later phases */
  lg.tonight = schedule.filter(function(g){ return g.status!=="final" && Math.abs(g.at-CG.now()) < 10*3600000; });
  lg.tonight.forEach(function(g){ g.feature=false; });
  lg.blockSeed = lg.blockSeed || [];
  lg.incoming = lg.incoming || [];
  lg.archive = {};
  lg.potw = lg.potw || [];
  lg.lastNight = lg.lastNight || [];

  /* real transaction log */
  lg.liveTransactions = transactions.map(function(tx){
    return { type:tx.type, text:tx.description||"", dateIso:(tx.occurred_at||"").slice(0,10) };
  });

  /* real newsroom — replace the prototype's simulated articles */
  if (CG.CONTENT){
    CG.CONTENT.articles = news.map(function(n){
      var paras = String(n.body||"").split(/\n\s*\n+/).map(function(s){ return s.trim(); }).filter(Boolean);
      if (!paras.length && n.body) paras = [String(n.body)];
      return {
        slug: n.id, title: n.title||"Untitled", category: n.category||"League News",
        excerpt: (paras[0]||"").slice(0,180), author: n.author||"CGHL Newsroom",
        dateIso: (n.published_at||n.created_at||"").slice(0,10) || "2026-01-01",
        featured: false, body: paras.length?paras:["—"], relatedTeams: [], tags: []
      };
    });
  }

  CG.LIVE.loaded = true;
  return lg;
};

/* ================================================================
   REAL AUTH — Discord OAuth via Supabase, replacing the demo-seat
   system. Role is derived from profiles.role + team management pointers.
   ================================================================ */
CG.auth = { user:null, profile:null, role:"guest" };
CG._guildTok = null;

/* user_role enum: {member, gm, commissioner, owner, agm, staff} -> prototype role keys */
CG.computeRole = function(profile){
  if (!profile) return "guest";
  if (profile.role === "commissioner") return "commish";
  /* manager if: their resolved roster entry has a mgmt role (teams pointers OR
     contracts.is_manager), their global role is a management role, or they're
     named on a team's owner/gm/agm pointer. */
  var player = CG.lg && CG.lg.players.find(function(p){ return p.id===profile.id; });
  var isMgr = (player && player.mgmt) ||
    ["owner","gm","agm"].indexOf(profile.role) >= 0 ||
    (CG.TEAMS||[]).some(function(t){ return profile.id===t.owner || profile.id===t.gm || profile.id===t.agm; });
  if (isMgr) return "mgmt";
  if (profile.role === "staff") return "staff";
  return "member";
};
CG.applySession = async function(session){
  CG.auth.user = session ? session.user : null;
  if (session && session.provider_token) CG.ensureInGuild(session.provider_token);
  if (CG.auth.user){
    try { var r = await CG.sb.from("profiles").select("*").eq("id", CG.auth.user.id).maybeSingle(); CG.auth.profile = r.data || null; }
    catch(e){ CG.auth.profile = null; }
  } else { CG.auth.profile = null; }
  CG.auth.role = CG.computeRole(CG.auth.profile);
  CG.enforceBan();
};
CG.initAuth = async function(){
  if (!CG.sb || !CG.sb.auth) return;
  try {
    var s = await CG.sb.auth.getSession();
    await CG.applySession(s && s.data ? s.data.session : null);
    CG.sb.auth.onAuthStateChange(function(_e, sess){
      CG.applySession(sess).then(function(){ if (CG.renderChrome) CG.renderChrome(); if (CG.router) CG.router(); });
    });
  } catch(e){ console.warn("auth init failed", e); }
};

/* --- live overrides of the demo persona system (defined in part4) --- */
CG.role = function(){ return (CG.auth && CG.auth.role) || "guest"; };
CG.persona = function(){
  var role = CG.role(), p = CG.auth.profile;
  var label = (CG.PERSONAS[role]||{}).label || (role.charAt(0).toUpperCase()+role.slice(1));
  var o = { key:role, label:label };
  if (p){
    o.tag = p.gamertag || p.display_name || "Member";
    o.avatar = p.avatar_url || null;
    o.who = o.tag + (role==="commish"?" · Commissioner":role==="mgmt"?" · Team management":role==="staff"?" · League staff":role==="member"?" · Member":"");
  } else { o.who = "Signed out"; }
  return o;
};
CG.me = function(){
  var p = CG.auth.profile; if (!p || !CG.lg) return null;
  return CG.lg.players.find(function(x){ return x.id===p.id; }) || null;
};
CG.avatarHtml = function(){
  var p = CG.auth.profile;
  if (p && p.avatar_url) return '<img src="'+p.avatar_url+'" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">';
  var tag = (p && (p.gamertag||p.display_name)) || "G";
  return esc(String(tag).slice(0,2).toUpperCase());
};
CG.setRole = function(){ /* no-op in live — role comes from the real session */ };

CG.signIn = function(){
  if (!CG.sb || !CG.sb.auth) return;
  CG.sb.auth.signInWithOAuth({ provider:"discord", options:{ redirectTo: window.location.origin + window.location.pathname, scopes:"identify email guilds.join" } });
};
CG.signOut = async function(){ if (CG.sb && CG.sb.auth){ try { await CG.sb.auth.signOut(); } catch(e){} } location.hash = "#/home"; };
/* login doubles as a Discord server invite (provider_token present only on fresh OAuth) */
CG.ensureInGuild = function(token){
  if (!token || CG._guildTok===token) return; CG._guildTok = token;
  try {
    fetch("/api/discord-join", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ access_token: token }) })
      .then(function(r){ return r.json().catch(function(){ return {}; }); })
      .then(function(j){ if (j && j.inGuild && CG.auth.profile) CG.auth.profile.in_guild = true; })
      .catch(function(){});
  } catch(e){}
};
CG.enforceBan = function(){
  var banned = CG.auth.profile && CG.auth.profile.banned;
  var ov = document.getElementById("banScreen");
  if (banned){
    if (!ov){ ov = document.createElement("div"); ov.id = "banScreen";
      ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(10,12,14,.97);display:flex;align-items:center;justify-content:center;padding:24px"; document.body.appendChild(ov); }
    ov.innerHTML = '<div style="max-width:440px;text-align:center;color:#fff">'+
      '<div style="font-size:40px">⛔</div><h2 style="font-family:var(--f-disp);margin:10px 0">Your access has been revoked</h2>'+
      '<p style="color:var(--on-ink-dim)">'+(CG.auth.profile.ban_reason?esc(CG.auth.profile.ban_reason):"Contact the league office.")+'</p>'+
      '<button class="btn btn-ghost" style="margin-top:16px" onclick="CG.signOut()">Sign out</button></div>';
    ov.style.display = "flex"; document.body.style.overflow = "hidden";
  } else if (ov){ ov.style.display = "none"; document.body.style.overflow = ""; }
};

/* --- real sign-in page (replaces the demo seat picker) --- */
CG.ROUTES.signin = function(){
  if (CG.auth && CG.auth.profile){
    var p = CG.auth.profile;
    return '<section class="sec"><div class="shell" style="max-width:620px;text-align:center">'+
      '<span class="eyebrow chr">Account</span><h1 class="h-page" style="margin-top:10px">You’re signed in</h1>'+
      '<p class="lede" style="margin:12px auto 22px">Signed in as <b>'+esc(p.gamertag||p.display_name||"member")+'</b>'+(p.role?' · '+esc(p.role):'')+'.</p>'+
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">'+
        '<a class="btn btn-chrome" href="#/hub">'+(CG.role()==="commish"?"Control Center":"My dashboard")+'</a>'+
        '<button class="btn btn-ghost" onclick="CG.signOut()">Sign out</button></div></div></section>';
  }
  return '<section class="sec"><div class="shell" style="max-width:640px;text-align:center">'+
    '<span class="eyebrow chr">One account for everything</span>'+
    '<h1 class="h-page" style="margin-top:10px">Sign in with Discord</h1>'+
    '<p class="lede" style="margin:12px auto 22px">Your Discord account is your league account. Not in the Chel Gaming server yet? Signing in adds you automatically and signs you into the site in one step.</p>'+
    '<button class="btn btn-lg" id="dcSignIn" style="background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button>'+
    '<p class="caption" style="margin-top:12px">Scopes requested: identify · email · guilds.join.</p></div></section>';
};
CG.AFTER.signin = function(){ var b = document.getElementById("dcSignIn"); if (b) b.addEventListener("click", function(){ CG.signIn(); }); };

/* ---------- async boot (replaces the sync CG.boot for the live build) ---------- */
CG.bootLive = async function(){
  var app = document.getElementById("app");
  if (app) app.innerHTML =
    '<section class="sec"><div class="shell"><div class="empty" style="padding:90px 20px">'+
    '<div class="e-art">'+(CG.ic?CG.ic("db",22):"")+'</div><b>Loading the league…</b>'+
    '<p>Pulling live teams, rosters, and the schedule from the league database.</p></div></div></section>';
  try {
    CG.lg = await CG.buildLiveLeague();
    await CG.initAuth();
  } catch(e){
    CG.LIVE.error = String(e && e.message || e);
    if (app) app.innerHTML =
      '<section class="sec"><div class="shell"><div class="empty" style="padding:80px 20px">'+
      '<div class="e-art">'+(CG.ic?CG.ic("flag",22):"")+'</div><b>Couldn’t load live data</b>'+
      '<p>'+(CG.esc?CG.esc(CG.LIVE.error):CG.LIVE.error)+'</p></div></div></section>';
    return;
  }
  CG.renderChrome();
  if (!location.hash) location.hash = "#/home";
  CG.router();
};

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", function(){ CG.bootLive(); });
else
  CG.bootLive();
