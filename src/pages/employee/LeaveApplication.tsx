import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Calendar, Clock3, CheckCircle2, AlertCircle, Send, Ban, Sparkles, ArrowRight, ShieldCheck, CalendarRange, BriefcaseBusiness } from 'lucide-react';
import { format, differenceInDays, isBefore, startOfDay } from 'date-fns';
import { LEAVE_TYPES, getLeaveTypeLabel, getLeaveStatusInfo } from '@/lib/leaveConstants';
import { useMyLeaveRequests, useCreateLeaveRequest, useCancelLeaveRequest } from '@/hooks/useLeaveRequests';
import { useHolidaysByYear } from '@/hooks/useHolidayDashboard';
import { validateLeaveAgainstHolidays, type HolidayConflict } from '@/lib/holidayRules';

function getStatusTone(status: string): string {
  switch (status) {
    case 'Approved':
      return 'border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300';
    case 'Rejected':
      return 'border-rose-200 bg-rose-50/80 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300';
    case 'Cancelled':
      return 'border-slate-200 bg-slate-100/80 text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300';
    default:
      return 'border-amber-200 bg-amber-50/80 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300';
  }
}

function getRequestBorderTone(status: string): string {
  switch (status) {
    case 'Approved':
      return 'border-emerald-200/80 dark:border-emerald-900/50';
    case 'Rejected':
      return 'border-rose-200/80 dark:border-rose-900/50';
    case 'Cancelled':
      return 'border-slate-200/80 dark:border-slate-800';
    default:
      return 'border-amber-200/80 dark:border-amber-900/50';
  }
}

function getRequestStatusIcon(status: string) {
  switch (status) {
    case 'Approved':
      return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
    case 'Rejected':
      return <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />;
    case 'Cancelled':
      return <Ban className="h-4 w-4 text-slate-500 dark:text-slate-400" />;
    default:
      return <Clock3 className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
  }
}

