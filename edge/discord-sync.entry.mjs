// Supabase Edge entry for jobs/discord-sync.js (v4.06). tools/edge/build.mjs bundles this file into the deployed function.
import job from "../jobs/discord-sync.js";
import staffPng from "../assets/role-icons/STAFF.png";
import { serveJob } from "./serve-job.mjs";

/* Staff's referee jersey travels inside the bundle: an Edge Function has no repo files on disk to read
   (readRoleIcon in jobs/discord-sync.js checks this map first). */
globalThis.__CGHL_ROLE_ICONS = { STAFF: "data:image/png;base64," + staffPng };

serveJob({ fn: "discord-sync", run: job, needs: ["DISCORD_BOT_TOKEN"] });
