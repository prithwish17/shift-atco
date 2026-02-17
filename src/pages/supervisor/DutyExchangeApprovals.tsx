import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDutyExchanges, useUpdateDutyExchange } from "@/hooks/useDutyExchanges";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeftRight, Calendar, CheckCircle, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";

export default function DutyExchangeApprovals() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: exchanges, isLoading } = useDutyExchanges();
  const updateExchange = useUpdateDutyExchange();

  const [selectedExchange, setSelectedExchange] = useState<any>(null);
  const [comments, setComments] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [action, setAction] = useState<"approve" | "reject">("approve");

  const handleAction = async () => {
    if (!user || !selectedExchange) return;

    const isWSOApproval = selectedExchange.status === "pending_wso";
    const isSupervisorApproval = selectedExchange.status === "pending_supervisor";

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
      await updateExchange.mutateAsync({ id: selectedExchange.id, ...updates });

      toast({
        title: action === "approve" ? "Exchange approved" : "Exchange rejected",
        description: `Duty exchange has been ${action === "approve" ? "approved" : "rejected"}`,
      });

      setDialogOpen(false);
      setComments("");
      setSelectedExchange(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const openApprovalDialog = (exchange: any, actionType: "approve" | "reject") => {
    setSelectedExchange(exchange);
    setAction(actionType);
    setDialogOpen(true);
  };

  const pendingExchanges = exchanges?.filter((e: any) => 
    e.status === "pending_wso" || e.status === "pending_supervisor"
  );
  const approvedExchanges = exchanges?.filter((e: any) => e.status === "approved");
  const rejectedExchanges = exchanges?.filter((e: any) => e.status === "rejected" || e.status === "cancelled");

  if (isLoading) {
    return (
      <DashboardLayout role="supervisor">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  const ExchangeCard = ({ exchange }: { exchange: any }) => (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" />
            Duty Exchange
          </CardTitle>
          <Badge variant={exchange.status.includes("pending") ? "secondary" : exchange.status === "approved" ? "default" : "destructive"}>
            {exchange.status.replace(/_/g, " ").toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Requesting Employee</p>
            <div className="text-sm">
              <p className="font-medium">{exchange.requesting_user?.full_name}</p>
              <p className="text-muted-foreground">{exchange.requesting_user?.employee_id}</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>{format(new Date(exchange.requesting_shift?.shift_date), "dd MMM yyyy")}</span>
            </div>
            <Badge variant="outline">{exchange.requesting_shift?.duty_type}</Badge>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Exchange Partner</p>
            <div className="text-sm">
              <p className="font-medium">{exchange.exchange_partner?.full_name}</p>
              <p className="text-muted-foreground">{exchange.exchange_partner?.employee_id}</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>{format(new Date(exchange.partner_shift?.shift_date), "dd MMM yyyy")}</span>
            </div>
            <Badge variant="outline">{exchange.partner_shift?.duty_type}</Badge>
          </div>
        </div>

        <div className="text-sm">
          <p className="font-medium mb-1">Reason:</p>
          <p className="text-muted-foreground">{exchange.reason}</p>
        </div>

        {exchange.wso_comments && (
          <div className="text-sm bg-secondary/50 p-3 rounded">
            <p className="font-medium mb-1">WSO Comments:</p>
            <p className="text-muted-foreground">{exchange.wso_comments}</p>
          </div>
        )}

        {exchange.supervisor_comments && (
          <div className="text-sm bg-secondary/50 p-3 rounded">
            <p className="font-medium mb-1">Supervisor Comments:</p>
            <p className="text-muted-foreground">{exchange.supervisor_comments}</p>
          </div>
        )}

        {(exchange.status === "pending_wso" || exchange.status === "pending_supervisor") && (
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => openApprovalDialog(exchange, "approve")}
              className="flex-1"
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => openApprovalDialog(exchange, "reject")}
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
          <h1 className="text-3xl font-bold">Duty Exchange Approvals</h1>
          <p className="text-muted-foreground">Review and approve duty exchange requests</p>
        </div>

        <Tabs defaultValue="pending" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pending">
              Pending <Badge className="ml-2">{pendingExchanges?.length || 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4">
            {pendingExchanges?.map((exchange: any) => (
              <ExchangeCard key={exchange.id} exchange={exchange} />
            ))}
            {pendingExchanges?.length === 0 && (
              <Card>
                <CardContent className="text-center py-12 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No pending duty exchange requests</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="approved" className="space-y-4">
            {approvedExchanges?.map((exchange: any) => (
              <ExchangeCard key={exchange.id} exchange={exchange} />
            ))}
            {approvedExchanges?.length === 0 && (
              <Card>
                <CardContent className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No approved exchanges</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="rejected" className="space-y-4">
            {rejectedExchanges?.map((exchange: any) => (
              <ExchangeCard key={exchange.id} exchange={exchange} />
            ))}
            {rejectedExchanges?.length === 0 && (
              <Card>
                <CardContent className="text-center py-12 text-muted-foreground">
                  <XCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No rejected exchanges</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {action === "approve" ? "Approve" : "Reject"} Duty Exchange
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
                  disabled={updateExchange.isPending}
                >
                  {updateExchange.isPending ? "Processing..." : action === "approve" ? "Approve" : "Reject"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
