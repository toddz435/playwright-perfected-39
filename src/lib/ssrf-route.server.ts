// Browser-level SSRF guard: makes EVERY request a Playwright context sends (navigations, link
// clicks, form posts, redirects, subresources) resolve to a public address. Checking only the
// `goto` URL isn't enough: a public page can redirect, link, or post the browser to an internal
// address (e.g. cloud metadata at 169.254.169.254).
//
// Route handlers never see redirect hops, so navigations are fetched with redirects OFF and each
// Location is vetted before the response is handed back; the browser then follows it as a new
// request, which passes through this guard again.
import type { BrowserContext } from "@playwright/test";
import { assertPublicUrl } from "@/lib/ssrf.server";

export async function guardContextNetwork(
  context: BrowserContext,
  allowPrivate: boolean,
): Promise<void> {
  if (allowPrivate) return; // trusted local machine — testing localhost/private apps is intended

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
    const req = route.request();
    const u = new URL(req.url());
    if (u.protocol !== "http:" && u.protocol !== "https:") return route.continue();
    if (!(await allowed(u))) return route.abort("blockedbyclient");
    if (!req.isNavigationRequest()) return route.continue();
    const resp = await route.fetch({ maxRedirects: 0 });
    const loc = resp.headers()["location"];
    if (resp.status() >= 300 && resp.status() < 400 && loc) {
      if (!(await allowed(new URL(loc, u)))) return route.abort("blockedbyclient");
    }
    return route.fulfill({ response: resp });
  });
}
