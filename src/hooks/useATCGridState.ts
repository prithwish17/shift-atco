import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
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
    useRosterRowCount,
    useRosterStatusEntries,
} from '@/hooks/useDutyGrid';
import { useATCAssignments } from '@/hooks/useATCAssignments';
import { getTeamForDateAndShift } from '@/lib/shiftRoster';
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
    // Only date and shift are chosen. The team is not state: the duty rotation
    // already determines which team works a given shift on a given date, so
    // deriving it removes a selector that could contradict the roster.
    const [date, setDate] = useState<Date>(new Date());
    const [shift, setShift] = useState('Morning');
    const [positionLabels, setPositionLabels] = useState<Record<string, string>>({});

    const isNight = shift === 'Night';
    const dateStr = format(date, 'yyyy-MM-dd');

    const team = useMemo(() => getTeamForDateAndShift(dateStr, shift), [dateStr, shift]);

    // --------------- Queries ---------------
    const { isLoading: edgeLoading, refetch: refetchEdge } = useATCAssignments(dateStr, shift || undefined, enableEdgeFunc);
    const { data: employees = [] } = useGridEmployees();
    const { data: roster, isLoading: rosterLoading } = useDutyRoster(date, shift, team);
    const createOrGetRoster = useCreateOrGetRoster();
    const { data: rawAssignments = [], isLoading: assignmentsLoading } = useRosterAssignments(roster?.id);
    const { data: rosterRowCount = 0, isLoading: rosterRowCountLoading } = useRosterRowCount(dateStr, shift, team);
    const upsertAssignment = useUpsertAssignment();
    const { data: rawLeaveRecords = [] } = useGridLeaveRecords(date);
    const { data: rawExtraDuties = [] } = useGridExtraDuties(roster?.id);
    const createExtraDuty = useCreateExtraDuty();
    const deleteExtraDuty = useDeleteExtraDuty();
    const syncFromRoster = useSyncRosterToGrid();

    // --------------- Post-query profile enrichment ---------------
    // If grid-employees cache was cold when queries ran, enrich here
    const enrichedAssignments = useMemo(() => {
        if (!rawAssignments.length || !employees.length) return rawAssignments;
        if (rawAssignments[0]?.profiles) return rawAssignments; // already enriched
        const profileMap = new Map(employees.map(e => [e.id, { full_name: e.full_name, designation: e.designation }]));
        return rawAssignments.map(a => ({
            ...a,
            profiles: a.employee_id ? profileMap.get(a.employee_id) || null : null,
        }));
    }, [rawAssignments, employees]);

    const enrichedLeaveRecords = useMemo(() => {
        if (!rawLeaveRecords.length || !employees.length) return rawLeaveRecords;
        if (rawLeaveRecords[0]?.profiles) return rawLeaveRecords;
        const profileMap = new Map(employees.map(e => [e.id, { full_name: e.full_name, designation: e.designation }]));
        return rawLeaveRecords.map(l => ({
            ...l,
            profiles: profileMap.get(l.employee_id) || null,
        }));
    }, [rawLeaveRecords, employees]);

    const enrichedExtraDuties = useMemo(() => {
        if (!rawExtraDuties.length || !employees.length) return rawExtraDuties;
        if (rawExtraDuties[0]?.profiles) return rawExtraDuties;
        const profileMap = new Map(employees.map(e => [e.id, { full_name: e.full_name, designation: e.designation }]));
        return rawExtraDuties.map(d => ({
            ...d,
            profiles: d.employee_id ? profileMap.get(d.employee_id) || null : null,
        }));
    }, [rawExtraDuties, employees]);

    // Use enriched versions for all downstream computations
    const assignments = enrichedAssignments;
    const leaveRecords = enrichedLeaveRecords;
    const extraDuties = enrichedExtraDuties;

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
    }, [dateStr, shift, team, rosterLoading, createOrGetRoster.isPending]);

    // --------------- Auto-sync from roster ---------------
    // The duty grid is what employees see, so it must not depend on a
    // supervisor remembering to press "Sync from Roster".  Once roster rows
    // exist for this date/shift/team, the grid fills itself.
    //
    // This only ever runs into an EMPTY grid.  syncRosterToGrid deletes every
    // existing assignment before rebuilding ("clean slate"), so auto-running it
    // over a populated grid would silently discard manual assignments — the
    // supervisor keeps the button for that case, where the overwrite is
    // deliberate.
    //
    // Each date/shift/team is attempted at most once per session whether it
    // succeeds or fails, so a date whose names cannot be matched does not sit
    // in a retry loop burning free-tier requests.
    const autoSyncedKeys = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!canEdit || !team || !roster?.id) return;
        // Wait until every input is settled, otherwise "no assignments yet"
        // cannot be told apart from "assignments still loading".
        if (rosterLoading || assignmentsLoading || rosterRowCountLoading) return;
        if (syncFromRoster.isPending) return;
        if (rawAssignments.length > 0) return; // never overwrite existing work
        if (rosterRowCount === 0) return; // nothing published to sync yet

        const key = `${dateStr}::${shift}::${team}`;
        if (autoSyncedKeys.current.has(key)) return;
        autoSyncedKeys.current.add(key);

        syncFromRoster.mutate(
            { date: dateStr, shift, team },
            {
                onSuccess: (result) => {
                    if (result.synced > 0) {
                        toast.success(`Duty grid filled from roster — ${result.synced} assignments`);
                    }
                },
                // Stay quiet on failure. This runs without being asked, so it
                // must not throw error toasts at whoever opens the page; the
                // "Sync from Roster" button reports properly when used.
                onError: (err) => console.warn('[ATC grid] auto-sync skipped:', err),
            },
        );
    }, [
        canEdit, team, roster?.id, dateStr, shift,
        rosterLoading, assignmentsLoading, rosterRowCountLoading,
        rawAssignments.length, rosterRowCount, syncFromRoster.isPending,
    ]);

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

    // O(1) employee lookup by ID
    const employeeById = useMemo(
        () => new Map(employees.map(e => [e.id, e])),
        [employees]
    );

    // Pre-compute available employees per current selection — lazy O(1) per call
    const baseAvailableEmployees = useMemo(
        () => employees.filter((e) => !unavailableIds.has(e.id) && !assignedEmployeeIds.has(e.id)),
        [employees, unavailableIds, assignedEmployeeIds]
    );

    // --------------- Callbacks ---------------
    const getAvailableEmployees = useCallback((currentEmployeeId?: string | null): GridEmployee[] => {
        if (!currentEmployeeId) return baseAvailableEmployees;
        // If current employee is assigned (excluded from base), add them back
        if (assignedEmployeeIds.has(currentEmployeeId) && !unavailableIds.has(currentEmployeeId)) {
            const currentEmp = employeeById.get(currentEmployeeId);
            if (currentEmp) return [currentEmp, ...baseAvailableEmployees];
        }
        return baseAvailableEmployees;
    }, [baseAvailableEmployees, assignedEmployeeIds, unavailableIds, employeeById]);

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
        // State setters — no setTeam: the team is derived from date + shift.
        date, setDate, shift, setShift, team,
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
