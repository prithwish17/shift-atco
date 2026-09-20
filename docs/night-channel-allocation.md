# Night Channel Allocation

A standalone module for the nightly position roster: who is on TWR, SMC-S,
SMC-N, CLD and TSO, minute by minute, from 13:30 to 01:30 the next day.

It **reads** the crew from the existing shift roster and **owns** everything
else — its own route, tables, rules, solver, board and exports. It writes
nothing back to the roster.

**There is no approval workflow.** Any signed-in employee on that night's shift
and the WSO have identical rights: view, set halves, choose starters, generate,
edit, save and share. The signed-in user is used only to identify "me" for the
self-service half buttons and to stamp who last saved.

| Piece | Where |
| --- | --- |
| Rules, solver, editing, roster text | [`src/domain/night-allocation/`](../src/domain/night-allocation) |
| Page | [`src/pages/NightChannelAllocation.tsx`](../src/pages/NightChannelAllocation.tsx) |
| Board, panels, dialog, share sheet | [`src/components/night-allocation/`](../src/components/night-allocation) |
| API | [`api/night-allocation/[...route].ts`](../api/night-allocation) |
| Server helpers (seeding, save, mail) | [`lib/nightAllocation/`](../lib/nightAllocation) |
| Migration | [`supabase/migrations/20260920120000_night_channel_allocation.sql`](../supabase/migrations/20260920120000_night_channel_allocation.sql) |
| Down migration | [`sql/night_allocation_down.sql`](../sql/night_allocation_down.sql) |

Route: `/night-allocation?date=YYYY-MM-DD`, defaulting to today. One route for
every role.

---

## 1. The night

Every time in this module is **minutes from 13:30**, on a 15-minute grid:
`0` is 13:30, `630` is midnight, `720` is 01:30 the next morning. Clock strings
are produced only for display, by
[`time.ts`](../src/domain/night-allocation/time.ts). Nothing stores a timestamp
and nothing stores a local time string — half the night falls on the following
calendar date, and a timestamp column is how that becomes a timezone bug.

A night is keyed by its **start date**: the date the 13:30 belongs to.

Halves: **1st Half 17:30–21:30** (`240`–`480`), **2nd Half 21:30–01:30**
(`480`–`720`), treated as continuous across midnight. Halves are optional.

## 2. Who is on the night

The crew is seeded from the **shift roster** — the `rosters` table, which is the
Google Sheet the office maintains, synced by `fetch-roster`. Not from the ATC
duty grid, and not from `employee_schedules`.

A night's rows are those with `date` matching (via `getRosterDateQueryValues`,
since legacy rows carry a dozen date spellings) and `shift` matching `night`
case-insensitively. The crew is the rows whose `unit` is one of the tower
positions:

| `rosters.unit` | Notes |
| --- | --- |
| `TWR` | |
| `CLD` | |
| `TSO` | |
| `SMC` / `SMC-N` / `SMC-S` / `SMC-N & SMC-S` | The sheet spells it differently per team tab |
| `AIMS` / `TWR-A` / `TWR-A/ AIMS` | On the crew and can hold a channel, though AIMS is not itself a channel here |

That is typically nine to eleven people, against the sixty-odd on nights across
the whole unit.

**The positions in use are seeded from the same units.** A night whose roster
lists one `SMC` runs one, not SMC-S *and* SMC-N; a combined `SMC-N & SMC-S` row
is likewise one position, because it is one person. `AIMS` and `TWR-A` map to no
channel — those people are on the crew and can hold one, but AIMS is not itself
a position here. Every channel stays present and tickable, just unticked.

This matters more than it sounds. Defaulting to all five positions put a phantom
SMC on most nights, and that one extra position was enough to make an otherwise
workable night impossible — the generator would refuse, correctly, and the
refusal looked like a fault in the module rather than a configuration that never
matched the night.

