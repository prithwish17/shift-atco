import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

/**
 * One-shot migration: for every active trainee record whose raw_payload.trainee_status
 * is 'status_pending' (or not set at all), update it to 'training_continue'.
 *
 * This endpoint requires a supervisor/admin auth token (same as other training endpoints).
 * Safe to call multiple times — idempotent.
 */
Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Require auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Fetch all active trainee records whose status needs updating
    const { data: rows, error: fetchError } = await adminClient
        .from("employee_training_records")
        .select("emp_id, raw_payload")
        .or("trainee_unit.not.is.null,trainee_hours_required.not.is.null");

    if (fetchError) {
        return new Response(JSON.stringify({ error: fetchError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const toUpdate: Array<{ emp_id: string; raw_payload: Record<string, unknown> }> = [];

    for (const row of (rows || []) as Array<{ emp_id: string; raw_payload: unknown }>) {
        const payload =
            row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
                ? { ...(row.raw_payload as Record<string, unknown>) }
                : {};

        const currentStatus = payload.trainee_status as string | null | undefined;

        // Only migrate records with no status or status_pending
        if (!currentStatus || currentStatus === "" || currentStatus === "status_pending") {
            toUpdate.push({
                emp_id: row.emp_id,
                raw_payload: {
                    ...payload,
                    trainee_status: "training_continue",
                },
            });
        }
    }

    if (toUpdate.length === 0) {
        return new Response(
            JSON.stringify({ success: true, updated: 0, message: "No records needed migration." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    // Update in batches
    let updated = 0;
    const batchSize = 100;
    for (let i = 0; i < toUpdate.length; i += batchSize) {
        const batch = toUpdate.slice(i, i + batchSize);
        // Update each record individually to safely merge raw_payload
        for (const record of batch) {
            const { error: updateError } = await adminClient
                .from("employee_training_records")
                .update({ raw_payload: record.raw_payload })
                .eq("emp_id", record.emp_id);

            if (updateError) {
                console.error("Update error for", record.emp_id, updateError);
            } else {
                updated++;
            }
        }
    }

    return new Response(
        JSON.stringify({
            success: true,
            scanned: rows?.length ?? 0,
            updated,
            message: `Migrated ${updated} records from status_pending → training_continue.`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
});
