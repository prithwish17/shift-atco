import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

import { authenticateRequest, handleCorsPreflight, setCorsHeaders } from "../lib/apiAuth.js";
import {
    buildSheetPayload,
    LEAVE_RECORD_COLUMNS,
    normaliseEmpId,
    type LeaveRecordRow,
} from "../lib/leaveSheetPayload.js";

/**
 * Push the leave register into the ATTENDANCE-2026 sheet.
 *
 * Server-side on purpose. The Apps Script write token must never reach the
 * browser — an /exec URL plus its token is a write handle on the whole leave
 * register, and app_settings (where the read-feed URL lives) is client-readable.
 * So the URL and token come from Vercel env, and the client only ever sees the
 * diff that comes back.
 *
 * Env:
 *   LEAVE_SHEET_WEBAPP_URL   the Apps Script /exec URL
 *   LEAVE_SHEET_TOKEN        its ACCESS_TOKEN
 *   LEAVE_SHEET_TAB          optional tab name (defaults to LEAVE_DATA)
 *
 * POST body: { dryRun?, mode?, year?, empIds?, sheet? }
 * `dryRun` defaults to TRUE — writing takes an explicit `dryRun: false`.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;

    if (req.method !== "POST") {
        setCorsHeaders(req, res);
        return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await authenticateRequest(req, res);
    if (!user) return;

    const webappUrl = process.env.LEAVE_SHEET_WEBAPP_URL;
    const token = process.env.LEAVE_SHEET_TOKEN;
    if (!webappUrl || !token) {
        setCorsHeaders(req, res);
        return res.status(500).json({
            error: "Sheet write-back is not configured — set LEAVE_SHEET_WEBAPP_URL and LEAVE_SHEET_TOKEN.",
        });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Mirrors can_manage_leave_backfill(): the service-role client bypasses RLS,
    // so this endpoint has to check the role itself.
    const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("approved", true)
        .in("role", ["supervisor", "admin"]);

    if (roleError) {
        setCorsHeaders(req, res);
        return res.status(500).json({ error: `Could not verify role: ${roleError.message}` });
    }
    if (!roles?.length) {
        setCorsHeaders(req, res);
        return res.status(403).json({ error: "Only an approved supervisor or admin may push to the sheet" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const dryRun = body.dryRun !== false;
    const mode = body.mode === "replace" ? "replace" : "merge";
    const year = Number(body.year) || new Date().getFullYear();
    const sheet = typeof body.sheet === "string" && body.sheet.trim()
        ? body.sheet.trim()
        : process.env.LEAVE_SHEET_TAB || undefined;
    const empFilter = Array.isArray(body.empIds) && body.empIds.length
        ? new Set(body.empIds.map(normaliseEmpId))
        : null;

    try {
        const rows: LeaveRecordRow[] = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase
                .from("employee_leave_records")
                .select(LEAVE_RECORD_COLUMNS)
                .order("emp_id")
                .order("leave_date")
                .range(from, from + PAGE - 1);

            if (error) throw new Error(`Reading the register failed: ${error.message}`);
            rows.push(...((data ?? []) as unknown as LeaveRecordRow[]));
            if (!data || data.length < PAGE) break;
        }

        const built = buildSheetPayload(rows, { year });
        const employees = empFilter
            ? built.employees.filter((e) => empFilter.has(e.employee.empId))
            : built.employees;

        if (!employees.length) {
            setCorsHeaders(req, res);
            return res.status(200).json({
                ok: true,
                dryRun,
                cellsChanged: 0,
                employees: { received: 0, matched: 0, changed: 0, unmatched: 0 },
                results: [],
                unmatched: [],
                registerRows: rows.length,
                skippedCategories: built.skipped,
                note: "No register rows matched — nothing to send.",
            });
        }

        const response = await fetch(webappUrl, {
            method: "POST",
            redirect: "follow",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, mode, dryRun, sheet, employees }),
        });

        const text = await response.text();
        let result: Record<string, unknown>;
        try {
            result = JSON.parse(text);
        } catch {
            throw new Error(
                `Apps Script returned ${response.status} and not JSON. ` +
                `Check the /exec URL and that the deployment is current. First 200 chars: ${text.slice(0, 200)}`,
            );
        }

        if (result.error) throw new Error(String(result.error));

        setCorsHeaders(req, res);
        return res.status(200).json({
            ...result,
            registerRows: rows.length,
            skippedCategories: built.skipped,
        });
    } catch (error) {
        setCorsHeaders(req, res);
        const message = error instanceof Error ? error.message : String(error);
        return res.status(502).json({ error: message });
    }
}
