-- Schedules table for cron-triggered test runs
CREATE TABLE public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  test_id uuid NOT NULL,
  cron text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedules_all_own" ON public.schedules
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER set_updated_at_schedules
BEFORE UPDATE ON public.schedules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_schedules_due ON public.schedules (enabled, next_run_at);

-- Enable extensions for cron + http
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule a job every minute to invoke the public endpoint that runs due schedules
SELECT cron.schedule(
  'testrify-run-due-schedules',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--a3fc7080-de6a-4fda-82d0-ae6f565ef47b.lovable.app/api/public/run-due-schedules',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mZHZxeW5yZmpqb3FsbHBqdGdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NzY0OTksImV4cCI6MjA5NDI1MjQ5OX0._q7wkkFBL8JjRmRnk8XMxjznBQnuhd3jEP6JrP81YA0"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);