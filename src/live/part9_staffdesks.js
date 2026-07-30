/* ================================================================
   STAFF DEPARTMENT DESKS
   ================================================================
   The league office used to be all-or-nothing. `is_staff()` opened the
   Staff Desk; everything else lived behind `is_commissioner()` in the
   Control Center. Departments were labels on a profile that drove a
   Discord role and exactly one page (the stats manager).

   Now each department is a real permission with its own desk. A staffer
   sees a tab for every department they carry and nothing for the ones
   they don't — Alegator gets Review Board, Officials and Transactions;
   a community moderator gets Community and nothing else.

   The line the whole thing is drawn on:

       staff run the season — commissioners change who holds power,
       end someone's career, or reshape the league.

   So officiating can suspend, capped at 10 games or 30 days, but cannot
   ban. The draft department runs the clock but cannot start or conclude
   the night. Media writes the paper but cannot unpublish. Nobody but a
   commissioner can hand out a role.

   Every gate here is cosmetic — the database enforces the same split
   through has_department() on the RPCs and the RLS policies. Hiding a
   button is a courtesy, never the control.
   ================================================================ */

/* ---------------------------------------------------------------- *
 * Capabilities
 * ---------------------------------------------------------------- */

/* The departments a profile actually holds, normalised: legacy keys mapped
   through DEPT_ALIAS, unknown keys dropped, duplicates collapsed. The stored
   array is user data — an un-migrated 'player-relations' row still resolves. */
CG.deptsOf = function(){
  var p = CG.auth && CG.auth.profile;
  if (!p) return [];
  var known = {};
  (CG.STAFF_DEPARTMENTS||[]).forEach(function(d){ known[d[0]] = 1; });
  return (p.departments||[])
    .map(function(k){ return (CG.DEPT_ALIAS && CG.DEPT_ALIAS[k]) || k; })
    .filter(function(k, i, arr){ return known[k] && arr.indexOf(k) === i; });
};

/* Mirrors the database's has_department(). Commissioners hold every
   department by office; members and guests hold none. */
CG.hasDept = function(key){
  var p = CG.auth && CG.auth.profile;
  if (!p) return false;
  if (p.role === "commissioner") return true;
  if (p.role !== "staff") return false;
  return CG.deptsOf().indexOf((CG.DEPT_ALIAS && CG.DEPT_ALIAS[key]) || key) >= 0;
};

/* What each department may do. Anything NOT listed here is commissioner-only:
   role changes, bans, season-long discipline, starting/concluding the draft,
   generating or wiping the schedule, creating or deleting clubs, reopening a
   final, deleting a story, automations, the audit log, site settings. */
CG.DEPT_CAPS = {
  applications: ["apps.decide"],
  officiating:  ["cases.rule", "forfeit.rule", "discipline.suspend", "discipline.lift"],
  operations:   ["schedule.move", "codes.manage"],
  draft:        ["draft.run"],
  transactions: ["trades.review"],
  community:    ["community.desk", "discipline.warn"],
  statistics:   ["stats.manage"],
  media:        ["news.write", "rankings.publish"]
};

/* Capabilities the office keeps. Listed rather than implied so the reserve is
   readable in one place — CG.may() returns true for a commissioner regardless. */
CG.COMMISH_ONLY_CAPS = ["draft.setup", "roles.assign", "discipline.ban", "season.shape"];

CG.may = function(cap){
  var p = CG.auth && CG.auth.profile;
  if (!p) return false;
  if (p.role === "commissioner") return true;
  if (p.role !== "staff") return false;
  var d = CG.deptsOf();
  for (var i = 0; i < d.length; i++){
    if ((CG.DEPT_CAPS[d[i]] || []).indexOf(cap) >= 0) return true;
  }
  return false;
};

/* Kept for the dozen call sites that predate this file; one gate, one meaning. */
CG.isStatsStaff = function(){ return CG.hasDept("statistics"); };

/* ---------------------------------------------------------------- *
 * Shared chrome
 * ---------------------------------------------------------------- */
CG.deskHead = function(eyebrow, title, lede){
  return '<div style="margin-bottom:20px"><span class="eyebrow chr">'+esc(eyebrow)+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">'+esc(title)+'</h1>'+
    '<p class="lede" style="margin-top:6px">'+lede+'</p></div>';
};
/* [value, label, alert?, href?, id?]. The id goes on the <b>, never on a span inside it —
   `.kpi .num span` is the 10.5px secondary style used for "3 / 15", so a placeholder
   wrapped in a span renders as fine print instead of a headline number. */
CG.deskKpis = function(items){
  return '<div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr));margin-bottom:20px">'+
    items.map(function(k){
      return '<div class="kpi'+(k[2]?" alert":"")+'" style="cursor:'+(k[3]?"pointer":"default")+'"'+
        (k[3]?' data-go="'+k[3]+'"':"")+'><b class="num"'+(k[4]?' id="'+k[4]+'"':"")+'>'+k[0]+'</b>'+
        '<span>'+esc(k[1])+'</span></div>';
    }).join("")+'</div>';
};
CG.deskEmpty = function(msg){
  return '<div class="card-b"><p class="caption">'+msg+'</p></div>';
};
/* Every desk states its own ceiling. A staffer should learn where their authority
   ends from the page, not from an error message after they try. */
CG.deskCeiling = function(msg){
  return '<div class="note" style="margin-top:18px"><span class="caption">'+msg+'</span></div>';
};
/* Transaction descriptions are written by database triggers and wrap player and club
   names in <b>. Escape the whole string, then put just those two tags back — any other
   markup, including a name that somehow carried angle brackets, stays inert text. */
CG.deskDesc = function(s){
  return esc(String(s == null ? "" : s)).replace(/&lt;(\/?)b&gt;/g, "<$1b>");
};