**Halves come from the sheet.** `rosters.position` already reads `1st Half` or
`2nd Half`, which is the same thing this module means by a half, so it is taken
as read rather than inferred. It stays editable on the page.

**Names are parsed, not trusted.** The name column holds
`HITESH RATHORE/ MGR - ADC/SMC-`, so `normalizeEmployeeMatchName` (the app's own
helper) takes the part before the `/` and drops the rating and designation. It
also holds **working notes** — `TWR (1330-1530) (1630-1730) SMC (2330-0130)`,
`UBN-A (1530-1630)` — which are rejected by a time-range test, along with rows
whose unit is `LEAVE`, `REMARK`, `TRAINING` or `SPECIAL`. Without that, a note
becomes a person on the board.

Matching to an account is by normalised name, and **only an unambiguous match
counts** — two people with the same normalised name would otherwise attach the
wrong account, and therefore the wrong TSO qualification, to a duty. Someone
with no account still appears, keyed by name.

**TSO qualification** is `profiles.can_take_tso` **or** being marked on the TSO
unit tonight: putting someone on TSO is itself the office saying they may take
it. Both stay editable on the page.

**When the roster has no crew** the list comes back empty and the page says
which case it is — `missing` (no night rows for the date at all) or `empty`
(night rows, but nobody on a tower unit). Use **Add someone from tonight's
shift**, which offers everyone on the night roster whatever their unit
(`GET /api/night-allocation/:date/shift`), or add a name by hand. People added
either way are marked `is_manual` and can be removed again.

## 3. The rules

Implemented once, in
[`rules.ts`](../src/domain/night-allocation/rules.ts), and imported by the
browser, by the API and by the tests. A client-side check and a server-side
validation therefore cannot disagree.

### Hard rules — these block saving

1. **Continuity.** Every in-use channel is covered with no gap from `open_at` to
   `close_at`. Relieved at 18:30 means the next person starts at exactly 18:30.
2. **No double-booking a channel.** Two people may not hold one position at once.
3. **No double-booking a person.** One person may not hold two positions at once.
   The one exception is a **merge**: CLD may be folded into the SMC in use for
   `MERGE_WINDOW` (19:00–21:30), and then whoever holds SMC holds both. CLD is
   not separately covered in that window — it is *absent*, not double-staffed —
   so there is one duty, not two. That is how the shift roster already writes
   combined units like `UKN+UKW`, and it avoids the fifteen-minute slivers that
   duplicating duties onto both rows would produce whenever the SMC handover
   does not land on the boundary. A merge is stored on the folded channel as
   `mergedInto`, is always reported as a suggestion, and makes a duty of CLD's
   own inside the window a hard error.
4. **Duty length.** 30 minutes minimum. 2 hours maximum on every position
   **except TSO**, which has no maximum — one person may hold it for as long as
   the night needs. See `UNCAPPED_DUTY_CHANNELS`; callers use `maxDutyFor()`
   rather than `MAX_DUTY_MIN`, or the rules and the solver disagree about TSO.
5. **Break.** At least 30 minutes between a person's duties, including across
   midnight.
6. **Halves.** Nobody is in both. A 1st Half person holds nothing overlapping
   21:30–01:30; a 2nd Half person holds nothing overlapping 17:30–21:30; and
   everyone in a half holds at least one duty inside their own half.
   **One exception**: a 1st Half person may hold **TSO** inside the 2nd Half
   (`CROSS_HALF_CHANNEL`). It runs one way only — a 2nd Half person has no
   equivalent licence in the 1st Half — and the generator treats it as a last
   resort, planning the whole night without it before reaching for it. A
   crossover that is present is always reported as a suggestion, so nobody has
   to guess whether it was deliberate.
7. **TSO qualification.** Only people flagged `can_take_tso` may hold TSO, start
   it, or appear in a TSO person picker.
8. **Availability.** Only people marked available may hold a duty, be in a half,
   or be a starter.
