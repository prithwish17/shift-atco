import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertTriangle, GraduationCap, LayoutGrid, List, RefreshCw, Search, Undo2,
} from 'lucide-react';

import { DashboardLayout } from '@/components/DashboardLayout';
import { GmExtensionAlert } from '@/components/ojt/GmExtensionAlert';
import { OjtProgressCard } from '@/components/ojt/OjtProgressCard';
import { formatOjtDate } from '@/components/ojt/formatOjtDate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsMobile } from '@/hooks/use-mobile';
import {
    useOjtProgressRecords, useSyncOjtData, useUpdateOjtOverride,
} from '@/hooks/useOjtProgress';
import {
    computeProgress, formatDaysLeft, formatOjtHours, formatOjtRatio,
    getOjtBandClass, getOjtBandLabel, getOjtRatioTextClass,
    parseOjtDaysInput, parseOjtHoursInput,
} from '@/domain/ojt';
import type { OjtBand, OjtOverrideUpdate, OjtProgressRecord } from '@/domain/ojt';

type ViewMode = 'list' | 'card';
type BandFilter = 'all' | OjtBand | 'GM_EXTENSION';

const VIEW_STORAGE_KEY = 'ojt-progress-view';

const BAND_FILTERS: Array<{ value: BandFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'ON_TRACK', label: 'On Track' },
    { value: 'WATCH', label: 'Watch' },
    { value: 'CRITICAL', label: 'Critical' },
    { value: 'DEADLINE_PASSED', label: 'Deadline Passed' },
    { value: 'HOURS_COMPLETE', label: 'Completed' },
    { value: 'AWAITING_START_DATE', label: 'No Start Date' },
];

/* ─── Edit dialog ─────────────────────────────────────────────────────────── */

interface EditForm {
    startDate: string;
    requiredHours: string;
    requiredDays: string;
    performedHours: string;
    performedDays: string;
    note: string;
}

function toForm(record: OjtProgressRecord): EditForm {
    // Seed strictly from the override side. A blank field means "follow the
    // sheet", so seeding from the resolved value would turn a mere reopen-and-
    // save into a silent override of every field.
    return {
        startDate: record.overrideStartDate ?? '',
        requiredHours: record.overrideRequiredHours !== null ? formatOjtHours(record.overrideRequiredHours) : '',
        requiredDays: record.overrideRequiredDays !== null ? String(record.overrideRequiredDays) : '',
        performedHours: record.overridePerformedHours !== null ? formatOjtHours(record.overridePerformedHours) : '',
        performedDays: record.overridePerformedDays !== null ? String(record.overridePerformedDays) : '',
        note: record.overrideNote ?? '',
    };
}

function SheetHint({ label, value }: { label: string; value: string }) {
    return (
        <p className="text-[11px] text-muted-foreground">
            {label}: <span className="font-medium">{value}</span> · leave blank to follow the sheet
        </p>
    );
}

