import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CalendarIcon, Download, CheckCircle, XCircle } from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useAttendance } from "@/hooks/useAttendance";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import { useToast } from "@/hooks/use-toast";
import { useDutyRoster, useRosterAssignments } from "@/hooks/useDutyGrid";
import { useEmployeeDirectory } from "@/hooks/useEmployeeSchedules";
import { buildNameIndex, findNameMatch, isUuidLike, normalizeEmployeeMatchName } from "@/lib/nameMatching";
import {
  getDutyShiftMatches,
  getTeamDutyForDateKey,
  getTeamDutyLabel,
  normalizeTeamKey,
} from "@/lib/teamDutyRotation";

interface EmployeeAttendance {
  userId: string;
  name: string;
  empId: string;
  status: "present" | "absent";
  dutyCode: string;
  unitAssignment: string;
  canSave: boolean;
  scheduleOnly: boolean;
}

interface ScheduleAttendanceEntry {
  id: string;
  employee_code: string | null;
  employee_name: string | null;
  duty_code: string | null;
}

// Stable empty arrays to avoid new references on every render when queries are disabled
const EMPTY_ASSIGNMENTS: import("@/hooks/useDutyGrid").RosterAssignment[] = [];
const EMPTY_ROSTER_ENTRIES: Array<{ employee_name: string; unit: string; position: string; date: string; shift: string; team: string }> = [];

const EXCLUDED_ROSTER_POSITIONS = new Set(["DUTY CHANGE", "EXTRA DUTY"]);

