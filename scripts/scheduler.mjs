// Local scheduler — pings the run-due-schedules endpoint every minute so scheduled tests fire
// during local dev. Mirrors what the production cron will do (POST + the CRON_SECRET header).
//
//   npm run scheduler          (loads .env for CRON_SECRET; run alongside `npm run dev`)
//
// Production uses a real cron (pg_cron / a host scheduler / a platform cron-trigger) against the
// deployed app URL — see scripts/SCHEDULING.md. This script is for local testing only.
const URL = process.env.SCHEDULER_URL || "http://localhost:8080/api/public/run-due-schedules";
const SECRET = process.env.CRON_SECRET;

if (!SECRET) {
  console.error("CRON_SECRET is not set (add it to .env). Exiting.");
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(URL, { method: "POST", headers: { "x-cron-secret": SECRET } });
    const body = await res.json().catch(() => ({}));
    const stamp = new Date().toISOString().slice(11, 19);
    if (res.ok) {
      console.log(`[${stamp}] ${res.status} · checked ${body.checked ?? "?"} · ran ${body.ran ?? 0}`);
    } else {
      console.error(`[${stamp}] ${res.status} · ${body.error || "error"}`);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString().slice(11, 19)}] request failed: ${e.message} (is the dev server up on :8080?)`);
  }
}

console.log(`Local scheduler → ${URL} (every 60s). Ctrl+C to stop.`);
tick();
setInterval(tick, 60_000);
