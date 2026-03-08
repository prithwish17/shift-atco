import { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { History, Calendar, Filter, Search, Ban, AlertCircle, ChevronDown, ChevronUp, Clock, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { format, parseISO, isAfter, isBefore, startOfDay } from 'date-fns';
import { useMyLeaveRequests, useCancelLeaveRequest } from '@/hooks/useLeaveRequests';
import { LEAVE_TYPES, LEAVE_STATUS, getLeaveTypeLabel, getLeaveStatusInfo } from '@/lib/leaveConstants';
import { toast } from 'sonner';

export default function LeaveHistory() {
    const { user } = useAuth();
    const { data: requests = [], isLoading } = useMyLeaveRequests(user?.id);
    const cancelRequest = useCancelLeaveRequest();

    // Filters
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

    // Filter & sort
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

    // Summary stats
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
                    <p className="text-sm text-muted-foreground">Track all your leave applications and their status</p>
                </div>

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
                                <CardContent className="py-3 px-4">
                                    <div className="flex items-start justify-between gap-3">
                                        {/* Left */}
                                        <div className="flex items-start gap-3 min-w-0">
                                            <div className="mt-0.5">{getStatusIcon(req.status)}</div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <Badge variant="outline" className="text-xs font-medium">
                                                        {getLeaveTypeLabel(req.leave_type)}
                                                    </Badge>
                                                    <Badge className={`text-[10px] font-medium border ${statusInfo.color}`}>
                                                        {statusInfo.label}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-1.5 mt-1 text-sm">
                                                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                                    <span className="font-medium">
                                                        {format(startDate, 'dd MMM yyyy')}
                                                        {req.start_date !== req.end_date && ` — ${format(endDate, 'dd MMM yyyy')}`}
                                                    </span>
                                                    <span className="text-muted-foreground">
                                                        ({req.total_days} {req.total_days === 1 ? 'day' : 'days'})
                                                    </span>
                                                </div>
                                                {req.reason && (
                                                    <p className="text-xs text-muted-foreground mt-1 truncate max-w-[400px]">
                                                        {req.reason}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Right */}
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            <span className="text-[10px] text-muted-foreground">
                                                Applied {format(parseISO(req.applied_at), 'dd MMM yyyy')}
                                            </span>
                                            {isPending && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-6 text-[10px] text-destructive hover:text-destructive"
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
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>

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
