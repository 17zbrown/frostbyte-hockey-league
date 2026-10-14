// v4.06: Netlify's stand-in for jobs/discord-welcome.js while the job moves to Supabase. It keeps the schedule (every 5 minutes) but
// runs the job only while the database names Netlify as its host (jobs/host-gate.mjs); once public.job_hosts names
// Supabase, this answers "standby" and the Edge Function runs the job instead. Delete this file when the move is done.
import job from "../../jobs/discord-welcome.js";
import { onActiveHost } from "../../jobs/host-gate.mjs";

export const config = { schedule: "*/5 * * * *" };

export default (req) => onActiveHost("discord-welcome", () => job(req));
