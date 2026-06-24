# ADR-001: Make the Rule Governance page understandable and the rule registry fully editable

**Status:** Accepted
**Date:** 2026-06-21
**Deciders:** ATS-in-charge / supervisor lead (rule owner), app maintainer
**Scope chosen:** *Fully editable registry* (rules themselves editable in-app), design-first.

**Resolutions (2026-06-21):**
1. **Regulatory (T3/T4) rules are read-only except their plain-language description.** Tier,
   threshold, regulatory_ref, blocking, and enabled are not editable in-app for locked rules.
   Temporary, governed changes to a regulatory threshold still go through the existing
   **Add temporary exception (override)** path (effective-dated, approved, audited).
2. **Single-approver + audit** is sufficient. No maker/checker (two-person) flow.
3. **Change history stays in `compliance_audit_log`** (`action="rule_edited"`). No dedicated
   revisions table.

---

## Context

`src/pages/supervisor/RuleGovernance.tsx` exposes the DGCA compliance rule registry to
supervisors. Today it has two problems:

### 1. It is hard to understand
The page surfaces the engine's raw internals with no translation:
- Rule **codes** (`WDTL.POSTSTREAK48`, `COVER.OCCMIN`) with no plain-language meaning.
- Tier **codes** (`T0`–`T4`) and weights (`±400 · gate`).
- Machine threshold syntax (`hours=48, windowDays=7`, `ma=4, n=7`).
- No explanation of what a "gate", "blocking", or "override" actually does.
- One dense table + one dense form; no grouping, search, or legend.

A supervisor cannot tell, at a glance, *what a rule does* or *what changing it would mean*.

### 2. The rules are not editable
There are two layers, only one of which is editable:

| Layer | Where it lives | Editable at runtime? |
|---|---|---|
| **Rule registry** (`RULES` in `src/lib/compliance/registry.ts`) — titles, tiers, base thresholds, regulatory refs, blocking flags | Hardcoded TypeScript, ships in the build | **No** |
| **Overrides** (`compliance_rule_overrides` table) — temporary, effective-dated, approval-gated exceptions | Supabase | Yes (via the form) |

The user wants supervisors to edit the **registry itself** in-app — not just file temporary
overrides.

### Forces at play
- **This is a compliance registry with legal weight.** T4 rules map to DGCA CAR limits
  (e.g. `WDTL.7D` = §7.1.1(b), the legal 48h/7-day cap). Arbitrary edits to legal limits are
  dangerous and must be governed (approval + audit + retention; CAR §5.3/§9 → keep 24 months).
- **The engine must never run with an empty registry.** `src/lib/compliance/engine.ts` and
  `src/lib/availabilityEngine.ts` evaluate suitability/compliance on every roster/availability
  pass. If the registry is DB-backed, a failed fetch must degrade gracefully, not block scoring.
- **Small blast radius.** Only `engine.ts` (one line: `RULES[ruleId]`) and `RuleGovernance.tsx`
  read `RULES` directly. Everything else already goes through helper functions
  (`ruleWeight`, `effectiveParams`, `isRuleEnabled`) and through `setActiveOverrides`. There is
  already a proven runtime-hydration pattern (`useApplyRuleOverrides`) to copy.

---

## Decision

Move the rule registry from a hardcoded TS object to a **DB-backed, versioned, governed,
editable registry**, while **keeping the code `RULES` object as the seed + offline fallback**.
Redesign the page around **plain-language rule cards** with read-only-by-default viewing and
governed inline editing.

Two distinct, clearly-labelled actions are preserved:
- **Edit definition** — change the canonical rule (title, plain-language description, base
  threshold, tier, regulatory ref, blocking, enabled). Permanent. Approval + audit.
- **Add temporary exception (override)** — the *existing* effective-dated override mechanism,
  unchanged. For "until DD-MM, allow 36h with an approved SRA" cases.

---

## Options Considered

### Option A — Hybrid: DB-backed registry, code as seed + fallback *(recommended)*
DB table `compliance_rules` is the runtime source of truth; the migration seeds it from the
current `RULES`. App hydrates the engine from the DB on load (mirroring `useApplyRuleOverrides`).
If the table is missing/empty/unreachable, the engine uses the hardcoded `RULES`.

| Dimension | Assessment |
|---|---|
| Complexity | **Medium** — 1 table, 1 repo, 1 hydration hook, resolver shim, page rewrite |
| Cost | Low (one small table, same RLS pattern as existing) |
| Scalability | Fine — ~25 rules, read-once-and-cache |
| Team familiarity | **High** — clones the existing overrides pattern exactly |
| Safety | **High** — graceful degradation; code baseline still reviewable in PRs |

