/**
 * Night Channel Allocation — the shareable roster.
 *
 * One source for every format so the WhatsApp message, the email body and the
 * PDF all say the same thing. Dependency-free on purpose: the API renders the
 * text from the saved allocation, and the browser renders the same text for the
 * clipboard and the Web Share sheet.
 */
import { BLANK_LABEL, FIRST_HALF, MERGE_WINDOW, NIGHT_SPAN_MIN, SECOND_HALF } from "./constants.js";
import {
  activeChannels,
  activeMerge,
  blanksInBoardOrder,
  dutiesOf,
  dutyLength,
  isBlank,
  minutesOnDuty,
  personName,
} from "./rules.js";
import { dbTag } from "./db-slots.js";
import { formatDuration, formatMinutes, formatMinutesCompact, formatRange } from "./time.js";
import type { NightAllocationState, NightDuty } from "./types.js";

/** " (DB · Sulagna)" after a name, or nothing for an ordinary duty. */
const tagSuffix = (tag?: string | null) => (tag ? ` (${tag})` : "");

/** Who a line of the roster names: the person on it, or BLANK when nobody is. */
const holderName = (state: NightAllocationState, duty: NightDuty) =>
  isBlank(duty) ? BLANK_LABEL : personName(state, duty.personKey);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-09-17` → "Thu 17 Sep 2026". Parsed as UTC so it cannot drift a day. */
export function formatNightDate(nightDate: string): string {
  const [year, month, day] = nightDate.split("-").map(Number);
  if (!year || !month || !day) return nightDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${WEEKDAYS[date.getUTCDay()]} ${day} ${MONTHS[month - 1]} ${year}`;
}

