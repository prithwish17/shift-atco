import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  announcementState,
  computeExpiry,
  expiryLabel,
  isAnnouncementHidden,
  sortAnnouncements,
  validateAnnouncementDraft,
} from "../announcements";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date(2026, 9, 23, 10, 0);

describe("announcementState", () => {
  it("is live between start and expiry", () => {
    expect(
      announcementState({ starts_at: new Date(now.getTime() - DAY).toISOString(), expires_at: new Date(now.getTime() + DAY).toISOString(), ended_at: null }, now),
    ).toBe("live");
  });

  it("is scheduled before the start", () => {
    expect(
      announcementState({ starts_at: new Date(now.getTime() + DAY).toISOString(), expires_at: new Date(now.getTime() + 2 * DAY).toISOString(), ended_at: null }, now),
    ).toBe("scheduled");
  });

  it("is ended once expired or ended early", () => {
    const base = { starts_at: new Date(now.getTime() - 2 * DAY).toISOString() };
    expect(announcementState({ ...base, expires_at: new Date(now.getTime() - 1).toISOString(), ended_at: null }, now)).toBe("ended");
    expect(announcementState({ ...base, expires_at: new Date(now.getTime() + DAY).toISOString(), ended_at: now.toISOString() }, now)).toBe("ended");
  });
});

describe("sortAnnouncements", () => {
  it("puts urgent first, then important, then info, newest first within each", () => {
    const list = [
      { id: "info-new", priority: "info" as const, starts_at: "2026-10-22T00:00:00Z" },
      { id: "urgent-old", priority: "urgent" as const, starts_at: "2026-10-01T00:00:00Z" },
      { id: "important", priority: "important" as const, starts_at: "2026-10-10T00:00:00Z" },
      { id: "urgent-new", priority: "urgent" as const, starts_at: "2026-10-20T00:00:00Z" },
    ];
    expect(sortAnnouncements(list).map((a) => a.id)).toEqual(["urgent-new", "urgent-old", "important", "info-new"]);
  });
});

describe("computeExpiry", () => {
  it("adds whole days for a preset", () => {
    expect(computeExpiry(now, { days: 7 }).getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it("runs a custom date to the end of that day", () => {
    const expiry = computeExpiry(now, { date: "2026-10-30" });
    expect([expiry.getFullYear(), expiry.getMonth(), expiry.getDate(), expiry.getHours(), expiry.getMinutes()]).toEqual([2026, 9, 30, 23, 59]);
  });
});

describe("validateAnnouncementDraft", () => {
  const valid = { title: "Roster published", body: "November roster is live.", startsAt: now, expiresAt: new Date(now.getTime() + 7 * DAY) };

  it("accepts a valid draft", () => {
    expect(validateAnnouncementDraft(valid, now)).toBeNull();
  });

  it("enforces the character limits", () => {
    expect(validateAnnouncementDraft({ ...valid, title: "x".repeat(ANNOUNCEMENT_TITLE_MAX + 1) }, now)).toMatch(/Title/);
    expect(validateAnnouncementDraft({ ...valid, body: "x".repeat(ANNOUNCEMENT_BODY_MAX + 1) }, now)).toMatch(/Text/);
    expect(validateAnnouncementDraft({ ...valid, title: "   " }, now)).toMatch(/title/);
  });

  it("rejects an expiry before the start, in the past, or more than 30 days out", () => {
    expect(validateAnnouncementDraft({ ...valid, expiresAt: new Date(now.getTime() - 1) }, now)).toMatch(/after the start/);
    expect(validateAnnouncementDraft({ ...valid, expiresAt: new Date(now.getTime() + 32 * DAY) }, now)).toMatch(/30 days/);
    const past = new Date(now.getTime() - 10 * DAY);
    expect(validateAnnouncementDraft({ ...valid, startsAt: past, expiresAt: new Date(now.getTime() - DAY) }, now)).toMatch(/future/);
  });
});

describe("expiryLabel", () => {
  it("counts calendar days", () => {
    expect(expiryLabel(new Date(2026, 9, 23, 22, 0).toISOString(), now)).toBe("Expires today");
    expect(expiryLabel(new Date(2026, 9, 24, 8, 0).toISOString(), now)).toBe("Expires tomorrow");
    expect(expiryLabel(new Date(2026, 9, 28, 8, 0).toISOString(), now)).toBe("Expires in 5 days");
    expect(expiryLabel(new Date(2026, 9, 22).toISOString(), now)).toBe("Expired");
  });
});

describe("isAnnouncementHidden", () => {
  const a = { updated_at: "2026-10-20T10:00:00Z" };

  it("is visible when never hidden", () => {
    expect(isAnnouncementHidden(a, undefined)).toBe(false);
  });

  it("stays hidden when hidden after the last edit", () => {
    expect(isAnnouncementHidden(a, "2026-10-21T08:00:00Z")).toBe(true);
  });

  it("comes back when edited after it was hidden", () => {
    expect(isAnnouncementHidden({ updated_at: "2026-10-22T09:00:00Z" }, "2026-10-21T08:00:00Z")).toBe(false);
  });
});
