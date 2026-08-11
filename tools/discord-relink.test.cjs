/* Switching Discord accounts without losing your league account.
   Run: node tools/discord-relink.test.cjs   (build index.html first)

   The real failure this pins: a member moved to a new Discord that shares the old one's email.
   The OAuth error came back as a bare #error=... fragment, the hash router 404'd it (the member's
   screenshot was literally the Icing page), the error evaporated, and the still-cached OLD session
   made it look like the site "kept logging his old Discord in". Meanwhile handle_new_user writes
   profiles.discord_id only at first-ever sign-in, so even a successful link would have left the
   guild sweep decorating the old account forever. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

const noop = () => {};
const el = () => new Proxy(function () {}, {
  get(t, k) {
    if (k === "style") return new Proxy({}, { get: () => "", set: () => true });
    if (k === "classList") return { add: noop, remove: noop, toggle: noop, contains: () => false };
    if (k === "querySelectorAll") return () => [];
    if (k === "querySelector") return () => null;
    if (k === "getAttribute") return () => null;
    if (k === "getBoundingClientRect") return () => ({ top:0,left:0,width:0,height:0,bottom:0,right:0 });
    if (k === "children" || k === "childNodes") return [];
    if (k === "parentNode" || k === "parentElement") return null;
    if (["textContent","innerHTML","value","id","className"].includes(k)) return "";
    if (k === "length") return 0;
    if (k === Symbol.toPrimitive || k === "toString") return () => "";
    return el();
  }, set: () => true, apply: () => el(),
});
let lastAppHtml = "";
const appEl = new Proxy(function () {}, {
  get(t, k) {
    if (k === "innerHTML") return lastAppHtml;
    if (k === "classList") return { add: noop, remove: noop, toggle: noop, contains: () => false };
    if (k === "addEventListener") return noop;
    if (k === "querySelectorAll") return () => [];
    if (k === Symbol.toPrimitive || k === "toString") return () => "";
    return el()[k];
  },
  set(t, k, v) { if (k === "innerHTML") lastAppHtml = String(v); return true; },
});
const doc = new Proxy(function () {}, {
  get(t, k) {
    if (k === "getElementById") return (id) => (id === "app" ? appEl : el());
    if (k === "querySelector") return (q) => (q === "#app" ? appEl : el());
    if (k === "querySelectorAll") return () => [];
    if (k === "addEventListener") return noop;
    if (k === "body") return el();
    if (k === "title") return "";
    return el()[k];
  }, set: () => true,
});
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date, Object, Array,
  String, Number, Boolean, RegExp, Error, Map, Set, WeakMap, WeakSet, Symbol, Proxy, Reflect, Intl,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
  fetch: () => Promise.resolve({ ok:true, json:()=>Promise.resolve({}), text:()=>Promise.resolve("") }),
  requestAnimationFrame: (f)=>setTimeout(f,0), cancelAnimationFrame: noop,
  MutationObserver: class { observe(){} disconnect(){} takeRecords(){return[];} },
  IntersectionObserver: class { observe(){} unobserve(){} disconnect(){} },
  ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
  performance:{ now:()=>0 }, localStorage:{ getItem:()=>null,setItem:noop,removeItem:noop },
  sessionStorage:{ getItem:()=>null,setItem:noop,removeItem:noop },
  navigator:{ userAgent:"node", language:"en-US" },
  location:{ hash:"#/", href:"https://x/", pathname:"/", search:"", origin:"https://x" },
  history:{ pushState:noop, replaceState:noop },
  matchMedia: () => ({ matches:false, addEventListener:noop, removeEventListener:noop, addListener:noop }),
  getComputedStyle: () => new Proxy({}, { get: () => "" }),
  document: doc, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Response, Request, Headers, Blob,
  addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, scrollTo:noop, alert:noop,
  innerWidth:1280, innerHeight:800, scrollY:0, devicePixelRatio:1,
  CustomEvent: class {}, Event: class {}, Element: class {}, HTMLElement: class {}, Node: class {}, SVGElement: class {},
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; ctx.top = ctx;
vm.createContext(ctx);
scripts.forEach((s) => { try { vm.runInContext(s, ctx, { timeout: 20000 }); } catch (e) { console.error("bundle threw:", e.message); process.exit(1); } });
const CG = ctx.CG;

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

CG.auth = { user: null, profile: null };
CG.role = () => "guest";
CG.renderChrome = () => {};   /* chrome needs CG.lg; not under test here */

