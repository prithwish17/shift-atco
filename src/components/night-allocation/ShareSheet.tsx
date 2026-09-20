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
  buildRosterText,
  defaultEmailSubject,
  formatNightDate,
  type NightAllocationState,
} from "@/domain/night-allocation";
import { emailNightAllocation, fetchRosterText } from "@/data-access/night-allocation.api";
import { blobToBase64, buildBoardImage, buildRosterPdf, downloadBlob } from "./exports";

interface ShareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: NightAllocationState;
  /** Teams on the shift roster, for the sub-header on every format. */
  teams: string[];
  /** True while the night still breaks a hard rule. */
  blocked: boolean;
  blockingCount: number;
  /** False until the night has been saved at least once. */
  saved: boolean;
}

type Busy = null | "text" | "whatsapp" | "pdf" | "png" | "email";

/** Hoisted: a literal here would be a new identity on every render. */
const NO_EMAILS: string[] = [];

export function ShareSheet({ open, onOpenChange, state, teams, blocked, blockingCount, saved }: ShareSheetProps) {
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
        await navigator.share({ title: `Night channel allocation — ${formatNightDate(state.nightDate)}`, text, files: [file] });
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

      const attachments: Array<{ filename: string; content: string }> = [];
      if (attachPdf) {
        const pdf = buildRosterPdf(state, teams);
        attachments.push({ filename: pdf.filename, content: await blobToBase64(pdf.blob) });
      }
      if (attachImage) {
        const image = await buildBoardImage(state, teams);
        attachments.push({ filename: image.filename, content: await blobToBase64(image.blob) });
      }

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

        {blocked ? (
          <p className="mt-6 rounded-lg border border-status-danger/25 bg-status-danger-soft/60 px-3 py-2.5 text-[0.82rem] leading-snug text-corp-text-main">
            {blockingCount} {blockingCount === 1 ? "problem" : "problems"} still to fix in Checks. Sharing a roster with
            an uncovered position would send the shift the wrong plan.
          </p>
        ) : (
          <div className="mt-6 space-y-2">
            {!saved ? (
              <p className="rounded-lg border border-status-warning/30 bg-status-warning-soft px-3 py-2.5 text-[0.82rem] leading-snug text-corp-text-main">
                This night hasn't been saved yet, so you'd be sharing your own unsaved copy. Save first if the shift
                should see the same thing.
              </p>
            ) : null}

            <ShareAction icon={Copy} label="Copy text" busy={busy === "text"} onClick={copyText} />
            <ShareAction icon={MessageCircle} label="WhatsApp" busy={busy === "whatsapp"} onClick={shareToWhatsApp} />
            <ShareAction icon={Mail} label="Email" busy={false} onClick={() => setShowEmail(value => !value)} />
            <ShareAction icon={FileText} label="Download PDF" busy={busy === "pdf"} onClick={downloadPdf} />
            <ShareAction icon={ImageIcon} label="Download image" busy={busy === "png"} onClick={downloadImage} />

            {showEmail ? (
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
                      Prefilled with the people on duty tonight who have an address on file.
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
  onClick,
}: {
  icon: typeof Copy;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" className="w-full justify-start" onClick={onClick} disabled={busy}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
}
