import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(supabaseUrl, serviceRoleKey);

// Max wall-clock time (ms) to spend in a single invocation.
// Edge function hard-limit is ~60s; leave 10s headroom.
const TIME_BUDGET_MS = 50_000;

// Max jobs to process in one invocation, regardless of time budget.
// Each job can take up to 55s, so this prevents a theoretical overrun.
const MAX_JOBS_PER_RUN = 5;

type QueueJob = {
    id: string;
    job_name: string;
    edge_function_name: string;
    payload: Record<string, unknown>;
    status: string;
    triggered_by: string;
};

Deno.serve(async () => {
    const invocationStart = Date.now();
    const results: Array<{ job_name: string; status: string; elapsed_ms: number }> = [];

    // ── Step 1: Mark stale running jobs as failed ─────────────────────────────
    // Any job still in 'running' after 5 minutes is considered a zombie.
    const { data: staleCount } = await adminClient.rpc("cleanup_stale_queue_jobs", {
        p_timeout_minutes: 5,
    });
    if ((staleCount ?? 0) > 0) {
        console.log(`[process-cron-queue] Recovered ${staleCount} stale running job(s)`);
    }

    // ── Step 2: Loop — claim and execute jobs until budget is exhausted ────────
    let jobsProcessed = 0;

    while (jobsProcessed < MAX_JOBS_PER_RUN) {
        // Stop if we're close to the time budget
        if (Date.now() - invocationStart >= TIME_BUDGET_MS) {
            console.log(`[process-cron-queue] Time budget (${TIME_BUDGET_MS}ms) reached after ${jobsProcessed} job(s)`);
            break;
        }

        // Atomically claim the next pending job (SELECT FOR UPDATE SKIP LOCKED)
        // .maybeSingle() is critical: the SQL function RETURNS a composite type,
        // and PostgREST wraps composite returns in an array by default.
        // Without .maybeSingle(), `data` would be [{...}] or [] (always truthy),
        // causing the code to treat an array as a QueueJob object — all
        // properties become undefined, jobs get claimed but never processed.
        const { data: rawJob, error: claimError } = await adminClient
            .rpc("claim_next_queue_job")
            .maybeSingle();

        if (claimError) {
            console.error("[process-cron-queue] Failed to claim job:", claimError);
            break;
        }

        if (!rawJob) {
            // Queue is empty — normal, most invocations will hit this
            break;
        }

        // Defensive: handle both single-object and legacy array-wrapped responses
        const claimed: QueueJob = Array.isArray(rawJob) ? rawJob[0] : rawJob;
        if (!claimed?.id || !claimed?.edge_function_name) {
            console.error("[process-cron-queue] Invalid job data after claim:", rawJob);
            break;
        }
        const jobStart = Date.now();
        console.log(`[process-cron-queue] Processing (${jobsProcessed + 1}): ${claimed.job_name} (${claimed.edge_function_name})`);

        // ── Step 3: Invoke the target edge function ───────────────────────────
        let jobStatus = "completed";
        let errorMessage: string | null = null;

        try {
            const fnUrl = `${supabaseUrl}/functions/v1/${claimed.edge_function_name}`;

            // Remaining time budget for this specific job call (leave 5s for cleanup)
            const remainingMs = TIME_BUDGET_MS - (Date.now() - invocationStart) - 5_000;
            const timeoutMs = Math.min(55_000, Math.max(5_000, remainingMs));

            const res = await fetch(fnUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${serviceRoleKey}`,
                    "apikey": serviceRoleKey,
                    "x-cron-job-name": claimed.job_name,
                },
                signal: AbortSignal.timeout(timeoutMs),
                body: JSON.stringify({
                    ...(claimed.payload ?? {}),
                    __cron_job_name: claimed.job_name,
                }),
            });

            if (!res.ok) {
                const body = await res.text().catch(() => "(no body)");
                throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
            }

            const result = await res.json().catch(() => null);
            console.log(`[process-cron-queue] ${claimed.job_name} succeeded in ${Date.now() - jobStart}ms`, result);
        } catch (err) {
            jobStatus = "failed";
            errorMessage = (err as Error).message;
            console.error(`[process-cron-queue] ${claimed.job_name} failed:`, errorMessage);
        }

        const jobElapsed = Date.now() - jobStart;

        // ── Step 4: Update queue entry with outcome ───────────────────────────
        await adminClient
            .from("cron_job_queue")
            .update({
                status: jobStatus,
                completed_at: new Date().toISOString(),
                error_message: errorMessage,
            })
            .eq("id", claimed.id);

        // ── Step 5: Update sync_jobs last_run_at/status as a safety net ───────
        // The target edge functions also update sync_jobs via logApiCall(), but
        // if a function errors before reaching that code, we still want the
        // admin UI to show an accurate last-run time and status.
        await adminClient
            .from("sync_jobs")
            .update({
                last_run_at: new Date().toISOString(),
                last_run_status: jobStatus === "completed" ? "success" : "error",
                updated_at: new Date().toISOString(),
            })
            .eq("job_name", claimed.job_name)
            .catch((e) =>
                console.error("[process-cron-queue] Failed to update sync_jobs:", e)
            );

        // ── Step 6: Log to api_call_logs for admin run history ────────────────
        await adminClient
            .from("api_call_logs")
            .insert({
                endpoint: `/functions/v1/${claimed.edge_function_name}`,
                method: "POST",
                status: jobStatus === "completed" ? "success" : "error",
                message: errorMessage ?? `Processed via queue in ${jobElapsed}ms`,
                duration_ms: jobElapsed,
                triggered_by: claimed.triggered_by ?? "cron_job",
                job_name: claimed.job_name,
            })
            .catch((e) =>
                console.error("[process-cron-queue] Failed to log to api_call_logs:", e)
            );

        results.push({ job_name: claimed.job_name, status: jobStatus, elapsed_ms: jobElapsed });
        jobsProcessed++;
    }

    const totalElapsed = Date.now() - invocationStart;

    if (results.length === 0) {
        return new Response(
            JSON.stringify({ message: "No pending jobs", elapsed_ms: totalElapsed }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    }

    return new Response(
        JSON.stringify({
            processed: results.length,
            jobs: results,
            elapsed_ms: totalElapsed,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
    );
});
