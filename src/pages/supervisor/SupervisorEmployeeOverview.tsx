import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Hash,
  Mail,
  MapPin,
  Phone,
  Shield,
  UserRound,
  Waves,
} from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useEmployeeSchedules, DUTY_DESCRIPTIONS, type EmployeeSchedule } from "@/hooks/useEmployeeSchedules";
import { useLeaveBalances } from "@/hooks/useLeaves";
import { useEmployeeProfileByCode } from "@/hooks/useUsers";
import { buildEmployeeLicenseHealth, getHealthStatusLabel, type LicenseWithExtras } from "@/hooks/useLicenseDashboard";
import { type LeaveRequest } from "@/hooks/useLeaveRequests";
import { getLeaveTypeLabel } from "@/lib/leaveConstants";

type LeaveBalanceRow = {
  id: string;
  leave_type: string;
  balance: number;
  expiry_date: string | null;
  year: number;
};

type ScheduleLeaveRow = {
  id: string;
  duty_date: string;
  duty_code: string;
  duty_description: string | null;
};

function formatDisplayDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "dd MMM yyyy");
}

function formatScheduleDate(value: string) {
  return format(parseISO(value), "EEE, dd MMM");
}

function extractLeaveTypeFromDescription(value?: string | null) {
  if (!value) return null;
  const match = value.match(/\(([^)]+)\)/);
  return match?.[1]?.trim() || null;
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-900/60 sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-3">
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 sm:gap-2 sm:text-xs md:text-sm">
        <Icon className="h-3 w-3 sm:h-4 sm:w-4" />
        <span>{label}</span>
      </div>
      <span className="text-right text-[11px] font-medium text-slate-950 dark:text-white sm:text-xs md:text-sm">{value || "—"}</span>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[18px] border border-slate-200/80 bg-white/90 p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 sm:rounded-[22px] sm:p-4">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.18em]">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:mt-3 sm:text-3xl">{value}</p>
      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 sm:mt-1 sm:text-sm">{detail}</p>
    </div>
  );
}

