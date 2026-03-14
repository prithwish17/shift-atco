import { DashboardLayout } from "@/components/DashboardLayout";
import { Calendar, CalendarDays, FileText, Clock, Shield, Users, AlertTriangle, CheckCircle, XCircle, Award, Mail, Waves, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useLeaves, useLeaveBalances } from "@/hooks/useLeaves";
import { useLicenses } from "@/hooks/useLicenses";
import { useShifts } from "@/hooks/useShifts";
import { useMyRoster } from "@/hooks/useRosters";
import { useMySchedule, DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";
import { format, addDays, isSameDay, parse, parseISO, differenceInDays } from "date-fns";

const DOUBLE_DUTY_CODES = new Set(["M+A", "A+M"]);

const LICENSE_LABELS: Record<string, string> = {
  rdr: "Radar",
  app: "Approach",
  plr: "Precision",
  adc: "Aerodrome",
  alpha: "Alpha",
  occ: "Oceanic",
};

/** Color map for duty code badges */
function getDutyBadgeColor(code: string): string {
  const c = code?.toUpperCase() || "";
  if (c === "M" || c === "M+A" || c === "CO+M" || c === "SUN+M") return "bg-yellow-100 text-yellow-700";
  if (c === "A" || c === "A+M" || c === "CO+A" || c === "SUN+A") return "bg-orange-100 text-orange-700";
  if (c === "N" || c === "CO+N" || c === "SUN+N" || c === "SAT+N") return "bg-blue-100 text-blue-700";
  if (c === "NO" || c === "SAT+NO" || c === "SUN+NO") return "bg-indigo-100 text-indigo-700";
  if (c === "CO") return "bg-teal-100 text-teal-700";
  if (c === "LEAVE" || c === "SL") return "bg-red-100 text-red-700";
  if (c === "CH") return "bg-lime-100 text-lime-700";
  if (c === "NH") return "bg-green-100 text-green-700";
  if (c === "GO") return "bg-lime-100 text-lime-700";
  if (c === "G") return "bg-neutral-100 text-neutral-700";
  if (c === "NA") return "bg-gray-100 text-gray-700";
  if (c.startsWith("SAT")) return "bg-cyan-100 text-cyan-700";
  if (c.startsWith("SUN")) return "bg-purple-100 text-purple-700";
  if (c === "T" || c === "TR") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
}

/** Parse roster date strings like "17-Feb-2026" into Date objects */
function parseRosterDate(dateStr: string): Date | null {
  try {
    return parse(dateStr, "dd-MMM-yyyy", new Date());
  } catch {
    return null;
  }
}

function isDoubleDuty(code?: string): boolean {
  return DOUBLE_DUTY_CODES.has(code?.trim().toUpperCase() || "");
}

function getShiftName(code?: string, description?: string): string {
  const normalizedCode = code?.trim() || "";
  return description || DUTY_DESCRIPTIONS[normalizedCode] || normalizedCode || "—";
}

function getRosterDutyLabel(shift?: string): string {
  const normalizedShift = shift?.trim() || "";
  return normalizedShift ? `${normalizedShift} Shift` : "—";
}

function getRosterAssignmentLabel(shift?: string, unit?: string, position?: string): string {
  const shiftLabel = shift?.trim() || "—";
  const unitLabel = unit?.trim() || "—";
  const positionLabel = position?.trim() || "";
  const hidePosition = positionLabel.toUpperCase() === "EXTRA DUTY";
  const hideUnit = unitLabel.toUpperCase() === "SPECIAL";
  if (hideUnit || hidePosition) return "";
  const parts = [shiftLabel];

  if (!hideUnit) parts.push(unitLabel);
  if (!hidePosition && positionLabel) parts.push(positionLabel);

  return parts.join(" - ");
}

function shouldHideRosterEntry(unit?: string, position?: string): boolean {
  return unit?.trim().toUpperCase() === "SPECIAL" || position?.trim().toUpperCase() === "EXTRA DUTY";
}

function sortRosterEntriesByShift<T extends { shift: string }>(entries: T[]): T[] {
  const shiftOrder: Record<string, number> = {
    MORNING: 0,
    AFTERNOON: 1,
    EVENING: 1,
    NIGHT: 2,
  };

  return [...entries].sort((a, b) => {
    const left = shiftOrder[a.shift?.trim().toUpperCase()] ?? 99;
    const right = shiftOrder[b.shift?.trim().toUpperCase()] ?? 99;
    return left - right;
  });
}

export default function EmployeeDashboard() {
  const { user, userRole } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
  const { licenses, isLoading: licensesLoading } = useLicenses(user?.id);

  const today = format(new Date(), "yyyy-MM-dd");
  const weekEnd = format(addDays(new Date(), 6), "yyyy-MM-dd");

  const { data: leaves, isLoading: leavesLoading } = useLeaves(user?.id);
  const { data: balances, isLoading: balancesLoading } = useLeaveBalances(user?.id);
  const { shifts, isLoading: shiftsLoading } = useShifts(user?.id, today, weekEnd);
  const { data: myRoster, isLoading: rosterLoading } = useMyRoster(profile?.full_name);
  const { data: mySchedule = [], isLoading: scheduleLoading } = useMySchedule(
    profile?.employee_id,
    today,
    format(addDays(new Date(), 6), 'yyyy-MM-dd')
  );

  const currentYear = new Date().getFullYear();
  const yearBalances = balances?.filter(b => b.year === currentYear) || [];
  const clBalance = yearBalances.find(b => b.leave_type === "cl");
  const rhBalance = yearBalances.find(b => b.leave_type === "rh");
  const elBalance = yearBalances.find(b => b.leave_type === "el");
  const compOff = yearBalances.find(b => b.leave_type === "comp_off");

  // 2-day roster + schedule lookup
  const now = new Date();
  const tomorrow = addDays(now, 1);
  const tomorrowStr = format(tomorrow, "yyyy-MM-dd");

  const todayRosters = sortRosterEntriesByShift((myRoster || []).filter(r => {
    const d = parseRosterDate(r.date);
    return d && isSameDay(d, now);
  }));
  const tomorrowRosters = sortRosterEntriesByShift((myRoster || []).filter(r => {
    const d = parseRosterDate(r.date);
    return d && isSameDay(d, tomorrow);
  }));
  const visibleTodayRosters = todayRosters.filter((roster) => !shouldHideRosterEntry(roster.unit, roster.position));
  const visibleTomorrowRosters = tomorrowRosters.filter((roster) => !shouldHideRosterEntry(roster.unit, roster.position));
  const todayRoster = visibleTodayRosters[0];
  const tomorrowRoster = visibleTomorrowRosters[0];
  const todaySchedule = mySchedule.find(s => s.duty_date === today);
  const tomorrowSchedule = mySchedule.find(s => s.duty_date === tomorrowStr);

  const isLoading = profileLoading || leavesLoading || balancesLoading || shiftsLoading;

  const currentShift = profile?.current_shift ? `${profile.current_shift.toUpperCase()} Shift` : "—";

  return (
    <DashboardLayout role="employee">
      <div className="space-y-4 md:space-y-6">

        {/* ─── Duty Overview Card ─── */}
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 md:mb-6">
            <div className="flex items-center gap-3">
              <div className="size-8 md:size-10 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center">
                <Clock className="size-4 md:size-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-gray-100">Duty Overview</h2>
            </div>
            <span className="text-base md:text-lg font-bold text-blue-600 dark:text-blue-400">{currentShift}</span>
          </div>

          {/* Today + Tomorrow Sub-Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
            {/* Today — Purple */}
            <div className="bg-purple-100 dark:bg-purple-900/30 rounded-xl p-4 md:p-6">
              <div className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-1">TODAY</div>
              <div className="text-sm text-purple-700 dark:text-purple-300 mb-3 md:mb-4">{format(now, "EEE, dd MMM")}</div>
              {(rosterLoading || scheduleLoading) ? (
                <p className="text-sm text-purple-600 dark:text-purple-400">Loading…</p>
              ) : todaySchedule && isDoubleDuty(todaySchedule.duty_code) && visibleTodayRosters.length > 0 ? (
                <div className="space-y-1">
                  {visibleTodayRosters
                    .map((roster) => ({
                      key: `${roster.date}-${roster.shift}-${roster.position}-${roster.unit}`,
                      label: getRosterAssignmentLabel(roster.shift, roster.unit, roster.position),
                    }))
                    .filter((roster) => roster.label)
                    .map((roster) => (
                      <div key={roster.key} className="text-sm font-medium text-purple-800 dark:text-purple-200">
                        {roster.label}
                      </div>
                    ))}
                </div>
              ) : todayRoster ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-purple-800 dark:text-purple-200">
                    {getRosterDutyLabel(todayRoster.shift)}
                  </div>
                  <div className="text-sm font-medium text-purple-800 dark:text-purple-200">
                    {[
                      todayRoster.unit?.trim().toUpperCase() === "SPECIAL" ? null : `Unit ${todayRoster.unit}`,
                      todayRoster.position?.trim().toUpperCase() === "EXTRA DUTY" ? null : todayRoster.position,
                      `Team ${todayRoster.team}`,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ) : todaySchedule ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-purple-800 dark:text-purple-200">
                    {getShiftName(todaySchedule.duty_code, todaySchedule.duty_description)}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-purple-600 dark:text-purple-400">No assignment</p>
              )}
            </div>

            {/* Tomorrow — Blue */}
            <div className="bg-blue-100 dark:bg-blue-900/30 rounded-xl p-4 md:p-6">
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">TOMORROW</div>
              <div className="text-sm text-blue-700 dark:text-blue-300 mb-3 md:mb-4">{format(tomorrow, "EEE, dd MMM")}</div>
              {(rosterLoading || scheduleLoading) ? (
                <p className="text-sm text-blue-600 dark:text-blue-400">Loading…</p>
              ) : tomorrowSchedule && isDoubleDuty(tomorrowSchedule.duty_code) && visibleTomorrowRosters.length > 0 ? (
                <div className="space-y-1">
                  {visibleTomorrowRosters
                    .map((roster) => ({
                      key: `${roster.date}-${roster.shift}-${roster.position}-${roster.unit}`,
                      label: getRosterAssignmentLabel(roster.shift, roster.unit, roster.position),
                    }))
                    .filter((roster) => roster.label)
                    .map((roster) => (
                      <div key={roster.key} className="text-sm font-medium text-blue-800 dark:text-blue-200">
                        {roster.label}
                      </div>
                    ))}
                </div>
              ) : tomorrowRoster ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    {getRosterDutyLabel(tomorrowRoster.shift)}
                  </div>
                  <div className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    {[
                      tomorrowRoster.unit?.trim().toUpperCase() === "SPECIAL" ? null : `Unit ${tomorrowRoster.unit}`,
                      tomorrowRoster.position?.trim().toUpperCase() === "EXTRA DUTY" ? null : tomorrowRoster.position,
                      `Team ${tomorrowRoster.team}`,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ) : tomorrowSchedule ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    {getShiftName(tomorrowSchedule.duty_code, tomorrowSchedule.duty_description)}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-blue-600 dark:text-blue-400">No assignment</p>
              )}
            </div>
          </div>

          {/* Balance Stat Cards — nested inside Duty Overview */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <Link
              to="/employee/leave-dashboard"
              className="block rounded-xl transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 md:p-4 h-full">
              <div className="flex items-center justify-between mb-2 md:mb-3">
                <div>
                  <span className="text-xs md:text-sm font-semibold text-gray-900 dark:text-gray-100">Leave Overview</span>
                  <div className="mt-0.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Apply for leave and leave summary</div>
                </div>
                <div className="size-6 md:size-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center">
                  <FileText className="size-3 md:size-4 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <div className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{clBalance ? clBalance.balance : ""}</div>
            </div>
            </Link>

            <Link
              to="/employee/duty-exchange"
              className="block rounded-xl transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 md:p-4 h-full">
              <div className="flex items-center justify-between mb-2 md:mb-3">
                <div>
                  <span className="text-xs md:text-sm font-semibold text-gray-900 dark:text-gray-100">Duty Exchange</span>
                  <div className="mt-0.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Request and track exchange status</div>
                </div>
                <div className="size-6 md:size-8 bg-purple-100 dark:bg-purple-900/40 rounded-lg flex items-center justify-center">
                  <FileText className="size-3 md:size-4 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
              <div className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{rhBalance ? rhBalance.balance : ""}</div>
            </div>
            </Link>

            <Link
              to="/employee/licenses"
              className="block rounded-xl transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 md:p-4 h-full">
              <div className="flex items-center justify-between mb-2 md:mb-3">
                <div>
                  <span className="text-xs md:text-sm font-semibold text-gray-900 dark:text-gray-100">License Status</span>
                  <div className="mt-0.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-400">View validity and renewal details</div>
                </div>
                <div className="size-6 md:size-8 bg-green-100 dark:bg-green-900/40 rounded-lg flex items-center justify-center">
                  <FileText className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <div className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{elBalance ? elBalance.balance : ""}</div>
            </div>
            </Link>

            <Link
              to="/employee/comp-off"
              className="block rounded-xl transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 md:p-4 h-full">
              <div className="flex items-center justify-between mb-2 md:mb-3">
                <div>
                  <span className="text-xs md:text-sm font-semibold text-gray-900 dark:text-gray-100">Comp Off</span>
                  <div className="mt-0.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-400">Check balance and expiry status</div>
                </div>
                <div className="size-6 md:size-8 bg-orange-100 dark:bg-orange-900/40 rounded-lg flex items-center justify-center">
                  <Clock className="size-3 md:size-4 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
              <div className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{compOff ? compOff.balance : ""}</div>
            </div>
            </Link>
          </div>
        </div>

        {/* ─── Bottom Two-Column Grid ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">

          {/* ─── Upcoming Schedule ─── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="size-8 md:size-10 bg-purple-100 dark:bg-purple-900/40 rounded-full flex items-center justify-center">
                  <Calendar className="size-4 md:size-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm md:text-base">Upcoming Schedule</h3>
                </div>
              </div>
              <Link to="/employee/schedule" title="View Duty Schedule">
                <div className="size-8 md:size-10 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors cursor-pointer">
                  <CalendarDays className="size-4 md:size-5 text-blue-600 dark:text-blue-400" />
                </div>
              </Link>
            </div>

            <div className="space-y-2 md:space-y-3">
              {mySchedule.length > 0 ? mySchedule.map((duty, idx) => (
                <div key={duty.id} className={`flex items-start justify-between gap-3 py-2 md:py-3 ${idx < mySchedule.length - 1 ? 'border-b border-gray-100 dark:border-gray-800' : ''}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{format(parseISO(duty.duty_date), "MMM d, EEE")}</div>
                    <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 break-words whitespace-normal leading-snug">
                      {duty.duty_description || DUTY_DESCRIPTIONS[duty.duty_code] || duty.duty_code}
                    </div>
                  </div>
                  <span className={`shrink-0 w-16 px-2 md:px-3 py-1 text-xs font-medium rounded text-center ${getDutyBadgeColor(duty.duty_code)}`}>
                    {duty.duty_code}
                  </span>
                </div>
              )) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No schedule data yet. Fetch from Settings.</p>
              )}
            </div>
          </div>

          {/* ─── Profile & Ratings ─── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="size-8 md:size-10 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center">
                <Users className="size-4 md:size-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm md:text-base">Profile & Ratings</h3>
                <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">Your profile snapshot and license validity</p>
              </div>
            </div>

            {/* Profile rows with icons */}
            <div className="space-y-3 md:space-y-4 mb-4 md:mb-6">
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                  <Award className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                  <span>Designation</span>
                </div>
                <span className="text-xs md:text-sm font-medium text-gray-900 dark:text-gray-100">{profile?.designation || '—'}</span>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                  <Mail className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                  <span>Email</span>
                </div>
                <span className="text-xs md:text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[180px]">{profile?.email || '—'}</span>
              </div>

              {profile?.stream && (
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                    <Waves className="size-3 md:size-4 text-green-600 dark:text-green-400" />
                    <span>Stream</span>
                  </div>
                  <span className="text-xs md:text-sm font-medium text-gray-900 dark:text-gray-100">{profile.stream.toUpperCase()}</span>
                </div>
              )}
            </div>

            {/* Licenses & Ratings */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="text-xs md:text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">LICENSES & RATINGS</div>

              {licenses && licenses.length > 0 ? (
                <div className="space-y-2">
                  {licenses.map((lic) => {
                    const nowDate = new Date();
                    const expiry = lic.expiry_date ? new Date(lic.expiry_date) : null;
                    const daysLeft = expiry ? differenceInDays(expiry, nowDate) : null;
                    let statusColor = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
                    let StatusIcon = CheckCircle;
                    let statusLabel = 'Valid';
                    if (daysLeft !== null && daysLeft < 0) {
                      statusColor = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
                      StatusIcon = XCircle;
                      statusLabel = 'Expired';
                    } else if (daysLeft !== null && daysLeft <= 30) {
                      statusColor = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
                      StatusIcon = AlertTriangle;
                      statusLabel = `${daysLeft}d left`;
                    }
                    return (
                      <div key={lic.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Shield className="size-4 text-green-600 dark:text-green-400" />
                          <div>
                            <p className="font-medium text-sm text-gray-900 dark:text-gray-100">{LICENSE_LABELS[lic.license_type] || lic.license_type.toUpperCase()}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {expiry ? `Expires ${format(expiry, 'dd MMM yyyy')}` : 'No expiry'}
                            </p>
                          </div>
                        </div>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}>
                          <StatusIcon className="size-3" />
                          {statusLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 md:p-6 text-center border border-green-200 dark:border-green-800">
                  <div className="size-10 md:size-12 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-3 border border-green-300 dark:border-green-700">
                    <Eye className="size-5 md:size-6 text-green-600 dark:text-green-400" />
                  </div>
                  <p className="text-xs md:text-sm text-gray-700 dark:text-gray-300 mb-4">No licenses found</p>
                  <Link to="/employee/profile">
                    <button className="px-4 py-2 bg-green-600 text-white text-xs md:text-sm font-medium rounded-lg hover:bg-green-700 transition-colors">
                      View Full Profile
                    </button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
