const ROLE_HOME_ROUTES: Record<string, string> = {
  admin: "/admin",
  supervisor: "/supervisor",
  wso: "/wso",
  employee: "/employee",
};

export function getHomeRouteForRole(role?: string | null): string {
  if (!role) {
    return "/employee";
  }

  return ROLE_HOME_ROUTES[role] || "/employee";
}