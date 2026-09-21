/**
 * Night Channel Allocation — what the email route will send, and to whom.
 *
 * The roster goes out from the station's own address, so the route must not be
 * usable to send anything else to anyone else. Recipients have to be people
 * with an account in the app, and attachments have to be what the page itself
 * produces — the roster PDF and the board image — recognised by their contents
 * rather than by the name the browser gave them.
 */
import type { MailAttachment } from "./email.js";

const RECIPIENT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The addresses as sent: trimmed, lower-cased, de-duplicated, well-formed only. */
export function parseRecipients(raw: unknown): string[] {
  return [
    ...new Set(
      (Array.isArray(raw) ? raw : [])
        .map(entry => String(entry ?? "").trim().toLowerCase())
        .filter(entry => RECIPIENT_PATTERN.test(entry)),
    ),
  ];
}

/** Recipients with an account, and those without. `known` holds lower-cased addresses. */
export function vetRecipients(
  recipients: string[],
  known: ReadonlySet<string>,
): { allowed: string[]; rejected: string[] } {
  return {
    allowed: recipients.filter(address => known.has(address)),
    rejected: recipients.filter(address => !known.has(address)),
  };
}

/** The leading bytes of each file the page can produce. */
const SIGNATURES = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
} as const;

export type AttachmentKind = keyof typeof SIGNATURES;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Which of the page's own formats this base64 content is, or null. */
export function attachmentKind(content: string): AttachmentKind | null {
  if (!content || content.length % 4 !== 0 || !BASE64.test(content)) return null;
  const head = Buffer.from(content.slice(0, 16), "base64");
  for (const kind of Object.keys(SIGNATURES) as AttachmentKind[]) {
    if (SIGNATURES[kind].every((byte, index) => head[index] === byte)) return kind;
  }
  return null;
}

/**
 * The attachments to send, or why they were refused. At most one of each kind,
 * named by the server from the night — the browser's filename is not used, so
 * nothing can arrive as `invoice.html`.
 */
export function vetAttachments(
  raw: unknown,
  nightDate: string,
): { attachments: MailAttachment[]; error: string | null } {
  const attachments: MailAttachment[] = [];
  const seen = new Set<AttachmentKind>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const content = String((entry as { content?: unknown } | null)?.content ?? "");
    if (!content) continue;
    const kind = attachmentKind(content);
    if (!kind) return { attachments: [], error: "Only the roster PDF and the board image can be attached." };
    if (seen.has(kind)) {
      return { attachments: [], error: "Attach the roster PDF and the board image once each at most." };
    }
    seen.add(kind);
    attachments.push({ filename: `night-allocation-${nightDate}.${kind}`, content });
  }
  return { attachments, error: null };
}
