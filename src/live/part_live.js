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
    sb.from("news").select("*").order("published_at", { ascending:false }),
    sb.from("draft_picks").select("id,season_number,round,original_team_id,current_team_id,player_id,used").order("season_number").order("round"),
    sb.from("season_registrations").select("id,profile_id,position,scout_ovr, profiles(gamertag,ea_id)")
  ]);
  /* first 9 are public-readable and required; the last two (draft_picks,
     season_registrations) are manager-gated by RLS and fail for guests —
     they're optional here and reloaded after auth for managers. */
  var bad = q.slice(0,9).find(function(r){ return r.error; });
  if (bad) throw new Error(bad.error.message || "query failed");
  var teamsRaw=q[0].data||[], divisions=q[1].data||[], season=(q[2].data||[])[0]||null,
      profiles=q[3].data||[], roster=q[4].data||[], contracts=q[5].data||[],
      games=q[6].data||[], transactions=q[7].data||[], news=q[8].data||[],
      draftPicks=(q[9]&&!q[9].error&&q[9].data)||[], registrations=(q[10]&&!q[10].error&&q[10].data)||[];

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

  /* draft board + pool (parity with the live site). Maps stored on lg so the
     manager-only data can be re-mapped after auth via CG.mapDraftData. */
  lg._idToCode = {}; lg._codeToId = {}; teamsRaw.forEach(function(t){ lg._idToCode[t.id] = t.code; lg._codeToId[t.code] = t.id; });
  lg._profName = {}; profiles.forEach(function(pr){ lg._profName[pr.id] = pr.gamertag || pr.display_name || "player"; });
  lg._rosteredIds = {}; roster.forEach(function(rs){ lg._rosteredIds[rs.profile_id] = true; });
  CG.mapDraftData(lg, draftPicks, registrations);

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
    /* the user's registration for the open season (for the Register flow) */
    CG.auth.registration = null; CG.auth.ownerApp = null;
    if (CG.auth.user && CG.SEASON && CG.SEASON.id){
      try { var rg = await CG.sb.from("season_registrations").select("*").eq("season_id", CG.SEASON.id).eq("profile_id", CG.auth.user.id).maybeSingle(); CG.auth.registration = rg.data || null; }
      catch(e){ CG.auth.registration = null; }
    }
    try { var oa = await CG.sb.from("owner_applications").select("*").eq("profile_id", CG.auth.user.id).maybeSingle(); CG.auth.ownerApp = oa.data || null; }
    catch(e){ CG.auth.ownerApp = null; }
  } else { CG.auth.profile = null; CG.auth.registration = null; CG.auth.ownerApp = null; }
  CG.auth.role = CG.computeRole(CG.auth.profile);
  await CG.loadManagerData();
  /* direct messages: load + subscribe on sign-in, tear down on sign-out */
  if (CG.auth.user){ CG.loadDMs().then(function(){ CG.subscribeDMs(); if(CG.renderChrome)CG.renderChrome(); if(location.hash.indexOf("/messages")>=0&&CG.router)CG.router(); }); }
  else { CG.teardownDMs && CG.teardownDMs(); }
  CG.enforceBan();
};
CG.teardownDMs = function(){
  CG._dm.msgs=[]; CG._dm.profiles={}; CG._dm.active=null; CG._dm.loaded=false;
  if(CG._dm.channel){ try{ CG.sb.removeChannel(CG._dm.channel); }catch(e){} CG._dm.channel=null; }
};
/* re-map the draft board/pool with the same maps the adapter built */
CG.mapDraftData = function(lg, draftPicks, registrations){
  var idToCode = lg._idToCode||{}, profName = lg._profName||{}, rostered = lg._rosteredIds||{};
  lg.draftPicks = (draftPicks||[]).map(function(p){
    return { id:p.id, season:p.season_number, round:p.round,
      ownerCode: idToCode[p.current_team_id]||null, origCode: idToCode[p.original_team_id]||null,
      playerId:p.player_id, playerName: p.player_id?(profName[p.player_id]||"a player"):null, used:!!p.used };
  });
  lg.draftPool = (registrations||[]).filter(function(r){ return !rostered[r.profile_id]; })
    .map(function(r){ return { profileId:r.profile_id, tag:(r.profiles&&r.profiles.gamertag)||"?", pos:r.position, ovr:(r.scout_ovr==null?null:r.scout_ovr), eaId:(r.profiles&&r.profiles.ea_id)||null }; })
    .sort(function(a,b){ return (b.ovr==null?-1:b.ovr)-(a.ovr==null?-1:a.ovr); });
  lg.registrationsCount = (registrations||[]).length;
};
/* manager-gated data (draft board + registrations) — loaded after auth for management */
CG.loadManagerData = async function(){
  if (!CG.sb || !CG.lg) return;
  var role = CG.auth.role;
  if (role!=="mgmt" && role!=="commish" && role!=="staff") return;
  try {
    var q = await Promise.all([
      CG.sb.from("draft_picks").select("id,season_number,round,original_team_id,current_team_id,player_id,used").order("season_number").order("round"),
      CG.sb.from("season_registrations").select("id,profile_id,position,scout_ovr,note, profiles(gamertag,ea_id,platform,jersey_number)")
    ]);
    var regs = (q[1]&&!q[1].error&&q[1].data)||[];
    CG.lg._registrationsRaw = regs;
    if ((q[0]&&!q[0].error) || (q[1]&&!q[1].error)){
      CG.mapDraftData(CG.lg, (q[0]&&!q[0].error&&q[0].data)||[], regs);
    }
    if (role==="commish"){
      var oa = await CG.sb.from("owner_applications").select("*, profiles(gamertag)").order("created_at",{ascending:false});
      CG.lg._ownerApps = (oa && !oa.error && oa.data) || [];
    }
  } catch(e){}
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
  /* match the current site's redirect exactly (origin only) so it stays within
     Supabase's existing Discord redirect allowlist */
  CG.sb.auth.signInWithOAuth({ provider:"discord", options:{ redirectTo: window.location.origin, scopes:"identify email guilds.join" } });
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

/* ================================================================
   PARITY: SEASON REGISTRATION (season_registrations)
   ================================================================ */
CG.ROUTES.register = function(){
  var s = CG.SEASON || {}, open = !!s.registration_open;
  var head = CG.pageHead(open ? "Season "+(s.number||1)+" · registration open" : "Registration",
    "Register for the season", "One form puts you in the player pool. The commissioner assigns roster spots from there.");
  if (!CG.auth.profile){
    return head + '<div class="shell" style="max-width:620px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("user",22)+'</div><b>Sign in to register</b>'+
      '<p>Your Discord account is your league account — signing in also adds you to the Chel Gaming Discord.</p>'+
      '<button class="btn btn-lg" id="dcSignIn" style="margin-top:18px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button></div></div></div>';
  }
  if (!open){
    return head + '<div class="shell" style="max-width:620px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("clock",22)+'</div><b>Registration isn’t open right now</b>'+
      '<p>'+(s.status==="active"?"Season "+s.number+" is already underway.":"Registration for the next season hasn’t opened yet — watch the announcements channel.")+'</p>'+
      '<a class="btn btn-ghost" style="margin-top:16px" href="#/schedule">View the schedule</a></div></div></div>';
  }
  var p = CG.auth.profile, reg = CG.auth.registration, eaMissing = !p.ea_id;
  var statusCard = reg ? '<div class="note grn" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">You’re registered for Season '+(s.number||1)+'.</b> Position on file: <b>'+esc(CG.POS_NAME[reg.position]||reg.position||"—")+'</b>. The commissioner assigns roster spots — you’ll be notified. Update your details below any time before the deadline.</div>' : "";
  var body = '<div class="card"><div class="card-h"><h3>'+(reg?"Update registration":"Register")+'</h3><span class="chip '+(reg?"chip-win":"chip-chrome")+'">'+(reg?"Registered":"Open")+'</span></div><div class="card-b">'+
    (eaMissing ? '<div class="note red" style="margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+CG.ic("flag",15)+'<span style="flex:1">You need your <b>EA ID</b> on file to register.</span><button class="btn btn-ghost btn-sm" id="regEaBtn">Add EA ID</button></div>'
                : '<label class="fld"><span>EA ID (on file)</span><input value="'+esc(p.ea_id)+'" disabled style="opacity:.7"></label>')+
    '<label class="fld"><span>Primary position</span></label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">'+
      ["C","LW","RW","LD","RD","G"].map(function(pos){ var on=(reg?reg.position:"C")===pos; return '<button type="button" class="chip '+(on?"chip-chrome":"")+'" data-regpos="'+pos+'" style="cursor:pointer;padding:8px 14px">'+CG.POS_NAME[pos]+'</button>'; }).join("")+'</div>'+
    '<label class="fld"><span>Note to the league office (optional)</span><textarea id="regNote" rows="3" placeholder="Availability, preferred club, anything the commissioner should know…">'+esc((reg&&reg.note)||"")+'</textarea></label>'+
    '<button class="btn btn-chrome" id="regSubmit"'+(eaMissing?" disabled":"")+'>'+(reg?"Update registration":"Submit registration")+'</button>'+
    '<p class="caption" style="margin-top:10px">You must be in the Chel Gaming Discord to register — signing in adds you automatically.</p>'+
  '</div></div>';
  return head + '<div class="shell" style="max-width:640px;padding-bottom:48px">'+statusCard+body+'</div>';
};
CG.AFTER.register = function(){
  var dc=document.getElementById("dcSignIn"); if(dc) dc.addEventListener("click", function(){ CG.signIn(); });
  var sel = (CG.auth.registration && CG.auth.registration.position) || "C";
  document.querySelectorAll("[data-regpos]").forEach(function(el){ el.addEventListener("click", function(){ sel=this.getAttribute("data-regpos"); document.querySelectorAll("[data-regpos]").forEach(function(x){ x.classList.toggle("chip-chrome", x===el); }); }); });
  var ea=document.getElementById("regEaBtn"); if(ea) ea.addEventListener("click", CG.promptEaId);
  var sub=document.getElementById("regSubmit"); if(sub) sub.addEventListener("click", function(){ CG.registerForSeason(sel, (document.getElementById("regNote")||{}).value||""); });
};
CG.promptEaId = function(){
  CG.modal("Add your EA ID",
    '<label class="fld"><span>EA ID / gamertag used in-game</span><input id="eaInput" placeholder="e.g. YourEAName" value="'+esc((CG.auth.profile||{}).ea_id||"")+'"></label><p class="caption">Shown to league staff for lobby verification; hidden from the public directory unless you opt in.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="eaSave">Save EA ID</button>');
  document.getElementById("eaSave").addEventListener("click", function(){
    var v=(document.getElementById("eaInput").value||"").trim();
    if(v.length<2){ CG.toast("Enter your EA ID","err"); return; }
    CG.saveEaId(v);
  });
};
CG.saveEaId = async function(v){
  if(!CG.sb||!CG.auth.user) return;
  var r = await CG.sb.from("profiles").update({ ea_id:v }).eq("id", CG.auth.user.id);
  if(r.error){ CG.toast("Couldn’t save EA ID: "+r.error.message,"err"); return; }
  CG.auth.profile.ea_id=v; if(CG.closeOverlay) CG.closeOverlay(); CG.toast("EA ID saved","ok"); CG.router();
};
CG.registerForSeason = async function(position, note){
  if(!CG.sb||!CG.auth.user){ CG.toast("Sign in first","err"); return; }
  var s=CG.SEASON; if(!s||!s.registration_open){ CG.toast("Registration isn’t open","err"); return; }
  if(!CG.auth.profile.ea_id){ CG.toast("Add your EA ID first","err"); CG.promptEaId(); return; }
  if(!CG.auth.profile.in_guild){
    try { var fr=await CG.sb.from("profiles").select("in_guild").eq("id",CG.auth.user.id).maybeSingle(); if(fr.data&&fr.data.in_guild) CG.auth.profile.in_guild=true; } catch(e){}
    if(!CG.auth.profile.in_guild){ CG.toast("Join the Chel Gaming Discord to register","err"); return; }
  }
  var payload={ season_id:s.id, profile_id:CG.auth.user.id, position:position||"C", note:(note||"").trim()||null };
  var r=await CG.sb.from("season_registrations").upsert(payload,{onConflict:"season_id,profile_id"});
  if(r.error){ CG.toast("Couldn’t register: "+r.error.message,"err"); return; }
  CG.auth.registration=payload;
  CG.toast("You’re registered for Season "+(s.number||1)+"!","ok"); CG.router();
};

/* ================================================================
   PARITY: OWNER APPLICATIONS (owner_applications)
   ================================================================ */
CG.ROUTES.owner = function(){
  var head = CG.pageHead("Run a club","Apply to own a team",
    "Owners set their club’s identity, hire a GM, and build the roster. Applications are tied to your Discord so the commissioners know who applied.");
  if (!CG.auth.profile){
    return head + '<div class="shell" style="max-width:640px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("shield",22)+'</div><b>Sign in to apply</b>'+
      '<p>Owner applications are tied to your Discord account so the commissioners know who applied.</p>'+
      '<button class="btn btn-lg" id="dcSignIn" style="margin-top:18px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button></div></div></div>';
  }
  var p = CG.auth.profile, a = CG.auth.ownerApp||{};
  var statusCard = CG.auth.ownerApp ? '<div class="note '+(a.status==="approved"?"grn":a.status==="denied"?"red":"chr")+'" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">Your application is '+esc((a.status||"pending").toUpperCase())+'.</b> Resubmit below to update it — the commissioners review every application.</div>' : "";
  var clubOpts = '<option value="">No preference</option>'+CG.TEAMS.map(function(t){ return '<option value="'+t.code+'"'+(a.preferred_club===t.code?" selected":"")+'>'+esc(t.name)+'</option>'; }).join("");
  var build = a.team_choice==="build";
  var body = '<div class="card"><div class="card-h"><h3>'+(CG.auth.ownerApp?"Update application":"Owner application")+'</h3><span class="chip chip-chrome">Season</span></div><div class="card-b">'+
    '<div class="grid g2"><label class="fld"><span>EA ID *</span><input id="ow-ea" placeholder="Your EA account name" value="'+esc(a.ea_id||p.ea_id||"")+'"></label>'+
      '<label class="fld"><span>Time zone</span><input id="ow-tz" placeholder="e.g. Eastern" value="'+esc(a.timezone||"")+'"></label></div>'+
    '<label class="fld"><span>Typical availability</span><input id="ow-avail" placeholder="e.g. Weeknights after 9 PM ET" value="'+esc(a.availability||"")+'"></label>'+
    '<label class="fld"><span>League / management experience</span><textarea id="ow-exp" rows="2" placeholder="Leagues you’ve played or managed in…">'+esc(a.experience||"")+'</textarea></label>'+
    '<label class="fld"><span>Club preference</span><select id="ow-choice"><option value="assigned"'+(!build?" selected":"")+'>Take an existing / assigned club</option><option value="build"'+(build?" selected":"")+'>Propose a brand-new club</option></select></label>'+
    '<div id="ow-assignedwrap" style="'+(build?"display:none":"")+'"><label class="fld"><span>Preferred club</span><select id="ow-club">'+clubOpts+'</select></label></div>'+
    '<div id="ow-buildwrap" class="grid g2" style="'+(build?"":"display:none")+'"><label class="fld"><span>Proposed team name</span><input id="ow-name" placeholder="e.g. Harbor Kraken" value="'+esc(a.proposed_name||"")+'"></label>'+
      '<label class="fld"><span>Proposed city / location</span><input id="ow-loc" placeholder="e.g. Nord Harbor" value="'+esc(a.proposed_location||"")+'"></label></div>'+
    '<label class="fld"><span>Why you? (pitch) *</span><textarea id="ow-pitch" rows="4" placeholder="Tell the commissioners why you’d make a great owner…">'+esc(a.pitch||"")+'</textarea></label>'+
    '<button class="btn btn-chrome" id="ow-submit">'+(CG.auth.ownerApp?"Update application":"Submit application")+'</button>'+
  '</div></div>';
  return head + '<div class="shell" style="max-width:720px;padding-bottom:48px">'+statusCard+body+'</div>';
};
CG.AFTER.owner = function(){
  var dc=document.getElementById("dcSignIn"); if(dc) dc.addEventListener("click", function(){ CG.signIn(); });
  var ch=document.getElementById("ow-choice");
  if(ch) ch.addEventListener("change", function(){
    var build=this.value==="build";
    var aw=document.getElementById("ow-assignedwrap"), bw=document.getElementById("ow-buildwrap");
    if(aw) aw.style.display=build?"none":""; if(bw) bw.style.display=build?"":"none";
  });
  var sub=document.getElementById("ow-submit"); if(sub) sub.addEventListener("click", CG.submitOwnerApp);
};
CG.submitOwnerApp = async function(){
  if(!CG.sb||!CG.auth.user){ CG.toast("Sign in first","err"); return; }
  function v(id){ var el=document.getElementById(id); return el?(el.value||"").trim():""; }
  var ea=v("ow-ea"), pitch=v("ow-pitch"), choice=(document.getElementById("ow-choice")||{}).value||"assigned";
  if(!ea){ CG.toast("EA ID is required","err"); return; }
  if(!pitch){ CG.toast("Add a short pitch","err"); return; }
  var propName = choice==="build" ? (v("ow-name")||null) : null;
  if(choice==="build" && !propName){ CG.toast("Name your proposed team (or pick an assigned club)","err"); return; }
  var payload={ season_id: CG.SEASON?CG.SEASON.id:null, profile_id: CG.auth.user.id, ea_id:ea,
    timezone:v("ow-tz")||null, availability:v("ow-avail")||null, experience:v("ow-exp")||null,
    team_choice:choice, preferred_club: choice==="build"?null:((document.getElementById("ow-club")||{}).value||null),
    proposed_name:propName, proposed_location: choice==="build"?(v("ow-loc")||null):null,
    pitch:pitch, status:"pending", updated_at:new Date().toISOString() };
  var r=await CG.sb.from("owner_applications").upsert(payload,{onConflict:"profile_id"});
  if(r.error){ CG.toast("Couldn’t submit: "+r.error.message,"err"); return; }
  CG.auth.ownerApp=payload; CG.toast("Application submitted — the commissioners will review it","ok"); CG.router();
};

/* ================================================================
   PARITY: DRAFT ROOM (draft_picks + season_registrations pool)
   Management/commish watch view; the commissioner runs picks from
   the Control Center via the use_draft_pick RPC.
   ================================================================ */
CG.ROUTES.draft = function(){
  var lg = CG.lg, role = CG.role();
  var head = CG.pageHead("The draft room","Draft board","The commissioner runs the draft live — the board, prospect pool, and results update as picks are made.");
  if (role!=="mgmt" && role!=="commish" && role!=="staff"){
    return head + '<div class="shell" style="max-width:640px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("lock",22)+'</div><b>Managers only</b><p>The draft board and prospect pool are visible to club management and the league office.</p></div></div></div>';
  }
  var picks = lg.draftPicks||[];
  if (!picks.length){
    return head + '<div class="shell" style="max-width:640px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("users",22)+'</div><b>No draft has been set up yet</b><p>When the commissioner builds the board, the picks, prospect pool, and live results appear here.</p></div></div></div>';
  }
  var maxSn = Math.max.apply(null, picks.map(function(p){ return p.season; }));
  var cur = picks.filter(function(p){ return p.season===maxSn; });
  var total = cur.length, made = cur.filter(function(p){ return p.used; }).length;
  var myClub = CG.myClub && CG.myClub();
  var mine = cur.filter(function(p){ return p.ownerCode===myClub; }).sort(function(a,b){ return a.round-b.round; });
  var myOpen = mine.filter(function(p){ return !p.used; });
  var pool = lg.draftPool||[];
  var rounds = {}; cur.forEach(function(p){ (rounds[p.round]=rounds[p.round]||[]).push(p); });
  var roundNums = Object.keys(rounds).map(Number).sort(function(a,b){ return a-b; });

  var summary = '<div class="grid g3" style="margin-bottom:20px">'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:22px">'+made+' / '+total+'</b><span>picks made</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:22px">'+pool.length+'</b><span>prospects available</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:22px'+(myOpen.length?';color:var(--chrome-deep)':'')+'">'+(role==="mgmt"?myOpen.length:"—")+'</b><span>'+(role==="mgmt"?"your open picks":"Season "+maxSn+" draft")+'</span></div></div>';

  var board = '<div class="card"><div class="card-h"><h3>Season '+maxSn+' board</h3><span class="chip">'+roundNums.length+' rounds</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption>Draft board by round</caption><thead><tr><th>Rd</th><th class="tleft">Club</th><th class="tleft">Origin</th><th class="tleft">Result</th></tr></thead><tbody>'+
    roundNums.map(function(rd){
      return rounds[rd].slice().sort(function(a,b){ return (a.ownerCode||"").localeCompare(b.ownerCode||""); }).map(function(p){
        var isMine = p.ownerCode===myClub;
        return '<tr'+(isMine?' style="background:var(--chrome-tint)"':"")+'><td class="tnum">R'+p.round+'</td>'+
          '<td class="tleft"><span class="teamcell">'+(p.ownerCode?CG.crest(p.ownerCode,18):"")+'<span class="mono" style="font-size:11px">'+esc(p.ownerCode||"—")+'</span></span></td>'+
          '<td class="tleft small" style="color:var(--steel)">'+(p.origCode&&p.origCode!==p.ownerCode?"via "+esc(p.origCode):"—")+'</td>'+
          '<td class="tleft">'+(p.used?'<span class="chip chip-win">'+esc(p.playerName||"Drafted")+'</span>':'<span class="caption">On the board</span>')+'</td></tr>';
      }).join("");
    }).join("")+'</tbody></table></div></div>';

  var poolCard = '<div class="card"><div class="card-h"><h3>Prospect pool</h3><span class="chip">'+pool.length+' available</span></div>'+
    (pool.length ? '<div class="card-b" style="padding-top:8px"><p class="caption" style="margin-bottom:10px">Registered players not yet on a roster, ranked by the commissioner’s scouted overall.</p>'+
      pool.slice(0,40).map(function(pr,i){
        return '<div class="leaderrow" style="cursor:default"><span class="rk num">'+(i+1)+'</span>'+
          '<span style="min-width:0"><b style="font-size:13.5px">'+esc(pr.tag)+'</b><small style="display:block" class="caption">'+(CG.POS_NAME[pr.pos]||pr.pos)+(pr.eaId?" · EA: "+esc(pr.eaId):"")+'</small></span>'+
          '<span class="val"><b class="num">'+(pr.ovr!=null?pr.ovr:"—")+'</b><span>'+(pr.ovr!=null?"OVR":"unrated")+'</span></span></div>';
      }).join("")+'</div>'
      : '<div class="card-b"><p class="caption">No prospects available yet — the pool fills from season registrations that haven’t been assigned to a club.</p></div>')+'</div>';

  return head + '<div class="shell" style="padding-bottom:48px">'+summary+
    '<div class="grid g23" style="align-items:start">'+board+poolCard+'</div></div>';
};

/* ================================================================
   PARITY: DIRECT MESSAGES (direct_messages + realtime + mark_dm_read)
   ================================================================ */
CG._dm = { msgs:[], profiles:{}, active:null, loaded:false, channel:null, filter:"" };
CG._DM_SEL = "id,gamertag,display_name,avatar_url,discord_username";
CG.dmUid = function(){ return CG.auth.user ? CG.auth.user.id : null; };
CG.dmOtherId = function(m){ var me=CG.dmUid(); return m.sender_id===me ? m.recipient_id : m.sender_id; };
CG.dmName = function(id){ var p=CG._dm.profiles[id]; return p ? (p.gamertag||p.display_name||"Member") : "Member"; };
CG.dmAva = function(id){ var p=CG._dm.profiles[id];
  if (p&&p.avatar_url) return '<img src="'+p.avatar_url+'" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0">';
  return '<span class="avatar" style="width:38px;height:38px;flex-shrink:0">'+esc(String(CG.dmName(id)).slice(0,2).toUpperCase())+'</span>';
};
CG.dmUnreadTotal = function(){ var me=CG.dmUid(); return CG._dm.msgs.filter(function(m){ return m.recipient_id===me && !m.read_at; }).length; };
CG.loadDMs = async function(){
  if (!CG.sb || !CG.dmUid()) return;
  var me=CG.dmUid();
  try {
    var r = await CG.sb.from("direct_messages").select("*").or("sender_id.eq."+me+",recipient_id.eq."+me).order("created_at",{ascending:true});
    CG._dm.msgs = r.data||[];
    var need = {}; CG._dm.msgs.forEach(function(m){ var o=CG.dmOtherId(m); if(o&&!CG._dm.profiles[o]) need[o]=1; });
    var ids = Object.keys(need);
    if (ids.length){ var ps = await CG.sb.from("profiles").select(CG._DM_SEL).in("id",ids); (ps.data||[]).forEach(function(p){ CG._dm.profiles[p.id]=p; }); }
  } catch(e){}
  CG._dm.loaded = true;
};
CG.dmConvos = function(){
  var me=CG.dmUid(), map={};
  CG._dm.msgs.forEach(function(m){ var o=CG.dmOtherId(m); (map[o]=map[o]||{other:o,msgs:[]}).msgs.push(m); });
  return Object.keys(map).map(function(k){ var c=map[k]; c.last=c.msgs[c.msgs.length-1]; c.unread=c.msgs.filter(function(m){return m.recipient_id===me&&!m.read_at;}).length; return c; })
    .sort(function(a,b){ return new Date(b.last.created_at)-new Date(a.last.created_at); });
};
CG.dmMarkRead = async function(other){
  var me=CG.dmUid();
  var unread = CG._dm.msgs.filter(function(m){ return m.sender_id===other&&m.recipient_id===me&&!m.read_at; });
  if (!unread.length) return;
  var iso=new Date().toISOString(); unread.forEach(function(m){ m.read_at=iso; });
  CG.renderChrome();
  try { await CG.sb.rpc("mark_dm_read",{p_other:other}); } catch(e){}
};
CG.dmSend = async function(){
  var inp=document.getElementById("dmInput"); if(!inp||!CG._dm.active) return;
  var body=inp.value.trim(); if(!body) return;
  inp.value="";
  var r = await CG.sb.from("direct_messages").insert({ sender_id:CG.dmUid(), recipient_id:CG._dm.active, body:body }).select().single();
  if(r.error){ CG.toast(/banned/i.test(r.error.message)?"That player can’t receive messages":"Couldn’t send: "+r.error.message,"err"); inp.value=body; return; }
  CG._dm.msgs.push(r.data); CG.router();
};
CG.subscribeDMs = function(){
  if(!CG.sb||!CG.dmUid()||CG._dm.channel) return;
  var me=CG.dmUid();
  try {
    CG._dm.channel = CG.sb.channel("dm-"+me)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"direct_messages",filter:"recipient_id=eq."+me},function(payload){
        var m=payload.new; if(!m||CG._dm.msgs.find(function(x){return x.id===m.id;})) return;
        CG._dm.msgs.push(m);
        var onView = location.hash.indexOf("/messages")>=0;
        var finish=function(){ CG.renderChrome(); if(onView) CG.router(); else CG.toast("New message from "+CG.dmName(m.sender_id),"ok"); };
        if(!CG._dm.profiles[m.sender_id]){ CG.sb.from("profiles").select(CG._DM_SEL).eq("id",m.sender_id).maybeSingle().then(function(res){ if(res.data)CG._dm.profiles[res.data.id]=res.data; finish(); }); }
        else finish();
      }).subscribe();
  } catch(e){}
};
CG.ROUTES.messages = function(param){
  var head = CG.pageHead("Direct messages","Messages","Private messages with other league members — managers, staff, and the commissioner.");
  if (!CG.auth.profile){
    return head + '<div class="shell" style="max-width:620px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("msg",22)+'</div><b>Sign in to message</b><p>Direct messages are tied to your Discord account.</p>'+
      '<button class="btn btn-lg" id="dcSignIn" style="margin-top:18px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button></div></div></div>';
  }
  if (!CG._dm.loaded){
    return head + '<div class="shell" style="padding-bottom:48px"><div class="card"><div class="card-b" id="dmLoading"><p class="caption">Loading conversations…</p></div></div></div>';
  }
  var me=CG.dmUid(), convos=CG.dmConvos(), active=CG._dm.active;
  var list = convos.slice();
  if (active && !list.find(function(c){return c.other===active;})) list.unshift({other:active,msgs:[],last:null,unread:0});
  var listHtml = list.length ? list.map(function(c){
    var prev = c.last ? ((c.last.sender_id===me?"You: ":"")+c.last.body) : "New conversation";
    return '<div class="notif'+(c.other===active?" unread":"")+'" data-dm-open="'+c.other+'" style="cursor:pointer'+(c.other===active?';background:var(--chrome-tint)':"")+'">'+CG.dmAva(c.other)+
      '<span style="min-width:0;flex:1"><b style="font-family:var(--f-disp);font-size:13.5px">'+esc(CG.dmName(c.other))+'</b>'+
      '<p style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(prev)+'</p></span>'+
      (c.unread?'<span class="hs-n">'+(c.unread>9?"9+":c.unread)+'</span>':"")+'</div>';
  }).join("") : '<div class="empty" style="padding:40px 16px"><b>No conversations yet</b><p>Open a member’s profile to start one.</p></div>';
  var thread;
  if (!active){ thread = '<div class="empty" style="padding:70px 20px"><div class="e-art">'+CG.ic("msg",20)+'</div><b>Pick a conversation</b><p>Your messages appear here.</p></div>'; }
  else {
    var msgs = CG._dm.msgs.filter(function(m){ return CG.dmOtherId(m)===active; });
    var body = msgs.length ? msgs.map(function(m){
      var mine = m.sender_id===me;
      return '<div style="max-width:78%;align-self:'+(mine?"flex-end":"flex-start")+';background:'+(mine?"var(--chrome)":"var(--ice)")+';color:'+(mine?"#101519":"var(--ink)")+';padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.45">'+esc(m.body)+
        '<span style="display:block;font-size:10px;opacity:.6;margin-top:3px">'+CG.fmtTime(Date.parse(m.created_at))+'</span></div>';
    }).join("") : '<div class="empty" style="padding:40px"><p>No messages yet — say hi.</p></div>';
    thread = '<div style="padding:14px 16px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center">'+CG.dmAva(active)+'<b style="font-family:var(--f-disp)">'+esc(CG.dmName(active))+'</b></div>'+
      '<div id="dmMsgs" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;min-height:300px">'+body+'</div>'+
      '<div style="padding:12px 14px;border-top:1px solid var(--line);display:flex;gap:8px"><textarea id="dmInput" rows="1" placeholder="Message '+esc(CG.dmName(active))+'…" maxlength="2000" style="flex:1;resize:none"></textarea><button class="btn btn-chrome btn-sm" id="dmSend">Send</button></div>';
  }
  return head + '<div class="shell" style="padding-bottom:48px"><div class="card" style="padding:0;overflow:hidden">'+
    '<div class="grid" style="grid-template-columns:300px 1fr;gap:0;min-height:520px">'+
    '<div style="border-right:1px solid var(--line);overflow-y:auto;max-height:600px">'+listHtml+'</div>'+
    '<div style="display:flex;flex-direction:column">'+thread+'</div>'+
    '</div></div></div>';
};
CG.AFTER.messages = function(param){
  var dc=document.getElementById("dcSignIn"); if(dc) dc.addEventListener("click", function(){ CG.signIn(); });
  if (CG.auth.profile && !CG._dm.loaded){ CG.loadDMs().then(function(){ CG.router(); }); return; }
  document.querySelectorAll("[data-dm-open]").forEach(function(el){ el.addEventListener("click", function(){ CG._dm.active=this.getAttribute("data-dm-open"); CG.router(); CG.dmMarkRead(CG._dm.active); }); });
  var send=document.getElementById("dmSend"); if(send) send.addEventListener("click", CG.dmSend);
  var inp=document.getElementById("dmInput"); if(inp) inp.addEventListener("keydown", function(e){ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); CG.dmSend(); } });
  var mv=document.getElementById("dmMsgs"); if(mv) mv.scrollTop=mv.scrollHeight;
  if (CG._dm.active) CG.dmMarkRead(CG._dm.active);
};

