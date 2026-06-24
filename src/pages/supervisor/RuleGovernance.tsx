import { useMemo, useState } from "react";
import {
  AlertTriangle, BookLock, Check, Lock, Pencil, Search, ShieldCheck, CalendarClock, Info,
} from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { REGISTRY_VERSION, RULES } from "@/lib/compliance/registry";
import { TIER_WEIGHT, type Domain, type Tier } from "@/lib/compliance/types";
import { useCreateRuleOverride, useLogDecision, useRuleOverrides } from "@/hooks/useComplianceAudit";
import { useRules, useUpdateRule } from "@/hooks/useComplianceRules";
import type { ComplianceRuleRow, RuleEditableFields } from "@/data-access/compliance-rules.repository";
import type { RuleOverride } from "@/data-access/compliance-audit.repository";
import { cn } from "@/lib/utils";

// ── Plain-language vocabulary ────────────────────────────────────────────────
const TIER_LABEL: Record<Tier, string> = {
  T4: "Legal limit", T3: "Regulatory", T2: "Operational", T1: "Advisory", T0: "Preference",
};
const TIER_BLURB: Record<Tier, string> = {
  T4: "Hard legal limit. A breach blocks the assignment.",
  T3: "Strong regulatory rule. Usually blocks the assignment.",
  T2: "Operational rule — staffing levels and eligibility.",
  T1: "Advisory guidance (e.g. fatigue). Doesn't block, just warns.",
  T0: "Preference — used only to break ties when ranking options.",
};
const TIER_ORDER: Tier[] = ["T4", "T3", "T2", "T1", "T0"];
function tierClass(t: Tier) {
  return t === "T4" ? "bg-rose-600 text-white"
    : t === "T3" ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
    : t === "T2" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
    : t === "T1" ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
    : "bg-muted text-muted-foreground";
}

const DOMAIN_LABEL: Record<Domain, string> = {
  schedule: "Schedule", workingHours: "Working hours", availability: "Availability", exchange: "Exchange",
};

const PARAM_LABEL: Record<string, string> = {
  hours: "Hours", windowDays: "Window (days)", days: "Days", max: "Maximum",
  ma: "Min on shift", n: "Out of",
};

/** Turn machine params into a readable sentence fragment. */
function humanThreshold(params: Record<string, number> | null | undefined): string {
  if (!params || Object.keys(params).length === 0) return "No numeric threshold";
  if (params.hours != null && params.windowDays != null) return `${params.hours} hours per ${params.windowDays} days`;
  const parts: string[] = [];
  if (params.hours != null) parts.push(`${params.hours} hours`);
  if (params.days != null) parts.push(`${params.days} days`);
  if (params.max != null) parts.push(`max ${params.max}`);
  if (params.ma != null && params.n != null) parts.push(`at least ${params.ma} of ${params.n}`);
  // Any other custom keys
  Object.entries(params).forEach(([k, v]) => {
    if (!["hours", "windowDays", "days", "max", "ma", "n"].includes(k)) {
      parts.push(`${PARAM_LABEL[k] ?? k} ${v}`);
    }
  });
  return parts.join(", ") || "No numeric threshold";
}

