-- ============================================================================
-- Duty Exchange Workflow: Multi-level approval + atomic duty swap
-- ============================================================================

-- 1. Extend exchange_status enum to include partner approval + completed state
ALTER TYPE exchange_status ADD VALUE IF NOT EXISTS 'pending_partner';
ALTER TYPE exchange_status ADD VALUE IF NOT EXISTS 'completed';

-- 2. Add duty_date to duty_exchanges for date-based lookups
ALTER TABLE public.duty_exchanges
  ADD COLUMN IF NOT EXISTS duty_date DATE;

-- Backfill duty_date from the requester's shift
UPDATE public.duty_exchanges de
  SET duty_date = s.shift_date
  FROM public.shifts s
  WHERE de.requesting_user_shift_id = s.id
    AND de.duty_date IS NULL;

-- 3. Add schedule-status column to shifts for swap tracking
DO $$ BEGIN
  ALTER TABLE public.shifts ADD COLUMN schedule_status TEXT NOT NULL DEFAULT 'active';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 4. Add wso_id to shifts so we can route approvals correctly
DO $$ BEGIN
  ALTER TABLE public.shifts ADD COLUMN wso_id UUID REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 5. Create the approval workflow table
CREATE TABLE IF NOT EXISTS public.duty_exchange_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.duty_exchanges(id) ON DELETE CASCADE,
  approver_id UUID REFERENCES auth.users(id),
  approver_role TEXT NOT NULL CHECK (approver_role IN ('partner', 'wso', 'supervisor')),
  sequence_order INT NOT NULL CHECK (sequence_order BETWEEN 1 AND 4),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  remarks TEXT,
  action_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(request_id, sequence_order)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exchange_approvals_request ON public.duty_exchange_approvals(request_id);
CREATE INDEX IF NOT EXISTS idx_exchange_approvals_approver ON public.duty_exchange_approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_exchange_approvals_status ON public.duty_exchange_approvals(status);
CREATE INDEX IF NOT EXISTS idx_duty_exchanges_duty_date ON public.duty_exchanges(duty_date);
CREATE INDEX IF NOT EXISTS idx_shifts_schedule_status ON public.shifts(schedule_status);

-- RLS
ALTER TABLE public.duty_exchange_approvals ENABLE ROW LEVEL SECURITY;

-- Employees can see approvals for their own exchange requests
CREATE POLICY "Users can view own exchange approvals"
  ON public.duty_exchange_approvals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.duty_exchanges de
      WHERE de.id = request_id
        AND (de.requesting_user_id = auth.uid() OR de.exchange_partner_id = auth.uid())
    )
  );

-- Partners can act on their own approval step
CREATE POLICY "Partners can update own approval"
  ON public.duty_exchange_approvals FOR UPDATE
  USING (approver_id = auth.uid() AND approver_role = 'partner');

