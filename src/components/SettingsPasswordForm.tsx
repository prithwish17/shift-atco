import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Mail } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SettingsPasswordFormProps {
  onSuccess?: () => void;
}

export function SettingsPasswordForm({ onSuccess }: SettingsPasswordFormProps) {
  const { toast } = useToast();
  const [authError, setAuthError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (!isSuccess || !onSuccess) return;

    const timeoutId = window.setTimeout(() => {
      onSuccess();
    }, 1600);

    return () => window.clearTimeout(timeoutId);
  }, [isSuccess, onSuccess]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setAuthError("");
    setIsSuccess(false);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user?.email;
      if (!email) {
        setAuthError("You must be signed in to request a password reset.");
        return;
      }

      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        setAuthError(error.message || "Failed to send confirmation email.");
        return;
      }

      setIsSuccess(true);
      toast({
        title: "Confirmation email sent",
        description: onSuccess
          ? "Open the link in your email to finish changing the password. Closing settings..."
          : "Open the link in your email to finish changing the password.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        Send a password reset confirmation email to your authenticated email address. Open the link from that mail to set the new password securely.
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Password Change Confirmation
          </CardTitle>
          <CardDescription>
            We will send a secure link to your signed-in email address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSuccess ? (
            <Alert className="mb-4 border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                {onSuccess
                  ? "Confirmation email sent. The settings panel will close automatically."
                  : "Confirmation email sent. Check your email to continue."}
              </AlertDescription>
            </Alert>
          ) : null}

          {authError ? (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Mail className="h-4 w-4" />
                How this works
              </div>
              <ul className="space-y-2">
                <li className="text-sm text-slate-500 dark:text-slate-400">1. Send the confirmation email to your authenticated address.</li>
                <li className="text-sm text-slate-500 dark:text-slate-400">2. Open the secure link from the email.</li>
                <li className="text-sm text-slate-500 dark:text-slate-400">3. Choose the new password on the reset page.</li>
              </ul>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={isLoading} className="sm:min-w-52">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isLoading ? "Sending..." : isSuccess ? "Email Sent" : "Send Confirmation Email"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}