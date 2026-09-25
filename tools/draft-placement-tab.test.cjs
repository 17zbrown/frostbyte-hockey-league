/* v3.32 — the Draft & placement tab: it shows a season again, it can be switched, and the office
 * can withdraw a sign-up from the season.
 *
 * Commissioner: "that tab is also showing no signups even though we are in the middle of the
 * season. That page should show season we are currently in and I should be able to toggle to the
 * new season when the signups open at the trade deadline." And: "add a button in the Draft &
 * Placement tab to manually remove player signups so I can withdrawal them from the season instead
 * of just making them a free agent."
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 240))); }
}
const live = R("src/live/part_live.js"), rec = R("sql/2026-09-25-withdraw-signup.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the regression that emptied the page");
{
  A("the registrations select no longer asks for the dropped note column",
    !/season_registrations"\)\.select\("[^"]*\bnote\b/.test(live),
    (live.split("\n").find((l) => /season_registrations"\)\.select\(/.test(l) && /\bnote\b/.test(l)) || "").trim());
  A("...and it does ask for the columns the page uses",
    /season_registrations"\)\.select\("id,profile_id,season_id,status,position,scout_ovr,created_at/.test(live));
  A("a failed query is now LOUD instead of an empty pool",
    /CG\.lg\._regLoadError = q\[1\]\.error\.message/.test(live) && /Couldn’t load registrations: /.test(live));
  A("...and it keeps what it already had rather than blanking the board",
    /var regs = \(q\[1\]&&!q\[1\]\.error&&q\[1\]\.data\) \|\| CG\.lg\._registrationsRaw \|\| \[\];/.test(live));
  A("the page says so where the office will see it",
    /The sign-up list did not load\./.test(live) && /may be wrong\. Reload before acting on them\./.test(live));
}

console.log("\n— the season it shows, and the toggle");
{
  A("the renderer takes the query string", /CG\.admPreseason = function\(qs\)\{/.test(live));
  A("the season in the URL wins, otherwise the season being played",
    /\(qs\.season && seasons\.find\(function\(x\)\{ return String\(x\.number\)===String\(qs\.season\); \}\)\)\s*\n\s*\|\| CG\.SEASON/.test(live));
  A("the route passes it through", /param==="preseason"\) return CG\.adminShell\("preseason", CG\.admPreseason\(qs\|\|\{\}\)\)/.test(live));
  A("a switcher renders when there is more than one season", /if \(seasons\.length > 1\)\{/.test(live));
  A("...linking each season by number", /href="#\/admin\/preseason\?season='\+esc\(x\.number\)\+'"/.test(live));
  A("...marking the one being played", /now playing/.test(live));
  A("...and the one taking sign-ups", /x\.registration_open \? '<span class="chip chip-win"[^>]*>sign-ups open/.test(live));
}

console.log("\n— withdrawing a sign-up, which is not the same as declining one");
{
  A("every row that is not a seated manager gets the button",
    /var wdBtn = seatHolder \? ''/.test(live));
  A("...on a declined row", /data-reg-reinstate="'\+r\.id\+'" data-name="'\+nm\+'">Reinstate<\/button>'\+wdBtn/.test(live));
  A("...on a rostered row", /Remove from roster<\/button>'\+wdBtn/.test(live));
  A("...and on an unrostered row", /Decline<\/button>'\+wdBtn\+'<\/span>'/.test(live));
  A("it calls the league-office RPC", /CG\.sb\.rpc\("office_withdraw_registration", \{ p_registration:id/.test(live));
  A("the confirm distinguishes the two cases",
    /This removes the sign-up AND the roster spot with/.test(live) && /This removes the sign-up entirely\./.test(live));
  A("...names the club side effect", /comes off that squad, the club is told in its room, and any contract ends/.test(live));
  A("...says it is archived but not a one-click undo", /it is not a one-click undo/.test(live));
  A("...and points at Decline for the other intent", /To hold someone out of the draft WITHOUT removing him, use Decline instead/.test(live));
  A("a refusal is surfaced verbatim, never a silent no-op", /CG\.toast\("Couldn’t withdraw: "\+r\.error\.message, "err"\)/.test(live));
}

console.log("\n— the record");
{
  A("it quotes both instructions", /showing no signups even though we are in the middle of the season/.test(flat)
    && /instead of just making them a free agent/.test(flat));
  A("it owns the regression and names the version that caused it", /v3\.25 dropped the note column/.test(flat));
  A("...and explains why one unknown column emptied the page",
    /PostgREST refuses the WHOLE query for one unknown column/.test(flat));
  A("...and why nobody noticed", /an error fell back to \[\] and an empty board looks exactly like a league where nobody has signed up/.test(flat));
  A("the withdrawal takes the roster spot with it, and says why",
    /Leaving the spot behind is exactly the .just makes them a free agent. outcome/.test(flat));
  A("a seated manager is refused", /SEATED/.test(flat) && /vacate the seat first/i.test(flat));
  A("the archive is written before the row is deleted", /written BEFORE the row stops existing/.test(flat));
  A("the rehearsal covered all three doors", /ZERO roster spots left/.test(flat)
    && /refused with SEATED/.test(flat) && /refused with\s+NOT_AUTHORIZED/.test(flat));
  A("the NOT IN NULL trap is recorded again, because it bit again", /bit a second time/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