/* ---------------------------------------------------------------- *
 * REVIEW BOARD — applications
 * ---------------------------------------------------------------- */
CG.deskReviewBoard = function(){
  var lg = CG.lg;
  var owner = (lg._ownerApps||[]), staff = (lg._staffApps||[]), mgmt = (lg._mgmtApps||[]);
  var pendO = owner.filter(function(a){ return a.status==="pending"; });
  var pendS = staff.filter(function(a){ return a.status==="pending"; });
  var pendM = mgmt.filter(function(a){ return a.status==="pending"; });
  var pending = pendO.length + pendS.length + pendM.length;
  var reviewers = CG.appReviewers();
  var me = (CG.auth && CG.auth.profile && CG.auth.profile.id) || null;
  var need = reviewers.length ? Math.floor(reviewers.length/2) + 1 : 0;

  var h = CG.deskHead("Applications · review board", "Review Board",
    "Every application waiting on the board, who has voted, and what the room decided. "+
    "A decision needs <b>"+(need||"—")+"</b> of <b>"+reviewers.length+"</b> reviewers.");

  /* how many of the pending items still need MY ballot — the number a reviewer
     actually cares about when they open this page */
  var mine = 0;
  function ballots(type, a){ return CG.appBallotsFor(type, a.id) || []; }
  function votedByMe(type, a){
    return ballots(type, a).some(function(v){ return v.profile_id === me || v.voter_id === me; });
  }
  [[pendO,"owner"],[pendS,"staff"],[pendM,"management"]].forEach(function(pair){
    pair[0].forEach(function(a){ if (!votedByMe(pair[1], a)) mine++; });
  });

  h += CG.deskKpis([
    [pending, "awaiting the vote", pending>0, null],
    [mine, "need your ballot", mine>0, null],
    [reviewers.length, "reviewers on the board", !reviewers.length, null],
    [owner.filter(function(a){ return a.status!=="pending"; }).length +
     staff.filter(function(a){ return a.status!=="pending"; }).length, "decided all-time", false, null]
  ]);

  function row(a, type){
    var isOwner = type==="owner", isMgmt = type==="management";
    var chip = isMgmt ? (a.role==="gm"?"GM":"AGM") : isOwner ? "OWNER" : "STAFF";
    var title, sub;
    if (isMgmt){
      var code = (lg._idToCode||{})[a.team_id];
      var club = (code && CG.TEAM && CG.TEAM[code] && CG.TEAM[code].name) || code || "a club";
      title = (a.nominee && a.nominee.gamertag) || "A member";
      sub = (a.role==="gm"?"General Manager":"Assistant GM")+" · "+esc(club);
    } else {
      title = ((a.profiles||{}).gamertag) || "Applicant";
      sub = isOwner ? CG.franchisePicksLine(a)
        : ((a.departments && a.departments.length)
            ? a.departments.map(function(k){ return esc(CG.staffDeptLabel(k)); }).join(" · ")
            : "Staff application");
    }
    var vb = ballots(type, a);
    var yes = vb.filter(function(v){ return v.vote==="approve"; }).length;
    var waiting = !votedByMe(type, a);
    return '<div class="card-b row-go" data-go="#/hub/application?id='+a.id+'&amp;type='+type+'" role="link" tabindex="0" '+
      'aria-label="Open '+esc(chip)+' application: '+esc(title)+'" '+
      'style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
      '<span class="chip '+(isOwner?"chip":"chip-chrome")+' chip-xs">'+esc(chip)+'</span>'+
      '<span style="flex:1;min-width:160px"><b style="font-family:var(--f-disp);display:block">'+esc(title)+'</b>'+
        '<span class="caption">'+sub+'</span></span>'+
      /* an owner application with no club chosen would approve into nothing — flag it in the
         queue so a reviewer sees it before casting the vote that decides it */
      (isOwner ? (a.awarded_club
        ? '<span class="chip chip-chrome chip-xs">'+esc(a.awarded_club)+'</span>'
        : '<span class="chip chip-warn chip-xs">no club chosen</span>') : "")+
      (waiting ? '<span class="chip chip-warn chip-xs">your ballot</span>' : '<span class="chip chip-win chip-xs">you voted</span>')+
      '<span class="caption">'+yes+' approve · '+(vb.length-yes)+' deny · '+vb.length+'/'+reviewers.length+'</span>'+
      '<span class="caption">'+(a.created_at?CG.fmtDay(Date.parse(a.created_at)):"")+'</span>'+
      '<span class="caption" aria-hidden="true">→</span></div>';
  }

  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>On the board</h3>'+
    '<span class="chip '+(pending?"chip-warn":"chip-win")+'">'+(pending?pending+" waiting":"clear")+'</span></div>';
  h += pending
    ? pendS.map(function(a){ return row(a,"staff"); }).join("")+
      pendO.map(function(a){ return row(a,"owner"); }).join("")+
      pendM.map(function(a){ return row(a,"management"); }).join("")
    : CG.deskEmpty("Nothing waiting. Members apply to own a club at <a href=\"#/owner\">#/owner</a> or to join the staff at <a href=\"#/staffapply\">#/staffapply</a>; owners nominate a GM or AGM from their Team HQ.");
  h += '</div>';

  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>The board</h3>'+
    '<span class="chip">'+reviewers.length+'</span></div>';
  h += reviewers.length
    ? reviewers.map(function(r){
        return '<div class="card-b" style="display:flex;gap:12px;align-items:center;border-top:1px solid var(--line-soft)">'+
          '<b style="font-family:var(--f-disp);flex:1">'+esc(r.gamertag||r.display_name||"—")+
            (r.id===me?' <span class="caption">(you)</span>':"")+'</b>'+
          '<span class="chip chip-xs">'+(r.role==="commissioner"?"Commissioner":"Staff")+'</span></div>';
      }).join("")
    : '<div class="card-b"><p class="caption" style="color:var(--amber-ink)"><b>No reviewers are assigned.</b> '+
      'A commissioner has to add staff to the Applications department before the vote can carry.</p></div>';
  h += '</div>';

  var decided = owner.filter(function(a){ return a.status!=="pending"; }).map(function(a){ return [a,"owner"]; })
    .concat(staff.filter(function(a){ return a.status!=="pending"; }).map(function(a){ return [a,"staff"]; }))
    .sort(function(x,y){ return Date.parse(y[0].updated_at||y[0].created_at||0) - Date.parse(x[0].updated_at||x[0].created_at||0); })
    .slice(0,10);
  h += '<div class="card"><div class="card-h"><h3>Recently decided</h3><a class="sec-link" href="#/hub/archive">Full archive</a></div>';
  h += decided.length ? decided.map(function(pair){
      var a = pair[0], ok = a.status==="approved";
      return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span class="chip '+(ok?"chip-win":"chip-loss")+' chip-xs">'+(ok?"APPROVED":"DENIED")+'</span>'+
        '<b style="font-family:var(--f-disp);flex:1;min-width:140px">'+esc(((a.profiles||{}).gamertag)||"Applicant")+'</b>'+
        '<span class="caption">'+esc(pair[1]==="owner"?"Owner application":"Staff application")+'</span>'+
        '<span class="caption">'+(a.decided_at||a.updated_at?CG.fmtDay(Date.parse(a.decided_at||a.updated_at)):"")+'</span></div>';
    }).join("")
    : CG.deskEmpty("No decisions on file yet.");
  h += '</div>';

  h += CG.deskCeiling("The board decides applications and nothing else. Handing out a role directly, "+
    "overriding a vote, or assigning a club by hand stays with the commissioners. You cannot vote on your own application.");
  return h;
};

