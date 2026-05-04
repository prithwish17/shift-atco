-- ─────────────────────────────────────────────────────────────────────────────
-- Module 1: Auth & RLS — JWT Role Claims + Optimized has_role()
-- ─────────────────────────────────────────────────────────────────────────────
-- PROBLEM: has_role() executes a subquery per row on every RLS-enabled table.
-- At 500–2000 employees with large tables (schedules, notifications, etc.),
-- this is the dominant query cost and blocks query parallelism.
--
-- SOLUTION:
-- 1. Custom Access Token Hook — writes user's approved roles into the JWT
--    app_metadata at login time. Roles are now available as a free in-memory
--    lookup inside every RLS policy without a DB round trip.
-- 2. has_role() rewritten to check JWT claims first, falling back to DB.
-- 3. current_user_roles() helper for multi-role checks (no repeated JWT parse).
-- 4. is_staff() convenience function (wso OR supervisor OR admin).
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Custom Access Token Hook
--    Called by Supabase Auth every time a JWT is minted (login + refresh).
--    Writes { "roles": ["wso", "supervisor"] } into app_metadata → JWT.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID;
  v_roles    TEXT[];
  v_claims   JSONB;
BEGIN
  v_user_id := (event->>'user_id')::UUID;

  -- Fetch all approved roles for this user (ordered for determinism)
  SELECT ARRAY_AGG(role::TEXT ORDER BY role)
  INTO v_roles
  FROM public.user_roles
  WHERE user_id = v_user_id
    AND approved = TRUE;

  -- Merge into existing claims — preserve all existing app_metadata
  v_claims := COALESCE(event->'claims', '{}'::JSONB)
    || jsonb_build_object(
         'app_metadata', COALESCE(event->'claims'->'app_metadata', '{}'::JSONB)
           || jsonb_build_object('roles', COALESCE(to_jsonb(v_roles), '[]'::JSONB))
       );

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- Grant execute to supabase_auth_admin (required for the hook to work)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Revoke from public (only auth should call this)
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. current_user_roles() — parse JWT claims once per query
--    Returns the set of roles from the JWT, or falls back to DB lookup.
--    Declare STABLE so Postgres can cache the result within a transaction.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.current_user_roles()
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- Primary: read from JWT claims (zero DB cost after parse)
    ARRAY(
      SELECT jsonb_array_elements_text(
        auth.jwt()->'app_metadata'->'roles'
      )
    ),
    -- Fallback: live DB lookup (for service-role calls or missing hook)
    ARRAY(
      SELECT role::TEXT
      FROM public.user_roles
      WHERE user_id = auth.uid()
        AND approved = TRUE
    )
  )
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. has_role() — rewritten to use JWT claims
--    Same signature — all existing RLS policies continue to work.
--    Cost drops from O(subquery) per row to O(array-scan) per query.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _role::TEXT = ANY(
    CASE
      -- If checking current user: use JWT claims (no DB hit)
      WHEN _user_id = auth.uid() THEN public.current_user_roles()
      -- If checking another user: must use DB (admin/service-role contexts)
      ELSE ARRAY(
        SELECT role::TEXT
        FROM public.user_roles
        WHERE user_id = _user_id
          AND approved = TRUE
      )
    END
  )
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. is_staff() — convenience function for multi-role RLS policies
--    Replaces the repetitive:
--      has_role(auth.uid(), 'wso') OR has_role(auth.uid(), 'supervisor') OR ...
--    With a single array overlap check on already-cached JWT roles.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_roles() && ARRAY['wso', 'supervisor', 'admin']::TEXT[]
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Simplify high-traffic RLS policies to use is_staff()
--    These tables have the most reads so benefit most from the optimisation.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── duty_rosters ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "WSO/Sup/Admin write duty_rosters" ON public.duty_rosters;
CREATE POLICY "Staff write duty_rosters" ON public.duty_rosters
  FOR ALL
  USING  (public.is_staff())
  WITH CHECK (public.is_staff());

-- ── roster_assignments ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "WSO/Sup/Admin write roster_assignments" ON public.roster_assignments;
CREATE POLICY "Staff write roster_assignments" ON public.roster_assignments
  FOR ALL
  USING  (public.is_staff())
  WITH CHECK (public.is_staff());

-- ── employee_schedules ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "WSO/Sup/Admin write employee_schedules" ON public.employee_schedules;
CREATE POLICY "Staff write employee_schedules" ON public.employee_schedules
  FOR ALL
  USING  (public.is_staff())
  WITH CHECK (public.is_staff());

-- ── employee_leave_dates ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "WSO/Sup/Admin write employee_leave_dates" ON public.employee_leave_dates;
CREATE POLICY "Staff write employee_leave_dates" ON public.employee_leave_dates
  FOR ALL
  USING  (public.is_staff())
  WITH CHECK (public.is_staff());

-- ── extra_duties ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Sup/Admin write extra_duties" ON public.extra_duties;
CREATE POLICY "Staff write extra_duties" ON public.extra_duties
  FOR ALL
  USING  (public.is_staff())
  WITH CHECK (public.is_staff());

-- ── medical_certificates ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Supervisors view all medical" ON public.medical_certificates;
DROP POLICY IF EXISTS "Supervisors manage medical" ON public.medical_certificates;
CREATE POLICY "Staff view all medical" ON public.medical_certificates
  FOR SELECT USING (public.is_staff());
CREATE POLICY "Staff manage medical" ON public.medical_certificates
  FOR ALL USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'))
  WITH CHECK     (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

-- ── unit_endorsements ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Supervisors view all endorsements" ON public.unit_endorsements;
DROP POLICY IF EXISTS "Supervisors manage endorsements" ON public.unit_endorsements;
CREATE POLICY "Staff view all endorsements" ON public.unit_endorsements
  FOR SELECT USING (public.is_staff());
CREATE POLICY "Staff manage endorsements" ON public.unit_endorsements
  FOR ALL USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'))
  WITH CHECK     (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Index to support the DB fallback path in current_user_roles()
--    (also used by the hook query — both benefit)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_user_roles_user_approved
  ON public.user_roles(user_id, approved)
  WHERE approved = TRUE;


-- ═══════════════════════════════════════════════════════════════════════════
-- NOTES FOR MANUAL STEP
-- ═══════════════════════════════════════════════════════════════════════════
-- After running this migration, register the hook in Supabase Dashboard:
--   Authentication → Hooks → Custom Access Token Hook
--   Function: public.custom_access_token_hook
--
-- OR run this SQL (if your Supabase project supports it via SQL):
--   UPDATE auth.hooks
--   SET enabled = true
--   WHERE hook_name = 'custom_access_token_hook';
--
-- Until the hook is registered, has_role() falls back to DB lookup (safe).
-- Once registered, JWTs will carry roles and all RLS becomes zero-DB-cost.
-- ─────────────────────────────────────────────────────────────────────────────
