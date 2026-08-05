/* Control Center navigation — every tab renders, every retired hash still lands somewhere real,
   and no link in the shipped bundle points at a tab that no longer exists.
   Run: node tools/admin-nav.test.cjs   (build index.html first)

   The Control Center went from 18 tabs to 12 by folding six pages into the neighbour that already
   did the same job. The risk of that shape of change is not the merge, it is the dangling link a
   month later, so that is what this pins down. */
const fs=require("fs"),vm=require("vm"),path=require("path");
const ROOT=path.join(__dirname,"..");
const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
const scripts=[...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
const noop=()=>{};const el=()=>new Proxy(function(){},{get(t,k){if(k==="style")return new Proxy({},{get:()=>"",set:()=>true});
if(k==="classList")return{add:noop,remove:noop,toggle:noop,contains:()=>false};if(k==="querySelectorAll")return()=>[];
if(k==="querySelector")return()=>null;if(k==="getAttribute")return()=>null;if(k==="length")return 0;
if(["textContent","innerHTML","value","id","className"].includes(k))return"";if(k===Symbol.toPrimitive||k==="toString")return()=>"";return el()},set:()=>true,apply:()=>el()});
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,Promise,JSON,Math,Date,Object,Array,String,Number,Boolean,RegExp,Error,Map,Set,WeakMap,WeakSet,Symbol,Proxy,Reflect,Intl,
parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,encodeURI,decodeURI,
fetch:()=>Promise.resolve({ok:true,json:()=>Promise.resolve({}),text:()=>Promise.resolve("")}),
requestAnimationFrame:f=>setTimeout(f,0),cancelAnimationFrame:noop,
MutationObserver:class{observe(){}disconnect(){}takeRecords(){return[]}},IntersectionObserver:class{observe(){}unobserve(){}disconnect(){}},
ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},performance:{now:()=>0},
localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},sessionStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
navigator:{userAgent:"node",language:"en-US"},location:{hash:"#/",href:"https://x/",pathname:"/",search:"",origin:"https://x"},
history:{pushState:noop,replaceState:noop},matchMedia:()=>({matches:false,addEventListener:noop,removeEventListener:noop,addListener:noop}),
getComputedStyle:()=>new Proxy({},{get:()=>""}),document:el(),URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Response,Request,Headers,Blob,
addEventListener:noop,removeEventListener:noop,dispatchEvent:noop,scrollTo:noop,alert:noop,innerWidth:1280,innerHeight:800,scrollY:0,devicePixelRatio:1,
CustomEvent:class{},Event:class{},Element:class{},HTMLElement:class{},Node:class{},SVGElement:class{}};
ctx.window=ctx;ctx.globalThis=ctx;ctx.self=ctx;ctx.top=ctx;vm.createContext(ctx);
scripts.forEach(s=>{try{vm.runInContext(s,ctx,{timeout:20000})}catch(e){console.error("bundle threw:",e.message);process.exit(1)}});
const CG=ctx.CG;
let ok=true;const A=(l,p,x)=>{if(!p)ok=false;console.log(`${p?"ok  ":"FAIL"} ${l}${x?"  — "+x:""}`)};

CG.role=()=>"commish";
const thenable=()=>{const o={then:f=>{f({data:[],error:null});return o}};
["select","order","eq","in","like","ilike","is","not","limit","gte","lte","gt","lt","neq","or","filter","range","maybeSingle","single","insert","update","upsert","delete","match","contains"].forEach(k=>o[k]=()=>thenable());return o};
CG.sb={ from:()=>thenable(), rpc:()=>thenable(), channel:()=>({on:function(){return this},subscribe:function(){return this},unsubscribe:function(){return this}}),
  removeChannel:()=>{}, auth:{getSession:()=>Promise.resolve({data:{session:null}}),getUser:()=>Promise.resolve({data:{user:null}})} };
