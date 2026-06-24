/**
 * compliance/types.ts
 * Shared types for the severity-weighted compliance & suitability engine.
 */

export type Tier = "T0" | "T1" | "T2" | "T3" | "T4";

/** Point magnitude per severity tier (spaced so higher tiers dominate). */
export const TIER_WEIGHT: Record<Tier, number> = {
  T0: 10, // preference
  T1: 25, // advisory / fatigue guidance
  T2: 100, // operational
  T3: 400, // regulatory-soft
  T4: 1000, // regulatory-hard (legal limit)
};

export type Verdict = "satisfied" | "violated" | "na";

export type Domain = "schedule" | "workingHours" | "availability" | "exchange";

export interface RuleMeta {
  id: string;
  title: string;
  domain: Domain;
  tier: Tier;
  /** Hard gate: a violation disqualifies (candidate) or is a hard breach (audit). */
  blocking: boolean;
  params?: Record<string, number>;
  regulatoryRef?: string;
}

export interface LedgerEntry {
  ruleId: string;
  title: string;
  domain: Domain;
  tier: Tier;
  blocking: boolean;
  verdict: Verdict;
  /** Signed contribution: +weight if satisfied, -weight if violated, 0 if n/a. */
  points: number;
  reason: string;
  regulatoryRef?: string;
  observed?: string | number;
  threshold?: string | number;
}

export interface ScoreResult {
  /** Signed soft score (T0–T1) used for ranking; higher = more suitable. */
  score: number;
  /** 0–100 normalized fit derived from the soft band. */
  fit: number;
  /** True if any blocking rule was violated. */
  blocked: boolean;
  blockingFailures: LedgerEntry[];
  ledger: LedgerEntry[];
}
