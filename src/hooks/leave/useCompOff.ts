// Hook Layer - Comp-Off Hooks

import { useQuery } from '@tanstack/react-query';
import { LEAVE_QUERY_KEYS } from '@/domain/leave';
import { compOffService } from '@/services';

/**
 * Get all comp-off entries for an employee
 */
export function useCompOffEntries(employeeId?: string) {
  return useQuery({
    queryKey: LEAVE_QUERY_KEYS.compOffLedger(employeeId),
    queryFn: () => compOffService.getCompOffEntries(employeeId!),
    enabled: !!employeeId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get available comp-off entries
 */
export function useAvailableCompOffs(employeeId?: string) {
  return useQuery({
    queryKey: [...LEAVE_QUERY_KEYS.compOffLedger(employeeId), 'available'],
    queryFn: () => compOffService.getAvailableCompOffs(employeeId!),
    enabled: !!employeeId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get pending comp-off allocations
 */
export function usePendingCompOffAllocations(employeeId?: string) {
  return useQuery({
    queryKey: [...LEAVE_QUERY_KEYS.compOffLedger(employeeId), 'pending'],
    queryFn: () => compOffService.getPendingAllocations(employeeId!),
    enabled: !!employeeId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Calculate available comp-off count
 */
export function useAvailableCompOffCount(employeeId?: string) {
  return useQuery({
    queryKey: [...LEAVE_QUERY_KEYS.compOffLedger(employeeId), 'count'],
    queryFn: () => compOffService.calculateAvailableCount(employeeId!),
    enabled: !!employeeId,
    staleTime: 5 * 60 * 1000,
  });
}
