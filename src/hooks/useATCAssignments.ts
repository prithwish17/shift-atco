import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ATCAssignment {
  date: string;
  shift: string;
  team: string;
  unit: string;
  employee_name: string;
  role: string;
  position: string;
}

export interface ATCGridCell {
  employee_name: string;
  role: string;
}

export interface ATCGridUnit {
  [position: string]: ATCGridCell[];
}

export interface ATCGridTeam {
  units: { [unit: string]: ATCGridUnit };
}

export interface ATCGridData {
  teams: { [team: string]: ATCGridTeam };
  allPositions: string[];
  allTeams: string[];
  allUnits: string[];
}

function transformToGrid(assignments: ATCAssignment[]): ATCGridData {
  const teams: { [team: string]: ATCGridTeam } = {};
  const positionsSet = new Set<string>();
  const teamsSet = new Set<string>();
  const unitsSet = new Set<string>();

  for (const a of assignments) {
    const team = a.team || "Unassigned";
    const unit = a.unit || "Unknown";
    const position = a.position || "Unassigned";

    teamsSet.add(team);
    unitsSet.add(unit);
    positionsSet.add(position);

    if (!teams[team]) teams[team] = { units: {} };
    if (!teams[team].units[unit]) teams[team].units[unit] = {};
    if (!teams[team].units[unit][position]) teams[team].units[unit][position] = [];

    teams[team].units[unit][position].push({
      employee_name: a.employee_name,
      role: a.role,
    });
  }

  return {
    teams,
    allPositions: [...positionsSet].sort(),
    allTeams: [...teamsSet].sort(),
    allUnits: [...unitsSet].sort(),
  };
}

async function fetchAssignments(date?: string, shift?: string): Promise<{
  assignments: ATCAssignment[];
  meta: { role: string; total: number };
}> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) throw new Error("Not authenticated");

  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (shift) params.set("shift", shift);

  const url = `/api/functions/atc-assignments?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch ATC assignments: ${text}`);
  }

  return res.json();
}

export function useATCAssignments(date?: string, shift?: string, enabled = true) {
  const query = useQuery({
    queryKey: ["atc-assignments", date, shift],
    queryFn: () => fetchAssignments(date, shift),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });

  const gridData = query.data
    ? transformToGrid(query.data.assignments)
    : null;

  return {
    assignments: query.data?.assignments || [],
    gridData,
    meta: query.data?.meta,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

// Helper functions for the data provider abstraction
export function getEmployeeAssignments(
  assignments: ATCAssignment[],
  employeeName: string
) {
  return assignments.filter(
    (a) => a.employee_name.toLowerCase() === employeeName.toLowerCase()
  );
}

export function getTeamAssignments(
  assignments: ATCAssignment[],
  team: string
) {
  return assignments.filter(
    (a) => a.team.toLowerCase() === team.toLowerCase()
  );
}
