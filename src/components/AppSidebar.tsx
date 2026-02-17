import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Users,
  Settings,
  ClipboardList,
  Calendar,
  UserCog,
  FileText,
  Clock,
  Shield,
  LogOut,
  Radio,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

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
    { title: "Daily Roster", url: "/roster", icon: ClipboardList },
    { title: "Holidays", url: "/supervisor/holidays", icon: Calendar },
    { title: "Profile Settings", url: "/supervisor/profile", icon: UserCog },
  ],
  wso: [
    { title: "Dashboard", url: "/wso", icon: LayoutDashboard },
    { title: "Roster Management", url: "/wso/roster", icon: Calendar },
    { title: "Attendance", url: "/wso/attendance", icon: ClipboardList },
    { title: "ATC Duty Grid", url: "/wso/atc-grid", icon: Radio },
    { title: "BA Test Management", url: "/wso/ba-test", icon: Shield },
    { title: "Requests", url: "/wso/requests", icon: FileText },
    { title: "Profile Settings", url: "/wso/profile", icon: UserCog },
  ],
  employee: [
    { title: "Dashboard", url: "/employee", icon: LayoutDashboard },
    { title: "My Schedule", url: "/employee/schedule", icon: Calendar },
    { title: "Daily Roster", url: "/employee/roster", icon: ClipboardList },
    { title: "ATC Duties", url: "/employee/atc-duties", icon: Radio },
    { title: "Apply for Leave", url: "/employee/leave", icon: FileText },
    { title: "Duty Exchange", url: "/employee/duty-exchange", icon: Clock },
    { title: "Leave History", url: "/employee/leave-history", icon: ClipboardList },
    { title: "Profile Settings", url: "/employee/profile", icon: UserCog },
  ],
};

export function AppSidebar({ role }: SidebarProps) {
  const { state } = useSidebar();
  const { signOut } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname;

  const items = menuItems[role] || [];
  const isCollapsed = state === "collapsed";

  const isActive = (url: string) => {
    if (url === `/${role}`) {
      return currentPath === url;
    }
    return currentPath.startsWith(url);
  };

  const getNavCls = (url: string) => {
    return isActive(url)
      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
      : "hover:bg-sidebar-accent/50";
  };

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {!isCollapsed && (
          <div className="px-4 py-4 border-b border-sidebar-border">
            <h2 className="text-lg font-bold text-sidebar-primary">ShiftPlan</h2>
            <p className="text-xs text-sidebar-foreground/60 capitalize">{role} Portal</p>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end={item.url === `/${role}`} className={getNavCls(item.url)}>
                      <item.icon className="h-4 w-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              {!isCollapsed && <span>Logout</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
