// ─────────────────────────────────────────────────────────────────────────────
// update-ojt-progress
//
// Writes ONLY the override_* columns of employee_ojt_progress. The sheet_*
// landing zone is unreachable from here by construction, so an app edit can
// never be clobbered by — or clobber — the twice-daily sync.
//
// Passing null for a field reverts that field to the sheet value. The start
// date is the one field the sheet can never win back on its own: while
// override_start_date is set, it is absolute (PIN policy).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HOUR_FIELDS = ["override_required_hours", "override_performed_hours"] as const;
const DAY_FIELDS = ["override_required_days", "override_performed_days"] as const;
const DATE_FIELDS = ["override_start_date"] as const;
const TEXT_FIELDS = ["override_note"] as const;

const VALUE_FIELDS = [...HOUR_FIELDS, ...DAY_FIELDS, ...DATE_FIELDS] as const;
const ALLOWED_FIELDS = new Set<string>([...VALUE_FIELDS, ...TEXT_FIELDS]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeUnit(value: string) {
    return value.toUpperCase().replace(/\s+/g, "").trim();
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

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

    // The OJT start date drives the deadline, so editing it is a supervisory act.
    const { data: roles } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .eq("approved", true);

    const allowed = (roles || []).some((r: { role: string }) =>
        ["supervisor", "admin", "wso"].includes(r.role));

    if (!allowed) {
        return new Response(
            JSON.stringify({ error: "Forbidden: requires supervisor, admin, or wso role" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    try {
        const body = await req.json();
        const empId = typeof body?.emp_id === "string" ? body.emp_id.trim() : "";
        const unit = typeof body?.unit === "string" ? normalizeUnit(body.unit) : "";
        const updates = body?.updates;

        if (!empId || !unit || !updates || typeof updates !== "object") {
            return new Response(JSON.stringify({ error: "Missing emp_id, unit, or updates" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const { data: existing, error: existingError } = await adminClient
            .from("employee_ojt_progress")
            .select(
                "emp_id, unit, override_required_hours, override_required_days, " +
                "override_performed_hours, override_performed_days, override_start_date, override_note",
            )
            .eq("emp_id", empId)
            .eq("unit", unit)
            .maybeSingle();

        if (existingError) throw existingError;
        if (!existing) {
            return new Response(
                JSON.stringify({ error: `No OJT record for emp_id ${empId} in unit ${unit}` }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
        }

        const safeUpdates: Record<string, unknown> = {};

        for (const [field, raw] of Object.entries(updates)) {
            if (!ALLOWED_FIELDS.has(field)) continue;

            // null is meaningful: it reverts the field to the sheet value.
            if (raw === null || raw === "") {
                safeUpdates[field] = null;
                continue;
            }

            if ((HOUR_FIELDS as readonly string[]).includes(field)) {
                const parsed = Number(raw);
                if (!Number.isFinite(parsed) || parsed < 0) {
                    return new Response(
                        JSON.stringify({ error: `${field} must be a non-negative number` }),
                        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                    );
                }
                safeUpdates[field] = Math.round(parsed * 100) / 100;
                continue;
            }

            if ((DAY_FIELDS as readonly string[]).includes(field)) {
                const parsed = Number(raw);
                if (!Number.isInteger(parsed) || parsed < 0) {
                    return new Response(
                        JSON.stringify({ error: `${field} must be a non-negative integer` }),
                        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                    );
                }
                safeUpdates[field] = parsed;
                continue;
            }

            if ((DATE_FIELDS as readonly string[]).includes(field)) {
                if (typeof raw !== "string" || !ISO_DATE.test(raw) || Number.isNaN(Date.parse(raw))) {
                    return new Response(
                        JSON.stringify({ error: `${field} must be an ISO date (YYYY-MM-DD)` }),
                        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                    );
                }
                safeUpdates[field] = raw;
                continue;
            }

            safeUpdates[field] = String(raw).slice(0, 500);
        }

        if (Object.keys(safeUpdates).length === 0) {
            return new Response(JSON.stringify({ error: "No valid fields to update" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // If nothing remains overridden, drop the stamps too so the row reads as
        // pure sheet data rather than as an override that happens to be empty.
        const merged = { ...existing, ...safeUpdates } as Record<string, unknown>;
        const stillOverridden = [...VALUE_FIELDS, ...TEXT_FIELDS]
            .some((field) => merged[field] !== null && merged[field] !== undefined);

        if (stillOverridden) {
            safeUpdates.override_updated_at = new Date().toISOString();
            safeUpdates.override_updated_by = userData.user.id;
        } else {
            safeUpdates.override_updated_at = null;
            safeUpdates.override_updated_by = null;
        }

        const { error: updateError } = await adminClient
            .from("employee_ojt_progress")
            .update(safeUpdates)
            .eq("emp_id", empId)
            .eq("unit", unit);

        if (updateError) throw updateError;

        return new Response(
            JSON.stringify({ success: true, emp_id: empId, unit, overridden: stillOverridden }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (error) {
        console.error("update-ojt-progress error:", error);
        return new Response(
            JSON.stringify({ error: (error as Error).message || "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
});
