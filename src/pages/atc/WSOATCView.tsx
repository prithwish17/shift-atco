import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
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
  useGridLeaveRecords,
  useGridExtraDuties,
  useGridEmployees,
  useSyncRosterToGrid,
  useRosterStatusEntries,
} from '@/hooks/useDutyGrid';
import { useATCAssignments } from '@/hooks/useATCAssignments';
import type { GridEmployee } from '@/hooks/useDutyGrid';

export default function WSOATCView() {
  const [date, setDate] = useState<Date>(new Date());
  const [shift, setShift] = useState('Morning');
  const [team, setTeam] = useState('');
  const [positionLabels, setPositionLabels] = useState<Record<string, string>>({});

  const isNight = shift === 'Night';

  const dateStr = format(date, 'yyyy-MM-dd');
  const { refetch: refetchEdge, isLoading: edgeLoading } = useATCAssignments(dateStr, shift || undefined);

  const { data: employees = [] } = useGridEmployees();
  const { data: roster, isLoading: rosterLoading } = useDutyRoster(date, shift);
  const createOrGetRoster = useCreateOrGetRoster();
  const { data: assignments = [] } = useRosterAssignments(roster?.id);
  const upsertAssignment = useUpsertAssignment();
  const { data: leaveRecords = [] } = useGridLeaveRecords(date);
  const { data: extraDuties = [] } = useGridExtraDuties(roster?.id);
  const syncFromRoster = useSyncRosterToGrid();

  // Fetch roster entries with DUTY CHANGE / EXTRA DUTY from Google Sheets
  const { data: statusEntries = [] } = useRosterStatusEntries(date, shift, team);
  const dutyChangeEntries = statusEntries.filter(e => e.unit?.toUpperCase() === 'DUTY CHANGE');
  const extraDutyEntries = statusEntries.filter(e => e.unit?.toUpperCase() === 'EXTRA DUTY');

  // Auto-create roster only after query confirms none exists
  useEffect(() => {
    if (!rosterLoading && !roster && !createOrGetRoster.isPending) {
      createOrGetRoster.mutate({ date: format(date, 'yyyy-MM-dd'), shift, team: team || undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, shift, rosterLoading]);

  const assignedEmployeeIds = useMemo(() => {
    const ids = new Set<string>();
    assignments.forEach((a) => { if (a.employee_id) ids.add(a.employee_id); });
    extraDuties.forEach((d) => { if (d.employee_id) ids.add(d.employee_id); });
    return ids;
  }, [assignments, extraDuties]);

  const unavailableIds = useMemo(() => {
    const ids = new Set<string>();
    leaveRecords.forEach((l) => ids.add(l.employee_id));
    return ids;
  }, [leaveRecords]);

  const getAvailableEmployees = useCallback((currentEmployeeId?: string | null): GridEmployee[] => {
    return employees.filter((e) => {
      if (unavailableIds.has(e.id)) return false;
      if (e.id === currentEmployeeId) return true;
      if (assignedEmployeeIds.has(e.id)) return false;
      return true;
    });
  }, [employees, unavailableIds, assignedEmployeeIds]);

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

  return (
    <DashboardLayout role="wso">
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">WSO – ATC Duty Grid</h1>
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
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Team" /></SelectTrigger>
                <SelectContent>
                  {['A', 'B', 'C', 'D', 'E'].map((t) => (
                    <SelectItem key={t} value={t}>Team {t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                    const msg = `Synced ${result.synced} assignments`;
                    if (result.unmatched.length > 0) {
                      toast.warning(`${msg}. ${result.unmatched.length} names unmatched: ${result.unmatched.join(', ')}`);
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
              <div className="ml-auto">
                <Badge variant="secondary">Marked: {markedCount}/{totalPositions}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

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
                        {section.rows.map((row) => (
                          <tr key={row.key} className="border-b hover:bg-accent/30">
                            <td className="px-3 py-1.5 border-r font-medium">
                              {row.editable ? (
                                <Input value={positionLabels[row.key] ?? row.label} onChange={(e) => setPositionLabels((prev) => ({ ...prev, [row.key]: e.target.value }))} className="h-7 text-xs border-dashed" />
                              ) : (
                                <span>{row.label}</span>
                              )}
                            </td>
                            {/* Tower/Info/Flow rows in day shift: full-width dropdowns, no remark */}
                            {!isNight && (row.sectionType === 'tower' || row.sectionType === 'info' || row.sectionType === 'flow') ? (
                              <>
                                {DEPARTMENTS.slice(0, row.sectionType === 'flow' ? 3 : 2).map((dept) => {
                                  const assignment = getAssignment(row.key, dept);
                                  const available = getAvailableEmployees(assignment?.employee_id);
                                  return (
                                    <td key={dept} colSpan={row.sectionType === 'flow' ? 2 : 3} className="px-1 py-1">
                                      <Select value={assignment?.employee_id || '_none'} onValueChange={(val) => handleAssign(row.key, dept, val === '_none' ? null : val)}>
                                        <SelectTrigger className={cn('h-7 text-xs', assignment?.employee_id && 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800')}><SelectValue placeholder="Select..." /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="_none">— None —</SelectItem>
                                          {available.map((emp) => (
                                            <SelectItem key={emp.id} value={emp.id}>{emp.full_name}{emp.designation ? ` (${emp.designation})` : ''}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
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
                                      <td className="px-1 py-1 min-w-[140px]">
                                        <Select value={assignment?.employee_id || '_none'} onValueChange={(val) => handleAssign(row.key, dept, val === '_none' ? null : val)}>
                                          <SelectTrigger className={cn('h-7 text-xs', assignment?.employee_id && 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800')}><SelectValue placeholder="Select..." /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="_none">— None —</SelectItem>
                                            {available.map((emp) => (
                                              <SelectItem key={emp.id} value={emp.id}>{emp.full_name}{emp.designation ? ` (${emp.designation})` : ''}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </td>
                                      <td className="px-1 py-1 min-w-[140px] border-r last:border-r-0">
                                        {row.hasReliever ? (
                                          <Select value={assignment?.remark || '_none'} onValueChange={(val) => handleRemarkChange(row.key, dept, val === '_none' ? '' : val)}>
                                            <SelectTrigger className={cn('h-7 text-xs', assignment?.remark && assignment.remark !== '' && 'bg-sky-50 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800')}><SelectValue placeholder="Reliever..." /></SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="_none">— None —</SelectItem>
                                              {(employees || []).map((emp: any) => (
                                                <SelectItem key={emp.id} value={emp.full_name || emp.id}>{emp.full_name}{emp.designation ? ` (${emp.designation})` : ''}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        ) : (
                                          <Input className="h-7 text-xs" placeholder="Remark" defaultValue={assignment?.remark || ''} onBlur={(e) => handleRemarkChange(row.key, dept, e.target.value)} />
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
          </CardContent>
        </Card>

        {/* Bottom Status Tables (Side by Side) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
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
                {extraDutyEntries.map((entry, idx) => (
                  <div key={entry.id || idx} className="py-2 flex justify-between items-center">
                    <span className="font-medium">{entry.employee_name}</span>
                    <span className="text-muted-foreground ml-2">{entry.position}</span>
                  </div>
                ))}
                {extraDuties.map((duty) => (
                  <div key={duty.id} className="py-2 flex justify-between items-center">
                    <span>{duty.profiles?.full_name || '(unassigned)'} {duty.remarks ? <span className="text-muted-foreground ml-1">— {duty.remarks}</span> : null}</span>
                    <Badge variant="outline" className="font-normal text-[10px] uppercase ml-2">{duty.duty_type}</Badge>
                  </div>
                ))}
                {extraDutyEntries.length === 0 && extraDuties.length === 0 && (
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
                {leaveRecords.map((l) => (
                  <div key={l.id} className="py-2 flex justify-between items-center">
                    <span>{l.profiles?.full_name || 'Unknown'} {l.profiles?.designation ? `(${l.profiles.designation})` : ''}</span>
                    <Badge variant="secondary" className="font-normal text-[10px] uppercase ml-2">{l.leave_type}</Badge>
                  </div>
                ))}
                {leaveRecords.length === 0 && (
                  <div className="py-2 text-center text-muted-foreground">No one on leave</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
