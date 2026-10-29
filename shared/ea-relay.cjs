// CommonJS on purpose (see shared/game-window.cjs): netlify/functions/ingest-stats.js is transpiled to CommonJS and
// cannot require() an ES module; the `exports.x =` lines let ESM import these by name too.
//
// v4.34 (2026-10-29): the site's ONE door to EA's Pro Clubs API. EA (behind Akamai) refuses Netlify and Supabase and
// CORS refuses the browser; only the bot's server reaches it. So a Netlify action that needs EA asks here: an answer
// the bot already stored is returned as EA's raw JSON; otherwise a request row is filed in public.ea_lookups (the
// service role; public.guard_ea_lookup caps the site's rate) and the caller answers the browser { eaPending: id }. The
// bot's lane (bot/ea-lookup.mjs) writes the answer onto that row, the browser waits on public.ea_lookup_state(id), and
// calls the action again with { eaLookup: id }, which reads exactly that row here. Commissioner, 2026-10-29: "Also
// this box in the staff desk never works. Can you make sure you check regularly that it works".
//
// db is the caller's own service-role REST pair: { get(path), send(method, path, body, prefer) }, which throw
// "<METHOD> <path> -> <status> <body>" on a failed call (pickup-import.js and ingest-stats.js both do).

const PENDING_REUSE_MS = 60 * 1000;   // a request this young, still unanswered, is joined rather than filed again

/* The ONE definition of what a lookup may ask EA, used here (so a bad input is a plain sentence before any row is
   filed) and by the bot's eaUrl (bot/ea-poll.mjs, so nothing else ever leaves the VM). v4.35: a search is letters,
   numbers, spaces and a little punctuation. Member text reaches EA from the league's only address EA serves, and
   Akamai's firewall may refuse a request whose text looks like an attack (<script>, quotes with =, semicolons); that
   must never be something a member can type. The database guard checks only the length. */
const CLUB_NAME_OK = /^[\p{L}\p{M}\p{N} .'\u2019&_!?#,:-]+$/u;
function cleanArg(kind, arg) {
  /* any run of whitespace (a pasted non-breaking space, a tab) is one plain space, so it is never refused as a symbol */
  const a = String(arg == null ? "" : arg).replace(/\s+/g, " ").trim();
  if (kind === "search") {
    if (a.length < 2) throw new Error("Enter at least 2 characters of the club name.");
    if (a.length > 40) throw new Error("A club name is at most 40 characters.");
    if (!CLUB_NAME_OK.test(a)) throw new Error("Search with the club's name only: letters, numbers, spaces, hyphens and . ' & _ ! ? # , :");
    return a;
  }
  if (kind === "matches") {
    if (!/^[0-9]{1,20}$/.test(a)) throw new Error("That is not an EA club id.");
    return a;
  }
  throw new Error("Unknown EA lookup kind: " + kind);
}

/* the guard's own sentence ("EA lookups: ...") out of PostgREST's error body, else the raw failure */
function plainSendError(e) {
  const m = /EA lookups: ((?:[^"\\]|\\.)*)/.exec(String((e && e.message) || e));
  return m ? new Error(m[1].replace(/\\"/g, '"')) : e;
}

function answerOf(row) {
  if (row.ok === true) return { raw: row.raw, id: row.id, answeredAt: row.answered_at };
  throw new Error(row.error || "The bot server could not look that up on EA. Try again in a minute.");
}

/* -> { raw, id, answeredAt, viaAnswer } with EA's JSON, or { pending: id }. Throws a sentence a staffer can read.
   opts.answerId: the request the browser just waited on (read that row, whatever its age).
   opts.maxAgeMs: how old a stored answer may be and still be used (default 60 s; 0 always asks EA again).
   opts.requestedBy: the signed-in member's profile id (the per-member cap counts it). */
async function eaRelay(db, kind, arg, opts) {
  const o = opts || {};
  const now = o.now || Date.now;
  const a = cleanArg(kind, arg);
  const q = `kind=eq.${kind}&arg=eq.${encodeURIComponent(a)}`;
  const cols = "select=id,created_at,answered_at,ok,error,raw";
  if (o.answerId != null && /^[0-9]{1,20}$/.test(String(o.answerId))) {
    const rows = await db.get(`ea_lookups?id=eq.${o.answerId}&${q}&${cols}`);
    const row = Array.isArray(rows) && rows[0];
    if (row && row.answered_at) return Object.assign(answerOf(row), { viaAnswer: true });
    if (row) return { pending: row.id };
    /* not this question's row (or purged): fall through and ask again */
  }
  const maxAgeMs = o.maxAgeMs == null ? 60 * 1000 : o.maxAgeMs;
  const rows = await db.get(`ea_lookups?${q}&order=id.desc&limit=5&${cols}`);
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.answered_at && row.ok === true && maxAgeMs > 0 && now() - Date.parse(row.answered_at) <= maxAgeMs) {
      return Object.assign(answerOf(row), { viaAnswer: false });
    }
    if (!row.answered_at && now() - Date.parse(row.created_at) <= PENDING_REUSE_MS) return { pending: row.id };
  }
  let made;
  try {
    made = await db.send("POST", "ea_lookups?select=id", { kind, arg: a, source: "site", requested_by: o.requestedBy || null }, "return=representation");
  } catch (e) { throw plainSendError(e); }
  const id = Array.isArray(made) && made[0] && made[0].id;
  if (id == null) throw new Error("The EA lookup request was not filed. Try again.");
  return { pending: id };
}

exports.eaRelay = eaRelay;
exports.cleanArg = cleanArg;
exports.CLUB_NAME_OK = CLUB_NAME_OK;
exports.PENDING_REUSE_MS = PENDING_REUSE_MS;
