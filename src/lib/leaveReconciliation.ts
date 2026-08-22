/**
 * leaveReconciliation.ts
 *
 * One detector shared by the Leave Discrepancy report and the Leave Backlog
 * workbench, so the two can never disagree about what counts as a mismatch.
 *
 * Leave truth lives in three places that drifted apart while leave was managed
 * in Google Sheets:
 *   1. employee_schedules.duty_code — the roster marker ("this person was off")
 *   2. leave_requests               — the in-app application + approval chain
 *   3. employee_leave_records       — the register (type, comp-off, balances)
 *
 * `schedule_no_request` is the ~1000-item backlog: the roster records that
 * someone was on leave, but no leave type or detail exists anywhere.
 */
import { eachDayOfInterval, format, parseISO } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";
import { getScheduleArchiveCutoff } from "@/hooks/useEmployeeSchedules";

/**
 * Duty codes that mean "already some form of leave".
 *
 * Mirrors public.is_leave_duty_code() in
 * supabase/migrations/20260816110000_leave_backfill_rpcs.sql — keep the two in
 * step. Deliberately excludes CO/SAT/SUN (rest days), G/GO (general duty),
 * Tr/TRG (training) and CH/NH (holidays), none of which are leave.
 *
 * The report previously matched only the exact string "LEAVE", which missed
 * every roster row the sheet writes as "SL" and friends — those backlog items
 * simply never surfaced.
 */
export const LEAVE_DUTY_CODES = [
  "LEAVE", "L", "SL", "CL", "CL_1ST", "CL_2ND", "EL", "HPL", "NEE", "COMM",
  "ML", "PL", "CCL", "LWP", "QL", "SPL", "OD",
] as const;

const LEAVE_DUTY_CODE_SET = new Set<string>(LEAVE_DUTY_CODES);

/** True when any '+'-separated token of the duty code is a leave marker. */
export function isLeaveDutyCode(dutyCode: string | null | undefined): boolean {
  if (!dutyCode) return false;
  return dutyCode
    .toUpperCase()
    .split("+")
    .some((token) => LEAVE_DUTY_CODE_SET.has(token.trim()));
}

/**
 * Categories whose `leave_date` is the DUTY date, not a leave day — for these the
 * day off is `leave_used_on`.
 *
 * This list must match the one the comp-off allocator uses
 * (src/lib/compOffAllocation.ts, useCompOffCandidates.ts, syncApprovedCompOffUsage).
 * The discrepancy report originally listed COMP_OFF_USED / OPE_COMP_OFF /
 * LAST_YEAR_COMP_OFF instead, which do not occur in the data at all, while omitting
 * COMP_OFF_EARNED / LAST_YEAR_CH_DUTY / OPE — 81% of all leave records. Their duty
 * dates were therefore read as leave days, marking days "covered" that were really
 * worked, which silently hid genuine backlog.
 *
 * The three legacy names are kept so any historical rows still key correctly.
 */
export const COMP_OFF_CATEGORIES = [
  "COMP_OFF",
  "COMP_OFF_EARNED",
  "LAST_YEAR_CH_DUTY",
  "OPE",
  // legacy / not observed in current data, retained defensively
  "COMP_OFF_USED",
  "OPE_COMP_OFF",
  "LAST_YEAR_COMP_OFF",
] as const;

export const NON_COMPOFF_LEAVE_CATEGORIES = [
  "CL", "EL", "RH", "HPL", "NEE", "COMM",
] as const;

export type DiscrepancyKind =
  | "schedule_no_request"
  | "approved_no_schedule"
  | "record_no_schedule"
  | "sheet_vs_app";

export type DiscrepancyRow = {
  employeeCode: string;
  employeeName: string;
  team: string;
  date: string;
  kind: DiscrepancyKind;
  detail: string;
  leaveType: string | null;
  requestStatus: string | null;
  /** Roster code that produced the row, when the schedule is the source. */
  dutyCode?: string | null;
  /** employee_leave_records.id — present for sheet_vs_app, for resolution actions. */
  recordId?: string | null;
  /** What the sheet last tried to write, when it disagrees with the app. */
  sheetShadow?: Record<string, unknown> | null;
};

