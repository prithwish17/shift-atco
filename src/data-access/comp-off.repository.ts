// Data Access Layer - Repository for Comp-Off Operations

import type { CompOffEntry } from '@/domain/leave';
import { supabase } from '@/integrations/supabase/client';

export class CompOffRepository {
  /**
   * Fetch comp-off entries for an employee
   */
  async findByEmployeeId(employeeId: string): Promise<CompOffEntry[]> {
    const { data, error } = await supabase
      .from('comp_off_ledger')
      .select('*')
      .eq('employee_id', employeeId)
      .order('duty_date', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Allocate comp-off entries for a leave request (atomic operation)
   */
  async allocateForLeave(
    leaveRequestId: string,
    recordIds: string[],
    leaveDates: string[],
    employeeName: string,
    startDate: string,
    endDate: string
  ): Promise<void> {
    const { error } = await supabase.rpc('allocate_comp_off_for_leave', {
      p_leave_request_id: leaveRequestId,
      p_record_ids: recordIds,
      p_leave_dates: leaveDates,
      p_employee_name: employeeName,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (error) throw error;
  }

  /**
   * Clear comp-off allocation when leave is cancelled (atomic operation)
   */
  async clearForLeave(leaveRequestId: string, employeeCode: string): Promise<void> {
    const { error } = await supabase.rpc('clear_comp_off_for_leave', {
      p_leave_request_id: leaveRequestId,
      p_employee_code: employeeCode,
    });

    if (error) throw error;
  }

  /**
   * Create CH comp-off credits when CL leave contains CH dates
   */
  async createCHCompOffCredits(
    employeeId: string,
    chDates: Array<{ date: string; holiday_id: string; expiry_date: string }>
  ): Promise<void> {
    const entries = chDates.map((ch) => ({
      employee_id: employeeId,
      holiday_id: ch.holiday_id,
      duty_date: ch.date,
      days_granted: 1,
      expiry_date: ch.expiry_date,
      status: 'available',
    }));

    for (const entry of entries) {
      const { error } = await supabase
        .from('comp_off_ledger')
        .upsert(entry, { onConflict: 'employee_id,holiday_id,duty_date' });

      if (error) {
        console.error('Failed to create CH comp-off credit:', error);
        throw error;
      }
    }
  }

  /**
   * Get available comp-off entries for allocation
   */
  async findAvailable(employeeId: string): Promise<CompOffEntry[]> {
    const { data, error } = await supabase
      .from('comp_off_ledger')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'available')
      .order('expiry_date', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get pending comp-off allocations (reserved by pending requests)
   */
  async findPendingAllocations(employeeId: string): Promise<CompOffEntry[]> {
    const { data, error } = await supabase
      .from('comp_off_ledger')
      .select('*')
      .eq('employee_id', employeeId)
      .not('leave_request_id', 'is', null)
      .eq('status', 'available');

    if (error) throw error;
    return data || [];
  }
}

export const compOffRepository = new CompOffRepository();
