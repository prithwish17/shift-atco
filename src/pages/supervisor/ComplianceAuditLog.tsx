import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Download, History, ShieldCheck } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuditLog } from "@/hooks/useComplianceAudit";
import type { AuditLogEntry } from "@/data-access/compliance-audit.repository";

const ACTION_LABEL: Record<string, string> = {
  accept_suggestion: "Accepted suggestion",
  reject_suggestion: "Rejected suggestion",
  override_block: "Override (blocked)",
  acknowledge_breach: "Acknowledged breach",
  rule_override_set: "Rule override set",
};

function actionBadge(action: string) {
  if (action === "override_block") return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  if (action === "rule_override_set") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  if (action === "accept_suggestion") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  return "bg-muted text-muted-foreground";
}

function toCsv(rows: AuditLogEntry[]) {
  const head = ["when", "actor", "action", "subject", "date", "shift", "rule", "score", "reason"];
  const body = rows.map((r) => [
    r.created_at, r.actor_name || r.actor_id || "", ACTION_LABEL[r.action] || r.action,
    r.employee_name || r.employee_id || "", r.target_date || "", r.shift || "", r.rule_id || "",
    r.score ?? "", r.reason || "",
  ]);
  return [head, ...body].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export default function ComplianceAuditLog() {
  const { data, isLoading, isError, error } = useAuditLog();
  const [action, setAction] = useState<string>("all");

  const rows = data?.rows ?? [];
  const provisioned = data?.provisioned ?? true;

  const filtered = useMemo(
    () => rows.filter((r) => action === "all" || r.action === action),
    [rows, action],
  );

  const download = () => {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-audit-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <History className="h-6 w-6" /> Compliance Audit Log
          </h1>
          <p className="text-muted-foreground">
            Append-only trail of every decision, override and rule change — retained for DGCA oversight.
          </p>
        </div>

        {!provisioned && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Audit tables not provisioned yet</AlertTitle>
            <AlertDescription>
              Apply <code>supabase/migrations/20260616_compliance_audit.sql</code> to enable the audit trail.
              Decisions are silently skipped until then.
            </AlertDescription>
          </Alert>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Could not load the audit log</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : "Unknown error"}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg">Entries ({filtered.length})</CardTitle>
              <CardDescription>Most recent first.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {Object.entries(ACTION_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={download} disabled={filtered.length === 0}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
            ) : filtered.length === 0 ? (
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>No entries</AlertTitle>
                <AlertDescription>Decisions and rule changes will appear here.</AlertDescription>
              </Alert>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Context</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {(() => { try { return format(parseISO(r.created_at), "d MMM, HH:mm"); } catch { return r.created_at; } })()}
                        </TableCell>
                        <TableCell className="text-sm">{r.actor_name || r.actor_id || "—"}</TableCell>
                        <TableCell><Badge className={actionBadge(r.action)}>{ACTION_LABEL[r.action] || r.action}</Badge></TableCell>
                        <TableCell className="text-sm">{r.employee_name || r.employee_id || (r.rule_id ?? "—")}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {[r.target_date, r.shift, r.rule_id].filter(Boolean).join(" · ") || "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.reason || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
