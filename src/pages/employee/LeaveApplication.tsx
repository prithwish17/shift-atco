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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { Calendar, Clock3, CheckCircle2, AlertCircle, Send, Ban, Sparkles, ArrowRight, ShieldCheck, CalendarRange, BriefcaseBusiness } from 'lucide-react';
import { format, differenceInDays, isBefore, startOfDay } from 'date-fns';
import { LEAVE_TYPES, getLeaveTypeLabel, getLeaveStatusInfo } from '@/lib/leaveConstants';
import { useMyLeaveRequests, useCreateLeaveRequest, useCancelLeaveRequest } from '@/hooks/useLeaveRequests';
import { useLeaveData } from '@/hooks/useLeaveData';
import { useLeaveBalances } from '@/hooks/useLeaves';
import { useHolidaysByYear } from '@/hooks/useHolidayDashboard';
import { validateLeaveAgainstHolidays, type HolidayConflict } from '@/lib/holidayRules';
import { buildCompOffAllocationCandidates, allocateCompOffCandidates } from '@/lib/compOffAllocation';

function getBalanceBucket(leaveType: string): 'cl' | 'rh' | 'comp_off' | null {
  if (!leaveType) return null;

  if (['CL', 'CL_CON', 'CL_1ST', 'CL_1ST_CON', 'CL_2ND', 'CL_2ND_CON'].includes(leaveType)) {
    return 'cl';
  }

  if (leaveType === 'RH') return 'rh';
  if (leaveType === 'COMP_OFF') return 'comp_off';

  // EL, NEE, HPL, COMM — balances not reliably updated yet, skip enforcement
  return null;
}

function getBalanceBucketLabel(bucket: 'cl' | 'rh' | 'comp_off' | null): string | null {
  switch (bucket) {
    case 'cl':
      return 'Casual Leave';
    case 'rh':
      return 'Restricted Holiday';
    case 'comp_off':
      return 'Comp Off';
    default:
      return null;
  }
}

const CL_LEAVE_TYPES = ['CL', 'CL_CON', 'CL_1ST', 'CL_1ST_CON', 'CL_2ND', 'CL_2ND_CON'];
const RH_LEAVE_TYPES = ['RH'];
const COMP_OFF_LEAVE_TYPES = ['COMP_OFF'];

function getLeaveTypesForBucket(bucket: 'cl' | 'rh' | 'comp_off' | null): string[] {
  switch (bucket) {
    case 'cl': return CL_LEAVE_TYPES;
    case 'rh': return RH_LEAVE_TYPES;
    case 'comp_off': return COMP_OFF_LEAVE_TYPES;
    default: return [];
  }
}

