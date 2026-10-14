// v4.06: Netlify's stand-in for jobs/twitch-live-sync.js while the job moves to Supabase. It keeps the schedule (every 2 minutes) but
// runs the job only while the database names Netlify as its host (jobs/host-gate.mjs); once public.job_hosts names
// Supabase, this answers "standby" and the Edge Function runs the job instead. Delete this file when the move is done.
import job from "../../jobs/twitch-live-sync.js";
import { onActiveHost } from "../../jobs/host-gate.mjs";

export const config = { schedule: "*/2 * * * *" };

export default (req) => onActiveHost("twitch-live-sync", () => job(req));
