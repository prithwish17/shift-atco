import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, CalendarDays, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useElDetails } from "@/hooks/useElData";
import { useLeaveData } from "@/hooks/useLeaveData";
import { isFinalLeaveApproved, useMyLeaveRequests } from "@/hooks/useLeaveRequests";
import { COMP_OFF_EXPIRY_WARNING_DAYS, DEFAULT_CL_BALANCE, DEFAULT_RH_BALANCE, YEAR_LOOKBACK } from "@/lib/leaveConstants";
import { useMySchedule } from "@/hooks/useEmployeeSchedules";
import type { CompOffHistoryEntry } from "@/utils/leaveCalculations";
import { LeaveYearStrip, type LeaveYearRow } from "@/components/leave/LeaveYearStrip";
import { CompOffLedgerCard } from "@/components/leave/CompOffLedgerCard";
import {
  CompOffExpiryRail,
  LeaveBalanceTiles,
  type LeaveBalanceTile,
} from "@/components/leave/LeaveBalanceTiles";
import {
  bucketIsoDaysByMonth,
  expandIsoRange,
  extractIsoLeaveDays,
  formatLeaveDayLabels,
  formatLeaveRangeLabel,
  getExpiringCompOffs,
} from "@/utils/leaveYearSummary";
import { eachDayOfInterval, endOfMonth, format, isAfter, isBefore, parseISO, startOfMonth } from "date-fns";

