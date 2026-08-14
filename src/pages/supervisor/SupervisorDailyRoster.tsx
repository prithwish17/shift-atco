import { useState } from "react";
import { CloudDownload, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/DashboardLayout";
import ShiftRosterView from "@/components/roster/ShiftRosterView";
import { Button } from "@/components/ui/button";
import { useFetchRoster } from "@/hooks/useRosters";

export default function SupervisorDailyRoster() {
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const fetchRoster = useFetchRoster();

  // The scraper serves one tab per team and shift, so the sync is told which
  // shift is on screen and left to fan out across the five teams itself.
  const handleFetchLatest = async (isoDate: string, shift: string) => {
    try {
      // Team is left blank so every team on that shift is refreshed.
      await fetchRoster.mutateAsync({ team: "", shift, date: isoDate });
      setLastFetched(new Date());
      toast.success("Roster data synced successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch roster");
    }
  };

  return (
    <DashboardLayout role="supervisor">
      <ShiftRosterView
        description="Who is on each shift, with teams set automatically by the duty rotation."
        actions={({ isoDate, shift }) => (
          <div className="flex flex-col items-end gap-1">
            <Button
              onClick={() => handleFetchLatest(isoDate, shift)}
              disabled={fetchRoster.isPending}
              size="sm"
              className="whitespace-nowrap"
            >
              {fetchRoster.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CloudDownload className="mr-2 h-4 w-4" />
              )}
              Fetch Latest
            </Button>
            {lastFetched && (
              <p className="text-xs text-muted-foreground">
                Last synced: {lastFetched.toLocaleTimeString()}
              </p>
            )}
          </div>
        )}
      />
    </DashboardLayout>
  );
}
