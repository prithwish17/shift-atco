import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Table2,
  Users,
  Settings,
  ClipboardList,
  Calendar,
  CalendarDays,
  FileText,
  Clock,
  Shield,
  LogOut,
  Radio,
  ArrowLeftRight,
  BarChart3,
  History,
  X,
  Menu,
  UserCog,
} from "lucide-react";
import { useState, useEffect } from "react";

type Role = "admin" | "supervisor" | "wso" | "employee";

interface SidebarProps {
  role: Role;
}

const menuItems = {
  admin: [
    { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
    { title: "User Management", url: "/admin/users", icon: Users },
    { title: "System Settings", url: "/admin/settings", icon: Settings },
    { title: "Change Password", url: "/admin/change-password", icon: Shield },
  ],
  supervisor: [
    { title: "Dashboard", url: "/supervisor", icon: LayoutDashboard },
    { title: "Employee Management", url: "/supervisor/employees", icon: Users },
    { title: "Attendance", url: "/supervisor/attendance", icon: ClipboardList },
    { title: "Leave Management", url: "/supervisor/leaves", icon: FileText },
    { title: "Duty Exchange", url: "/supervisor/duty-exchange", icon: Calendar },
    { title: "ATC Duty Grid", url: "/supervisor/atc-grid", icon: Radio },
    { title: "Roster Management", url: "/supervisor/duty-management", icon: CalendarDays },
    { title: "Daily Roster", url: "/roster", icon: ClipboardList },
    { title: "Holidays", url: "/supervisor/holidays", icon: Calendar },
    { title: "Profile Settings", url: "/supervisor/profile", icon: UserCog },
  ],
  wso: [
    { title: "Dashboard", url: "/wso", icon: LayoutDashboard },
    { title: "Attendance", url: "/wso/attendance", icon: ClipboardList },
    { title: "Shift Duty Roster", url: "/wso/atc-grid", icon: Table2 },
    { title: "BA Test Management", url: "/wso/ba-test", icon: Shield },
    { title: "Leave Requests", url: "/wso/leaves", icon: FileText },
    { title: "Roster Data", url: "/wso/roster", icon: Calendar },
    { title: "Profile Settings", url: "/wso/profile", icon: UserCog },
  ],
  employee: [
    { title: "Dashboard", url: "/employee", icon: LayoutDashboard },
    { title: "My Duty Schedule", url: "/employee/schedule", icon: Calendar },
    { title: "Shift Duty Roster", url: "/employee/atc-duties", icon: Table2 },
    { title: "Apply for Leave", url: "/employee/leave", icon: FileText },
    { title: "Duty Exchange", url: "/employee/duty-exchange", icon: ArrowLeftRight },
    { title: "Leave History", url: "/employee/leave-history", icon: History },
    { title: "Profile Settings", url: "/employee/profile", icon: UserCog },
  ],
};

const switchDashboardItems: Record<string, { title: string; url: string; icon: typeof LayoutDashboard }> = {
  admin: { title: "Admin Dashboard", url: "/admin", icon: Shield },
  supervisor: { title: "Supervisor Dashboard", url: "/supervisor", icon: Users },
  wso: { title: "WSO Dashboard", url: "/wso", icon: BarChart3 },
  employee: { title: "Employee Dashboard", url: "/employee", icon: LayoutDashboard },
};

export function AppSidebar({ role }: SidebarProps) {
  const { signOut, userRole } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname;
  const [mobileOpen, setMobileOpen] = useState(false);

  // Listen for toggle event from DashboardLayout header
  useEffect(() => {
    const handler = () => setMobileOpen(prev => !prev);
    window.addEventListener('toggle-sidebar', handler);
    return () => window.removeEventListener('toggle-sidebar', handler);
  }, []);

  const items = menuItems[role] || [];

  const isActive = (url: string) => {
    if (url === `/${role}`) return currentPath === url;
    return currentPath.startsWith(url);
  };

  const handleLogout = async () => {
    await signOut();
  };

  // Determine switch dashboard target
  const showSwitchToRole = role === 'employee' && userRole && userRole !== 'employee'
    ? userRole
    : role !== 'employee'
      ? 'employee'
      : null;

  const switchItem = showSwitchToRole ? switchDashboardItems[showSwitchToRole] : null;

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile hamburger (rendered by DashboardLayout header) */}

      {/* Sidebar */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-52 bg-slate-900 text-white flex flex-col
        transform transition-transform duration-300 lg:transform-none
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="ShiftAtco" className="size-8 rounded" />
            <div>
              <div className="text-blue-400 font-bold text-base leading-tight">ShiftAtco</div>
              <div className="text-xs text-slate-400 capitalize">{role} Portal</div>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1 hover:bg-slate-800 rounded"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 min-h-0 px-3 py-4 overflow-y-auto">
          <div className="text-xs text-slate-400 mb-3 px-2">Navigation</div>
          <div className="space-y-1">
            {items.map((item) => (
              <NavLink
                key={item.title}
                to={item.url}
                end={item.url === `/${role}`}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isActive(item.url)
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
                  }`}
              >
                <item.icon className="size-4" />
                <span>{item.title}</span>
              </NavLink>
            ))}
          </div>

          {/* Switch Dashboard */}
          {switchItem && (
            <>
              <div className="text-xs text-slate-400 mb-3 px-2 mt-6">Switch Dashboard</div>
              <div className="space-y-1">
                <NavLink
                  to={switchItem.url}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 text-sm transition-colors"
                >
                  <switchItem.icon className="size-4" />
                  <span>{switchItem.title}</span>
                </NavLink>
              </div>
            </>
          )}
        </nav>

        {/* Logout — always pinned to bottom of sidebar */}
        <div className="shrink-0 p-3 border-t border-slate-700">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-300 hover:bg-red-600/20 hover:text-red-400 w-full text-sm transition-colors"
          >
            <LogOut className="size-4" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </>
  );
}

/** Exported for DashboardLayout to trigger mobile sidebar */
export { Menu as MenuIcon };
