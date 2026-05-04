CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_license text;
  is_self_service boolean := COALESCE(NEW.raw_user_meta_data->>'registration_source', '') = 'self-service';
BEGIN
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
    COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), 'New User'),
    COALESCE(NULLIF(TRIM(UPPER(NEW.raw_user_meta_data->>'employee_id')), ''), 'EMP' || EXTRACT(EPOCH FROM NOW())::TEXT),
    NEW.email,
    NULLIF(TRIM(NEW.raw_user_meta_data->>'mobile'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'designation'), ''),
    COALESCE(NULLIF(LOWER(NEW.raw_user_meta_data->>'current_shift'), ''), 'general')::public.shift_type
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      employee_id = EXCLUDED.employee_id,
      email = EXCLUDED.email,
      mobile = EXCLUDED.mobile,
      designation = EXCLUDED.designation,
      current_shift = EXCLUDED.current_shift;

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