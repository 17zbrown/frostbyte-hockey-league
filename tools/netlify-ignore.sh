#!/bin/sh
# Netlify's "ignore" command (netlify.toml [build] ignore): exit 0 SKIPS the build, exit 1 BUILDS.
#
# v4.04 (commissioner, 2026-10-14): "I want to maximize the efficiency of this project so I dont use up all of our netlify
# usage." Every push to main is a production deploy, and 21 of the last 188 pushes changed nothing the site serves or
# bundles. This skips a build only when EVERY changed file is one of those, and builds in every case it cannot be sure of:
# no previous deploy to compare with, the same commit, a failed or empty diff, or any other path at all.
#
# Never served and never bundled into a function:
#   sql/ (database change records), tools/ (tests and scripts), docs/, .github/, .claude/, the README and CLAUDE notes,
#   src/live/preview_layer.js (the local design preview, no longer built on Netlify), supabase/ (the Edge deploy settings,
#   read only by the GitHub workflow), and bot/ (the Oracle VM pulls it from GitHub on its own), EXCEPT
#   bot/club-notices.mjs and bot/handlers.mjs, which jobs/discord-sync.js bundles.
# jobs/ and edge/ always build (v4.06): discord-ops bundles jobs/, and version.json carries every Edge job's expected build
# id, so a change there must reach version.json or the database would page that a correct deploy is out of date.
# A skipped commit still reaches GitHub and the VM, and ships with the next build, which always builds HEAD.
# A build started by the build hook ignores this command (Netlify docs), so the hook stays a manual tool.

base="${CACHED_COMMIT_REF:-}"
head="${COMMIT_REF:-}"
if [ -z "$base" ] || [ -z "$head" ] || [ "$base" = "$head" ]; then
  echo "netlify-ignore: no earlier deploy to compare with, building"
  exit 1
fi
if ! files=$(git diff --name-only "$base" "$head" 2>/dev/null); then
  echo "netlify-ignore: git diff failed, building"
  exit 1
fi
if [ -z "$files" ]; then
  echo "netlify-ignore: nothing changed, building to be safe"
  exit 1
fi

newline='
'
old_ifs=$IFS
IFS=$newline
for f in $files; do
  case "$f" in
    bot/club-notices.mjs|bot/handlers.mjs)
      IFS=$old_ifs; echo "netlify-ignore: $f is bundled into discord-sync, building"; exit 1 ;;
    sql/*|tools/*|docs/*|.github/*|.claude/*|bot/*|supabase/*|src/live/preview_layer.js|README*|CLAUDE*|jsconfig.json)
      ;;
    *)
      IFS=$old_ifs; echo "netlify-ignore: $f changes the site or a function, building"; exit 1 ;;
  esac
done
IFS=$old_ifs
echo "netlify-ignore: only records, tools, docs or bot files changed, skipping the build"
exit 0
