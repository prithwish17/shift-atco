import { useEffect } from "react";

import { setRegistry } from "@/lib/compliance/registry";
import { useRules } from "@/hooks/useComplianceRules";
import type { RuleMeta } from "@/lib/compliance/types";

/**
 * Loads the editable rule registry from the DB and hydrates the live engine
 * registry, so in-app edits to rule content/thresholds affect evaluation.
 * Falls back to the hardcoded TS RULES when the table isn't provisioned.
 * Returns a token that changes when the registry changes (use it in memo deps).
 */
export function useApplyRuleRegistry(): number {
  const { data } = useRules();
  const rows = data?.rows ?? [];

  useEffect(() => {
    const metas: RuleMeta[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      domain: r.domain,
      tier: r.tier,
      blocking: r.blocking,
      params: r.params ?? undefined,
      regulatoryRef: r.regulatory_ref ?? undefined,
    }));
    setRegistry(metas);
  }, [rows]);

  // Token: count + most recent update → changes when the registry changes.
  if (rows.length === 0) return 0;
  const latest = rows.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), "");
  return rows.length + Date.parse(latest || "") / 1e10;
}
