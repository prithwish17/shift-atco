# SARC — Stress Allowance Recovery Calculator

Port of the "SARC" Google Sheet into shift-atco as a first-class module.

The system produces **Annexure-2: Stress Allowance Recovery** for a two-month
period: for each controller it computes the stress-allowance hours they were
*owed*, compares against hours they actually *performed*, and reports the
shortfall as a recovery percentage.

Reference period of the exported CSVs: **1 June – 31 July 2026 (61 days)**,
374 employees, 372 in the Annexure.

> §1 is the authoritative specification, confirmed with the business owner.
> §2 records where the existing sheet departs from it. Every figure quoted was
> computed from the exported CSVs, not estimated.

---

## 1. Confirmed specification

### 1.1 Home category

From the `Team` column of the attendance sheet:

| Team | Category | Home rate |
|---|---|---|
| `G` | general | **0.5 hr/day** |
| `A`–`E` | shift | **1.0 hr/day** |

Every real employee has a team — the 103 blank-team rows in the source belong
to junk records that never match a live employee ID.

### 1.2 Day classification

| Class | Codes |
|---|---|
| **skipped** | blank, `NA`, `#N/A` |
| **general duty** | `G`, `GO`, `T`, `TR` |
| **bridging** | `LEAVE` `SAT` `SUN` `CH` `GH` `RH` `NH` `SL` `CO` |
| **shift duty** | everything else — `M` `A` `N` `NO` `M+A` `A+M` `NO+N` `CO+M` … |

**The live roster speaks a wider vocabulary than the workbook.** The golden
fixture came from the sheet's export, which contains no `GO` and uses `#N/A`;
the live `employee_schedules` table carries `GO` (1,332 cells over June–July,
against 734 for `G`) and `NA` (1,675). Both fell through to shift duty at
1.0 hr/day until the live tally exposed them — roughly 3,000 cells charged as
watch duty that were not.

The tests still guard sheet parity, but by construction they cannot catch a
code the sheet never emitted. That is what the `unknown-duty-code` pre-flight
warning is for, and it earns its place.

Per the app's own duty legend (`useEmployeeSchedules.DUTY_DESCRIPTIONS`):
`GO` is "General Oscar" and shares `G`'s 0940 start; `NA` is "Not Available",
meaning not posted that day, so it accrues nothing; `NH` is a National Holiday.

`NH`, `CH`, `GH`, `RH`, `SAT`, `SUN`, `LEAVE`, `CO` and `SL` are treated
**identically** — a test asserts behavioural equivalence across the whole set,
not merely a shared label. Training (`T`/`TR`) is general duty for Stress
Recovery, and counts toward the five-duty threshold.

Skipped days contribute nothing and do not break a block. Bridging days do not
count toward the 5 and do not break a block. Training (`T`/`TR`) is general
duty and, when there are at least five consecutive general-duty days, accrues
at 0.5 hour per day.

### 1.3 Blocks

Scan for maximal runs of a single duty type. A run continues across bridging and
skipped days and terminates on a duty of the **other** type.

A block **qualifies** when it contains **≥5 duties of its own type** — duties
counted, not calendar days. So `GGG LLL GG` is five general duties and
qualifies. A block's **span** runs from its first duty to its last.

Spans of the two types can never overlap: a duty of the opposite type terminates
the run, so a bridging day belongs to at most one span.

### 1.4 Charging

**Global fallback, evaluated first:**

- no qualifying **shift** block anywhere in the period → **0.5/day** for every non-skipped day
- otherwise, no qualifying **general** block anywhere → **1.0/day** for every non-skipped day

**Otherwise, per day:**

| Day | Charge |
|---|---|
| inside a qualifying **general** span | **0.5** — duties *and* bridging days alike |
| inside a qualifying **shift** span | **1.0** — duties *and* bridging days alike |
| outside any qualifying span | **home rate** |
| skipped | **0** |

