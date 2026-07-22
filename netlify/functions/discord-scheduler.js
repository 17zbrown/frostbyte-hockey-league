// Netlify Scheduled Function — time-based Discord posts (runs every 5 min, gated to America/New_York,
// de-duped so nothing ever double-posts across the 5-min cadence).
//   (A) #schedule  — Tuesdays 5:00pm ET: the week's slate + 3 featured matchups.
//   (B) #standings — Friday nights, once every game that week is final: a standings snapshot.
//   (C) team private channels — ~30 min before a club's first game of the night: their matchups.
//
// De-dupe: each one-shot post claims a row in public.discord_post_log (unique kind+ref); only the
// first claimant posts. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_BOT_TOKEN. Node 18+.

export const config = { schedule: "*/5 * * * *" };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT = process.env.DISCORD_BOT_TOKEN;
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";

const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${(await r.text()).slice(0, 140)}`);
  return r.json();
}
// Claim a one-shot post; true only for the first caller (unique PK -> 409 for the rest).
async function claim(kind, ref) {
  const r = await fetch(`${SB_URL}/rest/v1/discord_post_log`, {
    method: "POST", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify({ kind, ref }),
  });
  if (r.status === 201) return true;
  if (r.status === 409) return false;
  console.error(`claim ${kind}/${ref} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
  return false; // on any other error, stay safe and don't post
}
// Hand a one-shot claim back so the next tick can retry. Only call this when Discord PROVABLY
// never took the message (non-2xx, or 429s we gave up on) — a transport error is ambiguous, the
// message may well have landed, and releasing on those would double-post.
async function release(kind, ref) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/discord_post_log?kind=eq.${encodeURIComponent(kind)}&ref=eq.${encodeURIComponent(ref)}`,
      { method: "DELETE", headers: { ...sbHead(), Prefer: "return=minimal" } });
    if (!r.ok) console.error(`release ${kind}/${ref} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
  } catch (e) { console.error(`release ${kind}/${ref} -> ${String(e.message || e)}`); }
}
// The single choke point for every Discord delivery, so it is also the only place that decides
// what "delivered" means. Always resolves to an outcome object — never undefined, never a raw
// Response — so an exhausted retry loop can't be mistaken for success by a caller that ignores it.
// `ambiguous` marks the one case where we don't know whether the message landed.
async function postWithRetry(url, headers, payload) {
  const ATTEMPTS = 4;
  for (let i = 0; i < ATTEMPTS; i++) {
    let r;
    try {
      r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    } catch (e) {
      return { ok: false, status: 0, ambiguous: true, error: `network error: ${String(e.message || e)}` };
    }
    if (r.ok) return { ok: true, status: r.status };
    if (r.status !== 429) {
      // A 4xx is a definitive rejection: bad payload, deleted webhook, missing permission. The
      // message did not land, so the claim is safe to release and retry.
      // A 5xx (or the Cloudflare error page that fronts Discord) may mean the message WAS delivered
      // and only the response was lost. Releasing on that would post the same reminder twice, which
      // is a worse outcome than missing one — so it stays claimed.
      const ambiguous = r.status >= 500 || r.status === 408;
      return { ok: false, status: r.status, ambiguous, error: `${r.status} ${(await r.text()).slice(0, 160)}` };
    }
    if (i === ATTEMPTS - 1) break; // out of attempts: don't burn the Retry-After wait we'll never use
    const ra = +(r.headers.get("retry-after") || 1);
    await new Promise((s) => setTimeout(s, (ra + 0.3) * 1000));
  }
  return { ok: false, status: 429, error: `rate limited, gave up after ${ATTEMPTS} attempts` };
}
// Informational posts (the schedule slate, the standings table) name every club, and every club
// name is a role mention — parse:["roles"] would fire a league-wide notification twice a week for
// a table, which trains people to mute the exact channels that later carry game reminders. The
// role pills still RENDER with parse:[], they just don't notify. Pass { ping: true } only when the
// post is genuinely FOR the people it names.
async function postWebhook(url, content, opts = {}) {
  if (!url) return { ok: false, status: 0, error: "no webhook url" };
  return postWithRetry(url, { "Content-Type": "application/json" },
    { content: content.slice(0, 1990), allowed_mentions: opts.ping ? { parse: ["users", "roles"] } : { parse: [] } });
}
// Game reminders go to a club's own private room and are addressed to that club — this ping is
// the whole point of the message, so it keeps parse:["roles"].
async function postChannel(channelId, content) {
  if (!BOT || !channelId) return { ok: false, status: 0, error: BOT ? "no channel id" : "no bot token" };
  return postWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages`,
    { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
    { content: content.slice(0, 1990), allowed_mentions: { parse: ["users", "roles"] } });
}
// This endpoint is publicly HTTP-invocable; debounce anonymous floods (posts are already dedup'd by claim()).
async function ranRecently(key, sec) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/app_config?key=eq.rl_${key}&select=value`, { headers: sbHead() });
    const rows = await r.json();
    const last = rows && rows[0] && rows[0].value ? Date.parse(rows[0].value) : 0;
    if (Date.now() - last < sec * 1000) return true;
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: `rl_${key}`, value: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return false;
  } catch (e) { return false; }
}

