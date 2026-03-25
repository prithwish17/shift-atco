import { useMemo, useState } from "react";
import { format, addDays, isToday } from "date-fns";
import { Search, Database, CloudDownload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetchRoster, useRosters, type RosterEntry } from "@/hooks/useRosters";

const TEAMS = ["A", "B", "C", "D", "E"];
const SHIFTS = ["Morning", "Afternoon", "Night"];

function formatDateForFilter(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function formatDateLabel(date: Date): { day: string; weekday: string; isToday: boolean } {
  return {
    day: format(date, "d MMM"),
    weekday: format(date, "EEE"),
    isToday: isToday(date),
  };
}

export default function SupervisorDailyRoster() {
  const today = useMemo(() => new Date(), []);
  const dateRange = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(today, i - 2)), [today]);

  const [selectedDate, setSelectedDate] = useState(formatDateForFilter(today));
  const [selectedTeam, setSelectedTeam] = useState("all");
  const [selectedShift, setSelectedShift] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [excludeSpecialEntries, setExcludeSpecialEntries] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchRoster = useFetchRoster();
  const { data: rosters = [], isLoading, isFetching } = useRosters({
    team: selectedTeam,
    shift: selectedShift,
    search: searchQuery || undefined,
    date: selectedDate,
    excludeSpecialEntries,
  });

  const handleFetchLatest = async () => {
    try {
      await fetchRoster.mutateAsync({
        team: selectedTeam === "all" ? "" : selectedTeam,
        shift: selectedShift === "all" ? "" : selectedShift,
      });
      setLastFetched(new Date());
      toast.success("Roster data synced successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch roster");
    }
  };

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Shift Roster Data</h1>
          <p className="text-muted-foreground">Supervisor view for roster data and sync</p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="w-full sm:w-40">
                <label className="text-sm font-medium mb-1.5 block">Team</label>
                <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Teams</SelectItem>
                    {TEAMS.map((t) => (
                      <SelectItem key={t} value={t}>
                        Team {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-full sm:w-44">
                <label className="text-sm font-medium mb-1.5 block">Shift</label>
                <Select value={selectedShift} onValueChange={setSelectedShift}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Shifts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Shifts</SelectItem>
                    {SHIFTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-full sm:flex-1">
                <label className="text-sm font-medium mb-1.5 block">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, unit, position..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <Button onClick={handleFetchLatest} disabled={fetchRoster.isPending} className="whitespace-nowrap">
                {fetchRoster.isPending ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CloudDownload className="mr-2 h-4 w-4" />
                )}
                Fetch Latest
              </Button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Checkbox
                id="supervisor-hide-special-roster-entries"
                checked={excludeSpecialEntries}
                onCheckedChange={(checked) => setExcludeSpecialEntries(checked === true)}
              />
              <label htmlFor="supervisor-hide-special-roster-entries" className="text-sm text-muted-foreground cursor-pointer">
                Hide Extra Duty and Duty Exchange/Change entries
              </label>
            </div>

            {lastFetched && (
              <p className="text-xs text-muted-foreground mt-2">
                Last synced: {lastFetched.toLocaleTimeString()}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex justify-center">
              <div className="flex gap-2 overflow-x-auto">
                {dateRange.map((date) => {
                  const dateStr = formatDateForFilter(date);
                  const label = formatDateLabel(date);
                  const isSelected = selectedDate === dateStr;

                  return (
                    <Button
                      key={dateStr}
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedDate(dateStr)}
                      className={`flex flex-col items-center min-w-[72px] h-auto py-1.5 px-3 gap-0 ${label.isToday && !isSelected ? "border-primary text-primary" : ""
                        }`}
                    >
                      <span className="text-[11px] font-normal opacity-70">{label.weekday}</span>
                      <span className="text-sm font-semibold">{label.day}</span>
                      {label.isToday && <span className="text-[9px] font-medium mt-0.5 leading-none">Today</span>}
                    </Button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-4">
          <Badge variant="outline" className="gap-1">
            <Database className="h-3 w-3" />
            {rosters.length} records
          </Badge>
          {isFetching && !isLoading && <Badge variant="secondary">Refreshing...</Badge>}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Roster Data</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : rosters.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Database className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No roster data found</p>
                <p className="text-sm mt-1">Try changing filters or click "Fetch Latest".</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">S.No</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Position</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rosters.map((entry: RosterEntry, idx: number) => (
                      <TableRow
                        key={entry.id || idx}
                        className={`${
                          idx % 2 === 0
                            ? "bg-white dark:bg-slate-900/55"
                            : "bg-slate-50/70 dark:bg-slate-800/55"
                        } hover:bg-blue-50/60 dark:hover:bg-blue-900/25`}
                      >
                        <TableCell className="font-medium text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-mono text-sm">{entry.date}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{entry.shift}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">Team {entry.team}</Badge>
                        </TableCell>
                        <TableCell>{entry.unit}</TableCell>
                        <TableCell className="font-medium">{entry.employee_name}</TableCell>
                        <TableCell>{entry.position}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
