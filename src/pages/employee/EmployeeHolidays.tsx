import { useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarDays, Gift, Clock, Star, PartyPopper, Timer, LayoutList, ChevronDown, ChevronUp } from 'lucide-react';
import { format, getMonth, getDaysInMonth, startOfMonth, getDay, startOfDay, parseISO, isBefore, isSameDay } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useLeaveBalances } from '@/hooks/useLeaves';
import { useHolidays } from '@/hooks/useHolidays';
import {
    useHolidaysByYear,
    useNextHoliday,
    useHolidaysByType,
    useCompOffBalance,
    useCompOffSummary,
    useRHUsage,
    type Holiday,
} from '@/hooks/useHolidayDashboard';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const TYPE_DOT: Record<string, string> = { NH: 'bg-red-500', CH: 'bg-emerald-500', RH: 'bg-amber-500' };
const TYPE_CHIP_BG: Record<string, string> = {
    NH: 'bg-red-100 dark:bg-red-900/30',
    CH: 'bg-emerald-100 dark:bg-emerald-900/30',
    RH: 'bg-amber-100 dark:bg-amber-900/30',
};
const TYPE_CHIP_TEXT: Record<string, string> = {
    NH: 'text-red-700 dark:text-red-400',
    CH: 'text-emerald-700 dark:text-emerald-400',
    RH: 'text-amber-700 dark:text-amber-400',
};

function getTypeBadge(type: string) {
    const bg = TYPE_CHIP_BG[type] || 'bg-gray-100';
    const text = TYPE_CHIP_TEXT[type] || 'text-gray-700';
    return <Badge className={`${bg} ${text} border-0 text-[10px] font-bold`}>{type}</Badge>;
}

