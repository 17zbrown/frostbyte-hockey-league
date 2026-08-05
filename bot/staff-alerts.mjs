// Instant department alerts — "something just landed on your desk".
//
// The Staff Desk splits into eight department desks (part9_staffdesks.js), each with its own
// private Discord room (discord-sync's STAFF_DEPARTMENTS). Until now a staffer only learned that
// work had arrived by opening the site, or from the once-a-day casework nudge. This posts into
// the owning department's room the moment the row is written, so the Review Board hears about an
// application in seconds rather than at noon tomorrow.
//
// Kept dependency-free of discord.js so tools/staff-alerts.test.mjs can drive it with a stubbed
// fetch. The Realtime subscriptions are wired in chel-bot.mjs; discord-sync runs the same routing
// as a catch-up backstop for anything that landed while the bot was down.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE:
//  1. A case never reaches a room that its subject can read. A complaint about "Commissioner or
//     staff conduct" is deliberately NOT announced anywhere — every department room is readable by
//     staff, so announcing it hands the accused their own complaint. It stays on the site, where
//     RLS already scopes it to the office.
//  2. A club's private business never leaves the club. `trade_request` cases are routed to a
//     club's own management, not to the league office, so they are dropped here.

/* Desk routes mirror CG.STAFF_DESKS — key is the department, value the hash route of its desk. */
const DESK_PATH = {
  applications: "#/hub/reviewboard",
  officiating: "#/hub/officials",
  operations: "#/hub/opsdesk",
  draft: "#/hub/draftroom",
  transactions: "#/hub/transdesk",
  community: "#/hub/community",
  statistics: "#/hub/statsmgr",
  media: "#/hub/newsroom",
};
const DEPT_LABEL = {
  applications: "Review Board", officiating: "Officials", operations: "Operations",
  draft: "Draft Room", transactions: "Transactions", community: "Community",
  statistics: "Statistics", media: "Media",
};
const SITE = "https://chelgamingleague.com/";

/* Complaint subjects that implicate the league office itself. CG.COMPLAINT_SUBJECTS is the
   authoritative list; only this one is a conflict, because every other subject is about a member
   or a club and the officials' room is the right place to work it. */
const OFFICE_CONDUCT = "commissioner or staff conduct";
/* Discord moderation is Community's, not Officials'. */
const DISCORD_SUBJECT = "discord behavior";

/* One arrival -> one department, or null to stay silent. Pure: no I/O, so the test can walk every
   branch. `row` is the raw inserted row; `extra` carries anything the caller looked up (a gamertag,
   a club code) and is never required for routing. */