function getInclusiveOverlapDayCount(startValue: string, endValue: string, rangeStart: string, rangeEnd: string): number {
  const start = new Date(`${startValue}T00:00:00Z`);
  const end = new Date(`${endValue}T00:00:00Z`);
  const boundedStart = new Date(`${rangeStart}T00:00:00Z`);
  const boundedEnd = new Date(`${rangeEnd}T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    Number.isNaN(boundedStart.getTime()) ||
    Number.isNaN(boundedEnd.getTime())
  ) {
    return 0;
  }

  const overlapStart = start > boundedStart ? start : boundedStart;
  const overlapEnd = end < boundedEnd ? end : boundedEnd;

  if (overlapEnd < overlapStart) {
    return 0;
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / millisecondsPerDay) + 1;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: YEAR_LOOKBACK }, (_, i) => CURRENT_YEAR - i);

type CalendarLeaveStyle = {
  label: string;
  legend: string;
  cellClass: string;
  badgeClass: string;
};

const CALENDAR_LEAVE_STYLES: Record<string, CalendarLeaveStyle> = {
  REQ: {
    label: "REQ",
    legend: "Applied",
    cellClass: "bg-amber-50 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-100 dark:ring-amber-900/50",
    badgeClass: "bg-amber-200 text-amber-900 dark:bg-amber-900/70 dark:text-amber-100",
  },
  APR: {
    label: "LEAVE",
    legend: "Approved",
    cellClass: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-100 dark:ring-emerald-900/50",
    badgeClass: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-100",
  },
};

export default function EmployeeLeavePage() {
  const { user } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [compOffView, setCompOffView] = useState<"available" | "all">("available");
  const employeeEmpId = profile?.employee_id ? String(profile.employee_id) : null;
  const { data, leaveQuery } = useLeaveData(selectedYear, employeeEmpId);
  const { data: elDetails = [], isLoading: elLoading, error: elError } = useElDetails(employeeEmpId || undefined);
  const { data: myLeaveRequests = [], isLoading: leaveRequestsLoading } = useMyLeaveRequests(user?.id);

  const compOffLedgerRef = useRef<HTMLDivElement>(null);

  /** The expiry warning names comp-offs; send the reader to the ledger listing them. */
  const showExpiringCompOffs = () => {
    setCompOffView("available");
    compOffLedgerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const calendarMonthStart = format(startOfMonth(calendarDate), "yyyy-MM-dd");
  const calendarMonthEnd = format(endOfMonth(calendarDate), "yyyy-MM-dd");
  const { data: monthlySchedule = [], isLoading: monthlyScheduleLoading } = useMySchedule(
    employeeEmpId || undefined,
    calendarMonthStart,
    calendarMonthEnd
  );

  const employeeRecord = useMemo(() => {
    const empId = employeeEmpId || "";
    if (!empId) return null;
    return data.find((record) => record.empId === empId) || null;
  }, [data, employeeEmpId]);

  /**
   * EL rows touching the selected year.  The day count comes from expanding
   * these into the month buckets below rather than being summed here, so the
   * headline figure and the months under it are one calculation.
   */
  const earnedLeaveDetails = useMemo(() => {
    const yearStart = `${selectedYear}-01-01`;
    const yearEnd = `${selectedYear}-12-31`;

    return elDetails.filter((row) =>
      getInclusiveOverlapDayCount(row.leave_from, row.leave_to, yearStart, yearEnd) > 0,
    );
  }, [elDetails, selectedYear]);

  const isLoading = profileLoading || leaveQuery.isLoading || elLoading || leaveRequestsLoading || monthlyScheduleLoading;

  const compOffLedgerRows = useMemo(() => {
    if (!employeeRecord) return [] as CompOffHistoryEntry[];
    return [...employeeRecord.compOffEntries]
      .filter((row) => !row.hideDates)
      .sort((a, b) => {
        const left = a.dutyDate || a.leaveApplied || "";
        const right = b.dutyDate || b.leaveApplied || "";

        if (left !== right) {
          return right.localeCompare(left);
        }

        return (b.leaveApplied || "").localeCompare(a.leaveApplied || "");
      });
  }, [employeeRecord]);

  const visibleCompOffLedgerRows = useMemo(() => {
    if (compOffView === "all") return compOffLedgerRows;
    return compOffLedgerRows.filter((row) => row.status === "available");
  }, [compOffLedgerRows, compOffView]);

  // Calculate comp-off stats from the visible ledger entries (excludes hideDates rows)
  const compOffStats = useMemo(() => {
    const visible = compOffLedgerRows;
    const remaining = visible.filter((e) => e.status === "available").length;
    const used = visible.filter((e) => e.status === "used").length;
    const expired = visible.filter((e) => e.status === "expired").length;
    const earned = remaining + used + expired;
    return { earned, used, expired, remaining };
  }, [compOffLedgerRows]);

  /**
   * The selected year's leave days per type, bucketed into months.
   *
   * Every figure the strip shows is counted from these same buckets, so a
   * balance can never disagree with the months drawn under it.  The counts used
   * to walk the raw arrays on their own path and would drift from the dates on
   * any duplicate row in the register.
   */
  const monthlyLeaveDays = useMemo(() => {
    const emptyYear = () => Array.from({ length: 12 }, () => [] as string[]);

    if (!employeeRecord) {
      return { casual: emptyYear(), restricted: emptyYear(), compOff: emptyYear(), earned: emptyYear() };
    }

    return {
      casual: bucketIsoDaysByMonth(
        extractIsoLeaveDays(employeeRecord.casualLeave, ["date", "leaveApplied"]),
        selectedYear,
      ),
      restricted: bucketIsoDaysByMonth(
        extractIsoLeaveDays(employeeRecord.restrictedHolidays, ["date", "leaveApplied"]),
        selectedYear,
      ),
      compOff: bucketIsoDaysByMonth(
        extractIsoLeaveDays(employeeRecord.compOffUsedEntries, ["leaveApplied"]),
        selectedYear,
      ),
      earned: bucketIsoDaysByMonth(
        earnedLeaveDetails.flatMap((row) => expandIsoRange(row.leave_from, row.leave_to)),
        selectedYear,
      ),
    };
  }, [earnedLeaveDetails, employeeRecord, selectedYear]);

  /**
   * The four balances, as the tiles across the top of the page.
   *
   * Every type is listed unconditionally.  The cards these replaced hid any type
   * whose balance had run out, so the moment you exhausted your Casual Leave its
   * card vanished — the state you most need to see was the one that disappeared.
   */
  const leaveBalanceTiles = useMemo<LeaveBalanceTile[]>(() => {
    if (!employeeRecord) return [];

    const countDays = (months: string[][]) => months.reduce((sum, days) => sum + days.length, 0);

    const casualUsed = countDays(monthlyLeaveDays.casual);
    const casualLeft = Math.max(DEFAULT_CL_BALANCE - casualUsed, 0);
    const restrictedUsed = countDays(monthlyLeaveDays.restricted);
    const restrictedLeft = Math.max(DEFAULT_RH_BALANCE - restrictedUsed, 0);
    const earnedUsed = countDays(monthlyLeaveDays.earned);

    return [
      {
        key: "casual",
        label: "Casual Leave",
        tone: "casual",
        value: String(casualLeft),
        valueLabel: `of ${DEFAULT_CL_BALANCE} left`,
        segments: [
          { kind: "left", value: casualLeft },
          { kind: "used", value: casualUsed },
        ],
      },
      {
        key: "comp-off",
        label: "Compensatory Off",
        tone: "compOff",
        value: String(compOffStats.remaining),
        valueLabel: `available of ${compOffStats.earned}`,
        segments: [
          { kind: "left", value: compOffStats.remaining },
          { kind: "used", value: compOffStats.used },
          { kind: "expired", value: compOffStats.expired },
        ],
      },
      {
        key: "restricted",
        label: "Restricted Holiday",
        tone: "restricted",
        value: String(restrictedLeft),
        valueLabel: `of ${DEFAULT_RH_BALANCE} left`,
        segments: [
          { kind: "left", value: restrictedLeft },
          { kind: "used", value: restrictedUsed },
        ],
      },
      {
        // No bar: EL balance is not synced, only the days availed are known.  The
        // card this replaced drew a full ring anyway, which encoded nothing.
        key: "earned",
        label: "Earned Leave",
        tone: "earned",
        value: earnedUsed > 0 ? String(earnedUsed) : "—",
        valueLabel: earnedUsed > 0 ? "days availed" : "none this year",
      },
    ];
  }, [compOffStats, employeeRecord, monthlyLeaveDays]);

  /** The same four types further down, as months and the dates behind them. */
  const leaveYearRows = useMemo<LeaveYearRow[]>(() => {
    if (!employeeRecord) return [];

    return [
      {
        key: "casual",
        label: "Casual Leave",
        tone: "casual",
        monthDays: monthlyLeaveDays.casual,
        dateLabels: formatLeaveDayLabels(monthlyLeaveDays.casual),
      },
      {
        key: "comp-off",
        label: "Compensatory Off",
        tone: "compOff",
        monthDays: monthlyLeaveDays.compOff,
        dateLabels: formatLeaveDayLabels(monthlyLeaveDays.compOff),
      },
      {
        key: "restricted",
        label: "Restricted Holiday",
        tone: "restricted",
        monthDays: monthlyLeaveDays.restricted,
        dateLabels: formatLeaveDayLabels(monthlyLeaveDays.restricted),
      },
      {
        key: "earned",
        label: "Earned Leave",
        tone: "earned",
        monthDays: monthlyLeaveDays.earned,
        // EL is stored as ranges; a fortnight listed day by day would bury the row.
        dateLabels: earnedLeaveDetails
          .map((row) => formatLeaveRangeLabel(row.leave_from, row.leave_to))
          .filter((label): label is string => Boolean(label)),
      },
    ];
  }, [earnedLeaveDetails, employeeRecord, monthlyLeaveDays]);

  /**
   * Comp-offs about to lapse.  Each entry already carries its 89-day expiry and
   * the days left on it, but nothing on the page ever said so — you had to read
   * the ledger table to find out you were about to lose a day off.
   */
  const compOffExpiry = useMemo(() => {
    const expiring = getExpiringCompOffs(compOffLedgerRows, COMP_OFF_EXPIRY_WARNING_DAYS);
    if (expiring.length === 0) return null;

    return {
      count: expiring.length,
      earliestDate: expiring[0].expiryDate,
      withinDays: COMP_OFF_EXPIRY_WARNING_DAYS,
    };
  }, [compOffLedgerRows]);

  // Calendar data: map of ISO date -> leave style
  const calendarLeaves = useMemo(() => {
    const map = new Map<string, CalendarLeaveStyle>();

    const monthStartDate = parseISO(calendarMonthStart);
    const monthEndDate = parseISO(calendarMonthEnd);

    myLeaveRequests
      .filter((request) => request.status === "Pending WSO" || request.status === "Pending Supervisor")
      .forEach((request) => {
        const requestStart = parseISO(request.start_date);
        const requestEnd = parseISO(request.end_date);
        if (isAfter(requestStart, monthEndDate) || isBefore(requestEnd, monthStartDate)) return;

        const boundedStart = isBefore(requestStart, monthStartDate) ? monthStartDate : requestStart;
        const boundedEnd = isAfter(requestEnd, monthEndDate) ? monthEndDate : requestEnd;

        eachDayOfInterval({ start: boundedStart, end: boundedEnd }).forEach((day) => {
          map.set(format(day, "yyyy-MM-dd"), CALENDAR_LEAVE_STYLES.REQ);
        });
      });

    let approvedCount = 0;
    monthlySchedule.forEach((entry) => {
      if (entry.duty_code === "LEAVE") {
        map.set(entry.duty_date, CALENDAR_LEAVE_STYLES.APR);
        approvedCount++;
      }
    });

    if (approvedCount === 0) {
      myLeaveRequests
        .filter((request) => isFinalLeaveApproved(request))
        .forEach((request) => {
          const requestStart = parseISO(request.start_date);
          const requestEnd = parseISO(request.end_date);
          if (isAfter(requestStart, monthEndDate) || isBefore(requestEnd, monthStartDate)) return;

          const boundedStart = isBefore(requestStart, monthStartDate) ? monthStartDate : requestStart;
          const boundedEnd = isAfter(requestEnd, monthEndDate) ? monthEndDate : requestEnd;

          eachDayOfInterval({ start: boundedStart, end: boundedEnd }).forEach((day) => {
            map.set(format(day, "yyyy-MM-dd"), CALENDAR_LEAVE_STYLES.APR);
          });
        });
    }

    return map;
  }, [calendarMonthEnd, calendarMonthStart, monthlySchedule, myLeaveRequests]);

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
        <div>
          <div>
            <h1 className="whitespace-nowrap text-xl font-black tracking-tight sm:text-2xl">Leave Summary</h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              View your leave balances and usage from the official register
            </p>
          </div>
          <div className="mt-3 flex items-center gap-3">
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="h-9 w-[120px]">
                  <CalendarDays className="mr-1.5 h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            <Button asChild size="sm">
              <Link to="/employee/leave">Apply Leave</Link>
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold sm:text-lg">Leave Availability</h2>
        </div>

        {(leaveQuery.error || elError) && (
          <Card className="border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30">
            <CardContent className="pt-4 pb-4 text-sm text-red-800 dark:text-red-200">
              {((leaveQuery.error || elError) as Error).message || "Failed to load leave data"}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          </div>
        ) : !profile?.employee_id ? (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30">
            <CardContent className="pt-4 pb-4 text-sm text-amber-800 dark:text-amber-200">
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

        {leaveBalanceTiles.length > 0 && <LeaveBalanceTiles tiles={leaveBalanceTiles} />}

        {compOffExpiry && (
          <CompOffExpiryRail expiry={compOffExpiry} onView={showExpiringCompOffs} />
        )}

        <div ref={compOffLedgerRef} className="scroll-mt-4">
          <CompOffLedgerCard
            rows={visibleCompOffLedgerRows}
            stats={compOffStats}
            view={compOffView}
            onViewChange={setCompOffView}
          />
        </div>

        {leaveYearRows.length > 0 && <LeaveYearStrip rows={leaveYearRows} />}

        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">Leave Calendar</CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 md:text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50">
                  <span className="inline-flex rounded-sm bg-amber-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-900/70 dark:text-amber-100">REQ</span>
                  Applied
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50">
                  <span className="inline-flex rounded-sm bg-emerald-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-100">APR</span>
                  Approved
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="font-semibold min-w-[160px] text-center">{monthLabel}</div>
              <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-7 gap-px border border-slate-200 dark:border-slate-800 mt-4 text-sm">
              {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                <div key={d} className="bg-slate-50 dark:bg-slate-900 text-center py-2 font-semibold text-xs text-slate-700 dark:text-slate-300">{d}</div>
              ))}
              {calendarGrid.map((cell, idx) => {
                const leaveStyle = cell.iso ? calendarLeaves.get(cell.iso) : undefined;
                const todayIso = new Date().toISOString().split("T")[0];
                const isToday = cell.iso === todayIso;

                return (
                  <div
                    key={idx}
                    className={`h-20 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-900 p-1.5 text-xs ${!cell.day ? "bg-slate-50/50 dark:bg-slate-900/70" : ""}`}
                  >
                    {cell.day && (
                      <div className="flex h-full flex-col">
                        <div className={`font-medium ${isToday ? "text-blue-600 dark:text-blue-400 font-bold" : "text-slate-600 dark:text-slate-300"}`}>
                          {cell.day}
                        </div>
                        {leaveStyle && (
                          <div
                            className={`mt-1 flex flex-1 items-end rounded-md px-1.5 py-1 ${leaveStyle.cellClass}`}
                          >
                            <span className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${leaveStyle.badgeClass}`}>
                              {leaveStyle.label}
                              {leaveStyle.label === "LEAVE" ? <CheckCircle2 className="h-3 w-3" /> : null}
                            </span>
                          </div>
                        )}
                      </div>
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
