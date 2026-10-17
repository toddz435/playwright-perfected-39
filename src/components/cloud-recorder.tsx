import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Square, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";

// Interactive cloud recorder: shows the runner's headless browser (runner/record.ts) and forwards
// the user's mouse/keyboard to it. On Stop the runner returns a Playwright script, which the
// Codegen page feeds into its existing convert → harden → save pipeline.

type Phase = "connecting" | "ready" | "stopping" | "done" | "error";
type RecState = {
  phase: Phase;
  frame?: string;
  notice?: string;
  error?: string;
  // The runner's browser viewport (from "ready") — desktop 1280×720 or the emulated device.
  viewport?: { width: number; height: number };
};
type Out = Record<string, unknown> & { type: string };

// Default (desktop) viewport until the runner reports the real one — the image is scaled, so
// pointer coords are mapped back to the viewport.
const DEFAULT_VIEW = { width: 1280, height: 720 };
// Runner errors meaning "the cloud can't reach this site" (SSRF refusal / no public DNS / no
// route) — the CLI, which records on the user's own machine, is the answer for those.
const UNREACHABLE_RE =
  /private\/internal|Could not resolve host|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_REFUSED|ERR_BLOCKED_BY_CLIENT/i;
// Mouse moves are throttled; the recorder needs them to know which element is under the pointer.
const MOVE_GAP_MS = 40;
// Mirror the runner's session limits (runner/record.ts) for the on-screen countdown.
const MAX_SESSION_MS = 10 * 60 * 1000;
const IDLE_MS = 2 * 60 * 1000;
// A touch that moves further than this is a scroll, not a tap.
const TAP_SLOP_PX = 8;

const mmss = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
// Keys the runner accepts by name (see NAMED_KEYS in runner/record.ts); printable keys go as text.
const NAMED = new Set([
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
]);

export function useCloudRecorder(onScript: (code: string, reason: string) => void) {
  const [state, setState] = useState<RecState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onScriptRef = useRef(onScript);
  onScriptRef.current = onScript;

  useEffect(() => () => wsRef.current?.close(), []);

  const send = useCallback((msg: Out) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const start = useCallback((wsUrl: string, pageUrl: string, device?: string) => {
    wsRef.current?.close();
    setState({ phase: "connecting" });
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    let gotScript = false;
    ws.onopen = () => ws.send(JSON.stringify({ type: "start", url: pageUrl, device }));
    ws.onmessage = (ev) => {
      let msg: {
        type?: string;
        data?: string;
        message?: string;
        code?: string;
        reason?: string;
        viewport?: { width: number; height: number };
      };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "frame":
          setState((s) => (s ? { ...s, frame: msg.data } : s));
          break;
        case "ready":
          setState((s) => (s ? { ...s, phase: "ready", viewport: msg.viewport } : s));
          break;
        case "notice":
          setState((s) => (s ? { ...s, notice: msg.message } : s));
          break;
        case "error":
          setState((s) => ({ ...(s ?? {}), phase: "error", error: msg.message }));
          break;
        case "script":
          gotScript = true;
          setState((s) => (s && s.phase !== "error" ? { ...s, phase: "done" } : s));
          onScriptRef.current(msg.code || "", msg.reason || "stopped");
          break;
      }
    };
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      if (!gotScript) {
        setState((s) =>
          s && s.phase !== "error" && s.phase !== "done"
            ? { ...s, phase: "error", error: "Lost the connection to the cloud browser." }
            : s,
        );
      }
    };
  }, []);

  const stop = useCallback(() => {
    setState((s) => (s ? { ...s, phase: "stopping" } : s));
    send({ type: "stop" });
  }, [send]);

  const close = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState(null);
  }, []);

  return { state, start, stop, close, send };
}

