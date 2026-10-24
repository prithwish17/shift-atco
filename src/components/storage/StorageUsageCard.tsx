import { formatDistanceToNow } from "date-fns";
import { HardDrive, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBytes, useRecountStorage, useStorageStatus } from "@/hooks/useStorageStatus";

/**
 * Admin view of R2 usage against the two upload levels: announcement
 * attachments pause at 8 GB, every upload pauses at 9.5 GB (free tier: 10 GB).
 */
export function StorageUsageCard() {
  const { data, isLoading, isError } = useStorageStatus();
  const recount = useRecountStorage();

  const handleRecount = async () => {
    try {
      const result = await recount.mutateAsync();
      toast.success(
        `Storage recounted: ${formatBytes(result.bytes_used)} in ${result.object_count} files` +
          (result.orphans_removed ? `, ${result.orphans_removed} unused attachments removed` : ""),
      );
    } catch (err) {
      toast.error((err as Error).message || "Recount failed");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <HardDrive className="size-5 text-sky-600" />
            File storage (Cloudflare R2)
          </CardTitle>
          <CardDescription>
            Uploads stop before the free tier runs out, so storage never costs money.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={handleRecount} disabled={recount.isPending}>
          {recount.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Recount now
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && <p className="text-sm text-muted-foreground">Loading storage usage…</p>}
        {isError && <p className="text-sm text-destructive">Could not load storage usage.</p>}
        {data && (
          <>
            <div className="flex flex-wrap gap-2">
              <StatusBadge open={data.announcement_uploads_allowed} label="Announcement attachments" />
              <StatusBadge open={data.all_uploads_allowed} label="All uploads" />
            </div>

            <UsageBar
              label="Storage"
              used={data.bytes_used}
              announcementLimit={data.limits.announcement_bytes}
              allLimit={data.limits.all_bytes}
              free={data.limits.free_bytes}
              format={formatBytes}
            />
            <UsageBar
              label="Uploads this month"
              used={data.uploads_this_month}
              announcementLimit={data.limits.announcement_uploads}
              allLimit={data.limits.all_uploads}
              free={data.limits.free_uploads}
              format={(n) => n.toLocaleString("en-IN")}
            />

            <p className="text-xs text-muted-foreground">
              {data.object_count !== undefined && <>{data.object_count.toLocaleString("en-IN")} files. </>}
              {data.reconciled_at
                ? `Last recounted ${formatDistanceToNow(new Date(data.reconciled_at), { addSuffix: true })}. `
                : "Not recounted yet; press Recount now to count files uploaded before the limit existed. "}
              The bucket is recounted automatically every night.
            </p>

            {data.largest_objects && data.largest_objects.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Largest files</p>
                <ul className="divide-y rounded-lg border text-xs">
                  {data.largest_objects.map((o) => (
                    <li key={o.key} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className="truncate font-mono">{o.key}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(o.size)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ open, label }: { open: boolean; label: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5",
        open
          ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
          : "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300",
      )}
    >
      <span className={cn("size-1.5 rounded-full", open ? "bg-emerald-500" : "bg-red-500")} />
      {label}: {open ? "open" : "paused"}
    </Badge>
  );
}

function UsageBar({
  label,
  used,
  announcementLimit,
  allLimit,
  free,
  format,
}: {
  label: string;
  used: number;
  announcementLimit: number;
  allLimit: number;
  free: number;
  format: (n: number) => string;
}) {
  const pct = (n: number) => `${Math.min(100, (n / free) * 100)}%`;
  const tone = used >= allLimit ? "bg-red-500" : used >= announcementLimit ? "bg-amber-500" : "bg-sky-500";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {format(used)} of {format(free)} free
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: pct(used) }} />
        <div className="absolute inset-y-0 w-px bg-amber-600" style={{ left: pct(announcementLimit) }} />
        <div className="absolute inset-y-0 w-px bg-red-600" style={{ left: pct(allLimit) }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-2 w-px bg-amber-600 align-middle" />
          Announcement attachments pause at {format(announcementLimit)}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-px bg-red-600 align-middle" />
          All uploads pause at {format(allLimit)}
        </span>
      </div>
    </div>
  );
}
