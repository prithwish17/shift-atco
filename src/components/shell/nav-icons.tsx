import type { SVGProps } from "react";

export interface NavIconProps extends SVGProps<SVGSVGElement> {
  active?: boolean;
}

/**
 * Bottom-nav glyphs, drawn in the same 22px weight as the JobsTrackr set the
 * bar is modelled on. The badge circles fill with `--nav-surface` so they read
 * as cut out of the glyph on both the bar and the raised active bubble.
 */

const strokeProps = {
  viewBox: "0 0 24 24",
  width: "22",
  height: "22",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function DashboardNavIcon({ active: _active, ...props }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.2a2.4 2.4 0 0 0-1.65.65L2.9 9.85A2.6 2.6 0 0 0 2 11.75V19a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-7.25a2.6 2.6 0 0 0-.9-1.9L13.65 2.85A2.4 2.4 0 0 0 12 2.2Zm-2.5 19.8V15.2a2.5 2.5 0 0 1 5 0V22h-5Z"
      />
    </svg>
  );
}

export function ScheduleNavIcon({ active: _active, ...props }: NavIconProps) {
  return (
    <svg {...strokeProps} {...props}>
      <path d="M4 8.5V19a2.5 2.5 0 0 0 2.5 2.5h5.5" />
      <path d="M4 8.5h16V11" />
      <path d="M6.5 4.5H17.5A2.5 2.5 0 0 1 20 7v1.5" />
      <path d="M4 7a2.5 2.5 0 0 1 2.5-2.5" />
      <path d="M7 2.5v3M12 2.5v3M17 2.5v3" />
      <circle cx="8" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="8" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="17.5" r="4.5" fill="var(--nav-surface, #ffffff)" />
      <path d="M17.5 15v2.5h2" />
    </svg>
  );
}

export function AttendanceNavIcon({ active: _active, ...props }: NavIconProps) {
  return (
    <svg {...strokeProps} {...props}>
      <path d="M9 3.5H6.5A2.5 2.5 0 0 0 4 6v13.5A2.5 2.5 0 0 0 6.5 22h5" />
      <path d="M15 3.5h2.5A2.5 2.5 0 0 1 20 6v5" />
      <rect x="9" y="2" width="6" height="3.5" rx="1.2" />
      <path d="M8 10h8" />
      <path d="M8 14h4" />
      <circle cx="17.5" cy="17.5" r="4.5" fill="var(--nav-surface, #ffffff)" />
      <path d="m15.5 17.5 1.5 1.5 2.5-2.5" />
    </svg>
  );
}

export function RosterNavIcon({ active: _active, ...props }: NavIconProps) {
  return (
    <svg {...strokeProps} {...props}>
      <path d="M12 21.5H6.5A2.5 2.5 0 0 1 4 19V5a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 5v6" />
      <path d="M4 8h16" />
      <path d="M9.5 8v13.5" />
      <path d="M4 13h8" />
      <circle cx="17.5" cy="17.5" r="4.5" fill="var(--nav-surface, #ffffff)" />
      <circle cx="17.5" cy="16.4" r="1.3" strokeWidth={1.8} />
      <path d="M15.3 20.2a2.6 2.6 0 0 1 4.4 0" strokeWidth={1.8} />
    </svg>
  );
}

export function BATestNavIcon({ active: _active, ...props }: NavIconProps) {
  return (
    <svg {...strokeProps} {...props}>
      <path d="M9 6.5V3.8A1.3 1.3 0 0 1 10.3 2.5h1.4A1.3 1.3 0 0 1 13 3.8v2.7" />
      <rect x="5" y="6.5" width="12" height="15" rx="3" />
      <rect x="8" y="9.5" width="6" height="4" rx="1" />
      <circle cx="11" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
      <path d="M19.5 9.5c1 .8 1 2.2 0 3" />
      <path d="M21.5 8c1.8 1.6 1.8 4.4 0 6" />
    </svg>
  );
}