export function route(table, row, extra = {}) {
  if (!row) return null;
  const who = extra.gamertag || "A member";

  if (table === "owner_applications") {
    return { dept: "applications", kind: "Owner application",
      line: `**${who}** applied to own${extra.teamChoice ? ` **${extra.teamChoice}**` : " a club"}.`,
      cta: "The board's vote decides it." };
  }
  if (table === "staff_applications") {
    const want = Array.isArray(row.departments) && row.departments.length
      ? row.departments.map((k) => DEPT_LABEL[k] || k).join(" · ") : "unspecified";
    return { dept: "applications", kind: "Staff application",
      line: `**${who}** applied to join league staff — ${want}.`,
      cta: "The board's vote decides it." };
  }
  if (table === "management_applications") {
    const seat = row.role === "gm" ? "General Manager" : row.role === "agm" ? "Assistant GM" : "management";
    return { dept: "applications", kind: "Management appointment",
      line: `**${who}** was nominated as ${seat}${extra.club ? ` of **${extra.club}**` : ""}.`,
      cta: "The board's vote decides it." };
  }

  if (table === "action_requests") {
    const type = String(row.type || "");
    const subject = String(row.subject || "").trim();
    const subjLower = subject.toLowerCase();
    /* a club's own management handles these — the league office is not a party to them */
    if (type === "trade_request") return null;
    if (type === "complaint") {
      /* the accused must not read their own complaint: every department room is staff-readable */
      if (subjLower === OFFICE_CONDUCT) return { dept: null, suppressed: "office-conduct" };
      const dept = subjLower === DISCORD_SUBJECT ? "community" : "officiating";
      return { dept, kind: "New complaint",
        line: subject ? `Filed under **${subject}**.` : "A complaint was filed.",
        cta: "Open the case to read it — the details are not repeated here." };
    }
    if (type === "appeal") {
      return { dept: "officiating", kind: "Discipline appeal",
        line: subject ? `Appealing **${subject}**.` : "A ruling is being appealed.",
        cta: "Rule 7.6 gives 48 hours from the ruling to appeal." };
    }
    if (type === "position_change") {
      /* no department carries a position-change capability — it is commissioner work, and there is
         no commissioner-only room to announce into, so it stays on the site. */
      return { dept: null, suppressed: "commissioner-only" };
    }
    return { dept: null, suppressed: `unrouted case type "${type}"` };
  }

  if (table === "game_incidents") {
    const k = row.kind === "late_start" ? "Late start" : row.kind === "disconnect" ? "Disconnection" : "Game incident";
    return { dept: "officiating", kind: `${k} logged`,
      line: `${extra.fixture ? `**${extra.fixture}** — ` : ""}the ruling has already gone to both clubs.`,
      cta: "Listed on the Officials' desk if it needs a second look." };
  }

  if (table === "ea_ingest_log") {
    /* only the unmatched ones are work; a clean import is not news */
    if (String(row.status || "") !== "unmatched") return null;
    return { dept: "statistics", kind: "EA import needs a match",
      line: `Match \`${row.ea_match_id || "?"}\` came back from EA without a fixture to attach to.`,
      cta: "Link it by hand in the Stats manager, or merge it if it is a lag-out session." };
  }

  if (table === "staff_votes") {
    const depts = Array.isArray(row.departments) ? row.departments.filter((d) => DESK_PATH[d]) : [];
    return { depts: depts.length ? depts : null, kind: "A vote opened",
      line: `**${row.title || "A staff vote"}** is open${row.closes_at ? "" : " with no closing date"}.`,
      cta: "Cast your ballot from the Staff Desk." };
  }

  return null;
}

/* Not every queue table is keyed on `id`: ea_ingest_log has no id column at all — its identity is
   the EA match id and its clock is first_seen_at. Getting this wrong does not throw, it silently
   drops every alert from that table and writes a claim ref ending in "undefined", so the identity
   of each table is declared here rather than assumed at the call site. */
export const TABLE_KEYS = {
  action_requests: { id: "id", ts: "created_at" },
  owner_applications: { id: "id", ts: "created_at" },
  staff_applications: { id: "id", ts: "created_at" },
  management_applications: { id: "id", ts: "created_at" },
  staff_votes: { id: "id", ts: "created_at" },
  game_incidents: { id: "id", ts: "created_at" },
  ea_ingest_log: { id: "ea_match_id", ts: "first_seen_at" },
};
export function rowKey(table, row) {
  const spec = TABLE_KEYS[table];
  if (!spec || !row) return null;
  const v = row[spec.id];
  return v == null || v === "" ? null : String(v);
}

/* Colors read at a glance in a busy room: decisions amber, disputes orange, data-work blue. */
const COLOR = { applications: 0xFFE500, officiating: 0xC2410C, community: 0x7C3AED,
  statistics: 0x2563EB, operations: 0x2F9E44, transactions: 0x0891B2, draft: 0xDB2777, media: 0x475569 };