type ProfileRow = {
  id: string;
  employee_id: string | null;
  full_name: string | null;
  current_shift: string | null;
};

type LeaveRecordRow = {
  id: string;
  emp_id: string;
  employee_name: string | null;
  leave_category: string;
  leave_date: string;
  leave_used_on: string | null;
  metadata: Record<string, unknown> | null;
};

type ScheduleRow = {
  employee_code: string;
  duty_date: string;
  employee_name: string | null;
  duty_code: string | null;
};

/**
 * Leave-coded roster rows for a range that has already been archived out of
 * employee_schedules.
 *
 * The archiver ships rows older than the retention window to the audit-log Google
 * Sheet and deletes them from Postgres, so months before the cutoff are simply
 * absent from the table — and their backlog would be invisible. /api/schedule-archive
 * reads them back on demand, which is the same fallback useEmployeeSchedules uses
 * for its own display.
 *
 * Never throws: an unreachable archive degrades to "no older backlog found"
 * rather than breaking the report for the months that ARE in the database.
 */
async function fetchArchivedLeaveSchedules(from: string, to: string): Promise<ScheduleRow[]> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];

    const url = new URL(`${getFunctionsProxyBaseUrl()}/api/schedule-archive`);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return [];

    const json = await res.json().catch(() => null);
    const rows = (json?.rows || []) as Array<{
      employee_code: string;
      employee_name: string;
      duty_date: string;
      duty_code: string;
    }>;

    // The archive returns every duty code for the range; keep only leave markers.
    return rows
      .filter((r) => isLeaveDutyCode(r.duty_code))
      .map((r) => ({
        employee_code: r.employee_code,
        duty_date: r.duty_date,
        employee_name: r.employee_name,
        duty_code: r.duty_code,
      }));
  } catch {
    return [];
  }
}

/**
 * Every leave-truth mismatch in [monthStart, monthEnd].
 *
 * Kept as one round of parallel queries rather than a view so it stays readable
 * and so the backlog workbench can reuse it unchanged.
 */
