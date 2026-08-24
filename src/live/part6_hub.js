/* ================================================================
   ROLE HUBS — member dashboard, availability, lineup builder,
   complaints, notifications, settings
   ================================================================ */

/* Placeholder only — the live adapter replaces this with the real week off the schedule. It is
   deliberately CLOSED and empty rather than a seeded two-night week: the old seed carried July 2026
   dates, so any failure to derive the real week published phantom game nights to managers instead
   of admitting there was nothing scheduled. Shape matches the live object; `open` is the signal. */
CG.WEEK8 = { key:null, label:"Game week", deadline:null, nights:[], open:false };
CG.AV_OPTS = [
  ["yes","Available"],["no","Unavailable"],["maybe","Maybe"],
  ["late","Available late"],["until","Available until…"],["emg","Emergency sub only"]
];
/* availability storage seam — the live build overrides both with the real
   availability table; the prototype keeps its local store */
CG.availGet = function(pid){ return (CG.store.get("availability")||{})[CG.WEEK8.key+":"+pid] || null; };
CG.availSave = function(entry, cb){
  var all = CG.store.get("availability"); all[CG.WEEK8.key+":"+((CG.me()||{}).id)] = entry;
  CG.store.set("availability", all); if (cb) cb(true);
};
CG.avFor = function(playerId){
  var saved = CG.availGet(playerId);
  if (saved) return saved;
  /* deterministic demo availability for the rest of the roster */
  var n = 0; String(playerId).split("").forEach(function(c){ n += c.charCodeAt(0); });
  var pool = ["yes","yes","yes","yes","yes","maybe","no","yes","late","nr"];
  return { demo:true, nights:{ n1:{ st: pool[n % pool.length] }, n2:{ st: pool[(n*3+1) % pool.length] } },
           at: Date.parse("2026-07-1"+(3+(n%2))+"T1"+(n%9)+":00:00-04:00") };
};

/* ---------- roster / trade demo state ----------
   The managed club is always the seat's own team (mgmt = Breakers; commissioner
   previews the Breakers desk). Block flags start from the engine seed, then the
   demo store lets management toggle them live. */
CG.myClub = function(){ var me = CG.me(); if (me && me.team) return me.team; return (CG.TEAMS[0]||{}).code || null; };
CG.isOnBlock = function(pid){
  var t = CG.store.get("blockToggles")||{};
  if (Object.prototype.hasOwnProperty.call(t, pid)) return !!t[pid];
  var p = CG.playerById(CG.lg, pid);
  return !!(p && p.onBlock);
};
CG.setOnBlock = function(pid, on){
  var t = CG.store.get("blockToggles")||{}; t[pid] = !!on; CG.store.set("blockToggles", t);
};
CG.isWaived = function(pid){ return !!(CG.store.get("waived")||{})[pid]; };
CG.setWaived = function(pid, on){
  var w = CG.store.get("waived")||{}; if (on) w[pid]=true; else delete w[pid]; CG.store.set("waived", w);
};
/* league-wide trade block, honoring live toggles; management never blocks itself */
CG.blockedPlayers = function(){
  return CG.lg.players.filter(function(p){ return !p.mgmt && CG.isOnBlock(p.id); });
};
/* incoming offers still awaiting a decision */
CG.incomingOffers = function(){
  var dec = CG.store.get("tradeDecisions")||{};
  return (CG.lg.incoming||[]).filter(function(o){ return !dec[o.id]; });
};
CG.incomingCount = function(){ return CG.can("trades.manage") ? CG.incomingOffers().length : 0; };
/* trade-action seams — the live build overrides all four against the trades table */
CG.outgoingOffers = function(){ return (CG.store.get("tradeOffers")||[]).slice().reverse(); };
CG.sendTradeOffer = function(d, club){
  var offers = CG.store.get("tradeOffers")||[];
  offers.push({ id:"trOut"+(offers.length+1), to:d.partner, send:d.send.slice(), recv:d.recv.slice(), status:"Sent — awaiting response", open:true });
  CG.store.set("tradeOffers", offers);
  CG.audit("Trade offer sent", CG.TEAM[club].code+" → "+CG.TEAM[d.partner].code);
  CG.pushNotif("swap","Trade offer sent","Your offer to "+CG.TEAM[d.partner].name+" is on their desk — you’ll be notified when they respond.","#/hub/tradehub");
  CG._tradeDraft = { partner:null, send:[], recv:[] };
  CG.toast("Offer sent to "+CG.TEAM[d.partner].name,"ok"); CG.renderChrome(); CG.router();
};
CG.acceptTradeOffer = function(id, o){
  var dec = CG.store.get("tradeDecisions")||{}; dec[id]="accepted"; CG.store.set("tradeDecisions", dec);
  CG.audit("Trade offer accepted", CG.TEAM[o.from].code);
  CG.pushNotif("check","Trade accepted","Your acceptance of "+CG.TEAM[o.from].name+"’s offer is pending league-office approval.","#/hub/tradehub");
  CG.toast("Offer accepted — routed to the league office","ok"); CG.renderChrome(); CG.router();
};
CG.declineTradeOffer = function(id, o){
  var dec = CG.store.get("tradeDecisions")||{}; dec[id]="declined"; CG.store.set("tradeDecisions", dec);
  CG.audit("Trade offer declined", CG.TEAM[o.from].code);
  CG.toast("Offer from "+CG.TEAM[o.from].name+" declined","ok"); CG.renderChrome(); CG.router();
};
CG.withdrawTradeOffer = function(id){
  var offers = (CG.store.get("tradeOffers")||[]).filter(function(o){ return o.id!==id; });
  CG.store.set("tradeOffers", offers); CG.toast("Offer withdrawn","ok"); CG.router();
};
CG.tradePlayerLine = function(pid){
  var p = CG.playerById(CG.lg, pid); if (!p) return "";
  return '<span class="playercell">'+CG.crest(p.team,18)+'<span class="nm">'+esc(p.tag)+'</span>'+
    '<small style="color:var(--steel)">'+p.pos+' · OVR '+CG.lg.ratings[p.id].ovr+' · '+CG.fmtMoney(CG.playerSalary(CG.lg,pid))+'</small></span>';
};

/* hub sidebar per role */
CG.hubNav = function(section){
  var r = CG.role();
  /* the sidebar is split by hat: personal tools under "My Hub", club management
     under "Team HQ" (complaints is a player tool, so it stays out of Team HQ) */
  var mine = [["", "Dashboard", "home"]];
  if (CG.can("availability.submit")) mine.push(["availability","Availability","cal"]);
  var _mo = CG.mediaOnlyStaff && CG.mediaOnlyStaff();
  if (CG.can("complaints.file")||CG.can("complaints.review")) mine.push(["complaints", (r==="staff" && !_mo)?"Case queue":"Action Center","flag"]);
  /* Messages lives in the account menu (avatar), not the hub sidebar */
  if (r==="staff" && !CG.LIVE_MODE) mine.push(["statsentry","Stats entry","chart"]);
  mine.push(["notifications","Notifications","bell"]);
  mine.push(["settings","Settings","gear"]);
  var staffTools = [];
  var mediaOnly = CG.mediaOnlyStaff && CG.mediaOnlyStaff();
  if ((r==="staff" || r==="commish") && CG.hubStaffDesk && !mediaOnly) staffTools.push(["staffdesk","Staff desk","flag"]);
  /* One tab per department the signed-in person actually holds — the registry lives in
     part9_staffdesks.js, which loads after this file, so it's read at render time. A
     commissioner holds every department and sees the full set. */
  (CG.STAFF_DESKS||[]).forEach(function(d){
    if (CG.hasDept && CG.hasDept(d.dept)) staffTools.push([d.key, d.label, d.icon]);
  });
  var club = [];
  var clubTools = r!=="commish" || CG.managesClub();
  if (clubTools){
    if (CG.can("roster.manage")) club.push(["management","Management","shield"]);
    if (CG.can("roster.manage")) club.push(["roster","Roster","users"]);
    if (CG.LIVE_MODE && CG.can("lineup.build")) club.push(["schedule","Schedule","cal"]);
    if (CG.LIVE_MODE && CG.can("lineup.build") && CG.hubGameStats) club.push(["gamestats","Game stats","chart"]);
    /* ONE lineup surface: the board (#/hub/lines) replaced the per-game builder in the nav. The
       old page stays routed but unlisted as the emergency call-up door (Rule 5.3). */
    if (CG.can("lineup.build")) club.push(["lines","Lineup builder","grid"]);
    if (CG.can("trades.manage")) club.push(["tradehub","Trade Hub","swap"]);
    if (CG.LIVE_MODE && CG.can("roster.manage")) club.push(["freeagents","Free agents","search"]);
    if (CG.LIVE_MODE && CG.can("roster.manage") && CG.hubDraftLive) club.push(["draft","Draft","play"]);
  }
  function render(items){
    return items.map(function(it){
      var badge = "";
      if (it[0]==="availability" && CG.WEEK8 && CG.WEEK8.open && !CG.availGet((CG.me()||{}).id)) badge = '<span class="hs-n">due</span>';
      if (it[0]==="tradehub" && CG.incomingCount()) badge = '<span class="hs-n">'+CG.incomingCount()+'</span>';
      if (it[0]==="notifications" && CG.unreadCount()) badge = '<span class="hs-n">'+CG.unreadCount()+'</span>';
      if (it[0]==="complaints" && CG.role()==="staff"){
        var openN = CG.visibleComplaints().filter(function(c){ return c.status!=="Resolved"; }).length;
        if (openN) badge = '<span class="hs-n">'+openN+'</span>';
      }
      return '<a href="#/hub'+(it[0]?"/"+it[0]:"")+'" class="'+(section===it[0]?"on":"")+'">'+CG.ic(it[2],15)+it[1]+badge+'</a>';
    }).join("");
  }
  return '<nav class="hub-side" aria-label="Hub sections"><div class="hs-group">My Hub</div>'+render(mine)+
    (staffTools.length?'<div class="hs-group">Staff</div>'+render(staffTools):"")+
    (club.length?'<div class="hs-group">Team HQ</div>'+render(club):"")+'</nav>';
};
CG.hubShell = function(section, inner){
  var notice = "";
  return '<section class="sec-tight"><div class="shell"><div class="hub-grid">'+CG.hubNav(section)+'<div>'+notice+inner+'</div></div></div></section>';
};
CG.unauthorized = function(need){
  return '<section class="sec"><div class="shell"><div class="empty" style="padding:70px 20px">'+
    '<div class="e-art">'+CG.ic("lock",22)+'</div><b>You don’t have access to this area</b>'+
    '<p>'+esc(need||"This area is limited to signed-in league members with the right role.")+'</p>'+
    '<a class="btn btn-ink" href="#/signin" style="margin-top:18px">Sign in</a></div></div></section>';
};

CG.ROUTES.hub = function(param, qs){
  var r = CG.role();
  if (r==="guest") return CG.unauthorized("Sign in with Discord to reach your dashboard.");
  var section = param||"";
  if (section==="") return CG.hubShell("", CG.hubDashboard());
  if (section==="availability") return CG.hubShell("availability", CG.hubAvailability());
  if (section==="roster") return CG.can("roster.manage") ? CG.hubShell("roster", CG.hubRoster(qs)) : CG.unauthorized("Roster management is a team-management tool.");
  if (section==="tradehub") return CG.can("trades.manage") ? CG.hubShell("tradehub", CG.hubTradeHub(qs)) : CG.unauthorized("The Trade Hub is confidential to team management.");
  if (section==="lineup") return CG.can("lineup.build") ? CG.hubShell("lineup", CG.hubLineup(qs)) : CG.unauthorized("The lineup builder is a team-management tool.");
  if (section==="lines") return CG.can("lineup.build") ? CG.hubShell("lines", CG.hubLines(qs)) : CG.unauthorized("The line creator is a team-management tool.");
  if (section==="schedule") return (CG.can("lineup.build") && CG.LIVE_MODE && CG.hubScheduleLive) ? CG.hubShell("schedule", CG.hubScheduleLive(qs)) : CG.unauthorized("The club schedule desk is a team-management tool.");
  if (section==="staffdesk") return (r==="staff"||r==="commish") && CG.hubStaffDesk && !(CG.mediaOnlyStaff && CG.mediaOnlyStaff())
    ? CG.hubShell("staffdesk", CG.hubStaffDesk())
    : CG.unauthorized("The Staff Desk is for league staff.");
  if (section==="complaints") return CG.hubShell("complaints", CG.hubComplaints());
  if (section==="complaint") return CG.hubShell("complaints", CG.hubComplaintDetail(qs.id));
  if (section==="statsentry") return r==="staff"
    ? CG.hubShell("statsentry", CG.LIVE_MODE
      ? '<div style="margin-bottom:20px"><span class="eyebrow chr">Statistician grant</span><h1 class="h-sec" style="margin-top:8px">Stats entry</h1></div>'+
        '<div class="note">Finals import themselves from the EA NHL API — there’s nothing to enter by hand anymore. Box scores, standings, and ratings update within minutes of a game ending; the Control Center’s EA stats panel shows the pipeline.</div>'
      : CG.hubStatsEntry())
    : CG.unauthorized();
  if (section==="notifications") return CG.hubShell("notifications", CG.hubNotifications());
  if (section==="settings") return CG.hubShell("settings", CG.hubSettings());
  return CG.ROUTES._404();
};

/* Management tasks card — shared by the rostered-manager dashboard and the club-management
   dashboard (an owner with no roster spot). Everything is live: lineup status from the lineups
   table (not localStorage), the real incoming-trade count, and a GM-vacancy nudge. */
CG.gmTasksCard = function(team){
  var lg = CG.lg, rows = "";
  var tonightGs = (lg.tonight||[]).filter(function(g){ return g.home===team||g.away===team; }).sort(function(a,b){ return a.at-b.at; });
  if (tonightGs.length){
    /* count ALL of tonight's games, not just the first — three a night, each its own lineup */
    var subN = tonightGs.filter(function(g){ return (lg._lineups||{})[team+":"+g.id]; }).length;
    var allIn = subN === tonightGs.length;
    var nextLock = tonightGs.filter(function(g){ return !((lg._lineups||{})[team+":"+g.id]); })[0];
    rows += '<div class="titem"><span class="t-dot '+(allIn?"grn":"red")+'"></span><span style="flex:1">Tonight’s lineups — <b>'+subN+' / '+tonightGs.length+' submitted</b>'+
      (nextLock?'. Next locks '+CG.fmtTime(nextLock.at-30*60000):'')+' (Rule 5.3).</span><a class="btn btn-ghost btn-sm" href="#/hub/lines">Builder</a></div>';
  }
  if (CG.WEEK8 && CG.WEEK8.open && CG.avFor){
    var noReply = (lg.byTeam[team]||[]).filter(function(p){ try { return CG.avFor(p.id).nights.n1.st==="nr"; } catch(e){ return false; } }).length;
    rows += '<div class="titem"><span class="t-dot'+(noReply?" red":" grn")+'"></span><span style="flex:1">'+noReply+' player'+(noReply===1?"":"s")+' with no '+esc(CG.WEEK8.label)+' response.</span><a class="btn btn-ghost btn-sm" href="#/hub/availability">Grid</a></div>';
  }
  var inc = CG.incomingCount ? CG.incomingCount() : 0;
  rows += '<div class="titem"><span class="t-dot'+(inc?" red":" grn")+'"></span><span style="flex:1">'+(inc? inc+' incoming trade offer'+(inc===1?"":"s")+' awaiting your review.' : 'No pending trade offers.')+'</span><a class="btn btn-ghost btn-sm" href="#/hub/tradehub">Trade Hub</a></div>';
  var to = (CG.TEAMS||[]).find(function(t){ return t.code===team; });
  if (to && !to.gm){
    rows += '<div class="titem"><span class="t-dot red"></span><span style="flex:1">No General Manager appointed yet — nominate one from the Management tab.</span><a class="btn btn-ghost btn-sm" href="#/hub/management">Management</a></div>';
  }
  return '<div class="card" style="border-color:var(--ink)"><div class="card-h"><h3>Management tasks</h3><span class="chip chip-chrome">Management</span></div><div class="tasklist">'+rows+'</div></div>';
};

