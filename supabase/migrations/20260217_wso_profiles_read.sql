-- Add WSO role to profiles SELECT policy so they can view all employee names
-- This is needed for roster sync to match employee names to profile IDs

-- Drop and recreate the admin/supervisor policy to include WSO
DROP POLICY IF EXISTS "Admins and supervisors can view all profiles" ON public.profiles;

CREATE POLICY "Admins supervisors and WSOs can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'wso')
  );
