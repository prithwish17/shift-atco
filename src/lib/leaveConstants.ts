// Leave Request System Constants

export const LEAVE_TYPES = [
    { value: 'CL', label: 'Casual Leave' },
    { value: 'CL_CON', label: 'Casual Leave (Contractual)' },
    { value: 'NEE', label: 'Non Encashable EL' },
    { value: 'EL', label: 'Earned Leave' },
    { value: 'HPL', label: 'Half Pay Leave' },
    { value: 'COMM', label: 'Commuted Leave' },
    { value: 'RH', label: 'Restricted Holiday' },
    { value: 'COMP_OFF', label: 'Compensatory Off' },
    { value: 'CL_1ST', label: 'CL - 1st Half (9:30 to 13:30)' },
    { value: 'CL_1ST_CON', label: 'CL - 1st Half (9:30-13:30) Contractual' },
    { value: 'CL_2ND', label: 'CL - 2nd Half (14:00 to 18:00)' },
    { value: 'CL_2ND_CON', label: 'CL - 2nd Half (14:00-18:00) Contractual' },
] as const;

export const LEAVE_STATUS = [
    { value: 'Pending WSO', label: 'Pending WSO', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    { value: 'Pending Supervisor', label: 'Pending Supervisor', color: 'bg-amber-100 text-amber-800 border-amber-300' },
    { value: 'Approved', label: 'Approved', color: 'bg-green-100 text-green-800 border-green-300' },
    { value: 'Rejected', label: 'Rejected', color: 'bg-red-100 text-red-800 border-red-300' },
    { value: 'Cancelled', label: 'Cancelled', color: 'bg-gray-100 text-gray-600 border-gray-300' },
] as const;

export type LeaveTypeValue = typeof LEAVE_TYPES[number]['value'];
export type LeaveStatusValue = typeof LEAVE_STATUS[number]['value'];

/** Get label for a leave type value */
export function getLeaveTypeLabel(value: string): string {
    return LEAVE_TYPES.find(t => t.value === value)?.label || value;
}

/** Get status styling info */
export function getLeaveStatusInfo(status: string) {
    return LEAVE_STATUS.find(s => s.value === status) || LEAVE_STATUS[0];
}
