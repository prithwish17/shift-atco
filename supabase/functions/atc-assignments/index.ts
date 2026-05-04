import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Simple in-memory cache (resets on cold start)
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 60_000; // 60 seconds

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

// ----- Google Sheets auth via Service Account -----
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const unsignedToken = `${header}.${payload}`;

  // Import the private key and sign
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${header}.${payload}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token error: ${text}`);
  }

  const tokenData = await res.json();
  return tokenData.access_token;
}

interface AssignmentRow {
  date: string;
  shift: string;
  team: string;
  unit: string;
  employee_name: string;
  role: string;
  position: string;
}

async function fetchSheetData(sheetId: string, tabName: string, saJson: string): Promise<AssignmentRow[]> {
  const cacheKey = `sheet_${sheetId}_${tabName}`;
  const cached = getCached(cacheKey);
  if (cached) return cached as AssignmentRow[];

  const accessToken = await getGoogleAccessToken(saJson);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}?majorDimension=ROWS`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API error: ${res.status} - ${text}`);
  }

  const json = await res.json();
  const rows: string[][] = json.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0].map((h: string) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const data: AssignmentRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const obj: Record<string, string> = {};
    headers.forEach((h: string, idx: number) => {
      obj[h] = (row[idx] || "").trim();
    });

    if (obj.date && obj.employee_name) {
      data.push({
        date: obj.date,
        shift: obj.shift || "",
        team: obj.team || "",
        unit: obj.unit || "",
        employee_name: obj.employee_name,
        role: obj.role || "",
        position: obj.position || "",
      });
    }
  }

  setCache(cacheKey, data);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    // Get user profile and role
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, current_shift")
      .eq("id", userId)
      .single();

    const { data: roleResult } = await supabase.rpc("get_user_role", { _user_id: userId });
    const userRole = roleResult || "employee";

    // Parse query params
    const url = new URL(req.url);
    const dateFilter = url.searchParams.get("date") || "";
    const shiftFilter = url.searchParams.get("shift") || "";

    // Fetch sheet data
    const sheetId = Deno.env.get("GOOGLE_SHEET_ID");
    const tabName = Deno.env.get("GOOGLE_TAB_NAME") || "ATC_ASSIGNMENTS";
    const saJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");

    if (!sheetId || !saJson) {
      return new Response(
        JSON.stringify({ error: "Google Sheets not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let assignments = await fetchSheetData(sheetId, tabName, saJson);

    // Apply date/shift filters
    if (dateFilter) {
      assignments = assignments.filter((a) => a.date === dateFilter);
    }
    if (shiftFilter) {
      assignments = assignments.filter(
        (a) => a.shift.toLowerCase() === shiftFilter.toLowerCase()
      );
    }

    // Role-based filtering
    if (userRole === "employee") {
      const userName = profile?.full_name || "";
      assignments = assignments.filter(
        (a) => a.employee_name.toLowerCase() === userName.toLowerCase()
      );
    } else if (userRole === "wso") {
      const userShift = profile?.current_shift || "";
      if (userShift && userShift !== "general") {
        assignments = assignments.filter(
          (a) => a.team.toLowerCase() === userShift.toLowerCase()
        );
      }
    }
    // supervisor & admin get everything (no further filter)

    return new Response(
      JSON.stringify({
        assignments,
        meta: {
          role: userRole,
          total: assignments.length,
          filtered_by: { date: dateFilter, shift: shiftFilter },
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("atc-assignments error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
