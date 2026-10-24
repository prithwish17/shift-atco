import { useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLiveAnnouncements } from "@/hooks/useAnnouncements";
import { ANNOUNCEMENT_BANNER_LIMIT, sortAnnouncements } from "@/lib/announcements";
import { AnnouncementCard } from "./AnnouncementCard";

/**
 * Live announcements at the top of the employee dashboard: urgent first, at
 * most three, the rest behind "View all".
 */
export function AnnouncementBanner() {
  const { data } = useLiveAnnouncements();
  const [showAll, setShowAll] = useState(false);

  const announcements = useMemo(() => sortAnnouncements(data ?? []), [data]);
  if (announcements.length === 0) return null;

  const visible = announcements.slice(0, ANNOUNCEMENT_BANNER_LIMIT);
  const hidden = announcements.length - visible.length;

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
        />
      ))}

      {hidden > 0 && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setShowAll(true)}>
            <Megaphone className="size-4" />
            View all {announcements.length} announcements
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
            {announcements.map((a) => (
              <AnnouncementCard
                key={a.id}
                id={a.id}
                title={a.title}
                body={a.body}
                priority={a.priority}
                expiresAt={a.expires_at}
                hasAttachment={Boolean(a.attachment_path)}
                attachmentMeta={a.attachment_meta}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
