import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Search, Clock, AlertCircle, Users, ChevronDown, ChevronUp,
  ArrowUpDown, Flame, Shield, BarChart3, RefreshCw, AlertTriangle,
  Upload, Loader2, Zap,
} from "lucide-react";
import {
  format, parseISO, startOfMonth, endOfMonth, getDaysInMonth,
  eachDayOfInterval, addDays, subDays, formatDistanceToNow,
} from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";
import { useToast } from "@/hooks/use-toast";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";



/* ──────────────────────────────────────────────────────────────
   Duty Period Limits (New Rules)
────────────────────────────────────────────────────────────── */
export const DUTY_PERIOD_LIMITS = {
  singleDuty: { hours: 12, label: "Maximum single duty period" },
  minGap: { hours: 12, label: "Minimum gap between duty periods" },
} as const;

/* ──────────────────────────────────────────────────────────────
   Cumulative Duty Limits (New Rules)
────────────────────────────────────────────────────────────── */
export const ATCO_LIMITS = {
  peak7:  { hours: 48,  label: "7-day",  windowDays: 7  },
  peak30: { hours: 190, label: "30-day", windowDays: 30 },
} as const;

/* ──────────────────────────────────────────────────────────────
   Consecutive Duty Days Limits (New Rules)
────────────────────────────────────────────────────────────── */
export const CONSECUTIVE_LIMITS = {
  maxConsecutiveDays: 6,
  minRestAfterConsecutive: 48, // hours
} as const;

/* ──────────────────────────────────────────────────────────────
   Duty code → hours mapping
────────────────────────────────────────────────────────────── */
const DUTY_HOURS_MAP: Record<string, number> = {
  M: 6, A: 6, N: 6, NO: 6,
  CO: 0, SL: 0, Tr: 0, T: 0, CH: 0, NH: 0, SAT: 0, SUN: 0, NA: 0, LEAVE: 0, L: 0,
  G: 8, GO: 8,
  "M+A": 12, "A+M": 12, "NO+N": 12,
  "CO+N": 6, "CO+A": 6, "CO+M": 6,
  "SAT+NO": 7, "SAT+N": 5,
  "SUN+N": 5, "SUN+M": 6, "SUN+A": 6, "SUN+NO": 7,
};

function getDutyHours(code: string): number {
  if (!code) return 0;
  const t = code.trim();
  return DUTY_HOURS_MAP[t] ?? DUTY_HOURS_MAP[t.toUpperCase()] ?? 0;
}

/* ──────────────────────────────────────────────────────────────
   Duty code → start time mapping (IST)
────────────────────────────────────────────────────────────── */
const DUTY_START_TIMES: Record<string, string> = {
  M: "0700",
  A: "1300",
  N: "1900",
  NO: "1900",
  "M+A": "0700",
  "A+M": "0700",
  G: "0940",
  GO: "0940",
  // Compound codes with off duty start at duty code time
  "CO+N": "1900",
  "CO+A": "1300",
  "CO+M": "0700",
  "SAT+NO": "1900",
  "SAT+N": "1900",
  "SUN+N": "1900",
  "SUN+M": "0700",
  "SUN+A": "1300",
  "SUN+NO": "1900",
  "NO+N": "1900",
};

function getDutyStartTime(code: string): string {
  if (!code) return "—";
  const t = code.trim();
  return DUTY_START_TIMES[t] ?? DUTY_START_TIMES[t.toUpperCase()] ?? "—";
}

/* colours for duty code pills */
const DUTY_COLOUR: Record<string, string> = {
  M:     "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  A:     "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  N:     "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  NO:    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  CO:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  G:     "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  GO:    "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  LEAVE: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  SL:    "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};
const DUTY_COLOUR_DEFAULT = "bg-muted text-muted-foreground";
function dutyColour(code: string) {
  return DUTY_COLOUR[code?.trim().toUpperCase()] ?? DUTY_COLOUR[code?.trim()] ?? DUTY_COLOUR_DEFAULT;
}

/* ──────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */
interface ScheduleRow {
  employee_code: string;
  employee_name: string;
  duty_date: string;
  duty_code: string;
  duty_description: string;
}

interface ProfileRow {
  employee_id: string;
  full_name: string;
  current_shift: string;
  is_hidden: boolean;
}

interface EmployeeRow {
  code: string;
  name: string;
  shift: string;
  totalHours: number;
  daysWorked: number;
  avgPerDay: number;
  limits: {
    peak7:  { hours: number; breached: boolean };
    peak30: { hours: number; breached: boolean };
  };
  consecutiveDuty: {
    maxStreak: number;
    streakViolation: boolean;
    restViolations: Array<{ startDate: string; endDate: string; restHours: number }>;
  };
  dailySchedule: Array<{ date: string; duty_code: string; hours: number }>;
}

type SortKey = "name" | "hours" | "days" | "avg" | "peak7";
type SortDir  = "asc" | "desc";

/* ──────────────────────────────────────────────────────────────
   Client-side peak-window calculation (fallback path)
────────────────────────────────────────────────────────────── */
function calcPeakInWindow(
  hoursByDate: Map<string, number>,
  earliestDate: string,
  latestDate: string,
  windowDays: number,
): number {
  if (hoursByDate.size === 0) return 0;
  let maxHours = 0;
  let cursor = parseISO(earliestDate);
  const lastStart = parseISO(latestDate);

  while (cursor <= lastStart) {
    let wh = 0;
    for (let d = 0; d < windowDays; d++) {
      const dayStr = format(addDays(cursor, d), "yyyy-MM-dd");
      wh += (hoursByDate.get(dayStr) ?? 0);
    }
    if (wh > maxHours) maxHours = wh;
    cursor = addDays(cursor, 1);
  }
  return maxHours;
}