function EditOjtDialog({
    record,
    open,
    onOpenChange,
}: {
    record: OjtProgressRecord | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [form, setForm] = useState<EditForm>({
        startDate: '', requiredHours: '', requiredDays: '', performedHours: '', performedDays: '', note: '',
    });
    const [error, setError] = useState<string | null>(null);
    const updateOverride = useUpdateOjtOverride();

    useEffect(() => {
        if (record && open) {
            setForm(toForm(record));
            setError(null);
        }
    }, [record, open]);

    // Live preview: editing the start date moves the deadline, so show the
    // consequence before the supervisor commits to it.
    const preview = useMemo(() => {
        if (!record) return null;

        const hours = parseOjtHoursInput(form.requiredHours);
        const performed = parseOjtHoursInput(form.performedHours);
        const days = parseOjtDaysInput(form.requiredDays);
        const performedDays = parseOjtDaysInput(form.performedDays);

        if ([hours, performed, days, performedDays].some((r) => r.kind === 'invalid')) return null;

        return computeProgress({
            requiredHours: hours.kind === 'value' ? hours.hours : record.sheetRequiredHours,
            requiredDays: days.kind === 'value' ? days.days : record.sheetRequiredDays,
            performedHours: performed.kind === 'value' ? performed.hours : record.sheetPerformedHours,
            performedDays: performedDays.kind === 'value' ? performedDays.days : record.sheetPerformedDays,
            startDate: form.startDate.trim() || record.sheetStartDate,
        });
    }, [record, form]);

    if (!record) return null;

    const handleSave = () => {
        const hours = parseOjtHoursInput(form.requiredHours);
        const performed = parseOjtHoursInput(form.performedHours);
        const days = parseOjtDaysInput(form.requiredDays);
        const performedDays = parseOjtDaysInput(form.performedDays);

        if (hours.kind === 'invalid' || performed.kind === 'invalid') {
            setError('Hours must look like 86:30 or 86.5.');
            return;
        }
        if (days.kind === 'invalid' || performedDays.kind === 'invalid') {
            setError('Days must be a whole number.');
            return;
        }

        const startDate = form.startDate.trim();
        if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            setError('Start date must be a valid date.');
            return;
        }

        const updates: OjtOverrideUpdate = {
            override_start_date: startDate || null,
            override_required_hours: hours.kind === 'value' ? hours.hours : null,
            override_required_days: days.kind === 'value' ? days.days : null,
            override_performed_hours: performed.kind === 'value' ? performed.hours : null,
            override_performed_days: performedDays.kind === 'value' ? performedDays.days : null,
            override_note: form.note.trim() || null,
        };

        updateOverride.mutate(
            { empId: record.empId, unit: record.unit, employeeName: record.employeeName, updates },
            { onSuccess: () => onOpenChange(false) },
        );
    };

    const handleRevertAll = () => {
        updateOverride.mutate(
            {
                empId: record.empId,
                unit: record.unit,
                employeeName: record.employeeName,
                updates: {
                    override_start_date: null,
                    override_required_hours: null,
                    override_required_days: null,
                    override_performed_hours: null,
                    override_performed_days: null,
                    override_note: null,
                },
            },
            { onSuccess: () => onOpenChange(false) },
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{record.employeeName}</DialogTitle>
                    <DialogDescription>
                        {record.empId} · {record.unit}
                        {record.sheetSyncedAt && (
                            <> · sheet last synced {formatOjtDate(record.sheetSyncedAt.slice(0, 10))}</>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="ojt-start-date">Date of start of OJT</Label>
                        <Input
                            id="ojt-start-date"
                            type="date"
                            value={form.startDate}
                            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                        />
                        <p className="text-[11px] text-rose-700 dark:text-rose-400">
                            A date entered here is absolute — the twice-daily sheet sync will never overwrite it.
                            Clear the field to hand control back to the sheet
                            {record.sheetStartDate ? ` (${formatOjtDate(record.sheetStartDate)})` : ''}.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="ojt-required-hours">Required hours</Label>
                            <Input
                                id="ojt-required-hours"
                                inputMode="decimal"
                                placeholder="90 or 90:00"
                                value={form.requiredHours}
                                onChange={(e) => setForm((f) => ({ ...f, requiredHours: e.target.value }))}
                            />
                            <SheetHint label="Sheet" value={formatOjtHours(record.sheetRequiredHours)} />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="ojt-performed-hours">Performed hours</Label>
                            <Input
                                id="ojt-performed-hours"
                                inputMode="decimal"
                                placeholder="58:30"
                                value={form.performedHours}
                                onChange={(e) => setForm((f) => ({ ...f, performedHours: e.target.value }))}
                            />
                            <SheetHint label="Sheet" value={formatOjtHours(record.sheetPerformedHours)} />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="ojt-required-days">Required duty days</Label>
                            <Input
                                id="ojt-required-days"
                                inputMode="numeric"
                                placeholder="45"
                                value={form.requiredDays}
                                onChange={(e) => setForm((f) => ({ ...f, requiredDays: e.target.value }))}
                            />
                            <SheetHint label="Sheet" value={String(record.sheetRequiredDays ?? '—')} />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="ojt-performed-days">Performed duty days</Label>
                            <Input
                                id="ojt-performed-days"
                                inputMode="numeric"
                                placeholder="96"
                                value={form.performedDays}
                                onChange={(e) => setForm((f) => ({ ...f, performedDays: e.target.value }))}
                            />
                            <SheetHint label="Sheet" value={String(record.sheetPerformedDays ?? '—')} />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="ojt-note">Note (optional)</Label>
                        <Textarea
                            id="ojt-note"
                            rows={2}
                            placeholder="Why this record was adjusted"
                            value={form.note}
                            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                        />
                    </div>

                    {preview && (
                        <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                            <p className="mb-1.5 font-medium">After saving</p>
                            <div className="grid grid-cols-2 gap-y-1 text-muted-foreground">
                                <span>Deadline</span>
                                <span className="text-right font-medium text-foreground">{formatOjtDate(preview.deadline)}</span>
                                <span>Hours left</span>
                                <span className="text-right font-medium text-foreground">{formatOjtHours(preview.hoursLeft)}</span>
                                <span>Days left</span>
                                <span className="text-right font-medium text-foreground">{formatDaysLeft(preview.daysLeft)}</span>
                                <span>Required rate</span>
                                <span className={`text-right font-medium ${getOjtRatioTextClass(preview.band)}`}>
                                    {formatOjtRatio(preview.ratio)} hrs/day
                                </span>
                                <span>Status</span>
                                <span className="text-right">
                                    <Badge variant="outline" className={`rounded-full text-[10px] ${getOjtBandClass(preview.band)}`}>
                                        {getOjtBandLabel(preview.band)}
                                    </Badge>
                                </span>
                            </div>
                        </div>
                    )}

                    {error && <p className="text-xs font-medium text-destructive">{error}</p>}
                </div>

                <DialogFooter className="gap-2 sm:justify-between">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={handleRevertAll}
                        disabled={updateOverride.isPending}
                        className="text-muted-foreground"
                    >
                        <Undo2 className="mr-2 h-4 w-4" />
                        Revert all to sheet
                    </Button>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={handleSave} disabled={updateOverride.isPending}>
                            {updateOverride.isPending ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function OjtProgress() {
    const { data: records = [], isLoading, error } = useOjtProgressRecords();
    const syncOjtData = useSyncOjtData();
    const isMobile = useIsMobile();

    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search, 250);
    const [unitFilter, setUnitFilter] = useState('all');
    const [bandFilter, setBandFilter] = useState<BandFilter>('all');
    const [view, setView] = useState<ViewMode | null>(null);
    const [editing, setEditing] = useState<OjtProgressRecord | null>(null);

    // Card on phones, list on desktop, unless the user has chosen otherwise.
    useEffect(() => {
        if (view !== null) return;
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_STORAGE_KEY) : null;
        setView(stored === 'list' || stored === 'card' ? stored : (isMobile ? 'card' : 'list'));
    }, [isMobile, view]);

    const setViewMode = (next: ViewMode) => {
        setView(next);
        try {
            window.localStorage.setItem(VIEW_STORAGE_KEY, next);
        } catch {
            // private browsing — the default is fine
        }
    };

    const units = useMemo(
        () => [...new Set(records.map((r) => r.unit).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
        [records],
    );

    const searchFiltered = useMemo(() => {
        const query = debouncedSearch.trim().toLowerCase();

        return records.filter((record) => {
            if (unitFilter !== 'all' && record.unit !== unitFilter) return false;
            if (!query) return true;

            return [
                record.employeeName, record.empId, record.unit,
                record.designation || '', record.currentStation || '',
                getOjtBandLabel(record.band),
            ].join(' ').toLowerCase().includes(query);
        });
    }, [records, debouncedSearch, unitFilter]);

    const counts = useMemo(() => {
        const byBand = searchFiltered.reduce<Record<string, number>>((acc, record) => {
            acc[record.band] = (acc[record.band] || 0) + 1;
            return acc;
        }, {});

        return {
            ...byBand,
            all: searchFiltered.length,
            GM_EXTENSION: searchFiltered.filter((r) => r.requiresGmExtension).length,
        };
    }, [searchFiltered]);

    const visible = useMemo(() => {
        const filtered = bandFilter === 'all'
            ? searchFiltered
            : bandFilter === 'GM_EXTENSION'
                ? searchFiltered.filter((r) => r.requiresGmExtension)
                : searchFiltered.filter((r) => r.band === bandFilter);

        // Escalations first, then the tightest schedules.
        return [...filtered].sort((a, b) => {
            if (a.requiresGmExtension !== b.requiresGmExtension) return a.requiresGmExtension ? -1 : 1;
            if (a.ratio !== null && b.ratio !== null && a.ratio !== b.ratio) return b.ratio - a.ratio;
            if (a.ratio !== b.ratio) return a.ratio === null ? 1 : -1;
            return a.employeeName.localeCompare(b.employeeName);
        });
    }, [searchFiltered, bandFilter]);

    const escalations = useMemo(() => records.filter((r) => r.requiresGmExtension), [records]);

    return (
        <DashboardLayout role="supervisor">
            <div className="space-y-4 p-3 sm:p-4 md:p-6">
                {/* Header */}
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1.5">
                        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-950/40 dark:text-indigo-200">
                            <GraduationCap className="h-3.5 w-3.5" />
                            Supervisor Console
                        </div>
                        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">OJT Progress</h1>
                        <p className="max-w-2xl text-[13px] leading-5 text-muted-foreground">
                            Hours against deadline for every trainee, synced from the training sheet at 13:00 and 19:00 IST.
                            For pre-board and board milestones see{' '}
                            <Link to="/supervisor/trainees" className="font-medium underline underline-offset-2">
                                Trainee Details
                            </Link>.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex rounded-lg border p-0.5">
                            <Button
                                type="button"
                                variant={view === 'list' ? 'secondary' : 'ghost'}
                                size="sm"
                                className="h-8 px-2.5"
                                onClick={() => setViewMode('list')}
                                aria-pressed={view === 'list'}
                            >
                                <List className="h-4 w-4" />
                                <span className="ml-1.5 hidden sm:inline">List</span>
                            </Button>
                            <Button
                                type="button"
                                variant={view === 'card' ? 'secondary' : 'ghost'}
                                size="sm"
                                className="h-8 px-2.5"
                                onClick={() => setViewMode('card')}
                                aria-pressed={view === 'card'}
                            >
                                <LayoutGrid className="h-4 w-4" />
                                <span className="ml-1.5 hidden sm:inline">Cards</span>
                            </Button>
                        </div>

                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => syncOjtData.mutate()}
                            disabled={syncOjtData.isPending}
                        >
                            <RefreshCw className={`h-4 w-4 ${syncOjtData.isPending ? 'animate-spin' : ''}`} />
                            <span className="ml-1.5 hidden sm:inline">Sync now</span>
                        </Button>
                    </div>
                </div>

                {/* Escalation summary */}
                {escalations.length > 0 && (
                    <Card className="border-rose-300 bg-rose-50/60 dark:border-rose-900/70 dark:bg-rose-950/20">
                        <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-2.5">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                                <div>
                                    <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                                        {escalations.length} trainee{escalations.length === 1 ? '' : 's'} need GM (ATM) extension
                                    </p>
                                    <p className="text-xs text-rose-800/80 dark:text-rose-200/80">
                                        Under 15 days left and burning above 1 hr/day: {escalations.map((r) => r.employeeName).join(', ')}
                                    </p>
                                </div>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 shrink-0 border-rose-300 dark:border-rose-900"
                                onClick={() => setBandFilter('GM_EXTENSION')}
                            >
                                Show only these
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {/* Controls */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search name, employee id, unit…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-9 pl-8"
                        />
                    </div>
                    <Select value={unitFilter} onValueChange={setUnitFilter}>
                        <SelectTrigger className="h-9 sm:w-44">
                            <SelectValue placeholder="All units" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All units</SelectItem>
                            {units.map((unit) => (
                                <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex flex-wrap gap-1.5">
                    {counts.GM_EXTENSION > 0 && (
                        <button
                            type="button"
                            onClick={() => setBandFilter(bandFilter === 'GM_EXTENSION' ? 'all' : 'GM_EXTENSION')}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                                bandFilter === 'GM_EXTENSION'
                                    ? 'border-rose-500 bg-rose-600 text-white'
                                    : 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200'
                            }`}
                        >
                            <AlertTriangle className="h-3 w-3" />
                            Needs GM Extension
                            <span className="tabular-nums opacity-70">{counts.GM_EXTENSION}</span>
                        </button>
                    )}
                    {BAND_FILTERS.map((filter) => {
                        const count = filter.value === 'all' ? counts.all : (counts[filter.value] || 0);
                        if (filter.value !== 'all' && count === 0) return null;

                        return (
                            <button
                                key={filter.value}
                                type="button"
                                onClick={() => setBandFilter(filter.value)}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                                    bandFilter === filter.value
                                        ? 'border-foreground bg-foreground text-background'
                                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                                }`}
                            >
                                {filter.label}
                                <span className="tabular-nums opacity-70">{count}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Body */}
                {error && (
                    <Card>
                        <CardContent className="p-6 text-center text-sm text-destructive">
                            {error instanceof Error ? error.message : 'Failed to load OJT progress'}
                        </CardContent>
                    </Card>
                )}

                {isLoading && (
                    <div className="space-y-2">
                        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                    </div>
                )}

                {!isLoading && !error && visible.length === 0 && (
                    <Card>
                        <CardContent className="p-8 text-center text-sm text-muted-foreground">
                            {records.length === 0
                                ? 'No OJT records yet. Set the OJT webapp URL in Admin → System Settings, then run Sync now.'
                                : 'No trainees match these filters.'}
                        </CardContent>
                    </Card>
                )}

                {!isLoading && !error && visible.length > 0 && view === 'card' && (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {visible.map((record) => (
                            <OjtProgressCard
                                key={`${record.empId}|${record.unit}`}
                                record={record}
                                audience="supervisor"
                                onEdit={() => setEditing(record)}
                            />
                        ))}
                    </div>
                )}

                {!isLoading && !error && visible.length > 0 && view === 'list' && (
                    <Card>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="min-w-[180px]">Trainee</TableHead>
                                        <TableHead>Unit</TableHead>
                                        <TableHead>Start</TableHead>
                                        <TableHead>Deadline</TableHead>
                                        <TableHead className="text-right">Hours</TableHead>
                                        <TableHead className="text-right">Duty days</TableHead>
                                        <TableHead className="text-right">Hours left</TableHead>
                                        <TableHead className="text-right">Days left</TableHead>
                                        <TableHead className="text-right">Rate</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="w-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {visible.map((record) => (
                                        <TableRow
                                            key={`${record.empId}|${record.unit}`}
                                            className={record.requiresGmExtension ? 'bg-rose-50/60 dark:bg-rose-950/20' : undefined}
                                        >
                                            <TableCell className="py-2">
                                                <div className="font-medium">{record.employeeName}</div>
                                                <div className="font-mono text-[11px] text-muted-foreground">
                                                    {record.empId}
                                                    {record.designation ? ` · ${record.designation}` : ''}
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-2 text-xs">{record.unit}</TableCell>
                                            <TableCell className="py-2 whitespace-nowrap text-xs">
                                                {formatOjtDate(record.startDate)}
                                                {record.startDateSource === 'app' && (
                                                    <span className="ml-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
                                                        app
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-2 whitespace-nowrap text-xs">
                                                {formatOjtDate(record.deadline)}
                                            </TableCell>
                                            <TableCell className="py-2 text-right text-xs tabular-nums">
                                                {formatOjtHours(record.performedHours)}
                                                <span className="text-muted-foreground"> / {formatOjtHours(record.requiredHours)}</span>
                                            </TableCell>
                                            <TableCell className="py-2 text-right text-xs tabular-nums">
                                                {record.performedDays ?? '—'}
                                                <span className="text-muted-foreground"> / {record.requiredDays ?? '—'}</span>
                                            </TableCell>
                                            <TableCell className="py-2 text-right text-xs tabular-nums">
                                                {formatOjtHours(record.hoursLeft)}
                                            </TableCell>
                                            <TableCell
                                                className={`py-2 text-right text-xs tabular-nums ${
                                                    record.daysLeft !== null && record.daysLeft < 0
                                                        ? 'text-rose-600 dark:text-rose-400'
                                                        : ''
                                                }`}
                                            >
                                                {record.daysLeft ?? '—'}
                                            </TableCell>
                                            <TableCell className={`py-2 text-right text-xs font-semibold tabular-nums ${getOjtRatioTextClass(record.band)}`}>
                                                {formatOjtRatio(record.ratio)}
                                            </TableCell>
                                            <TableCell className="py-2">
                                                <div className="flex flex-col items-start gap-1">
                                                    <Badge variant="outline" className={`rounded-full text-[10px] ${getOjtBandClass(record.band)}`}>
                                                        {getOjtBandLabel(record.band)}
                                                    </Badge>
                                                    {record.requiresGmExtension && (
                                                        <span className="text-[10px] font-medium text-rose-700 dark:text-rose-300">
                                                            Needs GM extension
                                                        </span>
                                                    )}
                                                    {record.notStarted && !record.requiresGmExtension && (
                                                        <span className="text-[10px] text-muted-foreground">No hours logged</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-2">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 px-2 text-xs"
                                                    onClick={() => setEditing(record)}
                                                >
                                                    Edit
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </Card>
                )}

                {/* In list view the escalation copy still has to be readable somewhere. */}
                {view === 'list' && bandFilter === 'GM_EXTENSION' && visible.length > 0 && (
                    <div className="space-y-2">
                        {visible.map((record) => (
                            <GmExtensionAlert
                                key={`alert-${record.empId}|${record.unit}`}
                                progress={record}
                                audience="supervisor"
                            />
                        ))}
                    </div>
                )}
            </div>

            <EditOjtDialog
                record={editing}
                open={Boolean(editing)}
                onOpenChange={(open) => { if (!open) setEditing(null); }}
            />
        </DashboardLayout>
    );
}
