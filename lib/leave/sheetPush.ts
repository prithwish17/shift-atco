import { createHash, randomUUID } from "node:crypto";

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { authenticateRequest, handleCorsPreflight, setCorsHeaders } from "../apiAuth.js";
import {
    buildSheetPayload,
    LEAVE_RECORD_COLUMNS,
    normaliseEmpId,
    type LeaveRecordRow,
    type SheetEmployeePayload,
} from "../leaveSheetPayload.js";

/**
 * Push the leave register into the live ATTENDANCE sheet.
 *
 * Server-side on purpose. The Apps Script write token must never reach the
 * browser — an /exec URL plus its token is a write handle on the whole leave
 * register, and app_settings (where the read-feed URL lives) is client-readable.
 * So the URL and token come from Vercel env, and the client only ever sees the
 * diff that comes back.
 *
 * What it guarantees (docs/leave/SHEET_INDEPENDENCE.md §5):
 *   - Additive only. `merge` is the only mode; the writer never blanks a cell
 *     and never overwrites a different value — it reports a conflict instead.
 *   - What was previewed is what is written. The dry run returns a fingerprint
 *     of the payload; a commit must present it, and is refused if the register
 *     has changed since.
 *   - The live workbook only. The year comes from the active leave sheet
 *     source; a closed sheet is never written to.
 *   - Recorded. Every commit, including a failed one, lands in
 *     leave_sheet_push_log with the per-cell diff.
 *
 * Env:
 *   LEAVE_SHEET_WEBAPP_URL   the Apps Script /exec URL of the live workbook
 *   LEAVE_SHEET_TOKEN        its ACCESS_TOKEN
 *   LEAVE_SHEET_TAB          optional tab name (defaults to LEAVE_DATA)
 *
 * POST body: { dryRun?, year?, empIds?, pendingOnly?, expectedHash? }
 * `dryRun` defaults to TRUE — writing takes an explicit `dryRun: false`.
 */

type Json = Record<string, unknown>;

type WriterResult = {
    empId: string;
    name?: string;
    row?: number;
    cellsChanged: number;
    warnings?: string[];
    conflicts?: unknown[];
    concurrentEdit?: boolean;
};

const EMP_FILTER_CHUNK = 200;

