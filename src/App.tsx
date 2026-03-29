import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { PWAOnboardingProvider } from "./contexts/PWAOnboardingContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PWAOnboardingBanner } from "./components/PWAOnboardingBanner";
import { AppSplash, APP_SPLASH_FADE_MS, APP_SPLASH_PLAY_MS } from "./components/AppSplash";
import { Analytics } from "@vercel/analytics/react";

// --- Lazy-loaded page components (code splitting) ---
const Index = lazy(() => import("./pages/Index"));
const Login = lazy(() => import("./pages/Login"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Register = lazy(() => import("./pages/Register"));
const SetupAdmin = lazy(() => import("./pages/admin/SetupAdmin"));
const AppSettingsPage = lazy(() => import("./pages/AppSettingsPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Admin
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const UserManagement = lazy(() => import("./pages/admin/UserManagement"));
const ChangePassword = lazy(() => import("./pages/admin/ChangePassword"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));

// Supervisor
const SupervisorDashboard = lazy(() => import("./pages/supervisor/SupervisorDashboard"));
const SupervisorAttendance = lazy(() => import("./pages/supervisor/SupervisorAttendance"));
const EmployeeManagement = lazy(() => import("./pages/supervisor/EmployeeManagement"));
const SupervisorEmployeeOverview = lazy(() => import("./pages/supervisor/SupervisorEmployeeOverview"));
const SupervisorDailyRoster = lazy(() => import("./pages/supervisor/SupervisorDailyRoster"));
const SupervisorAttendanceView = lazy(() => import("./pages/supervisor/SupervisorAttendanceView"));
const LeaveApprovals = lazy(() => import("./pages/supervisor/LeaveApprovals"));
const ApprovedLeavesRegister = lazy(() => import("./pages/supervisor/ApprovedLeavesRegister"));
const SupervisorLeaveDashboard = lazy(() => import("./pages/supervisor/SupervisorLeaveDashboard"));
const LeaveDiscrepancyPage = lazy(() => import("./pages/supervisor/LeaveDiscrepancyPage"));
const DutyExchangeApprovals = lazy(() => import("./pages/supervisor/DutyExchangeApprovals"));
const HolidayManagement = lazy(() => import("./pages/supervisor/HolidayManagement"));
const OPEAssignments = lazy(() => import("./pages/supervisor/OPEAssignments"));
const DutyManagement = lazy(() => import("./pages/supervisor/DutyManagement"));
const LicenseManagement = lazy(() => import("./pages/supervisor/LicenseManagement"));
const RatingsManagement = lazy(() => import("./pages/supervisor/RatingsManagement"));

// WSO
const WSODashboard = lazy(() => import("./pages/wso/WSODashboard"));
const WsoRosterManagement = lazy(() => import("./pages/wso/WsoRosterManagement"));
const WSOAttendance = lazy(() => import("./pages/wso/WSOAttendance"));
const BATestManagement = lazy(() => import("./pages/wso/BATestManagement"));
const WSODutyExchangeApprovals = lazy(() => import("./pages/wso/WSODutyExchangeApprovals"));
const WSOOPEAssignments = lazy(() => import("./pages/wso/WSOOPEAssignments"));

// Employee
const EmployeeDashboard = lazy(() => import("./pages/employee/EmployeeDashboard"));
const EmployeeProfile = lazy(() => import("./pages/employee/EmployeeProfile"));
const EmployeeSchedule = lazy(() => import("./pages/employee/EmployeeSchedule"));
const EmployeeAttendance = lazy(() => import("./pages/employee/EmployeeAttendance"));
const LeaveApplication = lazy(() => import("./pages/employee/LeaveApplication"));
const LeaveHistory = lazy(() => import("./pages/employee/LeaveHistory"));
const EmployeeLeavePage = lazy(() => import("./pages/employee/EmployeeLeavePage"));
const EmployeeCompOffPage = lazy(() => import("./pages/employee/EmployeeCompOffPage"));
const DutyExchangeRequest = lazy(() => import("./pages/employee/DutyExchangeRequest"));
const EmployeeRoster = lazy(() => import("./pages/employee/EmployeeRoster"));
const EmployeeHolidays = lazy(() => import("./pages/employee/EmployeeHolidays"));
const EmployeeLicenses = lazy(() => import("./pages/employee/EmployeeLicenses"));

// ATC
const ATCDutyGrid = lazy(() => import("./pages/atc/ATCDutyGrid"));
const EmployeeATCDuties = lazy(() => import("./pages/atc/EmployeeATCDuties"));
const WSOATCView = lazy(() => import("./pages/atc/WSOATCView"));
const SupervisorATCView = lazy(() => import("./pages/atc/SupervisorATCView"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes default
    },
    mutations: {
      retry: 1,
    },
  },
});

function GenericDashboardSkeleton() {
  return (
    <div className="flex min-h-screen w-full bg-gray-50 dark:bg-gray-950">
      <aside className="hidden w-72 shrink-0 border-r border-gray-200 bg-white/80 px-4 py-5 dark:border-gray-800 dark:bg-gray-900/80 lg:block">
        <Skeleton className="mb-8 h-9 w-32 rounded-xl" />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full rounded-xl" />
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white/80 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/80 md:px-6">
          <Skeleton className="h-10 w-10 rounded-lg lg:hidden" />
          <div className="flex-1 lg:flex-none" />
          <div className="flex items-center gap-3">
            <Skeleton className="hidden h-9 w-24 rounded-lg sm:block" />
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-28 rounded-full" />
          </div>
        </header>

        <main className="flex-1 space-y-6 p-4 md:p-6">
          <div className="space-y-3">
            <Skeleton className="h-8 w-64 rounded-xl" />
            <Skeleton className="h-4 w-80 max-w-full rounded-lg" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center justify-between px-6 pb-2 pt-6">
                  <Skeleton className="h-4 w-24 rounded-lg" />
                  <Skeleton className="h-4 w-4 rounded-full" />
                </div>
                <div className="px-6 pb-6 pt-0">
                  <Skeleton className="h-8 w-20 rounded-lg" />
                  <Skeleton className="mt-2 h-3 w-32 rounded-lg" />
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="px-6 pb-0 pt-6">
                <Skeleton className="h-6 w-48 rounded-lg" />
                <Skeleton className="mt-2 h-4 w-64 max-w-full rounded-lg" />
              </div>
              <div className="space-y-3 px-6 pb-6 pt-6">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            </section>

            <section className="space-y-6">
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="px-6 pb-0 pt-6">
                  <Skeleton className="h-6 w-36 rounded-lg" />
                </div>
                <div className="space-y-4 px-6 pb-6 pt-5">
                  <Skeleton className="h-28 w-full rounded-2xl" />
                  <Skeleton className="h-28 w-full rounded-2xl" />
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="px-6 pb-0 pt-6">
                  <Skeleton className="h-6 w-32 rounded-lg" />
                </div>
                <div className="space-y-3 px-6 pb-6 pt-5">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-10 w-full rounded-xl" />
                  ))}
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function RouteLoader() {
  const { pathname } = useLocation();
  const isDashboardRoute =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/supervisor") ||
    pathname.startsWith("/wso") ||
    pathname.startsWith("/employee") ||
    pathname.startsWith("/atc") ||
    pathname === "/settings" ||
    pathname === "/roster";

  if (isDashboardRoute) {
    return <GenericDashboardSkeleton />;
  }

  return (
    <div className="flex min-h-[40vh] items-center justify-center px-6 py-10">
      <Skeleton className="h-10 w-40 rounded-full" />
    </div>
  );
}

function App() {
  const [showBootSplash, setShowBootSplash] = useState(true);
  const [bootSplashExiting, setBootSplashExiting] = useState(false);

  useEffect(() => {
    const exitTimer = window.setTimeout(() => setBootSplashExiting(true), APP_SPLASH_PLAY_MS);
    const hideTimer = window.setTimeout(() => setShowBootSplash(false), APP_SPLASH_PLAY_MS + APP_SPLASH_FADE_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <Analytics />
            {showBootSplash ? <AppSplash isExiting={bootSplashExiting} /> : null}
            <BrowserRouter>
              <AuthProvider>
                <PWAOnboardingProvider>
                  <PWAOnboardingBanner />
                  <Suspense fallback={<RouteLoader />}>
                    <Routes>
                    <Route path="/" element={<Index />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/setup-admin" element={<SetupAdmin />} />
                    <Route path="/settings" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><AppSettingsPage /></ProtectedRoute>} />

                    {/* Admin Routes */}
                    <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
                    <Route path="/admin/users" element={<ProtectedRoute allowedRoles={['admin']}><UserManagement /></ProtectedRoute>} />
                    <Route path="/admin/change-password" element={<ProtectedRoute allowedRoles={['admin']}><ChangePassword /></ProtectedRoute>} />
                    <Route path="/admin/settings" element={<ProtectedRoute allowedRoles={['admin']}><AdminSettings /></ProtectedRoute>} />

                    {/* Supervisor Routes */}
                    <Route path="/supervisor" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorDashboard /></ProtectedRoute>} />
                    <Route path="/supervisor/employees" element={<ProtectedRoute allowedRoles={['supervisor']}><EmployeeManagement /></ProtectedRoute>} />
                    <Route path="/supervisor/employees/:employeeCode" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorEmployeeOverview /></ProtectedRoute>} />
                    <Route path="/supervisor/attendance" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorAttendance /></ProtectedRoute>} />
                    <Route path="/supervisor/attendance-view" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorAttendanceView /></ProtectedRoute>} />
                    <Route path="/supervisor/leaves" element={<ProtectedRoute allowedRoles={['supervisor', 'wso']}><LeaveApprovals /></ProtectedRoute>} />
                    <Route path="/supervisor/approved-leaves" element={<ProtectedRoute allowedRoles={['supervisor', 'wso']}><ApprovedLeavesRegister /></ProtectedRoute>} />
                    <Route path="/supervisor/leave-dashboard" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorLeaveDashboard /></ProtectedRoute>} />
                    <Route path="/supervisor/leave-discrepancy" element={<ProtectedRoute allowedRoles={['supervisor']}><LeaveDiscrepancyPage /></ProtectedRoute>} />
                    <Route path="/supervisor/duty-exchange" element={<ProtectedRoute allowedRoles={['supervisor']}><DutyExchangeApprovals /></ProtectedRoute>} />
                    <Route path="/supervisor/duty-exchanges" element={<ProtectedRoute allowedRoles={['supervisor']}><DutyExchangeApprovals /></ProtectedRoute>} />
                    <Route path="/supervisor/holidays" element={<ProtectedRoute allowedRoles={['supervisor']}><HolidayManagement /></ProtectedRoute>} />
                    <Route path="/supervisor/ope-assignments" element={<ProtectedRoute allowedRoles={['supervisor']}><OPEAssignments /></ProtectedRoute>} />
                    <Route path="/supervisor/duty-management" element={<ProtectedRoute allowedRoles={['supervisor']}><DutyManagement /></ProtectedRoute>} />
                    <Route path="/supervisor/roster" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorDailyRoster /></ProtectedRoute>} />
                    <Route path="/supervisor/licenses" element={<ProtectedRoute allowedRoles={['supervisor', 'admin']}><LicenseManagement /></ProtectedRoute>} />
                    <Route path="/supervisor/ratings" element={<ProtectedRoute allowedRoles={['supervisor', 'admin']}><RatingsManagement /></ProtectedRoute>} />

                    {/* WSO Routes */}
                    <Route path="/wso" element={<ProtectedRoute allowedRoles={['wso']}><WSODashboard /></ProtectedRoute>} />
                    <Route path="/wso/roster" element={<ProtectedRoute allowedRoles={['wso']}><WsoRosterManagement /></ProtectedRoute>} />
                    <Route path="/wso/attendance" element={<ProtectedRoute allowedRoles={['wso']}><WSOAttendance /></ProtectedRoute>} />
                    <Route path="/wso/ba-test" element={<ProtectedRoute allowedRoles={['wso']}><BATestManagement /></ProtectedRoute>} />
                    <Route path="/wso/leaves" element={<ProtectedRoute allowedRoles={['wso']}><LeaveApprovals /></ProtectedRoute>} />
                    <Route path="/wso/approved-leaves" element={<ProtectedRoute allowedRoles={['wso', 'supervisor']}><ApprovedLeavesRegister /></ProtectedRoute>} />
                    <Route path="/wso/duty-exchange" element={<ProtectedRoute allowedRoles={['wso']}><WSODutyExchangeApprovals /></ProtectedRoute>} />
                    <Route path="/wso/ope-assignments" element={<ProtectedRoute allowedRoles={['wso']}><WSOOPEAssignments /></ProtectedRoute>} />

                    {/* Employee Routes */}
                    <Route path="/employee" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeDashboard /></ProtectedRoute>} />
                    <Route path="/employee/profile" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeProfile /></ProtectedRoute>} />
                    <Route path="/employee/schedule" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeSchedule /></ProtectedRoute>} />
                    <Route path="/employee/attendance" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeAttendance /></ProtectedRoute>} />
                    <Route path="/employee/leave" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><LeaveApplication /></ProtectedRoute>} />
                    <Route path="/employee/leave-history" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><LeaveHistory /></ProtectedRoute>} />
                    <Route path="/employee/leave-dashboard" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeLeavePage /></ProtectedRoute>} />
                    <Route path="/employee/comp-off" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeCompOffPage /></ProtectedRoute>} />
                    <Route path="/employee/duty-exchange" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><DutyExchangeRequest /></ProtectedRoute>} />
                    <Route path="/employee/atc-duties" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeATCDuties /></ProtectedRoute>} />
                    <Route path="/employee/roster" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeRoster /></ProtectedRoute>} />
                    <Route path="/employee/holidays" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeHolidays /></ProtectedRoute>} />
                    <Route path="/employee/licenses" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeLicenses /></ProtectedRoute>} />

                    {/* ATC Routes */}
                    <Route path="/atc/grid" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><ATCDutyGrid /></ProtectedRoute>} />
                    <Route path="/wso/atc-grid" element={<ProtectedRoute allowedRoles={['wso']}><WSOATCView /></ProtectedRoute>} />
                    <Route path="/supervisor/atc-grid" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorATCView /></ProtectedRoute>} />

                    {/* Shared Roster Route — redirects to employee roster view */}
                    <Route path="/roster" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'wso']}><EmployeeRoster /></ProtectedRoute>} />

                    {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                    <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </PWAOnboardingProvider>
              </AuthProvider>
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
