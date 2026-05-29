// Service Layer - Comp-Off Management

import type { LeaveRequest, CompOffEntry } from '@/domain/leave';
import { compOffRepository } from '@/data-access';
import { scheduleSyncRepository } from '@/data-access';
import { logCriticalEvent } from '@/lib/sentryHelpers';
import { format, parseISO, isValid, eachDayOfInterval } from 'date-fns';

export class CompOffService {
  /**
   * Sync CH comp-off credits when CL leave contains CH dates
   */
  async syncCHCompOffCredits(request: LeaveRequest): Promise<void> {
    const chDates = request.ch_comp_off_dates;
    if (!chDates || chDates.length === 0) return;

    // Only applicable for CL-family and COMP_OFF leave types
    const clTypes = ['CL', 'CL_CON', 'CL_1ST', 'CL_1ST_CON', 'CL_2ND', 'CL_2ND_CON'];
    if (!clTypes.includes(request.leave_type) && request.leave_type !== 'COMP_OFF') return;

    try {
      const entries = chDates.map((ch) => {
        const expiryDate = new Date(ch.date);
        expiryDate.setDate(expiryDate.getDate() + 89);

        return {
          date: ch.date,
          holiday_id: ch.holiday_id,
          expiry_date: format(expiryDate, 'yyyy-MM-dd'),
        };
      });

      await compOffRepository.createCHCompOffCredits(request.employee_id, entries);
    } catch (err) {
      logCriticalEvent('ch_comp_off_credit_failure', {
        leave_request_id: request.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Allocate comp-off entries for an approved COMP_OFF leave
   */
  async allocateCompOffForLeave(request: LeaveRequest): Promise<void> {
    if (request.leave_type !== 'COMP_OFF') return;

    try {
      const employee = await scheduleSyncRepository.getEmployeeCode(request.employee_id);
      if (!employee) {
        throw new Error('Employee profile is missing employee_id required for comp-off sync.');
      }

      const start = parseISO(request.start_date);
      const end = parseISO(request.end_date);
      if (!isValid(start) || !isValid(end)) {
        throw new Error('Invalid comp-off date range for ledger sync.');
      }

      const leaveDays = eachDayOfInterval({ start, end }).map((day) => format(day, 'yyyy-MM-dd'));
      if (leaveDays.length === 0) return;

      // Get available comp-off entries
      const availableEntries = await compOffRepository.findAvailable(employee.employee_code);
      
      // Sort by expiry date (earliest first)
      const sortedEntries = availableEntries.sort((a, b) => {
        const expiryA = a.expiry_date || '9999-12-31';
        const expiryB = b.expiry_date || '9999-12-31';
        return expiryA.localeCompare(expiryB);
      });

      // Select entries to cover the request
      const selectedEntries = sortedEntries.slice(0, leaveDays.length);
      if (selectedEntries.length < leaveDays.length) {
        throw new Error('Insufficient comp-off entries are available to sync this approved leave.');
      }

      const recordIds = selectedEntries.map((e) => e.id);

      // Atomic allocation via RPC
      await compOffRepository.allocateForLeave(
        request.id,
        recordIds,
        leaveDays,
        employee.employee_name,
        request.start_date,
        request.end_date
      );
    } catch (err) {
      logCriticalEvent('comp_off_allocation_error', {
        leave_request_id: request.id,
        leave_type: request.leave_type,
        employee_id: request.employee_id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Clear comp-off allocation when approved leave is cancelled
   */
  async clearCompOffForLeave(request: LeaveRequest): Promise<void> {
    if (request.leave_type !== 'COMP_OFF') return;

    const employee = await scheduleSyncRepository.getEmployeeCode(request.employee_id);
    if (!employee) {
      throw new Error('Employee profile is missing employee_id required for comp-off cleanup.');
    }

    await compOffRepository.clearForLeave(request.id, employee.employee_code);
  }

  /**
   * Get all comp-off entries for an employee
   */
  async getCompOffEntries(employeeId: string): Promise<CompOffEntry[]> {
    return compOffRepository.findByEmployeeId(employeeId);
  }

  /**
   * Get available comp-off entries
   */
  async getAvailableCompOffs(employeeId: string): Promise<CompOffEntry[]> {
    return compOffRepository.findAvailable(employeeId);
  }

  /**
   * Get pending comp-off allocations
   */
  async getPendingAllocations(employeeId: string): Promise<CompOffEntry[]> {
    return compOffRepository.findPendingAllocations(employeeId);
  }

  /**
   * Calculate available comp-off count
   */
  async calculateAvailableCount(employeeId: string): Promise<number> {
    const available = await compOffRepository.findAvailable(employeeId);
    return available.length;
  }
}

export const compOffService = new CompOffService();