export async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;

    const reply = (status: number, body: Json) => {
        setCorsHeaders(req, res);
        return res.status(status).json(body);
    };

    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

    const user = await authenticateRequest(req, res);
    if (!user) return;

    const webappUrl = process.env.LEAVE_SHEET_WEBAPP_URL;
    const token = process.env.LEAVE_SHEET_TOKEN;
    if (!webappUrl || !token) {
        return reply(500, {
            error: "Sheet write-back is not configured — set LEAVE_SHEET_WEBAPP_URL and LEAVE_SHEET_TOKEN.",
        });
    }

    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Mirrors can_manage_leave_backfill(): the service-role client bypasses RLS,
    // so this endpoint has to check the role itself.
    const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("approved", true)
        .in("role", ["supervisor", "admin"]);

    if (roleError) return reply(500, { error: `Could not verify role: ${roleError.message}` });
    if (!roles?.length) return reply(403, { error: "Only an approved supervisor or admin may push to the sheet" });

    const body = (req.body ?? {}) as Json;
    const dryRun = body.dryRun !== false;

    if (body.mode !== undefined && body.mode !== "merge") {
        return reply(400, {
            error: "Only merge is available from the app. Replace can blank cells on the sheet; " +
                "if a section really needs rebuilding, do it deliberately with scripts/leave-sheet-push.ts.",
        });
    }

    // ── The live workbook ────────────────────────────────────────────────────
    const { data: source, error: sourceError } = await supabase
        .from("leave_sheet_sources")
        .select("source_key, leave_year")
        .eq("status", "active")
        .maybeSingle();

    if (sourceError) return reply(500, { error: `Could not read the leave sheet source: ${sourceError.message}` });
    if (!source) {
        return reply(409, {
            error: "There is no live leave sheet — it has been closed. The app's register is unaffected; nothing is pushed.",
        });
    }

    const year = Number(body.year) || source.leave_year;
    if (year !== source.leave_year) {
        return reply(400, {
            error: `The live sheet is ${source.source_key} (${source.leave_year}). ` +
                `Pushing ${year} leave into it would put it in the wrong year's columns.`,
        });
    }

    const sheet = process.env.LEAVE_SHEET_TAB || undefined;

    try {
        // ── Who to send ──────────────────────────────────────────────────────
        const { data: queueRows, error: queueError } = await supabase
            .from("leave_sheet_push_queue")
            .select("emp_id, removals, last_queued_at");
        if (queueError) throw new Error(`Reading the push queue failed: ${queueError.message}`);

        const queue = new Map((queueRows ?? []).map((q) => [String(q.emp_id), q]));

        // empFilter holds EMP NOs as the sheet keys them; rawFilter the register's
        // own emp_id spellings, for the query.
        let empFilter: Set<string> | null = null;
        let rawFilter: string[] | null = null;
        if (Array.isArray(body.empIds) && body.empIds.length) {
            const given = body.empIds.map((id) => String(id).trim()).filter(Boolean);
            empFilter = new Set(given.map(normaliseEmpId));
            rawFilter = [...new Set([...given, ...empFilter])];
        } else if (body.pendingOnly) {
            rawFilter = [...queue.keys()];
            empFilter = new Set(rawFilter.map(normaliseEmpId));
            if (!empFilter.size) {
                return reply(200, {
                    ok: true, dryRun, cellsChanged: 0,
                    employees: { received: 0, matched: 0, changed: 0, unmatched: 0 },
                    results: [], unmatched: [], pendingCount: 0,
                    source: source.source_key, year,
                    note: "Nothing is waiting to be sent — the sheet has every app change.",
                });
            }
        }

        const rows = await readRegister(supabase, rawFilter);
        const built = buildSheetPayload(rows, { year });
        const employees = empFilter
            ? built.employees.filter((e) => empFilter!.has(e.employee.empId))
            : built.employees;

        // Queue rows are keyed by the register's emp_id; the payload by EMP NO.
        const rawIdsByEmpNo = new Map<string, string[]>();
        for (const id of queue.keys()) {
            const key = normaliseEmpId(id);
            rawIdsByEmpNo.set(key, [...(rawIdsByEmpNo.get(key) ?? []), id]);
        }

        // Queue entries this push covers.
        const inScope = [...queue.keys()].filter((id) => !empFilter || empFilter.has(normaliseEmpId(id)));
        const sentEmpNos = new Set(employees.map((e) => e.employee.empId));
        // Queued, but with nothing left to send — typically only a cancellation.
        const unsent = inScope.filter((id) => !sentEmpNos.has(normaliseEmpId(id)));

        // Leave cancelled in the app. A push never deletes from the sheet, so the
        // clerk is shown these to remove by hand.
        const manualRemovals = inScope.flatMap((id) => {
            const removals = queue.get(id)?.removals;
            return (Array.isArray(removals) ? (removals as Json[]) : []).map((r) => ({ empId: id, ...r }));
        });

        // Covers the removals too: acknowledging them must not clear one that
        // arrived after the preview.
        const payloadHash = fingerprint({ employees, manualRemovals });
        const context = {
            registerRows: rows.length,
            skippedCategories: built.skipped,
            payloadHash,
            manualRemovals,
            pendingCount: queue.size,
            source: source.source_key,
            year,
        };

        // What was previewed is what gets written.
        if (!dryRun && body.expectedHash !== payloadHash) {
            return reply(409, {
                error: "The leave register has changed since this preview. Preview again before writing.",
                ...context,
            });
        }

        const pushStartedAt = new Date().toISOString();

        if (!employees.length) {
            // Nothing to write. A commit here acknowledges the manual removals the
            // preview listed, which is the only way those entries leave the queue.
            if (!dryRun && manualRemovals.length) {
                await logPush(supabase, {
                    user, source: source.source_key, sheet, year, employees, payloadHash,
                    result: { acknowledgedRemovals: manualRemovals }, error: null,
                });
                await clearQueue(supabase, unsent, pushStartedAt);
            }
            return reply(200, {
                ok: true, dryRun, cellsChanged: 0,
                employees: { received: 0, matched: 0, changed: 0, unmatched: 0 },
                results: [], unmatched: [],
                ...context,
                note: !dryRun && manualRemovals.length
                    ? "Removals acknowledged — nothing else to send."
                    : "No register rows matched — nothing to send.",
            });
        }

        const requestId = randomUUID();
        let result: Json;
        try {
            // expectedYear lets the script refuse, before touching anything, a
            // workbook named for another year — the env still pointing at a
            // closed sheet, or at next year's too early.
            result = await postToSheet(webappUrl, {
                token, mode: "merge", dryRun, sheet, employees,
                expectedYear: year, requestId, actor: user.email ?? user.id,
            });
        } catch (error) {
            if (!dryRun) {
                await logPush(supabase, {
                    user, source: source.source_key, sheet, year, employees, payloadHash,
                    result: null, error: errorText(error),
                });
            }
            throw error;
        }

        if (!dryRun) {
            await logPush(supabase, {
                user, source: source.source_key, sheet, year, employees, payloadHash,
                result: { ...result, manualRemovals }, error: null,
            });
            await settleQueue(supabase, result, rawIdsByEmpNo, pushStartedAt);
            // Their removals were in the preview just written.
            await clearQueue(supabase, unsent, pushStartedAt);
        }

        return reply(200, { ...result, requestId, ...context });
    } catch (error) {
        return reply(502, { error: errorText(error) });
    }
}

/**
 * The register, paged, optionally for a set of emp_ids.
 *
 * Ordered by the full unique key so the payload — and its fingerprint — is
 * identical for an unchanged register, with dates in order within each section.
 */
