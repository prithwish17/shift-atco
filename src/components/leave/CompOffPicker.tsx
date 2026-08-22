import { useMemo } from "react";
import { AlertTriangle, CalendarClock, Check, Info } from "lucide-react";
import { format, parseISO } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { COMP_OFF_EXPIRY_WARNING_DAYS } from "@/lib/leaveConstants";
import type { CompOffAllocationCandidate } from "@/lib/compOffAllocation";
import { isConsumedOutsideApp } from "@/hooks/useCompOffCandidates";

/**
 * Explicit comp-off selection.
 *
 * Comp-off used to be allocated FIFO-by-expiry with no way to choose, and the
 * allocation was recomputed at apply time, at review time and again at approval
 * — so the entries an approver was shown were not guaranteed to be the ones
 * consumed. Here the choice is made once and carried on the request.
 *
 * Entries already consumed outside the app (the sheet set `leave_used_on` but no
 * in-app request owns them) are the conflict case: shown, explained, and
 * selectable only with a deliberate override.
 *
 * `allowExpired` opens up entries that lapsed. Backlog clearing is the reason it
 * exists: comp-off expires 89 days after the duty, so leave being recorded
 * months after the fact is normally paid for by a comp-off that has since
 * expired. It stays off for an employee applying for future leave, where an
 * expired entry really is spent. `not_available` entries are never selectable
 * either way — those never earned a comp-off in the first place.
 */

export interface CompOffPickerProps {
    candidates: CompOffAllocationCandidate[];
    /** Record ids currently chosen. */
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    /** How many entries this request needs (one per leave day). */
    requiredCount: number;
    /** Allow picking entries already marked used outside the app. */
    allowUsedOverride?: boolean;
    onAllowUsedOverrideChange?: (allow: boolean) => void;
    /** Allow picking entries whose comp-off has expired. */
    allowExpired?: boolean;
    isLoading?: boolean;
    disabled?: boolean;
}

function statusBadge(candidate: CompOffAllocationCandidate) {
    switch (candidate.status) {
        case "available":
            return { label: "Available", className: "bg-emerald-100 text-emerald-800" };
        case "used":
            return { label: "Used", className: "bg-slate-200 text-slate-700" };
        case "expired":
            return { label: "Expired", className: "bg-red-100 text-red-800" };
        default:
            return { label: "Not available", className: "bg-amber-100 text-amber-800" };
    }
}

function formatDate(value: string | null): string {
    if (!value) return "—";
    try {
        return format(parseISO(value), "dd MMM yyyy");
    } catch {
        return value;
    }
}

