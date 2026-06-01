import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
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
import { Calendar, Clock3, CheckCircle2, AlertCircle, Ban, Sparkles, ArrowRight, CalendarRange, BriefcaseBusiness, Paperclip, FileText, X } from 'lucide-react';
import { format, differenceInDays, isBefore, startOfDay, eachDayOfInterval } from 'date-fns';
import { LEAVE_TYPES, getLeaveTypeLabel, getLeaveStatusInfo, DEFAULT_CL_BALANCE, DEFAULT_RH_BALANCE } from '@/lib/leaveConstants';
import { useMyLeaveRequests, useCreateLeaveRequest, useCancelLeaveRequest, isFinalLeaveApproved } from '@/hooks/useLeaveRequests';
import { useLeaveData } from '@/hooks/useLeaveData';
import { useLeaveBalances } from '@/hooks/useLeaves';
import { useHolidaysByYear } from '@/hooks/useHolidayDashboard';
import { validateLeaveAgainstHolidays, isHoliday, type HolidayConflict, type HolidayInfo } from '@/lib/holidayRules';
import { buildCompOffAllocationCandidates, allocateCompOffCandidates } from '@/lib/compOffAllocation';
import { LeaveDocumentUpload } from '@/components/upload/LeaveDocumentUpload';

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
      return 'border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300';
    case 'Rejected':
      return 'border-rose-200 bg-rose-50/90 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300';
    case 'Cancelled':
      return 'border-stone-200 bg-stone-100/90 text-stone-700 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-300';
    case 'Pending Supervisor':
      return 'border-orange-200 bg-orange-50/90 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300';
    default:
      return 'border-amber-200 bg-amber-50/90 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300';
  }
}

