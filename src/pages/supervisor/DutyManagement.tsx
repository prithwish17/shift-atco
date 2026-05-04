import { useState, useMemo, useRef, useCallback, useEffect, memo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Search, Filter, ChevronLeft, ChevronRight, Loader2, RefreshCcw, RotateCcw, X } from "lucide-react";
import { format } from "date-fns";
import { DUTY_CODES, DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import { logSupervisorEdit } from "@/lib/supervisorAuditLog";

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

interface LastScheduleChange {
    employeeCode: string;
    employeeName: string;
    dutyDate: string;
    previousDutyCode: string;
    nextDutyCode: string;
}

interface GridScrollMetrics {
    scrollLeft: number;
    scrollWidth: number;
    clientWidth: number;
    trackWidth: number;
}

/* ── Constants ── */
const DEFAULT_TEAMS = ["A", "B", "C", "D", "E", "G"];
const ROW_H = "h-[44px]"; // consistent row height for alignment
const ROW_PX = 44;
// Fix 5: Reduced overscan 10 → 5 — fewer off-screen DOM nodes without visible effect
const ROW_OVERSCAN = 5;
const normalizeTeam = (value: string | null | undefined): string => {
    const normalized = (value || "").trim().toUpperCase();
    if (!normalized || normalized === "GENERAL") return "G";
    return normalized;
};

const hasAssignedShift = (value: string | null | undefined): boolean => {
    return Boolean((value || "").trim());
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

/* ── Memoized duty cell — Excel-style: plain text until clicked, then inline input ── */
interface DutyCellProps {
    duty: string;
    isSaving: boolean;
    isWeekend: boolean;
    empCode: string;
    empName: string;
    dateKey: string;
    onDutyChange: (empCode: string, empName: string, dateKey: string, newCode: string) => void;
}

const MemoizedDutyCell = memo(function DutyCell({
    duty,
    isSaving,
    isWeekend,
    empCode,
    empName,
    dateKey,
    onDutyChange,
}: DutyCellProps) {
    const [editing, setEditing] = useState(false);
    const selectRef = useRef<HTMLSelectElement>(null);

    useEffect(() => {
        if (editing && selectRef.current) {
            selectRef.current.focus();
            // Open the native dropdown immediately
            selectRef.current.click();
        }
    }, [editing]);

    // Editing mode: show a <select> dropdown only on the active cell
    if (editing && !isSaving) {
        return (
            <div
                className={`w-full h-full px-1 flex items-center justify-center ${isWeekend ? "bg-muted/20" : ""}`}
            >
                <select
                    ref={selectRef}
                    defaultValue={duty}
                    className="w-full h-8 text-[11px] font-semibold border-[1.5px] rounded-md px-1 outline-none focus:ring-2 focus:ring-ring focus:border-input shadow-sm text-center bg-white"
                    onChange={(e) => {
                        const val = e.target.value;
                        if (val !== duty) {
                            onDutyChange(empCode, empName, dateKey, val);
                        }
                        setEditing(false);
                    }}
                    onBlur={() => setEditing(false)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            setEditing(false);
                        }
                    }}
                >
                    <option value="">— None —</option>
                    {DUTY_CODES.map((code) => (
                        <option key={code} value={code}>
                            {code} – {DUTY_DESCRIPTIONS[code] || code}
                        </option>
                    ))}
                </select>
            </div>
        );
    }

    // Display mode: lightweight text cell, click to open dropdown
    return (
        <div
            className={`w-full h-full px-1 flex items-center justify-center ${isWeekend ? "bg-muted/20" : ""}`}
        >
            <div
                onClick={() => !isSaving && setEditing(true)}
                tabIndex={0}
                role="button"
                title={duty ? (DUTY_DESCRIPTIONS[duty] || duty) : "Click to assign"}
                className={`w-full h-8 text-[11px] font-semibold border-[1.5px] rounded-md px-1 flex items-center justify-center shadow-sm cursor-pointer select-none ${getDutyColor(duty)} hover:opacity-90 transition-all ${isSaving ? "opacity-60 cursor-wait animate-pulse" : ""}`}
            >
                {duty || "—"}
            </div>
        </div>
    );
});

