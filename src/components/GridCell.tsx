import React from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { GridEmployee, RosterAssignment } from '@/hooks/useDutyGrid';

// --------------- Memoized employee dropdown ---------------

interface EmployeeSelectProps {
    positionKey: string;
    department: string;
    assignment: RosterAssignment | undefined;
    availableEmployees: GridEmployee[];
    canEdit: boolean;
    onAssign: (positionKey: string, department: string, employeeId: string | null) => void;
    colSpan?: number;
    className?: string;
}

export const GridCellSelect = React.memo(function GridCellSelect({
    positionKey,
    department,
    assignment,
    availableEmployees,
    canEdit,
    onAssign,
    colSpan,
    className,
}: EmployeeSelectProps) {
    if (!canEdit) {
        return (
            <td colSpan={colSpan} className={cn('px-1 py-1', className)}>
                <span className="text-xs px-2">{assignment?.profiles?.full_name || '—'}</span>
            </td>
        );
    }

    return (
        <td colSpan={colSpan} className={cn('px-1 py-1', className)}>
            <Select
                value={assignment?.employee_id || '_none'}
                onValueChange={(val) => onAssign(positionKey, department, val === '_none' ? null : val)}
            >
                <SelectTrigger className={cn(
                    'h-7 text-xs',
                    assignment?.employee_id && 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800',
                )}>
                    <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    {availableEmployees.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                            {emp.full_name} {emp.designation ? `(${emp.designation})` : ''}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </td>
    );
}, (prev, next) => {
    if (prev.canEdit !== next.canEdit) return false;
    if (prev.assignment?.employee_id !== next.assignment?.employee_id) return false;
    if (prev.assignment?.profiles?.full_name !== next.assignment?.profiles?.full_name) return false;
    if (prev.colSpan !== next.colSpan) return false;
    return true;
});

// --------------- Memoized reliever cell ---------------

interface RelieverCellProps {
    positionKey: string;
    department: string;
    assignment: RosterAssignment | undefined;
    hasReliever: boolean;
    canEdit: boolean;
    allEmployees: GridEmployee[];
    onRemarkChange: (positionKey: string, department: string, remark: string) => void;
}

export const GridCellReliever = React.memo(function GridCellReliever({
    positionKey,
    department,
    assignment,
    hasReliever,
    canEdit,
    allEmployees,
    onRemarkChange,
}: RelieverCellProps) {
    if (hasReliever) {
        if (!canEdit) {
            return (
                <td className="px-1 py-1 min-w-[140px] border-r last:border-r-0">
                    <span className="text-xs text-muted-foreground px-2">
                        {assignment?.remark || '—'}
                    </span>
                </td>
            );
        }
        return (
            <td className="px-1 py-1 min-w-[140px] border-r last:border-r-0">
                <Select
                    value={assignment?.remark || '_none'}
                    onValueChange={(val) => onRemarkChange(positionKey, department, val === '_none' ? '' : val)}
                >
                    <SelectTrigger className={cn(
                        'h-7 text-xs',
                        assignment?.remark && assignment.remark !== '' && 'bg-sky-50 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800',
                    )}>
                        <SelectValue placeholder="Reliever..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_none">— None —</SelectItem>
                        {allEmployees.map((emp) => (
                            <SelectItem key={emp.id} value={emp.full_name || emp.id}>
                                {emp.full_name} {emp.designation ? `(${emp.designation})` : ''}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </td>
        );
    }

    if (!canEdit) {
        return (
            <td className="px-1 py-1 min-w-[140px] border-r last:border-r-0">
                <span className="text-xs text-muted-foreground px-2">
                    {assignment?.remark || ''}
                </span>
            </td>
        );
    }

    return (
        <td className="px-1 py-1 min-w-[140px] border-r last:border-r-0">
            <Input
                className="h-7 text-xs"
                placeholder="Remark"
                defaultValue={assignment?.remark || ''}
                onBlur={(e) => onRemarkChange(positionKey, department, e.target.value)}
            />
        </td>
    );
}, (prev, next) => {
    if (prev.canEdit !== next.canEdit) return false;
    if (prev.hasReliever !== next.hasReliever) return false;
    if (prev.assignment?.remark !== next.assignment?.remark) return false;
    if (prev.hasReliever && prev.allEmployees.length !== next.allEmployees.length) return false;
    return true;
});

// --------------- Memoized position label cell ---------------

interface PositionLabelCellProps {
    rowKey: string;
    label: string;
    editable: boolean;
    canEdit: boolean;
    positionLabels: Record<string, string>;
    setPositionLabels: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export const PositionLabelCell = React.memo(function PositionLabelCell({
    rowKey,
    label,
    editable,
    canEdit,
    positionLabels,
    setPositionLabels,
}: PositionLabelCellProps) {
    return (
        <td className="px-3 py-1.5 border-r font-medium">
            {editable && canEdit ? (
                <Input
                    value={positionLabels[rowKey] ?? label}
                    onChange={(e) => setPositionLabels((prev) => ({ ...prev, [rowKey]: e.target.value }))}
                    className="h-7 text-xs border-dashed"
                />
            ) : (
                <span className="text-foreground">{label}</span>
            )}
        </td>
    );
}, (prev, next) => {
    if (prev.canEdit !== next.canEdit) return false;
    if (prev.label !== next.label) return false;
    if (prev.editable && prev.positionLabels[prev.rowKey] !== next.positionLabels[next.rowKey]) return false;
    return true;
});
