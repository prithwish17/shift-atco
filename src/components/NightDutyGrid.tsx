import React from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    NIGHT_DEPARTMENTS_N1,
    NIGHT_DEPARTMENTS_N2,
    NIGHT_DEPT_LABELS,
    NIGHT_SPAN_POSITIONS,
    NIGHT_FULL_SPAN_POSITIONS,
    NIGHT_TRIPLE_FULL_POSITIONS,
    NIGHT_FULL_DEPARTMENTS,
    POSITION_ROWS,
} from '@/lib/atcConstants';
import type { GridEmployee } from '@/hooks/useDutyGrid';

type Assignment = {
    id?: string;
    employee_id?: string | null;
    remark?: string | null;
    position_name?: string;
    department?: string;
    section_type?: string;
    profiles?: { full_name?: string } | null;
};

type Section = {
    label: string;
    color: string;
    rows: typeof POSITION_ROWS;
};

interface Props {
    sections: Section[];
    positionLabels: Record<string, string>;
    setPositionLabels: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    getAssignment: (positionKey: string, department: string) => Assignment | undefined;
    handleAssign: (positionKey: string, department: string, employeeId: string | null) => void;
    getAvailableEmployees: (currentEmployeeId?: string | null) => GridEmployee[];
    canEdit: boolean;
}

const N1_HALF = [...NIGHT_DEPARTMENTS_N1];
const N2_HALF = [...NIGHT_DEPARTMENTS_N2];