/** Short form for a subject line: "17 Sep 2026". */
export function formatNightDateShort(nightDate: string): string {
  const [year, month, day] = nightDate.split("-").map(Number);
  if (!year || !month || !day) return nightDate;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export interface ChannelRosterLine {
  code: string;
  /** Present when the channel is open for only part of the night. */
  window?: string;
  /** Set when this position folds into another one for the merge window. */
  mergedNote?: string;
  /**
   * `tag` is "DB", or "DB · trainee", on a DB slot — the instructor holds it.
   * `blank` marks a stretch left with nobody on it; its name is BLANK.
   */
  duties: Array<{ range: string; name: string; tag?: string; blank?: boolean }>;
}

export interface PersonRosterLine {
  name: string;
  half: string;
  duties: Array<{ range: string; code: string; tag?: string }>;
  totalLabel: string;
}

export interface RosterSummary {
  title: string;
  /** "Team A · Night" — the sub-header every format leads with. */
  subtitle: string;
  dateLabel: string;
  windowLabel: string;
  firstHalf: string[];
  secondHalf: string[];
  channels: ChannelRosterLine[];
  people: PersonRosterLine[];
  /** Every stretch left blank, "TWR 1500-1630", so a short summary can still name them. */
  blanks: string[];
  preparedBy: string | null;
}

const byStart = (a: NightDuty, b: NightDuty) => a.startMin - b.startMin;

/** "Team A · Night", or just "Night" when the roster names no team. */
export function rosterSubtitle(teams?: string[] | null): string {
  const named = (teams ?? []).filter(Boolean);
  if (!named.length) return "Night";
  return `Team ${named.join(", ")} · Night`;
}

/** The structured roster the text, HTML and PDF renderers all read from. */
export function buildRosterSummary(
  state: NightAllocationState,
  preparedBy?: string | null,
  teams?: string[] | null,
): RosterSummary {
  const merge = activeMerge(state);
  const mergeRange = `${formatMinutesCompact(MERGE_WINDOW[0])}-${formatMinutesCompact(MERGE_WINDOW[1])}`;
  const channels: ChannelRosterLine[] = activeChannels(state).map(channel => ({
    code: channel.code,
    mergedNote:
      merge && channel.code === merge.source.code
        ? `${mergeRange} with ${merge.targetCode}`
        : merge && channel.code === merge.targetCode
          ? `${mergeRange} also covers ${merge.source.code}`
          : undefined,
    window:
      channel.openAt > 0 || channel.closeAt < NIGHT_SPAN_MIN
        ? `${formatMinutesCompact(channel.openAt)}-${formatMinutesCompact(channel.closeAt)}`
        : undefined,
    duties: state.duties
      .filter(duty => duty.channelCode === channel.code)
      .sort(byStart)
      .map(duty => ({
        range: `${formatMinutesCompact(duty.startMin)}-${formatMinutesCompact(duty.endMin)}`,
        name: holderName(state, duty),
        ...(dbTag(duty) ? { tag: dbTag(duty) as string } : {}),
        ...(isBlank(duty) ? { blank: true } : {}),
      })),
  }));

  const people: PersonRosterLine[] = state.people
    .filter(person => dutiesOf(state, person.key).length > 0)
    .map(person => ({
      name: person.name,
      half: person.half === "1st" ? "1st Half" : person.half === "2nd" ? "2nd Half" : "",
      duties: dutiesOf(state, person.key)
        .sort(byStart)
        .map(duty => ({
          range: `${formatMinutesCompact(duty.startMin)}-${formatMinutesCompact(duty.endMin)}`,
          code: duty.channelCode,
          ...(dbTag(duty) ? { tag: dbTag(duty) as string } : {}),
        })),
      totalLabel: formatDuration(minutesOnDuty(state, person.key)),
    }));

  return {
    title: "NIGHT CHANNEL ALLOCATION",
    subtitle: rosterSubtitle(teams),
    dateLabel: formatNightDate(state.nightDate),
    windowLabel: `${formatMinutesCompact(0)}-${formatMinutesCompact(NIGHT_SPAN_MIN)}`,
    firstHalf: state.people.filter(person => person.half === "1st").map(person => person.name),
    secondHalf: state.people.filter(person => person.half === "2nd").map(person => person.name),
    channels,
    people,
    blanks: blanksInBoardOrder(state).map(
      duty => `${duty.channelCode} ${formatMinutesCompact(duty.startMin)}-${formatMinutesCompact(duty.endMin)}`,
    ),
    preparedBy: preparedBy ?? state.savedByName ?? null,
  };
}

export interface RosterTextOptions {
  /** Appended to the "Prepared by" line. */
  preparedAt?: string;
  /** Link to the page, used by the shortened fallback. */
  pageUrl?: string;
  /** Longest message to produce before falling back to the summary. */
  maxLength?: number;
  /** Teams on the shift roster, for the sub-header. */
  teams?: string[] | null;
}

/**
 * WhatsApp's practical message ceiling. Well under the protocol limit, but past
 * this a roster is unreadable on a phone and is better sent as an attachment.
 */
const DEFAULT_MAX_LENGTH = 3500;

/** The full roster as plain text, using WhatsApp's `*bold*` markup. */
export function buildRosterText(
  state: NightAllocationState,
  preparedBy?: string | null,
  options: RosterTextOptions = {},
): string {
  const summary = buildRosterSummary(state, preparedBy, options.teams);
  const full = renderFullText(summary, options);
  const max = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if (full.length <= max) return full;
  return renderShortText(summary, options);
}

function renderFullText(summary: RosterSummary, options: RosterTextOptions): string {
  const lines: string[] = [];
  lines.push(`*${summary.title}*`);
  lines.push(`*${summary.subtitle}*`);
  lines.push(`${summary.dateLabel}  ${summary.windowLabel}`);
  lines.push("");
  lines.push(...halfLines(summary));

  for (const channel of summary.channels) {
    lines.push("");
    const heading = channel.window ? `*${channel.code}*  (${channel.window})` : `*${channel.code}*`;
    lines.push(channel.mergedNote ? `${heading}  [${channel.mergedNote}]` : heading);
    if (!channel.duties.length) lines.push("nobody assigned");
    for (const duty of channel.duties) lines.push(`${duty.range} ${duty.name}${tagSuffix(duty.tag)}`);
  }

  if (summary.people.length) {
    lines.push("");
    lines.push("*By person*");
    for (const person of summary.people) {
      const duties = person.duties.map(duty => `${duty.range} ${duty.code}${tagSuffix(duty.tag)}`).join(", ");
      lines.push(`${person.name}  ${duties}  (${person.totalLabel})`);
    }
  }

  lines.push("");
  lines.push(preparedLine(summary, options));
  return lines.join("\n");
}

/** Too long for one message: the halves, the totals and a link to the page. */
function renderShortText(summary: RosterSummary, options: RosterTextOptions): string {
  const lines: string[] = [];
  lines.push(`*${summary.title}*`);
  lines.push(`*${summary.subtitle}*`);
  lines.push(`${summary.dateLabel}  ${summary.windowLabel}`);
  lines.push("");
  lines.push(...halfLines(summary));
  lines.push("");
  lines.push(`${summary.channels.length} positions, ${summary.people.length} people on duty.`);
  // Nobody on a position is the one thing a summary must not leave out.
  if (summary.blanks.length) lines.push(`Left ${BLANK_LABEL}: ${summary.blanks.join(", ")}`);
  lines.push("Full roster in the attached file.");
  if (options.pageUrl) lines.push(options.pageUrl);
  lines.push("");
  lines.push(preparedLine(summary, options));
  return lines.join("\n");
}

function halfLines(summary: RosterSummary): string[] {
  const first = `1st Half (${formatMinutesCompact(FIRST_HALF[0])}-${formatMinutesCompact(FIRST_HALF[1])}): ${
    summary.firstHalf.length ? summary.firstHalf.join(", ") : "nobody"
  }`;
  const second = `2nd Half (${formatMinutesCompact(SECOND_HALF[0])}-${formatMinutesCompact(SECOND_HALF[1])}): ${
    summary.secondHalf.length ? summary.secondHalf.join(", ") : "nobody"
  }`;
  return [first, second];
}

/**
 * The roster is the unit's, not one person's. Who saved it is kept in the audit
 * trail and shown on the page; the shared artefact is attributed to Atcora.
 */
function preparedLine(summary: RosterSummary, options: RosterTextOptions): string {
  return options.preparedAt ? `Prepared by Atcora, ${options.preparedAt}` : "Prepared by Atcora";
}

/** Default subject for the email composer. */
export function defaultEmailSubject(nightDate: string): string {
  return `Night channel allocation — ${formatNightDateShort(nightDate)}`;
}

/** One time in a cell of the roster grid: a duty, a DB slot or a blank. */
export interface RosterGridEntry {
  /** "13:30-15:00". */
  range: string;
  /** "DB", or "DB · trainee", on a DB slot — the instructor holds it. */
  tag?: string;
  /** "+CLD" on the SMC duty that holds CLD too while it is merged. */
  absorbs?: string;
  /** Set on a stretch left with nobody on it. */
  blank?: boolean;
}

export interface RosterGridColumn {
  code: string;
  /** "13:30–21:30" when the position is open for only part of the night. */
  window?: string;
  /** The merge, said on both positions it joins. */
  mergedNote?: string;
}

export interface RosterGridRow {
  key: string;
  name: string;
  /** "1st Half", "2nd Half", or "". */
  half: string;
  /** Their time on duty, "6h 30m". */
  total: string;
  /** One list of times per column, in column order. */
  cells: RosterGridEntry[][];
}

export interface RosterGrid {
  columns: RosterGridColumn[];
  rows: RosterGridRow[];
  /** The blank stretches per column, or null when there are none. */
  blanks: RosterGridEntry[][] | null;
}

/**
 * The roster as a grid: positions across, people down, and in each cell the
 * times that person holds that position — the way a duty sheet reads, one row
 * per person. What the shared image draws. Blanks, which nobody holds, get a
 * row of their own at the bottom.
 */
export function buildRosterGrid(state: NightAllocationState): RosterGrid {
  const merge = activeMerge(state);
  const mergeRange = formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1]);
  const channels = activeChannels(state);
  const range = (duty: NightDuty) => `${formatMinutes(duty.startMin)}-${formatMinutes(duty.endMin)}`;

  const columns: RosterGridColumn[] = channels.map(channel => ({
    code: channel.code,
    ...(channel.openAt > 0 || channel.closeAt < NIGHT_SPAN_MIN
      ? { window: formatRange(channel.openAt, channel.closeAt) }
      : {}),
    ...(merge && channel.code === merge.source.code
      ? { mergedNote: `${mergeRange} with ${merge.targetCode}` }
      : merge && channel.code === merge.targetCode
        ? { mergedNote: `${mergeRange} also ${merge.source.code}` }
        : {}),
  }));

  const entry = (duty: NightDuty): RosterGridEntry => {
    const tag = dbTag(duty);
    const absorbs =
      merge &&
      duty.channelCode === merge.targetCode &&
      duty.startMin < MERGE_WINDOW[1] &&
      duty.endMin > MERGE_WINDOW[0]
        ? `+${merge.source.code}`
        : null;
    return { range: range(duty), ...(tag ? { tag } : {}), ...(absorbs ? { absorbs } : {}) };
  };

  const rows: RosterGridRow[] = state.people
    .map(person => {
      const mine = dutiesOf(state, person.key);
      return {
        key: person.key,
        name: person.name,
        half: person.half === "1st" ? "1st Half" : person.half === "2nd" ? "2nd Half" : "",
        total: formatDuration(minutesOnDuty(state, person.key)),
        cells: channels.map(channel =>
          mine
            .filter(duty => duty.channelCode === channel.code)
            .sort(byStart)
            .map(entry),
        ),
      };
    })
    .filter(row => row.cells.some(cell => cell.length > 0));

  const blankCells = channels.map(channel =>
    state.duties
      .filter(duty => isBlank(duty) && duty.channelCode === channel.code)
      .sort(byStart)
      .map(duty => ({ range: range(duty), blank: true })),
  );

  return { columns, rows, blanks: blankCells.some(cell => cell.length > 0) ? blankCells : null };
}

