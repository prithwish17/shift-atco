import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, ShieldAlert, Users } from "lucide-react";
import { addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, format, parseISO, startOfMonth, subMonths } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { useElTotalAvailed } from "@/hooks/useElData";
import { useLeaveData } from "@/hooks/useLeaveData";
import { useAllLeaveRequests } from "@/hooks/useLeaveRequests";
import { EmployeeLeaveSearch } from "@/components/leave/EmployeeLeaveSearch";
import { supabase } from "@/integrations/supabase/client";
import { getAttendanceShiftTokens } from "@/lib/teamDutyRotation";

import { SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import { YEAR_LOOKBACK } from "@/lib/leaveConstants";


const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: YEAR_LOOKBACK }, (_, i) => CURRENT_YEAR - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, monthIndex) => ({
  value: String(monthIndex),
  label: format(new Date(2000, monthIndex, 1), "MMMM"),
}));
const TEAM_ORDER = ["A", "B", "C", "D", "E", "G"] as const;

const TEAM_COLORS: Record<string, string> = {
  "Team A": "#2563EB", // blue
  "Team B": "#16A34A", // green
  "Team C": "#D97706", // amber
  "Team D": "#9333EA", // purple
  "Team E": "#DC2626", // red
  "Team G": "#0891B2", // cyan
};
const TEAM_COLOR_DEFAULT = "#64748B"; // slate for any extra teams

/* ── Shift rotation (mirrors SupervisorDashboard.tsx) ── */
const DUTY_CYCLE: Array<"M" | "A" | "N" | "NO" | "CO"> = ["M", "A", "N", "NO", "CO"];
const TODAY_TEAM_DUTY_BASE: Record<string, "M" | "A" | "N" | "NO" | "CO"> = {
  A: "N",
  B: "A",
  C: "M",
  D: "CO",
  E: "NO",
};
const DUTY_ROTATION_ANCHOR_DATE_IST = "2026-03-09";
const SHIFT_LABELS: Record<string, string> = {
  M: "Morning",
  A: "Afternoon",
  N: "Night",
  NO: "Night Off",
  CO: "Clear Off",
};
const SHIFT_COLORS: Record<string, string> = {
  M: "#F59E0B",   // amber — morning
  A: "#3B82F6",   // blue  — afternoon
  N: "#6366F1",   // indigo — night
  NO: "#94A3B8",  // slate — night off
  CO: "#10B981",  // emerald — clear off
};

function getTeamDutyForDate(teamKey: string, dateKey: string): "M" | "A" | "N" | "NO" | "CO" {
  const base = TODAY_TEAM_DUTY_BASE[teamKey];
  if (!base) return "CO";
  const baseIndex = DUTY_CYCLE.indexOf(base);
  const offset = differenceInCalendarDays(parseISO(dateKey), parseISO(DUTY_ROTATION_ANCHOR_DATE_IST));
  const idx = (baseIndex + (offset % DUTY_CYCLE.length) + DUTY_CYCLE.length) % DUTY_CYCLE.length;
  return DUTY_CYCLE[idx];
}



type AvailabilityCard = {
  label: string;
  value: number;
  helper: string;
};

type CalendarCell = {
  day: number | null;
  iso: string | null;
  isCurrentMonth: boolean;
};

type CalendarDaySummary = {
  count: number;
  pending: number;
  approved: number;
  primaryType: string;
  typeCounts: Record<string, number>;
};

const CALENDAR_TYPE_STYLES: Record<string, { cellClass: string; badgeClass: string; legendLabel: string }> = {
  CL: {
    cellClass: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/60",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    legendLabel: "Casual Leave",
  },
  EL: {
    cellClass: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/60",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    legendLabel: "Earned Leave",
  },
  COMP_OFF: {
    cellClass: "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900/60",
    badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
    legendLabel: "Compensatory Off",
  },
  RH: {
    cellClass: "bg-teal-50 border-teal-200 dark:bg-teal-950/30 dark:border-teal-900/60",
    badgeClass: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
    legendLabel: "Restricted Holiday",
  },
  OTHER: {
    cellClass: "bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-900/60",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
    legendLabel: "Other Leave",
  },
};

const TYPE_SHORT_LABELS: Record<string, string> = {
  CL: "CL",
  EL: "EL",
  COMP_OFF: "C.Off",
  RH: "RH",
  OTHER: "Oth",
};

function resolveCalendarType(leaveType: string) {
  const normalized = leaveType.toUpperCase();
  if (normalized.startsWith("CL")) return "CL";
  if (normalized === "EL" || normalized === "NEE" || normalized === "HPL" || normalized === "COMM") return "EL";
  if (normalized === "COMP_OFF" || normalized === "COMP_OFF_USED" || normalized === "OPE_COMP_OFF") return "COMP_OFF";
  if (normalized === "RH") return "RH";
  return "OTHER";
}

function buildCalendarGrid(date: Date): CalendarCell[] {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const daysInMonth = monthEnd.getDate();
  const startDay = monthStart.getDay();
  const cells: CalendarCell[] = [];

  for (let i = 0; i < startDay; i += 1) {
    cells.push({ day: null, iso: null, isCurrentMonth: false });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cellDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    cells.push({
      day,
      iso: format(cellDate, "yyyy-MM-dd"),
      isCurrentMonth: true,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ day: null, iso: null, isCurrentMonth: false });
  }

  return cells;
}

