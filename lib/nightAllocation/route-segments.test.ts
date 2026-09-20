import { afterEach, describe, expect, it } from "vitest";
import { readRouteSegments } from "../../api/night-allocation/[...route].js";

/**
 * How a catch-all's path reaches the handler differs between the dev server,
 * a direct platform route and a rewrite. Production hit the one case the dev
 * server never produced — no `route` param at all — and every request came back
 * "Expected a night date as YYYY-MM-DD". These are the three shapes.
 */
describe("reading the route segments", () => {
  it("takes an array, as a direct platform route gives it", () => {
    expect(readRouteSegments(["2026-09-20", "generate"], "/api/night-allocation/2026-09-20/generate")).toEqual([
      "2026-09-20",
      "generate",
    ]);
  });

  it("splits a slash-joined string, as a rewrite gives it", () => {
    expect(readRouteSegments("2026-09-20/generate", undefined)).toEqual(["2026-09-20", "generate"]);
  });

  it("falls back to the URL when the param never arrives", () => {
    // The production failure: the function ran, but with no `route` param.
    expect(readRouteSegments(undefined, "/api/night-allocation/2026-09-20")).toEqual(["2026-09-20"]);
    expect(readRouteSegments(undefined, "/api/night-allocation/2026-09-20/export.txt?pageUrl=x")).toEqual([
      "2026-09-20",
      "export.txt",
    ]);
  });

  it("ignores an empty param and still finds the date", () => {
    expect(readRouteSegments([], "/api/night-allocation/2026-09-20/generate")).toEqual([
      "2026-09-20",
      "generate",
    ]);
    expect(readRouteSegments("", "/api/night-allocation/2026-09-20")).toEqual(["2026-09-20"]);
  });

  it("drops stray slashes rather than yielding empty segments", () => {
    expect(readRouteSegments(undefined, "/api/night-allocation//2026-09-20//generate/")).toEqual([
      "2026-09-20",
      "generate",
    ]);
  });

  it("decodes a percent-encoded segment", () => {
    expect(readRouteSegments(undefined, "/api/night-allocation/2026-09-20/export%2Etxt")).toEqual([
      "2026-09-20",
      "export.txt",
    ]);
  });

  it("returns nothing when there is no path to read", () => {
    expect(readRouteSegments(undefined, undefined)).toEqual([]);
    expect(readRouteSegments(undefined, "/api/something-else/2026-09-20")).toEqual([]);
  });
});

describe("server environment guard", () => {
  const snapshot = { ...process.env };
  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("names the service-role key when it is missing", async () => {
    const { missingServiceEnv } = await import("./service.js");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    expect(missingServiceEnv()).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("names both when neither is set", async () => {
    const { missingServiceEnv } = await import("./service.js");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_PUBLIC_SUPABASE_URL;
    expect(missingServiceEnv()).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("accepts the public URL name as a fallback", async () => {
    const { missingServiceEnv } = await import("./service.js");
    delete process.env.SUPABASE_URL;
    process.env.VITE_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    expect(missingServiceEnv()).toEqual([]);
  });

  it("never reads a VITE_ name for the key — that would ship it to the browser", async () => {
    const { missingServiceEnv } = await import("./service.js");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    (process.env as Record<string, string>).VITE_PUBLIC_SUPABASE_SERVICE_ROLE_KEY = "leaked";
    expect(missingServiceEnv()).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
  });
});