Bridging days take the rate of the span they sit inside. Outside a span they
fall back to the home rate — they are never charged at a block rate they are not
part of.

### 1.4a Sandwich bridging days

When two qualifying blocks of **different** types are adjacent — separated only
by bridging and skipped days — the gap's bridging days are absorbed into the
**preceding** block's span and charged at its rate. Skipped days in the gap
keep their null span and charge nothing.

Example: `[5×G] [SAT SUN] [5×shift]` — the SAT and SUN sit between a
qualifying general block and a qualifying shift block. The preceding block is
general, so both weekend days are charged at **0.5/day** rather than the home
rate.

The rule fires **only** when:

1. Both blocks qualify (≥5 duties each)
2. The blocks are of different types (general→shift or shift→general)
3. Every day in the gap is bridging or skipped — no actual duties of either type

This resolves six of the twelve departures from the sheet documented in §2.3
and §2.4, bringing the engine closer to the historical baseline.

### 1.5 Adjusted hours, rating pro-rate, recovery

The cap normalises the theoretical maxima to the monthly standard — 30 hrs per
month at the shift rate, 15 at the general rate — with a month treated as 30
days. Expressed as a `min` so it can only ever cap, never inflate:

```
adjusted = min(required, 30 * months)
           and, when the accrual was wholly at the general rate
           (required == 0.5 * daysOnRoster), also min(..., 15 * months)
```

Keying the general cap off *how the hours were accrued* rather than off the
`General` flag is deliberate: 41 employees are General-flagged, and a flag-based
cap would crush any of them who did substantial shift work. Verified to
reproduce the sheet's column `I` exactly, with none of its 61-day fragility —
on a 59-day period the sheet's exact-match version would *raise* requirements.

**Which rating counts.** A rating earned at a previous station is not a Kolkata
rating, so only ratings dated **on or after** the controller joined Kolkata
anchor a requirement. `ratingDate` below means the oldest such rating.

```
kolkataJoiningDate absent                        -> nil (exempt, and a BLOCKING
                                                    pre-flight error: a missing
                                                    joining date is a sync gap,
                                                    not a fact about the person)
no rating on/after kolkataJoiningDate            -> nil (exempt)

requirement:
    ratingDate absent OR endorsementDate absent  -> nil (exempt)
    ratingDate >  periodEnd                      -> nil (not yet rated)
    ratingDate <= periodStart                    -> adjusted
    otherwise                                    -> (periodEnd - ratingDate + 1)
                                                    * round(adjusted / periodDays * 2) / 2
performed:
    general (>50% of period days are G)  -> TOTAL TIME-IN (A+B)
    shift                                -> (A+B+C+D+E)
                                            + MIN(truncateToMinute((F+G+H)/2), 15h)
recovery  = max(0, (requirement - performed) / requirement)
```

The IAMATC weighted total carries **two rules its own column header omits** —
the header reads plainly `(A+B+C+D+E)+(F+G+H)/2`. The supportive half-weighted
component is capped at **15 hours** (60 of the extract's 317 rows are only
reproducible with it), and the halving **truncates to the whole minute** rather
than rounding (four further rows are off by exactly thirty seconds otherwise).
With both, the formula reproduces all 317 rows. The file importer must not
"correct" an extract that looks like it fails the header formula.

Performed hours are **not capped** at the requirement — a surplus simply floors
recovery at 0%.

---

## 2. Where the existing sheet departs from §1

### 2.1 Stale 59-day window in five columns

Columns `D, K, L, M, N` hardcode `F:AG` — 28 days — for month 1, a leftover from
when the sheet was built for **Feb–Mar** (the `LET` variables are still named
`feb` and `mar`). Only column `C` was generalised to `EOMONTH`.

Proof: `C` reproduces **only** with a 30+31 window; `L` and `M` reproduce
**only** with 28+31. For June–July this discards 29 and 30 June. It will be
wrong differently for a 31+30 period and badly wrong for any period containing
February.

