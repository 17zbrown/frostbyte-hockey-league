/* The entry draft: linear rounds, the NHL-lottery order style, and tradeable picks.
   Run: node tools/draft-order.test.cjs

   Commissioner rulings (2026-08-25): the snake is abolished — the pick order holds for every
   round; a new NHL-style lottery orders the draft off the PREVIOUS season (Season 1, having no
   history, falls back to pure random); and picks are tradeable before AND during the draft.

   The DB half is pinned by rolled-back rehearsals against production, which verified:
     · linear: every round carries the identical club order, overall_pick strictly sequential,
       round 2 opening with round 1's first club;
     · nhl_lottery with no prior season -> random with meta.fallback='random';
     · nhl_lottery WITH a (fabricated) prior season -> champion picks last, all playoff clubs in
       the trailing slots, no fallback recorded;
     · accept_trade: a clean pick-only trade flips ownership; an offer whose pick was USED after
       proposing is refused with the stale message — and the rehearsal also exposed that
       accept_trade had NEVER been executable at all (ambiguous unnest aliases crashed the first
       statement), which is now fixed and covered below.
   A second rehearsal round (post-review) verified against production, rolled back:
     · champion detection is SERIES-WINS based and forfeit-aware: an upset, non-sweep final whose
       scoreboard read 3-3 (one win by forfeit) still put the true champion last — the old
       "won a game in the final week" test would have flagged BOTH finalists;
     · a voided decoy game in a later week does not shift the "final week";
     · regenerating the board while a traded pick exists refuses loudly (it used to silently hand
       every pick back to its original club);
     · accept_trade under the new locking (trade row FOR UPDATE, picks row-locked before the
       staleness guard, set-based transfers with rowcount checks) still completes a clean trade
       and still refuses a stale one. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js");
const content = R("src/live/part3_content.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the style list leads with the NHL lottery");
{
  const m = live.match(/CG\.DRAFT_STYLES = \[[\s\S]*?\n\];/);
  A("located DRAFT_STYLES", !!m);
  const styles = [...m[0].matchAll(/\["([a-z_]+)"/g)].map((x) => x[1]);
  A("five styles, nhl_lottery first", styles.length === 5 && styles[0] === "nhl_lottery", styles.join(","));
  A("...its copy names the two-drawing format and the champion-last rule",
    /weighted odds for the top two picks/.test(m[0]) && /champion last/.test(m[0]));
  A("...and says Season 1 falls back to random", /first season with no history falls back to a pure random draw/.test(m[0]));
  A("the radio seeds from the generated board's style, then nhl_lottery",
    (live.match(/CG\._dStyle\|\|\(meta&&meta\.style\)\|\|"nhl_lottery"/g) || []).length === 1);
  A("...and so does the handler",
    (live.match(/CG\._dStyle \|\| \(st && st\.order_meta && st\.order_meta\.style\) \|\| "nhl_lottery"/g) || []).length === 1);
}

console.log("\n— the snake is gone from every surface");
{
  A("no user-facing 'snake' remains in the live client",
    !/snake/i.test(live.replace(/\/\*[\s\S]*?\*\//g, "").replace(/no snake/gi, "").replace(/never a snake/gi, "")));
  A("the generate caption says the order holds", /the same order every round \(like the NHL — never a snake\)/.test(live));
  A("the start-draft copy says the order was locked at generation",
    (live.match(/the order was locked when the board was generated and holds every round/g) || []).length === 2);
  A("the announce body says it too, and mentions mid-draft trading",
    /The order holds for every round \\u2014 no snake\./.test(live) || /The order holds for every round — no snake\./.test(live));
}

console.log("\n— mid-draft trading is surfaced where managers live");
{
  A("the draft desk carries the trading-open banner", /Trading is open all night\./.test(live));
  A("...linking the Trade Hub", /Deal picks — including the one on the clock — or players from the/.test(live));
}

console.log("\n— adversarial-review fixes hold");
{
  A("dStyleName resolves the fallback over the style", /\(meta&&meta\.fallback\)\|\|\(meta&&meta\.style\)/.test(live));
  A("dStyleInSentence spares acronym-led names", /CG\.dStyleInSentence = function\(n\)/.test(live) && /\^\[A-Z\]\{2,\}/.test(live));
  A("no styleName.toLowerCase() survives (was mangling 'NHL')", !/styleName\.toLowerCase\(\)/.test(live));
  A("the announce is honest about a Season-1 fallback",
    /a random draw — with no prior season to weight a lottery, every club had equal odds/.test(live));
  A("...and the body is built from that resolution", live.indexOf('decided by "+decided+"') >= 0);
  A("the order-set chip is fallback-aware", /order set — random draw \(no prior season\)/.test(live));
  A("the header chip resolves through dStyleName", /esc\(CG\.dStyleName\(st\.order_meta\)\)/.test(live));
  /* !used && !skipped is still correct in the draft-flow sites (a skipped pick isn't "next on the
     clock") — only the TRADE picker must not exclude skipped make-up picks. */
  A("tPicks lets skipped make-up picks be traded (Rule 2.8)",
    !/CG\.tPicks[\s\S]{0,400}?!p\.skipped/.test(live));
  A("...and scopes to the current draft season", /return p\.ownerCode===code && !p\.used && \(!dsn \|\| p\.season===dsn\);/.test(live));
  A("unresolvable pick ids render an explicit chip, never 'pick pick'",
    (live.match(/pick no longer available/g) || []).length === 2);
  A("the lottery card states the expansion-club treatment",
    /An expansion club with no record from that season draws as if it finished last/.test(live));
}

console.log("\n— the rulebook states all of it (v2.27)");
{
  const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
  const sec = (id) => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === id) return s.paragraphs.join(" "); throw new Error("no " + id); };
  const r28 = sec("2.8");
  A("Rule 2.8: the same order in every round, never reversing", /same order in every round — the order never reverses/.test(r28));
  A("...five order methods including the NHL lottery", /one of five ways: by an NHL-style draft lottery drawn from the previous season/.test(r28));
  A("...weighted odds for the top two, champion last", /weighted odds for the top two selections/.test(r28) && /the champion last/.test(r28));
  A("...a first season uses a random shuffle", /A first season, having no previous season to draw on, uses a pure random shuffle/.test(r28));
  A("...picks are tradeable before and during the draft", /may be traded under the ordinary trade rules of Rule 2\.4 and Rule 2\.5 — before the draft and during it/.test(r28));
  A("...a traded on-the-clock pick keeps its timer", /including a pick currently on the clock, whose timer continues unchanged/.test(r28));
  A("...and a used pick refuses as stale", /A pick that has already been used cannot be traded/.test(r28));
  A("...and 2.8 states the expansion-club treatment",
    /an expansion club — enters the lottery as if it had finished last/.test(r28));
  A("Chapter 0.5's narrative no longer describes a snake", !/snake/.test(sec("0.5")));
  A("0.5 names the NHL-style lottery as the default",
    /by default through an NHL-style lottery/.test(sec("0.5")));
  A("the changelog records v2.27", rb.changelog.some((c) => c.version === "2.27" && /snake is abolished/.test(c.summary)));
  A("...with dateIso, matching the schema", rb.changelog.every((e) => !!e.dateIso));
}

console.log("\n— the owners' briefings tell the same story");
{
  for (const f of ["CGHL-Season1-Owners-Briefing.md", "CGHL-Season1-Owners-Briefing-DISCORD.txt"]) {
    const b = R(f);
    A(`${f}: linear order, no snake`, /same club order every round \(linear, like the NHL — no snake\)/.test(b) && !/snake order/.test(b));
  }
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
