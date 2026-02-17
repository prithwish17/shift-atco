import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbyj6zFzcEh16H07ZKj7NAMOndgNeUWG_Hgk8zopLnSDduLzjBFIDWmLvzqqCthPtcF2/exec";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        // Validate auth
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        // Verify user token
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Fetch from Google Apps Script
        console.log(`Fetching schedules from: ${APPS_SCRIPT_URL}`);
        const response = await fetch(APPS_SCRIPT_URL, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`Apps Script returned ${response.status}`);
        }

        const json = await response.json();

        if (json.status !== "success" || !Array.isArray(json.data)) {
            throw new Error("Unexpected response format from Apps Script");
        }

        const employees = json.data;

        // Flatten employees + duties into rows for upsert
        const rows: Array<{
            employee_code: string;
            employee_name: string;
            duty_date: string;
            duty_code: string;
            duty_description: string;
        }> = [];

        for (const emp of employees) {
            const empCode = String(emp.id || "").trim();
            const empName = String(emp.name || "").trim();
            if (!empCode || !empName) continue;

            for (const duty of emp.duties || []) {
                const date = String(duty.date || "").trim();
                const code = String(duty.code || "").trim();
                const desc = String(duty.description || "").trim();
                if (!date) continue;

                rows.push({
                    employee_code: empCode,
                    employee_name: empName,
                    duty_date: date,
                    duty_code: code,
                    duty_description: desc,
                });
            }
        }

        console.log(`Flattened ${rows.length} schedule rows from ${employees.length} employees`);

        // Upsert into employee_schedules using service role
        if (rows.length > 0) {
            const adminClient = createClient(supabaseUrl, serviceRoleKey);

            // Batch upsert in chunks of 500
            const BATCH_SIZE = 500;
            let upserted = 0;
            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);
                const { error: upsertError } = await adminClient
                    .from("employee_schedules")
                    .upsert(batch, { onConflict: "employee_code,duty_date" });

                if (upsertError) {
                    console.error("Upsert error:", upsertError);
                } else {
                    upserted += batch.length;
                }
            }
            console.log(`Upserted ${upserted} schedule rows`);
        }

        return new Response(
            JSON.stringify({
                success: true,
                employees: employees.length,
                rows: rows.length,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: error.message || "Internal server error" }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
