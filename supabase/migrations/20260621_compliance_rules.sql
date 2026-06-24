-- ─────────────────────────────────────────────────────────────────────────────
-- Compliance Rule Registry (editable) — June 21, 2026
--
-- Promotes the compliance rule registry from hardcoded TypeScript
-- (src/lib/compliance/registry.ts) to a governed, editable DB table so
-- supervisors can maintain rule content in-app. See RULE_GOVERNANCE_REDESIGN_ADR.md.
--
-- Governance model:
--   • The TS `RULES` object remains the canonical seed + offline fallback.
--   • T3/T4 (regulatory) rules are `locked`: only their plain-language
--     `description` is editable. Their legal thresholds change only through the
--     effective-dated, approved compliance_rule_overrides path.
--   • Every edit is recorded in compliance_audit_log (action='rule_edited').
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.compliance_rules (
  id              text PRIMARY KEY,            -- rule code, e.g. 'WDTL.7D'
  title           text NOT NULL,              -- short label
  description     text,                        -- plain-language explanation (editable on all rules)
  domain          text NOT NULL,              -- schedule | workingHours | availability | exchange
  tier            text NOT NULL,              -- T0..T4
  blocking        boolean NOT NULL DEFAULT false,
  params          jsonb,                       -- thresholds, e.g. {"hours":48,"windowDays":7}
  regulatory_ref  text,
  enabled         boolean NOT NULL DEFAULT true,
  locked          boolean NOT NULL DEFAULT false, -- regulatory limit: description-only edits
  sort_order      integer NOT NULL DEFAULT 0,
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rules_tier   ON public.compliance_rules (tier);
CREATE INDEX IF NOT EXISTS idx_rules_domain ON public.compliance_rules (domain);

-- ── Row Level Security (mirrors compliance_rule_overrides) ────────────────────
ALTER TABLE public.compliance_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rules_select ON public.compliance_rules;
CREATE POLICY rules_select ON public.compliance_rules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rules_insert ON public.compliance_rules;
CREATE POLICY rules_insert ON public.compliance_rules
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS rules_update ON public.compliance_rules;
CREATE POLICY rules_update ON public.compliance_rules
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── Seed from the canonical TS registry (ON CONFLICT DO NOTHING keeps edits) ───
-- locked = true for regulatory tiers (T3, T4).
INSERT INTO public.compliance_rules
  (id, title, description, domain, tier, blocking, params, regulatory_ref, locked, sort_order)
VALUES
  -- ── Regulatory-hard (T4) ──
  ('WDTL.DUTY12', 'Single duty ≤ 12h',
   'A single duty period may not exceed 12 hours.',
   'workingHours', 'T4', true, '{"hours":12}', 'DGCA CAR §7.1.1(a)', true, 10),
  ('WDTL.7D', '7-day cumulative ≤ 48h',
   'Total duty hours may not exceed 48 hours in any rolling 7-day window.',
   'workingHours', 'T4', true, '{"hours":48,"windowDays":7}', 'DGCA CAR §7.1.1(b)', true, 11),
  ('WDTL.30D', '30-day cumulative ≤ 190h',
   'Total duty hours may not exceed 190 hours in any rolling 30-day window.',
   'workingHours', 'T4', true, '{"hours":190,"windowDays":30}', 'DGCA CAR §7.1.1(b)', true, 12),
  ('WDTL.NIGHT2', '≤ 2 consecutive nights',
   'A controller may work at most 2 night duties in a row.',
   'schedule', 'T4', true, '{"max":2}', 'DGCA CAR §7.3.1(b)', true, 13),
  ('WDTL.RESTN1', '≥ 48h rest after 1 night',
   'At least 48 hours of rest must follow a single night duty.',
   'schedule', 'T4', true, '{"hours":48}', 'DGCA CAR §7.3.2(a)', true, 14),
  ('WDTL.RESTN2', '≥ 54h rest after 2 nights',
   'At least 54 hours of rest must follow two consecutive night duties.',
   'schedule', 'T4', true, '{"hours":54}', 'DGCA CAR §7.3.2(b)', true, 15),

  -- ── Regulatory-soft (T3) ──
  ('WDTL.INTERVAL12', '≥ 12h between duties',
   'At least 12 hours must separate the end of one duty and the start of the next.',
   'schedule', 'T3', true, '{"hours":12}', 'DGCA CAR §7.1.2', true, 20),
  ('WDTL.CONSEC6', '≤ 6 consecutive duty days',
   'A controller may work at most 6 consecutive duty days.',
   'workingHours', 'T3', true, '{"days":6}', 'DGCA CAR §7.1.3(a)', true, 21),
  ('WDTL.POSTSTREAK48', '≥ 48h after a duty block',
   'At least 48 hours of rest should follow a block of consecutive duties.',
   'workingHours', 'T3', false, '{"hours":48}', 'DGCA CAR §7.1.3(b)', true, 22),

  -- ── Operational (T2) ──
  ('OPS.ONEDUTY', 'One duty per day',
   'Only one duty may be assigned to a controller per day.',
   'schedule', 'T2', true, NULL, 'Ops', false, 30),
  ('OPS.ELIG', 'Holds required rating/group',
   'The controller must hold the rating or group required for the duty.',
   'exchange', 'T2', true, NULL, 'Ops', false, 31),
  ('COVER.GROUPMIN', 'Group ≥ shift minimum',
   'Each group must keep at least its minimum staffing for the shift.',
   'availability', 'T2', true, NULL, 'Ops (availability chart)', false, 32),
  ('COVER.OCCMIN', 'OCC sub-minimum',
   'OCC must keep its sub-minimum staffing (at least 4 of 7 on shift).',
   'availability', 'T2', true, '{"ma":4,"n":7}', 'Ops (availability chart)', false, 33),
  ('COVER.SOURCE', 'Source shift stays ≥ group minimum',
   'After a move, the source shift must remain at or above its group minimum.',
   'availability', 'T2', true, NULL, 'Ops (availability chart)', false, 34),

  -- ── Advisory (T1) ──
  ('FATIGUE.2NDNIGHT', '2nd consecutive night',
   'Advisory: working a 2nd consecutive night raises fatigue risk.',
   'schedule', 'T1', false, NULL, 'DGCA CAR §7.3.1 note', false, 40),
  ('FATIGUE.PREVDAY', 'Rested previous day',
   'Advisory: prefer controllers who were rested the previous day.',
   'schedule', 'T1', false, NULL, 'Guidance', false, 41),

  -- ── Preference (T0) ──
  ('PREF.SHIFT_FIT', 'Best-fit source shift',
   'Preference: pick the best-fit source shift (N←Night-off, M←Afternoon, A←Morning).',
   'exchange', 'T0', false, NULL, 'Local preference', false, 50),
  ('PREF.GENERAL', 'General shift (flexible)',
   'Preference: a general shift is flexible and does not deplete a specific shift pool.',
   'exchange', 'T0', false, NULL, 'Local preference', false, 51),
  ('PREF.FAIR_EXCHANGE', 'Fewer prior exchanges preferred',
   'Fairness: prefer controllers with fewer prior exchanges.',
   'exchange', 'T0', false, NULL, 'Fairness / load-balancing', false, 52),
  ('PREF.FAIR_OPE', 'Fewer prior OPE duties preferred',
   'Fairness: prefer controllers with fewer prior OPE duties.',
   'exchange', 'T0', false, NULL, 'Fairness / load-balancing', false, 53),
  ('PREF.MULTIRATING', 'Multi-rated flexibility',
   'Preference: multi-rated controllers offer more scheduling flexibility.',
   'exchange', 'T0', false, NULL, 'Local preference', false, 54),
  ('PREF.CALLIN', 'Call-in from rest',
   'Preference: a call-in from rest needs no swap.',
   'exchange', 'T0', false, NULL, 'Local preference', false, 55),
  ('PREF.CLEAROFF', 'Clear-off lowest priority',
   'Preference: clear-off is the lowest-priority option.',
   'exchange', 'T0', false, NULL, 'Local preference', false, 56)
ON CONFLICT (id) DO NOTHING;
