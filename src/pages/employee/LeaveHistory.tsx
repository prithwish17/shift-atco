import { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { History, Calendar, Filter, Search, Ban, AlertCircle, ChevronDown, ChevronUp, Clock, CheckCircle2, XCircle, FileText, ClipboardList } from 'lucide-react';
import { format, parseISO, isAfter, startOfDay } from 'date-fns';
import { useMyLeaveRequests, useCancelLeaveRequest } from '@/hooks/useLeaveRequests';
import { LEAVE_TYPES, LEAVE_STATUS, getLeaveTypeLabel, getLeaveStatusInfo } from '@/lib/leaveConstants';
import { useLeaveRecords, useLeaveRecordSummary, LEAVE_CATEGORIES, getLeaveCategoryLabel, getLeaveCategoryColor, type LeaveRecord } from '@/hooks/useLeaveRecords';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

// Color map for category cards
const CATEGORY_COLORS: Record<string, { border: string; text: string }> = {
    indigo: { border: 'border-l-indigo-500', text: 'text-indigo-600' },
    blue: { border: 'border-l-blue-500', text: 'text-blue-600' },
    emerald: { border: 'border-l-emerald-500', text: 'text-emerald-600' },
    violet: { border: 'border-l-violet-500', text: 'text-violet-600' },
    amber: { border: 'border-l-amber-500', text: 'text-amber-600' },
    rose: { border: 'border-l-rose-500', text: 'text-rose-600' },
    gray: { border: 'border-l-gray-400', text: 'text-gray-500' },
};

export default function LeaveHistory() {
    const { user } = useAuth();
    const { data: requests = [], isLoading } = useMyLeaveRequests(user?.id);
    const cancelRequest = useCancelLeaveRequest();

    // Resolve employee_id from profile for leave records
    const { data: profile } = useQuery({
        queryKey: ['my-profile-empid', user?.id],
        queryFn: async () => {
            if (!user?.id) return null;
            const { data, error } = await supabase
                .from('profiles')
                .select('employee_id')
                .eq('id', user.id)
                .maybeSingle();
            if (error) throw error;
            return data;
        },
        enabled: !!user?.id,
        staleTime: 30 * 60 * 1000,
    });

    const empId = profile?.employee_id || '';

    // Leave Register data
    const currentYear = new Date().getFullYear();
    const [registerYear, setRegisterYear] = useState<number>(currentYear);
    const [registerCategoryFilter, setRegisterCategoryFilter] = useState<string>('all');
    const { data: leaveRecords = [], isLoading: recordsLoading } = useLeaveRecords(empId, registerYear);
    const { data: summary = {} } = useLeaveRecordSummary(empId, registerYear);

    // Filters for Leave Requests tab
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

    // Cancel dialog
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
    const [cancelTarget, setCancelTarget] = useState<string | null>(null);

    // Detail drawer
    const [detailRequest, setDetailRequest] = useState<any | null>(null);

    const today = startOfDay(new Date());

    // Filter & sort leave requests
    const filtered = useMemo(() => {
        let list = [...requests];

        if (statusFilter !== 'all') {
            list = list.filter((r) => r.status === statusFilter);
        }
        if (typeFilter !== 'all') {
            list = list.filter((r) => r.leave_type === typeFilter);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(
                (r) =>
                    r.reason?.toLowerCase().includes(q) ||
                    getLeaveTypeLabel(r.leave_type).toLowerCase().includes(q)
            );
        }

        list.sort((a, b) =>
            sortOrder === 'newest'
                ? b.applied_at.localeCompare(a.applied_at)
                : a.applied_at.localeCompare(b.applied_at)
        );

        return list;
    }, [requests, statusFilter, typeFilter, searchQuery, sortOrder]);

    // Filter leave records
    const filteredRecords = useMemo(() => {
        if (registerCategoryFilter === 'all') return leaveRecords;
        return leaveRecords.filter((r) => r.leave_category === registerCategoryFilter);
    }, [leaveRecords, registerCategoryFilter]);

    // Summary stats for Leave Requests tab
    const stats = useMemo(() => {
        const total = requests.length;
        const approved = requests.filter((r) => r.status === 'Approved').length;
        const pending = requests.filter((r) => r.status === 'Pending WSO' || r.status === 'Pending Supervisor').length;
        const rejected = requests.filter((r) => r.status === 'Rejected').length;
        const cancelled = requests.filter((r) => r.status === 'Cancelled').length;
        const totalDaysApproved = requests
            .filter((r) => r.status === 'Approved')
            .reduce((sum, r) => sum + (r.total_days || 0), 0);
        return { total, approved, pending, rejected, cancelled, totalDaysApproved };
    }, [requests]);

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

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'Approved': return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
            case 'Rejected': return <XCircle className="h-3.5 w-3.5 text-red-600" />;
            case 'Cancelled': return <Ban className="h-3.5 w-3.5 text-gray-500" />;
            default: return <Clock className="h-3.5 w-3.5 text-amber-600" />;
        }
    };

    // Year options for register
    const yearOptions = Array.from({ length: 3 }, (_, i) => currentYear - i);

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
            <div className="max-w-5xl mx-auto space-y-5">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                        <History className="h-6 w-6 text-indigo-600" /> Leave History
                    </h1>
                    <p className="text-sm text-muted-foreground">Track all your leave applications and official leave register</p>
                </div>

                <Tabs defaultValue="requests" className="space-y-5">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="requests" className="flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5" />
                            Leave Requests
                        </TabsTrigger>
                        <TabsTrigger value="register" className="flex items-center gap-1.5">
                            <ClipboardList className="h-3.5 w-3.5" />
                            Leave Register
                        </TabsTrigger>
                    </TabsList>

                    {/* ═══════════ Tab 1: Leave Requests (existing UI) ═══════════ */}
                    <TabsContent value="requests" className="space-y-5">
                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <Card className="border-l-4 border-l-indigo-500">
                                <CardContent className="pt-3 pb-3">
                                    <div className="text-2xl font-black text-indigo-600">{stats.total}</div>
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</div>
                                </CardContent>
                            </Card>
                            <Card className="border-l-4 border-l-green-500">
                                <CardContent className="pt-3 pb-3">
                                    <div className="text-2xl font-black text-green-600">{stats.approved}</div>
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Approved</div>
                                </CardContent>
                            </Card>
                            <Card className="border-l-4 border-l-amber-500">
                                <CardContent className="pt-3 pb-3">
                                    <div className="text-2xl font-black text-amber-600">{stats.pending}</div>
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pending</div>
                                </CardContent>
                            </Card>
                            <Card className="border-l-4 border-l-red-500">
                                <CardContent className="pt-3 pb-3">
                                    <div className="text-2xl font-black text-red-600">{stats.rejected}</div>
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Rejected</div>
                                </CardContent>
                            </Card>
                            <Card className="border-l-4 border-l-slate-400">
                                <CardContent className="pt-3 pb-3">
                                    <div className="text-2xl font-black text-slate-500">{stats.totalDaysApproved}</div>
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Days Used</div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Filters */}
                        <Card>
                            <CardContent className="pt-4 pb-4">
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                        <Filter className="h-3.5 w-3.5" /> Filters
                                    </div>
                                    <div className="relative flex-1 min-w-[160px] max-w-[280px]">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                        <Input
                                            placeholder="Search by reason or type..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="pl-8 h-8 text-xs"
                                        />
                                    </div>
                                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                                        <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Status</SelectItem>
                                            {LEAVE_STATUS.map((s) => (
                                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                                        <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Leave Type" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Types</SelectItem>
                                            {LEAVE_TYPES.map((t) => (
                                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <button
                                        onClick={() => setSortOrder(sortOrder === 'newest' ? 'oldest' : 'newest')}
                                        className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-full border border-slate-200 dark:border-neutral-700 hover:bg-slate-100 dark:hover:bg-neutral-800 transition"
                                    >
                                        {sortOrder === 'newest' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                                        {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
                                    </button>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Leave List */}
                        <div className="space-y-3">
                            {filtered.length === 0 && (
                                <Card>
                                    <CardContent className="py-12 text-center">
                                        <AlertCircle className="h-10 w-10 mx-auto mb-2 text-muted-foreground opacity-40" />
                                        <p className="text-sm text-muted-foreground">
                                            {requests.length === 0 ? 'No leave applications found' : 'No results match your filters'}
                                        </p>
                                    </CardContent>
                                </Card>
                            )}

                            {filtered.map((req) => {
                                const statusInfo = getLeaveStatusInfo(req.status);
                                const isPending = req.status === 'Pending WSO' || req.status === 'Pending Supervisor';
                                const startDate = parseISO(req.start_date);
                                const endDate = parseISO(req.end_date);
                                const isUpcoming = isAfter(startDate, today) || format(startDate, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd');

                                return (
                                    <Card
                                        key={req.id}
                                        className={`transition-all hover:shadow-md cursor-pointer ${isPending ? 'border-l-4 border-l-amber-400' : ''
                                            } ${req.status === 'Approved' && isUpcoming ? 'border-l-4 border-l-green-400' : ''}`}
                                        onClick={() => setDetailRequest(req)}
                                    >
                                        <CardContent className="p-4">
                                            <div className="space-y-3">
                                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                    <div className="flex items-start gap-3 min-w-0">
                                                        <div className="mt-0.5">{getStatusIcon(req.status)}</div>
                                                        <div className="min-w-0 space-y-2">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <Badge variant="outline" className="text-xs font-medium">
                                                                    {getLeaveTypeLabel(req.leave_type)}
                                                                </Badge>
                                                                <Badge className={`text-[10px] font-medium border ${statusInfo.color}`}>
                                                                    {statusInfo.label}
                                                                </Badge>
                                                                <Badge variant="outline" className="text-[10px] font-medium">
                                                                    {req.total_days} {req.total_days === 1 ? 'day' : 'days'}
                                                                </Badge>
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground">
                                                                <span className="inline-flex items-center gap-1.5">
                                                                    <Calendar className="h-3.5 w-3.5" />
                                                                    {format(startDate, 'dd MMM yyyy')}
                                                                    {req.start_date !== req.end_date && ` — ${format(endDate, 'dd MMM yyyy')}`}
                                                                </span>
                                                                <span>Applied {format(parseISO(req.applied_at), 'dd MMM yyyy')}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {isPending && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-7 self-start px-2.5 text-[11px] text-destructive hover:text-destructive"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setCancelTarget(req.id);
                                                                setCancelDialogOpen(true);
                                                            }}
                                                        >
                                                            <Ban className="h-3 w-3 mr-1" /> Cancel
                                                        </Button>
                                                    )}
                                                </div>

                                                {(req.reason || req.status === 'Pending Supervisor') && (
                                                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-xs leading-5 text-muted-foreground dark:border-neutral-800 dark:bg-neutral-900/60 sm:text-sm">
                                                        {req.status === 'Pending Supervisor'
                                                            ? 'Approved by WSO, awaiting supervisor final approval.'
                                                            : req.reason}
                                                    </div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </TabsContent>

                    {/* ═══════════ Tab 2: Leave Register (Official) ═══════════ */}
                    <TabsContent value="register" className="space-y-5">
                        {/* Category Summary Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            {LEAVE_CATEGORIES.map((cat) => {
                                const colors = CATEGORY_COLORS[cat.color] || CATEGORY_COLORS.gray;
                                const count = summary[cat.value] || 0;
                                return (
                                    <Card key={cat.value} className={`border-l-4 ${colors.border}`}>
                                        <CardContent className="pt-3 pb-3">
                                            <div className={`text-2xl font-black ${colors.text}`}>{count}</div>
                                            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                                {cat.value}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>

                        {/* Filters */}
                        <Card>
                            <CardContent className="pt-4 pb-4">
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                        <Filter className="h-3.5 w-3.5" /> Filters
                                    </div>
                                    <Select value={String(registerYear)} onValueChange={(v) => setRegisterYear(Number(v))}>
                                        <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="Year" /></SelectTrigger>
                                        <SelectContent>
                                            {yearOptions.map((y) => (
                                                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={registerCategoryFilter} onValueChange={setRegisterCategoryFilter}>
                                        <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Categories</SelectItem>
                                            {LEAVE_CATEGORIES.map((c) => (
                                                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <span className="text-[10px] text-muted-foreground ml-auto">
                                        {filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Records List */}
                        <div className="space-y-2">
                            {recordsLoading ? (
                                <Card>
                                    <CardContent className="py-12 text-center">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
                                        <p className="text-sm text-muted-foreground mt-2">Loading leave register…</p>
                                    </CardContent>
                                </Card>
                            ) : !empId ? (
                                <Card>
                                    <CardContent className="py-12 text-center">
                                        <AlertCircle className="h-10 w-10 mx-auto mb-2 text-muted-foreground opacity-40" />
                                        <p className="text-sm text-muted-foreground">
                                            Profile not found. Leave register requires an employee ID.
                                        </p>
                                    </CardContent>
                                </Card>
                            ) : filteredRecords.length === 0 ? (
                                <Card>
                                    <CardContent className="py-12 text-center">
                                        <ClipboardList className="h-10 w-10 mx-auto mb-2 text-muted-foreground opacity-40" />
                                        <p className="text-sm text-muted-foreground">
                                            No leave records found for {registerYear}
                                            {registerCategoryFilter !== 'all' ? ` in ${getLeaveCategoryLabel(registerCategoryFilter)}` : ''}
                                        </p>
                                    </CardContent>
                                </Card>
                            ) : (
                                filteredRecords.map((rec) => {
                                    const catColor = getLeaveCategoryColor(rec.leave_category);
                                    const colors = CATEGORY_COLORS[catColor] || CATEGORY_COLORS.gray;
                                    const meta = rec.metadata || {};
                                    const metaEntries = Object.entries(meta).filter(([, v]) => v !== '' && v != null);

                                    return (
                                        <Card key={rec.id} className={`border-l-4 ${colors.border}`}>
                                            <CardContent className="py-3 px-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex items-start gap-3 min-w-0">
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <Badge variant="outline" className="text-xs font-medium">
                                                                    {getLeaveCategoryLabel(rec.leave_category)}
                                                                </Badge>
                                                                <Badge
                                                                    variant="secondary"
                                                                    className="text-[10px] font-medium"
                                                                >
                                                                    {rec.source === 'google_sheets' ? 'Sheet' : 'Web App'}
                                                                </Badge>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 mt-1 text-sm">
                                                                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                                                <span className="font-medium">
                                                                    {format(parseISO(rec.leave_date), 'EEEE, dd MMM yyyy')}
                                                                </span>
                                                            </div>
                                                            {metaEntries.length > 0 && (
                                                                <div className="flex flex-wrap gap-2 mt-1.5">
                                                                    {metaEntries.map(([key, value]) => (
                                                                        <span key={key} className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                                                                            <span className="font-semibold">{key.replace(/_/g, ' ')}:</span> {String(value)}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <span className="text-[10px] text-muted-foreground shrink-0">
                                                        {rec.leave_category}
                                                    </span>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })
                            )}
                        </div>
                    </TabsContent>
                </Tabs>

                {/* Detail Dialog */}
                <Dialog open={!!detailRequest} onOpenChange={(open) => !open && setDetailRequest(null)}>
                    <DialogContent className="max-w-lg">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <FileText className="h-5 w-5" /> Leave Request Details
                            </DialogTitle>
                        </DialogHeader>
                        {detailRequest && (() => {
                            const statusInfo = getLeaveStatusInfo(detailRequest.status);
                            return (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-xs">
                                            {getLeaveTypeLabel(detailRequest.leave_type)}
                                        </Badge>
                                        <Badge className={`text-[10px] font-medium border ${statusInfo.color}`}>
                                            {statusInfo.label}
                                        </Badge>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Applied On</p>
                                            <p className="font-medium">{format(parseISO(detailRequest.applied_at), 'dd MMM yyyy, hh:mm a')}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Duration</p>
                                            <p className="font-medium">{detailRequest.total_days} {detailRequest.total_days === 1 ? 'day' : 'days'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Start Date</p>
                                            <p className="font-medium">{format(parseISO(detailRequest.start_date), 'EEEE, dd MMM yyyy')}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">End Date</p>
                                            <p className="font-medium">{format(parseISO(detailRequest.end_date), 'EEEE, dd MMM yyyy')}</p>
                                        </div>
                                    </div>

                                    {detailRequest.reason && (
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Reason</p>
                                            <p className="text-sm bg-muted/50 p-2.5 rounded-lg">{detailRequest.reason}</p>
                                        </div>
                                    )}

                                    {/* Approval Trail */}
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Approval Trail</p>
                                        <div className="space-y-2">
                                            {detailRequest.wso_approved_at && (
                                                <div className="flex items-center gap-2 text-xs bg-green-50 dark:bg-green-900/10 p-2 rounded-lg">
                                                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                                                    <span>WSO approved on {format(parseISO(detailRequest.wso_approved_at), 'dd MMM yyyy, hh:mm a')}</span>
                                                </div>
                                            )}
                                            {detailRequest.supervisor_approved_at && (
                                                <div className="flex items-center gap-2 text-xs bg-green-50 dark:bg-green-900/10 p-2 rounded-lg">
                                                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                                                    <span>Supervisor approved on {format(parseISO(detailRequest.supervisor_approved_at), 'dd MMM yyyy, hh:mm a')}</span>
                                                </div>
                                            )}
                                            {detailRequest.status === 'Rejected' && detailRequest.reviewed_at && (
                                                <div className="flex items-center gap-2 text-xs bg-red-50 dark:bg-red-900/10 p-2 rounded-lg">
                                                    <XCircle className="h-3.5 w-3.5 text-red-600" />
                                                    <span>Rejected on {format(parseISO(detailRequest.reviewed_at), 'dd MMM yyyy, hh:mm a')}</span>
                                                </div>
                                            )}
                                            {detailRequest.status === 'Pending WSO' && (
                                                <div className="flex items-center gap-2 text-xs bg-amber-50 dark:bg-amber-900/10 p-2 rounded-lg">
                                                    <Clock className="h-3.5 w-3.5 text-amber-600" />
                                                    <span>Awaiting WSO approval</span>
                                                </div>
                                            )}
                                            {detailRequest.status === 'Pending Supervisor' && (
                                                <div className="flex items-center gap-2 text-xs bg-amber-50 dark:bg-amber-900/10 p-2 rounded-lg">
                                                    <Clock className="h-3.5 w-3.5 text-amber-600" />
                                                    <span>WSO approved — awaiting Supervisor final approval</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {(detailRequest.remarks || detailRequest.wso_comments || detailRequest.supervisor_comments) && (
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Remarks</p>
                                            <p className="text-sm bg-muted/50 p-2.5 rounded-lg">
                                                {detailRequest.supervisor_comments || detailRequest.wso_comments || detailRequest.remarks || '—'}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </DialogContent>
                </Dialog>

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
