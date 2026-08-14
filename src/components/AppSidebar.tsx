import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useNavCounts } from "@/hooks/useNavCounts";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  MoreHorizontal,
  Repeat,
  Search,
  Settings,
  Share2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShareAppDialog } from "@/components/ShareAppDialog";
import { NavCommandPalette } from "@/components/NavCommandPalette";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  matchesPath,
  navByRole,
  switchDashboardItems,
  type NavGroup,
  type NavItem,
  type Role,
} from "@/lib/navConfig";

interface SidebarProps {
  role: Role;
}

const COLLAPSED_KEY = "atcora:sidebar:collapsed";
const openGroupsKey = (role: Role) => `atcora:sidebar:open-groups:${role}`;

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — layout preference isn't worth failing over */
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export function AppSidebar({ role }: SidebarProps) {
  const { signOut, userRole, user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const location = useLocation();
  const currentPath = location.pathname;

  const groups = useMemo(() => navByRole[role] ?? [], [role]);
  const counts = useNavCounts(role === "supervisor");

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED_KEY, false));
  const [openGroups, setOpenGroups] = useState<string[]>(() =>
    readStored(
      openGroupsKey(role),
      (navByRole[role] ?? []).filter(g => g.defaultOpen).map(g => g.id),
    ),
  );
  // Flyouts are portalled: the nav scrolls vertically, which clips anything
  // absolutely positioned outside its box.
  const [flyout, setFlyout] = useState<{ groupId: string; top: number; left: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Toggle event from the DashboardLayout header
  useEffect(() => {
    const handler = () => setMobileOpen(prev => !prev);
    window.addEventListener("toggle-sidebar", handler);
    return () => window.removeEventListener("toggle-sidebar", handler);
  }, []);

  // ⌘K / Ctrl+K opens navigation search
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => writeStored(COLLAPSED_KEY, collapsed), [collapsed]);
  useEffect(() => writeStored(openGroupsKey(role), openGroups), [openGroups, role]);

  const isActive = useCallback(
    (item: NavItem) =>
      matchesPath(currentPath, item.url, item.end) ||
      (item.children ?? []).some(child => matchesPath(currentPath, child.url)),
    [currentPath],
  );

  // Reveal the group holding the current route — on navigation only, so a group
  // the user deliberately collapsed doesn't spring back open under them.
  const lastPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastPathRef.current === currentPath) return;
    lastPathRef.current = currentPath;
    const active = groups.find(group => group.label && group.items.some(isActive));
    if (!active) return;
    setOpenGroups(prev => (prev.includes(active.id) ? prev : [...prev, active.id]));
  }, [currentPath, groups, isActive]);

  // A short close delay lets the pointer cross from the rail into the flyout.
  const flyoutTimer = useRef<number | null>(null);
  const cancelFlyoutClose = useCallback(() => {
    if (flyoutTimer.current === null) return;
    window.clearTimeout(flyoutTimer.current);
    flyoutTimer.current = null;
  }, []);
  const openFlyout = useCallback(
    (groupId: string, trigger: HTMLElement) => {
      cancelFlyoutClose();
      const rect = trigger.getBoundingClientRect();
      setFlyout({ groupId, top: rect.top, left: rect.right });
    },
    [cancelFlyoutClose],
  );
  const scheduleFlyoutClose = useCallback(() => {
    cancelFlyoutClose();
    flyoutTimer.current = window.setTimeout(() => setFlyout(null), 120);
  }, [cancelFlyoutClose]);
  useEffect(() => cancelFlyoutClose, [cancelFlyoutClose]);
  useEffect(() => {
    if (!collapsed) setFlyout(null);
  }, [collapsed]);

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups(prev => (prev.includes(id) ? prev.filter(entry => entry !== id) : [...prev, id]));
  }, []);

  const groupCount = useCallback(
    (group: NavGroup) =>
      group.items.reduce((total, item) => total + (item.badge ? (counts[item.badge] ?? 0) : 0), 0),
    [counts],
  );

  const handleLogout = async () => {
    await signOut();
  };

  const closeMobile = () => setMobileOpen(false);

  const showSwitchToRole =
    role === "employee" && userRole && userRole !== "employee"
      ? (userRole as Role)
      : role !== "employee"
        ? "employee"
        : null;
  const switchItem = showSwitchToRole ? switchDashboardItems[showSwitchToRole] : null;

  const displayName = profile?.full_name || "User";
  const initials = displayName.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();

  // ── Row renderers ───────────────────────────────────────────────────────

  const renderItem = (item: NavItem) => {
    const active = isActive(item);
    const badge = item.badge ? (counts[item.badge] ?? 0) : 0;
    const children = item.children ?? [];

    return (
      <div key={item.url}>
        <NavLink
          to={item.url}
          end={item.end}
          onClick={closeMobile}
          className={`flex items-center gap-2.5 rounded-r-lg border-l-2 px-2.5 py-[7px] text-[13px] transition-colors ${
            active
              ? "border-[#60a5fa] bg-[#EEF2FF] font-medium text-[#151A2D]"
              : "border-transparent text-[#cbd5e1] hover:bg-white/[0.06] hover:text-white"
          }`}
        >
          <item.icon className="size-4 shrink-0" />
          <span className="flex-1 truncate">{item.title}</span>
          {badge > 0 && (
            <span
              className={`rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums ${
                active ? "bg-[#151A2D] text-white" : "bg-[#f87171]/20 text-[#fca5a5]"
              }`}
            >
              {badge}
            </span>
          )}
        </NavLink>

        {/* Sub-pages surface only while their parent branch is active */}
        {active && children.length > 0 && (
          <div className="mt-0.5 space-y-0.5 border-l border-[#2d3748] pl-3 ml-3">
            {children.map(child => (
              <NavLink
                key={child.url}
                to={child.url}
                onClick={closeMobile}
                className={`block truncate rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                  matchesPath(currentPath, child.url)
                    ? "bg-white/[0.10] font-medium text-white"
                    : "text-[#94a3b8] hover:bg-white/[0.06] hover:text-[#cbd5e1]"
                }`}
              >
                {child.title}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderExpandedGroup = (group: NavGroup) => {
    if (!group.label) {
      return (
        <div key={group.id} className="space-y-0.5">
          {group.items.map(renderItem)}
        </div>
      );
    }

    const isOpen = openGroups.includes(group.id);
    const badge = groupCount(group);

    return (
      <div key={group.id}>
        <button
          type="button"
          onClick={() => toggleGroup(group.id)}
          aria-expanded={isOpen}
          className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-[#151A2D] px-2.5 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9fb0c9] transition-colors hover:text-[#e2e8f0]"
        >
          <span className="flex-1 text-left">{group.label}</span>
          {badge > 0 && !isOpen && (
            <span className="rounded-full bg-[#f87171]/20 px-1.5 text-[10px] tabular-nums text-[#fca5a5]">
              {badge}
            </span>
          )}
          <ChevronDown className={`size-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
        </button>
        {isOpen && <div className="space-y-0.5">{group.items.map(renderItem)}</div>}
      </div>
    );
  };

  const renderRailButton = (group: NavGroup) => {
    const hasActive = group.items.some(isActive);
    const badge = groupCount(group);

    return (
      <button
        key={group.id}
        type="button"
        aria-label={group.label ?? "Navigation"}
        onMouseEnter={event => openFlyout(group.id, event.currentTarget)}
        onFocus={event => openFlyout(group.id, event.currentTarget)}
        className={`relative flex w-full items-center justify-center rounded-lg py-2 transition-colors ${
          hasActive ? "bg-[#EEF2FF] text-[#151A2D]" : "text-[#94a3b8] hover:bg-white/[0.06] hover:text-white"
        }`}
      >
        <group.icon className="size-[18px]" />
        {badge > 0 && (
          <span className="absolute right-1 top-0.5 min-w-[15px] rounded-full bg-[#ef4444] px-1 text-[10px] font-medium leading-[15px] text-white">
            {badge}
          </span>
        )}
      </button>
    );
  };

  const renderFlyout = () => {
    if (!flyout) return null;
    const group = groups.find(entry => entry.id === flyout.groupId);
    if (!group) return null;

    return createPortal(
      <div
        className="fixed z-[60] pl-2"
        style={{ top: flyout.top, left: flyout.left }}
        onMouseEnter={cancelFlyoutClose}
        onMouseLeave={() => setFlyout(null)}
      >
        <div className="min-w-[212px] rounded-lg border border-[#2d3748] bg-[#151A2D] py-1.5 shadow-xl">
          {group.label && (
            <div className="border-b border-[#2d3748] px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9fb0c9]">
              {group.label}
            </div>
          )}
          <div className="mt-1 space-y-0.5 px-1">
            {group.items.map(item => {
              const itemBadge = item.badge ? (counts[item.badge] ?? 0) : 0;
              return (
                <NavLink
                  key={item.url}
                  to={item.url}
                  end={item.end}
                  onClick={() => {
                    setFlyout(null);
                    closeMobile();
                  }}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors ${
                    isActive(item)
                      ? "bg-[#EEF2FF] font-medium text-[#151A2D]"
                      : "text-[#cbd5e1] hover:bg-white/[0.08] hover:text-white"
                  }`}
                >
                  <item.icon className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{item.title}</span>
                  {itemBadge > 0 && (
                    <span className="rounded-full bg-[#f87171]/20 px-1.5 text-[11px] tabular-nums text-[#fca5a5]">
                      {itemBadge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        </div>
      </div>,
      document.body,
    );
  };

  // Collapsed: ungrouped items keep their own icons, every group folds to one.
  const renderRail = () => (
    <div className="space-y-1" onMouseLeave={scheduleFlyoutClose}>
      {groups.map((group, index) => {
        if (!group.label) {
          return (
            <div key={group.id} className="space-y-1">
              {group.items.map(item => (
                <NavLink
                  key={item.url}
                  to={item.url}
                  end={item.end}
                  onClick={closeMobile}
                  title={item.title}
                  className={`flex items-center justify-center rounded-lg py-2 transition-colors ${
                    isActive(item)
                      ? "bg-[#EEF2FF] text-[#151A2D]"
                      : "text-[#94a3b8] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <item.icon className="size-[18px]" />
                </NavLink>
              ))}
            </div>
          );
        }
        const previous = groups[index - 1];
        return (
          <div key={group.id}>
            {previous && <div className="mx-auto my-1.5 h-px w-6 bg-[#2d3748]" />}
            {renderRailButton(group)}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={closeMobile} />
      )}

      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        className="fixed left-4 top-4 z-50 rounded-lg bg-[#151A2D] p-2 text-[#F1F4FF] shadow-lg lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      {/* Desktop: sticky (not static) with a viewport-height cap, so the rail
          stays pinned while the page scrolls instead of stretching to the
          content's height and scrolling away with it. */}
      <div
        className={`fixed inset-y-0 left-0 z-50 flex w-[262px] transform flex-col bg-[#151A2D] text-white transition-all duration-300 ease-in-out lg:sticky lg:top-0 lg:bottom-auto lg:h-screen lg:shrink-0 lg:transform-none ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${collapsed ? "lg:w-[68px]" : "lg:w-[262px]"}`}
      >
        {/* Brand */}
        <div
          className={`relative flex items-center border-b border-[#2d3748] p-3.5 ${
            collapsed ? "justify-center" : "justify-between"
          }`}
        >
          <div className={`flex items-center gap-2.5 ${collapsed ? "hidden lg:flex" : ""}`}>
            <img src="/logo.png" alt="ATCORA" className="size-9 rounded-lg object-cover" />
            {!collapsed && (
              <div>
                <div className="text-[15px] font-bold leading-tight tracking-wider text-[#60a5fa]">ATCORA</div>
                <div className="text-[11px] capitalize text-[#9fb0c9]">{role} Portal</div>
              </div>
            )}
          </div>

          <button onClick={closeMobile} aria-label="Close navigation" className="rounded-lg p-1 hover:bg-white/[0.06] lg:hidden">
            <X className="size-5 text-[#94a3b8]" />
          </button>

          <button
            onClick={() => setCollapsed(prev => !prev)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute -right-3 top-1/2 hidden -translate-y-1/2 rounded-lg bg-[#EEF2FF] p-1.5 text-[#151A2D] shadow-md transition-colors hover:bg-[#dbe4ff] lg:flex"
          >
            <ChevronLeft className={`size-4 transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* Portal switcher — sits with the brand, since it answers "which portal am I in" */}
        {switchItem && (
          <div className={`shrink-0 border-b border-[#2d3748] pb-2.5 pt-2.5 ${collapsed ? "px-2" : "px-2.5"}`}>
            <NavLink
              to={switchItem.url}
              onClick={closeMobile}
              title={collapsed ? `Switch to ${switchItem.title}` : undefined}
              className={`flex w-full items-center gap-2 rounded-lg bg-[#60a5fa]/[0.12] text-[13px] text-[#bfdbfe] transition-colors hover:bg-[#60a5fa]/20 hover:text-white ${
                collapsed ? "justify-center py-2" : "px-2.5 py-[7px]"
              }`}
            >
              {/* A fixed switch glyph, not the target role's icon — on the collapsed
                  rail that icon would be indistinguishable from Dashboard. */}
              <Repeat className="size-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-left">{switchItem.title}</span>
                  <ChevronRight className="size-3.5 shrink-0 opacity-70" />
                </>
              )}
            </NavLink>
          </div>
        )}

        {/* Search */}
        <div className={`shrink-0 pt-2.5 ${collapsed ? "px-2" : "px-2.5"}`}>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title={collapsed ? "Search pages" : undefined}
            className={`flex w-full items-center gap-2 rounded-lg border border-[#2d3748] bg-[#1e2742] text-[13px] text-[#9fb0c9] transition-colors hover:border-[#3b4a6b] hover:text-[#e2e8f0] ${
              collapsed ? "justify-center py-2" : "px-2.5 py-[7px]"
            }`}
          >
            <Search className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Search</span>
                <span className="rounded border border-[#3b4a6b] px-1 font-mono text-[10px]">⌘K</span>
              </>
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav
          className={`sidebar-scrollbar min-h-0 flex-1 overflow-y-auto py-2 ${
            collapsed ? "px-2" : "pl-1.5 pr-2.5"
          }`}
        >
          {collapsed ? renderRail() : groups.map(renderExpandedGroup)}
        </nav>

        {/* Account */}
        <div className={`shrink-0 border-t border-[#2d3748] p-2 ${collapsed ? "space-y-1" : ""}`}>
          <Link
            to={`/settings?portal=${role}`}
            onClick={closeMobile}
            title={collapsed ? "App Settings" : undefined}
            className={`flex items-center gap-2.5 rounded-lg py-[7px] text-[13px] transition-colors ${
              currentPath === "/settings"
                ? "bg-[#EEF2FF] font-medium text-[#151A2D]"
                : "text-[#94a3b8] hover:bg-white/[0.06] hover:text-white"
            } ${collapsed ? "justify-center" : "px-2.5"}`}
          >
            <Settings className="size-4 shrink-0" />
            {!collapsed && <span>App Settings</span>}
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={collapsed ? displayName : undefined}
                className={`mt-1 flex w-full items-center gap-2.5 rounded-lg py-1.5 text-[13px] text-[#cbd5e1] transition-colors hover:bg-white/[0.06] ${
                  collapsed ? "justify-center" : "px-2.5"
                }`}
              >
                <Avatar className="size-7 border border-[#2d3748]">
                  <AvatarImage src={profile?.photo_url || undefined} alt={displayName} />
                  <AvatarFallback className="bg-[#1e2742] text-[11px] font-medium text-[#93c5fd]">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{displayName}</span>
                    <MoreHorizontal className="size-4 shrink-0 text-[#9fb0c9]" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              sideOffset={8}
              className="w-56 border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            >
              <div className="px-2 py-1.5">
                <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{displayName}</div>
                <div className="text-xs capitalize text-gray-500 dark:text-gray-400">{role} Portal</div>
              </div>
              <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700" />
              <DropdownMenuItem
                onSelect={() => setShareOpen(true)}
                className="gap-2 py-2 text-gray-700 focus:bg-gray-100 focus:text-gray-900 dark:text-gray-200 dark:focus:bg-gray-800 dark:focus:text-white"
              >
                <Share2 className="size-4" />
                Share this app
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleLogout}
                className="gap-2 py-2 text-red-600 focus:bg-red-50 focus:text-red-700 dark:text-red-400 dark:focus:bg-red-950 dark:focus:text-red-300"
              >
                <LogOut className="size-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {collapsed && renderFlyout()}
      <ShareAppDialog open={shareOpen} onOpenChange={setShareOpen} />
      <NavCommandPalette role={role} open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
