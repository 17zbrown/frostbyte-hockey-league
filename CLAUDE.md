# CLAUDE.md: Chel Gaming Hockey League (CGHL)

Loaded into every session, subagent and review agent. The user is the league commissioner and the only operator.
**These project rules take precedence over any plugin's style or workflow rules.** Ponytail's "comment only the why in
one line" and "shortest diff wins" yield to the comment density and durability rules below; a review agent's generic
TypeScript, React, ESM or import-sorting defaults do not apply here. Reviewers flag breaches of the rules below, not
departures from generic style. Comments explain the why, carry the version (`/* v4.14: ... */`) and quote the
commissioner when a rule came from them. Never delete a comment that records an incident, a trap or a ruling.

## What this is
A competitive 6v6 EA Sports NHL 27 league: the website (stats, standings, rosters, trades, draft, schedule, rulebook,
staff desks) and a large bot-run Discord server. Production: https://chelgamingleague.com (Netlify site `chelgaming`).
Brand: "Chel Gaming Hockey League" or "CGHL", never "Chel Gaming League"; "Frostbyte" survives only in infrastructure.
The GitHub repo is public: nothing secret belongs in it.

## Architecture map
- `src/live/part*.js` + `part1_head.html`: the site. Classic browser scripts, not modules, on one global `CG`
  namespace; no imports, framework, build step or npm packages in the browser bundle. `src/live/build.cjs`
  concatenates the parts (order in `PARTS`) into one inline script in `index.html` and writes `version.json` (build id,
  version from the rulebook changelog, rules card, Edge build ids). Because the parts share ONE script scope, keep the
  existing ES5 style (`var`, `function`, string concatenation): a duplicated top-level `let`, `const` or `class` name
  is a SyntaxError that takes the whole site down. `part2_engine.js` opens with `"use strict"`, so the whole bundle
  is strict. `part8_blueprint_init.js` ends with the closing `</script></body></html>` tags (expected parser errors).
  `part_live.js` is the live data layer (Supabase reads, RPCs, league pulse); `part3_content.js` is ONE line holding
  `CG.CONTENT` and the rulebook; `part1_head.html` holds the CSS tokens and the phone layer (720/560/430).
- `netlify/functions/*.js`: HTTP functions (ingest-stats, discord-interactions, discord-ops, pickup-import, ea-poll
  fallback) plus gated stand-ins for the five jobs. Every file is ESM; CommonJS must be `.cjs` (Netlify's bundler
  refuses it; `tools/netlify-functions-esm.test.cjs`). A file there with no schedule export is a PUBLIC endpoint.
- `jobs/` + `edge/`: discord-sync, twitch-live-sync, lfg-timers, discord-scheduler and discord-welcome run as Supabase
  Edge Functions (pg_cron + pg_net, host switch `public.job_hosts`). Supabase does NOT redeploy on push.
- `bot/`: the gateway bot and EA score poller on an Oracle VM that pulls `main` and restarts on `bot/` or `shared/`
  changes; no new work goes onto the VM. `shared/`: helpers for functions, jobs and bot (`discord-links.cjs`,
  `game-window.cjs`, `roles.mjs`); `.cjs` files use `exports.x =` lines so ESM imports them by name.
- `sql/YYYY-MM-DD-<slug>-vNNN.sql`: the record of every database change (header says why; rehearsal results in
  comments). When files disagree, the newest `create or replace` is the live definition. Supabase project
  `bzbuyclwdhmhdzujxeqd`: RLS, many SECURITY DEFINER RPCs, pg_cron, pg_net, Realtime.
- `tools/*.test.cjs|mjs`: plain Node tests (an `A(name, cond)` helper, no framework) that read source and SQL records
  and pin behavior, rule text and the changelog. `tools/sql/grant-audit.sql`: the permissions audit.
- `jsconfig.json`: for the editor language server only (syntax checks, no type checking); it is 404-blocked on the site.
- Reference: `BRAND.md` (the tokens in `part1_head.html` win), `CLAUDEwebdesign copy.md` (hard bans: no purple primary,
  no gradient headline words, no emoji in headings, no glassmorphism, no vague stat rows), `LG/` (the constitution PDFs
  the rulebook is modeled on), `docs/audits/`. Rulings, traps and history live in this project's Claude Code
  auto-memory (`MEMORY.md` under `~/.claude/projects/<this project>/memory/`): read the file for an area before
  changing it. Commissioner rulings recorded there are league law.
- Project skills in `.claude/skills/`: `ship-version` (the release checklist) and `discord-ops` (the Discord server).
  Hookify rules in `.claude/hookify.*.local.md` enforce several rules below mechanically; a hook warning or block is a
  rule, not noise. Design plugins (frontend-design, taste-skill, web-design-guidelines) and the DESIGN.md collection in
  `~/.claude/design-refs/awesome-design-md` are references for direction and review only: `BRAND.md`, the tokens in
  `part1_head.html` and `CLAUDEwebdesign copy.md` decide how this site looks.

