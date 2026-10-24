import { useMemo, useState } from "react";
import { EyeOff, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import {
  useLiveAnnouncements,
  useMyAnnouncementDismissals,
  useSetAnnouncementHidden,
} from "@/hooks/useAnnouncements";
import { ANNOUNCEMENT_BANNER_LIMIT, isAnnouncementHidden, sortAnnouncements } from "@/lib/announcements";
import { AnnouncementCard } from "./AnnouncementCard";

/**
 * Live announcements at the top of the employee dashboard: urgent first, at
 * most three, the rest behind "View all". Each has a × to hide it after
 * reading; hidden ones stay listed under "View all" with "Show again", and
 * come back on their own if the announcement is edited.
 */
export function AnnouncementBanner() {
  const { user } = useAuth();
  const { data } = useLiveAnnouncements();
  const { data: dismissals } = useMyAnnouncementDismissals(user?.id);
  const setHidden = useSetAnnouncementHidden(user?.id);
  const [showAll, setShowAll] = useState(false);

  const announcements = useMemo(() => sortAnnouncements(data ?? []), [data]);
  const isHidden = (a: { id: string; updated_at: string }) => isAnnouncementHidden(a, dismissals?.get(a.id));
  const shown = announcements.filter((a) => !isHidden(a));
  const hiddenCount = announcements.length - shown.length;

  if (announcements.length === 0) return null;

  const visible = shown.slice(0, ANNOUNCEMENT_BANNER_LIMIT);
  const more = shown.length - visible.length;

  const hide = (id: string, title: string) => {
    setHidden.mutate(
      { id, hidden: true },
      {
        onSuccess: () =>
          toast("Announcement hidden", {
            description: title,
            action: { label: "Undo", onClick: () => setHidden.mutate({ id, hidden: false }) },
          }),
        onError: () => toast.error("Could not hide the announcement. Please try again."),
      },
    );
  };

  const showAgain = (id: string) => {
    setHidden.mutate({ id, hidden: false }, { onError: () => toast.error("Could not show the announcement again.") });
  };

  return (
    <section aria-label="Announcements" className="space-y-2">
      {visible.map((a) => (
        <AnnouncementCard
          key={a.id}
          id={a.id}
          title={a.title}
          body={a.body}
          priority={a.priority}
          expiresAt={a.expires_at}
          hasAttachment={Boolean(a.attachment_path)}
          attachmentMeta={a.attachment_meta}
          demoVideo={a.demo_video}
          onHide={user ? () => hide(a.id, a.title) : undefined}
        />
      ))}

      {(more > 0 || hiddenCount > 0) && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setShowAll(true)}>
            {more > 0 ? <Megaphone className="size-4" /> : <EyeOff className="size-4" />}
            {more > 0
              ? `View all ${announcements.length} announcements`
              : `${hiddenCount} hidden announcement${hiddenCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}

      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Announcements</DialogTitle>
            <DialogDescription>Everything currently posted, most urgent first.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            {announcements.map((a) => {
              const hidden = isHidden(a);
              return (
                <AnnouncementCard
                  key={a.id}
                  id={a.id}
                  title={a.title}
                  body={a.body}
                  priority={a.priority}
                  expiresAt={a.expires_at}
                  hasAttachment={Boolean(a.attachment_path)}
                  attachmentMeta={a.attachment_meta}
                  demoVideo={a.demo_video}
                  onHide={user && !hidden ? () => hide(a.id, a.title) : undefined}
                  onShowAgain={hidden ? () => showAgain(a.id) : undefined}
                />
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
