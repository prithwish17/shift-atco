import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, RefreshCw, CalendarDays } from "lucide-react";
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

// Extract ISO date strings (YYYY-MM-DD) from items for calendar matching
function extractIsoDates(items: unknown[], fields: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      try {
        const d = new Date(item);
        if (!isNaN(d.getTime())) out.push(d.toISOString().split("T")[0]);
      } catch { /* skip */ }
      continue;
    }
    if (item && typeof item === "object") {
      for (const field of fields) {
        const val = (item as any)[field];
        if (typeof val === "string") {
          try {
            const d = new Date(val);
            if (!isNaN(d.getTime())) out.push(d.toISOString().split("T")[0]);
          } catch { /* skip */ }
        }
      }
    }
  }
  return out;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 3 }, (_, i) => CURRENT_YEAR - i);

export default function EmployeeLeavePage() {
  const { user } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const { data, leaveQuery, refresh } = useLeaveData(selectedYear);

  const [calendarDate, setCalendarDate] = useState(() => new Date());

  const employeeRecord = useMemo(() => {
    const empId = profile?.employee_id ? String(profile.employee_id) : "";
    console.log("[EmployeeLeavePage] profile.employee_id:", profile?.employee_id, "→ empId:", empId);
    console.log("[EmployeeLeavePage] data has", data.length, "records. Their empIds:", data.map(r => r.empId));
    if (!empId) return null;
    const found = data.find((record) => record.empId === empId) || null;
    console.log("[EmployeeLeavePage] match found:", !!found);
    return found;
  }, [data, profile?.employee_id]);

  const isLoading = profileLoading || leaveQuery.isLoading;

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

  // Calendar data: map of ISO date -> color
  const calendarLeaves = useMemo(() => {
    if (!employeeRecord) return new Map<string, string>();
    const map = new Map<string, string>();

    const clDates = extractIsoDates(employeeRecord.casualLeave, []);
    clDates.forEach((d) => map.set(d, "#4FD1C5")); // teal

    const rhDates = extractIsoDates(employeeRecord.restrictedHolidays, ["date"]);
    rhDates.forEach((d) => map.set(d, "#F6AD55")); // amber

    const nhDates = extractIsoDates(employeeRecord.nationalHolidays, []);
    nhDates.forEach((d) => map.set(d, "#63B3ED")); // blue

    const chDates = extractIsoDates(employeeRecord.closedHolidays, ["leaveApplied"]);
    chDates.forEach((d) => map.set(d, "#A78BFA")); // violet

    const coDates = extractIsoDates(employeeRecord.lastYearCompOff, ["leaveApplied"]);
    coDates.forEach((d) => map.set(d, "#F87171")); // red

    const opeDates = extractIsoDates(employeeRecord.opeDuty, ["opeDutyDate"]);
    opeDates.forEach((d) => map.set(d, "#FB923C")); // orange

    return map;
  }, [employeeRecord]);

  // Calendar grid calculation
  const calendarGrid = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: { day: number | null; iso: string | null }[] = [];

    // Leading empty cells
    for (let i = 0; i < firstDay; i++) {
      cells.push({ day: null, iso: null });
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ day: d, iso });
    }

    return cells;
  }, [calendarDate]);

  const monthLabel = calendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const prevMonth = () => {
    setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };
  const nextMonth = () => {
    setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  return (
    <DashboardLayout role="employee">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight">Leave Management System</h1>
            <p className="text-sm text-muted-foreground mt-1">
              View your leave balances and usage from the official register
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-[120px] h-9">
                <CalendarDays className="h-4 w-4 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refresh.isPending ? "animate-spin" : ""}`} />
              {refresh.isPending ? "Syncing…" : "Sync Data"}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Leave Availability</h2>
        </div>

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
              No leave data found for Employee ID {profile.employee_id}. Ask an admin to sync leave data.
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
                    <TableHead>Count</TableHead>
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
                          {row.dates.length}
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
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Earned: {employeeRecord?.compOffEarned ?? 0}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Used: {employeeRecord?.compOffUsed ?? 0}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> Remaining: {employeeRecord?.compOffRemaining ?? 0}</span>
                </div>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <div className="grid grid-cols-3 bg-emerald-50 text-emerald-900 text-xs font-semibold uppercase tracking-wide">
                  <div className="px-3 py-2 border-r">Duty Performed</div>
                  <div className="px-3 py-2 border-r">C-Off Date</div>
                  <div className="px-3 py-2">Status</div>
                </div>
                <div className="divide-y">
                  {employeeRecord?.lastYearCompOff?.length ? (
                    employeeRecord.lastYearCompOff.map((row: any, idx: number) => (
                      <div key={idx} className="grid grid-cols-3 text-sm">
                        <div className="px-3 py-2 text-slate-700">{row?.dutyPerformed || "—"}</div>
                        <div className="px-3 py-2 text-slate-700">{formatDate(row?.leaveApplied) || "—"}</div>
                        <div className="px-3 py-2">
                          <Badge variant="secondary" className={`text-[10px] ${row?.leaveApplied ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                            {row?.leaveApplied ? "Used" : "Available"}
                          </Badge>
                        </div>
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
                <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
                <div className="font-semibold min-w-[160px] text-center">{monthLabel}</div>
                <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#4FD1C5" }} /> CL</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#F6AD55" }} /> RH</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#63B3ED" }} /> NH</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#A78BFA" }} /> CH</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#F87171" }} /> Comp Off</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#FB923C" }} /> OPE</span>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-px border border-slate-200 mt-4 text-sm">
              {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                <div key={d} className="bg-slate-50 text-center py-2 font-semibold text-xs">{d}</div>
              ))}
              {calendarGrid.map((cell, idx) => {
                const leaveColor = cell.iso ? calendarLeaves.get(cell.iso) : undefined;
                const todayIso = new Date().toISOString().split("T")[0];
                const isToday = cell.iso === todayIso;

                return (
                  <div
                    key={idx}
                    className={`h-16 bg-white border border-slate-100 p-1.5 text-xs ${!cell.day ? "bg-slate-50/50" : ""}`}
                  >
                    {cell.day && (
                      <>
                        <div className={`font-medium ${isToday ? "text-blue-600 font-bold" : "text-slate-600"}`}>
                          {cell.day}
                        </div>
                        {leaveColor && (
                          <div
                            className="mt-0.5 h-2 w-full rounded-full"
                            style={{ background: leaveColor }}
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
