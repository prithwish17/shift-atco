import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";

export default function SetupAdmin() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const { toast } = useToast();

  const handleSetupAdmin = async () => {
    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('setup-admin');

      if (error) throw error;

      setResult({
        success: data.success,
        message: data.message || 'Admin account setup completed'
      });

      toast({
        title: data.success ? "Success" : "Error",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });

    } catch (error: any) {
      setResult({
        success: false,
        message: error.message || 'Failed to setup admin account'
      });

      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Admin Account Setup</CardTitle>
          <CardDescription>
            Set up the permanent admin account for ShiftAtco
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm">
              <p className="font-medium">Admin Credentials:</p>
              <p className="text-muted-foreground">Email: creatorshiftplan@gmail.com</p>
              <p className="text-muted-foreground">Password: Mastermind@17</p>
            </div>
          </div>

          <Button
            onClick={handleSetupAdmin}
            disabled={loading}
            className="w-full"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? "Setting up..." : "Create Admin Account"}
          </Button>

          {result && (
            <div className={`p-4 rounded-lg border ${result.success
                ? 'bg-accent/10 border-accent text-accent-foreground'
                : 'bg-destructive/10 border-destructive text-destructive-foreground'
              }`}>
              <div className="flex items-start gap-2">
                {result.success ? (
                  <CheckCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <p className="font-medium">
                    {result.success ? "Success!" : "Error"}
                  </p>
                  <p className="text-sm mt-1">{result.message}</p>
                </div>
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            <p>Note: This should only be run once. If the admin account already exists, you'll see a message indicating that.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
