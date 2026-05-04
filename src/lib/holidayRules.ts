import { format, eachDayOfInterval } from 'date-fns';

export interface HolidayInfo {
    id: string;
    name: string;
    holiday_date: string;
    type: 'NH' | 'RH' | 'CH';
    comp_off_eligible: boolean;
}

export interface HolidayConflict {
    date: string;
    holiday: HolidayInfo;
    type: 'warn';
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
 * Holiday dates are surfaced as informational notices so employees can make an informed choice before submitting.
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

        switch (holiday.type) {
            case 'NH':
                conflicts.push({
                    date: dateStr,
                    holiday,
                    type: 'warn',
                    message: `${holiday.name} (${format(day, 'd MMM')}) is a National Holiday within the selected dates.`,
                });
                break;
            case 'CH':
                conflicts.push({
                    date: dateStr,
                    holiday,
                    type: 'warn',
                    message: `${holiday.name} (${format(day, 'd MMM')}) is a Closed Holiday within the selected dates.`,
                });
                break;
            case 'RH':
                conflicts.push({
                    date: dateStr,
                    holiday,
                    type: 'warn',
                    message: `${holiday.name} (${format(day, 'd MMM')}) is a Restricted Holiday within the selected dates.`,
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
        if (holiday && (holiday.type === 'NH' || holiday.type === 'CH')) {
            holidayDays++;
        }
    }

    return { total, effective: total - holidayDays, holidayDays };
}
