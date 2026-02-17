-- First update existing employee IDs to match format
UPDATE profiles
SET employee_id = UPPER(REGEXP_REPLACE(employee_id, '[^A-Z0-9]', '', 'g'))
WHERE employee_id !~ '^[A-Z0-9]+$';

-- Now add validation constraints
-- Email format validation
ALTER TABLE profiles 
ADD CONSTRAINT valid_email_format 
CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Employee ID format validation (more flexible - allows any format as long as it's not empty)
ALTER TABLE profiles 
ADD CONSTRAINT valid_employee_id_not_empty 
CHECK (LENGTH(TRIM(employee_id)) >= 1 AND LENGTH(employee_id) <= 50);

-- Full name length limits
ALTER TABLE profiles 
ADD CONSTRAINT full_name_length 
CHECK (LENGTH(TRIM(full_name)) >= 2 AND LENGTH(full_name) <= 100);

-- Mobile number format (optional, but if provided must be valid)
ALTER TABLE profiles 
ADD CONSTRAINT valid_mobile_format 
CHECK (mobile IS NULL OR (mobile ~ '^\+?[0-9]{10,15}$'));

-- Designation length limits
ALTER TABLE profiles 
ADD CONSTRAINT designation_length 
CHECK (designation IS NULL OR LENGTH(designation) <= 100);

-- Leave reason validation
ALTER TABLE leaves 
ADD CONSTRAINT leave_reason_length 
CHECK (LENGTH(TRIM(reason)) >= 10 AND LENGTH(reason) <= 500);

-- Duty exchange reason validation
ALTER TABLE duty_exchanges 
ADD CONSTRAINT exchange_reason_length 
CHECK (LENGTH(TRIM(reason)) >= 10 AND LENGTH(reason) <= 500);

-- Holiday name validation
ALTER TABLE holidays 
ADD CONSTRAINT holiday_name_length 
CHECK (LENGTH(TRIM(holiday_name)) >= 2 AND LENGTH(holiday_name) <= 100);

-- Comments validation (if provided)
ALTER TABLE leaves 
ADD CONSTRAINT wso_comments_length 
CHECK (wso_comments IS NULL OR LENGTH(wso_comments) <= 500);

ALTER TABLE leaves 
ADD CONSTRAINT supervisor_comments_length 
CHECK (supervisor_comments IS NULL OR LENGTH(supervisor_comments) <= 500);

ALTER TABLE duty_exchanges 
ADD CONSTRAINT wso_comments_exchange_length 
CHECK (wso_comments IS NULL OR LENGTH(wso_comments) <= 500);

ALTER TABLE duty_exchanges 
ADD CONSTRAINT supervisor_comments_exchange_length 
CHECK (supervisor_comments IS NULL OR LENGTH(supervisor_comments) <= 500);

-- BA test notes validation
ALTER TABLE ba_tests 
ADD CONSTRAINT ba_test_notes_length 
CHECK (notes IS NULL OR LENGTH(notes) <= 500);

-- Shift notes validation
ALTER TABLE shifts 
ADD CONSTRAINT shift_notes_length 
CHECK (notes IS NULL OR LENGTH(notes) <= 500);

-- Attendance comments validation
ALTER TABLE attendance 
ADD CONSTRAINT attendance_comments_length 
CHECK (comments IS NULL OR LENGTH(comments) <= 500);