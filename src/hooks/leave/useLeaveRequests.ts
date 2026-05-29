// Hook Layer - Leave Request Hooks (Thin wrappers around services)

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { LeaveRequest, LeaveRequestInsert, LeaveRequestFilters } from '@/domain/leave';
import { LEAVE_QUERY_KEYS } from '@/domain/leave';
import { leaveRequestService } from '@/services';

/**
 * Fetch leave requests for the current employee
 */
export function useMyLeaveRequests(userId?: string) {
  return useQuery({
    queryKey: LEAVE_QUERY_KEYS.myRequests(userId),
    queryFn: () => leaveRequestService.getMyRequests(userId!),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch all leave requests (for supervisors)
 */
export function useAllLeaveRequests(filters?: LeaveRequestFilters) {
  return useQuery({
    queryKey: LEAVE_QUERY_KEYS.allRequests(filters),
    queryFn: () => leaveRequestService.getAllRequests(filters),
    staleTime: 1 * 60 * 1000,
  });
}

/**
 * Create a new leave request
 */
export function useCreateLeaveRequest() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: (request: LeaveRequestInsert) => leaveRequestService.createRequest(request),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEAVE_QUERY_KEYS.requests });
      qc.invalidateQueries({ queryKey: ['leave-data-structured'] });
    },
  });
}

/**
 * Cancel a pending leave request
 */
export function useCancelLeaveRequest() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => leaveRequestService.cancelRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEAVE_QUERY_KEYS.requests });
      qc.invalidateQueries({ queryKey: ['leave-data-structured'] });
      qc.invalidateQueries({ queryKey: ['leave-records'] });
      qc.invalidateQueries({ queryKey: ['leave-record-summary'] });
      qc.invalidateQueries({ queryKey: ['leave_balances'] });
    },
  });
}

/**
 * Cancel an approved leave request (supervisor action)
 */
export function useCancelApprovedLeaveRequest() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      id,
      reviewed_by,
      actor_role,
      remarks,
    }: {
      id: string;
      reviewed_by: string;
      actor_role: 'wso' | 'supervisor';
      remarks?: string;
    }) => leaveRequestService.cancelApprovedRequest(id, reviewed_by, actor_role, remarks),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEAVE_QUERY_KEYS.requests });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['leave-data-structured'] });
      qc.invalidateQueries({ queryKey: ['leave-records'] });
      qc.invalidateQueries({ queryKey: ['leave-record-summary'] });
    },
  });
}

/**
 * Review a leave request (approve or reject)
 */
export function useReviewLeaveRequest() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      id,
      action,
      actor_role,
      actor_id,
      remarks,
      direct_approval,
    }: {
      id: string;
      action: 'approve' | 'reject';
      actor_role: 'wso' | 'supervisor';
      actor_id: string;
      remarks?: string;
      direct_approval?: boolean;
    }) => leaveRequestService.reviewRequest(id, action, actor_role, actor_id, remarks, direct_approval),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEAVE_QUERY_KEYS.requests });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['leave-data-structured'] });
      qc.invalidateQueries({ queryKey: ['leave-records'] });
      qc.invalidateQueries({ queryKey: ['leave-record-summary'] });
      qc.invalidateQueries({ queryKey: ['comp-off-ledger'] });
      qc.invalidateQueries({ queryKey: ['leave_balances'] });
    },
  });
}

/**
 * Toggle SAP updated flag
 */
export function useMarkSapUpdated() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, sap_updated }: { id: string; sap_updated: boolean }) =>
      leaveRequestService.markSapUpdated(id, sap_updated),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEAVE_QUERY_KEYS.requests });
    },
  });
}

/**
 * Get count summary by leave type
 */
export function useLeaveCountSummary(userId?: string) {
  return useQuery({
    queryKey: [...LEAVE_QUERY_KEYS.requests, 'summary', userId],
    queryFn: () => leaveRequestService.getCountSummary(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}
