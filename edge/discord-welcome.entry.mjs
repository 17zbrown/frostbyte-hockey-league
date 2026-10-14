// Supabase Edge entry for jobs/discord-welcome.js (v4.06). tools/edge/build.mjs bundles this file into the deployed function.
import job from "../jobs/discord-welcome.js";
import { serveJob } from "./serve-job.mjs";

serveJob({ fn: "discord-welcome", run: job, needs: ["DISCORD_BOT_TOKEN"] });
