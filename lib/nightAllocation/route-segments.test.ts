import { describe, expect, it } from "vitest";
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