/* ---------------------------------------------------------------- *
 * OFFICIALS' DESK — officiating
 * ---------------------------------------------------------------- */
CG.deskOfficials = function(){
  var lg = CG.lg, now = Date.now();
  var upcoming = (lg.schedule||[]).filter(function(g){ return g.status!=="final"; })
    .sort(function(a,b){ return a.at-b.at; });
  var ruled = (lg.schedule||[]).filter(function(g){ return g.status==="final" && (g.forfeit_team_id || g.voided); });
  var sus = (lg.suspensions||[]).filter(function(s){ return s.status==="active" && s.mode!=="warning"; });
  var warns = (lg.suspensions||[]).filter(function(s){ return s.status==="active" && s.mode==="warning"; });
  var open = (lg._actionReqs||[]).filter(function(a){ return a.status!=="resolved" && a.status!=="denied"; });

  var h = CG.deskHead("Officiating · game nights", "Officials’ desk",
    "Rule on the night: forfeits, voids, and discipline. Everything here is the league record the moment you save it.");

  h += CG.deskKpis([
    [(lg.tonight||[]).length, "games tonight", false, "#/schedule"],
    [open.length, "open cases", open.length>0, "#/hub/complaints"],
    [sus.length, "active suspensions", false, null],
    [ruled.length, "forfeits & voids", false, null]
  ]);

  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Games you can rule on</h3>'+
    '<span class="chip">next '+Math.min(upcoming.length,12)+'</span></div>';
  h += upcoming.length ? upcoming.slice(0,12).map(function(g){
      var soon = g.at - now < 6*3600000;
      return '<div class="card-b" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span class="mono" style="font-size:11.5px;color:var(--steel);min-width:170px">'+CG.fmtFull(g.at)+'</span>'+
        (g.stage==="preseason"?'<span class="chip chip-xs">PRE</span>':"")+
        (soon?'<span class="chip chip-warn chip-xs">soon</span>':"")+
        '<span class="teamcell">'+CG.crest(g.away,20)+'<b class="mono" style="font-size:12px">'+esc(g.away)+'</b></span>'+
        '<span class="caption">@</span>'+
        '<span class="teamcell">'+CG.crest(g.home,20)+'<b class="mono" style="font-size:12px">'+esc(g.home)+'</b></span>'+
        '<span style="margin-left:auto;display:inline-flex;gap:6px">'+
          '<a class="btn btn-ghost btn-sm" href="#/matchup/'+esc(g.id)+'">Open</a>'+
          '<button class="btn btn-ghost btn-sm" data-desk-forfeit="'+esc(g.id)+'">Forfeit / void</button>'+
        '</span></div>';
    }).join("")
    : CG.deskEmpty("No games on the schedule to rule on.");
  h += '</div>';

  if (ruled.length){
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Rulings on the record</h3>'+
      '<span class="chip">'+ruled.length+'</span></div>'+
      ruled.slice(0,10).map(function(g){
        var code = g.forfeit_team_id ? (lg._idToCode||{})[g.forfeit_team_id] : null;
        return '<div class="card-b" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
          '<span class="mono" style="font-size:11.5px;color:var(--steel);min-width:120px">'+CG.fmtDay(g.at)+'</span>'+
          '<span class="chip '+(code?"chip-loss":"chip")+' chip-xs">'+(code?esc(code)+" FORFEIT":"VOID")+'</span>'+
          '<span style="flex:1;min-width:120px" class="caption">'+esc(g.away)+' @ '+esc(g.home)+'</span>'+
          '<button class="btn btn-ghost btn-sm" data-desk-unforfeit="'+esc(g.id)+'">Put it back</button></div>';
      }).join("")+'</div>';
  }

  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Active discipline</h3>'+
    '<span class="chip">'+sus.length+(warns.length?' + '+warns.length+' warned':'')+'</span></div>';
  h += (sus.length||warns.length) ? sus.concat(warns).map(function(s){
      var p = CG.playerById(lg, s.playerId);
      var nm = p ? p.tag : (s.playerName || (lg._profName||{})[s.profile_id] || "A player");
      var len = s.mode==="warning" ? "warning"
        : s.mode==="date" ? ("until "+(s.endsAt?CG.fmtDay(Date.parse(s.endsAt)):"further notice"))
        : s.mode==="seasons" ? ("through Season "+(s.untilSeason||"—"))
        : (s.games+" game"+(s.games===1?"":"s"));
      return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<b style="font-family:var(--f-disp)">'+esc(nm)+'</b>'+
        '<span class="caption" style="flex:1;min-width:120px">'+esc(s.reason||"")+'</span>'+
        '<span class="chip '+(s.mode==="warning"?"chip-warn":"chip-loss")+' chip-xs">'+esc(len)+'</span>'+
        (s.id?'<button class="btn btn-ghost btn-sm" data-desk-lift="'+esc(s.id)+'" data-name="'+esc(nm)+'">Lift</button>':"")+
        (p?'<a class="btn btn-ghost btn-sm" href="'+CG.playerRoute(p)+'">Profile</a>':"")+'</div>';
    }).join("")
    : CG.deskEmpty("Nobody is serving anything. Discipline is issued from a case — open the <a href=\"#/hub/complaints\">case queue</a> and rule from the case itself, so the ruling stays attached to the evidence.");
  h += '</div>';

  h += '<div class="card"><div class="card-h"><h3>Cases waiting on a ruling</h3>'+
    '<a class="sec-link" href="#/hub/complaints">Open the queue</a></div>';
  h += open.length ? open.slice(0,6).map(function(a){
      var meta = CG.ACTION_META[a.type] || { label:a.type };
      return '<div class="card-b row-go" data-go="#/hub/complaint?id='+esc(a.id)+'" role="link" tabindex="0" '+
        'style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span class="chip chip-warn chip-xs" style="text-transform:capitalize">'+esc(a.status||"open")+'</span>'+
        '<b style="font-family:var(--f-disp);flex:1;min-width:140px">'+esc(a.subject||meta.label)+'</b>'+
        '<span class="caption">'+esc(meta.label)+'</span>'+
        '<span class="caption" aria-hidden="true">→</span></div>';
    }).join("")
    : CG.deskEmpty("The queue is clear.");
  h += '</div>';

  h += CG.deskCeiling("<b>Where your authority ends.</b> An official can suspend for up to <b>10 games</b> or "+
    "<b>30 days</b>. Season-long bans, permanent bans, and any ruling against a commissioner are a commissioner’s call — "+
    "leave the case open and escalate. You cannot rule on a case you are party to, or on yourself.");
  return h;
};