export default function DutyManagement() {
    const now = new Date();
    const isMobile = useIsMobile();
    const [currentYear, setCurrentYear] = useState(now.getFullYear());
    const [currentMonth, setCurrentMonth] = useState(now.getMonth());
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
    const [sortBy, setSortBy] = useState<"name" | "empId" | "team">("name");
    const [lastScheduleChange, setLastScheduleChange] = useState<LastScheduleChange | null>(null);
    const [isSyncingDatabase, setIsSyncingDatabase] = useState(false);
    const [gridScrollMetrics, setGridScrollMetrics] = useState<GridScrollMetrics>({
        scrollLeft: 0,
        scrollWidth: 1,
        clientWidth: 1,
        trackWidth: 0,
    });
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Fix 2: Memoized — was regenerated on every render, now only recomputes when month/year changes
    const dates = useMemo(() => generateDates(currentYear, currentMonth), [currentYear, currentMonth]);
    const startDate = dates[0]?.key;
    const endDate = dates[dates.length - 1]?.key;

    /* ── Refs for synced scrolling ── */
    const namesRef = useRef<HTMLDivElement>(null);
    const dateHeaderRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const horizontalTrackRef = useRef<HTMLDivElement>(null);
    const horizontalSyncingRef = useRef(false);

    // Sync vertical scroll: when grid scrolls vertically, names follow
    const updateGridScrollMetrics = useCallback(() => {
        const grid = gridRef.current;
        if (!grid) return;

        setGridScrollMetrics({
            scrollLeft: grid.scrollLeft,
            scrollWidth: grid.scrollWidth,
            clientWidth: grid.clientWidth,
            trackWidth: horizontalTrackRef.current?.clientWidth || 0,
        });
    }, []);

    const setGridHorizontalScroll = useCallback((nextScrollLeft: number) => {
        const grid = gridRef.current;
        if (!grid) return;

        const maxScroll = Math.max(0, grid.scrollWidth - grid.clientWidth);
        const clampedScrollLeft = Math.max(0, Math.min(nextScrollLeft, maxScroll));

        horizontalSyncingRef.current = true;
        grid.scrollLeft = clampedScrollLeft;
        if (dateHeaderRef.current) {
            dateHeaderRef.current.scrollLeft = clampedScrollLeft;
        }

        requestAnimationFrame(() => {
            horizontalSyncingRef.current = false;
            updateGridScrollMetrics();
        });
    }, [updateGridScrollMetrics]);

    const onGridScroll = useCallback(() => {
        if (namesRef.current && gridRef.current) {
            namesRef.current.scrollTop = gridRef.current.scrollTop;
        }

        if (!horizontalSyncingRef.current && dateHeaderRef.current && gridRef.current) {
            horizontalSyncingRef.current = true;
            dateHeaderRef.current.scrollLeft = gridRef.current.scrollLeft;

            requestAnimationFrame(() => {
                horizontalSyncingRef.current = false;
            });
        }

        updateGridScrollMetrics();
    }, [updateGridScrollMetrics]);

    const onDateHeaderScroll = useCallback(() => {
        if (horizontalSyncingRef.current || !dateHeaderRef.current || !gridRef.current) return;

        horizontalSyncingRef.current = true;
        gridRef.current.scrollLeft = dateHeaderRef.current.scrollLeft;

        requestAnimationFrame(() => {
            horizontalSyncingRef.current = false;
            updateGridScrollMetrics();
        });
    }, [updateGridScrollMetrics]);

    /* ── Data fetching ── */
    const { data: profiles = [], isLoading: profilesLoading } = useQuery({
        queryKey: ["duty-management-profiles"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, employee_id, full_name, current_shift")
                .neq("is_hidden" as any, true)
                .order("full_name");
            if (error) throw error;
            return (data || []) as unknown as ProfileLite[];
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

            if (!dutyCode) {
                const { error } = await supabase
                    .from("employee_schedules" as any)
                    .delete()
                    .eq("employee_code", employeeCode)
                    .eq("duty_date", dutyDate);
                if (error) throw error;
                return;
            }

            const { error } = await supabase
                .from("employee_schedules" as any)
                .upsert(payload as any, { onConflict: "employee_code,duty_date" });
            if (error) throw error;
        },
        onMutate: async ({ employeeCode, dutyDate, dutyCode }) => {
            // Cancel any outgoing refetches so they don't overwrite our optimistic update
            const gridKey = scheduleKeys.grid(startDate, endDate);
            await queryClient.cancelQueries({ queryKey: gridKey });

            // Snapshot previous data for rollback
            const prev = queryClient.getQueryData<ScheduleEntry[]>(gridKey);

            // Optimistically update the single cell in cache
            queryClient.setQueryData<ScheduleEntry[]>(gridKey, (old) => {
                if (!old) return old;
                const normCode = employeeCode.trim().toUpperCase();
                const idx = old.findIndex(
                    (s) => s.employee_code.trim().toUpperCase() === normCode && s.duty_date === dutyDate
                );
                if (!dutyCode) {
                    // Deleting — remove the entry
                    if (idx >= 0) {
                        const updated = [...old];
                        updated.splice(idx, 1);
                        return updated;
                    }
                    return old;
                }
                if (idx >= 0) {
                    const updated = [...old];
                    updated[idx] = { ...updated[idx], duty_code: dutyCode, duty_description: DUTY_DESCRIPTIONS[dutyCode] || dutyCode };
                    return updated;
                }
                return [...old, {
                    id: `optimistic-${normCode}-${dutyDate}`,
                    employee_code: employeeCode,
                    employee_name: "",
                    duty_date: dutyDate,
                    duty_code: dutyCode,
                    duty_description: DUTY_DESCRIPTIONS[dutyCode] || dutyCode,
                } as ScheduleEntry];
            });

            return { prev };
        },
        onError: (_err, _vars, context) => {
            // Rollback optimistic update on failure
            if (context?.prev) {
                queryClient.setQueryData(scheduleKeys.grid(startDate, endDate), context.prev);
            }
            // Fix 4: Refetch only on error to restore true server state.
            // onSettled was removed — it triggered a full month re-fetch after every single cell save.
            queryClient.invalidateQueries({ queryKey: scheduleKeys.grid(startDate, endDate) });
        },
    });

    const { data: schedules = [], isLoading: schedulesLoading } = useQuery({
        queryKey: scheduleKeys.grid(startDate, endDate),
        ...SCHEDULE_QUERY_OPTIONS,
        // Fix 1: Parallel pagination — all pages fetched simultaneously instead of sequentially.
        // For a typical month (~1550 rows = 2 pages) this is ~2× faster than the old while-loop.
        queryFn: async () => {
            if (!startDate || !endDate) return [];

            const PAGE_SIZE = 1000;

            // Step 1: Lightweight HEAD request to get the total row count
            const { count, error: countError } = await supabase
                .from("employee_schedules" as any)
                .select("*", { count: "exact", head: true })
                .gte("duty_date", startDate)
                .lte("duty_date", endDate);

            if (countError) throw countError;

            const totalRows = count || 0;
            if (totalRows === 0) return [];

            // Step 2: Fetch all pages in parallel
            const pages = await Promise.all(
                Array.from({ length: Math.ceil(totalRows / PAGE_SIZE) }, (_, i) =>
                    supabase
                        .from("employee_schedules" as any)
                        .select("id, employee_code, duty_date, duty_code")
                        .gte("duty_date", startDate)
                        .lte("duty_date", endDate)
                        .order("duty_date")
                        .range(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1)
                        .then(({ data, error }) => {
                            if (error) throw error;
                            return data || [];
                        })
                )
            );

            return pages.flat() as unknown as ScheduleEntry[];
        },
        enabled: !!startDate && !!endDate,
    });

    /* ── Build employee list and schedule map ── */
    // Fix 3: Removed the pointless `employees = useMemo(() => profiles, [profiles])` wrapper — using profiles directly.

    /* ── O(1) grid lookup: key → duty_code (slim, no full row objects) ── */
    const scheduleMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const s of schedules) {
            const key = `${(s.employee_code || "").trim().toUpperCase()}|${s.duty_date}`;
            map.set(key, s.duty_code || "");
        }
        return map;
    }, [schedules]);

    const employeeRows = useMemo(() => {
        const codesMap = new Map<string, { code: string; name: string; team: string }>();

        for (const u of profiles) {
            if (!u.employee_id || !hasAssignedShift(u.current_shift)) continue;
            const code = u.employee_id.trim().toUpperCase();
            codesMap.set(code, {
                code,
                name: u.full_name || code,
                team: normalizeTeam(u.current_shift),
            });
        }

        return Array.from(codesMap.values());
    }, [profiles]);

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
                const matchesTeam = selectedTeams.includes(emp.team);
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

    const handleDutyChange = useCallback((
        empCode: string,
        empName: string,
        dateKey: string,
        newCode: string
    ) => {
        if (!newCode) return;
        const key = `${empCode}|${dateKey}`;
        const previousDutyCode = scheduleMap.get(key) || "";
        if (previousDutyCode === newCode) return;

        // Fire-and-forget — optimistic update makes it feel instant
        upsertSchedule.mutate(
            {
                employeeCode: empCode,
                employeeName: empName,
                dutyDate: dateKey,
                dutyCode: newCode,
            },
            {
                onSuccess: () => {
                    setLastScheduleChange({
                        employeeCode: empCode,
                        employeeName: empName,
                        dutyDate: dateKey,
                        previousDutyCode,
                        nextDutyCode: newCode,
                    });
                    toast({ title: "Updated", description: `Duty changed to ${newCode}` });
                    logSupervisorEdit({
                        action: "upsert",
                        table: "employee_schedules",
                        description: `Changed duty ${previousDutyCode || "(none)"}→${newCode} for ${empCode} on ${dateKey}`,
                        recordId: `${empCode}|${dateKey}`,
                        before: { duty_code: previousDutyCode },
                        after: { duty_code: newCode },
                    });
                },
                onError: (err: any) => {
                    toast({
                        title: "Update failed",
                        description: err?.message || "Error",
                        variant: "destructive",
                    });
                },
            }
        );
    }, [scheduleMap, upsertSchedule, toast]);

    const handleUndoLastChange = useCallback(() => {
        if (!lastScheduleChange) return;

        const restoredDuty = lastScheduleChange.previousDutyCode || "blank";
        upsertSchedule.mutate(
            {
                employeeCode: lastScheduleChange.employeeCode,
                employeeName: lastScheduleChange.employeeName,
                dutyDate: lastScheduleChange.dutyDate,
                dutyCode: lastScheduleChange.previousDutyCode,
            },
            {
                onSuccess: () => {
                    toast({
                        title: "Last change undone",
                        description: `Restored ${lastScheduleChange.employeeCode} on ${lastScheduleChange.dutyDate} to ${restoredDuty}.`,
                    });
                    logSupervisorEdit({
                        action: "upsert",
                        table: "employee_schedules",
                        description: `Undo: restored ${lastScheduleChange.employeeCode} on ${lastScheduleChange.dutyDate} to ${restoredDuty}`,
                        recordId: `${lastScheduleChange.employeeCode}|${lastScheduleChange.dutyDate}`,
                        before: { duty_code: lastScheduleChange.nextDutyCode },
                        after: { duty_code: lastScheduleChange.previousDutyCode },
                    });
                    setLastScheduleChange(null);
                },
                onError: (err: any) => {
                    toast({
                        title: "Undo failed",
                        description: err?.message || "Unable to restore the previous duty.",
                        variant: "destructive",
                    });
                },
            }
        );
    }, [lastScheduleChange, toast, upsertSchedule]);

    const handleSyncWithDatabase = useCallback(async () => {
        setIsSyncingDatabase(true);
        try {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["duty-management-profiles"] }),
                queryClient.invalidateQueries({ queryKey: scheduleKeys.all }),
            ]);
            toast({
                title: "Synced with database",
                description: "The latest schedule and employee records have been reloaded.",
            });
        } catch (err: any) {
            toast({
                title: "Sync failed",
                description: err?.message || "Unable to refresh data from the database.",
                variant: "destructive",
            });
        } finally {
            setIsSyncingDatabase(false);
        }
    }, [queryClient, toast]);

    const toggleTeam = (team: string) => {
        setSelectedTeams((prev) => prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team]);
    };
    const toggleAllTeams = () => {
        setSelectedTeams((prev) => prev.length === teamOptions.length ? [] : [...teamOptions]);
    };
    const monthLabel = new Date(currentYear, currentMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const isLoading = profilesLoading || schedulesLoading;

    /* ── Row virtualizer ── */
    const rowVirtualizer = useVirtualizer({
        count: filteredEmployees.length,
        getScrollElement: () => gridRef.current,
        estimateSize: () => ROW_PX,
        overscan: ROW_OVERSCAN,
    });

    /* ── Column virtualizer — only render visible date columns (like a spreadsheet) ── */
    const COL_PX = 112; // w-28 = 7rem = 112px
    const EMP_ID_W = isMobile ? 92 : 128;
    const TEAM_W = isMobile ? 40 : 64;
    const NAME_W = isMobile ? 180 : 208;
    const LEFT_PANEL_W = EMP_ID_W + TEAM_W + NAME_W;
    const COL_OVERSCAN = 3;
    const colVirtualizer = useVirtualizer({
        horizontal: true,
        count: dates.length,
        getScrollElement: () => gridRef.current,
        estimateSize: () => COL_PX,
        overscan: COL_OVERSCAN,
    });

    const virtualRows = rowVirtualizer.getVirtualItems();
    const totalHeight = rowVirtualizer.getTotalSize();

    // Reset virtualizer scroll when filters/month change
    useEffect(() => {
        if (gridRef.current) gridRef.current.scrollTop = 0;
        if (namesRef.current) namesRef.current.scrollTop = 0;
        rowVirtualizer.scrollToIndex(0);
    }, [currentMonth, currentYear, searchQuery, selectedTeams, sortBy]);

    useEffect(() => {
        updateGridScrollMetrics();
    }, [filteredEmployees.length, dates.length, isLoading, updateGridScrollMetrics]);

    useEffect(() => {
        const handleResize = () => updateGridScrollMetrics();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [updateGridScrollMetrics]);

    const horizontalMaxScroll = Math.max(0, gridScrollMetrics.scrollWidth - gridScrollMetrics.clientWidth);
    const rawThumbWidth = horizontalMaxScroll <= 0 || gridScrollMetrics.trackWidth <= 0
        ? gridScrollMetrics.trackWidth
        : (gridScrollMetrics.clientWidth / gridScrollMetrics.scrollWidth) * gridScrollMetrics.trackWidth;
    const thumbWidth = gridScrollMetrics.trackWidth > 0
        ? Math.min(gridScrollMetrics.trackWidth, Math.max(92, rawThumbWidth))
        : 0;
    const thumbTravel = Math.max(0, gridScrollMetrics.trackWidth - thumbWidth);
    const thumbLeft = horizontalMaxScroll > 0 && thumbTravel > 0
        ? (gridScrollMetrics.scrollLeft / horizontalMaxScroll) * thumbTravel
        : 0;

    const handleHorizontalTrackMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget || horizontalMaxScroll <= 0) return;

        const track = horizontalTrackRef.current;
        if (!track) return;

        const rect = track.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const nextThumbLeft = Math.max(0, Math.min(clickX - thumbWidth / 2, thumbTravel));
        const nextScrollLeft = thumbTravel > 0
            ? (nextThumbLeft / thumbTravel) * horizontalMaxScroll
            : 0;

        setGridHorizontalScroll(nextScrollLeft);
    }, [horizontalMaxScroll, setGridHorizontalScroll, thumbTravel, thumbWidth]);

    const handleHorizontalThumbMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();

        if (horizontalMaxScroll <= 0 || thumbTravel <= 0) return;

        const startX = event.clientX;
        const startScrollLeft = gridRef.current?.scrollLeft || 0;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaScroll = (deltaX / thumbTravel) * horizontalMaxScroll;
            setGridHorizontalScroll(startScrollLeft + deltaScroll);
        };

        const handleMouseUp = () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        };

        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
    }, [horizontalMaxScroll, setGridHorizontalScroll, thumbTravel]);

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
            <div className="flex flex-col -m-4 md:-m-6" style={{ height: isMobile ? "calc((100vh - 64px) / 0.72)" : "calc(100vh - 64px)", zoom: isMobile ? 0.72 : undefined }}>
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
                                className="pl-10 pr-8 h-9"
                            />
                            {searchQuery && (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={() => setSearchQuery("")}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            )}
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

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSyncWithDatabase}
                            disabled={isSyncingDatabase || upsertSchedule.isPending}
                            className="gap-2"
                        >
                            {isSyncingDatabase ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                            Sync
                        </Button>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleUndoLastChange}
                            disabled={!lastScheduleChange || upsertSchedule.isPending}
                            className="gap-2"
                        >
                            <RotateCcw className="h-4 w-4" />
                            Undo
                        </Button>

                        {upsertSchedule.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>

                    {(searchQuery || selectedTeams.length < teamOptions.length) && (
                        <p className="text-xs text-muted-foreground mt-2">
                            Showing {filteredEmployees.length} of {employeeRows.length} employees
                        </p>
                    )}

                    {lastScheduleChange ? (
                        <p className="text-xs text-muted-foreground mt-2">
                            Last edit: {lastScheduleChange.employeeCode} on {lastScheduleChange.dutyDate} changed from {lastScheduleChange.previousDutyCode || "blank"} to {lastScheduleChange.nextDutyCode}.
                        </p>
                    ) : null}
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
                    <>
                        {/* Inject loader keyframes — scoped to this component */}
                        <style>{`
                            .dm-loader {
                                width: 56px;
                                height: 28px;
                                --c: no-repeat radial-gradient(farthest-side, hsl(var(--primary)) 93%, transparent);
                                background:
                                    var(--c) 0%   0%,
                                    var(--c) 50%  0%,
                                    var(--c) 100% 0%;
                                background-size: 11px 11px;
                                position: relative;
                                animation: dm-l4-0 1s linear infinite alternate;
                            }
                            .dm-loader::before {
                                content: "";
                                position: absolute;
                                width: 11px;
                                height: 16px;
                                background: hsl(var(--primary));
                                left: 0;
                                top: 0;
                                border-radius: 2px;
                                animation:
                                    dm-l4-1 1s  linear infinite alternate,
                                    dm-l4-2 0.5s cubic-bezier(0,200,.8,200) infinite;
                            }
                            @keyframes dm-l4-0 {
                                0%      { background-position: 0% 100%, 50% 0%,   100% 0%   }
                                8%,42%  { background-position: 0% 0%,   50% 0%,   100% 0%   }
                                50%     { background-position: 0% 0%,   50% 100%, 100% 0%   }
                                58%,92% { background-position: 0% 0%,   50% 0%,   100% 0%   }
                                100%    { background-position: 0% 0%,   50% 0%,   100% 100% }
                            }
                            @keyframes dm-l4-1 {
                                100% { left: calc(100% - 11px) }
                            }
                            @keyframes dm-l4-2 {
                                100% { top: -0.1px }
                            }
                        `}</style>

                        <div className="flex-1 flex items-center justify-center">
                            <div className="flex flex-col items-center gap-8 px-6 py-10 text-center">
                                {/* New bouncing-dot loader */}
                                <div className="dm-loader" />

                                <div className="space-y-1.5">
                                    <h2 className="text-base font-semibold text-foreground">Loading Schedule Management</h2>
                                    <p className="text-sm text-muted-foreground max-w-xs">
                                        Fetching employee profiles and duty schedules. Please wait…
                                    </p>
                                </div>

                                {/* Step indicators */}
                                <div className="flex flex-col gap-2 w-full max-w-xs">
                                    <div className="flex items-center gap-3">
                                        <div className={`h-2 w-2 rounded-full flex-shrink-0 ${profilesLoading ? "bg-primary animate-pulse" : "bg-green-500"}`} />
                                        <span className="text-xs text-muted-foreground text-left">
                                            {profilesLoading ? "Loading employee profiles…" : "Employee profiles loaded"}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className={`h-2 w-2 rounded-full flex-shrink-0 ${schedulesLoading ? "bg-primary animate-pulse" : profilesLoading ? "bg-muted" : "bg-green-500"}`} />
                                        <span className="text-xs text-muted-foreground text-left">
                                            {schedulesLoading ? "Loading duty schedules…" : profilesLoading ? "Waiting…" : "Duty schedules loaded"}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>

                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                        <div className="flex-1 flex overflow-hidden min-h-0">
                            {/* ── LEFT PANEL: Fixed employee columns (scrolls vertically only, synced) ── */}
                            <div
                                className="flex-shrink-0 flex flex-col border-r-2 border-gray-400 shadow-[3px_0_8px_rgba(0,0,0,0.08)] z-10 bg-background"
                                onWheel={(e) => {
                                    // Forward wheel events to the grid — the existing onGridScroll
                                    // handler will then sync namesRef.scrollTop automatically.
                                    if (gridRef.current) {
                                        gridRef.current.scrollTop += e.deltaY;
                                        e.preventDefault();
                                    }
                                }}
                            >
                                {/* Left header */}
                                <div className={`flex ${ROW_H} border-b-2 border-gray-400 bg-muted/60 flex-shrink-0`}>
                                    <div style={{ width: EMP_ID_W }} className="px-2 flex items-center justify-center border-r border-gray-300 shrink-0">
                                        <span className="font-semibold text-xs truncate">Emp ID</span>
                                    </div>
                                    <div style={{ width: TEAM_W }} className="px-1 flex items-center justify-center border-r border-gray-300 shrink-0">
                                        <span className="font-semibold text-xs">Tm</span>
                                    </div>
                                    <div style={{ width: NAME_W }} className="px-2 flex items-center shrink-0">
                                        <span className="font-semibold text-xs truncate">Name</span>
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
                                        <div className="relative" style={{ height: totalHeight }}>
                                            {virtualRows.map((virtualRow) => {
                                                const emp = filteredEmployees[virtualRow.index];
                                                const rowIndex = virtualRow.index;
                                                return (
                                                    <div
                                                        key={emp.code}
                                                        className={`flex ${ROW_H} border-b border-gray-200 dark:border-slate-700 transition-colors ${rowIndex % 2 === 0
                                                            ? "bg-white dark:bg-slate-900/55"
                                                            : "bg-slate-50/70 dark:bg-slate-800/55"
                                                            } hover:bg-blue-50/60 dark:hover:bg-blue-900/25`}
                                                        style={{
                                                            position: "absolute",
                                                            top: 0,
                                                            left: 0,
                                                            width: "100%",
                                                            height: ROW_PX,
                                                            transform: `translateY(${virtualRow.start}px)`,
                                                        }}
                                                    >
                                                        <div style={{ width: EMP_ID_W }} className="px-2 flex items-center border-r border-gray-200 shrink-0">
                                                            <span className="text-xs font-mono font-medium truncate">{emp.code}</span>
                                                        </div>
                                                        <div style={{ width: TEAM_W }} className="px-1 flex items-center justify-center border-r border-gray-200 shrink-0">
                                                            <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-gray-700 text-white text-[10px] font-semibold shadow-sm">
                                                                {emp.team === "GENERAL" ? "G" : emp.team}
                                                            </span>
                                                        </div>
                                                        <div style={{ width: NAME_W }} className="px-2 flex items-center shrink-0">
                                                            <span className="text-xs font-semibold truncate">{emp.name}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── RIGHT PANEL: fixed date header + duty cells ── */}
                            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                                <div
                                    ref={dateHeaderRef}
                                    className="shrink-0 overflow-x-auto overflow-y-hidden min-w-0 bg-background [&::-webkit-scrollbar]:hidden"
                                    style={{ scrollbarWidth: "none" }}
                                    onScroll={onDateHeaderScroll}
                                >
                                    <div
                                        className={`${ROW_H} border-b-2 border-gray-400 bg-background`}
                                        style={{ width: colVirtualizer.getTotalSize(), position: "relative" }}
                                    >
                                        {colVirtualizer.getVirtualItems().map((virtualCol) => {
                                            const date = dates[virtualCol.index];
                                            return (
                                                <div
                                                    key={date.key}
                                                    className={`absolute top-0 h-full box-border px-2 flex flex-col items-center justify-center border-r border-gray-300 ${date.isWeekend ? "bg-muted" : ""}`}
                                                    style={{
                                                        width: virtualCol.size,
                                                        transform: `translateX(${virtualCol.start}px)`,
                                                    }}
                                                >
                                                    <span className="font-semibold text-xs leading-tight">{date.label}</span>
                                                    <span className={`text-[10px] leading-tight ${date.isWeekend ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                                                        {date.dayOfWeek}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div
                                    ref={gridRef}
                                    className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar schedule-grid-scrollbar min-w-0"
                                    onScroll={onGridScroll}
                                >
                                    {/* Duty cells body — row + column virtualized */}
                                    <div className="relative" style={{ height: totalHeight, width: colVirtualizer.getTotalSize() }}>
                                        {virtualRows.map((virtualRow) => {
                                            const emp = filteredEmployees[virtualRow.index];
                                            const rowIndex = virtualRow.index;
                                            return (
                                                <div
                                                    key={emp.code}
                                                    className={`${ROW_H} border-b border-gray-200 dark:border-slate-700 transition-colors ${rowIndex % 2 === 0
                                                        ? "bg-white dark:bg-slate-900/55"
                                                        : "bg-slate-50/70 dark:bg-slate-800/55"
                                                        } hover:bg-blue-50/60 dark:hover:bg-blue-900/25`}
                                                    style={{
                                                        position: "absolute",
                                                        top: 0,
                                                        left: 0,
                                                        width: "100%",
                                                        height: ROW_PX,
                                                        transform: `translateY(${virtualRow.start}px)`,
                                                    }}
                                                >
                                                    {colVirtualizer.getVirtualItems().map((virtualCol) => {
                                                        const date = dates[virtualCol.index];
                                                        const cellKey = `${emp.code}|${date.key}`;
                                                        const duty = scheduleMap.get(cellKey) || "";
                                                        return (
                                                            <div
                                                                key={date.key}
                                                                className="absolute top-0 h-full box-border border-r border-gray-300"
                                                                style={{
                                                                    width: virtualCol.size,
                                                                    transform: `translateX(${virtualCol.start}px)`,
                                                                }}
                                                            >
                                                                <MemoizedDutyCell
                                                                    duty={duty}
                                                                    isSaving={false}
                                                                    isWeekend={date.isWeekend}
                                                                    empCode={emp.code}
                                                                    empName={emp.name}
                                                                    dateKey={date.key}
                                                                    onDutyChange={handleDutyChange}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="shrink-0 flex border-t border-slate-300 bg-slate-100/90">
                            <div style={{ width: LEFT_PANEL_W }} className="shrink-0 border-r border-slate-300 bg-slate-200/70" />
                            <div className={`flex-1 ${isMobile ? "px-2 py-1" : "px-3 py-2"}`}>
                                <div
                                    ref={horizontalTrackRef}
                                    onMouseDown={handleHorizontalTrackMouseDown}
                                    className={`relative rounded-full bg-slate-300/90 shadow-inner ${isMobile ? "h-3" : "h-6"}`}
                                >
                                    <div
                                        className={`absolute rounded-full bg-slate-700 shadow-[0_5px_14px_rgba(15,23,42,0.24)] ${isMobile ? "top-0.5 h-2" : "top-0.5 h-5"} ${horizontalMaxScroll > 0 ? "cursor-grab" : "cursor-not-allowed opacity-50"}`}
                                        onMouseDown={handleHorizontalThumbMouseDown}
                                        style={{
                                            width: `${Math.max(thumbWidth, isMobile ? 28 : 48)}px`,
                                            transform: `translateX(${thumbLeft}px)`,
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
