// Hook Layer - Leave Balance Hooks

import { useQuery } from '@tanstack/react-query';
import type { BalanceBucket, LeaveRequest } from '@/domain/leave';
import { LEAVE_QUERY_KEYS, DEFAULT_CL_BALANCE, DEFAULT_RH_BALANCE, getBalanceBucket } from '@/domain/leave';
import { leaveBalanceService } from '@/services';

/**
 * Get all leave balances for a user
 */
export function useLeaveBalances(userId?: string) {
  return useQuery({
    queryKey: LEAVE_QUERY_KEYS.balances(userId),
    queryFn: () => leaveBalanceService.getUserBalances(userId!),
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Get available balance for a specific bucket
 */
export function useAvailableBalance(
  userId?: string,
  bucket?: BalanceBucket,
  year?: number,
  pendingDays?: number
) {
  return useQuery({
    queryKey: [...LEAVE_QUERY_KEYS.balances(userId), 'available', bucket, year, pendingDays],
    queryFn: () => leaveBalanceService.getAvailableBalance(userId!, bucket!, year!, pendingDays || 0),
    enabled: !!userId && !!bucket && !!year,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Calculate pending days for a balance bucket
 */
export function useCalculatePendingDays(
  requests: LeaveRequest[] | undefined,
  bucket: BalanceBucket,
  currentYear: number
): number {
  if (!requests) return 0;
  return leaveBalanceService.calculatePendingDays(requests, bucket, currentYear);
}

/**
 * Get balance for a specific leave type
 */
export function useLeaveTypeBalance(
  userId?: string,
  leaveType?: string,
  pendingDays?: number
) {
  const bucket = leaveType ? getBalanceBucket(leaveType as any) : null;
  const currentYear = new Date().getFullYear();
  
  return useQuery({
    queryKey: [...LEAVE_QUERY_KEYS.balances(userId), 'type', leaveType, pendingDays],
    queryFn: async () => {
      if (!bucket) {
        return { total: 0, available: 0, pending: 0 };
      }
      return leaveBalanceService.getAvailableBalance(userId!, bucket, currentYear, pendingDays || 0);
    },
    enabled: !!userId && !!bucket,
    staleTime: 5 * 60 * 1000,
  });
}
