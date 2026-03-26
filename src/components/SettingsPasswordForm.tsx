import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldAlert, XCircle } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/validations";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SettingsPasswordFormProps {
  onSuccess?: () => void;
}

export function SettingsPasswordForm({ onSuccess }: SettingsPasswordFormProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<ChangePasswordInput>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ChangePasswordInput, string>>>({});
  const [authError, setAuthError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (!isSuccess || !onSuccess) return;

    const timeoutId = window.setTimeout(() => {
      onSuccess();
    }, 1600);

    return () => window.clearTimeout(timeoutId);
  }, [isSuccess, onSuccess]);

  const passwordRequirements = [
    { label: "At least 8 characters", met: formData.newPassword.length >= 8 },
    { label: "Contains uppercase letter", met: /[A-Z]/.test(formData.newPassword) },
    { label: "Contains lowercase letter", met: /[a-z]/.test(formData.newPassword) },
    { label: "Contains number", met: /[0-9]/.test(formData.newPassword) },
  ];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setErrors({});
    setAuthError("");
    setIsSuccess(false);

    try {
      const validated = changePasswordSchema.parse(formData);

      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user?.email;
      if (!email) {
        setAuthError("You must be signed in to update your password.");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: validated.currentPassword,
      });
      if (signInError) {
        setAuthError("Current password is incorrect.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: validated.newPassword,
      });
      if (updateError) {
        setAuthError(updateError.message || "Failed to update password.");
        return;
      }

      setFormData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setIsSuccess(true);
      toast({
        title: "Password updated",
        description: onSuccess
          ? "Your password has been changed successfully. Closing settings..."
          : "Your password has been changed successfully.",
      });
    } catch (error: any) {
      if (error.errors) {
        const fieldErrors: Partial<Record<keyof ChangePasswordInput, string>> = {};
        error.errors.forEach((item: any) => {
          if (item.path[0]) {
            fieldErrors[item.path[0] as keyof ChangePasswordInput] = item.message;
          }
        });
        setErrors(fieldErrors);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        Use this form to reset your password while signed in. You must enter your current password first for verification.
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Reset Password
          </CardTitle>
          <CardDescription>
            Update your password from inside the app settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSuccess ? (
            <Alert className="mb-4 border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                {onSuccess
                  ? "Password updated successfully. The settings panel will close automatically."
                  : "Password updated successfully."}
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
            <div className="space-y-2">
              <Label htmlFor="settings-current-password">Current Password</Label>
              <div className="relative">
                <Input
                  id="settings-current-password"
                  type={showCurrentPassword ? "text" : "password"}
                  value={formData.currentPassword}
                  onChange={(event) => setFormData({ ...formData, currentPassword: event.target.value })}
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                  disabled={isLoading}
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.currentPassword ? <p className="text-sm text-destructive">{errors.currentPassword}</p> : null}
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="settings-new-password">New Password</Label>
                <div className="relative">
                  <Input
                    id="settings-new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={formData.newPassword}
                    onChange={(event) => setFormData({ ...formData, newPassword: event.target.value })}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                    disabled={isLoading}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.newPassword ? <p className="text-sm text-destructive">{errors.newPassword}</p> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="settings-confirm-password">Confirm New Password</Label>
                <div className="relative">
                  <Input
                    id="settings-confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={formData.confirmPassword}
                    onChange={(event) => setFormData({ ...formData, confirmPassword: event.target.value })}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                    disabled={isLoading}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.confirmPassword ? <p className="text-sm text-destructive">{errors.confirmPassword}</p> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <ShieldAlert className="h-4 w-4" />
                Password requirements
              </div>
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

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={isLoading} className="sm:min-w-44">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isLoading ? "Updating..." : isSuccess ? "Password Updated" : "Reset Password"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isLoading}
                onClick={() => {
                  setErrors({});
                  setAuthError("");
                  setFormData({ currentPassword: "", newPassword: "", confirmPassword: "" });
                }}
              >
                Clear Form
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}