import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface EmployeeRecord {
  employee_id: string;
  initials?: string;
  full_name: string;
  designation?: string;
  stream?: string;
  mobile?: string;
  email: string;
  gender?: string;
  alternate_email?: string;
  address?: string;
  current_shift: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is admin
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    // Check admin or supervisor role
    const { data: isAdmin } = await anonClient.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const { data: isSupervisor } = await anonClient.rpc("has_role", {
      _user_id: userId,
      _role: "supervisor",
    });

    if (!isAdmin && !isSupervisor) {
      return new Response(JSON.stringify({ error: "Admin or Supervisor access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { employees, update_duplicates } = (await req.json()) as { employees: EmployeeRecord[]; update_duplicates?: boolean };

    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return new Response(
        JSON.stringify({ error: "No employee records provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Admin client for creating users
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Normalize shift values: "A", "Shift A", "GENERAL" → lowercase enum value
    const VALID_SHIFTS = new Set(["general", "a", "b", "c", "d", "e"]);
    function normalizeShift(raw: string | undefined | null): string {
      if (!raw) return "general";
      // strip "shift " prefix, trim, lowercase
      const cleaned = raw.trim().toLowerCase().replace(/^shift\s+/i, "");
      return VALID_SHIFTS.has(cleaned) ? cleaned : "general";
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

    const results: { created: string[]; updated: string[]; skipped: { employee_id: string; reason: string }[]; failed: { employee_id: string; error: string }[] } = {
      created: [],
      updated: [],
      skipped: [],
      failed: [],
    };

    for (const emp of employees) {
      try {
        // Check for existing profile by employee_id or email
        const { data: existing } = await adminClient
          .from("profiles")
          .select("id, employee_id, email")
          .or(`employee_id.eq.${emp.employee_id},email.eq.${emp.email}`)
          .limit(1);

        if (existing && existing.length > 0) {
          if (update_duplicates) {
            // Update the existing profile with new data
            const shiftValue = normalizeShift(emp.current_shift);
            const { error: updateError } = await adminClient
              .from("profiles")
              .update({
                full_name: emp.full_name,
                employee_id: emp.employee_id,
                email: emp.email,
                designation: emp.designation || null,
                mobile: emp.mobile || null,
                current_shift: shiftValue,
                initials: emp.initials || null,
                stream: emp.stream || null,
                gender: emp.gender || null,
                alternate_email: emp.alternate_email || null,
                address: emp.address || null,
              })
              .eq("id", existing[0].id);

            if (updateError) {
              results.failed.push({
                employee_id: emp.employee_id,
                error: `Update failed: ${updateError.message}`,
              });
            } else {
              results.updated.push(emp.employee_id);
            }
          } else {
            results.skipped.push({
              employee_id: emp.employee_id,
              reason: `Already exists (${existing[0].employee_id === emp.employee_id ? "same Employee ID" : "same email"})`,
            });
          }
          continue;
        }

        // Generate a cryptographically random password — user will never see this.
        // They must use the "Forgot Password" flow to set their own.
        const randomBytes = crypto.getRandomValues(new Uint8Array(16));
        const password = Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('');

        // Create auth user
        const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
          email: emp.email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: emp.full_name,
            employee_id: emp.employee_id,
          },
        });

        if (authError || !authUser?.user) {
          results.failed.push({
            employee_id: emp.employee_id,
            error: authError?.message || "Failed to create auth user",
          });
          continue;
        }

        const newUserId = authUser.user.id;

        // Wait for the handle_new_user trigger to create the profile row
        const profileExists = await waitForProfile(newUserId);
        if (!profileExists) {
          console.error(`Profile not created by trigger for user ${newUserId}, attempting direct update anyway`);
        }

        // Normalize the shift value for the enum
        const shiftValue = normalizeShift(emp.current_shift);

        // Update profile with ALL fields (profile is auto-created by trigger)
        const { error: profileError } = await adminClient
          .from("profiles")
          .update({
            full_name: emp.full_name,
            employee_id: emp.employee_id,
            email: emp.email,
            designation: emp.designation || null,
            mobile: emp.mobile || null,
            current_shift: shiftValue,
            initials: emp.initials || null,
            stream: emp.stream || null,
            gender: emp.gender || null,
            alternate_email: emp.alternate_email || null,
            address: emp.address || null,
          })
          .eq("id", newUserId);

        if (profileError) {
          console.error("Profile update error for", emp.employee_id, ":", JSON.stringify(profileError));
          results.failed.push({
            employee_id: emp.employee_id,
            error: `User created but profile update failed: ${profileError.message}`,
          });
          // Don't continue — still create role so user can at least log in
        }

        // Create user_roles entry
        const { error: roleError } = await adminClient.from("user_roles").insert({
          user_id: newUserId,
          role: "employee",
          approved: true,
          approved_by: userId,
          approved_at: new Date().toISOString(),
        });

        if (roleError) {
          console.error("Role insert error:", roleError);
        }

        if (!profileError) {
          results.created.push(emp.employee_id);
        }
      } catch (err) {
        results.failed.push({
          employee_id: emp.employee_id,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
