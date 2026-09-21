/**
 * Sending the night roster by email.
 *
 * Uses the mail providers the app is already configured with — Brevo first,
 * Resend as the fallback — mirroring supabase/functions/_shared/email.ts, which
 * runs in Deno and cannot be imported here. No new provider and no new cost.
 *
 * With neither key configured the route answers 503 and the page reports it.
 */
const RESEND_API_KEY = () => process.env.RESEND_API_KEY || "";
const BREVO_API_KEY = () => process.env.BREVO_API_KEY || "";
const FROM_EMAIL = () => process.env.EMAIL_FROM || "ATCORA <admin@atcora.in>";
const FROM_NAME = () => process.env.EMAIL_FROM_NAME || "ATCORA";

export interface MailAttachment {
  filename: string;
  /** Base64 without a data: prefix. */
  content: string;
}

export interface MailParams {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface MailResult {
  success: boolean;
  provider: "resend" | "brevo" | "none";
  messageId?: string;
  error?: string;
}

export function transportConfigured(): boolean {
  return !!RESEND_API_KEY() || !!BREVO_API_KEY();
}

async function sendViaResend(params: MailParams): Promise<MailResult> {
  const apiKey = RESEND_API_KEY();
  if (!apiKey) return { success: false, provider: "resend", error: "RESEND_API_KEY not configured" };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL(),
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      attachments: params.attachments?.map(file => ({ filename: file.filename, content: file.content })),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { success: false, provider: "resend", error: `Resend ${response.status}: ${body}`.slice(0, 500) };
  }
  const data = (await response.json().catch(() => ({}))) as { id?: string };
  return { success: true, provider: "resend", messageId: data.id };
}

async function sendViaBrevo(params: MailParams): Promise<MailResult> {
  const apiKey = BREVO_API_KEY();
  if (!apiKey) return { success: false, provider: "brevo", error: "BREVO_API_KEY not configured" };

  const fromParts = FROM_EMAIL().match(/^(.+?)\s*<(.+)>$/);
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: {
        name: fromParts ? fromParts[1].trim() : FROM_NAME(),
        email: fromParts ? fromParts[2] : "admin@atcora.in",
      },
      to: params.to.map(email => ({ email })),
      subject: params.subject,
      htmlContent: params.html,
      textContent: params.text,
      attachment: params.attachments?.map(file => ({ name: file.filename, content: file.content })),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { success: false, provider: "brevo", error: `Brevo ${response.status}: ${body}`.slice(0, 500) };
  }
  const data = (await response.json().catch(() => ({}))) as { messageId?: string };
  return { success: true, provider: "brevo", messageId: data.messageId };
}

/**
 * A roster is a bulk, non-urgent message, so Brevo leads (the generous free
 * tier) and Resend is the failover — the same routing the notification mailer
 * uses for priority 4 and above.
 */
export async function sendRosterEmail(params: MailParams): Promise<MailResult> {
  if (!transportConfigured()) {
    return { success: false, provider: "none", error: "No mail transport is configured." };
  }

  const primary = await sendViaBrevo(params).catch(error => ({
    success: false as const,
    provider: "brevo" as const,
    error: (error as Error).message,
  }));
  if (primary.success) return primary;

  const fallback = await sendViaResend(params).catch(error => ({
    success: false as const,
    provider: "resend" as const,
    error: (error as Error).message,
  }));
  if (fallback.success) return fallback;

  return { success: false, provider: "none", error: `${primary.error ?? ""} ${fallback.error ?? ""}`.trim() };
}
