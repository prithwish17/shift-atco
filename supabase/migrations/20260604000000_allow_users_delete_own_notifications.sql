-- Allow users to clear notifications from their own in-app inbox.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'Users delete own notifications'
  ) THEN
    CREATE POLICY "Users delete own notifications"
      ON public.notifications FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