**Pros:** full editability; engine never runs empty; baseline stays in version control; reuses
the existing graceful-degradation + audit conventions; small blast radius.
**Cons:** two sources of truth (code seed vs DB) — merge precedence must be explicit and tested.

### Option B — DB-only registry (no code fallback)
Migration seeds the table; engine *always* reads DB; `RULES` deleted.

| Dimension | Assessment |
|---|---|
| Complexity | Medium-High (must handle "registry not yet loaded" everywhere) |
| Safety | **Low** — a DB outage or unseeded env = engine has no rules = scoring breaks |
| Team familiarity | Medium |

**Pros:** single source of truth.
**Cons:** loses offline/fresh-deploy safety and PR-reviewable baseline; risky for a *compliance*
engine that runs on every pass. **Rejected.**

### Option C — Editable descriptions only (registry stays in code)
Add a small content table for plain-language text; thresholds/tiers stay code-governed.
**Rejected** by the chosen scope (user wants full registry editability). Noted only as the
lower-risk fallback if full editability proves too heavy.

---

## Trade-off Analysis

The core tension is **editability vs. the integrity of legal limits**. Option A resolves it by:

1. **Keeping a code baseline** (seed + fallback) so the system is always operable and the
   "official" defaults are reviewable in git.
2. **Governing edits, graded by tier:**
   - *Description / title* — light edit (reason optional), any supervisor; allowed on **all**
     rules including regulatory ones.
   - *Threshold / enabled / blocking* on **T0–T2 only** — reason + approver required (as
     overrides are now).
   - *T3–T4 (regulatory)* — **`locked`**: only the plain-language `description` is editable.
     Tier, threshold, regulatory_ref, blocking, and enabled are read-only in the editor. The
     legitimate path to relax a regulatory threshold is a **temporary exception (override)**,
     which is effective-dated, approved, and audited.
3. **Auditing every edit** to `compliance_audit_log` (`action: "rule_edited"`) with a
   before/after snapshot, satisfying the 24-month retention requirement. **Single approver**
   (no maker/checker).

The understandability redesign is independent of the data-layer choice and lands regardless.

---

## Target architecture

### Data model — new table `compliance_rules`
```sql
CREATE TABLE public.compliance_rules (
  id              text PRIMARY KEY,            -- rule code, e.g. 'WDTL.7D'
  title           text NOT NULL,              -- short label
  description     text,                        -- NEW: plain-language explanation
  domain          text NOT NULL,              -- schedule | workingHours | availability | exchange
  tier            text NOT NULL,              -- T0..T4
  blocking        boolean NOT NULL DEFAULT false,
  params          jsonb,                       -- {"hours":48,"windowDays":7}
  regulatory_ref  text,
  enabled         boolean NOT NULL DEFAULT true,
  locked          boolean NOT NULL DEFAULT false, -- true for regulatory limits; guards edits
  sort_order      integer NOT NULL DEFAULT 0,
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- RLS: SELECT to authenticated; INSERT/UPDATE to authenticated (app-role gated in UI),
--      mirroring compliance_rule_overrides. Seed every current RULES entry in the migration.
```
Change history reuses the existing **`compliance_audit_log`** (`action="rule_edited"`,
`snapshot = { before, after }`). A dedicated `compliance_rule_revisions` table is the more
robust alternative if point-in-time rule reconstruction is ever needed (Open Question).

`REGISTRY_VERSION` becomes derived: `max(updated_at)` across rows (or a stored meta value),
shown on the page as "last changed".

### Resolver shim (keeps blast radius tiny)
In `registry.ts`, add a hydratable layer next to the existing override layer:
```ts
let RESOLVED: Record<string, RuleMeta> = { ...RULES };       // seed = code baseline
export function setRegistry(rows: RuleMeta[]) {              // called from a hook on load
  RESOLVED = rows.length ? Object.fromEntries(rows.map(r => [r.id, r])) : { ...RULES };
}
export function getRuleMeta(id: string): RuleMeta | undefined { return RESOLVED[id]; }
export function getRules(): Record<string, RuleMeta> { return RESOLVED; }
```
Then:
- `engine.ts:32` `RULES[ruleId]` → `getRuleMeta(ruleId)`.
- `ruleWeight` / `ruleTier` / `effectiveParams` / `isRuleEnabled` read from `RESOLVED` instead
  of `RULES` (one-line changes; signatures unchanged → engine call-sites untouched).
- `RuleGovernance.tsx` iterates `getRules()` instead of `RULES`.

