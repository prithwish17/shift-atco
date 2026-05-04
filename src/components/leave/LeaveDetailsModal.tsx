import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { NormalizedLeaveRecord } from "@/utils/leaveCalculations";

function getCompOffSourceLabel(sourceType?: string, sourceLabel?: string): string {
  if (sourceLabel?.trim()) return sourceLabel.trim();
  switch ((sourceType || "").toUpperCase()) {
    case "COMP_OFF_DUTY":
      return "Comp-Off Duty";
    case "FROM_LAST_YEAR":
      return "From Last Year";
    case "LAST_YEAR_CH_DUTY":
      return "From Last Year";
    case "OPE_DUTY":
    case "OPE":
      return "OPE Duty";
    case "LAST_YEAR_COMP_OFF":
      return "Last Year Comp-Off";
    case "OPE_COMP_OFF":
      return "OPE Comp-Off";
    case "COMP_OFF":
      return "Legacy Comp-Off";
    default:
      return sourceType || "Comp-Off";
  }
}

function formatDateValue(value: unknown): string {
  if (typeof value !== "string") return value == null ? "" : String(value);
  const trimmed = value.trim();
  if (!trimmed) return "";

  const monthMatch = trimmed.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b\s+(\d{1,2})\s+(\d{4})/i);
  if (monthMatch) {
    const formattedMonth = monthMatch[1].charAt(0).toUpperCase() + monthMatch[1].slice(1).toLowerCase();
    return `${formattedMonth} ${monthMatch[2].padStart(2, "0")} ${monthMatch[3]}`;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;

  return date
    .toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    .replace(",", "");
}

function formatItem(item: unknown): string {
  if (item == null) return "";
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (typeof item === "object") {
    const obj = item as Record<string, unknown>;
    const date = obj.hideDates
      ? null
      : obj.date || obj.leaveDate || obj.dutyDate || obj.holidayDate || obj.opeDutyDate || obj.dateOrDutyPerformed || obj.leaveApplied;
    const duty = obj.dutyPerformed;
    const status = obj.status || obj.remark;
    const label =
      obj.name ||
      obj.title ||
      obj.type ||
      (typeof obj.sourceType === "string"
        ? getCompOffSourceLabel(
            obj.sourceType,
            typeof obj.sourceLabel === "string" ? obj.sourceLabel : undefined,
          )
        : "");
    if (date || duty || status || label) {
      return [label, formatDateValue(date), duty, status].filter(Boolean).join(" • ");
    }
    return JSON.stringify(obj);
  }
  return String(item);
}

function renderList(title: string, items: unknown[]) {
  const visibleItems = items.filter((item) => !(item && typeof item === "object" && "hideDates" in item && (item as Record<string, unknown>).hideDates));
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</div>
      {visibleItems.length === 0 ? (
        <div className="text-sm text-muted-foreground">No records</div>
      ) : (
        <div className="space-y-1">
          {visibleItems.map((item, idx) => (
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
            {renderList("Comp-Off Earned", record.compOffEarnedEntries)}
            {renderList("Comp-Off Used", record.compOffUsedEntries)}
            {renderList("OPE Duty", record.opeDuty)}
            {renderList("National Holidays", record.nationalHolidays)}
            {renderList("Closed Holidays", record.closedHolidays)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