### 2.2 `Advance Hours Required` — dropped

Column `M` is byte-for-byte the same algorithm as `C`, run over the stale 59-day
window, which is exactly why it always lands 1–2 hrs below `C`. It was never a
distinct metric. **Decision: drop the column.**

### 2.3 The 5-day gate is global, not per-block

The sheet charges 0.5 for *any* `G` day anywhere as long as the employee has at
least one 5-G run somewhere in the period. An isolated single `G` day inherits
the general rate from an unrelated block five weeks earlier. §1.4 scopes the rate
to the block that earned it.

### 2.4 Bridging days are charged by streak state, not span membership

The sheet drops a shift person's leave to 0.5 the moment they touch a **single**
`G` day, via a running `streak` counter. §1.4 charges a bridging day by the span
it sits inside, and the home rate outside — which is both stricter and
explainable.

### 2.5 Training reclassification

The sheet reclassifies a 5+ `T` run as general and retro-corrects the earlier
days of the run from 1.0 → 0.5 (`correction = tOnes × 0.5`). Under §1.2 training
bridges instead: it neither builds nor breaks a block.

### 2.6 Rating date equal to period start breaks the cap

Column `J` tests `ratingDate < start` strictly, so an employee rated exactly on
the start date falls into the pro-rate branch and receives `61 × 1.0 = 61:00`,
above the `60:00` ceiling column `I` exists to enforce. Observed: **DEBAJIT
JOTDER (10010144)**. §1.5 uses `<=`.

### 2.7 The General/Shift split on Hours Performed is a silent no-op

`Hours Required!E` is empty in the export and the Annexure takes the **grand
total for everyone**. SANDIP BASU is flagged `General = Yes` but received 33:15
(grand total), not the 31:25 his branch should have produced. The split has
never actually been applied in an issued statement.

Applying it correctly changes **nobody's recovery** on this period — only 22 of
the 175 with a requirement are General, and all of them clear their requirement
on either column. It is still worth fixing: it is a latent no-op that will bite
as soon as a General officer's controlling time falls near their requirement.

### 2.8 Divergent code vocabularies

Three classifiers currently disagree about the same codes. `CO` and `SL` are
neutral for the G-streak but charged 1.0 by the hours engine. `GH`/`RH` are
leave to the engine but break the G run. `M+A` is in the duty list but `A+M` is
not, despite both appearing in the data. §1.2 replaces all three with one table.

### 2.9 Dirty source rows — no impact, but worth surfacing

25 rows in month 1 and 26 in month 2 are entirely `#N/A`, including the employee
ID, and 103 rows have a blank team. **All of them are junk records that never
match a live employee ID** — zero `#N/A` cells and zero blank teams occur on the
374 real employees. Harmless today; the importer should still flag them.

### 2.10 Roster drift double-pro-rates — accepted, not fixed

8 employees appear only in month 1, 5 only in month 2. Absent months are skipped
days contributing 0, so joiners and leavers self-pro-rate — and then §1.5
pro-rates again against the **full period** denominator, which assumes they were
on roster throughout. The two prorations stack.

Worked example: someone on roster only in July (31 days, all shift duty → 31 hrs)
rated on 15 July, leaving 17 chargeable days. The daily rate computes as
`31 ÷ 61 = 0.51 → 0.5 hr/day → 8:30`, where dividing by days actually on roster
would give `31 ÷ 31 = 1.0 hr/day → 17:00`. Roughly half.

**Decision: leave as-is**, matching the sheet. Currently latent — of the 8
partial-roster employees, none has a mid-period rating date, so the two never
collide on this period. The engine must therefore divide by **period days**, not
days on roster. Flagged here so it is a known accepted behaviour rather than a
surprise the first time the combination arises; revisit if it does.

### 2.11 Over half the roster has no requirement

199 of 374 (53%) have no rating date, so the requirement is nil and they are
exempt. Confirmed as intended.