/* ──────────────────────────────────────────────────────────────
   Calculate consecutive duty days violations
────────────────────────────────────────────────────────────── */
function calcConsecutiveDuty(allSchedules: ScheduleRow[]) {
  if (!allSchedules.length) {
    return {
      maxStreak: 0,
      streakViolation: false,
      restViolations: [] as Array<{ startDate: string; endDate: string; restHours: number }>,
    };
  }

  // Sort by date
  const sorted = [...allSchedules].sort((a, b) => a.duty_date.localeCompare(b.duty_date));
  
  // Group hours by date
  const hoursByDate = new Map<string, number>();
  sorted.forEach(row => {
    const existing = hoursByDate.get(row.duty_date) || 0;
    hoursByDate.set(row.duty_date, existing + getDutyHours(row.duty_code));
  });

  // Get unique sorted dates
  const uniqueDates = Array.from(hoursByDate.keys()).sort();
  
  let maxStreak = 0;
  let currentStreak = 0;
  let streakStartDate = "";
  const restViolations: Array<{ startDate: string; endDate: string; restHours: number }> = [];

  for (let i = 0; i < uniqueDates.length; i++) {
    const date = uniqueDates[i];
    const hours = hoursByDate.get(date) || 0;
    const isWorkingDay = hours > 0;

    if (isWorkingDay) {
      if (currentStreak === 0) {
        streakStartDate = date;
      }
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      // End of streak - check if we need minimum rest
      if (currentStreak >= CONSECUTIVE_LIMITS.maxConsecutiveDays) {
        // Calculate rest hours (assume 24h per off day)
        const restDays = 1; // This is the current off day
        const restHours = restDays * 24;
        if (restHours < CONSECUTIVE_LIMITS.minRestAfterConsecutive) {
          restViolations.push({
            startDate: streakStartDate,
            endDate: uniqueDates[i - 1],
            restHours,
          });
        }
      }
      currentStreak = 0;
    }
  }

  // Check if streak ends at the end of period
  if (currentStreak >= CONSECUTIVE_LIMITS.maxConsecutiveDays) {
    // Can't determine rest - mark as potential violation
  }

  return {
    maxStreak,
    streakViolation: maxStreak > CONSECUTIVE_LIMITS.maxConsecutiveDays,
    restViolations,
  };
}

function calcLimits(allSchedules: ScheduleRow[]) {
  if (!allSchedules.length) {
    return {
      peak7:  { hours: 0, breached: false },
      peak30: { hours: 0, breached: false },
    };
  }
  const hoursByDate = new Map<string, number>();
  for (const row of allSchedules) {
    hoursByDate.set(row.duty_date, getDutyHours(row.duty_code));
  }
  const sorted = [...allSchedules].sort((a, b) => a.duty_date.localeCompare(b.duty_date));
  const earliestDate = sorted[0].duty_date;
  const latestDate   = sorted[sorted.length - 1].duty_date;

  const p7  = calcPeakInWindow(hoursByDate, earliestDate, latestDate, 7);
  const p30 = calcPeakInWindow(hoursByDate, earliestDate, latestDate, 30);

  return {
    peak7:  { hours: p7,  breached: p7  > ATCO_LIMITS.peak7.hours  },
    peak30: { hours: p30, breached: p30 > ATCO_LIMITS.peak30.hours },
  };
}

/* ──────────────────────────────────────────────────────────────
   Fallback: build EmployeeRow[] from raw schedule + profile data
   (original approach — always works, just slower)
────────────────────────────────────────────────────────────── */
function buildFromRaw(
  allSchedules: ScheduleRow[],
  profiles: ProfileRow[],
  monthStart: string,
  monthEnd: string,
): EmployeeRow[] {
  if (!allSchedules.length) return [];

  const profileMap = new Map<string, ProfileRow>();
  profiles.forEach(p => {
    if (p.employee_id) profileMap.set(p.employee_id.trim().toUpperCase(), p);
  });

  const monthSchedules = allSchedules.filter(
    s => s.duty_date >= monthStart && s.duty_date <= monthEnd,
  );

  const groupedAll = new Map<string, ScheduleRow[]>();
  allSchedules.forEach(s => {
    const key = s.employee_code?.trim();
    if (!key) return;
    if (!groupedAll.has(key)) groupedAll.set(key, []);
    groupedAll.get(key)!.push(s);
  });

  const groupedMonth = new Map<string, ScheduleRow[]>();
  monthSchedules.forEach(s => {
    const key = s.employee_code?.trim();
    if (!key) return;
    if (!groupedMonth.has(key)) groupedMonth.set(key, []);
    groupedMonth.get(key)!.push(s);
  });

  const rows: EmployeeRow[] = [];
  groupedAll.forEach((empAll, code) => {
    const profile = profileMap.get(code.toUpperCase());
    if (profile?.is_hidden) return;

    const empMonth = groupedMonth.get(code) ?? [];
    const monthSorted = [...empMonth].sort((a, b) => a.duty_date.localeCompare(b.duty_date));

    const name       = profile?.full_name || empAll[0]?.employee_name || code;
    const shift      = profile?.current_shift || "—";
    const totalHours = monthSorted.reduce((s, r) => s + getDutyHours(r.duty_code), 0);
    const daysWorked = monthSorted.filter(r => getDutyHours(r.duty_code) > 0).length;
    const avgPerDay  = daysWorked > 0 ? Math.round((totalHours / daysWorked) * 10) / 10 : 0;
    const limits     = calcLimits(empAll);
    const consecutiveDuty = calcConsecutiveDuty(empAll);

    rows.push({
      code, name, shift, totalHours, daysWorked, avgPerDay, limits, consecutiveDuty,
      dailySchedule: monthSorted.map(s => ({
        date: s.duty_date,
        duty_code: s.duty_code,
        hours: getDutyHours(s.duty_code),
      })),
    });
  });
  return rows;
}

