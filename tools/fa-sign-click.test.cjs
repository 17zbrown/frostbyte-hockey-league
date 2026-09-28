/* The free-agent Sign button (Team HQ): run the real click handler against a stub page.
   Why this file exists: the handler read `pid` (v3.46) and `lg` (v3.55) without declaring them, so every
   click threw a ReferenceError inside the listener, the confirm dialog never opened, and a manager saw the
   button do nothing with no error at all (reported by the commissioner, 2026-09-28). A text test could not
   catch that; only running the click does. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 300))); } };

const grab = (re, what) => { const m = src.match(re); if (!m) { console.log("FAIL located " + what); process.exit(1); } return m[0]; };
const afterFn = grab(/CG\.AFTER\._hubFreeAgents = function\(\)\{[\s\S]*?\n\};/, "CG.AFTER._hubFreeAgents");
const salFn = grab(/CG\.waivedSalaryOf = function\(pid\)\{[\s\S]*?\n\};/, "CG.waivedSalaryOf");

function run(proCount, opts) {
  opts = opts || {};
  let listener = null, confirmed = null;
  const btn = {
    attrs: { "data-fa-sign": "reg1", "data-name": "Tester" },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(ev, fn) { if (ev === "click") listener = fn; },
    disabled: false
  };
  const roster = [];
  for (let i = 0; i < proCount; i++) roster.push({ squad: "pro", pos: i < (opts.forwards || 0) ? "C" : "LD" });
  roster.push({ squad: "tc" });
  const ctx = {
    console, Math, Object, Array, String, Number, Boolean, JSON, Date, parseInt, Error,
    esc: (v) => String(v),
    location: { hash: "" },
    document: {
      querySelectorAll: (sel) => (sel === "[data-fa-sign]" ? [btn] : []),
      getElementById: () => null
    },
    CG: {
      AFTER: {},
      auth: { user: { id: "u1" } },
      me: () => ({ id: "u1" }),
      TEAMS: [{ code: "DET", owner: "u1" }],
      SEASON: { number: 1 },
      lg: {
        _registrationsRaw: [{ id: "reg1", profile_id: "p1", position: "LW" }],
        _contractsRaw: [{ profile_id: "p1", salary: 1500000, is_manager: false, start_season: 1, end_season: 1, updated_at: "2026-09-01" }],
        byTeam: { DET: roster }
      },
      teamPayroll: () => 30000000, CAP: 50000000, ROSTER_MAX: 15, fmt: () => 15,
      ROSTER_QUOTA: { F: 7, D: 5, G: 3 },
      posGroup: (p) => (p === "G" ? "G" : (p === "LD" || p === "RD") ? "D" : "F"),
      isBasic: () => true,
      fmtMoney: (x) => "$" + (x / 1e6).toFixed(2) + "M",
      confirm: (title, body, label, fn) => { confirmed = { title, body, label, fn }; },
      toast: () => {}, mgmtQueue: () => Promise.resolve(false), sb: { rpc: () => Promise.resolve({}) }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(salFn + "\n" + afterFn + "\nCG.AFTER._hubFreeAgents();", ctx);
  let threw = null;
  try { listener.call(btn); } catch (e) { threw = e; }
  return { threw, confirmed };
}

console.log("\n— the Sign click opens the confirmation");
{
  const r = run(10);
  A("the click does not throw", !r.threw, r.threw && r.threw.message);
  A("...and opens the confirm dialog", !!r.confirmed, r.confirmed);
  A("...naming the player", r.confirmed && /^Sign Tester\?$/.test(r.confirmed.title), r.confirmed && r.confirmed.title);
  A("...at the salary he was earning (read through the registration's profile)", r.confirmed && /at \$1\.50M to the end of the season/.test(r.confirmed.body), r.confirmed && r.confirmed.body);
  A("...onto the roster when it has room", r.confirmed && /He joins your roster the moment you confirm/.test(r.confirmed.body), r.confirmed && r.confirmed.body);
}
console.log("\n— a full active roster sends him to camp");
{
  const r = run(15);
  A("the click does not throw", !r.threw, r.threw && r.threw.message);
  A("...and says training camp", r.confirmed && /He joins your training camp, because your active roster is full/.test(r.confirmed.body), r.confirmed && r.confirmed.body);
}

console.log("\n— a full position group sends him to camp even with room in the total (v3.64)");
{
  const r = run(12, { forwards: 7 });
  A("a winger with seven forwards already up joins camp", r.confirmed && /He joins your training camp/.test(r.confirmed.body), r.confirmed && r.confirmed.body);
  const r2 = run(12, { forwards: 6 });
  A("...with six forwards up he joins the roster", r2.confirmed && /He joins your roster/.test(r2.confirmed.body), r2.confirmed && r2.confirmed.body);
}

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
