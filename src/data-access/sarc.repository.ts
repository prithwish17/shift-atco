/* eslint-disable @typescript-eslint/no-explicit-any --
 * `employee_schedules`, `employee_training_records` and `sarc_runs` are all
 * absent from the generated Supabase types (src/integrations/supabase/types.ts
 * is out of date and omits several live tables). The casts are confined to this
 * module so every caller sees a typed API; regenerating the types is the real
 * fix and would let these all go.
 */

/**
 * sarc.repository.ts
 * ---------------------------------------------------------------------------
 * Reads for the Stress Allowance Recovery Calculator.
 *
 * Three sources, all already syncing on a schedule:
 *   employee_schedules        the attendance grid            (fetch-schedule)
 *   employee_training_records rating + endorsement dates     (fetch-rating-data)
 *   profiles                  team, designation              (fetch-team-code)
 *
 * The fourth input, IAMATC time on position, has no app equivalent and arrives
 * as an uploaded file — see src/domain/sarc/import.ts.
 */

import { supabase } from '@/integrations/supabase/client';
import type {
    EmployeeMetadata,
    RosterMember,
    SarcPeriod,
    SarcRow,
} from '@/domain/sarc';

/**
 * PostgREST caps a response at 1000 rows. A two-month period across ~375
 * employees is roughly 23,000 duty cells, so every read here pages.
 */
const PAGE_SIZE = 1000;

/**
 * Turn whatever Supabase threw into a real `Error` that names the source.
 *
 * PostgREST returns a plain `{ message, details, hint, code }` object, not an
 * `Error`. Rethrowing it as-is defeats every `error instanceof Error` check up
 * the stack, and the UI ends up reporting "Unknown error" while the actual
 * cause — a missing table, a blocked policy — is sitting right there in the
 * object.
 */
export function asError(cause: unknown, source: string): Error {
    if (cause instanceof Error) {
        cause.message = `${source}: ${cause.message}`;
        return cause;
    }

    const detail = cause as Record<string, unknown> | null;
    const parts = [
        typeof detail?.message === 'string' ? detail.message : null,
        typeof detail?.details === 'string' ? detail.details : null,
        typeof detail?.hint === 'string' ? `Hint: ${detail.hint}` : null,
        typeof detail?.code === 'string' ? `(${detail.code})` : null,
    ].filter(Boolean);

    return new Error(
        `${source}: ${parts.length ? parts.join(' — ') : JSON.stringify(cause ?? 'no detail')}`,
    );
}

/** Refuse to page forever if a server ever returns a full page indefinitely. */
const MAX_PAGES = 500;

/**
 * Page until a request comes back empty.
 *
 * Deliberately **not** driven by an exact row count. Asking PostgREST for
 * `count: 'exact'` makes it count the whole filtered set on *every* page, which
 * cannot use the query's own LIMIT to stop early — on a two-month slice of
 * `employee_schedules` that reliably blew the statement timeout (57014).
 *
 * Stopping on an empty page instead is both cheaper and stricter than stopping
 * on a short one: PostgREST enforces its own `db-max-rows` ceiling, so if that
 * were ever set below PAGE_SIZE, a short page would be normal and a
 * length-based loop would quietly return a partial roster that then gets
 * computed and presented as complete. The cost is one extra empty request per
 * read, which is nothing next to a full count per page.
 */
