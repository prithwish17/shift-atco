import { useState } from "react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { AlertTriangle, Archive, Loader2, Lock, RotateCcw, Sheet as SheetIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
    useActivateLeaveSheetSource,
    useApproveLeaveSheetRetirement,
    useArchivedLeaveRecords,
    useCloseLeaveSheetSource,
    useLeaveSheetSources,
    useLeaveSheetSyncRuns,
    useRestoreArchivedLeaveRecord,
    type LeaveSheetSyncRun,
} from "@/hooks/useLeaveSheetSources";

const ago = (iso: string | null | undefined) =>
    iso ? formatDistanceToNow(parseISO(iso), { addSuffix: true }) : "never";

const RUN_TONE: Record<string, string> = {
    committed: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-800",
    rejected: "bg-red-100 text-red-800",
    staging: "bg-slate-100 text-slate-700",
};

/**
 * The leave sheet's lifecycle, for admins: which workbook feeds the register,
 * what each sync did, and the two decisions only a person should make —
 * letting a large retirement through, and closing the sheet for good.
 *
 * Closing never touches the register. Every row the workbook contributed stays
 * exactly as it is; the sync simply stops reading it.
 */
export function LeaveSheetSourcePanel() {
    const { toast } = useToast();
    const sources = useLeaveSheetSources();
    const runs = useLeaveSheetSyncRuns();
    const archive = useArchivedLeaveRecords();
    const closeSource = useCloseLeaveSheetSource();
    const activateSource = useActivateLeaveSheetSource();
    const approveRetirement = useApproveLeaveSheetRetirement();
    const restoreRecord = useRestoreArchivedLeaveRecord();

    const [closeOpen, setCloseOpen] = useState(false);
    const [closeReason, setCloseReason] = useState("");
    const [closeConfirm, setCloseConfirm] = useState("");
    const [approveRun, setApproveRun] = useState<LeaveSheetSyncRun | null>(null);

    const active = sources.data?.find((s) => s.status === "active") ?? null;
    const closed = sources.data?.filter((s) => s.status === "closed") ?? [];
    const newestYear = Math.max(new Date().getFullYear() - 1, ...(sources.data ?? []).map((s) => s.leave_year));
    const [nextKey, setNextKey] = useState("");
    const [nextYear, setNextYear] = useState("");
    const [nextUrl, setNextUrl] = useState("");

    const latestRun = runs.data?.find((r) => r.status === "committed" && r.source_key === active?.source_key);
    const blocked = latestRun?.retire_status === "blocked" ? latestRun : null;

    const run = async (action: () => Promise<unknown>, success: string) => {
        try {
            await action();
            toast({ title: success });
            return true;
        } catch (err) {
            toast({
                title: "Not done",
                description: err instanceof Error ? err.message : String(err),
                variant: "destructive",
            });
            return false;
        }
    };

    const doClose = async () => {
        if (!active) return;
        const ok = await run(
            () => closeSource.mutateAsync({ sourceKey: active.source_key, reason: closeReason.trim() }),
            `${active.source_key} closed — its rows are frozen in the register`,
        );
        if (ok) {
            setCloseOpen(false);
            setCloseReason("");
            setCloseConfirm("");
        }
    };

    const doActivate = async () => {
        const year = Number(nextYear) || newestYear + 1;
        const key = nextKey.trim() || `ATTENDANCE-${year}`;
        const ok = await run(
            () => activateSource.mutateAsync({ sourceKey: key, label: `${key} · LEAVE_DATA`, year, readUrl: nextUrl.trim() }),
            `${key} is now the live leave sheet`,
        );
        if (ok) {
            setNextKey("");
            setNextYear("");
            setNextUrl("");
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <SheetIcon className="h-4 w-4" />
                    Leave sheet lifecycle
                </CardTitle>
                <CardDescription>
                    The app's leave register is the system of record. A workbook feeds it while it is live; closing
                    it freezes everything it contributed and never removes anything from the app.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                {sources.isLoading ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </p>
                ) : active ? (
                    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{active.source_key}</span>
                                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Live</Badge>
                                <span className="text-xs text-muted-foreground">{active.leave_year}</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Last synced {ago(active.last_synced_at)} ·{" "}
                                {active.read_url ? "own read URL" : "read URL from the setting above"}
                            </p>
                        </div>
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCloseOpen(true)}>
                            <Lock className="h-3.5 w-3.5" />
                            Close this sheet
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm text-amber-900">
                            No live leave sheet. Nothing syncs and nothing is sent to a sheet; the register keeps
                            everything and approvals keep writing to it.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-3">
                            <div className="space-y-1">
                                <Label htmlFor="next-sheet-year" className="text-xs">Year</Label>
                                <Input
                                    id="next-sheet-year"
                                    inputMode="numeric"
                                    placeholder={String(newestYear + 1)}
                                    value={nextYear}
                                    onChange={(e) => setNextYear(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                                <Label htmlFor="next-sheet-key" className="text-xs">Name</Label>
                                <Input
                                    id="next-sheet-key"
                                    placeholder={`ATTENDANCE-${Number(nextYear) || newestYear + 1}`}
                                    value={nextKey}
                                    onChange={(e) => setNextKey(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="next-sheet-url" className="text-xs">Read feed URL (optional)</Label>
                            <Input
                                id="next-sheet-url"
                                type="url"
                                className="font-mono text-xs"
                                placeholder="Falls back to the Leave Sync Webapp URL above"
                                value={nextUrl}
                                onChange={(e) => setNextUrl(e.target.value)}
                            />
                        </div>
                        <Button size="sm" onClick={doActivate} disabled={activateSource.isPending}>
                            {activateSource.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Start syncing this workbook
                        </Button>
                    </div>
                )}

                {blocked && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <p className="flex items-start gap-2 font-semibold">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            {blocked.retire_candidates} register row
                            {blocked.retire_candidates === 1 ? " is" : "s are"} missing from the sheet and were kept
                        </p>
                        <p className="mt-1 text-xs">{blocked.blocked_reason}</p>
                        <p className="mt-1 text-xs">
                            If the sheet really lost those rows on purpose, approve to move them to the archive. If
                            the feed was broken, do nothing — the next good sync clears this.
                        </p>
                        <Button size="sm" variant="outline" className="mt-2" onClick={() => setApproveRun(blocked)}>
                            Review and approve
                        </Button>
                    </div>
                )}

                <section className="space-y-2">
                    <h4 className="text-sm font-semibold">Recent syncs</h4>
                    {runs.data?.length ? (
                        <ul className="divide-y rounded-lg border text-xs">
                            {runs.data.map((r) => (
                                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5">
                                    <span className="w-28 shrink-0 text-muted-foreground">
                                        {format(parseISO(r.started_at), "d MMM, HH:mm")}
                                    </span>
                                    <Badge className={`${RUN_TONE[r.status] ?? ""} hover:bg-inherit`}>{r.status}</Badge>
                                    <span className="text-muted-foreground">{r.source_key}</span>
                                    {r.status === "committed" && (
                                        <span>
                                            +{r.inserted ?? 0} new · {r.updated ?? 0} updated
                                            {r.retired ? ` · ${r.retired} archived` : ""}
                                            {r.retire_status === "blocked" ? " · retirement held" : ""}
                                        </span>
                                    )}
                                    {r.error && <span className="basis-full text-red-700">{r.error}</span>}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-xs text-muted-foreground">No syncs recorded yet.</p>
                    )}
                </section>

                {!!closed.length && (
                    <section className="space-y-2">
                        <h4 className="text-sm font-semibold">Closed sheets</h4>
                        <ul className="space-y-1 text-xs">
                            {closed.map((s) => (
                                <li key={s.source_key} className="flex flex-wrap gap-x-2">
                                    <span className="font-medium">{s.source_key}</span>
                                    <span className="text-muted-foreground">
                                        closed {s.closed_at ? format(parseISO(s.closed_at), "d MMM yyyy") : ""}
                                        {s.close_reason ? ` — ${s.close_reason}` : ""}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <section className="space-y-2">
                    <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                        <Archive className="h-3.5 w-3.5" />
                        Archive
                    </h4>
                    <p className="text-xs text-muted-foreground">
                        Every register row that has ever been removed — dropped from the sheet, or a cancelled
                        leave — is kept here and can be put back.
                    </p>
                    {archive.data?.length ? (
                        <ul className="divide-y rounded-lg border text-xs">
                            {archive.data.map((a) => (
                                <li key={a.archive_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5">
                                    <span className="font-mono">{a.emp_id}</span>
                                    <span>
                                        {a.leave_category} {a.leave_date}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {a.reason.replace(/_/g, " ")} · {ago(a.archived_at)}
                                    </span>
                                    <span className="ml-auto">
                                        {a.restored_at ? (
                                            <Badge variant="secondary">restored</Badge>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 gap-1 text-xs"
                                                disabled={restoreRecord.isPending}
                                                onClick={() =>
                                                    run(
                                                        () => restoreRecord.mutateAsync({ archiveId: a.archive_id }),
                                                        "Restored to the register",
                                                    )
                                                }
                                            >
                                                <RotateCcw className="h-3 w-3" />
                                                Restore
                                            </Button>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-xs text-muted-foreground">Nothing archived.</p>
                    )}
                </section>
            </CardContent>

            <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Close {active?.source_key}?</DialogTitle>
                        <DialogDescription>
                            The sync stops reading this workbook and every register row it supplied is frozen: kept
                            exactly as it is, never changed or removed by a later sync. Nothing leaves the app.
                            Pending sends to the sheet are dropped. Point LEAVE_SHEET_WEBAPP_URL at the next
                            workbook's script before sending again.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="close-reason">Reason</Label>
                            <Textarea
                                id="close-reason"
                                placeholder="e.g. Year end — moving to ATTENDANCE-2027"
                                value={closeReason}
                                onChange={(e) => setCloseReason(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="close-confirm">
                                Type <span className="font-mono">{active?.source_key}</span> to confirm
                            </Label>
                            <Input
                                id="close-confirm"
                                value={closeConfirm}
                                onChange={(e) => setCloseConfirm(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCloseOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={doClose}
                            disabled={
                                closeSource.isPending ||
                                !closeReason.trim() ||
                                closeConfirm.trim() !== active?.source_key
                            }
                        >
                            {closeSource.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Close sheet
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!approveRun} onOpenChange={(open) => !open && setApproveRun(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Archive {approveRun?.retire_candidates} missing rows?</DialogTitle>
                        <DialogDescription>
                            These rows are in the register but not in the sheet's latest feed
                            ({approveRun ? format(parseISO(approveRun.started_at), "d MMM, HH:mm") : ""}). They move
                            to the archive, where each can be restored. Rows linked to an app approval are never
                            moved.
                        </DialogDescription>
                    </DialogHeader>
                    <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">{approveRun?.blocked_reason}</p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setApproveRun(null)}>
                            Keep them
                        </Button>
                        <Button
                            onClick={async () => {
                                if (!approveRun) return;
                                const ok = await run(
                                    () => approveRetirement.mutateAsync({ runId: approveRun.id }),
                                    "Missing rows moved to the archive",
                                );
                                if (ok) setApproveRun(null);
                            }}
                            disabled={approveRetirement.isPending}
                        >
                            {approveRetirement.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Archive them
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
