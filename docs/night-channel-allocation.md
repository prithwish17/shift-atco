# Night Channel Allocation

A standalone module for the nightly position roster: who is on TWR, SMC-S,
SMC-N, CLD and TSO, minute by minute, from 13:30 to 01:30 the next day.

It **reads** the crew from the existing shift roster and **owns** everything
else — its own route, tables, rules, solver, board and exports. It writes
nothing back to the roster.

**There is no approval workflow.** Any signed-in employee on that night's shift
and the WSO have identical rights: view, set halves, choose starters, generate,
edit, save and share. The signed-in user is used only to identify "me" for the
self-service half buttons and to stamp who last saved. The one gate is the app's
own **account approval**: a self-registered account nobody has approved yet is
turned away by the API, exactly as the rest of the app turns it away at sign-in.

| Piece | Where |
| --- | --- |
| Rules, solver, editing, roster text | [`src/domain/night-allocation/`](../src/domain/night-allocation) |
| Page | [`src/pages/NightChannelAllocation.tsx`](../src/pages/NightChannelAllocation.tsx) |
| Board, panels, dialog, share sheet | [`src/components/night-allocation/`](../src/components/night-allocation) |
| API | [`api/night-allocation/[...route].ts`](../api/night-allocation) |
| Server helpers (seeding, save, mail) | [`lib/nightAllocation/`](../lib/nightAllocation) |
| Migration | [`supabase/migrations/20260920120000_night_channel_allocation.sql`](../supabase/migrations/20260920120000_night_channel_allocation.sql) |
| Down migration | [`sql/night_allocation_down.sql`](../sql/night_allocation_down.sql) |

Route: `/night-allocation?date=YYYY-MM-DD`, defaulting to the night in
progress — which until 01:30 is still the previous date's (`nightDateAt`). One
route for every role. A date that isn't a real calendar date (`2026-02-31`) is
refused by the API with `400` and ignored by the page.

Opening another night with unsaved changes asks first, and closing or reloading
the tab warns. Leaving through the app's own navigation does not — the app uses
a plain `BrowserRouter`, which cannot block a route change.

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

### Part-night availability

Someone can be on the crew for only part of the night. The times chip on each
crew row ("All night", "Away 17:30–19:30 +1", "Only 13:30–17:30") opens an
editor with three modes — **All night**, **Only between**, **Not between** —
and as many periods as needed (up to `MAX_AVAILABILITY_PERIODS`, 8).

Periods can be picked, tapped from shortcuts (13:30–17:30, 1st Half, 2nd
Half), or **typed the way the roster writes them**: `1730-1930, 2330-0130`,
`17:30 to 19:30`, `(2330-0130)`, `till 2130`, `after 2330`. A word in front
says which way round — `not`, `away`, `off`, `busy`, `leave`, `meeting` for
time away; `only`, `available`, `here` for time around — and `all night`
clears them. A time before 13:30 counts as 13:30 and one after 01:30 as 01:30
(`1200-1500` is away until 15:00); a range wholly outside the night is
refused. Times go onto the 15-minute grid in whichever direction never
promises more than was typed: time away only grows, time around only shrinks.
The parser is `parseAvailabilityText` in
[`availability.ts`](../src/domain/night-allocation/availability.ts).

The person carries what was entered (`{ mode, periods }`). Everything else
asks `availability.ts` for the stretches they are away and never reads the
periods itself, so "only" and "except" cannot be handled two different ways.
`available: false` still means the whole night off, whatever the periods say.

## DB slots

A DB slot reserves a position for training at a fixed time — TWR 17:30–19:30,
say. It asks for the **instructor**, because the instructor is the one actually
marked on the position then, and the shared roster shows their name with DB
beside it: `1730-1930 Rehan Ahmed (DB · Sulagna)`. The trainee's name is
optional free text (`DB_NOTE_MAX`, 40 characters).

It is stored as a duty held by the instructor with `kind: "db"`, so **every
hard rule applies to it exactly as to any duty**: the instructor must be
available and around then, cleared for TSO on TSO, in the right half, not on
two things at once, rested 30 minutes either side, and within the 30 min–2 h
bounds on a capped position. What makes it a slot is that nothing moves it as
a side effect:

