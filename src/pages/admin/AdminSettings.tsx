import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Settings, Save, Loader2 } from "lucide-react";

const DEFAULT_TRAINING_DATA_URL = "https://script.google.com/macros/s/AKfycbzkGpqGjRkvOPAOOsDsjnjPz1FIU0ceRLAv2xsogsKkozKClZTL1WsPnRPvdduaIouS/exec";

interface AppSetting {
    key: string;
    value: string;
    label: string | null;
    updated_at: string;
}

export default function AdminSettings() {
    const { toast } = useToast();
    const qc = useQueryClient();
    const [rosterUrl, setRosterUrl] = useState("");
    const [scheduleUrl, setScheduleUrl] = useState("");
    const [leaveUrl, setLeaveUrl] = useState("");
    const [trainingUrl, setTrainingUrl] = useState(DEFAULT_TRAINING_DATA_URL);
    const [elpaUrl, setElpaUrl] = useState("");
    const [medicalUrl, setMedicalUrl] = useState("");
    const [ratingUrl, setRatingUrl] = useState("");
    const [atcoMasterUrl, setAtcoMasterUrl] = useState("");
    const [traineeUrl, setTraineeUrl] = useState("");
    const [ojtUrl, setOjtUrl] = useState("");
    const [elUrl, setElUrl] = useState("");
    const [teamCodeUrl, setTeamCodeUrl] = useState("");
    const [employeeDataUrl, setEmployeeDataUrl] = useState("");
    const [workingHoursExportUrl, setWorkingHoursExportUrl] = useState("");
    const [auditLogUrl, setAuditLogUrl] = useState("");
    const [baTestSheetUrl, setBaTestSheetUrl] = useState("");

    const { data: settings, isLoading } = useQuery({
        queryKey: ["app-settings"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("app_settings" as any)
                .select("*");
            if (error) throw error;
            return (data || []) as unknown as AppSetting[];
        },
    });

    // Initialize form values from fetched settings
    useEffect(() => {
        if (settings) {
            const roster = settings.find((s) => s.key === "roster_webapp_url");
            const schedule = settings.find((s) => s.key === "schedule_webapp_url");
            const leave = settings.find((s) => s.key === "leave_data_webapp_url");
            const training = settings.find((s) => s.key === "training_data_webapp_url");
            if (roster) setRosterUrl(roster.value);
            if (schedule) setScheduleUrl(schedule.value);
            if (leave) setLeaveUrl(leave.value);
            if (training) setTrainingUrl(training.value);
            const elpa = settings.find((s) => s.key === "elpa_data_webapp_url");
            if (elpa) setElpaUrl(elpa.value);
            const medical = settings.find((s) => s.key === "medical_data_webapp_url");
            if (medical) setMedicalUrl(medical.value);
            const rating = settings.find((s) => s.key === "rating_data_webapp_url");
            if (rating) setRatingUrl(rating.value);
            const trainee = settings.find((s) => s.key === "trainee_data_webapp_url");
            if (trainee) setTraineeUrl(trainee.value);
            const ojt = settings.find((s) => s.key === "ojt_data_webapp_url");
            if (ojt) setOjtUrl(ojt.value);
            const el = settings.find((s) => s.key === "el_data_webapp_url");
            if (el) setElUrl(el.value);
            const teamCode = settings.find((s) => s.key === "team_code_webapp_url");
            if (teamCode) setTeamCodeUrl(teamCode.value);
            const employeeData = settings.find((s) => s.key === "employee_data_webapp_url");
            if (employeeData) setEmployeeDataUrl(employeeData.value);
            const workingHoursExport = settings.find((s) => s.key === "working_hours_export_webapp_url");
            if (workingHoursExport) setWorkingHoursExportUrl(workingHoursExport.value);
            const auditLog = settings.find((s) => s.key === "supervisor_audit_log_webapp_url");
            if (auditLog) setAuditLogUrl(auditLog.value);
            const baTest = settings.find((s) => s.key === "ba_test_sheet_url");
            if (baTest) setBaTestSheetUrl(baTest.value);
            const atcoMaster = settings.find((s) => s.key === "atco_master_webapp_url");
            if (atcoMaster) setAtcoMasterUrl(atcoMaster.value);
        }
    }, [settings]);

    const updateSetting = useMutation({
        mutationFn: async ({ key, value, label }: { key: string; value: string; label: string }) => {
            const { error } = await supabase
                .from("app_settings" as any)
                .upsert(
                    { key, value, label, updated_at: new Date().toISOString() } as any,
                    { onConflict: "key" }
                );
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["app-settings"] });
            toast({ title: "Setting saved", description: "The setting has been updated successfully." });
        },
        onError: (err: any) => {
            toast({ title: "Error", description: err.message || "Failed to save setting", variant: "destructive" });
        },
    });

    const handleSaveRosterUrl = () => {
        if (!rosterUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "roster_webapp_url",
            value: rosterUrl.trim(),
            label: "Roster Sync Webapp URL",
        });
    };

    const handleSaveScheduleUrl = () => {
        if (!scheduleUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "schedule_webapp_url",
            value: scheduleUrl.trim(),
            label: "Schedule Sync Webapp URL",
        });
    };

    const handleSaveLeaveUrl = () => {
        if (!leaveUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "leave_data_webapp_url",
            value: leaveUrl.trim(),
            label: "Leave Sync Webapp URL",
        });
    };

    const handleSaveTrainingUrl = () => {
        if (!trainingUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "training_data_webapp_url",
            value: trainingUrl.trim(),
            label: "Training Data Webapp URL",
        });
    };

    const handleSaveElpaUrl = () => {
        if (!elpaUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "elpa_data_webapp_url",
            value: elpaUrl.trim(),
            label: "ELPA Data Webapp URL",
        });
    };

    const handleSaveMedicalUrl = () => {
        if (!medicalUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "medical_data_webapp_url",
            value: medicalUrl.trim(),
            label: "Medical Data Webapp URL",
        });
    };

    const handleSaveAtcoMasterUrl = () => {
        if (!atcoMasterUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "atco_master_webapp_url",
            value: atcoMasterUrl.trim(),
            label: "ATCO Master Webapp URL",
        });
    };

    const handleSaveRatingUrl = () => {
        if (!ratingUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "rating_data_webapp_url",
            value: ratingUrl.trim(),
            label: "Rating Data Webapp URL",
        });
    };

    const handleSaveTraineeUrl = () => {
        if (!traineeUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "trainee_data_webapp_url",
            value: traineeUrl.trim(),
            label: "Trainee Data Webapp URL",
        });
    };

    const handleSaveOjtUrl = () => {
        if (!ojtUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "ojt_data_webapp_url",
            value: ojtUrl.trim(),
            label: "OJT Progress Data Webapp URL",
        });
    };

    const handleSaveElUrl = () => {
        if (!elUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "el_data_webapp_url",
            value: elUrl.trim(),
            label: "Earned Leave Data Webapp URL",
        });
    };

    const handleSaveTeamCodeUrl = () => {
        if (!teamCodeUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "team_code_webapp_url",
            value: teamCodeUrl.trim(),
            label: "Team Code Sync Webapp URL",
        });
    };

    const handleSaveEmployeeDataUrl = () => {
        if (!employeeDataUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "employee_data_webapp_url",
            value: employeeDataUrl.trim(),
            label: "Employee Data Webapp URL",
        });
    };

    const handleSaveWorkingHoursExportUrl = () => {
        if (!workingHoursExportUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "working_hours_export_webapp_url",
            value: workingHoursExportUrl.trim(),
            label: "Working Hours Export Webapp URL",
        });
    };

    const handleSaveBaTestSheetUrl = () => {
        if (!baTestSheetUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "ba_test_sheet_url",
            value: baTestSheetUrl.trim(),
            label: "BA Test List Google Sheet URL",
        });
    };

    const handleSaveAuditLogUrl = () => {
        if (!auditLogUrl.trim()) {
            toast({ title: "Error", description: "URL cannot be empty", variant: "destructive" });
            return;
        }
        updateSetting.mutate({
            key: "supervisor_audit_log_webapp_url",
            value: auditLogUrl.trim(),
            label: "Supervisor Audit Log Webapp URL",
        });
    };

    return (
        <DashboardLayout role="admin">
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Settings className="h-8 w-8" />
                        System Settings
                    </h1>
                    <p className="text-muted-foreground">
                        Configure application-wide settings
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Google Sheets Integration</CardTitle>
                        <CardDescription>
                            Configure the Google Apps Script webapp URL used to sync roster data from Google Sheets.
                            Update this when you re-deploy the Apps Script.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="roster-url">Roster Sync Webapp URL</Label>
                            <Input
                                id="roster-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={rosterUrl}
                                onChange={(e) => setRosterUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the deployed Google Apps Script web app (ends with /exec)
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveRosterUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Schedule Integration</CardTitle>
                        <CardDescription>
                            Configure the Google Apps Script webapp URL used to sync duty schedules from Google Sheets.
                            Update this when you re-deploy the Apps Script.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="schedule-url">Schedule Sync Webapp URL</Label>
                            <Input
                                id="schedule-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={scheduleUrl}
                                onChange={(e) => setScheduleUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the deployed Google Apps Script web app (ends with /exec)
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveScheduleUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Leave Integration</CardTitle>
                        <CardDescription>
                            Configure the Google Apps Script webapp URL used to fetch leave data for dashboards.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="leave-url">Leave Sync Webapp URL</Label>
                            <Input
                                id="leave-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={leaveUrl}
                                onChange={(e) => setLeaveUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the deployed Google Apps Script web app (ends with /exec)
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveLeaveUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Training Data Integration</CardTitle>
                        <CardDescription>
                            Configure the Google Apps Script webapp URL used to fetch OJTI and examiner training data.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="training-url">Training Data Webapp URL</Label>
                            <Input
                                id="training-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={trainingUrl}
                                onChange={(e) => setTrainingUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the deployed Google Apps Script web app for OJTI and examiner training records
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveTrainingUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>ELPA Data Integration</CardTitle>
                        <CardDescription>
                            Configure the webapp URL used to fetch ELPA (English Language Proficiency) data.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="elpa-url">ELPA Data Webapp URL</Label>
                            <Input
                                id="elpa-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={elpaUrl}
                                onChange={(e) => setElpaUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the webapp that returns ELPA level and validity data as JSON
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveElpaUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Medical Data Integration</CardTitle>
                        <CardDescription>
                            Configure the webapp URL used to fetch medical examination records.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="medical-url">Medical Data Webapp URL</Label>
                            <Input
                                id="medical-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={medicalUrl}
                                onChange={(e) => setMedicalUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the webapp that returns medical status, endorsed dates and history as JSON
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveMedicalUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Earned Leave (EL) Integration</CardTitle>
                        <CardDescription>
                            Configure the webapp URL used to fetch earned leave (EL) records.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="el-url">Earned Leave Data Webapp URL</Label>
                            <Input
                                id="el-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={elUrl}
                                onChange={(e) => setElUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the webapp that returns employee earned leave periods as JSON
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveElUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Team Code Integration</CardTitle>
                        <CardDescription>
                            Configure the webapp URL used to fetch team code assignments for employees.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="team-code-url">Team Code Sync Webapp URL</Label>
                            <Input
                                id="team-code-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={teamCodeUrl}
                                onChange={(e) => setTeamCodeUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the webapp that returns team code (current_shift) assignments as JSON
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveTeamCodeUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Employee Data Integration</CardTitle>
                        <CardDescription>
                            Configure the webapp URL used to fetch employee data with ratings, designations, and contact details.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="employee-data-url">Employee Data Webapp URL</Label>
                            <Input
                                id="employee-data-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={employeeDataUrl}
                                onChange={(e) => setEmployeeDataUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the webapp that returns employee data with ratings, designations, and contact info as JSON
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveEmployeeDataUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>ATCO Master Integration</CardTitle>
                        <CardDescription>
                            Configure the webapp URL used to fetch the CAP Kolkata Master ATCO list.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="atco-master-url">ATCO Master Webapp URL</Label>
                            <Input
                                id="atco-master-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={atcoMasterUrl}
                                onChange={(e) => setAtcoMasterUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                Returns each controller&apos;s Kolkata joining date and AAI joining date as JSON.
                                Synced every Sunday. Stress Allowance Recovery uses the Kolkata date to decide
                                which ratings count, so without it nobody carries a requirement.
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveAtcoMasterUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Rating Data Integration</CardTitle>
                        <CardDescription>
                            Configure the webapp URL used to fetch ATC rating and proficiency check data.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="rating-url">Rating Data Webapp URL</Label>
                            <Input
                                id="rating-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={ratingUrl}
                                onChange={(e) => setRatingUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the webapp that returns rating, endorsement dates and proficiency history as JSON
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveRatingUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Trainee Data Integration</CardTitle>
                        <CardDescription>
                            Configure the webapp URL used to fetch trainee unit marking and required training hours.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="trainee-url">Trainee Data Webapp URL</Label>
                            <Input
                                id="trainee-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={traineeUrl}
                                onChange={(e) => setTraineeUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the webapp that returns trainee name, designation, marked unit and required hours as JSON
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveTraineeUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>OJT Progress Integration</CardTitle>
                        <CardDescription>
                            Configure the webapp URL used to fetch OJT progress. It must return both sheet tabs in one
                            payload — <code className="font-mono text-xs">{`{ "extracted": [...], "ojt": [...] }`}</code> —
                            so performed hours can never land against a stale start date. Synced twice daily at 13:00
                            and 19:00 IST.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="ojt-url">OJT Progress Data Webapp URL</Label>
                            <Input
                                id="ojt-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={ojtUrl}
                                onChange={(e) => setOjtUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                <span className="font-medium">extracted</span>: name, emp id, unit, required/performed hours and days.{" "}
                                <span className="font-medium">ojt</span>: name, emp id, unit, date of start of OJT. Rows are joined on
                                emp id + unit.
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveOjtUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Working Hours Export</CardTitle>
                        <CardDescription>
                            Configure the Google Apps Script webapp URL where the Working Hours analysis data will be exported as JSON.
                            The supervisor can trigger the export from the Working Hours page.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="working-hours-export-url">Working Hours Export Webapp URL</Label>
                            <Input
                                id="working-hours-export-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={workingHoursExportUrl}
                                onChange={(e) => setWorkingHoursExportUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the Google Apps Script web app that receives the duty hours JSON payload (POST)
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveWorkingHoursExportUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>BA Test List</CardTitle>
                        <CardDescription>
                            Configure the Google Sheet / Apps Script URL that returns the Breath Analyser test list.
                            The cron job fetches this URL at 05:40, 06:05, 11:40, 12:05, 17:40, and 18:05 IST daily.
                            Data is automatically purged after 2 days.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="ba-test-sheet-url">BA Test Sheet URL</Label>
                            <Input
                                id="ba-test-sheet-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={baTestSheetUrl}
                                onChange={(e) => setBaTestSheetUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The URL must return JSON: <code className="rounded bg-muted px-1 py-0.5">{"{ status: 'success', data: [{employee_name, employee_code, test_time, remarks, sl_no}, ...] }"}</code> or a bare array.
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveBaTestSheetUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Supervisor Audit Log</CardTitle>
                        <CardDescription>
                            Configure the Google Apps Script webapp URL where supervisor edit audit logs will be sent automatically.
                            Every database change made by a supervisor (duty edits, leave approvals, attendance, licenses, etc.) will be logged here.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="audit-log-url">Audit Log Webapp URL</Label>
                            <Input
                                id="audit-log-url"
                                type="url"
                                placeholder="https://script.google.com/macros/s/.../exec"
                                value={auditLogUrl}
                                onChange={(e) => setAuditLogUrl(e.target.value)}
                                className="font-mono text-sm"
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                The full URL of the Google Apps Script web app that receives audit log JSON payloads (POST). Each edit sends: timestamp, user name, action, table, description, and before/after values.
                            </p>
                        </div>
                        <Button
                            onClick={handleSaveAuditLogUrl}
                            disabled={updateSetting.isPending || isLoading}
                        >
                            {updateSetting.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save URL
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