function getHolidayNoticeTone(holidayType: 'NH' | 'RH' | 'CH'): string {
  switch (holidayType) {
    case 'CH':
      return 'border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300';
    case 'RH':
      return 'border-amber-200 bg-amber-50/90 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300';
    default:
      return 'border-sky-200 bg-sky-50/90 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300';
  }
}

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
  const [profile, setProfile] = useState<{ full_name: string; current_shift: string; employee_id: string | null } | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('profiles')
      .select('full_name, current_shift, employee_id')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setProfile(data as any);
      });
  }, [user?.id]);

  const { data: myRequests = [], isLoading } = useMyLeaveRequests(user?.id);
  const { data: leaveBalances = [], isLoading: leaveBalancesLoading } = useLeaveBalances(user?.id);
  const employeeEmpId = profile?.employee_id ? String(profile.employee_id) : null;
  const { data: leaveLedgerData, leaveQuery: leaveLedgerQuery } = useLeaveData(undefined, employeeEmpId);
  const createRequest = useCreateLeaveRequest();
  const cancelRequest = useCancelLeaveRequest();

  const [formData, setFormData] = useState({
    leave_type: '',
    start_date: '',
    end_date: '',
    reason: '',
    actual_rh_date: '',
    sap_applied: '',
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
  const requestedDays = isHalfDay ? 0.5 : totalDays;
  const balanceBucket = useMemo(() => getBalanceBucket(formData.leave_type), [formData.leave_type]);
  const employeeLeaveRecord = useMemo(() => {
    if (!employeeEmpId) return null;
    return leaveLedgerData.find((record) => record.empId === employeeEmpId) || null;
  }, [employeeEmpId, leaveLedgerData]);
  const pendingCompOffDays = useMemo(() => {
    return myRequests
      .filter((req) => req.leave_type === 'COMP_OFF' && (req.status === 'Pending WSO' || req.status === 'Pending Supervisor'))
      .reduce((sum, req) => sum + Math.ceil(req.total_days || 0), 0);
  }, [myRequests]);
  const compOffAllocation = useMemo(() => {
    if (formData.leave_type !== 'COMP_OFF' || !employeeLeaveRecord) return null;
    const candidates = buildCompOffAllocationCandidates(
      employeeLeaveRecord.compOffEntries.map((entry, index) => ({
        id: `${entry.sourceType}-${entry.dutyDate || 'none'}-${entry.leaveApplied || 'available'}-${index}`,
        leave_category: entry.sourceType === 'OPE' || entry.sourceType === 'OPE_DUTY' ? 'OPE' : 'COMP_OFF',
        source_event_type: entry.sourceType,
        leave_date: entry.dutyDate,
        leave_used_on: entry.leaveApplied,
        duty_code: entry.dutyPerformed,
        metadata: {
          source_type: entry.sourceType,
          source_label: entry.sourceLabel,
          duty_date: entry.dutyDate,
          leave_used_on: entry.leaveApplied,
          duty_performed: entry.dutyPerformed,
          expiry_date: entry.expiryDate,
          comp_off_eligible: entry.eligible,
          remark: entry.remark,
        },
      })),
    );

    return allocateCompOffCandidates(candidates, requestedDays, pendingCompOffDays);
  }, [employeeLeaveRecord, formData.leave_type, pendingCompOffDays, requestedDays]);
  const matchingBalanceEntries = useMemo(() => {
    if (!balanceBucket) return null;

    if (balanceBucket === 'comp_off') {
      return null;
    }

    const normalizedMatches = leaveBalances.filter(
      (balance) => String(balance.leave_type).toLowerCase() === balanceBucket
    );

    if (normalizedMatches.length === 0) return null;

    const currentYearMatches = normalizedMatches.filter((balance) => balance.year === currentYear);
    if (currentYearMatches.length > 0) return currentYearMatches;

    const latestYear = Math.max(...normalizedMatches.map((balance) => balance.year));
    return normalizedMatches.filter((balance) => balance.year === latestYear);
  }, [balanceBucket, currentYear, leaveBalances]);
  const DEFAULT_CL_BALANCE = 12;
  const availableBalance = useMemo(() => {
    if (balanceBucket === 'comp_off') {
      return compOffAllocation?.availableCount ?? 0;
    }

    if (!matchingBalanceEntries || matchingBalanceEntries.length === 0) {
      // CL defaults to 12 when no balance record exists
      if (balanceBucket === 'cl') return DEFAULT_CL_BALANCE;
      // RH defaults to 2; Comp Off defaults to 0
      if (balanceBucket === 'rh') return 2;
      if (balanceBucket === 'comp_off') return 0;
      return null;
    }

    return matchingBalanceEntries.reduce((total, balance) => total + Number(balance.balance || 0), 0);
  }, [balanceBucket, compOffAllocation?.availableCount, matchingBalanceEntries]);
  const balanceYear = matchingBalanceEntries?.[0]?.year ?? null;
  const balanceLabel = getBalanceBucketLabel(balanceBucket);

  // Tally already-applied days (pending + approved) for the same leave-type bucket in current year
  const alreadyAppliedDays = useMemo(() => {
    if (!balanceBucket) return 0;
    if (balanceBucket === 'comp_off') return pendingCompOffDays;

    const bucketLeaveTypes = getLeaveTypesForBucket(balanceBucket);
    return myRequests
      .filter((req) => {
        if (!bucketLeaveTypes.includes(req.leave_type)) return false;
        const status = req.status;
        if (status !== 'Pending WSO' && status !== 'Pending Supervisor' && status !== 'Approved') return false;
        const reqYear = new Date(req.start_date).getFullYear();
        return reqYear === currentYear;
      })
      .reduce((sum, req) => sum + (req.total_days || 0), 0);
  }, [balanceBucket, currentYear, myRequests, pendingCompOffDays]);

  const effectiveBalance = useMemo(() => {
    if (balanceBucket === 'comp_off') {
      return compOffAllocation?.remainingAfterReservations ?? 0;
    }

    return typeof availableBalance === 'number' ? availableBalance - alreadyAppliedDays : null;
  }, [alreadyAppliedDays, availableBalance, balanceBucket, compOffAllocation?.remainingAfterReservations]);
  const compOffLedgerLoading = formData.leave_type === 'COMP_OFF' && Boolean(employeeEmpId) && leaveLedgerQuery.isLoading;
  const hasApplicableBalanceCheck = Boolean(balanceBucket && formData.leave_type && typeof effectiveBalance === 'number');
  const hasInsufficientBalance = Boolean(
    hasApplicableBalanceCheck &&
    !(balanceBucket === 'comp_off' ? compOffLedgerLoading : leaveBalancesLoading) &&
    requestedDays > 0 &&
    typeof effectiveBalance === 'number' &&
    (balanceBucket === 'comp_off'
      ? !compOffAllocation?.canCoverRequest
      : effectiveBalance < requestedDays)
  );
  const balanceMessage = hasApplicableBalanceCheck
    ? leaveBalancesLoading
      ? 'Checking your available leave balance.'
      : balanceBucket === 'comp_off' && !employeeEmpId
        ? 'Comp-off allocation is unavailable because your employee ID is missing from the profile.'
        : balanceBucket === 'comp_off' && compOffLedgerLoading
          ? 'Checking the earned comp-off entries available for this request.'
          : balanceBucket === 'comp_off' && hasInsufficientBalance
            ? `Comp Off balance is insufficient. Earned entries available: ${availableBalance ?? 0}, already reserved by pending requests: ${alreadyAppliedDays}, remaining: ${effectiveBalance ?? 0}. You are requesting ${requestedDays} day${requestedDays === 1 ? '' : 's'}.`
            : balanceBucket === 'comp_off'
              ? `Comp Off balance: ${availableBalance ?? 0}, pending requests using balance: ${alreadyAppliedDays}, usable now: ${effectiveBalance ?? 0}. Requesting: ${requestedDays}.`
      : hasInsufficientBalance
        ? `${balanceLabel} balance is insufficient. Total: ${availableBalance ?? 0}, already applied: ${alreadyAppliedDays}, remaining: ${effectiveBalance ?? 0}. You are requesting ${requestedDays} day${requestedDays === 1 ? '' : 's'}. Please correct your leave application.`
        : typeof effectiveBalance === 'number'
          ? `${balanceLabel} balance: ${availableBalance ?? 0}${balanceYear && balanceYear !== currentYear ? ` (from ${balanceYear})` : ''}, applied: ${alreadyAppliedDays}, remaining: ${effectiveBalance}. Requesting: ${requestedDays}.`
          : null
    : null;

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

    // RH must have an actual RH date
    if (formData.leave_type === 'RH' && !formData.actual_rh_date) {
      toast.error('Please enter the actual Reserved Holiday date');
      return;
    }

    // RH compensatory leave must be availed within 3 months of the actual RH date
    if (formData.leave_type === 'RH' && formData.actual_rh_date) {
      const rhDate = new Date(formData.actual_rh_date);
      const leaveDate = new Date(formData.start_date);
      const threeMonthsLater = new Date(rhDate);
      threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
      if (leaveDate > threeMonthsLater) {
        toast.error('Reserved Holiday leave must be availed within 3 months from the actual RH date');
        return;
      }
    }

    if (hasApplicableBalanceCheck && ((balanceBucket === 'comp_off' && compOffLedgerLoading) || (balanceBucket !== 'comp_off' && leaveBalancesLoading))) {
      toast.error('Leave balance is still loading. Please try again in a moment.');
      return;
    }

    if (hasInsufficientBalance) {
      toast.error(balanceMessage || 'Insufficient leave balance for this request.');
      return;
    }

    if (!formData.sap_applied) {
      toast.error('Please confirm whether you have already applied this leave on SAP.');
      return;
    }

    try {
      await createRequest.mutateAsync({
        employee_id: user.id,
        employee_name: profile.full_name,
        team: profile.current_shift?.toUpperCase() || null,
        sap_applied: formData.sap_applied === 'yes',
        leave_type: formData.leave_type,
        start_date: formData.start_date,
        end_date: formData.end_date,
        total_days: requestedDays,
        reason: formData.reason || null,
        actual_rh_date: formData.leave_type === 'RH' && formData.actual_rh_date ? formData.actual_rh_date : null,
      });

      toast.success('Leave request submitted successfully');
      setFormData({ leave_type: '', start_date: '', end_date: '', reason: '', actual_rh_date: '', sap_applied: '' });
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
  const submitDisabled = createRequest.isPending || !formData.leave_type || !formData.start_date || !formData.end_date || !formData.sap_applied || (Boolean(balanceBucket && formData.leave_type) && ((balanceBucket === 'comp_off' && compOffLedgerLoading) || (balanceBucket !== 'comp_off' && leaveBalancesLoading))) || hasInsufficientBalance;
  const timelineRequests = [...myRequests]
    .sort((left, right) => right.applied_at.localeCompare(left.applied_at))
    .slice(0, 6);
  const fieldLabelClass = 'text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300 sm:text-xs sm:tracking-[0.22em]';
  const fieldInputClass = 'h-12 rounded-2xl border border-slate-200/90 bg-white px-4 text-sm text-slate-900 shadow-[0_14px_35px_-24px_rgba(15,23,42,0.45)] transition placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-4 focus-visible:ring-sky-100 dark:border-slate-700 dark:bg-slate-950/90 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-sky-500 dark:focus-visible:ring-sky-950/40';
  const softPanelClass = 'rounded-[24px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,251,0.96))] shadow-[0_28px_80px_-45px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.96))]';

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
      <div className="relative space-y-6 pb-4 sm:space-y-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(255,255,255,0))] dark:bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.14),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(45,212,191,0.12),_transparent_26%),linear-gradient(180deg,_rgba(2,6,23,0.88),_rgba(2,6,23,0))]" />
        <section className="sm:hidden rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <Sparkles className="h-3 w-3 text-teal-600 dark:text-teal-400" />
                Leave Desk
              </div>
              <h1 className="text-xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">
                Apply for leave quickly.
              </h1>
              <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                The request form starts right below. History and extra insights stay further down.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-slate-100 px-3 py-2.5 dark:bg-slate-900">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Total</div>
                <div className="mt-1 text-lg font-black text-slate-950 dark:text-slate-50">{myRequests.length}</div>
              </div>
              <div className="rounded-2xl bg-amber-50 px-3 py-2.5 dark:bg-amber-950/30">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Pending</div>
                <div className="mt-1 text-lg font-black text-amber-700 dark:text-amber-300">{pendingCount}</div>
              </div>
              <div className="rounded-2xl bg-emerald-50 px-3 py-2.5 dark:bg-emerald-950/30">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Approved</div>
                <div className="mt-1 text-lg font-black text-emerald-700 dark:text-emerald-300">{approvedCount}</div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button asChild className="h-10 flex-1 rounded-full text-[13px]">
                <Link to="/employee/leave-history">History</Link>
              </Button>
              <Button asChild variant="outline" className="h-10 flex-1 rounded-full text-[13px]">
                <Link to="/employee/leave-dashboard">Register</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="hidden sm:block relative overflow-hidden rounded-[28px] border border-sky-100/80 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.14),_transparent_28%),linear-gradient(140deg,_rgba(255,255,255,0.98),_rgba(240,249,255,0.96)_55%,_rgba(248,250,252,0.94))] p-4 shadow-[0_36px_100px_-52px_rgba(15,23,42,0.5)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(45,212,191,0.1),_transparent_28%),linear-gradient(140deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.96))] sm:p-7 lg:p-8">
          <div className="absolute -right-12 top-0 h-48 w-48 rounded-full bg-sky-200/45 blur-3xl dark:bg-sky-500/12" />
          <div className="absolute bottom-0 left-0 h-40 w-40 rounded-full bg-emerald-300/35 blur-3xl dark:bg-emerald-500/10" />
          <div className="absolute left-1/2 top-0 h-28 w-[420px] -translate-x-1/2 bg-white/40 blur-3xl dark:bg-slate-800/20" />
          <div className="relative grid gap-6 lg:grid-cols-[1.3fr_0.9fr] lg:items-start">
            <div className="space-y-4 sm:space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200/80 bg-white/85 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700 shadow-sm backdrop-blur dark:border-sky-900/50 dark:bg-slate-900/70 dark:text-sky-300">
                <Sparkles className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                Employee Leave Portal
              </div>

              <div className="space-y-2.5 sm:space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full border-0 bg-gradient-to-r from-sky-600 to-cyan-500 px-3 py-1 text-[11px] font-medium text-white shadow-sm shadow-sky-500/25">
                    {profile?.full_name || 'Employee'}
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-slate-300/80 bg-white/80 px-3 py-1 text-[11px] text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                    <BriefcaseBusiness className="mr-1.5 h-3 w-3" />
                    Shift {profile?.current_shift?.toUpperCase() || 'Not assigned'}
                  </Badge>
                </div>

                <div>
                  <h1 className="max-w-2xl text-[1.85rem] font-black tracking-[-0.045em] text-slate-950 dark:text-slate-50 sm:text-[2.8rem] sm:leading-[1.02]">
                    A clearer, faster leave workflow built like a real HR desk.
                  </h1>
                  <p className="mt-3 max-w-2xl text-[14px] leading-6 text-slate-600 dark:text-slate-300 sm:text-base sm:leading-7">
                    Review balance, validate dates, flag holiday conflicts, and submit with confidence from a single polished request surface.
                  </p>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-3 sm:gap-3">
                <div className="rounded-[22px] border border-sky-100 bg-white/90 p-4 shadow-[0_20px_40px_-28px_rgba(14,165,233,0.45)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/75">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400 sm:text-[11px]">Total Requests</div>
                  <div className="mt-2 text-[1.7rem] font-black tracking-tight text-slate-950 dark:text-slate-50 sm:mt-3 sm:text-3xl">{myRequests.length}</div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">All submissions in your queue</div>
                </div>
                <div className="rounded-[22px] border border-amber-100 bg-white/90 p-4 shadow-[0_20px_40px_-28px_rgba(245,158,11,0.42)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/75">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400 sm:text-[11px]">Pending Review</div>
                  <div className="mt-2 text-[1.7rem] font-black tracking-tight text-amber-600 dark:text-amber-400 sm:mt-3 sm:text-3xl">{pendingCount}</div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">Awaiting WSO or supervisor action</div>
                </div>
                <div className="rounded-[22px] border border-emerald-100 bg-white/90 p-4 shadow-[0_20px_40px_-28px_rgba(16,185,129,0.42)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/75">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400 sm:text-[11px]">Approved</div>
                  <div className="mt-2 text-[1.7rem] font-black tracking-tight text-emerald-600 dark:text-emerald-400 sm:mt-3 sm:text-3xl">{approvedCount}</div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">Requests cleared for leave</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5 sm:gap-3">
                <Button asChild className="h-11 rounded-full bg-gradient-to-r from-sky-600 via-cyan-500 to-teal-500 px-5 text-[13px] font-semibold text-white shadow-[0_20px_45px_-25px_rgba(14,165,233,0.65)] hover:opacity-95 sm:px-6 sm:text-sm">
                  <Link to="/employee/leave-dashboard">
                    View leave register
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 rounded-full border-slate-300/80 bg-white/85 px-5 text-[13px] text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 sm:px-6 sm:text-sm">
                  <Link to="/employee/leave-history">Open full history</Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-1">
              <Card className={`${softPanelClass} rounded-[24px]`}>
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">
                    <CalendarRange className="h-4 w-4 text-sky-600 dark:text-sky-400" />
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

              <Card className={`${softPanelClass} rounded-[24px]`}>
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
          <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] shadow-[0_30px_90px_-52px_rgba(15,23,42,0.48)] dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))]">
            <div className="border-b border-sky-100/80 bg-[linear-gradient(90deg,rgba(224,242,254,0.82),rgba(240,253,250,0.72))] px-4 py-5 dark:border-slate-800 dark:bg-[linear-gradient(90deg,rgba(15,23,42,0.88),rgba(17,24,39,0.74))] sm:px-8 sm:py-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-sky-700 dark:text-sky-300 sm:text-[11px]">New request</div>
                  <h2 className="mt-2 text-[1.55rem] font-black tracking-[-0.035em] text-slate-950 dark:text-slate-50 sm:text-[2rem]">Apply for leave</h2>
                  <p className="mt-2.5 max-w-2xl text-[13px] leading-6 text-slate-600 dark:text-slate-300 sm:text-sm sm:leading-6">
                    Fill in the dates, choose the right leave type, and submit once the conflict panel is clear.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/90 px-3.5 py-2 text-[11px] font-medium text-sky-700 shadow-sm dark:border-sky-900/40 dark:bg-slate-900 dark:text-sky-300 sm:text-xs">
                  <Send className="h-3.5 w-3.5" />
                  Submissions route through approval workflow
                </div>
              </div>
            </div>

            <CardContent className="p-4 sm:p-8">
              <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2.5 md:col-span-2 xl:col-span-2">
                    <Label className={fieldLabelClass}>Leave type</Label>
                    <Select
                      value={formData.leave_type}
                      onValueChange={(v) => setFormData({ ...formData, leave_type: v })}
                    >
                      <SelectTrigger className={fieldInputClass}>
                        <SelectValue placeholder="Select leave type" />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAVE_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.leave_type === 'RH' && (
                    <div className="space-y-2.5">
                      <Label className={fieldLabelClass}>Actual RH Date</Label>
                      <Input
                        type="date"
                        lang="en-GB"
                        value={formData.actual_rh_date}
                        onChange={(e) => setFormData({ ...formData, actual_rh_date: e.target.value })}
                        required
                        className={fieldInputClass}
                      />
                      <p className="rounded-2xl border border-sky-100 bg-sky-50/80 px-3 py-2 text-[11px] leading-5 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300">Enter the original Reserved Holiday date you are claiming against. The leave must be used within 3 months of this date.</p>
                    </div>
                  )}

                  <div className="space-y-2.5">
                    <Label className={fieldLabelClass}>Duration</Label>
                    <div className="flex h-12 items-center justify-between rounded-2xl border border-slate-200/90 bg-gradient-to-r from-slate-50 to-sky-50/70 px-4 shadow-[0_14px_35px_-24px_rgba(15,23,42,0.45)] dark:border-slate-700 dark:from-slate-900 dark:to-slate-900/70">
                      <span className="text-sm text-slate-500 dark:text-slate-400">Calculated automatically</span>
                      <span className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-50">{isHalfDay ? '0.5' : totalDays > 0 ? totalDays : ''}</span>
                    </div>
                  </div>

                  <div className="grid gap-4 md:col-span-2 md:grid-cols-2 xl:col-span-2">
                    <div className="space-y-2.5">
                      <Label className={fieldLabelClass}>Start date</Label>
                      <Input
                        type="date"
                        lang="en-GB"
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
                        className={fieldInputClass}
                      />
                    </div>

                    <div className="space-y-2.5">
                      <Label className={fieldLabelClass}>End date</Label>
                      <Input
                        type="date"
                        lang="en-GB"
                        value={formData.end_date}
                        onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                        min={formData.start_date || format(new Date(), 'yyyy-MM-dd')}
                        disabled={isHalfDay}
                        required
                        className={`${fieldInputClass} disabled:cursor-not-allowed disabled:opacity-70`}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="space-y-2.5">
                    <Label className={fieldLabelClass}>Reason</Label>
                    <Textarea
                      value={formData.reason}
                      onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                      placeholder="Add context that helps the approver understand the leave request."
                      rows={6}
                      className="min-h-[220px] rounded-[24px] border border-slate-200/90 bg-white px-4 py-3.5 text-sm leading-6 text-slate-900 shadow-[0_14px_35px_-24px_rgba(15,23,42,0.45)] transition placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-4 focus-visible:ring-sky-100 dark:border-slate-700 dark:bg-slate-950/90 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-sky-500 dark:focus-visible:ring-sky-950/40"
                    />
                  </div>

                  <div className="rounded-[26px] border border-sky-100 bg-[linear-gradient(180deg,rgba(240,249,255,0.95),rgba(255,255,255,0.98))] p-4 shadow-[0_24px_50px_-34px_rgba(14,165,233,0.45)] dark:border-slate-700 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.9),rgba(2,6,23,0.95))]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300 sm:text-[11px]">Selection preview</div>
                    <div className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3">
                      <div className="rounded-2xl border border-white/80 bg-white/90 p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-950/90">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-xs">Type</div>
                        <div className="mt-1.5 text-[14px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{selectedLeaveTypeLabel}</div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/90 p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-950/90">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-xs">Dates</div>
                        <div className="mt-1.5 text-[14px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">
                          {formData.start_date ? format(new Date(formData.start_date), 'dd/MM/yyyy') : 'Choose start date'}
                          {formData.end_date && formData.end_date !== formData.start_date ? ` — ${format(new Date(formData.end_date), 'dd/MM/yyyy')}` : ''}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/90 p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-950/90">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-xs">Days counted</div>
                        <div className="mt-1.5 text-[14px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{isHalfDay ? '0.5 day' : totalDays > 0 ? `${totalDays} day${totalDays === 1 ? '' : 's'}` : 'Waiting for dates'}</div>
                      </div>
                      {formData.leave_type === 'COMP_OFF' && (
                        <div className="rounded-2xl border border-white/80 bg-white/90 p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-950/90">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-xs">Comp-off entries used</div>
                          {compOffLedgerLoading ? (
                            <div className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">Checking earned comp-off entries...</div>
                          ) : !employeeEmpId ? (
                            <div className="mt-1.5 text-[13px] text-rose-600 dark:text-rose-300 sm:text-sm">Employee ID is required to resolve comp-off dates.</div>
                          ) : !requestedDays ? (
                            <div className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">Choose valid leave dates to see the exact comp-off dates that will be used.</div>
                          ) : compOffAllocation && compOffAllocation.selectedEntries.length > 0 ? (
                            <div className="mt-2 space-y-2">
                              {compOffAllocation.selectedEntries.map((entry) => (
                                <div key={`${entry.recordId}-${entry.dutyDate || 'none'}`} className="rounded-2xl border border-sky-100 bg-sky-50/70 px-3 py-2 text-[12px] text-slate-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-slate-200 sm:text-[13px]">
                                  <div className="font-semibold">Duty date: {entry.dutyDate ? format(new Date(entry.dutyDate), 'dd/MM/yyyy') : 'Not available'}</div>
                                  <div className="mt-0.5 text-slate-500 dark:text-slate-400">Expires {entry.expiryDate ? format(new Date(entry.expiryDate), 'dd/MM/yyyy') : 'not set'}{entry.sourceLabel ? ` • ${entry.sourceLabel}` : ''}</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-1.5 text-[13px] text-rose-600 dark:text-rose-300 sm:text-sm">No eligible comp-off entries are available for all requested leave days.</div>
                          )}
                        </div>
                      )}
                      {formData.leave_type === 'RH' && formData.actual_rh_date && (
                        <div className="rounded-2xl border border-white/80 bg-white/90 p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-950/90">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-xs">Claimed RH date</div>
                          <div className="mt-1.5 text-[14px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{format(new Date(formData.actual_rh_date), 'dd MMM yyyy')}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {(() => {
                  const rhConflicts = holidayConflicts.filter(c => c.holiday.type === 'RH');
                  const otherConflicts = holidayConflicts.filter(c => c.holiday.type !== 'RH');
                  if (holidayConflicts.length === 0) return null;
                  return (
                    <div className="grid gap-2">
                      {otherConflicts.map((conflict, index) => (
                        <div
                          key={`other-${index}`}
                          className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-[13px] sm:px-4 sm:text-sm ${getHolidayNoticeTone(conflict.holiday.type)}`}
                        >
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{conflict.message}</span>
                        </div>
                      ))}
                      {rhConflicts.length > 0 && (
                        <div className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-[13px] sm:px-4 sm:text-sm ${getHolidayNoticeTone('RH')}`}>
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            {rhConflicts.length === 1
                              ? rhConflicts[0].message
                              : `Restricted Holidays within the selected dates: ${rhConflicts.map(c => `${c.holiday.name} (${format(new Date(c.date), 'd MMM')})`).join(', ')}.`}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {balanceMessage && (
                  <div className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-[13px] sm:px-4 sm:text-sm ${hasInsufficientBalance
                    ? 'border-rose-200 bg-rose-50/90 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
                    : 'border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                    }`}>
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{balanceMessage}</span>
                  </div>
                )}

                <div className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] p-4 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.96))] sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300 sm:text-xs">SAP confirmation</div>
                      <p className="mt-1.5 text-[13px] leading-6 text-slate-600 dark:text-slate-300 sm:text-sm">
                        Have you already applied this leave in SAP?
                      </p>
                    </div>
                    <div className="rounded-full border border-sky-100 bg-sky-50/80 px-3 py-1.5 text-[11px] font-medium text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300 sm:text-xs">
                      Required before submission
                    </div>
                  </div>

                  <RadioGroup
                    value={formData.sap_applied}
                    onValueChange={(value) => setFormData({ ...formData, sap_applied: value })}
                    className="mt-4 grid gap-3 sm:grid-cols-2"
                  >
                    <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition ${formData.sap_applied === 'yes'
                      ? 'border-emerald-300 bg-emerald-50/90 shadow-[0_18px_35px_-28px_rgba(16,185,129,0.55)] dark:border-emerald-900/50 dark:bg-emerald-950/25'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/80 dark:hover:border-slate-700'
                      }`}>
                      <RadioGroupItem value="yes" id="sap-applied-yes" className="mt-0.5" />
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Yes, already applied</div>
                        <div className="mt-1 text-[12px] leading-5 text-slate-500 dark:text-slate-400">Use this if the SAP leave application has already been submitted.</div>
                      </div>
                    </label>

                    <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition ${formData.sap_applied === 'no'
                      ? 'border-amber-300 bg-amber-50/90 shadow-[0_18px_35px_-28px_rgba(245,158,11,0.55)] dark:border-amber-900/50 dark:bg-amber-950/25'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/80 dark:hover:border-slate-700'
                      }`}>
                      <RadioGroupItem value="no" id="sap-applied-no" className="mt-0.5" />
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">No, not yet applied</div>
                        <div className="mt-1 text-[12px] leading-5 text-slate-500 dark:text-slate-400">Use this if this portal request is being submitted first.</div>
                      </div>
                    </label>
                  </RadioGroup>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-[13px] leading-6 text-slate-500 dark:text-slate-400 sm:text-sm">
                    {hasInsufficientBalance
                      ? 'Available leave balance must cover the requested days before submission.'
                      : 'Holiday and RH matches are shown as review notes. Your request will be sent to the approval chain immediately after submission.'}
                  </div>
                  <Button type="submit" className="h-12 rounded-full bg-gradient-to-r from-sky-600 via-cyan-500 to-teal-500 px-6 text-[13px] font-semibold text-white shadow-[0_24px_50px_-28px_rgba(14,165,233,0.7)] hover:opacity-95 sm:text-sm" disabled={submitDisabled}>
                    {createRequest.isPending ? 'Submitting...' : 'Submit request'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-3 sm:space-y-4">
            <Card className="rounded-[28px] border border-slate-200/80 bg-white/95 shadow-[0_24px_70px_-46px_rgba(15,23,42,0.42)] dark:border-slate-800 dark:bg-slate-950/95">
              <CardHeader className="pb-2">
                <CardTitle className="text-[15px] font-bold sm:text-base">Before you submit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 text-[13px] text-slate-600 dark:text-slate-300 sm:space-y-3 sm:text-sm">
                <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-3.5 dark:border-sky-900/40 dark:bg-sky-950/20 sm:p-4">
                  Choose the exact leave type. Half-day casual leave locks the request to a single day.
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3.5 dark:border-emerald-900/40 dark:bg-emerald-950/20 sm:p-4">
                  Use the reason box for operational context. Short, precise explanations get reviewed faster.
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20 sm:p-4">
                  Holiday and RH alerts are informational only, so you can still submit after reviewing them.
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border border-slate-200/80 bg-white/95 shadow-[0_24px_70px_-46px_rgba(15,23,42,0.42)] dark:border-slate-800 dark:bg-slate-950/95">
              <CardHeader className="pb-2">
                <CardTitle className="text-[15px] font-bold sm:text-base">Current request state</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 sm:space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900/80 sm:px-4 sm:py-3">
                  <span className="text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">Selected type</span>
                  <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{selectedLeaveTypeLabel}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900/80 sm:px-4 sm:py-3">
                  <span className="text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">Duration</span>
                  <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{isHalfDay ? '0.5 day' : totalDays > 0 ? `${totalDays} day${totalDays === 1 ? '' : 's'}` : '—'}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900/80 sm:px-4 sm:py-3">
                  <span className="text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">Holiday check</span>
                  <span className={`text-[13px] font-semibold ${holidayConflicts.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'} sm:text-sm`}>
                    {holidayConflicts.length > 0 ? 'Review notes' : 'Clear'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900/80 sm:px-4 sm:py-3">
                  <span className="text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">Balance check</span>
                  <span className={`text-[13px] font-semibold sm:text-sm ${hasApplicableBalanceCheck
                    ? leaveBalancesLoading
                      ? 'text-slate-600 dark:text-slate-300'
                      : hasInsufficientBalance
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                    }`}>
                    {hasApplicableBalanceCheck
                      ? leaveBalancesLoading
                        ? 'Checking'
                        : hasInsufficientBalance
                          ? 'Insufficient'
                          : 'Available'
                      : balanceBucket
                        ? 'Not found'
                        : 'Not required'}
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
                  <CardContent className="p-4 sm:p-5">
                    <div className="space-y-3 sm:space-y-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:text-sm">
                            {getRequestStatusIcon(req.status)}
                            {getLeaveTypeLabel(req.leave_type)}
                          </div>
                          <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] font-medium sm:text-[11px]">
                            {req.total_days} day{req.total_days === 1 ? '' : 's'}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          <Badge className={`rounded-full border px-3 py-1 text-[10px] font-medium sm:text-[11px] ${statusInfo.color}`}>
                            {statusInfo.label}
                          </Badge>
                          {cancelable && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 rounded-full border-rose-200 px-4 text-[12px] text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-950/30 sm:h-10 sm:text-sm"
                              onClick={() => { setCancelTarget(req.id); setCancelDialogOpen(true); }}
                            >
                              <Ban className="mr-2 h-4 w-4" />
                              Cancel request
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 sm:gap-3">
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
                        <div className="rounded-2xl bg-slate-50/90 p-3 dark:bg-slate-900/80 sm:p-4">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.2em]">Request</div>
                          <div className="mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100 sm:text-sm">{getLeaveTypeLabel(req.leave_type)}</div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-[13px] leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 sm:px-4 sm:text-sm sm:leading-6">
                        {req.status === 'Pending Supervisor'
                          ? 'Approved by WSO, awaiting supervisor final approval.'
                          : req.remarks || req.reason || 'No remarks added for this request.'}
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
