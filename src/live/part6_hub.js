/* ================================================================
   ROLE HUBS — member dashboard, availability, lineup builder,
   complaints, notifications, settings
   ================================================================ */

/* Placeholder only — the live adapter replaces this with the real week off the schedule. It is
   deliberately CLOSED and empty rather than a seeded two-night week: the old seed carried July 2026
   dates, so any failure to derive the real week published phantom game nights to managers instead
   of admitting there was nothing scheduled. Shape matches the live object; `open` is the signal. */
CG.WEEK8 = { key:null, label:"Game week", deadline:null, nights:[], open:false };
/* v2.44: one answer PER GAME, and it is binary — a night's three games each get Available or Not
   Available; anything more nuanced goes in the night's note. (The six-way per-night pill set —
   Maybe / late / until / emergency — was retired with it.) */
CG.AV_OPTS = [ ["yes","Available"], ["no","Not Available"] ];
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
/* v2.38: the management-permissions queue is installed by part_live; in the prototype build every
   move is simply made (the wrapper resolves false), so these pages never depend on load order. */
if (!CG.mgmtQueue) CG.mgmtQueue = function(){ return Promise.resolve(false); };
/* v3.24 — ONE dashboard at a time.
   Commissioner: "Can you separate the different dashboards to make each one feel less messy? If I
   click on My Hub I shouldn't see the staff desk or team HQ. I should only see the dashboard I
   choose from the dashboards dropdown."
   The three groups below are unchanged; what changed is that the sidebar used to render ALL of
   them, always, so a commissioner who also runs a club read a sidebar with every tool in the
   league on it whichever dashboard he had picked. hubGroups() is now the data and hubNav() shows
   exactly one group. */
CG.hubGroups = function(){
  var r = CG.role();
  /* the sidebar is split by hat: personal tools under "My Hub", club management
     under "Team HQ" (complaints is a player tool, so it stays out of Team HQ) */
  var mine = [["", "Dashboard", "home"]];
  if (CG.can("availability.submit")) mine.push(["availability","Availability","cal"]);
  /* v2.44: every rostered member can see the lineups set for the week (read-only); the builder
     itself stays a Team HQ tool */
  (function(){ var meN = CG.me && CG.me(); if (meN && meN.team && CG.can("lineup.viewOwn")) mine.push(["lineups","Lineups","grid"]); })();
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
    /* v2.88: the roster's availability grid lives on this page, so the front office gets a Team HQ
       entry for it. It used to hang off "availability.submit" alone, which is a PLAYER permission:
       a commissioner previewing a club had no way to reach the grid from any menu at all. */
    if (CG.can("availability.viewTeam")) club.push(["availability","Availability","cal"]);
    if (CG.can("roster.manage")) club.push(["management","Management","shield"]);
    if (CG.can("roster.manage")) club.push(["roster","Roster","users"]);
    if (CG.LIVE_MODE && CG.can("lineup.build")) club.push(["schedule","Schedule","cal"]);
    if (CG.LIVE_MODE && CG.can("lineup.build") && CG.hubGameStats) club.push(["gamestats","Game stats","chart"]);
    /* TWO lineup surfaces, both listed (v2.95). The board (#/hub/lines) is where a club builds
       its lines and dresses whole nights; the per-game page (#/hub/lineup) is where it changes
       ONE game, and it is where a published sheet is changed late (Rule 5.3). It was routed but unlisted,
       so the only way in was a link from somewhere else, which is no way to find a page. */
    if (CG.can("lineup.build")) club.push(["lines","Lineup builder","grid"]);
    if (CG.can("lineup.build")) club.push(["lineup","Game lineups","cal"]);
    if (CG.can("trades.manage")) club.push(["tradehub","Trade Hub","swap"]);
    /* v3.24: a player's trade request goes to this front office and to nobody else (Rule 2.3), and
       until now there was NO page that listed one. The only way in was the notification link, so a
       seat that missed the bell never saw the request at all. */
    if (CG.LIVE_MODE && CG.can("roster.manage") && CG.hubClubRequests) club.push(["clubrequests","Player requests","flag"]);
    if (CG.LIVE_MODE && CG.can("roster.manage")) club.push(["freeagents","Free agents","search"]);
    if (CG.LIVE_MODE && CG.can("roster.manage") && CG.hubDraftLive) club.push(["draft","Draft","play"]);
    /* v2.38: pages the Owner withheld from this seat are not listed (and not routable) */
    if (CG.mgmtAccess) club = club.filter(function(it){ return CG.mgmtAccess(it[0]) !== "hidden"; });
  }
  return { me: mine, staff: staffTools, club: club };
};
CG.HUB_DASH_META = { me:["My Hub","home"], club:["Team HQ","users"], staff:["Staff","flag"] };
CG._hubDashPick = null;   /* the last explicit choice, remembered for the session */
/* Which dashboard is showing. An explicit ?dash= wins and is remembered; otherwise the section
   decides, because a deep link or a notification must not drop you into the wrong sidebar. Only
   where a section belongs to SEVERAL dashboards (Availability is both a player's own form and the
   front office's grid, one page, two hats) does the remembered choice break the tie. */
CG.hubDash = function(section){
  var g = CG.hubGroups(), keys = ["me","club","staff"].filter(function(k){ return (g[k]||[]).length; });
  if (!keys.length) return "me";
  var want = (String(location.hash||"").match(/[?&]dash=(me|club|staff)(?:&|$)/)||[])[1] || null;
  if (want && keys.indexOf(want)>=0) { CG._hubDashPick = want; return want; }
  var owners = keys.filter(function(k){ return g[k].some(function(it){ return it[0]===section; }); });
  if (owners.length === 1) return owners[0];
  if (owners.length > 1) return (CG._hubDashPick && owners.indexOf(CG._hubDashPick)>=0) ? CG._hubDashPick : owners[0];
  /* a section in no group at all (a routed-but-unlisted page) keeps whatever is remembered */
  return (CG._hubDashPick && keys.indexOf(CG._hubDashPick)>=0) ? CG._hubDashPick : keys[0];
};
/* Where a dashboard OPENS. Each names the page it wants to land on, and falls back to its first
   listed entry when that seat does not have it, so a dashboard never opens on a page the Owner
   withheld (Rule 2.6) and never on a hardcoded route that 404s for half the league.
   The preference matters: Team HQ's first listed entry is Availability, and opening a front office
   on the availability grid rather than the roster is not what anyone means by "Team HQ". */
CG.HUB_DASH_LANDING = { me: [""], club: ["roster","management","lines"], staff: ["staffdesk"] };
CG.hubDashHref = function(key){
  var items = CG.hubGroups()[key] || [];
  if (!items.length) return null;
  var has = function(k){ return items.some(function(it){ return it[0]===k; }); };
  var want = (CG.HUB_DASH_LANDING[key]||[]).filter(has)[0];
  var sec = want !== undefined ? want : items[0][0];
  return "#/hub" + (sec ? "/"+sec : "") + "?dash=" + key;
};
CG.hubNav = function(section){
  var g = CG.hubGroups(), dash = CG.hubDash(section);
  var keys = ["me","club","staff"].filter(function(k){ return (g[k]||[]).length; });
  function render(items){
    return items.map(function(it){
      var badge = "";
      /* only a rostered member can owe an availability answer — a seat with no roster spot
         (an Owner who does not play) has nothing to submit, so it must never be badged "due" */
      var meNav = CG.me && CG.me();
      if (it[0]==="availability" && meNav && CG.WEEK8 && CG.WEEK8.open && !CG.availGet(meNav.id)) badge = '<span class="hs-n">due</span>';
      if (it[0]==="tradehub" && CG.incomingCount()) badge = '<span class="hs-n">'+CG.incomingCount()+'</span>';
      if (it[0]==="management" && CG.mgmtPendingCount && CG.mgmtPendingCount()) badge = '<span class="hs-n">'+CG.mgmtPendingCount()+'</span>';
      if (it[0]==="notifications" && CG.unreadCount()) badge = '<span class="hs-n">'+CG.unreadCount()+'</span>';
      if (it[0]==="complaints" && CG.role()==="staff"){
        var openN = CG.visibleComplaints().filter(function(c){ return c.status!=="Resolved"; }).length;
        if (openN) badge = '<span class="hs-n">'+openN+'</span>';
      }
      return '<a href="#/hub'+(it[0]?"/"+it[0]:"")+'?dash='+dash+'" class="'+(section===it[0]?"on":"")+'">'+CG.ic(it[2],15)+it[1]+badge+'</a>';
    }).join("");
  }
  /* the switcher stays in the sidebar as well as the masthead: with only one group showing, a
     member deep in Team HQ needs the way back where his eye already is */
  var switcher = keys.length < 2 ? "" :
    '<div class="hs-switch" role="group" aria-label="Dashboards">'+keys.map(function(k){
      var m = CG.HUB_DASH_META[k];
      return '<a href="'+CG.hubDashHref(k)+'" class="'+(k===dash?"on":"")+'"'+(k===dash?' aria-current="page"':'')+'>'+CG.ic(m[1],14)+m[0]+'</a>';
    }).join("")+'</div>';
  return '<nav class="hub-side" aria-label="Hub sections">'+switcher+
    '<div class="hs-group">'+CG.HUB_DASH_META[dash][0]+'</div>'+render(g[dash]||[])+'</nav>';
};
CG.hubShell = function(section, inner){
  var notice = "";
  return '<section class="sec-tight"><div class="shell"><div class="hub-grid">'+CG.hubNav(section)+'<div>'+notice+inner+'</div></div></div></section>';
};
CG.unauthorized = function(need){
  return '<section class="sec"><div class="shell"><div class="empty" style="padding:70px 20px">'+
    '<div class="e-art">'+CG.ic("lock",22)+'</div><b>You don’t have access to this area</b>'+
    '<p>'+esc(need||"This area is limited to signed-in league members with the right role.")+'</p>'+
    /* a member who is already signed in is not short a session — telling them to sign in
       contradicts the refusal (their Owner withheld the page, Rule 2.6) */
    ((CG.auth && CG.auth.user) ? "" : '<a class="btn btn-ink" href="#/signin" style="margin-top:18px">Sign in</a>')+
    '</div></div></section>';
};

