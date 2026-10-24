/**
 * Storage API — one function, five routes, everything that writes to R2.
 *
 *   POST|DELETE /api/storage/leave-document                 leave attachment upload
 *   POST|DELETE /api/storage/profile-picture                profile photo upload / removal
 *   POST|DELETE /api/storage/announcement-attachment        admin-only announcement file
 *   GET         /api/storage/announcement-attachment-url    signed URL for that file
 *   GET         /api/storage/announcement-attachment-file   the file's bytes, for sharing
 *   GET|POST    /api/storage/reconcile                      daily bucket recount (cron)
 *
 * Folded into one function for the Hobby-plan cap of twelve, as in
 * api/leave/[...route].ts. The two upload routes used to be api/upload/*.ts;
 * their old URLs are kept alive by rewrites in vercel.json. Every write goes
 * through putObject() in lib/r2.ts, which enforces the free-tier storage quota.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { handler as leaveDocument } from "../../lib/upload/leaveDocument.js";
import { handler as profilePicture } from "../../lib/upload/profilePicture.js";
import {
  handler as announcementAttachment,
  urlHandler as announcementAttachmentUrl,
  fileHandler as announcementAttachmentFile,
} from "../../lib/storage/announcementAttachment.js";
import { handler as reconcile } from "../../lib/storage/reconcile.js";

// The upload routes read the raw multipart stream.
export const config = {
  api: {
    bodyParser: false,
  },
};

const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = {
  "leave-document": leaveDocument,
  "profile-picture": profilePicture,
  "announcement-attachment": announcementAttachment,
  "announcement-attachment-url": announcementAttachmentUrl,
  "announcement-attachment-file": announcementAttachmentFile,
  reconcile,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const segments = ([] as string[]).concat((req.query.route as string[] | string) ?? []);
  const route = routes[segments[0] ?? ""];

  if (!route) {
    return res.status(404).json({ error: "Unknown storage route" });
  }

  // Each handler does its own CORS, preflight, auth and method check.
  await route(req, res);
}
