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

  // Team and shift are derived from the rotation, so the sync only needs the
  // date on screen — the external fetch returns every team for that day.
  const handleFetchLatest = async (isoDate: string) => {
    try {
      await fetchRoster.mutateAsync({ team: "", shift: "", date: isoDate });
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
        actions={({ isoDate }) => (
          <div className="flex flex-col items-end gap-1">
            <Button
              onClick={() => handleFetchLatest(isoDate)}
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
