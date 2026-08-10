/* Signed-up members may post links; the not-signed-up may not.
   Run: node tools/automod-exempt.test.mjs

   AutoMod's "Block invite links" rule exempted only Commissioner and Staff, so a club owner posting
   their own team's Discord with a scouting note was blocked — as was every ordinary member. AutoMod
   has no deny-list: exempt_roles is the only lever and it is capped at 20 while the guild carries
   33+ roles, so "exempt everything" is not an option. The eight roles below are the exact cover of
   "everyone except Not Signed Up", and this fails if that set is narrowed or the reconciliation
   stops running. */
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

let rules, patched;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.includes("/auto-moderation/rules")) {
    if (m === "GET") return J(rules);
    if (m === "PATCH") { patched.push({ id: u.split("/rules/")[1], body: JSON.parse(opts.body) }); return J({}); }
  }
  return J({});
};

const { _internals: I } = await import(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname);

/* every role the sweep can provision, so a narrowed exempt set is visible */
const ROLE = {};
["commissioner","staff","player","free agent","owner","general manager","assistant general manager",
 "media","not signed up","goalie","center","officials","canucks"].forEach((n, i) => { ROLE[n] = "r" + i; });
const idsFor = (names) => names.map((n) => ROLE[n]);
/* both rules the reconciler walks; the ads rule is here so a "missing rule" report stays honest */
const rule = (exempt) => ([
  { id: "AM1", name: "Block invite links", exempt_roles: exempt, exempt_channels: [] },
  { id: "AM2", name: "Ad + scam keywords", exempt_roles: [], exempt_channels: [] },
]);
/* channel exemptions are covered by tools/scouting-board.test.mjs — an empty channel list keeps
   this file about the ROLE cover, and makes the reconciler skip the channel branch entirely */
const NO_CHANS = [];

console.log("— the exempt set is exactly 'everyone except Not Signed Up'");
{
  A("Not Signed Up is NOT exempt", !I.AUTOMOD_EXEMPT.includes("not signed up"));
  for (const n of ["player", "free agent", "owner", "general manager", "assistant general manager",
                   "commissioner", "staff", "media"]) {
    A(`${n} is exempt`, I.AUTOMOD_EXEMPT.includes(n));
  }
  A("...and it stays inside Discord's 20-role cap", I.AUTOMOD_EXEMPT.length <= 20,
    String(I.AUTOMOD_EXEMPT.length));
  /* club and position roles are deliberately absent: those members already hold Player, and adding
     one role per club would grow the list into the cap as the league expands */
  A("club roles are not listed (Player already covers them)", !I.AUTOMOD_EXEMPT.includes("canucks"));
  A("position roles are not listed either", !I.AUTOMOD_EXEMPT.includes("goalie"));
}

console.log("\n— it adds what is missing and leaves a correct rule alone");
{
  rules = rule(idsFor(["commissioner", "staff"])); patched = [];
  let sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  A("a rule exempting only the office is patched", patched.length === 1);
  const got = new Set(patched[0].body.exempt_roles);
  for (const n of I.AUTOMOD_EXEMPT) A(`...${n} added`, got.has(ROLE[n]));
  A("...and Not Signed Up is never added", !got.has(ROLE["not signed up"]));
  A("six were missing and it says so", sum.automodExempted === 6, String(sum.automodExempted));

  rules = rule(idsFor(I.AUTOMOD_EXEMPT)); patched = []; sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  A("an already-correct rule needs no write", patched.length === 0);
  A("...and reports nothing changed", !sum.automodExempted);
}

console.log("\n— it never removes an exemption someone added by hand");
{
  const extra = "r-custom";
  rules = rule([extra]); patched = [];
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, { errors: [] });
  A("a hand-added role survives the reconcile", patched[0].body.exempt_roles.includes(extra));
  A("...alongside the eight", I.AUTOMOD_EXEMPT.every((n) => patched[0].body.exempt_roles.includes(ROLE[n])));
  A("...with no duplicates", new Set(patched[0].body.exempt_roles).size === patched[0].body.exempt_roles.length);
}

console.log("\n— it degrades safely");
{
  rules = []; patched = [];
  let sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  A("a missing rule is reported, not thrown",
    patched.length === 0 && String(sum.automodMissing || "").includes(I.AUTOMOD_LINK_RULE),
    String(sum.automodMissing));

  rules = rule([]); patched = []; sum = { errors: [] };
  await I.enforceAutomodExemptions({}, NO_CHANS, sum);
  A("no provisioned roles yet = no write", patched.length === 0);
  A("...and no error either — the next sweep retries", sum.errors.length === 0);
}

console.log("\n— reconciled by NAME every sweep, not left as hand-entered ids");
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  A("the sweep calls it", /await enforceAutomodExemptions\(roleId, guildChannels, sum\)/.test(src));
  A("...resolving ids from role NAMES", /AUTOMOD_EXEMPT\.map\(\(n\) => roleId\[n\]\)/.test(src));
  const lines = src.split("\n");
  const sumLine = lines.findIndex((l) => /^\s*const sum = \{/.test(l));
  const roleIdLine = lines.findIndex((l) => /^\s*const roleId = \{\};/.test(l));
  const callLine = lines.findIndex((l) => /await enforceAutomodExemptions\(/.test(l));
  A("...after `sum` is declared (the TDZ lesson)", callLine > sumLine, `sum ${sumLine + 1}, call ${callLine + 1}`);
  A("...and after `roleId` is built", callLine > roleIdLine, `roleId ${roleIdLine + 1}, call ${callLine + 1}`);
  A("the result reports what it corrected", /automodExempted: sum\.automodExempted/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
