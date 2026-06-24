# Enterprise-Grade Compliance & Suitability Engine — Design & Implementation Plan

**Goal:** turn rule-checking into a first-class, enterprise-grade subsystem of the app. A single
**signed, severity-weighted scoring engine** powers two things from one rule set:

1. **Suitability ranking** — for assignment/exchange, the *best candidate sits at the top* (compliance adds points, violations subtract, weighted by severity).
2. **Breach detection** — scans the **Schedule**, **Working Hours**, and **Daily Availability Chart** data and surfaces every rule breach, worst first.

**Decisions locked with you:** best candidate at top · severity-tier weighting · 15-day limit removed (7-day & 30-day only).

**Status:** Plan for approval. No runtime behaviour changes until we build the phases below.

---

## 1. The numbering system (refined)

### 1.1 Core idea
Every rule, when evaluated against an entity (a candidate, an employee-day, or a shift cell),
returns one of: **satisfied**, **violated**, or **not-applicable**. Each rule carries a **signed
point weight** drawn from its **severity tier**:

```
contribution = + weight   if satisfied
             = − weight   if violated
             =   0        if not-applicable

score(entity) = Σ contributions over all applicable rules
```

Rank **descending** → highest score at top = most compliant / most suitable. Breaches push the
score down; the most-breached entities fall to the bottom of the suitability list and rise to the
top of the *breach* list (same number, inverse sort).

### 1.2 Severity tiers (the weights)
Tiers are spaced by an order of magnitude so a higher tier **always dominates** any number of
lower-tier points — a legal breach can never be "outvoted" by preferences.

| Tier | Name | Weight | Meaning | Example rules |
|------|------|-------:|---------|---------------|
| **T4** | Regulatory-Hard | ±1000 | DGCA WDTL legal limit. Breach = disqualified. | 7-day >48h, 30-day >190h, >2 consecutive nights, rest after night |
| **T3** | Regulatory-Soft | ±400 | Regulation-derived, near-limit / interval rules | 12h interval, >6 consecutive days, 48h interval after streak |
| **T2** | Operational | ±100 | Keeps the operation safe/covered | group below minimum, eligibility/rating, one-duty-per-day |
| **T1** | Advisory | ±25 | Fatigue guidance, soft health rules | 2nd consecutive night, working previous day |
| **T0** | Preference | ±10 | "Nice to have" ranking nudges | M↔A pairing, multi-rating flexibility, well-rested bonus |

### 1.3 Why "gate + score", not a single raw sum (the enterprise refinement)
A pure sum can let a candidate with many small positives mask a hard breach. The auditable
pattern used in enterprise rostering separates **eligibility** from **ranking**:

- **Hard gates (T4, and the blocking T3 rules):** evaluated as **pass/fail**. Any fail →
  candidate is **excluded** from the ranked suitability list and appears in the **Breaches** view
  with the exact rule(s) failed. (Equivalent to the −1000 weight always sinking them, but
  explicit and clearer to audit.)
- **Suitability score (T0–T2 + non-blocking T3):** computed only for candidates that pass the
  gates. This is the number shown, highest at top.

The displayed number stays a single signed score; the gate just guarantees no illegal candidate
is ever recommended. We keep **both** representations: the **raw signed score** (for the breach
ledger) and a normalized **0–100 "fit"** derived from the soft band (for the candidate list).

### 1.4 Explainability (non-negotiable for enterprise)
Every score is returned with an **itemized ledger** — the list of `{ruleId, tier, ±points, verdict, human reason, regulatoryRef}` that produced it. The UI shows these as chips; the audit log
stores them verbatim. No score is ever a black box.

---

## 2. The Rule Registry (single source of truth)

All thresholds live in one **versioned, config-driven registry** — no magic numbers scattered in
components. Each rule:

```ts
interface RuleDef {
  id: string;              // stable, e.g. "WDTL.7D"
  title: string;
  domain: "schedule" | "workingHours" | "availability" | "exchange";
  tier: "T0"|"T1"|"T2"|"T3"|"T4";
  blocking: boolean;       // hard gate?
  weight: number;          // from tier (overridable, governed)
  params: Record<string, number>;  // thresholds (e.g. { hours: 48, windowDays: 7 })
  regulatoryRef?: string;  // "DGCA CAR §7.1.1(b)"
  version: string;         // effective-dated
  evaluate(ctx): "satisfied" | "violated" | "na";
}
```

### 2.1 Rule catalog (mapped from `ROSTER_RULES_COMPILED.md`)

