import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight, FileDown, Filter, Loader2, Pencil, RefreshCcw, Search, X } from "lucide-react";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DUTY_CODES } from "@/hooks/useEmployeeSchedules";
import { useIsMobile } from "@/hooks/use-mobile";
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import { logSupervisorEdit } from "@/lib/supervisorAuditLog";
import { useUsers } from "@/hooks/useUsers";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AttendanceRow {
  userId: string;
  code: string;
  name: string;
  team: string;
}

interface AttendanceEntry {
  id: string;
  user_id: string;
  attendance_date: string;
  comments: string | null;
  status: "present" | "absent" | "late" | "on_leave";
}

interface GridScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  trackWidth: number;
}

const DEFAULT_TEAMS = ["A", "B", "C", "D", "E", "G"];
const ROW_H = "h-[44px]";
const ROW_PX = 44;
const DATE_COL_PX = 112;
const ROW_OVERSCAN = 10;
const EDITABLE_ATTENDANCE_CODES = [...DUTY_CODES, "OFF", "ABS", "LATE"] as const;

const normalizeTeam = (value: string | null | undefined) => {
  const normalized = (value || "").trim().toUpperCase();
  if (!normalized || normalized === "GENERAL") return "G";
  return normalized;
};

const hasAssignedShift = (value: string | null | undefined) => {
  return Boolean((value || "").trim());
};

const generateDates = (year: number, month: number) => {
  const dates = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    dates.push({
      label: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      key: format(date, "yyyy-MM-dd"),
      dayOfWeek: date.toLocaleDateString("en-US", { weekday: "short" }),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
    });
  }
  return dates;
};

const resolveAttendanceCode = (entry?: AttendanceEntry) => {
  if (!entry) return "";
  const code = String(entry.comments || "").trim().toUpperCase();
  if (code) return code;
  if (entry.status === "on_leave") return "OFF";
  if (entry.status === "absent") return "ABS";
  if (entry.status === "late") return "LATE";
  return "P";
};

const getAttendanceColor = (code: string) => {
  switch (code?.toUpperCase()) {
    case "G": return "bg-teal-50 text-teal-800 border-teal-300";
    case "M": return "bg-sky-50 text-sky-800 border-sky-300";
    case "A": return "bg-orange-50 text-orange-800 border-orange-300";
    case "N": return "bg-violet-50 text-violet-800 border-violet-300";
    case "NO": return "bg-fuchsia-50 text-fuchsia-800 border-fuchsia-300";
    case "CO": return "bg-purple-50 text-purple-800 border-purple-300";
    case "LEAVE":
    case "ABS": return "bg-red-50 text-red-800 border-red-300";
    case "SAT":
    case "SUN": return "bg-slate-100 text-slate-700 border-slate-300";
    case "GO": return "bg-lime-50 text-lime-800 border-lime-300";
    case "CH":
    case "NH": return "bg-cyan-50 text-cyan-800 border-cyan-300";
    case "NA": return "bg-gray-100 text-gray-700 border-gray-300";
    case "A+M":
    case "M+A": return "bg-amber-50 text-amber-800 border-amber-300";
    case "NO+N":
    case "N+NO": return "bg-indigo-50 text-indigo-800 border-indigo-300";
    case "SL":
    case "TR": return "bg-rose-50 text-rose-800 border-rose-300";
    case "SAT+NO":
    case "SAT+N":
    case "SUN+N":
    case "SUN+M":
    case "SUN+A":
    case "SUN+NO": return "bg-slate-100 text-slate-600 border-slate-300";
    case "CO+N":
    case "CO+A":
    case "CO+M": return "bg-purple-50 text-purple-700 border-purple-300";
    case "OFF": return "bg-slate-100 text-slate-700 border-slate-300";
    case "LATE": return "bg-yellow-50 text-yellow-800 border-yellow-300";
    case "P": return "bg-emerald-50 text-emerald-800 border-emerald-300";
    default: return "bg-neutral-50 text-neutral-700 border-neutral-300";
  }
};