/* ---------- dashboard ---------- */
CG.hubDashboard = function(){
  var r = CG.role(), me = CG.me(), lg = CG.lg;
  var who = (me && me.tag) || (CG.auth.profile && (CG.auth.profile.gamertag || CG.auth.profile.display_name)) || "coach";
  var title = r==="commish" ? "Commissioner desk" : r==="staff" ? "Staff desk" : "Evening, "+esc(who)+".";
  var h = '<div style="margin-bottom:24px"><span class="eyebrow chr">'+CG.fmtFull(CG.now())+'</span>'+
    '<h1 class="h-page" style="margin-top:8px">'+title+'</h1></div>';
  var cards = [];
  if (me){
    var t = CG.TEAM[me.team], s = lg.pstats[me.id];
    var av = CG.availGet(me.id);
    var tonight = lg.tonight.find(function(g){ return g.home===me.team||g.away===me.team; });
    var inLineup = tonight && Object.values(CG.plannedLineup(tonight, me.team)).indexOf(me.id)>=0;

    /* a manager who is also rostered gets the full club-overview console; a plain player gets the compact card */
    if (CG.managesClub && CG.managesClub() && CG.teamOverviewCard && CG.myManagedTeam && CG.myManagedTeam()){
      cards.push(CG.teamOverviewCard(CG.myManagedTeam()));
    } else {
      cards.push('<div class="card" style="--tc:'+t.color+'"><div class="card-h"><h3>My club</h3><a class="sec-link" href="#/team/'+me.team+'">Team page</a></div>'+
        '<div class="card-b" style="display:flex;gap:14px;align-items:center">'+CG.crest(me.team,44)+
        '<div><b style="font-family:var(--f-disp);font-size:17px">'+esc(t.name)+'</b>'+
        '<span class="caption" style="display:block">'+lg.teams[me.team].w+"-"+lg.teams[me.team].l+"-"+lg.teams[me.team].otl+' · '+t.div+' Division'+(r==="mgmt"?" · You are the GM":"")+'</span></div>'+
        '<span style="margin-left:auto;text-align:center">'+
          '<span class="ovrbox" title="'+esc((CG.ovrNote?CG.ovrNote(me.id,"title"):"")||"My overall")+'">'+lg.ratings[me.id].ovr+'</span>'+
          (CG.ovrNote?CG.ovrNote(me.id):"")+
        '</span></div></div>');
    }
    /* Availability only carries urgency when a game week is actually open. Pre-season (no
       scheduled week) shows a calm "opens when the schedule posts" state instead of a red
       "Due Sunday 8 PM ET" for a week that doesn't exist. */
    if (CG.WEEK8 && CG.WEEK8.open){
      cards.push('<div class="card" '+(av?"":'style="border-color:var(--chrome-deep);background:var(--chrome-tint)"')+'>'+
        '<div class="card-h"><h3>'+esc(CG.WEEK8.label)+' availability</h3><span class="chip '+(av?"chip-win":"chip-warn")+'">'+(av?"Submitted":"Due Sunday 8 PM ET")+'</span></div>'+
        '<div class="card-b">'+(av
          ? '<p class="small" style="color:var(--steel)">Logged '+CG.fmtFull(av.at)+'. You can edit until the deadline.</p>'
          : '<p class="small" style="color:var(--steel)">Your club’s management builds lineups from this — 30 seconds now saves a scramble later.</p>')+
        '<a class="btn '+(av?"btn-ghost":"btn-chrome")+' btn-sm" style="margin-top:12px" href="#/hub/availability">'+(av?"Review / edit":"Submit availability")+'</a></div></div>');
    } else {
      cards.push('<div class="card"><div class="card-h"><h3>Availability</h3><span class="chip">Off week</span></div>'+
        '<div class="card-b"><p class="small" style="color:var(--steel)">No game week is scheduled yet. Availability opens each week once the schedule is posted — you’ll get a notification.</p></div></div>');
    }
    if (lg.tonight.length){
      cards.push(CG.tonightCard(me, tonight, inLineup));
    }
    if (lg.pstats[me.id].gp){
      var last3 = lg.glog[me.id].slice(-3).reverse();
      cards.push('<div class="card"><div class="card-h"><h3>My last three games</h3><a class="sec-link" href="'+CG.playerRoute(me)+'">Full log</a></div>'+
        last3.map(function(en){
          var b = en.line;
          return '<div class="notif" style="cursor:pointer" data-go="#/matchup/'+en.game+'"><span class="nf-ic">'+CG.crest(en.opp,20)+'</span>'+
            '<span><b>vs '+esc(CG.TEAM[en.opp].name)+'</b><p>'+(b.goalie? b.sv+" saves, "+b.ga+" GA" : b.g+"G "+b.a+"A · "+b.shots+" shots")+'</p></span>'+
            '<span class="nf-t">Wk '+en.week+'</span></div>';
        }).join("")+'</div>');
    }
  }
  if (me && CG.managesClub()){
    cards.push(CG.gmTasksCard(me.team));
  }
  if (r==="staff" || r==="commish"){
    /* Cases assigned to THIS official, from the live action-request table — the prototype filtered
       on a demo persona ("RefCam_Official") so the card could never populate. */
    var uid = CG.auth.user && CG.auth.user.id;
    var mine = (lg._actionReqs||[]).filter(function(a){ return a.assigned_to===uid && a.status!=="resolved" && a.status!=="denied"; });
    var openAll = (lg._actionReqs||[]).filter(function(a){ return a.status!=="resolved" && a.status!=="denied"; }).length;
    cards.push('<div class="card"><div class="card-h"><h3>Assigned to you</h3><a class="sec-link" href="#/hub/staffdesk">Staff Desk</a></div><div class="card-b">'+
      (mine.length
        ? mine.slice(0,4).map(function(a){
            var meta = (CG.ACTION_META&&CG.ACTION_META[a.type])||{label:a.type};
            return '<div class="notif" data-go="#/hub/complaint?id='+esc((a.id||"").slice(0,8))+'" style="cursor:pointer"><span class="nf-ic" style="color:var(--red)">'+CG.ic("flag",15)+'</span>'+
              '<span style="min-width:0"><b>'+esc((a.id||"").slice(0,8))+' — '+esc(meta.label)+'</b><p>'+esc(a.subject||a.status||"Under review")+'</p></span></div>';
          }).join("")
        : '<p class="small" style="color:var(--steel)">No cases assigned to you right now'+(openAll?' — '+openAll+' open in the queue.':'.')+'</p>')+
      '</div></div>');
  }
  if (r==="commish"){
    var openCases = (lg._actionReqs||[]).filter(function(a){ return a.status!=="resolved" && a.status!=="denied"; }).length;
    var pendApps = (lg._staffApps||[]).concat(lg._ownerApps||[], lg._mgmtApps||[]).filter(function(a){ return a.status==="pending"; }).length;
    cards.push('<div class="card" style="border-color:var(--ink)"><div class="card-h"><h3>League office</h3><a class="sec-link" href="#/admin">Control Center</a></div><div class="tasklist">'+
      '<div class="titem"><span class="t-dot'+(openCases?" red":" grn")+'"></span><span style="flex:1">'+openCases+' open case'+(openCases===1?"":"s")+' in the queue.</span><a class="btn btn-ghost btn-sm" href="#/hub/staffdesk">Staff Desk</a></div>'+
      '<div class="titem"><span class="t-dot'+(pendApps?" red":" grn")+'"></span><span style="flex:1">'+pendApps+' application'+(pendApps===1?"":"s")+' awaiting the reviewer vote.</span><a class="btn btn-ghost btn-sm" href="#/hub/staffdesk">Review</a></div>'+
      '<div class="titem"><span class="t-dot grn"></span><span style="flex:1">Full league controls — schedule, teams, automations, EA stats.</span><a class="btn btn-ghost btn-sm" href="#/admin">Open</a></div>'+
      '</div></div>');
  }
  /* notifications preview for everyone signed in */
  var notifs = CG.baseNotifs().slice(0,3);
  cards.push('<div class="card"><div class="card-h"><h3>Latest alerts</h3><a class="sec-link" href="#/hub/notifications">All</a></div>'+
    notifs.map(function(n){
      return '<div class="notif'+(CG.store.get("read")[n.id]?"":" unread")+'" data-notif="'+n.id+'" data-route="'+esc(n.route||"")+'">'+
        '<span class="nf-ic">'+CG.ic(n.icon||"bell",15)+'</span><span style="min-width:0"><b>'+esc(n.title)+'</b><p>'+esc(n.body)+'</p></span></div>';
    }).join("")+'</div>');
  return h + '<div class="grid g2">'+cards.join("")+'</div>';
};

/* Tonight's slate — every game clickable through to its matchup center
   (line matchup, server/lobby settings, and the private game code). */
CG.tonightCard = function(me, myGame, inLineup){
  var lg = CG.lg;
  var rows = lg.tonight.slice().sort(function(a,b){ return a.at-b.at; }).map(function(g){
    var mine = me && (g.home===me.team||g.away===me.team);
    return '<div class="notif" data-go="#/matchup/'+g.id+'" style="cursor:pointer'+(mine?';background:var(--chrome-tint)':"")+'">'+
      '<span class="nf-ic">'+CG.crest(g.away,22)+'</span>'+
      '<span style="min-width:0"><b style="font-family:var(--f-disp)">'+esc(CG.TEAM[g.away].code)+' @ '+esc(CG.TEAM[g.home].code)+'</b>'+
      '<p>'+esc(CG.TEAM[g.away].name)+' at '+esc(CG.TEAM[g.home].name)+
        (g.feature?' · <span style="color:var(--chrome-deep);font-weight:700">Marquee</span>':"")+
        (mine?' · <span style="font-weight:700">your game</span>':"")+'</p></span>'+
      '<span class="nf-t" style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">'+CG.fmtTime(g.at)+
        '<span class="chip" style="font-size:9px;padding:1px 7px">Matchup ›</span></span></div>';
  }).join("");
  /* Only ever tell a player they ARE playing. A club that has not posted its lineup, a fetch that
     failed, and a genuine healthy scratch are indistinguishable to the reader and all three read
     as bad news, so none of them get a message — the card just falls back to the slate. This also
     means the only claim the card makes is a positive one taken from a real lineup row, which is
     why it can no longer be wrong. */
  var note = (myGame && inLineup)
    ? '<div class="card-b" style="border-top:1px solid var(--line)"><p class="small" style="color:var(--steel)">'+
      "You’re in the confirmed lineup at "+CG.POS_NAME[me.pos]+". Your private game code goes live at "+
      CG.fmtTime(myGame.at-30*60000)+" — open the matchup to grab it."+'</p></div>'
    : '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Tap any game for confirmed lines, server settings, and the private lobby code (Rule 4.2).</span></div>';
  return '<div class="card" style="grid-column:1/-1"><div class="card-h"><h3>Tonight’s slate</h3>'+
    '<span class="chip chip-live"><span class="live-dot"></span>'+lg.tonight.length+' game'+(lg.tonight.length===1?"":"s")+'</span></div>'+
    rows + note + '</div>';
};

