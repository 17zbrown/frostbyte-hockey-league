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

let rules, patched, created;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.includes("/auto-moderation/rules")) {
    if (m === "GET") return J(rules);
    if (m === "PATCH") { patched.push({ id: u.split("/rules/")[1], body: JSON.parse(opts.body) }); return J({}); }
    if (m === "POST") { const b = JSON.parse(opts.body); created.push(b); return J({ ...b, id: "AM-NEW" }); }
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
  { id: "AM1", name: "Block invite links", exempt_roles: exempt, exempt_channels: [],
    actions: [{ type: 1 }, { type: 2, metadata: { channel_id: "chan-logs" } }] },
  { id: "AM2", name: "Ad + scam keywords", exempt_roles: [], exempt_channels: [] },
  { id: "AM3", name: "Links require registration", exempt_roles: exempt, exempt_channels: [],
    trigger_metadata: { regex_patterns: [I.AUTOMOD_URL_REGEX], allow_list: [...I.AUTOMOD_URL_ALLOW] } },
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
  rules = rule(idsFor(["commissioner", "staff"])); patched = []; created = [];
  let sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  A("both gated rules (invite + URL gate) are patched", patched.length === 2, String(patched.length));
  const got = new Set(patched[0].body.exempt_roles);
  for (const n of I.AUTOMOD_EXEMPT) A(`...${n} added`, got.has(ROLE[n]));
  A("...and Not Signed Up is never added", !got.has(ROLE["not signed up"]));
  A("six missing on each of the two gated rules — twelve counted", sum.automodExempted === 12, String(sum.automodExempted));

  rules = rule(idsFor(I.AUTOMOD_EXEMPT)); patched = []; created = []; sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  A("an already-correct rule needs no write", patched.length === 0);
  A("...and reports nothing changed", !sum.automodExempted);
}

console.log("\n— the exempt set is EXACT: a hand-added exemption is pruned and counted (2026-09-17)");
{
  /* the reconciler used to be union-only, so a role quietly exempted from the link gate in the UI
     — a role that can then post ads — stayed forever with nothing to say so */
  const extra = "r-custom";
  rules = rule([extra]); patched = []; created = [];
  let sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  A("a hand-added role is removed from the gated rules", patched.every((p) => !p.body.exempt_roles.includes(extra)));
  A("...leaving exactly the eight", patched.every((p) => p.body.exempt_roles.length === I.AUTOMOD_EXEMPT.length && I.AUTOMOD_EXEMPT.every((n) => p.body.exempt_roles.includes(ROLE[n]))));
  A("...with no duplicates", new Set(patched[0].body.exempt_roles).size === patched[0].body.exempt_roles.length);
  A("...and the removals are counted (one per gated rule)", sum.automodPruned === 2, String(sum.automodPruned));
  A("...while the additions are counted separately", sum.automodExempted === 16, String(sum.automodExempted));

  /* the ad/scam rule stays on for everyone: a role exempted from it by hand is pruned too */
  rules = rule(idsFor(I.AUTOMOD_EXEMPT)); rules[1].exempt_roles = [ROLE.player]; patched = []; sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  const ads = patched.find((p) => p.id === "AM2");
  A("a role exempted from the ad/scam rule by hand is pruned", !!ads && ads.body.exempt_roles.length === 0);
  A("...and counted", sum.automodPruned === 1, String(sum.automodPruned));

  /* channels are exact too: a hand-exempted channel on the URL gate does not survive */
  rules = rule(idsFor(I.AUTOMOD_EXEMPT)); rules[2].exempt_channels = ["chan-hand"]; patched = []; sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  const url = patched.find((p) => p.id === "AM3");
  A("a hand-exempted channel on the URL gate is pruned", !!url && url.body.exempt_channels.length === 0);
  A("...counted as a prune, not an addition", sum.automodPruned === 1 && !sum.automodChannels);
}

console.log("\n— it degrades safely");
{
  rules = []; patched = []; created = [];
  let sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  A("a missing rule is reported, not thrown",
    patched.length === 0 && String(sum.automodMissing || "").includes(I.AUTOMOD_LINK_RULE),
    String(sum.automodMissing));

  rules = rule([]); patched = []; created = []; sum = { errors: [] };
  await I.enforceAutomodExemptions({}, NO_CHANS, sum);
  A("no provisioned roles yet = no write", patched.length === 0);
  A("...and no error either — the next sweep retries", sum.errors.length === 0);
}

