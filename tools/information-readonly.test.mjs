/* The Information category — the league posts, everyone reads. No member may post a message or open a
   thread in any channel under it (2026-09-13). Run: node tools/information-readonly.test.mjs
   Reconciled every sweep like #scouting-links, on the category AND each channel in it, so a channel
   added there later is locked before anyone types into it. */
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
let patched = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (m === "PATCH" && /\/channels\/[^/]+$/.test(u)) { patched.push({ id: u.split("/channels/")[1], body: JSON.parse(opts.body) }); return J({}); }
  return J({});
};
const { _internals: I } = await import(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname);
const GUILD = "guild1";
const ROLE = { commissioner: "r-comm", staff: "r-staff", player: "r-play", "not signed up": "r-nsu" };
const VIEW = 1024n, SEND = 2048n, HIST = 65536n, PUB_THREADS = 1n << 35n, PRIV_THREADS = 1n << 36n, THREAD_MSGS = 1n << 38n;
const owOf = (body, id) => (body.permission_overwrites || []).find((o) => o.id === id);
const world = () => ([
  { id: "cat-info", name: "Information", type: 4, permission_overwrites: [] },
  { id: "c-welcome", name: "welcome", type: 0, parent_id: "cat-info", permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: "0" }] },
  { id: "c-rules", name: "rules", type: 0, parent_id: "cat-info", permission_overwrites: [] },
  { id: "c-depart", name: "member-departures", type: 0, parent_id: "cat-info", permission_overwrites: [{ id: "u-muted", type: 1, allow: "0", deny: "1024" }] },
  { id: "c-news", name: "news", type: 5, parent_id: "cat-info", permission_overwrites: [] },
  { id: "cat-staff", name: "Staff", type: 4, permission_overwrites: [] },
  { id: "c-general", name: "general-chat", type: 0, parent_id: "cat-general", permission_overwrites: [] },
  { id: "c-staffroom", name: "staff-general", type: 0, parent_id: "cat-staff", permission_overwrites: [] },
]);

