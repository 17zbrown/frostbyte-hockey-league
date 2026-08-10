/* #scouting-links — the whole league reads it, only club management posts in it.
   Run: node tools/scouting-board.test.mjs

   Club owners recruit by posting their club's Discord. That needs three things to line up, and any
   one of them silently breaks the channel: @everyone must be able to SEE it but not write in it,
   management must be able to write in it, and AutoMod must not eat the invite link (or the ordinary
   recruiting copy around it — "dm me for" is on the ad/scam keyword list).

   The channel is NOT covered by the three existing overwrite sweeps (trade-block/free-agency, club
   rooms, staff categories), so without its own reconciler a hand-set audience drifts the moment
   anyone edits it in the UI. */
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

let patched, rules;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.includes("/auto-moderation/rules")) {
    if (m === "GET") return J(rules);
    if (m === "PATCH") { patched.push({ kind: "automod", id: u.split("/rules/")[1], body: JSON.parse(opts.body) }); return J({}); }
  }
  if (m === "PATCH" && /\/channels\/[^/]+$/.test(u)) {
    patched.push({ kind: "channel", id: u.split("/channels/")[1], body: JSON.parse(opts.body) }); return J({});
  }
  return J({});
};

const { _internals: I } = await import(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname);

const GUILD = "guild1";
const ROLE = { owner: "r-own", "general manager": "r-gm", "assistant general manager": "r-agm",
  commissioner: "r-comm", staff: "r-staff", player: "r-play", "free agent": "r-fa", media: "r-media",
  "not signed up": "r-nsu" };
const VIEW = 1024n, SEND = 2048n, HIST = 65536n, EMBED = 16384n, ATTACH = 32768n;
const chan = (ow = []) => ([{ id: "c-scout", name: "scouting-links", type: 0, permission_overwrites: ow }]);
const owOf = (body, id) => (body.permission_overwrites || []).find((o) => o.id === id);

console.log("— the board is readable by everyone and writable only by management");
{
  patched = [];
  await I.enforcePostOnlyBoards(chan(), ROLE, { errors: [] });
  A("an unconfigured channel is patched", patched.length === 1 && patched[0].kind === "channel");
  const ev = owOf(patched[0].body, GUILD);
  A("@everyone can see it", (BigInt(ev.allow) & VIEW) === VIEW);
  A("...and read its history", (BigInt(ev.allow) & HIST) === HIST);
  A("...but cannot post", (BigInt(ev.deny) & SEND) === SEND);
  for (const [label, rid] of [["Owner", ROLE.owner], ["GM", ROLE["general manager"]], ["AGM", ROLE["assistant general manager"]]]) {
    const o = owOf(patched[0].body, rid);
    A(`${label} can post`, o && (BigInt(o.allow) & SEND) === SEND);
    A(`...${label} can post a link and an image`, o && (BigInt(o.allow) & (EMBED | ATTACH)) === (EMBED | ATTACH));
    A(`...${label} is denied nothing`, o && BigInt(o.deny) === 0n);
  }
  A("ordinary members are not granted posting by some other entry",
    !owOf(patched[0].body, ROLE.player) && !owOf(patched[0].body, ROLE["not signed up"]));
}

console.log("\n— it is idempotent, and preserves overwrites it did not set");
{
  patched = [];
  const correct = [
    { id: GUILD, type: 0, allow: "66560", deny: "2048" },
    { id: ROLE.owner, type: 0, allow: "51200", deny: "0" },
    { id: ROLE["general manager"], type: 0, allow: "51200", deny: "0" },
    { id: ROLE["assistant general manager"], type: 0, allow: "51200", deny: "0" },
  ];
  const sum = { errors: [] };
  await I.enforcePostOnlyBoards(chan(correct), ROLE, sum);
  A("an already-correct board needs no write", patched.length === 0);
  A("...and reports nothing changed", !sum.boardsLocked);

  patched = [];
  const muted = { id: "u-muted", type: 1, allow: "0", deny: "2048" };
  await I.enforcePostOnlyBoards(chan([...correct.slice(0, 1), muted]), ROLE, { errors: [] });
  A("a muted member's overwrite survives the repair",
    !!owOf(patched[0].body, "u-muted") && owOf(patched[0].body, "u-muted").deny === "2048");
}

