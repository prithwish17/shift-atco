# ATC Roster — Compiled Rules & Compliance Reference

**Purpose:** a single source of truth for every rule that governs duty assignment, shift
exchange, duty-hour limits, and daily availability — combining the DGCA regulation, the
app's current duty-hours logic, the daily availability chart minimums, and the desired
exchange preferences. This is the spec we'll build the engine against.

**Status:** Compiled 2026-06-16 · Engine implemented 2026-08-03 · Reconciled against AAI Office Order 251024/88 (see **Part G**).

---

## Part A — Sources

| # | Source | Authority | Where it lives |
|---|--------|-----------|----------------|
| A1 | **DGCA CAR**, Section 9, Series L Part VII, Issue III (Rev.1, 14 Aug 2023) — "Watch Duty Time Limitations (WDTL) and rest requirements for ATCOs" | Regulatory (mandatory) | Uploaded PDF `WDTL-D9L-L7(IssueIII_R1).pdf` |
| A2 | App **Working Hours** module | App implementation | `src/pages/supervisor/WorkingHours.tsx` |
| A3 | App **Daily Availability Chart** rules | App implementation | `src/lib/supervisorAvailability.ts` |
| A4 | **Duty-change rules** (operational) | Internal design | `roster_automation/services/decision-engine/DUTY_CHANGE_RULES.md` |
| A5 | **Exchange preferences** | User direction | This document, Part E |
| A6 | **AAI Office Order** `AAI/GM/ATM/ADMN/Ops/251024/88` (24.10.2025) — local WDTL compliance order | Local (mandatory) | Uploaded PDF · Part G |

Where A1 (regulation) and A2–A4 (app) disagree, the regulation wins; differences are logged in Part F.

---

## Part B — WDTL (DGCA regulation — authoritative)

### B0. Key definitions
- **Night duty window:** a period of night duty starts **0030 hrs** and ends **0429 hrs IST**. A duty "covers night" if any part falls in this window.
- **Duty period:** from when the ATCO must report until free of all duties. Handover/takeover up to **15 min** does not count toward the accepting controller's duty period.
- **Operational duty (time-in-position):** time actually exercising the licence at an operational position.
- **Rest / non-duty period:** continuous defined time free of all duties.
- **WOCL (window of circadian low):** ~0200–0600; relevant to fatigue.

### B1. Duty period limits (§7.1.1)
| Rule | Limit |
|------|-------|
| Single duty period | **≤ 12 hours** |
| Cumulative duty in any **7 days** | **≤ 48 hours** |
| Cumulative duty in any **30 days** | **≤ 190 hours** |

> The CAR specifies **only** 7-day and 30-day cumulative caps. There is **no 15-day cap** in the regulation (see Part F1).

### B2. Interval between duty periods (§7.1.2)
- **≥ 12 hours** between the end of one duty period and the start of the next.
- Exception: split-watch airports where the gap between watch hours is ≥ 5 hours and total watch (incl. break) is 12 hours/day.

### B3. Consecutive duty days (§7.1.3)
- **No more than 6 consecutive duty days.**
- **≥ 48 hours** interval between one block of consecutive duty days and the next.
- May be reduced to **36 hours** only with a Safety Risk Assessment (SRA) accepted by ATSP(AAI) HQ / ED (Aviation Safety) before use.

### B4. Operational duty — time-in-position (§7.2)
- No block of operational duty **> 2 hours** … (§7.2.1a)
- … **except** where workload < 50% of AAR/sector capacity and activity is spasmodic → up to **4 hours** (decision by ATS-in-charge). (§7.2.1b–c)
- Cumulative time-in-position **between 2230–0600** (next day) **≤ 4 hours**. (§7.2.1d)
- **Break ≥ 30 min** during/at end of each ≤2h block; pro-rata for extended blocks (45 min after 3h, 60 min after 4h). (§7.2.2)

> Time-in-position is finer-grained than the roster's shift codes. The roster app currently models shift-level duty, not position rotation, so B4 is **not** machine-checked today (Part F4).

### B5. Night duties (§7.3.1)
- A duty covering all/part of the night window **≤ 12 hours**.
- **No more than 2 consecutive night duties** over **two consecutive days**.
- Guidance: minimise rostering of 2-consecutive-night blocks where practicable; consider fatigue/health.