export default function EmployeeHolidays() {
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear);
    const [selectedMonth, setSelectedMonth] = useState(getMonth(new Date()));
    const [tab, setTab] = useState<'calendar' | 'timeline'>('timeline');
    const [showPast, setShowPast] = useState(false);
    const [showRH, setShowRH] = useState(false);

    const { user } = useAuth();
    const { data: holidays = [] } = useHolidays();
    const { data: yearHolidays = [] } = useHolidaysByYear(selectedYear);
    const { data: leaveBalances } = useLeaveBalances(user?.id);
    const { data: compOffEntries = [] } = useCompOffBalance(user?.id);

    const today = startOfDay(new Date());
    const nextHoliday = useNextHoliday(yearHolidays);
    const { national, closed, restricted } = useHolidaysByType(yearHolidays);
    const compOffSummary = useCompOffSummary(compOffEntries);
    const rhUsage = useRHUsage(yearHolidays, leaveBalances);

    // ── Calendar ──
    const monthHolidays = useMemo(() =>
        yearHolidays.filter((h) => {
            const d = new Date(h.holiday_date);
            return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
        }), [yearHolidays, selectedMonth, selectedYear]);

    const holidayDateSet = useMemo(() => {
        const map = new Map<number, Holiday>();
        monthHolidays.forEach((h) => map.set(new Date(h.holiday_date).getDate(), h));
        return map;
    }, [monthHolidays]);

    const calendarGrid = useMemo(() => {
        const firstDay = startOfMonth(new Date(selectedYear, selectedMonth));
        const daysInMonth = getDaysInMonth(firstDay);
        const start = getDay(firstDay);
        const cells: (number | null)[] = [];
        for (let i = 0; i < start; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(d);
        return cells;
    }, [selectedYear, selectedMonth]);

    const todayDate = today.getDate();
    const isCurrentMonth = today.getMonth() === selectedMonth && today.getFullYear() === selectedYear;

    // ── Timeline ──
    const sorted = useMemo(() =>
        [...(holidays as any[])]
            .filter((h) => showRH || h.type !== 'RH')
            .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)),
        [holidays, showRH]);

    const { pastHolidays, upcomingHolidays } = useMemo(() => {
        const past: any[] = [], upcoming: any[] = [];
        for (const h of sorted) {
            const d = parseISO(h.holiday_date);
            if (isBefore(d, today) && !isSameDay(d, today)) past.push(h);
            else upcoming.push(h);
        }
        return { pastHolidays: past, upcomingHolidays: upcoming };
    }, [sorted, today]);

    const groupByMonth = (list: any[]) => {
        const g: Record<string, any[]> = {};
        for (const h of list) { const k = h.holiday_date.substring(0, 7); if (!g[k]) g[k] = []; g[k].push(h); }
        return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
    };
    const upcomingGroups = groupByMonth(upcomingHolidays);
    const pastGroups = groupByMonth(pastHolidays);

    // ── Timeline Card (read-only) ──
    const TimelineCard = ({ holiday, isNext }: { holiday: any; isNext: boolean }) => {
        const d = parseISO(holiday.holiday_date);
        const monthIdx = d.getMonth();
        const day = d.getDate();
        const dayName = format(d, 'EEEE').toUpperCase();
        const typeColor = TYPE_CHIP_BG[holiday.type] || TYPE_CHIP_BG.NH;
        const typeText = TYPE_CHIP_TEXT[holiday.type] || TYPE_CHIP_TEXT.NH;
        const borderColor = isNext
            ? (holiday.type === 'NH' ? 'border-red-400 dark:border-red-700' : holiday.type === 'CH' ? 'border-emerald-400 dark:border-emerald-700' : 'border-amber-400 dark:border-amber-700')
            : 'border-slate-200 dark:border-neutral-800';

        return (
            <div className={`relative ${isNext ? 'mt-4' : ''}`}>
                <div className="absolute -left-[23px] top-1/2 -translate-y-1/2 w-4 h-[1px] bg-slate-200 dark:bg-neutral-800" />

                {isNext && (
                    <div className="absolute -top-3 left-3 z-20">
                        <span className={`flex items-center gap-1.5 px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-full leading-none shadow-lg ${holiday.type === 'NH' ? 'bg-red-500 shadow-red-500/40' :
                            holiday.type === 'CH' ? 'bg-emerald-500 shadow-emerald-500/40' :
                                'bg-amber-500 shadow-amber-500/40'
                            } text-white`}>
                            Next Holiday in {nextHoliday?.daysUntil === 0 ? 'Today' : `${nextHoliday?.daysUntil} ${nextHoliday?.daysUntil === 1 ? 'Day' : 'Days'}`}
                        </span>
                    </div>
                )}

                <div className={`relative rounded-[16px] overflow-hidden flex h-[80px] border-2 transition-all ${borderColor} bg-white dark:bg-neutral-900`}>
                    <div className="flex flex-col items-center justify-center py-2 w-[74px] shrink-0">
                        <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${typeText}`}>{MONTH_SHORT[monthIdx]}</span>
                        <span className="text-xl font-bold leading-none tracking-tighter text-slate-900 dark:text-white">{String(day).padStart(2, '0')}</span>
                    </div>
                    <div className="my-auto w-[1.5px] shrink-0 h-8 bg-slate-200 dark:bg-neutral-700" />
                    <div className="flex-1 flex flex-col justify-center py-2 px-4 min-w-0">
                        <h3 className="text-sm font-bold leading-tight mb-0.5 text-slate-900 dark:text-white truncate">{holiday.name}</h3>
                        <div className="flex items-center gap-1.5">
                            <div className={`px-2 py-0.5 rounded-full ${typeColor}`}>
                                <span className={`text-[8px] font-bold uppercase tracking-wider ${typeText}`}>{dayName}</span>
                            </div>
                            {getTypeBadge(holiday.type)}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <DashboardLayout role="employee">
            <div className="max-w-4xl mx-auto space-y-5">
                {/* ── Header ── */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                            <CalendarDays className="h-6 w-6 text-indigo-600" /> Holidays
                        </h1>
                        <p className="text-sm text-muted-foreground">Holiday calendar, RH quota & comp-off balance</p>
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

                {/* ── Sticky Stat Cards ── */}
                <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm -mx-2 px-2 pt-2 pb-3 rounded-b-xl">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Next Holiday */}
                        <Card className="border-0 bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg">
                            <CardContent className="pt-4 pb-4">
                                {nextHoliday ? (
                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <PartyPopper className="h-4 w-4 opacity-80" />
                                            <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">Next Holiday</span>
                                        </div>
                                        <p className="text-lg font-bold leading-tight truncate">{nextHoliday.name}</p>
                                        <p className="text-xs opacity-90">{format(new Date(nextHoliday.holiday_date), 'EEE, d MMM yyyy')}</p>
                                        <div className="flex items-center gap-1.5">
                                            <Timer className="h-3.5 w-3.5" />
                                            <span className="text-sm font-black">
                                                {nextHoliday.daysUntil === 0 ? 'Today!' : nextHoliday.daysUntil === 1 ? 'Tomorrow!' : `in ${nextHoliday.daysUntil} days`}
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm opacity-80 py-2">No upcoming holidays</p>
                                )}
                            </CardContent>
                        </Card>

                        {/* RH Balance */}
                        <Card>
                            <CardContent className="pt-4 pb-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Star className="h-4 w-4 text-amber-500" />
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">RH Balance</span>
                                    </div>
                                    <div className="flex items-end gap-1">
                                        <span className="text-2xl font-black text-amber-600">{rhUsage.remaining}</span>
                                        <span className="text-xs text-muted-foreground mb-1">/ {rhUsage.total} left</span>
                                    </div>
                                    <div className="w-full bg-amber-100 dark:bg-amber-900/30 rounded-full h-1.5">
                                        <div className="bg-amber-500 rounded-full h-1.5 transition-all" style={{ width: `${rhUsage.total > 0 ? ((rhUsage.total - rhUsage.remaining) / rhUsage.total) * 100 : 0}%` }} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Comp-Off Balance */}
                        <Card>
                            <CardContent className="pt-4 pb-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Gift className="h-4 w-4 text-emerald-500" />
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Comp-Off</span>
                                    </div>
                                    <div className="flex items-end gap-1">
                                        <span className="text-2xl font-black text-emerald-600">{compOffSummary.available}</span>
                                        <span className="text-xs text-muted-foreground mb-1">days available</span>
                                    </div>
                                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                                        <span>{compOffSummary.used} used</span>
                                        <span>{compOffSummary.expired} expired</span>
                                    </div>
                                    {compOffSummary.nearestExpiry && (
                                        <p className="text-[10px] text-orange-500 flex items-center gap-1">
                                            <Clock className="h-3 w-3" /> Expiry: {format(new Date(compOffSummary.nearestExpiry.expiry_date), 'd MMM')}
                                        </p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* ── Tab Toggle + RH Toggle ── */}
                <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                        <button
                            onClick={() => setTab('timeline')}
                            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full border transition-all ${tab === 'timeline'
                                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                                : 'bg-white dark:bg-neutral-800 text-slate-600 dark:text-neutral-400 border-slate-200 dark:border-neutral-700 hover:bg-slate-100 dark:hover:bg-neutral-700'
                                }`}
                        >
                            <LayoutList className="h-3.5 w-3.5" /> Timeline
                        </button>
                        <button
                            onClick={() => setTab('calendar')}
                            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full border transition-all ${tab === 'calendar'
                                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                                : 'bg-white dark:bg-neutral-800 text-slate-600 dark:text-neutral-400 border-slate-200 dark:border-neutral-700 hover:bg-slate-100 dark:hover:bg-neutral-700'
                                }`}
                        >
                            <CalendarDays className="h-3.5 w-3.5" /> Calendar
                        </button>
                    </div>
                    {tab === 'timeline' && (
                        <button
                            onClick={() => setShowRH(!showRH)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-full border transition-all ${showRH
                                ? 'bg-amber-500 text-white border-amber-500'
                                : 'bg-white dark:bg-neutral-800 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                }`}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            RH {showRH ? 'ON' : 'OFF'}
                        </button>
                    )}
                </div>

                {/* ══════════════════════════════════════ */}
                {/* ── CALENDAR VIEW ── */}
                {/* ══════════════════════════════════════ */}
                {tab === 'calendar' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* ── Left Column: Calendar + Closed Holidays ── */}
                        <div className="space-y-4">
                            {/* Mini Calendar */}
                            <Card>
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
                                                        ${holiday && !isToday && holiday.type === 'NH' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 font-semibold' : ''}
                                                        ${holiday && !isToday && holiday.type === 'CH' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-semibold' : ''}
                                                        ${holiday && !isToday && holiday.type === 'RH' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 font-semibold' : ''}
                                                    `}
                                                    title={holiday ? `${holiday.name} (${holiday.type})` : undefined}
                                                >
                                                    {day || ''}
                                                    {holiday && (
                                                        <div className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${isToday ? 'bg-white' : (TYPE_DOT[holiday.type] || 'bg-gray-400')}`} />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> NH</span>
                                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> CH</span>
                                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> RH</span>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Closed Holidays */}
                            <Card>
                                <CardHeader className="py-2.5 px-4 bg-blue-50/50 dark:bg-blue-900/10">
                                    <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                                        Closed Holidays ({closed.length})
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-4 py-2">
                                    <div className="divide-y">
                                        {closed.map((h) => (
                                            <div key={h.id} className="py-2 flex justify-between items-center">
                                                <div>
                                                    <p className="text-sm font-medium">{h.name}</p>
                                                    <p className="text-xs text-muted-foreground">{format(new Date(h.holiday_date), 'EEEE, d MMM')}</p>
                                                </div>
                                                {getTypeBadge('CH')}
                                            </div>
                                        ))}
                                        {closed.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No closed holidays</p>}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* ── Right Column: National + Restricted Holidays ── */}
                        <div className="space-y-4">
                            {/* National */}
                            <Card>
                                <CardHeader className="py-2.5 px-4 bg-red-50/50 dark:bg-red-900/10">
                                    <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-red-500" />
                                        National Holidays ({national.length})
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-4 py-2">
                                    <div className="divide-y">
                                        {national.map((h) => (
                                            <div key={h.id} className="py-2 flex justify-between items-center">
                                                <div>
                                                    <p className="text-sm font-medium">{h.name}</p>
                                                    <p className="text-xs text-muted-foreground">{format(new Date(h.holiday_date), 'EEEE, d MMM')}</p>
                                                </div>
                                                {getTypeBadge('NH')}
                                            </div>
                                        ))}
                                        {national.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No national holidays</p>}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Restricted */}
                            <Card>
                                <CardHeader className="py-2.5 px-4 bg-amber-50/50 dark:bg-amber-900/10">
                                    <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                                        Restricted Holidays ({restricted.length})
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-4 py-2">
                                    <div className="divide-y">
                                        {restricted.map((h) => (
                                            <div key={h.id} className="py-2 flex justify-between items-center">
                                                <div>
                                                    <p className="text-sm font-medium">{h.name}</p>
                                                    <p className="text-xs text-muted-foreground">{format(new Date(h.holiday_date), 'EEEE, d MMM')}</p>
                                                </div>
                                                {getTypeBadge('RH')}
                                            </div>
                                        ))}
                                        {restricted.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No restricted holidays</p>}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════ */}
                {/* ── TIMELINE VIEW ── */}
                {/* ══════════════════════════════════════ */}
                {tab === 'timeline' && (
                    <div className="relative pb-8">
                        <div className="absolute left-[3px] top-0 bottom-0 w-[1px] bg-slate-200 dark:bg-neutral-800" />

                        {/* Today */}
                        <div className="relative pl-8 mb-8 flex items-center">
                            <div className="absolute -left-[5px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-indigo-500 ring-4 ring-indigo-500/20 z-10" />
                            <div className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800/30 flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">
                                    Today • {format(today, 'dd MMM yyyy')}
                                </span>
                            </div>
                        </div>

                        {/* Upcoming */}
                        {upcomingGroups.map(([monthKey, items], groupIdx) => {
                            const [, monthStr] = monthKey.split('-');
                            const monthName = format(new Date(parseInt(monthKey), parseInt(monthStr) - 1), 'MMMM').toUpperCase();
                            return (
                                <div key={monthKey} className="pb-8 relative pl-8">
                                    <div className="sticky top-[200px] z-20 flex items-center py-2 relative mb-3 bg-background/95 backdrop-blur-sm -mx-2 px-2 rounded-lg">
                                        <div className="absolute -left-[31px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500 ring-4 ring-white dark:ring-neutral-950" />
                                        <span className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-[0.15em]">
                                            {monthName} <span className="mx-1 text-slate-300 dark:text-neutral-700">/</span> {items.length} {items.length === 1 ? 'HOLIDAY' : 'HOLIDAYS'}
                                        </span>
                                    </div>
                                    <div className="space-y-3">
                                        {items.map((h: any, idx: number) => (
                                            <TimelineCard key={h.id} holiday={h} isNext={!showRH && groupIdx === 0 && idx === 0 && !!nextHoliday} />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}

                        {upcomingGroups.length === 0 && pastHolidays.length === 0 && (
                            <div className="py-12 text-center pl-8">
                                <CalendarDays className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                                <p className="text-sm font-medium text-slate-500">No holidays found</p>
                            </div>
                        )}

                        {/* Past */}
                        {pastHolidays.length > 0 && (
                            <div className="relative mt-4 bg-slate-100/50 dark:bg-black/20 -mx-4 px-4 pt-6 pb-6 border-t border-slate-200 dark:border-neutral-800/50 rounded-b-xl">
                                <div className="absolute left-[7px] top-0 bottom-0 w-[1px] bg-slate-300 dark:bg-neutral-800" />
                                <div className="flex items-center justify-end pb-4">
                                    <button onClick={() => setShowPast(!showPast)} className="flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest hover:underline">
                                        ({pastHolidays.length} Past Holidays) {showPast ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    </button>
                                </div>
                                {showPast && pastGroups.map(([monthKey, items]) => {
                                    const [, monthStr] = monthKey.split('-');
                                    const monthName = format(new Date(parseInt(monthKey), parseInt(monthStr) - 1), 'MMMM').toUpperCase();
                                    return (
                                        <div key={monthKey} className="pb-6 relative pl-8">
                                            <div className="flex items-center relative mb-3">
                                                <div className="absolute -left-[31px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-slate-400 dark:bg-neutral-600 ring-4 ring-slate-100/80 dark:ring-neutral-900/80" />
                                                <span className="text-xs font-bold text-slate-500 dark:text-neutral-400 uppercase tracking-[0.15em]">
                                                    {monthName} <span className="mx-1 text-slate-300 dark:text-neutral-700">/</span> {items.length} {items.length === 1 ? 'HOLIDAY' : 'HOLIDAYS'}
                                                </span>
                                            </div>
                                            <div className="space-y-3 opacity-60">{items.map((h: any) => <TimelineCard key={h.id} holiday={h} isNext={false} />)}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
