import { useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarDays, Gift, Clock, Star, Sun, PartyPopper, Timer } from 'lucide-react';
import { format, getMonth, getDaysInMonth, startOfMonth, getDay } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useLeaveBalances } from '@/hooks/useLeaves';
import {
    useHolidaysByYear,
    useNextHoliday,
    useHolidaysByCategory,
    useCompOffBalance,
    useCompOffSummary,
    useRHUsage,
    type Holiday,
} from '@/hooks/useHolidayDashboard';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getCategoryBadge(category: string) {
    switch (category) {
        case 'national':
            return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">National</Badge>;
        case 'closed':
            return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px]">Closed</Badge>;
        case 'reserved':
            return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Restricted</Badge>;
        default:
            return <Badge variant="secondary" className="text-[10px]">{category}</Badge>;
    }
}

function getCategoryDot(category: string) {
    switch (category) {
        case 'national': return 'bg-red-500';
        case 'closed': return 'bg-blue-500';
        case 'reserved': return 'bg-amber-500';
        default: return 'bg-gray-400';
    }
}

export default function EmployeeHolidays() {
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear);
    const [selectedMonth, setSelectedMonth] = useState(getMonth(new Date()));

    const { user } = useAuth();
    const { data: holidays = [] } = useHolidaysByYear(selectedYear);
    const { data: leaveBalances } = useLeaveBalances(user?.id);
    const { data: compOffEntries = [] } = useCompOffBalance(user?.id);

    const nextHoliday = useNextHoliday(holidays);
    const { national, closed, restricted } = useHolidaysByCategory(holidays);
    const compOffSummary = useCompOffSummary(compOffEntries);
    const rhUsage = useRHUsage(holidays, leaveBalances);

    // Calendar: holidays for selected month
    const monthHolidays = useMemo(() => {
        return holidays.filter((h) => {
            const d = new Date(h.holiday_date);
            return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
        });
    }, [holidays, selectedMonth, selectedYear]);

    const holidayDateSet = useMemo(() => {
        const map = new Map<number, Holiday>();
        monthHolidays.forEach((h) => map.set(new Date(h.holiday_date).getDate(), h));
        return map;
    }, [monthHolidays]);

    // Calendar grid
    const calendarGrid = useMemo(() => {
        const firstDay = startOfMonth(new Date(selectedYear, selectedMonth));
        const daysInMonth = getDaysInMonth(firstDay);
        const startDay = getDay(firstDay);
        const cells: (number | null)[] = [];
        for (let i = 0; i < startDay; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(d);
        return cells;
    }, [selectedYear, selectedMonth]);

    const today = new Date();
    const todayDate = today.getDate();
    const isCurrentMonth = today.getMonth() === selectedMonth && today.getFullYear() === selectedYear;

    return (
        <DashboardLayout role="employee">
            <div className="space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                            <CalendarDays className="h-6 w-6 text-indigo-600" />
                            Holidays
                        </h1>
                        <p className="text-muted-foreground text-sm">Holiday calendar, RH quota & comp-off balance</p>
                    </div>
                    <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                        <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Top Row: Next Holiday + RH Quota + Comp-Off */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Next Holiday Countdown */}
                    <Card className="border-0 bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg">
                        <CardContent className="pt-5 pb-5">
                            {nextHoliday ? (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <PartyPopper className="h-5 w-5 opacity-80" />
                                        <span className="text-xs font-medium uppercase tracking-wide opacity-80">Next Holiday</span>
                                    </div>
                                    <p className="text-xl font-bold">{nextHoliday.holiday_name}</p>
                                    <p className="text-sm opacity-90">
                                        {format(new Date(nextHoliday.holiday_date), 'EEEE, d MMMM yyyy')}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <Timer className="h-4 w-4" />
                                        <span className="text-lg font-bold">
                                            {nextHoliday.daysUntil === 0
                                                ? 'Today!'
                                                : nextHoliday.daysUntil === 1
                                                    ? 'Tomorrow!'
                                                    : `in ${nextHoliday.daysUntil} days`}
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-4 opacity-80">
                                    <p className="text-sm">No upcoming holidays this year</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* RH Quota */}
                    <Card>
                        <CardContent className="pt-5 pb-5">
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Star className="h-4 w-4 text-amber-500" />
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Restricted Holidays</span>
                                </div>
                                <div className="flex items-end gap-1">
                                    <span className="text-3xl font-bold text-amber-600">{rhUsage.remaining}</span>
                                    <span className="text-sm text-muted-foreground mb-1">/ {rhUsage.total} remaining</span>
                                </div>
                                <div className="w-full bg-amber-100 rounded-full h-2">
                                    <div
                                        className="bg-amber-500 rounded-full h-2 transition-all"
                                        style={{ width: `${rhUsage.total > 0 ? ((rhUsage.total - rhUsage.remaining) / rhUsage.total) * 100 : 0}%` }}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">{rhUsage.used} used this year</p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Comp-Off Balance */}
                    <Card>
                        <CardContent className="pt-5 pb-5">
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Gift className="h-4 w-4 text-emerald-500" />
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comp-Off Balance</span>
                                </div>
                                <div className="flex items-end gap-1">
                                    <span className="text-3xl font-bold text-emerald-600">{compOffSummary.available}</span>
                                    <span className="text-sm text-muted-foreground mb-1">days available</span>
                                </div>
                                <div className="flex gap-4 text-xs text-muted-foreground">
                                    <span>{compOffSummary.used} used</span>
                                    <span>{compOffSummary.expired} expired</span>
                                </div>
                                {compOffSummary.nearestExpiry && (
                                    <p className="text-xs text-orange-600 flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        Next expiry: {format(new Date(compOffSummary.nearestExpiry.expiry_date), 'd MMM')}
                                    </p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Calendar + List */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                    {/* Mini Calendar */}
                    <Card className="lg:col-span-2">
                        <CardHeader className="py-3 px-4">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-semibold">Calendar</CardTitle>
                                <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                                    <SelectTrigger className="w-[90px] h-7 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {MONTH_NAMES.map((m, i) => (
                                            <SelectItem key={i} value={String(i)}>{m}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardHeader>
                        <CardContent className="px-4 pb-4">
                            <div className="grid grid-cols-7 gap-1 text-center">
                                {DAY_LABELS.map((d) => (
                                    <div key={d} className="text-[10px] font-medium text-muted-foreground py-1">{d}</div>
                                ))}
                                {calendarGrid.map((day, i) => {
                                    const holiday = day ? holidayDateSet.get(day) : null;
                                    const isToday = isCurrentMonth && day === todayDate;
                                    return (
                                        <div
                                            key={i}
                                            className={`
                        aspect-square flex flex-col items-center justify-center rounded-md text-xs relative
                        ${!day ? '' : 'cursor-default'}
                        ${isToday ? 'bg-indigo-600 text-white font-bold' : ''}
                        ${holiday && !isToday ? 'bg-red-50 font-semibold text-red-700' : ''}
                      `}
                                            title={holiday ? `${holiday.holiday_name} (${holiday.category})` : undefined}
                                        >
                                            {day || ''}
                                            {holiday && (
                                                <div className={`absolute bottom-0.5 w-1 h-1 rounded-full ${isToday ? 'bg-white' : getCategoryDot(holiday.category)}`} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Legend */}
                            <div className="flex gap-3 mt-3 text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> National</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Closed</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Restricted</span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Holiday Lists */}
                    <div className="lg:col-span-3 space-y-4">
                        {/* National Holidays */}
                        <Card>
                            <CardHeader className="py-2.5 px-4 bg-red-50/50">
                                <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                                    <Sun className="h-3.5 w-3.5 text-red-500" />
                                    National Holidays ({national.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-4 py-2">
                                <div className="divide-y">
                                    {national.map((h) => (
                                        <div key={h.id} className="py-2 flex justify-between items-center">
                                            <div>
                                                <p className="text-sm font-medium">{h.holiday_name}</p>
                                                <p className="text-xs text-muted-foreground">{format(new Date(h.holiday_date), 'EEEE, d MMM')}</p>
                                            </div>
                                            {getCategoryBadge(h.category)}
                                        </div>
                                    ))}
                                    {national.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No national holidays</p>}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Closed Holidays */}
                        <Card>
                            <CardHeader className="py-2.5 px-4 bg-blue-50/50">
                                <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                                    <CalendarDays className="h-3.5 w-3.5 text-blue-500" />
                                    Closed Holidays ({closed.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-4 py-2">
                                <div className="divide-y">
                                    {closed.map((h) => (
                                        <div key={h.id} className="py-2 flex justify-between items-center">
                                            <div>
                                                <p className="text-sm font-medium">{h.holiday_name}</p>
                                                <p className="text-xs text-muted-foreground">{format(new Date(h.holiday_date), 'EEEE, d MMM')}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {h.comp_off_eligible && (
                                                    <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200">Comp-off</Badge>
                                                )}
                                                {getCategoryBadge(h.category)}
                                            </div>
                                        </div>
                                    ))}
                                    {closed.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No closed holidays</p>}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Restricted Holidays */}
                        <Card>
                            <CardHeader className="py-2.5 px-4 bg-amber-50/50">
                                <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                                    <Star className="h-3.5 w-3.5 text-amber-500" />
                                    Restricted Holidays ({restricted.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-4 py-2">
                                <div className="divide-y">
                                    {restricted.map((h) => (
                                        <div key={h.id} className="py-2 flex justify-between items-center">
                                            <div>
                                                <p className="text-sm font-medium">{h.holiday_name}</p>
                                                <p className="text-xs text-muted-foreground">{format(new Date(h.holiday_date), 'EEEE, d MMM')}</p>
                                            </div>
                                            {getCategoryBadge(h.category)}
                                        </div>
                                    ))}
                                    {restricted.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No restricted holidays</p>}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