/* ──────────────────────────────────────────────────────────────
   DayGrid — expanded row per employee
────────────────────────────────────────────────────────────── */
interface DayGridProps {
  row: EmployeeRow;
  monthStart: string;
  monthEnd: string;
  daysInMonth: number;
}

function DayGrid({ row, monthStart, monthEnd, daysInMonth }: DayGridProps) {
  const byDate = useMemo(() => {
    const m = new Map<string, { duty_code: string; hours: number }>();
    row.dailySchedule.forEach(s => m.set(s.date, s));
    return m;
  }, [row.dailySchedule]);

  const days = useMemo(
    () => eachDayOfInterval({ start: parseISO(monthStart), end: parseISO(monthEnd) }),
    [monthStart, monthEnd],
  );

  const theoreticalMax = daysInMonth * 6;
  const fillPct = theoreticalMax > 0
    ? Math.min((row.totalHours / theoreticalMax) * 100, 100)
    : 0;

  const anyBreach = row.limits.peak7.breached || row.limits.peak30.breached || row.consecutiveDuty.streakViolation;

  return (
    <div className="mt-2 space-y-3">
      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          { label: "Total Hours",  value: `${row.totalHours}h` },
          { label: "Days Worked",  value: `${row.daysWorked}d` },
          { label: "Avg hrs/day",  value: `${row.avgPerDay}h` },
          { label: "Peak 7-day",   value: `${row.limits.peak7.hours}h`, alert: row.limits.peak7.breached },
          { label: "Max Streak", value: `${row.consecutiveDuty.maxStreak}d`, alert: row.consecutiveDuty.streakViolation },
        ] as { label: string; value: string; alert?: boolean }[]).map(s => (
          <div
            key={s.label}
            className={`rounded-lg p-2 text-center ${s.alert ? "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800" : "bg-muted/60"}`}
          >
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-sm font-bold ${s.alert ? "text-red-600 dark:text-red-400" : ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Duty limit violation panel */}
      {anyBreach && (
        <div className="flex flex-wrap gap-2">
          {row.limits.peak7.breached && (
            <div className="flex items-center gap-1.5 text-xs rounded-md bg-red-100 dark:bg-red-950/50 border border-red-300 dark:border-red-700 px-2.5 py-1.5 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              7-day limit: {row.limits.peak7.hours}h / {ATCO_LIMITS.peak7.hours}h
            </div>
          )}
          {row.limits.peak30.breached && (
            <div className="flex items-center gap-1.5 text-xs rounded-md bg-red-100 dark:bg-red-950/50 border border-red-300 dark:border-red-700 px-2.5 py-1.5 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              30-day limit: {row.limits.peak30.hours}h / {ATCO_LIMITS.peak30.hours}h
            </div>
          )}
          {row.consecutiveDuty.streakViolation && (
            <div className="flex items-center gap-1.5 text-xs rounded-md bg-orange-100 dark:bg-orange-950/50 border border-orange-300 dark:border-orange-700 px-2.5 py-1.5 text-orange-700 dark:text-orange-400">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              Consecutive duty: {row.consecutiveDuty.maxStreak}d / {CONSECUTIVE_LIMITS.maxConsecutiveDays}d max
            </div>
          )}
          {row.consecutiveDuty.restViolations.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs rounded-md bg-orange-100 dark:bg-orange-950/50 border border-orange-300 dark:border-orange-700 px-2.5 py-1.5 text-orange-700 dark:text-orange-400">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              Rest violation: &lt; {CONSECUTIVE_LIMITS.minRestAfterConsecutive}h rest
            </div>
          )}
        </div>
      )}

      {/* Day-by-day grid */}
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-px min-w-max">
          {days.map(day => {
            const dateStr = format(day, "yyyy-MM-dd");
            const s = byDate.get(dateStr);
            const code = s?.duty_code || "";
            const hrs  = s?.hours ?? getDutyHours(code);
            const isWeekend = [0, 6].includes(day.getDay());
            return (
              <div
                key={dateStr}
                title={`${format(day, "EEE d MMM")}: ${code || "No data"} · ${hrs}h`}
                className={`flex flex-col items-center gap-0.5 rounded-sm px-1 py-1 min-w-[26px] cursor-default ${isWeekend ? "opacity-50" : ""} ${!code ? "opacity-25" : ""}`}
              >
                <span className="text-[9px] text-muted-foreground leading-none">{format(day, "d")}</span>
                <div
                  className={`w-5 h-5 rounded-sm flex items-center justify-center text-[9px] font-bold ${
                    code ? dutyColour(code) : "bg-muted/40 text-transparent"
                  }`}
                >
                  {code ? code.slice(0, 2) : "·"}
                </div>
                <span className="text-[8px] leading-none text-muted-foreground">
                  {hrs > 0 ? `${hrs}h` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Utilisation bar */}
      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Monthly utilisation</span>
          <span>{row.totalHours}h / {theoreticalMax}h theoretical max</span>
        </div>
        <Progress value={fillPct} className="h-1.5" />
      </div>

      {/* Limit mini-bars */}
      <div className="grid grid-cols-2 gap-2">
        {([
          { label: "7-day",  limit: ATCO_LIMITS.peak7.hours,  actual: row.limits.peak7.hours,  breached: row.limits.peak7.breached },
          { label: "30-day", limit: ATCO_LIMITS.peak30.hours, actual: row.limits.peak30.hours, breached: row.limits.peak30.breached },
        ]).map(l => (
          <div key={l.label} className={`rounded-md p-2 border ${l.breached ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30" : "border-border bg-muted/30"}`}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">{l.label} limit</span>
              <span className={`font-medium ${l.breached ? "text-red-600 dark:text-red-400" : ""}`}>
                {l.actual}h / {l.limit}h
              </span>
            </div>
            <Progress
              value={Math.min((l.actual / l.limit) * 100, 100)}
              className={`h-1 ${l.breached ? "[&>div]:bg-red-500" : ""}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   SortIcon helper
────────────────────────────────────────────────────────────── */
function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
  return dir === "asc"
    ? <ChevronUp className="ml-1 h-3 w-3 text-primary" />
    : <ChevronDown className="ml-1 h-3 w-3 text-primary" />;
}

/* ──────────────────────────────────────────────────────────────
   Main page component
────────────────────────────────────────────────────────────── */
export default function WorkingHours() {
  const [searchTerm,    setSearchTerm]    = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [selectedShift, setSelectedShift] = useState("all");
  const [sortKey,  setSortKey]  = useState<SortKey>("hours");
  const [sortDir,  setSortDir]  = useState<SortDir>("desc");
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isForceRefreshing, setIsForceRefreshing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /* ── Derived date bounds ── */
  const { monthStart, monthEnd, daysInMonth: numDays, queryStart, queryEnd } = useMemo(() => {
    const d = new Date(`${selectedMonth}-01`);
    const start = startOfMonth(d);
    const end   = endOfMonth(d);
    return {
      monthStart:  format(start, "yyyy-MM-dd"),
      monthEnd:    format(end,   "yyyy-MM-dd"),
      daysInMonth: getDaysInMonth(d),
      queryStart:  format(subDays(start, 29), "yyyy-MM-dd"),
      queryEnd:    format(addDays(end,   29), "yyyy-MM-dd"),
    };
  }, [selectedMonth]);

  /* ────────────────────────────────────────────────────────────
     Data fetching — Redis + cache-first strategy:
     1. Check Redis cache (20min TTL, multi-user)
     2. Read from working_hours_cache table (instant, ~5ms)
     3. If cache is empty, fall back to live RPC
     4. If RPC fails, fall back to client-side computation
  ─────────────────────────────────────────────────────────── */
  const {
    data: queryResult,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["working-hours-data", selectedMonth],
    queryFn: async (): Promise<{ rows: EmployeeRow[]; computedAt: string | null; source: "cache" | "rpc" | "fallback" | "cache_table" | "redis" }> => {
      // Try the new Redis-cached API route first
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        const response = await fetch(`/api/working-hours?month=${selectedMonth}`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });

        if (response.ok) {
          const result = await response.json();
          
          // Transform the data to match EmployeeRow format
          const rows: EmployeeRow[] = result.rows.map((r: any) => ({
            code: r.employee_code || r.code,
            name: r.employee_name || r.name || r.employee_code || r.code,
            shift: r.current_shift || r.shift || "—",
            totalHours: r.total_hours ?? r.totalHours ?? 0,
            daysWorked: r.days_worked ?? r.daysWorked ?? 0,
            avgPerDay: Number(r.avg_per_day ?? r.avgPerDay) || 0,
            limits: {
              peak7: { 
                hours: r.peak_7d_hours ?? r.limits?.peak7?.hours ?? 0, 
                breached: !!(r.peak_7d_breached ?? r.limits?.peak7?.breached) 
              },
              peak30: { 
                hours: r.peak_30d_hours ?? r.limits?.peak30?.hours ?? 0, 
                breached: !!(r.peak_30d_breached ?? r.limits?.peak30?.breached) 
              },
            },
            consecutiveDuty: {
              maxStreak: r.max_streak ?? r.consecutiveDuty?.maxStreak ?? 0,
              streakViolation: !!(r.streak_violation ?? r.consecutiveDuty?.streakViolation),
              restViolations: r.rest_violations ?? r.consecutiveDuty?.restViolations ?? [],
            },
            dailySchedule: r.daily_schedule || r.dailySchedule || [],
          }));

          return { 
            rows, 
            computedAt: result.computedAt, 
            source: result.source === 'cache_table' ? 'cache_table' : 'redis' 
          };
        }
      } catch (err) {
        console.warn('[working-hours] API call failed, falling back:', err);
      }

      // Fallback to direct Supabase queries if API fails
      // ── Fast path: read from cache table ────────────────────
      try {
        const { data: cacheData, error: cacheError } = await (supabase as any)
          .from("working_hours_cache")
          .select("*")
          .eq("month", selectedMonth);

        if (!cacheError && cacheData && cacheData.length > 0) {
          const computedAt = cacheData[0]?.computed_at || null;
          const rows: EmployeeRow[] = cacheData.map((r: any) => ({
            code: r.employee_code,
            name: r.employee_name || r.employee_code,
            shift: r.current_shift || "—",
            totalHours: r.total_hours ?? 0,
            daysWorked: r.days_worked ?? 0,
            avgPerDay:  Number(r.avg_per_day) || 0,
            limits: {
              peak7:  { hours: r.peak_7d_hours  ?? 0, breached: !!r.peak_7d_breached  },
              peak30: { hours: r.peak_30d_hours ?? 0, breached: !!r.peak_30d_breached },
            },
            consecutiveDuty: {
              maxStreak: r.max_streak ?? 0,
              streakViolation: !!r.streak_violation,
              restViolations: r.rest_violations ?? [],
            },
            dailySchedule: r.daily_schedule || [],
          }));
          return { rows, computedAt, source: "cache" };
        }
      } catch {
        // Cache table might not exist yet — fall through
      }

      // ── Medium path: live RPC ───────────────────────────────
      try {
        const { data: rpcData, error: rpcError } = await (supabase as any)
          .rpc("get_working_hours_summary", { p_month: selectedMonth });

        if (!rpcError && rpcData && rpcData.length > 0) {
          const rows: EmployeeRow[] = rpcData.map((r: any) => ({
            code: r.employee_code,
            name: r.employee_name,
            shift: r.current_shift || "—",
            totalHours: r.total_hours ?? 0,
            daysWorked: r.days_worked ?? 0,
            avgPerDay:  Number(r.avg_per_day) || 0,
            limits: {
              peak7:  { hours: r.peak_7d_hours  ?? 0, breached: !!r.peak_7d_breached  },
              peak30: { hours: r.peak_30d_hours ?? 0, breached: !!r.peak_30d_breached },
            },
            consecutiveDuty: {
              maxStreak: r.max_streak ?? 0,
              streakViolation: !!r.streak_violation,
              restViolations: r.rest_violations ?? [],
            },
            dailySchedule: r.daily_schedule || [],
          }));
          return { rows, computedAt: null, source: "rpc" };
        }
      } catch {
        // Fall through to client-side computation
      }

      // ── Slow fallback: paginated query + client computation ─
      const PAGE_SIZE = 1000;
      let allRows: ScheduleRow[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from("employee_schedules")
          .select("employee_code, employee_name, duty_date, duty_code, duty_description")
          .gte("duty_date", queryStart)
          .lte("duty_date", queryEnd)
          .order("duty_date")
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;

        const rows = (data || []) as ScheduleRow[];
        allRows = allRows.concat(rows);
        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      const { data: profData, error: profError } = await supabase
        .from("profiles")
        .select("employee_id, full_name, current_shift, is_hidden");
      if (profError) throw profError;
      const profiles = (profData || []) as unknown as ProfileRow[];

      const built = buildFromRaw(allRows, profiles, monthStart, monthEnd);
      return { rows: built, computedAt: null, source: "fallback" };
    },
    staleTime: 5 * 60_000, // 5 minutes (backend has 20min Redis cache)
    gcTime: 10 * 60_000, // 10 minutes
  });

  const employeeRows = queryResult?.rows ?? [];
  const computedAt = queryResult?.computedAt ?? null;
  const dataSource = queryResult?.source ?? null;

  /* ── Force Refresh — triggers the edge function then re-fetches cache ── */
  async function forceRefresh() {
    setIsForceRefreshing(true);
    try {
      // Try direct edge function invocation first
      let success = false;
      try {
        const { error } = await supabase.functions.invoke("refresh-working-hours", { body: {} });
        if (!error) success = true;
      } catch {
        // Fall through to proxy
      }

      // Fallback: retry via proxy
      if (!success) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const base = getFunctionsProxyBaseUrl();
          await fetch(`${base}/api/functions/refresh-working-hours`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          });
        }
      }

      // Re-fetch from cache after refresh
      await queryClient.invalidateQueries({ queryKey: ["working-hours-data", selectedMonth] });
      toast({ title: "Data refreshed", description: "Working hours cache has been updated with the latest data." });
    } catch (err: any) {
      toast({
        title: "Refresh failed",
        description: err?.message || "Unable to refresh. The data shown may be from the last cache.",
        variant: "destructive",
      });
    } finally {
      setIsForceRefreshing(false);
    }
  }

  /* ── Available shifts ── */
  const shifts = useMemo(() => {
    const set = new Set<string>();
    employeeRows.forEach(r => { if (r.shift && r.shift !== "—") set.add(r.shift); });
    return ["all", ...Array.from(set).sort()];
  }, [employeeRows]);

  /* ── Summary stats ── */
  const stats = useMemo(() => {
    const base = selectedShift === "all"
      ? employeeRows
      : employeeRows.filter(r => r.shift === selectedShift);
    const total  = base.reduce((s, r) => s + r.totalHours, 0);
    const avg    = base.length > 0 ? Math.round((total / base.length) * 10) / 10 : 0;
    const peak7m = base.length > 0 ? Math.max(...base.map(r => r.limits.peak7.hours)) : 0;
    const violations = base.filter(r =>
      r.limits.peak7.breached || r.limits.peak30.breached || r.consecutiveDuty.streakViolation
    ).length;
    const consecutiveViolations = base.filter(r => r.consecutiveDuty.streakViolation).length;
    return { total, avg, peak7Max: peak7m, count: base.length, violations, consecutiveViolations };
  }, [employeeRows, selectedShift]);

  /* ── Filter + sort ── */
  const displayRows = useMemo(() => {
    let rows = selectedShift === "all"
      ? employeeRows
      : employeeRows.filter(r => r.shift === selectedShift);

    if (searchTerm.trim()) {
      const t = searchTerm.toLowerCase();
      rows = rows.filter(r =>
        r.name.toLowerCase().includes(t) || r.code.toLowerCase().includes(t)
      );
    }

    return [...rows].sort((a, b) => {
      let d = 0;
      if      (sortKey === "name")  d = a.name.localeCompare(b.name);
      else if (sortKey === "hours") d = a.totalHours - b.totalHours;
      else if (sortKey === "days")  d = a.daysWorked - b.daysWorked;
      else if (sortKey === "avg")   d = a.avgPerDay  - b.avgPerDay;
      else if (sortKey === "peak7") d = a.limits.peak7.hours - b.limits.peak7.hours;
      return sortDir === "asc" ? d : -d;
    });
  }, [employeeRows, selectedShift, searchTerm, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  /* ── Fetch the export webapp URL from admin settings ── */
  const { data: exportWebappUrl = "" } = useQuery({
    queryKey: ["app-settings", "working_hours_export_webapp_url"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("value")
        .eq("key", "working_hours_export_webapp_url")
        .maybeSingle();
      if (error) throw error;
      return (data as any)?.value || "";
    },
    staleTime: 5 * 60_000,
  });

  /* ── Export computed data to Google Sheet webapp ── */
  async function exportToSheet() {
    if (!exportWebappUrl) {
      toast({
        title: "Export URL not configured",
        description: "Ask the admin to set the Working Hours Export Webapp URL in Admin Settings.",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      const payload = {
        month: selectedMonth,
        monthStart,
        monthEnd,
        exportedAt: new Date().toISOString(),
        summary: {
          employeeCount: stats.count,
          totalHours: stats.total,
          avgPerPerson: stats.avg,
          peak7DayMax: stats.peak7Max,
          violations: stats.violations,
        },
        limits: {
          singleDuty: DUTY_PERIOD_LIMITS.singleDuty.hours,
          minGap: DUTY_PERIOD_LIMITS.minGap.hours,
          sevenDay:   ATCO_LIMITS.peak7.hours,
          thirtyDay:  ATCO_LIMITS.peak30.hours,
          maxConsecutiveDays: CONSECUTIVE_LIMITS.maxConsecutiveDays,
          minRestAfterConsecutive: CONSECUTIVE_LIMITS.minRestAfterConsecutive,
        },
        employees: displayRows.map(row => ({
          employeeCode: row.code,
          employeeName: row.name,
          shift: row.shift,
          totalHours: row.totalHours,
          daysWorked: row.daysWorked,
          avgHoursPerDay: row.avgPerDay,
          peak7Day:   row.limits.peak7.hours,
          peak30Day:  row.limits.peak30.hours,
          peak7DayBreached:  row.limits.peak7.breached,
          peak30DayBreached: row.limits.peak30.breached,
          maxConsecutiveStreak: row.consecutiveDuty.maxStreak,
          consecutiveStreakViolation: row.consecutiveDuty.streakViolation,
          restViolations: row.consecutiveDuty.restViolations,
          dailySchedule: row.dailySchedule.map(s => ({
            date: s.date,
            dutyCode: s.duty_code,
            hours: s.hours,
          })),
        })),
      };

      await fetch(exportWebappUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload),
        mode: "no-cors",
      });

      toast({
        title: "Export sent",
        description: `Sent ${displayRows.length} employee records for ${selectedMonth} to Google Sheet.`,
      });
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err?.message || "Unable to reach the export URL. Check the admin setting.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }

  /* ────────────────────────────────────────────────────────────
     Render
  ─────────────────────────────────────────────────────────── */
  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-5 max-w-[1400px]">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Clock className="h-6 w-6 text-primary" />
              Working Hours Analysis
            </h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p className="text-sm text-muted-foreground">
                ATCO duty hours — checked against regulatory limits
              </p>
              {computedAt && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 font-normal text-muted-foreground">
                  <Clock className="h-2.5 w-2.5" />
                  {formatDistanceToNow(new Date(computedAt), { addSuffix: true })}
                </Badge>
              )}
              {dataSource && dataSource !== "cache" && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal">
                  {dataSource === "rpc" ? "live" : "computed"}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button
              variant="outline" size="sm"
              className="gap-2"
              onClick={exportToSheet}
              disabled={isExporting || isLoading || displayRows.length === 0}
              title={!exportWebappUrl ? "Export URL not configured in admin settings" : "Export to Google Sheet"}
            >
              {isExporting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Upload className="h-3.5 w-3.5" />}
              Export to Sheet
            </Button>
            <Button
              variant="outline" size="sm"
              className="gap-2"
              onClick={forceRefresh}
              disabled={isForceRefreshing || isRefetching}
              title="Recompute working hours from latest schedule data"
            >
              {isForceRefreshing
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Zap className="h-3.5 w-3.5" />}
              Force Refresh
            </Button>
            <Button
              variant="outline" size="sm"
              className="gap-2"
              onClick={() => refetch()}
              disabled={isRefetching}
              title="Re-read from cache"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
              Reload
            </Button>
          </div>
        </div>

        {/* ── Duty Period Limits Banner ── */}
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/20">
          <CardContent className="pt-4 pb-3 px-5">
            <div className="flex items-start gap-2.5">
              <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2 uppercase tracking-wide">
                  Duty Period Limits
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex items-center gap-2 rounded-md bg-white/70 dark:bg-white/5 border border-blue-200 dark:border-blue-800 px-3 py-2">
                    <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <span className="text-xs text-foreground">
                      Max <strong>12 hours</strong> single duty
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-md bg-white/70 dark:bg-white/5 border border-blue-200 dark:border-blue-800 px-3 py-2">
                    <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <span className="text-xs text-foreground">
                      Min <strong>12 hours</strong> gap between duties
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-md bg-white/70 dark:bg-white/5 border border-blue-200 dark:border-blue-800 px-3 py-2">
                    <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <span className="text-xs text-foreground">
                      Max <strong>48 hours</strong> in 7 days
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-md bg-white/70 dark:bg-white/5 border border-blue-200 dark:border-blue-800 px-3 py-2">
                    <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <span className="text-xs text-foreground">
                      Max <strong>190 hours</strong> in 30 days
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Consecutive Duty Rules Banner ── */}
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20">
          <CardContent className="pt-4 pb-3 px-5">
            <div className="flex items-start gap-2.5">
              <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2 uppercase tracking-wide">
                  Consecutive Duty Rules
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="flex items-center gap-2 rounded-md bg-white/70 dark:bg-white/5 border border-amber-200 dark:border-amber-800 px-3 py-2">
                    <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <span className="text-xs text-foreground">
                      Max <strong>6 consecutive</strong> duty days
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-md bg-white/70 dark:bg-white/5 border border-amber-200 dark:border-amber-800 px-3 py-2">
                    <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <span className="text-xs text-foreground">
                      Min <strong>48 hours</strong> rest after consecutive duty
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Filters ── */}
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="grid gap-4 sm:grid-cols-3">

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Month</label>
                <Input
                  type="month"
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Shift / Team</label>
                <Select
                  key={shifts.join(",")}
                  value={selectedShift}
                  onValueChange={setSelectedShift}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="All shifts" />
                  </SelectTrigger>
                  <SelectContent>
                    {shifts.map(s => (
                      <SelectItem key={s} value={s}>
                        {s === "all" ? "All Shifts" : `Shift ${s}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Search Employee</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Name or code…"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              </div>

            </div>
          </CardContent>
        </Card>

        {/* ── Summary stat cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          {([
            {
              label: "Employees",
              value: isLoading ? "…" : stats.count,
              icon: <Users className="h-4 w-4 text-violet-500" />,
            },
            {
              label: "Total Hours",
              value: isLoading ? "…" : `${stats.total}h`,
              icon: <Clock className="h-4 w-4 text-blue-500" />,
            },
            {
              label: "Avg / Person",
              value: isLoading ? "…" : `${stats.avg}h`,
              icon: <BarChart3 className="h-4 w-4 text-emerald-500" />,
            },
            {
              label: "Peak 7-day",
              value: isLoading ? "…" : `${stats.peak7Max}h`,
              icon: <Flame className={`h-4 w-4 ${stats.peak7Max > ATCO_LIMITS.peak7.hours ? "text-red-500" : "text-amber-500"}`} />,
              alert: !isLoading && stats.peak7Max > ATCO_LIMITS.peak7.hours,
            },
            {
              label: "Limit Violations",
              value: isLoading ? "…" : stats.violations,
              icon: <AlertTriangle className={`h-4 w-4 ${stats.violations > 0 ? "text-red-500" : "text-muted-foreground"}`} />,
              alert: !isLoading && stats.violations > 0,
            },
            {
              label: "Consecutive Violations",
              value: isLoading ? "…" : stats.consecutiveViolations,
              icon: <AlertTriangle className={`h-4 w-4 ${stats.consecutiveViolations > 0 ? "text-orange-500" : "text-muted-foreground"}`} />,
              alert: !isLoading && stats.consecutiveViolations > 0,
            },
          ] as { label: string; value: string | number; icon: React.ReactNode; alert?: boolean }[]).map(st => (
            <Card
              key={st.label}
              className={`py-3 ${st.alert ? "border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/20" : ""}`}
            >
              <CardContent className="px-4 py-0 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">{st.label}</p>
                  <p className={`text-xl font-bold leading-tight ${st.alert ? "text-red-600 dark:text-red-400" : ""}`}>
                    {st.value}
                  </p>
                </div>
                {st.icon}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Violations Detail Card ── */}
        {!isLoading && stats.violations > 0 && (
          <Card className="border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20">
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                Employees Who Crossed Limits ({stats.violations})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {displayRows
                  .filter(r => r.limits.peak7.breached || r.limits.peak30.breached || r.consecutiveDuty.streakViolation)
                  .flatMap(r => {
                    const violations: Array<{ name: string; code: string; limit: string; date?: string; actual: number; limitVal: number }> = [];
                    if (r.limits.peak7.breached) {
                      violations.push({ name: r.name, code: r.code, limit: "7-day", actual: r.limits.peak7.hours, limitVal: ATCO_LIMITS.peak7.hours });
                    }
                    if (r.limits.peak30.breached) {
                      violations.push({ name: r.name, code: r.code, limit: "30-day", actual: r.limits.peak30.hours, limitVal: ATCO_LIMITS.peak30.hours });
                    }
                    if (r.consecutiveDuty.streakViolation) {
                      violations.push({ name: r.name, code: r.code, limit: "consecutive days", actual: r.consecutiveDuty.maxStreak, limitVal: CONSECUTIVE_LIMITS.maxConsecutiveDays });
                    }
                    return violations;
                  })
                  .map((v, i) => (
                    <div key={`${v.code}-${v.limit}-${i}`} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-md bg-white/70 dark:bg-white/5 border border-red-200 dark:border-red-800">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{v.name}</span>
                        <span className="text-xs text-muted-foreground">({v.code})</span>
                        <Badge variant="destructive" className="text-[10px] h-5">
                          {v.limit}
                        </Badge>
                      </div>
                      <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                        {v.actual} / {v.limitVal} {v.limit === "consecutive days" ? "days" : "hours"}
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Main table ── */}
        <Card>
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Employee Duty Hours
              {!isLoading && (
                <Badge variant="secondary" className="ml-1 text-xs font-normal">
                  {displayRows.length} employee{displayRows.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>

          <CardContent className="px-0 pb-0">
            {isLoading ? (
              <div className="space-y-2 px-5 pb-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            ) : displayRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-5">
                <AlertCircle className="h-10 w-10 text-muted-foreground opacity-50" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {employeeRows.length === 0
                    ? "No schedule data found for this month."
                    : "No employees match the current filters."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-[38%] pl-5">
                        <button onClick={() => toggleSort("name")} className="flex items-center text-xs font-semibold hover:text-primary transition-colors">
                          Employee <SortIcon active={sortKey === "name"} dir={sortDir} />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button onClick={() => toggleSort("hours")} className="flex items-center ml-auto text-xs font-semibold hover:text-primary transition-colors">
                          Total <SortIcon active={sortKey === "hours"} dir={sortDir} />
                        </button>
                      </TableHead>
                      <TableHead className="text-right hidden sm:table-cell">
                        <button onClick={() => toggleSort("days")} className="flex items-center ml-auto text-xs font-semibold hover:text-primary transition-colors">
                          Days <SortIcon active={sortKey === "days"} dir={sortDir} />
                        </button>
                      </TableHead>
                      <TableHead className="text-right hidden md:table-cell">
                        <button onClick={() => toggleSort("avg")} className="flex items-center ml-auto text-xs font-semibold hover:text-primary transition-colors">
                          Avg/d <SortIcon active={sortKey === "avg"} dir={sortDir} />
                        </button>
                      </TableHead>
                      <TableHead className="text-right hidden lg:table-cell">
                        <button onClick={() => toggleSort("peak7")} className="flex items-center ml-auto text-xs font-semibold hover:text-primary transition-colors">
                          Peak 7d <SortIcon active={sortKey === "peak7"} dir={sortDir} />
                        </button>
                      </TableHead>
                      <TableHead className="text-center hidden lg:table-cell text-xs font-semibold">Limits</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {displayRows.flatMap(row => {
                      const isExpanded  = expandedCode === row.code;
                      const anyBreach   = row.limits.peak7.breached || row.limits.peak30.breached || row.consecutiveDuty.streakViolation;
                      const fillPct     = numDays > 0 ? Math.min((row.totalHours / (numDays * 6)) * 100, 100) : 0;
                      const hoursColour = row.totalHours > 200
                        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                        : row.totalHours > 140
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                          : "bg-primary/10 text-primary";

                      const mainRow = (
                        <TableRow
                          key={row.code}
                          className={`cursor-pointer transition-colors ${
                            anyBreach
                              ? "bg-red-50/40 dark:bg-red-950/10 hover:bg-red-50 dark:hover:bg-red-950/20"
                              : isExpanded
                                ? "bg-muted/30"
                                : "hover:bg-muted/20"
                          }`}
                          onClick={() => setExpandedCode(isExpanded ? null : row.code)}
                        >
                          <TableCell className="pl-5 py-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-sm">{row.name}</span>
                                {anyBreach && (
                                  <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" title="Regulatory limit breached" />
                                )}
                                {row.limits.peak7.hours > ATCO_LIMITS.peak7.hours * 0.85 && !anyBreach && (
                                  <Flame className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" title="Approaching 7-day limit" />
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-muted-foreground font-mono">{row.code}</span>
                                {row.shift !== "—" && (
                                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 py-0">
                                    {row.shift}
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-1.5 h-1 w-full max-w-[120px] rounded-full bg-muted overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${fillPct > 80 ? "bg-red-500" : fillPct > 50 ? "bg-amber-500" : "bg-primary"}`}
                                  style={{ width: `${fillPct}%` }}
                                />
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="text-right py-3">
                            <Badge className={`font-mono text-xs ${hoursColour}`} variant="secondary">
                              {row.totalHours}h
                            </Badge>
                          </TableCell>

                          <TableCell className="text-right text-sm hidden sm:table-cell py-3">
                            {row.daysWorked}d
                          </TableCell>

                          <TableCell className="text-right text-sm text-muted-foreground hidden md:table-cell py-3">
                            {row.avgPerDay}h
                          </TableCell>

                          <TableCell className="text-right hidden lg:table-cell py-3">
                            <span className={`text-sm font-medium ${row.limits.peak7.breached ? "text-red-500" : ""}`}>
                              {row.limits.peak7.hours}h
                            </span>
                            <span className={`ml-1 text-[10px] ${row.limits.peak7.breached ? "text-red-400" : "text-muted-foreground"}`}>
                              / {ATCO_LIMITS.peak7.hours}h
                            </span>
                          </TableCell>

                          <TableCell className="text-center hidden lg:table-cell py-3">
                            <div className="flex justify-center gap-1 flex-wrap">
                              {(["peak7", "peak30"] as const).map(k => {
                                const lim = row.limits[k];
                                const cap = ATCO_LIMITS[k];
                                return (
                                  <span
                                    key={k}
                                    title={`${cap.label}: ${lim.hours}h / ${cap.hours}h`}
                                    className={`inline-block text-[9px] font-bold rounded px-1 py-0.5 ${
                                      lim.breached
                                        ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                                        : "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                                    }`}
                                  >
                                    {cap.label}
                                  </span>
                                );
                              })}
                              {row.consecutiveDuty.streakViolation && (
                                <span
                                  title={`Consecutive duty: ${row.consecutiveDuty.maxStreak}d / ${CONSECUTIVE_LIMITS.maxConsecutiveDays}d max`}
                                  className="inline-block text-[9px] font-bold rounded px-1 py-0.5 bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300"
                                >
                                  Streak
                                </span>
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="text-right pr-3 py-3">
                            {isExpanded
                              ? <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" />
                              : <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />}
                          </TableCell>
                        </TableRow>
                      );

                      const detailRow = isExpanded ? (
                        <TableRow key={`${row.code}-detail`} className="bg-muted/10 hover:bg-muted/10">
                          <TableCell colSpan={8} className="px-5 py-3">
                            <DayGrid
                              row={row}
                              monthStart={monthStart}
                              monthEnd={monthEnd}
                              daysInMonth={numDays}
                            />
                          </TableCell>
                        </TableRow>
                      ) : null;

                      return [mainRow, detailRow].filter(Boolean) as React.ReactElement[];
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Duty code reference ── */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-xs text-muted-foreground font-medium tracking-wide uppercase">
              Duty Code Reference (Hours & Start Times IST)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <div className="flex flex-wrap gap-1.5 text-xs">
              {Object.entries(DUTY_HOURS_MAP).map(([code, hrs]) => {
                const startTime = getDutyStartTime(code);
                return (
                  <div
                    key={code}
                    title={`${DUTY_DESCRIPTIONS[code] || code} - Starts: ${startTime}`}
                    className="flex items-center justify-between rounded border px-2 py-1 bg-muted/40 gap-1.5"
                  >
                    <span className={`font-medium px-1.5 rounded text-[10px] whitespace-nowrap ${dutyColour(code)}`}>{code}</span>
                    <span className="text-muted-foreground whitespace-nowrap font-medium">{hrs}h</span>
                    {startTime !== "—" && (
                      <span className="text-[9px] text-blue-600 dark:text-blue-400 whitespace-nowrap">@{startTime}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-[10px] text-muted-foreground">
              <strong>Start Times:</strong> M = 0700, A = 1300, N/NO = 1900, M+A/A+M = 0700, G/GO = 0940 IST
            </div>
          </CardContent>
        </Card>

      </div>
    </DashboardLayout>
  );
}
