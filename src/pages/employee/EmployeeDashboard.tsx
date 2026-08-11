import React, { useMemo, useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Calendar, CalendarDays, FileText, Clock, Shield, Users, AlertTriangle, CheckCircle, XCircle, Award, Mail, Waves, Eye, Phone, MapPin, Hash, FileCheck, Globe, Star, ChevronLeft, ChevronRight, ArrowLeftRight, FlaskConical, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useLeaveBalances } from "@/hooks/useLeaves";
import { useLeaveData } from "@/hooks/useLeaveData";
import { DEFAULT_CL_BALANCE, DEFAULT_RH_BALANCE } from "@/lib/leaveConstants";
import { useShifts } from "@/hooks/useShifts";
import { useMyRoster } from "@/hooks/useRosters";
import { useMySchedule, DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";
import { isFinalLeaveApproved, useMyLeaveRequests } from "@/hooks/useLeaveRequests";
import { useDutyExchanges } from "@/hooks/useDutyExchanges";
import { buildEmployeeLicenseHealth, type LicenseWithExtras } from "@/hooks/useLicenseDashboard";
import { extractTraineeMilestone, getScheduledTraineeMilestone } from "@/lib/traineeMilestones";
import { OjtDashboardSummary } from "@/components/ojt/OjtDashboardSummary";
import { format, addDays, isSameDay, parse, parseISO, differenceInDays, startOfMonth, endOfMonth, eachDayOfInterval, isAfter, isBefore } from "date-fns";
import { parseRosterDate } from "@/lib/rosterDate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const DOUBLE_DUTY_CODES = new Set(["M+A", "A+M"]);

const LICENSE_LABELS: Record<string, string> = {
  rdr: "Radar",
  app: "Approach",
  plr: "Precision",
  adc: "Aerodrome",
  alpha: "Alpha",
  occ: "Oceanic",
};

/** Color map for duty code badges */
function getDutyBadgeColor(code: string): string {
  const c = code?.toUpperCase() || "";
  if (c === "M" || c === "M+A" || c === "CO+M" || c === "SUN+M") return "bg-yellow-100 text-yellow-700";
  if (c === "A" || c === "A+M" || c === "CO+A" || c === "SUN+A") return "bg-orange-100 text-orange-700";
  if (c === "N" || c === "CO+N" || c === "SUN+N" || c === "SAT+N") return "bg-blue-100 text-blue-700";
  if (c === "NO" || c === "SAT+NO" || c === "SUN+NO") return "bg-indigo-100 text-indigo-700";
  if (c === "CO") return "bg-teal-100 text-teal-700";
  if (c === "LEAVE" || c === "SL") return "bg-red-100 text-red-700";
  if (c === "CH") return "bg-lime-100 text-lime-700";
  if (c === "NH") return "bg-green-100 text-green-700";
  if (c === "GO") return "bg-lime-100 text-lime-700";
  if (c === "G") return "bg-neutral-100 text-neutral-700";
  if (c === "NA") return "bg-gray-100 text-gray-700";
  if (c.startsWith("SAT")) return "bg-cyan-100 text-cyan-700";
  if (c.startsWith("SUN")) return "bg-purple-100 text-purple-700";
  if (c === "T" || c === "TR") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
}

function isDoubleDuty(code?: string): boolean {
  return DOUBLE_DUTY_CODES.has(code?.trim().toUpperCase() || "");
}

function getShiftName(code?: string, description?: string): string {
  const normalizedCode = code?.trim() || "";
  return description || DUTY_DESCRIPTIONS[normalizedCode] || normalizedCode || "—";
}

function getRosterDutyLabel(shift?: string): string {
  const normalizedShift = shift?.trim() || "";
  return normalizedShift ? `${normalizedShift} Shift` : "—";
}

function getRosterAssignmentLabel(shift?: string, unit?: string, position?: string): string {
  const shiftLabel = shift?.trim() || "—";
  const unitLabel = unit?.trim() || "—";
  const positionLabel = position?.trim() || "";
  const hidePosition = shouldHideRosterValue(positionLabel);
  const hideUnit = shouldHideRosterValue(unitLabel);
  if (hideUnit || hidePosition) return "";
  const parts = [shiftLabel];

  if (!hideUnit) parts.push(unitLabel);
  if (!hidePosition && positionLabel) parts.push(positionLabel);

  return parts.join(" - ");
}

function shouldHideRosterValue(value?: string): boolean {
  const normalizedValue = value?.trim().toUpperCase() || "";
  return ["SPECIAL", "LEAVE", "LEAVES", "TRAINING", "EXTRA DUTY"].some((token) => normalizedValue.includes(token));
}

function shouldHideRosterEntry(unit?: string, position?: string): boolean {
  return shouldHideRosterValue(unit) || shouldHideRosterValue(position);
}

function sortRosterEntriesByShift<T extends { shift: string }>(entries: T[]): T[] {
  const shiftOrder: Record<string, number> = {
    MORNING: 0,
    AFTERNOON: 1,
    EVENING: 1,
    NIGHT: 2,
  };

  return [...entries].sort((a, b) => {
    const left = shiftOrder[a.shift?.trim().toUpperCase()] ?? 99;
    const right = shiftOrder[b.shift?.trim().toUpperCase()] ?? 99;
    return left - right;
  });
}

const DASHBOARD_LEAVE_CALENDAR_STYLES = {
  applied: {
    label: "REQ",
    legend: "Applied",
    cellClass: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
    badgeClass: "bg-amber-200 text-amber-900",
  },
  approved: {
    label: "LEAVE",
    legend: "Approved",
    cellClass: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200",
    badgeClass: "bg-emerald-200 text-emerald-900",
  },
} as const;

export default function EmployeeDashboard() {
  const { user, userRole } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
  const currentYear = new Date().getFullYear();
  const [currentMonthDate, setCurrentMonthDate] = useState(() => new Date());
  const [isBaBannerDismissed, setIsBaBannerDismissed] = useState(false);

  // Check localStorage for banner dismissal (resets daily)
  useEffect(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    const dismissedDate = localStorage.getItem("ba-test-banner-dismissed");
    if (dismissedDate === today) {
      setIsBaBannerDismissed(true);
    }
  }, []);
  const currentMonthStart = format(startOfMonth(currentMonthDate), "yyyy-MM-dd");
  const currentMonthEnd = format(endOfMonth(currentMonthDate), "yyyy-MM-dd");

  const today = format(new Date(), "yyyy-MM-dd");
  const weekEnd = format(addDays(new Date(), 9), "yyyy-MM-dd");
  const employeeEmpId = profile?.employee_id ? String(profile.employee_id) : null;

  const { data: balances, isLoading: balancesLoading } = useLeaveBalances(user?.id);
  const { data: leaveLedgerData = [] } = useLeaveData(currentYear, employeeEmpId);
  const { shifts, isLoading: shiftsLoading } = useShifts(user?.id, today, weekEnd);
  const { data: myRoster, isLoading: rosterLoading } = useMyRoster(profile?.full_name);
  const { data: mySchedule = [], isLoading: scheduleLoading } = useMySchedule(
    profile?.employee_id,
    today,
    format(addDays(new Date(), 9), 'yyyy-MM-dd')
  );
  const { data: monthlySchedule = [], isLoading: monthlyScheduleLoading } = useMySchedule(
    employeeEmpId || undefined,
    currentMonthStart,
    currentMonthEnd
  );
  const { data: myLeaveRequests = [], isLoading: leaveRequestsLoading } = useMyLeaveRequests(user?.id);
  const { data: myExchanges = [] } = useDutyExchanges(user?.id);

  const pendingExchanges = useMemo(() => {
    return myExchanges.filter((ex: any) => {
      const isPendingPartner = ex.status === "pending_partner" && ex.exchange_partner_id === user?.id;
      const isPendingOther = ["pending_wso", "pending_supervisor"].includes(ex.status);
      return isPendingPartner || isPendingOther;
    });
  }, [myExchanges, user?.id]);

  // ── BA Test selection check (time-aware banner) ────────────────────────────
  // Query all today's BA test entries (no expiry filter - page shows all)
  const { data: baTestRows = [] } = useQuery({
    queryKey: ["ba-test-list-dashboard"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ba_test_list")
        .select("employee_code, employee_name, shift")
        .eq("test_date", format(new Date(), "yyyy-MM-dd"));
      return (data ?? []) as { employee_code: string | null; employee_name: string; shift: string | null }[];
    },
    refetchInterval: 60 * 1000,
    enabled: !!profile,
  });

  const baTestAlert = useMemo(() => {
    if (!profile) return null;

    if (baTestRows.length === 0) return null;
    const myCode = String(profile.employee_id ?? "").trim().toLowerCase();
    const myName = String(profile.full_name ?? "").trim().toLowerCase();
    const match = baTestRows.find(r =>
      (myCode && String(r.employee_code ?? "").trim().toLowerCase() === myCode) ||
      (myName && String(r.employee_name ?? "").trim().toLowerCase() === myName)
    );
    if (!match) return null;

    // Time-aware visibility: hide banner after shift cutoff (IST)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const istHour = istNow.getUTCHours();
    const istMin = istNow.getUTCMinutes();
    const istTimeMinutes = istHour * 60 + istMin;

    const shift = (match.shift ?? "").toUpperCase();
    let cutoffMinutes: number;
    if (shift.includes("MORNING")) cutoffMinutes = 7 * 60 + 30; // 07:30
    else if (shift.includes("AFTERNOON")) cutoffMinutes = 13 * 60 + 30; // 13:30
    else if (shift.includes("NIGHT")) cutoffMinutes = 19 * 60 + 30; // 19:30
    else if (shift.includes("GENERAL")) cutoffMinutes = 10 * 60 + 45; // 10:45
    else return match; // Unknown shift - always show

    // Hide banner after cutoff
    if (istTimeMinutes >= cutoffMinutes) return null;
    return match;
  }, [baTestRows, profile]);

  const yearBalances = balances?.filter(b => b.year === currentYear) || [];
  const clBalance = yearBalances.find(b => b.leave_type === "cl");
  const rhBalance = yearBalances.find(b => b.leave_type === "rh");
  const elBalance = yearBalances.find(b => b.leave_type === "el");
  const compOff = yearBalances.find(b => b.leave_type === "comp_off");
  const ledgerRecord = useMemo(
    () => (employeeEmpId ? leaveLedgerData.find((r) => r.empId === employeeEmpId) ?? null : null),
    [employeeEmpId, leaveLedgerData],
  );

  useEffect(() => {
    if (balancesLoading) return;
    // #region agent log
    fetch('http://127.0.0.1:7366/ingest/cec5e719-b092-499e-b7f6-47f8a73a026c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'037720'},body:JSON.stringify({sessionId:'037720',location:'EmployeeDashboard.tsx:balances',message:'Dashboard quick-action balance sources',data:{currentYear,employeeEmpId,dbCl:clBalance?.balance??null,dbRh:rhBalance?.balance??null,dbCompOff:compOff?.balance??null,ledgerClRemaining:ledgerRecord?.casualRemaining??null,ledgerRhRemaining:ledgerRecord?Math.max(DEFAULT_RH_BALANCE-ledgerRecord.restrictedCount,0):null,ledgerCompOffRemaining:ledgerRecord?.compOffRemaining??null,dutyExchangeTileShowsRhBalance:rhBalance?.balance??null,pendingExchangesCount:pendingExchanges.length},timestamp:Date.now(),hypothesisId:'H1-H2'})}).catch(()=>{});
    // #endregion
  }, [balancesLoading, clBalance?.balance, compOff?.balance, currentYear, employeeEmpId, ledgerRecord, pendingExchanges.length, rhBalance?.balance]);

  // 2-day roster + schedule lookup
  const now = new Date();
  const tomorrow = addDays(now, 1);
  const tomorrowStr = format(tomorrow, "yyyy-MM-dd");

  const todayRosters = sortRosterEntriesByShift((myRoster || []).filter(r => {
    const d = parseRosterDate(r.date);
    return d && isSameDay(d, now);
  }));
  const tomorrowRosters = sortRosterEntriesByShift((myRoster || []).filter(r => {
    const d = parseRosterDate(r.date);
    return d && isSameDay(d, tomorrow);
  }));
  const visibleTodayRosters = todayRosters.filter((roster) => !shouldHideRosterEntry(roster.unit, roster.position));
  const visibleTomorrowRosters = tomorrowRosters.filter((roster) => !shouldHideRosterEntry(roster.unit, roster.position));
  const todaySchedule = mySchedule.find(s => s.duty_date === today);
  const tomorrowSchedule = mySchedule.find(s => s.duty_date === tomorrowStr);
  const shouldShowTodayRosterList = visibleTodayRosters.length > 1 || (todaySchedule && isDoubleDuty(todaySchedule.duty_code) && visibleTodayRosters.length > 0);
  const shouldShowTomorrowRosterList = visibleTomorrowRosters.length > 1 || (tomorrowSchedule && isDoubleDuty(tomorrowSchedule.duty_code) && visibleTomorrowRosters.length > 0);
  const todayRoster = visibleTodayRosters[0];
  const tomorrowRoster = visibleTomorrowRosters[0];

  const dashboardCalendarCells = useMemo(() => {
    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { day: number | null; iso: string | null }[] = [];

    for (let i = 0; i < firstDay; i++) {
      cells.push({ day: null, iso: null });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({
        day,
        iso: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      });
    }

    return cells;
  }, [currentMonthDate]);

  const approvedLeaveDates = useMemo(() => {
    const dates = new Set<string>();
    monthlySchedule.forEach((entry) => {
      if (entry.duty_code === "LEAVE") dates.add(entry.duty_date);
    });

    if (dates.size > 0) return dates;

    const monthStartDate = parseISO(currentMonthStart);
    const monthEndDate = parseISO(currentMonthEnd);

    myLeaveRequests
      .filter((request) => isFinalLeaveApproved(request))
      .forEach((request) => {
        const requestStart = parseISO(request.start_date);
        const requestEnd = parseISO(request.end_date);
        if (isAfter(requestStart, monthEndDate) || isBefore(requestEnd, monthStartDate)) return;

        const boundedStart = isBefore(requestStart, monthStartDate) ? monthStartDate : requestStart;
        const boundedEnd = isAfter(requestEnd, monthEndDate) ? monthEndDate : requestEnd;

        eachDayOfInterval({ start: boundedStart, end: boundedEnd }).forEach((day) => {
          dates.add(format(day, "yyyy-MM-dd"));
        });
      });

    return dates;
  }, [currentMonthEnd, currentMonthStart, monthlySchedule, myLeaveRequests]);

  const appliedLeaveDates = useMemo(() => {
    const dates = new Set<string>();
    const monthStartDate = parseISO(currentMonthStart);
    const monthEndDate = parseISO(currentMonthEnd);

    myLeaveRequests
      .filter((request) => request.status === "Pending WSO" || request.status === "Pending Supervisor")
      .forEach((request) => {
        const requestStart = parseISO(request.start_date);
        const requestEnd = parseISO(request.end_date);
        if (isAfter(requestStart, monthEndDate) || isBefore(requestEnd, monthStartDate)) return;

        const boundedStart = isBefore(requestStart, monthStartDate) ? monthStartDate : requestStart;
        const boundedEnd = isAfter(requestEnd, monthEndDate) ? monthEndDate : requestEnd;

        eachDayOfInterval({ start: boundedStart, end: boundedEnd }).forEach((day) => {
          dates.add(format(day, "yyyy-MM-dd"));
        });
      });

    return dates;
  }, [currentMonthEnd, currentMonthStart, myLeaveRequests]);

  const dashboardLeaveCalendar = useMemo(() => {
    const map = new Map<string, (typeof DASHBOARD_LEAVE_CALENDAR_STYLES)[keyof typeof DASHBOARD_LEAVE_CALENDAR_STYLES]>();

    appliedLeaveDates.forEach((date) => {
      map.set(date, DASHBOARD_LEAVE_CALENDAR_STYLES.applied);
    });

    approvedLeaveDates.forEach((date) => {
      map.set(date, DASHBOARD_LEAVE_CALENDAR_STYLES.approved);
    });

    return map;
  }, [appliedLeaveDates, approvedLeaveDates]);

  const isLoading = profileLoading || balancesLoading || shiftsLoading || monthlyScheduleLoading || leaveRequestsLoading;

  const currentShift = profile?.current_shift ? `${profile.current_shift.toUpperCase()} Shift` : "—";
  const licenseHealth = buildEmployeeLicenseHealth(profile, ((profile?.licenses || []) as LicenseWithExtras[]));
  const traineeMilestone = useMemo(() => extractTraineeMilestone((profile?.linked_training_record || null) as Record<string, unknown> | null), [profile?.linked_training_record]);
  const scheduledTraineeMilestone = useMemo(() => getScheduledTraineeMilestone(traineeMilestone), [traineeMilestone]);
  const licenseTileAccent =
    licenseHealth.overallStatus === "expired"
      ? "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
      : licenseHealth.overallStatus === "warning"
        ? "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400"
        : "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400";
  const licenseStatusBadgeClass =
    licenseHealth.overallStatus === "expired"
      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
      : licenseHealth.overallStatus === "warning"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
        : licenseHealth.overallStatus === "valid"
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  const LicenseStatusIcon =
    licenseHealth.overallStatus === "expired"
      ? XCircle
      : licenseHealth.overallStatus === "warning"
        ? AlertTriangle
        : licenseHealth.overallStatus === "valid"
          ? CheckCircle
          : Clock;

  const handleDismissBaBanner = () => {
    const today = format(new Date(), "yyyy-MM-dd");
    localStorage.setItem("ba-test-banner-dismissed", today);
    setIsBaBannerDismissed(true);
  };

  return (
    <DashboardLayout role="employee">
      <div className="space-y-4 md:space-y-6">

        {/* ─── BA Test Alert Banner (time-aware, dismissible) ─── */}
        {baTestAlert && !isBaBannerDismissed && (
          <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-4 md:p-5 relative">
            <div className="flex items-start gap-3">
              <div className="size-9 bg-red-100 dark:bg-red-800/50 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <FlaskConical className="size-4 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0 pr-8">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                  Mandatory BA Test — {baTestAlert.shift ? `${baTestAlert.shift} Shift` : "Today"}
                </p>
                <p className="mt-1 text-sm text-red-700 dark:text-red-300 leading-snug">
                  You have been selected for today's mandatory Breath Analyzer (BA) test. Kindly report to the testing station prior to commencing your shift.
                </p>
              </div>
              <button
                onClick={handleDismissBaBanner}
                className="absolute top-3 right-3 size-6 flex items-center justify-center rounded-md hover:bg-red-200 dark:hover:bg-red-800/50 transition-colors"
                aria-label="Dismiss BA test alert"
              >
                <X className="size-4 text-red-600 dark:text-red-400" />
              </button>
            </div>
          </div>
        )}

        {/* ─── Pending Duty Exchange Banner ─── */}
        {pendingExchanges.length > 0 && (
          <Link to="/employee/duty-exchange" className="block">
            <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 md:p-5">
              <div className="flex items-start gap-3">
                <div className="size-9 bg-amber-100 dark:bg-amber-800/50 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                  <ArrowLeftRight className="size-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                    {pendingExchanges.length} Pending Duty Exchange{pendingExchanges.length > 1 ? "s" : ""}
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {pendingExchanges.slice(0, 3).map((ex: any) => {
                      const isPartnerAction = ex.status === "pending_partner" && ex.exchange_partner_id === user?.id;
                      const partnerName = ex.requesting_user?.full_name || "Someone";
                      const requesterName = ex.exchange_partner?.full_name || "Partner";
                      return (
                        <p key={ex.id} className="text-xs text-amber-700 dark:text-amber-300">
                          {isPartnerAction
                            ? `${partnerName} has requested a duty exchange with you${ex.duty_date ? ` on ${format(new Date(ex.duty_date), "dd MMM")}` : ""} — action required`
                            : `Exchange with ${ex.requesting_user_id === user?.id ? requesterName : partnerName}${ex.duty_date ? ` on ${format(new Date(ex.duty_date), "dd MMM")}` : ""} — awaiting ${ex.status.replace("pending_", "").toUpperCase()} approval`}
                        </p>
                      );
                    })}
                    {pendingExchanges.length > 3 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">+{pendingExchanges.length - 3} more</p>
                    )}
                  </div>
                </div>
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400 shrink-0">View &rarr;</span>
              </div>
            </div>
          </Link>
        )}

        {/* ─── Duty Overview Card ─── */}
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 md:mb-6">
            <div className="flex items-center gap-3">
              <div className="size-8 md:size-10 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center">
                <Clock className="size-4 md:size-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-gray-100">Duty Overview</h2>
            </div>
            <span className="text-base md:text-lg font-bold text-blue-600 dark:text-blue-400">{currentShift}</span>
          </div>

          {/* Today + Tomorrow Sub-Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
            {/* Today — Purple */}
            <div className="bg-purple-100 dark:bg-purple-900/30 rounded-xl p-4 md:p-6">
              <div className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-1">TODAY</div>
              <div className="text-sm text-purple-700 dark:text-purple-300 mb-3 md:mb-4">{format(now, "EEE, dd MMM")}</div>
              {(rosterLoading || scheduleLoading) ? (
                <p className="text-sm text-purple-600 dark:text-purple-400">Loading…</p>
              ) : shouldShowTodayRosterList ? (
                <div className="space-y-1">
                  {visibleTodayRosters
                    .map((roster) => ({
                      key: `${roster.date}-${roster.shift}-${roster.position}-${roster.unit}`,
                      label: getRosterAssignmentLabel(roster.shift, roster.unit, roster.position),
                    }))
                    .filter((roster) => roster.label)
                    .map((roster) => (
                      <div key={roster.key} className="text-sm font-medium text-purple-800 dark:text-purple-200">
                        {roster.label}
                      </div>
                    ))}
                </div>
              ) : todayRoster ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-purple-800 dark:text-purple-200">
                    {getRosterDutyLabel(todayRoster.shift)}
                  </div>
                  <div className="text-sm font-medium text-purple-800 dark:text-purple-200">
                    {[
                      todayRoster.unit?.trim().toUpperCase() === "SPECIAL" ? null : `Unit ${todayRoster.unit}`,
                      todayRoster.position?.trim().toUpperCase() === "EXTRA DUTY" ? null : todayRoster.position,
                      `Team ${todayRoster.team}`,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ) : todaySchedule ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-purple-800 dark:text-purple-200">
                    {getShiftName(todaySchedule.duty_code, todaySchedule.duty_description)}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-purple-600 dark:text-purple-400">No assignment</p>
              )}
            </div>

            {/* Tomorrow — Blue */}
            <div className="bg-blue-100 dark:bg-blue-900/30 rounded-xl p-4 md:p-6">
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">TOMORROW</div>
              <div className="text-sm text-blue-700 dark:text-blue-300 mb-3 md:mb-4">{format(tomorrow, "EEE, dd MMM")}</div>
              {(rosterLoading || scheduleLoading) ? (
                <p className="text-sm text-blue-600 dark:text-blue-400">Loading…</p>
              ) : shouldShowTomorrowRosterList ? (
                <div className="space-y-1">
                  {visibleTomorrowRosters
                    .map((roster) => ({
                      key: `${roster.date}-${roster.shift}-${roster.position}-${roster.unit}`,
                      label: getRosterAssignmentLabel(roster.shift, roster.unit, roster.position),
                    }))
                    .filter((roster) => roster.label)
                    .map((roster) => (
                      <div key={roster.key} className="text-sm font-medium text-blue-800 dark:text-blue-200">
                        {roster.label}
                      </div>
                    ))}
                </div>
              ) : tomorrowRoster ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    {getRosterDutyLabel(tomorrowRoster.shift)}
                  </div>
                  <div className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    {[
                      tomorrowRoster.unit?.trim().toUpperCase() === "SPECIAL" ? null : `Unit ${tomorrowRoster.unit}`,
                      tomorrowRoster.position?.trim().toUpperCase() === "EXTRA DUTY" ? null : tomorrowRoster.position,
                      `Team ${tomorrowRoster.team}`,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ) : tomorrowSchedule ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    {getShiftName(tomorrowSchedule.duty_code, tomorrowSchedule.duty_description)}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-blue-600 dark:text-blue-400">No assignment</p>
              )}
            </div>
          </div>

        </div>

        {scheduledTraineeMilestone && traineeMilestone && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-sm dark:border-indigo-900/50 dark:bg-indigo-950/20">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-200">
                  <CalendarDays className="size-4" />
                  <span className="text-sm md:text-[15px] font-semibold">Training Milestone</span>
                </div>
                <div className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {scheduledTraineeMilestone.label} on {scheduledTraineeMilestone.formattedDate}
                </div>
                <div className="mt-1 text-[11px] md:text-xs text-gray-600 dark:text-gray-300">
                  Unit {traineeMilestone.unit || 'Not marked'}
                </div>
                <div className="mt-2 text-xs font-medium text-indigo-700 dark:text-indigo-200">
                  Best of luck for your upcoming {scheduledTraineeMilestone.label}.
                </div>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${scheduledTraineeMilestone.countdownClass}`}>
                {scheduledTraineeMilestone.countdownLabel}
              </span>
            </div>
          </div>
        )}

        <OjtDashboardSummary />

        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-4 md:mb-6">
            <div className="size-8 md:size-10 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center">
              <CalendarDays className="size-4 md:size-5 text-slate-600 dark:text-slate-300" />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-gray-100">Quick Actions</h2>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <Link
              to="/employee/leave-dashboard"
              className="block rounded-xl transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 md:p-4 h-full">
              <div className="flex items-center justify-between mb-2 md:mb-3">
                <div>
                  <span className="text-sm md:text-[15px] font-semibold text-gray-900 dark:text-gray-100">Leave Overview</span>
                  <div className="mt-0.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Apply for leave and leave summary</div>
                </div>
                <div className="size-6 md:size-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center">
                  <FileText className="size-3 md:size-4 text-blue-600 dark:text-blue-400" />
                </div>
              </div>

            </div>
            </Link>

            <Link
              to="/employee/duty-exchange"
              className="block rounded-xl transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 md:p-4 h-full">
              <div className="flex items-center justify-between mb-2 md:mb-3">
                <div>
                  <span className="text-sm md:text-[15px] font-semibold text-gray-900 dark:text-gray-100">Duty Exchange</span>
                  <div className="mt-0.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Request and track exchange status</div>
                </div>
                <div className="size-6 md:size-8 bg-purple-100 dark:bg-purple-900/40 rounded-lg flex items-center justify-center">
                  <FileText className="size-3 md:size-4 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
              <div className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{rhBalance ? rhBalance.balance : ""}</div>
            </div>
            </Link>

            <Link
              to="/employee/licenses"
              className="block rounded-xl transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 md:p-4 h-full">
              <div className="flex items-center justify-between mb-2 md:mb-3">
                <div>
                  <span className="text-sm md:text-[15px] font-semibold text-gray-900 dark:text-gray-100">License Status</span>
                  <div className="mt-0.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-400">View license, rating, medical and ELPA data</div>
                </div>
                <div className={`size-6 md:size-8 rounded-lg flex items-center justify-center ${licenseTileAccent}`}>
                  <Shield className="size-3 md:size-4" />
                </div>
              </div>
              {(licenseHealth.expiredCount > 0 || licenseHealth.warningCount > 0) && (
                <div className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">
                  {licenseHealth.expiredCount > 0
                    ? `${licenseHealth.expiredCount} expired item${licenseHealth.expiredCount > 1 ? "s" : ""}`
                    : `${licenseHealth.warningCount} renewal due soon`}
                </div>
              )}
            </div>
            </Link>

            <Link
              to="/employee/comp-off"
              className="block rounded-xl transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 md:p-4 h-full">
              <div className="flex items-center justify-between mb-2 md:mb-3">
                <div>
                  <span className="text-sm md:text-[15px] font-semibold text-gray-900 dark:text-gray-100">Comp Off</span>
                  <div className="mt-0.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Check balance and expiry status</div>
                </div>
                <div className="size-6 md:size-8 bg-orange-100 dark:bg-orange-900/40 rounded-lg flex items-center justify-center">
                  <Clock className="size-3 md:size-4 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
              <div className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{compOff ? compOff.balance : ""}</div>
            </div>
            </Link>
          </div>
        </div>

        {/* ─── Bottom Two-Column Grid ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">

          {/* ─── Upcoming Schedule ─── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="size-8 md:size-10 bg-purple-100 dark:bg-purple-900/40 rounded-full flex items-center justify-center">
                  <Calendar className="size-4 md:size-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm md:text-base">Upcoming Schedule</h3>
                </div>
              </div>
              <Link to="/employee/schedule" title="View Duty Schedule">
                <div className="size-8 md:size-10 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors cursor-pointer">
                  <CalendarDays className="size-4 md:size-5 text-blue-600 dark:text-blue-400" />
                </div>
              </Link>
            </div>

            <div className="space-y-2 md:space-y-3">
              {mySchedule.length > 0 ? mySchedule.map((duty, idx) => (
                <div key={duty.id} className={`flex items-start justify-between gap-3 py-2 md:py-3 ${idx < mySchedule.length - 1 ? 'border-b border-gray-100 dark:border-gray-800' : ''}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{format(parseISO(duty.duty_date), "MMM d, EEE")}</div>
                    <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 break-words whitespace-normal leading-snug">
                      {duty.duty_description || DUTY_DESCRIPTIONS[duty.duty_code] || duty.duty_code}
                    </div>
                  </div>
                  <span className={`shrink-0 w-16 px-2 md:px-3 py-1 text-xs font-medium rounded text-center ${getDutyBadgeColor(duty.duty_code)}`}>
                    {duty.duty_code}
                  </span>
                </div>
              )) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No schedule data yet. Fetch from Settings.</p>
              )}
            </div>
          </div>

          {/* ─── Profile & Ratings ─── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="size-8 md:size-10 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center">
                <Users className="size-4 md:size-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm md:text-base">Profile & Ratings</h3>
                <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">Your profile snapshot and license validity</p>
              </div>
            </div>

            {/* Profile rows with icons */}
            <div className="space-y-3 md:space-y-4 mb-4 md:mb-6">
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                  <Hash className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                  <span>Employee ID</span>
                </div>
                <span className="text-xs md:text-sm font-mono font-medium text-gray-900 dark:text-gray-100">{profile?.employee_id || '—'}</span>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                  <Award className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                  <span>Designation</span>
                </div>
                <span className="text-xs md:text-sm font-medium text-gray-900 dark:text-gray-100">{profile?.designation || '—'}</span>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                  <MapPin className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                  <span>Current Station</span>
                </div>
                <span className="text-xs md:text-sm font-medium text-gray-900 dark:text-gray-100">{(profile as any)?.station || 'VECC'}</span>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                  <Phone className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                  <span>Contact No</span>
                </div>
                <span className="text-xs md:text-sm font-medium text-gray-900 dark:text-gray-100">{(profile as any)?.mobile || '—'}</span>
              </div>

              <div className="flex items-start justify-between gap-3 py-2">
                <div className="flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300 shrink-0">
                  <Mail className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                  <span>Email</span>
                </div>
                <span className="text-xs md:text-sm font-medium text-gray-900 dark:text-gray-100 truncate md:truncate-none md:break-all text-right">{profile?.email || '—'}</span>
              </div>

              {(profile as any)?.alternate_email && (
                <div className="flex items-start justify-between gap-3 py-2">
                  <div className="flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300 shrink-0">
                    <Mail className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                    <span>Official Email</span>
                  </div>
                  <span className="text-xs md:text-sm font-medium text-gray-900 dark:text-gray-100 truncate md:truncate-none md:break-all text-right">{(profile as any).alternate_email}</span>
                </div>
              )}

              {profile?.stream && (
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                    <Waves className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                    <span>Stream</span>
                  </div>
                  <span className="text-xs md:text-sm font-medium text-gray-900 dark:text-gray-100">{profile.stream.toUpperCase()}</span>
                </div>
              )}
            </div>

            {/* Licenses & Ratings */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="text-xs md:text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">LICENSES & RATINGS</div>
              {/* Key license meta */}
              <div className="grid grid-cols-1 gap-2 mb-4 md:grid-cols-3">
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">License No</p>
                  <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                    {(profile?.linked_training_record as any)?.license_number ||
                      (profile?.profile_details as any)?.atc_license_number || '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">ICAO ELPA Level</p>
                  <p className="text-xs font-medium text-gray-900 dark:text-gray-100">
                    {(profile?.linked_training_record as any)?.elpa_level
                      ? `Level ${(profile.linked_training_record as any).elpa_level}`
                      : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Highest Rating</p>
                  <p className="text-xs font-medium text-gray-900 dark:text-gray-100">
                    {(profile as any)?.highest_rating || '—'}
                  </p>
                </div>
              </div>

              <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">License Status</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{licenseHealth.overallLabel}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{licenseHealth.summary}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${licenseStatusBadgeClass}`}>
                    <LicenseStatusIcon className="size-3" />
                    {licenseHealth.overallStatus.toUpperCase()}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                  <span className="rounded-full bg-white px-2.5 py-1 dark:bg-gray-900">
                    Expired: {licenseHealth.expiredCount}
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 dark:bg-gray-900">
                    Due Soon: {licenseHealth.warningCount}
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 dark:bg-gray-900">
                    Next Review: {licenseHealth.nextExpiry?.expiryDate ? format(new Date(licenseHealth.nextExpiry.expiryDate), 'dd MMM yyyy') : 'Not available'}
                  </span>
                </div>
              </div>

              {(() => {
                const activeRatings = licenseHealth.ratings.filter((r) => r.isActive);
                if (activeRatings.length === 0) {
                  return (
                    <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4 text-center border border-gray-200 dark:border-gray-700">
                      <Shield className="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                      <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400">No active ratings on record</p>
                      <Link to="/employee/licenses" className="mt-2 inline-block text-xs text-green-600 dark:text-green-400 font-medium hover:underline">
                        View license details →
                      </Link>
                    </div>
                  );
                }
                return (
                  <div className="space-y-2">
                    {activeRatings.slice(0, 4).map((lic) => {
                      const expiry = lic.expiryDate ? new Date(lic.expiryDate) : null;
                      const daysLeft = expiry ? differenceInDays(expiry, new Date()) : null;
                      let statusColor = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
                      let StatusIcon = CheckCircle;
                      let statusLabel = 'Valid';
                      if (lic.status === 'expired' || (daysLeft !== null && daysLeft < 0)) {
                        statusColor = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
                        StatusIcon = XCircle;
                        statusLabel = 'Expired';
                      } else if (lic.status === 'warning' || (daysLeft !== null && daysLeft <= 30)) {
                        statusColor = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
                        StatusIcon = AlertTriangle;
                        statusLabel = `${daysLeft ?? 0}d left`;
                      }
                      return (
                        <div key={lic.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Shield className="size-4 text-green-600 dark:text-green-400" />
                            <div>
                              <p className="font-medium text-sm text-gray-900 dark:text-gray-100">{lic.label}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {expiry ? `Prof valid upto ${format(expiry, 'dd MMM yyyy')}` : 'No proficiency or endorsement date'}
                              </p>
                            </div>
                          </div>
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}>
                            <StatusIcon className="size-3" />
                            {statusLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-3 md:p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          {/* Header: stacked on mobile, side-by-side on desktop */}
          <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm md:text-base">Leave Calendar</h3>
              <p className="text-[11px] md:text-sm text-gray-600 dark:text-gray-400 leading-snug">Applied requests vs approved leave from schedule</p>
            </div>
            <div className="flex items-center justify-between gap-1.5 md:gap-2">
              <button
                type="button"
                onClick={() => setCurrentMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                className="inline-flex h-7 w-7 md:h-8 md:w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-3.5 w-3.5 md:h-4 md:w-4" />
              </button>
              <div className="min-w-[90px] md:min-w-[130px] text-center text-xs font-semibold text-slate-700 dark:text-slate-200 md:text-sm">
                {format(currentMonthDate, "MMM yyyy")}
              </div>
              <button
                type="button"
                onClick={() => setCurrentMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                className="inline-flex h-7 w-7 md:h-8 md:w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Next month"
              >
                <ChevronRight className="h-3.5 w-3.5 md:h-4 md:w-4" />
              </button>
              <Link to="/employee/leave-dashboard" className="ml-auto md:ml-2 text-[11px] md:text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">
                View all →
              </Link>
            </div>
          </div>

          {!employeeEmpId ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
              Your profile does not have an employee ID yet, so approved leave cannot be matched from schedule.
            </div>
          ) : (
            <div className="space-y-3 md:space-y-4">
              <div className="flex flex-wrap items-center gap-2 md:gap-3 text-[10px] md:text-xs text-slate-600 dark:text-slate-300">
                <span className="inline-flex items-center gap-1 md:gap-1.5 rounded-full bg-amber-50 px-2 md:px-3 py-0.5 md:py-1 font-medium text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50">
                  <span className="inline-flex rounded-sm bg-amber-200 px-1 md:px-1.5 py-0.5 text-[8px] md:text-[9px] font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-900/70 dark:text-amber-100">REQ</span>
                  <span className="hidden sm:inline">Applied requests:</span><span className="sm:hidden">Applied:</span> {appliedLeaveDates.size}
                </span>
                <span className="inline-flex items-center gap-1 md:gap-1.5 rounded-full bg-emerald-50 px-2 md:px-3 py-0.5 md:py-1 font-medium text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50">
                  <span className="inline-flex rounded-sm bg-emerald-200 px-1 md:px-1.5 py-0.5 text-[8px] md:text-[9px] font-bold uppercase tracking-wide text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-100">APR</span>
                  <span className="hidden sm:inline">Approved in schedule:</span><span className="sm:hidden">Approved:</span> {approvedLeaveDates.size}
                </span>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="grid grid-cols-7 gap-px bg-slate-200/70 dark:bg-slate-800/80 text-[9px] md:text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  {[
                    { short: "S", full: "Sun" },
                    { short: "M", full: "Mon" },
                    { short: "T", full: "Tue" },
                    { short: "W", full: "Wed" },
                    { short: "T", full: "Thu" },
                    { short: "F", full: "Fri" },
                    { short: "S", full: "Sat" },
                  ].map((day, i) => (
                    <div key={i} className="bg-slate-100/90 px-0.5 md:px-1 py-1.5 md:py-2 text-center dark:bg-slate-900/80">
                      <span className="sm:hidden">{day.short}</span>
                      <span className="hidden sm:inline">{day.full}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-px bg-slate-200/70 dark:bg-slate-800/80">
                  {dashboardCalendarCells.map((cell, idx) => {
                    const leaveStyle = cell.iso ? dashboardLeaveCalendar.get(cell.iso) : undefined;
                    const todayIso = format(new Date(), "yyyy-MM-dd");
                    const isTodayCell = cell.iso === todayIso;

                    return (
                      <div
                        key={`${cell.iso || 'pad'}-${idx}`}
                        className={`min-h-[40px] md:min-h-[88px] bg-white p-1 md:p-2 dark:bg-gray-900 ${!cell.day ? 'bg-slate-50/80 dark:bg-slate-950/60' : ''}`}
                      >
                        {cell.day ? (
                          <div className="flex h-full flex-col">
                            <div className={`text-[10px] md:text-xs font-semibold ${isTodayCell ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-300'}`}>
                              {isTodayCell ? (
                                <span className="inline-flex h-4 w-4 md:h-5 md:w-5 items-center justify-center rounded-full bg-blue-600 text-[9px] md:text-[11px] font-bold text-white dark:bg-blue-500">
                                  {cell.day}
                                </span>
                              ) : (
                                cell.day
                              )}
                            </div>
                            {leaveStyle && (
                              <div className={`mt-0.5 md:mt-1 flex flex-1 items-end rounded-md px-0.5 md:px-1.5 py-0.5 md:py-1 ${leaveStyle.cellClass}`}>
                                {/* Mobile: compact dot indicator; Desktop: full badge */}
                                <span className={`hidden md:inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${leaveStyle.badgeClass}`}>
                                  {leaveStyle.label}
                                  {leaveStyle.label === "LEAVE" ? <CheckCircle className="h-3 w-3" /> : null}
                                </span>
                                <span className={`md:hidden inline-flex items-center justify-center rounded-sm px-1 py-px text-[7px] font-bold uppercase leading-none ${leaveStyle.badgeClass}`}>
                                  {leaveStyle.label === "LEAVE" ? "✓" : leaveStyle.label.charAt(0)}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

    </DashboardLayout>
  );
}
