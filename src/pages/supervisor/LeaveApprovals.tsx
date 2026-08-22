import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUsers';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Filter, CheckCircle, XCircle, Clock, Ban, ListChecks, Eye, ExternalLink, Loader2, Paperclip } from 'lucide-react';
import { format } from 'date-fns';
import { LEAVE_STATUS, getLeaveTypeLabel, getLeaveStatusInfo } from '@/lib/leaveConstants';
import { useAllLeaveRequests, useReviewLeaveRequest, useCancelApprovedLeaveRequest } from '@/hooks/useLeaveRequests';
import type { LeaveRequest } from '@/hooks/useLeaveRequests';
import { useNavigate } from 'react-router-dom';
import { allocateCompOffCandidates, buildCompOffAllocationCandidates } from '@/lib/compOffAllocation';

type ReviewCompOffAllocation = {
  employeeCode: string;
  requestedDays: number;
  reservedDays: number;
  /** True when the applicant chose these entries, rather than FIFO picking them. */
  isExplicitSelection: boolean;
  allocation: ReturnType<typeof allocateCompOffCandidates>;
};

async function fetchLeaveAttachmentPresignedUrl(leaveRequestId: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const resp = await fetch(
    `/api/leave-document-url?leave_request_id=${encodeURIComponent(leaveRequestId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(body || `Failed (${resp.status})`);
  }

  const json = (await resp.json()) as { url: string };
  return json.url;
}

/** Opens employee-uploaded leave document in a new browser tab (PDF/image). */
function LeaveAttachmentLink({
  leaveRequestId,
  fileLabel,
  variant = 'link',
  className,
}: {
  leaveRequestId: string;
  fileLabel?: string | null;
  variant?: 'link' | 'outline';
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    setLoading(true);
    try {
      const url = await fetchLeaveAttachmentPresignedUrl(leaveRequestId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error((err as Error).message || 'Failed to open document');
    } finally {
      setLoading(false);
    }
  };

  const label = fileLabel?.trim() || 'View uploaded document';

  if (variant === 'outline') {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleOpen}
        disabled={loading}
        className={`gap-1.5 text-xs ${className ?? ''}`}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ExternalLink className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={loading}
      className={`inline-flex max-w-full min-w-0 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50 ${className ?? ''}`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <Paperclip className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 truncate">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
    </button>
  );
}

function getWsoShiftLabel(team: string | null | undefined) {
  const normalizedTeam = String(team || '').trim().toUpperCase();
  if (!normalizedTeam) return 'WSO';
  if (normalizedTeam === 'GENERAL' || normalizedTeam === 'G') return 'WSO - General';
  return `WSO - Shift ${normalizedTeam}`;
}

function formatLeaveRange(startDate: string, endDate: string) {
  const start = format(new Date(startDate), 'dd MMM yyyy');
  const end = format(new Date(endDate), 'dd MMM yyyy');
  return startDate === endDate ? start : `${start} — ${end}`;
}

export default function LeaveApprovals() {
  const { user, userRole } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const dashboardRole = userRole === 'wso' ? 'wso' : 'supervisor';
  const isWSO = userRole === 'wso';
  const navigate = useNavigate();
  const registerPath = userRole === 'wso' ? '/wso/approved-leaves' : '/supervisor/approved-leaves';

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

  const { data: allRequests = [], isLoading, isError: requestsError } = useAllLeaveRequests(filters);
  const reviewRequest = useReviewLeaveRequest();
  const cancelApprovedRequest = useCancelApprovedLeaveRequest();

  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<LeaveRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | 'view'>('approve');
  const [reviewRemarks, setReviewRemarks] = useState('');

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState('');

  const detailTarget = reviewDialogOpen ? reviewTarget : null;

  const reviewCompOffAllocationQuery = useQuery({
    queryKey: ['review-comp-off-allocation', detailTarget?.id],
    enabled: reviewDialogOpen && detailTarget?.leave_type === 'COMP_OFF' && Boolean(detailTarget?.employee_id),
    queryFn: async (): Promise<ReviewCompOffAllocation> => {
      if (!detailTarget?.employee_id) {
        throw new Error('Selected request is missing employee identity.');
      }

      const { data: profileRow, error: profileError } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', detailTarget.employee_id)
        .maybeSingle();
      if (profileError) throw profileError;

      const employeeCode = String(profileRow?.employee_id || '').trim();
      if (!employeeCode) {
        throw new Error('Employee profile is missing employee_id required for comp-off allocation review.');
      }

      const [{ data: earnedRows, error: earnedRowsError }, { data: pendingRequests, error: pendingRequestsError }] = await Promise.all([
        supabase
          .from('employee_leave_records' as any)
          .select('id, leave_category, source_event_type, leave_date, leave_used_on, duty_code, raw_leave_used_value, metadata, raw_event')
          .eq('emp_id', employeeCode)
          .in('leave_category', ['COMP_OFF', 'COMP_OFF_EARNED', 'LAST_YEAR_CH_DUTY', 'OPE'])
          .order('leave_date', { ascending: true }),
        supabase
          .from('leave_requests' as any)
          .select('id, total_days')
          .eq('employee_id', detailTarget.employee_id)
          .eq('leave_type', 'COMP_OFF')
          .in('status', ['Pending WSO', 'Pending Supervisor'])
          .neq('id', detailTarget.id),
      ]);

      if (earnedRowsError) throw earnedRowsError;
      if (pendingRequestsError) throw pendingRequestsError;

      const candidates = buildCompOffAllocationCandidates((earnedRows || []) as any[]);
      // Cast through the row shape: the generated Supabase types are stale for
      // leave_requests, so without this `reservedDays` inherits SelectQueryError
      // and poisons every arithmetic use downstream.
      const reservedDays: number = ((pendingRequests || []) as Array<{ total_days?: number | null }>)
        .reduce((sum: number, row) => sum + Math.ceil(Number(row.total_days || 0)), 0);
      const requestedDays = Math.ceil(Number(detailTarget.total_days || 0));

      // Show what will ACTUALLY be consumed.
      //
      // This preview used to recompute the allocation independently of the one the
      // applicant saw and of the one approval would perform, so the entries an
      // approver signed off were not guaranteed to be the entries taken. When the
      // request carries an explicit selection, show exactly that; older requests
      // with no selection still fall back to the FIFO preview.
      const chosenIds = Array.isArray(detailTarget.comp_off_record_ids)
        ? (detailTarget.comp_off_record_ids as unknown[]).map(String).filter(Boolean)
        : [];

      if (chosenIds.length > 0) {
        const byId = new Map(candidates.map((candidate) => [candidate.recordId, candidate]));
        const selectedEntries = chosenIds
          .map((id) => byId.get(id))
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

        return {
          employeeCode,
          requestedDays,
          reservedDays,
          isExplicitSelection: true,
          allocation: {
            requestedDays,
            availableCount: candidates.filter((c) => c.status === 'available').length,
            reservedCount: reservedDays,
            remainingAfterReservations: Math.max(
              candidates.filter((c) => c.status === 'available').length - reservedDays,
              0,
            ),
            selectedEntries,
            canCoverRequest: selectedEntries.length >= requestedDays,
          },
        };
      }

      return {
        employeeCode,
        requestedDays,
        reservedDays,
        isExplicitSelection: false,
        allocation: allocateCompOffCandidates(candidates, requestedDays, reservedDays),
      };
    },
  });

  /** Fresh fetch so attachment_path/meta always load (list cache can be stale vs DB). */
  const reviewAttachmentQuery = useQuery({
    queryKey: ['leave-review-attachment', detailTarget?.id],
    enabled: Boolean(reviewDialogOpen && detailTarget?.id),
    staleTime: 0,
    queryFn: async () => {
      const id = detailTarget!.id;
      const { data, error } = await supabase
        .from('leave_requests' as any)
        .select('attachment_path, attachment_meta')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as Pick<LeaveRequest, 'attachment_path' | 'attachment_meta'>;
    },
  });

  const resolvedAttachmentPath =
    reviewAttachmentQuery.data?.attachment_path ?? reviewTarget?.attachment_path ?? null;
  const resolvedAttachmentMeta =
    reviewAttachmentQuery.data?.attachment_meta ?? reviewTarget?.attachment_meta ?? null;

  const openReview = (request: LeaveRequest, action: 'approve' | 'reject' | 'view') => {
    setReviewTarget(request);
    setReviewAction(action);
    setReviewRemarks('');
    setReviewDialogOpen(true);
  };

  const handleReview = async () => {
    if (!reviewTarget || !user) return;
    const isDirectSupervisorApproval = !isWSO && reviewTarget.status === 'Pending WSO';
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

  if (requestsError) {
    return (
      <DashboardLayout role={dashboardRole}>
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30">
          <CardContent className="flex items-center gap-3 py-4">
            <Ban className="h-5 w-5 text-red-500 shrink-0" />
            <span className="text-sm text-red-700 dark:text-red-400">
              Failed to load leave requests. Please try refreshing the page.
            </span>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

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
      <div className="space-y-4 sm:space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-2.5 sm:gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">Leave Approvals</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">Review and manage leave requests</p>
          </div>
          <Button variant="outline" onClick={() => navigate(registerPath)} className="h-8 shrink-0 px-2.5 text-xs sm:h-10 sm:px-4 sm:text-sm">
            <ListChecks className="mr-1.5 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
            SAP Approved Register
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-6">
          <Card className="rounded-xl sm:rounded-2xl">
            <CardContent className="px-2 py-3 text-center sm:pt-4 sm:pb-4">
              <div className="text-lg font-bold sm:text-2xl">{allRequests.length}</div>
              <div className="text-[10px] leading-3.5 text-muted-foreground sm:text-xs">Total</div>
            </CardContent>
          </Card>
          <Card className="rounded-xl sm:rounded-2xl">
            <CardContent className="px-2 py-3 text-center sm:pt-4 sm:pb-4">
              <div className="text-lg font-bold text-yellow-600 sm:text-2xl">{pendingCount}</div>
              <div className="text-[10px] leading-3.5 text-muted-foreground sm:text-xs">Pending Total</div>
            </CardContent>
          </Card>
          <Card className="rounded-xl sm:rounded-2xl">
            <CardContent className="px-2 py-3 text-center sm:pt-4 sm:pb-4">
              <div className="text-lg font-bold text-yellow-700 sm:text-2xl">{pendingWsoCount}</div>
              <div className="text-[10px] leading-3.5 text-muted-foreground sm:text-xs">Pending WSO</div>
            </CardContent>
          </Card>
          <Card className="rounded-xl sm:rounded-2xl">
            <CardContent className="px-2 py-3 text-center sm:pt-4 sm:pb-4">
              <div className="text-lg font-bold text-amber-700 sm:text-2xl">{pendingSupervisorCount}</div>
              <div className="text-[10px] leading-3.5 text-muted-foreground sm:text-xs">Pending Supervisor</div>
            </CardContent>
          </Card>
          <Card className="rounded-xl sm:rounded-2xl">
            <CardContent className="px-2 py-3 text-center sm:pt-4 sm:pb-4">
              <div className="text-lg font-bold text-green-600 sm:text-2xl">{approvedCount}</div>
              <div className="text-[10px] leading-3.5 text-muted-foreground sm:text-xs">Approved</div>
            </CardContent>
          </Card>
          <Card className="rounded-xl sm:rounded-2xl">
            <CardContent className="px-2 py-3 text-center sm:pt-4 sm:pb-4">
              <div className="text-lg font-bold text-red-600 sm:text-2xl">{rejectedCount}</div>
              <div className="text-[10px] leading-3.5 text-muted-foreground sm:text-xs">Rejected</div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-xl sm:rounded-2xl">
          <CardContent className="px-3 py-3 sm:pt-4 sm:pb-4">
            <div className="flex flex-wrap items-end gap-2 sm:gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground sm:text-sm">
                <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Filters:
              </div>
              <div className="min-w-[118px] flex-1 sm:min-w-[140px] sm:flex-none">
                <Select value={teamFilter} onValueChange={setTeamFilter} disabled={isWSO}>
                  <SelectTrigger className="h-8 text-[11px] sm:text-xs">
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
              <div className="min-w-[126px] flex-1 sm:min-w-[150px] sm:flex-none">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-[11px] sm:text-xs">
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
                className="h-8 w-[118px] text-[11px] sm:w-[140px] sm:text-xs"
                placeholder="From"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-8 w-[118px] text-[11px] sm:w-[140px] sm:text-xs"
                placeholder="To"
              />
              {(teamFilter || statusFilter || dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-[11px] sm:text-xs"
                  onClick={() => { setTeamFilter(''); setStatusFilter(''); setDateFrom(''); setDateTo(''); }}
                >
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-xl sm:rounded-2xl">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-[11px] sm:text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-2.5 py-2 text-left text-[10px] font-medium sm:px-4 sm:py-2.5 sm:text-sm">S/N</th>
                    <th className="px-2.5 py-2 text-left text-[10px] font-medium sm:px-4 sm:py-2.5 sm:text-sm">Employee</th>
                    <th className="px-2.5 py-2 text-left text-[10px] font-medium sm:px-4 sm:py-2.5 sm:text-sm">Dates</th>
                    <th className="px-2.5 py-2 text-left text-[10px] font-medium sm:px-4 sm:py-2.5 sm:text-sm">Type</th>
                    <th className="px-2.5 py-2 text-center text-[10px] font-medium sm:px-4 sm:py-2.5 sm:text-sm">Days</th>
                    <th className="px-2.5 py-2 text-center text-[10px] font-medium sm:px-4 sm:py-2.5 sm:text-sm">Status</th>
                    <th className="px-2.5 py-2 text-left text-[10px] font-medium sm:px-4 sm:py-2.5 sm:text-sm">Reason / Approval Trail</th>
                    <th className="px-2.5 py-2 text-center text-[10px] font-medium sm:px-4 sm:py-2.5 sm:text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allRequests.map((req, index) => {
                    const statusInfo = getLeaveStatusInfo(req.status);
                    const canReview = isWSO
                      ? req.status === 'Pending WSO'
                      : req.status === 'Pending Supervisor' || req.status === 'Pending WSO';
                    const isDirectSupervisorCandidate = !isWSO && req.status === 'Pending WSO';

                    return (
                      <tr key={req.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-2.5 py-2.5 font-medium text-muted-foreground sm:px-4 sm:py-3">{index + 1}</td>
                        <td className="px-2.5 py-2.5 sm:px-4 sm:py-3">
                          <div className="text-[11px] font-medium sm:text-sm">{req.employee_name}</div>
                          {req.team && (
                            <span className="text-[9px] uppercase text-muted-foreground sm:text-[10px]">Team {req.team}</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2.5 whitespace-nowrap sm:px-4 sm:py-3">
                          {format(new Date(req.start_date), 'dd MMM')}
                          {req.start_date !== req.end_date && ` — ${format(new Date(req.end_date), 'dd MMM')}`}
                        </td>
                        <td className="px-2.5 py-2.5 sm:px-4 sm:py-3">
                          <Badge variant="outline" className="font-normal text-[9px] sm:text-[10px]">
                            {getLeaveTypeLabel(req.leave_type)}
                          </Badge>
                        </td>
                        <td className="px-2.5 py-2.5 text-center font-medium sm:px-4 sm:py-3">{req.total_days}</td>
                        <td className="px-2.5 py-2.5 text-center sm:px-4 sm:py-3">
                          <Badge className={`border text-[9px] font-medium sm:text-[10px] ${statusInfo.color}`}>
                            {statusInfo.label}
                          </Badge>
                        </td>
                        <td className="max-w-[240px] px-2.5 py-2.5 text-[11px] text-muted-foreground sm:max-w-[280px] sm:px-4 sm:py-3 sm:text-xs">
                          <div className="space-y-1">
                            <div className="truncate">{req.reason || '—'}</div>
                            {req.wso_approved_at && (
                              <div className="text-[10px] text-amber-700 sm:text-[11px]">
                                Approved by {getWsoShiftLabel(req.team)}
                              </div>
                            )}
                            {req.status === 'Approved' && req.supervisor_approved_at && (
                              <div className="text-[10px] text-green-700 sm:text-[11px]">
                                {req.direct_supervisor_approved ? 'Directly approved by Supervisor' : 'Final approved by Supervisor'}
                              </div>
                            )}
                            {req.wso_comments && <div className="text-[10px] sm:text-[11px]">WSO remarks: {req.wso_comments}</div>}
                            {req.supervisor_comments && <div className="text-[10px] sm:text-[11px]">Supervisor remarks: {req.supervisor_comments}</div>}
                            {req.attachment_path && (
                              <div className="flex items-center gap-1 text-[10px] text-primary sm:text-[11px]">
                                <Paperclip className="h-3 w-3 shrink-0" />
                                <span className="font-medium">Document attached</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-2.5 py-2.5 text-center sm:px-4 sm:py-3">
                          {canReview ? (
                            <div className="flex flex-wrap justify-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-1.5 text-[10px] sm:h-7 sm:px-2 sm:text-xs"
                                onClick={() => openReview(req, 'view')}
                              >
                                <Eye className="mr-0.5 h-3 w-3 sm:mr-1" />
                                View
                              </Button>
                              {req.attachment_path && (
                                <LeaveAttachmentLink
                                  leaveRequestId={req.id}
                                  fileLabel="View Doc"
                                  variant="outline"
                                  className="h-6 px-1.5 text-[10px] sm:h-7 sm:px-2 sm:text-xs"
                                />
                              )}
                              <Button
                                size="sm"
                                variant="default"
                                className="h-6 px-1.5 text-[10px] sm:h-7 sm:px-2 sm:text-xs"
                                onClick={() => openReview(req, 'approve')}
                              >
                                <CheckCircle className="mr-0.5 h-3 w-3 sm:mr-1" />
                                {isWSO ? 'Approve & Forward' : isDirectSupervisorCandidate ? 'Direct Approve' : 'Final Approve'}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-6 px-1.5 text-[10px] sm:h-7 sm:px-2 sm:text-xs"
                                onClick={() => openReview(req, 'reject')}
                              >
                                <XCircle className="mr-0.5 h-3 w-3 sm:mr-1" />
                                Reject
                              </Button>
                            </div>
                          ) : req.status === 'Approved' ? (
                            <div className="flex flex-wrap justify-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-1.5 text-[10px] sm:h-7 sm:px-2 sm:text-xs"
                                onClick={() => openReview(req, 'view')}
                              >
                                <Eye className="mr-0.5 h-3 w-3 sm:mr-1" />
                                View
                              </Button>
                              {req.attachment_path && (
                                <LeaveAttachmentLink
                                  leaveRequestId={req.id}
                                  fileLabel="View Doc"
                                  variant="outline"
                                  className="h-6 px-1.5 text-[10px] sm:h-7 sm:px-2 sm:text-xs"
                                />
                              )}
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-6 px-1.5 text-[10px] sm:h-7 sm:px-2 sm:text-xs"
                                onClick={() => openCancelApproved(req)}
                              >
                                <Ban className="mr-0.5 h-3 w-3 sm:mr-1" />
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-1.5 text-[10px] sm:h-7 sm:px-2 sm:text-xs"
                                onClick={() => openReview(req, 'view')}
                              >
                                <Eye className="mr-0.5 h-3 w-3 sm:mr-1" />
                                View
                              </Button>
                              {req.attachment_path && (
                                <LeaveAttachmentLink
                                  leaveRequestId={req.id}
                                  fileLabel="View Doc"
                                  variant="outline"
                                  className="h-6 px-1.5 text-[10px] sm:h-7 sm:px-2 sm:text-xs"
                                />
                              )}
                              <span className="text-[10px] text-muted-foreground sm:text-xs">
                                {req.status === 'Pending Supervisor' && isWSO
                                  ? 'Awaiting supervisor final approval'
                                  : (req.remarks ? `"${req.remarks}"` : '—')}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {allRequests.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-xs text-muted-foreground sm:py-12 sm:text-sm">
                        <Clock className="mx-auto mb-2 h-8 w-8 opacity-40 sm:h-10 sm:w-10" />
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
          <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl overflow-hidden p-0 sm:w-full">
            <DialogHeader>
              <div className="px-3 pt-3 sm:px-6 sm:pt-6">
                <DialogTitle className="text-base sm:text-lg">
                  {reviewAction === 'view'
                    ? 'Leave Request Details'
                    : reviewAction === 'approve'
                    ? (isWSO
                      ? 'Approve & Forward to Supervisor'
                      : reviewTarget?.status === 'Pending WSO'
                        ? 'Direct Approve'
                        : 'Final Approve')
                    : 'Reject'} Leave Request
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-xs sm:mt-2 sm:text-sm">
                  {reviewAction === 'view'
                    ? 'View the full leave request details.'
                    : 'Review the full leave request details before taking action.'}
                </DialogDescription>
              </div>
            </DialogHeader>
            <div className="max-h-[85vh] overflow-y-auto px-3 pb-3 sm:px-6 sm:pb-6">
              {reviewTarget && (
                <div className="space-y-3 pt-2 sm:space-y-4">
                  {resolvedAttachmentPath ? (
                    <div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="flex gap-2 text-xs sm:text-sm">
                        <Paperclip className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                        <div>
                          <div className="font-semibold text-foreground">Employee attachment</div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
                            Opens in a new browser tab (PDF or image).
                            {resolvedAttachmentMeta?.mime && (
                              <span className="ml-1 opacity-90">
                                ({resolvedAttachmentMeta.mime}
                                {typeof resolvedAttachmentMeta.size === 'number'
                                  ? ` · ${Math.round(resolvedAttachmentMeta.size / 1024)} KB`
                                  : ''}
                                )
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <LeaveAttachmentLink
                        leaveRequestId={reviewTarget.id}
                        fileLabel={
                          resolvedAttachmentMeta?.original_name?.trim()
                            ? `Open ${resolvedAttachmentMeta.original_name.trim()}`
                            : 'View uploaded document'
                        }
                        variant="link"
                        className="sm:max-w-[min(100%,18rem)] text-xs sm:text-sm"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-muted-foreground/20 bg-muted/30 px-3 py-2.5">
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
                      <span className="text-xs text-muted-foreground sm:text-sm">No document attached by employee</span>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Employee</div>
                      <div className="mt-1 text-xs font-semibold break-words sm:text-sm">{reviewTarget.employee_name}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Team / Shift</div>
                      <div className="mt-1 text-xs font-semibold sm:text-sm">{reviewTarget.team ? `Team ${reviewTarget.team}` : 'Not specified'}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:col-span-2 sm:p-3 xl:col-span-1">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</div>
                      <div className="mt-1">
                        <Badge className={`border text-[9px] font-medium sm:text-[10px] ${getLeaveStatusInfo(reviewTarget.status).color}`}>
                          {getLeaveStatusInfo(reviewTarget.status).label}
                        </Badge>
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Leave Type</div>
                      <div className="mt-1 text-xs font-semibold sm:text-sm">{getLeaveTypeLabel(reviewTarget.leave_type)}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Leave Dates</div>
                      <div className="mt-1 text-xs font-semibold sm:text-sm">{formatLeaveRange(reviewTarget.start_date, reviewTarget.end_date)}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total Days</div>
                      <div className="mt-1 text-xs font-semibold sm:text-sm">{reviewTarget.total_days} day{reviewTarget.total_days > 1 ? 's' : ''}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:col-span-2 sm:p-3 xl:col-span-1">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Applied On SAP</div>
                      <div className="mt-1">
                        <Badge
                          variant="outline"
                          className={`${reviewTarget.sap_applied === true
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                            : reviewTarget.sap_applied === false
                              ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
                              : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'} text-[9px] sm:text-[10px]`}
                        >
                          {reviewTarget.sap_applied === true ? 'Yes' : reviewTarget.sap_applied === false ? 'No' : 'Not Provided'}
                        </Badge>
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:col-span-2 sm:p-3 xl:col-span-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Reason</div>
                      <div className="mt-1 text-xs whitespace-pre-wrap break-words sm:text-sm">{reviewTarget.reason || '—'}</div>
                    </div>
                  </div>

                  <div className="rounded-lg border p-2.5 sm:p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Approval Trail</div>
                    <div className="mt-2 space-y-2 text-xs sm:text-sm">
                      <div>
                        <span className="font-medium">Applied:</span>{' '}
                        <span>{format(new Date(reviewTarget.applied_at), 'dd MMM yyyy, hh:mm a')}</span>
                      </div>
                      {reviewTarget.wso_approved_at && (
                        <div>
                          <span className="font-medium">WSO Approval:</span>{' '}
                          <span>{getWsoShiftLabel(reviewTarget.team)} on {format(new Date(reviewTarget.wso_approved_at), 'dd MMM yyyy, hh:mm a')}</span>
                        </div>
                      )}
                      {reviewTarget.supervisor_approved_at && (
                        <div>
                          <span className="font-medium">Supervisor Approval:</span>{' '}
                          <span>
                            {reviewTarget.direct_supervisor_approved ? 'Direct approval' : 'Final approval'}
                            {' '}on {format(new Date(reviewTarget.supervisor_approved_at), 'dd MMM yyyy, hh:mm a')}
                          </span>
                        </div>
                      )}
                      {reviewTarget.remarks && (
                        <div>
                          <span className="font-medium">Review Remarks:</span>{' '}
                          <span className="break-words">{reviewTarget.remarks}</span>
                        </div>
                      )}
                      {reviewTarget.wso_comments && (
                        <div>
                          <span className="font-medium">WSO Remarks:</span>{' '}
                          <span className="break-words">{reviewTarget.wso_comments}</span>
                        </div>
                      )}
                      {reviewTarget.supervisor_comments && (
                        <div>
                          <span className="font-medium">Supervisor Remarks:</span>{' '}
                          <span className="break-words">{reviewTarget.supervisor_comments}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {reviewTarget.leave_type === 'COMP_OFF' && (
                    <div className="rounded-lg border p-2.5 sm:p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Comp-Off Allocation Preview</div>
                      {reviewCompOffAllocationQuery.isLoading ? (
                        <div className="mt-2 text-xs text-muted-foreground sm:text-sm">Checking earned comp-off entries for this request.</div>
                      ) : reviewCompOffAllocationQuery.error ? (
                        <div className="mt-2 text-xs text-rose-700 dark:text-rose-300 sm:text-sm">
                          {(reviewCompOffAllocationQuery.error as Error).message || 'Failed to load comp-off allocation preview.'}
                        </div>
                      ) : reviewCompOffAllocationQuery.data ? (
                        <div className="mt-3 space-y-3 text-xs sm:text-sm">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3">
                              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Employee Code</div>
                              <div className="mt-1 font-semibold">{reviewCompOffAllocationQuery.data.employeeCode}</div>
                            </div>
                            <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3">
                              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pending Reserved</div>
                              <div className="mt-1 font-semibold">{reviewCompOffAllocationQuery.data.reservedDays} day{reviewCompOffAllocationQuery.data.reservedDays === 1 ? '' : 's'}</div>
                            </div>
                            <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3">
                              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Requested Here</div>
                              <div className="mt-1 font-semibold">{reviewCompOffAllocationQuery.data.requestedDays} day{reviewCompOffAllocationQuery.data.requestedDays === 1 ? '' : 's'}</div>
                            </div>
                          </div>

                          <div className="mb-2 text-[11px] text-muted-foreground">
                            {reviewCompOffAllocationQuery.data.isExplicitSelection
                              ? 'Chosen by the applicant — these are the entries that will be consumed.'
                              : 'No explicit choice was made, so the earliest-expiring entries will be consumed.'}
                          </div>

                          {reviewCompOffAllocationQuery.data.allocation.selectedEntries.length > 0 ? (
                            <div className="space-y-2">
                              {reviewCompOffAllocationQuery.data.allocation.selectedEntries.map((entry, index) => (
                                <div key={`${entry.recordId}-${entry.dutyDate || 'none'}`} className="rounded-lg border bg-muted/20 p-2.5 sm:p-3">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <div className="font-semibold">#{index + 1} duty date {entry.dutyDate ? format(new Date(entry.dutyDate), 'dd/MM/yyyy') : 'Not available'}</div>
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        Expires {entry.expiryDate ? format(new Date(entry.expiryDate), 'dd/MM/yyyy') : 'not set'}
                                        {entry.sourceLabel ? ` • ${entry.sourceLabel}` : ''}
                                      </div>
                                    </div>
                                    <Badge variant="outline" className="text-[10px] font-medium">
                                      {entry.dutyPerformed || entry.sourceType}
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-rose-200 bg-rose-50/80 p-2.5 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300 sm:p-3 sm:text-sm">
                              No eligible comp-off entries are available for the full requested duration after accounting for the employee's pending comp-off requests.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {reviewAction !== 'view' && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium sm:text-sm">Remarks (optional)</label>
                      <Textarea
                        value={reviewRemarks}
                        onChange={e => setReviewRemarks(e.target.value)}
                        placeholder={isWSO ? 'WSO remarks...' : 'Supervisor remarks...'}
                        rows={4}
                        className="text-xs sm:text-sm"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setReviewDialogOpen(false)} className="h-8 text-xs sm:h-10 sm:text-sm">
                  {reviewAction === 'view' ? 'Close' : 'Cancel'}
                </Button>
                {reviewAction !== 'view' && (
                  <Button
                    variant={reviewAction === 'approve' ? 'default' : 'destructive'}
                    onClick={handleReview}
                    disabled={reviewRequest.isPending}
                    className="h-8 text-xs sm:h-10 sm:text-sm"
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
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
          <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl overflow-hidden p-0 sm:w-full">
            <DialogHeader>
              <div className="px-3 pt-3 sm:px-6 sm:pt-6">
                <DialogTitle className="text-base sm:text-lg">Cancel Approved Leave</DialogTitle>
                <DialogDescription className="mt-1.5 text-xs sm:mt-2 sm:text-sm">
                  Review the leave details before cancelling the approved request.
                </DialogDescription>
              </div>
            </DialogHeader>
            <div className="max-h-[85vh] overflow-y-auto px-3 pb-3 sm:px-6 sm:pb-6">
              {cancelTarget && (
                <div className="space-y-3 pt-2 sm:space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Employee</div>
                      <div className="mt-1 text-xs font-semibold break-words sm:text-sm">{cancelTarget.employee_name}</div>
                      <div className="mt-1 text-xs text-muted-foreground break-words">{cancelTarget.employee_id}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Leave Type</div>
                      <div className="mt-1 text-xs font-semibold sm:text-sm">{getLeaveTypeLabel(cancelTarget.leave_type)}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:col-span-2 sm:p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Leave Dates</div>
                      <div className="mt-1 text-xs font-semibold sm:text-sm">{formatLeaveRange(cancelTarget.start_date, cancelTarget.end_date)}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 sm:col-span-2 sm:p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Reason</div>
                      <div className="mt-1 text-xs whitespace-pre-wrap break-words sm:text-sm">{cancelTarget.reason || '—'}</div>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground sm:text-sm">This will mark the approved leave request as cancelled.</p>

                  <div className="space-y-2">
                    <label className="text-xs font-medium sm:text-sm">Remarks (optional)</label>
                    <Textarea
                      value={cancelRemarks}
                      onChange={e => setCancelRemarks(e.target.value)}
                      placeholder="Reason for cancellation..."
                      rows={4}
                      className="text-xs sm:text-sm"
                    />
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setCancelDialogOpen(false)} className="h-8 text-xs sm:h-10 sm:text-sm">Keep Approved</Button>
                <Button variant="destructive" onClick={handleCancelApproved} disabled={cancelApprovedRequest.isPending} className="h-8 text-xs sm:h-10 sm:text-sm">
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
