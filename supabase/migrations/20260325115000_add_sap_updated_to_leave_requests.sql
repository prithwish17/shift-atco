ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS sap_updated BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN leave_requests.sap_updated IS
  'Whether the supervisor has manually marked this approved leave as updated in SAP.';