CG.undoForfeitPrompt = function(id){
  CG.confirm("Put this game back on the schedule?",
    "The forfeit or void is reversed, the score is cleared, and the game returns to <b>scheduled</b>. "+
    "The reversal is posted to the staff channel and written to the transaction log.",
    "Reverse the ruling", function(){
      CG.sb.rpc("undo_forfeit", { p_game: id }).then(function(r){
        if (r.error){ CG.toast(r.error.message || "Couldn’t reverse it", "err"); return; }
        CG.toast("Back on the schedule", "ok");
        CG.reloadLeague();
      });
    });
};

/* ---------------------------------------------------------------- *
 * OPERATIONS DESK — operations
 * ---------------------------------------------------------------- */
CG.deskOperations = function(){
  var lg = CG.lg, now = Date.now();
  var future = (lg.schedule||[]).filter(function(g){ return g.status!=="final"; })
    .sort(function(a,b){ return a.at-b.at; });
  var overdue = (lg.schedule||[]).filter(function(g){ return g.status!=="final" && g.at < now - 90*60000; });
  var nextNight = future.length ? CG.etYMD(future[0].at) : null;
  var tonight = nextNight ? future.filter(function(g){ return CG.etYMD(g.at) === nextNight; }) : [];

  var h = CG.deskHead("Operations · the schedule", "Operations desk",
    "Move a game, and hand clubs their lobby code. The EA import matches on clubs plus date, so stats follow a "+
    "rescheduled game on their own — the code never changes.");

  h += CG.deskKpis([
    [future.length, "games to play", false, null],
    [overdue.length, "past due, no result", overdue.length>0, null],
    [tonight.length, "on the next game night", false, null],
    [(lg.allResults||[]).length, "finals in the book", false, null]
  ]);

  if (overdue.length){
    h += '<div class="card" style="margin-bottom:18px;border-color:var(--amber)"><div class="card-h">'+
      '<h3>Past their slot with no result</h3><span class="chip chip-warn">'+overdue.length+'</span></div>'+
      overdue.slice(0,8).map(function(g){
        return '<div class="card-b" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
          '<span class="mono" style="font-size:11.5px;color:var(--steel);min-width:170px">'+CG.fmtFull(g.at)+'</span>'+
          '<span class="teamcell">'+CG.crest(g.away,20)+'<b class="mono" style="font-size:12px">'+esc(g.away)+'</b></span>'+
          '<span class="caption">@</span>'+
          '<span class="teamcell">'+CG.crest(g.home,20)+'<b class="mono" style="font-size:12px">'+esc(g.home)+'</b></span>'+
          '<button class="btn btn-ghost btn-sm" style="margin-left:auto" data-desk-move="'+esc(g.id)+'">Reschedule</button></div>';
      }).join("")+
      '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">A game sitting here means the EA import found no match. '+
      'Either it wasn’t played — chase the clubs, then hand it to an official for a forfeit — or it was played on a club that isn’t linked yet.</span></div></div>';
  }

  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Upcoming slate</h3>'+
    '<span class="chip">next '+Math.min(future.length,16)+'</span></div>';
  h += future.length ? future.slice(0,16).map(function(g){
      return '<div class="card-b" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span class="mono" style="font-size:11.5px;color:var(--steel);min-width:170px">'+CG.fmtFull(g.at)+'</span>'+
        (g.stage==="preseason"?'<span class="chip chip-xs">PRE</span>':"")+
        '<span class="teamcell">'+CG.crest(g.away,20)+'<b class="mono" style="font-size:12px">'+esc(g.away)+'</b></span>'+
        '<span class="caption">@</span>'+
        '<span class="teamcell">'+CG.crest(g.home,20)+'<b class="mono" style="font-size:12px">'+esc(g.home)+'</b></span>'+
        '<span style="margin-left:auto;display:inline-flex;gap:6px">'+
          '<a class="btn btn-ghost btn-sm" href="#/matchup/'+esc(g.id)+'">Open</a>'+
          '<button class="btn btn-chrome btn-sm" data-desk-move="'+esc(g.id)+'">Reschedule</button></span></div>';
    }).join("")
    : CG.deskEmpty("Nothing scheduled. A commissioner generates the season from the dates in Seasons — you move games once they exist.");
  h += '</div>';

  h += '<div class="card"><div class="card-h"><h3>Lobby codes'+(nextNight?' — '+CG.fmtDate(nextNight):"")+'</h3>'+
    '<span class="chip">private lobby</span></div>';
  h += tonight.length
    ? '<div class="tblwrap"><table class="tbl keepcols"><caption>Codes for the next game night</caption>'+
      '<thead><tr><th class="tleft">When</th><th class="tleft">Matchup</th><th class="tright">Code</th></tr></thead><tbody>'+
      tonight.map(function(g){
        return '<tr><td class="tleft mono" style="font-size:11.5px">'+CG.fmtFull(g.at)+'</td>'+
          '<td class="tleft">'+esc(g.away)+' @ '+esc(g.home)+'</td>'+
          '<td class="tright mono"><b>'+esc(g.code||"—")+'</b></td></tr>';
      }).join("")+'</tbody></table></div>'
    : CG.deskEmpty("No game night queued up.");
  h += '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Codes are minted with the schedule and are '+
    '<b>stable across a reschedule</b> (Rule 4.2) — moving a game never invalidates the code a club already has. Players see theirs 30 minutes before puck drop.</span></div></div>';

  h += CG.deskCeiling("Operations moves games. Generating or clearing a schedule, changing season dates, and reopening a "+
    "final belong to the commissioners — a reschedule can’t touch a game that’s already final.");
  return h;
};

