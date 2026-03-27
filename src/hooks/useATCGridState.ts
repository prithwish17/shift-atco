import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { POSITION_ROWS, DEPARTMENTS, ALL_NIGHT_DEPARTMENTS } from '@/lib/atcConstants';
import {
    useDutyRoster,
    useCreateOrGetRoster,
    useRosterAssignments,
    useUpsertAssignment,
    useGridLeaveRecords,
    useGridExtraDuties,
    useCreateExtraDuty,
    useDeleteExtraDuty,
    useGridEmployees,
    useSyncRosterToGrid,
    useRosterStatusEntries,
} from '@/hooks/useDutyGrid';
import { useATCAssignments } from '@/hooks/useATCAssignments';
import type { GridEmployee, RosterAssignment } from '@/hooks/useDutyGrid';

type PositionRowType = (typeof POSITION_ROWS)[number];

export interface GridSection {
    label: string;
    color: string;
    rows: PositionRowType[];
}

/**
 * Shared state hook for all ATC duty grid pages.
 * Encapsulates date/shift/team state, all grid queries, computed sets,
 * and action handlers with the optimized patterns from ATCDutyGrid.
 */
export function useATCGridState(options: {
    canEdit: boolean;
    enableEdgeFunc?: boolean;
}) {
    const { canEdit, enableEdgeFunc = false } = options;

    // --------------- State ---------------
    const [date, setDate] = useState<Date>(new Date());
    const [shift, setShift] = useState('Morning');
    const [team, setTeam] = useState('');
    const [positionLabels, setPositionLabels] = useState<Record<string, string>>({});

    const isNight = shift === 'Night';
    const dateStr = format(date, 'yyyy-MM-dd');

    // --------------- Queries ---------------
    const { isLoading: edgeLoading, refetch: refetchEdge } = useATCAssignments(dateStr, shift || undefined, enableEdgeFunc);
    const { data: employees = [] } = useGridEmployees();
    const { data: roster, isLoading: rosterLoading } = useDutyRoster(date, shift, team);
    const createOrGetRoster = useCreateOrGetRoster();
    const { data: assignments = [] } = useRosterAssignments(roster?.id);
    const upsertAssignment = useUpsertAssignment();
    const { data: leaveRecords = [] } = useGridLeaveRecords(date);
    const { data: extraDuties = [] } = useGridExtraDuties(roster?.id);
    const createExtraDuty = useCreateExtraDuty();
    const deleteExtraDuty = useDeleteExtraDuty();
    const syncFromRoster = useSyncRosterToGrid();

    // Status entries from Google Sheets
    const { data: statusEntries = [] } = useRosterStatusEntries(date, shift, team);
    const dutyChangeEntries = useMemo(
        () => statusEntries.filter((e) => e.unit?.toUpperCase() === 'DUTY CHANGE'),
        [statusEntries]
    );
    const extraDutyEntries = useMemo(
        () => statusEntries.filter((e) => e.unit?.toUpperCase() === 'EXTRA DUTY'),
        [statusEntries]
    );

    // --------------- Auto-create roster ---------------
    useEffect(() => {
        if (!rosterLoading && !roster && canEdit && team && !createOrGetRoster.isPending) {
            createOrGetRoster.mutate({ date: format(date, 'yyyy-MM-dd'), shift, team });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateStr, shift, team, rosterLoading]);

    // --------------- Computed sets ---------------
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

    // O(1) assignment lookups
    const assignmentMap = useMemo(() => {
        const map = new Map<string, RosterAssignment>();
        for (const a of assignments) {
            map.set(`${a.position_name}::${a.department}`, a);
        }
        return map;
    }, [assignments]);

    // Pre-compute available employees per current selection
    const baseAvailableEmployees = useMemo(
        () => employees.filter((e) => !unavailableIds.has(e.id) && !assignedEmployeeIds.has(e.id)),
        [employees, unavailableIds, assignedEmployeeIds]
    );

    const availableEmployeesByCurrentId = useMemo(() => {
        const currentIds = new Set<string>();
        assignments.forEach((a) => { if (a.employee_id) currentIds.add(a.employee_id); });
        extraDuties.forEach((d) => { if (d.employee_id) currentIds.add(d.employee_id); });

        const map = new Map<string, GridEmployee[]>();
        currentIds.forEach((currentId) => {
            map.set(
                currentId,
                employees.filter((e) => {
                    if (unavailableIds.has(e.id)) return false;
                    if (e.id === currentId) return true;
                    if (assignedEmployeeIds.has(e.id)) return false;
                    return true;
                })
            );
        });
        return map;
    }, [employees, unavailableIds, assignedEmployeeIds, assignments, extraDuties]);

    // --------------- Callbacks ---------------
    const getAvailableEmployees = useCallback((currentEmployeeId?: string | null): GridEmployee[] => {
        if (!currentEmployeeId) return baseAvailableEmployees;
        return availableEmployeesByCurrentId.get(currentEmployeeId) || baseAvailableEmployees;
    }, [availableEmployeesByCurrentId, baseAvailableEmployees]);

    const getAssignment = useCallback((positionKey: string, department: string) => {
        return assignmentMap.get(`${positionKey}::${department}`);
    }, [assignmentMap]);

    const handleAssign = useCallback((positionKey: string, department: string, employeeId: string | null, remark?: string) => {
        if (!roster) return;
        const existing = assignmentMap.get(`${positionKey}::${department}`);
        upsertAssignment.mutate({
            id: existing?.id,
            roster_id: roster.id,
            position_name: positionKey,
            position_label: positionLabels[positionKey] || undefined,
            department,
            employee_id: employeeId,
            remark: remark ?? existing?.remark,
            section_type: POSITION_ROWS.find((p) => p.key === positionKey)?.sectionType || 'sector',
        });
    }, [roster, assignmentMap, positionLabels, upsertAssignment]);

    const handleRemarkChange = useCallback((positionKey: string, department: string, remark: string) => {
        if (!roster) return;
        const existing = assignmentMap.get(`${positionKey}::${department}`);
        if (existing) {
            upsertAssignment.mutate({
                id: existing.id,
                roster_id: roster.id,
                position_name: positionKey,
                department,
                employee_id: existing.employee_id,
                remark,
                section_type: existing.section_type,
            });
        }
    }, [roster, assignmentMap, upsertAssignment]);

    // --------------- Sections ---------------
    const sections = useMemo((): GridSection[] => {
        let rows = isNight
            ? POSITION_ROWS.slice()
            : POSITION_ROWS.filter((r) => !r.nightOnly);

        // Hide empty editable sector rows in viewer mode for night shift
        if (isNight && !canEdit) {
            rows = rows.filter(row => {
                if (row.sectionType !== 'sector' || !row.editable) return true;
                return assignments.some(a => a.position_name === row.key && a.employee_id !== null);
            });
        }

        const grouped: GridSection[] = [];
        let currentSection = '';
        rows.forEach((row) => {
            if (row.sectionLabel !== currentSection) {
                currentSection = row.sectionLabel;
                grouped.push({ label: row.sectionLabel, color: row.sectionColor, rows: [] });
            }
            grouped[grouped.length - 1].rows.push(row);
        });
        return grouped.filter(g => g.rows.length > 0);
    }, [isNight, canEdit, assignments]);

    // --------------- Derived metrics ---------------
    const activeDepts = isNight ? ALL_NIGHT_DEPARTMENTS : DEPARTMENTS;
    const activeRows = isNight ? POSITION_ROWS : POSITION_ROWS.filter((r) => !r.nightOnly);
    const markedCount = assignments.filter((a) => a.employee_id).length;
    const totalPositions = activeRows.length * activeDepts.length;

    return {
        // State setters
        date, setDate, shift, setShift, team, setTeam,
        positionLabels, setPositionLabels,

        // Derived state
        isNight, dateStr,

        // Query data
        employees, roster, rosterLoading,
        assignments, assignmentMap,
        leaveRecords, extraDuties,
        statusEntries, dutyChangeEntries, extraDutyEntries,

        // Computed sets
        assignedEmployeeIds, unavailableIds,

        // Actions / mutations
        createOrGetRoster, upsertAssignment,
        createExtraDuty, deleteExtraDuty,
        syncFromRoster, refetchEdge, edgeLoading,

        // Stable callbacks
        getAvailableEmployees, getAssignment,
        handleAssign, handleRemarkChange,

        // Grid layout
        sections, activeDepts, activeRows,
        markedCount, totalPositions,
    };
}
