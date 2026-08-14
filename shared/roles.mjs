// The ONE definition of "which Discord roles should this member have".
//
// Two processes enforce it: the Netlify sweep (netlify/functions/discord-sync.js, every 2 minutes,
// walks every member and converges the whole server) and the Oracle gateway bot
// (bot/role-sync.mjs, reacts to a single member's database change within seconds). If they each
// carried their own copy of these rules they would drift within a month, and the disagreement
// would express itself as roles flapping on and off every two minutes as the two processes fought.
// So the rules live here and both import them; the sweep and the instant path can only ever
// disagree about WHEN, never about WHAT.
//
// Pure module: no I/O, no env, nothing async — callers assemble the context, this decides.

/* `key` mirrors the site's CG.STAFF_DEPARTMENTS and profiles.departments, so picking a department
   on the site grants the matching Discord role, which opens that department's room. `channel`,
   `topic` and `alt` belong to the sweep's room provisioning; they ride along so there is exactly
   one list of departments in the backend. */
export const STAFF_DEPARTMENTS = [
  { key: "applications", role: "Review Board", channel: "review-board", topic: "Review Board — the deciding vote on owner, GM, AGM, and staff applications." },
  { key: "officiating",  role: "Officials",    channel: "officials",    topic: "Officials — game-night disputes, forfeits, and rule calls." },
  { key: "operations",   role: "Operations",   channel: "operations",   topic: "Operations — scheduling, reschedules, game codes, and no-show follow-up." },
  { key: "draft",        role: "Draft Room",   channel: "draft-room",   topic: "Draft Room — draft night and the free-agency bidding board." },
  { key: "transactions", role: "Transactions", channel: "transactions-desk", alt: ["transactions"], topic: "Transactions — trades, waivers, and cap & contract compliance." },
  { key: "community",    role: "Community",     channel: "community",    topic: "Community — Discord moderation, welcome, and onboarding." },
  { key: "statistics",   role: "Statistics",   channel: "statistics",   topic: "Statistics — EA import accuracy and the record book." },
  { key: "media",        role: "Media",         channel: "media",        topic: "Media — news, recaps, broadcast, and socials." },
];

export const POS_LABEL = { C: "Center", LW: "Left Wing", RW: "Right Wing", LD: "Left Defense", RD: "Right Defense", G: "Goalie" };
export const POSITION_ROLES = ["Center", "Left Wing", "Right Wing", "Left Defense", "Right Defense", "Goalie"];

/* Every role the league manages — reconciled to `desired` on each pass, so holding one of these is
   never grandfathered: lose the reason, lose the role. Club and department roles are added by
   managedRoleIds() because their ids are data, not names. */
export const MANAGED_STATIC = ["Player", "Owner", "General Manager", "Assistant General Manager",
  "CGHL Management", "Commissioner", "Staff", "Free Agent", "Not Signed Up", ...POSITION_ROLES];

export function managedRoleIds(roleId, teams) {
  const ids = new Set();
  for (const n of MANAGED_STATIC) if (roleId[n.toLowerCase()]) ids.add(roleId[n.toLowerCase()]);
  for (const t of teams || []) if (t.discord_role_id) ids.add(t.discord_role_id);
  // department roles are managed too, so they're added/removed as officials change their picks
  for (const d of STAFF_DEPARTMENTS) { const rid = roleId[d.role.toLowerCase()]; if (rid) ids.add(rid); }
  return ids;
}

/* The desired managed roles for one member.
   `m` is a discord_links row (profile_id, role, team_id); `ctx` is everything true about the
   league right now:
     roleId            guild role name (lowercased) -> id
     teamRoleId        team_id -> that club's Discord role id
     registered        Set of profile_ids registered for the current-registration season
     regOpen           whether sign-ups are open (drives Not Signed Up)
     mgmtRoleByProfile profile_id -> "owner" | "gm" | "agm" (from the club seats)
     deptByProfile     profile_id -> departments[] (staff + commissioners only)
     posOf             profile_id -> position code (roster spot wins over signup)

   The three participation roles are mutually coherent, gated on current-season registration and
   roster status:
     Player        = registered for the season OR holding a roster spot
     Free Agent    = registered but not yet on a roster (available to sign)
     Not Signed Up = linked but not registered while the window is open */
