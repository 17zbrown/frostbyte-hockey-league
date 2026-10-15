/* ================================================================
   CHEL GAMING — LEAGUE ENGINE (pure JS, no DOM)
   Deterministic seeded simulation of Season 1. Every number shown in
   the prototype is derived from these simulated game results — the
   standings ARE the sum of results, the leaders ARE the sum of box
   scores, the ratings ARE the documented formula.
   Runs in the browser (window.CG) and in Node (module.exports) for
   invariant testing.
   ================================================================ */
"use strict";
var CG = (typeof CG !== "undefined") ? CG : {};

/* ---------- registration state ----------
   Somebody who has already signed up must never be told to sign up again. Every prompt on the
   site keys off this ONE answer — the Register nav item (a dropdown on mobile), the hero, the
   registration strip, the ticker, the footer and every section link — so they cannot disagree
   with each other as more get added. CG.auth.registration is the member's own row for the OPEN
   season, loaded at sign-in, so a guest is correctly "not registered" and still sees the ask. */
CG.isRegisteredNow = function(){
  var r = CG.auth && CG.auth.registration;
  if (!r) return false;
  /* a withdrawn sign-up is NOT a sign-up — that member should be invited back in */
  var st = String(r.status || "").toLowerCase();
  return st !== "withdrawn" && st !== "removed" && st !== "denied";
};
/* the nav array is built once at boot, BEFORE auth resolves, so the Register item is filtered
   here at render time instead — that also makes it disappear the moment someone registers,
   without a reload */
CG.navVisible = function(){
  return (CG.NAV || []).filter(function(n){
    return n[1] !== "#/register" || !CG.isRegisteredNow();
  });
};