console.log("\n— a club's management may @ whatever it wants in its own room (2026-09-15)");
{
  ROLE["cghl management"] = "r-mgmt";
  const mention = (exempt, chans) => ([
    ...rule(idsFor(I.AUTOMOD_EXEMPT)),
    { id: "AM4", name: I.AUTOMOD_SPAM_RULE, exempt_roles: exempt, exempt_channels: [] },
    { id: "AM5", name: I.AUTOMOD_MENTION_RULE, exempt_roles: exempt, exempt_channels: chans },
  ]);
  const TEAMS = [{ id: "t1", discord_channel_id: "room-bos" }, { id: "t2", discord_channel_id: "room-dal" }, { id: "t3", discord_channel_id: null }];
  rules = mention(idsFor(["commissioner", "staff"]), []); patched = []; created = [];
  let sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum, TEAMS);
  const spam = patched.find((x) => x.id === "AM4"), ment = patched.find((x) => x.id === "AM5");
  A("the Spam content rule is patched", !!spam);
  for (const n of I.AUTOMOD_MGMT_EXEMPT) A(`...${n} exempt from Spam content`, spam && spam.body.exempt_roles.includes(ROLE[n]));
  A("...commissioner and staff still exempt (part of the declared set, so exactness cannot prune them)", spam && spam.body.exempt_roles.includes(ROLE.commissioner) && spam.body.exempt_roles.includes(ROLE.staff));
  A("...the office is declared, not inherited", JSON.stringify(I.AUTOMOD_OFFICE) === JSON.stringify(["commissioner", "staff"]));
  A("...players are NOT exempt from Spam content", spam && !spam.body.exempt_roles.includes(ROLE.player));
  A("the Mention spam rule is patched", !!ment);
  for (const n of I.AUTOMOD_MGMT_EXEMPT) A(`...${n} exempt from Mention spam`, ment && ment.body.exempt_roles.includes(ROLE[n]));
  A("...every club room is exempt from Mention spam", ment && ment.body.exempt_channels.includes("room-bos") && ment.body.exempt_channels.includes("room-dal"));
  A("...a club with no room adds nothing", ment && !ment.body.exempt_channels.includes(null) && ment.body.exempt_channels.length === 2);
  A("...club rooms are NOT exempted from Spam content (generic spam stays gated for the rest of the room)", !spam.body.exempt_channels);
  {
    /* Player exempted from both mention-shaped rules by hand: pruned from each, counted twice */
    rules = mention(idsFor(["commissioner", "staff", ...I.AUTOMOD_MGMT_EXEMPT, "player"]), ["room-bos", "room-dal"]); patched = [];
    const s2 = { errors: [] };
    await I.enforceAutomodExemptions(ROLE, NO_CHANS, s2, TEAMS);
    const m2 = patched.find((x) => x.id === "AM5"), sp2 = patched.find((x) => x.id === "AM4");
    A("...and a member role exempted from Mention spam by hand is pruned", !!m2 && !m2.body.exempt_roles.includes(ROLE.player));
    A("...and from Spam content", !!sp2 && !sp2.body.exempt_roles.includes(ROLE.player));
    A("...the office and the front office untouched", [m2, sp2].every((x) => x && [ROLE.commissioner, ROLE.staff, ...idsFor(I.AUTOMOD_MGMT_EXEMPT)].every((id) => x.body.exempt_roles.includes(id))));
    A("...two prunes counted", s2.automodPruned === 2, String(s2.automodPruned));
  }
  A("counted", sum.automodMgmtExempted === I.AUTOMOD_MGMT_EXEMPT.length * 2, String(sum.automodMgmtExempted));

  rules = mention(idsFor(["commissioner", "staff", ...I.AUTOMOD_MGMT_EXEMPT]), ["room-bos", "room-dal"]); patched = []; created = []; sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum, TEAMS);
  A("an already-correct pair needs no write", !patched.find((x) => x.id === "AM4" || x.id === "AM5"));

  rules = mention(idsFor(["commissioner", "staff"]), []); patched = []; sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  A("with no teams passed, roles are still exempted and no channel is invented", !!patched.find((x) => x.id === "AM4") && !(patched.find((x) => x.id === "AM5") || {}).body?.exempt_channels);
  A("the four exempt roles are exactly the front office", JSON.stringify(I.AUTOMOD_MGMT_EXEMPT) === JSON.stringify(["owner","general manager","assistant general manager","cghl management"]));
}

