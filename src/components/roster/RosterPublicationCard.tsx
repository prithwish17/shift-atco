import { useMemo } from "react";
import { addMonths, format, parseISO, startOfMonth } from "date-fns";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  monthKey,
  usePublishRosterMonth,
  useRosterPublications,
  useRosterVisibility,
  useUnpublishRosterMonth,
} from "@/hooks/useRosterPublication";

/** How many months past the current one can be released ahead. */
const MONTHS_AHEAD = 2;

/**
 * RosterPublicationCard — lets a supervisor or admin release next month's
 * roster to employees.  Renders nothing for anyone else.
 */
export default function RosterPublicationCard() {
  const { canPublish } = useRosterVisibility();
  const { data: publications = [], isLoading } = useRosterPublications();
  const publish = usePublishRosterMonth();
  const unpublish = useUnpublishRosterMonth();

  const months = useMemo(() => {
    const current = startOfMonth(new Date());
    return Array.from({ length: MONTHS_AHEAD }, (_, i) => addMonths(current, i + 1));
  }, []);

  const byMonth = useMemo(
    () => new Map(publications.map((p) => [p.month.slice(0, 7), p])),
    [publications],
  );

  if (!canPublish) return null;

  const busy = publish.isPending || unpublish.isPending;

  const toggle = async (month: Date, isPublished: boolean) => {
    const label = format(month, "MMMM yyyy");
    try {
      if (isPublished) {
        await unpublish.mutateAsync(month);
        toast.success(`${label} roster hidden from employees`);
      } else {
        await publish.mutateAsync(month);
        toast.success(`${label} roster published to employees`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the roster publication");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Roster publication</CardTitle>
        <CardDescription>
          Employees always see the current month. A future month stays hidden from them until it is
          published here. WSO, supervisors and admins always see every month.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {months.map((month) => {
          const key = monthKey(month);
          const row = byMonth.get(key);
          const isPublished = !!row;
          const label = format(month, "MMMM yyyy");

          return (
            <div
              key={key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{label}</span>
                  {isLoading ? (
                    <Badge variant="outline">Checking…</Badge>
                  ) : isPublished ? (
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400">
                      Published
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                      Not published
                    </Badge>
                  )}
                </div>
                {row && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Since {format(parseISO(row.published_at), "dd MMM yyyy, HH:mm")}
                  </p>
                )}
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant={isPublished ? "outline" : "default"}
                    disabled={isLoading || busy}
                  >
                    {busy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : isPublished ? (
                      <EyeOff className="mr-2 h-4 w-4" />
                    ) : (
                      <Eye className="mr-2 h-4 w-4" />
                    )}
                    {isPublished ? "Unpublish" : "Publish"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {isPublished ? `Hide the ${label} roster?` : `Publish the ${label} roster?`}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {isPublished
                        ? "Employees will stop seeing their duties for this month until it is published again."
                        : "Every employee will see their duties for this month on My Schedule, the dashboard and the shift roster."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => toggle(month, isPublished)}>
                      {isPublished ? "Unpublish" : "Publish"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
