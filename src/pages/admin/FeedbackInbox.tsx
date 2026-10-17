import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Inbox, Loader2, UserX } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  FEEDBACK_INBOX_PAGE_SIZE,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUS_LABELS,
  FeedbackInboxRow,
  FeedbackKind,
  FeedbackStatus,
  useFeedbackInbox,
  useUpdateFeedback,
} from "@/hooks/useFeedback";

const KIND_BADGE: Record<FeedbackKind, string> = {
  error: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  suggestion: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  grievance: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

const STATUS_BADGE: Record<FeedbackStatus, "default" | "secondary" | "outline"> = {
  open: "default",
  in_review: "secondary",
  resolved: "outline",
  dismissed: "outline",
};

type StatusFilter = FeedbackStatus | "all";
type KindFilter = FeedbackKind | "all";

export default function FeedbackInbox() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [kind, setKind] = useState<KindFilter>("all");
  const [page, setPage] = useState(0);

  const { data, isLoading, isError, refetch } = useFeedbackInbox({ status, kind, page });
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / FEEDBACK_INBOX_PAGE_SIZE));

  // A notification links here with ?id=… — open that item once it is loaded.
  const linkedId = searchParams.get("id");
  const [selectedId, setSelectedId] = useState<string | null>(linkedId);
  useEffect(() => {
    if (linkedId) {
      setSelectedId(linkedId);
      setStatus("all");
      setKind("all");
      setPage(0);
    }
  }, [linkedId]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const closeDetail = () => {
    setSelectedId(null);
    if (linkedId) {
      searchParams.delete("id");
      setSearchParams(searchParams, { replace: true });
    }
  };

  return (
    <DashboardLayout role="admin" title="Feedback" subtitle="Errors, suggestions and grievances sent from any page">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={status}
            onValueChange={(value) => {
              setStatus(value as StatusFilter);
              setPage(0);
            }}
          >
            <TabsList className="flex-wrap">
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="in_review">In review</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
              <TabsTrigger value="dismissed">Dismissed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>

          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value as KindFilter);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="error">Errors</SelectItem>
              <SelectItem value="suggestion">Suggestions</SelectItem>
              <SelectItem value="grievance">Grievances</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Feedback could not be loaded.{" "}
            <button type="button" onClick={() => refetch()} className="font-medium underline underline-offset-4">
              Try again
            </button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 && !isError ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <Inbox className="size-8" />
              <p>Nothing here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedId(row.id)}
                className="block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${KIND_BADGE[row.kind]}`}>
                    {FEEDBACK_KIND_LABELS[row.kind]}
                  </span>
                  <Badge variant={STATUS_BADGE[row.status]}>{FEEDBACK_STATUS_LABELS[row.status]}</Badge>
                  {row.page_path ? (
                    <span className="truncate font-mono text-muted-foreground">{row.page_path}</span>
                  ) : null}
                  <span className="ml-auto text-muted-foreground">
                    {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-900 dark:text-slate-100">{row.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <Submitter row={row} />
                </p>
              </button>
            ))}
          </div>
        )}

        {total > FEEDBACK_INBOX_PAGE_SIZE ? (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {page + 1} of {pageCount} · {total} items
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage(page + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <FeedbackDetail row={selected} onClose={closeDetail} />
    </DashboardLayout>
  );
}

function Submitter({ row }: { row: FeedbackInboxRow }) {
  if (row.is_anonymous) {
    return (
      <span className="inline-flex items-center gap-1">
        <UserX className="size-3.5" />
        Anonymous
      </span>
    );
  }
  if (!row.submitter) {
    return <span>Unknown user</span>;
  }
  return (
    <span>
      {row.submitter.full_name || "Unnamed"}
      {row.submitter.email ? ` · ${row.submitter.email}` : ""}
    </span>
  );
}

function FeedbackDetail({ row, onClose }: { row: FeedbackInboxRow | null; onClose: () => void }) {
  const update = useUpdateFeedback();
  const [status, setStatus] = useState<FeedbackStatus>("open");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (row) {
      setStatus(row.status);
      setNote(row.admin_note ?? "");
    }
  }, [row]);

  const dirty = row ? status !== row.status || note.trim() !== (row.admin_note ?? "") : false;

  const handleSave = async () => {
    if (!row) return;
    try {
      await update.mutateAsync({ id: row.id, status, adminNote: note });
      toast.success("Feedback updated");
      onClose();
    } catch (error) {
      toast.error("Update failed", { description: (error instanceof Error && error.message) || "Please try again." });
    }
  };

  return (
    <Sheet open={row !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_BADGE[row.kind]}`}>
                  {FEEDBACK_KIND_LABELS[row.kind]}
                </span>
                {format(new Date(row.created_at), "d MMM yyyy, HH:mm")}
              </SheetTitle>
              <SheetDescription>
                <Submitter row={row} />
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-5 text-sm">
              <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                {row.body}
              </p>

              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <dt>Page</dt>
                <dd className="break-all font-mono">{row.page_path || "—"}</dd>
                {row.page_title ? (
                  <>
                    <dt>Title</dt>
                    <dd>{row.page_title}</dd>
                  </>
                ) : null}
                <dt>Device</dt>
                <dd className="break-words">{row.user_agent || "—"}</dd>
                {row.resolved_at ? (
                  <>
                    <dt>Closed</dt>
                    <dd>{format(new Date(row.resolved_at), "d MMM yyyy, HH:mm")}</dd>
                  </>
                ) : null}
              </dl>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as FeedbackStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FEEDBACK_STATUS_LABELS) as FeedbackStatus[]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {FEEDBACK_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="feedback-admin-note">Admin note</Label>
                <Textarea
                  id="feedback-admin-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder="What was done, or why it was dismissed. Only admins see this."
                />
              </div>
            </div>

            <SheetFooter className="mt-6 gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={handleSave} disabled={!dirty || update.isPending}>
                {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
