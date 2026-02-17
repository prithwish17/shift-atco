-- Create leave_type enum
CREATE TYPE leave_type AS ENUM ('cl', 'rh', 'el', 'hpl', 'comp_off');

-- Create leave_status enum
CREATE TYPE leave_status AS ENUM ('pending_wso', 'pending_supervisor', 'approved', 'rejected');

-- Create exchange_status enum
CREATE TYPE exchange_status AS ENUM ('pending_wso', 'pending_supervisor', 'approved', 'rejected', 'cancelled');

-- Create holiday_category enum
CREATE TYPE holiday_category AS ENUM ('closed', 'reserved', 'national');

-- Create leaves table
CREATE TABLE public.leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  leave_type leave_type NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status leave_status NOT NULL DEFAULT 'pending_wso',
  wso_approved_by UUID REFERENCES auth.users(id),
  wso_approved_at TIMESTAMP WITH TIME ZONE,
  wso_comments TEXT,
  supervisor_approved_by UUID REFERENCES auth.users(id),
  supervisor_approved_at TIMESTAMP WITH TIME ZONE,
  supervisor_comments TEXT,
  days_count INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create duty_exchanges table
CREATE TABLE public.duty_exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange_partner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requesting_user_shift_id UUID NOT NULL REFERENCES public.shifts(id),
  exchange_partner_shift_id UUID NOT NULL REFERENCES public.shifts(id),
  reason TEXT NOT NULL,
  status exchange_status NOT NULL DEFAULT 'pending_wso',
  wso_approved_by UUID REFERENCES auth.users(id),
  wso_approved_at TIMESTAMP WITH TIME ZONE,
  wso_comments TEXT,
  supervisor_approved_by UUID REFERENCES auth.users(id),
  supervisor_approved_at TIMESTAMP WITH TIME ZONE,
  supervisor_comments TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create holidays table
CREATE TABLE public.holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_name TEXT NOT NULL,
  holiday_date DATE NOT NULL,
  category holiday_category NOT NULL,
  comp_off_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create leave_balances table
CREATE TABLE public.leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  leave_type leave_type NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  expiry_date DATE,
  year INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, leave_type, year)
);

-- Enable RLS on all tables
ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;

-- RLS Policies for leaves
CREATE POLICY "Users can view their own leaves"
  ON public.leaves FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own leaves"
  ON public.leaves FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "WSOs and supervisors can view all leaves"
  ON public.leaves FOR SELECT
  USING (has_role(auth.uid(), 'wso') OR has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "WSOs and supervisors can update leaves"
  ON public.leaves FOR UPDATE
  USING (has_role(auth.uid(), 'wso') OR has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

-- RLS Policies for duty_exchanges
CREATE POLICY "Users can view their own exchanges"
  ON public.duty_exchanges FOR SELECT
  USING (auth.uid() = requesting_user_id OR auth.uid() = exchange_partner_id);

CREATE POLICY "Users can create exchanges"
  ON public.duty_exchanges FOR INSERT
  WITH CHECK (auth.uid() = requesting_user_id);

CREATE POLICY "WSOs and supervisors can view all exchanges"
  ON public.duty_exchanges FOR SELECT
  USING (has_role(auth.uid(), 'wso') OR has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "WSOs and supervisors can update exchanges"
  ON public.duty_exchanges FOR UPDATE
  USING (has_role(auth.uid(), 'wso') OR has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

-- RLS Policies for holidays
CREATE POLICY "Everyone can view holidays"
  ON public.holidays FOR SELECT
  USING (true);

CREATE POLICY "Supervisors and admins can manage holidays"
  ON public.holidays FOR ALL
  USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

-- RLS Policies for leave_balances
CREATE POLICY "Users can view their own leave balances"
  ON public.leave_balances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Supervisors and admins can view all leave balances"
  ON public.leave_balances FOR SELECT
  USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Supervisors and admins can manage leave balances"
  ON public.leave_balances FOR ALL
  USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

-- Triggers for updated_at
CREATE TRIGGER update_leaves_updated_at
  BEFORE UPDATE ON public.leaves
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_duty_exchanges_updated_at
  BEFORE UPDATE ON public.duty_exchanges
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_holidays_updated_at
  BEFORE UPDATE ON public.holidays
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_leave_balances_updated_at
  BEFORE UPDATE ON public.leave_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_leaves_user_id ON public.leaves(user_id);
CREATE INDEX idx_leaves_status ON public.leaves(status);
CREATE INDEX idx_leaves_dates ON public.leaves(start_date, end_date);

CREATE INDEX idx_duty_exchanges_requesting_user ON public.duty_exchanges(requesting_user_id);
CREATE INDEX idx_duty_exchanges_partner ON public.duty_exchanges(exchange_partner_id);
CREATE INDEX idx_duty_exchanges_status ON public.duty_exchanges(status);

CREATE INDEX idx_holidays_date ON public.holidays(holiday_date);
CREATE INDEX idx_holidays_category ON public.holidays(category);

CREATE INDEX idx_leave_balances_user ON public.leave_balances(user_id);
CREATE INDEX idx_leave_balances_year ON public.leave_balances(year);