import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Announcement, AnnouncementAttachmentMeta, AnnouncementPriority } from "@/lib/announcements";

// announcements is not in the generated types yet, so it goes through an
// untyped view of the client. See supabase/migrations/20261023120000_announcements.sql.
const db = supabase as unknown as SupabaseClient;

const ANNOUNCEMENTS_KEY = ["announcements"];
const LIVE_KEY = [...ANNOUNCEMENTS_KEY, "live"];
const ALL_KEY = [...ANNOUNCEMENTS_KEY, "all"];

const COLUMNS =
  "id,title,body,priority,starts_at,expires_at,ended_at,attachment_path,attachment_meta,created_by,updated_by,created_at,updated_at";

/** Live announcements for the employee dashboard. */
export function useLiveAnnouncements() {
  return useQuery({
    queryKey: LIVE_KEY,
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await db
        .from("announcements")
        .select(COLUMNS)
        .is("ended_at", null)
        .lte("starts_at", now)
        .gt("expires_at", now)
        .order("starts_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Announcement[];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export interface ManagedAnnouncement extends Announcement {
  author: { full_name: string | null } | null;
}

/** Every announcement, newest first, for /announcements. Supervisors and admins only. */
export function useAllAnnouncements() {
  return useQuery({
    queryKey: ALL_KEY,
    queryFn: async () => {
      const { data, error } = await db
        .from("announcements")
        .select(COLUMNS)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Announcement[];

      const authorIds = [...new Set(rows.map((r) => r.created_by).filter((id): id is string => Boolean(id)))];
      const names = new Map<string, string | null>();
      if (authorIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", authorIds);
        for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
          names.set(p.id, p.full_name);
        }
      }

      return rows.map((r) => ({
        ...r,
        author: r.created_by ? { full_name: names.get(r.created_by) ?? null } : null,
      })) as ManagedAnnouncement[];
    },
    staleTime: 30_000,
  });
}

export interface AnnouncementInput {
  title: string;
  body: string;
  priority: AnnouncementPriority;
  starts_at: string;
  expires_at: string;
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ANNOUNCEMENTS_KEY });
}

export function useCreateAnnouncement() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: AnnouncementInput & { created_by: string }) => {
      const { data, error } = await db
        .from("announcements")
        .insert({ ...input, title: input.title.trim(), body: input.body.trim() })
        .select("id")
        .single();
      if (error) throw error;
      return (data as unknown as { id: string }).id;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateAnnouncement() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, ...input }: AnnouncementInput & { id: string }) => {
      const { error } = await db
        .from("announcements")
        .update({ ...input, title: input.title.trim(), body: input.body.trim() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useEndAnnouncement() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("announcements")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteAnnouncement() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, removeAttachment }: { id: string; removeAttachment: boolean }) => {
      // Admins remove the file straight away. Otherwise the daily storage
      // reconcile deletes it once no announcement points at it.
      if (removeAttachment) await deleteAnnouncementAttachment(id);
      const { error } = await db.from("announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useInvalidateAnnouncements() {
  return useInvalidate();
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

export async function deleteAnnouncementAttachment(id: string): Promise<void> {
  const resp = await fetch(`/api/storage/announcement-attachment?announcement_id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (!resp.ok && resp.status !== 404) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Failed to remove the attachment (${resp.status})`);
  }
}

/** Open the attachment in a new tab through a five-minute signed URL. */
export async function openAnnouncementAttachment(id: string): Promise<void> {
  // Open the tab synchronously so pop-up blockers allow it, then point it at the file.
  const tab = window.open("", "_blank");
  try {
    const resp = await fetch(
      `/api/storage/announcement-attachment-url?announcement_id=${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${await accessToken()}` } },
    );
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.url) throw new Error(body.error || `Failed to open the attachment (${resp.status})`);
    if (tab) {
      tab.opener = null;
      tab.location.href = body.url;
    } else {
      window.open(body.url, "_blank", "noopener,noreferrer");
    }
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** The attachment as a File, ready for the Web Share API or a download. */
export async function fetchAnnouncementAttachmentFile(
  id: string,
  meta?: AnnouncementAttachmentMeta | null,
): Promise<File> {
  const resp = await fetch(
    `/api/storage/announcement-attachment-file?announcement_id=${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${await accessToken()}` } },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load the attachment (${resp.status})`);
  }
  const blob = await resp.blob();
  const type = meta?.mime || blob.type || "application/octet-stream";
  return new File([blob], attachmentFilename(meta, type), { type });
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Share targets such as WhatsApp pick the file kind from the extension.
function attachmentFilename(meta: AnnouncementAttachmentMeta | null | undefined, type: string): string {
  const name = meta?.original_name?.trim();
  const ext = EXTENSIONS[type];
  if (name) return !ext || /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${ext}`;
  return `attachment.${ext ?? "bin"}`;
}