// ---- America/New_York time helpers (DST-safe: everything is evaluated in ET) ----
function etParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { wd, hr: (+p.hour) % 24, mi: +p.minute, ymd: `${p.year}-${p.month}-${p.day}` };
}
const fmtTime = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)) + " ET";
const fmtDay = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));

export default async (req) => {
  if (!SB_URL || !SB_KEY) return json({ skipped: "missing supabase env" });
  // ?run=casework|signups bypasses the time gate for a manual check; &dry=1 computes without posting.
  const params = (() => { try { return new URL(req.url).searchParams; } catch { return new URLSearchParams(); } })();
  const forceRun = params.get("run"), dry = params.get("dry") === "1";
  if (!forceRun && await ranRecently("discord-scheduler", 60)) return json({ skipped: "ran moments ago" });
  // Delivery failures land in sum.errors rather than throwing, so a dead standings webhook can't
  // take the game reminders down with it. Both feed the ok/errCount record the Automations chip reads.
  const now = new Date(), et = etParts(now), sum = { errors: [] };
  try {
    const seasons = await sbGet("seasons?select=id,number&order=number.desc&limit=1");
    const season = seasons[0];
    if (!season) return json({ skipped: "no season" });
    const teams = await sbGet("teams?select=id,name,code,division,discord_channel_id,discord_role_id");
    const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
    const cfg = Object.fromEntries((await sbGet("app_config?select=key,value")).map((c) => [c.key, c.value]));
    const games = await sbGet(`games?season_id=eq.${season.id}&select=id,week,home_team_id,away_team_id,scheduled_at,home_score,away_score,went_ot,status,game_code&order=scheduled_at`);

    // (A) weekly schedule — Tuesday 5:00-5:09pm ET
    if (et.wd === 2 && et.hr === 17 && et.mi < 10) sum.schedule = await weeklySchedule(games, teamById, cfg, sum.errors);
    // (B) standings — Friday 11pm ET through Saturday 2am ET, once the week's games are all final
    if ((et.wd === 5 && et.hr >= 23) || (et.wd === 6 && et.hr < 2)) sum.standings = await weeklyStandings(games, teamById, cfg, sum.errors);
    // (C) team reminders — ~30 min before a club's first game of the night
    sum.reminders = await gameReminders(games, teamById, now, sum.errors);
    // (D) casework nudge — daily 12pm ET: @ reviewers who still owe an application vote, and staff
    //     sitting on a claimed case. (E) sign-up reminder — daily 6pm ET: ping the "Not Signed Up" role.
    if (forceRun === "casework" || (et.hr === 12 && et.mi < 10)) sum.casework = await caseworkNudge(cfg, teamById, et, dry, sum.errors);
    if (forceRun === "signups"  || (et.hr === 18 && et.mi < 10)) sum.signups  = await signupReminder(cfg, et, dry, sum.errors);
  } catch (e) { sum.error = String(e.message || e); console.error("discord-scheduler:", sum.error); }
  console.log("discord-scheduler:", JSON.stringify(sum));
  const errs = (sum.error ? [sum.error] : []).concat(sum.errors);
  try {
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "rl_discord-scheduler_result", value: JSON.stringify({
        at: new Date().toISOString(), ok: errs.length === 0, errCount: errs.length, lastError: errs[0] ? String(errs[0]).slice(0, 200) : null
      }), updated_at: new Date().toISOString() }) });
  } catch {}
  return json(sum);
};

