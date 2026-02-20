import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserPlus, Search, MoreHorizontal, Edit, Eye, Upload, FileUp } from "lucide-react";
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
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [empCsvImportOpen, setEmpCsvImportOpen] = useState(false);
  const [addEmpOpen, setAddEmpOpen] = useState(false);

  const { users, isLoading } = useUsers();
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

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Employee Management</h1>
            <p className="text-muted-foreground">Manage employee information and assignments</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEmpCsvImportOpen(true)}>
              <FileUp className="mr-2 h-4 w-4" />
              Import Employees
            </Button>
            <Button variant="outline" onClick={() => setCsvImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import Licenses
            </Button>
            <Button onClick={() => setAddEmpOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add Employee
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Search & Filter</CardTitle>
            <CardDescription>Find employees by various criteria</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={shiftFilter} onValueChange={setShiftFilter}>
                <SelectTrigger>
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
                <SelectTrigger>
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

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        ) : filteredEmployees.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No employees found
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEmployees.map((employee) => {
              const empLicenses = getEmployeeLicenses(employee.id);
              return (
                <Card key={employee.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="flex flex-row items-center gap-4">
                    <Avatar className="h-16 w-16">
                      <AvatarImage src={employee.photo_url || undefined} />
                      <AvatarFallback>{getInitials(employee.full_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <CardTitle className="text-lg">{employee.full_name}</CardTitle>
                      <CardDescription className="font-mono">{employee.employee_id}</CardDescription>
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
                        <DropdownMenuItem>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit Employee
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          Change Shift
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-sm text-muted-foreground">Designation</p>
                      <p className="font-medium">{employee.designation || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Current Shift</p>
                      <Badge variant="outline" className="uppercase">{employee.current_shift}</Badge>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Licenses</p>
                      <div className="flex flex-wrap gap-1">
                        {empLicenses.length > 0 ? (
                          empLicenses.map((license) => (
                            <Badge key={license.id} variant="secondary">
                              {LICENSE_LABELS[license.license_type] || license.license_type.toUpperCase()}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">No licenses</span>
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
                Comprehensive information about {selectedEmployee?.fullName}
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
                      <p className="font-mono font-medium">{selectedEmployee.employeeId}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Full Name</p>
                      <p className="font-medium">{selectedEmployee.fullName}</p>
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
      </div>

      <LicenseCSVImport open={csvImportOpen} onOpenChange={setCsvImportOpen} />
      <EmployeeCSVImport open={empCsvImportOpen} onOpenChange={setEmpCsvImportOpen} />
      <AddEmployeeDialog open={addEmpOpen} onOpenChange={setAddEmpOpen} />
    </DashboardLayout>
  );
}
