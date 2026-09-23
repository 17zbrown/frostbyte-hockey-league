/* v2.88 — the roster's availability, as the front office reads it.
   Run: node tools/availability-grid.test.cjs
 *
 * The grid has always lived on #/hub/availability under the personal form, but its nav entry hung
 * off "availability.submit", which is a PLAYER permission (member|mgmt). A commissioner previewing
 * a club could therefore not reach it from any menu, and when he did reach it the grid keyed on
 * HIS OWN roster spot before the previewed club, so a commissioner who still plays was shown his
 * own club's answers under the previewed club's name.
 */
const fs = require("fs"), path = require("path");
const hub = fs.readFileSync(path.join(__dirname, "..", "src/live/part6_hub.js"), "utf8");
const ui = fs.readFileSync(path.join(__dirname, "..", "src/live/part4_ui.js"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— who may read a club's grid");
{
  A("viewing a team's answers is a management/staff/office permission",
    /"availability\.viewTeam":\s*\["mgmt","staff","commish"\]/.test(ui));
  A("...and submitting is a player one, which is why it could not gate the nav",
    /"availability\.submit":\s*\["member","mgmt"\]/.test(ui));
  A("the grid itself is gated on viewTeam", /if \(CG\.can\("availability\.viewTeam"\)\)\{/.test(hub));
  A("...and the page refuses anyone with neither permission",
    /if \(!CG\.can\("availability\.submit"\) && !CG\.can\("availability\.viewTeam"\)\) return CG\.unauthorized\(\);/.test(hub));
}

console.log("— it is reachable from Team HQ, where a front office looks");
{
  A("the club nav lists Availability for anyone who can read the grid",
    /if \(CG\.can\("availability\.viewTeam"\)\) club\.push\(\["availability","Availability","cal"\]\);/.test(hub));
  A("...and the player's own entry still hangs off submitting",
    /if \(CG\.can\("availability\.submit"\)\) mine\.push\(\["availability","Availability","cal"\]\);/.test(hub));
  /* the club nav drops pages an Owner has hidden; availability must not be swept up by that */
  A("the default access mode for a page with no policy is full, so the entry survives the filter",
    /CG\.mgmtDefaultMode = function\(page\)\{ return page==="management" \? "hidden" : "full"; \};/
      .test(fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8")));
}

console.log("— the grid follows the previewed club");
{
  A("an explicit preview wins over the viewer's own roster spot",
    /var clubCode = \(CG\.previewClub && CG\.previewClub\(\)\) \|\| \(me && me\.team \? me\.team : CG\.myClub\(\)\);/.test(hub));
  A("...and every part of the grid reads that one resolution",
    /var roster = \(lg\.byTeam\[clubCode\]\|\|\[\]\)/.test(hub) &&
    /Team grid — '\+esc\(\(CG\.TEAM\[clubCode\]\|\|\{\}\)\.name\|\|"—"\)/.test(hub) &&
    !/me&&me\.team\?me\.team:CG\.myClub\(\)/.test(hub));
  /* the precedence itself, run rather than read */
  const resolve = (previewClub, meTeam, myClub) => (previewClub && previewClub()) || (meTeam ? meTeam : myClub());
  A("a previewing commissioner who also plays gets the PREVIEWED club", resolve(() => "BOS", "UTA", () => "UTA") === "BOS");
  A("a manager with no preview gets his own club", resolve(() => null, "DAL", () => "DAL") === "DAL");
  A("a commissioner with no roster spot and no preview falls through to myClub", resolve(() => null, null, () => "SEA") === "SEA");
}

console.log("— a club with nobody on it says so");
{
  A("an empty roster gets a line, not an empty table",
    /\(roster\.length \? "" : '<div class="card-b"><p class="caption">No rostered players to show for this club yet\./.test(hub));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
