/* A member who has already signed up must never be told to sign up again — anywhere.
   Run: node tools/registered-hides-signup.test.cjs

   The nav array is built at boot BEFORE auth resolves, so the Register item cannot be gated at
   push time; it is filtered at RENDER time by CG.navVisible(), which also makes it vanish the
   moment someone registers without needing a reload. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const eng = R("src/live/part2_engine.js"), ui = R("src/live/part4_ui.js");
const pub = R("src/live/part5a_public.js"), live = R("src/live/part_live.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— one shared answer, and it is honest about withdrawals");
A("CG.isRegisteredNow exists in the engine", /CG\.isRegisteredNow = function\(\)/.test(eng));
A("...reading the member's own row for the open season", /var r = CG\.auth && CG\.auth\.registration;/.test(eng));
A("...treating a withdrawn sign-up as NOT registered", /st !== "withdrawn" && st !== "removed" && st !== "denied"/.test(eng));
A("CG.navVisible filters the Register item", /n\[1\] !== "#\/register" \|\| !CG\.isRegisteredNow\(\)/.test(eng));

console.log("\n— the chrome that appears on every page");
A("desktop nav renders through navVisible", /CG\.navVisible\(\)\.map\(function\(n\)\{ return '<a href="'\+n\[1\]/.test(ui));
A("mobile nav (the dropdown) renders through navVisible", /var mnav = CG\.navVisible\(\)\.concat\(/.test(ui));
A("the ticker's SIGN UP BY item is gated", /sN\.registration_deadline && !CG\.isRegisteredNow\(\)/.test(ui));
A("the footer's Register link is gated", /registration_open && !CG\.isRegisteredNow\(\) \? '<a class="fl" href="#\/register">/.test(ui));

console.log("\n— the landing page");
A("the hero/slide regOpen gate includes it", /var regOpen = CG\.SEASON && CG\.SEASON\.registration_open && !CG\.isRegisteredNow\(\);/.test(pub));
A("the registration + free-agency strips gate includes it",
  /registration_open && CG\.SEASON\.status !== "active" && !CG\.isRegisteredNow\(\)\);/.test(pub));
A("no un-gated 'Sign up to play' survives", !/(?<!\)\s*\? )'<a class="sec-link" href="#\/register">Sign up to play<\/a>'\s*\+\s*'<\/div>'/.test(pub));
A("the stat card no longer links a registered member to the form", /CG\.isRegisteredNow\(\) \? "#\/players" : "#\/register"/.test(pub));
A("the season-timeline milestone stays but re-points", /CG\.isRegisteredNow\(\) \? "#\/hub" : "#\/register"/.test(pub));
A("the empty-schedule CTA is gated", /CG\.isRegisteredNow\(\) \? '' : '<a class="btn btn-chrome" href="#\/register"/.test(pub));

console.log("\n— the signed-in surfaces");
A("a completed checklist item drops its call to action", /cta: \(regOpen && !registration\) \? "Register to play" : null/.test(live));
A("...and its link", /href: \(regOpen && !registration\) \? "#\/register" : null/.test(live));

console.log("\n— every remaining #/register is behind a gate");
{
  const gated = [];
  [["part4_ui.js", ui], ["part5a_public.js", pub], ["part_live.js", live]].forEach(([n, src]) => {
    src.split("\n").forEach((ln, i) => {
      if (!ln.includes("#/register")) return;
      /* a prompt is gated by the condition it SITS INSIDE, which is often several lines up —
         `if (regOpen && !faLive) {`, a `: regOpen ?` ternary arm, or the `reg ? … : …` branch that
         only runs when there is no registration. Scan the enclosing window, not just the line. */
      const near = src.split("\n").slice(Math.max(0, i - 14), i + 1).join(" ");
      const okLine = /isRegisteredNow|regOpen|!registration|navVisible|NAV\.some|NAV\.push|discord_invite/.test(near)
        || /role\(\)!=="guest"/.test(near)
        || /reg \?|s\.registration_open/.test(near);
      if (!okLine) gated.push(`${n}:${i + 1}`);
    });
  });
  A("no ungated sign-up prompt left", gated.length === 0, gated.join(", "));
}
console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
