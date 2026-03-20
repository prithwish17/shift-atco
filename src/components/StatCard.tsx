import { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  className?: string;
  compactMobile?: boolean;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

export function StatCard({ title, value, icon: Icon, description, trend, className, compactMobile }: StatCardProps) {
  return (
    <Card className={cn(className, compactMobile && "flex items-center justify-between gap-3 p-4 sm:block sm:p-0")}>
      <CardHeader className={cn("flex flex-row items-center justify-between pb-2", compactMobile && "flex-1 p-0 pb-0 sm:p-6 sm:pb-2")}>
        <CardTitle className={cn("text-sm font-medium text-muted-foreground", compactMobile && "text-xs leading-tight sm:text-sm")}>
          {title}
        </CardTitle>
        <Icon className={cn("h-4 w-4 text-muted-foreground", compactMobile && "hidden sm:block sm:h-4 sm:w-4")} />
      </CardHeader>
      <CardContent className={cn(compactMobile && "p-0 text-right sm:px-6 sm:pb-6 sm:pt-0 sm:text-left")}>
        <div className={cn("text-2xl font-bold", compactMobile && "text-xl sm:text-2xl")}>{value}</div>
        {description && (
          <p className={cn("mt-1 text-xs text-muted-foreground", compactMobile && "hidden sm:block sm:text-xs")}>{description}</p>
        )}
        {trend && (
          <p className={cn("mt-1 text-xs", compactMobile && "hidden sm:block sm:text-xs", trend.isPositive ? "text-accent" : "text-destructive")}>
            {trend.isPositive ? '+' : ''}{trend.value}% from last month
          </p>
        )}
      </CardContent>
    </Card>
  );
}
