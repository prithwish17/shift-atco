-- ─────────────────────────────────────────────────────────────────────────────
-- Compliance Audit & Rule Governance — June 16, 2026
--
-- Adds the enterprise audit trail and rule-governance tables for the
-- compliance/availability engine (P5):
--   1. compliance_audit_log     — every decision / override / acknowledgement
--   2. compliance_rule_overrides — governed, effective-dated rule overrides
--
-- Records are retained for DGCA oversight (CAR §5.3 / §9 — keep 24 months).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Audit log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compliance_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL,              -- accept_suggestion | reject_suggestion | override_block | acknowledge_breach | rule_override_set
  actor_id      text,
  actor_name    text,
  target_date   date,
  shift         text,
  rating        text,
  employee_id   text,                       -- subject (candidate) employee code
  employee_name text,
  rule_id       text,                       -- related rule, if any
  score         integer,
  reason        text,
  snapshot      jsonb,                      -- full ledger / context at decision time
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.compliance_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action     ON public.compliance_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_target_date ON public.compliance_audit_log (target_date);

-- ── 2. Rule overrides (governance) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compliance_rule_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id        text NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,   -- false = rule temporarily disabled
  params         jsonb,                           -- threshold overrides, e.g. {"hours": 36}
  reason         text NOT NULL,
  approved_by    text NOT NULL,
  approved_at    timestamptz NOT NULL DEFAULT now(),
  effective_from date,
  effective_to   date,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overrides_rule ON public.compliance_rule_overrides (rule_id);
CREATE INDEX IF NOT EXISTS idx_overrides_effective ON public.compliance_rule_overrides (effective_from, effective_to);

-- ── 3. Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE public.compliance_audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_rule_overrides ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read the audit log and insert decisions; the audit
-- log is append-only (no update/delete) so the trail cannot be tampered with.
DROP POLICY IF EXISTS audit_select ON public.compliance_audit_log;
CREATE POLICY audit_select ON public.compliance_audit_log
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS audit_insert ON public.compliance_audit_log;
CREATE POLICY audit_insert ON public.compliance_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- Rule overrides: authenticated may read; insert/update governed by app role.
DROP POLICY IF EXISTS overrides_select ON public.compliance_rule_overrides;
CREATE POLICY overrides_select ON public.compliance_rule_overrides
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS overrides_insert ON public.compliance_rule_overrides;
CREATE POLICY overrides_insert ON public.compliance_rule_overrides
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS overrides_update ON public.compliance_rule_overrides;
CREATE POLICY overrides_update ON public.compliance_rule_overrides
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