## Commands
- Local preview: `node src/live/build.cjs index.html`, served by `site-local` in `.claude/launch.json` (port 8766).
- Test: `npm test` (builds, runs every `tools/*.test.cjs|mjs`, must end with ALL TESTS PASSED); one file:
  `node tools/<name>.test.cjs`. macOS has no `timeout` command. After touching league-live or the pulse also run
  `TABS=40 node tools/loadtest.mjs herd`.
- Edge jobs (Supabase does not deploy on push):
  `node tools/edge/build.mjs && npx supabase@2.118.0 functions deploy discord-sync twitch-live-sync lfg-timers discord-scheduler discord-welcome --project-ref bzbuyclwdhmhdzujxeqd --use-api`
- Deploy: push `main`; Netlify builds `index.html` in about 20 s. `tools/netlify-ignore.sh` skips the build when only
  sql/, tools/, docs/, .github/, .claude/, bot/ (except the two files discord-sync bundles), README, CLAUDE or
  jsconfig files change.

## Database change protocol
1. Write the `sql/` record first. SECURITY DEFINER functions: `set search_path to ''`, schema-qualify everything,
   `revoke all ... from public, anon, authenticated`, grant only what the client calls (keep anon EXECUTE on gate
   helpers like `is_*`, `can_*`, `owns_*` that anon-readable policies call). Postgres grants EXECUTE to PUBLIC on
   every new function, and DROP plus CREATE resets grants while CREATE OR REPLACE keeps them. A new table is born
   writable by anon and authenticated: enable RLS and revoke first. A table the bot or client subscribes to joins
   `supabase_realtime`.
2. Rehearse on production in one transaction that ends with an UNCAUGHT `raise exception`, so everything rolls back;
   record the results in the SQL file. Never wrap the probe in an `exception when` handler: a caught error commits
   everything before it. pg_net is transactional, so a rolled-back rehearsal sends nothing. A direct SQL connection does
   not load pg_safeupdate, which the API roles do: nothing PostgREST can reach may run an unqualified UPDATE or DELETE.
3. Patching an existing function by text replacement: anchor on the full exact string and assert it matches exactly
   once (`raise exception` otherwise). End the migration with self-checks that raise when the result is wrong.
4. Apply with `apply_migration`, named `vNNN_<slug>`. Then run `tools/sql/grant-audit.sql`: it must return zero rows.
   Never edit the audit to make it pass. Never run TRUNCATE, DROP TABLE or an unbounded DELETE through `execute_sql`
   without the commissioner's explicit go-ahead.
5. Traps: a PostgREST update or delete filtered out by RLS USING returns 0 rows and no error (append `.select("id")`
   and treat empty as failure); `.insert().select()` does not show AFTER-trigger changes (re-read); `guard_profile_role`
   silently reverts protected profile columns unless `trusted_writer()`; an upsert omitting a NOT NULL column fails
   23502 before ON CONFLICT; database posts to Discord go only through `public.discord_http_post` (audit check 7); a
   box score is keyed by club code (`box[g.home]`, never `box.home`).

## Definition of done (every change)
1. Tests: add or extend `tools/<feature>-vNNN.test.cjs`; `npm test` passes. When a check fails, fix the code or the
   text, never the assertion.
2. Rulebook in the same change: if the work changes what a member or staffer may or must do, or what the league
   promises, edit `CG.CONTENT.rulebook` in `src/live/part3_content.js` in the formal register (third person,
   shall/may/must, "three (3)", "(Rule 2.8)"); `paragraphs` is the basic text, `full` the shelved full format. Check the
   RENDERED book (`CG.rulebookForFormat` or the built bundle) for the new phrase and the absence of the stale one, sweep
   other copies (UI captions, DB announcement text, bot embeds, confirm dialogs), and name the changed sections.
3. Version: `git fetch origin` and read the newest version on `origin/main` right before choosing the next number, and
   again before pushing (parallel sessions ship). Changelog entries go newest FIRST as
   `{version, dateIso, summary, items}` (the build reads `changelog[0]`). The file is one line, so commit the code,
   rebase, then add the entry. Tests find an entry by version, never by `changelog[0]`.
4. Commit as `vX.YY: <what changed, in plain words>`; the body names the areas, the rules changed and the test file.
   Never `git add` index.html, version.json, preview.html or `supabase/functions/` (built and gitignored).
5. Push `main` yourself (authorized). Batch pushes (30 quiet minutes or the end of the session); push at once for
   database-coupled frontend changes, wrong results members can see, game-night fixes and security fixes. Never end a
   session with unpushed commits. Do not fire the Netlify build hook after a routine push, only when no deploy has
   started about 5 minutes later; a stall that survives the hook is a failed build, so ask the user for the deploy log.
6. Verify: `curl -s https://chelgamingleague.com/version.json` shows the new version, then check the change in the
   browser (a hidden browser pane suspends rAF and observers: check `document.visibilityState`). If jobs/, edge/,
   shared/, bot/club-notices.mjs, bot/handlers.mjs or assets/role-icons/STAFF.png changed, redeploy the Edge jobs.
