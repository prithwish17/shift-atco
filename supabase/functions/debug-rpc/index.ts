import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await adminClient.rpc("get_working_hours_summary", { p_month: "2026-04" });
    
    return new Response(JSON.stringify({ data, error }), {
        headers: { "Content-Type": "application/json" }
    });
});
