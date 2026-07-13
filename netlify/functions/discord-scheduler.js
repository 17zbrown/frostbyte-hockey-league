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
async function postWebhook(url, content) {
  if (!url) return;
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 1990), allowed_mentions: { parse: ["users", "roles"] } }) });
}
async function postChannel(channelId, content) {
  if (!BOT || !channelId) return;
  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST", headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 1990), allowed_mentions: { parse: ["users", "roles"] } }) });
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

export default async () => {
  if (!SB_URL || !SB_KEY) return json({ skipped: "missing supabase env" });
  const now = new Date(), et = etParts(now), sum = {};
  try {
    const seasons = await sbGet("seasons?select=id,number&order=number.desc&limit=1");
    const season = seasons[0];
    if (!season) return json({ skipped: "no season" });
    const teams = await sbGet("teams?select=id,name,code,division,discord_channel_id,discord_role_id");
    const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
    const cfg = Object.fromEntries((await sbGet("app_config?select=key,value")).map((c) => [c.key, c.value]));
    const games = await sbGet(`games?season_id=eq.${season.id}&select=id,week,home_team_id,away_team_id,scheduled_at,home_score,away_score,went_ot,status,game_code&order=scheduled_at`);

    // (A) weekly schedule — Tuesday 5:00-5:09pm ET
    if (et.wd === 2 && et.hr === 17 && et.mi < 10) sum.schedule = await weeklySchedule(games, teamById, cfg);
    // (B) standings — Friday 11pm ET through Saturday 2am ET, once the week's games are all final
    if ((et.wd === 5 && et.hr >= 23) || (et.wd === 6 && et.hr < 2)) sum.standings = await weeklyStandings(games, teamById, cfg);
    // (C) team reminders — ~30 min before a club's first game of the night
    sum.reminders = await gameReminders(games, teamById, now);
  } catch (e) { sum.error = String(e.message || e); console.error("discord-scheduler:", sum.error); }
  console.log("discord-scheduler:", JSON.stringify(sum));
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

function pickFeatured(weekGames, allGames, teamById) {
  const st = computeStandings(allGames, teamById);
  const finalCount = allGames.filter((g) => g.status === "final").length;
  const ranked = Object.values(st).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.gf - b.ga) - (a.gf - a.ga));
  const rank = {}; ranked.forEach((tm, i) => (rank[tm.id] = i + 1));
  const nm = (id) => nameOf(teamById, id);
  const scored = weekGames.map((g) => {
    const h = st[g.home_team_id], a = st[g.away_team_id];
    if (!h || !a) return { g, s: -1, why: "" };
    const sameDiv = h.division && h.division === a.division;
    if (finalCount < 6) { // early season: standings not meaningful yet
      return { g, s: 2 + (sameDiv ? 5 : 0), why: sameDiv ? `${h.division} Division rivalry` : "an early-season measuring stick" };
    }
    const gap = Math.abs(h.pts - a.pts), topClash = rank[g.home_team_id] <= 3 && rank[g.away_team_id] <= 3;
    const s = (h.pts + a.pts) - gap * 0.6 + (sameDiv ? 4 : 0) + (topClash ? 8 : 0);
    let why;
    if (topClash) why = `top-of-the-table clash — #${rank[g.away_team_id]} ${nm(g.away_team_id)} at #${rank[g.home_team_id]} ${nm(g.home_team_id)}`;
    else if (sameDiv && gap <= 3) why = `${h.division} Division rivalry with seeding on the line`;
    else if (sameDiv) why = `${h.division} Division rivalry`;
    else if (gap <= 3) why = "two clubs neck-and-neck in the table";
    else why = `#${rank[g.away_team_id]} ${nm(g.away_team_id)} visits #${rank[g.home_team_id]} ${nm(g.home_team_id)}`;
    return { g, s, why };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.slice(0, 3);
}

async function weeklySchedule(games, teamById, cfg) {
  const nowMs = Date.now();
  const wk = games.filter((g) => g.status !== "final" && new Date(g.scheduled_at).getTime() < nowMs + 6 * 864e5 && new Date(g.scheduled_at).getTime() > nowMs - 3600e3);
  if (!wk.length) return "no upcoming games this week";
  const ref = "sched-" + etParts(new Date(wk[0].scheduled_at)).ymd;
  if (!(await claim("weekly_schedule", ref))) return "already posted";
  const tag = (id) => teamTag(teamById, id);
  const byDay = {};
  for (const g of wk) (byDay[fmtDay(g.scheduled_at)] = byDay[fmtDay(g.scheduled_at)] || []).push(g);
  const lines = ["📅 **This Week in the Chel Gaming League**", ""];
  for (const day of Object.keys(byDay)) {
    lines.push(`__${day}__`);
    for (const g of byDay[day].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)))
      lines.push(`• ${tag(g.away_team_id)} @ ${tag(g.home_team_id)} — ${fmtTime(g.scheduled_at)}`);
    lines.push("");
  }
  const feat = pickFeatured(wk, games, teamById);
  if (feat.length) {
    lines.push("⭐ **Featured Matchups**");
    for (const f of feat) lines.push(`• ${tag(f.g.away_team_id)} @ ${tag(f.g.home_team_id)} — **${f.why}**`);
  }
  await postWebhook(cfg.discord_schedule_webhook || cfg.discord_default_webhook, lines.join("\n"));
  return `posted ${wk.length} games`;
}

