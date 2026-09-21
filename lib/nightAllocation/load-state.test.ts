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
