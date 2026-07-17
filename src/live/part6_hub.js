/* ================================================================
   ROLE HUBS — member dashboard, availability, lineup builder,
   complaints, notifications, settings
   ================================================================ */

CG.WEEK8 = {
  key:"w8", label:"Week 8",
  deadline: Date.parse("2026-07-19T20:00:00-04:00"),
  nights: [ { key:"n1", at: Date.parse("2026-07-22T21:00:00-04:00") },
            { key:"n2", at: Date.parse("2026-07-25T21:00:00-04:00") } ]
};
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
  if (CG.can("complaints.file")||CG.can("complaints.review")) mine.push(["complaints", r==="staff"?"Case queue":"Complaints","flag"]);
  /* Messages lives in the account menu (avatar), not the hub sidebar */
  if (r==="staff" && !CG.LIVE_MODE) mine.push(["statsentry","Stats entry","chart"]);
  mine.push(["notifications","Notifications","bell"]);
  mine.push(["settings","Settings","gear"]);
  var staffTools = [];
  if ((r==="staff" || r==="commish") && CG.hubStaffDesk) staffTools.push(["staffdesk","Staff desk","flag"]);
  var club = [];
  var clubTools = r!=="commish" || CG.managesClub();
  if (clubTools){
    if (CG.can("roster.manage")) club.push(["roster","Roster","users"]);
    if (CG.LIVE_MODE && CG.can("lineup.build")) club.push(["schedule","Schedule","cal"]);
    if (CG.can("lineup.build")) club.push(["lineup","Lineup builder","grid"]);
    if (CG.can("trades.manage")) club.push(["tradehub","Trade Hub","swap"]);
    if (CG.LIVE_MODE && CG.can("roster.manage")) club.push(["freeagents","Free agents","search"]);
  }
  function render(items){
    return items.map(function(it){
      var badge = "";
      if (it[0]==="availability" && !CG.availGet((CG.me()||{}).id)) badge = '<span class="hs-n">due</span>';
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
  if (section==="schedule") return (CG.can("lineup.build") && CG.LIVE_MODE && CG.hubScheduleLive) ? CG.hubShell("schedule", CG.hubScheduleLive(qs)) : CG.unauthorized("The club schedule desk is a team-management tool.");
  if (section==="staffdesk") return (r==="staff"||r==="commish") && CG.hubStaffDesk
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

/* ---------- dashboard ---------- */
CG.hubDashboard = function(){
  var r = CG.role(), me = CG.me(), lg = CG.lg;
  var h = '<div style="margin-bottom:24px"><span class="eyebrow chr">'+CG.fmtFull(CG.now())+'</span>'+
    '<h1 class="h-page" style="margin-top:8px">'+(r==="staff"?"Staff desk":"Evening, "+esc((me||{tag:"coach"}).tag)+".")+'</h1></div>';
  var cards = [];
  if (me){
    var t = CG.TEAM[me.team], s = lg.pstats[me.id];
    var av = CG.availGet(me.id);
    var tonight = lg.tonight.find(function(g){ return g.home===me.team||g.away===me.team; });
    var inLineup = tonight && Object.values(CG.plannedLineup(tonight, me.team)).indexOf(me.id)>=0;
    cards.push('<div class="card" style="--tc:'+t.color+'"><div class="card-h"><h3>My club</h3><a class="sec-link" href="#/team/'+me.team+'">Team page</a></div>'+
      '<div class="card-b" style="display:flex;gap:14px;align-items:center">'+CG.crest(me.team,44)+
      '<div><b style="font-family:var(--f-disp);font-size:17px">'+esc(t.name)+'</b>'+
      '<span class="caption" style="display:block">'+lg.teams[me.team].w+"-"+lg.teams[me.team].l+"-"+lg.teams[me.team].otl+' · '+t.div+' Division'+(r==="mgmt"?" · You are the GM":"")+'</span></div>'+
      '<span class="ovrbox" style="margin-left:auto" title="My overall">'+lg.ratings[me.id].ovr+'</span></div></div>');
    cards.push('<div class="card'+(av?"":" ")+'" '+(av?"":'style="border-color:var(--chrome-deep);background:var(--chrome-tint)"')+'>'+
      '<div class="card-h"><h3>'+esc(CG.WEEK8.label)+' availability</h3><span class="chip '+(av?"chip-win":"chip-warn")+'">'+(av?"Submitted":"Due Sunday 8 PM ET")+'</span></div>'+
      '<div class="card-b">'+(av
        ? '<p class="small" style="color:var(--steel)">Logged '+CG.fmtFull(av.at)+'. You can edit until the deadline.</p>'
        : '<p class="small" style="color:var(--steel)">Two game nights next week. Your GM builds lineups from this — 30 seconds now saves a scramble later.</p>')+
      '<a class="btn '+(av?"btn-ghost":"btn-chrome")+' btn-sm" style="margin-top:12px" href="#/hub/availability">'+(av?"Review / edit":"Submit availability")+'</a></div></div>');
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
    var noReply = (lg.byTeam[me.team]||[]).filter(function(p){ return CG.avFor(p.id).nights.n1.st==="nr"; }).length;
    var lu = (CG.store.get("lineups")||{});
    var tonightG = lg.tonight.find(function(g){ return g.home===me.team||g.away===me.team; });
    var luState = tonightG && lu[tonightG.id+":"+me.team] ? lu[tonightG.id+":"+me.team].status : "not submitted";
    cards.push('<div class="card" style="border-color:var(--ink)"><div class="card-h"><h3>GM tasks</h3><span class="chip chip-chrome">Management</span></div>'+
      '<div class="tasklist">'+
      (tonightG?'<div class="titem"><span class="t-dot '+(luState==="submitted"?"grn":"red")+'"></span><span style="flex:1">Tonight’s lineup — <b>'+luState+'</b>. Locks '+CG.fmtTime(tonightG.at-30*60000)+' (Rule 5.3).</span><a class="btn btn-ghost btn-sm" href="#/hub/lineup">Builder</a></div>':"")+
      '<div class="titem"><span class="t-dot'+(noReply?" red":" grn")+'"></span><span style="flex:1">'+noReply+' player'+(noReply===1?"":"s")+' with no '+esc(CG.WEEK8.label)+' response.</span><a class="btn btn-ghost btn-sm" href="#/hub/availability">Grid</a></div>'+
      '<div class="titem"><span class="t-dot grn"></span><span style="flex:1">No pending roster transactions.</span><a class="btn btn-ghost btn-sm" href="#/hub/tradehub">Trade Hub</a></div>'+
      '</div></div>');
  }
  if (r==="staff"){
    cards.push('<div class="card"><div class="card-h"><h3>Assigned cases</h3><a class="sec-link" href="#/hub/complaints">Queue</a></div>'+
      CG.visibleComplaints().filter(function(c){ return c.assignedTo==="RefCam_Official" && c.status!=="Resolved"; }).map(function(c){
        return '<div class="notif" data-go="#/hub/complaint?id='+c.caseId+'" style="cursor:pointer"><span class="nf-ic" style="color:var(--red)">'+CG.ic("flag",15)+'</span>'+
          '<span><b>'+c.caseId+' — '+esc(c.category)+'</b><p>'+esc(c.status)+(c.confidential?" · Confidential":"")+'</p></span></div>';
      }).join("")+'</div>');
    cards.push('<div class="card"><div class="card-h"><h3>Stats desk</h3></div><div class="card-b">'+
      '<p class="small" style="color:var(--steel)">All 48 finals through Week 6 are verified. Tonight’s four finals will queue here for entry after the games.</p>'+
      '<a class="btn btn-ghost btn-sm" style="margin-top:12px" href="#/hub/statsentry">Open stats entry</a></div></div>');
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
  var note = myGame
    ? '<div class="card-b" style="border-top:1px solid var(--line)"><p class="small" style="color:var(--steel)">'+(inLineup
        ? "You’re in the confirmed lineup at "+CG.POS_NAME[me.pos]+". Your private game code goes live at "+CG.fmtTime(myGame.at-30*60000)+" — open the matchup to grab it."
        : "You’re a scratch tonight — stay ready for a late swap. Tap your game to see the confirmed lines and lobby settings.")+'</p></div>'
    : '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Tap any game for confirmed lines, server settings, and the private lobby code (Rule 4.2).</span></div>';
  return '<div class="card" style="grid-column:1/-1"><div class="card-h"><h3>Tonight’s slate</h3>'+
    '<span class="chip chip-live"><span class="live-dot"></span>'+lg.tonight.length+' game'+(lg.tonight.length===1?"":"s")+'</span></div>'+
    rows + note + '</div>';
};

/* ---------- availability ---------- */
CG.hubAvailability = function(){
  var me = CG.me(), lg = CG.lg, r = CG.role();
  if (!CG.can("availability.submit") && !CG.can("availability.viewTeam")) return CG.unauthorized();
  var closed = CG.now() > CG.WEEK8.deadline;
  var mine = me ? CG.availGet(me.id) : null;
  var h = '<div style="margin-bottom:22px"><span class="eyebrow chr">'+esc(CG.WEEK8.label)+' · deadline '+CG.fmtFull(CG.WEEK8.deadline)+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Weekly availability</h1>'+
    '<p class="lede" style="margin-top:8px">Two nights next week. Answers stay private to your club’s management and league staff (Rule 5.1'+(r==="mgmt"?" — as GM you also see the team grid below":"")+').</p></div>';
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
      '<th class="tleft">Player</th><th>POS</th><th>Wed 7/22</th><th>Sat 7/25</th><th class="tleft">Note</th><th>Logged</th></tr></thead><tbody>'+
      roster.map(function(p){
        var av = CG.avFor(p.id);
        function cell(nk){
          var st = av.nights[nk] ? av.nights[nk].st : "nr";
          var map = { yes:["yes","✓"], no:["no","✗"], maybe:["mb","?"], late:["mb","L"], until:["mb","U"], emg:["mb","E"], nr:["nr","—"] };
          var m = map[st]||map.nr;
          return '<span class="avcell '+m[0]+'" title="'+st+'">'+m[1]+'</span>';
        }
        var note = av.nights.n1 && av.nights.n1.note ? av.nights.n1.note : (av.nights.n2&&av.nights.n2.note?av.nights.n2.note:"");
        return '<tr'+(me&&p.id===me.id?' style="background:var(--chrome-tint)"':"")+'>'+
          '<td class="tleft"><span class="playercell">'+CG.crest(p.team,20)+'<span class="nm">'+esc(p.tag)+'</span>'+(me&&p.id===me.id?'<span class="chip" style="font-size:9px;padding:1px 7px">you</span>':"")+'</span></td>'+
          '<td class="tnum">'+p.pos+'</td><td>'+cell("n1")+'</td><td>'+cell("n2")+'</td>'+
          '<td class="tleft small" style="color:var(--steel);max-width:220px">'+esc(note)+'</td>'+
          '<td class="tnum" style="font-size:11px">'+(av.nights.n1.st==="nr"&&av.nights.n2.st==="nr"?'<span class="chip chip-loss" style="font-size:9px">no response</span>':CG.fmtDay(av.at))+'</td></tr>';
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
  function refreshCount(){
    var n = Object.keys(picks).filter(function(k){ return picks[k]; }).length;
    var el = $("#avCount"); if (el) el.textContent = n+"/2 nights answered";
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
    if (!picks.n1 || !picks.n2){ CG.toast("Answer both nights before submitting","err"); return; }
    var entry = { at: CG.now(), nights:{} };
    ["n1","n2"].forEach(function(k){
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
    picks = { n1:"yes", n2:"yes" };
    $$(".av-opt").forEach(function(grp){
      $$("button",grp).forEach(function(x){ x.className = x.getAttribute("data-av")==="yes"?"on yes":""; });
    });
    refreshCount(); CG.toast("Copied last week — both nights available");
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
CG.gameNight = function(g){
  try { return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short"}).format(new Date(g.at))==="Fri" ? "fri" : "wed"; }
  catch(e){ return "wed"; }
};
/* which availability night (n1/n2) covers this game — null when the game isn't in the window */
CG.nightAvKey = function(game){
  var n = ((CG.WEEK8 && CG.WEEK8.nights) || []).find(function(x){ return Math.abs(x.at - game.at) < 6*3600000; });
  return n ? n.key : null;
};
/* the lineup builder's target game — honors #/hub/lineup?night=wed|fri, else tonight/next */
CG.lineupGameFor = function(me){
  var lg = CG.lg;
  var m = (location.hash.split("?")[1]||"").match(/night=(wed|fri)/);
  var want = m ? m[1] : null;
  var mine = function(g){ return (g.home===me.team||g.away===me.team) && g.status!=="final"; };
  if (want){
    var g2 = lg.schedule.filter(mine).filter(function(g){ return g.at>CG.now()-3*3600000 && CG.gameNight(g)===want; })
      .sort(function(a,b){ return a.at-b.at; })[0];
    if (g2) return g2;
  }
  return lg.tonight.find(function(g){ return g.home===me.team||g.away===me.team; })
    || lg.schedule.filter(function(g){ return (g.home===me.team||g.away===me.team) && g.at>CG.now(); })
        .sort(function(a,b){ return a.at-b.at; })[0];
};
/* one game's server-pick controls (compact, used by the Schedule desk).
   `lockAt` is 30 min before the NIGHT'S FIRST puck drop — servers stay unset
   until then, and picks freeze for the whole night at that moment. */
CG.serverVetoControls = function(game, me, lockAt){
  var mine = (CG.lg._vetoes||{})[game.id] || {};
  var home = game.home===me.team;
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
  var me = CG.me(); if(!me) return;
  var tid = (CG.lg._codeToId||{})[me.team]; if(!tid){ CG.toast("This seat has no club","err"); return; }
  var body = changedSel.closest(".card-b");
  function val(f){ var el=body.querySelector('.srv-sel[data-veto-field="'+f+'"]'); return el&&el.value?el.value:null; }
  var g = CG.lg.schedule.find(function(x){ return x.id===gameId; })||{};
  var rec = { game_id:gameId, team_id:tid, updated_by:(CG.auth&&CG.auth.user?CG.auth.user.id:null), updated_at:new Date().toISOString() };
  if (g.home===me.team){
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
    CG.toast(g.home===me.team?"1st & 2nd choices saved":"Veto & preferred saved","ok");
  });
};

CG.hubLineup = function(qs){
  var me = CG.me(), lg = CG.lg;
  if (!me || !CG.lg.byTeam[me.team]) return '<div class="note">This account doesn’t run a club — the lineup builder belongs to team management.</div>';
  var game = CG.lineupGameFor(me);
  if (!game) return '<div class="empty"><b>No upcoming game</b><p>The schedule is complete — nothing to build.</p></div>';
  var opp = game.home===me.team ? game.away : game.home;
  var key = game.id+":"+me.team;
  var saved = (CG.store.get("lineups")||{})[key];
  var night = CG.gameNight(game);
  var dbLu = (CG.lg._lineups||{})[me.team+":"+night];
  var lockAt = game.at - 30*60000;
  var locked = CG.now() >= lockAt;
  var status = saved ? saved.status : (dbLu ? "submitted" : "draft");
  var slots = saved ? saved.slots
    : (dbLu ? { LW:dbLu.lw||null, C:dbLu.center||null, RW:dbLu.rw||null, LD:dbLu.ld||null, RD:dbLu.rd||null, G:dbLu.goalie||null } : {});
  var roster = lg.byTeam[me.team];
  var suspended = {};
  lg.suspensions.forEach(function(s){ if (s.team===me.team && s.status!=="served") suspended[s.playerId]=true; });
  var assigned = Object.values(slots);
  /* Wed/Fri switcher — shown when the club has an upcoming game on each night */
  var hasWed = lg.schedule.some(function(g){ return (g.home===me.team||g.away===me.team) && g.status!=="final" && g.at>CG.now()-3*3600000 && CG.gameNight(g)==="wed"; });
  var hasFri = lg.schedule.some(function(g){ return (g.home===me.team||g.away===me.team) && g.status!=="final" && g.at>CG.now()-3*3600000 && CG.gameNight(g)==="fri"; });
  var curNight = CG.gameNight(game);
  var nightSwitch = (hasWed && hasFri)
    ? '<span style="display:inline-flex;gap:6px;margin-left:12px;vertical-align:middle">'+
      [["wed","Wednesday"],["fri","Friday"]].map(function(nn){
        var on = curNight===nn[0];
        return '<a class="chip '+(on?"chip-chrome":"")+'" href="#/hub/lineup?night='+nn[0]+'" aria-current="'+on+'" style="cursor:pointer">'+nn[1]+'</a>';
      }).join("")+'</span>'
    : "";
  var h = '<div style="margin-bottom:20px"><span class="eyebrow chr">'+CG.fmtFull(game.at)+' · vs '+esc(CG.TEAM[opp].name)+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Lineup builder'+nightSwitch+'</h1>'+
    '<p class="lede" style="margin-top:8px">Click a bench player, then a slot — or drag them on. Six starters, one per position. Locks at '+CG.fmtTime(lockAt)+' (Rule 5.3); the opponent sees it 60 minutes before puck drop.</p></div>';
  var bar = '<div class="note '+(status==="submitted"?"grn":"chr")+'" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:18px">'+
    '<b style="font-family:var(--f-disp)">Status: '+(locked?"Locked":status)+'</b>'+
    (saved&&saved.at?'<span class="caption">last saved '+CG.fmtFull(saved.at)+'</span>':"")+
    '<span style="margin-left:auto;display:flex;gap:9px">'+
    (!locked?'<button class="btn btn-ghost btn-sm" id="luAuto">Auto-fill best available</button>'+
      '<button class="btn btn-ghost btn-sm" id="luClear">Clear</button>'+
      '<button class="btn btn-chrome btn-sm" id="luSubmit">'+(status==="submitted"?"Resubmit":"Submit lineup")+'</button>'
      :'<span class="lock">'+CG.ic("lock",14)+'Lineup locked — commissioner override only</span>')+
    '</span></div>';
  var rink = '<div class="rink"><div class="rk-rows">'+
    '<div class="rk-line">'+["LW","C","RW"].map(function(pos){ return CG.luSlot(pos, slots[pos], locked); }).join("")+'</div>'+
    '<div class="rk-line d2">'+["LD","RD"].map(function(pos){ return CG.luSlot(pos, slots[pos], locked); }).join("")+'</div>'+
    '<div class="rk-line g1">'+CG.luSlot("G", slots.G, locked)+'</div>'+
  '</div></div>';
  var bench = '<div class="card"><div class="card-h"><h3>Bench — '+esc(CG.TEAM[me.team].name)+'</h3><span class="chip">'+roster.length+' rostered</span></div>'+
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
  var me = CG.me(); if (!me) return;
  var lg = CG.lg;
  var game = CG.lineupGameFor(me);
  if (!game) return;
  var key = game.id+":"+me.team;
  var store = CG.store.get("lineups")||{};
  var _night = CG.gameNight(game), _dbLu = (CG.lg._lineups||{})[me.team+":"+_night];
  var state = store[key] || (_dbLu
    ? { slots:{ LW:_dbLu.lw||undefined, C:_dbLu.center||undefined, RW:_dbLu.rw||undefined, LD:_dbLu.ld||undefined, RD:_dbLu.rd||undefined, G:_dbLu.goalie||undefined }, status:"submitted", rev:[] }
    : { slots:{}, status:"draft", rev:[] });
  var sel = null;
  /* the availability night (n1/n2) covering this game — null when it's outside the window */
  var avNightKey = CG.nightAvKey(game);
  function isLocked(){ return CG.now() >= game.at - 30*60000; }
  function msg(t, bad){ var el=$("#luMsg"); if (el){ el.textContent=t; el.style.color = bad?"var(--red)":"var(--steel)"; } }
  function save(what, status){
    state.at = CG.now();
    if (status) state.status = status;
    state.rev = (state.rev||[]).concat([{at:CG.now(), what:what}]).slice(-6);
    store[key]=state; CG.store.set("lineups", store);
    CG.router();
  }
  function validate(p, pos){
    if (isLocked()) return "The lineup locked at "+CG.fmtTime(game.at-30*60000)+" (Rule 5.3) — only a commissioner override can change it now.";
    if (p.pos!==pos) return p.tag+" is a "+CG.POS_NAME[p.pos]+" — this slot needs a "+CG.POS_NAME[pos]+".";
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
      msg("Selected "+p.tag+" — now click the "+CG.POS_NAME[p.pos]+" slot.");
      $$(".slot").forEach(function(s){ s.classList.toggle("target", s.getAttribute("data-slot")===p.pos); });
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
  var auto = $("#luAuto");
  if (auto) auto.addEventListener("click", function(){
    if (isLocked()){ CG.toast("Lineup is locked (Rule 5.3)","err"); return; }
    ["LW","C","RW","LD","RD","G"].forEach(function(pos){
      var cands = lg.byTeam[me.team].filter(function(p){
        return p.pos===pos && !validate(p,pos) || (p.pos===pos && state.slots[pos]===p.id);
      }).sort(function(a,b){ return lg.ratings[b.id].ovr-lg.ratings[a.id].ovr; });
      var pick = lg.byTeam[me.team].filter(function(p){ return p.pos===pos; })
        .sort(function(a,b){ return lg.ratings[b.id].ovr-lg.ratings[a.id].ovr; })
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
    if (isLocked()){ CG.toast("Lineup is locked (Rule 5.3) — commissioner override only","err"); return; }
    var missing = ["LW","C","RW","LD","RD","G"].filter(function(pos){ return !state.slots[pos]; });
    if (missing.length){ CG.toast("Fill every slot first — missing "+missing.join(", "), "err"); return; }
    CG.confirm("Submit this lineup?","Your six starters go to the league office and release to the opponent 60 minutes before puck drop. You can resubmit until the lock.","Submit lineup", function(){
      save("Lineup submitted to the league office","submitted");
      /* persist to the real lineups table (per game night) */
      if (CG.LIVE_MODE && CG.sb){
        var tid = (CG.lg._codeToId||{})[me.team], sid = CG.SEASON && CG.SEASON.id;
        if (tid && sid){
          var night = CG.gameNight(game);
          var lr = { season_id:sid, team_id:tid, night:night,
            lw:state.slots.LW||null, center:state.slots.C||null, rw:state.slots.RW||null,
            ld:state.slots.LD||null, rd:state.slots.RD||null, goalie:state.slots.G||null,
            updated_by:(CG.auth&&CG.auth.user?CG.auth.user.id:null), updated_at:new Date().toISOString() };
          CG.sb.from("lineups").upsert(lr,{onConflict:"season_id,team_id,night"}).then(function(r){
            if(r.error){ CG.toast("Saved on this device; DB sync failed: "+r.error.message,"err"); return; }
            CG.lg._lineups = CG.lg._lineups||{}; CG.lg._lineups[me.team+":"+night] = lr;
          });
        }
      }
      CG.pushNotif("check","Lineup submitted","vs "+CG.TEAM[game.home===me.team?game.away:game.home].name+" — locks "+CG.fmtTime(game.at-30*60000)+".","#/hub/lineup");
      CG.audit("Lineup submitted",""+key);
      CG.toast("Lineup submitted","ok");
      CG.renderChrome();
    });
  });
  document.querySelectorAll(".srv-sel").forEach(function(el){
    el.addEventListener("change", function(){ CG.saveVeto(el.getAttribute("data-veto-game"), el); });
  });
};

/* ================================================================
   ROSTER — cap sheet + waive / trade / trade-block actions
   ================================================================ */
CG.mgmtTag = function(role){ return role==="owner"?"Owner":role==="gm"?"GM":role==="agm"?"AGM":""; };
/* playoff-eligibility floor (Rule 8.3): a player must appear in at least this
   share of the club's regular-season games — fractions round up. No weekly max. */
CG.PLAYOFF_MIN_PCT = 0.30;
CG.clubSeasonGames = function(club){
  var n = (CG.lg.schedule||[]).filter(function(g){
    return (g.stage||"regular")==="regular" && (g.home===club || g.away===club); }).length;
  return n || CG.GAMES_PER_CLUB || 54;
};
CG.playoffMinGames = function(club){ return Math.ceil(CG.PLAYOFF_MIN_PCT * CG.clubSeasonGames(club)); };
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
    var actions = p.mgmt
      ? '<span class="caption">Management contract — protected</span>'
      : (waived
        ? '<button class="btn btn-ghost btn-sm" data-reinstate="'+p.id+'">Reinstate</button>'
        : '<div style="display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">'+
          '<button class="btn btn-ghost btn-sm" data-block="'+p.id+'">'+(onBlk?"Off block":"To block")+'</button>'+
          '<button class="btn btn-ghost btn-sm" data-trade="'+p.id+'">Trade</button>'+
          '<button class="btn btn-ghost btn-sm" data-waive="'+p.id+'">Waive</button></div>');
    var gp = (lg.pstats[p.id]||{}).gp||0, minGp = CG.playoffMinGames(club), elig = gp >= minGp;
    return '<tr'+(waived?' style="opacity:.55"':"")+'>'+
      '<td class="tleft"><span class="playercell">'+CG.crest(p.team,20)+'<span class="nm" data-go="'+CG.playerRoute(p)+'" style="cursor:pointer">'+esc(p.tag)+'</span></span></td>'+
      '<td class="tnum">'+p.pos+'</td>'+
      '<td class="tnum" data-v="'+lg.ratings[p.id].ovr+'"><span class="ovrbox mid" style="min-width:30px;height:20px;font-size:11px">'+lg.ratings[p.id].ovr+'</span></td>'+
      '<td class="tnum" data-v="'+(p.salary||0)+'"><b>'+CG.fmtMoney(p.salary)+'</b></td>'+
      '<td class="tnum">'+p.term+' yr'+(p.term>1?"s":"")+'</td>'+
      '<td class="tnum" data-v="'+gp+'">'+(elig
        ? gp+' <span class="chip chip-win" style="font-size:9px" title="Meets the 30% playoff-eligibility floor">PLAYOFF OK</span>'
        : gp+' <span class="caption">of '+minGp+'</span>')+'</td>'+
      '<td>'+status+'</td>'+
      '<td class="tright">'+actions+'</td></tr>';
  }).join("");
  var seasonGames = CG.clubSeasonGames(club), minGames = CG.playoffMinGames(club);
  var eligN = roster.filter(function(p){ return ((lg.pstats[p.id]||{}).gp||0) >= minGames; }).length;
  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Playoff eligibility</h3>'+
    '<span class="chip">'+eligN+' of '+roster.length+' eligible</span></div><div class="card-b">'+
    '<div style="display:flex;gap:26px;flex-wrap:wrap">'+
      '<div><b class="num" style="font-size:22px">'+Math.round(CG.PLAYOFF_MIN_PCT*100)+'%</b><span class="caption" style="display:block">of the regular season</span></div>'+
      '<div><b class="num" style="font-size:22px">'+minGames+'</b><span class="caption" style="display:block">games minimum (of '+seasonGames+')</span></div></div>'+
    '<p class="caption" style="margin-top:12px">A player must appear in at least '+Math.round(CG.PLAYOFF_MIN_PCT*100)+'% of the club’s regular-season games to dress in the playoffs — that’s '+minGames+' this season, fractions rounded up. There’s no weekly maximum: anyone can play every game. In the playoffs, no player may appear in more than four games of a single series (Rule 8.3).</p></div></div>';
  h += '<div class="card"><div class="card-h"><h3>Roster — '+roster.length+' under contract</h3>'+
    '<span class="chip">'+blockN+' on the block</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption>'+esc(t.name)+' roster, contracts and cap hit</caption><thead><tr>'+
    '<th class="tleft sortable">Player</th><th class="sortable">POS</th><th class="sortable">OVR</th><th class="sortable">Cap hit</th><th class="sortable">Term</th><th class="sortable" title="Regular-season games played toward the '+Math.round(CG.PLAYOFF_MIN_PCT*100)+'% playoff floor">GP</th><th>Status</th><th class="tright">Actions</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">GP counts toward the '+Math.round(CG.PLAYOFF_MIN_PCT*100)+'% playoff-eligibility floor ('+minGames+' games). Owner, GM, and AGM carry management contracts (Rule 2.6) and are protected from waivers and trades. Waiving a player clears their cap hit; a claimed player’s salary is reinstated at his pre-waiver number (Rule 2.5).</span></div></div>';
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
    [["Game codes released","codes",true],["Lineup & availability reminders","lineup",true],["League news & rankings","news",true],["Discipline updates involving me","disc",true],["Email a weekly digest","digest",false]].map(function(p){
      var prefs = CG.store.get("prefs");
      var on = prefs["nf_"+p[1]]!==undefined ? prefs["nf_"+p[1]] : p[2];
      return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line-soft)">'+
        '<span style="flex:1;font-size:14px">'+p[0]+'</span><button class="toggle'+(on?" on":"")+'" data-pref="nf_'+p[1]+'" role="switch" aria-checked="'+on+'" aria-label="'+p[0]+'"></button></div>';
    }).join("")+
    '<p class="caption" style="margin-top:12px">The production build delivers through in-app, Discord DM, and email with quiet hours — preferences here are wired to the demo store.</p></div></div>';
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
    '<p class="caption" style="margin-top:10px">Email addresses are never public. Availability answers are visible only to your club’s management and league staff.</p></div></div>'+
    '<div class="card"><div class="card-h"><h3>Demo seat</h3></div><div class="card-b"><p class="small" style="color:var(--steel)">Signed in as <b>'+esc(p.who)+'</b>. Switch seats from the yellow strip up top, or:</p>'+
    '<a class="btn btn-ghost btn-sm" style="margin-top:12px" href="#/signin">'+CG.ic("out",14)+'Sign out</a></div></div></div></div>';
};
CG.AFTER.hub = function(param, qs){
  if (param==="availability") CG.AFTER._availability();
  if (param==="roster") CG.AFTER._roster();
  if (param==="tradehub") CG.AFTER._tradehub(qs);
  if (param==="lineup") CG.AFTER._lineup();
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
