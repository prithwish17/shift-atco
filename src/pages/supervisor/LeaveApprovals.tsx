import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUsers';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Filter, CheckCircle, XCircle, Clock, Ban } from 'lucide-react';
import { format } from 'date-fns';
import { LEAVE_STATUS, getLeaveTypeLabel, getLeaveStatusInfo } from '@/lib/leaveConstants';
import { useAllLeaveRequests, useReviewLeaveRequest, useCancelApprovedLeaveRequest } from '@/hooks/useLeaveRequests';
import type { LeaveRequest } from '@/hooks/useLeaveRequests';

export default function LeaveApprovals() {
  const { user, userRole } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const dashboardRole = userRole === 'wso' ? 'wso' : 'supervisor';
  const isWSO = userRole === 'wso';

  const wsoTeam = isWSO ? (profile?.current_shift?.toUpperCase() || '') : '';

  const [teamFilter, setTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (isWSO && wsoTeam) setTeamFilter(wsoTeam);
  }, [isWSO, wsoTeam]);

  const filters = useMemo(() => ({
    team: (teamFilter && teamFilter !== '__all__') ? teamFilter : undefined,
    status: (statusFilter && statusFilter !== '__all__') ? statusFilter : undefined,
    startDate: dateFrom || undefined,
    endDate: dateTo || undefined,
  }), [teamFilter, statusFilter, dateFrom, dateTo]);

  const { data: allRequests = [], isLoading } = useAllLeaveRequests(filters);
  const reviewRequest = useReviewLeaveRequest();
  const cancelApprovedRequest = useCancelApprovedLeaveRequest();

  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<LeaveRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [reviewRemarks, setReviewRemarks] = useState('');

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState('');

  const openReview = (request: LeaveRequest, action: 'approve' | 'reject') => {
    setReviewTarget(request);
    setReviewAction(action);
    setReviewRemarks('');
    setReviewDialogOpen(true);
  };

  const handleReview = async () => {
    if (!reviewTarget || !user) return;
    const isDirectSupervisorApproval = !isWSO && reviewAction === 'approve' && reviewTarget.status === 'Pending WSO';
    try {
      await reviewRequest.mutateAsync({
        id: reviewTarget.id,
        action: reviewAction,
        actor_role: isWSO ? 'wso' : 'supervisor',
        actor_id: user.id,
        remarks: reviewRemarks || undefined,
        direct_approval: isDirectSupervisorApproval,
      });

      const successText = isWSO
        ? reviewAction === 'approve'
          ? 'WSO approved. Sent to supervisor for final approval.'
          : 'Leave rejected by WSO'
        : reviewAction === 'approve'
          ? isDirectSupervisorApproval
            ? 'Leave directly approved by supervisor'
            : 'Leave approved by supervisor'
          : 'Leave rejected by supervisor';

      toast.success(successText);
      setReviewDialogOpen(false);
      setReviewTarget(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to process request');
    }
  };

  const openCancelApproved = (request: LeaveRequest) => {
    setCancelTarget(request);
    setCancelRemarks('');
    setCancelDialogOpen(true);
  };

  const handleCancelApproved = async () => {
    if (!cancelTarget || !user) return;
    try {
      await cancelApprovedRequest.mutateAsync({
        id: cancelTarget.id,
        reviewed_by: user.id,
        actor_role: isWSO ? 'wso' : 'supervisor',
        remarks: cancelRemarks || undefined,
      });
      toast.success('Approved leave cancelled successfully');
      setCancelDialogOpen(false);
      setCancelTarget(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel approved leave');
    }
  };

  const pendingCount = allRequests.filter(r => r.status === 'Pending WSO' || r.status === 'Pending Supervisor').length;
  const pendingWsoCount = allRequests.filter(r => r.status === 'Pending WSO').length;
  const pendingSupervisorCount = allRequests.filter(r => r.status === 'Pending Supervisor').length;
  const approvedCount = allRequests.filter(r => r.status === 'Approved').length;
  const rejectedCount = allRequests.filter(r => r.status === 'Rejected').length;

  const teams = useMemo(() => {
    const t = new Set(allRequests.map(r => r.team).filter(Boolean));
    return [...t].sort();
  }, [allRequests]);

  if (isLoading) {
    return (
      <DashboardLayout role={dashboardRole}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role={dashboardRole}>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Leave Approvals</h1>
          <p className="text-muted-foreground text-sm">Review and manage leave requests</p>
        </div>

        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold">{allRequests.length}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
              <div className="text-xs text-muted-foreground">Pending Total</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold text-yellow-700">{pendingWsoCount}</div>
              <div className="text-xs text-muted-foreground">Pending WSO</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold text-amber-700">{pendingSupervisorCount}</div>
              <div className="text-xs text-muted-foreground">Pending Supervisor</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold text-green-600">{approvedCount}</div>
              <div className="text-xs text-muted-foreground">Approved</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold text-red-600">{rejectedCount}</div>
              <div className="text-xs text-muted-foreground">Rejected</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Filter className="h-4 w-4" />
                Filters:
              </div>
              <div className="min-w-[140px]">
                <Select value={teamFilter} onValueChange={setTeamFilter} disabled={isWSO}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={isWSO && wsoTeam ? `Team ${wsoTeam}` : 'All Teams'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Teams</SelectItem>
                    {teams.map(t => (
                      <SelectItem key={t} value={t!}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[150px]">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Status</SelectItem>
                    {LEAVE_STATUS.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="h-8 text-xs w-[140px]"
                placeholder="From"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-8 text-xs w-[140px]"
                placeholder="To"
              />
              {(teamFilter || statusFilter || dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => { setTeamFilter(''); setStatusFilter(''); setDateFrom(''); setDateTo(''); }}
                >
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2.5 text-left font-medium">Employee</th>
                    <th className="px-4 py-2.5 text-left font-medium">Dates</th>
                    <th className="px-4 py-2.5 text-left font-medium">Type</th>
                    <th className="px-4 py-2.5 text-center font-medium">Days</th>
                    <th className="px-4 py-2.5 text-center font-medium">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium">Reason / Approval Trail</th>
                    <th className="px-4 py-2.5 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allRequests.map((req) => {
                    const statusInfo = getLeaveStatusInfo(req.status);
                    const canReview = isWSO
                      ? req.status === 'Pending WSO'
                      : req.status === 'Pending Supervisor' || req.status === 'Pending WSO';
                    const isDirectSupervisorCandidate = !isWSO && req.status === 'Pending WSO';

                    return (
                      <tr key={req.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium">{req.employee_name}</div>
                          {req.team && (
                            <span className="text-[10px] text-muted-foreground uppercase">Team {req.team}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {format(new Date(req.start_date), 'dd MMM')}
                          {req.start_date !== req.end_date && ` — ${format(new Date(req.end_date), 'dd MMM')}`}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="font-normal text-[10px]">
                            {getLeaveTypeLabel(req.leave_type)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center font-medium">{req.total_days}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={`text-[10px] font-medium border ${statusInfo.color}`}>
                            {statusInfo.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[280px]">
                          <div className="space-y-1">
                            <div className="truncate">{req.reason || '—'}</div>
                            {req.wso_approved_at && (
                              <div className="text-[11px] text-amber-700">
                                Approved by WSO{req.wso_approver_profile?.full_name ? `: ${req.wso_approver_profile.full_name}` : ''}
                              </div>
                            )}
                            {req.status === 'Approved' && req.supervisor_approved_at && (
                              <div className="text-[11px] text-green-700">
                                {req.direct_supervisor_approved ? 'Directly approved by Supervisor' : 'Final approved by Supervisor'}
                                {req.supervisor_approver_profile?.full_name ? `: ${req.supervisor_approver_profile.full_name}` : ''}
                              </div>
                            )}
                            {req.wso_comments && <div className="text-[11px]">WSO remarks: {req.wso_comments}</div>}
                            {req.supervisor_comments && <div className="text-[11px]">Supervisor remarks: {req.supervisor_comments}</div>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {canReview ? (
                            <div className="flex gap-1 justify-center">
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs px-2"
                                onClick={() => openReview(req, 'approve')}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                {isWSO ? 'Approve & Forward' : isDirectSupervisorCandidate ? 'Direct Approve' : 'Final Approve'}
                              </Button>
                              {!isDirectSupervisorCandidate && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 text-xs px-2"
                                  onClick={() => openReview(req, 'reject')}
                                >
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Reject
                                </Button>
                              )}
                            </div>
                          ) : req.status === 'Approved' ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 text-xs px-2"
                              onClick={() => openCancelApproved(req)}
                            >
                              <Ban className="h-3 w-3 mr-1" />
                              Cancel
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {req.status === 'Pending Supervisor' && isWSO
                                ? 'Awaiting supervisor final approval'
                                : (req.remarks ? `"${req.remarks}"` : '—')}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {allRequests.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-muted-foreground">
                        <Clock className="h-10 w-10 mx-auto mb-2 opacity-40" />
                        No leave requests found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {reviewAction === 'approve'
                  ? (isWSO
                    ? 'Approve & Forward to Supervisor'
                    : reviewTarget?.status === 'Pending WSO'
                      ? 'Direct Approve'
                      : 'Final Approve')
                  : 'Reject'} Leave Request
              </DialogTitle>
              <DialogDescription>
                {reviewTarget && (
                  <>
                    <strong>{reviewTarget.employee_name}</strong> — {getLeaveTypeLabel(reviewTarget.leave_type)} ({reviewTarget.total_days} day{reviewTarget.total_days > 1 ? 's' : ''})
                    <br />
                    {format(new Date(reviewTarget.start_date), 'dd MMM yyyy')}
                    {reviewTarget.start_date !== reviewTarget.end_date && ` — ${format(new Date(reviewTarget.end_date), 'dd MMM yyyy')}`}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Remarks (optional)</label>
                <Textarea
                  value={reviewRemarks}
                  onChange={e => setReviewRemarks(e.target.value)}
                  placeholder={isWSO ? 'WSO remarks...' : 'Supervisor remarks...'}
                  rows={3}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>Cancel</Button>
                <Button
                  variant={reviewAction === 'approve' ? 'default' : 'destructive'}
                  onClick={handleReview}
                  disabled={reviewRequest.isPending}
                >
                  {reviewRequest.isPending
                    ? 'Processing...'
                    : reviewAction === 'approve'
                      ? (isWSO
                        ? 'Approve & Forward'
                        : reviewTarget?.status === 'Pending WSO'
                          ? 'Direct Approve'
                          : 'Final Approve')
                      : 'Reject'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel Approved Leave</DialogTitle>
              <DialogDescription>
                {cancelTarget && (
                  <>
                    <strong>{cancelTarget.employee_name}</strong> — {getLeaveTypeLabel(cancelTarget.leave_type)} ({cancelTarget.total_days} day{cancelTarget.total_days > 1 ? 's' : ''})
                    <br />
                    {format(new Date(cancelTarget.start_date), 'dd MMM yyyy')}
                    {cancelTarget.start_date !== cancelTarget.end_date && ` — ${format(new Date(cancelTarget.end_date), 'dd MMM yyyy')}`}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">This will mark the approved leave request as cancelled.</p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Remarks (optional)</label>
                <Textarea
                  value={cancelRemarks}
                  onChange={e => setCancelRemarks(e.target.value)}
                  placeholder="Reason for cancellation..."
                  rows={3}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>Keep Approved</Button>
                <Button variant="destructive" onClick={handleCancelApproved} disabled={cancelApprovedRequest.isPending}>
                  {cancelApprovedRequest.isPending ? 'Cancelling...' : 'Yes, Cancel Leave'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