/* ================================================================
   LIVE ADMIN: PRE-SEASON CENTRAL (registrations + owner apps + roster fill)
   Real data; reversible writes (scout_ovr, owner-app status).
   ================================================================ */
CG.admPreseason = function(){
  var lg=CG.lg, s=CG.SEASON||{};
  var regs=(lg._registrationsRaw||[]).slice(), apps=lg._ownerApps||[];
  var rosterMax=s.roster_max||15, rosteredIds=lg._rosteredIds||{};
  var assigned=regs.filter(function(r){ return rosteredIds[r.profile_id]; }).length;
  var pendingApps=apps.filter(function(a){ return a.status==="pending"; }).length;
  var h='<div style="margin-bottom:18px"><h2 class="h-sec">Pre-season central</h2>'+
    '<p class="lede" style="margin-top:6px">Registrations, owner applications, and roster building for '+esc(s.name||"the season")+'. Everything here writes to the live database.</p></div>';
  var kpis=[[regs.length,"Registered players",""],[assigned+" / "+regs.length,"Assigned to a club",""],[pendingApps,"Owner apps pending",pendingApps>0?"alert":""],[s.registration_open?"Open":"Closed","Registration",""]];
  h+='<div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:20px">'+
    kpis.map(function(k){ return '<div class="kpi'+(k[2]==="alert"?" alert":"")+'" style="cursor:default"><b class="num">'+k[0]+'</b><span>'+k[1]+'</span></div>'; }).join("")+'</div>';
  var sortedRegs=regs.sort(function(a,b){ return (b.scout_ovr==null?-1:b.scout_ovr)-(a.scout_ovr==null?-1:a.scout_ovr); });
  h+='<div class="card"><div class="card-h"><h3>Registered players</h3><span class="chip">'+regs.length+'</span></div>'+
    (regs.length?'<div class="tblwrap"><table class="tbl keepcols"><caption>Season registrations</caption><thead><tr>'+
      '<th class="tleft">Player</th><th>POS</th><th class="tleft">EA ID</th><th>Scout OVR</th><th>Status</th><th class="tright">Assign to club</th></tr></thead><tbody>'+
      sortedRegs.map(function(r){ var prof=r.profiles||{}, on=rosteredIds[r.profile_id];
        var clubOpts = '<option value="">Choose club…</option>'+CG.TEAMS.map(function(t){ return '<option value="'+t.code+'">'+esc(t.code)+' · '+esc(t.name)+'</option>'; }).join("");
        return '<tr><td class="tleft"><span class="playercell"><span class="nm">'+esc(prof.gamertag||"—")+'</span></span></td>'+
          '<td class="tnum">'+esc(r.position||"—")+'</td><td class="tleft small" style="color:var(--steel)">'+esc(prof.ea_id||"—")+'</td>'+
          '<td class="tnum"><input type="number" min="40" max="99" value="'+(r.scout_ovr==null?"":r.scout_ovr)+'" data-scout="'+r.id+'" style="width:64px;text-align:center;padding:5px" placeholder="—"></td>'+
          '<td>'+(on?'<span class="chip chip-win">Rostered</span>':'<span class="chip chip-warn">Free agent</span>')+'</td>'+
          '<td class="tright">'+(on?'<span class="caption">—</span>':'<span style="display:inline-flex;gap:6px;align-items:center"><select data-assign-team="'+r.id+'" style="padding:5px;max-width:150px">'+clubOpts+'</select>'+
            '<button class="btn btn-chrome btn-sm" data-assign="'+r.id+'" data-prof="'+r.profile_id+'" data-pos="'+esc(r.position||"C")+'" data-name="'+esc(prof.gamertag||"a player")+'">Sign</button></span>')+'</td></tr>';
      }).join("")+'</tbody></table></div><div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Set a scouted overall to rank the draft pool. Pick a club and Sign to add a free agent to a roster (auto-assigns the next open jersey number, logs a transaction).</span></div>'
      :'<div class="card-b"><p class="caption">No registrations yet — they appear here as members register for the season.</p></div>')+'</div>';
  h+='<div class="card" style="margin-top:18px"><div class="card-h"><h3>Owner applications</h3><span class="chip '+(pendingApps?"chip-warn":"chip-win")+'">'+(pendingApps?pendingApps+" pending":"none pending")+'</span></div>';
  if (apps.length){
    h+=apps.map(function(a){ var prof=a.profiles||{}, sc=a.status==="approved"?"chip-win":a.status==="denied"?"chip-loss":"chip-warn";
      return '<div class="card-b" style="border-top:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'+
        '<b style="font-family:var(--f-disp)">'+esc(prof.gamertag||"Applicant")+'</b><span class="chip '+sc+'">'+esc((a.status||"pending").toUpperCase())+'</span></div>'+
        '<div class="caption" style="display:flex;gap:14px;flex-wrap:wrap">'+(a.team_choice==="build"?'<span>Wants to build <b>'+esc(a.proposed_name||"a new club")+'</b>'+(a.proposed_location?" ("+esc(a.proposed_location)+")":""):'<span>Preferred club: <b>'+esc(a.preferred_club||"no preference")+'</b>')+'</span>'+(a.timezone?'<span>TZ '+esc(a.timezone)+'</span>':"")+'</div>'+
        (a.pitch?'<p class="small" style="color:var(--steel);margin-top:8px;font-style:italic">“'+esc(a.pitch)+'”</p>':"")+
        '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-chrome btn-sm" data-app-approve="'+a.id+'"'+(a.status==="approved"?" disabled":"")+'>Approve</button>'+
        '<button class="btn btn-ghost btn-sm" data-app-deny="'+a.id+'"'+(a.status==="denied"?" disabled":"")+'>Deny</button></div></div>';
    }).join("");
  } else { h+='<div class="card-b"><p class="caption">No owner applications yet. They appear here when members apply from the “Apply to own a team” page.</p></div>'; }
  h+='</div>';
  h+='<div class="card" style="margin-top:18px"><div class="card-h"><h3>Roster fill</h3><span class="chip">max '+rosterMax+' per club</span></div><div class="card-b">'+
    CG.TEAMS.map(function(t){ var n=(lg.byTeam[t.code]||[]).length, pct=Math.round(100*n/rosterMax);
      return '<div style="display:flex;align-items:center;gap:12px;padding:7px 0">'+CG.crest(t.code,20)+'<span style="width:140px;font-size:13px">'+esc(t.name)+'</span>'+
        '<span class="rb-track" style="flex:1"><span class="rb-fill" style="width:'+Math.min(100,pct)+'%"></span></span>'+
        '<b class="num" style="width:56px;text-align:right;font-size:13px">'+n+'/'+rosterMax+'</b></div>';
    }).join("")+'</div></div>';
  return h;
};
CG.AFTER._preseason = function(){
  document.querySelectorAll("[data-scout]").forEach(function(el){
    el.addEventListener("change", function(){
      var id=this.getAttribute("data-scout"), v=(this.value||"").trim();
      var nv = v===""?null:Math.max(40,Math.min(99,parseInt(v,10)||0));
      CG.sb.from("season_registrations").update({scout_ovr:nv}).eq("id",id).then(function(r){
        if(r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); }
        else { CG.toast("Scout OVR saved","ok"); var reg=(CG.lg._registrationsRaw||[]).find(function(x){return x.id===id;}); if(reg)reg.scout_ovr=nv; }
      });
    });
  });
  document.querySelectorAll("[data-app-approve]").forEach(function(b){ b.addEventListener("click", function(){ CG.setOwnerAppStatus(this.getAttribute("data-app-approve"),"approved"); }); });
  document.querySelectorAll("[data-app-deny]").forEach(function(b){ b.addEventListener("click", function(){ CG.setOwnerAppStatus(this.getAttribute("data-app-deny"),"denied"); }); });
  document.querySelectorAll("[data-assign]").forEach(function(b){ b.addEventListener("click", function(){
    var el=this, regId=el.getAttribute("data-assign"), sel=document.querySelector('[data-assign-team="'+regId+'"]'), code=sel?sel.value:"";
    if(!code){ CG.toast("Pick a club first","err"); return; }
    var name=el.getAttribute("data-name");
    CG.confirm("Sign "+name+" to "+CG.TEAM[code].name+"?","This adds the player to the club's active roster with the next open jersey number and logs a transaction. Reversible with a waive.","Sign player", function(){
      CG.assignRegistration(regId, el.getAttribute("data-prof"), el.getAttribute("data-pos"), name, code);
    });
  }); });
};
CG.assignRegistration = async function(regId, profileId, position, playerName, code){
  var s=CG.SEASON, teamId=(CG.lg._codeToId||{})[code];
  if(!s||!teamId){ CG.toast("Missing season/club","err"); return; }
  var used={}; (CG.lg.byTeam[code]||[]).forEach(function(p){ if(p.jersey) used[p.jersey]=1; });
  var num=0; for(var n=1;n<=99;n++){ if(!used[n]){ num=n; break; } }
  var r1 = await CG.sb.from("roster_spots").insert({ season_id:s.id, team_id:teamId, profile_id:profileId, jersey_number:num, position:position, salary:0 });
  if(r1.error){ CG.toast("Couldn’t sign: "+r1.error.message,"err"); return; }
  await CG.sb.from("season_registrations").update({ status:"assigned" }).eq("id", regId);
  await CG.sb.from("transactions").insert({ season_id:s.id, type:"sign", description: CG.TEAM[code].name+" signed <b>"+String(playerName||"a player").replace(/[<>]/g,"")+"</b> ("+position+" #"+num+")" });
  /* optimistic local update so the view reflects it immediately */
  CG.lg._rosteredIds[profileId]=true;
  if(CG.lg.byTeam[code]) CG.lg.byTeam[code].push({ id:profileId, tag:playerName, team:code, pos:position, jersey:num, mgmt:null, salary:0, depth:9 });
  CG.toast(playerName+" signed to "+CG.TEAM[code].name+" · #"+num,"ok");
  CG.router();
};
CG.setOwnerAppStatus = async function(id, status){
  var r = await CG.sb.from("owner_applications").update({ status:status, updated_at:new Date().toISOString() }).eq("id", id);
  if(r.error){ CG.toast("Couldn’t update: "+r.error.message,"err"); return; }
  var app=(CG.lg._ownerApps||[]).find(function(x){ return x.id===id; }); if(app) app.status=status;
  CG.toast("Application "+status,"ok"); CG.router();
};
/* register Pre-season central in the Control Center */
CG._origAdminRoute = CG.ROUTES.admin;
CG.ROUTES.admin = function(param, qs){
  if (CG.role()!=="commish") return CG.unauthorized("The Control Center is commissioner-only.");
  if (param==="preseason") return CG.adminShell("preseason", CG.admPreseason(qs||{}));
  return CG._origAdminRoute(param, qs);
};
CG._origAdminAfter = CG.AFTER.admin;
CG.AFTER.admin = function(param, qs){
  if (param==="preseason"){ CG.AFTER._preseason(); return; }
  if (CG._origAdminAfter) CG._origAdminAfter(param, qs);
};

