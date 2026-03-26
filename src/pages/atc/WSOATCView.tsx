import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, RefreshCw, DatabaseZap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { DEPARTMENTS, POSITION_ROWS, ATC_SHIFTS, ALL_NIGHT_DEPARTMENTS } from '@/lib/atcConstants';
import { NightDutyGrid } from '@/components/NightDutyGrid';
import {
  useDutyRoster,
  useCreateOrGetRoster,
  useRosterAssignments,
  useUpsertAssignment,
  useGridExtraDuties,
  useSyncRosterToGrid,
  useRosterStatusEntries,
} from '@/hooks/useDutyGrid';
import { useATCAssignments } from '@/hooks/useATCAssignments';
import type { GridEmployee } from '@/hooks/useDutyGrid';
import { supabase } from '@/integrations/supabase/client';
import { SCHEDULE_QUERY_OPTIONS } from '@/lib/scheduleQueryConfig';
import { buildNameIndex, findUniqueNameMatch, namesMatch } from '@/lib/nameMatching';
import { getDutyShiftMatches, type TeamDutyCode } from '@/lib/teamDutyRotation';
import { getLeaveTypeLabel } from '@/lib/leaveConstants';
import { safeStorage } from '@/lib/safeStorage';
import { useAuth } from '@/contexts/AuthContext';

type ScheduleMember = {
  id: string;
  employee_id: string;
  full_name: string | null;
  designation: string | null;
  highest_rating: string | null;
  current_shift: string | null;
  duty_code: string | null;
  duty_description: string | null;
  employee_name: string | null;
};

type ApprovedLeaveEntry = {
  employee_id: string;
  employee_name: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
};

type SuggestionOption = {
  value: string;
  label: string;
};

const OPE_CODES = new Set([
  'M+A', 'NO+N', 'SAT+NO', 'SUN+N', 'SUN+M', 'SUN+A', 'SUN+NO',
  'SAT+N', 'CO+N', 'CO+A', 'CO+M', 'A+M',
]);
const AVAILABILITY_CATEGORIES = [
  'RSR+UBN',
  'RSR',
  'ASR+RSR',
  'ASR+APP',
  'ACC-PLR',
  'OCC+ACC-PLR',
  'ADC+ACC-PLR',
  'ACC-PLR+ACC-P',
  'ADC+ACC-P',
  'ACC-P+OCC',
  'OCC',
  'ADC/SMC',
  'ALPHA',
  'CHANGE FROM NORMAL DUTY',
  'TOUR',
  'TRAINING',
  'GENERAL DUTY',
  'SAR / AIS',
  'LEAVE',
] as const;
const WSO_ATC_GRID_CACHE_KEY = 'wso-atc-grid-filters';

const normalizeTeam = (value: string | null | undefined) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized || normalized === 'GENERAL') return 'G';
  return normalized;
};

const normalizeUpper = (value: string | null | undefined) => String(value || '').trim().toUpperCase();

function SuggestionInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SuggestionOption[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label || '',
    [options, value]
  );

  useEffect(() => {
    setQuery(value && value !== '_none' ? selectedLabel || value : '');
  }, [selectedLabel, value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery(value && value !== '_none' ? selectedLabel || value : '');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedLabel, value]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options.slice(0, 12);
    return options
      .filter((option) => option.label.toLowerCase().includes(normalizedQuery))
      .slice(0, 12);
  }, [options, query]);

  const commitSelection = (nextValue: string) => {
    if (nextValue === '_none') {
      onChange('_none');
      setQuery('');
      setOpen(false);
      return;
    }

    const selected = options.find((option) => option.value === nextValue);
    onChange(nextValue);
    setQuery(selected?.label || '');
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <Input
        className="h-7 w-full text-xs"
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && filteredOptions.length > 0) {
            event.preventDefault();
            commitSelection(filteredOptions[0].value);
          }
          if (event.key === 'Escape') {
            setOpen(false);
            setQuery(value && value !== '_none' ? selectedLabel || value : '');
          }
        }}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-44 w-full overflow-auto rounded-md border bg-popover p-1 text-xs shadow-md">
          <button
            type="button"
            className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
            onMouseDown={(event) => {
              event.preventDefault();
              commitSelection('_none');
            }}
          >
            — None —
          </button>
          {filteredOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(event) => {
                event.preventDefault();
                commitSelection(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
          {filteredOptions.length === 0 && (
            <div className="px-2 py-1.5 text-muted-foreground">No suggestions</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WSOATCView() {
  const { user } = useAuth();
  const [date, setDate] = useState<Date>(() => {
    if (typeof window === 'undefined') return new Date();
    const stored = safeStorage.getItem(WSO_ATC_GRID_CACHE_KEY);
    if (!stored) return new Date();

    try {
      const parsed = JSON.parse(stored) as { date?: string };
      if (!parsed.date) return new Date();
      const savedDate = parseISO(parsed.date);
      return Number.isNaN(savedDate.getTime()) ? new Date() : savedDate;
    } catch {
      return new Date();
    }
  });
  const [shift, setShift] = useState(() => {
    if (typeof window === 'undefined') return 'Morning';
    const stored = safeStorage.getItem(WSO_ATC_GRID_CACHE_KEY);
    if (!stored) return 'Morning';

    try {
      const parsed = JSON.parse(stored) as { shift?: string };
      return ATC_SHIFTS.includes(parsed.shift as typeof ATC_SHIFTS[number]) ? parsed.shift! : 'Morning';
    } catch {
      return 'Morning';
    }
  });
  const [positionLabels, setPositionLabels] = useState<Record<string, string>>({});
  const { data: wsoProfile } = useQuery({
    queryKey: ['wso-atc-team', user?.id],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      if (!user?.id) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('current_shift')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data as { current_shift: string | null } | null;
    },
    enabled: !!user?.id,
  });
  const team = wsoProfile?.current_shift ? normalizeTeam(wsoProfile.current_shift) : '';

  const isNight = shift === 'Night';
  const selectedShiftCode: TeamDutyCode | null =
    shift === 'Morning' ? 'M' :
    shift === 'AFTERNOON' ? 'A' :
    shift === 'Night' ? 'N' :
    null;

  const dateStr = format(date, 'yyyy-MM-dd');
  const { refetch: refetchEdge, isLoading: edgeLoading } = useATCAssignments(dateStr, shift || undefined);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    safeStorage.setItem(WSO_ATC_GRID_CACHE_KEY, JSON.stringify({
      date: dateStr,
      shift,
    }));
  }, [dateStr, shift]);

  const { data: roster, isLoading: rosterLoading } = useDutyRoster(date, shift, team);
  const createOrGetRoster = useCreateOrGetRoster();
  const { data: assignments = [] } = useRosterAssignments(roster?.id);
  const upsertAssignment = useUpsertAssignment();
  const { data: extraDuties = [] } = useGridExtraDuties(roster?.id);
  const syncFromRoster = useSyncRosterToGrid();
  const { data: allScheduleMembers = [], isLoading: teamScheduleLoading } = useQuery({
    queryKey: ['wso-atc-schedule-members', dateStr],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      const { data: schedules, error: schedulesError } = await supabase
        .from('employee_schedules' as any)
        .select('employee_code, employee_name, duty_code, duty_description')
        .eq('duty_date', dateStr);
      if (schedulesError) throw schedulesError;

      const scheduleRows = (schedules || []) as Array<{
        employee_code: string | null;
        employee_name: string | null;
        duty_code: string | null;
        duty_description: string | null;
      }>;
      const employeeCodes = [...new Set(scheduleRows.map((row) => String(row.employee_code || '').trim()).filter(Boolean))];
      if (employeeCodes.length === 0) return [];

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, employee_id, full_name, designation, current_shift')
        .neq('is_hidden' as any, true)
        .in('employee_id', employeeCodes)
        .order('full_name');
      if (profilesError) throw profilesError;

      const { data: trainingRecords, error: trainingError } = await supabase
        .from('employee_training_records' as any)
        .select('emp_id, highest_rating')
        .in('emp_id', employeeCodes);
      if (trainingError) throw trainingError;

      const profileMap = new Map(
        ((profiles || []) as any[]).map((profile) => [String(profile.employee_id || '').trim(), profile])
      );
      const profileNameMap = buildNameIndex((profiles || []) as any[], (profile) => profile.full_name);
      const trainingMap = new Map(
        ((trainingRecords || []) as Array<{ emp_id: string | null; highest_rating: string | null }>)
          .map((record) => [String(record.emp_id || '').trim(), record.highest_rating || null])
      );

      return scheduleRows
        .map((schedule) => {
          const employeeCode = String(schedule.employee_code || '').trim();
          const profile = profileMap.get(employeeCode) || findUniqueNameMatch(profileNameMap, schedule.employee_name);
          if (!employeeCode) return null;

          return {
            id: profile?.id || employeeCode,
            employee_id: employeeCode,
            full_name: profile?.full_name || null,
            designation: profile?.designation || null,
            highest_rating: trainingMap.get(employeeCode) || null,
            current_shift: profile?.current_shift || null,
            duty_code: schedule.duty_code ?? null,
            duty_description: schedule.duty_description ?? null,
            employee_name: schedule.employee_name ?? null,
          };
        })
        .filter(Boolean) as ScheduleMember[];
    },
  });
  const { data: approvedLeaveEntries = [] } = useQuery({
    queryKey: ['wso-atc-approved-leaves', dateStr, team],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      if (!team) return [];

      const { data, error } = await supabase
        .from('leave_requests' as any)
        .select('employee_id, employee_name, leave_type, start_date, end_date')
        .eq('status', 'Approved')
        .lte('start_date', dateStr)
        .gte('end_date', dateStr);
      if (error) throw error;

      const rows = (data || []) as ApprovedLeaveEntry[];
      if (rows.length === 0) return [];

      const profileIds = [...new Set(rows.map((entry) => entry.employee_id).filter(Boolean))];
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, current_shift')
        .neq('is_hidden' as any, true)
        .in('id', profileIds);
      if (profilesError) throw profilesError;

      const profileMap = new Map(
        ((profiles || []) as any[]).map((profile) => [profile.id, profile])
      );

      return rows.filter((entry) => {
        const profile = profileMap.get(entry.employee_id);
        return profile && normalizeTeam(profile.current_shift) === team;
      });
    },
    enabled: !!team,
  });

  // Fetch roster entries with DUTY CHANGE / EXTRA DUTY from Google Sheets
  const { data: statusEntries = [] } = useRosterStatusEntries(date, shift, team);
  const dutyChangeEntries = statusEntries.filter(e => e.unit?.toUpperCase() === 'DUTY CHANGE');

  // Auto-create roster only after query confirms none exists
  useEffect(() => {
    if (!rosterLoading && !roster && team && !createOrGetRoster.isPending) {
      createOrGetRoster.mutate({ date: format(date, 'yyyy-MM-dd'), shift, team });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, shift, team, rosterLoading]);

  const assignedEmployeeIds = useMemo(() => {
    const ids = new Set<string>();
    assignments.forEach((a) => { if (a.employee_id) ids.add(a.employee_id); });
    extraDuties.forEach((d) => { if (d.employee_id) ids.add(d.employee_id); });
    return ids;
  }, [assignments, extraDuties]);
  const assignedGridEmployeeIds = useMemo(() => {
    const ids = new Set<string>();
    assignments.forEach((assignment) => {
      if (assignment.employee_id) ids.add(assignment.employee_id);
    });
    return ids;
  }, [assignments]);

  const teamScheduleMembers = useMemo(
    () => allScheduleMembers.filter((member) => normalizeTeam(member.current_shift) === team),
    [allScheduleMembers, team]
  );

  const shiftScheduledEmployees = useMemo(
    () => teamScheduleMembers.filter((member) =>
      !!selectedShiftCode &&
      getDutyShiftMatches(member.duty_code).includes(selectedShiftCode)
    ),
    [teamScheduleMembers, selectedShiftCode]
  );

  const allShiftDutyEmployees = useMemo(
    () => allScheduleMembers.filter((member) =>
      !!selectedShiftCode &&
      getDutyShiftMatches(member.duty_code).includes(selectedShiftCode)
    ),
    [allScheduleMembers, selectedShiftCode]
  );

  const scheduleLinkedEmployees = useMemo<GridEmployee[]>(
    () => shiftScheduledEmployees.map((member) => ({
      id: member.id,
      full_name: member.full_name || member.employee_name || member.employee_id,
      designation: member.designation,
    })),
    [shiftScheduledEmployees]
  );

  const scheduleLeaveEntries = useMemo(
    () => teamScheduleMembers.filter((member) => String(member.duty_code || '').toUpperCase().trim() === 'LEAVE'),
    [teamScheduleMembers]
  );
  const shiftExtraDutyMembers = useMemo(
    () => allScheduleMembers.filter((member) => {
      const code = String(member.duty_code || '').toUpperCase().trim();
      return !!selectedShiftCode && !!code && OPE_CODES.has(code) && getDutyShiftMatches(code).includes(selectedShiftCode);
    }),
    [allScheduleMembers, selectedShiftCode]
  );
  const resolvedLeaveEntries = useMemo(() => {
    const entries = new Map<string, {
      key: string;
      employeeName: string;
      designation: string | null;
      label: string;
    }>();

    scheduleLeaveEntries.forEach((entry) => {
      entries.set(entry.id, {
        key: entry.id,
        employeeName: entry.full_name || entry.employee_name || 'Unknown',
        designation: entry.designation,
        label: entry.duty_description || 'LEAVE',
      });
    });

    approvedLeaveEntries.forEach((entry) => {
      if (entries.has(entry.employee_id)) return;
      entries.set(entry.employee_id, {
        key: `${entry.employee_id}-${entry.start_date}-${entry.end_date}`,
        employeeName: entry.employee_name || 'Unknown',
        designation: null,
        label: getLeaveTypeLabel(entry.leave_type),
      });
    });

    return Array.from(entries.values()).sort((left, right) => left.employeeName.localeCompare(right.employeeName));
  }, [approvedLeaveEntries, scheduleLeaveEntries]);

  const allMarkedDutyOptions = useMemo<GridEmployee[]>(
    () => [...allShiftDutyEmployees]
      .sort((left, right) => {
        const leftName = left.full_name || left.employee_name || left.employee_id;
        const rightName = right.full_name || right.employee_name || right.employee_id;
        return leftName.localeCompare(rightName);
      })
      .map((employee) => ({
        id: employee.id,
        full_name: employee.full_name || employee.employee_name || employee.employee_id,
        designation: employee.designation,
      })),
    [allShiftDutyEmployees]
  );
  const markedDutyOptions = useMemo(
    () => allMarkedDutyOptions.filter((employee) => !assignedGridEmployeeIds.has(employee.id)),
    [allMarkedDutyOptions, assignedGridEmployeeIds]
  );
  const toSuggestionOptions = useCallback((employees: GridEmployee[]) => (
    employees.map((employee) => ({
      value: employee.id,
      label: `${employee.full_name}${employee.designation ? ` (${employee.designation})` : ''}`,
    }))
  ), []);
  const getRelieverOptions = useCallback((currentValue?: string | null): GridEmployee[] => {
    const visible = markedDutyOptions.filter((employee) => !assignedEmployeeIds.has(employee.id));
    if (!currentValue) return visible;

    const currentOption = allMarkedDutyOptions.find((employee) => namesMatch(employee.full_name, currentValue));
    if (!currentOption || visible.some((employee) => employee.id === currentOption.id)) {
      return visible;
    }

    return [currentOption, ...visible];
  }, [allMarkedDutyOptions, assignedEmployeeIds, markedDutyOptions]);

  const getAvailableEmployees = useCallback((currentEmployeeId?: string | null): GridEmployee[] => {
    return allMarkedDutyOptions.filter((e) => {
      if (e.id === currentEmployeeId) return true;
      if (assignedEmployeeIds.has(e.id)) return false;
      return true;
    });
  }, [allMarkedDutyOptions, assignedEmployeeIds]);

  const getAssignment = useCallback((positionKey: string, department: string) =>
    assignments.find((a) => a.position_name === positionKey && a.department === department),
    [assignments]);

  const handleAssign = useCallback((positionKey: string, department: string, employeeId: string | null) => {
    if (!roster) return;
    const existing = assignments.find((a) => a.position_name === positionKey && a.department === department);
    upsertAssignment.mutate({
      id: existing?.id,
      roster_id: roster.id,
      position_name: positionKey,
      position_label: positionLabels[positionKey],
      department,
      employee_id: employeeId,
      remark: existing?.remark,
      section_type: POSITION_ROWS.find((p) => p.key === positionKey)?.sectionType || 'sector',
    });
  }, [roster, assignments, positionLabels, upsertAssignment]);

  const handleRemarkChange = useCallback((positionKey: string, department: string, remark: string) => {
    if (!roster) return;
    const existing = assignments.find((a) => a.position_name === positionKey && a.department === department);
    if (existing) {
      upsertAssignment.mutate({ id: existing.id, roster_id: roster.id, position_name: positionKey, department, employee_id: existing.employee_id, remark, section_type: existing.section_type });
    }
  }, [roster, assignments, upsertAssignment]);

  const sections = useMemo(() => {
    const rows = isNight
      ? POSITION_ROWS
      : POSITION_ROWS.filter((r) => !r.nightOnly);

    const grouped: { label: string; color: string; rows: typeof POSITION_ROWS }[] = [];
    let cs = '';
    rows.forEach((row) => {
      if (row.sectionLabel !== cs) { cs = row.sectionLabel; grouped.push({ label: cs, color: row.sectionColor, rows: [] }); }
      grouped[grouped.length - 1].rows.push(row);
    });
    return grouped;
  }, [isNight]);

  const activeDepts = isNight ? ALL_NIGHT_DEPARTMENTS : DEPARTMENTS;
  const activeRows = isNight ? POSITION_ROWS : POSITION_ROWS.filter((r) => !r.nightOnly);
  const markedCount = assignments.filter((a) => a.employee_id).length;
  const totalPositions = activeRows.length * activeDepts.length;
  const schedulePoolCount = scheduleLinkedEmployees.length;
  const totalMarkedDutyEmployees = useMemo(
    () => [...allShiftDutyEmployees].sort((left, right) => {
      const leftName = left.full_name || left.employee_name || left.employee_id;
      const rightName = right.full_name || right.employee_name || right.employee_id;
      return leftName.localeCompare(rightName);
    }),
    [allShiftDutyEmployees]
  );
  const allottedDutyCount = useMemo(
    () => totalMarkedDutyEmployees.filter((employee) => assignedGridEmployeeIds.has(employee.id)).length,
    [totalMarkedDutyEmployees, assignedGridEmployeeIds]
  );
  const shiftDutyEmployees = useMemo(
    () => totalMarkedDutyEmployees.filter((employee) => !assignedGridEmployeeIds.has(employee.id)),
    [totalMarkedDutyEmployees, assignedGridEmployeeIds]
  );
  const availabilitySummaryRows = useMemo(
    () => AVAILABILITY_CATEGORIES.map((category) => {
      const count = (() => {
        if (category === 'CHANGE FROM NORMAL DUTY') return dutyChangeEntries.length;
        if (category === 'LEAVE') return resolvedLeaveEntries.length;

        return teamScheduleMembers.filter((member) => {
          const rating = normalizeUpper(member.highest_rating);
          const designation = normalizeUpper(member.designation);
          const dutyCode = normalizeUpper(member.duty_code);
          const dutyDescription = normalizeUpper(member.duty_description);

          switch (category) {
            case 'RSR+UBN':
              return rating === 'RSR+UBN';
            case 'RSR':
              return rating === 'RSR' || (rating.startsWith('RSR+') && rating !== 'RSR+UBN');
            case 'ASR+RSR':
              return rating === 'ASR+RSR';
            case 'ASR+APP':
              return rating === 'ASR+APP';
            case 'ACC-PLR':
              return rating === 'ACC-PLR';
            case 'OCC+ACC-PLR':
              return rating === 'OCC+ACC-PLR';
            case 'ADC+ACC-PLR':
              return rating === 'ADC+ACC-PLR';
            case 'ACC-PLR+ACC-P':
              return rating === 'ACC-PLR+ACC-P';
            case 'ADC+ACC-P':
              return rating === 'ADC+ACC-P';
            case 'ACC-P+OCC':
              return rating === 'ACC-P+OCC';
            case 'OCC':
              return rating === 'OCC';
            case 'ADC/SMC':
              return rating === 'ADC/SMC' || rating === 'ADC' || rating === 'SMC';
            case 'ALPHA':
              return rating === 'ALPHA' || designation.includes('ALPHA');
            case 'TOUR':
              return dutyCode === 'T' || dutyDescription.includes('TOUR');
            case 'TRAINING':
              return dutyCode === 'TR' || dutyDescription.includes('TRAINING');
            case 'GENERAL DUTY':
              return dutyCode === 'G' || dutyDescription.includes('GENERAL');
            case 'SAR / AIS':
              return rating === 'SAR' || rating === 'AIS' || designation.includes('SAR') || designation.includes('AIS');
            default:
              return false;
          }
        }).length;
      })();

      return { category, count };
    }),
    [dutyChangeEntries.length, resolvedLeaveEntries.length, teamScheduleMembers]
  );

  return (
    <DashboardLayout role="wso">
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">WSO – Shift Duty Grid</h1>
          <p className="text-muted-foreground">Assign employees to positions</p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-4">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-[200px] justify-start text-left')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(date, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <Select value={shift} onValueChange={setShift}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ATC_SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Badge variant="outline">Team {team || '—'}</Badge>
              <Button variant="outline" size="sm" onClick={() => refetchEdge()} disabled={edgeLoading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${edgeLoading ? 'animate-spin' : ''}`} /> Sync
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={!team || syncFromRoster.isPending}
                onClick={async () => {
                  if (!team) { toast.error('Select a team first'); return; }
                  try {
                    const result = await syncFromRoster.mutateAsync({ date: dateStr, shift, team });
                    const msg = `Synced ${result.synced} assignments` + (result.compOffsGenerated ? ` • ${result.compOffsGenerated} comp-offs generated` : '');
                    if (result.unmatched.length > 0) {
                      toast.warning(`${msg}. ${result.unmatched.length} names unmatched: ${result.unmatched.join(', ')}`);
                    } else if (result.qualificationWarnings && result.qualificationWarnings.length > 0) {
                      toast.warning(`${msg}. ⚠ ${result.qualificationWarnings.length} license warning(s)`);
                    } else {
                      toast.success(msg);
                    }
                  } catch (err: any) {
                    toast.error(err.message || 'Sync failed');
                  }
                }}
              >
                <DatabaseZap className={`h-4 w-4 mr-1 ${syncFromRoster.isPending ? 'animate-pulse' : ''}`} />
                Sync from Roster
              </Button>
              <Badge variant="outline">Schedule Pool: {team ? schedulePoolCount : 0}</Badge>
              <div className="ml-auto">
                <Badge variant="secondary">Marked: {markedCount}/{totalPositions}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardContent className="p-0">
              {isNight ? (
                <NightDutyGrid
                  sections={sections}
                  canEdit={true}
                  positionLabels={positionLabels}
                  setPositionLabels={setPositionLabels}
                  getAssignment={getAssignment}
                  getAvailableEmployees={getAvailableEmployees}
                  handleAssign={handleAssign}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted">
                        <th className="px-3 py-2 text-left font-semibold w-[180px] border-r">Position</th>
                        {DEPARTMENTS.map((dept) => (
                          <th key={dept} colSpan={2} className="px-3 py-2 text-center font-semibold border-r last:border-r-0">{dept}</th>
                        ))}
                      </tr>
                      <tr className="border-b bg-muted/50">
                        <th className="border-r" />
                        {DEPARTMENTS.map((dept) => (
                          <React.Fragment key={dept}>
                            <th className="px-2 py-1 text-center text-xs font-medium text-muted-foreground">Name</th>
                            <th className="px-2 py-1 text-center text-xs font-medium text-muted-foreground border-r last:border-r-0">Reliever</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sections.map((section) => (
                        <React.Fragment key={section.label}>
                          <tr>
                            <td colSpan={1 + DEPARTMENTS.length * 2} className="px-3 py-1.5 font-semibold text-xs uppercase tracking-wide text-white" style={{ backgroundColor: section.color }}>
                              {section.label}
                            </td>
                          </tr>
                          {section.rows.map((row, rowIndex) => (
                            <tr
                              key={row.key}
                              className={cn(
                                "border-b transition-colors",
                                rowIndex % 2 === 0
                                  ? "bg-white dark:bg-slate-900/35"
                                  : "bg-slate-100/70 dark:bg-slate-800/45",
                                "hover:bg-blue-100/60 dark:hover:bg-blue-900/30"
                              )}
                            >
                              <td className="px-3 py-1.5 border-r font-medium">
                                {row.editable ? (
                                  <Input value={positionLabels[row.key] ?? row.label} onChange={(e) => setPositionLabels((prev) => ({ ...prev, [row.key]: e.target.value }))} className="h-7 text-xs border-dashed" />
                                ) : (
                                  <span>{row.label}</span>
                                )}
                              </td>
                              {!isNight && (row.sectionType === 'tower' || row.sectionType === 'info' || row.sectionType === 'flow') ? (
                                <>
                                  {DEPARTMENTS.slice(0, row.sectionType === 'flow' ? 3 : 2).map((dept) => {
                                    const assignment = getAssignment(row.key, dept);
                                    const available = getAvailableEmployees(assignment?.employee_id);
                                    return (
                                      <td key={dept} colSpan={row.sectionType === 'flow' ? 2 : 3} className="px-1 py-1">
                                        <div className={cn('rounded-md', assignment?.employee_id && 'bg-emerald-50 dark:bg-emerald-950/30')}>
                                          <SuggestionInput
                                            value={assignment?.employee_id || '_none'}
                                            onChange={(val) => handleAssign(row.key, dept, val === '_none' ? null : val)}
                                            options={toSuggestionOptions(available)}
                                            placeholder="Type employee..."
                                          />
                                        </div>
                                      </td>
                                    );
                                  })}
                                </>
                              ) : (
                                <>
                                  {DEPARTMENTS.slice(0, row.deptCount || 3).map((dept) => {
                                    const assignment = getAssignment(row.key, dept);
                                    const available = getAvailableEmployees(assignment?.employee_id);
                                    return (
                                      <React.Fragment key={dept}>
                                        <td className="px-1 py-1 min-w-[160px]">
                                          <div className={cn('rounded-md', assignment?.employee_id && 'bg-emerald-50 dark:bg-emerald-950/30')}>
                                            <SuggestionInput
                                              value={assignment?.employee_id || '_none'}
                                              onChange={(val) => handleAssign(row.key, dept, val === '_none' ? null : val)}
                                              options={toSuggestionOptions(available)}
                                              placeholder="Type employee..."
                                            />
                                          </div>
                                        </td>
                                        <td className="px-1 py-1 min-w-[160px] border-r last:border-r-0">
                                          {row.hasReliever ? (
                                            <div className={cn('rounded-md', assignment?.remark && assignment.remark !== '' && 'bg-sky-50 dark:bg-sky-950/30')}>
                                              <SuggestionInput
                                                value={assignment?.remark || '_none'}
                                                onChange={(val) => handleRemarkChange(row.key, dept, val === '_none' ? '' : val)}
                                                options={getRelieverOptions(assignment?.remark).map((emp) => ({
                                                  value: emp.full_name || emp.id,
                                                  label: `${emp.full_name}${emp.designation ? ` (${emp.designation})` : ''}`,
                                                }))}
                                                placeholder="Type reliever..."
                                              />
                                            </div>
                                          ) : (
                                            <Input className="h-7 w-full text-xs" placeholder="Remark" defaultValue={assignment?.remark || ''} onBlur={(e) => handleRemarkChange(row.key, dept, e.target.value)} />
                                          )}
                                        </td>
                                      </React.Fragment>
                                    );
                                  })}
                                  {(row.deptCount && row.deptCount < 3) && (
                                    <td colSpan={(3 - row.deptCount) * 2} className="bg-muted/20 border-r last:border-r-0" />
                                  )}
                                </>
                              )}
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                {team
                  ? teamScheduleLoading
                    ? `Loading schedule for ${format(date, 'dd MMM yyyy')}...`
                    : `Showing employees from Team ${team} whose schedule on ${format(date, 'dd MMM yyyy')} matches ${shift}.`
                  : 'Loading the WSO team schedule-linked employee pool for this date.'}
              </div>
            </CardContent>
          </Card>

          <Card className="xl:sticky xl:top-4 self-start">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                Marked Duty List
                <Badge variant="secondary">{shiftDutyEmployees.length} left</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {`${shift} • ${format(date, 'dd MMM yyyy')}`}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Total Marked</p>
                  <p className="text-lg font-semibold">{totalMarkedDutyEmployees.length}</p>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Employees Allotted</p>
                  <p className="text-lg font-semibold">{allottedDutyCount}</p>
                </div>
              </div>
              <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1">
                {!selectedShiftCode ? (
                  <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    Select a shift to view employees marked for duty.
                  </p>
                ) : teamScheduleLoading ? (
                  <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    Loading employees for the selected date and shift...
                  </p>
                ) : totalMarkedDutyEmployees.length === 0 ? (
                  <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    No employees are marked for this shift on the selected date.
                  </p>
                ) : shiftDutyEmployees.length === 0 ? (
                  <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    All marked-duty employees have already been allotted in the shift duty grid.
                  </p>
                ) : (
                  shiftDutyEmployees.map((employee) => (
                    <div key={`${employee.employee_id}-${employee.duty_code}`} className="rounded-lg border bg-white px-2.5 py-2 dark:bg-slate-900/35">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">
                          {employee.full_name || employee.employee_name || employee.employee_id}
                        </p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="secondary" className="px-2 py-0 text-[10px]">
                            {employee.duty_code || shift}
                          </Badge>
                          <Badge variant="outline" className="px-2 py-0 text-[10px]">
                          {employee.highest_rating || '—'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bottom Status Tables (Side by Side) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-8">
          {/* Duty Change Table */}
          <Card>
            <CardHeader className="py-3 bg-muted/50">
              <CardTitle className="text-sm font-semibold">Duty Change</CardTitle>
            </CardHeader>
            <CardContent className="pt-3 pb-3">
              <div className="divide-y text-sm">
                {dutyChangeEntries.map((entry, idx) => (
                  <div key={entry.id || idx} className="py-2 flex justify-between">
                    <span className="font-medium">{entry.employee_name}</span>
                    <span className="text-muted-foreground ml-2">{entry.position}</span>
                  </div>
                ))}
                {dutyChangeEntries.length === 0 && (
                  <div className="py-2 text-center text-muted-foreground">No duty changes</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Extra Duty Table */}
          <Card>
            <CardHeader className="py-3 bg-muted/50">
              <CardTitle className="text-sm font-semibold">Extra Duty</CardTitle>
            </CardHeader>
            <CardContent className="pt-3 pb-3">
              <div className="divide-y text-sm">
                {shiftExtraDutyMembers.map((entry) => (
                  <div key={`schedule-${entry.id}`} className="py-2 flex justify-between items-center">
                    <span className="font-medium">
                      {entry.full_name || entry.employee_name || 'Unknown'}
                      {entry.designation ? ` (${entry.designation})` : ''}
                    </span>
                    <Badge variant="outline" className="font-normal text-[10px] uppercase ml-2">
                      {entry.duty_code}
                    </Badge>
                  </div>
                ))}
                {shiftExtraDutyMembers.length === 0 && (
                  <div className="py-2 text-center text-muted-foreground">No extra duties</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Leave Table */}
          <Card>
            <CardHeader className="py-3 bg-muted/50">
              <CardTitle className="text-sm font-semibold text-destructive">Leave</CardTitle>
            </CardHeader>
            <CardContent className="pt-3 pb-3">
              <div className="divide-y text-sm">
                {resolvedLeaveEntries.map((entry) => (
                  <div key={entry.key} className="py-2 flex justify-between items-center">
                    <span>{entry.employeeName} {entry.designation ? `(${entry.designation})` : ''}</span>
                    <Badge variant="secondary" className="font-normal text-[10px] uppercase ml-2">
                      {entry.label}
                    </Badge>
                  </div>
                ))}
                {resolvedLeaveEntries.length === 0 && (
                  <div className="py-2 text-center text-muted-foreground">No one on leave</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 bg-muted/50">
              <CardTitle className="text-sm font-semibold">AVAIL. ATCOs</CardTitle>
            </CardHeader>
            <CardContent className="pt-3 pb-3">
              {!team ? (
                <div className="py-2 text-center text-muted-foreground text-sm">Loading WSO team rating counts</div>
              ) : (
                <div className="divide-y text-sm">
                  {availabilitySummaryRows.map((row) => (
                    <div key={row.category} className="py-2 flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{row.category}</span>
                      <Badge variant="outline" className="shrink-0">{row.count}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