async function weeklyStandings(games, teamById, cfg) {
  const nowMs = Date.now();
  const wk = games.filter((g) => { const t = new Date(g.scheduled_at).getTime(); return t > nowMs - 5 * 864e5 && t <= nowMs; });
  if (!wk.length) return "no games this week";
  if (wk.some((g) => g.status !== "final")) return "week not complete yet"; // re-checks next tick
  const anchor = wk.reduce((m, g) => (g.scheduled_at > m ? g.scheduled_at : m), wk[0].scheduled_at);
  const ref = "standings-" + etParts(new Date(anchor)).ymd; // stable across the Fri-night / Sat-early window
  if (!(await claim("weekly_standings", ref))) return "already posted";
  const rows = Object.values(computeStandings(games, teamById)).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.gf - b.ga) - (a.gf - a.ga));
  const lines = [`🏒 **Chel Gaming League Standings** — through ${fmtDay(anchor)}`, "```",
    "#  CLUB                  GP  W  L OTL  PTS  DIFF"];
  rows.forEach((t, i) => {
    const diff = (t.gf - t.ga >= 0 ? "+" : "") + (t.gf - t.ga);
    lines.push(`${String(i + 1).padStart(2)} ${t.name.slice(0, 21).padEnd(21)} ${String(t.gp).padStart(2)} ${String(t.w).padStart(2)} ${String(t.l).padStart(2)} ${String(t.otl).padStart(3)} ${String(t.pts).padStart(4)}  ${diff.padStart(4)}`);
  });
  lines.push("```");
  await postWebhook(cfg.discord_standings_webhook || cfg.discord_default_webhook, lines.join("\n"));
  return `posted standings (${rows.length} clubs)`;
}

async function gameReminders(games, teamById, now) {
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
    if (mins < 25 || mins > 35) continue; // only fire ~30 min before the night's first game
    const nightYmd = etParts(new Date(list[0].scheduled_at)).ymd;
    const tonight = list.filter((g) => etParts(new Date(g.scheduled_at)).ymd === nightYmd);
    if (!(await claim("game_reminder", `${tid}:${nightYmd}`))) continue;
    const nm = (id) => nameOf(teamById, id);
    const lines = [`${teamTag(teamById, tid)} 🚨 **Game night!** You've got ${tonight.length} matchup${tonight.length > 1 ? "s" : ""} tonight:`, ""];
    for (const g of tonight) {
      const opp = g.home_team_id === tid ? nm(g.away_team_id) : nm(g.home_team_id);
      const ha = g.home_team_id === tid ? "vs" : "@";
      lines.push(`• ${ha} **${opp}** — ${fmtTime(g.scheduled_at)}${g.game_code ? ` · lobby \`${g.game_code}\`` : ""}`);
    }
    lines.push("", "⏰ Lineups + server picks lock **30 minutes before puck drop** — set yours: https://chelgamingleague.com");
    await postChannel(team.discord_channel_id, lines.join("\n"));
    posted++;
  }
  return `sent ${posted} reminder(s)`;
}

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }
