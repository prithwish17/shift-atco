export const EMPLOYEE_PAGE_NOTICE_SETTING_KEY = "employee_page_notice_flags";

export type EmployeePageNoticeKey =
  | "dashboard"
  | "schedule"
  | "leave_dashboard"
  | "licenses"
  | "leave"
  | "leave_history"
  | "duty_exchange"
  | "attendance"
  | "holidays"
  | "atc_duties"
  | "comp_off"
  | "profile"
  | "roster";

export interface EmployeePageNoticeRoute {
  key: EmployeePageNoticeKey;
  title: string;
  path: string;
  aliases?: string[];
  description: string;
}

export const EMPLOYEE_PAGE_NOTICE_ROUTES: EmployeePageNoticeRoute[] = [
  {
    key: "dashboard",
    title: "Dashboard",
    path: "/employee",
    description: "Main employee dashboard and overview.",
  },
  {
    key: "schedule",
    title: "My Duty Schedule",
    path: "/employee/schedule",
    description: "Personal duty schedule and shift timeline.",
  },
  {
    key: "leave_dashboard",
    title: "My Leave Summary",
    path: "/employee/leave-dashboard",
    description: "Leave balances, usage, and summary view.",
  },
  {
    key: "licenses",
    title: "License Status",
    path: "/employee/licenses",
    description: "License status, validity, and related details.",
  },
  {
    key: "leave",
    title: "Apply for Leave",
    path: "/employee/leave",
    description: "Leave request and submission workflow.",
  },
  {
    key: "leave_history",
    title: "Leave History",
    path: "/employee/leave-history",
    description: "Historical leave applications and decisions.",
  },
  {
    key: "duty_exchange",
    title: "Duty Exchange",
    path: "/employee/duty-exchange",
    description: "Duty exchange requests and tracking.",
  },
  {
    key: "attendance",
    title: "My Attendance",
    path: "/employee/attendance",
    description: "Attendance records and daily status.",
  },
  {
    key: "holidays",
    title: "Holidays",
    path: "/employee/holidays",
    description: "Holiday calendar and comp-off visibility.",
  },
  {
    key: "atc_duties",
    title: "Shift Duty Roster",
    path: "/employee/atc-duties",
    description: "ATC duty roster and duty grid access.",
  },
  {
    key: "comp_off",
    title: "Comp-Off Details",
    path: "/employee/comp-off",
    description: "Comp-off accrual, use, and expiry details.",
  },
  {
    key: "profile",
    title: "Profile Settings",
    path: "/employee/profile",
    description: "Employee profile and personal settings.",
  },
  {
    key: "roster",
    title: "Roster View",
    path: "/employee/roster",
    aliases: ["/roster"],
    description: "Roster view opened from employee workflows or shared links.",
  },
];

export type EmployeePageNoticeState = Record<EmployeePageNoticeKey, boolean>;

export const DEFAULT_EMPLOYEE_PAGE_NOTICE_STATE = EMPLOYEE_PAGE_NOTICE_ROUTES.reduce(
  (acc, route) => {
    acc[route.key] = false;
    return acc;
  },
  {} as EmployeePageNoticeState,
);

export function parseEmployeePageNoticeState(rawValue?: string | null): EmployeePageNoticeState {
  if (!rawValue) {
    return { ...DEFAULT_EMPLOYEE_PAGE_NOTICE_STATE };
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<Record<EmployeePageNoticeKey, unknown>>;
    return EMPLOYEE_PAGE_NOTICE_ROUTES.reduce((acc, route) => {
      acc[route.key] = parsed?.[route.key] === true;
      return acc;
    }, { ...DEFAULT_EMPLOYEE_PAGE_NOTICE_STATE });
  } catch {
    return { ...DEFAULT_EMPLOYEE_PAGE_NOTICE_STATE };
  }
}

export function findEmployeePageNoticeRoute(pathname: string) {
  return EMPLOYEE_PAGE_NOTICE_ROUTES.find((route) => {
    const matchPaths = [route.path, ...(route.aliases || [])];
    return matchPaths.includes(pathname);
  }) || null;
}
