import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";

// --- Lazy-loaded page components (code splitting) ---
const Index = lazy(() => import("./pages/Index"));
const Login = lazy(() => import("./pages/Login"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Register = lazy(() => import("./pages/Register"));
const SetupAdmin = lazy(() => import("./pages/admin/SetupAdmin"));
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
const SupervisorDailyRoster = lazy(() => import("./pages/supervisor/SupervisorDailyRoster"));
const LeaveApprovals = lazy(() => import("./pages/supervisor/LeaveApprovals"));
const SupervisorLeaveDashboard = lazy(() => import("./pages/supervisor/SupervisorLeaveDashboard"));
const DutyExchangeApprovals = lazy(() => import("./pages/supervisor/DutyExchangeApprovals"));
const HolidayManagement = lazy(() => import("./pages/supervisor/HolidayManagement"));
const OPEAssignments = lazy(() => import("./pages/supervisor/OPEAssignments"));
const DutyManagement = lazy(() => import("./pages/supervisor/DutyManagement"));
const LicenseManagement = lazy(() => import("./pages/supervisor/LicenseManagement"));

// WSO
const WSODashboard = lazy(() => import("./pages/wso/WSODashboard"));
const WsoRosterManagement = lazy(() => import("./pages/wso/WsoRosterManagement"));
const WSOAttendance = lazy(() => import("./pages/wso/WSOAttendance"));
const BATestManagement = lazy(() => import("./pages/wso/BATestManagement"));

// Employee
const EmployeeDashboard = lazy(() => import("./pages/employee/EmployeeDashboard"));
const EmployeeProfile = lazy(() => import("./pages/employee/EmployeeProfile"));
const EmployeeSchedule = lazy(() => import("./pages/employee/EmployeeSchedule"));
const LeaveApplication = lazy(() => import("./pages/employee/LeaveApplication"));
const LeaveHistory = lazy(() => import("./pages/employee/LeaveHistory"));
const EmployeeLeavePage = lazy(() => import("./pages/employee/EmployeeLeavePage"));
const DutyExchangeRequest = lazy(() => import("./pages/employee/DutyExchangeRequest"));
const EmployeeRoster = lazy(() => import("./pages/employee/EmployeeRoster"));
const EmployeeHolidays = lazy(() => import("./pages/employee/EmployeeHolidays"));
const EmployeeLicenses = lazy(() => import("./pages/employee/EmployeeLicenses"));

// ATC
const ATCDutyGrid = lazy(() => import("./pages/atc/ATCDutyGrid"));
const EmployeeATCDuties = lazy(() => import("./pages/atc/EmployeeATCDuties"));
const WSOATCView = lazy(() => import("./pages/atc/WSOATCView"));
const SupervisorATCView = lazy(() => import("./pages/atc/SupervisorATCView"));

// --- Suspense fallback spinner ---
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
  </div>
);

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

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/setup-admin" element={<SetupAdmin />} />

                  {/* Admin Routes */}
                  <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
                  <Route path="/admin/users" element={<ProtectedRoute allowedRoles={['admin']}><UserManagement /></ProtectedRoute>} />
                  <Route path="/admin/change-password" element={<ProtectedRoute allowedRoles={['admin']}><ChangePassword /></ProtectedRoute>} />
                  <Route path="/admin/settings" element={<ProtectedRoute allowedRoles={['admin']}><AdminSettings /></ProtectedRoute>} />

                  {/* Supervisor Routes */}
                  <Route path="/supervisor" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorDashboard /></ProtectedRoute>} />
                  <Route path="/supervisor/employees" element={<ProtectedRoute allowedRoles={['supervisor']}><EmployeeManagement /></ProtectedRoute>} />
                  <Route path="/supervisor/attendance" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorAttendance /></ProtectedRoute>} />
                  <Route path="/supervisor/leaves" element={<ProtectedRoute allowedRoles={['supervisor', 'wso']}><LeaveApprovals /></ProtectedRoute>} />
                  <Route path="/supervisor/leave-dashboard" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorLeaveDashboard /></ProtectedRoute>} />
                  <Route path="/supervisor/duty-exchanges" element={<ProtectedRoute allowedRoles={['supervisor']}><DutyExchangeApprovals /></ProtectedRoute>} />
                  <Route path="/supervisor/holidays" element={<ProtectedRoute allowedRoles={['supervisor']}><HolidayManagement /></ProtectedRoute>} />
                  <Route path="/supervisor/ope-assignments" element={<ProtectedRoute allowedRoles={['supervisor']}><OPEAssignments /></ProtectedRoute>} />
                  <Route path="/supervisor/duty-management" element={<ProtectedRoute allowedRoles={['supervisor']}><DutyManagement /></ProtectedRoute>} />
                  <Route path="/supervisor/roster" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorDailyRoster /></ProtectedRoute>} />
                  <Route path="/supervisor/licenses" element={<ProtectedRoute allowedRoles={['supervisor', 'admin']}><LicenseManagement /></ProtectedRoute>} />

                  {/* WSO Routes */}
                  <Route path="/wso" element={<ProtectedRoute allowedRoles={['wso']}><WSODashboard /></ProtectedRoute>} />
                  <Route path="/wso/roster" element={<ProtectedRoute allowedRoles={['wso']}><WsoRosterManagement /></ProtectedRoute>} />
                  <Route path="/wso/attendance" element={<ProtectedRoute allowedRoles={['wso']}><WSOAttendance /></ProtectedRoute>} />
                  <Route path="/wso/ba-test" element={<ProtectedRoute allowedRoles={['wso']}><BATestManagement /></ProtectedRoute>} />
                  <Route path="/wso/leaves" element={<ProtectedRoute allowedRoles={['wso']}><LeaveApprovals /></ProtectedRoute>} />

                  {/* Employee Routes */}
                  <Route path="/employee" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeDashboard /></ProtectedRoute>} />
                  <Route path="/employee/profile" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeProfile /></ProtectedRoute>} />
                  <Route path="/employee/schedule" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeSchedule /></ProtectedRoute>} />
                  <Route path="/employee/leave" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><LeaveApplication /></ProtectedRoute>} />
                  <Route path="/employee/leave-history" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><LeaveHistory /></ProtectedRoute>} />
                  <Route path="/employee/leave-dashboard" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeLeavePage /></ProtectedRoute>} />
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
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
