/**
 * The sheet push endpoint's guarantees, end to end through the handler, with an
 * in-memory stand-in for Supabase and for the Apps Script web app:
 *
 *   - merge only; a closed sheet or another year's is never written
 *   - the write is exactly the previewed payload, or refused
 *   - pending-only pushes send the queued employees; the queue is settled
 *     per employee from what the script reports
 *   - removal-only entries can be acknowledged, and only as previewed
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock("../apiAuth.js", () => ({
    authenticateRequest: async () => ({ id: "sup-1", email: "sup@test" }),
    handleCorsPreflight: () => false,
    setCorsHeaders: () => {},
}));

vi.mock("@supabase/supabase-js", () => ({
    createClient: () => ({ from: (table: string) => query(table) }),
}));

/** Just enough of the PostgREST builder for the handler's queries. */
function query(table: string) {
    let op: "select" | "insert" | "delete" | "update" = "select";
    let payload: Row | Row[] | null = null;
    let single = false;
    let range: [number, number] = [0, Number.MAX_SAFE_INTEGER];
    const filters: ((r: Row) => boolean)[] = [];

    const exec = () => {
        const rows = (db.tables[table] ??= []);
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "insert") {
            rows.push(...([] as Row[]).concat(payload as Row));
            return { data: null, error: null };
        }
        if (op === "delete") {
            db.tables[table] = rows.filter((r) => !hit.includes(r));
            return { data: null, error: null };
        }
        if (op === "update") {
            hit.forEach((r) => Object.assign(r, payload));
            return { data: null, error: null };
        }
        const page = hit.slice(range[0], range[1] + 1);
        return { data: single ? page[0] ?? null : page, error: null };
    };

    const b = {
        select: () => b,
        insert: (v: Row | Row[]) => ((op = "insert"), (payload = v), b),
        delete: () => ((op = "delete"), b),
        update: (v: Row) => ((op = "update"), (payload = v), b),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
        lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), b),
        order: () => b,
        range: (from: number, to: number) => ((range = [from, to]), b),
        maybeSingle: () => ((single = true), b),
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            try {
                resolve(exec());
            } catch (e) {
                reject(e);
            }
        },
    };
    return b;
}

/** The Apps Script: reports one written cell per employee unless told otherwise. */
const sheet = { posts: [] as Row[], conflictFor: new Set<string>(), spreadsheet: "ATTENDANCE-2026" };

async function call(body: Row) {
    const { handler } = await import("./sheetPush");
    let status = 0;
    let json: Row = {};
    const res = {
        status(code: number) {
            status = code;
            return res;
        },
        json(value: Row) {
            json = value;
            return res;
        },
    };
    await handler({ method: "POST", body, headers: {}, query: {} } as unknown as VercelRequest,
                  res as unknown as VercelResponse);
    return { status, json };
}

const cl = (emp_id: string, leave_date: string) => ({
    emp_id, employee_name: `EMP ${emp_id}`, leave_category: "CL", source_event_type: "CL",
    event_kind: "leave", leave_date, leave_used_on: null, duty_code: "", metadata: {}, raw_event: {},
});

