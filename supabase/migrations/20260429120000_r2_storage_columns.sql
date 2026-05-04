-- R2 storage integration: leave attachments
-- Profile pictures continue to use the existing profiles.avatar_url column.
-- Leave attachments live in R2 under leave-documents/<user_id>/<leave_request_id>/<hash>.<ext>
-- We record the storage key + metadata; nothing binary lives in Postgres.

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_meta jsonb;

-- Partial index covers the only useful query: "find rows that have an attachment".
-- Lookups by id / user_id are already covered by the existing primary/unique indexes.
CREATE INDEX IF NOT EXISTS leave_requests_attachment_path_idx
  ON public.leave_requests (attachment_path)
  WHERE attachment_path IS NOT NULL;

COMMENT ON COLUMN public.leave_requests.attachment_path IS
  'Object key in Cloudflare R2 (e.g. leave-documents/<uid>/<id>/<hash>.pdf). NULL if no attachment.';

COMMENT ON COLUMN public.leave_requests.attachment_meta IS
  'JSON metadata for the stored attachment: {mime, size, original_name, uploaded_at}.';