function EmployeeDropdown({
    positionKey,
    department,
    getAssignment,
    handleAssign,
    getAvailableEmployees,
    canEdit,
    className = '',
}: {
    positionKey: string;
    department: string;
    getAssignment: (pk: string, dept: string) => Assignment | undefined;
    handleAssign: (pk: string, dept: string, empId: string | null) => void;
    getAvailableEmployees: (currentId?: string | null) => GridEmployee[];
    canEdit: boolean;
    className?: string;
}) {
    const assignment = getAssignment(positionKey, department);
    const available = getAvailableEmployees(assignment?.employee_id);

    if (!canEdit) {
        return (
            <span className="text-xs px-2">
                {assignment?.profiles?.full_name || '—'}
            </span>
        );
    }

    return (
        <Select
            value={assignment?.employee_id || '_none'}
            onValueChange={(val) => handleAssign(positionKey, department, val === '_none' ? null : val)}
        >
            <SelectTrigger className={`h-7 text-xs ${className}`}>
                <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="_none">— None —</SelectItem>
                {available.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                        {emp.full_name} {emp.designation ? `(${emp.designation})` : ''}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export function NightDutyGrid({
    sections,
    positionLabels,
    setPositionLabels,
    getAssignment,
    handleAssign,
    getAvailableEmployees,
    canEdit,
}: Props) {
    // Total columns: 1 (position) + 3 (N1) + 3 (N2) = 7
    const TOTAL_COLS = 7;

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b bg-muted">
                        <th className="px-3 py-2 text-left font-semibold w-[180px] border-r" rowSpan={2}>Position</th>
                        {N1_HALF.map((dept, i) => (
                            <th
                                key={dept}
                                className={`px-3 py-2 text-center font-semibold ${i === N1_HALF.length - 1 ? 'border-r-4 border-foreground' : 'border-r'}`}
                            >
                                {NIGHT_DEPT_LABELS[dept]}
                            </th>
                        ))}
                        {N2_HALF.map((dept, i) => (
                            <th
                                key={dept}
                                className={`px-3 py-2 text-center font-semibold ${i < N2_HALF.length - 1 ? 'border-r' : ''}`}
                            >
                                {NIGHT_DEPT_LABELS[dept]}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sections.map((section) => (
                        <React.Fragment key={section.label}>
                            <tr>
                                <td
                                    colSpan={TOTAL_COLS}
                                    className="px-3 py-1.5 font-semibold text-xs uppercase tracking-wide text-white"
                                    style={{ backgroundColor: section.color }}
                                >
                                    {section.label}
                                </td>
                            </tr>
                            {section.rows.map((row) => {
                                const isFullSpan = NIGHT_FULL_SPAN_POSITIONS.has(row.key);
                                const isTripleFull = NIGHT_TRIPLE_FULL_POSITIONS.has(row.key);
                                const isSpan = NIGHT_SPAN_POSITIONS.has(row.key);
                                return (
                                    <tr key={row.key} className="border-b hover:bg-accent/30">
                                        {/* Position label cell */}
                                        <td className="px-3 py-1.5 border-r font-medium whitespace-nowrap">
                                            {row.editable && canEdit ? (
                                                <Input
                                                    value={positionLabels[row.key] ?? row.label}
                                                    onChange={(e) => setPositionLabels((prev) => ({ ...prev, [row.key]: e.target.value }))}
                                                    className="h-7 text-xs border-dashed"
                                                />
                                            ) : (
                                                <span className="text-foreground">{row.label}</span>
                                            )}
                                        </td>

                                        {isFullSpan ? (
                                            /* Full span: 1 dropdown across all 6 columns */
                                            <td colSpan={6} className="px-1 py-1">
                                                <EmployeeDropdown
                                                    positionKey={row.key}
                                                    department="FULL-SPAN"
                                                    getAssignment={getAssignment}
                                                    handleAssign={handleAssign}
                                                    getAvailableEmployees={getAvailableEmployees}
                                                    canEdit={canEdit}
                                                    className="w-full"
                                                />
                                            </td>
                                        ) : isTripleFull ? (
                                            /* Triple full: 3 dropdowns across 6 cols (2 cols each, no N1/N2 split) */
                                            <>
                                                {NIGHT_FULL_DEPARTMENTS.map((dept, i) => (
                                                    <td
                                                        key={dept}
                                                        colSpan={2}
                                                        className={`px-1 py-1 ${i < NIGHT_FULL_DEPARTMENTS.length - 1 ? 'border-r' : ''}`}
                                                    >
                                                        <EmployeeDropdown
                                                            positionKey={row.key}
                                                            department={dept}
                                                            getAssignment={getAssignment}
                                                            handleAssign={handleAssign}
                                                            getAvailableEmployees={getAvailableEmployees}
                                                            canEdit={canEdit}
                                                        />
                                                    </td>
                                                ))}
                                            </>
                                        ) : isSpan ? (
                                            <>
                                                {/* N-1 half: single dropdown spanning 3 columns */}
                                                <td colSpan={3} className="px-1 py-1 border-r-4 border-foreground">
                                                    <EmployeeDropdown
                                                        positionKey={row.key}
                                                        department="RSR-N1-SPAN"
                                                        getAssignment={getAssignment}
                                                        handleAssign={handleAssign}
                                                        getAvailableEmployees={getAvailableEmployees}
                                                        canEdit={canEdit}
                                                        className="w-full"
                                                    />
                                                </td>
                                                {/* N-2 half: single dropdown spanning 3 columns */}
                                                <td colSpan={3} className="px-1 py-1">
                                                    <EmployeeDropdown
                                                        positionKey={row.key}
                                                        department="RSR-N2-SPAN"
                                                        getAssignment={getAssignment}
                                                        handleAssign={handleAssign}
                                                        getAvailableEmployees={getAvailableEmployees}
                                                        canEdit={canEdit}
                                                        className="w-full"
                                                    />
                                                </td>
                                            </>
                                        ) : (() => {
                                            const nightDeptCount = row.deptCount || 3;
                                            const n1Depts = N1_HALF.slice(0, nightDeptCount);
                                            const n1Empty = 3 - nightDeptCount;
                                            const n2Depts = N2_HALF.slice(0, nightDeptCount);
                                            const n2Empty = 3 - nightDeptCount;
                                            return (
                                                <>
                                                    {/* N-1 half */}
                                                    {n1Depts.map((dept, i) => (
                                                        <td
                                                            key={dept}
                                                            className={`px-1 py-1 ${i === n1Depts.length - 1 && n1Empty === 0 ? 'border-r-4 border-foreground' : ''}`}
                                                        >
                                                            <EmployeeDropdown
                                                                positionKey={row.key}
                                                                department={dept}
                                                                getAssignment={getAssignment}
                                                                handleAssign={handleAssign}
                                                                getAvailableEmployees={getAvailableEmployees}
                                                                canEdit={canEdit}
                                                            />
                                                        </td>
                                                    ))}
                                                    {n1Empty > 0 && (
                                                        <td colSpan={n1Empty} className="bg-muted/20 border-r-4 border-foreground" />
                                                    )}
                                                    {/* N-2 half */}
                                                    {n2Depts.map((dept) => (
                                                        <td key={dept} className="px-1 py-1">
                                                            <EmployeeDropdown
                                                                positionKey={row.key}
                                                                department={dept}
                                                                getAssignment={getAssignment}
                                                                handleAssign={handleAssign}
                                                                getAvailableEmployees={getAvailableEmployees}
                                                                canEdit={canEdit}
                                                            />
                                                        </td>
                                                    ))}
                                                    {n2Empty > 0 && (
                                                        <td colSpan={n2Empty} className="bg-muted/20" />
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </tr>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
