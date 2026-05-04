# Shift Details Implementation Plan

## Goal

Add a `Shift Details` entry point on the supervisor daily availability chart so supervisors can open a dedicated details page with team tabs for `G`, `A`, `B`, `C`, `D`, and `E`. Each tab should show:

1. A member list with each member's rating shown beside the name.
2. A summary/details table for `Instructor`, `Trainees`, `SAR`, `WSO`, and `Highest Rating`.

This plan assumes the requested `G, A, B, C, D, E` set is the intended tab list. That is six tabs, even though the request mentions five.

## Existing Touchpoints

The current daily availability chart already has most of the source data needed for this feature:

- `src/pages/supervisor/SupervisorRosterView.tsx`
  - Existing daily availability page.
  - Already loads roster rows for the matrix.
  - Already loads schedule members from `employee_schedules` and joins `profiles` + `employee_training_records`.
  - Already contains category logic for `WSO`, `SAR TRAINED ATCOs`, `HIGHEST RATING`, and team/general duty classification.

- `src/App.tsx`
  - Existing route registration for `/supervisor/roster-view`.
  - New shift details page should be registered here.

- `src/hooks/useRosters.ts`
  - Defines the roster row shape used by the chart.

- `src/pages/supervisor/RatingsManagement.tsx`
  - Existing query shape for `highest_rating`, `rating_data`, trainee fields, and profile enrichment.

- `src/pages/supervisor/LicenseManagement.tsx`
  - Existing query shape for `ojti`, `examiner`, `instructor_validity`, and related training metadata.

- `src/hooks/useUsers.ts`
  - Confirms `profiles` already contain fields such as `employee_id`, `full_name`, `designation`, `current_shift`, `team_code`, and `unit_assignment`.

## Proposed UX

### 1. Entry point on Daily Availability Chart

Add a `Shift Details` button to the action area in `SupervisorRosterView` near the search/date controls.

Recommended behavior:

- The button navigates to a dedicated page, not a modal.
- Route proposal: `/supervisor/roster-view/shift-details`.
- Carry context through query params:
  - `date=YYYY-MM-DD`
  - `month=YYYY-MM`
  - optional `tab=G|A|B|C|D|E`

Reasoning:

- A full page is easier to scale because the tab content will grow.
- Query params make it possible to deep-link to a specific date/team later.

### 2. Shift Details page layout

Recommended page structure:

1. Header
2. Back button to Daily Availability Roster
3. Active date selector
4. Six team tabs: `G`, `A`, `B`, `C`, `D`, `E`
5. Inside each tab:
   - members section
   - summary table
   - expandable room for future tables or metrics

### 3. Tab content layout

For each tab:

1. `Members` section
   - card or list layout
   - show `employee name`
   - show `highest rating` as a badge beside the name
   - optionally show `designation` and `duty code`

2. `Shift Summary` table
   - initial columns or rows:
     - `Instructor`
     - `Trainees`
     - `SAR`
     - `WSO`
     - `Highest Rating`
   - use a compact table now, but design the data model so more metrics can be added later without changing the page shape

3. `Future extension zone`
   - reserve a second section for later additions such as endorsements, unit coverage, role mix, shortage flags, or instructor assignment details

## Data Strategy

## Core source to reuse

Do not build this feature from raw roster cells alone. Reuse the `scheduleMembers` approach from `SupervisorRosterView` because it already joins:

- `employee_schedules`
- `profiles`
- `employee_training_records`

This keeps counts on the new details page aligned with the existing daily availability chart.

## Recommended new data layer

Create a dedicated hook or data builder, for example:

- `src/hooks/useShiftDetails.ts`
or
- `src/lib/shiftDetails.ts`

Suggested responsibility:

1. Load schedule rows for a selected date.
2. Match schedule rows to profile rows by `employee_id` first, then by normalized name fallback.
3. Join training records for rating and trainee metadata.
4. Join instructor-related training metadata where needed.
5. Group resolved members by tab key `G|A|B|C|D|E`.
6. Build both:
   - member list payload
   - summary table payload

## Suggested resolved member shape

```ts
type ShiftDetailMember = {
  employeeId: string;
  name: string;
  designation: string | null;
  tabKey: "G" | "A" | "B" | "C" | "D" | "E";
  dutyDate: string;
  dutyCode: string | null;
  dutyDescription: string | null;
  highestRating: string | null;
  ratingSummary: Record<string, unknown> | null;
  traineeStatus: string | null;
  traineeUnit: string | null;
  currentShift: string | null;
  teamCode: string | null;
  unitAssignment: string | null;
  isInstructorQualified: boolean;
  isTrainee: boolean;
  isSarQualified: boolean;
  isWsoQualified: boolean;
};
```

## Classification rules

Use rules that are already present in the codebase where possible.

### Team tab assignment

Initial rule proposal:

- Use `profiles.current_shift` as the primary tab key because the current chart already uses it to identify team membership.
- Normalize `general` to `G`.
- Normalize `a/b/c/d/e` to uppercase.

Fallback:

- If `current_shift` is missing, fall back to `profiles.team_code`.

### Highest rating

Source:

- `employee_training_records.highest_rating`

### WSO

Reuse the same logic already used in `SupervisorRosterView`:

- `Boolean(rating_summary["WSO"])`

### SAR

Reuse the same logic already used in `SupervisorRosterView`:

