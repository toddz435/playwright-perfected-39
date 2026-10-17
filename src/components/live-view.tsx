import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Radio, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Live view of a cloud run: the runner streams JPEG frames + step progress over a WebSocket
// (see runner/live.ts). View-only for now.

type LiveStep = { idx: number; total: number; action: string; target?: string };
type LiveState = {
  phase: "connecting" | "waiting" | "live" | "done" | "lost";
  frame?: string;
  step?: LiveStep;
  result?: string;
};

// How long to wait for the socket before starting the run anyway (the runner buffers viewers
// that arrive early, but a run that starts before we connect would stream its first moments
// to nobody).
const CONNECT_WAIT_MS = 3000;

// Lightweight live connection for showing MANY runs at once (the "Run on devices" grid): calls
// back with frames/steps/done, and `ready` resolves once connected (or after CONNECT_WAIT_MS).
export function connectLive(
  url: string,
  on: {
    frame?: (data: string) => void;
    step?: (s: LiveStep) => void;
    done?: (status: string) => void;
  },
): { ready: Promise<void>; close: () => void } {
  const ws = new WebSocket(url);
  ws.onmessage = (ev) => {
    let msg: { type?: string; data?: string; status?: string } & Partial<LiveStep>;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "frame" && msg.data) on.frame?.(msg.data);
    else if (msg.type === "step") on.step?.(msg as LiveStep);
    else if (msg.type === "done") on.done?.(msg.status || "done");
  };
  const ready = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, CONNECT_WAIT_MS);
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve();
    };
  });
  return { ready, close: () => ws.close() };
}

export function useLiveView() {
  const [state, setState] = useState<LiveState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const close = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState(null);
  }, []);

  useEffect(() => () => wsRef.current?.close(), []);

  // Open the live socket; resolves once connected (or after CONNECT_WAIT_MS, whichever first).
  const open = useCallback((url: string) => {
    wsRef.current?.close();
    setState({ phase: "connecting" });
    const ws = new WebSocket(url);
    wsRef.current = ws;
    let finished = false;
    ws.onmessage = (ev) => {
      let msg: {
        type?: string;
        started?: boolean;
        data?: string;
        status?: string;
      } & Partial<LiveStep>;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      setState((s) => {
        const cur = s ?? { phase: "connecting" as const };
        switch (msg.type) {
          case "hello":
            return { ...cur, phase: msg.started ? "live" : "waiting" };
          case "started":
            return { ...cur, phase: "live" };
          case "frame":
            return { ...cur, phase: "live", frame: msg.data };
          case "step":
            return { ...cur, step: msg as LiveStep };
          case "done":
            finished = true;
            return { ...cur, phase: "done", result: msg.status };
          default:
            return cur;
        }
      });
    };
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      if (!finished) setState((s) => (s && s.phase !== "done" ? { ...s, phase: "lost" } : s));
    };
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, CONNECT_WAIT_MS);
      ws.onopen = () => {
        clearTimeout(t);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }, []);

  // The run request returned: if the socket never reported the end, settle the panel anyway.
  const settle = useCallback((result?: string) => {
    setState((s) => (s && s.phase !== "done" ? { ...s, phase: "done", result } : s));
  }, []);

  return { state, open, settle, close };
}

const phaseLabel: Record<LiveState["phase"], string> = {
  connecting: "Connecting to the cloud browser…",
  waiting: "Starting the browser…",
  live: "Live",
  done: "Finished",
  lost: "Live view disconnected — the run continues; results will appear below.",
};

export function LiveViewPanel({ state, onClose }: { state: LiveState; onClose: () => void }) {
  const { phase, frame, step, result } = state;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border text-sm">
        <div className="flex items-center gap-2 min-w-0">
          {phase === "live" ? (
            <Radio className="h-4 w-4 text-red-500 animate-pulse shrink-0" />
          ) : phase === "done" || phase === "lost" ? null : (
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          )}
          <span className="font-medium">{phaseLabel[phase]}</span>
          {phase === "done" && result && (
            <span className={result === "passed" ? "text-green-500" : "text-destructive"}>
              — {result}
            </span>
          )}
          {step && phase !== "done" && (
            <span className="text-muted-foreground truncate">
              Step {step.idx + 1} of {step.total}: {step.action}
              {step.target ? ` ${step.target}` : ""}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} title="Close live view">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="bg-black/90 flex items-center justify-center h-[60vh]">
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame}`}
            alt="Live view of the test's browser"
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <span className="text-sm text-white/60">Waiting for the first frame…</span>
        )}
      </div>
    </div>
  );
}
