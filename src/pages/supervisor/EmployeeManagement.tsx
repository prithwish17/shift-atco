import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserPlus, Search, MoreHorizontal, Edit, Eye, Upload, FileUp, LayoutGrid, List } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useUsers } from "@/hooks/useUsers";
import { useLicenses } from "@/hooks/useLicenses";
import { Skeleton } from "@/components/ui/skeleton";
import { LicenseCSVImport } from "@/components/LicenseCSVImport";
import { EmployeeCSVImport } from "@/components/EmployeeCSVImport";
import { AddEmployeeDialog } from "@/components/AddEmployeeDialog";

const LICENSE_LABELS: { [key: string]: string } = {
  rdr: "RDR",
  app: "APP",
  plr: "PLR",
  adc: "ADC",
  alpha: "ALPHA",
  occ: "OCC",
};

export default function EmployeeManagement() {
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
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [empCsvImportOpen, setEmpCsvImportOpen] = useState(false);
  const [addEmpOpen, setAddEmpOpen] = useState(false);

  const { users, isLoading, updateProfile, isUpdating } = useUsers();
  const { licenses } = useLicenses();

  const employees = useMemo(() => {
    if (!users) return [];
    return users.filter(u => u.role === "employee" || !u.role);
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

    updateProfile({
      userId: editEmployee.id,
      updates: {
        full_name: editForm.full_name.trim(),
        employee_id: editForm.employee_id.trim(),
        email: editForm.email.trim(),
        mobile: editForm.mobile.trim() || null,
        designation: editForm.designation.trim() || null,
        current_shift: editForm.current_shift as any,
      },
    });
    setEditEmployee(null);
  };

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-blue-50 to-cyan-50 p-5 md:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:justify-between lg:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Employee Management</h1>
            <p className="text-slate-600">Manage employee information and assignments</p>
          </div>
          <div className="flex flex-wrap gap-2 w-full lg:w-auto">
            <Button
              variant="outline"
              onClick={() => setEmpCsvImportOpen(true)}
              className="w-full sm:w-auto bg-white/80 border-slate-300 hover:bg-slate-100"
            >
              <FileUp className="mr-2 h-4 w-4" />
              Import Employees
            </Button>
            <Button
              variant="outline"
              onClick={() => setCsvImportOpen(true)}
              className="w-full sm:w-auto bg-white/80 border-slate-300 hover:bg-slate-100"
            >
              <Upload className="mr-2 h-4 w-4" />
              Import Licenses
            </Button>
            <Button
              onClick={() => setAddEmpOpen(true)}
              className="w-full sm:w-auto bg-slate-900 text-white hover:bg-slate-800"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Add Employee
            </Button>
          </div>
        </div>
        </div>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900">Search & Filter</CardTitle>
            <CardDescription className="text-slate-600">Find employees by various criteria</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by name or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 border-slate-200 bg-slate-50 focus-visible:ring-slate-300"
                />
              </div>

              <Select value={shiftFilter} onValueChange={setShiftFilter}>
                <SelectTrigger className="border-slate-200 bg-slate-50">
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
                <SelectTrigger className="border-slate-200 bg-slate-50">
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

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            {filteredEmployees.length} employee{filteredEmployees.length === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={viewMode === "grid" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="mr-2 h-4 w-4" />
              Grid
            </Button>
            <Button
              type="button"
              variant={viewMode === "list" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("list")}
            >
              <List className="mr-2 h-4 w-4" />
              List
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        ) : filteredEmployees.length === 0 ? (
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="py-12 text-center text-slate-500">
              No employees found
            </CardContent>
          </Card>
        ) : viewMode === "list" ? (
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <div className="divide-y">
                {filteredEmployees.map((employee) => {
                  const empLicenses = getEmployeeLicenses(employee.id);
                  return (
                    <div
                      key={employee.id}
                      className="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] gap-3 lg:gap-4 items-start lg:items-center bg-white hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="h-12 w-12 shrink-0 ring-2 ring-slate-100">
                          <AvatarImage src={employee.photo_url || undefined} />
                          <AvatarFallback className="bg-blue-100 text-blue-700">{getInitials(employee.full_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{employee.full_name}</p>
                          <p className="text-sm text-slate-500 font-mono">{employee.employee_id}</p>
                          <p className="text-sm text-slate-600 truncate">{employee.designation || "N/A"}</p>
                        </div>
                      </div>

                      <div className="min-w-0 space-y-2 w-full">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 w-16 shrink-0">Shift</span>
                          <Badge variant="outline" className="uppercase border-blue-200 text-blue-700 bg-blue-50">
                            {employee.current_shift}
                          </Badge>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-xs text-slate-500 w-16 shrink-0 pt-1">Licenses</span>
                          <div className="flex flex-wrap gap-1 min-w-0">
                            {empLicenses.length > 0 ? (
                              empLicenses.map((license) => (
                                <Badge key={license.id} variant="secondary" className="bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  {LICENSE_LABELS[license.license_type] || license.license_type.toUpperCase()}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-sm text-slate-500">No licenses</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end w-full lg:w-auto lg:justify-self-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEmployees.map((employee) => {
              const empLicenses = getEmployeeLicenses(employee.id);
              return (
                <Card key={employee.id} className="border-slate-200 bg-gradient-to-b from-white to-slate-50/70 hover:shadow-md transition-shadow">
                  <CardHeader className="flex flex-row items-center gap-4">
                    <Avatar className="h-16 w-16 ring-2 ring-slate-100">
                      <AvatarImage src={employee.photo_url || undefined} />
                      <AvatarFallback className="bg-blue-100 text-blue-700">{getInitials(employee.full_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <CardTitle className="text-lg text-slate-900">{employee.full_name}</CardTitle>
                      <CardDescription className="font-mono text-slate-500">{employee.employee_id}</CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
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
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-sm text-slate-500">Designation</p>
                      <p className="font-medium text-slate-800">{employee.designation || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Current Shift</p>
                      <Badge variant="outline" className="uppercase border-blue-200 text-blue-700 bg-blue-50">{employee.current_shift}</Badge>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Licenses</p>
                      <div className="flex flex-wrap gap-1">
                        {empLicenses.length > 0 ? (
                          empLicenses.map((license) => (
                            <Badge key={license.id} variant="secondary" className="bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {LICENSE_LABELS[license.license_type] || license.license_type.toUpperCase()}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-slate-500">No licenses</span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={!!selectedEmployee} onOpenChange={() => setSelectedEmployee(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Employee Details</DialogTitle>
              <DialogDescription>
                Comprehensive information about {selectedEmployee?.full_name}
              </DialogDescription>
            </DialogHeader>
            {selectedEmployee && (
              <Tabs defaultValue="personal">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="personal">Personal</TabsTrigger>
                  <TabsTrigger value="licenses">Licenses</TabsTrigger>
                  <TabsTrigger value="shifts">Shift History</TabsTrigger>
                  <TabsTrigger value="leave">Leave Balance</TabsTrigger>
                </TabsList>
                <TabsContent value="personal" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Employee ID</p>
                      <p className="font-mono font-medium">{selectedEmployee.employee_id}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Full Name</p>
                      <p className="font-medium">{selectedEmployee.full_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Email</p>
                      <p className="font-medium">{selectedEmployee.email}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Designation</p>
                      <p className="font-medium">{selectedEmployee.designation}</p>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="licenses">
                  <div className="space-y-3">
                    {getEmployeeLicenses(selectedEmployee.id).map((license) => (
                      <div key={license.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="font-medium">{LICENSE_LABELS[license.license_type] || license.license_type.toUpperCase()}</p>
                          <p className="text-sm text-muted-foreground">
                            {license.issue_date && `Issued: ${new Date(license.issue_date).toLocaleDateString()}`}
                          </p>
                        </div>
                        <Badge>Active</Badge>
                      </div>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="shifts">
                  <p className="text-sm text-muted-foreground">Shift history would be displayed here</p>
                </TabsContent>
                <TabsContent value="leave">
                  <p className="text-sm text-muted-foreground">Leave balance information would be displayed here</p>
                </TabsContent>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={!!editEmployee} onOpenChange={() => setEditEmployee(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Employee</DialogTitle>
              <DialogDescription>
                Update employee details and current shift.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Full Name</p>
                <Input
                  value={editForm.full_name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, full_name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Employee ID</p>
                <Input
                  value={editForm.employee_id}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, employee_id: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Email</p>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Mobile</p>
                <Input
                  value={editForm.mobile}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, mobile: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Designation</p>
                <Input
                  value={editForm.designation}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, designation: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Current Shift</p>
                <Select
                  value={editForm.current_shift}
                  onValueChange={(value) => setEditForm((prev) => ({ ...prev, current_shift: value }))}
                >
                  <SelectTrigger>
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

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditEmployee(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveEmployee} disabled={isUpdating}>
                {isUpdating ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <LicenseCSVImport open={csvImportOpen} onOpenChange={setCsvImportOpen} />
      <EmployeeCSVImport open={empCsvImportOpen} onOpenChange={setEmpCsvImportOpen} />
      <AddEmployeeDialog open={addEmpOpen} onOpenChange={setAddEmpOpen} />
    </DashboardLayout>
  );
}
