import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadState } from "./service.js";

/**
 * Reading a night, against an in-memory stand-in for Supabase that records
 * which tables were read, honours `.range()`, and — like PostgREST — never
 * returns more than 1,000 rows in one response.
 */
type Row = Record<string, unknown>;

const MAX_ROWS = 1000;

function fakeSupabase(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    const rows = tables[table] ?? [];
    let window: [number, number] | null = null;
    const result = () => {
      const [start, end] = window ?? [0, rows.length - 1];
      return { data: rows.slice(start, Math.min(end + 1, start + MAX_ROWS)), error: null };
    };
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      ilike: () => builder,
      not: () => builder,
      order: () => builder,
      range: (start: number, end: number) => {
        window = [start, end];
        return builder;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  };
  return { reads, client: { from } as unknown as SupabaseClient };
}

const roster: Row[] = [
  { unit: "TWR", position: "1st Half", employee_name: "ASHA RAO/ MGR - ADC", team: "A" },
  { unit: "SMC", position: "2nd Half", employee_name: "VIKRAM SEN", team: "A" },
];

describe("reading a night nobody has saved", () => {
  it("reads the shift roster once for the crew, the positions and the team", async () => {
    const { reads, client } = fakeSupabase({ night_allocations: [], rosters: roster, profiles: [] });
    const loaded = await loadState(client, "2026-09-20");

    expect(reads.filter(table => table === "rosters")).toHaveLength(1);
    expect(loaded.exists).toBe(false);
    expect(loaded.teams).toEqual(["A"]);
    expect(loaded.state.people.map(person => person.name)).toEqual(["Asha Rao", "Vikram Sen"]);
  });

  it("matches people against every profile, not just the first page", async () => {
    // Past PostgREST's 1,000-row cap, a single select would never see this one.
    const profiles: Row[] = Array.from({ length: 2300 }, (_, index) => ({
      id: `profile-${index}`,
      full_name: index === 2150 ? "Asha Rao" : `Someone Else ${index}`,
      employee_id: null,
      designation: null,
      can_take_tso: false,
    }));
    const { client } = fakeSupabase({ night_allocations: [], rosters: roster, profiles });
    const loaded = await loadState(client, "2026-09-20");

    expect(loaded.state.people.find(person => person.name === "Asha Rao")?.userId).toBe("profile-2150");
  });
});

describe("reading a saved night", () => {
  const saved = (channels: Row[]) =>
    fakeSupabase({
      night_allocations: [
        {
          id: "a1",
          night_date: "2026-09-20",
          duty_length_pref: 0,
          status: "draft",
          version: 3,
          updated_by_name: "Asha Rao",
          updated_at: "2026-09-20T10:00:00Z",
        },
      ],
      rosters: roster,
      night_allocation_people: [],
      night_allocation_channels: channels,
      night_allocation_duties: [],
    });

  const channelRow = (code: string) => ({
    channel_code: code,
    in_use: true,
    open_at: 0,
    close_at: 720,
    starter_key: null,
    merged_into: null,
  });

  it("puts the positions in board order, whatever order the rows came back in", async () => {
    const { client } = saved(["TSO", "CLD", "TWR", "SMC-S"].map(channelRow));
    const loaded = await loadState(client, "2026-09-20");
    expect(loaded.state.channels.map(channel => channel.code)).toEqual(["TWR", "SMC-S", "SMC-N", "CLD", "TSO"]);
  });

  it("reads the roster once, for the team name", async () => {
    const { reads, client } = saved([channelRow("TWR")]);
    const loaded = await loadState(client, "2026-09-20");
    expect(reads.filter(table => table === "rosters")).toHaveLength(1);
    expect(loaded.teams).toEqual(["A"]);
  });
});

describe("reading DB slots and part-night times back", () => {
  it("keeps a slot's kind and note and a person's times, and reads older rows as ordinary", async () => {
    const { client } = fakeSupabase({
      night_allocations: [
        {
          id: "a1",
          night_date: "2026-09-20",
          duty_length_pref: 0,
          status: "draft",
          version: 2,
          updated_by_name: "Asha Rao",
          updated_at: "2026-09-20T10:00:00Z",
        },
      ],
      rosters: roster,
      night_allocation_people: [
        {
          person_key: "p1",
          user_id: null,
          display_name: "Asha Rao",
          employee_code: null,
          role: "TWR",
          is_available: true,
          half: null,
          can_take_tso: false,
          is_manual: false,
          color_index: 0,
          availability: { mode: "except", periods: [[240, 360]] },
        },
        {
          person_key: "p2",
          user_id: null,
          display_name: "Vikram Sen",
          employee_code: null,
          role: "SMC",
          is_available: true,
          half: null,
          can_take_tso: false,
          is_manual: false,
          color_index: 1,
          availability: null,
        },
      ],
      night_allocation_channels: [
        { channel_code: "TWR", in_use: true, open_at: 0, close_at: 720, starter_key: null, merged_into: null },
      ],
      night_allocation_duties: [
        { id: "d1", channel_code: "TWR", person_key: "p2", start_min: 240, end_min: 360, kind: "db", note: "Sulagna" },
        { id: "d2", channel_code: "TWR", person_key: "p1", start_min: 0, end_min: 120, kind: "duty", note: null },
        // Saved before DB slots existed: no kind at all.
        { id: "d3", channel_code: "TWR", person_key: "p2", start_min: 120, end_min: 240 },
        // A blank holds nobody, even if a stray key was stored with it.
        { id: "b1", channel_code: "TWR", person_key: "p1", start_min: 360, end_min: 480, kind: "blank", note: null },
      ],
    });

    const { state } = await loadState(client, "2026-09-20");
    expect(state.duties.find(duty => duty.id === "d1")).toMatchObject({ kind: "db", note: "Sulagna" });
    expect(state.duties.find(duty => duty.id === "d2")?.kind).toBeUndefined();
    expect(state.duties.find(duty => duty.id === "d3")?.kind).toBeUndefined();
    expect(state.duties.find(duty => duty.id === "b1")).toMatchObject({ kind: "blank", personKey: "" });
    expect(state.people.find(person => person.key === "p1")?.availability).toEqual({
      mode: "except",
      periods: [[240, 360]],
    });
    expect(state.people.find(person => person.key === "p2")?.availability).toBeNull();
  });
});
