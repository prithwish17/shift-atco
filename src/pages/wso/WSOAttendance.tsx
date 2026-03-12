import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, Download, CheckCircle, XCircle } from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile, useUsers } from "@/hooks/useUsers";
import { useAttendance } from "@/hooks/useAttendance";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";

interface EmployeeAttendance {
  userId: string;
  name: string;
  empId: string;
  status: "present" | "absent";
  dutyCode: string;
  timeIn: string;
  timeOut: string;
}

const DUTY_CYCLE: Array<"M" | "A" | "N" | "NO" | "CO"> = ["M", "A", "N", "NO", "CO"];
const TODAY_TEAM_DUTY_BASE: Record<string, "M" | "A" | "N" | "NO" | "CO"> = {
  A: "A",
  B: "M",
  C: "CO",
  D: "NO",
  E: "N",
  G: "M",
};
const HOLIDAY_CODES = new Set(["NO", "CO", "SAT", "SUN", "CH", "NH", "NA", "SL", "GO", "TR"]);
const SPECIAL_DUTY_MATCH: Record<string, Array<"M" | "A" | "N" | "NO" | "CO">> = {
  "M+A": ["M", "A"],
  "NO+N": ["N"],
  "SAT+NO": ["NO"],
  "SUN+N": ["N"],
  "SUN+M": ["M"],
  "SUN+A": ["A"],
  "SUN+NO": ["NO"],
  "SAT+N": ["N"],
  "CO+N": ["N"],
  "CO+A": ["A"],
  "CO+M": ["M"],
  "A+M": ["A", "M"],
  "SL": ["CO"], // clear off
  "TR": ["CO"], // off day
  "GO": ["CO"], // gazette off
};

function normalizeTeamKey(value?: string | null) {
  if (!value) return "G";
  const v = value.toUpperCase();
  return v === "GENERAL" ? "G" : v;
}

function getTeamDutyForDate(teamKey: string, date: Date) {
  const base = TODAY_TEAM_DUTY_BASE[teamKey] || "M";
  const baseIndex = DUTY_CYCLE.indexOf(base);
  const offset = differenceInCalendarDays(date, new Date());
  const idx = (baseIndex + (offset % DUTY_CYCLE.length) + DUTY_CYCLE.length) % DUTY_CYCLE.length;
  return DUTY_CYCLE[idx];
}

function parseDutyTokens(dutyCode?: string | null) {
  if (!dutyCode) return [];
  return dutyCode
    .toUpperCase()
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
}

function getDutyShiftMatches(dutyCode: string | null | undefined) {
  if (!dutyCode) return [] as Array<"M" | "A" | "N" | "NO" | "CO">;
  const normalized = dutyCode.toUpperCase().trim();
  const explicit = SPECIAL_DUTY_MATCH[normalized];
  if (explicit) return explicit;

  const tokens = parseDutyTokens(normalized);
  const matches = tokens.filter((t): t is "M" | "A" | "N" | "NO" | "CO" =>
    t === "M" || t === "A" || t === "N" || t === "NO" || t === "CO"
  );
  return matches;
}

function isEligibleDutyForAttendance(dutyCode: string | null | undefined, teamDuty: "M" | "A" | "N" | "NO" | "CO") {
  // NO and CO team-duty days are treated as off/holiday attendance days.
  if (teamDuty === "NO" || teamDuty === "CO") return false;

  const matches = getDutyShiftMatches(dutyCode);
  if (matches.length === 0) return false;
  if (!matches.includes(teamDuty)) return false;

  const tokens = parseDutyTokens(dutyCode);
  if (tokens.every((t) => HOLIDAY_CODES.has(t))) return false;
  return true;
}

function isHolidayOrOffDuty(dutyCode: string | null | undefined) {
  const tokens = parseDutyTokens(dutyCode);
  if (tokens.length === 0) return false;
  return tokens.every((t) => HOLIDAY_CODES.has(t));
}

