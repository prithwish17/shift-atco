import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, ArrowLeft, Trophy, Medal, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";

/* ── Extra duty (OPE) codes: compound codes where employee works beyond normal shift ── */
const OPE_CODES = new Set([
    "M+A", "NO+N", "SAT+NO", "SUN+N", "SUN+M", "SUN+A", "SUN+NO",
    "SAT+N", "CO+N", "CO+A", "CO+M", "A+M",
]);

const OPE_DESCRIPTIONS: Record<string, string> = {
    "M+A": "Morning + Afternoon",
    "NO+N": "Night Off + Night",
    "SAT+NO": "Saturday + Night Off",
    "SUN+N": "Sunday + Night",
    "SUN+M": "Sunday + Morning",
    "SUN+A": "Sunday + Afternoon",
    "SUN+NO": "Sunday + Night Off",
    "SAT+N": "Saturday + Night",
    "CO+N": "Clear Off + Night",
    "CO+A": "Clear Off + Afternoon",
    "CO+M": "Clear Off + Morning",
    "A+M": "Afternoon + Morning",
};

function getBadgeVariant(code: string): "default" | "secondary" | "outline" | "destructive" {
    if (code.includes("SUN") || code.includes("SAT")) return "destructive";
    if (code.includes("CO") || code.includes("NO")) return "secondary";
    return "default";
}

const RANK_COLOURS = [
    { bg: "bg-yellow-400/20 border-yellow-400/40", text: "text-yellow-500", badge: "bg-yellow-400 text-yellow-900" },
    { bg: "bg-slate-300/20 border-slate-400/40", text: "text-slate-400",   badge: "bg-slate-400 text-slate-900" },
    { bg: "bg-orange-400/20 border-orange-400/40", text: "text-orange-500", badge: "bg-orange-400 text-orange-900" },
];

