import { runBrowserSteps, type BrowserRunResult } from "./runner.js";
import type { TestStep } from "./step-executor.js";

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

interface AgentConfig {
  apiKey: string;
  server: string;
  pollInterval: number;
  headless: boolean;
}

function parseArgs(): AgentConfig {
  const args = process.argv.slice(2);
  const config: AgentConfig = {
    apiKey: "",
    server: "http://localhost:3000",
    pollInterval: 3000,
    headless: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--api-key" && args[i + 1]) {
      config.apiKey = args[++i];
    } else if (arg.startsWith("--api-key=")) {
      config.apiKey = arg.slice("--api-key=".length);
    } else if (arg === "--server" && args[i + 1]) {
      config.server = args[++i];
    } else if (arg.startsWith("--server=")) {
      config.server = arg.slice("--server=".length);
    } else if (arg === "--poll-interval" && args[i + 1]) {
      config.pollInterval = parseInt(args[++i], 10);
    } else if (arg === "--no-headless") {
      config.headless = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "start") {
      // subcommand — ignore
    }
  }

  if (!config.apiKey) {
    config.apiKey = process.env.TESTRIFY_API_KEY || "";
  }
  if (process.env.TESTRIFY_SERVER) {
    config.server = process.env.TESTRIFY_SERVER;
  }

  if (!config.apiKey) {
    console.error(
      "Error: --api-key is required (or set TESTRIFY_API_KEY env var)",
    );
    printHelp();
    process.exit(1);
  }

  return config;
}

function printHelp(): void {
  console.log(`
testrify-agent — Local Playwright test runner for Testrify

Usage:
  testrify-agent start --api-key <key> [options]

Options:
  --api-key <key>        API key for authentication (or TESTRIFY_API_KEY env var)
  --server <url>         Testrify server URL (default: http://localhost:3000)
  --poll-interval <ms>   Polling interval in ms (default: 3000)
  --no-headless          Run browser in headed mode (useful for debugging)
  --help, -h             Show this help

Environment variables:
  TESTRIFY_API_KEY       API key (alternative to --api-key)
  TESTRIFY_SERVER        Server URL (alternative to --server)
`);
}

// ─── Agent API Client ───────────────────────────────────────────────────────

interface PollResponse {
  run?: {
    id: string;
    testId: string;
    resumeFromStep?: number;
    spec: {
      type: "browser" | "api";
      steps?: TestStep[];
    };
  };
}

interface ReportPayload {
  runId: string;
  status: "passed" | "failed";
  stepResults: BrowserRunResult["stepResults"];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

async function pollForWork(
  config: AgentConfig,
): Promise<PollResponse["run"] | null> {
  const res = await fetch(`${config.server}/api/agent/poll`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Poll failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as PollResponse;
  return data.run ?? null;
}

async function reportResult(
  config: AgentConfig,
  payload: ReportPayload,
): Promise<void> {
  const res = await fetch(`${config.server}/api/agent/report`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Report failed (${res.status}): ${text}`);
  }
}

async function sendHeartbeat(config: AgentConfig): Promise<void> {
  try {
    await fetch(`${config.server}/api/agent/heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    });
  } catch {
    // heartbeat failures are non-fatal
  }
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

async function executeRun(
  config: AgentConfig,
  run: NonNullable<PollResponse["run"]>,
): Promise<void> {
  const steps = run.spec.steps || [];
  const startIdx = run.resumeFromStep ?? 0;

  console.log(
    `  Running ${steps.length} steps${startIdx > 0 ? ` (resuming from step ${startIdx})` : ""}...`,
  );

  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const result = await runBrowserSteps(steps, {
    startIdx,
    screenshotOnFailure: true,
    screenshotEveryStep: false,
    headless: config.headless,
  });

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;

  // Print step summary
  for (const s of result.stepResults) {
    const icon =
      s.status === "passed"
        ? "  +"
        : s.status === "failed"
          ? "  x"
          : "  -";
    console.log(
      `${icon} [${s.status}] ${s.action} ${s.target}${s.error ? ` — ${s.error}` : ""}`,
    );
  }

  const passed = result.stepResults.filter(
    (s) => s.status === "passed",
  ).length;
  const failed = result.stepResults.filter(
    (s) => s.status === "failed",
  ).length;
  console.log(
    `  Result: ${result.status} (${passed}/${result.stepResults.length} passed, ${failed} failed) in ${durationMs}ms`,
  );

  await reportResult(config, {
    runId: run.id,
    status: result.status,
    stepResults: result.stepResults,
    startedAt,
    finishedAt,
    durationMs,
  });

  console.log("  Reported to server.");
}

async function main(): Promise<void> {
  const config = parseArgs();

  console.log("Testrify Agent v0.1.0");
  console.log(`  Server: ${config.server}`);
  console.log(`  Poll interval: ${config.pollInterval}ms`);
  console.log(`  Headless: ${config.headless}`);
  console.log("");
  console.log("Polling for work...");

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let running = true;

  const shutdown = () => {
    if (!running) return;
    running = false;
    console.log("\nShutting down...");
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Send heartbeat every 30 seconds
  heartbeatTimer = setInterval(() => sendHeartbeat(config), 30_000);

  while (running) {
    try {
      const run = await pollForWork(config);
      if (run) {
        console.log(`\nPicked up run ${run.id} (test: ${run.testId})`);
        try {
          await executeRun(config, run);
        } catch (err) {
          console.error(
            `  Error executing run: ${err instanceof Error ? err.message : err}`,
          );
          // Report failure to server
          try {
            await reportResult(config, {
              runId: run.id,
              status: "failed",
              stepResults: [],
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              durationMs: 0,
            });
          } catch {
            console.error("  Failed to report error to server");
          }
        }
      }
    } catch (err) {
      console.error(
        `Poll error: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (running) {
      await new Promise((r) => setTimeout(r, config.pollInterval));
    }
  }

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  console.log("Agent stopped.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
