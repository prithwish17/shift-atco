import { CalendarClock } from "lucide-react";

import { cn } from "@/lib/utils";

export const ROSTER_COMING_SOON_MESSAGE =
  "Roster's not out yet, but it's coming soon. Check back shortly!";

// Shown wherever a roster is blank, so every portal says the same thing.
export default function RosterComingSoon({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-2 py-8 text-center", className)}>
      <CalendarClock className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{ROSTER_COMING_SOON_MESSAGE}</p>
    </div>
  );
}