/* ---------- availability ---------- */
CG.hubAvailability = function(){
  var me = CG.me(), lg = CG.lg, r = CG.role();
  if (!CG.can("availability.submit") && !CG.can("availability.viewTeam")) return CG.unauthorized();
  /* with no game week scheduled the window isn't "closed", it hasn't opened — and `now > null`
     coerces to true, which would otherwise show the deadline-passed state before a season exists */
  var closed = CG.WEEK8.open && CG.now() > CG.WEEK8.deadline;
  var mine = me ? CG.availGet(me.id) : null;
  var h = '<div style="margin-bottom:22px"><span class="eyebrow chr">'+esc(CG.WEEK8.label)+
      (CG.WEEK8.open ? ' · deadline '+CG.fmtFull(CG.WEEK8.deadline) : ' · not yet scheduled')+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Weekly availability</h1>'+
    '<p class="lede" style="margin-top:8px">'+(CG.WEEK8.nights.length||0)+' night'+(CG.WEEK8.nights.length===1?'':'s')+' this week. Answers stay private to your club’s management and league staff (Rule 5.1'+(r==="mgmt"?" — as GM you also see the team grid below":"")+').</p></div>';
  var form = !me
    ? '<div class="note">You’re viewing as league staff — no player profile, so there’s nothing personal to submit. The team grid below is what management and staff see.</div>'
    : '<div class="card"><div class="card-h"><h3>My submission</h3>'+
    '<span class="chip '+(mine?"chip-win":closed?"chip-loss":"chip-warn")+'">'+(closed?"Window closed":mine?"Submitted "+CG.fmtDay(mine.at):"Not submitted")+'</span></div>'+
    '<div class="card-b">'+
    (closed && !mine ? '<div class="empty"><b>The '+esc(CG.WEEK8.label)+' window has closed</b><p>Availability locked at the deadline. Message your GM — a commissioner can still enter a late submission with an override.</p></div>'
    : CG.WEEK8.nights.map(function(n,i){
      var cur = mine && mine.nights[n.key] ? mine.nights[n.key].st : null;
      var note = mine && mine.nights[n.key] ? (mine.nights[n.key].note||"") : "";
      return '<div style="padding:14px 0;border-top:'+(i?"1px solid var(--line-soft)":"0")+'">'+
        '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:11px">'+
        '<b style="font-family:var(--f-disp)">'+CG.fmtFull(n.at)+'</b><span class="caption">Game night '+(i+1)+'</span></div>'+
        '<div class="av-opt" data-night="'+n.key+'">'+CG.AV_OPTS.map(function(o){
          return '<button data-av="'+o[0]+'" class="'+(cur===o[0]?("on "+(o[0]==="yes"?"yes":o[0]==="no"?"no":"")):"")+'" '+(closed?"disabled":"")+'>'+o[1]+'</button>';
        }).join("")+'</div>'+
        '<input type="text" data-note="'+n.key+'" placeholder="Optional note (e.g. “on at 9:30 after work”)" value="'+esc(note)+'" style="margin-top:10px;max-width:460px" '+(closed?"disabled":"")+'>'+
      '</div>';
    }).join("")+
    (!closed?'<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">'+
      '<button class="btn btn-chrome" id="avSubmit">'+(mine?"Update availability":"Submit availability")+'</button>'+
      '<button class="btn btn-ghost" id="avCopy">Copy last week (all available)</button>'+
      '<span class="caption" style="align-self:center" id="avCount"></span></div>':""))+
    '</div></div>';
  var grid = "";
  if (CG.can("availability.viewTeam")){
    var roster = (lg.byTeam[me&&me.team?me.team:CG.myClub()]||[]).slice().sort(function(a,b){ return a.pos.localeCompare(b.pos); });
    grid = '<div class="card" style="margin-top:20px"><div class="card-h"><h3>Team grid — '+esc((CG.TEAM[me&&me.team?me.team:CG.myClub()]||{}).name||"—")+'</h3>'+
      '<span class="chip">Visible to management & staff only</span></div>'+
      '<div class="tblwrap"><table class="tbl keepcols"><caption>'+esc(CG.WEEK8.label)+' availability by player</caption><thead><tr>'+
      '<th class="tleft">Player</th><th>POS</th>'+
      CG.WEEK8.nights.map(function(n){
        return '<th>'+esc(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",month:"numeric",day:"numeric"}).format(new Date(n.at)))+'</th>';
      }).join("")+
      '<th class="tleft">Note</th><th>Logged</th></tr></thead><tbody>'+
      roster.map(function(p){
        var av = CG.avFor(p.id);
        function cell(nk){
          var st = av.nights[nk] ? av.nights[nk].st : "nr";
          var map = { yes:["yes","✓"], no:["no","✗"], maybe:["mb","?"], late:["mb","L"], until:["mb","U"], emg:["mb","E"], nr:["nr","—"] };
          var m = map[st]||map.nr;
          return '<span class="avcell '+m[0]+'" title="'+st+'">'+m[1]+'</span>';
        }
        var noteN = CG.WEEK8.nights.filter(function(n){ return av.nights[n.key] && av.nights[n.key].note; })[0];
        var note = noteN ? av.nights[noteN.key].note : "";
        var silent = CG.WEEK8.nights.every(function(n){ return !av.nights[n.key] || av.nights[n.key].st==="nr"; });
        return '<tr'+(me&&p.id===me.id?' style="background:var(--chrome-tint)"':"")+'>'+
          '<td class="tleft"><span class="playercell">'+CG.crest(p.team,20)+'<span class="nm">'+esc(p.tag)+'</span>'+(me&&p.id===me.id?'<span class="chip" style="font-size:9px;padding:1px 7px">you</span>':"")+'</span></td>'+
          '<td class="tnum">'+p.pos+'</td>'+
          CG.WEEK8.nights.map(function(n){ return '<td>'+cell(n.key)+'</td>'; }).join("")+
          '<td class="tleft small" style="color:var(--steel);max-width:220px">'+esc(note)+'</td>'+
          '<td class="tnum" style="font-size:11px">'+(silent?'<span class="chip chip-loss" style="font-size:9px">no response</span>':CG.fmtDay(av.at))+'</td></tr>';
      }).join("")+'</tbody></table></div>'+
      '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">✓ available · ✗ unavailable · ? maybe · L late · U until a time · E emergency only · — no response. Opponents never see this grid — they only see your finalized lineup.</span></div></div>';
  }
  return h + form + grid;
};
CG.AFTER._availability = function(){
  var me = CG.me(); if (!me) return;
  var picks = {};
  var mine = CG.availGet(me.id);
  if (mine) Object.keys(mine.nights).forEach(function(k){ picks[k]=mine.nights[k].st; });
  var NIGHTS = ((CG.WEEK8 && CG.WEEK8.nights) || []).map(function(n){ return n.key; });
  function refreshCount(){
    var n = NIGHTS.filter(function(k){ return picks[k]; }).length;
    var el = $("#avCount"); if (el) el.textContent = n+"/"+NIGHTS.length+" night"+(NIGHTS.length===1?"":"s")+" answered";
  }
  $$(".av-opt").forEach(function(grp){
    grp.addEventListener("click", function(e){
      var b = e.target.closest("[data-av]"); if (!b || b.disabled) return;
      $$("button",grp).forEach(function(x){ x.className=""; });
      var v = b.getAttribute("data-av");
      b.className = "on "+(v==="yes"?"yes":v==="no"?"no":"");
      picks[grp.getAttribute("data-night")] = v;
      refreshCount();
    });
  });
  var sub = $("#avSubmit");
  if (sub) sub.addEventListener("click", function(){
    var missing = NIGHTS.filter(function(k){ return !picks[k]; });
    if (missing.length){
      CG.toast("Answer all "+NIGHTS.length+" night"+(NIGHTS.length===1?"":"s")+" before submitting","err"); return;
    }
    var entry = { at: CG.now(), nights:{} };
    NIGHTS.forEach(function(k){
      entry.nights[k] = { st:picks[k], note: ($("[data-note="+k+"]")||{}).value||"" };
    });
    CG.availSave(entry, function(ok){
      if (!ok) return;
      CG.pushNotif("check","Availability submitted",CG.WEEK8.label+" — logged "+CG.fmtFull(entry.at)+". You can edit until Sunday 8 PM ET.","#/hub/availability");
      CG.toast(CG.WEEK8.label+" availability submitted","ok");
      CG.renderChrome(); CG.router();
    });
  });
  var cp = $("#avCopy");
  if (cp) cp.addEventListener("click", function(){
    picks = {}; NIGHTS.forEach(function(k){ picks[k] = "yes"; });
    $$(".av-opt").forEach(function(grp){
      $$("button",grp).forEach(function(x){ x.className = x.getAttribute("data-av")==="yes"?"on yes":""; });
    });
    refreshCount(); CG.toast("Marked available for all "+NIGHTS.length+" night"+(NIGHTS.length===1?"":"s"));
  });
  refreshCount();
};

/* ---------- lineup builder ---------- */
/* ---------- server veto (ported from the classic site, real game_vetoes DB) ----------
   Home club picks 1st + 2nd server choice; away club picks a veto (won't play) + a
   preferred. Picks are private to each club and lock 30 min before puck drop, when the
   resolve_game_server RPC settles the server from both clubs' picks. */
CG.SERVERS = ["NA East","NA Northeast","NA Central"];
CG.VETO_LOCK_MS = 30*60000;
/* The night a game belongs to, in league time. This used to answer "fri" or else "wed", which was
   fine while the week was two nights and silently wrong the moment a third arrived — a Thursday
   game reported itself as Wednesday and the lineup builder would open the wrong one. */
CG.NIGHT_LABEL = { sun:"Sunday", mon:"Monday", tue:"Tuesday", wed:"Wednesday", thu:"Thursday", fri:"Friday", sat:"Saturday" };
CG.gameNight = function(g){
  try {
    var d = new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short"}).format(new Date(g.at));
    return String(d).slice(0,3).toLowerCase();
  } catch(e){ return "wed"; }
};
/* which availability night (n1/n2) covers this game — null when the game isn't in the window */
CG.nightAvKey = function(game){
  var n = ((CG.WEEK8 && CG.WEEK8.nights) || []).find(function(x){ return Math.abs(x.at - game.at) < 6*3600000; });
  return n ? n.key : null;
};
/* The club this Team HQ session operates AS. A real seat (me.team / a management seat) wins;
   otherwise the commissioner's front-office preview supplies it. This is what lets a commissioner
   open any club's builder and line creator with full access — the DB side already allows it
   (is_commissioner() passes every management RPC); the frontend just used to key everything off
   me.team, which a commissioner without a roster spot doesn't have. */
CG.hqClub = function(){
  var t = CG.myManagedTeam && CG.myManagedTeam();
  if (t && t.code) return t.code;
  var me = CG.me();
  return (me && me.team) || null;
};
/* the lineup builder's target game — honors #/hub/lineup?night=<wed|thu|fri|...>, else tonight/next */
CG.lineupGameFor = function(me){
  var lg = CG.lg, club = CG.hqClub() || (me && me.team);
  var qs = location.hash.split("?")[1]||"";
  var mine = function(g){ return (g.home===club||g.away===club) && g.status!=="final"; };
  /* ?game=<id> targets one specific game. With three games a night at 21:00/21:35/22:10, games 2
     and 3 lock (T-30) before game 1 finals, so "earliest unplayed of the night" could never reach
     them — every game must be addressable directly. */
  var gm = qs.match(/game=([0-9a-f-]{8,})/i);
  if (gm){
    var gById = lg.schedule.filter(mine).find(function(g){ return g.id===gm[1]; });
    if (gById) return gById;
  }
  var m = qs.match(/night=([a-z]{3})/);
  var want = m ? m[1] : null;
  if (want){
    var g2 = lg.schedule.filter(mine).filter(function(g){ return g.at>CG.now()-3*3600000 && CG.gameNight(g)===want; })
      .sort(function(a,b){ return a.at-b.at; })[0];
    if (g2) return g2;
  }
  return lg.tonight.find(function(g){ return g.home===club||g.away===club; })
    || lg.schedule.filter(function(g){ return (g.home===club||g.away===club) && g.at>CG.now(); })
        .sort(function(a,b){ return a.at-b.at; })[0];
};
/* Every upcoming (non-final) game for a club, soonest first — the unit the lineup surfaces now
   iterate. A night has up to three; each locks on its own puck drop. */
CG.clubUpcomingGames = function(club, limit){
  var out = (CG.lg.schedule||[]).filter(function(g){
    return (g.home===club||g.away===club) && g.status!=="final" && g.at>CG.now()-3*3600000;
  }).sort(function(a,b){ return a.at-b.at; });
  return limit ? out.slice(0, limit) : out;
};
/* All of one night's upcoming games for a club (dressing a night covers every game in it). */
CG.nightGames = function(club, nightKey){
  return CG.clubUpcomingGames(club).filter(function(g){ return CG.gameNight(g)===nightKey; });
};
/* one game's server-pick controls (compact, used by the Schedule desk).
   `lockAt` is 30 min before the NIGHT'S FIRST puck drop — servers stay unset
   until then, and picks freeze for the whole night at that moment. */
CG.serverVetoControls = function(game, me, lockAt){
  var mine = (CG.lg._vetoes||{})[game.id] || {};
  var home = game.home===(CG.hqClub() || (me && me.team));
  function opts(sel){ return '<option value="">— pick —</option>'+CG.SERVERS.map(function(s){ return '<option value="'+esc(s)+'"'+(s===sel?" selected":"")+'>'+esc(s)+'</option>'; }).join(""); }
  if (CG.now() >= lockAt){
    var srv = (CG.lg._servers||{})[game.id];
    return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="lock">'+CG.ic("lock",13)+'Picks locked</span>'+
      '<span class="small">Server: <b style="font-family:var(--f-disp)">'+(srv?esc(srv):"resolving…")+'</b></span></div>';
  }
  if (home){
    return '<div class="grid g2" style="gap:12px">'+
      '<label class="fld" style="margin:0"><span>1st choice · home</span><select class="srv-sel" data-veto-game="'+game.id+'" data-veto-field="pref1">'+opts(mine.pref1)+'</select></label>'+
      '<label class="fld" style="margin:0"><span>2nd choice</span><select class="srv-sel" data-veto-game="'+game.id+'" data-veto-field="pref2">'+opts(mine.pref2)+'</select></label></div>';
  }
  return '<div class="grid g2" style="gap:12px">'+
    '<label class="fld" style="margin:0"><span>Veto — won’t play</span><select class="srv-sel" data-veto-game="'+game.id+'" data-veto-field="veto">'+opts(mine.veto)+'</select></label>'+
    '<label class="fld" style="margin:0"><span>Preferred</span><select class="srv-sel" data-veto-game="'+game.id+'" data-veto-field="preferred">'+opts(mine.preferred)+'</select></label></div>';
};
CG.saveVeto = function(gameId, changedSel){
  var club = CG.hqClub(); if(!club) return;
  var tid = (CG.lg._codeToId||{})[club]; if(!tid){ CG.toast("This seat has no club","err"); return; }
  var body = changedSel.closest(".card-b");
  function val(f){ var el=body.querySelector('.srv-sel[data-veto-field="'+f+'"]'); return el&&el.value?el.value:null; }
  var g = CG.lg.schedule.find(function(x){ return x.id===gameId; })||{};
  var rec = { game_id:gameId, team_id:tid, updated_by:(CG.auth&&CG.auth.user?CG.auth.user.id:null), updated_at:new Date().toISOString() };
  if (g.home===club){
    var p1=val("pref1"), p2=val("pref2");
    if(p1&&p2&&p1===p2){ CG.toast("1st and 2nd choices must differ","err"); changedSel.value=""; return; }
    rec.pref1=p1; rec.pref2=p2;
  } else {
    var veto=val("veto"), pref=val("preferred");
    if(veto&&pref&&veto===pref){ CG.toast("Preferred can’t be the server you vetoed","err"); changedSel.value=""; return; }
    rec.veto=veto; rec.preferred=pref;
  }
  CG.sb.from("game_vetoes").upsert(rec,{onConflict:"game_id,team_id"}).then(function(r){
    if(r.error){ CG.toast(/lock/i.test(r.error.message||"")?"Picks are locked":"Couldn’t save: "+r.error.message,"err"); return; }
    CG.lg._vetoes = CG.lg._vetoes||{}; CG.lg._vetoes[gameId] = Object.assign({}, CG.lg._vetoes[gameId]||{}, rec);
    CG.toast(g.home===club?"1st & 2nd choices saved":"Veto & preferred saved","ok");
  });
};

CG.hubLineup = function(qs){
  var me = CG.me(), lg = CG.lg;
  /* the club this session operates AS — a real seat, or the commissioner front-office preview.
     Keyed off hqClub() rather than the viewer's own roster row, so a commissioner with no roster
     spot can run any club's builder with full access; the DB has always allowed it
     (is_commissioner() passes set_game_lineup), only this guard was in the way. */
  var club = CG.hqClub();
  if (!club || !CG.lg.byTeam[club]) return '<div class="note">This account doesn’t run a club — the lineup builder belongs to team management.</div>';
  var game = CG.lineupGameFor(me);
  if (!game){
    var anyGames = (CG.lg.schedule||[]).length > 0;
    return '<div class="empty"><b>No upcoming game</b><p>'+(anyGames
      ? 'The schedule is complete — nothing to build.'
      : 'No games on the calendar yet — this desk wakes up when the schedule is published.')+'</p></div>';
  }
  var opp = game.home===club ? game.away : game.home;
  var key = game.id+":"+club;
  var saved = (CG.store.get("lineups")||{})[key];
  var dbLu = (CG.lg._lineups||{})[club+":"+game.id];
  var lockAt = game.at - 30*60000;
  var rawLocked = CG.now() >= lockAt;
  /* Emergency call-up: once a game locks, management can still swap a player after the deadline.
     A per-game flag flips the builder back into an editable, clearly-flagged emergency mode. */
  var emergency = !!(CG._luEmergency && CG._luEmergency[game.id]);
  var locked = rawLocked && !emergency;
  var status = saved ? saved.status : (dbLu ? "submitted" : "draft");
  var slots = saved ? saved.slots
    : (dbLu ? { LW:dbLu.lw||null, C:dbLu.center||null, RW:dbLu.rw||null, LD:dbLu.ld||null, RD:dbLu.rd||null, G:dbLu.goalie||null } : {});
  var roster = lg.byTeam[club];
  var suspended = {};
  lg.suspensions.forEach(function(s){ if (s.team===club && s.status!=="served") suspended[s.playerId]=true; });
  var assigned = Object.values(slots);
  /* Per-GAME switcher: one chip per upcoming game, not per night. Three games a night each lock on
     their own puck drop, so a manager must be able to jump straight to game 2 or 3 — the old
     per-night switcher only ever reached the first game of a night. Each chip shows its slot time
     and whether a lineup is in, submitted, or locked. */
  var upcoming = CG.clubUpcomingGames(club, 9);
  var gameSwitch = upcoming.length > 1
    ? '<span style="display:inline-flex;gap:6px;margin-left:12px;vertical-align:middle;flex-wrap:wrap">'+
      upcoming.map(function(g){
        var on = g.id===game.id;
        var gLock = CG.now() >= g.at - 30*60000;
        var gIn = !!((lg._lineups||{})[club+":"+g.id]);
        var mark = gIn ? " ✓" : gLock ? " ·" : "";
        return '<a class="chip '+(on?"chip-chrome":"")+(gLock&&!gIn?" chip-warn":"")+'" href="#/hub/lineup?game='+g.id+'" aria-current="'+on+'" '+
          'title="'+esc(CG.fmtFull(g.at))+(gIn?" — submitted":gLock?" — locked":"")+'" style="cursor:pointer">'+
          (CG.NIGHT_LABEL[CG.gameNight(g)]||CG.gameNight(g))+' '+CG.fmtTime(g.at)+mark+'</a>';
      }).join("")+'</span>'
    : "";
  var nightSwitch = gameSwitch;
  var h = '<div style="margin-bottom:20px"><span class="eyebrow chr">'+CG.fmtFull(game.at)+' · vs '+esc(CG.TEAM[opp].name)+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Per-game adjustments'+nightSwitch+'</h1>'+
    '<p class="lede" style="margin-top:8px">One game, one lineup. Day-to-day lines live in the <a href="#/hub/lines" style="font-weight:700;border-bottom:2px solid var(--chrome)">Lineup builder</a> — this page adjusts a single night, and after the '+CG.fmtTime(lockAt)+' lock every change costs one in-game penalty (Rule 5.3).</p></div>';
  /* the night plan reaching the real game: when this night has a planned line, offer it as a
     one-click fill. Fill only — submitting stays an explicit second step. */
  var planSlot = (lg._linePlan||{})[CG.gameNight(game)];
  var planRow = planSlot && (lg._teamLines||{})[planSlot];
  var editControls = (planRow ? '<button class="btn btn-ghost btn-sm" id="luFromPlan" data-plan-slot="'+planSlot+'" title="Fill the slots from the line planned for this night in the Lineup builder">Fill from '+esc(planRow.name||("Line "+planSlot))+'</button>' : "")+
    '<button class="btn btn-ghost btn-sm" id="luAuto">Auto-fill best available</button>'+
    '<button class="btn btn-ghost btn-sm" id="luClear">Clear</button>'+
    '<button class="btn btn-chrome btn-sm" id="luSubmit">'+(emergency?"Submit emergency call-up":(status==="submitted"?"Resubmit":"Submit lineup"))+'</button>';
  var bar = '<div class="note '+(emergency?"red":(status==="submitted"?"grn":"chr"))+'" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:18px">'+
    '<b style="font-family:var(--f-disp)">Status: '+(emergency?"Emergency call-up":(rawLocked?"Locked":status))+'</b>'+
    (rawLocked&&!emergency?'<span class="caption">locked '+CG.fmtTime(lockAt)+' (Rule 5.3)</span>':(saved&&saved.at?'<span class="caption">last saved '+CG.fmtFull(saved.at)+'</span>':""))+
    '<span style="margin-left:auto;display:flex;gap:9px">'+
    (!rawLocked ? editControls
      : emergency ? editControls+'<button class="btn btn-ghost btn-sm" id="luEmCancel">Cancel</button>'
      : '<span class="lock">'+CG.ic("lock",14)+'Locked</span><button class="btn btn-ghost btn-sm" id="luEmergency" title="Swap a player after the deadline for an emergency call-up">Emergency call-up</button>')+
    '</span></div>'+
    (emergency?'<div class="note red" style="margin-bottom:18px;font-size:13px;line-height:1.5">This game locked at '+CG.fmtTime(lockAt)+'. Emergency call-ups are for a genuine no-show — the swap is recorded, and the opponent already sees the locked lineup. Change only the player you must.</div>':"");
  var rink = '<div class="rink"><div class="rk-rows">'+
    '<div class="rk-line">'+["LW","C","RW"].map(function(pos){ return CG.luSlot(pos, slots[pos], locked); }).join("")+'</div>'+
    '<div class="rk-line d2">'+["LD","RD"].map(function(pos){ return CG.luSlot(pos, slots[pos], locked); }).join("")+'</div>'+
    '<div class="rk-line g1">'+CG.luSlot("G", slots.G, locked)+'</div>'+
  '</div></div>';
  var bench = '<div class="card"><div class="card-h"><h3>Bench — '+esc(CG.TEAM[club].name)+'</h3><span class="chip">'+roster.length+' rostered</span></div>'+
    '<div class="card-b bench">'+roster.slice().sort(function(a,b){ return a.pos.localeCompare(b.pos)||a.depth-b.depth; }).map(function(p){
      var av = CG.avFor(p.id);
      var avKey = CG.nightAvKey(game);   /* the availability answer for THIS game's night, not always Wednesday's */
      var un = avKey && av.nights[avKey] && av.nights[avKey].st==="no";
      var used = assigned.indexOf(p.id)>=0;
      var dis = suspended[p.id];
      var reason = dis ? "Suspended (Rule 7.4)" : un ? "Marked unavailable" : "";
      return '<div class="bp'+(used?" dis":"")+(dis||un?" dis":"")+'" data-bench="'+p.id+'" draggable="'+(!locked&&!used&&!dis)+'" '+(reason?'title="'+esc(reason)+'"':"")+'>'+
        CG.crest(p.team,20)+'<b style="font-size:13px">'+esc(p.tag)+'</b><span class="mono" style="font-size:10px;color:var(--steel)">'+p.pos+'</span>'+
        (dis?'<span class="chip chip-loss" style="font-size:9px">SUSP</span>':un?'<span class="chip chip-warn" style="font-size:9px">UNAVAIL</span>':used?'<span class="chip chip-win" style="font-size:9px">IN</span>':"")+
        '<span class="bp-meta">OVR '+lg.ratings[p.id].ovr+'</span></div>';
    }).join("")+'</div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption" id="luMsg">Assignments validate position, availability, suspension, and duplicates — errors explain themselves.</span></div></div>';
  var hist = saved && saved.rev && saved.rev.length
    ? '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Revision history</h3></div>'+
      saved.rev.map(function(rv){ return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("clock",14)+'</span><span><b>'+esc(rv.what)+'</b></span><span class="nf-t">'+CG.fmtTime(rv.at)+'</span></div>'; }).join("")+'</div>'
    : "";
  return h + bar + '<div class="grid g5x7" style="align-items:start"><div>'+rink+
    (CG.LIVE_MODE?'<div class="note" style="margin-top:18px">Server picks &amp; lobby codes live on the <a href="#/hub/schedule" style="font-weight:700;border-bottom:2px solid var(--chrome)">Schedule desk</a>.</div>':"")+
    hist+'</div>'+bench+'</div>';
};
CG.luSlot = function(pos, pid, locked){
  var p = pid && CG.playerById(CG.lg, pid);
  return '<div class="slot'+(p?" filled":"")+'" data-slot="'+pos+'" '+(locked?"":'tabindex="0" role="button" aria-label="'+CG.POS_NAME[pos]+' slot"')+'>'+
    '<div class="sl-pos">'+CG.POS_NAME[pos]+'</div>'+
    (p?'<div class="sl-name">'+esc(p.tag)+'</div><div class="sl-sub">OVR '+CG.lg.ratings[p.id].ovr+' · tap to clear</div>'
      :'<div class="sl-sub" style="margin-top:14px">Empty — assign from the bench</div>')+'</div>';
};
CG.AFTER._lineup = function(){
  var me = CG.me(), club = CG.hqClub();
  if (!club) return;
  var lg = CG.lg;
  var game = CG.lineupGameFor(me);
  if (!game) return;
  var key = game.id+":"+club;
  var store = CG.store.get("lineups")||{};
  var _dbLu = (CG.lg._lineups||{})[club+":"+game.id];
  var state = store[key] || (_dbLu
    ? { slots:{ LW:_dbLu.lw||undefined, C:_dbLu.center||undefined, RW:_dbLu.rw||undefined, LD:_dbLu.ld||undefined, RD:_dbLu.rd||undefined, G:_dbLu.goalie||undefined }, status:"submitted", rev:[] }
    : { slots:{}, status:"draft", rev:[] });
  var sel = null;
  /* the availability night (n1/n2) covering this game — null when it's outside the window */
  var avNightKey = CG.nightAvKey(game);
  /* In emergency-call-up mode the deadline is deliberately overridden for management. */
  function inEmergency(){ return !!(CG._luEmergency && CG._luEmergency[game.id]); }
  function isLocked(){ return CG.now() >= game.at - 30*60000 && !inEmergency(); }
  function msg(t, bad){ var el=$("#luMsg"); if (el){ el.textContent=t; el.style.color = bad?"var(--red)":"var(--steel)"; } }
  function save(what, status){
    state.at = CG.now();
    if (status) state.status = status;
    state.rev = (state.rev||[]).concat([{at:CG.now(), what:what}]).slice(-6);
    store[key]=state; CG.store.set("lineups", store);
    CG.router();
  }
  function validate(p, pos){
    if (isLocked()) return "The lineup locked at "+CG.fmtTime(game.at-30*60000)+" (Rule 5.3) — use an emergency call-up to swap a player now.";
    /* Rule 2.1 — position groups are binding, but a training-camp player fills any slot */
    if (p.squad!=="tc" && CG.posGroup(p.pos)!==CG.posGroup(pos))
      return p.tag+" is a "+(CG.POS_NAME[p.pos]||p.pos)+" — this slot needs a "+CG.POS_NAME[pos]+". Only training-camp players fill any position (Rule 2.1).";
    if (lg.suspensions.some(function(s){ return s.playerId===p.id && s.status!=="served"; })) return p.tag+" is suspended and cannot be assigned (Rule 7.4).";
    if (avNightKey && (CG.avFor(p.id).nights[avNightKey]||{}).st==="no") return p.tag+" is marked unavailable for this night.";
    if (Object.values(state.slots).indexOf(p.id)>=0) return p.tag+" is already in the lineup.";
    return null;
  }
  function assign(pid, pos){
    var p = CG.playerById(lg, pid);
    var err = validate(p, pos);
    if (err){ msg(err, true); CG.toast(err, "err"); return; }
    state.slots[pos] = pid;
    save("Assigned "+p.tag+" to "+pos);
  }
  document.querySelectorAll("[data-bench]").forEach(function(el){
    el.addEventListener("click", function(){
      if (el.classList.contains("dis")) { msg(el.getAttribute("title")||"That player can’t be assigned.", true); return; }
      sel = el.getAttribute("data-bench");
      $$(".bp").forEach(function(x){ x.classList.remove("sel"); });
      el.classList.add("sel");
      var p = CG.playerById(lg, sel);
      msg("Selected "+p.tag+" — now click "+(p.squad==="tc" ? "any slot (camp players fill any position)" : "a "+CG.posGroup(p.pos)+" slot")+".");
      $$(".slot").forEach(function(s){ s.classList.toggle("target", p.squad==="tc" || CG.posGroup(s.getAttribute("data-slot"))===CG.posGroup(p.pos)); });
    });
    el.addEventListener("dragstart", function(ev){ ev.dataTransfer.setData("text/plain", el.getAttribute("data-bench")); });
  });
  $$(".slot").forEach(function(s){
    var pos = s.getAttribute("data-slot");
    s.addEventListener("click", function(){
      if (isLocked()){ msg("The lineup locked at "+CG.fmtTime(game.at-30*60000)+" (Rule 5.3).", true); return; }
      if (sel){ assign(sel, pos); sel=null; return; }
      if (state.slots[pos]){
        var p = CG.playerById(lg, state.slots[pos]);
        delete state.slots[pos];
        save("Removed "+p.tag+" from "+pos);
      }
    });
    s.addEventListener("keydown", function(e){ if (e.key==="Enter"||e.key===" "){ e.preventDefault(); s.click(); } });
    s.addEventListener("dragover", function(e){ e.preventDefault(); s.classList.add("target"); });
    s.addEventListener("dragleave", function(){ s.classList.remove("target"); });
    s.addEventListener("drop", function(e){ e.preventDefault(); assign(e.dataTransfer.getData("text/plain"), pos); });
  });
  var fromPlan = $("#luFromPlan");
  if (fromPlan) fromPlan.addEventListener("click", function(){
    if (isLocked()){ CG.toast("Lineup is locked (Rule 5.3)","err"); return; }
    var pslot = parseInt(fromPlan.getAttribute("data-plan-slot"),10);
    var prow = (lg._teamLines||{})[pslot]; if (!prow) return;
    /* fill through the same per-slot validation the bench uses — a planned player who has since
       been suspended, traded, or marked unavailable is skipped and named, not silently dressed.
       The plan REPLACES the draft (cleared first): without this, a player the plan moves to a
       different slot trips the duplicate check against his own old position. */
    var skipped = [];
    state.slots = {};
    var pslots = CG.lineFromRow(prow);
    ["LW","C","RW","LD","RD","G"].forEach(function(pos){
      var pid = pslots[pos]; if (!pid) return;
      var p = CG.playerById(lg, pid);
      var why = p ? validate(p, pos) : "no longer rostered";
      if (why){ skipped.push((p?p.tag:"a player")+" ("+why+")"); return; }
      state.slots[pos] = pid;
    });
    save("Filled from "+(prow.name||("Line "+pslot)));
    if (skipped.length) CG.toast("Filled, except: "+skipped.join("; "),"err");
    else CG.toast("Filled from "+(prow.name||("Line "+pslot))+" — review and submit","ok");
  });
  var auto = $("#luAuto");
  if (auto) auto.addEventListener("click", function(){
    if (isLocked()){ CG.toast("Lineup is locked (Rule 5.3)","err"); return; }
    ["LW","C","RW","LD","RD","G"].forEach(function(pos){
      /* group-based eligibility (matches the DB); camp players are eligible anywhere
         but sort last so auto-fill spends a pro player before a camp player's cap */
      var pick = lg.byTeam[club].filter(function(p){ return p.squad==="tc" || CG.posGroup(p.pos)===CG.posGroup(pos); })
        .sort(function(a,b){
          var ac=a.squad==="tc"?1:0, bc=b.squad==="tc"?1:0;
          return ac-bc || lg.ratings[b.id].ovr-lg.ratings[a.id].ovr;
        })
        .find(function(p){ return !validate(p,pos) || state.slots[pos]===p.id; });
      if (pick) state.slots[pos]=pick.id;
    });
    save("Auto-filled best available lineup");
    CG.toast("Best available lineup filled","ok");
  });
  var clr = $("#luClear");
  if (clr) clr.addEventListener("click", function(){
    if (isLocked()){ CG.toast("Lineup is locked (Rule 5.3)","err"); return; }
    state.slots={}; save("Cleared all slots");
  });
  var sub = $("#luSubmit");
  if (sub) sub.addEventListener("click", function(){
    var pastLock = CG.now() >= game.at - 30*60000;
    if (pastLock && !inEmergency()){ CG.toast("Lineup is locked (Rule 5.3) — use an emergency call-up","err"); return; }
    var missing = ["LW","C","RW","LD","RD","G"].filter(function(pos){ return !state.slots[pos]; });
    if (missing.length){ CG.toast("Fill every slot first — missing "+missing.join(", "), "err"); return; }
    var emg = pastLock;   /* submitting after the lock is, by definition, an emergency call-up */
    CG.confirm(emg?"Confirm emergency call-up?":"Submit this lineup?",
      emg?"This game already locked. EACH player changed costs the club one in-game penalty, served in this game (Rule 5.3) — the opponent already sees the locked lineup, so change only who you must."
         :"Your six starters go to the league office and release to the opponent 60 minutes before puck drop. You can resubmit until the lock.",
      emg?"Submit emergency call-up":"Submit lineup", function(){
      save("Lineup submitted to the league office","submitted");
      /* Persist through the server-enforced lock. set_game_lineup() rejects post-lock edits unless
         p_emergency is set, which only club management can do (Rule 5.3) — the lock is enforced in
         the database, so no client can bypass it. */
      if (CG.LIVE_MODE && CG.sb){
        var tid = (CG.lg._codeToId||{})[club];
        if (tid){
          CG.sb.rpc("set_game_lineup", { p_game:game.id, p_team:tid,
            p_center:state.slots.C||null, p_lw:state.slots.LW||null, p_rw:state.slots.RW||null,
            p_ld:state.slots.LD||null, p_rd:state.slots.RD||null, p_goalie:state.slots.G||null,
            p_emergency:emg }).then(function(r){
            if(r.error || !r.data){ CG.toast(r.error?("Couldn’t submit: "+r.error.message):"Submit was blocked by the server — refresh and retry","err"); return; }
            var row = Array.isArray(r.data) ? r.data[0] : r.data;
            CG.lg._lineups = CG.lg._lineups||{}; CG.lg._lineups[club+":"+game.id] = row;
            if (row.penalties_owed > 0) CG.toast("This club now serves "+row.penalties_owed+" in-game penalt"+(row.penalties_owed===1?"y":"ies")+" in this game (Rule 5.3)","err");
            if (CG._luEmergency) delete CG._luEmergency[game.id];
          });
        }
      }
      CG.pushNotif("check", emg?"Emergency call-up submitted":"Lineup submitted","vs "+CG.TEAM[game.home===club?game.away:game.home].name+(emg?" — post-lock swap recorded.":" — locks "+CG.fmtTime(game.at-30*60000)+"."),"#/hub/lineup");
      CG.audit(emg?"Emergency call-up":"Lineup submitted",""+key);
      CG.toast(emg?"Emergency call-up submitted":"Lineup submitted","ok");
      CG.renderChrome();
    });
  });
  var emBtn = $("#luEmergency");
  if (emBtn) emBtn.addEventListener("click", function(){
    CG.confirm("Start an emergency call-up?","This game locked at "+CG.fmtTime(game.at-30*60000)+". Use this only for a genuine no-show — swap the player, then resubmit. The change is recorded against the club.","Enable call-up", function(){
      CG._luEmergency = CG._luEmergency||{}; CG._luEmergency[game.id]=true; CG.router();
    });
  });
  var emCancel = $("#luEmCancel");
  if (emCancel) emCancel.addEventListener("click", function(){
    if (CG._luEmergency) delete CG._luEmergency[game.id];
    CG.router();
  });
  document.querySelectorAll(".srv-sel").forEach(function(el){
    el.addEventListener("change", function(){ CG.saveVeto(el.getAttribute("data-veto-game"), el); });
  });
};

/* ================================================================
   LINE CREATOR — franchise-mode line combinations + the night plan
   ================================================================
   A PLANNING surface, deliberately split from the per-game builder. Lines are saved combinations
   (four of them, LW/C/RW/LD/RD/G); the night plan points each game night at one. Nothing here
   dresses anyone: "Dress tonight" hands the chosen line to set_game_lineup(), so the weekly caps
   (Rule 5.2), the series cap (Rule 8.3), roster validation and the T-30 lock all still bite on the
   real write with their own errors. A plan is allowed to be ambitious; a dressing is not. */
CG.LINE_SLOTS = ["LW","C","RW","LD","RD","G"];
CG._lineCol = { LW:"lw", C:"center", RW:"rw", LD:"ld", RD:"rd", G:"goalie" };
CG.lineFromRow = function(row){
  var s = {}; if (!row) return s;
  CG.LINE_SLOTS.forEach(function(pos){ var v = row[CG._lineCol[pos]]; if (v) s[pos] = v; });
  return s;
};
/* the reference's circular headshot: the player's real Discord avatar, or initials on ink.
   Size in px; markup only — the circle itself is .lc-av in the stylesheet. */
CG.lcAv = function(p, size){
  var src = p && p.avatar && CG.safeAvatar ? CG.safeAvatar(p.avatar) : null;
  return '<span class="lc-av" style="width:'+size+'px;height:'+size+'px">'+
    (src ? '<img src="'+src+'" alt="" loading="lazy" decoding="async">'
         : '<b>'+esc(String((p && p.tag) || "?").slice(0,2).toUpperCase())+'</b>')+'</span>';
};
/* average OVR of the players actually placed — real and sourced, or nothing at all */
CG.lineOvr = function(slots){
  var vals = Object.keys(slots).map(function(k){ var r = CG.lg.ratings[slots[k]]; return r && r.ovr; })
    .filter(function(v){ return v; });
  if (!vals.length) return null;
  return Math.round(vals.reduce(function(a,b){ return a+b; },0) / vals.length);
};
/* the club's upcoming nights, each with its planned line and next game */
CG.lineNights = function(club){
  var seen = {}, out = [];
  (CG.lg.schedule||[]).filter(function(g){
    return (g.home===club||g.away===club) && g.status!=="final" && g.at>CG.now()-3*3600000;
  }).sort(function(a,b){ return a.at-b.at; }).forEach(function(g){
    var k = CG.gameNight(g);
    if (!seen[k]){ seen[k] = { key:k, game:g }; out.push(seen[k]); }
  });
  return out;
};
CG.hubLines = function(qs){
  var lg = CG.lg;
  /* hqClub(): a real seat, or the commissioner front-office preview — full access either way */
  var club = CG.hqClub();
  if (!club || !lg.byTeam[club]) return '<div class="note">This account doesn’t run a club — the line creator belongs to team management.</div>';
  var roster = lg.byTeam[club];
  var suspended = {};
  lg.suspensions.forEach(function(s){ if (s.team===club && s.status!=="served") suspended[s.playerId]=true; });
  var slotsOf = function(n){ return (CG._lcDraft && CG._lcDraft[n]) ? CG._lcDraft[n] : CG.lineFromRow((lg._teamLines||{})[n]); };
  var dirtyN = 0; [1,2,3].forEach(function(n){ if (CG._lcDraft && CG._lcDraft[n]) dirtyN++; });
  /* which lines each player is on, for the roster board's L1..L4 chips */
  var memb = {};
  [1,2,3].forEach(function(n){ var sl=slotsOf(n); Object.keys(sl).forEach(function(pos){ (memb[sl[pos]]=memb[sl[pos]]||[]).push(n); }); });

  var h = '<div style="margin-bottom:20px"><span class="eyebrow chr">'+esc(CG.TEAM[club].name)+' · team HQ</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Lineup builder</h1>'+
    '<p class="lede" style="margin-top:8px">Three lines — one per game night — and the whole roster. Drag a player onto any slot, or between slots to swap; point each night at a line, then dress the week in one click. Every dressing still runs through the league’s checks.</p></div>';

  var bar = '<div class="note '+(dirtyN?"chr":"grn")+'" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:18px">'+
    '<b style="font-family:var(--f-disp)">'+(dirtyN?dirtyN+" line"+(dirtyN===1?"":"s")+" with unsaved changes":"All lines saved")+'</b>'+
    '<span class="caption" style="flex:1;min-width:200px">Names edit in place. A player may sit on more than one line — the weekly limits are checked when a lineup is actually dressed.</span>'+
    '<span style="display:flex;gap:9px">'+
    '<button class="btn btn-ghost btn-sm" id="lcRevert"'+(dirtyN?"":" disabled")+'>Revert</button>'+
    '<button class="btn btn-chrome btn-sm" id="lcSaveAll"'+(dirtyN?"":" disabled")+'>Save changes</button></span></div>';

  var POS = CG.LINE_SLOTS;                          /* LW C RW LD RD G */
  var cells = '<div class="lc-gh"></div>'+POS.map(function(p){ return '<div class="lc-gh">'+CG.POS_NAME[p]+'</div>'; }).join("");
  [1,2,3].forEach(function(n){
    var sl = slotsOf(n), row = (lg._teamLines||{})[n];
    var nameVal = (CG._lcName && CG._lcName[n] != null) ? CG._lcName[n] : ((row && row.name) || "");
    var ovr = CG.lineOvr(sl);
    var nights = Object.keys(lg._linePlan||{}).filter(function(k){ return (lg._linePlan||{})[k]===n; })
      .map(function(k){ return (CG.NIGHT_LABEL[k]||k).slice(0,3); });
    cells += '<div class="lc-gut">'+
      '<input class="lc-nm" data-lname="'+n+'" maxlength="24" placeholder="Line '+n+'" value="'+esc(nameVal)+'" aria-label="Line '+n+' name">'+
      '<span class="gm">'+(ovr?'<span class="chip" style="font-size:9px">OVR '+ovr+'</span>':"")+
        (nights.length?'<span title="Nights this line dresses">'+nights.join(" · ")+'</span>':"")+
        ((CG._lcDraft && CG._lcDraft[n])?'<span style="color:var(--chrome-deep);font-weight:700" title="Unsaved">●</span>':"")+'</span></div>';
    POS.forEach(function(pos){
      var pid = sl[pos], pl = pid && CG.playerById(lg, pid);
      cells += '<div class="lc-slot'+(pl?" filled":"")+'" data-line="'+n+'" data-slot="'+pos+'" tabindex="0" role="button" '+
        'aria-label="Line '+n+' '+CG.POS_NAME[pos]+(pl?" — "+esc(pl.tag):" — empty")+'" draggable="'+(!!pl)+'">'+
        (pl ? CG.lcAv(pl,26)+'<span class="nm">'+esc(pl.tag)+'</span><span class="mt">OVR '+lg.ratings[pid].ovr+(suspended[pid]?' · SUSP':'')+'</span>'
            : '<span class="mt">'+pos+'</span>')+'</div>';
    });
  });
  var grid = '<div class="card" style="margin-bottom:18px"><div class="card-b lc-wrap"><div class="lc-grid">'+cells+'</div></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption" id="lcMsg">Drag onto a filled slot to swap the two players. Drag a slot back onto the roster to clear it. Click works too — player, then slot.</span></div></div>';

  /* the whole roster in the reference's position columns, every card draggable. Training camp
     gets its own strip below the columns: camp players fill ANY slot (Rule 2.1), so filing them
     under one position would hide exactly the flexibility a short-handed club needs. */
  var byPos = {}; POS.forEach(function(p){ byPos[p]=[]; });
  var camp = [];
  roster.slice().sort(function(a,b){ return (lg.ratings[b.id].ovr)-(lg.ratings[a.id].ovr); })
    .forEach(function(p){ if (p.squad==="tc") camp.push(p); else (byPos[p.pos]||(byPos[p.pos]=[])).push(p); });
  var board = '<div class="card"><div class="card-h"><h3>Roster — '+esc(CG.TEAM[club].name)+'</h3><span class="chip">'+roster.length+' rostered</span></div>'+
    '<div class="card-b"><div class="lc-board">'+POS.map(function(pos){
      return '<div class="lc-col"><div class="lc-ch">'+CG.POS_NAME[pos]+'</div>'+
        (byPos[pos]||[]).map(function(p){
          var dis = suspended[p.id];
          return '<div class="lc-pc'+(dis?" dis":"")+'" data-rcard="'+p.id+'" draggable="'+(!dis)+'" tabindex="0" role="button" '+
            (dis?'title="Suspended (Rule 7.4)"':'')+' aria-label="'+esc(p.tag)+', '+CG.POS_NAME[p.pos]+'">'+
            CG.lcAv(p,34)+
            '<span class="two"><b>'+esc(p.tag)+'</b><span class="ps">'+CG.POS_NAME[p.pos]+'</span></span>'+
            (memb[p.id]||[]).map(function(n){ return '<span class="lnc">L'+n+'</span>'; }).join("")+
            (dis?'<span class="chip chip-loss" style="font-size:9px">SUSP</span>':"")+
            '<span class="ov">'+lg.ratings[p.id].ovr+'</span></div>';
        }).join("")+'</div>';
    }).join("")+'</div>'+
    (camp.length ? '<div class="lc-ch" style="margin-top:14px">Training camp — fills any position (Rule 2.1)</div>'+
      '<div class="lc-board" style="margin-top:8px">'+camp.map(function(p){
        var dis = suspended[p.id];
        return '<div class="lc-pc'+(dis?" dis":"")+'" data-rcard="'+p.id+'" draggable="'+(!dis)+'" tabindex="0" role="button" '+
          (dis?'title="Suspended (Rule 7.4)"':'')+' aria-label="'+esc(p.tag)+', training camp">'+
          CG.lcAv(p,34)+
          '<span class="two"><b>'+esc(p.tag)+'</b><span class="ps">Camp · '+CG.POS_NAME[p.pos]+'</span></span>'+
          (memb[p.id]||[]).map(function(n){ return '<span class="lnc">L'+n+'</span>'; }).join("")+
          (dis?'<span class="chip chip-loss" style="font-size:9px">SUSP</span>':"")+
          '<span class="ov">'+lg.ratings[p.id].ovr+'</span></div>';
      }).join("")+'</div>' : "")+
    '</div></div>';

  /* the night plan: which saved line each game night dresses */
  var nights = CG.lineNights(club);
  var planReady = nights.filter(function(n){
    var pl = (lg._linePlan||{})[n.key];
    return pl && (lg._teamLines||{})[pl] && CG.now() < n.game.at - 30*60000;
  }).length;
  var plan = '<div class="card"><div class="card-h"><h3>Night plan</h3>'+
    (planReady > 1 ? '<button class="btn btn-chrome btn-sm" id="lcDressWeek" title="Dress every game of every planned night in one go">Dress the week ('+planReady+')</button>' : '<span class="chip">'+nights.length+' night'+(nights.length===1?"":"s")+'</span>')+'</div>'+
    (nights.length ? nights.map(function(n){
      var planned = (lg._linePlan||{})[n.key] || null;
      var prow = planned && (lg._teamLines||{})[planned];
      /* a night is EVERY game in it, not just the first — the whole point of the fix */
      var games = CG.nightGames(club, n.key);
      var g = n.game, opp = g.home===club ? g.away : g.home;
      var open = games.filter(function(x){ return CG.now() < x.at - 30*60000; });   // still dressable
      var dressedN = games.filter(function(x){ return (lg._lineups||{})[club+":"+x.id]; }).length;
      var owed = games.reduce(function(a,x){ var d=(lg._lineups||{})[club+":"+x.id]; return a + (d && d.penalties_owed>0 ? d.penalties_owed : 0); }, 0);
      var opts = '<option value="">— none —</option>'+[1,2,3].map(function(s2){
        var r = (lg._teamLines||{})[s2];
        return '<option value="'+s2+'"'+(planned===s2?" selected":"")+(r?"":' disabled')+'>'+
          esc((r && r.name) ? r.name : "Line "+s2)+(r?"":" (empty)")+'</option>';
      }).join("");
      return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span style="flex:0 0 148px"><b style="font-family:var(--f-disp)">'+(CG.NIGHT_LABEL[n.key]||n.key)+'</b>'+
          '<span class="caption" style="display:block">'+CG.fmtDate(g.at)+' · '+games.length+' game'+(games.length===1?"":"s")+' · vs '+esc(CG.TEAM[opp].name)+(games.length>1?" +":"")+'</span></span>'+
        '<label class="fld" style="margin:0;flex:1 1 150px"><span>Dresses</span><select class="lc-night" data-night="'+n.key+'">'+opts+'</select></label>'+
        (dressedN ? '<span class="chip chip-xs" title="Games with a submitted lineup">'+dressedN+' / '+games.length+' dressed</span>' : "")+
        (owed ? '<span class="chip chip-loss" style="font-size:9.5px" title="Post-lock changes cost one in-game penalty each (Rule 5.3)">serves '+owed+' penalt'+(owed===1?"y":"ies")+'</span>' : "")+
        (prow
          ? (open.length
              ? '<button class="btn btn-ghost btn-sm lc-dress" data-night="'+n.key+'" data-slot="'+planned+'" title="Submit this line for every not-yet-locked game of '+esc(CG.fmtDate(g.at))+'">'+
                  (dressedN?"Redress":"Dress")+' '+open.length+' game'+(open.length===1?"":"s")+'</button>'
              : '<span class="lock" title="Every game this night has locked">'+CG.ic("lock",13)+'Locked</span>'+
                '<a class="btn btn-ghost btn-sm" href="#/hub/lineup?game='+games[games.length-1].id+'" title="Swap a player after the lock — one in-game penalty per change (Rule 5.3)">Emergency call-up</a>')
          : '<span class="caption">pick a line to enable dressing</span>')+
      '</div>';
    }).join("") : '<div class="card-b"><span class="caption">No upcoming games — the plan fills in once the schedule does.</span></div>')+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">“Dress” submits the line for every game of the night through the lineup builder’s own checks — anything the rules refuse (weekly limits, suspensions, the lock) is refused too, with the same message. Adjust any single game in the <a href="#/hub/lineup" style="font-weight:700;border-bottom:2px solid var(--chrome)">per-game builder</a>.</span></div></div>';

  return '<div id="lcTab">' + h + bar + grid + '<div class="grid g5x7" style="align-items:start">'+board+plan+'</div></div>';
};
CG.AFTER._lines = function(qs){
  var club = CG.hqClub(); if (!club || !CG.lg.byTeam[club]) return;
  var lg = CG.lg;
  var tid = (lg._codeToId||{})[club];
  var sel = null;
  function msg(t, bad){ var el=$("#lcMsg"); if (el){ el.textContent=t; el.style.color = bad?"var(--red)":"var(--steel)"; } }
  /* Repaint ONLY this tab, in place. Routing the whole page on every drag reset the scroll and made
     each edit feel like a reload — the board swaps its own DOM and rebinds, and the viewport never
     moves. Falls back to the router if the wrapper is somehow gone. */
  function repaint(){
    var host = document.getElementById("lcTab");
    if (host){ host.outerHTML = CG.hubLines({}); CG.AFTER._lines({}); }
    else if (CG.router) CG.router();
  }
  /* how many OTHER lines this goaltender already backstops (draft state, target line excluded) */
  function gLines(pid, exceptLine){
    var c = 0;
    [1,2,3].forEach(function(n){
      if (n===exceptLine) return;
      var d = (CG._lcDraft && CG._lcDraft[n]) ? CG._lcDraft[n] : CG.lineFromRow((lg._teamLines||{})[n]);
      if (d.G===pid) c++;
    });
    return c;
  }
  /* a club carries two goalies and a goalie's six-game week is two nights — two lines is the whole
     goaltending week, so a third is always a mistake (mirrors set_team_line's own check) */
  function goalieCapped(pid, pos, line){
    if (pos!=="G") return null;
    if (gLines(pid, line) >= 2){
      var p = CG.playerById(lg, pid);
      return (p?p.tag:"That goaltender")+" already backstops two lines — a goaltender covers at most two (Rule 5.2).";
    }
    return null;
  }
  function draft(n){
    CG._lcDraft = CG._lcDraft||{};
    if (!CG._lcDraft[n]) CG._lcDraft[n] = CG.lineFromRow((lg._teamLines||{})[n]);
    return CG._lcDraft[n];
  }
  function fits(pid, pos){
    var p = CG.playerById(lg, pid); if (!p) return "no longer rostered";
    /* Rule 2.1 groups, with the builder's training-camp exception: a camp player fills any slot */
    if (p.squad!=="tc"){
      var want = pos==="G" ? "G" : (pos==="LD"||pos==="RD") ? "D" : "F";
      if (CG.posGroup(p.pos)!==want)
        return p.tag+" is a "+(CG.POS_NAME[p.pos]||p.pos)+" — "+CG.POS_NAME[pos]+" needs a "+(want==="G"?"goaltender":want==="D"?"defenseman":"forward")+".";
    }
    return null;
  }
  /* assign from the roster: the occupant falls off THIS line only; the player keeps his other lines */
  function assignFromRoster(pid, line, pos){
    var why = fits(pid, pos) || goalieCapped(pid, pos, line);
    if (why){ msg(why, true); return; }
    var d = draft(line);
    Object.keys(d).forEach(function(k){ if (d[k]===pid) delete d[k]; });   /* no dup within a line */
    d[pos] = pid;
    repaint();
  }
  /* slot -> slot: MOVE into an empty slot, SWAP with an occupant (both directions validated) */
  function moveSlot(a, p1, b, p2){
    if (a===b && p1===p2) return;
    var da = draft(a), db = draft(b);
    var X = da[p1]; if (!X) return;
    var Y = db[p2] || null;
    var whyX = fits(X, p2) || goalieCapped(X, p2, b); if (whyX){ msg(whyX, true); return; }
    if (Y){
      var whyY = fits(Y, p1) || goalieCapped(Y, p1, a);
      if (whyY){ msg("Can’t swap: "+whyY, true); return; }
      /* same object when a===b — delete the source FIRST, then write both ends */
      delete da[p1]; db[p2] = X; draft(a)[p1] = Y;
    } else {
      delete da[p1]; db[p2] = X;
    }
    repaint();
  }
  document.querySelectorAll("[data-rcard]").forEach(function(el){
    var pid = el.getAttribute("data-rcard");
    el.addEventListener("click", function(){
      if (el.classList.contains("dis")) return;
      document.querySelectorAll("[data-rcard]").forEach(function(b){ b.classList.remove("sel"); });
      if (sel && sel.pid===pid){ sel=null; msg("Selection cleared."); return; }
      sel = { pid: pid }; el.classList.add("sel");
      msg("Now click the slot for "+((CG.playerById(lg,pid)||{}).tag||"them")+" — any line, any matching position.");
    });
    el.addEventListener("dragstart", function(ev){
      if (el.classList.contains("dis")){ ev.preventDefault(); return; }
      try { ev.dataTransfer.setData("text/plain", "r:"+pid); } catch(e){}
    });
  });
  document.querySelectorAll(".lc-slot").forEach(function(el){
    var line = parseInt(el.getAttribute("data-line"),10), pos = el.getAttribute("data-slot");
    el.addEventListener("click", function(){
      if (sel){ assignFromRoster(sel.pid, line, pos); sel=null; return; }
      var d = draft(line);
      if (d[pos]){ delete d[pos]; repaint(); }
    });
    el.addEventListener("keydown", function(ev){ if (ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); el.click(); } });
    el.addEventListener("dragstart", function(ev){
      var d = (CG._lcDraft && CG._lcDraft[line]) ? CG._lcDraft[line] : CG.lineFromRow((lg._teamLines||{})[line]);
      if (!d[pos]){ ev.preventDefault(); return; }
      try { ev.dataTransfer.setData("text/plain", "s:"+line+":"+pos); } catch(e){}
    });
    el.addEventListener("dragover", function(ev){ ev.preventDefault(); el.classList.add("target"); });
    el.addEventListener("dragleave", function(){ el.classList.remove("target"); });
    el.addEventListener("drop", function(ev){
      ev.preventDefault(); el.classList.remove("target");
      var t = ""; try { t = ev.dataTransfer.getData("text/plain"); } catch(e){}
      if (!t) return;
      if (t.indexOf("r:")===0) assignFromRoster(t.slice(2), line, pos);
      else if (t.indexOf("s:")===0){ var m = t.slice(2).split(":"); moveSlot(parseInt(m[0],10), m[1], line, pos); }
    });
  });
  /* dropping a slot onto the roster board clears it */
  document.querySelectorAll(".lc-board").forEach(function(bd){
    bd.addEventListener("dragover", function(ev){ ev.preventDefault(); });
    bd.addEventListener("drop", function(ev){
      ev.preventDefault();
      var t = ""; try { t = ev.dataTransfer.getData("text/plain"); } catch(e){}
      if (t.indexOf("s:")===0){ var m = t.slice(2).split(":"); var d = draft(parseInt(m[0],10)); delete d[m[1]]; repaint(); }
    });
  });
  document.querySelectorAll("[data-lname]").forEach(function(el){
    var n = parseInt(el.getAttribute("data-lname"),10);
    el.addEventListener("input", function(){
      CG._lcName = CG._lcName||{}; CG._lcName[n] = el.value;
      draft(n);                                    /* a rename is a change worth saving */
    });
  });
  var revert = $("#lcRevert");
  if (revert) revert.addEventListener("click", function(){ CG._lcDraft = {}; CG._lcName = {}; repaint(); });
  var saveAll = $("#lcSaveAll");
  if (saveAll) saveAll.addEventListener("click", function(){
    if (!CG.LIVE_MODE || !CG.sb || !tid || !CG.SEASON || !CG.SEASON.id){ CG.toast("Not connected — reload and retry","err"); return; }
    var dirty = Object.keys(CG._lcDraft||{}).map(Number);
    if (!dirty.length) return;
    saveAll.disabled = true;
    var okN = 0, errs = [];
    /* sequential, so one refusal names its line instead of four racing toasts */
    (function next(i){
      if (i>=dirty.length){
        saveAll.disabled = false;
        if (errs.length) CG.toast("Saved "+okN+", refused "+errs.length+": "+errs.join("; "),"err");
        else CG.toast(okN+" line"+(okN===1?"":"s")+" saved","ok");
        repaint(); return;
      }
      var n = dirty[i], d = CG._lcDraft[n] || {};
      var name = (CG._lcName && CG._lcName[n] != null) ? CG._lcName[n] : (((lg._teamLines||{})[n]||{}).name || "");
      CG.sb.rpc("set_team_line", { p_season:CG.SEASON.id, p_team:tid, p_slot:n, p_name:name||null,
        p_lw:d.LW||null, p_center:d.C||null, p_rw:d.RW||null, p_ld:d.LD||null, p_rd:d.RD||null, p_goalie:d.G||null
      }).then(function(r){
        /* fail-loud: an RLS-blocked or refused write must never count as saved */
        if (r.error || !r.data){ errs.push("Line "+n+(r.error?" — "+r.error.message:"")); }
        else {
          var row = Array.isArray(r.data) ? r.data[0] : r.data;
          lg._teamLines = lg._teamLines||{}; lg._teamLines[n] = row;
          delete CG._lcDraft[n]; if (CG._lcName) delete CG._lcName[n];
          okN++;
        }
        next(i+1);
      });
    })(0);
  });
  document.querySelectorAll(".lc-night").forEach(function(el){
    el.addEventListener("change", function(){
      if (!CG.LIVE_MODE || !CG.sb || !tid || !CG.SEASON || !CG.SEASON.id){ CG.toast("Not connected — reload and retry","err"); return; }
      var night = el.getAttribute("data-night");
      var slot = el.value ? parseInt(el.value,10) : null;
      CG.sb.rpc("set_team_line_night", { p_season:CG.SEASON.id, p_team:tid, p_night:night, p_slot:slot }).then(function(r){
        if (r.error){ CG.toast("Couldn’t save the plan: "+r.error.message,"err"); repaint(); return; }
        lg._linePlan = lg._linePlan||{};
        if (slot) lg._linePlan[night] = slot; else delete lg._linePlan[night];
        CG.toast(slot ? ((CG.NIGHT_LABEL[night]||night)+" dresses "+((((lg._teamLines||{})[slot]||{}).name)||("Line "+slot)))
                      : ((CG.NIGHT_LABEL[night]||night)+" plan cleared"),"ok");
        repaint();
      });
    });
  });
  /* one night's dressing, shared by the per-night button and Dress-the-week */
  function dressGame(gameId, slot, done){
    var row = (lg._teamLines||{})[slot]; if (!row || !tid){ done("no line"); return; }
    CG.sb.rpc("set_game_lineup", { p_game:gameId, p_team:tid,
      p_center:row.center||null, p_lw:row.lw||null, p_rw:row.rw||null,
      p_ld:row.ld||null, p_rd:row.rd||null, p_goalie:row.goalie||null, p_emergency:false
    }).then(function(r){
      if (r.error || !r.data){ done(r.error ? r.error.message : "blocked by the server"); return; }
      var lrow = Array.isArray(r.data) ? r.data[0] : r.data;
      lg._lineups = lg._lineups||{}; lg._lineups[club+":"+gameId] = lrow;
      done(null);
    });
  }
  /* dress EVERY not-yet-locked game of a night with one line, in sequence. This is the fix: a
     night has up to three games and each must get its own lineup row, or games 2 and 3 go
     undressed. Refusals are collected per game and reported; the rest still land. */
  function dressNight(nightKey, slot, done){
    var games = CG.nightGames(club, nightKey).filter(function(g){ return CG.now() < g.at - 30*60000; });
    if (!games.length){ done("every game this night has locked", 0); return; }
    var okN = 0, errs = [];
    (function next(i){
      if (i >= games.length){ done(errs.length ? errs.join("; ") : null, okN); return; }
      dressGame(games[i].id, slot, function(err){
        if (err) errs.push(CG.fmtTime(games[i].at)+" — "+err); else okN++;
        next(i+1);
      });
    })(0);
  }
  var dressWeek = $("#lcDressWeek");
  if (dressWeek) dressWeek.addEventListener("click", function(){
    if (!CG.LIVE_MODE || !CG.sb || !tid || !CG.SEASON || !CG.SEASON.id){ CG.toast("Not connected — reload and retry","err"); return; }
    var jobs = CG.lineNights(club).filter(function(n){
      var pl = (lg._linePlan||{})[n.key];
      return pl && (lg._teamLines||{})[pl] && CG.nightGames(club, n.key).some(function(g){ return CG.now() < g.at - 30*60000; });
    });
    CG.confirm("Dress the week — "+jobs.length+" night"+(jobs.length===1?"":"s")+"?",
      jobs.map(function(n){ var pl=(lg._linePlan||{})[n.key];
        return (CG.NIGHT_LABEL[n.key]||n.key)+" — "+((((lg._teamLines||{})[pl]||{}).name)||("Line "+pl)); }).join(" · ")+
      ". Each dressing runs through the league’s checks; anything refused is reported by night and the rest still land. Redress any night to adjust before its lock.",
      "Dress the week", function(){
      dressWeek.disabled = true;
      var okN = 0, errs = [];
      (function next(i){
        if (i >= jobs.length){
          dressWeek.disabled = false;
          if (errs.length) CG.toast("Dressed "+okN+" game"+(okN===1?"":"s")+", refused: "+errs.join("; "),"err");
          else CG.toast("Week dressed — "+okN+" game"+(okN===1?"":"s")+". Adjust any single game in the per-game builder before its lock.","ok");
          repaint(); return;
        }
        var n = jobs[i], pl = (lg._linePlan||{})[n.key];
        dressNight(n.key, pl, function(err, dressed){
          if (err) errs.push((CG.NIGHT_LABEL[n.key]||n.key)+" — "+err);
          okN += dressed;
          next(i+1);
        });
      })(0);
    });
  });
  document.querySelectorAll(".lc-dress").forEach(function(el){
    el.addEventListener("click", function(){
      var night = el.getAttribute("data-night"), slot = parseInt(el.getAttribute("data-slot"),10);
      var row = (lg._teamLines||{})[slot]; if (!row || !tid) return;
      var games = CG.nightGames(club, night), open = games.filter(function(g){ return CG.now() < g.at - 30*60000; });
      var g0 = games[0] || {}, opp = g0.home===club ? g0.away : g0.home;
      CG.confirm("Dress "+esc(row.name||("Line "+slot))+" for all "+open.length+" game"+(open.length===1?"":"s")+" "+esc(CG.NIGHT_LABEL[night]||night)+"?",
        "This submits the line as the real lineup for every not-yet-locked game that night vs "+esc((CG.TEAM[opp]||{}).name||opp)+" and others, through the same checks as the builder — weekly limits, suspensions and each game’s 30-minute lock included. Fine-tune any single game in the per-game builder until it locks.",
        "Dress the night", function(){
        el.disabled = true;
        dressNight(night, slot, function(err, okN){
          el.disabled = false;
          if (err){ CG.toast((okN?("Dressed "+okN+"; "):"")+"the rules refused: "+err,"err"); repaint(); return; }
          CG.pushNotif("check","Lineup dressed from the night plan", (row.name||("Line "+slot))+" — "+okN+" game"+(okN===1?"":"s")+" "+(CG.NIGHT_LABEL[night]||night)+". Adjust any single game until its lock.","#/hub/lines");
          CG.toast((row.name||("Line "+slot))+" dressed for "+okN+" game"+(okN===1?"":"s"),"ok");
          repaint();
        });
      });
    });
  });
};

