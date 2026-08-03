/**
 * compliance/registry.ts
 * The single, versioned source of truth for all rules and thresholds.
 * Thresholds live here (config-driven) — never hard-coded in components.
 *
 * NOTE: the 15-day cumulative limit is intentionally absent (removed).
 * Only the DGCA 7-day (48h) and 30-day (190h) caps apply.
 */
import type { RuleExemption, RuleMeta, Tier } from "./types";
import { TIER_WEIGHT } from "./types";

export const REGISTRY_VERSION = "2026-08-03";

/**
 * Standing exemption from CAR Para 7.1.3 ("Limit on and interval following
 * consecutive duty periods"), covering BOTH sub-paragraphs:
 *   7.1.3(a) — no more than 6 consecutive duty days   → WDTL.CONSEC6
 *   7.1.3(b) — ≥48h interval between duty blocks      → WDTL.POSTSTREAK48
 *
 * Source: AAI NSCBI Kolkata Office Order AAI/GM/ATM/ADMN/Ops/251024/88 (24.10.2025),
 * which withdrew DGCA's temporary exemptions on other paras w.e.f. 0001 hrs
 * 31.10.2025 but records that the Para 7.1.3 exemption stands, granted by
 * ED (Aviation Safety).
 *
 * NOTE: the order states no expiry. `to` is therefore left open, and the exemption
 * should be re-confirmed rather than assumed indefinite.
 */
export const PARA_713_EXEMPTION: RuleExemption = {
  authority: "ED (Aviation Safety)",
  reference: "AAI Office Order AAI/GM/ATM/ADMN/Ops/251024/88 dated 24.10.2025",
  from: "2025-10-24",
  note: "CAR Para 7.1.3 exemption in force — reported for visibility, not enforced",
};

export const RULES: Record<string, RuleMeta> = {
  // ── Regulatory-hard (T4) ────────────────────────────────────────────────
  "WDTL.DUTY12": {
    id: "WDTL.DUTY12", title: "Single duty ≤ 12h", domain: "workingHours",
    tier: "T4", blocking: true, params: { hours: 12 }, regulatoryRef: "DGCA CAR §7.1.1(a)",
  },
  "WDTL.7D": {
    id: "WDTL.7D", title: "7-day cumulative ≤ 48h", domain: "workingHours",
    tier: "T4", blocking: true, params: { hours: 48, windowDays: 7 }, regulatoryRef: "DGCA CAR §7.1.1(b)",
  },
  "WDTL.30D": {
    id: "WDTL.30D", title: "30-day cumulative ≤ 190h", domain: "workingHours",
    tier: "T4", blocking: true, params: { hours: 190, windowDays: 30 }, regulatoryRef: "DGCA CAR §7.1.1(b)",
  },
  "WDTL.NIGHT2": {
    id: "WDTL.NIGHT2", title: "≤ 2 consecutive nights", domain: "schedule",
    tier: "T4", blocking: true, params: { max: 2 }, regulatoryRef: "DGCA CAR §7.3.1(b)",
  },
  "WDTL.RESTN1": {
    id: "WDTL.RESTN1", title: "≥ 48h rest after 1 night", domain: "schedule",
    tier: "T4", blocking: true, params: { hours: 48 }, regulatoryRef: "DGCA CAR §7.3.2(a)",
  },
  "WDTL.RESTN2": {
    id: "WDTL.RESTN2", title: "≥ 54h rest after 2 nights", domain: "schedule",
    tier: "T4", blocking: true, params: { hours: 54 }, regulatoryRef: "DGCA CAR §7.3.2(b)",
  },

  // ── Regulatory-soft (T3) ────────────────────────────────────────────────
  "WDTL.INTERVAL12": {
    id: "WDTL.INTERVAL12", title: "≥ 12h between duties", domain: "schedule",
    tier: "T3", blocking: true, params: { hours: 12 }, regulatoryRef: "DGCA CAR §7.1.2",
  },
  // Both §7.1.3 rules carry a standing exemption — see PARA_713_EXEMPTION below.
  // They are still evaluated and reported, but never enforced while it is in force.
  "WDTL.CONSEC6": {
    id: "WDTL.CONSEC6", title: "≤ 6 consecutive duty days", domain: "workingHours",
    tier: "T3", blocking: true, params: { days: 6 }, regulatoryRef: "DGCA CAR §7.1.3(a)",
    exemption: PARA_713_EXEMPTION,
  },
  "WDTL.POSTSTREAK48": {
    id: "WDTL.POSTSTREAK48", title: "≥ 48h after a duty block", domain: "workingHours",
    tier: "T3", blocking: false, params: { hours: 48 }, regulatoryRef: "DGCA CAR §7.1.3(b)",
    exemption: PARA_713_EXEMPTION,
  },

  // ── Operational (T2) ────────────────────────────────────────────────────
  "OPS.ONEDUTY": {
    id: "OPS.ONEDUTY", title: "One duty per day", domain: "schedule",
    tier: "T2", blocking: true, regulatoryRef: "Ops",
  },
  "OPS.ELIG": {
    id: "OPS.ELIG", title: "Holds a similar rating", domain: "exchange",
    tier: "T2", blocking: true,
    regulatoryRef: "Office Order 251024/88 §2 — exchange only with an ATCO holding a similar rating",
  },
  "OPS.NOTICE7": {
    id: "OPS.NOTICE7",
    title: "7-day objection window",
    domain: "exchange",
    tier: "T1",
    blocking: false,
    params: { days: 7 },
    regulatoryRef:
      "Office Order 251024/88 §1 — an ATCO must give ≥7 days notice to decline a duty change or extra duty",
  },
  "COVER.GROUPMIN": {
    id: "COVER.GROUPMIN", title: "Group ≥ shift minimum", domain: "availability",
    tier: "T2", blocking: true, regulatoryRef: "Ops (availability chart)",
  },
  "COVER.OCCMIN": {
    id: "COVER.OCCMIN", title: "OCC sub-minimum", domain: "availability",
    tier: "T2", blocking: true, params: { ma: 4, n: 7 }, regulatoryRef: "Ops (availability chart)",
  },

  // ── Advisory (T1) ───────────────────────────────────────────────────────
  "FATIGUE.2NDNIGHT": {
    id: "FATIGUE.2NDNIGHT", title: "2nd consecutive night", domain: "schedule",
    tier: "T1", blocking: false, regulatoryRef: "DGCA CAR §7.3.1 note",
  },
  "FATIGUE.PREVDAY": {
    id: "FATIGUE.PREVDAY", title: "Rested previous day", domain: "schedule",
    tier: "T1", blocking: false, regulatoryRef: "Guidance",
  },

  // ── Preference (T0) ─────────────────────────────────────────────────────
  //
  // Strategy preference (Night-off before Afternoon before General, clear-off last)
  // is NOT scored here — it is the ladder rung in ladder.ts. The former
  // PREF.SHIFT_FIT / PREF.GENERAL / PREF.CALLIN / PREF.CLEAROFF rules encoded it as
  // ±10 points that an unbounded fairness penalty could outvote, which let a
  // controller's exchange history decide which strategy won. Rung and fairness are
  // now separate comparator steps and neither can compensate for the other.
  "PREF.MULTIRATING": {
    id: "PREF.MULTIRATING", title: "Multi-rated flexibility", domain: "exchange",
    tier: "T0", blocking: false, regulatoryRef: "Local preference",
  },
  "PREF.FAIRNESS": {
    id: "PREF.FAIRNESS", title: "Duty-change load (rotation)", domain: "exchange",
    tier: "T0", blocking: false,
    params: { exchangeWeight: 1, opeWeight: 1, nightBreakWeight: 1, monthMultiplier: 2 },
    regulatoryRef: "Fairness / load-balancing — ranks via its own comparator step, contributes 0 points",
  },
  "COVER.SOURCE": {
    id: "COVER.SOURCE", title: "Source shift stays ≥ group minimum", domain: "availability",
    tier: "T2", blocking: true, regulatoryRef: "Ops (availability chart)",
  },
};

