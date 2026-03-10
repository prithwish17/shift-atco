import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Users } from "lucide-react";
import { useLeaveData } from "@/hooks/useLeaveData";
import { LeaveSummaryCard } from "@/components/leave/LeaveSummaryCard";
import { EmployeeLeaveTable } from "@/components/leave/EmployeeLeaveTable";
import { LeaveDetailsModal } from "@/components/leave/LeaveDetailsModal";
import { SearchBar } from "@/components/leave/SearchBar";
import type { NormalizedLeaveRecord } from "@/utils/leaveCalculations";

export default function SupervisorLeaveDashboard() {
  const { data, isUrlLoading, url, urlError, leaveQuery } = useLeaveData();
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<NormalizedLeaveRecord | null>(null);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (emp) =>
        emp.empId.toLowerCase().includes(q) ||
        emp.name.toLowerCase().includes(q)
    );
  }, [data, searchQuery]);

  const stats = useMemo(() => {
    const total = data.length;
    const active = data.filter((emp) => emp.status === "Active").length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [data]);

  const highUsageEmpIds = useMemo(() => {
    const ids = new Set<string>();
    const total = data.length;
    if (total < 3) return ids;

    const topCount = Math.max(3, Math.ceil(total * 0.1));
    const sorted = [...data].sort((a, b) => {
      if (b.usageScore !== a.usageScore) return b.usageScore - a.usageScore;
      return a.empId.localeCompare(b.empId);
    });

    sorted.slice(0, topCount).forEach((emp) => ids.add(emp.empId));
    return ids;
  }, [data]);

  const isLoading = isUrlLoading || leaveQuery.isLoading;

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-black tracking-tight">Supervisor Leave Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              View leave usage across all employees
            </p>
          </div>
        </div>

        {urlError && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-4 pb-4 text-sm text-amber-800">
              Unable to load leave API URL. Please check `leave_webapp_url` in settings.
            </CardContent>
          </Card>
        )}

        {!url && !isUrlLoading && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-4 pb-4 text-sm text-amber-800">
              Leave API URL is not configured. Ask an admin to set `leave_webapp_url`.
            </CardContent>
          </Card>
        )}

        {leaveQuery.error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-4 pb-4 text-sm text-red-800">
              {(leaveQuery.error as Error).message || "Failed to load leave data"}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <LeaveSummaryCard label="Total" value={stats.total} tone="info" />
              <LeaveSummaryCard label="Active" value={stats.active} tone="success" />
              <LeaveSummaryCard label="Inactive" value={stats.inactive} tone="warning" />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  Employee Search
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SearchBar
                  value={searchQuery}
                  onSearch={setSearchQuery}
                  placeholder="Search by name or empId"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  Leave Usage Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filtered.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    No employees found.
                  </div>
                ) : (
                  <EmployeeLeaveTable
                    employees={filtered}
                    highUsageEmpIds={highUsageEmpIds}
                    onViewDetails={setSelected}
                  />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <LeaveDetailsModal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        record={selected}
      />
    </DashboardLayout>
  );
}
