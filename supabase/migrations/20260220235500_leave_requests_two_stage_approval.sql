-- Add two-stage leave approval workflow on leave_requests
-- Flow: Pending WSO -> Pending Supervisor -> Approved

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leave_requests'
      AND column_name = 'wso_approved_by'
  ) THEN
    ALTER TABLE public.leave_requests
      ADD COLUMN wso_approved_by UUID REFERENCES auth.users(id),
      ADD COLUMN wso_approved_at TIMESTAMPTZ,
      ADD COLUMN wso_comments TEXT,
      ADD COLUMN supervisor_approved_by UUID REFERENCES auth.users(id),
      ADD COLUMN supervisor_approved_at TIMESTAMPTZ,
      ADD COLUMN supervisor_comments TEXT;
  END IF;
END $$;

UPDATE public.leave_requests
SET status = 'Pending WSO'
WHERE status = 'Pending';

ALTER TABLE public.leave_requests
  ALTER COLUMN status SET DEFAULT 'Pending WSO';

ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_status_check;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_status_check
  CHECK (status IN ('Pending WSO', 'Pending Supervisor', 'Approved', 'Rejected', 'Cancelled'));
