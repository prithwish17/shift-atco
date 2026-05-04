-- ─────────────────────────────────────────────────────────────────────────────
-- Repair schedule-sync cron registration.
--
-- If production previously had roster jobs queueing but schedule jobs missing,
-- stale, disabled, or registered as direct HTTP calls, this migration reasserts
-- the six schedule-sync jobs as queue INSERT commands.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES
  ('schedule-sync-10h', 'fetch-schedule', '32 4  * * *', true, '{}'),
  ('schedule-sync-12h', 'fetch-schedule', '32 6  * * *', true, '{}'),
  ('schedule-sync-14h', 'fetch-schedule', '32 8  * * *', true, '{}'),
  ('schedule-sync-16h', 'fetch-schedule', '32 10 * * *', true, '{}'),
  ('schedule-sync-18h', 'fetch-schedule', '32 12 * * *', true, '{}'),
  ('schedule-sync-20h', 'fetch-schedule', '32 14 * * *', true, '{}')
ON CONFLICT (job_name) DO UPDATE SET
  edge_function_name = EXCLUDED.edge_function_name,
  cron_schedule      = EXCLUDED.cron_schedule,
  is_active          = true,
  payload            = EXCLUDED.payload,
  updated_at         = now();

DO $$
DECLARE
  jobs text[][] := ARRAY[
    ARRAY['schedule-sync-10h', '32 4  * * *', 'fetch-schedule', '{}'],
    ARRAY['schedule-sync-12h', '32 6  * * *', 'fetch-schedule', '{}'],
    ARRAY['schedule-sync-14h', '32 8  * * *', 'fetch-schedule', '{}'],
    ARRAY['schedule-sync-16h', '32 10 * * *', 'fetch-schedule', '{}'],
    ARRAY['schedule-sync-18h', '32 12 * * *', 'fetch-schedule', '{}'],
    ARRAY['schedule-sync-20h', '32 14 * * *', 'fetch-schedule', '{}']
  ];
  j text[];
BEGIN
  -- Remove old one-off/direct schedule jobs if they survived previous migrations.
  BEGIN PERFORM cron.unschedule('fetch-schedule'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('daily_fetch_schedule_1330'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('daily_fetch_schedule_1830'); EXCEPTION WHEN OTHERS THEN NULL; END;

  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      PERFORM cron.unschedule(j[1]);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      j[1],
      j[2],
      format(
        $q$INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by)
        VALUES (%L, %L, (%L::jsonb || jsonb_build_object('__cron_job_name', %L)), 'cron_job');$q$,
        j[1], j[3], j[4], j[1]
      )
    );
  END LOOP;
END $$;
