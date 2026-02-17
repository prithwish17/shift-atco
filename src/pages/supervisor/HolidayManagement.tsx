import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHolidays, useCreateHoliday, useUpdateHoliday, useDeleteHoliday } from "@/hooks/useHolidays";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Calendar as CalendarIcon, Plus, Edit, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Switch } from "@/components/ui/switch";

export default function HolidayManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: holidays, isLoading } = useHolidays();
  const createHoliday = useCreateHoliday();
  const updateHoliday = useUpdateHoliday();
  const deleteHoliday = useDeleteHoliday();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<any>(null);
  const [formData, setFormData] = useState({
    holiday_name: "",
    holiday_date: "",
    category: "",
    comp_off_eligible: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      if (editingHoliday) {
        await updateHoliday.mutateAsync({
          id: editingHoliday.id,
          ...formData,
          category: formData.category as any,
        });
        toast({
          title: "Holiday updated",
          description: "Holiday has been updated successfully",
        });
      } else {
        await createHoliday.mutateAsync({
          ...formData,
          category: formData.category as any,
          created_by: user.id,
        });
        toast({
          title: "Holiday created",
          description: "Holiday has been added successfully",
        });
      }

      setDialogOpen(false);
      setEditingHoliday(null);
      setFormData({
        holiday_name: "",
        holiday_date: "",
        category: "",
        comp_off_eligible: false,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleEdit = (holiday: any) => {
    setEditingHoliday(holiday);
    setFormData({
      holiday_name: holiday.holiday_name,
      holiday_date: holiday.holiday_date,
      category: holiday.category,
      comp_off_eligible: holiday.comp_off_eligible,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this holiday?")) return;

    try {
      await deleteHoliday.mutateAsync(id);
      toast({
        title: "Holiday deleted",
        description: "Holiday has been removed successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getCategoryBadge = (category: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      closed: "destructive",
      reserved: "secondary",
      national: "default",
    };

    return (
      <Badge variant={variants[category] || "default"}>
        {category.toUpperCase()}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <DashboardLayout role="supervisor">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Holiday Management</h1>
            <p className="text-muted-foreground">Manage organizational holidays and comp offs</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => {
                setEditingHoliday(null);
                setFormData({
                  holiday_name: "",
                  holiday_date: "",
                  category: "",
                  comp_off_eligible: false,
                });
              }}>
                <Plus className="h-4 w-4 mr-2" />
                Add Holiday
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingHoliday ? "Edit Holiday" : "Add New Holiday"}</DialogTitle>
                <DialogDescription>
                  {editingHoliday ? "Update holiday information" : "Create a new holiday"}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="holiday_name">Holiday Name</Label>
                  <Input
                    id="holiday_name"
                    value={formData.holiday_name}
                    onChange={(e) =>
                      setFormData({ ...formData, holiday_name: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="holiday_date">Date</Label>
                  <Input
                    id="holiday_date"
                    type="date"
                    value={formData.holiday_date}
                    onChange={(e) =>
                      setFormData({ ...formData, holiday_date: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) =>
                      setFormData({ ...formData, category: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="closed">Closed Holiday</SelectItem>
                      <SelectItem value="reserved">Reserved Holiday</SelectItem>
                      <SelectItem value="national">National Holiday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="comp_off"
                    checked={formData.comp_off_eligible}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, comp_off_eligible: checked })
                    }
                  />
                  <Label htmlFor="comp_off">Compensatory Off Eligible</Label>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createHoliday.isPending || updateHoliday.isPending}>
                    {createHoliday.isPending || updateHoliday.isPending
                      ? "Saving..."
                      : editingHoliday
                      ? "Update"
                      : "Create"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Holidays Calendar</CardTitle>
            <CardDescription>All registered holidays</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {holidays?.map((holiday: any) => (
                <div
                  key={holiday.id}
                  className="flex items-center justify-between border-b pb-4 last:border-0"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {format(new Date(holiday.holiday_date), "dd MMMM yyyy")}
                      </span>
                      {getCategoryBadge(holiday.category)}
                      {holiday.comp_off_eligible && (
                        <Badge variant="outline">Comp Off</Badge>
                      )}
                    </div>
                    <p className="text-lg font-semibold">{holiday.holiday_name}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(holiday)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(holiday.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {holidays?.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <CalendarIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No holidays configured</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
