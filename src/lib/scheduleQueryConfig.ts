/**
 * Shared TanStack React Query configuration for all schedule-related queries.
 *
 * All queries against the `employee_schedules` table use the "schedule" key prefix
 * so that `queryClient.invalidateQueries({ queryKey: ["schedule"] })` clears
 * every schedule-related cache in one call.
 *
 * Caching strategy: **stale-while-revalidate**
 *  - Show cached data immediately while fresh data is fetched in background.
 *  - Auto-refresh every 5 minutes.
 *  - Re-validate on window focus (e.g. user switches back to tab).
 */

/** Shared cache timings (milliseconds) */
export const SCHEDULE_STALE_TIME = 60_000;       // 60 seconds
export const SCHEDULE_REFETCH_INTERVAL = 300_000; // 5 minutes

/** Default query options to spread into every schedule-related useQuery */
export const SCHEDULE_QUERY_OPTIONS = {
    staleTime: SCHEDULE_STALE_TIME,
    refetchOnWindowFocus: true,
    refetchInterval: SCHEDULE_REFETCH_INTERVAL,
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
