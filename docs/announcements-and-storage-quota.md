# Announcements and the R2 storage quota

## Announcements

Supervisors and admins post short notices that appear at the top of the employee dashboard (`/employee`). They manage them on `/announcements`. The page is in the sidebar for both roles.

| Rule | Value | Enforced in |
|---|---|---|
| Title | 1–100 characters | DB check + form counter |
| Text | 1–500 characters | DB check + form counter |
| Runs for | 1, 3, 7, 14 or 30 days, or a date up to 30 days after the start | form; DB allows up to 31 days |
| Start | now, or a scheduled date and time | form |
| Priority | Info, Important, Urgent. Urgent shows first. | DB check |
| On the dashboard | at most 3 shown, the rest behind "View all". Text over 3 lines collapses with Show more / Show less. | `AnnouncementBanner` |
| Who edits | admins: any announcement. Supervisors: only their own. | RLS |
| Attachment | admins only. One PDF, JPG, PNG or WebP file up to 4 MB, stored privately in R2. | API role check + trigger |

- **Expiry** needs no job. An announcement is shown while `starts_at <= now() < expires_at` and `ended_at` is null.
- **End now** sets `ended_at`. The row stays in the Ended tab as history.
- **Delete** removes the row. An admin's delete also removes the file straight away. A file left behind by any other delete is removed by the nightly reconcile once it is more than a day old.
- **Expired announcements keep their files.** Delete the announcement to free the space.

Code:
- Migration: `supabase/migrations/20261023120000_announcements.sql`
- Shared helpers: `src/lib/announcements.ts`
- Data hooks: `src/hooks/useAnnouncements.ts`
- UI: `src/components/announcements/` and `src/pages/Announcements.tsx`

## Storage quota

Cloudflare has no hard spending cap for R2. The app enforces its own limit so uploads stop before the free tier (10 GB of storage, 1,000,000 writes a month) runs out.

| Level | Storage | Uploads / month | What pauses |
|---|---|---|---|
| Announcement | 8 GB | 800,000 | announcement attachments |
| All | 9.5 GB | 950,000 | every upload: leave documents and profile pictures too |

1. Every write goes through `putObject()` in `lib/r2.ts`, which calls `r2_reserve_upload()` before touching the bucket.
   - When the level is full, the API answers **507**. The upload screens show the "Storage limit reached" popup.
   - The screens also read `get_r2_storage_status()` up front and disable the upload button while a level is closed.
2. `deleteObject()` gives the bytes back.
3. **If the quota check itself fails** (Supabase unreachable):
   - announcement uploads are refused;
   - leave documents and profile pictures go ahead, because an employee should not lose a medical certificate to a counter outage.
4. **Nightly reconcile** (`/api/storage/reconcile`, 02:00 IST through the Vercel cron in `vercel.json`):
   - lists the whole bucket;
   - overwrites the counter with the real total;
   - records the 10 largest files;
   - removes orphaned announcement files.

   The counter drifts without it: replaced leave documents are never deleted, and files from before the quota existed were never counted. Admins can also press **Recount now** on `/announcements`.

The limits live in one place: `public.r2_storage_limits()` in `supabase/migrations/20261023110000_r2_storage_quota.sql`. Change them there.

## Setup

1. Apply both migrations.
2. Set `CRON_SECRET` in the Vercel project environment, to any long random string. Vercel sends it with the cron request, and the reconcile refuses cron calls without it. `SUPABASE_SERVICE_ROLE_KEY` and the `R2_*` variables are already required by the existing functions.
3. After deploying, open `/announcements` as an admin and press **Recount now** once. Until then the counter only knows about files uploaded after the migration.
4. Optional: turn on a billing notification in the Cloudflare dashboard as a second line of defence.

## API

Everything that writes to R2 is served by one function, `api/storage/[...route].ts`, to stay under the Hobby plan's 12-function cap:

| Route | Who |
|---|---|
| `POST\|DELETE /api/storage/leave-document` | employees, supervisors (was `/api/upload/leave-document`, still rewritten) |
| `POST\|DELETE /api/storage/profile-picture` | self, supervisors, admins (was `/api/upload/profile-picture`, still rewritten) |
| `POST\|DELETE /api/storage/announcement-attachment` | admins |
| `GET /api/storage/announcement-attachment-url` | anyone who can see the announcement |
| `GET\|POST /api/storage/reconcile` | Vercel cron, admins |
