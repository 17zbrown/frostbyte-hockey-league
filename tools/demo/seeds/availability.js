/* seed: availability — an open game week (Wed/Thu/Fri nights, three club games a night, Wed 7:30 PM
   ET deadline) and a populated club grid, so #/hub/availability and the dashboard card render
   mid-week as a member sees them. v2.44: answers are PER GAME (nights[k].games[gameId] = yes|no),
   with nights[k].st as the night's summary. Source of the shapes: part_live.js WEEK8, avFor/avGame,
   clubGamesOnNight, availGet. */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "availability", run: function(CG, t, uid){
  function ymd(ts){ return new Intl.DateTimeFormat("en-CA", { timeZone:"America/New_York" }).format(new Date(ts)); }
  var now = CG.now(), dow = new Date(now).getDay();
  var wed = now + ((((3 - dow) + 7) % 7) || 7) * 864e5;
  if (Date.parse(CG.etISO(ymd(wed), "19:30")) < now) wed += 7*864e5;
  var days = [0,1,2].map(function(i){ return ymd(wed + i*864e5); });
  CG.WEEK8 = { key:"w3", label:"Week 3", deadline: Date.parse(CG.etISO(days[0], "19:30")),
    nights: days.map(function(d, i){ return { key:"n"+(i+1), at: Date.parse(CG.etISO(d, "21:00")), day: d }; }), open:true };
  /* the club's three games a night (Rule 5.2) — the prototype schedule only books one, so add the
     other two against rotating opponents at the real 9:00 / 9:40 / 10:20 PM ET slots */
  var club = t.code, others = CG.TEAMS.map(function(x){ return x.code; }).filter(function(c){ return c !== club; });
  var sched = CG.lg.schedule = (CG.lg.schedule || []);
  var GAME_IDS = {};
  days.forEach(function(d, ni){
    GAME_IDS["n"+(ni+1)] = [];
    /* drop whatever the prototype booked for the club that day so the night is exactly three */
    for (var k = sched.length - 1; k >= 0; k--){ var g = sched[k]; if ((g.home===club||g.away===club) && ymd(g.at)===d) sched.splice(k,1); }
    ["21:00","21:40","22:20"].forEach(function(hm, gi){
      var opp = others[(ni*3 + gi) % others.length];
      var id = "avg-n"+(ni+1)+"-"+(gi+1);
      sched.push({ id:id, week:3, stage:"regular", home: gi%2 ? opp : club, away: gi%2 ? club : opp,
        at: Date.parse(CG.etISO(d, hm)), status:"scheduled", code:null, server:null });
      GAME_IDS["n"+(ni+1)].push(id);
    });
  });
  CG._avail = CG._avail || {};
  /* a believable grid: most of the room answered every game, some are out for one game, a couple
     did not answer at all, one note */
  CG.avFor = function(pid){
    var saved = CG.availGet ? CG.availGet(pid) : null, base = { nights:{}, at:null };
    (CG.WEEK8.nights||[]).forEach(function(n){ base.nights[n.key] = { st:"nr", games:{} }; });
    if (saved){
      var o = { at:saved.at, nights:{} };
      Object.keys(base.nights).forEach(function(k){
        var v = saved.nights[k]; if (!v){ o.nights[k] = { st:"nr", games:{} }; return; }
        var games = v.games || {}, ids = Object.keys(games), st = v.st;
        if (ids.length){ var y = ids.filter(function(g){ return games[g]==="yes"; }).length; st = y===ids.length?"yes":y===0?"no":"part"; }
        o.nights[k] = { st: st||"nr", games: games, note: v.note||"" };
      });
      return o;
    }
    var h = 0; String(pid).split("").forEach(function(c){ h += c.charCodeAt(0); });
    if (h % 5 === 0) return base;                      /* the silent ones */
    Object.keys(base.nights).forEach(function(k, i){
      var games = {};
      GAME_IDS[k].forEach(function(gid, gi){ games[gid] = ((h*(i+3) + gi*7) % 9 === 0) ? "no" : "yes"; });
      var ids = Object.keys(games), y = ids.filter(function(g){ return games[g]==="yes"; }).length;
      base.nights[k] = { st: y===ids.length?"yes":y===0?"no":"part", games: games, note: (i===1 && h%3===0) ? "on at 9:30 after work" : "" };
    });
    base.at = now - (h % 40) * 36e5;
    return base;
  };
  /* ?state=submitted → the player already answered (dashboard "Submitted" card, "Update availability") */
  var st = (window.GUIDE.qs.get("state") || "");
  if (st === "submitted"){
    var mk = function(vals){ var o = {}; GAME_IDS[vals[0]].forEach(function(gid, i){ o[gid] = vals[1][i]; }); return o; };
    CG._avail[CG.WEEK8.key+":"+uid] = { at: now - 2*36e5, nights:{
      n1:{ games: mk(["n1",["yes","yes","yes"]]), st:"yes", note:"" },
      n2:{ games: mk(["n2",["yes","no","yes"]]), st:"part", note:"on at 9:30 after work" },
      n3:{ games: mk(["n3",["no","no","no"]]), st:"no", note:"" } } };
  }
  if (st === "closed") CG.WEEK8.deadline = now - 20*36e5;
} });