/* ---------- seeded PRNG (mulberry32) ---------- */
CG.makeRng = function(seed){
  var t = seed >>> 0;
  return function(){
    t += 0x6D2B79F5;
    var r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

/* ---------- constants ---------- */
CG.SEASON = { id:"S1", label:"Season 1", year:2026, weeks:10, completedWeeks:6 };
/* Demo clock: the prototype's "now" — Wed, Jul 15 2026, 8:45 PM ET.
   Tonight's puck drops are 9:00 / 9:40 PM ET, codes release T-30min. */
CG.DEMO_NOW_ISO = "2026-07-15T20:45:00-04:00";

CG.TEAMS = [
  { code:"ANA", name:"Anaheim Ducks",     city:"Nord Harbor",  arena:"The Icebox",    div:"East", color:"#4FE3E6", est:1 },
  { code:"CBR", name:"Circuit Breakers",  city:"Voltage City", arena:"The Grid",      div:"East", color:"#FFD166", est:1 },
  { code:"ICE", name:"Midnight Icehawks", city:"Duskmoor",     arena:"Nest Arena",    div:"East", color:"#A99CF0", est:1 },
  { code:"TUN", name:"Tundra Wolves",     city:"Greywater",    arena:"Den Arena",     div:"East", color:"#8FB8D6", est:1 },
  { code:"AUR", name:"Aurora Blades",     city:"Northshore",   arena:"Lights Center", div:"West", color:"#7CE0A8", est:1 },
  { code:"POL", name:"Polar Reign",       city:"Whitecliff",   arena:"The Throne",    div:"West", color:"#C7D8E6", est:1 },
  { code:"TUC", name:"Tucson Vipers",     city:"Ashfall",      arena:"The Pit",       div:"West", color:"#F47A38", est:1 },
  { code:"YET", name:"Steel Yetis",       city:"Iron Ridge",   arena:"The Foundry",   div:"West", color:"#E07A9A", est:1 }
];
CG.TEAM = {}; CG.TEAMS.forEach(function(t){ CG.TEAM[t.code]=t; });

/* Hidden pre-sim team strength (drives sim only; displayed ratings are
   computed AFTER the fact from results + stats, never from this). */
CG.TEAM_STRENGTH = { TUC:.78, CBR:.72, ICE:.66, AUR:.62, YET:.55, TUN:.52, POL:.42, ANA:.40 };

/* ---------- player pool ---------- */
CG.GAMERTAGS = [
"Frostbyte","SnipeShowVI","TopShelfTy","GlassEater","BarDownBo","IronWall_31","Mitts McGee","Dangle Dan",
"CellyKing","SauceBoss77","OneTimerOtto","ClapBombCarl","BreakawayBex","FiveHoleFinn","TapeToTapeTee","BodycheckBruno",
"PuckP1rate","WheelSnipe","BennyBiscuit","CrossbarCzar","DekeDynasty","FlowMaster19","GinoGoalline","HatTrickHavoc",
"IcePickIzzy","JukeCityJax","KrakenKross","LettuceLarry","MuffinMits","NettminderNko","OvertimeOwen","PipesPatrol",
"QuickStickQ","RocketRiddle","SlotMachineSy","ToeDragTony","UpperNinety","VulcanizedVic","WristerWes","XFactorXan",
"YoungGunYuri","ZambroniZed","ApexAngles","BluePaintBully","ChirpMachine","DumpAndChase","EmptyNetEzra","ForecheckFranz",
"GrittyGrinder","HipCheckHank","InterferenceIke","JerseyJockey","KneeDeepKen","LumberjackLo","MisconductMax","NoLookNate",
"OddManOllie","PenaltyKillPax","QuietRoomQuinn","ReboundRex","ShortSideSho","TwigTwirler","UnderdogUdo","VelvetHands",
"WraparoundWill","YardSaleYan","ZoneEntryZane","BackdoorBanks","CreaseCzar","DeflectDex","EdgeworkEli","FlashTheLeather",
"GloveSideGus","HighSlotHugo","IntermissionIvy","JackpotJett","KillerCrossover","LaserLouie","MendozaMagic","NiftyMitts",
"OpenIceOpie","PointShotPico","QuickReleaseQi","RagTheRubber","StonewallSt4n","TendyTornado","UppercutUma","VezinaVibes",
"WindmillWade","CrashTheNet","BetweenThePipes","SinBinSid","BreakoutBravo","CycleGameCy","DoorstepDario","ElbowsUpEd",
"FreshSheetFae","GongShowGabe","HeelToHeelHu","InsuranceGoal","JourneymanJoe","KeepAwayKai","LateHitLenny","MittsOfSilk",
"NorthSouthNed","OffsideOscar","PylonPete","QuarterSawnQ","RingerRudy","SweepTheLeg","TruculentTroy","BardownBetty"
];

CG.POS_SLOTS = ["LW","LW","C","C","RW","RW","LD","LD","RD","RD","G","G"];
CG.POS_NAME = { LW:"Left Wing", C:"Center", RW:"Right Wing", LD:"Left Defense", RD:"Right Defense", G:"Goaltender" };
/* v3.12 — rink order, LW C RW LD RD G, as a rank anyone can sort by. It lives HERE, beside the
   names, because part5a_public.js and part6_hub.js both use it and part_live.js loads after both:
   referencing it from there worked only because every call happens at render time, which is the
   kind of luck that breaks the first time a build ships without part_live. */
CG.POS_RANK = { LW:1, C:2, RW:3, LD:4, RD:5, G:6 };
/* the same order spelled out, so a column rendered with CG.POS_NAME sorts identically */
CG.POS_RANK_LONG = { "left wing":1, "center":2, "right wing":3, "left defense":4, "right defense":5, "goaltender":6 };
/* rink order for any list of players: LW, C, RW, LD, RD, G, then a stable tiebreak by name */
CG.byPosition = function(getPos, getName){
  getPos = getPos || function(p){ return p && p.pos; };
  getName = getName || function(p){ return (p && (p.tag || p.gamertag || p.name)) || ""; };
  return function(a, b){
    var ra = CG.POS_RANK[String(getPos(a)||"").toUpperCase()] || 99;
    var rb = CG.POS_RANK[String(getPos(b)||"").toUpperCase()] || 99;
    return ra - rb || String(getName(a)).localeCompare(String(getName(b)));
  };
};

CG.SKATER_ARCH = { LW:["Sniper","Power Forward","Grinder"], C:["Playmaker","Two-Way Forward","Sniper"], RW:["Sniper","Power Forward","Playmaker"],
                   LD:["Offensive Defenseman","Shutdown","Two-Way Defenseman"], RD:["Two-Way Defenseman","Shutdown","Offensive Defenseman"] };
CG.G_ARCH = ["Butterfly","Hybrid","Standup"];
/* v3.21 — ONE console vocabulary, and the only one. profiles.platform had accumulated FOUR
   spellings of two consoles ("XSX", "Xbox Series X|S", "PS5", "PlayStation 5") because the Control
   Center's player modal and the member's own settings page each wrote their own. `id` is what the
   database stores and is CHECK-constrained to these two values; `label` is what a member reads; and
   `tag` matters most, because asking an Xbox player for his "PSN name" is asking the wrong question.
   PC is deliberately absent: CGHL is played on console. */
CG.PLATFORMS = [
  { id:"XSX", label:"Xbox",        tag:"Xbox Gamertag" },
  { id:"PS5", label:"PlayStation", tag:"PSN Name" }
];
CG.platLabel = function(id){
  for (var i=0;i<CG.PLATFORMS.length;i++) if (CG.PLATFORMS[i].id===id) return CG.PLATFORMS[i].label;
  return id || "";
};
/* what to CALL the console name field. With no console chosen yet the question has to cover both. */
CG.platTag = function(id){
  for (var i=0;i<CG.PLATFORMS.length;i++) if (CG.PLATFORMS[i].id===id) return CG.PLATFORMS[i].tag;
  return "Xbox Gamertag or PSN Name";
};
/* <option> list for a platform picker. blank = an explicit "not set yet" row. */
CG.platOptions = function(sel, blank){
  return (blank ? '<option value=""'+(sel?"":" selected")+'>'+blank+'</option>' : '')
    + CG.PLATFORMS.map(function(x){
        return '<option value="'+x.id+'"'+(sel===x.id?" selected":"")+'>'+x.label+'</option>'; }).join("");
};

CG.buildPlayers = function(rng){
  var players = [], id = 0, tagIdx = 0;
  CG.TEAMS.forEach(function(team){
    var s = CG.TEAM_STRENGTH[team.code];
    CG.POS_SLOTS.forEach(function(pos, slot){
      var tag = CG.GAMERTAGS[tagIdx++];
      /* talent clusters around team strength; slot 0 of each pos pair is the starter */
      var starter = (slot % 2 === 0) || pos === "G" && slot === 10;
      var talent = Math.max(.15, Math.min(.97, s + (rng()-.5)*.34 + (slot%2===0 ? .07 : -.07)));
      var archList = pos==="G" ? CG.G_ARCH : CG.SKATER_ARCH[pos];
      players.push({
        id:"p"+(id++), tag:tag, team:team.code, pos:pos, depth:(slot%2)+1,
        talent:talent, arch:archList[Math.floor(rng()*archList.length)],
        jersey: pos==="G" ? (slot===10?31:35) : (2 + Math.floor(rng()*88)),
        platform: rng() < .55 ? "PS5" : "XSX",
        rookie: rng() < .22, shoots: rng()<.6?"L":"R",
        gritty: rng() < .18,           /* high-PIM tendency */
        eaId: tag.replace(/[^A-Za-z0-9]/g,"") + "_EA",
        joined: "Jun 2026"
      });
    });
  });
  /* jersey uniqueness within team */
  players.forEach(function(p){
    var mates = players.filter(function(q){ return q.team===p.team && q!==p; });
    while (mates.some(function(q){ return q.jersey===p.jersey; })) p.jersey = (p.jersey % 97) + 2;
  });
  /* the designated enforcer: highest gritty talent skater becomes suspension case */
  return players;
};

/* ---------- schedule (circle method, 8 teams, 7 rounds cycled) ---------- */
CG.buildSchedule = function(){
  var codes = CG.TEAMS.map(function(t){ return t.code; });
  var fixed = codes[0], rot = codes.slice(1);
  var rounds = [];
  for (var r=0; r<7; r++){
    var arr = [fixed].concat(rot);
    var games = [];
    for (var i=0;i<4;i++){
      var a = arr[i], b = arr[7-i];
      games.push(r % 2 === 0 ? {home:a, away:b} : {home:b, away:a});
    }
    rounds.push(games);
    rot.push(rot.shift());
  }
  /* Week n has two nights: Wed (round idx) + Sat (next round). 20 nights, rounds cycle. */
  var schedule = [], gid = 0;
  var start = Date.parse("2026-06-03T21:00:00-04:00"); /* Week 1 Wednesday 9 PM ET */
  for (var w=1; w<=CG.SEASON.weeks; w++){
    ["Wed","Sat"].forEach(function(day, di){
      var nightIdx = (w-1)*2 + di;
      var round = rounds[nightIdx % 7];
      var base = start + ((w-1)*7 + (di===0?0:3)) * 86400000;
      round.forEach(function(m, gi){
        schedule.push({
          id:"g"+(++gid), week:w, night:day, home:m.home, away:m.away,
          at: base + gi*40*60000                /* staggered 40 min */
        });
      });
    });
  }
  return schedule;
};

/* ---------- single game simulation ---------- */
CG.simGame = function(game, playersByTeam, rng, suspensions){
  var out = { id:game.id, week:game.week, home:game.home, away:game.away, at:game.at, done:true,
              ot:false, score:{}, box:{}, lineups:{}, stars:[] };
  var strengths = {};
  ["home","away"].forEach(function(side){
    var code = game[side];
    var roster = playersByTeam[code];
    var banned = suspensions.filter(function(s){ return s.team===code && s.weeks.indexOf(game.week)>=0; }).map(function(s){ return s.playerId; });
    /* choose lineup: per position pick starter unless rng says backup night or suspended */
    var lineup = {};
    ["LW","C","RW","LD","RD","G"].forEach(function(pos){
      var pair = roster.filter(function(p){ return p.pos===pos && banned.indexOf(p.id)<0; });
      pair.sort(function(a,b){ return a.depth-b.depth; });
      var pick = pair[0];
      var backupRate = pos==="G" ? .22 : .30;
      if (pair.length>1 && rng() < backupRate) pick = pair[1];
      lineup[pos] = pick.id;
    });
    out.lineups[code] = lineup;
    var sk = ["LW","C","RW","LD","RD"].map(function(pos){ return roster.find(function(p){ return p.id===lineup[pos]; }); });
    var g  = roster.find(function(p){ return p.id===lineup.G; });
    strengths[side] = { skaters:sk, goalie:g,
      atk: sk.reduce(function(s,p){ return s+p.talent; },0)/5,
      dfc: (sk[3].talent + sk[4].talent)/2, gt: g.talent };
  });
  /* expected goals: attack vs (defense + goalie), home edge */
  function xg(off, def){ return Math.max(.6, 3.1 + (off.atk - (def.dfc*.45 + def.gt*.55)) * 4.2); }
  function pois(lam){ var L=Math.exp(-lam), k=0, p=1; do { k++; p*=rng(); } while (p>L); return k-1; }
  var hG = pois(xg(strengths.home, strengths.away) * 1.06);
  var aG = pois(xg(strengths.away, strengths.home));
  hG = Math.min(hG, 9); aG = Math.min(aG, 9);
  var regH = hG, regA = aG;
  if (hG === aG){ out.ot = true; if (rng() < .5 + (strengths.home.atk-strengths.away.atk)) hG++; else aG++; }
  out.score[game.home]=hG; out.score[game.away]=aG;
  out.reg = {}; out.reg[game.home]=regH; out.reg[game.away]=regA;

  /* box scores */
  ["home","away"].forEach(function(side){
    var code = game[side], opp = side==="home"?game.away:game.home;
    var st = strengths[side], oppSt = strengths[side==="home"?"away":"home"];
    var goals = out.score[code];
    var box = {};
    st.skaters.forEach(function(p){ box[p.id] = { g:0,a:0,shots:0,hits:0,blk:0,gv:0,tk:0,pim:0,fow:0,fot:0,gwg:0 }; });
    /* distribute goals: forwards weighted 3x, talent-weighted */
    for (var gi=0; gi<goals; gi++){
      var weights = st.skaters.map(function(p){ return p.talent * (["LD","RD"].indexOf(p.pos)>=0 ? .38 : 1); });
      var total = weights.reduce(function(a,b){return a+b;},0), roll = rng()*total, scorer = 0;
      for (var i=0;i<weights.length;i++){ roll -= weights[i]; if (roll<=0){ scorer=i; break; } }
      box[st.skaters[scorer].id].g++;
      var nA = rng()<.82 ? (rng()<.55?2:1) : 0;
      var pool = st.skaters.filter(function(p,idx){ return idx!==scorer; });
      for (var ai=0; ai<nA; ai++){
        var pick = pool.splice(Math.floor(rng()*pool.length),1)[0];
        box[pick.id].a++;
      }
    }
    /* game-winning goal: goes to a scorer on the winning team */
    var won = out.score[code] > out.score[opp];
    if (won){
      var scorers = st.skaters.filter(function(p){ return box[p.id].g>0; });
      if (scorers.length) box[scorers[Math.floor(rng()*scorers.length)].id].gwg = 1;
    }
    /* shots / physical stats */
    st.skaters.forEach(function(p){
      var b = box[p.id];
      b.shots = b.g + Math.floor(rng()*4 + p.talent*4);
      var d = ["LD","RD"].indexOf(p.pos)>=0;
      b.hits = Math.floor(rng()* (p.arch==="Power Forward"||p.arch==="Grinder"||d ? 6 : 3));
      b.blk  = d ? Math.floor(rng()*5) : Math.floor(rng()*2);
      b.gv   = Math.floor(rng()*3); b.tk = Math.floor(rng()* (d?4:3));
      b.pim  = rng() < (p.gritty?.42:.16) ? (rng()<.8?2:(rng()<.8?4:5)) : 0;
      if (p.pos==="C"){ b.fot = 8+Math.floor(rng()*14); b.fow = Math.round(b.fot*(.32+p.talent*.35+rng()*.1)); }
      b.pm = regH===regA ? 0 : (side==="home" ? regH-regA : regA-regH); /* even-strength, full-game 6s */
    });
    out.box[code] = box;
    /* goalie line for the OTHER side is derived after both boxes exist */
  });
  /* goalie lines */
  ["home","away"].forEach(function(side){
    var code = game[side], opp = side==="home"?game.away:game.home;
    var g = strengths[side].goalie;
    var oppShots = Object.keys(out.box[opp]).reduce(function(s,pid){
      var b = out.box[opp][pid]; return s + (b.goalie ? 0 : (b.shots||0)); },0);
    var ga = out.score[opp];
    var sa = Math.max(oppShots, ga + 4 + Math.floor(rng()*6));
    out.box[code][g.id] = { goalie:true, sa:sa, sv:sa-ga, ga:ga,
      w: out.score[code]>out.score[opp] ? 1:0,
      otl: (out.score[code]<out.score[opp] && out.ot) ? 1:0,
      l: (out.score[code]<out.score[opp] && !out.ot) ? 1:0,
      so: (ga===0 && out.score[code]>out.score[opp]) ? 1:0,
      qs: (sa>0 && (sa-ga)/sa >= .885) ? 1:0 };
  });
  /* three stars: rank by game score */
  var cand = [];
  [game.home, game.away].forEach(function(code){
    Object.keys(out.box[code]).forEach(function(pid){
      var b = out.box[code][pid];
      var sc = b.goalie ? (b.sv*.09 + b.w*1.2 + b.so*2.2) : (b.g*2.1 + b.a*1.3 + b.shots*.06);
      cand.push({ pid:pid, team:code, score:sc });
    });
  });
  cand.sort(function(a,b){ return b.score-a.score; });
  out.stars = cand.slice(0,3).map(function(c){ return { pid:c.pid, team:c.team }; });
  return out;
};

/* ---------- full season build ---------- */
/* ---------- salary & cap system (LG-style: management on $0, everyone else under contract) ---------- */
CG.CAP = 40000000;                 /* team salary cap — fallback until the season row loads */
CG.MIN_SALARY = 750000;            /* league minimum */
CG.SALARY_STEP = 250000;           /* Rule 2.5 (v2.31): every negotiated figure sits on this lattice */

/* The one salary predicate the front end asks — offers, counters and revisions
   all route here so there is a single definition to get right. Draft pay is NOT negotiated and so
   does not come through here: it is set by public.draft_pick_salary() in the database at the
   moment the pick is made, and CG.draftRoundSalary below only mirrors that scale for display.
   This function mirrors the database's public.legal_salary(), which is the real enforcement; it
   exists to say no in plain language before a manager sends a figure the server would reject.
   Returns a message to show, or null when the figure is legal. $0 is management (Rule 2.6), never
   negotiated, so it is not this function's business — callers never hand it one. */
CG.salaryProblem = function(dollars){
  var v = Number(dollars);
  if (!isFinite(v)) return "Enter a salary.";
  /* every salary field on the site is labelled and typed in $M, so the correction speaks in $M
     too — CG.fmtMoney drops under a million into thousands ("$750K"), which contradicts the box
     the manager is typing into. */
  var M = function(d){ return "$" + (d/1000000).toFixed(2).replace(/0$/,"").replace(/\.$/,"") + "M"; };
  if (v < CG.MIN_SALARY) return "The league minimum is " + M(CG.MIN_SALARY) + " (Rule 2.5).";
  if (v % CG.SALARY_STEP !== 0){
    var lo = v - (v % CG.SALARY_STEP), hi = lo + CG.SALARY_STEP;
    return "Salaries move in " + M(CG.SALARY_STEP) + " steps (Rule 2.5) — try "
         + M(lo) + " or " + M(hi) + ".";
  }
  return null;
};

/* Rule 2.8 (v2.31): drafted players are paid by round. The last round pays the league minimum
   and every round above it adds one step, so a fifteen-round draft runs $750K (R15) to $4.25M (R1) and a fourteen-round one $750K to $4.0M. */
CG.draftRoundSalary = function(round, rounds){
  var n = Math.max(1, rounds || 10);
  var r = Math.max(1, Math.min(round || 1, n));
  return CG.MIN_SALARY + (n - r) * CG.SALARY_STEP;
};
CG.fmtMoney = function(v){
  if (v==null) return "—";
  if (v===0) return "$0";
  if (Math.abs(v) >= 1000000) return "$"+(v/1000000).toFixed(v%1000000?2:1).replace(/\.0$/,"")+"M";
  return "$"+Math.round(v/1000)+"K";
};
CG.assignSalaries = function(players, byTeam, rng){
  /* management contracts are $0 (Owner = RW depth-1, GM = C depth-1); AGM (LD depth-1) is a
     $3.0M tertiary contract, mirroring the LG constitution's management contract rules. */
  function mgmtRole(p){
    if (p.depth!==1) return null;
    if (p.pos==="C")  return "gm";     /* $0 */
    if (p.pos==="RW") return "owner";  /* $0 */
    if (p.pos==="LD") return "agm";    /* $3.0M */
    return null;
  }
  players.forEach(function(p){
    p.mgmt = mgmtRole(p);
    p.term = 1 + Math.floor(rng()*3);                 /* 1–3 season contract */
    if (p.mgmt==="owner" || p.mgmt==="gm"){ p.salary = 0; p.mgmtSalary = true; return; }
    if (p.mgmt==="agm"){ p.salary = 3000000; return; }
    /* base salary scales with talent; a little noise for realism */
    p.salary = Math.max(CG.MIN_SALARY, (0.8 + p.talent*11 + (rng()-0.5)*1.4) * 1000000);
  });
  /* scale non-fixed salaries so the richest club lands just under the cap (varied cap space) */
  var maxPay = 0;
  Object.keys(byTeam).forEach(function(code){
    var pay = byTeam[code].reduce(function(s,p){ return s+p.salary; },0);
    if (pay>maxPay) maxPay = pay;
  });
  var target = CG.CAP - 3200000;                       /* richest club ≈ $61.8M */
  var factor = maxPay>0 ? target/maxPay : 1;
  players.forEach(function(p){
    if (p.mgmtSalary || p.mgmt==="agm") return;
    p.salary = Math.max(CG.MIN_SALARY, Math.round(p.salary*factor/100000)*100000);
  });
  /* trade block + waiver state (seeded deterministically later) */
  players.forEach(function(p){ p.onBlock = false; });
};
CG.teamPayroll = function(lg, code){
  /* waived players clear the cap immediately (Rule 2.5); the store carries that
     state in the browser. In the pure-Node engine test there is no store, so
     nothing is waived and this reduces to the raw contract sum. */
  var waived = (typeof CG!=="undefined" && CG.store && CG.store.get) ? (CG.store.get("waived")||{}) : {};
  /* Training-camp salaries COUNT against the cap (Rule 2.5, commissioner ruling 2026-09-02).
     Camp sits outside the seventeen active spots, but not outside the payroll: a club that
     carries a player in camp pays for him exactly as it would on the active roster. This mirrors
     public.team_cap_used in the database — if one changes, both must. */
  return lg.byTeam[code].reduce(function(s,p){
    return s + (waived[p.id] ? 0 : (p.salary||0));
  }, 0);
};
CG.capSpace = function(lg, code){ return CG.CAP - CG.teamPayroll(lg, code); };

CG.buildLeague = function(overrides){
  var rng = CG.makeRng(20260715);
  var players = CG.buildPlayers(rng);
  var byTeam = {};
  players.forEach(function(p){ (byTeam[p.team]=byTeam[p.team]||[]).push(p); });
  CG.assignSalaries(players, byTeam, rng);

  /* fixed narrative events (pre-sim so stats respect them) */
  var enforcer = players.filter(function(p){ return p.gritty && p.pos!=="G"; })
                        .sort(function(a,b){ return b.talent-a.talent; })[0];
  var suspensions = [
    { id:"d1", playerId:enforcer.id, team:enforcer.team, weeks:[6], games:2,
      reason:"Checking from behind + post-whistle misconduct (Rule 7.4)", status:"served",
      issued:"2026-07-06", decidedBy:"Player Safety" }
  ];
  var schedule = CG.buildSchedule();
  var demoNow = Date.parse(overrides && overrides.nowIso || CG.DEMO_NOW_ISO);

  var results = [];
  schedule.forEach(function(gm){
    if (gm.at < demoNow - 90*60000){ /* completed if puck-drop was >90min ago */
      results.push(CG.simGame(gm, byTeam, rng, suspensions));
    }
  });
  /* user-entered results overlay (commissioner "Enter result" in the prototype) */
  if (overrides && overrides.extraResults) results = results.concat(overrides.extraResults);

  var lg = { players:players, byTeam:byTeam, schedule:schedule, results:results,
             suspensions:suspensions, demoNow:demoNow, rng:rng };
  CG.aggregate(lg, overrides);
  /* ---- archived season: Preseason 2026 (two exhibition nights, fully simulated) ---- */
  (function(){
    var preRng = CG.makeRng(20260527);
    var codes = CG.TEAMS.map(function(t){ return t.code; });
    var fixed = codes[0], rot = codes.slice(1), preSched = [], pgid = 0;
    [Date.parse("2026-05-27T21:00:00-04:00"), Date.parse("2026-05-30T21:00:00-04:00")].forEach(function(base, ri){
      var arr = [fixed].concat(rot);
      for (var i=0;i<4;i++){
        var a = arr[i], b = arr[7-i];
        preSched.push({ id:"pg"+(++pgid), week:ri+1, night:ri?"Sat":"Wed",
          home: ri%2? b:a, away: ri%2? a:b, at: base + i*40*60000 });
      }
      rot.push(rot.shift());
    });
    var preResults = preSched.map(function(gm){ return CG.simGame(gm, byTeam, preRng, []); });
    var tmp = { players:players, byTeam:byTeam, schedule:preSched, results:preResults };
    CG.aggregate(tmp, overrides);
    lg.archive = { pre: { key:"pre", label:"Preseason · 2026", status:"Archived · final",
      teams:tmp.teams, pstats:tmp.pstats, glog:tmp.glog, results:preResults } };
  })();
  /* tonight's slate + marquee game (highest combined standings points) */
  lg.tonight = schedule.filter(function(g){
    return !results.some(function(r){ return r.id===g.id; }) && Math.abs(g.at - demoNow) < 10*3600000;
  });
  var best = null;
  lg.tonight.forEach(function(g){
    var v = lg.teams[g.home].pts + lg.teams[g.away].pts;
    if (!best || v > best.v){ best = { g:g, v:v }; }
  });
  lg.tonight.forEach(function(g){ g.feature = best && g.id===best.g.id; });
  CG.seedTrades(lg);
  return lg;
};

/* ---------- trade block + incoming offers seed (demo, deterministic) ---------- */
CG.seedTrades = function(lg){
  function byTag(code, tag){ return lg.byTeam[code].find(function(p){ return p.tag===tag; }); }
  /* league-wide trade block: two depth skaters per team (excluding the managed club, CBR,
     which the GM curates themselves in the Trade Hub) */
  lg.blockSeed = [];
  CG.TEAMS.forEach(function(t){
    if (t.code==="CBR") return;
    lg.byTeam[t.code].filter(function(p){ return p.pos!=="G" && p.depth===2 && !p.mgmt; })
      .slice(0,2).forEach(function(p){ p.onBlock = true; lg.blockSeed.push(p.id); });
  });
  /* incoming offers TO the managed club (Circuit Breakers). Management ($0) is never dealt. */
  function ids(list){ return list.filter(function(p){ return p && !p.mgmt; }).map(function(p){ return p.id; }); }
  var deke = byTag("CBR","DekeDynasty");           /* CBR star RD (non-mgmt) */
  var cbrDepth = lg.byTeam.CBR.find(function(p){ return p.pos==="LW" && p.depth===2 && !p.mgmt; });
  var tucStar = byTag("TUC","GloveSideGus");       /* TUC LW scorer (non-mgmt) */
  var tucDepthD = lg.byTeam.TUC.find(function(p){ return p.pos==="LD" && p.depth===2 && !p.mgmt; });
  lg.incoming = [];
  if (deke && tucStar){
    lg.incoming.push({ id:"trIn1", from:"TUC", to:"CBR", at:Date.parse("2026-07-15T16:20:00-04:00"),
      give: ids([tucStar, tucDepthD]),
      get:  ids([deke]),
      note:"We're loaded up front and thin on the back end. GloveSideGus is a proven scorer — straight-up upgrade to your attack for a righty D.",
      status:"pending" });
  }
  if (cbrDepth){
    lg.incoming.push({ id:"trIn2", from:"POL", to:"CBR", at:Date.parse("2026-07-14T21:05:00-04:00"),
      give: ids([lg.byTeam.POL.find(function(p){return p.pos==="LW"&&p.depth===1&&!p.mgmt;})]),
      get:  ids([cbrDepth]),
      note:"Depth-for-depth, cap-neutral. Helps both rooms.",
      status:"pending" });
  }
  return lg;
};
CG.playerSalary = function(lg, pid){ var p = CG.playerById(lg, pid); return p?p.salary:0; };

/* ---------- aggregation: standings, stats, ratings, honors ---------- */
CG.DEFAULT_WEIGHTS = {
  skater: { production:46, efficiency:16, defense:14, discipline:8, form:16 },
  goalie: { saves:52, workload:18, wins:22, discipline:8 },
  team:   { record:38, goalDiff:22, goaltending:14, depth:14, form:12 }
};

/* v4.08 (commissioner, 2026-10-14: "Make sure to count every player's stats of every game. Even if they disconnect."):
   ONE season-line shape for everyone. It used to be chosen by the REGISTERED position, so a registered goalie's skating
   games added into keys he did not have (NaN, shown blank: Bowman's 1G 12A in 6 games) and a registered skater's games in
   goal did the same to his goalie keys (Easy pickins' 8 starts). A line is counted by what the player PLAYED that game.
     gp  = every GAME played at any position, counted once (Rules 2.4, 8.3, 9.3 count those: eligibility, floors,
           minimum service; the database's regular_gp counts the same distinct games)
     sgp = games with a skating line, gs = games with a goalie line.
   v4.11: a player who skated in one sitting of a restarted game and played goal in another (Rule 4.3) has BOTH lines
   for that one game, so it is one game played, one game skated and one game in goal: gp <= sgp + gs.
   Skater totals come only from skating lines and goalie totals only from goalie lines. */
CG.blankStatLine = function(){
  return { gp:0, sgp:0, gs:0,
    g:0,a:0,p:0,pm:0,shots:0,hits:0,blk:0,gv:0,tk:0,pim:0,fow:0,fot:0,gwg:0,
    w:0,l:0,otl:0,sa:0,sv:0,ga:0,so:0,qs:0,
    weekly:{}, weeklyG:{} };
};
/* v4.11: a result's box holds ONE entry per player per game (box[club][pid]), so anything that counts games counts
   entries. A player with lines in both roles in one game has one entry: the goalie line, carrying the skating line as
   .skate. CG.boxLines lists every line of an entry, so statistics are summed per line and games counted per entry.
   CG.boxPut files a line into a box side that way, and never lets one line overwrite another. */
CG.boxLines = function(b){
  return !b ? [] : (b.skate ? [b, b.skate] : [b]);
};
CG.boxPut = function(side, key, line, spareKey){
  var have = side[key];
  if (!have) side[key] = line;
  else if (!!have.goalie !== !!line.goalie && !(have.goalie ? have.skate : line.skate)){
    var gl = have.goalie ? have : line;
    gl.skate = have.goalie ? line : have;
    side[key] = gl;
  }
  else side[spareKey || (key + "~" + Object.keys(side).length)] = line;   /* never overwrite a line */
  return side[key];
};
/* A box entry's star caption: "24 saves", "2G 1A", or both lines of a two-role game ("12 saves and 1G 2A"). */
CG.boxStarText = function(b){
  return CG.boxLines(b).map(function(x){ return x.goalie ? (x.sv||0)+" saves"+(x.so?", shutout":"") : (x.g||0)+"G "+(x.a||0)+"A"; }).join(" and ");
};
/* A player's game log (lg.glog[pid], one entry per LINE) as one entry per GAME, in order: {game, week, opp, lines}. */
CG.glogGames = function(log){
  var out = [], at = {};
  (log || []).forEach(function(en){
    if (at[en.game]) { at[en.game].lines.push(en.line); return; }
    at[en.game] = { game:en.game, week:en.week, team:en.team, opp:en.opp, lines:[en.line] };   /* v4.13: and the club */
    out.push(at[en.game]);
  });
  return out;
};
/* Everyone whose season stats count: the rostered players, and the players who played this season but are no longer
   rostered (waived, left the league, removed). Their games are part of the official record (Rule 6.1). */
CG.statPlayers = function(lg){ return (lg.players||[]).concat(lg.formerPlayers||[]); };
CG.statPlayerById = function(lg, id){
  return CG.playerById(lg, id) || (lg.formerPlayers||[]).find(function(p){ return p.id === id; }) || null;
};
/* v4.13: one box LINE added to one season line: its role's game (sgp or gs) and its statistics. The caller counts the
   GAME (gp) once per box entry (v4.11: an entry can hold a goalie line and a skating line). CG.aggregate adds every line
   twice through this, to the player's season line and to his line for the club the box was recorded for
   (s.byClub[code]), so the two can never count differently: the club lines of a player always add up to his season line. */
CG.addStatLine = function(s, b, week){
  if (b.goalie){
    s.gs++; s.sa+=b.sa; s.sv+=b.sv; s.ga+=b.ga; s.w+=b.w; s.l+=b.l; s.otl+=b.otl; s.so+=b.so; s.qs+=b.qs;
    s.weeklyG[week] = (s.weeklyG[week]||0) + b.sv*.09 + b.w*1.2 + b.so*2;
  } else {
    s.sgp++; s.g+=b.g; s.a+=b.a; s.p+=b.g+b.a; s.pm+=b.pm; s.shots+=b.shots; s.hits+=b.hits;
    s.blk+=b.blk; s.gv+=b.gv; s.tk+=b.tk; s.pim+=b.pim; s.fow+=b.fow; s.fot+=b.fot; s.gwg+=b.gwg;
    s.weekly[week] = (s.weekly[week]||0) + b.g*2 + b.a;
  }
};
/* v4.13: a player's line for one club (null when he has none); the clubs he played for, in the order he first played for
   each. A line from before v4.13 (or a provisional draft row) has no byClub. */
CG.clubLine = function(s, code){ return (s && s.byClub && s.byClub[code]) || null; };
CG.clubsPlayed = function(s){
  var bc = (s && s.byClub) || {};
  return Object.keys(bc).sort(function(a, b){ return (bc[a].first||0) - (bc[b].first||0) || (a < b ? -1 : 1); });
};
/* v4.13: everyone with a line for one club this season (rostered there now, rostered elsewhere now, or no longer
   rostered), each with his line for THAT club only. [{p, s}] */
CG.clubStatPlayers = function(lg, code){
  return CG.statPlayers(lg).map(function(p){ return { p: p, s: CG.clubLine(lg.pstats[p.id], code) }; })
    .filter(function(x){ return !!x.s; });
};
CG.aggregate = function(lg, overrides){
  var W = (overrides && overrides.weights) || CG.DEFAULT_WEIGHTS;
  var teams = {}, pstats = {}, glog = {};
  /* gsv/gsa: the club's goalie lines, whoever played in goal (team save percentage) */
  CG.TEAMS.forEach(function(t){ teams[t.code] = { code:t.code, gp:0,w:0,l:0,otl:0,rw:0,gf:0,ga:0,
    hw:0,hl:0,aw:0,al:0, res:[], sf:0, sa:0, gsv:0, gsa:0 }; });
  CG.statPlayers(lg).forEach(function(p){
    pstats[p.id] = CG.blankStatLine();
    pstats[p.id].byClub = {};   /* v4.13: his line for each club he played for, the same shape */
    glog[p.id] = [];
  });

  lg.results.forEach(function(r){
    [ [r.home,r.away], [r.away,r.home] ].forEach(function(pair){
      var code = pair[0], opp = pair[1];
      var t = teams[code]; t.gp++;
      t.gf += r.score[code]; t.ga += r.score[opp];
      /* A forfeit decides the result outright, whatever the goals say. A three-disconnection
         forfeit (Rule 4.3) KEEPS the played score and stat lines, so the forfeiting club can
         finish with more goals than its opponent and still take the loss — goals for and
         against stay real (they are what the players actually earned), only the W/L is ruled.
         A forfeit is a regulation result for tiebreakers (Rule 8.2), so it never awards the
         overtime-loss point. */
      var ff = r.forfeit || null;
      var won = ff ? (ff !== code) : (r.score[code] > r.score[opp]);
      if (won){ t.w++; if (ff || !r.ot) t.rw++; (code===r.home?t.hw++:t.aw++); t.res.push("W"); }
      else if (!ff && r.ot){ t.otl++; t.res.push("OT"); }
      else { t.l++; (code===r.home?t.hl++:t.al++); t.res.push("L"); }
      Object.keys(r.box[code]).forEach(function(pid){
        var s = pstats[pid], c = null;
        /* v4.11: the entry is the GAME (gp once), each of its lines adds to its own role (sgp, gs) */
        if (s){
          s.gp++;
          /* v4.13: and the same game to his line for the club it was recorded for (the box key is that club) */
          c = s.byClub[code];
          if (!c){ c = s.byClub[code] = CG.blankStatLine(); c.first = r.at; c.wkFirst = r.week; }
          c.gp++; c.last = r.at; c.wkLast = r.week;
        }
        CG.boxLines(r.box[code][pid]).forEach(function(b){
          /* v4.08: the club's totals count EVERY line, including a player no longer rostered or one EA could not link
             (shots for used to skip them while shots against counted them) */
          if (b.goalie){ t.gsv += (b.sv||0); t.gsa += (b.sa||0); }
          else t.sf += (b.shots||0);
          if (!s) return;
          /* v4.13: every line to the season line and to the club line, through the one adder */
          CG.addStatLine(s, b, r.week);
          CG.addStatLine(c, b, r.week);
          /* the weeks of each role at this club (a skater who also played in goal there has two spans) */
          var rk = b.goalie ? "g" : "s";
          if (c[rk+"WkFirst"] == null) c[rk+"WkFirst"] = r.week;
          c[rk+"WkLast"] = r.week;
          glog[pid].push({ game:r.id, week:r.week, team:code, opp:opp, line:b });
        });
      });
    });
  });
  /* shots against: every skating line of the opponent, a goalie's skating line included */
  lg.results.forEach(function(r){
    [ [r.home,r.away], [r.away,r.home] ].forEach(function(pair){
      var code=pair[0], opp=pair[1];
      teams[code].sa += Object.keys(r.box[opp]).reduce(function(s,pid){
        return s + CG.boxLines(r.box[opp][pid]).reduce(function(x, b){ return x + (b.goalie ? 0 : (b.shots||0)); }, 0); },0);
    });
  });
  /* streaks + last5 */
  Object.keys(teams).forEach(function(code){
    var t = teams[code], res = t.res;
    var streak = "—";
    if (res.length){
      var last = res[res.length-1]==="W"?"W":"L", n=0;
      for (var i=res.length-1;i>=0;i--){ var v = res[i]==="W"?"W":"L"; if (v===last) n++; else break; }
      streak = last + n;
    }
    t.streak = streak; t.last5 = res.slice(-5);
    t.pts = t.w*2 + t.otl; t.diff = t.gf-t.ga;
    t.ptsPct = t.gp ? t.pts/(t.gp*2) : 0;
  });

  /* ----- player ratings (documented, configurable) ----- */
  var skaters = lg.players.filter(function(p){ return p.pos!=="G"; });
  var goalies = lg.players.filter(function(p){ return p.pos==="G"; });
  var C = 4; /* regression constant: small samples pull to league average */
  var lgPts = skaters.reduce(function(s,p){ return s+pstats[p.id].p; },0);
  /* v4.08: skater rates over games SKATED, goalie rates over games in goal */
  var lgGp  = skaters.reduce(function(s,p){ return s+pstats[p.id].sgp; },0) || 1;
  var avgPpg = lgPts/lgGp;
  function pct(list, v){ var below = list.filter(function(x){ return x < v; }).length; return list.length? below/list.length : .5; }
  var adjPpgs = skaters.map(function(p){ var s=pstats[p.id]; return (s.p + C*avgPpg)/((s.sgp||0)+C); });

  lg.ratings = {};
  skaters.forEach(function(p, i){
    var s = pstats[p.id];
    var isD = ["LD","RD"].indexOf(p.pos)>=0;
    var prod = pct(adjPpgs, (s.p + C*avgPpg)/((s.sgp||0)+C));
    var eff  = s.shots>0 ? Math.min(1,(s.g/s.shots)/.22)*.6 + Math.min(1,Math.max(0,(s.pm+10)/20))*.4 : .5;
    var dfc  = Math.min(1, ((s.blk*(isD?1:1.6)) + s.tk + s.hits*.5) / Math.max(1,s.sgp) / 6);
    var disc = Math.max(0, 1 - (s.pim/Math.max(1,s.sgp))/2.2);
    var wk = Object.keys(s.weekly).map(Number).sort(function(a,b){return a-b;});
    var recent = wk.slice(-2).reduce(function(a,w){ return a+s.weekly[w]; },0);
    var early  = wk.slice(0,-2).reduce(function(a,w){ return a+s.weekly[w]; },0);
    var form = wk.length>2 ? Math.min(1, Math.max(0, .5 + (recent/(2) - early/Math.max(1,wk.length-2))*.18 )) : .5;
    var wsum = W.skater.production+W.skater.efficiency+W.skater.defense+W.skater.discipline+W.skater.form;
    var mix = (prod*W.skater.production + eff*W.skater.efficiency + (isD? dfc*1.35:dfc)*W.skater.defense
             + disc*W.skater.discipline + form*W.skater.form) / wsum;
    var ovr = Math.round(63 + Math.min(1,mix)*34);
    lg.ratings[p.id] = { ovr: Math.max(60,Math.min(97,ovr)),
      parts:{ production:Math.round(prod*100), efficiency:Math.round(eff*100),
              defense:Math.round(Math.min(1,isD?dfc*1.35:dfc)*100), discipline:Math.round(disc*100), form:Math.round(form*100) } };
  });
  goalies.forEach(function(p){
    var s = pstats[p.id];
    var svp = s.sa>0 ? s.sv/s.sa : .885;
    var adjSvp = (s.sv + 35*.885)/(Math.max(0,s.sa) + 35);
    var saves = Math.min(1, Math.max(0,(adjSvp-.84)/.10));
    var work  = Math.min(1, s.gs/ Math.max(1, CG.SEASON.completedWeeks*2*.62));
    var wins  = s.gs>0 ? (s.w + .5*s.otl)/s.gs : .5;
    var wsum = W.goalie.saves+W.goalie.workload+W.goalie.wins+W.goalie.discipline;
    var mix = (saves*W.goalie.saves + work*W.goalie.workload + wins*W.goalie.wins + .9*W.goalie.discipline)/wsum;
    var ovr = Math.round(63 + Math.min(1,mix)*34);
    lg.ratings[p.id] = { ovr: Math.max(60,Math.min(97,ovr)),
      parts:{ saves:Math.round(saves*100), workload:Math.round(work*100), wins:Math.round(wins*100), discipline:90 },
      svpct: svp };
  });

  /* ----- team overall + power rankings ----- */
  lg.teamRatings = {};
  var maxDiffPer = .9;
  /* v4.08: goaltending is measured against THIS league's save percentage, not an NHL band (.840 to .940 put every
     CGHL club at 0). A club at the league's figure reads 50; each .015 above or below it moves the bar 10. */
  var lgGsv = 0, lgGsa = 0;
  CG.TEAMS.forEach(function(tm){ lgGsv += teams[tm.code].gsv; lgGsa += teams[tm.code].gsa; });
  var lgSvp = lgGsa ? lgGsv/lgGsa : .885;
  CG.TEAMS.forEach(function(tm){
    var t = teams[tm.code];
    var roster = lg.byTeam[tm.code];
    var top9 = roster.map(function(p){ return lg.ratings[p.id].ovr; }).sort(function(a,b){return b-a;}).slice(0,9);
    var depth = (top9.reduce(function(a,b){return a+b;},0)/9 - 63)/34;
    var gd = t.gp? Math.min(1,Math.max(0,(t.diff/t.gp + maxDiffPer)/(2*maxDiffPer))) : .5;
    /* v4.08: the club's own goalie lines, whoever was in goal (the registered goalies' ratings missed every game a
       skater played in net, and counted a goalie's games for other clubs) */
    var gt = t.gsa ? Math.min(1, Math.max(0, .5 + ((t.gsv + 35*lgSvp)/(t.gsa + 35) - lgSvp)/.15)) : .5;
    var l5 = t.last5.filter(function(r){ return r==="W"; }).length/Math.max(1,t.last5.length);
    var wsum = W.team.record+W.team.goalDiff+W.team.goaltending+W.team.depth+W.team.form;
    var mix = (t.ptsPct*W.team.record + gd*W.team.goalDiff + gt*W.team.goaltending + depth*W.team.depth + l5*W.team.form)/wsum;
    lg.teamRatings[tm.code] = { ovr: Math.round(60 + Math.min(1,mix)*36),
      parts:{ record:Math.round(t.ptsPct*100), goalDiff:Math.round(gd*100), goaltending:Math.round(gt*100),
              depth:Math.round(depth*100), form:Math.round(l5*100) } };
  });
  /* power ranking = team OVR order; movement vs a snapshot excluding the final completed week */
  function rankOrder(exclWeek){
    var snap = {};
    CG.TEAMS.forEach(function(tm){
      var pts=0, gp=0, diff=0, wins=0;
      lg.results.forEach(function(r){
        if (exclWeek && r.week>=exclWeek) return;
        [tm.code].forEach(function(code){
          if (r.home!==code && r.away!==code) return;
          var opp = r.home===code?r.away:r.home; gp++;
          diff += r.score[code]-r.score[opp];
          if (r.score[code]>r.score[opp]){ pts+=2; wins++; }
          else if (r.ot) pts+=1;
        });
      });
      snap[tm.code] = gp? (pts/(gp*2))*100 + diff : 0;
    });
    return CG.TEAMS.map(function(t){return t.code;}).sort(function(a,b){
      return (lg.teamRatings[b]?0:0) + snap[b]-snap[a]; });
  }
  var nowOrder = CG.TEAMS.map(function(t){return t.code;}).sort(function(a,b){
    return lg.teamRatings[b].ovr - lg.teamRatings[a].ovr || teams[b].pts-teams[a].pts; });
  var prevOrder = rankOrder(CG.SEASON.completedWeeks);
  lg.powerRankings = nowOrder.map(function(code, i){
    return { rank:i+1, prev: prevOrder.indexOf(code)+1, team:code,
             move: (prevOrder.indexOf(code)+1) - (i+1) };
  });

  /* ----- weekly honors ----- */
  lg.potw = [];
  for (var w=1; w<=CG.SEASON.completedWeeks; w++){
    var bestSk=null, bestG=null;
    lg.players.forEach(function(p){
      var v = pstats[p.id].weekly[w]||0, vG = pstats[p.id].weeklyG[w]||0;
      if (vG && (!bestG || vG>bestG.v)) bestG={p:p,v:vG};
      if (v && (!bestSk || v>bestSk.v)) bestSk={p:p,v:v};
    });
    lg.potw.push({ week:w, skater:bestSk&&bestSk.p.id, goalie:bestG&&bestG.p.id });
  }
  /* three stars of the most recent completed night */
  var lastNightAt = Math.max.apply(null, lg.results.map(function(r){ return r.at; }));
  lg.lastNight = lg.results.filter(function(r){ return Math.abs(r.at-lastNightAt) < 4*3600000; });

  lg.teams = teams; lg.pstats = pstats; lg.glog = glog;
  return lg;
};
/* v4.09: one season's finals by stage. A game with no stage is a regular-season game. */
CG.splitStages = function(results){
  results = results || [];
  return { all: results,
    pre: results.filter(function(r){ return r.stage==="preseason"; }),
    po:  results.filter(function(r){ return r.stage==="playoff"; }),
    reg: results.filter(function(r){ return r.stage!=="preseason" && r.stage!=="playoff"; }) };
};
/* v4.09: every stage's lines from one season's finals (st = CG.splitStages), the one place the live league builds them.
     lg.playoff  the playoff line (built even before the first playoff final, so every reader finds a line of zeros)
     lg.pre      the pre-season line, when there were pre-season games
     lg.ratings  every stage (the overall sees every game played, Rule 6.1)
     lg.pstats, lg.glog, lg.teams and the honors: the REGULAR season alone. Regular-season totals, the statistical
     titles (Rule 9.2) and the playoff floor (Rule 8.3) never see a playoff or pre-season game.
   Each line has the one shape of CG.blankStatLine (gp counts each game once, every role played, players no longer rostered
   included). weeks = { pre, all, reg }: the completed weeks each pass sees; weekly honors are minted from regular weeks
   only, so the playoff pass sees none. */
CG.aggregateStages = function(lg, st, weeks){
  weeks = weeks || {};
  CG.SEASON.completedWeeks = 0;
  lg.results = st.po; CG.aggregate(lg, {});
  lg.playoff = { teams: lg.teams, pstats: lg.pstats, glog: lg.glog, results: st.po };
  if (st.pre.length){
    CG.SEASON.completedWeeks = weeks.pre || 0;
    lg.results = st.pre; CG.aggregate(lg, {});
    lg.pre = { teams: lg.teams, pstats: lg.pstats, glog: lg.glog, results: st.pre };
  }
  var ratingsAll = null, teamRatingsAll = null;
  if (st.pre.length || st.po.length){
    CG.SEASON.completedWeeks = weeks.all || 0;
    lg.results = st.all; CG.aggregate(lg, {});      /* every stage -> ratings */
    ratingsAll = lg.ratings; teamRatingsAll = lg.teamRatings;
  }
  CG.SEASON.completedWeeks = weeks.reg || 0;        /* honors only ever see regular weeks */
  lg.results = st.reg; CG.aggregate(lg, {});        /* regular season -> standings + stats */
  if (ratingsAll) lg.ratings = ratingsAll;
  if (teamRatingsAll) lg.teamRatings = teamRatingsAll;
  return lg;
};
/* EA-only advanced metrics onto a line (base G/A/P and the rest come from CG.aggregate), from the game_stats rows of
   that stage's finals: ice time per role, special-teams goals, passing, possession and EA's own ratings. v4.09: run for
   the regular-season line and the playoff line alike, each from its own finals. splitRows, when given, collects each
   player's raw rows for the profile's By position card.
   v4.13: each row is added to the player's line AND to his line for the club it was filed for, found exactly where
   CG.aggregate found the base line (the result's box), so the club lines carry ice time and the advanced metrics too
   and still add up to the season line; a row whose base line is not in the box (a club outside the fixture) adds
   nothing, as its base line added nothing. */
CG.addEaRow = function(s, r){
  s.toi = (s.toi||0) + (+r.time_on_ice_seconds||0);
  /* v4.08: ice time per role, so a per-game figure divides each role's time by that role's games */
  if (r.is_goalie) s.gToi = (s.gToi||0) + (+r.time_on_ice_seconds||0);
  else s.skToi = (s.skToi||0) + (+r.time_on_ice_seconds||0);
  if (r.is_goalie){
    s.brkShots=(s.brkShots||0)+(+r.breakaway_shots||0);
    s.brkSv=(s.brkSv||0)+(+r.breakaway_saves||0);
    s.pokes=(s.pokes||0)+(+r.poke_checks||0);
    s.dives=(s.dives||0)+(+r.diving_saves||0);   /* v3.87: Big Saves on Goalie DNA */
  } else {
    s.ppg=(s.ppg||0)+(+r.pp_goals||0); s.shg=(s.shg||0)+(+r.sh_goals||0);
    s.pass=(s.pass||0)+(+r.passes_completed||0); s.passAtt=(s.passAtt||0)+(+r.passes_attempted||0);
    s.sat=(s.sat||0)+(+r.shot_attempts||0); s.poss=(s.poss||0)+(+r.possession_seconds||0);
    s.intc=(s.intc||0)+(+r.interceptions||0); s.pdrawn=(s.pdrawn||0)+(+r.penalties_drawn||0);
    s.defl=(s.defl||0)+(+r.deflections||0); s.saucer=(s.saucer||0)+(+r.saucer_passes||0);
    s._ratOff=(s._ratOff||0)+(+r.offense_rating||0); s._ratDef=(s._ratDef||0)+(+r.defense_rating||0);
    s._ratTeam=(s._ratTeam||0)+(+r.team_play_rating||0); s._ratN=(s._ratN||0)+1;
  }
};
CG.addEaMetrics = function(lg, pstats, stageResults, rows, splitRows){
  var finals = {}; (stageResults||[]).forEach(function(r){ finals[r.id]=r; });
  (rows||[]).forEach(function(r){
    var res = finals[r.game_id];
    if (!res || !r.profile_id) return;
    if (splitRows) (splitRows[r.profile_id] = splitRows[r.profile_id] || []).push(r);
    var s = pstats[r.profile_id]; if (!s) return;
    var box = res.box || {};
    var code = (box[res.home] && box[res.home][r.profile_id]) ? res.home : (box[res.away] && box[res.away][r.profile_id]) ? res.away : null;
    if (!code) return;
    CG.addEaRow(s, r);
    if (s.byClub && s.byClub[code]) CG.addEaRow(s.byClub[code], r);
  });
  CG.statPlayers(lg).forEach(function(p){   /* v4.08: players no longer rostered too; v4.13: and each club line */
    var s=pstats[p.id]; if(!s) return;
    [s].concat(Object.keys(s.byClub||{}).map(function(k){ return s.byClub[k]; })).forEach(function(x){
      if (x._ratN){ x.ratOff=x._ratOff/x._ratN; x.ratDef=x._ratDef/x._ratN; x.ratTeam=x._ratTeam/x._ratN; }
    });
  });
};

/* ---------- convenience selectors ---------- */
CG.playerById = function(lg,id){ return lg.players.find(function(p){ return p.id===id; }); };
/* v3.87: one week's Players of the Week, in the order every honors surface shows them. Weeks 1
   and 2 of Season 1 named a skater and a goaltender; from Week 3 on it is a forward, a defenseman
   and a goaltender, each with at least three games that week, all at that position.
   Returns [{p, pid, role, blurb, team}]. */
/* v4.13: each pick carries the club it was won for (team: the club of the winner's last game that week, stored with the
   award), so a winner later traded keeps the honor with that club; a winner who has since left the league still shows. */
CG.potwPicks = function(lg, w){
  if (!w) return [];
  return [[w.forward,"Forward",w.fBlurb,w.forwardTeam], [w.skater,"Skater",w.skBlurb,w.skaterTeam], [w.defense,"Defenseman",w.dBlurb,w.defenseTeam], [w.goalie,"Goaltender",w.glBlurb,w.goalieTeam]]
    .map(function(r){ var p = r[0] ? CG.statPlayerById(lg, r[0]) : null; return p ? { p:p, pid:r[0], role:r[1], blurb:r[2]||"", team:(r[3] && CG.TEAM[r[3]]) ? r[3] : p.team } : null; })
    .filter(Boolean);
};
/* Rule 8.1 (v2.22): clubs are ordered by TOTAL POINTS EARNED — games in hand are allowed to
   distort the table. Rule 8.2 breaks ties in a fixed order: head-to-head between the tied clubs,
   then regulation wins, then goal differential, then goals scored. Head-to-head is a mini-table
   among everyone tied, not a pairwise field, so it is computed per tied group rather than inside
   the comparator.

   This read r.homeScore / r.awayScore, which the live league object does not carry — a result row
   is { home, away, score:{CODE:goals}, ot, forfeit, … } (see the mapper in part_live.js). Both
   were therefore undefined, every row hit the null guard, and the whole tiebreaker returned zeros:
   head-to-head silently decided nothing. It now reads r.score and honours a forfeit the same way
   the season table does — a forfeit is a regulation result, so it never awards the OT point. */
CG.h2hPoints = function(lg, codes){
  var set = {}, out = {};
  codes.forEach(function(c){ set[c] = 1; out[c] = 0; });
  (lg.results || []).forEach(function(r){
    if (!set[r.home] || !set[r.away] || !r.score) return;
    var hs = r.score[r.home], as = r.score[r.away];
    if (hs == null || as == null) return;
    /* scored per club exactly the way the season table does (see the standings builder), so this
       tiebreaker can never disagree with the points it is breaking a tie on. An equal score with
       no forfeit is a loss for both sides rather than a win handed to the away club. */
    var ff = r.forfeit || null;
    [[r.home, hs, as], [r.away, as, hs]].forEach(function(x){
      var code = x[0], mine = x[1], theirs = x[2];
      var won = ff ? (ff !== code) : (mine > theirs);
      if (won) out[code] += 2;
      else if (!ff && r.ot && mine === theirs - 1) out[code] += 1;   /* the overtime loser's point */
    });
  });
  return out;
};
/* ---- The race: clinched, eliminated, magic number ----------------------------------------
   The site used to read a HAND-TYPED list of clinched clubs out of site_config
   ("clinched_<season>"), which nobody ever maintained — so the lock icon never appeared and the
   projected bracket never locked anyone in. This computes it instead, from the same points the
   table is sorted on (Rule 8.1: total points) against the qualifier count (Rule 8.1: top four per
   division, a Control Center setting).

   Both verdicts are deliberately CONSERVATIVE, because a wrong one is a broken promise:
     · clinched  — claimed only when the club is in even if every club that can still reach its
                   point total finishes above it on tiebreakers.
     · eliminated — claimed only when enough rivals are ALREADY strictly above the club's ceiling,
                   so no tiebreaker could rescue it.
   A club that is neither carries a magic number: points still needed to be certain. */
CG.raceMath = function(lg){
  var out = {}, perDiv = (CG.playoffPerDiv ? CG.playoffPerDiv() : 4);
  var sched = lg.schedule || [];
  CG.TEAMS.forEach(function(t){
    var rec = (lg.teams||{})[t.code] || { w:0,l:0,otl:0 };
    var pts = rec.w*2 + (rec.otl||0);
    var played = (rec.w||0) + (rec.l||0) + (rec.otl||0);
    var left = sched.filter(function(g){
      return g.stage==="regular" && g.status!=="final" && (g.home===t.code || g.away===t.code);
    }).length;
    out[t.code] = { code:t.code, div:t.div, pts:pts, gp:played, left:left, max:pts + left*2 };
  });
  CG.TEAMS.forEach(function(t){
    var me = out[t.code];
    var rivals = CG.TEAMS.filter(function(x){ return x.div===t.div && x.code!==t.code; })
                         .map(function(x){ return out[x.code]; });
    /* anyone who can still REACH my total is a threat — a tie can be lost on tiebreakers */
    var threats = rivals.filter(function(r){ return r.max >= me.pts; }).length;
    me.clinched = threats <= perDiv - 1;
    /* only certain when rivals are already STRICTLY past my ceiling */
    var above = rivals.filter(function(r){ return r.pts > me.max; }).length;
    me.eliminated = above >= perDiv;
    /* magic number: the smallest points gain that makes `clinched` true, capped by what's left */
    me.magic = null;
    if (!me.clinched && !me.eliminated){
      for (var add = 1; add <= me.left*2; add += 1){   /* an OT point is worth 1, so start at 1 */
        var hyp = me.pts + add;
        var stillThreat = rivals.filter(function(r){ return r.max >= hyp; }).length;
        if (stillThreat <= perDiv - 1){ me.magic = add; break; }
      }
    }
  });
  return out;
};
/* the codes that have mathematically clinched — replaces the dead hand-typed config list */
CG.clinchedCodes = function(lg){
  var r = CG.raceMath(lg), out = [];
  Object.keys(r).forEach(function(c){ if (r[c].clinched) out.push(c); });
  return out;
};
CG.standings = function(lg, div){
  var rows = CG.TEAMS.filter(function(t){ return !div || t.div===div; })
    .map(function(t){ return Object.assign({team:t}, lg.teams[t.code]); });
  /* Rule 8.1 (v2.22): clubs are ordered by TOTAL POINTS EARNED. The table is deliberately not
     adjusted for games in hand — a club that has played more games may stand higher on points
     alone, and the club beneath it holds the chance to pass it by playing what it is owed.
     Ties in points are then broken by Rule 8.2. */
  var pts = function(r){ return r.pts || 0; };
  rows.sort(function(a, b){ return pts(b) - pts(a); });
  var out = [], i = 0;
  while (i < rows.length){
    var j = i + 1;
    while (j < rows.length && pts(rows[j]) === pts(rows[i])) j++;
    var grp = rows.slice(i, j);
    if (grp.length > 1){
      var h2h = CG.h2hPoints(lg, grp.map(function(r){ return r.code; }));
      grp.sort(function(a, b){
        return (h2h[b.code] || 0) - (h2h[a.code] || 0)
            || (b.rw || 0) - (a.rw || 0)
            || b.diff - a.diff
            || b.gf - a.gf;
        /* still level after all four: Rule 8.2 sends it to a one-game play-in the office schedules */
      });
    }
    out = out.concat(grp);
    i = j;
  }
  return out;
};
/* v4.08: boards admit by the games played IN THAT ROLE, never by registered position: a goalie who skated is on the
   skater boards for his skating games, a skater who played goal is on the goalie boards for his starts. Players no longer
   rostered are on them too (their games are the official record, Rule 6.1); pass {current:true} for an award ballot. */
CG.skaterLeaders = function(lg, key, minGp, opts){
  var pool = (opts && opts.current) ? lg.players : CG.statPlayers(lg);
  return pool.filter(function(p){ var s = lg.pstats[p.id]; return s && s.sgp >= (minGp||1); })
    .sort(function(a,b){ return lg.pstats[b.id][key]-lg.pstats[a.id][key] || lg.pstats[b.id].p-lg.pstats[a.id].p; });
};
CG.goalieLeaders = function(lg, minGp, opts){
  var pool = (opts && opts.current) ? lg.players : CG.statPlayers(lg);
  return pool.filter(function(p){ var s = lg.pstats[p.id]; return s && s.gs >= (minGp||3); })
    .sort(function(a,b){
      var A=lg.pstats[a.id], B=lg.pstats[b.id];
      return (B.sv/Math.max(1,B.sa)) - (A.sv/Math.max(1,A.sa));
    });
};
/* One role's line, with gp and toi set to that role's own games and ice time, so any "x / s.gp" rate reads per role.
   role "S" (skating) or "G" (in goal). */
CG.roleLine = function(s, role){
  if (!s) return s;
  var o = {}; for (var k in s) o[k] = s[k];
  if (role === "G"){ o.gp = s.gs||0; o.toi = s.gToi; }
  else { o.gp = s.sgp||0; o.toi = s.skToi; }
  return o;
};
/* The roles a player actually played this season, his registered role first; with no games, just the registered role. */
CG.lineRoles = function(s, isG){
  var first = isG ? "G" : "S", second = isG ? "S" : "G";
  var has = function(r){ return !!s && (r === "G" ? (s.gs||0) : (s.sgp||0)) > 0; };
  var out = [];
  if (has(first) || !has(second)) out.push(first);
  if (has(second)) out.push(second);
  return out;
};
/* "G, skating" / "RD, in goal" when a player is listed under the role he did not register for; "" otherwise. */
CG.offRoleTag = function(p, role){
  if (!p) return "";
  var regG = p.pos === "G";
  if (role === "S" && regG) return "G, skating";
  if (role === "G" && !regG) return (p.pos || "Skater") + ", in goal";
  return "";
};

/* ---------- node test / facts harness ---------- */
if (typeof module !== "undefined" && typeof require !== "undefined" && require.main === module){
  var lg = CG.buildLeague();
  var mode = process.argv[2] || "--test";
  if (mode === "--test"){
    var errs = [];
    lg.results.forEach(function(r){
      [r.home,r.away].forEach(function(code){
        var box = r.box[code];
        var g=0,a=0,goalieOk=false;
        Object.keys(box).forEach(function(pid){
          var b=box[pid];
          if (b.goalie){ goalieOk = (b.sa - b.sv === b.ga); }
          else { g+=b.g; a+=b.a; }
        });
        if (g !== r.score[code]) errs.push(r.id+" "+code+": skater goals "+g+" != score "+r.score[code]);
        if (a > 2*r.score[code]) errs.push(r.id+" "+code+": assists "+a+" > 2x goals");
        if (!goalieOk) errs.push(r.id+" "+code+": goalie SA-SV != GA");
      });
    });
    var totW=0, totGames=lg.results.length, totGF=0, totGA=0;
    Object.keys(lg.teams).forEach(function(code){
      var t = lg.teams[code];
      if (t.gp !== t.w+t.l+t.otl) errs.push(code+": GP != W+L+OTL");
      if (t.pts !== t.w*2+t.otl) errs.push(code+": PTS formula");
      totW += t.w; totGF += t.gf; totGA += t.ga;
    });
    if (totW !== totGames) errs.push("total wins "+totW+" != games "+totGames);
    if (totGF !== totGA) errs.push("league GF != GA");
    lg.players.forEach(function(p){
      var r = lg.ratings[p.id].ovr;
      if (r<60||r>97) errs.push(p.tag+" rating out of range: "+r);
      /* v4.13: a player who changed clubs can have more games than his current club; each club line cannot */
      var bc = lg.pstats[p.id].byClub || {}, sum = 0;
      Object.keys(bc).forEach(function(code){ sum += bc[code].gp; if (bc[code].gp > lg.teams[code].gp) errs.push(p.tag+" GP for "+code+" > club GP"); });
      if (sum !== lg.pstats[p.id].gp) errs.push(p.tag+" club lines do not add up to the season line");
    });
    console.log(errs.length ? "FAIL\n"+errs.slice(0,20).join("\n") : "ALL INVARIANTS PASS");
    console.log("games simulated:", totGames, "| players:", lg.players.length);
    process.exit(errs.length?1:0);
  }
  if (mode === "--facts"){
    var f = { standings:{ East:[], West:[] }, leaders:[], goalies:[], potw:[], lastNight:[], rankings:[], suspension:null, feature:null };
    ["East","West"].forEach(function(dv){
      CG.standings(lg,dv).forEach(function(row,i){
        f.standings[dv].push({ rank:i+1, team:row.team.name, code:row.code, gp:row.gp, w:row.w, l:row.l, otl:row.otl,
          pts:row.pts, gf:row.gf, ga:row.ga, diff:row.diff, streak:row.streak, last5:row.last5.join("") });
      });
    });
    CG.skaterLeaders(lg,"p").slice(0,12).forEach(function(p,i){
      var s = lg.pstats[p.id];
      f.leaders.push({ rank:i+1, tag:p.tag, team:CG.TEAM[p.team].name, pos:p.pos, arch:p.arch, rookie:p.rookie,
        gp:s.gp, g:s.g, a:s.a, p:s.p, pim:s.pim, shpct: s.shots? Math.round(1000*s.g/s.shots)/10 : 0,
        ovr: lg.ratings[p.id].ovr });
    });
    CG.goalieLeaders(lg).slice(0,6).forEach(function(p,i){
      var s = lg.pstats[p.id];
      f.goalies.push({ rank:i+1, tag:p.tag, team:CG.TEAM[p.team].name, gp:s.gp, w:s.w, l:s.l, otl:s.otl,
        svpct: Math.round(1000*s.sv/Math.max(1,s.sa))/1000, gaa: Math.round(100*s.ga/Math.max(1,s.gp))/100, so:s.so,
        ovr: lg.ratings[p.id].ovr });
    });
    lg.potw.forEach(function(w){
      var sk = CG.playerById(lg,w.skater), gl = CG.playerById(lg,w.goalie);
      var ss = lg.pstats[sk.id], gs = lg.pstats[gl.id];
      f.potw.push({ week:w.week,
        skater:{ tag:sk.tag, team:CG.TEAM[sk.team].name, weekPts: Math.round(ss.weekly[w.week]||0) },
        goalie:{ tag:gl.tag, team:CG.TEAM[gl.team].name } });
    });
    lg.lastNight.forEach(function(r){
      f.lastNight.push({ id:r.id, week:r.week,
        final: CG.TEAM[r.home].name+" "+r.score[r.home]+"–"+r.score[r.away]+" "+CG.TEAM[r.away].name + (r.ot?" (OT)":""),
        stars: r.stars.map(function(s){ var p=CG.playerById(lg,s.pid); var b=r.box[s.team][s.pid];
          return p.tag+" ("+CG.TEAM[s.team].code+") " + (b.goalie? b.sv+" saves" : b.g+"G "+b.a+"A"); }) });
    });
    lg.powerRankings.forEach(function(pr){
      f.rankings.push({ rank:pr.rank, prev:pr.prev, move:pr.move, team:CG.TEAM[pr.team].name, code:pr.team,
        ovr: lg.teamRatings[pr.team].ovr,
        record: lg.teams[pr.team].w+"-"+lg.teams[pr.team].l+"-"+lg.teams[pr.team].otl });
    });
    var sus = lg.suspensions[0]; var sp = CG.playerById(lg,sus.playerId);
    f.suspension = { tag:sp.tag, team:CG.TEAM[sp.team].name, games:sus.games, reason:sus.reason, week:6, pimSeason: lg.pstats[sp.id].pim };
    var feat = lg.schedule.find(function(g){ return g.feature; });
    var h=lg.teams[feat.home], a=lg.teams[feat.away];
    f.feature = { home:CG.TEAM[feat.home].name, away:CG.TEAM[feat.away].name,
      homeRec:h.w+"-"+h.l+"-"+h.otl, awayRec:a.w+"-"+a.l+"-"+a.otl, week:feat.week };
    console.log(JSON.stringify(f,null,1));
  }
  if (mode === "--size"){
    console.log("results:", lg.results.length, "players:", lg.players.length, "schedule:", lg.schedule.length);
  }
}
