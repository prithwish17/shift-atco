import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CalendarIcon, Download, CheckCircle, XCircle } from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile, useUsers } from "@/hooks/useUsers";
import { useAttendance } from "@/hooks/useAttendance";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import { useToast } from "@/hooks/use-toast";
import {
  getTeamDutyForDateKey,
  getTeamDutyLabel,
  isEligibleDutyForAttendance,
  isHolidayOrOffDuty,
  normalizeTeamKey,
} from "@/lib/teamDutyRotation";

interface EmployeeAttendance {
  userId: string;
  name: string;
  empId: string;
  status: "present" | "absent";
  dutyCode: string;
  timeIn: string;
  timeOut: string;
}

export default function WSOAttendance() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [attendanceState, setAttendanceState] = useState<Record<string, EmployeeAttendance>>({});
  const [futureDateDialogOpen, setFutureDateDialogOpen] = useState(false);

  const { user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const { users, isLoading: usersLoading } = useUsers();
  const { toast } = useToast();
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const { attendance, isLoading: attendanceLoading, bulkUpsertAttendance, isBulkUpserting } = useAttendance(dateStr);

  // Team-aware duty cycle + schedule-driven attendance source.
  const wsoShift = profile?.current_shift || "general";
  const wsoTeamKey = normalizeTeamKey(wsoShift);
  const teamDutyToday = getTeamDutyForDateKey(wsoTeamKey, dateStr);
  const teamDutyLabel = getTeamDutyLabel(teamDutyToday);

  const teamUsers = useMemo(
    () =>
      (users || []).filter(
        (u) =>
          !u.is_hidden &&
          Boolean(u.employee_id) &&
          (u.role === "employee" || !u.role) &&
          normalizeTeamKey(u.current_shift) === wsoTeamKey
      ),
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
    const dayOffsetFromToday = differenceInCalendarDays(selectedDate, new Date());
    if (dayOffsetFromToday > 0) {
      setFutureDateDialogOpen(true);
      return;
    }

    if (dayOffsetFromToday < -1) {
      toast({
        title: "Attendance window closed",
        description: "Attendance can only be saved for today or yesterday.",
        variant: "destructive",
      });
      return;
    }

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
              Mark attendance for Team {wsoTeamKey} ({teamDutyLabel} duty)
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Mark Attendance - Team {wsoTeamKey} ({teamDutyLabel})</CardTitle>
              <Button onClick={handleSave} disabled={isBulkUpserting || allEmployees.length === 0}>
                {isBulkUpserting ? "Saving..." : "Save Attendance"}
              </Button>
            </div>
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
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={futureDateDialogOpen} onOpenChange={setFutureDateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wait For The Attendance Day</AlertDialogTitle>
            <AlertDialogDescription>
              Attendance can only be saved for today or yesterday. The selected date is in the future, so please wait until that duty day arrives before marking attendance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Understood</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