/** Rows for the PDF and the HTML email body: one line per duty, in board order. */
export function channelTableRows(state: NightAllocationState): string[][] {
  const merge = activeMerge(state);
  const mergeLabel = formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1]);
  const rows: string[][] = [];
  for (const channel of activeChannels(state)) {
    const duties = state.duties.filter(duty => duty.channelCode === channel.code).sort(byStart);
    if (merge && channel.code === merge.source.code) {
      // Say where the folded stretch went, so a reader of the table is never
      // left wondering why the position has a hole in it.
      rows.push([channel.code, mergeLabel, `Merged into ${merge.targetCode}`, ""]);
    }
    if (!duties.length) {
      rows.push([channel.code, "—", "Nobody assigned", ""]);
      continue;
    }
    duties.forEach((duty, index) => {
      rows.push([
        index === 0 ? channel.code : "",
        formatRange(duty.startMin, duty.endMin),
        `${holderName(state, duty)}${tagSuffix(dbTag(duty))}`,
        formatDuration(dutyLength(duty)),
      ]);
    });
  }
  return rows;
}

/** Rows for the by-person block of the PDF and the email. */
export function personTableRows(state: NightAllocationState): string[][] {
  return buildRosterSummary(state).people.map(person => [
    person.name,
    person.half || "—",
    person.duties.map(duty => `${duty.range} ${duty.code}${tagSuffix(duty.tag)}`).join(", "),
    person.totalLabel,
  ]);
}
