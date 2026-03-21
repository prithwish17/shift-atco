-- Training data persistence for OJTI / Examiner records

CREATE TABLE IF NOT EXISTS public.employee_training_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_id TEXT NOT NULL UNIQUE,
  employee_name TEXT NOT NULL,
  license_number TEXT,
  ojti JSONB NOT NULL DEFAULT '{}'::jsonb,
  examiner JSONB NOT NULL DEFAULT '{}'::jsonb,
  completion_dates JSONB NOT NULL DEFAULT '{}'::jsonb,
  instructor_validity JSONB NOT NULL DEFAULT '{}'::jsonb,
  examiner_validity JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'training_webapp',
  sync_batch_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_training_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees view own training records" ON public.employee_training_records;
CREATE POLICY "Employees view own training records"
  ON public.employee_training_records FOR SELECT TO authenticated
  USING (
    emp_id = (
      SELECT employee_id FROM public.profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Staff view all training records" ON public.employee_training_records;
CREATE POLICY "Staff view all training records"
  ON public.employee_training_records FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'wso')
  );

DROP POLICY IF EXISTS "Staff update training records" ON public.employee_training_records;
CREATE POLICY "Staff update training records"
  ON public.employee_training_records FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'wso')
  )
  WITH CHECK (
    has_role(auth.uid(), 'supervisor')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'wso')
  );

DROP POLICY IF EXISTS "Staff insert training records" ON public.employee_training_records;
CREATE POLICY "Staff insert training records"
  ON public.employee_training_records FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'supervisor')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'wso')
  );

DROP POLICY IF EXISTS "Service role manage training records" ON public.employee_training_records;
CREATE POLICY "Service role manage training records"
  ON public.employee_training_records FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_employee_training_records_updated_at ON public.employee_training_records;
CREATE TRIGGER update_employee_training_records_updated_at
  BEFORE UPDATE ON public.employee_training_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_employee_training_records_name ON public.employee_training_records(employee_name);
CREATE INDEX IF NOT EXISTS idx_employee_training_records_license_number ON public.employee_training_records(license_number);

INSERT INTO public.app_settings (key, value, label)
VALUES (
  'training_data_webapp_url',
  'https://script.google.com/macros/s/AKfycbzkGpqGjRkvOPAOOsDsjnjPz1FIU0ceRLAv2xsogsKkozKClZTL1WsPnRPvdduaIouS/exec',
  'Training Data Webapp URL'
)
ON CONFLICT (key) DO NOTHING;