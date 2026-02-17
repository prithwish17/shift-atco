import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, Download, CheckCircle, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useUsers } from "@/hooks/useUsers";
import { useAttendance } from "@/hooks/useAttendance";

interface AttendanceRow {
  userId: string;
  name: string;
  empId: string;
  status: "present" | "absent" | "off";
  timeIn: string;
  timeOut: string;
  comments: string;
  existingId?: string;
}

export default function SupervisorAttendance() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedShift, setSelectedShift] = useState("general");
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const { users, isLoading: usersLoading } = useUsers();
  const { attendance, isLoading: attendanceLoading, bulkMarkAttendance, isBulkMarking } = useAttendance(dateStr);

  // Filter employees by selected shift
  const shiftEmployees = users?.filter(u => u.approved && u.current_shift === selectedShift) || [];

  // Build attendance rows from real data
  useEffect(() => {
    const rows: AttendanceRow[] = shiftEmployees.map(emp => {
      const existing = attendance?.find(a => a.user_id === emp.id);
      return {
        userId: emp.id,
        name: emp.full_name,
        empId: emp.employee_id,
        status: existing ? (existing.status as "present" | "absent") : "present",
        timeIn: existing?.time_in ? format(new Date(existing.time_in), "HH:mm") : "",
        timeOut: existing?.time_out ? format(new Date(existing.time_out), "HH:mm") : "",
        comments: existing?.comments || "",
        existingId: existing?.id,
      };
    });
    setAttendanceRows(rows);
  }, [shiftEmployees.length, attendance]);

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
    const records = attendanceRows
      .filter(r => !r.existingId) // Only insert new records
      .map(r => ({
        user_id: r.userId,
        attendance_date: dateStr,
        status: r.status as any,
        marked_by: "",
        time_in: r.timeIn ? new Date(`${dateStr}T${r.timeIn}`).toISOString() : null,
        time_out: r.timeOut ? new Date(`${dateStr}T${r.timeOut}`).toISOString() : null,
        comments: r.comments || null,
      }));

    if (records.length > 0) {
      bulkMarkAttendance(records);
    }
  };

  const presentCount = attendanceRows.filter(a => a.status === "present").length;
  const absentCount = attendanceRows.filter(a => a.status === "absent").length;
  const isLoading = usersLoading || attendanceLoading;

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
              <div className="text-2xl font-bold">{shiftEmployees.length}</div>
              <p className="text-xs text-muted-foreground">employees in shift</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <CardTitle>Mark Attendance</CardTitle>
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
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={selectedShift} onValueChange={setSelectedShift} className="space-y-4">
              <TabsList className="grid w-full grid-cols-6">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="a">Shift A</TabsTrigger>
                <TabsTrigger value="b">Shift B</TabsTrigger>
                <TabsTrigger value="c">Shift C</TabsTrigger>
                <TabsTrigger value="d">Shift D</TabsTrigger>
                <TabsTrigger value="e">Shift E</TabsTrigger>
              </TabsList>

              <TabsContent value={selectedShift} className="space-y-4">
                <div className="flex justify-between items-center">
                  <p className="text-sm text-muted-foreground">{shiftEmployees.length} employees</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleMarkAll("present")}>Mark All Present</Button>
                    <Button variant="outline" size="sm" onClick={() => handleMarkAll("absent")}>Mark All Absent</Button>
                  </div>
                </div>

                {isLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : shiftEmployees.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No employees assigned to this shift
                  </p>
                ) : (
                  <div className="border rounded-lg">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-3 font-medium">Employee</th>
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
                  <Button onClick={handleSave} size="lg" disabled={isBulkMarking || shiftEmployees.length === 0}>
                    {isBulkMarking ? "Saving..." : "Save Attendance"}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
