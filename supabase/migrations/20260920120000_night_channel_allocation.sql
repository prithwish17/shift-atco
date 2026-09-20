-- Night Channel Allocation
--
-- A standalone module. It reads who is on tonight's shift from the roster but
-- owns its own tables, and nothing here writes back to `employee_schedules`.
--
-- Times are stored as SMALLINT minutes from 13:30 (0 … 720), never as
-- timestamps and never as local strings: a night runs 13:30 to 01:30 the next
-- day, so half of it belongs to the following calendar date and a timestamp
-- column would invite exactly the timezone bug this module cannot afford.
--
-- Access: any authenticated employee may read every night. There is no
-- approval workflow and no WSO gate — the WSO and the people on that night's
-- shift have identical rights. Writes are deliberately NOT granted to
-- `authenticated`: they go through /api/night-allocation, which re-runs the
-- full hard-rule validation with the service role before calling
-- `night_allocation_save`. That is what makes the rules unbypassable rather
-- than merely enforced in the browser.
--
-- Down migration: sql/night_allocation_down.sql

-- ── Person attribute ────────────────────────────────────────────────────────

-- Who may hold TSO. A property of the person, edited in staff admin, and
-- snapshotted per night below so a roster from six months ago still reads
-- correctly after someone's qualification changes.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_take_tso BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.can_take_tso IS
  'True when this person may take the TSO position at night. Set by the office; defaults false.';

-- ── The night ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.night_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The 13:30 date. One row per night.
  night_date        DATE NOT NULL UNIQUE,

  -- 0 = fitted to staffing, otherwise 30…120 minutes.
  duty_length_pref  SMALLINT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'draft',

  -- Optimistic lock. Bumped inside the same transaction as every write, so a
  -- second person saving a stale board gets a 409 instead of overwriting.
  version           INTEGER NOT NULL DEFAULT 0,

  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Denormalised: "Saved by X at HH:MM" must keep working after an account goes.
  updated_by_name   TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT night_allocations_status_known CHECK (status IN ('draft', 'final')),
  CONSTRAINT night_allocations_duty_pref_range
    CHECK (duty_length_pref = 0 OR duty_length_pref BETWEEN 30 AND 120)
);

COMMENT ON TABLE public.night_allocations IS
  'One night of channel allocation, keyed by its 13:30 date.';

-- ── Positions for the night ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.night_allocation_channels (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id  UUID NOT NULL REFERENCES public.night_allocations(id) ON DELETE CASCADE,

  channel_code   TEXT NOT NULL,
  in_use         BOOLEAN NOT NULL DEFAULT true,
  -- Minutes from 13:30.
  open_at        SMALLINT NOT NULL DEFAULT 0,
  close_at       SMALLINT NOT NULL DEFAULT 720,
  -- References night_allocation_people.person_key, not a user id: someone on
  -- the roster without an account can still open a position.
  starter_key    TEXT,

  CONSTRAINT night_allocation_channels_window CHECK (open_at >= 0 AND close_at <= 720),
  CONSTRAINT night_allocation_channels_unique UNIQUE (allocation_id, channel_code)
);

COMMENT ON COLUMN public.night_allocation_channels.open_at IS 'Minutes from 13:30 (0 = 13:30, 720 = 01:30 next day).';

-- ── People on the night ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.night_allocation_people (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id  UUID NOT NULL REFERENCES public.night_allocations(id) ON DELETE CASCADE,

  -- Stable within one night: the profile id where the roster line matched a
  -- profile, 'code:<employee code>' where it did not, 'manual:<id>' for someone
  -- added by hand. Duties point at this, so everyone actually on the shift can
  -- be rostered, not only people with an account.
  person_key     TEXT NOT NULL,
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name   TEXT NOT NULL,
  employee_code  TEXT,
  role           TEXT,

  is_available   BOOLEAN NOT NULL DEFAULT true,
  half           TEXT,
  -- Snapshot of profiles.can_take_tso as it stood on the night.
  can_take_tso   BOOLEAN NOT NULL DEFAULT false,
  is_manual      BOOLEAN NOT NULL DEFAULT false,
  color_index    SMALLINT NOT NULL DEFAULT 0,

  CONSTRAINT night_allocation_people_half_known CHECK (half IS NULL OR half IN ('1st', '2nd')),
  CONSTRAINT night_allocation_people_unique UNIQUE (allocation_id, person_key)
);

