-- Migration: Update all active trainee records from status_pending → training_continue
-- This is a one-time data migration. Idempotent — safe to run multiple times.
--
-- Background:
--   The trainee status is stored as raw_payload->>'trainee_status' (a JSONB field).
--   When employees are added to the trainee list, they previously defaulted to
--   'status_pending'. Going forward, new additions default to 'training_continue'.
--   This migration backfills all existing records to match the new default.

UPDATE employee_training_records
SET raw_payload = jsonb_set(
    COALESCE(raw_payload, '{}'::jsonb),
    '{trainee_status}',
    '"training_continue"'::jsonb
)
WHERE
    -- Only active trainee records (has a unit or hours assigned)
    (trainee_unit IS NOT NULL OR trainee_hours_required IS NOT NULL)
    -- Only records with no meaningful status set
    AND (
        raw_payload->>'trainee_status' IS NULL
        OR raw_payload->>'trainee_status' = ''
        OR raw_payload->>'trainee_status' = 'status_pending'
    );
