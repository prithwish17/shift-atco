import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(supabaseUrl, serviceRoleKey);

// Max wall-clock time (ms) to spend in a single invocation. Supabase kills an
// edge function that has not responded after 150s; leave 10s headroom.
const TIME_BUDGET_MS = 140_000;

// Per-job HTTP timeout. sync-roster budgets up to 110s of sheet fetches on its
// own, so anything much lower aborts runs that would have succeeded.
const JOB_TIMEOUT_MS = 120_000;

// Only claim another job while there is still a full JOB_TIMEOUT_MS (plus 5s
// for bookkeeping) left in the budget, so no job is started with a short fuse.
const CLAIM_CUTOFF_MS = TIME_BUDGET_MS - JOB_TIMEOUT_MS - 5_000;

// Max jobs to process in one invocation, regardless of time budget.
const MAX_JOBS_PER_RUN = 5;

// A failed job is re-queued after RETRY_DELAY_MS × attempt. Google Apps Script
// and published sheets return sporadic 404s that clear within minutes.
const RETRY_DELAY_MS = 5 * 60_000;

type QueueJob = {
    id: string;
    job_name: string;
    edge_function_name: string;
    payload: Record<string, unknown>;
    status: string;
    priority: number;
    triggered_by: string;
    attempt: number;
    max_attempts: number;
};

// Supabase query builders are thenables without a .catch() method, so every
// bookkeeping write goes through this instead of chaining .catch().
async function bestEffort(label: string, query: PromiseLike<{ error: unknown }>) {
    try {
        const { error } = await query;
        if (error) console.error(`[process-cron-queue] ${label}:`, error);
    } catch (e) {
        console.error(`[process-cron-queue] ${label}:`, e);
    }
}

Deno.serve(async () => {
    const invocationStart = Date.now();
    const results: Array<{ job_name: string; status: string; elapsed_ms: number }> = [];

    // ── Step 1: Heartbeat + mark stale running jobs as failed ─────────────────
    // The heartbeat is what the admin health view reads for this job.
    await bestEffort("heartbeat", adminClient
        .from("sync_jobs")
        .update({ last_run_at: new Date().toISOString(), last_run_status: "success" })
        .eq("job_name", "process-cron-queue"));

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
        if (Date.now() - invocationStart >= CLAIM_CUTOFF_MS) {
            console.log(`[process-cron-queue] Claim cutoff reached after ${jobsProcessed} job(s)`);
            break;
        }

        // Atomically claim the next due job. The SQL function returns nothing
        // while another job is running, so jobs never overlap across invocations.
        // .maybeSingle() is critical: PostgREST wraps composite returns in an array.
        const { data: rawJob, error: claimError } = await adminClient
            .rpc("claim_next_queue_job")
            .maybeSingle();

        if (claimError) {
            console.error("[process-cron-queue] Failed to claim job:", claimError);
            break;
        }

        // An empty claim comes back as a row of NULLs, not as null.
        const claimed = (Array.isArray(rawJob) ? rawJob[0] : rawJob) as QueueJob | null;
        if (!claimed?.id || !claimed?.edge_function_name) break;

        const jobStart = Date.now();
        console.log(`[process-cron-queue] Processing (${jobsProcessed + 1}): ${claimed.job_name} (${claimed.edge_function_name}), attempt ${claimed.attempt ?? 1}`);

        // ── Step 3: Invoke the target edge function ───────────────────────────
        let jobStatus = "completed";
        let errorMessage: string | null = null;

        try {
            const fnUrl = `${supabaseUrl}/functions/v1/${claimed.edge_function_name}`;
            const remainingMs = TIME_BUDGET_MS - (Date.now() - invocationStart) - 5_000;
            const timeoutMs = Math.min(JOB_TIMEOUT_MS, remainingMs);

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
            const e = err as Error;
            errorMessage = e.name === "TimeoutError"
                ? `No response from ${claimed.edge_function_name} within ${Math.round((Date.now() - jobStart) / 1000)}s`
                : e.message;
            console.error(`[process-cron-queue] ${claimed.job_name} failed:`, errorMessage);
        }

        const jobElapsed = Date.now() - jobStart;
        const attempt = claimed.attempt ?? 1;
        const maxAttempts = claimed.max_attempts ?? 1;
        const willRetry = jobStatus === "failed" && attempt < maxAttempts;

        // ── Step 4: Update queue entry with outcome ───────────────────────────
        await bestEffort("update queue entry", adminClient
            .from("cron_job_queue")
            .update({
                status: jobStatus,
                completed_at: new Date().toISOString(),
                error_message: willRetry
                    ? `${errorMessage} (retrying in ${(RETRY_DELAY_MS * attempt) / 60_000} min)`
                    : errorMessage,
            })
            .eq("id", claimed.id));

        // ── Step 5: Queue a retry for transient failures ──────────────────────
        if (willRetry) {
            await bestEffort("queue retry", adminClient
                .from("cron_job_queue")
                .insert({
                    job_name: claimed.job_name,
                    edge_function_name: claimed.edge_function_name,
                    payload: claimed.payload ?? {},
                    priority: claimed.priority ?? 0,
                    triggered_by: claimed.triggered_by ?? "cron_job",
                    attempt: attempt + 1,
                    max_attempts: maxAttempts,
                    available_at: new Date(Date.now() + RETRY_DELAY_MS * attempt).toISOString(),
                }));
        }

        // ── Step 6: Update sync_jobs last_run_at/status as a safety net ───────
        // Most target functions do not write sync_jobs themselves, so without
        // this the admin UI reports them as never having run.
        await bestEffort("update sync_jobs", adminClient
            .from("sync_jobs")
            .update({
                last_run_at: new Date().toISOString(),
                last_run_status: jobStatus === "completed" ? "success" : "error",
                updated_at: new Date().toISOString(),
            })
            .eq("job_name", claimed.job_name));

        // ── Step 7: Log to api_call_logs for admin run history ────────────────
        await bestEffort("log to api_call_logs", adminClient
            .from("api_call_logs")
            .insert({
                endpoint: `/functions/v1/${claimed.edge_function_name}`,
                method: "POST",
                status: jobStatus === "completed" ? "success" : "error",
                message: errorMessage ?? `Processed via queue in ${jobElapsed}ms`,
                duration_ms: jobElapsed,
                triggered_by: claimed.triggered_by ?? "cron_job",
                job_name: claimed.job_name,
            }));

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
