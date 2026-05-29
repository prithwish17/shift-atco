// Service Layer - Leave Balance Management

import type { LeaveBalance, BalanceBucket, LeaveRequest, LeaveType } from '@/domain/leave';
import { DEFAULT_CL_BALANCE, DEFAULT_RH_BALANCE, getBalanceBucket, isPendingLeave } from '@/domain/leave';
import { leaveBalanceRepository } from '@/data-access';
import { logCriticalEvent, captureError } from '@/lib/sentryHelpers';

export class LeaveBalanceService {
  /**
   * Get all balances for a user
   */
  async getUserBalances(userId: string): Promise<LeaveBalance[]> {
    return leaveBalanceRepository.findByUserId(userId);
  }

  /**
   * Get available balance for a specific bucket and year
   */
  async getAvailableBalance(
    userId: string,
    bucket: BalanceBucket,
    year: number,
    pendingDays: number = 0
  ): Promise<{ total: number; available: number; pending: number }> {
    const balance = await leaveBalanceRepository.getBalance(userId, bucket, year);
    const total = balance?.balance ?? (bucket === 'cl' ? DEFAULT_CL_BALANCE : DEFAULT_RH_BALANCE);
    const available = Math.max(total - pendingDays, 0);

    return { total, available, pending: pendingDays };
  }

  /**
   * Calculate pending days for a balance bucket from requests
   */
  calculatePendingDays(requests: LeaveRequest[], bucket: BalanceBucket, currentYear: number): number {
    const bucketLeaveTypes = bucket === 'cl' 
      ? ['CL', 'CL_CON', 'CL_1ST', 'CL_1ST_CON', 'CL_2ND', 'CL_2ND_CON']
      : ['RH'];

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
   * Deduct balance when leave is approved
   */
  async deductBalance(request: LeaveRequest): Promise<void> {
    const bucket = getBalanceBucket(request.leave_type);
    if (!bucket) return; // Not a balance-tracked type

    const year = new Date(request.start_date).getFullYear();
    try {
      await leaveBalanceRepository.deduct(request.employee_id, bucket, year, request.total_days);
    } catch (err) {
      logCriticalEvent('leave_balance_deduction_error', {
        leave_request_id: request.id,
        leave_type: request.leave_type,
        bucket,
        employee_id: request.employee_id,
        total_days: request.total_days,
        error: err instanceof Error ? err.message : String(err),
      });
      captureError(err, { tags: { flow: 'leave_balance_deduction' } });
    }
  }

  /**
   * Restore balance when approved leave is cancelled
   */
  async restoreBalance(request: LeaveRequest): Promise<void> {
    const bucket = getBalanceBucket(request.leave_type);
    if (!bucket) return;

    const year = new Date(request.start_date).getFullYear();
    try {
      await leaveBalanceRepository.restore(request.employee_id, bucket, year, request.total_days);
    } catch (err) {
      logCriticalEvent('leave_balance_restore_error', {
        leave_request_id: request.id,
        leave_type: request.leave_type,
        bucket,
        employee_id: request.employee_id,
        total_days: request.total_days,
        error: err instanceof Error ? err.message : String(err),
      });
      captureError(err, { tags: { flow: 'leave_balance_restore' } });
    }
  }

  /**
   * Check if user has sufficient balance for a request
   */
  async checkSufficientBalance(
    userId: string,
    leaveType: LeaveType,
    totalDays: number,
    pendingDays: number
  ): Promise<{ sufficient: boolean; available: number; required: number }> {
    const bucket = getBalanceBucket(leaveType);
    if (!bucket) {
      return { sufficient: true, available: 0, required: 0 };
    }

    const year = new Date().getFullYear();
    const { available } = await this.getAvailableBalance(userId, bucket, year, pendingDays);

    return {
      sufficient: available >= totalDays,
      available,
      required: totalDays,
    };
  }
}

export const leaveBalanceService = new LeaveBalanceService();
