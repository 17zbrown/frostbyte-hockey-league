/* ================================================================
   PREVIEW LAYER — loaded ONLY in preview.html (never index.html).
   Visual direction test: score strip in place of the ticker, and a
   static hero + latest-news rail in place of the home carousel.
   Everything else — every route, module, and behavior — is the
   production code untouched. All overrides fail safe: if a marker
   isn't found, the original rendering ships unchanged.
   ================================================================ */
(function(){
  "use strict";

  /* ---- preview-only styles ---- */
  var css = ''+
  '#pv-ribbon{background:var(--gold);color:#101519;font-family:var(--f-mono);font-size:10.5px;font-weight:600;'+
    'letter-spacing:.14em;text-transform:uppercase;text-align:center;padding:6px 12px}'+
  '#ticker{height:auto}'+
  '.pvstrip{display:flex;align-items:stretch;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;'+
    'background:#0B0F12;border-bottom:1px solid #232B31;padding:0 clamp(8px,2vw,24px)}'+
  '.pvstrip::-webkit-scrollbar{display:none}'+
  '.pv-date{flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;padding:12px 16px 12px 6px;border-right:1px solid #232B31}'+
  '.pv-date b{font-family:var(--f-disp);font-weight:900;font-size:14px;color:var(--chrome)}'+
  '.pv-date span{font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;color:var(--on-ink-dim)}'+
  '.pv-game{flex:0 0 auto;min-width:178px;padding:10px 16px;border-right:1px solid #232B31;display:flex;flex-direction:column;gap:5px;color:var(--on-ink)}'+
  'a.pv-game:hover{background:#12181D}'+
  '.pv-st{font-family:var(--f-mono);font-size:9.5px;font-weight:600;letter-spacing:.14em;color:var(--on-ink-dim);display:flex;align-items:center;gap:7px}'+
  '.pv-row{display:flex;align-items:center;gap:8px;font-size:13px}'+
  '.pv-row b{font-family:var(--f-disp);font-weight:700}'+
  '.pv-row .sc{margin-left:auto;font-family:var(--f-mono);font-weight:600;font-variant-numeric:tabular-nums}'+
  '.pv-row.win .sc::after{content:"";display:inline-block;width:7px;height:7px;margin-left:6px;background:var(--chrome);clip-path:polygon(0 0,100% 50%,0 100%)}'+
  '.pv-row.dim{opacity:.6}'+
  '.pv-hero-grid{display:grid;grid-template-columns:1.55fr 1fr;gap:clamp(24px,4vw,60px);align-items:start}'+
  '.pv-hero h2.pv-head{font-family:var(--f-disp);font-weight:900;font-size:clamp(38px,5.6vw,68px);line-height:.94;'+
    'letter-spacing:-.025em;text-transform:uppercase;color:#fff;margin:14px 0 16px;max-width:14ch}'+
  '.pv-hero h2.pv-head .acc{color:var(--chrome)}'+
  '.pv-dek{font-size:clamp(15px,1.25vw,17px);line-height:1.55;color:var(--on-ink-dim);max-width:52ch}'+
  '.pv-ctas{display:flex;gap:12px;margin-top:24px;flex-wrap:wrap}'+
  '.pv-facts{display:flex;gap:26px;margin-top:30px;padding-top:18px;border-top:1px solid #232B31;flex-wrap:wrap}'+
  '.pv-fact b{font-family:var(--f-disp);font-weight:900;font-size:21px;display:block;color:#fff;font-variant-numeric:tabular-nums}'+
  '.pv-fact span{font-family:var(--f-mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--on-ink-dim)}'+
  '.pv-rail{border-left:1px solid #232B31;padding-left:clamp(18px,2.5vw,32px)}'+
  '.pv-rail .rh{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px}'+
  '.pv-rail a.pv-story{display:block;padding:14px 0;border-bottom:1px solid #232B31}'+
  '.pv-rail a.pv-story:last-of-type{border-bottom:0}'+
  '.pv-rail .cat{font-family:var(--f-mono);font-size:9.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--chrome)}'+
  '.pv-rail h3{font-family:var(--f-disp);font-weight:700;font-size:16px;line-height:1.3;color:#fff;margin-top:4px}'+
  '.pv-rail a.pv-story:hover h3{color:var(--chrome)}'+
  '.pv-rail time{font-family:var(--f-mono);font-size:10px;color:var(--on-ink-dim)}'+
  '@media(max-width:820px){.pv-hero-grid{grid-template-columns:1fr}'+
    '.pv-rail{border-left:0;padding-left:0;border-top:1px solid #232B31;padding-top:10px}}'+
  '@media(max-width:560px){.pv-facts{display:grid;grid-template-columns:1fr 1fr;gap:16px}}';
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---- preview ribbon (so nobody mistakes this for the live site) ---- */
  function ensureRibbon(){
    if (document.getElementById("pv-ribbon")) return;
    var r = document.createElement("div");
    r.id = "pv-ribbon";
    r.textContent = "Preview build · testing the new look · the real site is unchanged";
    document.body.insertBefore(r, document.body.firstChild);
  }

  /* ---- score strip in place of the ticker (same data, richer display) ---- */
  function crest(code, size){ return CG.crest ? CG.crest(code, size||18) : ""; }
  function stripHtml(){
    var lg = CG.lg || {}, out = [];
    var finals = (lg.allResults||[]).slice().sort(function(a,b){ return b.at-a.at; }).slice(0,3).reverse();
    var upcoming = (lg.schedule||[]).filter(function(g){ return g.at > CG.now(); })
      .sort(function(a,b){ return a.at-b.at; }).slice(0, 6 - finals.length);
    finals.forEach(function(r){
      var aw = r.score[r.away], hs = r.score[r.home];
      out.push('<a class="pv-game" href="#/matchup/'+r.id+'"><span class="pv-st">FINAL'+(r.ot?" · OT":"")+'</span>'+
        '<span class="pv-row'+(aw>hs?" win":" dim")+'">'+crest(r.away)+'<b>'+esc(r.away)+'</b><span class="sc">'+aw+'</span></span>'+
        '<span class="pv-row'+(hs>aw?" win":" dim")+'">'+crest(r.home)+'<b>'+esc(r.home)+'</b><span class="sc">'+hs+'</span></span></a>');
    });
    upcoming.forEach(function(g){
      var live = (CG.liveStreamers && CG.liveStreamers(g).length);
      out.push('<a class="pv-game" href="#/matchup/'+g.id+'"><span class="pv-st">'+
          (live ? '<span class="live-dot"></span>LIVE' : esc(CG.fmtDay(g.at).toUpperCase())+' · '+esc(CG.fmtTime(g.at)))+'</span>'+
        '<span class="pv-row">'+crest(g.away)+'<b>'+esc(g.away)+'</b></span>'+
        '<span class="pv-row">'+crest(g.home)+'<b>'+esc(g.home)+'</b></span></a>');
    });
    if (!out.length){
      /* no games yet — the strip carries the real season milestones instead of going blank */
      var s = CG.SEASON || {};
      [["Sign-up deadline", s.registration_deadline], ["Pre-season", s.preseason_starts_at],
       ["Draft night", s.draft_at], ["Free agency", s.free_agency_opens_at], ["Puck drop", s.starts_at]]
      .forEach(function(m){
        if (!m[1]) return;
        out.push('<span class="pv-game"><span class="pv-st">'+esc(m[0].toUpperCase())+'</span>'+
          '<span class="pv-row"><b>'+esc(CG.fmtDay(Date.parse(m[1])))+'</b></span></span>');
      });
    }
    var label = (lg.schedule||[]).length ? "Games" : "The road ahead";
    return '<div class="pvstrip"><div class="pv-date"><span>'+esc((CG.seasonTag&&CG.seasonTag())||"Season 1")+'</span><b>'+esc(label)+'</b></div>'+out.join("")+'</div>';
  }
  var _renderChrome = CG.renderChrome;
  CG.renderChrome = function(){
    _renderChrome.apply(this, arguments);
    try {
      ensureRibbon();
      var t = document.getElementById("ticker");
      if (t) t.innerHTML = stripHtml();
    } catch(e){ /* fail safe: the original ticker stays */ }
  };

  /* ---- home: static hero + latest-news rail in place of the carousel ---- */
  function pvHero(){
    var s = CG.SEASON || {}, lg = CG.lg || {};
    var pre = CG.isPreseason && CG.isPreseason();
    var startMs = CG.seasonStartMs && CG.seasonStartMs();
    var active = s.status === "active";
    var dateTag = startMs ? CG.fmtDay(startMs).replace(/^[A-Za-z]+, /, "").toUpperCase() : "";
    var head = active
      ? esc((s.name||"The season")).toUpperCase()+' <span class="acc">IS LIVE.</span>'
      : 'THE PUCK DROPS <span class="acc">'+esc(dateTag)+'.</span>';
    var regOpen = !!(s.registration_open && s.status !== "active");
    var dek = esc(CG.TEAMS.length)+' clubs, '+esc((CG.DIVISIONS||[1,2]).length)+' divisions. '+
      (regOpen ? 'Registration is open now'+(s.registration_deadline?' — sign up by '+esc(CG.fmtDay(Date.parse(s.registration_deadline)))+' to enter the draft.':'.')
               : 'Every box score imports straight from EA.');
    var days = CG.daysToStart && CG.daysToStart();
    var facts = [];
    if (days != null && !active) facts.push(['<b>'+days+'</b>','days to puck drop']);
    if (s.draft_at) facts.push(['<b>'+esc(CG.fmtDay(Date.parse(s.draft_at)).replace(/^[A-Za-z]+, /,"").toUpperCase())+'</b>','draft night']);
    if (CG.CAP) facts.push(['<b>$'+(CG.CAP/1e6)+'M</b>','salary cap']);
    facts.push(['<b>6v6</b>','EA Sports NHL']);
    var arts = ((CG.CONTENT && CG.CONTENT.articles) || []).slice(0,4);
    var rail = arts.length ? arts.map(function(a){
        return '<a class="pv-story" href="#/article/'+esc(a.slug)+'"><span class="cat">'+esc(a.category||"League")+'</span>'+
          '<h3>'+esc(a.title)+'</h3><time>'+esc(a.dateIso||"")+'</time></a>';
      }).join("")
      : '<p class="caption" style="color:var(--on-ink-dim);padding:8px 0">League news runs here — the wire opens with the season.</p>';
    return '<section id="hero"><div class="shell pv-hero pv-hero-grid">'+
      '<div><span class="eyebrow chr" style="color:var(--on-ink-dim)">'+esc((CG.seasonTag&&CG.seasonTag())||"Season 1")+(pre?' · Pre-season':' · Inaugural')+'</span>'+
        '<h2 class="pv-head">'+head+'</h2>'+
        '<p class="pv-dek">'+dek+'</p>'+
        '<div class="pv-ctas">'+
          (regOpen ? '<a class="btn btn-chrome" href="#/register">Register to play</a>' : '<a class="btn btn-chrome" href="#/schedule">Full schedule</a>')+
          '<a class="btn" style="border:1.5px solid #39434B;color:var(--on-ink)" href="#/rulebook">How the season works</a></div>'+
        '<div class="pv-facts">'+facts.map(function(f){ return '<div class="pv-fact">'+f[0]+'<span>'+esc(f[1])+'</span></div>'; }).join("")+'</div></div>'+
      '<aside class="pv-rail" aria-label="Latest news"><div class="rh"><span class="eyebrow" style="color:var(--on-ink-dim)">Latest</span>'+
        '<a class="sec-link" style="color:#fff" href="#/news">All news</a></div>'+rail+'</aside>'+
    '</div></section>';
  }
  var _home = CG.ROUTES.home;
  CG.ROUTES.home = function(param, qs){
    var html = _home(param, qs);
    try {
      var a = html.indexOf('<section id="hero">');
      var endMark = '</aside></div></section>';
      var b = html.indexOf(endMark, a);
      if (a < 0 || b < 0) return html;            /* markers moved — ship the original untouched */
      return html.slice(0, a) + pvHero() + html.slice(b + endMark.length);
    } catch(e){ return html; }
  };
  /* AFTER.home stays the original: the carousel call no-ops without #heroCaro,
     and the countdown wiring is id-based and untouched. */
})();