export default function LeaveApplication() {
  const { user } = useAuth();

  // Profile data (fetched once)
  const [profile, setProfile] = useState<{ full_name: string; current_shift: string } | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('profiles')
      .select('full_name, current_shift')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setProfile(data as any);
      });
  }, [user?.id]);

  const { data: myRequests = [], isLoading } = useMyLeaveRequests(user?.id);
  const createRequest = useCreateLeaveRequest();
  const cancelRequest = useCancelLeaveRequest();

  const [formData, setFormData] = useState({
    leave_type: '',
    start_date: '',
    end_date: '',
    reason: '',
  });

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  // Auto-calculate total days
  const totalDays = useMemo(() => {
    if (!formData.start_date || !formData.end_date) return 0;
    const diff = differenceInDays(new Date(formData.end_date), new Date(formData.start_date)) + 1;
    return diff > 0 ? diff : 0;
  }, [formData.start_date, formData.end_date]);

  // Check if it's a half-day leave type
  const isHalfDay = formData.leave_type.startsWith('CL_1ST') || formData.leave_type.startsWith('CL_2ND');

  // Holiday validation
  const currentYear = new Date().getFullYear();
  const { data: holidays = [] } = useHolidaysByYear(currentYear);
  const holidayConflicts = useMemo<HolidayConflict[]>(() => {
    if (!formData.start_date || !formData.end_date) return [];
    return validateLeaveAgainstHolidays(
      new Date(formData.start_date),
      new Date(formData.end_date),
      holidays
    );
  }, [formData.start_date, formData.end_date, holidays]);
  const hasBlockingConflict = holidayConflicts.some((c) => c.type === 'block');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    // Validate dates
    if (totalDays <= 0) {
      toast.error('End date must be after or equal to start date');
      return;
    }

    const today = startOfDay(new Date());
    if (isBefore(new Date(formData.start_date), today)) {
      toast.error('Cannot apply leave for past dates');
      return;
    }

    // Half-day leaves must be single day
    if (isHalfDay && formData.start_date !== formData.end_date) {
      toast.error('Half-day leave must be for a single date');
      return;
    }

    // Holiday validation
    if (hasBlockingConflict) {
      const blockers = holidayConflicts.filter((c) => c.type === 'block');
      toast.error(blockers[0].message);
      return;
    }

    try {
      await createRequest.mutateAsync({
        employee_id: user.id,
        employee_name: profile.full_name,
        team: profile.current_shift?.toUpperCase() || null,
        leave_type: formData.leave_type,
        start_date: formData.start_date,
        end_date: formData.end_date,
        total_days: isHalfDay ? 0.5 : totalDays,
        reason: formData.reason || null,
      });

      toast.success('Leave request submitted successfully');
      setFormData({ leave_type: '', start_date: '', end_date: '', reason: '' });
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit leave request');
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelRequest.mutateAsync(cancelTarget);
      toast.success('Leave request cancelled');
      setCancelDialogOpen(false);
      setCancelTarget(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel');
    }
  };

  // Summary counts
  const approvedCount = myRequests.filter(r => r.status === 'Approved').length;
  const pendingCount = myRequests.filter(r => r.status === 'Pending WSO' || r.status === 'Pending Supervisor').length;
  const rejectedCount = myRequests.filter(r => r.status === 'Rejected').length;
  const upcomingRequest = useMemo(() => {
    const today = startOfDay(new Date());
    return [...myRequests]
      .filter((request) => !isBefore(new Date(request.start_date), today))
      .sort((left, right) => left.start_date.localeCompare(right.start_date))[0] ?? null;
  }, [myRequests]);
  const selectedLeaveTypeLabel = formData.leave_type ? getLeaveTypeLabel(formData.leave_type) : 'Not selected';
  const submitDisabled = createRequest.isPending || !formData.leave_type || !formData.start_date || !formData.end_date || hasBlockingConflict;
  const timelineRequests = [...myRequests]
    .sort((left, right) => right.applied_at.localeCompare(left.applied_at))
    .slice(0, 6);

  if (isLoading) {
    return (
      <DashboardLayout role="employee">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="employee">
      <div className="space-y-6 sm:space-y-8">
        <section className="relative overflow-hidden rounded-[24px] border border-slate-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.16),_transparent_30%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(241,245,249,0.92))] p-4 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.12),_transparent_28%),linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(2,6,23,0.92))] sm:rounded-[28px] sm:p-7 lg:p-8">
          <div className="absolute -right-16 top-0 h-40 w-40 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-500/10" />
          <div className="absolute bottom-0 left-0 h-32 w-32 rounded-full bg-teal-300/30 blur-3xl dark:bg-teal-500/10" />
          <div className="relative grid gap-6 lg:grid-cols-[1.3fr_0.9fr] lg:items-start">
            <div className="space-y-4 sm:space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-300 sm:px-3 sm:text-[11px] sm:tracking-[0.24em]">
                <Sparkles className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                Employee Leave Desk
              </div>

              <div className="space-y-2.5 sm:space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full border-0 bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-white dark:bg-white dark:text-slate-900 sm:px-3 sm:text-[11px]">
                    {profile?.full_name || 'Employee'}
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-slate-300/80 bg-white/70 px-2.5 py-1 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 sm:px-3 sm:text-[11px]">
                    <BriefcaseBusiness className="mr-1.5 h-3 w-3" />
                    Shift {profile?.current_shift?.toUpperCase() || 'Not assigned'}
                  </Badge>
                </div>

                <div>
                  <h1 className="max-w-2xl text-[1.7rem] font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50 sm:text-4xl">
                    Apply for leave in one clean, trackable workspace.
                  </h1>
                  <p className="mt-2.5 max-w-2xl text-[13px] leading-5 text-slate-600 dark:text-slate-300 sm:mt-3 sm:text-base sm:leading-6">
                    Plan dates, check policy conflicts, submit requests, and monitor approval progress without jumping across screens.
                  </p>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-3 sm:gap-3">
                <div className="rounded-[20px] border border-white/80 bg-white/85 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/75 sm:rounded-2xl sm:p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.22em]">Total Requests</div>
                  <div className="mt-2 text-[1.7rem] font-black tracking-tight text-slate-950 dark:text-slate-50 sm:mt-3 sm:text-3xl">{myRequests.length}</div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">All submissions in your queue</div>
                </div>
                <div className="rounded-[20px] border border-white/80 bg-white/85 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/75 sm:rounded-2xl sm:p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.22em]">Pending Review</div>
                  <div className="mt-2 text-[1.7rem] font-black tracking-tight text-amber-600 dark:text-amber-400 sm:mt-3 sm:text-3xl">{pendingCount}</div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">Awaiting WSO or supervisor action</div>
                </div>
                <div className="rounded-[20px] border border-white/80 bg-white/85 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/75 sm:rounded-2xl sm:p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.22em]">Approved</div>
                  <div className="mt-2 text-[1.7rem] font-black tracking-tight text-emerald-600 dark:text-emerald-400 sm:mt-3 sm:text-3xl">{approvedCount}</div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">Requests cleared for leave</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5 sm:gap-3">
                <Button asChild className="h-10 rounded-full px-4 text-[13px] shadow-lg shadow-slate-900/10 sm:h-11 sm:px-5 sm:text-sm">
                  <Link to="/employee/leave-dashboard">
                    View leave register
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-10 rounded-full border-slate-300/80 bg-white/70 px-4 text-[13px] dark:border-slate-700 dark:bg-slate-900/70 sm:h-11 sm:px-5 sm:text-sm">
                  <Link to="/employee/leave-history">Open full history</Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-1">
              <Card className="rounded-[22px] border-white/80 bg-white/80 shadow-lg shadow-slate-900/5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/75 sm:rounded-[24px]">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">
                    <CalendarRange className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                    Next leave at a glance
                  </div>
                  {upcomingRequest ? (
                    <div className="mt-3.5 space-y-2.5 sm:mt-4 sm:space-y-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.22em]">Upcoming window</div>
                        <div className="mt-1 text-base font-bold text-slate-950 dark:text-slate-50 sm:text-lg">
                          {format(new Date(upcomingRequest.start_date), 'dd MMM yyyy')}
                          {upcomingRequest.start_date !== upcomingRequest.end_date && ` — ${format(new Date(upcomingRequest.end_date), 'dd MMM yyyy')}`}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="rounded-full border-slate-300 text-[10px] dark:border-slate-700 sm:text-xs">
                          {getLeaveTypeLabel(upcomingRequest.leave_type)}
                        </Badge>
                        <Badge className={`rounded-full border text-[10px] sm:text-xs ${getStatusTone(upcomingRequest.status)}`}>
                          {getLeaveStatusInfo(upcomingRequest.status).label}
                        </Badge>
                      </div>
                      <p className="text-[13px] text-slate-600 dark:text-slate-300 sm:text-sm">
                        {upcomingRequest.total_days} day{upcomingRequest.total_days === 1 ? '' : 's'} scheduled.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3.5 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-3.5 text-[13px] text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400 sm:mt-4 sm:p-4 sm:text-sm">
                      No upcoming leave request is scheduled yet.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-[22px] border-white/80 bg-white/80 shadow-lg shadow-slate-900/5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/75 sm:rounded-[24px]">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">
                    <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    Request health
                  </div>
                  <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:mt-4 sm:gap-3">
                    <div className="rounded-2xl bg-slate-100/90 p-3 dark:bg-slate-800/70 sm:p-4">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.2em]">Rejected</div>
                      <div className="mt-1.5 text-xl font-black text-slate-900 dark:text-slate-50 sm:mt-2 sm:text-2xl">{rejectedCount}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-100/90 p-3 dark:bg-slate-800/70 sm:p-4">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.2em]">Conflicts</div>
                      <div className="mt-1.5 text-xl font-black text-slate-900 dark:text-slate-50 sm:mt-2 sm:text-2xl">{holidayConflicts.length}</div>
                    </div>
                  </div>
                  <p className="mt-3.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300 sm:mt-4 sm:text-sm sm:leading-6">
                    Holiday checks run before submission so avoidable clashes are surfaced early.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="grid gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1.35fr)_380px]">
          <Card className="overflow-hidden rounded-[24px] border-slate-200/80 shadow-[0_20px_70px_-50px_rgba(15,23,42,0.45)] dark:border-slate-800 sm:rounded-[28px]">
            <div className="border-b border-slate-200/80 bg-slate-50/80 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/60 sm:px-8 sm:py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.24em]">New request</div>
                  <h2 className="mt-1.5 text-[1.45rem] font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50 sm:mt-2 sm:text-2xl">Apply for leave</h2>
                  <p className="mt-2 max-w-2xl text-[13px] leading-5 text-slate-600 dark:text-slate-300 sm:text-sm sm:leading-6">
                    Fill in the dates, choose the right leave type, and submit once the conflict panel is clear.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 sm:text-xs">
                  <Send className="h-3.5 w-3.5" />
                  Submissions route through approval workflow
                </div>
              </div>
            </div>

            <CardContent className="p-4 sm:p-8">
              <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
                <div className="grid gap-3.5 md:grid-cols-2 sm:gap-4">
                  <div className="space-y-2.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-xs sm:tracking-[0.2em]">Leave type</Label>
                    <Select
                      value={formData.leave_type}
                      onValueChange={(v) => setFormData({ ...formData, leave_type: v })}
                    >
                      <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white px-3.5 text-[13px] dark:border-slate-700 dark:bg-slate-950 sm:h-12 sm:px-4 sm:text-sm">
                        <SelectValue placeholder="Select leave type" />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAVE_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-xs sm:tracking-[0.2em]">Duration</Label>
                    <div className="flex h-11 items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3.5 dark:border-slate-700 dark:bg-slate-900/70 sm:h-12 sm:px-4">
                      <span className="text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">Calculated automatically</span>
                      <span className="text-base font-black tracking-tight text-slate-950 dark:text-slate-50 sm:text-lg">{isHalfDay ? '0.5' : totalDays > 0 ? totalDays : '—'}</span>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-xs sm:tracking-[0.2em]">Start date</Label>
                    <Input
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData({
                          ...formData,
                          start_date: val,
                          end_date: isHalfDay ? val : formData.end_date,
                        });
                      }}
                      min={format(new Date(), 'yyyy-MM-dd')}
                      required
                      className="h-11 rounded-2xl border-slate-200 bg-white px-3.5 text-[13px] dark:border-slate-700 dark:bg-slate-950 sm:h-12 sm:px-4 sm:text-sm"
                    />
                  </div>

                  <div className="space-y-2.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-xs sm:tracking-[0.2em]">End date</Label>
                    <Input
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                      min={formData.start_date || format(new Date(), 'yyyy-MM-dd')}
                      disabled={isHalfDay}
                      required
                      className="h-11 rounded-2xl border-slate-200 bg-white px-3.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950 sm:h-12 sm:px-4 sm:text-sm"
                    />
                  </div>
                </div>

                <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_260px] sm:gap-4">
                  <div className="space-y-2.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-xs sm:tracking-[0.2em]">Reason</Label>
                    <Textarea
                      value={formData.reason}
                      onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                      placeholder="Add context that helps the approver understand the leave request."
                      rows={6}
                      className="rounded-[20px] border-slate-200 bg-white px-3.5 py-3 text-[13px] leading-5 dark:border-slate-700 dark:bg-slate-950 sm:rounded-[22px] sm:px-4 sm:text-sm sm:leading-6"
                    />
                  </div>

                  <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-700 dark:bg-slate-900/60 sm:rounded-[24px] sm:p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.22em]">Selection preview</div>
                    <div className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3">
                      <div className="rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-950">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">Type</div>
                        <div className="mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{selectedLeaveTypeLabel}</div>
                      </div>
                      <div className="rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-950">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">Dates</div>
                        <div className="mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">
                          {formData.start_date ? format(new Date(formData.start_date), 'dd MMM yyyy') : 'Choose start date'}
                          {formData.end_date && formData.end_date !== formData.start_date ? ` — ${format(new Date(formData.end_date), 'dd MMM yyyy')}` : ''}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-950">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">Days counted</div>
                        <div className="mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{isHalfDay ? '0.5 day' : totalDays > 0 ? `${totalDays} day${totalDays === 1 ? '' : 's'}` : 'Waiting for dates'}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {holidayConflicts.length > 0 && (
                  <div className="grid gap-2">
                    {holidayConflicts.map((conflict, index) => (
                      <div
                        key={index}
                        className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-[13px] ${conflict.type === 'block'
                          ? 'border-rose-200 bg-rose-50/90 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
                          : 'border-amber-200 bg-amber-50/90 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                          } sm:px-4 sm:text-sm`}
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{conflict.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-800 sm:pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">
                    {hasBlockingConflict ? 'Resolve blocking holiday conflicts before you submit.' : 'Your request will be sent to the approval chain immediately after submission.'}
                  </div>
                  <Button type="submit" className="h-11 rounded-full px-5 text-[13px] font-semibold shadow-lg shadow-slate-900/10 sm:h-12 sm:px-6 sm:text-sm" disabled={submitDisabled}>
                    {createRequest.isPending ? 'Submitting...' : 'Submit request'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-3 sm:space-y-4">
            <Card className="rounded-[24px] border-slate-200/80 shadow-[0_20px_70px_-50px_rgba(15,23,42,0.45)] dark:border-slate-800 sm:rounded-[28px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-[15px] font-bold sm:text-base">Before you submit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 text-[13px] text-slate-600 dark:text-slate-300 sm:space-y-3 sm:text-sm">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-700 dark:bg-slate-900/70 sm:p-4">
                  Choose the exact leave type. Half-day casual leave locks the request to a single day.
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-700 dark:bg-slate-900/70 sm:p-4">
                  Use the reason box for operational context. Short, precise explanations get reviewed faster.
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-700 dark:bg-slate-900/70 sm:p-4">
                  Conflict alerts highlight holidays or blocked dates before the request reaches approvers.
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[24px] border-slate-200/80 shadow-[0_20px_70px_-50px_rgba(15,23,42,0.45)] dark:border-slate-800 sm:rounded-[28px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-[15px] font-bold sm:text-base">Current request state</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 sm:space-y-3">
                <div className="flex items-center justify-between rounded-2xl bg-slate-100/80 px-3.5 py-2.5 dark:bg-slate-900/80 sm:px-4 sm:py-3">
                  <span className="text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">Selected type</span>
                  <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{selectedLeaveTypeLabel}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-100/80 px-3.5 py-2.5 dark:bg-slate-900/80 sm:px-4 sm:py-3">
                  <span className="text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">Duration</span>
                  <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{isHalfDay ? '0.5 day' : totalDays > 0 ? `${totalDays} day${totalDays === 1 ? '' : 's'}` : '—'}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-100/80 px-3.5 py-2.5 dark:bg-slate-900/80 sm:px-4 sm:py-3">
                  <span className="text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">Holiday check</span>
                  <span className={`text-[13px] font-semibold ${hasBlockingConflict ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'} sm:text-sm`}>
                    {hasBlockingConflict ? 'Action needed' : holidayConflicts.length > 0 ? 'Review notes' : 'Clear'}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-3 sm:space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.24em]">Recent activity</div>
              <h2 className="mt-1 text-[1.45rem] font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50 sm:text-2xl">Leave history</h2>
              <p className="mt-2 text-[13px] leading-5 text-slate-600 dark:text-slate-300 sm:text-sm sm:leading-6">
                A cleaner request timeline with direct visibility into dates, status, and remarks.
              </p>
            </div>
            <Button asChild variant="outline" className="h-10 rounded-full border-slate-300/80 bg-white/80 px-4 text-[13px] dark:border-slate-700 dark:bg-slate-900/70 sm:h-11 sm:px-5 sm:text-sm">
              <Link to="/employee/leave-history">Open detailed history</Link>
            </Button>
          </div>

          <div className="grid gap-3 sm:gap-4">
            {timelineRequests.map((req) => {
              const statusInfo = getLeaveStatusInfo(req.status);
              const cancelable = req.status === 'Pending WSO' || req.status === 'Pending Supervisor';

              return (
                <Card key={req.id} className={`rounded-[22px] border ${getRequestBorderTone(req.status)} shadow-[0_18px_60px_-45px_rgba(15,23,42,0.45)] sm:rounded-[26px]`}>
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex flex-col gap-3.5 sm:gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-2.5 sm:space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:text-sm">
                            {getRequestStatusIcon(req.status)}
                            {getLeaveTypeLabel(req.leave_type)}
                          </div>
                          <Badge className={`rounded-full border px-3 py-1 text-[10px] font-medium sm:text-[11px] ${statusInfo.color}`}>
                            {statusInfo.label}
                          </Badge>
                          <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] font-medium sm:text-[11px]">
                            {req.total_days} day{req.total_days === 1 ? '' : 's'}
                          </Badge>
                        </div>

                        <div className="grid gap-2.5 sm:grid-cols-3 sm:gap-3">
                          <div className="rounded-2xl bg-slate-50/90 p-3 dark:bg-slate-900/80 sm:p-4">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.2em]">Applied on</div>
                            <div className="mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{format(new Date(req.applied_at), 'dd MMM yyyy')}</div>
                          </div>
                          <div className="rounded-2xl bg-slate-50/90 p-3 dark:bg-slate-900/80 sm:p-4">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.2em]">Start</div>
                            <div className="mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{format(new Date(req.start_date), 'dd MMM yyyy')}</div>
                          </div>
                          <div className="rounded-2xl bg-slate-50/90 p-3 dark:bg-slate-900/80 sm:p-4">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.2em]">End</div>
                            <div className="mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{format(new Date(req.end_date), 'dd MMM yyyy')}</div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-[13px] leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 sm:px-4 sm:text-sm sm:leading-6">
                          {req.status === 'Pending Supervisor'
                            ? 'Approved by WSO, awaiting supervisor final approval.'
                            : req.remarks || req.reason || 'No remarks added for this request.'}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col gap-2.5 sm:gap-3 lg:w-[180px] lg:items-end">
                        <div className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-[13px] font-medium lg:self-end sm:text-sm ${getStatusTone(req.status)}`}>
                          {getRequestStatusIcon(req.status)}
                          {statusInfo.label}
                        </div>
                        {cancelable && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 rounded-full border-rose-200 px-4 text-[13px] text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-950/30 sm:h-10 sm:text-sm"
                            onClick={() => { setCancelTarget(req.id); setCancelDialogOpen(true); }}
                          >
                            <Ban className="mr-2 h-4 w-4" />
                            Cancel request
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {timelineRequests.length === 0 && (
              <Card className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/60 sm:rounded-[26px]">
                <CardContent className="py-12 text-center sm:py-14">
                  <AlertCircle className="mx-auto h-10 w-10 text-slate-400" />
                  <h3 className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100 sm:text-lg">No leave applications yet</h3>
                  <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">
                    Your submitted requests will appear here with status updates and approver remarks.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </section>

        {/* Cancel Confirmation Dialog */}
        <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel Leave Request</DialogTitle>
              <DialogDescription>
                Are you sure you want to cancel this leave request? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>Keep It</Button>
              <Button variant="destructive" onClick={handleCancel} disabled={cancelRequest.isPending}>
                {cancelRequest.isPending ? 'Cancelling...' : 'Yes, Cancel'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
