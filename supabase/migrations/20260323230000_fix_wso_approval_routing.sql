-- Fix WSO approval routing: assign specific WSO per team, prevent same WSO from
-- approving both steps if the employees are on different teams.

-- ============================================================================
-- 1. Updated create_duty_exchange_request: resolve WSO from profiles.current_shift
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
  v_requester_team TEXT;
  v_partner_team TEXT;
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

  -- Resolve team (current_shift) for requester and partner
  SELECT current_shift INTO v_requester_team FROM profiles WHERE id = p_requester_id;
  SELECT current_shift INTO v_partner_team FROM profiles WHERE id = p_partner_id;

  -- Find the WSO for requester's team: a user with role 'wso' on the same current_shift
  SELECT p.id INTO v_requester_wso_id
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id
    WHERE ur.role = 'wso' AND ur.approved = true
      AND p.current_shift = v_requester_team
    LIMIT 1;

  -- Find the WSO for partner's team
  SELECT p.id INTO v_partner_wso_id
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id
    WHERE ur.role = 'wso' AND ur.approved = true
      AND p.current_shift = v_partner_team
    LIMIT 1;

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

  -- Step 2: Requester's team WSO approval
  INSERT INTO duty_exchange_approvals (request_id, approver_id, approver_role, sequence_order, status)
  VALUES (v_request_id, v_requester_wso_id, 'wso', 2, 'pending');

  -- Step 3: Partner's team WSO approval
  -- If both on the same team (same WSO), auto-approve step 3
  IF v_requester_team = v_partner_team OR v_requester_wso_id IS NOT DISTINCT FROM v_partner_wso_id THEN
    INSERT INTO duty_exchange_approvals (request_id, approver_id, approver_role, sequence_order, status, action_at)
    VALUES (v_request_id, v_partner_wso_id, 'wso', 3, 'approved', now());
  ELSE
    INSERT INTO duty_exchange_approvals (request_id, approver_id, approver_role, sequence_order, status)
    VALUES (v_request_id, v_partner_wso_id, 'wso', 3, 'pending');
  END IF;

  -- Step 4: Supervisor final approval
  INSERT INTO duty_exchange_approvals (request_id, approver_id, approver_role, sequence_order, status)
  VALUES (v_request_id, NULL, 'supervisor', 4, 'pending');

  RETURN v_request_id;
END;
$$;

-- ============================================================================
-- 2. Updated process_exchange_approval: enforce specific WSO for assigned steps
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

  -- Validate approver
  IF v_current_step.approver_role = 'partner' THEN
    IF v_current_step.approver_id IS DISTINCT FROM p_approver_id THEN
      RAISE EXCEPTION 'Only the exchange partner can act on this step';
    END IF;
  ELSIF v_current_step.approver_role = 'wso' THEN
    -- Must have WSO (or admin) role
    IF NOT has_role(p_approver_id, 'wso') AND NOT has_role(p_approver_id, 'admin') THEN
      RAISE EXCEPTION 'Only a WSO can act on this step';
    END IF;
    -- If a specific WSO is assigned to this step, only that WSO can approve
    IF v_current_step.approver_id IS NOT NULL AND v_current_step.approver_id IS DISTINCT FROM p_approver_id THEN
      RAISE EXCEPTION 'This step is assigned to a different WSO. Only the team WSO can approve this step.';
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
    -- Check if step 3 is already approved (same-team case)
    IF EXISTS (
      SELECT 1 FROM duty_exchange_approvals
      WHERE request_id = p_request_id AND sequence_order = 3 AND status = 'approved'
    ) THEN
      v_next_status := 'pending_supervisor';
    ELSE
      v_next_status := 'pending_wso';
    END IF;
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
