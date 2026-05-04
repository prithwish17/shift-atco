import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Calendar as CalendarIcon,
  CheckCircle2,
  Loader2,
  Shuffle,
  Sparkles,
  TriangleAlert,
  Users,
  Zap,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useUserProfile } from "@/hooks/useUsers";
import { useToast } from "@/hooks/use-toast";
import { getRosterAutomationApiBaseUrl } from "@/lib/appConfig";
import {
  fetchDateScan,
  type DateScanResponse,
  type DutyShift,
  type ShortageWithSuggestions,
  type TeamSuggestionCandidate,
} from "@/lib/rosterAutomation";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function dutyShiftLabel(shift: DutyShift) {
  if (shift === "M") return "Morning";
  if (shift === "A") return "Afternoon";
  return "Night";
}

function scoreLabel(score: number) {
  return `${Math.round(score * 100)}% fit`;
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function recommendationBadgeClass(type: TeamSuggestionCandidate["recommendation_type"]) {
  if (type === "exchange") return "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300";
  if (type === "compound") return "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
}

function recommendationLabel(type: TeamSuggestionCandidate["recommendation_type"]) {
  if (type === "exchange") return "Exchange";
  if (type === "compound") return "Compound";
  return "OPE";
}

function coverageStatus(available: number, required: number) {
  const ratio = available / required;
  if (ratio >= 1) return "ok";
  if (ratio >= 0.75) return "warn";
  return "critical";
}

function ShortageCard({ item }: { item: ShortageWithSuggestions }) {
  const { shortage, suggestions } = item;
  const status = coverageStatus(shortage.available, shortage.required);

  return (
    <Card
      className={cn(
        "border shadow-sm",
        status === "critical"
          ? "border-red-200 dark:border-red-900/60"
          : status === "warn"
            ? "border-amber-200 dark:border-amber-900/60"
            : "border-slate-200/80 dark:border-slate-800",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{shortage.group_name}</CardTitle>
              <Badge
                className={cn(
                  "border-0 text-xs",
                  shortage.shift === "N"
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                    : shortage.shift === "M"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
                )}
              >
                {dutyShiftLabel(shortage.shift)}
              </Badge>
            </div>
            <CardDescription className="mt-1 text-xs">
              Qualifying ratings: {shortage.qualifying_ratings.join(", ")}
            </CardDescription>
          </div>

          <div
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold",
              status === "critical"
                ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
            )}
          >
            <TriangleAlert className="h-3.5 w-3.5" />
            −{shortage.deficit} short
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" style={{ height: 6 }}>
            <div
              className={cn(
                "h-full rounded-full transition-all",
                status === "critical" ? "bg-red-500" : "bg-amber-500",
              )}
              style={{ width: `${Math.min(100, Math.round((shortage.available / shortage.required) * 100))}%` }}
            />
          </div>
          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
            {shortage.available} / {shortage.required} required
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {suggestions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
            No eligible candidates found for this shortage.
          </div>
        ) : (
          <div className="space-y-2.5">
            {suggestions.map((candidate, index) => (
              <div
                key={`${candidate.recommendation_type}-${candidate.employee_id}-${index}`}
                className="rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-950/70"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-950 dark:text-white">
                    {candidate.employee_name || candidate.employee_id}
                  </p>
                  <Badge className={cn("border-0 text-xs", recommendationBadgeClass(candidate.recommendation_type))}>
                    {recommendationLabel(candidate.recommendation_type)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">{scoreLabel(candidate.score)}</Badge>
                </div>

                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{candidate.reason}</p>

                <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                    Duty {candidate.current_duty_code || "None"}
                  </span>
                  {candidate.source_team ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                      Team {candidate.source_team}
                    </span>
                  ) : null}
                  {candidate.proposed_action.duty_code ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                      → {candidate.proposed_action.duty_code}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SupervisorSuggestions() {
  const automationApiBaseUrl = getRosterAutomationApiBaseUrl();
  const { toast } = useToast();
  const { user, session } = useAuth();
  const { profile } = useUserProfile(user?.id);

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [reviewer, setReviewer] = useState("Supervisor");
  const [requestedCount, setRequestedCount] = useState("5");
  const [result, setResult] = useState<DateScanResponse | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.full_name) return;
    setReviewer((current) => (current.trim() && current !== "Supervisor" ? current : profile.full_name));
  }, [profile?.full_name]);

  const selectedDateKey = format(selectedDate, "yyyy-MM-dd");

  const totalSuggestions = result?.shortages.reduce((sum, item) => sum + item.suggestions.length, 0) ?? 0;
  const shortagesFound = result?.shortages_found ?? 0;

  async function handleScan() {
    if (!automationApiBaseUrl) {
      setRunError("Set VITE_ROSTER_AUTOMATION_API_URL before requesting suggestions.");
      return;
    }

    setIsRunning(true);
    setRunError(null);

    try {
      const response = await fetchDateScan(
        automationApiBaseUrl,
        {
          date: selectedDateKey,
          requested_by: reviewer.trim() || undefined,
          requested_count: Math.max(1, Number(requestedCount) || 5),
        },
        session?.access_token,
      );

      setResult(response);

      if (response.shortages_found === 0) {
        toast({ title: "All groups covered", description: `No manpower shortages detected for ${format(selectedDate, "dd MMM yyyy")}.` });
      } else {
        toast({
          title: "Shortages detected",
          description: `${response.shortages_found} shortage${response.shortages_found !== 1 ? "s" : ""} found across rating groups for ${format(selectedDate, "dd MMM yyyy")}.`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch suggestions.";
      setRunError(message);
      toast({ variant: "destructive", title: "Scan failed", description: message });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-3">
            <Link to="/supervisor">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Roster Suggestions</h1>
              <p className="text-muted-foreground">
                Pick a date and scan all rating groups for manpower shortages. The engine suggests eligible controllers to fill each gap.
              </p>
            </div>
          </div>

          <Badge
            className={cn(
              "h-fit rounded-full px-3 py-1 text-xs",
              automationApiBaseUrl
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
            )}
          >
            {automationApiBaseUrl ? "Automation API Ready" : "Automation API Not Configured"}
          </Badge>
        </div>

        {!automationApiBaseUrl ? (
          <Alert className="border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Controller API needs a URL</AlertTitle>
            <AlertDescription>
              Set VITE_ROSTER_AUTOMATION_API_URL to your roster automation controller API, for example http://localhost:4000, then restart Shift ATCO.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader>
              <CardTitle>Date Shortage Scan</CardTitle>
              <CardDescription>
                Select a date to scan all rating groups (RSR, ASR, ACC/OCC, ADC/SMC, ALPHA) for Morning, Afternoon and Night shortages simultaneously.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(selectedDate, "PPP")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(date) => date && setSelectedDate(date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="scan-reviewer">Reviewer</Label>
                  <Input
                    id="scan-reviewer"
                    value={reviewer}
                    onChange={(event) => setReviewer(event.target.value)}
                    placeholder="Supervisor name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="scan-count">Max Suggestions / Shortage</Label>
                  <Input
                    id="scan-count"
                    type="number"
                    min={1}
                    max={10}
                    value={requestedCount}
                    onChange={(event) => setRequestedCount(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Scans Groups 1–5 (RSR · ASR · ACC/OCC · ADC/SMC · ALPHA) across all three shifts for {format(selectedDate, "dd MMM yyyy")}.
                </p>
                <Button onClick={handleScan} disabled={!automationApiBaseUrl || isRunning} className="min-w-[180px]">
                  {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                  {isRunning ? "Scanning..." : "Scan for Shortages"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader>
              <CardTitle>Scan Context</CardTitle>
              <CardDescription>Live readiness and last scan summary.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">API Endpoint</p>
                <p className="mt-2 text-sm font-medium text-slate-900 dark:text-white">{automationApiBaseUrl || "Not configured"}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/70">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Last Scan Run</p>
                  <p className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                    {result ? formatTimestamp(result.generated_at) : "No scan yet"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {result ? `${result.date} · by ${result.requested_by}` : "Press Scan for Shortages to run the daily availability check."}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/70 sm:col-span-2 xl:col-span-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Coverage Minimums</p>
                  <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                    <p>Group 1 RSR — M/A ≥12 · N ≥16</p>
                    <p>Group 2 ASR — M/A ≥4 · N ≥4</p>
                    <p>Group 3 ACC/OCC — M/A ≥11 · N ≥10</p>
                    <p>Group 4 ADC/SMC — M/A ≥9 · N ≥9</p>
                    <p>Group 5 ALPHA — M/A ≥11 · N ≥10</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {runError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Scan failed</AlertTitle>
            <AlertDescription>{runError}</AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="flex items-center gap-3 p-5">
                <div className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-2xl",
                  shortagesFound > 0
                    ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                )}>
                  {shortagesFound > 0 ? <TriangleAlert className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Shortages Found</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{shortagesFound}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="flex items-center gap-3 p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Total Suggestions</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{totalSuggestions}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="flex items-center gap-3 p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">OPE Candidates</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                    {result.shortages.reduce((sum, item) => sum + item.suggestions.filter((s) => s.recommendation_type === "ope").length, 0)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="flex items-center gap-3 p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                  <Shuffle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Exchange Candidates</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                    {result.shortages.reduce((sum, item) => sum + item.suggestions.filter((s) => s.recommendation_type === "exchange").length, 0)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {result?.warnings.length ? (
          <Alert className="border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Scan warnings</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {!result ? (
          <Card className="border-dashed border-slate-300/90 shadow-sm dark:border-slate-700">
            <CardContent className="flex min-h-[180px] flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Zap className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-950 dark:text-white">No scan run yet</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Pick a date and press Scan for Shortages to detect manpower gaps across all rating groups.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : result.shortages.length === 0 ? (
          <Card className="border-emerald-200/80 shadow-sm dark:border-emerald-900/40">
            <CardContent className="flex min-h-[140px] flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-950 dark:text-white">All groups covered</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Every rating group meets its minimum manpower requirements for {format(new Date(result.date), "dd MMM yyyy")}.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.shortages.map((item, index) => (
              <ShortageCard key={`${item.shortage.group_name}-${item.shortage.shift}-${index}`} item={item} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}