function getLeaveTypeTone(leaveType: string): string {
  if (leaveType === 'CL') {
    return 'border-sky-200 bg-sky-50/90 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300';
  }

  if (leaveType.startsWith('CL_1ST') || leaveType.startsWith('CL_2ND')) {
    return 'border-cyan-200 bg-cyan-50/90 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-300';
  }

  if (leaveType === 'COMP_OFF') {
    return 'border-violet-200 bg-violet-50/90 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300';
  }

  if (leaveType === 'RH') {
    return 'border-fuchsia-200 bg-fuchsia-50/90 text-fuchsia-700 dark:border-fuchsia-900/60 dark:bg-fuchsia-950/30 dark:text-fuchsia-300';
  }

  if (leaveType === 'EL') {
    return 'border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300';
  }

  if (leaveType === 'NEE') {
    return 'border-teal-200 bg-teal-50/90 text-teal-700 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-300';
  }

  if (leaveType === 'HPL') {
    return 'border-indigo-200 bg-indigo-50/90 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300';
  }

  if (leaveType === 'COMM') {
    return 'border-rose-200 bg-rose-50/90 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300';
  }

  return 'border-slate-200 bg-slate-50/90 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300';
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
  const { data: profile } = useQuery({
    queryKey: ['my-profile-leave', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, current_shift, employee_id')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return data as { full_name: string; current_shift: string; employee_id: string | null };
    },
    enabled: !!user?.id,
    staleTime: 30 * 60 * 1000,
  });

  const { data: myRequests = [], isLoading } = useMyLeaveRequests(user?.id);
  const { data: leaveBalances = [], isLoading: leaveBalancesLoading } = useLeaveBalances(user?.id);
  const employeeEmpId = profile?.employee_id ? String(profile.employee_id) : null;
  const currentYear = new Date().getFullYear();
  const { data: leaveLedgerData, leaveQuery: leaveLedgerQuery } = useLeaveData(currentYear, employeeEmpId);
  const createRequest = useCreateLeaveRequest();
  const cancelRequest = useCancelLeaveRequest();

  const [formData, setFormData] = useState({
    leave_type: '',
    start_date: '',
    end_date: '',
    reason: '',
    actual_rh_date: '',
    actual_rh_date_2: '',
    rh_leave_date: '',
    sap_applied: '',
  });

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<{ id: string; employee_name: string } | null>(null);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  // Auto-calculate total days
  const totalDays = useMemo(() => {
    if (!formData.start_date || !formData.end_date) return 0;
    const diff = differenceInDays(new Date(formData.end_date), new Date(formData.start_date)) + 1;
    return diff > 0 ? diff : 0;
  }, [formData.start_date, formData.end_date]);

  // Check if it's a half-day leave type
  const isHalfDay = formData.leave_type.startsWith('CL_1ST') || formData.leave_type.startsWith('CL_2ND');

  // Holiday validation (fetch next year too when the leave range spans Dec→Jan)
  const endDateYear = formData.end_date ? new Date(formData.end_date).getFullYear() : currentYear;
  const needsNextYear = endDateYear > currentYear;
  const needsNextYearForRH = formData.leave_type === 'RH';
  const { data: holidays = [] } = useHolidaysByYear(currentYear);
  const { data: nextYearHolidays = [] } = useHolidaysByYear(needsNextYear || needsNextYearForRH ? (needsNextYear ? endDateYear : currentYear + 1) : currentYear + 1);
  const allHolidays = useMemo(() => {
    if (!needsNextYear && !needsNextYearForRH) return holidays;
    const ids = new Set(holidays.map(h => h.id));
    return [...holidays, ...nextYearHolidays.filter(h => !ids.has(h.id))];
  }, [holidays, nextYearHolidays, needsNextYear, needsNextYearForRH]);

  // Available RH dates from the holiday calendar for the current (and next) year
  const availableRHDates = useMemo(() => {
    return allHolidays
      .filter((h) => h.type === 'RH')
      .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
  }, [allHolidays]);

  // Determine if the selected RH date is in the past (comp-off mode)
  const isRHPastDate = useMemo(() => {
    if (formData.leave_type !== 'RH' || !formData.actual_rh_date) return false;
    return isBefore(new Date(formData.actual_rh_date), startOfDay(new Date()));
  }, [formData.leave_type, formData.actual_rh_date]);
  const holidayConflicts = useMemo<HolidayConflict[]>(() => {
    if (!formData.start_date || !formData.end_date) return [];
    return validateLeaveAgainstHolidays(
      new Date(formData.start_date),
      new Date(formData.end_date),
      allHolidays
    );
  }, [formData.start_date, formData.end_date, allHolidays]);
  // Detect CH (Closed Holiday) dates within the leave range for CL / COMP_OFF leave types
  const chDatesInRange = useMemo<{ date: string; holiday: HolidayInfo }[]>(() => {
    if (!formData.start_date || !formData.end_date) return [];
    const leaveType = formData.leave_type;
    // Only apply CH comp-off rule for CL-family and COMP_OFF leave types
    const isCLFamily = ['CL', 'CL_CON', 'CL_1ST', 'CL_1ST_CON', 'CL_2ND', 'CL_2ND_CON'].includes(leaveType);
    if (!isCLFamily && leaveType !== 'COMP_OFF') return [];

    const days = eachDayOfInterval({ start: new Date(formData.start_date), end: new Date(formData.end_date) });
    const results: { date: string; holiday: HolidayInfo }[] = [];
    for (const day of days) {
      const holiday = isHoliday(day, allHolidays as HolidayInfo[]);
      if (holiday && holiday.type === 'CH') {
        results.push({ date: format(day, 'yyyy-MM-dd'), holiday });
      }
    }
    return results;
  }, [formData.start_date, formData.end_date, formData.leave_type, allHolidays]);

  // Effective days: exclude CH dates from CL / COMP_OFF balance deduction
  const requestedDays = isHalfDay ? 0.5 : Math.max(totalDays - chDatesInRange.length, 0);
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
  // Calculate approved days for current year as fallback when balance table is empty
  const approvedDaysForCurrentYear = useMemo(() => {
    if (!balanceBucket || balanceBucket === 'comp_off') return 0;
    
    const bucketLeaveTypes = getLeaveTypesForBucket(balanceBucket);
    return myRequests
      .filter((req) => {
        if (!bucketLeaveTypes.includes(req.leave_type)) return false;
        if (req.status !== 'Approved') return false;
        const reqYear = new Date(req.start_date).getFullYear();
        return reqYear === currentYear;
      })
      .reduce((sum, req) => {
        const isHalfDayReq = req.leave_type === 'CL_1ST' || req.leave_type === 'CL_2ND';
        return sum + (isHalfDayReq ? 0.5 : (req.total_days || 0));
      }, 0);
  }, [balanceBucket, currentYear, myRequests]);

  const availableBalance = useMemo(() => {
    if (balanceBucket === 'comp_off') {
      return compOffAllocation?.availableCount ?? 0;
    }

    // Prefer employee leave record (from Google Sheets) for CL/RH
    if (employeeLeaveRecord) {
      if (balanceBucket === 'cl') {
        return employeeLeaveRecord.casualRemaining;
      }
      if (balanceBucket === 'rh') {
        return DEFAULT_RH_BALANCE - employeeLeaveRecord.restrictedCount;
      }
    }

    // Fallback to leave_balances table
    if (matchingBalanceEntries && matchingBalanceEntries.length > 0) {
      return matchingBalanceEntries.reduce((total, balance) => total + Number(balance.balance || 0), 0);
    }

    // Final fallback: use default balance minus approved leaves for current year
    if (balanceBucket === 'cl') return DEFAULT_CL_BALANCE - approvedDaysForCurrentYear;
    if (balanceBucket === 'rh') return DEFAULT_RH_BALANCE - approvedDaysForCurrentYear;
    return null;
  }, [
    balanceBucket,
    compOffAllocation?.availableCount,
    employeeLeaveRecord,
    matchingBalanceEntries,
    approvedDaysForCurrentYear,
  ]);
  const balanceYear = matchingBalanceEntries?.[0]?.year ?? null;
  const balanceLabel = getBalanceBucketLabel(balanceBucket);

  // Tally pending days for the same leave-type bucket in current year.
  // Approved leaves are excluded because their balance is already deducted
  // server-side via the deduct_leave_balance RPC on approval.
  // Half-day leaves (CL_1ST, CL_2ND) count as 0.5 days instead of 1.
  const alreadyAppliedDays = useMemo(() => {
    if (!balanceBucket) return 0;
    if (balanceBucket === 'comp_off') return pendingCompOffDays;

    const bucketLeaveTypes = getLeaveTypesForBucket(balanceBucket);
    return myRequests
      .filter((req) => {
        if (!bucketLeaveTypes.includes(req.leave_type)) return false;
        const status = req.status;
        if (status !== 'Pending WSO' && status !== 'Pending Supervisor') return false;
        const reqYear = new Date(req.start_date).getFullYear();
        return reqYear === currentYear;
      })
      .reduce((sum, req) => {
        // Half-day leaves count as 0.5 days
        const isHalfDayReq = req.leave_type === 'CL_1ST' || req.leave_type === 'CL_2ND';
        return sum + (isHalfDayReq ? 0.5 : (req.total_days || 0));
      }, 0);
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
  useEffect(() => {
    if (!formData.leave_type || !balanceBucket) return;
    const balanceSource = balanceBucket === 'comp_off'
      ? 'comp_off_allocation'
      : employeeLeaveRecord
        ? 'ledger_record'
        : matchingBalanceEntries?.length
          ? 'leave_balances_table'
          : 'default_minus_approved';
    // #region agent log
    fetch('http://127.0.0.1:7366/ingest/cec5e719-b092-499e-b7f6-47f8a73a026c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'037720'},body:JSON.stringify({sessionId:'037720',location:'LeaveApplication.tsx:balance',message:'Apply leave balance computation',data:{leaveType:formData.leave_type,balanceBucket,balanceSource,ledgerCasualRemaining:employeeLeaveRecord?.casualRemaining??null,ledgerRestrictedCount:employeeLeaveRecord?.restrictedCount??null,dbBalanceTotal:matchingBalanceEntries?.reduce((t,b)=>t+Number(b.balance||0),0)??null,approvedDaysForCurrentYear,availableBalance,alreadyAppliedDays,effectiveBalance,requestedDays,hasInsufficientBalance,leaveBalancesLoading,ledgerLoading:leaveLedgerQuery.isLoading},timestamp:Date.now(),hypothesisId:'H3-H4'})}).catch(()=>{});
    // #endregion
  }, [alreadyAppliedDays, approvedDaysForCurrentYear, availableBalance, balanceBucket, effectiveBalance, employeeLeaveRecord, formData.leave_type, hasInsufficientBalance, leaveBalancesLoading, leaveLedgerQuery.isLoading, matchingBalanceEntries, requestedDays]);

  const balanceMessage = hasApplicableBalanceCheck
    ? balanceBucket === 'comp_off' && !employeeEmpId
      ? 'Comp-off allocation is unavailable because your employee ID is missing from the profile.'
      : balanceBucket === 'comp_off' && compOffLedgerLoading
        ? 'Checking the earned comp-off entries available for this request.'
        : balanceBucket === 'comp_off' && hasInsufficientBalance
          ? `Comp Off balance is insufficient. Earned entries available: ${availableBalance ?? 0}, already reserved by pending requests: ${alreadyAppliedDays}, remaining: ${effectiveBalance ?? 0}. You are requesting ${requestedDays} day${requestedDays === 1 ? '' : 's'}.`
          : balanceBucket === 'comp_off'
            ? `Comp Off balance: ${availableBalance ?? 0}, pending requests using balance: ${alreadyAppliedDays}, usable now: ${effectiveBalance ?? 0}. Requesting: ${requestedDays}.`
            : leaveBalancesLoading
              ? 'Checking your available leave balance.'
              : hasInsufficientBalance
                ? `${balanceLabel} balance is insufficient. Total: ${availableBalance ?? 0}, already applied: ${alreadyAppliedDays}, remaining: ${effectiveBalance ?? 0}. You are requesting ${requestedDays} day${requestedDays === 1 ? '' : 's'}. Please correct your leave application.`
                : typeof effectiveBalance === 'number'
                  ? `${balanceLabel} balance: ${availableBalance ?? 0}${balanceYear && balanceYear !== currentYear ? ` (from ${balanceYear})` : ''}, applied: ${alreadyAppliedDays}, remaining: ${effectiveBalance}. Requesting: ${requestedDays}.`
                  : null
    : null;

  const today = startOfDay(new Date());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    // Validate dates
    if (totalDays <= 0) {
      toast.error('End date must be after or equal to start date');
      return;
    }

    // When all selected dates fall on Closed Holidays, auto-convert to Compensatory Off
    const allDatesCH = formData.leave_type !== 'RH' && !isHalfDay && requestedDays <= 0 && totalDays > 0 && chDatesInRange.length > 0;
    const effectiveLeaveType = allDatesCH ? 'COMP_OFF' : formData.leave_type;
    const effectiveTotalDays = allDatesCH ? totalDays : (formData.leave_type === 'RH' ? 1 : requestedDays);

    if (isBefore(new Date(formData.start_date), today) && formData.leave_type !== 'RH') {
      toast.error('Cannot apply leave for past dates');
      return;
    }

    if (isHalfDay && formData.start_date !== formData.end_date) {
      toast.error('Half-day leave must be for a single date');
      return;
    }

    // RH must have an RH date selected
    if (formData.leave_type === 'RH' && !formData.actual_rh_date) {
      toast.error('Please select a Restricted Holiday');
      return;
    }

    // RH date must exist in system
    if (formData.leave_type === 'RH' && formData.actual_rh_date) {
      const rhExists = availableRHDates.some((h) => h.holiday_date === formData.actual_rh_date);
      if (!rhExists) {
        toast.error('The selected Restricted Holiday is not a valid RH date in the system');
        return;
      }
    }

    // Past RH used as comp off must have a future leave date
    if (formData.leave_type === 'RH' && isRHPastDate) {
      if (!formData.rh_leave_date) {
        toast.error('Please select a future leave date for this past Restricted Holiday');
        return;
      }
      if (isBefore(new Date(formData.rh_leave_date), startOfDay(new Date()))) {
        toast.error('The leave date must be a future date');
        return;
      }
    }

    if (hasApplicableBalanceCheck && ((balanceBucket === 'comp_off' && compOffLedgerLoading) || (balanceBucket !== 'comp_off' && leaveBalancesLoading))) {
      toast.error('Leave balance is still loading. Please try again in a moment.');
      return;
    }

    if (hasInsufficientBalance) {
      // #region agent log
      fetch('http://127.0.0.1:7366/ingest/cec5e719-b092-499e-b7f6-47f8a73a026c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'037720'},body:JSON.stringify({sessionId:'037720',location:'LeaveApplication.tsx:submit-blocked',message:'Submit blocked by insufficient balance',data:{leaveType:formData.leave_type,balanceBucket,availableBalance,alreadyAppliedDays,effectiveBalance,requestedDays,balanceMessage},timestamp:Date.now(),hypothesisId:'H3-H4'})}).catch(()=>{});
      // #endregion
      toast.error(balanceMessage || 'Insufficient leave balance for this request.');
      return;
    }

    if (!formData.sap_applied) {
      toast.error('Please confirm whether you have already applied this leave on SAP.');
      return;
    }

    try {
      const result = await createRequest.mutateAsync({
        employee_id: user.id,
        employee_name: profile.full_name,
        team: profile.current_shift?.toUpperCase() || null,
        sap_applied: formData.sap_applied === 'yes',
        leave_type: effectiveLeaveType,
        start_date: formData.start_date,
        end_date: formData.end_date,
        total_days: effectiveTotalDays,
        reason: allDatesCH
          ? `[Auto-converted from ${getLeaveTypeLabel(formData.leave_type)} → Compensatory Off: all dates fall on Closed Holidays]${formData.reason ? ` ${formData.reason}` : ''}`
          : (formData.reason || null),
        actual_rh_date: formData.leave_type === 'RH' && formData.actual_rh_date ? formData.actual_rh_date : null,
        actual_rh_date_2: null,
        ch_comp_off_dates: chDatesInRange.length > 0 ? chDatesInRange.map(ch => ({ date: ch.date, holiday_name: ch.holiday.name, holiday_id: ch.holiday.id })) : null,
      });

      // Upload attachment if a file was selected
      if (attachmentFile && result?.id) {
        setIsUploadingAttachment(true);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            const fd = new FormData();
            fd.append('file', attachmentFile);
            fd.append('leave_request_id', result.id);
            const uploadResp = await fetch('/api/upload/leave-document', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${session.access_token}` },
              body: fd,
            });
            if (uploadResp.ok) {
              toast.success('Document attached successfully');
            } else {
              let errMsg = `Upload failed (${uploadResp.status})`;
              try {
                const errJson = await uploadResp.json();
                errMsg = errJson.error || errJson.details || errMsg;
              } catch { /* ignore parse error */ }
              console.error('[LeaveApplication] document upload failed', uploadResp.status, errMsg);
              toast.error(`Leave submitted but document upload failed: ${errMsg}`);
            }
          }
        } catch (uploadErr) {
          console.error('[LeaveApplication] document upload error', uploadErr);
          toast.error('Leave submitted but document upload failed. You can attach it later from your history.');
        } finally {
          setIsUploadingAttachment(false);
        }
      }

      if (allDatesCH) {
        toast.success(`All dates fall on Closed Holidays — your ${getLeaveTypeLabel(formData.leave_type)} has been submitted as Compensatory Off.`, { duration: 6000 });
      } else {
        toast.success('Leave request submitted successfully');
      }
      setFormData({ leave_type: '', start_date: '', end_date: '', reason: '', actual_rh_date: '', actual_rh_date_2: '', rh_leave_date: '', sap_applied: '' });
      setAttachmentFile(null);
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
  const approvedCount = myRequests.filter(r => isFinalLeaveApproved(r)).length;
  const pendingCount = myRequests.filter(r => r.status === 'Pending WSO' || r.status === 'Pending Supervisor').length;
  const rejectedCount = myRequests.filter(r => r.status === 'Rejected').length;
  const upcomingRequest = useMemo(() => {
    return [...myRequests]
      .filter((request) =>
        request.status !== 'Rejected' &&
        request.status !== 'Cancelled' &&
        !isBefore(new Date(request.start_date), today)
      )
      .sort((left, right) => left.start_date.localeCompare(right.start_date))[0] ?? null;
  }, [myRequests, today]);
  const submitDisabled = createRequest.isPending || !formData.leave_type || !formData.start_date || !formData.end_date || !formData.sap_applied || (Boolean(balanceBucket && formData.leave_type) && ((balanceBucket === 'comp_off' && compOffLedgerLoading) || (balanceBucket !== 'comp_off' && leaveBalancesLoading))) || hasInsufficientBalance;
  const timelineRequests = [...myRequests]
    .sort((left, right) => right.applied_at.localeCompare(left.applied_at))
    .slice(0, 6);
  const fieldLabelClass = 'text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300 sm:text-[11px]';
  const fieldInputClass = 'h-9 rounded-xl border border-slate-200/90 bg-white px-3 text-[13px] text-slate-900 shadow-[0_10px_25px_-20px_rgba(15,23,42,0.45)] transition placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-100 dark:border-slate-700 dark:bg-slate-950/90 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-sky-500 dark:focus-visible:ring-sky-950/40 sm:h-10';
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
                    Employee Leave Portal
                  </h1>
                  <p className="mt-3 max-w-2xl text-[14px] leading-6 text-slate-600 dark:text-slate-300 sm:text-base sm:leading-7">
                    Submit new requests and monitor approval status easily.
                  </p>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4 sm:gap-3">
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
                <div className="rounded-[22px] border border-rose-100 bg-white/90 p-4 shadow-[0_20px_40px_-28px_rgba(244,63,94,0.32)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/75">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400 sm:text-[11px]">Rejected</div>
                  <div className="mt-2 text-[1.7rem] font-black tracking-tight text-rose-600 dark:text-rose-400 sm:mt-3 sm:text-3xl">{rejectedCount}</div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">Requests returned without approval</div>
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

            <div className="grid gap-3 sm:gap-3">
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
                        <Badge className={`rounded-full border text-[10px] sm:text-xs ${getLeaveTypeTone(upcomingRequest.leave_type)}`}>
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

            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.35fr)_340px]">
          <Card className="overflow-hidden rounded-2xl border border-sky-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] shadow-[0_24px_70px_-50px_rgba(15,23,42,0.48)] dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))]">
            <div className="border-b border-sky-100/80 bg-[linear-gradient(90deg,rgba(224,242,254,0.82),rgba(240,253,250,0.72))] px-4 py-3 dark:border-slate-800 dark:bg-[linear-gradient(90deg,rgba(15,23,42,0.88),rgba(17,24,39,0.74))] sm:px-6 sm:py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-sky-700 dark:text-sky-300 sm:text-[11px]">New request</div>
                  <h2 className="mt-1 text-[1.35rem] font-black tracking-[-0.035em] text-slate-950 dark:text-slate-50 sm:text-[1.7rem]">Apply for leave</h2>
                  <p className="mt-1 max-w-2xl text-[11px] leading-4 text-slate-600 dark:text-slate-300 sm:text-xs">
                    Fill in the dates, choose the right leave type, and submit once the conflict panel is clear.
                  </p>
                </div>
              </div>
            </div>

            <CardContent className="p-4 sm:p-5">
              <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                <div className="grid gap-2.5 sm:gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-1 md:col-span-2 xl:col-span-2">
                    <Label className={fieldLabelClass}>Leave type</Label>
                    <Select
                      value={formData.leave_type}
                      onValueChange={(v) => {
                        const newIsHalfDay = v.startsWith('CL_1ST') || v.startsWith('CL_2ND');
                        const isRH = v === 'RH';
                        setFormData({
                          ...formData,
                          leave_type: v,
                          start_date: isRH ? '' : formData.start_date,
                          end_date: isRH ? '' : (newIsHalfDay ? formData.start_date : formData.end_date),
                          actual_rh_date: isRH ? '' : formData.actual_rh_date,
                          actual_rh_date_2: '',
                          rh_leave_date: '',
                        });
                      }}
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
                    <div className="space-y-2 md:col-span-2 xl:col-span-2">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className={fieldLabelClass}>Restricted Holiday</Label>
                          <Select
                            value={formData.actual_rh_date}
                            onValueChange={(v) => {
                              const rhDate = new Date(v);
                              const isPast = isBefore(rhDate, startOfDay(new Date()));
                              if (isPast) {
                                // Past RH: user must pick a future leave date (comp-off mode)
                                setFormData({ ...formData, actual_rh_date: v, actual_rh_date_2: '', rh_leave_date: '', start_date: '', end_date: '' });
                              } else {
                                // Future/today RH: leave is on that date
                                setFormData({ ...formData, actual_rh_date: v, actual_rh_date_2: '', rh_leave_date: '', start_date: v, end_date: v });
                              }
                            }}
                          >
                            <SelectTrigger className={fieldInputClass}>
                              <SelectValue placeholder="Select a Restricted Holiday" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableRHDates.map((h) => (
                                <SelectItem key={h.id} value={h.holiday_date}>
                                  {format(new Date(h.holiday_date), 'dd MMM yyyy')} — {h.name}
                                  {isBefore(new Date(h.holiday_date), startOfDay(new Date())) ? ' (past — comp off)' : ''}
                                </SelectItem>
                              ))}
                              {availableRHDates.length === 0 && (
                                <SelectItem value="__none" disabled>No Restricted Holidays available</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        {isRHPastDate && (
                          <div className="space-y-1.5">
                            <Label className={fieldLabelClass}>Leave date <span className="normal-case tracking-normal font-normal text-fuchsia-500 dark:text-fuchsia-400">(comp off)</span></Label>
                            <Input
                              type="date"
                              lang="en-GB"
                              value={formData.rh_leave_date}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormData({ ...formData, rh_leave_date: val, start_date: val, end_date: val });
                              }}
                              min={format(new Date(), 'yyyy-MM-dd')}
                              required
                              className={fieldInputClass}
                            />
                          </div>
                        )}
                      </div>

                      {isRHPastDate ? (
                        <p className="rounded-2xl border border-fuchsia-100 bg-fuchsia-50/80 px-3 py-2 text-[11px] leading-5 text-fuchsia-700 dark:border-fuchsia-900/50 dark:bg-fuchsia-950/20 dark:text-fuchsia-300">
                          This Restricted Holiday has passed. Pick a future date to use it as comp off. The leave will be for 1 day on the date you choose.
                        </p>
                      ) : formData.actual_rh_date ? (
                        <p className="rounded-2xl border border-sky-100 bg-sky-50/80 px-3 py-2 text-[11px] leading-5 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300">
                          Your leave will be on {format(new Date(formData.actual_rh_date), 'dd MMM yyyy')} (1 day). Each RH leave is an individual single-day leave.
                        </p>
                      ) : (
                        <p className="rounded-2xl border border-sky-100 bg-sky-50/80 px-3 py-2 text-[11px] leading-5 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300">
                          Select a Restricted Holiday from the system. Future dates are taken directly. Past dates can be used as comp off on a future date of your choice.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="grid gap-2.5 sm:gap-3 md:col-span-2 md:grid-cols-2 xl:col-span-2">
                    <div className="space-y-1">
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
                        disabled={formData.leave_type === 'RH'}
                        className={`${fieldInputClass} disabled:cursor-not-allowed disabled:opacity-70`}
                      />
                      {formData.leave_type === 'RH' && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">{isRHPastDate ? 'Auto-filled from comp-off leave date' : 'Auto-filled from selected RH date'}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <Label className={fieldLabelClass}>End date</Label>
                      <Input
                        type="date"
                        lang="en-GB"
                        value={formData.end_date}
                        onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                        min={formData.start_date || format(new Date(), 'yyyy-MM-dd')}
                        disabled={isHalfDay || formData.leave_type === 'RH'}
                        required
                        className={`${fieldInputClass} disabled:cursor-not-allowed disabled:opacity-70`}
                      />
                      {formData.leave_type === 'RH' && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">{isRHPastDate ? 'Auto-filled from comp-off leave date' : 'Auto-filled from selected RH date'}</p>
                      )}
                    </div>

                    <div className="space-y-1 md:col-span-2">
                      <Label className={fieldLabelClass}>Duration</Label>
                      <div className="flex h-9 items-center justify-between rounded-xl border border-slate-200/90 bg-gradient-to-r from-slate-50 to-sky-50/70 px-3 shadow-[0_10px_25px_-20px_rgba(15,23,42,0.45)] dark:border-slate-700 dark:from-slate-900 dark:to-slate-900/70 sm:h-10">
                        <span className="text-xs text-slate-500 dark:text-slate-400">{chDatesInRange.length > 0 ? 'Effective (excl. CH)' : 'Auto'}</span>
                        <span className="text-base font-black tracking-tight text-slate-950 dark:text-slate-50">{isHalfDay ? '0.5' : chDatesInRange.length > 0 ? requestedDays : totalDays > 0 ? totalDays : ''}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className={fieldLabelClass}>Reason</Label>
                  <Textarea
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    placeholder="Add context that helps the approver understand the leave request."
                    rows={3}
                    className="min-h-[90px] rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-[13px] leading-5 text-slate-900 shadow-[0_10px_25px_-20px_rgba(15,23,42,0.45)] transition placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-100 dark:border-slate-700 dark:bg-slate-950/90 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-sky-500 dark:focus-visible:ring-sky-950/40 sm:min-h-[105px] sm:py-2.5"
                  />
                </div>

                {(() => {
                  const rhConflicts = holidayConflicts.filter(c => c.holiday.type === 'RH');
                  const otherConflicts = holidayConflicts.filter(c => c.holiday.type !== 'RH');
                  if (holidayConflicts.length === 0) return null;
                  return (
                    <div className="grid gap-1.5">
                      {otherConflicts.map((conflict, index) => (
                        <div
                          key={`other-${index}`}
                          className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-5 ${getHolidayNoticeTone(conflict.holiday.type)}`}
                        >
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{conflict.message}</span>
                        </div>
                      ))}
                      {rhConflicts.length > 0 && (
                        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-5 ${getHolidayNoticeTone('RH')}`}>
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

                {chDatesInRange.length > 0 && (
                  <div className={`rounded-xl border px-3 py-2 text-xs leading-5 ${
                    requestedDays <= 0 && totalDays > 0
                      ? 'border-amber-200 bg-amber-50/90 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                      : 'border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                  }`}>
                    <div className="flex items-start gap-2">
                      {requestedDays <= 0 && totalDays > 0 ? (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      )}
                      <div>
                        {requestedDays <= 0 && totalDays > 0 ? (
                          <div className="font-semibold">All selected dates are Closed Holidays — this will be submitted as Compensatory Off instead of {getLeaveTypeLabel(formData.leave_type)}</div>
                        ) : (
                          <div className="font-semibold">Closed Holiday dates will not be deducted from your {formData.leave_type === 'COMP_OFF' ? 'Comp Off' : 'Casual Leave'} balance</div>
                        )}
                        <div className="mt-1.5 space-y-1">
                          {chDatesInRange.map((ch) => (
                            <div key={ch.date} className="text-[12px] sm:text-[13px]">
                              <span className="font-medium">{format(new Date(ch.date), 'dd MMM yyyy')}</span> — {ch.holiday.name}
                            </div>
                          ))}
                        </div>
                        {requestedDays > 0 && (
                          <div className="mt-2 text-[11px] leading-4 text-emerald-600 dark:text-emerald-400">
                            Only {requestedDays} day{requestedDays === 1 ? '' : 's'} will be deducted from your balance. The {chDatesInRange.length} CH date{chDatesInRange.length === 1 ? '' : 's'} will earn comp off credit instead.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {balanceMessage && (
                  <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-5 ${hasInsufficientBalance
                    ? 'border-rose-200 bg-rose-50/90 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
                    : 'border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                    }`}>
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{balanceMessage}</span>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] p-2.5 shadow-[0_14px_35px_-28px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.96))] sm:rounded-2xl sm:p-3.5">
                  <div className="flex items-center justify-between gap-2 sm:items-start">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300 sm:text-[11px] sm:tracking-[0.2em]">Attachment</div>
                      <p className="mt-0.5 text-[11px] leading-4 text-slate-600 dark:text-slate-300 sm:mt-1 sm:text-xs sm:leading-5">
                        Attach a supporting document (medical certificate, travel proof, etc.)
                      </p>
                    </div>
                    <div className="shrink-0 rounded-full border border-slate-200 bg-slate-50/80 px-2 py-1 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400 sm:px-3 sm:py-1.5 sm:text-xs">
                      Optional
                    </div>
                  </div>

                  {attachmentFile ? (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/80 p-2 dark:border-sky-900/40 dark:bg-sky-950/20 sm:mt-3 sm:rounded-xl sm:p-2.5">
                      <FileText className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400 sm:h-5 sm:w-5" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-900 dark:text-slate-100 sm:text-sm">{attachmentFile.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {(attachmentFile.size / 1024).toFixed(0)} KB
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 rounded-full p-0 text-slate-400 hover:text-rose-500 sm:h-8 sm:w-8"
                        onClick={() => setAttachmentFile(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 px-2.5 py-2 transition hover:border-sky-300 hover:bg-sky-50/50 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-sky-800 dark:hover:bg-sky-950/20 sm:mt-3 sm:gap-2.5 sm:rounded-xl sm:px-3 sm:py-2.5">
                      <Paperclip className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500 sm:h-5 sm:w-5" />
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200 sm:text-[13px]">Click to select a file</span>
                        <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-500 sm:ml-2 sm:text-[12px]">PDF/JPG/PNG/WebP, max 4 MB</span>
                      </div>
                      <input
                        type="file"
                        className="hidden"
                        accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 4 * 1024 * 1024) {
                            toast.error('File is too large. Maximum size is 4 MB.');
                            return;
                          }
                          setAttachmentFile(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] p-2.5 shadow-[0_14px_35px_-28px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.96))] sm:rounded-2xl sm:p-3.5">
                  <div className="flex items-center justify-between gap-2 sm:items-start">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300 sm:text-[11px] sm:tracking-[0.2em]">SAP confirmation</div>
                      <p className="mt-0.5 text-[11px] leading-4 text-slate-600 dark:text-slate-300 sm:mt-1 sm:text-xs sm:leading-5">
                        Have you already applied this leave in SAP?
                      </p>
                    </div>
                    <div className="shrink-0 rounded-full border border-sky-100 bg-sky-50/80 px-2 py-1 text-[10px] font-medium text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300 sm:px-3 sm:py-1.5 sm:text-xs">
                      Required before submission
                    </div>
                  </div>

                  <RadioGroup
                    value={formData.sap_applied}
                    onValueChange={(value) => setFormData({ ...formData, sap_applied: value })}
                    className="mt-2 grid gap-1.5 sm:mt-3 sm:grid-cols-2 sm:gap-2"
                  >
                    <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition sm:gap-2.5 sm:rounded-xl sm:px-3 sm:py-2.5 ${formData.sap_applied === 'yes'
                      ? 'border-emerald-300 bg-emerald-50/90 shadow-[0_18px_35px_-28px_rgba(16,185,129,0.55)] dark:border-emerald-900/50 dark:bg-emerald-950/25'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/80 dark:hover:border-slate-700'
                      }`}>
                      <RadioGroupItem value="yes" id="sap-applied-yes" className="mt-0.5" />
                      <div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 sm:text-[13px]">Yes, already applied</div>
                        <div className="hidden text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:mt-0.5 sm:block">SAP leave application has already been submitted.</div>
                      </div>
                    </label>

                    <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition sm:gap-2.5 sm:rounded-xl sm:px-3 sm:py-2.5 ${formData.sap_applied === 'no'
                      ? 'border-amber-300 bg-amber-50/90 shadow-[0_18px_35px_-28px_rgba(245,158,11,0.55)] dark:border-amber-900/50 dark:bg-amber-950/25'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/80 dark:hover:border-slate-700'
                      }`}>
                      <RadioGroupItem value="no" id="sap-applied-no" className="mt-0.5" />
                      <div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 sm:text-[13px]">No, not yet applied</div>
                        <div className="hidden text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:mt-0.5 sm:block">This portal request is being submitted first.</div>
                      </div>
                    </label>
                  </RadioGroup>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {hasInsufficientBalance
                      ? 'Available leave balance must cover the requested days before submission.'
                      : 'Holiday and RH matches are shown as review notes. Your request will be sent to the approval chain immediately after submission.'}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-full border-slate-300 px-5 text-[12px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      onClick={() => { setFormData({ leave_type: '', start_date: '', end_date: '', reason: '', actual_rh_date: '', actual_rh_date_2: '', rh_leave_date: '', sap_applied: '' }); setAttachmentFile(null); }}
                    >
                      Reset
                    </Button>
                    <Button type="submit" className="h-10 rounded-full bg-gradient-to-r from-sky-600 via-cyan-500 to-teal-500 px-5 text-[12px] font-semibold text-white shadow-[0_20px_42px_-28px_rgba(14,165,233,0.7)] hover:opacity-95" disabled={submitDisabled || isUploadingAttachment}>
                      {isUploadingAttachment ? 'Uploading document...' : createRequest.isPending ? 'Submitting...' : 'Submit request'}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <Card className="rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_20px_55px_-45px_rgba(15,23,42,0.42)] dark:border-slate-800 dark:bg-slate-950/95">
              <CardHeader className="pb-1.5 pt-4">
                <CardTitle className="text-[14px] font-bold">Before you submit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-2.5 dark:border-sky-900/40 dark:bg-sky-950/20">
                  Choose the exact leave type. Half-day casual leave locks the request to a single day.
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  Use the reason box for operational context. Short, precise explanations get reviewed faster.
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
                  Holiday and RH alerts are informational only, so you can still submit after reviewing them.
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-2 sm:space-y-3">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.24em]">Recent activity</div>
              <h2 className="mt-0.5 text-lg font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50 sm:mt-1 sm:text-[1.35rem]">Leave history</h2>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-600 dark:text-slate-300 sm:mt-1 sm:text-xs">
                A cleaner request timeline with direct visibility into dates, status, and remarks.
              </p>
            </div>
            <Button asChild variant="outline" className="h-8 rounded-full border-slate-300/80 bg-white/80 px-3 text-[11px] dark:border-slate-700 dark:bg-slate-900/70 sm:h-9 sm:px-4 sm:text-xs">
              <Link to="/employee/leave-history">Open detailed history</Link>
            </Button>
          </div>

          <div className="grid gap-1.5 sm:gap-2.5">
            {timelineRequests.map((req) => {
              const statusInfo = getLeaveStatusInfo(req.status);
              const cancelable = req.status === 'Pending WSO' || req.status === 'Pending Supervisor';

              return (
                <Card key={req.id} className={`rounded-xl border ${getRequestBorderTone(req.status)} shadow-[0_10px_30px_-28px_rgba(15,23,42,0.45)] sm:rounded-2xl sm:shadow-[0_14px_45px_-38px_rgba(15,23,42,0.45)]`}>
                  <CardContent className="p-2 sm:p-3.5">
                    <div className="space-y-1.5 sm:space-y-2.5">
                      <div className="flex flex-col gap-1.5 md:flex-row md:items-start md:justify-between">
                        <div className="flex flex-wrap items-center gap-1">
                          <div className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-xs">
                            {getRequestStatusIcon(req.status)}
                            {getLeaveTypeLabel(req.leave_type)}
                          </div>
                          <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[9px] font-medium sm:px-3 sm:py-1 sm:text-[11px]">
                            {req.total_days} day{req.total_days === 1 ? '' : 's'}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-1 md:justify-end">
                          <Badge className={`rounded-full border px-2 py-0.5 text-[9px] font-medium sm:px-3 sm:py-1 sm:text-[11px] ${getStatusTone(req.status)}`}>
                            {statusInfo.label}
                          </Badge>
                          {cancelable && !req.attachment_path && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 rounded-full border-sky-200 px-2 text-[10px] text-sky-600 hover:bg-sky-50 hover:text-sky-700 dark:border-sky-900/50 dark:text-sky-400 dark:hover:bg-sky-950/30 sm:h-8 sm:px-3 sm:text-[11px]"
                              onClick={() => { setUploadTarget({ id: req.id, employee_name: req.employee_name }); setUploadDialogOpen(true); }}
                            >
                              <Paperclip className="mr-1 h-3 w-3 sm:mr-2 sm:h-4 sm:w-4" />
                              Add Doc
                            </Button>
                          )}
                          {cancelable && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 rounded-full border-rose-200 px-2 text-[10px] text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-950/30 sm:h-8 sm:px-3 sm:text-[11px]"
                              onClick={() => { setCancelTarget(req.id); setCancelDialogOpen(true); }}
                            >
                              <Ban className="mr-1 h-3 w-3 sm:mr-2 sm:h-4 sm:w-4" />
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-1 sm:gap-2">
                        <div className="rounded-lg bg-slate-50/90 p-1.5 dark:bg-slate-900/80 sm:rounded-xl sm:p-2.5">
                          <div className="text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 sm:text-[9px] sm:tracking-[0.14em]">Applied</div>
                          <div className="mt-0.5 text-[10px] font-semibold text-slate-900 dark:text-slate-100 sm:text-xs">{format(new Date(req.applied_at), 'dd/MM/yy')}</div>
                        </div>
                        <div className="rounded-lg bg-slate-50/90 p-1.5 dark:bg-slate-900/80 sm:rounded-xl sm:p-2.5">
                          <div className="text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 sm:text-[9px] sm:tracking-[0.14em]">Start</div>
                          <div className="mt-0.5 text-[10px] font-semibold text-slate-900 dark:text-slate-100 sm:text-xs">{format(new Date(req.start_date), 'dd/MM/yy')}</div>
                        </div>
                        <div className="rounded-lg bg-slate-50/90 p-1.5 dark:bg-slate-900/80 sm:rounded-xl sm:p-2.5">
                          <div className="text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 sm:text-[9px] sm:tracking-[0.14em]">End</div>
                          <div className="mt-0.5 text-[10px] font-semibold text-slate-900 dark:text-slate-100 sm:text-xs">{format(new Date(req.end_date), 'dd/MM/yy')}</div>
                        </div>
                      </div>

                      <div className="max-h-9 overflow-hidden rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] leading-4 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 sm:max-h-none sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs sm:leading-5">
                        {req.reason || req.remarks || (req.status === 'Pending Supervisor'
                          ? 'In final approval review.'
                          : 'No remarks added for this request.')}
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

        {/* Upload Document Dialog */}
        <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Attach Supporting Document</DialogTitle>
              <DialogDescription>
                Upload a medical certificate, travel document, or other supporting evidence for your leave request.
              </DialogDescription>
            </DialogHeader>
            {uploadTarget && (
              <div className="space-y-4">
                <div className="rounded-lg bg-muted/30 p-3 text-sm">
                  <span className="font-medium">Request by:</span> {uploadTarget.employee_name}
                </div>
                <LeaveDocumentUpload
                  leaveRequestId={uploadTarget.id}
                  onChange={(attachment) => {
                    if (attachment) {
                      toast.success('Document uploaded successfully');
                      setUploadDialogOpen(false);
                      setUploadTarget(null);
                    }
                  }}
                />
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
