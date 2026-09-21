/**
 * Sharing the finished roster.
 *
 * Anyone who can see the night can share it; sharing changes nothing except an
 * audit row. It is offered only once the night has no hard errors — sending
 * half a roster to the shift is worse than sending none.
 *
 * WhatsApp goes through the Web Share API where the browser has it, which is
 * what lets the text and the attachment go together in one message. Where it
 * does not, a wa.me link carries the text and the file is downloaded to attach
 * by hand. No Business API, no phone numbers in the code.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Copy, Download, FileText, Image as ImageIcon, Loader2, Mail, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  buildRosterText,
  defaultEmailSubject,
  formatNightDate,
  type NightAllocationState,
} from "@/domain/night-allocation";
import { emailNightAllocation, fetchRosterText } from "@/data-access/night-allocation.api";
import { blobToBase64, buildBoardImage, buildRosterPdf, downloadBlob } from "./exports";
import { shareGate } from "./shareGate";

interface ShareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: NightAllocationState;
  /** Teams on the shift roster, for the sub-header on every format. */
  teams: string[];
  /** Hard-rule breaches on the board as it stands. */
  errorCount: number;
  /** True when the board has changes that haven't been saved. */
  dirty: boolean;
}

type Busy = null | "text" | "whatsapp" | "pdf" | "png" | "email";

/** Hoisted: a literal here would be a new identity on every render. */
const NO_EMAILS: string[] = [];

