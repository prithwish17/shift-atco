import { describe, expect, it } from "vitest";
import { blank, channel, dbSlot, duty, night, person } from "@/domain/night-allocation/__tests__/fixtures";
import type { NightAllocationState } from "@/domain/night-allocation";
import { buildRosterPdf } from "../exports";

/**
 * The PDF read back as the text on each page, in the order it is drawn.
 * jsPDF writes one uncompressed content stream per page, its text in
 * WinAnsi — enough to say what is where without rendering anything.
 */
async function pdfPages(state: NightAllocationState): Promise<string[][]> {
  const { blob } = buildRosterPdf(state, ["A"]);
  const raw = new TextDecoder("windows-1252").decode(await blob.arrayBuffer());
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map(([, content]) =>
    [...content.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(([, text]) => text.replace(/\\(.)/g, "$1")),
  );
}

/** `count` people, each on TWR for an hour of their own. */
function crew(count: number): NightAllocationState {
  const people = Array.from({ length: count }, (_, index) => person(`p${index + 1}`, { name: `Person ${index + 1}` }));
  return night({
    people,
    channels: [channel("TWR")],
    duties: people.map((entry, index) => duty("TWR", entry.key, (index * 60) % 720, ((index * 60) % 720) + 60)),
  });
}

describe("the roster PDF", () => {
  it("is the image's grid: positions across, people down, times where the two meet", async () => {
    const state = night({
      people: [person("p1", { name: "Asha Rao", half: "1st" }), person("p2", { name: "Ravi Kumar" })],
      channels: [channel("TWR"), channel("SMC-S", { closeAt: 480 })],
      duties: [
        duty("TWR", "p1", 0, 120),
        duty("SMC-S", "p2", 0, 120),
        duty("TWR", "p2", 120, 240),
        duty("SMC-S", "p1", 240, 360),
        dbSlot("TWR", "p1", 360, 480, "Neha"),
        blank("SMC-S", 120, 240),
      ],
    });
    const pages = await pdfPages(state);

    expect(pages).toHaveLength(1);
    const [text] = pages;
    // The headings, one per position, between the name and the total; a
    // position open for part of the night says when.
    const grid = text.slice(text.indexOf("NAME"));
    expect(grid.slice(0, 5)).toEqual(["NAME", "TWR", "SMC-S", "13:30–21:30", "TOTAL"]);
    // A row per person: their name, their half, then their times position by
    // position, left to right, then their total. Blanks come last.
    expect(grid.slice(5)).toEqual([
      "Asha Rao",
      "1st Half",
      "13:30-15:30",
      "19:30-21:30",
      "DB · Neha",
      "17:30-19:30",
      "6h",
      "Ravi Kumar",
      "15:30-17:30",
      "13:30-15:30",
      "4h",
      "BLANK",
      "nobody on these",
      "15:30-17:30",
      "Prepared by Atcora",
    ]);
    // The two tables it replaced are gone.
    expect(text).not.toContain("Position");
    expect(text).not.toContain("Who");
  });

  it("draws a night a little too long for the page a little smaller, rather than spill it onto a second", async () => {
    const [page] = await pdfPages(crew(18));
    expect(page).toContain("Person 18");
    expect(page).not.toContain("Page 1 of 2");
  });

  it("runs a long night onto more pages, headings repeated and no row split between two", async () => {
    const pages = await pdfPages(crew(30));
    expect(pages.length).toBeGreaterThan(1);

    pages.forEach((text, index) => {
      expect(text).toContain(`Page ${index + 1} of ${pages.length}`);
      expect(text.filter(line => line === "NAME" || line === "TWR" || line === "TOTAL")).toEqual([
        "NAME",
        "TWR",
        "TOTAL",
      ]);
      // Past the first page, whose roster it is.
      if (index > 0) expect(text).toContain("Night Channel Allocation — Team A · Night — Thu 17 Sep 2026");
    });

    // Everyone once, their time and total on the same page as their name.
    const names = pages.flat().filter(line => line.startsWith("Person "));
    expect(names).toHaveLength(30);
    for (const text of pages) {
      text.forEach((line, index) => {
        if (!line.startsWith("Person ")) return;
        expect(text[index + 1]).toMatch(/^\d\d:\d\d-\d\d:\d\d$/);
        expect(text[index + 2]).toBe("1h");
      });
    }
  });
});
