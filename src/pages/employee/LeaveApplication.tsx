import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLeaves, useLeaveBalances, useCreateLeave } from "@/hooks/useLeaves";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { format, differenceInDays } from "date-fns";

export default function LeaveApplication() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: leaves, isLoading: leavesLoading } = useLeaves(user?.id);
  const { data: balances, isLoading: balancesLoading } = useLeaveBalances(user?.id);
  const createLeave = useCreateLeave();

  const [formData, setFormData] = useState({
    leave_type: "",
    start_date: "",
    end_date: "",
    reason: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) return;

    const startDate = new Date(formData.start_date);
    const endDate = new Date(formData.end_date);
    const daysCount = differenceInDays(endDate, startDate) + 1;

    if (daysCount <= 0) {
      toast({
        title: "Invalid dates",
        description: "End date must be after or equal to start date",
        variant: "destructive",
      });
      return;
    }

    try {
      await createLeave.mutateAsync({
        user_id: user.id,
        leave_type: formData.leave_type as any,
        start_date: formData.start_date,
        end_date: formData.end_date,
        reason: formData.reason,
        days_count: daysCount,
      });

      toast({
        title: "Leave application submitted",
        description: "Your leave request has been submitted for approval",
      });

      setFormData({
        leave_type: "",
        start_date: "",
        end_date: "",
        reason: "",
      });
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
        return <CheckCircle className="h-4 w-4 text-accent" />;
      case "rejected":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Clock className="h-4 w-4 text-warning" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      approved: "default",
      rejected: "destructive",
      pending_wso: "secondary",
      pending_supervisor: "secondary",
    };

    return (
      <Badge variant={variants[status] || "secondary"}>
        {status.replace(/_/g, " ").toUpperCase()}
      </Badge>
    );
  };

  if (leavesLoading || balancesLoading) {
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
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Leave Management</h1>
          <p className="text-muted-foreground">Apply for leave and track your applications</p>
        </div>

        {/* Leave Balances */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {balances?.map((balance) => (
            <Card key={balance.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {balance.leave_type.toUpperCase().replace(/_/g, " ")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{balance.balance} days</div>
                {balance.expiry_date && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Expires: {format(new Date(balance.expiry_date), "dd MMM yyyy")}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Leave Application Form */}
        <Card>
          <CardHeader>
            <CardTitle>Apply for Leave</CardTitle>
            <CardDescription>Submit a new leave application</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="leave_type">Leave Type</Label>
                  <Select
                    value={formData.leave_type}
                    onValueChange={(value) =>
                      setFormData({ ...formData, leave_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select leave type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cl">Casual Leave (CL)</SelectItem>
                      <SelectItem value="rh">Restricted Holiday (RH)</SelectItem>
                      <SelectItem value="el">Earned Leave (EL)</SelectItem>
                      <SelectItem value="hpl">Half Pay Leave (HPL)</SelectItem>
                      <SelectItem value="comp_off">Compensatory Off</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="start_date">Start Date</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={formData.start_date}
                    onChange={(e) =>
                      setFormData({ ...formData, start_date: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end_date">End Date</Label>
                  <Input
                    id="end_date"
                    type="date"
                    value={formData.end_date}
                    onChange={(e) =>
                      setFormData({ ...formData, end_date: e.target.value })
                    }
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">Reason</Label>
                <Textarea
                  id="reason"
                  value={formData.reason}
                  onChange={(e) =>
                    setFormData({ ...formData, reason: e.target.value })
                  }
                  placeholder="Enter reason for leave..."
                  required
                />
              </div>

              <Button type="submit" disabled={createLeave.isPending}>
                {createLeave.isPending ? "Submitting..." : "Submit Application"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Leave History */}
        <Card>
          <CardHeader>
            <CardTitle>Leave History</CardTitle>
            <CardDescription>Your previous leave applications</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {leaves?.map((leave: any) => (
                <div
                  key={leave.id}
                  className="flex items-center justify-between border-b pb-4 last:border-0"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {format(new Date(leave.start_date), "dd MMM yyyy")} -{" "}
                        {format(new Date(leave.end_date), "dd MMM yyyy")}
                      </span>
                      <Badge variant="outline">
                        {leave.leave_type.toUpperCase().replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{leave.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      {leave.days_count} day(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(leave.status)}
                    {getStatusBadge(leave.status)}
                  </div>
                </div>
              ))}
              {leaves?.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No leave applications found</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
