// Service Layer - Schedule Synchronization

import type { LeaveRequest } from '@/domain/leave';
import { scheduleSyncRepository } from '@/data-access';
import { logCriticalEvent } from '@/lib/sentryHelpers';

export class ScheduleSyncService {
  /**
   * Apply approved leave to employee schedule
   */
  async applyLeaveToSchedule(request: LeaveRequest): Promise<void> {
    try {
      const employee = await scheduleSyncRepository.getEmployeeCode(request.employee_id);
      if (!employee) {
        throw new Error('Employee profile is missing employee_id required for schedule sync.');
      }

      await scheduleSyncRepository.applyLeaveToSchedule(
        request.id,
        request.employee_id,
        employee.employee_code,
        employee.employee_name,
        request.start_date,
        request.end_date,
        request.leave_type
      );
    } catch (err) {
      logCriticalEvent('schedule_sync_failure', {
        leave_request_id: request.id,
        employee_id: request.employee_id,
        start_date: request.start_date,
        end_date: request.end_date,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Restore schedule after leave cancellation
   */
  async restoreScheduleAfterCancellation(request: LeaveRequest): Promise<void> {
    try {
      await scheduleSyncRepository.restoreScheduleAfterCancellation(
        request.id,
        request.employee_id
      );
    } catch (err) {
      logCriticalEvent('schedule_restore_failure', {
        leave_request_id: request.id,
        employee_id: request.employee_id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Get employee code from auth user ID
   */
  async getEmployeeCode(authUserId: string): Promise<{ employee_code: string; employee_name: string } | null> {
    return scheduleSyncRepository.getEmployeeCode(authUserId);
  }
}

export const scheduleSyncService = new ScheduleSyncService();
