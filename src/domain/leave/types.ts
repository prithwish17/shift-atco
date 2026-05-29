// Domain types for Leave Management System

// ── Leave Request Types ─────────────────────────────────────────────────

export type LeaveType = 
  | 'CL' | 'EL' | 'NEE' | 'HPL' | 'COMM' | 'RH' | 'COMP_OFF'
  | 'CL_1ST' | 'CL_2ND';

export type LeaveStatus = 
  | 'Pending WSO' 
  | 'Pending Supervisor' 
  | 'Approved' 
  | 'Rejected' 
  | 'Cancelled';

export interface LeaveRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  team: string | null;
  sap_applied: boolean | null;
  sap_updated: boolean | null;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string | null;
  status: LeaveStatus;
  applied_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  remarks: string | null;
  wso_approved_by: string | null;
  wso_approved_at: string | null;
  wso_comments: string | null;
  supervisor_approved_by: string | null;
  supervisor_approved_at: string | null;
  supervisor_comments: string | null;
  direct_supervisor_approved?: boolean;
  direct_supervisor_approved_by?: string | null;
  direct_supervisor_approved_at?: string | null;
  direct_supervisor_comments?: string | null;
  ch_comp_off_dates?: CHCompOffDate[] | null;
  attachment_path?: string | null;
  attachment_meta?: AttachmentMeta | null;
  created_at: string;
  updated_at: string;
  reviewer_profile?: { full_name: string } | null;
  wso_approver_profile?: { full_name: string } | null;
  supervisor_approver_profile?: { full_name: string } | null;
}

export interface LeaveRequestInsert {
  employee_id: string;
  employee_name: string;
  team?: string | null;
  sap_applied?: boolean | null;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  total_days: number;
  reason?: string | null;
  actual_rh_date?: string | null;
  actual_rh_date_2?: string | null;
  ch_comp_off_dates?: CHCompOffDate[] | null;
}

export interface CHCompOffDate {
  date: string;
  holiday_name: string;
  holiday_id: string;
}

export interface AttachmentMeta {
  mime?: string;
  size?: number;
  original_name?: string | null;
}

// ── Leave Balance Types ─────────────────────────────────────────────────

export type BalanceBucket = 'cl' | 'rh';

export interface LeaveBalance {
  id: string;
  user_id: string;
  leave_type: BalanceBucket;
  year: number;
  balance: number;
  created_at: string;
  updated_at: string;
}

export interface BalanceSummary {
  bucket: BalanceBucket;
  available: number;
  used: number;
  pending: number;
  remaining: number;
}

// ── Comp-Off Types ──────────────────────────────────────────────────────

export type CompOffStatus = 'available' | 'used' | 'expired' | 'not_available';

export interface CompOffEntry {
  id: string;
  employee_id: string;
  duty_date: string;
  expiry_date: string | null;
  days_granted: number;
  status: CompOffStatus;
  leave_request_id?: string | null;
  leave_used_on?: string | null;
  created_at: string;
}

export interface CompOffAllocation {
  requestedDays: number;
  availableCount: number;
  reservedCount: number;
  remainingAfterReservations: number;
  selectedEntries: CompOffEntry[];
  canCoverRequest: boolean;
}

// ── Holiday Types ───────────────────────────────────────────────────────

export type HolidayType = 'NH' | 'RH' | 'CH';

export interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  type: HolidayType;
  comp_off_eligible: boolean;
}

export interface HolidayConflict {
  date: string;
  holiday: Holiday;
  type: 'warn';
  message: string;
}

// ── Leave Record Types (from external system) ───────────────────────────

export interface RawLeaveRecord {
  empId?: string | number | null;
  name?: string | null;
  status?: string | null;
  casualLeave?: unknown[] | null;
  restrictedHolidays?: unknown[] | null;
  nationalHolidays?: unknown[] | null;
  closedHolidays?: unknown[] | null;
  lastYearCompOff?: unknown[] | null;
  opeDuty?: unknown[] | null;
  [key: string]: unknown;
}

export interface LeaveRecord {
  id: string;
  emp_id: string;
  employee_name: string;
  sl_no: number | null;
  status: string | null;
  leave_category: string;
  source_event_type: string;
  event_kind: string;
  leave_date: string;
  leave_used_on: string | null;
  duty_code: string;
  raw_date_value: string | null;
  raw_shift_value: string | null;
  raw_leave_used_value: string | null;
  raw_event: Record<string, any>;
  metadata: Record<string, any>;
  source: string;
  sync_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Filter Types ────────────────────────────────────────────────────────

export interface LeaveRequestFilters {
  team?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  overlapStartDate?: string;
  overlapEndDate?: string;
}

export interface LeaveRecordFilters {
  empId?: string;
  year?: number;
  category?: string;
}
