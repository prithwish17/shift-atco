import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, UserRound, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_BODY_MIN,
  FEEDBACK_KIND_LABELS,
  FeedbackKind,
  useSubmitFeedback,
} from "@/hooks/useFeedback";

const KIND_HINTS: Record<FeedbackKind, string> = {
  error: "Something on this page is wrong or broken.",
  suggestion: "An idea to make the app better.",
  grievance: "A concern you want the admins to look into.",
};

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const { user } = useAuth();
  const location = useLocation();
  const submit = useSubmitFeedback();

  const [kind, setKind] = useState<FeedbackKind>("error");
  const [body, setBody] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [touched, setTouched] = useState(false);

  // Start fresh each time the box opens.
  useEffect(() => {
    if (open) {
      setKind("error");
      setBody("");
      setIsAnonymous(false);
      setTouched(false);
    }
  }, [open]);

  const length = body.trim().length;
  const tooShort = length < FEEDBACK_BODY_MIN;
  const tooLong = length > FEEDBACK_BODY_MAX;
  const invalid = tooShort || tooLong;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid || !user) return;

    try {
      await submit.mutateAsync({
        kind,
        body,
        isAnonymous,
        userId: user.id,
        pagePath: location.pathname + location.search,
        pageTitle: document.title,
      });
      toast.success("Thank you", {
        description: isAnonymous
          ? "Your message was sent without your name."
          : "Your message was sent to the admins.",
      });
      onOpenChange(false);
    } catch (error) {
      toast.error("Could not send", {
        description: (error instanceof Error && error.message) || "Please try again in a moment.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Report an error or share a suggestion</DialogTitle>
            <DialogDescription>
              Admins will see which page you were on: <span className="font-mono text-xs">{location.pathname}</span>
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={kind}
            onValueChange={(value) => setKind(value as FeedbackKind)}
            className="grid gap-2 sm:grid-cols-3"
          >
            {(Object.keys(FEEDBACK_KIND_LABELS) as FeedbackKind[]).map((value) => (
              <Label
                key={value}
                htmlFor={`feedback-kind-${value}`}
                className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm font-medium has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem id={`feedback-kind-${value}`} value={value} />
                {FEEDBACK_KIND_LABELS[value]}
              </Label>
            ))}
          </RadioGroup>

          <div className="space-y-2">
            <Label htmlFor="feedback-body">{KIND_HINTS[kind]}</Label>
            <Textarea
              id="feedback-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onBlur={() => setTouched(body.trim().length > 0)}
              rows={5}
              maxLength={FEEDBACK_BODY_MAX}
              placeholder={
                kind === "error"
                  ? "What did you expect, and what happened instead?"
                  : "Tell us in your own words."
              }
              aria-invalid={touched && invalid}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className={touched && tooShort ? "text-destructive" : undefined}>
                {touched && tooShort ? `Please write at least ${FEEDBACK_BODY_MIN} characters.` : " "}
              </span>
              <span>
                {length}/{FEEDBACK_BODY_MAX}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Send as</Label>
            <RadioGroup
              value={isAnonymous ? "anonymous" : "named"}
              onValueChange={(value) => setIsAnonymous(value === "anonymous")}
              className="grid grid-cols-2 gap-2"
            >
              <Label
                htmlFor="feedback-send-named"
                className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm font-medium has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem id="feedback-send-named" value="named" />
                <UserRound className="size-4" />
                With my name
              </Label>
              <Label
                htmlFor="feedback-send-anonymous"
                className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm font-medium has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem id="feedback-send-anonymous" value="anonymous" />
                <UserX className="size-4" />
                Anonymous
              </Label>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              {isAnonymous
                ? "Your name won't be stored with this message. Admins won't see who sent it, and you won't be able to follow its status."
                : "Admins will see your name and can follow up with you."}
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submit.isPending || (touched && invalid)}>
              {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isAnonymous ? "Send anonymously" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
