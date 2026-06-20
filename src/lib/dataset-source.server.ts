// Server-only: fetch a dataset's external source (a published-CSV URL, or an Airtable/Supabase
// REST endpoint) and normalize it to {columns, rows}. Shared by the import + refresh endpoints so
// the SSRF/timeout/byte-cap hardening lives in ONE place. The token is plaintext here — callers
// decrypt it (secrets.server) before calling; this module never touches the DB or the secret key.
import { assertPublicUrl } from "@/lib/ssrf.server";
import { parseDelimited, jsonToRows, type DatasetData } from "@/lib/dataset";

const ALLOW_PRIVATE_HOSTS = process.env.ALLOW_PRIVATE_HOSTS === "true";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — tens of thousands of rows of CSV/JSON.
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

// Source providers. 'sheet_url' = public CSV (no auth); the rest are authenticated REST/JSON.
export type SourceProvider = "sheet_url" | "airtable" | "supabase";
export const REST_PROVIDERS: SourceProvider[] = ["airtable", "supabase"];
export const isRestProvider = (p: string): p is "airtable" | "supabase" =>
  p === "airtable" || p === "supabase";

const tooLarge = () => new Error(`Source is too large (over ${Math.round(MAX_BYTES / 1024)} KB).`);

// True if a Supabase error is the "source_url/source_token column doesn't exist" case — i.e. the
// Slice-2 migration hasn't been applied yet. Lets the endpoints give an actionable message instead
// of a raw Postgres error (this project applies migrations manually via Lovable/Supabase).
export function isMissingSourceColumn(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  return (
    code === "42703" ||
    ((msg.includes("source_url") || msg.includes("source_token")) && msg.includes("does not exist"))
  );
}
export const MIGRATION_HINT =
  "Connected sources need the latest migration (20260620000000_dataset_source.sql) applied — run it in Supabase, then retry.";

// Maps a fetch/abort failure to a user-facing message (the abort is our timeout firing).
export const friendlyFetchError = (e: any): string =>
  e?.name === "AbortError"
    ? "The source took too long to respond."
    : e?.message || "Could not fetch that source.";

// Per-provider auth headers. Supabase REST needs BOTH apikey and a Bearer; Airtable (and any
// generic bearer API) just needs Authorization. No token → no headers (public source).
function authHeaders(provider: SourceProvider, token?: string): Record<string, string> {
  if (!token) return {};
  if (provider === "supabase") return { apikey: token, authorization: `Bearer ${token}` };
  return { authorization: `Bearer ${token}` };
}

// Read the response body under a byte cap, aborting as soon as it's exceeded so we never buffer an
// unbounded payload. The caller's AbortSignal also bounds the read in time.
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > maxBytes) throw tooLarge();
    return new TextDecoder().decode(buf);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(merged);
}

// Fetch following redirects MANUALLY so EVERY hop is SSRF-checked — otherwise a public URL could
// 3xx-redirect to a private/metadata address (169.254.169.254) after the initial check. The signal
// is the caller's, so its timeout also bounds the subsequent body read.
//   `safeHeaders` go to every hop. `authHeaders` carry the credential and are sent ONLY while the
// hop stays on the ORIGINAL origin — a cross-origin redirect drops them (as browsers do), so a
// compromised/redirecting source can't exfiltrate the Airtable/Supabase token to another host.
async function fetchSafely(
  rawUrl: string,
  signal: AbortSignal,
  safeHeaders: Record<string, string>,
  authHeaders: Record<string, string>,
): Promise<Response> {
  let current = rawUrl;
  let initialOrigin: string | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current, ALLOW_PRIVATE_HOSTS);
    const origin = new URL(current).origin;
    if (initialOrigin === null) initialOrigin = origin;
    const headers =
      origin === initialOrigin ? { ...safeHeaders, ...authHeaders } : { ...safeHeaders };
    const res = await fetch(current, { redirect: "manual", signal, headers });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString(); // resolve relative redirects
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects.");
}

// Fetch + normalize one source into {columns, rows}. Throws a user-facing Error on any failure
// (SSRF refusal, timeout, non-2xx, oversize, bad shape) — callers turn it into a 400. A single
// 15s timeout spans the fetch AND the streamed read.
export async function fetchSource(
  opts: { provider: SourceProvider; url: string; token?: string },
  signal?: AbortSignal,
): Promise<DatasetData> {
  const isJson = isRestProvider(opts.provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Abort our controller if the caller's signal fires (e.g. the request disconnects).
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetchSafely(
      opts.url,
      controller.signal,
      { accept: isJson ? "application/json" : "text/csv, text/plain, */*" },
      authHeaders(opts.provider, opts.token),
    );
    if (!res.ok) {
      // Surface the provider's own error body (truncated) — Airtable/Supabase explain auth/table
      // problems there, which is far more useful than a bare status code.
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200).replace(/\s+/g, " ").trim();
      } catch {
        /* ignore */
      }
      throw new Error(
        `The source returned ${res.status} ${res.statusText}.${detail ? ` ${detail}` : ""}`,
      );
    }
    const text = await readCapped(res, MAX_BYTES);

    if (isJson) {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("The source did not return valid JSON.");
      }
      const parsed = jsonToRows(data);
      if (!parsed.columns.length)
        throw new Error("No records found — check the table/base and that it has rows.");
      return parsed;
    }

    // A "published" Google Sheet that isn't actually shared returns an HTML sign-in page, not CSV.
    if (/^\s*<(?:!doctype|html)/i.test(text))
      throw new Error(
        "That URL returned a web page, not CSV. For Google Sheets use File → Share → Publish to web → CSV.",
      );
    const parsed = parseDelimited(text);
    if (!parsed.columns.length) throw new Error("No columns found — is this a CSV/TSV source?");
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
