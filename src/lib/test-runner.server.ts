export interface AssertionCheck {
  kind: string;
  expected: string;
  human?: string;
  ok: boolean;
  actual: string;
}

export interface StepResult {
  idx: number;
  name?: string;
  action?: string;
  target?: string;
  value?: string;
  status: "passed" | "failed" | "skipped" | "running";
  duration_ms?: number;
  http_status?: number;
  checks?: AssertionCheck[];
  error?: string;
}

export interface RunResult {
  status: "passed" | "failed";
  stepResults: StepResult[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: {
    type: string;
    total: number;
    passed: number;
    failed: number;
    scheduled?: boolean;
  };
}

function evaluateAssertion(
  a: { kind: string; expected: string },
  res: Response,
  text: string,
  elapsed: number,
): { ok: boolean; actual: string } {
  if (a.kind === "status_eq") {
    const ok = res.status === Number(a.expected);
    return { ok, actual: String(res.status) };
  }
  if (a.kind === "status_lt") {
    const ok = res.status < Number(a.expected);
    return { ok, actual: String(res.status) };
  }
  if (a.kind === "time_lt_ms") {
    const ok = elapsed < Number(a.expected);
    return { ok, actual: `${elapsed}ms` };
  }
  if (a.kind === "body_contains") {
    const ok = text.includes(String(a.expected));
    return { ok, actual: ok ? "found" : "missing" };
  }
  if (a.kind === "header_present") {
    const ok = !!res.headers.get(String(a.expected));
    return { ok, actual: ok ? "present" : "absent" };
  }
  if (a.kind === "json_path_eq") {
    const [path, expected] = String(a.expected).split("::");
    const j = JSON.parse(text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = path.split(".").reduce((o: any, k: string) => o?.[k], j);
    return { ok: String(v) === expected, actual: String(v) };
  }
  return { ok: false, actual: "unknown assertion kind" };
}

async function runApiSteps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requests: any[],
  startIdx: number,
): Promise<{ status: "passed" | "failed"; stepResults: StepResult[] }> {
  const stepResults: StepResult[] = [];
  let status: "passed" | "failed" = "passed";

  for (let i = 0; i < requests.length; i++) {
    if (i < startIdx) {
      stepResults.push({ idx: i, status: "skipped", name: requests[i].name });
      continue;
    }
    const req = requests[i];
    const sStart = Date.now();
    try {
      const headers: Record<string, string> = { ...(req.headers || {}) };
      const res = await fetch(req.url, {
        method: req.method,
        headers,
        body: req.body && req.method !== "GET" ? req.body : undefined,
      });
      const elapsed = Date.now() - sStart;
      const text = await res.text();
      const checks: AssertionCheck[] = [];
      let stepOk = true;
      for (const a of req.assertions || []) {
        let ok = false;
        let actual = "";
        try {
          ({ ok, actual } = evaluateAssertion(a, res, text, elapsed));
        } catch (e: unknown) {
          ok = false;
          actual = e instanceof Error ? e.message : "error";
        }
        if (!ok) stepOk = false;
        checks.push({ ...a, ok, actual });
      }
      stepResults.push({
        idx: i,
        name: req.name,
        status: stepOk ? "passed" : "failed",
        duration_ms: elapsed,
        http_status: res.status,
        checks,
      });
      if (!stepOk) {
        status = "failed";
        break;
      }
    } catch (e: unknown) {
      stepResults.push({
        idx: i,
        name: req.name,
        status: "failed",
        error: e instanceof Error ? e.message : "Network error",
      });
      status = "failed";
      break;
    }
  }
  return { status, stepResults };
}

async function runBrowserSteps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: any[],
  startIdx: number,
  failRate = 0.18,
): Promise<{ status: "passed" | "failed"; stepResults: StepResult[] }> {
  const stepResults: StepResult[] = [];
  let status: "passed" | "failed" = "passed";

  for (let i = 0; i < steps.length; i++) {
    if (i < startIdx) {
      stepResults.push({
        idx: i,
        status: "skipped",
        action: steps[i].action,
        target: steps[i].target,
      });
      continue;
    }
    const s = steps[i];
    await new Promise((r) => setTimeout(r, 80 + Math.random() * 220));
    const fail = s.action?.startsWith("expect_") && Math.random() < failRate;
    if (fail) {
      stepResults.push({
        idx: i,
        status: "failed",
        action: s.action,
        target: s.target,
        value: s.value,
        duration_ms: 320,
        error: `Assertion failed: ${s.action} '${s.target}' did not match expected${s.value ? ` "${s.value}"` : ""}.`,
      });
      status = "failed";
      break;
    }
    stepResults.push({
      idx: i,
      status: "passed",
      action: s.action,
      target: s.target,
      value: s.value,
      duration_ms: 80 + Math.floor(Math.random() * 220),
    });
  }
  return { status, stepResults };
}

export async function executeTest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test: { type: string; spec: any },
  opts: { startIdx?: number; failRate?: number } = {},
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const startIdx = Math.max(0, opts.startIdx ?? 0);

  const { status, stepResults } =
    test.type === "api"
      ? await runApiSteps(test.spec?.requests || [], startIdx)
      : await runBrowserSteps(test.spec?.steps || [], startIdx, opts.failRate ?? 0.18);

  const finishedAt = new Date().toISOString();
  return {
    status,
    stepResults,
    startedAt,
    finishedAt,
    durationMs: Date.now() - t0,
    summary: {
      type: test.type,
      total: stepResults.length,
      passed: stepResults.filter((s) => s.status === "passed").length,
      failed: stepResults.filter((s) => s.status === "failed").length,
    },
  };
}
