// The 2026-09-17 audit fixes to the Discord sweep. Run: node tools/discord-sync-hardening.test.mjs
//
// Each block pins one finding from docs/audits/2026-09-17-stress-test.md:
//   P2-8   rooms and forums are adopted by their STORED ID, so a hand rename never spawns a duplicate
//   P2-9   the Team Management rooms are reconciled every sweep (feeds office-post-only), and the
//          elevated bits come off every role the sweep owns
//   P2-0   the member passes stop at the time budget and say so; the sweep no longer ends with
//          resolve_due_servers; a run stamps its start
//   P2-12  a message POST is never retried; a delivered notice never loses its claim
//   P2-13  a gamertag rename that would collide case-insensitively is refused
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

import fs from "node:fs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const GUILD = "guild1";
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

/* one programmable transport for the whole file */
let cfg = {}, calls = [], created = [], patchedChans = [], patchedRoles = [], patchedMembers = [], sbPatches = [];
let discordFail = null;       // (method, path) => Response | null
let sbFail = null;            // (method, url) => Response | null
function reset() { cfg = {}; calls = []; created = []; patchedChans = []; patchedRoles = []; patchedMembers = []; sbPatches = []; discordFail = null; sbFail = null; }
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || "GET").toUpperCase();
  calls.push({ u, m });
  if (u.includes("/rest/v1/app_config")) {
    if (m === "GET") {
      const inm = u.match(/key=in\.\(([^)]*)\)/);
      if (inm) return J(inm[1].split(",").map(decodeURIComponent).filter((k) => k in cfg).map((k) => ({ key: k, value: cfg[k] })));
      const eq = u.match(/key=eq\.([^&]+)/);
      return J(eq && cfg[decodeURIComponent(eq[1])] !== undefined ? [{ value: cfg[decodeURIComponent(eq[1])] }] : []);
    }
    if (m === "POST") { const b = JSON.parse(opts.body); cfg[b.key] = b.value; return new Response(null, { status: 201 }); }
  }
  if (u.includes("/rest/v1/")) {
    const f = sbFail && sbFail(m, u); if (f) return f;
    if (m === "PATCH") { sbPatches.push({ u, body: JSON.parse(opts.body) }); return new Response(null, { status: 204 }); }
    if (m === "POST") return new Response(null, { status: 201 });
    if (m === "DELETE") return new Response(null, { status: 204 });
    return J([]);
  }
  if (u.includes("discord.com/api")) {
    const path = u.split("/api/v10")[1];
    const f = discordFail && discordFail(m, path); if (f) return f;
    if (m === "POST" && /\/guilds\/[^/]+\/channels$/.test(path)) { const b = JSON.parse(opts.body); const ch = { id: "new-" + (created.length + 1), ...b }; created.push(ch); return J(ch); }
    if (m === "PATCH" && /\/channels\/[^/]+$/.test(path)) { patchedChans.push({ id: path.split("/channels/")[1], body: JSON.parse(opts.body) }); return J({}); }
    if (m === "PATCH" && /\/guilds\/[^/]+\/roles\/[^/]+$/.test(path)) { patchedRoles.push({ id: path.split("/roles/")[1], body: JSON.parse(opts.body) }); return J({}); }
    if (m === "PATCH" && /\/guilds\/[^/]+\/members\/[^/]+$/.test(path)) { patchedMembers.push({ id: path.split("/members/")[1], body: JSON.parse(opts.body) }); return J({}); }
    if (m === "POST" && /\/channels\/[^/]+\/messages$/.test(path)) return J({ id: "msg-" + calls.length });
    if (m === "GET" && /\/webhooks$/.test(path)) return J([{ id: "h1", name: "CGHL Moves", token: "tok" }]);
    return J({});
  }
  return J([]);
};

const mod = await import(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname);
const I = mod._internals;
const src = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");

const ROLE = { commissioner: "r-comm", staff: "r-staff", owner: "r-own", "general manager": "r-gm", "assistant general manager": "r-agm" };
const owOf = (list, id) => (list || []).find((o) => o.id === id);
const VIEW = 1024n, SEND = 2048n, HIST = 65536n, PUB = 1n << 35n, PRIV = 1n << 36n, IN_THREADS = 1n << 38n;