console.log("— every channel under Information, and the category itself, is locked");
{
  patched = [];
  const chans = world();
  await I.enforceReadOnlyCategories(chans, ROLE, { errors: [] });
  const ids = patched.map((p) => p.id).sort();
  A("the category and its four channels are patched, nothing outside it", ids.join(",") === "c-depart,c-news,c-rules,c-welcome,cat-info", ids.join(","));
  for (const p of patched) {
    const ev = owOf(p.body, GUILD);
    A(`${p.id}: @everyone sees and reads`, ev && (BigInt(ev.allow) & (VIEW | HIST)) === (VIEW | HIST));
    A(`${p.id}: ...cannot send`, ev && (BigInt(ev.deny) & SEND) === SEND);
    A(`${p.id}: ...cannot open a public or private thread, or post in one`, ev && (BigInt(ev.deny) & (PUB_THREADS | PRIV_THREADS | THREAD_MSGS)) === (PUB_THREADS | PRIV_THREADS | THREAD_MSGS));
    const cm = owOf(p.body, ROLE.commissioner);
    A(`${p.id}: commissioners can still post and open threads`, cm && (BigInt(cm.allow) & (SEND | PUB_THREADS)) === (SEND | PUB_THREADS) && BigInt(cm.deny) === 0n);
    A(`${p.id}: staff and members get no posting entry`, !owOf(p.body, ROLE.staff) && !owOf(p.body, ROLE.player) && !owOf(p.body, ROLE["not signed up"]));
  }
  const dep = patched.find((p) => p.id === "c-depart");
  A("a deliberate member overwrite (a mute) is kept", dep && owOf(dep.body, "u-muted") && owOf(dep.body, "u-muted").deny === "1024");
}
console.log("\n— a role or member allow that would reopen the room is stripped, not kept (the review's finding)");
{
  patched = [];
  const chans = world();
  const ann = { id: "c-ann", name: "announcements", type: 0, parent_id: "cat-info", permission_overwrites: [
    { id: GUILD, type: 0, allow: "66560", deny: "2048" },                 // the old creator's shape: no thread denies
    { id: ROLE.staff, type: 0, allow: "68608", deny: "0" },              // the old Staff grant: VIEW|SEND|HIST
    { id: "u-vip", type: 1, allow: String(SEND | PUB_THREADS | VIEW), deny: "0" } ] };  // a hand-added member allow
  chans.push(ann);
  await I.enforceReadOnlyCategories(chans, ROLE, { errors: [] });
  const p = patched.find((x) => x.id === "c-ann");
  A("the recreated #announcements is re-locked", !!p);
  const st = p && owOf(p.body, ROLE.staff), vip = p && owOf(p.body, "u-vip");
  A("Staff keeps its entry but loses SEND and every thread bit", st && (BigInt(st.allow) & (SEND | PUB_THREADS | PRIV_THREADS | THREAD_MSGS)) === 0n && (BigInt(st.allow) & VIEW) === VIEW);
  A("a member allow keeps VIEW but loses posting", vip && (BigInt(vip.allow) & (SEND | PUB_THREADS)) === 0n && (BigInt(vip.allow) & VIEW) === VIEW);
  patched = [];
  await I.enforceReadOnlyCategories(chans, ROLE, { errors: [] });
  A("...and the cleaned state is stable (no second patch)", patched.length === 0);
  ann.permission_overwrites = ann.permission_overwrites.map((o) => o.id === ROLE.staff ? { ...o, allow: "68608" } : o);   // someone re-grants Staff by hand
  patched = [];
  await I.enforceReadOnlyCategories(chans, ROLE, { errors: [] });
  A("a hand re-grant of posting to a role is caught on the next sweep", patched.length === 1 && (BigInt(owOf(patched[0].body, ROLE.staff).allow) & SEND) === 0n);
}
console.log("\n— the announcements creator writes the same lock");
{
  const src = (await import("fs")).readFileSync(decodeURIComponent(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname), "utf8");
  A("only the Commissioner role is granted posting on creation", /const office = \["commissioner"\]\.map/.test(src));
  A("...with the read-only category's own bitmasks", /allow: String\(INFO_EVERYONE_ALLOW\), deny: String\(INFO_EVERYONE_DENY\)/.test(src) && /allow: String\(INFO_POSTER_ALLOW\), deny: "0"/.test(src));
}

console.log("\n— already correct means no write");
{
  patched = [];
  const chans = world();
  await I.enforceReadOnlyCategories(chans, ROLE, { errors: [] });
  patched = [];
  await I.enforceReadOnlyCategories(chans, ROLE, { errors: [] });
  A("a second sweep over the same state patches nothing", patched.length === 0, String(patched.length));
}
console.log("\n— a drift is put back");
{
  patched = [];
  const chans = world();
  await I.enforceReadOnlyCategories(chans, ROLE, { errors: [] });
  const w = chans.find((c) => c.id === "c-welcome");
  w.permission_overwrites = w.permission_overwrites.map((o) => o.id === GUILD ? { ...o, deny: "0" } : o);   // someone re-opened it
  patched = [];
  await I.enforceReadOnlyCategories(chans, ROLE, { errors: [] });
  A("only the re-opened channel is re-locked", patched.length === 1 && patched[0].id === "c-welcome");
}
console.log("\n— nothing to do without the pieces");
{
  patched = [];
  await I.enforceReadOnlyCategories(world().filter((c) => c.id !== "cat-info"), ROLE, { errors: [] });
  A("no Information category → no patches", patched.length === 0);
  patched = [];
  await I.enforceReadOnlyCategories(world(), { player: "r-play" }, { errors: [] });
  A("no commissioner role yet → no patches (the lock would have no poster)", patched.length === 0);
}
A("the sweep result reports it", /infoLocked: sum\.infoLocked \|\| 0/.test((await import("fs")).readFileSync(decodeURIComponent(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname), "utf8")));
console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
