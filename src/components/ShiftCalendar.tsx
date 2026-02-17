import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ShiftCalendarProps {
  currentDate: Date;
  onDateChange: (date: Date) => void;
  shifts?: Array<{
    date: Date;
    dutyType: string;
    position?: string;
  }>;
  onDayClick?: (date: Date) => void;
}

const dutyColors = {
  M: "bg-blue-500 text-white",
  A: "bg-amber-500 text-white",
  N: "bg-indigo-600 text-white",
  NO: "bg-slate-400 text-white",
  CO: "bg-emerald-500 text-white",
  OFF: "bg-gray-200 text-gray-700",
  OPE: "bg-purple-500 text-white",
};

export function ShiftCalendar({ currentDate, onDateChange, shifts = [], onDayClick }: ShiftCalendarProps) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const previousMonth = () => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() - 1);
    onDateChange(newDate);
  };

  const nextMonth = () => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + 1);
    onDateChange(newDate);
  };

  const getShiftForDate = (date: Date) => {
    return shifts.find(
      (shift) => format(shift.date, "yyyy-MM-dd") === format(date, "yyyy-MM-dd")
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{format(currentDate, "MMMM yyyy")}</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={previousMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="text-center font-semibold text-sm text-muted-foreground p-2">
              {day}
            </div>
          ))}
          
          {daysInMonth.map((day) => {
            const shift = getShiftForDate(day);
            const isCurrentDay = isToday(day);

            return (
              <div
                key={day.toString()}
                className={cn(
                  "min-h-20 p-2 border rounded-lg cursor-pointer hover:bg-accent transition-colors",
                  !isSameMonth(day, currentDate) && "opacity-50",
                  isCurrentDay && "ring-2 ring-primary"
                )}
                onClick={() => onDayClick?.(day)}
              >
                <div className="text-sm font-medium mb-1">{format(day, "d")}</div>
                {shift && (
                  <Badge className={cn("text-xs w-full justify-center", dutyColors[shift.dutyType as keyof typeof dutyColors])}>
                    {shift.dutyType}
                    {shift.position && ` - ${shift.position}`}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Badge className={dutyColors.M}>M</Badge>
            <span className="text-sm">Morning</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={dutyColors.A}>A</Badge>
            <span className="text-sm">Afternoon</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={dutyColors.N}>N</Badge>
            <span className="text-sm">Night</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={dutyColors.NO}>NO</Badge>
            <span className="text-sm">Night Off</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={dutyColors.CO}>CO</Badge>
            <span className="text-sm">Comp Off</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={dutyColors.OFF}>OFF</Badge>
            <span className="text-sm">Day Off</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={dutyColors.OPE}>OPE</Badge>
            <span className="text-sm">Extra Duty</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