/* ---------------------------------------------------------------------------------------- */
console.log("— P2-8: the FAQ forums are adopted by stored id, whatever their name (no duplicate on a rename)");
{
  reset();
  const forum = { id: "f-mgmt", name: "mgnt-faq", type: 15, parent_id: "cat-mgmt", permission_overwrites: [] };   // renamed by hand today
  const chans = [
    { id: "cat-mgmt", name: "Team Management", type: 4 }, { id: "cat-gen", name: "General", type: 4 },
    forum,
    { id: "f-player", name: "player-faq", type: 15, parent_id: "cat-gen", permission_overwrites: [] },
  ];
  cfg.discord_management_faq_channel_id = "f-mgmt";
  cfg.discord_player_faq_channel_id = "f-player";
  const sum = { errors: [] };
  await I.ensureFaqForums(chans, ROLE, sum);
  A("nothing is created — the renamed forum is the forum", created.length === 0, String(created.length));
  A("...it is counted as adopted", sum.faqForumsAdopted === 1, String(sum.faqForumsAdopted));
  A("...its overwrites are still reconciled", patchedChans.some((p) => p.id === "f-mgmt"));
  A("...and it is NOT renamed back (a rename is the commissioner's decision)", !patchedChans.some((p) => p.id === "f-mgmt" && "name" in p.body));
  A("the stored id is left as it was (no needless config write)", !calls.some((c) => c.m === "POST" && c.u.includes("app_config") ));

  /* the stored id points at something that is gone (or not a forum): fall back to name+parent */
  reset();
  cfg.discord_management_faq_channel_id = "f-deleted";
  const chans2 = [
    { id: "cat-mgmt", name: "Team Management", type: 4 }, { id: "cat-gen", name: "General", type: 4 },
    { id: "f-byname", name: "management-faq", type: 15, parent_id: "cat-mgmt", permission_overwrites: [] },
    { id: "f-player", name: "player-faq", type: 15, parent_id: "cat-gen", permission_overwrites: [] },
  ];
  await I.ensureFaqForums(chans2, ROLE, { errors: [] });
  A("a dead stored id falls back to the name+parent lookup", created.length === 0 && cfg.discord_management_faq_channel_id === "f-byname");
  reset();
  await I.ensureFaqForums([{ id: "cat-mgmt", name: "Team Management", type: 4 }, { id: "cat-gen", name: "General", type: 4 },
    { id: "t-text", name: "management-faq", type: 0, parent_id: "cat-mgmt", permission_overwrites: [] }], ROLE, { errors: [] });
  A("...and a text channel wearing the forum's name is not mistaken for it", created.length === 2 && created.every((c) => c.type === 15));

  /* neither: created once, id stored */
  reset();
  const chans3 = [{ id: "cat-mgmt", name: "Team Management", type: 4 }, { id: "cat-gen", name: "General", type: 4 }];
  const sum3 = { errors: [] };
  await I.ensureFaqForums(chans3, ROLE, sum3);
  A("with no stored id and no name match, both forums are created", created.length === 2 && sum3.faqForumsCreated === 2);
  A("...and their ids are stored for next time", cfg.discord_management_faq_channel_id === created[0].id && cfg.discord_player_faq_channel_id === created[1].id);
  A("...as forums, under their categories", created.every((c) => c.type === 15) && created[0].parent_id === "cat-mgmt" && created[1].parent_id === "cat-gen");
}