-- ── Duties ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.night_allocation_duties (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id  UUID NOT NULL REFERENCES public.night_allocations(id) ON DELETE CASCADE,

  channel_code   TEXT NOT NULL,
  person_key     TEXT NOT NULL,
  start_min      SMALLINT NOT NULL,
  end_min        SMALLINT NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The 30 min / 2 h bounds and every other rule are enforced by the API before
  -- the write. These two constraints are the last line: a duty outside the
  -- night, or running backwards, is meaningless whatever wrote it.
  CONSTRAINT night_allocation_duties_inside_night CHECK (start_min >= 0 AND end_min <= 720),
  CONSTRAINT night_allocation_duties_ordered CHECK (end_min > start_min)
);

CREATE INDEX IF NOT EXISTS night_allocation_duties_board_idx
  ON public.night_allocation_duties (allocation_id, channel_code, start_min);
CREATE INDEX IF NOT EXISTS night_allocation_duties_person_idx
  ON public.night_allocation_duties (allocation_id, person_key);

-- ── Audit ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.night_allocation_audit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id  UUID REFERENCES public.night_allocations(id) ON DELETE SET NULL,
  night_date     DATE NOT NULL,

  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name      TEXT,
  action         TEXT NOT NULL,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT night_allocation_audit_action_known
    CHECK (action IN ('save', 'generate', 'reset', 'share', 'email'))
);

CREATE INDEX IF NOT EXISTS night_allocation_audit_night_idx
  ON public.night_allocation_audit (night_date DESC, created_at DESC);

-- ── Row level security ──────────────────────────────────────────────────────
--
-- Read: every authenticated user, no role check anywhere. Write: nobody except
-- the service role, which is reached only through the validating API.

ALTER TABLE public.night_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.night_allocation_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.night_allocation_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.night_allocation_duties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.night_allocation_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone signed in reads night allocations" ON public.night_allocations;
CREATE POLICY "Anyone signed in reads night allocations"
  ON public.night_allocations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone signed in reads night channels" ON public.night_allocation_channels;
CREATE POLICY "Anyone signed in reads night channels"
  ON public.night_allocation_channels FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone signed in reads night people" ON public.night_allocation_people;
CREATE POLICY "Anyone signed in reads night people"
  ON public.night_allocation_people FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone signed in reads night duties" ON public.night_allocation_duties;
CREATE POLICY "Anyone signed in reads night duties"
  ON public.night_allocation_duties FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone signed in reads night audit" ON public.night_allocation_audit;
CREATE POLICY "Anyone signed in reads night audit"
  ON public.night_allocation_audit FOR SELECT TO authenticated USING (true);

-- ── Transactional save ──────────────────────────────────────────────────────

/**
 * Replace a whole night in one transaction, under an optimistic lock.
 *
 * The API has already validated the payload against the shared rule set; this
 * function's job is atomicity and the version check. A mismatched version
 * returns `conflict` rather than raising, so the caller can hand the client the
 * current server state to reload.
 */
