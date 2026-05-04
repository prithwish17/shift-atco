import { ReactNode, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { Moon, Sun, Settings, ArrowLeft } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "./AppSidebar";
import { EmployeePageNoticeGate } from "./EmployeePageNoticeGate";
import { NotificationDropdown } from "./NotificationDropdown";
import { getHomeRouteForRole } from "@/lib/roleRoutes";

// Module-level stack — persists for the app session, resets on hard refresh
const appNavStack: string[] = [];

type Role = "admin" | "supervisor" | "wso" | "employee";

interface DashboardLayoutProps {
  role: Role;
  children: ReactNode;
}

export function DashboardLayout({ role, children }: DashboardLayoutProps) {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const navigate = useNavigate();
  const location = useLocation();

  const homeRoute = getHomeRouteForRole(role);
  const currentPath = location.pathname + location.search;

  // Push current path to stack whenever it changes
  useEffect(() => {
    const last = appNavStack[appNavStack.length - 1];
    if (last !== currentPath) {
      appNavStack.push(currentPath);
    }
  }, [currentPath]);

  // Show back button on any page that isn't the role's home dashboard
  const canGoBack = currentPath !== homeRoute;

  const handleBack = () => {
    // Remove current page from end of stack
    if (appNavStack[appNavStack.length - 1] === currentPath) {
      appNavStack.pop();
    }
    const prev = appNavStack[appNavStack.length - 1];
    if (prev) {
      navigate(prev);
    } else {
      navigate(homeRoute);
    }
  };

  const displayName = profile?.full_name || "User";
  const initials = displayName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen w-full bg-gray-50 dark:bg-gray-950">
      <AppSidebar role={role} />
      {role === "employee" ? <EmployeePageNoticeGate /> : null}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-10">
          {/* Mobile menu button is now in AppSidebar */}
          <div className="lg:hidden w-10" />

          {canGoBack ? (
            <button
              onClick={handleBack}
              className="hidden lg:flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowLeft className="size-4" />
              Back
            </button>
          ) : (
            <div className="hidden lg:block flex-none" />
          )}

          <div className="flex items-center gap-2 md:gap-4">
            <Button asChild type="button" variant="outline" size="sm" className="hidden sm:inline-flex">
              <Link to={`/settings?portal=${role}`}>
                <Settings className="size-4" />
                <span>Settings</span>
              </Link>
            </Button>

            <Link
              to={`/settings?portal=${role}`}
              className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800 sm:hidden"
              aria-label="Open app settings"
            >
              <Settings className="size-5 text-gray-600 dark:text-gray-300" />
            </Link>

            {/* Notification bell */}
            <NotificationDropdown />

            {/* Theme toggle */}
            <button
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              onClick={toggleTheme}
            >
              {theme === "light" ? (
                <Moon className="size-5 text-gray-600" />
              ) : (
                <Sun className="size-5 text-gray-300" />
              )}
            </button>

            {/* User avatar */}
            <Link
              to="/employee/profile"
              className="flex items-center gap-2 rounded-xl p-1 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-800 md:gap-3"
            >
              <Avatar className="size-8 border border-gray-200 md:size-9 dark:border-gray-700">
                <AvatarImage src={profile?.photo_url || undefined} alt={displayName} />
                <AvatarFallback className="bg-blue-500 text-xs font-semibold text-white md:text-sm">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="text-sm hidden sm:block">
                <div className="font-semibold text-gray-900 dark:text-gray-100">{displayName}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">{role}</div>
              </div>
            </Link>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>

    </div>
  );
}