export function createStaffAlerter(env) {
  const { SB_URL, SB_KEY, BOT } = env;
  const UA = "DiscordBot (https://chelgamingleague.com,1.0)";
  const sum = { announced: 0, skipped: 0, suppressed: 0 };
  const errors = [];
  const note = (e) => { errors.push(String((e && e.message) || e).slice(0, 180)); if (errors.length > 20) errors.shift(); };

  const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
  async function sbGet(path) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return r.json();
  }

  /* One-shot claim on the shared discord_post_log, so the gateway bot and the discord-sync
     catch-up can both try the same row and only one message is ever sent. */
  async function claim(ref) {
    const r = await fetch(`${SB_URL}/rest/v1/discord_post_log`, {
      method: "POST", headers: { ...sbHead(), Prefer: "return=minimal" },
      body: JSON.stringify({ kind: "staff_alert", ref }),
    });
    if (r.status === 201) return true;
    if (r.status === 409) return false;      // already announced
    note(new Error(`claim ${ref} -> ${r.status}`));
    return false;                            // anything else: stay quiet rather than double-post
  }
  async function release(ref) {
    try {
      await fetch(`${SB_URL}/rest/v1/discord_post_log?kind=eq.staff_alert&ref=eq.${encodeURIComponent(ref)}`,
        { method: "DELETE", headers: { ...sbHead(), Prefer: "return=minimal" } });
    } catch (e) { note(e); }
  }

  /* Channel + role maps are published by discord-sync, which owns creating the rooms. Cached for
     a minute: a burst of applications should not re-read app_config eight times. */
  let maps = null, mapsAt = 0;
  async function loadMaps() {
    if (maps && Date.now() - mapsAt < 60_000) return maps;
    const rows = await sbGet("app_config?key=in.(discord_dept_channel_ids,discord_dept_role_ids)&select=key,value");
    const out = { chan: {}, role: {} };
    for (const r of rows || []) {
      let v = {}; try { v = JSON.parse(r.value); } catch { v = {}; }
      if (r.key === "discord_dept_channel_ids") out.chan = v || {};
      if (r.key === "discord_dept_role_ids") out.role = v || {};
    }
    maps = out; mapsAt = Date.now();
    return out;
  }

  /* A 404 from Discord returns a body with no id. Treating that as "sent" is how a delivery
     system quietly stops delivering, so demand the message id. */
  async function post(channelId, body) {
    const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST", headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    if (!r.ok) { const e = new Error(`post ${channelId} -> ${r.status}`); e.provable = true; throw e; }
    const j = t ? JSON.parse(t) : null;
    if (!j || !j.id) { const e = new Error(`post ${channelId} did not deliver`); e.provable = true; throw e; }
    return j;
  }

  /* Look up only what the message needs to be readable — a name, a club, a fixture. Never the
     body of a complaint: that stays behind the site's own access control. */
  async function enrich(table, row) {
    const out = {};
    try {
      const pid = row.profile_id || row.nominee_id || null;
      if (pid) {
        const p = await sbGet(`profiles?id=eq.${pid}&select=gamertag,display_name`);
        if (p && p[0]) out.gamertag = p[0].gamertag || p[0].display_name || null;
      }
      if (table === "owner_applications" && row.team_choice) out.teamChoice = row.team_choice;
      if (table === "management_applications" && row.team_id) {
        const t = await sbGet(`teams?id=eq.${row.team_id}&select=code,name`);
        if (t && t[0]) out.club = t[0].code || t[0].name;
      }
      if (table === "game_incidents" && row.game_id) {
        const g = await sbGet(`games?id=eq.${row.game_id}&select=week,home_team_id,away_team_id`);
        if (g && g[0]) {
          const t = await sbGet(`teams?id=in.(${g[0].home_team_id},${g[0].away_team_id})&select=id,code`);
          const by = Object.fromEntries((t || []).map((x) => [x.id, x.code]));
          out.fixture = `${by[g[0].away_team_id] || "?"} @ ${by[g[0].home_team_id] || "?"}${g[0].week != null ? ` · week ${g[0].week}` : ""}`;
        }
      }
    } catch (e) { note(e); }   // a missing name must never stop the alert
    return out;
  }

  async function announce(table, row) {
    try {
      const key = rowKey(table, row);
      if (!key) { sum.skipped++; return "skip"; }
      /* route once WITHOUT enrichment to decide whether this is even ours — cheap, and it means a
         suppressed complaint never triggers a profile lookup */
      const first = route(table, row);
      if (!first) { sum.skipped++; return "skip"; }
      if (first.suppressed) { sum.suppressed++; return `suppressed:${first.suppressed}`; }

      const extra = await enrich(table, row);
      const r = route(table, row, extra);
      if (!r) { sum.skipped++; return "skip"; }
      if (r.suppressed) { sum.suppressed++; return `suppressed:${r.suppressed}`; }

      const targets = r.depts || (r.dept ? [r.dept] : []);
      if (!targets.length) { sum.skipped++; return "skip"; }

      const { chan, role } = await loadMaps();
      let sent = 0, missing = [];
      for (const dept of targets) {
        const cid = chan[dept];
        if (!cid) { missing.push(dept); continue; }
        const ref = `${table}:${key}:${dept}`;
        if (!(await claim(ref))) continue;            // already announced by the other path
        const rid = role[dept];
        const path = DESK_PATH[dept] || "#/hub/staffdesk";
        try {
          await post(cid, {
            content: rid ? `<@&${rid}>` : undefined,
            embeds: [{
              title: `📥 ${r.kind}`,
              description: `${r.line}\n\n${r.cta}\n\n[Open the ${DEPT_LABEL[dept] || "staff"} desk](${SITE}${path})`,
              color: COLOR[dept] || 0x475569,
              footer: { text: "Chel Gaming · staff desk" },
            }],
            /* this post IS for these people, so it pings — but only their role, never @everyone */
            allowed_mentions: rid ? { parse: [], roles: [rid] } : { parse: [] },
          });
          sum.announced++; sent++;
        } catch (e) {
          note(e);
          /* only hand the claim back when Discord provably never took it; a transport error is
             ambiguous and releasing on those is how you double-post */
          if (e && e.provable) await release(ref);
        }
      }
      if (missing.length) note(new Error(`no channel mapped for ${missing.join(",")} — discord-sync publishes discord_dept_channel_ids`));
      return sent ? "announced" : "no-op";
    } catch (e) { note(e); return "error"; }
  }

  /* ---- catch-up ----
     Realtime only delivers to a process that is listening. If this bot was restarting, redeploying,
     or unreachable when a member filed a complaint, that event is simply gone — nothing replays it.
     So the same routing runs on a timer over recently-arrived rows, and the shared claim means a
     row already announced live is skipped rather than repeated.

     The watermark matters as much as the window: without it, the very first run would announce
     every historical application at once. It is stamped the first time this runs and never moved
     backwards, so switching the feature on is silent for everything that predates it. */
  async function catchUp(hours = 24) {
    let watermark = null;
    try {
      const rows = await sbGet("app_config?key=eq.staff_alert_since&select=value");
      if (rows && rows[0] && rows[0].value) watermark = rows[0].value;
      else {
        const nowIso = new Date().toISOString();
        await fetch(`${SB_URL}/rest/v1/app_config`, {
          method: "POST",
          headers: { ...sbHead(), Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ key: "staff_alert_since", value: nowIso }),
        });
        return { swept: 0, announced: 0, seeded: nowIso };   // first run: everything older is history
      }
    } catch (e) { note(e); return { swept: 0, announced: 0, error: true }; }

    const windowStart = new Date(Date.now() - hours * 3600_000).toISOString();
    const since = watermark > windowStart ? watermark : windowStart;
    let swept = 0; const before = sum.announced;
    for (const [table, spec] of Object.entries(TABLE_KEYS)) {
      try {
        /* ea_ingest_log is only work while it is still unmatched; anything since resolved is not */
        const filter = table === "ea_ingest_log" ? "&status=eq.unmatched" : "";
        const rows = await sbGet(`${table}?${spec.ts}=gte.${encodeURIComponent(since)}${filter}&select=*&limit=200`);
        for (const row of rows || []) { swept++; await announce(table, row); }
      } catch (e) { note(e); }
    }
    return { swept, announced: sum.announced - before, since };
  }

  return { announce, route, catchUp, sum, errors, _loadMaps: loadMaps };
}
