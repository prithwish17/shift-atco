import { useEffect, useMemo, useRef, useState } from "react";
import { endOfMonth, format, parseISO } from "date-fns";
import {
    AlertTriangle,
    ArrowRight,
    CalendarDays,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    ClipboardList,
    Layers,
    Loader2,
    Scissors,
    Search,
    Sheet as SheetIcon,
    Users,
    Wallet,
    X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CompOffPicker } from "@/components/leave/CompOffPicker";
import { useCompOffCandidates } from "@/hooks/useCompOffCandidates";
import { useHolidaysByYear } from "@/hooks/useHolidayDashboard";
import {
    monthsForItems,
    useBackfillLeaveEntry,
    useEmployeeLeaveBalance,
    useLeaveBacklog,
    useOpenBackfillBatch,
    useCloseBackfillBatch,
    usePushLeaveToSheet,
    type BackfillConflict,
    type SheetPushResult,
} from "@/hooks/useLeaveBacklog";
import {
    DEFAULT_CL_BALANCE,
    LEAVE_TYPES,
    YEAR_LOOKBACK,
    getLeaveTypeLabel,
} from "@/lib/leaveConstants";
import {
    splitIntoLeaveSegments,
    type BacklogItem,
    type LeaveSegment,
} from "@/lib/leaveReconciliation";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: YEAR_LOOKBACK }, (_, i) => CURRENT_YEAR - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
    value: String(i),
    label: format(new Date(2000, i, 1), "MMMM"),
}));

/**
 * Leave types that draw on the CL bucket.
 *
 * Mirrors the filter in recompute_leave_balance() — keep the two in step, or the
 * balance shown here stops matching the one a recompute writes.
 */
const CL_FAMILY = new Set([
    "CL", "CL_CON", "CL_1ST", "CL_1ST_CON", "CL_2ND", "CL_2ND_CON",
]);

/** Half-day types need a single date; a multi-day run cannot be one of them. */
const HALF_DAY_TYPES = new Set(["CL_1ST", "CL_2ND"]);

/**
 * Why a segment cannot be recorded, or null if it can.
 * Shared by the single-entry form and per-employee bulk apply so the two agree.
 */
function segmentIssue(seg: LeaveSegment): string | null {
    if (HALF_DAY_TYPES.has(seg.leaveType) && seg.dates.length > 1) {
        return "half-day leave applies to a single date only";
    }
    if (seg.totalDays <= 0) return "every date is a closed holiday — nothing to deduct";
    return null;
}

function fmt(date: string): string {
    try {
        return format(parseISO(date), "dd MMM yyyy");
    } catch {
        return date;
    }
}

function itemKey(item: BacklogItem): string {
    return `${item.employeeCode}:${item.startDate}:${item.endDate}`;
}

