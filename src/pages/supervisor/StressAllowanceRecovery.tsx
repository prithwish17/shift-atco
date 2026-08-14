/**
 * Annexure-2 — Stress Allowance Recovery.
 *
 * Roster, rating dates and teams come from the app's own synced tables; the
 * IAMATC time-on-position extract is uploaded, because it has no app
 * equivalent. Every figure is traceable: clicking a row shows the day-by-day
 * working that produced it.
 *
 * Rules and the reasoning behind them: SARC_IMPLEMENTATION_PLAN.md.
 */

import { useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    AlertTriangle, Download, FileSpreadsheet, RefreshCw, Search, Send, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { DashboardLayout } from '@/components/DashboardLayout';
import { SarcDayStrip } from '@/components/sarc/SarcDayStrip';
import { SarcFindingsPanel } from '@/components/sarc/SarcFindingsPanel';
import { FileDropzone } from '@/components/upload/FileDropzone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
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
import { useAuth } from '@/contexts/AuthContext';
import { useSarc, useSarcRuns, useSaveSarcRun } from '@/hooks/useSarc';
import {
    annexureTitle, formatDuration, indexImport, parseIamatcCsv,
    type IamatcHours, type IamatcImport, type SarcPeriod, type SarcRow,
} from '@/domain/sarc';

/* ─── Period helpers ──────────────────────────────────────────────────────── */

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const monthKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const monthLabel = (key: string) => {
    const [year, month] = key.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
};

function recentMonths(count = 24): string[] {
    const now = new Date();
    return Array.from({ length: count }, (_, index) =>
        monthKey(new Date(now.getFullYear(), now.getMonth() - index, 1)),
    );
}

/** First day of `startMonth` to the last day of `endMonth`. */
function toPeriod(startMonth: string, endMonth: string): SarcPeriod | null {
    if (!startMonth || !endMonth || endMonth < startMonth) return null;
    const [endYear, endMonthNumber] = endMonth.split('-').map(Number);
    const lastDay = new Date(endYear, endMonthNumber, 0).getDate();
    return { start: `${startMonth}-01`, end: `${endMonth}-${String(lastDay).padStart(2, '0')}` };
}

/** Defaults to the two completed months ending with last month. */
function defaultMonths(): [string, string] {
    const now = new Date();
    return [
        monthKey(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
        monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    ];
}

const percent = (value: number | null) =>
    value == null ? '—' : `${(value * 100).toFixed(2)}%`;

/**
 * Supabase rejections are plain `{ message, code, ... }` objects, not `Error`s,
 * so an `instanceof Error` check drops the only useful part on the floor.
 */
function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    const detail = error as Record<string, unknown> | null;
    if (typeof detail?.message === 'string') return detail.message;
    return JSON.stringify(error ?? 'no detail');
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function StressAllowanceRecovery() {
    // The page is reachable from both portals, so it keeps whichever sidebar
    // the viewer arrived with — an admin clicking through from the admin nav
    // should not have the nav item they just used disappear underneath them.
    const { userRole } = useAuth();
    const dashboardRole = userRole === 'admin' ? 'admin' : 'supervisor';

    const [initialStart, initialEnd] = defaultMonths();
    const [startMonth, setStartMonth] = useState(initialStart);
    const [endMonth, setEndMonth] = useState(initialEnd);
    const [extract, setExtract] = useState<IamatcImport | null>(null);
    const [extractName, setExtractName] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [recoveryOnly, setRecoveryOnly] = useState(false);
    const [selected, setSelected] = useState<SarcRow | null>(null);

    const months = useMemo(() => recentMonths(), []);
    const period = useMemo(() => toPeriod(startMonth, endMonth), [startMonth, endMonth]);

    const performed = useMemo<ReadonlyMap<string, IamatcHours>>(
        () => (extract ? indexImport(extract) : new Map()),
        [extract],
    );

    const { evaluation, isLoading, isFetching, error, refetch } = useSarc({ period, performed });
    const runs = useSarcRuns();
    const saveRun = useSaveSarcRun();

    // Memoised because `?? []` would otherwise hand the filter a fresh array
    // every render, defeating its own memoisation.
    const rows = useMemo(() => evaluation?.report.rows ?? [], [evaluation]);
    const summary = evaluation?.summary;

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return rows.filter((row) => {
            if (recoveryOnly && !((row.recovery ?? 0) > 0)) return false;
            if (!term) return true;
            return (
                row.name.toLowerCase().includes(term) ||
                row.empId.toLowerCase().includes(term) ||
                (row.designation ?? '').toLowerCase().includes(term)
            );
        });
    }, [rows, search, recoveryOnly]);

    /** True when the table is showing less than the whole statement. */
    const isFiltered = filtered.length !== rows.length;

    const rowById = useMemo(
        () => new Map((evaluation?.rows ?? []).map((row) => [row.empId, row])),
        [evaluation],
    );

    async function handleExtract(file: File) {
        try {
            const result = parseIamatcCsv(await file.text());
            setExtract(result);
            setExtractName(file.name);

            if (!result.ok) {
                toast.error('Could not read the extract', {
                    description: result.issues[0]?.message,
                });
                return;
            }

            const warnings = result.issues.length;
            toast.success(`Read ${result.rows.length} rows from ${file.name}`, {
                description: warnings ? `${warnings} row${warnings > 1 ? 's' : ''} need a look.` : undefined,
            });
        } catch (cause) {
            toast.error('Could not read the file', {
                description: cause instanceof Error ? cause.message : 'Unknown error',
            });
        }
    }

    function exportPdf() {
        if (!period || !evaluation) return;

        const doc = new jsPDF({ orientation: 'portrait' });
        doc.setFontSize(11);
        doc.text(annexureTitle(period), 14, 14);

        if (isFiltered) {
            doc.setFontSize(8);
            doc.setTextColor(180, 30, 30);
            doc.text(
                `Filtered view — ${filtered.length} of ${rows.length} employees. Not the full statement.`,
                14,
                19,
            );
            doc.setTextColor(0, 0, 0);
        }

        autoTable(doc, {
            startY: isFiltered ? 23 : 20,
            head: [['Employee Id', 'Name', 'Designation', 'Hours Required', 'Hours Performed', 'Recovery']],
            body: filtered.map((row) => [
                row.empId,
                row.name,
                row.designation ?? '',
                formatDuration(row.requirement),
                formatDuration(row.performed),
                row.requirement == null ? '' : percent(row.recovery),
            ]),
            styles: { fontSize: 7, cellPadding: 1.2 },
            headStyles: { fillColor: [30, 41, 59] },
        });

        doc.save(`Annexure-2 ${monthLabel(startMonth)} to ${monthLabel(endMonth)}${isFiltered ? ' (filtered)' : ''}.pdf`);
    }

    function exportCsv() {
        if (!period || !evaluation) return;

        const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
        const csv = [
            ['Employee Id', 'Name', 'Designation', 'Hours Required', 'Hours Performed', 'Recovery'],
            ...filtered.map((row) => [
                row.empId,
                row.name,
                row.designation ?? '',
                formatDuration(row.requirement),
                formatDuration(row.performed),
                row.requirement == null ? '' : percent(row.recovery),
            ]),
        ]
            .map((line) => line.map((cell) => escape(String(cell))).join(','))
            .join('\n');

        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `Annexure-2 ${monthLabel(startMonth)} to ${monthLabel(endMonth)}${isFiltered ? ' (filtered)' : ''}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function issue() {
        if (!period || !evaluation) return;
        saveRun.mutate({
            period,
            title: annexureTitle(period),
            rows: evaluation.rows,
            inRecoveryCount: evaluation.summary.inRecovery,
        });
    }

    return (
        <DashboardLayout role={dashboardRole}>
            <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold">Stress Allowance Recovery</h1>
                        <p className="text-sm text-muted-foreground">
                            {period ? annexureTitle(period) : 'Choose a period to begin.'}
                        </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>

                {/* Period + extract ------------------------------------------------ */}
                <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Period</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">First month</Label>
                                    <Select value={startMonth} onValueChange={setStartMonth}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {months.map((month) => (
                                                <SelectItem key={month} value={month}>{monthLabel(month)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Last month</Label>
                                    <Select value={endMonth} onValueChange={setEndMonth}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {months.map((month) => (
                                                <SelectItem key={month} value={month}>{monthLabel(month)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {!period && (
                                <p className="flex items-center gap-1.5 text-xs text-destructive">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    The last month must not fall before the first.
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Requirements accrue at 30 hours per month at the shift rate, 15 at the
                                general rate. The period sets both the accrual window and that ceiling.
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">IAMATC extract</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {extractName ? (
                                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                                    <span className="flex min-w-0 items-center gap-2">
                                        <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        <span className="truncate">{extractName}</span>
                                        {extract?.ok && (
                                            <Badge variant="secondary">{extract.rows.length} rows</Badge>
                                        )}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 shrink-0"
                                        onClick={() => { setExtract(null); setExtractName(null); }}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <FileDropzone
                                    accept=".csv,text/csv"
                                    onFile={handleExtract}
                                    description="Drop the IAMATC extract as CSV, or click to choose"
                                />
                            )}

                            {extract && extract.issues.length > 0 && (
                                <ul className="max-h-28 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                                    {extract.issues.slice(0, 20).map((issue, index) => (
                                        <li key={`${issue.code}-${issue.line}-${index}`}>
                                            {issue.line ? `Line ${issue.line}: ` : ''}{issue.message}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <p className="text-xs text-muted-foreground">
                                Hours performed come from this file — controlling time for general
                                officers, the weighted total for shift controllers. Without it
                                requirements still compute, but recovery cannot.
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Findings -------------------------------------------------------- */}
                {evaluation && <SarcFindingsPanel findings={evaluation.findings} />}

                {/* Summary --------------------------------------------------------- */}
                {summary && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="On the statement" value={String(summary.total)} />
                        <Stat label="Carrying a requirement" value={String(summary.withRequirement)} />
                        <Stat label="In recovery" value={String(summary.inRecovery)} />
                        <Stat label="Mean recovery" value={percent(summary.meanRecovery)} />
                    </div>
                )}

                {/* Statement ------------------------------------------------------- */}
                <Card>
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
                        <CardTitle className="text-base">Statement</CardTitle>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Name, ID or designation"
                                    className="h-8 w-56 pl-8"
                                />
                            </div>
                            <Button
                                variant={recoveryOnly ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setRecoveryOnly((on) => !on)}
                                disabled={!rows.length}
                                aria-pressed={recoveryOnly}
                                title="Show only employees whose performed hours fall short of their requirement"
                            >
                                <AlertTriangle className="mr-2 h-4 w-4" />
                                In recovery
                                {summary ? (
                                    <Badge
                                        variant={recoveryOnly ? 'secondary' : 'outline'}
                                        className="ml-2 tabular-nums"
                                    >
                                        {summary.inRecovery}
                                    </Badge>
                                ) : null}
                            </Button>
                            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
                                <Download className="mr-2 h-4 w-4" />CSV
                            </Button>
                            <Button variant="outline" size="sm" onClick={exportPdf} disabled={!rows.length}>
                                <Download className="mr-2 h-4 w-4" />PDF
                            </Button>
                            <Button
                                size="sm"
                                onClick={issue}
                                disabled={!evaluation?.canIssue || saveRun.isPending}
                                title={
                                    evaluation && !evaluation.canIssue
                                        ? 'Resolve the blocking findings above first'
                                        : undefined
                                }
                            >
                                <Send className="mr-2 h-4 w-4" />Issue
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {error ? (
                            <div className="space-y-2 p-6 text-sm">
                                <p className="font-medium text-destructive">Could not load roster data.</p>
                                <p className="break-words font-mono text-xs text-muted-foreground">
                                    {describeError(error)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    The message names which read failed. A missing table usually means the
                                    SARC migration has not been applied to this database yet.
                                </p>
                            </div>
                        ) : isLoading ? (
                            <div className="space-y-2 p-6">
                                {Array.from({ length: 6 }, (_, index) => (
                                    <Skeleton key={index} className="h-8 w-full" />
                                ))}
                            </div>
                        ) : filtered.length === 0 ? (
                            <p className="p-6 text-sm text-muted-foreground">
                                {rows.length === 0
                                    ? 'No roster data for this period. Check the schedule sync has run for both months.'
                                    : recoveryOnly && !search.trim()
                                      ? 'Nobody is in recovery for this period — every requirement was met.'
                                      : recoveryOnly
                                        ? 'No employee in recovery matches that search.'
                                        : 'No employee matches that search.'}
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Employee Id</TableHead>
                                            <TableHead>Name</TableHead>
                                            <TableHead>Designation</TableHead>
                                            <TableHead className="text-right">Hours Required</TableHead>
                                            <TableHead className="text-right">Hours Performed</TableHead>
                                            <TableHead className="text-right">Recovery</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filtered.map((row) => {
                                            const full = rowById.get(row.empId);
                                            const shortfall = (row.recovery ?? 0) > 0;

                                            return (
                                                <TableRow
                                                    key={row.empId}
                                                    className="cursor-pointer"
                                                    onClick={() => full && setSelected(full)}
                                                >
                                                    <TableCell className="font-mono text-xs">{row.empId}</TableCell>
                                                    <TableCell className="font-medium">{row.name}</TableCell>
                                                    <TableCell className="text-muted-foreground">{row.designation ?? '—'}</TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {row.requirement == null
                                                            ? <span className="text-muted-foreground">exempt</span>
                                                            : formatDuration(row.requirement)}
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {row.performed == null
                                                            ? <span className="text-muted-foreground">—</span>
                                                            : formatDuration(row.performed)}
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {row.requirement == null ? (
                                                            <span className="text-muted-foreground">—</span>
                                                        ) : (
                                                            <span className={shortfall ? 'font-medium text-destructive' : undefined}>
                                                                {percent(row.recovery)}
                                                            </span>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Previously issued ------------------------------------------------ */}
                {runs.error && (
                    <Card>
                        <CardContent className="space-y-1 py-4 text-sm">
                            <p className="font-medium text-destructive">
                                Could not load previously issued statements.
                            </p>
                            <p className="break-words font-mono text-xs text-muted-foreground">
                                {describeError(runs.error)}
                            </p>
                        </CardContent>
                    </Card>
                )}

                {(runs.data?.length ?? 0) > 0 && (
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Previously issued</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Statement</TableHead>
                                        <TableHead>Issued</TableHead>
                                        <TableHead>By</TableHead>
                                        <TableHead className="text-right">Employees</TableHead>
                                        <TableHead className="text-right">In recovery</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {runs.data!.map((run) => (
                                        <TableRow key={run.id}>
                                            <TableCell className="font-medium">{run.title}</TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {new Date(run.issuedAt).toLocaleString()}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">{run.issuedByName ?? '—'}</TableCell>
                                            <TableCell className="text-right tabular-nums">{run.employeeCount}</TableCell>
                                            <TableCell className="text-right tabular-nums">{run.inRecoveryCount}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Drill-down ---------------------------------------------------------- */}
            <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
                <DialogContent className="max-w-4xl">
                    {selected && (
                        <>
                            <DialogHeader>
                                <DialogTitle>{selected.name}</DialogTitle>
                                <DialogDescription>
                                    {selected.empId}
                                    {selected.designation ? ` · ${selected.designation}` : ''} · accrued{' '}
                                    {formatDuration(selected.required)}
                                    {selected.adjusted !== selected.required
                                        ? `, capped to ${formatDuration(selected.adjusted)}`
                                        : ''}
                                    {selected.requirement == null
                                        ? ' · exempt, no rating or endorsement date on file'
                                        : ` · requirement ${formatDuration(selected.requirement)}`}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="max-h-[70vh] overflow-y-auto pr-1">
                                <SarcDayStrip row={selected} />
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <Card>
            <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            </CardContent>
        </Card>
    );
}
