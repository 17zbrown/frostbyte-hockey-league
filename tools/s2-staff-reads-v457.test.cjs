/* v4.57: the Season 2 site's office reads (sql/2026-11-24-s2-staff-reads-v457.sql): s2_desk (staff and commissioners),
   s2_control (commissioners), both SECURITY INVOKER, and ops_job_health (commissioners, SECURITY DEFINER). Each one's
   first statement is a gate raising 42501, so a wrong caller fails loudly instead of reading zeros; they return counts
   and the existing staff readers, never case text, audit detail, cron commands, app_config values or Discord names. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 220))); } };
const REC = "sql/2026-11-24-s2-staff-reads-v457.sql";
const sql = R(REC), reh = R(REC.replace(/\.sql$/, ".rehearsal.sql"));
const fnText = (f) => { const i = sql.indexOf("create or replace function public." + f + "()"); return i < 0 ? "" : sql.slice(i, sql.indexOf("$function$;", i) + 11); };
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "''");
const desk = fnText("s2_desk"), control = fnText("s2_control"), ops = fnText("ops_job_health");

A("found all three", !!desk && !!control && !!ops);
A("s2_desk and s2_control: plpgsql, STABLE, SECURITY INVOKER, search_path ''", [desk, control].every((t) => /returns jsonb\n language plpgsql\n stable\n security invoker\n set search_path to ''/.test(t)));
A("ops_job_health: plpgsql, STABLE, SECURITY DEFINER, search_path ''", /returns jsonb\n language plpgsql\n stable\n security definer\n set search_path to ''/.test(ops));
A("the gate is the first statement, raising 42501", /as \$function\$\nbegin\n  if not \(public\.is_staff\(\) or public\.is_commissioner\(\)\) then\n    raise exception 'staff only' using errcode = '42501';/.test(desk) &&
  [control, ops].every((t) => /as \$function\$\nbegin\n  if not public\.is_commissioner\(\) then\n    raise exception 'commissioners only' using errcode = '42501';/.test(t)));
A("authenticated only: PUBLIC, anon and authenticated revoked, authenticated granted", ["s2_desk", "s2_control", "ops_job_health"].every((f) =>
  sql.includes("revoke all on function public." + f + "() from public, anon, authenticated;\ngrant execute on function public." + f + "() to authenticated;")));
A("every table is schema-qualified", ![desk, control, ops].some((t) => /\b(from|join) (?!public\.|cron\.|jsonb_object_keys|jsonb_array_elements)[a-z_]+\b/.test(code(t).replace(/epoch from/g, ""))));

// what each one reads, and never
A("s2_desk: case counts by type, status and route; never subject, details or response", /group by ar\.type, ar\.status, ar\.route/.test(desk) && !/ar\.(subject|details|response|target)\b/.test(code(desk)));
A("s2_desk: application counts by kind, season, role and status; never the text", /group by s\.number, oa\.status/.test(desk) && /group by ma\.role, ma\.status/.test(desk) &&
  !/\b(oa|sa|ma)\.(pitch|experience|availability|response|timezone|ea_id|departments)\b/.test(code(desk)));
A("s2_desk: ballot counts per application, never a voter or a note", /count\(\*\) filter \(where b\.vote = 'approve'\) approve/.test(desk) && !/b\.(voter_id|note)\b/.test(code(desk)));
A("s2_desk: audit counts by action, never detail, actor or target", /group by au\.action/.test(desk) && !/au\.(detail|actor|target_id|target_type)\b/.test(code(desk)));
A("s2_desk: the staff readers it already has, and media_only", /'ea_import', public\.ea_import_issues\(\)/.test(desk) && /'attention', public\.staff_needs_attention\(\)/.test(desk) &&
  /'staff', public\.staff_directory\(\)/.test(desk) && /'activity', public\.staff_activity\(20\)/.test(desk) && /'media_only', public\.is_media_only_staff\(auth\.uid\(\)\)/.test(desk));
A("s2_control: member_pop_stats plus counts; never a Discord id, name or display name", /'pop', public\.member_pop_stats\(\)/.test(control) &&
  !/\b(gm|gd)\.(discord_id|username|display_name|had_roles|noticed_by)\b/.test(code(control)));
A("s2_control: days by league time (America/New_York)", (control.match(/at time zone 'America\/New_York'/g) || []).length === 4);
A("ops_job_health: never a command, return message, username, error text or app_config value", !/\b(j|d|x)\.(command|return_message|username|database|nodename)\b/.test(code(ops)) &&
  !/\bc\.value\b/.test(code(ops)) && /'failing', h\.last_error is not null/.test(ops) && !/'last_error'/.test(ops));
A("ops_job_health: the latest run by the highest runid (no jobid index to sort on)", /select x\.jobid, max\(x\.runid\) runid from cron\.job_run_details x group by x\.jobid/.test(ops));
A("ops_job_health: heartbeats are the rl_% keys' ages", /'age_seconds',\s+round\(extract\(epoch from now\(\) - c\.updated_at\)\)\)/.test(ops) && /where c\.key like 'rl\\_%'/.test(ops));
A("league days are labeled with AS (day is a keyword)", !/::date day\b/.test(control) && (control.match(/::date as day/g) || []).length === 3);

// self-checks and rehearsal
A("self-checks: grants, search_path, gate first, a nobody refused, security modes, no command or value read",
  ["authenticated only", "search_path must be", "the gate is not the first statement", "a caller who is nobody was not refused",
   "must be SECURITY INVOKER, ops_job_health SECURITY DEFINER", "ops_job_health reads a command, a message or a value"].every((t) => sql.includes(t)));
A("rehearsal: anon, a member, a staffer, a media-only staffer and a commissioner against all three", /array\['anon', 'member', 'staff', 'media', 'commissioner'\]/.test(reh) &&
  /"commissioner": \{"s2_desk": true, "s2_control": true, "ops_job_health": true\}/.test(reh) && /"media":      \{"s2_desk": true,  "s2_control": false, "ops_job_health": false\}/.test(reh));
A("rehearsal: 42501 only where intended, everything else re-raised", /if sqlstate <> '42501' or \(v_expect->v_who->>f\)::boolean then raise; end if;/.test(reh) && !/exception when others then null/.test(reh));
A("rehearsal: media_only, the case counts each staffer reads, under 1 s, ends in an uncaught REHEARSAL OK", /s2_desk media_only is %/.test(reh) && /if v_ms >= 1000 then raise exception/.test(reh) &&
  /raise exception 'REHEARSAL OK: % Cases a staffer counts: %; a media-only staffer: %\. Slowest call % ms\.',/.test(reh) && /end \$r\$;\s*$/.test(reh));
A("rehearsal: no dblink, no http, no commit", !/dblink|http_post|http_get|\bcommit\b/i.test(reh.replace(/--.*$/gm, "")));
A("the record carries its rehearsal block", /\/\* REHEARSAL/.test(sql));
const applied = sql.slice(0, sql.indexOf("\n/* REHEARSAL") + 1);   // what the migration runs; results are appended after it
A("rehearsal: the record's text verbatim, inside the transaction, before the cases", reh.indexOf(applied) > reh.indexOf("\nbegin;\n") &&
  reh.indexOf(applied) + applied.length <= reh.indexOf("do $r$"));

console.log(`\n${n - fail}/${n} passed`);
if (fail) process.exit(1);
