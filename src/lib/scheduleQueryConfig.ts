/**
 * Shared TanStack React Query configuration for all schedule-related queries.
 *
 * All queries against the `employee_schedules` table use the "schedule" key prefix
 * so that `queryClient.invalidateQueries({ queryKey: ["schedule"] })` clears
 * every schedule-related cache in one call.
 *
 * Caching strategy: **stale-while-revalidate**
 *  - Show cached data immediately while fresh data is fetched in background.
 *  - Auto-refresh every 15 minutes, for screens left open (e.g. a wall display).
 *  - Re-validate on window focus once the data is 15 minutes old.
 *
 * Schedules change about three times a day (the sheet syncs) plus edits made
 * in the app. Every in-app writer invalidates ["schedule"] in the editor's
 * tab, and a duty-change or leave notification does the same in the
 * recipient's open app: at once by web push, otherwise when the bell's list
 * next refreshes (src/hooks/useNotifications.ts). A shorter interval only
 * re-read the same month — on the free-tier database that is disk IO
 * (DISK_IO_MITIGATION_PLAN.md, Phase 2.4).
 *
 * Only queries keyed under "schedule" may use SCHEDULE_QUERY_OPTIONS, because
 * nothing else is invalidated by an edit. Anything else uses LIVE_QUERY_OPTIONS.
 */

/** Shared cache timings (milliseconds) */
export const SCHEDULE_STALE_TIME = 15 * 60_000;       // 15 minutes
export const SCHEDULE_REFETCH_INTERVAL = 15 * 60_000; // 15 minutes

/** One person's own schedule: a small indexed read, refreshed on reopening the app. */
export const EMPLOYEE_SCHEDULE_STALE_TIME = 2 * 60_000; // 2 minutes

/** Default query options to spread into every query keyed under "schedule" */
export const SCHEDULE_QUERY_OPTIONS = {
    staleTime: SCHEDULE_STALE_TIME,
    refetchOnWindowFocus: true,
    refetchInterval: SCHEDULE_REFETCH_INTERVAL,
} as const;

/**
 * For live views keyed outside "schedule" (rosters, leave, team profiles,
 * single-day reads with their own keys): no edit invalidates them, so they
 * keep a short refresh.
 */
export const LIVE_QUERY_OPTIONS = {
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
} as const;

/**
 * Query key builders.
 * All keys start with "schedule" so a single `invalidateQueries({ queryKey: ["schedule"] })`
 * clears the entire schedule cache tree.
 */
export const scheduleKeys = {
    /** Root — matches all schedule queries */
    all: ["schedule"] as const,

    /** Monthly grid: ["schedule", "grid", startDate, endDate] */
    grid: (startDate: string, endDate: string) =>
        ["schedule", "grid", startDate, endDate] as const,

    /** Single-date queries: ["schedule", "day", dateStr] */
    day: (dateStr: string) =>
        ["schedule", "day", dateStr] as const,

    /** Employee-specific: ["schedule", "employee", employeeCode, startDate?, endDate?] */
    employee: (employeeCode?: string, startDate?: string, endDate?: string) =>
        ["schedule", "employee", employeeCode, startDate, endDate] as const,

    /** Text search / lookup: ["schedule", "lookup", searchTerm] */
    lookup: (search: string) =>
        ["schedule", "lookup", search] as const,

    /** Today's summary (dashboard stat cards): ["schedule", "today", dateStr] */
    today: (dateStr: string) =>
        ["schedule", "today", dateStr] as const,

    /** Team-specific day schedule: ["schedule", "team-day", dateStr, teamKey] */
    teamDay: (dateStr: string, teamKey: string) =>
        ["schedule", "team-day", dateStr, teamKey] as const,

    /** OPE assignments: ["schedule", "ope", dateStr] */
    ope: (dateStr: string) =>
        ["schedule", "ope", dateStr] as const,

    /** Admin health check (not frequently queried) */
    health: () => ["schedule", "health"] as const,
} as const;