export default function SupervisorEmployeeOverview() {
  const params = useParams();
  const employeeCode = decodeURIComponent(params.employeeCode || "").trim().toUpperCase();
  const today = format(new Date(), "yyyy-MM-dd");
  const scheduleEnd = format(addDays(new Date(), 9), "yyyy-MM-dd");

  const { profile, isLoading: profileLoading } = useEmployeeProfileByCode(employeeCode);
  const { data: leaveBalancesRaw = [], isLoading: balancesLoading } = useLeaveBalances(profile?.id);
  const { data: upcomingSchedule = [], isLoading: scheduleLoading } = useEmployeeSchedules(profile?.employee_id, today, scheduleEnd);

  const { data: leaveRequests = [], isLoading: leaveRequestsLoading } = useQuery({
    queryKey: ["supervisor-employee-overview", "leave-requests", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await supabase
        .from("leave_requests" as any)
        .select("*")
        .eq("employee_id", profile.id)
        .order("applied_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as LeaveRequest[];
    },
    enabled: !!profile?.id,
  });

  const { data: leaveMarkedSchedule = [], isLoading: leaveMarkedLoading } = useQuery({
    queryKey: ["supervisor-employee-overview", "leave-marked-schedule", profile?.employee_id],
    queryFn: async () => {
      if (!profile?.employee_id) return [];
      const { data, error } = await supabase
        .from("employee_schedules" as any)
        .select("id, duty_date, duty_code, duty_description")
        .eq("employee_code", profile.employee_id)
        .eq("duty_code", "LEAVE")
        .order("duty_date", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data || []) as ScheduleLeaveRow[];
    },
    enabled: !!profile?.employee_id,
  });

  const isLoading = profileLoading || balancesLoading || scheduleLoading || leaveRequestsLoading || leaveMarkedLoading;

  const licenseHealth = useMemo(
    () => buildEmployeeLicenseHealth(profile, ((profile?.licenses || []) as LicenseWithExtras[])),
    [profile],
  );

  const leaveBalances = useMemo(() => {
    const rows = (leaveBalancesRaw || []) as LeaveBalanceRow[];
    return rows
      .sort((left, right) => right.year - left.year || left.leave_type.localeCompare(right.leave_type));
  }, [leaveBalancesRaw]);

  const leaveSummary = useMemo(() => ({
    approved: leaveRequests.filter((request) => request.status === "Approved").length,
    pending: leaveRequests.filter((request) => request.status === "Pending WSO" || request.status === "Pending Supervisor").length,
    rejected: leaveRequests.filter((request) => request.status === "Rejected").length,
  }), [leaveRequests]);

  const scheduledLeaveEntries = useMemo(() => {
    return leaveMarkedSchedule.map((row) => {
      const matchingRequest = leaveRequests.find((request) => (
        request.status !== "Rejected" &&
        request.status !== "Cancelled" &&
        request.start_date <= row.duty_date &&
        request.end_date >= row.duty_date
      ));

      const derivedType = matchingRequest?.leave_type || extractLeaveTypeFromDescription(row.duty_description);

      return {
        ...row,
        leaveType: derivedType,
        requestStatus: matchingRequest?.status || null,
      };
    });
  }, [leaveMarkedSchedule, leaveRequests]);

  const profileDetails = (profile?.profile_details || {}) as Record<string, string | null | undefined>;
  const todaySchedule = upcomingSchedule.find((entry) => entry.duty_date === today);
  const dutyDaysAhead = upcomingSchedule.filter((entry) => !["NO", "CO", "SAT", "SUN", "NH", "CH", "NA"].includes(String(entry.duty_code || "").toUpperCase())).length;

  if (isLoading) {
    return (
      <DashboardLayout role="supervisor">
        <div className="flex h-64 items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!profile) {
    return (
      <DashboardLayout role="supervisor">
        <div className="space-y-6">
          <Link to="/supervisor" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <Card className="rounded-[28px] border-slate-200/80 dark:border-slate-800">
            <CardContent className="px-6 py-16 text-center">
              <p className="text-lg font-semibold text-slate-950 dark:text-white">Employee not found</p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                No employee profile matched code {employeeCode || "—"}.
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const displayName = profile.full_name || "Unknown";
  const initials = displayName.split(" ").map((part: string) => part[0]).join("").slice(0, 2).toUpperCase();

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-4 sm:space-y-6 lg:space-y-8">
        <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_26%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_24%),linear-gradient(135deg,#ffffff_0%,#f8fbff_42%,#f8fafc_100%)] p-4 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.42)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_22%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_20%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.96)_48%,rgba(3,7,18,0.98)_100%)] sm:rounded-[30px] sm:p-6">
          <div className="flex flex-col gap-4 sm:gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-4 sm:space-y-5">
              <Link to="/supervisor" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white sm:gap-2 sm:text-sm">
                <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Back to dashboard
              </Link>

              <div className="flex items-start gap-3 sm:gap-4">
                <Avatar className="h-10 w-10 rounded-2xl border border-white/70 shadow-sm dark:border-white/10 sm:h-12 sm:w-12 sm:rounded-3xl md:h-16 md:w-16">
                  <AvatarImage src={profile.photo_url || undefined} alt={displayName} />
                  <AvatarFallback className="rounded-2xl bg-slate-950 text-xs font-semibold text-white dark:bg-white dark:text-slate-950 sm:rounded-3xl sm:text-sm md:text-lg">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-2xl md:text-3xl">{displayName}</h1>
                    <Badge className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] text-white dark:bg-white dark:text-slate-950 sm:px-3 sm:py-1 sm:text-xs md:text-sm">{profile.employee_id}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 sm:mt-2 sm:text-xs md:text-sm">
                    {profile.designation || "Designation not recorded"} · {profile.current_shift ? `${String(profile.current_shift).toUpperCase()} shift` : "No shift assigned"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1 sm:mt-3 sm:gap-2">
                    {profile.station ? <Badge variant="outline" className="rounded-full px-2 py-0.5 text-xs sm:px-3 sm:py-1 sm:text-sm">{profile.station}</Badge> : null}
                    {profile.stream ? <Badge variant="outline" className="rounded-full px-2 py-0.5 text-xs sm:px-3 sm:py-1 sm:text-sm">{String(profile.stream).toUpperCase()}</Badge> : null}
                    {profile.role ? <Badge variant="outline" className="rounded-full px-2 py-0.5 text-xs capitalize sm:px-3 sm:py-1 sm:text-sm">{profile.role}</Badge> : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[520px]">
              <SummaryMetric
                label="Current Shift"
                value={profile.current_shift ? String(profile.current_shift).toUpperCase() : "—"}
                detail={todaySchedule ? `${todaySchedule.duty_code} today` : "No schedule row for today"}
              />
              <SummaryMetric
                label="Leave Requests"
                value={String(leaveRequests.length)}
                detail={`${leaveSummary.pending} pending · ${leaveSummary.approved} approved`}
              />
              <SummaryMetric
                label="License Status"
                value={licenseHealth.overallLabel}
                detail={licenseHealth.summary}
              />
              <SummaryMetric
                label="Today's Duty Marked"
                value={todaySchedule?.duty_code || "—"}
                detail={todaySchedule?.duty_description || DUTY_DESCRIPTIONS[todaySchedule?.duty_code || ""] || "No duty marked for today"}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:gap-4 xl:grid-cols-2">
          <Card className="rounded-[28px] border-slate-200/80 dark:border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <UserRound className="h-4 w-4 text-sky-600 dark:text-sky-300 sm:h-5 sm:w-5" />
                Profile Details
              </CardTitle>
              <CardDescription>Core identity, contacts, and personnel context.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <InfoRow icon={Hash} label="Employee ID" value={profile.employee_id || "—"} />
              <InfoRow icon={Mail} label="Email" value={profile.email || "—"} />
              <InfoRow icon={Phone} label="Mobile" value={profile.mobile || "—"} />
              <InfoRow icon={Phone} label="Emergency Contact" value={profile.emergency_contact || "—"} />
              <InfoRow icon={MapPin} label="Station" value={profile.station || "—"} />
              <InfoRow icon={Waves} label="Stream" value={profile.stream ? String(profile.stream).toUpperCase() : "—"} />
              <InfoRow icon={CalendarDays} label="Date of Joining" value={formatDisplayDate(profile.date_of_joining)} />
              <InfoRow icon={CalendarDays} label="Date of Birth" value={formatDisplayDate(profile.date_of_birth)} />
              <InfoRow icon={FileText} label="Department" value={profile.department || "—"} />
              <InfoRow icon={FileText} label="Security Clearance" value={String(profileDetails.security_clearance_status || "—")} />
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-slate-200/80 dark:border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <FileText className="h-4 w-4 text-amber-600 dark:text-amber-300 sm:h-5 sm:w-5" />
                Leave Details
              </CardTitle>
              <CardDescription>Balances and most recent leave workflow activity.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px]">Pending</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white sm:mt-2 sm:text-2xl">{leaveSummary.pending}</p>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px]">Approved</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white sm:mt-2 sm:text-2xl">{leaveSummary.approved}</p>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px]">Rejected</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white sm:mt-2 sm:text-2xl">{leaveSummary.rejected}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">Leave Balances</p>
                <div className="mt-3 grid gap-2 sm:gap-3 sm:grid-cols-2">
                  {leaveBalances.length > 0 ? (
                    leaveBalances.map((balance) => (
                      <div key={balance.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold text-slate-950 dark:text-white sm:text-sm">{balance.leave_type.toUpperCase()}</p>
                          <Badge variant="outline" className="rounded-full px-1.5 py-0.5 text-xs sm:px-2 sm:py-1 sm:text-sm">{balance.year}</Badge>
                        </div>
                        <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white sm:mt-2 sm:text-2xl">{balance.balance}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Expiry: {formatDisplayDate(balance.expiry_date)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400 sm:col-span-2">
                      No leave balances are stored for this employee yet.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">Leave Marked in Schedule</p>
                <div className="mt-3 space-y-2 sm:space-y-3">
                  {scheduledLeaveEntries.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-slate-950 dark:text-white sm:text-sm">{formatDisplayDate(entry.duty_date)}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {entry.leaveType ? getLeaveTypeLabel(entry.leaveType) : "Leave type not captured"}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:mt-2">
                            {entry.duty_description || "Leave marked from schedule"}
                          </p>
                        </div>
                        {entry.requestStatus ? (
                          <Badge variant="outline" className="rounded-full px-1.5 py-0.5 text-xs sm:px-2 sm:py-1 sm:text-sm">{entry.requestStatus}</Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-full px-1.5 py-0.5 text-xs sm:px-2 sm:py-1 sm:text-sm">Schedule only</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                  {scheduledLeaveEntries.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                      No leave-marked schedule dates were found for this employee.
                    </div>
                  ) : null}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-950 dark:text-white">Leave Requests</p>
                  {leaveRequests.length > 0 && (
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                      {leaveRequests.length}{leaveRequests.length === 100 ? "+" : ""} total
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-2 sm:space-y-3">
                  {leaveRequests.slice(0, 10).map((request) => (
                    <div key={request.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-slate-950 dark:text-white sm:text-sm">{getLeaveTypeLabel(request.leave_type)}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {formatDisplayDate(request.start_date)} to {formatDisplayDate(request.end_date)}
                          </p>
                        </div>
                        <Badge variant="outline" className="rounded-full px-1.5 py-0.5 text-xs sm:px-2 sm:py-1 sm:text-sm">{request.status}</Badge>
                      </div>
                    </div>
                  ))}
                  {leaveRequests.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                      No leave requests are available for this employee.
                    </div>
                  ) : null}
                  {leaveRequests.length > 10 ? (
                    <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
                      Showing 10 of {leaveRequests.length}{leaveRequests.length === 100 ? "+" : ""} requests
                    </p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-3 sm:gap-4 xl:grid-cols-[1.08fr_0.92fr]">
          <Card className="rounded-[28px] border-slate-200/80 dark:border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-300 sm:h-5 sm:w-5" />
                License Details
              </CardTitle>
              <CardDescription>Operational validity, ratings, medical, and ELPA signals in one view.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <SummaryMetric label="Overall" value={licenseHealth.overallLabel} detail={licenseHealth.overallStatus.toUpperCase()} />
                <SummaryMetric label="Active Ratings" value={String(licenseHealth.activeRatingsCount)} detail="Operationally active ratings" />
                <SummaryMetric label="Expired Items" value={String(licenseHealth.expiredCount)} detail="Credentials already overdue" />
                <SummaryMetric label="Due Soon" value={String(licenseHealth.warningCount)} detail="Credentials approaching renewal" />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <InfoRow icon={Hash} label="License Number" value={licenseHealth.licenseNumber || "—"} />
                <InfoRow icon={Shield} label="Highest Rating" value={licenseHealth.highestRating || "—"} />
                <InfoRow icon={Clock3} label="Next Review" value={licenseHealth.nextExpiry?.expiryDate ? formatDisplayDate(licenseHealth.nextExpiry.expiryDate) : "—"} />
                <InfoRow icon={CheckCircle2} label="ELPA" value={String((profile.linked_training_record as Record<string, string | null> | null)?.elpa_level || profileDetails.icao_english_proficiency_level || "—")} />
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">Active Ratings</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2 sm:gap-3">
                  {licenseHealth.ratings.filter((rating) => rating.isActive).slice(0, 4).map((rating) => (
                    <div key={rating.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-slate-950 dark:text-white sm:text-sm">{rating.label}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{rating.subtitle}</p>
                        </div>
                        <Badge variant="outline" className="rounded-full px-1.5 py-0.5 text-xs sm:px-2 sm:py-1 sm:text-sm">{getHealthStatusLabel(rating)}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 sm:mt-3">
                        {rating.exemptByAccS
                          ? 'Validity covered by active ACC(S) rating'
                          : `Proficiency valid upto ${formatDisplayDate(rating.expiryDate)}`}
                      </p>
                    </div>
                  ))}
                  {licenseHealth.ratings.filter((rating) => rating.isActive).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400 md:col-span-2">
                      No active operational ratings are linked to this employee.
                    </div>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-slate-200/80 dark:border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <Clock3 className="h-4 w-4 text-violet-600 dark:text-violet-300 sm:h-5 sm:w-5" />
                Team Details
              </CardTitle>
              <CardDescription>Current shift identity and immediate schedule context.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow icon={Waves} label="Current Shift" value={profile.current_shift ? String(profile.current_shift).toUpperCase() : "—"} />
              <InfoRow icon={CalendarDays} label="Today" value={todaySchedule ? `${todaySchedule.duty_code} · ${todaySchedule.duty_description || DUTY_DESCRIPTIONS[todaySchedule.duty_code] || "Scheduled"}` : "No schedule row"} />
              <InfoRow icon={CheckCircle2} label="Duty Days Ahead" value={String(dutyDaysAhead)} />
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="rounded-[28px] border-slate-200/80 dark:border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <CalendarDays className="h-4 w-4 text-sky-600 dark:text-sky-300 sm:h-5 sm:w-5" />
                Next 10 Days Schedule
              </CardTitle>
              <CardDescription>Forward-looking duty plan for supervisor review and staffing awareness.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-5 sm:gap-3">
                {upcomingSchedule.map((entry: EmployeeSchedule) => (
                  <div key={`${entry.id}-${entry.duty_date}`} className="rounded-[22px] border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:text-[11px]">{formatScheduleDate(entry.duty_date)}</p>
                    <p className="mt-2 text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:mt-3 sm:text-2xl">{entry.duty_code}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400 sm:mt-2 sm:text-sm sm:leading-6">
                      {entry.duty_description || DUTY_DESCRIPTIONS[entry.duty_code] || "Scheduled duty"}
                    </p>
                  </div>
                ))}
                {upcomingSchedule.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-5 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400 xl:col-span-5">
                    No schedule rows were found for the next 10 days.
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}