### B6. Rest after night duties (§7.3.2)
| After… | Minimum rest before next duty |
|--------|-------------------------------|
| **One** night duty | **≥ 48 hours** |
| **Two consecutive** night duties | **≥ 54 hours** |

### B7. Roster administration (§5)
- Roster **published ≥ 5 days in advance**; prepared for **≥ 2 weeks**.
- **Mutual shift changes between ATCOs are allowed only with ATS-in-charge approval and only if the resulting shifts still comply with WDTL.** Records must be kept. *(This is the legal basis for the exchange engine — Part E.)*
- Records of duties/rest kept **24 months**.

---

## Part C — App "Working Hours" module (current implementation, A2)

### C1. Cumulative limits used
| Window | Limit | Constant |
|--------|-------|----------|
| 7-day | 48 h | `ATCO_LIMITS.peak7` |
| 30-day | 190 h | `ATCO_LIMITS.peak30` |
| 15-day | **(removed)** | was `peak15: 130h`, deleted |

Computed as a **rolling window sum** (`calcPeakInWindow`): for every start date it sums hours over the next N days and keeps the max → "breached" if max > limit.

### C2. Consecutive duty (matches B3)
- `CONSECUTIVE_LIMITS.maxConsecutiveDays = 6` → streak violation if `maxStreak > 6`.
- `CONSECUTIVE_LIMITS.minRestAfterConsecutive = 48` h.
- A "working day" = any day whose duty-hours > 0.

### C3. Duty-code → hours mapping (how hours are counted)
| Code(s) | Hours |
|---------|-------|
| `M`, `A`, `N`, `NO` | 6 |
| `G`, `GO` | 8 |
| `M+A`, `A+M`, `NO+N` | 12 |
| `CO+N`, `CO+A`, `CO+M`, `SAT+N`, `SUN+N` | 5–6 |
| `SAT+NO`, `SUN+NO` | 7 |
| `CO`, `SL`, `Tr`, `T`, `CH`, `NH`, `SAT`, `SUN`, `NA`, `LEAVE`, `L` | 0 |

> A standard `M`/`A`/`N` shift is modelled as **6 h**, not the regulation's 12 h cap (Part F2). Also note `NO` (Night Off) is counted as **6 h of duty** here, while the availability/exchange logic treats `NO` as *off/rest* (Part F3).

