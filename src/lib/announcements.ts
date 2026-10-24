import { differenceInCalendarDays } from "date-fns";

// Announcements shown at the top of the employee dashboard.
// The limits here mirror the CHECK constraints in
// supabase/migrations/20261023120000_announcements.sql.

export type AnnouncementPriority = "info" | "important" | "urgent";

export interface AnnouncementAttachmentMeta {
  mime?: string;
  size?: number;
  original_name?: string | null;
  uploaded_at?: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  starts_at: string;
  expires_at: string;
  ended_at: string | null;
  attachment_path: string | null;
  attachment_meta: AnnouncementAttachmentMeta | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export const ANNOUNCEMENT_TITLE_MAX = 100;
export const ANNOUNCEMENT_BODY_MAX = 500;
/** Longest an announcement may run. The database allows 31 days for time-of-day slack. */
export const ANNOUNCEMENT_MAX_DAYS = 30;
/** How many announcements the dashboard banner shows before "View all". */
export const ANNOUNCEMENT_BANNER_LIMIT = 3;

export const ANNOUNCEMENT_EXPIRY_PRESETS = [1, 3, 7, 14, 30] as const;

export const ANNOUNCEMENT_PRIORITY_LABELS: Record<AnnouncementPriority, string> = {
  info: "Info",
  important: "Important",
  urgent: "Urgent",
};

const PRIORITY_RANK: Record<AnnouncementPriority, number> = { urgent: 0, important: 1, info: 2 };

export type AnnouncementState = "live" | "scheduled" | "ended";

export function announcementState(a: Pick<Announcement, "starts_at" | "expires_at" | "ended_at">, now = new Date()): AnnouncementState {
  if (a.ended_at || new Date(a.expires_at) <= now) return "ended";
  if (new Date(a.starts_at) > now) return "scheduled";
  return "live";
}

/** Urgent first, then important, then info; newest first within each. */
export function sortAnnouncements<T extends Pick<Announcement, "priority" | "starts_at">>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
  );
}

/**
 * Expiry for a preset of `days`, counted from the start. A custom date
 * (yyyy-MM-dd) runs to the end of that day, local time.
 */
export function computeExpiry(start: Date, choice: { days: number } | { date: string }): Date {
  if ("days" in choice) return new Date(start.getTime() + choice.days * 24 * 60 * 60 * 1000);
  const [y, m, d] = choice.date.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 0, 0);
}

export interface AnnouncementDraft {
  title: string;
  body: string;
  startsAt: Date;
  expiresAt: Date;
}

/** Returns a message for the first problem, or null when the draft is valid. */
export function validateAnnouncementDraft(draft: AnnouncementDraft, now = new Date()): string | null {
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (!title) return "Enter a title.";
  if (title.length > ANNOUNCEMENT_TITLE_MAX) return `Title must be ${ANNOUNCEMENT_TITLE_MAX} characters or fewer.`;
  if (!body) return "Enter the announcement text.";
  if (body.length > ANNOUNCEMENT_BODY_MAX) return `Text must be ${ANNOUNCEMENT_BODY_MAX} characters or fewer.`;
  if (Number.isNaN(draft.startsAt.getTime())) return "Choose a valid start date.";
  if (Number.isNaN(draft.expiresAt.getTime())) return "Choose a valid expiry date.";
  if (draft.expiresAt <= draft.startsAt) return "The expiry must be after the start.";
  if (draft.expiresAt <= now) return "The expiry must be in the future.";
  const maxMs = (ANNOUNCEMENT_MAX_DAYS + 1) * 24 * 60 * 60 * 1000;
  if (draft.expiresAt.getTime() - draft.startsAt.getTime() > maxMs) {
    return `An announcement can run for at most ${ANNOUNCEMENT_MAX_DAYS} days.`;
  }
  return null;
}

/** "Expires today", "Expires tomorrow", "Expires in 5 days" — by calendar day. */
export function expiryLabel(expiresAt: string, now = new Date()): string {
  const expiry = new Date(expiresAt);
  if (expiry <= now) return "Expired";
  const days = differenceInCalendarDays(expiry, now);
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
}

/**
 * Whether the user has hidden this announcement. An announcement edited after
 * it was hidden counts as not hidden, so the update is seen.
 */
export function isAnnouncementHidden(
  a: Pick<Announcement, "updated_at">,
  dismissedAt: string | undefined,
): boolean {
  if (!dismissedAt) return false;
  return new Date(dismissedAt).getTime() >= new Date(a.updated_at).getTime();
}
