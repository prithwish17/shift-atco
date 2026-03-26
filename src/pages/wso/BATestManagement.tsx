import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon, Download, Shuffle, FileText, Clock, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile, useUsers } from "@/hooks/useUsers";
import { useCreateBaTest, useBaTests } from "@/hooks/useBaTests";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isUuidLike } from "@/lib/nameMatching";
import {
  normalizeTeamKey,
  getTeamDutyForDateKey,
  getTeamDutyLabel,
  getDutyShiftMatches,
  TEAM_DUTY_BASE,
} from "@/lib/teamDutyRotation";

export default function BATestManagement() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [resaveDialogOpen, setResaveDialogOpen] = useState(false);
  const [viewingTest, setViewingTest] = useState<typeof baTests[number] | null>(null);

  const { user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const { users, isLoading: usersLoading } = useUsers();
  const createBaTest = useCreateBaTest();
  const { data: baTests = [], isLoading: testsLoading } = useBaTests();
  const { toast } = useToast();

  // All known teams derived from TEAM_DUTY_BASE keys (A, B, C, D, E, G)
  const ALL_TEAMS = Object.keys(TEAM_DUTY_BASE).sort();

  const wsoShift = profile?.current_shift || "general";
  const defaultTeam = normalizeTeamKey(wsoShift);
  const [selectedTeam, setSelectedTeam] = useState<string>(defaultTeam);

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const teamDutyToday = getTeamDutyForDateKey(selectedTeam, dateStr);
  const teamDutyLabel = teamDutyToday ? getTeamDutyLabel(teamDutyToday) : selectedTeam;
  const selectedTeamShiftType = selectedTeam.toLowerCase() as "general" | "a" | "b" | "c" | "d" | "e" | "g";

  useEffect(() => {
    setSelectedEmployees([]);
  }, [dateStr, selectedTeam]);

  // Fetch schedule entries for the selected date
  const { data: scheduleEntries = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ["ba-test-schedule", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_schedules" as any)
        .select("employee_code, employee_name, duty_code")
        .eq("duty_date", dateStr);
      if (error) throw error;
      return (data || []) as unknown as Array<{
        employee_code: string;
        employee_name: string;
        duty_code: string;
      }>;
    },
    enabled: !!dateStr,
  });

  const { data: latestGeneratedTest, isLoading: latestGeneratedTestLoading } = useQuery({
    queryKey: ["ba-test-existing", dateStr, selectedTeam],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ba_tests")
        .select("id, test_date, test_time, team_code")
        .eq("test_date", dateStr)
        .eq("team_code", selectedTeam)
        .order("test_time", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!dateStr && !!selectedTeam,
  });

  // Build a lookup from employee_code → user profile
  const usersByCode = useMemo(() => {
    const map = new Map<string, NonNullable<typeof users>[number]>();
    users?.forEach((u) => {
      const code = String(u.employee_id || "").trim().toUpperCase();
      if (code) map.set(code, u);
    });
    return map;
  }, [users]);

  const usersById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof users>[number]>();
    users?.forEach((u) => {
      if (u.id) map.set(u.id, u);
    });
    return map;
  }, [users]);

  // Filter schedule to only employees on WSO's shift for this date
  const onDutyEmployees = useMemo(() => {
    if (!teamDutyToday) return [];
    return scheduleEntries
      .filter((entry) => {
        const matches = getDutyShiftMatches(entry.duty_code);
        return matches.includes(teamDutyToday);
      })
      .map((entry) => {
        const code = entry.employee_code?.trim().toUpperCase() ?? "";
        const profile = usersByCode.get(code);
        return {
          // Use profile id for selections/save; fall back to code if not matched
          id: profile?.id ?? `schedule-${code}`,
          full_name: profile?.full_name ?? entry.employee_name,
          employee_id: profile?.employee_id ?? entry.employee_code,
          designation: profile?.designation ?? "",
        };
      });
  }, [scheduleEntries, teamDutyToday, usersByCode]);

  const runRandomListGeneration = () => {
    const count = Math.max(1, Math.ceil(onDutyEmployees.length * 0.25));
    const shuffled = [...onDutyEmployees].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count);
    setSelectedEmployees(selected.map(e => e.id));
  };

  const generateRandomList = () => {
    if (latestGeneratedTest) {
      setRegenerateDialogOpen(true);
      return;
    }

    runRandomListGeneration();
  };

  const sendBaTestNotifications = async (baTestId?: string) => {
    const recipientIds = selectedEmployees.filter((id) => isUuidLike(id));
    if (!recipientIds.length) return { notified: 0, skipped: selectedEmployees.length };

    const formattedDate = format(selectedDate, "dd MMM yyyy");
    const title = "BA Test Selected";
    const body = `You have been selected for the BA test on ${formattedDate} for Team ${selectedTeam} (${teamDutyLabel} duty). Please check with the WSO.`;

    const payload = {
      user_ids: recipientIds,
      title,
      body,
      url: "/employee",
      category: "ba_test_selected",
      metadata: {
        ba_test_id: baTestId || null,
        test_date: dateStr,
        team_code: selectedTeam,
        shift_type: teamDutyToday,
      },
    };

    let directError: any = null;
    try {
      const { error } = await supabase.functions.invoke("send-notification", {
        body: payload,
      });
      if (!error) {
        return { notified: recipientIds.length, skipped: selectedEmployees.length - recipientIds.length };
      }
      directError = error;
    } catch (err) {
      directError = err;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const base = getFunctionsProxyBaseUrl();
      const res = await fetch(`${base}/api/functions/send-notification`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return { notified: recipientIds.length, skipped: selectedEmployees.length - recipientIds.length };
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          errBody.error ||
          directError?.message ||
          `Notification function failed via proxy: HTTP ${res.status}`,
        );
      }

      throw new Error(
        directError?.message ||
        `Notification function failed via proxy: HTTP ${res.status}`,
      );
    }

    throw directError instanceof Error ? directError : new Error("Failed to send BA test notifications.");
  };

  const saveBaTest = () => {
    if (!user || selectedEmployees.length === 0) return;

    createBaTest.mutate({
      generated_by: user.id,
      selected_users: selectedEmployees,
      shift_type: selectedTeamShiftType,
      team_code: selectedTeam,
      test_date: format(selectedDate, "yyyy-MM-dd"),
      test_time: new Date().toISOString(),
    }, {
      onSuccess: async (savedTest) => {
        toast({ title: "BA Test saved", description: "Test list has been saved successfully." });

        try {
          const result = await sendBaTestNotifications(savedTest?.id);
          if (result.notified > 0) {
            toast({
              title: "BA notifications sent",
              description: `Sent push and in-app notifications to ${result.notified} selected employee${result.notified === 1 ? "" : "s"}.`,
            });
          }
          if (result.skipped > 0) {
            toast({
              title: "Some notifications skipped",
              description: `${result.skipped} selected employee${result.skipped === 1 ? " was" : "s were"} skipped because no linked user account was available.`,
              variant: "destructive",
            });
          }
        } catch (notifyErr: any) {
          toast({
            title: "BA test saved but notification failed",
            description: notifyErr?.message || "The BA test was saved, but notifications could not be sent.",
            variant: "destructive",
          });
        }
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });
  };

  const handleSaveTest = () => {
    if (latestGeneratedTest) {
      setResaveDialogOpen(true);
      return;
    }

    saveBaTest();
  };

  const exportBaTestPdf = async ({
    employees,
    testDate,
    teamCode,
    shiftLabel,
    testTime,
  }: {
    employees: Array<{ full_name: string; employee_id: string }>;
    testDate: Date;
    teamCode: string;
    shiftLabel: string;
    testTime: Date;
  }) => {
    if (employees.length === 0) return;

    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("BA Test List", 20, 20);
    doc.setFontSize(12);
    doc.text(`Date: ${format(testDate, "MMMM d, yyyy")}`, 20, 30);
    doc.text(`Shift: ${shiftLabel} (Team ${teamCode})`, 20, 38);
    doc.text(`Time: ${format(testTime, "hh:mm a")}`, 20, 46);

    doc.setFontSize(10);
    let y = 60;
    employees.forEach((emp, i) => {
      doc.text(`${i + 1}. ${emp.full_name} (${emp.employee_id})`, 20, y);
      y += 8;
    });

    doc.save(`BA_Test_Team_${teamCode}_${format(testDate, "yyyy-MM-dd")}.pdf`);
  };

  const handleDownloadPDF = async () => {
    const selected = onDutyEmployees.filter(e => selectedEmployees.includes(e.id));
    if (selected.length === 0) return;

    await exportBaTestPdf({
      employees: selected.map((emp) => ({
        full_name: emp.full_name,
        employee_id: emp.employee_id,
      })),
      testDate: selectedDate,
      teamCode: selectedTeam,
      shiftLabel: teamDutyLabel,
      testTime: new Date(),
    });
  };

  const handleDownloadHistoryPDF = async () => {
    if (!viewingTest) return;

    const historyDutyKey = getTeamDutyForDateKey(viewingTest.team_code || "", viewingTest.test_date);
    const historyShiftLabel = historyDutyKey ? getTeamDutyLabel(historyDutyKey) : viewingTest.shift_type.toUpperCase();
    const historyEmployees = viewingTest.selected_users.map((uid) => {
      const matched = usersById.get(uid);
      return {
        full_name: matched?.full_name || uid,
        employee_id: matched?.employee_id || "-",
      };
    });

    await exportBaTestPdf({
      employees: historyEmployees,
      testDate: new Date(viewingTest.test_date),
      teamCode: viewingTest.team_code || viewingTest.shift_type.toUpperCase(),
      shiftLabel: historyShiftLabel,
      testTime: new Date(viewingTest.test_time),
    });
  };

  const toggleEmployee = (id: string) => {
    setSelectedEmployees(prev => prev.includes(id) ? prev.filter(eid => eid !== id) : [...prev, id]);
  };

  const isLoading = usersLoading || scheduleLoading;

  return (
    <DashboardLayout role="wso">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">BA Test Management</h1>
            <p className="text-muted-foreground">Generate and manage breath analyzer tests - {teamDutyLabel} Shift · {format(selectedDate, "dd MMM yyyy")} · Team {selectedTeam}</p>
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
                <label className="text-sm font-medium">Team</label>
                <Select
                  value={selectedTeam}
                  onValueChange={(val) => {
                    setSelectedTeam(val);
                    setSelectedEmployees([]);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_TEAMS.map((team) => (
                      <SelectItem key={team} value={team}>
                        Team {team}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

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

              <div className="p-4 border rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">On Duty ({teamDutyLabel})</span>
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
                <Button onClick={generateRandomList} className="flex-1" disabled={onDutyEmployees.length === 0 || latestGeneratedTestLoading}>
                  <Shuffle className="mr-2 h-4 w-4" />
                  Generate Random List
                </Button>
                <Button variant="outline" onClick={handleDownloadPDF} disabled={selectedEmployees.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
              </div>
              {selectedEmployees.length > 0 && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={handleSaveTest}
                  disabled={createBaTest.isPending || latestGeneratedTestLoading}
                >
                  {createBaTest.isPending ? "Saving..." : "Save Test to History"}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Selected for BA Test
                {selectedEmployees.length > 0 && (
                  <Badge className="ml-auto">{selectedEmployees.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedEmployees.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No employees selected yet — use Generate Random List or pick manually below
                </p>
              ) : (
                <ol className="space-y-1">
                  {onDutyEmployees
                    .filter((e) => selectedEmployees.includes(e.id))
                    .map((emp, idx) => (
                      <li
                        key={emp.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 text-sm"
                      >
                        <span className="w-5 shrink-0 text-right text-muted-foreground font-mono text-xs">{idx + 1}.</span>
                        <span className="font-medium truncate">{emp.full_name}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{emp.employee_id}</span>
                      </li>
                    ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>On-Duty Employees — {teamDutyLabel} Shift · Team {selectedTeam} · {format(selectedDate, "dd MMM yyyy")}</CardTitle>
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

        {/* ── Test History ────────────────────────────────────────── */}
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
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : baTests.length > 0 ? (
              <div className="divide-y">
                {baTests.map((test, index) => {
                  const dutyLabel = getTeamDutyForDateKey(test.team_code || "", test.test_date);
                  const shiftText = dutyLabel ? getTeamDutyLabel(dutyLabel) : test.shift_type.toUpperCase();
                  return (
                    <div key={test.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className="w-6 shrink-0 text-right text-xs font-mono text-muted-foreground">{index + 1}.</span>
                      <Badge variant="outline" className="shrink-0">Team {test.team_code || test.shift_type.toUpperCase()}</Badge>
                      <span className="text-muted-foreground">{format(new Date(test.test_date), "dd MMM yyyy")}</span>
                      <span className="hidden sm:inline text-muted-foreground">·</span>
                      <span className="hidden sm:inline">{shiftText}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{format(new Date(test.test_time), "hh:mm a")}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-medium">{test.selected_users.length} emp</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-7 w-7 shrink-0"
                        onClick={() => setViewingTest(test)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No test history yet</p>
            )}
          </CardContent>
        </Card>

        {/* ── View Selected Employees Dialog ──────────────────────── */}
        <Dialog open={!!viewingTest} onOpenChange={(open) => !open && setViewingTest(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                BA Test — Team {viewingTest?.team_code || viewingTest?.shift_type.toUpperCase()}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {viewingTest && format(new Date(viewingTest.test_date), "dd MMM yyyy")}
                {" · "}
                {viewingTest && format(new Date(viewingTest.test_time), "hh:mm a")}
              </p>
            </DialogHeader>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handleDownloadHistoryPDF} disabled={!viewingTest?.selected_users.length}>
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </Button>
            </div>
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {viewingTest?.selected_users.map((uid, idx) => {
                const matched = usersById.get(uid);
                return (
                  <div key={uid} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 text-sm">
                    <span className="w-5 shrink-0 text-right text-muted-foreground font-mono text-xs">{idx + 1}.</span>
                    <span className="font-medium truncate">{matched?.full_name || uid}</span>
                    {matched?.employee_id && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{matched.employee_id}</span>
                    )}
                  </div>
                );
              })}
              {(!viewingTest?.selected_users.length) && (
                <p className="text-sm text-muted-foreground text-center py-4">No employees recorded</p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={regenerateDialogOpen} onOpenChange={setRegenerateDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>BA List Already Generated</AlertDialogTitle>
              <AlertDialogDescription>
                {latestGeneratedTest
                  ? `A BA list was already generated on ${format(new Date(latestGeneratedTest.test_date), "dd MMMM yyyy")} at ${format(new Date(latestGeneratedTest.test_time), "hh:mm a")} for Team ${selectedTeam}. Are you sure you want to generate the list again?`
                  : `A BA list was already generated for Team ${selectedTeam} on this date. Are you sure you want to generate the list again?`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  runRandomListGeneration();
                  setRegenerateDialogOpen(false);
                }}
              >
                Generate Again
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={resaveDialogOpen} onOpenChange={setResaveDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>BA Test Already Saved</AlertDialogTitle>
              <AlertDialogDescription>
                {latestGeneratedTest
                  ? `A BA list was already saved on ${format(new Date(latestGeneratedTest.test_date), "dd MMMM yyyy")} at ${format(new Date(latestGeneratedTest.test_time), "hh:mm a")} for Team ${selectedTeam}. Are you sure you want to save another list for the same team and date?`
                  : `A BA list was already saved for Team ${selectedTeam} on this date. Are you sure you want to save another list?`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  saveBaTest();
                  setResaveDialogOpen(false);
                }}
              >
                Save Again
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