// A unified view-model for a rule (from DB when provisioned, else code fallback).
interface RuleView {
  id: string;
  title: string;
  description: string | null;
  domain: Domain;
  tier: Tier;
  blocking: boolean;
  params: Record<string, number> | null;
  regulatory_ref: string | null;
  enabled: boolean;
  locked: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

function fallbackViews(): RuleView[] {
  return Object.values(RULES).map((r) => ({
    id: r.id, title: r.title, description: null, domain: r.domain, tier: r.tier,
    blocking: r.blocking, params: r.params ?? null, regulatory_ref: r.regulatoryRef ?? null,
    enabled: true, locked: r.tier === "T3" || r.tier === "T4", updated_by: null, updated_at: null,
  }));
}

function toView(r: ComplianceRuleRow): RuleView {
  return {
    id: r.id, title: r.title, description: r.description, domain: r.domain, tier: r.tier,
    blocking: r.blocking, params: r.params, regulatory_ref: r.regulatory_ref,
    enabled: r.enabled, locked: r.locked, updated_by: r.updated_by, updated_at: r.updated_at,
  };
}

type RuleStatus = "default" | "edited" | "exception" | "disabled";

export default function RuleGovernance() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: rulesData } = useRules();
  const { data: overrideData } = useRuleOverrides();
  const updateRule = useUpdateRule();
  const createOverride = useCreateRuleOverride();
  const logDecision = useLogDecision();

  const provisioned = rulesData?.provisioned ?? false;
  const rules: RuleView[] = useMemo(() => {
    const rows = rulesData?.rows ?? [];
    return rows.length ? rows.map(toView) : fallbackViews();
  }, [rulesData]);

  const overrides = overrideData?.rows ?? [];
  const latestByRule = useMemo(() => {
    const m = new Map<string, RuleOverride>();
    overrides.forEach((o) => { if (!m.has(o.rule_id)) m.set(o.rule_id, o); });
    return m;
  }, [overrides]);

  function statusOf(id: string, updatedBy: string | null): RuleStatus {
    const ov = latestByRule.get(id);
    if (ov) return ov.enabled ? "exception" : "disabled";
    return updatedBy ? "edited" : "default";
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rules.filter((r) => {
      if (tierFilter !== "all" && r.tier !== tierFilter) return false;
      if (statusFilter !== "all" && statusOf(r.id, r.updated_by) !== statusFilter) return false;
      if (!needle) return true;
      return (
        r.id.toLowerCase().includes(needle) ||
        r.title.toLowerCase().includes(needle) ||
        (r.description ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rules, q, tierFilter, statusFilter, latestByRule]);

  const grouped = useMemo(() => {
    const m = new Map<Tier, RuleView[]>();
    TIER_ORDER.forEach((t) => m.set(t, []));
    filtered.forEach((r) => m.get(r.tier)?.push(r));
    return m;
  }, [filtered]);

  const lastChanged = useMemo(() => {
    const edited = rules.filter((r) => r.updated_at).map((r) => r.updated_at as string).sort();
    return edited.length ? edited[edited.length - 1].slice(0, 10) : null;
  }, [rules]);

  // ── Edit dialog ──────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<RuleView | null>(null);

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BookLock className="h-6 w-6" /> Rule Governance
          </h1>
          <p className="text-muted-foreground">
            These are the rules the roster &amp; availability engine checks. You can edit what each
            rule means, and — for non-regulatory rules — adjust its thresholds. Every change is
            approval-gated and saved to the audit log.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Registry version {REGISTRY_VERSION}
            {lastChanged ? ` · last edited ${lastChanged}` : " · no in-app edits yet"}
          </p>
        </div>

        {!provisioned && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Editing is read-only until the registry table is provisioned</AlertTitle>
            <AlertDescription>
              Apply <code>supabase/migrations/20260621_compliance_rules.sql</code> to enable saving
              edits. Until then the built-in defaults are shown.
            </AlertDescription>
          </Alert>
        )}

        {/* Legend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4" /> How to read this page
            </CardTitle>
            <CardDescription>
              Rules are grouped by how strict they are. <strong>Edit</strong> changes a rule
              permanently; <strong>Add exception</strong> relaxes it temporarily (with dates).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TIER_ORDER.map((t) => (
              <div key={t} className="flex items-start gap-2 rounded-md border p-2">
                <Badge className={cn(tierClass(t), "mt-0.5 shrink-0")}>{TIER_LABEL[t]}</Badge>
                <span className="text-xs text-muted-foreground">{TIER_BLURB[t]}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search rules by name or description…"
              className="pl-8"
            />
          </div>
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="All tiers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              {TIER_ORDER.map((t) => <SelectItem key={t} value={t}>{TIER_LABEL[t]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="Any status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="edited">Edited</SelectItem>
              <SelectItem value="exception">Has exception</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Rule groups */}
        {TIER_ORDER.map((t) => {
          const list = grouped.get(t) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={t} className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className={cn(tierClass(t))}>{TIER_LABEL[t]}</Badge>
                <span className="text-sm text-muted-foreground">{TIER_BLURB[t]}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {list.map((r) => (
                  <RuleCard
                    key={r.id}
                    rule={r}
                    status={statusOf(r.id, r.updated_by)}
                    override={latestByRule.get(r.id)}
                    onEdit={() => setEditing(r)}
                    canEdit={provisioned}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {editing && (
          <EditRuleDialog
            rule={editing}
            open={!!editing}
            onClose={() => setEditing(null)}
            onSaveEdit={async (patch, reason, approver) => {
              const before: RuleEditableFields = {
                title: editing.title, description: editing.description ?? undefined,
                tier: editing.tier, blocking: editing.blocking, params: editing.params,
                enabled: editing.enabled,
              };
              await updateRule.mutateAsync({ id: editing.id, fields: patch, updatedBy: user?.email ?? null });
              await logDecision.mutateAsync({
                action: "rule_edited",
                actor_id: user?.id ?? null,
                actor_name: user?.email ?? null,
                rule_id: editing.id,
                reason: `${reason}${approver ? ` — approved by ${approver}` : ""}`,
                snapshot: { before, after: { ...before, ...patch }, approver: approver || null },
              });
              toast({ title: "Rule updated", description: editing.id });
              setEditing(null);
            }}
            onSaveException={async (input) => {
              const params = input.hours.trim() ? { hours: Number(input.hours) } : null;
              await createOverride.mutateAsync({
                rule_id: editing.id, enabled: input.enabled, params,
                reason: input.reason.trim(), approved_by: input.approvedBy.trim(),
                effective_from: input.from || null, effective_to: input.to || null,
                created_by: user?.email ?? null,
              });
              await logDecision.mutateAsync({
                action: "rule_override_set",
                actor_id: user?.id ?? null,
                actor_name: user?.email ?? null,
                rule_id: editing.id,
                reason: `${input.enabled ? "Enabled" : "Disabled"}${params ? ` · hours=${params.hours}` : ""} — ${input.reason.trim()}`,
                snapshot: { ruleId: editing.id, enabled: input.enabled, params, effective_from: input.from || null, effective_to: input.to || null },
              });
              toast({ title: "Exception recorded", description: `${editing.id} · approved by ${input.approvedBy}` });
              setEditing(null);
            }}
            saving={updateRule.isPending || createOverride.isPending}
            defaultApprover={user?.email ?? ""}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

// ── Rule card ────────────────────────────────────────────────────────────────
function statusBadge(status: RuleStatus, override?: RuleOverride) {
  switch (status) {
    case "disabled":
      return <Badge variant="outline" className="border-rose-400 text-rose-700 dark:text-rose-300">Disabled</Badge>;
    case "exception":
      return (
        <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
          Exception{override?.params?.hours != null ? ` · ${override.params.hours}h` : ""}
        </Badge>
      );
    case "edited":
      return <Badge variant="outline" className="border-sky-400 text-sky-700 dark:text-sky-300">Edited</Badge>;
    default:
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Default
        </span>
      );
  }
}

function RuleCard({
  rule, status, override, onEdit, canEdit,
}: {
  rule: RuleView; status: RuleStatus; override?: RuleOverride; onEdit: () => void; canEdit: boolean;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {rule.locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Regulatory — description-only" />}
              <span className="truncate">{rule.title}</span>
            </CardTitle>
            <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {rule.id}
            </code>
          </div>
          {statusBadge(status, override)}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        <p className="text-sm text-muted-foreground">
          {rule.description ?? <span className="italic">No description yet — add one to explain this rule.</span>}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Threshold</dt>
          <dd className="text-right font-medium">{humanThreshold(rule.params)}</dd>
          <dt className="text-muted-foreground">Area</dt>
          <dd className="text-right">{DOMAIN_LABEL[rule.domain]}</dd>
          <dt className="text-muted-foreground">Effect</dt>
          <dd className="text-right">{rule.blocking ? "Blocks assignment" : "Warning / ranking only"}</dd>
          <dt className="text-muted-foreground">Weight</dt>
          <dd className="text-right">±{TIER_WEIGHT[rule.tier]}</dd>
        </dl>
        {rule.regulatory_ref && (
          <p className="text-xs text-muted-foreground">Reference: {rule.regulatory_ref}</p>
        )}
        {override && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            <CalendarClock className="mr-1 inline h-3 w-3" />
            {override.enabled ? "Exception" : "Disabled"} by {override.approved_by}
            {override.effective_from ? ` · from ${override.effective_from}` : ""}
            {override.effective_to ? ` to ${override.effective_to}` : ""}
          </p>
        )}
        <div className="mt-auto pt-1">
          <Button size="sm" variant="outline" onClick={onEdit} disabled={!canEdit}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit / add exception
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Edit dialog ──────────────────────────────────────────────────────────────
interface ExceptionInput {
  enabled: boolean; hours: string; reason: string; approvedBy: string; from: string; to: string;
}

function EditRuleDialog({
  rule, open, onClose, onSaveEdit, onSaveException, saving, defaultApprover,
}: {
  rule: RuleView;
  open: boolean;
  onClose: () => void;
  onSaveEdit: (patch: RuleEditableFields, reason: string, approver: string) => Promise<void>;
  onSaveException: (input: ExceptionInput) => Promise<void>;
  saving: boolean;
  defaultApprover: string;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"edit" | "exception">("edit");

  // Edit form
  const [title, setTitle] = useState(rule.title);
  const [description, setDescription] = useState(rule.description ?? "");
  const [enabled, setEnabled] = useState(rule.enabled);
  const [blocking, setBlocking] = useState(rule.blocking);
  const [params, setParams] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(rule.params ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState(defaultApprover);

  // Exception form
  const [ex, setEx] = useState<ExceptionInput>({
    enabled: true, hours: "", reason: "", approvedBy: defaultApprover, from: "", to: "",
  });

  const paramKeys = Object.keys(rule.params ?? {});

  const buildPatch = (): { patch: RuleEditableFields; changedGoverned: boolean } => {
    const patch: RuleEditableFields = {};
    let changedGoverned = false;
    if (description !== (rule.description ?? "")) patch.description = description;
    if (!rule.locked) {
      if (title !== rule.title) { patch.title = title; changedGoverned = true; }
      if (enabled !== rule.enabled) { patch.enabled = enabled; changedGoverned = true; }
      if (blocking !== rule.blocking) { patch.blocking = blocking; changedGoverned = true; }
      const nextParams: Record<string, number> = {};
      paramKeys.forEach((k) => { nextParams[k] = Number(params[k]); });
      if (JSON.stringify(nextParams) !== JSON.stringify(rule.params ?? {})) {
        patch.params = nextParams; changedGoverned = true;
      }
    }
    return { patch, changedGoverned };
  };

  const submitEdit = async () => {
    const { patch, changedGoverned } = buildPatch();
    if (Object.keys(patch).length === 0) {
      toast({ title: "Nothing changed", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "A reason is required for the audit log", variant: "destructive" });
      return;
    }
    if (changedGoverned && !approver.trim()) {
      toast({ title: "An approver is required to change thresholds or status", variant: "destructive" });
      return;
    }
    if (paramKeys.some((k) => params[k] !== "" && Number.isNaN(Number(params[k])))) {
      toast({ title: "Thresholds must be numbers", variant: "destructive" });
      return;
    }
    await onSaveEdit(patch, reason.trim(), changedGoverned ? approver.trim() : "");
  };

  const submitException = async () => {
    if (!ex.reason.trim() || !ex.approvedBy.trim()) {
      toast({ title: "Reason and approver are required", variant: "destructive" });
      return;
    }
    await onSaveException(ex);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {rule.locked && <Lock className="h-4 w-4 text-muted-foreground" />}
            {rule.title}
          </DialogTitle>
          <DialogDescription>
            <code className="text-xs">{rule.id}</code> · {TIER_LABEL[rule.tier]}
            {rule.regulatory_ref ? ` · ${rule.regulatory_ref}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Tab switch */}
        <div className="flex gap-2">
          <Button size="sm" variant={tab === "edit" ? "default" : "outline"} onClick={() => setTab("edit")}>
            Edit definition
          </Button>
          <Button size="sm" variant={tab === "exception" ? "default" : "outline"} onClick={() => setTab("exception")}>
            Add temporary exception
          </Button>
        </div>

        {tab === "edit" ? (
          <div className="space-y-4">
            {rule.locked && (
              <Alert>
                <Lock className="h-4 w-4" />
                <AlertTitle>Regulatory rule — limits are protected</AlertTitle>
                <AlertDescription>
                  You can edit the plain-language description. To change its threshold temporarily,
                  use <strong>Add temporary exception</strong> (effective-dated &amp; approved).
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={rule.locked} />
            </div>

            <div className="space-y-2">
              <Label>Plain-language description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Explain what this rule means in everyday language."
                rows={3}
              />
            </div>

            {!rule.locked && (
              <>
                {paramKeys.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {paramKeys.map((k) => (
                      <div key={k} className="space-y-2">
                        <Label>{PARAM_LABEL[k] ?? k}</Label>
                        <Input
                          type="number"
                          value={params[k]}
                          onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch checked={enabled} onCheckedChange={setEnabled} id="enabled" />
                    <Label htmlFor="enabled">{enabled ? "Active" : "Disabled"}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={blocking} onCheckedChange={setBlocking} id="blocking" />
                    <Label htmlFor="blocking">{blocking ? "Blocks assignment" : "Warning only"}</Label>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label>Reason (for the audit log)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you making this change?" />
            </div>
            {!rule.locked && (
              <div className="space-y-2">
                <Label>Approved by <span className="text-xs text-muted-foreground">(required for threshold / status changes)</span></Label>
                <Input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="ATS-in-charge" />
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submitEdit} disabled={saving}>
                <Check className="mr-2 h-4 w-4" /> Save changes
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A temporary, effective-dated exception (e.g. the §7.1.3 SRA case — reduce to 36h with an
              approved SRA). It does not change the rule's default.
            </p>
            <div className="flex items-center gap-3">
              <Switch checked={ex.enabled} onCheckedChange={(v) => setEx((s) => ({ ...s, enabled: v }))} id="ex-enabled" />
              <Label htmlFor="ex-enabled">{ex.enabled ? "Rule stays on (threshold override)" : "Rule turned off"}</Label>
            </div>
            <div className="space-y-2">
              <Label>Threshold override — hours (optional)</Label>
              <Input type="number" value={ex.hours} onChange={(e) => setEx((s) => ({ ...s, hours: e.target.value }))} placeholder="e.g. 36" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Effective from</Label>
                <Input type="date" value={ex.from} onChange={(e) => setEx((s) => ({ ...s, from: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Effective to</Label>
                <Input type="date" value={ex.to} onChange={(e) => setEx((s) => ({ ...s, to: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Approved by</Label>
              <Input value={ex.approvedBy} onChange={(e) => setEx((s) => ({ ...s, approvedBy: e.target.value }))} placeholder="ATS-in-charge" />
            </div>
            <div className="space-y-2">
              <Label>Reason / SRA reference</Label>
              <Input value={ex.reason} onChange={(e) => setEx((s) => ({ ...s, reason: e.target.value }))} placeholder="Justification for this exception" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submitException} disabled={saving}>
                <Check className="mr-2 h-4 w-4" /> Record exception
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
