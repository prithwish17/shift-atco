-- Add optional supervisor direct-approval path for leave requests.
-- Existing two-stage path remains valid:
--   Pending WSO -> Pending Supervisor -> Approved
-- New optional path:
--   Pending WSO -> Approved (direct by supervisor)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leave_requests'
      AND column_name = 'direct_supervisor_approved'
  ) THEN
    ALTER TABLE public.leave_requests
      ADD COLUMN direct_supervisor_approved BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN direct_supervisor_approved_by UUID REFERENCES auth.users(id),
      ADD COLUMN direct_supervisor_approved_at TIMESTAMPTZ,
      ADD COLUMN direct_supervisor_comments TEXT;
  END IF;
END $$;

ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_approval_path_check;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_approval_path_check
  CHECK (
    -- Enforce approval-path consistency only for Approved records.
    status <> 'Approved'
    OR (
      -- Standard two-stage approval path.
      (COALESCE(direct_supervisor_approved, false) = false
        AND wso_approved_by IS NOT NULL
        AND supervisor_approved_by IS NOT NULL)
      OR
      -- Direct supervisor approval path.
      (COALESCE(direct_supervisor_approved, false) = true
        AND supervisor_approved_by IS NOT NULL
        AND direct_supervisor_approved_by IS NOT NULL)
    )
  );
