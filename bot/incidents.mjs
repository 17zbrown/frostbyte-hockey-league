// Instant game-incident rulings (Rules 3.2 and 4.3).
//
// Late starts and disconnections are argued out in club chats within seconds, so a ruling that
// arrives on the next 2-minute sweep arrives after the argument is over. This listens on
// Supabase Realtime instead: the moment statistics staff log an incident, both clubs are told
// what is owed — the offending club that it owes penalties, the other that the choice of how
// they are served belongs to them.
//
// Kept dependency-free of discord.js so tools/incident-rulings.test.mjs can drive it with a
// stubbed fetch. The realtime subscription is wired in chel-bot.mjs.

/* Rule 3.2 — by the clock. Rule 4.3 — by the occurrence. -1 means the ladder has run out and
   the game is over. KEEP IN SYNC with log_game_incident() in the database, which computes the
   same ladder for the staff desk; this copy exists so the announcement never waits on a round
   trip and never disagrees with what staff were shown. */
export function ruling(inc) {
  const kind = inc.kind, n = inc.occurrence || 1;
  if (kind === "late_start") {
    const m = inc.minutes_late == null ? 0 : inc.minutes_late;
    if (m >= 10) return { penalties: -1, forfeit: true,
      headline: "Forfeit — ten minutes past game time",
      detail: "Rule 3.2: the game is recorded 1-0 for the club that was ready, with no individual statistics. This one is not waivable." };
    if (m >= 8) return { penalties: 2, forfeit: false,
      headline: `Two penalties — ${m} minutes late`,
      detail: "Served at the start of the game. The club that was ready chooses: both at once for a 5-on-3, or one after the other for two 5-on-4s." };
    if (m >= 5) return { penalties: 1, forfeit: false,
      headline: `One penalty — ${m} minutes late`,
      detail: "Served at the start of the game." };
    return { penalties: 0, forfeit: false,
      headline: `Inside the grace period — ${m} minutes late`,
      detail: "Nothing owed. Logged for the record." };
  }
  // disconnections
  if (n >= 3) return { penalties: -1, forfeit: true,
    headline: "Third disconnection — forfeit loss",
    detail: "Rule 4.3: the game ends as a forfeit loss, but ALL statistics are retained. Merge the sessions in the stats desk first, then rule the forfeit keeping the played result. It publishes as an FFL even if this club finished with more goals." };
  const third = (inc.period === 3);
  const early = third && inc.early_third === true;
  if (n === 2) return { penalties: 2, forfeit: false,
    headline: "Second disconnection — two penalties",
    detail: "Taken on the reload. The other club chooses: both at once for a 5-on-3, or one after the other for two 5-on-4s."
      + timingNote(third, early, inc.game_clock) };
  return { penalties: 1, forfeit: false,
    headline: "Disconnection — one penalty",
    detail: "Taken on the reload, within one minute of the game-clock time of the drop."
      + timingNote(third, early, inc.game_clock) };
}

function timingNote(third, early, clock) {
  if (early) return " This drop was inside the first five minutes of the third, so do not replay a full game: reload and play the entire first period as if it were the third, and take the penalties as soon as possible after puck drop.";
  if (third) return ` Third period — take it five minutes of game clock EARLIER than the drop${clock ? ` (${clock})` : ""}, to cover the real time the final minute eats.`;
  return "";
}

export function createIncidentNotifier(env, opts = {}) {
  const { SB_URL, SB_KEY, BOT } = env;
  const UA = "DiscordBot (https://chelgamingleague.com,1.0)";
  const sum = { announced: 0, skipped: 0 };
  const errors = [];
  const note = (e) => { errors.push(String((e && e.message) || e).slice(0, 180)); if (errors.length > 20) errors.shift(); };

  const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
  async function sbGet(path) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return r.json();
  }
  async function post(channelId, body) {
    const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST", headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`post ${channelId} -> ${r.status}`);
    const t = await r.text();
    const j = t ? JSON.parse(t) : null;
    if (!j || !j.id) throw new Error(`post ${channelId} did not deliver`);   // 404 must never read as sent
    return j;
  }

  /* One incident row -> two messages, because the two clubs need different sentences: the club
     that offended needs to know what it owes, and the club that didn't needs to know the choice
     is theirs. Sending one generic message to both would leave the choice unclaimed. */
  async function announce(row) {
    try {
      if (!row || !row.game_id || !row.team_id) { sum.skipped++; return "skip"; }
      const games = await sbGet(`games?id=eq.${encodeURIComponent(row.game_id)}&select=id,week,stage,scheduled_at,home_team_id,away_team_id`);
      const g = games[0];
      if (!g) { sum.skipped++; return "no-game"; }
      const otherId = row.team_id === g.home_team_id ? g.away_team_id : g.home_team_id;
      const teams = await sbGet(`teams?id=in.(${g.home_team_id},${g.away_team_id})&select=id,code,name,discord_channel_id`);
      const mine = teams.find((t) => t.id === row.team_id);
      const other = teams.find((t) => t.id === otherId);
      if (!mine || !other) { sum.skipped++; return "no-clubs"; }

      const r = ruling(row);
      const fixture = `${other.code} vs ${mine.code}${g.week != null ? ` · week ${g.week}` : ""}`;
      const colour = r.forfeit ? 0xC2410C : r.penalties > 0 ? 0xFFE500 : 0x2F9E44;

      // the club that owes
      if (mine.discord_channel_id) {
        await post(mine.discord_channel_id, { embeds: [{
          title: `⚖️ ${r.headline}`,
          description: `**${fixture}**\n\n${r.detail}` +
            (r.penalties > 0 ? `\n\n**${mine.code} owes ${r.penalties} penalt${r.penalties === 1 ? "y" : "ies"}.**` : "") +
            (row.notes ? `\n\n_${row.notes}_` : ""),
          color: colour, footer: { text: "Ruled by league staff from the game incident log." },
        }], allowed_mentions: { parse: [] } });
        sum.announced++;
      }
      // the club that gets the choice
      if (other.discord_channel_id) {
        const yours = r.penalties === 2
          ? `**Your call:** take them both at once for a 5-on-3, or one after the other for two 5-on-4s. Tell ${mine.code} before the puck drops.`
          : r.penalties === 1 ? `${mine.code} takes one penalty. You start on the power play.`
          : r.forfeit ? `This one is ruled in your favour.`
          : `Nothing owed — logged for the record.`;
        await post(other.discord_channel_id, { embeds: [{
          title: `⚖️ ${mine.code}: ${r.headline.toLowerCase()}`,
          description: `**${fixture}**\n\n${yours}` +
            (r.penalties > 0 && !r.forfeit ? `\n\n_Both clubs may agree to waive the penalties — that is between you (Rule 3.2). The ten-minute forfeit is not waivable._` : ""),
          color: colour, footer: { text: "Ruled by league staff from the game incident log." },
        }], allowed_mentions: { parse: [] } });
        sum.announced++;
      }
      return "announced";
    } catch (e) { note(e); return "error"; }
  }

  return { announce, ruling, sum, errors };
}
