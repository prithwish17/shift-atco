import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { FeedbackDialog } from "./FeedbackDialog";

// Shown under every page in DashboardLayout.
export function FeedbackFooterLink() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="mt-10 flex justify-center border-t border-gray-200 pt-4 text-center text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        <p>
          Found an error or have a suggestion?{" "}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 font-medium text-blue-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
          >
            <MessageSquarePlus className="size-3.5" />
            Tell us
          </button>
        </p>
      </div>
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