export default function OPEAssignments() {
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const [showRankingAll, setShowRankingAll] = useState(false);
    const [rankingMode, setRankingMode] = useState<"ytd" | "month">("ytd");
    const [rankingMonth, setRankingMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });

    // ── Per-day query (existing) ──────────────────────────────────────────────
    const { data: schedules = [], isLoading } = useQuery({
        queryKey: scheduleKeys.ope(dateStr),
        ...SCHEDULE_QUERY_OPTIONS,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("employee_schedules" as any)
                .select("employee_code, employee_name, duty_code")
                .eq("duty_date", dateStr);
            if (error) throw error;
            return (data || []) as unknown as Array<{
                employee_code: string;
                employee_name: string;
                duty_code: string;
            }>;
        },
    });

    // ── YTD ranking query: only OPE rows from 1 Jan of current year ──────────
    const currentYear = new Date().getFullYear();
    const ytdStart = `${currentYear}-01-01`;
    const ytdEnd   = format(new Date(), "yyyy-MM-dd");
    const OPE_CODES_ARRAY = Array.from(OPE_CODES);

    const { data: ytdOpeRows = [], isLoading: isRankingLoading } = useQuery({
        queryKey: ["schedule", "ope-ranking", ytdStart, ytdEnd],
        ...SCHEDULE_QUERY_OPTIONS,
        queryFn: async () => {
            // Filter by OPE duty codes server-side so we don't hit the 1000-row default limit
            const { data, error } = await supabase
                .from("employee_schedules" as any)
                .select("employee_code, employee_name, duty_code, duty_date")
                .gte("duty_date", ytdStart)
                .lte("duty_date", ytdEnd)
                .in("duty_code", OPE_CODES_ARRAY);
            if (error) throw error;
            return (data || []) as unknown as Array<{
                employee_code: string;
                employee_name: string;
                duty_code: string;
                duty_date: string;
            }>;
        },
    });

    // Aggregate OPE count per employee from the pre-filtered YTD data
    const opeRanking = useMemo(() => {
        const map: Record<string, { employee_code: string; employee_name: string; count: number }> = {};
        ytdOpeRows.forEach((s) => {
            const key = s.employee_code;
            if (!map[key]) map[key] = { employee_code: s.employee_code, employee_name: s.employee_name, count: 0 };
            map[key].count += 1;
        });
        return Object.values(map).sort((a, b) => b.count - a.count);
    }, [ytdOpeRows]);

    // Monthly ranking — filter the already-fetched YTD data by the selected month
    const monthlyOpeRanking = useMemo(() => {
        if (rankingMode !== "month") return [];
        const [y, m] = rankingMonth.split("-");
        const prefix = `${y}-${m}`;
        const map: Record<string, { employee_code: string; employee_name: string; count: number }> = {};
        ytdOpeRows.forEach((s) => {
            if (!s.duty_date.startsWith(prefix)) return;
            const key = s.employee_code;
            if (!map[key]) map[key] = { employee_code: s.employee_code, employee_name: s.employee_name, count: 0 };
            map[key].count += 1;
        });
        return Object.values(map).sort((a, b) => b.count - a.count);
    }, [ytdOpeRows, rankingMode, rankingMonth]);

    const activeRanking = rankingMode === "month" ? monthlyOpeRanking : opeRanking;
    const [rankingSearch, setRankingSearch] = useState("");

    const filteredRanking = useMemo(() => {
        if (!rankingSearch.trim()) return activeRanking;
        const term = rankingSearch.trim().toLowerCase();
        return activeRanking.filter(
            (emp) =>
                (emp.employee_name || "").toLowerCase().includes(term) ||
                (emp.employee_code || "").toLowerCase().includes(term)
        );
    }, [activeRanking, rankingSearch]);

    // Build month options from Jan of current year to current month
    const monthOptions = useMemo(() => {
        const options: { value: string; label: string }[] = [];
        const now = new Date();
        for (let m = 0; m <= now.getMonth(); m++) {
            const d = new Date(currentYear, m, 1);
            options.push({
                value: `${currentYear}-${String(m + 1).padStart(2, "0")}`,
                label: format(d, "MMMM yyyy"),
            });
        }
        return options;
    }, [currentYear]);

    const opeEmployees = useMemo(
        () =>
            schedules.filter((s) => {
                const code = s.duty_code?.toUpperCase().trim();
                return code && OPE_CODES.has(code);
            }),
        [schedules]
    );

    // Group by duty code
    const grouped = useMemo(() => {
        const map: Record<string, typeof opeEmployees> = {};
        opeEmployees.forEach((emp) => {
            const code = emp.duty_code.toUpperCase().trim();
            if (!map[code]) map[code] = [];
            map[code].push(emp);
        });
        return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
    }, [opeEmployees]);

    return (
        <DashboardLayout role="supervisor">
            <div className="space-y-4 sm:space-y-6">
                {/* Header */}
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-w-0 items-start gap-2.5 sm:items-center sm:gap-3">
                        <Link to="/supervisor">
                            <Button variant="ghost" size="icon" className="h-9 w-9 sm:h-10 sm:w-10">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div className="min-w-0">
                            <h1 className="text-xl font-bold tracking-tight sm:text-3xl">OPE / Extra Duty Assignments</h1>
                            <p className="text-xs text-muted-foreground sm:text-sm">
                                Employees assigned extra or overtime duties
                            </p>
                        </div>
                    </div>

                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                className={cn("h-9 w-full justify-start text-left text-xs font-normal sm:w-auto sm:text-sm")}
                            >
                                <CalendarIcon className="mr-2 h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                {format(selectedDate, "PPP")}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={selectedDate}
                                onSelect={(date) => date && setSelectedDate(date)}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                </div>

                {/* Summary */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Card className="bg-violet-50/70 border-violet-100 dark:bg-violet-950/30 dark:border-violet-900/40">
                        <CardHeader className="flex flex-row items-center justify-between px-4 pb-1 pt-4 sm:pb-2">
                            <CardTitle className="text-[11px] font-medium leading-snug text-muted-foreground sm:text-sm">
                                Total OPE Employees
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 pt-0">
                            <div className="text-2xl font-bold sm:text-3xl">{isLoading ? "..." : opeEmployees.length}</div>
                            <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">for {format(selectedDate, "dd MMM yyyy")}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between px-4 pb-1 pt-4 sm:pb-2">
                            <CardTitle className="text-[11px] font-medium leading-snug text-muted-foreground sm:text-sm">
                                Duty Types
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 pt-0">
                            <div className="text-2xl font-bold sm:text-3xl">{isLoading ? "..." : grouped.length}</div>
                            <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">distinct extra duty codes</p>
                        </CardContent>
                    </Card>
                    <Card className="col-span-2 md:col-span-1">
                        <CardHeader className="flex flex-row items-center justify-between px-4 pb-1 pt-4 sm:pb-2">
                            <CardTitle className="text-[11px] font-medium leading-snug text-muted-foreground sm:text-sm">
                                Total Scheduled
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 pt-0">
                            <div className="text-2xl font-bold sm:text-3xl">{isLoading ? "..." : schedules.length}</div>
                            <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">employees in schedule</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Employee List grouped by duty code */}
                {isLoading ? (
                    <div className="space-y-3">
                        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
                    </div>
                ) : grouped.length === 0 ? (
                    <Card>
                        <CardContent className="py-10 text-center sm:py-12">
                            <p className="text-sm text-muted-foreground">No extra duty assignments for {format(selectedDate, "dd MMM yyyy")}</p>
                        </CardContent>
                    </Card>
                ) : (
                    grouped.map(([code, employees]) => (
                        <Card key={code}>
                            <CardHeader className="px-4 pb-3 pt-4 sm:px-6 sm:pb-6 sm:pt-6">
                                <div className="flex items-start gap-2.5 sm:items-center sm:gap-3">
                                    <Badge variant={getBadgeVariant(code)} className="px-2.5 py-0.5 text-xs sm:px-3 sm:py-1 sm:text-sm">
                                        {code}
                                    </Badge>
                                    <div className="min-w-0">
                                        <CardTitle className="text-sm leading-tight sm:text-base">{OPE_DESCRIPTIONS[code] || code}</CardTitle>
                                        <CardDescription className="text-[11px] sm:text-xs">{employees.length} employee{employees.length > 1 ? "s" : ""}</CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
                                <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
                                    {employees.map((emp, idx) => (
                                        <div
                                            key={`${emp.employee_code}-${idx}`}
                                            className="flex items-center gap-2.5 rounded-md border bg-muted/30 px-2.5 py-2 sm:gap-3 sm:rounded-lg sm:p-3"
                                        >
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary sm:h-9 sm:w-9 sm:text-sm">
                                                {emp.employee_name?.charAt(0) || "?"}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="truncate text-xs font-medium sm:text-sm">{emp.employee_name || "Unknown"}</p>
                                                <p className="text-[10px] text-muted-foreground sm:text-xs">{emp.employee_code}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
                {/* ── OPE Ranking (YTD from 1 Jan) ────────────────────────────────── */}
                <Card>
                    <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pb-3 sm:pt-6">
                        <div className="flex flex-wrap items-start justify-between gap-2 sm:items-center">
                            <div className="flex min-w-0 items-start gap-2 sm:items-center">
                                <Trophy className="h-4 w-4 text-yellow-500 sm:h-5 sm:w-5" />
                                <div className="min-w-0">
                                    <CardTitle className="text-sm sm:text-base">OPE Ranking</CardTitle>
                                    <CardDescription className="text-[11px] leading-4 sm:text-sm sm:leading-5">
                                        {rankingMode === "ytd"
                                            ? `OPE Ranking of this Year (${currentYear})`
                                            : `OPE Ranking for ${monthOptions.find(o => o.value === rankingMonth)?.label ?? rankingMonth}`}
                                    </CardDescription>
                                </div>
                            </div>

                            <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-2">
                                {/* Search */}
                                <div className="relative w-full sm:w-40">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={12} />
                                    <Input
                                        value={rankingSearch}
                                        onChange={(e) => setRankingSearch(e.target.value)}
                                        placeholder="Search name or ID"
                                        className="h-8 w-full pl-7 pr-7 text-[11px] sm:text-xs"
                                    />
                                    {rankingSearch && (
                                        <button
                                            type="button"
                                            onClick={() => setRankingSearch("")}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                            aria-label="Clear search"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                </div>
                                {rankingMode === "month" && (
                                    <div className="w-full sm:w-40">
                                        <Select value={rankingMonth} onValueChange={(v) => { setRankingMonth(v); setShowRankingAll(false); }}>
                                            <SelectTrigger className="h-8 w-full text-[11px] sm:text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {monthOptions.map((opt) => (
                                                    <SelectItem key={opt.value} value={opt.value} className="text-[11px] sm:text-xs">
                                                        {opt.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-full gap-1 text-[11px] sm:w-auto sm:text-xs"
                                    onClick={() => {
                                        setRankingMode((prev) => prev === "ytd" ? "month" : "ytd");
                                        setShowRankingAll(false);
                                    }}
                                >
                                    {rankingMode === "ytd" ? "By Month" : "Full Year"}
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
                        {isRankingLoading ? (
                            <div className="space-y-2">
                                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
                            </div>
                        ) : filteredRanking.length === 0 ? (
                            <p className="py-5 text-center text-xs text-muted-foreground sm:py-6 sm:text-sm">
                                {rankingSearch.trim()
                                    ? `No employees matching "${rankingSearch.trim()}".`
                                    : rankingMode === "ytd"
                                    ? `No OPE duties recorded from 1 Jan ${currentYear}.`
                                    : `No OPE duties recorded for ${monthOptions.find(o => o.value === rankingMonth)?.label ?? rankingMonth}.`}
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {(showRankingAll ? filteredRanking : filteredRanking.slice(0, 10)).map((emp, idx) => {
                                    const colours = RANK_COLOURS[idx] ?? {
                                        bg: "bg-muted/40 border-border",
                                        text: "text-muted-foreground",
                                        badge: "bg-muted text-muted-foreground",
                                    };
                                    const isTopThree = idx < 3;
                                    return (
                                        <div
                                            key={emp.employee_code}
                                            className={`grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2.5 py-2 sm:gap-3 sm:rounded-lg sm:px-3 sm:py-2.5 ${
                                                isTopThree ? colours.bg : "bg-muted/20 border-border"
                                            }`}
                                        >
                                            {/* Rank badge */}
                                            <div
                                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-bold text-xs sm:h-8 sm:w-8 sm:text-sm ${
                                                    isTopThree ? colours.badge : "bg-muted text-muted-foreground"
                                                }`}
                                            >
                                                {idx < 3 ? (
                                                    <Medal className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                                ) : (
                                                    idx + 1
                                                )}
                                            </div>

                                            {/* Avatar */}
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary sm:h-9 sm:w-9 sm:text-sm">
                                                {emp.employee_name?.charAt(0) || "?"}
                                            </div>

                                            {/* Name & code */}
                                            <div className="min-w-0">
                                                <p className="truncate text-xs font-medium sm:text-sm">{emp.employee_name || "Unknown"}</p>
                                                <p className="text-[10px] text-muted-foreground sm:text-xs">{emp.employee_code}</p>
                                            </div>

                                            {/* OPE count */}
                                            <div className={`ml-auto flex min-w-[2rem] items-center justify-end text-right text-base font-bold leading-none tabular-nums sm:min-w-[2.5rem] sm:text-lg ${
                                                    isTopThree ? colours.text : "text-foreground"
                                                }`}>{emp.count}</div>
                                        </div>
                                    );
                                })}

                                {filteredRanking.length > 10 && (
                                    <button
                                        onClick={() => setShowRankingAll((v) => !v)}
                                        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground sm:mt-2 sm:rounded-lg sm:py-2 sm:text-sm"
                                    >
                                        {showRankingAll ? (
                                            <><ChevronUp className="h-4 w-4" /> Show Top 10 Only</>
                                        ) : (
                                            <><ChevronDown className="h-4 w-4" /> View All {filteredRanking.length} Employees</>
                                        )}
                                    </button>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
