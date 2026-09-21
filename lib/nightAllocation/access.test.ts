import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * The route itself, with the database and the mail providers stubbed out. What
 * is under test is who gets through and what gets sent — the approval gate and
 * the email route's limits — so everything else is the real code.
 */
const mocks = vi.hoisted(() => {
  const savedNight = {
    nightDate: "2026-09-17",
    dutyLengthPref: 0,
    status: "draft" as const,
    version: 1,
    people: [
      {
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
      },
    ],
    channels: [{ code: "TWR", inUse: true, openAt: 0, closeAt: 120, starterKey: null, mergedInto: null }],
    duties: [{ id: "d1", channelCode: "TWR", personKey: "p1", startMin: 0, endMin: 120 }],
    savedByName: "Crew One",
    savedAt: "2026-09-17T10:00:00Z",
  };
  const state = { role: null as string | null };
  return {
    state,
    savedNight,
    rpc: vi.fn(async () => ({ data: state.role, error: null })),
    loadState: vi.fn(async () => ({ state: savedNight, exists: true, rosterStatus: null, teams: ["A"] })),
    saveState: vi.fn(async () => ({ ok: true, version: 2 })),
    sendRosterEmail: vi.fn(async () => ({ success: true, provider: "brevo" as const })),
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
    serviceClient: () => ({
      rpc: mocks.rpc,
      from: () => ({ insert: async () => ({ error: null }) }),
    }),
    accountEmails: async () => new Set(["crew@atcora.in", "wso@atcora.in"]),
    loadState: mocks.loadState,
    saveState: mocks.saveState,
    actorName: async () => "Crew One",
    recordAudit: async () => undefined,
  };
});

vi.mock("./rateLimit.js", () => ({
  rateLimit: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }),
}));

vi.mock("./email.js", () => ({
  transportConfigured: () => true,
  sendRosterEmail: mocks.sendRosterEmail,
}));

const { default: handler } = await import("../../api/night-allocation/[...route].js");

const PDF = Buffer.from("%PDF-1.3\n%roster\n").toString("base64");

async function call(method: string, path: string, body?: unknown) {
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
    send(payload: unknown) {
      res.body = payload;
      return res;
    },
    setHeader: () => res,
    end: () => res,
  };
  const req = { method, url: `/api/night-allocation/${path}`, query: {}, headers: {}, body };
  await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);
  return res as { statusCode: number; body: { error?: string } & Record<string, unknown> };
}

beforeEach(() => {
  mocks.state.role = null;
  mocks.rpc.mockClear();
  mocks.saveState.mockClear();
  mocks.sendRosterEmail.mockClear();
  mocks.loadState.mockClear();
});

describe("an account still waiting for approval", () => {
  it("is asked about through the app's own role check", async () => {
    await call("GET", "2026-09-17");
    expect(mocks.rpc).toHaveBeenCalledWith("get_user_role", { _user_id: "user-1" });
  });

  it("can't read a night", async () => {
    const res = await call("GET", "2026-09-17");
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/hasn't been approved/);
  });

  it("can't save over a night", async () => {
    const res = await call("PUT", "2026-09-17", { state: mocks.savedNight });
    expect(res.statusCode).toBe(403);
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("can't send email", async () => {
    const res = await call("POST", "2026-09-17/email", { recipients: ["crew@atcora.in"] });
    expect(res.statusCode).toBe(403);
    expect(mocks.sendRosterEmail).not.toHaveBeenCalled();
  });
});

describe("an approved account", () => {
  beforeEach(() => {
    mocks.state.role = "employee";
  });

  it("gets through, whatever its role", async () => {
    expect((await call("GET", "2026-09-17")).statusCode).toBe(200);
    expect((await call("POST", "2026-09-17/validate", { state: mocks.savedNight })).statusCode).toBe(200);
  });

  it("can't email the roster to an address with no account", async () => {
    const res = await call("POST", "2026-09-17/email", {
      recipients: ["crew@atcora.in", "stranger@example.com"],
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("stranger@example.com");
    expect(mocks.sendRosterEmail).not.toHaveBeenCalled();
  });

  it("can't attach anything but the roster PDF or board image", async () => {
    const res = await call("POST", "2026-09-17/email", {
      recipients: ["crew@atcora.in"],
      attachments: [{ filename: "roster.pdf", content: Buffer.from("<html></html>").toString("base64") }],
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.sendRosterEmail).not.toHaveBeenCalled();
  });

  it("sends to colleagues, with the attachment named by the server", async () => {
    const res = await call("POST", "2026-09-17/email", {
      recipients: ["Crew@Atcora.in"],
      attachments: [{ filename: "whatever.exe", content: PDF }],
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.sendRosterEmail).toHaveBeenCalledTimes(1);
    const [params] = mocks.sendRosterEmail.mock.calls[0] as unknown as [
      { to: string[]; attachments: Array<{ filename: string }> },
    ];
    expect(params.to).toEqual(["crew@atcora.in"]);
    expect(params.attachments.map(file => file.filename)).toEqual(["night-allocation-2026-09-17.pdf"]);
  });
});

describe("the night date", () => {
  it("refuses a date that only looks real, before touching the database", async () => {
    mocks.state.role = "employee";
    const res = await call("GET", "2026-02-31");
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("That is not a real date.");
    expect(mocks.loadState).not.toHaveBeenCalled();
  });
});

describe("sharing the saved roster", () => {
  beforeEach(() => {
    mocks.state.role = "employee";
  });

  it("won't email a night with nobody on it", async () => {
    mocks.loadState.mockResolvedValueOnce({
      state: { ...mocks.savedNight, duties: [] },
      exists: true,
      rosterStatus: null,
      teams: ["A"],
    });
    const res = await call("POST", "2026-09-17/email", { recipients: ["crew@atcora.in"] });
    expect(res.statusCode).toBe(422);
    expect(mocks.sendRosterEmail).not.toHaveBeenCalled();
  });

  it("refuses attachments past the cap with its own answer, not the platform's", async () => {
    const big = Buffer.concat([Buffer.from("%PDF-1.3\n"), Buffer.alloc(3 * 1024 * 1024)]).toString("base64");
    const res = await call("POST", "2026-09-17/email", {
      recipients: ["crew@atcora.in"],
      attachments: [{ content: big }],
    });
    expect(res.statusCode).toBe(413);
    expect(mocks.sendRosterEmail).not.toHaveBeenCalled();
  });

  it("loads the night once to email it, and once to export it", async () => {
    await call("POST", "2026-09-17/email", { recipients: ["crew@atcora.in"] });
    expect(mocks.loadState).toHaveBeenCalledTimes(1);

    mocks.loadState.mockClear();
    const res = await call("GET", "2026-09-17/export.txt");
    expect(res.statusCode).toBe(200);
    expect(mocks.loadState).toHaveBeenCalledTimes(1);
  });
});
