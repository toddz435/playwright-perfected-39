import { useState, useCallback } from "react";
import { apiCall } from "@/lib/api-client";
import { toast } from "sonner";

export function useAnalyzeRun() {
  const [analysis, setAnalysis] = useState<{
    runId: string;
    text: string;
  } | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analyzeRun = useCallback(async (run: Record<string, any>, test: Record<string, any>) => {
    setAnalysisBusy(true);
    setAnalysis({ runId: run.id, text: "" });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const failed = (run.steps || []).find((s: any) => s.status === "failed");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { analysis } = await apiCall<any>("/api/protected/ai-analyze-failure", {
        test,
        failedStep: failed,
        error: failed?.error,
        allSteps: run.steps,
      });
      setAnalysis({ runId: run.id, text: analysis });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
      setAnalysis(null);
    }
    setAnalysisBusy(false);
  }, []);

  return { analysis, analysisBusy, analyzeRun };
}
