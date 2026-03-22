import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // --- Auth: require supervisor/admin/wso ---
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

    // Check role via service_role client
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roles } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .eq("approved", true);

    const userRoles = (roles || []).map((r: { role: string }) => r.role);
    const allowed = userRoles.some((r: string) => ["supervisor", "admin", "wso"].includes(r));
    if (!allowed) {
        return new Response(JSON.stringify({ error: "Forbidden: requires supervisor, admin, or wso role" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    try {
        const body = await req.json();
        const { emp_id, updates } = body;

        if (!emp_id || !updates || typeof updates !== "object") {
            return new Response(JSON.stringify({ error: "Missing emp_id or updates" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Whitelist allowed columns to prevent arbitrary column updates
        const allowedColumns = new Set([
            "rating_data", "rating_designation", "rating_synced_at",
            "completion_dates", "instructor_validity", "examiner_validity",
            "ojti", "examiner",
            "elpa_level", "elpa_valid_upto", "elpa_endorsed_upto",
            "med_last_date", "med_endorsed_upto", "med_status",
        ]);

        const safeUpdates: Record<string, unknown> = {};
        for (const [col, val] of Object.entries(updates)) {
            if (allowedColumns.has(col)) {
                safeUpdates[col] = val;
            }
        }

        if (Object.keys(safeUpdates).length === 0) {
            return new Response(JSON.stringify({ error: "No valid columns to update" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Use service_role to bypass RLS
        const { data, error } = await adminClient
            .from("employee_training_records")
            .update(safeUpdates)
            .eq("emp_id", emp_id)
            .select("emp_id")
            .single();

        if (error) throw error;

        if (!data) {
            return new Response(JSON.stringify({ error: "No record found for emp_id: " + emp_id }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(
            JSON.stringify({ success: true, emp_id: data.emp_id }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (error) {
        console.error("update-training-record error:", error);
        return new Response(
            JSON.stringify({ error: error.message || "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
});
