import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';
import { format, differenceInDays, startOfDay } from 'date-fns';

// ---------- Types ----------

export interface Holiday {
    id: string;
    holiday_name: string;
    holiday_date: string;
    category: 'closed' | 'reserved' | 'national';
    comp_off_eligible: boolean;
    is_optional?: boolean;
    year?: number;
    region?: string;
    created_by: string;
    created_at: string;
    updated_at: string;
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
            return (data || []) as Holiday[];
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
            .filter((h) => new Date(h.holiday_date) >= today)
            .sort((a, b) => new Date(a.holiday_date).getTime() - new Date(b.holiday_date).getTime());
        if (upcoming.length === 0) return null;
        const next = upcoming[0];
        const daysUntil = differenceInDays(new Date(next.holiday_date), today);
        return { ...next, daysUntil };
    }, [holidays]);
}

/** Derived: holidays grouped by category */
export function useHolidaysByCategory(holidays: Holiday[]) {
    return useMemo(() => {
        const national = holidays.filter((h) => h.category === 'national');
        const closed = holidays.filter((h) => h.category === 'closed');
        const restricted = holidays.filter((h) => h.category === 'reserved');
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
                .select('*, holiday:holiday_id(*)')
                .eq('employee_id', userId!)
                .order('duty_date', { ascending: false });
            if (error) throw error;
            return (data || []) as unknown as CompOffEntry[];
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
        // Nearest expiry
        const nearestExpiry = available
            .filter((e) => e.expiry_date)
            .sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime())[0];
        return { available: totalAvailable, used: totalUsed, expired: totalExpired, nearestExpiry, entries: available };
    }, [entries]);
}

/** Derived: RH usage for the year */
export function useRHUsage(holidays: Holiday[], leaveBalances: any[] | undefined) {
    return useMemo(() => {
        const totalRH = holidays.filter((h) => h.category === 'reserved').length;
        const rhBalance = leaveBalances?.find((b: any) => b.leave_type === 'rh');
        const usedRH = rhBalance ? (rhBalance.balance <= 0 ? totalRH : totalRH - rhBalance.balance) : 0;
        return { total: Math.min(totalRH, 2), used: Math.max(0, usedRH), remaining: rhBalance?.balance ?? 2 };
    }, [holidays, leaveBalances]);
}