beforeEach(() => {
    process.env.LEAVE_SHEET_WEBAPP_URL = "https://script.test/exec";
    process.env.LEAVE_SHEET_TOKEN = "t0ken";
    process.env.SUPABASE_URL = "https://db.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";

    db.tables = {
        user_roles: [{ user_id: "sup-1", role: "supervisor", approved: true }],
        leave_sheet_sources: [{ source_key: "ATTENDANCE-2026", leave_year: 2026, status: "active" }],
        employee_leave_records: [cl("10000001", "2026-03-05"), cl("10000002", "2026-04-01"), cl("10000003", "2026-05-11")],
        leave_sheet_push_queue: [
            { emp_id: "10000001", removals: [], last_queued_at: "2026-09-01T00:00:00Z", attempts: 0 },
            { emp_id: "10000002", removals: [], last_queued_at: "2026-09-01T00:00:00Z", attempts: 0 },
        ],
        leave_sheet_push_log: [],
    };

    sheet.posts = [];
    sheet.conflictFor = new Set();
    sheet.spreadsheet = "ATTENDANCE-2026";

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        sheet.posts.push(body);
        const results = body.employees.map((e: { employee: { empId: string } }) => {
            const conflicted = sheet.conflictFor.has(e.employee.empId);
            return {
                empId: e.employee.empId, name: "", row: 4, cellsChanged: conflicted ? 0 : 1,
                conflicts: conflicted ? [{ cell: "AB4", section: "closedHolidays", sheet: "L", app: "N" }] : [],
                warnings: [],
            };
        });
        return {
            status: 200,
            text: async () => JSON.stringify({
                ok: true, dryRun: body.dryRun, mode: body.mode, spreadsheet: sheet.spreadsheet,
                cellsChanged: results.reduce((n: number, r: { cellsChanged: number }) => n + r.cellsChanged, 0),
                employees: { received: results.length, matched: results.length, changed: results.length, unmatched: 0 },
                results, unmatched: [],
            }),
        };
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("sheet push", () => {
    it("refuses replace", async () => {
        const { status, json } = await call({ mode: "replace" });
        expect(status).toBe(400);
        expect(String(json.error)).toMatch(/Only merge/);
        expect(sheet.posts).toHaveLength(0);
    });

    it("writes nothing when the sheet has been closed", async () => {
        db.tables.leave_sheet_sources[0].status = "closed";
        const { status, json } = await call({ dryRun: false });
        expect(status).toBe(409);
        expect(String(json.error)).toMatch(/no live leave sheet/);
        expect(sheet.posts).toHaveLength(0);
    });

    it("refuses another year's leave for the live workbook", async () => {
        const { status } = await call({ year: 2025 });
        expect(status).toBe(400);
        expect(sheet.posts).toHaveLength(0);
    });

    it("previews only the queued employees, and tells the script which year it must be", async () => {
        const { status, json } = await call({ dryRun: true, pendingOnly: true });

        expect(status).toBe(200);
        expect(sheet.posts[0].dryRun).toBe(true);
        expect(sheet.posts[0].mode).toBe("merge");
        expect(sheet.posts[0].expectedYear).toBe(2026);
        expect((sheet.posts[0].employees as { employee: { empId: string } }[]).map((e) => e.employee.empId))
            .toEqual(["10000001", "10000002"]);
        expect(json.payloadHash).toMatch(/^[0-9a-f]{64}$/);
        expect(json.pendingCount).toBe(2);
        expect(db.tables.leave_sheet_push_log).toHaveLength(0);
    });

    it("refuses a write that is not the previewed payload", async () => {
        const preview = await call({ dryRun: true, pendingOnly: true });
        db.tables.employee_leave_records.push(cl("10000001", "2026-06-01"));   // someone records leave

        const { status, json } = await call({ dryRun: false, pendingOnly: true, expectedHash: preview.json.payloadHash });
        expect(status).toBe(409);
        expect(String(json.error)).toMatch(/Preview again/);
        expect(sheet.posts.filter((p) => p.dryRun === false)).toHaveLength(0);
    });

    it("writes the preview, logs it, and settles the queue per employee", async () => {
        sheet.conflictFor.add("10000002");
        const preview = await call({ dryRun: true, pendingOnly: true });
        const { status } = await call({ dryRun: false, pendingOnly: true, expectedHash: preview.json.payloadHash });

        expect(status).toBe(200);
        expect(db.tables.leave_sheet_push_log).toHaveLength(1);
        expect(db.tables.leave_sheet_push_log[0]).toMatchObject({
            dry_run: false, source_key: "ATTENDANCE-2026", conflicts: 1, payload_hash: preview.json.payloadHash,
        });
        // Written → cleared. Conflicted → kept, with the reason.
        expect(db.tables.leave_sheet_push_queue.map((q) => q.emp_id)).toEqual(["10000002"]);
        expect(db.tables.leave_sheet_push_queue[0]).toMatchObject({ attempts: 1 });
        expect(String(db.tables.leave_sheet_push_queue[0].last_error)).toMatch(/disagree/);
    });

    it("keeps an employee queued when the app changed them again during the push", async () => {
        const preview = await call({ dryRun: true, pendingOnly: true });
        db.tables.leave_sheet_push_queue[0].last_queued_at = "2999-01-01T00:00:00Z";

        await call({ dryRun: false, pendingOnly: true, expectedHash: preview.json.payloadHash });
        expect(db.tables.leave_sheet_push_queue.map((q) => q.emp_id)).toEqual(["10000001"]);
    });

    it("lets removals the clerk made by hand clear the queue, as previewed", async () => {
        db.tables.leave_sheet_push_queue = [{
            emp_id: "10000009",
            removals: [{ category: "CL", date: "2026-07-03", reason: "request_cancelled" }],
            last_queued_at: "2026-09-01T00:00:00Z",
            attempts: 0,
        }];

        const preview = await call({ dryRun: true, pendingOnly: true });
        expect(preview.json.manualRemovals).toEqual([
            { empId: "10000009", category: "CL", date: "2026-07-03", reason: "request_cancelled" },
        ]);

        const done = await call({ dryRun: false, pendingOnly: true, expectedHash: preview.json.payloadHash });
        expect(done.status).toBe(200);
        expect(db.tables.leave_sheet_push_queue).toHaveLength(0);
        expect(db.tables.leave_sheet_push_log[0].result).toMatchObject({ acknowledgedRemovals: [{ empId: "10000009" }] });
        expect(sheet.posts).toHaveLength(0);   // nothing was sent to the sheet
    });
});
