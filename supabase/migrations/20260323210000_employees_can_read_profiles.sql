-- Allow all authenticated users (employees) to read basic profile info
-- Needed for duty exchange UI where employees must see partner names
-- Existing policies only let employees read their own profile

CREATE POLICY "All authenticated users can read profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- RPC: get_employee_directory
-- Returns a lightweight list of employee_code, employee_name, and profile id + current_shift
-- Bypasses RLS so employee typeahead always works even if profiles policy isn't applied
CREATE OR REPLACE FUNCTION public.get_employee_directory()
RETURNS TABLE (
  id UUID,
  employee_code TEXT,
  full_name TEXT,
  current_shift TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT ON (p.employee_id)
      p.id,
      p.employee_id::TEXT AS employee_code,
      p.full_name::TEXT,
      p.current_shift::TEXT
    FROM profiles p
    WHERE p.employee_id IS NOT NULL
      AND p.employee_id <> ''
    ORDER BY p.employee_id, p.full_name;
END;
$$;