- `Boolean(rating_summary["SAR"] || rating_summary["SAR & AIS"] || rating_summary["AIS"])`

### Trainee

Source:

- `employee_training_records.trainee_unit`
- `employee_training_records.trainee_status`
- existing fallback logic from `RatingsManagement`

Initial rule proposal:

- mark as trainee when trainee status exists and is not `training_completed`

### Instructor

This needs a stricter rule than the current page because the roster view does not classify instructor-qualified members yet.

Recommended initial implementation:

- use `employee_training_records.ojti`
- optionally include `employee_training_records.instructor_validity`

Initial boolean rule:

- `isInstructorQualified = Object.values(ojti || {}).some(Boolean)`

If the business definition of `Instructor` should mean something else, this rule should be changed before implementation.

## Summary Table Design

For each team tab, generate a compact dataset like:

```ts
type ShiftSummaryRow = {
  label: "Instructor" | "Trainees" | "SAR" | "WSO" | "Highest Rating";
  value: string;
};
```

Suggested first version:

- `Instructor`: count of instructor-qualified members
- `Trainees`: count of active trainees
- `SAR`: count of SAR-qualified members
- `WSO`: count of WSO-qualified members
- `Highest Rating`: best available rating present in that tab, plus optional member count by rating in a secondary tooltip or note

Alternative if you want richer output immediately:

- make the table one row per member with columns:
  - `Name`
  - `Highest Rating`
  - `Instructor`
  - `Trainee`
  - `SAR`
  - `WSO`

Recommendation:

- start with the compact summary table first
- keep the member list separate above it
- add the richer table only if the summary is not sufficient

## Implementation Phases

### Phase 1. Extract reusable data builder

1. Move or duplicate the `SummaryScheduleMember` fetch logic from `SupervisorRosterView` into a reusable hook/helper.
2. Extend the joined training data with trainee and instructor fields.
3. Normalize tab keys to `G|A|B|C|D|E`.
4. Return grouped tab payloads for the details page.

Deliverable:

- a reusable hook with stable output for one selected date

### Phase 2. Add navigation and route

1. Add lazy import for the new page in `src/App.tsx`.
2. Add protected route for `/supervisor/roster-view/shift-details`.
3. Add `Shift Details` button in `SupervisorRosterView`.
4. Pass selected date context into the route.

Deliverable:

- navigation from the chart page to the new page

### Phase 3. Build Shift Details page shell

1. Create `src/pages/supervisor/SupervisorShiftDetails.tsx`.
2. Add page header and back navigation.
3. Add a selected-date control.
4. Add six tabs using the existing UI tabs component.

Deliverable:

- working page shell with empty but wired tab panels

### Phase 4. Build members section

1. Render tab-specific member cards/list.
2. Show member name and highest rating badge.
3. Add designation or duty code as secondary text if useful.
4. Handle empty-state messaging per tab.

Deliverable:

- visible member list per team tab

### Phase 5. Build summary table

1. Derive summary metrics from grouped members.
2. Render the first summary table with:
   - Instructor
   - Trainees
   - SAR
   - WSO
   - Highest Rating
3. Keep the table config-driven so more metrics can be appended later.

Deliverable:

- first version of the shift-details summary table

### Phase 6. Polish and validation

1. Verify counts match the daily availability chart logic where categories overlap.
2. Verify hidden profiles are excluded.
3. Verify missing employee IDs still resolve through name matching fallback.
4. Verify mobile layout for the members list and tabs.
5. Add basic tests for grouping and classification helpers if the current test setup supports them.

Deliverable:

- production-ready first pass

## Recommended File Changes

### New files

- `src/pages/supervisor/SupervisorShiftDetails.tsx`
- `src/hooks/useShiftDetails.ts` or `src/lib/shiftDetails.ts`

### Updated files

- `src/App.tsx`
- `src/pages/supervisor/SupervisorRosterView.tsx`

## Acceptance Criteria

The first implementation should be considered complete when all of the following are true:

1. A `Shift Details` button exists on the Daily Availability Roster page.
2. Clicking it opens a dedicated supervisor page.
3. The page shows tabs for `G`, `A`, `B`, `C`, `D`, and `E`.
4. Each tab shows members with ratings beside their names.
5. Each tab shows a summary table for `Instructor`, `Trainees`, `SAR`, `WSO`, and `Highest Rating`.
6. The page uses the same underlying schedule/profile/training logic as the daily availability chart wherever possible.
7. Empty tabs do not break the layout and show a clear empty state.

## Open Questions Before Coding

1. The request says five tabs, but the listed tabs are `G, A, B, C, D, E`, which is six. The implementation should use six unless told otherwise.
2. Should the details page open for:
   - the currently selected date in the chart,
   - today,
   - or a user-chosen date on the details page?
3. Should `Instructor` mean:
   - OJTI/instructor-qualified staff,
   - the last proficiency instructor name stored in rating history,
   - or another business definition?
4. Should `Highest Rating` in the summary table be:
   - the best rating present in the tab,
   - a count by rating,
   - or both?
5. Should members be grouped only by team tab, or also subdivided inside each tab by shift code or unit?

## Recommended Next Step

Start with Phase 1 and Phase 2 together:

- extract a reusable details-data hook from the existing `SupervisorRosterView` data logic
- then wire the new route and button

That gives a stable foundation before building UI details.