9. **Valid times.** `start < end`, both inside the night and inside the
   channel's open window.

### Preferences — advisory, never blocking

- The 2nd Half person on CLD from 21:30, and CLD as an earlier relieving duty
  for 2nd Half people where possible.
- Each channel's chosen starter actually holding it at its opening minute.
- Even workload inside each group (1st Half, 2nd Half, no half).
- **Staffing feasibility notices**, which explain *why* a continuous plan may be
  impossible. Computed per window (13:30–17:30, 17:30–21:30, 21:30–01:30) from
  the people who can work it, the channel-minutes open in it, and the ceiling
  that one person can be on duty for at most 120 of every 150 minutes.
  **Uncapped positions are counted separately** — that ceiling exists because of
  the two-hour cap, so TSO contributes one person tied up for the window rather
  than a share of the bound. The TSO-specific check asks only whether anyone
  qualified is free at all, and in the 2nd Half the 1st Half's qualified people
  count, because TSO is the position the halves may be crossed for.

## 4. The solver

[`solver.ts`](../src/domain/night-allocation/solver.ts) — deterministic, with
seeded randomised restarts. It returns a **fully continuous** allocation or
nothing. It never emits a plan with a gap, and it never modifies the board it
was given: a refusal leaves the existing duties untouched.

**Shape of the search.** A handover search: repeatedly take the channel whose
cover ends earliest, choose (person, end time) for the next duty, and backtrack
on failure.

**Staggering.** With `k` open channels and a pool of `n` people, handovers every
`I` minutes give duties of `k × I` and breaks of `(n − k) × I`. `I` is picked on
the 15-minute grid so the duty length stays inside 30 min–2 h, the break stays
at or above 30 minutes, and the duty length lands as close as possible to the
night's preferred length (Auto ≈ 1 h 30 m, fitted to staffing). This is what
makes the classic case come out right: *3 channels, 4 people → 1 h 30 m duties,
channels relieved 30 minutes apart, each relieved person resting 30 minutes then
taking the next channel.*

**Ordering heuristics.** The chosen starter first at a channel's opening minute;
people who must open another channel shortly held back; people whose half still
lacks a duty prioritised inside their half; then longest-rested, then
least-worked, then avoid the same channel twice running. TSO-qualified people
are kept free for TSO when few are qualified.

**Pruning.** At every pending handover the number of free, eligible, rested
people must cover the channels falling due within the next 30 minutes, and TSO
must always have a qualified, rested person available at its own handover.

**Budget.** ~1.5 s of restarts, or ~0.5 s when the staffing check already says
the night is impossible. It runs **server-side**, so a long search never blocks
the board; the button shows a busy state.

**On failure** it returns `{ ok: false, error, reasons }`, where `reasons` are
the staffing notices when there are any, or a hint to change a starter, an open
time, or a half.

## 5. Editing

[`editing.ts`](../src/domain/night-allocation/editing.ts). This is where gaps
would otherwise creep in.

- **Handover times are linked.** Changing a duty's start moves the previous
  duty's end on that channel to the same minute; changing its end moves the next
  duty's start. The chain is rewritten as one atomic operation.
- An edit that would open a gap, exceed 2 hours, drop below 30 minutes, break
  the 30-minute break, or break a half, TSO or availability rule is **rejected
  before it is applied**, with the specific reason shown in the dialog. The
  caller's state is returned untouched.
- **Delete** hands the freed time to the previous duty (or to the next one if
  the deleted duty was the first), and is refused when that would break a rule.
- **Split** ends the duty at a chosen time and gives the remainder to someone
  else, with no gap.
- **The channel of an existing duty cannot be changed** — that would empty the
  position it came from. Edit the duty on the other position instead.
- Changing a channel's open or close time re-fits its first and last duty to the
  new boundaries and drops duties entirely outside it.
- The first duty's start and the last duty's end are pinned to the channel's
  open and close times.

