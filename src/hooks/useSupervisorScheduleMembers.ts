import { useQuery } from "@tanstack/react-query";

import { buildNameIndex, findUniqueNameMatch, normalizeEmployeeMatchName } from "@/lib/nameMatching";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";
import { supabase } from "@/integrations/supabase/client";
import { fetchScheduleRowsInRange } from "@/data-access/schedule-reads";

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
  // Schedules, profiles and training records are independent reads, so they go
  // out together rather than in series.  The schedule read is keyset-paged (see
  // schedule-reads.ts) because OFFSET paging over this table crosses the 8s
  // statement timeout once enough history accumulates.
  const [allScheduleRows, profilesResult, trainingResult] = await Promise.all([
    fetchScheduleRowsInRange<ScheduleRow>({ startDate, endDate }),

    // Fetch ALL non-hidden profiles in parallel (no need to wait for schedule codes)
    supabase
      .from("profiles")
      .select("employee_id, full_name, designation, gender, current_shift")
      .neq("is_hidden" as any, true),

    // Fetch ALL training records in parallel
    supabase
      .from("employee_training_records" as any)
      .select("emp_id, highest_rating, rating_summary, instructor_validity, ojti"),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (trainingResult.error) throw trainingResult.error;

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