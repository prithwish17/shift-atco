import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDutyExchanges, useCreateDutyExchange, useExchangeApprovals, useProcessExchangeApproval } from "@/hooks/useDutyExchanges";
import { useShifts } from "@/hooks/useShifts";
import { useUsers } from "@/hooks/useUsers";
import { useEmployeeSchedules, DUTY_DESCRIPTIONS, useEmployeeDirectory } from "@/hooks/useEmployeeSchedules";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";

function formatShiftLabel(shift: any) {
  if (!shift) return "Not selected";
  return `${format(new Date(shift.shift_date), "dd MMM yyyy")} - ${shift.duty_type} (${shift.shift_type})`;
}

function formatScheduleLabel(schedule: any) {
  if (!schedule) return null;
  const desc = DUTY_DESCRIPTIONS[schedule.duty_code] || schedule.duty_description || schedule.duty_code;
  return `${schedule.duty_code} — ${desc}`;
}

function formatDutyDisplay(shift: any, schedule: any, dutyDate: string | null) {
  // Prefer schedule data (from employee_schedules), fall back to shift data
  if (schedule) {
    const desc = DUTY_DESCRIPTIONS[schedule.duty_code] || schedule.duty_description || schedule.duty_code;
    const dateStr = dutyDate ? format(new Date(dutyDate), "dd MMM yyyy") + " - " : "";
    return `${dateStr}${schedule.duty_code} (${desc})`;
  }
  if (shift) {
    return formatShiftLabel(shift);
  }
  return "Duty not available";
}

function formatPartnerLabel(partner: any) {
  if (!partner) return "";
  return `${partner.full_name} (${partner.employee_id || partner.employee_code})`;
}

function isUuidLike(value?: string | null) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getStatusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function getStatusTone(status: string) {
  if (status === "approved" || status === "completed") {
    return {
      badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      iconClass: "text-emerald-600",
      cardClass: "border-emerald-200 bg-white",
    };
  }

  if (status === "rejected" || status === "cancelled") {
    return {
      badgeClass: "border-red-200 bg-red-50 text-red-700",
      iconClass: "text-red-600",
      cardClass: "border-red-200 bg-white",
    };
  }

  if (status === "pending_partner") {
    return {
      badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
      iconClass: "text-sky-600",
      cardClass: "border-sky-200 bg-white",
    };
  }

  return {
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
    iconClass: "text-amber-600",
    cardClass: "border-amber-200 bg-white",
  };
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5 sm:rounded-3xl sm:p-4 dark:border-slate-800 dark:bg-slate-900/70">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 sm:text-[11px] sm:tracking-[0.22em] dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-slate-950 sm:mt-2 sm:text-2xl dark:text-slate-50">{value}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-slate-600 sm:text-sm sm:leading-5 dark:text-slate-300">{hint}</p>
    </div>
  );
}

