import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Search, Filter, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { DUTY_CODES, DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/* ── Types ── */
interface ScheduleEntry {
    id: string;
    employee_code: string;
    employee_name: string;
    duty_date: string;
    duty_code: string;
    duty_description: string;
}

interface ProfileLite {
    id: string;
    employee_id: string | null;
    full_name: string | null;
    current_shift: string | null;
}

/* ── Constants ── */
const DEFAULT_TEAMS = ["A", "B", "C", "D", "E", "G"];
const ROW_H = "h-[44px]"; // consistent row height for alignment
const ROW_PX = 44;
const ROW_OVERSCAN = 10;
const normalizeTeam = (value: string | null | undefined): string => {
    const normalized = (value || "").trim().toUpperCase();
    if (!normalized || normalized === "GENERAL") return "G";
    return normalized;
};

/* ── Duty cell color mapping (from Figma) ── */
const getDutyColor = (duty: string) => {
    switch (duty?.toUpperCase()) {
        case "G": return "bg-teal-50 text-teal-800 border-teal-300";
        case "M": return "bg-sky-50 text-sky-800 border-sky-300";
        case "A": return "bg-orange-50 text-orange-800 border-orange-300";
        case "N": return "bg-violet-50 text-violet-800 border-violet-300";
        case "NO": return "bg-fuchsia-50 text-fuchsia-800 border-fuchsia-300";
        case "CO": return "bg-purple-50 text-purple-800 border-purple-300";
        case "LEAVE": return "bg-red-50 text-red-800 border-red-300";
        case "SAT": case "SUN": return "bg-slate-100 text-slate-700 border-slate-300";
        case "GO": return "bg-lime-50 text-lime-800 border-lime-300";
        case "CH": case "NH": return "bg-cyan-50 text-cyan-800 border-cyan-300";
        case "NA": return "bg-gray-100 text-gray-700 border-gray-300";
        case "A+M": case "M+A": return "bg-amber-50 text-amber-800 border-amber-300";
        case "NO+N": case "N+NO": return "bg-indigo-50 text-indigo-800 border-indigo-300";
        case "SL": case "TR": return "bg-rose-50 text-rose-800 border-rose-300";
        case "SAT+NO": case "SAT+N": case "SUN+N": case "SUN+M": case "SUN+A": case "SUN+NO":
            return "bg-slate-100 text-slate-600 border-slate-300";
        case "CO+N": case "CO+A": case "CO+M":
            return "bg-purple-50 text-purple-700 border-purple-300";
        default: return "bg-neutral-50 text-neutral-700 border-neutral-300";
    }
};

/* ── Generate dates for a month ── */
const generateDates = (year: number, month: number) => {
    const dates = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        dates.push({
            label: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
            key: format(date, "yyyy-MM-dd"),
            dayOfWeek: date.toLocaleDateString("en-US", { weekday: "short" }),
            isWeekend: date.getDay() === 0 || date.getDay() === 6,
        });
    }
    return dates;
};

/* ═══════════════════════════════════════════════════════════════ */

