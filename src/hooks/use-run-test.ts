import { useState, useCallback, useRef } from "react";
import { apiCall } from "@/lib/api-client";
import { toast } from "sonner";

export function useRunTest(opts?: { onComplete?: (run: Record<string, unknown>) => void }) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const runTest = useCallback(
    async (testId: string, resumeFromStep?: number) => {
      setRunningId(testId);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { run } = await apiCall<any>("/api/protected/run-test", {
          testId,
          resumeFromStep,
        });
        toast[run.status === "passed" ? "success" : "error"](`Run ${run.status}`);
        optsRef.current?.onComplete?.(run);
        return run;
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Failed");
        return null;
      } finally {
        setRunningId(null);
      }
    },
    [],
  );

  return { runningId, runTest };
}