export function CloudRecorderPanel({
  state,
  send,
  onStop,
  onClose,
}: {
  state: RecState;
  send: (msg: Out) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const lastMove = useRef(0);
  const live = state.phase === "ready";
  const view = state.viewport ?? DEFAULT_VIEW;
  // Phones are taller than wide: size them by height so they don't fill a huge column.
  const portrait = view.height > view.width;
  const [typed, setTyped] = useState("");

  // Countdown: the runner stops at 10 min total or 2 min without input; any input resets idle.
  const startedAt = useRef(0);
  const lastInput = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    startedAt.current = startedAt.current || Date.now();
    lastInput.current = Date.now();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  const input = (msg: Out) => {
    lastInput.current = Date.now();
    send(msg);
  };
  const totalLeft = MAX_SESSION_MS - (now - startedAt.current);
  const idleLeft = IDLE_MS - (now - lastInput.current);

  // Touch: a tap is a click; a drag scrolls the page. Tracked per gesture.
  const touch = useRef<{ x: number; y: number; lastY: number; scrolling: boolean } | null>(null);

  // Map a pointer event on the (scaled) image to the runner's 1280×720 viewport.
  const toView = (e: { clientX: number; clientY: number }) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * view.width),
      y: Math.round(((e.clientY - r.top) / r.height) * view.height),
    };
  };
  const buttonName = (b: number) => (b === 1 ? "middle" : b === 2 ? "right" : "left");

  // Wheel needs a non-passive listener so the page itself doesn't scroll while recording.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !live) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastInput.current = Date.now();
      send({ type: "wheel", dx: e.deltaX, dy: e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [live, send]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!live) return;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (e.key.length === 1 && !mod) {
      input({ type: "text", text: e.key });
    } else if (NAMED.has(e.key)) {
      input({ type: "key", key: e.key });
    } else if (mod && /^[a-z0-9]$/i.test(e.key)) {
      // ⌘V / Ctrl+V is handled by onPaste (real clipboard text) — don't also send the combo.
      if (e.key.toLowerCase() === "v") return;
      const combo = [
        e.ctrlKey && "Control",
        e.metaKey && "Meta",
        e.altKey && "Alt",
        e.shiftKey && "Shift",
      ]
        .filter(Boolean)
        .join("+");
      input({ type: "key", key: `${combo}+${e.key}` });
    } else {
      return;
    }
    e.preventDefault();
  };

  const status: Record<Phase, string> = {
    connecting: "Starting the cloud browser…",
    ready: "Recording — click and type on the page below",
    stopping: "Finishing the recording…",
    done: "Recording captured",
    error: state.error || "Something went wrong",
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border text-sm">
        <div className="flex items-center gap-2 min-w-0">
          {live ? (
            <CircleDot className="h-4 w-4 text-red-500 animate-pulse shrink-0" />
          ) : state.phase === "connecting" || state.phase === "stopping" ? (
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          ) : null}
          <span className={state.phase === "error" ? "text-destructive" : "font-medium"}>
            {status[state.phase]}
          </span>
          {state.notice && <span className="text-muted-foreground truncate">— {state.notice}</span>}
        </div>
        {live && (
          <span
            className={`text-xs tabular-nums shrink-0 ${idleLeft < 30_000 ? "text-amber-500" : "text-muted-foreground"}`}
            title="Recording stops automatically after 10 minutes, or 2 minutes without activity."
          >
            {idleLeft < 30_000
              ? `No activity — stopping in ${mmss(idleLeft)}`
              : `${mmss(totalLeft)} left`}
          </span>
        )}
        {live || state.phase === "stopping" ? (
          <Button size="sm" variant="destructive" disabled={!live} onClick={onStop}>
            <Square className="h-3.5 w-3.5 mr-1" /> Stop recording
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
      <div
        ref={boxRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          if (!live) return;
          const text = e.clipboardData.getData("text").slice(0, 1000);
          if (text) input({ type: "text", text });
          e.preventDefault();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="bg-black/90 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {state.frame ? (
          <img
            ref={imgRef}
            src={`data:image/jpeg;base64,${state.frame}`}
            alt="Cloud browser — click and type here to record"
            draggable={false}
            className={`select-none ${portrait ? "h-[70vh] w-auto" : "w-full h-auto"} ${live ? "cursor-pointer touch-none" : "opacity-80"}`}
            onPointerMove={(e) => {
              if (!live) return;
              if (e.pointerType === "touch") {
                const t = touch.current;
                if (!t) return;
                if (
                  !t.scrolling &&
                  Math.abs(e.clientY - t.y) + Math.abs(e.clientX - t.x) > TAP_SLOP_PX
                )
                  t.scrolling = true;
                if (t.scrolling) {
                  const r = imgRef.current?.getBoundingClientRect();
                  const scale = r?.height ? view.height / r.height : 1;
                  input({ type: "wheel", dx: 0, dy: (t.lastY - e.clientY) * scale });
                  t.lastY = e.clientY;
                }
                return;
              }
              const ts = Date.now();
              if (ts - lastMove.current < MOVE_GAP_MS) return;
              lastMove.current = ts;
              const p = toView(e);
              if (p) input({ type: "mouse", action: "move", ...p });
            }}
            onPointerDown={(e) => {
              if (!live) return;
              e.preventDefault();
              if (e.pointerType === "touch") {
                touch.current = { x: e.clientX, y: e.clientY, lastY: e.clientY, scrolling: false };
                // Hover first so the recorder knows which element a tap will hit.
                const p = toView(e);
                if (p) input({ type: "mouse", action: "move", ...p });
                return;
              }
              boxRef.current?.focus();
              const p = toView(e);
              if (p) input({ type: "mouse", action: "down", button: buttonName(e.button), ...p });
            }}
            onPointerUp={(e) => {
              if (!live) return;
              if (e.pointerType === "touch") {
                const t = touch.current;
                touch.current = null;
                if (!t || t.scrolling) return;
                const p = toView({ clientX: t.x, clientY: t.y });
                if (!p) return;
                input({ type: "mouse", action: "down", button: "left", ...p });
                input({ type: "mouse", action: "up", button: "left", ...p });
                return;
              }
              const p = toView(e);
              if (p) input({ type: "mouse", action: "up", button: buttonName(e.button), ...p });
            }}
          />
        ) : state.phase === "error" ? null : (
          <div className="aspect-video w-full flex items-center justify-center text-sm text-white/60">
            Opening the page…
          </div>
        )}
      </div>
      {live && (
        <div className="px-4 py-2 border-t border-border space-y-2">
          {/* Typing box: phones/tablets show no keyboard for an image; also handy on desktop. */}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed) input({ type: "text", text: typed.slice(0, 1000) });
              setTyped("");
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type into the page (tap a field first)…"
              className="flex-1 min-w-0 bg-input/50 border border-border rounded-md px-2 py-1 text-sm"
            />
            <Button type="submit" size="sm" variant="outline" disabled={!typed}>
              Type
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => input({ type: "key", key: "Enter" })}
              title="Press Enter in the page"
            >
              Enter ↵
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Click (or tap) the page to interact; while it's selected your typing goes straight to
            the page. Drag to scroll on touch screens.
          </p>
        </div>
      )}
      {state.phase === "error" && UNREACHABLE_RE.test(state.error || "") && (
        <div className="px-4 py-3 text-sm border-t border-border space-y-1">
          <div className="font-medium">Testing an internal or local site?</div>
          <div className="text-muted-foreground">
            The cloud browser can only reach public websites. Record it from your own computer with
            the Testrify CLI — it uploads the test to your account just the same:
          </div>
          <code className="block text-xs bg-surface/60 rounded px-2 py-1">
            testrify record &lt;url&gt; --project "My app"
          </code>
          <a href="/docs#cli" className="text-xs text-primary-glow hover:underline">
            How the CLI works →
          </a>
        </div>
      )}
    </div>
  );
}
