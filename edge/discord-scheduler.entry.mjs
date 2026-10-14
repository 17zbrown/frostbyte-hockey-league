// Supabase Edge entry for jobs/discord-scheduler.js (v4.06). tools/edge/build.mjs bundles this file into the deployed function.
import job from "../jobs/discord-scheduler.js";
import { serveJob } from "./serve-job.mjs";

serveJob({ fn: "discord-scheduler", run: job, needs: ["DISCORD_BOT_TOKEN"] });