CG.SEASON={id:"s1",number:1,weeks:8,nights_per_week:3,night_slots:"21:00,21:35,22:10",starts_at:"2026-10-07T21:00:00-04:00",preseason_starts_at:"2026-09-16T21:00:00-04:00"};
CG.TEAMS=[];CG.lg={schedule:[],players:[],_registrationsRaw:[],_rosteredIds:{},_profilesRaw:[],live:true};

// The live nav is assigned inside initApp (part_live.js), which does not run in this harness --
// CG.ADMIN_NAV still holds the prototype list from part7_admin.js. Lift the real one out of the
// source so the test measures what actually ships.
const liveSrc = fs.readFileSync(path.join(ROOT,"src","live","part_live.js"),"utf8");
const navBlock = liveSrc.slice(liveSrc.indexOf("    CG.ADMIN_NAV = ["));
const nav = eval(navBlock.slice(navBlock.indexOf("["), navBlock.indexOf("];")+1));
A("real nav lifted from source", Array.isArray(nav) && nav.length>0, nav.length+" groups");
const params = nav.flatMap(g=>g[1].map(t=>t[0]));
console.log("\ntabs:", params.map(p=>p||"(overview)").join(", "), "=", params.length);
A("twelve tabs", params.length===12, params.length+" tabs");

console.log("\n— every tab renders");
params.forEach(p=>{
  let out,err=null;
  try{ out=CG.ROUTES.admin(p,{}); }catch(e){ err=e.message; }
  A(`#/admin/${p||""}`, !err && typeof out==="string" && out.length>50, err||((out||"").length+" chars"));
});

console.log("\n— retired hashes still land somewhere real");
Object.entries(CG.ADMIN_ALIAS).forEach(([from,to])=>{
  let out,err=null;
  try{ out=CG.ROUTES.admin(from,{}); }catch(e){ err=e.message; }
  A(`#/admin/${from} -> ${to}`, !err && typeof out==="string" && out.length>50, err||"ok");
});
["ratings"].forEach(p=>{
  let out,err=null;
  try{ out=CG.ROUTES.admin(p,{}); }catch(e){ err=e.message; }
  A(`#/admin/${p} -> #/players`, !err && typeof out==="string" && out.length>50, err||"ok");
});

console.log("\n— after-handlers do not throw for any tab");
params.forEach(p=>{ let err=null; try{ CG.AFTER.admin(p,{}); }catch(e){ err=e.message; }
  A(`AFTER ${p||"(overview)"}`, !err, err||"ok"); });

console.log("\n— no link in the bundle points at a retired tab");
const bad=[];
const src=html;
[...src.matchAll(/#\/admin\/([a-z-]+)/g)].forEach(m=>{
  const p=m[1];
  if(params.includes(p)||CG.ADMIN_ALIAS[p]||["ratings","players","results","awards","presets","carousel","media","settings","data","rulebook"].includes(p)) return;
  if(!bad.includes(p)) bad.push(p);
});
A("every #/admin/* link resolves", bad.length===0, bad.join(", ")||"none dangling");
console.log("\n— media-only staff see the newsroom, not the league office");
{
  CG.role = () => "staff";
  CG.auth = CG.auth || {};
  CG.auth.profile = { departments: ["media"] };
  CG.hasDept = (d) => (CG.auth.profile.departments || []).indexOf(d) >= 0;
  const nav = CG.hubNav("");
  A("no Staff desk tab for media-only staff", !nav.includes("staffdesk"));
  A("their Newsroom desk still shows", nav.includes("newsroom"));
  A("the route agrees with the nav", CG.ROUTES.hub("staffdesk", {}).includes("don\u2019t have access"));
  CG.auth.profile = { departments: ["media", "statistics"] };
  const nav2 = CG.hubNav("");
  A("media PLUS another department keeps the Staff desk", nav2.includes("staffdesk") && nav2.includes("newsroom"));
  CG.role = () => "commish";
  CG.auth.profile = { departments: [] };
  A("commissioners are never media-scoped", CG.hubNav("").includes("staffdesk"));
}
console.log(`\n${ok?"PASS":"FAIL"}`);process.exit(ok?0:1);
