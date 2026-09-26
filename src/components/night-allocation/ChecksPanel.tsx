/**
 * The checks panel.
 *
 * Two lists, deliberately unequal: what has to be fixed before the night can be
 * saved, and what is only worth knowing. A staffing notice explains why a
 * continuous plan is impossible; it never stops anyone saving what they have.
 */
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuleIssue, ValidationResult } from "@/domain/night-allocation";

interface ChecksPanelProps {
  validation: ValidationResult;
  hasDuties: boolean;
  /** Stretches left blank on purpose — allowed, so not errors, but "covered end to end" would be untrue. */
  blanks?: number;
  /** Scrolls the board to the duty an error points at. */
  onFocusDuty: (dutyId: string) => void;
}

export function ChecksPanel({ validation, hasDuties, blanks = 0, onFocusDuty }: ChecksPanelProps) {
  const { errors, warnings } = validation;

  const renderIssue = (issue: RuleIssue, tone: "error" | "warning") => {
    const surface =
      tone === "error"
        ? "border-status-danger/25 bg-status-danger-soft/60"
        : "border-status-warning/25 bg-status-warning-soft/50";
    const Icon = tone === "error" ? AlertTriangle : Info;
    const iconTone = tone === "error" ? "text-status-danger" : "text-status-warning";
    const clickable = issue.dutyIds.length > 0;

    const body = (
      <>
        <Icon className={cn("mt-px h-3.5 w-3.5 shrink-0", iconTone)} />
        <span className="min-w-0 flex-1 leading-snug">{issue.message}</span>
        {clickable ? <ChevronRight className="mt-px h-3.5 w-3.5 shrink-0 opacity-50" /> : null}
      </>
    );

    return (
      <li key={issue.message} className={cn("rounded-lg border text-[0.82rem] text-corp-text-main", surface)}>
        {clickable ? (
          <button
            type="button"
            onClick={() => onFocusDuty(issue.dutyIds[0])}
            className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.04]"
          >
            {body}
          </button>
        ) : (
          <span className="flex items-start gap-2 px-3 py-2.5">{body}</span>
        )}
      </li>
    );
  };

  return (
    <Card className="overflow-hidden border-corp-border-soft bg-surface shadow-sm">
      <CardContent className="space-y-4 p-5" id="night-allocation-checks" tabIndex={-1}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-corp-text-muted">Checks</h2>
          {hasDuties ? (
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold",
                errors.length
                  ? "bg-status-danger-soft text-status-danger"
                  : "bg-status-success-soft text-status-success",
              )}
            >
              {errors.length ? `${errors.length} to fix` : "Ready to save"}
            </span>
          ) : null}
        </div>

        {!hasDuties ? (
          <p className="text-[0.82rem] leading-relaxed text-corp-text-soft">
            Set halves if needed, choose who starts each position, then generate an allocation. Every open
            position must be covered with no gaps.
          </p>
        ) : null}

        {errors.length ? (
          <div className="space-y-2">
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-wide text-status-danger">
              Fix before saving
            </h3>
            <ul className="space-y-1.5">{errors.map(issue => renderIssue(issue, "error"))}</ul>
          </div>
        ) : null}

        {!errors.length && hasDuties ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-status-success/25 bg-status-success-soft/50 px-3 py-3">
            <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-status-success" />
            <span className="text-[0.85rem] font-medium text-corp-text-main">
              {blanks
                ? `All hard rules pass. Every open position is covered, apart from ${
                    blanks === 1 ? "one stretch" : `${blanks} stretches`
                  } left blank on purpose — listed below.`
                : "All hard rules pass. Every open position is covered end to end."}
            </span>
          </div>
        ) : null}

        {warnings.length ? (
          <div className="space-y-2">
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-wide text-status-warning">
              Suggestions
            </h3>
            <ul className="space-y-1.5">{warnings.map(issue => renderIssue(issue, "warning"))}</ul>
          </div>
        ) : null}

        <p className="border-t border-corp-border-soft pt-3 text-[0.72rem] leading-relaxed text-corp-text-soft">
          Standalone module. It reads tonight's crew from the shift roster but keeps its own allocation. Anyone on
          tonight's shift, WSO or employee, can generate, edit and save. There is no approval step.
        </p>
      </CardContent>
    </Card>
  );
}
