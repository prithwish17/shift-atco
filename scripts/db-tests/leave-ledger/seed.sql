-- ─────────────────────────────────────────────────────────────────────────────
-- The state production is in before the 20261005 migrations: a register the
-- old sync filled from the sheet, approvals that exist only in leave_requests,
-- and one comp-off the app allocated onto a sheet-owned row.
-- Applied after the existing leave migrations and before the new ones.
-- ─────────────────────────────────────────────────────────────────────────────

-- People. 0a admin, 0b supervisor, 0c WSO, e1-e5 employees (e4 has no code).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000b', 'sup@test'),
  ('00000000-0000-0000-0000-00000000000c', 'wso@test'),
  ('00000000-0000-0000-0000-0000000000e1', 'e1@test'),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@test'),
  ('00000000-0000-0000-0000-0000000000e3', 'e3@test'),
  ('00000000-0000-0000-0000-0000000000e4', 'e4@test'),
  ('00000000-0000-0000-0000-0000000000e5', 'e5@test');

INSERT INTO public.profiles (id, employee_id, full_name, current_shift) VALUES
  ('00000000-0000-0000-0000-00000000000a', '90000001', 'ADMIN', NULL),
  ('00000000-0000-0000-0000-00000000000b', '90000002', 'SUPERVISOR', NULL),
  ('00000000-0000-0000-0000-00000000000c', '90000003', 'WSO', NULL),
  ('00000000-0000-0000-0000-0000000000e1', '10000001', 'ALPHA ONE', 'A'),
  ('00000000-0000-0000-0000-0000000000e2', '10000002', 'BETA TWO', 'B'),
  ('00000000-0000-0000-0000-0000000000e3', '10000003', 'GAMMA THREE', 'C'),
  ('00000000-0000-0000-0000-0000000000e4', NULL, 'NO CODE', 'C'),
  ('00000000-0000-0000-0000-0000000000e5', '10000005', 'EPSILON FIVE', 'D');

INSERT INTO public.user_roles (user_id, role, approved) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin', true),
  ('00000000-0000-0000-0000-00000000000b', 'supervisor', true),
  ('00000000-0000-0000-0000-00000000000c', 'wso', true);

-- ── The register as the old sync left it ────────────────────────────────────
INSERT INTO public.employee_leave_records
  (emp_id, employee_name, status, leave_category, source_event_type, event_kind,
   leave_date, leave_used_on, duty_code, raw_date_value, raw_event, metadata, source, sync_batch_id)
VALUES
  ('10000001', 'ALPHA ONE', 'Active', 'CL', 'CL', 'leave', '2026-02-10', NULL, '', '10-Feb-2026', '{}', '{}', 'google_sheets', 'leave-sync-1'),
  ('10000001', 'ALPHA ONE', 'Active', 'CL', 'CL', 'leave', '2026-03-05', NULL, '', '05-Mar-2026', '{}', '{}', 'google_sheets', 'leave-sync-1'),
  ('10000001', 'ALPHA ONE', 'Active', 'RH', 'RH', 'leave', '2026-01-01', NULL, '', '01-Jan-2026',
     '{"date":"01-Jan-2026","leaveApplied":"26-Mar-2026"}',
     '{"rh_date":"2026-01-01","leave_applied":"2026-03-26"}', 'google_sheets', 'leave-sync-1'),
  ('10000001', 'ALPHA ONE', 'Active', 'COMP_OFF_EARNED', 'COMP_OFF_DUTY', 'comp_off_earned', '2026-01-23', NULL, 'M', '23-Jan-2026', '{}',
     '{"duty_date":"2026-01-23","duty_performed":"M","leave_used_on":null,"leave_applied":"","comp_off_eligible":true,"expiry_date":"2026-04-22","source_type":"COMP_OFF_DUTY"}',
     'google_sheets', 'leave-sync-1'),
  ('10000001', 'ALPHA ONE', 'Active', 'OPE', 'OPE', 'comp_off_earned', '2025-12-03', NULL, '', '03-Dec-2025', '{}',
     '{"ope_duty_date":"2025-12-03","duty_date":"2025-12-03","duty_performed":"OPE","comp_off_eligible":true,"source_type":"OPE_DUTY"}',
     'google_sheets', 'leave-sync-1'),
  ('10000002', 'BETA TWO', 'Active', 'CL', 'CL', 'leave', '2026-04-01', NULL, '', '01-Apr-2026', '{}', '{}', 'google_sheets', 'leave-sync-1'),
  ('10000002', 'BETA TWO', 'Active', 'COMP_OFF_EARNED', 'COMP_OFF_DUTY', 'comp_off_earned', '2026-03-04', NULL, 'N', '04-Mar-2026', '{}',
     '{"duty_date":"2026-03-04","duty_performed":"N","leave_used_on":null,"leave_applied":"","comp_off_eligible":true,"expiry_date":"2026-06-03","source_type":"COMP_OFF_DUTY"}',
     'google_sheets', 'leave-sync-1');

