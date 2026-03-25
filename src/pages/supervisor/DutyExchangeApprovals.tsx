import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDutyExchanges, useProcessExchangeApproval, useExchangeApprovals } from "@/hooks/useDutyExchanges";
import { DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeftRight, Calendar, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";

type ApprovalPortalRole = "supervisor" | "wso";

function getDutyLabel(dutyType?: string | null) {
  const normalized = dutyType?.trim().toUpperCase() || "";
  if (!normalized) return "Unknown Duty";
  if (normalized === "OFF") return "Off Duty";
  if (normalized === "OPE") return "Operational Duty";
  return DUTY_DESCRIPTIONS[normalized] || normalized;
}

function ApprovalSteps({ requestId }: { requestId: string }) {
  const { data: steps, isLoading } = useExchangeApprovals(requestId);
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!steps?.length) return null;

  const LABELS: Record<number, string> = { 1: "Partner", 2: "Requester WSO", 3: "Partner WSO", 4: "Supervisor" };

  return (
    <div className="mt-3 space-y-1.5">
      {steps.map((s) => (
        <div key={s.id} className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
          s.status === "approved" ? "border-emerald-200 bg-emerald-50/60" : s.status === "rejected" ? "border-red-200 bg-red-50/60" : "border-slate-200 bg-slate-50/60"
        )}>
          {s.status === "approved" ? <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> : s.status === "rejected" ? <XCircle className="h-3.5 w-3.5 text-red-600" /> : <Clock className="h-3.5 w-3.5 text-slate-400" />}
          <span className="font-medium">{LABELS[s.sequence_order] || `Step ${s.sequence_order}`}</span>
          <span className="text-muted-foreground">· {s.approver_name || "Pending"}</span>
          {s.action_at && <span className="text-muted-foreground ml-auto">{format(new Date(s.action_at), "dd MMM, HH:mm")}</span>}
        </div>
      ))}
    </div>
  );
}

