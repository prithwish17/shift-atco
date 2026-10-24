import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveAnnouncements } from "@/hooks/useAnnouncements";
import { safeStorage } from "@/lib/safeStorage";
import { AnnouncementCard } from "./AnnouncementCard";

const hiddenKey = (userId: string) => `atcora:demo-card-hidden:${userId}`;

/**
 * The quick demo on the employee dashboard without anyone posting an
 * announcement. Each person hides it with the ×; the choice is kept in this
 * browser, and the sidebar's "Quick demo" still plays the video afterwards.
 * Left out while a live announcement already carries the demo video, so the
 * dashboard never shows it twice.
 */
export function DemoWelcomeCard() {
  const { user } = useAuth();
  const { data: announcements } = useLiveAnnouncements();
  const [hiddenNow, setHiddenNow] = useState(false);

  if (!user || hiddenNow || safeStorage.getItem(hiddenKey(user.id)) === "1") return null;
  if (announcements?.some((a) => a.demo_video)) return null;

  const handleHide = () => {
    safeStorage.setItem(hiddenKey(user.id), "1");
    setHiddenNow(true);
    toast("Demo hidden", { description: "Watch it any time from Quick demo in the menu." });
  };

  return (
    <AnnouncementCard
      title="Watch the quick demo"
      body="A 47-second tour of Atcora: your duty, roster, leave and licenses."
      priority="info"
      demoVideo
      onHide={handleHide}
    />
  );
}
