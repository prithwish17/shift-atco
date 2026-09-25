/**
 * The shareable artefacts: the roster as a PDF, and the board as an image.
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
  DB_LABEL,
  FIRST_HALF,
  MIDNIGHT_MIN,
  NIGHT_SPAN_MIN,
  SECOND_HALF,
  MERGE_WINDOW,
  isFixedDuty,
  activeChannels,
  activeMerge,
  buildRosterSummary,
  channelTableRows,
  findPerson,
  formatMinutes,
  formatNightDate,
  personShortLabel,
  personTableRows,
  rosterSubtitle,
  type NightAllocationState,
} from "@/domain/night-allocation";
import { personSwatch } from "./palette";

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
 * The board as a PNG, for pasting into a chat.
 *
 * Drawn from the same numbers the board renders from rather than screenshotting
 * the DOM: the image then looks the same whatever the sender's screen, theme or
 * scroll position, and it works on a phone where only part of the board is
 * visible.
 *
 * Everything is clipped to the shape it belongs in. An unclipped `fillText`
 * will happily run past the end of its strip and off the canvas, which is how
 * the last duty of the night ended up as a half-drawn employee number.
 */
export async function buildBoardImage(
  state: NightAllocationState,
  teams?: string[] | null,
): Promise<{ blob: Blob; filename: string }> {
  const scale = 2;
  const labelWidth = 104;
  const pxPerMin = 1.5;
  const rowHeight = 48;
  const gutter = 16;

  const channels = activeChannels(state);
  const merge = activeMerge(state);
  const firstHalf = state.people.filter(person => person.half === "1st").map(person => person.name);
  const secondHalf = state.people.filter(person => person.half === "2nd").map(person => person.name);
  // Both rosters go in the image: by position for the board, by person so
  // everyone can find their own night without reading across five rows.
  const people = buildRosterSummary(state).people;

  const laneLeft = gutter + labelWidth;
  const laneWidth = NIGHT_SPAN_MIN * pxPerMin;
  const width = laneLeft + laneWidth + gutter;

  // Header block: title, team and shift, date, then the two halves. Measured
  // first because the halves wrap, and the canvas has to be tall enough.
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("This browser cannot render the board image.");
  measure.font = "13px system-ui, sans-serif";
  const textWidth = width - gutter * 2 - 74;
  const firstLines = wrapText(measure, firstHalf.join(", ") || "nobody", textWidth);
  const secondLines = wrapText(measure, secondHalf.join(", ") || "nobody", textWidth);

  const headerHeight = 96 + (firstLines.length + secondLines.length) * 18 + 14;
  const axisHeight = 26;
  const footerHeight = 32;
  const personRowHeight = 19;
  const personBlockHeight = people.length ? 34 + people.length * personRowHeight + 10 : 0;
  const height =
    headerHeight + axisHeight + channels.length * rowHeight + personBlockHeight + footerHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot render the board image.");
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
  halfBlock("1st Half", firstLines, "#2563EB");
  halfBlock("2nd Half", secondLines, "#6D28D9");

  // ── Axis ──
  const boardTop = headerHeight + axisHeight;
  const boardBottom = boardTop + channels.length * rowHeight;

  const band = (from: number, to: number, colour: string) => {
    context.fillStyle = colour;
    context.fillRect(laneLeft + from * pxPerMin, boardTop, (to - from) * pxPerMin, boardBottom - boardTop);
  };
  band(FIRST_HALF[0], FIRST_HALF[1], "rgba(37,99,235,0.07)");
  band(SECOND_HALF[0], SECOND_HALF[1], "rgba(109,40,217,0.08)");

  context.fillStyle = "#64748b";
  context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.strokeStyle = "#e2e8f0";
  for (let minute = 0; minute <= NIGHT_SPAN_MIN; minute += 60) {
    const x = laneLeft + minute * pxPerMin;
    context.beginPath();
    context.moveTo(x, boardTop);
    context.lineTo(x, boardBottom);
    context.stroke();
    const label = formatMinutes(minute);
    const labelX = minute === 0 ? x : minute === NIGHT_SPAN_MIN ? x - context.measureText(label).width : x - 14;
    context.fillText(label, labelX, boardTop - 8);
  }
  context.strokeStyle = "#94a3b8";
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(laneLeft + MIDNIGHT_MIN * pxPerMin, boardTop);
  context.lineTo(laneLeft + MIDNIGHT_MIN * pxPerMin, boardBottom);
  context.stroke();
  context.setLineDash([]);

  // ── Rows ──
  channels.forEach((channel, index) => {
    const top = boardTop + index * rowHeight;

    context.strokeStyle = "#e2e8f0";
    context.beginPath();
    context.moveTo(gutter, top);
    context.lineTo(width - gutter, top);
    context.stroke();

    context.fillStyle = "#0f172a";
    context.font = "700 14px system-ui, sans-serif";
    context.fillText(channel.code, gutter, top + 22);
    if (channel.openAt > 0 || channel.closeAt < NIGHT_SPAN_MIN) {
      context.fillStyle = "#64748b";
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(`${formatMinutes(channel.openAt)}-${formatMinutes(channel.closeAt)}`, gutter, top + 36);
    }

    context.fillStyle = "rgba(100,116,139,0.14)";
    if (channel.openAt > 0) context.fillRect(laneLeft, top + 5, channel.openAt * pxPerMin, rowHeight - 12);
    if (channel.closeAt < NIGHT_SPAN_MIN) {
      const from = laneLeft + channel.closeAt * pxPerMin;
      context.fillRect(from, top + 5, (NIGHT_SPAN_MIN - channel.closeAt) * pxPerMin, rowHeight - 12);
    }

    // The folded stretch: somebody is on it, just not on this row.
    if (merge && channel.code === merge.source.code) {
      const mx = laneLeft + MERGE_WINDOW[0] * pxPerMin;
      const mw = (MERGE_WINDOW[1] - MERGE_WINDOW[0]) * pxPerMin;
      context.fillStyle = "rgba(37,99,235,0.08)";
      context.fillRect(mx, top + 5, mw, rowHeight - 12);
      context.strokeStyle = "rgba(37,99,235,0.45)";
      context.setLineDash([4, 3]);
      context.strokeRect(mx + 0.5, top + 5.5, mw - 1, rowHeight - 13);
      context.setLineDash([]);
      context.fillStyle = "#1d4ed8";
      context.font = "600 10px system-ui, sans-serif";
      clippedText(context, `with ${merge.targetCode}`, mx + 8, top + 26, mw - 12);
    }

    for (const duty of state.duties.filter(entry => entry.channelCode === channel.code)) {
      const person = findPerson(state, duty.personKey);
      const swatch = personSwatch(person?.colorIndex ?? 0);
      const x = laneLeft + duty.startMin * pxPerMin;
      const w = Math.max(10, (duty.endMin - duty.startMin) * pxPerMin);
      const boxTop = top + 5;
      const boxHeight = rowHeight - 12;

      context.fillStyle = swatch.fill;
      context.fillRect(x, boxTop, w, boxHeight);
      context.fillStyle = swatch.edge;
      context.fillRect(x, boxTop, 3, boxHeight);
      // A DB slot is outlined dashed, as on the board: fixed, not planned.
      const slot = isFixedDuty(duty);
      if (slot) {
        context.save();
        context.strokeStyle = swatch.edge;
        context.setLineDash([4, 3]);
        context.strokeRect(x + 0.5, boxTop + 0.5, w - 1, boxHeight - 1);
        context.restore();
      }

      // Clip to the strip so nothing bleeds past its end — or off the canvas.
      context.save();
      context.beginPath();
      context.rect(x, boxTop, w, boxHeight);
      context.clip();

      context.fillStyle = swatch.text;
      const initials = personShortLabel(person);
      const firstName = person ? person.name.split(" ")[0] : "Removed";
      const times = `${formatMinutes(duty.startMin)}-${formatMinutes(duty.endMin)}`;

      context.font = "700 11px system-ui, sans-serif";
      const absorbs =
        merge &&
        channel.code === merge.targetCode &&
        duty.startMin < MERGE_WINDOW[1] &&
        duty.endMin > MERGE_WINDOW[0]
          ? `+${merge.source.code}`
          : "";
      const label = absorbs ? `${initials} ${absorbs}` : slot ? `${initials} ${DB_LABEL}` : initials;
      const initialsWidth = context.measureText(label).width;
      context.fillText(label, x + 7, boxTop + 16);

      context.font = "11px system-ui, sans-serif";
      if (w > initialsWidth + context.measureText(firstName).width + 20) {
        context.fillText(firstName, x + 11 + initialsWidth, boxTop + 16);
      }

      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      if (w > context.measureText(times).width + 14) {
        context.fillText(times, x + 7, boxTop + 30);
      }
      context.restore();
    }
  });

  context.strokeStyle = "#e2e8f0";
  context.beginPath();
  context.moveTo(gutter, boardBottom);
  context.lineTo(width - gutter, boardBottom);
  context.stroke();

  // ── By person ──
  if (people.length) {
    let personY = boardBottom + 26;
    context.fillStyle = "#0f172a";
    context.font = "600 13px system-ui, sans-serif";
    context.fillText("By person", gutter, personY);
    personY += 16;

    const nameColumn = gutter;
    const halfColumn = gutter + 168;
    const dutyColumn = gutter + 236;
    const totalColumn = width - gutter - 52;

    for (const person of people) {
      context.fillStyle = "#0f172a";
      context.font = "12px system-ui, sans-serif";
      clippedText(context, person.name, nameColumn, personY, halfColumn - nameColumn - 8);

      context.fillStyle = "#64748b";
      context.font = "11px system-ui, sans-serif";
      clippedText(context, person.half || "—", halfColumn, personY, dutyColumn - halfColumn - 8);

      context.fillStyle = "#334155";
      context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      const duties = person.duties.map(duty => `${duty.range} ${duty.code}`).join(", ");
      clippedText(context, duties, dutyColumn, personY, totalColumn - dutyColumn - 10);

      context.fillStyle = "#0f172a";
      clippedText(context, person.totalLabel, totalColumn, personY, 52);
      personY += personRowHeight;
    }
  }

  context.fillStyle = "#64748b";
  context.font = "11px system-ui, sans-serif";
  context.fillText("Prepared by Atcora", gutter, height - 12);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The board image could not be created.");
  return { blob, filename: `${fileStem(state)}.png` };
}

/** Draw text that can never spill past `maxWidth` — the canvas has no overflow. */
function clippedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  context.save();
  context.beginPath();
  context.rect(x, y - 12, maxWidth, 18);
  context.clip();
  context.fillText(text, x, y);
  context.restore();
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
