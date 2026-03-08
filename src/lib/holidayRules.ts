import { format, eachDayOfInterval, parseISO } from 'date-fns';

export interface HolidayInfo {
    id: string;
    holiday_name: string;
    holiday_date: string;
    category: 'closed' | 'reserved' | 'national';
    comp_off_eligible: boolean;
}

export interface HolidayConflict {
    date: string;
    holiday: HolidayInfo;
    type: 'block' | 'warn';
    message: string;
}

/**
 * Check if a specific date falls on a holiday.
 */
export function isHoliday(date: Date, holidays: HolidayInfo[]): HolidayInfo | null {
    const dateStr = format(date, 'yyyy-MM-dd');
    return holidays.find((h) => h.holiday_date === dateStr) || null;
}

/**
 * Validate a leave date range against the holiday calendar.
 * Returns a list of conflicts:
 * - National Holiday (NH) → block: "Leave not required"
 * - Closed Holiday (CH) → block: "Office closed"
 * - Restricted Holiday (RH) → warn: counts against RH quota
 */
export function validateLeaveAgainstHolidays(
    startDate: Date,
    endDate: Date,
    holidays: HolidayInfo[]
): HolidayConflict[] {
    const conflicts: HolidayConflict[] = [];
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    for (const day of days) {
        const holiday = isHoliday(day, holidays);
        if (!holiday) continue;

        const dateStr = format(day, 'yyyy-MM-dd');

        switch (holiday.category) {
            case 'national':
                conflicts.push({
                    date: dateStr,
                    holiday,
                    type: 'block',
                    message: `${holiday.holiday_name} (${format(day, 'd MMM')}) is a National Holiday — leave not required.`,
                });
                break;
            case 'closed':
                conflicts.push({
                    date: dateStr,
                    holiday,
                    type: 'block',
                    message: `${holiday.holiday_name} (${format(day, 'd MMM')}) is a Closed Holiday — office is closed.`,
                });
                break;
            case 'reserved':
                conflicts.push({
                    date: dateStr,
                    holiday,
                    type: 'warn',
                    message: `${holiday.holiday_name} (${format(day, 'd MMM')}) is a Restricted Holiday — will be deducted from your RH quota.`,
                });
                break;
        }
    }

    return conflicts;
}

/**
 * Count how many leave days actually "count" after removing NH/CH holidays.
 */
export function getEffectiveLeaveDays(
    startDate: Date,
    endDate: Date,
    holidays: HolidayInfo[]
): { total: number; effective: number; holidayDays: number } {
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const total = days.length;
    let holidayDays = 0;

    for (const day of days) {
        const holiday = isHoliday(day, holidays);
        if (holiday && (holiday.category === 'national' || holiday.category === 'closed')) {
            holidayDays++;
        }
    }

    return { total, effective: total - holidayDays, holidayDays };
}
