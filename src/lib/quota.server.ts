// Server-side quota metering + (gated) enforcement for the freemium model. Counts the caller's
// runs this calendar month and, when QUOTA_ENFORCED is on, blocks an over-limit free user. Pass the
// RLS-scoped client so it only ever counts/reads the caller's own rows.
import { quotaStatus, monthStartISO, QUOTA_ENFORCED } from "@/lib/quota";
import type { SupabaseClient } from "@supabase/supabase-js";

// Count the caller's runs since the start of this UTC month (head:true → no rows, just the count).
export async function monthlyRunCount(sb: SupabaseClient, now = new Date()): Promise<number> {
  const { count } = await sb
    .from("runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", monthStartISO(now));
  return count ?? 0;
}

// Returns a user-facing error message if the caller is over quota — but ONLY when QUOTA_ENFORCED is
// true. While it's false (meter + display only) this is a zero-cost no-op: it returns null before
// any query, so it can be safely dropped into every run endpoint now and "turned on" later.
//
// To enforce in a run endpoint:
//   const block = await quotaBlock(sb);
//   if (block) return json({ error: block }, { status: 429 });
export async function quotaBlock(sb: SupabaseClient): Promise<string | null> {
  if (!QUOTA_ENFORCED) return null;
  const { data: profile } = await sb.from("profiles").select("plan").maybeSingle();
  const status = quotaStatus(await monthlyRunCount(sb), profile?.plan);
  return status.over
    ? `Monthly run limit reached (${status.used}/${status.limit}). Upgrade to keep running.`
    : null;
}