CREATE OR REPLACE FUNCTION public.night_allocation_save(
  p_night_date       DATE,
  p_expected_version INTEGER,
  p_duty_length_pref SMALLINT,
  p_status           TEXT,
  p_channels         JSONB,
  p_people           JSONB,
  p_duties           JSONB,
  p_actor            UUID,
  p_actor_name       TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_id      UUID;
  v_version INTEGER;
BEGIN
  SELECT id, version INTO v_id, v_version
    FROM public.night_allocations
   WHERE night_date = p_night_date
   FOR UPDATE;

  IF v_id IS NULL THEN
    -- Nothing saved yet: only a client that also thinks so may create it.
    IF COALESCE(p_expected_version, 0) <> 0 THEN
      RETURN jsonb_build_object('ok', false, 'conflict', true, 'version', 0);
    END IF;

    INSERT INTO public.night_allocations
      (night_date, duty_length_pref, status, version, created_by, updated_by, updated_by_name)
    VALUES
      (p_night_date, COALESCE(p_duty_length_pref, 0::SMALLINT), COALESCE(p_status, 'draft'), 1,
       p_actor, p_actor, p_actor_name)
    RETURNING id, version INTO v_id, v_version;
  ELSE
    IF v_version <> COALESCE(p_expected_version, -1) THEN
      RETURN jsonb_build_object('ok', false, 'conflict', true, 'version', v_version);
    END IF;

    UPDATE public.night_allocations
       SET duty_length_pref = COALESCE(p_duty_length_pref, 0::SMALLINT),
           status           = COALESCE(p_status, 'draft'),
           version          = version + 1,
           updated_by       = p_actor,
           updated_by_name  = p_actor_name,
           updated_at       = now()
     WHERE id = v_id
    RETURNING version INTO v_version;
  END IF;

  -- Replace the night as a set. Cheap (a night is tens of rows) and it cannot
  -- leave a half-written board the way a diff can.
  DELETE FROM public.night_allocation_duties   WHERE allocation_id = v_id;
  DELETE FROM public.night_allocation_channels WHERE allocation_id = v_id;
  DELETE FROM public.night_allocation_people   WHERE allocation_id = v_id;

  INSERT INTO public.night_allocation_people
    (allocation_id, person_key, user_id, display_name, employee_code, role,
     is_available, half, can_take_tso, is_manual, color_index)
  SELECT v_id, x.person_key, x.user_id, x.display_name, x.employee_code, x.role,
         x.is_available, x.half, x.can_take_tso, x.is_manual, x.color_index
    FROM jsonb_to_recordset(COALESCE(p_people, '[]'::jsonb)) AS x(
      person_key TEXT, user_id UUID, display_name TEXT, employee_code TEXT, role TEXT,
      is_available BOOLEAN, half TEXT, can_take_tso BOOLEAN, is_manual BOOLEAN, color_index SMALLINT
    );

  INSERT INTO public.night_allocation_channels
    (allocation_id, channel_code, in_use, open_at, close_at, starter_key)
  SELECT v_id, x.channel_code, x.in_use, x.open_at, x.close_at, x.starter_key
    FROM jsonb_to_recordset(COALESCE(p_channels, '[]'::jsonb)) AS x(
      channel_code TEXT, in_use BOOLEAN, open_at SMALLINT, close_at SMALLINT, starter_key TEXT
    );

  INSERT INTO public.night_allocation_duties
    (allocation_id, channel_code, person_key, start_min, end_min)
  SELECT v_id, x.channel_code, x.person_key, x.start_min, x.end_min
    FROM jsonb_to_recordset(COALESCE(p_duties, '[]'::jsonb)) AS x(
      channel_code TEXT, person_key TEXT, start_min SMALLINT, end_min SMALLINT
    );

  INSERT INTO public.night_allocation_audit (allocation_id, night_date, user_id, user_name, action, payload)
  VALUES (v_id, p_night_date, p_actor, p_actor_name, 'save',
          jsonb_build_object(
            'version', v_version,
            'duties', jsonb_array_length(COALESCE(p_duties, '[]'::jsonb)),
            'people', jsonb_array_length(COALESCE(p_people, '[]'::jsonb))
          ));

  RETURN jsonb_build_object('ok', true, 'version', v_version, 'allocation_id', v_id);
END;
$$;

COMMENT ON FUNCTION public.night_allocation_save IS
  'Atomically replace one night under an optimistic lock. Called only by the validating API (service role).';

REVOKE ALL ON FUNCTION public.night_allocation_save(
  DATE, INTEGER, SMALLINT, TEXT, JSONB, JSONB, JSONB, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.night_allocation_save(
  DATE, INTEGER, SMALLINT, TEXT, JSONB, JSONB, JSONB, UUID, TEXT
) TO service_role;

-- ── Feature toggle ──────────────────────────────────────────────────────────
--
-- Flip to 'false' to hide the page, the nav entries and the dashboard cards
-- without a deploy. Absent is treated as enabled.

INSERT INTO public.app_settings (key, value, label, updated_at)
VALUES ('night_allocation.enabled', 'true', 'Night Channel Allocation module', now())
ON CONFLICT (key) DO NOTHING;
