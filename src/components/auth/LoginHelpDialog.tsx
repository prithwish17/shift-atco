import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AtSign, KeyRound, MessageCircle } from "lucide-react";

/**
 * LoginHelpDialog — the two things people get wrong on first sign-in.
 *
 * Almost every "I can't log in" report is one of two mistakes: signing in with
 * a personal address instead of the one the office holds, or not knowing the
 * account was created with a default password.  Both are answered here, with
 * WhatsApp as the way out when neither fits.
 *
 * That WhatsApp line doubles as the feedback channel — the sign-in screen is the
 * one page every user reaches, so it is the cheapest place to ask for it.
 */

/** The number as dialled from India; `wa.me` needs the country code, the label does not. */
const SUPPORT_WHATSAPP = "9064262945";
// Deliberately neutral: the same button carries sign-in trouble and feedback,
// so the draft must not put words in the mouth of someone sending a suggestion.
const SUPPORT_WHATSAPP_LINK = `https://wa.me/91${SUPPORT_WHATSAPP}?text=${encodeURIComponent(
  "Hi! I'm messaging about ATCORA.",
)}`;

export default function LoginHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* crisp-borders: the two panels below are separated by nothing but a
          1px rule, which the dark theme's border token cannot carry (index.css). */}
      <DialogContent className="crisp-borders max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Trouble signing in?</DialogTitle>
          <DialogDescription>
            Your account was created for you — these are the credentials it was created with.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <AtSign className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <p className="text-sm font-semibold">Email</p>
            </div>
            <p className="pt-1 text-sm text-muted-foreground">
              The Gmail address you gave the office — the same one your{" "}
              <span className="font-medium text-foreground">BA test</span> mail arrives on. A
              personal address the office does not hold will not work.
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <p className="text-sm font-semibold">Password</p>
            </div>
            <p className="pt-1 text-sm text-muted-foreground">
              Unless you have changed it, it is:
            </p>
            <p className="mt-1.5 rounded-md bg-muted px-2 py-1.5 font-mono text-sm font-semibold">
              ShiftPlan@&lt;employee ID&gt;
            </p>
            <p className="pt-1.5 text-xs text-muted-foreground">
              Your own employee ID in place of the brackets — for employee ID 12345 that is{" "}
              <span className="font-mono">ShiftPlan@12345</span>.
            </p>
            {/* Said here rather than left for people to find: this is the moment
                they are looking at a password someone else chose for them. */}
            <p className="pt-2 text-xs text-muted-foreground">
              Once you are in, you can change it to whatever you like — it is in{" "}
              <span className="font-medium text-foreground">Settings</span>, under{" "}
              <span className="font-medium text-foreground">Password and Access Recovery</span>.
            </p>
          </div>
        </div>

        {/* `flex-col` is not redundant: DialogFooter stacks col-REVERSE below sm,
            which put the button above the sentence explaining it on a phone. */}
        <DialogFooter className="flex-col sm:flex-col sm:items-stretch sm:space-x-0">
          <div className="space-y-1.5 pb-2 text-center text-xs text-muted-foreground">
            <p>Still cannot get in? Message us on WhatsApp and we will sort it out.</p>
            {/* The same number, so the one channel people already have to save
                is also the one that carries ideas back to us. */}
            <p>
              Got an idea that would make ATCORA nicer to use? Send it to the same number —
              we read every message.
            </p>
          </div>
          <Button asChild className="w-full">
            <a href={SUPPORT_WHATSAPP_LINK} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
              WhatsApp {SUPPORT_WHATSAPP}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
