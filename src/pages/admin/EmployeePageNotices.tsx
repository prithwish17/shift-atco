import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_EMPLOYEE_PAGE_NOTICE_STATE,
  EMPLOYEE_PAGE_NOTICE_ROUTES,
  EmployeePageNoticeKey,
} from "@/lib/employeePageNotices";
import {
  useEmployeePageNoticeSettings,
  useSaveEmployeePageNoticeSettings,
} from "@/hooks/useEmployeePageNoticeSettings";
import { Loader2, MessageSquareWarning, Settings2 } from "lucide-react";

export default function EmployeePageNotices() {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useEmployeePageNoticeSettings();
  const saveSettings = useSaveEmployeePageNoticeSettings();

  const noticeSettings = data ?? DEFAULT_EMPLOYEE_PAGE_NOTICE_STATE;
  const enabledCount = EMPLOYEE_PAGE_NOTICE_ROUTES.filter((route) => noticeSettings[route.key]).length;

  const handleToggle = async (routeKey: EmployeePageNoticeKey, checked: boolean, title: string) => {
    const nextState = {
      ...noticeSettings,
      [routeKey]: checked,
    };

    try {
      await saveSettings.mutateAsync(nextState);
      toast({
        title: "Notice updated",
        description: checked
          ? `${title} will now show the employee notice popup.`
          : `${title} will now open normally for employees.`,
      });
    } catch (error: any) {
      toast({
        title: "Update failed",
        description: error?.message || "Could not update the employee page notice setting.",
        variant: "destructive",
      });
    }
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
              <MessageSquareWarning className="h-8 w-8" />
              Employee Page Notices
            </h1>
            <p className="text-muted-foreground">
              Control which employee pages should show a temporary rollout notice before the
              employee enters the page.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="px-3 py-1 text-sm">
              {enabledCount} of {EMPLOYEE_PAGE_NOTICE_ROUTES.length} notices enabled
            </Badge>
            {saveSettings.isPending ? (
              <Badge variant="outline" className="gap-2 px-3 py-1 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving
              </Badge>
            ) : null}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Settings2 className="h-5 w-5 text-sky-600" />
              Employee popup message
            </CardTitle>
            <CardDescription>
              When a toggle is enabled, employees will see: “This function has not started for
              employee use yet. You may explore the page, or provide feedback for review.”
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Page Controls</CardTitle>
            <CardDescription>
              Each toggle applies when the employee opens the page from navigation or directly by
              URL. “Provide feedback” sends them to the feedback section in App Settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <div>Employee page notice settings could not be loaded.</div>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="mt-2 font-medium underline underline-offset-4"
                >
                  Try again
                </button>
              </div>
            ) : null}

            {EMPLOYEE_PAGE_NOTICE_ROUTES.map((route) => {
              const enabled = noticeSettings[route.key];

              return (
                <div
                  key={route.key}
                  className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-950 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        {route.title}
                      </div>
                      <Badge variant={enabled ? "default" : "secondary"}>
                        {enabled ? "Notice on" : "Notice off"}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {route.path}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{route.description}</p>
                  </div>

                  <div className="flex items-center justify-between gap-3 lg:min-w-[176px] lg:justify-end">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      {enabled ? "Popup enabled" : "Normal access"}
                    </span>
                    <Switch
                      checked={enabled}
                      disabled={isLoading || saveSettings.isPending}
                      onCheckedChange={(checked) => handleToggle(route.key, checked, route.title)}
                      aria-label={`Toggle employee notice for ${route.title}`}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
