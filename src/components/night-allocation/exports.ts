/**
 * The shareable artefacts: the roster as a PDF and as an image, both the same
 * grid — positions across, people down.
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
  formatNightDate,
  rosterSubtitle,
  type NightAllocationState,
  type RosterGridEntry,
} from "@/domain/night-allocation";
import { HALF_COLORS, channelSwatch } from "./palette";

const fileStem = (state: NightAllocationState) => `night-allocation-${state.nightDate}`;

/**
 * The roster as a PDF, A4 landscape: the same grid as the image — positions
 * across, people down, each person's times as boxes in their position's
 * column and their total at the end of the row, blanks in a red row of their
 * own.
 *
 * AutoTable lays the grid out and breaks the pages: the heading row repeats on
 * each page and nobody's row is split across two. The cells themselves are
 * drawn by hand, as on the image, because a cell of plain text can't carry
 * the boxes. A night that runs a little past the first page is drawn up to a
 * fifth smaller to keep it on one; a longer one keeps its size and runs on.
 */
export function buildRosterPdf(
  state: NightAllocationState,
  teams?: string[] | null,
): { blob: Blob; filename: string } {
  const margin = 14;
  const bottomMargin = 16;
  const nameWidth = 50;
  const totalWidth = 18;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const setFont = (style: "normal" | "bold", size: number, colour: string) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(colour);
  };

  const grid = buildRosterGrid(state);
  const title = "Night Channel Allocation";
  const subtitle = rosterSubtitle(teams);
  const date = formatNightDate(state.nightDate);

  // ── Header: title, team and shift, date, then the two halves ──
  setFont("bold", 15, "#0F172A");
  doc.text(title, margin, 14);
  setFont("bold", 11, "#1D4ED8");
  doc.text(subtitle, margin, 20.5);
  setFont("normal", 10, "#475569");
  doc.text(`${date}   13:30 to 01:30 next day`, margin, 26);
  doc.setDrawColor("#E2E8F0");
  doc.setLineWidth(0.3);
  doc.line(margin, 29, pageWidth - margin, 29);

  const firstHalf = state.people.filter(person => person.half === "1st").map(person => person.name);
  const secondHalf = state.people.filter(person => person.half === "2nd").map(person => person.name);
  let headerY = 35;
  for (const [label, names, colour] of [
    ["1st Half (17:30-21:30)", firstHalf, HALF_COLORS.first.text],
    ["2nd Half (21:30-01:30)", secondHalf, HALF_COLORS.second.text],
  ] as const) {
    setFont("bold", 10, colour);
    doc.text(label, margin, headerY);
    setFont("normal", 10, "#0F172A");
    // Wrapped, so a long half does not run off the page.
    const lines = doc.splitTextToSize(names.join(", ") || "nobody", pageWidth - margin - 62) as string[];
    doc.text(lines, 62, headerY);
    headerY += Math.max(5.5, lines.length * 4.5 + 1);
  }

  // ── The grid ──
  const columnWidth = (pageWidth - margin * 2 - nameWidth - totalWidth) / Math.max(1, grid.columns.length);
  const totalColumn = grid.columns.length + 1;
  const rows = [
    ...grid.rows.map(row => ({ kind: "person" as const, row, cells: row.cells })),
    ...(grid.blanks ? [{ kind: "blank" as const, cells: grid.blanks }] : []),
  ];

  // Sizes in millimetres and fonts in points, the image's proportions scaled
  // to the page, all times `scale`; and where that puts everything.
  const layout = (scale: number) => {
    const size = {
      scale,
      pad: 1.2 * scale,
      inset: 2.4 * scale,
      pill: 4.2 * scale,
      taggedPill: 6.8 * scale,
      gap: 0.6 * scale,
      line: 3.5 * scale,
      under: 3.1 * scale,
      codeFont: 10 * scale,
      nameFont: 9 * scale,
      totalFont: 8.5 * scale,
      timeFont: 8 * scale,
      smallFont: 7 * scale,
      noteFont: 6.5 * scale,
    };
    // A heading's notes (open window, merge) wrap under its code.
    setFont("normal", size.noteFont, "#64748B");
    const notes = grid.columns.map(column =>
      [column.window, column.mergedNote]
        .filter((note): note is string => Boolean(note))
        .flatMap(note => doc.splitTextToSize(note, columnWidth - size.inset * 2) as string[]),
    );
    const headHeight = (9 + Math.max(1, ...notes.map(lines => lines.length)) * 2.7) * scale;

    // A name wraps to two lines at most.
    setFont("bold", size.nameFont, "#0F172A");
    const nameLines = rows.map(entry => {
      if (entry.kind === "blank") return [BLANK_LABEL];
      const lines = doc.splitTextToSize(entry.row.name, nameWidth - size.inset * 2) as string[];
      return lines.length > 2
        ? [lines[0], fitPdfText(doc, lines.slice(1).join(" "), nameWidth - size.inset * 2)]
        : lines;
    });

    // Each row is as tall as its fullest cell, the name's included.
    const entryHeight = (entry: RosterGridEntry) => (entry.tag || entry.absorbs ? size.taggedPill : size.pill);
    const rowHeights = rows.map((entry, index) => {
      const underName = entry.kind === "blank" || entry.row.half ? size.under : 0;
      const name = size.pad * 2 + 4.5 * scale + (nameLines[index].length - 1) * size.line + underName;
      const times = entry.cells.map(
        cell => size.pad * 2 + cell.reduce((sum, time, slot) => sum + entryHeight(time) + (slot ? size.gap : 0), 0),
      );
      return Math.max(8.4 * scale, name, ...times);
    });
    const height = headHeight + rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0);
    return { size, notes, headHeight, nameLines, entryHeight, rowHeights, height };
  };
  const room = pageHeight - bottomMargin - headerY - 0.5;
  const natural = layout(1);
  const shrink = room / natural.height;
  const { size, notes, headHeight, nameLines, entryHeight, rowHeights } =
    shrink < 1 && shrink >= 0.8 ? layout(shrink) : natural;

  // One time: a box in the position's colour with an edge down its left side;
  // a DB slot is outlined dashed, as on the board, and a blank is red.
  const drawEntry = (entry: RosterGridEntry, x: number, y: number, width: number, code: string) => {
    const height = entryHeight(entry);
    const swatch = channelSwatch(code);
    if (entry.blank) {
      doc.setFillColor("#FEF2F2");
      doc.rect(x, y, width, height, "F");
    } else {
      doc.setFillColor(swatch.fill);
      doc.rect(x, y, width, height, "F");
      doc.setFillColor(swatch.edge);
      doc.rect(x, y, 0.9 * size.scale, height, "F");
    }
    if (entry.blank || entry.tag) {
      doc.setDrawColor(entry.blank ? "#EF4444" : swatch.edge);
      doc.setLineWidth(0.25);
      doc.setLineDashPattern([1, 0.8], 0);
      doc.rect(x, y, width, height, "S");
      doc.setLineDashPattern([], 0);
    }
    const colour = entry.blank ? "#B91C1C" : swatch.text;
    setFont("bold", size.timeFont, colour);
    doc.text(fitPdfText(doc, entry.range, width - size.inset - 1), x + size.inset * 0.8, y + 3 * size.scale);
    const extra = [entry.tag, entry.absorbs].filter(Boolean).join(" ");
    if (extra) {
      setFont("bold", size.noteFont, colour);
      doc.text(fitPdfText(doc, extra, width - size.inset - 1), x + size.inset * 0.8, y + 5.7 * size.scale);
    }
  };

  const savedAt = state.savedAt ? new Date(state.savedAt) : null;
  const when = savedAt && !Number.isNaN(savedAt.getTime()) ? `, ${savedAt.toLocaleString()}` : "";

  autoTable(doc, {
    startY: headerY,
    head: [["NAME", ...grid.columns.map(column => column.code), "TOTAL"]],
    body: rows.length
      ? rows.map(() => Array.from({ length: totalColumn + 1 }, () => ""))
      : [[{ content: "Nobody is on a position yet.", colSpan: totalColumn + 1 }]],
    theme: "grid",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    margin: { top: 18, left: margin, right: margin, bottom: bottomMargin },
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: size.pad,
      lineColor: "#E2E8F0",
      lineWidth: 0.2,
      textColor: "#64748B",
      fillColor: "#FFFFFF",
    },
    headStyles: { fillColor: "#F1F5F9", lineWidth: 0.2, minCellHeight: headHeight },
    columnStyles: {
      0: { cellWidth: nameWidth },
      ...Object.fromEntries(grid.columns.map((_, index) => [index + 1, { cellWidth: columnWidth }])),
      [totalColumn]: { cellWidth: totalWidth },
    },
    didParseCell: data => {
      if (data.section === "body" && !rows.length) return;
      // Everything below is drawn by hand; AutoTable only sizes and places it.
      data.cell.text = [];
      if (data.section === "body") {
        data.cell.styles.minCellHeight = rowHeights[data.row.index];
        if (data.row.index % 2 === 1) data.cell.styles.fillColor = "#F8FAFC";
      }
    },
    didDrawCell: data => {
      const { x, y, width, height } = data.cell;
      const column = data.column.index - 1;
      const isChannel = column >= 0 && column < grid.columns.length;

      if (data.section === "head") {
        if (!isChannel) {
          setFont("bold", size.smallFont, "#64748B");
          doc.text(data.column.index === 0 ? "NAME" : "TOTAL", x + size.inset, y + height / 2 + 1.2 * size.scale);
          return;
        }
        const code = grid.columns[column].code;
        setFont("bold", size.codeFont, "#0F172A");
        doc.text(fitPdfText(doc, code, width - size.inset * 2), x + size.inset, y + 5.2 * size.scale);
        setFont("normal", size.noteFont, "#64748B");
        notes[column].forEach((line, index) =>
          doc.text(line, x + size.inset, y + (8.6 + index * 2.7) * size.scale),
        );
        // The position's colour, as a bar along the foot of its heading.
        doc.setFillColor(channelSwatch(code).edge);
        doc.rect(x + 0.3, y + height - 1.2 * size.scale, width - 0.6, 1.2 * size.scale, "F");
        return;
      }

      const entry = rows[data.row.index];
      if (!entry) return;
      if (isChannel) {
        let top = y + size.pad;
        for (const time of entry.cells[column]) {
          drawEntry(time, x + size.pad, top, width - size.pad * 2, grid.columns[column].code);
          top += entryHeight(time) + size.gap;
        }
        return;
      }

      // Level with the first time in the row.
      const baseline = y + size.pad + 3 * size.scale;
      if (data.column.index === totalColumn) {
        if (entry.kind === "person") {
          setFont("bold", size.totalFont, "#0F172A");
          doc.text(fitPdfText(doc, entry.row.total, width - size.inset * 2), x + size.inset, baseline);
        }
        return;
      }

      // Who the row is: the name, and under it the half, or what a blank is.
      const lines = nameLines[data.row.index];
      setFont("bold", size.nameFont, entry.kind === "blank" ? "#B91C1C" : "#0F172A");
      lines.forEach((line, index) => doc.text(line, x + size.inset, baseline + index * size.line));
      const under = baseline + (lines.length - 1) * size.line + size.under;
      if (entry.kind === "blank") {
        setFont("normal", size.smallFont, "#64748B");
        doc.text("nobody on these", x + size.inset, under);
      } else if (entry.row.half) {
        const colour = entry.row.half === "1st Half" ? HALF_COLORS.first.text : HALF_COLORS.second.text;
        setFont("bold", size.smallFont, colour);
        doc.text(entry.row.half, x + size.inset, under);
      }
    },
  });

  // On every page: who prepared it and, when there is more than one, which
  // page this is — and past the first, whose roster it is.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    setFont("normal", 8, "#64748B");
    doc.text(`Prepared by Atcora${when}`, margin, pageHeight - 8);
    if (pages > 1) doc.text(`Page ${page} of ${pages}`, pageWidth - margin, pageHeight - 8, { align: "right" });
    if (page > 1) {
      setFont("bold", 9, "#475569");
      doc.text(`${title} — ${subtitle} — ${date}`, margin, 12);
    }
  }

  return { blob: doc.output("blob"), filename: `${fileStem(state)}.pdf` };
}

/** Text cut to `maxWidth` with an ellipsis, in the document's current font. */
function fitPdfText(doc: jsPDF, text: string, maxWidth: number) {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let shown = text;
  while (shown.length > 1 && doc.getTextWidth(`${shown}...`) > maxWidth) shown = shown.slice(0, -1);
  return `${shown.trimEnd()}...`;
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
