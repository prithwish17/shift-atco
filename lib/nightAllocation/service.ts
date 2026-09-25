/**
 * Night Channel Allocation — server side.
 *
 * Seeds a night from the roster, reads and writes the module's own tables, and
 * runs the shared rule set before anything is persisted. The rules themselves
 * live in src/domain/night-allocation and are the same code the browser runs,
 * so a hand-rolled request cannot save a roster the UI would have refused.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  cleanDbNote,
  defaultChannels,
  inBoardOrder,
  normalizeAvailability,
  validateAllocation,
  type NightAllocationState,
  type NightChannel,
  type NightDuty,
  type HalfKey,
  type NightPerson,
  type ValidationResult,
} from "../../src/domain/night-allocation/index.js";
import { getRosterDateQueryValues } from "../../src/lib/rosterDate.js";
import { normalizeEmployeeMatchName } from "../../src/lib/nameMatching.js";

/** A night is keyed by its 13:30 date, and only ever by that. */
export const NIGHT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The server-side Supabase URL. Falls back to the public name, as `apiAuth`
 * does, because deployments differ in which of the two they set.
 */
const serviceUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_PUBLIC_SUPABASE_URL ?? "";

/**
 * Deliberately no `VITE_PUBLIC_` fallback for the key. Anything with that
 * prefix is bundled into the browser, and a service-role key there would hand
 * every visitor unrestricted access to the database.
 */
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Which server-side environment variables are missing, for a message that says
 * what to fix. `createClient` otherwise throws a bare "supabaseKey is
 * required.", which says nothing about which name or which environment.
 */