**The two dates play different parts.** The **endorsement date is a gate**:
both credentials must be on file, and a controller with a rating but no
endorsement carries no requirement at all. The **rating date is the anchor**:
proration always runs from it, even when the endorsement lands mid-period.

Eleven employees were endorsed inside the reference period, and the six whose
rating predates it draw the full 60:00 — only reproducible if an in-period
endorsement never moves the start date. Nobody on the reference roster is rated
but unendorsed, so the gate is inert there; against live data it decides who is
billed, which is why pre-flight reports that state as its own warning rather
than folding it in with the unrated.

Pre-flight also escalates to a **blocking error** once 90% or more of the roster
carries no requirement, whichever date is missing. That is not a policy outcome,
it is a broken rating sync, and its symptom — every recovery reading zero — is
otherwise indistinguishable from a clean month.

The two employees excluded by `Master Data Match = No` (MILAN KANTI MANDAL
10012533, AROON KUMAR SINGH 10010453) both already have a nil requirement, so
that filter is currently redundant and changes no numbers.

### 2.12 Net effect

| | Sheet | §1 spec (with §1.4a) |
|---|---|---|
| Total hours required | 20,974.5 | 20,562.5 |
| Employees whose requirement changes | — | **6 of 374** |
| Employees in recovery | 12 | 6 |
| Mean recovery | 1.82% | 1.20% |

The sandwich bridging rule (§1.4a) resolved six of the original twelve
departures: BRAJ MOHAN, DIPTI RANJAN SETHI, APOORV KUSHWAHA, MILAN KANTI
MANDAL, AMITAVA ROY and PRATICK DASGUPTA now match the sheet exactly. The
remaining six are shift controllers whose bridging days the sheet mis-charged
via its running streak counter (§2.4).

---

### 1.6 Kolkata joining date

From the CAP Kolkata Master **ATCO LIST** sheet, column `DOJ` (K). The sheet
also carries `DOJ_AAI` (J) — the AAI service date — and the two must not be
confused: only the Kolkata date decides which ratings count.

| | Lands in | Why there |
|---|---|---|
| `DOJ` (K) | `employee_training_records.kolkata_joining_date` | keyed by `emp_id` TEXT, so it covers all 374 roster members |
| `DOJ_AAI` (J) | `profiles.date_of_joining` | display only; the field now means one thing instead of whatever each employee typed |

Synced weekly by `fetch-atco-master` (`atco-master-sync-weekly`, Sundays 02:30
UTC / 08:00 IST) from the Apps Script in `atco-master-scraper.gs`. Weekly rather
than nightly because the master changes on posting orders, not daily.

Measured against the reference period: all 374 employees appear in the master
and all 374 have a Kolkata joining date. **One** employee's requirement is
affected — SOURAV SAHA (10002036), rated 2016-12-19, joined Kolkata 2026-01-20 —
who now needs a rating earned here or becomes exempt.

The master's `SHIFT` column is **not** used as a team source: it disagrees with
the attendance `Team` for 85 of 363 employees, and the home rate turns on that.


## 3. Data sources

Most inputs already sync into Supabase on a schedule.

| Input | Source | Status |
|---|---|---|
| Attendance day grid | `employee_schedules` (`employee_code`, `duty_date`, `duty_code`) ← `fetch-schedule` | ✅ live |
| Team | `profiles.current_shift` ← `fetch-team-code` | ⚠️ auth-bound |
| Oldest rating date | `employee_training_records.rating_data.*.rating_date` ← `fetch-rating-data` | ✅ live |
| Oldest endorsement date | `employee_training_records.rating_data.*.endorsement_date` | ✅ live |
| Designation | `profiles.designation`, `employee_training_records.rating_designation` | ✅ live |
| Hours performed (IAMATC) | — | ❌ no equivalent |

`employee_schedules.employee_code` and `employee_training_records.emp_id` are
plain `TEXT`, not FKs to `auth.users`, so they cover the full roster rather than
only registered app users.

