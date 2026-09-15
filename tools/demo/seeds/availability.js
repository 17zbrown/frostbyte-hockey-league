/* seed: availability — an open game week (Wed/Thu/Fri nights, Wed 7:30 PM ET deadline) and a
   populated club grid, so #/hub/availability and the dashboard card render mid-week as a member
   sees them. Source of the shapes: part_live.js WEEK8 (:662-698), avFor (:700-709), availGet (:4727). */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "availability", run: function(CG, t, uid){
  function ymd(ts){ return new Intl.DateTimeFormat("en-CA", { timeZone:"America/New_York" }).format(new Date(ts)); }
  var now = CG.now(), dow = new Date(now).getDay();
  var wed = now + ((((3 - dow) + 7) % 7) || 7) * 864e5;
  if (Date.parse(CG.etISO(ymd(wed), "19:30")) < now) wed += 7*864e5;
  CG.WEEK8 = { key:"w3", label:"Week 3", deadline: Date.parse(CG.etISO(ymd(wed), "19:30")),
    nights: [0,1,2].map(function(i){ return { key:"n"+(i+1), at: Date.parse(CG.etISO(ymd(wed + i*864e5), "21:00")) }; }), open:true };
  CG._avail = CG._avail || {};
  /* a believable grid: most of the room answered, a couple did not, one note */
  var pool = ["yes","yes","yes","maybe","no","late","yes","until","emg","yes"];
  CG.avFor = function(pid){
    var saved = CG.availGet ? CG.availGet(pid) : null, base = { nights:{}, at:null };
    (CG.WEEK8.nights||[]).forEach(function(n){ base.nights[n.key] = { st:"nr" }; });
    if (saved){ var o = { at:saved.at, nights:{} }; Object.keys(base.nights).forEach(function(k){ o.nights[k] = saved.nights[k] || { st:"nr" }; }); return o; }
    var h = 0; String(pid).split("").forEach(function(c){ h += c.charCodeAt(0); });
    if (h % 5 === 0) return base;                      /* the silent ones */
    Object.keys(base.nights).forEach(function(k, i){ base.nights[k] = { st: pool[(h*(i+3)+i) % pool.length], note: (i===1 && h%3===0) ? "on at 9:30 after work" : "" }; });
    base.at = now - (h % 40) * 36e5;
    return base;
  };
  /* ?state=submitted → the player already answered (dashboard "Submitted" card, "Update availability") */
  var st = (window.GUIDE.qs.get("state") || "");
  if (st === "submitted") CG._avail[CG.WEEK8.key+":"+uid] = { at: now - 2*36e5, nights:{ n1:{ st:"yes", note:"" }, n2:{ st:"late", note:"on at 9:30 after work" }, n3:{ st:"no", note:"" } } };
  if (st === "closed") CG.WEEK8.deadline = now - 20*36e5;
} });