## 6. Data model

| Table | Holds |
| --- | --- |
| `night_allocations` | One row per night: `night_date`, `duty_length_pref`, `status`, `version`, who saved it and when. |
| `night_allocation_channels` | Per night: `in_use`, `open_at`, `close_at`, `starter_key`. |
| `night_allocation_people` | Per night: availability, half, a **snapshot** of `can_take_tso`, and `role` — which carries the roster unit (`TWR`, `SMC-N & SMC-S`) for seeded people and the designation for anyone added by hand. |
| `night_allocation_duties` | `channel_code`, `person_key`, `start_min`, `end_min`. |
| `night_allocation_audit` | One row per save, generate, reset, share and email, with the acting user. |

`profiles.can_take_tso` is the person-level attribute, edited in **Employee
Management** and snapshotted per night so a historical roster stays accurate
after someone's qualification changes.

**`person_key`, not `user_id`.** Duties reference a `person_key`: the profile id
where the roster line matched a profile, `code:<employee code>` where it did
not, and `manual:<id>` for someone typed in by hand. The roster regularly names
people the app has no account for, and a `user_id` foreign key would make them
unrosterable. `user_id` is still stored alongside, when it is known.

**Row level security.** Every authenticated user can read every night; **nobody
can write directly**. Writes go through the API, which re-runs the full rule set
with the service role and calls `night_allocation_save`. That is what makes the
rules unbypassable rather than merely enforced in the browser.

`night_allocation_save` does the whole write in one transaction: version check,
replace channels/people/duties as a set, bump `version`, insert the audit row.

## 7. API

Everything is behind ordinary authentication. **No role check anywhere.**

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/night-allocation/:date` | Full state: people, channels, duties, version, who saved it, and `rosterStatus`. Seeds from the shift roster when nothing is saved — and does **not** persist that seed, so opening a date never creates a row. |
| `PUT` | `/api/night-allocation/:date` | Save. Body carries `version`. |
| `POST` | `/api/night-allocation/:date/generate` | Run the solver on the submitted settings. Persists nothing. |
| `POST` | `/api/night-allocation/:date/validate` | `{ errors, warnings }` for a candidate state. |
| `POST` | `/api/night-allocation/:date/reset` | A working state seeded afresh from the shift roster. |
| `GET` | `/api/night-allocation/:date/shift` | Everyone on the night roster, whatever their unit — the pool behind "add someone from the shift". |
| `GET` | `/api/night-allocation/:date/export.txt` | The saved roster as WhatsApp-friendly plain text. |
| `POST` | `/api/night-allocation/:date/email` | Send the saved roster. |

- **`PUT` re-runs the full hard-rule validation** and rejects with `422` and the
  list of violations. The client is never trusted.
- **Optimistic concurrency:** a mismatched `version` returns `409` with the
  current server state, and the page offers "Load their version" rather than
  overwriting. `version` is bumped in the same transaction as the write.
- Duties, channels and people are replaced as a set inside one transaction.
- One audit row per save, generate, reset, share and email.
- `generate` (30/min), `email` (10/hour) and the exports (60/hour) are
  rate-limited per user in Upstash Redis, failing **open** if Redis is
  unreachable.

## 8. Sharing

**Share** offers Copy text, WhatsApp, Email, Download PDF and Download image,
and only once the night has no hard errors — sharing a roster with an uncovered
position sends the shift the wrong plan. Sharing changes nothing except an audit
row, and anyone who can see the night can do it.

Every format leads the same way: **title, then a sub-header naming the team and
the shift** (`Team A · Night`, derived from `rosters.team` rather than stored),
then the date and window, then **who is in each half**, and then **both
rosters** — by position and by person. The halves come first because they are
what a reader checks first; both rosters are included because a supervisor reads
down the positions and everyone else looks for their own name.

Every artefact is attributed to **Atcora**, not to whoever pressed Save. The
roster is the unit's; who saved it is on the page and in the audit trail.

- **Plain text** is rendered **server-side** from the saved night, so everyone
  shares the same artefact. It uses WhatsApp's `*bold*` markup and falls back to
  a summary plus a link when a full roster would be too long for one message.
- **PNG** is drawn on a canvas from the same numbers the board renders from, so
  it looks the same whatever the sender's screen, theme or scroll position.
  Every piece of text is **clipped to the shape it belongs in** — an unclipped
  `fillText` runs past the end of its strip and off the canvas, which is how the
  last duty of the night once exported as a half-drawn employee number. Strips
  are labelled with initials, never the employee number.
- **WhatsApp** uses `navigator.share({ files })` where the browser supports it,
  which sends the text and the image together. Otherwise it opens
  `https://wa.me/?text=…` and downloads the image to attach by hand. No Business
  API, no phone numbers in the code.
