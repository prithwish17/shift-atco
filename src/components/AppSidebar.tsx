import { Link, NavLink, useLocation } from "react-router-dom";
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
  X,
  UserCog,
  Activity,
  Mail,
  GraduationCap,
  AlertTriangle,
  Timer,
  ChevronDown,
  Database,
  ChevronLeft,
  Menu,
  Share2,
  UserSearch,
  ShieldCheck,
  History,
  BookLock,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { ShareAppDialog } from "@/components/ShareAppDialog";

type Role = "admin" | "supervisor" | "wso" | "employee";

interface SidebarProps {
  role: Role;
}

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
}

interface NavSection {
  id: string;
  label: string;
  icon: React.ElementType;
  items: NavItem[];
}

interface SupervisorNav {
  topItems: NavItem[];
  sections: NavSection[];
  bottomItems: NavItem[];
}

// ── Supervisor structured nav ───────────────────────────────────────────────

const supervisorNav: SupervisorNav = {
  topItems: [
    { title: "Dashboard", url: "/supervisor", icon: LayoutDashboard },
  ],
  sections: [
    {
      id: "hrd",
      label: "HRD",
      icon: Users,
      items: [
        { title: "Schedule Management", url: "/supervisor/duty-management", icon: CalendarDays },
        { title: "Leave Dashboard", url: "/supervisor/leave-dashboard", icon: BarChart3 },
        { title: "Employee Management", url: "/supervisor/employees", icon: Users },
        { title: "Mark Attendance", url: "/supervisor/attendance", icon: ClipboardList },
        { title: "View Attendance", url: "/supervisor/attendance-view", icon: Calendar },
        { title: "Daily Availability Chart", url: "/supervisor/roster-view", icon: Table2 },
        { title: "Duty Report", url: "/supervisor/duty-report", icon: ClipboardList },
      ],
    },
    {
      id: "cap",
      label: "CAP",
      icon: GraduationCap,
      items: [
        { title: "License Management", url: "/supervisor/licenses", icon: Shield },
        { title: "Ratings Management", url: "/supervisor/ratings", icon: Shield },
      ],
    },
    {
      id: "others",
      label: "Others",
      icon: Menu,
      items: [
        { title: "Shift Duty Grid", url: "/supervisor/atc-grid", icon: Radio },
        { title: "Shift Roster Data", url: "/supervisor/roster", icon: ClipboardList },
        { title: "Holidays", url: "/supervisor/holidays", icon: CalendarDays },
        { title: "Email Logs", url: "/supervisor/email-logs", icon: Mail },
      ],
    },
  ],
  bottomItems: [
    { title: "Availability Finder", url: "/supervisor/availability-finder", icon: UserSearch },
    { title: "Compliance Dashboard", url: "/supervisor/compliance", icon: ShieldCheck },
    { title: "Compliance Audit Log", url: "/supervisor/compliance-audit", icon: History },
    { title: "Rule Governance", url: "/supervisor/rule-governance", icon: BookLock },
    { title: "Leave Review", url: "/supervisor/leaves", icon: FileText },
    { title: "Duty Exchange", url: "/supervisor/duty-exchange", icon: ArrowLeftRight },
    { title: "Trainee Details", url: "/supervisor/trainees", icon: GraduationCap },
    { title: "Working Hours", url: "/supervisor/working-hours", icon: Clock },
    { title: "Shift Details", url: "/supervisor/shift-details", icon: Table2 },
  ],
};

// ── Flat nav for other roles ────────────────────────────────────────────────