export function missingServiceEnv(): string[] {
  const missing: string[] = [];
  if (!serviceUrl()) missing.push("SUPABASE_URL");
  if (!serviceKey()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

export function serviceClient(): SupabaseClient {
  return createClient(serviceUrl(), serviceKey(), { auth: { persistSession: false } });
}

// ── Seeding from the shift roster ───────────────────────────────────────────

/**
 * The tower units on the night shift roster.
 *
 * These are `rosters.unit` values — the Google Sheet roster synced by
 * `fetch-roster`, which is the office's own record of who is on what. The
 * spellings vary between team tabs ("SMC" on one night, "SMC-N & SMC-S" on
 * another; "AIMS" or "TWR-A/ AIMS"), so the set holds every observed form and
 * matching is done on a normalised value.
 *
 * AIMS and TWR-A are included because those people are on the crew and can be
 * given a channel, even though AIMS is not itself a channel in this module.
 */
const NIGHT_ROSTER_UNITS = new Set([
  "TWR",
  "CLD",
  "TSO",
  "SMC",
  "SMC-N",
  "SMC-S",
  "SMC-N & SMC-S",
  "SMC-N&SMC-S",
  "TWR-A",
  "AIMS",
  "TWR-A/ AIMS",
  "TWR-A/AIMS",
]);

/**
 * Which module channel each roster unit stands for.
 *
 * The roster writes one `SMC` when a single person works the ground positions
 * and `SMC-N & SMC-S` when they are combined on one row — both are *one*
 * position, so both map to SMC-S and leave SMC-N unticked. Only a night that
 * lists SMC-N as a unit of its own runs two.
 *
 * AIMS and TWR-A map to nothing: those people are on the crew and can be given
 * a channel, but AIMS is not itself a channel here.
 */
const UNIT_TO_CHANNEL: Record<string, string | null> = {
  TWR: "TWR",
  CLD: "CLD",
  TSO: "TSO",
  SMC: "SMC-S",
  "SMC-S": "SMC-S",
  "SMC-N & SMC-S": "SMC-S",
  "SMC-N&SMC-S": "SMC-S",
  "SMC-N": "SMC-N",
  AIMS: null,
  "TWR-A": null,
  "TWR-A/ AIMS": null,
  "TWR-A/AIMS": null,
};

/** Units that are never a person: leave columns, remarks, training notes. */
const NON_CREW_UNITS = new Set(["LEAVE", "LEAVES", "REMARK", "REMARKS", "TRAINING", "SPECIAL"]);

/**
 * A row whose "name" is really a note — `TWR (1330-1530) (1630-1730) SMC
 * (2330-0130)`, `UBN-A (1530-1630)`. The sheet uses the name cell for working
 * notes as well as people, and a note must not become a person on the board.
 */
const TIME_RANGE = /\d{3,4}\s*[-–]\s*\d{3,4}/;

const normaliseUnit = (value: string | null | undefined) =>
  (value ?? "").toUpperCase().replace(/\s+/g, " ").trim();

export interface RosterRow {
  unit: string | null;
  position: string | null;
  employee_name: string | null;
  team: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  designation: string | null;
  can_take_tso: boolean | null;
}

const normaliseCode = (value: string | null | undefined) => (value ?? "").trim().toUpperCase();

/** Initials, for the short label on a board strip. */
function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .map(word => word[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

/**
 * The sheet's own half column, which means exactly what this module's halves
 * mean: 1st Half 17:30–21:30, 2nd Half 21:30–01:30. Taken as read rather than
 * inferred — the office already decided it.
 */
function halfFromPosition(position: string | null | undefined): HalfKey {
  const value = (position ?? "").toUpperCase();
  if (value.includes("1ST HALF")) return "1st";
  if (value.includes("2ND HALF")) return "2nd";
  return null;
}

/** Is this unit one of the tower positions the night allocation is built from? */
export function isTowerUnit(unit: string | null | undefined): boolean {
  return NIGHT_ROSTER_UNITS.has(normaliseUnit(unit));
}

/** A crew member read off one roster row, or null when the row is not a person. */
export function readCrewRow(row: RosterRow): { name: string; unit: string; half: HalfKey } | null {
  const rawName = (row.employee_name ?? "").trim();
  if (!rawName || TIME_RANGE.test(rawName)) return null;

  // `normalizeEmployeeMatchName` takes the part before the "/", drops the
  // parenthetical rating and the trailing designation: "HITESH RATHORE/ MGR -
  // ADC/SMC-" becomes "HITESH RATHORE".
  const name = normalizeEmployeeMatchName(rawName);
  if (name.length < 3) return null;

  const unit = normaliseUnit(row.unit);
  if (NON_CREW_UNITS.has(unit)) return null;

  return { name, unit, half: halfFromPosition(row.position) };
}

/**
 * Every row of a select, a page at a time.
 *
 * PostgREST caps each response (1,000 rows by default), so a single select of a
 * whole table silently stops there. Pages until one comes back empty, which
 * also copes with a server whose cap is lower than the page asked for.
 */
async function selectAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0, pages = 0; pages < 50; pages++) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    if (!batch.length) break;
    rows.push(...batch);
    from += batch.length;
  }
  return rows;
}

/**
 * Tonight's rows on the shift roster, all units. Read once per request and
 * handed to whatever needs them — the crew, the positions and the team name all
 * come from the same rows.
 */
export async function nightRosterRows(supabase: SupabaseClient, nightDate: string): Promise<RosterRow[]> {
  // `rosters.date` is canonically "yyyy-MM-dd" but legacy rows carry a dozen
  // other spellings, which is what this helper exists for.
  const dateValues = getRosterDateQueryValues(nightDate);
  if (!dateValues.length) return [];

  const { data, error } = await supabase
    .from("rosters")
    .select("unit, position, employee_name, team")
    .in("date", dateValues)
    // `shift` is free text and already holds both "Night" and "NIGHT".
    .ilike("shift", "night");
  if (error) throw error;
  return (data ?? []) as RosterRow[];
}

/**
 * Which team's roster this night belongs to — "A", or "A, B" on a date where
 * two teams appear. Derived rather than stored: it is a property of the shift
 * roster, not of the allocation, so it stays right even for a night saved
 * before the roster was corrected.
 */
export function teamsFromRows(rows: RosterRow[]): string[] {
  const teams = new Set<string>();
  for (const row of rows) {
    const team = (row.team ?? "").trim().toUpperCase();
    if (team) teams.add(team);
  }
  return [...teams].sort();
}

/**
 * Every profile, indexed by normalised name.
 *
 * The whole table on purpose: telling an unambiguous match from two people who
 * share a name needs every profile with that name, and names are normalised
 * here rather than in the database. Paged, so a station past the response cap
 * does not lose people from the matching at random.
 */
async function profilesByName(supabase: SupabaseClient, names: string[]): Promise<Map<string, ProfileRow>> {
  const index = new Map<string, ProfileRow[]>();
  if (!names.length) return new Map();

  const profiles = await selectAllPages<ProfileRow>((from, to) =>
    supabase
      .from("profiles")
      .select("id, full_name, employee_id, designation, can_take_tso")
      .order("id", { ascending: true })
      .range(from, to),
  );

  for (const profile of profiles) {
    const key = normalizeEmployeeMatchName(profile.full_name);
    if (!key) continue;
    const bucket = index.get(key) ?? [];
    bucket.push(profile);
    index.set(key, bucket);
  }

  // Only an unambiguous match counts. Two people with the same normalised name
  // would otherwise attach the wrong account — and therefore the wrong TSO
  // qualification — to a duty.
  const unique = new Map<string, ProfileRow>();
  for (const [key, bucket] of index) {
    if (bucket.length === 1) unique.set(key, bucket[0]);
  }
  return unique;
}

/**
 * Why the crew list looks the way it does.
 *
 * `missing` — the shift roster has no night rows for the date at all.
 * `empty`   — it has night rows, but nobody on the tower units.
 * `filled`  — the roster supplied the crew.
 *
 * The three call for different things from the user, so the page says which.
 */
export type RosterStatus = "missing" | "empty" | "filled";

/**
 * Tonight's tower crew, from the shift roster.
 *
 * The source is `rosters` — the Google Sheet roster the office maintains and
 * `fetch-roster` syncs — filtered to the tower units. That is typically eight
 * to eleven people rather than the sixty-odd on nights across the whole unit.
 *
 * Read-only: nothing here writes back to the roster, and availability or halves
 * edited inside this module stay inside it.
 */
export async function seedPeopleFromRoster(
  supabase: SupabaseClient,
  nightDate: string,
  rosterRows?: RosterRow[],
): Promise<{ people: NightPerson[]; status: RosterStatus; units: string[] }> {
  const rows = rosterRows ?? (await nightRosterRows(supabase, nightDate));
  if (!rows.length) return { people: [], status: "missing", units: [] };

  const crew: Array<{ name: string; unit: string; half: HalfKey }> = [];
  const units = new Set<string>();
  for (const row of rows) {
    const unit = normaliseUnit(row.unit);
    if (!NIGHT_ROSTER_UNITS.has(unit)) continue;
    const parsed = readCrewRow(row);
    if (!parsed) continue;
    units.add(unit);
    crew.push(parsed);
  }
  if (!crew.length) return { people: [], status: "empty", units: [] };

  const profiles = await profilesByName(supabase, crew.map(entry => entry.name));

  const byName = new Map<string, { units: string[]; half: HalfKey }>();
  for (const entry of crew) {
    const held = byName.get(entry.name) ?? { units: [], half: null };
    if (!held.units.includes(entry.unit)) held.units.push(entry.unit);
    // A person marked on two units keeps the first half the sheet gives them.
    held.half = held.half ?? entry.half;
    byName.set(entry.name, held);
  }

  const people: NightPerson[] = [];
  for (const [name, held] of byName) {
    const profile = profiles.get(name);
    const displayName = profile?.full_name || titleCase(name);
    const code = normaliseCode(profile?.employee_id);
    people.push({
      // Someone on the roster without a matching account is still on the crew,
      // so the key falls back to their name.
      key: profile?.id ?? `name:${name}`,
      userId: profile?.id ?? null,
      name: displayName,
      code: code || initialsFor(displayName),
      // What they are marked as tonight is more use on this page than their
      // designation, so it is what the row shows.
      role: held.units.join(", ") || profile?.designation || "Employee",
      available: true,
      // Being put on TSO by the office is itself the qualification for tonight;
      // the person-level flag is the standing one. Either is enough, and both
      // stay editable on the page.
      canTakeTso: !!profile?.can_take_tso || held.units.includes("TSO"),
      half: held.half,
      manual: false,
      colorIndex: people.length,
    });
  }

  people.sort((a, b) => a.name.localeCompare(b.name));
  return {
    people: people.map((person, index) => ({ ...person, colorIndex: index })),
    status: "filled",
    units: [...units],
  };
}

/**
 * The positions in use, from the units the roster actually lists.
 *
 * Ticking every default channel is wrong more often than it is right: a night
 * that runs one SMC would start with two, and that single phantom position is
 * enough to make an otherwise workable night impossible. An empty roster falls
 * back to the defaults, and every channel stays tickable by hand.
 */
export function channelsFromRosterUnits(units: string[]): NightChannel[] {
  const wanted = new Set<string>();
  for (const unit of units) {
    const channel = UNIT_TO_CHANNEL[normaliseUnit(unit)];
    if (channel) wanted.add(channel);
  }
  if (!wanted.size) return defaultChannels();
  return defaultChannels().map(channel => ({ ...channel, inUse: wanted.has(channel.code) }));
}

/** "HITESH RATHORE" → "Hitesh Rathore", for someone with no account to name them. */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map(word => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** One person the page can offer to add by hand. */
export interface ShiftCandidate {
  key: string;
  userId: string | null;
  name: string;
  code: string;
  role: string;
  canTakeTso: boolean;
}

/**
 * Everyone on the night shift roster for this date, whatever unit they are on —
 * the pool behind "add someone from the shift". Much broader than the tower
 * crew, which is why it is a picker rather than the seed.
 */
export async function shiftCandidates(
  supabase: SupabaseClient,
  nightDate: string,
): Promise<ShiftCandidate[]> {
  const rows = await nightRosterRows(supabase, nightDate);
  if (!rows.length) return [];

  const crew = new Map<string, string>();
  for (const row of rows) {
    const parsed = readCrewRow(row);
    if (parsed && !crew.has(parsed.name)) crew.set(parsed.name, parsed.unit);
  }
  if (!crew.size) return [];

  const profiles = await profilesByName(supabase, [...crew.keys()]);
  const candidates: ShiftCandidate[] = [];
  for (const [name, unit] of crew) {
    const profile = profiles.get(name);
    const displayName = profile?.full_name || titleCase(name);
    const code = normaliseCode(profile?.employee_id);
    candidates.push({
      key: profile?.id ?? `name:${name}`,
      userId: profile?.id ?? null,
      name: displayName,
      code: code || initialsFor(displayName),
      role: unit || profile?.designation || "Employee",
      canTakeTso: !!profile?.can_take_tso || unit === "TSO",
    });
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return candidates;
}

/** A night nobody has configured yet: the roster's crew, default channels. */
export async function seedState(
  supabase: SupabaseClient,
  nightDate: string,
  rosterRows?: RosterRow[],
): Promise<{ state: NightAllocationState; rosterStatus: RosterStatus }> {
  const { people, status, units } = await seedPeopleFromRoster(supabase, nightDate, rosterRows);
  return {
    rosterStatus: status,
    state: {
      nightDate,
      dutyLengthPref: 0,
      status: "draft",
      version: 0,
      people,
      channels: channelsFromRosterUnits(units),
      duties: [],
      savedByName: null,
      savedAt: null,
    },
  };
}

// ── Reading a saved night ───────────────────────────────────────────────────

/** The stored rows, exactly as the module writes them. */
interface SavedChannelRow {
  channel_code: string;
  in_use: boolean | null;
  open_at: number | string;
  close_at: number | string;
  starter_key: string | null;
  merged_into: string | null;
}

interface SavedPersonRow {
  person_key: string;
  user_id: string | null;
  display_name: string | null;
  employee_code: string | null;
  role: string | null;
  is_available: boolean | null;
  half: string | null;
  can_take_tso: boolean | null;
  is_manual: boolean | null;
  color_index: number | string | null;
  /** `{ mode, periods }` when they are on for part of the night; null for all of it. */
  availability: unknown;
}

interface SavedDutyRow {
  id: string;
  channel_code: string;
  person_key: string;
  start_min: number | string;
  end_min: number | string;
  /** 'duty', or 'db' for a DB slot. */
  kind: string | null;
  note: string | null;
}

/** A stored duty row as the module's own shape — a DB slot keeps its kind and note. */
function dutyFromRow(entry: SavedDutyRow): NightDuty {
  const duty: NightDuty = {
    id: entry.id,
    channelCode: entry.channel_code,
    personKey: entry.person_key,
    startMin: Number(entry.start_min),
    endMin: Number(entry.end_min),
  };
  if (entry.kind === "db") {
    duty.kind = "db";
    duty.note = cleanDbNote(entry.note);
  }
  return duty;
}

interface AllocationRow {
  id: string;
  night_date: string;
  duty_length_pref: number;
  status: string;
  version: number;
  updated_by_name: string | null;
  updated_at: string;
}

/**
 * The saved night, or a seeded one when nothing has been saved yet. A seeded
 * night is deliberately not persisted: opening a date must not create a row.
 *
 * The roster is read once, here, unless the caller already has it.
 */
export async function loadState(
  supabase: SupabaseClient,
  nightDate: string,
  rosterRows?: RosterRow[],
): Promise<{
  state: NightAllocationState;
  exists: boolean;
  rosterStatus: RosterStatus | null;
  /** Teams on the shift roster for this night, for the exports' sub-header. */
  teams: string[];
}> {
  const { data: allocation, error } = await supabase
    .from("night_allocations")
    .select("id, night_date, duty_length_pref, status, version, updated_by_name, updated_at")
    .eq("night_date", nightDate)
    .maybeSingle();
  if (error) throw error;

  if (!allocation) {
    const roster = rosterRows ?? (await nightRosterRows(supabase, nightDate));
    const seeded = await seedState(supabase, nightDate, roster);
    return {
      state: seeded.state,
      exists: false,
      rosterStatus: seeded.rosterStatus,
      teams: teamsFromRows(roster),
    };
  }
  const row = allocation as AllocationRow;

  const [roster, people, channels, duties] = await Promise.all([
    rosterRows ?? nightRosterRows(supabase, nightDate),
    supabase
      .from("night_allocation_people")
      .select(
        "person_key, user_id, display_name, employee_code, role, is_available, half, can_take_tso, is_manual, color_index, availability",
      )
      .eq("allocation_id", row.id),
    supabase
      .from("night_allocation_channels")
      .select("channel_code, in_use, open_at, close_at, starter_key, merged_into")
      .eq("allocation_id", row.id),
    supabase
      .from("night_allocation_duties")
      .select("id, channel_code, person_key, start_min, end_min, kind, note")
      .eq("allocation_id", row.id)
      .order("start_min", { ascending: true }),
  ]);
  for (const result of [people, channels, duties]) {
    if (result.error) throw result.error;
  }

  const savedChannels = ((channels.data ?? []) as unknown as SavedChannelRow[]).map(
    (entry): NightChannel => ({
      code: entry.channel_code,
      inUse: !!entry.in_use,
      openAt: Number(entry.open_at),
      closeAt: Number(entry.close_at),
      starterKey: entry.starter_key ?? null,
      mergedInto: entry.merged_into ?? null,
    }),
  );
  // A channel added to the defaults after this night was saved should appear,
  // unticked configuration and all, rather than vanish from the board.
  for (const fallback of defaultChannels()) {
    if (!savedChannels.some(channel => channel.code === fallback.code)) savedChannels.push(fallback);
  }
  // Rows come back in no particular order; the board and the exports follow this.
  const orderedChannels = inBoardOrder(savedChannels);

  const state: NightAllocationState = {
    nightDate,
    dutyLengthPref: Number(row.duty_length_pref) || 0,
    status: row.status === "final" ? "final" : "draft",
    version: Number(row.version) || 0,
    people: ((people.data ?? []) as unknown as SavedPersonRow[]).map(
      (entry, index): NightPerson => ({
        key: entry.person_key,
        userId: entry.user_id ?? null,
        name: entry.display_name ?? "Unknown",
        code: entry.employee_code || initialsFor(entry.display_name ?? ""),
        role: entry.role || "Employee",
        available: !!entry.is_available,
        availability: normalizeAvailability(entry.availability),
        canTakeTso: !!entry.can_take_tso,
        half: entry.half === "1st" || entry.half === "2nd" ? entry.half : null,
        manual: !!entry.is_manual,
        colorIndex: Number.isFinite(entry.color_index) ? Number(entry.color_index) : index,
      }),
    ),
    channels: orderedChannels,
    duties: ((duties.data ?? []) as unknown as SavedDutyRow[]).map(dutyFromRow),
    savedByName: row.updated_by_name,
    savedAt: row.updated_at,
  };

  state.people.sort((a, b) => a.name.localeCompare(b.name));
  // A saved night carries its own people, so the roster is not the explanation
  // for anything the user sees.
  return { state, exists: true, rosterStatus: null, teams: teamsFromRows(roster) };
}

// ── Accepting a state from a client ─────────────────────────────────────────

const HALF_VALUES = new Set(["1st", "2nd"]);

/** Whatever arrived over the wire, read as a bag of unknown fields. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
const clampMinute = (value: unknown) => {
  const minute = Math.round(Number(value));
  if (!Number.isFinite(minute)) return 0;
  return Math.max(0, Math.min(720, minute));
};

/**
 * Coerce whatever arrived over the wire into the module's own shape.
 *
 * This is structural only — it drops unknown fields and clamps times into the
 * night. The rules are applied separately by `validateAllocation`, which is the
 * check that decides whether a night may be saved.
 */
export function parseIncomingState(nightDate: string, body: unknown): NightAllocationState {
  const envelope = asRecord(body);
  const raw = asRecord(envelope.state ?? envelope);
  const people: NightPerson[] = asArray(raw.people)
        .map(asRecord)
        .filter(person => typeof person.key === "string" && person.key.length > 0)
        .slice(0, 200)
        .map((person, index) => ({
          key: String(person.key).slice(0, 128),
          userId: typeof person.userId === "string" ? person.userId : null,
          name: String(person.name ?? "Unknown").slice(0, 120),
          code: String(person.code ?? "").slice(0, 16),
          role: String(person.role ?? "Employee").slice(0, 80),
          available: person.available !== false,
          availability: normalizeAvailability(person.availability),
          canTakeTso: !!person.canTakeTso,
          half: HALF_VALUES.has(String(person.half)) ? (person.half as NightPerson["half"]) : null,
          manual: !!person.manual,
          colorIndex: Number.isFinite(person.colorIndex) ? Number(person.colorIndex) : index,
        }));

  const incomingChannels = asArray(raw.channels)
    .map(asRecord)
    .filter(channel => typeof channel.code === "string" && channel.code.length > 0);
  const channels: NightChannel[] = incomingChannels.length
    ? incomingChannels
        .slice(0, 32)
        .map(channel => ({
          code: String(channel.code).slice(0, 32),
          inUse: channel.inUse !== false,
          openAt: clampMinute(channel.openAt),
          closeAt: clampMinute(channel.closeAt),
          starterKey: typeof channel.starterKey === "string" ? channel.starterKey.slice(0, 128) : null,
          mergedInto: typeof channel.mergedInto === "string" ? channel.mergedInto.slice(0, 32) : null,
        }))
    : defaultChannels();

  const duties: NightDuty[] = asArray(raw.duties)
        .map(asRecord)
        .filter(duty => typeof duty.channelCode === "string" && typeof duty.personKey === "string")
        .slice(0, 500)
        .map((duty, index) => {
          const parsed: NightDuty = {
            id: typeof duty.id === "string" && duty.id ? duty.id.slice(0, 64) : `d${index}`,
            channelCode: String(duty.channelCode).slice(0, 32),
            personKey: String(duty.personKey).slice(0, 128),
            startMin: clampMinute(duty.startMin),
            endMin: clampMinute(duty.endMin),
          };
          // Only a DB slot carries a kind and a note; anything else is an ordinary duty.
          if (duty.kind === "db") {
            parsed.kind = "db";
            parsed.note = cleanDbNote(duty.note);
          }
          return parsed;
        });

  const pref = Math.round(Number(raw.dutyLengthPref));
  return {
    nightDate,
    dutyLengthPref: pref === 0 || (pref >= 30 && pref <= 120) ? pref : 0,
    status: raw.status === "final" ? "final" : "draft",
    version: Number.isFinite(Number(raw.version)) ? Math.max(0, Math.round(Number(raw.version))) : 0,
    people,
    channels,
    duties,
    savedByName: typeof raw.savedByName === "string" ? raw.savedByName : null,
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : null,
  };
}

export function validate(state: NightAllocationState): ValidationResult {
  return validateAllocation(state);
}

// ── Writing ─────────────────────────────────────────────────────────────────

export interface SaveOutcome {
  ok: boolean;
  conflict?: boolean;
  version: number;
  allocationId?: string;
}

/** One transaction: version check, replace the night, bump, audit. */
export async function saveState(
  supabase: SupabaseClient,
  state: NightAllocationState,
  actor: { id: string; name: string },
): Promise<SaveOutcome> {
  const { data, error } = await supabase.rpc("night_allocation_save", {
    p_night_date: state.nightDate,
    p_expected_version: state.version,
    p_duty_length_pref: state.dutyLengthPref,
    p_status: state.status,
    p_channels: state.channels.map(channel => ({
      channel_code: channel.code,
      in_use: channel.inUse,
      open_at: channel.openAt,
      close_at: channel.closeAt,
      starter_key: channel.starterKey,
      merged_into: channel.mergedInto ?? null,
    })),
    p_people: state.people.map(person => ({
      person_key: person.key,
      user_id: person.userId,
      display_name: person.name,
      employee_code: person.code || null,
      role: person.role,
      is_available: person.available,
      availability: person.availability ?? null,
      half: person.half,
      can_take_tso: person.canTakeTso,
      is_manual: person.manual,
      color_index: person.colorIndex,
    })),
    p_duties: state.duties.map(duty => ({
      channel_code: duty.channelCode,
      person_key: duty.personKey,
      start_min: duty.startMin,
      end_min: duty.endMin,
      kind: duty.kind === "db" ? "db" : "duty",
      note: duty.kind === "db" ? duty.note ?? null : null,
    })),
    p_actor: actor.id,
    p_actor_name: actor.name,
  });
  if (error) throw error;

  const result = (data ?? {}) as { ok?: boolean; conflict?: boolean; version?: number; allocation_id?: string };
  return {
    ok: !!result.ok,
    conflict: !!result.conflict,
    version: Number(result.version) || 0,
    allocationId: result.allocation_id,
  };
}

/** Audit rows for everything that is not a save — generate, reset, share, email. */
export async function recordAudit(
  supabase: SupabaseClient,
  nightDate: string,
  actor: { id: string; name: string },
  action: "generate" | "reset" | "share" | "email",
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { data } = await supabase
    .from("night_allocations")
    .select("id")
    .eq("night_date", nightDate)
    .maybeSingle();

  const { error } = await supabase.from("night_allocation_audit").insert({
    allocation_id: (data as { id?: string } | null)?.id ?? null,
    night_date: nightDate,
    user_id: actor.id,
    user_name: actor.name,
    action,
    payload,
  });
  // An audit row that fails to write must not fail the user's action, but it
  // must be visible in the function logs.
  if (error) console.error("[night-allocation] audit write failed", error);
}

/**
 * The user's role, or null while their account is not approved.
 *
 * The same `get_user_role` the app's own sign-in uses to turn away accounts
 * that are still waiting for approval. A valid token is not enough on its own:
 * self-registration creates the account, unapproved, before anyone has vouched
 * for it.
 */
export async function approvedRole(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (error) throw error;
  return typeof data === "string" && data ? data : null;
}

/**
 * Every address on file for an account, lower-cased: the only addresses the
 * roster may be emailed to.
 *
 * Paged until a page comes back empty, because PostgREST caps each response
 * (1,000 rows by default) and a truncated list would turn real colleagues away
 * at random.
 */
export async function accountEmails(supabase: SupabaseClient): Promise<Set<string>> {
  const rows = await selectAllPages<{ email: string | null }>((from, to) =>
    supabase
      .from("profiles")
      .select("email")
      .not("email", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return new Set(rows.map(row => (row.email ?? "").trim().toLowerCase()).filter(Boolean));
}

/** The acting user's display name, for "Saved by …" and the audit trail. */
export async function actorName(supabase: SupabaseClient, userId: string, fallback?: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return (data as { full_name?: string } | null)?.full_name || fallback || "Unknown";
}