/* ================================================================
   ROSTER — cap sheet + waive / trade / trade-block actions
   ================================================================ */
CG.mgmtTag = function(role){ return role==="owner"?"Owner":role==="gm"?"GM":role==="agm"?"AGM":""; };
/* playoff-eligibility floor (Rule 8.3): a player must appear in at least this
   share of the club's regular-season games — fractions round up. No weekly max. */
/* v2.7: the 30% playoff floor is abolished — every rostered player is playoff-eligible. */
CG.clubSeasonGames = function(club){
  var n = (CG.lg.schedule||[]).filter(function(g){
    return (g.stage||"regular")==="regular" && (g.home===club || g.away===club); }).length;
  /* derive from the season's own shape before falling back to the constant — a second hard-coded
     54 here would drift from GAMES_PER_CLUB the moment either was updated alone */
  return n || (CG.seasonShape ? CG.seasonShape().perClub : CG.GAMES_PER_CLUB);
};

CG.posGroup = function(pos){ return pos==="G" ? "G" : (pos==="D"||pos==="LD"||pos==="RD") ? "D" : "F"; };
/* Rule 2.1 — pro roster 2 G / 4 D / 6 F, training camp 3, and no player may
   change squads more than 3 times a season. The database enforces all three
   (guard_squad_move); this button only keeps the UI honest about it. */