console.log("\n— a tampered board is repaired");
{
  patched = [];
  /* the exact drift that matters: someone lets @everyone post */
  await I.enforcePostOnlyBoards(chan([{ id: GUILD, type: 0, allow: "68608", deny: "0" }]), ROLE, { errors: [] });
  A("@everyone being able to post is corrected", (BigInt(owOf(patched[0].body, GUILD).deny) & SEND) === SEND);
  A("...and the allow no longer carries SEND", (BigInt(owOf(patched[0].body, GUILD).allow) & SEND) === 0n);

  patched = [];
  /* and the opposite: someone hides the channel from the league */
  await I.enforcePostOnlyBoards(chan([{ id: GUILD, type: 0, allow: "0", deny: "1024" }]), ROLE, { errors: [] });
  A("a hidden board is made visible again", (BigInt(owOf(patched[0].body, GUILD).allow) & VIEW) === VIEW);
  A("...and VIEW is no longer denied", (BigInt(owOf(patched[0].body, GUILD).deny) & VIEW) === 0n);
}

console.log("\n— AutoMod lets the recruitment post through IN THAT CHANNEL");
{
  rules = [{ id: "AM1", name: I.AUTOMOD_LINK_RULE, exempt_roles: [], exempt_channels: [] },
           { id: "AM2", name: I.AUTOMOD_ADS_RULE, exempt_roles: [], exempt_channels: [] }];
  patched = [];
  const sum = { errors: [] };
  await I.enforceAutomodExemptions(ROLE, chan(), sum);
  const link = patched.find((p) => p.id === "AM1"), ads = patched.find((p) => p.id === "AM2");
  A("the invite rule exempts the channel", link && link.body.exempt_channels.includes("c-scout"));
  A("...and still exempts the signed-up roles", link && link.body.exempt_roles.includes(ROLE.owner));
  A("the ad/scam rule exempts the channel", ads && ads.body.exempt_channels.includes("c-scout"));
  A("...but the ad/scam rule is NOT loosened by role for the rest of the server",
    ads && !("exempt_roles" in ads.body));
  A("both channel exemptions are counted", sum.automodChannels === 2, String(sum.automodChannels));

  patched = [];
  rules = [{ id: "AM1", name: I.AUTOMOD_LINK_RULE, exempt_roles: Object.values(ROLE).filter((r) => r !== ROLE["not signed up"]), exempt_channels: ["c-scout"] },
           { id: "AM2", name: I.AUTOMOD_ADS_RULE, exempt_roles: [], exempt_channels: ["c-scout"] }];
  await I.enforceAutomodExemptions(ROLE, chan(), { errors: [] });
  A("an already-correct pair needs no write", patched.length === 0);
}

console.log("\n— wired into the sweep, after its bindings exist");
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  const lines = src.split("\n");
  const at = (re) => lines.findIndex((l) => re.test(l));
  const sumLine = at(/^\s*const sum = \{/), chanLine = at(/^\s*const guildChannels = await dApi/);
  const boardCall = at(/await enforcePostOnlyBoards\(guildChannels, roleId, sum\)/);
  const amCall = at(/await enforceAutomodExemptions\(roleId, guildChannels, sum\)/);
  A("the board sweep is called", boardCall > -1);
  A("...after `sum`", boardCall > sumLine, `sum ${sumLine + 1}, call ${boardCall + 1}`);
  A("...and after `guildChannels`", boardCall > chanLine, `chans ${chanLine + 1}, call ${boardCall + 1}`);
  A("automod now receives the channel list too", amCall > chanLine);
  A("the result reports both", /boardsLocked: sum\.boardsLocked/.test(src) && /automodChannels: sum\.automodChannels/.test(src));
  A("only management is listed as a poster",
    JSON.stringify(I.POST_ONLY_BOARDS["scouting-links"]) ===
    JSON.stringify(["owner", "general manager", "assistant general manager"]),
    JSON.stringify(I.POST_ONLY_BOARDS["scouting-links"]));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
