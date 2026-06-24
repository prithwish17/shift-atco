// Data Access Layer — Editable compliance rule registry.
// Degrades gracefully if the table hasn't been migrated yet (falls back to the
// hardcoded TS registry via the resolver in src/lib/compliance/registry.ts).
import { supabase } from "@/integrations/supabase/client";
import type { Domain, Tier } from "@/lib/compliance/types";

export interface ComplianceRuleRow {
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
  sort_order: number;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

/** Fields a supervisor can change. For locked rules the UI restricts this to `description`. */
export type RuleEditableFields = Partial<
  Pick<
    ComplianceRuleRow,
    "title" | "description" | "domain" | "tier" | "blocking" | "params" | "regulatory_ref" | "enabled"
  >
>;

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

export class ComplianceRulesNotProvisioned extends Error {
  constructor() {
    super("Compliance rules table is not provisioned. Apply the 20260621_compliance_rules.sql migration.");
    this.name = "ComplianceRulesNotProvisioned";
  }
}

export async function listRules(): Promise<{ rows: ComplianceRuleRow[]; provisioned: boolean }> {
  const { data, error } = await supabase
    .from("compliance_rules" as any)
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { rows: [], provisioned: false };
    throw error;
  }
  return { rows: (data || []) as unknown as ComplianceRuleRow[], provisioned: true };
}

export async function updateRule(
  id: string,
  fields: RuleEditableFields,
  updatedBy: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("compliance_rules" as any)
    .update({ ...fields, updated_by: updatedBy, updated_at: new Date().toISOString() } as any)
    .eq("id", id);
  if (error) {
    if (isMissingTable(error)) throw new ComplianceRulesNotProvisioned();
    throw error;
  }
}
