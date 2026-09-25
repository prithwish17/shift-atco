-- Night Channel Allocation — DB slots and part-night availability
--
-- DB slots. A position reserved for training at a fixed time — TWR 17:30–19:30,
-- say — and held by the instructor, who is the one actually marked on the
-- position then. Stored as a duty with kind = 'db' and an optional trainee
-- note, because to every rule it IS a duty: the API validates it like any
-- other before this function is called. The generator plans around it and
-- never moves it.
--
-- Availability. Someone on the crew for only part of the night — available
-- only between some times, or away between some. Stored as it was entered,
-- {"mode": "only" | "except", "periods": [[start, end], ...]} in minutes from
-- 13:30 like every other time here; NULL means the whole night. `is_available`
-- keeps its meaning: false is the whole night off, whatever the periods say.
--
-- Both ride in the JSON night_allocation_save already takes, so its signature
-- is unchanged: two ALTERs and a CREATE OR REPLACE, as 20260920160000 did for
-- the merge.
--
-- Down migration: sql/night_allocation_down.sql (the columns go with the tables).

ALTER TABLE public.night_allocation_duties
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'duty',
  ADD COLUMN IF NOT EXISTS note TEXT;

COMMENT ON COLUMN public.night_allocation_duties.kind IS
  '''duty'' for an ordinary duty; ''db'' for a DB slot — training time fixed in advance, person_key being the instructor.';
COMMENT ON COLUMN public.night_allocation_duties.note IS
  'On a DB slot, who is being trained. Free text, at most 40 characters. NULL otherwise.';

ALTER TABLE public.night_allocation_people
  ADD COLUMN IF NOT EXISTS availability JSONB;

COMMENT ON COLUMN public.night_allocation_people.availability IS
  'Part-night availability as entered: {"mode": "only"|"except", "periods": [[start, end], ...]} in minutes from 13:30. NULL for the whole night.';

-- Named constraints, added only when missing, so the migration can be re-run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'night_allocation_duties_kind_known') THEN
    ALTER TABLE public.night_allocation_duties
      ADD CONSTRAINT night_allocation_duties_kind_known CHECK (kind IN ('duty', 'db'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'night_allocation_duties_note_length') THEN
    ALTER TABLE public.night_allocation_duties
      ADD CONSTRAINT night_allocation_duties_note_length CHECK (note IS NULL OR char_length(note) <= 40);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'night_allocation_people_availability_shape') THEN
    ALTER TABLE public.night_allocation_people
      ADD CONSTRAINT night_allocation_people_availability_shape CHECK (
        availability IS NULL
        OR (
          jsonb_typeof(availability) = 'object'
          AND availability->>'mode' IN ('only', 'except')
          AND jsonb_typeof(availability->'periods') = 'array'
        )
      );
  END IF;
END
$$;

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
     is_available, half, can_take_tso, is_manual, color_index, availability)
  SELECT v_id, x.person_key, x.user_id, x.display_name, x.employee_code, x.role,
         x.is_available, x.half, x.can_take_tso, x.is_manual, x.color_index, x.availability
    FROM jsonb_to_recordset(COALESCE(p_people, '[]'::jsonb)) AS x(
      person_key TEXT, user_id UUID, display_name TEXT, employee_code TEXT, role TEXT,
      is_available BOOLEAN, half TEXT, can_take_tso BOOLEAN, is_manual BOOLEAN, color_index SMALLINT,
      availability JSONB
    );

  INSERT INTO public.night_allocation_channels
    (allocation_id, channel_code, in_use, open_at, close_at, starter_key, merged_into)
  SELECT v_id, x.channel_code, x.in_use, x.open_at, x.close_at, x.starter_key, x.merged_into
    FROM jsonb_to_recordset(COALESCE(p_channels, '[]'::jsonb)) AS x(
      channel_code TEXT, in_use BOOLEAN, open_at SMALLINT, close_at SMALLINT,
      starter_key TEXT, merged_into TEXT
    );

  -- A payload from before DB slots existed carries no kind: an ordinary duty.
  INSERT INTO public.night_allocation_duties
    (allocation_id, channel_code, person_key, start_min, end_min, kind, note)
  SELECT v_id, x.channel_code, x.person_key, x.start_min, x.end_min,
         COALESCE(x.kind, 'duty'), CASE WHEN x.kind = 'db' THEN x.note END
    FROM jsonb_to_recordset(COALESCE(p_duties, '[]'::jsonb)) AS x(
      channel_code TEXT, person_key TEXT, start_min SMALLINT, end_min SMALLINT,
      kind TEXT, note TEXT
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

-- CREATE OR REPLACE keeps the existing grants; restated so this file alone
-- leaves the function callable by the validating API and by nobody else.
REVOKE ALL ON FUNCTION public.night_allocation_save(
  DATE, INTEGER, SMALLINT, TEXT, JSONB, JSONB, JSONB, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.night_allocation_save(
  DATE, INTEGER, SMALLINT, TEXT, JSONB, JSONB, JSONB, UUID, TEXT
) TO service_role;
