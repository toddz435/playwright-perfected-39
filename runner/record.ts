// Cloud recorder: an interactive, in-browser replacement for `playwright codegen` on the user's
// machine. The page opens a WebSocket (wss /record?t=<record ticket>), sends {type:"start", url},
// then streams the user's mouse/keyboard input; we replay it on a headless Chromium running
// Playwright's own recorder and stream the screen back. {type:"stop"} returns the generated
// Playwright script — the same artifact the local recorder produces, so the Codegen page's
// existing convert → harden → save pipeline is reused unchanged. The runner never touches the DB.
//
// Client → runner:  start{url} | mouse{action:"move"|"down"|"up", x, y, button?} |
//                   wheel{dx, dy} | text{text} | key{key} | stop
// Runner → client:  ready{viewport} | frame{data} | notice{message} | error{message} |
//                   script{code, reason}
//
// Uses Playwright's PRIVATE context._enableRecorder (the API behind `codegen`) in its window-less
// "api" mode: instead of opening the Inspector window (impossible on a display-less server) or
// writing a file, it reports each recorded action's code to an event sink, and we assemble the
// script. The version is pinned by package-lock (Dockerfile uses npm ci); if an upgrade removes
// it, sessions fail with a clear error and src/lib/recorder-hook.test.ts goes red.
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { verifyLiveTicket } from "@/lib/live-ticket.server";
import { assertPublicUrl } from "@/lib/ssrf.server";
import { guardContextNetwork } from "@/lib/ssrf-route.server";
import { acquireSlot, ConcurrencyError, RECORDER_LIMITS } from "@/lib/concurrency.server";
import { startPageCapture, type Capture } from "./live";

const VIEWPORT = { width: 1280, height: 720 };
const MAX_SESSION_MS = 10 * 60 * 1000;
const IDLE_MS = 2 * 60 * 1000;
const MAX_BUFFERED = 1_000_000;
const MAX_TEXT = 1000;
const ALLOW_PRIVATE_HOSTS = process.env.ALLOW_PRIVATE_HOSTS === "true";

// Named keys a user can press; anything else is typed as text. Modifier combos (Control+a,
// Meta+Shift+z, …) are allowed for a single letter/digit.
const NAMED_KEYS = new Set([
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Space",
]);
const COMBO_RE = /^((Control|Shift|Alt|Meta)\+)+[A-Za-z0-9]$/;

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

// Code for one recorded action arrives via actionAdded; actionUpdated revises the latest one
// (e.g. consecutive keystrokes merged into a single fill).
type RecorderSink = {
  actionAdded: (page: Page, data: unknown, code: string) => void;
  actionUpdated: (page: Page, data: unknown, code: string) => void;
};
type RecorderContext = BrowserContext & {
  _enableRecorder?: (opts: Record<string, unknown>, sink?: RecorderSink) => Promise<void>;
};

// Wrap recorded action lines in the same test shape `playwright codegen` emits, so the Codegen
// page's parser handles cloud and local recordings identically.
function toScript(actions: string[]): string {
  if (!actions.length) return "";
  const body = actions
    .flatMap((code) => code.split("\n"))
    .map((line) => (line.startsWith("  ") ? line : `  ${line}`)) // generator may pre-indent
    .join("\n");
  return `import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n${body}\n});\n`;
}

// Untrusted input from the page — every field is validated before use.
type ClientMsg = {
  type?: string;
  url?: unknown;
  action?: string;
  x?: unknown;
  y?: unknown;
  button?: unknown;
  dx?: unknown;
  dy?: unknown;
  text?: unknown;
  key?: unknown;
};

const clamp = (n: unknown, max: number) => Math.min(max, Math.max(0, Number(n) || 0));

// HTTP upgrade handler for GET /record?t=<ticket>. Returns false if the path isn't ours.
export function handleRecordUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url || "/", "http://runner");
  if (url.pathname !== "/record") return false;
  const ticket = verifyLiveTicket(
    process.env.RUNNER_SECRET || "",
    url.searchParams.get("t") || "",
    "record",
  );
  if (!ticket) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    runSession(ws, ticket.userId).catch((e) => console.error("[record] session error:", e));
  });
  return true;
}

