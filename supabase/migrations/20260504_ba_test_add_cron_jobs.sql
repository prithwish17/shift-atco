-- ─────────────────────────────────────────────────────────────────────────────
-- Add two new BA test fetch cron jobs: 08:10 IST and 08:45 IST
--
-- Full schedule after this migration:
--   05:40, 06:05, 08:10, 08:45, 11:40, 12:05, 17:40, 18:05 IST
--
-- IST → UTC (-5:30):
--   08:10 IST = 02:40 UTC  →  '40 2  * * *'
--   08:45 IST = 03:15 UTC  →  '15 3  * * *'
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. sync_jobs seed for the two new jobs ───────────────────────────────────

INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES
    ('ba-test-fetch-0810', 'fetch-ba-test', '40 2  * * *', true, '{"__cron_job_name":"ba-test-fetch-0810"}'),
    ('ba-test-fetch-0845', 'fetch-ba-test', '15 3  * * *', true, '{"__cron_job_name":"ba-test-fetch-0845"}')
ON CONFLICT (job_name) DO UPDATE SET
    edge_function_name = EXCLUDED.edge_function_name,
    cron_schedule      = EXCLUDED.cron_schedule,
    is_active          = true,
    payload            = EXCLUDED.payload,
    updated_at         = now();

-- ── 2. Register pg_cron jobs as queue inserts ────────────────────────────────

DO $$
DECLARE
    jobs text[][] := ARRAY[
        ARRAY['ba-test-fetch-0810', '40 2  * * *', 'fetch-ba-test', '{"__cron_job_name":"ba-test-fetch-0810"}'],
        ARRAY['ba-test-fetch-0845', '15 3  * * *', 'fetch-ba-test', '{"__cron_job_name":"ba-test-fetch-0845"}']
    ];
    j text[];
BEGIN
    FOREACH j SLICE 1 IN ARRAY jobs LOOP
        -- Idempotent: unschedule before re-registering
        BEGIN
            PERFORM cron.unschedule(j[1]);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        -- Register as a queue insert — avoids need for app.settings.supabase_url
        PERFORM cron.schedule(
            j[1],
            j[2],
            format(
                $q$INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by)
                VALUES (%L, %L, (%L::jsonb || jsonb_build_object('__cron_job_name', %L)), 'cron_job');$q$,
                j[1], j[3], j[4], j[1]
            )
        );

        RAISE NOTICE 'Registered % as queue-based cron job', j[1];
    END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--   SELECT job_name, cron_schedule, is_active
--   FROM sync_jobs WHERE job_name LIKE 'ba-test-fetch-%' ORDER BY job_name;
--
--   SELECT jobname, schedule FROM cron.job
--   WHERE jobname LIKE 'ba-test-fetch-%' ORDER BY jobname;
-- ─────────────────────────────────────────────────────────────────────────────