function computeStandings(games, teamById) {
  const t = {};
  for (const id in teamById) t[id] = { id, name: teamById[id].name, division: teamById[id].division, gp: 0, w: 0, l: 0, otl: 0, gf: 0, ga: 0, pts: 0 };
  for (const g of games) {
    if (g.status !== "final") continue;
    const h = t[g.home_team_id], a = t[g.away_team_id]; if (!h || !a) continue;
    const hs = g.home_score || 0, as = g.away_score || 0;
    h.gp++; a.gp++; h.gf += hs; h.ga += as; a.gf += as; a.ga += hs;
    if (hs > as) { h.w++; h.pts += 2; if (g.went_ot) { a.otl++; a.pts += 1; } else a.l++; }
    else if (as > hs) { a.w++; a.pts += 2; if (g.went_ot) { h.otl++; h.pts += 1; } else h.l++; }
  }
  return t;
}
const nameOf = (teamById, id) => (teamById[id] || {}).name || "?";
// A club's role mention (pings everyone on the club) when we know its Discord role, else the plain name.
const teamTag = (teamById, id) => { const t = teamById[id] || {}; return t.discord_role_id ? `<@&${t.discord_role_id}>` : (t.name || "?"); };

// Captions are bare noun phrases — the line they land on already reads "AWAY @ HOME — **caption**",
// so a caption with a verb ("visits") has to agree with a club name, and 7 of the 8 are plural.
// Each game carries a RANKED LIST of captions rather than one string: three featured games can
// easily share a headline fact (two same-division games in a week; on opening night every game
// falls into the same one or two early-season buckets), and the list lets the assignment below give
// each game something nobody else took. If a game genuinely has nothing left to say it gets NO
// caption — better a bare matchup line than a repeated one or an invented distinction.
function pickFeatured(weekGames, allGames, teamById) {
  const st = computeStandings(allGames, teamById);
  const finals = allGames.filter((g) => g.status === "final");
  const ranked = Object.values(st).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.gf - b.ga) - (a.gf - a.ga));
  const rank = {}; ranked.forEach((tm, i) => (rank[tm.id] = i + 1));
  const met = (x, y) => finals.some((g) => (g.home_team_id === x && g.away_team_id === y) || (g.home_team_id === y && g.away_team_id === x));
  const scored = weekGames.map((g) => {
    const h = st[g.home_team_id], a = st[g.away_team_id];
    if (!h || !a) return { g, s: -1, whys: [] };
    const sameDiv = h.division && h.division === a.division;
    const whys = [];
    if (finals.length < 6) { // early season: standings aren't meaningful yet, so lead with what is
      const debut = h.gp === 0 && a.gp === 0;
      if (sameDiv) {
        if (debut) whys.push(`${h.division} Division opener`);
        whys.push(`${h.division} Division rivalry`);
        if (!met(g.home_team_id, g.away_team_id)) whys.push(`first ${h.division} Division meeting of the season`);
        whys.push(`${h.division} Division points on the line`);
      } else {
        if (debut) whys.push("cross-division opener");
        whys.push("early-season measuring stick");
        if (!met(g.home_team_id, g.away_team_id)) whys.push("first meeting of the season");
      }
      return { g, s: 2 + (sameDiv ? 5 : 0), whys };
    }
    const gap = Math.abs(h.pts - a.pts), topClash = rank[g.home_team_id] <= 3 && rank[g.away_team_id] <= 3;
    const s = (h.pts + a.pts) - gap * 0.6 + (sameDiv ? 4 : 0) + (topClash ? 8 : 0);
    if (topClash) whys.push(`top-of-the-table clash — #${rank[g.away_team_id]} at #${rank[g.home_team_id]}`);
    if (sameDiv && gap <= 3) whys.push(`${h.division} Division rivalry with seeding on the line`);
    if (sameDiv) whys.push(`${h.division} Division rivalry`);
    if (gap <= 3) whys.push("two clubs neck-and-neck in the table");
    whys.push(`#${rank[g.away_team_id]} at #${rank[g.home_team_id]} in the table`);
    return { g, s, whys };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

  // Highest-scoring game gets first pick of its captions; the rest take the best one still free.
  const top = scored.slice(0, 3), taken = new Set();
  for (const f of top) {
    f.why = f.whys.find((w) => !taken.has(w)) || "";
    if (f.why) taken.add(f.why);
  }
  return top;
}

async function weeklySchedule(games, teamById, cfg, errors) {
  const nowMs = Date.now();
  const wk = games.filter((g) => g.status !== "final" && new Date(g.scheduled_at).getTime() < nowMs + 6 * 864e5 && new Date(g.scheduled_at).getTime() > nowMs - 3600e3);
  if (!wk.length) return "no upcoming games this week";
  const url = cfg.discord_schedule_webhook || cfg.discord_default_webhook;
  if (!url) return "no schedule webhook configured"; // checked before claim() so the slot isn't burned
  const ref = "sched-" + etParts(new Date(wk[0].scheduled_at)).ymd;
  if (!(await claim("weekly_schedule", ref))) return "already posted";
  const tag = (id) => teamTag(teamById, id);
  const byDay = {};
  for (const g of wk) (byDay[fmtDay(g.scheduled_at)] = byDay[fmtDay(g.scheduled_at)] || []).push(g);
  const lines = ["📅 **This Week in the CGHL**", ""];
  for (const day of Object.keys(byDay)) {
    lines.push(`__${day}__`);
    for (const g of byDay[day].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)))
      lines.push(`• ${tag(g.away_team_id)} @ ${tag(g.home_team_id)} — ${fmtTime(g.scheduled_at)}`);
    lines.push("");
  }
  const feat = pickFeatured(wk, games, teamById);
  if (feat.length) {
    lines.push("⭐ **Featured Matchups**");
    for (const f of feat) lines.push(`• ${tag(f.g.away_team_id)} @ ${tag(f.g.home_team_id)}${f.why ? ` — **${f.why}**` : ""}`);
  }
  const res = await postWebhook(url, lines.join("\n"));
  if (!res.ok) {
    errors.push(`weekly schedule: ${res.error}`);
    if (!res.ambiguous) await release("weekly_schedule", ref); // nothing landed — let a later tick retry
    return `post failed: ${res.error}`;
  }
  return `posted ${wk.length} games`;
}

