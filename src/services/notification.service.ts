// Service Layer - Notification Service

import type { LeaveRequest } from '@/domain/leave';
import { supabase } from '@/integrations/supabase/client';
import { captureError } from '@/lib/sentryHelpers';

export class NotificationService {
  /**
   * Send leave status notification to employee
   */
  async sendLeaveStatusNotification(
    request: LeaveRequest,
    status: 'Approved' | 'Rejected' | 'Cancelled'
  ): Promise<void> {
    const title = `Leave ${status}`;
    const body = `Your ${request.leave_type} leave (${request.start_date} to ${request.end_date}) has been ${status.toLowerCase()}.`;

    try {
      await supabase.functions.invoke('send-notification', {
        body: {
          user_ids: [request.employee_id],
          title,
          body,
          url: '/employee/leave',
          category: 'leave_status',
          metadata: {
            leave_request_id: request.id,
            leave_type: request.leave_type,
            status,
            start_date: request.start_date,
            end_date: request.end_date,
          },
        },
      });
    } catch (err) {
      // Fire-and-forget: log but don't throw
      captureError(err, { tags: { silent_failure: 'true', flow: 'leave_notification' } });
    }
  }

  /**
   * Send approval request notification to supervisor
   */
  async sendApprovalRequestNotification(
    request: LeaveRequest,
    supervisorId: string
  ): Promise<void> {
    try {
      await supabase.functions.invoke('send-notification', {
        body: {
          user_ids: [supervisorId],
          title: 'New Leave Request',
          body: `${request.employee_name} has submitted a ${request.leave_type} leave request for ${request.total_days} day(s).`,
          url: '/supervisor/leaves',
          category: 'leave_approval',
          metadata: {
            leave_request_id: request.id,
            employee_name: request.employee_name,
            leave_type: request.leave_type,
            total_days: request.total_days,
          },
        },
      });
    } catch (err) {
      captureError(err, { tags: { silent_failure: 'true', flow: 'approval_request_notification' } });
    }
  }
}

export const notificationService = new NotificationService();
