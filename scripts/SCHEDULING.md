# Scheduled runs — how the cron is wired

`/api/public/run-due-schedules` (POST) finds every enabled schedule that's due and runs it with
admin privileges. It's guarded by a shared secret: the caller must send the `CRON_SECRET`
(header `x-cron-secret: <secret>`, or `Authorization: Bearer <secret>`). It **fails closed** — if
`CRON_SECRET` is unset on the server, it returns 503 and runs nothing.

Required server env:
- `CRON_SECRET` — the shared secret the cron sends.
- `SUPABASE_SERVICE_ROLE_KEY` — admin key (the endpoint reads all users' schedules, bypassing RLS).

## Local dev
```bash
npm run scheduler      # pings http://localhost:8080/... every 60s with the CRON_SECRET from .env
```
Run it alongside `npm run dev`. Create a schedule in the app, wait for the minute to tick, watch it run.

## Production (pick ONE — applied at deploy, needs the app's PUBLIC URL)

The cloud can't reach `localhost`, so this only works once the app is deployed at a public URL.

### Option A — Supabase pg_cron (lives with the DB; host-agnostic)
Run in the Supabase SQL editor, substituting your deployed URL + secret:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'testrify-run-due-schedules',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_DEPLOYED_APP/api/public/run-due-schedules',
    headers := '{"Content-Type":"application/json","x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
```
*(The old Lovable cron was this, but hard-wired to the old URL + the anon key as a no-op `apikey`. The new version sends the real `x-cron-secret` the endpoint checks.)*

### Option B — platform cron (Railway / Render scheduled job)
A 1-minute cron job running:
```bash
curl -fsS -X POST "$APP_URL/api/public/run-due-schedules" -H "x-cron-secret: $CRON_SECRET"
```

### Option C — Cloudflare Cron Trigger
A scheduled Worker (`crons = ["* * * * *"]`) that `fetch`es the endpoint with the `x-cron-secret` header.

Decide A/B/C as part of the deploy (Security #4) — it depends on where the app + runner land.
