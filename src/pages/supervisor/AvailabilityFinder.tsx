import { useMemo, useState } from "react";
import { addDays, eachDayOfInterval, format, isToday, isTomorrow, parseISO, subDays } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  CalendarIcon,
  CheckCircle2,
  ChevronRight,
  Info,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSupervisorScheduleMembers } from "@/hooks/useSupervisorScheduleMembers";
import { useEmployeeHistory } from "@/hooks/useEmployeeHistory";
import { useLogDecision } from "@/hooks/useComplianceAudit";
import { useApplyRuleOverrides } from "@/hooks/useApplyRuleOverrides";
import { useApplyRuleRegistry } from "@/hooks/useApplyRuleRegistry";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { applyDutyPlan } from "@/data-access/schedule.repository";
import { RATING_GROUPS, type GroupNum } from "@/lib/supervisorAvailability";
import type { CoverOption } from "@/lib/compliance/ladder";
import { validateBasket } from "@/lib/compliance/basket";
import { describeImpact } from "@/lib/compliance/manpower";
import { originLabel } from "@/lib/compliance/rosterState";
import { useCoverBasket } from "@/hooks/useCoverBasket";
import { CoverBasket } from "@/components/availability/CoverBasket";
import { DayManpowerPanel } from "@/components/availability/DayManpowerPanel";
import { PlanImpactTable, SafetyMarginBadge } from "@/components/availability/PlanImpactTable";
import {
  findAvailability,
  scanBreaches,
  shiftLabel,
  type RatingFilter,
  type ShiftBreach,
  type ShiftCode,
} from "@/lib/availabilityEngine";

const SHIFT_OPTIONS: ShiftCode[] = ["M", "A", "N"];
const RATING_GROUP_NUMS = Object.keys(RATING_GROUPS).map(Number) as GroupNum[];
const SHIFT_ORDER: Record<ShiftCode, number> = { M: 0, A: 1, N: 2 };

/**
 * Rules reach up to 29 days either side of a change (the trailing 30-day cap), and a
 * night-break writes to the following day too. Anything narrower silently disables the
 * cumulative gates, because absent dates count as zero hours.
 */
const VALIDATION_RADIUS_DAYS = 31;

/** Short on the day: 3+ below minimum is critical, 1–2 is a lighter "watch". */
function breachSeverity(deficit: number): "critical" | "watch" {
  return deficit >= 3 ? "critical" : "watch";
}

/** Friendly date heading: "Today", "Tomorrow", else "Mon · 23 Jun". */
function friendlyDateLabel(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEE · d MMM");
}

/** The duty-code changes a plan makes, e.g. "11 Mar: N → M". */
function MutationTrail({ option }: { option: CoverOption }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {option.mutations.map((m) => (
        <span
          key={`${m.date}-${m.to}`}
          className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-xs"
        >
          <span className="text-muted-foreground">{format(parseISO(m.date), "d MMM")}</span>
          <span className="font-medium">{m.from ?? "—"}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="font-semibold">{m.to}</span>
        </span>
      ))}
    </div>
  );
}

/** The rotation counters behind an option's fairness position. */
function RotationLoad({ option }: { option: CoverOption }) {
  const f = option.fairness;
  const parts = [
    { label: "exchanges", year: f.exchangesYear, month: f.exchangesMonth },
    { label: "extra duties", year: f.opeYear, month: f.opeMonth },
    { label: "night-breaks", year: f.nightBreaksYear, month: f.nightBreaksMonth },
  ].filter((p) => p.year > 0);

  if (parts.length === 0) {
    return <span className="text-xs text-muted-foreground">No duty changes asked of them this year</span>;
  }

  return (
    <span className="text-xs text-muted-foreground">
      This year:{" "}
      {parts
        .map((p) => `${p.year} ${p.label}${p.month > 0 ? ` (${p.month} this month)` : ""}`)
        .join(" · ")}
    </span>
  );
}