CG.SQUAD_CAPS = { G:2, D:4, F:6, TC:3 };
/* How many pro spots a club is using at a player's position group — a one-way move
   into the pro roster (or into camp) is only possible when there is slack. When the
   roster is full at that shape, the only legal move is a same-position swap, so the
   button offers "Swap" and opens a picker of eligible counterparts. */
function squadMovesLeft(p){ return 3 - (p.squadMoves||0); }
function squadRoom(club, p){
  var roster = (CG.lg.byTeam[club]||[]).filter(function(x){ return x.spotId && !CG.isWaived(x.id); });
  if (p.squad==="tc"){
    var grp = CG.posGroup(p.pos), cap = grp==="G"?2:grp==="D"?6:9;   /* the 17-man shape: 9 F, 6 D, 2 G (Rule 2.1) */
    return roster.filter(function(x){ return x.squad!=="tc" && CG.posGroup(x.pos)===grp; }).length < cap;
  }
  return roster.filter(function(x){ return x.squad==="tc"; }).length < 3;
}
function squadBtn(p){
  if (!p.spotId) return "";
  var left = squadMovesLeft(p);
  if (left <= 0) return '<button class="btn btn-ghost btn-sm" disabled title="Swap limit reached — a player may change squads only 3 times a season (Rule 2.1)">Squad locked</button>';
  var club = CG.myClub();
  var title = left+' of 3 squad changes left this season';
  if (squadRoom(club, p)){
    var to = p.squad==="tc" ? "pro" : "tc";
    return '<button class="btn btn-ghost btn-sm" data-squad="'+p.spotId+'" data-squad-to="'+to+'" title="'+title+'">'+
      (p.squad==="tc" ? "Call up" : "To camp")+'</button>';
  }
  /* roster full at this shape — a straight same-position swap is the only legal move */
  return '<button class="btn btn-ghost btn-sm" data-squad-swap="'+p.spotId+'" title="Roster full — swap for a '+
    (p.squad==="tc"?"pro":"camp")+' player of the same position ('+title+')">Swap…</button>';
}
CG.hubRoster = function(qs){
  var lg = CG.lg, club = CG.myClub(), t = CG.TEAM[club];
  var roster = lg.byTeam[club].slice().sort(function(a,b){
    var order = {LW:0,C:1,RW:2,LD:3,RD:4,G:5};
    return (order[a.pos]-order[b.pos]) || a.depth-b.depth;
  });
  var payroll = CG.teamPayroll(lg, club), space = CG.capSpace(lg, club);
  var blockN = roster.filter(function(p){ return !p.mgmt && CG.isOnBlock(p.id); }).length;
  var h = '<div style="margin-bottom:20px"><span class="eyebrow chr">'+esc(t.name)+' · team management</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Roster & salary cap</h1>'+
    '<p class="lede" style="margin-top:8px">Your full club, with contracts and cap hit. Waive a player, put one on the trade block, or open a trade — all under the $'+(CG.CAP/1000000)+'M cap (Rule 2.5).</p></div>';
  h += '<div class="note red" style="margin-bottom:18px;display:flex;gap:10px;align-items:flex-start">'+CG.ic("lock",16)+
    '<span><b style="font-family:var(--f-disp)">Confidential — management only.</b> Salaries, cap space, and trade-block status are visible to your Owner, GM, and AGM. Don’t share them with players or rival clubs (Rule 2.3).</span></div>';
  h += '<div class="grid g3" style="margin-bottom:20px">'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:22px">'+CG.fmtMoney(payroll)+'</b><span>Active payroll</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:22px;color:'+(space<0?"var(--red)":"var(--green)")+'">'+CG.fmtMoney(space)+'</b><span>Cap space</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:22px">'+CG.fmtMoney(CG.CAP)+'</b><span>Salary cap</span></div></div>';
  var rows = roster.map(function(p){
    var waived = CG.isWaived(p.id), onBlk = CG.isOnBlock(p.id), mrole = CG.mgmtTag(p.mgmt);
    var status = waived ? '<span class="chip chip-loss">Waived</span>'
      : mrole ? '<span class="chip chip-chrome">'+mrole+'</span>'
      : onBlk ? '<span class="chip chip-warn">On block</span>'
      : '<span class="chip chip-win">Active</span>';
    if (p.spotId && p.squad === "tc")
      status += ' <span class="chip chip-warn" title="Training camp — may dress in at most 3 games a week (Rule 2.1)">Camp</span>';
    var actions = p.mgmt
      ? '<span class="caption">Management contract — protected</span>'
      : (waived
        ? '<button class="btn btn-ghost btn-sm" data-reinstate="'+p.id+'">Reinstate</button>'
        : '<div style="display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">'+
          squadBtn(p)+
          '<button class="btn btn-ghost btn-sm" data-block="'+p.id+'">'+(onBlk?"Off block":"To block")+'</button>'+
          '<button class="btn btn-ghost btn-sm" data-trade="'+p.id+'">Trade</button>'+
          '<button class="btn btn-ghost btn-sm" data-waive="'+p.id+'">Waive</button></div>');
    var gp = (lg.pstats[p.id]||{}).gp||0;
    return '<tr'+(waived?' style="opacity:.55"':"")+'>'+
      '<td class="tleft"><span class="playercell">'+CG.crest(p.team,20)+'<span class="nm" data-go="'+CG.playerRoute(p)+'" style="cursor:pointer">'+esc(p.tag)+'</span></span></td>'+
      '<td class="tnum">'+p.pos+'</td>'+
      '<td class="tnum" data-v="'+lg.ratings[p.id].ovr+'"><span class="ovrbox mid" style="min-width:30px;height:20px;font-size:11px">'+lg.ratings[p.id].ovr+'</span></td>'+
      '<td class="tnum" data-v="'+(p.salary||0)+'"><b>'+CG.fmtMoney(p.salary)+'</b></td>'+
      '<td class="tnum">'+p.term+' yr'+(p.term>1?"s":"")+'</td>'+
      '<td class="tnum" data-v="'+gp+'">'+gp+'</td>'+
      '<td>'+status+'</td>'+
      '<td class="tright">'+actions+'</td></tr>';
  }).join("");
  var proSq = roster.filter(function(p){ return p.spotId && p.squad!=="tc" && !CG.isWaived(p.id); });
  var tcSq  = roster.filter(function(p){ return p.spotId && p.squad==="tc" && !CG.isWaived(p.id); });
  if (roster.some(function(p){ return p.spotId; })){
    /* Rule 2.1 (v2.7): the active roster is quota'd by EXACT position — 3C/3LW/3RW/3LD/3RD/2G. */
    var posN = function(p0){ return proSq.filter(function(p){ return p.pos===p0; }).length; };
    function meter(label,nv,cap){
      var over = cap!=null && nv>cap;
      return '<div><b class="num" style="font-size:22px;color:'+(over?"var(--red)":"inherit")+'">'+nv+(cap!=null?' / '+cap:'')+'</b>'+
        '<span class="caption" style="display:block">'+label+'</span></div>';
    }
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Squads</h3>'+
      '<span class="chip">'+proSq.length+' pro · '+tcSq.length+' in camp</span></div><div class="card-b">'+
      '<div style="display:flex;gap:22px;flex-wrap:wrap">'+meter("centers",posN("C"),CG.ROSTER_QUOTA.C)+meter("left wings",posN("LW"),CG.ROSTER_QUOTA.LW)+
      meter("right wings",posN("RW"),CG.ROSTER_QUOTA.RW)+meter("left D",posN("LD"),CG.ROSTER_QUOTA.LD)+meter("right D",posN("RD"),CG.ROSTER_QUOTA.RD)+
      meter("goaltenders",posN("G"),CG.ROSTER_QUOTA.G)+meter("training camp",tcSq.length,3)+'</div>'+
      '<p class="caption" style="margin-top:12px">Rule 2.1 — the active roster is 3 centers, 3 left wings, 3 right wings, 3 left defensemen, 3 right defensemen and 2 goaltenders; training camp holds up to 3 players. '+
      'Camp players may dress in up to 3 games a week at any position; skaters play their own position group, up to 3 games a week (goaltenders up to 6 — Rule 5.2). '+
      'You may move players between squads freely, but each player may change squads only 3 times a season.</p></div></div>';
  }
  /* Road to 5 (Rule 2.8): during the pre-season, this club is custodian of its assigned players'
     draft eligibility — management is OBLIGED to spread ice time so everyone can reach five games.
     The card only exists while that duty is live (random assignees present, draft not complete). */
  if (CG.roadToFive){
    var r5 = CG.roadToFive(lg, club);
    var draftDone5 = !!(lg.draftState && String(lg.draftState.status)==="complete");
    if (r5.length && !draftDone5){
      var short5 = r5.filter(function(r){ return !r.done; });
      var exempt5 = r5.filter(function(r){ return r.exempt; }).length;
      h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Road to 5 — draft eligibility</h3>'+
        (short5.length ? '<span class="chip chip-warn">'+short5.length+' still short</span>'
                       : '<span class="chip chip-win">everyone covered</span>')+'</div><div class="card-b">'+
        (short5.length ? '<div class="stack" style="gap:9px">'+short5.map(function(r){
            var pct = Math.round(Math.min(1, r.gp/5)*100);
            var danger = !r.reachable;
            return '<div style="display:flex;align-items:center;gap:12px">'+
              '<span style="flex:0 0 140px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b style="font-size:13px">'+esc(r.tag)+'</b> <small class="caption">'+esc(r.pos||"")+'</small></span>'+
              '<span style="flex:1;height:8px;border-radius:4px;background:var(--line);overflow:hidden"><i style="display:block;height:100%;width:'+pct+'%;background:'+(danger?"var(--red)":"var(--chrome)")+'"></i></span>'+
              '<span class="num" style="flex:0 0 44px;text-align:right;font-weight:700'+(danger?';color:var(--red)':'')+'">'+r.gp+' / 5</span>'+
              (danger?'<span class="chip chip-loss" style="font-size:9px">can’t reach 5</span>':'<span class="caption">needs '+r.need+'</span>')+
            '</div>';
          }).join("")+'</div>'
          : '<p class="small" style="color:var(--steel)">Every randomly assigned player has five pre-season games or an exemption — the whole group enters the draft.</p>')+
        '<p class="caption" style="margin-top:12px">Rule 2.8: a randomly assigned player needs five pre-season appearances to stay draft-eligible, and management must spread ice time so everyone can get there. '+
        (exempt5?exempt5+' returning player'+(exempt5===1?' is':'s are')+' exempt. ':'')+
        'The club has '+((r5[0]&&r5[0].clubGamesLeft)||0)+' pre-season game'+(((r5[0]&&r5[0].clubGamesLeft)||0)===1?'':'s')+' left.</p></div></div>';
    }
  }
  /* v2.7: the 30% playoff floor is abolished — every rostered player is playoff-eligible. The
     card now states the caps that DO exist rather than a floor that doesn't. */
  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Game limits</h3>'+
    '<span class="chip chip-win">every rostered player is playoff-eligible</span></div><div class="card-b">'+
    '<div style="display:flex;gap:26px;flex-wrap:wrap">'+
      '<div><b class="num" style="font-size:22px">3</b><span class="caption" style="display:block">games a week — skaters</span></div>'+
      '<div><b class="num" style="font-size:22px">6</b><span class="caption" style="display:block">games a week — goaltenders</span></div>'+
      '<div><b class="num" style="font-size:22px">3</b><span class="caption" style="display:block">games a week — training camp</span></div>'+
      '<div><b class="num" style="font-size:22px">3</b><span class="caption" style="display:block">of a playoff series — skaters</span></div></div>'+
    '<p class="caption" style="margin-top:12px">Weekly caps are the limit, not a minimum (Rule 5.2). In the playoffs the same caps apply per series: a skater may be dressed in at most three games of a series and a goaltender in at most six (Rule 8.3).</p></div></div>';
  h += '<div class="card"><div class="card-h"><h3>Roster — '+roster.length+' under contract</h3>'+
    '<span class="chip">'+blockN+' on the block</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption>'+esc(t.name)+' roster, contracts and cap hit</caption><thead><tr>'+
    '<th class="tleft sortable">Player</th><th class="sortable">POS</th><th class="sortable">OVR</th><th class="sortable">Cap hit</th><th class="sortable">Term</th><th class="sortable" title="Regular-season games played">GP</th><th>Status</th><th class="tright">Actions</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Every rostered player is playoff-eligible — there is no games-played floor (Rule 8.3). Owner, GM, and AGM carry management contracts (Rule 2.6) and are protected from waivers and trades. Waiving a player releases him to the free-agent pool immediately and clears his cap hit; any club may then sign him under the free-agency rules (Rule 2.2).</span></div></div>';
  return h;
};
CG.AFTER._roster = function(){
  $$("[data-trade]").forEach(function(b){ b.addEventListener("click", function(){
    location.hash = "#/hub/tradehub?add="+this.getAttribute("data-trade");
  }); });
  $$("[data-block]").forEach(function(b){ b.addEventListener("click", function(){
    var pid = this.getAttribute("data-block"), on = CG.isOnBlock(pid);
    CG.setOnBlock(pid, !on);
    var p = CG.playerById(CG.lg, pid);
    CG.audit(on?"Removed from trade block":"Added to trade block", p.tag);
    CG.toast(on ? p.tag+" removed from the trade block" : p.tag+" listed on the trade block", "ok");
    CG.router();
  }); });
  $$("[data-waive]").forEach(function(b){ b.addEventListener("click", function(){
    var pid = this.getAttribute("data-waive"), p = CG.playerById(CG.lg, pid);
    if (CG.LIVE_MODE){
      CG.confirm("Waive "+p.tag+"?",
        "They come off your roster immediately, their "+CG.fmtMoney(p.salary)+" cap hit clears, and they return to the free-agent pool where any club can sign them (Rule 2.5). The move is logged for the whole league.",
        "Waive player", function(){
        CG.sb.rpc("waive_player",{ p_profile:pid }).then(function(r){
          if (r.error){ CG.toast("Couldn’t waive: "+r.error.message,"err"); return; }
          CG.toast(String(r.data||p.tag)+" waived — back in the free-agent pool","ok");
          CG.reloadLeague();
        });
      });
      return;
    }
    CG.confirm("Waive "+p.tag+"?","This clears his "+CG.fmtMoney(p.salary)+" cap hit and exposes him to a 24-hour waiver window. Any club can claim him at his current salary (Rule 2.5). In this prototype the move is reversible.","Waive player", function(){
      CG.setWaived(pid, true); CG.setOnBlock(pid, false);
      CG.audit("Player waived", p.tag+" ("+CG.fmtMoney(p.salary)+")");
      CG.pushNotif("flag","Player waived",p.tag+" was placed on waivers — 24-hour claim window open.","#/hub/roster");
      CG.toast(p.tag+" placed on waivers","ok"); CG.renderChrome(); CG.router();
    });
  }); });
  $$("[data-reinstate]").forEach(function(b){ b.addEventListener("click", function(){
    var pid = this.getAttribute("data-reinstate"), p = CG.playerById(CG.lg, pid);
    CG.setWaived(pid, false);
    CG.audit("Waiver cleared", p.tag);
    CG.toast(p.tag+" cleared waivers — back on the active roster","ok"); CG.renderChrome(); CG.router();
  }); });
};

