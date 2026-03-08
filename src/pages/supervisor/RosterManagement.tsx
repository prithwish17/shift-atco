import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUsers } from "@/hooks/useUsers";
import { DUTY_CODES, DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Filter, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type SortBy = "name" | "empId" | "team";

interface RosterEmployee {
  id: string;
  empId: string;
  name: string;
  team: string;
}

interface ScheduleRow {
  id: string;
  employee_code: string;
  duty_date: string;
  duty_code: string;
  duty_description: string;
}

const DEFAULT_TEAMS = ["A", "B", "C", "D", "E", "G"];

const normalizeTeam = (value: string | null | undefined): string => {
  const normalized = (value || "").trim().toUpperCase();
  if (!normalized) return "G";
  if (["A", "B", "C", "D", "E", "G"].includes(normalized)) return normalized;
  if (normalized === "GENERAL") return "G";
  return normalized;
};

export default function RosterManagement() {
  const { users, isLoading: usersLoading } = useUsers();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(new Date()));
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const namesBodyRef = useRef<HTMLDivElement | null>(null);
  const dutiesBodyRef = useRef<HTMLDivElement | null>(null);
  const horizontalSyncingRef = useRef(false);
  const verticalSyncingRef = useRef(false);

  const monthStart = useMemo(() => startOfMonth(viewMonth), [viewMonth]);
  const monthEnd = useMemo(() => endOfMonth(viewMonth), [viewMonth]);
  const monthStartStr = useMemo(() => format(monthStart, "yyyy-MM-dd"), [monthStart]);
  const monthEndStr = useMemo(() => format(monthEnd, "yyyy-MM-dd"), [monthEnd]);

  const dates = useMemo(
    () =>
      eachDayOfInterval({ start: monthStart, end: monthEnd }).map((date) => ({
        key: format(date, "yyyy-MM-dd"),
        label: format(date, "dd MMM"),
        dayOfWeek: format(date, "EEE"),
      })),
    [monthStart, monthEnd]
  );

  const employees = useMemo<RosterEmployee[]>(() => {
    if (!users) return [];
    return users
      .filter((u) => u.role === "employee" || !u.role)
      .map((u) => ({
        id: u.id,
        empId: u.employee_id || "",
        name: u.full_name || "Unknown",
        team: normalizeTeam(u.current_shift),
      }))
      .filter((u) => !!u.empId);
  }, [users]);

  const teamOptions = useMemo(() => {
    const discovered = new Set(employees.map((e) => e.team).filter(Boolean));
    const merged = new Set<string>([...DEFAULT_TEAMS, ...Array.from(discovered)]);
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  useEffect(() => {
    setSelectedTeams((prev) => {
      if (prev.length === 0) return teamOptions;
      const filtered = prev.filter((t) => teamOptions.includes(t));
      return filtered.length > 0 ? filtered : teamOptions;
    });
  }, [teamOptions]);

  const { data: scheduleRows = [], isLoading: schedulesLoading } = useQuery({
    queryKey: ["supervisor-roster-management", monthStartStr, monthEndStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_schedules" as any)
        .select("id, employee_code, duty_date, duty_code, duty_description")
        .gte("duty_date", monthStartStr)
        .lte("duty_date", monthEndStr);
      if (error) throw error;
      return (data || []) as unknown as ScheduleRow[];
    },
    staleTime: 60 * 1000,
  });

  const scheduleMap = useMemo(() => {
    const map = new Map<string, ScheduleRow>();
    for (const row of scheduleRows) {
      map.set(`${row.employee_code}::${row.duty_date}`, row);
    }
    return map;
  }, [scheduleRows]);

  const filteredAndSortedEmployees = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return employees
      .filter((employee) => {
        const matchesSearch =
          !query ||
          employee.name.toLowerCase().includes(query) ||
          employee.empId.toLowerCase().includes(query);
        const matchesTeam = selectedTeams.includes(employee.team);
        return matchesSearch && matchesTeam;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "empId") return a.empId.localeCompare(b.empId);
        return a.team.localeCompare(b.team) || a.name.localeCompare(b.name);
      });
  }, [employees, searchQuery, selectedTeams, sortBy]);

  const updateScheduleMutation = useMutation({
    mutationFn: async ({ employee, dutyDate, dutyCode }: { employee: RosterEmployee; dutyDate: string; dutyCode: string }) => {
      const payload = {
        employee_code: employee.empId,
        employee_name: employee.name,
        duty_date: dutyDate,
        duty_code: dutyCode,
        duty_description: DUTY_DESCRIPTIONS[dutyCode] || dutyCode,
      };

      const { error } = await supabase
        .from("employee_schedules" as any)
        .upsert(payload as any, { onConflict: "employee_code,duty_date" });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supervisor-roster-management"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update duty",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const toggleTeam = (team: string) => {
    setSelectedTeams((prev) =>
      prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team]
    );
  };

  const toggleAllTeams = () => {
    setSelectedTeams((prev) =>
      prev.length === teamOptions.length ? [] : teamOptions
    );
  };

  const navigateMonth = (direction: "prev" | "next") => {
    setViewMonth((prev) => addMonths(prev, direction === "prev" ? -1 : 1));
  };

  const handleDutyChange = async (employee: RosterEmployee, dutyDate: string, dutyCode: string) => {
    const key = `${employee.empId}::${dutyDate}`;
    setSavingCellKey(key);
    try {
      await updateScheduleMutation.mutateAsync({ employee, dutyDate, dutyCode });
    } finally {
      setSavingCellKey((current) => (current === key ? null : current));
    }
  };

  const isLoading = usersLoading || schedulesLoading;

  const syncHorizontal = (source: "header" | "duties") => {
    if (horizontalSyncingRef.current) return;
    const header = headerScrollRef.current;
    const duties = dutiesBodyRef.current;
    if (!header || !duties) return;

    horizontalSyncingRef.current = true;
    if (source === "header") duties.scrollLeft = header.scrollLeft;
    if (source === "duties") header.scrollLeft = duties.scrollLeft;
    requestAnimationFrame(() => {
      horizontalSyncingRef.current = false;
    });
  };

  const syncVertical = (source: "names" | "duties") => {
    if (verticalSyncingRef.current) return;
    const names = namesBodyRef.current;
    const duties = dutiesBodyRef.current;
    if (!names || !duties) return;

    verticalSyncingRef.current = true;
    if (source === "names") duties.scrollTop = names.scrollTop;
    if (source === "duties") names.scrollTop = duties.scrollTop;
    requestAnimationFrame(() => {
      verticalSyncingRef.current = false;
    });
  };

  return (
    <DashboardLayout role="supervisor">
      <div className="w-full min-h-0 flex flex-col rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
        <header className="bg-gradient-to-r from-slate-600 to-slate-700 px-3 py-4 sm:px-5 sm:py-5 lg:px-6 shadow-sm">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white tracking-tight">
            Employee Schedule Management
          </h1>
        </header>

        <div className="flex-1 overflow-hidden">
          <div className="w-full min-h-0 flex flex-col bg-gray-50">
            <div className="bg-white border-b border-gray-200 px-3 py-3 sm:px-4 sm:py-4 lg:px-6 shadow-sm">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="w-full sm:flex-1 sm:min-w-[260px] sm:max-w-md relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Search by name or employee ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-gray-50 border-gray-300 focus:border-gray-400"
                  />
                </div>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2 border-gray-300 hover:bg-gray-50">
                      <Filter className="h-4 w-4" />
                      Team Filter
                      {selectedTeams.length < teamOptions.length && (
                        <span className="ml-1 px-2 py-0.5 bg-gray-700 text-white text-xs rounded-full">
                          {selectedTeams.length}
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56" align="start">
                    <div className="space-y-3">
                      <div className="font-semibold text-sm text-gray-700">Filter by Team</div>
                      <div className="flex items-center space-x-2 pb-2 border-b border-gray-200">
                        <Checkbox
                          id="all-teams"
                          checked={selectedTeams.length === teamOptions.length}
                          onCheckedChange={toggleAllTeams}
                        />
                        <label htmlFor="all-teams" className="text-sm font-medium cursor-pointer">
                          Select All
                        </label>
                      </div>

                      {teamOptions.map((team) => (
                        <div key={team} className="flex items-center space-x-2">
                          <Checkbox
                            id={`team-${team}`}
                            checked={selectedTeams.includes(team)}
                            onCheckedChange={() => toggleTeam(team)}
                          />
                          <label htmlFor={`team-${team}`} className="text-sm font-medium cursor-pointer">
                            Team {team}
                          </label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-sm text-gray-600">Sort by:</span>
                  <Select value={sortBy} onValueChange={(value: SortBy) => setSortBy(value)}>
                    <SelectTrigger className="w-full sm:w-[160px] border-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="name">Name</SelectItem>
                      <SelectItem value="empId">Employee ID</SelectItem>
                      <SelectItem value="team">Team</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {(searchQuery || selectedTeams.length < teamOptions.length) && (
                <p className="text-sm text-gray-600 mt-3">
                  Showing {filteredAndSortedEmployees.length} of {employees.length} employee
                  {filteredAndSortedEmployees.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>

            <div className="bg-white border-b border-gray-200 px-3 py-3 sm:px-4 lg:px-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shadow-sm">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateMonth("prev")}
                className="gap-2 hover:bg-gray-50"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Previous Month</span>
                <span className="sm:hidden">Previous</span>
              </Button>
              <h2 className="text-base sm:text-lg font-semibold text-gray-800">{format(viewMonth, "MMMM yyyy")}</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateMonth("next")}
                className="gap-2 hover:bg-gray-50"
              >
                <span className="hidden sm:inline">Next Month</span>
                <span className="sm:hidden">Next</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden bg-white">
              <div className="h-full min-h-0 flex flex-col">
                <div className="shrink-0 border-b-2 border-gray-400 shadow-md flex bg-gradient-to-b from-gray-100 via-gray-50 to-white">
                  <div className="w-[352px] sm:w-[528px] shrink-0 flex border-r-2 border-gray-400 bg-white">
                    <div className="w-28 sm:w-36 px-2 sm:px-4 py-3 sm:py-4 border-r border-gray-300 flex items-center justify-center">
                      <span className="font-semibold text-gray-700 text-xs sm:text-sm">Employee ID</span>
                    </div>
                    <div className="w-16 sm:w-24 px-2 sm:px-4 py-3 sm:py-4 border-r border-gray-300 flex items-center justify-center">
                      <span className="font-semibold text-gray-700 text-xs sm:text-sm">Team</span>
                    </div>
                    <div className="w-44 sm:w-72 px-2 sm:px-4 py-3 sm:py-4 flex items-center justify-center">
                      <span className="font-semibold text-gray-700 text-xs sm:text-sm">Employee Name</span>
                    </div>
                  </div>

                  <div
                    ref={headerScrollRef}
                    onScroll={() => syncHorizontal("header")}
                    className="flex-1 overflow-x-auto overflow-y-hidden"
                  >
                    <div className="flex min-w-max">
                      {dates.map((date) => (
                        <div key={date.key} className="w-24 sm:w-28 px-2 sm:px-3 py-3 sm:py-4 border-r border-gray-300 text-center flex-shrink-0">
                          <div className="font-semibold text-gray-700 text-xs sm:text-sm">{date.label}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{date.dayOfWeek}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {isLoading ? (
                  <div className="flex-1 flex items-center justify-center py-12 text-gray-500">
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Loading roster data...
                  </div>
                ) : filteredAndSortedEmployees.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center py-12 text-gray-500">
                    <p>No employees found matching your filters</p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex overflow-hidden">
                    <div
                      ref={namesBodyRef}
                      onScroll={() => syncVertical("names")}
                      className="w-[352px] sm:w-[528px] shrink-0 overflow-y-auto overflow-x-auto border-r-2 border-gray-400"
                    >
                      <div className="min-w-[352px] sm:min-w-[528px]">
                        {filteredAndSortedEmployees.map((employee, index) => (
                          <div
                            key={employee.id}
                            className={`h-11 sm:h-12 flex border-b border-gray-200 ${index % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}
                          >
                            <div className="w-28 sm:w-36 px-2 sm:px-4 border-r border-gray-200 flex items-center">
                              <span className="text-xs sm:text-sm font-mono font-medium text-gray-700">{employee.empId}</span>
                            </div>
                            <div className="w-16 sm:w-24 px-2 sm:px-4 border-r border-gray-200 flex items-center justify-center">
                              <span className="inline-flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded bg-gray-700 text-white text-[10px] sm:text-xs font-semibold shadow-sm">
                                {employee.team}
                              </span>
                            </div>
                            <div className="w-44 sm:w-72 px-2 sm:px-4 flex items-center">
                              <span className="text-xs sm:text-sm font-semibold text-gray-800 truncate">{employee.name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div
                      ref={dutiesBodyRef}
                      onScroll={() => {
                        syncHorizontal("duties");
                        syncVertical("duties");
                      }}
                      className="flex-1 overflow-auto"
                    >
                      <div className="min-w-max">
                        {filteredAndSortedEmployees.map((employee, index) => (
                          <div key={employee.id} className={`h-11 sm:h-12 flex border-b border-gray-200 ${index % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}>
                            {dates.map((date) => {
                              const key = `${employee.empId}::${date.key}`;
                              const row = scheduleMap.get(key);
                              const duty = row?.duty_code || "";
                              const isSaving = savingCellKey === key;

                              return (
                                <div key={date.key} className="w-24 sm:w-28 px-1.5 sm:px-2 py-1 border-r border-gray-200 flex items-center justify-center flex-shrink-0">
                                  <Select
                                    value={duty || undefined}
                                    onValueChange={(value) => handleDutyChange(employee, date.key, value)}
                                    disabled={isSaving}
                                  >
                                    <SelectTrigger className="w-full h-8 sm:h-9 text-xs font-semibold border-[1.5px] border-gray-300 bg-white hover:bg-gray-50 transition-all focus:ring-2 focus:ring-gray-400 shadow-sm">
                                      {isSaving ? (
                                        <div className="w-full flex items-center justify-center">
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        </div>
                                      ) : (
                                        <SelectValue placeholder="-" />
                                      )}
                                    </SelectTrigger>
                                    <SelectContent>
                                      {DUTY_CODES.map((dutyCode) => (
                                        <SelectItem key={dutyCode} value={dutyCode} className="text-xs font-medium">
                                          {dutyCode}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