export async function fetchLeaveDiscrepancies(
  monthStart: string,
  monthEnd: string,
): Promise<DiscrepancyRow[]> {
  const [scheduleRes, requestRes, leaveRecordRes, compOffRecordRes, shadowRes] = await Promise.all([
    supabase
      .from("employee_schedules")
      .select("employee_code, duty_date, employee_name, duty_code")
      .in("duty_code", LEAVE_DUTY_CODES as unknown as string[])
      .gte("duty_date", monthStart)
      .lte("duty_date", monthEnd),
    supabase
      .from("leave_requests")
      .select("employee_id, employee_name, leave_type, status, start_date, end_date")
      .not("status", "in", `("Rejected","Cancelled")`)
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart),
    // CL / EL / RH etc. — leave was taken on leave_date
    supabase
      .from("employee_leave_records")
      .select("id, emp_id, employee_name, leave_category, leave_date, leave_used_on, metadata")
      .in("leave_category", NON_COMPOFF_LEAVE_CATEGORIES as unknown as string[])
      .gte("leave_date", monthStart)
      .lte("leave_date", monthEnd),
    // COMP_OFF variants — leave was taken on leave_used_on
    supabase
      .from("employee_leave_records")
      .select("id, emp_id, employee_name, leave_category, leave_date, leave_used_on, metadata")
      .in("leave_category", COMP_OFF_CATEGORIES as unknown as string[])
      .gte("leave_used_on", monthStart)
      .lte("leave_used_on", monthEnd),
    // Rows where the sheet sync tried to overwrite app-authored data and was
    // refused by protect_app_authored_leave_records().
    supabase
      .from("employee_leave_records")
      .select("id, emp_id, employee_name, leave_category, leave_date, leave_used_on, metadata")
      .not("metadata->sheet_shadow", "is", null)
      .gte("leave_date", monthStart)
      .lte("leave_date", monthEnd),
  ]);

  if (scheduleRes.error) throw scheduleRes.error;
  if (requestRes.error) throw requestRes.error;
  if (leaveRecordRes.error) throw leaveRecordRes.error;
  if (compOffRecordRes.error) throw compOffRecordRes.error;
  if (shadowRes.error) throw shadowRes.error;

  const dbScheduleRows = (scheduleRes.data || []) as unknown as ScheduleRow[];

  // Months before the retention cutoff live only in the archive.
  const archiveCutoff = getScheduleArchiveCutoff();
  const archivedRows =
    monthStart < archiveCutoff
      ? await fetchArchivedLeaveSchedules(
          monthStart,
          monthEnd < archiveCutoff ? monthEnd : archiveCutoff,
        )
      : [];

  // A range spanning the cutoff can return the same day from both sources.
  const scheduleRows: ScheduleRow[] = [...dbScheduleRows];
  const seenScheduleKeys = new Set(dbScheduleRows.map((r) => `${r.employee_code}:${r.duty_date}`));
  for (const row of archivedRows) {
    const key = `${row.employee_code}:${row.duty_date}`;
    if (seenScheduleKeys.has(key)) continue;
    seenScheduleKeys.add(key);
    scheduleRows.push(row);
  }
  const requestRows = (requestRes.data || []) as unknown as Array<{
    employee_id: string;
    employee_name: string;
    leave_type: string;
    status: string;
    start_date: string;
    end_date: string;
  }>;
  const allLeaveRecordRows = [
    ...((leaveRecordRes.data || []) as unknown as LeaveRecordRow[]),
    ...((compOffRecordRes.data || []) as unknown as LeaveRecordRow[]),
  ];
  const shadowRows = (shadowRes.data || []) as unknown as LeaveRecordRow[];

  // Bridge the two identities: leave_requests keys on auth uid, everything else
  // on the employee code. profiles.employee_id is UNIQUE, so this is 1:1.
  const authIds = [...new Set(requestRows.map((r) => r.employee_id))];
  const scheduleCodes = [
    ...new Set([
      ...scheduleRows.map((r) => r.employee_code),
      ...allLeaveRecordRows.map((r) => r.emp_id),
      ...shadowRows.map((r) => r.emp_id),
    ]),
  ];

  const [authProfilesRes, codeProfilesRes] = await Promise.all([
    authIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, employee_id, full_name, current_shift")
          .in("id", authIds)
      : Promise.resolve({ data: [], error: null }),
    scheduleCodes.length > 0
      ? supabase
          .from("profiles")
          .select("id, employee_id, full_name, current_shift")
          .in("employee_id", scheduleCodes)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (authProfilesRes.error) throw authProfilesRes.error;
  if (codeProfilesRes.error) throw codeProfilesRes.error;

  const allProfiles = [
    ...((authProfilesRes.data || []) as ProfileRow[]),
    ...((codeProfilesRes.data || []) as ProfileRow[]),
  ];

  const authToCode = new Map(
    allProfiles.filter((p) => p.employee_id).map((p) => [p.id, p.employee_id!]),
  );
  const codeToProfile = new Map(
    allProfiles.filter((p) => p.employee_id).map((p) => [p.employee_id!, p]),
  );

  const scheduleSet = new Set(scheduleRows.map((r) => `${r.employee_code}:${r.duty_date}`));

  const requestDaySet = new Set<string>();
  type ApprovedEntry = { code: string; date: string; row: (typeof requestRows)[0] };
  const approvedEntries: ApprovedEntry[] = [];

  for (const req of requestRows) {
    const code = authToCode.get(req.employee_id);
    if (!code) continue;
    try {
      const days = eachDayOfInterval({
        start: parseISO(req.start_date),
        end: parseISO(req.end_date),
      });
      for (const day of days) {
        const iso = format(day, "yyyy-MM-dd");
        if (iso < monthStart || iso > monthEnd) continue;
        requestDaySet.add(`${code}:${iso}`);
        if (req.status === "Approved") approvedEntries.push({ code, date: iso, row: req });
      }
    } catch {
      // skip malformed dates
    }
  }

  const leaveRecordSet = new Set<string>();
  type RecordEntry = { code: string; date: string; row: LeaveRecordRow };
  const recordEntries: RecordEntry[] = [];

  for (const rec of allLeaveRecordRows) {
    const isCompOff = (COMP_OFF_CATEGORIES as readonly string[]).includes(rec.leave_category);
    const effectiveDate = isCompOff ? (rec.leave_used_on ?? rec.leave_date) : rec.leave_date;
    if (!effectiveDate) continue;
    leaveRecordSet.add(`${rec.emp_id}:${effectiveDate}`);
    recordEntries.push({ code: rec.emp_id, date: effectiveDate, row: rec });
  }

  const rows: DiscrepancyRow[] = [];
  const seen = new Set<string>();

  const profileFor = (code: string) => codeToProfile.get(code);

  // Case 1: roster says leave, but neither a request nor a record exists.
  //         This is the backlog.
  for (const sched of scheduleRows) {
    const empKey = `${sched.employee_code}:${sched.duty_date}`;
    if (requestDaySet.has(empKey) || leaveRecordSet.has(empKey)) continue;
    const key = `${empKey}:schedule_no_request`;
    if (seen.has(key)) continue;
    seen.add(key);
    const profile = profileFor(sched.employee_code);
    rows.push({
      employeeCode: sched.employee_code,
      employeeName: profile?.full_name || sched.employee_name || sched.employee_code,
      team: profile?.current_shift || "—",
      date: sched.duty_date,
      kind: "schedule_no_request",
      detail: `Roster shows ${sched.duty_code || "LEAVE"} — no matching leave request or leave record`,
      leaveType: null,
      requestStatus: null,
      dutyCode: sched.duty_code,
    });
  }

  // Case 2: approved leave request the roster never picked up.
  for (const entry of approvedEntries) {
    if (scheduleSet.has(`${entry.code}:${entry.date}`)) continue;
    const key = `${entry.code}:${entry.date}:approved_no_schedule`;
    if (seen.has(key)) continue;
    seen.add(key);
    const profile = profileFor(entry.code);
    rows.push({
      employeeCode: entry.code,
      employeeName: profile?.full_name || entry.row.employee_name || entry.code,
      team: profile?.current_shift || "—",
      date: entry.date,
      kind: "approved_no_schedule",
      detail: `Approved ${entry.row.leave_type} request — schedule not updated`,
      leaveType: entry.row.leave_type,
      requestStatus: entry.row.status,
    });
  }

  // Case 3: register row the roster never picked up.
  for (const entry of recordEntries) {
    if (scheduleSet.has(`${entry.code}:${entry.date}`)) continue;
    const key = `${entry.code}:${entry.date}:record_no_schedule`;
    if (seen.has(key)) continue;
    seen.add(key);
    const profile = profileFor(entry.code);
    rows.push({
      employeeCode: entry.code,
      employeeName: profile?.full_name || entry.row.employee_name || entry.code,
      team: profile?.current_shift || "—",
      date: entry.date,
      kind: "record_no_schedule",
      detail: `Leave record (${entry.row.leave_category}) found — schedule not updated`,
      leaveType: entry.row.leave_category,
      requestStatus: null,
    });
  }

  // Case 4: the sheet disagrees with the app for a row the app owns.
  for (const rec of shadowRows) {
    const shadow = (rec.metadata?.sheet_shadow ?? null) as Record<string, unknown> | null;
    if (!shadow) continue;
    const key = `${rec.emp_id}:${rec.leave_date}:sheet_vs_app`;
    if (seen.has(key)) continue;
    seen.add(key);
    const profile = profileFor(rec.emp_id);
    rows.push({
      employeeCode: rec.emp_id,
      employeeName: profile?.full_name || rec.employee_name || rec.emp_id,
      team: profile?.current_shift || "—",
      date: rec.leave_date,
      kind: "sheet_vs_app",
      detail: `Google Sheet disagrees with the app for this ${rec.leave_category} record`,
      leaveType: rec.leave_category,
      requestStatus: null,
      recordId: rec.id,
      sheetShadow: shadow,
    });
  }

  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName),
  );
}