CG.opsReschedulePrompt = function(id){
  var g = (CG.lg.schedule||[]).find(function(x){ return x.id===id; });
  if (!g){ CG.toast("That game isn’t on the schedule any more","err"); return; }
  var d = new Date(g.at);
  var ymd = CG.etYMD(g.at);
  var hm = (("0"+d.getHours()).slice(-2))+":"+(("0"+d.getMinutes()).slice(-2));
  CG.modal("Reschedule — "+esc(g.away)+" @ "+esc(g.home),
    '<p class="caption" style="margin-bottom:12px">Currently <b>'+CG.fmtFull(g.at)+'</b>. Times are Eastern.</p>'+
    '<label class="fld"><span>New date</span><input id="rsD" type="date" value="'+esc(ymd)+'"></label>'+
    '<label class="fld"><span>New time (ET)</span><input id="rsT" type="time" value="'+esc(hm)+'"></label>'+
    '<p class="caption">The lobby code stays the same, and the EA import will match the game on its new date.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="rsGo">Move the game</button>');
  document.getElementById("rsGo").addEventListener("click", function(){
    var dv = document.getElementById("rsD").value, tv = document.getElementById("rsT").value;
    if (!dv || !tv){ CG.toast("Pick a date and a time","err"); return; }
    var btn = this; btn.disabled = true;
    CG.sb.rpc("ops_reschedule_game", { p_game: id, p_at: CG.etISO(dv, tv) }).then(function(r){
      btn.disabled = false;
      if (r.error){ CG.toast(r.error.message || "Couldn’t move it","err"); return; }
      if (CG.closeOverlay) CG.closeOverlay();
      CG.toast("Moved — the clubs have been notified","ok");
      CG.reloadLeague();
    });
  });
};

/* ---------------------------------------------------------------- *
 * TRANSACTIONS DESK — transactions
 * ---------------------------------------------------------------- */
