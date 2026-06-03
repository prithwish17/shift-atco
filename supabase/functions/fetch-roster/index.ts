import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycby0ZL9nspDkRuln1JRpr8llBRaNxvaO9Zo1X6zMg89i_inQSeDBJd6EyQE9Wj6dhQ-S1Q/exec";

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

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");

    // Accept service_role tokens directly; validate user tokens via getUser
    if (token !== serviceRoleKey) {
      const { data: userData, error: userError } =
        await userClient.auth.getUser(token);
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Parse params from either query string or JSON body so both direct invoke
    // and proxy-based fetch paths can call the same function reliably.
    const url = new URL(req.url);
    let requestBody: Record<string, unknown> = {};
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        requestBody = await req.json();
      } catch {
        requestBody = {};
      }
    }

    const team = String(url.searchParams.get("team") || requestBody.team || "");
    const shift = String(url.searchParams.get("shift") || requestBody.shift || "");
    const date = String(url.searchParams.get("date") || requestBody.date || "");

    // Try to read the webapp URL from app_settings table (admin-configurable)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    let appsScriptUrl = DEFAULT_APPS_SCRIPT_URL;
    try {
      const { data: setting } = await adminClient
        .from("app_settings")
        .select("value")
        .eq("key", "roster_webapp_url")
        .single();
      if (setting?.value) {
        appsScriptUrl = setting.value;
      }
    } catch {
      // Table may not exist yet — use default
    }

    // Fetch from Google Apps Script
    const scriptUrl = new URL(appsScriptUrl);
    if (team) scriptUrl.searchParams.set("team", team);
    if (shift) scriptUrl.searchParams.set("shift", shift);
    if (date) scriptUrl.searchParams.set("date", date); // ← forward selected date

    console.log(`Fetching roster from: ${scriptUrl.toString()}`);

    const response = await fetch(scriptUrl.toString(), {
      method: "GET",
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Apps Script returned ${response.status}`);
    }

    const data = await response.json();

    // Ensure data is an array
    const rows = Array.isArray(data) ? data : [];

    // Normalise shift values to title-case ("NIGHT" → "Night") so queries
    // and the frontend work consistently regardless of the API's casing.
    const normaliseShift = (s: string) =>
      s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

    // Delete old entries + insert fresh data using service role
    if (rows.length > 0) {
      const adminClient = createClient(supabaseUrl, serviceRoleKey);

      // Log the first row to identify field names from the webapp
      if (rows.length > 0) {
        console.log("[fetch-roster] Sample row keys:", Object.keys(rows[0]));
        console.log("[fetch-roster] Sample row:", JSON.stringify(rows[0]));
      }

      const toInsert = rows.map((row: Record<string, string>) => {
        // Parse employee name: strip designation/rating after "/"
        // and trailing designation codes like "-AM", "-JE", "-SM"
        let empName = (row.employee_name || "").split("/")[0].trim();
        empName = empName.replace(/-(SM|DGM|MGR|JE|AM|AGM)$/i, "").trim();
        empName = empName.replace(/-+$/, "").trim();

        // The webapp may return the position/half info under different field names
        // Check: position, mark, remark, half (in order of priority)
        const positionValue = row.position || row.mark || row.remark || row.half || "";

        return {
          date: row.date || "",
          shift: normaliseShift(row.shift || ""),
          team: row.team || "",
          unit: (row.unit || "").toUpperCase().trim() === "HQ" ? "WSO" : (row.unit || ""),
          employee_name: empName,
          position: positionValue,
        };
      });

      // Deduplicate by unique constraint columns (date, shift, employee_name, unit, position)
      const seen = new Set<string>();
      const dedupedInsert = toInsert.filter((r: any) => {
        const key = `${r.date}|${r.shift}|${r.employee_name}|${r.unit}|${r.position}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Build unique (date, shift, team) combos from incoming data
      const combos = new Set<string>();
      dedupedInsert.forEach((r: any) => combos.add(`${r.date}|${r.shift}|${r.team}`));

      // Delete old entries for each combo to avoid duplicates
      for (const combo of combos) {
        const [d, s, t] = combo.split("|");
        const { error: delError } = await adminClient
          .from("rosters")
          .delete()
          .eq("date", d)
          .eq("shift", s)
          .eq("team", t);
        if (delError) {
          console.error("Delete error:", delError);
        }
      }

      // Upsert fresh data to handle any remaining conflicts
      const { error: insertError } = await adminClient
        .from("rosters")
        .upsert(dedupedInsert, {
          onConflict: "date,shift,employee_name,unit,position",
        });

      if (insertError) {
        console.error("Insert error:", insertError);
      }
    }

    return new Response(JSON.stringify({ data: rows, count: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