CG.ROUTES.hub = function(param, qs){
  var r = CG.role();
  if (r==="guest") return CG.unauthorized("Sign in with Discord to reach your dashboard.");
  var section = param||"";
  if (section==="") return CG.hubShell("", CG.hubDashboard());
  if (section==="availability") return CG.hubShell("availability", CG.hubAvailability());
  if (section==="lineups") return (CG.can("lineup.viewOwn") && CG.me() && CG.me().team) ? CG.hubShell("lineups", CG.hubWeekLineups()) : CG.unauthorized("This week's lineups are for the club's rostered players.");
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
  /* v2.38: the Owner's approval queue, or a manager's own moves still waiting */
  if (CG.mgmtPendingCount && CG.mySeat){
    var pend = CG.mgmtPendingCount(), seat = CG.mySeat();
    if (pend && seat==="owner") rows += '<div class="titem"><span class="t-dot red"></span><span style="flex:1"><b>'+pend+' move'+(pend===1?"":"s")+'</b> from your management waiting for your approval.</span><a class="btn btn-chrome btn-sm" href="#/hub/management">Review</a></div>';
    else if (pend){
      var uidP = (CG.auth.user||{}).id, firstP = CG.mgmtMoves("pending").filter(function(m){ return m.requested_by===uidP; })[0];
      var goP = CG.mgmtAccess("management")!=="hidden" ? "#/hub/management" : ("#/hub/"+((firstP && firstP.page) || "roster"));
      rows += '<div class="titem"><span class="t-dot"></span><span style="flex:1">'+pend+' of your move'+(pend===1?"":"s")+' waiting for the Owner’s approval.</span><a class="btn btn-ghost btn-sm" href="'+goP+'">See</a></div>';
    }
  }
  var to = (CG.TEAMS||[]).find(function(t){ return t.code===team; });
  /* the GM vacancy nudge is the Owner's to act on (Rule 2.6) */
  if (to && !to.gm && (!CG.mySeat || CG.mySeat()==="owner")){
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
  /* draft night (v2.68): players are not in the draft, but they can watch it; management already
     has its own draft desk in Team HQ, so the pointer is for everyone else */
  if (CG.draftNightBand && !(CG.managesClub && CG.managesClub())){ var dnb = CG.draftNightBand("hub"); if (dnb) cards.push(dnb); }
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
       "Due Wed 7:30 PM ET" for a week that doesn't exist. */
    if (CG.WEEK8 && CG.WEEK8.open){
      cards.push('<div class="card" '+(av?"":'style="border-color:var(--chrome-deep);background:var(--chrome-tint)"')+'>'+
        '<div class="card-h"><h3>'+esc(CG.WEEK8.label)+' availability</h3><span class="chip '+(av?"chip-win":"chip-warn")+'">'+(av?"Submitted":"Due Wed 7:30 PM ET")+'</span></div>'+
        '<div class="card-b">'+(av
          ? '<p class="small" style="color:var(--steel)">Logged '+CG.fmtFull(av.at)+(av.late?' — <b>recorded as late</b> (Rule 5.1)':'')+'. You can edit until the deadline; a change after it is accepted at your club’s discretion and recorded as late.</p>'
          : '<p class="small" style="color:var(--steel)">Your club’s management builds lineups from this — 30 seconds now saves a scramble later.</p>')+
        '<a class="btn '+(av?"btn-ghost":"btn-chrome")+' btn-sm" style="margin-top:12px" href="#/hub/availability">'+(av?"Review / edit":"Submit availability")+'</a></div></div>');
    } else {
      cards.push('<div class="card"><div class="card-h"><h3>Availability</h3><span class="chip">Off week</span></div>'+
        '<div class="card-b"><p class="small" style="color:var(--steel)">No game week is scheduled yet. Availability opens each week once the schedule is posted — you’ll get a notification.</p></div></div>');
    }
    if (lg.tonight.length){
      cards.push(CG.tonightCard(me, tonight, inLineup));
    }
    /* v2.44: the week's lineups, at a glance — which games you are dressed for */
    if (CG.WEEK8 && CG.WEEK8.open && CG.clubGamesOnNight && me.team){
      var wk = [];
      CG.WEEK8.nights.forEach(function(n){ CG.clubGamesOnNight(me.team, n).forEach(function(g){ wk.push(g); }); });
      if (wk.length){
        var POSW = ["LW","C","RW","LD","RD","G"], setN = 0, inN = 0;
        var rowsW = wk.map(function(g){
          var row = CG._pubLineups ? CG._pubLineups[me.team+":"+g.id] : undefined;
          if (row === undefined && lg._lineups) row = lg._lineups[me.team+":"+g.id];
          var slots = row ? CG.plannedLineup(g, me.team) : null;
          var mySlot = slots ? POSW.filter(function(ps){ return slots[ps]===me.id; })[0] : null;
          if (row) setN++; if (mySlot) inN++;
          var opp = g.home===me.team ? 'vs '+((CG.TEAM[g.away]||{}).code||g.away) : '@ '+((CG.TEAM[g.home]||{}).code||g.home);
          return '<div class="titem"><span class="t-dot '+(mySlot?"grn":row?"":row===null?"red":"")+'"></span><span style="flex:1"><b>'+esc(CG.fmtDay(g.at))+' · '+CG.fmtTime(g.at)+'</b> '+esc(opp)+'</span>'+
            '<span class="chip'+(mySlot?" chip-win":row?"":row===null?" chip-loss":"")+'" style="font-size:9px;padding:1px 7px">'+(mySlot?"you at "+mySlot:row?"dressed without you":row===null?"not set yet":"…")+'</span></div>';
        }).join("");
        cards.push('<div class="card" style="grid-column:1/-1"><div class="card-h"><h3>This week’s lineups</h3><a class="sec-link" href="#/hub/lineups">All six</a></div>'+
          '<div class="tasklist">'+rowsW+'</div>'+
          '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">'+setN+' of '+wk.length+' game'+(wk.length===1?"":"s")+' set so far'+(inN?' · you’re dressed for '+inN:'')+'. Your management can change a lineup until 30 minutes before puck drop (Rule 5.3).</span></div></div>');
      }
    }
    if (CG.playoffMinGp && CG.playoffMinGp() && me.spotId){
      var myGp = (lg.pstats[me.id]||{}).gp||0, myMin = CG.playoffMinGp(), myLeft = (lg.schedule||[]).filter(function(g){ return g.stage==="regular" && g.status!=="final" && (g.home===me.team || g.away===me.team); }).length;
      cards.push('<div class="card"><div class="card-h"><h3>Playoff eligibility</h3>'+(myGp>=myMin?'<span class="chip chip-win">eligible</span>':(myMin-myGp)<=myLeft?'<span class="chip chip-warn">'+(myMin-myGp)+' to go</span>':'<span class="chip chip-loss">out of reach</span>')+'</div><div class="card-b">'+
        '<div style="display:flex;align-items:center;gap:12px"><b class="num" style="font-size:26px">'+myGp+'<span class="caption" style="font-size:12px"> / '+myMin+'</span></b>'+
        '<span style="flex:1;height:8px;border-radius:4px;background:var(--line);overflow:hidden"><i style="display:block;height:100%;width:'+Math.round(Math.min(1,myGp/myMin)*100)+'%;background:'+(myGp>=myMin?"var(--green)":"var(--chrome)")+'"></i></span></div>'+
        '<p class="caption" style="margin-top:10px">'+(myGp>=myMin?'You have the '+myMin+' regular-season games the playoffs need (Rule 8.3).':'You need '+myMin+' regular-season games to dress in the playoffs (Rule 8.3) — '+(myMin-myGp)+' more, with '+myLeft+' club game'+(myLeft===1?'':'s')+' left. Mark yourself available and talk to your GM.')+'</p></div></div>');
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
    /* an empty bell is a real state (a brand-new member, a quiet week) — say so, because a card
       with a header and nothing under it reads as a page that failed to load */
    (notifs.length ? "" : '<div class="card-b"><span class="caption">No alerts yet — roster moves, lineups, trades and league notices land here.</span></div>')+
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
      CG.fmtTime(CG.codeReleaseAt(myGame))+" (30 minutes before the night’s first game) — open the matchup to grab it."+'</p></div>'
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
  /* Rule 5.1: the deadline is soft — an answer after it is still accepted (at management's
     discretion) but the database records it as late (v2.57). So the form stays open; `past`
     only changes what the page says. It used to hard-lock the buttons and promise a
     commissioner override that did not exist. */
  var past = CG.WEEK8.open && CG.now() > CG.WEEK8.deadline;
  var closed = false;
  var mine = me ? CG.availGet(me.id) : null;
  var h = '<div style="margin-bottom:22px"><span class="eyebrow chr">'+esc(CG.WEEK8.label)+
      (CG.WEEK8.open ? ' · deadline '+CG.fmtFull(CG.WEEK8.deadline) : ' · not yet scheduled')+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Weekly availability</h1>'+
    '<p class="lede" style="margin-top:8px">'+(CG.WEEK8.nights.length||0)+' night'+(CG.WEEK8.nights.length===1?'':'s')+' this week — answer each game. Answers stay private to your club’s management and league staff (Rule 5.1'+(r==="mgmt"?" — as GM you also see the team grid below":"")+').</p></div>';
  var form = !me
    ? '<div class="note">You’re viewing as league staff — no player profile, so there’s nothing personal to submit. The team grid below is what management and staff see.</div>'
    : '<div class="card"><div class="card-h"><h3>My submission</h3>'+
    '<span class="chip '+(mine?(mine.late?"chip-warn":"chip-win"):past?"chip-loss":"chip-warn")+'">'+(mine?("Submitted "+CG.fmtDay(mine.at)+(mine.late?" · late":"")):past?"Past the deadline":"Not submitted")+'</span></div>'+
    (past?'<div class="note" style="margin:0 0 12px">The '+esc(CG.WEEK8.label)+' deadline was '+CG.fmtFull(CG.WEEK8.deadline)+'. You can still answer — your club decides whether to use it for lineups, and the league office records it as late (Rule 5.1).</div>':"")+
    '<div class="card-b">'+
    (closed && !mine ? '<div class="empty"><b>The '+esc(CG.WEEK8.label)+' window has closed</b><p>Availability locked at the deadline. Message your GM — a commissioner can still enter a late submission with an override.</p></div>'
    : CG.WEEK8.nights.map(function(n,i){
      var note = mine && mine.nights[n.key] ? (mine.nights[n.key].note||"") : "";
      var games = CG.clubGamesOnNight ? CG.clubGamesOnNight(me.team, n) : [];
      return '<div style="padding:14px 0;border-top:'+(i?"1px solid var(--line-soft)":"0")+'">'+
        '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">'+
        '<b style="font-family:var(--f-disp)">'+CG.fmtDay(n.at)+'</b><span class="caption">Game night '+(i+1)+(games.length?' · '+games.length+' game'+(games.length===1?'':'s'):'')+'</span></div>'+
        (games.length ? games.map(function(g, gi){
          var cur = CG.avGame ? CG.avGame(mine||{nights:{}}, n.key, g.id) : "nr";
          var opp = g.home===me.team ? 'vs '+((CG.TEAM[g.away]||{}).name||g.away) : '@ '+((CG.TEAM[g.home]||{}).name||g.home);
          return '<div class="av-game" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:6px 0">'+
            '<span class="small" style="min-width:230px"><b class="num">'+CG.fmtTime(g.at)+'</b> <span style="color:var(--steel)">· Game '+(gi+1)+' · '+esc(opp)+'</span></span>'+
            '<span class="av-opt" data-night="'+n.key+'" data-game="'+esc(g.id)+'">'+CG.AV_OPTS.map(function(o){
              return '<button data-av="'+o[0]+'" class="'+(cur===o[0]?("on "+o[0]):"")+'" '+(closed?"disabled":"")+'>'+o[1]+'</button>';
            }).join("")+'</span></div>';
        }).join("") : '<p class="caption">No games for your club this night.</p>')+
        '<input type="text" data-note="'+n.key+'" placeholder="Optional note (e.g. “on at 9:30 after work”)" value="'+esc(note)+'" style="margin-top:10px;max-width:460px" '+(closed?"disabled":"")+'>'+
      '</div>';
    }).join("")+
    (!closed?'<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">'+
      '<button class="btn btn-chrome" id="avSubmit">'+(mine?"Update availability":"Submit availability")+'</button>'+
      '<button class="btn btn-ghost" id="avCopy">Mark every game available</button>'+
      '<span class="caption" style="align-self:center" id="avCount"></span></div>':""))+
    '</div></div>';
  var grid = "";
  if (CG.can("availability.viewTeam")){
    /* v2.88: an explicit front-office preview wins over the viewer's own roster spot, the same
       rule as the rest of Team HQ (v2.86). A commissioner who still plays was shown HIS club's
       grid under the previewed club's name, which is worse than showing nothing. */
    var clubCode = (CG.previewClub && CG.previewClub()) || (me && me.team ? me.team : CG.myClub());
    /* v3.12 — rink order. localeCompare on the position STRING sorted this alphabetically
       (C, G, LD, LW, RD, RW), which put the goaltender second in every availability grid. */
    var roster = (lg.byTeam[clubCode]||[]).slice().sort(function(a,b){ return (CG.isCamp(a)?1:0)-(CG.isCamp(b)?1:0) || (CG.POS_RANK[a.pos]||99)-(CG.POS_RANK[b.pos]||99); });
    var gridCols = 4 + CG.WEEK8.nights.length, gridCamp = roster.some(CG.isCamp);
    var nightGames = {};
    CG.WEEK8.nights.forEach(function(n){ nightGames[n.key] = CG.clubGamesOnNight ? CG.clubGamesOnNight(clubCode, n) : []; });
    grid = '<div class="card" style="margin-top:20px"><div class="card-h"><h3>Team grid — '+esc((CG.TEAM[clubCode]||{}).name||"—")+'</h3>'+
      '<span class="chip">Visible to management & staff only</span></div>'+
      (roster.length ? "" : '<div class="card-b"><p class="caption">No rostered players to show for this club yet.</p></div>')+
      '<div class="tblwrap"><table class="tbl keepcols"><caption>'+esc(CG.WEEK8.label)+' availability by player</caption><thead><tr>'+
      '<th class="tleft">Player</th><th>POS</th>'+
      CG.WEEK8.nights.map(function(n){
        return '<th>'+esc(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",month:"numeric",day:"numeric"}).format(new Date(n.at)))+'</th>';
      }).join("")+
      '<th class="tleft">Note</th><th>Logged</th></tr></thead><tbody>'+
      roster.map(function(p, idx){
        var av = CG.avFor(p.id);
        /* v2.44: one mark per GAME that night (✓ available · ✗ not · — no answer), oldest first */
        function cell(nk){
          var games = nightGames[nk] || [];
          if (!games.length){ var st0 = av.nights[nk] ? av.nights[nk].st : "nr"; var m0 = st0==="yes"?["yes","✓"]:st0==="no"?["no","✗"]:st0==="nr"?["nr","—"]:["mb","?"]; return '<span class="avcell '+m0[0]+'" title="'+st0+'">'+m0[1]+'</span>'; }
          return '<span style="display:inline-flex;gap:3px">'+games.map(function(g){
            var v = CG.avGame ? CG.avGame(av, nk, g.id) : "nr";
            var m = v==="yes"?["yes","✓"]:v==="no"?["no","✗"]:v==="maybe"?["mb","?"]:["nr","—"];
            return '<span class="avcell '+m[0]+'" title="'+esc(CG.fmtTime(g.at))+' · '+v+'">'+m[1]+'</span>';
          }).join("")+'</span>';
        }
        var noteN = CG.WEEK8.nights.filter(function(n){ return av.nights[n.key] && av.nights[n.key].note; })[0];
        var note = noteN ? av.nights[noteN.key].note : "";
        var silent = CG.WEEK8.nights.every(function(n){ return !av.nights[n.key] || av.nights[n.key].st==="nr"; });
        /* v2.72: the active roster and training camp are two blocks */
        var gHead = (gridCamp && idx===0 && !CG.isCamp(p)) ? '<tr class="squad-head"><td colspan="'+gridCols+'" class="tleft"><b style="font-family:var(--f-disp)">Active roster</b></td></tr>'
                  : (CG.isCamp(p) && (idx===0 || !CG.isCamp(roster[idx-1]))) ? '<tr class="squad-head"><td colspan="'+gridCols+'" class="tleft"><b style="font-family:var(--f-disp)">Training camp</b> <span class="caption">any position · up to 3 games a week</span></td></tr>' : "";
        return gHead + '<tr'+(me&&p.id===me.id?' style="background:var(--chrome-tint)"':"")+'>'+
          '<td class="tleft"><span class="playercell">'+CG.crest(p.team,20)+'<span class="nm">'+esc(p.tag)+'</span>'+(me&&p.id===me.id?'<span class="chip" style="font-size:9px;padding:1px 7px">you</span>':"")+'</span></td>'+
          '<td class="tnum">'+p.pos+'</td>'+
          CG.WEEK8.nights.map(function(n){ return '<td>'+cell(n.key)+'</td>'; }).join("")+
          '<td class="tleft small" style="color:var(--steel);max-width:220px">'+esc(note)+'</td>'+
          '<td class="tnum" style="font-size:11px">'+(silent?'<span class="chip chip-loss" style="font-size:9px">no response</span>':CG.fmtDay(av.at)+
            (av.late?' <span class="chip chip-warn" style="font-size:9px;padding:1px 6px" title="Changed after the 7:30 PM ET deadline — accepted at management’s discretion, recorded as late (Rule 5.1)">late</span>':""))+'</td></tr>';
      }).join("")+'</tbody></table></div>'+
      '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">One mark per game, in puck-drop order: ✓ available · ✗ not available · — no answer (? = an older per-night answer). Notes are per night. Opponents never see this grid — they only see your finalized lineup.</span></div></div>';
  }
  return h + form + grid;
};
CG.AFTER._availability = function(){
  var me = CG.me(); if (!me) return;
  /* v2.44: picks are per GAME — picks[nightKey][gameId] = "yes" | "no" */
  var picks = {};
  var mine = CG.availGet(me.id);
  var NIGHTS = ((CG.WEEK8 && CG.WEEK8.nights) || []);
  var GAMES = {};   /* nightKey -> [gameId, …] for this club */
  NIGHTS.forEach(function(n){
    GAMES[n.key] = (CG.clubGamesOnNight ? CG.clubGamesOnNight(me.team, n) : []).map(function(g){ return String(g.id); });
    picks[n.key] = {};
    GAMES[n.key].forEach(function(gid){ var v = CG.avGame ? CG.avGame(mine||{nights:{}}, n.key, gid) : "nr"; if (v==="yes"||v==="no") picks[n.key][gid] = v; });
  });
  var TOTAL = NIGHTS.reduce(function(a,n){ return a + GAMES[n.key].length; }, 0);
  function answered(){ return NIGHTS.reduce(function(a,n){ return a + Object.keys(picks[n.key]).length; }, 0); }
  function refreshCount(){
    var el = $("#avCount"); if (el) el.textContent = answered()+"/"+TOTAL+" game"+(TOTAL===1?"":"s")+" answered";
  }
  $$(".av-opt").forEach(function(grp){
    grp.addEventListener("click", function(e){
      var b = e.target.closest("[data-av]"); if (!b || b.disabled) return;
      $$("button",grp).forEach(function(x){ x.className=""; });
      var v = b.getAttribute("data-av");
      b.className = "on "+v;
      var nk = grp.getAttribute("data-night"), gid = grp.getAttribute("data-game");
      if (!picks[nk]) picks[nk] = {};
      picks[nk][gid] = v;
      refreshCount();
    });
  });
  var sub = $("#avSubmit");
  if (sub) sub.addEventListener("click", function(){
    var missing = TOTAL - answered();
    if (missing > 0){
      CG.toast("Answer all "+TOTAL+" game"+(TOTAL===1?"":"s")+" before submitting","err"); return;
    }
    var entry = { at: CG.now(), nights:{} };
    NIGHTS.forEach(function(n){
      var k = n.key, games = picks[k] || {}, ids = Object.keys(games);
      var yes = ids.filter(function(g){ return games[g]==="yes"; }).length;
      /* the night summary rides along for every reader of the old shape (grid, dashboard, builder) */
      var st = !ids.length ? "nr" : yes===ids.length ? "yes" : yes===0 ? "no" : "part";
      entry.nights[k] = { games: games, st: st, note: ($("[data-note="+k+"]")||{}).value||"" };
    });
    CG.availSave(entry, function(ok){
      if (!ok) return;
      CG.pushNotif("check","Availability submitted",CG.WEEK8.label+" — logged "+CG.fmtFull(entry.at)+". You can edit until the deadline (Wednesday 7:30 PM ET).","#/hub/availability");
      CG.toast(CG.WEEK8.label+" availability submitted","ok");
      CG.renderChrome(); CG.router();
    });
  });
  var cp = $("#avCopy");
  if (cp) cp.addEventListener("click", function(){
    NIGHTS.forEach(function(n){ picks[n.key] = {}; GAMES[n.key].forEach(function(gid){ picks[n.key][gid] = "yes"; }); });
    $$(".av-opt").forEach(function(grp){
      $$("button",grp).forEach(function(x){ x.className = x.getAttribute("data-av")==="yes"?"on yes":""; });
    });
    refreshCount(); CG.toast("Marked available for all "+TOTAL+" game"+(TOTAL===1?"":"s"));
  });
  refreshCount();
};

/* ---------- this week's lineups — read-only, for the whole roster (v2.44) ----------
   Every rostered member sees which six are dressed for each of the club's games this week, as
   management sets them. The page reads the same game_lineups rows the builder writes (via
   plannedLineup / the _pubLineups cache) and never guesses: a game with no row says "Not set yet",
   one the loader has not answered for yet says "Loading". Management still builds in Team HQ. */
CG.hubWeekLineups = function(){
  var me = CG.me(), lg = CG.lg, club = me && me.team;
  var nights = (CG.WEEK8 && CG.WEEK8.open && CG.WEEK8.nights) || [];
  var head = '<div style="margin-bottom:22px"><span class="eyebrow chr">'+esc((CG.TEAM[club]||{}).name||"Your club")+' · '+esc(CG.WEEK8.label)+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">This week’s lineups</h1>'+
    '<p class="lede" style="margin-top:8px">Who is dressed for each of your club’s games this week, as your management sets them. Lineups lock 30 minutes before puck drop (Rule 5.3); until then your GM can still change them.</p></div>';
  if (!nights.length) return head + '<div class="card"><div class="card-b"><div class="empty"><b>No game week scheduled yet</b><p>Lineups appear here once the schedule is posted and your management dresses them.</p></div></div></div>';
  var POS = ["LW","C","RW","LD","RD","G"];
  var name = function(id){ var p = id && CG.playerById(lg, id); return p ? p.tag : null; };
  var h = head;
  nights.forEach(function(n, i){
    var games = CG.clubGamesOnNight ? CG.clubGamesOnNight(club, n) : [];
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>'+esc(CG.fmtDay(n.at))+'</h3><span class="chip">Game night '+(i+1)+' · '+games.length+' game'+(games.length===1?"":"s")+'</span></div>';
    if (!games.length){ h += '<div class="card-b"><p class="caption">No games for your club this night.</p></div></div>'; return; }
    h += games.map(function(g, gi){
      var opp = g.home===club ? 'vs '+((CG.TEAM[g.away]||{}).name||g.away) : '@ '+((CG.TEAM[g.home]||{}).name||g.home);
      var row = CG._pubLineups ? CG._pubLineups[club+":"+g.id] : undefined;
      if (row === undefined && lg._lineups) row = lg._lineups[club+":"+g.id];
      var locked = CG.now() >= g.at - 30*60000, final = g.status==="final";
      var status = final ? '<span class="chip">Final</span>' : locked ? '<span class="chip chip-warn">Locked</span>' : row ? '<span class="chip chip-win">Set</span>' : row===null ? '<span class="chip chip-loss">Not set yet</span>' : '<span class="chip">Loading</span>';
      var slots = row ? CG.plannedLineup(g, club) : null;
      var meIn = slots && POS.some(function(ps){ return slots[ps]===me.id; });
      var six = slots ? '<div style="display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:8px">'+POS.map(function(ps){
          var id = slots[ps], nm = name(id);
          return '<span class="small"><span class="caption" style="margin-right:6px">'+ps+'</span>'+(nm ? '<b'+(id===me.id?' style="background:var(--chrome-tint);padding:1px 6px;border-radius:6px"':'')+'>'+esc(nm)+(id===me.id?' <span class="caption">you</span>':'')+'</b>' : '<span style="color:var(--steel)">—</span>')+'</span>';
        }).join("")+'</div>' : '';
      return '<div class="card-b" style="border-top:'+(gi?"1px solid var(--line-soft)":"1px solid var(--line)")+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">'+
        '<span><b class="num">'+CG.fmtTime(g.at)+'</b> <span class="caption">· Game '+(gi+1)+'</span> <span class="small">'+esc(opp)+'</span>'+(meIn?' <span class="chip chip-win" style="font-size:9px;padding:1px 7px">you’re dressed</span>':'')+'</span>'+
        '<span style="display:flex;gap:8px;align-items:center">'+status+'<a class="btn btn-ghost btn-sm" href="#/matchup/'+esc(g.id)+'">Matchup ›</a></span></div>'+six+'</div>';
    }).join("");
    h += '</div>';
  });
  return h;
};

/* ---------- lineup builder ---------- */
/* ---------- server veto (ported from the classic site, real game_vetoes DB) ----------
   Home club picks 1st + 2nd server choice; away club picks a veto (won't play) + a
   preferred. Picks are private to each club and lock 30 min before puck drop, when the
   resolve_game_server RPC settles the server from both clubs' picks. */
/* THE league's server list, in the order the office lists them (commissioner, 2026-09-23).
   The database keeps the same list in public.server_options() for the resolver; change one and
   change the other. */
CG.SERVERS = ["NA Northeast","NA Southeast","NA Central","NA West"];
/* The standard server: what a game lands on when NEITHER club names one. Mirrors
   public.default_server(), which is what actually decides it. If the away club vetoes the
   standard server and nobody names an alternative, the resolver falls to the first listed
   server that is not the veto. */
CG.DEFAULT_SERVER = "NA Central";
/* What a club's own roster suggests, most-suggested first. Advisory only (Rule 4.2): it tells
   management where its players say they play best, it never sets the pick. Counts the ACTIVE
   squad and camp alike; anyone with no preference is counted once in `none`. */
CG.suggestedServers = function(club){
  var list = ((CG.lg && CG.lg.byTeam) || {})[club] || [];
  var n = {}, none = 0;
  list.forEach(function(p){
    var sv = p && p.server;
    if (sv && CG.SERVERS.indexOf(sv) >= 0) n[sv] = (n[sv]||0)+1; else none++;
  });
  var rows = CG.SERVERS.filter(function(sv){ return n[sv]; })
    .map(function(sv){ return { server: sv, n: n[sv] }; })
    .sort(function(a,b){ return b.n - a.n || CG.SERVERS.indexOf(a.server) - CG.SERVERS.indexOf(b.server); });
  return { rows: rows, none: none, answered: list.length - none, roster: list.length, top: rows.length ? rows[0].server : null };
};
/* The board management reads before it picks. Drawn once on the Schedule desk, not per game. */
CG.serverSuggestCard = function(club){
  var s = CG.suggestedServers(club);
  var bars = s.rows.length
    ? '<div class="srv-sug">'+s.rows.map(function(r){
        var pct = s.answered ? Math.round(r.n/s.answered*100) : 0;
        return '<div class="srv-row"><span class="srv-nm">'+esc(r.server)+'</span>'+
          '<span class="srv-bar"><i style="width:'+Math.max(4,pct)+'%"></i></span>'+
          '<span class="srv-n mono">'+r.n+'</span></div>';
      }).join("")+'</div>'
    : '<p class="small" style="color:var(--steel);margin:0">Nobody on the roster has set one yet. Players choose theirs in Settings, under Suggested server.</p>';
  /* the same order as the bars above it, most-suggested first: two orderings of one list in one
     card reads as two different answers */
  var names = s.rows.length
    ? '<div class="srv-who">'+s.rows.map(function(r){
        var who = ((CG.lg.byTeam||{})[club]||[]).filter(function(p){ return p.server===r.server; })
          .map(function(p){ return esc(p.tag); }).join(", ");
        return '<div><b>'+esc(r.server)+'</b> <span class="caption" style="letter-spacing:0;text-transform:none">'+who+'</span></div>';
      }).join("")+'</div>'
    : "";
  return '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>What your roster suggests</h3>'+
    '<span class="chip">'+s.answered+' of '+s.roster+' answered</span></div><div class="card-b">'+
    bars + names +
    '<p class="caption" style="margin-top:10px">A suggestion, not a vote: the picks and the veto are management’s (Rule 4.2). '+
    'With no pick from either club a game is played on <b>'+esc(CG.DEFAULT_SERVER)+'</b>.</p></div></div>';
};
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
/* True while every game still ahead of this club is a pre-season game — the window in which
   Rule 5.2's weekly appearance caps do not apply (v2.28). */
CG.preseasonOnlyAhead = function(club){
  /* v2.36: the club's NEXT game decides. "Every remaining game is a pre-season game" was never
     true once the regular-season schedule existed beside the pre-season one, so the pre-season
     branch never rendered and the line builder refused a goaltender a third line in the pre-season. */
  var up = CG.clubUpcomingGames(club).slice().sort(function(a,b){ return (a.at||0)-(b.at||0); });
  return up.length > 0 && up[0].stage === "preseason";
};
/* All of ONE night's upcoming games for a club (dressing a night covers every game in it).
   nightKey is a weekday ("wed"), and matching on the weekday alone returned every Wednesday
   left in the season — so "whole night" dressed ~45 games stretching into December instead of
   tonight's three. Anchor on the ET calendar date of the NEXT game that falls on that weekday. */
CG.etDay = function(at){
  try { return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date(at)); }
  catch(e){ return String(at); }
};
CG.nightGames = function(club, nightKey){
  var all = CG.clubUpcomingGames(club).filter(function(g){ return CG.gameNight(g)===nightKey; });
  if (!all.length) return all;
  var day = CG.etDay(all[0].at);          /* soonest-first, so [0] is the night in question */
  return all.filter(function(g){ return CG.etDay(g.at)===day; });
};
/* one game's server-pick controls (compact, used by the Schedule desk).
   `lockAt` is 30 min before the NIGHT'S FIRST puck drop — servers stay unset
   until then, and picks freeze for the whole night at that moment. */
CG.serverVetoControls = function(game, me, lockAt){
  var mine = (CG.lg._vetoes||{})[game.id] || {};
  var home = game.home===(CG.hqClub() || (me && me.team));
  function opts(sel){ return '<option value="">— pick —</option>'+CG.SERVERS.map(function(s){ return '<option value="'+esc(s)+'"'+(s===sel?" selected":"")+'>'+esc(s)+(s===CG.DEFAULT_SERVER?" (standard)":"")+'</option>'; }).join(""); }
  /* What happens if this club files nothing: silence is a choice, so name its outcome rather than
     leaving the desk blank. */
  var noPick = '<p class="caption" style="margin:8px 0 0">No pick from either club and this game is played on <b>'+esc(CG.DEFAULT_SERVER)+'</b>.</p>';
  if (CG.now() >= lockAt){
    var srv = (CG.lg._servers||{})[game.id];
    return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="lock">'+CG.ic("lock",13)+'Picks locked</span>'+
      '<span class="small">Server: <b style="font-family:var(--f-disp)">'+(srv?esc(srv):"resolving…")+'</b></span></div>';
  }
  if (home){
    return '<div class="grid g2" style="gap:12px">'+
      '<label class="fld" style="margin:0"><span>1st choice · home</span><select class="srv-sel" data-veto-game="'+game.id+'" data-veto-field="pref1">'+opts(mine.pref1)+'</select></label>'+
      '<label class="fld" style="margin:0"><span>2nd choice</span><select class="srv-sel" data-veto-game="'+game.id+'" data-veto-field="pref2">'+opts(mine.pref2)+'</select></label></div>'+
      (mine.pref1 ? "" : noPick);
  }
  return '<div class="grid g2" style="gap:12px">'+
    '<label class="fld" style="margin:0"><span>Veto — won’t play</span><select class="srv-sel" data-veto-game="'+game.id+'" data-veto-field="veto">'+opts(mine.veto)+'</select></label>'+
    '<label class="fld" style="margin:0"><span>Preferred</span><select class="srv-sel" data-veto-game="'+game.id+'" data-veto-field="preferred">'+opts(mine.preferred)+'</select></label></div>'+
    ((mine.veto||mine.preferred) ? "" : noPick);
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
  var oppv = g.home===club ? g.away : g.home;
  CG.mgmtQueue("schedule_pick", { game_id:gameId, veto:rec.veto||null, preferred:rec.preferred||null, pref1:rec.pref1||null, pref2:rec.pref2||null },
    (g.home===club?"set the server choices":"set the server veto and preference")+" vs "+((CG.TEAM[oppv]||{}).name||oppv||"?")+(g.at?" · "+CG.fmtDay(g.at):"")).then(function(q){ if (q) return;
  CG.sb.from("game_vetoes").upsert(rec,{onConflict:"game_id,team_id"}).then(function(r){
    if(r.error){ CG.toast(/lock/i.test(r.error.message||"")?"Picks are locked":"Couldn’t save: "+r.error.message,"err"); return; }
    CG.lg._vetoes = CG.lg._vetoes||{}; CG.lg._vetoes[gameId] = Object.assign({}, CG.lg._vetoes[gameId]||{}, rec);
    CG.toast(g.home===club?"1st & 2nd choices saved":"Veto & preferred saved","ok");
  });
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
  /* v3.05 (commissioner): the lock PUBLISHES the sheet to the opponent so they can roughly see
     who they face. It does not close it. A club may still switch a player right up to puck drop,
     free, provided he is on the roster or in the camp and plays his own position (Rule 5.3), which
     the database checks on every filing. Editing stops only once the game is genuinely under way,
     which is the same instant set_game_lineup stops accepting one. */
  var shut = CG.emergencyClosed(game);          /* the game is under way: the box score is the record */
  var locked = shut;
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
    /* v2.95: "Per-game adjustments" described the mechanism, not the job. This page IS a club's
       lineup for one game, so it is named that on the page and in the nav. */
    '<h1 class="h-sec" style="margin-top:8px">Game lineup'+nightSwitch+'</h1>'+
    (game.stage==="preseason" ? '<div class="note" style="margin-top:10px"><b style="font-family:var(--f-disp)">Pre-season game.</b> No weekly caps, and your Owner, GM and AGM can be dressed at any position — get as many players into games as you can (Rules 0.4 and 5.2).</div>' : '')+
    '<p class="lede" style="margin-top:8px">One game, one lineup. Day-to-day lines live in the <a href="#/hub/lines" style="font-weight:700;border-bottom:2px solid var(--chrome)">Lineup builder</a>, this page adjusts a single night. At '+CG.fmtTime(lockAt)+' the sheet is published to your opponent, and you can still change it after that, free, right up to puck drop (Rule 5.3).</p></div>';
  /* the night plan reaching the real game: when this night has a planned line, offer it as a
     one-click fill. Fill only — submitting stays an explicit second step. */
  var planSlot = (lg._linePlan||{})[CG.gameNight(game)];
  var planRow = planSlot && (lg._teamLines||{})[planSlot];
  var editControls = (planRow ? '<button class="btn btn-ghost btn-sm" id="luFromPlan" data-plan-slot="'+planSlot+'" title="Fill the slots from the line planned for this night in the Lineup builder">Fill from '+esc(planRow.name||("Line "+planSlot))+'</button>' : "")+
    '<button class="btn btn-ghost btn-sm" id="luAuto">Auto-fill best available</button>'+
    '<button class="btn btn-ghost btn-sm" id="luClear">Clear</button>'+
    (function(){
      /* "Set for the whole night" — one submit dresses every not-yet-locked game of this night with
         the same six. Pre-lock only; each game still runs the weekly-cap + suspension checks. */
      var nightGs = CG.nightGames(club, CG.gameNight(game));
      if (shut || nightGs.length < 2) return "";
      return '<label class="chk" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer" '+
        'title="Submit these six for all '+nightGs.length+' of tonight\u2019s games at once">'+
        '<input type="checkbox" id="luWholeNight"> whole night ('+nightGs.length+' games)</label>';
    })()+
    /* v2.85: withdraw the sheet. Nothing could unfile a game before, so a club that had filled its
       week had no way to give a player his games back short of finding a replacement with room. */
    (dbLu && !rawLocked ? '<button class="btn btn-ghost btn-sm" id="luRemove" title="Withdraw this sheet: the six come off this game and get the game back in their week (Rule 5.2)">Remove lineup</button>' : "")+
    '<button class="btn btn-chrome btn-sm" id="luSubmit">'+(status==="submitted"?"Resubmit":"Submit lineup")+'</button>';
  var bar = '<div class="note '+(shut?"":(status==="submitted"?"grn":"chr"))+'" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:18px">'+
    '<b style="font-family:var(--f-disp)">Status: '+(shut?"Game under way":(rawLocked?"Published":status))+'</b>'+
    (rawLocked&&!shut?'<span class="caption">your opponent can see this sheet since '+CG.fmtTime(lockAt)+'</span>'
      :(saved&&saved.at?'<span class="caption">last saved '+CG.fmtFull(saved.at)+'</span>':""))+
    '<span style="margin-left:auto;display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end;min-width:0">'+
    (shut ? '<span class="lock">'+CG.ic("lock",14)+'Closed</span><span class="caption">The game is under way. Who actually played is read from the box score (Rule 5.3).</span>'
          : editControls)+
    '</span></div>'+
    (rawLocked && !shut
      ? '<div class="note" style="margin-bottom:18px;font-size:13px;line-height:1.5">This sheet is <b>published</b>: your opponent can see roughly who they face. You can still change it right up to puck drop at <b>no cost</b>, as long as the player you bring in is on your roster or in your camp and plays his own position (Rule 5.3). Your opponent is told when you do, so the lineup they are looking at stays the current one.</div>'
      : "");
  var rink = '<div class="rink"><div class="rk-rows">'+
    '<div class="rk-line">'+["LW","C","RW"].map(function(pos){ return CG.luSlot(pos, slots[pos], locked); }).join("")+'</div>'+
    '<div class="rk-line d2">'+["LD","RD"].map(function(pos){ return CG.luSlot(pos, slots[pos], locked); }).join("")+'</div>'+
    '<div class="rk-line g1">'+CG.luSlot("G", slots.G, locked)+'</div>'+
  '</div></div>';
  var bench = '<div class="card"><div class="card-h"><h3>Bench — '+esc(CG.TEAM[club].name)+'</h3><span class="chip">'+roster.length+' rostered</span></div>'+
    /* v3.12 — rink order; this was alphabetical by position string too (see the availability grid) */
    '<div class="card-b bench">'+roster.slice().sort(function(a,b){ return (CG.isCamp(a)?1:0)-(CG.isCamp(b)?1:0) || (CG.POS_RANK[a.pos]||99)-(CG.POS_RANK[b.pos]||99)||a.depth-b.depth; }).map(function(p, i, arr){
      var av = CG.avFor(p.id);
      /* v2.72: camp players sit in their own group at the end of the bench */
      var groupHead = (i===0 && !CG.isCamp(p) && arr.some(CG.isCamp)) ? '<div class="bench-h">Active roster</div>' : (CG.isCamp(p) && (i===0 || !CG.isCamp(arr[i-1]))) ? '<div class="bench-h">Training camp · any position · 3 a week</div>' : "";
      var avKey = CG.nightAvKey(game);   /* the availability night this game falls on */
      /* v2.44: the answer for THIS game (a legacy per-night answer still counts for every game that night) */
      /* v2.76: availability is management's information, not a gate. A player who marked himself
         out (or never answered) can still be dressed; the chip says what he told you. */
      var avv = avKey && CG.avGame ? CG.avGame(av, avKey, game.id) : "nr";
      var un = avv === "no", noAns = !avKey || avv === "nr";
      var used = assigned.indexOf(p.id)>=0;
      var dis = suspended[p.id];
      var reason = dis ? "Suspended (Rule 7.4)" : un ? "Marked not available for this game; you may still dress him" : noAns ? "No availability answer for this game" : "";
      return groupHead + '<div class="bp'+(used?" dis":"")+(dis?" dis":"")+(un?" warn":"")+'" data-bench="'+p.id+'" draggable="'+(!locked&&!used&&!dis)+'" '+(reason?'title="'+esc(reason)+'"':"")+'>'+
        CG.crest(p.team,20)+'<b style="font-size:13px">'+esc(p.tag)+'</b><span class="mono" style="font-size:10px;color:var(--steel)">'+p.pos+'</span>'+(CG.isCamp(p)?CG.campChip("xs"):"")+
        (dis?'<span class="chip chip-loss" style="font-size:9px">SUSP</span>':un?'<span class="chip chip-warn" style="font-size:9px">UNAVAIL</span>':noAns?'<span class="chip chip-ink" style="font-size:9px">NO ANSWER</span>':used?'<span class="chip chip-win" style="font-size:9px">IN</span>':"")+
        '<span class="bp-meta">OVR '+lg.ratings[p.id].ovr+'</span></div>';
    }).join("")+'</div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption" id="luMsg">Assignments validate position, suspension, the weekly cap and duplicates. Availability is shown as a guide, not a gate: you may dress anyone on the roster, and a player marked out is flagged when you place him.</span></div></div>';
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
    (p?'<div class="sl-name">'+esc(p.tag)+'</div><div class="sl-sub">OVR '+CG.lg.ratings[p.id].ovr+(locked?' · locked':' · tap to clear')+'</div>'
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
  /* v3.05: the only moment the sheet stops being editable is when the game is genuinely under way.
     The 30-minute lock publishes it to the opponent; it no longer closes it. */
  function isLocked(){ return CG.emergencyClosed(game); }
  function msg(t, bad){ var el=$("#luMsg"); if (el){ el.textContent=t; el.style.color = bad?"var(--red)":"var(--steel)"; } }
  function save(what, status){
    state.at = CG.now();
    if (status) state.status = status;
    state.rev = (state.rev||[]).concat([{at:CG.now(), what:what}]).slice(-6);
    store[key]=state; CG.store.set("lineups", store);
    CG.router();
  }
  /* Rule 2.1 — position groups are binding, but a training-camp player fills any slot, and in a
     PRE-SEASON game so does the club's Owner, GM or AGM (v2.39: get as many players scheduled as
     possible). The database makes the same test (lineup_slot_ok). */
  var preGame = game.stage==="preseason";
  function flex(p){ return p.squad==="tc" || (preGame && !!p.mgmt); }
  /* v2.76: what the player told the club about THIS game — information for management, never a gate */
  function avState(p){ var nk = CG.nightAvKey(game); return (nk && CG.avGame) ? CG.avGame(CG.avFor(p.id), nk, game.id) : "nr"; }
  function avWarn(p){ return avState(p)==="no" ? p.tag+" is marked not available for this game (dressed anyway; check that he can play)." : null; }
  function validate(p, pos){
    if (isLocked()) return "This game is under way, so the sheet is closed. Who actually played is read from the box score (Rule 5.3).";
    if (!flex(p) && CG.posGroup(p.pos)!==CG.posGroup(pos))
      return p.tag+" is a "+(CG.POS_NAME[p.pos]||p.pos)+" — this slot needs a "+CG.POS_NAME[pos]+". Only training-camp players"+(preGame?" and, in the pre-season, the Owner, GM and AGM":"")+" fill any position (Rule 2.1).";
    if (lg.suspensions.some(function(s){ return s.playerId===p.id && s.status!=="served"; })) return p.tag+" is suspended and cannot be assigned (Rule 7.4).";
    /* v2.76: a player marked out is dressable; avWarn() names him when he is placed */
    if (Object.values(state.slots).indexOf(p.id)>=0) return p.tag+" is already in the lineup.";
    /* Rule 5.2 (v2.55): stop the assignment at the cap, the way the database will — the count is
       played games by the box score plus games still to come by the filed lineup */
    var cap = CG.gameCapFor(p, game), used = CG.weekGamesFor(p.id, game, club);
    if (used >= cap) return p.tag+" is at his "+(game.stage==="playoff"?"series":"weekly")+" limit: "+used+" of "+cap+" games already played or filed (Rule "+(game.stage==="playoff"?"8.3":"5.2")+"). Drop him from a game you have already dressed to free one.";
    return null;
  }
  function assign(pid, pos){
    var p = CG.playerById(lg, pid);
    var err = validate(p, pos);
    if (err){ msg(err, true); CG.toast(err, "err"); return; }
    state.slots[pos] = pid;
    save("Assigned "+p.tag+" to "+pos);
    var w = avWarn(p); if (w){ msg(w, true); CG.toast(w, "err"); }
  }
  document.querySelectorAll("[data-bench]").forEach(function(el){
    el.addEventListener("click", function(){
      if (el.classList.contains("dis")) { msg(el.getAttribute("title")||"That player can’t be assigned.", true); return; }
      sel = el.getAttribute("data-bench");
      $$(".bp").forEach(function(x){ x.classList.remove("sel"); });
      el.classList.add("sel");
      var p = CG.playerById(lg, sel);
      msg("Selected "+p.tag+" — now click "+(flex(p) ? "any slot ("+(p.squad==="tc" ? "camp players fill any position" : "management fills any position in the pre-season")+")" : "a "+CG.posGroup(p.pos)+" slot")+".");
      $$(".slot").forEach(function(s){ s.classList.toggle("target", flex(p) || CG.posGroup(s.getAttribute("data-slot"))===CG.posGroup(p.pos)); });
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
    var skipped = [], outs = [];
    state.slots = {};
    var pslots = CG.lineFromRow(prow);
    ["LW","C","RW","LD","RD","G"].forEach(function(pos){
      var pid = pslots[pos]; if (!pid) return;
      var p = CG.playerById(lg, pid);
      var why = p ? validate(p, pos) : "no longer rostered";
      if (why){ skipped.push((p?p.tag:"a player")+" ("+why+")"); return; }
      if (p && avWarn(p)) outs.push(p.tag);
      state.slots[pos] = pid;
    });
    save("Filled from "+(prow.name||("Line "+pslot)));
    if (skipped.length) CG.toast("Filled, except: "+skipped.join("; "),"err");
    else if (outs.length) CG.toast("Filled from "+(prow.name||("Line "+pslot))+". Marked not available for this game: "+outs.join(", ")+" (dressed anyway; check they can play)","err");
    else CG.toast("Filled from "+(prow.name||("Line "+pslot))+" — review and submit","ok");
  });
  var auto = $("#luAuto");
  if (auto) auto.addEventListener("click", function(){
    if (isLocked()){ CG.toast("Lineup is locked (Rule 5.3)","err"); return; }
    ["LW","C","RW","LD","RD","G"].forEach(function(pos){
      /* group-based eligibility (matches the DB); camp players — and, in a pre-season game,
         management — are eligible anywhere. Order: a rostered player at his own position first
         (Rule 5.2 — rostered players are preferred over camp players wherever one is available),
         then a rostered manager borrowed from another group (pre-season), then camp players —
         in-group before out-of-group — so auto-fill spends a camp player's three games last. */
      /* v2.76: availability ranks first (said yes, then no answer, then marked out), so the helper
         reaches for a player who told you he cannot play only when nobody else fits */
      var rank = function(p){ var a = avState(p); return (a==="no"?8:a==="nr"?4:0) + (p.squad==="tc"?2:0) + (CG.posGroup(p.pos)!==CG.posGroup(pos)?1:0); };
      var pick = lg.byTeam[club].filter(function(p){ return flex(p) || CG.posGroup(p.pos)===CG.posGroup(pos); })
        .sort(function(a,b){
          var ac=rank(a), bc=rank(b);
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
  var rm = $("#luRemove");
  if (rm) rm.addEventListener("click", function(){
    CG.confirm("Withdraw this lineup?",
      "The six come off this game. Each of them gets this game back in his week (Rule 5.2), so you can dress him somewhere else. "+
      "The game is then unfiled: file a lineup again before it locks at "+CG.fmtTime(game.at-30*60000)+", or the club plays with no sheet of record (Rule 3.2).",
      "Withdraw", function(){
      if (!CG.LIVE_MODE || !CG.sb){ CG.toast("Not connected, reload and retry","err"); return; }
      rm.disabled = true;
      CG.sb.rpc("clear_game_lineup", { p_game: game.id, p_team: (lg._codeToId||{})[club] }).then(function(r){
        rm.disabled = false;
        if (r.error){ CG.toast(r.error.message, "err"); return; }
        /* clear BOTH records of it: what the league has on file and this browser's own draft */
        if (lg._lineups) delete lg._lineups[club+":"+game.id];
        var st = CG.store.get("lineups")||{}; delete st[key]; CG.store.set("lineups", st);
        CG.toast(r.data === false ? "There was no lineup on file for this game" : "Lineup withdrawn, the six have this game back in their week", "ok");
        CG.router();
      });
    });
  });
  var sub = $("#luSubmit");
  if (sub) sub.addEventListener("click", function(){
    var pastLock = CG.now() >= game.at - 30*60000;
    /* v3.05: a late change is free. The one moment the sheet closes is when the game is under way,
       which is also when set_game_lineup stops accepting one; say so here rather than let the RPC
       answer with a refusal the club cannot read. */
    if (CG.emergencyClosed(game)){ CG.toast("This game is under way, so the sheet is closed. The box score is the record (Rule 5.3).","err"); return; }
    var missing = ["LW","C","RW","LD","RD","G"].filter(function(pos){ return !state.slots[pos]; });
    if (missing.length){ CG.toast("Fill every slot first, missing "+missing.join(", "), "err"); return; }
    var emg = pastLock;   /* a change after the sheet was published: free, but the opponent is told */
    CG.confirm(emg?"Change your published lineup?":"Submit this lineup?",
      emg?"Your opponent can already see this sheet, so they are told what changed. There is no cost, as long as the player you bring in is on your roster or in your camp and plays his own position (Rule 5.3)."
         :"Your six starters go to the league office and are published to the opponent when the sheet locks, 30 minutes before puck drop. You can change it after that too, right up to puck drop.",
      emg?"Save the change":"Submit lineup", function(){
      /* Do NOT claim it is submitted yet — the server may refuse (lock, suspension, roster
         shape). Keep the slots, leave the status alone, and only report success below when the
         RPC actually answers. A refused write used to leave a permanent green "submitted". */
      save(emg?"Saving the change…":"Sending lineup…");
      /* Persist through the server-enforced lock. set_game_lineup() rejects post-lock edits unless
         p_emergency is set, which only club management can do (Rule 5.3) — the lock is enforced in
         the database, so no client can bypass it. */
      if (CG.LIVE_MODE && CG.sb){
        var tid = (CG.lg._codeToId||{})[club];
        if (tid){
          var slots6 = { p_center:state.slots.C||null, p_lw:state.slots.LW||null, p_rw:state.slots.RW||null,
                         p_ld:state.slots.LD||null, p_rd:state.slots.RD||null, p_goalie:state.slots.G||null };
          /* the checkbox: submit to every not-yet-locked game of this night, not just this one.
             Emergency mode is inherently one game, so the checkbox is never shown there. */
          var wholeNight = !emg && !!(document.getElementById("luWholeNight") && document.getElementById("luWholeNight").checked);
          var targets = wholeNight
            ? CG.nightGames(club, CG.gameNight(game)).filter(function(g){ return CG.now() < g.at - 30*60000; })
            : [game];
          if (!targets.some(function(g){ return g.id===game.id; })) targets.unshift(game);
          /* v2.38: under "Owner approves" each game's lineup is queued for the Owner, not dressed */
          if (CG.mgmtAccess && CG.mgmtAccess("lines")==="approve"){
            var qN = 0, qFail = 0;
            (function qnext(i){
              if (i >= targets.length){
                save(qN ? "Sent to the Owner for approval" : "Not sent");
                if (qN) CG.toast("Sent "+qN+" lineup"+(qN===1?"":"s")+" to the Owner for approval — dressed when they approve"+(qFail?" ("+qFail+" could not be sent)":""),"ok");
                if (qN) CG.reloadLeague();
                return;
              }
              var g = targets[i], oppc = g.home===club ? g.away : g.home;
              CG.mgmtQueue("set_game_lineup", Object.assign({ p_game:g.id, p_emergency:(g.id===game.id?emg:false) }, slots6),
                (emg?"change the published lineup":"dress the lineup")+" vs "+((CG.TEAM[oppc]||{}).name||oppc)+" · "+CG.fmtDay(g.at)+" "+CG.fmtTime(g.at), { quiet:true })
                .then(function(q){ if (q===true) qN++; else if (q) qFail++; qnext(i+1); });
            })(0);
            return;
          }
          var okN = 0, errs = [];
          (function next(i){
            if (i >= targets.length){
              if (okN){
                /* only now is it true */
                save(emg?"Lineup change saved":"Lineup submitted to the league office","submitted");
                CG.pushNotif("check", emg?"Lineup change saved":"Lineup submitted",
                  "vs "+CG.TEAM[game.home===club?game.away:game.home].name+(emg?" — post-lock swap recorded.":" — locks "+CG.fmtTime(game.at-30*60000)+"."),"#/hub/lineup");
                CG.audit(emg?"Lineup changed after publication":"Lineup submitted",""+key);
              }
              if (errs.length) CG.toast((okN?("Dressed "+okN+"; "):"")+"refused: "+errs.join("; "),"err");
              else if (wholeNight) CG.toast("Submitted for all "+okN+" game"+(okN===1?"":"s")+" tonight","ok");
              else CG.toast(emg?"Lineup change saved":"Lineup submitted","ok");
              CG.renderChrome();
              return;
            }
            var g = targets[i];
            CG.sb.rpc("set_game_lineup", Object.assign({ p_game:g.id, p_team:tid, p_emergency:(g.id===game.id?emg:false) }, slots6)).then(function(r){
              if(r.error || !r.data){ errs.push(CG.fmtTime(g.at)+" — "+(r.error?r.error.message:"blocked by the server")); next(i+1); return; }
              var row = Array.isArray(r.data) ? r.data[0] : r.data;
              CG.lg._lineups = CG.lg._lineups||{}; CG.lg._lineups[club+":"+g.id] = row;
              if (g.id===game.id && row.penalties_owed > 0) CG.toast("This club now serves "+row.penalties_owed+" in-game penalt"+(row.penalties_owed===1?"y":"ies")+" in this game (Rule 5.3)","err");
              okN++; next(i+1);
            });
          })(0);
        }
      }
      /* success is reported from the RPC callback above — in demo mode (no Supabase) there is
         no server to answer, so report it here instead */
      if (!(CG.LIVE_MODE && CG.sb)){
        save(emg?"Lineup change saved":"Lineup submitted to the league office","submitted");
        CG.pushNotif("check", emg?"Lineup change saved":"Lineup submitted","vs "+CG.TEAM[game.home===club?game.away:game.home].name+(emg?" — post-lock swap recorded.":" — locks "+CG.fmtTime(game.at-30*60000)+"."),"#/hub/lineup");
        CG.audit(emg?"Lineup changed after publication":"Lineup submitted",""+key);
        CG.toast(emg?"Lineup change saved":"Lineup submitted","ok");
        CG.renderChrome();
      }
    });
  });
  /* v3.05: the emergency call-up toggle is gone with the penalty it existed to warn about. The
     sheet simply stays editable until the game is under way. */
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
/* v2.84: which of a night's games a line dresses. A night is up to three games and a club may
   want a line in only one or two of them, because the weekly cap (Rule 5.2) is spent per GAME and
   a six-game week does not divide evenly into three-game nights. Default is every open game, which
   is what the button always did; the selection lives on CG so a repaint does not lose it. */
/* v2.89: the line ONE game dresses. Its own plan wins; otherwise the night's default stands, which
   is what a club that runs the same six all night never has to think about. A club may now put a
   different line in each of a night's three games. */
/* v2.95: the week's availability, one mark per night, for a player card in the line creator.
   A manager builds lines here and had to leave for the Availability page to see who said no.
   Aggregates each night's games the way the grid's night summary does: all yes, all no, mixed,
   or no answer. Returns "" when there is no game week to answer for. */
CG.lcAvStrip = function(club, p){
  var nights = (CG.WEEK8 && CG.WEEK8.open && CG.WEEK8.nights) || [];
  if (!nights.length || !CG.avFor) return "";
  var av = CG.avFor(p.id);
  var out = nights.map(function(n){
    var games = CG.clubGamesOnNight ? CG.clubGamesOnNight(club, n) : [];
    var vals = games.map(function(g){ return CG.avGame ? CG.avGame(av, n.key, g.id) : "nr"; });
    if (!vals.length) vals = [ (av.nights[n.key] && av.nights[n.key].st) || "nr" ];
    var yes = vals.filter(function(v){ return v === "yes"; }).length;
    var no  = vals.filter(function(v){ return v === "no"; }).length;
    var st  = (yes === vals.length) ? "yes" : (no === vals.length) ? "no" : (yes || no) ? "mb" : "nr";
    var mark = st === "yes" ? "\u2713" : st === "no" ? "\u2717" : st === "mb" ? "\u00b7" : "\u2014";
    var lab = (CG.NIGHT_LABEL[n.key] || n.key).slice(0, 3);
    return '<span class="avcell '+st+'" title="'+esc(lab)+': '+
      (st==="yes" ? "available for every game" : st==="no" ? "not available" : st==="mb" ? yes+" of "+vals.length+" games" : "no answer")+
      '">'+mark+'</span>';
  }).join("");
  return '<span class="lc-av-strip" title="This week\u2019s availability, one mark per night">'+out+'</span>';
};
CG.lcGameSlot = function(club, nightKey, gameId){
  var lg = CG.lg || {};
  var own = (lg._gameLinePlan || {})[gameId];
  if (own != null) return own;
  var pl = (lg._linePlan || {})[nightKey];
  return pl != null ? pl : null;
};
/* the DISTINCT lines a night is set to dress, in game order, for the night's summary chip */
CG.lcNightSlots = function(club, nightKey){
  return CG.lcOpenGames(club, nightKey).map(function(g){ return CG.lcGameSlot(club, nightKey, g.id); });
};
/* v2.90: the per-game selects are behind a toggle. Four selects on every night row was a wall,
   and most clubs dress one line a night and never need them. A night that ALREADY runs more than
   one line opens itself, or its own state would be hidden behind a button. */
CG.lcPerGameOpen = function(club, nightKey){
  var st = (CG._lcOpenNights || {})[nightKey];
  if (st != null) return !!st;
  var slots = CG.lcNightSlots(club, nightKey).filter(function(x){ return x != null; });
  return [...new Set(slots)].length > 1;
};
CG.lcTogglePerGame = function(club, nightKey){
  CG._lcOpenNights = CG._lcOpenNights || {};
  CG._lcOpenNights[nightKey] = !CG.lcPerGameOpen(club, nightKey);
  return CG._lcOpenNights[nightKey];
};
CG.lcOpenGames = function(club, nightKey){
  return CG.nightGames(club, nightKey).filter(function(g){ return CG.now() < g.at - 30*60000; });
};
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
    '<p class="lede" style="margin-top:8px">Three lines — one per game night — and the whole roster. '+((window.matchMedia&&matchMedia("(pointer:coarse)").matches)?'Tap a player, then tap the slot to put him there — tap a filled slot to swap':'Drag a player onto any slot, or between slots to swap')+'; point each night at a line, then dress the week in one click. Every dressing still runs through the league’s checks.</p></div>';

  var bar = '<div class="note '+(dirtyN?"chr":"grn")+'" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:18px">'+
    '<b style="font-family:var(--f-disp)">'+(dirtyN?dirtyN+" line"+(dirtyN===1?"":"s")+" with unsaved changes":"All lines saved")+'</b>'+
    '<span class="caption" style="flex:1;min-width:200px">Names edit in place. A player may sit on more than one line — the weekly limits are checked when a lineup is actually dressed.'+
    ((CG.preseasonOnlyAhead && CG.preseasonOnlyAhead(club)) ? ' <b>Pre-season:</b> your Owner, GM and AGM may sit at any position on a line; a line carrying one out of position dresses in pre-season games only (Rule 5.2).' : '')+'</span>'+
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
        /* v2.95: the same anatomy as the per-game page's slot — the position always labelled,
           then the name, then the rating. The avatar competed with the name in a 6-across grid
           and the position was only implied by the column header. */
        '<span class="sl-pos">'+CG.POS_NAME[pos]+'</span>'+
        (pl ? '<span class="sl-name">'+esc(pl.tag)+'</span><span class="sl-sub">OVR '+lg.ratings[pid].ovr+(suspended[pid]?' · SUSP':'')+'</span>'
            : '<span class="sl-sub">Empty</span>')+'</div>';
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
  /* v2.83: the weekly load, shown BEFORE a line is built. The cap counts games a club has already
     FILED, not only games that have been played, so a club can spend a player's whole week on
     Friday and only find out when Wednesday is refused. Measured against the club's next game. */
  var wkRef = (CG.lineNights(club)[0] || {}).game || null;
  var loadOf = function(p){ return CG.weekLoad ? CG.weekLoad(p, club, wkRef) : null; };
  var capped = roster.filter(function(p){ var l = loadOf(p); return l && l.full; });
  var board = '<div class="card"><div class="card-h"><h3>Roster — '+esc(CG.TEAM[club].name)+'</h3><span class="chip">'+roster.length+' rostered</span>'+
    (capped.length ? '<span class="chip chip-loss" title="Rule 5.2: these players are dressed or have played in every game their week allows, counting the lineups you have already filed. Dressing them again is refused.">'+capped.length+' at the weekly limit</span>' : "")+'</div>'+
    (capped.length ? '<div class="card-b" style="border-bottom:1px solid var(--line-soft)"><span class="caption"><b>'+
      capped.map(function(p){ return esc(p.tag); }).join(", ")+'</b> '+(capped.length===1?"has":"have")+' no games left this week (Rule 5.2). '+
      'The count includes lineups you have already filed, not just games played, so swap '+(capped.length===1?"him":"them")+' out of a line before dressing a night '+
      (capped.length===1?"he":"they")+' cannot play.</span></div>' : "")+
    '<div class="card-b"><div class="lc-board">'+POS.map(function(pos){
      return '<div class="lc-col"><div class="lc-ch">'+CG.POS_NAME[pos]+'</div>'+
        (byPos[pos]||[]).map(function(p){
          var dis = suspended[p.id];
          return '<div class="lc-pc'+(dis?" dis":"")+'" data-rcard="'+p.id+'" draggable="'+(!dis)+'" tabindex="0" role="button" '+
            (dis?'title="Suspended (Rule 7.4)"':'')+' aria-label="'+esc(p.tag)+', '+CG.POS_NAME[p.pos]+'">'+
            CG.lcAv(p,34)+
            /* v2.91: the name owns the first row; position, line chips and the week load share the
               second. They used to compete for one line, so every name was cut to an initial and
               "GOALTENDER" was clipped mid-word. */
            '<span class="two"><b>'+esc(p.tag)+'</b><span class="ln2"><span class="ps">'+CG.POS_NAME[p.pos]+'</span>'+
              (memb[p.id]||[]).map(function(n){ return '<span class="lnc">L'+n+'</span>'; }).join("")+
              (dis?'<span class="chip chip-loss" style="font-size:9px">SUSP</span>':(CG.weekLoadChip?CG.weekLoadChip(loadOf(p),"xs"):""))+
              (CG.lcAvStrip?CG.lcAvStrip(club,p):"")+
              '</span></span>'+
            '<span class="ov">'+lg.ratings[p.id].ovr+'</span></div>';
        }).join("")+'</div>';
    }).join("")+'</div>'+
    (camp.length ? '<div class="lc-ch" style="margin-top:14px">Training camp — fills any position (Rule 2.1)</div>'+
      '<div class="lc-board" style="margin-top:8px">'+camp.map(function(p){
        var dis = suspended[p.id];
        return '<div class="lc-pc'+(dis?" dis":"")+'" data-rcard="'+p.id+'" draggable="'+(!dis)+'" tabindex="0" role="button" '+
          (dis?'title="Suspended (Rule 7.4)"':'')+' aria-label="'+esc(p.tag)+', training camp">'+
          CG.lcAv(p,34)+
          '<span class="two"><b>'+esc(p.tag)+'</b><span class="ln2"><span class="ps">Camp · '+CG.POS_NAME[p.pos]+'</span>'+
            (memb[p.id]||[]).map(function(n){ return '<span class="lnc">L'+n+'</span>'; }).join("")+
            (dis?'<span class="chip chip-loss" style="font-size:9px">SUSP</span>':(CG.weekLoadChip?CG.weekLoadChip(loadOf(p),"xs"):""))+
            (CG.lcAvStrip?CG.lcAvStrip(club,p):"")+
            '</span></span>'+
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
      var slotOf = {}; open.forEach(function(x){ slotOf[x.id] = CG.lcGameSlot(club, n.key, x.id); });
      var toDress = open.filter(function(x){ return slotOf[x.id] != null; });
      var distinct = [...new Set(toDress.map(function(x){ return slotOf[x.id]; }))];
      var perOpen = CG.lcPerGameOpen(club, n.key);
      var dressedN = games.filter(function(x){ return (lg._lineups||{})[club+":"+x.id]; }).length;
      var owed = games.reduce(function(a,x){ var d=(lg._lineups||{})[club+":"+x.id]; return a + (d && d.penalties_owed>0 ? d.penalties_owed : 0); }, 0);
      var opts = '<option value="">— none —</option>'+[1,2,3].map(function(s2){
        var r = (lg._teamLines||{})[s2];
        return '<option value="'+s2+'"'+(planned===s2?" selected":"")+(r?"":' disabled')+'>'+
          esc((r && r.name) ? r.name : "Line "+s2)+(r?"":" (empty)")+'</option>';
      }).join("");
      return '<div class="card-b lc-nrow" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span class="lc-nname"><b style="font-family:var(--f-disp)">'+(CG.NIGHT_LABEL[n.key]||n.key)+'</b>'+
          '<span class="caption" style="display:block">'+CG.fmtDate(g.at)+' · '+games.length+' game'+(games.length===1?"":"s")+' · vs '+esc(CG.TEAM[opp].name)+(games.length>1?" +":"")+'</span></span>'+
        '<label class="fld lc-all"><span>All '+(open.length||games.length)+'</span><select class="lc-night" data-night="'+n.key+'" title="Set every game of this night to one line. Open Per game to run a different line in one of them.">'+opts+'</select></label>'+

        (dressedN ? '<span class="chip chip-xs" title="Games with a submitted lineup">'+dressedN+' / '+games.length+' dressed</span>' : "")+
        /* v2.90: the per-game selects live behind this toggle. v2.89: one line per GAME, up to
           three a night; "— none —" leaves that game out of the dressing entirely and keeps
           whatever is already filed for it. */
        (open.length > 1 ? '<button type="button" class="btn btn-ghost btn-sm lc-pergame" data-night="'+n.key+'" aria-expanded="'+perOpen+'" '+
          'title="Set a different line for individual games of this night">'+CG.ic(perOpen?"up":"down",12)+'Per game'+
          (distinct.length > 1 ? ' · '+distinct.length+' lines' : '')+'</button>' : "")+
        (open.length && perOpen ? '<div class="lc-gsel">'+
          open.map(function(x){
            var gs = CG.lcGameSlot(club, n.key, x.id);
            return '<label class="fld"><span>'+CG.fmtTime(x.at).replace(" ET","")+'</span>'+
              '<select class="lc-gline" data-night="'+n.key+'" data-game="'+x.id+'">'+
              '<option value="">— none —</option>'+[1,2,3].map(function(sl){
                var r = (lg._teamLines||{})[sl];
                return '<option value="'+sl+'"'+(gs===sl?" selected":"")+(r?"":" disabled")+'>'+esc((r&&r.name)?r.name:("Line "+sl))+(r?"":" (empty)")+'</option>';
              }).join("")+'</select></label>';
          }).join("")+'</div>' : "")+
        /* v3.05: a change after publication costs nothing, so there is no debt to display. */
        (prow
          ? (open.length
              ? '<button class="btn btn-ghost btn-sm lc-dress"'+(toDress.length?"":" disabled")+' data-night="'+n.key+'" title="'+
                  (toDress.length ? 'Submit each game with the line set for it'+(distinct.length>1?' ('+distinct.length+' different lines tonight)':'') : 'Set a line on at least one game')+'">'+
                  (dressedN?"Redress":"Dress")+' '+toDress.length+' game'+(toDress.length===1?"":"s")+'</button>'+
                (dressedN ? '<button class="btn btn-ghost btn-sm lc-clear" data-night="'+n.key+'" title="Withdraw the filed sheets for this night\u2019s games. Everyone on them gets those games back in his week (Rule 5.2).">Clear '+open.length+'</button>' : "")
              : '<span class="lock" title="Every game this night is published to the opponent">'+CG.ic("lock",13)+'Published</span>'+
                '<a class="btn btn-ghost btn-sm" href="#/hub/lineup?game='+games[games.length-1].id+'" title="Change a published sheet: free, up to puck drop (Rule 5.3)">Change a sheet</a>')
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
    if (host){
      /* The board is an 880px grid inside a horizontal scroller. Replacing the node reset that
         scroll to 0, so on a phone every single assignment threw the manager back to the leftmost
         column and he had to scroll out to his position again — six times per line. */
      var prev = document.querySelector(".lc-wrap");
      var x = prev ? prev.scrollLeft : 0;
      host.outerHTML = CG.hubLines({});
      CG.AFTER._lines({});
      if (x){ var now = document.querySelector(".lc-wrap"); if (now) now.scrollLeft = x; }
    }
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
  /* a goaltender's weekly cap in NIGHTS: six games is two lines (full format), three games is one
     line (basic format) — a line beyond that is always a mistake (mirrors set_team_line's check) */
  function goalieCapped(pid, pos, line){
    if (pos!=="G") return null;
    /* no weekly cap in the full format's pre-season (Rule 5.2, v2.28), so a goaltender may cover
       every line — the client must not refuse what set_game_lineup now allows */
    if (CG.preseasonOnlyAhead && CG.preseasonOnlyAhead(club)) return null;
    var gMax = Math.max(1, Math.floor(CG.weeklyCap({ pos:"G" }) / 3));
    if (gLines(pid, line) >= gMax){
      var p = CG.playerById(lg, pid);
      return (p?p.tag:"That goaltender")+" already backstops "+(gMax===1?"a line":gMax+" lines")+" — a goaltender's "+CG.weeklyCap({ pos:"G" })+"-game week is "+(gMax===1?"one night":gMax+" nights")+" (Rule 5.2).";
    }
    return null;
  }
  function draft(n){
    CG._lcDraft = CG._lcDraft||{};
    if (!CG._lcDraft[n]) CG._lcDraft[n] = CG.lineFromRow((lg._teamLines||{})[n]);
    return CG._lcDraft[n];
  }
  var preAhead = !!(CG.preseasonOnlyAhead && CG.preseasonOnlyAhead(club));
  function fits(pid, pos){
    var p = CG.playerById(lg, pid); if (!p) return "no longer rostered";
    /* Rule 2.1 groups, with the builder's training-camp exception: a camp player fills any slot —
       and while the club's next game is a pre-season game, so does its Owner, GM or AGM (v2.39).
       set_team_line makes the same test; dressing the line into a regular-season game is
       re-checked against that game. */
    if (p.squad!=="tc" && !(preAhead && p.mgmt)){
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
    /* v2.38: under "Owner approves" each changed line is queued for the Owner, not saved */
    if (CG.mgmtAccess && CG.mgmtAccess("lines")==="approve"){
      var qN = 0, qFail = 0, sentSlots = [];
      (function qnext(i){
        if (i >= dirty.length){
          saveAll.disabled = false;
          /* only the lines that were actually sent leave the draft; a refused one keeps its edits */
          sentSlots.forEach(function(n){ delete CG._lcDraft[n]; if (CG._lcName) delete CG._lcName[n]; });
          if (qN) CG.toast("Sent "+qN+" line"+(qN===1?"":"s")+" to the Owner for approval — saved when they approve"+(qFail?" ("+qFail+" could not be sent and stay unsaved here)":""),"ok");
          if (qN) CG.reloadLeague(); else repaint();
          return;
        }
        var n = dirty[i], d = CG._lcDraft[n] || {};
        var name = (CG._lcName && CG._lcName[n] != null) ? CG._lcName[n] : (((lg._teamLines||{})[n]||{}).name || "");
        CG.mgmtQueue("set_team_line", { p_season:CG.SEASON.id, p_slot:n, p_name:name||null, p_lw:d.LW||null, p_center:d.C||null, p_rw:d.RW||null, p_ld:d.LD||null, p_rd:d.RD||null, p_goalie:d.G||null },
          "save line "+n+(name?" (“"+name+"”)":""), { quiet:true }).then(function(q){ if (q===true){ qN++; sentSlots.push(n); } else if (q) qFail++; qnext(i+1); });
      })(0);
      return;
    }
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
      CG.mgmtQueue("set_team_line_night", { p_season:CG.SEASON.id, p_night:night, p_slot:slot },
        slot ? "dress "+((((lg._teamLines||{})[slot]||{}).name)||("Line "+slot))+" on "+(CG.NIGHT_LABEL[night]||night)+"s" : "clear the "+(CG.NIGHT_LABEL[night]||night)+" line plan").then(function(q){ if (q){ repaint(); return; }
      CG.sb.rpc("set_team_line_night", { p_season:CG.SEASON.id, p_team:tid, p_night:night, p_slot:slot }).then(function(r){
        if (r.error){ CG.toast("Couldn’t save the plan: "+r.error.message,"err"); repaint(); return; }
        lg._linePlan = lg._linePlan||{};
        if (slot) lg._linePlan[night] = slot; else delete lg._linePlan[night];
        /* v2.89: "All three" means all three. Any per-GAME override on this night is cleared, or
           the select would silently leave a game running a different line. */
        var overrides = CG.lcOpenGames(club, night).filter(function(g){ return (lg._gameLinePlan||{})[g.id] != null; });
        var after = function(){
          CG.toast(slot ? ((CG.NIGHT_LABEL[night]||night)+" dresses "+((((lg._teamLines||{})[slot]||{}).name)||("Line "+slot))+(overrides.length?" in every game":""))
                        : ((CG.NIGHT_LABEL[night]||night)+" plan cleared"),"ok");
          repaint();
        };
        if (!overrides.length){ after(); return; }
        (function next(i){
          if (i >= overrides.length){ after(); return; }
          CG.sb.rpc("set_team_game_line", { p_game: overrides[i].id, p_team: tid, p_slot: null }).then(function(){
            delete lg._gameLinePlan[overrides[i].id]; next(i+1);
          }, function(){ next(i+1); });
        })(0);
      });
      });
    });
  });
  /* one night's dressing, shared by the per-night button and Dress-the-week */
  function dressGame(gameId, slot, done){
    var row = (lg._teamLines||{})[slot]; if (!row || !tid){ done("no line"); return; }
    /* v2.38: under "Owner approves" the dressing is queued (done(null, "queued")) — never claimed dressed */
    var gq = (lg.schedule||[]).find(function(x){ return x.id===gameId; })||{}, oppq = gq.home===club ? gq.away : gq.home;
    CG.mgmtQueue("set_game_lineup", { p_game:gameId, p_center:row.center||null, p_lw:row.lw||null, p_rw:row.rw||null, p_ld:row.ld||null, p_rd:row.rd||null, p_goalie:row.goalie||null, p_emergency:false },
      "dress "+(row.name||("Line "+slot))+" vs "+((CG.TEAM[oppq]||{}).name||oppq||"?")+(gq.at?" · "+CG.fmtDay(gq.at)+" "+CG.fmtTime(gq.at):""), { quiet:true }).then(function(q){
      if (q===true){ done(null, "queued"); return; }
      if (q){ done("could not be sent to the Owner"); return; }
    CG.sb.rpc("set_game_lineup", { p_game:gameId, p_team:tid,
      p_center:row.center||null, p_lw:row.lw||null, p_rw:row.rw||null,
      p_ld:row.ld||null, p_rd:row.rd||null, p_goalie:row.goalie||null, p_emergency:false
    }).then(function(r){
      if (r.error || !r.data){ done(r.error ? r.error.message : "blocked by the server"); return; }
      var lrow = Array.isArray(r.data) ? r.data[0] : r.data;
      lg._lineups = lg._lineups||{}; lg._lineups[club+":"+gameId] = lrow;
      done(null);
    });
    });
  }
  /* dress EVERY not-yet-locked game of a night with one line, in sequence. This is the fix: a
     night has up to three games and each must get its own lineup row, or games 2 and 3 go
     undressed. Refusals are collected per game and reported; the rest still land. */
  function dressNight(nightKey, slot, done){
    /* v2.89: EACH GAME with its own line. A night is up to three games and a club may run a
       different six in each; a game left on "— none —" is skipped and keeps what is already
       filed for it. `slot` is ignored now: the plan itself says what each game dresses. */
    var games = CG.lcOpenGames(club, nightKey).filter(function(g){ return CG.lcGameSlot(club, nightKey, g.id) != null; });
    if (!games.length){ done(CG.lcOpenGames(club, nightKey).length ? "no line set on any game this night" : "every game this night has locked", 0); return; }
    var okN = 0, qN = 0, errs = [];
    (function next(i){
      if (i >= games.length){
        /* v2.83: one line per REASON, not per game. Three games refused for the same player used
           to print the same sentence three times, and a week printed it nine. */
        var byMsg = {}, order = [];
        errs.forEach(function(e){ if (!byMsg[e.err]){ byMsg[e.err] = []; order.push(e.err); } byMsg[e.err].push(CG.fmtTime(e.at)); });
        var lines = order.map(function(m){ return byMsg[m].length+" game"+(byMsg[m].length===1?"":"s")+" ("+byMsg[m].join(", ")+"): "+m; });
        done(lines.length ? lines.join(" · ") : null, okN, qN);
        return;
      }
      dressGame(games[i].id, CG.lcGameSlot(club, nightKey, games[i].id), function(err, queued){
        if (err) errs.push({ at: games[i].at, err: err }); else if (queued) qN++; else okN++;
        next(i+1);
      });
    })(0);
  }
  var dressWeek = $("#lcDressWeek");
  if (dressWeek) dressWeek.addEventListener("click", function(){
    if (!CG.LIVE_MODE || !CG.sb || !tid || !CG.SEASON || !CG.SEASON.id){ CG.toast("Not connected — reload and retry","err"); return; }
    var jobs = CG.lineNights(club).filter(function(n){
      /* v2.89: a night qualifies when ANY of its open games has a line set, whether that came from
         the night's default or from a per-game override */
      return CG.lcOpenGames(club, n.key).some(function(g){
        var sl = CG.lcGameSlot(club, n.key, g.id);
        return sl != null && (lg._teamLines||{})[sl];
      });
    });
    /* v2.84 ORDER MATTERS. The weekly cap counts what is FILED right now, so a club moving a
       player from Thursday to Wednesday used to be refused: nights ran in clock order, Wednesday
       was submitted while he was still filed in Thursday and Friday, and the game that would have
       freed him came second. Nights that give players back now go first, so a straight swap
       between two nights lands in one press instead of needing two in the right order. */
    var sixFor = function(nk, gid){
      var line = (lg._teamLines||{})[CG.lcGameSlot(club, nk, gid)] || null;
      return line ? ["center","lw","rw","ld","rd","goalie"].map(function(k){ return line[k]; }).filter(Boolean) : null;
    };
    var netOf = function(n){
      return CG.lcOpenGames(club, n.key).reduce(function(acc, g){
        var six = sixFor(n.key, g.id); if (!six) return acc;
        var lu = (lg._lineups||{})[club+":"+g.id];
        var on = lu ? [lu.center,lu.lw,lu.rw,lu.ld,lu.rd,lu.goalie].filter(Boolean) : [];
        var adds = six.filter(function(pid){ return on.indexOf(pid) < 0; }).length;
        var drops = on.filter(function(pid){ return six.indexOf(pid) < 0; }).length;
        return acc + adds - drops;
      }, 0);
    };
    jobs.sort(function(a, b){ return netOf(a) - netOf(b) || a.game.at - b.game.at; });
    /* v2.83 PRE-FLIGHT: say which nights the weekly cap will refuse, and for whom, BEFORE the
       button is pressed. The count includes lineups already filed (Rule 5.2), so a manager can
       spend a player's week on one night and be refused on another with no warning at all; this
       walks the plan, simulates the nights in order, and names the conflict in the confirm. */
    var wkRefD = (CG.lineNights(club)[0] || {}).game || null;
    var used = {}, conflicts = [];
    var loadOfPid = function(pid){
      if (used[pid] == null) used[pid] = (wkRefD ? CG.weekUsedFor(pid, club, wkRefD) : 0) || 0;
      return used[pid];
    };
    jobs.forEach(function(n){
      /* a redress GIVES BACK every game it takes a player out of, so count the drops before the
         adds or a straight swap reads as a conflict that never happens */
      var adds = {}, drops = {};
      CG.lcOpenGames(club, n.key).forEach(function(g){
        var six = sixFor(n.key, g.id); if (!six) return;
        var lu = (lg._lineups||{})[club+":"+g.id];
        var on = lu ? [lu.center,lu.lw,lu.rw,lu.ld,lu.rd,lu.goalie].filter(Boolean) : [];
        six.forEach(function(pid){ if (on.indexOf(pid) < 0) adds[pid] = (adds[pid]||0) + 1; });
        on.forEach(function(pid){ if (six.indexOf(pid) < 0) drops[pid] = (drops[pid]||0) + 1; });
      });
      Object.keys(drops).forEach(function(pid){ used[pid] = Math.max(0, loadOfPid(pid) - drops[pid]); });
      Object.keys(adds).forEach(function(pid){
        var p = CG.playerById(lg, pid); if (!p || !wkRefD) return;
        var cap = CG.gameCapFor(p, wkRefD), have = loadOfPid(pid), add = adds[pid];
        if (have + add > cap){
          conflicts.push({ night: (CG.NIGHT_LABEL[n.key]||n.key), tag: p.tag, left: Math.max(0, cap - have), need: add, cap: cap, used: have });
        }
        used[pid] = Math.min(cap, have + add);
      });
    });
    CG.confirm("Dress the week: "+jobs.length+" night"+(jobs.length===1?"":"s")+"?",
      jobs.map(function(n){
        var names = [...new Set(CG.lcOpenGames(club, n.key).map(function(g){ return CG.lcGameSlot(club, n.key, g.id); })
          .filter(function(sl){ return sl != null; })
          .map(function(sl){ return (((lg._teamLines||{})[sl]||{}).name) || ("Line "+sl); }))];
        return (CG.NIGHT_LABEL[n.key]||n.key)+": "+names.join(" + ");
      }).join(" · ")+
      ". Each dressing runs through the league’s checks; anything refused is reported by night and the rest still land. Redress any night to adjust before its lock."+
      (conflicts.length ? "\n\nThe weekly limit (Rule 5.2) will refuse some of this: "+conflicts.map(function(c){
        return c.tag+" on "+c.night+" ("+c.used+" of "+c.cap+" games already filed or played, "+(c.left?("room for only "+c.left+" more"):"none left")+")";
      }).join("; ")+". Change those lines first, or dress the rest and fix them after." : ""),
      "Dress the week", function(){
      dressWeek.disabled = true;
      var okN = 0, qN = 0, errs = [];
      (function next(i){
        if (i >= jobs.length){
          dressWeek.disabled = false;
          if (qN && !okN && !errs.length){ CG.toast("Sent "+qN+" lineup"+(qN===1?"":"s")+" to the Owner for approval — dressed when they approve","ok"); CG.reloadLeague(); return; }
          if (errs.length) CG.toast("Dressed "+okN+" game"+(okN===1?"":"s")+(qN?", sent "+qN+" for approval":"")+", refused: "+errs.join("; "),"err");
          else CG.toast("Week dressed — "+okN+" game"+(okN===1?"":"s")+(qN?" ("+qN+" sent to the Owner)":"")+". Adjust any single game in the per-game builder before its lock.","ok");
          repaint(); return;
        }
        var n = jobs[i];
        dressNight(n.key, null, function(err, dressed, queued){
          if (err) errs.push((CG.NIGHT_LABEL[n.key]||n.key)+" — "+err);
          okN += dressed; qN += (queued||0);
          next(i+1);
        });
      })(0);
    });
  });
  document.querySelectorAll(".lc-clear").forEach(function(el){
    el.addEventListener("click", function(){
      var night = el.dataset.night, picks = CG.lcOpenGames(club, night);
      if (!picks.length) return;
      CG.confirm("Withdraw "+picks.length+" sheet"+(picks.length===1?"":"s")+"?",
        (CG.NIGHT_LABEL[night]||night)+": "+picks.map(function(g){ return CG.fmtTime(g.at); }).join(", ")+
        ". Everyone on those sheets gets those games back in his week (Rule 5.2), so you can dress him elsewhere. "+
        "The games are then unfiled: dress them again before they lock (Rule 3.2).",
        "Withdraw", function(){
        if (!CG.LIVE_MODE || !CG.sb || !tid){ CG.toast("Not connected, reload and retry","err"); return; }
        el.disabled = true;
        var n = 0, errs = [];
        (function next(i){
          if (i >= picks.length){
            el.disabled = false;
            if (errs.length) CG.toast("Withdrew "+n+", refused: "+errs.join("; "), "err");
            else CG.toast("Withdrew "+n+" sheet"+(n===1?"":"s")+", those games are back in the players' weeks", "ok");
            repaint(); return;
          }
          CG.sb.rpc("clear_game_lineup", { p_game: picks[i].id, p_team: tid }).then(function(r){
            if (r.error) errs.push(CG.fmtTime(picks[i].at)+": "+r.error.message);
            else { n++; if (lg._lineups) delete lg._lineups[club+":"+picks[i].id]; }
            next(i+1);
          });
        })(0);
      });
    });
  });
  document.querySelectorAll(".lc-pergame").forEach(function(el){
    el.addEventListener("click", function(){
      CG.lcTogglePerGame(club, el.dataset.night);
      repaint();
    });
  });
  document.querySelectorAll(".lc-gline").forEach(function(el){
    el.addEventListener("change", function(){
      var gid = el.dataset.game, slot = el.value ? +el.value : null;
      if (!CG.LIVE_MODE || !CG.sb || !tid){ CG.toast("Not connected, reload and retry","err"); return; }
      el.disabled = true;
      CG.sb.rpc("set_team_game_line", { p_game: gid, p_team: tid, p_slot: slot }).then(function(r){
        el.disabled = false;
        if (r.error){ CG.toast(r.error.message, "err"); repaint(); return; }
        lg._gameLinePlan = lg._gameLinePlan || {};
        if (slot == null) delete lg._gameLinePlan[gid]; else lg._gameLinePlan[gid] = slot;
        repaint();
      });
    });
  });
  document.querySelectorAll(".lc-dress").forEach(function(el){
    el.addEventListener("click", function(){
      /* v2.89: each game carries its own line, so the button dresses a NIGHT, not a line */
      var night = el.getAttribute("data-night");
      if (!tid) return;
      var open = CG.lcOpenGames(club, night);
      var plan = open.map(function(g){ return { g: g, slot: CG.lcGameSlot(club, night, g.id) }; }).filter(function(x){ return x.slot != null; });
      if (!plan.length) return;
      var nameOfSlot = function(sl){ return (((lg._teamLines||{})[sl]||{}).name) || ("Line "+sl); };
      CG.confirm("Dress "+plan.length+" game"+(plan.length===1?"":"s")+" "+esc(CG.NIGHT_LABEL[night]||night)+"?",
        plan.map(function(x){ return CG.fmtTime(x.g.at)+": "+esc(nameOfSlot(x.slot)); }).join(" · ")+
        ". Each game is submitted with the line set for it, through the same checks as the builder: weekly limits, suspensions and that game\u2019s own 30-minute lock. A game left on \u201cnone\u201d is untouched.",
        "Dress the night", function(){
        el.disabled = true;
        dressNight(night, null, function(err, okN, qN){
          el.disabled = false;
          if (qN && !okN && !err){ CG.toast("Sent "+qN+" lineup"+(qN===1?"":"s")+" to the Owner for approval — dressed when they approve","ok"); CG.reloadLeague(); return; }
          if (err){ CG.toast((okN?("Dressed "+okN+"; "):"")+"the rules refused: "+err,"err"); repaint(); return; }
          var lines = [...new Set(plan.map(function(x){ return nameOfSlot(x.slot); }))];
          CG.pushNotif("check","Lineups dressed from the night plan", lines.join(" + ")+" — "+okN+" game"+(okN===1?"":"s")+" "+(CG.NIGHT_LABEL[night]||night)+". Adjust any single game until its lock.","#/hub/lines");
          CG.toast(okN+" game"+(okN===1?"":"s")+" dressed ("+lines.join(" + ")+")","ok");
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
/* Rule 2.1 (v2.41) — the active roster is 9 forwards / 6 defensemen / 2 goaltenders (17) and training camp holds up to 3
   beyond it. Since v2.30 a player may move between the two as often as management likes, all
   season: the database (guard_squad_move) enforces the shape and the camp limit only, and this
   button just keeps the UI honest about which move is currently possible. */
/* How many pro spots a club is using at a player's position group — a one-way move
   into the pro roster (or into camp) is only possible when there is slack. When the
   roster is full at that shape, the only legal move is a same-position swap, so the
   button offers "Swap" and opens a picker of eligible counterparts. */
function squadRoom(club, p){
  var roster = (CG.lg.byTeam[club]||[]).filter(function(x){ return x.spotId && !CG.isWaived(x.id); });
  if (p.squad==="tc"){
    var grp = CG.posGroup(p.pos), cap = CG.ROSTER_QUOTA[grp];   /* the format's shape: 9 F / 6 D / 3 G basic, 9 F / 6 D / 2 G full (Rule 2.1) */
    return roster.filter(function(x){ return x.squad!=="tc" && CG.posGroup(x.pos)===grp && !CG.spotOutsideShape(x); }).length < cap;
  }
  return roster.filter(function(x){ return x.squad==="tc"; }).length < CG.CAMP_MAX;
}
function squadBtn(p){
  if (!p.spotId) return "";
  var club = CG.myClub();
  var title = 'Squad changes are unlimited all season (Rule 2.1)';
  if (squadRoom(club, p)){
    var to = p.squad==="tc" ? "pro" : "tc";
    return '<button class="btn btn-ghost btn-sm" data-squad="'+p.spotId+'" data-squad-to="'+to+'" title="'+title+'">'+
      (p.squad==="tc" ? "Call up" : "To camp")+'</button>';
  }
  /* roster full at this shape — a straight same-position swap is the only legal move */
  return '<button class="btn btn-ghost btn-sm" data-squad-swap="'+p.spotId+'" title="Roster full — swap for '+
    (p.squad==="tc"?"an active-roster":"a camp")+' player of the same position. '+title+'">Swap…</button>';
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
  /* v3.28 (commissioner): "I want the actual roster to appear directly under the active payroll,
     cap space, and salary cap boxes." Everything that used to sit between them, the cap outlook,
     the squads card and the eligibility trackers, is built into `tail` and appended AFTER the
     roster instead. The page still computes in the same order; only the order it PRINTS changed. */
  var tail = "";
  /* v2.34 — the cap outlook: this season and the next three, from the same arithmetic every cap
     check uses (team_cap_outlook), so what management plans against is what the guards enforce.
     Filled in AFTER._roster; the placeholder keeps the page from jumping when it lands. */
  tail += '<div class="card" style="margin-bottom:20px" id="capOutlookCard"><div class="card-h"><h3>Cap outlook</h3><span class="chip">'+(CG.fmt("extensions")?'This season + 3':'This season')+'</span></div>'+
       '<div class="card-b" id="capOutlookBody"><p class="caption">Loading your commitments…</p></div></div>';
  /* v2.34 — between the rollover and this season's free agency, the players whose deals just ended
     are not on the roster but the club still holds their rights: they can be re-signed from here. */
  var rightsHeld = [];
  if (CG.extendableContractOf && lg._contractsRaw){
    var tid = (lg._codeToId||{})[club], sn = (CG.SEASON && CG.SEASON.number) || 1, seen = {};
    lg._contractsRaw.forEach(function(c){
      if (c.team_id!==tid || c.status!=="expired" || c.is_manager || (c.end_season||1)!==sn-1 || seen[c.profile_id]) return;
      /* the ONE predicate the Re-sign button relies on: rights still held, nothing real happened to
         him this season, and he is not already re-signed — so the list never shows a button the
         server would refuse */
      var x = CG.extendableContractOf(c.profile_id); if (!x || x.id!==c.id) return;
      if ((lg.byTeam[club]||[]).some(function(p){ return p.id===c.profile_id; })) return;
      seen[c.profile_id] = 1; rightsHeld.push({ id:c.profile_id, tag:(lg._profName||{})[c.profile_id]||"a player", salary:c.salary, end:c.end_season });
    });
  }
  /* v2.42: pre-season loans (randomly assigned, or a late sign-up placed the same way) are set
     apart from the club's own players — their own block, a tinted row, a LOAN chip first, and the
     position they registered when they are listed elsewhere for the pre-season (Rule 0.4). */
  var isLoan = function(p){ return !p.mgmt && (p.origin === "preseason_random" || p.origin === "latecomer_random"); };
  /* v2.48: basic-format depth — undrafted and late sign-ups placed by the league office. A real
     one-season contract (trade, waive, dress like anyone) that never counts against the shape. */
  var isDepth = function(p){ return !p.mgmt && p.origin === "depth_random"; };
  var regPos = {}; (lg._registrationsRaw||[]).forEach(function(r){ if (r.profile_id && r.position) regPos[r.profile_id] = r.position; });
  var contracted = roster.filter(function(p){ return !isLoan(p); }), loans = roster.filter(isLoan);
  /* only a seat that may manage the roster can renumber it; the same gate the page's other
     roster moves use, so a seat the Owner has put behind approval cannot quietly renumber either */
  var canEditNum = CG.can("roster.manage") && (!CG.mgmtAccess || CG.mgmtAccess("roster") !== "hidden");
  var rowFor = function(p){
    var waived = CG.isWaived(p.id), onBlk = CG.isOnBlock(p.id), mrole = CG.mgmtTag(p.mgmt);
    var status = waived ? '<span class="chip chip-loss">Waived</span>'
      : mrole ? '<span class="chip chip-chrome">'+mrole+'</span>'
      : onBlk ? '<span class="chip chip-warn">On block</span>'
      : '<span class="chip chip-win">Active</span>';
    if (p.spotId && p.squad === "tc")
      status += ' <span class="chip chip-warn" title="'+((CG.preseasonOnlyAhead && CG.preseasonOnlyAhead(club))
        ? 'Training camp — fills any position; no weekly cap in the pre-season (Rules 2.1, 5.2)'
        : 'Training camp — fills any position; may dress in at most 3 games a week (Rules 2.1, 5.2)')+'">Camp</span>';
    /* v2.34 — where his deal stands, and the one club-side move: extend, once the window is open */
    var signedExt = CG.signedExtensionOf ? CG.signedExtensionOf(p.id) : null;
    /* v2.35: a pre-season loan is not a contract — no term, no "final season", no club actions */
    var loan = isLoan(p);
    var expiring = !p.mgmt && !loan && CG.isExpiring && CG.isExpiring(p.id);
    var openOffer = !p.mgmt && (CG._clubOffers||[]).filter(function(o){ return o.player_id===p.id && !o.immediate; })[0];
    if (signedExt) status += ' <span class="chip chip-win" title="Re-signed — the new deal starts with next season’s cap year (Rule 2.5)">Signed thru S'+esc(String(signedExt.end_season))+'</span>';
    else if (expiring) status += ' <span class="chip chip-warn" title="His contract ends after this season (Rule 2.2)">Final season</span>';
    if (openOffer) status += ' <span class="chip chip-live" title="'+(CG.offerAwaitsClub(openOffer)?'His number is waiting for you on your dashboard':'Your offer is waiting on him')+'">'+(CG.offerAwaitsClub(openOffer)?'His ask':'Offer out')+'</span>';
    if (loan) status = '<span class="chip chip-ink" style="--bc:var(--steel)" title="'+(p.origin==="latecomer_random"?"Late sign-up placed for the pre-season":"Randomly assigned for the pre-season")+' — not the club’s asset: no trades, no waivers; he returns to the draft pool when the final pre-season game ends (Rule 0.4)">Loan</span> '+status;
    if (isDepth(p)) status = '<span class="chip chip-ink" style="--bc:var(--steel)" title="Placed by the league office after the draft (or as a late sign-up) on a one-season deal at the league minimum — the club’s player like any other, but he never counts against the 9/6/3 shape (Rule 2.8)">Depth</span> '+status;
    var extRow = !p.mgmt && !loan && CG.extendableContractOf && CG.extendableContractOf(p.id);
    var extBtn = (extRow && extRow.team_id === (lg._codeToId||{})[club])
      ? '<button class="btn btn-chrome btn-sm" data-extend="'+p.id+'">Extend</button>' : '';
    var actions = p.mgmt
      ? '<span class="caption">Management contract — protected</span>'
      : loan
      ? '<div class="row-actions" style="display:inline-flex;gap:6px;flex-wrap:nowrap;justify-content:flex-end;align-items:center">'+squadBtn(p)+'<span class="caption" title="A loan is not the club’s asset to trade or waive — he is released automatically after the pre-season">On loan</span></div>'
      : (waived
        ? '<button class="btn btn-ghost btn-sm" data-reinstate="'+p.id+'">Reinstate</button>'
        : '<div class="row-actions" style="display:inline-flex;gap:6px;flex-wrap:nowrap;justify-content:flex-end">'+
          extBtn+squadBtn(p)+
          '<button class="btn btn-ghost btn-sm" data-block="'+p.id+'">'+(onBlk?"Off block":"To block")+'</button>'+
          (function(){ var mv = CG.canMovePlayer ? CG.canMovePlayer(p) : null;
            /* Rule 2.4 minimum service (v2.74): the two moves that take a player off the club wait for his games */
            return mv
              ? '<button class="btn btn-ghost btn-sm" disabled title="'+esc(mv.text)+'">Trade</button>'+
                '<button class="btn btn-ghost btn-sm" disabled title="'+esc(mv.text)+'">Waive</button>'+
                '<span class="chip chip-warn chip-xs" title="'+esc(mv.text)+'">'+mv.gp+' of '+mv.need+' GP</span>'
              : '<button class="btn btn-ghost btn-sm" data-trade="'+p.id+'">Trade</button>'+
                '<button class="btn btn-ghost btn-sm" data-waive="'+p.id+'">Waive</button>'; })()+'</div>');
    var gp = (lg.pstats[p.id]||{}).gp||0;
    var rp = regPos[p.id];
    var posCell = (loan && rp && rp !== p.pos)
      ? '<span title="Listed at '+esc(p.pos)+' for the pre-season to fill an open seat; he registered as '+esc(rp)+' (Rule 0.4)">'+esc(p.pos)+' <span class="caption">· reg. '+esc(rp)+'</span></span>'
      : esc(p.pos);
    return '<tr class="'+(loan?"loan-row":"")+'"'+(waived?' style="opacity:.55"':"")+'>'+
      '<td class="tleft"><span class="playercell">'+CG.crest(p.team,20)+'<span class="nm" data-go="'+CG.playerRoute(p)+'" style="cursor:pointer">'+esc(p.tag)+'</span></span></td>'+
      /* v2.91: the club sets its own numbers. Editable for management (and the office in a
         preview); a loan is not the club's player, so his number is not the club's to change. */
      '<td class="tnum" data-l="#" data-v="'+(p.jersey||0)+'">'+((canEditNum && !loan && !isDepth(p))
        ? '<input class="jersey-in" type="number" min="1" max="99" step="1" value="'+(p.jersey||"")+'" data-jersey="'+p.id+'" aria-label="Jersey number for '+esc(p.tag)+'" title="1 to 99, and no two players on the club share one">'
        : '<span class="mono">'+(p.jersey ? "#"+p.jersey : "—")+'</span>')+'</td>'+
      '<td class="tnum" data-l="Pos">'+posCell+'</td>'+
      '<td class="tnum" data-v="'+lg.ratings[p.id].ovr+'"><span class="ovrbox mid" style="min-width:30px;height:20px;font-size:11px">'+lg.ratings[p.id].ovr+'</span></td>'+
      '<td class="tnum" data-v="'+(p.salary||0)+'" data-l="Cap">'+'<b>'+CG.fmtMoney(p.salary)+'</b></td>'+
      '<td class="tnum" data-l="Term">'+(loan?'<span class="caption">loan</span>':p.term+' yr'+(p.term>1?"s":""))+'</td>'+
      '<td class="tnum" data-v="'+gp+'" data-l="GP">'+gp+'</td>'+
      '<td>'+status+'</td>'+
      '<td class="tright">'+actions+'</td></tr>';
  };
  /* v2.72: the active roster and training camp are two blocks, never interleaved (Rule 2.1) */
  var sqSplit = CG.splitSquads(contracted);
  var rows = (sqSplit.camp.length ? '<tr class="squad-head"><td colspan="9" class="tleft"><b style="font-family:var(--f-disp)">Active roster — '+sqSplit.active.length+'</b></td></tr>' : "") +
    sqSplit.active.map(rowFor).join("") +
    (sqSplit.camp.length ? '<tr class="squad-head"><td colspan="9" class="tleft"><b style="font-family:var(--f-disp)">Training camp — '+sqSplit.camp.length+'</b> <span class="caption">Outside the active roster and its shape; a camp player fills any position and dresses in up to three games a week. Call up moves him onto the active roster when it has room (Rules 2.1, 5.2).</span></td></tr>' + sqSplit.camp.map(rowFor).join("") : "") +
    (loans.length ? '<tr class="loan-head"><td colspan="9" class="tleft"><b style="font-family:var(--f-disp)">Pre-season loans — '+loans.length+'</b> <span class="caption">Randomly assigned to your club for the pre-season only. They are not the club’s assets: no trades, no waivers, no contracts — they return to the draft pool when the final pre-season game ends (Rule 0.4). One listed at another position than he registered is filling that seat for the pre-season.</span></td></tr>'+loans.map(rowFor).join("") : "");
  /* the 9/6/2 shape is CONTRACTED players only; pre-season loans ride the active roster without
     counting against it (Rule 2.1) and are shown as their own tally */
  /* v2.73: depth placements live in camp and count like anyone else wherever they are; the depth
     tally below is informational */
  var proSq = roster.filter(function(p){ return p.spotId && p.squad!=="tc" && !isLoan(p) && !CG.isWaived(p.id); });
  var tcSq  = roster.filter(function(p){ return p.spotId && p.squad==="tc" && !isLoan(p) && !CG.isWaived(p.id); });
  var loanSq = loans.filter(function(p){ return p.spotId && !CG.isWaived(p.id); });
  var depthSq = roster.filter(function(p){ return p.spotId && isDepth(p) && !CG.isWaived(p.id); });
  var qG = CG.ROSTER_QUOTA.G, gCap = CG.weeklyCap({ pos:"G" }), sCap = CG.weeklyCap({ pos:"C" }), cCap = CG.weeklyCap({ squad:"tc" });
  if (roster.some(function(p){ return p.spotId; })){
    /* Rule 2.1 (v2.41): the active roster is shaped by position GROUP — 9 forwards / 6 defensemen /
       2 goaltenders; the exact split is shown for balance, not enforced. */
    var posN = function(p0){ return proSq.filter(function(p){ return p.pos===p0; }).length; };
    var grpN = function(g){ return proSq.filter(function(p){ return CG.posGroup(p.pos)===g; }).length; };
    function meter(label,nv,cap){
      var over = cap!=null && nv>cap;
      return '<div><b class="num" style="font-size:22px;color:'+(over?"var(--red)":"inherit")+'">'+nv+(cap!=null?' / '+cap:'')+'</b>'+
        '<span class="caption" style="display:block">'+label+'</span></div>';
    }
    tail += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Squads</h3>'+
      '<span class="chip">'+proSq.length+' pro · '+tcSq.length+' in camp'+(loanSq.length?' · '+loanSq.length+' loaned':'')+(depthSq.length?' · '+depthSq.length+' depth':'')+'</span></div><div class="card-b">'+
      '<div style="display:flex;gap:22px;flex-wrap:wrap">'+meter("forwards ("+posN("C")+" C · "+posN("LW")+" LW · "+posN("RW")+" RW)",grpN("F"),CG.ROSTER_QUOTA.F)+
      meter("defensemen ("+posN("LD")+" LD · "+posN("RD")+" RD)",grpN("D"),CG.ROSTER_QUOTA.D)+
      meter("goaltenders",grpN("G"),qG)+(CG.isBasic()?meter("active roster",proSq.length,CG.ROSTER_MAX):"")+meter("training camp",tcSq.length,CG.CAMP_MAX>=999?null:CG.CAMP_MAX)+
      (loanSq.length?meter("pre-season loans",loanSq.length,null):"")+(depthSq.length?meter("depth",depthSq.length,null):"")+'</div>'+
      '<p class="caption" style="margin-top:12px">Rule 2.1 — '+(CG.isBasic()
        ? 'the active roster is '+(CG.ROSTER_MAX||CG.fmt("roster_max"))+' players: '+CG.rosterShapeWords()+' (at most '+CG.ROSTER_QUOTA.F+' forwards, '+CG.ROSTER_QUOTA.D+' defensemen or '+qG+' goaltenders), with your Owner, GM and AGM inside those spots; training camp is unlimited. '
        : 'the active roster is '+CG.ROSTER_QUOTA.F+' forwards (centers and wings in any mix), '+CG.ROSTER_QUOTA.D+' defensemen (either side) and '+qG+' goaltenders, the one position locked to its exact role; training camp holds up to '+CG.CAMP_MAX+' players. ')+
      (CG.isBasic()
        ? 'Players the league office places after the draft (anyone undrafted, and late sign-ups) join your training camp as depth: real one-season contracts you can dress at any position up to '+cCap+' games a week, trade or waive. Call one up and he takes an active-roster spot like anyone else, so the roster must have room (Rule 2.8). '
        : 'Randomly assigned pre-season players ride the active roster as loans and don’t count against the '+CG.ROSTER_QUOTA.F+'/'+CG.ROSTER_QUOTA.D+'/'+qG+' shape — a club can hold as many as it is sent, so everyone gets a club for the pre-season (Rule 2.1); they return to the draft pool when it ends. ')+
      (CG.preseasonOnlyAhead && CG.preseasonOnlyAhead(club)
        ? 'There is no weekly appearance cap in the pre-season (Rule 5.2) — dress whoever you need, as often as you need. Camp players still fill any position, and in pre-season games so do your Owner, GM and AGM (Rule 2.1). '
        : 'Camp players may dress in up to '+cCap+' games a week at any position; skaters play their own position group, up to '+sCap+' games a week'+(gCap===sCap?', goaltenders too':' (goaltenders up to '+gCap+')')+' — Rule 5.2. ')+
      'You may move players between the active roster and training camp freely, as often as you like, all season — there is no limit on squad changes (Rule 2.1).'+
      (CG.minServiceGp()?' A player can be waived or traded only after '+CG.minServiceGp()+' regular-season games this season; until then his Trade and Waive buttons wait, and the count sits beside them (Rule 2.4).':'')+'</p></div></div>';
  }
  /* Road to 3 (Rule 2.8): during the pre-season, this club is custodian of its assigned players'
     draft eligibility — management is OBLIGED to spread ice time so everyone can reach three games.
     The card only exists while that duty is live (random assignees present, draft not complete). */
  if (CG.roadToFive){
    var r5 = CG.roadToFive(lg, club);
    var draftDone5 = !!(lg.draftState && String(lg.draftState.status)==="complete");
    if (r5.length && !draftDone5){
      var short5 = r5.filter(function(r){ return !r.done; });
      var exempt5 = r5.filter(function(r){ return r.exempt; }).length;
      tail += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Road to '+CG.PRESEASON_MIN_GP+' — draft eligibility</h3>'+
        (short5.length ? '<span class="chip chip-warn">'+short5.length+' still short</span>'
                       : '<span class="chip chip-win">everyone covered</span>')+'</div><div class="card-b">'+
        (short5.length ? '<div class="stack" style="gap:9px">'+short5.map(function(r){
            var pct = Math.round(Math.min(1, r.gp/CG.PRESEASON_MIN_GP)*100);
            var danger = !r.reachable;
            return '<div style="display:flex;align-items:center;gap:12px">'+
              '<span style="flex:0 0 140px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b style="font-size:13px">'+esc(r.tag)+'</b> <small class="caption">'+esc(r.pos||"")+'</small></span>'+
              '<span style="flex:1;height:8px;border-radius:4px;background:var(--line);overflow:hidden"><i style="display:block;height:100%;width:'+pct+'%;background:'+(danger?"var(--red)":"var(--chrome)")+'"></i></span>'+
              '<span class="num" style="flex:0 0 44px;text-align:right;font-weight:700'+(danger?';color:var(--red)':'')+'">'+r.gp+' / '+CG.PRESEASON_MIN_GP+'</span>'+
              (danger?'<span class="chip chip-loss" style="font-size:9px">can’t reach '+CG.PRESEASON_MIN_GP+'</span>':'<span class="caption">needs '+r.need+'</span>')+
            '</div>';
          }).join("")+'</div>'
          : '<p class="small" style="color:var(--steel)">Every randomly assigned player has '+CG.PRESEASON_MIN_GP+' pre-season games or an exemption — the whole group enters the draft.</p>')+
        '<p class="caption" style="margin-top:12px">Rule 2.8: a randomly assigned player needs '+CG.PRESEASON_MIN_GP+' pre-season appearances to stay draft-eligible, and management must spread ice time so everyone can get there. '+
        (exempt5?exempt5+' returning player'+(exempt5===1?' is':'s are')+' exempt. ':'')+
        'The club has '+((r5[0]&&r5[0].clubGamesLeft)||0)+' pre-season game'+(((r5[0]&&r5[0].clubGamesLeft)||0)===1?'':'s')+' left.</p></div></div>';
    }
  }
  /* v2.51 (Rule 8.3): the playoff games-played floor — management's tracker for who is eligible and who
     needs games, so the preferred players get their minimum before the postseason */
  if (CG.playoffRoad && CG.playoffMinGp()){
    var prRoad = CG.playoffRoad(lg, club), minGp = CG.playoffMinGp();
    var shortGp = prRoad.filter(function(r){ return !r.done; }), leftGp = prRoad.length ? prRoad[0].left : 0;
    tail += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Road to '+minGp+' — playoff eligibility</h3>'+
      (shortGp.length ? '<span class="chip chip-warn">'+shortGp.length+' still short</span>' : '<span class="chip chip-win">everyone eligible</span>')+'</div><div class="card-b">'+
      (prRoad.length ? '<div class="stack" style="gap:9px">'+prRoad.map(function(r){
          var pct = Math.round(Math.min(1, r.gp/minGp)*100), danger = !r.reachable;
          return '<div style="display:flex;align-items:center;gap:12px">'+
            '<span style="flex:0 0 140px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b style="font-size:13px">'+esc(r.tag)+'</b> <small class="caption">'+esc(r.pos||"")+(r.squad==="tc"?" · camp":"")+'</small></span>'+
            '<span style="flex:1;height:8px;border-radius:4px;background:var(--line);overflow:hidden"><i style="display:block;height:100%;width:'+pct+'%;background:'+(r.done?"var(--green)":danger?"var(--red)":"var(--chrome)")+'"></i></span>'+
            '<span class="num" style="flex:0 0 52px;text-align:right;font-weight:700'+(danger?';color:var(--red)':'')+'">'+r.gp+' / '+minGp+'</span>'+
            (r.done?'<span class="chip chip-win" style="font-size:9px">eligible</span>':danger?'<span class="chip chip-loss" style="font-size:9px">can’t reach '+minGp+'</span>':'<span class="caption">needs '+r.need+'</span>')+
          '</div>';
        }).join("")+'</div>' : '<p class="caption">No roster yet.</p>')+
      '<p class="caption" style="margin-top:12px">Rule 8.3: a player needs '+minGp+' regular-season games to be dressed in the playoffs. The club has '+leftGp+' regular-season game'+(leftGp===1?'':'s')+' left; a player who can no longer reach '+minGp+' is marked. Spread the games so the players you want in the playoffs get there.</p></div></div>';
  }
  /* v2.7: the 30% playoff floor is abolished in the full format — the basic format's floor is the Road card above.
     The card states the caps that DO exist. */
  tail += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Game limits</h3>'+
    (CG.playoffMinGp() ? '<span class="chip">'+CG.playoffMinGp()+' games to be playoff-eligible</span>' : '<span class="chip chip-win">every rostered player is playoff-eligible</span>')+'</div><div class="card-b">'+
    '<div style="display:flex;gap:26px;flex-wrap:wrap">'+
      '<div><b class="num" style="font-size:22px">'+CG.weeklyCap({ pos:"C" })+'</b><span class="caption" style="display:block">games a week — skaters</span></div>'+
      '<div><b class="num" style="font-size:22px">'+CG.weeklyCap({ pos:"G" })+'</b><span class="caption" style="display:block">games a week — goaltenders</span></div>'+
      '<div><b class="num" style="font-size:22px">'+CG.weeklyCap({ squad:"tc" })+'</b><span class="caption" style="display:block">games a week — training camp</span></div>'+
      '<div><b class="num" style="font-size:22px">'+CG.seriesCap({ pos:"C" })+'</b><span class="caption" style="display:block">of a playoff series'+(CG.seriesCap({ pos:"C" })===CG.seriesCap({ pos:"G" })?'':' — skaters')+'</span></div>'+
      (CG.playoffMinGp()?'<div><b class="num" style="font-size:22px">'+CG.playoffMinGp()+'</b><span class="caption" style="display:block">regular-season games to be playoff-eligible</span></div>':'')+'</div>'+
    '<p class="caption" style="margin-top:12px">'+
    (CG.preseasonOnlyAhead && CG.preseasonOnlyAhead(club)
      ? 'No weekly cap applies in the pre-season (Rule 5.2) — these limits start with the regular season. '
      : 'Weekly caps are the limit, not a minimum (Rule 5.2). ')+
    (CG.seriesCap({ pos:"C" })===CG.seriesCap({ pos:"G" })
      ? 'In the playoffs every player may be dressed in at most '+CG.seriesCap({ pos:"C" })+' games of a series'
      : 'In the playoffs a skater may be dressed in at most '+CG.seriesCap({ pos:"C" })+' games of a series and a goaltender in at most '+CG.seriesCap({ pos:"G" }))+
    (CG.playoffMinGp()?', and only a player with '+CG.playoffMinGp()+' regular-season games can be dressed at all — the Road to '+CG.playoffMinGp()+' card above tracks it':'')+' (Rule 8.3).</p></div></div>';
  var loanN = loans.length;
  h += '<div class="card"><div class="card-h"><h3>Roster — '+(roster.length-loanN)+' under contract'+(loanN?' · '+loanN+' on pre-season loan':'')+'</h3>'+
    '<span class="chip">'+blockN+' on the block</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols roster-tbl"><caption>'+esc(t.name)+' roster, contracts and cap hit</caption><thead><tr>'+
    '<th class="tleft sortable">Player</th><th class="sortable" title="Jersey number — click to change (Rule 2.1)">#</th><th class="sortable">POS</th><th class="sortable">OVR</th><th class="sortable">Cap hit</th><th class="sortable">Term</th><th class="sortable" title="Regular-season games played">GP</th><th>Status</th><th class="tright">Actions</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>'+
    (rightsHeld.length ? '<div class="card-b" style="border-top:1px solid var(--line)"><b style="font-family:var(--f-disp);display:block;margin-bottom:8px">Rights held until free agency opens</b>'+
      '<p class="caption" style="margin-bottom:10px">Their deals ended with last season. Until this season’s free agency opens, only you can re-sign them — after that they are free agents (Rule 2.2).</p>'+
      '<div class="stack" style="gap:8px">'+rightsHeld.map(function(r){
        var oo = (CG._clubOffers||[]).filter(function(o){ return o.player_id===r.id && !o.immediate; })[0];
        return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="flex:1"><b>'+esc(r.tag)+'</b> <span class="caption">was '+CG.fmtMoney(r.salary)+' through Season '+r.end+'</span>'+(oo?' <span class="chip chip-live">'+(CG.offerAwaitsClub(oo)?'His ask':'Offer out')+'</span>':'')+'</span>'+
          '<button class="btn btn-chrome btn-sm" data-extend="'+esc(r.id)+'">Re-sign</button></div>'; }).join("")+'</div></div>' : '')+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">'+(CG.playoffMinGp() ? 'A player needs '+CG.playoffMinGp()+' regular-season games to be dressed in the playoffs — the Road to '+CG.playoffMinGp()+' card tracks it (Rule 8.3). ' : 'Every rostered player is playoff-eligible — there is no games-played floor (Rule 8.3). ')+'Owner, GM, and AGM carry management contracts (Rule 2.6) and are protected from waivers and trades. Waiving a player releases him immediately and clears his cap hit; '+(CG.isBasic() ? 'any club with room in his position group may then sign him at the league minimum, on a deal to the end of the season, until the movement deadline (Rule 2.2).' : 'any club may then sign him under the free-agency rules (Rule 2.2).')+'</span></div></div>';
  h += tail;
  return h;
};
CG.renderCapOutlook = function(rows){
  var body = document.getElementById("capOutlookBody"); if (!body) return;
  if (!rows || !rows.length){ body.innerHTML = '<p class="caption">No outlook yet — the season has no cap set.</p>'; return; }
  /* basic format: every contract ends with the season, so only this season's sheet means anything */
  if (!CG.fmt("extensions")) rows = rows.filter(function(r){ return r.current; });
  /* v3.28 (commissioner, with a screenshot): "Either fill the space better or shrink the box."
     This was always a four-across grid of season cards, which is right for the full format's
     "this season + 3". Under the basic format every contract ends with the season, so the filter
     above leaves exactly ONE card, and one card in a four-column grid is a narrow box beside three
     empty ones. With a single season the same numbers are laid out ACROSS the width instead, and
     the long list of expiring names gets the room it needs rather than wrapping in a column a
     quarter of the page wide. Several seasons still render as cards. */
  var solo = rows.length === 1;
  var cols = rows.map(function(r){
    var deals = r.deals||[], neg = r.space < 0, ending = deals.filter(function(d){ return d.final; });
    var money = function(v){ return '<b class="num" style="font-size:22px;color:'+(v<0?"var(--red)":"var(--ink)")+'">'+CG.fmtMoney(v)+'</b>'; };
    if (solo){
      return '<div class="cap-solo">'+
        '<div class="cs-figs">'+
          '<div><b class="num" style="font-size:26px;color:'+(neg?"var(--red)":"var(--green)")+'">'+CG.fmtMoney(r.space)+'</b><span>Cap space</span></div>'+
          '<div>'+money(r.committed)+'<span>Committed</span></div>'+
          '<div>'+money(r.management)+'<span>Front office</span></div>'+
          '<div><b class="num" style="font-size:22px">'+deals.length+'</b><span>Player deal'+(deals.length===1?'':'s')+'</span></div>'+
        '</div>'+
        (r.expiring_after>0
          ? '<div class="cs-off"><span class="caption">'+CG.fmtMoney(r.expiring_after)+' comes off after Season '+r.season+'</span>'+
            '<p class="small" style="color:var(--steel);margin:6px 0 0;line-height:1.6">'+ending.map(function(d){ return esc(d.name); }).join(", ")+'</p></div>'
          : '')+
      '</div>';
    }
    return '<div class="kpi" style="cursor:default;align-items:stretch;text-align:left;padding:14px">'+
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-family:var(--f-disp)">Season '+r.season+'</b>'+(r.current?'<span class="chip chip-chrome">now</span>':'')+'</div>'+
      '<b class="num" style="font-size:22px;color:'+(neg?"var(--red)":"var(--green)")+';margin-top:6px">'+CG.fmtMoney(r.space)+'</b><span>cap space</span>'+
      '<div class="caption" style="margin-top:8px;line-height:1.5">'+CG.fmtMoney(r.committed)+' committed<br>'+deals.length+' player deal'+(deals.length===1?'':'s')+' · '+CG.fmtMoney(r.management)+' front office'+
      (r.expiring_after>0?'<br><span style="color:var(--steel)">'+CG.fmtMoney(r.expiring_after)+' comes off after this season ('+ending.map(function(d){ return esc(d.name); }).join(", ")+')</span>':'')+'</div></div>';
  }).join("");
  body.innerHTML = (solo ? cols : '<div class="grid g4" style="gap:12px">'+cols+'</div>')+
    (CG.fmt("extensions")
      ? '<p class="caption" style="margin-top:12px">Each season’s figure counts every deal signed for it — current contracts that run that far, extensions already signed, and the three front-office seats at their fixed values (Rule 2.6). A new deal that starts next season is checked against <b>next</b> season’s space, not this one’s: contracts turn over when a season’s free agency opens, and that is when what is coming off your books comes off (Rule 2.5).</p>'
      : '<p class="caption" style="margin-top:12px">Every player deal — your picks, depth placements and any waived player you sign — runs to the end of this season and comes off the books with it; the three front-office seats count at their fixed values (Rule 2.6). Nothing carries into next season: everyone re-enters the draft (Rule 2.5).</p>');
};
CG.AFTER._roster = function(){
  /* v2.91: jersey numbers. Committed on blur or Enter, never on every keystroke, and the field is
     put back to what the league actually holds if the write is refused, so the page can never show
     a number the club does not have. */
  document.querySelectorAll(".jersey-in").forEach(function(el){
    var was = el.value;
    var commit = function(){
      var pid = el.dataset.jersey, n = parseInt(el.value, 10);
      if (el.value === was) return;
      if (!CG.LIVE_MODE || !CG.sb){ CG.toast("Not connected, reload and retry","err"); el.value = was; return; }
      var tid = ((CG.lg && CG.lg._codeToId) || {})[CG.myClub()];
      if (!tid){ el.value = was; return; }
      if (!(n >= 1 && n <= 99)){ CG.toast("A jersey number is 1 to 99","err"); el.value = was; return; }
      el.disabled = true;
      CG.sb.rpc("set_jersey_number", { p_team: tid, p_profile: pid, p_number: n }).then(function(r){
        el.disabled = false;
        if (r.error){ CG.toast(r.error.message, "err"); el.value = was; return; }
        was = String(n);
        var pl = CG.playerById(CG.lg, pid); if (pl) pl.jersey = n;    /* the table, the cards and the crest all read this */
        CG.toast((pl?pl.tag:"That player")+" wears #"+n, "ok");
      });
    };
    el.addEventListener("change", commit);
    el.addEventListener("keydown", function(e){ if (e.key === "Enter"){ e.preventDefault(); el.blur(); } });
  });
  (function(){
    var club = CG.myClub(), tid = ((CG.lg && CG.lg._codeToId) || {})[club];
    if (!tid || !CG.sb || !document.getElementById("capOutlookBody")) return;
    CG.sb.rpc("team_cap_outlook",{ p_team: tid }).then(function(r){
      var body = document.getElementById("capOutlookBody"); if (!body) return;
      if (r.error){ body.innerHTML = '<p class="small" style="color:var(--red)">Couldn’t load the outlook — '+esc(r.error.message)+'</p>'; return; }
      CG._capOutlook = r.data || [];
      CG.renderCapOutlook(CG._capOutlook);
    });
  })();
  $$("[data-trade]").forEach(function(b){ b.addEventListener("click", function(){
    location.hash = "#/hub/tradehub?add="+this.getAttribute("data-trade");
  }); });
  $$("[data-block]").forEach(function(b){ b.addEventListener("click", function(){
    var pid = this.getAttribute("data-block"), on = CG.isOnBlock(pid);
    if (CG.setOnBlock(pid, !on)) return;   /* v2.38: sent to the Owner — nothing to claim yet */
    var p = CG.playerById(CG.lg, pid);
    CG.audit(on?"Removed from trade block":"Added to trade block", p.tag);
    CG.toast(on ? p.tag+" removed from the trade block" : p.tag+" listed on the trade block", "ok");
    CG.router();
  }); });
  $$("[data-extend]").forEach(function(b){ b.addEventListener("click", function(){
    var pid = this.getAttribute("data-extend"), sn = (CG.SEASON && CG.SEASON.number) || 1;
    var rights = !CG.contractOf(pid) && CG.rightsHeldContractOf(pid);
    var target = rights ? sn : sn + 1;   /* a rights-held re-sign is for the season now under way */
    var p = CG.playerById(CG.lg, pid) || (function(){ var rh = CG.rightsHeldContractOf(pid); return rh ? { tag:((CG.lg._profName||{})[pid]||"this player"), salary:rh.salary } : { tag:"this player", salary:750000 }; })();
    var live = (CG._clubOffers||[]).filter(function(o){ return o.player_id===pid && !o.immediate; })[0];
    CG.modal((CG.playerById(CG.lg, pid)?"Extend ":"Re-sign ")+esc(p.tag),
      (live?'<div class="note" style="margin-bottom:12px">A negotiation with him is already open — '+(CG.offerAwaitsClub(live)?'his ask of '+CG.fmtMoney(live.salary)+' × '+live.years+' is waiting for you on your dashboard.':'your offer of '+CG.fmtMoney(live.salary)+' × '+live.years+' is waiting on him.')+' Sending a new offer replaces it.</div>':'')+
      '<label class="fld"><span>Salary ($M per season)</span><input id="exSal" type="number" min="0.75" step="0.25" value="'+((p.salary||750000)/1e6).toFixed(2)+'"></label>'+
      '<label class="fld"><span>Term (seasons)</span><select id="exYrs">'+[1,2,3].slice(0, CG.fmt("max_contract_years")).map(function(y){ return '<option value="'+y+'">'+y+' season'+(y>1?'s':'')+'</option>'; }).join("")+'</select></label>'+
      '<label class="fld"><span>Note (optional)</span><input id="exNote" maxlength="200" placeholder="A word to go with the number"></label>'+
      (function(){ var nx = (CG._capOutlook||[]).filter(function(r){ return r.season===target; })[0];
        return nx ? '<div class="note" style="margin-bottom:12px">Season '+target+' space right now: <b>'+CG.fmtMoney(nx.space)+'</b> ('+CG.fmtMoney(nx.committed)+' already committed). This deal has to fit inside that.</div>' : ''; })()+
      (rights
        ? '<p class="caption">A deal for Season '+sn+' — the season now under way. His last deal ended and you hold his rights until free agency opens; the moment he accepts the deal takes effect and, once he is registered, he is seated on your roster. It is checked against this season’s cap. Salaries move in $0.25M steps (Rule 2.5).</p>'
        : '<p class="caption">A new deal starting Season '+(sn+1)+'. He can accept, counter, or decline; nothing changes this season, and it is checked against next season’s cap alongside every deal already signed for it — the server refuses anything that would not fit. Salaries move in $0.25M steps (Rule 2.5).</p>'),
      '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="exGo">Send offer</button>');
    document.getElementById("exGo").addEventListener("click", function(){
      var v=parseFloat(document.getElementById("exSal").value), bad=CG.salaryProblem(Math.round(v*1e6));
      if (bad){ CG.toast(bad,"err"); return; }
      var y=parseInt(document.getElementById("exYrs").value,10)||1, note=(document.getElementById("exNote").value||"").trim()||null, btn=this; btn.disabled=true;
      CG.mgmtQueue("offer_extension", { p_profile:pid, p_salary:Math.round(v*1e6), p_years:y, p_note:note }, (rights?"offer ":"offer an extension to ")+p.tag+" — "+CG.fmtMoney(Math.round(v*1e6))+" × "+y, { page: rights?"freeagents":"roster" }).then(function(q){ if (q){ btn.disabled=false; return; }
      CG.sb.rpc("offer_extension",{ p_profile:pid, p_salary:Math.round(v*1e6), p_years:y, p_note:note }).then(function(r){
        btn.disabled=false;
        if (r.error){ CG.toast("Couldn’t offer: "+r.error.message,"err"); return; }
        if (CG.closeOverlay) CG.closeOverlay();
        CG.toast((rights?"Offer sent to ":"Extension offered to ")+p.tag+" — "+CG.fmtMoney(Math.round(v*1e6))+" × "+y+". He decides.","ok");
        CG.loadMyOffers().then(function(){ if (CG.router) CG.router(); });
      });
      });
    });
  }); });
  $$("[data-waive]").forEach(function(b){ b.addEventListener("click", function(){
    var pid = this.getAttribute("data-waive"), p = CG.playerById(CG.lg, pid);
    if (CG.LIVE_MODE){
      var sx = CG.signedExtensionOf ? CG.signedExtensionOf(pid) : null;
      CG.confirm("Waive "+p.tag+"?",
        "They come off your roster immediately, their "+CG.fmtMoney(p.salary)+" cap hit clears, and "+(CG.isBasic() ? "any club with room in their position group can sign them at the league minimum until the movement deadline (Rule 2.2)." : "they return to the free-agent pool where any club can sign them (Rule 2.5).")+(sx?" His signed extension through Season "+sx.end_season+" is voided with the waiver.":"")+" The move is logged for the whole league.",
        "Waive player", function(){
        CG.mgmtQueue("waive_player", { p_profile:pid }, "waive "+p.tag).then(function(q){ if (q) return;
        CG.sb.rpc("waive_player",{ p_profile:pid }).then(function(r){
          if (r.error){ CG.toast("Couldn’t waive: "+r.error.message,"err"); return; }
          CG.toast(String(r.data||p.tag)+(CG.isBasic() ? " waived — any club may sign him now" : " waived — back in the free-agent pool"),"ok");
          CG.reloadLeague();
        });
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
    '<p class="caption" style="margin-top:10px">Both clubs must clear the $'+(CG.CAP/1000000)+'M cap after the deal. A trade is official the moment the other club accepts; the transactions department may only reverse one afterward (Rule 2.3).</p>'+
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
    '<div class="note" style="margin-top:18px">Complaints follow Chapter 7: submission → staff assignment → review → written decision, with appeals within 48 hours (Rule 7.6). Access to every case is logged.</div>';
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
      ? '<div class="gamelist">'+missing.map(CG.gameCard).join("")+'</div>'
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
    '<div class="grid g2"><label class="fld"><span>Console</span><select id="sPlat">'+CG.platOptions(prefs.plat||((me||{}).platform)||"","Pick your console")+'</select></label>'+
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
  if ((param==="lineups" || param==="") && CG.loadMyWeekLineups) CG.loadMyWeekLineups();
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