export default function WSOAttendance() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const [attendanceState, setAttendanceState] = useState<Record<string, EmployeeAttendance>>({});

  const { user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const { users, isLoading: usersLoading } = useUsers();
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const { attendance, isLoading: attendanceLoading, bulkUpsertAttendance, isBulkUpserting } = useAttendance(dateStr);

  // Team-aware duty cycle + schedule-driven attendance source.
  const wsoShift = profile?.current_shift || "general";
  const wsoTeamKey = normalizeTeamKey(wsoShift);
  const teamDutyToday = getTeamDutyForDate(wsoTeamKey, selectedDate);

  const teamUsers = useMemo(
    () => (users || []).filter((u) => u.approved && normalizeTeamKey(u.current_shift) === wsoTeamKey),
    [users, wsoTeamKey]
  );
  const teamEmployeeCodes = useMemo(
    () => [...new Set(teamUsers.map((u) => u.employee_id).filter(Boolean))],
    [teamUsers]
  );

  const { data: daySchedules = [], isLoading: schedulesLoading } = useQuery({
    queryKey: scheduleKeys.teamDay(dateStr, wsoTeamKey),
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      if (teamEmployeeCodes.length === 0) return [];
      const { data, error } = await supabase
        .from("employee_schedules" as any)
        .select("employee_code, duty_code")
        .eq("duty_date", dateStr)
        .in("employee_code", teamEmployeeCodes as string[]);
      if (error) throw error;
      return (data || []) as Array<{ employee_code: string; duty_code: string }>;
    },
    enabled: teamEmployeeCodes.length > 0,
  });

  const dutyByEmployeeCode = useMemo(() => {
    const map = new Map<string, string>();
    daySchedules.forEach((s) => {
      map.set(s.employee_code, s.duty_code);
    });
    return map;
  }, [daySchedules]);

  const shiftEmployees = useMemo(
    () =>
      teamUsers.filter((u) =>
        isEligibleDutyForAttendance(dutyByEmployeeCode.get(u.employee_id), teamDutyToday)
      ),
    [teamUsers, dutyByEmployeeCode, teamDutyToday]
  );

  const holidayOffEmployees = useMemo(
    () => teamUsers.filter((u) => isHolidayOrOffDuty(dutyByEmployeeCode.get(u.employee_id))),
    [teamUsers, dutyByEmployeeCode]
  );

  // Initialize attendance state from real data
  useEffect(() => {
    const state: Record<string, EmployeeAttendance> = {};
    shiftEmployees.forEach(emp => {
      const existing = attendance?.find(a => a.user_id === emp.id);
      state[emp.id] = {
        userId: emp.id,
        name: emp.full_name,
        empId: emp.employee_id,
        status: existing ? (existing.status as "present" | "absent") : "present",
        dutyCode: dutyByEmployeeCode.get(emp.employee_id) || "",
        timeIn: existing?.time_in ? format(new Date(existing.time_in), "HH:mm") : "",
        timeOut: existing?.time_out ? format(new Date(existing.time_out), "HH:mm") : "",
      };
    });
    setAttendanceState(state);
  }, [shiftEmployees, attendance, dutyByEmployeeCode]);

  const allEmployees = Object.values(attendanceState);
  const stats = {
    present: allEmployees.filter((e) => e.status === "present").length,
    absent: allEmployees.filter((e) => e.status === "absent").length,
    total: allEmployees.length,
  };

  const toggleStatus = (empId: string) => {
    setAttendanceState((prev) => ({
      ...prev,
      [empId]: {
        ...prev[empId],
        status: prev[empId]?.status === "present" ? "absent" : "present",
      },
    }));
  };

  const handleSave = () => {
    const dutyRecords = allEmployees.map((r) => ({
      user_id: r.userId,
      attendance_date: dateStr,
      status: r.status as "present" | "absent",
      comments: r.dutyCode || null,
      marked_by: "",
      time_in: r.timeIn ? new Date(`${dateStr}T${r.timeIn}`).toISOString() : null,
      time_out: r.timeOut ? new Date(`${dateStr}T${r.timeOut}`).toISOString() : null,
    }));

    const holidayRecords = holidayOffEmployees.map((u) => ({
      user_id: u.id,
      attendance_date: dateStr,
      status: "on_leave" as const,
      comments: dutyByEmployeeCode.get(u.employee_id) || "OFF",
      marked_by: "",
      time_in: null,
      time_out: null,
    }));

    const records = [...dutyRecords, ...holidayRecords];
    if (records.length > 0) {
      bulkUpsertAttendance(records as any);
    }
  };

  const isLoading = usersLoading || attendanceLoading || schedulesLoading;

  const renderEmployeeRow = (emp: EmployeeAttendance) => (
    <div key={emp.userId} className="flex items-center justify-between p-3 border rounded-lg bg-accent/30">
      <div className="flex items-center gap-4">
        <div>
          <p className="font-medium">{emp.name}</p>
          <p className="text-xs text-muted-foreground">{emp.empId}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold px-2 py-1 rounded bg-muted">{emp.dutyCode || "—"}</span>
        <Input
          type="time"
          value={emp.timeIn}
          onChange={e => setAttendanceState(prev => ({ ...prev, [emp.userId]: { ...prev[emp.userId], timeIn: e.target.value } }))}
          className="w-32"
        />
        <Input
          type="time"
          value={emp.timeOut}
          onChange={e => setAttendanceState(prev => ({ ...prev, [emp.userId]: { ...prev[emp.userId], timeOut: e.target.value } }))}
          className="w-32"
        />
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
      </div>
    </div>
  );

  return (
    <DashboardLayout role="wso">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Attendance Marking</h1>
            <p className="text-muted-foreground">
              Mark attendance for Team {wsoTeamKey} ({teamDutyToday}) duty
            </p>
          </div>
          <div className="flex gap-2">
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
            <Button>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Present</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.present}</div>
              <p className="text-xs text-muted-foreground">out of {stats.total} employees</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Absent</CardTitle>
              <XCircle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.absent}</div>
              <p className="text-xs text-muted-foreground">employees marked absent</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Attendance Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0}%</div>
              <p className="text-xs text-muted-foreground">current shift attendance</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Mark Attendance - Team {wsoTeamKey} ({teamDutyToday})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : allEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No employees found for this shift
              </p>
            ) : (
              <div className="space-y-4">
                {allEmployees.map(renderEmployeeRow)}
              </div>
            )}

            <div className="flex justify-end mt-6">
              <Button size="lg" onClick={handleSave} disabled={isBulkUpserting || allEmployees.length === 0}>
                {isBulkUpserting ? "Saving..." : "Save Attendance"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
