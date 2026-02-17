-- Create enum for duty types
DO $$ BEGIN
  CREATE TYPE duty_type AS ENUM ('M', 'A', 'N', 'NO', 'CO', 'OFF', 'OPE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create enum for duty positions
DO $$ BEGIN
  CREATE TYPE duty_position AS ENUM ('RDR', 'APP', 'PLR', 'ADC', 'ALPHA', 'OCC');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create enum for attendance status
DO $$ BEGIN
  CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'on_leave');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create shifts table for shift assignments
CREATE TABLE IF NOT EXISTS public.shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  shift_type shift_type NOT NULL,
  duty_type duty_type NOT NULL,
  duty_position duty_position,
  is_ope BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id, shift_date)
);

-- Create attendance table
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  status attendance_status NOT NULL DEFAULT 'present',
  time_in TIMESTAMP WITH TIME ZONE,
  time_out TIMESTAMP WITH TIME ZONE,
  duty_position duty_position,
  marked_by UUID NOT NULL REFERENCES auth.users(id),
  comments TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, attendance_date)
);

-- Create BA tests table
CREATE TABLE IF NOT EXISTS public.ba_tests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  test_date DATE NOT NULL,
  shift_type shift_type NOT NULL,
  test_time TIMESTAMP WITH TIME ZONE NOT NULL,
  selected_users UUID[] NOT NULL,
  generated_by UUID NOT NULL REFERENCES auth.users(id),
  completed BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ba_tests ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shifts table
CREATE POLICY "Users can view their own shifts"
  ON public.shifts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Supervisors and WSOs can view all shifts"
  ON public.shifts FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'supervisor'::app_role) OR 
    has_role(auth.uid(), 'wso'::app_role)
  );

CREATE POLICY "Supervisors and WSOs can manage shifts"
  ON public.shifts FOR ALL
  USING (
    has_role(auth.uid(), 'supervisor'::app_role) OR 
    has_role(auth.uid(), 'wso'::app_role)
  );

-- RLS Policies for attendance table
CREATE POLICY "Users can view their own attendance"
  ON public.attendance FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Supervisors and WSOs can view all attendance"
  ON public.attendance FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'supervisor'::app_role) OR 
    has_role(auth.uid(), 'wso'::app_role)
  );

CREATE POLICY "Supervisors and WSOs can manage attendance"
  ON public.attendance FOR ALL
  USING (
    has_role(auth.uid(), 'supervisor'::app_role) OR 
    has_role(auth.uid(), 'wso'::app_role)
  );

-- RLS Policies for BA tests table
CREATE POLICY "WSOs and supervisors can view BA tests"
  ON public.ba_tests FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'supervisor'::app_role) OR 
    has_role(auth.uid(), 'wso'::app_role)
  );

CREATE POLICY "WSOs can manage BA tests"
  ON public.ba_tests FOR ALL
  USING (has_role(auth.uid(), 'wso'::app_role));

-- Create triggers for updated_at
CREATE TRIGGER update_shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_attendance_updated_at
  BEFORE UPDATE ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ba_tests_updated_at
  BEFORE UPDATE ON public.ba_tests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_shifts_user_date ON public.shifts(user_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_date_type ON public.shifts(shift_date, shift_type);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON public.attendance(user_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_ba_tests_date ON public.ba_tests(test_date, shift_type);