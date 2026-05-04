import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserPlus, Search, MoreHorizontal, Edit, Eye, LayoutGrid, List, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useUsers } from "@/hooks/useUsers";
import { useLicenses } from "@/hooks/useLicenses";
import { logSupervisorEdit } from "@/lib/supervisorAuditLog";
import { Skeleton } from "@/components/ui/skeleton";
import { AddEmployeeDialog } from "@/components/AddEmployeeDialog";
import { useIsMobile } from "@/hooks/use-mobile";

const LICENSE_LABELS: { [key: string]: string } = {
  rdr: "RDR",
  app: "APP",
  plr: "PLR",
  adc: "ADC",
  alpha: "ALPHA",
  occ: "OCC",
};

export default function EmployeeManagement() {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [licenseFilter, setLicenseFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [editEmployee, setEditEmployee] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    full_name: "",
    employee_id: "",
    email: "",
    mobile: "",
    designation: "",
    current_shift: "general",
  });
  const [addEmpOpen, setAddEmpOpen] = useState(false);

  const { users, isLoading, updateProfile, isUpdating } = useUsers();
  const { licenses } = useLicenses();

  useEffect(() => {
    if (isMobile) {
      setViewMode("list");
    }
  }, [isMobile]);

  const employees = useMemo(() => {
    if (!users) return [];
    return users.filter(u => !u.is_hidden && u.role !== "admin");
  }, [users]);

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const matchesSearch =
        emp.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.employee_id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesShift = shiftFilter === "all" || emp.current_shift === shiftFilter;

      if (licenseFilter !== "all") {
        const empLicenses = licenses?.filter(l => l.user_id === emp.id) || [];
        const hasLicense = empLicenses.some(l => l.license_type === licenseFilter);
        return matchesSearch && matchesShift && hasLicense;
      }

      return matchesSearch && matchesShift;
    });
  }, [employees, licenses, searchQuery, shiftFilter, licenseFilter]);

  const getEmployeeLicenses = (userId: string) => {
    return licenses?.filter(l => l.user_id === userId) || [];
  };

  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase();
  };

  const openEditDialog = (employee: any) => {
    setEditEmployee(employee);
    setEditForm({
      full_name: employee.full_name || "",
      employee_id: employee.employee_id || "",
      email: employee.email || "",
      mobile: employee.mobile || "",
      designation: employee.designation || "",
      current_shift: employee.current_shift || "general",
    });
  };

  const handleSaveEmployee = () => {
    if (!editEmployee) return;
    if (!editForm.full_name.trim() || !editForm.employee_id.trim() || !editForm.email.trim()) return;

    const updates = {
      full_name: editForm.full_name.trim(),
      employee_id: editForm.employee_id.trim(),
      email: editForm.email.trim(),
      mobile: editForm.mobile.trim() || null,
      designation: editForm.designation.trim() || null,
      current_shift: editForm.current_shift as any,
    };

    updateProfile(
      { userId: editEmployee.id, updates },
      {
        onSuccess: () => {
          logSupervisorEdit({
            action: "update",
            table: "profiles",
            description: `Employee profile updated: ${updates.full_name} (${updates.employee_id})`,
            recordId: editEmployee.id,
            before: {
              full_name: editEmployee.full_name,
              employee_id: editEmployee.employee_id,
              email: editEmployee.email,
              designation: editEmployee.designation,
              current_shift: editEmployee.current_shift,
            },
            after: updates,
          });
        },
      },
    );
    setEditEmployee(null);
  };

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-3 sm:space-y-6">
        <div className="rounded-[20px] border border-slate-200 bg-gradient-to-r from-slate-50 via-blue-50 to-cyan-50 p-3.5 dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.95)_48%,rgba(8,47,73,0.88)_100%)] sm:rounded-2xl sm:p-4 md:p-6">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">Employee Management</h1>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 sm:text-sm">Manage employee information and assignments</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 lg:w-auto">
            <Button
              onClick={() => setAddEmpOpen(true)}
              className="h-8 w-full bg-slate-900 px-3 text-xs text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 sm:h-10 sm:w-auto sm:text-sm"
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
              Add Employee
            </Button>
          </div>
        </div>
        </div>

        <Card className="border-slate-200 shadow-sm dark:border-slate-800">
          <CardHeader className="px-3.5 pb-2.5 pt-3.5 sm:px-6 sm:pb-4 sm:pt-6">
            <CardTitle className="text-sm text-slate-900 dark:text-white sm:text-lg">Search & Filter</CardTitle>
            <CardDescription className="text-[11px] text-slate-600 dark:text-slate-400 sm:text-sm">Find employees by name, ID, shift, or license</CardDescription>
          </CardHeader>
          <CardContent className="px-3.5 pb-3.5 pt-0 sm:px-6 sm:pb-6">
            <div className="grid grid-cols-1 gap-2.5 sm:gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 sm:left-3 sm:h-4 sm:w-4" />
                <Input
                  placeholder="Search by name or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 border-slate-200 bg-slate-50 pl-8 pr-8 text-[11px] focus-visible:ring-slate-300 dark:border-slate-700 dark:bg-slate-900/70 dark:focus-visible:ring-slate-600 sm:h-9 sm:pl-9 sm:text-sm"
                />
                {searchQuery && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchQuery("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>

              <Select value={shiftFilter} onValueChange={setShiftFilter}>
                <SelectTrigger className="h-8 border-slate-200 bg-slate-50 text-[11px] dark:border-slate-700 dark:bg-slate-900/70 sm:h-9 sm:text-sm">
                  <SelectValue placeholder="Filter by shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Shifts</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="a">Shift A</SelectItem>
                  <SelectItem value="b">Shift B</SelectItem>
                  <SelectItem value="c">Shift C</SelectItem>
                  <SelectItem value="d">Shift D</SelectItem>
                  <SelectItem value="e">Shift E</SelectItem>
                </SelectContent>
              </Select>

              <Select value={licenseFilter} onValueChange={setLicenseFilter}>
                <SelectTrigger className="h-8 border-slate-200 bg-slate-50 text-[11px] dark:border-slate-700 dark:bg-slate-900/70 sm:h-9 sm:text-sm">
                  <SelectValue placeholder="Filter by license" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Licenses</SelectItem>
                  <SelectItem value="rdr">RDR</SelectItem>
                  <SelectItem value="app">APP</SelectItem>
                  <SelectItem value="plr">PLR</SelectItem>
                  <SelectItem value="adc">ADC</SelectItem>
                  <SelectItem value="alpha">ALPHA</SelectItem>
                  <SelectItem value="occ">OCC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-slate-600 dark:text-slate-400 sm:text-sm">
            {filteredEmployees.length} employee{filteredEmployees.length === 1 ? "" : "s"}
          </p>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <Button
              type="button"
              variant={viewMode === "grid" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("grid")}
              className="h-8 px-2.5 text-xs sm:h-9 sm:text-sm"
            >
              <LayoutGrid className="mr-1.5 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
              Grid
            </Button>
            <Button
              type="button"
              variant={viewMode === "list" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="h-8 px-2.5 text-xs sm:h-9 sm:text-sm"
            >
              <List className="mr-1.5 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
              List
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-40 w-full sm:h-64" />
            ))}
          </div>
        ) : filteredEmployees.length === 0 ? (
          <Card className="border-slate-200 shadow-sm dark:border-slate-800">
            <CardContent className="py-10 text-center text-xs text-slate-500 dark:text-slate-400 sm:py-12 sm:text-sm">
              No employees found
            </CardContent>
          </Card>
        ) : viewMode === "list" ? (
          <Card className="overflow-hidden border-slate-200 shadow-sm dark:border-slate-800">
            <CardContent className="p-0">
              <div className="divide-y dark:divide-slate-800">
                {filteredEmployees.map((employee) => {
                  const empLicenses = getEmployeeLicenses(employee.id);
                  return (
                    <div
                      key={employee.id}
                      className="relative grid grid-cols-1 items-start gap-2 bg-white px-2.5 py-2.5 transition-colors hover:bg-slate-50 dark:bg-slate-950/60 dark:hover:bg-slate-900 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:gap-4 lg:items-center lg:px-4 lg:py-3.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5 pr-9 lg:pr-0">
                        <Avatar className="h-9 w-9 shrink-0 ring-2 ring-slate-100 dark:ring-slate-800 sm:h-11 sm:w-11">
                          <AvatarImage src={employee.photo_url || undefined} />
                          <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">{getInitials(employee.full_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900 dark:text-white sm:text-base">{employee.full_name}</p>
                          <p className="font-mono text-[10px] text-slate-500 sm:text-xs">{employee.employee_id}</p>
                          <p className="truncate text-[11px] text-slate-600 dark:text-slate-400 sm:text-sm">{employee.designation || "N/A"}</p>
                        </div>
                      </div>

                      <div className="grid min-w-0 w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-800 lg:border-0 lg:pt-0">
                        <span className="text-[9px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:text-[10px]">Shift</span>
                        <div className="min-w-0">
                          <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[10px] uppercase text-blue-700 dark:border-blue-900/60 dark:bg-blue-900/30 dark:text-blue-200 sm:text-xs">
                            {employee.current_shift}
                          </Badge>
                        </div>
                        <span className="pt-0.5 text-[9px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:text-[10px]">Licenses</span>
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {empLicenses.length > 0 ? (
                            empLicenses.map((license) => (
                              <Badge key={license.id} variant="secondary" className="border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/30 dark:text-emerald-200 sm:px-2 sm:text-xs">
                                {LICENSE_LABELS[license.license_type] || license.license_type.toUpperCase()}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">No licenses</span>
                          )}
                        </div>
                      </div>

                      <div className="absolute right-2 top-2 lg:static lg:w-auto lg:justify-self-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8">
                              <MoreHorizontal className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedEmployee(employee)}>
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEditDialog(employee)}>
                              <Edit className="mr-2 h-4 w-4" />
                              Edit Employee
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEditDialog(employee)}>
                              Change Shift
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredEmployees.map((employee) => {
              const empLicenses = getEmployeeLicenses(employee.id);
              return (
                <Card key={employee.id} className="border-slate-200 bg-gradient-to-b from-white to-slate-50/70 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.9)_0%,rgba(15,23,42,0.72)_100%)]">
                  <CardHeader className="flex flex-row items-start gap-2.5 p-3 sm:gap-4 sm:p-6">
                    <Avatar className="h-10 w-10 ring-2 ring-slate-100 dark:ring-slate-800 sm:h-16 sm:w-16">
                      <AvatarImage src={employee.photo_url || undefined} />
                      <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">{getInitials(employee.full_name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate text-sm text-slate-900 dark:text-white sm:text-lg">{employee.full_name}</CardTitle>
                      <CardDescription className="font-mono text-[10px] text-slate-500 dark:text-slate-400 sm:text-sm">{employee.employee_id}</CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8">
                          <MoreHorizontal className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setSelectedEmployee(employee)}>
                          <Eye className="mr-2 h-4 w-4" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEditDialog(employee)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit Employee
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEditDialog(employee)}>
                          Change Shift
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>
                  <CardContent className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 p-3 pt-0 sm:gap-x-3 sm:gap-y-2 sm:p-6 sm:pt-0">
                    <p className="text-[9px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:text-sm sm:normal-case sm:tracking-normal">Designation</p>
                    <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200 sm:text-base">{employee.designation || "N/A"}</p>
                    <p className="text-[9px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:text-sm sm:normal-case sm:tracking-normal">Shift</p>
                    <div>
                      <Badge variant="outline" className="border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] uppercase text-blue-700 dark:border-blue-900/60 dark:bg-blue-900/30 dark:text-blue-200 sm:px-2 sm:text-xs">{employee.current_shift}</Badge>
                    </div>
                    <p className="pt-0.5 text-[9px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:text-sm sm:normal-case sm:tracking-normal">Licenses</p>
                    <div className="flex flex-wrap gap-1">
                      {empLicenses.length > 0 ? (
                        empLicenses.map((license) => (
                          <Badge key={license.id} variant="secondary" className="border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/30 dark:text-emerald-200 sm:px-2 sm:text-xs">
                            {LICENSE_LABELS[license.license_type] || license.license_type.toUpperCase()}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-sm">No licenses</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={!!selectedEmployee} onOpenChange={() => setSelectedEmployee(null)}>
          <DialogContent className="w-[calc(100vw-0.75rem)] max-w-3xl overflow-hidden p-0 sm:w-full">
            <DialogHeader className="px-3.5 pt-3.5 sm:px-6 sm:pt-6">
              <DialogTitle className="text-sm sm:text-lg">Employee Details</DialogTitle>
              <DialogDescription className="text-[11px] sm:text-sm">
                Comprehensive information about {selectedEmployee?.full_name}
              </DialogDescription>
            </DialogHeader>
            {selectedEmployee && (
              <div className="max-h-[80vh] overflow-y-auto px-3.5 pb-3.5 sm:px-6 sm:pb-6">
              <Tabs defaultValue="personal">
                <TabsList className="flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto p-1 [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-4 sm:overflow-visible">
                  <TabsTrigger value="personal" className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] sm:text-sm">Personal</TabsTrigger>
                  <TabsTrigger value="licenses" className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] sm:text-sm">Licenses</TabsTrigger>
                  <TabsTrigger value="shifts" className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] sm:text-sm">Shift History</TabsTrigger>
                  <TabsTrigger value="leave" className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] sm:text-sm">Leave Balance</TabsTrigger>
                </TabsList>
                <TabsContent value="personal" className="mt-3 space-y-3 sm:mt-4 sm:space-y-4">
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4">
                    <div>
                      <p className="text-[11px] text-muted-foreground sm:text-sm">Employee ID</p>
                      <p className="font-mono text-xs font-medium sm:text-base">{selectedEmployee.employee_id}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground sm:text-sm">Full Name</p>
                      <p className="text-xs font-medium sm:text-base">{selectedEmployee.full_name}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground sm:text-sm">Email</p>
                      <p className="text-xs font-medium sm:text-base">{selectedEmployee.email}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground sm:text-sm">Designation</p>
                      <p className="text-xs font-medium sm:text-base">{selectedEmployee.designation}</p>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="licenses" className="mt-3 sm:mt-4">
                  <div className="space-y-2.5 sm:space-y-3">
                    {getEmployeeLicenses(selectedEmployee.id).map((license) => (
                      <div key={license.id} className="flex items-center justify-between rounded-lg border p-2.5 sm:p-3">
                        <div>
                          <p className="text-xs font-medium sm:text-base">{LICENSE_LABELS[license.license_type] || license.license_type.toUpperCase()}</p>
                          <p className="text-[11px] text-muted-foreground sm:text-sm">
                            {license.issue_date && `Issued: ${new Date(license.issue_date).toLocaleDateString()}`}
                          </p>
                        </div>
                        <Badge className="text-[10px] sm:text-xs">Active</Badge>
                      </div>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="shifts" className="mt-3 sm:mt-4">
                  <p className="text-[11px] text-muted-foreground sm:text-sm">Shift history would be displayed here</p>
                </TabsContent>
                <TabsContent value="leave" className="mt-3 sm:mt-4">
                  <p className="text-[11px] text-muted-foreground sm:text-sm">Leave balance information would be displayed here</p>
                </TabsContent>
              </Tabs>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={!!editEmployee} onOpenChange={() => setEditEmployee(null)}>
          <DialogContent className="w-[calc(100vw-0.75rem)] max-w-2xl overflow-hidden p-0 sm:w-full">
            <DialogHeader className="px-3.5 pt-3.5 sm:px-6 sm:pt-6">
              <DialogTitle className="text-sm sm:text-lg">Edit Employee</DialogTitle>
              <DialogDescription className="text-[11px] sm:text-sm">
                Update employee details and current shift.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[80vh] overflow-y-auto px-3.5 pb-3.5 sm:px-6 sm:pb-6">
            <div className="grid grid-cols-1 gap-2.5 py-1.5 sm:gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground sm:text-sm">Full Name</p>
                <Input
                  value={editForm.full_name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, full_name: e.target.value }))}
                  className="h-8 text-[11px] sm:h-9 sm:text-sm"
                />
              </div>
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground sm:text-sm">Employee ID</p>
                <Input
                  value={editForm.employee_id}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, employee_id: e.target.value }))}
                  className="h-8 text-[11px] sm:h-9 sm:text-sm"
                />
              </div>
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground sm:text-sm">Email</p>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                  className="h-8 text-[11px] sm:h-9 sm:text-sm"
                />
              </div>
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground sm:text-sm">Mobile</p>
                <Input
                  value={editForm.mobile}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, mobile: e.target.value }))}
                  className="h-8 text-[11px] sm:h-9 sm:text-sm"
                />
              </div>
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground sm:text-sm">Designation</p>
                <Input
                  value={editForm.designation}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, designation: e.target.value }))}
                  className="h-8 text-[11px] sm:h-9 sm:text-sm"
                />
              </div>
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground sm:text-sm">Current Shift</p>
                <Select
                  value={editForm.current_shift}
                  onValueChange={(value) => setEditForm((prev) => ({ ...prev, current_shift: value }))}
                >
                  <SelectTrigger className="h-8 text-[11px] sm:h-9 sm:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="a">Shift A</SelectItem>
                    <SelectItem value="b">Shift B</SelectItem>
                    <SelectItem value="c">Shift C</SelectItem>
                    <SelectItem value="d">Shift D</SelectItem>
                    <SelectItem value="e">Shift E</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:justify-end">
              <Button variant="outline" onClick={() => setEditEmployee(null)} className="h-8 text-xs sm:h-10 sm:text-sm">
                Cancel
              </Button>
              <Button onClick={handleSaveEmployee} disabled={isUpdating} className="h-8 text-xs sm:h-10 sm:text-sm">
                {isUpdating ? "Saving..." : "Save Changes"}
              </Button>
            </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <AddEmployeeDialog open={addEmpOpen} onOpenChange={setAddEmpOpen} />
    </DashboardLayout>
  );
}
