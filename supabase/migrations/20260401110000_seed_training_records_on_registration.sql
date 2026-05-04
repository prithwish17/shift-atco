CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_license text;
  registration_source text;
  is_self_service boolean;
  is_admin_import boolean;
  resolved_full_name text;
  resolved_employee_id text;
  resolved_mobile text;
  resolved_designation text;
  resolved_shift public.shift_type;
BEGIN
  registration_source := COALESCE(NEW.raw_user_meta_data->>'registration_source', '');
  is_self_service := registration_source = 'self-service';
  is_admin_import := registration_source = 'admin-import';

  resolved_full_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), 'New User');
  resolved_employee_id := COALESCE(
    NULLIF(TRIM(UPPER(NEW.raw_user_meta_data->>'employee_id')), ''),
    'EMP' || EXTRACT(EPOCH FROM NOW())::TEXT
  );
  resolved_mobile := NULLIF(TRIM(NEW.raw_user_meta_data->>'mobile'), '');
  resolved_designation := NULLIF(TRIM(NEW.raw_user_meta_data->>'designation'), '');
  resolved_shift := COALESCE(NULLIF(LOWER(NEW.raw_user_meta_data->>'current_shift'), ''), 'general')::public.shift_type;

  INSERT INTO public.profiles (
    id,
    full_name,
    employee_id,
    email,
    mobile,
    designation,
    current_shift
  )
  VALUES (
    NEW.id,
    resolved_full_name,
    resolved_employee_id,
    NEW.email,
    resolved_mobile,
    resolved_designation,
    resolved_shift
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      employee_id = EXCLUDED.employee_id,
      email = EXCLUDED.email,
      mobile = EXCLUDED.mobile,
      designation = EXCLUDED.designation,
      current_shift = EXCLUDED.current_shift;

  IF is_self_service OR is_admin_import THEN
    INSERT INTO public.employee_training_records (
      emp_id,
      employee_name,
      raw_payload,
      source
    )
    VALUES (
      resolved_employee_id,
      resolved_full_name,
      '{}'::jsonb,
      CASE
        WHEN is_self_service THEN 'self-service-registration'
        ELSE 'admin-registration'
      END
    )
    ON CONFLICT (emp_id) DO NOTHING;
  END IF;

  IF is_self_service THEN
    INSERT INTO public.user_roles (user_id, role, approved)
    VALUES (NEW.id, 'employee', FALSE)
    ON CONFLICT (user_id, role) DO NOTHING;

    FOR requested_license IN
      SELECT jsonb_array_elements_text(COALESCE(NEW.raw_user_meta_data->'licenses', '[]'::jsonb))
    LOOP
      INSERT INTO public.employee_licenses (user_id, license_type)
      VALUES (NEW.id, LOWER(requested_license)::public.license_type)
      ON CONFLICT (user_id, license_type) DO NOTHING;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

INSERT INTO public.employee_training_records (
  emp_id,
  employee_name,
  raw_payload,
  source
)
SELECT
  p.employee_id,
  p.full_name,
  '{}'::jsonb,
  'registration-backfill'
FROM public.profiles p
WHERE NULLIF(TRIM(p.employee_id), '') IS NOT NULL
  AND NULLIF(TRIM(p.full_name), '') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p.id
      AND ur.role = 'employee'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.employee_training_records etr
    WHERE etr.emp_id = p.employee_id
  );