console.log("\n— P2-8/P2-9: the Team Management rooms — adopted by id, reconciled every sweep");
{
  const office = [ROLE.commissioner, ROLE.staff];
  const world = () => ([
    { id: "cat-tm", name: "Team Management", type: 4, permission_overwrites: [] },
    { id: "c-owners", name: "owners-chat", type: 0, parent_id: "cat-tm", permission_overwrites: [] },
    { id: "c-mchat", name: "management-chat", type: 0, parent_id: "cat-tm", permission_overwrites: [] },
    { id: "c-help", name: "management-help", type: 15, parent_id: "cat-tm", permission_overwrites: [] },
    { id: "c-moves", name: "management-moves", type: 0, parent_id: "cat-tm", permission_overwrites: [] },
    /* the creation-only shape: every seat role could post here */
    { id: "c-ann", name: "management-announcements", type: 0, parent_id: "cat-tm", permission_overwrites: [
      { id: GUILD, type: 0, allow: "0", deny: "1024" }, ...[ROLE.owner, ROLE["general manager"], ROLE["assistant general manager"], ...office].map((id) => ({ id, type: 0, allow: "68608", deny: "0" })) ] },
    { id: "c-ids", name: "club-ids", type: 0, parent_id: "cat-tm", permission_overwrites: [] },
  ]);

  reset();
  let chans = world();
  let sum = { errors: [] };
  await I.ensureMgmtCategory(chans, ROLE, sum);
  A("nothing is created when every room exists by name", created.length === 0, String(created.length));
  A("every room (and the category) is reconciled", patchedChans.length === 7, String(patchedChans.length));
  const ann = patchedChans.find((p) => p.id === "c-ann");
  const gmOnAnn = ann && owOf(ann.body.permission_overwrites, ROLE["general manager"]);
  A("#management-announcements: a GM can view and read", gmOnAnn && (BigInt(gmOnAnn.allow) & (VIEW | HIST)) === (VIEW | HIST));
  A("...but no longer send, open a thread, or reply in one", gmOnAnn && (BigInt(gmOnAnn.allow) & SEND) === 0n && (BigInt(gmOnAnn.deny) & (SEND | PUB | PRIV | IN_THREADS)) === (SEND | PUB | PRIV | IN_THREADS));
  const staffOnAnn = ann && owOf(ann.body.permission_overwrites, ROLE.staff);
  A("...Staff may post there", staffOnAnn && (BigInt(staffOnAnn.allow) & SEND) === SEND && BigInt(staffOnAnn.deny) === 0n);
  A("...and @everyone is still hidden", ann && owOf(ann.body.permission_overwrites, GUILD).deny === "1024");
  const ids = patchedChans.find((p) => p.id === "c-ids");
  const ownerOnIds = ids && owOf(ids.body.permission_overwrites, ROLE.owner);
  A("#club-ids is a feed the same way", ownerOnIds && (BigInt(ownerOnIds.deny) & SEND) === SEND);
  const chat = patchedChans.find((p) => p.id === "c-mchat");
  const agmOnChat = chat && owOf(chat.body.permission_overwrites, ROLE["assistant general manager"]);
  A("#management-chat: the front office keeps VIEW+SEND+READ", agmOnChat && (BigInt(agmOnChat.allow) & (VIEW | SEND | HIST)) === (VIEW | SEND | HIST));
  A("...but may not open threads", agmOnChat && (BigInt(agmOnChat.deny) & (PUB | PRIV)) === (PUB | PRIV) && (BigInt(agmOnChat.deny) & SEND) === 0n);
  const owners = patchedChans.find((p) => p.id === "c-owners");
  A("#owners-chat is owners + office only", owners && owOf(owners.body.permission_overwrites, ROLE.owner) && !owOf(owners.body.permission_overwrites, ROLE["general manager"]));
  const help = patchedChans.find((p) => p.id === "c-help");
  const gmOnHelp = help && owOf(help.body.permission_overwrites, ROLE["general manager"]);
  A("#management-help (a forum): the front office can create posts and reply in them", gmOnHelp && (BigInt(gmOnHelp.allow) & (SEND | IN_THREADS)) === (SEND | IN_THREADS));
  const cat = patchedChans.find((p) => p.id === "cat-tm");
  A("the category carries the chat shape, so a hand-added room inherits it", cat && owOf(cat.body.permission_overwrites, ROLE.owner) && (BigInt(owOf(cat.body.permission_overwrites, ROLE.owner).deny) & (PUB | PRIV)) === (PUB | PRIV));
  A("every room id is now stored under its own key", I.MGMT_ROOMS.every((r) => cfg[I.MGMT_CFG_KEY(r.slug)]) && cfg[I.MGMT_CAT_KEY] === "cat-tm");
  A("...with clear names", I.MGMT_CFG_KEY("club_ids") === "discord_mgmt_room_club_ids_id" && I.MGMT_CAT_KEY === "discord_mgmt_category_id");
  A("healed rooms are counted", sum.mgmtRoomsHealed === 7, String(sum.mgmtRoomsHealed));

  /* second sweep over the converged state: no writes */
  patchedChans = []; created = [];
  await I.ensureMgmtCategory(chans, ROLE, { errors: [] });
  A("a converged category needs no write on the next sweep", patchedChans.length === 0 && created.length === 0, String(patchedChans.length));

  /* a hand-added entry (a muted member) survives, with the room's denied bits stripped from it */
  chans.find((c) => c.id === "c-ann").permission_overwrites.push({ id: "u-bot", type: 1, allow: String(VIEW | SEND | PUB), deny: "0" });
  patchedChans = [];
  await I.ensureMgmtCategory(chans, ROLE, { errors: [] });
  const kept = owOf(patchedChans.find((p) => p.id === "c-ann").body.permission_overwrites, "u-bot");
  A("an overwrite the sweep did not write is kept", !!kept && (BigInt(kept.allow) & VIEW) === VIEW);
  A("...minus the bits the feed denies its audience", kept && (BigInt(kept.allow) & (SEND | PUB)) === 0n);

  /* the rename: #management-announcements becomes #front-office-notices by hand; the stored id wins */
  const renamed = chans.find((c) => c.id === "c-ann"); renamed.name = "front-office-notices";
  patchedChans = []; created = [];
  sum = { errors: [] };
  await I.ensureMgmtCategory(chans, ROLE, sum);
  A("a renamed room is adopted by its stored id — nothing created", created.length === 0 && sum.mgmtRoomsAdopted === 1);
  A("...and not renamed back", !patchedChans.some((p) => p.id === "c-ann"));

  /* no stored ids and a room missing by name: created with the right shape, id stored */
  reset();
  chans = world().filter((c) => c.id !== "c-ids");
  sum = { errors: [] };
  await I.ensureMgmtCategory(chans, ROLE, sum);
  A("a missing room is created", created.length === 1 && created[0].name === "club-ids" && created[0].parent_id === "cat-tm");
  const ownerAtBirth = owOf(created[0].permission_overwrites, ROLE.owner);
  A("...born as a feed: front office reads, cannot post", ownerAtBirth && (BigInt(ownerAtBirth.deny) & SEND) === SEND);
  A("...and its id is stored", cfg[I.MGMT_CFG_KEY("club_ids")] === created[0].id);
  A("the moves webhook is still put on file", cfg.discord_mgmt_moves_webhook === "https://discord.com/api/webhooks/h1/tok");

  /* a forum that fell back to a text room is still that room when found by id */
  reset();
  cfg[I.MGMT_CFG_KEY("management_help")] = "c-help-text";
  chans = world().map((c) => (c.id === "c-help" ? { ...c, id: "c-help-text", type: 0, name: "help" } : c));
  await I.ensureMgmtCategory(chans, ROLE, { errors: [] });
  A("a text-room fallback of the help forum is adopted by id, not recreated as a forum", created.length === 0);
}

