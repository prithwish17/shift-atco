// Data Access Layer — Compliance audit log & rule overrides (P5).
// Degrades gracefully if the tables haven't been migrated yet.
import { supabase } from "@/integrations/supabase/client";

export interface AuditLogEntry {
  id: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  target_date: string | null;
  shift: string | null;
  rating: string | null;
  employee_id: string | null;
  employee_name: string | null;
  rule_id: string | null;
  score: number | null;
  reason: string | null;
  snapshot: unknown;
  created_at: string;
}

export type AuditLogInsert = Omit<AuditLogEntry, "id" | "created_at">;

export interface RuleOverride {
  id: string;
  rule_id: string;
  enabled: boolean;
  params: Record<string, number> | null;
  reason: string;
  approved_by: string;
  approved_at: string;
  effective_from: string | null;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
}

export type RuleOverrideInsert = Omit<RuleOverride, "id" | "approved_at" | "created_at">;

/** True when the error means the table isn't provisioned yet. */
function isMissingTable(error: { code?: string | null; message?: string | null } | null) {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    String(error.message || "").toLowerCase().includes("does not exist") ||
    String(error.message || "").toLowerCase().includes("could not find the table")
  );
}

export class ComplianceAuditNotProvisioned extends Error {
  constructor() {
    super("Compliance audit tables are not provisioned. Apply the 20260616_compliance_audit.sql migration.");
    this.name = "ComplianceAuditNotProvisioned";
  }
}

export async function logDecision(entry: Partial<AuditLogInsert> & { action: string }): Promise<void> {
  const { error } = await supabase.from("compliance_audit_log" as any).insert(entry as any);
  if (error && !isMissingTable(error)) throw error;
}

export async function listAuditLog(limit = 500): Promise<{ rows: AuditLogEntry[]; provisioned: boolean }> {
  const { data, error } = await supabase
    .from("compliance_audit_log" as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error)) return { rows: [], provisioned: false };
    throw error;
  }
  return { rows: (data || []) as unknown as AuditLogEntry[], provisioned: true };
}

export async function listRuleOverrides(): Promise<{ rows: RuleOverride[]; provisioned: boolean }> {
  const { data, error } = await supabase
    .from("compliance_rule_overrides" as any)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { rows: [], provisioned: false };
    throw error;
  }
  return { rows: (data || []) as unknown as RuleOverride[], provisioned: true };
}

export async function createRuleOverride(input: RuleOverrideInsert): Promise<void> {
  const { error } = await supabase.from("compliance_rule_overrides" as any).insert(input as any);
  if (error) {
    if (isMissingTable(error)) throw new ComplianceAuditNotProvisioned();
    throw error;
  }
}
