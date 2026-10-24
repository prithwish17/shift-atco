-- ─────────────────────────────────────────────────────────────────────────────
-- R2 storage quota: keep uploads inside Cloudflare R2's free tier
--
-- Cloudflare has no hard spending cap for R2, so the app enforces its own.
-- Every upload goes through putObject() in lib/r2.ts, which asks
-- r2_reserve_upload() for room before it writes to the bucket.
--
-- Two levels:
--
--   level         storage    uploads / month   blocks
--   ───────────   ────────   ───────────────   ─────────────────────────────
--   announcement  8 GB       800,000           announcement attachments
--   all           9.5 GB     950,000           every upload (leave documents,
--                                              profile pictures, everything)
--
-- The free tier is 10 GB-month of storage and 1,000,000 Class A operations
-- (writes and listings) a month. GB here is 10^9 bytes, a little smaller than
-- Cloudflare's 2^30, so the limits err on the safe side.
--
--   * One row holds the running totals. Uploads add to it, deletes subtract.
--   * The counter drifts: a replaced leave document is never deleted from R2,
--     and the counter only knows about files written since this migration. The
--     daily reconcile (/api/storage/reconcile) lists the whole bucket and
--     overwrites bytes_used with the real total.
--   * The upload count resets at the start of each UTC month, matching R2's
--     monthly free allowance.
--   * Only the server (service_role) can reserve, release or reconcile.
--     Signed-in users can read a summary through get_r2_storage_status(), which
--     the upload screens use to disable the button and show the limit popup.
--
-- See docs/announcements-and-storage-quota.md.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Table
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.r2_storage_usage (
  id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bytes_used          BIGINT NOT NULL DEFAULT 0 CHECK (bytes_used >= 0),
  object_count        INTEGER NOT NULL DEFAULT 0 CHECK (object_count >= 0),
  uploads_month       DATE NOT NULL DEFAULT (date_trunc('month', now() AT TIME ZONE 'UTC'))::date,
  uploads_this_month  INTEGER NOT NULL DEFAULT 0 CHECK (uploads_this_month >= 0),
  largest_objects     JSONB NOT NULL DEFAULT '[]'::jsonb,
  reconciled_at       TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.r2_storage_usage (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.r2_storage_usage ENABLE ROW LEVEL SECURITY;

-- No policies: only service_role (which bypasses RLS) touches the row directly.
REVOKE ALL ON public.r2_storage_usage FROM anon, authenticated;
GRANT ALL ON public.r2_storage_usage TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Limits
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.r2_storage_limits()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'free_bytes',            10000000000,
    'free_uploads',          1000000,
    'announcement_bytes',    8000000000,
    'announcement_uploads',  800000,
    'all_bytes',             9500000000,
    'all_uploads',           950000
  )
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Server functions (service_role only)
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. Reserve room for one upload. Returns {"allowed": true} and adds the bytes,
--     or {"allowed": false, "reason": "storage" | "uploads"} and changes nothing.
CREATE OR REPLACE FUNCTION public.r2_reserve_upload(p_bytes BIGINT, p_scope TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits        JSONB := public.r2_storage_limits();
  v_month         DATE  := (date_trunc('month', now() AT TIME ZONE 'UTC'))::date;
  v_usage         public.r2_storage_usage;
  v_uploads       INTEGER;
  v_limit_bytes   BIGINT;
  v_limit_uploads INTEGER;
BEGIN
  IF p_bytes IS NULL OR p_bytes <= 0 THEN
    RAISE EXCEPTION 'p_bytes must be positive' USING ERRCODE = '22023';
  END IF;

  IF p_scope = 'announcement' THEN
    v_limit_bytes   := (v_limits ->> 'announcement_bytes')::BIGINT;
    v_limit_uploads := (v_limits ->> 'announcement_uploads')::INTEGER;
  ELSIF p_scope IN ('leave_document', 'profile_picture') THEN
    v_limit_bytes   := (v_limits ->> 'all_bytes')::BIGINT;
    v_limit_uploads := (v_limits ->> 'all_uploads')::INTEGER;
  ELSE
    RAISE EXCEPTION 'Unknown upload scope: %', p_scope USING ERRCODE = '22023';
  END IF;

  -- One row, locked: two uploads at the same moment cannot both squeeze past.
  SELECT * INTO v_usage FROM public.r2_storage_usage WHERE id = 1 FOR UPDATE;

  v_uploads := CASE WHEN v_usage.uploads_month = v_month THEN v_usage.uploads_this_month ELSE 0 END;

  IF v_usage.bytes_used + p_bytes > v_limit_bytes THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'storage', 'scope', p_scope);
  END IF;

  IF v_uploads + 1 > v_limit_uploads THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'uploads', 'scope', p_scope);
  END IF;

  UPDATE public.r2_storage_usage
  SET bytes_used         = bytes_used + p_bytes,
      object_count       = object_count + 1,
      uploads_month      = v_month,
      uploads_this_month = v_uploads + 1,
      updated_at         = now()
  WHERE id = 1;

  RETURN jsonb_build_object('allowed', true, 'scope', p_scope);
