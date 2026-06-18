import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";

// Mints short-lived signed URLs for visual-regression images in the PRIVATE `screenshots`
// bucket so the browser can render baseline/actual/diff. Owner-scoped two ways: the path
// must start with the caller's own id, AND the request runs through the RLS token client
// (Storage policies gate it again). Batched to one round-trip for a step's 3 images.
const SIGNED_URL_TTL = 300; // seconds — long enough to compare images, short enough to not leak

export const Route = createFileRoute("/api/protected/screenshot-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token } = await requireUser(request);
          const body = await request.json();
          const paths: unknown = body?.paths;
          if (!Array.isArray(paths) || paths.length === 0)
            return json({ error: "paths[] required" }, { status: 400 });
          if (paths.length > 30) return json({ error: "too many paths" }, { status: 400 });

          // Only sign objects under THIS user's prefix; anything else → null (never leak).
          const prefix = `${userId}/`;
          const allowed = paths.filter(
            (p): p is string => typeof p === "string" && p.startsWith(prefix),
          );

          const urls: Record<string, string> = {};
          if (allowed.length) {
            const SUPABASE_URL = process.env.SUPABASE_URL!;
            const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
            const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
              global: { headers: { Authorization: `Bearer ${token}` } },
              auth: { persistSession: false, autoRefreshToken: false },
            });
            const { data, error } = await sb.storage
              .from("screenshots")
              .createSignedUrls(allowed, SIGNED_URL_TTL);
            if (error) return json({ error: error.message }, { status: 500 });
            for (const row of data || []) {
              if (row.signedUrl && row.path) urls[row.path] = row.signedUrl;
            }
          }
          return json({ urls });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
