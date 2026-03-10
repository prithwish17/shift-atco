import { Card, CardContent } from "@/components/ui/card";

interface LeaveSummaryCardProps {
  label: string;
  value: string | number;
  tone?: "default" | "info" | "success" | "warning";
}

const toneStyles: Record<NonNullable<LeaveSummaryCardProps["tone"]>, string> = {
  default: "border-l-slate-300 text-slate-700",
  info: "border-l-blue-500 text-blue-700",
  success: "border-l-green-500 text-green-700",
  warning: "border-l-amber-500 text-amber-700",
};

export function LeaveSummaryCard({ label, value, tone = "default" }: LeaveSummaryCardProps) {
  const styles = toneStyles[tone];
  return (
    <Card className={`border-l-4 ${styles}`}>
      <CardContent className="pt-3 pb-3">
        <div className="text-2xl font-black">{value}</div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
      </CardContent>
    </Card>
  );
}
