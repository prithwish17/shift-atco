/**
 * Shared builders for the night-allocation tests. Small and explicit: a test
 * that has to read three helper layers to work out what night it is testing
 * stops being a specification.
 */
import { NIGHT_SPAN_MIN } from "../constants";
import type { HalfKey, NightAllocationState, NightChannel, NightDuty, NightPerson } from "../types";

let dutyCounter = 0;

export function person(
  key: string,
  overrides: Partial<NightPerson> = {},
): NightPerson {
  return {
    key,
    userId: `user-${key}`,
    name: overrides.name ?? key.toUpperCase(),
    code: overrides.code ?? key.slice(0, 3).toUpperCase(),
    role: "Employee",
    available: true,
    canTakeTso: false,
    half: null,
    manual: false,
    colorIndex: 0,
    ...overrides,
  };
}

export function channel(code: string, overrides: Partial<NightChannel> = {}): NightChannel {
  return {
    code,
    inUse: true,
    openAt: 0,
    closeAt: NIGHT_SPAN_MIN,
    starterKey: null,
    ...overrides,
  };
}

export function duty(channelCode: string, personKey: string, startMin: number, endMin: number): NightDuty {
  dutyCounter += 1;
  return { id: `t${dutyCounter}`, channelCode, personKey, startMin, endMin };
}

/** A DB slot: `personKey` instructing on `channelCode`, fixed in advance. */
export function dbSlot(
  channelCode: string,
  personKey: string,
  startMin: number,
  endMin: number,
  note: string | null = null,
): NightDuty {
  return { ...duty(channelCode, personKey, startMin, endMin), kind: "db", note };
}

export function night(overrides: Partial<NightAllocationState> = {}): NightAllocationState {
  return {
    nightDate: "2026-09-17",
    dutyLengthPref: 0,
    status: "draft",
    version: 0,
    people: [],
    channels: [],
    duties: [],
    savedByName: null,
    savedAt: null,
    ...overrides,
  };
}

/** `n` available people keyed p1…pn, optionally with halves and TSO flags. */
export function team(
  count: number,
  options: { tso?: number[]; halves?: Record<number, HalfKey> } = {},
): NightPerson[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return person(`p${number}`, {
      name: `Person ${number}`,
      code: `P${number}`,
      canTakeTso: options.tso?.includes(number) ?? false,
      half: options.halves?.[number] ?? null,
      colorIndex: index,
    });
  });
}

/** Give each open channel a distinct starter, in people order. */
export function withStarters(channels: NightChannel[], people: NightPerson[]): NightChannel[] {
  return channels.map((entry, index) => ({ ...entry, starterKey: people[index % people.length]?.key ?? null }));
}

/** Minutes of an open channel with nobody on it — the property the solver owes. */
export function messages(issues: Array<{ message: string }>): string[] {
  return issues.map(issue => issue.message);
}

/**
 * The project compiles with `strictNullChecks` off, which stops TypeScript
 * narrowing a `{ ok: true } | { ok: false }` union on the false branch. These
 * two assert the branch and hand back the right shape, so the tests can read
 * the refusal reasons without a cast at every call site.
 */
export function refused<T extends { ok: boolean }>(result: T): Extract<T, { ok: false }> {
  if (result.ok) throw new Error("Expected the operation to be refused, but it succeeded.");
  return result as Extract<T, { ok: false }>;
}

export function accepted<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`Expected the operation to succeed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}
