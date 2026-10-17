import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Square, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";

// Interactive cloud recorder: shows the runner's headless browser (runner/record.ts) and forwards
// the user's mouse/keyboard to it. On Stop the runner returns a Playwright script, which the
// Codegen page feeds into its existing convert → harden → save pipeline.

type Phase = "connecting" | "ready" | "stopping" | "done" | "error";
type RecState = { phase: Phase; frame?: string; notice?: string; error?: string };
type Out = Record<string, unknown> & { type: string };

// The runner's browser viewport — the image is scaled, so pointer coords are mapped back to this.
const VIEW_W = 1280;
const VIEW_H = 720;
// Mouse moves are throttled; the recorder needs them to know which element is under the pointer.
const MOVE_GAP_MS = 40;
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

  const start = useCallback((wsUrl: string, pageUrl: string) => {
    wsRef.current?.close();
    setState({ phase: "connecting" });
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    let gotScript = false;
    ws.onopen = () => ws.send(JSON.stringify({ type: "start", url: pageUrl }));
    ws.onmessage = (ev) => {
      let msg: { type?: string; data?: string; message?: string; code?: string; reason?: string };
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
          setState((s) => (s ? { ...s, phase: "ready" } : s));
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

  // Map a pointer event on the (scaled) image to the runner's 1280×720 viewport.
  const toView = (e: { clientX: number; clientY: number }) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * VIEW_W),
      y: Math.round(((e.clientY - r.top) / r.height) * VIEW_H),
    };
  };
  const buttonName = (b: number) => (b === 1 ? "middle" : b === 2 ? "right" : "left");

  // Wheel needs a non-passive listener so the page itself doesn't scroll while recording.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !live) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      send({ type: "wheel", dx: e.deltaX, dy: e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [live, send]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!live) return;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (e.key.length === 1 && !mod) {
      send({ type: "text", text: e.key });
    } else if (NAMED.has(e.key)) {
      send({ type: "key", key: e.key });
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
      send({ type: "key", key: `${combo}+${e.key}` });
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
          if (text) send({ type: "text", text });
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
            className={`w-full h-auto select-none ${live ? "cursor-pointer" : "opacity-80"}`}
            onMouseMove={(e) => {
              if (!live) return;
              const now = Date.now();
              if (now - lastMove.current < MOVE_GAP_MS) return;
              lastMove.current = now;
              const p = toView(e);
              if (p) send({ type: "mouse", action: "move", ...p });
            }}
            onMouseDown={(e) => {
              if (!live) return;
              e.preventDefault();
              boxRef.current?.focus();
              const p = toView(e);
              if (p) send({ type: "mouse", action: "down", button: buttonName(e.button), ...p });
            }}
            onMouseUp={(e) => {
              if (!live) return;
              const p = toView(e);
              if (p) send({ type: "mouse", action: "up", button: buttonName(e.button), ...p });
            }}
          />
        ) : (
          <div className="aspect-video w-full flex items-center justify-center text-sm text-white/60">
            {state.phase === "error" ? "" : "Opening the page…"}
          </div>
        )}
      </div>
      {live && (
        <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
          Click the page to interact; while it's selected your typing goes to the page. Recording
          stops automatically after 10 minutes, or 2 minutes without activity.
        </p>
      )}
    </div>
  );
}
