/**
 * Leave API — one function, three routes.
 *
 *   GET  /api/leave/document-url   a short-lived signed URL for an attachment
 *   GET  /api/leave/roster         the cached approved-leave roster for a month
 *   POST /api/leave/sheet-push     push approved leave to the Google Sheet
 *
 * These were three separate serverless functions until the Hobby-plan cap of
 * twelve forced them together. The handlers themselves are unchanged and still
 * live one-per-file under lib/leave/; this module only picks between them. The
 * old flat URLs (/api/leave-document-url and friends) are kept alive by the
 * rewrites in vercel.json, so nothing calling them had to change.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { handler as documentUrl } from "../../lib/leave/documentUrl.js";
import { handler as roster } from "../../lib/leave/roster.js";
import { handler as sheetPush } from "../../lib/leave/sheetPush.js";

const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = {
  "document-url": documentUrl,
  roster,
  "sheet-push": sheetPush,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const segments = ([] as string[]).concat((req.query.route as string[] | string) ?? []);
  const route = routes[segments[0] ?? ""];

  if (!route) {
    return res.status(404).json({ error: "Unknown leave route" });
  }

  // Each handler does its own CORS, preflight, auth and method check.
  await route(req, res);
}
