import { useMemo, useState } from "react";
import { eachDayOfInterval, endOfMonth, format, parseISO, startOfMonth, subDays } from "date-fns";
import { AlertTriangle, Download, ShieldAlert, ShieldCheck } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSupervisorScheduleMembers } from "@/hooks/useSupervisorScheduleMembers";
import { useApplyRuleOverrides } from "@/hooks/useApplyRuleOverrides";
import { useApplyRuleRegistry } from "@/hooks/useApplyRuleRegistry";
import { buildMonthlyAvailabilityReport } from "@/lib/supervisorAvailability";
import { buildTimelines } from "@/lib/compliance/rosterState";
import {
  detectAvailabilityBreaches,
  detectScheduleBreaches,
  detectWorkingHoursBreaches,
  sortBreaches,
  type Breach,
} from "@/lib/compliance/engine";
import type { Domain, Tier } from "@/lib/compliance/types";
import { cn } from "@/lib/utils";

const TIER_LABEL: Record<Tier, string> = {
  T4: "Regulatory (hard)",
  T3: "Regulatory (soft)",
  T2: "Operational",
  T1: "Advisory",
  T0: "Preference",
};

function tierBadgeClass(tier: Tier) {
  switch (tier) {
    case "T4": return "bg-rose-600 text-white";
    case "T3": return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
    case "T2": return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "T1": return "bg-sky-500/15 text-sky-700 dark:text-sky-300";
    default: return "bg-muted text-muted-foreground";
  }
}

const DOMAIN_LABEL: Record<Domain, string> = {
  schedule: "Schedule",
  workingHours: "Working Hours",
  availability: "Availability",
  exchange: "Exchange",
};

function entityLabel(b: Breach) {
  const e = b.entity;
  if (e.type === "shiftCell") return `${e.date} · ${e.shift} · ${e.group}`;
  if (e.type === "employee") return e.name || e.id;
  return `${e.name || e.id}${e.date ? ` · ${e.date}` : ""}${e.shift ? ` · ${e.shift}` : ""}`;
}

