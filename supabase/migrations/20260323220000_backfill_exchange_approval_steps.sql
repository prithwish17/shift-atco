-- Backfill duty_exchange_approvals for existing exchanges that were created
-- before the approval workflow table existed (direct inserts / old code path).
-- Without these rows, process_exchange_approval throws "No pending approval step found"
-- and the partner cannot accept/decline.

DO $$
DECLARE
  v_ex RECORD;
BEGIN
  FOR v_ex IN
    SELECT de.id, de.requesting_user_id, de.exchange_partner_id, de.status
    FROM public.duty_exchanges de
    WHERE de.status NOT IN ('rejected', 'cancelled', 'completed')
      AND NOT EXISTS (
        SELECT 1 FROM public.duty_exchange_approvals dea WHERE dea.request_id = de.id
      )
  LOOP
    IF v_ex.status = 'pending_partner' THEN
      -- Step 1: partner must still approve
      INSERT INTO public.duty_exchange_approvals
        (request_id, approver_id, approver_role, sequence_order, status)
      VALUES
        (v_ex.id, v_ex.exchange_partner_id, 'partner', 1, 'pending');

      -- Steps 2-4: downstream, all pending
      INSERT INTO public.duty_exchange_approvals
        (request_id, approver_id, approver_role, sequence_order, status)
      VALUES
        (v_ex.id, NULL, 'wso',        2, 'pending'),
        (v_ex.id, NULL, 'wso',        3, 'pending'),
        (v_ex.id, NULL, 'supervisor', 4, 'pending');

    ELSIF v_ex.status = 'pending_wso' THEN
      -- Partner already approved (step 1 done), WSO is next
      INSERT INTO public.duty_exchange_approvals
        (request_id, approver_id, approver_role, sequence_order, status, action_at)
      VALUES
        (v_ex.id, v_ex.exchange_partner_id, 'partner', 1, 'approved', now());

      INSERT INTO public.duty_exchange_approvals
        (request_id, approver_id, approver_role, sequence_order, status)
      VALUES
        (v_ex.id, NULL, 'wso',        2, 'pending'),
        (v_ex.id, NULL, 'wso',        3, 'pending'),
        (v_ex.id, NULL, 'supervisor', 4, 'pending');

    ELSIF v_ex.status = 'pending_supervisor' THEN
      -- Partner + both WSOs approved, supervisor is next
      INSERT INTO public.duty_exchange_approvals
        (request_id, approver_id, approver_role, sequence_order, status, action_at)
      VALUES
        (v_ex.id, v_ex.exchange_partner_id, 'partner', 1, 'approved', now()),
        (v_ex.id, NULL,                     'wso',     2, 'approved', now()),
        (v_ex.id, NULL,                     'wso',     3, 'approved', now());

      INSERT INTO public.duty_exchange_approvals
        (request_id, approver_id, approver_role, sequence_order, status)
      VALUES
        (v_ex.id, NULL, 'supervisor', 4, 'pending');

    ELSIF v_ex.status = 'approved' THEN
      -- All steps done — mark all as approved for history
      INSERT INTO public.duty_exchange_approvals
        (request_id, approver_id, approver_role, sequence_order, status, action_at)
      VALUES
        (v_ex.id, v_ex.exchange_partner_id, 'partner',    1, 'approved', now()),
        (v_ex.id, NULL,                     'wso',        2, 'approved', now()),
        (v_ex.id, NULL,                     'wso',        3, 'approved', now()),
        (v_ex.id, NULL,                     'supervisor', 4, 'approved', now());
    END IF;
  END LOOP;
END;
$$;
