import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Award,
  BarChart3,
  BookLock,
  Calendar,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Database,
  FileBarChart,
  FileText,
  GraduationCap,
  History,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Mail,
  Palmtree,
  Radio,
  Settings,
  Shield,
  ShieldCheck,
  Table2,
  Timer,
  TimerReset,
  UserCog,
  UserSearch,
  Users,
  Wrench,
} from "lucide-react";

export type Role = "admin" | "supervisor" | "wso" | "employee";

/** Live counters a nav item can display. Resolved by useNavCounts. */
export type BadgeKey = "pendingLeaves" | "pendingExchanges";

/**
 * A page that is only reachable from inside its parent (via a button or link on
 * the parent page). Rendered as an indented third level while the parent — or
 * the child itself — is the active route, so deep pages stay discoverable
 * without permanently inflating the nav.
 */
export interface NavChild {
  title: string;
  url: string;
}

export interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  /** Match the URL exactly instead of by prefix. Needed for role home routes. */
  end?: boolean;
  badge?: BadgeKey;
  children?: NavChild[];
  /** Extra terms the command palette should match on, beyond the title. */
  keywords?: string[];
}

export interface NavGroup {
  id: string;
  /** `null` renders the items with no header — used for the ungrouped top row. */
  label: string | null;
  /** Shown on the collapsed rail as the flyout trigger for this group. */
  icon: React.ElementType;
  items: NavItem[];
  /** Open on first visit, before any persisted state exists. */
  defaultOpen?: boolean;
}

/**
 * Supervisor nav, grouped by what the job is rather than by when the page was
 * added. Approvals leads because it is the only group defined by urgency — it
 * is the supervisor's daily work queue, not a subject area.
 */
