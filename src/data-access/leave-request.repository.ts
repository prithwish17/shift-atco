// Data Access Layer - Repository for Leave Requests

import type { LeaveRequest, LeaveRequestInsert, LeaveRequestFilters } from '@/domain/leave';
import { supabase } from '@/integrations/supabase/client';

export class LeaveRequestRepository {
  /**
   * Fetch leave requests for a specific employee
   */
  async findByEmployeeId(employeeId: string): Promise<LeaveRequest[]> {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .order('applied_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Fetch all leave requests with optional filters (for supervisors)
   */
  async findAll(filters?: LeaveRequestFilters): Promise<LeaveRequest[]> {
    let query = supabase
      .from('leave_requests')
      .select('*')
      .order('applied_at', { ascending: false })
      .limit(500);

    if (filters?.team) {
      query = query.eq('team', filters.team);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.startDate) {
      query = query.gte('start_date', filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte('end_date', filters.endDate);
    }
    if (filters?.overlapStartDate && filters?.overlapEndDate) {
      query = query
        .lte('start_date', filters.overlapEndDate)
        .gte('end_date', filters.overlapStartDate);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Create a new leave request
   */
  async create(request: LeaveRequestInsert): Promise<LeaveRequest> {
    const { data, error } = await supabase
      .from('leave_requests')
      .insert(request)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update a leave request
   */
  async update(id: string, updates: Partial<LeaveRequest>): Promise<LeaveRequest> {
    const { data, error } = await supabase
      .from('leave_requests')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Cancel a leave request (employee action)
   */
  async cancel(id: string): Promise<LeaveRequest> {
    const { data, error } = await supabase
      .from('leave_requests')
      .update({ status: 'Cancelled' })
      .eq('id', id)
      .in('status', ['Pending WSO', 'Pending Supervisor'])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Cancel an approved leave request (supervisor action)
   */
  async cancelApproved(
    id: string,
    reviewedBy: string,
    actorRole: 'wso' | 'supervisor',
    remarks?: string
  ): Promise<LeaveRequest> {
    const updateData: Partial<LeaveRequest> = {
      status: 'Cancelled',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      remarks: remarks || null,
    };

    if (actorRole === 'wso') {
      updateData.wso_comments = remarks ? `[Cancelled] ${remarks}` : undefined;
    } else {
      updateData.supervisor_comments = remarks ? `[Cancelled] ${remarks}` : undefined;
    }

    const { data, error } = await supabase
      .from('leave_requests')
      .update(updateData)
      .eq('id', id)
      .eq('status', 'Approved')
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Review a leave request (approve or reject)
   */
  async review(
    id: string,
    action: 'approve' | 'reject',
    actorRole: 'wso' | 'supervisor',
    actorId: string,
    remarks?: string,
    directApproval?: boolean
  ): Promise<LeaveRequest> {
    const now = new Date().toISOString();
    const isApprove = action === 'approve';
    const updateData: Partial<LeaveRequest> = {
      reviewed_by: actorId,
      reviewed_at: now,
      remarks: remarks || null,
    };

    let expectedStatus = '';

    if (actorRole === 'wso') {
      expectedStatus = 'Pending WSO';
      updateData.status = isApprove ? 'Pending Supervisor' : 'Rejected';
      updateData.wso_comments = remarks || null;
      if (isApprove) {
        updateData.wso_approved_by = actorId;
        updateData.wso_approved_at = now;
      } else {
        updateData.wso_approved_by = null;
        updateData.wso_approved_at = null;
      }
    } else {
      expectedStatus = directApproval ? 'Pending WSO' : 'Pending Supervisor';
      updateData.status = isApprove ? 'Approved' : 'Rejected';
      updateData.supervisor_comments = remarks || null;
      if (isApprove) {
        updateData.supervisor_approved_by = actorId;
        updateData.supervisor_approved_at = now;
        if (directApproval) {
          updateData.direct_supervisor_approved = true;
          updateData.direct_supervisor_approved_by = actorId;
          updateData.direct_supervisor_approved_at = now;
          updateData.direct_supervisor_comments = remarks || null;
        } else {
          updateData.direct_supervisor_approved = false;
          updateData.direct_supervisor_approved_by = null;
          updateData.direct_supervisor_approved_at = null;
          updateData.direct_supervisor_comments = null;
        }
      } else {
        updateData.supervisor_approved_by = null;
        updateData.supervisor_approved_at = null;
        updateData.direct_supervisor_approved = false;
        updateData.direct_supervisor_approved_by = null;
        updateData.direct_supervisor_approved_at = null;
        updateData.direct_supervisor_comments = null;
      }
    }

    const { data, error } = await supabase
      .from('leave_requests')
      .update(updateData)
      .eq('id', id)
      .eq('status', expectedStatus)
      .select()
      .single();

    if (error) throw error;
    if (!data) throw new Error('Request is no longer in a reviewable state.');
    return data;
  }

  /**
   * Toggle SAP updated flag
   */
  async markSapUpdated(id: string, sapUpdated: boolean): Promise<LeaveRequest> {
    const { data, error } = await supabase
      .from('leave_requests')
      .update({ sap_updated: sapUpdated })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get count summary by leave type
   */
  async getCountSummary(employeeId: string): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('leave_type, status, supervisor_approved_at')
      .eq('employee_id', employeeId)
      .eq('status', 'Approved');

    if (error) throw error;

    const summary: Record<string, number> = {};
    for (const row of data || []) {
      if (!row.supervisor_approved_at) continue;
      summary[row.leave_type] = (summary[row.leave_type] || 0) + 1;
    }
    return summary;
  }

  /**
   * Check for overlapping requests
   */
  async findOverlapping(
    employeeId: string,
    startDate: string,
    endDate: string,
    excludeId?: string
  ): Promise<LeaveRequest[]> {
    let query = supabase
      .from('leave_requests')
      .select('id, start_date, end_date, status')
      .eq('employee_id', employeeId)
      .in('status', ['Pending WSO', 'Pending Supervisor', 'Approved'])
      .or(`and(start_date.lte.${endDate},end_date.gte.${startDate})`);

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
}

export const leaveRequestRepository = new LeaveRequestRepository();