export function CompOffPicker({
    candidates,
    selectedIds,
    onChange,
    requiredCount,
    allowUsedOverride = false,
    onAllowUsedOverrideChange,
    allowExpired = false,
    isLoading = false,
    disabled = false,
}: CompOffPickerProps) {
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

    const isSelectable = useMemo(() => {
        return (c: CompOffAllocationCandidate) =>
            c.status === "available" ||
            (allowExpired && c.status === "expired") ||
            (isConsumedOutsideApp(c) && allowUsedOverride);
    }, [allowExpired, allowUsedOverride]);

    // Already ordered earliest-expiry-first by buildCompOffAllocationCandidates,
    // and Array.sort is stable, so that order survives inside each rank. Keeping
    // selectable entries at the top means the common case needs no scrolling.
    //
    // Expired entries share the top rank rather than sitting below the available
    // ones, so the list stays in pure expiry order: lapsed entries first, then
    // live ones. That is also the order auto-pick consumes them in.
    const ordered = useMemo(() => {
        const rank = (c: CompOffAllocationCandidate) => {
            if (c.status === "available" || (allowExpired && c.status === "expired")) return 0;
            if (isConsumedOutsideApp(c)) return 1;
            return 2;
        };
        return [...candidates].sort((a, b) => rank(a) - rank(b));
    }, [candidates, allowExpired]);

    const counts = useMemo(() => ({
        available: ordered.filter((c) => c.status === "available").length,
        expired: ordered.filter((c) => c.status === "expired").length,
    }), [ordered]);

    // Deliberately not the same set as `isSelectable`: an entry used outside the
    // app is a conflict the supervisor has to click for, never something a
    // one-tap default reaches for.
    //
    // Expired entries come first here because they sort earliest by expiry, which
    // is the right way round — old leave should be paid for by the comp-off that
    // lapsed while it went unrecorded, not by the employee's live balance.
    const autoPickIds = useMemo(
        () => ordered
            .filter((c) => c.status === "available" || (allowExpired && c.status === "expired"))
            .map((c) => c.recordId),
        [ordered, allowExpired],
    );

    const toggle = (candidate: CompOffAllocationCandidate) => {
        if (disabled) return;
        const id = candidate.recordId;
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onChange([...next]);
    };

    /** The historical default: earliest expiry first. */
    const autoSelect = () => onChange(autoPickIds.slice(0, requiredCount));

    const shortfall = requiredCount - selected.size;

    if (isLoading) {
        return <p className="text-sm text-muted-foreground">Loading comp-off entries…</p>;
    }

    if (candidates.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                No earned comp-off entries found for this employee.
            </p>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                    <span
                        className={
                            shortfall === 0
                                ? "font-semibold text-emerald-700"
                                : "font-semibold text-amber-700"
                        }
                    >
                        {selected.size} of {requiredCount} selected
                    </span>
                    <span className="ml-2 text-muted-foreground">
                        ({counts.available} available
                        {allowExpired && counts.expired > 0 ? `, ${counts.expired} expired` : ""})
                    </span>
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={autoSelect}
                    disabled={disabled || autoPickIds.length === 0}
                >
                    Auto-pick earliest expiry
                </Button>
            </div>

            {shortfall > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                        Select {shortfall} more {shortfall === 1 ? "entry" : "entries"} — one per
                        leave day.
                    </span>
                </div>
            )}

            {allowExpired && counts.expired > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-900">
                    <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                        Expired entries can be selected here. Comp-off lapses 89 days after the
                        duty, so leave being recorded months later is usually covered by one that
                        has since expired.
                    </span>
                </div>
            )}

            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                {ordered.map((candidate) => {
                    const badge = statusBadge(candidate);
                    const consumedOutside = isConsumedOutsideApp(candidate);
                    const selectable = isSelectable(candidate);
                    const isSelected = selected.has(candidate.recordId);
                    const expiringSoon =
                        candidate.daysRemaining !== null &&
                        candidate.daysRemaining >= 0 &&
                        candidate.daysRemaining <= COMP_OFF_EXPIRY_WARNING_DAYS;

                    return (
                        <li
                            key={candidate.recordId}
                            className={`flex items-start gap-3 p-2.5 text-sm ${
                                selectable ? "cursor-pointer hover:bg-slate-50" : "opacity-60"
                            }`}
                            onClick={() => selectable && toggle(candidate)}
                        >
                            <Checkbox
                                checked={isSelected}
                                disabled={disabled || !selectable}
                                className="mt-0.5"
                                onCheckedChange={() => selectable && toggle(candidate)}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-slate-900">
                                        {formatDate(candidate.dutyDate)}
                                    </span>
                                    {candidate.dutyPerformed && (
                                        <Badge variant="outline" className="text-[10px]">
                                            {candidate.dutyPerformed}
                                        </Badge>
                                    )}
                                    <Badge className={`text-[10px] ${badge.className}`}>
                                        {badge.label}
                                    </Badge>
                                    {expiringSoon && (
                                        <Badge className="bg-orange-100 text-[10px] text-orange-800">
                                            <CalendarClock className="mr-1 h-3 w-3" />
                                            {candidate.daysRemaining}d left
                                        </Badge>
                                    )}
                                </div>
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                    Expires {formatDate(candidate.expiryDate)}
                                    {candidate.sourceLabel ? ` · ${candidate.sourceLabel}` : ""}
                                </div>
                                {consumedOutside && (
                                    <div className="mt-1 flex items-start gap-1.5 text-xs text-purple-700">
                                        <Info className="mt-0.5 h-3 w-3 shrink-0" />
                                        <span>
                                            Marked used on {formatDate(candidate.leaveApplied)} in the
                                            Google Sheet, with no matching request in the app.
                                        </span>
                                    </div>
                                )}
                                {candidate.remark && !consumedOutside && (
                                    <div className="mt-0.5 text-xs text-muted-foreground">
                                        {candidate.remark}
                                    </div>
                                )}
                            </div>
                            {isSelected && (
                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            )}
                        </li>
                    );
                })}
            </ul>

            {onAllowUsedOverrideChange && (
                <label className="flex items-start gap-2 rounded-lg border border-purple-200 bg-purple-50 p-2.5 text-xs text-purple-900">
                    <Checkbox
                        checked={allowUsedOverride}
                        disabled={disabled}
                        className="mt-0.5"
                        onCheckedChange={(v) => onAllowUsedOverrideChange(v === true)}
                    />
                    <span>
                        Allow entries already used outside the app. Use only when the sheet and the
                        app describe the same leave — the override is recorded in the audit log.
                    </span>
                </label>
            )}
        </div>
    );
}

export default CompOffPicker;
