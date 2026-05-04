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
import { Link, useSearchParams } from "react-router-dom";
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import { getAttendanceShiftTokens } from "@/lib/teamDutyRotation";

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

const normalizeName = (name: string) => name.trim().toUpperCase().replace(/\s+/g, " ");

export default function SupervisorAttendance() {
  const [searchParams] = useSearchParams();
  const initialDateParam = searchParams.get("date");
  const initialDate = initialDateParam ? new Date(`${initialDateParam}T00:00:00`) : new Date();
  const [selectedDate, setSelectedDate] = useState<Date>(
    Number.isNaN(initialDate.getTime()) ? new Date() : initialDate
  );
  const [selectedTeam, setSelectedTeam] = useState("all");
  const initialShift = (searchParams.get("shift") || "all").toUpperCase();
  const allowedShiftFilters = new Set(["ALL", "G", "M", "A", "N", "NO", "CO", "UNMATCHED"]);
  const [selectedShiftCategory, setSelectedShiftCategory] = useState<string>(
    !allowedShiftFilters.has(initialShift)
      ? "all"
      : initialShift === "ALL"
        ? "all"
        : initialShift === "UNMATCHED"
          ? "unmatched"
          : initialShift
  );
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
    queryKey: scheduleKeys.day(dateStr),
    ...SCHEDULE_QUERY_OPTIONS,
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
  const employeeMapByCode = useMemo(() => {
    const map = new Map<string, (typeof employees)[number]>();
    for (const u of employees) {
      if (u.employee_id) {
        map.set(u.employee_id.trim().toUpperCase(), u);
      }
    }
    return map;
  }, [employees]);

  // Fallback map by normalized full name (for schedule rows where code does not match).
  const employeeMapByName = useMemo(() => {
    const map = new Map<string, (typeof employees)>();
    for (const u of employees) {
      const key = normalizeName(u.full_name || "");
      if (!key) continue;
      const existing = map.get(key) || [];
      existing.push(u);
      map.set(key, existing);
    }
    return map;
  }, [employees]);

  // Join schedules with profiles via employee_code → employee_id.
  // Fallback: if code lookup fails, try unique full_name match.
  const scheduleEntries = useMemo(() => {
    return schedules.map((s) => ({
      schedule: s,
      user: (() => {
        const byCode = employeeMapByCode.get((s.employee_code || "").trim().toUpperCase()) || null;
        if (byCode) return byCode;
        const nameCandidates = employeeMapByName.get(normalizeName(s.employee_name || "")) || [];
        return nameCandidates.length === 1 ? nameCandidates[0] : null;
      })(),
    }));
  }, [schedules, employeeMapByCode, employeeMapByName]);

  // Warning report: duplicate and missing employee_id records in profiles.
  const missingEmployeeIdRecords = useMemo(
    () => employees.filter((u) => !u.employee_id || !u.employee_id.trim()),
    [employees]
  );

  const duplicateEmployeeIdGroups = useMemo(() => {
    const grouped = new Map<string, (typeof employees)>();
    for (const u of employees) {
      const key = (u.employee_id || "").trim().toUpperCase();
      if (!key) continue;
      const arr = grouped.get(key) || [];
      arr.push(u);
      grouped.set(key, arr);
    }
    return Array.from(grouped.entries()).filter(([, arr]) => arr.length > 1);
  }, [employees]);

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

  /** Split compound duty codes into individual shift tokens.
   *  e.g. "M+A" → ["M", "A"], "NO+N" → ["NO", "N"] */
  const getDutyShiftTokens = (code: string): string[] => {
    if (!code) return [];
    return getAttendanceShiftTokens(code).map((token) => {
      if (token === "MORNING") return "M";
      if (token === "AFTERNOON") return "A";
      if (token === "NIGHT") return "N";
      return token;
    }).filter(Boolean);
  };

  // Compute counts for each shift category
  const allUnmatched = useMemo(
    () => scheduleEntries.filter((e) => !e.user),
    [scheduleEntries]
  );

  const shiftCounts = useMemo(() => {
    const matched = scheduleEntries.filter((e) => !!e.user);
    const counts = { G: 0, M: 0, A: 0, N: 0, NO: 0, CO: 0, unmatched: allUnmatched.length };
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
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/supervisor/attendance-view">
                <CalendarIcon className="mr-2 h-4 w-4" />
                View Attendance
              </Link>
            </Button>
            <Button className="w-full sm:w-auto">
              <Download className="mr-2 h-4 w-4" />
              Export Report
            </Button>
          </div>
        </div>

        {/* Shift Category Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: "all", label: "ALL", count: scheduleEntries.filter(e => !!e.user).length, color: "" },
            { key: "G", label: "GENERAL", count: shiftCounts.G, color: "bg-blue-600 hover:bg-blue-700 text-white" },
            { key: "M", label: "MORNING", count: shiftCounts.M, color: "bg-amber-500 hover:bg-amber-600 text-white" },
            { key: "A", label: "AFTERNOON", count: shiftCounts.A, color: "bg-orange-500 hover:bg-orange-600 text-white" },
            { key: "N", label: "NIGHT", count: shiftCounts.N, color: "bg-indigo-600 hover:bg-indigo-700 text-white" },
            { key: "NO", label: "NIGHT OFF", count: shiftCounts.NO, color: "bg-slate-500 hover:bg-slate-600 text-white" },
            { key: "CO", label: "CLEAR OFF", count: shiftCounts.CO, color: "bg-gray-500 hover:bg-gray-600 text-white" },
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

        {(missingEmployeeIdRecords.length > 0 || duplicateEmployeeIdGroups.length > 0) && (
          <Card className="border-amber-300">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
                Data Warnings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {missingEmployeeIdRecords.length > 0 && (
                <div>
                  <p className="font-medium text-amber-700">
                    Missing employee_id: {missingEmployeeIdRecords.length}
                  </p>
                  <p className="text-muted-foreground">
                    These profiles cannot be code-matched against schedule entries.
                  </p>
                </div>
              )}
              {duplicateEmployeeIdGroups.length > 0 && (
                <div>
                  <p className="font-medium text-amber-700">
                    Duplicate employee_id groups: {duplicateEmployeeIdGroups.length}
                  </p>
                  <p className="text-muted-foreground">
                    Duplicate IDs can produce ambiguous attendance matching.
                  </p>
                  <div className="mt-2 space-y-1">
                    {duplicateEmployeeIdGroups.slice(0, 6).map(([empId, rows]) => (
                      <p key={empId} className="text-xs text-muted-foreground">
                        {empId}: {rows.map((r) => r.full_name).join(", ")}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal sm:w-auto"
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
                    <SelectTrigger className="w-full sm:w-[180px]">
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
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {attendanceRows.length} employees
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMarkAll("present")}
                      className="w-full sm:w-auto"
                    >
                      Mark All Present
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMarkAll("absent")}
                      className="w-full sm:w-auto"
                    >
                      Mark All Absent
                    </Button>
                    <Button
                      onClick={handleSave}
                      size="sm"
                      className="w-full sm:w-auto"
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
                    <div className="hidden md:block overflow-x-auto">
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

                    <div className="space-y-3 p-3 md:hidden">
                      {attendanceRows.map((emp) => (
                        <div
                          key={emp.userId}
                          className="rounded-lg border bg-background p-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium leading-tight">{emp.name}</p>
                              <p className="text-xs text-muted-foreground">{emp.empId}</p>
                            </div>
                            <span className="rounded bg-muted px-2 py-1 text-xs font-semibold">
                              {(emp.team || "").toUpperCase() || "—"}
                            </span>
                          </div>

                          <div className="mt-3 space-y-2">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Duty Code</p>
                              <p className="text-sm font-medium">{emp.shift}</p>
                              {emp.position ? (
                                <p className="text-xs text-muted-foreground">{emp.position}</p>
                              ) : null}
                            </div>

                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
                              <Button
                                variant={emp.status === "present" ? "default" : "outline"}
                                size="sm"
                                onClick={() => toggleStatus(emp.userId)}
                                className={cn(
                                  "mt-1 w-full",
                                  emp.status === "present" && "bg-green-600 hover:bg-green-700",
                                  emp.status === "absent" && "bg-red-600 hover:bg-red-700 text-white"
                                )}
                              >
                                {emp.status === "present" ? "Present" : "Absent"}
                              </Button>
                            </div>

                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Comments</p>
                              <Input
                                placeholder="Add note..."
                                value={emp.comments}
                                onChange={(e) =>
                                  setAttendanceRows((prev) =>
                                    prev.map((row) =>
                                      row.userId === emp.userId
                                        ? { ...row, comments: e.target.value }
                                        : row
                                    )
                                  )
                                }
                                className="mt-1 w-full"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
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
