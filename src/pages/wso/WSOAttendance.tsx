import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, Download, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile, useUsers } from "@/hooks/useUsers";
import { useAttendance } from "@/hooks/useAttendance";

interface EmployeeAttendance {
  userId: string;
  name: string;
  empId: string;
  status: "present" | "absent";
  timeIn: string;
  timeOut: string;
}

export default function WSOAttendance() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  const [attendanceState, setAttendanceState] = useState<Record<string, EmployeeAttendance>>({});

  const { user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const { users, isLoading: usersLoading } = useUsers();
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const { attendance, isLoading: attendanceLoading, bulkMarkAttendance, isBulkMarking } = useAttendance(dateStr);

  // Get employees matching the WSO's shift
  const wsoShift = profile?.current_shift || "general";
  const shiftEmployees = users?.filter(u => u.approved && u.current_shift === wsoShift) || [];

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
        timeIn: existing?.time_in ? format(new Date(existing.time_in), "HH:mm") : "",
        timeOut: existing?.time_out ? format(new Date(existing.time_out), "HH:mm") : "",
      };
    });
    setAttendanceState(state);
  }, [shiftEmployees.length, attendance]);

  const toggleStatus = (empId: string) => {
    setAttendanceState(prev => ({
      ...prev,
      [empId]: {
        ...prev[empId],
        status: prev[empId]?.status === "present" ? "absent" : "present",
      },
    }));
  };

  const allEmployees = Object.values(attendanceState);
  const stats = {
    present: allEmployees.filter(e => e.status === "present").length,
    absent: allEmployees.filter(e => e.status === "absent").length,
    total: allEmployees.length,
  };

  const handleSave = () => {
    const existingIds = new Set(attendance?.map(a => a.user_id) || []);
    const records = allEmployees
      .filter(r => !existingIds.has(r.userId))
      .map(r => ({
        user_id: r.userId,
        attendance_date: dateStr,
        status: r.status as any,
        marked_by: "",
        time_in: r.timeIn ? new Date(`${dateStr}T${r.timeIn}`).toISOString() : null,
        time_out: r.timeOut ? new Date(`${dateStr}T${r.timeOut}`).toISOString() : null,
      }));

    if (records.length > 0) {
      bulkMarkAttendance(records);
    }
  };

  const isLoading = usersLoading || attendanceLoading;

  const renderEmployeeRow = (emp: EmployeeAttendance) => (
    <div key={emp.userId} className="flex items-center justify-between p-3 border rounded-lg bg-accent/30">
      <div className="flex items-center gap-4">
        <div>
          <p className="font-medium">{emp.name}</p>
          <p className="text-xs text-muted-foreground">{emp.empId}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
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
            <p className="text-muted-foreground">Mark attendance for {wsoShift.toUpperCase()} shift</p>
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
              <p className="text-xs text-muted-foreground">employees absent today</p>
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
            <CardTitle>Mark Attendance - {wsoShift.toUpperCase()} Shift</CardTitle>
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
              <Button size="lg" onClick={handleSave} disabled={isBulkMarking || allEmployees.length === 0}>
                {isBulkMarking ? "Saving..." : "Save Attendance"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