console.log("— an OAuth ERROR fragment surfaces on the sign-in page, never a 404");
{
  ctx.location.hash = "#error=server_error&error_code=422&error_description=Identity+is+already+linked+to+another+user";
  CG.router();
  A("the 404 is gone", !/nothing at this address/i.test(lastAppHtml));
  A("the sign-in page renders instead", /Sign in with Discord/.test(lastAppHtml));
  A("...leading with the failure, in Supabase's own words",
    /Discord sign-in didn’t complete/.test(lastAppHtml) && /Identity is already linked to another user/.test(lastAppHtml));
  A("...and the identity-clash case explains the link path",
    /Switched Discord accounts\?/.test(lastAppHtml) && /Link a new Discord account/.test(lastAppHtml));
}

console.log("\n— a SUCCESS fragment shows a completing state, never a 404");
{
  CG._oauthErr = null;
  ctx.location.hash = "#access_token=eyJx&refresh_token=abc&token_type=bearer";
  CG.router();
  A("no 404", !/nothing at this address/i.test(lastAppHtml));
  A("a completing state renders while supabase lands the session", /Completing sign-in/.test(lastAppHtml));
  CG._oauthPending = false;
}

console.log("\n— signed in, the page offers the link flow");
{
  CG._oauthErr = null; ctx.location.hash = "#/signin";
  CG.auth = { user: { id: "u1" }, profile: { gamertag: "OldTag", role: "member" } };
  CG.role = () => "member";
  CG.router();
  A("the link card renders", /Switched to a new Discord account\?/.test(lastAppHtml) && /id="dcLink"/.test(lastAppHtml));
  A("...with the wrong-browser-account warning", /Not you\?/.test(lastAppHtml));
  const live = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");
  A("the button calls linkIdentity", /CG\.sb\.auth\.linkIdentity\(\{ provider:"discord"/.test(live));
  A("...surfacing a refusal verbatim (incl. manual-linking-disabled)", /Couldn’t start the link: /.test(live));
  A("the signed-out page names the discord.com cookie trap", /log out at discord\.com first/.test(live));
}

console.log("\n— the profile follows the FRESHEST Discord identity");
{
  const user = (ids) => ({ id: "u1", identities: ids });
  const idn = (pid, name, when, avatar) => ({ provider: "discord", id: pid, last_sign_in_at: when,
    identity_data: { provider_id: pid, user_name: name, avatar_url: avatar || null } });
  const OLD = idn("111", "old-name", "2026-07-01T00:00:00Z", "https://cdn.discordapp.com/avatars/111/a.png");
  const NEW = idn("222", "new-name", "2026-08-11T00:00:00Z", "https://cdn.discordapp.com/avatars/222/b.png");

  let p = CG.discordIdentityPatch(user([OLD, NEW]), { discord_id: "111", discord_username: "old-name",
    avatar_url: "https://cdn.discordapp.com/avatars/111/a.png" });
  A("a newer identity produces a patch", !!p);
  A("...moving discord_id to the new account", p.discord_id === "222");
  A("...and the username", p.discord_username === "new-name");
  A("...and the avatar, since the old one was Discord's", p.avatar_url === "https://cdn.discordapp.com/avatars/222/b.png");

  p = CG.discordIdentityPatch(user([NEW, OLD]), { discord_id: "111", discord_username: "old-name", avatar_url: null });
  A("identity order doesn't matter — recency does", p && p.discord_id === "222");

  p = CG.discordIdentityPatch(user([OLD, NEW]), { discord_id: "222", discord_username: "new-name",
    avatar_url: "https://cdn.discordapp.com/avatars/222/b.png" });
  A("an already-current profile patches nothing", p === null);

  p = CG.discordIdentityPatch(user([OLD, NEW]), { discord_id: "111", discord_username: "old-name",
    avatar_url: "https://bzbuyclwdhmhdzujxeqd.supabase.co/storage/v1/object/public/avatars/custom.webp" });
  A("a custom (supabase-hosted) avatar is never clobbered", p && !("avatar_url" in p));

  A("gamertag is deliberately untouched — it's the league name, not the Discord name",
    !("gamertag" in (CG.discordIdentityPatch(user([OLD, NEW]), { discord_id: "111", gamertag: "Keeper" }) || {})));

  p = CG.discordIdentityPatch(user([]), { discord_id: "111" });
  A("no discord identity = no patch", p === null);

  const live = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");
  A("applySession applies the patch fail-loud (checks rows came back)",
    /update\(idPatch\)\.eq\("id", uid\)\.select\("id"\)/.test(live));
  A("...and pings the sweep so the guild follows fast", /if \(CG\.pingDiscordSync\) CG\.pingDiscordSync\(\)/.test(live));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
