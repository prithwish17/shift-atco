

# Plan: Extend Roster and License Features

## What Already Exists (No Changes Needed)
- **Supabase `rosters` table** with the exact schema and unique constraint requested -- already created
- **Edge function `fetch-roster`** that calls the Google Apps Script URL, validates auth, and upserts into Supabase -- already deployed
- **`useRosters` hook** with `useFetchRoster` mutation and `useRosters` query with team/shift/search filters -- already built
- **Roster Management page** (`WsoRosterManagement.tsx`) with team/shift selectors, "Fetch Latest" button, search, and data table -- already built
- **`employee_licenses` table** in Supabase with RLS policies -- already exists
- **`useLicenses` hook** with CRUD operations -- already built
- **License display** in Employee Profile page (Licenses tab) -- already built
- **All dashboards** already use real Supabase data (mock data was previously removed)

## What Needs to Be Added

### 1. "My Duty Today" Widget on Employee Dashboard
Add a card to `EmployeeDashboard.tsx` that queries the `rosters` table where `employee_name` matches the logged-in user's `full_name`. Shows today's assignment (unit, position, team, shift) plus the previous 3 days and next 3 days of roster entries.

**File:** `src/pages/employee/EmployeeDashboard.tsx`

### 2. Roster Lookup on Supervisor Dashboard
Add a search bar on `SupervisorDashboard.tsx` that lets supervisors search by employee name and view their roster assignments for a selected date.

**File:** `src/pages/supervisor/SupervisorDashboard.tsx`

### 3. Make Daily Roster Accessible to All Roles (Not Just WSO)
Currently the roster page is only accessible at `/wso/roster` for WSOs. Add a shared route like `/roster` accessible to all authenticated users (read-only view), and add navigation links for employees and supervisors.

**Files:** `src/App.tsx`, `src/components/AppSidebar.tsx`

### 4. CSV Bulk License Import
Add a CSV upload feature for supervisors and admins to bulk-import license records into `employee_licenses`. Includes drag-and-drop upload, row preview, validation, and duplicate skip.

**File:** `src/pages/supervisor/EmployeeManagement.tsx` (add import dialog)
**File:** `src/components/LicenseCSVImport.tsx` (new component)

### 5. License Status Badges with Expiry Logic
Update the license display in `EmployeeProfile.tsx` to show dynamic status badges:
- **Expired** (red) if `expiry_date < today`
- **Warning** (amber) if expiry within 30 days
- **Valid** (green) otherwise

**File:** `src/pages/employee/EmployeeProfile.tsx`

### 6. Auto-Refresh After Roster Sync
After a successful `useFetchRoster` call, automatically invalidate the `rosters` query key (already done in the hook) and also invalidate the new "my-roster" query so the employee's "My Duty Today" widget updates instantly.

**File:** `src/hooks/useRosters.ts` (minor update to invalidation)

## Technical Details

### My Duty Today Query
```typescript
// Query rosters where employee_name matches user's full_name
supabase.from("rosters").select("*")
  .eq("employee_name", profile.full_name)
  .order("date", { ascending: false })
  .limit(7)
```
The match uses `employee_name` from the rosters table against `full_name` from the profiles table. This assumes names match exactly between the Google Sheet and the user profiles.

### License CSV Format
Expected columns: `employee_id, license_name, license_number, issue_date, expiry_date, notes`
- `employee_id` maps to a user via the `profiles` table
- `license_name` maps to the `license_type` enum
- Duplicates detected by matching `user_id + license_type`

### Route Changes
| Route | Component | Access |
|---|---|---|
| `/roster` (new) | `WsoRosterManagement` (reused, read-only mode) | All authenticated |

### Navigation Updates
- Employee sidebar: Add "Daily Roster" linking to `/roster`
- Supervisor sidebar: Add "Daily Roster" linking to `/roster`

## Files to Create/Modify

| File | Action |
|---|---|
| `src/pages/employee/EmployeeDashboard.tsx` | Add "My Duty Today" widget using rosters data |
| `src/pages/supervisor/SupervisorDashboard.tsx` | Add employee roster search |
| `src/pages/employee/EmployeeProfile.tsx` | Add expiry-based license status badges |
| `src/components/LicenseCSVImport.tsx` | Create CSV import component |
| `src/pages/supervisor/EmployeeManagement.tsx` | Add CSV import button/dialog |
| `src/App.tsx` | Add `/roster` route for all roles |
| `src/components/AppSidebar.tsx` | Add "Daily Roster" nav items |
| `src/hooks/useRosters.ts` | Add `useMyRoster` hook for employee duty lookup |

No database changes needed -- all required tables and policies already exist.
