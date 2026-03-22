-- Add is_hidden column to profiles for admin to hide users from all views
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;
