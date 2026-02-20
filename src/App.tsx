import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Index from "./pages/Index";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import Register from "./pages/Register";
import AdminDashboard from "./pages/admin/AdminDashboard";
import UserManagement from "./pages/admin/UserManagement";
import ChangePassword from "./pages/admin/ChangePassword";
import AdminSettings from "./pages/admin/AdminSettings";
import SetupAdmin from "./pages/admin/SetupAdmin";
import SupervisorDashboard from "./pages/supervisor/SupervisorDashboard";
import SupervisorAttendance from "./pages/supervisor/SupervisorAttendance";
import EmployeeManagement from "./pages/supervisor/EmployeeManagement";
import WSODashboard from "./pages/wso/WSODashboard";
import WsoRosterManagement from "./pages/wso/WsoRosterManagement";
import WSOAttendance from "./pages/wso/WSOAttendance";
import BATestManagement from "./pages/wso/BATestManagement";
import EmployeeDashboard from "./pages/employee/EmployeeDashboard";
import EmployeeProfile from "./pages/employee/EmployeeProfile";
import EmployeeSchedule from "./pages/employee/EmployeeSchedule";
import LeaveApplication from "./pages/employee/LeaveApplication";
import DutyExchangeRequest from "./pages/employee/DutyExchangeRequest";
import EmployeeRoster from "./pages/employee/EmployeeRoster";
import LeaveApprovals from "./pages/supervisor/LeaveApprovals";
import DutyExchangeApprovals from "./pages/supervisor/DutyExchangeApprovals";
import HolidayManagement from "./pages/supervisor/HolidayManagement";
import ATCDutyGrid from "./pages/atc/ATCDutyGrid";
import EmployeeATCDuties from "./pages/atc/EmployeeATCDuties";
import WSOATCView from "./pages/atc/WSOATCView";
import SupervisorATCView from "./pages/atc/SupervisorATCView";
import NotFound from "./pages/NotFound";

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
                <Route path="/supervisor/leaves" element={<ProtectedRoute allowedRoles={['supervisor']}><LeaveApprovals /></ProtectedRoute>} />
                <Route path="/supervisor/duty-exchanges" element={<ProtectedRoute allowedRoles={['supervisor']}><DutyExchangeApprovals /></ProtectedRoute>} />
                <Route path="/supervisor/holidays" element={<ProtectedRoute allowedRoles={['supervisor']}><HolidayManagement /></ProtectedRoute>} />

                {/* WSO Routes */}
                <Route path="/wso" element={<ProtectedRoute allowedRoles={['wso']}><WSODashboard /></ProtectedRoute>} />
                <Route path="/wso/roster" element={<ProtectedRoute allowedRoles={['wso']}><WsoRosterManagement /></ProtectedRoute>} />
                <Route path="/wso/attendance" element={<ProtectedRoute allowedRoles={['wso']}><WSOAttendance /></ProtectedRoute>} />
                <Route path="/wso/ba-test" element={<ProtectedRoute allowedRoles={['wso']}><BATestManagement /></ProtectedRoute>} />

                {/* Employee Routes */}
                <Route path="/employee" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeDashboard /></ProtectedRoute>} />
                <Route path="/employee/profile" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeProfile /></ProtectedRoute>} />
                <Route path="/employee/schedule" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeSchedule /></ProtectedRoute>} />
                <Route path="/employee/leave" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><LeaveApplication /></ProtectedRoute>} />
                <Route path="/employee/duty-exchange" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><DutyExchangeRequest /></ProtectedRoute>} />
                <Route path="/employee/atc-duties" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeATCDuties /></ProtectedRoute>} />
                <Route path="/employee/roster" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeRoster /></ProtectedRoute>} />

                {/* ATC Routes */}
                <Route path="/atc/grid" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><ATCDutyGrid /></ProtectedRoute>} />
                <Route path="/wso/atc-grid" element={<ProtectedRoute allowedRoles={['wso']}><WSOATCView /></ProtectedRoute>} />
                <Route path="/supervisor/atc-grid" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorATCView /></ProtectedRoute>} />

                {/* Shared Roster Route — redirects to employee roster view */}
                <Route path="/roster" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'supervisor', 'wso']}><EmployeeRoster /></ProtectedRoute>} />

                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