function AttendanceCell({ code, isWeekend }: { code: string; isWeekend: boolean }) {
  return (
    <div className={`w-28 flex-shrink-0 px-1 flex items-center justify-center border-r border-gray-200 ${isWeekend ? "bg-muted/20" : ""}`}>
      {code ? (
        <div className={`w-full h-8 text-[11px] font-semibold border-[1.5px] rounded-md px-1 flex items-center justify-center shadow-sm ${getAttendanceColor(code)}`}>
          {code}
        </div>
      ) : (
        <div className="w-full h-8 text-[11px] font-semibold border rounded-md px-1 flex items-center justify-center text-muted-foreground bg-background">
          —
        </div>
      )}
    </div>
  );
}

function EditableAttendanceCell({
  code,
  isWeekend,
  isSaving,
  onCodeChange,
}: {
  code: string;
  isWeekend: boolean;
  isSaving: boolean;
  onCodeChange: (nextCode: string) => void;
}) {
  return (
    <div className={`w-28 flex-shrink-0 px-1 flex items-center justify-center border-r border-gray-200 ${isWeekend ? "bg-muted/20" : ""}`}>
      <select
        value={code}
        disabled={isSaving}
        onChange={(event) => onCodeChange(event.target.value)}
        className={`w-full h-8 text-[11px] font-semibold border-[1.5px] rounded-md px-1 outline-none focus:ring-2 focus:ring-ring focus:border-input shadow-sm appearance-none cursor-pointer ${getAttendanceColor(code)} hover:opacity-90 transition-all text-center ${isSaving ? "opacity-60 cursor-wait" : ""}`}
      >
        <option value="" className="text-gray-900 bg-white">—</option>
        {EDITABLE_ATTENDANCE_CODES.map((attendanceCode) => (
          <option key={attendanceCode} value={attendanceCode} className="text-gray-900 bg-white">
            {attendanceCode}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function SupervisorAttendanceView() {
  const now = new Date();
  const isMobile = useIsMobile();
  const mobileScale = 0.72;
  const empIdWidth = isMobile ? 92 : 128;
  const teamWidth = isMobile ? 40 : 64;
  const nameWidth = isMobile ? 180 : 208;
  const leftPanelWidth = empIdWidth + teamWidth + nameWidth;
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"name" | "empId" | "team">("name");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const [gridScrollMetrics, setGridScrollMetrics] = useState<GridScrollMetrics>({
    scrollLeft: 0,
    scrollWidth: 1,
    clientWidth: 1,
    trackWidth: 0,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { users = [], isLoading: usersLoading } = useUsers();

  const dates = useMemo(() => generateDates(currentYear, currentMonth), [currentYear, currentMonth]);
  const startDate = dates[0]?.key;
  const endDate = dates[dates.length - 1]?.key;
  const gridWidth = dates.length * DATE_COL_PX;

  const namesRef = useRef<HTMLDivElement>(null);
  const dateHeaderRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const horizontalTrackRef = useRef<HTMLDivElement>(null);
  const horizontalSyncingRef = useRef(false);

  const { data: attendanceEntries = [], isLoading: attendanceLoading } = useQuery({
    queryKey: ["supervisor-attendance-view", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("id, user_id, attendance_date, comments, status")
        .gte("attendance_date", startDate)
        .lte("attendance_date", endDate)
        .order("attendance_date")
        .order("id");
      if (error) throw error;
      return (data || []) as AttendanceEntry[];
    },
    enabled: !!startDate && !!endDate,
    staleTime: 60 * 1000,
    gcTime: 3 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const activeEmployees = useMemo(() => {
    return users.filter(
      (user) =>
        !user.is_hidden &&
        Boolean(user.employee_id) &&
        hasAssignedShift(user.current_shift) &&
        user.role !== "admin"
    );
  }, [users]);

  const attendanceMap = useMemo(() => {
    const map = new Map<string, string>();
    attendanceEntries.forEach((entry) => {
      map.set(`${entry.user_id}|${entry.attendance_date}`, resolveAttendanceCode(entry));
    });
    return map;
  }, [attendanceEntries]);

  const attendanceEntryMap = useMemo(() => {
    const map = new Map<string, AttendanceEntry>();
    attendanceEntries.forEach((entry) => {
      map.set(`${entry.user_id}|${entry.attendance_date}`, entry);
    });
    return map;
  }, [attendanceEntries]);

  const employeeRows = useMemo<AttendanceRow[]>(() => {
    return activeEmployees.map((user) => ({
      userId: user.id,
      code: String(user.employee_id || "").trim().toUpperCase(),
      name: user.full_name || user.employee_id || user.id,
      team: normalizeTeam(user.current_shift),
    }));
  }, [activeEmployees]);

  const teamOptions = useMemo(() => {
    const discovered = new Set(employeeRows.map((row) => row.team).filter((team) => team && team !== "—"));
    const merged = new Set<string>([...DEFAULT_TEAMS, ...Array.from(discovered)]);
    return Array.from(merged).sort((left, right) => left.localeCompare(right));
  }, [employeeRows]);

  useEffect(() => {
    setSelectedTeams((prev) => {
      if (teamOptions.length === 0) return [];
      if (prev.length === 0) return teamOptions;
      const filtered = prev.filter((team) => teamOptions.includes(team));
      return filtered.length > 0 ? filtered : teamOptions;
    });
  }, [teamOptions]);

  const filteredEmployees = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return employeeRows
      .filter((employee) => {
        const matchesSearch = !query || employee.name.toLowerCase().includes(query) || employee.code.toLowerCase().includes(query);
        const matchesTeam = selectedTeams.includes(employee.team);
        return matchesSearch && matchesTeam;
      })
      .sort((left, right) => {
        switch (sortBy) {
          case "name":
            return left.name.localeCompare(right.name);
          case "empId":
            return left.code.localeCompare(right.code);
          case "team":
            return left.team.localeCompare(right.team);
          default:
            return 0;
        }
      });
  }, [employeeRows, searchQuery, selectedTeams, sortBy]);

  const navigateMonth = (direction: "prev" | "next") => {
    let nextMonth = currentMonth;
    let nextYear = currentYear;
    if (direction === "prev") {
      nextMonth -= 1;
      if (nextMonth < 0) {
        nextMonth = 11;
        nextYear -= 1;
      }
    } else {
      nextMonth += 1;
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear += 1;
      }
    }
    setCurrentMonth(nextMonth);
    setCurrentYear(nextYear);
  };

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["supervisor-attendance-view"] }),
      ]);
      toast({
        title: "Attendance reloaded",
        description: "Latest attendance records have been loaded from the database.",
      });
    } catch (error: any) {
      toast({
        title: "Refresh failed",
        description: error?.message || "Unable to refresh attendance records.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, toast]);

  const monthLabel = new Date(currentYear, currentMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const handleExportPdf = useCallback(async () => {
    setIsExporting(true);
    try {
      const { default: jsPDF } = await import("jspdf");

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 10;
      const headerHeight = 8;
      const rowHeight = 7;
      const employeeIdWidth = 28;
      const teamWidth = 16;
      const nameWidth = 46;
      const fixedWidth = employeeIdWidth + teamWidth + nameWidth;
      const availableDateWidth = pageWidth - margin * 2 - fixedWidth;
      const dateColumnWidth = 14;
      const datesPerPage = Math.max(1, Math.floor(availableDateWidth / dateColumnWidth));
      const dateChunks = [] as typeof dates[];

      for (let index = 0; index < dates.length; index += datesPerPage) {
        dateChunks.push(dates.slice(index, index + datesPerPage));
      }

      const drawPage = (dateChunk: typeof dates, chunkIndex: number) => {
        if (chunkIndex > 0) {
          doc.addPage();
        }

        doc.setFontSize(15);
        doc.text("Attendance Report", margin, 12);
        doc.setFontSize(9);
        doc.text(
          `Month: ${monthLabel} | Teams: ${selectedTeams.join(", ")} | Employees: ${filteredEmployees.length}`,
          margin,
          18
        );
        doc.text("Source: Live attendance records fetched from backend", margin, 23);

        let currentY = 30;

        const drawTableHeader = () => {
          doc.setFontSize(8);
          doc.setFillColor(241, 245, 249);
          doc.rect(margin, currentY, pageWidth - margin * 2, headerHeight, "F");
          doc.text("Emp ID", margin + 2, currentY + 5);
          doc.text("Team", margin + employeeIdWidth + 2, currentY + 5);
          doc.text("Name", margin + employeeIdWidth + teamWidth + 2, currentY + 5);

          dateChunk.forEach((date, dateIndex) => {
            const x = margin + fixedWidth + dateIndex * dateColumnWidth;
            doc.text(date.label, x + 1, currentY + 3.5);
            doc.text(date.dayOfWeek, x + 2, currentY + 6.5);
          });

          currentY += headerHeight;
        };

        drawTableHeader();

        filteredEmployees.forEach((employee, employeeIndex) => {
          if (currentY + rowHeight > pageHeight - margin) {
            doc.addPage();
            currentY = 12;
            doc.setFontSize(10);
            doc.text(`Attendance Report (${monthLabel})`, margin, currentY);
            currentY += 6;
            drawTableHeader();
          }

          if (employeeIndex % 2 === 0) {
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, currentY, pageWidth - margin * 2, rowHeight, "F");
          }

          doc.setFontSize(8);
          doc.text(employee.code.slice(0, 18), margin + 2, currentY + 4.5);
          doc.text(employee.team, margin + employeeIdWidth + 4, currentY + 4.5);
          doc.text(employee.name.slice(0, 28), margin + employeeIdWidth + teamWidth + 2, currentY + 4.5);

          dateChunk.forEach((date, dateIndex) => {
            const x = margin + fixedWidth + dateIndex * dateColumnWidth;
            const code = attendanceMap.get(`${employee.userId}|${date.key}`) || "-";
            doc.text(code, x + 4, currentY + 4.5);
          });

          currentY += rowHeight;
        });

        doc.setDrawColor(203, 213, 225);
        let x = margin;
        doc.line(x, 30, x, currentY);
        x += employeeIdWidth;
        doc.line(x, 30, x, currentY);
        x += teamWidth;
        doc.line(x, 30, x, currentY);
        x += nameWidth;
        doc.line(x, 30, x, currentY);

        dateChunk.forEach((_, dateIndex) => {
          const lineX = margin + fixedWidth + dateIndex * dateColumnWidth;
          doc.line(lineX, 30, lineX, currentY);
        });

        doc.line(pageWidth - margin, 30, pageWidth - margin, currentY);
      };

      dateChunks.forEach((dateChunk, chunkIndex) => drawPage(dateChunk, chunkIndex));

      doc.save(`attendance_${currentYear}-${String(currentMonth + 1).padStart(2, "0")}.pdf`);
      toast({
        title: "PDF exported",
        description: "Attendance grid has been exported as PDF.",
      });
    } catch (error: any) {
      toast({
        title: "PDF export failed",
        description: error?.message || "Unable to export attendance as PDF.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }, [attendanceMap, currentMonth, currentYear, dates, filteredEmployees, monthLabel, selectedTeams, toast]);

  const updateAttendanceMutation = useMutation({
    mutationFn: async ({ userId, dateKey, nextCode }: { userId: string; dateKey: string; nextCode: string }) => {
      const normalizedCode = nextCode.trim().toUpperCase();
      const existingEntry = attendanceEntryMap.get(`${userId}|${dateKey}`);

      if (!normalizedCode) {
        if (!existingEntry) return;

        const { error } = await supabase
          .from("attendance")
          .delete()
          .eq("user_id", userId)
          .eq("attendance_date", dateKey);

        if (error) throw error;
        return;
      }

      const user = await supabase.auth.getUser();
      const markedBy = user.data.user?.id;
      if (!markedBy) {
        throw new Error("Unable to identify the current user for attendance editing.");
      }

      const status = normalizedCode === "ABS"
        ? "absent"
        : normalizedCode === "LATE"
          ? "late"
          : normalizedCode === "OFF"
            ? "on_leave"
            : "present";

      const { error } = await supabase
        .from("attendance")
        .upsert(
          {
            user_id: userId,
            attendance_date: dateKey,
            status,
            comments: normalizedCode,
            marked_by: markedBy,
            time_in: status === "present" || status === "late" ? existingEntry?.time_in || null : null,
            time_out: status === "present" || status === "late" ? existingEntry?.time_out || null : null,
          },
          { onConflict: "user_id,attendance_date" }
        );

      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["supervisor-attendance-view"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast({
        title: "Attendance updated",
        description: "Attendance changes have been saved to the backend.",
      });
      logSupervisorEdit({
        action: variables.nextCode ? "upsert" : "delete",
        table: "attendance",
        description: variables.nextCode
          ? `Marked attendance ${variables.nextCode} for user ${variables.userId} on ${variables.dateKey}`
          : `Deleted attendance for user ${variables.userId} on ${variables.dateKey}`,
        recordId: `${variables.userId}|${variables.dateKey}`,
        after: variables.nextCode ? { status: variables.nextCode } : undefined,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Attendance update failed",
        description: error?.message || "Unable to update attendance.",
        variant: "destructive",
      });
    },
  });

  const handleAttendanceChange = useCallback(async (userId: string, dateKey: string, nextCode: string) => {
    const key = `${userId}|${dateKey}`;
    setSavingCellKey(key);
    try {
      await updateAttendanceMutation.mutateAsync({ userId, dateKey, nextCode });
    } finally {
      setSavingCellKey((current) => (current === key ? null : current));
    }
  }, [updateAttendanceMutation]);

  const toggleTeam = (team: string) => {
    setSelectedTeams((prev) => (prev.includes(team) ? prev.filter((value) => value !== team) : [...prev, team]));
  };

  const toggleAllTeams = () => {
    setSelectedTeams((prev) => (prev.length === teamOptions.length ? [] : [...teamOptions]));
  };

  const isLoading = usersLoading || attendanceLoading;

  const updateGridScrollMetrics = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    setGridScrollMetrics({
      scrollLeft: grid.scrollLeft,
      scrollWidth: grid.scrollWidth,
      clientWidth: grid.clientWidth,
      trackWidth: horizontalTrackRef.current?.clientWidth || 0,
    });
  }, []);

  const setGridHorizontalScroll = useCallback((nextScrollLeft: number) => {
    const grid = gridRef.current;
    if (!grid) return;
    const maxScroll = Math.max(0, grid.scrollWidth - grid.clientWidth);
    const clampedScrollLeft = Math.max(0, Math.min(nextScrollLeft, maxScroll));

    horizontalSyncingRef.current = true;
    grid.scrollLeft = clampedScrollLeft;
    if (dateHeaderRef.current) {
      dateHeaderRef.current.scrollLeft = clampedScrollLeft;
    }

    requestAnimationFrame(() => {
      horizontalSyncingRef.current = false;
      updateGridScrollMetrics();
    });
  }, [updateGridScrollMetrics]);

  const onGridScroll = useCallback(() => {
    if (namesRef.current && gridRef.current) {
      namesRef.current.scrollTop = gridRef.current.scrollTop;
    }

    if (!horizontalSyncingRef.current && dateHeaderRef.current && gridRef.current) {
      horizontalSyncingRef.current = true;
      dateHeaderRef.current.scrollLeft = gridRef.current.scrollLeft;

      requestAnimationFrame(() => {
        horizontalSyncingRef.current = false;
      });
    }

    updateGridScrollMetrics();
  }, [updateGridScrollMetrics]);

  const onDateHeaderScroll = useCallback(() => {
    if (horizontalSyncingRef.current || !dateHeaderRef.current || !gridRef.current) {
      return;
    }

    horizontalSyncingRef.current = true;
    gridRef.current.scrollLeft = dateHeaderRef.current.scrollLeft;

    requestAnimationFrame(() => {
      horizontalSyncingRef.current = false;
      updateGridScrollMetrics();
    });
  }, [updateGridScrollMetrics]);

  const rowVirtualizer = useVirtualizer({
    count: filteredEmployees.length,
    getScrollElement: () => gridRef.current,
    estimateSize: () => ROW_PX,
    overscan: ROW_OVERSCAN,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();

  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = 0;
    if (namesRef.current) namesRef.current.scrollTop = 0;
    rowVirtualizer.scrollToIndex(0);
  }, [currentMonth, currentYear, searchQuery, selectedTeams, sortBy, rowVirtualizer]);

  useEffect(() => {
    updateGridScrollMetrics();
  }, [filteredEmployees.length, dates.length, isLoading, updateGridScrollMetrics]);

  useEffect(() => {
    const handleResize = () => updateGridScrollMetrics();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateGridScrollMetrics]);

  const horizontalMaxScroll = Math.max(0, gridScrollMetrics.scrollWidth - gridScrollMetrics.clientWidth);
  const rawThumbWidth = horizontalMaxScroll <= 0 || gridScrollMetrics.trackWidth <= 0
    ? gridScrollMetrics.trackWidth
    : (gridScrollMetrics.clientWidth / gridScrollMetrics.scrollWidth) * gridScrollMetrics.trackWidth;
  const minThumbWidth = isMobile ? 56 : 92;
  const thumbWidth = gridScrollMetrics.trackWidth > 0 ? Math.min(gridScrollMetrics.trackWidth, Math.max(minThumbWidth, rawThumbWidth)) : 0;
  const thumbTravel = Math.max(0, gridScrollMetrics.trackWidth - thumbWidth);
  const thumbLeft = horizontalMaxScroll > 0 && thumbTravel > 0 ? (gridScrollMetrics.scrollLeft / horizontalMaxScroll) * thumbTravel : 0;

  const handleHorizontalTrackMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || horizontalMaxScroll <= 0) return;
    const track = horizontalTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const nextThumbLeft = Math.max(0, Math.min(clickX - thumbWidth / 2, thumbTravel));
    const nextScrollLeft = thumbTravel > 0 ? (nextThumbLeft / thumbTravel) * horizontalMaxScroll : 0;
    setGridHorizontalScroll(nextScrollLeft);
  }, [horizontalMaxScroll, setGridHorizontalScroll, thumbTravel, thumbWidth]);

  const handleHorizontalThumbMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (horizontalMaxScroll <= 0 || thumbTravel <= 0) return;

    const startX = event.clientX;
    const startScrollLeft = gridRef.current?.scrollLeft || 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaScroll = (deltaX / thumbTravel) * horizontalMaxScroll;
      setGridHorizontalScroll(startScrollLeft + deltaScroll);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [horizontalMaxScroll, setGridHorizontalScroll, thumbTravel]);

  return (
    <DashboardLayout role="supervisor">
      <div
        className="flex flex-col -m-4 md:-m-6"
        style={{
          height: isMobile ? `calc((100vh - 64px) / ${mobileScale})` : "calc(100vh - 64px)",
          zoom: isMobile ? mobileScale : undefined,
        }}
      >
        <div className="bg-background border-b px-4 md:px-6 py-3 shadow-sm flex-shrink-0">
          <div className="mb-3">
            <h1 className="text-2xl font-bold text-foreground">View Attendance</h1>
            <p className="text-sm text-muted-foreground">
              Review employee-wise attendance duty codes by date and filter the grid by team code. Data is fetched live from the backend attendance table.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[220px] max-w-sm relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by name or employee ID..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-10 pr-8 h-9"
              />
              {searchQuery && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Filter className="h-4 w-4" />
                  Team Code Filter
                  {selectedTeams.length < teamOptions.length && (
                    <span className="ml-1 px-1.5 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                      {selectedTeams.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56" align="start">
                <div className="space-y-3">
                  <div className="font-semibold text-sm">Filter by Team Code</div>
                  <div className="flex items-center space-x-2 pb-2 border-b">
                    <Checkbox id="av-all" checked={selectedTeams.length === teamOptions.length} onCheckedChange={toggleAllTeams} />
                    <label htmlFor="av-all" className="text-sm font-medium cursor-pointer">Select All</label>
                  </div>
                  {teamOptions.map((team) => (
                    <div key={team} className="flex items-center space-x-2">
                      <Checkbox id={`av-t-${team}`} checked={selectedTeams.includes(team)} onCheckedChange={() => toggleTeam(team)} />
                      <label htmlFor={`av-t-${team}`} className="text-sm font-medium cursor-pointer">Code {team}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Sort by:</span>
              <Select value={sortBy} onValueChange={(value: "name" | "empId" | "team") => setSortBy(value)}>
                <SelectTrigger className="w-[130px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="empId">Employee ID</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing} className="gap-2">
              <RefreshCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={isExporting || filteredEmployees.length === 0} className="gap-2">
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              Export PDF
            </Button>

            <Button variant={isEditing ? "default" : "outline"} size="sm" onClick={() => setIsEditing((prev) => !prev)} className="gap-2">
              {updateAttendanceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              {isEditing ? "Done Editing" : "Edit Attendance"}
            </Button>
          </div>

          {(searchQuery || selectedTeams.length < teamOptions.length) && (
            <p className="text-xs text-muted-foreground mt-2">
              Showing {filteredEmployees.length} of {employeeRows.length} employees
            </p>
          )}
        </div>

        <div className="bg-background border-b px-4 md:px-6 py-2 flex items-center justify-between flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => navigateMonth("prev")} className="gap-1">
            <ChevronLeft className="h-4 w-4" /> Previous Month
          </Button>
          <h2 className="text-base font-semibold">{monthLabel}</h2>
          <Button variant="outline" size="sm" onClick={() => navigateMonth("next")} className="gap-1">
            Next Month <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex-1 p-6 space-y-3 overflow-hidden">
            {[...Array(10)].map((_, index) => <Skeleton key={index} className="h-11 w-full" />)}
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 flex overflow-hidden min-h-0">
              <div className="flex-shrink-0 flex flex-col border-r-2 border-gray-400 shadow-[3px_0_8px_rgba(0,0,0,0.08)] z-10 bg-background">
                <div className={`flex ${ROW_H} border-b-2 border-gray-400 bg-muted/60 flex-shrink-0`}>
                  <div style={{ width: empIdWidth }} className="px-2 flex items-center justify-center border-r border-gray-300 shrink-0">
                    <span className="font-semibold text-xs truncate">{isMobile ? "Emp ID" : "Employee ID"}</span>
                  </div>
                  <div style={{ width: teamWidth }} className="px-1 flex items-center justify-center border-r border-gray-300 shrink-0">
                    <span className="font-semibold text-xs">{isMobile ? "Tm" : "Team"}</span>
                  </div>
                  <div style={{ width: nameWidth }} className="px-2 flex items-center shrink-0">
                    <span className="font-semibold text-xs truncate">{isMobile ? "Name" : "Employee Name"}</span>
                  </div>
                </div>

                <div ref={namesRef} className="flex-1 overflow-hidden" style={{ overflowY: "hidden" }}>
                  {filteredEmployees.length === 0 ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                      No employees found
                    </div>
                  ) : (
                    <div className="relative" style={{ height: totalHeight }}>
                      {virtualRows.map((virtualRow) => {
                        const employee = filteredEmployees[virtualRow.index];
                        const rowIndex = virtualRow.index;
                        return (
                          <div
                            key={employee.userId}
                            className={`flex ${ROW_H} border-b border-gray-200 dark:border-slate-700 transition-colors ${rowIndex % 2 === 0 ? "bg-white dark:bg-slate-900/55" : "bg-slate-50/70 dark:bg-slate-800/55"} hover:bg-blue-50/60 dark:hover:bg-blue-900/25`}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              height: ROW_PX,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                              <div style={{ width: empIdWidth }} className="px-2 flex items-center border-r border-gray-200 shrink-0">
                              <span className="text-xs font-mono font-medium truncate">{employee.code}</span>
                            </div>
                              <div style={{ width: teamWidth }} className="px-1 flex items-center justify-center border-r border-gray-200 shrink-0">
                                <span className={`inline-flex items-center justify-center rounded bg-gray-700 text-white text-[10px] font-semibold shadow-sm ${isMobile ? "h-6 w-6" : "h-7 w-7"}`}>
                                {employee.team}
                              </span>
                            </div>
                              <div style={{ width: nameWidth }} className="px-2 flex items-center shrink-0">
                              <span className="text-xs font-semibold truncate">{employee.name}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <div
                  ref={dateHeaderRef}
                  className="shrink-0 overflow-x-auto overflow-y-hidden min-w-0 bg-background [&::-webkit-scrollbar]:hidden"
                  style={{ scrollbarWidth: "none" }}
                  onScroll={onDateHeaderScroll}
                >
                  <div className={`flex ${ROW_H} border-b-2 border-gray-400 bg-background`} style={{ width: `${gridWidth}px` }}>
                    {dates.map((date) => (
                      <div key={date.key} className={`w-28 flex-shrink-0 px-2 flex flex-col items-center justify-center border-r border-gray-300 ${date.isWeekend ? "bg-muted" : ""}`}>
                        <span className="font-semibold text-xs leading-tight">{date.label}</span>
                        <span className={`text-[10px] leading-tight ${date.isWeekend ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                          {date.dayOfWeek}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div ref={gridRef} className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar schedule-grid-scrollbar min-w-0" onScroll={onGridScroll}>
                  <div className="relative" style={{ height: totalHeight, width: `${gridWidth}px` }}>
                    {virtualRows.map((virtualRow) => {
                      const employee = filteredEmployees[virtualRow.index];
                      const rowIndex = virtualRow.index;
                      return (
                        <div
                          key={employee.userId}
                          className={`flex ${ROW_H} border-b border-gray-200 dark:border-slate-700 transition-colors ${rowIndex % 2 === 0 ? "bg-white dark:bg-slate-900/55" : "bg-slate-50/70 dark:bg-slate-800/55"} hover:bg-blue-50/60 dark:hover:bg-blue-900/25`}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: `${gridWidth}px`,
                            height: ROW_PX,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {dates.map((date) => {
                            const cellKey = `${employee.userId}|${date.key}`;
                            const code = attendanceMap.get(cellKey) || "";

                            if (isEditing) {
                              return (
                                <EditableAttendanceCell
                                  key={date.key}
                                  code={code}
                                  isWeekend={date.isWeekend}
                                  isSaving={savingCellKey === cellKey}
                                  onCodeChange={(nextCode) => handleAttendanceChange(employee.userId, date.key, nextCode)}
                                />
                              );
                            }

                            return (
                              <AttendanceCell
                                key={date.key}
                                code={code}
                                isWeekend={date.isWeekend}
                              />
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="shrink-0 flex border-t border-slate-300 bg-slate-100/90">
              <div style={{ width: leftPanelWidth }} className="shrink-0 border-r border-slate-300 bg-slate-200/70" />
              <div className={`flex-1 ${isMobile ? "px-2 py-1" : "px-3 py-2"}`}>
                <div
                  ref={horizontalTrackRef}
                  onMouseDown={handleHorizontalTrackMouseDown}
                  className={`relative rounded-full bg-slate-300/90 shadow-inner ${isMobile ? "h-3" : "h-6"}`}
                >
                  <div
                    className={`absolute rounded-full bg-slate-700 shadow-[0_5px_14px_rgba(15,23,42,0.24)] ${isMobile ? "top-0.5 h-2" : "top-0.5 h-5"} ${horizontalMaxScroll > 0 ? "cursor-grab" : "cursor-not-allowed opacity-50"}`}
                    style={{ width: `${thumbWidth}px`, transform: `translateX(${thumbLeft}px)` }}
                    onMouseDown={handleHorizontalThumbMouseDown}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}