export default function LeaveBacklogPage() {
    const { toast } = useToast();
    const qc = useQueryClient();

    const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());
    const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
    const [search, setSearch] = useState("");
    const [groupBy, setGroupBy] = useState<"date" | "employee">("date");
    // Tracks collapsed employees, so groups start expanded.
    const [collapsedCodes, setCollapsedCodes] = useState<Set<string>>(new Set());

    const monthStart = format(new Date(selectedYear, selectedMonth, 1), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(new Date(selectedYear, selectedMonth, 1)), "yyyy-MM-dd");

    const { data, isLoading, error } = useLeaveBacklog(monthStart, monthEnd);
    const { data: holidays = [] } = useHolidaysByYear(selectedYear);

    const backfill = useBackfillLeaveEntry();
    const openBatch = useOpenBackfillBatch();
    const closeBatch = useCloseBackfillBatch();

    const [batchId, setBatchId] = useState<string | null>(null);
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const [leaveType, setLeaveType] = useState<string>("CL");
    const [reason, setReason] = useState("");
    const [compOffIds, setCompOffIds] = useState<string[]>([]);
    const [allowUsedOverride, setAllowUsedOverride] = useState(false);
    /** Assign a different leave type to different dates inside one run. */
    const [splitMode, setSplitMode] = useState(false);
    const [dateTypes, setDateTypes] = useState<Record<string, string>>({});
    /** Per-employee bulk apply, in the by-name view. */
    const [bulkType, setBulkType] = useState<string>("CL");
    const [bulkConfirmCode, setBulkConfirmCode] = useState<string | null>(null);
    const [bulkBusyCode, setBulkBusyCode] = useState<string | null>(null);
    const [conflict, setConflict] = useState<BackfillConflict | null>(null);
    const [clearedKeys, setClearedKeys] = useState<Set<string>>(new Set());
    const [sheetOpen, setSheetOpen] = useState(false);
    const [sheetPreview, setSheetPreview] = useState<SheetPushResult | null>(null);

    const typeRef = useRef<HTMLButtonElement>(null);

    const items = useMemo(() => {
        const all = data?.items ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return all;
        return all.filter(
            (i) =>
                i.employeeName.toLowerCase().includes(q) ||
                i.employeeCode.toLowerCase().includes(q) ||
                i.team.toLowerCase().includes(q),
        );
    }, [data?.items, search]);

    const active = useMemo(
        () => items.find((i) => itemKey(i) === activeKey) ?? null,
        [items, activeKey],
    );

    // One entry per person, their runs in date order, busiest people first — so a
    // supervisor can work through a single employee's whole history in one pass
    // rather than meeting the same name scattered down a date-ordered list.
    const employeeGroups = useMemo(() => {
        const map = new Map<
            string,
            { code: string; name: string; team: string; runs: BacklogItem[]; days: number }
        >();
        for (const item of items) {
            let group = map.get(item.employeeCode);
            if (!group) {
                group = {
                    code: item.employeeCode,
                    name: item.employeeName,
                    team: item.team,
                    runs: [],
                    days: 0,
                };
                map.set(item.employeeCode, group);
            }
            group.runs.push(item);
            group.days += item.dates.length;
        }
        return [...map.values()]
            .map((group) => ({
                ...group,
                runs: [...group.runs].sort((a, b) => a.startDate.localeCompare(b.startDate)),
            }))
            .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
    }, [items]);

    const allCollapsed =
        employeeGroups.length > 0 && collapsedCodes.size >= employeeGroups.length;

    const toggleGroup = (code: string) =>
        setCollapsedCodes((prev) => {
            const next = new Set(prev);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            return next;
        });

    const toggleAllGroups = () =>
        setCollapsedCodes(allCollapsed ? new Set() : new Set(employeeGroups.map((g) => g.code)));

    // Keep a selection alive as the queue shrinks under it.
    useEffect(() => {
        if (items.length === 0) {
            setActiveKey(null);
            return;
        }
        if (!activeKey || !items.some((i) => itemKey(i) === activeKey)) {
            setActiveKey(itemKey(items[0]));
        }
    }, [items, activeKey]);

    // A different item is a different decision — never carry a choice across.
    useEffect(() => {
        setReason("");
        setCompOffIds([]);
        setAllowUsedOverride(false);
        setConflict(null);
        setSplitMode(false);
        setDateTypes({});
    }, [activeKey]);

    const needsCompOff =
        leaveType === "COMP_OFF" || Object.values(dateTypes).includes("COMP_OFF");
    const { data: compOffCandidates = [], isLoading: compOffLoading } = useCompOffCandidates(
        needsCompOff ? active?.employeeCode : null,
    );

    const balance = useEmployeeLeaveBalance(active?.employeeCode, selectedYear);
    const pushToSheet = usePushLeaveToSheet();

    const isClosedHoliday = useMemo(() => {
        const chSet = new Set(
            holidays.filter((h) => h.type === "CH").map((h) => h.holiday_date as string),
        );
        return (date: string) => chSet.has(date);
    }, [holidays]);

    const holidayIdFor = useMemo(() => {
        const map = new Map<string, string>(
            holidays
                .filter((h) => h.type === "CH")
                .map((h) => [h.holiday_date as string, h.id as string]),
        );
        return (date: string) => map.get(date) ?? null;
    }, [holidays]);

    const segments = useMemo(() => {
        if (!active) return [];
        return splitIntoLeaveSegments(
            active.dates,
            leaveType,
            splitMode ? dateTypes : {},
            isClosedHoliday,
        );
    }, [active, leaveType, splitMode, dateTypes, isClosedHoliday]);

    // Union across segments, for the summary strip.
    const chDates = useMemo(
        () =>
            segments.flatMap((seg) =>
                seg.chDates.map((date) => ({ date, holiday_id: holidayIdFor(date) })),
            ),
        [segments, holidayIdFor],
    );
    const totalDays = useMemo(
        () => segments.reduce((sum, seg) => sum + seg.totalDays, 0),
        [segments],
    );
    /** One comp-off entry per deducted day, across every comp-off segment. */
    /**
     * CL days this run would add.
     *
     * Backfill never deducts — recompute_leave_balance() derives the balance
     * afterwards from approved history — so nothing stops a 13th CL day being
     * recorded. Showing what the run costs is the only guard the supervisor gets.
     */
    const clDaysInRun = useMemo(
        () => segments
            .filter((seg) => CL_FAMILY.has(seg.leaveType))
            .reduce((total, seg) => total + seg.totalDays, 0),
        [segments],
    );

    const clRemainingAfterRun = (balance.data?.cl.after ?? 0) - clDaysInRun;

    const compOffRequired = useMemo(
        () =>
            segments
                .filter((seg) => seg.leaveType === "COMP_OFF")
                .reduce((sum, seg) => sum + seg.totalDays, 0),
        [segments],
    );

    const badSegment = segments.find((seg) => segmentIssue(seg) !== null);

    const blockedReason = !active
        ? "Nothing selected"
        : segments.length === 0
          ? "Nothing to record"
          : badSegment
            ? `${fmt(badSegment.startDate)}–${fmt(badSegment.endDate)}: ${segmentIssue(badSegment)}`
            : compOffRequired > compOffIds.length
              ? `Select ${compOffRequired - compOffIds.length} more comp-off entr${
                    compOffRequired - compOffIds.length === 1 ? "y" : "ies"
                }`
              : null;

    const cleared = clearedKeys.size;
    const remaining = items.length;
    const progress = cleared + remaining > 0 ? (cleared / (cleared + remaining)) * 100 : 0;

    const ensureBatch = async (): Promise<string | null> => {
        if (batchId) return batchId;
        try {
            const batch = await openBatch.mutateAsync(
                `Backlog clearing — ${format(new Date(selectedYear, selectedMonth, 1), "MMMM yyyy")}`,
            );
            setBatchId(batch.id);
            return batch.id;
        } catch {
            // A batch is only for grouping/rollback; never block clearing on it.
            return null;
        }
    };

    /** Always preview first — this writes to a shared workbook, not just our DB. */
    const previewSheetPush = async () => {
        setSheetPreview(null);
        setSheetOpen(true);
        try {
            setSheetPreview(await pushToSheet.mutateAsync({ dryRun: true, year: selectedYear }));
        } catch (err) {
            setSheetOpen(false);
            toast({
                title: "Could not reach the sheet",
                description: err instanceof Error ? err.message : String(err),
                variant: "destructive",
            });
        }
    };

    const commitSheetPush = async () => {
        try {
            const result = await pushToSheet.mutateAsync({ dryRun: false, year: selectedYear });
            setSheetPreview(result);
            toast({
                title: "Sheet updated",
                description: `${result.cellsChanged} cell${result.cellsChanged === 1 ? "" : "s"} across ${
                    result.employees.changed
                } row${result.employees.changed === 1 ? "" : "s"}.`,
            });
        } catch (err) {
            toast({
                title: "Could not write to the sheet",
                description: err instanceof Error ? err.message : String(err),
                variant: "destructive",
            });
        }
    };

    const submit = async () => {
        if (!active || blockedReason) return;
        setConflict(null);

        const currentBatch = await ensureBatch();
        const key = itemKey(active);

        // Comp-off entries are handed out across the comp-off segments in order.
        let compOffCursor = 0;
        const recorded: string[] = [];

        try {
            for (const seg of segments) {
                const segCompOff =
                    seg.leaveType === "COMP_OFF"
                        ? compOffIds.slice(compOffCursor, compOffCursor + seg.totalDays)
                        : undefined;
                if (segCompOff) compOffCursor += seg.totalDays;

                const result = await backfill.mutateAsync({
                    employeeCode: active.employeeCode,
                    employeeName: active.employeeName,
                    leaveType: seg.leaveType,
                    startDate: seg.startDate,
                    endDate: seg.endDate,
                    totalDays: seg.totalDays,
                    reason: reason.trim() || undefined,
                    compOffRecordIds: segCompOff,
                    chCompOffDates:
                        seg.chDates.length > 0
                            ? seg.chDates.map((date) => ({ date, holiday_id: holidayIdFor(date) }))
                            : undefined,
                    batchId: currentBatch,
                    auditReason: reason.trim() || "Backfilled from roster",
                    allowUsedCompOff: allowUsedOverride,
                });

                if (!result.ok) {
                    // Segments already written stay written; the queue re-derives from
                    // the roster, so the cleared dates drop out and the rest remain.
                    setConflict(result.conflict ?? null);
                    if (recorded.length > 0) {
                        toast({
                            title: `Recorded ${recorded.length} of ${segments.length} parts`,
                            description: `Stopped at ${fmt(seg.startDate)}. ${result.conflict?.message ?? ""}`,
                            variant: "destructive",
                        });
                    }
                    return;
                }
                recorded.push(`${getLeaveTypeLabel(seg.leaveType)} ${fmt(seg.startDate)}`);
            }

            setClearedKeys((prev) => new Set(prev).add(key));
            toast({
                title:
                    segments.length === 1
                        ? `Cleared ${getLeaveTypeLabel(segments[0].leaveType)} for ${active.employeeName}`
                        : `Cleared ${segments.length} parts for ${active.employeeName}`,
                description: segments
                    .map(
                        (seg) =>
                            `${getLeaveTypeLabel(seg.leaveType)}: ${fmt(seg.startDate)}${
                                seg.startDate === seg.endDate ? "" : `–${fmt(seg.endDate)}`
                            }`,
                    )
                    .join(" · "),
            });

            // Keyboard flow: land on the next item with the type still armed.
            typeRef.current?.focus();
        } catch (err) {
            toast({
                title: "Could not clear this entry",
                description: err instanceof Error ? err.message : String(err),
                variant: "destructive",
            });
        }
    };

    /**
     * Record one leave type across every outstanding entry for a single employee.
     *
     * Entries are written one at a time through the same RPC as a single record, so
     * one bad run reports a conflict and the rest still go through. Runs that cannot
     * legally take the chosen type — a half-day spanning several dates, or a stretch
     * that is entirely closed holidays — are skipped and named in the summary rather
     * than silently dropped.
     *
     * COMP_OFF is deliberately unavailable here: it needs specific earned entries
     * chosen per leave, which is exactly what the picker is for.
     */
    const bulkApply = async (group: { code: string; name: string; runs: BacklogItem[] }) => {
        setBulkConfirmCode(null);
        setBulkBusyCode(group.code);

        const currentBatch = await ensureBatch();
        const done: string[] = [];
        const skipped: string[] = [];
        let failure: string | null = null;

        try {
            for (const run of group.runs) {
                const [seg] = splitIntoLeaveSegments(run.dates, bulkType, {}, isClosedHoliday);
                if (!seg) continue;

                const issue = segmentIssue(seg);
                if (issue) {
                    skipped.push(`${fmt(run.startDate)} (${issue})`);
                    continue;
                }

                const result = await backfill.mutateAsync({
                    employeeCode: run.employeeCode,
                    employeeName: run.employeeName,
                    leaveType: seg.leaveType,
                    startDate: seg.startDate,
                    endDate: seg.endDate,
                    totalDays: seg.totalDays,
                    reason: reason.trim() || undefined,
                    chCompOffDates:
                        seg.chDates.length > 0
                            ? seg.chDates.map((date) => ({ date, holiday_id: holidayIdFor(date) }))
                            : undefined,
                    batchId: currentBatch,
                    auditReason: reason.trim() || `Bulk backfill (${bulkType}) from roster`,
                });

                if (!result.ok) {
                    failure = `${fmt(run.startDate)}: ${result.conflict?.message ?? "rejected"}`;
                    break;
                }

                done.push(itemKey(run));
            }

            if (done.length > 0) {
                setClearedKeys((prev) => {
                    const next = new Set(prev);
                    for (const k of done) next.add(k);
                    return next;
                });
            }

            const parts = [`${done.length} recorded`];
            if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
            toast({
                title: failure
                    ? `Stopped part-way through ${group.name}`
                    : `${getLeaveTypeLabel(bulkType)} applied for ${group.name}`,
                description: [parts.join(" · "), failure, ...skipped].filter(Boolean).join(" — "),
                variant: failure ? "destructive" : undefined,
            });
        } catch (err) {
            toast({
                title: "Bulk apply failed",
                description: err instanceof Error ? err.message : String(err),
                variant: "destructive",
            });
        } finally {
            setBulkBusyCode(null);
        }
    };

    const finishBatch = async () => {
        if (!batchId) return;
        try {
            await closeBatch.mutateAsync({
                batchId,
                months: monthsForItems(data?.items ?? [{ startDate: monthStart, endDate: monthEnd }]),
            });
            toast({ title: "Batch closed", description: `${cleared} entries recorded.` });
            setBatchId(null);
            setClearedKeys(new Set());
            qc.invalidateQueries({ queryKey: ["leave-backlog"] });
        } catch (err) {
            toast({
                title: "Could not close the batch",
                description: err instanceof Error ? err.message : String(err),
                variant: "destructive",
            });
        }
    };

    /**
     * One backlog run. Shared by both views so the date list and the name list can
     * never drift apart; `compact` drops the name/code, which the employee header
     * already shows.
     */
    const renderRun = (item: BacklogItem, compact = false) => {
        const key = itemKey(item);
        const isActive = key === activeKey;
        return (
            <li key={key}>
                <button
                    type="button"
                    onClick={() => setActiveKey(key)}
                    className={`flex w-full items-start justify-between gap-3 p-3 text-left transition ${
                        isActive
                            ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                            : "hover:bg-slate-50"
                    }`}
                >
                    <div className="min-w-0">
                        {!compact && (
                            <>
                                <div className="font-semibold text-slate-900">{item.employeeName}</div>
                                <div className="text-xs text-muted-foreground">
                                    {item.employeeCode} · Team {item.team}
                                </div>
                            </>
                        )}
                        <div className={`flex flex-wrap gap-1 ${compact ? "" : "mt-1"}`}>
                            {[...new Set(item.dutyCodes)].map((code) => (
                                <Badge key={code} variant="outline" className="text-[10px]">
                                    {code}
                                </Badge>
                            ))}
                        </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-slate-600">
                        <div className="font-medium">{fmt(item.startDate)}</div>
                        {item.startDate !== item.endDate && <div>→ {fmt(item.endDate)}</div>}
                        <div className="mt-1 text-muted-foreground">{item.dates.length}d</div>
                    </div>
                </button>
            </li>
        );
    };

    return (
        <DashboardLayout role="supervisor">
            <div className="space-y-6">
                {/* Header */}
                <div className="rounded-3xl border border-slate-200 bg-gradient-to-r from-indigo-50 via-white to-slate-50 p-5 shadow-sm sm:p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-start gap-3">
                            <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-700">
                                <ClipboardList className="h-6 w-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
                                    Leave Backlog
                                </h1>
                                <p className="mt-1 text-sm text-muted-foreground sm:text-base">
                                    Leave the roster recorded but the leave register never captured.
                                    Give each one a type to bring it into the app.
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2 sm:items-center">
                            <Select
                                value={String(selectedMonth)}
                                onValueChange={(v) => setSelectedMonth(Number(v))}
                            >
                                <SelectTrigger className="h-10 w-[140px]">
                                    <SelectValue placeholder="Month" />
                                </SelectTrigger>
                                <SelectContent>
                                    {MONTH_OPTIONS.map((m) => (
                                        <SelectItem key={m.value} value={m.value}>
                                            {m.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select
                                value={String(selectedYear)}
                                onValueChange={(v) => setSelectedYear(Number(v))}
                            >
                                <SelectTrigger className="h-10 w-[110px]">
                                    <SelectValue placeholder="Year" />
                                </SelectTrigger>
                                <SelectContent>
                                    {YEAR_OPTIONS.map((y) => (
                                        <SelectItem key={y} value={String(y)}>
                                            {y}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 gap-2"
                                onClick={previewSheetPush}
                                disabled={pushToSheet.isPending}
                            >
                                {pushToSheet.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <SheetIcon className="h-4 w-4" />
                                )}
                                Send to Google Sheets
                            </Button>
                        </div>
                    </div>

                    {(cleared > 0 || remaining > 0) && (
                        <div className="mt-4">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-semibold text-slate-700">
                                    {cleared} cleared · {remaining} remaining
                                </span>
                                {batchId && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={finishBatch}
                                        disabled={closeBatch.isPending}
                                    >
                                        {closeBatch.isPending ? "Closing…" : "Close batch"}
                                    </Button>
                                )}
                            </div>
                            <Progress value={progress} className="mt-2 h-2" />
                        </div>
                    )}
                </div>

                {error && (
                    <Card className="border-red-200 bg-red-50">
                        <CardContent className="pb-4 pt-4 text-sm text-red-800">
                            {(error as Error).message || "Failed to load the backlog"}
                        </CardContent>
                    </Card>
                )}

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                    {/* Queue */}
                    <Card className="shadow-sm">
                        <CardHeader className="pb-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <CardTitle className="text-base">
                                    Outstanding ({items.length})
                                </CardTitle>
                                <div className="flex items-center gap-1">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={groupBy === "date" ? "secondary" : "ghost"}
                                        className="h-7 gap-1.5 px-2 text-xs"
                                        onClick={() => setGroupBy("date")}
                                    >
                                        <CalendarDays className="h-3.5 w-3.5" />
                                        By date
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={groupBy === "employee" ? "secondary" : "ghost"}
                                        className="h-7 gap-1.5 px-2 text-xs"
                                        onClick={() => setGroupBy("employee")}
                                    >
                                        <Users className="h-3.5 w-3.5" />
                                        By name
                                    </Button>
                                </div>
                            </div>
                            <CardDescription>
                                {groupBy === "employee"
                                    ? `${employeeGroups.length} employee${employeeGroups.length === 1 ? "" : "s"} — every outstanding leave gathered under each name.`
                                    : "Consecutive days are grouped into one application."}
                            </CardDescription>
                            {groupBy === "employee" && employeeGroups.length > 0 && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-fit px-2 text-xs"
                                    onClick={toggleAllGroups}
                                >
                                    {allCollapsed ? "Expand all" : "Collapse all"}
                                </Button>
                            )}
                            <div className="relative mt-2">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search name, code or team"
                                    className="pl-9"
                                />
                                {search && (
                                    <button
                                        type="button"
                                        onClick={() => setSearch("")}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-900"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Scanning the roster…
                                </div>
                            ) : items.length === 0 ? (
                                <div className="flex flex-col items-center gap-2 py-10 text-center">
                                    <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                                    <p className="font-semibold text-slate-900">
                                        Nothing outstanding this month
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Every roster leave day has matching leave data.
                                    </p>
                                </div>
                            ) : (
                                groupBy === "employee" ? (
                                    <div className="max-h-[32rem] space-y-2 overflow-y-auto rounded-lg border p-2">
                                        {employeeGroups.map((group) => {
                                            const collapsed = collapsedCodes.has(group.code);
                                            return (
                                                <div
                                                    key={group.code}
                                                    className="overflow-hidden rounded-lg border bg-white"
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleGroup(group.code)}
                                                        className="flex w-full items-center justify-between gap-3 bg-slate-50 p-2.5 text-left hover:bg-slate-100"
                                                    >
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            {collapsed ? (
                                                                <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                                                            ) : (
                                                                <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                                                            )}
                                                            <div className="min-w-0">
                                                                <div className="truncate font-semibold text-slate-900">
                                                                    {group.name}
                                                                </div>
                                                                <div className="text-xs text-muted-foreground">
                                                                    {group.code} · Team {group.team}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 items-center gap-1.5">
                                                            <Badge className="bg-indigo-100 text-[10px] text-indigo-800">
                                                                {group.runs.length}{" "}
                                                                {group.runs.length === 1 ? "entry" : "entries"}
                                                            </Badge>
                                                            <Badge variant="outline" className="text-[10px]">
                                                                {group.days}d
                                                            </Badge>
                                                        </div>
                                                    </button>
                                                    {!collapsed && (
                                                        <>
                                                            <div className="flex flex-wrap items-center gap-2 border-b bg-white p-2">
                                                                {bulkConfirmCode === group.code ? (
                                                                    <>
                                                                        <span className="text-xs text-slate-700">
                                                                            Record{" "}
                                                                            <strong>
                                                                                {getLeaveTypeLabel(bulkType)}
                                                                            </strong>{" "}
                                                                            for all {group.runs.length}{" "}
                                                                            {group.runs.length === 1
                                                                                ? "entry"
                                                                                : "entries"}
                                                                            ?
                                                                        </span>
                                                                        <Button
                                                                            type="button"
                                                                            size="sm"
                                                                            className="h-7 px-2 text-xs"
                                                                            onClick={() => bulkApply(group)}
                                                                        >
                                                                            Yes, record
                                                                        </Button>
                                                                        <Button
                                                                            type="button"
                                                                            size="sm"
                                                                            variant="ghost"
                                                                            className="h-7 px-2 text-xs"
                                                                            onClick={() =>
                                                                                setBulkConfirmCode(null)
                                                                            }
                                                                        >
                                                                            Cancel
                                                                        </Button>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <span className="text-xs text-muted-foreground">
                                                                            Apply to all:
                                                                        </span>
                                                                        <Select
                                                                            value={bulkType}
                                                                            onValueChange={setBulkType}
                                                                        >
                                                                            <SelectTrigger className="h-7 w-[180px] text-xs">
                                                                                <SelectValue />
                                                                            </SelectTrigger>
                                                                            <SelectContent>
                                                                                {LEAVE_TYPES.filter(
                                                                                    (t) =>
                                                                                        t.value !==
                                                                                        "COMP_OFF",
                                                                                ).map((t) => (
                                                                                    <SelectItem
                                                                                        key={t.value}
                                                                                        value={t.value}
                                                                                    >
                                                                                        {t.label}
                                                                                    </SelectItem>
                                                                                ))}
                                                                            </SelectContent>
                                                                        </Select>
                                                                        <Button
                                                                            type="button"
                                                                            size="sm"
                                                                            variant="outline"
                                                                            className="h-7 gap-1.5 px-2 text-xs"
                                                                            disabled={
                                                                                bulkBusyCode !== null
                                                                            }
                                                                            onClick={() =>
                                                                                setBulkConfirmCode(
                                                                                    group.code,
                                                                                )
                                                                            }
                                                                        >
                                                                            {bulkBusyCode ===
                                                                            group.code ? (
                                                                                <>
                                                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                                    Recording…
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    <Layers className="h-3.5 w-3.5" />
                                                                                    All {group.runs.length}
                                                                                </>
                                                                            )}
                                                                        </Button>
                                                                        <span className="text-[11px] text-muted-foreground">
                                                                            Comp-off must be picked per
                                                                            leave
                                                                        </span>
                                                                    </>
                                                                )}
                                                            </div>
                                                            <ul className="divide-y">
                                                                {group.runs.map((item) =>
                                                                    renderRun(item, true),
                                                                )}
                                                            </ul>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <ul className="max-h-[32rem] divide-y overflow-y-auto rounded-lg border">
                                        {items.map((item) => renderRun(item))}
                                    </ul>
                                )
                            )}
                        </CardContent>
                    </Card>

                    {/* Entry form */}
                    <Card className="shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">
                                {active ? active.employeeName : "Select an entry"}
                            </CardTitle>
                            <CardDescription>
                                {active ? (
                                    <span className="flex items-center gap-1.5">
                                        <CalendarDays className="h-3.5 w-3.5" />
                                        {fmt(active.startDate)}
                                        {active.startDate !== active.endDate && (
                                            <>
                                                <ArrowRight className="h-3 w-3" />
                                                {fmt(active.endDate)}
                                            </>
                                        )}
                                        <span className="text-muted-foreground">
                                            · {active.dates.length} day
                                            {active.dates.length === 1 ? "" : "s"}
                                        </span>
                                    </span>
                                ) : (
                                    "Pick a row on the left to record its leave type."
                                )}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {!active ? (
                                <p className="py-8 text-center text-sm text-muted-foreground">
                                    Nothing selected.
                                </p>
                            ) : (
                                <>
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <label className="text-sm font-medium">
                                                {splitMode ? "Default leave type" : "Leave type"}
                                            </label>
                                            {active.dates.length > 1 && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant={splitMode ? "secondary" : "ghost"}
                                                    className="h-7 gap-1.5 px-2 text-xs"
                                                    onClick={() => {
                                                        setSplitMode((on) => !on);
                                                        setDateTypes({});
                                                        setCompOffIds([]);
                                                    }}
                                                >
                                                    <Scissors className="h-3.5 w-3.5" />
                                                    {splitMode ? "Single type" : "Split by date"}
                                                </Button>
                                            )}
                                        </div>
                                        <Select value={leaveType} onValueChange={setLeaveType}>
                                            <SelectTrigger ref={typeRef} className="h-10">
                                                <SelectValue placeholder="Leave type" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {LEAVE_TYPES.map((t) => (
                                                    <SelectItem key={t.value} value={t.value}>
                                                        {t.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {splitMode && (
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium">
                                                Type per date
                                            </label>
                                            <p className="text-xs text-muted-foreground">
                                                Set a type on any date that differs. Neighbouring days
                                                sharing a type are recorded as one leave.
                                            </p>
                                            <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                                                {active.dates.map((date) => {
                                                    const isCh = holidays.some(
                                                        (h) =>
                                                            h.holiday_date === date && h.type === "CH",
                                                    );
                                                    return (
                                                        <li
                                                            key={date}
                                                            className="flex items-center justify-between gap-2 p-2"
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-medium text-slate-900">
                                                                    {fmt(date)}
                                                                </div>
                                                                {isCh && (
                                                                    <div className="text-[11px] text-violet-700">
                                                                        Closed holiday
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <Select
                                                                value={dateTypes[date] || leaveType}
                                                                onValueChange={(v) =>
                                                                    setDateTypes((prev) => ({
                                                                        ...prev,
                                                                        [date]: v,
                                                                    }))
                                                                }
                                                            >
                                                                <SelectTrigger className="h-8 w-[190px] text-xs">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {LEAVE_TYPES.map((t) => (
                                                                        <SelectItem
                                                                            key={t.value}
                                                                            value={t.value}
                                                                        >
                                                                            {t.label}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </div>
                                    )}

                                    {segments.length > 1 && (
                                        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 text-xs text-indigo-900">
                                            <div className="mb-1 font-semibold">
                                                Will be recorded as {segments.length} separate leaves
                                            </div>
                                            <ul className="space-y-0.5">
                                                {segments.map((seg) => (
                                                    <li key={seg.startDate}>
                                                        {getLeaveTypeLabel(seg.leaveType)} ·{" "}
                                                        {fmt(seg.startDate)}
                                                        {seg.startDate !== seg.endDate &&
                                                            ` – ${fmt(seg.endDate)}`}{" "}
                                                        ({seg.totalDays}d)
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {chDates.length > 0 && (
                                        <div className="rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-xs text-violet-900">
                                            {chDates.length} closed holiday
                                            {chDates.length === 1 ? "" : "s"} in this range
                                            {" "}({chDates.map((c) => fmt(c.date)).join(", ")}) —
                                            not deducted, and credited as comp-off.
                                        </div>
                                    )}

                                    <div className="rounded-lg bg-slate-50 p-2.5 text-sm">
                                        Deducting{" "}
                                        <span className="font-semibold text-slate-900">
                                            {totalDays} day{totalDays === 1 ? "" : "s"}
                                        </span>
                                    </div>

                                    {/*
                                      Advisory only. Backfill never checks or deducts a balance —
                                      recompute_leave_balance() derives it afterwards — so this is
                                      the supervisor's only warning before overdrawing someone.
                                    */}
                                    {balance.data && (
                                        <div
                                            className={`rounded-lg border p-2.5 text-sm ${
                                                clRemainingAfterRun < 0
                                                    ? "border-red-200 bg-red-50"
                                                    : "border-slate-200 bg-white"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="flex items-center gap-1.5 font-medium text-slate-900">
                                                    <Wallet className="h-3.5 w-3.5" />
                                                    Casual leave {selectedYear}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    RH {balance.data.rh.after} left
                                                </span>
                                            </div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {DEFAULT_CL_BALANCE} allowed ·{" "}
                                                {balance.data.cl.used} approved ·{" "}
                                                <span className="font-semibold text-slate-900">
                                                    {balance.data.cl.after} left
                                                </span>
                                                {clDaysInRun > 0 && (
                                                    <>
                                                        {" → "}
                                                        <span
                                                            className={
                                                                clRemainingAfterRun < 0
                                                                    ? "font-semibold text-red-700"
                                                                    : "font-semibold text-emerald-700"
                                                            }
                                                        >
                                                            {clRemainingAfterRun} after this run
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                            {clRemainingAfterRun < 0 && (
                                                <div className="mt-1.5 flex items-start gap-1.5 text-xs text-red-800">
                                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                                    <span>
                                                        This takes the employee{" "}
                                                        {Math.abs(clRemainingAfterRun)} day
                                                        {Math.abs(clRemainingAfterRun) === 1 ? "" : "s"}{" "}
                                                        past the {DEFAULT_CL_BALANCE}-day allowance.
                                                        Nothing blocks it — record it only if that is
                                                        genuinely what happened.
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {compOffRequired > 0 && (
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium">
                                                Comp-off entries to consume
                                            </label>
                                            <CompOffPicker
                                                candidates={compOffCandidates}
                                                selectedIds={compOffIds}
                                                onChange={setCompOffIds}
                                                requiredCount={compOffRequired}
                                                isLoading={compOffLoading}
                                                allowUsedOverride={allowUsedOverride}
                                                onAllowUsedOverrideChange={setAllowUsedOverride}
                                                allowExpired
                                            />
                                        </div>
                                    )}

                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium">
                                            Note <span className="text-muted-foreground">(optional)</span>
                                        </label>
                                        <Textarea
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            placeholder="Anything worth recording against this entry"
                                            rows={2}
                                        />
                                    </div>

                                    {conflict && (
                                        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                            <div>
                                                <div className="font-semibold">
                                                    {conflict.kind === "overlap"
                                                        ? "Leave already recorded"
                                                        : "Could not record this entry"}
                                                </div>
                                                <div>{conflict.message}</div>
                                                {conflict.kind === "overlap" && (
                                                    <div className="mt-1 text-xs">
                                                        Skip this row, or amend the existing request
                                                        from the leave register.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {blockedReason && !conflict && (
                                        <p className="text-xs text-amber-700">{blockedReason}</p>
                                    )}

                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            onClick={submit}
                                            disabled={!!blockedReason || backfill.isPending}
                                        >
                                            {backfill.isPending ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Recording…
                                                </>
                                            ) : (
                                                <>Record &amp; next</>
                                            )}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => {
                                                const idx = items.findIndex(
                                                    (i) => itemKey(i) === activeKey,
                                                );
                                                const next = items[idx + 1];
                                                if (next) setActiveKey(itemKey(next));
                                            }}
                                            disabled={backfill.isPending}
                                        >
                                            Skip
                                        </Button>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Sheet write-back: preview the diff, then commit it. */}
            <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <SheetIcon className="h-4 w-4" />
                            Send leave data to Google Sheets
                        </DialogTitle>
                        <DialogDescription>
                            {sheetPreview?.dryRun === false
                                ? "Written to the sheet."
                                : `Preview of what would change in the ${selectedYear} register. Nothing is written yet.`}
                        </DialogDescription>
                    </DialogHeader>

                    {pushToSheet.isPending && !sheetPreview ? (
                        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Building the payload and asking the sheet what would change…
                        </p>
                    ) : sheetPreview ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-2 text-center">
                                {[
                                    ["Employees matched", `${sheetPreview.employees.matched}/${sheetPreview.employees.received}`],
                                    ["Rows affected", String(sheetPreview.employees.changed)],
                                    ["Cells", String(sheetPreview.cellsChanged)],
                                ].map(([label, value]) => (
                                    <div key={label} className="rounded-lg border p-2.5">
                                        <div className="text-lg font-black text-slate-900">{value}</div>
                                        <div className="text-[11px] text-muted-foreground">{label}</div>
                                    </div>
                                ))}
                            </div>

                            {sheetPreview.cellsChanged === 0 && (
                                <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
                                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span>The sheet already matches the register — nothing to write.</span>
                                </p>
                            )}

                            {sheetPreview.employees.unmatched > 0 && (
                                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span>
                                        {sheetPreview.employees.unmatched} employee
                                        {sheetPreview.employees.unmatched === 1 ? "" : "s"} could not be
                                        matched to a row — EMP NO missing from the sheet, or the name
                                        disagrees. They are skipped, never guessed at.
                                    </span>
                                </p>
                            )}

                            {!!sheetPreview.skippedCategories?.length && (
                                <p className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-muted-foreground">
                                    No column on the sheet for:{" "}
                                    {sheetPreview.skippedCategories
                                        .map((c) => `${c.count} ${c.category}`)
                                        .join(", ")}
                                    .
                                </p>
                            )}

                            {sheetPreview.cellsChanged > 0 && (
                                <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border text-xs">
                                    {sheetPreview.results
                                        .filter((r) => r.cellsChanged || r.warnings.length)
                                        .slice(0, 60)
                                        .map((r) => (
                                            <li key={r.empId} className="p-2.5">
                                                <div className="font-semibold text-slate-900">
                                                    {r.name}{" "}
                                                    <span className="font-normal text-muted-foreground">
                                                        · row {r.row} · {r.cellsChanged} cell
                                                        {r.cellsChanged === 1 ? "" : "s"}
                                                    </span>
                                                </div>
                                                {r.changes?.slice(0, 6).map((c) => (
                                                    <div key={c.cell} className="mt-0.5 text-muted-foreground">
                                                        <span className="font-mono">{c.cell}</span> {c.section}:{" "}
                                                        {c.from || "—"} → {c.to || "—"}
                                                    </div>
                                                ))}
                                                {r.warnings.map((w) => (
                                                    <div key={w} className="mt-0.5 text-amber-700">! {w}</div>
                                                ))}
                                            </li>
                                        ))}
                                </ul>
                            )}
                        </div>
                    ) : null}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSheetOpen(false)}>
                            Close
                        </Button>
                        <Button
                            onClick={commitSheetPush}
                            disabled={
                                pushToSheet.isPending ||
                                !sheetPreview ||
                                sheetPreview.dryRun === false ||
                                sheetPreview.cellsChanged === 0
                            }
                        >
                            {pushToSheet.isPending && sheetPreview ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Writing…
                                </>
                            ) : (
                                `Write ${sheetPreview?.cellsChanged ?? 0} cell${
                                    sheetPreview?.cellsChanged === 1 ? "" : "s"
                                }`
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
}
