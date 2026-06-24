import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createRuleOverride,
  listAuditLog,
  listRuleOverrides,
  logDecision,
  type AuditLogInsert,
  type RuleOverrideInsert,
} from "@/data-access/compliance-audit.repository";

export function useAuditLog(limit = 500) {
  return useQuery({
    queryKey: ["compliance-audit-log", limit],
    queryFn: () => listAuditLog(limit),
    staleTime: 30_000,
  });
}

export function useRuleOverrides() {
  return useQuery({
    queryKey: ["compliance-rule-overrides"],
    queryFn: () => listRuleOverrides(),
    staleTime: 60_000,
  });
}

export function useLogDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: Partial<AuditLogInsert> & { action: string }) => logDecision(entry),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance-audit-log"] }),
  });
}

export function useCreateRuleOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RuleOverrideInsert) => createRuleOverride(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance-rule-overrides"] });
      qc.invalidateQueries({ queryKey: ["compliance-audit-log"] });
    },
  });
}
