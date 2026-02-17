
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS initials text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stream text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS alternate_email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address text;