async function weeklyStandings(games, teamById, cfg, errors) {
  const nowMs = Date.now();
  const wk = games.filter((g) => { const t = new Date(g.scheduled_at).getTime(); return t > nowMs - 5 * 864e5 && t <= nowMs; });
  if (!wk.length) return "no games this week";
  if (wk.some((g) => g.status !== "final")) return "week not complete yet"; // re-checks next tick
  const url = cfg.discord_standings_webhook || cfg.discord_default_webhook;
  if (!url) return "no standings webhook configured"; // checked before claim() so the slot isn't burned
  const anchor = wk.reduce((m, g) => (g.scheduled_at > m ? g.scheduled_at : m), wk[0].scheduled_at);
  const ref = "standings-" + etParts(new Date(anchor)).ymd; // stable across the Fri-night / Sat-early window
  if (!(await claim("weekly_standings", ref))) return "already posted";
  const rows = Object.values(computeStandings(games, teamById)).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.gf - b.ga) - (a.gf - a.ga));
  // Ranked list rather than a code block so the club role mentions render as pills (they don't ping).
  const lines = [`🏒 **CGHL Standings** — through ${fmtDay(anchor)}`, ""];
  rows.forEach((t, i) => {
    const diff = (t.gf - t.ga >= 0 ? "+" : "") + (t.gf - t.ga);
    lines.push(`\`${String(i + 1).padStart(2)}\` ${teamTag(teamById, t.id)} — **${t.pts}** PTS · ${t.w}-${t.l}-${t.otl} · ${diff}`);
  });
  const res = await postWebhook(url, lines.join("\n"));
  if (!res.ok) {
    errors.push(`weekly standings: ${res.error}`);
    if (!res.ambiguous) await release("weekly_standings", ref); // nothing landed — let a later tick retry
    return `post failed: ${res.error}`;
  }
  return `posted standings (${rows.length} clubs)`;
}

// A reminder becomes eligible 35 min out and STAYS eligible until puck drop, rather than living in a
// 25-35 min slot. On a healthy */5 cron the first eligible tick is still ~30-35 min out, so the normal
// timing is unchanged — but if that tick is lost to a cold start or a deploy, every later tick is a
// catch-up instead of the reminder vanishing for the night. claim() is what keeps this idempotent:
// the first tick to post takes the (team, night) row and every later tick short-circuits on it, so a
// wider window can never double-post. Games already under way are filtered out above, which is what
// closes the window at puck drop.
const REMINDER_LEAD_MAX = 35;