7. Changelog: post to #software-updates through the webhook in `app_config` key `discord_updates_webhook` (never paste
   it into chat, commits or files) with `{"content": ..., "flags": 4}` and `?wait=true`. Plain language for staff who
   are not engineers, grouped Website / Discord / Backend, under about 1900 characters per message. Shipped work only:
   no action items for the user (say those in chat and hold the post until the change is live).

## Writing rules (chat, commits, comments, changelogs, Discord, rulebook, site copy)
- No em dashes and no spaced hyphens as punctuation; use commas, periods, colons or parentheses. Hyphens inside
  compound words are fine. Fix old dashes only on lines you touch.
- American spelling (color, center, defense, canceled, gray). Identifiers are not prose: leave class names such as
  `fly-centre` and search keyword aliases alone. Neutral pronouns (they/them) for members and staff.
- Position names from `CG.POS_NAME`, rink order from `CG.POS_RANK`, player-state labels from `CG.poolState`, consoles
  from `CG.PLATFORMS`. Never write a second list.

## Discord rules
- No link previews on anything posted to the server. A new message with no rich embeds: `"flags": 4`. With rich
  embeds, or any edit: wrap links as `<https://...>` (masked: `[text](<https://...>)`), never flag; never flag a
  deferral (type 5). Code: `noLinkPreviews`/`noLinkPreviewsEdit` (`shared/discord-links.cjs`); SQL: `discord_http_post`.
- Messages leave only through the established doors: `club_notify` and the `notify_*` writers, `_announce_once`, the
  jobs and the bot, the changelog webhook. Never post, DM or announce anything the user did not ask for, and never from
  a test or rehearsal. Front-office and club-room copy never goes to public channels; only completed trades are public.
  User-supplied text in a post sets `allowed_mentions` so it cannot ping everyone, here or roles.
- The bot token lives in three places (Netlify env, the VM env file, Supabase Edge secrets); rotation is the user's
  job and must update all three.

## Safety rules
- Review, audit, research and workflow agents are READ-ONLY against production: no writing SQL, no `apply_migration`,
  no RPC that writes, no Discord posts, no pushes. (2026-07-25: a review agent ran a delete RPC on real data and wiped
  it, with no backup.) Only the main session changes production, following the protocol above. A hook enforces this
  for plugin agents; put the command you would have run in the report instead.
- Never push, merge or announce the dormant abandonment work (local branch `abandonment-v379`, Rule 7.8), and never
  re-enable its crons or config key. If it ever ships it needs a new version number.
- Netlify usage is metered: nothing new polls Netlify, and no new Netlify function or schedule when pg_cron, pg_net, an
  Edge Function or Realtime can do the job. Never make every open tab reload the page at once.
- `publish = "."` serves the repo root: a new root file or folder that must stay private needs an exact-path 404
  redirect with `force = true` in netlify.toml (`*` only works as a trailing splat). Everything in `src/live/*.js`
  ships to every visitor: never a secret, service-role key, webhook URL, bot token or ops key there or in any served
  file (the Supabase anon key is public by design). User text passes through `esc()` before it reaches HTML.
- Secrets are the user's to add and rotate: never print, paste, log or commit tokens, keys or webhook URLs.

## Quality bar
- Durable fix over patch: find the root cause, fix it once in the shared code, and ask what breaks in week 3, in
  Season 2, or when a trigger throws. A patch over a known root cause is not a complete change, even when its diff is
  shorter. A limit accepted on purpose gets a marker naming the limit and the trigger to revisit it
  (`// shortcut: <limit>, <trigger>` in JavaScript, `-- shortcut: <limit>, <trigger>` in SQL); a marker never excuses
  a patch in review.
- Fail loud: no silent catch, no success message without a confirmed write, a missing input is an error and not a
  skip. Automations get heartbeats and watchdogs; destructive actions get a guard, an undo and an audit row.
- One definition per concept, reused everywhere: `CG.aggregateStages`, `CG.eaSkaterLine`, `CG.boxSides`,
  `CG.sbAll`/`sbAllRpc`/`sbCapped` (every pulse-path read; never cap or truncate a stats load), `_club_evidence`,
  `current_season_id()`, `statistical_title_board`, `night_lock_at`/`night_board`, `suspension_running_at`,
  `shared/game-window.cjs`. Reuse means the house helpers (`CG.*`, `shared/`, the existing SQL functions): grep before
  deciding something does not exist.
- Seamless interactions: an edit never resets the page. Repaint the widget in place
  (`host.outerHTML = render(); rebind();`), never call `CG.router()` to repaint, never re-render an input mid-typing.
- Scripted edits: anchor on the full exact string; when a `String.replace` replacement contains `$`, use a function
  or split/join; run the suite after batch edits.

## League standing orders
- Every season runs the BASIC format until the commissioner says otherwise; never propose full-format features. Never
  generate a schedule before that season's holidays (`skip_holidays`) are set. Rulings the commissioner has made are
  the spec: do not reopen them.
- Every line counts: a player's statistics count for every game, at every position played (by `game_stats.is_goalie`,
  never the registered position), every sitting, disconnects included. A struck early-restart sitting stays struck.
