// Service Layer - Leave Request Orchestration

import type { LeaveRequest, LeaveRequestInsert, LeaveRequestFilters } from '@/domain/leave';
import { leaveRequestRepository } from '@/data-access';
import { leaveBalanceService } from './leave-balance.service';
import { compOffService } from './comp-off.service';
import { scheduleSyncService } from './schedule-sync.service';
import { notificationService } from './notification.service';
import { logSupervisorEdit } from '@/lib/supervisorAuditLog';
import { hasOverlappingRequests } from '@/domain/leave';

export class LeaveRequestService {
  /**
   * Get leave requests for an employee
   */
  async getMyRequests(userId: string): Promise<LeaveRequest[]> {
    return leaveRequestRepository.findByEmployeeId(userId);
  }

  /**
   * Get all leave requests (for supervisors)
   */
  async getAllRequests(filters?: LeaveRequestFilters): Promise<LeaveRequest[]> {
    return leaveRequestRepository.findAll(filters);
  }

  /**
   * Create a new leave request with validation
   */
  async createRequest(request: LeaveRequestInsert): Promise<LeaveRequest> {
    // Validate no overlapping requests
    const overlapping = await leaveRequestRepository.findOverlapping(
      request.employee_id,
      request.start_date,
      request.end_date
    );

    if (overlapping.length > 0) {
      throw new Error('You already have a leave request for overlapping dates.');
    }

    return leaveRequestRepository.create(request);
  }

  /**
   * Cancel a pending leave request (employee action)
   */
  async cancelRequest(id: string): Promise<LeaveRequest> {
    return leaveRequestRepository.cancel(id);
  }

  /**
   * Cancel an approved leave request (supervisor action)
   */
  async cancelApprovedRequest(
    id: string,
    reviewedBy: string,
    actorRole: 'wso' | 'supervisor',
    remarks?: string
  ): Promise<LeaveRequest> {
    // Update request status
    const request = await leaveRequestRepository.cancelApproved(id, reviewedBy, actorRole, remarks);

    // Clear comp-off allocation if applicable
    await compOffService.clearCompOffForLeave(request);

    // Restore schedule
    await scheduleSyncService.restoreScheduleAfterCancellation(request);

    // Restore balance
    await leaveBalanceService.restoreBalance(request);

    // Send notification
    await notificationService.sendLeaveStatusNotification(request, 'Cancelled');

    // Audit log
    logSupervisorEdit({
      action: 'update',
      table: 'leave_requests',
      description: `Cancelled approved leave for ${request.employee_name}: ${request.leave_type} (${request.start_date} to ${request.end_date})`,
      recordId: request.id,
      after: { status: 'Cancelled', leave_type: request.leave_type },
    });

    return request;
  }

  /**
   * Review a leave request (approve or reject)
   */
  async reviewRequest(
    id: string,
    action: 'approve' | 'reject',
    actorRole: 'wso' | 'supervisor',
    actorId: string,
    remarks?: string,
    directApproval?: boolean
  ): Promise<LeaveRequest> {
    // Update request status
    const request = await leaveRequestRepository.review(
      id,
      action,
      actorRole,
      actorId,
      remarks,
      directApproval
    );

    // If approved, trigger side effects
    if (request.status === 'Approved') {
      await compOffService.allocateCompOffForLeave(request);
      await compOffService.syncCHCompOffCredits(request);
      await scheduleSyncService.applyLeaveToSchedule(request);
      await leaveBalanceService.deductBalance(request);
    }

    // Send notification
    if (request.status === 'Approved' || request.status === 'Rejected') {
      await notificationService.sendLeaveStatusNotification(request, request.status);
    }

    // Audit log
    logSupervisorEdit({
      action: 'update',
      table: 'leave_requests',
      description: `${request.status} leave for ${request.employee_name}: ${request.leave_type} (${request.start_date} to ${request.end_date})`,
      recordId: request.id,
      after: { 
        status: request.status, 
        leave_type: request.leave_type,
        start_date: request.start_date,
        end_date: request.end_date,
      },
    });

    return request;
  }

  /**
   * Toggle SAP updated flag
   */
  async markSapUpdated(id: string, sapUpdated: boolean): Promise<LeaveRequest> {
    return leaveRequestRepository.markSapUpdated(id, sapUpdated);
  }

  /**
   * Get count summary by leave type
   */
  async getCountSummary(employeeId: string): Promise<Record<string, number>> {
    return leaveRequestRepository.getCountSummary(employeeId);
  }

  /**
   * Validate a leave request before submission
   */
  async validateRequest(
    request: Omit<LeaveRequestInsert, 'employee_id' | 'employee_name'>,
    userId: string
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check overlapping requests
    const overlapping = await leaveRequestRepository.findOverlapping(
      userId,
      request.start_date,
      request.end_date
    );

    if (overlapping.length > 0) {
      errors.push('You already have a leave request for overlapping dates.');
    }

    // Check balance if applicable
    const balanceCheck = await leaveBalanceService.checkSufficientBalance(
      userId,
      request.leave_type,
      request.total_days,
      0 // TODO: Calculate actual pending days
    );

    if (!balanceCheck.sufficient) {
      errors.push(`Insufficient leave balance. Available: ${balanceCheck.available}, Required: ${balanceCheck.required}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export const leaveRequestService = new LeaveRequestService();