CG.deskTransactions = function(){
  var lg = CG.lg;
  var cap = CG.CAP || 60000000;
  var byClub = {};
  (lg.players||[]).forEach(function(p){
    if (!p.team) return;
    var e = byClub[p.team] || (byClub[p.team] = { n:0, used:0 });
    e.n++; e.used += (CG.playerSalary(lg, p.id) || 0);
  });
  var clubs = Object.keys(byClub).sort();
  var over = clubs.filter(function(c){ return byClub[c].used > cap; });
  var rosterMax = (CG.SEASON && CG.SEASON.roster_max) || 15;
  var short = clubs.filter(function(c){ return byClub[c].n < rosterMax; });

  /* deskHead escapes the eyebrow and title — pass raw text, not pre-escaped entities. */
  var h = CG.deskHead("Transactions · trades & the cap", "Transactions desk",
    "Every trade in the league, and where each club sits against the "+CG.fmtMoney(cap)+" cap. "+
    "Clubs accept their own trades — this desk is the audit.");

  h += CG.deskKpis([
    ["—", "trades pending", false, null, "txPend"],
    [over.length, "clubs over the cap", over.length>0, null],
    [short.length, "clubs under the roster floor", false, null],
    [clubs.length, "clubs with a roster", false, null]
  ]);

  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Cap &amp; roster compliance</h3>'+
    '<span class="chip'+(over.length?" chip-warn":" chip-win")+'">'+(over.length?over.length+" over":"all compliant")+'</span></div>';
  h += clubs.length
    ? '<div class="tblwrap"><table class="tbl keepcols"><caption>Cap compliance by club</caption>'+
      '<thead><tr><th class="tleft">Club</th><th class="tright">Roster</th><th class="tright">Cap used</th>'+
      '<th class="tright">Headroom</th><th class="tleft">Status</th></tr></thead><tbody>'+
      clubs.map(function(c){
        var e = byClub[c], room = cap - e.used, isOver = room < 0, thin = e.n < rosterMax;
        return '<tr><td class="tleft"><span class="teamcell">'+CG.crest(c,20)+
            '<b class="mono" style="font-size:12px">'+esc(c)+'</b></span></td>'+
          '<td class="tright mono">'+e.n+' / '+rosterMax+'</td>'+
          '<td class="tright mono">'+CG.fmtMoney(e.used)+'</td>'+
          '<td class="tright mono"'+(isOver?' style="color:var(--red-ink)"':"")+'>'+(isOver?"−":"")+CG.fmtMoney(Math.abs(room))+'</td>'+
          '<td class="tleft">'+(isOver?'<span class="chip chip-loss chip-xs">OVER CAP</span>'
            : thin?'<span class="chip chip-warn chip-xs">SHORT '+(rosterMax-e.n)+'</span>'
            :'<span class="chip chip-win chip-xs">OK</span>')+'</td></tr>';
      }).join("")+'</tbody></table></div>'
    : CG.deskEmpty("No rosters yet — compliance starts once clubs are built.");
  h += '</div>';

  h += '<div id="txBody"><p class="caption">Loading trades…</p></div>';

  h += CG.deskCeiling("This desk reads. Accepting or declining a trade is the receiving club’s call, and the cap check "+
    "runs inside the database on every accept — a trade that would put either club over is refused before it lands. "+
    "If something here needs undoing, open a case: reversing a completed trade is a commissioner action.");
  return h;
};

CG.AFTER._deskTransactions = function(){
  var body = document.getElementById("txBody");
  if (!body || !CG.sb || !CG.hasDept("transactions")) return;
  var lg = CG.lg, codeOf = lg._idToCode || {}, names = lg._profName || {};
  function who(ids){
    return (ids||[]).map(function(i){ return esc(names[i] || "a player"); }).join(", ") || "—";
  }
  Promise.all([
    CG.sb.from("trades").select("*").order("created_at", { ascending:false }).limit(60),
    CG.sb.from("transactions").select("*").order("created_at", { ascending:false }).limit(20)
  ]).then(function(res){
    var tr = res[0], tx = res[1];
    /* Fail loud: an RLS-blocked read comes back as an empty list, which is
       indistinguishable from a quiet league. Say so rather than imply "no trades". */
    if (tr && tr.error){
      body.innerHTML = '<div class="card"><div class="card-b"><p class="caption" style="color:var(--red-ink)">'+
        '<b>Couldn’t load the trade ledger.</b> '+esc(tr.error.message)+' — this is not the same as "no trades". Reload; if it persists, report it.</p></div></div>';
      return;
    }
    var trades = (tr && tr.data) || [];
    var pending = trades.filter(function(t){ return t.status==="proposed"; });
    var pd = document.getElementById("txPend");
    if (pd) pd.textContent = pending.length;

    function tradeRow(t){
      var f = codeOf[t.from_team_id] || "?", to = codeOf[t.to_team_id] || "?";
      var chip = t.status==="proposed" ? "chip-warn" : t.status==="accepted" ? "chip-win" : "chip";
      var np = (t.offered_pick_ids||[]).length, nq = (t.requested_pick_ids||[]).length;
      return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span class="chip '+chip+' chip-xs" style="text-transform:uppercase">'+esc(t.status||"")+'</span>'+
        '<span class="teamcell">'+CG.crest(f,20)+'<b class="mono" style="font-size:12px">'+esc(f)+'</b></span>'+
        '<span class="caption">→</span>'+
        '<span class="teamcell">'+CG.crest(to,20)+'<b class="mono" style="font-size:12px">'+esc(to)+'</b></span>'+
        '<span style="flex:1;min-width:200px"><span class="caption">'+who(t.offered_profile_ids)+
          (np?' + '+np+' pick'+(np>1?"s":""):"")+' <b>for</b> '+who(t.requested_profile_ids)+
          (nq?' + '+nq+' pick'+(nq>1?"s":""):"")+'</span></span>'+
        '<span class="caption">'+(t.created_at?CG.fmtDay(Date.parse(t.created_at)):"")+'</span></div>';
    }

    var h = '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Trades on the table</h3>'+
      '<span class="chip'+(pending.length?" chip-warn":"")+'">'+pending.length+'</span></div>'+
      (pending.length ? pending.map(tradeRow).join("")
        : CG.deskEmpty("Nothing proposed right now. Offers appear here the moment a GM sends one, in either direction."))+
      '</div>';

    var done = trades.filter(function(t){ return t.status!=="proposed"; }).slice(0,15);
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Trade history</h3>'+
      '<span class="chip">'+done.length+'</span></div>'+
      (done.length ? done.map(tradeRow).join("") : CG.deskEmpty("No completed trades yet."))+'</div>';

    var feed = (tx && !tx.error && tx.data) || [];
    h += '<div class="card"><div class="card-h"><h3>League transaction log</h3><span class="chip">latest '+feed.length+'</span></div>'+
      (feed.length ? feed.map(function(x){
        return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
          '<span class="chip chip-xs" style="text-transform:uppercase">'+esc(x.type||"move")+'</span>'+
          '<span style="flex:1;min-width:200px">'+CG.deskDesc(x.description)+'</span>'+
          '<span class="caption">'+(x.created_at?CG.fmtDay(Date.parse(x.created_at)):"")+'</span></div>';
      }).join("") : CG.deskEmpty("Nothing logged yet."))+'</div>';

    body.innerHTML = h;
  });
};

