import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon, Download, CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useUsers } from "@/hooks/useUsers";
import { useAttendance } from "@/hooks/useAttendance";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AttendanceRow {
  userId: string;
  name: string;
  empId: string;
  team: string;
  shift: string;
  position: string;
  status: "present" | "absent" | "off";
  timeIn: string;
  timeOut: string;
  comments: string;
  existingId?: string;
}

interface ScheduleEntry {
  id: string;
  employee_code: string;
  employee_name: string;
  duty_date: string;
  duty_code: string;
  duty_description: string;
}

export default function SupervisorAttendance() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTeam, setSelectedTeam] = useState("all");
  const [selectedShiftCategory, setSelectedShiftCategory] = useState<string>("all");
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const { users, isLoading: usersLoading } = useUsers();
  const {
    attendance,
    isLoading: attendanceLoading,
    bulkUpsertAttendance,
    isBulkUpserting,
  } = useAttendance(dateStr);

  // Fetch employee schedules for the selected date
  const { data: schedules = [], isLoading: schedulesLoading } = useQuery({
    queryKey: ["attendance-schedules", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_schedules" as any)
        .select("id, employee_code, employee_name, duty_date, duty_code, duty_description")
        .eq("duty_date", dateStr);
      if (error) throw error;
      return (data || []) as unknown as ScheduleEntry[];
    },
  });

  const employees = useMemo(() => users || [], [users]);

  // Build a map of employee_id → user profile for fast lookup
  const employeeMap = useMemo(() => {
    const map = new Map<string, (typeof employees)[number]>();
    for (const u of employees) {
      if (u.employee_id) {
        map.set(u.employee_id.trim().toUpperCase(), u);
      }
    }
    return map;
  }, [employees]);

  // Join schedules with profiles via employee_code → employee_id
  const scheduleEntries = useMemo(() => {
    return schedules.map((s) => ({
      schedule: s,
      user: employeeMap.get((s.employee_code || "").trim().toUpperCase()) || null,
    }));
  }, [schedules, employeeMap]);

  // Derive team options from matched profiles' current_shift
  const teamOptions = useMemo(() => {
    const teams = new Set<string>();
    for (const entry of scheduleEntries) {
      if (entry.user?.current_shift) {
        teams.add(entry.user.current_shift);
      }
    }
    return Array.from(teams).sort((a, b) => a.localeCompare(b));
  }, [scheduleEntries]);

  /** Normalize a single token */
  const normalizeToken = (t: string) => {
    const s = t.trim().toUpperCase();
    if (s === "GENERAL") return "G";
    if (s === "MORNING") return "M";
    if (s === "AFTERNOON") return "A";
    if (s === "NIGHT") return "N";
    return s;
  };

  /** Split compound duty codes into individual shift tokens.
   *  e.g. "M+A" → ["M", "A"], "NO+N" → ["NO", "N"] */
  const getDutyShiftTokens = (code: string): string[] => {
    if (!code) return [];
    return code.split("+").map(normalizeToken).filter(Boolean);
  };

  // Compute counts for each shift category
  const allUnmatched = useMemo(
    () => scheduleEntries.filter((e) => !e.user),
    [scheduleEntries]
  );

  const shiftCounts = useMemo(() => {
    const matched = scheduleEntries.filter((e) => !!e.user);
    const counts = { G: 0, M: 0, A: 0, N: 0, unmatched: allUnmatched.length };
    matched.forEach((e) => {
      const tokens = getDutyShiftTokens(e.schedule.duty_code);
      tokens.forEach((t) => {
        if (t in counts) (counts as any)[t]++;
      });
    });
    return counts;
  }, [scheduleEntries, allUnmatched]);

  // Filter by team (from profile) and shift category
  const filteredEntries = useMemo(() => {
    if (selectedShiftCategory === "unmatched") return [];

    let entries = scheduleEntries.filter((e) => !!e.user);

    if (selectedTeam !== "all") {
      entries = entries.filter((e) => e.user?.current_shift === selectedTeam);
    }

    if (selectedShiftCategory !== "all") {
      entries = entries.filter((e) => {
        const tokens = getDutyShiftTokens(e.schedule.duty_code);
        return tokens.includes(selectedShiftCategory);
      });
    }

    return entries;
  }, [scheduleEntries, selectedTeam, selectedShiftCategory]);

  // Build attendance rows from schedule + profile data
  useEffect(() => {
    const rows: AttendanceRow[] = filteredEntries
      .filter((e) => !!e.user)
      .map(({ schedule, user }) => {
        const existing = attendance?.find((a) => a.user_id === user!.id);
        return {
          userId: user!.id,
          name: user!.full_name,
          empId: user!.employee_id,
          team: user!.current_shift || "—",
          shift: schedule.duty_code,
          position: schedule.duty_description || "",
          status: existing
            ? (existing.status as "present" | "absent")
            : "present",
          timeIn: existing?.time_in
            ? format(new Date(existing.time_in), "HH:mm")
            : "",
          timeOut: existing?.time_out
            ? format(new Date(existing.time_out), "HH:mm")
            : "",
          comments: existing?.comments || "",
          existingId: existing?.id,
        };
      });
    setAttendanceRows(rows);
  }, [filteredEntries, attendance]);

  const handleMarkAll = (status: "present" | "absent") => {
    setAttendanceRows((prev) => prev.map((emp) => ({ ...emp, status })));
  };

  const toggleStatus = (userId: string) => {
    setAttendanceRows((prev) =>
      prev.map((emp) =>
        emp.userId === userId
          ? {
            ...emp,
            status: emp.status === "present" ? "absent" : "present",
          }
          : emp
      )
    );
  };

  const handleSave = () => {
    const records = attendanceRows.map((r) => ({
      user_id: r.userId,
      attendance_date: dateStr,
      status: r.status as any,
      marked_by: "",
      time_in: r.timeIn
        ? new Date(`${dateStr}T${r.timeIn}`).toISOString()
        : null,
      time_out: r.timeOut
        ? new Date(`${dateStr}T${r.timeOut}`).toISOString()
        : null,
      comments: r.comments || null,
    }));

    if (records.length > 0) {
      bulkUpsertAttendance(records);
    }
  };

  const presentCount = attendanceRows.filter(
    (a) => a.status === "present"
  ).length;
  const absentCount = attendanceRows.filter(
    (a) => a.status === "absent"
  ).length;
  const isLoading = usersLoading || attendanceLoading || schedulesLoading;

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Attendance Management</h1>
            <p className="text-muted-foreground">
              Mark and track employee attendance
            </p>
          </div>
          <Button>
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>

        {/* Shift Category Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: "all", label: "ALL", count: scheduleEntries.filter(e => !!e.user).length, color: "" },
            { key: "G", label: "GENERAL", count: shiftCounts.G, color: "bg-blue-600 hover:bg-blue-700 text-white" },
            { key: "M", label: "MORNING", count: shiftCounts.M, color: "bg-amber-500 hover:bg-amber-600 text-white" },
            { key: "A", label: "AFTERNOON", count: shiftCounts.A, color: "bg-orange-500 hover:bg-orange-600 text-white" },
            { key: "N", label: "NIGHT", count: shiftCounts.N, color: "bg-indigo-600 hover:bg-indigo-700 text-white" },
            { key: "unmatched", label: "NOT MATCHED", count: shiftCounts.unmatched, color: "bg-red-600 hover:bg-red-700 text-white" },
          ].map((cat) => (
            <Button
              key={cat.key}
              variant={selectedShiftCategory === cat.key ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedShiftCategory(cat.key)}
              className={cn(
                "font-semibold",
                selectedShiftCategory === cat.key && cat.color
              )}
            >
              {cat.key === "unmatched" && <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />}
              {cat.label} ({cat.count})
            </Button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Present</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{presentCount}</div>
              <p className="text-xs text-muted-foreground">
                employees on duty
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Absent</CardTitle>
              <XCircle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{absentCount}</div>
              <p className="text-xs text-muted-foreground">
                employees absent
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total</CardTitle>
              <Clock className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{attendanceRows.length}</div>
              <p className="text-xs text-muted-foreground">
                employees in team/date filter
              </p>
            </CardContent>
          </Card>
        </div>

        {/* NOT MATCHED view */}
        {selectedShiftCategory === "unmatched" ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                Not Matched Schedule Entries ({allUnmatched.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {allUnmatched.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  All schedule entries are matched with employee profiles!
                </p>
              ) : (
                <div className="border rounded-lg">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium">Employee Code</th>
                          <th className="text-left p-3 font-medium">Employee Name</th>
                          <th className="text-left p-3 font-medium">Duty Code</th>
                          <th className="text-left p-3 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allUnmatched.map((entry) => (
                          <tr key={entry.schedule.id} className="border-t hover:bg-accent/50 transition-colors">
                            <td className="p-3 font-mono font-medium">{entry.schedule.employee_code}</td>
                            <td className="p-3">{entry.schedule.employee_name}</td>
                            <td className="p-3 font-semibold">{entry.schedule.duty_code}</td>
                            <td className="p-3 text-muted-foreground">{entry.schedule.duty_description || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <CardTitle>Mark Attendance</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "justify-start text-left font-normal"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(selectedDate, "PPP")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(date) => date && setSelectedDate(date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Select
                    value={selectedTeam}
                    onValueChange={setSelectedTeam}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Select team" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Teams</SelectItem>
                      {teamOptions.map((team) => (
                        <SelectItem key={team} value={team}>
                          TEAM {team.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {attendanceRows.length} employees
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMarkAll("present")}
                    >
                      Mark All Present
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMarkAll("absent")}
                    >
                      Mark All Absent
                    </Button>
                    <Button
                      onClick={handleSave}
                      size="sm"
                      disabled={
                        isBulkUpserting || attendanceRows.length === 0
                      }
                    >
                      {isBulkUpserting ? "Saving..." : "Save Attendance"}
                    </Button>
                  </div>
                </div>

                {isLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : attendanceRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No employees found for selected team and date
                  </p>
                ) : (
                  <div className="border rounded-lg">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-3 font-medium">
                              Employee
                            </th>
                            <th className="text-left p-3 font-medium">Team</th>
                            <th className="text-left p-3 font-medium">
                              Duty Code
                            </th>
                            <th className="text-left p-3 font-medium">
                              Status
                            </th>
                            <th className="text-left p-3 font-medium">
                              Comments
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {attendanceRows.map((emp) => (
                            <tr
                              key={emp.userId}
                              className="border-t hover:bg-accent/50 transition-colors"
                            >
                              <td className="p-3">
                                <div>
                                  <p className="font-medium">{emp.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {emp.empId}
                                  </p>
                                </div>
                              </td>
                              <td className="p-3 font-semibold">{(emp.team || "").toUpperCase()}</td>
                              <td className="p-3">
                                <div className="text-sm font-medium">
                                  {emp.shift}
                                </div>
                                {emp.position && (
                                  <div className="text-xs text-muted-foreground">
                                    {emp.position}
                                  </div>
                                )}
                              </td>
                              <td className="p-3">
                                <Button
                                  variant={
                                    emp.status === "present"
                                      ? "default"
                                      : "outline"
                                  }
                                  size="sm"
                                  onClick={() => toggleStatus(emp.userId)}
                                  className={cn(
                                    emp.status === "present" &&
                                    "bg-green-600 hover:bg-green-700",
                                    emp.status === "absent" &&
                                    "bg-red-600 hover:bg-red-700 text-white"
                                  )}
                                >
                                  {emp.status === "present"
                                    ? "Present"
                                    : "Absent"}
                                </Button>
                              </td>
                              <td className="p-3">
                                <Input
                                  placeholder="Add note..."
                                  value={emp.comments}
                                  onChange={(e) =>
                                    setAttendanceRows((prev) =>
                                      prev.map((r) =>
                                        r.userId === emp.userId
                                          ? { ...r, comments: e.target.value }
                                          : r
                                      )
                                    )
                                  }
                                  className="w-40"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}


              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