| ID | Rule | Domain | Tier | Block | Threshold | Ref |
|----|------|--------|:----:|:-----:|-----------|-----|
| `WDTL.DUTY12` | Single duty ≤ 12h | schedule/WH | T4 | ✓ | 12h | §7.1.1(a) |
| `WDTL.7D` | 7-day cumulative ≤ 48h | workingHours | T4 | ✓ | 48h / 7d | §7.1.1(b) |
| `WDTL.30D` | 30-day cumulative ≤ 190h | workingHours | T4 | ✓ | 190h / 30d | §7.1.1(b) |
| `WDTL.INTERVAL12` | ≥ 12h between duties | schedule | T3 | ✓ | 12h | §7.1.2 |
| `WDTL.CONSEC6` | ≤ 6 consecutive duty days | workingHours | T3 | ✓ | 6 days | §7.1.3(a) |
| `WDTL.POSTSTREAK48` | ≥ 48h after a duty block | workingHours | T3 | ✓ | 48h | §7.1.3(b) |
| `WDTL.NIGHT12` | Night duty ≤ 12h | schedule | T4 | ✓ | 12h | §7.3.1(a) |
| `WDTL.NIGHT2` | ≤ 2 consecutive nights | schedule | T4 | ✓ | 2 | §7.3.1(b) |
| `WDTL.RESTN1` | ≥ 48h rest after 1 night | schedule | T4 | ✓ | 48h | §7.3.2(a) |
| `WDTL.RESTN2` | ≥ 54h rest after 2 nights | schedule | T4 | ✓ | 54h | §7.3.2(b) |
| `WDTL.TRANSITION` | No N→M / N→A next day | schedule | T4 | ✓ | — | derived from §7.3.2 |
| `OPS.ONEDUTY` | One duty per day | schedule | T2 | ✓ | 1 | A4 |
| `OPS.ELIG` | Holds required rating/group | exchange | T2 | ✓ | — | A4 |
| `OPS.LOCKED` | Locked duty not changed | schedule | T2 | ✓ | — | A4 |
| `COVER.GROUPMIN` | Group ≥ shift minimum | availability | T2 | ✓ | per group (D1) | A3 |
| `COVER.OCCMIN` | OCC sub-min (MA 4 / N 7) | availability | T2 | ✓ | 4 / 7 | A3 |
| `FATIGUE.2NDNIGHT` | Avoid 2nd consecutive night | schedule | T1 | — | — | §7.3.1 note |
| `FATIGUE.PREVDAY` | Rested previous day | schedule | T1 | — | — | guidance |
| `PREF.MA_SWAP` | Cover M/A gap with the other day shift | exchange | T0 | — | — | A5 (your pref) |
| `PREF.NIGHT_NO` | Night cover from Night-Off first, else Afternoon | exchange | T0 | — | — | A5 (your pref) |
| `PREF.MULTIRATING` | Multi-rated → flexible | exchange | T0 | — | — | A4 |

> `WDTL.POSTSTREAK48` supports the 36h SRA exception (§7.1.3 note) only behind a governed,
> approval-gated override flag — default stays 48h.
> **15-day rule: intentionally absent** (removed from code & schema; not in registry).

### 2.2 Governance
- Thresholds are **effective-dated and versioned**; a change creates a new rule version, never an
  in-place edit, so historical scores remain reproducible.
- Registry changes are **reviewed/approved** (config PR or an admin "rule governance" screen) and
  recorded — mirrors WDTL §5.3 / §9 record-keeping.

---

## 3. Breach detection across the three pages

The engine runs the registry over each domain's data and produces a **compliance ledger**. What
each page contributes:

### 3.1 Schedule (`employee_schedules` / Duty Management)
Per employee-day and per transition:
`WDTL.NIGHT2`, `WDTL.RESTN1/N2`, `WDTL.TRANSITION`, `WDTL.INTERVAL12`, `OPS.ONEDUTY` (duplicate
duties), `OPS.LOCKED`. Output: flagged cells + a per-employee breach count.

### 3.2 Working Hours (`WorkingHours.tsx` / `working_hours_cache`)
Reuses the existing rolling-window computation: `WDTL.7D`, `WDTL.30D`, `WDTL.CONSEC6`,
`WDTL.POSTSTREAK48`, `WDTL.DUTY12`. The page already computes peak7/peak30/streak — we wrap those
results in registry verdicts + points so they feed the same ledger.

### 3.3 Daily Availability Chart (`supervisorAvailability.ts`)
Per shift × group cell: `COVER.GROUPMIN`, `COVER.OCCMIN`, and per-shift totals. The existing
`available − required` already exists; we attach severity + points so shortages rank in the unified
breach list.

### 3.4 Unified breach output
```
BreachLedgerEntry {
  entity: { type: "employeeDay"|"employee"|"shiftCell", id, date, shift?, group? }
  ruleId, tier, points (negative), verdict: "violated",
  observed, threshold, reason, regulatoryRef
}
```
The **Compliance Dashboard** aggregates these: sortable worst-first, filter by domain / severity /
date / team / employee, drill-down to the ledger, and CSV/PDF export for audit.

