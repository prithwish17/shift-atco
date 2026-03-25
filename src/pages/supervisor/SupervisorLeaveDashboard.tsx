import { useEffect, useMemo, useState } from "react";
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
import { EmployeeLeaveTable } from "@/components/leave/EmployeeLeaveTable";
import { LeaveDetailsModal } from "@/components/leave/LeaveDetailsModal";
import { SearchBar } from "@/components/leave/SearchBar";
import { supabase } from "@/integrations/supabase/client";
import { getLeaveStatusInfo, getLeaveTypeLabel } from "@/lib/leaveConstants";
import { SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import type { NormalizedLeaveRecord } from "@/utils/leaveCalculations";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 3 }, (_, i) => CURRENT_YEAR - i);
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

const OFF_DUTY_CODES_SET = new Set(["NO", "CO", "SAT", "SUN", "CH", "NH", "NA", "SL", "GO", "TR", "LEAVE"]);
function isOnActiveDuty(dutyCode: string | null | undefined): boolean {
  if (!dutyCode) return false;
  const tokens = dutyCode.toUpperCase().split("+").map((t) => t.trim()).filter(Boolean);
  return tokens.length > 0 && tokens.some((t) => !OFF_DUTY_CODES_SET.has(t));
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
  const { data, leaveQuery } = useLeaveData(selectedYear);
  const { data: leaveRequests = [], isLoading: requestsLoading, error: requestsError } = useAllLeaveRequests();
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<NormalizedLeaveRecord | null>(null);
  const [calendarDate, setCalendarDate] = useState(() => startOfMonth(new Date()));
  const [selectedTrackMonth, setSelectedTrackMonth] = useState(() => new Date().getMonth());
  const [selectedTrackDate, setSelectedTrackDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [discrepancyMonth, setDiscrepancyMonth] = useState(() => new Date().getMonth());
  const [discrepancyYear, setDiscrepancyYear] = useState(CURRENT_YEAR);

  useEffect(() => {
    setCalendarDate((current) => new Date(selectedYear, current.getMonth(), 1));
  }, [selectedYear]);

  useEffect(() => {
    setSelectedTrackMonth(selectedYear === CURRENT_YEAR ? new Date().getMonth() : 0);
  }, [selectedYear]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (emp) =>
        emp.empId.toLowerCase().includes(q) ||
        emp.name.toLowerCase().includes(q)
    );
  }, [data, searchQuery]);

  const activeEmployees = useMemo(() => data.filter((emp) => emp.status === "Active"), [data]);

  const stats = useMemo(() => {
    const total = data.length;
    const active = activeEmployees.length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [activeEmployees, data]);

  const highUsageEmpIds = useMemo(() => {
    const ids = new Set<string>();
    const total = data.length;
    if (total < 3) return ids;

    const topCount = Math.max(3, Math.ceil(total * 0.1));
    const sorted = [...data].sort((a, b) => {
      if (b.usageScore !== a.usageScore) return b.usageScore - a.usageScore;
      return a.empId.localeCompare(b.empId);
    });

    sorted.slice(0, topCount).forEach((emp) => ids.add(emp.empId));
    return ids;
  }, [data]);

  const { data: totalElAvailed = 0 } = useElTotalAvailed(selectedYear);

  const availabilityCards = useMemo<AvailabilityCard[]>(() => {
    const activeCount = activeEmployees.length;
    const totalCasualAllowance = activeCount * 12;
    const totalReservedAllowance = activeCount * 2;
    const casualUsed = activeEmployees.reduce((sum, emp) => sum + emp.casualCount, 0);
    const casualRemaining = activeEmployees.reduce((sum, emp) => sum + emp.casualRemaining, 0);
    const restrictedUsed = activeEmployees.reduce((sum, emp) => sum + emp.restrictedCount, 0);
    const restrictedRemaining = Math.max(totalReservedAllowance - restrictedUsed, 0);
    const compOffRemaining = activeEmployees.reduce((sum, emp) => sum + emp.compOffRemaining, 0);
    const compOffEarned = activeEmployees.reduce((sum, emp) => sum + emp.compOffEarned, 0);
    const compOffUsed = activeEmployees.reduce((sum, emp) => sum + emp.compOffUsed, 0);
    const compOffExpired = activeEmployees.reduce((sum, emp) => sum + emp.compOffExpired, 0);

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

  const pendingApprovals = useMemo(
    () => leaveRequests.filter((request) => request.status === "Pending Supervisor" || request.status === "Pending WSO").slice(0, 5),
    [leaveRequests],
  );

  const trackMonthStart = useMemo(() => new Date(selectedYear, selectedTrackMonth, 1), [selectedTrackMonth, selectedYear]);
  const trackMonthStartKey = format(trackMonthStart, "yyyy-MM-dd");
  const trackMonthEndKey = format(endOfMonth(trackMonthStart), "yyyy-MM-dd");

  const { data: teamLeaveTrack = [], isLoading: teamLeaveTrackLoading } = useQuery({
    queryKey: ["schedule", "team-leave-track", trackMonthStartKey, trackMonthEndKey],
    ...SCHEDULE_QUERY_OPTIONS,
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
    employeeCode: string;
    employeeName: string;
    team: string;
  };

  const { data: dailyLeaveEmployees = [], isLoading: dailyLeaveEmployeesLoading } = useQuery({
    queryKey: ["schedule", "daily-leave-employees", selectedTrackDate],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async (): Promise<DailyLeaveEmployee[]> => {
      const { data: leaveSchedules, error } = await supabase
        .from("employee_schedules" as any)
        .select("employee_code, employee_name")
        .eq("duty_code", "LEAVE")
        .eq("duty_date", selectedTrackDate);

      if (error) throw error;

      const rows = (leaveSchedules || []) as Array<{ employee_code: string; employee_name: string | null }>;
      if (rows.length === 0) return [];

      const codes = [...new Set(rows.map((r) => r.employee_code).filter(Boolean))];

      const { data: profiles } = await supabase
        .from("profiles" as any)
        .select("employee_id, full_name, current_shift")
        .in("employee_id", codes);

      const profileMap = new Map(
        ((profiles || []) as Array<{ employee_id: string; full_name: string | null; current_shift: string | null }>)
          .map((p) => [p.employee_id, p]),
      );

      return rows
        .map((r) => {
          const profile = profileMap.get(r.employee_code);
          const rawTeam = profile?.current_shift?.toUpperCase() || "-";
          return {
            employeeCode: r.employee_code,
            employeeName: profile?.full_name || r.employee_name || r.employee_code,
            team: rawTeam === "GENERAL" ? "G" : rawTeam,
          };
        })
        .sort((a, b) => a.team.localeCompare(b.team) || a.employeeName.localeCompare(b.employeeName));
    },
  });

  const { data: dayTeamLeaveTrack = [], isLoading: dayTeamLeaveTrackLoading } = useQuery({
    queryKey: ["schedule", "day-team-leave-track-v3", selectedTrackDate],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      // Fetch ALL schedule rows for the selected date
      const { data: allSchedules, error } = await supabase
        .from("employee_schedules" as any)
        .select("employee_code, duty_code")
        .eq("duty_date", selectedTrackDate);
      if (error) throw error;

      const rows = (allSchedules || []) as Array<{ employee_code: string | null; duty_code: string | null }>;

      // Count per shift code exactly like SupervisorDashboard's shiftCounts
      const shiftCounts: Record<string, number> = { M: 0, A: 0, N: 0, NO: 0, CO: 0 };
      let leaveCount = 0;
      rows.forEach((s) => {
        if (!s.duty_code) return;
        const upper = s.duty_code.toUpperCase().trim();
        if (upper === "LEAVE") { leaveCount++; return; }
        const tokens = upper.split("+").map((t) => t.trim());
        tokens.forEach((t) => { if (t in shiftCounts) shiftCounts[t]++; });
      });

      // Build team → shift mapping for the selected date (same rotation logic)
      // Also count LEAVE per team via profiles
      const uniqueEmployeeCodes = [...new Set(
        rows.filter((r) => r.duty_code?.toUpperCase().trim() === "LEAVE")
          .map((r) => String(r.employee_code || "").trim())
          .filter(Boolean)
      )];

      const teamLeaveCounts = new Map<string, number>();
      TEAM_ORDER.forEach((t) => teamLeaveCounts.set(t, 0));

      if (uniqueEmployeeCodes.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles" as any)
          .select("employee_id, current_shift")
          .in("employee_id", uniqueEmployeeCodes);
        ((profiles || []) as Array<{ employee_id: string | null; current_shift: string | null }>).forEach((p) => {
          const rawTeam = String(p.current_shift || "").trim().toUpperCase();
          const team = rawTeam === "GENERAL" ? "G" : rawTeam;
          if (teamLeaveCounts.has(team)) teamLeaveCounts.set(team, (teamLeaveCounts.get(team) || 0) + 1);
        });
      }

      return TEAM_ORDER.map((team) => {
        const shiftCode = getTeamDutyForDate(team, selectedTrackDate);
        return {
          team: `Team ${team}`,
          teamKey: team,
          shiftCode,
          shiftLabel: SHIFT_LABELS[shiftCode] ?? shiftCode,
          // On-duty count = total employees with that shift duty_code (exact same number as Today's Shifts card)
          onDutyCount: shiftCounts[shiftCode] ?? 0,
          leaveCount: teamLeaveCounts.get(team) || 0,
        };
      });
    },
  });

  const calendarMonthStart = format(startOfMonth(calendarDate), "yyyy-MM-dd");
  const calendarMonthEnd = format(endOfMonth(calendarDate), "yyyy-MM-dd");

  const discrepancyMonthStart = format(new Date(discrepancyYear, discrepancyMonth, 1), "yyyy-MM-dd");
  const discrepancyMonthEnd = format(endOfMonth(new Date(discrepancyYear, discrepancyMonth, 1)), "yyyy-MM-dd");

  type DiscrepancyRow = {
    employeeCode: string;
    employeeName: string;
    team: string;
    date: string;
    kind: "schedule_no_request" | "approved_no_schedule";
    detail: string;
    leaveType: string | null;
    requestStatus: string | null;
  };

  const { data: discrepancyData = [], isLoading: discrepancyLoading } = useQuery({
    queryKey: ["leave-discrepancy", discrepancyMonthStart, discrepancyMonthEnd],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DiscrepancyRow[]> => {
      const [scheduleRes, requestRes] = await Promise.all([
        supabase
          .from("employee_schedules" as any)
          .select("employee_code, duty_date, employee_name")
          .eq("duty_code", "LEAVE")
          .gte("duty_date", discrepancyMonthStart)
          .lte("duty_date", discrepancyMonthEnd),
        supabase
          .from("leave_requests" as any)
          .select("employee_id, employee_name, leave_type, status, start_date, end_date")
          .not("status", "in", `("Rejected","Cancelled")`)
          .lte("start_date", discrepancyMonthEnd)
          .gte("end_date", discrepancyMonthStart),
      ]);

      if (scheduleRes.error) throw scheduleRes.error;
      if (requestRes.error) throw requestRes.error;

      const scheduleRows = (scheduleRes.data || []) as Array<{ employee_code: string; duty_date: string; employee_name: string | null }>;
      const requestRows = (requestRes.data || []) as Array<{ employee_id: string; employee_name: string; leave_type: string; status: string; start_date: string; end_date: string }>;

      // Fetch profiles to map auth_id <-> employee_code
      const authIds = [...new Set(requestRows.map((r) => r.employee_id))];
      const scheduleCodes = [...new Set(scheduleRows.map((r) => r.employee_code))];

      const profilesRes = authIds.length > 0
        ? await supabase
            .from("profiles" as any)
            .select("id, employee_id, full_name, current_shift")
            .in("id", authIds)
        : { data: [], error: null };
      if (profilesRes.error) throw profilesRes.error;

      const allProfileCodes = [...new Set([...scheduleCodes])];
      const scheduleProfilesRes = allProfileCodes.length > 0
        ? await supabase
            .from("profiles" as any)
            .select("id, employee_id, full_name, current_shift")
            .in("employee_id", allProfileCodes)
        : { data: [], error: null };
      if (scheduleProfilesRes.error) throw scheduleProfilesRes.error;

      type ProfileRow = { id: string; employee_id: string | null; full_name: string | null; current_shift: string | null };
      const allProfiles = [
        ...((profilesRes.data || []) as ProfileRow[]),
        ...((scheduleProfilesRes.data || []) as ProfileRow[]),
      ];
      const authToCode = new Map(allProfiles.filter((p) => p.employee_id).map((p) => [p.id, p.employee_id!]));
      const codeToProfile = new Map(allProfiles.filter((p) => p.employee_id).map((p) => [p.employee_id!, p]));

      // Build set of schedule keys: `${employee_code}:${duty_date}`
      const scheduleSet = new Set(scheduleRows.map((r) => `${r.employee_code}:${r.duty_date}`));

      // Build set of request keys (expanded to individual days)
      const requestDaySet = new Set<string>();
      type ApprovedEntry = { code: string; date: string; row: typeof requestRows[0] };
      const approvedEntries: ApprovedEntry[] = [];

      for (const req of requestRows) {
        const code = authToCode.get(req.employee_id);
        if (!code) continue;
        try {
          const days = eachDayOfInterval({ start: parseISO(req.start_date), end: parseISO(req.end_date) });
          for (const day of days) {
            const iso = format(day, "yyyy-MM-dd");
            if (iso < discrepancyMonthStart || iso > discrepancyMonthEnd) continue;
            requestDaySet.add(`${code}:${iso}`);
            if (req.status === "Approved") approvedEntries.push({ code, date: iso, row: req });
          }
        } catch {
          // skip malformed dates
        }
      }

      const rows: DiscrepancyRow[] = [];
      const seen = new Set<string>();

      // Case 1: In schedule but no request at all
      for (const sched of scheduleRows) {
        if (requestDaySet.has(`${sched.employee_code}:${sched.duty_date}`)) continue;
        const key = `${sched.employee_code}:${sched.duty_date}:schedule_no_request`;
        if (seen.has(key)) continue;
        seen.add(key);
        const profile = codeToProfile.get(sched.employee_code);
        rows.push({
          employeeCode: sched.employee_code,
          employeeName: profile?.full_name || sched.employee_name || sched.employee_code,
          team: profile?.current_shift || "-",
          date: sched.duty_date,
          kind: "schedule_no_request",
          detail: "Marked LEAVE in schedule — no matching leave request found",
          leaveType: null,
          requestStatus: null,
        });
      }

      // Case 2: Approved leave request but not in schedule
      for (const entry of approvedEntries) {
        if (scheduleSet.has(`${entry.code}:${entry.date}`)) continue;
        const key = `${entry.code}:${entry.date}:approved_no_schedule`;
        if (seen.has(key)) continue;
        seen.add(key);
        const profile = codeToProfile.get(entry.code);
        rows.push({
          employeeCode: entry.code,
          employeeName: profile?.full_name || entry.row.employee_name || entry.code,
          team: profile?.current_shift || "-",
          date: entry.date,
          kind: "approved_no_schedule",
          detail: `Approved ${entry.row.leave_type} leave — schedule not updated`,
          leaveType: entry.row.leave_type,
          requestStatus: entry.row.status,
        });
      }

      return rows.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));
    },
  });
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
    leaveRequests.forEach((request) => {
      if (request.status === "Rejected" || request.status === "Cancelled") return;

      const start = parseISO(request.start_date);
      const end = parseISO(request.end_date);
      if (end < monthStart || start > monthEnd) return;

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

  const errorMessage = (leaveQuery.error as Error | null)?.message || (requestsError as Error | null)?.message || "";
  const isLoading = leaveQuery.isLoading || requestsLoading;

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50 p-5 shadow-sm dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.94)_45%,rgba(8,47,73,0.9)_100%)] sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-blue-100 p-3 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
                <Users className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">Supervisor Leave Dashboard</h1>
                <p className="mt-1 text-sm text-muted-foreground sm:text-base">
                  Track team leave balances, pending approvals, leave trends, and monthly activity.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="h-10 w-full sm:w-[130px]">
                  <CalendarDays className="mr-1.5 h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button asChild className="w-full sm:w-auto">
                <Link to="/supervisor/leaves">Review Requests</Link>
              </Button>
              <Button asChild className="w-full bg-blue-600 text-white hover:bg-blue-700 sm:w-auto">
                <Link to="/supervisor/leave-discrepancy">Leave Discrepancy</Link>
              </Button>
            </div>
          </div>
        </div>

        {errorMessage && (
          <Card className="border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30">
            <CardContent className="pt-4 pb-4 text-sm text-red-800 dark:text-red-200">
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
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Leave Availability</h2>
                  <p className="text-sm text-muted-foreground">Team-wide balance snapshot for {selectedYear}</p>
                </div>
                <Badge variant="secondary" className="hidden sm:inline-flex">{stats.active} active employees</Badge>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                {availabilityCards.map((card) => {
                  return (
                    <Card key={card.label} className="shadow-sm">
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{card.label}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{card.helper}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[30px] font-black tracking-tight text-slate-900 dark:text-white sm:text-[34px]">
                            {card.value}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
              <Card className="shadow-sm">
                <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg">Employees on Leave</CardTitle>
                    <CardDescription>
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
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  {dailyLeaveEmployeesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                    </div>
                  ) : dailyLeaveEmployees.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                      <AlertTriangle className="h-4 w-4" />
                      No employees marked LEAVE on this date.
                    </div>
                  ) : (
                    <div className="max-h-[320px] overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10">
                          <tr className="border-b bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                            <th className="px-3 py-2.5 text-left">#</th>
                            <th className="px-3 py-2.5 text-left">Name</th>
                            <th className="px-3 py-2.5 text-left">ID</th>
                            <th className="px-3 py-2.5 text-left">Team</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailyLeaveEmployees.map((emp, idx) => (
                            <tr key={emp.employeeCode} className="border-b last:border-0 transition-colors hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-900/70">
                              <td className="px-3 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                              <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">{emp.employeeName}</td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-500">{emp.employeeCode}</td>
                              <td className="px-3 py-2">
                                <Badge
                                  variant="outline"
                                  className="text-xs"
                                  style={{
                                    backgroundColor: (TEAM_COLORS[`Team ${emp.team}`] ?? TEAM_COLOR_DEFAULT) + "22",
                                    color: TEAM_COLORS[`Team ${emp.team}`] ?? TEAM_COLOR_DEFAULT,
                                    borderColor: (TEAM_COLORS[`Team ${emp.team}`] ?? TEAM_COLOR_DEFAULT) + "55",
                                  }}
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
                <CardHeader className="gap-4 pb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg">Team Leave Track</CardTitle>
                    <CardDescription>Unique team members marked LEAVE in schedule for the selected month</CardDescription>
                  </div>
                  <div className="w-full sm:w-[180px]">
                    <Select value={String(selectedTrackMonth)} onValueChange={(value) => setSelectedTrackMonth(Number(value))}>
                      <SelectTrigger className="h-9 w-full">
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
                <CardContent>
                  <div className="h-[200px] sm:h-[280px] w-full">
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

            <Card className="shadow-sm">
              <CardHeader className="gap-4 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-lg">Daily Duty vs Leave by Team</CardTitle>
                  <CardDescription>
                    On-duty and on-leave counts per team for{" "}
                    {selectedTrackDate ? format(parseISO(selectedTrackDate), "dd MMM yyyy") : "selected date"}
                  </CardDescription>
                </div>
                <div className="shrink-0">
                  <input
                    type="date"
                    value={selectedTrackDate}
                    onChange={(e) => setSelectedTrackDate(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {/* Per-team shift badges */}
                <div className="mb-3 flex flex-wrap gap-2">
                  {dayTeamLeaveTrack
                    .filter((e) => e.teamKey in TODAY_TEAM_DUTY_BASE)
                    .map((e) => (
                      <span
                        key={e.teamKey}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
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
                <div className="h-[220px] sm:h-[300px] w-full">
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
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            const entry = dayTeamLeaveTrack.find((e) => e.team === label);
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
                          }}
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
                <div className="mt-2 flex justify-center gap-5 text-xs text-slate-600 dark:text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-blue-500 opacity-80" />
                    On Duty
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-red-500 opacity-75" />
                    On Leave
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-lg">Leave Calendar</CardTitle>
                  <CardDescription>Day-by-day team leave activity for the selected month</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => setCalendarDate((date) => subMonths(date, 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-[150px] text-center text-sm font-semibold text-slate-900 dark:text-white">{monthLabel}</div>
                  <Button variant="outline" size="icon" onClick={() => setCalendarDate((date) => addMonths(date, 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap gap-2 text-xs">
                  {Object.entries(CALENDAR_TYPE_STYLES).map(([key, style]) => (
                    <Badge key={key} variant="secondary" className={style.badgeClass}>
                      {style.legendLabel}
                    </Badge>
                  ))}
                </div>
                <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-slate-200 text-xs dark:border-slate-800 sm:text-sm">
                  {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => (
                    <div key={day} className="border-b bg-slate-50 px-2 py-3 text-center font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
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
                        className={`min-h-[92px] border-b border-r p-2 align-top dark:border-slate-800 ${cell.isCurrentMonth ? "bg-white dark:bg-slate-950/60" : "bg-slate-50/70 dark:bg-slate-900/40"} ${singleTypeStyle ? singleTypeStyle.cellClass : ""}`}
                      >
                        {cell.day ? (
                          <div className="flex h-full flex-col">
                            <div className={`text-sm font-semibold ${isToday ? "text-blue-700 dark:text-blue-300" : "text-slate-700 dark:text-slate-200"}`}>{cell.day}</div>
                            {typeEntries.length > 0 ? (
                              <div className="mt-1 space-y-0.5">
                                {typeEntries.map(([type, count]) => {
                                  const style = CALENDAR_TYPE_STYLES[type] || CALENDAR_TYPE_STYLES.OTHER;
                                  return (
                                    <Badge
                                      key={type}
                                      className={`${style.badgeClass} block w-fit px-1.5 py-0 text-[9px] font-semibold leading-4`}
                                    >
                                      {TYPE_SHORT_LABELS[type] ?? type} {count}
                                    </Badge>
                                  );
                                })}
                                {info && info.pending > 0 && (
                                  <div className="text-[9px] font-medium text-amber-700 dark:text-amber-300">{info.pending} pending</div>
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

            <Card className="shadow-sm">
              <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-lg">Employee Leave Register</CardTitle>
                  <CardDescription>Search and inspect leave usage across all employees</CardDescription>
                </div>
                <div className="w-full sm:w-[280px]">
                  <SearchBar
                    value={searchQuery}
                    onSearch={setSearchQuery}
                    placeholder="Search by name or empId"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {filtered.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    No employees found.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{filtered.length} employees</Badge>
                      <Badge variant="outline">{highUsageEmpIds.size} high usage</Badge>
                      <Badge variant="outline">{stats.active} active</Badge>
                    </div>
                    <div className="overflow-x-auto">
                      <EmployeeLeaveTable
                        employees={filtered}
                        highUsageEmpIds={highUsageEmpIds}
                        onViewDetails={setSelected}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="gap-4 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                  <div>
                    <CardTitle className="text-lg">Leave Discrepancy Report</CardTitle>
                    <CardDescription>
                      Mismatches between employee_schedules (duty_code=LEAVE) and leave_requests for{" "}
                      {MONTH_OPTIONS[discrepancyMonth]?.label} {discrepancyYear}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Select value={String(discrepancyMonth)} onValueChange={(v) => setDiscrepancyMonth(Number(v))}>
                    <SelectTrigger className="h-9 w-[130px]">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_OPTIONS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={String(discrepancyYear)} onValueChange={(v) => setDiscrepancyYear(Number(v))}>
                    <SelectTrigger className="h-9 w-[100px]">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>
                    <SelectContent>
                      {YEAR_OPTIONS.map((y) => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {discrepancyLoading ? (
                  <div className="flex h-32 items-center justify-center">
                    <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
                  </div>
                ) : discrepancyData.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                    <ShieldAlert className="h-4 w-4 text-green-600" />
                    No discrepancies found for this period. Schedule and leave records are in sync.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="destructive">{discrepancyData.length} discrepanc{discrepancyData.length === 1 ? "y" : "ies"}</Badge>
                      <Badge className="bg-orange-100 text-orange-800">
                        {discrepancyData.filter((r) => r.kind === "schedule_no_request").length} in schedule, no request
                      </Badge>
                      <Badge className="bg-blue-100 text-blue-800">
                        {discrepancyData.filter((r) => r.kind === "approved_no_schedule").length} approved, not in schedule
                      </Badge>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-900">
                            <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Date</th>
                            <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Employee</th>
                            <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Team</th>
                            <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Leave Type</th>
                            <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Discrepancy</th>
                          </tr>
                        </thead>
                        <tbody>
                          {discrepancyData.map((row, idx) => (
                            <tr
                              key={`${row.employeeCode}-${row.date}-${row.kind}`}
                              className={`border-b transition-colors dark:border-slate-800 ${
                                idx % 2 === 0 ? "bg-white dark:bg-slate-950/60" : "bg-slate-50/60 dark:bg-slate-900/40"
                              } hover:bg-slate-100/60 dark:hover:bg-slate-900/70`}
                            >
                              <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                                {format(parseISO(row.date), "dd MMM yyyy")}
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="font-medium text-slate-900 dark:text-white">{row.employeeName}</div>
                                <div className="text-xs text-muted-foreground">{row.employeeCode}</div>
                              </td>
                              <td className="px-3 py-2.5">
                                <Badge variant="secondary" className="text-xs">{row.team || "—"}</Badge>
                              </td>
                              <td className="px-3 py-2.5">
                                {row.leaveType ? (
                                  <Badge className={`text-xs ${
                                    CALENDAR_TYPE_STYLES[resolveCalendarType(row.leaveType)]?.badgeClass ||
                                    CALENDAR_TYPE_STYLES.OTHER.badgeClass
                                  }`}>
                                    {getLeaveTypeLabel(row.leaveType)}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                <Badge
                                  className={`text-xs ${
                                    row.kind === "schedule_no_request"
                                      ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
                                      : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                                  }`}
                                >
                                  {row.kind === "schedule_no_request"
                                    ? "In schedule · no request"
                                    : "Approved · not in schedule"}
                                </Badge>
                                <div className="mt-0.5 text-[11px] text-muted-foreground">{row.detail}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <LeaveDetailsModal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        record={selected}
      />
    </DashboardLayout>
  );
}
