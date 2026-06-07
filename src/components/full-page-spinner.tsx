import { Loader2 } from "lucide-react";

export function FullPageSpinner() {
  return (
    <div className="p-12 flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