export default function DutyExchangeApprovals({ portalRole = "supervisor" }: { portalRole?: ApprovalPortalRole }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: exchanges, isLoading, refetch: refetchExchanges } = useDutyExchanges();
  const processApproval = useProcessExchangeApproval();

  const [selectedExchange, setSelectedExchange] = useState<any>(null);
  const [comments, setComments] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const pageTitle = portalRole === "wso" ? "Duty Exchange Review" : "Duty Exchange Approvals";
  const pageDescription = portalRole === "wso"
    ? "Review duty exchange requests that require WSO action"
    : "Review and approve duty exchange requests";
  const actionablePendingStatus = portalRole === "wso" ? "pending_wso" : "pending_supervisor";

  // Direct approve — no dialog needed
  const handleApprove = async (exchange: any) => {
    if (!user) return;
    setApprovingId(exchange.id);
    try {
      await processApproval.mutateAsync({
        request_id: exchange.id,
        approver_id: user.id,
        action: "approve",
      });
      await refetchExchanges();

      toast({
        title: "Exchange approved",
        description: "Duty exchange has been approved at your level.",
      });

      // Notify both parties
      const dutyDate = exchange.duty_date
        ? format(new Date(exchange.duty_date), "dd MMM yyyy")
        : "";
      supabase.functions.invoke("send-notification", {
        body: {
          user_ids: [exchange.requesting_user_id, exchange.exchange_partner_id].filter(Boolean),
          title: "Duty Exchange Approved",
          body: `Your duty exchange${dutyDate ? " for " + dutyDate : ""} has been approved.`,
          url: "/employee",
          category: "duty_exchange",
          metadata: { exchange_id: exchange.id },
        },
      }).catch(() => {});
    } catch (error: any) {
      const msg = error?.message || "Something went wrong";
      toast({
        title: "Error",
        description: msg.includes("different WSO")
          ? "This step is assigned to the other team's WSO."
          : msg,
        variant: "destructive",
      });
    } finally {
      setApprovingId(null);
    }
  };

  // Reject — opens dialog to capture remarks
  const handleRejectSubmit = async () => {
    if (!user || !selectedExchange) return;
    try {
      await processApproval.mutateAsync({
        request_id: selectedExchange.id,
        approver_id: user.id,
        action: "reject",
        remarks: comments || undefined,
      });

      toast({
        title: "Exchange rejected",
        description: "Duty exchange has been rejected at your level.",
      });

      setRejectDialogOpen(false);
      setComments("");
      setSelectedExchange(null);
      await refetchExchanges();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const openRejectDialog = (exchange: any) => {
    setSelectedExchange(exchange);
    setRejectDialogOpen(true);
  };

  const pendingExchanges = exchanges?.filter((e: any) => {
    if (e.status !== actionablePendingStatus) return false;
    // For WSO: show exchanges where THIS WSO has a pending step, already approved,
    // or there's an unassigned WSO step (NULL approver_id = any WSO can act)
    if (portalRole === "wso") {
      // If any WSO step has no assigned approver, show to all WSOs
      if (e.has_unassigned_wso_step) return true;
      const pendingIds: string[] = e.pending_wso_approver_ids || [];
      const approvedIds: string[] = e.approved_wso_approver_ids || [];
      const isRelevant = pendingIds.includes(user?.id) || approvedIds.includes(user?.id);
      if ((pendingIds.length > 0 || approvedIds.length > 0) && !isRelevant) {
        return false;
      }
    }
    return true;
  });
  const approvedExchanges = exchanges?.filter((e: any) => e.status === "approved" || e.status === "completed");
  const rejectedExchanges = exchanges?.filter((e: any) => e.status === "rejected" || e.status === "cancelled");

  if (isLoading) {
    return (
      <DashboardLayout role={portalRole}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  const ExchangeCard = ({ exchange }: { exchange: any }) => {
    const isExpanded = expandedId === exchange.id;
    const isPending = exchange.status === actionablePendingStatus;
    // Check if this WSO already approved their step (exchange still pending_wso, waiting for other WSO)
    // But if there's an unassigned step, the WSO can still act on it
    const thisWsoAlreadyApproved = portalRole === "wso"
      && isPending
      && (exchange.approved_wso_approver_ids || []).includes(user?.id)
      && !(exchange.pending_wso_approver_ids || []).includes(user?.id)
      && !exchange.has_unassigned_wso_step;

    return (
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              Duty Exchange
              {exchange.duty_date && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  — {format(new Date(exchange.duty_date), "dd MMM yyyy")}
                </span>
              )}
            </CardTitle>
            <Badge variant={isPending ? "secondary" : exchange.status === "approved" || exchange.status === "completed" ? "default" : "destructive"}>
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
              {(exchange.requesting_shift || exchange.requesting_schedule) ? (
                <>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>{format(new Date(exchange.requesting_shift?.shift_date || exchange.duty_date), "dd MMM yyyy")}</span>
                  </div>
                  <Badge variant="outline">{getDutyLabel(exchange.requesting_schedule?.duty_code || exchange.requesting_shift?.duty_type)}</Badge>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No duty data</p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Exchange Partner</p>
              <div className="text-sm">
                <p className="font-medium">{exchange.exchange_partner?.full_name}</p>
                <p className="text-muted-foreground">{exchange.exchange_partner?.employee_id}</p>
              </div>
              {(exchange.partner_shift || exchange.partner_schedule) ? (
                <>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>{format(new Date(exchange.partner_shift?.shift_date || exchange.duty_date), "dd MMM yyyy")}</span>
                  </div>
                  <Badge variant="outline">{getDutyLabel(exchange.partner_schedule?.duty_code || exchange.partner_shift?.duty_type)}</Badge>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No duty data</p>
              )}
            </div>
          </div>

          <div className="text-sm">
            <p className="font-medium mb-1">Reason:</p>
            <p className="text-muted-foreground">{exchange.reason}</p>
          </div>

          {/* Expandable approval timeline */}
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setExpandedId(isExpanded ? null : exchange.id)}
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {isExpanded ? "Hide" : "Show"} Approval Steps
          </button>

          {isExpanded && <ApprovalSteps requestId={exchange.id} />}

          {isPending && thisWsoAlreadyApproved && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span>You have approved this exchange. Waiting for the other team's WSO to approve.</span>
            </div>
          )}

          {isPending && !thisWsoAlreadyApproved && (
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                variant="default"
                onClick={() => handleApprove(exchange)}
                disabled={approvingId !== null}
                className="flex-1"
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                {approvingId === exchange.id ? "Approving…" : "Approve"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => openRejectDialog(exchange)}
                disabled={approvingId !== null}
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
  };

  return (
    <DashboardLayout role={portalRole}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{pageTitle}</h1>
          <p className="text-muted-foreground">{pageDescription}</p>
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
                  <p>{portalRole === "wso" ? "No duty exchange requests pending WSO review" : "No duty exchange requests pending supervisor review"}</p>
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

        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Duty Exchange</DialogTitle>
              <DialogDescription>
                Optionally add a reason for rejection (visible to both employees).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Reason for rejection (optional)..."
                rows={4}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRejectSubmit}
                  disabled={processApproval.isPending}
                >
                  {processApproval.isPending ? "Rejecting…" : "Confirm Reject"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