function PreviewCard({
  title,
  subtitle,
  emptyText,
  tone,
}: {
  title: string;
  subtitle?: string;
  emptyText: string;
  tone: "primary" | "secondary";
}) {
  return (
    <div
      className={cn(
        "rounded-[20px] border p-3 sm:rounded-3xl sm:p-4",
        tone === "primary"
          ? "border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">{title}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{subtitle || emptyText}</p>
    </div>
  );
}

const STEP_LABELS: Record<number, string> = {
  1: "Partner Approval",
  2: "Requester WSO",
  3: "Partner WSO",
  4: "Supervisor",
};

function ApprovalTimeline({ requestId }: { requestId: string }) {
  const { data: steps, isLoading } = useExchangeApprovals(requestId);

  if (isLoading) {
    return <p className="text-xs text-slate-400">Loading approval steps…</p>;
  }

  if (!steps || steps.length === 0) {
    return <p className="text-xs text-slate-400">No approval data available</p>;
  }

  return (
    <div className="space-y-2">
      {steps.map((step) => {
        const isApproved = step.status === "approved";
        const isRejected = step.status === "rejected";
        const isPending = step.status === "pending";

        return (
          <div
            key={step.id}
            className={cn(
              "flex items-center gap-3 rounded-2xl border p-3 text-sm",
              isApproved
                ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                : isRejected
                  ? "border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/20"
                  : "border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/30"
            )}
          >
            <div className="shrink-0">
              {isApproved ? (
                <CheckCircle className="h-4 w-4 text-emerald-600" />
              ) : isRejected ? (
                <XCircle className="h-4 w-4 text-red-600" />
              ) : (
                <Clock className="h-4 w-4 text-slate-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-800 dark:text-slate-200">
                Step {step.sequence_order}: {STEP_LABELS[step.sequence_order] || step.approver_role}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {step.approver_name || "Awaiting assignment"}
                {step.action_at && ` — ${format(new Date(step.action_at), "dd MMM yyyy, HH:mm")}`}
              </p>
              {step.remarks && (
                <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">"{step.remarks}"</p>
              )}
            </div>
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                isApproved
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : isRejected
                    ? "border-red-200 bg-red-50 text-red-700"
                    : isPending
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
              )}
            >
              {step.status}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

export default function DutyExchangeRequest() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: exchanges, isLoading: exchangesLoading, refetch: refetchExchanges } = useDutyExchanges(user?.id);
  const { shifts: myShifts } = useShifts(user?.id);
  const { users } = useUsers();
  const { data: employeeDirectory } = useEmployeeDirectory();
  const createExchange = useCreateDutyExchange();
  const processApproval = useProcessExchangeApproval();

  const [formData, setFormData] = useState({
    exchange_date: "",
    partner_id: "",
    reason: "",
  });
  const [partnerQuery, setPartnerQuery] = useState("");
  const [showPartnerSuggestions, setShowPartnerSuggestions] = useState(false);

  const [expandedExchangeId, setExpandedExchangeId] = useState<string | null>(null);

  const hasSelectedPartner = Boolean(formData.partner_id.trim());
  const selectedPartner = hasSelectedPartner
    ? users?.find((u: any) => u.id === formData.partner_id)
      || employeeDirectory?.find((e: any) => e.id === formData.partner_id || e.employee_code === formData.partner_id)
    : null;
  const currentUserProfile = users?.find((u: any) => u.id === user?.id)
    || employeeDirectory?.find((e: any) => e.id === user?.id);
  const resolvedPartnerUserId = useMemo(() => {
    if (!hasSelectedPartner) return undefined;
    if (isUuidLike(formData.partner_id)) return formData.partner_id;
    const partnerCode = selectedPartner?.employee_id || (selectedPartner as any)?.employee_code || formData.partner_id;
    return users?.find((entry: any) => {
      const entryEmployeeCode = entry.employee_id || entry.employee_code;
      return partnerCode && entryEmployeeCode === partnerCode;
    })?.id;
  }, [formData.partner_id, hasSelectedPartner, selectedPartner, users]);
  const { shifts: partnerShifts } = useShifts(resolvedPartnerUserId || undefined);

  // Fetch employee schedules for duty display (actual duty data lives in employee_schedules)
  const myEmployeeCode = currentUserProfile?.employee_id || (currentUserProfile as any)?.employee_code;
  const partnerEmployeeCode = selectedPartner?.employee_id || (selectedPartner as any)?.employee_code;
  const { data: mySchedules } = useEmployeeSchedules(
    myEmployeeCode || undefined,
    formData.exchange_date || undefined,
    formData.exchange_date || undefined
  );
  const { data: partnerSchedules } = useEmployeeSchedules(
    partnerEmployeeCode || undefined,
    formData.exchange_date || undefined,
    formData.exchange_date || undefined
  );

  const myScheduleOnDate = useMemo(
    () => mySchedules?.find((s: any) => s.duty_date?.substring(0, 10) === formData.exchange_date),
    [mySchedules, formData.exchange_date]
  );
  const partnerScheduleOnDate = useMemo(
    () => partnerSchedules?.find((s: any) => s.duty_date?.substring(0, 10) === formData.exchange_date),
    [partnerSchedules, formData.exchange_date]
  );

  // Shifts for RPC submission (shift IDs)
  const selectedMyShift = useMemo(
    () => myShifts?.find((shift: any) => shift.shift_date?.substring(0, 10) === formData.exchange_date),
    [myShifts, formData.exchange_date]
  );
  const selectedPartnerShift = useMemo(
    () => partnerShifts?.find((shift: any) => shift.shift_date?.substring(0, 10) === formData.exchange_date),
    [partnerShifts, formData.exchange_date]
  );

  const filteredPartners = useMemo(() => {
    const currentEmployeeCode = currentUserProfile?.employee_id || (currentUserProfile as any)?.employee_code;
    const mergedEntries = [...(employeeDirectory || []), ...(users || [])];
    const dedupedEntries = new Map<string, any>();

    for (const entry of mergedEntries) {
      if (!entry) continue;

      const entryId = entry.id || "";
      const entryEmployeeCode = entry.employee_id || entry.employee_code || "";
      const dedupeKey = entryId || entryEmployeeCode;

      if (!dedupeKey) continue;
      if (entryId && entryId === user?.id) continue;
      if (currentEmployeeCode && entryEmployeeCode === currentEmployeeCode) continue;

      const existing = dedupedEntries.get(dedupeKey);
      if (!existing) {
        dedupedEntries.set(dedupeKey, entry);
        continue;
      }

      dedupedEntries.set(dedupeKey, {
        ...existing,
        ...entry,
        full_name: entry.full_name || existing.full_name,
        employee_id: entry.employee_id || existing.employee_id,
        employee_code: entry.employee_code || existing.employee_code,
        current_shift: entry.current_shift || existing.current_shift,
      });
    }

    return Array.from(dedupedEntries.values()).sort((left: any, right: any) => {
      const leftLabel = String(left.full_name || left.employee_id || left.employee_code || "");
      const rightLabel = String(right.full_name || right.employee_id || right.employee_code || "");
      return leftLabel.localeCompare(rightLabel);
    });
  }, [user?.id, users, employeeDirectory, currentUserProfile]);

  const partnerSuggestions = useMemo(() => {
    const normalizedQuery = partnerQuery.trim().toLowerCase();
    const baseList = filteredPartners;

    if (!normalizedQuery) {
      return baseList;
    }

    return baseList
      .filter((entry: any) => {
        const fullName = String(entry.full_name || "").toLowerCase();
        const employeeId = String(entry.employee_id || entry.employee_code || "").toLowerCase();
        return fullName.includes(normalizedQuery) || employeeId.includes(normalizedQuery);
      });
  }, [filteredPartners, partnerQuery]);

  const exchangeStats = useMemo(() => {
    const allExchanges = exchanges || [];
    const approved = allExchanges.filter((exchange: any) => exchange.status === "approved" || exchange.status === "completed").length;
    const rejected = allExchanges.filter((exchange: any) => exchange.status === "rejected" || exchange.status === "cancelled").length;
    const pending = allExchanges.length - approved - rejected;

    return {
      total: allExchanges.length,
      pending,
      approved,
      rejected,
    };
  }, [exchanges]);

  const recentExchange = exchanges?.[0];
  const pendingStatuses = ["pending_partner", "pending_wso", "pending_supervisor"];
  const pendingExchanges = (exchanges || []).filter((exchange: any) => pendingStatuses.includes(exchange.status));
  const historyExchanges = (exchanges || []).filter((exchange: any) => !pendingStatuses.includes(exchange.status));

  // Resolve names from exchange data with fallback to current user's profile (RLS may block other profiles for employees)
  const resolveExchangeNames = (exchange: any) => {
    const isRequester = exchange.requesting_user_id === user?.id;
    const requesterName = exchange.requesting_user?.full_name || (isRequester ? currentUserProfile?.full_name : null) || "Unknown";
    const partnerName = exchange.exchange_partner?.full_name || (!isRequester ? currentUserProfile?.full_name : null) || "Unknown";
    return { requesterName, partnerName };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) return;

    if (!myScheduleOnDate) {
      toast({ title: "No duty found", description: "You have no duty assigned on the selected date.", variant: "destructive" });
      return;
    }
    if (!partnerScheduleOnDate) {
      toast({ title: "No duty found", description: "Your partner has no duty assigned on the selected date.", variant: "destructive" });
      return;
    }
    if (!resolvedPartnerUserId) {
      toast({
        title: "Partner mapping missing",
        description: "Partner suggestions are visible, but partner profile mapping is not ready. Apply the employee directory SQL migration and try again.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Resolve or auto-create shift records (shifts table may not have entries for this date)
      const VALID_DUTY_TYPES = ["M", "A", "N", "NO", "CO", "OFF", "OPE"];

      const findOrCreateShift = async (userId: string, shiftDate: string, dutyCode: string, shiftType: string) => {
        // Check if shift already exists
        const { data: existing } = await supabase
          .from("shifts")
          .select("id")
          .eq("user_id", userId)
          .eq("shift_date", shiftDate)
          .maybeSingle();
        if (existing) return existing.id;

        // Create a shift record from schedule data
        const primaryDuty = dutyCode.split("+")[0].trim().toUpperCase();
        const dutyType = VALID_DUTY_TYPES.includes(primaryDuty) ? primaryDuty : "M";
        const normalizedShift = (shiftType || "general").toLowerCase();

        const { data: created, error } = await supabase
          .from("shifts")
          .insert({
            user_id: userId,
            shift_date: shiftDate,
            duty_type: dutyType as any,
            shift_type: normalizedShift as any,
          })
          .select("id")
          .single();
        if (error) throw new Error(`Could not create shift record: ${error.message}`);
        return created.id;
      };

      const myShiftId = await findOrCreateShift(
        user.id,
        formData.exchange_date,
        myScheduleOnDate.duty_code,
        currentUserProfile?.current_shift || "general"
      );
      const partnerShiftId = await findOrCreateShift(
        resolvedPartnerUserId,
        formData.exchange_date,
        partnerScheduleOnDate.duty_code,
        selectedPartner?.current_shift || "general"
      );

      await createExchange.mutateAsync({
        requester_id: user.id,
        partner_id: resolvedPartnerUserId,
        requester_shift_id: myShiftId,
        partner_shift_id: partnerShiftId,
        duty_date: formData.exchange_date,
        reason: formData.reason,
      });

      toast({
        title: "Exchange request submitted",
        description: "Your duty exchange request has been submitted for approval",
      });

      setFormData({
        exchange_date: "",
        partner_id: "",
        reason: "",
      });
      setPartnerQuery("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
      case "completed":
        return <CheckCircle className="h-4 w-4 text-emerald-600" />;
      case "rejected":
      case "cancelled":
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Clock className="h-4 w-4 text-amber-600" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const tone = getStatusTone(status);

    return (
      <Badge variant="outline" className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium", tone.badgeClass)}>
        {getStatusLabel(status)}
      </Badge>
    );
  };

  const handlePartnerAction = async (exchangeId: string, action: "approve" | "reject") => {
    if (!user) return;
    try {
      await processApproval.mutateAsync({
        request_id: exchangeId,
        approver_id: user.id,
        action,
      });
      toast({
        title: action === "approve" ? "Exchange accepted" : "Exchange declined",
        description: action === "approve"
          ? "Your acceptance has been recorded. The request now moves to WSO review."
          : "You have declined this exchange request.",
      });
      // Force immediate refetch so the UI reflects the new status without waiting for stale-time
      await refetchExchanges();
    } catch (error: any) {
      const msg = error?.message || "Something went wrong";
      // If approval steps are missing (legacy exchange), surface a clear message
      const isLegacy = msg.includes("No pending approval step");
      toast({
        title: isLegacy ? "Action unavailable" : "Error",
        description: isLegacy
          ? "This exchange request was created before the approval workflow was set up. Please ask your supervisor to re-create it, or apply the backfill migration."
          : msg,
        variant: "destructive",
      });
    }
  };

  const handlePartnerSelect = (partner: any) => {
    const resolvedPartnerId = partner.id || users?.find((entry: any) => {
      const entryEmployeeCode = entry.employee_id || entry.employee_code;
      const partnerEmployeeCode = partner.employee_id || partner.employee_code;
      return entryEmployeeCode && partnerEmployeeCode && entryEmployeeCode === partnerEmployeeCode;
    })?.id;

    setFormData((current) => ({
      ...current,
      partner_id: resolvedPartnerId || partner.employee_code || "",
    }));
    setPartnerQuery(formatPartnerLabel(partner));
    setShowPartnerSuggestions(false);

    if (!resolvedPartnerId) {
      toast({
        title: "Partner selected",
        description: "Suggestions are visible, but full partner mapping requires the employee directory SQL migration.",
      });
    }
  };

  if (exchangesLoading) {
    return (
      <DashboardLayout role="employee">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="employee">
      <div className="space-y-4 sm:space-y-6">
        <section className="rounded-[22px] border border-slate-200 bg-white shadow-sm sm:rounded-[30px] dark:border-slate-800 dark:bg-slate-950">
          <div className="space-y-4 p-3.5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                  <RefreshCcw className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600 dark:text-slate-300" />
                  <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">Duty Exchange</h1>
                </div>
                <p className="max-w-2xl text-xs leading-5 text-slate-600 sm:text-base sm:leading-6 dark:text-slate-300">
                  Submit a duty swap request, match it with a colleague, and track its approval status in a single place.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Latest Activity</p>
                <p className="mt-1.5 text-xs sm:text-sm font-semibold text-slate-950 dark:text-slate-50">
                  {recentExchange ? getStatusLabel(recentExchange.status) : "No requests yet"}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Total Requests" value={String(exchangeStats.total)} hint="All requests" />
              <MetricCard label="Pending" value={String(exchangeStats.pending)} hint="In approval flow" />
              <MetricCard label="Approved" value={String(exchangeStats.approved)} hint="Completed" />
              <MetricCard label="Rejected" value={String(exchangeStats.rejected)} hint="Rejected or cancelled" />
            </div>
          </div>
        </section>

        <Card className="overflow-hidden rounded-[22px] border-slate-200 shadow-sm sm:rounded-[30px] dark:border-slate-800 dark:bg-slate-950">
          <CardHeader className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6 sm:py-5 dark:border-slate-800 dark:bg-slate-900/50">
            <CardTitle className="flex items-center gap-2 text-base sm:text-xl text-slate-900 dark:text-slate-100">
              <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600 dark:text-slate-300" />
              Pending Requests
              <Badge variant="outline" className="ml-1 rounded-full px-2 py-0 text-[10px] sm:text-xs">{pendingExchanges.length}</Badge>
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">Requests currently moving through partner, WSO, or supervisor approval.</CardDescription>
          </CardHeader>
          <CardContent className="p-3.5 sm:p-5">
            {pendingExchanges.length ? (
              <div className="space-y-3 sm:space-y-4">
                {pendingExchanges.map((exchange: any) => {
                  const tone = getStatusTone(exchange.status);
                  const isPartner = exchange.exchange_partner_id === user?.id;
                  const awaitingPartner = exchange.status === "pending_partner" && isPartner;
                  const isExpanded = expandedExchangeId === exchange.id;
                  const { requesterName, partnerName } = resolveExchangeNames(exchange);

                  return (
                    <div key={exchange.id} className={cn("rounded-[18px] border p-3 sm:rounded-[22px] sm:p-5 dark:bg-slate-950", tone.cardClass)}>
                      <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1 space-y-2.5 sm:space-y-3">
                          <div className="flex flex-wrap items-center gap-2 text-slate-900 dark:text-slate-100">
                            <span className="text-sm sm:text-base font-semibold break-words">{requesterName}</span>
                            <ArrowLeftRight className="h-4 w-4 shrink-0" />
                            <span className="text-sm sm:text-base font-semibold break-words">{partnerName}</span>
                            {exchange.duty_date && (
                              <span className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                                — {format(new Date(exchange.duty_date), "dd MMM yyyy")}
                              </span>
                            )}
                          </div>

                          <div className="grid gap-2.5 md:grid-cols-2 sm:gap-3">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">{requesterName.split(" ")[0]}'s Duty</p>
                              <p className="mt-1.5 text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100">{formatDutyDisplay(exchange.requesting_shift, exchange.requesting_schedule, exchange.duty_date)}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">{partnerName.split(" ")[0]}'s Duty</p>
                              <p className="mt-1.5 text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100">{formatDutyDisplay(exchange.partner_shift, exchange.partner_schedule, exchange.duty_date)}</p>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">Reason</p>
                            <p className="mt-1.5 text-xs sm:text-sm leading-5 sm:leading-6 text-slate-700 dark:text-slate-300">{exchange.reason || "No reason provided"}</p>
                          </div>

                          {awaitingPartner && (
                            <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 sm:flex-row dark:border-amber-800/40 dark:bg-amber-950/20">
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Action Required</p>
                                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">You have been asked to exchange duties. Accept or decline below.</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="h-8 rounded-xl px-3 text-xs"
                                  disabled={processApproval.isPending}
                                  onClick={() => handlePartnerAction(exchange.id, "approve")}
                                >
                                  <Check className="mr-1 h-3.5 w-3.5" /> Accept
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-8 rounded-xl px-3 text-xs"
                                  disabled={processApproval.isPending}
                                  onClick={() => handlePartnerAction(exchange.id, "reject")}
                                >
                                  <XCircle className="mr-1 h-3.5 w-3.5" /> Decline
                                </Button>
                              </div>
                            </div>
                          )}

                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                            onClick={() => setExpandedExchangeId(isExpanded ? null : exchange.id)}
                          >
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {isExpanded ? "Hide" : "Show"} Approval Progress
                          </button>

                          {isExpanded && <ApprovalTimeline requestId={exchange.id} />}
                        </div>

                        <div className="flex flex-row items-center gap-2 lg:flex-col lg:items-end lg:text-right">
                          <div className={cn("inline-flex items-center gap-2", tone.iconClass)}>
                            {getStatusIcon(exchange.status)}
                            <span className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200">Status</span>
                          </div>
                          {getStatusBadge(exchange.status)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                <Clock className="mx-auto mb-3 h-8 w-8 opacity-50" />
                <p className="text-sm font-medium">No pending duty exchange requests</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
          <Card className="overflow-hidden rounded-[22px] border-slate-200 shadow-sm sm:rounded-[30px] dark:border-slate-800 dark:bg-slate-950">
            <CardHeader className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6 sm:py-5 dark:border-slate-800 dark:bg-slate-900/50">
              <CardTitle className="flex items-center gap-2 text-base sm:text-xl text-slate-900 dark:text-slate-100">
                <ArrowLeftRight className="h-4 w-4 sm:h-5 sm:w-5 text-sky-700 dark:text-sky-300" />
                Request Duty Exchange
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">Pair your duty with a colleague's matching slot and submit the request in one guided flow.</CardDescription>
            </CardHeader>
            <CardContent className="p-3.5 sm:p-5">
              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">Date of Exchange</Label>
                    <input
                      type="date"
                      value={formData.exchange_date}
                      onChange={(e) => setFormData({ ...formData, exchange_date: e.target.value })}
                      required
                      className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">Exchange Partner</Label>
                    <div className="relative">
                      <Input
                        value={partnerQuery}
                        onChange={(e) => {
                          const nextQuery = e.target.value;
                          setPartnerQuery(nextQuery);
                          setShowPartnerSuggestions(true);
                          setFormData((current) => ({ ...current, partner_id: "" }));
                        }}
                        onFocus={() => setShowPartnerSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowPartnerSuggestions(false), 150)}
                        placeholder="Type employee name or ID"
                        className="h-11 rounded-2xl border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950"
                      />

                      {showPartnerSuggestions && partnerSuggestions.length > 0 && (
                        <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-950">
                          {partnerSuggestions.map((entry: any) => (
                            <button
                              key={entry.id || entry.employee_code}
                              type="button"
                              onMouseDown={() => handlePartnerSelect(entry)}
                              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                            >
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{entry.full_name}</span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">{entry.employee_id || entry.employee_code}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3">
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                    <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Your Duty</p>
                    <p className="mt-1 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">{currentUserProfile?.full_name || "You"}</p>
                    <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                      {myScheduleOnDate
                        ? formatScheduleLabel(myScheduleOnDate)
                        : formData.exchange_date
                          ? "No duty assigned on this date"
                          : "Select a date first"}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                    <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Partner's Duty</p>
                    <p className="mt-1 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedPartner?.full_name || "No partner selected"}</p>
                    <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                      {partnerScheduleOnDate
                        ? formatScheduleLabel(partnerScheduleOnDate)
                        : formData.partner_id && formData.exchange_date
                          ? "No duty assigned on this date"
                          : "Select partner and date"}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">Reason for Exchange</Label>
                  <Textarea
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value.slice(0, 500) })}
                    placeholder="Add the operational or personal reason for this duty exchange request (min 10 characters)..."
                    required
                    minLength={10}
                    maxLength={500}
                    className="min-h-[92px] rounded-3xl border-slate-300 bg-white text-sm leading-6 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <p className={cn("text-xs", formData.reason.trim().length > 0 && formData.reason.trim().length < 10 ? "text-red-500" : "text-slate-400")}>
                    {formData.reason.trim().length}/500 characters (min 10)
                  </p>
                </div>

                <div className="flex justify-end border-t border-slate-200 pt-4 dark:border-slate-800">
                  <Button
                    type="submit"
                    disabled={createExchange.isPending || !myScheduleOnDate || !partnerScheduleOnDate || formData.reason.trim().length < 10}
                    className="h-11 rounded-2xl px-6 text-sm"
                  >
                    {createExchange.isPending ? "Submitting..." : "Submit Request"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-4 sm:space-y-5">
            <Card className="overflow-hidden rounded-[22px] border-slate-200 shadow-sm sm:rounded-[30px] dark:border-slate-800 dark:bg-slate-950">
              <CardHeader className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6 sm:py-5 dark:border-slate-800 dark:bg-slate-900/50">
                <CardTitle className="flex items-center gap-2 text-base sm:text-xl text-slate-900 dark:text-slate-100">
                  <ClipboardList className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600 dark:text-slate-300" />
                  Exchange Guidance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 p-3.5 sm:space-y-3 sm:p-5">
                <div className="rounded-[18px] border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">4-step approval</p>
                  <p className="mt-1.5 text-xs sm:text-sm leading-5 sm:leading-6 text-slate-600 dark:text-slate-300">Partner → Requester's WSO → Partner's WSO → Supervisor. Clear pairing and a direct reason help avoid delays.</p>
                </div>

                <div className="rounded-[18px] border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Partner selection</p>
                  <p className="mt-1.5 text-xs sm:text-sm leading-5 sm:leading-6 text-slate-600 dark:text-slate-300">Select the partner first so their available duties can be matched in the request form.</p>
                </div>

                <div className="rounded-[18px] border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Automatic swap</p>
                  <p className="mt-1.5 text-xs sm:text-sm leading-5 sm:leading-6 text-slate-600 dark:text-slate-300">After final supervisor approval, duties are automatically swapped in the schedule — no manual update needed.</p>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[22px] border-slate-200 shadow-sm sm:rounded-[30px] dark:border-slate-800 dark:bg-slate-950">
              <CardHeader className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6 sm:py-5 dark:border-slate-800 dark:bg-slate-900/50">
                <CardTitle className="flex items-center gap-2 text-base sm:text-xl text-slate-900 dark:text-slate-100">
                  <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600 dark:text-slate-300" />
                  Quick Snapshot
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 p-3.5 sm:space-y-3 sm:p-5">
                <div className="rounded-[18px] border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">Your chosen duty</p>
                  <p className="mt-1.5 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedMyShift ? formatShiftLabel(selectedMyShift) : "No duty selected yet"}</p>
                </div>
                <div className="rounded-[18px] border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">Partner match</p>
                  <p className="mt-1.5 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedPartnerShift ? formatShiftLabel(selectedPartnerShift) : "Partner duty not selected yet"}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="overflow-hidden rounded-[24px] border-slate-200 shadow-sm sm:rounded-[30px] dark:border-slate-800 dark:bg-slate-950">
          <CardHeader className="border-b border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/50">
            <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <ClipboardList className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              Request History
            </CardTitle>
            <CardDescription>Completed, rejected, and cancelled exchange records.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            {historyExchanges.length ? (
              <div className="space-y-4">
                {historyExchanges.map((exchange: any) => {
                  const tone = getStatusTone(exchange.status);
                  const isPartner = exchange.exchange_partner_id === user?.id;
                  const awaitingPartner = exchange.status === "pending_partner" && isPartner;
                  const isExpanded = expandedExchangeId === exchange.id;
                  const { requesterName, partnerName } = resolveExchangeNames(exchange);

                  return (
                    <div key={exchange.id} className={cn("rounded-[22px] border p-4 sm:p-5 dark:bg-slate-950", tone.cardClass)}>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-2 text-slate-900 dark:text-slate-100">
                            <span className="font-semibold break-words">{requesterName}</span>
                            <ArrowLeftRight className="h-4 w-4 shrink-0" />
                            <span className="font-semibold break-words">{partnerName}</span>
                            {exchange.duty_date && (
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                — {format(new Date(exchange.duty_date), "dd MMM yyyy")}
                              </span>
                            )}
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-[18px] border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">{requesterName.split(" ")[0]}'s Duty</p>
                              <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{formatDutyDisplay(exchange.requesting_shift, exchange.requesting_schedule, exchange.duty_date)}</p>
                            </div>
                            <div className="rounded-[18px] border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">{partnerName.split(" ")[0]}'s Duty</p>
                              <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{formatDutyDisplay(exchange.partner_shift, exchange.partner_schedule, exchange.duty_date)}</p>
                            </div>
                          </div>

                          <div className="rounded-[18px] border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">Reason</p>
                            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">{exchange.reason || "No reason provided"}</p>
                          </div>

                          {/* Partner action buttons */}
                          {awaitingPartner && (
                            <div className="flex gap-2 rounded-[18px] border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800/40 dark:bg-amber-950/20">
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Action Required</p>
                                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">You have been asked to exchange duties. Accept or decline below.</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="h-8 rounded-xl px-3 text-xs"
                                  disabled={processApproval.isPending}
                                  onClick={() => handlePartnerAction(exchange.id, "approve")}
                                >
                                  <Check className="mr-1 h-3.5 w-3.5" /> Accept
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-8 rounded-xl px-3 text-xs"
                                  disabled={processApproval.isPending}
                                  onClick={() => handlePartnerAction(exchange.id, "reject")}
                                >
                                  <XCircle className="mr-1 h-3.5 w-3.5" /> Decline
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Expandable approval timeline */}
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                            onClick={() => setExpandedExchangeId(isExpanded ? null : exchange.id)}
                          >
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {isExpanded ? "Hide" : "Show"} Approval Progress
                          </button>

                          {isExpanded && <ApprovalTimeline requestId={exchange.id} />}
                        </div>

                        <div className="flex flex-row items-center gap-2 lg:flex-col lg:items-end lg:text-right">
                          <div className={cn("inline-flex items-center gap-2", tone.iconClass)}>
                            {getStatusIcon(exchange.status)}
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Status</span>
                          </div>
                          {getStatusBadge(exchange.status)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                <ArrowLeftRight className="mx-auto mb-3 h-12 w-12 opacity-50" />
                <p className="text-sm font-medium">No duty exchange history found</p>
                <p className="mt-2 text-sm">Completed and rejected requests will appear here.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
