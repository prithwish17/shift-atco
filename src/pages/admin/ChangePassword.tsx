import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, CheckCircle2, AlertCircle, Mail, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function ChangePassword() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string>("");
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setAuthError("");
    setIsSuccess(false);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user?.email;
      if (!email) {
        setAuthError("You must be logged in to request a password reset.");
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
        description: "Open the secure link in your email to finish changing the password.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DashboardLayout role="admin">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Change Password</h1>
          <p className="text-muted-foreground">Update your account password</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Password Change Confirmation
            </CardTitle>
            <CardDescription>
              Send a secure password reset link to your authenticated email address.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSuccess && (
              <Alert className="mb-4 border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>Confirmation email sent. Check your inbox and open the secure link to continue.</AlertDescription>
              </Alert>
            )}

            {authError && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{authError}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    How this works
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    <li className="text-sm text-muted-foreground">1. Send the reset link to your authenticated email.</li>
                    <li className="text-sm text-muted-foreground">2. Open the link from the email.</li>
                    <li className="text-sm text-muted-foreground">3. Set the new password on the reset page.</li>
                  </ul>
                </CardContent>
              </Card>

              <div className="flex gap-4">
                <Button type="submit" className="flex-1" disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isLoading ? "Sending..." : isSuccess ? "Email Sent" : "Send Confirmation Email"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
