import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDutyExchanges, useCreateDutyExchange } from "@/hooks/useDutyExchanges";
import { useShifts } from "@/hooks/useShifts";
import { useUsers } from "@/hooks/useUsers";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Calendar, ArrowLeftRight, CheckCircle, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";

export default function DutyExchangeRequest() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: exchanges, isLoading: exchangesLoading } = useDutyExchanges(user?.id);
  const { shifts: myShifts } = useShifts(user?.id);
  const { users } = useUsers();
  const createExchange = useCreateDutyExchange();

  const [formData, setFormData] = useState({
    my_shift_id: "",
    partner_id: "",
    partner_shift_id: "",
    reason: "",
  });

  const selectedPartner = users?.find((u: any) => u.id === formData.partner_id);
  const { shifts: partnerShifts } = useShifts(formData.partner_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) return;

    try {
      await createExchange.mutateAsync({
        requesting_user_id: user.id,
        exchange_partner_id: formData.partner_id,
        requesting_user_shift_id: formData.my_shift_id,
        exchange_partner_shift_id: formData.partner_shift_id,
        reason: formData.reason,
      });

      toast({
        title: "Exchange request submitted",
        description: "Your duty exchange request has been submitted for approval",
      });

      setFormData({
        my_shift_id: "",
        partner_id: "",
        partner_shift_id: "",
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
      case "cancelled":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Clock className="h-4 w-4 text-warning" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      approved: "default",
      rejected: "destructive",
      cancelled: "destructive",
      pending_wso: "secondary",
      pending_supervisor: "secondary",
    };

    return (
      <Badge variant={variants[status] || "secondary"}>
        {status.replace(/_/g, " ").toUpperCase()}
      </Badge>
    );
  };

  if (exchangesLoading) {
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
          <h1 className="text-3xl font-bold">Duty Exchange</h1>
          <p className="text-muted-foreground">Request duty exchanges with colleagues</p>
        </div>

        {/* Exchange Request Form */}
        <Card>
          <CardHeader>
            <CardTitle>Request Duty Exchange</CardTitle>
            <CardDescription>Submit a new duty exchange request</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="my_shift">Your Duty to Exchange</Label>
                <Select
                  value={formData.my_shift_id}
                  onValueChange={(value) =>
                    setFormData({ ...formData, my_shift_id: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select your duty" />
                  </SelectTrigger>
                  <SelectContent>
                    {myShifts?.map((shift: any) => (
                      <SelectItem key={shift.id} value={shift.id}>
                        {format(new Date(shift.shift_date), "dd MMM yyyy")} -{" "}
                        {shift.duty_type} ({shift.shift_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="partner">Exchange Partner</Label>
                <Select
                  value={formData.partner_id}
                  onValueChange={(value) =>
                    setFormData({ ...formData, partner_id: value, partner_shift_id: "" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select exchange partner" />
                  </SelectTrigger>
                  <SelectContent>
                    {users
                      ?.filter((u: any) => u.id !== user?.id)
                      .map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.full_name} ({u.employee_id})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {formData.partner_id && (
                <div className="space-y-2">
                  <Label htmlFor="partner_shift">Partner's Duty</Label>
                  <Select
                    value={formData.partner_shift_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, partner_shift_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select partner's duty" />
                    </SelectTrigger>
                    <SelectContent>
                      {partnerShifts?.map((shift: any) => (
                        <SelectItem key={shift.id} value={shift.id}>
                          {format(new Date(shift.shift_date), "dd MMM yyyy")} -{" "}
                          {shift.duty_type} ({shift.shift_type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="reason">Reason for Exchange</Label>
                <Textarea
                  id="reason"
                  value={formData.reason}
                  onChange={(e) =>
                    setFormData({ ...formData, reason: e.target.value })
                  }
                  placeholder="Enter reason for duty exchange..."
                  required
                />
              </div>

              <Button type="submit" disabled={createExchange.isPending}>
                {createExchange.isPending ? "Submitting..." : "Submit Request"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Exchange History */}
        <Card>
          <CardHeader>
            <CardTitle>Exchange Requests</CardTitle>
            <CardDescription>Your duty exchange request history</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {exchanges?.map((exchange: any) => (
                <div
                  key={exchange.id}
                  className="flex items-start justify-between border-b pb-4 last:border-0"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {exchange.requesting_user?.full_name}
                      </span>
                      <ArrowLeftRight className="h-4 w-4" />
                      <span className="font-medium">
                        {exchange.exchange_partner?.full_name}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>
                        Your duty: {format(new Date(exchange.requesting_shift?.shift_date), "dd MMM yyyy")} - {exchange.requesting_shift?.duty_type}
                      </p>
                      <p>
                        Partner's duty: {format(new Date(exchange.partner_shift?.shift_date), "dd MMM yyyy")} - {exchange.partner_shift?.duty_type}
                      </p>
                      <p className="italic">Reason: {exchange.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(exchange.status)}
                    {getStatusBadge(exchange.status)}
                  </div>
                </div>
              ))}
              {exchanges?.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <ArrowLeftRight className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No duty exchange requests found</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
