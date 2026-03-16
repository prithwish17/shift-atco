import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Users, CalendarDays, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Clock,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths,
  parseISO, isToday, getMonth,
} from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useLeaveData } from "@/hooks/useLeaveData";
import {
  useAllLeaveRequests, useReviewLeaveRequest,
} from "@/hooks/useLeaveRequests";
import type { LeaveRequest } from "@/hooks/useLeaveRequests";
import { getLeaveTypeLabel, getLeaveStatusInfo } from "@/lib/leaveConstants";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { cn } from "@/lib/utils";

const CURRENT_YEAR = new Date().getFullYear();
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ── SVG Donut Ring ── */
function DonutRing({
  value, max, color, label, sublabel,
}: { value: number; max: number; color: string; label: string; sublabel: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const r = 38;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-3 py-2.5 sm:px-4 sm:py-3 min-w-[150px] shadow-sm">
      <div className="relative shrink-0" style={{ width: 52, height: 52 }}>
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth="8" />
          <circle
            cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900 dark:text-gray-100">
          {value}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">{sublabel}</p>
        <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 sm:text-sm truncate">{label}</p>
      </div>
    </div>
  );
}

export default function SupervisorLeaveDashboard() {
  const { user, userRole } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const dashboardRole = userRole === "wso" ? "wso" : "supervisor";
  const isWSO = userRole === "wso";

  /* leave data for availability stats */
  const { data: leaveRecords, leaveQuery } = useLeaveData(CURRENT_YEAR);

  /* leave requests for approval table */
  const { data: allRequests = [], isLoading: requestsLoading } = useAllLeaveRequests();
  const reviewMutation = useReviewLeaveRequest();

  const pendingRequests = useMemo(
    () => allRequests.filter(r => r.status === "Pending WSO" || r.status === "Pending Supervisor"),
    [allRequests],
  );

  /* review dialog state */
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<LeaveRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");
  const [reviewRemarks, setReviewRemarks] = useState("");

  const openReview = (req: LeaveRequest, action: "approve" | "reject") => {
    setReviewTarget(req);
    setReviewAction(action);
    setReviewRemarks("");
    setReviewDialogOpen(true);
  };

  const handleReview = async () => {
    if (!reviewTarget || !user) return;
    const isDirectApproval = !isWSO && reviewAction === "approve" && reviewTarget.status === "Pending WSO";
    try {
      await reviewMutation.mutateAsync({
        id: reviewTarget.id,
        action: reviewAction,
        actor_role: isWSO ? "wso" : "supervisor",
        actor_id: user.id,
        remarks: reviewRemarks || undefined,
        direct_approval: isDirectApproval,
      });
      toast.success(reviewAction === "approve" ? "Leave approved" : "Leave rejected");
      setReviewDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed");
    }
  };

  /* ── Leaves Taken aggregates ── */
  const leavesTaken = useMemo(() => {
    let cl = 0, rh = 0, co = 0, el = 0, others = 0;
    for (const req of allRequests) {
      if (req.status !== "Approved") continue;
      const startYear = parseISO(req.start_date).getFullYear();
      if (startYear !== CURRENT_YEAR) continue;

      if (req.leave_type.startsWith("CL")) cl += req.total_days;
      else if (req.leave_type === "RH") rh += req.total_days;
      else if (req.leave_type === "COMP_OFF") co += req.total_days;
      else if (req.leave_type === "EL" || req.leave_type === "NEE") el += req.total_days;
      else others += req.total_days;
    }
    const total = cl + rh + co + el + others;
    return {
      cl, rh, co, el, others, total: total > 0 ? total : 1
    };
  }, [allRequests]);

  /* ── Team Leave Track (monthly chart) ── */
  const chartData = useMemo(() => {
    const counts = new Array(12).fill(0);
    for (const req of allRequests) {
      if (req.status !== "Approved") continue;
      const m = getMonth(parseISO(req.start_date));
      counts[m] += req.total_days;
    }
    return MONTHS_SHORT.map((name, i) => ({ name, leaves: counts[i] }));
  }, [allRequests]);

  /* ── Leave Calendar ── */
  const [calMonth, setCalMonth] = useState(new Date());
  const calDays = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(calMonth), end: endOfMonth(calMonth) }),
    [calMonth],
  );

  const calLeaveMap = useMemo(() => {
    const map = new Map<string, { type: string; color: string }[]>();
    for (const req of allRequests) {
      if (req.status !== "Approved") continue;
      const start = parseISO(req.start_date);
      const end = parseISO(req.end_date);
      const days = eachDayOfInterval({ start, end });
      const color =
        req.leave_type === "CL" || req.leave_type === "CL_1ST" || req.leave_type === "CL_2ND"
          ? "bg-amber-400"
          : req.leave_type === "EL" || req.leave_type === "NEE"
            ? "bg-blue-500"
            : req.leave_type === "COMP_OFF"
              ? "bg-teal-400"
              : req.leave_type === "RH"
                ? "bg-purple-400"
                : "bg-pink-400";
      for (const d of days) {
        const key = format(d, "yyyy-MM-dd");
        const arr = map.get(key) || [];
        arr.push({ type: req.leave_type, color });
        map.set(key, arr);
      }
    }
    return map;
  }, [allRequests, calMonth]);

  const isLoading = leaveQuery.isLoading || requestsLoading;

  return (
    <DashboardLayout role={dashboardRole}>
      <div className="space-y-5">
        {/* ── Header ── */}
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-blue-600" />
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Leave Management</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">Dashboard</p>
          </div>
        </div>

        {/* ── Leaves Taken ── */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 sm:text-base">Leaves Taken ({CURRENT_YEAR})</h2>
          {isLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-[150px] shrink-0" />)}</div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
              <DonutRing value={leavesTaken.cl} max={leavesTaken.total} color="#34d399" label="Casual Leave" sublabel="Taken" />
              <DonutRing value={leavesTaken.rh} max={leavesTaken.total} color="#a855f7" label="Restricted" sublabel="Taken" />
              <DonutRing value={leavesTaken.co} max={leavesTaken.total} color="#f87171" label="Comp Off" sublabel="Taken" />
              <DonutRing value={leavesTaken.el} max={leavesTaken.total} color="#60a5fa" label="Earned Leave" sublabel="Taken" />
              <DonutRing value={leavesTaken.others} max={leavesTaken.total} color="#f59e0b" label="Other Leaves" sublabel="Taken" />
            </div>
          )}
        </div>

        {/* ── Leave Approval + Team Leave Track (side by side) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Leave Approval Table */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold sm:text-base">
                Leave Approval
                {pendingRequests.length > 0 && (
                  <Badge variant="destructive" className="ml-2 text-[10px]">{pendingRequests.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium">Leave Type</th>
                      <th className="px-3 py-2 text-left font-medium">Start Date</th>
                      <th className="px-3 py-2 text-left font-medium">End Date</th>
                      <th className="px-3 py-2 text-center font-medium">Status</th>
                      <th className="px-3 py-2 text-center font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      [...Array(4)].map((_, i) => (
                        <tr key={i} className="border-b">
                          <td colSpan={6} className="px-3 py-2"><Skeleton className="h-6 w-full" /></td>
                        </tr>
                      ))
                    ) : pendingRequests.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          <Clock className="h-8 w-8 mx-auto mb-1 opacity-40" />
                          No pending requests
                        </td>
                      </tr>
                    ) : (
                      pendingRequests.slice(0, 8).map((req) => {
                        const statusInfo = getLeaveStatusInfo(req.status);
                        return (
                          <tr key={req.id} className="border-b hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2 font-medium whitespace-nowrap">{req.employee_name}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{getLeaveTypeLabel(req.leave_type)}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{format(parseISO(req.start_date), "dd MMM yyyy")}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{format(parseISO(req.end_date), "dd MMM yyyy")}</td>
                            <td className="px-3 py-2 text-center">
                              <Badge className={`text-[10px] border ${statusInfo.color}`}>{statusInfo.label}</Badge>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <div className="flex gap-1 justify-center">
                                <button
                                  onClick={() => openReview(req, "approve")}
                                  className="p-1 rounded-md bg-green-100 text-green-700 hover:bg-green-200 transition-colors dark:bg-green-900/40 dark:text-green-400"
                                  title="Approve"
                                >
                                  <CheckCircle2 size={16} />
                                </button>
                                <button
                                  onClick={() => openReview(req, "reject")}
                                  className="p-1 rounded-md bg-red-100 text-red-600 hover:bg-red-200 transition-colors dark:bg-red-900/40 dark:text-red-400"
                                  title="Reject"
                                >
                                  <XCircle size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Team Leave Track Chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold sm:text-base">Team Leave Track</CardTitle>
              <p className="text-[10px] text-muted-foreground sm:text-xs">{CURRENT_YEAR} · Approved leaves</p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[180px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone" dataKey="leaves" name="Total Leaves"
                      stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Leave Calendar ── */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-sm font-semibold sm:text-base">Leave Calendar</CardTitle>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCalMonth(subMonths(calMonth, 1))}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-700 shadow-sm hover:bg-blue-100 hover:text-blue-700 active:scale-95 dark:bg-slate-800 dark:text-slate-300 sm:px-3 sm:py-1.5 sm:text-xs"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs font-semibold min-w-[100px] text-center sm:text-sm">
                  {format(calMonth, "MMMM yyyy")}
                </span>
                <button
                  onClick={() => setCalMonth(addMonths(calMonth, 1))}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-700 shadow-sm hover:bg-blue-100 hover:text-blue-700 active:scale-95 dark:bg-slate-800 dark:text-slate-300 sm:px-3 sm:py-1.5 sm:text-xs"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                { label: "Casual Leave", color: "bg-amber-400" },
                { label: "Earned Leave", color: "bg-blue-500" },
                { label: "Comp Off", color: "bg-teal-400" },
                { label: "Restricted Holiday", color: "bg-purple-400" },
                { label: "Other", color: "bg-pink-400" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1">
                  <span className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                  <span className="text-[10px] text-muted-foreground sm:text-xs">{item.label}</span>
                </div>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="w-full h-[200px]" />
            ) : (
              <div className="grid grid-cols-7 gap-px sm:gap-1">
                {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                  <div key={d} className="text-center text-[9px] font-bold text-muted-foreground pb-1 sm:text-xs">{d}</div>
                ))}
                {Array.from({ length: calDays[0]?.getDay() || 0 }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {calDays.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const entries = calLeaveMap.get(key);
                  const today = isToday(day);
                  return (
                    <div
                      key={key}
                      className={cn(
                        "min-h-[36px] sm:min-h-[48px] p-0.5 sm:p-1 border rounded text-center transition-colors",
                        today ? "border-blue-500 border-2 bg-blue-50/30 dark:bg-blue-950/20" : "border-transparent",
                      )}
                    >
                      <span className="text-[10px] text-gray-700 dark:text-gray-300 sm:text-xs">{format(day, "d")}</span>
                      {entries && (
                        <div className="flex justify-center gap-0.5 mt-0.5 flex-wrap">
                          {entries.slice(0, 3).map((e, i) => (
                            <span key={i} className={`w-1.5 h-1.5 rounded-full ${e.color}`} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Review Dialog ── */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve" ? "Approve" : "Reject"} Leave Request
            </DialogTitle>
            <DialogDescription>
              {reviewTarget && (
                <>
                  <strong>{reviewTarget.employee_name}</strong> — {getLeaveTypeLabel(reviewTarget.leave_type)} ({reviewTarget.total_days} day{reviewTarget.total_days > 1 ? "s" : ""})
                  <br />
                  {format(parseISO(reviewTarget.start_date), "dd MMM yyyy")}
                  {reviewTarget.start_date !== reviewTarget.end_date && ` — ${format(parseISO(reviewTarget.end_date), "dd MMM yyyy")}`}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Remarks (optional)</label>
              <Textarea
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                placeholder="Add remarks..."
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>Cancel</Button>
              <Button
                variant={reviewAction === "approve" ? "default" : "destructive"}
                onClick={handleReview}
                disabled={reviewMutation.isPending}
              >
                {reviewMutation.isPending ? "Processing..." : reviewAction === "approve" ? "Approve" : "Reject"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