const supervisorNav: NavGroup[] = [
  {
    id: "overview",
    label: null,
    icon: LayoutDashboard,
    items: [{ title: "Dashboard", url: "/supervisor", icon: LayoutDashboard, end: true }],
  },
  {
    id: "approvals",
    label: "Approvals",
    icon: Inbox,
    defaultOpen: true,
    items: [
      {
        title: "Leave Review",
        url: "/supervisor/leaves",
        icon: FileText,
        badge: "pendingLeaves",
        keywords: ["approve", "requests", "queue"],
        children: [{ title: "Approved Leaves Register", url: "/supervisor/approved-leaves" }],
      },
      {
        title: "Duty Exchange",
        url: "/supervisor/duty-exchange",
        icon: ArrowLeftRight,
        badge: "pendingExchanges",
        keywords: ["swap", "approve"],
      },
      {
        title: "Leave Discrepancy",
        url: "/supervisor/leave-discrepancy",
        icon: AlertTriangle,
        keywords: ["mismatch", "audit"],
      },
    ],
  },
  {
    id: "rostering",
    label: "Rostering",
    icon: CalendarRange,
    items: [
      {
        title: "Schedule Management",
        url: "/supervisor/duty-management",
        icon: CalendarDays,
        keywords: ["duty", "plan", "assign"],
      },
      { title: "Shift Duty Grid", url: "/supervisor/atc-grid", icon: Radio, keywords: ["atc", "grid"] },
      {
        title: "Daily Availability Chart",
        url: "/supervisor/roster-view",
        icon: Table2,
        children: [{ title: "Availability Report", url: "/supervisor/availability-report" }],
      },
      {
        title: "Availability Finder",
        url: "/supervisor/availability-finder",
        icon: UserSearch,
        keywords: ["who is free", "cover"],
      },
      {
        title: "Shift Roster",
        url: "/supervisor/roster",
        icon: ClipboardList,
        keywords: ["who is on duty", "team", "shift", "roster data"],
      },
      { title: "Shift Details", url: "/supervisor/shift-details", icon: ListChecks },
    ],
  },
  {
    id: "attendance",
    label: "Attendance and Duty",
    icon: ClipboardCheck,
    items: [
      { title: "Mark Attendance", url: "/supervisor/attendance", icon: ClipboardCheck, end: true },
      { title: "View Attendance", url: "/supervisor/attendance-view", icon: CalendarCheck },
      { title: "Duty Report", url: "/supervisor/duty-report", icon: FileBarChart },
      { title: "Working Hours", url: "/supervisor/working-hours", icon: Clock },
      { title: "OPE Duty", url: "/supervisor/ope-assignments", icon: Activity, keywords: ["ope"] },
    ],
  },
  {
    id: "leave",
    label: "Leave and Holidays",
    icon: Palmtree,
    items: [
      { title: "Leave Dashboard", url: "/supervisor/leave-dashboard", icon: BarChart3, keywords: ["balance"] },
      { title: "Holidays", url: "/supervisor/holidays", icon: CalendarDays },
    ],
  },
  {
    id: "people",
    label: "People and Training",
    icon: Users,
    items: [
      { title: "Employee Management", url: "/supervisor/employees", icon: Users, keywords: ["staff", "controller"] },
      { title: "Trainee Details", url: "/supervisor/trainees", icon: GraduationCap },
      { title: "OJT Progress", url: "/supervisor/ojt-progress", icon: TimerReset, keywords: ["on the job"] },
    ],
  },
  {
    id: "licensing",
    label: "Licensing and Ratings",
    icon: Award,
    items: [
      {
        title: "License Management",
        url: "/supervisor/licenses",
        icon: Shield,
        keywords: ["cap", "validity", "expiry"],
        children: [{ title: "Medical List", url: "/supervisor/licenses/medical-list" }],
      },
      {
        title: "Ratings Management",
        url: "/supervisor/ratings",
        icon: Award,
        keywords: ["cap"],
        children: [{ title: "Proficiency List", url: "/supervisor/ratings/proficiency-list" }],
      },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    icon: ShieldCheck,
    items: [
      { title: "Compliance Dashboard", url: "/supervisor/compliance", icon: ShieldCheck, end: true },
      { title: "Compliance Audit Log", url: "/supervisor/compliance-audit", icon: History },
      { title: "Rule Governance", url: "/supervisor/rule-governance", icon: BookLock, keywords: ["rules", "engine"] },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Wrench,
    items: [{ title: "Email Logs", url: "/supervisor/email-logs", icon: Mail }],
  },
];

const adminNav: NavGroup[] = [
  {
    id: "overview",
    label: null,
    icon: LayoutDashboard,
    items: [{ title: "Dashboard", url: "/admin", icon: LayoutDashboard, end: true }],
  },
  {
    id: "access",
    label: "Users and Access",
    icon: Users,
    defaultOpen: true,
    items: [
      { title: "User Management", url: "/admin/users", icon: Users },
      { title: "Authenticated Users", url: "/admin/authenticated-users", icon: Shield },
      { title: "Change Password", url: "/admin/change-password", icon: Shield },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Wrench,
    defaultOpen: true,
    items: [
      { title: "System Settings", url: "/admin/settings", icon: Settings },
      { title: "Employee Page Notices", url: "/admin/employee-page-notices", icon: AlertTriangle },
      { title: "Email Logs", url: "/admin/email-logs", icon: Mail },
      { title: "Cron Jobs", url: "/admin/cron-jobs", icon: Timer },
      { title: "Cache Monitoring", url: "/admin/cache", icon: Database },
    ],
  },
];

const wsoNav: NavGroup[] = [
  {
    id: "overview",
    label: null,
    icon: LayoutDashboard,
    items: [{ title: "Dashboard", url: "/wso", icon: LayoutDashboard, end: true }],
  },
  {
    id: "approvals",
    label: "Approvals",
    icon: Inbox,
    defaultOpen: true,
    items: [
      {
        title: "Leave Requests",
        url: "/wso/leaves",
        icon: FileText,
        children: [{ title: "Approved Leaves Register", url: "/wso/approved-leaves" }],
      },
      { title: "Duty Exchange", url: "/wso/duty-exchange", icon: ArrowLeftRight },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: CalendarRange,
    defaultOpen: true,
    items: [
      { title: "Attendance", url: "/wso/attendance", icon: ClipboardList },
      { title: "Shift Duty Roster", url: "/wso/atc-grid", icon: Table2 },
      {
        title: "Shift Roster",
        url: "/wso/roster",
        icon: Calendar,
        keywords: ["who is on duty", "team", "shift", "roster data"],
      },
      { title: "OPE Duty", url: "/wso/ope-assignments", icon: Activity },
    ],
  },
  {
    id: "checks",
    label: "Checks",
    icon: ShieldCheck,
    defaultOpen: true,
    items: [{ title: "BA Test Management", url: "/wso/ba-test", icon: Shield }],
  },
];

const employeeNav: NavGroup[] = [
  {
    id: "overview",
    label: null,
    icon: LayoutDashboard,
    items: [{ title: "Dashboard", url: "/employee", icon: LayoutDashboard, end: true }],
  },
  {
    id: "duty",
    label: "My Duty",
    icon: CalendarRange,
    defaultOpen: true,
    items: [
      { title: "My Duty Schedule", url: "/employee/schedule", icon: Calendar },
      { title: "Duty Marked", url: "/employee/duty-marked", icon: ClipboardCheck },
      { title: "My Attendance", url: "/employee/attendance", icon: ClipboardList },
      { title: "Shift Duty Roster", url: "/employee/atc-duties", icon: Table2 },
      {
        title: "Shift Roster",
        url: "/employee/roster",
        icon: ClipboardList,
        keywords: ["who is on duty", "team", "shift"],
      },
      { title: "Duty Exchange", url: "/employee/duty-exchange", icon: ArrowLeftRight },
    ],
  },
  {
    id: "leave",
    label: "Leave and Holidays",
    icon: Palmtree,
    defaultOpen: true,
    items: [
      { title: "Apply for Leave", url: "/employee/leave", icon: FileText, end: true },
      {
        title: "My Leave Summary",
        url: "/employee/leave-dashboard",
        icon: BarChart3,
        children: [{ title: "Leave History", url: "/employee/leave-history" }],
      },
      { title: "Comp-Off Details", url: "/employee/comp-off", icon: Clock },
      { title: "Holidays", url: "/employee/holidays", icon: CalendarDays },
    ],
  },
  {
    id: "record",
    label: "My Record",
    icon: Award,
    defaultOpen: true,
    items: [
      { title: "License Status", url: "/employee/licenses", icon: Shield },
      { title: "My OJT Progress", url: "/employee/ojt-progress", icon: TimerReset },
      { title: "BA Test List", url: "/employee/ba-test-list", icon: Activity },
      { title: "Profile Settings", url: "/employee/profile", icon: UserCog },
    ],
  },
];

export const navByRole: Record<Role, NavGroup[]> = {
  admin: adminNav,
  supervisor: supervisorNav,
  wso: wsoNav,
  employee: employeeNav,
};

/** The sidebar renders these with a fixed switch glyph, so no per-role icon. */
export const switchDashboardItems: Record<Role, { title: string; url: string }> = {
  admin: { title: "Admin Dashboard", url: "/admin" },
  supervisor: { title: "Supervisor Dashboard", url: "/supervisor" },
  wso: { title: "WSO Dashboard", url: "/wso" },
  employee: { title: "Employee Dashboard", url: "/employee" },
};

/** True when `url` is the active route, matched by prefix unless `end` is set. */
export function matchesPath(currentPath: string, url: string, end?: boolean) {
  if (end) return currentPath === url;
  return currentPath === url || currentPath.startsWith(url + "/");
}

export interface FlatNavEntry {
  title: string;
  url: string;
  icon: React.ElementType;
  group: string | null;
  /** Parent title, for sub-pages that have no nav entry of their own. */
  parent?: string;
  keywords?: string[];
}

/** Every reachable page for a role, sub-pages included — the palette's index. */
export function flattenNav(groups: NavGroup[]): FlatNavEntry[] {
  const entries: FlatNavEntry[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      entries.push({
        title: item.title,
        url: item.url,
        icon: item.icon,
        group: group.label,
        keywords: item.keywords,
      });
      for (const child of item.children ?? []) {
        entries.push({
          title: child.title,
          url: child.url,
          icon: item.icon,
          group: group.label,
          parent: item.title,
        });
      }
    }
  }
  return entries;
}
