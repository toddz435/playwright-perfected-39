-- Billing/quota: per-user plan for the freemium model. 'free' (default) = the monthly run limit;
-- 'pro' = unlimited. Payments will flip a user to 'pro' later; for now everyone is 'free' (and
-- enforcement is OFF — we only meter + display). Set your own row to 'pro' to dev without limits:
--   update public.profiles set plan = 'pro' where id = auth.uid();
alter table public.profiles
  add column if not exists plan text not null default 'free';