/** Warnings and exempted rules, in the shared wording used for blocked options too. */
function WarningList({ entries }: { entries: CoverOption["warnings"] }) {
  if (entries.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-sm">
      {entries.map((w, i) => (
        <li
          key={i}
          className={cn(
            "flex items-start gap-1.5",
            // An exempted rule is reported for visibility but is not a breach —
            // colouring it like one would train supervisors to ignore warnings.
            w.exemption ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400",
          )}
        >
          {w.exemption ? (
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>
            <span className="font-medium">{w.title}</span> — {w.reason}
            {w.regulatoryRef && <span className="opacity-70"> ({w.regulatoryRef})</span>}
            {w.exemption && (
              <span className="opacity-70">
                {" "}
                · exempted by {w.exemption.authority}, {w.exemption.reference}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Where the controller is coming from and what they end up rostered as. */
function DutyTransition({ option }: { option: CoverOption }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border bg-muted/40 px-1.5 py-0.5 text-xs">
      <span className="text-muted-foreground">{originLabel(option.currentDutyCode)}</span>
      <span className="font-mono">{option.currentDutyCode ?? "—"}</span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <span className="font-mono font-semibold">{option.targetDutyCode}</span>
    </span>
  );
}

function OptionRow({
  option,
  onStage,
  onApply,
  applying,
  staged,
}: {
  option: CoverOption;
  onStage: (o: CoverOption) => void;
  /** Only offered while nothing is staged — see the note on the buttons below. */
  onApply: ((o: CoverOption) => void) | null;
  applying: boolean;
  staged: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{option.name}</span>
          {option.rating && <Badge variant="outline">{option.rating}</Badge>}
          {option.team && <Badge variant="outline">Team {option.team}</Badge>}
          {option.createsOpe && (
            <Badge className="border-violet-500/40 bg-violet-500/15 text-violet-700 hover:bg-violet-500/15 dark:text-violet-300">
              Extra duty (OPE)
            </Badge>
          )}
          <SafetyMarginBadge impact={option.impact} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <DutyTransition option={option} />
          <MutationTrail option={option} />
        </div>

        {option.rationale && <p className="text-sm text-muted-foreground">{option.rationale}</p>}

        <WarningList entries={option.warnings} />

        <div className="space-y-1 rounded-md border bg-muted/20 p-2">
          <span className="text-xs font-medium text-muted-foreground">
            Manpower effect — each rating group against its own minimum
          </span>
          <PlanImpactTable impact={option.impact} />
        </div>

        <RotationLoad option={option} />
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-1.5 self-start">
        <Button size="sm" onClick={() => onStage(option)} disabled={staged}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {staged ? "Staged" : "Stage"}
        </Button>
        {/*
          "Apply now" disappears once anything is staged. This option was gated
          against the roster WITH those staged picks in it, so writing it on its own
          would be checking one plan and applying another — a staged pick that adds
          to a shift can be what made this one look affordable.
        */}
        {onApply && (
          <Button size="sm" variant="outline" onClick={() => onApply(option)} disabled={applying}>
            {applying ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            )}
            Apply now
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AvailabilityFinder() {
  const [date, setDate] = useState<Date>(new Date());
  const [shift, setShift] = useState<ShiftCode>("N");
  const [rating, setRating] = useState<RatingFilter>("ALL");
  const [query, setQuery] = useState<{ date: string; shift: ShiftCode; rating: RatingFilter } | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // Wide enough that the 7-day and 30-day caps and the consecutive-day rules see
  // real history. The previous D-2 … D+1 window made all three unfireable.
  const windowStart = query
    ? format(subDays(parseISO(query.date), VALIDATION_RADIUS_DAYS), "yyyy-MM-dd")
    : undefined;
  const windowEnd = query
    ? format(addDays(parseISO(query.date), VALIDATION_RADIUS_DAYS), "yyyy-MM-dd")
    : undefined;

  const { data: members, isLoading, isError, error } = useSupervisorScheduleMembers(windowStart, windowEnd);
  const { data: history } = useEmployeeHistory(query?.date);

  const overridesToken = useApplyRuleOverrides();
  const registryToken = useApplyRuleRegistry();
  const { user } = useAuth();
  const { toast } = useToast();
  const logDecision = useLogDecision();
  const queryClient = useQueryClient();
  const basket = useCoverBasket();

  // Breach banner: scan today → +14 days for any rating cell below its minimum.
  const breachWindow = useMemo(() => {
    const today = new Date();
    return { start: format(today, "yyyy-MM-dd"), end: format(addDays(today, 14), "yyyy-MM-dd") };
  }, []);
  const { data: breachMembers, isLoading: breachLoading } = useSupervisorScheduleMembers(
    breachWindow.start,
    breachWindow.end,
  );
  const breaches = useMemo(() => {
    if (!breachMembers) return [];
    const dates = eachDayOfInterval({
      start: parseISO(breachWindow.start),
      end: parseISO(breachWindow.end),
    }).map((d) => format(d, "yyyy-MM-dd"));
    return scanBreaches(breachMembers, dates);
  }, [breachMembers, breachWindow]);

  const breachesByDate = useMemo(() => {
    const map = new Map<string, ShiftBreach[]>();
    for (const breach of breaches) {
      const list = map.get(breach.date) || [];
      list.push(breach);
      map.set(breach.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift] || b.deficit - a.deficit);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [breaches]);

  const breachSummary = useMemo(() => {
    let critical = 0;
    let watch = 0;
    for (const b of breaches) {
      if (breachSeverity(b.deficit) === "critical") critical += 1;
      else watch += 1;
    }
    return { critical, watch, days: breachesByDate.length };
  }, [breaches, breachesByDate]);

  const result = useMemo(() => {
    if (!query || !members) return null;
    return findAvailability({
      members,
      date: query.date,
      shift: query.shift,
      rating: query.rating,
      history,
      pending: basket.mutations,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, members, history, basket.mutations, overridesToken, registryToken]);

  // Re-checked against the live roster on every render of the basket, not captured
  // when the picks were made: the whole point is to notice the roster moving.
  const basketValidation = useMemo(
    () => (members && basket.picks.length > 0 ? validateBasket(members, basket.picks) : null),
    [members, basket.picks],
  );

  const stagedIds = useMemo(() => new Set(basket.picks.map((p) => p.id)), [basket.picks]);

  const runSearch = () => {
    setQuery({ date: format(date, "yyyy-MM-dd"), shift, rating });
  };

  const stageOption = (option: CoverOption) => {
    if (!query) return;
    const refusal = basket.add(option, query.date, query.shift);
    if (refusal) toast({ title: "Not staged", description: refusal, variant: "destructive" });
  };

  const commitBasket = async () => {
    if (!members || !query) return;
    await basket.commit(members, query.rating);
  };

  const applyBreach = (breach: ShiftBreach) => {
    const nextRating: RatingFilter = breach.key.startsWith("G")
      ? (Number(breach.key.slice(1)) as GroupNum)
      : "ALL";
    setDate(parseISO(breach.date));
    setShift(breach.shift);
    setRating(nextRating);
    setQuery({ date: breach.date, shift: breach.shift, rating: nextRating });
  };

  const applyOption = async (option: CoverOption) => {
    if (!query) return;
    const summary = option.mutations.map((m) => `${m.date}: ${m.from ?? "—"} → ${m.to}`).join(", ");
    const coverage = describeImpact(option.impact);

    // The manpower consequence goes in the confirmation, not just the audit log —
    // the supervisor is signing off on the shift this LEAVES, as much as the one
    // it fills, and that is the half that is easy to forget.
    if (
      !window.confirm(
        `Apply this duty change?\n\n${option.name}\n${summary}\n\nManpower effect:\n${coverage}`,
      )
    ) {
      return;
    }

    setApplyingId(option.id);
    try {
      await applyDutyPlan({ mutations: option.mutations, employeeName: option.name });
      await logDecision.mutateAsync({
        action: "apply_cover_plan",
        actor_id: user?.id ?? null,
        actor_name: user?.email ?? null,
        target_date: query.date,
        shift: query.shift,
        rating: query.rating === "ALL" ? "ALL" : String(query.rating),
        employee_id: option.employeeId,
        employee_name: option.name,
        score: option.rung,
        reason: `${option.strategyLabel} (rung ${option.rung}) — ${summary} · ${coverage}`,
        snapshot: {
          strategy: option.strategy,
          rung: option.rung,
          mutations: option.mutations,
          ledger: option.ledger,
          warnings: option.warnings,
          fairnessLoad: option.fairnessLoad,
          createsOpe: option.createsOpe,
          // The chart arithmetic the decision was made on, so an audit can replay
          // what the source shifts looked like at the moment of the call.
          impact: option.impact,
        },
      });

      // Both the roster and the rotation counters move when a plan lands — an OPE
      // just applied has to be visible the next time this controller is ranked.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["supervisor-schedule-members"] }),
        queryClient.invalidateQueries({ queryKey: ["employee-history"] }),
      ]);
      toast({ title: "Duty change applied", description: `${option.name} — ${summary}` });
    } catch (e) {
      toast({
        title: "Could not apply",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Availability Finder</h1>
          <p className="text-muted-foreground">
            Pick a date, shift and rating to see who can cover it — ordered by the operational
            ladder, checked against the DGCA duty limits and the daily manpower minimums.
          </p>
        </div>

        {breachLoading ? (
          <Card>
            <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning {format(parseISO(breachWindow.start), "d MMM")} – {format(parseISO(breachWindow.end), "d MMM")} for manpower breaches…
            </CardContent>
          </Card>
        ) : breaches.length === 0 ? (
          <Alert className="border-emerald-500/30 bg-emerald-500/5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>No manpower breaches</AlertTitle>
            <AlertDescription>
              Every rating group meets its minimum across {format(parseISO(breachWindow.start), "d MMM")} – {format(parseISO(breachWindow.end), "d MMM yyyy")}.
            </AlertDescription>
          </Alert>
        ) : (
          <Card className="border-rose-500/40 bg-rose-500/[0.03]">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg">
                <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
                <span>Manpower gaps in the next 14 days</span>
                <span className="flex items-center gap-1.5">
                  {breachSummary.critical > 0 && (
                    <Badge variant="destructive">{breachSummary.critical} critical</Badge>
                  )}
                  {breachSummary.watch > 0 && (
                    <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300">
                      {breachSummary.watch} to watch
                    </Badge>
                  )}
                </span>
              </CardTitle>
              <CardDescription>
                {breachSummary.days} {breachSummary.days === 1 ? "day has" : "days have"} a rating group below its daily
                minimum. Tap any gap to see who can cover it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {breachesByDate.map(([breachDate, dateBreaches]) => (
                <div key={breachDate} className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">{friendlyDateLabel(breachDate)}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(breachDate), "d MMM yyyy")} · {dateBreaches.length}{" "}
                      {dateBreaches.length === 1 ? "gap" : "gaps"}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {dateBreaches.map((b) => {
                      const critical = breachSeverity(b.deficit) === "critical";
                      return (
                        <button
                          key={`${b.date}-${b.shift}-${b.key}`}
                          type="button"
                          onClick={() => applyBreach(b)}
                          className={cn(
                            "group flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                            critical
                              ? "border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/15"
                              : "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/15",
                          )}
                        >
                          <span className="flex items-center gap-2.5">
                            <span
                              className={cn(
                                "mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full",
                                critical ? "bg-rose-500" : "bg-amber-500",
                              )}
                              aria-hidden
                            />
                            <span className="space-y-0.5">
                              <span className="block text-sm font-medium">
                                {shiftLabel(b.shift)} · {b.label}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {b.available} of {b.required} on duty —{" "}
                                <span className={critical ? "font-medium text-rose-700 dark:text-rose-300" : "font-medium text-amber-700 dark:text-amber-300"}>
                                  need {b.deficit} more
                                </span>
                              </span>
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                            Find cover
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Search</CardTitle>
            <CardDescription>All checks run on your live roster data. No external service.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(date, "d MMM yyyy (EEE)")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Shift</Label>
                <Select value={shift} onValueChange={(v) => setShift(v as ShiftCode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIFT_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {shiftLabel(s)} ({s})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Rating</Label>
                <Select value={String(rating)} onValueChange={(v) => setRating(v === "ALL" ? "ALL" : (Number(v) as GroupNum))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All ratings</SelectItem>
                    {RATING_GROUP_NUMS.map((g) => (
                      <SelectItem key={g} value={String(g)}>
                        {RATING_GROUPS[g].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button className="w-full" onClick={runSearch}>
                  <Search className="mr-2 h-4 w-4" />
                  Find available
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/*
          Above the results, not below them: the staged picks are the premise every
          suggestion underneath is now being judged against, so they have to be read
          first.
        */}
        <CoverBasket
          picks={basket.picks}
          validation={basketValidation}
          committing={basket.committing}
          onRemove={basket.remove}
          onClear={basket.clear}
          onCommit={commitBasket}
        />

        {query && isLoading && (
          <Card>
            <CardContent className="space-y-3 py-6">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        )}

        {query && isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Could not load roster data</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : "Unknown error"}</AlertDescription>
          </Alert>
        )}

        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{format(parseISO(result.date), "d MMM yyyy (EEE)")}</Badge>
              <Badge variant="secondary">{shiftLabel(result.shift)} shift</Badge>
              <Badge variant="secondary">{result.ratingLabel}</Badge>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {result.meta.poolSize} with this rating
              </span>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Manpower on {format(parseISO(result.date), "d MMM yyyy (EEE)")}
                </CardTitle>
                <CardDescription>
                  Every shift of the day, not just the one being filled — each rating group's
                  head-count against its own minimum. Any plan that covers the{" "}
                  {shiftLabel(result.shift)} takes the body off one of the other columns, and
                  that column has to survive it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DayManpowerPanel
                  day={result.dayManpower}
                  projected={result.projectedManpower}
                  focusShift={result.shift}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  Ways to cover this shift ({result.options.length})
                </CardTitle>
                <CardDescription>
                  Grouped by the operational ladder — try the top group first. Within a group,
                  whoever has been asked least often this year comes first; where that ties,
                  the plan that leaves more spare in the shift it draws from. Every option
                  here has already been checked against its source shift's own minimums.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {result.options.length === 0 && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>No rule-safe way to cover this</AlertTitle>
                    <AlertDescription>
                      Every option breaks a duty limit or would leave another shift below its
                      minimum. See the blocked list below for the specific rule in each case.
                    </AlertDescription>
                  </Alert>
                )}

                {result.rungs.map((group) => (
                  <div key={group.rung} className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <Badge variant="default">Option {group.rung}</Badge>
                      <span className="text-sm font-semibold">{group.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {group.options.length} {group.options.length === 1 ? "person" : "people"}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {group.options.map((option) => (
                        <OptionRow
                          key={option.id}
                          option={option}
                          onStage={stageOption}
                          onApply={basket.picks.length === 0 ? applyOption : null}
                          applying={applyingId === option.id}
                          staged={stagedIds.has(option.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {result.alreadyCovering.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">On this shift ({result.alreadyCovering.length})</CardTitle>
                  <CardDescription>
                    Rostered here already, plus anyone a staged pick would put here — those
                    are marked, because nothing is written until the basket is applied.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {result.alreadyCovering.map((m) => (
                      <Badge
                        key={m.employeeId}
                        variant={m.staged ? "default" : "secondary"}
                        className={m.staged ? "gap-1" : undefined}
                      >
                        {m.name}
                        {m.team ? ` · ${m.team}` : ""}
                        {m.staged && <span className="opacity-80">· staged</span>}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {result.blocked.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                    Rule-blocked ({result.blocked.length})
                  </CardTitle>
                  <CardDescription>
                    Options that would break a duty limit or a manpower minimum, with the rule
                    each one fails.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {result.blocked.map((b) => (
                    <div key={b.id} className="rounded-lg border border-dashed p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{b.name}</span>
                        {b.rating && <Badge variant="outline">{b.rating}</Badge>}
                        {b.team && <Badge variant="outline">Team {b.team}</Badge>}
                        <Badge variant="secondary">{b.strategyLabel}</Badge>
                        {b.createsOpe && (
                          <Badge className="border-violet-500/40 bg-violet-500/15 text-violet-700 hover:bg-violet-500/15 dark:text-violet-300">
                            Extra duty (OPE)
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <DutyTransition option={b} />
                        <MutationTrail option={b} />
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-sm text-rose-700 dark:text-rose-400">
                        {b.blockingFailures.map((f, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              <span className="font-medium">{f.title}</span> — {f.reason}
                              {f.regulatoryRef && (
                                <span className="text-muted-foreground"> ({f.regulatoryRef})</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {b.impact.releases.length > 0 && (
                        <div className="mt-1.5 space-y-1 rounded-md border bg-muted/20 p-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Manpower effect
                          </span>
                          <PlanImpactTable impact={b.impact} />
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
