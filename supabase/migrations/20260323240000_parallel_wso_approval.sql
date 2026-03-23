-- ============================================================================
-- Parallel WSO Approval: Both WSOs must approve (AND gate) before supervisor
-- Steps 2 and 3 are now processed in parallel, not sequentially.
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

  -- ── Step lookup: parallel for WSO, sequential for everything else ──
  IF v_exchange.status = 'pending_wso' THEN
    -- Find the pending WSO step assigned to THIS approver specifically
    SELECT * INTO v_current_step
      FROM duty_exchange_approvals
      WHERE request_id = p_request_id
        AND status = 'pending'
        AND approver_role = 'wso'
        AND approver_id = p_approver_id
      ORDER BY sequence_order ASC
      LIMIT 1;

    -- If no step is specifically assigned, try an unassigned WSO step
    IF NOT FOUND THEN
      SELECT * INTO v_current_step
        FROM duty_exchange_approvals
        WHERE request_id = p_request_id
          AND status = 'pending'
          AND approver_role = 'wso'
          AND approver_id IS NULL
        ORDER BY sequence_order ASC
        LIMIT 1;
    END IF;

    -- If still not found, the WSO might not be authorised for any pending step
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No pending WSO approval step found for this approver. It may be assigned to a different WSO.';
    END IF;
  ELSE
    -- Standard sequential: pick the lowest pending step
    SELECT * INTO v_current_step
      FROM duty_exchange_approvals
      WHERE request_id = p_request_id AND status = 'pending'
      ORDER BY sequence_order ASC
      LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No pending approval step found';
    END IF;
  END IF;

  -- ── Validate approver identity / role ──
  IF v_current_step.approver_role = 'partner' THEN
    IF v_current_step.approver_id IS DISTINCT FROM p_approver_id THEN
      RAISE EXCEPTION 'Only the exchange partner can act on this step';
    END IF;
  ELSIF v_current_step.approver_role = 'wso' THEN
    IF NOT has_role(p_approver_id, 'wso') AND NOT has_role(p_approver_id, 'admin') THEN
      RAISE EXCEPTION 'Only a WSO can act on this step';
    END IF;
    -- If a specific WSO is assigned, only that WSO can approve
    IF v_current_step.approver_id IS NOT NULL AND v_current_step.approver_id IS DISTINCT FROM p_approver_id THEN
      RAISE EXCEPTION 'This step is assigned to a different WSO. Only the team WSO can approve this step.';
    END IF;
  ELSIF v_current_step.approver_role = 'supervisor' THEN
    IF NOT has_role(p_approver_id, 'supervisor') AND NOT has_role(p_approver_id, 'admin') THEN
      RAISE EXCEPTION 'Only a supervisor can act on this step';
    END IF;
  END IF;

  -- ── Record the action ──
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

  -- ── Determine next status after approval ──
  IF v_current_step.sequence_order = 1 THEN
    -- Partner approved → WSO phase begins (both steps 2 & 3 are now actionable)
    v_next_status := 'pending_wso';

  ELSIF v_current_step.approver_role = 'wso' THEN
    -- AND gate: only advance to supervisor when ALL WSO steps are approved
    IF NOT EXISTS (
      SELECT 1 FROM duty_exchange_approvals
      WHERE request_id = p_request_id
        AND approver_role = 'wso'
        AND status = 'pending'
    ) THEN
      v_next_status := 'pending_supervisor';
    ELSE
      v_next_status := 'pending_wso';
    END IF;

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
