import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Search, FileDown, Plus, Trash2, RefreshCw, DatabaseZap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { DEPARTMENTS, POSITION_ROWS, ATC_SHIFTS, EXTRA_DUTY_TYPES } from '@/lib/atcConstants';
import { NightDutyGrid } from '@/components/NightDutyGrid';
import { GridCellSelect, GridCellReliever, PositionLabelCell } from '@/components/GridCell';
import { useATCGridState } from '@/hooks/useATCGridState';

type PositionRowType = (typeof POSITION_ROWS)[number];

interface ATCDutyGridCoreProps {
    role: 'admin' | 'supervisor' | 'wso' | 'employee';
    title: string;
    subtitle: string;
    showSearch?: boolean;
    canEdit: boolean;
    canManageExtraDuties: boolean;
}

// --------------- Memoized grid row ---------------

interface GridRowProps {
    row: PositionRowType;
    rowIndex: number;
    canEdit: boolean;
    isNight: boolean;
    getAssignment: ReturnType<typeof useATCGridState>['getAssignment'];
    getAvailableEmployees: ReturnType<typeof useATCGridState>['getAvailableEmployees'];
    handleAssign: ReturnType<typeof useATCGridState>['handleAssign'];
    handleRemarkChange: ReturnType<typeof useATCGridState>['handleRemarkChange'];
    employees: ReturnType<typeof useATCGridState>['employees'];
    positionLabels: Record<string, string>;
    setPositionLabels: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    assignmentMap: Map<string, any>;
}

const GridRow = React.memo(function GridRow({
    row, rowIndex, canEdit, isNight,
    getAssignment, getAvailableEmployees, handleAssign, handleRemarkChange,
    employees, positionLabels, setPositionLabels, assignmentMap,
}: GridRowProps) {
    const isWideLayout = !isNight && (row.sectionType === 'tower' || row.sectionType === 'info' || row.sectionType === 'flow');

    return (
        <tr
            className={cn(
                "border-b transition-colors",
                rowIndex % 2 === 0
                    ? "bg-white dark:bg-slate-900/35"
                    : "bg-slate-100/70 dark:bg-slate-800/45",
                "hover:bg-blue-100/60 dark:hover:bg-blue-900/30"
            )}
        >
            <PositionLabelCell
                rowKey={row.key}
                label={row.label}
                editable={row.editable}
                canEdit={canEdit}
                positionLabels={positionLabels}
                setPositionLabels={setPositionLabels}
            />

            {isWideLayout ? (
                <>
                    {DEPARTMENTS.slice(0, row.sectionType === 'flow' ? 3 : 2).map((dept) => {
                        const assignment = getAssignment(row.key, dept);
                        const available = getAvailableEmployees(assignment?.employee_id);
                        return (
                            <GridCellSelect
                                key={dept}
                                positionKey={row.key}
                                department={dept}
                                assignment={assignment}
                                availableEmployees={available}
                                canEdit={canEdit}
                                onAssign={handleAssign}
                                colSpan={row.sectionType === 'flow' ? 2 : 3}
                            />
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
                                <GridCellSelect
                                    positionKey={row.key}
                                    department={dept}
                                    assignment={assignment}
                                    availableEmployees={available}
                                    canEdit={canEdit}
                                    onAssign={handleAssign}
                                    className="min-w-[140px]"
                                />
                                <GridCellReliever
                                    positionKey={row.key}
                                    department={dept}
                                    assignment={assignment}
                                    hasReliever={!!row.hasReliever}
                                    canEdit={canEdit}
                                    allEmployees={employees}
                                    onRemarkChange={handleRemarkChange}
                                />
                            </React.Fragment>
                        );
                    })}
                    {(row.deptCount && row.deptCount < 3) && (
                        <td colSpan={(3 - row.deptCount) * 2} className="bg-muted/20 border-r last:border-r-0" />
                    )}
                </>
            )}
        </tr>
    );
}, (prev, next) => {
    if (prev.canEdit !== next.canEdit) return false;
    if (prev.rowIndex !== next.rowIndex) return false;
    if (prev.row.key !== next.row.key) return false;
    if (prev.isNight !== next.isNight) return false;

    // Check if any assignment for this row's departments changed
    const depts = DEPARTMENTS.slice(0, prev.row.deptCount || 3);
    for (const dept of depts) {
        const key = `${prev.row.key}::${dept}`;
        const prevA = prev.assignmentMap.get(key);
        const nextA = next.assignmentMap.get(key);
        if (prevA?.employee_id !== nextA?.employee_id) return false;
        if (prevA?.remark !== nextA?.remark) return false;
    }

    // Position label
    if (prev.row.editable && prev.positionLabels[prev.row.key] !== next.positionLabels[next.row.key]) return false;

    return true;
});

// --------------- Main component ---------------

