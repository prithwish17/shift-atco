import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Reset, through the route itself with the database stubbed out. On a night
 * that has been saved, the fresh night replaces the saved one — for everyone —
 * behind the same version check as a save. On one nobody has saved, and for a
 * page that doesn't say which version it was showing, it is a working copy and
 * nothing is written.
 */
const mocks = vi.hoisted(() => {
  const person = {
    key: "p1",
    userId: "user-1",
    name: "Crew One",
    code: "C1",
    role: "TWR",
    available: true,
    canTakeTso: false,
    half: null,
    manual: false,
    colorIndex: 0,
  };
  const channel = { code: "TWR", inUse: true, openAt: 0, closeAt: 120, starterKey: null, mergedInto: null };
  const saved = {
    nightDate: "2026-09-17",
    dutyLengthPref: 0,
    status: "draft" as const,
    version: 3,
    people: [person],
    channels: [channel],
    duties: [{ id: "d1", channelCode: "TWR", personKey: "p1", startMin: 0, endMin: 120 }],
    savedByName: "Crew One",
    savedAt: "2026-09-17T10:00:00Z",
  };
  const fresh = { ...saved, version: 0, duties: [], savedByName: null, savedAt: null };
  return {
    saved,
    fresh,
    night: { exists: true, version: 3 },
    seedState: vi.fn(async () => ({ state: fresh, rosterStatus: "filled" as const })),
    loadState: vi.fn(),
    saveState: vi.fn(async () => ({ ok: true, version: 4 })),
  };
});

vi.mock("../apiAuth.js", () => ({
  handleCorsPreflight: () => false,
  setCorsHeaders: () => undefined,
  authenticateRequest: async () => ({ id: "user-1", email: "crew@atcora.in", accessToken: "token" }),
}));

vi.mock("./service.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./service.js")>();
  return {
    ...actual,
    missingServiceEnv: () => [],
    serviceClient: () => ({ rpc: async () => ({ data: "wso", error: null }) }),
    nightRosterRows: async () => [],
    seedState: mocks.seedState,
    loadState: mocks.loadState,
    saveState: mocks.saveState,
    actorName: async () => "Crew One",
    recordAudit: async () => undefined,
  };
});

const { default: handler } = await import("../../api/night-allocation/[...route].js");

async function reset(body?: unknown) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    setHeader: () => res,
    end: () => res,
  };
  const req = { method: "POST", url: "/api/night-allocation/2026-09-17/reset", query: {}, headers: {}, body };
  await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);
  return res as { statusCode: number; body: Record<string, unknown> & { state?: { version: number; duties: unknown[] } } };
}

beforeEach(() => {
  mocks.night.exists = true;
  mocks.night.version = 3;
  mocks.seedState.mockClear();
  mocks.saveState.mockClear();
  mocks.loadState.mockReset();
  // The saved night as it stands; once a save goes through, the next read sees it.
  mocks.loadState.mockImplementation(async () => {
    const version = mocks.night.version;
    return mocks.night.exists
      ? { state: { ...mocks.saved, version }, exists: true, rosterStatus: null, teams: ["A"] }
      : { state: mocks.fresh, exists: false, rosterStatus: "filled", teams: ["A"] };
  });
  mocks.saveState.mockImplementation(async () => {
    mocks.night.version += 1;
    return { ok: true, version: mocks.night.version };
  });
});

describe("resetting a night", () => {
  it("saves the fresh night in place of the saved one, for everyone", async () => {
    const res = await reset({ version: 3 });

    expect(res.statusCode).toBe(200);
    expect(res.body.persisted).toBe(true);
    expect(mocks.saveState).toHaveBeenCalledTimes(1);
    const written = (mocks.saveState.mock.calls[0] as unknown[])[1] as { version: number; duties: unknown[] };
    // Written against the saved version, so the database's own check agrees.
    expect(written).toMatchObject({ version: 3, duties: [] });
    expect(res.body.state?.version).toBe(4);
  });

  it("refuses when someone else has saved since the page loaded, and hands back their version", async () => {
    const res = await reset({ version: 2 });

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/Someone else saved this night/);
    expect(res.body.state?.version).toBe(3);
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("only seeds a night nobody has saved — opening a date never creates a row", async () => {
    mocks.night.exists = false;
    const res = await reset({ version: 0 });

    expect(res.statusCode).toBe(200);
    expect(res.body.persisted).toBe(false);
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("keeps a page that sends no version to the old working-copy reset", async () => {
    const res = await reset();

    expect(res.body.persisted).toBe(false);
    expect(res.body.state?.version).toBe(3);
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("doesn't write a fresh night the rules refuse, and says why", async () => {
    mocks.seedState.mockResolvedValueOnce({
      state: { ...mocks.fresh, channels: [{ ...mocks.fresh.channels[0], inUse: false }] },
      rosterStatus: "empty",
    });
    const res = await reset({ version: 3 });

    expect(res.statusCode).toBe(200);
    expect(res.body.persisted).toBe(false);
    expect(res.body.unsavedReason).toBe("Turn on at least one channel.");
    expect(mocks.saveState).not.toHaveBeenCalled();
  });
});
