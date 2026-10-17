-- ─────────────────────────────────────────────────────────────────────────────
-- Feedback box: errors, suggestions and grievances from any signed-in page
--
-- Every page in DashboardLayout carries a "Found an error or have a
-- suggestion?" link. It inserts one row here straight from the client; there
-- is no API function. Admins read and resolve the rows on /admin/feedback.
--
--   * Only approved users can submit (get_user_role checks approved = TRUE).
--   * Anonymous rows store no user id. The sender cannot see them afterwards,
--     so the client must insert without RETURNING (no .select()).
--     Supabase's API logs still record who made the request; the UI says
--     "your name is not stored", not "fully anonymous".
--   * Users read their own named rows. Only admins read everything; a
--     grievance may concern a supervisor.
--   * Admins can change status and admin_note only (column grants); who
--     resolved it and when is set by the trigger.
--   * A user can send at most 5 named items in 24 hours.
--   * Each new item drops a notification in every approved admin's bell.
--
-- See FEEDBACK_BOX_PLAN.md.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Table
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.feedback_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL CHECK (kind IN ('error', 'suggestion', 'grievance')),
  body          TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 5 AND 4000),
  page_path     TEXT CHECK (char_length(page_path) <= 500),
  page_title    TEXT CHECK (char_length(page_title) <= 300),
  app_version   TEXT CHECK (char_length(app_version) <= 100),
  user_agent    TEXT CHECK (char_length(user_agent) <= 500),
  is_anonymous  BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
  admin_note    TEXT CHECK (char_length(admin_note) <= 4000),
  resolved_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT feedback_anonymous_has_no_sender CHECK (NOT is_anonymous OR submitted_by IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_feedback_items_status_created
  ON public.feedback_items (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_items_submitted_by
  ON public.feedback_items (submitted_by, created_at DESC)
  WHERE submitted_by IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Row level security and grants
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.feedback_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users submit feedback" ON public.feedback_items;
CREATE POLICY "Approved users submit feedback"
  ON public.feedback_items FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_user_role(auth.uid()) IS NOT NULL
    AND (
      (NOT is_anonymous AND submitted_by = auth.uid())
      OR (is_anonymous AND submitted_by IS NULL)
    )
  );

DROP POLICY IF EXISTS "Users read own feedback" ON public.feedback_items;
CREATE POLICY "Users read own feedback"
  ON public.feedback_items FOR SELECT
  TO authenticated
  USING (submitted_by = auth.uid());

DROP POLICY IF EXISTS "Admins read all feedback" ON public.feedback_items;
CREATE POLICY "Admins read all feedback"
  ON public.feedback_items FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update feedback" ON public.feedback_items;
CREATE POLICY "Admins update feedback"
  ON public.feedback_items FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- No DELETE policy: nobody deletes through the API.

-- anon gets nothing. authenticated may insert the submitter's columns, read,
-- and update only the two columns an admin works with.
REVOKE ALL ON public.feedback_items FROM anon, authenticated;
GRANT SELECT ON public.feedback_items TO authenticated;
GRANT INSERT (kind, body, page_path, page_title, app_version, user_agent, is_anonymous, submitted_by)
  ON public.feedback_items TO authenticated;
GRANT UPDATE (status, admin_note) ON public.feedback_items TO authenticated;
GRANT ALL ON public.feedback_items TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Triggers
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. Before insert: tidy the row and enforce the daily limit.
CREATE OR REPLACE FUNCTION public.feedback_items_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_recent INTEGER;
BEGIN
  NEW.body := btrim(NEW.body);

  IF NEW.submitted_by IS NOT NULL THEN
    -- Serialise one user's inserts so two quick submits can't both pass.
    PERFORM pg_advisory_xact_lock(hashtext('feedback_items:' || NEW.submitted_by::text));

    SELECT count(*) INTO v_recent
    FROM public.feedback_items
    WHERE submitted_by = NEW.submitted_by
      AND created_at > now() - interval '24 hours';

    IF v_recent >= 5 THEN
      RAISE EXCEPTION 'You have sent 5 items in the last 24 hours. Please try again tomorrow.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feedback_items_before_insert ON public.feedback_items;
CREATE TRIGGER feedback_items_before_insert
  BEFORE INSERT ON public.feedback_items
  FOR EACH ROW EXECUTE FUNCTION public.feedback_items_before_insert();


-- 3b. Before update: keep updated_at, resolved_by and resolved_at in step
-- with status.
CREATE OR REPLACE FUNCTION public.feedback_items_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('resolved', 'dismissed') THEN
      NEW.resolved_by := auth.uid();
      NEW.resolved_at := now();
    ELSE
      NEW.resolved_by := NULL;
      NEW.resolved_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feedback_items_before_update ON public.feedback_items;
CREATE TRIGGER feedback_items_before_update
  BEFORE UPDATE ON public.feedback_items
  FOR EACH ROW EXECUTE FUNCTION public.feedback_items_before_update();


-- 3c. After insert: tell every approved admin. SECURITY DEFINER because the
-- submitter can neither see user_roles nor write other users' notifications.
CREATE OR REPLACE FUNCTION public.feedback_items_notify_admins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT;
BEGIN
  v_label := CASE NEW.kind
    WHEN 'error'      THEN 'error report'
    WHEN 'suggestion' THEN 'suggestion'
    ELSE 'grievance'
  END;

  INSERT INTO public.notifications (user_id, title, body, category, metadata)
  SELECT DISTINCT ur.user_id,
         'New ' || v_label,
         left(NEW.body, 140) || CASE WHEN char_length(NEW.body) > 140 THEN '…' ELSE '' END,
         'feedback',
         jsonb_build_object(
           'url', '/admin/feedback?id=' || NEW.id,
           'feedback_id', NEW.id,
           'kind', NEW.kind
         )
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.approved = TRUE;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS feedback_items_notify_admins ON public.feedback_items;
CREATE TRIGGER feedback_items_notify_admins
  AFTER INSERT ON public.feedback_items
  FOR EACH ROW EXECUTE FUNCTION public.feedback_items_notify_admins();


-- Trigger functions can't be called over PostgREST, but revoke by name anyway:
-- default privileges grant anon and authenticated EXECUTE on new functions.
REVOKE ALL ON FUNCTION public.feedback_items_before_insert()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feedback_items_before_update()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feedback_items_notify_admins()  FROM PUBLIC, anon, authenticated;