/* ================================================================
   TRADE HUB — build trades, incoming offers, league-wide block
   (confidential to team management)
   ================================================================ */
CG._tradeDraft = null;
CG.tradeDraft = function(){ if (!CG._tradeDraft) CG._tradeDraft = { partner:null, send:[], recv:[] }; return CG._tradeDraft; };
CG.tradeAddPlayer = function(pid){
  var p = CG.playerById(CG.lg, pid); if (!p || p.mgmt) return;
  var d = CG.tradeDraft();
  if (p.team===CG.myClub()){ if (d.send.indexOf(pid)<0) d.send.push(pid); }
  else { if (d.partner && d.partner!==p.team) d.recv = []; d.partner = p.team; if (d.recv.indexOf(pid)<0) d.recv.push(pid); }
};
CG.tradeCapAfter = function(club, sendPids, recvPids){
  var out = sendPids.reduce(function(s,pid){ return s+CG.playerSalary(CG.lg,pid); }, 0);
  var inc = recvPids.reduce(function(s,pid){ return s+CG.playerSalary(CG.lg,pid); }, 0);
  return CG.teamPayroll(CG.lg, club) - out + inc;
};
CG.hubTradeHub = function(qs){
  var lg = CG.lg, club = CG.myClub(), t = CG.TEAM[club], d = CG.tradeDraft();
  var incoming = CG.incomingOffers();
  var h = '<div style="margin-bottom:18px"><span class="eyebrow chr">'+esc(t.name)+' · team management</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Trade Hub</h1>'+
    '<p class="lede" style="margin-top:8px">Build and send offers, review what other clubs send you, and see every player on the block across the league — all within the cap (Rule 2.5).</p></div>';
  h += '<div class="note red" style="margin-bottom:18px;display:flex;gap:10px;align-items:flex-start">'+CG.ic("lock",16)+
    '<span><b style="font-family:var(--f-disp)">Confidential to management.</b> Everything on this page — offers, notes, and block listings — is restricted to your Owner, GM, and AGM. Sharing trade talks outside the management group is a Rule 2.3 violation.</span></div>';

  /* ---- incoming offers ---- */
  var inc = '<div class="card"><div class="card-h"><h3>Incoming offers</h3><span class="chip '+(incoming.length?"chip-warn":"chip-win")+'">'+(incoming.length?incoming.length+" awaiting you":"None pending")+'</span></div>';
  if (incoming.length){
    inc += incoming.map(function(o){
      var capAfter = CG.tradeCapAfter(club, o.get, o.give); /* we send o.get, receive o.give */
      var over = capAfter > CG.CAP;
      return '<div class="card-b" style="border-top:1px solid var(--line-soft)">'+
        '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px">'+
        '<span class="teamcell">'+CG.crest(o.from,24)+'<span class="nm">'+esc(CG.TEAM[o.from].name)+'</span></span>'+
        '<span class="nf-t">'+CG.fmtFull(o.at)+'</span></div>'+
        '<div class="grid g2" style="gap:14px">'+
          '<div><span class="caption">You receive</span>'+o.give.map(function(pid){ return '<div style="margin-top:6px">'+CG.tradePlayerLine(pid)+'</div>'; }).join("")+'</div>'+
          '<div><span class="caption">You send</span>'+o.get.map(function(pid){ return '<div style="margin-top:6px">'+CG.tradePlayerLine(pid)+'</div>'; }).join("")+'</div>'+
        '</div>'+
        (o.note?'<p class="small" style="color:var(--steel);margin-top:12px;font-style:italic">“'+esc(o.note)+'”</p>':"")+
        '<div style="display:flex;gap:9px;align-items:center;margin-top:12px;flex-wrap:wrap">'+
          '<span class="chip '+(over?"chip-loss":"chip-win")+'">Cap after: '+CG.fmtMoney(capAfter)+(over?" · OVER":" · OK")+'</span>'+
          '<span style="margin-left:auto;display:flex;gap:8px">'+
          '<button class="btn btn-ghost btn-sm" data-th-counter="'+o.id+'">Counter</button>'+
          '<button class="btn btn-ghost btn-sm" data-th-decline="'+o.id+'">Decline</button>'+
          '<button class="btn btn-chrome btn-sm" data-th-accept="'+o.id+'"'+(over?" disabled title=\"Accepting would put you over the cap\"":"")+'>Accept</button>'+
          '</span></div></div>';
    }).join("");
  } else {
    inc += '<div class="card-b"><p class="small" style="color:var(--steel)">No open offers right now. When another club sends you one, it lands here and you get a notification.</p></div>';
  }
  inc += '</div>';

  /* ---- trade builder ---- */
  var others = Object.keys(CG.TEAM).filter(function(c){ return c!==club; }).sort();
  var sendPay = d.send.reduce(function(s,pid){ return s+CG.playerSalary(lg,pid); },0);
  var recvPay = d.recv.reduce(function(s,pid){ return s+CG.playerSalary(lg,pid); },0);
  var capAfter = CG.tradeCapAfter(club, d.send, d.recv);
  var over = capAfter > CG.CAP;
  function sideList(side, pids){
    if (!pids.length) return '<p class="caption" style="margin-top:8px">No players yet — add from '+(side==="send"?"your roster":"their roster")+'.</p>';
    return pids.map(function(pid){
      return '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">'+CG.tradePlayerLine(pid)+
        '<button class="chip" data-th-rm="'+side+':'+pid+'" title="Remove" style="cursor:pointer;margin-left:auto">✕</button></div>';
    }).join("");
  }
  var builder = '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Build a trade</h3>'+
    (d.send.length||d.recv.length?'<button class="btn btn-ghost btn-sm" id="thClear">Clear</button>':'<span class="chip chip-chrome">Draft</span>')+'</div>'+
    '<div class="card-b">'+
    '<label class="fld" style="max-width:340px"><span>Trade partner</span><select id="thPartner">'+
      '<option value="">Choose a club…</option>'+
      others.map(function(c){ return '<option value="'+c+'"'+(d.partner===c?" selected":"")+'>'+esc(CG.TEAM[c].name)+'</option>'; }).join("")+
    '</select></label>'+
    '<div class="grid g2" style="gap:16px;margin-top:14px;align-items:start">'+
      '<div style="border:1px solid var(--line);border-radius:12px;padding:14px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-family:var(--f-disp)">'+esc(t.name)+' send</b>'+
        '<span class="caption">out '+CG.fmtMoney(sendPay)+'</span></div>'+
        sideList("send", d.send)+
        '<button class="btn btn-ghost btn-sm" id="thAddSend" style="margin-top:12px">'+CG.ic("plus",13)+'Add your player</button></div>'+
      '<div style="border:1px solid var(--line);border-radius:12px;padding:14px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-family:var(--f-disp)">'+(d.partner?esc(CG.TEAM[d.partner].name):"Partner")+' send</b>'+
        '<span class="caption">in '+CG.fmtMoney(recvPay)+'</span></div>'+
        sideList("recv", d.recv)+
        '<button class="btn btn-ghost btn-sm" id="thAddRecv" style="margin-top:12px"'+(d.partner?"":" disabled title=\"Choose a partner club first\"")+'>'+CG.ic("plus",13)+'Add their player</button></div>'+
    '</div>'+
    '<div style="display:flex;gap:10px;align-items:center;margin-top:16px;flex-wrap:wrap">'+
      '<span class="chip '+(over?"chip-loss":"chip-win")+'">Your cap after: '+CG.fmtMoney(capAfter)+' · '+CG.fmtMoney(CG.CAP-capAfter)+(over?" OVER":" free")+'</span>'+
      '<button class="btn btn-chrome" id="thPropose" style="margin-left:auto"'+(over?" disabled":"")+'>Send offer to '+(d.partner?esc(CG.TEAM[d.partner].code):"club")+'</button>'+
    '</div>'+
    '<p class="caption" style="margin-top:10px">Both clubs must clear the $'+(CG.CAP/1000000)+'M cap after the deal. The league office reviews every accepted trade before it’s official (Rule 2.3).</p>'+
    '</div></div>';

  /* ---- outgoing (proposed) ---- */
  var mine = CG.outgoingOffers();
  var outgoing = mine.length ? '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Offers you’ve sent</h3><span class="chip">'+mine.length+'</span></div>'+
    mine.map(function(o){
      var open = o.open!==false;
      return '<div class="card-b" style="border-top:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'+
        '<span class="teamcell">'+CG.crest(o.to,22)+'<span class="nm">to '+esc(CG.TEAM[o.to].name)+'</span></span>'+
        '<span class="chip '+(o.status==="Accepted"?"chip-win":o.status==="Declined"?"chip-loss":"chip-warn")+'">'+esc(o.status||"Sent")+'</span></div>'+
        '<div class="grid g2" style="gap:14px"><div><span class="caption">You send</span>'+o.send.map(function(pid){ return '<div style="margin-top:6px">'+CG.tradePlayerLine(pid)+'</div>'; }).join("")+'</div>'+
        '<div><span class="caption">You receive</span>'+o.recv.map(function(pid){ return '<div style="margin-top:6px">'+CG.tradePlayerLine(pid)+'</div>'; }).join("")+'</div></div>'+
        (open?'<button class="btn btn-ghost btn-sm" data-th-withdraw="'+o.id+'" style="margin-top:12px">Withdraw offer</button>':"")+'</div>';
    }).join("")+'</div>' : "";

  /* ---- trade block ---- */
  var myBlock = lg.byTeam[club].filter(function(p){ return !p.mgmt && CG.isOnBlock(p.id); });
  var leagueBlock = CG.blockedPlayers().filter(function(p){ return p.team!==club; })
    .sort(function(a,b){ return a.team.localeCompare(b.team) || lg.ratings[b.id].ovr-lg.ratings[a.id].ovr; });
  var block = '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Trade block</h3><span class="chip">'+leagueBlock.length+' available league-wide</span></div>'+
    '<div class="card-b">'+
    '<b style="font-family:var(--f-disp);font-size:13px">Your listings ('+esc(t.name)+')</b>'+
    (myBlock.length ? '<div style="margin-top:8px">'+myBlock.map(function(p){
        return '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">'+CG.tradePlayerLine(p.id)+
          '<button class="chip" data-th-block-rm="'+p.id+'" title="Remove from block" style="cursor:pointer;margin-left:auto">Remove</button></div>';
      }).join("")+'</div>'
      : '<p class="caption" style="margin-top:6px">You have nobody listed. Add a player from the <a href="#/hub/roster" style="border-bottom:2px solid var(--chrome);font-weight:600">Roster tab</a>.</p>')+
    '</div>'+
    '<div class="tblwrap" style="border-top:1px solid var(--line)"><table class="tbl keepcols"><caption>Players on the block across the league</caption><thead><tr>'+
    '<th class="tleft">Player</th><th>Club</th><th>POS</th><th>OVR</th><th>Cap hit</th><th class="tright">Action</th></tr></thead><tbody>'+
    (leagueBlock.length ? leagueBlock.map(function(p){
      return '<tr><td class="tleft"><span class="playercell"><span class="nm" data-go="'+CG.playerRoute(p)+'" style="cursor:pointer">'+esc(p.tag)+'</span></span></td>'+
        '<td><span class="teamcell" style="justify-content:center">'+CG.crest(p.team,18)+'<span class="mono" style="font-size:11px">'+CG.TEAM[p.team].code+'</span></span></td>'+
        '<td class="tnum">'+p.pos+'</td><td class="tnum">'+lg.ratings[p.id].ovr+'</td><td class="tnum">'+CG.fmtMoney(p.salary)+'</td>'+
        '<td class="tright"><button class="btn btn-ghost btn-sm" data-th-trade-for="'+p.id+'">Start a trade</button></td></tr>';
    }).join("") : '<tr><td colspan="6" class="tleft"><span class="caption">No clubs are listing players right now.</span></td></tr>')+
    '</tbody></table></div></div>';

  return h + '<div class="stack">'+inc+builder+outgoing+block+'</div>';
};
CG.tradePickerModal = function(side){
  var lg = CG.lg, d = CG.tradeDraft();
  var club = side==="send" ? CG.myClub() : d.partner;
  if (!club){ CG.toast("Choose a partner club first","err"); return; }
  var already = side==="send" ? d.send : d.recv;
  var pool = lg.byTeam[club].filter(function(p){ return !p.mgmt && already.indexOf(p.id)<0; })
    .sort(function(a,b){ return lg.ratings[b.id].ovr-lg.ratings[a.id].ovr; });
  CG.modal("Add a "+esc(CG.TEAM[club].name)+" player",
    '<p class="caption" style="margin-bottom:10px">Management contracts (Owner, GM, AGM) can’t be traded and are hidden.</p>'+
    '<div class="stack" style="gap:6px;max-height:340px;overflow:auto">'+pool.map(function(p){
      return '<button class="gamecard" data-th-pick="'+p.id+'" style="grid-template-columns:auto 1fr auto;text-align:left;cursor:pointer;width:100%">'+
        '<span class="nf-ic">'+CG.crest(p.team,22)+'</span>'+
        '<span style="min-width:0"><b style="font-family:var(--f-disp)">'+esc(p.tag)+'</b><span class="caption" style="display:block">'+p.pos+' · OVR '+lg.ratings[p.id].ovr+(CG.isOnBlock(p.id)?" · on block":"")+'</span></span>'+
        '<span><b>'+CG.fmtMoney(p.salary)+'</b><span class="caption" style="display:block;text-align:right">'+p.term+' yr</span></span></button>';
    }).join("")+'</div>',
    '<button class="btn btn-ghost" data-close>Done</button>');
  $$("[data-th-pick]").forEach(function(b){ b.addEventListener("click", function(){
    CG.tradeAddPlayer(this.getAttribute("data-th-pick")); CG.closeOverlay(); CG.router();
  }); });
};
CG.AFTER._tradehub = function(qs){
  if (qs && qs.add){ CG.tradeAddPlayer(qs.add); location.hash = "#/hub/tradehub"; return; }
  var ps = $("#thPartner");
  if (ps) ps.addEventListener("change", function(){
    var d = CG.tradeDraft(); if (d.partner!==this.value) d.recv = []; d.partner = this.value||null; CG.router();
  });
  var as = $("#thAddSend"); if (as) as.addEventListener("click", function(){ CG.tradePickerModal("send"); });
  var ar = $("#thAddRecv"); if (ar) ar.addEventListener("click", function(){ CG.tradePickerModal("recv"); });
  $$("[data-th-rm]").forEach(function(b){ b.addEventListener("click", function(){
    var parts = this.getAttribute("data-th-rm").split(":"), d = CG.tradeDraft();
    d[parts[0]] = d[parts[0]].filter(function(x){ return x!==parts[1]; }); CG.router();
  }); });
  var clr = $("#thClear"); if (clr) clr.addEventListener("click", function(){ CG._tradeDraft = { partner:null, send:[], recv:[] }; CG.router(); });
  var prop = $("#thPropose"); if (prop) prop.addEventListener("click", function(){
    var d = CG.tradeDraft(), club = CG.myClub();
    if (!d.partner){ CG.toast("Choose a partner club first","err"); return; }
    if (!d.send.length || !d.recv.length){ CG.toast("Add at least one player on each side","err"); return; }
    if (CG.tradeCapAfter(club, d.send, d.recv) > CG.CAP){ CG.toast("This deal puts you over the cap","err"); return; }
    CG.confirm("Send this offer to "+CG.TEAM[d.partner].name+"?",
      "The offer goes to their management group with a notification. They can accept, decline, or counter. Both clubs must clear the cap when it's accepted (Rule 2.5).","Send offer", function(){
      CG.sendTradeOffer(d, club);
    });
  });
  $$("[data-th-accept]").forEach(function(b){ b.addEventListener("click", function(){
    var id = this.getAttribute("data-th-accept"), o = CG.incomingOffers().find(function(x){ return x.id===id; });
    if (!o) return;
    CG.confirm("Accept this offer from "+CG.TEAM[o.from].name+"?",
      "Accepting completes the trade: the players change clubs immediately, both cap sheets update, and the move is logged for the whole league. The deal is rejected automatically if either club would end up over the cap.","Accept offer", function(){
      CG.acceptTradeOffer(id, o);
    });
  }); });
  $$("[data-th-decline]").forEach(function(b){ b.addEventListener("click", function(){
    var id = this.getAttribute("data-th-decline"), o = CG.incomingOffers().find(function(x){ return x.id===id; });
    if (o) CG.declineTradeOffer(id, o);
  }); });
  $$("[data-th-counter]").forEach(function(b){ b.addEventListener("click", function(){
    var id = this.getAttribute("data-th-counter"), o = CG.incomingOffers().find(function(x){ return x.id===id; });
    if (!o) return;
    /* mirror from OUR side: we'd send what they asked for, receive what they offered */
    CG._tradeDraft = { partner:o.from, send:o.get.slice(), recv:o.give.slice() };
    CG.toast("Loaded their offer into the builder — adjust and send back","ok"); CG.router();
  }); });
  $$("[data-th-withdraw]").forEach(function(b){ b.addEventListener("click", function(){
    CG.withdrawTradeOffer(this.getAttribute("data-th-withdraw"));
  }); });
  $$("[data-th-block-rm]").forEach(function(b){ b.addEventListener("click", function(){
    var pid = this.getAttribute("data-th-block-rm"); CG.setOnBlock(pid, false);
    CG.toast(CG.playerById(CG.lg,pid).tag+" removed from the block","ok"); CG.router();
  }); });
  $$("[data-th-trade-for]").forEach(function(b){ b.addEventListener("click", function(){
    CG.tradeAddPlayer(this.getAttribute("data-th-trade-for")); CG.router();
  }); });
};