async function readRegister(
    supabase: SupabaseClient,
    empIds: string[] | null,
): Promise<LeaveRecordRow[]> {
    const rows: LeaveRecordRow[] = [];
    const PAGE = 1000;
    const idChunks: (string[] | null)[] = empIds ? chunk(empIds, EMP_FILTER_CHUNK) : [null];

    for (const ids of idChunks) {
        for (let from = 0; ; from += PAGE) {
            let query = supabase
                .from("employee_leave_records")
                .select(LEAVE_RECORD_COLUMNS)
                .order("emp_id")
                .order("leave_date")
                .order("leave_category")
                .order("source_event_type")
                .order("duty_code")
                .range(from, from + PAGE - 1);
            if (ids) query = query.in("emp_id", ids);

            const { data, error } = await query;
            if (error) throw new Error(`Reading the register failed: ${error.message}`);
            rows.push(...((data ?? []) as unknown as LeaveRecordRow[]));
            if (!data || data.length < PAGE) break;
        }
    }

    return rows;
}

async function postToSheet(url: string, payload: Json): Promise<Json> {
    const response = await fetch(url, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    const text = await response.text();
    let result: Json;
    try {
        result = JSON.parse(text);
    } catch {
        throw new Error(
            `Apps Script returned ${response.status} and not JSON. ` +
            `Check the /exec URL and that the deployment is current. First 200 chars: ${text.slice(0, 200)}`,
        );
    }
    if (result.error) throw new Error(String(result.error));
    return result;
}

async function logPush(
    supabase: SupabaseClient,
    entry: {
        user: { id: string; email?: string | null };
        source: string;
        sheet: string | undefined;
        year: number;
        employees: SheetEmployeePayload[];
        payloadHash: string;
        result: Json | null;
        error: string | null;
    },
) {
    const results = (entry.result?.results ?? []) as WriterResult[];
    const { error } = await supabase.from("leave_sheet_push_log").insert({
        actor_id: entry.user.id,
        actor_email: entry.user.email ?? null,
        source_key: entry.source,
        sheet_tab: entry.sheet ?? "LEAVE_DATA",
        mode: "merge",
        dry_run: false,
        leave_year: entry.year,
        emp_ids: entry.employees.map((e) => e.employee.empId),
        payload_hash: entry.payloadHash,
        employees_sent: entry.employees.length,
        cells_changed: Number(entry.result?.cellsChanged ?? 0),
        rows_written: Number(entry.result?.rowsWritten ?? 0),
        conflicts: results.reduce((n, r) => n + (r.conflicts?.length ?? 0), 0),
        unmatched: Number((entry.result?.employees as Json | undefined)?.unmatched ?? 0),
        result: entry.result,
        error: entry.error,
    });
    // The sheet write already happened; a lost log row must be loud, not fatal.
    if (error) console.error("[sheet-push] could not write leave_sheet_push_log:", error.message);
}

/**
 * Clear queue entries the sheet now reflects. An employee stays queued when it
 * could not be matched, had a conflict, or was skipped for a concurrent edit —
 * and when the app changed them again after this push started.
 */
async function settleQueue(
    supabase: SupabaseClient,
    result: Json,
    rawIdsByEmpNo: Map<string, string[]>,
    pushStartedAt: string,
) {
    const results = (result.results ?? []) as WriterResult[];
    const unmatched = new Set(
        ((result.unmatched ?? []) as { empId?: string }[]).map((u) => normaliseEmpId(u.empId)),
    );

    const done: string[] = [];
    const stuck: { ids: string[]; reason: string }[] = [];

    for (const r of results) {
        const ids = rawIdsByEmpNo.get(normaliseEmpId(r.empId)) ?? [];
        if (!ids.length) continue;
        if (r.concurrentEdit) stuck.push({ ids, reason: "Row was being edited on the sheet; not written" });
        else if (r.conflicts?.length) stuck.push({ ids, reason: `${r.conflicts.length} cell(s) disagree with the sheet` });
        else done.push(...ids);
    }
    for (const empNo of unmatched) {
        const ids = rawIdsByEmpNo.get(empNo) ?? [];
        if (ids.length) stuck.push({ ids, reason: "EMP NO not matched on the sheet" });
    }

    await clearQueue(supabase, done, pushStartedAt);

    const now = new Date().toISOString();
    for (const { ids, reason } of stuck) {
        for (const id of ids) {
            const { data } = await supabase
                .from("leave_sheet_push_queue").select("attempts").eq("emp_id", id).maybeSingle();
            await supabase
                .from("leave_sheet_push_queue")
                .update({ attempts: Number(data?.attempts ?? 0) + 1, last_attempt_at: now, last_error: reason })
                .eq("emp_id", id);
        }
    }
}

/** Drop queue entries — unless the app changed them again after the push began. */
async function clearQueue(supabase: SupabaseClient, empIds: string[], pushStartedAt: string) {
    for (const ids of chunk(empIds, EMP_FILTER_CHUNK)) {
        const { error } = await supabase
            .from("leave_sheet_push_queue")
            .delete()
            .in("emp_id", ids)
            .lte("last_queued_at", pushStartedAt);
        if (error) console.error("[sheet-push] could not clear the push queue:", error.message);
    }
}

function fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