async function gameReminders(games, teamById, now, errors) {
  const nowMs = now.getTime(), byTeam = {};
  for (const g of games) {
    if (g.status === "final" || new Date(g.scheduled_at).getTime() < nowMs) continue;
    for (const tid of [g.home_team_id, g.away_team_id]) (byTeam[tid] = byTeam[tid] || []).push(g);
  }
  let posted = 0;
  for (const tid in byTeam) {
    const team = teamById[tid]; if (!team || !team.discord_channel_id) continue;
    const list = byTeam[tid].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const firstMs = new Date(list[0].scheduled_at).getTime(), mins = (firstMs - nowMs) / 60000;
    if (mins > REMINDER_LEAD_MAX) continue;
    const nightYmd = etParts(new Date(list[0].scheduled_at)).ymd;
    const tonight = list.filter((g) => etParts(new Date(g.scheduled_at)).ymd === nightYmd);
    const ref = `${tid}:${nightYmd}`;
    if (!(await claim("game_reminder", ref))) continue;
    const nm = (id) => nameOf(teamById, id);
    const lines = [`${teamTag(teamById, tid)} 🚨 **Game night!** You've got ${tonight.length} matchup${tonight.length > 1 ? "s" : ""} tonight:`, ""];
    for (const g of tonight) {
      // the opponent is a club too — render it as its role pill, not bold text
      const oppId = g.home_team_id === tid ? g.away_team_id : g.home_team_id;
      const ha = g.home_team_id === tid ? "vs" : "@";
      lines.push(`• ${ha} ${teamTag(teamById, oppId)} — ${fmtTime(g.scheduled_at)}${g.game_code ? ` · lobby \`${g.game_code}\`` : ""}`);
    }
    // On a catch-up post the lock has already passed, so don't tell them to go set a lineup they can't change.
    lines.push("", mins >= 30
      ? "⏰ Lineups + server picks lock **30 minutes before puck drop** — set yours: https://chelgamingleague.com"
      : `⏰ Puck drop in about ${Math.max(1, Math.round(mins))} min — lineups + server picks are already locked: https://chelgamingleague.com`);
    const res = await postChannel(team.discord_channel_id, lines.join("\n"));
    if (!res.ok) {
      errors.push(`game reminder ${team.name || tid}: ${res.error}`);
      if (!res.ambiguous) await release("game_reminder", ref); // nothing landed — a later tick can still catch it
      continue;
    }
    posted++;
  }
  return `sent ${posted} reminder(s)`;
}

// (D) Daily nudge to #staff-casework: for every pending application, @ the reviewers who still owe a
// vote; for every claimed-but-unresolved case, @ the assignee. Posts only when something's outstanding.
async function caseworkNudge(cfg, teamById, et, dry, errors) {
  const url = cfg.discord_staff_casework_webhook || cfg.discord_default_webhook;
  if (!url) return "no casework webhook";
  const [profs, links, oa, sa, ma, ballots, cases] = await Promise.all([
    sbGet("profiles?select=id,role,departments,gamertag"),
    sbGet("discord_links?select=profile_id,discord_id"),
    sbGet("owner_applications?status=eq.pending&select=id,profile_id"),
    sbGet("staff_applications?status=eq.pending&select=id,profile_id"),
    sbGet("management_applications?status=eq.pending&select=id,role,team_id,nominee_id"),
    sbGet("application_ballots?select=app_type,application_id,voter_id"),
    sbGet("action_requests?status=not.in.(resolved,denied)&assigned_to=not.is.null&select=id,subject,type,assigned_to"),
  ]);
  const did = Object.fromEntries(links.filter((l) => l.discord_id).map((l) => [l.profile_id, l.discord_id]));
  const gt = Object.fromEntries(profs.map((p) => [p.id, p.gamertag || "a member"]));
  const mention = (pid) => (did[pid] ? `<@${did[pid]}>` : `**${gt[pid] || "a reviewer"}**`);
  const reviewers = profs.filter((p) => (p.role === "staff" || p.role === "commissioner") && Array.isArray(p.departments) && p.departments.includes("applications"));
  const votedBy = {};
  for (const b of ballots) (votedBy[b.app_type + ":" + b.application_id] = votedBy[b.app_type + ":" + b.application_id] || new Set()).add(b.voter_id);

  const appLines = [];
  const owe = (key) => reviewers.filter((r) => !(votedBy[key] || new Set()).has(r.id));
  // the applicant/nominee and their club are named here too — all three render as mentions
  for (const a of oa) { const o = owe("owner:" + a.id); if (o.length) appLines.push(`• **Owner application** — ${mention(a.profile_id)} · still needs: ${o.map((r) => mention(r.id)).join(" ")}`); }
  for (const a of sa) { const o = owe("staff:" + a.id); if (o.length) appLines.push(`• **Staff application** — ${mention(a.profile_id)} · still needs: ${o.map((r) => mention(r.id)).join(" ")}`); }
  for (const a of ma) {
    const o = owe("management:" + a.id); if (!o.length) continue;
    appLines.push(`• **${a.role === "gm" ? "GM" : "AGM"} application** — ${mention(a.nominee_id)} (${teamTag(teamById, a.team_id)}) · still needs: ${o.map((r) => mention(r.id)).join(" ")}`);
  }
  const caseLines = cases.map((c) => `• ${c.subject || c.type || "Case"} · ${mention(c.assigned_to)}`);

  if (!appLines.length && !caseLines.length) return "nothing outstanding";
  const lines = ["🗳️ **League office — items awaiting you**"];
  if (appLines.length) { lines.push("", "__Applications awaiting your vote__", ...appLines); }
  if (caseLines.length) { lines.push("", "__Claimed cases awaiting a ruling__", ...caseLines); }
  lines.push("", "Open the Staff Desk to act: https://chelgamingleague.com/#/hub/staffdesk");
  const content = lines.join("\n");
  if (dry) return { would_post: content, apps: appLines.length, cases: caseLines.length };
  if (!(await claim("casework_nudge", et.ymd))) return "already posted today";
  const res = await postWebhook(url, content, { ping: true });
  if (!res.ok) { errors.push(`casework nudge: ${res.error}`); if (!res.ambiguous) await release("casework_nudge", et.ymd); return `post failed: ${res.error}`; }
  return `nudged (${appLines.length} apps, ${caseLines.length} cases)`;
}

// (E) Daily #season-signups reminder while registration is open: one clean ping of the bot-maintained
// "Not Signed Up" role (discord-sync keeps its membership current). Skips when nobody's left.
async function signupReminder(cfg, et, dry, errors) {
  const url = cfg.discord_signup_webhook || cfg.discord_default_webhook;
  const roleId = cfg.discord_not_signed_up_role_id;
  if (!url) return "no signup webhook";
  if (!roleId) return "not-signed-up role not provisioned yet";
  const s = (await sbGet("seasons?select=id,name,registration_open,signup_deadline_at,registration_deadline&order=number.desc&limit=1"))[0];
  if (!s) return "no season";
  const deadline = s.signup_deadline_at || s.registration_deadline;
  if (!(s.registration_open && (!deadline || Date.now() < Date.parse(deadline)))) return "registration closed";
  const [members, regs] = await Promise.all([
    sbGet("profiles?select=id&role=eq.member&banned=eq.false&in_guild=eq.true"),
    sbGet(`season_registrations?season_id=eq.${s.id}&select=profile_id`),
  ]);
  const reg = new Set(regs.map((r) => r.profile_id));
  const remaining = members.filter((m) => !reg.has(m.id)).length;
  if (remaining === 0) return "everyone signed up";
  const content = `⏰ **${s.name} sign-ups are open!** <@&${roleId}> — you haven't registered yet.\n` +
    `Grab your spot${deadline ? ` before **${fmtDay(deadline)}**` : ""}: https://chelgamingleague.com/#/register`;
  if (dry) return { would_post: content, remaining };
  if (!(await claim("signup_reminder", et.ymd))) return "already posted today";
  const res = await postWebhook(url, content, { ping: true });
  if (!res.ok) { errors.push(`signup reminder: ${res.error}`); if (!res.ambiguous) await release("signup_reminder", et.ymd); return `post failed: ${res.error}`; }
  return `pinged the not-signed-up role (${remaining} remaining)`;
}

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }
