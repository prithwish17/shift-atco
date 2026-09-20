import { describe, expect, it } from "vitest";
import { buildRosterSummary, buildRosterText, channelTableRows, defaultEmailSubject, formatNightDate } from "../roster-text";
import { channel, duty, night, team } from "./fixtures";

function sharedNight() {
  const people = team(4, { halves: { 1: "1st", 2: "2nd" } });
  return night({
    nightDate: "2026-09-17",
    people,
    channels: [channel("TWR"), channel("TSO", { closeAt: 480 }), channel("CLD", { inUse: false })],
    duties: [
      duty("TWR", "p3", 0, 120),
      duty("TWR", "p1", 120, 240),
      duty("TWR", "p4", 240, 360),
      duty("TWR", "p1", 360, 480),
      duty("TWR", "p2", 480, 600),
      duty("TWR", "p4", 600, 720),
      duty("TSO", "p4", 0, 120),
      duty("TSO", "p3", 120, 240),
      duty("TSO", "p4", 240, 360),
      duty("TSO", "p3", 360, 480),
    ],
    savedByName: "Chandan Mitra",
  });
}

describe("date formatting", () => {
  it("reads the night's own date, not the machine's timezone", () => {
    expect(formatNightDate("2026-09-17")).toBe("Thu 17 Sep 2026");
    expect(formatNightDate("2026-01-01")).toBe("Thu 1 Jan 2026");
  });
});

describe("plain text roster", () => {
  it("leads with the team, the date, the window and the halves", () => {
    const text = buildRosterText(sharedNight(), null, { teams: ["A"] });
    const lines = text.split("\n");
    expect(lines[0]).toBe("*NIGHT CHANNEL ALLOCATION*");
    expect(lines[1]).toBe("*Team A · Night*");
    expect(lines[2]).toBe("Thu 17 Sep 2026  1330-0130");
    expect(text).toContain("1st Half (1730-2130): Person 1");
    expect(text).toContain("2nd Half (2130-0130): Person 2");
  });

  it("says just Night when the roster names no team", () => {
    expect(buildRosterText(sharedNight()).split("\n")[1]).toBe("*Night*");
  });

  it("names both teams on a night the roster splits", () => {
    expect(buildRosterText(sharedNight(), null, { teams: ["A", "B"] }).split("\n")[1]).toBe(
      "*Team A, B · Night*",
    );
  });

  it("lists every in-use channel, marking part-night windows", () => {
    const text = buildRosterText(sharedNight());
    expect(text).toContain("*TWR*\n1330-1530 Person 3");
    expect(text).toContain("*TSO*  (1330-2130)");
    expect(text).not.toContain("*CLD*");
  });

  it("adds the by-person block with totals, attributed to Atcora", () => {
    // The roster is the unit's, not one person's — who saved it lives in the
    // audit trail and on the page, not on the shared artefact.
    const text = buildRosterText(sharedNight(), "Chandan Mitra", { preparedAt: "17 Sep 14:32" });
    expect(text).toContain("*By person*");
    expect(text).toContain("Person 1  1530-1730 TWR, 1930-2130 TWR  (4h)");
    expect(text.trim().endsWith("Prepared by Atcora, 17 Sep 14:32")).toBe(true);
    expect(text).not.toContain("Chandan Mitra");
  });

  it("falls back to a summary and a link when the roster is too long for one message", () => {
    const text = buildRosterText(sharedNight(), null, {
      maxLength: 200,
      pageUrl: "https://atcora.in/night-allocation",
      teams: ["A"],
    });
    expect(text).toContain("Full roster in the attached file.");
    expect(text).toContain("https://atcora.in/night-allocation");
    expect(text).not.toContain("*By person*");
  });
});

describe("table rows", () => {
  it("names the channel once and repeats the times", () => {
    const rows = channelTableRows(sharedNight());
    expect(rows[0]).toEqual(["TWR", "13:30–15:30", "Person 3", "2h"]);
    expect(rows[1][0]).toBe("");
    expect(rows.some(row => row[0] === "TSO")).toBe(true);
  });

  it("summarises the people who actually hold a duty", () => {
    const summary = buildRosterSummary(sharedNight());
    expect(summary.people.map(person => person.name)).toEqual(["Person 1", "Person 2", "Person 3", "Person 4"]);
    expect(summary.preparedBy).toBe("Chandan Mitra");
  });
});

describe("email subject", () => {
  it("names the night", () => {
    expect(defaultEmailSubject("2026-09-17")).toBe("Night channel allocation — 17 Sep 2026");
  });
});