/* ---------- complaints ---------- */
CG.visibleComplaints = function(){
  var r = CG.role(), me = CG.me();
  var base = CG.CONTENT.ops.complaints.slice();
  var mine = CG.store.get("myComplaints")||[];
  var overrides = CG.store.get("caseDecisions")||{};
  var all = base.concat(mine).map(function(c){
    var o = overrides[c.caseId];
    return o ? Object.assign({}, c, o, { timeline:(c.timeline||[]).concat(o.timeline||[]) }) : c;
  });
  if (r==="commish") return all;
  if (r==="staff") return all.filter(function(c){ return c.assignedTo==="RefCam_Official"; });
  if (!me) return [];
  return all.filter(function(c){
    var own = c.filedBy===me.tag || c._mine;
    if (c.confidential && !own) return false;   /* filers always see their own case */
    return own || (r==="mgmt" && (c.against||"").indexOf("Circuit")>=0);
  });
};
CG.recordCaseAction = function(caseId, patch, timelineEntry){
  var o = CG.store.get("caseDecisions")||{};
  var cur = o[caseId]||{ timeline:[] };
  o[caseId] = Object.assign({}, cur, patch, {
    timeline: (cur.timeline||[]).concat(timelineEntry?[timelineEntry]:[])
  });
  CG.store.set("caseDecisions", o);
};
CG.hubComplaints = function(){
  var r = CG.role();
  if (!CG.can("complaints.file") && !CG.can("complaints.review")) return CG.unauthorized();
  var list = CG.visibleComplaints();
  var h = '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:22px"><div>'+
    '<span class="eyebrow chr">'+(r==="staff"?"Assigned to you":r==="commish"?"All cases":"Your cases")+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">'+(CG.can("complaints.review")?"Complaint review":"Complaints & disputes")+'</h1></div>'+
    (CG.can("complaints.file")?'<button class="btn btn-chrome" id="newCase">'+CG.ic("plus",15)+'File a complaint</button>':"")+'</div>';
  var body = list.length ? '<div class="stack" style="gap:10px">'+list.map(function(c){
    var color = c.status==="Resolved"?"chip-win":c.status==="Under review"?"chip-warn":"chip";
    return '<div class="gamecard" data-go="#/hub/complaint?id='+esc(c.caseId)+'" style="grid-template-columns:auto 1fr auto">'+
      '<span class="nf-ic" style="color:'+(c.confidential?"var(--red)":"var(--steel)")+'">'+CG.ic(c.confidential?"lock":"flag",16)+'</span>'+
      '<div style="min-width:0"><b style="font-family:var(--f-disp)">'+esc(c.caseId)+' — '+esc(c.category)+'</b>'+
      '<p class="small" style="color:var(--steel);margin-top:2px">'+esc(c.confidential&&r!=="commish"&&r!=="staff"?"Details restricted":c.summary)+'</p>'+
      '<span class="caption">Filed by '+esc(c.filedBy)+(c.against&&c.against!=="—"?" · against "+esc(c.against):"")+'</span></div>'+
      '<span class="chip '+color+'">'+esc(c.status)+'</span></div>';
  }).join("")+'</div>'
  : '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("flag",22)+'</div><b>No cases on file</b><p>Complaints you submit appear here with live status. Everything stays confidential to you, assigned staff, and the commissioner.</p></div></div>';
  return h + body +
    '<div class="note" style="margin-top:18px">Complaints follow Rule 7: submission → staff assignment → review → written decision, with appeals within 48 hours (Rule 7.6). Access to every case is logged.</div>';
};
CG.hubComplaintDetail = function(caseId){
  var c = CG.visibleComplaints().find(function(x){ return x.caseId===caseId; });
  if (!c) return '<div class="empty" style="padding:60px 0"><div class="e-art">'+CG.ic("lock",20)+'</div><b>No access to this case</b><p>Either it doesn’t exist or your role can’t view it. Case access attempts are logged.</p></div>';
  var r = CG.role();
  var canReview = CG.can("complaints.review");
  var tl = (c.timeline||[]).filter(function(t){ return canReview || !t.internal; });
  return '<a href="#/hub/complaints" class="sec-link">'+CG.ic("back",14)+'All cases</a>'+
    '<div style="margin:18px 0 22px"><span class="eyebrow chr">'+esc(c.caseId)+(c.confidential?" · confidential":"")+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">'+esc(c.category)+'</h1>'+
    '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><span class="chip '+(c.status==="Resolved"?"chip-win":"chip-warn")+'">'+esc(c.status)+'</span>'+
    (c.assignedTo?'<span class="chip">Reviewer: '+esc(c.assignedTo)+'</span>':"")+'</div></div>'+
    '<div class="grid g23" style="align-items:start"><div class="stack">'+
    '<div class="card"><div class="card-h"><h3>Summary</h3></div><div class="card-b"><p class="small" style="line-height:1.7">'+esc(c.detail||c.summary)+'</p>'+
    '<div style="display:flex;gap:14px;margin-top:14px;flex-wrap:wrap" class="caption"><span><b>Filed by:</b> '+esc(c.filedBy)+'</span>'+(c.against&&c.against!=="—"?'<span><b>Against:</b> '+esc(c.against)+'</span>':"")+'</div></div></div>'+
    (c.decision?'<div class="card"><div class="card-h"><h3>Decision</h3><span class="chip chip-win">Published</span></div><div class="card-b"><p class="small" style="line-height:1.7">'+esc(c.decision)+'</p>'+
      '<p class="caption" style="margin-top:10px">Appeals within 48 hours of a ruling (Rule 7.6).</p></div></div>':"")+
    (canReview && c.status!=="Resolved"?'<div class="card"><div class="card-h"><h3>Reviewer actions</h3><span class="chip chip-chrome">Staff only</span></div><div class="card-b" style="display:flex;gap:9px;flex-wrap:wrap">'+
      '<button class="btn btn-ghost btn-sm" data-case-act="info">Request more information</button>'+
      '<button class="btn btn-ghost btn-sm" data-case-act="note">Add internal note</button>'+
      '<button class="btn btn-ink btn-sm" data-case-act="resolve">Record decision</button></div></div>':"")+
    '</div>'+
    '<div class="card"><div class="card-h"><h3>Case timeline</h3></div>'+
    (tl.length?tl.map(function(t){
      return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic(t.internal?"lock":"clock",14)+'</span>'+
        '<span style="min-width:0"><b>'+esc(t.who)+(t.internal?' <span class="chip chip-warn" style="font-size:9px">internal</span>':"")+'</b><p>'+esc(t.entry)+'</p></span>'+
        '<span class="nf-t">'+CG.fmtDate(t.dateIso)+'</span></div>';
    }).join(""):'<div class="empty"><b>No entries yet</b><p>Actions on this case will appear here.</p></div>')+
    '</div></div>';
};
CG.AFTER._complaints = function(qs){
  var nc = $("#newCase");
  if (nc) nc.addEventListener("click", CG.newComplaintFlow);
  $$("[data-case-act]").forEach(function(b){
    b.addEventListener("click", function(){
      var act = this.getAttribute("data-case-act");
      var id = (qs||{}).id;
      var today = new Date(CG.now()).toISOString().slice(0,10);
      var who = CG.persona().tag;
      if (act==="note"){
        CG.modal("Internal note — "+id,'<label class="fld"><span>Note (visible to staff & commissioner only)</span><textarea rows="3" id="cnTxt" placeholder="e.g. Reviewed both POV clips; contact was shoulder-first…"></textarea></label>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="cnSave">Save note</button>');
        $("#cnSave").addEventListener("click", function(){
          var txt = $("#cnTxt").value.trim();
          if (txt.length<5){ CG.toast("Write the note first","err"); return; }
          CG.recordCaseAction(id, {}, { dateIso:today, who:who, entry:txt, internal:true });
          CG.audit("Complaint note added", id);
          CG.closeOverlay(); CG.toast("Internal note saved to "+id,"ok"); CG.router();
        });
      }
      if (act==="info"){
        CG.confirm("Request more information?","The filer gets a notification asking for additional evidence, and the case status moves to “More information requested”.","Send request", function(){
          CG.recordCaseAction(id, { status:"More information requested" },
            { dateIso:today, who:who, entry:"Requested additional evidence from the filer." });
          CG.audit("Requested more info", id); CG.toast("Request sent to the filer","ok"); CG.router();
        });
      }
      if (act==="resolve"){
        CG.modal("Record decision — "+id,
          '<label class="fld"><span>Public decision summary</span><textarea rows="4" id="cdTxt" placeholder="What was decided and why — this is the only part the filer and accused see."></textarea></label>'+
          '<label class="check"><input type="checkbox" id="cdConfirm"><span>I confirm this ruling follows Rule 7 and is ready to publish.</span></label>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="cdSave">Publish decision</button>');
        $("#cdSave").addEventListener("click", function(){
          if (!$("#cdConfirm").checked){ CG.toast("Confirm the ruling checkbox first","err"); return; }
          var txt = $("#cdTxt").value.trim() || "Resolved by league staff under Rule 7.";
          CG.recordCaseAction(id, { status:"Resolved", decision:txt },
            { dateIso:today, who:who, entry:"Decision published; case closed." });
          CG.audit("Complaint resolved", id);
          CG.closeOverlay(); CG.toast(id+" resolved — parties notified","ok"); CG.router();
        });
      }
    });
  });
};
CG.newComplaintFlow = function(){
  var cats = ["Player conduct","Team management conduct","Rule violation","Illegal lineup","Gameplay violation","Disconnect dispute","Harassment","Unsportsmanlike conduct","Statistical error","Scheduling issue","Other"];
  CG.modal("File a complaint — step 1 of 3",
    '<label class="fld"><span>Category</span><select id="cfCat">'+cats.map(function(c){ return "<option>"+c+"</option>"; }).join("")+'</select></label>'+
    '<label class="fld"><span>Who or what is this about?</span><input id="cfWho" placeholder="Start typing a player or club name…">'+
    '<span class="hint" id="cfWhoHint">Pick from the list as you type to mark the exact player or club — or leave blank for a general issue.</span></label>'+
    '<label class="fld"><span>Related game (optional)</span><select id="cfGame"><option value="">None</option>'+
      CG.lg.results.slice(-8).map(function(r){ return '<option value="'+r.id+'">Wk '+r.week+' — '+CG.TEAM[r.home].code+' '+r.score[r.home]+'–'+r.score[r.away]+' '+CG.TEAM[r.away].code+'</option>'; }).join("")+'</select></label>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="cfNext1">Continue</button>');
  var exact = null;
  CG.attachAC($("#cfWho"), { kinds:["players","teams"],
    onPick: function(it){ exact = it;
      $("#cfWhoHint").innerHTML = '<b style="color:var(--green)">✓ Exact match:</b> '+esc(it.label)+' — '+esc(it.sub); },
    onClear: function(){ exact = null;
      $("#cfWhoHint").textContent = "Pick from the list as you type to mark the exact player or club — or leave blank for a general issue."; }
  });
  $("#cfNext1").addEventListener("click", function(){
    var cat = $("#cfCat").value, game = $("#cfGame").value;
    var who = exact ? exact.label : ($("#cfWho").value.trim()||"—");
    CG.modal("File a complaint — step 2 of 3",
      '<label class="fld"><span>What happened?</span><textarea id="cfDetail" rows="5" placeholder="Be specific: when it happened, what rule you believe was broken, and what you’re asking the league to do."></textarea><span class="hint">Complaints stay confidential to you, assigned staff, and the commissioner (Rule 7).</span></label>'+
      '<label class="fld"><span>Evidence (video link or file)</span><input id="cfLink" placeholder="https:// clip link (optional)"><input type="file" id="cfFile" style="margin-top:8px" accept="image/*,video/*"><span class="hint">The prototype records the file name; the real build uploads to secure storage.</span></label>',
      '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="cfNext2">Review</button>');
    $("#cfNext2").addEventListener("click", function(){
      var detail = $("#cfDetail").value.trim();
      if (detail.length < 20){ CG.toast("Add a real description first (a sentence or two)","err"); return; }
      var link = $("#cfLink").value, fileName = ($("#cfFile").files[0]||{}).name||"";
      CG.modal("File a complaint — step 3 of 3",
        '<div class="note" style="margin-bottom:14px"><b style="font-family:var(--f-disp)">'+esc(cat)+'</b>'+(who!=="—"?' · against '+esc(who):"")+
        (exact?'<div style="margin-top:7px"><span class="chip chip-win">Exact '+(exact.kind==="team"?"club":"player")+' matched — '+esc(exact.sub)+'</span></div>':"")+
        '<p class="small" style="margin-top:8px">'+esc(detail)+'</p>'+
        (link||fileName?'<p class="caption" style="margin-top:8px">Evidence: '+esc(link||fileName)+'</p>':"")+'</div>'+
        '<label class="check"><input type="checkbox" id="cfConf"><span>Request confidentiality — only assigned staff and the commissioner see my name and the details.</span></label>'+
        '<label class="check"><input type="checkbox" id="cfTruth"><span>I confirm this report is truthful and filed in good faith. False reports are a Rule 1 conduct violation.</span></label>',
        '<button class="btn btn-ghost" data-close>Back out</button><button class="btn btn-chrome" id="cfSubmit">Submit complaint</button>');
      $("#cfSubmit").addEventListener("click", function(){
        if (!$("#cfTruth").checked){ CG.toast("You must confirm the good-faith statement","err"); return; }
        var mine = CG.store.get("myComplaints")||[];
        var num = 154 + mine.length;
        var c = { caseId:"CG-0"+num, category:cat, filedBy:(CG.me()||{tag:"member"}).tag, against:who,
          _exact: exact ? { kind:exact.kind, id:exact.id } : null,
          summary:detail.slice(0,120)+(detail.length>120?"…":""), detail:detail, status:"Submitted",
          confidential:$("#cfConf").checked, _mine:true,
          timeline:[{dateIso:new Date(CG.now()).toISOString().slice(0,10), who:(CG.me()||{}).tag||"you", entry:"Complaint submitted"+(link||fileName?" with evidence attached":"")+"."}] };
        mine.push(c); CG.store.set("myComplaints", mine);
        CG.pushNotif("flag","Complaint received","Case "+c.caseId+" is in the queue — you’ll be notified at every status change.","#/hub/complaints");
        CG.audit("Complaint filed", c.caseId);
        CG.closeOverlay(); CG.toast("Case "+c.caseId+" submitted","ok");
        CG.renderChrome(); CG.router();
      });
    });
  });
};

