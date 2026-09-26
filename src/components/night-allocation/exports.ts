/**
 * The shareable artefacts: the roster as a PDF, and as an image — a grid of
 * positions across and people down.
 *
 * Both are produced in the browser with jsPDF and a canvas — the same route
 * every other printed output in Atcora takes (the duty report, the attendance
 * sheet, the SARC statement). The plain-text roster, which is the one that has
 * to be byte-identical for everyone, is rendered on the server instead and
 * fetched; these two are pictures of the same saved night.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  BLANK_LABEL,
  buildRosterGrid,
  channelTableRows,
  formatNightDate,
  personTableRows,
  rosterSubtitle,
  type NightAllocationState,
  type RosterGridEntry,
} from "@/domain/night-allocation";
import { HALF_COLORS, channelSwatch } from "./palette";

const fileStem = (state: NightAllocationState) => `night-allocation-${state.nightDate}`;

/** A4 landscape: the channel timetable, the by-person summary, the halves. */
export function buildRosterPdf(
  state: NightAllocationState,
  teams?: string[] | null,
): { blob: Blob; filename: string } {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(15);
  doc.text("Night Channel Allocation", 14, 15);

  doc.setFontSize(11);
  doc.setTextColor(29, 78, 216);
  doc.text(rosterSubtitle(teams), 14, 22);

  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`${formatNightDate(state.nightDate)}   13:30 to 01:30 next day`, 14, 28);

  // The halves lead, because they are what a reader checks first.
  const firstHalf = state.people.filter(person => person.half === "1st").map(person => person.name);
  const secondHalf = state.people.filter(person => person.half === "2nd").map(person => person.name);
  doc.setTextColor(0);
  let headerY = 36;
  for (const [label, names] of [
    ["1st Half (17:30-21:30)", firstHalf],
    ["2nd Half (21:30-01:30)", secondHalf],
  ] as const) {
    doc.setFont(undefined, "bold");
    doc.text(`${label}:`, 14, headerY);
    doc.setFont(undefined, "normal");
    // Wrapped, so a long half does not run off the page.
    const lines = doc.splitTextToSize(names.join(", ") || "nobody", pageWidth - 70) as string[];
    doc.text(lines, 62, headerY);
    headerY += Math.max(6, lines.length * 5 + 1);
  }

  const tableTop = headerY + 4;
  autoTable(doc, {
    startY: tableTop,
    head: [["Position", "Time", "Who", "Length"]],
    body: channelTableRows(state),
    styles: { fontSize: 9, cellPadding: 1.6 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 150 },
    tableWidth: 130,
  });

  autoTable(doc, {
    startY: tableTop,
    head: [["Name", "Half", "Duties", "Total"]],
    body: personTableRows(state),
    styles: { fontSize: 9, cellPadding: 1.6 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 152, right: 14 },
    tableWidth: 131,
  });

  const savedAt = state.savedAt ? new Date(state.savedAt) : null;
  const when = savedAt && !Number.isNaN(savedAt.getTime()) ? `, ${savedAt.toLocaleString()}` : "";
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Prepared by Atcora${when}`, 14, doc.internal.pageSize.getHeight() - 8);

  return { blob: doc.output("blob"), filename: `${fileStem(state)}.pdf` };
}

/**
 * The roster as a PNG, for pasting into a chat.
 *
 * A grid, the way a duty sheet reads: positions across the top, people down
 * the side, and in each cell the times that person holds that position — so
 * everyone finds their own row and reads their night along it. Blanks, which
 * nobody holds, get a red row of their own at the bottom.
 *
 * Drawn from the same numbers the board renders from rather than screenshotting
 * the DOM: the image then looks the same whatever the sender's screen, theme or
 * scroll position, and it works on a phone where only part of the board is
 * visible.
 *
 * Everything is clipped to the shape it belongs in. An unclipped `fillText`
 * will happily run past the end of its box and off the canvas, which is how
 * the last duty of the night once ended up as a half-drawn employee number.
 */
export async function buildBoardImage(
  state: NightAllocationState,
  teams?: string[] | null,
): Promise<{ blob: Blob; filename: string }> {
  const scale = 2;
  const gutter = 16;
  const nameWidth = 176;
  const columnWidth = 128;
  const totalWidth = 76;
  const headerRowHeight = 50;
  const pillHeight = 20;
  const taggedPillHeight = 33;
  const pillGap = 4;
  const cellPadding = 8;
  const minRowHeight = 40;

  const grid = buildRosterGrid(state);
  const firstHalf = state.people.filter(person => person.half === "1st").map(person => person.name);
  const secondHalf = state.people.filter(person => person.half === "2nd").map(person => person.name);

  const tableWidth = nameWidth + grid.columns.length * columnWidth + totalWidth;
  const width = Math.max(640, tableWidth + gutter * 2);
  const tableLeft = gutter;
  const columnLeft = (index: number) => tableLeft + nameWidth + index * columnWidth;
  const totalLeft = tableLeft + nameWidth + grid.columns.length * columnWidth;

  // Header block: title, team and shift, date, then the two halves. Measured
  // first because the halves wrap, and the canvas has to be tall enough.
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("This browser cannot render the roster image.");
  measure.font = "13px system-ui, sans-serif";
  const textWidth = width - gutter * 2 - 74;
  const firstLines = wrapText(measure, firstHalf.join(", ") || "nobody", textWidth);
  const secondLines = wrapText(measure, secondHalf.join(", ") || "nobody", textWidth);
  const headerHeight = 96 + (firstLines.length + secondLines.length) * 18 + 14;

  // Each row is as tall as its fullest cell.
  const entryHeight = (entry: RosterGridEntry) => (entry.tag || entry.absorbs ? taggedPillHeight : pillHeight);
  const cellHeight = (cell: RosterGridEntry[]) =>
    cell.reduce((sum, entry, index) => sum + entryHeight(entry) + (index ? pillGap : 0), 0);
  const rowHeight = (cells: RosterGridEntry[][]) =>
    Math.max(minRowHeight, cellPadding * 2 + Math.max(0, ...cells.map(cellHeight)));
  const rows = [
    ...grid.rows.map(row => ({ kind: "person" as const, row, height: rowHeight(row.cells) })),
    ...(grid.blanks ? [{ kind: "blank" as const, cells: grid.blanks, height: rowHeight(grid.blanks) }] : []),
  ];
  const bodyHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const emptyHeight = rows.length ? 0 : 44;
  const footerHeight = 36;
  const tableTop = headerHeight + 8;
  const height = tableTop + headerRowHeight + bodyHeight + emptyHeight + footerHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot render the roster image.");
  context.scale(scale, scale);
  context.textBaseline = "alphabetic";

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  // ── Header ──
  context.fillStyle = "#0f172a";
  context.font = "600 19px system-ui, sans-serif";
  context.fillText("Night Channel Allocation", gutter, 30);

  context.fillStyle = "#1d4ed8";
  context.font = "600 14px system-ui, sans-serif";
  context.fillText(rosterSubtitle(teams), gutter, 51);

  context.fillStyle = "#475569";
  context.font = "13px system-ui, sans-serif";
  context.fillText(`${formatNightDate(state.nightDate)}   13:30 – 01:30 (+1)`, gutter, 70);

  context.strokeStyle = "#e2e8f0";
  context.beginPath();
  context.moveTo(gutter, 82);
  context.lineTo(width - gutter, 82);
  context.stroke();

  let cursorY = 100;
  const halfBlock = (label: string, lines: string[], colour: string) => {
    context.fillStyle = colour;
    context.font = "600 13px system-ui, sans-serif";
    context.fillText(label, gutter, cursorY);
    context.fillStyle = "#0f172a";
    context.font = "13px system-ui, sans-serif";
    for (const line of lines) {
      context.fillText(line, gutter + 74, cursorY);
      cursorY += 18;
    }
    cursorY += 4;
  };
  halfBlock("1st Half", firstLines, HALF_COLORS.first.text);
  halfBlock("2nd Half", secondLines, HALF_COLORS.second.text);

  // ── Column headings: one per position, then the total ──
  const bodyTop = tableTop + headerRowHeight;
  context.fillStyle = "#f1f5f9";
  context.fillRect(tableLeft, tableTop, tableWidth, headerRowHeight);

  context.fillStyle = "#64748b";
  context.font = "600 11px system-ui, sans-serif";
  context.fillText("NAME", tableLeft + 10, tableTop + 29);
  fitText(context, "TOTAL", totalLeft + 10, tableTop + 29, totalWidth - 16);

  grid.columns.forEach((column, index) => {
    const x = columnLeft(index);
    const swatch = channelSwatch(column.code);
    context.fillStyle = swatch.edge;
    context.fillRect(x + 1, tableTop + headerRowHeight - 4, columnWidth - 2, 4);
    context.fillStyle = "#0f172a";
    context.font = "700 14px system-ui, sans-serif";
    fitText(context, column.code, x + 10, tableTop + 22, columnWidth - 20);
    const note = [column.window, column.mergedNote].filter(Boolean).join(" · ");
    if (note) {
      context.fillStyle = "#64748b";
      context.font = "10px system-ui, sans-serif";
      fitText(context, note, x + 10, tableTop + 38, columnWidth - 20);
    }
  });

  // ── Rows: one per person, then the blanks ──
  const drawEntry = (entry: RosterGridEntry, x: number, y: number, code: string) => {
    const boxWidth = columnWidth - cellPadding * 2;
    const boxHeight = entryHeight(entry);
    const swatch = channelSwatch(code);
    context.save();
    if (entry.blank) {
      context.fillStyle = "rgba(220,38,38,0.06)";
      context.fillRect(x, y, boxWidth, boxHeight);
      context.strokeStyle = "rgba(220,38,38,0.75)";
      context.setLineDash([4, 3]);
      context.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1);
      context.setLineDash([]);
    } else {
      context.fillStyle = swatch.fill;
      context.fillRect(x, y, boxWidth, boxHeight);
      context.fillStyle = swatch.edge;
      context.fillRect(x, y, 3, boxHeight);
      // A DB slot is outlined dashed, as on the board: fixed, not planned.
      if (entry.tag) {
        context.strokeStyle = swatch.edge;
        context.setLineDash([4, 3]);
        context.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1);
        context.setLineDash([]);
      }
    }
    context.beginPath();
    context.rect(x, y, boxWidth, boxHeight);
    context.clip();
    context.fillStyle = entry.blank ? "#b91c1c" : swatch.text;
    context.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(entry.range, x + 8, y + 14);
    const extra = [entry.tag, entry.absorbs].filter(Boolean).join(" ");
    if (extra) {
      context.font = "700 9.5px system-ui, sans-serif";
      context.fillText(extra, x + 8, y + 27);
    }
    context.restore();
  };

  let rowTop = bodyTop;
  rows.forEach((entry, index) => {
    if (index % 2 === 1) {
      context.fillStyle = "#f8fafc";
      context.fillRect(tableLeft, rowTop, tableWidth, entry.height);
    }
    const cells = entry.kind === "person" ? entry.row.cells : entry.cells;

    // Who the row is.
    if (entry.kind === "person") {
      context.fillStyle = "#0f172a";
      context.font = "600 13px system-ui, sans-serif";
      fitText(context, entry.row.name, tableLeft + 10, rowTop + 22, nameWidth - 20);
      if (entry.row.half) {
        context.fillStyle = entry.row.half === "1st Half" ? HALF_COLORS.first.text : HALF_COLORS.second.text;
        context.font = "600 10.5px system-ui, sans-serif";
        context.fillText(entry.row.half, tableLeft + 10, rowTop + 36);
      }
      context.fillStyle = "#0f172a";
      context.font = "600 12px ui-monospace, SFMono-Regular, Menlo, monospace";
      fitText(context, entry.row.total, totalLeft + 10, rowTop + 22, totalWidth - 16);
    } else {
      context.fillStyle = "#b91c1c";
      context.font = "700 13px system-ui, sans-serif";
      context.fillText(BLANK_LABEL, tableLeft + 10, rowTop + 22);
      context.fillStyle = "#64748b";
      context.font = "10.5px system-ui, sans-serif";
      fitText(context, "nobody on these", tableLeft + 10, rowTop + 36, nameWidth - 20);
    }

    // The times, one box each, stacked in the position's column.
    cells.forEach((cell, column) => {
      let y = rowTop + cellPadding;
      for (const time of cell) {
        drawEntry(time, columnLeft(column) + cellPadding, y, grid.columns[column].code);
        y += entryHeight(time) + pillGap;
      }
    });

    rowTop += entry.height;
    context.strokeStyle = "#e2e8f0";
    context.beginPath();
    context.moveTo(tableLeft, rowTop);
    context.lineTo(tableLeft + tableWidth, rowTop);
    context.stroke();
  });

  if (!rows.length) {
    context.fillStyle = "#64748b";
    context.font = "13px system-ui, sans-serif";
    context.fillText("Nobody is on a position yet.", tableLeft + 10, bodyTop + 27);
  }

  // Column rules and the outline, drawn last so the rows' shading can't cover them.
  const tableBottom = bodyTop + bodyHeight + emptyHeight;
  context.strokeStyle = "#e2e8f0";
  for (const x of [tableLeft + nameWidth, ...grid.columns.map((_, index) => columnLeft(index + 1))]) {
    context.beginPath();
    context.moveTo(x + 0.5, tableTop);
    context.lineTo(x + 0.5, tableBottom);
    context.stroke();
  }
  context.strokeStyle = "#cbd5e1";
  context.strokeRect(tableLeft + 0.5, tableTop + 0.5, tableWidth - 1, tableBottom - tableTop - 1);

  context.fillStyle = "#64748b";
  context.font = "11px system-ui, sans-serif";
  context.fillText("Prepared by Atcora", gutter, height - 12);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The roster image could not be created.");
  return { blob, filename: `${fileStem(state)}.png` };
}

/** Text cut to `maxWidth` with an ellipsis, rather than clipped mid-letter. */
function fitText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  let shown = text;
  if (context.measureText(shown).width > maxWidth) {
    while (shown.length > 1 && context.measureText(`${shown}…`).width > maxWidth) shown = shown.slice(0, -1);
    shown = `${shown.trimEnd()}…`;
  }
  context.fillText(shown, x, y);
}

/** Greedy word wrap, so a long half list does not run off the canvas. */
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Hand a blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Base64 without the data: prefix — what the mail providers expect. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the attachment."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}
