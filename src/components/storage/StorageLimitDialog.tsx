import { HardDrive } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { StorageScope } from "@/hooks/useStorageStatus";

interface StorageLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: StorageScope;
}

/**
 * Shown when an upload is blocked because the R2 free-tier limit is reached,
 * either before the user picks a file (the status says it is closed) or after
 * the server refused one with 507.
 */
export function StorageLimitDialog({ open, onOpenChange, scope }: StorageLimitDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-amber-600" />
            Storage limit reached
          </AlertDialogTitle>
          <AlertDialogDescription>
            {scope === "announcement"
              ? "Announcement attachments are paused because file storage is nearly full. You can still post the announcement without a file. Delete old attachments or recount storage to free space."
              : "Uploads are paused because file storage is full. Please contact the admin. You can still submit the form without the file."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