-- Forty sheet-only employees with three CLs each: the bulk a truncated feed
-- would put at risk.
INSERT INTO public.employee_leave_records
  (emp_id, employee_name, status, leave_category, source_event_type, event_kind,
   leave_date, duty_code, raw_date_value, raw_event, metadata, source, sync_batch_id)
SELECT (10000100 + e)::TEXT, 'SHEET ONLY ' || e, 'Active', 'CL', 'CL', 'leave',
       d, '', to_char(d, 'DD-Mon-YYYY'), '{}', '{}', 'google_sheets', 'leave-sync-1'
  FROM generate_series(0, 39) AS e,
       unnest(ARRAY['2026-01-05', '2026-02-05', '2026-03-05']::DATE[]) AS d;

-- The sheet's own view of those rows, before the app touched any of them.
-- Scenarios start their simulated feed from this.
CREATE TABLE public.__test_sheet_snapshot AS
SELECT emp_id, employee_name, sl_no, status, leave_category, source_event_type, event_kind,
       leave_date, leave_used_on, duty_code, raw_date_value, raw_shift_value,
       raw_leave_used_value, raw_event, COALESCE(metadata, '{}'::JSONB) AS metadata
  FROM public.employee_leave_records;

-- ── Approvals that exist only in leave_requests ─────────────────────────────
INSERT INTO public.leave_requests
  (id, employee_id, employee_name, leave_type, start_date, end_date, total_days, status,
   supervisor_approved_by, supervisor_approved_at, direct_supervisor_approved,
   direct_supervisor_approved_by, direct_supervisor_approved_at, actual_rh_date)
VALUES
  -- already in the sheet → should be linked, not duplicated
  ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'ALPHA ONE', 'CL',
   '2026-03-05', '2026-03-05', 1, 'Approved', '00000000-0000-0000-0000-00000000000b', now(), true,
   '00000000-0000-0000-0000-00000000000b', now(), NULL),
  -- not in the sheet → two app rows
  ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1', 'ALPHA ONE', 'CL',
   '2026-05-11', '2026-05-12', 2, 'Approved', '00000000-0000-0000-0000-00000000000b', now(), true,
   '00000000-0000-0000-0000-00000000000b', now(), NULL),
  -- RH declared against 1 Jan, taken 10 Jun → keyed by 1 Jan
  ('11111111-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e2', 'BETA TWO', 'RH',
   '2026-06-10', '2026-06-10', 1, 'Approved', '00000000-0000-0000-0000-00000000000b', now(), true,
   '00000000-0000-0000-0000-00000000000b', now(), '2026-01-01'),
  -- legacy RH with no RH date → cannot be keyed, skipped
  ('11111111-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000e2', 'BETA TWO', 'RH',
   '2026-07-15', '2026-07-15', 1, 'Approved', '00000000-0000-0000-0000-00000000000b', now(), true,
   '00000000-0000-0000-0000-00000000000b', now(), NULL),
  -- comp-off: recorded by stamping, never by a new row
  ('11111111-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000e2', 'BETA TWO', 'COMP_OFF',
   '2026-05-02', '2026-05-02', 1, 'Approved', '00000000-0000-0000-0000-00000000000b', now(), true,
   '00000000-0000-0000-0000-00000000000b', now(), NULL),
  -- EL: no sheet column, still belongs in the register
  ('11111111-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000e3', 'GAMMA THREE', 'EL',
   '2026-02-02', '2026-02-03', 2, 'Approved', '00000000-0000-0000-0000-00000000000b', now(), true,
   '00000000-0000-0000-0000-00000000000b', now(), NULL);

-- cancelled → ignored
INSERT INTO public.leave_requests (id, employee_id, employee_name, leave_type, start_date, end_date, total_days, status)
VALUES ('11111111-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000e1', 'ALPHA ONE', 'CL',
        '2026-06-01', '2026-06-01', 1, 'Cancelled');

-- The app allocated E2's earned comp-off to request 5 (pre-migration RPC, run
-- as a backend session).
SELECT public.allocate_comp_off_for_leave(
  '11111111-0000-0000-0000-000000000005',
  ARRAY[(SELECT id FROM public.employee_leave_records
          WHERE emp_id = '10000002' AND leave_category = 'COMP_OFF_EARNED')],
  ARRAY['2026-05-02'], 'BETA TWO', '2026-05-02', '2026-05-02');
