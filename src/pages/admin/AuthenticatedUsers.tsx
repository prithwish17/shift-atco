import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Search, Shield, UserCheck, UserRoundX, Users } from "lucide-react";
import { fetchAuthenticatedUsers, type AuthenticatedUserRecord } from "@/lib/authenticatedUsers";

type SortOption =
  | "created_desc"
  | "created_asc"
  | "name_asc"
  | "name_desc"
  | "email_asc"
  | "email_desc"
  | "last_sign_in_desc"
  | "last_sign_in_asc";

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return format(date, "dd MMM yyyy, HH:mm");
}

function getSortValue(user: AuthenticatedUserRecord, sortBy: SortOption) {
  switch (sortBy) {
    case "created_asc":
    case "created_desc":
      return new Date(user.created_at || 0).getTime();
    case "last_sign_in_asc":
    case "last_sign_in_desc":
      return new Date(user.last_sign_in_at || 0).getTime();
    case "email_asc":
    case "email_desc":
      return user.email.toLowerCase();
    case "name_asc":
    case "name_desc":
      return `${user.full_name || user.email}`.toLowerCase();
    default:
      return 0;
  }
}

function sortUsers(users: AuthenticatedUserRecord[], sortBy: SortOption) {
  const sorted = [...users];

  sorted.sort((first, second) => {
    const firstValue = getSortValue(first, sortBy);
    const secondValue = getSortValue(second, sortBy);

    if (typeof firstValue === "number" && typeof secondValue === "number") {
      if (sortBy.endsWith("_asc")) {
        return firstValue - secondValue;
      }

      return secondValue - firstValue;
    }

    const comparison = String(firstValue).localeCompare(String(secondValue));
    return sortBy.endsWith("_asc") ? comparison : -comparison;
  });

  return sorted;
}

export default function AuthenticatedUsers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("created_desc");
  const [confirmationFilter, setConfirmationFilter] = useState("all");
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["authenticated-users"],
    queryFn: fetchAuthenticatedUsers,
    staleTime: 60_000,
  });

  const users = useMemo(() => data?.users || [], [data?.users]);

  const providerOptions = useMemo(() => {
    return [...new Set(users.map((user) => user.provider).filter(Boolean))].sort((first, second) =>
      first.localeCompare(second),
    );
  }, [users]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    const visibleUsers = users.filter((user) => {
      const matchesSearch =
        !normalizedSearch ||
        [user.email, user.full_name, user.employee_id, user.role || "", user.id]
          .map((value) => String(value || "").toLowerCase())
          .some((value) => value.includes(normalizedSearch));

      const matchesConfirmation =
        confirmationFilter === "all" ||
        (confirmationFilter === "confirmed" && user.email_confirmed) ||
        (confirmationFilter === "unconfirmed" && !user.email_confirmed);

      const matchesApproval =
        approvalFilter === "all" ||
        (approvalFilter === "approved" && user.approved) ||
        (approvalFilter === "pending" && !user.approved);

      const matchesProfile =
        profileFilter === "all" ||
        (profileFilter === "linked" && user.has_profile) ||
        (profileFilter === "missing" && !user.has_profile);

      const matchesProvider = providerFilter === "all" || user.provider === providerFilter;

      return matchesSearch && matchesConfirmation && matchesApproval && matchesProfile && matchesProvider;
    });

    return sortUsers(visibleUsers, sortBy);
  }, [users, searchQuery, confirmationFilter, approvalFilter, profileFilter, providerFilter, sortBy]);

  const summary = useMemo(() => {
    const confirmed = users.filter((user) => user.email_confirmed).length;
    const pendingApproval = users.filter((user) => !user.approved).length;
    const missingProfiles = users.filter((user) => !user.has_profile).length;

    return {
      total: users.length,
      confirmed,
      pendingApproval,
      missingProfiles,
    };
  }, [users]);

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Authenticated Users</h1>
            <p className="text-muted-foreground">Browse all users in Supabase Auth with search, filters, and sorting.</p>
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Auth Users</CardDescription>
              <CardTitle className="text-3xl">{summary.total}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                Accounts present in Auth
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Email Confirmed</CardDescription>
              <CardTitle className="text-3xl">{summary.confirmed}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserCheck className="h-4 w-4" />
                Users who confirmed email
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pending Approval</CardDescription>
              <CardTitle className="text-3xl">{summary.pendingApproval}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                No approved role yet
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Missing Profiles</CardDescription>
              <CardTitle className="text-3xl">{summary.missingProfiles}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserRoundX className="h-4 w-4" />
                Auth users without profile rows
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Search, Filter, and Sort</CardTitle>
            <CardDescription>Search by email, name, employee ID, role, or auth user ID.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="relative xl:col-span-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search authenticated users"
                  className="pl-9"
                />
              </div>

              <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created_desc">Newest Created</SelectItem>
                  <SelectItem value="created_asc">Oldest Created</SelectItem>
                  <SelectItem value="name_asc">Name A to Z</SelectItem>
                  <SelectItem value="name_desc">Name Z to A</SelectItem>
                  <SelectItem value="email_asc">Email A to Z</SelectItem>
                  <SelectItem value="email_desc">Email Z to A</SelectItem>
                  <SelectItem value="last_sign_in_desc">Latest Sign In</SelectItem>
                  <SelectItem value="last_sign_in_asc">Oldest Sign In</SelectItem>
                </SelectContent>
              </Select>

              <Select value={confirmationFilter} onValueChange={setConfirmationFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Email status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Email States</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="unconfirmed">Unconfirmed</SelectItem>
                </SelectContent>
              </Select>

              <Select value={approvalFilter} onValueChange={setApprovalFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Approval status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Approval States</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>

              <Select value={profileFilter} onValueChange={setProfileFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Profile status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Profile States</SelectItem>
                  <SelectItem value="linked">Profile Linked</SelectItem>
                  <SelectItem value="missing">Missing Profile</SelectItem>
                </SelectContent>
              </Select>

              <Select value={providerFilter} onValueChange={setProviderFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Providers</SelectItem>
                  {providerOptions.map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {provider}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Authenticated Users ({filteredUsers.length})</CardTitle>
            <CardDescription>Admin-only view of the Supabase Auth user list.</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                Unable to load authenticated users: {error instanceof Error ? error.message : "Unknown error"}
              </div>
            )}

            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Sign In</TableHead>
                    <TableHead>Provider</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No authenticated users match the current filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">{user.email || "—"}</div>
                            <div className="text-xs text-muted-foreground">{user.id}</div>
                          </div>
                        </TableCell>
                        <TableCell>{user.full_name || "—"}</TableCell>
                        <TableCell className="font-mono">{user.employee_id || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={user.role ? "default" : "outline"}>{(user.role || "none").toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={user.email_confirmed ? "default" : "secondary"}>
                              {user.email_confirmed ? "Email Confirmed" : "Email Pending"}
                            </Badge>
                            <Badge variant={user.approved ? "default" : "secondary"}>
                              {user.approved ? "Approved" : "Pending"}
                            </Badge>
                            {!user.has_profile && <Badge variant="destructive">Missing Profile</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>{formatDateTime(user.created_at)}</TableCell>
                        <TableCell>{formatDateTime(user.last_sign_in_at)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {user.providers.map((provider) => (
                              <Badge key={provider} variant="outline">
                                {provider}
                              </Badge>
                            ))}
                            {user.registration_source && (
                              <Badge variant="secondary">{user.registration_source}</Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}