- **Email** goes out server-side through the mail providers the app already has
  (Brevo first, Resend as failover, mirroring
  `supabase/functions/_shared/email.ts`). Recipients prefill from the people on
  duty who have an address on file. Every send is logged to `email_logs` and to
  the module's audit table.

## 9. Adding or renaming a channel

1. Add the code to `DEFAULT_CHANNEL_CODES` in
   [`constants.ts`](../src/domain/night-allocation/constants.ts). Order there is
   board order.
2. Give it a colour pair in
   [`palette.ts`](../src/components/night-allocation/palette.ts) — without one it
   falls back to grey.
3. If it needs a qualification, add it to `RESTRICTED_CHANNELS` and give the
   qualification a column of its own on `profiles`, alongside `can_take_tso`.

Nothing else changes: the solver, the rules, the board, the exports and the API
all read the channel list. Nights saved before the change keep their own
channels and gain the new one, unticked configuration and all, on next load.

## 10. Tests

`npm test`. The module's own suites:

| File | Covers |
| --- | --- |
| `src/domain/night-allocation/__tests__/rules.test.ts` | Every hard rule, positive and negative, plus the staffing notices. |
| `.../solver.test.ts` | The classic 3-channel/4-person night, TSO with exactly two qualified people, part-night channels, several people per half, the duty-length preference, and refusals. |
| `.../editing.test.ts` | Linked handovers, delete-merge, split, channel re-fit. Uncovered minutes stay at zero after every accepted operation, and refused operations leave state untouched. |
| `.../fuzz.test.ts` | 250 random nights (5–14 people, 3–5 channels, random halves, TSO flags and close times). Every returned plan has zero uncovered minutes and zero hard-rule violations; every refusal carries an explanation; runtime stays inside budget. |
| `.../roster-text.test.ts` | The share formats. |
| `lib/nightAllocation/service.test.ts` | The API's payload coercion — clamping, truncation, caps — and that server-side validation catches what a hostile client would send. |
| `lib/nightAllocation/roster-rows.test.ts` | Reading the Google Sheet roster: unit spellings, name parsing, the half column, and rejecting working notes written in the name cell. |

## 11. Rollout

1. Run the migration. It creates the tables, adds `profiles.can_take_tso`
   (default `false`), and seeds the feature toggle as **on**.
2. Set `can_take_tso` for the people who may take TSO, in **Employee
   Management → Edit Employee**. Until at least two people on a night are
   flagged, the module will correctly refuse to plan continuous TSO cover and
   will say so.
   The shift roster must also be synced for the date — the tower units are
   where the crew comes from. A date with no night roster rows shows an empty
   list and the "add from the shift" picker.
3. The module can be switched off at any time in **Admin → System Settings →
   Modules**, which hides the page, the navigation entries and the dashboard
   cards for everyone. The setting lives in `app_settings` under
   `night_allocation.enabled`; a missing row means enabled.
4. To remove the module entirely, run [`sql/night_allocation_down.sql`](../sql/night_allocation_down.sql).
