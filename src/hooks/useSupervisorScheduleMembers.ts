import { useQuery } from "@tanstack/react-query";

import { buildNameIndex, findUniqueNameMatch, normalizeEmployeeMatchName } from "@/lib/nameMatching";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";
import { supabase } from "@/integrations/supabase/client";

type ProfileRecord = {
  employee_id: string | null;
  full_name: string | null;
  designation: string | null;
  gender: string | null;
  current_shift: string | null;
};

type TrainingRecord = {
  emp_id: string | null;
  highest_rating: string | null;
  rating_summary?: Record<string, unknown> | null;
  instructor_validity?: Record<string, string> | null;
  ojti?: Record<string, boolean> | null;
};

type ScheduleRow = {
  employee_code: string | null;
  employee_name: string | null;
  duty_date: string | null;
  duty_code: string | null;
  duty_description: string | null;
};

export async function fetchSupervisorScheduleMembers(startDate: string, endDate: string): Promise<SummaryScheduleMember[]> {
  const pageSize = 1000;

  // Fix 1 + Fix 4: Fetch schedules (parallel pages) AND profiles AND training records
  // ALL in one concurrent batch — eliminates the old waterfall of 3 sequential fetches.

  // Step A: Get schedule row count (lightweight HEAD request)
  const { count: scheduleCount, error: countError } = await supabase
    .from("employee_schedules" as any)
    .select("*", { count: "exact", head: true })
    .gte("duty_date", startDate)
    .lte("duty_date", endDate);

  if (countError) throw countError;

  const totalRows = scheduleCount || 0;

  // Step B: Fetch all schedule pages + all profiles + all training records in parallel
  const [schedulePages, profilesResult, trainingResult] = await Promise.all([
    // Fix 1: All schedule pages fetched simultaneously instead of sequentially
    totalRows === 0
      ? Promise.resolve([] as ScheduleRow[][])
      : Promise.all(
          Array.from({ length: Math.ceil(totalRows / pageSize) }, (_, i) =>
            supabase
              .from("employee_schedules" as any)
              .select("employee_code, employee_name, duty_date, duty_code, duty_description")
              .gte("duty_date", startDate)
              .lte("duty_date", endDate)
              .order("duty_date")
              .range(i * pageSize, (i + 1) * pageSize - 1)
              .then(({ data, error }) => {
                if (error) throw error;
                return (data || []) as ScheduleRow[];
              })
          )
        ),

    // Fix 4: Fetch ALL non-hidden profiles in parallel (no need to wait for schedule codes)
    supabase
      .from("profiles")
      .select("employee_id, full_name, designation, gender, current_shift")
      .neq("is_hidden" as any, true),

    // Fix 4: Fetch ALL training records in parallel
    supabase
      .from("employee_training_records" as any)
      .select("emp_id, highest_rating, rating_summary, instructor_validity, ojti"),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (trainingResult.error) throw trainingResult.error;

  const allScheduleRows: ScheduleRow[] = Array.isArray(schedulePages[0])
    ? (schedulePages as ScheduleRow[][]).flat()
    : [];

  const profileRows = (profilesResult.data || []) as ProfileRecord[];
  const trainingRows = (trainingResult.data || []) as TrainingRecord[];

  // Build lookup maps
  const profileMap = new Map(
    profileRows.map((p) => [String(p.employee_id || "").trim(), p])
  );
  const profileNameMap = buildNameIndex(profileRows, (p) => p.full_name);
  const trainingMap = new Map(
    trainingRows.map((r) => [
      String(r.emp_id || "").trim(),
      {
        highest_rating: r.highest_rating || null,
        rating_summary: r.rating_summary || null,
        instructor_validity: r.instructor_validity || null,
        ojti: r.ojti || null,
      },
    ])
  );

  return allScheduleRows
    .map((schedule) => {
      const employeeCode = String(schedule.employee_code || "").trim();
      const profile = profileMap.get(employeeCode) || findUniqueNameMatch(profileNameMap, schedule.employee_name);
      const resolvedEmployeeId =
        employeeCode ||
        String(profile?.employee_id || "").trim() ||
        normalizeEmployeeMatchName(schedule.employee_name);
      const dutyDate = String(schedule.duty_date || "").trim();

      if (!resolvedEmployeeId || !dutyDate) return null;

      return {
        employee_id: resolvedEmployeeId,
        employee_name: schedule.employee_name || profile?.full_name || null,
        duty_date: dutyDate,
        current_shift: profile?.current_shift || null,
        designation: profile?.designation || null,
        gender: profile?.gender || null,
        highest_rating: trainingMap.get(resolvedEmployeeId)?.highest_rating || null,
        rating_summary: trainingMap.get(resolvedEmployeeId)?.rating_summary || null,
        instructor_validity: trainingMap.get(resolvedEmployeeId)?.instructor_validity || null,
        ojti: trainingMap.get(resolvedEmployeeId)?.ojti || null,
        duty_code: schedule.duty_code || null,
        duty_description: schedule.duty_description || null,
      } satisfies SummaryScheduleMember;
    })
    .filter((member): member is SummaryScheduleMember => Boolean(member));
}

export function useSupervisorScheduleMembers(startDate?: string, endDate?: string) {
  return useQuery<SummaryScheduleMember[]>({
    queryKey: ["supervisor-schedule-members", startDate, endDate],
    queryFn: async () => fetchSupervisorScheduleMembers(startDate || "", endDate || ""),
    enabled: Boolean(startDate && endDate),
    staleTime: 60_000,
  });
}