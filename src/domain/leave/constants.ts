// Domain constants for Leave Management System

// ── Leave Policy Values ─────────────────────────────────────────────────

/** Default annual Casual Leave allowance */
export const DEFAULT_CL_BALANCE = 12;

/** Default annual Restricted Holiday allowance */
export const DEFAULT_RH_BALANCE = 2;

/** Number of days after duty date before comp-off expires */
export const COMP_OFF_EXPIRY_DAYS = 89;

/** Minimum OPE duties in a month before comp-off is earned */
export const OPE_COMP_OFF_MIN_DUTIES = 3;

/** Year-month (YYYY-MM) from which the OPE threshold rule takes effect */
export const OPE_COMP_OFF_THRESHOLD_MONTH = "2026-04";

/** Number of historical years to show in year-selector dropdowns */
export const YEAR_LOOKBACK = 3;

// ── Leave Types ─────────────────────────────────────────────────────────

export const LEAVE_TYPES = [
  { value: 'CL', label: 'Casual Leave' },
  { value: 'NEE', label: 'Non Encashable EL' },
  { value: 'EL', label: 'Earned Leave' },
  { value: 'HPL', label: 'Half Pay Leave' },
  { value: 'COMM', label: 'Commuted Leave' },
  { value: 'RH', label: 'Restricted Holiday' },
  { value: 'COMP_OFF', label: 'Compensatory Off' },
  { value: 'CL_1ST', label: 'CL - 1st Half (9:30 to 13:30)' },
  { value: 'CL_2ND', label: 'CL - 2nd Half (14:00 to 18:00)' },
] as const;

export const LEAVE_STATUS = [
  { value: 'Pending WSO', label: 'Pending WSO', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  { value: 'Pending Supervisor', label: 'Pending Supervisor', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  { value: 'Approved', label: 'Approved', color: 'bg-green-100 text-green-800 border-green-300' },
  { value: 'Rejected', label: 'Rejected', color: 'bg-red-100 text-red-800 border-red-300' },
  { value: 'Cancelled', label: 'Cancelled', color: 'bg-gray-100 text-gray-600 border-gray-300' },
] as const;

// ── Leave Type Classifications ──────────────────────────────────────────

export const CL_LEAVE_TYPES = ['CL', 'CL_CON', 'CL_1ST', 'CL_1ST_CON', 'CL_2ND', 'CL_2ND_CON'] as const;
export const RH_LEAVE_TYPES = ['RH'] as const;
export const COMP_OFF_LEAVE_TYPES = ['COMP_OFF'] as const;
export const HALF_DAY_LEAVE_TYPES = ['CL_1ST', 'CL_2ND'] as const;

// ── Comp-Off Eligible Duty Codes ────────────────────────────────────────

export const COMP_OFF_ELIGIBLE_DUTY_CODES = new Set([
  'M', 'A', 'N', 'NO', 'M+A', 'NO+N', 'G', 'SAT+NO', 'SAT+N',
  'SUN+N', 'SUN+M', 'SUN+A', 'SUN+NO',
]);

// ── Query Key Constants ─────────────────────────────────────────────────

export const LEAVE_QUERY_KEYS = {
  requests: ['leave-requests'] as const,
  myRequests: (userId?: string) => ['leave-requests', 'mine', userId] as const,
  allRequests: (filters?: any) => ['leave-requests', 'all', filters] as const,
  balances: (userId?: string) => ['leave_balances', userId] as const,
  records: (empId?: string, year?: number) => ['leave-records', empId, year] as const,
  recordSummary: (empId?: string, year?: number) => ['leave-record-summary', empId, year] as const,
  dataStructured: (year?: number, empId?: string | null, includePreviousYear?: boolean) => 
    ['leave-data-structured', year, empId ?? 'all', includePreviousYear] as const,
  compOffLedger: (empId?: string) => ['comp-off-ledger', empId] as const,
} as const;
