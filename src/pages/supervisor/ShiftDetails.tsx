import { useEffect, useMemo, useState, memo } from "react";
import { format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarDays, GraduationCap, RefreshCw, Search, ShieldCheck, Table2 } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import { extractTraineeMilestone, getTraineeStatusBadgeClass, getTraineeStatusLabel, type TraineeStatus } from "@/lib/traineeMilestones";
import { normalizeTeamKey } from "@/lib/teamDutyRotation";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type ShiftTeamKey = "G" | "A" | "B" | "C" | "D" | "E";
type StatusFilterKey = "on-leave" | "instructor" | "rated" | "trainee-marked" | "licensed";

type ScheduleRow = {
  id: string;
  employee_code: string;
  employee_name: string;
  duty_date: string;
  duty_code: string;
  duty_description: string;
};

type ProfileRow = {
  id: string;
  employee_id: string | null;
  full_name: string | null;
  designation: string | null;
  current_shift: string | null;
  station: string | null;
  is_hidden?: boolean;
};

type LicenseRow = {
  user_id: string;
  license_type: string;
  expiry_date: string | null;
};

type LeaveRow = {
  employee_id: string;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  status: string;
};

type TrainingDetailRow = {
  emp_id: string;
  highest_rating: string | null;
  rating_designation: string | null;
  trainee_designation: string | null;
  trainee_unit: string | null;
  trainee_hours_required: number | null;
  trainee_status: TraineeStatus | null;
  trainee_hr_grade: TraineeStatus | null;
  trainee_preboard_completed_on: string | null;
  trainee_preboard_scheduled_on: string | null;
  trainee_board_scheduled_on: string | null;
  instructor_validity: Record<string, string> | null;
  ojti: Record<string, boolean> | null;
  raw_payload?: Record<string, unknown> | null;
};

type ShiftDetailRow = {
  scheduleId: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  station: string | null;
  team: ShiftTeamKey;
  dutyCode: string;
  dutyDescription: string;
  highestRating: string | null;
  instructorKeys: string[];
  trainee: ReturnType<typeof extractTraineeMilestone>;
  licenseLabels: string[];
  nearestLicenseExpiry: string | null;
  leave: LeaveRow | null;
  _searchText: string;
};