/* ---------------------------------------------------------------- *
 * COMMUNITY DESK — community
 * ---------------------------------------------------------------- */
CG.deskCommunity = function(){
  var lg = CG.lg, now = Date.now();
  var profs = (lg._profilesRaw||[]).filter(function(p){ return !p.banned; });
  var fresh = profs.filter(function(p){ return p.created_at && (now - Date.parse(p.created_at)) < 14*86400000; })
    .sort(function(a,b){ return Date.parse(b.created_at) - Date.parse(a.created_at); });
  var notInGuild = profs.filter(function(p){ return !p.in_guild; });
  var noEa = profs.filter(function(p){ return !p.ea_id; });

  /* Group the whole population by the canonical pool state so the desk speaks the
     same language as the rest of the site — an unrostered signup is not a free agent. */
  var buckets = {}, order = [];
  profs.forEach(function(p){
    var st = CG.poolState(p.id);
    if (!buckets[st.key]){ buckets[st.key] = { label:st.label, chip:st.chip, list:[] }; order.push(st.key); }
    buckets[st.key].list.push(p);
  });
  order.sort(function(a,b){ return buckets[b].list.length - buckets[a].list.length; });

  var h = CG.deskHead("Community · onboarding & moderation", "Community desk",
    "Who just arrived, who hasn’t finished signing up, and who never made it into the Discord. "+
    "Everyone on this page is someone worth a message.");

  h += CG.deskKpis([
    [profs.length, "members", false, null],
    [fresh.length, "joined in 14 days", false, null],
    [notInGuild.length, "not in the Discord", notInGuild.length>0, null],
    [noEa.length, "no EA gamertag on file", noEa.length>0, null]
  ]);

  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>New faces</h3>'+
    '<span class="chip">last 14 days</span></div>';
  h += fresh.length ? fresh.slice(0,12).map(function(p){
      var st = CG.poolState(p.id);
      return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<b style="font-family:var(--f-disp);flex:1;min-width:140px">'+esc(p.gamertag||p.display_name||"—")+'</b>'+
        '<span class="chip '+esc(st.chip)+' chip-xs">'+esc(st.label)+'</span>'+
        (p.in_guild?'':'<span class="chip chip-warn chip-xs">not in Discord</span>')+
        (p.ea_id?'':'<span class="chip chip-xs">no EA id</span>')+
        '<span class="caption">'+CG.fmtDay(Date.parse(p.created_at))+'</span></div>';
    }).join("")
    : CG.deskEmpty("Nobody new in the last two weeks.");
  h += '</div>';

  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Where everyone stands</h3>'+
    '<span class="chip">'+profs.length+' members</span></div>';
  h += order.map(function(k){
    var b = buckets[k];
    return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
      '<span class="chip '+esc(b.chip)+' chip-xs">'+esc(b.label)+'</span>'+
      '<b class="num" style="font-family:var(--f-disp);min-width:44px">'+b.list.length+'</b>'+
      '<span class="caption" style="flex:1;min-width:180px">'+
        esc(b.list.slice(0,6).map(function(p){ return p.gamertag||p.display_name||"—"; }).join(", "))+
        (b.list.length>6?" +"+(b.list.length-6)+" more":"")+'</span></div>';
  }).join("");
  h += '</div>';

  if (notInGuild.length){
    h += '<div class="card"><div class="card-h"><h3>Signed up on the site, missing from Discord</h3>'+
      '<span class="chip chip-warn">'+notInGuild.length+'</span></div>'+
      notInGuild.slice(0,15).map(function(p){
        return '<div class="card-b" style="display:flex;gap:12px;align-items:center;border-top:1px solid var(--line-soft)">'+
          '<b style="font-family:var(--f-disp);flex:1">'+esc(p.gamertag||p.display_name||"—")+'</b>'+
          '<span class="chip chip-xs">'+esc(p.role||"member")+'</span></div>';
      }).join("")+
      '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Signing in with Discord adds a member to the server automatically, '+
      'so anyone here either signed up before that shipped or left the server. They get no game-night pings until they’re back in.</span></div></div>';
  }

  h += CG.deskCeiling("Community handles the soft end of moderation: you can issue a <b>formal warning</b> from a case. "+
    "Suspensions belong to the officiating department and bans to the commissioners — if something needs more than a warning, "+
    "leave the case open and hand it up.");
  return h;
};

/* ---------------------------------------------------------------- *
 * NEWSROOM — media
 * ---------------------------------------------------------------- */