- **The generator plans around it.** It is handed back untouched in every plan.
- **A board holding only DB slots is still unplanned** (`isPlanned`), so it is
  not reported as a night with every other stretch uncovered, and it can be
  saved ahead of the plan. It can't be shared or emailed until there is one.
- **Putting a slot down always applies once the slot itself is sound.** On a
  planned night, ordinary duties on the same position are cut back to make
  room with no gap; a clash left for the instructor elsewhere is reported, and
  the next generate plans around it. What is wrong with the slot on its own
  terms (`fixedDutyErrors`) stops it going down. Placing, moving and removing
  are in [`db-slots.ts`](../src/domain/night-allocation/db-slots.ts).
- **A slot at a position's opening opens it.** The Starts picker gives way to
  it, and the starter rules skip that position.
- **A slot leaving a stretch under 30 minutes** — a position opening at 17:15
  with a slot from 17:30 — makes the night impossible however many people there
  are, so it is named in the checks and the generator refuses with it.
- **The merge** is not reached for automatically when either CLD or its SMC has
  a slot in the merge window, and the manual switch refuses while CLD has one
  there.

## Blanks

A blank is a stretch of a position left with **nobody on it, on purpose**. It
is what **Leave blank** makes: the person comes off a duty — or off part of
one — and the stretch stays on the board, empty, instead of being handed to a
neighbour. It is stored as a duty with `kind: "blank"` and an empty
`person_key` (`BLANK_PERSON_KEY`), so it sits in the handover chain like any
duty and is drawn, saved, loaded and shared with the rest of the plan.

- **It is not a gap.** It covers its stretch for the continuity rule, so a
  night with a blank still saves and shares. That is the difference between a
  blank and a hole: a gap is something nobody decided, a blank is a decision.
- **It is never quiet about it.** Every blank is a line of its own at the top
  of the suggestions, the position's dot on the board turns amber, the Cover
  figure reads "1h 30m blank" instead of "Full", and every export names it
  `BLANK` — `1600-1800 BLANK` by position. It is left out by person, because
  nobody holds it.
- **No rule about people applies to it**, because nobody holds it. What is
  still checked is its place on the board: inside the night, on a position in
  use and open then, not where the position is merged away, and not on top of
  somebody's duty.
- **Tapping it opens the fill dialog**: put someone on all of it, or part of
  it — the rest stays blank — or give it to the duty next to it, which is how
  a blank is taken back off the board.
- **A generate replaces blanks** along with the duties: a fresh plan covers
  every stretch. **Clear board** takes them off too. DB slots stay in both.
- Blanks side by side on one position are one blank; a blank squeezed down to
  nothing by a handover goes.

## 3. The rules

Implemented once, in
[`rules.ts`](../src/domain/night-allocation/rules.ts), and imported by the
browser, by the API and by the tests. A client-side check and a server-side
validation therefore cannot disagree.

### Hard rules — these block saving