const TEAM_TABS: Array<{ key: ShiftTeamKey; label: string; accentClass: string }> = [
  { key: "G", label: "General", accentClass: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { key: "A", label: "Team A", accentClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
  { key: "B", label: "Team B", accentClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { key: "C", label: "Team C", accentClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { key: "D", label: "Team D", accentClass: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  { key: "E", label: "Team E", accentClass: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
];

const LICENSE_LABELS: Record<string, string> = {
  rdr: "Radar",
  app: "Approach",
  plr: "Precision",
  adc: "Aerodrome",
  alpha: "Alpha",
  occ: "Oceanic",
};

const STATUS_FILTER_OPTIONS: Array<{ key: StatusFilterKey; label: string }> = [
  { key: "on-leave", label: "On Leave" },
  { key: "instructor", label: "Instructor" },
  { key: "rated", label: "Has Rating" },
  { key: "trainee-marked", label: "Trainee Marked" },
  { key: "licensed", label: "License On File" },
];

const POSITION_FILTER_LABELS: Record<string, string> = {
  ADC: "ADC",
  APP: "APP",
  "APP(S)": "APP(S)",
  "APP+APP(S)": "APP+APP(S)",
  ACC: "ACC",
  "ACC(S)": "ACC(S)",
  "ACC+ACC(S)": "ACC+ACC(S)",
  OCC: "OCC",
  PLR: "PLR",
  SCC: "SCC",
  ART: "ART",
};

const POSITION_FILTER_ORDER = [
  "ADC",
  "APP",
  "APP(S)",
  "APP+APP(S)",
  "ACC",
  "ACC(S)",
  "ACC+ACC(S)",
  "OCC",
  "PLR",
  "SCC",
  "ART",
];

function formatFilterLabelList(labels: string[]) {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}

function normalizePositionKey(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function formatPositionFilterLabel(value: string) {
  const normalized = normalizePositionKey(value);
  return POSITION_FILTER_LABELS[normalized] || normalized;
}

function comparePositionFilterKeys(left: string, right: string) {
  const leftNormalized = normalizePositionKey(left);
  const rightNormalized = normalizePositionKey(right);
  const leftOrder = POSITION_FILTER_ORDER.indexOf(leftNormalized);
  const rightOrder = POSITION_FILTER_ORDER.indexOf(rightNormalized);

  if (leftOrder !== -1 || rightOrder !== -1) {
    if (leftOrder === -1) return 1;
    if (rightOrder === -1) return -1;
    return leftOrder - rightOrder;
  }

  return leftNormalized.localeCompare(rightNormalized);
}

function getISTDateKey(now = new Date()) {
  const istDate = new Date(now.getTime() + 330 * 60 * 1000);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeEmployeeCode(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function isNotAvailableDuty(dutyCode: string | null | undefined, dutyDescription: string | null | undefined) {
  const normalizedCode = String(dutyCode || "").trim().toUpperCase();
  const normalizedDescription = String(dutyDescription || "").trim().toUpperCase();

  return normalizedCode === "NA" || normalizedCode === "N/A" || normalizedDescription.includes("NOT AVAILABLE");
}

function normalizeDateString(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function formatLicenseLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return LICENSE_LABELS[normalized] || normalized.toUpperCase();
}

function getInstructorKeys(record: TrainingDetailRow | null | undefined) {
  if (!record) return [] as string[];
  const validityKeys = Object.keys(record.instructor_validity || {});
  const ojtiKeys = Object.entries(record.ojti || {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);

  return Array.from(
    new Set(
      [...validityKeys, ...ojtiKeys]
        .map((key) => key.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function getLicenseTone(expiryDate: string | null, referenceDate: string) {
  if (!expiryDate) {
    return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  }

  if (expiryDate < referenceDate) {
    return "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
  }

  const threshold = new Date(`${referenceDate}T00:00:00`);
  threshold.setDate(threshold.getDate() + 30);
  const dueSoonKey = threshold.toISOString().slice(0, 10);

  if (expiryDate <= dueSoonKey) {
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  }

  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
}

function getLeaveTone(isOnLeave: boolean) {
  return isOnLeave
    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function isRowOnLeave(row: ShiftDetailRow) {
  return Boolean(row.leave) || row.dutyCode === "LEAVE";
}

function matchesStatusFilter(row: ShiftDetailRow, filterKey: StatusFilterKey) {
  switch (filterKey) {
    case "on-leave":
      return isRowOnLeave(row);
    case "instructor":
      return row.instructorKeys.length > 0;
    case "rated":
      return Boolean(row.highestRating);
    case "trainee-marked":
      return Boolean(row.trainee);
    case "licensed":
      return row.licenseLabels.length > 0;
    default:
      return true;
  }
}

function getRowPositionKeys(
  row: ShiftDetailRow,
  includeInstructorKeys: boolean,
  includeTraineeUnit: boolean,
) {
  const keys = new Set<string>();

  if (includeInstructorKeys) {
    row.instructorKeys.forEach((key) => {
      const normalized = normalizePositionKey(key);
      if (normalized) keys.add(normalized);
    });
  }

  if (includeTraineeUnit) {
    const traineeUnit = normalizePositionKey(row.trainee?.unit);
    if (traineeUnit) keys.add(traineeUnit);
  }

  return Array.from(keys).sort(comparePositionFilterKeys);
}

async function fetchTrainingDetails(employeeCodes: string[]) {
  if (employeeCodes.length === 0) return [] as TrainingDetailRow[];

  const fullSelect = [
    "emp_id",
    "highest_rating",
    "rating_designation",
    "trainee_designation",
    "trainee_unit",
    "trainee_hours_required",
    "trainee_status",
    "trainee_hr_grade",
    "trainee_preboard_completed_on",
    "trainee_preboard_scheduled_on",
    "trainee_board_scheduled_on",
    "instructor_validity",
    "ojti",
    "raw_payload",
  ].join(", ");

  const fallbackSelect = [
    "emp_id",
    "highest_rating",
    "rating_designation",
    "trainee_designation",
    "trainee_unit",
    "trainee_hours_required",
    "instructor_validity",
    "ojti",
    "raw_payload",
  ].join(", ");

  const { data, error } = await supabase
    .from("employee_training_records" as any)
    .select(fullSelect)
    .in("emp_id", employeeCodes);

  if (!error) {
    return (data || []) as TrainingDetailRow[];
  }

  console.warn("[ShiftDetails] Full training query failed, falling back to subset:", error.message);

  const fallback = await supabase
    .from("employee_training_records" as any)
    .select(fallbackSelect)
    .in("emp_id", employeeCodes);

  if (fallback.error) throw fallback.error;

  return ((fallback.data || []) as Array<Record<string, unknown>>).map((row) => ({
    emp_id: String(row.emp_id || ""),
    highest_rating: (row.highest_rating as string | null) || null,
    rating_designation: (row.rating_designation as string | null) || null,
    trainee_designation: (row.trainee_designation as string | null) || null,
    trainee_unit: (row.trainee_unit as string | null) || null,
    trainee_hours_required: typeof row.trainee_hours_required === "number" ? row.trainee_hours_required : null,
    trainee_status: null,
    trainee_hr_grade: null,
    trainee_preboard_completed_on: null,
    trainee_preboard_scheduled_on: null,
    trainee_board_scheduled_on: null,
    instructor_validity: (row.instructor_validity as Record<string, string> | null) || null,
    ojti: (row.ojti as Record<string, boolean> | null) || null,
    raw_payload: (row.raw_payload as Record<string, unknown> | null) || null,
  }));
}

const SummaryCard = memo(function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card className="rounded-[18px] border-slate-200/80 bg-white/90 dark:border-slate-800 dark:bg-slate-950/80 sm:rounded-[22px]">
      <CardContent className="p-3 sm:p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.18em]">{label}</p>
        <p className="mt-1.5 text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:mt-2 sm:text-2xl">{value}</p>
        <p className="mt-1 text-xs leading-4 text-slate-500 dark:text-slate-400 sm:text-sm">{detail}</p>
      </CardContent>
    </Card>
  );
});

export default function ShiftDetails() {
  const [selectedDate, setSelectedDate] = useState(() => getISTDateKey());
  const [activeTeam, setActiveTeam] = useState<ShiftTeamKey>("G");
  const [search, setSearch] = useState("");
  const [selectedStatusFilters, setSelectedStatusFilters] = useState<StatusFilterKey[]>([]);
  const [selectedPositionFilters, setSelectedPositionFilters] = useState<string[]>([]);

  const debouncedSearch = useDebouncedValue(search, 250);

  const shiftDetailsQuery = useQuery({
    queryKey: ["shift-details", selectedDate],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      const { data: scheduleData, error: scheduleError } = await supabase
        .from("employee_schedules" as any)
        .select("id, employee_code, employee_name, duty_date, duty_code, duty_description")
        .eq("duty_date", selectedDate)
        .order("employee_name", { ascending: true });

      if (scheduleError) throw scheduleError;

      const scheduleRows = ((scheduleData || []) as ScheduleRow[]).map((row) => ({
        ...row,
        employee_code: normalizeEmployeeCode(row.employee_code),
      }));

      const availableScheduleRows = scheduleRows.filter(
        (row) => !isNotAvailableDuty(row.duty_code, row.duty_description),
      );

      const employeeCodes = Array.from(new Set(availableScheduleRows.map((row) => row.employee_code).filter(Boolean)));
      if (employeeCodes.length === 0) {
        return [] as ShiftDetailRow[];
      }

      const [{ data: profilesData, error: profilesError }, trainingRows] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, employee_id, full_name, designation, current_shift, station, is_hidden")
          .in("employee_id", employeeCodes),
        fetchTrainingDetails(employeeCodes),
      ]);

      if (profilesError) throw profilesError;

      const allProfiles = (profilesData || []) as ProfileRow[];
      const hiddenCodes = new Set(
        allProfiles
          .filter((profile) => profile.is_hidden)
          .map((profile) => normalizeEmployeeCode(profile.employee_id)),
      );

      const visibleProfiles = allProfiles.filter((profile) => !profile.is_hidden);
      const visibleSchedules = availableScheduleRows.filter((row) => !hiddenCodes.has(row.employee_code));
      const visibleProfileIds = visibleProfiles.map((profile) => profile.id).filter(Boolean);

      const [licensesResult, leavesResult] = await Promise.all([
        visibleProfileIds.length > 0
          ? supabase
              .from("employee_licenses")
              .select("user_id, license_type, expiry_date")
              .in("user_id", visibleProfileIds)
          : Promise.resolve({ data: [] as LicenseRow[], error: null }),
        visibleProfileIds.length > 0
          ? supabase
              .from("leave_requests" as any)
              .select("employee_id, employee_name, leave_type, start_date, end_date, status")
              .eq("status", "Approved")
              .lte("start_date", selectedDate)
              .gte("end_date", selectedDate)
              .in("employee_id", visibleProfileIds)
          : Promise.resolve({ data: [] as LeaveRow[], error: null }),
      ]);

      if (licensesResult.error) throw licensesResult.error;
      if (leavesResult.error) throw leavesResult.error;

      const profileByCode = new Map(
        visibleProfiles.map((profile) => [normalizeEmployeeCode(profile.employee_id), profile]),
      );
      const trainingByCode = new Map(
        trainingRows.map((record) => [normalizeEmployeeCode(record.emp_id), record]),
      );

      const licensesByUser = new Map<string, LicenseRow[]>();
      for (const license of (licensesResult.data || []) as LicenseRow[]) {
        const existing = licensesByUser.get(license.user_id) || [];
        existing.push(license);
        licensesByUser.set(license.user_id, existing);
      }

      const leaveByUser = new Map(
        ((leavesResult.data || []) as LeaveRow[]).map((leave) => [leave.employee_id, leave]),
      );

      return visibleSchedules.map((scheduleRow) => {
        const profile = profileByCode.get(scheduleRow.employee_code);
        const training = trainingByCode.get(scheduleRow.employee_code);
        const licenses = profile?.id ? licensesByUser.get(profile.id) || [] : [];
        const leave = profile?.id ? leaveByUser.get(profile.id) || null : null;
        const team = normalizeTeamKey(profile?.current_shift) as ShiftTeamKey;
        const trainee = extractTraineeMilestone(training || null);
        const nearestLicenseExpiry = licenses
          .map((license) => normalizeDateString(license.expiry_date))
          .filter(Boolean)
          .sort((left, right) => String(left).localeCompare(String(right)))[0] || null;

        const employeeName = profile?.full_name || scheduleRow.employee_name || scheduleRow.employee_code;
        const designation = profile?.designation || training?.rating_designation || training?.trainee_designation || null;
        const dutyCode = scheduleRow.duty_code || "—";
        const dutyDescription = scheduleRow.duty_description || "";
        const highestRating = training?.highest_rating || null;
        const instructorKeys = getInstructorKeys(training).sort(comparePositionFilterKeys);

        const _searchText = [
          scheduleRow.employee_code,
          employeeName,
          designation,
          highestRating,
          dutyCode,
          dutyDescription,
          trainee?.unit,
          instructorKeys.join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return {
          scheduleId: scheduleRow.id,
          employeeCode: scheduleRow.employee_code,
          employeeName,
          designation,
          station: profile?.station || null,
          team,
          dutyCode,
          dutyDescription,
          highestRating,
          instructorKeys,
          trainee,
          licenseLabels: licenses.map((license) => formatLicenseLabel(license.license_type)).filter(Boolean),
          nearestLicenseExpiry,
          leave,
          _searchText,
        } satisfies ShiftDetailRow;
      });
    },
  });

  const rows = shiftDetailsQuery.data || [];
  const toggleStatusFilter = (filterKey: StatusFilterKey) => {
    setSelectedStatusFilters((current) => (
      current.includes(filterKey)
        ? current.filter((value) => value !== filterKey)
        : [...current, filterKey]
    ));
  };

  const selectedStatusLabels = useMemo(
    () => STATUS_FILTER_OPTIONS.filter((option) => selectedStatusFilters.includes(option.key)),
    [selectedStatusFilters],
  );

  const includeInstructorPositionFilters = selectedStatusFilters.includes("instructor");
  const includeTraineePositionFilters = selectedStatusFilters.includes("trainee-marked");
  const showPositionFilters = includeInstructorPositionFilters || includeTraineePositionFilters;

  const activeTeamRows = useMemo(
    () => rows.filter((row) => row.team === activeTeam),
    [activeTeam, rows],
  );

  const { positionFilterOptions, positionFilterRowCount } = useMemo(() => {
    if (!showPositionFilters) return { positionFilterOptions: [] as Array<{ key: string; label: string; count: number }>, positionFilterRowCount: 0 };

    const counts = new Map<string, number>();
    let rowCount = 0;

    activeTeamRows.forEach((row) => {
      const keys = getRowPositionKeys(row, includeInstructorPositionFilters, includeTraineePositionFilters);
      if (keys.length > 0) rowCount++;
      keys.forEach((key) => {
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });

    return {
      positionFilterOptions: Array.from(counts.entries())
        .sort(([leftKey], [rightKey]) => comparePositionFilterKeys(leftKey, rightKey))
        .map(([key, count]) => ({
          key,
          label: formatPositionFilterLabel(key),
          count,
        })),
      positionFilterRowCount: rowCount,
    };
  }, [activeTeamRows, includeInstructorPositionFilters, includeTraineePositionFilters, showPositionFilters]);

  useEffect(() => {
    const availableKeys = new Set(positionFilterOptions.map((option) => option.key));

    setSelectedPositionFilters((current) => {
      const next = current.filter((key) => availableKeys.has(key));
      return next.length === current.length && next.every((key, index) => key === current[index])
        ? current
        : next;
    });
  }, [positionFilterOptions]);

  const allTeamSummaries = useMemo(() => {
    const summaries = {} as Record<ShiftTeamKey, {
      rostered: number;
      onLeave: number;
      instructors: number;
      trainees: number;
    }>;
    for (const team of TEAM_TABS) {
      summaries[team.key] = { rostered: 0, onLeave: 0, instructors: 0, trainees: 0 };
    }
    rows.forEach((row) => {
      const s = summaries[row.team];
      if (!s) return;
      s.rostered++;
      if (Boolean(row.leave) || row.dutyCode === "LEAVE") s.onLeave++;
      if (row.instructorKeys.length > 0) s.instructors++;
      if (Boolean(row.trainee)) s.trainees++;
    });
    return summaries;
  }, [rows]);

  const activeTeamSummary = allTeamSummaries[activeTeam] || { rostered: 0, onLeave: 0, instructors: 0, trainees: 0 };

  const activeTeamStatusCounts = useMemo(() => {
    return STATUS_FILTER_OPTIONS.reduce((counts, option) => {
      counts[option.key] = activeTeamRows.filter((row) => matchesStatusFilter(row, option.key)).length;
      return counts;
    }, {} as Record<StatusFilterKey, number>);
  }, [activeTeamRows]);

  const teamCounts = useMemo(() => {
    const counts = TEAM_TABS.reduce((acc, team) => ({ ...acc, [team.key]: 0 }), {} as Record<ShiftTeamKey, number>);
    rows.forEach((row) => {
      counts[row.team] += 1;
    });
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();

    return activeTeamRows
      .filter((row) => (
        selectedStatusFilters.length === 0 || selectedStatusFilters.some((filterKey) => matchesStatusFilter(row, filterKey))
      ))
      .filter((row) => {
        if (selectedPositionFilters.length === 0) return true;

        const rowPositionKeys = getRowPositionKeys(
          row,
          includeInstructorPositionFilters,
          includeTraineePositionFilters,
        );

        return selectedPositionFilters.some((filterKey) => rowPositionKeys.includes(filterKey));
      })
      .filter((row) => {
        if (!query) return true;
        return row._searchText.includes(query);
      })
      .sort((left, right) => {
        const leftOnLeave = isRowOnLeave(left);
        const rightOnLeave = isRowOnLeave(right);
        if (leftOnLeave !== rightOnLeave) return leftOnLeave ? -1 : 1;
        return left.employeeName.localeCompare(right.employeeName) || left.employeeCode.localeCompare(right.employeeCode);
      });
  }, [
    activeTeamRows,
    includeInstructorPositionFilters,
    includeTraineePositionFilters,
    debouncedSearch,
    selectedPositionFilters,
    selectedStatusFilters,
  ]);

  const formattedDate = useMemo(() => {
    try {
      return format(parseISO(selectedDate), "EEEE, dd MMMM yyyy");
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  const selectedFilterSummary = useMemo(
    () => {
      const statusSummary = formatFilterLabelList(selectedStatusLabels.map((option) => option.label));
      const positionSummary = formatFilterLabelList(selectedPositionFilters.map((value) => formatPositionFilterLabel(value)));

      if (statusSummary && positionSummary) {
        return `${statusSummary} filtered to ${positionSummary}`;
      }

      return statusSummary || positionSummary;
    },
    [selectedPositionFilters, selectedStatusLabels],
  );

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-4 p-2.5 sm:p-4 md:space-y-6 md:p-6">
        <section className="relative overflow-hidden rounded-[22px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_26%),linear-gradient(135deg,#f8fbff_0%,#f3f7ff_45%,#f8fafc_100%)] p-4 shadow-[0_24px_80px_-42px_rgba(15,23,42,0.42)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.1),transparent_24%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.94)_50%,rgba(2,44,34,0.9)_100%)] sm:rounded-[26px] sm:p-5 md:rounded-[28px] md:p-7">
          <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3 sm:space-y-4">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-200 sm:gap-2 sm:px-3 sm:text-[11px] sm:tracking-[0.22em]">
                <Table2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                Team Details
              </div>
              <div className="space-y-1.5 sm:space-y-2">
                <h1 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-2xl md:text-3xl">Team-wise operational roster details</h1>
                <p className="max-w-3xl text-xs leading-5 text-slate-600 dark:text-slate-300 sm:text-sm sm:leading-6 md:text-[15px]">
                  View the selected day’s roster from schedule records, then enrich each employee row with rating, instructor, trainee, and active leave status.
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[420px] xl:gap-3">
              <label className="space-y-1 sm:space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.18em]">Roster Date</span>
                <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-2 py-1 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 sm:rounded-2xl sm:gap-2 sm:px-3 sm:py-2">
                  <CalendarDays className="h-3 w-3 text-slate-400 sm:h-4 sm:w-4" />
                  <Input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="h-auto border-0 bg-transparent px-0 py-0 text-xs shadow-none focus-visible:ring-0 sm:text-sm" />
                </div>
              </label>

              <label className="space-y-1 sm:space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.18em]">Search Employee</span>
                <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-2 py-1 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 sm:rounded-2xl sm:gap-2 sm:px-3 sm:py-2">
                  <Search className="h-3 w-3 text-slate-400 sm:h-4 sm:w-4" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, ID, rating, duty or unit" className="h-auto border-0 bg-transparent px-0 py-0 text-xs shadow-none placeholder:text-xs focus-visible:ring-0 sm:text-sm sm:placeholder:text-sm" />
                </div>
              </label>
            </div>
          </div>

          <div className="relative mt-4 flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 sm:mt-5 sm:gap-2">
            <Badge variant="secondary" className="rounded-full border border-white/70 bg-white/80 px-2.5 py-0.5 text-[10px] font-medium text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-200 sm:px-3 sm:py-1 sm:text-[11px]">
              {formattedDate}
            </Badge>
            <Badge variant="secondary" className="rounded-full border border-white/70 bg-white/80 px-2.5 py-0.5 text-[10px] font-medium text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-200 sm:px-3 sm:py-1 sm:text-[11px]">
              {rows.length} rostered employee{rows.length === 1 ? "" : "s"}
            </Badge>
          </div>
        </section>

        <Tabs value={activeTeam} onValueChange={(value) => setActiveTeam(value as ShiftTeamKey)} className="space-y-4 md:space-y-5">
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1.5 bg-transparent p-0 sm:flex sm:flex-wrap sm:justify-start">
            {TEAM_TABS.map((team) => (
              <TabsTrigger
                key={team.key}
                value={team.key}
                className="min-w-0 rounded-2xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium leading-tight text-slate-600 shadow-sm data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:data-[state=active]:border-white dark:data-[state=active]:bg-white dark:data-[state=active]:text-slate-950 sm:rounded-full sm:px-3 sm:py-2 sm:text-sm"
              >
                <span className="truncate">{team.label}</span>
                <span className="ml-1 rounded-full bg-black/5 px-1.5 py-0 text-[10px] data-[state=active]:bg-white/20 dark:bg-white/10 sm:ml-2 sm:px-2 sm:py-0.5 sm:text-[11px]">
                  {teamCounts[team.key]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex flex-col gap-3 rounded-[20px] border border-slate-200/80 bg-white/90 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 sm:rounded-[24px] sm:p-4">
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Quick Filters</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 sm:text-sm">Click one or more tabs to narrow the current team roster.</p>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedStatusFilters([]);
                  setSelectedPositionFilters([]);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-2xl border px-2.5 py-1.5 text-xs font-medium transition-colors sm:gap-2 sm:rounded-full sm:px-3 sm:py-2 sm:text-sm",
                  selectedStatusFilters.length === 0
                    ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white",
                )}
              >
                <span>All</span>
                <span className={cn(
                  "rounded-full px-1.5 py-0 text-[10px] sm:px-2 sm:py-0.5 sm:text-[11px]",
                  selectedStatusFilters.length === 0 ? "bg-white/20 text-white dark:bg-slate-900/10 dark:text-slate-950" : "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
                )}>
                  {activeTeamRows.length}
                </span>
              </button>

              {STATUS_FILTER_OPTIONS.map((option) => {
                const selected = selectedStatusFilters.includes(option.key);

                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => toggleStatusFilter(option.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-2xl border px-2.5 py-1.5 text-xs font-medium transition-colors sm:gap-2 sm:rounded-full sm:px-3 sm:py-2 sm:text-sm",
                      selected
                        ? "border-sky-500 bg-sky-500 text-white dark:border-sky-400 dark:bg-sky-400 dark:text-slate-950"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white",
                    )}
                  >
                    <span>{option.label}</span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0 text-[10px] sm:px-2 sm:py-0.5 sm:text-[11px]",
                      selected ? "bg-white/20 text-white dark:bg-slate-900/10 dark:text-slate-950" : "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
                    )}>
                      {activeTeamStatusCounts[option.key]}
                    </span>
                  </button>
                );
              })}
            </div>

            {showPositionFilters && positionFilterOptions.length > 0 ? (
              <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-3 dark:border-slate-800">
                <div className="flex flex-col gap-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {includeInstructorPositionFilters && includeTraineePositionFilters
                      ? "Instructor / Trainee Unit Filter"
                      : includeInstructorPositionFilters
                        ? "Instructor Unit Filter"
                        : "Trainee Unit Filter"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
                    Narrow the selected rows by unit tags like ADC, APP, ACC, OCC, or PLR.
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPositionFilters([])}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-2xl border px-2.5 py-1.5 text-xs font-medium transition-colors sm:gap-2 sm:rounded-full sm:px-3 sm:py-2 sm:text-sm",
                      selectedPositionFilters.length === 0
                        ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white",
                    )}
                  >
                    <span>All Units</span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0 text-[10px] sm:px-2 sm:py-0.5 sm:text-[11px]",
                      selectedPositionFilters.length === 0 ? "bg-white/20 text-white dark:bg-slate-900/10 dark:text-slate-950" : "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
                    )}>
                      {positionFilterRowCount}
                    </span>
                  </button>

                  {positionFilterOptions.map((option) => {
                    const selected = selectedPositionFilters.includes(option.key);

                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setSelectedPositionFilters((current) => (
                          current.includes(option.key)
                            ? current.filter((value) => value !== option.key)
                            : [...current, option.key]
                        ))}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-2xl border px-2.5 py-1.5 text-xs font-medium transition-colors sm:gap-2 sm:rounded-full sm:px-3 sm:py-2 sm:text-sm",
                          selected
                            ? "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-slate-950"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white",
                        )}
                      >
                        <span>{option.label}</span>
                        <span className={cn(
                          "rounded-full px-1.5 py-0 text-[10px] sm:px-2 sm:py-0.5 sm:text-[11px]",
                          selected ? "bg-white/20 text-white dark:bg-slate-900/10 dark:text-slate-950" : "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
                        )}>
                          {option.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {TEAM_TABS.map((team) => (
            <TabsContent key={team.key} value={team.key} className="space-y-4 md:space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                <SummaryCard label={`${team.label} Rostered`} value={allTeamSummaries[team.key]?.rostered ?? teamCounts[team.key]} detail="Employees present in schedule for the selected day" />
                <SummaryCard label="Currently On Leave" value={allTeamSummaries[team.key]?.onLeave ?? 0} detail="Approved leave overlapping the selected day" />
                <SummaryCard label="Instructor Ready" value={allTeamSummaries[team.key]?.instructors ?? 0} detail="OJTI or instructor-validity records found" />
                <SummaryCard label="Marked Trainees" value={allTeamSummaries[team.key]?.trainees ?? 0} detail="Training records with active trainee details" />
              </div>

              <Card className="rounded-[22px] border-slate-200/80 bg-white/95 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-950/80 sm:rounded-[26px]">
                <CardHeader className="flex flex-col gap-2 border-b border-slate-200/80 px-4 pb-3 pt-4 dark:border-slate-800 sm:gap-3 sm:px-6 sm:pb-4 sm:pt-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold tracking-tight text-slate-950 dark:text-white sm:text-lg">{team.label} team details</CardTitle>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
                        Filtered current-day roster with joined instructor, trainee, rating, and leave status.
                      </p>
                      {selectedStatusFilters.length > 0 || selectedPositionFilters.length > 0 ? (
                        <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50/80 px-2.5 py-1.5 text-xs text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100 sm:mt-3 sm:rounded-2xl sm:px-3 sm:py-2 sm:text-sm">
                          Showing <span className="font-semibold">{filteredRows.length}</span> result{filteredRows.length === 1 ? "" : "s"} matching {selectedFilterSummary}.
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={cn("rounded-full px-2.5 py-0.5 text-[10px] sm:px-3 sm:py-1 sm:text-xs", team.accentClass)}>{filteredRows.length} visible row{filteredRows.length === 1 ? "" : "s"}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="min-w-[920px] w-full text-[11px] sm:min-w-[1040px] sm:text-sm">
                      <thead className="bg-slate-50/80 dark:bg-slate-900/80">
                        <tr className="border-b border-slate-200 dark:border-slate-800">
                          <th className="px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.18em]">Employee</th>
                          <th className="px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.18em]">Designation</th>
                          <th className="px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.18em]">Duty</th>
                          <th className="px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.18em]">Highest Rating</th>
                          <th className="px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.18em]">Instructor</th>
                          <th className="px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.18em]">Trainee</th>
                          <th className="px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.18em]">Leave Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shiftDetailsQuery.isLoading ? (
                          Array.from({ length: 8 }).map((_, index) => (
                            <tr key={`loading-${index}`} className="border-b border-slate-100 dark:border-slate-900">
                              <td colSpan={7} className="px-3 py-3 text-xs text-slate-400 dark:text-slate-500 sm:px-4 sm:py-4 sm:text-sm">Loading roster details…</td>
                            </tr>
                          ))
                        ) : shiftDetailsQuery.isError ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-8 text-center sm:px-4 sm:py-10">
                              <div className="flex flex-col items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-rose-500" />
                                <p className="text-xs text-rose-600 dark:text-rose-400 sm:text-sm">
                                  Failed to load roster details. {shiftDetailsQuery.error instanceof Error ? shiftDetailsQuery.error.message : "Unknown error."}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => shiftDetailsQuery.refetch()}
                                  className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  Retry
                                </button>
                              </div>
                            </td>
                          </tr>
                        ) : filteredRows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400 sm:px-4 sm:py-10 sm:text-sm">
                              No employees found for {team.label} with the current search, status, and unit filters.
                            </td>
                          </tr>
                        ) : (
                          filteredRows.map((row, index) => {
                            const onLeave = isRowOnLeave(row);
                            const traineeBadgeClass = row.trainee
                              ? getTraineeStatusBadgeClass(row.trainee.status)
                              : "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800";

                            return (
                              <tr key={row.scheduleId} className={cn(
                                "border-b border-slate-100 align-top dark:border-slate-900",
                                index % 2 === 0 ? "bg-white dark:bg-slate-950/40" : "bg-slate-50/40 dark:bg-slate-900/30",
                              )}>
                                <td className="px-3 py-3 sm:px-4 sm:py-4">
                                  <div className="space-y-1">
                                    <div className="text-[13px] font-semibold text-slate-950 dark:text-white sm:text-base">{row.employeeName}</div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">{row.employeeCode}{row.station ? ` · ${row.station}` : ""}</div>
                                  </div>
                                </td>
                                <td className="px-3 py-3 sm:px-4 sm:py-4">
                                  <div className="text-[11px] text-slate-700 dark:text-slate-300 sm:text-sm">{row.designation || "—"}</div>
                                </td>
                                <td className="px-3 py-3 sm:px-4 sm:py-4">
                                  <div className="space-y-1">
                                    <Badge className={cn("rounded-full px-2 py-0.5 text-[10px] sm:px-2.5 sm:py-1 sm:text-xs", onLeave ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300")}>{row.dutyCode || "—"}</Badge>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">{row.dutyDescription || "No duty description"}</div>
                                  </div>
                                </td>
                                <td className="px-3 py-3 sm:px-4 sm:py-4">
                                  <div className="text-[11px] font-medium text-slate-800 dark:text-slate-200 sm:text-sm">{row.highestRating || "—"}</div>
                                </td>
                                <td className="px-3 py-3 sm:px-4 sm:py-4">
                                  {row.instructorKeys.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {row.instructorKeys.map((value) => (
                                        <Badge key={value} variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200 sm:px-2.5 sm:py-1 sm:text-xs">
                                          {formatPositionFilterLabel(value)}
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 sm:gap-2 sm:text-sm">
                                      <ShieldCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                      None
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-3 sm:px-4 sm:py-4">
                                  {row.trainee ? (
                                    <div className="space-y-1.5 sm:space-y-2">
                                      <Badge variant="outline" className={cn("rounded-full px-2 py-0.5 text-[10px] sm:px-2.5 sm:py-1 sm:text-xs", traineeBadgeClass)}>
                                        {getTraineeStatusLabel(row.trainee.status)}
                                      </Badge>
                                      <div className="text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">
                                        {row.trainee.unit || "Unit not set"}
                                        {typeof row.trainee.hours_required === "number" ? ` · ${row.trainee.hours_required} hrs` : ""}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 sm:gap-2 sm:text-sm">
                                      <GraduationCap className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                      Not marked
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-3 sm:px-4 sm:py-4">
                                  <div className="space-y-1.5 sm:space-y-2">
                                    <Badge className={cn("rounded-full px-2 py-0.5 text-[10px] sm:px-2.5 sm:py-1 sm:text-xs", getLeaveTone(onLeave))}>
                                      {onLeave ? `On ${row.leave?.leave_type || "Leave"}` : "Available"}
                                    </Badge>
                                    {row.leave ? (
                                      <div className="text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">
                                        {format(parseISO(row.leave.start_date), "dd MMM")} to {format(parseISO(row.leave.end_date), "dd MMM yyyy")}
                                      </div>
                                    ) : row.dutyCode === "LEAVE" ? (
                                      <div className="text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">Marked as leave in schedule</div>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}