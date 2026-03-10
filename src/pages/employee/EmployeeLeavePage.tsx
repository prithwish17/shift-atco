import { useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useLeaveData } from "@/hooks/useLeaveData";

function formatDate(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function extractDates(items: unknown[], fields: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const formatted = formatDate(item);
      if (formatted) out.push(formatted);
      continue;
    }
    if (item && typeof item === "object") {
      for (const field of fields) {
        const formatted = formatDate((item as any)[field]);
        if (formatted) out.push(formatted);
      }
    }
  }
  return Array.from(new Set(out));
}

export default function EmployeeLeavePage() {
  const { user } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
  const { data, isUrlLoading, url, urlError, leaveQuery } = useLeaveData();

  const employeeRecord = useMemo(() => {
    const empId = profile?.employee_id ? String(profile.employee_id) : "";
    if (!empId) return null;
    return data.find((record) => record.empId === empId) || null;
  }, [data, profile?.employee_id]);

  const isLoading = profileLoading || isUrlLoading || leaveQuery.isLoading;

  const cards = useMemo(() => {
    if (!employeeRecord) {
      return [
        { label: "Casual Leave", used: 0, total: 12, color: "#4FD1C5" },
        { label: "Earned Leave", used: 0, total: 0, color: "#63B3ED" },
        { label: "Compensatory Off", used: 0, total: 0, color: "#F87171" },
        { label: "Reserved Holiday", used: 0, total: 2, color: "#F6AD55" },
      ];
    }
    return [
      { label: "Casual Leave", used: employeeRecord.casualCount, total: 12, color: "#4FD1C5" },
      { label: "Earned Leave", used: 0, total: 0, color: "#63B3ED" },
      { label: "Compensatory Off", used: employeeRecord.compOffUsed, total: employeeRecord.compOffEarned, color: "#F87171" },
      { label: "Reserved Holiday", used: employeeRecord.restrictedCount, total: 2, color: "#F6AD55" },
    ];
  }, [employeeRecord]);

  const leaveSummary = useMemo(() => {
    if (!employeeRecord) return [];
    const casualDates = extractDates(employeeRecord.casualLeave, []);
    const reservedDates = extractDates(employeeRecord.restrictedHolidays, ["date", "leaveApplied"]);
    const compOffDates = extractDates(employeeRecord.lastYearCompOff, ["leaveApplied"]);

    return [
      { type: "Casual Leave", dates: casualDates },
      { type: "Earned Leave", dates: [] },
      { type: "Compensatory Off", dates: compOffDates },
      { type: "Reserved Holiday", dates: reservedDates },
    ];
  }, [employeeRecord]);

  return (
    <DashboardLayout role="employee">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight">Leave Management System</h1>
            <div className="flex items-center gap-6 text-sm text-muted-foreground mt-1">
              <span className="text-blue-600 font-semibold">Dashboard</span>
              <span>Leave Management</span>
              <span>Policy Management</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-[320px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search everything" className="pl-9 bg-slate-50" />
            </div>
            <Button className="bg-blue-600 hover:bg-blue-700">Apply Leave</Button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Leave Availability</h2>
        </div>

        {urlError && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-4 pb-4 text-sm text-amber-800">
              Unable to load leave API URL. Please contact an admin.
            </CardContent>
          </Card>
        )}

        {!url && !isUrlLoading && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-4 pb-4 text-sm text-amber-800">
              Leave API URL is not configured yet.
            </CardContent>
          </Card>
        )}

        {leaveQuery.error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-4 pb-4 text-sm text-red-800">
              {(leaveQuery.error as Error).message || "Failed to load leave data"}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          </div>
        ) : !profile?.employee_id ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-4 pb-4 text-sm text-amber-800">
              Your profile is missing an Employee ID. Please update your profile.
            </CardContent>
          </Card>
        ) : !employeeRecord ? (
          <Card>
            <CardContent className="pt-6 pb-6 text-sm text-muted-foreground">
              No leave data found for Employee ID {profile.employee_id}.
            </CardContent>
          </Card>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {cards.map((card) => {
            const percent = card.total > 0 ? Math.round((card.used / card.total) * 100) : 0;
            return (
              <Card key={card.label} className="shadow-sm">
                <CardContent className="pt-4 pb-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Remaining</div>
                    <div className="text-lg font-semibold">{card.label}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {Math.max(card.total - card.used, 0)} of {card.total} left
                    </div>
                  </div>
                  <div
                    className="h-16 w-16 rounded-full flex items-center justify-center"
                    style={{
                      background: `conic-gradient(${card.color} ${percent}%, #E5E7EB 0)`,
                    }}
                  >
                    <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center">
                      <div className="text-sm font-bold text-slate-700">{percent}%</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Leave Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Leave Type</TableHead>
                    <TableHead>Dates Taken</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaveSummary.map((row) => (
                    <TableRow key={row.type}>
                      <TableCell className="font-medium">{row.type}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {row.dates.length > 0 ? (
                            row.dates.map((d) => (
                              <Badge key={d} variant="secondary" className="bg-slate-100 text-slate-700">
                                {d}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">No records</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                          Taken
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Comp-Off Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
                <div>C-Off for Duty on CH</div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Balance
                </div>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <div className="grid grid-cols-4 bg-emerald-50 text-emerald-900 text-xs font-semibold uppercase tracking-wide">
                  <div className="px-3 py-2 border-r">Closed Holiday Date</div>
                  <div className="px-3 py-2 border-r">Attendance on CH</div>
                  <div className="px-3 py-2 border-r">C-Off Date</div>
                  <div className="px-3 py-2">C-Off Valid Till</div>
                </div>
                <div className="divide-y">
                  {employeeRecord?.lastYearCompOff?.length ? (
                    employeeRecord.lastYearCompOff.map((row: any, idx: number) => (
                      <div key={idx} className="grid grid-cols-4 text-sm">
                        <div className="px-3 py-2 text-slate-700">{row?.closedHolidayDate || "—"}</div>
                        <div className="px-3 py-2 text-slate-700">{row?.dutyPerformed || "—"}</div>
                        <div className="px-3 py-2 text-slate-700">{row?.leaveApplied || "—"}</div>
                        <div className="px-3 py-2 text-slate-700">{row?.validTill || "—"}</div>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-6 text-sm text-muted-foreground text-center">
                      No comp-off balance records available.
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Leave Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon"><ChevronLeft className="h-4 w-4" /></Button>
                <div className="font-semibold">July 2023</div>
                <Button variant="outline" size="icon"><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Sick Leave</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-teal-400" /> Casual Leave</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" /> Earned Leave</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-400" /> Bereavement</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pink-400" /> Upcoming Holidays</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400" /> Policy Specific</span>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-px border border-slate-200 mt-4 text-sm">
              {["SUN","MON","TUE","WED","THU","FRI","SAT"].map((d) => (
                <div key={d} className="bg-slate-50 text-center py-2 font-semibold">{d}</div>
              ))}
              {Array.from({ length: 35 }).map((_, idx) => (
                <div key={idx} className="h-20 bg-white border border-slate-100 p-2 text-xs text-muted-foreground">
                  <div className="font-medium text-slate-600">{idx + 1 <= 31 ? idx + 1 : ""}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
