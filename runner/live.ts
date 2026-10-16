// Live view: stream a cloud run's headless page to its owner's browser over a WebSocket.
//
//   Browser ──(wss /live?t=<ticket>)──▶ runner      ticket = signed {userId, liveId, exp}
//   POST /run {opts.liveId} ──────────▶ runner      the run publishes frames/steps under liveId
//
// The viewer may connect before OR after the run starts (both race from the page), so sockets wait
// in a per-liveId session. A session only ever streams to sockets whose ticket userId matches the
// run's owner. Frames are sent only while someone is watching, and dropped (not queued) when a
// socket is backed up, so a slow viewer can't grow runner memory.
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { Page } from "@playwright/test";
import { verifyLiveTicket } from "@/lib/live-ticket.server";
import type { LiveStepInfo } from "@/lib/playwright-runner.server";

type Viewer = { ws: WebSocket; userId: string };
type Capture = { stop: () => void; poke: () => void };
type Session = { ownerId?: string; viewers: Set<Viewer>; last?: string; capture?: Capture };

// Drop a frame for a viewer whose socket buffer is over this — it's falling behind.
const MAX_BUFFERED = 1_000_000;
// Unmatched viewer sessions (socket opened, run never started) are swept after this.
const ORPHAN_MS = 2 * 60 * 1000;
// Fallback capture interval for engines without CDP screencast (firefox/webkit).
const POLL_MS = 500;
// Upper bound on screencast frames sent per second (chromium can emit faster on busy pages).
const MIN_FRAME_GAP_MS = 100;

const sessions = new Map<string, Session>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

function session(liveId: string): Session {
  let s = sessions.get(liveId);
  if (!s) {
    s = { viewers: new Set() };
    sessions.set(liveId, s);
    const created = s;
    setTimeout(() => {
      if (sessions.get(liveId) === created && !created.ownerId) closeSession(liveId);
    }, ORPHAN_MS).unref();
  }
  return s;
}

function sendTo(v: Viewer, msg: string, droppable: boolean) {
  if (v.ws.readyState !== WebSocket.OPEN) return;
  if (droppable && v.ws.bufferedAmount > MAX_BUFFERED) return;
  v.ws.send(msg);
}

function broadcast(liveId: string, msg: string, droppable = false) {
  const s = sessions.get(liveId);
  if (!s?.ownerId) return;
  for (const v of s.viewers) sendTo(v, msg, droppable);
}

function hasViewers(liveId: string): boolean {
  return (sessions.get(liveId)?.viewers.size ?? 0) > 0;
}

function closeSession(liveId: string) {
  const s = sessions.get(liveId);
  if (!s) return;
  s.capture?.stop();
  for (const v of s.viewers) v.ws.close(1000, "done");
  sessions.delete(liveId);
}

// HTTP upgrade handler for GET /live?t=<ticket>. Returns false if the path isn't ours.
export function handleLiveUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url || "/", "http://runner");
  if (url.pathname !== "/live") return false;
  const ticket = verifyLiveTicket(process.env.RUNNER_SECRET || "", url.searchParams.get("t") || "");
  if (!ticket) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const s = session(ticket.liveId);
    // Run already started by someone else → this viewer isn't the owner.
    if (s.ownerId && s.ownerId !== ticket.userId) {
      ws.close(4403, "forbidden");
      return;
    }
    const v: Viewer = { ws, userId: ticket.userId };
    s.viewers.add(v);
    ws.on("close", () => s.viewers.delete(v));
    ws.on("error", () => s.viewers.delete(v));
    ws.on("message", () => {}); // view-only for now; input forwarding comes with the recorder
    sendTo(v, JSON.stringify({ type: "hello", started: Boolean(s.ownerId) }), false);
    if (s.ownerId && s.last) sendTo(v, s.last, true);
  });
  return true;
}

async function startCapture(liveId: string, page: Page): Promise<Capture> {
  const frame = (data: string) => {
    const msg = JSON.stringify({ type: "frame", data });
    const s = sessions.get(liveId);
    if (s) s.last = msg;
    broadcast(liveId, msg, true);
  };

  // Chromium: CDP screencast pushes a frame whenever the page repaints (ack-gated).
  try {
    const cdp = await page.context().newCDPSession(page);
    let lastSent = 0;
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      const now = Date.now();
      if (now - lastSent < MIN_FRAME_GAP_MS || !hasViewers(liveId)) return;
      lastSent = now;
      frame(data);
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 55,
      maxWidth: 1024,
      maxHeight: 768,
    });
    return {
      stop: () => {
        cdp.send("Page.stopScreencast").catch(() => {});
        cdp.detach().catch(() => {});
      },
      poke: () => {}, // screencast already pushes on every repaint
    };
  } catch {
    // Not chromium (no CDP) — fall through to polling screenshots.
  }

  let busy = false;
  const snap = async () => {
    if (busy || page.isClosed() || !hasViewers(liveId)) return;
    busy = true;
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 50, timeout: 2000 });
      frame(buf.toString("base64"));
    } catch {
      // page navigating/closing — skip this tick
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(snap, POLL_MS);
  // Also snap at each step boundary, so short runs still show every action.
  return { stop: () => clearInterval(timer), poke: () => void snap() };
}

// Hooks for executeTest() when a run carries opts.liveId. Claims the session for `ownerId`
// (evicting any viewer whose ticket is for a different user) and returns the engine hooks plus
// `end`, which tells viewers the outcome and closes the session.
export function liveHooks(liveId: string, ownerId: string) {
  const s = session(liveId);
  s.ownerId = ownerId;
  for (const v of s.viewers) {
    if (v.userId !== ownerId) {
      v.ws.close(4403, "forbidden");
      s.viewers.delete(v);
    }
  }
  broadcast(liveId, JSON.stringify({ type: "started" }));

  return {
    // Fires once per attempt (retries get a fresh page) — restart capture on the new page.
    onPage: async (page: Page) => {
      s.capture?.stop();
      s.capture = await startCapture(liveId, page);
    },
    onStep: (info: LiveStepInfo) => {
      broadcast(liveId, JSON.stringify({ type: "step", ...info }));
      s.capture?.poke();
    },
    end: (status: string) => {
      broadcast(liveId, JSON.stringify({ type: "done", status }));
      s.capture?.stop();
      s.capture = undefined;
      // Give the final message a moment to flush before closing.
      setTimeout(() => {
        if (sessions.get(liveId) === s) closeSession(liveId);
      }, 1000).unref();
    },
  };
}