export function desiredRolesFor(m, ctx) {
  const { roleId, teamRoleId, registered, regOpen, mgmtRoleByProfile, deptByProfile, posOf } = ctx;
  const desired = new Set();
  const isRegistered = registered.has(m.profile_id);
  const onRoster = !!(m.team_id && teamRoleId[m.team_id]);
  if ((isRegistered || onRoster) && roleId["player"]) desired.add(roleId["player"]);
  if (onRoster) desired.add(teamRoleId[m.team_id]);
  else if (isRegistered && roleId["free agent"]) desired.add(roleId["free agent"]);
  const teamRole = mgmtRoleByProfile[m.profile_id];
  if (teamRole === "owner" && roleId["owner"]) desired.add(roleId["owner"]);
  if (teamRole === "gm" && roleId["general manager"]) desired.add(roleId["general manager"]);
  if (teamRole === "agm" && roleId["assistant general manager"]) desired.add(roleId["assistant general manager"]);
  /* One handle for a club's whole front office, so the league office can reach every Owner, GM and
     AGM in a single ping instead of three. It rides on the SAME seat check as the three roles
     above, so it is granted and revoked with the seat and can never drift out of step with them. */
  if ((teamRole === "owner" || teamRole === "gm" || teamRole === "agm") && roleId["cghl management"])
    desired.add(roleId["cghl management"]);
  if (m.role === "commissioner" && roleId["commissioner"]) desired.add(roleId["commissioner"]);
  // league officials: staff wear Staff; the commissioner is staff too.
  // EXCEPTION (2026-08-05): media-only staff wear just their Media department role — no Staff
  // role, so none of the staff rooms, pings, or oversight surfaces come with it.
  const memberDepts = (deptByProfile[m.profile_id] || []);
  const normDepts = memberDepts.map((k) => String(k || "").trim().toLowerCase()).filter((k) => k.length);
  const mediaOnly = m.role === "staff" && normDepts.length > 0 && normDepts.every((k) => k === "media");
  if ((m.role === "staff" || m.role === "commissioner") && !mediaOnly && roleId["staff"]) desired.add(roleId["staff"]);
  // department roles the official signed up for on the site — these open the department rooms
  if (m.role === "staff" || m.role === "commissioner") {
    for (const key of memberDepts) {
      const d = STAFF_DEPARTMENTS.find((x) => x.key === key);
      const rid = d && roleId[d.role.toLowerCase()];
      if (rid) desired.add(rid);
    }
  }
  // "Not Signed Up" — a linked member who hasn't registered for the open season. Applies
  // regardless of profile role, because staff and commissioners are allowed to play too
  // (role-conflict rules) and should get the nudge.
  if (regOpen && !registered.has(m.profile_id) && roleId["not signed up"]) desired.add(roleId["not signed up"]);
  // position role (Center / Left Wing / … / Goalie) from their current-season position
  const posName = POS_LABEL[posOf[m.profile_id]];
  if (posName && roleId[posName.toLowerCase()]) desired.add(roleId[posName.toLowerCase()]);
  return desired;
}

/* Keep every NON-managed role exactly as found (boosters, integrations, custom colors), set the
   managed set to `desired`. Returns the full new roles array and whether a write is needed. */
export function applyManagedRoles(currentRoles, desired, managedIds) {
  const current = new Set(currentRoles || []);
  const next = [...current].filter((id) => !managedIds.has(id));
  for (const id of desired) next.push(id);
  const nextSet = new Set(next);
  const changed = nextSet.size !== current.size || [...nextSet].some((id) => !current.has(id));
  return { next: [...nextSet], changed };
}
