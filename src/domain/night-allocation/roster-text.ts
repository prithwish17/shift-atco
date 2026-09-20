/**
 * Night Channel Allocation — the shareable roster.
 *
 * One source for every format so the WhatsApp message, the email body and the
 * PDF all say the same thing. Dependency-free on purpose: the API renders the
 * text from the saved allocation, and the browser renders the same text for the
 * clipboard and the Web Share sheet.
 */
import { FIRST_HALF, MERGE_WINDOW, NIGHT_SPAN_MIN, SECOND_HALF } from "./constants";
import { activeChannels, activeMerge, dutyLength, minutesOnDuty, personName } from "./rules";
import { formatDuration, formatMinutesCompact, formatRange } from "./time";
import type { NightAllocationState, NightDuty } from "./types";

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
  duties: Array<{ range: string; name: string }>;
}

export interface PersonRosterLine {
  name: string;
  half: string;
  duties: Array<{ range: string; code: string }>;
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
        name: personName(state, duty.personKey),
      })),
  }));

  const people: PersonRosterLine[] = state.people
    .filter(person => state.duties.some(duty => duty.personKey === person.key))
    .map(person => ({
      name: person.name,
      half: person.half === "1st" ? "1st Half" : person.half === "2nd" ? "2nd Half" : "",
      duties: state.duties
        .filter(duty => duty.personKey === person.key)
        .sort(byStart)
        .map(duty => ({
          range: `${formatMinutesCompact(duty.startMin)}-${formatMinutesCompact(duty.endMin)}`,
          code: duty.channelCode,
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
    for (const duty of channel.duties) lines.push(`${duty.range} ${duty.name}`);
  }

  if (summary.people.length) {
    lines.push("");
    lines.push("*By person*");
    for (const person of summary.people) {
      const duties = person.duties.map(duty => `${duty.range} ${duty.code}`).join(", ");
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
        personName(state, duty.personKey),
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
    person.duties.map(duty => `${duty.range} ${duty.code}`).join(", "),
    person.totalLabel,
  ]);
}
