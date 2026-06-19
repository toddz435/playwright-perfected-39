import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { encryptSecret, isEncrypted, hasSecretsKey } from "@/lib/secrets.server";

// Persists a test's variables, encrypting secret values at rest before they touch the DB.
// Secrets are write-only from the client: it sends new plaintext for changed secrets, and
// lists unchanged ones in `keep` so we preserve (and migrate-encrypt) the stored value.
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const VALID_NAME = /^[\w.-]+$/;

export const Route = createFileRoute("/api/protected/save-variables")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token } = await requireUser(request);
          const body = await request.json();
          const testId = body?.testId;
          const variables: Record<string, string> = body?.variables ?? {};
          const secretNames: string[] = Array.isArray(body?.secrets) ? body.secrets : [];
          const keep: string[] = Array.isArray(body?.keep) ? body.keep : [];
          if (!testId) return json({ error: "testId required" }, { status: 400 });

          const secretSet = new Set(secretNames);
          const keepSet = new Set(keep);
          // Validate names server-side too (defense-in-depth, not just the editor).
          for (const name of Object.keys(variables)) {
            if (!VALID_NAME.test(name) || RESERVED.has(name))
              return json({ error: `invalid variable name "${name}"` }, { status: 400 });
          }
          // If we'd need to encrypt but have no key, fail loudly rather than store plaintext.
          const mustEncrypt = [...secretSet].some((n) => !keepSet.has(n) && variables[n]);
          if (mustEncrypt && !hasSecretsKey())
            return json({ error: "SECRETS_KEY is not configured on the server" }, { status: 500 });

          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: test, error: tErr } = await sb
            .from("tests")
            .select("spec")
            .eq("id", testId)
            .single();
          if (tErr || !test) return json({ error: "Test not found" }, { status: 404 });
          const existing: Record<string, unknown> = test.spec?.variables ?? {};

          const out: Record<string, string> = {};
          for (const [name, value] of Object.entries(variables)) {
            if (!secretSet.has(name)) {
              out[name] = String(value ?? ""); // non-secret → plaintext
              continue;
            }
            if (keepSet.has(name)) {
              // Unchanged secret: keep the stored value, encrypting it if it's legacy plaintext.
              const prev = existing[name];
              if (typeof prev === "string" && prev.length > 0)
                out[name] = isEncrypted(prev) ? prev : encryptSecret(prev);
              // nothing stored → drop it
            } else {
              const v = String(value ?? "");
              out[name] = v ? encryptSecret(v) : ""; // changed secret → encrypt new value
            }
          }

          const spec = { ...test.spec, variables: out, secrets: [...secretSet] };
          const { error: uErr } = await sb.from("tests").update({ spec }).eq("id", testId);
          if (uErr) return json({ error: uErr.message }, { status: 500 });
          return json({ ok: true });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
