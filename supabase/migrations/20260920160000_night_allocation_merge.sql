-- Night Channel Allocation — merging one position into another
--
-- On a thin 1st Half, CLD is worked as part of SMC for part of the evening:
-- one person, one duty, exactly as the shift roster already writes combined
-- units like `UKN+UKW`. The folded position needs no cover of its own for that
-- window, so the board, the rules and the exports all have to know about it.
--
-- Only the pairing is stored. The window itself is a constant in the shared
-- rules module (`MERGE_WINDOW`), so it cannot drift between the two.
--
-- The save function's signature is unchanged: the new field rides in the
-- `p_channels` JSON it already takes, so this is an ALTER plus a CREATE OR
-- REPLACE, with no need to drop and recreate the function.
--
-- Down migration: sql/night_allocation_down.sql

ALTER TABLE public.night_allocation_channels
  ADD COLUMN IF NOT EXISTS merged_into TEXT;

COMMENT ON COLUMN public.night_allocation_channels.merged_into IS
  'Code of the position this one folds into during the merge window (19:00-21:30). Set on CLD, pointing at the SMC in use. NULL when the position stands alone.';

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
    (allocation_id, channel_code, in_use, open_at, close_at, starter_key, merged_into)
  SELECT v_id, x.channel_code, x.in_use, x.open_at, x.close_at, x.starter_key, x.merged_into
    FROM jsonb_to_recordset(COALESCE(p_channels, '[]'::jsonb)) AS x(
      channel_code TEXT, in_use BOOLEAN, open_at SMALLINT, close_at SMALLINT,
      starter_key TEXT, merged_into TEXT
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
