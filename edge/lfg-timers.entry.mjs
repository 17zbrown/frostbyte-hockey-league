// Supabase Edge entry for jobs/lfg-timers.js (v4.06). tools/edge/build.mjs bundles this file into the deployed function.
import job from "../jobs/lfg-timers.js";
import { serveJob } from "./serve-job.mjs";

serveJob({ fn: "lfg-timers", run: job, needs: ["DISCORD_BOT_TOKEN"] });
