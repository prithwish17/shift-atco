// Data Access Layer - Repository for Schedule Sync Operations

import type { LeaveRequest } from '@/domain/leave';
import { supabase } from '@/integrations/supabase/client';

export class ScheduleSyncRepository {
  /**
   * Apply approved leave to employee schedule (atomic operation)
   */
  async applyLeaveToSchedule(
    leaveRequestId: string,
    employeeId: string,
    employeeCode: string,
    employeeName: string,
    startDate: string,
    endDate: string,
    leaveType: string
  ): Promise<void> {
    const { error } = await supabase.rpc('apply_leave_to_schedule', {
      p_leave_request_id: leaveRequestId,
      p_employee_id: employeeId,
      p_employee_code: employeeCode,
      p_employee_name: employeeName,
      p_start_date: startDate,
      p_end_date: endDate,
      p_leave_type: leaveType || 'Leave',
    });

    if (error) throw error;
  }

  /**
   * Restore schedule after leave cancellation (atomic operation)
   */
  async restoreScheduleAfterCancellation(leaveRequestId: string, employeeId: string): Promise<void> {
    const { error } = await supabase.rpc('restore_schedule_after_cancellation', {
      p_leave_request_id: leaveRequestId,
      p_employee_id: employeeId,
    });

    if (error) throw error;
  }

  /**
   * Get employee code from profile
   */
  async getEmployeeCode(authUserId: string): Promise<{ employee_code: string; employee_name: string } | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('employee_id, full_name')
      .eq('id', authUserId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.employee_id) return null;

    return {
      employee_code: data.employee_id,
      employee_name: data.full_name || '',
    };
  }
}

export const scheduleSyncRepository = new ScheduleSyncRepository();