async function runSession(ws: WebSocket, userId: string) {
  const send = (obj: unknown, droppable = false) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (droppable && ws.bufferedAmount > MAX_BUFFERED) return;
    ws.send(JSON.stringify(obj));
  };

  // One recording per user (and a small global cap) — same limits as the local recorder.
  let release: () => void;
  try {
    release = acquireSlot("recording", userId, RECORDER_LIMITS);
  } catch (e) {
    send({ type: "error", message: e instanceof ConcurrencyError ? e.message : "Recorder busy" });
    ws.close(1000);
    return;
  }

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let capture: Capture | undefined;
  const actions: string[] = [];
  let finished = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const maxTimer = setTimeout(() => void finish("time limit reached"), MAX_SESSION_MS);
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void finish("stopped after 2 minutes of inactivity"), IDLE_MS);
  };
  touch();

  // Ends the session exactly once: closing the context flushes the recorder's output file.
  async function finish(reason: string) {
    if (finished) return;
    finished = true;
    clearTimeout(maxTimer);
    if (idleTimer) clearTimeout(idleTimer);
    capture?.stop();
    try {
      await context?.close();
    } finally {
      await browser?.close().catch(() => {});
      release();
    }
    send({ type: "script", code: toScript(actions), reason });
    ws.close(1000, "done");
  }

  async function start(rawUrl: unknown) {
    if (typeof rawUrl !== "string") throw new Error("A http(s) URL is required");
    await assertPublicUrl(rawUrl, ALLOW_PRIVATE_HOSTS);
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: VIEWPORT });
    const rc = context as RecorderContext;
    if (typeof rc._enableRecorder !== "function") {
      throw new Error("The cloud recorder isn't available in this Playwright version.");
    }

    // SSRF: the user steers this browser — every request (incl. redirect hops) must be public.
    await guardContextNetwork(context, ALLOW_PRIVATE_HOSTS);

    await rc._enableRecorder(
      { language: "playwright-test", mode: "recording", recorderMode: "api" },
      {
        actionAdded: (_p, _d, code) => {
          if (code) actions.push(code);
        },
        actionUpdated: (_p, _d, code) => {
          if (code && actions.length) actions[actions.length - 1] = code;
        },
      },
    );

    page = await context.newPage();
    // Keep the session to one tab: the live view shows a single page.
    context.on("page", (p) => {
      if (p !== page) {
        p.close().catch(() => {});
        send({ type: "notice", message: "A new tab was blocked — recording stays in one tab." });
      }
    });
    capture = await startPageCapture(
      page,
      (data) => send({ type: "frame", data }, true),
      () => ws.readyState === WebSocket.OPEN,
    );
    await page.goto(rawUrl, { timeout: 20000 });
    send({ type: "ready", viewport: VIEWPORT });
  }

  async function handle(msg: ClientMsg) {
    if (msg?.type === "stop") return finish("stopped");
    if (msg?.type === "start") {
      if (browser) return;
      try {
        await start(msg.url);
      } catch (e) {
        send({
          type: "error",
          message: (e instanceof Error && e.message) || "Couldn't start the recorder",
        });
        await finish("error");
      }
      return;
    }
    if (!page || page.isClosed()) return;
    switch (msg?.type) {
      case "mouse": {
        const x = clamp(msg.x, VIEWPORT.width);
        const y = clamp(msg.y, VIEWPORT.height);
        const button =
          msg.button === "right" || msg.button === "middle" ? msg.button : ("left" as const);
        await page.mouse.move(x, y);
        if (msg.action === "down") await page.mouse.down({ button });
        else if (msg.action === "up") await page.mouse.up({ button });
        return;
      }
      case "wheel":
        return page.mouse.wheel(
          Math.max(-2000, Math.min(2000, Number(msg.dx) || 0)),
          Math.max(-2000, Math.min(2000, Number(msg.dy) || 0)),
        );
      case "text":
        if (typeof msg.text === "string" && msg.text.length <= MAX_TEXT) {
          return page.keyboard.type(msg.text);
        }
        return;
      case "key":
        if (typeof msg.key === "string" && (NAMED_KEYS.has(msg.key) || COMBO_RE.test(msg.key))) {
          return page.keyboard.press(msg.key === "Space" ? " " : msg.key);
        }
        return;
    }
  }

  // Input is applied strictly in order (a click must land before the text typed after it).
  let chain: Promise<unknown> = Promise.resolve();
  ws.on("message", (raw) => {
    touch();
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    chain = chain.then(() => handle(msg)).catch(() => {});
  });
  ws.on("close", () => void finish("closed"));
  ws.on("error", () => void finish("closed"));
}