1. **Continuity.** Every in-use channel is covered with no gap from `open_at` to
   `close_at`. Relieved at 18:30 means the next person starts at exactly 18:30.
   A [blank](#blanks) covers its stretch: it was left empty on purpose.
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
   own inside the window a hard error. Only CLD may merge, and only into one of
   `MERGE_TARGET_CHANNELS` (`SMC`, `SMC-S`, `SMC-N`); any other pairing is a hard
   error and does not excuse CLD from cover. Unticking the SMC that CLD is
   merged into separates them again.
4. **Duty length.** 30 minutes minimum. 2 hours maximum on every position
   **except TSO**, which has no maximum — one person may hold it for as long as
   the night needs. See `UNCAPPED_DUTY_CHANNELS`; callers use `maxDutyFor()`
   rather than `MAX_DUTY_MIN`, or the rules and the solver disagree about TSO.
5. **Break.** At least 30 minutes between a person's duties, including across
   midnight — **except going onto or coming off TSO, which needs none**
   (`BREAK_EXEMPT_CHANNELS`, checked through `breakBetween()`). Relieved from
   TWR at 15:00, someone may take TSO from 15:00; relieved from TSO at 21:30,
   they may take SMC from 21:30. Between any two other positions the 30 minutes
   still apply, measured between those two duties — so TWR, then TSO, then SMC
   back to back is legal, because the TSO duty between them is itself at least
   30 minutes.
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
   or be a starter — and, for someone around for only part of the night, only
   inside the time they are around. A duty may end exactly when they leave and
   start exactly when they are back. A starter must be around at the opening
   minute, and someone in a half must be around for at least 30 minutes of it.
9. **Valid times.** `start < end`, both inside the night and inside the
   channel's open window.
10. **Once each.** Every person and every position appears once. The page cannot
    produce a duplicate, but a request can, and the database would refuse it
    with a bare constraint error.

### Preferences — advisory, never blocking

- **Blanks**, one line each and first in the list: "TWR 16:00–18:00 is left
  blank — nobody is on it." Allowed, but never unannounced.
- **The evening rest: 4 hours in a row off every position, starting between
  16:30 and 23:30** (`EVENING_REST_WINDOW`, `EVENING_REST_MIN`). TSO doesn't
  count (`EVENING_REST_EXEMPT_CHANNELS`): time on it neither counts as work nor
  breaks the rest. A DB slot counts as work. The rest may run on past 23:30,
  up to 01:30 — a rest held wholly inside 16:30–23:30 would always include
  19:30–20:30, so nobody on a position then could ever have one — and a break
  that began before 16:30 counts from 16:30. So a 2nd Half person, off
  17:30–21:30, has it by construction, and so does a 1st Half person, off from
  21:30. Everyone who doesn't is named in one line with their longest break —
  "Not met for Asha Rao (longest 2h 30m, 19:00–21:30)" — and marked with an
  amber dot on the by-person board. `eveningRestShortfalls` in
  [`rules.ts`](../src/domain/night-allocation/rules.ts).
- **Duty length: 1h, 1h 30m or 2h.** Anything else of an hour or more is fine;
  under an hour is the last resort (`PREFERRED_DUTY_LENGTHS`,
  `PREFERRED_MIN_DUTY_MIN`, ranked by `dutyLengthRank`). Every duty under an
  hour is named in one suggestion, except on a position open for less than an
  hour, which can do no better, and a DB slot, whose length was fixed.
- The 2nd Half person on CLD from 21:30, and CLD as an earlier relieving duty
  for 2nd Half people where possible.
- Each channel's chosen starter actually holding it at its opening minute.
- Even workload inside each group (1st Half, 2nd Half, no half).
- **Staffing feasibility notices**, which explain *why* a continuous plan may be
  impossible. Computed per window (13:30–17:30, 17:30–21:30, 21:30–01:30) from
  the people who can work it, the channel-minutes open in it, and the ceiling
  that one person can be on duty for at most 120 of every 150 minutes.
  **Uncapped positions are counted separately** — that ceiling exists because of
  the two-hour cap. TSO's minutes are added on top, less whatever of them can
  be worked in the breaks between control duties: TSO needs no break either
  side, so someone cleared for it can spend those 30 minutes on TSO instead of
  resting. That saving is capped by the breaks there are and by the share of
  them the people cleared for TSO take (a fifth of their time), so with only
  one person cleared, TSO still ties one person up for the window. Four people
  all cleared for TSO can therefore cover TWR, SMC-S, CLD and TSO all night;
  four with only two cleared cannot, and the notice says five are needed. The
  TSO-specific check asks only whether anyone
  qualified is free at all, and in the 2nd Half the 1st Half's qualified people
  count, because TSO is the position the halves may be crossed for. Someone
  around for less than 30 minutes of a window doesn't count towards it.
- **Shortfalls the entered times cause**, checked on every 15-minute slot:
  fewer people around than positions open, or nobody cleared for TSO around,
  where there would be enough with everyone there all night. These name who is
  away — "17:30–19:30: 2 people are around for 3 open positions — Asha Rao is
  away then" — which the window bound cannot.
- **Stretches too short for any duty** that a DB slot or the merge leaves.

## 4. The solver

[`solver.ts`](../src/domain/night-allocation/solver.ts) — deterministic, with
seeded randomised restarts. It returns a **fully continuous** allocation or
nothing. It never emits a plan with a gap, and it never modifies the board it
was given: a refusal leaves the existing duties untouched.

**Shape of the search.** A handover search: repeatedly take the channel whose
cover ends earliest, choose (person, end time) for the next duty, and backtrack
on failure.

**Stretches.** The search models a channel as one continuous window, so a
position is handed to it as the stretches ordinary duties must cover
(`stretchesToPlan`): its open window less the merge window and less its DB
slots. Each stretch is planned as the position it belongs to — the stretch of
TSO after a slot is still TSO, qualification, uncapped length and all — and a
stretch too short for any duty is kept, so the search fails on it rather than
returning a plan with a hole where it was. The chosen starter opens the first
stretch only when it starts at the opening.

**DB slots and time away.** A person is offered a duty only if they are around
for all of it and a full break clear of their own DB slots; the slots count
towards their workload and their half from the start, and they are handed back
untouched in the plan. The pools behind the staggering and the pruning count
only the people around at that minute.

**Staggering.** With `k` open channels and a pool of `n` people, handovers every
`I` minutes give duties of `k × I` and breaks of `(n − k) × I`. `I` is picked on
the 15-minute grid so the duty length stays inside 30 min–2 h, the break stays
at or above 30 minutes, and the duty length lands as close as possible to the
night's preferred length (Auto ≈ 1 h 30 m, fitted to staffing). This is what
makes the classic case come out right: *3 channels, 4 people → 1 h 30 m duties,
channels relieved 30 minutes apart, each relieved person resting 30 minutes then
taking the next channel.*

**Duty lengths.** The first attempt allows nothing under an hour, except where
a position has less than an hour left to cover, and never leaves such a stub.
Only if that attempt finds no plan does the next allow 30 and 45 minutes — and
even then they are tried last at every step. That attempt comes before the TSO
crossover and the merge: short duties are acceptable when unavoidable, the
other two are last resorts. Among lengths of an hour or more, Auto prefers 1h,
1h 30m and 2h over 1h 15m and 1h 45m; a usual length someone chose outranks
that, and a usual length under an hour skips the all-long attempt entirely.
When short duties were needed the result says so.

**Ordering heuristics.** The chosen starter first at a channel's opening minute;
people who must open another channel shortly held back; people whose half still
lacks a duty prioritised inside their half; then longest-rested, then
least-worked, then avoid the same channel twice running. TSO-qualified people
are kept free for TSO when few are qualified.

**Pruning.** At every pending handover the number of free, eligible, rested
people must cover the channels falling due within the next 30 minutes, and TSO
must always have a qualified, rested person available at its own handover.

**The evening rest.** Tried first, before anything else is given up: the
generator places each owed person's 4-hour rest up front (`planEveningRests`)
and the search keeps them off every position but TSO for it, exactly as it
does for time away — they may still take TSO while resting. People in a half
are owed nothing, and neither is anyone away for 4 hours of the evening;
someone whose DB slots leave no room for one is left alone. The rests are
placed one at a time, the most constrained person first, where the crew can
best spare them — the stretch whose thinnest moment still has the most people
over what the open positions need to keep turning at the usual duty length
(`k(L + 30)/L` people for `k` positions and duties of `L`; 2 hours on Auto) —
so they stagger instead of all starting at 16:30. A rest is only placed where
it leaves enough people, so on a thin night some people get one and some
don't. Restarts place them afresh. If no plan keeps the rests, the night is
planned exactly as before, and the note says how many people couldn't be
given one. It is given up before short duties, the TSO crossover and the
merge, and it never stretches a usual length someone chose.

**Straight onto and off TSO.** It is the rule, not a relaxation, but letting the
search use it (`tsoWithoutBreak`) widens the search a lot, and on a big night
the wider search finds a plan less often inside its node budget. So each duty
length is tried first with a real break after every duty — exactly the search
there was before TSO needed none, so every night that planned then still plans
the same way, and everyone gets a real rest where staffing allows — and then
the same length with TSO taken straight onto and off. On a night with no TSO
open the two are the same search, and it runs once. In the wider search nobody
is handed TSO straight back from themselves, and when everyone would otherwise
be busy the rhythm is set by the control positions alone, with TSO turns as
the rest between them.

**Budget.** ~1.5 s of restarts, or ~0.5 s when the staffing check already says
the night is impossible. It runs **server-side**, so a long search never blocks
the board; the button shows a busy state. The budget is **shared between the
attempts** (`restartBudgets`), in proportion to their weights: the all-long
night and the night with short duties allowed weigh 2 each with a real break
after every duty, 1 each with TSO taken straight onto and off, and the TSO
crossover, the merge and both together weigh 1, so each gets randomised
restarts of its own rather than only two fixed passes.

**On failure** it returns `{ ok: false, error, reasons }`, where `reasons` are
the staffing notices when there are any, or a hint to change a starter, an open
time, or a half. Some settings are refused before any search: a DB slot that
breaks a rule on its own (the reasons list what), a stretch too short for a
duty, a starter who is away at the opening, and someone in a half they are
away for.

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
- Only what an edit **introduces** refuses it. A problem a touched duty already
  had, unchanged, is shown in the dialog as "already a problem" but does not
  block the edit — otherwise two broken duties side by side (two people who
  called in sick, back to back) could each only be fixed after the other. A
  neighbouring duty is part of an edit only when its handover time moves.
- **Leave blank** takes the person off the duty and keeps the stretch on the
  board with nobody on it — see [Blanks](#blanks). **Leave part of it blank**
  does the same for a stretch inside the duty; the person keeps what is left
  either side, which has to be a duty in its own right (30 minutes at least).
  Nothing is handed to a neighbour. It is refused when it would break a rule —
  leaving someone in a half with no duty in it, say (`leaveBlank`).
- **Fill** a blank from its own dialog: someone on all of it, or on part of
  it, and the rest stays blank (`fillBlank`). A new duty added over a blank
  fills it the same way.
- **Move to another position** by changing the duty's position in the editor
  (`isMove`). The stretch it leaves is left blank, and on the new position it
  takes its stretch outright: whoever is there then is cut back to either side
  of it, and keeps the rest. The dialog says who before Move is pressed
  (`describeMove`). A DB slot is never cut back for it.
- **Swap** exchanges the people on two duties — whoever is on another position
  while this duty runs — each taking the other's times (`swapPeople`). A swap
  with a blank moves the person there and leaves their own stretch blank.
  Every swap on offer is tried first, and one that would break a rule is shown
  with the reason instead of being offered.
- **Delete** hands the freed time to the previous duty (or to the next one if
  the deleted duty was the first) — never to a blank or a DB slot — and is
  refused when that would break a rule; the refusal points at Leave blank. On a
  blank it gives the blank's time to the duty beside it.
- **Split** ends the duty at a chosen time and gives the remainder to someone
  else, with no gap.
- A blank beside a duty is part of the handover chain: shortening the duty
  grows the blank, lengthening it fills it.
- The editor shows what an edit would cost in **preferences** too — "Asha Rao
  would have no 4h break starting between 16:30 and 23:30" — without refusing
  it, and the person picker says who is already on another position then.
- **Clear board**, above the board, takes every duty and blank off it at once — two taps,
  like Reset, and the second only counts while the board is unchanged since
  the first. It clears the plan and nothing else: the crew, halves, times,
  channel settings, starters, the merge and DB slots all stay, where Reset
  seeds the whole night afresh from the roster. The saved night is untouched
  until the next save (`clearBoard` in
  [`stateActions.ts`](../src/components/night-allocation/stateActions.ts)).
- Changing a channel's open or close time re-fits its first and last duty to the
  new boundaries and drops duties entirely outside it. A blank is never
  stretched to new hours: nobody decided to leave them empty.
- The first duty's start and the last duty's end are pinned to the channel's
  open and close times.
- **DB slots don't move.** A linked handover that would drag one is refused
  (and the dialog pins that end); a delete beside one hands the time to the
  other neighbour; a slot is never split; a channel re-fit never stretches one,
  only cuts it where the new hours cut into it, or drops it when it falls
  outside them. Tapping a slot on the board opens the DB dialog, not the duty
  editor.

## 6. Data model

| Table | Holds |
| --- | --- |
| `night_allocations` | One row per night: `night_date`, `duty_length_pref`, `status`, `version`, who saved it and when. |
| `night_allocation_channels` | Per night: `in_use`, `open_at`, `close_at`, `starter_key`. |
| `night_allocation_people` | Per night: availability, half, a **snapshot** of `can_take_tso`, and `role` — which carries the roster unit (`TWR`, `SMC-N & SMC-S`) for seeded people and the designation for anyone added by hand. `availability` (JSONB) holds part-night times as entered, `{"mode": "only" \| "except", "periods": [[start, end], …]}` in minutes from 13:30; NULL is the whole night. |
| `night_allocation_duties` | `channel_code`, `person_key`, `start_min`, `end_min`, and `kind` — `'duty'`; `'db'` for a DB slot, whose `person_key` is the instructor and whose `note` is the trainee; or `'blank'` for a stretch left with nobody on it, whose `person_key` is empty. |
| `night_allocation_audit` | One row per save, generate, reset, share and email, with the acting user. |

`profiles.can_take_tso` is the person-level attribute, edited in **Employee
Management** and snapshotted per night so a historical roster stays accurate
after someone's qualification changes.

**`person_key`, not `user_id`.** Duties reference a `person_key`: the profile id
where the roster line matched a profile, `name:<normalised name>` where it did
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

Every route requires a signed-in, **approved** account — the same
`get_user_role` check the app's sign-in uses — and answers `403` otherwise.
Beyond that, **no role check anywhere**: every approved role has the same rights.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/night-allocation/:date` | Full state: people, channels, duties, version, who saved it, and `rosterStatus`. Seeds from the shift roster when nothing is saved — and does **not** persist that seed, so opening a date never creates a row. |
| `PUT` | `/api/night-allocation/:date` | Save. Body carries `version`. |
| `POST` | `/api/night-allocation/:date/generate` | Run the solver on the submitted settings. Persists nothing. |
| `POST` | `/api/night-allocation/:date/validate` | `{ errors, warnings }` for a candidate state. |
| `POST` | `/api/night-allocation/:date/reset` | The night seeded afresh from the shift roster. On a night that has been saved, the fresh night is **saved in its place**, so everyone sees the reset. Body carries the `version` the page was showing. |
| `GET` | `/api/night-allocation/:date/shift` | Everyone on the night roster, whatever their unit — the pool behind "add someone from the shift". |
| `GET` | `/api/night-allocation/:date/export.txt` | The saved roster as WhatsApp-friendly plain text. |
| `POST` | `/api/night-allocation/:date/email` | Send the saved roster. |

- **`PUT` re-runs the full hard-rule validation** and rejects with `422` and the
  list of violations. The client is never trusted.
- **Reset replaces a saved night.** Pressed twice, like everything destructive
  here, it seeds the night afresh from the roster and, when the night has been
  saved, saves the fresh night as a new version — Reset used to change only the
  page it was pressed on, and the old allocation came back on the next load.
  It carries the same version check as a save: a reset of a night someone else
  has saved since is a `409` with their version, and nothing is written. A
  night nobody has saved is only seeded (opening a date never creates a row),
  and a fresh night the rules refuse — a roster with nobody on a tower
  position leaves no channel in use — comes back as a working copy with the
  reason instead of being written. A request with no `version` (a page loaded
  before this change) gets the old working-copy reset.
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
and only once the night has duties and no hard errors — sharing a roster with an
uncovered position, or with nobody on it, sends the shift the wrong plan.
Sharing changes nothing except an audit row, and anyone who can see the night
can do it. The rules for what is offered live in
[`shareGate.ts`](../src/components/night-allocation/shareGate.ts).

Every format leads the same way: **title, then a sub-header naming the team and
the shift** (`Team A · Night`, derived from `rosters.team` rather than stored),
then the date and window, then **who is in each half**, and then **both
rosters** — by position and by person. A DB slot reads as the instructor's
line with DB and the trainee beside it — `1730-1930 Rehan Ahmed (DB · Sulagna)`
by position, `1730-1930 TWR (DB · Sulagna)` by person — and is drawn dashed in
the image, as on the board. A blank reads `BLANK` by position —
`1600-1800 BLANK` — is drawn in the image's red BLANK row, and is
listed in the short WhatsApp summary too ("Left BLANK: TWR 1600-1800"); the
share sheet says a night with blanks will go out with them. The halves come first because they are
what a reader checks first; both rosters are included because a supervisor reads
down the positions and everyone else looks for their own name.

Every artefact is attributed to **Atcora**, not to whoever pressed Save. The
roster is the unit's; who saved it is on the page and in the audit trail.

- **Plain text** is rendered **server-side** from the saved night, so everyone
  shares the same artefact. It uses WhatsApp's `*bold*` markup and falls back to
  a summary plus a link when a full roster would be too long for one message.
- **PNG** — the image downloaded and sent with WhatsApp and email — is a
  **grid, the way a duty sheet reads: positions across the top, people down the
  side**, and in each cell the times that person holds that position, coloured
  by position. Each row ends with the person's total; their half is under
  their name; a DB slot is outlined dashed with its trainee; the SMC duty that
  holds CLD during the merge is marked `+CLD`, and both positions' headings say
  so. Blanks get a red row of their own at the bottom. The cells come from
  `buildRosterGrid` in
  [`roster-text.ts`](../src/domain/night-allocation/roster-text.ts); the
  drawing is in [`exports.ts`](../src/components/night-allocation/exports.ts).
  It is drawn on a canvas from the same numbers the board renders from, so it
  looks the same whatever the sender's screen, theme or scroll position, and
  every piece of text is **cut to the box it belongs in** — an unclipped
  `fillText` runs off the canvas, which is how the last duty of the night once
  exported as a half-drawn employee number.
- **WhatsApp** uses `navigator.share({ files })` where the browser supports it,
  which sends the text and the image together. Otherwise it opens
  `https://wa.me/?text=…` and downloads the image to attach by hand. No Business
  API, no phone numbers in the code.
- **Email** goes out server-side through the mail providers the app already has
  (Brevo first, Resend as failover, mirroring
  `supabase/functions/_shared/email.ts`). Recipients prefill from the people on
  duty who have an address on file, and **must** be the address of an account
  (`profiles.email`): the mail goes out from the station's address, so the route
  refuses to send it anywhere else. Attachments must be the page's own PDF or
  PNG — recognised by their leading bytes, one of each at most — and are renamed
  by the server; the browser's filename is never used. Every send is logged to
  `email_logs` and to the module's audit table.
- Email is offered only for a **saved night with no unsaved changes**: its body
  is rendered on the server from the saved night, but its attachments are drawn
  in the browser from the board on screen, and the two must agree. Attachments
  are capped at `MAX_EMAIL_ATTACHMENT_BYTES` (3 MB) — checked in the browser
  before upload and again on the server — because Vercel refuses a request body
  over 4.5 MB before the function runs, and base64 adds a third.

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
| `.../solver.test.ts` | Four people cleared for TSO covering three control positions and TSO by using TSO as the break; a night with enough people still getting a real break after every duty. The classic 3-channel/4-person night, TSO with exactly two qualified people, part-night channels, several people per half, the duty-length preference, preferred lengths (1h or more wherever possible, short duties only when nothing else works), and refusals. |
| `.../editing.test.ts` | Linked handovers, delete-merge, split, channel re-fit. Uncovered minutes stay at zero after every accepted operation, refused operations leave state untouched, and one of two already-broken duties can be fixed without the other blocking it. |
| `.../fuzz.test.ts` | 250 random nights (5–14 people, 3–5 channels, random halves, TSO flags and close times). Every returned plan has zero uncovered minutes and zero hard-rule violations; every refusal carries an explanation; runtime stays inside budget. Then 150 more with random part-night times and DB slots, where every plan also hands the slots back untouched. Then random manual edits of every kind on generated plans — leave blank, fill, move, swap, change the person, delete — where every accepted edit leaves no gap and no broken rule, and every refusal says why. |
| `.../manual-edits.test.ts` | Blanks in the rules (covered, listed first, never anybody's, still kept to their place on the board); leaving a duty or part of one blank; filling a blank whole or in part; moving a duty to another position; swapping, including with a blank; blanks beside the handover chain; preferences reported while editing. |
| `.../evening-rest.test.ts` | The 4-hour evening rest: met by both halves, missed by 30-minute breaks all evening, TSO ignored, a break before 16:30 counted from 16:30, DB slots counted. The generator keeping it where the crew can spare people, giving it to as many as it can on a thin night, staggering the rests, letting a resting person take TSO, and replacing blanks. |
| `.../roster-text.test.ts` | The share formats, and the image's grid: which times land in which person's row and position's column, DB slots, the merge, partial positions and the blank row. |
| `lib/nightAllocation/service.test.ts` | The API's payload coercion — clamping, truncation, caps — and that server-side validation catches what a hostile client would send. A blank arrives and is written with nobody on it, whatever key came with it. |
| `lib/nightAllocation/roster-rows.test.ts` | Reading the Google Sheet roster: unit spellings, name parsing, the half column, and rejecting working notes written in the name cell. |
| `lib/nightAllocation/access.test.ts` | The route itself with the database stubbed: unapproved accounts are refused on every route, and email goes only to account holders with vetted attachments. |
| `lib/nightAllocation/reset.test.ts` | Reset through the route: it saves the fresh night over a saved one against the page's version, refuses with a `409` when someone saved since, only seeds a night nobody has saved, and never writes a fresh night the rules refuse. |
| `lib/nightAllocation/emailPayload.test.ts` | Recipient and attachment vetting for the email route. |
| `lib/nightAllocation/load-state.test.ts` | Reading a night against an in-memory Supabase: the roster is read once, profiles are paged past the 1,000-row cap, and positions come back in board order. |
| `src/domain/night-allocation/__tests__/time.test.ts` | Which night a moment belongs to, across midnight, month and year ends; real calendar dates. |
| `src/domain/night-allocation/__tests__/availability.test.ts` | Part-night times: "only" and "except", the minute someone leaves and returns, tidying what arrives, and the quick-entry parser — ranges, open ends, words, times outside the night, rounding the safe way. |
| `src/domain/night-allocation/__tests__/db-slots.test.ts` | Placing, moving and removing DB slots: what refuses one, cutting the plan back with no gap, clashes that don't refuse, the trainee note. |
| `src/components/night-allocation/__tests__/shareGate.test.ts` | What the share sheet offers for empty, broken, unsaved and saved nights, and what it says about a night with blanks. |
| `src/components/night-allocation/__tests__/stateActions.test.ts` | Page actions: unticking a merge target clears the merge, and the merge switch can always turn a stale merge off. Clearing the board takes the duties and blanks and leaves DB slots and every setting as they were. |

## 11. Rollout

1. Run the migrations. The first creates the tables, adds
   `profiles.can_take_tso` (default `false`), and seeds the feature toggle as
   **on**. `20260925120000_night_allocation_db_slots_and_availability.sql` adds
   the DB-slot and availability columns and the save function that writes
   them — **run it before deploying the code that reads them**, or every saved
   night fails to load. `20260926120000_night_allocation_blanks.sql` lets
   `kind` be `'blank'` — **run it before deploying the code that saves
   blanks**, or saving a night with a blank in it is refused by the old
   constraint.
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