-- WSOs, supervisors, admins can view and update all approvals
CREATE POLICY "Admins and supervisors can view all exchange approvals"
  ON public.duty_exchange_approvals FOR SELECT
  USING (has_role(auth.uid(), 'wso') OR has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins and supervisors can update exchange approvals"
  ON public.duty_exchange_approvals FOR UPDATE
  USING (has_role(auth.uid(), 'wso') OR has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

-- 6. Update duty_exchanges RLS to let partners also update (for cancellation etc.)
CREATE POLICY "Partners can update their own exchange requests"
  ON public.duty_exchanges FOR UPDATE
  USING (auth.uid() = exchange_partner_id);

-- ============================================================================
-- RPC: create_duty_exchange_request
-- Atomically inserts the exchange request + 4 approval steps
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_duty_exchange_request(
  p_requester_id UUID,
  p_partner_id UUID,
  p_requester_shift_id UUID,
  p_partner_shift_id UUID,
  p_duty_date DATE,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id UUID;
  v_requester_wso_id UUID;
  v_partner_wso_id UUID;
  v_requester_shift RECORD;
  v_partner_shift RECORD;
BEGIN
  -- Validate: requester shift belongs to requester and is active
  SELECT * INTO v_requester_shift
    FROM shifts WHERE id = p_requester_shift_id AND user_id = p_requester_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requester does not have this shift assignment';
  END IF;
  IF v_requester_shift.schedule_status = 'swapped' THEN
    RAISE EXCEPTION 'Cannot exchange an already swapped duty';
  END IF;

  -- Validate: partner shift belongs to partner and is active
  SELECT * INTO v_partner_shift
    FROM shifts WHERE id = p_partner_shift_id AND user_id = p_partner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner does not have this shift assignment';
  END IF;
  IF v_partner_shift.schedule_status = 'swapped' THEN
    RAISE EXCEPTION 'Cannot exchange an already swapped duty';
  END IF;

  -- Validate: no duplicate/conflicting pending exchange for same requester+date
  IF EXISTS (
    SELECT 1 FROM duty_exchanges
    WHERE duty_date = p_duty_date
      AND (requesting_user_id = p_requester_id OR exchange_partner_id = p_requester_id)
      AND status NOT IN ('rejected', 'cancelled', 'completed')
  ) THEN
    RAISE EXCEPTION 'A pending or approved exchange already exists for this date';
  END IF;

  -- Get WSO IDs from the shifts if available
  v_requester_wso_id := v_requester_shift.wso_id;
  v_partner_wso_id := v_partner_shift.wso_id;

  -- Insert the exchange request
  INSERT INTO duty_exchanges (
    requesting_user_id, exchange_partner_id,
    requesting_user_shift_id, exchange_partner_shift_id,
    duty_date, reason, status
  ) VALUES (
    p_requester_id, p_partner_id,
    p_requester_shift_id, p_partner_shift_id,
    p_duty_date, p_reason, 'pending_partner'
  )
  RETURNING id INTO v_request_id;

  -- Insert 4 approval steps
  -- Step 1: Exchange partner approval
  INSERT INTO duty_exchange_approvals (request_id, approver_id, approver_role, sequence_order, status)
  VALUES (v_request_id, p_partner_id, 'partner', 1, 'pending');

  -- Step 2: Requester's WSO approval
  INSERT INTO duty_exchange_approvals (request_id, approver_id, approver_role, sequence_order, status)
  VALUES (v_request_id, v_requester_wso_id, 'wso', 2, 'pending');

  -- Step 3: Partner's WSO approval
  INSERT INTO duty_exchange_approvals (request_id, approver_id, approver_role, sequence_order, status)
  VALUES (v_request_id, v_partner_wso_id, 'wso', 3, 'pending');

  -- Step 4: Supervisor final approval
  INSERT INTO duty_exchange_approvals (request_id, approver_id, approver_role, sequence_order, status)
  VALUES (v_request_id, NULL, 'supervisor', 4, 'pending');

  RETURN v_request_id;
END;
$$;

-- ============================================================================
-- RPC: process_exchange_approval
-- Handles approve/reject for the current step, advances the workflow
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_exchange_approval(
  p_request_id UUID,
  p_approver_id UUID,
  p_action TEXT,  -- 'approve' or 'reject'
  p_remarks TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_step RECORD;
  v_exchange RECORD;
  v_next_status TEXT;
BEGIN
  -- Validate action
  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action. Use approve or reject.';
  END IF;

  -- Get the exchange
  SELECT * INTO v_exchange FROM duty_exchanges WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exchange request not found';
  END IF;

  -- Cannot act on already-finalized requests
  IF v_exchange.status IN ('approved', 'rejected', 'cancelled', 'completed') THEN
    RAISE EXCEPTION 'This exchange request has already been finalized';
  END IF;

  -- Find the current pending step (lowest sequence_order with status = 'pending')
  SELECT * INTO v_current_step
    FROM duty_exchange_approvals
    WHERE request_id = p_request_id AND status = 'pending'
    ORDER BY sequence_order ASC
    LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending approval step found';
  END IF;

  -- Validate approver: partner must match exactly, WSO/supervisor must have proper role
  IF v_current_step.approver_role = 'partner' THEN
    IF v_current_step.approver_id IS DISTINCT FROM p_approver_id THEN
      RAISE EXCEPTION 'Only the exchange partner can act on this step';
    END IF;
  ELSIF v_current_step.approver_role = 'wso' THEN
    IF NOT has_role(p_approver_id, 'wso') AND NOT has_role(p_approver_id, 'admin') THEN
      RAISE EXCEPTION 'Only a WSO can act on this step';
    END IF;
  ELSIF v_current_step.approver_role = 'supervisor' THEN
    IF NOT has_role(p_approver_id, 'supervisor') AND NOT has_role(p_approver_id, 'admin') THEN
      RAISE EXCEPTION 'Only a supervisor can act on this step';
    END IF;
  END IF;

  -- Record the action
  UPDATE duty_exchange_approvals
    SET status = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
        approver_id = p_approver_id,
        remarks = p_remarks,
        action_at = now()
    WHERE id = v_current_step.id;

  -- If rejected, mark the entire request as rejected immediately
  IF p_action = 'reject' THEN
    UPDATE duty_exchanges SET status = 'rejected', updated_at = now()
      WHERE id = p_request_id;

    RETURN jsonb_build_object('status', 'rejected', 'step', v_current_step.sequence_order);
  END IF;

  -- If approved, determine next status
  IF v_current_step.sequence_order = 1 THEN
    v_next_status := 'pending_wso';
  ELSIF v_current_step.sequence_order = 2 THEN
    -- Still pending WSO (partner's WSO is step 3)
    v_next_status := 'pending_wso';
  ELSIF v_current_step.sequence_order = 3 THEN
    v_next_status := 'pending_supervisor';
  ELSIF v_current_step.sequence_order = 4 THEN
    v_next_status := 'approved';
  END IF;

  UPDATE duty_exchanges SET status = v_next_status::exchange_status, updated_at = now()
    WHERE id = p_request_id;

  -- If final approval (step 4), execute the swap
  IF v_current_step.sequence_order = 4 THEN
    PERFORM execute_duty_swap(p_request_id);
  END IF;

  RETURN jsonb_build_object('status', v_next_status, 'step', v_current_step.sequence_order);
END;
$$;

-- ============================================================================
-- RPC: execute_duty_swap
-- Atomically swaps employee_id between two shift records
-- ============================================================================
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
BEGIN
  -- Lock the exchange row
  SELECT * INTO v_exchange
    FROM duty_exchanges
    WHERE id = p_request_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exchange request not found';
  END IF;

  -- Capture current user_ids
  SELECT user_id INTO v_req_user FROM shifts WHERE id = v_exchange.requesting_user_shift_id FOR UPDATE;
  SELECT user_id INTO v_partner_user FROM shifts WHERE id = v_exchange.exchange_partner_shift_id FOR UPDATE;

  -- Swap employee assignments
  UPDATE shifts SET user_id = v_partner_user, schedule_status = 'swapped', updated_at = now()
    WHERE id = v_exchange.requesting_user_shift_id;

  UPDATE shifts SET user_id = v_req_user, schedule_status = 'swapped', updated_at = now()
    WHERE id = v_exchange.exchange_partner_shift_id;

  -- Mark exchange as completed
  UPDATE duty_exchanges SET status = 'completed', updated_at = now()
    WHERE id = p_request_id;
END;
$$;

-- ============================================================================
-- RPC: get_exchange_approvals
-- Returns approval steps for a given exchange request
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_exchange_approvals(p_request_id UUID)
RETURNS TABLE (
  id UUID,
  request_id UUID,
  approver_id UUID,
  approver_role TEXT,
  sequence_order INT,
  status TEXT,
  remarks TEXT,
  action_at TIMESTAMPTZ,
  approver_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      dea.id,
      dea.request_id,
      dea.approver_id,
      dea.approver_role,
      dea.sequence_order,
      dea.status,
      dea.remarks,
      dea.action_at,
      p.full_name AS approver_name
    FROM duty_exchange_approvals dea
    LEFT JOIN profiles p ON p.id = dea.approver_id
    WHERE dea.request_id = p_request_id
    ORDER BY dea.sequence_order;
END;
$$;