console.log("\n— P2-9: elevated bits come off the roles the sweep owns, every sweep");
{
  const EV = 1n << 44n, EXPR = 1n << 43n, MC = 1n << 4n;
  /* a real league-role bitfield as found live — which, as the audit says, ALREADY carries events,
     expressions and both thread bits; the clean baseline is derived from it so "already clean" and
     "stripped to" mean the same value */
  const BASE = 2248473465835073n & ~(EV | EXPR | PUB | PRIV);
  const role = (id, name, perms, extra = {}) => ({ id, name, permissions: String(perms), managed: false, ...extra });
  const roleId = { commissioner: "r-comm", staff: "r-staff", player: "r-play", "not signed up": "r-nsu", goalie: "r-g", owner: "r-own", officials: "r-off" };
  const teams = [{ discord_role_id: "r-club" }];
  const roles = [
    role(GUILD, "@everyone", BASE | PUB | PRIV | EV),
    role("r-comm", "Commissioner", BASE | EV | EXPR | PUB),
    role("r-staff", "Staff", BASE | EV | EXPR),
    role("r-play", "Player", BASE | EV | EXPR | PUB | PRIV),
    role("r-nsu", "Not Signed Up", BASE | EV),
    role("r-g", "Goalie", BASE | EXPR),
    role("r-own", "Owner", BASE | EV | EXPR),
    role("r-off", "Officials", BASE | PUB),
    role("r-club", "Canucks", BASE | PUB),
    role("r-custom", "Tournament Host", BASE | EV | EXPR),       // not ours: untouched
    role("r-bot", "Chel Gaming", BASE | EV, { managed: true }),  // integration role: untouched
    role("r-disb", "DISBOARD.org", BASE | MC, { managed: true }),
    role("r-clean", "Center", BASE),                             // already clean
  ];
  reset();
  const sum = { errors: [] };
  await I.enforceRoleBits(roles, teams, roleId, sum);
  const got = (id) => { const p = patchedRoles.find((x) => x.id === id); return p ? BigInt(p.body.permissions) : null; };
  A("@everyone loses the two thread-creation bits and nothing else", got(GUILD) === (BASE | EV), got(GUILD) && got(GUILD).toString());
  A("Player loses events, expressions and both thread bits", got("r-play") === BASE);
  A("Not Signed Up, a position, a seat, a department and a club role are all stripped", ["r-nsu", "r-g", "r-own", "r-off", "r-club"].every((id) => got(id) === BASE));
  A("Commissioner keeps what it has", got("r-comm") === null);
  A("Staff keeps what it has", got("r-staff") === null);
  A("a role the sweep does not own is untouched", got("r-custom") === null);
  A("the bot's own integration role is untouched", got("r-bot") === null);
  A("an already-clean role is not written", got("r-clean") === null);
  A("DISBOARD loses MANAGE_CHANNELS when Discord allows the edit", got("r-disb") === BASE && sum.disboardManageChannels === "stripped");
  A("the count covers the six roles of ours plus @everyone (DISBOARD is reported separately)", sum.roleBitsStripped === 7, String(sum.roleBitsStripped));
  A("nothing errored", sum.errors.length === 0, JSON.stringify(sum.errors[0]));

  /* Discord refuses the managed role: "manual", not an error every two minutes */
  reset();
  discordFail = (m, path) => (m === "PATCH" && path.endsWith("/roles/r-disb") ? J({ message: "Cannot modify a managed role", code: 50028 }, 403) : null);
  const sum2 = { errors: [] };
  await I.enforceRoleBits([role("r-disb", "DISBOARD.org", BASE | MC, { managed: true })], teams, roleId, sum2);
  A("a refused DISBOARD edit is reported as manual", sum2.disboardManageChannels === "manual");
  A("...and is not an error", sum2.errors.length === 0);

  /* second pass over the corrected roles is a no-op */
  reset();
  const sum3 = { errors: [] };
  await I.enforceRoleBits(roles, teams, roleId, sum3);
  A("a clean server needs no writes", patchedRoles.length === 0 && !sum3.roleBitsStripped);

  /* roles are BORN clean: explicit permissions at creation, derived from @everyone */
  const everyone = [role(GUILD, "@everyone", BASE | PUB | PRIV | EV | EXPR | (1n << 17n) | 1n)];
  const born = BigInt(I.rolePermissionsAtBirth("Goalie", everyone));
  A("a new role carries none of the elevated bits", (born & (EV | EXPR | PUB | PRIV)) === 0n);
  A("...nor the megaphone or invite creation", (born & ((1n << 17n) | 1n)) === 0n);
  A("...and a qualifying role has the posting bits from birth", (born & I.POST_BITS) === I.POST_BITS);
  const nsu = BigInt(I.rolePermissionsAtBirth("Not Signed Up", everyone));
  A("Not Signed Up is born with embed (the GIF picker) but not attach", (nsu & (1n << 14n)) !== 0n && (nsu & (1n << 15n)) === 0n);
  A("...the same rule the posting policy enforces", (nsu & I.DENY_STRIP_NAMED) === 0n && (nsu & I.DENY_GRANT_NAMED) === I.DENY_GRANT_NAMED);
  A("every role creation site passes explicit permissions", (src.match(/\/roles`, \{[^}]*permissions: rolePermissionsAtBirth\(/g) || []).length === 5,
    String((src.match(/\/roles`, \{[^}]*permissions: rolePermissionsAtBirth\(/g) || []).length));
  A("...and none is left inheriting @everyone's", (src.match(/\/roles`, \{ name/g) || []).length === 5);
  A("the bits are the ones the audit named", I.CREATE_EVENTS === 1n << 44n && I.CREATE_GUILD_EXPRESSIONS === 1n << 43n && I.CREATE_THREAD_BITS === ((1n << 35n) | (1n << 36n)));
  A("the sweep runs it beside the other two policies", /await enforceRoleBits\(guildRoles, teams, roleId, sum\)/.test(src) && /roleBitsStripped: sum\.roleBitsStripped/.test(src) && /disboardManageChannels: sum\.disboardManageChannels/.test(src));
}

console.log("\n— P2-0: the member passes stop at the budget and say so");
{
  const linkOf = (i) => ({ profile_id: "p" + i, discord_id: "d" + i, gamertag: "Tag" + i, role: "player", team_id: null, discord_username: "u" + i });
  const mem = (i, roles = []) => ({ user: { id: "d" + i, username: "u" + i, global_name: "Tag" + i, bot: false }, nick: null, roles });
  const mkCtx = (n) => {
    const links = Array.from({ length: n }, (_, i) => linkOf(i));
    const memberById = new Map(links.map((l, i) => [l.discord_id, mem(i)]));
    const inGuild = {};
    return { links, bannedIds: new Set(), guildBans: new Set(), memberById, memberListOk: true,
      markGuild: async (pid, v) => { inGuild[pid] = v; }, avatarById: {}, tagOwner: new Map(links.map((l) => [l.gamertag.toLowerCase(), l.profile_id])),
      inputsOk: true, roleId: { player: "r-play", "not signed up": "r-nsu" }, teamRoleId: {}, registered: new Set(links.map((l) => l.profile_id)), regOpen: true,
      mgmtRoleByProfile: {}, deptByProfile: {}, posOf: {}, rfa: new Set(), rookies: new Set(), managedIds: new Set(["r-play", "r-nsu"]) };
  };
  reset();
  const ctx = mkCtx(10);
  let sum = { checked: 0, renamed: 0, roleUpdated: 0, notInServer: 0, errors: [] };
  let ticks = 0;
  await I.syncLinkedMembers(ctx, sum, () => ++ticks > 4);          // time runs out after 4 members
  A("the pass stops when the budget is spent", sum.checked === 4, String(sum.checked));
  A("...and says so", sum.partial === true && sum.membersLeft === 6, JSON.stringify([sum.partial, sum.membersLeft]));
  A("...having done real work for the members it reached (Player granted)", patchedMembers.length === 4 && patchedMembers.every((p) => p.body.roles.includes("r-play")));

  /* pass 2 counts what it left too, and both passes add up */
  reset();
  const ctx2 = mkCtx(3);
  for (let i = 0; i < 5; i++) ctx2.memberById.set("x" + i, mem("x" + i));   // five unlinked members
  sum = { checked: 0, renamed: 0, roleUpdated: 0, notInServer: 0, errors: [] };
  ticks = 0;
  const clock = () => ++ticks > 5;                                   // 3 linked + 2 unlinked fit
  await I.syncLinkedMembers(ctx2, sum, clock);
  await I.syncUnlinkedMembers(ctx2, sum, clock);
  A("pass 1 completes, pass 2 is cut short", sum.checked === 3 && sum.unlinkedSeen === 2 && sum.membersLeft === 3 && sum.partial === true, JSON.stringify(sum));
  A("...the unlinked it reached wear Not Signed Up", patchedMembers.filter((p) => p.id.startsWith("x")).every((p) => p.body.roles.includes("r-nsu")));

  /* with time to spare nothing is partial */
  reset();
  sum = { checked: 0, renamed: 0, roleUpdated: 0, notInServer: 0, errors: [] };
  await I.syncLinkedMembers(mkCtx(5), sum, () => false);
  A("a pass that finishes is not partial", !sum.partial && sum.membersLeft === undefined && sum.checked === 5);

  A("the budget is ~60% of the 30-second limit", I.MEMBER_PASS_BUDGET_MS === 18000);
  A("the sweep measures from its own start and passes the clock to both passes",
    /const T0 = Date\.now\(\);/.test(src) && /const outOfTime = \(\) => Date\.now\(\) - T0 > BUDGET_MS;/.test(src) &&
    /await syncLinkedMembers\(ctx, sum, outOfTime\)/.test(src) && /await syncUnlinkedMembers\(ctx, sum, outOfTime\)/.test(src));
  A("the result records partial and membersLeft", /partial: !!sum\.partial, membersLeft: sum\.membersLeft \|\| 0/.test(src));
  A("a run stamps its start beside the heartbeat", /sbUpsertCfg\("rl_discord-sync_started"/.test(src));
  A("...before any work", src.indexOf('rl_discord-sync_started') < src.indexOf('const links = await sbGet("discord_links'));
  A("resolve_due_servers is no longer called by the sweep (pg_cron owns it)", !/rpc\/resolve_due_servers/.test(src));
  /* order: the cheap, time-critical steps precede the member passes and the furniture */
  const at = (re) => { const i = src.search(re); return i; };
  const notices = at(/await flushClubNotices\(sum\)/), departures = at(/await trackDepartures\(memberById/), signups = at(/await removeDepartedSignups\(sum\)/);
  const mgmt = at(/await ensureMgmtCategory\(guildChannels, roleId, sum\)/), faq = at(/await ensureFaqForums\(guildChannels, roleId, sum\)/);
  const furniture = at(/await ensureStaffDepartments\(/), passes = at(/await syncLinkedMembers\(ctx, sum, outOfTime\)/);
  A("club notices, departures, sign-up withdrawals and the room checks all run before the guild furniture",
    [notices, departures, signups, mgmt, faq].every((i) => i > 0 && i < furniture), JSON.stringify({ notices, departures, signups, mgmt, faq, furniture }));
  A("...and the member passes are last", passes > furniture);
  A("the sweep is exported for the HTTP door", typeof mod.runSweep === "function" && typeof mod.runOp === "function" && typeof mod.opsKeyOk === "function");
  A("the scheduled default export just wraps it", typeof mod.default === "function" && /export default async \(\) => \{\n  const r = await runSweep\(\);/.test(src));
}

console.log("\n— P2-12: a message POST is sent once; an ambiguous outcome is `unknown`, not retried");
{
  reset();
  let attempts = 0;
  discordFail = (m, path) => (m === "POST" && path.endsWith("/messages") ? (attempts++, new Response("upstream", { status: 502 })) : null);
  let err = null;
  try { await I.dApi("POST", "/channels/c1/messages", { content: "x" }); } catch (e) { err = e; }
  A("a 5xx on a message POST throws", !!err);
  A("...marked unknown", err && err.unknown === true);
  A("...after exactly one attempt", attempts === 1, String(attempts));

  /* the same 5xx on an idempotent call IS retried */
  reset(); attempts = 0;
  discordFail = (m, path) => (m === "PATCH" && path.endsWith("/roles/r1") ? (attempts++ < 2 ? new Response("upstream", { status: 502 }) : null) : null);
  await I.dApi("PATCH", "/guilds/guild1/roles/r1", { name: "x" });
  A("a 5xx on a role PATCH is retried until it succeeds", attempts === 3, String(attempts));

  /* a timeout / network failure on a message POST: one attempt, unknown */
  reset(); attempts = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { if (String(url).endsWith("/messages")) { attempts++; const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; throw e; } return realFetch(url, opts); };
  err = null;
  try { await I.dApi("POST", "/channels/c1/messages", { content: "x" }); } catch (e) { err = e; }
  globalThis.fetch = realFetch;
  A("a timeout on a message POST is one attempt", attempts === 1, String(attempts));
  A("...thrown as unknown, naming the timeout", err && err.unknown === true && /timeout/.test(err.message));

  A("every Discord call carries a deadline", /DISCORD_TIMEOUT_MS = 15000/.test(src) && /rfetch\(`https:\/\/discord\.com\/api\/v10\$\{path\}`[\s\S]{0,300}DISCORD_TIMEOUT_MS\)/.test(src));
  A("every Supabase call carries a deadline", /SB_TIMEOUT_MS = 10000/.test(src) && /signal: deadline\(timeoutMs\)/.test(src) &&
    (src.match(/await fetch\(`\$\{SB_URL\}\/rest\/v1\/app_config`, sbOpts\(\{ method: "POST"/g) || []).length === 3);
  A("...including the raw fetches (heartbeat, result, reap, logo)", (src.match(/sbOpts\(\{/g) || []).length >= 5 && /fetch\(url, \{ signal: deadline\(SB_TIMEOUT_MS\) \}\)/.test(src));
  /* every `fetch(` in the file is either rfetch's own call (deadline inside), wrapped in sbOpts(),
     or carries an explicit signal — a bare call is a regression */
  const bare = [...src.matchAll(/(?<![a-zA-Z_])fetch\(([^\n]*)/g)].map((m) => m[1]).filter((args) => !/signal: deadline\(|sbOpts\(/.test(args) && !/^url, \{ signal/.test(args));
  A("no bare fetch is left in the file", bare.length === 0, bare.join(" | ").slice(0, 200));
}

console.log("\n— P2-12: a delivered club notice never loses its claim");
{
  const row = { id: "n1", team_id: "t1", kind: "sign", created_at: "2026-09-17T10:00:00Z", actor_profile_id: null };
  const base = globalThis.fetch;
  let claims = 0, claimDeletes = 0, patchTries = 0, patchFailTimes = 0, msgStatus = 200;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = (opts.method || "GET").toUpperCase();
    if (u.includes("/rest/v1/club_notices") && m === "GET") return J([row]);
    if (u.includes("/rest/v1/teams")) return J([{ id: "t1", discord_channel_id: "room1" }]);
    if (u.includes("/rest/v1/discord_post_log")) { if (m === "POST") { claims++; return new Response(null, { status: 201 }); } if (m === "DELETE") { claimDeletes++; return new Response(null, { status: 204 }); } }
    if (u.includes("/rest/v1/club_notices") && m === "PATCH") { patchTries++; if (patchFailTimes > 0) { patchFailTimes--; return J({ message: "pool exhausted" }, 503); } return new Response(null, { status: 204 }); }
    if (u.includes("/messages") && m === "POST") return msgStatus === 200 ? J({ id: "m1" }) : new Response("x", { status: msgStatus });
    return base(url, opts);
  };
  /* bookkeeping fails once, then lands */
  claims = 0; claimDeletes = 0; patchTries = 0; patchFailTimes = 1; msgStatus = 200;
  let sum = { errors: [] };
  await I.flushClubNotices(sum);
  A("the notice is posted once", sum.clubNoticesPosted === 1);
  A("...the bookkeeping PATCH is retried", patchTries === 2, String(patchTries));
  A("...and the claim is kept", claimDeletes === 0);
  A("...with no error to report", sum.errors.length === 0);

  /* bookkeeping fails every time: claim STILL kept, error surfaced */
  claims = 0; claimDeletes = 0; patchTries = 0; patchFailTimes = 99; msgStatus = 200;
  sum = { errors: [] };
  await I.flushClubNotices(sum);
  A("after three failed bookkeeping writes the claim is still kept (Discord accepted the message)", claimDeletes === 0 && patchTries === 3, JSON.stringify([claimDeletes, patchTries]));
  A("...the failure is in the summary", sum.clubNoticeBookkeeping === 1 && sum.errors.some((e) => e.clubNoticeBookkeeping === "n1" && e.delivered === true));
  A("...and the notice still counts as posted", sum.clubNoticesPosted === 1);

  /* Discord definitely refused (a 4xx): the claim is released for the next lane */
  claims = 0; claimDeletes = 0; patchTries = 0; patchFailTimes = 0; msgStatus = 403;
  sum = { errors: [] };
  await I.flushClubNotices(sum);
  A("a definite refusal releases the claim", claimDeletes === 1 && !sum.clubNoticesPosted);
  A("...and records the error on the row", patchTries === 1 && sum.errors.length === 1);

  /* an UNKNOWN outcome (5xx): the claim is kept — the room may already have it */
  claims = 0; claimDeletes = 0; patchTries = 0; msgStatus = 502;
  sum = { errors: [] };
  await I.flushClubNotices(sum);
  A("an unknown outcome keeps the claim (no second post from the bot lane)", claimDeletes === 0 && !sum.clubNoticesPosted);
  A("...and the row says why", patchTries === 1 && /unknown/.test(JSON.stringify(sum.errors[0])));
  globalThis.fetch = base;
}

console.log("\n— P2-13: the nickname -> gamertag sync refuses a case-insensitive collision and an empty name");
{
  const links = [
    { profile_id: "p1", discord_id: "d1", gamertag: "Sniper", role: "player", team_id: null, discord_username: "u1" },
    { profile_id: "p2", discord_id: "d2", gamertag: "Wheels", role: "player", team_id: null, discord_username: "u2" },
    { profile_id: "p3", discord_id: "d3", gamertag: "Dangles", role: "player", team_id: null, discord_username: "u3" },
    { profile_id: "p4", discord_id: "d4", gamertag: "Fresh", role: "player", team_id: null, discord_username: "u4" },
  ];
  const memberById = new Map([
    ["d1", { user: { id: "d1", username: "u1", global_name: "Sniper" }, nick: "SNIPER", roles: [] }],   // own tag, different case: fine
    ["d2", { user: { id: "d2", username: "u2", global_name: "Wheels" }, nick: "sniper", roles: [] }],   // someone else's tag: refused
    ["d3", { user: { id: "d3", username: "u3", global_name: "Dangles" }, nick: "   ", roles: [] }],     // blank nick: fall through to global name, unchanged
    ["d4", { user: { id: "d4", username: "u4", global_name: "Fresh" }, nick: "Brand New", roles: [] }], // a free name: renamed
  ]);
  const tagOwner = new Map([["sniper", "p1"], ["wheels", "p2"], ["dangles", "p3"], ["fresh", "p4"], ["taken", "p9"]]);
  const ctx = { links, bannedIds: new Set(), guildBans: new Set(), memberById, memberListOk: true, markGuild: async () => {}, avatarById: {}, tagOwner,
    inputsOk: false, roleId: {}, teamRoleId: {}, registered: new Set(), regOpen: false, mgmtRoleByProfile: {}, deptByProfile: {}, posOf: {}, rfa: new Set(), rookies: new Set(), managedIds: new Set() };
  reset();
  const sum = { checked: 0, renamed: 0, roleUpdated: 0, notInServer: 0, errors: [] };
  await I.syncLinkedMembers(ctx, sum, () => false);
  const renames = sbPatches.filter((p) => "gamertag" in p.body).map((p) => [p.u.match(/id=eq\.([^&]+)/)[1], p.body.gamertag]);
  A("a member re-casing their OWN tag is renamed", renames.some(([id, t]) => id === "p1" && t === "SNIPER"));
  A("a nickname that is another player's tag in different case is refused", !renames.some(([id]) => id === "p2"));
  A("...and counted", sum.renameCollisions === 1, String(sum.renameCollisions));
  A("a blank nickname never blanks the tag (falls through to the global name)", !renames.some(([id]) => id === "p3"));
  A("a free name is taken", renames.some(([id, t]) => id === "p4" && t === "Brand New"));
  A("...and the ownership map follows the rename, so the old name is free and the new one is held", !tagOwner.has("fresh") && tagOwner.get("brand new") === "p4");
  A("two renames counted", sum.renamed === 2, String(sum.renamed));
  A("the result reports collisions", /renameCollisions: sum\.renameCollisions \|\| 0/.test(src));

  /* a whitespace-only global name with no nick: nothing written */
  reset();
  const ctx2 = { ...ctx, links: [links[2]], memberById: new Map([["d3", { user: { id: "d3", username: "", global_name: "  " }, nick: null, roles: [] }]]) };
  const sum2 = { checked: 0, renamed: 0, roleUpdated: 0, notInServer: 0, errors: [] };
  await I.syncLinkedMembers(ctx2, sum2, () => false);
  A("a member whose every Discord name is blank is not renamed to nothing", !sbPatches.some((p) => "gamertag" in p.body) && sum2.renamed === 0);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
