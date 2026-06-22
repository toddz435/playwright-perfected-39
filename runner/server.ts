// Testrify cloud runner.
//
// A thin HTTP service that executes browser tests on Railway (where Playwright + browsers exist),
// reusing the SAME engine the local/web app uses — executeTest(). The Cloudflare web app can't run
// Playwright, so its Run button will forward here (Phase 2). This service mirrors the auth + RLS +
// concurrency of src/routes/api/protected/run-test.ts, just over a plain Node HTTP door.
//
//   POST /run    headers: x-runner-secret: <RUNNER_SECRET>, authorization: Bearer <user supabase JWT>
//                body:    { testId: string, opts?: { resumeFromStep?, varsOverride? } }
//   GET  /health (liveness, no auth)
//
// Run with: tsx runner/server.ts   (env: RUNNER_SECRET, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
//                                    SECRETS_KEY, ANTHROPIC_API_KEY)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { executeTest } from "@/lib/test-runner.server";
import { acquireSlot, ConcurrencyError, RUN_LIMITS } from "@/lib/concurrency.server";
import { quotaBlock } from "@/lib/quota.server";

const PORT = Number(process.env.PORT) || 8080;
const RUNNER_SECRET = process.env.RUNNER_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";

function send(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

// Constant-time compare so the shared secret can't be guessed by timing.
function secretOk(provided: string): boolean {
  if (!RUNNER_SECRET || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(RUNNER_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
    if (req.method !== "POST" || req.url !== "/run") return send(res, 404, { error: "not found" });

    // Gate 1: only callers holding the shared secret (our web app) get in.
    if (!secretOk(String(req.headers["x-runner-secret"] || ""))) {
      return send(res, 401, { error: "bad runner secret" });
    }

    // Gate 2: act AS the end user via their Supabase JWT, so RLS still applies.
    const authz = String(req.headers["authorization"] || "");
    if (!authz.startsWith("Bearer ")) return send(res, 401, { error: "missing user token" });
    const token = authz.slice(7);

    const body = await readJson(req);
    const testId = body?.testId;
    if (!testId || typeof testId !== "string") return send(res, 400, { error: "testId required" });
    const opts = body?.opts && typeof body.opts === "object" ? body.opts : {};

    // RLS-scoped client — identical to run-test.ts.
    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData.user) return send(res, 401, { error: "invalid user token" });
    const userId = userData.user.id;

    const { data: test, error: tErr } = await sb.from("tests").select("*").eq("id", testId).single();
    if (tErr || !test) return send(res, 404, { error: "test not found" });

    // Monthly run quota (no-op while QUOTA_ENFORCED is off).
    const quota = await quotaBlock(sb);
    if (quota) return send(res, 429, { error: quota });

    // Concurrency cap lives HERE now (single runner instance → in-memory state is authoritative).
    let release: () => void;
    try {
      release = acquireSlot("run", userId, RUN_LIMITS);
    } catch (e) {
      if (e instanceof ConcurrencyError) return send(res, 429, { error: e.message });
      throw e;
    }
    try {
      const t0 = Date.now();
      const { run } = await executeTest(sb, test, userId, {
        startIdx: Math.max(0, Number(opts.resumeFromStep ?? opts.startIdx) || 0),
        varsOverride: opts.varsOverride,
        headless: true, // cloud runner has no display — always headless
      });
      console.log(`[runner] ran test ${testId} → ${(run as any)?.status ?? "done"} (${Date.now() - t0}ms)`);
      return send(res, 200, { run });
    } finally {
      release();
    }
  } catch (e: any) {
    // Log the detail server-side (Railway logs); return a GENERIC message so internal error text
    // (Supabase/Playwright/infra paths, resolved hostnames) never leaks to the client.
    console.error("[runner] error:", e?.stack || e);
    return send(res, 500, { error: "internal runner error" });
  }
});

server.listen(PORT, () => console.log(`[runner] listening on :${PORT}`));
