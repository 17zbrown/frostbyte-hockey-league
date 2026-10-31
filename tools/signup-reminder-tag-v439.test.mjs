/* v4.39 (2026-10-31). Commissioner: "ensure you tag the not signed up role in the season signup reminders. Re-send the
   announcement." The reminder tags the stored sign-up role (S2 Not Signed Up, v4.38) and nothing else can ping; the
   office gets a ?post=signup-reminder door like the other reminders, because the scheduler's own ?run= is unreachable
   over HTTP (the Edge wrapper builds a fresh request, the Netlify stand-in is a scheduled function). The posted body
   and its allowed_mentions are pinned at runtime in tools/signup-reminder.test.mjs; the copy rules in
   tools/signup-notice-no-ping.test.cjs.
   Run: node tools/signup-reminder-tag-v439.test.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");

console.log("1. The door");
{
  const ops = R("netlify/functions/discord-ops.js"), sched = R("jobs/discord-scheduler.js");
  A("discord-ops imports runSignupReminder", /import \{[^}]*runSignupReminder[^}]*\} from "\.\.\/\.\.\/jobs\/discord-scheduler\.js";/.test(ops));
  A("?post=signup-reminder is key-gated and honors &dry=1",
    /if \(params\.get\("post"\) === "signup-reminder"\) \{\s*if \(!\(await opsKeyOk\(req\)\)\) return notFound\(\);\s*return json\(await runSignupReminder\(\{ dry: params\.get\("dry"\) === "1" \}\)\);/.test(ops));
  A("...and is listed with the other doors", /\?post=signup-reminder\s+send the sign-up reminder now/.test(ops));
  const i = sched.indexOf("export async function runSignupReminder"), fn = sched.slice(i, sched.indexOf("\n}\n", i));
  A("runSignupReminder calls the same step, so the window claim still holds",
    i > 0 && /await signupReminder\(w\.cfg, etParts\(new Date\(\)\), dry, errors, unconfigured\)/.test(fn));
  const body = sched.slice(sched.indexOf("async function signupReminder"));
  A("the step still claims each window once", /if \(!\(await claim\("signup_reminder", windowRef\)\)\) return `already posted this \$\{EVERY\}-day window`;/.test(body));
  A("the ruling is recorded where the old one was", /v4\.39 \(commissioner, 2026-10-31\): "ensure you tag the not signed up role in the season signup reminders\."/.test(sched)
    && /the commissioner removed that ping on 2026-09-08/.test(sched));
}

console.log("\n2. The changelog");
{
  const CG = {}; new Function("CG", R("src/live/part3_content.js"))(CG);
  const e = CG.CONTENT.rulebook.changelog.find((c) => c.version === "4.39") || {};   /* by version: a later release takes changelog[0] */
  const t = JSON.stringify(e);
  A("the changelog has its 4.39 entry", e.dateIso === "2026-10-31" && typeof e.summary === "string" && Array.isArray(e.items) && e.items.length > 0);
  A("...saying the reminder tags the sign-up role", /S2 Not Signed Up/.test(t) && /tag/i.test(t));
  A("...with no dashes, no gendered pronouns, no code identifiers",
    !DASHES.test(t) && !/ - /.test(t) && !/\b(he|his|him|she|her|hers)\b/i.test(t) && !/allowed_mentions|discord_|signup-reminder|runSignup/.test(t));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
