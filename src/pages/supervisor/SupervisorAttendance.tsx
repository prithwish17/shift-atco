import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon, Download, CheckCircle, XCircle, Clock } from "lucide-react";
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

export default function SupervisorAttendance() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTeam, setSelectedTeam] = useState("all");
  const [selectedDutyShift, setSelectedDutyShift] = useState("all");
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const rosterDateDisplay = format(selectedDate, "dd-MMM-yyyy");
  const rosterDateDisplayNoPad = format(selectedDate, "d-MMM-yyyy");
  const { users, isLoading: usersLoading } = useUsers();
  const {
    attendance,
    isLoading: attendanceLoading,
    bulkUpsertAttendance,
    isBulkUpserting,
  } = useAttendance(dateStr);

  const { data: rosters = [], isLoading: rostersLoading } = useQuery({
    queryKey: ["attendance-rosters", dateStr],
    queryFn: async () => {
      // Primary lookup: exact ISO date format (yyyy-MM-dd)
      const { data: isoRows, error: isoError } = await supabase
        .from("rosters" as any)
        .select("date, team, shift, employee_name, position")
        .eq("date", dateStr);
      if (isoError) throw isoError;

      if ((isoRows || []).length > 0) {
        return (isoRows || []) as Array<{
          date: string;
          team: string;
          shift: string;
          employee_name: string;
          position: string;
        }>;
      }

      // Fallback for legacy stored date formats
      const { data: legacyRows, error: legacyError } = await supabase
        .from("rosters" as any)
        .select("date, team, shift, employee_name, position")
        .or(`date.eq.${rosterDateDisplay},date.eq.${rosterDateDisplayNoPad}`);
      if (legacyError) throw legacyError;
      return (legacyRows || []) as Array<{
        date: string;
        team: string;
        shift: string;
        employee_name: string;
        position: string;
      }>;
    },
  });

  const teamOptions = useMemo(() => {
    const values = Array.from(new Set(rosters.map((r) => r.team))).filter(Boolean);
    return values.sort((a, b) => a.localeCompare(b));
  }, [rosters]);

  const normalizeName = (name: string) =>
    name
      .toLowerCase()
      .split("/")[0]
      .replace(/-(sm|dgm|mgr|je|am|agm)$/i, "")
      .replace(/[._,-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const employees = useMemo(() => {
    // Use all profiles for matching; many valid employee rows may not have approved role metadata yet.
    return users || [];
  }, [users]);

  const findUserByRosterName = (rosterName: string) => {
    const normalizedRoster = normalizeName(rosterName);
    const normalizedRosterNoSpace = normalizedRoster.replace(/\s+/g, "");
    const rosterTokens = normalizedRoster.split(" ").filter(Boolean);

    let matched = employees.find((u) => normalizeName(u.full_name) === normalizedRoster);
    if (matched) return matched;

    matched = employees.find(
      (u) => normalizeName(u.full_name).replace(/\s+/g, "") === normalizedRosterNoSpace
    );
    if (matched) return matched;

    matched = employees.find((u) => {
      const n = normalizeName(u.full_name);
      return n.includes(normalizedRoster) || normalizedRoster.includes(n);
    });
    if (matched) return matched;

    // Fallback: token overlap (handles initials/order/noise in roster names)
    matched = employees.find((u) => {
      const tokens = normalizeName(u.full_name).split(" ").filter(Boolean);
      const common = rosterTokens.filter((t) => tokens.includes(t)).length;
      return common >= Math.min(2, rosterTokens.length);
    });
    return matched || null;
  };

  const normalizeDutyShift = (shift: string) => {
    const s = (shift || "").trim().toUpperCase();
    if (s === "GENERAL" || s === "G") return "G";
    if (s === "M" || s === "MORNING") return "M";
    if (s === "A" || s === "AFTERNOON") return "A";
    if (s === "N" || s === "NIGHT") return "N";
    return s;
  };

  const teamRosterEntries = useMemo(() => {
    const teamFiltered = selectedTeam === "all" ? rosters : rosters.filter((r) => r.team === selectedTeam);
    const rows =
      selectedDutyShift === "all"
        ? teamFiltered
        : teamFiltered.filter((r) => normalizeDutyShift(r.shift) === selectedDutyShift);
    return rows.map((r) => ({
      roster: r,
      user: findUserByRosterName(r.employee_name),
    }));
  }, [rosters, selectedTeam, selectedDutyShift, employees]);

  const unmatchedRosterEntries = teamRosterEntries.filter((e) => !e.user);

  // Build attendance rows from real data
  useEffect(() => {
    const rows: AttendanceRow[] = teamRosterEntries
      .filter((e) => !!e.user)
      .map(({ roster, user }) => {
      const existing = attendance?.find(a => a.user_id === user.id);
      return {
        userId: user.id,
        name: user.full_name,
        empId: user.employee_id,
        team: roster.team,
        shift: roster.shift,
        position: roster.position,
        status: existing ? (existing.status as "present" | "absent") : "present",
        timeIn: existing?.time_in ? format(new Date(existing.time_in), "HH:mm") : "",
        timeOut: existing?.time_out ? format(new Date(existing.time_out), "HH:mm") : "",
        comments: existing?.comments || "",
        existingId: existing?.id,
      };
    });
    setAttendanceRows(rows);
  }, [teamRosterEntries, attendance]);

  const handleMarkAll = (status: "present" | "absent") => {
    setAttendanceRows(prev => prev.map(emp => ({ ...emp, status })));
  };

  const toggleStatus = (userId: string) => {
    setAttendanceRows(prev =>
      prev.map(emp =>
        emp.userId === userId
          ? { ...emp, status: emp.status === "present" ? "absent" : "present" }
          : emp
      )
    );
  };

  const handleSave = () => {
    const records = attendanceRows.map(r => ({
        user_id: r.userId,
        attendance_date: dateStr,
        status: r.status as any,
        marked_by: "",
        time_in: r.timeIn ? new Date(`${dateStr}T${r.timeIn}`).toISOString() : null,
        time_out: r.timeOut ? new Date(`${dateStr}T${r.timeOut}`).toISOString() : null,
        comments: r.comments || null,
      }));

    if (records.length > 0) {
      bulkUpsertAttendance(records);
    }
  };

  const presentCount = attendanceRows.filter(a => a.status === "present").length;
  const absentCount = attendanceRows.filter(a => a.status === "absent").length;
  const isLoading = usersLoading || attendanceLoading || rostersLoading;

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Attendance Management</h1>
            <p className="text-muted-foreground">Mark and track employee attendance</p>
          </div>
          <Button>
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Present</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{presentCount}</div>
              <p className="text-xs text-muted-foreground">employees on duty</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Absent</CardTitle>
              <XCircle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{absentCount}</div>
              <p className="text-xs text-muted-foreground">employees absent</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total</CardTitle>
              <Clock className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{attendanceRows.length}</div>
              <p className="text-xs text-muted-foreground">employees in team/date filter</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <CardTitle>Mark Attendance</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                  <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("justify-start text-left font-normal")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(selectedDate, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={selectedDate} onSelect={(date) => date && setSelectedDate(date)} initialFocus />
                  </PopoverContent>
                </Popover>
                <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Teams</SelectItem>
                    {teamOptions.map((team) => (
                      <SelectItem key={team} value={team}>
                        Team {team}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedDutyShift} onValueChange={setSelectedDutyShift}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Select shift" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Shifts</SelectItem>
                    <SelectItem value="G">G</SelectItem>
                    <SelectItem value="M">M</SelectItem>
                    <SelectItem value="A">A</SelectItem>
                    <SelectItem value="N">N</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{attendanceRows.length} employees</p>
                  {unmatchedRosterEntries.length > 0 && (
                    <p className="text-xs text-amber-600">
                      {unmatchedRosterEntries.length} roster name(s) could not be matched with employee profiles.
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleMarkAll("present")}>Mark All Present</Button>
                  <Button variant="outline" size="sm" onClick={() => handleMarkAll("absent")}>Mark All Absent</Button>
                </div>
              </div>

              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
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
                          <th className="text-left p-3 font-medium">Employee</th>
                          <th className="text-left p-3 font-medium">Team</th>
                          <th className="text-left p-3 font-medium">Shift/Pos</th>
                          <th className="text-left p-3 font-medium">Status</th>
                          <th className="text-left p-3 font-medium">Time In</th>
                          <th className="text-left p-3 font-medium">Time Out</th>
                          <th className="text-left p-3 font-medium">Comments</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendanceRows.map((emp) => (
                          <tr key={emp.userId} className="border-t hover:bg-accent/50 transition-colors">
                            <td className="p-3">
                              <div>
                                <p className="font-medium">{emp.name}</p>
                                <p className="text-xs text-muted-foreground">{emp.empId}</p>
                              </div>
                            </td>
                            <td className="p-3">Team {emp.team}</td>
                            <td className="p-3">
                              <div className="text-sm">{normalizeDutyShift(emp.shift)}</div>
                              <div className="text-xs text-muted-foreground">{emp.position}</div>
                            </td>
                            <td className="p-3">
                              <Button
                                variant={emp.status === "present" ? "default" : "outline"}
                                size="sm"
                                onClick={() => toggleStatus(emp.userId)}
                                className={cn(
                                  emp.status === "present" && "bg-green-600 hover:bg-green-700",
                                  emp.status === "absent" && "bg-red-600 hover:bg-red-700 text-white"
                                )}
                              >
                                {emp.status === "present" ? "Present" : "Absent"}
                              </Button>
                            </td>
                            <td className="p-3">
                              <Input
                                type="time"
                                value={emp.timeIn}
                                onChange={e => setAttendanceRows(prev => prev.map(r => r.userId === emp.userId ? { ...r, timeIn: e.target.value } : r))}
                                disabled={emp.status !== "present"}
                                className="w-32"
                              />
                            </td>
                            <td className="p-3">
                              <Input
                                type="time"
                                value={emp.timeOut}
                                onChange={e => setAttendanceRows(prev => prev.map(r => r.userId === emp.userId ? { ...r, timeOut: e.target.value } : r))}
                                disabled={emp.status !== "present"}
                                className="w-32"
                              />
                            </td>
                            <td className="p-3">
                              <Input
                                placeholder="Add note..."
                                value={emp.comments}
                                onChange={e => setAttendanceRows(prev => prev.map(r => r.userId === emp.userId ? { ...r, comments: e.target.value } : r))}
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

              <div className="flex justify-end">
                <Button onClick={handleSave} size="lg" disabled={isBulkUpserting || attendanceRows.length === 0}>
                  {isBulkUpserting ? "Saving..." : "Save Attendance"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
