import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { NormalizedLeaveRecord } from "@/utils/leaveCalculations";

function formatItem(item: unknown): string {
  if (item == null) return "";
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (typeof item === "object") {
    const obj = item as Record<string, unknown>;
    const date = obj.date || obj.leaveDate || obj.dutyDate || obj.holidayDate || obj.opeDutyDate || obj.dateOrDutyPerformed;
    const duty = obj.dutyPerformed;
    const status = obj.status;
    const label = obj.name || obj.title || obj.type;
    if (date || duty || status || label) {
      return [label, date, duty, status].filter(Boolean).join(" • ");
    }
    return JSON.stringify(obj);
  }
  return String(item);
}

function renderList(title: string, items: unknown[]) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">No records</div>
      ) : (
        <div className="space-y-1">
          {items.map((item, idx) => (
            <div key={idx} className="text-sm text-slate-700">
              {formatItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface LeaveDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: NormalizedLeaveRecord | null;
}

export function LeaveDetailsModal({ open, onOpenChange, record }: LeaveDetailsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {record?.name || "Employee"}
            <Badge variant={record?.status === "Inactive" ? "secondary" : "default"}>
              {record?.status || "Active"}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        {record && (
          <div className="space-y-5">
            {renderList("Casual Leave", record.casualLeave)}
            {renderList("Restricted Holidays", record.restrictedHolidays)}
            {renderList("Comp-Off History", record.lastYearCompOff)}
            {renderList("OPE Duty", record.opeDuty)}
            {renderList("National Holidays", record.nationalHolidays)}
            {renderList("Closed Holidays", record.closedHolidays)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