/** Light cleanup: collapse whitespace, normalise ampersands, uppercase. */
function normalizeAttendanceLabel(value: string) {
  return value
    .toUpperCase()
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Simply deduplicate pipe-separated labels and normalise each segment.
 * The labels are already built correctly upstream (e.g. "ACC-PLR - UKN"),
 * so we do NOT decompose them — just clean up and dedupe.
 */
function formatAttendanceUnitAssignment(value?: string | null) {
  if (!value) return "";

  const parts = value
    .split("|")
    .map((p) => normalizeAttendanceLabel(p))
    .filter(Boolean);

  return Array.from(new Set(parts)).join(" | ");
}

export default function WSOAttendance() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [attendanceState, setAttendanceState] = useState<Record<string, EmployeeAttendance>>({});
  const [futureDateDialogOpen, setFutureDateDialogOpen] = useState(false);

  const { user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const { data: employeeDirectory = [], isLoading: employeeDirectoryLoading } = useEmployeeDirectory();
  const { toast } = useToast();
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const { attendance, isLoading: attendanceLoading, bulkUpsertAttendance, isBulkUpserting } = useAttendance(dateStr);

  // Team-aware duty cycle + roster-driven attendance source.
  const wsoShift = profile?.current_shift || "general";
  const wsoTeamKey = normalizeTeamKey(wsoShift);
  const teamDutyToday = getTeamDutyForDateKey(wsoTeamKey, dateStr);
  const teamDutyLabel = getTeamDutyLabel(teamDutyToday);
  const rosterShift =
    teamDutyToday === "M" ? "Morning" :
    teamDutyToday === "A" ? "AFTERNOON" :
    teamDutyToday === "N" ? "Night" :
    null;
  const rosterDateStr = format(selectedDate, "d-MMM-yyyy");

  const { data: roster } = useDutyRoster(selectedDate, rosterShift || "__OFF__", wsoTeamKey || "");
  const rosterAssignmentsQuery = useRosterAssignments(roster?.id);
  const rosterAssignments = rosterAssignmentsQuery.data ?? EMPTY_ASSIGNMENTS;

  const { data: scheduleEntries = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ["wso-attendance-schedule", dateStr],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_schedules" as any)
        .select("id, employee_code, employee_name, duty_code")
        .eq("duty_date", dateStr);

      if (error) throw error;
      return (data || []) as ScheduleAttendanceEntry[];
    },
    enabled: employeeDirectory.length > 0,
  });

  const { data: rawRosterEntries = EMPTY_ROSTER_ENTRIES, isLoading: rawRosterLoading } = useQuery({
    queryKey: ["wso-attendance-rosters", rosterDateStr, rosterShift, wsoTeamKey],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      if (!rosterShift) return [];

      const shiftVariants = Array.from(new Set([
        rosterShift,
        rosterShift.toUpperCase(),
        rosterShift.toLowerCase(),
      ]));

      const { data, error } = await supabase
        .from("rosters" as any)
        .select("employee_name, unit, position, date, shift, team")
        .eq("date", rosterDateStr)
        .eq("team", wsoTeamKey)
        .in("shift", shiftVariants);

      if (error) throw error;
      return ((data || []) as Array<{
        employee_name: string;
        unit: string;
        position: string;
        date: string;
        shift: string;
        team: string;
      }>).filter((entry) => {
        const normalizedPosition = String(entry.position || "").trim().toUpperCase();
        return !EXCLUDED_ROSTER_POSITIONS.has(normalizedPosition);
      });
    },
    enabled: !!rosterShift && employeeDirectory.length > 0,
  });

  const employeeDirectoryByName = useMemo(() => {
    return buildNameIndex(employeeDirectory, (entry) => entry.full_name);
  }, [employeeDirectory]);

  const employeeDirectoryByCode = useMemo(() => {
    const map = new Map<string, (typeof employeeDirectory)[number]>();

    employeeDirectory.forEach((entry) => {
      const code = String(entry.employee_code || "").trim().toUpperCase();
      if (!code || map.has(code)) return;
      map.set(code, entry);
    });

    return map;
  }, [employeeDirectory]);

  const rosterPositionByUserId = useMemo(() => {
    const map = new Map<string, string>();

    rosterAssignments.forEach((assignment) => {
      if (!assignment.employee_id) return;

      const positionLabel = assignment.position_label || assignment.position_name || "";
      const departmentLabel = assignment.department?.trim() || "";
      const combinedLabel = [departmentLabel, positionLabel].filter(Boolean).join(" - ");
      const finalLabel = combinedLabel || positionLabel || departmentLabel;
      if (!finalLabel) return;

      const existing = map.get(assignment.employee_id);
      if (!existing) {
        map.set(assignment.employee_id, finalLabel);
        return;
      }

      const existingParts = new Set(existing.split(" | ").map((part) => part.trim()).filter(Boolean));
      if (!existingParts.has(finalLabel)) {
        map.set(assignment.employee_id, `${existing} | ${finalLabel}`);
      }
    });

    return map;
  }, [rosterAssignments]);

  // Single-pass roster matching: matched employees, unit positions, and unmatched entries
  const rawRosterAnalysis = useMemo(() => {
    const positionByUserId = new Map<string, string>();
    const positionByEmployeeCode = new Map<string, string>();
    const positionByNormalizedName = new Map<string, string>();

    const appendPosition = (map: Map<string, string>, key: string, label: string) => {
      if (!key || !label) return;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, label);
        return;
      }

      const existingParts = new Set(existing.split(" | ").map((part) => part.trim()).filter(Boolean));
      if (!existingParts.has(label)) {
        map.set(key, `${existing} | ${label}`);
      }
    };

    rawRosterEntries.forEach((entry) => {
      const result = findNameMatch(employeeDirectoryByName, entry.employee_name);

      if (result.status !== "unique") return;

      const matchedEmployee = result.match;

      const unitLabel = entry.unit?.trim() || "";
      const rawDept = entry.position?.trim() || "";
      // Normalize raw department values from the external roster source
      // (e.g., "PLR" → "ACC-PLR", "ACC" / "ACC A" → "ACC-A")
      const normalizeDept = (raw: string): string => {
        const n = raw.toUpperCase().replace(/\s+/g, "-").trim();
        if (n.includes("ACC-PLR") || n === "PLR") return "ACC-PLR";
        if (n.includes("ACC-A") || n === "ACC") return "ACC-A";
        if (n.includes("RSR")) return "RSR";
        return raw;
      };
      const deptLabel = normalizeDept(rawDept);
      // Build as "DEPT - UNIT" so formatAttendanceUnitAssignment parses correctly
      const finalLabel = deptLabel && unitLabel
        ? `${deptLabel} - ${unitLabel}`
        : deptLabel || unitLabel;
      if (!finalLabel) return;

      if (matchedEmployee.id) {
        appendPosition(positionByUserId, matchedEmployee.id, finalLabel);
      }

      const employeeCode = String(matchedEmployee.employee_code || "").trim().toUpperCase();
      if (employeeCode) {
        appendPosition(positionByEmployeeCode, employeeCode, finalLabel);
      }

      appendPosition(
        positionByNormalizedName,
        normalizeEmployeeMatchName(matchedEmployee.full_name || entry.employee_name),
        finalLabel,
      );
    });

    return { positionByUserId, positionByEmployeeCode, positionByNormalizedName };
  }, [rawRosterEntries, employeeDirectoryByName]);

  const rawRosterPositionByUserId = rawRosterAnalysis.positionByUserId;
  const rawRosterPositionByEmployeeCode = rawRosterAnalysis.positionByEmployeeCode;
  const rawRosterPositionByNormalizedName = rawRosterAnalysis.positionByNormalizedName;

  // Attendance is schedule-driven: roster is only used to enrich unit/position.
  const shiftEmployees = useMemo(() => {
    if (!rosterShift) return [] as Array<{
      userId: string;
      employeeCode: string;
      name: string;
      dutyCode: string;
      rosterUnitAssignment: string;
      scheduleOnly: boolean;
    }>;

    const seen = new Set<string>();
    const members: Array<{
      userId: string;
      employeeCode: string;
      name: string;
      dutyCode: string;
      rosterUnitAssignment: string;
      scheduleOnly: boolean;
    }> = [];

    scheduleEntries.forEach((entry) => {
      const employeeCode = String(entry.employee_code || "").trim().toUpperCase();
      const profileByCode = employeeCode ? employeeDirectoryByCode.get(employeeCode) : null;
      const profileByName = !profileByCode
        ? (() => {
            const result = findNameMatch(employeeDirectoryByName, entry.employee_name);
            return result.status === "unique" ? result.match : null;
          })()
        : null;
      const matchedEmployee = profileByCode || profileByName;

      if (!matchedEmployee) return;
      if (!getDutyShiftMatches(entry.duty_code).includes(teamDutyToday)) return;

      const normalizedName = normalizeEmployeeMatchName(entry.employee_name || matchedEmployee.full_name || employeeCode);
      const comparisonKey = matchedEmployee.id || employeeCode || normalizedName;
      if (!comparisonKey || seen.has(comparisonKey)) return;
      seen.add(comparisonKey);

      // Merge both data sources: raw roster entries AND duty-grid assignments
      const rawLabel =
        (matchedEmployee.id ? rawRosterPositionByUserId.get(matchedEmployee.id) : "") ||
        (employeeCode ? rawRosterPositionByEmployeeCode.get(employeeCode) : "") ||
        rawRosterPositionByNormalizedName.get(normalizedName) ||
        "";
      const gridLabel = matchedEmployee.id ? rosterPositionByUserId.get(matchedEmployee.id) || "" : "";

      // Prefer raw-roster label (has separate unit+position columns); fall back to duty-grid
      const rosterUnitAssignment = formatAttendanceUnitAssignment(rawLabel || gridLabel);

      members.push({
        userId: matchedEmployee.id || employeeCode || comparisonKey,
        employeeCode: employeeCode || String(matchedEmployee.employee_code || "").trim(),
        name: matchedEmployee.full_name || entry.employee_name || employeeCode,
        dutyCode: entry.duty_code || teamDutyToday,
        rosterUnitAssignment,
        scheduleOnly: !rosterUnitAssignment,
      });
    });

    return members;
  }, [
    employeeDirectoryByCode,
    employeeDirectoryByName,
    rawRosterPositionByEmployeeCode,
    rawRosterPositionByNormalizedName,
    rawRosterPositionByUserId,
    rosterPositionByUserId,
    rosterShift,
    scheduleEntries,
    teamDutyToday,
    wsoTeamKey,
  ]);

  // Initialize attendance state from real data — canSave is evaluated fresh each time
  useEffect(() => {
    const state: Record<string, EmployeeAttendance> = {};
    shiftEmployees.forEach(emp => {
      const existing = attendance?.find(a => a.user_id === emp.userId);
      state[emp.userId] = {
        userId: emp.userId,
        name: emp.name,
        empId: emp.employeeCode,
        status: existing ? (existing.status as "present" | "absent") : "present",
        dutyCode: emp.dutyCode || "",
        unitAssignment: existing?.unit_assignment || emp.rosterUnitAssignment || "",
        canSave: isUuidLike(emp.userId),
        scheduleOnly: emp.scheduleOnly,
      };
    });
    // Bail out if state hasn't changed to prevent unnecessary re-renders
    setAttendanceState(prev => {
      const prevKeys = Object.keys(prev);
      const newKeys = Object.keys(state);
      if (prevKeys.length === newKeys.length && prevKeys.length === 0) return prev;
      if (
        prevKeys.length === newKeys.length &&
        newKeys.every(k => {
          const p = prev[k], n = state[k];
          return p && n &&
            p.userId === n.userId && p.status === n.status &&
            p.dutyCode === n.dutyCode && p.unitAssignment === n.unitAssignment &&
            p.canSave === n.canSave && p.name === n.name &&
            p.scheduleOnly === n.scheduleOnly;
        })
      ) return prev;
      return state;
    });
  }, [shiftEmployees, attendance]);

  const allEmployees = Object.values(attendanceState);
  const orderedEmployees = useMemo(() => {
    return [...allEmployees].sort((left, right) => {
      if (left.scheduleOnly !== right.scheduleOnly) {
        return left.scheduleOnly ? 1 : -1;
      }
      return left.name.localeCompare(right.name);
    });
  }, [allEmployees]);
  const savableEmployees = allEmployees.filter((employee) => employee.canSave);
  const unsavableEmployees = allEmployees.filter((employee) => !employee.canSave);
  const blankUnitCount = allEmployees.filter((employee) => !employee.unitAssignment.trim()).length;
  const stats = {
    present: allEmployees.filter((e) => e.status === "present").length,
    absent: allEmployees.filter((e) => e.status === "absent").length,
    total: allEmployees.length,
  };

  const toggleStatus = (empId: string) => {
    setAttendanceState((prev) => ({
      ...prev,
      [empId]: {
        ...prev[empId],
        status: prev[empId]?.status === "present" ? "absent" : "present",
      },
    }));
  };

  const handleSave = () => {
    const dayOffsetFromToday = differenceInCalendarDays(selectedDate, new Date());
    if (dayOffsetFromToday > 0) {
      setFutureDateDialogOpen(true);
      return;
    }

    if (dayOffsetFromToday < -1) {
      toast({
        title: "Attendance window closed",
        description: "Attendance can only be saved for today or yesterday.",
        variant: "destructive",
      });
      return;
    }

    const employeesWithBlankUnits = savableEmployees.filter((employee) => !employee.unitAssignment.trim());
    if (employeesWithBlankUnits.length > 0) {
      toast({
        title: "Unit is mandatory",
        description: `Add a unit / position for all employees before saving. ${employeesWithBlankUnits.length} row(s) are still blank.`,
        variant: "destructive",
      });
      return;
    }

    const dutyRecords = savableEmployees.map((r) => ({
      user_id: r.userId,
      attendance_date: dateStr,
      status: r.status as "present" | "absent",
      comments: r.dutyCode || null,
      unit_assignment: r.unitAssignment || null,
      marked_by: "",
      time_in: null,
      time_out: null,
    }));

    const records = dutyRecords;
    if (unsavableEmployees.length > 0) {
      toast({
        title: "Some rows were not saved",
        description: `${unsavableEmployees.length} employees are shown by schedule/name match only and do not yet have a valid linked user ID.`,
        variant: "destructive",
      });
    }
    if (records.length > 0) {
      bulkUpsertAttendance(records as any);
    }
  };

  const handleExport = () => {
    if (allEmployees.length === 0) {
      toast({
        title: "No attendance data",
        description: "There are no attendance rows available to export for the selected date.",
        variant: "destructive",
      });
      return;
    }

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;

    // ── Title ──────────────────────────────────────────────────────────────
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("Shift Attendance", pageWidth / 2, 20, { align: "center" });

    // ── Meta line ──────────────────────────────────────────────────────────
    const displayDate = format(selectedDate, "dd MMM yyyy");
    const displayShift = rosterShift || teamDutyLabel || "—";
    const displayTeam = wsoTeamKey ? `Team ${wsoTeamKey.toUpperCase()}` : "—";
    const totalText = `Total Employees: ${allEmployees.length}`;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${displayDate}`, margin, 30);
    doc.text(`Team: ${displayTeam}`, pageWidth / 2 - 20, 30);
    doc.text(`Shift: ${displayShift}`, margin, 36);
    doc.text(totalText, pageWidth / 2 - 20, 36);

    // ── Divider ────────────────────────────────────────────────────────────
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.4);
    doc.line(margin, 40, pageWidth - margin, 40);

    // ── Table ──────────────────────────────────────────────────────────────
    const tableRows = allEmployees.map((emp, idx) => [
      String(idx + 1),
      emp.empId || "—",
      emp.name || "",
      emp.dutyCode || "",
      emp.unitAssignment || "",
      emp.status === "present" ? "Present" : emp.status === "absent" ? "Absent" : "Not Marked",
    ]);

    autoTable(doc, {
      startY: 44,
      head: [["#", "Emp ID", "Employee Name", "Duty Code", "Unit / Position", "Status"]],
      body: tableRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8.5, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold", halign: "center" },
      columnStyles: {
        0: { halign: "center", cellWidth: 8 },
        1: { cellWidth: 20 },
        2: { cellWidth: 55 },
        3: { cellWidth: 22, halign: "center" },
        4: { cellWidth: 45 },
        5: { cellWidth: 25, halign: "center" },
      },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 5) {
          const val = String(data.cell.raw ?? "");
          if (val === "Present") doc.setTextColor(22, 163, 74);
          else if (val === "Absent") doc.setTextColor(220, 38, 38);
          else doc.setTextColor(107, 114, 128);
        }
      },
    });

    // ── Footer ─────────────────────────────────────────────────────────────
    const pageCount = (doc.internal as unknown as { getNumberOfPages(): number }).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(150);
      doc.text(
        `Page ${i} of ${pageCount}  ·  Generated ${format(new Date(), "dd MMM yyyy HH:mm")}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 8,
        { align: "center" },
      );
    }

    doc.save(`shift-attendance-${displayTeam.replace(/\s+/g, "-").toLowerCase()}-${dateStr}.pdf`);

    toast({
      title: "Attendance exported",
      description: "PDF saved with date, team, shift and full employee list.",
    });
  };

  const isLoading = employeeDirectoryLoading || attendanceLoading || rawRosterLoading || scheduleLoading;

  const renderEmployeeRow = (emp: EmployeeAttendance) => (
    <div key={emp.userId} className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div>
          <p className="font-medium">{emp.name}</p>
          <p className="text-xs text-muted-foreground">{emp.empId}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="inline-flex w-fit text-xs font-semibold px-2 py-1 rounded bg-muted">{emp.dutyCode || "—"}</span>
        {emp.scheduleOnly ? (
          <span className="inline-flex w-fit text-xs font-semibold px-2 py-1 rounded bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
            Schedule only
          </span>
        ) : null}
        {!emp.canSave ? (
          <span className="inline-flex w-fit text-xs font-semibold px-2 py-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Name matched only
          </span>
        ) : null}
        <Input
          value={emp.unitAssignment}
          onChange={e => setAttendanceState(prev => ({ ...prev, [emp.userId]: { ...prev[emp.userId], unitAssignment: e.target.value } }))}
          placeholder="Unit / position"
          className="w-full sm:w-56"
          required
        />
        <Button
          variant={emp.status === "present" ? "default" : "outline"}
          size="sm"
          onClick={() => toggleStatus(emp.userId)}
          className={cn(
            "w-full sm:w-auto",
            emp.status === "present" && "bg-green-600 hover:bg-green-700 text-white",
            emp.status === "absent" && "bg-red-600 hover:bg-red-700 text-white"
          )}
        >
          {emp.status === "present" ? "Present" : "Absent"}
        </Button>
      </div>
    </div>
  );

  return (
    <DashboardLayout role="wso">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Attendance Marking</h1>
            <p className="text-muted-foreground">
              Mark attendance for Team {wsoTeamKey} ({teamDutyLabel} duty)
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full justify-start text-left font-normal sm:w-auto")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(selectedDate, "PPP")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={selectedDate} onSelect={(date) => date && setSelectedDate(date)} initialFocus />
              </PopoverContent>
            </Popover>
            <Button className="w-full sm:w-auto" onClick={handleExport} disabled={allEmployees.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Present</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.present}</div>
              <p className="text-xs text-muted-foreground">out of {stats.total} employees</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Absent</CardTitle>
              <XCircle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.absent}</div>
              <p className="text-xs text-muted-foreground">employees marked absent</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Attendance Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0}%</div>
              <p className="text-xs text-muted-foreground">current shift attendance</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <CardTitle>Mark Attendance - Team {wsoTeamKey} ({teamDutyLabel})</CardTitle>
                  <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    Blank unit position: {blankUnitCount}
                  </span>
                  <span className="inline-flex w-fit items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    Unit required
                  </span>
                </div>
              <Button className="w-full sm:w-auto" onClick={handleSave} disabled={isBulkUpserting || allEmployees.length === 0}>
                {isBulkUpserting ? "Saving..." : "Save Attendance"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : allEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No employees found from schedule or roster for this shift
              </p>
            ) : (
              <div className="space-y-4">
                {orderedEmployees.map(renderEmployeeRow)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={futureDateDialogOpen} onOpenChange={setFutureDateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wait For The Attendance Day</AlertDialogTitle>
            <AlertDialogDescription>
              Attendance can only be saved for today or yesterday. The selected date is in the future, so please wait until that duty day arrives before marking attendance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Understood</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
