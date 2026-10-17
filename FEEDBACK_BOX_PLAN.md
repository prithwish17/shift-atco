# Feedback box: plan

Status: plan only. Nothing has been built yet.

## Goal

Put a line at the bottom of every signed-in page that says:

> Found an error or have a suggestion? **Tell us**

Clicking it opens a box where the user can send an error report, a suggestion or a grievance. Admins read and resolve the submissions on one inbox page.

## Decisions to confirm before building

1. **Anonymity.** The default in this plan is that "Submit anonymously" stores no user id (`submitted_by = NULL`). An anonymous sender cannot track the status of what they sent.
   - Supabase API logs still record which signed-in user made the request. They are kept for about 1 day on Free and 7 days on Pro. The app cannot remove that trace, so the UI says "your name is not stored with this submission" and does **not** say "fully anonymous".
2. **Who reads grievances.** The default is admins only. Supervisors don't see them, because a grievance may be about a supervisor.
3. **Attachments.** Not in v1, which is text only. A screenshot upload to Storage can be added later.

## 1. Database: one migration

New file: `supabase/migrations/2026101800000_feedback_items.sql`.

```sql
CREATE TABLE public.feedback_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('error','suggestion','grievance')),
  body            text NOT NULL CHECK (char_length(body) BETWEEN 5 AND 4000),
  page_path       text,              -- route the user was on, e.g. /employee/leave
  page_title      text,
  app_version     text,
  user_agent      text,
  is_anonymous    boolean NOT NULL DEFAULT false,
  submitted_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_review','resolved','dismissed')),
  admin_note      text,
  resolved_by     uuid REFERENCES auth.users(id),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_anonymous OR submitted_by IS NULL)
);

CREATE INDEX idx_feedback_status_created ON public.feedback_items (status, created_at DESC);
CREATE INDEX idx_feedback_submitted_by   ON public.feedback_items (submitted_by) WHERE submitted_by IS NOT NULL;
```

**RLS** (`has_role` and `get_user_role` already check `approved = TRUE`, which closes the gap where unapproved users could otherwise get in):
- **INSERT:** allowed when `get_user_role(auth.uid()) IS NOT NULL` AND (`submitted_by = auth.uid()` OR (`is_anonymous` AND `submitted_by IS NULL`)) AND `status = 'open'`.
- **SELECT:** a user can read their own rows (`submitted_by = auth.uid()`); admins can read every row (`has_role(auth.uid(),'admin')`).
- **UPDATE:** admins only. Users cannot edit or delete after submitting.
- **DELETE:** no policy, so deleting is not allowed.

**Triggers:**
- `updated_at` is set on every update.
- **Rate limit:** a `BEFORE INSERT` trigger rejects a 6th named submission from the same user within 24 hours. Anonymous rows can't be counted per user, so the limit doesn't apply to them; the org is small enough for that to be acceptable.
- **Notify admins:** an `AFTER INSERT` trigger (SECURITY DEFINER) inserts one `public.notifications` row per approved admin:
  - `category = 'feedback'`
  - `title` such as "New suggestion"
  - `metadata` holding `{feedback_id, kind}`

  The admins then see it in the existing bell (`NotificationDropdown`).

**Grants:** run `REVOKE EXECUTE ... FROM anon, authenticated` by name on the trigger functions. `FROM PUBLIC` isn't enough.

**Apply:**
1. Test the migration in a throwaway local PG16 (the recipe is in memory).
2. Paste it into the Supabase SQL editor. Do **not** use `supabase db push`.
3. Add the table to `src/integrations/supabase/types.ts`, or follow the existing `as any` pattern, since the types file is stale.

## 2. Frontend

| File | Change |
|---|---|
| `src/components/feedback/FeedbackFooterLink.tsx` | **New.** Shows the small muted line of text. The "Tell us" link opens the dialog. |
| `src/components/feedback/FeedbackDialog.tsx` | **New.** A shadcn `Dialog` containing:<br>• type choice: `RadioGroup` or `Select` (Error / Suggestion / Grievance)<br>• a `Textarea` with a character counter<br>• an "Don't store my name" `Checkbox`<br>• a Submit button<br>Uses React Hook Form + Zod. It captures `location.pathname`, `document.title`, the build version and `navigator.userAgent` automatically, and shows a success toast. |
| `src/hooks/useFeedback.ts` | **New.** TanStack Query hooks:<br>• `useSubmitFeedback` (insert)<br>• `useMyFeedback` (the user's own rows)<br>• `useFeedbackInbox({status, kind, page})` (paginated with `.range()`, 25 per page)<br>• `useUpdateFeedback` (admin changes status or note) |
| `src/components/DashboardLayout.tsx` | Render `<FeedbackFooterLink />` after `{children}` inside `<main>`, so it appears on all 67 pages that use this layout. The existing `pb-28` keeps it clear of the mobile bottom nav. |
| `src/pages/admin/FeedbackInbox.tsx` | **New.** Admin page:<br>• filter tabs for status and type<br>• a list showing type badge, page, date, and the sender (or "Anonymous")<br>• a detail drawer for changing the status and adding a note |
| `src/App.tsx` | Add the route `/admin/feedback` wrapped in `ProtectedRoute allowedRoles={['admin']}`. |
| `AppSidebar` (admin section) | Add a "Feedback" nav item, optionally with a count of open items. |
| *(optional)* `src/pages/employee/MyFeedback.tsx` | The user's own named submissions and their status. It could be linked from the dialog ("View my past submissions"). Can wait until v2. |

**Not covered:** Login, Register, Forgot/Reset Password and NotFound don't use `DashboardLayout`, so they won't get the link. That's intended, because those users aren't signed in.

## 3. Load

- One insert of about 1–2 KB per submission, plus one notification row per admin.
- The admin inbox is an indexed, paginated read. There's no realtime subscription.
- No new file under `api/`, so the count stays below the Vercel Hobby cap of 12 functions.

## 4. Verification

1. Run the migration on local PG16:
   - an employee can insert a named row and an anonymous row
   - an employee cannot read other users' rows
   - an unapproved user is rejected
   - the 6th named insert within 24 hours is rejected
   - admins get notification rows
2. Type-check with `npx tsc --noEmit -p tsconfig.app.json` and lint, then compare the error counts with the baseline.
3. In the browser on the :8080 dev server, which uses **live** Supabase:
   - check the link renders on an employee, a WSO, a supervisor and an admin page
   - check that on mobile width it isn't hidden by the bottom nav
   - check that the dialog opens and validates input
   - **don't press Submit against live data unless you approve it**, or use a test account and delete the row afterwards
4. `npm run build`.

## 5. Order of work

1. Confirm the three decisions above.
2. Write the migration and test it locally.
3. You apply it in the SQL editor.
4. Build the dialog, the footer link and the hooks, and wire them into `DashboardLayout`.
5. Build the admin inbox, its route and the sidebar item.
6. Verify, then commit only when you say so.
