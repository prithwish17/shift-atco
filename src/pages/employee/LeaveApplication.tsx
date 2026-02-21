import { useState, useEffect, useMemo } from 'react';
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
import { Calendar, Clock, CheckCircle, XCircle, AlertCircle, Send, Ban, Pencil } from 'lucide-react';
import { format, differenceInDays, isBefore, startOfDay } from 'date-fns';
import { LEAVE_TYPES, getLeaveTypeLabel, getLeaveStatusInfo } from '@/lib/leaveConstants';
import { useMyLeaveRequests, useCreateLeaveRequest, useCancelLeaveRequest } from '@/hooks/useLeaveRequests';

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
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Leave Management</h1>
          <p className="text-muted-foreground text-sm">Apply for leave and track your applications</p>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-3 grid-cols-3">
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold">{myRequests.length}</div>
              <div className="text-xs text-muted-foreground">Total Requests</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
              <div className="text-xs text-muted-foreground">Pending</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-2xl font-bold text-green-600">{approvedCount}</div>
              <div className="text-xs text-muted-foreground">Approved</div>
            </CardContent>
          </Card>
        </div>

        {/* Application Form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Send className="h-5 w-5" />
              Apply for Leave
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Leave Type *</Label>
                  <Select
                    value={formData.leave_type}
                    onValueChange={(v) => setFormData({ ...formData, leave_type: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select leave type" /></SelectTrigger>
                    <SelectContent>
                      {LEAVE_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Total Days</Label>
                  <Input
                    value={isHalfDay ? '0.5' : totalDays > 0 ? totalDays : '—'}
                    readOnly
                    className="bg-muted"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Start Date *</Label>
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
                  />
                </div>

                <div className="space-y-2">
                  <Label>End Date *</Label>
                  <Input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    min={formData.start_date || format(new Date(), 'yyyy-MM-dd')}
                    disabled={isHalfDay}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="Enter reason for leave..."
                  rows={3}
                />
              </div>

              <Button type="submit" disabled={createRequest.isPending || !formData.leave_type || !formData.start_date || !formData.end_date}>
                {createRequest.isPending ? 'Submitting...' : 'Submit Request'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Leave History */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Leave History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium">Date Range</th>
                    <th className="px-4 py-2 text-left font-medium">Leave Type</th>
                    <th className="px-4 py-2 text-center font-medium">Days</th>
                    <th className="px-4 py-2 text-center font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Remarks</th>
                    <th className="px-4 py-2 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {myRequests.map((req) => {
                    const statusInfo = getLeaveStatusInfo(req.status);
                    return (
                      <tr key={req.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>
                              {format(new Date(req.start_date), 'dd MMM')}
                              {req.start_date !== req.end_date && ` — ${format(new Date(req.end_date), 'dd MMM')}`}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="font-normal text-xs">
                            {getLeaveTypeLabel(req.leave_type)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">{req.total_days}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={`text-[10px] font-medium border ${statusInfo.color}`}>
                            {statusInfo.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate">
                          {req.status === 'Pending Supervisor'
                            ? 'Approved by WSO, awaiting supervisor final approval'
                            : req.remarks || '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {(req.status === 'Pending WSO' || req.status === 'Pending Supervisor') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-destructive hover:text-destructive"
                              onClick={() => { setCancelTarget(req.id); setCancelDialogOpen(true); }}
                            >
                              <Ban className="h-3 w-3 mr-1" />
                              Cancel
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {myRequests.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-muted-foreground">
                        <AlertCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
                        No leave applications found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

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
