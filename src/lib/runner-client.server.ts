// Cloud delegation seam.
//
// The Cloudflare Worker can't run Playwright, so in production (RUNNER_URL set) browser-test
// execution is forwarded to the Testrify runner on Railway. In local dev (RUNNER_URL unset) the
// run endpoints execute in-process on the Node dev server, where Playwright works — unchanged.
//
// Auth to the runner is two-factor: a shared RUNNER_SECRET (only our web app holds it) PLUS the
// caller's Supabase JWT (so the runner acts as that user, with RLS intact).

export function runnerConfigured(): boolean {
  return Boolean(process.env.RUNNER_URL);
}

// Forward a single-test run to the cloud runner and return its response verbatim to the client.
export async function delegateRun(
  token: string,
  payload: { testId: string; opts?: Record<string, unknown> },
): Promise<Response> {
  const base = (process.env.RUNNER_URL || "").replace(/\/+$/, "");
  const resp = await fetch(`${base}/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runner-secret": process.env.RUNNER_SECRET || "",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  // Pass the runner's status + JSON straight through (it already shapes { run } / { error }).
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { "content-type": "application/json" },
  });
}
