import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';
import { format, differenceInDays, startOfDay } from 'date-fns';

// ---------- Types ----------

export interface Holiday {
    id: string;
    name: string;
    holiday_date: string;
    type: 'NH' | 'RH' | 'CH';
    year: number;
    station: string;
    selectable: boolean;
    comp_off_eligible: boolean;
    created_by: string;
    created_at: string;
}

export interface CompOffEntry {
    id: string;
    employee_id: string;
    holiday_id: string;
    duty_date: string;
    days_granted: number;
    expiry_date: string;
    status: 'available' | 'used' | 'expired';
    used_leave_id: string | null;
    created_at: string;
    holiday?: Holiday;
}

// ---------- Holiday Queries ----------

/** Fetch all holidays for a given year */
export function useHolidaysByYear(year: number) {
    return useQuery({
        queryKey: ['holidays', year],
        queryFn: async () => {
            const startDate = `${year}-01-01`;
            const endDate = `${year}-12-31`;
            const { data, error } = await supabase
                .from('holidays')
                .select('*')
                .gte('holiday_date', startDate)
                .lte('holiday_date', endDate)
                .order('holiday_date', { ascending: true });
            if (error) throw error;
            return (data || []) as unknown as Holiday[];
        },
        staleTime: 30 * 60 * 1000,
        gcTime: 60 * 60 * 1000,
    });
}

/** Derived: next upcoming holiday */
export function useNextHoliday(holidays: Holiday[]) {
    return useMemo(() => {
        const today = startOfDay(new Date());
        const upcoming = holidays
            .filter((h) => h.type !== 'RH' && new Date(h.holiday_date) >= today)
            .sort((a, b) => new Date(a.holiday_date).getTime() - new Date(b.holiday_date).getTime());
        if (upcoming.length === 0) return null;
        const next = upcoming[0];
        const daysUntil = differenceInDays(new Date(next.holiday_date), today);
        return { ...next, daysUntil };
    }, [holidays]);
}

/** Derived: holidays grouped by type (NH/RH/CH) */
export function useHolidaysByType(holidays: Holiday[]) {
    return useMemo(() => {
        const national = holidays.filter((h) => h.type === 'NH');
        const closed = holidays.filter((h) => h.type === 'CH');
        const restricted = holidays.filter((h) => h.type === 'RH');
        return { national, closed, restricted };
    }, [holidays]);
}

/** Derived: holidays grouped by month for calendar view */
export function useHolidaysByMonth(holidays: Holiday[]) {
    return useMemo(() => {
        const map = new Map<string, Holiday[]>();
        holidays.forEach((h) => {
            const monthKey = format(new Date(h.holiday_date), 'yyyy-MM');
            if (!map.has(monthKey)) map.set(monthKey, []);
            map.get(monthKey)!.push(h);
        });
        return map;
    }, [holidays]);
}

// ---------- Comp-Off Queries ----------

/** Fetch comp-off ledger for current user */
export function useCompOffBalance(userId?: string) {
    return useQuery({
        queryKey: ['comp-off-ledger', userId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('comp_off_ledger' as any)
                .select('*')
                .eq('employee_id', userId!)
                .order('duty_date', { ascending: false });
            if (error) throw error;
            const entries = (data || []) as unknown as CompOffEntry[];

            // Collect unique holiday IDs to resolve holiday info
            const holidayIds = new Set<string>();
            for (const e of entries) {
                if (e.holiday_id) holidayIds.add(e.holiday_id);
            }

            let holidayMap: Record<string, Holiday> = {};
            if (holidayIds.size > 0) {
                const { data: holidays } = await supabase
                    .from('holidays')
                    .select('*')
                    .in('id', Array.from(holidayIds));
                if (holidays) {
                    for (const h of holidays as unknown as Holiday[]) {
                        holidayMap[h.id] = h;
                    }
                }
            }

            return entries.map((e) => ({
                ...e,
                holiday: e.holiday_id ? holidayMap[e.holiday_id] || undefined : undefined,
            }));
        },
        enabled: !!userId,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
    });
}

/** Derived: comp-off summary */
export function useCompOffSummary(entries: CompOffEntry[]) {
    return useMemo(() => {
        const available = entries.filter((e) => e.status === 'available');
        const used = entries.filter((e) => e.status === 'used');
        const expired = entries.filter((e) => e.status === 'expired');
        const totalAvailable = available.reduce((sum, e) => sum + e.days_granted, 0);
        const totalUsed = used.reduce((sum, e) => sum + e.days_granted, 0);
        const totalExpired = expired.reduce((sum, e) => sum + e.days_granted, 0);
        const nearestExpiry = available
            .filter((e) => e.expiry_date)
            .sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime())[0];
        return { available: totalAvailable, used: totalUsed, expired: totalExpired, nearestExpiry, entries: available };
    }, [entries]);
}

/** Derived: RH usage for the year */
export function useRHUsage(holidays: Holiday[], leaveBalances: any[] | undefined) {
    return useMemo(() => {
        const totalRH = holidays.filter((h) => h.type === 'RH').length;
        const rhBalance = leaveBalances?.find((b: any) => b.leave_type === 'rh');
        const usedRH = rhBalance ? (rhBalance.balance <= 0 ? totalRH : totalRH - rhBalance.balance) : 0;
        return { total: Math.min(totalRH, 2), used: Math.max(0, usedRH), remaining: rhBalance?.balance ?? 2 };
    }, [holidays, leaveBalances]);
}
