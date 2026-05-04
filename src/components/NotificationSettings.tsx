import { useState } from "react";
import {
  useNotificationPreferences,
  useUpdateNotificationPreference,
  getEventTypeLabel,
  type NotificationPreference,
} from "@/hooks/useNotificationPreferences";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Bell, Mail, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function NotificationSettings() {
  const { data: preferences, isLoading } = useNotificationPreferences();
  const updatePref = useUpdateNotificationPreference();
  const { toast } = useToast();
  const [updating, setUpdating] = useState<string | null>(null);

  const handleToggle = async (
    pref: NotificationPreference,
    channel: "email" | "push" | "in_app",
    value: boolean
  ) => {
    const key = `${pref.event_type}-${channel}`;
    setUpdating(key);
    try {
      await updatePref.mutateAsync({
        ...pref,
        [channel]: value,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to update preference",
        variant: "destructive",
      });
    } finally {
      setUpdating(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notification Settings
        </CardTitle>
        <CardDescription>
          Choose how you want to be notified for each event type.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {/* Header Row */}
          <div className="grid grid-cols-[1fr_64px_64px_64px] gap-2 pb-2 border-b text-xs font-medium text-muted-foreground">
            <div>Event</div>
            <div className="text-center">
              <Mail className="h-3.5 w-3.5 mx-auto" />
              <span>Email</span>
            </div>
            <div className="text-center">
              <Smartphone className="h-3.5 w-3.5 mx-auto" />
              <span>Push</span>
            </div>
            <div className="text-center">
              <Bell className="h-3.5 w-3.5 mx-auto" />
              <span>In-App</span>
            </div>
          </div>

          {/* Preference Rows */}
          {(preferences || []).map((pref) => (
            <div
              key={pref.event_type}
              className="grid grid-cols-[1fr_64px_64px_64px] gap-2 items-center py-2.5 border-b last:border-0"
            >
              <span className="text-sm font-medium">
                {getEventTypeLabel(pref.event_type)}
              </span>
              {(["email", "push", "in_app"] as const).map((channel) => (
                <div key={channel} className="flex justify-center">
                  <Switch
                    checked={pref[channel]}
                    disabled={updating === `${pref.event_type}-${channel}`}
                    onCheckedChange={(val) => handleToggle(pref, channel, val)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
