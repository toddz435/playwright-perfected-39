interface StepStatusBarProps {
  steps: { status: string; action?: string; name?: string; target?: string }[];
  height?: string;
}

export function StepStatusBar({ steps, height = "h-1.5" }: StepStatusBarProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {steps.map((s, i) => (
        <div
          key={i}
          title={`${s.action || s.name || ""} ${s.target || ""}`}
          className={`${height} flex-1 min-w-[8px] rounded-full ${
            s.status === "passed"
              ? "bg-success"
              : s.status === "failed"
                ? "bg-destructive"
                : s.status === "running"
                  ? "bg-primary-glow animate-pulse"
                  : s.status === "skipped"
                    ? "bg-muted-foreground/30"
                    : "bg-muted"
          }`}
        />
      ))}
    </div>
  );
}
