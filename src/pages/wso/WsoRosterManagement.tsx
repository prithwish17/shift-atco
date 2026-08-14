import { useState } from "react";
import { CloudDownload, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/DashboardLayout";
import ShiftRosterView from "@/components/roster/ShiftRosterView";
import { ShiftCalendar } from "@/components/ShiftCalendar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFetchRoster } from "@/hooks/useRosters";

export default function WsoRosterManagement() {
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
    <DashboardLayout role="wso">
      <Tabs defaultValue="current" className="space-y-3">
        <TabsList>
          <TabsTrigger value="current">Current Roster</TabsTrigger>
          <TabsTrigger value="calendar">Calendar View</TabsTrigger>
        </TabsList>

        <TabsContent value="current">
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
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4">
          <ShiftCalendar currentDate={new Date()} onDateChange={() => { }} shifts={[]} />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
