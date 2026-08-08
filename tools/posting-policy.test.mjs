// The Discord anti-spam baseline (Rule 1.3). Run: node tools/posting-policy.test.mjs
//
// Posting a LINK or an IMAGE requires a role that proves real membership; reading and chatting
// stay open. The failure this guards is subtle and already happened once for real: "Not Signed Up"
// is granted by the sweep to EVERY unlinked human within two minutes — ad accounts included — so
// if that role carries the posting bits the gate is decorative while looking correct. A role that
// is handed out automatically can never be a qualifying role.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

let patched = [];
globalThis.fetch = async (url, opts = {}) => {
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (opts.method === "PATCH" && /\/roles\//.test(String(url))) {
    patched.push({ id: String(url).split("/roles/")[1], perms: JSON.parse(opts.body).permissions });
    return J({});
  }
  if (opts.method === "PATCH" && /\/guilds\/[^/]+$/.test(String(url))) {
    patched.push({ guild: JSON.parse(opts.body) });
    return J({});
  }
  return J({});
};

const { _internals: I } = await import(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname);

const EMBED = 1n << 14n, ATTACH = 1n << 15n, INVITE = 1n << 0n;
const POST = I.POST_BITS;
/* a real league-role bitfield as found live, which ALREADY carries both posting bits */
const FULL = 2248473465704001n;
const BARE = FULL & ~EMBED & ~ATTACH & ~INVITE;
const role = (name, perms, extra = {}) => ({ id: "r-" + name, name, permissions: String(perms), managed: false, ...extra });
const TEAMS = [{ discord_role_id: "r-Canucks" }, { discord_role_id: "r-Bruins" }];
const hit = (n) => patched.find((p) => p.id === "r-" + n);
const permOf = (n) => { const h = hit(n); return h ? BigInt(h.perms) : null; };

console.log("— the trap: an auto-granted role must never qualify");
{
  patched = [];
  const roles = [role("Not Signed Up", FULL)];
  await I.enforcePostingPolicy(roles, TEAMS, { errors: [] });
  A("Not Signed Up is stripped", !!hit("Not Signed Up"));
  A("...of embed", (permOf("Not Signed Up") & EMBED) === 0n);
  A("...of attach", (permOf("Not Signed Up") & ATTACH) === 0n);
  A("...and of invite creation", (permOf("Not Signed Up") & INVITE) === 0n);
  A("...while its other permissions survive", (permOf("Not Signed Up") & ~POST & ~INVITE) === (FULL & ~POST & ~INVITE));
  A("it is not in the allow-list by name", !I.POST_ALLOW_STATIC.includes("not signed up"));
  A("...it is explicitly in the DENY list", I.POST_DENY.has("not signed up"));
}

console.log("\n— @everyone loses posting rights and invite creation");
{
  patched = [];
  const ev = { id: "guild1", name: "@everyone", permissions: String(FULL), managed: false };
  await I.enforcePostingPolicy([ev], TEAMS, { errors: [] });
  const p = patched.find((x) => x.id === "guild1");
  A("@everyone is patched", !!p);
  A("...embed gone", (BigInt(p.perms) & EMBED) === 0n);
  A("...attach gone", (BigInt(p.perms) & ATTACH) === 0n);
  A("...invite gone", (BigInt(p.perms) & INVITE) === 0n);
}

console.log("\n— roles that prove registration are GRANTED, not stripped");
{
  patched = [];
  const roles = [role("Player", BARE), role("Free Agent", BARE), role("Commissioner", BARE),
                 role("Goalie", BARE), role("Officials", BARE), role("Canucks", BARE)];
  await I.enforcePostingPolicy(roles, TEAMS, { errors: [] });
  for (const n of ["Player", "Free Agent", "Commissioner", "Goalie", "Officials", "Canucks"]) {
    A(`${n} gains posting rights`, !!hit(n) && (permOf(n) & POST) === POST);
  }
  A("a club role is matched by ID, not by name", !!hit("Canucks"));
}

console.log("\n— it is idempotent, and leaves everything else alone");
{
  patched = [];
  const sum = { errors: [] };
  await I.enforcePostingPolicy([role("Player", FULL), role("Not Signed Up", BARE)], TEAMS, sum);
  A("an already-correct server needs no writes", patched.length === 0);
  A("...and reports nothing changed", !sum.postingStripped && !sum.postingGranted);

  patched = [];
  await I.enforcePostingPolicy([role("Chel Gaming", FULL, { managed: true })], TEAMS, { errors: [] });
  A("managed integration roles are never touched", patched.length === 0);

  patched = [];
  await I.enforcePostingPolicy([role("Some Custom Role", BARE)], TEAMS, { errors: [] });
  A("an unknown role is neither granted nor stripped", patched.length === 0);
}

console.log("\n— counters are honest");
{
  patched = [];
  const sum = { errors: [] };
  await I.enforcePostingPolicy(
    [role("Not Signed Up", FULL), role("Player", BARE), role("Free Agent", BARE)], TEAMS, sum);
  A("one strip counted", sum.postingStripped === 1, String(sum.postingStripped));
  A("two grants counted", sum.postingGranted === 2, String(sum.postingGranted));
  A("no errors", sum.errors.length === 0);
}

console.log("\n— the join gate is re-asserted but never loosened");
{
  patched = [];
  let sum = { errors: [] };
  await I.enforceVerificationLevel({ verification_level: 1 }, sum);
  A("LOW is raised to HIGH", patched.length === 1 && patched[0].guild.verification_level === I.MIN_VERIFICATION_LEVEL);
  A("...and reported", /1 -> 3/.test(String(sum.verificationRaised)));

  patched = []; sum = { errors: [] };
  await I.enforceVerificationLevel({ verification_level: 3 }, sum);
  A("already-HIGH is a no-op", patched.length === 0 && !sum.verificationRaised);

  patched = []; sum = { errors: [] };
  await I.enforceVerificationLevel({ verification_level: 4 }, sum);
  A("VERY HIGH is never lowered back", patched.length === 0);
}

console.log("\n— wired into the sweep after its bindings exist");
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  const lines = src.split("\n");
  const sumLine = lines.findIndex((l) => /^\s*const sum = \{/.test(l));
  const teamsLine = lines.findIndex((l) => /^\s*const teams = await sbGet\("teams\?/.test(l));
  const callLine = lines.findIndex((l) => /await enforcePostingPolicy\(/.test(l));
  A("the guard is called by the sweep", callLine > -1);
  A("...after `sum` is declared (the TDZ lesson)", callLine > sumLine, `sum ${sumLine + 1}, call ${callLine + 1}`);
  A("...and after `teams` is fetched", callLine > teamsLine, `teams ${teamsLine + 1}, call ${callLine + 1}`);
  A("the result reports what it corrected", /postingStripped: sum\.postingStripped/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
