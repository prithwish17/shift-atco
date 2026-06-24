import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listRules,
  updateRule,
  type ComplianceRuleRow,
  type RuleEditableFields,
} from "@/data-access/compliance-rules.repository";

export function useRules() {
  return useQuery({
    queryKey: ["compliance-rules"],
    queryFn: () => listRules(),
    staleTime: 60_000,
  });
}

export interface UpdateRuleInput {
  id: string;
  fields: RuleEditableFields;
  updatedBy: string | null;
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields, updatedBy }: UpdateRuleInput) => updateRule(id, fields, updatedBy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance-rules"] });
      qc.invalidateQueries({ queryKey: ["compliance-audit-log"] });
    },
  });
}

export type { ComplianceRuleRow };
