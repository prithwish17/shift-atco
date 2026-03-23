-- ============================================================================
-- Fix: execute_duty_swap
--   1. Unique constraint on shifts must be DEFERRABLE for the swap.
--   2. The swap must also update employee_schedules (the source of truth
--      for duty display in the app).
-- ============================================================================

-- Step 1: Make the shifts unique constraint deferrable
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_user_id_shift_date_key;
ALTER TABLE shifts ADD CONSTRAINT shifts_user_id_shift_date_key
  UNIQUE (user_id, shift_date) DEFERRABLE INITIALLY IMMEDIATE;

-- Step 2: Rewrite execute_duty_swap to swap both shifts AND employee_schedules
CREATE OR REPLACE FUNCTION public.execute_duty_swap(
  p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exchange RECORD;
  v_req_user UUID;
  v_partner_user UUID;
  v_req_employee_code TEXT;
  v_partner_employee_code TEXT;
  v_req_duty_code TEXT;
  v_req_duty_desc TEXT;
  v_partner_duty_code TEXT;
  v_partner_duty_desc TEXT;
  v_duty_date DATE;
BEGIN
  -- Lock the exchange row
  SELECT * INTO v_exchange
    FROM duty_exchanges
    WHERE id = p_request_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exchange request not found';
  END IF;

  v_duty_date := v_exchange.duty_date;

  -- ── Shifts swap ──
  SELECT user_id INTO v_req_user
    FROM shifts WHERE id = v_exchange.requesting_user_shift_id FOR UPDATE;
  SELECT user_id INTO v_partner_user
    FROM shifts WHERE id = v_exchange.exchange_partner_shift_id FOR UPDATE;

  SET CONSTRAINTS shifts_user_id_shift_date_key DEFERRED;

  UPDATE shifts SET user_id = v_partner_user, schedule_status = 'swapped', updated_at = now()
    WHERE id = v_exchange.requesting_user_shift_id;

  UPDATE shifts SET user_id = v_req_user, schedule_status = 'swapped', updated_at = now()
    WHERE id = v_exchange.exchange_partner_shift_id;

  -- ── Employee schedules swap ──
  -- Look up employee_codes from profiles
  SELECT employee_id INTO v_req_employee_code
    FROM profiles WHERE id = v_exchange.requesting_user_id;
  SELECT employee_id INTO v_partner_employee_code
    FROM profiles WHERE id = v_exchange.exchange_partner_id;

  IF v_req_employee_code IS NOT NULL AND v_partner_employee_code IS NOT NULL AND v_duty_date IS NOT NULL THEN
    -- Read current duty values
    SELECT duty_code, duty_description INTO v_req_duty_code, v_req_duty_desc
      FROM employee_schedules
      WHERE employee_code = v_req_employee_code AND duty_date = v_duty_date
      FOR UPDATE;

    SELECT duty_code, duty_description INTO v_partner_duty_code, v_partner_duty_desc
      FROM employee_schedules
      WHERE employee_code = v_partner_employee_code AND duty_date = v_duty_date
      FOR UPDATE;

    -- Swap duty_code and duty_description between the two schedule rows
    IF v_req_duty_code IS NOT NULL AND v_partner_duty_code IS NOT NULL THEN
      UPDATE employee_schedules
        SET duty_code = v_partner_duty_code,
            duty_description = v_partner_duty_desc,
            updated_at = now()
        WHERE employee_code = v_req_employee_code AND duty_date = v_duty_date;

      UPDATE employee_schedules
        SET duty_code = v_req_duty_code,
            duty_description = v_req_duty_desc,
            updated_at = now()
        WHERE employee_code = v_partner_employee_code AND duty_date = v_duty_date;
    END IF;
  END IF;

  -- Mark exchange as completed
  UPDATE duty_exchanges SET status = 'completed', updated_at = now()
    WHERE id = p_request_id;
END;
$$;
