import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLeaves, useUpdateLeave } from "@/hooks/useLeaves";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Calendar, User, Clock, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";

export default function LeaveApprovals() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: leaves, isLoading } = useLeaves();
  const updateLeave = useUpdateLeave();

  const [selectedLeave, setSelectedLeave] = useState<any>(null);
  const [comments, setComments] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [action, setAction] = useState<"approve" | "reject">("approve");

  const handleAction = async () => {
    if (!user || !selectedLeave) return;

    const isWSOApproval = selectedLeave.status === "pending_wso";
    const isSupervisorApproval = selectedLeave.status === "pending_supervisor";

    const updates: any = {};

    if (action === "approve") {
      if (isWSOApproval) {
        updates.status = "pending_supervisor";
        updates.wso_approved_by = user.id;
        updates.wso_approved_at = new Date().toISOString();
        updates.wso_comments = comments;
      } else if (isSupervisorApproval) {
        updates.status = "approved";
        updates.supervisor_approved_by = user.id;
        updates.supervisor_approved_at = new Date().toISOString();
        updates.supervisor_comments = comments;
      }
    } else {
      updates.status = "rejected";
      if (isWSOApproval) {
        updates.wso_approved_by = user.id;
        updates.wso_approved_at = new Date().toISOString();
        updates.wso_comments = comments;
      } else {
        updates.supervisor_approved_by = user.id;
        updates.supervisor_approved_at = new Date().toISOString();
        updates.supervisor_comments = comments;
      }
    }

    try {
      await updateLeave.mutateAsync({ id: selectedLeave.id, ...updates });

      toast({
        title: action === "approve" ? "Leave approved" : "Leave rejected",
        description: `Leave request has been ${action === "approve" ? "approved" : "rejected"}`,
      });

      setDialogOpen(false);
      setComments("");
      setSelectedLeave(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const openApprovalDialog = (leave: any, actionType: "approve" | "reject") => {
    setSelectedLeave(leave);
    setAction(actionType);
    setDialogOpen(true);
  };

  const pendingLeaves = leaves?.filter((l: any) => 
    l.status === "pending_wso" || l.status === "pending_supervisor"
  );
  const approvedLeaves = leaves?.filter((l: any) => l.status === "approved");
  const rejectedLeaves = leaves?.filter((l: any) => l.status === "rejected");

  if (isLoading) {
    return (
      <DashboardLayout role="supervisor">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  const LeaveCard = ({ leave }: { leave: any }) => (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-5 w-5" />
              {leave.user?.full_name}
              <Badge variant="outline">{leave.user?.employee_id}</Badge>
            </CardTitle>
            <CardDescription>
              <Badge className="mt-2">{leave.leave_type.toUpperCase().replace(/_/g, " ")}</Badge>
            </CardDescription>
          </div>
          <Badge variant={leave.status === "pending_wso" || leave.status === "pending_supervisor" ? "secondary" : "default"}>
            {leave.status.replace(/_/g, " ").toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span>
            {format(new Date(leave.start_date), "dd MMM yyyy")} - {format(new Date(leave.end_date), "dd MMM yyyy")}
          </span>
          <Badge variant="outline">{leave.days_count} day(s)</Badge>
        </div>

        <div className="text-sm">
          <p className="font-medium mb-1">Reason:</p>
          <p className="text-muted-foreground">{leave.reason}</p>
        </div>

        {leave.wso_comments && (
          <div className="text-sm bg-secondary/50 p-3 rounded">
            <p className="font-medium mb-1">WSO Comments:</p>
            <p className="text-muted-foreground">{leave.wso_comments}</p>
          </div>
        )}

        {leave.supervisor_comments && (
          <div className="text-sm bg-secondary/50 p-3 rounded">
            <p className="font-medium mb-1">Supervisor Comments:</p>
            <p className="text-muted-foreground">{leave.supervisor_comments}</p>
          </div>
        )}

        {(leave.status === "pending_wso" || leave.status === "pending_supervisor") && (
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => openApprovalDialog(leave, "approve")}
              className="flex-1"
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => openApprovalDialog(leave, "reject")}
              className="flex-1"
            >
              <XCircle className="h-4 w-4 mr-1" />
              Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Leave Approvals</h1>
          <p className="text-muted-foreground">Review and approve leave requests</p>
        </div>

        <Tabs defaultValue="pending" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pending">
              Pending <Badge className="ml-2">{pendingLeaves?.length || 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4">
            {pendingLeaves?.map((leave: any) => (
              <LeaveCard key={leave.id} leave={leave} />
            ))}
            {pendingLeaves?.length === 0 && (
              <Card>
                <CardContent className="text-center py-12 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No pending leave requests</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="approved" className="space-y-4">
            {approvedLeaves?.map((leave: any) => (
              <LeaveCard key={leave.id} leave={leave} />
            ))}
            {approvedLeaves?.length === 0 && (
              <Card>
                <CardContent className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No approved leaves</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="rejected" className="space-y-4">
            {rejectedLeaves?.map((leave: any) => (
              <LeaveCard key={leave.id} leave={leave} />
            ))}
            {rejectedLeaves?.length === 0 && (
              <Card>
                <CardContent className="text-center py-12 text-muted-foreground">
                  <XCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No rejected leaves</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {action === "approve" ? "Approve" : "Reject"} Leave Request
              </DialogTitle>
              <DialogDescription>
                Add comments for the {action === "approve" ? "approval" : "rejection"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Enter your comments..."
                rows={4}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant={action === "approve" ? "default" : "destructive"}
                  onClick={handleAction}
                  disabled={updateLeave.isPending}
                >
                  {updateLeave.isPending ? "Processing..." : action === "approve" ? "Approve" : "Reject"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
