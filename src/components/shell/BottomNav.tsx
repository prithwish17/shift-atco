import { useEffect, type ComponentType } from "react";
import { Link, useLocation } from "react-router-dom";

import { matchesPath } from "@/lib/navConfig";
import styles from "./bottom-nav.module.css";
import {
  AttendanceNavIcon,
  BATestNavIcon,
  DashboardNavIcon,
  RosterNavIcon,
  ScheduleNavIcon,
  type NavIconProps,
} from "./nav-icons";

interface NavEntry {
  label: string;
  href: string;
  icon: ComponentType<NavIconProps>;
  /** Only an exact match counts — for the portal home, which prefixes every other route. */
  end?: boolean;
}

export type BottomNavRole = "employee" | "wso";

const ENTRIES_BY_ROLE: Record<BottomNavRole, NavEntry[]> = {
  employee: [
    { label: "Dashboard", href: "/employee", icon: DashboardNavIcon, end: true },
    { label: "Schedule", href: "/employee/schedule", icon: ScheduleNavIcon },
    { label: "Shift Roster", href: "/employee/roster", icon: RosterNavIcon },
    { label: "BA Test", href: "/employee/ba-test-list", icon: BATestNavIcon },
  ],
  wso: [
    { label: "Dashboard", href: "/wso", icon: DashboardNavIcon, end: true },
    { label: "Attendance", href: "/wso/attendance", icon: AttendanceNavIcon },
    { label: "Shift Roster", href: "/wso/roster", icon: RosterNavIcon },
    { label: "BA Test", href: "/wso/ba-test", icon: BATestNavIcon },
  ],
};

/**
 * Mobile bottom navigation — a port of the JobsTrackr tab bar.
 *
 * A floating pill with a cutout notch that slides to the active tab and a
 * raised bubble inside it. Hidden from `lg` up, where the sidebar takes over.
 *
 * While mounted it stamps `data-bottom-nav` on <html>, which switches on
 * `--bottom-nav-offset` in index.css so other bottom-fixed UI (install banner,
 * toasts) can sit above the bar instead of under it.
 */
export function BottomNav({ role }: { role: BottomNavRole }) {
  const { pathname } = useLocation();
  const entries = ENTRIES_BY_ROLE[role];

  useEffect(() => {
    document.documentElement.setAttribute("data-bottom-nav", "");
    return () => document.documentElement.removeAttribute("data-bottom-nav");
  }, []);

  const activeIndex = entries.findIndex((item) => matchesPath(pathname, item.href, item.end));
  const hasActiveItem = activeIndex !== -1;
  const slotWidthPercent = 100 / entries.length;

  return (
    <nav data-shell="bottom-nav" className={styles.navWrapper} aria-label="Primary">
      <div className={styles.navContainer}>
        <div className={styles.navBar}>
          <div
            className={styles.bgTrack}
            style={{
              width: `${slotWidthPercent}%`,
              transform: hasActiveItem ? `translateX(${activeIndex * 100}%)` : "translateX(0%)",
              opacity: hasActiveItem ? 1 : 0,
            }}
            aria-hidden="true"
          >
            <div className={styles.cutout} />
            <div className={styles.dot} />
          </div>

          <ul className={styles.navList}>
            {entries.map(({ label, href, icon: Icon }, index) => {
              const active = index === activeIndex;

              return (
                <li key={href} className={styles.navListItem}>
                  <Link
                    to={href}
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                    data-active={active ? "true" : undefined}
                    className={styles.navLink}
                  >
                    <span className={styles.iconSlot}>
                      <Icon active={active} />
                    </span>
                    <span className={styles.label}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
