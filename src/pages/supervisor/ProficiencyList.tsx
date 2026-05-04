import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Download,
  ListChecks,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  buildMonthlyProficiencyRows,
  comparePositionFilterKeys,
  formatPositionFilterLabel,
  getInstructorKeys,
  getTeamLabel,
  hasInstructorValidityThrough,
  isRatingValidThrough,
  normalizeRatingData,
  type MonthlyProficiencyRow,
  type MonthlyProficiencySource,
} from "@/lib/proficiency";
import { normalizeTeamKey } from "@/lib/teamDutyRotation";
import { cn } from "@/lib/utils";

type ProfileRow = {
  employee_id: string | null;
  full_name: string | null;
  current_shift: string | null;
  is_hidden?: boolean | null;
};

type TrainingRow = {
  emp_id: string | null;
  employee_name: string | null;
  highest_rating: string | null;
  rating_data: unknown;
  instructor_validity: Record<string, string> | null;
  ojti: Record<string, boolean> | null;
};

type ProficiencyPerson = MonthlyProficiencySource & {
  teamKey: string;
  teamLabel: string;
  ratings: ReturnType<typeof normalizeRatingData>;
};

type InstructorCandidate = {
  employeeId: string;
  employeeName: string;
  teamKey: string;
  teamLabel: string;
  highestRating: string | null;
  matchedRatingKeys: string[];
};

const TEAM_ORDER = ["G", "A", "B", "C", "D", "E"];

