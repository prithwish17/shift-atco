-- Enable pg_trgm extension for full-text and partial string matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN trigram indexes on profiles
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm ON public.profiles USING GIN (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_employee_id_trgm ON public.profiles USING GIN (employee_id gin_trgm_ops);

-- Create GIN trigram indexes on employee_schedules
CREATE INDEX IF NOT EXISTS idx_employee_schedules_employee_name_trgm ON public.employee_schedules USING GIN (employee_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_employee_schedules_employee_code_trgm ON public.employee_schedules USING GIN (employee_code gin_trgm_ops);