END;
$$;

-- 3b. Give bytes back after a delete, or after a reserved write that failed.
CREATE OR REPLACE FUNCTION public.r2_release_upload(p_bytes BIGINT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.r2_storage_usage
  SET bytes_used   = GREATEST(0, bytes_used - GREATEST(COALESCE(p_bytes, 0), 0)),
      object_count = GREATEST(0, object_count - 1),
      updated_at   = now()
  WHERE id = 1;
$$;

-- 3c. Overwrite the totals with what a full bucket listing found. Listing calls
--     are Class A operations, so they count against the month's uploads.
CREATE OR REPLACE FUNCTION public.r2_record_reconcile(
  p_bytes       BIGINT,
  p_objects     INTEGER,
  p_list_calls  INTEGER,
  p_largest     JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.r2_storage_usage
  SET bytes_used         = GREATEST(COALESCE(p_bytes, 0), 0),
      object_count       = GREATEST(COALESCE(p_objects, 0), 0),
      uploads_this_month = CASE
                             WHEN uploads_month = (date_trunc('month', now() AT TIME ZONE 'UTC'))::date
                             THEN uploads_this_month
                             ELSE 0
                           END + GREATEST(COALESCE(p_list_calls, 0), 0),
      uploads_month      = (date_trunc('month', now() AT TIME ZONE 'UTC'))::date,
      largest_objects    = COALESCE(p_largest, '[]'::jsonb),
      reconciled_at      = now(),
      updated_at         = now()
  WHERE id = 1;
$$;

REVOKE ALL ON FUNCTION public.r2_reserve_upload(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r2_release_upload(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r2_record_reconcile(BIGINT, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.r2_reserve_upload(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.r2_release_upload(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.r2_record_reconcile(BIGINT, INTEGER, INTEGER, JSONB) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Status for the app (any approved user)
-- ═══════════════════════════════════════════════════════════════════════════

-- Everyone gets the totals and whether each level is still open. Admins also
-- get the object count, the largest files and when the bucket was last counted.
CREATE OR REPLACE FUNCTION public.get_r2_storage_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits  JSONB := public.r2_storage_limits();
  v_usage   public.r2_storage_usage;
  v_uploads INTEGER;
  v_result  JSONB;
BEGIN
  IF public.get_user_role(auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_usage FROM public.r2_storage_usage WHERE id = 1;

  v_uploads := CASE
                 WHEN v_usage.uploads_month = (date_trunc('month', now() AT TIME ZONE 'UTC'))::date
                 THEN v_usage.uploads_this_month
                 ELSE 0
               END;

  v_result := jsonb_build_object(
    'bytes_used',                   COALESCE(v_usage.bytes_used, 0),
    'uploads_this_month',           COALESCE(v_uploads, 0),
    'limits',                       v_limits,
    'announcement_uploads_allowed', COALESCE(v_usage.bytes_used, 0) < (v_limits ->> 'announcement_bytes')::BIGINT
                                    AND COALESCE(v_uploads, 0) < (v_limits ->> 'announcement_uploads')::INTEGER,
    'all_uploads_allowed',          COALESCE(v_usage.bytes_used, 0) < (v_limits ->> 'all_bytes')::BIGINT
                                    AND COALESCE(v_uploads, 0) < (v_limits ->> 'all_uploads')::INTEGER
  );

  IF public.has_role(auth.uid(), 'admin') THEN
    v_result := v_result || jsonb_build_object(
      'object_count',    COALESCE(v_usage.object_count, 0),
      'largest_objects', COALESCE(v_usage.largest_objects, '[]'::jsonb),
      'reconciled_at',   v_usage.reconciled_at,
      'updated_at',      v_usage.updated_at
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_r2_storage_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_r2_storage_status() TO authenticated, service_role;
