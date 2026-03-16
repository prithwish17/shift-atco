import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, Download, Shuffle, FileText, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile, useUsers } from "@/hooks/useUsers";
import { useBaTests, useCreateBaTest } from "@/hooks/useBaTests";
import { useToast } from "@/hooks/use-toast";

export default function BATestManagement() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);

  const { user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const { users, isLoading: usersLoading } = useUsers();
  const { data: baTests, isLoading: testsLoading } = useBaTests();
  const createBaTest = useCreateBaTest();
  const { toast } = useToast();

  const wsoShift = profile?.current_shift || "general";
  const onDutyEmployees = users?.filter(u => u.approved && u.current_shift === wsoShift) || [];

  const generateRandomList = () => {
    const count = Math.max(1, Math.ceil(onDutyEmployees.length * 0.25));
    const shuffled = [...onDutyEmployees].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count);
    setSelectedEmployees(selected.map(e => e.id));
  };

  const handleSaveTest = () => {
    if (!user || selectedEmployees.length === 0) return;

    createBaTest.mutate({
      generated_by: user.id,
      selected_users: selectedEmployees,
      shift_type: wsoShift as any,
      test_date: format(selectedDate, "yyyy-MM-dd"),
      test_time: new Date().toISOString(),
    }, {
      onSuccess: () => {
        toast({ title: "BA Test saved", description: "Test list has been saved successfully." });
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });
  };

  const handleDownloadPDF = async () => {
    const selected = onDutyEmployees.filter(e => selectedEmployees.includes(e.id));
    if (selected.length === 0) return;

    // Dynamic import — only loads jspdf when the user clicks Download
    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("BA Test List", 20, 20);
    doc.setFontSize(12);
    doc.text(`Date: ${format(selectedDate, "MMMM d, yyyy")}`, 20, 30);
    doc.text(`Shift: ${wsoShift.toUpperCase()}`, 20, 38);
    doc.text(`Time: ${format(new Date(), "hh:mm a")}`, 20, 46);

    doc.setFontSize(10);
    let y = 60;
    selected.forEach((emp, i) => {
      doc.text(`${i + 1}. ${emp.full_name} (${emp.employee_id})`, 20, y);
      y += 8;
    });

    doc.save(`BA_Test_${format(selectedDate, "yyyy-MM-dd")}.pdf`);
  };

  const toggleEmployee = (id: string) => {
    setSelectedEmployees(prev => prev.includes(id) ? prev.filter(eid => eid !== id) : [...prev, id]);
  };

  const isLoading = usersLoading || testsLoading;

  return (
    <DashboardLayout role="wso">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">BA Test Management</h1>
            <p className="text-muted-foreground">Generate and manage breath analyzer tests - {wsoShift.toUpperCase()} Shift</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Test Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Test Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(selectedDate, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={selectedDate} onSelect={(date) => date && setSelectedDate(date)} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="p-4 bg-accent rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">On Duty ({wsoShift.toUpperCase()})</span>
                  <span className="font-medium">{onDutyEmployees.length} employees</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Required Tests (25%)</span>
                  <span className="font-medium">{Math.max(1, Math.ceil(onDutyEmployees.length * 0.25))} employees</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Currently Selected</span>
                  <span className="font-medium">{selectedEmployees.length} employees</span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={generateRandomList} className="flex-1" disabled={onDutyEmployees.length === 0}>
                  <Shuffle className="mr-2 h-4 w-4" />
                  Generate Random List
                </Button>
                <Button variant="outline" onClick={handleDownloadPDF} disabled={selectedEmployees.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
              </div>
              {selectedEmployees.length > 0 && (
                <Button variant="secondary" className="w-full" onClick={handleSaveTest} disabled={createBaTest.isPending}>
                  {createBaTest.isPending ? "Saving..." : "Save Test to History"}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Test History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {testsLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : baTests && baTests.length > 0 ? (
                <div className="space-y-2">
                  {baTests.slice(0, 5).map((test) => (
                    <div key={test.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                      <div>
                        <p className="font-medium">{format(new Date(test.test_date), "MMMM d, yyyy")}</p>
                        <p className="text-sm text-muted-foreground">
                          {test.selected_users.length} employees · {test.shift_type.toUpperCase()}
                        </p>
                      </div>
                      <Badge className={test.completed ? "bg-green-600" : ""} variant={test.completed ? "default" : "outline"}>
                        {test.completed ? "Completed" : "Pending"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No test history yet</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>On-Duty Employees - {wsoShift.toUpperCase()} Shift</CardTitle>
            <p className="text-sm text-muted-foreground">
              {selectedEmployees.length > 0
                ? "Selected employees highlighted - You can manually adjust the selection"
                : "Select employees for BA test or generate a random list"}
            </p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid gap-3 md:grid-cols-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : onDutyEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No employees found for this shift
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {onDutyEmployees.map((employee) => (
                  <div
                    key={employee.id}
                    className={cn(
                      "flex items-center justify-between p-4 border rounded-lg cursor-pointer transition-colors",
                      selectedEmployees.includes(employee.id) ? "bg-primary/10 border-primary" : "hover:bg-accent"
                    )}
                    onClick={() => toggleEmployee(employee.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox checked={selectedEmployees.includes(employee.id)} />
                      <div>
                        <p className="font-medium">{employee.full_name}</p>
                        <p className="text-sm text-muted-foreground">{employee.employee_id}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">{employee.designation || "—"}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedEmployees.length > 0 && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle>Selected for BA Test - {format(selectedDate, "MMMM d, yyyy")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {onDutyEmployees
                  .filter(e => selectedEmployees.includes(e.id))
                  .map((employee, index) => (
                    <div key={employee.id} className="flex items-center justify-between p-3 bg-accent rounded-lg">
                      <div className="flex items-center gap-4">
                        <span className="font-bold text-lg text-muted-foreground">#{index + 1}</span>
                        <div>
                          <p className="font-medium">{employee.full_name}</p>
                          <p className="text-sm text-muted-foreground">{employee.employee_id}</p>
                        </div>
                      </div>
                      <span className="text-sm text-muted-foreground">{format(new Date(), "hh:mm a")}</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
