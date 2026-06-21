// Server-only Jira (Cloud) integration: file a failed run as a Jira issue. Auth is Basic
// email:apiToken (Atlassian Cloud); the token is decrypted by the caller before this is called.
// SSRF-guarded, time-bounded, and redirect-safe (a 3xx is rejected rather than followed, so the
// Basic-auth header can't be replayed to another host).
import { assertPublicUrl } from "@/lib/ssrf.server";

const ALLOW_PRIVATE_HOSTS = process.env.ALLOW_PRIVATE_HOSTS === "true";
const TIMEOUT_MS = 15_000;

export type JiraConfig = { baseUrl: string; email: string; projectKey: string; token: string };

// Atlassian Document Format doc from plain text — one paragraph per non-empty line. Pure.
export function toAdf(text: string) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const content = (lines.length ? lines : [" "]).map((l) => ({
    type: "paragraph",
    content: [{ type: "text", text: l }],
  }));
  return { type: "doc", version: 1, content };
}

function stepLabel(s: any): string {
  const target = s?.locator
    ? typeof s.locator === "object"
      ? JSON.stringify(s.locator)
      : String(s.locator)
    : (s?.target ?? "");
  return `${s?.action ?? "step"}${target ? ` ${target}` : ""}`.slice(0, 160);
}

// Build a ticket summary + description from a test and one of its (failed) runs. Pure.
export function buildTicketFromRun(test: any, run: any): { summary: string; description: string } {
  const name = String(test?.name || "Test");
  const failed = (Array.isArray(run?.steps) ? run.steps : []).find((s: any) => s?.status === "failed");
  const summary = `[Testrify] ${name} failed${failed ? ` — ${stepLabel(failed)}` : ""}`.slice(0, 250);
  const description = [
    `Test: ${name}`,
    test?.id ? `Test id: ${test.id}` : "",
    `Run: ${run?.id ?? "—"} · status: ${run?.status ?? "—"}`,
    failed ? `Failed step: ${stepLabel(failed)}` : "",
    failed?.error ? `Error: ${failed.error}` : "",
    "Filed automatically by Testrify.",
  ]
    .filter(Boolean)
    .join("\n");
  return { summary, description };
}

// Create a Jira issue. Throws a user-facing Error (SSRF refusal, timeout, non-2xx with Jira's own
// error text, unexpected redirect). Returns the new issue key + a browse URL.
export async function createJiraIssue(
  cfg: JiraConfig,
  ticket: { summary: string; description: string; issueType?: string },
): Promise<{ key: string; url: string }> {
  const base = cfg.baseUrl.trim().replace(/\/+$/, "");
  await assertPublicUrl(base, ALLOW_PRIVATE_HOSTS);

  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/rest/api/3/issue`, {
      method: "POST",
      redirect: "manual", // never follow a redirect with the Basic-auth header attached
      signal: controller.signal,
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: cfg.projectKey },
          summary: ticket.summary,
          description: toAdf(ticket.description),
          issuetype: { name: ticket.issueType || "Bug" },
        },
      }),
    });

    if (res.status >= 300 && res.status < 400) {
      throw new Error("Jira redirected the request — check the base URL (use your canonical https Jira URL).");
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300).replace(/\s+/g, " ").trim();
      try {
        const j = JSON.parse(text);
        detail =
          (Array.isArray(j.errorMessages) && j.errorMessages.join("; ")) ||
          (j.errors && Object.entries(j.errors).map(([k, v]) => `${k}: ${v}`).join("; ")) ||
          detail;
      } catch {
        /* keep the truncated text */
      }
      throw new Error(`Jira ${res.status}: ${detail || res.statusText}`);
    }
    const data = JSON.parse(text);
    if (!data?.key) throw new Error("Jira did not return an issue key.");
    return { key: data.key, url: `${base}/browse/${data.key}` };
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("Jira took too long to respond.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
