import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ── Extra duty (OPE) codes: compound codes where employee works beyond normal shift ── */
const OPE_CODES = new Set([
    "M+A", "NO+N", "SAT+NO", "SUN+N", "SUN+M", "SUN+A", "SUN+NO",
    "SAT+N", "CO+N", "CO+A", "CO+M", "A+M",
]);

const OPE_DESCRIPTIONS: Record<string, string> = {
    "M+A": "Morning + Afternoon",
    "NO+N": "Night Off + Night",
    "SAT+NO": "Saturday + Night Off",
    "SUN+N": "Sunday + Night",
    "SUN+M": "Sunday + Morning",
    "SUN+A": "Sunday + Afternoon",
    "SUN+NO": "Sunday + Night Off",
    "SAT+N": "Saturday + Night",
    "CO+N": "Clear Off + Night",
    "CO+A": "Clear Off + Afternoon",
    "CO+M": "Clear Off + Morning",
    "A+M": "Afternoon + Morning",
};

function getBadgeVariant(code: string): "default" | "secondary" | "outline" | "destructive" {
    if (code.includes("SUN") || code.includes("SAT")) return "destructive";
    if (code.includes("CO") || code.includes("NO")) return "secondary";
    return "default";
}

export default function OPEAssignments() {
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const dateStr = format(selectedDate, "yyyy-MM-dd");

    const { data: schedules = [], isLoading } = useQuery({
        queryKey: ["ope-assignments", dateStr],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("employee_schedules" as any)
                .select("employee_code, employee_name, duty_code")
                .eq("duty_date", dateStr);
            if (error) throw error;
            return (data || []) as unknown as Array<{
                employee_code: string;
                employee_name: string;
                duty_code: string;
            }>;
        },
        staleTime: 2 * 60 * 1000,
    });

    const opeEmployees = useMemo(
        () =>
            schedules.filter((s) => {
                const code = s.duty_code?.toUpperCase().trim();
                return code && OPE_CODES.has(code);
            }),
        [schedules]
    );

    // Group by duty code
    const grouped = useMemo(() => {
        const map: Record<string, typeof opeEmployees> = {};
        opeEmployees.forEach((emp) => {
            const code = emp.duty_code.toUpperCase().trim();
            if (!map[code]) map[code] = [];
            map[code].push(emp);
        });
        return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
    }, [opeEmployees]);

    return (
        <DashboardLayout role="supervisor">
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div className="flex items-center gap-3">
                        <Link to="/supervisor">
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">OPE / Extra Duty Assignments</h1>
                            <p className="text-muted-foreground">
                                Employees assigned extra or overtime duties
                            </p>
                        </div>
                    </div>

                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className={cn("justify-start text-left font-normal")}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {format(selectedDate, "PPP")}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={selectedDate}
                                onSelect={(date) => date && setSelectedDate(date)}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                </div>

                {/* Summary */}
                <div className="grid gap-4 md:grid-cols-3">
                    <Card className="bg-violet-50/70 border-violet-100 dark:bg-violet-950/30 dark:border-violet-900/40">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Total OPE Employees
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold">{isLoading ? "..." : opeEmployees.length}</div>
                            <p className="text-xs text-muted-foreground mt-1">for {format(selectedDate, "dd MMM yyyy")}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Duty Types
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold">{isLoading ? "..." : grouped.length}</div>
                            <p className="text-xs text-muted-foreground mt-1">distinct extra duty codes</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Total Scheduled
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold">{isLoading ? "..." : schedules.length}</div>
                            <p className="text-xs text-muted-foreground mt-1">employees in schedule</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Employee List grouped by duty code */}
                {isLoading ? (
                    <div className="space-y-3">
                        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
                    </div>
                ) : grouped.length === 0 ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <p className="text-muted-foreground">No extra duty assignments for {format(selectedDate, "dd MMM yyyy")}</p>
                        </CardContent>
                    </Card>
                ) : (
                    grouped.map(([code, employees]) => (
                        <Card key={code}>
                            <CardHeader>
                                <div className="flex items-center gap-3">
                                    <Badge variant={getBadgeVariant(code)} className="text-sm px-3 py-1">
                                        {code}
                                    </Badge>
                                    <div>
                                        <CardTitle className="text-base">{OPE_DESCRIPTIONS[code] || code}</CardTitle>
                                        <CardDescription>{employees.length} employee{employees.length > 1 ? "s" : ""}</CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {employees.map((emp, idx) => (
                                        <div
                                            key={`${emp.employee_code}-${idx}`}
                                            className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30"
                                        >
                                            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                                                {emp.employee_name?.charAt(0) || "?"}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-medium text-sm truncate">{emp.employee_name || "Unknown"}</p>
                                                <p className="text-xs text-muted-foreground">{emp.employee_code}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </DashboardLayout>
    );
}
