/* The #member-departures post — ONE definition, shared by the 2-minute sweep
   (netlify/functions/discord-sync.js) and the gateway bot (bot/handlers.mjs), so the two lanes can
   never say different things about the same person.

   The room is public (Information, beside #welcome) since 2026-09-13, so the post reads like a
   league notice, not a forensic log: who left, what they were to the league (their club seat,
   roster spot, staff department, or sign-up), and how long they were with us. No Discord ids, no
   "never signed in" — the office has guild_departures for that.

   `card` is what public.member_league_card(discord_id) returns:
     { linked, gamertag, kind: commissioner|management|staff|player|signed_up|member|none,
       standing: "General Manager of the Boston Bruins" | ..., club_code, club, registered } */

export function daysWording(days) {
  if (days == null) return null;
  if (days === 0) return "less than a day";
  if (days === 1) return "1 day";
  if (days < 60) return days + " days";
  const months = Math.round(days / 30);
  return months + " month" + (months === 1 ? "" : "s");
}

/* the line under the name — what they were to the league */
export function standingLine(card) {
  if (!card || !card.linked) return "They never joined the league site, so they were here as a visitor.";
  const s = card.standing || "A member of the league site";
  switch (card.kind) {
    case "commissioner": return s + ".";
    case "management":   return s + " — the club's front office has an open seat.";
    case "staff":        return s + ".";
    case "player":       return s + ".";
    case "signed_up":    return s + ".";
    default:             return s + (card.registered ? ", signed up to play." : ".");
  }
}

export function buildDepartureEmbed({ who, card, days }) {
  const name = String(who || (card && card.gamertag) || "A member");
  const tag = card && card.linked && card.gamertag && card.gamertag !== name ? " (" + card.gamertag + " on the site)" : "";
  const d = daysWording(days);
  const lines = [standingLine(card)];
  if (d) lines.push("With us for " + d + ".");
  lines.push("The door stays open — anyone who leaves can come back through the invite on the site.");
  return {
    title: "👋 " + name + tag + " has left the server",
    description: lines.join("\n"),
    color: card && card.kind === "management" ? 0xFFE500 : 0xC2410C,
    timestamp: new Date().toISOString()
  };
}
