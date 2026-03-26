import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Moon, Sun, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/integrations/supabase/client";
import { resetPasswordUpdateSchema, type ResetPasswordUpdateInput } from "@/lib/validations";
import { useToast } from "@/hooks/use-toast";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const [isReady, setIsReady] = useState(false);
  const [isCheckingLink, setIsCheckingLink] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof ResetPasswordUpdateInput, string>>>({});
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState<ResetPasswordUpdateInput>({
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    let isMounted = true;

    const initialiseRecovery = async () => {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const recoveryType = hashParams.get("type");

      if (recoveryType === "recovery" && accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          if (isMounted) {
            setAuthError("This password reset link is invalid or has expired.");
            setIsCheckingLink(false);
          }
          return;
        }

        window.history.replaceState({}, document.title, "/reset-password");
        if (isMounted) {
          setIsReady(true);
          setIsCheckingLink(false);
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (isMounted) {
        if (data.session) {
          setIsReady(true);
        } else {
          setAuthError("Open the password reset link from your email to continue.");
        }
        setIsCheckingLink(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (event === "PASSWORD_RECOVERY" || (session && !isReady)) {
        setIsReady(true);
        setIsCheckingLink(false);
        setAuthError("");
      }
    });

    initialiseRecovery();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [isReady]);

  const passwordRequirements = [
    { label: "At least 8 characters", met: formData.newPassword.length >= 8 },
    { label: "Contains uppercase letter", met: /[A-Z]/.test(formData.newPassword) },
    { label: "Contains lowercase letter", met: /[a-z]/.test(formData.newPassword) },
    { label: "Contains number", met: /[0-9]/.test(formData.newPassword) },
  ];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrors({});
    setAuthError("");

    try {
      const validated = resetPasswordUpdateSchema.parse(formData);
      const { error } = await supabase.auth.updateUser({ password: validated.newPassword });

      if (error) {
        setAuthError(error.message || "Failed to update password.");
        return;
      }

      await supabase.auth.signOut();
      toast({
        title: "Password updated",
        description: "Your password has been changed. Sign in with the new password.",
      });
      navigate("/login");
    } catch (error: any) {
      if (error.errors) {
        const fieldErrors: Partial<Record<keyof ResetPasswordUpdateInput, string>> = {};
        error.errors.forEach((item: any) => {
          if (item.path[0]) {
            fieldErrors[item.path[0] as keyof ResetPasswordUpdateInput] = item.message;
          }
        });
        setErrors(fieldErrors);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center space-y-2">
          <div className="flex items-center justify-between w-full">
            <Link to="/login">
              <Button variant="ghost" size="icon" className="rounded-full">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-3xl font-bold tracking-[0.2em] text-primary">ATCORA</h1>
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full">
              {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Set New Password
            </CardTitle>
            <CardDescription>
              Use the secure email link to confirm the reset, then choose a new password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isCheckingLink ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying reset link...
              </div>
            ) : authError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{authError}</AlertDescription>
              </Alert>
            ) : null}

            {isReady ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="reset-new-password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="reset-new-password"
                      type={showNewPassword ? "text" : "password"}
                      value={formData.newPassword}
                      onChange={(event) => setFormData({ ...formData, newPassword: event.target.value })}
                      disabled={isSubmitting}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                      disabled={isSubmitting}
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.newPassword ? <p className="text-sm text-destructive">{errors.newPassword}</p> : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reset-confirm-password">Confirm New Password</Label>
                  <div className="relative">
                    <Input
                      id="reset-confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      value={formData.confirmPassword}
                      onChange={(event) => setFormData({ ...formData, confirmPassword: event.target.value })}
                      disabled={isSubmitting}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                      disabled={isSubmitting}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.confirmPassword ? <p className="text-sm text-destructive">{errors.confirmPassword}</p> : null}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Password requirements</div>
                  <ul className="space-y-2">
                    {passwordRequirements.map((requirement) => (
                      <li key={requirement.label} className="flex items-center gap-2 text-sm">
                        {requirement.met ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-slate-400" />
                        )}
                        <span className={requirement.met ? "text-emerald-600" : "text-slate-500 dark:text-slate-400"}>
                          {requirement.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isSubmitting ? "Updating..." : "Update Password"}
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}