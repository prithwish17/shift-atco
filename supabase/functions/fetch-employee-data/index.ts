import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = (Deno.env.get("ALLOWED_ORIGIN") || "*").replace(/\/+$/, "");
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface EmployeeDataRecord {
  emp_id: string;
  name: string;
  designation: string;
  contact_no: string;
  main_email: string;
  alternate_email: string;
  gender: string;
  highest_rating: string;
  rating_details: Record<string, string>;
  without_ratings: Record<string, string>;
}

function buildEmployeeProfileSyncPayload(emp: EmployeeDataRecord) {
  return {
    designation: String(emp.designation || "").trim() || null,
    contact_no: String(emp.contact_no || "").trim() || null,
    main_email: String(emp.main_email || "").trim() || null,
    alternate_email: String(emp.alternate_email || "").trim() || null,
    gender: String(emp.gender || "").trim() || null,
    current_station: "VECC",
    highest_rating: String(emp.highest_rating || "").trim() || null,
    rating_summary: emp.rating_details || {},
    without_ratings: emp.without_ratings || {},
  };
}

function mergeProfileDetails(existingDetails: unknown, employeeDataSync: ReturnType<typeof buildEmployeeProfileSyncPayload>) {
  const safeExisting = existingDetails && typeof existingDetails === "object" && !Array.isArray(existingDetails)
    ? existingDetails as Record<string, unknown>
    : {};

  return {
    ...safeExisting,
    employee_data_sync: employeeDataSync,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  async function logApiCall(status: string, message: string, durationMs?: number, triggeredBy?: string) {
    try {
      await adminClient
        .from("api_call_logs")
        .insert({
          endpoint: "fetch-employee-data",
          method: "POST",
          status,
          message,
          duration_ms: durationMs || null,
          triggered_by: triggeredBy || "unknown",
        });
    } catch (e) {
      console.error("Failed to insert api_call_logs:", e);
    }
  }

  const startTime = Date.now();

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      await logApiCall("error", "Missing authorization header", 0, "unknown");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const token = authHeader.replace("Bearer ", "");
    let triggeredBy = "service_role";

    if (token !== serviceRoleKey) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await userClient.auth.getUser(token);
      if (userError || !userData?.user) {
        await logApiCall("error", "Invalid auth token", Date.now() - startTime, "unknown");
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      triggeredBy = userData.user.email || userData.user.id;
    } else {
      triggeredBy = "cron_job";
    }

    // --- Read configured URL ---
    const { data: setting } = await adminClient
      .from("app_settings")
      .select("value")
      .eq("key", "employee_data_webapp_url")
      .maybeSingle();

    const apiUrl = setting?.value;
    if (!apiUrl) {
      const errMsg = "Employee Data webapp URL not configured in System Settings";
      await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Fetch from external API ---
    const response = await fetch(apiUrl, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });

    if (!response.ok) {
      const errMsg = `Employee data webapp returned ${response.status}`;
      await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
      throw new Error(errMsg);
    }

    const json = await response.json();
    const rawRecords: EmployeeDataRecord[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : [];

    if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
      const errMsg = "No employee data records found in API response";
      await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Process employees ---
    const fetchedEmpIds = new Set<string>();
    let designationUpdated = 0;
    let contactUpdated = 0;
    let ratingsUpserted = 0;
    let newEmployeesCreated = 0;
    const errors: string[] = [];

    const now = new Date().toISOString();
    const batchId = `emp-data-sync-${Date.now()}`;

    // Build lookup of all fetched records by emp_id
    const empMap = new Map<string, EmployeeDataRecord>();
    for (const emp of rawRecords) {
      const empId = String(emp.emp_id || "").trim();
      if (empId) {
        fetchedEmpIds.add(empId);
        empMap.set(empId, emp);
      }
    }

    // Fetch all existing profiles in one query
    const { data: allProfiles } = await adminClient
      .from("profiles")
      .select("id, employee_id, designation, mobile, alternate_email, gender, profile_details")
      .not("employee_id", "is", null);

    const profileMap = new Map<string, any>();
    for (const p of allProfiles || []) {
      if (p.employee_id) profileMap.set(p.employee_id, p);
    }

    // Wait for trigger-created profile to appear (max 3 attempts, 500ms apart)
    async function waitForProfile(uid: string, maxRetries = 3): Promise<boolean> {
      for (let i = 0; i < maxRetries; i++) {
        const { data } = await adminClient.from("profiles").select("id").eq("id", uid).single();
        if (data) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    }

    // --- 1 & 2: Batch update existing profiles ---
    for (const [empId, emp] of empMap) {
      const existing = profileMap.get(empId);
      if (!existing) continue;

      const updates: Record<string, string | null | Record<string, unknown>> = {};
      const newDesignation = String(emp.designation || "").trim();
      if (newDesignation && existing.designation !== newDesignation) {
        updates.designation = newDesignation;
        designationUpdated++;
      }

      const newMobile = String(emp.contact_no || "").trim();
      const newAltEmail = String(emp.alternate_email || "").trim();
      const newGender = String(emp.gender || "").trim();
      const employeeDataSync = buildEmployeeProfileSyncPayload(emp);
      const existingSync = existing.profile_details?.employee_data_sync || {};

      if (newMobile && existing.mobile !== newMobile) updates.mobile = newMobile;
      if (newAltEmail && existing.alternate_email !== newAltEmail) updates.alternate_email = newAltEmail;
      if (newGender && existing.gender !== newGender) updates.gender = newGender;
      if (existing.station !== "VECC") updates.station = "VECC";
      if (JSON.stringify(existingSync) !== JSON.stringify(employeeDataSync)) {
        updates.profile_details = mergeProfileDetails(existing.profile_details, employeeDataSync);
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await adminClient
          .from("profiles")
          .update(updates)
          .eq("id", existing.id);
        if (updateError) {
          errors.push(`Profile update failed for ${empId}: ${updateError.message}`);
        } else {
          contactUpdated++;
        }
      }
    }

    // --- 3: Register new employees ---
    const newEmpIds = [...empMap.keys()].filter((id) => !profileMap.has(id));
    for (const empId of newEmpIds) {
      const emp = empMap.get(empId)!;
      const email = String(emp.main_email || "").trim();
      if (!email) {
        errors.push(`Skipping new employee ${empId}: no main_email`);
        continue;
      }

      try {
        const password = `ShiftPlan@${empId}`;
        const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: String(emp.name || "").trim(),
            employee_id: empId,
          },
        });

        if (authError || !authUser?.user) {
          errors.push(`Auth creation failed for ${empId}: ${authError?.message || "Unknown error"}`);
          continue;
        }

        await waitForProfile(authUser.user.id);

        const { error: profileError } = await adminClient
          .from("profiles")
          .update({
            full_name: String(emp.name || "").trim(),
            employee_id: empId,
            email,
            designation: String(emp.designation || "").trim() || null,
            mobile: String(emp.contact_no || "").trim() || null,
            station: "VECC",
            gender: String(emp.gender || "").trim() || null,
            alternate_email: String(emp.alternate_email || "").trim() || null,
            profile_details: mergeProfileDetails(null, buildEmployeeProfileSyncPayload(emp)),
          })
          .eq("id", authUser.user.id);

        if (profileError) {
          errors.push(`Profile update failed for new employee ${empId}: ${profileError.message}`);
        }

        const { error: roleError } = await adminClient.from("user_roles").insert({
          user_id: authUser.user.id,
          role: "employee",
          approved: true,
        });

        if (roleError) {
          console.error("Role insert error for", empId, ":", roleError);
        }

        newEmployeesCreated++;
      } catch (err) {
        errors.push(`Error registering ${empId}: ${err instanceof Error ? err.message : "Unknown"}`);
      }
    }

    // --- Rating upsert in batches ---
    const ratingRecords = [...empMap.entries()].map(([empId, emp]) => ({
      emp_id: empId,
      employee_name: String(emp.name || "").trim() || "Unknown",
      rating_designation: String(emp.designation || "").trim() || null,
      highest_rating: String(emp.highest_rating || "").trim() || null,
      rating_summary: emp.rating_details || {},
      without_ratings: emp.without_ratings || {},
      rating_synced_at: now,
      sync_batch_id: batchId,
    }));

    const BATCH_SIZE = 500;
    for (let i = 0; i < ratingRecords.length; i += BATCH_SIZE) {
      const batch = ratingRecords.slice(i, i + BATCH_SIZE);
      const { error: ratingError } = await adminClient
        .from("employee_training_records")
        .upsert(batch, { onConflict: "emp_id" });
      if (ratingError) {
        errors.push(`Rating batch upsert error at ${i}: ${ratingError.message}`);
      } else {
        ratingsUpserted += batch.length;
      }
    }

    // --- 4. Find missing employees (in DB but not in fetched data) ---
    const missingEmployees = (allProfiles || [])
      .filter((p: any) => p.employee_id && !fetchedEmpIds.has(p.employee_id))
      .map((p: any) => ({
        employee_id: p.employee_id,
        full_name: p.full_name,
        designation: p.designation,
      }));

    // Store missing employees in app_settings for persistent dashboard display
    await adminClient
      .from("app_settings")
      .upsert(
        {
          key: "missing_employees_data",
          value: JSON.stringify(missingEmployees),
          label: "Employees not found in latest employee data sync",
          updated_at: now,
        },
        { onConflict: "key" },
      );

    await adminClient
      .from("app_settings")
      .upsert(
        {
          key: "missing_employees_hidden",
          value: "false",
          label: "Hide missing employees board",
          updated_at: now,
        },
        { onConflict: "key" },
      );

    const durationMs = Date.now() - startTime;
    const successMsg = `Fetched ${rawRecords.length} employees: ${designationUpdated} designation updates, ${contactUpdated} contact updates, ${ratingsUpserted} ratings upserted, ${newEmployeesCreated} new employees created, ${missingEmployees.length} missing from API`;
    await logApiCall("success", successMsg, durationMs, triggeredBy);

    return new Response(
      JSON.stringify({
        success: true,
        total: rawRecords.length,
        designationUpdated,
        contactUpdated,
        ratingsUpserted,
        newEmployeesCreated,
        missingEmployees: missingEmployees.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error("Error:", error);
    await logApiCall("error", error.message || "Internal server error", durationMs, "unknown");
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