export default function DutyManagement() {
    const now = new Date();
    const [currentYear, setCurrentYear] = useState(now.getFullYear());
    const [currentMonth, setCurrentMonth] = useState(now.getMonth());
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
    const [sortBy, setSortBy] = useState<"name" | "empId" | "team">("name");
    const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
    const [gridScrollTop, setGridScrollTop] = useState(0);
    const [gridViewportHeight, setGridViewportHeight] = useState(0);
    const scrollRafRef = useRef<number | null>(null);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const dates = generateDates(currentYear, currentMonth);
    const startDate = dates[0]?.key;
    const endDate = dates[dates.length - 1]?.key;

    /* ── Refs for synced scrolling ── */
    const namesRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    // Sync vertical scroll: when grid scrolls vertically, names follow
    const onGridScroll = useCallback(() => {
        if (namesRef.current && gridRef.current) {
            namesRef.current.scrollTop = gridRef.current.scrollTop;
            if (scrollRafRef.current !== null) return;
            scrollRafRef.current = requestAnimationFrame(() => {
                if (gridRef.current) {
                    setGridScrollTop(gridRef.current.scrollTop);
                }
                scrollRafRef.current = null;
            });
        }
    }, []);

    /* ── Data fetching ── */
    const { data: profiles = [], isLoading: profilesLoading } = useQuery({
        queryKey: ["duty-management-profiles"],
        queryFn: async () => {
            const PAGE_SIZE = 1000;
            let allRows: ProfileLite[] = [];
            let from = 0;
            let hasMore = true;
            while (hasMore) {
                const { data, error } = await supabase
                    .from("profiles")
                    .select("id, employee_id, full_name, current_shift")
                    .order("full_name")
                    .range(from, from + PAGE_SIZE - 1);
                if (error) throw error;
                const rows = (data || []) as unknown as ProfileLite[];
                allRows = allRows.concat(rows);
                hasMore = rows.length === PAGE_SIZE;
                from += PAGE_SIZE;
            }
            return allRows;
        },
        staleTime: 5 * 60 * 1000,
    });
    const upsertSchedule = useMutation({
        mutationFn: async ({
            employeeCode,
            employeeName,
            dutyDate,
            dutyCode,
        }: {
            employeeCode: string;
            employeeName: string;
            dutyDate: string;
            dutyCode: string;
        }) => {
            const payload = {
                employee_code: employeeCode,
                employee_name: employeeName,
                duty_date: dutyDate,
                duty_code: dutyCode,
                duty_description: DUTY_DESCRIPTIONS[dutyCode] || dutyCode,
            };

            const { error } = await supabase
                .from("employee_schedules" as any)
                .upsert(payload as any, { onConflict: "employee_code,duty_date" });
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["duty-management-schedules"] });
            queryClient.invalidateQueries({ queryKey: ["employee-schedules"] });
        },
    });

    const { data: schedules = [], isLoading: schedulesLoading } = useQuery({
        queryKey: ["duty-management-schedules", startDate, endDate],
        queryFn: async () => {
            const PAGE_SIZE = 1000;
            let allRows: ScheduleEntry[] = [];
            let from = 0;
            let hasMore = true;
            while (hasMore) {
                const { data, error } = await supabase
                    .from("employee_schedules" as any)
                    .select("id, employee_code, employee_name, duty_date, duty_code, duty_description")
                    .gte("duty_date", startDate)
                    .lte("duty_date", endDate)
                    .order("duty_date")
                    .order("id")
                    .range(from, from + PAGE_SIZE - 1);
                if (error) throw error;
                const rows = (data || []) as unknown as ScheduleEntry[];
                allRows = allRows.concat(rows);
                hasMore = rows.length === PAGE_SIZE;
                from += PAGE_SIZE;
            }
            return allRows;
        },
        enabled: !!startDate && !!endDate,
        staleTime: 2 * 60 * 1000,
    });

    /* ── Build employee list and schedule map ── */
    const employees = useMemo(() => profiles, [profiles]);

    const scheduleMap = useMemo(() => {
        const map = new Map<string, ScheduleEntry>();
        for (const s of schedules) {
            const key = `${(s.employee_code || "").trim().toUpperCase()}|${s.duty_date}`;
            map.set(key, s);
        }
        return map;
    }, [schedules]);

    const employeeRows = useMemo(() => {
        const codesMap = new Map<string, { code: string; name: string; team: string }>();

        // 1. Add all employees from the profiles table
        for (const u of employees) {
            if (!u.employee_id) continue;
            const code = u.employee_id.trim().toUpperCase();
            codesMap.set(code, {
                code,
                name: u.full_name || code,
                team: normalizeTeam(u.current_shift),
            });
        }

        // 2. Add anyone in schedules who wasn't in profiles
        for (const s of schedules) {
            const code = (s.employee_code || "").trim().toUpperCase();
            if (!codesMap.has(code)) {
                codesMap.set(code, {
                    code,
                    name: s.employee_name || code,
                    team: "—",
                });
            }
        }

        return Array.from(codesMap.values());
    }, [schedules, employees]);

    const teamOptions = useMemo(() => {
        const discovered = new Set(
            employeeRows.map((emp) => emp.team).filter((team) => team && team !== "—")
        );
        const merged = new Set<string>([...DEFAULT_TEAMS, ...Array.from(discovered)]);
        return Array.from(merged).sort((a, b) => a.localeCompare(b));
    }, [employeeRows]);

    useEffect(() => {
        setSelectedTeams((prev) => {
            if (teamOptions.length === 0) return [];
            if (prev.length === 0) return teamOptions;
            const filtered = prev.filter((t) => teamOptions.includes(t));
            return filtered.length > 0 ? filtered : teamOptions;
        });
    }, [teamOptions]);

    /* ── Filtering and sorting ── */
    const filteredEmployees = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        return employeeRows
            .filter((emp) => {
                const matchesSearch =
                    !query ||
                    emp.name.toLowerCase().includes(query) ||
                    emp.code.toLowerCase().includes(query);
                const matchesTeam = selectedTeams.includes(emp.team) || emp.team === "—";
                return matchesSearch && matchesTeam;
            })
            .sort((a, b) => {
                switch (sortBy) {
                    case "name": return a.name.localeCompare(b.name);
                    case "empId": return a.code.localeCompare(b.code);
                    case "team": return a.team.localeCompare(b.team);
                    default: return 0;
                }
            });
    }, [employeeRows, searchQuery, selectedTeams, sortBy]);

    /* ── Handlers ── */
    const navigateMonth = (direction: "prev" | "next") => {
        let m = currentMonth, y = currentYear;
        if (direction === "prev") { m--; if (m < 0) { m = 11; y--; } }
        else { m++; if (m > 11) { m = 0; y++; } }
        setCurrentMonth(m);
        setCurrentYear(y);
    };

    const handleDutyChange = async (
        emp: { code: string; name: string },
        dateKey: string,
        newCode: string
    ) => {
        if (!newCode) return;
        const key = `${emp.code}|${dateKey}`;
        setSavingCellKey(key);
        try {
            await upsertSchedule.mutateAsync({
                employeeCode: emp.code,
                employeeName: emp.name,
                dutyDate: dateKey,
                dutyCode: newCode,
            });
            toast({ title: "Updated", description: `Duty changed to ${newCode}` });
        } catch (err: any) {
            toast({
                title: "Update failed",
                description: err?.message || "Error",
                variant: "destructive",
            });
        } finally {
            setSavingCellKey((current) => (current === key ? null : current));
        }
    };

    const toggleTeam = (team: string) => {
        setSelectedTeams((prev) => prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team]);
    };
    const toggleAllTeams = () => {
        setSelectedTeams((prev) => prev.length === teamOptions.length ? [] : [...teamOptions]);
    };
    const monthLabel = new Date(currentYear, currentMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const isLoading = profilesLoading || schedulesLoading;

    const totalRows = filteredEmployees.length;
    const visibleCount = Math.max(1, Math.ceil(gridViewportHeight / ROW_PX) + ROW_OVERSCAN * 2);
    const startIndex = Math.max(0, Math.floor(gridScrollTop / ROW_PX) - ROW_OVERSCAN);
    const endIndex = Math.min(totalRows, startIndex + visibleCount);
    const visibleEmployees = filteredEmployees.slice(startIndex, endIndex);
    const topSpacerHeight = startIndex * ROW_PX;
    const bottomSpacerHeight = Math.max(0, (totalRows - endIndex) * ROW_PX);

    useEffect(() => {
        const grid = gridRef.current;
        if (!grid) return;
        const updateHeight = () => setGridViewportHeight(grid.clientHeight);
        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(grid);
        return () => observer.disconnect();
    }, [isLoading]);

    useEffect(() => {
        return () => {
            if (scrollRafRef.current !== null) {
                cancelAnimationFrame(scrollRafRef.current);
            }
        };
    }, []);

    useEffect(() => {
        setGridScrollTop(0);
        if (gridRef.current) gridRef.current.scrollTop = 0;
        if (namesRef.current) namesRef.current.scrollTop = 0;
    }, [currentMonth, currentYear, searchQuery, selectedTeams, sortBy]);

    /* ═══════════════════════════════════════════════════════════════
     * LAYOUT
     * ─────
     * ┌────────────────────────────────────────────────────────────┐
     * │  Search / Filter / Sort                    (FIXED TOP)    │
     * ├────────────────────────────────────────────────────────────┤
     * │  < Prev Month       February 2026       Next Month >      │
     * ├─────────────────┬──────────────────────────────────────────┤
     * │  EmpID │Tm│Name │  01 Feb │ 02 Feb │ 03 Feb │ …          │ ← header
     * │  (FIXED LEFT)   │  (SCROLLS H)                            │ ← sticky
     * ├─────────────────┼──────────────────────────────────────────┤
     * │  emp1  │A │John │  M      │ A      │ N      │ …          │ ← rows
     * │  emp2  │B │Jane │  A      │ M      │ CO     │ …          │   scroll V+H
     * │  …     │  │     │  …      │ …      │ …      │ …          │
     * └─────────────────┴──────────────────────────────────────────┘
     *                   ↕ scrollbar at bottom (custom)
     * ═══════════════════════════════════════════════════════════ */

    return (
        <DashboardLayout role="supervisor">
            <div className="flex flex-col -m-4 md:-m-6" style={{ height: "calc(100vh - 64px)" }}>
                {/* ── FIXED: Search and Filter Bar ── */}
                <div className="bg-background border-b px-4 md:px-6 py-3 shadow-sm flex-shrink-0">
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-[220px] max-w-sm relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="text"
                                placeholder="Search by name or employee ID..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 h-9"
                            />
                        </div>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-2">
                                    <Filter className="h-4 w-4" />
                                    Team Filter
                                    {selectedTeams.length < teamOptions.length && (
                                        <span className="ml-1 px-1.5 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                                            {selectedTeams.length}
                                        </span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-56" align="start">
                                <div className="space-y-3">
                                    <div className="font-semibold text-sm">Filter by Team</div>
                                    <div className="flex items-center space-x-2 pb-2 border-b">
                                        <Checkbox id="dm-all" checked={selectedTeams.length === teamOptions.length} onCheckedChange={toggleAllTeams} />
                                        <label htmlFor="dm-all" className="text-sm font-medium cursor-pointer">Select All</label>
                                    </div>
                                    {teamOptions.map((t) => (
                                        <div key={t} className="flex items-center space-x-2">
                                            <Checkbox id={`dm-t-${t}`} checked={selectedTeams.includes(t)} onCheckedChange={() => toggleTeam(t)} />
                                            <label htmlFor={`dm-t-${t}`} className="text-sm font-medium cursor-pointer">Team {t}</label>
                                        </div>
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>

                        <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Sort by:</span>
                            <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                                <SelectTrigger className="w-[130px] h-9">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="name">Name</SelectItem>
                                    <SelectItem value="empId">Employee ID</SelectItem>
                                    <SelectItem value="team">Team</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {upsertSchedule.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>

                    {(searchQuery || selectedTeams.length < teamOptions.length) && (
                        <p className="text-xs text-muted-foreground mt-2">
                            Showing {filteredEmployees.length} of {employeeRows.length} employees
                        </p>
                    )}
                </div>

                {/* ── FIXED: Month Navigation ── */}
                <div className="bg-background border-b px-4 md:px-6 py-2 flex items-center justify-between flex-shrink-0">
                    <Button variant="outline" size="sm" onClick={() => navigateMonth("prev")} className="gap-1">
                        <ChevronLeft className="h-4 w-4" /> Previous Month
                    </Button>
                    <h2 className="text-base font-semibold">{monthLabel}</h2>
                    <Button variant="outline" size="sm" onClick={() => navigateMonth("next")} className="gap-1">
                        Next Month <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                {/* ── SCROLLABLE: Table Grid ── */}
                {isLoading ? (
                    <div className="flex-1 p-6 space-y-3 overflow-hidden">
                        {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
                    </div>
                ) : (
                    <div className="flex-1 flex overflow-hidden min-h-0">
                        {/* ── LEFT PANEL: Fixed employee columns (scrolls vertically only, synced) ── */}
                        <div className="flex-shrink-0 flex flex-col border-r-2 border-gray-400 shadow-[3px_0_8px_rgba(0,0,0,0.08)] z-10 bg-background">
                            {/* Left header */}
                            <div className={`flex ${ROW_H} border-b-2 border-gray-400 bg-muted/60 flex-shrink-0`}>
                                <div className="w-32 px-3 flex items-center justify-center border-r border-gray-300">
                                    <span className="font-semibold text-xs">Employee ID</span>
                                </div>
                                <div className="w-16 px-2 flex items-center justify-center border-r border-gray-300">
                                    <span className="font-semibold text-xs">Team</span>
                                </div>
                                <div className="w-52 px-3 flex items-center">
                                    <span className="font-semibold text-xs">Employee Name</span>
                                </div>
                            </div>

                            {/* Left body — synced vertical scroll, hidden scrollbar */}
                            <div
                                ref={namesRef}
                                className="flex-1 overflow-hidden"
                                style={{ overflowY: "hidden" }}
                            >
                                {filteredEmployees.length === 0 ? (
                                    <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                                        No employees found
                                    </div>
                                ) : (
                                    <>
                                        {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
                                        {visibleEmployees.map((emp, i) => {
                                            const rowIndex = startIndex + i;
                                            return (
                                                <div
                                                    key={emp.code}
                                                    className={`flex ${ROW_H} border-b border-gray-200 dark:border-slate-700 transition-colors ${
                                                        rowIndex % 2 === 0
                                                            ? "bg-white dark:bg-slate-900/55"
                                                            : "bg-slate-50/70 dark:bg-slate-800/55"
                                                    } hover:bg-blue-50/60 dark:hover:bg-blue-900/25`}
                                                >
                                                    <div className="w-32 px-3 flex items-center border-r border-gray-200">
                                                        <span className="text-xs font-mono font-medium truncate">{emp.code}</span>
                                                    </div>
                                                    <div className="w-16 px-2 flex items-center justify-center border-r border-gray-200">
                                                        <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-gray-700 text-white text-[10px] font-semibold shadow-sm">
                                                            {emp.team === "GENERAL" ? "G" : emp.team}
                                                        </span>
                                                    </div>
                                                    <div className="w-52 px-3 flex items-center">
                                                        <span className="text-xs font-semibold truncate">{emp.name}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* ── RIGHT PANEL: Date header + duty cells (scrolls both H and V) ── */}
                        <div
                            ref={gridRef}
                            className="flex-1 overflow-auto custom-scrollbar min-w-0"
                            onScroll={onGridScroll}
                        >
                            {/* Date header row — sticky top */}
                            <div className={`sticky top-0 z-10 flex ${ROW_H} border-b-2 border-gray-400 bg-muted/80 backdrop-blur`}>
                                {dates.map((date) => (
                                    <div
                                        key={date.key}
                                        className={`w-28 flex-shrink-0 px-2 flex flex-col items-center justify-center border-r border-gray-300 ${date.isWeekend ? "bg-muted" : ""
                                            }`}
                                    >
                                        <span className="font-semibold text-xs leading-tight">{date.label}</span>
                                        <span className={`text-[10px] leading-tight ${date.isWeekend ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                                            {date.dayOfWeek}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Duty cells body */}
                            {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
                            {visibleEmployees.map((emp, i) => {
                                const rowIndex = startIndex + i;
                                return (
                                    <div
                                        key={emp.code}
                                        className={`flex ${ROW_H} border-b border-gray-200 dark:border-slate-700 transition-colors ${
                                            rowIndex % 2 === 0
                                                ? "bg-white dark:bg-slate-900/55"
                                                : "bg-slate-50/70 dark:bg-slate-800/55"
                                        } hover:bg-blue-50/60 dark:hover:bg-blue-900/25`}
                                    >
                                        {dates.map((date) => {
                                            const entry = scheduleMap.get(`${emp.code}|${date.key}`);
                                            const duty = entry?.duty_code || "";
                                            const cellKey = `${emp.code}|${date.key}`;
                                            const isSaving = savingCellKey === cellKey;
                                            return (
                                                <div
                                                    key={date.key}
                                                    className={`w-28 flex-shrink-0 px-1 flex items-center justify-center border-r border-gray-200 ${date.isWeekend ? "bg-muted/20" : ""
                                                        }`}
                                                >
                                                    <select
                                                        value={duty}
                                                        disabled={isSaving}
                                                        onChange={(e) => handleDutyChange(emp, date.key, e.target.value)}
                                                        className={`w-full h-8 text-[11px] font-semibold border-[1.5px] rounded-md px-1 outline-none focus:ring-2 focus:ring-ring focus:border-input shadow-sm appearance-none cursor-pointer ${getDutyColor(duty)} hover:opacity-90 transition-all text-center ${isSaving ? "opacity-60 cursor-wait" : ""}`}
                                                    >
                                                        <option value="" className="text-gray-900 bg-white">—</option>
                                                        {duty && !(DUTY_CODES as readonly string[]).includes(duty) && (
                                                            <option value={duty} className="text-gray-900 bg-white">
                                                                {duty}
                                                            </option>
                                                        )}
                                                        {DUTY_CODES.map((code) => (
                                                            <option key={code} value={code} className="text-gray-900 bg-white">
                                                                {code}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                            {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