### 3.1 Gaps

**IAMATC extract.** Actual time-on-position — Controlling, OJT Practical, OJTI
Theo/Sim, WSO/CMD, Instructor/Examiner, Unit Supervisor, Supportive Unit, Alpha.
No app equivalent; `working_hours_cache` holds *rostered* hours derived from duty
codes, a different quantity. Needs a file import or a `fetch-iamatc` edge
function in the shape of the existing `fetch-*` functions.

**Team for non-registered employees.** `profiles.current_shift` requires an auth
user, but the home category in §1.1 is needed for every roster member. Fallback:
carry the team through the schedule sync, or infer it from the duty-code mix.

---

## 4. Build plan

Follows the existing `src/domain/{leave,ojt}` pattern — a pure, dependency-free
domain module with vitest coverage, consumed by hooks and pages.

### Phase 1 — Engine · `src/domain/sarc/` ✅ done

```
types.ts      216   the domain model; durations are whole seconds throughout
duration.ts    79   [h]:mm:ss parsing/formatting, half-hour and minute rounding
codes.ts       76   the single §1.2 classification table
period.ts     100   period arithmetic — every length derived, none hardcoded
blocks.ts      97   §1.3 block detection and span resolution
engine.ts     316   §1.4 charging, §1.5 cap, pro-rate, performed, recovery
annexure.ts    82   statement assembly + summary
index.ts       12   barrel
```

Durations are integers because the source data is `h:mm:ss`, the charging rules
move in half-hours, and the IAMATC total truncates to the minute — integers
make all three exact and keep float drift out of a calculation that sets pay.

Every day carries the rate it drew *and why* (`span`, `home`, `fallback-*`,
`skipped`) so the UI can show its working. Unknown duty codes, partial roster
coverage and absence from the IAMATC extract surface as row-level warnings
rather than silent defaults.

### Phase 2 — Golden-master tests ✅ done

`src/domain/sarc/__tests__/` — 52 tests, all passing.

```
fixtures.ts    6799   GENERATED. All 374 employees: inputs plus the workbook's
                      own computed columns as the oracle
sarc.test.ts    620   the suites, and the hand-maintained exception lists
```

Regenerated by `scripts/generate-sarc-fixtures.ts <export-dir>`, which reads
the period from the workbook's own Start/End cells and derives both month
lengths from it — so next period regenerates without editing anything.

**No legacy mode was built.** The plan originally called for a second
implementation reproducing the sheet bug-for-bug, to prove the deltas. That is
weaker than what shipped: the oracle is the sheet's *own exported output*, so
there is nothing to reimplement and no risk of a legacy implementation carrying
a bug that coincidentally matches. It also keeps a second copy of superseded
logic out of the codebase.

The accepted departures are hand-written in `sarc.test.ts`, never generated —
nine `BRIDGING_RATE_EXCEPTIONS` (shift controllers whose accrual rises, §2.4),
three `ISOLATED_DUTY_EXCEPTIONS` (general officers whose accrual falls, §2.3),
and `PRORATE_EXCEPTION` (§2.6). Each asserts its exact before/after value, and
a separate test asserts the *set* of differing employees equals that list, so a
thirteenth fails the build. Had the exceptions lived in the generated file, the
next regeneration would have absorbed a regression silently.

Coverage: fixture integrity · the IAMATC weighted total including its
undocumented 15-hour cap and minute truncation · accrual, cap, pro-rate and
recovery against the sheet · the negative oracle for the never-applied
General/Shift split · report invariants · and the §1.3/§1.4 rules in isolation
on synthetic rosters.

Verified to bite: forcing the qualifying threshold to six breaks 10 tests,
removing the supportive cap breaks 4, and reverting bridging days to the home
rate inside a span breaks 20.

### Phase 3 — Data access ✅ done

