import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// Edit the banner wording here; it is the only copy.
export const ROSTER_PROVISIONAL_NOTICE = {
  title: "Provisional roster.",
  message:
    "This schedule is not final until it has been shared in the official WhatsApp group. Please don't rely on it as the confirmed roster.",
};

// Always shown at the top of the shift roster, on every date and shift. Not dismissible.
export default function RosterProvisionalNotice({ className }: { className?: string }) {
  return (
    <Alert
      className={cn(
        "border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900 [&>svg]:left-3 [&>svg]:top-3 [&>svg]:text-amber-600",
        "dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 dark:[&>svg]:text-amber-400",
        className,
      )}
    >
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <AlertTitle className="mb-0.5 text-sm font-semibold">{ROSTER_PROVISIONAL_NOTICE.title}</AlertTitle>
      <AlertDescription className="text-xs sm:text-sm">{ROSTER_PROVISIONAL_NOTICE.message}</AlertDescription>
    </Alert>
  );
}
