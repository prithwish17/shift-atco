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
            const leave = settings.find((s) => s.key === "leave_webapp_url");
            if (roster) setRosterUrl(roster.value);
            if (schedule) setScheduleUrl(schedule.value);
            if (leave) setLeaveUrl(leave.value);
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
            key: "leave_webapp_url",
            value: leaveUrl.trim(),
            label: "Leave Sync Webapp URL",
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
            </div>
        </DashboardLayout>
    );
}
