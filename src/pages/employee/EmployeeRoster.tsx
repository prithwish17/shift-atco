import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Database } from "lucide-react";
import { useRosters, type RosterEntry } from "@/hooks/useRosters";
import { format, addDays, isToday } from "date-fns";

const TEAMS = ["A", "B", "C", "D", "E"];
const SHIFTS = ["Morning", "Afternoon", "Night"];

function formatDateForFilter(date: Date): string {
    return format(date, "yyyy-MM-dd");
}

function formatDateLabel(date: Date): { day: string; weekday: string; isToday: boolean } {
    return {
        day: format(date, "d MMM"),
        weekday: format(date, "EEE"),
        isToday: isToday(date),
    };
}

export default function EmployeeRoster() {
    const today = useMemo(() => new Date(), []);

    // Generate 5 dates: 2 before today, today, 2 after today
    const dateRange = useMemo(() => {
        return Array.from({ length: 5 }, (_, i) => addDays(today, i - 2));
    }, [today]);

    const [selectedDate, setSelectedDate] = useState(formatDateForFilter(today));
    const [selectedTeam, setSelectedTeam] = useState("all");
    const [selectedShift, setSelectedShift] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [excludeSpecialEntries, setExcludeSpecialEntries] = useState(false);

    const {
        data: rosters = [],
        isLoading,
        isFetching,
    } = useRosters({
        team: selectedTeam,
        shift: selectedShift,
        search: searchQuery || undefined,
        date: selectedDate,
        excludeSpecialEntries,
    });

    return (
        <DashboardLayout role="employee">
            <div className="space-y-6">
                {/* Header */}
                <div>
                    <h1 className="text-3xl font-bold">Shift Roster Data</h1>
                    <p className="text-muted-foreground">
                        View shift roster assignments by date
                    </p>
                </div>

                {/* Filters */}
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex flex-col sm:flex-row gap-3 items-end">
                            <div className="w-full sm:w-40">
                                <label className="text-sm font-medium mb-1.5 block">
                                    Team
                                </label>
                                <Select
                                    value={selectedTeam}
                                    onValueChange={setSelectedTeam}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="All Teams" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Teams</SelectItem>
                                        {TEAMS.map((t) => (
                                            <SelectItem key={t} value={t}>
                                                Team {t}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="w-full sm:w-44">
                                <label className="text-sm font-medium mb-1.5 block">
                                    Shift
                                </label>
                                <Select
                                    value={selectedShift}
                                    onValueChange={setSelectedShift}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="All Shifts" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Shifts</SelectItem>
                                        {SHIFTS.map((s) => (
                                            <SelectItem key={s} value={s}>
                                                {s}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="w-full sm:flex-1">
                                <label className="text-sm font-medium mb-1.5 block">
                                    Search
                                </label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search by name, unit, position..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-9"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                            <Checkbox
                                id="employee-hide-special-roster-entries"
                                checked={excludeSpecialEntries}
                                onCheckedChange={(checked) => setExcludeSpecialEntries(checked === true)}
                            />
                            <label htmlFor="employee-hide-special-roster-entries" className="text-sm text-muted-foreground cursor-pointer">
                                Hide Extra Duty and Duty Exchange/Change entries
                            </label>
                        </div>
                    </CardContent>
                </Card>

                {/* Date Selector */}
                <Card>
                    <CardContent className="py-3 px-4">
                        <div className="flex justify-center">
                            <div className="flex gap-2 overflow-x-auto">
                                {dateRange.map((date) => {
                                    const dateStr = formatDateForFilter(date);
                                    const label = formatDateLabel(date);
                                    const isSelected = selectedDate === dateStr;

                                    return (
                                        <Button
                                            key={dateStr}
                                            variant={isSelected ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => setSelectedDate(dateStr)}
                                            className={`flex flex-col items-center min-w-[72px] h-auto py-1.5 px-3 gap-0 ${label.isToday && !isSelected
                                                ? "border-primary text-primary"
                                                : ""
                                                }`}
                                        >
                                            <span className="text-[11px] font-normal opacity-70">
                                                {label.weekday}
                                            </span>
                                            <span className="text-sm font-semibold">
                                                {label.day}
                                            </span>
                                            {label.isToday && (
                                                <span className="text-[9px] font-medium mt-0.5 leading-none">
                                                    Today
                                                </span>
                                            )}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Status */}
                <div className="flex items-center gap-4">
                    <Badge variant="outline" className="gap-1">
                        <Database className="h-3 w-3" />
                        {rosters.length} records
                    </Badge>
                    {isFetching && !isLoading && (
                        <Badge variant="secondary">Refreshing...</Badge>
                    )}
                </div>

                {/* Data Table */}
                <Card>
                    <CardHeader>
                        <CardTitle>Roster Data</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="space-y-3">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <Skeleton key={i} className="h-12 w-full" />
                                ))}
                            </div>
                        ) : rosters.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                <Database className="h-12 w-12 mx-auto mb-3 opacity-30" />
                                <p className="font-medium">No roster data found</p>
                                <p className="text-sm mt-1">
                                    No roster entries available for the selected date.
                                </p>
                            </div>
                        ) : (
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-16">S.No</TableHead>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Shift</TableHead>
                                            <TableHead>Team</TableHead>
                                            <TableHead>Unit</TableHead>
                                            <TableHead>Employee</TableHead>
                                            <TableHead>Position</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rosters.map(
                                            (entry: RosterEntry, idx: number) => (
                                                <TableRow
                                                    key={entry.id || idx}
                                                    className={`${
                                                        idx % 2 === 0
                                                            ? "bg-white dark:bg-slate-900/55"
                                                            : "bg-slate-50/70 dark:bg-slate-800/55"
                                                    } hover:bg-blue-50/60 dark:hover:bg-blue-900/25`}
                                                >
                                                    <TableCell className="font-medium text-muted-foreground">{idx + 1}</TableCell>
                                                    <TableCell className="font-mono text-sm">
                                                        {entry.date}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline">{entry.shift}</Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="secondary">
                                                            Team {entry.team}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>{entry.unit}</TableCell>
                                                    <TableCell className="font-medium">
                                                        {entry.employee_name}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge>{entry.position}</Badge>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Bottom Status Tables */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
                    {/* Duty Change Table */}
                    <Card>
                        <CardHeader className="py-3 bg-muted/50">
                            <CardTitle className="text-sm font-semibold">Duty Change</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-3 pb-3">
                            <div className="divide-y text-sm">
                                {rosters.filter(r => r.position?.toUpperCase() === 'DUTY CHANGE').map((r, idx) => (
                                    <div key={r.id || idx} className="py-2 flex justify-between">
                                        <span className="font-medium">{r.employee_name}</span>
                                        <span className="text-muted-foreground ml-2">{r.unit}</span>
                                    </div>
                                ))}
                                {rosters.filter(r => r.position?.toUpperCase() === 'DUTY CHANGE').length === 0 && (
                                    <div className="py-2 text-center text-muted-foreground">No duty changes</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Extra Duty Table */}
                    <Card>
                        <CardHeader className="py-3 bg-muted/50">
                            <CardTitle className="text-sm font-semibold">Extra Duty</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-3 pb-3">
                            <div className="divide-y text-sm">
                                {rosters.filter(r => r.position?.toUpperCase() === 'EXTRA DUTY').map((r, idx) => (
                                    <div key={r.id || idx} className="py-2 flex justify-between items-center">
                                        <span className="font-medium">{r.employee_name}</span>
                                        <span className="text-muted-foreground ml-2">{r.unit}</span>
                                    </div>
                                ))}
                                {rosters.filter(r => r.position?.toUpperCase() === 'EXTRA DUTY').length === 0 && (
                                    <div className="py-2 text-center text-muted-foreground">No extra duties</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Leave Table */}
                    <Card>
                        <CardHeader className="py-3 bg-muted/50">
                            <CardTitle className="text-sm font-semibold text-destructive">Leave</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-3 pb-3">
                            <div className="divide-y text-sm">
                                {rosters.filter(r => r.position?.toUpperCase().includes('LEAVE')).map((r, idx) => (
                                    <div key={r.id || idx} className="py-2 flex justify-between items-center">
                                        <span className="font-medium">{r.employee_name}</span>
                                        <Badge variant="secondary" className="font-normal text-[10px] uppercase ml-2">{r.position}</Badge>
                                    </div>
                                ))}
                                {rosters.filter(r => r.position?.toUpperCase().includes('LEAVE')).length === 0 && (
                                    <div className="py-2 text-center text-muted-foreground">No one on leave</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}
