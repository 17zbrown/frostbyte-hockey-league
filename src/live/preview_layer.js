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
  '.pv-kpi:hover{box-shadow:0 0 0 1px rgba(255,166,54,.4),0 6px 18px -6px rgba(255,166,54,.45)}'+
          /* 3D crest treatment: staggered flip-in entrance, coin-spin on hover */
  '.pv-crests{perspective:900px}'+
  '.pv-crests a{opacity:0;transform:rotateY(70deg)}'+
  '@keyframes pvFlip{0%{opacity:0;transform:rotateY(70deg)}100%{opacity:1;transform:rotateY(0)}}'+
  '.pv-crests.in a,.in .pv-crests a{animation:pvFlip .7s cubic-bezier(.22,.8,.24,1) both}'+
  ['','',''].map(function(_,i){return '';}).join('')+
  '.pv-crests.in a:nth-child(2),.in .pv-crests a:nth-child(2){animation-delay:.07s}.pv-crests.in a:nth-child(3),.in .pv-crests a:nth-child(3){animation-delay:.14s}'+
  '.pv-crests.in a:nth-child(4),.in .pv-crests a:nth-child(4){animation-delay:.21s}.pv-crests.in a:nth-child(5),.in .pv-crests a:nth-child(5){animation-delay:.28s}'+
  '.pv-crests.in a:nth-child(6),.in .pv-crests a:nth-child(6){animation-delay:.35s}.pv-crests.in a:nth-child(7),.in .pv-crests a:nth-child(7){animation-delay:.42s}'+
  '.pv-crests.in a:nth-child(8),.in .pv-crests a:nth-child(8){animation-delay:.49s}'+
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
  '.pv-rv{opacity:0;transition:opacity .65s ease}'+
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
    /* two drifting glow layers ride inside the aura; the cinema kit animates them */
    a.innerHTML = '<div id="pv-aura-a"></div><div id="pv-aura-b"></div>';
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
      /* rolling odometer columns (pv3); the module itself falls back to
         instant text under reduced motion or if it failed to initialize */
      pv3Odometer(el, end, pre, post);
    });
  }
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function(es){
    es.forEach(function(e){
      e.target.__pvSeen = true;   /* the observer HAS reported; the timeout net stands down */
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
          if (el.classList.contains("in") || el.__pvSeen) return;
          el.classList.add("in"); runCounters(el); chartGo(el);
        }, 2500);
      });
  }
  var app = document.getElementById("app");
  var pv3EnterT = 0;
  if (app && "MutationObserver" in window){
    new MutationObserver(function(){
      /* synchronous: split the fresh headlines + restart the route-enter
         choreography BEFORE the next paint, so nothing flashes unstyled */
      try {
        if (typeof pv3HeroText === "function") pv3HeroText();
        if (typeof PV3 !== "undefined" && !PV3.reduced){
          app.classList.remove("pv3-enter");
          void app.offsetWidth;   /* restart the animation set — one reflow per route change */
          app.classList.add("pv3-enter");
          clearTimeout(pv3EnterT);
          pv3EnterT = setTimeout(function(){ app.classList.remove("pv3-enter"); }, 760);
        }
      } catch(e){}
      pvSchedule(function(){
        attachReveals(); fillNhl();
        try { if (typeof PV3 !== "undefined") PV3.route(); } catch(e){}
      });
    }).observe(app, { childList: true });
  }

  var _renderChrome = CG.renderChrome;
  CG.renderChrome = function(){
    _renderChrome.apply(this, arguments);
    try {
      ensureAura();
      ensureRibbon();
      ensureFrame();
      if (typeof window.pv3EnsureCinema === "function") window.pv3EnsureCinema();
      var saved = null;
      try { saved = (JSON.parse(localStorage.getItem("cgproto:v1")||"{}").prefs||{}).theme; } catch(e){}
      /* the cinematic reset is dark-first: dark is the designed default, light stays a choice */
      if (!saved || saved === "auto") document.documentElement.setAttribute("data-theme","dark");
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
    var done = false;
    function run(){ if (done) return; done = true; fn(); }
    requestAnimationFrame(function(){ requestAnimationFrame(run); });
    setTimeout(run, 140);
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
  var pvTipEl = null, pvTipRect = null;
  addEventListener("scroll", function(){ pvTipRect = null; }, { passive: true, capture: true });
  addEventListener("resize", function(){ pvTipRect = null; }, { passive: true });
  function tipShow(tip, html, x, y){
    if (tip._h !== html){ tip._h = html; tip.innerHTML = html; tip._w = tip.offsetWidth; }
    tip.style.opacity = 1;
    tip.style.left = Math.min(x + 14, innerWidth - (tip._w || 0) - 8) + "px";
    tip.style.top = (y - 34) + "px";
  }
  document.addEventListener("mousemove", function(ev){
    var tip = ensureTip();
    var el = ev.target && ev.target.closest && ev.target.closest("[data-pvchart]");
    if (!el){
      var d = ev.target && ev.target.closest && ev.target.closest("[data-tip]");
      if (d){
        tipShow(tip, d.getAttribute("data-tip"), ev.clientX, ev.clientY);
        return;
      }
      tip.style.opacity = 0; return;
    }
    var c = pvCharts[el.getAttribute("data-pvchart")]; if (!c) return;
    if (el !== pvTipEl){ pvTipEl = el; pvTipRect = null; }
    var r = pvTipRect || (pvTipRect = el.getBoundingClientRect());
    var fx = (ev.clientX - r.left) / r.width * c.W;
    var best = 0, bd = 1e9;
    for (var i = 0; i < c.xy.length; i++){ var d2 = Math.abs(c.xy[i][0] - fx); if (d2 < bd){ bd = d2; best = i; } }
    var gd = el.querySelector(".gd"), cur = el.querySelector(".cur");
    if (gd){ gd.setAttribute("x1", c.xy[best][0]); gd.setAttribute("x2", c.xy[best][0]); }
    if (cur){ cur.setAttribute("cx", c.xy[best][0]); cur.setAttribute("cy", c.xy[best][1]); }
    tipShow(tip, c.labels[best], ev.clientX, ev.clientY);
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

  /* module tilt retired by request: boxes stay still — only logos and in-box details animate */

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
          if (hs != null && as != null && hs !== as){
            var win = hs > as ? hs : as;
            html = html.replace('<span class="gc-score num">' + win + '</span>',
              '<span class="gc-score num pv-final">' + win + '</span>');
          }
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
      var code = String(param||"").toUpperCase();
      try {
        /* the 3D showcase medallion leads the page; club-colour ambience follows */
        var mark = '<div class="shell">';
        var i = h.indexOf(mark);
        if (i > -1) h = h.slice(0, i + mark.length) + pv3TeamHero(code) + h.slice(i + mark.length);
        if (typeof pv3ClubTint === "function") pv3ClubTint(code);
      } catch(e){}
      try { h += teamTrendCard(code); } catch(e){}
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
    pvSchedule(function(){ el.classList.add("go"); });
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
      /* 3D medallion pucks; the anchor keeps href + aria-label, the puck
         takes over the entrance + hover duties (pv3-crest-a hands them off) */
      return '<a class="pv3-crest-a" href="#/team/'+esc(t.code)+'" aria-label="'+esc(t.name)+'">'+pv3Puck(t.code, 64)+'</a>';
    }).join("");

    return '<section id="hero"><div class="shell pv-soft">'+
      '<h2 class="big">'+head+'</h2>'+
      '<p class="dek">'+dek+'</p>'+
      '<div class="row">'+
        (regOpen ? '<a class="pv-cta" href="#/register">Register to play<span class="dot">→</span></a>'
                 : '<a class="pv-cta" href="#/schedule">See the schedule<span class="dot">→</span></a>')+
        '<a class="quiet" href="#/rulebook">How the season works</a></div>'+
      meta+
      (crests ? '<div class="pv-crests" data-pv3-par="-0.06">'+crests+'</div>' : "")+
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

  /* ================================================================
     PV3 — the cinematic kit. One shared kernel (single rAF loop,
     capability flags), then each motion module in its own guarded
     block. Everything below is additive and fails safe.
     ================================================================ */
  var PV3 = (function(){
    var mqF = window.matchMedia ? matchMedia("(pointer: fine)") : null;
    var mqR = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    var K = {
      fine: !!(mqF && mqF.matches),
      reduced: !!(mqR && mqR.matches),
      lerp: function(a, b, k){ return a + (b - a) * k; }
    };
    if (mqR && mqR.addEventListener) mqR.addEventListener("change", function(e){ K.reduced = e.matches; });
    var subs = [], running = false;
    function loop(t){
      if (!subs.length || document.hidden){ running = false; return; }
      var list = subs.slice();   /* callbacks may unsubscribe mid-frame */
      for (var i = 0; i < list.length; i++){ try { list[i](t); } catch(e){} }
      if (!subs.length){ running = false; return; }
      requestAnimationFrame(loop);
    }
    K.on = function(fn){
      subs.push(fn);
      if (!running){ running = true; requestAnimationFrame(loop); }
      return function(){ var i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); };
    };
    document.addEventListener("visibilitychange", function(){
      if (!document.hidden && subs.length && !running){ running = true; requestAnimationFrame(loop); }
    });
    /* route hooks: modules push callbacks; fired after every #app render */
    K.routeHooks = [];
    K.route = function(){
      for (var i = 0; i < K.routeHooks.length; i++){ try { K.routeHooks[i](); } catch(e){} }
    };
    return K;
  })();
  window.PV3 = PV3;   /* pv3-cursor and pv3-scroll gate on the global */

    /* ---- pv3 stylesheet: one plain-CSS string injected AFTER the base sheet.
         Later-rule cascade order is load-bearing: the module overrides
         (crest entrance handoff, dark ladder, card-hover upgrades) must
         out-rank equal-specificity base rules by source order. ---- */
  var pv3st = document.createElement("style");
  pv3st.textContent = "/* ================================================================\n   pv3-text — cinematic typography motion\n   (split-text hero cascade, gradient shimmer, route-enter\n   choreography, section-heading mask reveal)\n   ================================================================ */\n\n/* ---- split-text cascade: overflow-hidden word masks, staggered letters ----\n   Single-phase: the animation runs as soon as the spans are inserted, with\n   `both` fill, so nothing can ever be stranded hidden waiting for a class. */\n.pv3-split .pv3-w{display:inline-block;overflow:hidden;vertical-align:top;\n  padding:0 .02em .1em;margin-bottom:-.1em}\n.pv3-split .pv3-l{display:inline-block;\n  animation:pv3-letter-in .62s cubic-bezier(.22,.9,.3,1) both}\n@keyframes pv3-letter-in{\n  0%{transform:translateY(110%) rotate(6deg)}\n  100%{transform:translateY(0) rotate(0)}\n}\n@media(prefers-reduced-motion:reduce){\n  .pv3-split .pv3-l{animation:none;transform:none}\n}\n\n/* ---- gradient shimmer: specular sweep inside the glyphs ----\n   Base = currentColor: -webkit-text-fill-color:transparent does NOT change\n   the `color` property, so the gradient base always equals the heading's\n   live color in BOTH themes. Solid-color fallback where clip:text is\n   unsupported (the class is simply inert). Sheen is theme-scoped. */\n.pv3-shimmer{--pv3-sheen:#FFE500}\nhtml[data-theme=\"light\"] .pv3-shimmer{--pv3-sheen:#A87E00}\n@supports ((-webkit-background-clip:text) or (background-clip:text)){\n  .pv3-shimmer{\n    background-image:linear-gradient(100deg,\n      currentColor 0%,currentColor 42%,\n      var(--pv3-sheen) 50%,\n      currentColor 58%,currentColor 100%);\n    background-size:250% 100%;\n    background-position:115% 0;\n    -webkit-background-clip:text;\n    background-clip:text;\n    -webkit-text-fill-color:transparent;\n    animation:pv3-shimmer-sweep 5.4s ease-in-out 1s 3 both;\n  }\n}\n/* the tile edges are both currentColor, so the default background-repeat\n   keeps the off-canvas regions painted (no transparent glyph gaps at the\n   overshoot positions) */\n@keyframes pv3-shimmer-sweep{\n  0%{background-position:115% 0}\n  55%{background-position:-15% 0}\n  100%{background-position:-15% 0}\n}\n@media(prefers-reduced-motion:reduce){\n  .pv3-shimmer{animation:none;background-image:none;\n    -webkit-text-fill-color:currentColor}\n}\n\n/* ---- route-enter choreography: #app direct children fade up + deblur ----\n   The lead adds .pv3-enter on #app at each route render and removes it\n   after the cascade (see integration notes). `both` fill pins children at\n   their final state until the class is removed, so a late removal is safe. */\n#app.pv3-enter .pg>*{animation:pv3-route-in .48s cubic-bezier(.22,.9,.3,1) both}\n#app.pv3-enter .pg>:nth-child(2){animation-delay:40ms}\n#app.pv3-enter .pg>:nth-child(3){animation-delay:80ms}\n#app.pv3-enter .pg>:nth-child(4){animation-delay:120ms}\n#app.pv3-enter .pg>:nth-child(5){animation-delay:160ms}\n#app.pv3-enter .pg>:nth-child(n+6){animation-delay:200ms}\n@keyframes pv3-route-in{\n  0%{opacity:0}\n  100%{opacity:1}\n}\n@media(prefers-reduced-motion:reduce){\n  #app.pv3-enter .pg>*{animation:none}\n}\n\n/* ---- section heading mask reveal: rides the EXISTING .pv-rv/.in observer,\n   CSS only. The .h-sec.pv-rv variant re-declares the FULL transition list so\n   it cannot clobber the reveal layer's opacity/transform transition.\n   Negative insets leave breathing room so glyph edges never clip at rest. */\n.pv-rv .h-sec,.h-sec.pv-rv{clip-path:inset(-8% -6% 102% -6%)}\n.pv-rv .h-sec{transition:clip-path .8s cubic-bezier(.22,.9,.3,1) .1s}\n.h-sec.pv-rv{transition:opacity .65s ease,transform .65s ease,\n  clip-path .8s cubic-bezier(.22,.9,.3,1) .1s}\n.pv-rv.in .h-sec,.h-sec.pv-rv.in{clip-path:inset(-8% -6% -12% -6%)}\n@media(prefers-reduced-motion:reduce){\n  .pv-rv .h-sec,.h-sec.pv-rv{clip-path:none;transition:none}\n}\n\n/* ===== pv3-odometer: rolling-digit counters =====\n   Layout contract: the odometer block occupies EXACTLY the plain-text width\n   (1ch per digit + natural separator widths, tabular figures) and 1em height,\n   so surrounding text never reflows during or after the spin. Inherits color\n   and font from its host, so both html[data-theme=dark] and light work as-is. */\n.pv3-odo{\n  display:inline-flex;\n  align-items:flex-start;\n  vertical-align:top;\n  line-height:1;\n  white-space:nowrap;\n  font-variant-numeric:tabular-nums;\n}\n.pv3-odo-col{\n  display:inline-block;\n  width:1ch;\n  height:1em;\n  overflow:hidden;\n}\n.pv3-odo-sep{\n  display:inline-block;\n  height:1em;\n  line-height:1;\n}\n.pv3-odo-strip{\n  display:block;\n  transform:translateY(0);\n  transition-property:transform;\n  transition-timing-function:cubic-bezier(.22,.9,.3,1);\n  transition-duration:.9s; /* per-column duration is set inline by JS (550–1250ms) */\n  will-change:transform;\n}\n.pv3-odo-d{\n  display:block;\n  height:1em;\n  line-height:1;\n}\n/* screen readers get the finished value once; the animated strips are aria-hidden */\n.pv3-odo-sr{\n  position:absolute;\n  width:1px;\n  height:1px;\n  margin:-1px;\n  padding:0;\n  border:0;\n  overflow:hidden;\n  clip:rect(0 0 0 0);\n  clip-path:inset(50%);\n  white-space:nowrap;\n}\n@media(prefers-reduced-motion:reduce){\n  /* snap, never freeze: transition off means the transform applies instantly,\n     so a strip mid-flight lands on the correct final digit */\n  .pv3-odo-strip{transition:none!important}\n}\n\n/* ================================================================\n   pv3-cursor — cursor presence system (desktop only)\n   The JS gates init on PV3.fine && !PV3.reduced; this CSS carries a\n   reduced-motion belt-and-braces override anyway. The native cursor\n   is never hidden. Ring + ripple sit above everything (#pv-tip is\n   z-index 999; these use 1199/1200) and are pointer-events:none, so\n   dropdowns (.pop), forms, and focus outlines are untouched.\n   ================================================================ */\n\n#pv3-cursor-ring{\n  position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;\n  border-radius:50%;border:1.5px solid rgba(255,229,0,.60);\n  box-shadow:0 0 14px rgba(255,166,54,.35),0 0 3px rgba(255,166,54,.28);\n  pointer-events:none;z-index:1200;opacity:0;will-change:transform,opacity;\n  transition:opacity .3s ease,border-color .25s ease,box-shadow .25s ease}\n#pv3-cursor-ring.pv3-live{opacity:1}\n#pv3-cursor-ring.pv3-amp{\n  border-color:rgba(255,229,0,.95);\n  box-shadow:0 0 24px rgba(255,166,54,.55),0 0 6px rgba(255,229,0,.45)}\n#pv3-cursor-ring.pv3-hide{opacity:0}\n\n/* light theme: chrome yellow is low-contrast on the paper canvas — lean on the darker gold */\nhtml[data-theme=\"light\"] #pv3-cursor-ring{\n  border-color:rgba(217,168,0,.70);\n  box-shadow:0 0 12px rgba(255,166,54,.30),0 0 2px rgba(255,166,54,.22)}\nhtml[data-theme=\"light\"] #pv3-cursor-ring.pv3-amp{\n  border-color:rgba(217,168,0,.95);\n  box-shadow:0 0 20px rgba(255,166,54,.50),0 0 5px rgba(217,168,0,.40)}\n\n/* click ripple: one-shot burst, element removed on animationend (JS) */\n.pv3-ripple{\n  position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;\n  border:2px solid rgba(255,229,0,.85);box-shadow:0 0 16px rgba(255,166,54,.45);\n  pointer-events:none;z-index:1199;\n  animation:pv3-burst .55s cubic-bezier(.2,.7,.3,1) forwards}\nhtml[data-theme=\"light\"] .pv3-ripple{border-color:rgba(217,168,0,.85)}\n@keyframes pv3-burst{\n  0%{transform:scale(.5);opacity:.9}\n  100%{transform:scale(2.6);opacity:0}}\n\n/* magnetic CTAs: while the module owns motion (html.pv3-cursor-on), the old\n   .pv-cta:hover translateY stands down so there is ONE source of truth for\n   transform — the inline magnetic translate written by JS. The box-shadow\n   hover from the base layer keeps working. */\nhtml.pv3-cursor-on .pv-cta:hover{transform:none}\nhtml.pv3-cursor-on .pv-cta,\nhtml.pv3-cursor-on #masthead a[aria-label=\"Join with Discord\"]{\n  will-change:transform;\n  transition:transform .22s cubic-bezier(.22,.8,.3,1.15),box-shadow .25s ease,\n    color .22s ease,background .22s ease,border-color .22s ease}\n\n@media(prefers-reduced-motion:reduce){\n  #pv3-cursor-ring,.pv3-ripple{display:none!important}\n  /* module tears itself down under reduced motion; if the html class lingers\n     for a frame, restore the original hover lift so nothing feels dead */\n  html.pv3-cursor-on .pv-cta:hover{transform:translateY(-1px)}\n}\n\n/* ================= pv3-medallion — 3D club-logo pucks =================\n   Pure CSS 3D. All motion is transform/opacity except the mandated\n   specular background-position sweep (tiny, contained, 6s cycle).\n   Must be injected AFTER the existing preview CSS so later-rule wins\n   settle the .pv-crests entrance override. */\n\n.pv3-puck{position:relative;display:inline-block;width:var(--pk-size,64px);height:var(--pk-size,64px);\n  perspective:calc(var(--pk-size,64px)*3.4)}\n/* children never take pointer events: hit target stays the puck/anchor,\n   so delegated tracking sees one element and link clicks pass through */\n.pv3-puck>span{pointer-events:none}\n\n.pv3-puck-disc{position:absolute;inset:0;border-radius:50%;transform-style:preserve-3d;\n  will-change:transform;animation:pv3-idle 7s ease-in-out infinite}\n.pv3-puck.pv3-live .pv3-puck-disc{animation:none;transition:transform .12s ease-out}\n.pv3-puck.pv3-settle .pv3-puck-disc{animation:none;transition:transform .5s cubic-bezier(.22,1.4,.36,1)}\n/* starts and ends at 0deg so the idle loop resumes seamlessly after a settle */\n@keyframes pv3-idle{0%,100%{transform:rotateY(0deg)}25%{transform:rotateY(10deg)}75%{transform:rotateY(-10deg)}}\n\n/* metallic rim: warm chrome conic edge */\n.pv3-puck-rim{position:absolute;inset:0;border-radius:50%;\n  background:conic-gradient(from 210deg,#23272E,#8E97A2 12%,#1B1F25 26%,#C9A45A 38%,#2B3038 52%,\n    #757E88 66%,#171B20 80%,#8E97A2 92%,#23272E);\n  box-shadow:0 calc(var(--pk-size,64px)*.02) calc(var(--pk-size,64px)*.08) rgba(0,0,0,.5),\n    inset 0 0 0 1px rgba(255,255,255,.08)}\n\n/* face: club-colour tint sunk into near-black rubber */\n.pv3-puck-face{position:absolute;inset:5.5%;border-radius:50%;\n  transform:translateZ(calc(var(--pk-size,64px)*.045));\n  background:radial-gradient(circle at 32% 26%,rgba(255,255,255,.15),transparent 44%),\n    linear-gradient(rgba(10,13,17,.66),rgba(10,13,17,.84)),\n    radial-gradient(circle at 50% 44%,var(--pk-c,#FFE500),#080B0F 82%);\n  box-shadow:inset 0 calc(var(--pk-size,64px)*-.02) calc(var(--pk-size,64px)*.07) rgba(0,0,0,.55),\n    inset 0 1px 0 rgba(255,255,255,.10)}\n\n/* crest sits proud of the face (real 3D parallax under tilt) */\n.pv3-puck-crest{position:absolute;left:0;top:0;width:100%;height:100%;\n  display:flex;align-items:center;justify-content:center;\n  transform:translateZ(calc(var(--pk-size,64px)*.07));\n  filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}\n.pv3-puck-crest img,.pv3-puck-crest svg{width:100%!important;height:100%!important;object-fit:contain}\n/* neutralise the sitewide crest hover transforms + the .pv-crests coin-spin inside a puck */\n.pv3-puck .crest{transform:none!important;transition:none!important}\n\n/* specular sweep: passes every 6s; while pointer-tracked it becomes a\n   highlight that follows --gx/--gy (same var idiom as the tilt glare) */\n.pv3-puck-spec{position:absolute;inset:2%;border-radius:50%;\n  transform:translateZ(calc(var(--pk-size,64px)*.08));\n  background:linear-gradient(115deg,transparent 32%,rgba(255,255,255,.20) 45%,\n    rgba(255,229,140,.28) 50%,rgba(255,255,255,.16) 55%,transparent 68%);\n  background-size:260% 260%;background-position:130% 0;background-repeat:no-repeat;\n  animation:pv3-sweep 6s ease-in-out 4;opacity:.85}\n@keyframes pv3-sweep{0%,52%{background-position:130% 0}88%,100%{background-position:-30% 0}}\n.pv3-puck.pv3-live .pv3-puck-spec{animation:none;background-size:100% 100%;background-position:0 0;\n  background-image:radial-gradient(closest-side circle at var(--gx,50%) var(--gy,35%),\n    rgba(255,255,255,.30),rgba(255,213,120,.12) 46%,transparent 72%)}\n\n/* soft elliptical ground shadow; JS drives --pk-sx / --pk-ss under tilt */\n.pv3-puck-shadow{position:absolute;left:6%;right:6%;bottom:calc(var(--pk-size,64px)*-.13);\n  height:calc(var(--pk-size,64px)*.17);border-radius:50%;\n  background:radial-gradient(closest-side,rgba(0,0,0,.55),transparent 72%);\n  transform:translateX(calc(var(--pk-sx,0)*1px)) scale(var(--pk-ss,1));\n  transition:transform .5s cubic-bezier(.22,1.4,.36,1)}\nhtml[data-theme=\"light\"] .pv3-puck-shadow{opacity:.6}\n\n/* ---- home hero strip: anchors hand entrance + dim/grayscale duties to the puck ---- */\n.pv-crests a.pv3-crest-a{opacity:1;filter:none;animation:none;transform:none}\n.pv-crests a:has(.pv3-puck){opacity:1;filter:none;animation:none;transform:none}\n.pv-crests .pv3-puck{opacity:0;transform:rotateY(70deg) scale(.7)}\n@keyframes pv3-flip{0%{opacity:0;transform:rotateY(70deg) scale(.7)}100%{opacity:1;transform:none}}\n.pv-crests.in .pv3-puck,.in .pv-crests .pv3-puck{animation:pv3-flip .7s cubic-bezier(.22,.8,.24,1) both}\n.pv-crests.in a:nth-child(2) .pv3-puck,.in .pv-crests a:nth-child(2) .pv3-puck{animation-delay:.07s}\n.pv-crests.in a:nth-child(3) .pv3-puck,.in .pv-crests a:nth-child(3) .pv3-puck{animation-delay:.14s}\n.pv-crests.in a:nth-child(4) .pv3-puck,.in .pv-crests a:nth-child(4) .pv3-puck{animation-delay:.21s}\n.pv-crests.in a:nth-child(5) .pv3-puck,.in .pv-crests a:nth-child(5) .pv3-puck{animation-delay:.28s}\n.pv-crests.in a:nth-child(6) .pv3-puck,.in .pv-crests a:nth-child(6) .pv3-puck{animation-delay:.35s}\n.pv-crests.in a:nth-child(7) .pv3-puck,.in .pv-crests a:nth-child(7) .pv3-puck{animation-delay:.42s}\n.pv-crests.in a:nth-child(8) .pv3-puck,.in .pv-crests a:nth-child(8) .pv3-puck{animation-delay:.49s}\n\n/* ---- team-page showcase ---- */\n.pv3-teamhero{float:right;margin:6px 0 22px 26px}\n@media(max-width:760px){.pv3-teamhero{float:none;display:flex;justify-content:center;margin:0 0 18px}}\n\n/* ---- reduced motion: everything static, everything visible ---- */\n@media(prefers-reduced-motion:reduce){\n  .pv3-puck-disc,.pv3-puck-spec{animation:none!important;transition:none!important}\n  .pv3-puck-shadow{transition:none}\n  .pv-crests .pv3-puck{opacity:1;transform:none;animation:none!important}\n}\n\n/* ================================================================\n   pv3-cinema — cinematic ambient layer + vibrancy\n   Inject AFTER the existing preview_layer <style> element: the dark\n   ladder below deliberately out-cascades the existing dark block.\n   ================================================================ */\n\n/* ---- upgraded dark treatment: a deeper surface ladder --------------\n   body #0C1015 (deepest backdrop) < frame/--paper #101519 (canvas +\n   the mh-nav tab, which fuses into the frame via var(--paper) and its\n   corner radials, so they stay in lockstep automatically) < cards\n   #12161B (elevated). .pv-dash (#fff) and the light-theme nav tab are\n   NOT touched — their fixed colors were contrast-audited. */\nhtml[data-theme=\"dark\"]{--paper:#101519}\nhtml[data-theme=\"dark\"] body{background:#0C1015!important}\nhtml[data-theme=\"dark\"] #pv-frame{background:#101519;\n  box-shadow:0 36px 110px rgba(0,0,0,.8),0 0 0 1px rgba(255,190,80,.12),0 0 70px -8px rgba(255,166,54,.16)}\nhtml[data-theme=\"dark\"] .card,\nhtml[data-theme=\"dark\"] .kpi,\nhtml[data-theme=\"dark\"] .gamecard,\nhtml[data-theme=\"dark\"] .newscard{background:#12161B}\n/* hover lightening still wins: .kpi:hover / .gamecard:hover etc. carry\n   higher specificity (0-2-0) than the rules above (0-1-2). */\n\n/* ---- animated aura: two drifting glow layers inside #pv-aura ------- */\n#pv-aura{overflow:hidden}\n#pv-aura-a,#pv-aura-b{position:absolute;inset:-12%;pointer-events:none}\n#pv-aura-a{background:\n  radial-gradient(1000px 700px at 80% 8%,rgba(255,166,54,.20),transparent 62%),\n  radial-gradient(820px 620px at 6% 32%,rgba(255,92,44,.15),transparent 60%),\n  radial-gradient(940px 680px at 50% 106%,var(--pv3-club-glow,rgba(0,0,0,0)),transparent 65%);\n  animation:pv3-drift-a 45s ease-in-out infinite alternate,pv3-breathe 26s ease-in-out infinite alternate}\n#pv-aura-b{background:\n  radial-gradient(900px 680px at 56% 102%,rgba(255,196,64,.16),transparent 64%),\n  radial-gradient(720px 520px at 94% 64%,rgba(255,124,40,.12),transparent 60%),\n  radial-gradient(760px 560px at 12% 88%,var(--pv3-club-glow,rgba(0,0,0,0)),transparent 62%);\n  animation:pv3-drift-b 70s ease-in-out infinite alternate,pv3-breathe 34s ease-in-out infinite alternate;\n  animation-delay:0s,-9s}\n@keyframes pv3-drift-a{from{transform:translate3d(-2.5%,-1.5%,0) scale(1)}to{transform:translate3d(2.5%,2%,0) scale(1.08)}}\n@keyframes pv3-drift-b{from{transform:translate3d(2%,1.5%,0) scale(1.06)}to{transform:translate3d(-2.5%,-2%,0) scale(1)}}\n@keyframes pv3-breathe{from{opacity:.85}to{opacity:1}}\n\n/* ---- film grain: fixed, above #pv-aura, below #pv-frame ------------\n   (z-order by DOM position: the div sits right after #pv-aura, both at\n   z-index:0; #pv-frame is positioned later in the DOM so it paints on\n   top.) Inline feTurbulence SVG tile, ~300 bytes. Not animated, so it\n   is already reduced-motion-safe. */\n#pv3-grain{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.05;\n  background-image:url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='180'%20height='180'%3E%3Cfilter%20id='pv3n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='.8'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3C/filter%3E%3Crect%20width='180'%20height='180'%20filter='url(%23pv3n)'/%3E%3C/svg%3E\");\n  background-size:180px 180px}\n\n/* ---- aurora sweeps on the dark panels ------------------------------\n   ::before is taken by the static glows on every one of these panels;\n   ::after is free on all five (verified). All five panels carry\n   overflow:hidden/clip, so the oversized rotating pseudo is masked to\n   the panel. It paints above content by DOM order, which is fine at\n   opacity .06 + screen blending — it reads as a glass sheen. */\n.pv-stage::after,.pv-nhl-panel::after,.pvw::after,.codebox::after,.pv-awhero::after{\n  content:\"\";position:absolute;inset:-45%;pointer-events:none;\n  background:conic-gradient(from 0deg at 50% 50%,transparent 0deg,rgba(255,214,120,.55) 42deg,transparent 84deg,transparent 198deg,rgba(255,166,54,.4) 240deg,transparent 284deg);\n  opacity:.06;mix-blend-mode:screen;animation:pv3-aurora 60s linear 2}\n@keyframes pv3-aurora{to{transform:rotate(1turn)}}\n\n/* ---- vibrancy: chrome→gold gradient numerals -----------------------\n   .pvw-big always sits on the fixed-dark widget cards, so it gets the\n   gradient in both themes. The hero countdown (.pv-meta b) only gets\n   it in dark — chrome on light paper cannot clear contrast. Fallback:\n   outside @supports, the existing solid colors simply remain. */\n@supports((-webkit-background-clip:text) or (background-clip:text)){\n  .pv3-grad,.pvw-big,html[data-theme=\"dark\"] .pv-meta b{\n    background-image:linear-gradient(115deg,var(--chrome) 15%,var(--gold) 85%);\n    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}\n  /* the mixed muted spans inside .pvw-big (e.g. \"goals last game\") keep\n     their own inline color instead of inheriting the gradient */\n  .pvw-big span,.pvw-big small{-webkit-text-fill-color:currentColor;background-image:none}\n}\n\n/* ---- live chip pulse: static shadow on a pseudo, opacity/transform\n   keyframe only (no per-frame shadow painting). .chip-live has no\n   pseudo-elements in the base layer (verified part1_head.html:146). */\n.chip-live{position:relative}\n.chip-live::after{content:\"\";position:absolute;inset:-3px;border-radius:inherit;pointer-events:none;\n  box-shadow:0 0 10px 2px rgba(255,110,60,.55);opacity:.12;animation:pv3-livepulse 2.2s ease-in-out infinite}\n@keyframes pv3-livepulse{0%,100%{opacity:.12;transform:scale(.97)}50%{opacity:.7;transform:scale(1.02)}}\n\n/* ---- scroll progress: 2px chrome bar, very top, above the ribbon.\n   z-index 240 clears everything in the base map (toasts are 130);\n   pointer-events:none so it can never block a control. */\n#pv3-scrollbar{position:fixed;top:0;left:0;width:100%;height:2px;z-index:240;pointer-events:none;\n  background:linear-gradient(90deg,var(--chrome),var(--gold));\n  box-shadow:0 0 10px rgba(255,229,0,.45);\n  transform:scaleX(0);transform-origin:left center}\n\n/* ---- reduced motion: aura static, aurora off, pulse off; the grain\n   is static by construction and the progress bar is scroll-tied. */\n@media(prefers-reduced-motion:reduce){\n  #pv-aura-a,#pv-aura-b{animation:none;opacity:1;transform:none}\n  .pv-stage::after,.pv-nhl-panel::after,.pvw::after,.codebox::after,.pv-awhero::after{animation:none;display:none}\n  .chip-live::after{animation:none;display:none}\n}\n\n/* ================================================================\n   pv3-scroll — scroll parallax + depth choreography\n   Loads AFTER the existing preview css: equal-specificity hover\n   overrides below win by source order.\n   ================================================================ */\n\n/* ---- parallax targets: transform-only, compositor-friendly ---- */\n@media(pointer:fine){[data-pv3-par]{will-change:transform}}\n\n/* An element that both reveals (.pv-rv, added by attachReveals — e.g. .pv-crests\n   via the \".pv-soft > *\" selector) and parallaxes must NOT transition transform,\n   or every scroll update would smear through the reveal's 650ms ease. The reveal\n   keeps its fade; parallax owns all movement. Specificity (0,2,0) beats both\n   .pv-rv and .pv-rv.in that come earlier. */\n.pv-rv[data-pv3-par]{transform:none;transition:opacity .65s ease}\n\n/* ---- depth hover: raise-cards lift a touch higher over a soft chrome underglow.\n   Selectors verified against the existing blocks:\n   \".card.raise:hover{transform:translateY(-2px);border-color:var(--line)}\" and\n   \".card.raise:hover{box-shadow:0 10px 28px rgba(16,21,25,.08)}\" — same\n   specificity, these later rules win. The base .card transition never included\n   box-shadow (it snapped); .card.raise below fixes that with a spring. ---- */\n.card.raise{transition:transform .35s cubic-bezier(.34,1.56,.64,1),box-shadow .35s ease,border-color .3s ease,background .3s ease}\n.card.raise:hover{transform:none;border-color:var(--line);box-shadow:0 14px 34px rgba(16,21,25,.10),0 6px 18px -6px rgba(255,166,54,.22)}\nhtml[data-theme=\"dark\"] .card.raise:hover{box-shadow:0 18px 44px rgba(0,0,0,.55),0 8px 22px -8px rgba(255,166,54,.30)}\n\n/* ---- gamecard / newscard: same 350ms spring, a whisper of scale (1.01).\n   The existing \"a,button{transition:color…}\" element rule loses to these class\n   rules, so color/border/background transitions are re-declared here to keep\n   the original feel intact. Overrides\n   \".gamecard:hover{…translateY(-2px)…}\" and \".newscard:hover{…translateY(-3px)…}\"\n   at equal specificity, later in source. ---- */\n.gamecard,.newscard{transition:transform .35s cubic-bezier(.34,1.56,.64,1),box-shadow .35s ease,border-color .3s ease,background .3s ease,color .22s ease}\n.gamecard:hover{border-color:var(--line);background:var(--ice);transform:none;box-shadow:0 10px 26px rgba(16,21,25,.08),0 6px 18px -6px rgba(255,166,54,.20)}\n.newscard:hover{transform:none;border-color:var(--line);box-shadow:0 16px 38px rgba(16,21,25,.11),0 8px 22px -8px rgba(255,166,54,.20)}\nhtml[data-theme=\"dark\"] .gamecard:hover{box-shadow:0 12px 30px rgba(0,0,0,.50),0 6px 18px -6px rgba(255,166,54,.26)}\nhtml[data-theme=\"dark\"] .newscard:hover{box-shadow:0 18px 42px rgba(0,0,0,.55),0 8px 22px -8px rgba(255,166,54,.26)}\n\n/* ---- footer entrance: rises a little deeper than the standard reveal.\n   pv3FootReveal() (JS below) adds .pv-rv to the footer children and hands them\n   to the existing observer; only the styling lives here. ---- */\n#sitefoot .pv-rv{opacity:0;transition:opacity .7s ease}\n#sitefoot .pv-rv.in{opacity:1;transform:none}\n\n/* ---- reduced motion: parallax dead (belt to the JS gate's suspenders), footer\n   reveal instant. The footer override is REQUIRED here — the existing\n   reduced-motion \".pv-rv\" reset is (0,1,0) and would lose to the (1,1,0)\n   \"#sitefoot .pv-rv\" base rule above, stranding the footer invisible. ---- */\n@media(prefers-reduced-motion:reduce){\n  [data-pv3-par]{will-change:auto;transform:none!important}\n  #sitefoot .pv-rv{opacity:1;transform:none;transition:none}\n  .card.raise,.gamecard,.newscard{transition:none}\n  .card.raise:hover,.gamecard:hover,.newscard:hover{transform:none}\n}";
  pv3st.textContent += "\n/* ---- odometer host-proofing: hosts like .pv-kpi span / .kpi span style every\n   descendant span (font-size 10.5px, display:block, letter-spacing). These rules\n   tie or beat that specificity and sit later in the cascade, so the odometer\n   keeps its geometry inside any host. ---- */\n.pv3-odo,.pv3-odo span{font:inherit;color:inherit;margin:0;letter-spacing:inherit}\nspan.pv3-odo{font:inherit;display:inline-flex;align-items:flex-start;vertical-align:top;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums}\n.pv3-odo span.pv3-odo-col{display:inline-block;width:1ch;height:1em;overflow:hidden}\n.pv3-odo span.pv3-odo-strip{display:block;line-height:1}\n.pv3-odo span.pv3-odo-d{display:block;height:1em;line-height:1}\n.pv3-odo span.pv3-odo-sep{display:inline-block;height:1em;line-height:1}\n/* the showcase medallion IS the club identity on team pages — the flat header crest stands down */\n.pv3-teamhero+div>.crest{display:none}";
  pv3st.textContent += "\n/* ---- review fixes: focus on fixed-dark panels, winner emphasis, touch budgets ---- */\n.pv-stage :focus-visible,.pv-nhl-panel :focus-visible,.pvw :focus-visible,.codebox :focus-visible,.pv-awhero :focus-visible{outline-color:var(--chrome)}\n.gc-score.pv-final{font-weight:800;color:var(--ink)}\nhtml[data-theme=\"light\"] #pv3-grain{opacity:.028}\n@media(pointer:coarse){\n.pv3-shimmer{animation:none}\n.pv3-puck-spec{animation:none}\n.pv-stage::after,.pv-nhl-panel::after,.pvw::after,.codebox::after,.pv-awhero::after{animation:none;display:none}\n}";
  pv3st.textContent += "\n/* ---- boxes stay still; the DETAILS inside light up on hover: numbers, bars,\n   gauges, charts. Glows are static state changes, so they are reduced-motion\n   safe by construction. The cursor ring is retired for good measure. ---- */\n#pv3-cursor-ring{display:none!important}\n.pv-kpi b,.kpi b,.statline b,.leaderrow .val b{transition:text-shadow .25s ease}\n.pv-kpi:hover b{text-shadow:0 0 14px rgba(255,166,54,.65)}\n.kpi:hover b{text-shadow:0 0 16px rgba(255,166,54,.5)}\n.pvw:hover .pvw-big{text-shadow:0 0 18px rgba(255,229,0,.35)}\n.statline>div:hover b{text-shadow:0 0 14px rgba(255,166,54,.5)}\n.leaderrow:hover .val b{text-shadow:0 0 14px rgba(255,166,54,.5)}\n.tbl td.pts:hover{text-shadow:0 0 12px rgba(255,166,54,.55)}\n.pv-hbars i:hover{filter:brightness(1.4);box-shadow:0 0 12px rgba(255,229,0,.45)}\n.pv-nrow:hover .pv-nbar i{box-shadow:0 0 12px -2px rgba(255,229,0,.55)}\n.pv-pos .p:hover .pv-bar i{box-shadow:0 0 10px rgba(255,229,0,.5)}\n.pv-prog:hover i{box-shadow:0 0 10px rgba(255,229,0,.5)}\ntr:hover .pv-ptsbar::after{box-shadow:0 0 8px rgba(255,229,0,.65)}\n.form5:hover i.fd-w{box-shadow:0 0 8px rgba(255,229,0,.6)}\n.pv-gauge:hover .vg{filter:drop-shadow(0 0 6px rgba(255,229,0,.55))}\n.pv-ring:hover .rval{filter:drop-shadow(0 0 6px rgba(255,229,0,.55))}\n.pv-chart:hover .ln2{filter:drop-shadow(0 0 5px rgba(255,229,0,.45))}\n.rbar:hover .rb-fill{box-shadow:0 0 10px rgba(255,229,0,.5)}";
  document.head.appendChild(pv3st);

/* ================================================================
   pv3-odometer — rolling-digit counters.
   pv3Odometer(el, end, pre, post) replaces the interior of the old
   runCounters tween: per final digit a 1ch x 1em clipped column whose
   0–9 strip translateY's to the target digit. CSS-transition driven
   (no per-frame JS), transform-only, no layout reads, no listeners.
   Declared as `var` + assignment (NOT a block function declaration)
   so it stays visible to runCounters in the IIFE's strict-mode scope.
   ================================================================ */
var pv3Odometer;
try {
  (function(){

    /* format the target: integers stay integers; anything fractional keeps
       exactly one decimal place (matches CAP/1e6 values like 40.5).
       Today's data has no thousands separators, so none are produced. */
    function pv3OdoText(end){
      if (typeof end !== "number" || !isFinite(end)) return String(end == null ? "" : end);
      if (Math.round(end) === end) return String(end);
      return (Math.round(end * 10) / 10).toFixed(1);
    }

    pv3Odometer = function(el, end, pre, post){
      pre = pre == null ? "" : String(pre);
      post = post == null ? "" : String(post);
      var str = pv3OdoText(end);
      var flat = pre + str + post;
      try {
        var digitCount = str.replace(/[^0-9]/g, "").length;
        /* instant paths: reduced motion (live PV3 flag), degenerate values,
           >6 digits, or a browser with no CSS transitions */
        if (PV3.reduced || digitCount === 0 || digitCount > 6 ||
            !("transition" in document.documentElement.style)){
          el.textContent = flat;
          return;
        }

        var wrap = document.createElement("span");
        wrap.className = "pv3-odo";
        wrap.setAttribute("aria-hidden", "true");

        if (pre) wrap.appendChild(document.createTextNode(pre));

        var strips = [];
        var digitsHtml = "";
        var d;
        for (d = 0; d <= 9; d++) digitsHtml += '<span class="pv3-odo-d">' + d + '</span>';

        var i, ch;
        for (i = 0; i < str.length; i++){
          ch = str.charAt(i);
          if (ch >= "0" && ch <= "9"){
            var col = document.createElement("span");
            col.className = "pv3-odo-col";
            var strip = document.createElement("span");
            strip.className = "pv3-odo-strip";
            strip.innerHTML = digitsHtml;
            strip.setAttribute("data-pv3-digit", ch);
            col.appendChild(strip);
            wrap.appendChild(col);
            strips.push(strip);
          } else {
            /* "." (and defensively "," or "-") ride along as static glyphs */
            var sep = document.createElement("span");
            sep.className = "pv3-odo-sep";
            sep.textContent = ch;
            wrap.appendChild(sep);
          }
        }

        if (post) wrap.appendChild(document.createTextNode(post));

        /* per-column duration, shortest on the left, longest on the right:
           550ms .. 1250ms — the rightmost digit keeps spinning last */
        var n = strips.length, k;
        for (k = 0; k < n; k++){
          var dur = (n === 1) ? 900 : Math.round(550 + (k / (n - 1)) * 700);
          strips[k].style.transitionDuration = dur + "ms";
        }

        /* accessible flat value first, then the aria-hidden mechanism */
        var sr = document.createElement("span");
        sr.className = "pv3-odo-sr";
        sr.textContent = flat;

        el.textContent = "";
        el.appendChild(sr);
        el.appendChild(wrap);

        /* pvSchedule paints the start state (translateY(0)) before the flip;
           its 140ms timeout arm covers paused-rAF contexts. Setting the same
           transform twice is idempotent, so both arms are safe. If the
           transition itself cannot run, the transform still applies instantly
           and the strip sits EXACTLY on the final digit. */
        pvSchedule(function(){
          for (var m = 0; m < strips.length; m++){
            strips[m].style.transform =
              "translateY(-" + strips[m].getAttribute("data-pv3-digit") + "em)";
          }
        });
      } catch(err){
        /* any surprise inside the build → the correct final text, no animation */
        try { el.textContent = flat; } catch(e2){}
      }
    };
  })();
} catch(e){ /* module must never break the app */ }
/* last-resort stub so runCounters can always call it */
if (!pv3Odometer){
  pv3Odometer = function(el, end, pre, post){
    el.textContent = (pre || "") + end + (post || "");
  };
}

  /* hovering an animated number re-rolls its odometer — a detail, not a module */
  document.addEventListener("pointerover", function(ev){
    try {
      if (typeof PV3 === "undefined" || PV3.reduced || !PV3.fine) return;
      var host = ev.target && ev.target.closest && ev.target.closest("[data-count]");
      if (!host || host.__pvRoll) return;
      var strips = host.querySelectorAll(".pv3-odo-strip");
      if (!strips.length) return;
      host.__pvRoll = true;
      setTimeout(function(){ host.__pvRoll = false; }, 1600);
      strips.forEach(function(st){ st.style.transform = "translateY(0)"; });
      pvSchedule(function(){
        strips.forEach(function(st){
          st.style.transform = "translateY(-" + st.getAttribute("data-pv3-digit") + "em)";
        });
      });
    } catch(e){}
  });

/* ================================================================
   pv3-cursor — cursor presence system (desktop only).
   Self-initializing. Assumes the PV3 kernel exists. Everything is
   wrapped so a thrown error can never break the app.
   ================================================================ */
try {
  (function(){
    var pv3CursorOn = false;      /* module initialized? */
    var pv3CurUnsub = null;       /* PV3.on unsubscribe */
    var pv3Ring = null;
    var pv3Seen = false;          /* first pointermove seen (snap, then lerp) */
    var pv3Tx = -100, pv3Ty = -100;   /* target (pointer) */
    var pv3Rx = -100, pv3Ry = -100;   /* rendered (lerped) */
    var pv3Ts = 1, pv3S = 1;          /* target / rendered scale */
    var pv3MagEl = null, pv3MagRect = null;  /* magnetic CTA + cached halo rect */

    var PV3_MAG_SEL = '.pv-cta,#masthead a[aria-label="Join with Discord"]';
    var PV3_AMP_SEL = 'a,button,[data-go],input,select,textarea,.pv-cta';
    var PV3_TEXTY = { text:1, search:1, email:1, password:1, url:1, tel:1, number:1 };

    function pv3RingEl(){
      /* appended to document.body ONCE, id-guarded — survives #app rerenders */
      var r = document.getElementById("pv3-cursor-ring");
      if (!r){
        r = document.createElement("div");
        r.id = "pv3-cursor-ring";
        r.setAttribute("aria-hidden", "true");
        document.body.appendChild(r);
      }
      return r;
    }

    /* one shared rAF via PV3.on — transform+opacity only, zero layout reads */
    function pv3Frame(){
      if (!pv3Ring) return;
      pv3Rx = PV3.lerp(pv3Rx, pv3Tx, 0.16);
      pv3Ry = PV3.lerp(pv3Ry, pv3Ty, 0.16);
      pv3S  = PV3.lerp(pv3S,  pv3Ts, 0.2);
      if (Math.abs(pv3Rx - pv3Tx) < 0.03 && Math.abs(pv3Ry - pv3Ty) < 0.03 &&
          Math.abs(pv3S - pv3Ts) < 0.002){
        /* settled — release the shared loop; pv3Move/pv3Over re-arm it */
        if (pv3CurUnsub){ pv3CurUnsub(); pv3CurUnsub = null; }
        return;
      }
      pv3Ring.style.transform = "translate3d(" + pv3Rx.toFixed(2) + "px," +
        pv3Ry.toFixed(2) + "px,0) scale(" + pv3S.toFixed(3) + ")";
    }

    function pv3MagRelease(){
      /* spring-back: clear the inline transform; the CSS transition on
         html.pv3-cursor-on .pv-cta carries it home */
      if (!pv3MagEl) return;
      try { pv3MagEl.style.transform = ""; } catch(e){}
      pv3MagEl = null; pv3MagRect = null;
    }

    function pv3Move(ev){
      if (ev.pointerType && ev.pointerType !== "mouse") return;
      pv3Tx = ev.clientX; pv3Ty = ev.clientY;
      if (!pv3Seen){
        pv3Seen = true; pv3Rx = pv3Tx; pv3Ry = pv3Ty;  /* snap in, don't fly in */
        if (pv3Ring) pv3Ring.classList.add("pv3-live");
      }
      /* ---- magnetic pull: cached rect only, no per-frame layout reads ---- */
      if (pv3MagEl && !pv3MagEl.isConnected) pv3MagRelease();  /* route rerender */
      if (pv3MagEl){
        var rc = pv3MagRect;
        if (ev.clientX < rc.hl || ev.clientX > rc.hr || ev.clientY < rc.ht || ev.clientY > rc.hb){
          pv3MagRelease();
        } else {
          var mx = Math.max(-5, Math.min(5, (ev.clientX - rc.cx) / rc.w * 10));
          var my = Math.max(-5, Math.min(5, (ev.clientY - rc.cy) / rc.h * 10));
          pv3MagEl.style.transform = "translate(" + mx.toFixed(1) + "px," + my.toFixed(1) + "px)";
        }
      }
      if (!pv3MagEl){
        var m = ev.target && ev.target.closest && ev.target.closest(PV3_MAG_SEL);
        if (m){
          var r = m.getBoundingClientRect();  /* read once, on acquire */
          pv3MagEl = m;
          pv3MagRect = {
            hl: r.left - 30, hr: r.right + 30, ht: r.top - 30, hb: r.bottom + 30,
            cx: r.left + r.width / 2, cy: r.top + r.height / 2,
            w: Math.max(r.width, 1), h: Math.max(r.height, 1)
          };
        }
      }
    }

    /* ---- interactive amplification: state set on pointerover, not per-frame ---- */
    function pv3Over(ev){
      if (!pv3Ring) return;
      var t = ev.target && ev.target.closest && ev.target.closest(PV3_AMP_SEL);
      var amp = false, hide = false;
      if (t){
        var tag = t.tagName;
        if (tag === "TEXTAREA") hide = true;
        else if (tag === "INPUT"){
          var ty = (t.getAttribute("type") || "text").toLowerCase();
          hide = !!PV3_TEXTY[ty];
          amp = !hide;
        } else amp = true;
      }
      pv3Ts = amp ? 1.7 : 1;
      pv3Ring.classList.toggle("pv3-amp", amp);
      pv3Ring.classList.toggle("pv3-hide", hide);
    }

    /* ---- click ripple: one-shot, removed on animationend (+ timeout net) ---- */
    function pv3Down(ev){
      if (PV3.reduced) return;
      if (ev.pointerType && ev.pointerType !== "mouse") return;
      if (ev.button) return;   /* primary button only */
      if (ev.target && ev.target.closest && ev.target.closest("input,textarea,select")) return;   /* no ripples over form fields */
      var b = document.createElement("div");
      b.className = "pv3-ripple";
      b.style.left = ev.clientX + "px";
      b.style.top = ev.clientY + "px";
      document.body.appendChild(b);
      var gone = false;
      function drop(){
        if (gone) return; gone = true;
        if (b.parentNode) b.parentNode.removeChild(b);
      }
      b.addEventListener("animationend", drop);
      setTimeout(drop, 900);   /* net for paused rAF / suppressed animations */
    }

    function pv3Leave(ev){
      /* fires on document when the pointer leaves the window */
      pv3Seen = false;
      if (pv3Ring) pv3Ring.classList.remove("pv3-live");
      pv3MagRelease();
    }

    /* cached rects go stale on scroll/resize — release, re-acquire on next move */
    function pv3Drop(){ pv3MagRelease(); }

    function pv3CursorInit(){
      if (pv3CursorOn) return;
      if (!window.PV3 || !PV3.fine || PV3.reduced) return;
      if (!document.body){
        document.addEventListener("DOMContentLoaded", pv3CursorInit);
        return;
      }
      pv3CursorOn = true;
      /* ring retired by request — pv3Ring stays null; magnet + ripple remain */
      document.documentElement.classList.add("pv3-cursor-on");
      document.addEventListener("pointermove", pv3Move, { passive: true });
      document.addEventListener("pointerdown", pv3Down, { passive: true });
      document.addEventListener("pointerleave", pv3Leave);
      document.addEventListener("scroll", pv3Drop, { passive: true, capture: true });
      window.addEventListener("resize", pv3Drop, { passive: true });
    }

    function pv3CursorTeardown(){
      if (!pv3CursorOn) return;
      pv3CursorOn = false;
      if (pv3CurUnsub){ try { pv3CurUnsub(); } catch(e){} pv3CurUnsub = null; }
      document.removeEventListener("pointermove", pv3Move);
      document.removeEventListener("pointerover", pv3Over);
      document.removeEventListener("pointerdown", pv3Down);
      document.removeEventListener("pointerleave", pv3Leave);
      document.removeEventListener("scroll", pv3Drop, true);
      window.removeEventListener("resize", pv3Drop);
      pv3MagRelease();
      document.documentElement.classList.remove("pv3-cursor-on");
      if (pv3Ring) pv3Ring.classList.remove("pv3-live", "pv3-amp", "pv3-hide");
      pv3Seen = false;
    }

    /* live reduced-motion flips: tear down / come back without a reload */
    var pv3RmMq = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    function pv3RmSync(){
      if (pv3RmMq && pv3RmMq.matches) pv3CursorTeardown();
      else pv3CursorInit();
    }
    if (pv3RmMq){
      if (pv3RmMq.addEventListener) pv3RmMq.addEventListener("change", pv3RmSync);
      else if (pv3RmMq.addListener) pv3RmMq.addListener(pv3RmSync);
    }

    pv3CursorInit();
  })();
} catch(e){ /* pv3-cursor must never break the app */ }

/* ================================================================
   pv3-text — cinematic typography motion (JS)
   Assumes PV3 + CG/esc/pvSchedule exist. Additive only; ES5.
   ================================================================ */
try {

  /* Split a TEXT-ONLY element into overflow-hidden word masks holding
     letter spans, cascading in via the pv3-letter-in animation.
     Returns the total cascade time in ms, or 0 when it bailed and left
     the element untouched (reduced motion, element children, already
     split, empty). Screen readers get ONE string: aria-label on the
     element, aria-hidden on every word mask. */
  var pv3SplitIn = function(el){
    try {
      if (!el || el.nodeType !== 1) return 0;
      if (el.getAttribute("data-pv3split")) return 0;
      if (PV3.reduced) return 0;                     /* bail entirely: untouched */
      var i, node;
      for (i = 0; i < el.childNodes.length; i++){
        node = el.childNodes[i];
        if (node.nodeType !== 3) return 0;           /* element/comment child: bail */
      }
      var clean = String(el.textContent || "").replace(/\s+/g, " ");
      if (!clean.replace(/ /g, "")) return 0;
      var words = clean.split(" ");
      var letterTotal = clean.replace(/ /g, "").length;
      /* ~40ms per letter, compressed so the whole stagger caps at 700ms */
      var STEP = Math.min(40, 700 / Math.max(1, letterTotal - 1));
      var DUR = 620, out = [], li = 0, last = 0, w, ls, j;
      for (i = 0; i < words.length; i++){
        w = words[i];
        if (!w) continue;
        ls = "";
        for (j = 0; j < w.length; j++){
          last = Math.round(li * STEP);
          ls += '<span class="pv3-l" style="animation-delay:' + last + 'ms">' +
                esc(w.charAt(j)) + '</span>';
          li++;
        }
        out.push('<span class="pv3-w" aria-hidden="true">' + ls + '</span>');
      }
      if (!out.length) return 0;
      el.setAttribute("aria-label", clean.replace(/^ | $/g, ""));
      el.setAttribute("data-pv3split", "1");
      el.classList.add("pv3-split");
      el.innerHTML = out.join(" ");                  /* real spaces keep word wrap */
      return last + DUR;
    } catch(e){ return 0; }
  };

  /* Auto-apply after each route render: the home hero headline and interior
     page titles, each exactly once (data-pv3split marks them). The hero also
     receives the shimmer once its cascade settles. Idempotent and cheap —
     safe to call repeatedly (pvSchedule double-fires by design). */
  var pv3HeroText = function(){
    try {
      var hero = document.querySelector("#app .pv-soft h2.big");
      if (hero && !hero.getAttribute("data-pv3split")){
        var t = pv3SplitIn(hero);
        if (t){
          setTimeout(function(){
            /* the route may have rerendered since; only shimmer the element
               still in the document */
            if (document.contains(hero) && hero.getAttribute("data-pv3split")){
              /* the cascade is done and the spans have served their purpose.
                 Restore the plain string BEFORE adding the shimmer: clip:text
                 cannot paint into per-letter spans (each is its own composited
                 layer), which left the headline fully transparent — the one
                 failure class this layer must never ship. */
              var full = hero.getAttribute("aria-label");
              if (full){ hero.textContent = full; hero.removeAttribute("aria-label"); }
              hero.classList.add("pv3-shimmer");
            }
          }, t + 260);
        }
      }
      var heads = document.querySelectorAll("#app .h-page:not([data-pv3split])");
      for (var i = 0; i < heads.length; i++) pv3SplitIn(heads[i]);
    } catch(e){}
  };

  /* expose for the lead's wiring (same-IIFE call is preferred; the window
     handle is a convenience for console QA) */
  window.pv3SplitIn = pv3SplitIn;
  window.pv3HeroText = pv3HeroText;

} catch(e){ /* pv3-text must never break the app */ }

/* ================= pv3-medallion — 3D club pucks (JS) =================
   Assumes PV3, CG, esc exist. ES5, additive, delegated, error-shielded.
   Exposes: pv3Puck(code, size)  and  pv3TeamHero(code). */
var pv3Puck, pv3TeamHero;
try {
  (function(){

    function pv3Team(code){
      var list = CG.TEAMS || [], i;
      for (i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
      return null;
    }

    /* builder: outer perspective wrapper > shadow + disc(rim, face, crest, specular).
       CG.crest renders at 2x its nominal px, so nominal ~= size*0.31 keeps the
       intrinsic attributes near the 62% slot; CSS forces the exact fit anyway. */
    pv3Puck = function(code, size){
      var S = Math.max(24, size || 64);
      var t = pv3Team(code);
      var color = (t && t.color) || "#FFE500";
      var crest = "";
      try { crest = CG.crest(code, Math.max(12, Math.round(S * 0.5)), { decorative: true }) || ""; } catch(e){}
      return '<span class="pv3-puck" data-code="' + esc(String(code || "")) + '" ' +
          'style="--pk-size:' + S + 'px;--pk-c:' + esc(color) + '">' +
        '<span class="pv3-puck-shadow" aria-hidden="true"></span>' +
        '<span class="pv3-puck-disc">' +
          '<span class="pv3-puck-crest">' + crest + '</span>' +
        '</span></span>';
    };

    pv3TeamHero = function(code){
      return '<div class="pv3-teamhero" data-pv3-par="-0.05">' + pv3Puck(String(code || "").toUpperCase(), 200) + '</div>';
    };

    /* ---- delegated pointer tracking (same pattern as the .pv-tilt engine) ----
       Rect is cached on acquire and invalidated on resize/scroll — no per-frame
       layout reads. Inner spans are pointer-events:none, so the event target is
       always the wrapper: one acquire per hover, no child-crossing churn. */
    var el = null, rect = null, disc = null;

    function reset(){
      if (!el) return;
      var e0 = el, d0 = disc;
      e0.classList.remove("pv3-live");
      e0.classList.add("pv3-settle");            /* spring-back transition window */
      if (d0) d0.style.transform = "";
      e0.style.setProperty("--pk-sx", "0");
      e0.style.setProperty("--pk-ss", "1");
      setTimeout(function(){ e0.classList.remove("pv3-settle"); }, 560); /* then idle resumes at 0deg */
      el = null; rect = null; disc = null;
    }

    document.addEventListener("pointermove", function(ev){
      if (!PV3.fine || PV3.reduced){ if (el) reset(); return; }
      var t = ev.target && ev.target.closest && ev.target.closest(".pv3-puck");
      if (el && el !== t) reset();
      if (!t) return;
      if (t !== el){
        el = t;
        disc = t.querySelector(".pv3-puck-disc");
        rect = t.getBoundingClientRect();
        t.classList.remove("pv3-settle");
        t.classList.add("pv3-live");
      }
      if (!rect) rect = el.getBoundingClientRect();   /* invalidated by resize/scroll */
      if (!disc || !rect.width) return;
      var px = (ev.clientX - rect.left) / rect.width;
      var py = (ev.clientY - rect.top) / rect.height;
      px = px < 0 ? 0 : (px > 1 ? 1 : px);
      py = py < 0 ? 0 : (py > 1 ? 1 : py);
      var ry = (px - .5) * 44;                        /* +-22deg */
      var rx = (.5 - py) * 44;
      disc.style.transform = "rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg) scale(1.06)";
      el.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
      el.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
      el.style.setProperty("--pk-sx", (ry * 0.35).toFixed(1));
      el.style.setProperty("--pk-ss", (1.05 + Math.abs(ry) * 0.004).toFixed(3));
    });
    /* capture-phase leave on document mirrors the existing tilt engine's cleanup */
    document.addEventListener("pointerleave", function(){ reset(); }, true);
    window.addEventListener("resize", function(){ rect = null; }, { passive: true });
    window.addEventListener("scroll", function(){ rect = null; }, { passive: true });
  })();
} catch(e){ /* shield: a failure here must never break the app */ }

/* hard fallbacks so lead-integrated call sites never throw even if init failed */
if (!pv3Puck) pv3Puck = function(code, size){
  try { return CG.crest(code, Math.round((size || 64) / 2)) || ""; } catch(e){ return ""; }
};
if (!pv3TeamHero) pv3TeamHero = function(code){
  try { return CG.crest(code, 84) || ""; } catch(e){ return ""; }
};

/* ================================================================
   pv3-cinema — grain + scroll progress + club tint (additive).
   Assumes PV3 kernel + CG globals exist. Wrapped so a throw can
   never break the app.
   ================================================================ */
(function(){
  try{

    /* ---- ensure the fixed cinema layers exist (idempotent).
       Grain goes right after #pv-aura so DOM order gives the right
       z stratum (above aura, below #pv-frame). The scrollbar is a
       body-level div, so route rerenders of #app never destroy it. */
    function pv3EnsureCinema(){
      try{
        if (!document.body) return;
        if (!document.getElementById("pv3-grain")){
          var g = document.createElement("div");
          g.id = "pv3-grain"; g.setAttribute("aria-hidden","true");
          var aura = document.getElementById("pv-aura");
          if (aura && aura.parentNode) aura.parentNode.insertBefore(g, aura.nextSibling);
          else document.body.insertBefore(g, document.body.firstChild);
        }
        if (!document.getElementById("pv3-scrollbar")){
          var s = document.createElement("div");
          s.id = "pv3-scrollbar"; s.setAttribute("aria-hidden","true");
          document.body.appendChild(s);
        }
      }catch(e){}
    }
    window.pv3EnsureCinema = pv3EnsureCinema;

    /* ---- scroll progress ------------------------------------------
       All layout reads happen in event handlers (scroll/resize) or a
       debounced route-change hook — the PV3.on frame callback only
       lerps a number and writes one transform, and skips the write
       entirely once settled. */
    var pv3ST = 0, pv3SC = -1, pv3SMax = 1, pv3Bar = null, pv3Last = -1;
    function pv3Scroll(){
      var y = window.pageYOffset || 0;
      pv3ST = y <= 0 ? 0 : (y >= pv3SMax ? 1 : y / pv3SMax);
      pv3BarWake();
    }
    function pv3Measure(){
      try{
        var d = document.documentElement;
        pv3SMax = Math.max(1, (d ? d.scrollHeight : 1) - (window.innerHeight || 1));
        pv3Scroll();
      }catch(e){}
    }
    window.addEventListener("scroll", pv3Scroll, { passive:true });
    window.addEventListener("resize", pv3Measure);
    var pv3BarSub = null;
    function pv3BarWake(){ if (!pv3BarSub) pv3BarSub = PV3.on(pv3BarFrame); }
    function pv3BarFrame(){
      if (!pv3Bar || !pv3Bar.isConnected) pv3Bar = document.getElementById("pv3-scrollbar");
      if (!pv3Bar) return;
      if (PV3.reduced){ pv3SC = pv3ST; }
      else {
        pv3SC = pv3SC < 0 ? pv3ST : PV3.lerp(pv3SC, pv3ST, .22);
        if (Math.abs(pv3SC - pv3ST) < .0008) pv3SC = pv3ST;
      }
      var w = Math.round(pv3SC * 1000) / 1000;
      if (w === pv3Last){
        /* settled — release the shared loop until the next scroll/measure */
        if (pv3SC === pv3ST && pv3BarSub){ pv3BarSub(); pv3BarSub = null; }
        return;
      }
      pv3Last = w;
      pv3Bar.style.transform = "scaleX(" + w + ")";
    }
    pv3BarWake();
    /* remeasure after every route render (own observer; coexists with
       the existing #app observer, childList only, debounced) */
    var pv3App = document.getElementById("app");
    if (pv3App && "MutationObserver" in window){
      var pv3MT = null;
      new MutationObserver(function(){
        clearTimeout(pv3MT);
        pv3MT = setTimeout(pv3Measure, 200);
      }).observe(pv3App, { childList:true });
    }

    /* ---- team-page ambience: --pv3-club-glow feeds the aura layers.
       pv3ClubTint(code) is exposed for the lead; the hashchange hook
       below also drives it automatically (and clears it) so no route
       wiring is strictly required. */
    function pv3ClubTint(code){
      try{
        var root = document.documentElement;
        if (!code){ root.style.removeProperty("--pv3-club-glow"); return; }
        var up = String(code).toUpperCase();
        var team = ((window.CG && CG.TEAMS) || []).filter(function(t){ return t.code === up; })[0];
        var hex = (team && team.color) ? String(team.color).replace("#","") : "";
        if (hex.length === 3)
          hex = hex.charAt(0)+hex.charAt(0)+hex.charAt(1)+hex.charAt(1)+hex.charAt(2)+hex.charAt(2);
        if (!/^[0-9A-Fa-f]{6}$/.test(hex)){ root.style.removeProperty("--pv3-club-glow"); return; }
        var n = parseInt(hex, 16);
        root.style.setProperty("--pv3-club-glow",
          "rgba(" + ((n>>16)&255) + "," + ((n>>8)&255) + "," + (n&255) + ",0.16)");
      }catch(e){}
    }
    window.pv3ClubTint = pv3ClubTint;
    function pv3RouteTint(){
      var m = /^#\/team\/([^\/?]+)/.exec(location.hash || "");
      pv3ClubTint(m ? decodeURIComponent(m[1]) : null);
    }
    window.addEventListener("hashchange", pv3RouteTint);

    /* ---- boot ---- */
    pv3EnsureCinema();
    pv3Measure();
    pv3RouteTint();
  }catch(e){ /* cinema is decoration; never let it take the app down */ }
})();

/* ================================================================
   pv3-scroll — scroll parallax + depth choreography (JS half).
   Paste INSIDE the main preview IIFE, AFTER all existing code, so
   the closure can reach `io` and `pvSchedule` (both are feature-
   checked; the module degrades gracefully if either is missing).
   ================================================================ */
try {
  (function(){
    if (!window.PV3 || !window.CG) return;

    /* ---------- parallax registry ---------- */
    var pv3ParItems = [];                       /* [{el,k,top,h,y}] — rects cached, never read per-frame */
    var pv3ScrollY = window.pageYOffset || 0;   /* recorded by the passive scroll listener */
    var pv3VH = window.innerHeight || 800;      /* recorded on refresh/resize */
    var pv3ParDirty = false;
    var pv3ParApplied = false;
    var pv3RszT = null;
    var PV3_PAR_MAX = 24;                       /* px clamp, both directions */

    function pv3ParClear(){
      for (var i = 0; i < pv3ParItems.length; i++){
        pv3ParItems[i].el.style.transform = "";
        pv3ParItems[i].y = 0;
      }
      pv3ParApplied = false;
    }

    /* Rebuilds the {top,height} cache. The ONE place allowed to read layout,
       and it runs only on boot / resize / route render — never per frame.
       Writes first (clear stale inline transforms so rects measure true),
       then a single read pass. */
    function pv3ParRefresh(){
      var i, el, k, r;
      for (i = 0; i < pv3ParItems.length; i++) pv3ParItems[i].el.style.transform = "";
      pv3ParItems = [];
      pv3ParApplied = false;
      if (PV3.reduced || !PV3.fine) return;
      var els = document.querySelectorAll("[data-pv3-par]");
      if (!els.length) return;
      for (i = 0; i < els.length; i++) els[i].style.transform = "";
      pv3VH = window.innerHeight || pv3VH;
      pv3ScrollY = window.pageYOffset || 0;
      for (i = 0; i < els.length; i++){
        el = els[i];
        k = parseFloat(el.getAttribute("data-pv3-par"));
        if (!k || k !== k) continue;            /* 0 and NaN are no-ops */
        if (k > 0.2) k = 0.2;
        if (k < -0.2) k = -0.2;
        r = el.getBoundingClientRect();
        if (!r.height) continue;
        pv3ParItems.push({ el: el, k: k, top: r.top + pv3ScrollY, h: r.height, y: 0 });
      }
      pv3ParDirty = true;                       /* first frame paints initial offsets */
      pv3ParWake();
    }
    window.pv3ParRefresh = pv3ParRefresh;

    /* One shared frame pass on the PV3 loop: zero layout reads (cached rects +
       recorded scrollY only), transform writes only when the value actually moved. */
    var pv3ParSub = null;
    function pv3ParWake(){ if (!pv3ParSub) pv3ParSub = PV3.on(pv3ParFrame); }
    function pv3ParFrame(){
      try {
        if (PV3.reduced || !PV3.fine){          /* live gate — reduced can flip mid-session */
          if (pv3ParApplied) pv3ParClear();
          if (pv3ParSub){ pv3ParSub(); pv3ParSub = null; }
          return;
        }
        if (!pv3ParDirty || !pv3ParItems.length){
          /* nothing to move — release the shared loop; scroll/refresh re-arm it */
          if (pv3ParSub){ pv3ParSub(); pv3ParSub = null; }
          return;
        }
        pv3ParDirty = false;
        var half = pv3VH / 2;
        for (var i = 0; i < pv3ParItems.length; i++){
          var it = pv3ParItems[i];
          var y = ((it.top + it.h / 2 - pv3ScrollY) - half) * it.k;
          if (y > PV3_PAR_MAX) y = PV3_PAR_MAX;
          else if (y < -PV3_PAR_MAX) y = -PV3_PAR_MAX;
          if (y - it.y < 0.25 && it.y - y < 0.25) continue;
          it.y = y;
          it.el.style.transform = "translate3d(0," + y.toFixed(2) + "px,0)";
          pv3ParApplied = true;
        }
      } catch(e){ /* a bad frame must never poison the shared loop */ }
    }
    pv3ParWake();

    window.addEventListener("scroll", function(){
      pv3ScrollY = window.pageYOffset || 0;
      pv3ParDirty = true;
      pv3ParWake();
    }, { passive: true });

    window.addEventListener("resize", function(){
      if (pv3RszT) clearTimeout(pv3RszT);
      pv3RszT = setTimeout(pv3ParRefresh, 120);
    }, { passive: true });

    /* fonts/images landing late can shift the cached rects once */
    window.addEventListener("load", function(){ pv3ParRefresh(); });

    /* route renders replace #app children — rebuild the cache after paint.
       Own observer; the existing one (attachReveals/fillNhl) is untouched. */
    var pv3App = document.getElementById("app");
    if (pv3App && "MutationObserver" in window){
      new MutationObserver(function(){
        if (typeof pvSchedule === "function") pvSchedule(pv3ParRefresh);
        else setTimeout(pv3ParRefresh, 140);
      }).observe(pv3App, { childList: true });
    }

    /* ---------- footer entrance: ride the existing .pv-rv observer ----------
       attachReveals never touches #sitefoot (its selector list is scoped to
       #app + .pv-soft), so this hands the footer children to the shared `io`
       directly, with the same 2.5s can't-strand-content fallback the file uses. */
    function pv3FootReveal(){
      var foot = document.getElementById("sitefoot");
      if (!foot) return;
      var kids = foot.querySelectorAll(".shell > *");
      if (!kids.length) kids = foot.children;
      var hasIO = (typeof io !== "undefined") && io;
      for (var i = 0; i < kids.length; i++){
        (function(el, idx){
          if (!el.classList || el.classList.contains("pv-rv")) return;
          el.classList.add("pv-rv");
          el.style.transitionDelay = Math.min(idx * 60, 240) + "ms";
          if (hasIO){
            io.observe(el);
            setTimeout(function(){
              if (!el.classList.contains("in") && !el.__pvSeen) el.classList.add("in");
            }, 2500);
          } else {
            el.classList.add("in");             /* no observer → instant, never hidden */
          }
        })(kids[i], i);
      }
    }
    window.pv3FootReveal = pv3FootReveal;

    /* renderChrome rebuilds the footer; decorate the CURRENT renderer (which is
       already the preview layer's own decorator) — never replace it. */
    var _pv3Chrome = CG.renderChrome;
    CG.renderChrome = function(){
      _pv3Chrome.apply(this, arguments);
      try {
        if (typeof pvSchedule === "function"){
          pvSchedule(function(){ pv3FootReveal(); pv3ParRefresh(); });
        } else {
          setTimeout(function(){ pv3FootReveal(); pv3ParRefresh(); }, 140);
        }
      } catch(e){}
    };

    /* ---------- boot ---------- */
    if (typeof pvSchedule === "function"){
      pvSchedule(function(){ pv3FootReveal(); pv3ParRefresh(); });
    } else {
      setTimeout(function(){ pv3FootReveal(); pv3ParRefresh(); }, 140);
    }
  })();
} catch(e){ /* pv3-scroll must never break the app */ }
})();