> Note: this scan runs **in-app on live Supabase data** (same hooks the three pages already use:
> `useSupervisorScheduleMembers`, the working-hours RPC, the availability builder). I can't read
> your production DB from here, so the plan defines the detector; the actual breach list renders
> when it runs against your data in the app.

---

## 4. Architecture (enterprise-grade)

```
            ┌─────────────────────────────────────────────────────────┐
            │  Rule Registry (versioned config)  — single source       │
            │  rules.config.ts  +  thresholds, tiers, refs             │
            └───────────────┬─────────────────────────────────────────┘
                            │ pure, deterministic
   data hooks ──► Normalizer ──► Evaluation Core ──► Ledger + Score ──► UI
 (schedule,      (one shape:     (no I/O; fully       (signed score,    (ranked list,
  WH cache,       roster state)   unit-tested)         itemized chips)   breach board,
  availability)                                                          inline badges)
                            │
                            └──► Audit Log (decisions, overrides, approvals — 24 months)
```

Principles:
- **Pure deterministic core** — evaluation has no side effects; same input → same score. Trivially
  unit-testable and reproducible for audit.
- **Separation of concerns** — data fetching (hooks) ≠ normalization ≠ rule evaluation ≠ presentation.
- **Config over code** — thresholds in the registry, not hard-coded in components.
- **Explainability & audit** — every score itemized; every applied decision/override logged with
  actor + timestamp (WDTL §5.3, §9).
- **Performance** — reuse `working_hours_cache`; precompute availability; evaluate incrementally on
  the affected rolling windows rather than recomputing everything.
- **Security** — service-role only server-side; RLS on read models; approvals capture identity.
- **Observability** — breach counts/trends, acceptance rate, override rate as dashboards.
- **Resilience & data quality** — guard against missing/duplicate rows; unknown duty codes default
  to a conservative verdict; never silently pass a hard rule.

---

## 5. UI / UX

1. **Availability Finder (assignment):** ranked candidates, **best at top**, each with its signed
   score, a 0–100 fit bar, and ledger chips (`+10 M↔A pairing`, `+25 well-rested`, `−100 group risk`).
   Blocked candidates collapse into a "Rule-blocked" section with the failed gate.
2. **Compliance Dashboard (audit):** unified breach board across the three pages, **worst first**,
   with filters, drill-down ledgers, trend KPIs, and export.
3. **Inline badges:** Schedule, Working Hours, and Availability pages each show a small per-row
   compliance chip linking into the dashboard.

---

## 6. Delivery phases

| Phase | Scope | Outcome |
|-------|-------|---------|
| **P0** | Registry + scoring core + types; port `availabilityEngine.ts` onto the registry | Single rule source; deterministic signed scoring with ledger |
| **P1** | Working Hours detectors wrapped into registry verdicts (7D/30D/streak/post-streak) | WH breaches feed the unified ledger |
| **P2** | Schedule detectors (night limits, rest, transition, interval, one-duty, locked) | Per-cell/per-employee schedule breaches |
| **P3** | Availability detectors (group min, OCC, totals) | Coverage shortages in the ledger |
| **P4** | Compliance Dashboard + inline badges + export | Enterprise breach visibility, worst-first |
| **P5** | Audit log, governance screen, override-with-approval, effective-dating | Full auditability & rule governance |
| **P6** | Hardening: caching/incremental eval, RLS, tests, shadow→advisory→enforced rollout | Production-grade |

Testing throughout: per-rule unit tests, scenario fixtures (leave, night blocks, swaps,
shortages), golden-file regression, and property-based checks that hard gates can never be
out-scored.

---

## 7. Open items carried from the rules doc (still needed before P0 finalizes)

These don't block writing the engine, but they set the actual numbers:
- **F2 — hours per shift:** the app counts M/A/N as 6h. Confirm real on-watch hours, or `WDTL.7D`/`WDTL.30D` rarely trigger.
- **F3 — `NO` meaning:** rest (callable for night) vs 6h duty — affects both scoring and the night-cover pool.
- **F4 — time-in-position (§7.2):** include position-level 2h/break/2230–0600 checks, or shift-level only?
- **F5 — 36h SRA exception:** keep behind a governed override (recommended) — confirm.
- **F6 — fatigue source:** add a fatigue flag table, or omit fatigue rules in v1.

---

## 8. Summary

One versioned rule registry → one deterministic, severity-weighted signed score → two views (best
candidates on top, worst breaches on top), with full per-point explainability and an audit trail.
The 15-day limit is removed; only the DGCA 7-day (48h) and 30-day (190h) caps remain. This gives
the page an enterprise-grade compliance brain that is auditable, configurable, testable, and safe
to roll out in shadow mode before enforcement.
