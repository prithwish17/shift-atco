import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useRecomputeLeaveBalance, type BalanceRecomputeResult } from "@/hooks/useLeaveBacklog";
import { YEAR_LOOKBACK } from "@/lib/leaveConstants";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: YEAR_LOOKBACK }, (_, i) => CURRENT_YEAR - i);

/**
 * Preview-then-commit balance reconciliation for one employee.
 *
 * Always previews first: after a backlog run the computed figure can move a long
 * way from the stored one, and a supervisor should see the delta before it lands.
 */
export function LeaveBalanceRecompute({
    userId,
    employeeName,
}: {
    userId: string;
    employeeName?: string;
}) {
    const { toast } = useToast();
    const recompute = useRecomputeLeaveBalance();
    const [year, setYear] = useState(CURRENT_YEAR);
    const [preview, setPreview] = useState<BalanceRecomputeResult | null>(null);

    // A preview belongs to one employee-year; never show a stale one.
    useEffect(() => {
        setPreview(null);
    }, [userId, year]);

    const runPreview = async () => {
        try {
            const result = await recompute.mutateAsync({ userId, year, dryRun: true });
            setPreview(result);
        } catch (err) {
            toast({
                title: "Could not compute the balance",
                description: err instanceof Error ? err.message : String(err),
                variant: "destructive",
            });
        }
    };

    const commit = async () => {
        try {
            await recompute.mutateAsync({ userId, year, dryRun: false });
            toast({
                title: "Balance updated",
                description: `${employeeName ?? "Employee"} — ${year}`,
            });
            await runPreview();
        } catch (err) {
            toast({
                title: "Could not update the balance",
                description: err instanceof Error ? err.message : String(err),
                variant: "destructive",
            });
        }
    };

    const row = (
        label: string,
        bucket: { before: number | null; after: number; used: number } | undefined,
    ) => {
        if (!bucket) return null;
        const changed = bucket.before !== null && Number(bucket.before) !== Number(bucket.after);
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm">
                <div>
                    <div className="font-semibold text-slate-900">{label}</div>
                    <div className="text-xs text-muted-foreground">
                        {bucket.used} day{Number(bucket.used) === 1 ? "" : "s"} approved this year
                    </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <span className={bucket.before === null ? "text-muted-foreground" : ""}>
                        {bucket.before === null ? "not set" : bucket.before}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <Badge
                        className={
                            changed
                                ? "bg-amber-100 text-amber-900"
                                : "bg-emerald-100 text-emerald-800"
                        }
                    >
                        {bucket.after}
                    </Badge>
                </div>
            </div>
        );
    };

    const hasChange =
        preview !== null &&
        (Number(preview.cl.before ?? NaN) !== Number(preview.cl.after) ||
            Number(preview.rh.before ?? NaN) !== Number(preview.rh.after));

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                    <SelectTrigger className="h-9 w-[110px]">
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
                    size="sm"
                    variant="outline"
                    onClick={runPreview}
                    disabled={recompute.isPending}
                >
                    {recompute.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Preview from approved leave
                </Button>
            </div>

            {preview === null ? (
                <p className="text-[11px] text-muted-foreground sm:text-sm">
                    Balances are derived from opening allocation (12 CL, 2 RH) minus approved leave.
                    Preview the computed figures before applying them.
                </p>
            ) : (
                <>
                    <div className="space-y-2">
                        {row("Casual Leave", preview.cl)}
                        {row("Restricted Holiday", preview.rh)}
                    </div>

                    {hasChange && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                                Applying this overwrites the stored balance with the computed one.
                                The change is recorded in the leave audit log.
                            </span>
                        </div>
                    )}

                    <Button size="sm" onClick={commit} disabled={recompute.isPending}>
                        {recompute.isPending ? "Applying…" : "Apply computed balance"}
                    </Button>
                </>
            )}
        </div>
    );
}

export default LeaveBalanceRecompute;