function formatRequestRange(startDate: string, endDate: string) {
  try {
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    if (startDate === endDate) return format(start, "dd MMM yyyy");
    if (start.getFullYear() === end.getFullYear()) {
      return `${format(start, "dd MMM")} - ${format(end, "dd MMM yyyy")}`;
    }
    return `${format(start, "dd MMM yyyy")} - ${format(end, "dd MMM yyyy")}`;
  } catch {
    return `${startDate} - ${endDate}`;
  }
}

export default function SupervisorLeaveDashboard() {
  const isMobile = useIsMobile();
  const chartFontSize = isMobile ? 10 : 12;
  const chartMargin = isMobile
    ? { top: 16, right: 4, left: -24, bottom: 0 }
    : { top: 8, right: 4, left: -16, bottom: 0 };
  const chartBarSize = isMobile ? 22 : 34;
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [loadYearlyBalances, setLoadYearlyBalances] = useState(false);
  const [includePreviousYear, setIncludePreviousYear] = useState(false);
  const { data, leaveQuery } = useLeaveData(selectedYear, loadYearlyBalances ? undefined : null, {
    includePreviousYear,
    debugLabel: "supervisor",
  });
  const [calendarDate, setCalendarDate] = useState(() => startOfMonth(new Date()));
  const calendarMonthStart = format(startOfMonth(calendarDate), "yyyy-MM-dd");
  const calendarMonthEnd = format(endOfMonth(calendarDate), "yyyy-MM-dd");
  const { data: leaveRequests = [], isLoading: requestsLoading, error: requestsError } = useAllLeaveRequests({
    overlapStartDate: calendarMonthStart,
    overlapEndDate: calendarMonthEnd,
  });
  const [selectedTrackMonth, setSelectedTrackMonth] = useState(() => new Date().getMonth());
  const [selectedTrackDate, setSelectedTrackDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  useEffect(() => {
    setCalendarDate((current) => new Date(selectedYear, current.getMonth(), 1));
  }, [selectedYear]);

  useEffect(() => {
    setSelectedTrackMonth(selectedYear === CURRENT_YEAR ? new Date().getMonth() : 0);
  }, [selectedYear]);

  const activeEmployees = useMemo(() => data.filter((emp) => emp.status === "Active"), [data]);

  const stats = useMemo(() => {
    const total = data.length;
    const active = activeEmployees.length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [activeEmployees, data]);

  const { data: totalElAvailed = 0 } = useElTotalAvailed(selectedYear);

  const availabilityCards = useMemo<AvailabilityCard[]>(() => {
    const activeCount = activeEmployees.length;
    const totalReservedAllowance = activeCount * 2;

    const totals = activeEmployees.reduce(
      (acc, emp) => {
        acc.casualUsed += emp.casualCount;
        acc.casualRemaining += emp.casualRemaining;
        acc.restrictedUsed += emp.restrictedCount;
        acc.compOffRemaining += emp.compOffRemaining;
        acc.compOffEarned += emp.compOffEarned;
        acc.compOffUsed += emp.compOffUsed;
        acc.compOffExpired += emp.compOffExpired;
        return acc;
      },
      { casualUsed: 0, casualRemaining: 0, restrictedUsed: 0, compOffRemaining: 0, compOffEarned: 0, compOffUsed: 0, compOffExpired: 0 },
    );

    const { casualUsed, casualRemaining, restrictedUsed, compOffRemaining, compOffEarned, compOffUsed, compOffExpired } = totals;
    const restrictedRemaining = Math.max(totalReservedAllowance - restrictedUsed, 0);

    return [
      {
        label: "Earned Leave Availed",
        value: totalElAvailed,
        helper: `Earned leave days used in ${selectedYear}`,
      },
      {
        label: "Casual Balance Left",
        value: casualRemaining,
        helper: `${casualUsed} used across ${activeCount || 0} active employees`,
      },
      {
        label: "Reserved Holiday Left",
        value: restrictedRemaining,
        helper: `${restrictedUsed} used this year`,
      },
      {
        label: "Comp-Off Left",
        value: compOffRemaining,
        helper: `${compOffUsed} used${compOffExpired ? ` · ${compOffExpired} expired` : ""}`,
      },
      {
        label: "Comp-Off Earned",
        value: compOffEarned,
        helper: `${compOffRemaining} still available`,
      },
      {
        label: "Active Staff",
        value: stats.active,
        helper: `${stats.inactive} inactive records`,
      },
    ];
  }, [activeEmployees, selectedYear, stats.active, stats.inactive, stats.total, totalElAvailed]);

  const trackMonthStart = useMemo(() => new Date(selectedYear, selectedTrackMonth, 1), [selectedTrackMonth, selectedYear]);
  const trackMonthStartKey = format(trackMonthStart, "yyyy-MM-dd");
  const trackMonthEndKey = format(endOfMonth(trackMonthStart), "yyyy-MM-dd");

  const { data: teamLeaveTrack = [], isLoading: teamLeaveTrackLoading } = useQuery({
    queryKey: ["schedule", "team-leave-track", trackMonthStartKey, trackMonthEndKey],
    ...SCHEDULE_QUERY_OPTIONS,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    queryFn: async () => {
      const { data: leaveSchedules, error: leaveSchedulesError } = await supabase
        .from("employee_schedules" as any)
        .select("employee_code")
        .eq("duty_code", "LEAVE")
        .gte("duty_date", trackMonthStartKey)
        .lte("duty_date", trackMonthEndKey);

      if (leaveSchedulesError) throw leaveSchedulesError;

      const uniqueEmployeeCodes = Array.from(
        new Set(
          ((leaveSchedules || []) as Array<{ employee_code: string | null }>).map((row) => String(row.employee_code || "").trim()).filter(Boolean),
        ),
      );

      const teamMembersByTeam = new Map<string, Set<string>>();
      TEAM_ORDER.forEach((team) => teamMembersByTeam.set(team, new Set<string>()));

      if (uniqueEmployeeCodes.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles" as any)
          .select("employee_id, current_shift")
          .in("employee_id", uniqueEmployeeCodes);

        if (profilesError) throw profilesError;

        ((profiles || []) as Array<{ employee_id: string | null; current_shift: string | null }>).forEach((profile) => {
          const employeeId = String(profile.employee_id || "").trim();
          const team = String(profile.current_shift || "").trim().toUpperCase();
          if (!employeeId || !team) return;

          const normalizedTeam = team === "GENERAL" ? "G" : team;
          if (!teamMembersByTeam.has(normalizedTeam)) {
            teamMembersByTeam.set(normalizedTeam, new Set<string>());
          }
          teamMembersByTeam.get(normalizedTeam)?.add(employeeId);
        });
      }

      const orderedTeams = [
        ...TEAM_ORDER,
        ...Array.from(teamMembersByTeam.keys())
          .filter((team) => !TEAM_ORDER.includes(team as (typeof TEAM_ORDER)[number]))
          .sort((a, b) => a.localeCompare(b)),
      ];

      return orderedTeams.map((team) => ({
        team: `Team ${team}`,
        leaveCount: teamMembersByTeam.get(team)?.size || 0,
      }));
    },
  });

  type DailyLeaveEmployee = {
    listKey: string;
    employeeCode: string;
    employeeName: string;
    team: string;
    badgeStyle: { backgroundColor: string; color: string; borderColor: string };
  };

  type DayTeamEntry = {
    team: string;
    teamKey: string;
    shiftCode: string;
    shiftLabel: string;
    onDutyCount: number;
    leaveCount: number;
  };

  const { data: dailyScheduleData, isLoading: dailyScheduleLoading } = useQuery({
    queryKey: ["schedule", "daily-combined", selectedTrackDate],
    ...SCHEDULE_QUERY_OPTIONS,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    queryFn: async () => {
      // Single query: ALL schedules for the date
      const { data: allSchedules, error } = await supabase
        .from("employee_schedules" as any)
        .select("employee_code, employee_name, duty_code")
        .eq("duty_date", selectedTrackDate);
      if (error) throw error;

      const rows = (allSchedules || []) as Array<{ employee_code: string | null; employee_name: string | null; duty_code: string | null }>;

      // ── Step A: Count raw shift tokens from ALL rows ────────────────────────
      // This is IDENTICAL to how SupervisorDashboard counts shift tokens for the
      // Duty Architecture table (shiftCounts + generalCount). No deduplication,
      // no profile lookup — just split duty_code on "+" and tally each token.
      const shiftTokenCounts: Record<string, number> = { M: 0, A: 0, N: 0, NO: 0, CO: 0 };
      let generalCount = 0;
      rows.forEach((row) => {
        const code = String(row.duty_code || "").trim().toUpperCase();
        if (!code) return;
        // Count each shift token (M, A, N, NO, CO)
        code.split("+").map((t) => t.trim()).filter(Boolean).forEach((token) => {
          if (token in shiftTokenCounts) shiftTokenCounts[token] += 1;
        });
        // Count General shift (same logic as supervisor dashboard's generalCount)
        if (getAttendanceShiftTokens(code).includes("G")) generalCount += 1;
      });

      // ── Step B: Deduplicate LEAVE rows only — for the leave list + per-team leave counts ──
      // We only need profile lookups for employees marked LEAVE.
      const leaveRowsByEmployee = new Map<string, { employee_code: string; employee_name: string | null }>();
      rows.forEach((row) => {
        const code = String(row.duty_code || "").trim().toUpperCase();
        if (code !== "LEAVE") return;
        const employeeCode = String(row.employee_code || "").trim();
        const employeeName = typeof row.employee_name === "string" ? row.employee_name.trim() : "";
        const employeeKey = employeeCode || (employeeName ? `name:${employeeName.toUpperCase()}` : "");
        if (!employeeKey || leaveRowsByEmployee.has(employeeKey)) return;
        leaveRowsByEmployee.set(employeeKey, {
          employee_code: employeeCode,
          employee_name: employeeName || null,
        });
      });

      const leaveEmployeeCodes = [...new Set(
        Array.from(leaveRowsByEmployee.values()).map((r) => r.employee_code).filter(Boolean)
      )];

      const profileMap = new Map<string, { full_name: string | null; current_shift: string | null }>();
      if (leaveEmployeeCodes.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles" as any)
          .select("employee_id, full_name, current_shift")
          .in("employee_id", leaveEmployeeCodes);
        ((profiles || []) as Array<{ employee_id: string; full_name: string | null; current_shift: string | null }>).forEach((p) => {
          profileMap.set(p.employee_id, p);
        });
      }

      // Per-team leave count and display list
      const leaveByTeam = new Map<string, number>();
      const dailyLeaveEmployees: DailyLeaveEmployee[] = [];

      Array.from(leaveRowsByEmployee.entries()).forEach(([, row]) => {
        const profile = row.employee_code ? profileMap.get(row.employee_code) : undefined;
        const rawTeam = String(profile?.current_shift || "").trim().toUpperCase();
        const team = rawTeam ? (rawTeam === "GENERAL" ? "G" : rawTeam) : "-";
        const teamColor = TEAM_COLORS[`Team ${team}`] ?? TEAM_COLOR_DEFAULT;
        leaveByTeam.set(team, (leaveByTeam.get(team) || 0) + 1);
        dailyLeaveEmployees.push({
          listKey: row.employee_code || `name:${String(row.employee_name || "").toUpperCase()}`,
          employeeCode: row.employee_code || "—",
          employeeName: profile?.full_name || row.employee_name || row.employee_code || "Unknown employee",
          team,
          badgeStyle: {
            backgroundColor: teamColor + "22",
            color: teamColor,
            borderColor: teamColor + "55",
          },
        });
      });
      dailyLeaveEmployees.sort((a, b) => a.team.localeCompare(b.team) || a.employeeName.localeCompare(b.employeeName));

      // ── Step C: Build dayTeamLeaveTrack using rotation formula + raw shift token counts ──
      // Each team's on-duty count = the raw token count for that team's rotation shift.
      // This matches Duty Architecture exactly:
      //   e.g. Team C on Morning → onDutyCount = shiftTokenCounts["M"] (same as "Morning: 55")
      const orderedTeams = [...TEAM_ORDER];

      const dayTeamLeaveTrack: DayTeamEntry[] = orderedTeams.map((team) => {
        // Determine this team's shift for the selected date via rotation formula
        const shiftCode: string = team === "G"
          ? "G"
          : (team in TODAY_TEAM_DUTY_BASE ? getTeamDutyForDate(team, selectedTrackDate) : "CO");

        // On-duty count = raw shift token count — identical to Duty Architecture table
        const onDutyCount = shiftCode === "G"
          ? generalCount
          : (shiftTokenCounts[shiftCode] || 0);

        return {
          team: `Team ${team}`,
          teamKey: team,
          shiftCode,
          shiftLabel: shiftCode === "G" ? "General" : (SHIFT_LABELS[shiftCode] ?? shiftCode),
          onDutyCount,
          leaveCount: leaveByTeam.get(team) || 0,
        };
      });

      return { dailyLeaveEmployees, dayTeamLeaveTrack };
    },
  });

  const dailyLeaveEmployees = dailyScheduleData?.dailyLeaveEmployees ?? [];
  const dayTeamLeaveTrack = dailyScheduleData?.dayTeamLeaveTrack ?? [];
  const dailyLeaveEmployeesLoading = dailyScheduleLoading;
  const dayTeamLeaveTrackLoading = dailyScheduleLoading;

  // O(1) lookup map for tooltip instead of .find() every hover
  const dayTeamMap = useMemo(
    () => new Map(dayTeamLeaveTrack.map((e) => [e.team, e])),
    [dayTeamLeaveTrack],
  );

  const dutyLeaveTooltip = useCallback(
    ({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) => {
      if (!active || !payload?.length) return null;
      const entry = label ? dayTeamMap.get(label) : undefined;
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-md text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
          <div className="mb-1.5 font-semibold text-slate-800 dark:text-white">{label}</div>
          {entry && (
            <div
              className="mb-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium"
              style={{
                backgroundColor: (SHIFT_COLORS[entry.shiftCode] ?? "#94A3B8") + "22",
                color: SHIFT_COLORS[entry.shiftCode] ?? "#64748B",
              }}
            >
              {entry.shiftLabel} shift
            </div>
          )}
          {payload.map((p) => (
            <div key={p.name} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color as string }} />
              <span className="text-slate-600 dark:text-slate-400">{p.name}:</span>
              <span className="font-semibold text-slate-900 dark:text-white">{p.value}</span>
            </div>
          ))}
        </div>
      );
    },
    [dayTeamMap],
  );

  // COMP_OFF: leave_date = duty date (when earned); leave_used_on = the actual day taken off.
  const CL_RH_CATEGORIES = ["CL", "CL_1ST", "CL_2ND", "CL_CON", "CL_1ST_CON", "CL_2ND_CON", "RH"];
  const COMP_OFF_CATEGORIES = ["COMP_OFF", "COMP_OFF_USED", "OPE_COMP_OFF", "LAST_YEAR_COMP_OFF", "LAST_YEAR_CH_DUTY", "OPE"];

  const { data: calendarLeaveRecords = [] } = useQuery({
    queryKey: ["leave-records-calendar", calendarMonthStart, calendarMonthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_leave_records" as any)
        .select("leave_date, leave_category, emp_id")
        .in("leave_category", CL_RH_CATEGORIES)
        .gte("leave_date", calendarMonthStart)
        .lte("leave_date", calendarMonthEnd);
      if (error) throw error;
      return (data || []) as Array<{ leave_date: string; leave_category: string; emp_id: string }>;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const { data: calendarCompOffRecords = [] } = useQuery({
    queryKey: ["leave-records-compoff-calendar", calendarMonthStart, calendarMonthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_leave_records" as any)
        .select("leave_used_on, leave_category, emp_id")
        .in("leave_category", COMP_OFF_CATEGORIES)
        .gte("leave_used_on", calendarMonthStart)
        .lte("leave_used_on", calendarMonthEnd)
        .not("leave_used_on", "is", null);
      if (error) throw error;
      return (data || []) as Array<{ leave_used_on: string; leave_category: string; emp_id: string }>;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const calendarGrid = useMemo(() => buildCalendarGrid(calendarDate), [calendarDate]);
  const monthLabel = format(calendarDate, "MMMM yyyy");

  const teamCalendar = useMemo(() => {
    const monthStart = startOfMonth(calendarDate);
    const monthEnd = endOfMonth(calendarDate);
    const map = new Map<string, CalendarDaySummary>();
    const counted = new Set<string>();

    function ensureDay(iso: string): CalendarDaySummary {
      if (!map.has(iso)) {
        map.set(iso, { count: 0, pending: 0, approved: 0, primaryType: "", typeCounts: {} });
      }
      return map.get(iso)!;
    }

    function addTypeToDay(iso: string, typeKey: string, empId: string, isPending: boolean, isApproved: boolean) {
      const dedupKey = `${empId}:${iso}:${typeKey}`;
      if (counted.has(dedupKey)) return;
      counted.add(dedupKey);
      const day = ensureDay(iso);
      day.count += 1;
      day.pending += isPending ? 1 : 0;
      day.approved += isApproved ? 1 : 0;
      day.typeCounts[typeKey] = (day.typeCounts[typeKey] || 0) + 1;
      if (!day.primaryType) day.primaryType = typeKey;
    }

    // employee_leave_records — CL / RH: leave_date is the actual day off
    calendarLeaveRecords.forEach((row) => {
      if (!row.leave_date || !row.emp_id) return;
      addTypeToDay(row.leave_date, resolveCalendarType(row.leave_category), row.emp_id, false, true);
    });

    // employee_leave_records — COMP_OFF: leave_used_on is the actual day taken off
    calendarCompOffRecords.forEach((row) => {
      if (!row.leave_used_on || !row.emp_id) return;
      addTypeToDay(row.leave_used_on, "COMP_OFF", row.emp_id, false, true);
    });

    // leave_requests — approval workflow (pending + approved)
    // leaveRequests is already overlap-filtered server-side, but we still exclude rejected/cancelled here.
    leaveRequests
      .filter((request) => request.status !== "Rejected" && request.status !== "Cancelled")
      .forEach((request) => {
      const start = parseISO(request.start_date);
      const end = parseISO(request.end_date);
      const rangeStart = start < monthStart ? monthStart : start;
      const rangeEnd = end > monthEnd ? monthEnd : end;
      const typeKey = resolveCalendarType(request.leave_type);
      const isPending = request.status.includes("Pending");
      const isApproved = request.status === "Approved";

      eachDayOfInterval({ start: rangeStart, end: rangeEnd }).forEach((date) => {
        addTypeToDay(format(date, "yyyy-MM-dd"), typeKey, request.employee_id, isPending, isApproved);
      });
      });

    return map;
  }, [calendarDate, calendarLeaveRecords, calendarCompOffRecords, leaveRequests]);

  const errorMessage = (loadYearlyBalances ? (leaveQuery.error as Error | null)?.message : "") || (requestsError as Error | null)?.message || "";
  const isLoading = (loadYearlyBalances ? leaveQuery.isLoading : false) || requestsLoading;

  return (
    <DashboardLayout role="supervisor">
      <div className="mx-auto w-full max-w-[1580px] space-y-4 sm:space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50 p-4 shadow-sm dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.94)_45%,rgba(8,47,73,0.9)_100%)] sm:rounded-3xl sm:p-6">
          <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-2.5 sm:gap-3">
              <div className="rounded-xl bg-blue-100 p-2.5 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200 sm:rounded-2xl sm:p-3">
                <Users className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">Supervisor Leave Dashboard</h1>
                <p className="mt-1 text-xs text-muted-foreground sm:text-base">
                  Track team leave balances, pending approvals, leave trends, and monthly activity.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="h-8 w-full text-xs sm:h-10 sm:w-[130px] sm:text-sm">
                  <CalendarDays className="mr-1.5 h-3.5 w-3.5 text-muted-foreground sm:h-4 sm:w-4" />
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button asChild className="h-8 w-full text-xs sm:h-10 sm:w-auto sm:text-sm">
                <Link to="/supervisor/leaves">Review Requests</Link>
              </Button>
              <Button asChild className="h-8 w-full bg-blue-600 text-xs text-white hover:bg-blue-700 sm:h-10 sm:w-auto sm:text-sm">
                <Link to="/supervisor/leave-discrepancy">Leave Discrepancy</Link>
              </Button>
            </div>
          </div>
        </div>

        {errorMessage && (
          <Card className="border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30">
            <CardContent className="pt-3 pb-3 text-xs text-red-800 dark:text-red-200 sm:pt-4 sm:pb-4 sm:text-sm">
              {errorMessage || "Failed to load leave data"}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          </div>
        ) : (
          <>
            <section className="space-y-2.5 sm:space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white sm:text-lg">Leave Availability</h2>
                  <p className="text-xs text-muted-foreground sm:text-sm">Team-wide balance snapshot for {selectedYear}</p>
                </div>
                {loadYearlyBalances ? (
                  <div className="hidden items-center gap-3 sm:flex">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={includePreviousYear}
                        onChange={(e) => setIncludePreviousYear(e.target.checked)}
                      />
                      Include prev year (comp-off accuracy)
                    </label>
                    <Badge variant="secondary" className="text-xs">{stats.active} active employees</Badge>
                  </div>
                ) : null}
              </div>

              {loadYearlyBalances ? (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-6">
                  {availabilityCards.map((card) => {
                    return (
                      <Card key={card.label} className="shadow-sm">
                        <CardContent className="flex items-center justify-between gap-2.5 p-3 sm:gap-4 sm:p-4">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold leading-4 tracking-tight text-slate-900 dark:text-white sm:text-lg sm:leading-5">{card.label}</div>
                            <div className="mt-1 text-[10px] leading-3.5 text-muted-foreground sm:text-xs">{card.helper}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-[34px]">
                              {card.value}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card className="shadow-sm">
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      Yearly leave balances can be heavy to compute. Load them on-demand to keep this dashboard fast.
                    </div>
                    <Button onClick={() => setLoadYearlyBalances(true)} className="sm:w-auto">
                      Load yearly balances
                    </Button>
                  </CardContent>
                </Card>
              )}
            </section>

            <div className="grid gap-3 sm:gap-4 xl:grid-cols-[1.15fr_1fr]">
              <Card className="shadow-sm">
                <CardHeader className="gap-2 px-4 pb-2 pt-4 sm:gap-3 sm:px-6 sm:pb-3 sm:pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base sm:text-lg">Employees on Leave</CardTitle>
                    <CardDescription className="text-xs sm:text-sm">
                      Staff marked LEAVE in schedule for{" "}
                      {selectedTrackDate ? format(parseISO(selectedTrackDate), "dd MMM yyyy") : "selected date"}
                      {" "}· {dailyLeaveEmployees.length} employee{dailyLeaveEmployees.length !== 1 ? "s" : ""}
                    </CardDescription>
                  </div>
                  <div className="shrink-0">
                    <input
                      type="date"
                      value={selectedTrackDate}
                      onChange={(e) => setSelectedTrackDate(e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring sm:h-9 sm:px-3 sm:text-sm"
                    />
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-2 sm:px-6 sm:pb-6 sm:pt-2">
                  {dailyLeaveEmployeesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                    </div>
                  ) : dailyLeaveEmployees.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-5 text-xs text-muted-foreground sm:px-4 sm:py-6 sm:text-sm">
                      <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      No employees marked LEAVE on this date.
                    </div>
                  ) : (
                    <div className="max-h-[280px] overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 sm:max-h-[320px]">
                      <table className="w-full text-xs sm:text-sm">
                        <thead className="sticky top-0 z-10">
                          <tr className="border-b bg-slate-50 text-[10px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 sm:text-xs">
                            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">#</th>
                            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">Name</th>
                            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">ID</th>
                            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">Team</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailyLeaveEmployees.map((emp, idx) => (
                            <tr key={emp.listKey} className="border-b last:border-0 transition-colors hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-900/70">
                              <td className="px-2.5 py-2 text-[10px] text-muted-foreground sm:px-3 sm:text-xs">{idx + 1}</td>
                              <td className="px-2.5 py-2 font-medium text-slate-900 dark:text-white sm:px-3">{emp.employeeName}</td>
                              <td className="px-2.5 py-2 font-mono text-[10px] text-slate-500 sm:px-3 sm:text-xs">{emp.employeeCode}</td>
                              <td className="px-2.5 py-2 sm:px-3">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] sm:text-xs"
                                  style={emp.badgeStyle}
                                >
                                  {emp.team !== "-" ? `Team ${emp.team}` : "-"}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="gap-2 px-4 pb-2 pt-4 sm:gap-4 sm:px-6 sm:pb-3 sm:pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base sm:text-lg">Team Leave Track</CardTitle>
                    <CardDescription className="text-xs sm:text-sm">Unique team members marked LEAVE in schedule for the selected month</CardDescription>
                  </div>
                  <div className="w-full sm:w-[180px]">
                    <Select value={String(selectedTrackMonth)} onValueChange={(value) => setSelectedTrackMonth(Number(value))}>
                      <SelectTrigger className="h-8 w-full text-xs sm:h-9 sm:text-sm">
                        <SelectValue placeholder="Month" />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTH_OPTIONS.map((month) => (
                          <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-2 sm:px-6 sm:pb-6 sm:pt-2">
                  <div className="h-[170px] w-full sm:h-[280px]">
                    {teamLeaveTrackLoading ? (
                      <div className="flex h-full items-center justify-center">
                        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={teamLeaveTrack} margin={chartMargin}>
                          <CartesianGrid strokeDasharray="4 4" stroke="#D8E4F5" vertical={false} />
                          <XAxis dataKey="team" tickLine={false} axisLine={false} fontSize={chartFontSize} />
                          <YAxis tickLine={false} axisLine={false} fontSize={chartFontSize} allowDecimals={false} width={isMobile ? 24 : 40} />
                          <Tooltip cursor={{ fill: "rgba(37, 99, 235, 0.06)" }} formatter={(value) => [`${value} members`, "On Leave"]} />
                          <Bar dataKey="leaveCount" radius={[6, 6, 0, 0]} maxBarSize={chartBarSize}>
                            {teamLeaveTrack.map((entry) => (
                              <Cell key={entry.team} fill={TEAM_COLORS[entry.team] ?? TEAM_COLOR_DEFAULT} />
                            ))}
                            <LabelList dataKey="leaveCount" position="top" fontSize={chartFontSize} fontWeight={700} fill="#1E3A8A" />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)] xl:items-start">
            <Card className="shadow-sm xl:flex xl:flex-col">
              <CardHeader className="gap-2 px-4 pb-2 pt-4 sm:gap-4 sm:px-6 sm:pb-3 sm:pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base sm:text-lg">Daily Duty vs Leave by Team</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    On-duty and on-leave counts per team for{" "}
                    {selectedTrackDate ? format(parseISO(selectedTrackDate), "dd MMM yyyy") : "selected date"}
                  </CardDescription>
                </div>
                <div className="shrink-0">
                  <input
                    type="date"
                    value={selectedTrackDate}
                    onChange={(e) => setSelectedTrackDate(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring sm:h-9 sm:px-3 sm:text-sm"
                  />
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-2 sm:px-6 sm:pb-6 sm:pt-2 xl:flex-1">
                {/* Per-team shift badges */}
                <div className="mb-2.5 flex flex-wrap gap-1.5 sm:mb-3 sm:gap-2">
                  {dayTeamLeaveTrack
                    .filter((e) => e.teamKey in TODAY_TEAM_DUTY_BASE)
                    .map((e) => (
                      <span
                        key={e.teamKey}
                        className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium sm:px-2 sm:text-xs"
                        style={{
                          backgroundColor: (SHIFT_COLORS[e.shiftCode] ?? "#94A3B8") + "22",
                          color: SHIFT_COLORS[e.shiftCode] ?? "#94A3B8",
                          borderColor: (SHIFT_COLORS[e.shiftCode] ?? "#94A3B8") + "55",
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: SHIFT_COLORS[e.shiftCode] ?? "#94A3B8" }}
                        />
                        {e.team}: {e.shiftLabel}
                      </span>
                    ))}
                </div>
                <div className="h-[190px] w-full sm:h-[300px] xl:h-[250px]">
                  {dayTeamLeaveTrackLoading ? (
                    <div className="flex h-full items-center justify-center">
                      <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={dayTeamLeaveTrack}
                        margin={isMobile ? { top: 16, right: 4, left: -24, bottom: 0 } : { top: 16, right: 8, left: -16, bottom: 0 }}
                        barCategoryGap="28%"
                        barGap={3}
                      >
                        <CartesianGrid strokeDasharray="4 4" stroke="#D8E4F5" vertical={false} />
                        <XAxis
                          dataKey="team"
                          tickLine={false}
                          axisLine={false}
                          fontSize={chartFontSize}
                          tickFormatter={(v: string) => v.replace("Team ", "")}
                        />
                        <YAxis tickLine={false} axisLine={false} fontSize={chartFontSize} allowDecimals={false} width={isMobile ? 24 : 32} />
                        <Tooltip
                          cursor={{ fill: "rgba(37, 99, 235, 0.05)" }}
                          content={dutyLeaveTooltip}
                        />
                        {/* On Duty bar — coloured by team */}
                        <Bar dataKey="onDutyCount" name="On Duty" radius={[4, 4, 0, 0]} maxBarSize={isMobile ? 18 : 28}>
                          {dayTeamLeaveTrack.map((entry) => (
                            <Cell
                              key={`duty-${entry.team}`}
                              fill={TEAM_COLORS[entry.team] ?? TEAM_COLOR_DEFAULT}
                              opacity={0.8}
                            />
                          ))}
                          <LabelList dataKey="onDutyCount" position="top" fontSize={chartFontSize - 1} fontWeight={700} fill="#1E3A8A" />
                        </Bar>
                        {/* On Leave bar — red */}
                        <Bar dataKey="leaveCount" name="On Leave" radius={[4, 4, 0, 0]} maxBarSize={isMobile ? 18 : 28}>
                          {dayTeamLeaveTrack.map((entry) => (
                            <Cell key={`leave-${entry.team}`} fill="#EF4444" opacity={0.75} />
                          ))}
                          <LabelList dataKey="leaveCount" position="top" fontSize={chartFontSize - 1} fontWeight={700} fill="#991B1B" />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                {/* Bottom legend */}
                <div className="mt-2 flex justify-center gap-4 text-[10px] text-slate-600 dark:text-slate-400 sm:gap-5 sm:text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-blue-500 opacity-80 sm:h-2.5 sm:w-2.5" />
                    On Duty
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-red-500 opacity-75 sm:h-2.5 sm:w-2.5" />
                    On Leave
                  </span>
                </div>
              </CardContent>
            </Card>

              <Card className="shadow-sm xl:flex xl:flex-col">
                <CardHeader className="gap-2 px-4 pb-2 pt-4 sm:gap-4 sm:px-6 sm:pb-3 sm:pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base sm:text-lg">Leave Calendar</CardTitle>
                    <CardDescription className="text-xs sm:text-sm">Day-by-day team leave activity for the selected month</CardDescription>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <Button variant="outline" size="icon" className="h-8 w-8 sm:h-9 sm:w-9" onClick={() => setCalendarDate((date) => subMonths(date, 1))}>
                      <ChevronLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </Button>
                    <div className="min-w-[124px] text-center text-xs font-semibold text-slate-900 dark:text-white sm:min-w-[150px] sm:text-sm">{monthLabel}</div>
                    <Button variant="outline" size="icon" className="h-8 w-8 sm:h-9 sm:w-9" onClick={() => setCalendarDate((date) => addMonths(date, 1))}>
                      <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-2 sm:px-6 sm:pb-6 sm:pt-2 xl:flex-1">
                  <div className="mb-3 flex flex-wrap gap-1.5 text-[10px] sm:mb-4 sm:gap-2 sm:text-xs">
                    {Object.entries(CALENDAR_TYPE_STYLES).map(([key, style]) => (
                      <Badge key={key} variant="secondary" className={`${style.badgeClass} px-2 py-0.5 text-[10px] sm:text-xs`}>
                        {style.legendLabel}
                      </Badge>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-slate-200 text-[10px] dark:border-slate-800 sm:rounded-2xl sm:text-sm">
                    {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => (
                      <div key={day} className="border-b bg-slate-50 px-1 py-2 text-center font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 sm:px-2 sm:py-3">
                        {day}
                      </div>
                    ))}
                    {calendarGrid.map((cell, idx) => {
                      const info = cell.iso ? teamCalendar.get(cell.iso) : undefined;
                      const typeEntries = info
                        ? Object.entries(info.typeCounts).filter(([, c]) => c > 0)
                        : [];
                      const hasSingleType = typeEntries.length === 1;
                      const singleTypeStyle = hasSingleType
                        ? CALENDAR_TYPE_STYLES[typeEntries[0][0]] || CALENDAR_TYPE_STYLES.OTHER
                        : null;
                      const isToday = cell.iso === format(new Date(), "yyyy-MM-dd");

                      return (
                        <div
                          key={`${cell.iso || "empty"}-${idx}`}
                          className={`min-h-[72px] border-b border-r p-1 align-top dark:border-slate-800 sm:min-h-[92px] sm:p-2 xl:min-h-[78px] ${cell.isCurrentMonth ? "bg-white dark:bg-slate-950/60" : "bg-slate-50/70 dark:bg-slate-900/40"} ${singleTypeStyle ? singleTypeStyle.cellClass : ""}`}
                        >
                          {cell.day ? (
                            <div className="flex h-full flex-col">
                              <div className={`text-xs font-semibold sm:text-sm ${isToday ? "text-blue-700 dark:text-blue-300" : "text-slate-700 dark:text-slate-200"}`}>{cell.day}</div>
                              {typeEntries.length > 0 ? (
                                <div className="mt-1 space-y-0.5">
                                  {typeEntries.map(([type, count]) => {
                                    const style = CALENDAR_TYPE_STYLES[type] || CALENDAR_TYPE_STYLES.OTHER;
                                    return (
                                      <Badge
                                        key={type}
                                        className={`${style.badgeClass} block w-fit px-1 py-0 text-[8px] font-semibold leading-3.5 sm:px-1.5 sm:text-[9px] sm:leading-4`}
                                      >
                                        {TYPE_SHORT_LABELS[type] ?? type} {count}
                                      </Badge>
                                    );
                                  })}
                                  {info && info.pending > 0 && (
                                    <div className="text-[8px] font-medium text-amber-700 dark:text-amber-300 sm:text-[9px]">{info.pending} pending</div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-sm">
              <CardHeader className="gap-2 px-4 pb-2 pt-4 sm:gap-4 sm:px-6 sm:pb-3 sm:pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base sm:text-lg">Employee Leave Search</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">Search an employee to view their leave requests and scheduled leaves</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-2 sm:px-6 sm:pb-6 sm:pt-2">
                <EmployeeLeaveSearch year={selectedYear} />
              </CardContent>
            </Card>

          </>
        )}
      </div>

    </DashboardLayout>
  );
}
