/**
 * The 5-day duty rotation, for edge functions.
 *
 * Mirrors src/lib/teamDutyRotation.ts — the same arithmetic the UI already uses
 * to build its shift columns — because edge functions cannot import from src/.
 * The pair is pinned together by dutyRotation.test.ts; change one and that test
 * fails until the other follows.
 *
 * Why the roster sync needs it: the scraper stamps every row of a source tab
 * with that tab's B2 date cell (roster-scraper.gs), so one mis-typed keystroke
 * there relabels an entire shift onto another day.  Nothing in the scrape can
 * detect that — every row agrees with every other row.  The rotation is the one
 * check that does not come from the sheet: it fixes which team is on which shift
 * on any given date, so a date that is wrong by anything other than a multiple
 * of five days makes the (date, shift, team) triple arithmetically impossible.
 */

export const DUTY_CYCLE = ['M', 'A', 'N', 'NO', 'CO'] as const
export type TeamDutyCode = typeof DUTY_CYCLE[number]

/** Rotating teams only.  "G" (general duty) does not rotate and is absent by design. */
export const TEAM_DUTY_BASE: Record<string, TeamDutyCode> = {
  A: 'N',
  B: 'A',
  C: 'M',
  D: 'CO',
  E: 'NO',
}

export const DUTY_ROTATION_ANCHOR_DATE_IST = '2026-03-09'

const SHIFT_TO_DUTY_CODE: Record<string, TeamDutyCode> = {
  MORNING: 'M',
  AFTERNOON: 'A',
  NIGHT: 'N',
  M: 'M',
  A: 'A',
  N: 'N',
}

const MS_PER_DAY = 86_400_000

/**
 * Calendar days from `isoFrom` to `isoDate`.  Both are read as UTC midnight, so
 * no DST transition can move the result by a day.
 */
function isoDayDelta(isoDate: string, isoFrom: string): number | null {
  const a = Date.parse(`${isoDate}T00:00:00Z`)
  const b = Date.parse(`${isoFrom}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / MS_PER_DAY)
}

/** The duty the rotation puts `team` on for `isoDate`, or null when it does not rotate. */
export function getTeamDutyForDate(team: string, isoDate: string): TeamDutyCode | null {
  const base = TEAM_DUTY_BASE[team]
  if (!base) return null
  const offset = isoDayDelta(isoDate, DUTY_ROTATION_ANCHOR_DATE_IST)
  if (offset === null) return null
  const idx =
    (DUTY_CYCLE.indexOf(base) + (offset % DUTY_CYCLE.length) + DUTY_CYCLE.length) % DUTY_CYCLE.length
  return DUTY_CYCLE[idx]
}

/**
 * True when the rotation says this team cannot be working this shift on this
 * date — the row is impossible and must not be written.
 *
 * Deliberately abstains rather than rejecting whenever there is no cycle to
 * check against: team G and anything outside A–E do not rotate, and an
 * unreadable shift label has no code to compare.  A guard that guessed in those
 * cases would drop good rows, which is far worse than letting one through.
 */
export function violatesRotation(isoDate: string, shift: string, team: string): boolean {
  if (!TEAM_DUTY_BASE[team]) return false
  const code = SHIFT_TO_DUTY_CODE[String(shift || '').trim().toUpperCase()]
  if (!code) return false
  const duty = getTeamDutyForDate(team, isoDate)
  return duty !== null && duty !== code
}

/** `isoDate` moved by `days`, as ISO. */
export function shiftIsoDate(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().split('T')[0]
}
