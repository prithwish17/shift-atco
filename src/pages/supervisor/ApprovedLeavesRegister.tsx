import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle, Clock3, Files, Filter, ListChecks, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { getLeaveTypeLabel, LEAVE_TYPES } from '@/lib/leaveConstants';
import { useAllLeaveRequests, useMarkSapUpdated } from '@/hooks/useLeaveRequests';

function formatLeaveRange(startDate: string, endDate: string) {
  const start = format(new Date(startDate), 'dd MMM yyyy');
  const end = format(new Date(endDate), 'dd MMM yyyy');
  return startDate === endDate ? start : `${start} — ${end}`;
}

export default function ApprovedLeavesRegister() {
  const { userRole } = useAuth();
  const navigate = useNavigate();
  const dashboardRole = userRole === 'wso' ? 'wso' : 'supervisor';
  const backPath = userRole === 'wso' ? '/wso/leaves' : '/supervisor/leaves';

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('');
  const [sapFilter, setSapFilter] = useState('');

  const normalizedTeamFilter = teamFilter && teamFilter !== '__all__' ? teamFilter : '';
  const normalizedLeaveTypeFilter = leaveTypeFilter && leaveTypeFilter !== '__all__' ? leaveTypeFilter : '';
  const normalizedSapFilter = sapFilter && sapFilter !== '__all__' ? sapFilter : '';

  const filters = useMemo(
    () => ({
      status: 'Approved',
      startDate: dateFrom || undefined,
      endDate: dateTo || undefined,
      team: normalizedTeamFilter || undefined,
    }),
    [dateFrom, dateTo, normalizedTeamFilter],
  );

  const { data: allApproved = [], isLoading } = useAllLeaveRequests(filters);
  const markSapUpdated = useMarkSapUpdated();

  const teams = useMemo(() => {
    const values = new Set(allApproved.map((request) => request.team).filter(Boolean));
    return [...values].sort();
  }, [allApproved]);

  const filtered = useMemo(() => {
    let list = [...allApproved].sort((left, right) => left.start_date.localeCompare(right.start_date));

    if (normalizedLeaveTypeFilter) {
      list = list.filter((request) => request.leave_type === normalizedLeaveTypeFilter);
    }

    if (normalizedSapFilter === 'updated') {
      list = list.filter((request) => request.sap_updated);
    } else if (normalizedSapFilter === 'pending') {
      list = list.filter((request) => !request.sap_updated);
    }

    return list;
  }, [allApproved, normalizedLeaveTypeFilter, normalizedSapFilter]);

  const sapUpdatedCount = filtered.filter((request) => request.sap_updated).length;
  const sapPendingCount = filtered.filter((request) => !request.sap_updated).length;
  const hasFilters = Boolean(dateFrom || dateTo || normalizedTeamFilter || normalizedLeaveTypeFilter || normalizedSapFilter);

  const stats = [
    {
      label: 'Total Approved',
      value: isLoading ? '—' : String(filtered.length),
      note: 'Leaves in the current filtered view',
      icon: Files,
      tone: 'bg-slate-950 text-white dark:bg-white dark:text-slate-950',
    },
    {
      label: 'Updated in SAP',
      value: isLoading ? '—' : String(sapUpdatedCount),
      note: 'Manually confirmed by supervisor',
      icon: ShieldCheck,
      tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    },
    {
      label: 'Pending SAP Update',
      value: isLoading ? '—' : String(sapPendingCount),
      note: 'Still needs SAP completion',
      icon: Clock3,
      tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    },
  ];

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setTeamFilter('');
    setLeaveTypeFilter('');
    setSapFilter('');
  };

  const handleToggleSap = (id: string, current: boolean | null) => {
    markSapUpdated.mutate(
      { id, sap_updated: !current },
      {
        onSuccess: () => toast.success(current ? 'SAP status cleared' : 'Marked as updated in SAP'),
        onError: () => toast.error('Failed to update SAP status'),
      },
    );
  };

  return (
    <DashboardLayout role={dashboardRole}>
      <div className="space-y-6 lg:space-y-7">
        <section className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_32%),linear-gradient(135deg,#fbfdff_0%,#f3f7ff_42%,#f5faf7_100%)] p-5 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.1),transparent_28%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.95)_40%,rgba(6,78,59,0.72)_100%)] sm:p-6 xl:p-7">
          <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.18),transparent)] xl:block dark:bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.05),transparent)]" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full border border-white/60 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
                  <ListChecks className="mr-1.5 h-3.5 w-3.5" />
                  SAP Approved Register
                </Badge>
                <Badge variant="outline" className="rounded-full border-slate-300/70 bg-white/60 text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                  Approved leave audit view
                </Badge>
              </div>

              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                  Review SAP completion against approved leave records.
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">
                  Filter approved leaves by date, team, type, and SAP status, then mark entries once the corresponding leave has been updated in SAP.
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-10 rounded-xl border-slate-300 bg-white/80 px-3 hover:bg-white dark:border-slate-700 dark:bg-slate-900/80 dark:hover:bg-slate-900"
              onClick={() => navigate(backPath)}
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to Leave Review
            </Button>
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-3">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.38)] dark:border-slate-800 dark:bg-slate-950/80 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{stat.label}</p>
                    <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">{stat.value}</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{stat.note}</p>
                  </div>
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${stat.tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <Card className="overflow-hidden rounded-[26px] border-slate-200/80 bg-white/90 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.38)] dark:border-slate-800 dark:bg-slate-950/80">
          <CardContent className="p-0">
            <div className="border-b border-slate-200/80 bg-slate-50/80 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Filter Console</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">Narrow the register</h2>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <SlidersHorizontal className="h-4 w-4" />
                  <span>{filtered.length} visible record{filtered.length === 1 ? '' : 's'}</span>
                </div>
              </div>
            </div>

            <div className="px-5 py-5">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Filter className="h-4 w-4" />
                  Filters:
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">From</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[148px] rounded-xl text-xs" />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">To</label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[148px] rounded-xl text-xs" />
                </div>

                <div className="min-w-[140px]">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Team</label>
                  <Select value={teamFilter} onValueChange={setTeamFilter}>
                    <SelectTrigger className="h-9 rounded-xl text-xs">
                      <SelectValue placeholder="All Teams" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All Teams</SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team} value={team!}>Team {team}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-[170px]">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Leave Type</label>
                  <Select value={leaveTypeFilter} onValueChange={setLeaveTypeFilter}>
                    <SelectTrigger className="h-9 rounded-xl text-xs">
                      <SelectValue placeholder="All Leave Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All Leave Types</SelectItem>
                      {LEAVE_TYPES.map((leaveType) => (
                        <SelectItem key={leaveType.value} value={leaveType.value}>{leaveType.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-[170px]">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">SAP Status</label>
                  <Select value={sapFilter} onValueChange={setSapFilter}>
                    <SelectTrigger className="h-9 rounded-xl text-xs">
                      <SelectValue placeholder="All SAP Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All SAP Status</SelectItem>
                      <SelectItem value="updated">Updated in SAP</SelectItem>
                      <SelectItem value="pending">Pending SAP Update</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {hasFilters ? (
                  <Button variant="ghost" size="sm" className="h-9 rounded-xl px-3 text-xs" onClick={clearFilters}>
                    <X className="h-3.5 w-3.5 mr-1" />
                    Clear Filters
                  </Button>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200/80 pt-4 text-xs text-muted-foreground dark:border-slate-800">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  Updated in SAP
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 font-medium text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/50">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-400" />
                  Pending SAP Update
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 sm:ml-auto">
                  Use the row action to toggle SAP completion status.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[26px] border-slate-200/80 bg-white/90 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.38)] dark:border-slate-800 dark:bg-slate-950/80">
          <CardContent className="p-0">
            <div className="border-b border-slate-200/80 bg-slate-50/80 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Register Table</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">Approved leave rows</h2>
                </div>
                <Badge variant="outline" className="rounded-full border-slate-300 bg-white/80 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  Sorted by leave start date
                </Badge>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/40">
                      <th className="w-10 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">#</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Employee</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Leave Dates</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Type</th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Days</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Applied On</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Approved On</th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">SAP Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((request, index) => (
                      <tr
                        key={request.id}
                        className={
                          request.sap_updated
                            ? 'border-b border-emerald-100 bg-emerald-50/70 transition-colors hover:bg-emerald-100/70 dark:border-emerald-950/40 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30'
                            : 'border-b border-rose-100 bg-rose-50/70 transition-colors hover:bg-rose-100/70 dark:border-rose-950/40 dark:bg-rose-950/20 dark:hover:bg-rose-950/30'
                        }
                      >
                        <td className="px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">{index + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-950 dark:text-white">{request.employee_name}</div>
                          {request.team ? (
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Team {request.team}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-700 dark:text-slate-300">
                          {formatLeaveRange(request.start_date, request.end_date)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="bg-white/70 text-[10px] font-normal dark:bg-slate-900/70">
                            {getLeaveTypeLabel(request.leave_type)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center font-medium text-slate-950 dark:text-white">{request.total_days}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {format(new Date(request.applied_at), 'dd MMM yyyy')}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {request.supervisor_approved_at
                            ? format(new Date(request.supervisor_approved_at), 'dd MMM yyyy')
                            : request.wso_approved_at
                              ? format(new Date(request.wso_approved_at), 'dd MMM yyyy')
                              : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {request.sap_updated ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-xl border-emerald-300 bg-emerald-100 px-3 text-xs text-emerald-700 hover:bg-emerald-200 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                              disabled={markSapUpdated.isPending}
                              onClick={() => handleToggleSap(request.id, request.sap_updated)}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              SAP Updated
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-xl border-rose-200 px-3 text-xs text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-400"
                              disabled={markSapUpdated.isPending}
                              onClick={() => handleToggleSap(request.id, request.sap_updated)}
                            >
                              Mark SAP Updated
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}

                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-16 text-center text-muted-foreground">
                          <CheckCircle className="mx-auto mb-2 h-10 w-10 opacity-30" />
                          <p className="text-sm">No approved leaves found</p>
                          {hasFilters ? <p className="mt-1 text-xs">Try adjusting your filters</p> : null}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
