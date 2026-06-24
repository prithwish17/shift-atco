import { useMemo, useState } from "react";
import { addDays, eachDayOfInterval, format, isToday, isTomorrow, parseISO, subDays } from "date-fns";
import {
  AlertTriangle,
  CalendarIcon,
  CheckCircle2,
  ChevronRight,
  Info,
  Loader2,
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
import type {
  AvailabilityCandidate,
  BlockedCandidate,
  ShiftBreach,
} from "@/lib/availabilityEngine";
import { RATING_GROUPS, type GroupNum } from "@/lib/supervisorAvailability";
import {
  findAvailability,
  scanBreaches,
  shiftLabel,
  type RatingFilter,
  type ShiftCode,
} from "@/lib/availabilityEngine";

const SHIFT_OPTIONS: ShiftCode[] = ["M", "A", "N"];
const RATING_GROUP_NUMS = Object.keys(RATING_GROUPS).map(Number) as GroupNum[];

function fitColor(fit: number) {
  if (fit >= 85) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/30";
  if (fit >= 65) return "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/30";
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/30";
}

const SHIFT_ORDER: Record<ShiftCode, number> = { M: 0, A: 1, N: 2 };

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

export default function AvailabilityFinder() {
  const [date, setDate] = useState<Date>(new Date());
  const [shift, setShift] = useState<ShiftCode>("N");
  const [rating, setRating] = useState<RatingFilter>("ALL");
  const [query, setQuery] = useState<{ date: string; shift: ShiftCode; rating: RatingFilter } | null>(null);

  // Fetch a small window around the target date so rest / consecutive-night
  // rules can look back 2 days and forward 1 day.
  const windowStart = query ? format(subDays(parseISO(query.date), 2), "yyyy-MM-dd") : undefined;
  const windowEnd = query ? format(addDays(parseISO(query.date), 1), "yyyy-MM-dd") : undefined;

  const { data: members, isLoading, isError, error } = useSupervisorScheduleMembers(windowStart, windowEnd);
  const { data: history } = useEmployeeHistory(query?.date);

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
    // Chronological dates; within a date order by shift (M→A→N) then worst gap first.
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
  const overridesToken = useApplyRuleOverrides();
  const registryToken = useApplyRuleRegistry();
  const { user } = useAuth();
  const { toast } = useToast();
  const logDecision = useLogDecision();

  const recordAccept = async (c: AvailabilityCandidate) => {
    if (!query) return;
    await logDecision.mutateAsync({
      action: "accept_suggestion",
      actor_id: user?.id ?? null,
      actor_name: user?.email ?? null,
      target_date: query.date,
      shift: query.shift,
      rating: query.rating === "ALL" ? "ALL" : String(query.rating),
      employee_id: c.employeeId,
      employee_name: c.name,
      score: c.score,
      reason: `Accepted ${c.mode} from ${c.originLabel}`,
      snapshot: { ledger: c.ledger, fit: c.fit, history: c.history },
    });
    toast({ title: "Decision recorded", description: `${c.name} — logged to audit trail` });
  };

  const recordOverride = async (b: BlockedCandidate) => {
    if (!query) return;
    const reason = window.prompt(`Override justification for ${b.name} (blocked):\n${b.blockReasons.join("; ")}`);
    if (!reason) return;
    await logDecision.mutateAsync({
      action: "override_block",
      actor_id: user?.id ?? null,
      actor_name: user?.email ?? null,
      target_date: query.date,
      shift: query.shift,
      employee_id: b.employeeId,
      employee_name: b.name,
      reason,
      snapshot: { blockReasons: b.blockReasons, origin: b.originLabel },
    });
    toast({ title: "Override recorded", description: `${b.name} — justification logged` });
  };

  const result = useMemo(() => {
    if (!query || !members) return null;
    return findAvailability({
      members,
      date: query.date,
      shift: query.shift,
      rating: query.rating,
      history,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, members, history, overridesToken, registryToken]);

  const runSearch = () => {
    setQuery({ date: format(date, "yyyy-MM-dd"), shift, rating });
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

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Availability Finder</h1>
          <p className="text-muted-foreground">
            Pick a date, shift and rating to rank who can be brought in to cover it — checked against
            rest, night-limit, transition and one-duty-per-day rules. Runs fully in-app.
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
                  Manpower available — {shiftLabel(result.shift)} shift
                </CardTitle>
                <CardDescription>
                  Qualified controllers on duty vs. the daily minimum for each rating group, for {format(parseISO(result.date), "d MMM yyyy")}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {result.ratingAvailability.map((cell) => (
                    <div
                      key={cell.key}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-3 py-2",
                        cell.deficit > 0 ? "border-rose-500/40 bg-rose-500/5" : "border-emerald-500/30 bg-emerald-500/5",
                      )}
                    >
                      <span className="text-sm font-medium">{cell.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums">
                          {cell.available}
                          <span className="text-muted-foreground">/{cell.required}</span>
                        </span>
                        {cell.deficit > 0 ? (
                          <Badge variant="destructive">Short {cell.deficit}</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-300">
                            +{cell.available - cell.required}
                          </Badge>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  Available — ranked ({result.candidates.length})
                </CardTitle>
                <CardDescription>
                  People who can cover this shift without breaking any rule. Call-ins are listed before swaps.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.candidates.length === 0 && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>No rule-safe candidates</AlertTitle>
                    <AlertDescription>
                      Nobody with this rating is free to cover this shift without a rule violation. See the
                      blocked list below for why, or try a different rating/shift.
                    </AlertDescription>
                  </Alert>
                )}

                {result.candidates.map((c) => (
                  <div
                    key={c.employeeId}
                    className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        {c.rating && <Badge variant="outline">{c.rating}</Badge>}
                        {c.team && <Badge variant="outline">Team {c.team}</Badge>}
                        <Badge variant="outline">From: {c.originLabel}</Badge>
                        <Badge variant={c.priorityClass === 2 ? "destructive" : c.mode === "call-in" ? "default" : "secondary"}>
                          {c.priorityClass === 2 ? "Clear-off (last resort)" : c.mode === "call-in" ? "Call-in" : "Swap"}
                        </Badge>
                        {c.history && (
                          <Badge variant="outline" className="font-normal text-muted-foreground">
                            {c.history.exYear} exch · {c.history.opeYear} OPE (yr)
                          </Badge>
                        )}
                      </div>
                      {c.reasons.length > 0 && (
                        <ul className="text-sm text-muted-foreground">
                          {c.reasons.map((r, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                              {r}
                            </li>
                          ))}
                        </ul>
                      )}
                      {c.warnings.length > 0 && (
                        <ul className="text-sm text-amber-700 dark:text-amber-400">
                          {c.warnings.map((w, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              {w}
                            </li>
                          ))}
                        </ul>
                      )}
                      {c.coverage.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-xs font-medium text-muted-foreground">Cover impact:</span>
                          {c.coverage.map((cov) => (
                            <span
                              key={cov.groupKey}
                              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
                            >
                              <span className="font-medium">{cov.label}</span>
                              <span className="text-muted-foreground">
                                {shiftLabel(cov.targetShift)} {cov.targetAvailable}/{cov.targetRequired} → {cov.targetAvailable + 1}
                              </span>
                              {cov.donorShift && cov.donorAvailable !== null && cov.donorRequired !== null && (
                                <span className="text-rose-600 dark:text-rose-400">
                                  · from {shiftLabel(cov.donorShift)} {cov.donorAvailable}/{cov.donorRequired} → {cov.donorAvailable - 1}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 self-start">
                      <div className="rounded-md bg-foreground/5 px-2.5 py-1 text-sm font-semibold tabular-nums">
                        {c.score >= 0 ? `+${c.score}` : c.score} pts
                      </div>
                      <div
                        className={cn(
                          "rounded-md px-2.5 py-1 text-sm font-semibold tabular-nums",
                          fitColor(c.fit),
                        )}
                      >
                        {c.fit}% fit
                      </div>
                      <Button size="sm" variant="outline" onClick={() => recordAccept(c)} disabled={logDecision.isPending}>
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Accept
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {result.alreadyCovering.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Already on this shift ({result.alreadyCovering.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {result.alreadyCovering.map((m) => (
                      <Badge key={m.employeeId} variant="secondary">
                        {m.name}
                        {m.team ? ` · ${m.team}` : ""}
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
                  <CardDescription>Have the rating but cannot take this shift without a violation.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {result.blocked.map((b) => (
                    <div key={b.employeeId} className="rounded-lg border border-dashed p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{b.name}</span>
                        {b.rating && <Badge variant="outline">{b.rating}</Badge>}
                        {b.team && <Badge variant="outline">Team {b.team}</Badge>}
                        <Badge variant="outline">From: {b.originLabel}</Badge>
                      </div>
                      <ul className="mt-1 text-sm text-rose-700 dark:text-rose-400">
                        {b.blockReasons.map((r, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-7 text-xs text-muted-foreground"
                        onClick={() => recordOverride(b)}
                        disabled={logDecision.isPending}
                      >
                        Override with justification
                      </Button>
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
