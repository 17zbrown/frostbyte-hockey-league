/* ================================================================
   PREVIEW LAYER — loaded ONLY in preview.html (never index.html).
   Direction: the framed-canvas look — a dark, warmly lit surround
   holding one large rounded light canvas; floating pill nav; an
   elegant serif hero; and a dark showcase panel carrying a live
   statistical dashboard (animated counters, a real sign-up curve,
   position mix) built ONLY from league data.
   Every route, module, and behavior is the production code
   untouched; overrides fail safe to the original rendering.
   ================================================================ */
(function(){
  "use strict";

  /* serif display + Sora for everything else */
  var fl = document.createElement("link");
  fl.rel = "stylesheet";
  fl.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Sora:wght@300;400;600;700;800&display=swap";
  document.head.appendChild(fl);

  /* Zuume (Adobe Fonts): paste the web-project id from fonts.adobe.com and the
     real face takes over everywhere; until then Bebas Neue stands in. */
  var TYPEKIT_ID = "dvf3fqu";
  if (TYPEKIT_ID){
    var tk = document.createElement("link");
    tk.rel = "stylesheet"; tk.href = "https://use.typekit.net/" + TYPEKIT_ID + ".css";
    document.head.appendChild(tk);
  }

  var css = ''+
  ':root{--f-sharp:"Sora",-apple-system,sans-serif;--f-display:"zuume","Bebas Neue",Impact,sans-serif}'+
  /* the whole base type system routes into the new fonts: every label, date,
     chip, table cell, and stat number is Sora; display headings are Zuume */
  ':root{--f-body:"Sora",-apple-system,sans-serif;--f-disp:"Sora",-apple-system,sans-serif;'+
    '--f-mono:"Sora",-apple-system,sans-serif}'+
  '.num,.mono,.tbl td,.val,.statline b,.pv-kpi b,.kpi b,.ovrbox{font-variant-numeric:tabular-nums}'+
  '#app svg text{font-family:var(--f-sharp)}'+
  '.pop{border-color:var(--line)!important;border-radius:16px;box-shadow:0 18px 50px rgba(16,21,25,.14)}'+

  /* ---- the dark, warmly lit surround + the floating canvas ---- */
  'html[data-theme="light"] body,body{background:#191410!important}'+
  '#pv-aura{position:fixed;inset:0;z-index:0;pointer-events:none;background:'+
    /* a quiet scrim across the header band, so the tab rests in shade and the glow blooms below it */
    'linear-gradient(180deg,rgba(20,15,11,.92) 0,rgba(20,15,11,.55) 110px,rgba(20,15,11,0) 260px),'+
    'radial-gradient(1150px 760px at 84% 6%,rgba(255,166,54,.40),transparent 63%),'+
    'radial-gradient(950px 680px at 2% 20%,rgba(255,92,44,.27),transparent 62%),'+
    'radial-gradient(1050px 780px at 52% 106%,rgba(255,196,64,.26),transparent 66%),'+
    'radial-gradient(760px 540px at 95% 70%,rgba(255,124,40,.18),transparent 62%)}'+
  '#pv-ribbon{position:relative;z-index:1}'+
  '#pv-frame{width:calc(100% - clamp(20px,3.5vw,56px));max-width:1720px;margin:0 auto 48px;'+
    'border-radius:30px;overflow:clip;background:var(--paper);box-shadow:0 30px 90px rgba(0,0,0,.55);position:relative}'+
  '#pv-ribbon{background:transparent;color:#E8C05A;font-family:var(--f-sharp);font-size:10.5px;font-weight:600;'+
    'letter-spacing:.14em;text-transform:uppercase;text-align:center;padding:9px 12px 3px}'+

  /* ---- masthead on the dark surround; the nav is a white tab fused to the canvas ---- */
  '#masthead{position:relative!important;z-index:60;background:transparent!important;border-bottom:0!important;color:#fff}'+
  '#masthead .mh{align-items:flex-end;padding-top:8px}'+
  '#masthead .mh>*:not(.mh-nav){margin-bottom:15px}'+
  '#masthead .wm b{color:#fff!important}'+
  '#masthead .wm span{color:rgba(255,255,255,.55)!important}'+
  '#masthead .mh-nav{background:var(--paper);border:0;border-radius:20px 20px 0 0;'+
    'padding:13px 12px 15px;margin:0 auto;flex:0 1 auto;position:relative;gap:2px}'+
  '#masthead .mh-nav::before,#masthead .mh-nav::after{content:"";position:absolute;bottom:0;width:18px;height:18px}'+
  '#masthead .mh-nav::before{left:-18px;background:radial-gradient(circle at 0 0,transparent 17.5px,var(--paper) 18px)}'+
  '#masthead .mh-nav::after{right:-18px;background:radial-gradient(circle at 100% 0,transparent 17.5px,var(--paper) 18px)}'+
  '#masthead .mh-nav a{color:var(--steel)!important;border:1px solid transparent;border-radius:999px;padding:8px 16px;'+
    'font-family:var(--f-sharp);font-weight:600;font-size:13.5px}'+
  '#masthead .mh-nav a:hover{color:var(--ink)!important}'+
  '#masthead .mh-nav a.on{background:#fff;border-color:#E3E6DF;color:#101519!important;'+
    'box-shadow:0 1px 5px rgba(16,21,25,.08)}'+
  '#masthead .mh-nav a.on::after{display:none}'+
  '#masthead .icon-btn{color:#fff;border-color:rgba(255,255,255,.28);background:transparent;border-radius:999px}'+
  '#masthead .mh-burger{color:#fff}'+
  '#masthead a[aria-label="Join with Discord"]{background:#fff!important;border:0!important;'+
    'color:#101519!important;border-radius:999px!important;font-weight:600}'+
  '#masthead .shell{max-width:1680px}'+
  '#masthead .mh{min-height:76px}'+
  '@media(min-width:1200px){#masthead .mh{position:relative}'+
    '#masthead .mh-nav{position:absolute;left:0;right:0;bottom:0;width:fit-content;margin:0 auto}'+
    '#masthead .mh-right{margin-left:auto}}'+
  '@media(max-width:900px){#masthead .mh-nav::before,#masthead .mh-nav::after{display:none}}'+
  '@media(min-width:1101px) and (max-width:1199px){#masthead .mh{flex-wrap:wrap;justify-content:space-between}'+
    '#masthead .mh-nav{order:9;flex:0 1 auto;margin:0 auto}}'+
  '@media(max-width:1100px){#masthead .mh{min-height:0;align-items:center;padding:10px 0}'+
    '#masthead .mh>*:not(.mh-nav){margin-bottom:0}}'+

  /* ---- the ticker band is retired; Up-next lives in the League Pulse card ---- */
  '#ticker{display:none}'+

  /* ---- serif hero, centered like the reference ---- */
  '#hero{background:var(--paper);color:var(--ink)}'+
  '.pv-soft{text-align:center;padding-top:clamp(56px,8vw,104px);padding-bottom:clamp(40px,5.5vw,72px)}'+
  '.pv-soft h2.big{font-family:var(--f-display);font-weight:700;font-size:clamp(58px,9vw,132px);line-height:.92;'+
    'letter-spacing:.01em;text-transform:uppercase;color:var(--ink);margin:0 auto 18px;max-width:16ch;text-wrap:balance}'+
  '.pv-soft .dek{font-family:var(--f-sharp);font-weight:300;font-size:clamp(15px,1.3vw,17.5px);line-height:1.65;'+
    'color:var(--steel);max-width:46ch;margin:0 auto}'+
  '.pv-soft .row{display:flex;align-items:center;justify-content:center;gap:24px;margin-top:32px;flex-wrap:wrap}'+
  '.pv-cta{display:inline-flex;align-items:center;gap:12px;background:#101519;color:#fff;border-radius:999px;'+
    'padding:10px 10px 10px 22px;font-family:var(--f-sharp);font-weight:600;font-size:14.5px;transition:transform .25s ease,box-shadow .25s ease}'+
  '.pv-cta .dot{width:30px;height:30px;border-radius:50%;background:var(--chrome);display:grid;place-items:center;color:#101519;font-size:14px}'+
  '.pv-cta:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(16,21,25,.25)}'+
  '.pv-soft .quiet{font-family:var(--f-sharp);font-weight:600;font-size:14px;color:var(--ink);'+
    'border-bottom:2px solid var(--chrome);padding-bottom:2px;transition:color .25s}'+
  '.pv-soft .quiet:hover{color:var(--gold)}'+
  '.pv-meta{margin-top:20px;font-family:var(--f-sharp);font-weight:300;font-size:12.5px;color:var(--steel)}'+
  '.pv-meta b{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}'+
  '.pv-crests{display:flex;justify-content:center;align-items:center;gap:clamp(16px,2.6vw,32px);flex-wrap:wrap;'+
    'margin-top:clamp(36px,5vw,56px)}'+
  '.pv-crests a{opacity:.45;filter:grayscale(1);transition:opacity .3s ease,filter .3s ease}'+
  '.pv-crests a:hover{opacity:1;filter:none}'+

  /* ---- the dark stage: ambient panel + the live dashboard ---- */
  '.pv-stage{position:relative;border-radius:26px;background:#12161B;color:#EDEFE9;overflow:hidden;'+
    'padding:clamp(24px,4vw,56px)}'+
  '.pv-stage::before{content:"";position:absolute;inset:0;pointer-events:none;background:'+
    'radial-gradient(640px 420px at 78% 8%,rgba(255,160,64,.30),transparent 60%),'+
    'radial-gradient(560px 420px at 12% 92%,rgba(255,72,40,.22),transparent 60%)}'+
  '.pv-stage-grid{position:relative;display:grid;grid-template-columns:1.12fr .88fr;gap:clamp(24px,4vw,56px);align-items:center}'+
  '.pv-stage p.cap{font-family:var(--f-sharp);font-weight:300;font-size:clamp(15px,1.25vw,17px);line-height:1.7;'+
    'color:rgba(237,239,233,.85);max-width:44ch}'+
  '.pv-stage .cap-link{display:inline-block;margin-top:16px;font-family:var(--f-sharp);font-weight:600;font-size:13.5px;'+
    'color:#fff;border-bottom:2px solid var(--chrome);padding-bottom:2px}'+
  '.pv-stage .cap-link:hover{color:var(--chrome)}'+
  '.pv-scroll{position:relative;display:flex;align-items:center;gap:10px;margin-top:clamp(22px,3vw,34px);'+
    'font-family:var(--f-sharp);font-weight:300;font-size:12px;color:rgba(237,239,233,.6)}'+
  '.pv-scroll .o{width:30px;height:30px;border-radius:50%;border:1px solid rgba(237,239,233,.3);display:grid;place-items:center}'+

  /* the dashboard card */
  '.pv-dash{background:#fff;color:#101519;border-radius:18px;box-shadow:0 26px 70px rgba(0,0,0,.5);'+
    'padding:20px 22px;max-width:540px;margin:0 auto;width:100%}'+
  '.pv-dash .dh{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px}'+
  '.pv-dash .dh b{font-family:var(--f-sharp);font-weight:700;font-size:15px;color:#101519}'+
  '.pv-dash .dh span{font-family:var(--f-sharp);font-weight:300;font-size:11.5px;color:#5C6B75}'+
  '.pv-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}'+
  '.pv-kpi b{display:block;font-family:var(--f-sharp);font-weight:700;font-size:clamp(19px,1.8vw,25px);'+
    'color:#101519;font-variant-numeric:tabular-nums}'+
  '.pv-kpi span{font-family:var(--f-sharp);font-weight:300;font-size:10.5px;color:#5C6B75;line-height:1.35;display:block;margin-top:2px}'+
  '.pv-ch h4{font-family:var(--f-sharp);font-weight:600;font-size:12px;color:#5C6B75;margin:0 0 8px}'+
  '.pv-ch svg{width:100%;height:110px;display:block}'+
  '.pv-ch .ln{fill:none;stroke:var(--gold);stroke-width:2;stroke-linecap:round;'+
    'stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.4s ease .25s}'+
  '.in .pv-ch .ln{stroke-dashoffset:0}'+
  '.pv-ch .ar{fill:var(--chrome);opacity:0;transition:opacity 1s ease .8s}'+
  '.in .pv-ch .ar{opacity:.16}'+
  '.pv-ch .dotp{fill:var(--gold);opacity:0;transition:opacity .5s ease 1.3s}'+
  '.in .pv-ch .dotp{opacity:1}'+
  '.pv-prog{height:8px;border-radius:999px;background:#F0F2EE;overflow:hidden}'+
  '.pv-prog i{display:block;height:100%;border-radius:999px;background:var(--gold);'+
    'transform:scaleX(0);transform-origin:left;transition:transform 1.2s ease .3s}'+
  '.in .pv-prog i{transform:scaleX(1)}'+
  '.pv-pos{display:flex;gap:14px;margin-top:16px}'+
  '.pv-pos .p{flex:1}'+
  '.pv-pos .p em{font-style:normal;font-family:var(--f-sharp);font-weight:300;font-size:10.5px;color:#5C6B75;'+
    'display:flex;justify-content:space-between;margin-bottom:5px}'+
  '.pv-pos .p em b{font-weight:600;color:#101519}'+
  '.pv-un{margin-top:16px;border-top:1px solid #F0F2EE;padding-top:13px}'+
  '.pv-un h4{font-family:var(--f-sharp);font-weight:600;font-size:12px;color:#5C6B75;margin:0 0 6px}'+
  '.pv-unr{display:flex;align-items:center;gap:10px;padding:6px 0;color:#101519}'+
  '.pv-unr .d{width:7px;height:7px;border-radius:50%;background:var(--chrome);flex-shrink:0}'+
  '.pv-unr b{font-family:var(--f-sharp);font-weight:600;font-size:13.5px;color:#101519;display:flex;align-items:center;gap:7px}'+
  '.pv-unr time{margin-left:auto;font-family:var(--f-sharp);font-weight:300;font-size:12px;color:#5C6B75;'+
    'font-variant-numeric:tabular-nums;white-space:nowrap}'+
  'a.pv-unr:hover b{color:var(--gold)}'+
  '.pv-bar{height:6px;border-radius:999px;background:#F0F2EE;overflow:hidden}'+
  '.pv-bar i{display:block;height:100%;border-radius:999px;background:#101519;'+
    'transform:scaleX(0);transform-origin:left;transition:transform .9s ease .4s}'+
  '.in .pv-bar i{transform:scaleX(1)}'+
  '@media(max-width:1060px){.pv-stage-grid{grid-template-columns:1fr}.pv-dash{max-width:640px}}'+
  '@media(max-width:640px){.pv-kpis{grid-template-columns:1fr 1fr}}'+
  '@media(max-width:1020px){.pv-nrow{grid-template-columns:118px 148px 1fr 76px}}'+

  /* ---- Namesake Watch: NHL Stats API, club-coloured bar race ---- */
  '.pv-nhl-panel{position:relative;border-radius:26px;background:#12161B;color:#EDEFE9;overflow:hidden;'+
    'padding:clamp(24px,4vw,48px)}'+
  '.pv-nhl-panel::before{content:"";position:absolute;inset:0;pointer-events:none;background:'+
    'radial-gradient(600px 400px at 14% 0%,rgba(255,160,64,.20),transparent 60%),'+
    'radial-gradient(540px 400px at 92% 100%,rgba(255,72,40,.15),transparent 60%)}'+
  '.pv-nhl-h{position:relative;display:flex;align-items:baseline;justify-content:space-between;gap:14px;'+
    'flex-wrap:wrap;margin-bottom:8px}'+
  '.pv-nhl-h h3{font-family:var(--f-display);font-weight:700;font-size:clamp(26px,2.8vw,38px);'+
    'text-transform:uppercase;letter-spacing:.015em;color:#fff}'+
  '.pv-nhl-h span{font-family:var(--f-sharp);font-weight:300;font-size:12px;color:rgba(237,239,233,.6)}'+
  '.pv-nhl-cap{position:relative;font-family:var(--f-sharp);font-weight:300;font-size:13px;'+
    'color:rgba(237,239,233,.72);max-width:66ch;margin-bottom:clamp(16px,2.5vw,26px)}'+
  '#pv-nhl{position:relative}'+
  '.pv-nrow{display:grid;grid-template-columns:150px 170px 1fr 84px;align-items:center;gap:14px;'+
    'padding:9px 0;border-bottom:1px solid rgba(237,239,233,.08)}'+
  '.pv-nrow:last-child{border-bottom:0}'+
  '.pv-nrow .tm{display:flex;align-items:center;gap:10px;font-family:var(--f-sharp);font-weight:600;'+
    'font-size:13.5px;color:#fff}'+
  '.pv-nrow .rec{font-family:var(--f-sharp);font-weight:300;font-size:12px;color:rgba(237,239,233,.65);'+
    'font-variant-numeric:tabular-nums;white-space:nowrap}'+
  '.pv-nbar{height:10px;border-radius:999px;background:rgba(237,239,233,.10);overflow:hidden}'+
  '.pv-nbar i{display:block;height:100%;border-radius:999px;transform:scaleX(0);transform-origin:left;'+
    'transition:transform 1s cubic-bezier(.22,.8,.24,1)}'+
  '#pv-nhl.go .pv-nbar i{transform:scaleX(1)}'+
  '.pv-nrow .pts{text-align:right;font-family:var(--f-sharp);font-weight:700;font-size:16px;color:#fff;'+
    'font-variant-numeric:tabular-nums}'+
  '.pv-nrow .pts small{display:block;font-weight:300;font-size:9.5px;color:rgba(237,239,233,.55);letter-spacing:.05em}'+
  '.pv-proj{color:var(--chrome);font-weight:600}'+
  '@media(max-width:700px){.pv-nrow{grid-template-columns:104px 1fr 64px}.pv-nrow .rec{display:none}}'+
  '@media(prefers-reduced-motion:reduce){.pv-nbar i{transform:scaleX(1);transition:none}}'+

  /* ---- interactive charts: tooltip, guide, draw-in ---- */
  '#pv-tip{position:fixed;z-index:999;pointer-events:none;background:#101519;color:#F2F4F0;'+
    'font-family:var(--f-sharp);font-size:11.5px;font-weight:300;padding:7px 11px;border-radius:10px;'+
    'box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0;transition:opacity .15s;white-space:nowrap}'+
  '#pv-tip b{font-weight:600;color:#fff}'+
  '.pv-chart{position:relative;cursor:crosshair}'+
  '.pv-chart svg{width:100%;display:block}'+
  '.pv-chart .ln2{fill:none;stroke-width:2;stroke-linecap:round}'+
  '.pv-chart .ar2{opacity:.14}'+
  '.pv-chart .drw{stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.1s ease .15s}'+
  '.pv-chart.go .drw{stroke-dashoffset:0}'+
  '.pv-chart .gd{stroke:rgba(140,150,160,.4);stroke-width:1;stroke-dasharray:3 3;opacity:0}'+
  '.pv-chart .cur{opacity:0}'+
  '.pv-chart:hover .gd,.pv-chart:hover .cur{opacity:1}'+
  '@media(prefers-reduced-motion:reduce){.pv-chart .drw{stroke-dashoffset:0;transition:none}}'+

  /* ---- namesake rows expand into season trends ---- */
  '.pv-ng{border-bottom:1px solid rgba(237,239,233,.08)}'+
  '.pv-ng:last-child{border-bottom:0}'+
  'button.pv-nrow{width:100%;background:none;border:0;cursor:pointer;text-align:left;color:inherit;'+
    'font:inherit;border-bottom:0;transition:background .2s;border-radius:10px}'+
  'button.pv-nrow:hover{background:rgba(237,239,233,.05)}'+
  '.pv-nd{padding:2px 2px 16px}'+
  '.pv-nd .ndh{display:flex;justify-content:space-between;gap:10px;font-family:var(--f-sharp);'+
    'font-size:11.5px;font-weight:300;color:rgba(237,239,233,.6);margin:6px 0 8px}'+
  '.pv-nd .ndh b{font-weight:600;color:#fff}'+
  '.pv-l10{display:flex;gap:5px;margin-top:12px}'+
  '.pv-l10 i{flex:1;height:24px;border-radius:6px;background:rgba(200,60,50,.5)}'+
  '.pv-l10 i.W{background:var(--chrome)}'+
  '.pv-l10 i.OTL{background:rgba(237,239,233,.4)}'+

  /* ---- CGHL trend cards (player / team pages) ---- */
  '.pv-mt{display:inline-flex;gap:6px}'+
  '.pv-mt button{font-family:var(--f-sharp);font-size:11px;font-weight:600;padding:4px 12px;'+
    'border-radius:999px;border:1px solid var(--line-soft);background:transparent;color:var(--steel);cursor:pointer}'+
  '.pv-mt button.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}'+

  /* ---- stat-widget kit (dark cards, gauge, hatched bars, delta pills) ---- */
  '.pvw{background:#12161B;border-radius:22px;color:#EDEFE9;padding:20px 22px;position:relative;overflow:hidden}'+
  '.pvw::before{content:"";position:absolute;inset:0;pointer-events:none;background:'+
    'radial-gradient(460px 280px at 88% -12%,rgba(255,166,54,.15),transparent 60%),'+
    'radial-gradient(380px 260px at 4% 108%,rgba(255,92,44,.10),transparent 60%)}'+
  '.pvw>*{position:relative}'+
  '.pvw-h{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}'+
  '.pvw-ic{width:30px;height:30px;border-radius:10px;background:rgba(237,239,233,.08);display:grid;'+
    'place-items:center;color:var(--chrome)}'+
  '.pvw-ic svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round}'+
  '.pvw-h b{font-family:var(--f-sharp);font-weight:600;font-size:13.5px;color:#fff}'+
  '.pvw-h .sp{margin-left:auto}'+
  '.pvw-big{font-family:var(--f-sharp);font-weight:300;font-size:clamp(30px,2.8vw,40px);color:#fff;'+
    'font-variant-numeric:tabular-nums;line-height:1}'+
  '.pvw-sub{font-family:var(--f-sharp);font-weight:300;font-size:11px;color:rgba(237,239,233,.55)}'+
  '.pv-delta{display:inline-flex;align-items:center;gap:4px;font-family:var(--f-sharp);font-weight:600;'+
    'font-size:11px;border-radius:999px;padding:2px 9px;opacity:0;transform:translateY(4px);'+
    'transition:opacity .5s ease .9s,transform .5s ease .9s}'+
  '.go .pv-delta,.pv-anim.go .pv-delta,.in .pv-delta,.pvw .pv-delta{opacity:1;transform:none}'+
  '.pv-delta.up{color:#3BD98A;background:rgba(59,217,138,.13)}'+
  '.pv-delta.dn{color:#FF8A66;background:rgba(255,138,102,.13)}'+
  '.pv-gauge svg{width:100%;display:block}'+
  '.pv-gauge .trk{fill:none;stroke:rgba(237,239,233,.10);stroke-width:5;stroke-linecap:round}'+
  '.pv-gauge .vg{fill:none;stroke:url(#pvgg);stroke-width:5;stroke-linecap:round;'+
    'transition:stroke-dashoffset 1.25s cubic-bezier(.3,.8,.3,1) .2s}'+
  '.pv-gauge .gdot{opacity:0;transition:opacity .4s ease 1.25s;filter:drop-shadow(0 0 6px rgba(255,229,0,.85))}'+
  '.pv-gauge.go .vg,.pv-anim.go .pv-gauge .vg{stroke-dashoffset:0!important}'+
  '.pv-gauge.go .gdot,.pv-anim.go .pv-gauge .gdot{opacity:1}'+
  '.pv-hbars{display:flex;align-items:flex-end;gap:8px;height:76px}'+
  '.pv-hbars i{flex:1;border-radius:8px 8px 4px 4px;cursor:default;'+
    'background:repeating-linear-gradient(45deg,rgba(237,239,233,.24) 0 4px,rgba(237,239,233,.06) 4px 9px);'+
    'transform:scaleY(0);transform-origin:bottom;transition:transform .7s cubic-bezier(.34,1.45,.5,1)}'+
  '.pv-hbars i.cur{background:var(--chrome)}'+
  '.pv-anim.go .pv-hbars i{transform:scaleY(1)}'+
  '.pvw-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:end;margin-bottom:16px}'+
  '@media(max-width:640px){.pvw-grid{grid-template-columns:1fr}}'+
  /* compact variant: the widget as a sidebar feature card */
  '.pvw-mini{padding:16px 17px;border-radius:18px}'+
  '.pvw-mini .pvw-h{margin-bottom:10px;gap:8px}'+
  '.pvw-mini .pvw-ic{width:26px;height:26px;border-radius:9px}'+
  '.pvw-mini .pvw-ic svg{width:13px;height:13px}'+
  '.pvw-mini .pvw-h b{font-size:12.5px}'+
  '.pvw-mini .pv-mt{gap:4px}'+
  '.pvw-mini .pv-mt button{font-size:10px;padding:3px 9px}'+
  '.pvw-mini .pv-gauge{max-width:172px;margin:0 auto}'+
  '.pvw-mini .pvw-big{font-size:26px;margin-top:-22px!important}'+
  '.pvw-mini .pvw-sub{font-size:10px}'+
  '.pvw-mini .pv-hbars{height:38px;gap:5px}'+
  '.pvw-mini .pv-hbars i{border-radius:5px 5px 3px 3px}'+
  '.pvw-mini .pvm-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 6px}'+
  '.pvw-mini .pvm-row span.k{font-family:var(--f-sharp);font-weight:300;font-size:10.5px;color:rgba(237,239,233,.55)}'+
  '.pvw-mini .pvm-row b{font-family:var(--f-sharp);font-weight:600;font-size:12.5px;color:#fff}'+
  '.pvw-mini .caption{font-size:10.5px;margin-top:8px!important}'+
  '.pvw .pv-mt button{border-color:rgba(237,239,233,.22);color:rgba(237,239,233,.6)}'+
  '.pvw .pv-mt button.on{background:var(--chrome);color:#101519;border-color:var(--chrome)}'+
  '.pvw .caption{color:rgba(237,239,233,.5)}'+
  '@media(prefers-reduced-motion:reduce){.pv-gauge .vg{stroke-dashoffset:0!important;transition:none}'+
    '.pv-gauge .gdot{opacity:1;transition:none}.pv-hbars i{transform:scaleY(1);transition:none}'+
    '.pv-delta{opacity:1;transform:none;transition:none}}'+

  /* ---- dark mode, treated deliberately: warm depth instead of flat black ---- */
  'html[data-theme="dark"]{--paper:#14181D;--ice:#1B2127;--line:#2C343C;--line-soft:#242B32;--steel:#93A0AB}'+
  'html[data-theme="dark"] #pv-frame{background:#14181D;'+
    'box-shadow:0 36px 100px rgba(0,0,0,.72),0 0 0 1px rgba(255,190,80,.08)}'+
  'html[data-theme="dark"] #masthead .mh-nav{border:1px solid #242B32;border-bottom:0}'+
  'html[data-theme="dark"] .pv-crests a{opacity:.62}'+
  'html[data-theme="dark"] .pv-stage,html[data-theme="dark"] .pv-nhl-panel{background:#0E1319;'+
    'box-shadow:0 0 0 1px rgba(255,190,80,.06)}'+
  'html[data-theme="dark"] .pv-cta{background:var(--chrome);color:#101519}'+
  'html[data-theme="dark"] .pv-cta .dot{background:#101519;color:var(--chrome)}'+
  'html[data-theme="dark"] .pv-soft .quiet{color:#F2F4F0}'+

  /* ---- motion & dimension kit: 3D tilt, spring bubbles, flip-in crests, trophy ---- */
  '.pv-tilt{transform-style:preserve-3d;will-change:transform;transition:transform .35s cubic-bezier(.22,.8,.24,1);position:relative}'+
  '.pv-tilt.tilting{transition:transform .06s linear}'+
  '.pv-tilt .pv-glare{position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;'+
    'background:radial-gradient(420px 300px at var(--gx,50%) var(--gy,50%),rgba(255,255,255,.14),transparent 60%);'+
    'transition:opacity .3s ease;z-index:4}'+
  '.pv-tilt.tilting .pv-glare{opacity:1}'+
  /* spring pop for stat bubbles */
  '@keyframes pvPop{0%{transform:scale(.65);opacity:0}70%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}'+
  '.pv-kpi{border-radius:18px;background:#F6F8F5;padding:14px 16px;transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s ease}'+
  '.pv-kpi:hover{transform:translateY(-3px) scale(1.03);box-shadow:0 10px 24px rgba(16,21,25,.10)}'+
  '.in .pv-kpis .pv-kpi{animation:pvPop .55s cubic-bezier(.34,1.56,.64,1) both}'+
  '.in .pv-kpis .pv-kpi:nth-child(2){animation-delay:.08s}'+
  '.in .pv-kpis .pv-kpi:nth-child(3){animation-delay:.16s}'+
  '.in .pv-kpis .pv-kpi:nth-child(4){animation-delay:.24s}'+
  /* 3D crest treatment: staggered flip-in entrance, coin-spin on hover */
  '.pv-crests{perspective:900px}'+
  '.pv-crests a{opacity:0;transform:rotateY(70deg)}'+
  '@keyframes pvFlip{0%{opacity:0;transform:rotateY(70deg)}100%{opacity:1;transform:rotateY(0)}}'+
  '.in .pv-crests a{animation:pvFlip .7s cubic-bezier(.22,.8,.24,1) both}'+
  ['','',''].map(function(_,i){return '';}).join('')+
  '.in .pv-crests a:nth-child(2){animation-delay:.07s}.in .pv-crests a:nth-child(3){animation-delay:.14s}'+
  '.in .pv-crests a:nth-child(4){animation-delay:.21s}.in .pv-crests a:nth-child(5){animation-delay:.28s}'+
  '.in .pv-crests a:nth-child(6){animation-delay:.35s}.in .pv-crests a:nth-child(7){animation-delay:.42s}'+
  '.in .pv-crests a:nth-child(8){animation-delay:.49s}'+
  '.pv-crests a img,.pv-crests a svg{transition:transform .8s cubic-bezier(.22,.8,.24,1)}'+
  '.pv-crests a:hover img,.pv-crests a:hover svg{transform:rotateY(360deg)}'+
  /* every crest sitewide gets a gentle dimensional hover */
  '.crest{transition:transform .3s cubic-bezier(.34,1.56,.64,1)}'+
  'a:hover>.crest,[data-go]:hover .crest,.rowlink:hover .crest{transform:translateY(-1px) scale(1.12) rotate(-4deg)}'+
  /* shine sweep utility for cards and bars */
  '@keyframes pvSweep{0%{transform:translateX(-130%) skewX(-18deg)}100%{transform:translateX(240%) skewX(-18deg)}}'+
  '.pv-nrow:hover .pv-nbar i::after{content:"";position:absolute;inset:0;width:45%;'+
    'background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);'+
    'animation:pvSweep .9s ease}'+
  '.pv-nbar i{position:relative;overflow:hidden}'+
  /* ring gauge: full-circle percentile ring */
  '.pv-ring{position:relative;display:inline-grid;place-items:center}'+
  '.pv-ring svg{display:block;transform:rotate(-90deg)}'+
  '.pv-ring .rtrk{fill:none;stroke:#F0F2EE;stroke-width:7}'+
  '.pv-ring .rval{fill:none;stroke:url(#pvgg);stroke-width:7;stroke-linecap:round;'+
    'transition:stroke-dashoffset 1.2s cubic-bezier(.3,.8,.3,1) .25s}'+
  '.pv-ring.go .rval,.pv-anim.go .pv-ring .rval{stroke-dashoffset:0!important}'+
  '.pv-ring .rc{position:absolute;text-align:center}'+
  '.pv-ring .rc b{font-family:var(--f-sharp);font-weight:300;font-size:22px;color:#101519;display:block;line-height:1;font-variant-numeric:tabular-nums}'+
  '.pv-ring .rc span{font-family:var(--f-sharp);font-weight:600;font-size:8.5px;letter-spacing:.08em;color:#5C6B75;text-transform:uppercase}'+
  /* chart endpoint ripple */
  '@keyframes pvPing{0%{transform:scale(.4);opacity:.7}100%{transform:scale(2.4);opacity:0}}'+
  '.pv-chart .plz{transform-origin:center;transform-box:fill-box;opacity:0}'+
  '.pv-chart.go .plz{animation:pvPing 1.6s ease-out 1.3s 3}'+
  /* the trophy: vector, chrome, glinting, floating */
  '@keyframes pvFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}'+
  '@keyframes pvGlint{0%,55%{transform:translateX(-140%) skewX(-20deg)}85%,100%{transform:translateX(220%) skewX(-20deg)}}'+
  '.pv-trophy{position:relative;filter:drop-shadow(0 18px 30px rgba(0,0,0,.45))}'+
  '.pv-trophy.float{animation:pvFloat 5s ease-in-out infinite}'+
  '.pv-trophy .glint{overflow:hidden}'+
  '.pv-trophy .glint rect{animation:pvGlint 3.6s ease-in-out infinite}'+
  '.pv-awhero{position:relative;border-radius:26px;overflow:hidden;margin-bottom:22px;background:#12161B;'+
    'color:#EDEFE9;display:flex;align-items:center;gap:clamp(18px,4vw,54px);padding:clamp(22px,4vw,44px);flex-wrap:wrap}'+
  '.pv-awhero::before{content:"";position:absolute;inset:0;pointer-events:none;background:'+
    'radial-gradient(560px 360px at 82% 20%,rgba(255,196,64,.20),transparent 60%),'+
    'radial-gradient(420px 320px at 8% 100%,rgba(255,124,40,.12),transparent 60%)}'+
  '.pv-awhero>*{position:relative}'+
  '.pv-awhero h2{font-family:var(--f-display);font-weight:700;font-size:clamp(32px,4.4vw,58px);'+
    'text-transform:uppercase;letter-spacing:.015em;color:#fff;line-height:.95}'+
  '.pv-awhero p{font-family:var(--f-sharp);font-weight:300;font-size:14px;color:rgba(237,239,233,.8);margin-top:8px;max-width:50ch}'+
  '@media(prefers-reduced-motion:reduce){'+
    '.in .pv-kpis .pv-kpi,.in .pv-crests a{animation:none;opacity:1;transform:none}'+
    '.pv-crests a{opacity:1;transform:none}'+
    '.pv-trophy.float,.pv-trophy .glint rect,.pv-chart.go .plz{animation:none}'+
    '.pv-tilt{transition:none}'+
    '.pv-ring .rval{stroke-dashoffset:0!important;transition:none}}'+

  /* ---- gentle reveals + hover motion (off under reduced motion) ---- */
  '.pv-rv{opacity:0;transform:translateY(14px);transition:opacity .65s ease,transform .65s ease}'+
  '.pv-rv.in{opacity:1;transform:none}'+
  'a,button{transition:color .22s ease,border-color .22s ease,background .22s ease}'+
  '.card{transition:border-color .3s ease,transform .3s ease}'+
  '.card.raise:hover{transform:translateY(-2px);border-color:var(--line)}'+
  '@media(prefers-reduced-motion:reduce){.pv-rv{opacity:1;transform:none;transition:none}'+
    '.pv-ch .ln{stroke-dashoffset:0;transition:none}.pv-ch .ar{opacity:.16;transition:none}'+
    '.pv-ch .dotp{opacity:1;transition:none}.pv-prog i,.pv-bar i{transform:scaleX(1);transition:none}}'+

  /* ---- skin, site-wide: serif display, Sora UI, soft pills and cards ---- */
  '.h-page,.h-sec{font-family:var(--f-display);font-weight:700;text-transform:uppercase;letter-spacing:.015em}'+
  '.h-page{font-size:clamp(36px,4.6vw,58px);line-height:.98}'+
  '.h-sec{font-size:clamp(30px,3.2vw,44px);line-height:1}'+
  '.h-card,.card-h h3{font-family:var(--f-sharp);font-weight:700;text-transform:none;letter-spacing:-.01em;font-size:15px}'+
  '.eyebrow{font-family:var(--f-sharp);font-weight:600;letter-spacing:.15em;font-size:10px}'+
  '.lede,.caption{font-family:var(--f-sharp);font-weight:300}'+
  '.lede{font-size:15.5px;line-height:1.65}'+
  '.card{border-width:1px;border-color:var(--line-soft);border-radius:16px;overflow:hidden}'+
  '.card-h{border-bottom-color:var(--line-soft)}'+
  '.chip{font-family:var(--f-sharp);font-size:11px;font-weight:400;letter-spacing:0;text-transform:none;border-radius:999px}'+
  '.chip:not(.chip-chrome):not(.chip-live):not(.chip-ink){background:var(--ice);border-color:transparent}'+
  '.note{border-width:1px 1px 1px 4px;border-color:var(--line-soft);border-radius:14px}'+
  '.note.chr{border-left-color:var(--chrome)}'+
  '.btn{font-family:var(--f-sharp);font-weight:600;letter-spacing:0;border-radius:999px}'+
  '.tbl th{font-size:10px;letter-spacing:.1em;color:var(--steel)}'+
  '.statline>div b{font-family:var(--f-sharp);font-weight:700}'+

  /* ================= interior pages: the same language everywhere ================= */
  /* controls — one pill idiom for segmented views, filters, and form fields */
  '.seg{border:0;background:var(--ice);border-radius:999px;padding:3px;gap:2px;overflow:visible}'+
  '.seg button{border-right:0;border-radius:999px;padding:7px 15px;min-height:34px;'+
    'font-family:var(--f-sharp);font-weight:600;font-size:12.5px;letter-spacing:0;text-transform:none;color:var(--steel)}'+
  '.seg button:hover:not(.on){color:var(--ink)}'+
  '.seg button.on{background:var(--paper);color:var(--ink);box-shadow:0 1px 5px rgba(16,21,25,.10)}'+
  '.filters{gap:8px}'+
  '.filters select,.filters input[type=search],.filters input[type=text]{appearance:none;-webkit-appearance:none;'+
    'border:1px solid var(--line-soft);background:var(--ice);border-radius:999px;padding:0 16px;min-height:40px;'+
    'width:auto;font-family:var(--f-sharp);font-weight:600;font-size:13px;color:var(--ink)}'+
  'input,select,textarea{border-width:1px;border-color:var(--line);border-radius:12px;background:var(--ice);'+
    'font-family:var(--f-sharp);font-weight:400}'+
  'input:focus,select:focus,textarea:focus{border-color:var(--steel);background:var(--paper)}'+
  'label.fld>span,.fld>span{font-family:var(--f-sharp);font-weight:600;letter-spacing:.06em;text-transform:none;font-size:11.5px}'+
  '.btn-ghost{border-width:1px;border-color:var(--line);background:var(--paper)}'+
  '.btn-ghost:hover{border-color:var(--line);background:var(--ice)}'+
  '.btn-lg{padding:13px 24px;font-size:15px}'+

  /* surfaces — hairlines, softer corners, lift instead of snap */
  '.card.raise:hover{box-shadow:0 10px 28px rgba(16,21,25,.08)}'+
  '.card-h{padding:15px 18px}'+
  '.kpi{border-width:1px;border-color:var(--line-soft);border-radius:16px;padding:18px 20px}'+
  '.kpi:hover{border-color:var(--line);background:var(--ice)}'+
  '.kpi b{font-family:var(--f-sharp);font-weight:300;font-size:clamp(27px,2.3vw,33px);letter-spacing:-.01em;line-height:1.05}'+
  '.kpi span{font-family:var(--f-sharp);font-weight:600;font-size:10px;letter-spacing:.12em}'+
  '.gamecard{border-width:1px;border-color:var(--line-soft);border-radius:16px}'+
  '.gamecard:hover{border-color:var(--line);background:var(--ice);transform:translateY(-2px);box-shadow:0 8px 22px rgba(16,21,25,.07)}'+
  '.gamecard .gc-when b{font-family:var(--f-display);font-weight:700;font-size:17px;text-transform:uppercase;letter-spacing:.02em}'+
  '.gamecard .gc-when span{font-family:var(--f-sharp);font-weight:300}'+
  '.gamecard .gc-match{font-family:var(--f-sharp);font-weight:600;font-size:14px}'+
  '.newscard{border-width:1px;border-color:var(--line-soft);border-radius:18px}'+
  '.newscard:hover{transform:translateY(-3px);border-color:var(--line);box-shadow:0 14px 34px rgba(16,21,25,.10)}'+
  '.newscard h3{font-family:var(--f-sharp);font-weight:700;letter-spacing:-.015em}'+
  '.newscard .nc-meta{font-family:var(--f-sharp);font-weight:300;letter-spacing:0}'+
  '.starcard{border:0;background:var(--ice);border-radius:16px}'+
  /* the dashed-circle placeholder was the most dated idiom on the site */
  '.empty{padding:46px 24px}'+
  '.empty .e-art{width:52px;height:52px;border:0;border-radius:18px;background:var(--ice);color:var(--steel)}'+
  '.empty b{font-family:var(--f-display);font-weight:700;font-size:19px;text-transform:uppercase;letter-spacing:.015em}'+
  '.empty p{font-family:var(--f-sharp);font-weight:300;font-size:13.5px}'+
  '.codebox{border:0;background:#12161B;border-radius:18px;position:relative;overflow:hidden}'+
  '.codebox::before{content:"";position:absolute;inset:0;pointer-events:none;'+
    'background:radial-gradient(320px 200px at 82% -14%,rgba(255,166,54,.16),transparent 60%)}'+
  '.codebox>*{position:relative}'+
  '.mx-hero{border-radius:26px;position:relative;overflow:hidden}'+
  '.mx-hero::before{content:"";position:absolute;inset:0;pointer-events:none;'+
    'background:radial-gradient(620px 380px at 84% -10%,rgba(255,166,54,.18),transparent 60%)}'+
  '.mx-hero>*{position:relative}'+

  /* tables — lighter rules, banded head, readable rank + points */
  '.tbl th{border-bottom-width:1px;border-bottom-color:var(--line);background:var(--ice);'+
    'font-family:var(--f-sharp);font-weight:600;padding-top:11px;padding-bottom:11px}'+
  '.tbl td{border-bottom-color:var(--line-soft);font-family:var(--f-sharp);font-weight:400}'+
  '.tbl .rankn{font-family:var(--f-sharp);font-weight:600;color:var(--steel)}'+
  '.tbl td.pts{font-family:var(--f-sharp);font-weight:700;font-size:15px;color:var(--ink)}'+
  '.tbl .nm{font-family:var(--f-sharp);font-weight:600}'+
  '.tbl caption{font-family:var(--f-sharp);font-weight:600;letter-spacing:.02em;text-transform:none}'+

  /* micro-components — form strip, ranked rows, ratings, side nav */
  '.form5{display:inline-flex;gap:3px;align-items:flex-end;height:18px}'+
  '.form5 i{width:6px;height:6px;border:0;border-radius:3px;background:var(--line)}'+
  '.form5 i.fd-w{height:18px;background:var(--chrome)}'+
  '.form5 i.fd-otl{height:11px;background:var(--steel)}'+
  '.form5 i.fd-l{height:6px;background:var(--line)}'+
  '.leaderrow{border-radius:14px}'+
  '.leaderrow .rk{width:26px;height:26px;border-radius:50%;background:var(--ice);display:grid;place-items:center;'+
    'font-family:var(--f-sharp);font-weight:600;font-size:12px;color:var(--steel)}'+
  '.leaderrow.top .rk{background:var(--chrome);color:#101519}'+
  '.leaderrow .val b{font-family:var(--f-sharp);font-weight:300;font-size:24px;letter-spacing:-.01em;line-height:1}'+
  '.leaderrow .val span{font-family:var(--f-sharp);font-weight:600;font-size:9.5px;letter-spacing:.1em}'+
  '.ovrbox{border-radius:10px;font-family:var(--f-sharp);font-weight:600;font-size:14px}'+
  '.statline b{font-family:var(--f-sharp);font-weight:300;font-size:26px;letter-spacing:-.01em}'+
  '.statline span{font-family:var(--f-sharp);font-weight:600;font-size:9.5px;letter-spacing:.12em}'+
  '.hub-side a{border-radius:999px;padding:9px 14px;font-family:var(--f-sharp);font-weight:600}'+
  '.hub-side a.on{background:var(--ink);color:var(--paper)}'+
  '.hub-side .hs-group{font-family:var(--f-sharp);font-weight:600;letter-spacing:.14em}'+
  '.sec-link{font-family:var(--f-sharp);font-weight:600;border-bottom-width:2px}'+
  '.tabs button{font-family:var(--f-sharp);font-weight:600;font-size:13.5px}'+
  '.rbar .rb-fill{background:linear-gradient(90deg,#3BD98A,var(--chrome))}'+

  /* points bar under the standings PTS cell (filled by the route override) */
  '.tbl td.pts{position:relative;padding-bottom:15px}'+
  '.pv-ptsbar{position:absolute;left:7px;right:9px;bottom:6px;height:3px;border-radius:999px;background:var(--line-soft)}'+
  '.pv-ptsbar::after{content:"";display:block;height:100%;width:calc(var(--p)*100%);border-radius:999px;'+
    'background:var(--chrome);transform:scaleX(0);transform-origin:left;transition:transform .9s cubic-bezier(.22,.8,.24,1)}'+
  '.in .pv-ptsbar::after,.pv-ptsbar.go::after{transform:scaleX(1)}'+
  '.tbl .pv-delta,.leaderrow .pv-delta{opacity:1;transform:none}'+
  '@media(prefers-reduced-motion:reduce){.pv-ptsbar::after{transform:scaleX(1);transition:none}}';
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---- ribbon + the floating canvas frame ---- */
  function ensureAura(){
    if (document.getElementById("pv-aura")) return;
    var a = document.createElement("div");
    a.id = "pv-aura"; a.setAttribute("aria-hidden","true");
    document.body.insertBefore(a, document.body.firstChild);
  }
  function ensureRibbon(){
    if (document.getElementById("pv-ribbon")) return;
    var r = document.createElement("div");
    r.id = "pv-ribbon";
    r.textContent = "Preview build · the real site is unchanged";
    document.body.insertBefore(r, document.body.firstChild);
  }
  function ensureFrame(){
    if (document.getElementById("pv-frame")) return;
    var mast = document.getElementById("masthead");
    if (!mast || !mast.parentNode) return;
    var f = document.createElement("div"); f.id = "pv-frame";
    mast.parentNode.insertBefore(f, mast.nextSibling);
    ["ticker","app","sitefoot"].forEach(function(id){
      var el = document.getElementById(id); if (el) f.appendChild(el);
    });
  }

  /* ---- reveals + animated numbers ---- */
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function runCounters(root){
    root.querySelectorAll("[data-count]").forEach(function(el){
      if (el.getAttribute("data-done")) return;
      el.setAttribute("data-done","1");
      var end = parseFloat(el.getAttribute("data-count")) || 0;
      var pre = el.getAttribute("data-pre") || "", post = el.getAttribute("data-post") || "";
      if (reduce){ el.textContent = pre + end + post; return; }
      var t0 = null, D = 950;
      function tick(ts){
        if (!t0) t0 = ts;
        var p = Math.min(1, (ts - t0) / D); p = 1 - Math.pow(1 - p, 3);
        el.textContent = pre + Math.round(end * p) + post;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function(es){
    es.forEach(function(e){
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      runCounters(e.target);
      chartGo(e.target);
      io.unobserve(e.target);
    });
  }, { rootMargin: "0px 0px -8% 0px" }) : null;
  function attachReveals(){
    if (!io){ document.querySelectorAll("[data-count]").forEach(function(el){ runCounters(el.parentNode||el); }); return; }
    document.querySelectorAll("#app .sec, #app .sec-tight, #app .sec-dark, #app .pvw, .pv-soft > *")
      .forEach(function(el, i){
        if (el.classList.contains("pv-rv")) return;
        el.classList.add("pv-rv");
        el.style.transitionDelay = Math.min(i * 45, 220) + "ms";
        io.observe(el);
        /* if the observer never reports (a broken or paused compositor), nothing should stay
           hidden — reveal and animate it anyway shortly after. */
        setTimeout(function(){
          if (el.classList.contains("in")) return;
          el.classList.add("in"); runCounters(el); chartGo(el);
        }, 2500);
      });
  }
  var app = document.getElementById("app");
  if (app && "MutationObserver" in window){
    new MutationObserver(function(){ pvSchedule(function(){ attachReveals(); fillNhl(); }); })
      .observe(app, { childList: true });
  }

  var _renderChrome = CG.renderChrome;
  CG.renderChrome = function(){
    _renderChrome.apply(this, arguments);
    try {
      ensureAura();
      ensureRibbon();
      ensureFrame();
      var saved = null;
      try { saved = (JSON.parse(localStorage.getItem("cgproto:v1")||"{}").prefs||{}).theme; } catch(e){}
      if (!saved || saved === "auto") document.documentElement.setAttribute("data-theme","light");
    } catch(e){ /* fail safe */ }
  };

  /* ---- the dashboard: real registrations, real dates, nothing invented ---- */
  function seasonRegs(){
    var sid = (CG.SEASON && CG.SEASON.id) || null;
    return ((CG.lg && CG.lg._registrationsRaw) || []).filter(function(r){
      return (!r.season_id || r.season_id === sid) && String(r.status||"") !== "declined";
    });
  }
  function posMix(regs){
    var f = 0, d = 0, g = 0;
    regs.forEach(function(r){
      var p = String(r.position||"").toUpperCase();
      if (p.indexOf("G") === 0) g++;
      else if (p === "D" || p === "LD" || p === "RD" || p.indexOf("DEF") === 0) d++;
      else f++;
    });
    return { F:f, D:d, G:g };
  }
  function signupChart(regs){
    var days = {};
    regs.forEach(function(r){
      if (!r.created_at) return;
      days[String(r.created_at).slice(0,10)] = (days[String(r.created_at).slice(0,10)]||0) + 1;
    });
    var keys = Object.keys(days).sort();
    if (keys.length < 2 || regs.length < 4) return null;   /* too little curve to be honest */
    var pts = [], total = 0;
    keys.forEach(function(k){ total += days[k]; pts.push(total); });
    var W = 480, H = 100, n = pts.length, max = pts[n-1];
    var xy = pts.map(function(v,i){
      return [ (i/(n-1))*W, H - 6 - (v/max)*(H-16) ];
    });
    var line = xy.map(function(p,i){ return (i?"L":"M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var area = line + " L" + W + " " + H + " L0 " + H + " Z";
    var last = xy[n-1];
    return '<div class="pv-ch"><h4>Sign-ups since registration opened</h4>'+
      '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true">'+
      '<path class="ar" d="'+area+'"/>'+
      '<path class="ln" pathLength="1" d="'+line+'"/>'+
      '<circle class="dotp" cx="'+last[0].toFixed(1)+'" cy="'+last[1].toFixed(1)+'" r="3.5"/></svg></div>';
  }
  function progressBlock(){
    /* honest fallback: how far the off-season has run, first sign-up → puck drop */
    var s = CG.SEASON || {};
    var start = s.starts_at ? Date.parse(s.starts_at) : null;
    var regs = seasonRegs().map(function(r){ return r.created_at ? Date.parse(r.created_at) : null; })
      .filter(Boolean).sort(function(a,b){ return a-b; });
    if (!start || !regs.length || CG.now() >= start) return "";
    var pct = Math.max(2, Math.min(100, Math.round(100 * (CG.now() - regs[0]) / (start - regs[0]))));
    return '<div class="pv-ch"><h4>Road to puck drop · '+pct+'% of the off-season gone</h4>'+
      '<div class="pv-prog"><i style="width:'+pct+'%"></i></div></div>';
  }
  function upNextBlock(){
    var lg = CG.lg || {}, rows = [];
    var upcoming = (lg.schedule||[]).filter(function(g){ return g.at > CG.now(); })
      .sort(function(a,b){ return a.at-b.at; }).slice(0, 3);
    if (upcoming.length){
      rows = upcoming.map(function(g){
        return '<a class="pv-unr" href="#/matchup/'+g.id+'"><span class="d"></span>'+
          '<b>'+CG.crest(g.away,18)+esc(g.away)+' @ '+CG.crest(g.home,18)+esc(g.home)+'</b>'+
          '<time>'+esc(CG.fmtDay(g.at))+' \u00b7 '+esc(CG.fmtTime(g.at))+'</time></a>';
      });
    } else {
      var sn = CG.SEASON || {};
      var regOpen = !!(sn.registration_open && sn.status !== "active");
      rows = [["Pre-season opens", sn.preseason_starts_at], ["Draft night", sn.draft_at],
              ["Free agency opens", sn.free_agency_opens_at], ["Puck drop", sn.starts_at],
              ["Playoffs", sn.playoffs_start_at]]
        .concat(regOpen ? [] : [["Sign-up deadline", sn.registration_deadline]])
        .filter(function(m){ return m[1] && Date.parse(m[1]) > CG.now(); })
        .sort(function(a,b){ return Date.parse(a[1]) - Date.parse(b[1]); }).slice(0, 3)
        .map(function(m){
          return '<div class="pv-unr"><span class="d"></span><b>'+esc(m[0])+'</b>'+
            '<time>'+esc(CG.fmtDay(Date.parse(m[1])))+'</time></div>';
        });
    }
    if (!rows.length) return "";
    return '<div class="pv-un"><h4>Up next</h4>'+rows.join("")+'</div>';
  }
  function dashHtml(){
    var s = CG.SEASON || {};
    var regs = seasonRegs();
    var mix = posMix(regs);
    var days = CG.daysToStart && CG.daysToStart();
    var kpis = [];
    kpis.push(['<b data-count="'+regs.length+'">0</b>', "players signed"]);
    if (days != null) kpis.push(['<b data-count="'+days+'">0</b>', "days to puck drop"]);
    kpis.push(['<b data-count="'+CG.TEAMS.length+'">0</b>', "clubs · "+esc((CG.DIVISIONS||[1,2]).length)+" divisions"]);
    if (CG.CAP) kpis.push(['<b data-count="'+(CG.CAP/1e6)+'" data-pre="$" data-post="M">$0M</b>', "salary cap"]);
    var chart = signupChart(regs) || progressBlock();
    var maxP = Math.max(mix.F, mix.D, mix.G, 1);
    var pos = regs.length ? '<div class="pv-pos">'+[["Forwards",mix.F],["Defense",mix.D],["Goalies",mix.G]].map(function(p){
        return '<div class="p"><em>'+p[0]+'<b>'+p[1]+'</b></em>'+
          '<div class="pv-bar"><i style="width:'+Math.round(100*p[1]/maxP)+'%"></i></div></div>';
      }).join("")+'</div>' : "";
    return '<div class="pv-dash"><div class="dh"><b>League pulse</b><span>'+esc((CG.seasonTag&&CG.seasonTag())||"Season 1")+' · live from the database</span></div>'+
      '<div class="pv-kpis">'+kpis.slice(0,4).map(function(k){
        return '<div class="pv-kpi">'+k[0]+'<span>'+k[1]+'</span></div>';
      }).join("")+'</div>'+chart+pos+upNextBlock()+'</div>';
  }
  function stageHtml(){
    return '<section class="sec" style="padding-top:0;padding-bottom:clamp(28px,4vw,52px)"><div class="shell">'+
      '<div class="pv-stage"><div class="pv-stage-grid">'+
        '<div>'+dashHtml()+'</div>'+
        '<div><p class="cap">Every game writes itself into the record. Box scores import straight from EA within '+
          'minutes of the final horn — standings, player stats, and salaries update on their own.</p>'+
          '<a class="cap-link" href="#/stats">Explore the numbers</a>'+
          '<div class="pv-scroll"><span class="o">↓</span>The season, below</div></div>'+
      '</div></div>'+
    '</div></section>';
  }

  /* ---- interactive chart engine: registry + shared tooltip + hover guides ---- */
  var pvCharts = {}, pvCid = 0;
  function ensureTip(){
    var t = document.getElementById("pv-tip");
    if (!t){ t = document.createElement("div"); t.id = "pv-tip"; document.body.appendChild(t); }
    return t;
  }
  function pvLine(points, opts){
    if (!points || points.length < 2) return "";
    var W = 480, H = (opts && opts.h) || 120, pad = 6;
    var vs = points.map(function(p){ return p.v; });
    var max = Math.max.apply(null, vs), min = Math.min.apply(null, vs);
    if (max === min) max = min + 1;
    var xy = points.map(function(p, i){
      return [ pad + (i/(points.length-1))*(W-2*pad), H - 8 - ((p.v-min)/(max-min))*(H-22) ];
    });
    var line = xy.map(function(p,i){ return (i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1); }).join(" ");
    var area = line + " L"+(W-pad)+" "+H+" L"+pad+" "+H+" Z";
    var id = "c" + (++pvCid);
    pvCharts[id] = { xy: xy, labels: points.map(function(p){ return p.label; }), W: W, H: H };
    var color = (opts && opts.color) || "#D9A800";
    return '<div class="pv-chart" data-pvchart="'+id+'">'+
      '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true">'+
      '<path class="ar2" d="'+area+'" fill="'+color+'"/>'+
      '<path class="ln2 drw" pathLength="1" d="'+line+'" stroke="'+color+'"/>'+
      '<line class="gd" x1="-9" x2="-9" y1="6" y2="'+(H-6)+'"/>'+
      '<circle class="plz" cx="'+xy[xy.length-1][0].toFixed(1)+'" cy="'+xy[xy.length-1][1].toFixed(1)+'" r="5" fill="none" stroke="'+color+'" stroke-width="1.5"/>'+
      '<circle class="cur" r="3.5" fill="'+color+'" cx="-9" cy="-9"/></svg></div>';
  }
  /* rAF gives the browser a frame to paint start styles so transitions run; the timeout is the
     safety net for contexts where rAF is paused (background tabs, embedded webviews) — without it
     the reveal system never runs and faded-in content would stay invisible. Both paths are safe
     to run: every step below is idempotent. */
  function pvSchedule(fn){
    requestAnimationFrame(function(){ requestAnimationFrame(fn); });
    setTimeout(fn, 140);
  }
  function chartGo(root){
    var run = function(){
      (root || document).querySelectorAll(".pv-chart:not(.go), .pv-anim:not(.go)")
        .forEach(function(c){ c.classList.add("go"); });
    };
    /* the double rAF lets the start styles paint so the transition actually runs. The timeout is
       the safety net: where rAF is paused (background tabs, embedded webviews) the widgets would
       otherwise stay frozen at zero height instead of simply skipping the animation. */
    pvSchedule(run);
  }
  document.addEventListener("mousemove", function(ev){
    var tip = ensureTip();
    var el = ev.target && ev.target.closest && ev.target.closest("[data-pvchart]");
    if (!el){
      var d = ev.target && ev.target.closest && ev.target.closest("[data-tip]");
      if (d){
        tip.innerHTML = d.getAttribute("data-tip");
        tip.style.opacity = 1;
        tip.style.left = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
        tip.style.top = (ev.clientY - 34) + "px";
        return;
      }
      tip.style.opacity = 0; return;
    }
    var c = pvCharts[el.getAttribute("data-pvchart")]; if (!c) return;
    var r = el.getBoundingClientRect();
    var fx = (ev.clientX - r.left) / r.width * c.W;
    var best = 0, bd = 1e9;
    for (var i = 0; i < c.xy.length; i++){ var d2 = Math.abs(c.xy[i][0] - fx); if (d2 < bd){ bd = d2; best = i; } }
    var gd = el.querySelector(".gd"), cur = el.querySelector(".cur");
    if (gd){ gd.setAttribute("x1", c.xy[best][0]); gd.setAttribute("x2", c.xy[best][0]); }
    if (cur){ cur.setAttribute("cx", c.xy[best][0]); cur.setAttribute("cy", c.xy[best][1]); }
    tip.innerHTML = c.labels[best];
    tip.style.opacity = 1;
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = (ev.clientY - 34) + "px";
  });

  /* ---- namesake rows expand: the franchise's real season, drawn ---- */
  var nhlSeason = "20252026", nhlClubCache = {};
  document.addEventListener("click", function(ev){
    var b = ev.target && ev.target.closest && ev.target.closest("[data-ns]");
    if (!b) return;
    var code = b.getAttribute("data-ns");
    var nd = b.parentNode.querySelector(".pv-nd");
    if (!nd) return;
    if (nd.getAttribute("data-filled")){
      nd.hidden = !nd.hidden;
      b.setAttribute("aria-expanded", String(!nd.hidden));
      if (!nd.hidden) chartGo(nd);
      return;
    }
    nd.hidden = false;
    b.setAttribute("aria-expanded","true");
    nd.innerHTML = '<p style="font-family:var(--f-sharp);font-weight:300;font-size:12px;color:rgba(237,239,233,.5);padding:8px 0">Drawing the season\u2026</p>';
    fetch("/.netlify/functions/nhl-stats?club="+encodeURIComponent(code)+"&season="+nhlSeason)
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (!j || !j.games || j.games.length < 2){
          nd.innerHTML = '<p style="font-family:var(--f-sharp);font-weight:300;font-size:12px;color:rgba(237,239,233,.5);padding:8px 0">Couldn\u2019t load the season right now.</p>';
          return;
        }
        nhlClubCache[code] = j;
        var team = (CG.TEAMS||[]).find(function(x){ return x.code === code; });
        var color = (team && team.color) || "#FFE500";
        var pts = j.games.map(function(g, i){
          return { v: g.pts, label: "<b>Game "+(i+1)+"</b> \u00b7 vs "+g.opp+" \u00b7 <b>"+g.r+" "+g.gf+"\u2013"+g.ga+"</b> \u00b7 "+g.pts+" pts" };
        });
        var l10g = j.games.slice(-10);
        var totPts = j.games[j.games.length-1].pts;
        nd.innerHTML = '<div class="pvw-grid" style="margin-top:10px">'+
          '<div>'+pvGauge(totPts/(j.games.length*2), String(totPts), 'of '+(j.games.length*2)+' possible points')+'</div>'+
          '<div>'+pvHBars(
            l10g.map(function(g){ return g.pts0!==undefined?g.pts0:(g.r==="W"?2:(g.r==="OTL"?1:0)); }),
            l10g.map(function(g){ return "vs "+g.opp+" \u00b7 <b>"+g.r+" "+g.gf+"\u2013"+g.ga+"</b>"; }),
            l10g.filter(function(g){ return g.r==="W"; }).length+' <span style="font-size:14px;font-weight:300;color:rgba(237,239,233,.55)">wins in the last 10</span>',
            'points earned, last ten games')+'</div></div>'+
          '<div class="ndh"><span>Cumulative points \u00b7 hover the line</span><b>'+j.games.length+' games</b></div>'+
          pvLine(pts, { color: color, h: 110 });
        nd.setAttribute("data-filled","1");
        chartGo(nd);
      })
      .catch(function(){
        nd.innerHTML = '<p style="font-family:var(--f-sharp);font-weight:300;font-size:12px;color:rgba(237,239,233,.5);padding:8px 0">Couldn\u2019t reach the NHL API.</p>';
      });
  });

  /* ---- widget helpers: arc gauge, hatched bars, delta pills ---- */
  var ICW = {
    gauge: '<svg viewBox="0 0 16 16"><path d="M2.5 12a5.5 5.5 0 1 1 11 0"/><path d="M8 12l2.6-4"/></svg>',
    bars: '<svg viewBox="0 0 16 16"><path d="M3 13V9M8 13V5M13 13V7"/></svg>'
  };
  function pvGauge(pct, bigHtml, sub){
    pct = Math.max(0.02, Math.min(1, pct));
    var cx=100, cy=88, r=76;
    var phi = Math.PI * (1 - pct);
    var ex = cx + r*Math.cos(phi), ey = cy - r*Math.sin(phi);
    return '<div class="pv-gauge pv-anim"><svg viewBox="0 0 200 96" aria-hidden="true">'+
      '<defs><linearGradient id="pvgg" x1="0" y1="0" x2="1" y2="0">'+
      '<stop offset="0" stop-color="#3BD98A"/><stop offset="1" stop-color="#FFE500"/></linearGradient></defs>'+
      '<path class="trk" d="M'+(cx-r)+' '+cy+' A'+r+' '+r+' 0 0 1 '+(cx+r)+' '+cy+'"/>'+
      '<path class="vg" pathLength="1" stroke-dasharray="'+pct.toFixed(3)+' 1" stroke-dashoffset="'+pct.toFixed(3)+'" '+
        'd="M'+(cx-r)+' '+cy+' A'+r+' '+r+' 0 0 1 '+(cx+r)+' '+cy+'"/>'+
      '<circle class="gdot" cx="'+ex.toFixed(1)+'" cy="'+ey.toFixed(1)+'" r="4" fill="#fff"/></svg>'+
      '<div class="pvw-big" style="text-align:center;margin-top:-30px">'+bigHtml+'</div>'+
      '<div class="pvw-sub" style="text-align:center;margin-top:3px">'+sub+'</div></div>';
  }
  function pvHBars(vals, tips, bigHtml, sub){
    var max = Math.max.apply(null, vals.concat([1]));
    var bars = vals.map(function(v, i){
      return '<i class="'+(i===vals.length-1?'cur':'')+'" style="height:'+Math.max(8, Math.round(100*v/max))+'%;'+
        'transition-delay:'+(i*70)+'ms"'+(tips && tips[i] ? ' data-tip="'+tips[i]+'"' : '')+'></i>';
    }).join("");
    return '<div class="pv-anim"><div class="pv-hbars">'+bars+'</div>'+
      (bigHtml?'<div class="pvw-big" style="margin-top:10px">'+bigHtml+'</div>':'')+
      (sub?'<div class="pvw-sub" style="margin-top:3px">'+sub+'</div>':'')+'</div>';
  }
  function pvDelta(diff, label){
    if (diff === 0) return '<span class="pv-delta up">= '+label+'</span>';
    return '<span class="pv-delta '+(diff>0?'up':'dn')+'">'+(diff>0?'\u2191 +':'\u2193 ')+diff+' '+label+'</span>';
  }

  /* ---- 3D tilt: one delegated pointer engine for .pv-tilt targets ---- */
  var tiltEl = null;
  var TILT_SEL = ".pvw, .pv-dash, [data-go^=\"#/team/\"].card";
  function tiltTargets(node){
    var t = node && node.closest && node.closest(TILT_SEL);
    return (t && !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) ? t : null;
  }
  document.addEventListener("pointermove", function(ev){
    var t = tiltTargets(ev.target);
    if (tiltEl && tiltEl !== t){
      tiltEl.classList.remove("tilting"); tiltEl.style.transform = "";
      tiltEl = null;
    }
    if (!t) return;
    if (!t.classList.contains("pv-tilt")){
      t.classList.add("pv-tilt");
      if (!t.querySelector(".pv-glare")){
        var g = document.createElement("i"); g.className = "pv-glare"; t.appendChild(g);
      }
    }
    tiltEl = t;
    var r = t.getBoundingClientRect();
    var px = (ev.clientX - r.left) / r.width, py = (ev.clientY - r.top) / r.height;
    t.classList.add("tilting");
    t.style.transform = "perspective(850px) rotateX(" + ((py - .5) * -7).toFixed(2) + "deg) rotateY(" + ((px - .5) * 9).toFixed(2) + "deg)";
    t.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
    t.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
  });
  document.addEventListener("pointerleave", function(){
    if (tiltEl){ tiltEl.classList.remove("tilting"); tiltEl.style.transform = ""; tiltEl = null; }
  }, true);

  /* ---- ring gauge: full-circle stat bubble ---- */
  function pvRing(pct, valHtml, label, size){
    pct = Math.max(0.02, Math.min(1, pct));
    var S = size || 96, r = (S - 10) / 2, C = S / 2;
    return '<div class="pv-ring pv-anim" style="width:'+S+'px;height:'+S+'px">'+
      '<svg width="'+S+'" height="'+S+'" viewBox="0 0 '+S+' '+S+'" aria-hidden="true">'+
      '<defs><linearGradient id="pvgg" x1="0" y1="0" x2="1" y2="0">'+
      '<stop offset="0" stop-color="#3BD98A"/><stop offset="1" stop-color="#FFE500"/></linearGradient></defs>'+
      '<circle class="rtrk" cx="'+C+'" cy="'+C+'" r="'+r+'"/>'+
      '<circle class="rval" cx="'+C+'" cy="'+C+'" r="'+r+'" pathLength="1" '+
        'stroke-dasharray="'+pct.toFixed(3)+' 1" stroke-dashoffset="'+pct.toFixed(3)+'"/></svg>'+
      '<span class="rc"><b>'+valHtml+'</b><span>'+label+'</span></span></div>';
  }

  /* ---- the trophy: brand-drawn vector with glint + float ---- */
  function pvTrophy(size){
    var S = size || 150;
    return '<svg class="pv-trophy float" width="'+S+'" height="'+Math.round(S*1.15)+'" viewBox="0 0 100 115" aria-hidden="true">'+
      '<defs><linearGradient id="pvtg" x1="0" y1="0" x2="1" y2="1">'+
        '<stop offset="0" stop-color="#FFF3B0"/><stop offset=".45" stop-color="#FFE500"/>'+
        '<stop offset=".75" stop-color="#D9A800"/><stop offset="1" stop-color="#A87F00"/></linearGradient>'+
      '<clipPath id="pvtc"><path d="M30 12h40v18c0 16-8 26-20 26S30 46 30 30z"/></clipPath></defs>'+
      '<path d="M30 12h40v18c0 16-8 26-20 26S30 46 30 30z" fill="url(#pvtg)"/>'+
      '<path d="M30 16H16c0 16 6 24 16 26" fill="none" stroke="url(#pvtg)" stroke-width="6" stroke-linecap="round"/>'+
      '<path d="M70 16h14c0 16-6 24-16 26" fill="none" stroke="url(#pvtg)" stroke-width="6" stroke-linecap="round"/>'+
      '<path d="M46 56h8l3 16h-14z" fill="url(#pvtg)"/>'+
      '<rect x="34" y="74" width="32" height="8" rx="2" fill="url(#pvtg)"/>'+
      '<rect x="28" y="84" width="44" height="12" rx="2.5" fill="#1A2127"/>'+
      '<rect x="28" y="98" width="44" height="5" rx="2" fill="url(#pvtg)"/>'+
      '<g class="glint" clip-path="url(#pvtc)"><rect x="20" y="6" width="14" height="56" fill="rgba(255,255,255,.55)"/></g>'+
      '<circle cx="50" cy="34" r="9" fill="rgba(16,21,25,.22)"/></svg>';
  }

  /* ---- CGHL trend cards: self-activating once EA box scores exist ---- */
  function playerGames(pid){
    return ((CG.lg && CG.lg.allResults) || []).slice().sort(function(a,b){ return a.at-b.at; })
      .map(function(r){
        var line = (r.box && ((r.box[r.home]||{})[pid] || (r.box[r.away]||{})[pid]));
        if (!line || line.goalie) return null;
        var team = (r.box[r.home]||{})[pid] ? r.home : r.away;
        return { at: r.at, opp: team===r.home ? r.away : r.home, g: line.g||0, a: line.a||0, p: (line.g||0)+(line.a||0) };
      }).filter(Boolean);
  }
  var SAMPLE_GAMES = [
    {opp:"TOR",g:1,a:0},{opp:"CHI",g:0,a:1},{opp:"PIT",g:2,a:1},{opp:"WPG",g:0,a:0},
    {opp:"ANA",g:1,a:2},{opp:"COL",g:0,a:1},{opp:"DAL",g:1,a:0},{opp:"BOS",g:2,a:2},
    {opp:"TOR",g:0,a:1},{opp:"CHI",g:1,a:1}
  ].map(function(g){ g.p = g.g + g.a; return g; });
  function trendChartHtml(games, metric, sample, h){
    var run = 0;
    var pts = games.map(function(gm, i){
      run += gm[metric];
      var name = metric==="p"?"pts":metric==="g"?"G":"A";
      return { v: run, label: "<b>"+(sample?"Sample game ":"Game ")+(i+1)+"</b> \u00b7 vs "+esc(gm.opp)+" \u00b7 +"+gm[metric]+" \u00b7 <b>"+run+" "+name+"</b>" };
    });
    return pvLine(pts, { color: "#D9A800", h: h || 130 });
  }
  function renderPlayerTrend(games, metric, sample){
    var name = metric==="p"?"points":metric==="g"?"goals":"assists";
    var short = metric==="p"?"pts":metric==="g"?"G":"A";
    var tot = games.reduce(function(a,g){ return a+g[metric]; }, 0);
    var per = tot / games.length;
    var last5 = games.slice(-5);
    var lastG = games[games.length-1], prevG = games[games.length-2];
    return pvGauge(Math.min(1, per/3), per.toFixed(1), short+' per game')+
      '<div class="pvm-row"><span class="k">Last five</span>'+
        (prevG ? pvDelta(lastG[metric]-prevG[metric], 'last game') : '')+'</div>'+
      pvHBars(last5.map(function(g){ return g[metric]; }),
        last5.map(function(g){ return "<b>"+(sample?"Sample game":"Game")+"</b> vs "+esc(g.opp)+" \u00b7 <b>+"+g[metric]+"</b>"; }))+
      '<div class="pvm-row"><span class="k">Season curve</span><b>'+tot+' '+short+'</b></div>'+
      trendChartHtml(games, metric, sample, 62);
  }
  function playerTrendCard(pid){
    var games = playerGames(pid), sample = false;
    if (games.length < 2){ games = SAMPLE_GAMES; sample = true; }
    return '<div class="pvw pvw-mini"><div class="pvw-h">'+
      '<span class="pvw-ic">'+ICW.gauge+'</span><b>Trends</b>'+
      (sample?'<span class="chip chip-chrome" style="font-size:9.5px;padding:2px 7px">Sample</span>':'')+
      '<span class="sp pv-mt" data-pv-owner="'+(sample?"sample":esc(String(pid)))+'">'+
      [["p","P"],["g","G"],["a","A"]].map(function(m,i){
        return '<button type="button" data-pvmt="'+m[0]+'"'+(i===0?' class="on"':'')+'>'+m[1]+'</button>';
      }).join("")+'</span></div>'+
      '<div id="pv-ptrend">'+renderPlayerTrend(games, "p", sample)+'</div>'+
      '<p class="caption">'+(sample
        ? 'Sample \u2014 switches to real box scores once the season starts.'
        : 'Season to date, game by game.')+'</p></div>';
  }
  document.addEventListener("click", function(ev){
    var b = ev.target && ev.target.closest && ev.target.closest("[data-pvmt]");
    if (!b) return;
    var wrap = b.closest(".pv-mt"); var box = document.getElementById("pv-ptrend");
    if (!wrap || !box) return;
    wrap.querySelectorAll("button").forEach(function(x){ x.classList.toggle("on", x===b); });
    var owner = wrap.getAttribute("data-pv-owner");
    var sample = owner === "sample";
    var games = sample ? SAMPLE_GAMES : playerGames(owner);
    box.innerHTML = renderPlayerTrend(games, b.getAttribute("data-pvmt"), sample);
    chartGo(box);
  });
  function teamPoints(code){
    var run = 0;
    return ((CG.lg && CG.lg.results) || []).slice().sort(function(a,b){ return a.at-b.at; })
      .filter(function(r){ return r.home===code || r.away===code; })
      .map(function(r, i){
        var us = r.score[code], them = r.score[r.home===code ? r.away : r.home];
        var p = us > them ? 2 : (r.ot ? 1 : 0);
        run += p;
        return { v: run, label: "<b>Game "+(i+1)+"</b> \u00b7 vs "+(r.home===code?r.away:r.home)+" \u00b7 <b>"+(us>them?"W":(r.ot?"OTL":"L"))+" "+us+"\u2013"+them+"</b> \u00b7 "+run+" pts" };
      });
  }
  var SAMPLE_TEAM = [
    {opp:"TOR",us:3,them:2,ot:false},{opp:"CHI",us:1,them:4,ot:false},{opp:"PIT",us:2,them:1,ot:true},
    {opp:"WPG",us:5,them:2,ot:false},{opp:"ANA",us:2,them:3,ot:true},{opp:"COL",us:4,them:1,ot:false},
    {opp:"BOS",us:1,them:2,ot:false},{opp:"DAL",us:3,them:1,ot:false},{opp:"TOR",us:2,them:0,ot:false},
    {opp:"CHI",us:4,them:3,ot:true}
  ];
  function teamTrendCard(code){
    var real = teamPoints(code), sample = real.length < 2;
    var pts, gamesArr;
    if (sample){
      var run = 0;
      pts = SAMPLE_TEAM.map(function(g, i){
        var p = g.us > g.them ? 2 : (g.ot ? 1 : 0); run += p;
        return { v: run, label: "<b>Sample game "+(i+1)+"</b> \u00b7 vs "+g.opp+" \u00b7 <b>"+(g.us>g.them?"W":(g.ot?"OTL":"L"))+" "+g.us+"\u2013"+g.them+"</b> \u00b7 "+run+" pts" };
      });
      gamesArr = SAMPLE_TEAM;
    } else { pts = real; gamesArr = null; }
    var team = (CG.TEAMS||[]).find(function(x){ return x.code === code; });
    var color = (team && team.color) || "#D9A800";
    var totPts = pts[pts.length-1].v, gp = pts.length;
    var gaugeHtml = pvGauge(totPts/(gp*2), String(totPts), 'of '+(gp*2)+' possible points'+(sample?' \u00b7 sample':''));
    var barsHtml = "";
    if (sample){
      barsHtml = pvHBars(
        gamesArr.map(function(g){ return g.us; }),
        gamesArr.map(function(g){ return "vs "+g.opp+" \u00b7 <b>"+g.us+"\u2013"+g.them+"</b>"; }),
        String(gamesArr[gamesArr.length-1].us)+' <span style="font-size:14px;font-weight:300;color:rgba(237,239,233,.55)">goals last game</span>',
        'goals for, last ten \u00b7 sample');
    }
    return '<section class="sec-tight"><div class="shell"><div class="pvw"><div class="pvw-h">'+
      '<span class="pvw-ic">'+ICW.bars+'</span><b>The points race</b>'+
      (sample?'<span class="chip chip-chrome">Sample</span>':'<span class="chip">Game by game</span>')+'</div>'+
      '<div class="pvw-grid"><div>'+gaugeHtml+'</div><div>'+(barsHtml||'')+'</div></div>'+
      pvLine(pts, { color: color, h: 120 })+
      '<p class="caption" style="margin-top:10px">'+
      (sample
        ? 'Sample numbers to preview the feature \u2014 real results take over automatically once the club plays.'
        : 'Cumulative standings points \u2014 hover for each result.')+'</p></div></div></section>';
  }
  /* ---- standings rows: PTS counts up over a leader-scaled bar; DIFF becomes a signed pill
         (the base markup tints DIFF with an inline colour, which is colour-alone encoding) ---- */
  if (CG.standRows){
    var _srows = CG.standRows;
    CG.standRows = function(div, opts){
      var html = _srows(div, opts);
      try {
        var rows = CG.standings(CG.lg, div);
        var lead = Math.max.apply(null, rows.map(function(r){ return r.pts; }).concat([1]));
        rows.forEach(function(r){
          var ptsCell = '<td class="pts" data-v="'+r.pts+'">'+r.pts+'</td>';
          if (html.indexOf(ptsCell) < 0) return;
          html = html.replace(ptsCell,
            '<td class="pts" data-v="'+r.pts+'"><span data-count="'+r.pts+'">0</span>'+
            '<span class="pv-ptsbar" style="--p:'+(r.pts/lead).toFixed(3)+'"></span></td>');
          var diffCell = '<td data-v="'+r.diff+'" style="color:'+(r.diff>0?"var(--green)":r.diff<0?"var(--red)":"inherit")+'">'+(r.diff>0?"+":"")+r.diff+'</td>';
          if (html.indexOf(diffCell) > -1)
            html = html.replace(diffCell, '<td data-v="'+r.diff+'">'+pvDelta(r.diff, "")+'</td>');
        });
      } catch(e){}
      return html;
    };
  }
  /* ---- results: the winning score carries the weight (both were identical before) ---- */
  if (CG.gameCard){
    var _gcard = CG.gameCard;
    CG.gameCard = function(g, opts){
      var html = _gcard(g, opts);
      try {
        if (g && g.score && g.home && g.away){
          var hs = g.score[g.home], as = g.score[g.away];
          if (hs != null && as != null && hs !== as)
            html = html.replace('class="gc-score"', 'class="gc-score pv-final" data-w="'+(hs>as?"home":"away")+'"');
        }
      } catch(e){}
      return html;
    };
  }

  /* ---- brand page: the typography section describes the fonts ACTUALLY rendering.
         The layer swaps the type system, so hardcoded face names ("Archivo", "IBM Plex")
         would document a system the page no longer runs. Read the live stack instead. ---- */
  if (CG.ROUTES.brand){
    var _brand = CG.ROUTES.brand;
    CG.ROUTES.brand = function(param, qs){
      var html = _brand(param, qs);
      try {
        var cs = getComputedStyle(document.documentElement);
        var first = function(tok, fallback){
          var v = (cs.getPropertyValue(tok) || "").split(",")[0].replace(/["']/g, "").trim();
          if (!v) return fallback;
          /* the display token carries a lowercase Adobe family id — title-case it for reading */
          return v.charAt(0).toUpperCase() + v.slice(1);
        };
        var disp = first("--f-display", first("--f-disp", "Archivo"));
        var body = first("--f-sharp", first("--f-body", "IBM Plex Sans"));
        html = html
          .replace("<b>Archivo</b> · display / headings · 400–900 · tight tracking, balanced wrap",
                   "<b>"+esc(disp)+"</b> · display / headings · condensed caps · tight tracking")
          .replace("<b>IBM Plex Sans</b> · body · 400 / 500 / 600 · line-height ~1.6",
                   "<b>"+esc(body)+"</b> · body · 300 / 400 / 600 / 700 · line-height ~1.6")
          .replace("<b>IBM Plex Mono</b> · data & labels · tabular figures for every stat",
                   "<b>"+esc(body)+"</b> · data & labels · tabular figures for every stat")
          .replace("Three faces, each with a job", "Two faces, each with a job")
          .replace("A display face for confidence, a body face for reading, a mono face for anything that’s a number.",
                   "A condensed display face for confidence and one text face across body copy, labels, and data.");
      } catch(e){}
      return html;
    };
  }

  if (CG.ROUTES.awards){
    var _aw = CG.ROUTES.awards;
    CG.ROUTES.awards = function(param, qs){
      var h = _aw(param, qs);
      try {
        var mSec = h.indexOf('<section');
        if (mSec > -1){
          var band = '<section class="sec-tight"><div class="shell"><div class="pv-awhero">'+
            pvTrophy(140)+
            '<div><h2>Honors</h2><p>Player of the Week, season awards, and the championship record '+
            '\u2014 decided on the ice, kept forever.</p></div></div></div></section>';
          h = h.slice(0, mSec) + band + h.slice(mSec);
        }
      } catch(e){}
      return h;
    };
  }
  if (CG.ROUTES.player){
    var _plr = CG.ROUTES.player;
    CG.ROUTES.player = function(param, qs){
      var h = _plr(param, qs);
      try {
        var pid = decodeURIComponent(param||"");
        var pl = ((CG.lg && CG.lg.players) || []).find(function(x){ return x.id===pid || x.tag===pid; });
        var card = playerTrendCard(pl ? pl.id : pid);
        var mark = '<div class="stack">';
        var i = h.indexOf(mark);
        /* the profile's sidebar: the widget rides up as a feature card, no scrolling needed */
        if (i > -1) h = h.slice(0, i + mark.length) + card + h.slice(i + mark.length);
        else h += '<section class="sec-tight"><div class="shell">'+card+'</div></section>';
      } catch(e){}
      return h;
    };
  }
  if (CG.ROUTES.team){
    var _tmr = CG.ROUTES.team;
    CG.ROUTES.team = function(param, qs){
      var h = _tmr(param, qs);
      try { h += teamTrendCard(String(param||"").toUpperCase()); } catch(e){}
      return h;
    };
  }

  /* ---- audit persona (preview only): renders signed-in LAYOUTS while signed out.
         Client-side cosplay for design review — RLS still guards every row, and any
         write would be refused by the database. Refuses to touch a real session. ---- */
  var _hubRoute = null;
  function installPersonaGuards(){
    if (_hubRoute) return;
    _hubRoute = CG.ROUTES.hub;
    CG.ROUTES.hub = function(param, qs){
      if (param === "messages" && CG._pvReal){
        return CG.hubShell("messages",
          '<div style="margin-bottom:20px"><span class="eyebrow chr">Direct messages</span>'+
          '<h1 class="h-sec" style="margin-top:8px">Messages</h1></div>'+
          '<div class="card"><div class="card-b"><p class="lede">The audit persona has no real account, so private '+
          'conversations cannot load here. Sign in normally to use Messages.</p></div></div>');
      }
      return _hubRoute(param, qs);
    };
  }

  window.PVAS = function(role){
    try {
      if (!CG.auth) CG.auth = {};
      installPersonaGuards();
      if (CG.auth.role && CG.auth.role !== "guest" && !CG._pvReal) return "real session — refusing";
      if (!CG._pvReal) CG._pvReal = { role: CG.auth.role || "guest", profile: CG.auth.profile || null, user: CG.auth.user || null };
      if (!role || role === "guest"){
        CG.auth.role = CG._pvReal.role; CG.auth.profile = CG._pvReal.profile;
        CG.auth.user = CG._pvReal.user; CG._pvReal = null;
      } else {
        CG.auth.role = role;
        CG.auth.user = { id: "00000000-0000-4000-8000-000000000000" };
        CG.auth.profile = { id: "00000000-0000-4000-8000-000000000000", gamertag: "Design Audit",
          display_name: "Design Audit", avatar_url: null, is_admin: false,
          role: role === "commish" ? "commissioner" : (role === "mgmt" ? "member" : role),
          departments: (role === "staff" || role === "commish") ? ["applications"] : [] };
      }
      CG.renderChrome(); CG.router();
      return "as " + CG.auth.role;
    } catch(e){ return "ERR " + (e && e.message); }
  };

  /* ---- Namesake Watch: real NHL Stats API numbers for the eight namesakes ---- */
  var nhlCache = null, nhlLoading = false;
  function nhlSection(){
    return '<section class="sec" id="pv-nhl-sec" style="padding-top:0;padding-bottom:clamp(28px,4vw,52px)"><div class="shell">'+
      '<div class="pv-nhl-panel"><div class="pv-nhl-h"><h3>Namesake watch</h3><span id="pv-nhl-season"></span></div>'+
      '<p class="pv-nhl-cap">CGHL clubs carry NHL franchise names. This is how the namesakes are doing in the real '+
        'NHL — points race, records, and pace, straight from the NHL Stats API.</p>'+
      '<div id="pv-nhl"><p style="font-family:var(--f-sharp);font-weight:300;font-size:13px;color:rgba(237,239,233,.5)">Pulling the numbers\u2026</p></div>'+
    '</div></div></section>';
  }
  function hideNhl(){ var sec = document.getElementById("pv-nhl-sec"); if (sec) sec.style.display = "none"; }
  function renderNhl(el, j){
    var ts = (j.teams||[]).slice().sort(function(a,b){ return b.pts - a.pts; });
    if (!ts.length){ hideNhl(); return; }
    var max = ts[0].pts || 1;
    var live = ts.some(function(t){ return t.gp > 0 && t.gp < 82; });
    if (ts[0].season) nhlSeason = String(ts[0].season);
    var tag = document.getElementById("pv-nhl-season");
    if (tag){
      var sn = ts[0].season ? String(ts[0].season) : "";
      tag.textContent = (sn ? sn.slice(0,4)+"\u2013"+sn.slice(6)+" NHL season" : "NHL")+
        (live ? " \u00b7 in progress" : " \u00b7 final records");
    }
    el.innerHTML = ts.map(function(t, i){
      var team = (CG.TEAMS||[]).find(function(x){ return x.code === t.code; });
      var color = (team && team.color) || "#FFE500";
      var proj = (live && t.gp > 0 && t.gp < 82) ? Math.round(t.pts / t.gp * 82) : null;
      return '<div class="pv-ng"><button type="button" class="pv-nrow" data-ns="'+esc(t.code)+'" aria-expanded="false"><span class="tm">'+CG.crest(t.code, 26)+esc(t.code)+'</span>'+
        '<span class="rec">'+t.w+'-'+t.l+'-'+t.otl+(t.l10 ? ' \u00b7 L10 '+esc(t.l10) : "")+'</span>'+
        '<div class="pv-nbar"><i style="width:'+Math.round(100*t.pts/max)+'%;background:'+esc(color)+';transition-delay:'+(i*70)+'ms"></i></div>'+
        '<b class="pts"><span data-count="'+t.pts+'">0</span><small>'+
          (proj ? '<span class="pv-proj">82-game pace \u00b7 '+proj+'</span>' : 'PTS')+'</small></b></button><div class="pv-nd" hidden></div></div>';
    }).join("");
    el.setAttribute("data-filled","1");
    runCounters(el);
    chartGo(el);
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ el.classList.add("go"); }); });
  }
  function fillNhl(){
    var el = document.getElementById("pv-nhl");
    if (!el || el.getAttribute("data-filled")) return;
    if (nhlCache){ renderNhl(el, nhlCache); return; }
    if (nhlLoading) return;
    nhlLoading = true;
    fetch("/.netlify/functions/nhl-stats").then(function(r){ return r.json(); }).then(function(j){
      nhlLoading = false;
      if (j && j.teams && j.teams.length){ nhlCache = j; var e2 = document.getElementById("pv-nhl"); if (e2) renderNhl(e2, j); }
      else hideNhl();
    }).catch(function(){ nhlLoading = false; hideNhl(); });
  }

  /* ---- the serif hero: centered, minimal, with the crest strip ---- */
  function softHero(){
    var s = CG.SEASON || {};
    var regOpen = !!(s.registration_open && s.status !== "active");
    var active = s.status === "active";
    var startMs = CG.seasonStartMs && CG.seasonStartMs();
    var startTag = startMs ? esc(CG.fmtDay(startMs).replace(/^[A-Za-z]+, /,"")) : "soon";
    var head = active ? esc(s.name||"The season")+" is under way." : "The puck drops "+startTag+".";
    var dek = "Eight clubs, two divisions, and a fresh sheet.";

    var regDl = s.registration_deadline ? Date.parse(s.registration_deadline) : null;
    var faO = s.free_agency_opens_at ? Date.parse(s.free_agency_opens_at) : null;
    var faC = s.free_agency_closes_at ? Date.parse(s.free_agency_closes_at) : null;
    var faLive = !!(faO && faC && Date.now() >= faO && Date.now() < faC);
    var meta = "";
    if (faLive)
      meta = '<p class="pv-meta">Free agency closes in <b id="faCountdown" data-close="'+faC+'">—</b></p>';
    else if (regOpen && regDl && Date.now() < regDl)
      meta = '<p class="pv-meta">Registration closes '+esc(CG.fmtDay(regDl))+' · <b id="regCountdown" data-close="'+regDl+'">—</b></p>';

    var crests = (CG.TEAMS||[]).map(function(t){
      return '<a href="#/team/'+esc(t.code)+'" aria-label="'+esc(t.name)+'">'+CG.crest(t.code, 38)+'</a>';
    }).join("");

    return '<section id="hero"><div class="shell pv-soft">'+
      '<h2 class="big">'+head+'</h2>'+
      '<p class="dek">'+dek+'</p>'+
      '<div class="row">'+
        (regOpen ? '<a class="pv-cta" href="#/register">Register to play<span class="dot">→</span></a>'
                 : '<a class="pv-cta" href="#/schedule">See the schedule<span class="dot">→</span></a>')+
        '<a class="quiet" href="#/rulebook">How the season works</a></div>'+
      meta+
      (crests ? '<div class="pv-crests">'+crests+'</div>' : "")+
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
      var h1 = html.indexOf('</h1>');
      var head = h1 > -1 ? html.slice(0, h1 + 5) : "";
      html = head + softHero() + stageHtml() + nhlSection() + html.slice(b + endMark.length);
      var sIdx = html.indexOf('class="statline"');
      if (sIdx > -1){
        var sOpen = html.lastIndexOf('<section', sIdx);
        var sEnd = html.indexOf('</section>', sIdx);
        if (sOpen > -1 && sEnd > -1) html = html.slice(0, sOpen) + html.slice(sEnd + 10);
      }
      return html;
    } catch(e){ return html; }
  };
  /* AFTER.home stays the original: the carousel no-ops, and the countdown ids
     (#regCountdown / #faCountdown) are provided by the hero's meta line. */
})();