export function ATCDutyGridCore({
    role,
    title,
    subtitle,
    showSearch = false,
    canEdit,
    canManageExtraDuties,
}: ATCDutyGridCoreProps) {
    const [search, setSearch] = useState('');

    const grid = useATCGridState({ canEdit });

    const {
        date, setDate, shift, setShift, team, setTeam,
        positionLabels, setPositionLabels,
        isNight, dateStr,
        employees, roster,
        assignments, assignmentMap,
        leaveRecords, extraDuties,
        dutyChangeEntries, extraDutyEntries,
        createExtraDuty, deleteExtraDuty,
        syncFromRoster, refetchEdge, edgeLoading,
        getAvailableEmployees, getAssignment,
        handleAssign, handleRemarkChange,
        sections, markedCount, totalPositions,
    } = grid;

    // Search filter (optional)
    const filteredSections = useMemo(() => {
        if (!showSearch || !search.trim()) return sections;
        const q = search.toLowerCase();
        return sections.map(section => ({
            ...section,
            rows: section.rows.filter(row => {
                if (row.label.toLowerCase().includes(q)) return true;
                for (const dept of DEPARTMENTS.slice(0, row.deptCount || 3)) {
                    const a = assignmentMap.get(`${row.key}::${dept}`);
                    if (a?.profiles?.full_name?.toLowerCase().includes(q)) return true;
                }
                return false;
            }),
        })).filter(s => s.rows.length > 0);
    }, [sections, showSearch, search, assignmentMap]);

    return (
        <div className="space-y-4">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
                <p className="text-muted-foreground">{subtitle}</p>
            </div>

            {/* Controls */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex flex-wrap items-center gap-4">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className={cn('w-[200px] justify-start text-left', !date && 'text-muted-foreground')}>
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

                        {showSearch && (
                            <div className="relative w-[220px]">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input placeholder="Search position or name…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
                            </div>
                        )}

                        {canEdit && (
                            <Select value={team} onValueChange={setTeam}>
                                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Team" /></SelectTrigger>
                                <SelectContent>
                                    {['A', 'B', 'C', 'D', 'E'].map((t) => (
                                        <SelectItem key={t} value={t}>Team {t}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}

                        <Button variant="outline" size="sm" onClick={() => refetchEdge()} disabled={edgeLoading}>
                            <RefreshCw className={`h-4 w-4 mr-1 ${edgeLoading ? 'animate-spin' : ''}`} /> Sync
                        </Button>

                        {canEdit && (
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
                        )}

                        <div className="ml-auto flex items-center gap-3">
                            <Badge variant="secondary" className="text-sm">
                                Marked: {markedCount} / {totalPositions}
                            </Badge>
                            <Button variant="outline" size="sm" onClick={() => toast.info('PDF export coming soon')}>
                                <FileDown className="h-4 w-4 mr-1" /> PDF
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Main Grid */}
            <Card>
                <CardContent className="p-0">
                    {isNight ? (
                        <NightDutyGrid
                            sections={filteredSections}
                            canEdit={canEdit}
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
                                            <th key={dept} colSpan={2} className="px-3 py-2 text-center font-semibold border-r last:border-r-0">
                                                {dept}
                                            </th>
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
                                    {filteredSections.map((section) => (
                                        <React.Fragment key={section.label}>
                                            <tr>
                                                <td
                                                    colSpan={1 + DEPARTMENTS.length * 2}
                                                    className="px-3 py-1.5 font-semibold text-xs uppercase tracking-wide text-white"
                                                    style={{ backgroundColor: section.color }}
                                                >
                                                    {section.label}
                                                </td>
                                            </tr>
                                            {section.rows.map((row, rowIndex) => (
                                                <GridRow
                                                    key={row.key}
                                                    row={row}
                                                    rowIndex={rowIndex}
                                                    canEdit={canEdit}
                                                    isNight={isNight}
                                                    getAssignment={getAssignment}
                                                    getAvailableEmployees={getAvailableEmployees}
                                                    handleAssign={handleAssign}
                                                    handleRemarkChange={handleRemarkChange}
                                                    employees={employees}
                                                    positionLabels={positionLabels}
                                                    setPositionLabels={setPositionLabels}
                                                    assignmentMap={assignmentMap}
                                                />
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Extra Duties Section */}
            {canManageExtraDuties && (
                <Card>
                    <CardHeader className="py-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm">Extra Duties (OPE / Other)</CardTitle>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    if (!roster) { toast.error('Roster not ready'); return; }
                                    createExtraDuty.mutate({ roster_id: roster.id, duty_type: 'OPE' });
                                }}
                            >
                                <Plus className="h-4 w-4 mr-1" /> Add
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <div className="divide-y">
                            {extraDuties.map((duty) => (
                                <div key={duty.id} className="flex items-center gap-2 py-2">
                                    <Select value={duty.duty_type} onValueChange={() => { }}>
                                        <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {EXTRA_DUTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <Select value={duty.employee_id || '_none'} onValueChange={() => { }}>
                                        <SelectTrigger className="h-7 text-xs w-[200px]"><SelectValue placeholder="Select employee" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="_none">— None —</SelectItem>
                                            {getAvailableEmployees(duty.employee_id).map((emp) => (
                                                <SelectItem key={emp.id} value={emp.id}>{emp.full_name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Input className="h-7 text-xs flex-1" placeholder="Remarks" defaultValue={duty.remarks || ''} />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => deleteExtraDuty.mutate({ id: duty.id, rosterId: roster!.id })}
                                    >
                                        <Trash2 className="h-3 w-3 text-destructive" />
                                    </Button>
                                </div>
                            ))}
                            {extraDuties.length === 0 && (
                                <div className="py-4 text-center text-muted-foreground text-sm">No extra duties assigned</div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Status Tables */}
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
                            {assignments.filter(a => a.position_name.toUpperCase() === 'DUTY CHANGE').map((a) => (
                                <div key={a.id} className="py-2 flex justify-between">
                                    <span>{a.profiles?.full_name || a.remark || 'Unknown'} {a.profiles?.designation ? `(${a.profiles.designation})` : ''}</span>
                                    <span className="text-muted-foreground ml-2">{a.department}</span>
                                </div>
                            ))}
                            {dutyChangeEntries.length === 0 && assignments.filter(a => a.position_name.toUpperCase() === 'DUTY CHANGE').length === 0 && (
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
    );
}