```
src/domain/sarc/sources.ts        pure derivations — earliest dates, home category, assembly
src/domain/sarc/preflight.ts      dataset-level validation
src/data-access/sarc.repository.ts  Supabase reads + issued-statement persistence
src/hooks/useSarc.ts              TanStack Query, assembly and evaluation
```

The derivations live in the domain rather than the repository so they are
covered by the same tests as everything else; the repository hands over plain
shapes and stays a thin read layer.

**Pagination is not optional here.** PostgREST caps a response at 1000 rows and
a two-month period is ~23,000 duty cells, so every read pages, ordered by a
stable key — an unordered range query can repeat or drop rows between pages.

**Home category for employees without an app account.** `profiles.current_shift`
carries the roster team but only exists for registered users, and §1.1 needs a
category for every roster member. Resolution order is profile, then inference
from the duty-code mix, then unknown. `SarcEmployeeInput` gained an optional
`home` override so an inference does not have to invent a fake team letter to
stand for "a shift team, but we do not know which"; `homeSource` records which
route was taken so the UI can show inferred as inferred.

The inference counts **only actual duties**, excluding leave, weekends and
training. Dividing by all non-skipped days would misread a general-team officer
who took a fortnight off as a shift controller. This is deliberately a different
denominator from the `isGeneral` flag in §1.5, which divides by period days
because that is what the sheet does — the two answer different questions.

Pre-flight (`preflight.ts`) reports duplicate IDs, employees with no roster days,
partial coverage, duty codes dated outside the period, unrecognised codes,
missing teams, half-populated rating records, employees carrying a requirement
but absent from the extract, and extract rows matching nobody. Errors block
issuing; nothing blocks calculation. The sheet's failure mode was that bad data
silently became a number — the fix is to compute anyway and put the problem
where an operator can see it.

### Phase 4 — IAMATC ingestion ✅ done

`src/domain/sarc/import.ts` — `FileDropzone` upload, parsed in the domain layer
so the importer is unit-testable without a browser.

**CSV and `.xlsx` are accepted.** The CSV reader handles quoted fields, escaped
quotes, embedded commas and newlines, CRLF and a leading BOM. Excel workbooks
are read with `exceljs` and use the same column mapping and validation as CSV;
formatted elapsed-time cells such as `[h]:mm:ss` retain their total hours.
Both formats are covered by importer tests.

Columns are matched on **header fragments**, so the extract's own spacing and
punctuation can drift without breaking the import. Rows are matched on
`Employee Id`, never on name: the extract's names differ from the roster's
(`KUMARESH CH HALDAR` vs `KUMARESH CH. HALDAR`).

Nothing is silently corrected. Duplicate IDs keep the first and say so;
unparseable durations count as zero and name the line; and where the engine's
weighted total disagrees with the one the extract prints, **the extract's is
kept** and the disagreement reported — the header formula is not the whole rule
(§1.5), so a disagreement more likely means a changed export than a bad row.

Line numbers are absolute positions in the source file. Blank rows are parsed
and kept rather than filtered, because filtering them shifts every number
reported afterwards, and an issue naming the wrong row is worse than one naming
none — the row it points at may look perfectly fine.

**A bare number is read as hours**, by decision. That leaves one failure mode:
a spreadsheet exporting *raw* values emits day-fractions, so 30 hours becomes
`1.25`, reads as an hour and a quarter, and the whole statement comes out ~24x
short while looking entirely plausible. The `total-mismatch` check does not
catch it — when every value is scaled alike the arithmetic still agrees, except
on the ~60 of 317 rows where the 15-hour cap binds. So the import additionally
**rejects** a file in which not one duration cell contains a colon: a genuine
extract always writes `h:mm:ss`, and a raw-value export never does.

### Phase 5 — UI ✅ done

```
src/pages/supervisor/StressAllowanceRecovery.tsx   the page
src/components/sarc/SarcDayStrip.tsx               per-employee working
src/components/sarc/SarcFindingsPanel.tsx          pre-flight findings
```

Routed at `/supervisor/stress-allowance-recovery`, supervisor and admin only.

