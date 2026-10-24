import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarClock, Loader2, Megaphone, Pencil, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { AnnouncementForm } from "@/components/announcements/AnnouncementForm";
import { StorageUsageCard } from "@/components/storage/StorageUsageCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAllAnnouncements,
  useDeleteAnnouncement,
  useEndAnnouncement,
  type ManagedAnnouncement,
} from "@/hooks/useAnnouncements";
import { useInvalidateStorageStatus } from "@/hooks/useStorageStatus";
import { announcementState, sortAnnouncements, type AnnouncementState } from "@/lib/announcements";

const TAB_LABELS: Record<AnnouncementState, string> = {
  live: "Live",
  scheduled: "Scheduled",
  ended: "Ended",
};

export default function Announcements() {
  const { user, userRole } = useAuth();
  const isAdmin = userRole === "admin";
  const dashboardRole = isAdmin ? "admin" : "supervisor";

  const { data, isLoading, isError } = useAllAnnouncements();
  const endAnnouncement = useEndAnnouncement();
  const deleteAnnouncement = useDeleteAnnouncement();
  const invalidateStorageStatus = useInvalidateStorageStatus();

  const [editing, setEditing] = useState<ManagedAnnouncement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManagedAnnouncement | null>(null);

  const grouped = useMemo(() => {
    const groups: Record<AnnouncementState, ManagedAnnouncement[]> = { live: [], scheduled: [], ended: [] };
    for (const a of data ?? []) groups[announcementState(a)].push(a);
    groups.live = sortAnnouncements(groups.live);
    groups.scheduled.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    return groups;
  }, [data]);

  // Admins manage every announcement; supervisors only their own.
  const canManage = (a: ManagedAnnouncement) => isAdmin || a.created_by === user?.id;

  const handleEnd = async (a: ManagedAnnouncement) => {
    try {
      await endAnnouncement.mutateAsync(a.id);
      toast.success("Announcement ended. It no longer shows on the dashboard.");
    } catch (err) {
      toast.error((err as Error).message || "Could not end the announcement");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteAnnouncement.mutateAsync({
        id: confirmDelete.id,
        removeAttachment: isAdmin && Boolean(confirmDelete.attachment_path),
      });
      if (confirmDelete.attachment_path) invalidateStorageStatus();
      if (editing?.id === confirmDelete.id) setEditing(null);
      toast.success("Announcement deleted");
    } catch (err) {
      toast.error((err as Error).message || "Could not delete the announcement");
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <DashboardLayout role={dashboardRole}>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Megaphone className="h-8 w-8" />
            Announcements
          </h1>
          <p className="text-muted-foreground">
            Post short notices at the top of the employee dashboard. They disappear on their own when they expire.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{editing ? "Edit announcement" : "New announcement"}</CardTitle>
            <CardDescription>
              Up to 100 characters for the title and 500 for the text. Runs for 1 to 30 days.
              {isAdmin ? " Admins can attach one file." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {user && (
              <AnnouncementForm
                key={editing?.id ?? "new"}
                userId={user.id}
                isAdmin={isAdmin}
                editing={editing}
                onDone={() => setEditing(null)}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">All announcements</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {isError && <p className="text-sm text-destructive">Could not load announcements.</p>}
            {data && (
              <Tabs defaultValue="live">
                <TabsList>
                  {(Object.keys(TAB_LABELS) as AnnouncementState[]).map((state) => (
                    <TabsTrigger key={state} value={state}>
                      {TAB_LABELS[state]} ({grouped[state].length})
                    </TabsTrigger>
                  ))}
                </TabsList>
                {(Object.keys(TAB_LABELS) as AnnouncementState[]).map((state) => (
                  <TabsContent key={state} value={state} className="space-y-3">
                    {grouped[state].length === 0 && (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No {TAB_LABELS[state].toLowerCase()} announcements.
                      </p>
                    )}
                    {grouped[state].map((a) => (
                      <div key={a.id} className="space-y-2 rounded-xl border p-3">
                        <AnnouncementCard
                          id={a.id}
                          title={a.title}
                          body={a.body}
                          priority={a.priority}
                          expiresAt={a.expires_at}
                          hasAttachment={Boolean(a.attachment_path)}
                          attachmentMeta={a.attachment_meta}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CalendarClock className="size-3.5" />
                            {format(new Date(a.starts_at), "d MMM, HH:mm")} to{" "}
                            {format(new Date(a.ended_at ?? a.expires_at), "d MMM yyyy, HH:mm")}
                            {a.ended_at ? " (ended early)" : ""}
                            {a.author?.full_name ? ` · by ${a.author.full_name}` : ""}
                          </p>
                          {canManage(a) && (
                            <div className="flex gap-1">
                              {state !== "ended" && (
                                <>
                                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEditing(a)}>
                                    <Pencil className="size-3.5" />
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="gap-1.5"
                                    onClick={() => handleEnd(a)}
                                    disabled={endAnnouncement.isPending}
                                  >
                                    <Square className="size-3.5" />
                                    End now
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-1.5 text-destructive"
                                onClick={() => setConfirmDelete(a)}
                              >
                                <Trash2 className="size-3.5" />
                                Delete
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </CardContent>
        </Card>

        {isAdmin && <StorageUsageCard />}
      </div>

      <AlertDialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed for good, along with any attached file. To keep it as history, use End now instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteAnnouncement.isPending}>
              {deleteAnnouncement.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