function toCsv(breaches: Breach[]) {
  const head = ["entity", "type", "domain", "rule", "tier", "reason", "observed", "threshold", "points", "ref"];
  const rows = breaches.map((b) => [
    entityLabel(b), b.entity.type, DOMAIN_LABEL[b.domain], b.title, b.tier,
    b.reason, b.observed ?? "", b.threshold ?? "", b.points, b.regulatoryRef ?? "",
  ]);
  return [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export default function ComplianceDashboard() {
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [domain, setDomain] = useState<Domain | "all">("all");
  const [tier, setTier] = useState<Tier | "all">("all");

  const refDate = useMemo(() => parseISO(`${month}-01`), [month]);
  const monthStart = format(startOfMonth(refDate), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(refDate), "yyyy-MM-dd");
  const windowStart = format(subDays(startOfMonth(refDate), 30), "yyyy-MM-dd"); // 30-day rolling lookback

  const { data: members, isLoading, isError, error } = useSupervisorScheduleMembers(windowStart, monthEnd);
  const overridesToken = useApplyRuleOverrides();
  const registryToken = useApplyRuleRegistry();

  const allBreaches = useMemo(() => {
    if (!members) return [] as Breach[];
    const timelines = buildTimelines(members);
    const dates = eachDayOfInterval({ start: startOfMonth(refDate), end: endOfMonth(refDate) }).map((d) =>
      format(d, "yyyy-MM-dd"),
    );
    const report = buildMonthlyAvailabilityReport(refDate, members);
    return sortBreaches([
      ...detectScheduleBreaches(timelines.values(), dates),
      ...detectWorkingHoursBreaches(timelines.values(), monthStart, monthEnd),
      ...detectAvailabilityBreaches(report),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, refDate, monthStart, monthEnd, overridesToken, registryToken]);

  const filtered = useMemo(
    () => allBreaches.filter((b) => (domain === "all" || b.domain === domain) && (tier === "all" || b.tier === tier)),
    [allBreaches, domain, tier],
  );

  const counts = useMemo(() => {
    const byDomain: Record<string, number> = {};
    let hard = 0;
    allBreaches.forEach((b) => {
      byDomain[b.domain] = (byDomain[b.domain] || 0) + 1;
      if (b.tier === "T4") hard += 1;
    });
    return { total: allBreaches.length, hard, byDomain };
  }, [allBreaches]);

  const download = () => {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-breaches-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compliance Dashboard</h1>
          <p className="text-muted-foreground">
            Rule breaches across Schedule, Working Hours and the Daily Availability Chart — worst first.
            Every breach is scored by severity tier and traced to its rule.
          </p>
        </div>

        <Card>
          <CardContent className="grid gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Month</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Domain</Label>
              <Select value={domain} onValueChange={(v) => setDomain(v as Domain | "all")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All domains</SelectItem>
                  <SelectItem value="schedule">Schedule</SelectItem>
                  <SelectItem value="workingHours">Working Hours</SelectItem>
                  <SelectItem value="availability">Availability</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Severity</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as Tier | "all")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  <SelectItem value="T4">Regulatory (hard)</SelectItem>
                  <SelectItem value="T3">Regulatory (soft)</SelectItem>
                  <SelectItem value="T2">Operational</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={download} disabled={filtered.length === 0}>
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading && (
          <Card><CardContent className="space-y-3 py-6">
            <Skeleton className="h-6 w-1/3" /><Skeleton className="h-24 w-full" />
          </CardContent></Card>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Could not load roster data</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : "Unknown error"}</AlertDescription>
          </Alert>
        )}

        {members && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total breaches" value={counts.total} icon={<ShieldAlert className="h-4 w-4" />} tone={counts.total ? "bad" : "good"} />
              <StatCard label="Hard (regulatory)" value={counts.hard} icon={<AlertTriangle className="h-4 w-4" />} tone={counts.hard ? "bad" : "good"} />
              <StatCard label="Schedule" value={counts.byDomain["schedule"] || 0} icon={<ShieldCheck className="h-4 w-4" />} tone="neutral" />
              <StatCard label="Working hours" value={counts.byDomain["workingHours"] || 0} icon={<ShieldCheck className="h-4 w-4" />} tone="neutral" />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Breaches ({filtered.length})</CardTitle>
                <CardDescription>Sorted by severity — most serious at the top.</CardDescription>
              </CardHeader>
              <CardContent>
                {filtered.length === 0 ? (
                  <Alert>
                    <ShieldCheck className="h-4 w-4" />
                    <AlertTitle>No breaches found</AlertTitle>
                    <AlertDescription>Nothing violates the rule set for this month and filter.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Who / Where</TableHead>
                          <TableHead>Domain</TableHead>
                          <TableHead>Rule</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Detail</TableHead>
                          <TableHead className="text-right">Pts</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((b, i) => (
                          <TableRow key={`${b.entity.id}-${b.ruleId}-${i}`}>
                            <TableCell className="font-medium">{entityLabel(b)}</TableCell>
                            <TableCell>{DOMAIN_LABEL[b.domain]}</TableCell>
                            <TableCell>
                              <div>{b.title}</div>
                              {b.regulatoryRef && <div className="text-xs text-muted-foreground">{b.regulatoryRef}</div>}
                            </TableCell>
                            <TableCell>
                              <Badge className={cn("font-medium", tierBadgeClass(b.tier))}>{TIER_LABEL[b.tier]}</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{b.reason}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums text-rose-600">{b.points}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: "good" | "bad" | "neutral" }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-4">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className={cn(
            "text-2xl font-semibold tabular-nums",
            tone === "bad" && value > 0 && "text-rose-600",
            tone === "good" && "text-emerald-600",
          )}>{value}</div>
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}
