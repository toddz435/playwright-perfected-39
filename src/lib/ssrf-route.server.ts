// Browser-level SSRF guard: makes EVERY request a Playwright context sends (navigations, link
// clicks, form posts, subresources) resolve to a public address. Checking only the `goto` URL
// isn't enough: a public page can link, post, or redirect the browser to an internal address
// (e.g. cloud metadata at 169.254.169.254).
//
// Redirect hops: route handlers never see them. On Chromium, navigations are fetched with
// redirects OFF and each Location is vetted before the response is handed back (the browser then
// follows it as a new, re-checked request). WebKit and Firefox REFUSE to fulfil a 3xx response
// ("Cannot fulfill with redirect status"), and re-sending would double-submit form posts, so on
// those engines navigations continue normally — every request's own host is still checked, but a
// redirect hop is not. (Closing that last gap for all engines needs a network-level egress proxy.)
//
// The handler must never throw: an unhandled rejection here crashes the whole runner process.
import type { BrowserContext } from "@playwright/test";
import { assertPublicUrl } from "@/lib/ssrf.server";

export async function guardContextNetwork(
  context: BrowserContext,
  allowPrivate: boolean,
): Promise<void> {
  if (allowPrivate) return; // trusted local machine — testing localhost/private apps is intended

  const vetRedirects = context.browser()?.browserType().name() === "chromium";

  // Host decisions are cached for the context's lifetime (one run / one recording).
  const hostOk = new Map<string, Promise<boolean>>();
  const allowed = (u: URL) => {
    if (u.protocol !== "http:" && u.protocol !== "https:") return Promise.resolve(false);
    let ok = hostOk.get(u.hostname);
    if (!ok) {
      ok = assertPublicUrl(u.origin, false).then(
        () => true,
        () => false,
      );
      hostOk.set(u.hostname, ok);
    }
    return ok;
  };

  await context.route("**/*", async (route) => {
    try {
      const req = route.request();
      const u = new URL(req.url());
      if (u.protocol !== "http:" && u.protocol !== "https:") return await route.continue();
      if (!(await allowed(u))) return await route.abort("blockedbyclient");
      if (!vetRedirects || !req.isNavigationRequest()) return await route.continue();
      const resp = await route.fetch({ maxRedirects: 0 });
      const loc = resp.headers()["location"];
      if (resp.status() >= 300 && resp.status() < 400 && loc) {
        if (!(await allowed(new URL(loc, u)))) return await route.abort("blockedbyclient");
      }
      return await route.fulfill({ response: resp });
    } catch (e) {
      // Network failure, page closed mid-request, or an engine refusing an operation: fail this
      // one request rather than the process.
      console.warn("[ssrf-guard] request failed:", (e as Error)?.message?.split("\n")[0]);
      await route.abort("failed").catch(() => {});
    }
  });
}