CG.deskNewsroom = function(){
  var arts = (CG.CONTENT.articles||[]);
  var h = CG.deskHead("Media · the newsroom", "Newsroom",
    "Publish to the site and to Discord’s #news in one move, and set the power rankings the homepage reads from.");
  h += CG.deskKpis([
    [arts.length, "stories published", false, null],
    [arts.filter(function(a){ return /CGHL Wire/i.test(a.author||""); }).length, "auto-written recaps", false, null],
    [(CG.lg.powerRankings||[]).length, "clubs ranked", false, null],
    [CG.lg.prManual ? "manual" : "auto", "ranking mode", false, null]
  ]);
  h += CG.admNewsLive();
  h += '<div style="margin-top:28px">'+CG.admRankingsLive()+'</div>';
  h += CG.deskCeiling("Media writes and edits. Taking a story back off the site is a commissioner action — "+
    "correct it in place instead, which is what the Edit button is for. Media also holds <b>no ballot</b>: "+
    "no staff vote, no rule change, no season award (Rule 2.7). In exchange it's the one department "+
    "that may also run a club — the newsroom reports on the league rather than deciding for it.");
  return h;
};

/* ---------------------------------------------------------------- *
 * DRAFT ROOM — draft
 * ---------------------------------------------------------------- */
CG.deskDraftRoom = function(){
  var h = CG.deskHead("Draft · the war room", "Draft room",
    "Run the night: the clock, the pause, the skip, and picking for a club that went dark.");
  h += CG.admDraftLive();
  h += CG.deskCeiling("You run the evening; the commissioners own the season. Building the board, dropping the puck, "+
    "concluding the draft, and reversing a pick already made stay with the office.");
  return h;
};

/* ---------------------------------------------------------------- *
 * The registry — one entry per department.
 * `dept` is the gate, `key` is the hub route, and `after` runs post-render.
 * ---------------------------------------------------------------- */
CG.STAFF_DESKS = [
  { key:"reviewboard", dept:"applications", label:"Review Board",       icon:"flag",   render:function(){ return CG.deskReviewBoard(); },  after:function(){ } },
  { key:"officials",   dept:"officiating",  label:"Officials’ desk",    icon:"shield", render:function(){ return CG.deskOfficials(); },    after:function(){ CG.AFTER._deskOfficials(); } },
  { key:"opsdesk",     dept:"operations",   label:"Operations desk",    icon:"cal",    render:function(){ return CG.deskOperations(); },   after:function(){ CG.AFTER._deskOperations(); } },
  { key:"draftroom",   dept:"draft",        label:"Draft room",         icon:"play",   render:function(){ return CG.deskDraftRoom(); },    after:function(){ CG.AFTER._admDraft(); } },
  { key:"transdesk",   dept:"transactions", label:"Transactions desk",  icon:"swap",   render:function(){ return CG.deskTransactions(); }, after:function(){ CG.AFTER._deskTransactions(); } },
  { key:"community",   dept:"community",    label:"Community desk",     icon:"users",  render:function(){ return CG.deskCommunity(); },    after:function(){ } },
  { key:"statsmgr",    dept:"statistics",   label:"Stats manager",      icon:"chart",  render:function(qs){ return CG.hubStatsManager(qs); }, after:function(qs){ CG.AFTER._statsMgr(qs); } },
  { key:"newsroom",    dept:"media",        label:"Newsroom",           icon:"doc",    render:function(){ return CG.deskNewsroom(); },     after:function(){ CG.AFTER._admNewsLive(); CG.AFTER._admRankings(); } }
];

CG.staffDeskFor = function(key){
  for (var i = 0; i < CG.STAFF_DESKS.length; i++){
    if (CG.STAFF_DESKS[i].key === key) return CG.STAFF_DESKS[i];
  }
  return null;
};

/* ---------------------------------------------------------------- *
 * Post-render wiring
 * ---------------------------------------------------------------- */
CG.AFTER._deskOfficials = function(){
  document.querySelectorAll("[data-desk-forfeit]").forEach(function(b){
    b.addEventListener("click", function(){ CG.declareForfeitPrompt(this.getAttribute("data-desk-forfeit")); });
  });
  document.querySelectorAll("[data-desk-unforfeit]").forEach(function(b){
    b.addEventListener("click", function(){ CG.undoForfeitPrompt(this.getAttribute("data-desk-unforfeit")); });
  });
  document.querySelectorAll("[data-desk-lift]").forEach(function(b){
    b.addEventListener("click", function(){
      CG.liftUserSuspension(this.getAttribute("data-desk-lift"), this.getAttribute("data-name"));
    });
  });
};
CG.AFTER._deskOperations = function(){
  document.querySelectorAll("[data-desk-move]").forEach(function(b){
    b.addEventListener("click", function(){ CG.opsReschedulePrompt(this.getAttribute("data-desk-move")); });
  });
};

/* ---------------------------------------------------------------- *
 * Routing — chained onto whatever already handles #/hub.
 * ---------------------------------------------------------------- */
CG._deskHubRoute = CG.ROUTES.hub;
CG.ROUTES.hub = function(param, qs){
  var desk = CG.staffDeskFor(param);
  if (desk){
    if (!CG.hasDept(desk.dept)){
      return CG.unauthorized("The "+desk.label+" is limited to the "+
        CG.staffDeptLabel(desk.dept)+" department. A commissioner assigns departments from Users & roles.");
    }
    return CG.hubShell(desk.key, desk.render(qs || {}));
  }
  return CG._deskHubRoute(param, qs);
};

CG._deskHubAfter = CG.AFTER.hub;
CG.AFTER.hub = function(param, qs){
  var desk = CG.staffDeskFor(param);
  if (desk && CG.hasDept(desk.dept)){
    /* Return rather than fall through — the same convention the other full-page hub
       sections use. Falling through would reach part_live's own statsmgr branch and
       bind every stats-manager handler a second time. Row clicks and pref toggles are
       delegated on document, so nothing here depends on the generic tail running. */
    try { desk.after(qs || {}); }
    catch (e){ if (window.console) console.error("desk wiring failed: "+desk.key, e); }
    return;
  }
  if (CG._deskHubAfter) CG._deskHubAfter(param, qs);
};