async function fetchAllPages<T>(
    source: string,
    build: (
        from: number,
        to: number,
    ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
    const all: T[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const from = page * PAGE_SIZE;
        const { data, error } = await build(from, from + PAGE_SIZE - 1);
        if (error) throw asError(error, source);

        const rows = data ?? [];
        all.push(...rows);
        if (rows.length === 0) return all;
    }

    throw new Error(
        `${source}: still returning rows after ${MAX_PAGES} pages (${all.length} so far) — refusing to page further.`,
    );
}

/* ─── Roster ──────────────────────────────────────────────────────────────── */

interface ScheduleRow {
    employee_code: string | null;
    employee_name: string | null;
    duty_date: string | null;
    duty_code: string | null;
}

/**
 * Every duty cell in the period, folded into one roster member per employee.
 *
 * Ordering by (employee_code, duty_date) keeps pagination stable — an unordered
 * range query can repeat or drop rows between pages.
 */
export async function fetchRoster(period: SarcPeriod): Promise<RosterMember[]> {
    const rows = await fetchAllPages<ScheduleRow>('employee_schedules', (from, to) =>
        (supabase.from('employee_schedules' as any) as any)
            .select('employee_code, employee_name, duty_date, duty_code')
            .gte('duty_date', period.start)
            .lte('duty_date', period.end)
            .order('employee_code', { ascending: true })
            .order('duty_date', { ascending: true })
            .range(from, to),
    );

    const byEmployee = new Map<string, RosterMember>();
    for (const row of rows) {
        const empId = (row.employee_code ?? '').trim();
        const date = (row.duty_date ?? '').slice(0, 10);
        if (!empId || !date) continue;

        let member = byEmployee.get(empId);
        if (!member) {
            member = { empId, name: (row.employee_name ?? '').trim() || empId, dutyCodes: {} };
            byEmployee.set(empId, member);
        }

        const code = (row.duty_code ?? '').trim();
        if (code) member.dutyCodes[date] = code;
    }

    return [...byEmployee.values()].sort((a, b) => a.empId.localeCompare(b.empId));
}

/* ─── Metadata ────────────────────────────────────────────────────────────── */

interface ProfileRow {
    employee_id: string | null;
    full_name: string | null;
    designation: string | null;
    current_shift: string | null;
}

interface TrainingRow {
    emp_id: string | null;
    employee_name: string | null;
    rating_data: Record<string, any> | null;
    rating_designation: string | null;
    kolkata_joining_date: string | null;
}

/**
 * Team, designation and rating dates, merged per employee.
 *
 * `profiles` only exists for employees with an app account, so a roster member
 * may legitimately have a training record and no profile, or neither. Callers
 * treat a missing entry as "unknown", never as "none".
 */
export async function fetchEmployeeMetadata(): Promise<Map<string, EmployeeMetadata>> {
    const [profiles, training] = await Promise.all([
        fetchAllPages<ProfileRow>('profiles', (from, to) =>
            (supabase.from('profiles') as any)
                .select('employee_id, full_name, designation, current_shift')
                .order('employee_id', { ascending: true })
                .range(from, to),
        ),
        fetchAllPages<TrainingRow>('employee_training_records', (from, to) =>
            (supabase.from('employee_training_records' as any) as any)
                .select('emp_id, employee_name, rating_data, rating_designation, kolkata_joining_date')
                .order('emp_id', { ascending: true })
                .range(from, to),
        ),
    ]);

    const merged = new Map<string, EmployeeMetadata>();
    const upsert = (empId: string, patch: EmployeeMetadata) => {
        const key = empId.trim();
        if (!key) return;
        merged.set(key, { ...merged.get(key), ...patch });
    };

    for (const row of training) {
        upsert(row.emp_id ?? '', {
            name: row.employee_name,
            designation: row.rating_designation,
            ratingData: row.rating_data,
            kolkataJoiningDate: row.kolkata_joining_date,
        });
    }

    // Profiles win on name and designation: they are maintained in-app, whereas
    // the training record's copies come from an external sync.
    for (const row of profiles) {
        const existing = merged.get((row.employee_id ?? '').trim());
        upsert(row.employee_id ?? '', {
            name: row.full_name ?? existing?.name ?? null,
            designation: row.designation ?? existing?.designation ?? null,
            currentShift: row.current_shift,
        });
    }

    return merged;
}

export interface SarcSources {
    roster: RosterMember[];
    metadata: Map<string, EmployeeMetadata>;
}

export async function fetchSarcSources(period: SarcPeriod): Promise<SarcSources> {
    const [roster, metadata] = await Promise.all([
        fetchRoster(period),
        fetchEmployeeMetadata(),
    ]);
    return { roster, metadata };
}

/* ─── Issued statements ───────────────────────────────────────────────────── */

export interface SarcRunSummary {
    id: string;
    periodStart: string;
    periodEnd: string;
    title: string;
    issuedAt: string;
    issuedByName: string | null;
    employeeCount: number;
    inRecoveryCount: number;
}

interface SarcRunRow {
    id: string;
    period_start: string;
    period_end: string;
    title: string;
    issued_at: string;
    issued_by_name: string | null;
    employee_count: number | null;
    in_recovery_count: number | null;
    rows?: unknown;
}

const toSummary = (row: SarcRunRow): SarcRunSummary => ({
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    title: row.title,
    issuedAt: row.issued_at,
    issuedByName: row.issued_by_name,
    employeeCount: row.employee_count ?? 0,
    inRecoveryCount: row.in_recovery_count ?? 0,
});

export async function listSarcRuns(): Promise<SarcRunSummary[]> {
    const { data, error } = await (supabase.from('sarc_runs' as any) as any)
        .select('id, period_start, period_end, title, issued_at, issued_by_name, employee_count, in_recovery_count')
        .order('issued_at', { ascending: false })
        .limit(50);

    if (error) throw asError(error, 'sarc_runs');
    return ((data ?? []) as SarcRunRow[]).map(toSummary);
}

/**
 * Snapshot an issued statement.
 *
 * The upstream roster and rating data keep moving, so a statement recomputed
 * six months from now will not necessarily reproduce itself. The snapshot is
 * what makes an issued Annexure answerable.
 */
export async function saveSarcRun(input: {
    period: SarcPeriod;
    title: string;
    rows: readonly SarcRow[];
    inRecoveryCount: number;
    note?: string | null;
}): Promise<SarcRunSummary> {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id ?? null;

    let issuedByName: string | null = null;
    if (userId) {
        const { data: profile } = await (supabase.from('profiles') as any)
            .select('full_name')
            .eq('id', userId)
            .maybeSingle();
        issuedByName = profile?.full_name ?? auth?.user?.email ?? null;
    }

    const { data, error } = await (supabase.from('sarc_runs' as any) as any)
        .insert({
            period_start: input.period.start,
            period_end: input.period.end,
            title: input.title,
            issued_by: userId,
            issued_by_name: issuedByName,
            employee_count: input.rows.filter((row) => row.included).length,
            in_recovery_count: input.inRecoveryCount,
            note: input.note ?? null,
            // Only the statement itself is snapshotted. The day-by-day working
            // is ~23,000 cells and is reproducible from the schedule table.
            rows: input.rows
                .filter((row) => row.included)
                .map((row) => ({
                    emp_id: row.empId,
                    name: row.name,
                    designation: row.designation,
                    requirement: row.requirement,
                    performed: row.performed,
                    performed_source: row.performedSource,
                    recovery: row.recovery,
                })),
        })
        .select('id, period_start, period_end, title, issued_at, issued_by_name, employee_count, in_recovery_count')
        .single();

    if (error) throw asError(error, 'sarc_runs (issue)');
    return toSummary(data as SarcRunRow);
}

export async function fetchSarcRun(id: string) {
    const { data, error } = await (supabase.from('sarc_runs' as any) as any)
        .select('*')
        .eq('id', id)
        .single();

    if (error) throw asError(error, 'sarc_runs');
    return data;
}