// ── Resolved registry (DB-backed when hydrated, code RULES as seed/fallback) ──
// The hardcoded RULES above remain the canonical baseline and offline fallback.
// useApplyRuleRegistry() hydrates this from the compliance_rules table on load.
let RESOLVED: Record<string, RuleMeta> = { ...RULES };

/** Hydrate the resolved registry from the DB. Empty input → fall back to code RULES. */
export function setRegistry(rows: RuleMeta[]): void {
  RESOLVED = rows.length ? Object.fromEntries(rows.map((r) => [r.id, r])) : { ...RULES };
}

/** Resolved metadata for a rule (DB override of the seed when hydrated). */
export function getRuleMeta(id: string): RuleMeta | undefined {
  return RESOLVED[id];
}

/** The full resolved registry (use this instead of RULES in UI/iteration). */
export function getRules(): Record<string, RuleMeta> {
  return RESOLVED;
}

export function ruleWeight(id: string): number {
  const meta = RESOLVED[id];
  return meta ? TIER_WEIGHT[meta.tier] : 0;
}

export function ruleTier(id: string): Tier {
  return RESOLVED[id]?.tier ?? "T0";
}

// ── Runtime governed overrides (applied to live evaluation) ─────────────────
export interface ActiveOverride {
  rule_id: string;
  enabled: boolean;
  params: Record<string, number> | null;
  effective_from: string | null;
  effective_to: string | null;
}

let ACTIVE_OVERRIDES: Map<string, ActiveOverride[]> = new Map();

/** Load governed overrides (newest-first per rule) so evaluation honours them. */
export function setActiveOverrides(rows: ActiveOverride[]): void {
  const m = new Map<string, ActiveOverride[]>();
  rows.forEach((r) => {
    const list = m.get(r.rule_id) ?? [];
    list.push(r);
    m.set(r.rule_id, list);
  });
  ACTIVE_OVERRIDES = m;
}

function activeFor(id: string, asOf?: string): ActiveOverride | null {
  const list = ACTIVE_OVERRIDES.get(id);
  if (!list || list.length === 0) return null;
  const d = asOf ?? new Date().toISOString().slice(0, 10);
  const applicable = list.filter(
    (o) => (!o.effective_from || o.effective_from <= d) && (!o.effective_to || d <= o.effective_to),
  );
  return applicable[0] ?? null; // rows arrive newest-first
}

/** Is a rule active on a given date (false when a governed override disables it)? */
export function isRuleEnabled(id: string, asOf?: string): boolean {
  const o = activeFor(id, asOf);
  return o ? o.enabled : true;
}

/**
 * The exemption in force for a rule on a given date, if any.
 * An exempted rule still evaluates and still reports — it just cannot block.
 */
export function activeExemption(id: string, asOf?: string): RuleExemption | null {
  const exemption = RESOLVED[id]?.exemption;
  if (!exemption) return null;

  const d = asOf ?? new Date().toISOString().slice(0, 10);
  if (exemption.from && d < exemption.from) return null;
  if (exemption.to && d > exemption.to) return null;
  return exemption;
}

/** Effective params for a rule on a given date (base params merged with override). */
export function effectiveParams(id: string, asOf?: string): Record<string, number> {
  const base = RESOLVED[id]?.params ?? {};
  const o = activeFor(id, asOf);
  return o?.params ? { ...base, ...o.params } : { ...base };
}