/* ---------- async boot (replaces the sync CG.boot for the live build) ---------- */
CG.bootLive = async function(){
  var app = document.getElementById("app");
  if (app) app.innerHTML =
    '<section class="sec"><div class="shell"><div class="empty" style="padding:90px 20px">'+
    '<div class="e-art">'+(CG.ic?CG.ic("db",22):"")+'</div><b>Loading the league…</b>'+
    '<p>Pulling live teams, rosters, and the schedule from the league database.</p></div></div></section>';
  try {
    CG.lg = await CG.buildLiveLeague();
    /* surface Register in the nav while the open season is taking sign-ups */
    if (CG.SEASON && CG.SEASON.registration_open && CG.NAV && !CG.NAV.some(function(n){ return n[1]==="#/register"; })){
      CG.NAV.push(["Register","#/register"]);
    }
    await CG.initAuth();
    /* signed-in extras: Messages in the account drawer's reach (nav link) */
    if (CG.auth.user && CG.NAV && !CG.NAV.some(function(n){ return n[1]==="#/messages"; })){
      CG.NAV.push(["Messages","#/messages"]);
    }
    /* Pre-season central in the Control Center (commissioner) */
    if (CG.ADMIN_NAV && CG.ADMIN_NAV[0] && !CG.ADMIN_NAV[0][1].some(function(it){ return it[0]==="preseason"; })){
      CG.ADMIN_NAV[0][1].splice(1, 0, ["preseason","Pre-season","users"]);
    }
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
