ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS sap_applied BOOLEAN;

COMMENT ON COLUMN leave_requests.sap_applied IS
  'Whether the employee has already applied the same leave in SAP.';