function normalizeEmployeeId(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function escapeCsvValue(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

async function fetchProficiencySources(): Promise<MonthlyProficiencySource[]> {
  const [{ data: profiles, error: profilesError }, { data: trainingRows, error: trainingError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("employee_id, full_name, current_shift, is_hidden")
      .or("is_hidden.is.null,is_hidden.eq.false"),
    supabase
      .from("employee_training_records" as any)
      .select("emp_id, employee_name, highest_rating, rating_data, instructor_validity, ojti"),
  ]);

  if (profilesError) throw profilesError;
  if (trainingError) throw trainingError;

  const profileMap = new Map(
    ((profiles || []) as ProfileRow[])
      .map((profile) => [normalizeEmployeeId(profile.employee_id), profile] as const)
      .filter(([employeeId]) => Boolean(employeeId)),
  );

  const sources = new Map<string, MonthlyProficiencySource>();

  for (const row of (trainingRows || []) as TrainingRow[]) {
    const employeeId = normalizeEmployeeId(row.emp_id);
    if (!employeeId) continue;

    const profile = profileMap.get(employeeId);
    if (profile?.is_hidden) continue;

    sources.set(employeeId, {
      employeeId,
      employeeName: profile?.full_name || row.employee_name || employeeId,
      currentShift: profile?.current_shift || null,
      highestRating: row.highest_rating || null,
      ratingData: row.rating_data || null,
      instructor_validity: row.instructor_validity || null,
      ojti: row.ojti || null,
    });
  }

  return Array.from(sources.values()).sort((left, right) => left.employeeName.localeCompare(right.employeeName));
}

function InstructorAssigneeSelect({
  row,
  value,
  candidates,
  onSelect,
}: {
  row: MonthlyProficiencyRow;
  value: InstructorCandidate | null;
  candidates: InstructorCandidate[];
  onSelect: (candidateId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("__all__");
  const [ratingFilter, setRatingFilter] = useState("__all__");

  const ratingOptions = useMemo(
    () => Array.from(new Set(candidates.flatMap((candidate) => candidate.matchedRatingKeys))).sort(comparePositionFilterKeys),
    [candidates],
  );

  const filteredCandidates = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return candidates.filter((candidate) => {
      if (teamFilter !== "__all__" && candidate.teamKey !== teamFilter) return false;
      if (ratingFilter !== "__all__" && !candidate.matchedRatingKeys.includes(ratingFilter)) return false;

      if (!normalizedSearch) return true;

      const haystack = [candidate.employeeId, candidate.employeeName, candidate.teamLabel, candidate.highestRating || ""]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [candidates, ratingFilter, search, teamFilter]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" type="button" className="h-9 w-full min-w-[210px] justify-between text-xs font-normal">
          <span className="truncate">{value?.employeeName || "Select instructor"}</span>
          {!value && candidates.length > 0 && (
            <span className="ml-1 shrink-0 text-[10px] text-slate-400">({candidates.length})</span>
          )}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(calc(100vw-2rem),24rem)] p-0" align="end">
        <div className="border-b px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Instructor list</div>
          <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{row.employeeName} · {row.sector}</div>
          <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
            {row.shiftLabel} + General · Due {format(row.dueOnDate, "dd MMM yyyy")}
          </div>
        </div>

        <div className="grid gap-2 border-b p-3 sm:grid-cols-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search instructor..."
            className="h-8 text-xs sm:col-span-2"
          />

          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Filter team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All eligible teams</SelectItem>
              {Array.from(new Set(candidates.map((candidate) => candidate.teamKey)))
                .sort((left, right) => TEAM_ORDER.indexOf(left) - TEAM_ORDER.indexOf(right))
                .map((teamKey) => (
                  <SelectItem key={teamKey} value={teamKey}>
                    {getTeamLabel(teamKey)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Filter rating" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All eligible ratings</SelectItem>
              {ratingOptions.map((ratingKey) => (
                <SelectItem key={ratingKey} value={ratingKey}>
                  {formatPositionFilterLabel(ratingKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="max-h-72 overflow-auto p-2">
          {value && (
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className="mb-1 flex w-full items-center justify-between rounded-lg border border-dashed border-slate-300 px-3 py-2 text-left text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              <span>Clear selection</span>
              <span className="text-[11px] text-slate-400">Remove instructor</span>
            </button>
          )}

          {filteredCandidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {candidates.length === 0
                ? `No instructors with ${row.instructorValidityKeys.join(" / ")} validity through ${format(row.dueOnDate, "dd MMM yyyy")} on ${row.shiftLabel} + General.`
                : "No eligible instructors match the current filters."}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredCandidates.map((candidate) => {
                const isSelected = value?.employeeId === candidate.employeeId;

                return (
                  <button
                    key={candidate.employeeId}
                    type="button"
                    onClick={() => {
                      onSelect(candidate.employeeId);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900",
                      isSelected
                        ? "border-slate-900 bg-slate-50 dark:border-slate-200 dark:bg-slate-900"
                        : "border-slate-200 dark:border-slate-800",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{candidate.employeeName}</div>
                      <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                        {candidate.employeeId} · {candidate.teamLabel}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Rating {candidate.matchedRatingKeys.map((ratingKey) => formatPositionFilterLabel(ratingKey)).join(" / ")}
                      </div>
                    </div>
                    {isSelected ? <span className="ml-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">Selected</span> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function ProficiencyList() {
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [searchText, setSearchText] = useState("");
  const [teamFilter, setTeamFilter] = useState("__all__");
  const [sectorFilter, setSectorFilter] = useState("__all__");
  const [assignedInstructors, setAssignedInstructors] = useState<Record<string, string>>({});
  const prevMonthRef = useRef(selectedMonth);

  useEffect(() => {
    if (prevMonthRef.current.getTime() !== selectedMonth.getTime()) {
      prevMonthRef.current = selectedMonth;
      setAssignedInstructors({});
    }
  }, [selectedMonth]);

  const { data: sources = [], isLoading, isFetching, error, refetch } = useQuery<MonthlyProficiencySource[]>({
    queryKey: ["monthly-proficiency-sources"],
    queryFn: fetchProficiencySources,
    staleTime: 60_000,
  });

  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);

  const people = useMemo<ProficiencyPerson[]>(() => {
    return sources.map((source) => {
      const teamKey = normalizeTeamKey(source.currentShift);
      return {
        ...source,
        teamKey,
        teamLabel: getTeamLabel(teamKey),
        ratings: normalizeRatingData(source.ratingData),
      };
    });
  }, [sources]);

  const allRows = useMemo(() => buildMonthlyProficiencyRows(sources, selectedMonth), [selectedMonth, sources]);

  const instructorById = useMemo(
    () => new Map(people.map((person) => [person.employeeId, person] as const)),
    [people],
  );

  const instructorCandidatesByRow = useMemo(() => {
    const candidateMap = new Map<string, InstructorCandidate[]>();

    for (const row of allRows) {
      const candidates = people
        .flatMap((person) => {
          if (person.employeeId === row.employeeId) return [] as InstructorCandidate[];
          if (!(person.teamKey === row.shiftKey || person.teamKey === "G")) return [] as InstructorCandidate[];

          const instructorKeys = getInstructorKeys(person);
          if (!row.instructorValidityKeys.some((requiredKey) => {
            const sectorCode = requiredKey.replace(/^INSTR\s+/i, "").toUpperCase();
            return instructorKeys.some((ik) => ik.includes(sectorCode));
          })) return [] as InstructorCandidate[];
          if (!hasInstructorValidityThrough(person, row.instructorValidityKeys, row.dueOnDate)) return [] as InstructorCandidate[];

          const matchedRatingKeys = row.candidateRatingKeys
            .filter((ratingKey) => isRatingValidThrough({ ratings: person.ratings }, ratingKey, monthEnd))
            .sort(comparePositionFilterKeys);

          if (matchedRatingKeys.length === 0) return [] as InstructorCandidate[];

          return [{
            employeeId: person.employeeId,
            employeeName: person.employeeName,
            teamKey: person.teamKey,
            teamLabel: person.teamLabel,
            highestRating: person.highestRating,
            matchedRatingKeys,
          } satisfies InstructorCandidate];
        })
        .sort((left, right) => {
          const teamCompare = TEAM_ORDER.indexOf(left.teamKey) - TEAM_ORDER.indexOf(right.teamKey);
          if (teamCompare !== 0) return teamCompare;
          return left.employeeName.localeCompare(right.employeeName);
        });

      candidateMap.set(row.id, candidates);
    }

    return candidateMap;
  }, [allRows, monthEnd, people]);

  const teamOptions = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.shiftKey))).sort((left, right) => TEAM_ORDER.indexOf(left) - TEAM_ORDER.indexOf(right)),
    [allRows],
  );

  const sectorOptions = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.sector))).sort(comparePositionFilterKeys),
    [allRows],
  );

  const visibleRows = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return allRows.filter((row) => {
      if (teamFilter !== "__all__" && row.shiftKey !== teamFilter) return false;
      if (sectorFilter !== "__all__" && row.sector !== sectorFilter) return false;

      if (!normalizedSearch) return true;

      const haystack = [row.employeeId, row.employeeName, row.shiftLabel, row.sector, row.highestRating || ""]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [allRows, searchText, sectorFilter, teamFilter]);

  const assignedVisibleCount = visibleRows.filter((row) => assignedInstructors[row.id]).length;
  const collapsedCount = allRows.filter((row) => row.sector === "ACC P & S").length;

  const handleExport = () => {
    if (visibleRows.length === 0) {
      toast.error("No rows available to export");
      return;
    }

    const headers = ["Employee ID", "Name", "Shift", "Proficiency Due On", "Sector", "Instructor Allotted"];
    const body = visibleRows.map((row) => {
      const instructorId = assignedInstructors[row.id];
      const instructorName = instructorId ? instructorById.get(instructorId)?.employeeName || "" : "";

      return [
        row.employeeId,
        row.employeeName,
        row.shiftLabel,
        row.dueOn,
        row.sector,
        instructorName,
      ].map((value) => escapeCsvValue(String(value || ""))).join(",");
    });

    const blob = new Blob([[headers.join(","), ...body].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `proficiency-table-${format(selectedMonth, "yyyy-MM")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Proficiency table exported");
  };

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6 p-4 md:p-6">
        <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-col gap-5 p-5 md:p-7 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <ListChecks className="h-3.5 w-3.5" />
                Proficiency planning
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-3xl">
                  Proficiency List
                </h1>
                <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300 md:text-[15px]">
                  Review month-wise proficiency due rows, apply the ACC P & S collapse rule, assign eligible instructors from the same team plus General, and export the visible table to CSV.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {allRows.length} due rows
                </Badge>
                <Badge variant="secondary" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {collapsedCount} ACC P & S rows
                </Badge>
                <Badge variant="secondary" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {assignedVisibleCount} assigned in view
                </Badge>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Button type="button" variant="outline" onClick={() => navigate("/supervisor/ratings")}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Ratings
              </Button>

              <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setSelectedMonth((current) => addMonths(current, -1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-[126px] px-2 text-center text-sm font-semibold text-slate-900 dark:text-white">
                  {format(selectedMonth, "MMMM yyyy")}
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setSelectedMonth((current) => addMonths(current, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <Button type="button" onClick={handleExport} disabled={visibleRows.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_180px_180px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search by emp id, name, shift, sector..."
              className="pl-9"
            />
          </div>

          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All shifts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All shifts</SelectItem>
              {teamOptions.map((teamKey) => (
                <SelectItem key={teamKey} value={teamKey}>
                  {getTeamLabel(teamKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sectorFilter} onValueChange={setSectorFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All sectors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All sectors</SelectItem>
              {sectorOptions.map((sector) => (
                <SelectItem key={sector} value={sector}>
                  {formatPositionFilterLabel(sector)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button type="button" variant="outline" onClick={() => {
            setSearchText("");
            setTeamFilter("__all__");
            setSectorFilter("__all__");
          }}>
            Reset Filters
          </Button>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-lg font-semibold">Unable to load proficiency list</div>
                <div className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                  {(error as Error).message || "The month proficiency data could not be loaded."}
                </div>
              </div>
              <Button type="button" variant="outline" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          </div>
        ) : null}

        <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">Month Table</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Showing {visibleRows.length} row{visibleRows.length === 1 ? "" : "s"} due in {format(selectedMonth, "MMMM yyyy")}
              </div>
            </div>
            {isFetching ? <Badge variant="secondary">Refreshing</Badge> : null}
          </div>

          {isLoading ? (
            <div className="px-5 py-10 text-sm text-slate-600 dark:text-slate-300">Loading month proficiency rows...</div>
          ) : visibleRows.length === 0 ? (
            <div className="px-5 py-10 text-sm text-slate-600 dark:text-slate-300">
              No proficiency rows are due in {format(selectedMonth, "MMMM yyyy")} for the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[110px]">Emp ID</TableHead>
                  <TableHead className="min-w-[210px]">Name</TableHead>
                  <TableHead className="min-w-[120px]">Shift</TableHead>
                  <TableHead className="min-w-[145px]">Proficiency Due On</TableHead>
                  <TableHead className="min-w-[130px]">Sector</TableHead>
                  <TableHead className="min-w-[260px]">Instructor Allotted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => {
                  const assignedId = assignedInstructors[row.id];
                  let selectedInstructor: InstructorCandidate | null = null;
                  if (assignedId) {
                    const fromCandidates = instructorCandidatesByRow.get(row.id)?.find((c) => c.employeeId === assignedId);
                    if (fromCandidates) {
                      selectedInstructor = fromCandidates;
                    } else {
                      const fallback = instructorById.get(assignedId);
                      if (fallback) {
                        selectedInstructor = {
                          employeeId: assignedId,
                          employeeName: fallback.employeeName,
                          teamKey: fallback.teamKey,
                          teamLabel: fallback.teamLabel,
                          highestRating: fallback.highestRating,
                          matchedRatingKeys: row.candidateRatingKeys,
                        };
                      }
                    }
                  }

                  const candidates = instructorCandidatesByRow.get(row.id) || [];

                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-white">{row.employeeId}</TableCell>
                      <TableCell>
                        <div className="font-medium text-slate-900 dark:text-white">{row.employeeName}</div>
                        {row.highestRating ? (
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Highest rating: {row.highestRating}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{row.shiftLabel}</TableCell>
                      <TableCell>{format(row.dueOnDate, "dd MMM yyyy")}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
                          {formatPositionFilterLabel(row.sector)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <InstructorAssigneeSelect
                          row={row}
                          value={selectedInstructor || null}
                          candidates={candidates}
                          onSelect={(candidateId) => {
                            setAssignedInstructors((current) => {
                              if (!candidateId) {
                                const next = { ...current };
                                delete next[row.id];
                                return next;
                              }

                              return {
                                ...current,
                                [row.id]: candidateId,
                              };
                            });
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}