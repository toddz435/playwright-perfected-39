import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { assertPublicUrl } from "@/lib/ssrf.server";
import { parseDelimited } from "@/lib/dataset";

// DDT D2 (slice 1): fetch a PUBLIC CSV/TSV URL (e.g. a Google Sheet "published to web" CSV, or
// any CSV link) and parse it into {columns, rows} for the datasets editor — no credentials.
// Hardened: every hop (including redirects) is SSRF-checked, the request is time-bounded, and the
// body is read under a hard byte cap so a hostile/huge URL can't hang or OOM the runner.
const ALLOW_PRIVATE_HOSTS = process.env.ALLOW_PRIVATE_HOSTS === "true";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB of CSV is ~tens of thousands of rows — plenty.
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

const tooLarge = () => new Error(`Source is too large (over ${Math.round(MAX_BYTES / 1024)} KB).`);

// Maps a fetch/abort failure to a user-facing message (the abort is our timeout firing).
const friendlyFetchError = (e: any): string =>
  e?.name === "AbortError" ? "The source took too long to respond." : e?.message || "Could not fetch that URL.";

// Read the response body under a byte cap, aborting (and discarding) as soon as it's exceeded so
// we never buffer an unbounded payload. The caller's AbortSignal also bounds the read in time.
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    // No stream (rare on this runtime) — read once and reject on byte size, not UTF-16 length.
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

// Fetch following redirects MANUALLY so each hop's target is SSRF-checked — otherwise a public URL
// could 3xx-redirect to a private/metadata address (169.254.169.254) after the initial check. The
// signal is owned by the caller so its timeout also bounds the subsequent body read.
async function fetchSafely(rawUrl: string, signal: AbortSignal): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current, ALLOW_PRIVATE_HOSTS);
    const res = await fetch(current, {
      redirect: "manual",
      signal,
      headers: { accept: "text/csv, text/plain, */*" },
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString(); // resolve relative redirects
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects.");
}

export const Route = createFileRoute("/api/protected/import-dataset-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request); // gate behind auth; the fetch is server-side
          const { url } = await request.json();
          if (!url || typeof url !== "string")
            return json({ error: "url required" }, { status: 400 });

          // One timeout spans the whole exchange — the fetch AND the streamed body read — so a
          // server that sends headers fast then dribbles the body can't hold the request open.
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
          let text: string;
          try {
            const res = await fetchSafely(url.trim(), controller.signal);
            if (!res.ok)
              return json(
                { error: `The source returned ${res.status} ${res.statusText}.` },
                { status: 400 },
              );
            text = await readCapped(res, MAX_BYTES);
          } catch (e: any) {
            return json({ error: friendlyFetchError(e) }, { status: 400 });
          } finally {
            clearTimeout(timer);
          }

          // A "published" Google Sheet that isn't actually shared returns an HTML sign-in page, not
          // CSV — detect that so the user gets a clear message instead of a one-column grid of HTML.
          if (/^\s*<(?:!doctype|html)/i.test(text))
            return json(
              { error: "That URL returned a web page, not CSV. For Google Sheets use File → Share → Publish to web → CSV." },
              { status: 400 },
            );

          const parsed = parseDelimited(text);
          if (!parsed.columns.length)
            return json({ error: "No columns found — is this a CSV/TSV source?" }, { status: 400 });

          return json({ columns: parsed.columns, rows: parsed.rows });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
