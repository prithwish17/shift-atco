// Domain business rules - Pure functions with no side effects

import type { LeaveType, BalanceBucket, LeaveRequest, LeaveStatus } from './types';
import { CL_LEAVE_TYPES, HALF_DAY_LEAVE_TYPES } from './constants';

// ── Leave Type Classification ───────────────────────────────────────────

/**
 * Determines if a leave type is a half-day leave
 */
export function isHalfDayLeave(leaveType: LeaveType): boolean {
  return HALF_DAY_LEAVE_TYPES.includes(leaveType as any);
}

/**
 * Determines if a leave type is a CL-family leave
 */
export function isCLFamilyLeave(leaveType: LeaveType): boolean {
  return CL_LEAVE_TYPES.includes(leaveType as any);
}

/**
 * Maps a leave type to its balance bucket for deduction
 */
export function getBalanceBucket(leaveType: LeaveType): BalanceBucket | null {
  if (isCLFamilyLeave(leaveType)) {
    return 'cl';
  }
  if (leaveType === 'RH') {
    return 'rh';
  }
  // COMP_OFF uses its own allocation system
  // EL, NEE, HPL, COMM are not balance-enforced yet
  return null;
}

/**
 * Gets the display label for a balance bucket
 */
export function getBalanceBucketLabel(bucket: BalanceBucket): string {
  const labels: Record<BalanceBucket, string> = {
    cl: 'Casual Leave',
    rh: 'Restricted Holiday',
  };
  return labels[bucket];
}

/**
 * Gets the leave types that belong to a specific balance bucket
 */
export function getLeaveTypesForBucket(bucket: BalanceBucket): string[] {
  switch (bucket) {
    case 'cl':
      return [...CL_LEAVE_TYPES];
    case 'rh':
      return ['RH'];
    default:
      return [];
  }
}

// ── Leave Status Logic ──────────────────────────────────────────────────

/**
 * Checks if a leave request is fully approved (both WSO and Supervisor)
 */
export function isFinalLeaveApproved(request: Pick<LeaveRequest, 'status' | 'supervisor_approved_at'>): boolean {
  return request.status === 'Approved' && Boolean(request.supervisor_approved_at);
}

/**
 * Checks if a leave request can be cancelled by the employee
 */
export function canBeCancelledByEmployee(status: LeaveStatus): boolean {
  return status === 'Pending WSO' || status === 'Pending Supervisor';
}

/**
 * Checks if a leave request is in a pending state
 */
export function isPendingLeave(status: LeaveStatus): boolean {
  return status === 'Pending WSO' || status === 'Pending Supervisor';
}

/**
 * Determines the next status in the approval workflow
 */
export function getNextApprovalStatus(
  currentStatus: LeaveStatus,
  actorRole: 'wso' | 'supervisor',
  action: 'approve' | 'reject'
): LeaveStatus {
  if (action === 'reject') {
    return 'Rejected';
  }
  
  if (actorRole === 'wso' && currentStatus === 'Pending WSO') {
    return 'Pending Supervisor';
  }
  
  if (actorRole === 'supervisor') {
    return 'Approved';
  }
  
  return currentStatus;
}

// ── Balance Calculations ────────────────────────────────────────────────

/**
 * Calculates pending leave days for a specific balance bucket
 */
export function calculatePendingDays(
  requests: LeaveRequest[],
  bucket: BalanceBucket,
  currentYear: number
): number {
  const bucketLeaveTypes = getLeaveTypesForBucket(bucket);
  
  return requests
    .filter((req) => {
      if (!bucketLeaveTypes.includes(req.leave_type)) return false;
      if (!isPendingLeave(req.status)) return false;
      const reqYear = new Date(req.start_date).getFullYear();
      return reqYear === currentYear;
    })
    .reduce((sum, req) => sum + (req.total_days || 0), 0);
}

/**
 * Calculates total approved leave days for a specific leave type
 */
export function calculateApprovedDays(
  requests: LeaveRequest[],
  leaveType: LeaveType
): number {
  return requests
    .filter((req) => req.leave_type === leaveType && isFinalLeaveApproved(req))
    .reduce((sum, req) => sum + (req.total_days || 0), 0);
}

// ── Leave Request Validation ────────────────────────────────────────────

/**
 * Checks if two date ranges overlap
 */
export function doDateRangesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const s1 = new Date(start1);
  const e1 = new Date(end1);
  const s2 = new Date(start2);
  const e2 = new Date(end2);
  
  return s1 <= e2 && e1 >= s2;
}

/**
 * Validates that a leave request doesn't overlap with existing requests
 */
export function hasOverlappingRequests(
  existingRequests: LeaveRequest[],
  newStartDate: string,
  newEndDate: string,
  excludeRequestId?: string
): boolean {
  const activeStatuses: LeaveStatus[] = ['Pending WSO', 'Pending Supervisor', 'Approved'];
  
  return existingRequests.some((req) => {
    if (excludeRequestId && req.id === excludeRequestId) return false;
    if (!activeStatuses.includes(req.status)) return false;
    return doDateRangesOverlap(newStartDate, newEndDate, req.start_date, req.end_date);
  });
}

// ── Date Utilities ──────────────────────────────────────────────────────

/**
 * Calculates the number of days between two dates (inclusive)
 */
export function calculateDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays + 1; // inclusive
}

/**
 * Checks if a date is in the past
 */
export function isDateInPast(date: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(date);
  return checkDate < today;
}

/**
 * Checks if a date is today or in the future
 */
export function isDateTodayOrFuture(date: string): boolean {
  return !isDateInPast(date);
}
