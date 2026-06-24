import { useEffect } from "react";

import { setActiveOverrides } from "@/lib/compliance/registry";
import { useRuleOverrides } from "@/hooks/useComplianceAudit";

/**
 * Loads governed rule overrides and applies them to the live engine registry,
 * so enable/disable and threshold overrides actually affect evaluation.
 * Returns a token that changes when overrides change (use it in memo deps).
 */
export function useApplyRuleOverrides(): number {
  const { data } = useRuleOverrides();
  const rows = data?.rows ?? [];

  useEffect(() => {
    setActiveOverrides(
      rows.map((o) => ({
        rule_id: o.rule_id,
        enabled: o.enabled,
        params: o.params,
        effective_from: o.effective_from,
        effective_to: o.effective_to,
      })),
    );
  }, [rows]);

  // Token: count + most recent timestamp → changes when the override set changes.
  return rows.length === 0 ? 0 : rows.length + Date.parse(rows[0].created_at || "") / 1e10;
}