/**
 * One backlog application: a run of consecutive leave days for one employee.
 *
 * The raw backlog is ~1000 day-rows; a supervisor thinks in applications, not
 * days, so consecutive days collapse into a single item to action.
 */
export type BacklogItem = {
  employeeCode: string;
  employeeName: string;
  team: string;
  startDate: string;
  endDate: string;
  dates: string[];
  dutyCodes: string[];
};

/** Collapse `schedule_no_request` rows into per-employee consecutive-date runs. */
export function groupBacklogRuns(rows: DiscrepancyRow[]): BacklogItem[] {
  const backlog = rows
    .filter((r) => r.kind === "schedule_no_request")
    .sort(
      (a, b) => a.employeeCode.localeCompare(b.employeeCode) || a.date.localeCompare(b.date),
    );

  const items: BacklogItem[] = [];
  let current: BacklogItem | null = null;

  const isNextDay = (prev: string, next: string) => {
    const d = parseISO(prev);
    d.setDate(d.getDate() + 1);
    return format(d, "yyyy-MM-dd") === next;
  };

  for (const row of backlog) {
    const continues =
      current !== null &&
      current.employeeCode === row.employeeCode &&
      isNextDay(current.endDate, row.date);

    if (!continues) {
      if (current) items.push(current);
      current = {
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        team: row.team,
        startDate: row.date,
        endDate: row.date,
        dates: [row.date],
        dutyCodes: [row.dutyCode || "LEAVE"],
      };
      continue;
    }

    current!.endDate = row.date;
    current!.dates.push(row.date);
    current!.dutyCodes.push(row.dutyCode || "LEAVE");
  }

  if (current) items.push(current);
  return items;
}