/** True when the person closed the system share sheet without sharing. */
const isShareCancelled = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export function ShareSheet({ open, onOpenChange, state, teams, errorCount, dirty }: ShareSheetProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<Busy>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [subject, setSubject] = useState(defaultEmailSubject(state.nightDate));
  const [note, setNote] = useState("");
  const [attachPdf, setAttachPdf] = useState(true);
  const [attachImage, setAttachImage] = useState(false);

  useEffect(() => {
    setSubject(defaultEmailSubject(state.nightDate));
  }, [state.nightDate]);

  /** Addresses of the people actually on duty tonight, where the app has them. */
  const dutyUserIds = useMemo(
    () =>
      state.people
        .filter(person => person.userId && state.duties.some(duty => duty.personKey === person.key))
        .map(person => person.userId as string),
    [state],
  );

  const { data: dutyEmails = NO_EMAILS } = useQuery({
    queryKey: ["night-allocation-emails", state.nightDate, dutyUserIds.join(",")],
    queryFn: async () => {
      if (!dutyUserIds.length) return [] as string[];
      const { data, error } = await supabase.from("profiles").select("email").in("id", dutyUserIds);
      if (error) throw error;
      return ((data ?? []) as Array<{ email: string | null }>)
        .map(row => (row.email ?? "").trim())
        .filter(Boolean);
    },
    enabled: open && showEmail && dutyUserIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!showEmail || recipients || !dutyEmails.length) return;
    setRecipients(dutyEmails.join(", "));
  }, [showEmail, dutyEmails, recipients]);

  const gate = shareGate(state, { dirty, errorCount });
  // What is on screen is exactly what was saved.
  const saved = state.version > 0 && !dirty;

  const pageUrl = typeof window !== "undefined"
    ? `${window.location.origin}/night-allocation?date=${state.nightDate}`
    : undefined;

  /**
   * The server renders the text from the saved night so everyone shares the
   * same artefact. Before the first save, or if the endpoint is unreachable,
   * the shared rules module produces the identical text locally.
   */
  const rosterText = async () => {
    if (saved) {
      try {
        return await fetchRosterText(state.nightDate, pageUrl);
      } catch {
        /* fall through to the local render */
      }
    }
    return buildRosterText(state, state.savedByName, { pageUrl, teams });
  };

  const run = async (kind: Busy, action: () => Promise<void>) => {
    setBusy(kind);
    try {
      await action();
    } catch (error) {
      toast({
        title: "That didn't work",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const copyText = () =>
    run("text", async () => {
      const text = await rosterText();
      await navigator.clipboard.writeText(text);
      toast({ title: "Roster copied", description: "Paste it into any chat or message." });
    });

  const shareToWhatsApp = () =>
    run("whatsapp", async () => {
      const text = await rosterText();
      const { blob, filename } = await buildBoardImage(state, teams);
      const file = new File([blob], filename, { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ title: `Night channel allocation — ${formatNightDate(state.nightDate)}`, text, files: [file] });
        } catch (error) {
          // Closing the share sheet is a choice, not a failure.
          if (!isShareCancelled(error)) throw error;
        }
        return;
      }

      // No file sharing here: send the text and hand over the image to attach.
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      downloadBlob(blob, filename);
      toast({
        title: "Image downloaded",
        description: "WhatsApp opened with the roster text. Attach the downloaded image if you want the board too.",
      });
    });

  const downloadPdf = () =>
    run("pdf", async () => {
      const { blob, filename } = buildRosterPdf(state, teams);
      downloadBlob(blob, filename);
    });

  const downloadImage = () =>
    run("png", async () => {
      const { blob, filename } = await buildBoardImage(state, teams);
      downloadBlob(blob, filename);
    });

  const sendEmail = () =>
    run("email", async () => {
      const list = recipients
        .split(/[,;\s]+/)
        .map(entry => entry.trim())
        .filter(Boolean);
      if (!list.length) throw new Error("Add at least one email address.");

      const files: Array<{ blob: Blob; filename: string }> = [];
      if (attachPdf) files.push(buildRosterPdf(state, teams));
      if (attachImage) files.push(await buildBoardImage(state, teams));

      // Checked here, before the upload: past the platform's body limit the
      // request never reaches the server, and all that comes back is a bare 413.
      const bytes = files.reduce((sum, file) => sum + file.blob.size, 0);
      if (bytes > MAX_EMAIL_ATTACHMENT_BYTES) {
        const megabytes = (size: number) => (size / (1024 * 1024)).toFixed(1);
        throw new Error(
          `The attachments come to ${megabytes(bytes)} MB, over the ${megabytes(MAX_EMAIL_ATTACHMENT_BYTES)} MB ` +
            "an email can carry. Untick the board image, or download it and share it separately.",
        );
      }

      const attachments = await Promise.all(
        files.map(async file => ({ filename: file.filename, content: await blobToBase64(file.blob) })),
      );

      const result = await emailNightAllocation({
        nightDate: state.nightDate,
        recipients: list,
        subject,
        note,
        attachments,
      });
      toast({
        title: "Roster sent",
        description: `Emailed to ${result.sent} ${result.sent === 1 ? "person" : "people"}.`,
      });
      setShowEmail(false);
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Share tonight's roster</SheetTitle>
          <SheetDescription>{formatNightDate(state.nightDate)} · 13:30 to 01:30 next day</SheetDescription>
        </SheetHeader>

        {gate.blocked ? (
          <p className="mt-6 rounded-lg border border-status-danger/25 bg-status-danger-soft/60 px-3 py-2.5 text-[0.82rem] leading-snug text-corp-text-main">
            {gate.blocked}
          </p>
        ) : (
          <div className="mt-6 space-y-2">
            {gate.notice ? (
              <p className="rounded-lg border border-status-warning/30 bg-status-warning-soft px-3 py-2.5 text-[0.82rem] leading-snug text-corp-text-main">
                {gate.notice}
              </p>
            ) : null}

            <ShareAction icon={Copy} label="Copy text" busy={busy === "text"} onClick={copyText} />
            <ShareAction icon={MessageCircle} label="WhatsApp" busy={busy === "whatsapp"} onClick={shareToWhatsApp} />
            <ShareAction
              icon={Mail}
              label="Email"
              busy={false}
              disabled={!!gate.emailBlocked}
              onClick={() => setShowEmail(value => !value)}
            />
            {gate.emailBlocked ? (
              <p className="px-1 text-xs text-corp-text-soft">{gate.emailBlocked}</p>
            ) : null}
            <ShareAction icon={FileText} label="Download PDF" busy={busy === "pdf"} onClick={downloadPdf} />
            <ShareAction icon={ImageIcon} label="Download image" busy={busy === "png"} onClick={downloadImage} />

            {showEmail && !gate.emailBlocked ? (
              <>
                <Separator className="my-4" />
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="share-recipients">Recipients</Label>
                    <Textarea
                      id="share-recipients"
                      rows={2}
                      value={recipients}
                      onChange={event => setRecipients(event.target.value)}
                      placeholder="name@example.com, someone.else@example.com"
                    />
                    <p className="text-xs text-corp-text-soft">
                      Prefilled with the people on duty tonight who have an address on file. Only people with an
                      Atcora account can be sent the roster.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="share-subject">Subject</Label>
                    <Input id="share-subject" value={subject} onChange={event => setSubject(event.target.value)} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="share-note">Note (optional)</Label>
                    <Textarea id="share-note" rows={2} value={note} onChange={event => setNote(event.target.value)} />
                  </div>

                  <div className="space-y-2">
                    <span className="text-sm font-medium">Attach</span>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={attachPdf} onCheckedChange={checked => setAttachPdf(checked === true)} />
                      PDF roster
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={attachImage} onCheckedChange={checked => setAttachImage(checked === true)} />
                      Board image
                    </label>
                  </div>

                  <Button className="w-full" onClick={sendEmail} disabled={busy === "email"}>
                    {busy === "email" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Send email
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ShareAction({
  icon: Icon,
  label,
  busy,
  disabled = false,
  onClick,
}: {
  icon: typeof Copy;
  label: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" className="w-full justify-start" onClick={onClick} disabled={busy || disabled}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
}