console.log("\n— reconciled by NAME every sweep, not left as hand-entered ids");
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  A("the sweep calls it, passing the club rooms", /await enforceAutomodExemptions\(roleId, guildChannels, sum, teams\)/.test(src));
  A("...resolving ids from role NAMES", /AUTOMOD_EXEMPT\.map\(\(n\) => roleId\[n\]\)/.test(src));
  const lines = src.split("\n");
  const sumLine = lines.findIndex((l) => /^\s*const sum = \{/.test(l));
  const roleIdLine = lines.findIndex((l) => /^\s*const roleId = \{\};/.test(l));
  const callLine = lines.findIndex((l) => /await enforceAutomodExemptions\(/.test(l));
  A("...after `sum` is declared (the TDZ lesson)", callLine > sumLine, `sum ${sumLine + 1}, call ${callLine + 1}`);
  A("...and after `roleId` is built", callLine > roleIdLine, `roleId ${roleIdLine + 1}, call ${callLine + 1}`);
  A("the result reports what it corrected", /automodExempted: sum\.automodExempted/.test(src));
}

console.log("\n— the URL gate: created by the sweep, GIFs allow-listed, self-healing");
{
  /* missing entirely -> created with the exemptions, the regex, the GIF allow-list, and the
     invite rule's own alert channel */
  rules = [{ id: "AM1", name: "Block invite links", exempt_roles: idsFor(I.AUTOMOD_EXEMPT), exempt_channels: [],
             actions: [{ type: 1 }, { type: 2, metadata: { channel_id: "chan-logs" } }] },
           { id: "AM2", name: "Ad + scam keywords", exempt_roles: [], exempt_channels: [] }];
  patched = []; created = [];
  let sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  A("a missing URL gate is created, not just reported", created.length === 1 && sum.automodCreated === I.AUTOMOD_URL_RULE);
  const c = created[0] || {};
  A("...blocking messages", (c.actions || []).some((a) => a.type === 1));
  A("...alerting where the invite rule alerts",
    (c.actions || []).some((a) => a.type === 2 && a.metadata && a.metadata.channel_id === "chan-logs"));
  A("...with the URL regex", ((c.trigger_metadata || {}).regex_patterns || []).includes(I.AUTOMOD_URL_REGEX));
  A("...every GIF provider allow-listed from birth",
    I.AUTOMOD_URL_ALLOW.every((a) => ((c.trigger_metadata || {}).allow_list || []).includes(a)));
  /* Klipy is pinned by name: Discord moved picker results from Tenor to Klipy, and a member's GIF
     was blocked as klipy.com/gifs/... before it was listed (#bot-logs 2026-08-11) */
  A("...including Klipy, the provider that got a member's GIF blocked",
    I.AUTOMOD_URL_ALLOW.includes("*klipy.com/*"));
  A("...and the eight signed-up roles exempt from birth",
    I.AUTOMOD_EXEMPT.every((n) => (c.exempt_roles || []).includes(ROLE[n])));
  A("Not Signed Up is NOT exempt from the gate", !(c.exempt_roles || []).includes(ROLE["not signed up"]));

  /* someone hand-removes tenor from the allow-list -> healed, additions preserved */
  rules = rule(idsFor(I.AUTOMOD_EXEMPT));
  rules[2].trigger_metadata = { regex_patterns: [I.AUTOMOD_URL_REGEX], allow_list: ["*giphy.com/*", "*clips.twitch.tv/*"] };
  patched = []; created = []; sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  const heal = patched.find((x) => x.id === "AM3");
  A("a removed GIF domain heals back", !!heal && heal.body.trigger_metadata.allow_list.includes("*tenor.com/*"));
  A("...keeping a hand-added allowance", heal.body.trigger_metadata.allow_list.includes("*clips.twitch.tv/*"));
  A("...and the regex stays", heal.body.trigger_metadata.regex_patterns.includes(I.AUTOMOD_URL_REGEX));

  /* fully correct -> zero writes, zero creations */
  rules = rule(idsFor(I.AUTOMOD_EXEMPT));
  patched = []; created = []; sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, NO_CHANS, sum);
  A("a correct gate needs no write and no re-create", patched.length === 0 && created.length === 0);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