/** A stretch of consecutive days within one backlog run sharing a single type. */
export type LeaveSegment = {
  startDate: string;
  endDate: string;
  dates: string[];
  leaveType: string;
  /** Closed-holiday dates inside this segment — not deducted, they earn comp-off. */
  chDates: string[];
  /** Days actually deducted: length minus closed holidays. */
  totalDays: number;
};

/** Closed holidays are only special for CL-family and comp-off leave. */
function chAppliesTo(leaveType: string): boolean {
  return leaveType.startsWith("CL") || leaveType === "COMP_OFF";
}

/**
 * Split one backlog run into per-type segments.
 *
 * An unbroken run of LEAVE on the roster is frequently several different leave
 * types in reality — 4–9 Aug casual leave, 10 Aug comp-off. Each segment becomes
 * its own leave_requests row, which also keeps check_leave_overlap() satisfied,
 * since consecutive segments never share a date.
 *
 * `dates` must be sorted ascending. Dates absent from `dateTypes` take
 * `defaultType`, so the no-split case is just one segment.
 */
export function splitIntoLeaveSegments(
  dates: string[],
  defaultType: string,
  dateTypes: Record<string, string>,
  isClosedHoliday: (date: string) => boolean,
): LeaveSegment[] {
  const build = (bucket: string[], leaveType: string): LeaveSegment => {
    const chDates = chAppliesTo(leaveType) ? bucket.filter(isClosedHoliday) : [];
    return {
      startDate: bucket[0],
      endDate: bucket[bucket.length - 1],
      dates: bucket,
      leaveType,
      chDates,
      totalDays: bucket.length - chDates.length,
    };
  };

  const out: LeaveSegment[] = [];
  let bucket: string[] = [];
  let bucketType: string | null = null;

  for (const date of dates) {
    const type = dateTypes[date] || defaultType;
    if (bucketType !== null && type !== bucketType) {
      out.push(build(bucket, bucketType));
      bucket = [];
    }
    bucketType = type;
    bucket.push(date);
  }
  if (bucket.length > 0 && bucketType !== null) out.push(build(bucket, bucketType));
  return out;
}
