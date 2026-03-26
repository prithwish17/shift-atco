import { useState, useMemo, useRef } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Search, MoreHorizontal, Edit, Trash2, Eye, EyeOff, CheckCircle, ShieldCheck, Upload, FileSpreadsheet, AlertCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useUsers, UserWithRole } from "@/hooks/useUsers";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { parseCSV, mapHeaders, rowsToRecords, validateRecords, EmployeeRecord } from "@/utils/csvParser";

export default function UserManagement() {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("visible");
  const [changeRoleUser, setChangeRoleUser] = useState<UserWithRole | null>(null);
  const [selectedNewRole, setSelectedNewRole] = useState("");

  // Import state
  const [importOpen, setImportOpen] = useState(false);
  const [parsedRecords, setParsedRecords] = useState<EmployeeRecord[]>([]);
  const [validationErrors, setValidationErrors] = useState<{ index: number; messages: string[] }[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ created: string[]; skipped: { employee_id: string; reason: string }[]; failed: { employee_id: string; error: string }[] } | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { users, isLoading, approveUser, deleteUser, updateUserRole, toggleHideUser, isApproving, isDeleting, isUpdatingRole, isTogglingHide } = useUsers();

  const filteredUsers = useMemo(() => {
    if (!users) return [];

    return users.filter(user => {
      const matchesSearch =
        user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.employee_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesShift = shiftFilter === "all" || user.current_shift === shiftFilter;
      const matchesStatus = statusFilter === "all" ||
        (statusFilter === "pending" && !user.approved) ||
        (statusFilter === "active" && user.approved);
      const matchesVisibility = visibilityFilter === "all" ||
        (visibilityFilter === "visible" && !user.is_hidden) ||
        (visibilityFilter === "hidden" && user.is_hidden);

      return matchesSearch && matchesRole && matchesShift && matchesStatus && matchesVisibility;
    });
  }, [users, searchQuery, roleFilter, shiftFilter, statusFilter, visibilityFilter]);

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "default";
      case "supervisor": return "secondary";
      case "wso": return "outline";
      default: return "outline";
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active": return "default";
      case "pending": return "secondary";
      case "inactive": return "destructive";
      default: return "outline";
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResults(null);
    setImportProgress(0);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers, rows } = parseCSV(text);
      const { mapped } = mapHeaders(headers);
      const records = rowsToRecords(rows, mapped);
      const { valid, errors } = validateRecords(records);
      setParsedRecords(valid);
      setValidationErrors(errors);
      setImportOpen(true);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  const handleImport = async () => {
    if (parsedRecords.length === 0) return;
    setImporting(true);
    setImportProgress(10);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Not authenticated");
        return;
      }

      setImportProgress(30);

      const { data, error } = await supabase.functions.invoke("import-employees", {
        body: { employees: parsedRecords },
      });

      setImportProgress(100);

      if (error) {
        toast.error("Import failed: " + error.message);
        return;
      }

      setImportResults(data);
      toast.success(`Import complete: ${data.created?.length || 0} created, ${data.skipped?.length || 0} skipped, ${data.failed?.length || 0} failed`);
    } catch (err) {
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const resetImport = () => {
    setImportOpen(false);
    setParsedRecords([]);
    setValidationErrors([]);
    setImportResults(null);
    setImportProgress(0);
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
            <p className="text-muted-foreground">Manage system users and registrations</p>
          </div>
          <div className="flex gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Import CSV
            </Button>
            <Button>
              <UserPlus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Search & Filter</CardTitle>
            <CardDescription>Find and filter users</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="wso">WSO</SelectItem>
                  <SelectItem value="employee">Employee</SelectItem>
                </SelectContent>
              </Select>

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

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>

              <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by visibility" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="visible">Visible</SelectItem>
                  <SelectItem value="hidden">Hidden</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users ({filteredUsers.length})</CardTitle>
            <CardDescription>All registered users in the system</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Full Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No users found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-mono">{user.employee_id}</TableCell>
                        <TableCell className="font-medium">{user.full_name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(user.role || "employee")}>
                            {(user.role || "N/A").toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="uppercase">{user.current_shift}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusBadgeVariant(user.approved ? "active" : "pending")}>
                            {user.approved ? "Active" : "Pending"}
                          </Badge>
                          {user.is_hidden && (
                            <Badge variant="destructive" className="ml-1 text-[10px] px-1">
                              Hidden
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" disabled={isApproving || isDeleting}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              {!user.approved && (
                                <DropdownMenuItem onClick={() => approveUser(user.id)}>
                                  <CheckCircle className="mr-2 h-4 w-4" />
                                  Approve
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => toggleHideUser({ userId: user.id, hidden: !user.is_hidden })}>
                                {user.is_hidden ? (
                                  <><Eye className="mr-2 h-4 w-4" />Unhide User</>
                                ) : (
                                  <><EyeOff className="mr-2 h-4 w-4" />Hide User</>
                                )}
                              </DropdownMenuItem>
                              {user.role !== "admin" && (
                                <DropdownMenuItem onClick={() => {
                                  setChangeRoleUser(user);
                                  setSelectedNewRole(user.role || "employee");
                                }}>
                                  <ShieldCheck className="mr-2 h-4 w-4" />
                                  Change Role
                                </DropdownMenuItem>
                              )}
                              {user.role !== "admin" && user.role !== "supervisor" && (
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => {
                                    if (confirm(`Are you sure you want to delete ${user.full_name}?`)) {
                                      deleteUser(user.id);
                                    }
                                  }}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Change Role Dialog */}
        <Dialog open={!!changeRoleUser} onOpenChange={(open) => !open && setChangeRoleUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change User Role</DialogTitle>
              <DialogDescription>
                Update the role for {changeRoleUser?.full_name} ({changeRoleUser?.employee_id})
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>New Role</Label>
                <Select value={selectedNewRole} onValueChange={setSelectedNewRole}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                    <SelectItem value="wso">WSO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setChangeRoleUser(null)}>Cancel</Button>
              <Button
                disabled={isUpdatingRole || selectedNewRole === changeRoleUser?.role}
                onClick={() => {
                  if (changeRoleUser) {
                    updateUserRole({ userId: changeRoleUser.id, newRole: selectedNewRole });
                    setChangeRoleUser(null);
                  }
                }}
              >
                {isUpdatingRole ? "Updating..." : "Update Role"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Import CSV Dialog */}
        <Dialog open={importOpen} onOpenChange={(open) => { if (!open) resetImport(); }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Import Employees from CSV
              </DialogTitle>
              <DialogDescription>
                Review the parsed data below. Default password: ATCORA@{"<EmployeeID>"}
              </DialogDescription>
            </DialogHeader>

            {validationErrors.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                <p className="text-sm font-medium text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  {validationErrors.length} row(s) have errors and will be skipped:
                </p>
                <ul className="mt-1 text-xs text-destructive/80 list-disc pl-5">
                  {validationErrors.slice(0, 5).map((e, i) => (
                    <li key={i}>Row {e.index}: {e.messages.join(", ")}</li>
                  ))}
                  {validationErrors.length > 5 && <li>...and {validationErrors.length - 5} more</li>}
                </ul>
              </div>
            )}

            {parsedRecords.length > 0 && !importResults && (
              <ScrollArea className="max-h-[300px] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Emp ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Designation</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Stream</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedRecords.map((rec, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{rec.employee_id}</TableCell>
                        <TableCell className="text-sm">{rec.full_name}</TableCell>
                        <TableCell className="text-xs">{rec.email}</TableCell>
                        <TableCell className="text-xs">{rec.designation}</TableCell>
                        <TableCell className="uppercase text-xs">{rec.current_shift}</TableCell>
                        <TableCell className="text-xs">{rec.stream}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}

            {importing && (
              <div className="space-y-2">
                <Progress value={importProgress} />
                <p className="text-sm text-muted-foreground text-center">Importing employees...</p>
              </div>
            )}

            {importResults && (
              <div className="space-y-2 text-sm">
                <p className="text-emerald-600 font-medium">✓ {importResults.created.length} employees created</p>
                {importResults.skipped.length > 0 && (
                  <div>
                    <p className="font-medium text-amber-600">⚠ {importResults.skipped.length} skipped:</p>
                    <ul className="list-disc pl-5 text-xs text-muted-foreground">
                      {importResults.skipped.map((s, i) => (
                        <li key={i}>{s.employee_id}: {s.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {importResults.failed.length > 0 && (
                  <div>
                    <p className="font-medium text-destructive">✗ {importResults.failed.length} failed:</p>
                    <ul className="list-disc pl-5 text-xs text-destructive/80">
                      {importResults.failed.map((f, i) => (
                        <li key={i}>{f.employee_id}: {f.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={resetImport}>
                {importResults ? "Close" : "Cancel"}
              </Button>
              {!importResults && (
                <Button onClick={handleImport} disabled={importing || parsedRecords.length === 0}>
                  {importing ? "Importing..." : `Import ${parsedRecords.length} Employees`}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