### C4. Duty start times (IST)
`M` 0700 · `A` 1300 · `N` 1900 · `G`/`GO` 0940 (compounds inherit the working code's start). Used for rest-gap reasoning.

### C5. What the module flags today
Per-employee: total hours, days worked, avg/day, **7-day breach**, **30-day breach**, **max consecutive streak**, **streak violation**, and **rest violations** after long streaks.

---

## Part D — Daily Availability Chart rules (A3)

Shift codes here are **M / A / N**. Each rating group has a minimum required head-count per
shift; a cell is short if `available < required`.

### D1. Group minimum head-count per shift
| Group | Categories | Morning/Afternoon min | Night min |
|-------|-----------|:---------------------:|:---------:|
| 1 — RSR | RSR+UBN, RSR | 12 | 16 |
| 2 — ASR | ASR+RSR, ASR+APP | 4 | 4 |
| 3 — ACC/OCC | ACC-PLR, OCC+ACC-PLR, ADC+ACC-PLR, ACC-PLR+ACC-P, ADC+ACC-P, ACC-P+OCC, OCC | 14 | 16 |
| 4 — ADC/SMC | ADC/SMC (incl. ADC, SMC) | 9 | 9 |
| 5 — ALPHA | ALPHA | 11 | 10 |

- **OCC sub-requirement** (within Group 3): Morning/Afternoon **≥ 4**, Night **≥ 7**.
- **Per-shift total required** = sum of the group minimums for that shift (M/A = 12+4+14+9+11 = **50**; N = 16+4+16+9+10 = **55**).
- Sufficiency colour by `available − required`: ≤ −2 deep red, −1 red, 0 amber, +1/+2 green shades, ≥ +3 strong green.

### D2. The coverage constraint (hard)
**After any exchange, every group on the affected shift must still satisfy `available ≥ required`.** Fixing one shortage must not create another (regulation B7 requires the swap to remain WDTL-compliant; this rule keeps it operationally safe).

---

## Part E — Exchange / duty-change rules (operational, A4 + A5)

### E1. When a change is allowed
A duty change (replacement A→B, or swap A↔B) is permitted only when triggered by a valid
event — leave, fatigue, supervisor decision, or an approved swap — **and** the result complies
with WDTL (B1–B6) and group coverage (D2), **and** it is approved by the supervisor / ATS-in-charge (B7). No change is auto-applied.

### E2. The preference ladder (implemented — `src/lib/compliance/ladder.ts`)
Each rung is a different *kind* of intervention with a different cost. Lower is preferred;
a rung is only reached for when the ones above it yield nothing usable.

| Rung | Night (N) | Morning (M) | Afternoon (A) |
|:----:|-----------|-------------|---------------|
| 1 | Night-off call-in (`NO`→`NO+N`) | Swap from Afternoon | Swap from Morning |
| 2.0 | Swap from Afternoon (`A`→`N`) | **Night-break** — relieves both days | **Night-break** — relieves both days |
| 2.5 | — | **Night-break** — relieves the first day only | **Night-break** — relieves the first day only |
| 3 | General (`G`/`GO`) | **Extra duty** (`A`→`M+A`) | **Extra duty** (`M`→`M+A`) |
| 4 | Other rest call-in | General | General |
| 5 | Clear-off (`CO`→`CO+N`) | Other rest call-in | Other rest call-in |
| 6 | — | Clear-off | Clear-off |

- **Night-break:** a controller rostered `N` works the night day and the following night-off
  day as day duties, keeping only the clear-off. Two cells change; the `CO` is untouched.
  Cumulative hours are unchanged (12h either way). Requires a rest day on D+1 to consume.
- **Extra duty (OPE):** `M+A` is a single contiguous 0700–1900 duty period of exactly 12h.
  It costs **no** manpower anywhere — the controller keeps their original shift — which is
  why it is the fallback when the counterpart swap would strip the donor shift.
- **General (G/GO)** occupies no M/A/N cell, so pulling one never depletes a shift; it still
  ranks last on every shift because moving a day-working reserve is operationally disruptive.
- **Clear-off (CO)** is the lowest-priority source of all.
- Every duty code the ladder writes (`NO+N`, `CO+N`, `M+A`, `M`, `A`) already existed — no
  schema change was needed.

### E2a. Ordering (lexicographic — never a single summed score)
```
1. rung          ascending   ← ladder position; dominates everything
2. fairness load ascending   ← rotation: fewer prior impositions first
3. soft signals  descending  ← multi-rating, rested previous day
4. name
```
`fairness load = impositions this year + 2 × impositions this month`, counting duty
exchanges, OPE duties and night-breaks alike. Fairness rotates people **within** a rung and
can never promote one across a rung; no accumulation of soft points can outrank a better
rung. (The previous engine summed unbounded fairness penalties into the same band as ±10
preference nudges, so a controller's exchange history silently decided which *strategy* won.)

### E3. Hard constraints every candidate must pass (gates — never violated)
A candidate may cover the target shift **only if all** hold:
- Active, not on leave, not fatigued, **not already assigned** that day (one duty/day).
- Holds the **required rating / group** for the position.
- **Rest after night:** ≥ 48 h since one night duty, ≥ 54 h since two (B6) → N→M and N→A next-day blocked.
- **Night limit:** would not create a **3rd consecutive night** (B5).
- **≤ 6 consecutive duty days** (B3); within **7-day ≤ 48 h** and **30-day ≤ 190 h** caps *after* adding the duty (B1) — with N = 12 h these now bite.
- **Source-shift coverage (D2) — directional, audited:** removing the candidate from their **current**
  shift must not drop any of their rating groups below that shift's minimum.
  *Example (RSR min = 4 for M and A):* A is short (3) and M has 5 → may pull one from M (5→4, still ≥ 4).
  But if M has 4 and A has 3 → **cannot** pull from M (4→3 < 4). For an **OPE = Morning+Afternoon (M+A)**
  duty, the person occupies **both** M and A, so removing them is checked against **both** shift minimums.
- Duty is **not locked**.

### E4. Candidate ranking (soft, severity-weighted — best at top)
Ordered by priority class (rest call-in → swap → clear-off **last**), then by signed score:
best-fit source (E2) **+**, General flexibility **+**, multi-rating **+**, and **fairness −**:
- **Fewer prior duty exchanges** rank higher (penalty scales with count this year & this month — e.g. 3 prior exchanges outrank 4).
- **Fewer prior OPE duties** rank higher (penalty scales with OPE count this year & this month).

Every suggestion shows its origin shift, signed score, and an itemized reason ledger.

---

## Part F — Open questions & discrepancies (need your decision before building)

| # | Issue | Detail | Proposed resolution |
|---|-------|--------|---------------------|
| **F1** | **15-day limit** | ✅ **RESOLVED** — removed everywhere; only 7-day (48 h) & 30-day (190 h) remain. | Closed. |
| **F2** | **Hours per shift** | ✅ **RESOLVED** — M = 6 h, A = 6 h, **N = 12 h** (1900→0700), summing to 24 h/day. Set in `src/lib/dutyConfig.ts`. | Closed. |
| **F3** | **`NO` meaning** | ✅ **RESOLVED** — `NO` (Night-off) = rest day given after a night = **0 duty hours**, callable for night cover; classified as off/rest. | Closed. |
| **F4** | **Time-in-position (§7.2)** | 2 h position limit, 30 min breaks, 2230–0600 ≤ 4 h are **not** modelled (roster is shift-level, not position-level). | Decide whether the engine must check position rotation, or only shift-level WDTL. |
| **F5** | **48→36 h exception (§7.1.3)** | ✅ **RESOLVED** — Office Order 251024/88 records a standing exemption for **all of Para 7.1.3**, granted by ED (Aviation Safety). Implemented as `PARA_713_EXEMPTION`; see **G0**. | Closed. Re-confirm periodically — the order states no expiry. |
| **F6** | **Fatigue data** | ⚠️ **NOW MANDATED** — Office Order 251024/88 §3 requires a **Fatigue Register**: ATCOs self-assess, report to the WSO, and the WSO relieves/rearranges duty and records the action. The app still has no fatigue table. | Build the fatigue register; until then the "not fatigued" exchange gate has no data behind it. |

---

## Part G — AAI Office Order 251024/88 (local authority)

| # | Source | Authority | Where it lives |
|---|--------|-----------|----------------|
| A6 | **AAI NSCBI Kolkata Office Order** `AAI/GM/ATM/ADMN/Ops/251024/88`, dated 24.10.2025 — "Compliance of WDTL & Rest Requirements for ATCOs" | Local, mandatory. Supersedes orders 250530/52 (30.05.2025) and 240821/41 (21.08.2024) | Uploaded PDF |

### G0. The Para 7.1.3 exemption — **the single most important item here**
The order records two things:

1. DGCA's temporary exemptions on the CAR were **withdrawn w.e.f. 0001 hrs on 31.10.2025** —
   so everything else in Part B is now strictly in force.
2. **Exemption for Para 7.1.3 — "Limit on and interval following consecutive duty periods" —
   has been granted by ED (Aviation Safety).**

Para 7.1.3 covers **both** sub-paragraphs, so both of these are exempted:

| Rule | CAR | Was | Now |
|------|-----|-----|-----|
| `WDTL.CONSEC6` — ≤ 6 consecutive duty days | §7.1.3(a) | **blocking** | reported, **not enforced** |
| `WDTL.POSTSTREAK48` — ≥ 48 h between duty blocks | §7.1.3(b) | warning | reported, **not enforced** |

Implemented as `PARA_713_EXEMPTION` in `src/lib/compliance/registry.ts`. An exempted rule is
**still evaluated and still reported** — deleting it would lose the visibility and make an
exempted breach indistinguishable from a compliant roster if the exemption is ever withdrawn.
It simply cannot block a duty change. This **closes F5**.

> The order states **no expiry** for the exemption. It should be re-confirmed periodically
> rather than assumed indefinite; `PARA_713_EXEMPTION.to` is deliberately left open.

### G1. The rotation sits exactly on its regulatory boundaries
`N` ends 0700 on D+1 and the next block's `M` starts 0700 on D+3 — **exactly 48 h**. `A`→next-day
`M` is **exactly 12 h**, the §7.1.2 minimum. The roster carries no slack anywhere.

### G2. A night-break costs the 48 h post-block rest — **but that is now permitted**
Consuming the night-off leaves only the clear-off, so the gap to the next block falls to **36 h**
(42 h if the second duty is a `M`). Everything else about the break is clean: 7-day and 30-day
totals are unchanged, and — per **G4** — the two days are ordinary day duties, so no night rule
applies. The 36 h gap engages §7.1.3(b), **which is exempted (G0)**. The engine reports it for
the record and does not block. *Superseded resolution: no SRA is needed; the exemption covers it.*

### G3. Night cover remains hard — **and is NOT exempted**
§7.3.2 (rest after night duties) and §7.1.1 (cumulative caps) were **not** exempted, so this
still stands. Because the roster grants exactly 48 h (G1) while §7.3.2(b) demands **54 h** after
*two* consecutive nights, any intervention creating a second consecutive night breaches rest:

- **Rung 1 (Night-off call-in)** additionally puts a third night into a 7-day window —
  3 × 12 h plus surrounding day shifts — breaching the 48 h weekly cap of §7.1.1(b).
- **Rung 2 (Afternoon swap)** is legal *only* when the controller's following day is already
  rest. In the pure cycle `A` is always followed by `N`, so usually it is not.

Follows directly from **F2** fixing `N` at 12 h. Options: revisit the 12 h night model, roster
extra rest around called-in nights, or seek a §7.3.2 exemption. **Policy decision, not a code one.**

### G4. A night-break yields ordinary day duties
Confirmed and enforced: breaking a night writes plain `M`/`A` on both days (6 h each, 12 h total —
identical to the 12 h night it replaces). The controller then has **no night duty**, so
`WDTL.NIGHT2`, `WDTL.RESTN1` and `WDTL.RESTN2` do not apply to that block at all.

### G5. Rules added from the order
| Rule | Order § | Behaviour |
|------|---------|-----------|
| `OPS.ELIG` — exchange only with an ATCO holding a **similar rating** | §2 | blocking; rating groups are the equivalence class |
| `OPS.NOTICE7` — ATCO must have **≥ 7 days** to decline a duty change or extra duty; silence counts as acceptance | §1 | advisory only — flags changes made inside the window; never disqualifies |

### G6. Gaps between the order and the app — **not yet implemented**
| # | Order requires | App today |
|---|---------------|-----------|
| 1 | **Mutual exchange is bilateral** — Annexure-A exchanges *A's duty on date X* for *B's duty on date Y* | The ladder models one-sided cover (move P from duty X to Y). Bilateral two-person, two-date swaps are not generated. |
| 2 | Approval chain **WSO(s) → JGM(ATM-SQMS) *recommend* → GM(ATM) *approve*** (§2) | `duty_exchange_approvals` runs a **2-step** WSO → supervisor chain. The separate recommend/approve split is absent. |
| 3 | **Fatigue Register** — ATCO self-assesses, reports to WSO, WSO relieves/rearranges and records (§3) | No fatigue table. The exchange gate "not fatigued" has no data source. **This is F6, now mandated.** |
| 4 | **Operational duty period** records — start/duration/end of each time-in-position (§4) | Roster is shift-level only. **This is F4**, and §7.2's 2 h position limit / 30 min breaks / 2230–0600 ≤ 4 h remain unmodelled. |
| 5 | **Annexure-A** form with six signature blocks | Not generated by the app. |
| 6 | **Duty Exchange Register** maintained by the WSO | `compliance_audit_log` is close but is not framed or exported as the register. |
| 7 | Verify changes in the **'MY DUTY' Google sheet**; update the **IAMATC Portal** (Duty/Rest) | External systems, no integration. |
| 8 | Roster released **fortnightly**; leave by 22nd (1st fortnight) / 8th (2nd fortnight); leave inside 5 days needs WSO recommendation and **gets no substitute** | Part B7 still says "published ≥5 days / prepared ≥2 weeks" (the CAR minimum). The no-substitute rule matters here: a gap from late leave should **not** trigger a cover search. |

---

## Part G — Compliance checklist (what the engine must verify)

For any proposed assignment or exchange, the engine should confirm:

1. Duty period ≤ 12 h (B1).
2. 7-day cumulative ≤ 48 h after the change (B1/C1).
3. 30-day cumulative ≤ 190 h after the change (B1/C1).
4. ≥ 12 h gap from previous and to next duty (B2).
5. ≤ 6 consecutive duty days; ≥ 48 h interval after a block (B3/C2).
6. Night duty ≤ 12 h; ≤ 2 consecutive nights (B5).
7. ≥ 48 h rest after 1 night / ≥ 54 h after 2 nights (B6).
8. Candidate holds the required rating/group (E3).
9. Every group still meets its shift minimum afterward (D1/D2).
10. Exchange follows the preferred pairing (M↔A; Night from NO else A) (E2).
11. Supervisor approval recorded; change logged (B7).
