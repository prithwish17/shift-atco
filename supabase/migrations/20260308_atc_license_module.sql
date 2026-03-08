-- ATC License Module Extensions
-- 1. Extend employee_licenses table
-- 2. Create medical_certificates table
-- 3. Create unit_endorsements table
-- 4. Create position_requirements table

-- ============================================
-- 1. Extend employee_licenses
-- ============================================
ALTER TABLE public.employee_licenses
  ADD COLUMN IF NOT EXISTS license_number TEXT,
  ADD COLUMN IF NOT EXISTS issued_by TEXT DEFAULT 'AAI',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'valid';

-- ============================================
-- 2. Medical Certificates
-- ============================================
CREATE TABLE IF NOT EXISTS public.medical_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medical_class TEXT NOT NULL DEFAULT 'Class 3',
  issue_date DATE,
  expiry_date DATE,
  status TEXT NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid', 'expired', 'pending_renewal')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, medical_class)
);

ALTER TABLE public.medical_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own medical"
  ON public.medical_certificates FOR SELECT
  USING (auth.uid() = employee_id);

CREATE POLICY "Supervisors view all medical"
  ON public.medical_certificates FOR SELECT
  USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'wso'));

CREATE POLICY "Supervisors manage medical"
  ON public.medical_certificates FOR ALL
  USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_medical_certificates_updated_at
  BEFORE UPDATE ON public.medical_certificates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 3. Unit Endorsements
-- ============================================
CREATE TABLE IF NOT EXISTS public.unit_endorsements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  airport TEXT NOT NULL DEFAULT 'VECC',
  position TEXT NOT NULL,
  issue_date DATE,
  expiry_date DATE,
  status TEXT NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid', 'expired', 'pending_renewal')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, airport, position)
);

ALTER TABLE public.unit_endorsements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own endorsements"
  ON public.unit_endorsements FOR SELECT
  USING (auth.uid() = employee_id);

CREATE POLICY "Supervisors view all endorsements"
  ON public.unit_endorsements FOR SELECT
  USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'wso'));

CREATE POLICY "Supervisors manage endorsements"
  ON public.unit_endorsements FOR ALL
  USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_unit_endorsements_updated_at
  BEFORE UPDATE ON public.unit_endorsements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 4. Position Requirements (rating→position map)
-- ============================================
CREATE TABLE IF NOT EXISTS public.position_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position TEXT NOT NULL,
  required_rating TEXT NOT NULL,
  UNIQUE(position, required_rating)
);

ALTER TABLE public.position_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view position requirements"
  ON public.position_requirements FOR SELECT
  USING (true);

CREATE POLICY "Admins manage position requirements"
  ON public.position_requirements FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Seed default position→rating mappings
INSERT INTO public.position_requirements (position, required_rating) VALUES
  ('TWR', 'adc'),
  ('APP', 'app'),
  ('ACC', 'rdr'),
  ('SMC', 'adc'),
  ('RSR', 'rdr'),
  ('PLR', 'plr'),
  ('OCC', 'occ')
ON CONFLICT (position, required_rating) DO NOTHING;

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_medical_employee ON public.medical_certificates(employee_id);
CREATE INDEX IF NOT EXISTS idx_medical_expiry ON public.medical_certificates(expiry_date);
CREATE INDEX IF NOT EXISTS idx_endorsements_employee ON public.unit_endorsements(employee_id);
CREATE INDEX IF NOT EXISTS idx_endorsements_expiry ON public.unit_endorsements(expiry_date);
CREATE INDEX IF NOT EXISTS idx_position_req_position ON public.position_requirements(position);
