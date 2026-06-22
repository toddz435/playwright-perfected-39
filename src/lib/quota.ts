// Usage quota for the freemium model: the free plan gets FREE_MONTHLY_RUNS test runs per calendar
// month; paid plans are unlimited. Pure + client-safe — the dashboard SHOWS usage from this, and
// the run endpoints will ENFORCE it once QUOTA_ENFORCED is flipped on (after the payment/upgrade
// flow exists). A "run" = one test execution (a dataset run counts each row, since each row runs
// the test).

export const FREE_MONTHLY_RUNS = 100;

// Monthly run allowance per plan. Infinity = unlimited. Unknown plans fall back to the free limit.
export const PLAN_LIMITS: Record<string, number> = {
  free: FREE_MONTHLY_RUNS,
  pro: Infinity,
};

// METER + DISPLAY only until this is true. Flip to true once the upgrade/payment flow exists, so an
// over-limit free user is never dead-ended with no way to pay. When true, the interactive run
// endpoints (run-test/run-tests/run-dataset) reject over-limit free runs via quota.server.ts.
//
// BEFORE ENABLING (known gaps to close — see the payments/billing work):
//   1. SCHEDULED RUNS bypass quota — /api/public/run-due-schedules runs via the admin client across
//      many owners and is NOT quota-checked. Add a PER-OWNER check there, or a free user can
//      schedule around the limit.
//   2. Metering FAILS OPEN — if the run-count query errors, monthlyRunCount returns 0 and the run is
//      allowed. That's intentional (don't block on a transient DB blip), but be aware of it.
export const QUOTA_ENFORCED = false;

export type QuotaStatus = {
  plan: string;
  used: number;
  limit: number; // Infinity when unlimited
  remaining: number; // Infinity when unlimited
  over: boolean;
  unlimited: boolean;
};

export function planLimit(plan: string | null | undefined): number {
  return PLAN_LIMITS[String(plan || "free")] ?? FREE_MONTHLY_RUNS;
}

export function quotaStatus(used: number, plan: string | null | undefined): QuotaStatus {
  const limit = planLimit(plan);
  const unlimited = !Number.isFinite(limit);
  const u = Math.max(0, Math.floor(used) || 0);
  return {
    plan: String(plan || "free"),
    used: u,
    limit,
    remaining: unlimited ? Infinity : Math.max(0, limit - u),
    over: !unlimited && u >= limit,
    unlimited,
  };
}

// Start of the current UTC calendar month (the metering window). Callers pass `now`.
export function monthStartISO(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
