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
import { APP_NAME } from "@/lib/appConfig";
const APP_SPLASH_PLAY_MS = 3000;
const APP_SPLASH_FADE_MS = 450;

const AppSplash = lazy(() =>
  import("./components/AppSplash").then((module) => ({ default: module.AppSplash })),
);

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
const AuthenticatedUsers = lazy(() => import("./pages/admin/AuthenticatedUsers"));
const ChangePassword = lazy(() => import("./pages/admin/ChangePassword"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const EmployeePageNotices = lazy(() => import("./pages/admin/EmployeePageNotices"));
const EmailLogs = lazy(() => import("./pages/admin/EmailLogs"));
const CronJobs = lazy(() => import("./pages/admin/CronJobs"));
const CacheMonitoring = lazy(() => import("./pages/admin/CacheMonitoring"));

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
const DutyReport = lazy(() => import("./pages/supervisor/DutyReport"));
const SupervisorSuggestions = lazy(() => import("./pages/supervisor/SupervisorSuggestions"));
const AvailabilityFinder = lazy(() => import("./pages/supervisor/AvailabilityFinder"));
const ComplianceDashboard = lazy(() => import("./pages/supervisor/ComplianceDashboard"));
const ComplianceAuditLog = lazy(() => import("./pages/supervisor/ComplianceAuditLog"));
const RuleGovernance = lazy(() => import("./pages/supervisor/RuleGovernance"));
const DutyManagement = lazy(() => import("./pages/supervisor/DutyManagement"));
const ShiftDetails = lazy(() => import("./pages/supervisor/ShiftDetails"));
const LicenseManagement = lazy(() => import("./pages/supervisor/LicenseManagement"));
const MedicalList = lazy(() => import("./pages/supervisor/MedicalList"));
const RatingsManagement = lazy(() => import("./pages/supervisor/RatingsManagement"));
const ProficiencyList = lazy(() => import("./pages/supervisor/ProficiencyList"));
const TraineeDetails = lazy(() => import("./pages/supervisor/TraineeDetails"));
const SupervisorRosterView = lazy(() => import("./pages/supervisor/SupervisorRosterView"));
const SupervisorAvailabilityReport = lazy(() => import("./pages/supervisor/SupervisorAvailabilityReport"));
const WorkingHours = lazy(() => import("./pages/supervisor/WorkingHours"));

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
const EmployeeBATestList = lazy(() => import("./pages/employee/EmployeeBATestList"));

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

function BootSplashFallback({ isExiting }: { isExiting: boolean }) {
  return (
    <div
      className={`fixed inset-0 z-[140] flex min-h-screen items-center justify-center overflow-hidden bg-[#061736] px-6 py-10 text-white transition-all duration-500 ease-out ${
        isExiting ? "scale-[1.02] opacity-0 blur-sm" : ""
      }`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(90,190,255,0.18),_transparent_30%),radial-gradient(circle_at_82%_18%,_rgba(94,234,212,0.14),_transparent_16%),linear-gradient(180deg,_#08111d_0%,_#0a1a2e_52%,_#040b14_100%)]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="absolute left-1/2 top-1/2 h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-400/10 blur-3xl" />
      <div className="relative z-10 flex w-full max-w-lg flex-col items-center text-center">
        <div className="relative mb-8 flex h-44 w-44 items-center justify-center sm:h-52 sm:w-52">
          <div className="absolute -inset-8 rounded-[2.5rem] bg-[radial-gradient(circle,_rgba(56,189,248,0.22)_0%,_transparent_62%)] blur-3xl" />
          <div className="absolute inset-0 rounded-[2rem] border border-white/10 bg-white/[0.05] shadow-[0_28px_90px_rgba(2,12,27,0.58)] backdrop-blur-2xl" />
          <div className="absolute inset-3 rounded-[1.7rem] border border-white/[0.08]" />
          <div className="absolute inset-7 rounded-full border border-sky-200/20 animate-[spin_16s_linear_infinite]" />
          <div className="relative flex h-28 w-28 items-center justify-center rounded-[1.35rem] border border-white/10 bg-white/[0.05] shadow-[0_14px_40px_rgba(2,12,27,0.42)] sm:h-32 sm:w-32">
            <img
              src="/logo.png"
              alt={APP_NAME}
              className="h-20 w-20 object-contain drop-shadow-[0_10px_24px_rgba(125,211,252,0.2)] sm:h-24 sm:w-24"
            />
          </div>
        </div>
        <div className="space-y-4">
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.48em] text-sky-100/70 sm:text-xs">
            Operations Suite
          </p>
          <h1 className="text-[2.2rem] font-semibold tracking-[0.18em] text-white sm:text-[2.8rem]">{APP_NAME}</h1>
        </div>
        <div className="mt-8 w-60 sm:w-72">
          <div className="relative h-[2px] overflow-hidden rounded-full bg-white/12">
            <span
              className="absolute inset-y-0 left-[-35%] w-1/2 rounded-full bg-gradient-to-r from-transparent via-sky-200 to-transparent shadow-[0_0_18px_rgba(125,211,252,0.55)]"
              style={{ animation: "splash-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite" }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between text-[0.62rem] uppercase tracking-[0.34em] text-sky-100/70 sm:text-[0.68rem]">
            <span>Loading workspace</span>
            <span className="text-emerald-200/75">Syncing</span>
          </div>
        </div>
      </div>
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
            {showBootSplash ? (
              <Suspense fallback={<BootSplashFallback isExiting={bootSplashExiting} />}>
                <AppSplash isExiting={bootSplashExiting} />
              </Suspense>
            ) : null}
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
                    <Route path="/admin/authenticated-users" element={<ProtectedRoute allowedRoles={['admin']}><AuthenticatedUsers /></ProtectedRoute>} />
                    <Route path="/admin/change-password" element={<ProtectedRoute allowedRoles={['admin']}><ChangePassword /></ProtectedRoute>} />
                    <Route path="/admin/settings" element={<ProtectedRoute allowedRoles={['admin']}><AdminSettings /></ProtectedRoute>} />
                    <Route path="/admin/employee-page-notices" element={<ProtectedRoute allowedRoles={['admin']}><EmployeePageNotices /></ProtectedRoute>} />
                    <Route path="/admin/email-logs" element={<ProtectedRoute allowedRoles={['admin']}><EmailLogs /></ProtectedRoute>} />
                    <Route path="/admin/cron-jobs" element={<ProtectedRoute allowedRoles={['admin']}><CronJobs /></ProtectedRoute>} />
                    <Route path="/admin/cache" element={<ProtectedRoute allowedRoles={['admin']}><CacheMonitoring /></ProtectedRoute>} />

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
                    <Route path="/supervisor/suggestions" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorSuggestions /></ProtectedRoute>} />
                    <Route path="/supervisor/availability-finder" element={<ProtectedRoute allowedRoles={['supervisor']}><AvailabilityFinder /></ProtectedRoute>} />
                    <Route path="/supervisor/compliance" element={<ProtectedRoute allowedRoles={['supervisor']}><ComplianceDashboard /></ProtectedRoute>} />
                    <Route path="/supervisor/compliance-audit" element={<ProtectedRoute allowedRoles={['supervisor']}><ComplianceAuditLog /></ProtectedRoute>} />
                    <Route path="/supervisor/rule-governance" element={<ProtectedRoute allowedRoles={['supervisor']}><RuleGovernance /></ProtectedRoute>} />
                    <Route path="/supervisor/duty-management" element={<ProtectedRoute allowedRoles={['supervisor']}><DutyManagement /></ProtectedRoute>} />
                    <Route path="/supervisor/shift-details" element={<ProtectedRoute allowedRoles={['supervisor']}><ShiftDetails /></ProtectedRoute>} />
                    <Route path="/supervisor/roster" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorDailyRoster /></ProtectedRoute>} />
                    <Route path="/supervisor/roster-view" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorRosterView /></ProtectedRoute>} />
                    <Route path="/supervisor/availability-report" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorAvailabilityReport /></ProtectedRoute>} />
                    <Route path="/supervisor/licenses" element={<ProtectedRoute allowedRoles={['supervisor', 'admin']}><LicenseManagement /></ProtectedRoute>} />
                    <Route path="/supervisor/licenses/medical-list" element={<ProtectedRoute allowedRoles={['supervisor', 'admin']}><MedicalList /></ProtectedRoute>} />
                    <Route path="/supervisor/ratings" element={<ProtectedRoute allowedRoles={['supervisor', 'admin']}><RatingsManagement /></ProtectedRoute>} />
                    <Route path="/supervisor/ratings/proficiency-list" element={<ProtectedRoute allowedRoles={['supervisor', 'admin']}><ProficiencyList /></ProtectedRoute>} />
                    <Route path="/supervisor/trainees" element={<ProtectedRoute allowedRoles={['supervisor', 'admin']}><TraineeDetails /></ProtectedRoute>} />
                    <Route path="/supervisor/email-logs" element={<ProtectedRoute allowedRoles={['supervisor']}><EmailLogs portalRole="supervisor" /></ProtectedRoute>} />
                    <Route path="/supervisor/working-hours" element={<ProtectedRoute allowedRoles={['supervisor']}><WorkingHours /></ProtectedRoute>} />
                    <Route path="/supervisor/duty-report" element={<ProtectedRoute allowedRoles={['supervisor']}><DutyReport /></ProtectedRoute>} />

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
                    <Route path="/employee/ba-test-list" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeBATestList /></ProtectedRoute>} />

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
