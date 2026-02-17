import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ShiftCalendar } from "@/components/ShiftCalendar";
import {
  Search,
  RefreshCw,
  Download,
  Printer,
  Database,
  CloudDownload,
  CalendarDays,
} from "lucide-react";
import { useFetchRoster, useRosters, type RosterEntry } from "@/hooks/useRosters";
import { toast } from "sonner";
import { format, addDays, isToday, parse } from "date-fns";

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

export default function WsoRosterManagement() {
  const today = useMemo(() => new Date(), []);

  // Generate 5 dates: 2 before today, today, 2 after today
  const dateRange = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => addDays(today, i - 2));
  }, [today]);

  const [selectedDate, setSelectedDate] = useState(formatDateForFilter(today));
  const [selectedTeam, setSelectedTeam] = useState("");
  const [selectedShift, setSelectedShift] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchRoster = useFetchRoster();

  const {
    data: rosters = [],
    isLoading,
    isFetching,
  } = useRosters({
    team: selectedTeam || undefined,
    shift: selectedShift || undefined,
    search: searchQuery || undefined,
  });

  const handleFetchLatest = async () => {
    try {
      await fetchRoster.mutateAsync({
        team: selectedTeam,
        shift: selectedShift,
      });
      setLastFetched(new Date());
      toast.success("Roster data synced successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch roster");
    }
  };

  // Client-side date filtering — handles multiple date formats from Google Sheets
  const filteredRosters = useMemo(() => {
    if (!selectedDate) return rosters;

    const targetDate = parse(selectedDate, "yyyy-MM-dd", new Date());
    const targetDay = targetDate.getDate();
    const targetMonth = targetDate.getMonth();
    const targetYear = targetDate.getFullYear();

    const DATE_FORMATS = [
      "dd-MMM-yyyy",
      "d-MMM-yyyy",
      "yyyy-MM-dd",
      "dd/MM/yyyy",
      "d/M/yyyy",
      "dd-MM-yyyy",
      "M/d/yyyy",
      "MM/dd/yyyy",
    ];

    return rosters.filter((entry) => {
      for (const fmt of DATE_FORMATS) {
        try {
          const parsed = parse(entry.date, fmt, new Date());
          if (
            !isNaN(parsed.getTime()) &&
            parsed.getDate() === targetDay &&
            parsed.getMonth() === targetMonth &&
            parsed.getFullYear() === targetYear
          ) {
            return true;
          }
        } catch {
          // try next format
        }
      }
      return false;
    });
  }, [rosters, selectedDate]);

  return (
    <DashboardLayout role="wso">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Roster Management</h1>
            <p className="text-muted-foreground">
              Fetch and manage shift rosters from external system
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        <Tabs defaultValue="current" className="space-y-4">
          <TabsList>
            <TabsTrigger value="current">Current Roster</TabsTrigger>
            <TabsTrigger value="calendar">Calendar View</TabsTrigger>
          </TabsList>

          <TabsContent value="current" className="space-y-4">
            {/* Controls */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <div className="w-full sm:w-40">
                    <label className="text-sm font-medium mb-1.5 block">
                      Team
                    </label>
                    <Select
                      value={selectedTeam}
                      onValueChange={setSelectedTeam}
                    >
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
                    <label className="text-sm font-medium mb-1.5 block">
                      Shift
                    </label>
                    <Select
                      value={selectedShift}
                      onValueChange={setSelectedShift}
                    >
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
                    <label className="text-sm font-medium mb-1.5 block">
                      Search
                    </label>
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

                  <Button
                    onClick={handleFetchLatest}
                    disabled={fetchRoster.isPending}
                    className="whitespace-nowrap"
                  >
                    {fetchRoster.isPending ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CloudDownload className="mr-2 h-4 w-4" />
                    )}
                    Fetch Latest
                  </Button>
                </div>

                {lastFetched && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Last synced: {lastFetched.toLocaleTimeString()}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Date Selector */}
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
                          className={`flex flex-col items-center min-w-[72px] h-auto py-1.5 px-3 gap-0 ${label.isToday && !isSelected
                            ? "border-primary text-primary"
                            : ""
                            }`}
                        >
                          <span className="text-[11px] font-normal opacity-70">
                            {label.weekday}
                          </span>
                          <span className="text-sm font-semibold">
                            {label.day}
                          </span>
                          {label.isToday && (
                            <span className="text-[9px] font-medium mt-0.5 leading-none">
                              Today
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Status */}
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="gap-1">
                <Database className="h-3 w-3" />
                {filteredRosters.length} records
              </Badge>
              {isFetching && !isLoading && (
                <Badge variant="secondary">Refreshing...</Badge>
              )}
            </div>

            {/* Data Table */}
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
                ) : filteredRosters.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Database className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No roster data found</p>
                    <p className="text-sm mt-1">
                      Click "Fetch Latest" to sync data from the external
                      system.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Shift</TableHead>
                          <TableHead>Team</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead>Employee</TableHead>
                          <TableHead>Position</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRosters.map(
                          (entry: RosterEntry, idx: number) => (
                            <TableRow key={entry.id || idx}>
                              <TableCell className="font-mono text-sm">
                                {entry.date}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{entry.shift}</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">
                                  Team {entry.team}
                                </Badge>
                              </TableCell>
                              <TableCell>{entry.unit}</TableCell>
                              <TableCell className="font-medium">
                                {entry.employee_name}
                              </TableCell>
                              <TableCell>
                                <Badge>{entry.position}</Badge>
                              </TableCell>
                            </TableRow>
                          )
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calendar" className="space-y-4">
            <ShiftCalendar
              currentDate={new Date()}
              onDateChange={() => { }}
              shifts={[]}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

