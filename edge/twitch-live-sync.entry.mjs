// Supabase Edge entry for jobs/twitch-live-sync.js (v4.06). tools/edge/build.mjs bundles this file into the deployed function.
import job from "../jobs/twitch-live-sync.js";
import { serveJob } from "./serve-job.mjs";

serveJob({ fn: "twitch-live-sync", run: job, needs: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"] });
