import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEPARTMENTS, POSITION_ROWS, ATC_SHIFTS, ALL_NIGHT_DEPARTMENTS } from '@/lib/atcConstants';
import { NightDutyGrid } from '@/components/NightDutyGrid';
import {
  useDutyRoster,
  useRosterAssignments,
  useGridLeaveRecords,
  useGridExtraDuties,
} from '@/hooks/useDutyGrid';
import { useATCAssignments } from '@/hooks/useATCAssignments';

export default function EmployeeATCDuties() {
  const [date, setDate] = useState<Date>(new Date());
  const [shift, setShift] = useState('Morning');
  const [team, setTeam] = useState('');
  const [positionLabels, setPositionLabels] = useState<Record<string, string>>({});

  const isNight = shift === 'Night';

  const dateStr = format(date, 'yyyy-MM-dd');
  const { isLoading: edgeLoading, refetch: refetchEdge } = useATCAssignments(dateStr, shift || undefined);

  const { data: roster } = useDutyRoster(date, shift, team);
  const { data: assignments = [] } = useRosterAssignments(roster?.id);
  const { data: leaveRecords = [] } = useGridLeaveRecords(date);
  const { data: extraDuties = [] } = useGridExtraDuties(roster?.id);

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

  const getAssignment = (positionKey: string, department: string) =>
    assignments.find((a) => a.position_name === positionKey && a.department === department);

  const activeDepts = isNight ? ALL_NIGHT_DEPARTMENTS : DEPARTMENTS;
  const activeRows = isNight ? POSITION_ROWS : POSITION_ROWS.filter((r) => !r.nightOnly);
  const markedCount = assignments.filter((a) => a.employee_id).length;
  const totalPositions = activeRows.length * activeDepts.length;

  // Stub handleAssign for read-only NightDutyGrid
  const handleAssign = () => { };

  return (
    <DashboardLayout role="employee">
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Shift Duty Grid</h1>
          <p className="text-muted-foreground">View position assignments for each shift</p>
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
                canEdit={false}
                positionLabels={positionLabels}
                setPositionLabels={setPositionLabels}
                getAssignment={getAssignment}
                getAvailableEmployees={() => []}
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
                          <th className="px-2 py-1 text-center text-xs font-medium text-muted-foreground border-r last:border-r-0">Remark</th>
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
                            <td className="px-3 py-1.5 border-r font-medium">{row.label}</td>
                            {DEPARTMENTS.slice(0, row.deptCount || 3).map((dept) => {
                              const assignment = getAssignment(row.key, dept);
                              return (
                                <React.Fragment key={dept}>
                                  <td className="px-2 py-1.5">
                                    <span className="text-xs">{assignment?.profiles?.full_name || '—'}</span>
                                  </td>
                                  <td className="px-2 py-1.5 border-r last:border-r-0">
                                    <span className="text-xs text-muted-foreground">
                                      {row.hasReliever ? (assignment?.remark ? `↔ ${assignment.remark}` : '—') : (assignment?.remark || '')}
                                    </span>
                                  </td>
                                </React.Fragment>
                              );
                            })}
                            {(row.deptCount && row.deptCount < 3) && (
                              <td colSpan={(3 - row.deptCount) * 2} className="bg-muted/20 border-r last:border-r-0" />
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

        {/* Extra Duties - read-only */}
        {extraDuties.length > 0 && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Extra Duties</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="divide-y">
                {extraDuties.map((duty) => (
                  <div key={duty.id} className="py-2 text-sm flex gap-4">
                    <Badge variant="outline">{duty.duty_type}</Badge>
                    <span>{duty.profiles?.full_name || '(unassigned)'}</span>
                    {duty.remarks && <span className="text-muted-foreground">{duty.remarks}</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-destructive">On Leave — {format(date, 'dd MMM yyyy')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y">
              {leaveRecords.map((l) => (
                <div key={l.id} className="py-2 text-sm flex justify-between">
                  <span>{l.profiles?.full_name}{l.profiles?.designation ? ` (${l.profiles.designation})` : ''}</span>
                  <Badge variant="secondary">{l.leave_type}</Badge>
                </div>
              ))}
              {leaveRecords.length === 0 && <div className="py-4 text-center text-muted-foreground text-sm">No one on leave</div>}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
