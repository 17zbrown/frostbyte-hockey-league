/* seed: getting_started — the first-week path (sign in → Discord → EA ID → register) and the
   member surfaces that follow (dashboard, Settings, bell, account menu, public profile), all on
   the Bruins with the fixed Jul 15 2026 clock. Sources: part_live.js setupChecklist (:985),
   _wrapHubDashboard (:1750), ROUTES.register (:2612), promptEaId/saveEaId (:3052-3068),
   registerForSeason (:3072), roadAheadCard (:9950), hubSettings + Discord account card (:11619-11720).

   ?state=  (default) a rostered Bruins player mid-season — the "Evening, <tag>." dashboard
            guest       signed out (masthead "Join with Discord", #/signin guest page)
            new0        brand-new member: not in the Discord, no EA ID, not registered (0 of 3)
            new2        in the Discord + EA ID on file, not registered (2 of 3)
            registered  registered on time as a Left Wing (checklist gone, road-ahead card)
            dcout       rostered, but the Discord account the league follows is not in the server */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "getting_started", run: function(CG, t, uid){
  var st = window.GUIDE.qs.get("state") || "";
  var now = CG.now();
  var INVITE = "https://discord.gg/chelgaming";

  /* ---- season taking sign-ups: dates just past the fixed clock, on the real cadence
     (Sunday deadline → two-week pre-season → Saturday draft → one week of FA → puck drop) ---- */
  Object.assign(CG.SEASON, {
    id:"S1", number:1, registration_open:true,
    registration_deadline:"2026-07-26T23:59:00-04:00",
    preseason_starts_at:"2026-08-03T21:00:00-04:00",
    draft_at:"2026-08-15T20:00:00-04:00",
    free_agency_opens_at:"2026-08-16T12:00:00-04:00",
    starts_at:"2026-08-24T21:00:00-04:00"
  });
  if (CG.NAV && !CG.NAV.some(function(n){ return n[1]==="#/register"; })) CG.NAV.push(["Register","#/register"]);
  /* the availability seed opens a generic "Week 3"; this topic also shows the game log (Wk 6/5/4)
     and a 7-4-1 record, so the open window has to be the NEXT week, not one already played.
     Relabel it here (the card title, the sidebar badge, the alerts and the profile chip all read
     CG.WEEK8.label) and move the key with it so nothing stale is keyed under the old one. */
  if (CG.WEEK8 && CG.WEEK8.open){ CG.WEEK8.key = "w7"; CG.WEEK8.label = "Week 7"; }
  /* the register page calls CG.regSeason(), which the live boot defines inside buildLiveLeague
     (part_live.js:253) — the demo never runs that, so install the same one-liner */
  if (!CG.regSeason) CG.regSeason = function(){ return (CG.SEASONS||[]).find(function(s){ return s.registration_open; }) || CG.SEASON || null; };
  CG._siteCfg = Object.assign({}, CG._siteCfg || {}, { discord_invite: INVITE });
  CG.pingDiscordSync = function(){};   /* would POST a Netlify function that does not exist here */

  /* every profile write (.update().eq().select("id")) must come back with ONE row — the site's
     fail-loud check treats 0 rows as an expired session and refuses the save */
  window.GUIDE_TABLES = window.GUIDE_TABLES || {};
  window.GUIDE_TABLES.profiles = [{ id: uid }];

  /* engine hygiene for the screens this topic shows: salaries on the $250K lattice from $750K
     (the prototype scales them continuously), and career games so a mid-season regular's OVR
     no longer reads "Provisional" */
  CG.lg.careerGp = CG.lg.careerGp || {};
  CG.lg.players.forEach(function(p){
    if (!p.mgmtSalary && p.mgmt !== "agm") p.salary = Math.max(750000, Math.round(p.salary/250000)*250000);
    var s = CG.lg.pstats && CG.lg.pstats[p.id]; if (s && s.gp) CG.lg.careerGp[p.id] = s.gp;
  });
  /* tonight's Bruins game has a confirmed lineup on file (game_lineups row shape), depth-1 line */
  var myGame = (CG.lg.tonight||[]).filter(function(g){ return g.home===t.code || g.away===t.code; })[0];
  if (myGame){
    var mates = CG.lg.byTeam[t.code] || [];
    function first(pos){ var p = mates.filter(function(x){ return x.pos===pos && x.depth===1; })[0] || mates.filter(function(x){ return x.pos===pos; })[0]; return p ? p.id : null; }
    CG.lg._lineups = CG.lg._lineups || {};
    CG.lg._lineups[t.code+":"+myGame.id] = { lw:first("LW"), center:first("C"), rw:first("RW"), ld:first("LD"), rd:first("RD"), goalie:first("G") };
  }

  function setRead(ids){ var rm = CG.store.get("read") || {}; Object.keys(rm).forEach(function(k){ delete rm[k]; }); ids.forEach(function(id){ rm[id] = true; }); CG.store.set("read", rm); }
  var welcome = { id:"gs-welcome", t: now - 5*864e5, icon:"msg", title:"Welcome to Chel Gaming",
    body:"Your Discord account is your league account. Join the league Discord to get your roles — game nights, codes and rulings all run there.", read:false, route: INVITE };

  /* ---- the new-member states: a profile that is NOT a roster player, so CG.me() is null and the
     dashboard becomes the "Get set up" onboarding page ---- */
  function newMember(o){
    var p = Object.assign({ id:"u-new", gamertag:"RookieRhys", display_name:"RookieRhys", role:"member",
      in_guild:false, ea_id:null, platform:null, avatar_url:null, discord_id:"318554027492114432", discord_username:"rookierhys" }, o.profile||{});
    CG.auth = { user:{ id:p.id }, profile:p, role:"member", registration:o.registration||null, ownerApp:null, staffApp:null };
    window.GUIDE.uid = p.id; window.GUIDE_TABLES.profiles = [{ id:p.id }];
    CG._notifs = [welcome]; setRead([]);
    /* no roster spot yet → no game week to answer (the availability seed opened one for the club) */
    if (CG.WEEK8) CG.WEEK8 = Object.assign({}, CG.WEEK8, { open:false });
  }

  if (st === "guest"){
    CG.auth = { user:null, profile:null, role:"guest", registration:null, ownerApp:null, staffApp:null };
    CG._oauthErr = null; CG._oauthPending = false; CG._notifs = [];
    return;
  }
  if (st === "new0"){ newMember({}); return; }
  if (st === "new2"){ newMember({ profile:{ in_guild:true, ea_id:"RookieRhys", platform:"PS5" } }); return; }
  if (st === "registered"){
    newMember({ profile:{ in_guild:true, ea_id:"RookieRhys", platform:"PS5" },
      registration:{ season_id:"S1", profile_id:"u-new", position:"LW", note:"Available most weeknights after 9 PM ET.", status:"pending", created_at:"2026-07-14T19:32:00-04:00" } });
    CG._notifs = [
      { id:"gs-reg", t: now - 25*36e5, icon:"check", title:"You’re registered for Season 1", body:"Position on file: Left Wing. Register by Sun, Jul 26 and you enter the pre-season and the draft.", read:false, route:"#/register" },
      welcome ];
    setRead(["gs-welcome"]);
    return;
  }

  /* ---- default: the rostered Bruins player the guide layer already seated (uid = an engine
     player id). A rostered player has a registration row, so the Register nav item stays hidden. */
  var me = CG.lg.players.find(function(p){ return p.id===uid; });
  if (!me){
    /* ?as=owner|gm|agm — a seated manager registered long ago (hides the Register nav item), and the
       Owner has one GM move waiting so the Team HQ sidebar shows the Management badge */
    CG.auth.registration = { season_id:"S1", profile_id:uid, position:"C", status:"assigned", created_at:"2026-05-18T20:10:00-04:00" };
    CG.lg._mgmtMoves = [{ id:"mv-gs1", status:"pending", page:"roster", action:"sign_free_agent", requested_by:"u-gm",
      summary:"Sign free agent CrossbarCzar (RD) — $1.25M · 1 yr", created_at:new Date(now - 3*36e5).toISOString() }];
    return;
  }
  CG.auth.registration = { season_id:"S1", profile_id:uid, position:me.pos, status:"assigned", created_at:"2026-05-18T20:10:00-04:00" };
  CG.auth.profile.discord_id = "218473920184532992"; CG.auth.profile.discord_username = me.tag.toLowerCase().replace(/[^a-z0-9_.]/g, "");
  var opp = myGame ? (myGame.home===t.code ? myGame.away : myGame.home) : null;
  var last = ((CG.lg.glog && CG.lg.glog[uid]) || []).slice(-1)[0];
  CG._notifs = [
    myGame ? { id:"gs-lineup", t: now - 2*36e5, icon:"grid", title:"Lineup posted — "+t.name+(myGame.home===t.code?" vs ":" at ")+CG.TEAM[opp].name,
      body:"You’re in tonight’s confirmed lineup at "+CG.POS_NAME[me.pos]+". The private game code goes live at "+CG.fmtTime(myGame.at-30*60000)+" — open the matchup to grab it.", read:false, route:"#/matchup/"+myGame.id } : null,
    { id:"gs-avail", t: now - 26*36e5, icon:"flag", title:CG.WEEK8.label+" availability is open",
      body:"Due Sunday 8 PM ET — your club’s management builds lineups from it. 30 seconds now saves a scramble later.", read:false, route:"#/hub/availability" },
    last ? { id:"gs-final", t: now - 3*864e5, icon:"chart", title:"Box score imported — "+t.name+" vs "+CG.TEAM[last.opp].name,
      body:"Your line from Week "+last.week+": "+(last.line.goalie ? last.line.sv+" saves, "+last.line.ga+" GA" : last.line.g+"G "+last.line.a+"A, "+last.line.shots+" shots")+". Stats and your overall are updated.", read:true, route:"#/matchup/"+last.game } : null,
    Object.assign({}, welcome, { t: now - 58*864e5, read:true })
  ].filter(Boolean);
  setRead(["gs-final","gs-welcome"]);

  /* Settings › Discord account: the RPC the card reads (my_discord_accounts) */
  window.GUIDE_RPC = window.GUIDE_RPC || {};
  window.GUIDE_RPC.my_discord_accounts = function(){
    return { data:{ accounts:[{ discord_id:"218473920184532992", username:CG.auth.profile.discord_username, linked_at:"2026-05-02T18:24:00-04:00" }],
      current:"218473920184532992", in_guild: st !== "dcout", invite: INVITE }, error:null };
  };
  if (st === "dcout") CG.auth.profile.in_guild = false;
} });
