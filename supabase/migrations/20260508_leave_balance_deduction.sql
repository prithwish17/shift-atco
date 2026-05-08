-- =============================================================================
-- Leave Balance Deduction on Approval / Restoration on Cancellation
-- =============================================================================

-- 1. Widen balance column from INTEGER to NUMERIC(5,1) to support half-day leaves
ALTER TABLE public.leave_balances
  ALTER COLUMN balance TYPE NUMERIC(5,1) USING balance::NUMERIC(5,1);

-- 2. RPC: deduct_leave_balance
--    Atomically decrements the employee's leave balance when a leave is approved.
--    If no balance row exists for the (user, type, year), one is created with
--    the default allocation minus the deduction.
CREATE OR REPLACE FUNCTION public.deduct_leave_balance(
  p_user_id   UUID,
  p_leave_type TEXT,      -- lowercase enum value: 'cl', 'rh', 'el', 'hpl', 'comp_off'
  p_year      INT,
  p_days      NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC;
  v_default_balance NUMERIC;
  v_cast_type leave_type;
BEGIN
  -- Cast the text to the leave_type enum
  v_cast_type := p_leave_type::leave_type;

  -- Determine default allocation for the leave type
  CASE p_leave_type
    WHEN 'cl'  THEN v_default_balance := 12;
    WHEN 'rh'  THEN v_default_balance := 2;
    ELSE            v_default_balance := 0;
  END CASE;

  -- Try to lock + fetch the existing row
  SELECT balance INTO v_current_balance
    FROM public.leave_balances
   WHERE user_id    = p_user_id
     AND leave_type = v_cast_type
     AND year       = p_year
   FOR UPDATE;

  IF FOUND THEN
    -- Validate sufficient balance
    IF v_current_balance < p_days THEN
      RAISE EXCEPTION 'Insufficient % balance: have %, need %',
        p_leave_type, v_current_balance, p_days;
    END IF;

    UPDATE public.leave_balances
       SET balance    = balance - p_days,
           updated_at = NOW()
     WHERE user_id    = p_user_id
       AND leave_type = v_cast_type
       AND year       = p_year;
  ELSE
    -- No row yet — create one with default minus deduction
    IF v_default_balance < p_days THEN
      RAISE EXCEPTION 'Insufficient % balance: have % (default), need %',
        p_leave_type, v_default_balance, p_days;
    END IF;

    INSERT INTO public.leave_balances (user_id, leave_type, balance, year)
    VALUES (p_user_id, v_cast_type, v_default_balance - p_days, p_year);
  END IF;
END;
$$;

-- 3. RPC: restore_leave_balance
--    Atomically increments the employee's leave balance when an approved leave
--    is cancelled.
CREATE OR REPLACE FUNCTION public.restore_leave_balance(
  p_user_id   UUID,
  p_leave_type TEXT,
  p_year      INT,
  p_days      NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cast_type leave_type;
  v_default_balance NUMERIC;
BEGIN
  v_cast_type := p_leave_type::leave_type;

  CASE p_leave_type
    WHEN 'cl'  THEN v_default_balance := 12;
    WHEN 'rh'  THEN v_default_balance := 2;
    ELSE            v_default_balance := 0;
  END CASE;

  -- Try to update existing row
  UPDATE public.leave_balances
     SET balance    = balance + p_days,
         updated_at = NOW()
   WHERE user_id    = p_user_id
     AND leave_type = v_cast_type
     AND year       = p_year;

  -- If no row existed, insert with default + restored days
  -- (edge case: row was deleted between approval and cancellation)
  IF NOT FOUND THEN
    INSERT INTO public.leave_balances (user_id, leave_type, balance, year)
    VALUES (p_user_id, v_cast_type, v_default_balance + p_days, p_year);
  END IF;
END;
$$;

-- 4. Grant execute permissions to authenticated users
--    (RLS on leave_balances still controls row-level access;
--     SECURITY DEFINER lets the RPC bypass RLS for the atomic operation)
GRANT EXECUTE ON FUNCTION public.deduct_leave_balance(UUID, TEXT, INT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_leave_balance(UUID, TEXT, INT, NUMERIC) TO authenticated;