/* ---------- staff stats entry ---------- */
CG.hubStatsEntry = function(){
  var lg = CG.lg;
  var missing = lg.schedule.filter(function(g){ return g.at < CG.now() && !(lg.allResults||lg.results).some(function(r){ return r.id===g.id; }); });
  return '<div style="margin-bottom:20px"><span class="eyebrow chr">Statistician grant</span><h1 class="h-sec" style="margin-top:8px">Stats entry desk</h1>'+
    '<p class="lede" style="margin-top:8px">Finals get entered here (or in the Control Center) and flow instantly into standings, player stats, and ratings.</p></div>'+
    (missing.length
      ? '<div class="stack" style="gap:10px">'+missing.map(CG.gameCard).join("")+'</div>'
      : '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("check",22)+'</div><b>Every played game has a verified final</b>'+
        '<p>48 of 48 through Week 6. Tonight’s four games will appear here after puck drop — or enter them live from the Control Center as commissioner.</p></div></div>')+
    '<div class="note" style="margin-top:16px">Staff permissions are modular — this seat has <b>stats entry</b> and <b>complaints review</b> only. It can’t publish news, touch the rulebook, or see the audit log.</div>';
};

/* ---------- notifications page ---------- */
CG.hubNotifications = function(){
  var read = CG.store.get("read");
  var list = CG.baseNotifs();
  return '<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px;margin-bottom:20px"><div>'+
    '<span class="eyebrow chr">'+list.filter(function(n){ return !read[n.id]; }).length+' unread</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Notifications</h1></div>'+
    '<button class="btn btn-ghost btn-sm" id="markAllPage">Mark all as read</button></div>'+
    '<div class="card">'+ (list.length ? list.map(function(n){
      return '<div class="notif'+(read[n.id]?"":" unread")+'" data-notif="'+n.id+'" data-route="'+esc(n.route||"")+'">'+
        '<span class="nf-ic">'+CG.ic(n.icon||"bell",16)+'</span>'+
        '<span style="min-width:0"><b>'+esc(n.title)+'</b><p>'+esc(n.body)+'</p></span>'+
        '<span class="nf-t">'+CG.fmtFull(n.t)+'</span></div>';
    }).join("") : '<div class="empty"><div class="e-art">'+CG.ic("bell",22)+'</div><b>All quiet</b><p>Codes, lineups, rulings, and deadlines will land here.</p></div>')+'</div>'+
    '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Delivery preferences</h3></div><div class="card-b">'+
    [["Game codes released","codes",true],["Lineup & availability reminders","lineup",true],["League news & rankings","news",true],["Discipline updates involving me","disc",true]].map(function(p){
      var prefs = CG.store.get("prefs");
      var on = prefs["nf_"+p[1]]!==undefined ? prefs["nf_"+p[1]] : p[2];
      return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line-soft)">'+
        '<span style="flex:1;font-size:14px">'+p[0]+'</span><button class="toggle'+(on?" on":"")+'" data-pref="nf_'+p[1]+'" role="switch" aria-checked="'+on+'" aria-label="'+p[0]+'"></button></div>';
    }).join("")+
    '<p class="caption" style="margin-top:12px">Notifications are delivered in-app and by Discord DM — preferences here are wired to the demo store.</p></div></div>';
};

/* ---------- settings ---------- */
CG.hubSettings = function(){
  var me = CG.me(); var p = CG.persona(); var prefs = CG.store.get("prefs");
  var tp = CG.themePref();
  return '<div style="margin-bottom:20px"><span class="eyebrow chr">Account</span><h1 class="h-sec" style="margin-top:8px">Settings</h1></div>'+
    '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Appearance</h3><span class="chip">'+(tp==="auto"?"Following your system":"Set manually")+'</span></div>'+
    '<div class="card-b"><div class="radio-cards" role="radiogroup" aria-label="Theme">'+
    [["light","Light","Fresh Sheet — the ice-white editorial look"],["dark","Dark","Night Game — broadcast charcoal"],["auto","Auto","Follows your device setting"]].map(function(o){
      return '<label class="'+(tp===o[0]?"on":"")+'" data-theme-pick="'+o[0]+'" style="flex-direction:column;align-items:flex-start;gap:3px">'+
        '<input type="radio" name="themePref"'+(tp===o[0]?" checked":"")+'><b>'+o[1]+'</b><span class="caption" style="text-transform:none;letter-spacing:0">'+o[2]+'</span></label>';
    }).join("")+'</div>'+
    '<p class="caption" style="margin-top:12px">Applies instantly and is saved to your account. Auto re-checks whenever your device switches modes.</p></div></div>'+
    '<div class="grid g2" style="align-items:start"><div class="card"><div class="card-h"><h3>League profile</h3></div><div class="card-b">'+
    '<label class="fld"><span>Display name / gamertag</span><input id="sTag" value="'+esc(prefs.tag||((me||{}).tag||p.label))+'" readonly style="background:var(--ice);color:var(--steel)">'+
    '<span class="hint">Synced automatically from your Discord display name every 5 minutes — change it there and it flows here.</span></label>'+
    '<label class="fld"><span>EA ID</span><input id="sEa" value="'+esc(prefs.ea||((me||{}).eaId||""))+'"><span class="hint">Shown to league staff for lobby verification; hidden from the public directory unless you opt in.</span></label>'+
    '<div class="grid g2"><label class="fld"><span>Platform</span><select id="sPlat">'+["PS5","XSX","PC"].map(function(x){ return '<option'+((prefs.plat||((me||{}).platform))===x?" selected":"")+'>'+x+'</option>'; }).join("")+'</select></label>'+
    '<label class="fld"><span>Time zone</span><select id="sTz">'+["Eastern","Central","Mountain","Pacific"].map(function(x){ return '<option'+((prefs.tz||"Eastern")===x?" selected":"")+'>'+x+'</option>'; }).join("")+'</select></label></div>'+
    '<div class="grid g2"><label class="fld"><span>Primary position</span><select id="sPos1">'+["LW","C","RW","LD","RD","G"].map(function(x){ return '<option'+(((me||{}).pos)===x?" selected":"")+'>'+x+'</option>'; }).join("")+'</select></label>'+
    '<label class="fld"><span>Secondary position</span><select id="sPos2"><option>—</option>'+["LW","C","RW","LD","RD"].map(function(x){ return "<option>"+x+"</option>"; }).join("")+'</select></label></div>'+
    '<button class="btn btn-ink" id="sSave">Save profile</button></div></div>'+
    '<div class="stack"><div class="card"><div class="card-h"><h3>Privacy</h3></div><div class="card-b">'+
    [["Show my EA ID on my public profile","pv_ea",false],["Show my game log to signed-out visitors","pv_log",true],["Let opposing GMs see my preferred position","pv_pos",true]].map(function(pv){
      var on = prefs[pv[1]]!==undefined ? prefs[pv[1]] : pv[2];
      return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line-soft)"><span style="flex:1;font-size:14px">'+pv[0]+'</span>'+
        '<button class="toggle'+(on?" on":"")+'" data-pref="'+pv[1]+'" role="switch" aria-checked="'+on+'" aria-label="'+pv[0]+'"></button></div>';
    }).join("")+
    '<p class="caption" style="margin-top:10px">The league never uses or displays your email. Availability answers are visible only to your club’s management and league staff.</p></div></div>'+
    '<div class="card"><div class="card-h"><h3>Demo seat</h3></div><div class="card-b"><p class="small" style="color:var(--steel)">Signed in as <b>'+esc(p.who)+'</b>. Switch seats from the yellow strip up top, or:</p>'+
    '<a class="btn btn-ghost btn-sm" style="margin-top:12px" href="#/signin">'+CG.ic("out",14)+'Sign out</a></div></div></div></div>';
};
CG.AFTER.hub = function(param, qs){
  if (param==="availability") CG.AFTER._availability();
  if (param==="roster") CG.AFTER._roster();
  if (param==="tradehub") CG.AFTER._tradehub(qs);
  if (param==="lineup") CG.AFTER._lineup();
  if (param==="lines") CG.AFTER._lines(qs);
  if (param==="schedule" && CG.AFTER._hubSchedule) CG.AFTER._hubSchedule();
  if (param==="complaints"||param==="complaint") CG.AFTER._complaints(qs);
  if (param==="staffdesk" && CG.AFTER._staffdesk) CG.AFTER._staffdesk();
  var ma = $("#markAllPage");
  if (ma) ma.addEventListener("click", function(){
    var r = CG.store.get("read");
    CG.baseNotifs().forEach(function(n){ r[n.id]=true; });
    CG.store.set("read", r); CG.renderChrome(); CG.router();
  });
  var ss = $("#sSave");
  if (ss) ss.addEventListener("click", function(){
    var prefs = CG.store.get("prefs");
    prefs.ea=$("#sEa").value; prefs.plat=$("#sPlat").value; prefs.tz=$("#sTz").value;
    CG.store.set("prefs", prefs);
    CG.toast("Profile saved","ok");
  });
  /* wire the radio's change event, not the label's click, so arrow-key
     navigation (which fires change, not click) also switches the theme */
  function pickTheme(l){
    var v = l.getAttribute("data-theme-pick");
    CG.applyTheme(v);
    $$("[data-theme-pick]").forEach(function(x){ x.classList.toggle("on", x===l); });
    CG.toast(v==="auto" ? "Theme follows your system now" : (v[0].toUpperCase()+v.slice(1))+" mode on","ok");
  }
  $$("[data-theme-pick]").forEach(function(l){
    var radio = l.querySelector('input[type="radio"]');
    if (radio) radio.addEventListener("change", function(){ if (radio.checked) pickTheme(l); });
    else l.addEventListener("click", function(){ pickTheme(l); });
  });
};
/* pref toggles anywhere */
document.addEventListener("click", function(e){
  var t = e.target.closest("[data-pref]");
  if (!t) return;
  var prefs = CG.store.get("prefs");
  var k = t.getAttribute("data-pref");
  var on = !t.classList.contains("on");
  prefs[k]=on; CG.store.set("prefs", prefs);
  t.classList.toggle("on", on); t.setAttribute("aria-checked", on);
});