### Hydration
New hook `useApplyRuleRegistry()` (clone of `useApplyRuleOverrides`): fetches `compliance_rules`,
calls `setRegistry()`, returns a token for memo deps. Mount it wherever `useApplyRuleOverrides`
is mounted today so both layers hydrate together. On unprovisioned table → `{ rows: [], provisioned: false }`, `setRegistry([])` → fallback to code `RULES`.

### Page redesign (understandability)
Replace the two dense blocks with:
1. **Header + legend** — plain-language tier guide (Regulatory-hard → … → Preference), and a
   one-line explainer for "gate/blocking" and "override vs edit". Show registry "last changed".
2. **Search + filters** — by text, tier, domain, and status (Default / Edited / Overridden / Disabled).
3. **Grouped rule cards** (by tier, most severe first). Each card shows:
   - Friendly title + the code as a small monospace chip.
   - **Plain-language description** ("Controllers may not work more than **48 hours** in any
     **7-day** window").
   - **Human-readable threshold** derived from `params` (helper: `hours→"48 hours"`,
     `windowDays→"per 7 days"`, `days→"6 days"`, `max→"max 2"`), not raw `k=v`.
   - Status pill (Active / Overridden-until-date / Disabled) with color.
   - Regulatory ref as a quiet caption.
   - Two clear buttons: **Edit definition** and **Add temporary exception**.
4. **Edit dialog** (drawer) with friendly labelled fields, inline validation, the before→after
   diff, reason, and approver. For **regulatory (locked) rules only the description field is
   enabled** — tier/threshold/ref/blocking/enabled render as read-only captions, with a note
   pointing to "Add temporary exception" for governed threshold changes.
5. **Override dialog** = today's form, moved into a per-rule dialog and plain-language-labelled.

Read-only by default; edit affordances gated by supervisor role.

---

## Consequences

**Easier**
- Supervisors understand each rule at a glance and edit it in-app without a code deploy.
- Plain-language descriptions + human-readable thresholds remove the jargon barrier.
- Every change is governed and audit-logged with before/after.

**Harder / to watch**
- Two sources of truth (code seed vs DB) — merge precedence (DB wins, else code) must be
  explicit and covered by a test.
- Engine now depends on async hydration — the seed fallback guarantees it never runs empty, but
  there's a brief window before hydration where code defaults apply (acceptable; same as overrides today).
- Risk of harmful edits to legal limits — **eliminated** for the registry path: T3/T4 rules are
  `locked` to description-only edits, so their legal thresholds can only change through the
  effective-dated, approved, audited override path. The code seed remains the canonical baseline.

**To revisit**
- If point-in-time rule reconstruction is ever needed, promote change history from
  `compliance_audit_log` to a dedicated `compliance_rule_revisions` table (deferred for now).

---

## Action Items

1. [ ] **Migration** `supabase/migrations/2026MMDD_compliance_rules.sql` — create
       `compliance_rules`, RLS (mirror overrides), and seed every current `RULES` entry
       (set `locked=true` for T3/T4; author plain-language `description` for each).
2. [ ] **Repo** `src/data-access/compliance-rules.repository.ts` — `listRules()`,
       `upsertRule()`, graceful `isMissingTable` fallback (copy the overrides repo).
3. [ ] **Hooks** in `useComplianceAudit.ts` (or a sibling) — `useRules()`, `useUpsertRule()`.
4. [ ] **Resolver** in `registry.ts` — `setRegistry/getRuleMeta/getRules`; point
       `ruleWeight/ruleTier/effectiveParams/isRuleEnabled` at `RESOLVED`.
5. [ ] **Rewire** `engine.ts:32` → `getRuleMeta(ruleId)`.
6. [ ] **Hydration hook** `useApplyRuleRegistry()`; mount alongside `useApplyRuleOverrides`.
7. [ ] **Page rewrite** `RuleGovernance.tsx` — legend, search/filters, grouped plain-language
       cards, edit dialog (description-only for locked rules), override dialog, human-readable
       helpers.
8. [ ] **Audit** — log `rule_edited` with `{ before, after }` snapshot on every edit (single approver).
9. [ ] **Verify** — `npm run lint` → `npx tsc --noEmit` → `npm run build` → `npm run preview`
       smoke test. (Commit/push only when told.)

## Open Questions — all resolved (see Resolutions at top)
1. T4 regulatory limits → **read-only; description-only edits.**
2. Approval → **single approver + audit** (no maker/checker).
3. Change history → **`compliance_audit_log`** (no dedicated revisions table).