const menuItems = {
  admin: [
    { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
    { title: "User Management", url: "/admin/users", icon: Users },
    { title: "Authenticated Users", url: "/admin/authenticated-users", icon: Shield },
    { title: "System Settings", url: "/admin/settings", icon: Settings },
    { title: "Employee Page Notices", url: "/admin/employee-page-notices", icon: AlertTriangle },
    { title: "Change Password", url: "/admin/change-password", icon: Shield },
    { title: "Email Logs", url: "/admin/email-logs", icon: Mail },
    { title: "Cron Jobs", url: "/admin/cron-jobs", icon: Timer },
    { title: "Cache Monitoring", url: "/admin/cache", icon: Database },
  ],
  wso: [
    { title: "Dashboard", url: "/wso", icon: LayoutDashboard },
    { title: "Attendance", url: "/wso/attendance", icon: ClipboardList },
    { title: "Shift Duty Roster", url: "/wso/atc-grid", icon: Table2 },
    { title: "BA Test Management", url: "/wso/ba-test", icon: Shield },
    { title: "Leave Requests", url: "/wso/leaves", icon: FileText },
    { title: "Duty Exchange", url: "/wso/duty-exchange", icon: ArrowLeftRight },
    { title: "OPE Duty", url: "/wso/ope-assignments", icon: Activity },
    { title: "Roster Data", url: "/wso/roster", icon: Calendar },
  ],
  employee: [
    { title: "Dashboard", url: "/employee", icon: LayoutDashboard },
    { title: "My Duty Schedule", url: "/employee/schedule", icon: Calendar },
    { title: "My Leave Summary", url: "/employee/leave-dashboard", icon: BarChart3 },
    { title: "License Status", url: "/employee/licenses", icon: Shield },
    { title: "Apply for Leave", url: "/employee/leave", icon: FileText },
    { title: "Duty Exchange", url: "/employee/duty-exchange", icon: ArrowLeftRight },
    { title: "My Attendance", url: "/employee/attendance", icon: ClipboardList },
    { title: "Holidays", url: "/employee/holidays", icon: CalendarDays },
    { title: "Shift Duty Roster", url: "/employee/atc-duties", icon: Table2 },
    { title: "Comp-Off Details", url: "/employee/comp-off", icon: Clock },
    { title: "BA Test List", url: "/employee/ba-test-list", icon: Activity },
    { title: "Profile Settings", url: "/employee/profile", icon: UserCog },
  ],
};

const switchDashboardItems: Record<string, { title: string; url: string; icon: typeof LayoutDashboard }> = {
  admin: { title: "Admin Dashboard", url: "/admin", icon: Shield },
  supervisor: { title: "Supervisor Dashboard", url: "/supervisor", icon: Users },
  wso: { title: "WSO Dashboard", url: "/wso", icon: BarChart3 },
  employee: { title: "Employee Dashboard", url: "/employee", icon: LayoutDashboard },
};

// ── Component ───────────────────────────────────────────────────────────────

export function AppSidebar({ role }: SidebarProps) {
  const { signOut, userRole } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  // Listen for toggle event from DashboardLayout header
  useEffect(() => {
    const handler = () => setMobileOpen(prev => !prev);
    window.addEventListener('toggle-sidebar', handler);
    return () => window.removeEventListener('toggle-sidebar', handler);
  }, []);

  // Toggle sidebar collapsed state
  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => !prev);
  }, []);

  // Auto-open the section that contains the current active route (accordion: only one open)
  useEffect(() => {
    if (role !== "supervisor") return;
    const activeSection = supervisorNav.sections.find(section =>
      section.items.some(item =>
        currentPath === item.url || currentPath.startsWith(item.url + '/')
      )
    );
    if (activeSection) {
      setOpenSection(activeSection.id);
    }
  }, [currentPath, role]);

  // Accordion: opening a section collapses any other open one
  const toggleSection = useCallback((id: string) => {
    setOpenSection(prev => (prev === id ? null : id));
  }, []);

  const isActive = (url: string) => {
    if (url === `/${role}`) return currentPath === url;
    return currentPath === url || currentPath.startsWith(url + '/');
  };

  const handleLogout = async () => {
    await signOut();
  };

  const showSwitchToRole = role === 'employee' && userRole && userRole !== 'employee'
    ? userRole
    : role !== 'employee'
      ? 'employee'
      : null;

  const switchItem = showSwitchToRole ? switchDashboardItems[showSwitchToRole] : null;

  const navLinkClass = (url: string) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg border-l-2 text-sm transition-all duration-300 ${
      isActive(url) 
        ? 'border-[#60a5fa] bg-[#EEF2FF] text-[#151A2D] font-medium' 
        : 'border-[#60a5fa]/40 bg-[#1e2742]/45 text-[#F1F4FF] hover:border-[#60a5fa] hover:bg-[#EEF2FF] hover:text-[#151A2D]'
    } ${collapsed ? 'justify-center' : ''}`;

  const sectionHeaderClass = (hasActiveChild: boolean) =>
    `flex w-full items-center gap-3 px-3 py-2 rounded-lg border border-[#2d3748] text-sm font-medium transition-all duration-300 ${
      hasActiveChild
        ? 'bg-[#EEF2FF]/10 text-[#EEF2FF] border-[#60a5fa]/40'
        : 'bg-[#111827]/40 text-[#94a3b8] hover:bg-[#EEF2FF]/10 hover:text-[#EEF2FF] hover:border-[#60a5fa]/30'
    } ${collapsed ? 'justify-center' : ''}`;

  // ── Supervisor-specific render ──────────────────────────────────────────

  const renderSupervisorNav = () => (
    <>
      {/* Top standalone: Dashboard */}
      <div className="space-y-1">
        {!collapsed && (
          <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#60a5fa]">
            Standalone Pages
          </div>
        )}
        {supervisorNav.topItems.map(item => (
          <NavLink
            key={item.url}
            to={item.url}
            end
            onClick={() => setMobileOpen(false)}
            className={navLinkClass(item.url)}
            title={collapsed ? item.title : undefined}
          >
            <item.icon className="size-5 shrink-0" />
            {!collapsed && <span className="truncate">{item.title}</span>}
          </NavLink>
        ))}
      </div>

      {/* Collapsible sections */}
      <div className="mt-1">
        {!collapsed && (
          <div className="px-3 pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">
            Dropdown Menus
          </div>
        )}
        <div className="space-y-0.5">
          {supervisorNav.sections.map(section => {
            const isOpen = openSection === section.id;
            const hasActiveChild = section.items.some(item => isActive(item.url));
            const isHovered = hoveredSection === section.id;
            
            return (
              <div 
                key={section.id}
                className="relative"
                onMouseEnter={() => collapsed && setHoveredSection(section.id)}
                onMouseLeave={() => setHoveredSection(null)}
              >
                <button
                  type="button"
                  onClick={() => !collapsed && toggleSection(section.id)}
                  className={sectionHeaderClass(hasActiveChild)}
                  title={collapsed ? section.label : undefined}
                >
                  <section.icon className="size-5 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left truncate">{section.label}</span>
                      <span className="rounded-full bg-[#60a5fa]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#93c5fd]">
                        Menu
                      </span>
                      <ChevronDown
                        className={`size-4 shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </>
                  )}
                </button>

                {/* Expanded dropdown */}
                {!collapsed && isOpen && (
                  <div className="ml-4 mt-1 space-y-0.5 border-l border-dashed border-[#60a5fa]/30 pl-3 overflow-hidden transition-all duration-300">
                    {section.items.map(item => (
                      <NavLink
                        key={item.url}
                        to={item.url}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-all duration-300 ${
                          isActive(item.url) 
                            ? 'bg-[#EEF2FF] text-[#151A2D] font-medium' 
                            : 'text-[#94a3b8] hover:bg-[#EEF2FF]/10 hover:text-[#EEF2FF]'
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${isActive(item.url) ? 'bg-[#151A2D]' : 'bg-[#60a5fa]/60'}`} />
                        <item.icon className="size-4 shrink-0" />
                        <span className="truncate">{item.title}</span>
                      </NavLink>
                    ))}
                  </div>
                )}

                {/* Collapsed flyout */}
                {collapsed && (isHovered || isOpen) && (
                  <div className="absolute left-full top-0 ml-2 z-50 min-w-[200px] bg-[#151A2D] rounded-lg shadow-xl border border-[#2d3748] py-2">
                    <div className="px-3 py-2 text-sm font-semibold text-[#EEF2FF] border-b border-[#2d3748] mb-1">
                      <div>{section.label}</div>
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#60a5fa]">Dropdown Menu</div>
                    </div>
                    {section.items.map(item => (
                      <NavLink
                        key={item.url}
                        to={item.url}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-3 px-3 py-2 mx-1 rounded-lg text-sm transition-all duration-200 ${
                          isActive(item.url) 
                            ? 'bg-[#EEF2FF] text-[#151A2D] font-medium' 
                            : 'text-[#94a3b8] hover:bg-[#EEF2FF] hover:text-[#151A2D]'
                        }`}
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span>{item.title}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 space-y-0.5">
        {!collapsed && (
          <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-[#60a5fa]">
            More Standalone Pages
          </div>
        )}
        {supervisorNav.bottomItems.map(item => (
          <NavLink
            key={item.url}
            to={item.url}
            onClick={() => setMobileOpen(false)}
            className={navLinkClass(item.url)}
            title={collapsed ? item.title : undefined}
          >
            <item.icon className="size-5 shrink-0" />
            {!collapsed && <span className="truncate">{item.title}</span>}
          </NavLink>
        ))}
      </div>

    </>
  );

  // ── Generic flat nav for other roles ───────────────────────────────────

  const renderFlatNav = () => {
    const items = menuItems[role as keyof typeof menuItems] || [];
    return (
      <>
        {!collapsed && (
          <div className="px-3 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">
            Navigation
          </div>
        )}
        <div className="space-y-1">
          {items.map(item => (
            <NavLink
              key={item.title}
              to={item.url}
              end={item.url === `/${role}`}
              onClick={() => setMobileOpen(false)}
              className={navLinkClass(item.url)}
              title={collapsed ? item.title : undefined}
            >
              <item.icon className="size-5 shrink-0" />
              {!collapsed && <span className="truncate">{item.title}</span>}
            </NavLink>
          ))}
        </div>

        {switchItem && (
          <>
            {!collapsed && (
              <div className="px-3 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">
                Switch Dashboard
              </div>
            )}
            <div className="space-y-1 mt-2">
              <NavLink
                to={switchItem.url}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#94a3b8] hover:bg-[#EEF2FF] hover:text-[#151A2D] text-sm transition-all duration-300 ${
                  collapsed ? 'justify-center' : ''
                }`}
                title={collapsed ? switchItem.title : undefined}
              >
                <switchItem.icon className="size-5 shrink-0" />
                {!collapsed && <span className="truncate">{switchItem.title}</span>}
              </NavLink>
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 p-2 bg-[#151A2D] text-[#F1F4FF] rounded-lg lg:hidden shadow-lg"
      >
        <Menu className="size-5" />
      </button>

      {/* Sidebar */}
      <div 
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          bg-[#151A2D] text-white flex flex-col
          transform transition-all duration-300 ease-in-out lg:transform-none
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${collapsed ? 'lg:w-[85px]' : 'lg:w-[270px]'}
          w-[270px]
        `}
      >
        {/* Header with Logo and Toggle */}
        <div className={`p-4 border-b border-[#2d3748] flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          <div className={`flex items-center gap-3 ${collapsed ? 'hidden lg:flex' : ''}`}>
            <img src="/logo.png" alt="ATCORA" className="h-10 w-10 rounded-lg object-cover" />
            {!collapsed && (
              <div>
                <div className="text-[#60a5fa] font-bold text-base leading-tight tracking-wider">ATCORA</div>
                <div className="text-xs text-[#64748b] capitalize">{role} Portal</div>
              </div>
            )}
          </div>
          
          {/* Collapsed logo icon only */}
          {collapsed && (
            <img src="/logo.png" alt="ATCORA" className="h-10 w-10 rounded-lg object-cover hidden lg:block" />
          )}
          
          {/* Mobile close button */}
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1 hover:bg-[#EEF2FF]/10 rounded-lg transition-colors"
          >
            <X className="size-5 text-[#94a3b8]" />
          </button>
          
          {/* Desktop toggle button */}
          <button
            onClick={toggleCollapsed}
            className="hidden lg:flex p-1.5 bg-[#EEF2FF] text-[#151A2D] rounded-lg hover:bg-[#dbe4ff] transition-all duration-300 absolute -right-3 top-1/2 -translate-y-1/2 shadow-md"
          >
            <ChevronLeft 
              className={`size-4 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} 
            />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 min-h-0 px-3 py-3 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2d3748] scrollbar-track-transparent">
          {role === "supervisor" ? renderSupervisorNav() : renderFlatNav()}

          {/* Switch Dashboard — supervisor only (flat nav handles it inline) */}
          {role === "supervisor" && switchItem && !collapsed && (
            <>
              <div className="px-3 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">
                Switch Dashboard
              </div>
              <div className="space-y-1">
                <NavLink
                  to={switchItem.url}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#94a3b8] hover:bg-[#EEF2FF] hover:text-[#151A2D] text-sm transition-all duration-300"
                >
                  <switchItem.icon className="size-5 shrink-0" />
                  <span className="truncate">{switchItem.title}</span>
                </NavLink>
              </div>
            </>
          )}
          
          {/* Collapsed switch for supervisor */}
          {role === "supervisor" && switchItem && collapsed && (
            <div className="mt-2">
              <NavLink
                to={switchItem.url}
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-center p-2.5 rounded-lg text-[#94a3b8] hover:bg-[#EEF2FF] hover:text-[#151A2D] transition-all duration-300"
                title={switchItem.title}
              >
                <switchItem.icon className="size-5 shrink-0" />
              </NavLink>
            </div>
          )}
        </nav>

        {/* Bottom: App Settings + Share + Logout */}
        <div className="shrink-0 p-3 border-t border-[#2d3748]">
          <Link
            to={`/settings?portal=${role}`}
            onClick={() => setMobileOpen(false)}
            className={`mb-2 flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-sm transition-all duration-300 ${
              currentPath === "/settings"
                ? "bg-[#EEF2FF] text-[#151A2D] font-medium"
                : "text-[#94a3b8] hover:bg-[#EEF2FF] hover:text-[#151A2D]"
            } ${collapsed ? 'justify-center' : ''}`}
            title={collapsed ? "App Settings" : undefined}
          >
            <Settings className="size-5 shrink-0" />
            {!collapsed && <span>App Settings</span>}
          </Link>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className={`mb-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#94a3b8] hover:bg-[#EEF2FF] hover:text-[#151A2D] w-full text-sm transition-all duration-300 ${
              collapsed ? 'justify-center' : ''
            }`}
            title={collapsed ? "Share This App" : undefined}
          >
            <Share2 className="size-5 shrink-0" />
            {!collapsed && <span>Share This App</span>}
          </button>
          <button
            onClick={handleLogout}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#94a3b8] hover:bg-red-500/20 hover:text-red-400 w-full text-sm transition-all duration-300 ${
              collapsed ? 'justify-center' : ''
            }`}
            title={collapsed ? "Logout" : undefined}
          >
            <LogOut className="size-5 shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </div>

      <ShareAppDialog open={shareOpen} onOpenChange={setShareOpen} />
    </>
  );
}

/** Exported for DashboardLayout to trigger mobile sidebar */
export { X as MenuIcon };