Period is chosen as two months rather than two dates: requirements accrue
against a **per-month** ceiling, so a part-month period would make the cap
meaningless. Defaults to the two completed months ending last month.

The drill-down is the point of the whole rebuild. Clicking any row shows all 61
days, each with its duty code, what it charged and which rule set that charge —
colour-coded by general span, shift span, whole-period fallback, home rate and
not-on-roster — followed by every block with its duty count and whether it
qualified. A controller asking "why is my requirement 53 hours" now has an
answer that fits on one screen.

Export is CSV and PDF via the existing `jspdf` + `jspdf-autotable`.

### Phase 6 — Persistence ✅ done

`supabase/migrations/20260814120000_sarc_runs.sql`.

Roster and rating data keep moving, so recomputing a period six months later
will not necessarily reproduce the figures that were issued. An issued statement
is snapshotted — the statement lines only, since the day-by-day working is
~23,000 cells per period and is reproducible from the schedule table.

**No UPDATE policy, by design.** An issued statement is a record of what was
issued; amending one in place would defeat the point of snapshotting it. The
period is not unique, so a correction stacks as a new row. Read and insert are
supervisor/admin; delete is admin-only. Employees cannot read the table at all —
a statement carries every colleague's recovery position, so per-employee access
needs a filtered view rather than a row policy here.

`issued_by_name` is denormalised alongside the `auth.users` reference so a
statement stays attributable after an account is deleted.

---

## 5. Decisions

All specification questions are closed. Recorded here so the reasoning survives.

| # | Question | Decision |
|---|---|---|
| 1 | Home rate source | Team column — `G` → 0.5/day, `A`–`E` → 1.0/day |
| 2 | Does the 5-day gate apply per block or globally? | **Per block**, with the §1.4 global fallback ahead of it |
| 3 | Training (`T`/`TR`) | **General duty** — counts toward the five-duty gate and accrues at 0.5/day once qualified |
| 4 | Bridging codes | `LEAVE SAT SUN CH GH RH SL CO`; `NO` stays a shift duty |
| 5 | Bridging days inside a qualifying span | Charged at **the span's rate**, not the home rate |
| 6 | Bridging days outside any span | **Home rate** |
| 7 | Is the 5 counted in duties or calendar days? | **Duties** — `GGG LLL GG` qualifies |
| 8 | G-team person with a shift block but no general block | Global fallback fires → **1.0/day** for the whole period |
| 9 | Hours performed — General | `TOTAL TIME-IN (A+B)` |
| 10 | Hours performed — Shift | `(A+B+C+D+E)+(F+G+H)/2` |
| 11 | Cap on performed hours | **None** — recovery floors at 0% |
| 12 | Cap on the requirement | **Normalise** — see §1.5 |
| 13 | `Advance Hours Required` | **Drop the column** (§2.2) |
| 14 | IAMATC source | **File import** (§4 Phase 4) |
| 15 | Roster-drift double-proration | **Leave as-is** — divide by period days (§2.10) |

### Settled during implementation

- **Team for non-registered employees** — resolved as profile → inference from
  the duty-code mix → unknown, recorded in `homeSource` (Phase 3).
- **Spreadsheet parser** — `exceljs` for `.xlsx`; the hand-rolled CSV reader
  remains in place for `.csv`. `xlsx@0.18.5` remains rejected on security grounds.

### Open

- **The master-data exclusion is not wired.** `SarcRow.included` and the
  Annexure's `excluded` list are implemented and tested, but nothing populates
  them: `MASTER_DATA_IMPORT` has no app equivalent and its columns were never
  characterised. Harmless today — both employees it excluded in the reference
  period were already exempt for want of a rating date, so it moved no numbers
  (§2.11) — and the seam is one `Set<string>` wide when a source appears.
- **Employee-facing view of an issued statement**, which needs a filtered view
  rather than a row policy on `sarc_runs` (Phase 6).
