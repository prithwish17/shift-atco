import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// feedback_items is not in the generated types yet, hence the casts.
// See supabase/migrations/20261017200000_feedback_items.sql.

declare const __APP_VERSION__: string;

export type FeedbackKind = "error" | "suggestion" | "grievance";
export type FeedbackStatus = "open" | "in_review" | "resolved" | "dismissed";

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  body: string;
  page_path: string | null;
  page_title: string | null;
  app_version: string | null;
  user_agent: string | null;
  is_anonymous: boolean;
  submitted_by: string | null;
  status: FeedbackStatus;
  admin_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackInboxRow extends FeedbackItem {
  submitter: { full_name: string | null; email: string | null } | null;
}

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  error: "Error",
  suggestion: "Suggestion",
  grievance: "Grievance",
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "Open",
  in_review: "In review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const FEEDBACK_BODY_MIN = 5;
export const FEEDBACK_BODY_MAX = 4000;
export const FEEDBACK_INBOX_PAGE_SIZE = 25;

const INBOX_KEY = ["feedback-inbox"];

interface SubmitFeedbackInput {
  kind: FeedbackKind;
  body: string;
  isAnonymous: boolean;
  userId: string;
  pagePath: string;
  pageTitle: string;
}

export function useSubmitFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SubmitFeedbackInput) => {
      // No .select() after the insert: an anonymous row has no submitter, so
      // the sender cannot read it back and RETURNING would fail under RLS.
      const { error } = await supabase.from("feedback_items" as any).insert({
        kind: input.kind,
        body: input.body.trim(),
        is_anonymous: input.isAnonymous,
        submitted_by: input.isAnonymous ? null : input.userId,
        page_path: input.pagePath.slice(0, 500),
        page_title: input.pageTitle.slice(0, 300) || null,
        app_version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null,
        user_agent: navigator.userAgent.slice(0, 500),
      } as any);

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INBOX_KEY });
    },
  });
}

interface InboxFilters {
  status: FeedbackStatus | "all";
  kind: FeedbackKind | "all";
  page: number;
}

export function useFeedbackInbox({ status, kind, page }: InboxFilters) {
  return useQuery({
    queryKey: [...INBOX_KEY, status, kind, page],
    queryFn: async () => {
      const from = page * FEEDBACK_INBOX_PAGE_SIZE;
      let query = supabase
        .from("feedback_items" as any)
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, from + FEEDBACK_INBOX_PAGE_SIZE - 1);

      if (status !== "all") query = query.eq("status", status);
      if (kind !== "all") query = query.eq("kind", kind);

      const { data, error, count } = await query;
      if (error) {
        throw error;
      }

      const items = (data ?? []) as unknown as FeedbackItem[];

      // Names for the named rows, in one extra query.
      const ids = [...new Set(items.map((item) => item.submitted_by).filter(Boolean))] as string[];
      const people = new Map<string, { full_name: string | null; email: string | null }>();
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", ids);
        for (const profile of profiles ?? []) {
          people.set(profile.id, { full_name: profile.full_name, email: profile.email });
        }
      }

      const rows: FeedbackInboxRow[] = items.map((item) => ({
        ...item,
        submitter: item.submitted_by ? people.get(item.submitted_by) ?? null : null,
      }));

      return { rows, total: count ?? 0 };
    },
    staleTime: 30_000,
  });
}

export function useOpenFeedbackCount(enabled: boolean) {
  return useQuery({
    queryKey: [...INBOX_KEY, "open-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("feedback_items" as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "open");
      if (error) {
        throw error;
      }
      return count ?? 0;
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useUpdateFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      adminNote,
    }: {
      id: string;
      status: FeedbackStatus;
      adminNote: string;
    }) => {
      const { error } = await supabase
        .from("feedback_items" as any)
        .update({ status, admin_note: adminNote.trim() || null } as any)
        .eq("id", id);
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INBOX_KEY });
    },
  });
}
