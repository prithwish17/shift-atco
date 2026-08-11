import { Link } from 'react-router-dom';
import { ChevronRight, TimerReset } from 'lucide-react';

import {
    formatDaysLeft, formatOjtHours, formatOjtRatio,
    getOjtBandClass, getOjtBandLabel, getOjtCompletionPercent, getOjtRatioTextClass,
} from '@/domain/ojt';
import { useMyOjtProgress } from '@/hooks/useMyOjtProgress';

import { GmExtensionAlert } from './GmExtensionAlert';
import { formatOjtDate } from './formatOjtDate';

/**
 * Compact OJT summary for the employee dashboard.
 *
 * Renders nothing at all for employees who are not marked for OJT, so it can be
 * dropped into the dashboard unconditionally.
 */
export function OjtDashboardSummary() {
    const { data: records = [], isLoading } = useMyOjtProgress();

    if (isLoading || records.length === 0) return null;

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900 md:p-6">
            <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
                    <TimerReset className="size-4" />
                    <span className="text-sm font-semibold md:text-[15px]">OJT Progress</span>
                </div>
                <Link
                    to="/employee/ojt-progress"
                    className="inline-flex items-center gap-0.5 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                    View details
                    <ChevronRight className="size-3.5" />
                </Link>
            </div>

            <div className="space-y-3">
                {records.map((record) => {
                    const percent = getOjtCompletionPercent(record.requiredHours, record.performedHours);

                    return (
                        <div key={`${record.empId}|${record.unit}`} className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {record.unit}
                                    </span>
                                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${getOjtBandClass(record.band)}`}>
                                        {getOjtBandLabel(record.band)}
                                    </span>
                                </div>
                                {record.ratio !== null && (
                                    <span className="text-xs text-gray-600 dark:text-gray-300">
                                        <span className={`text-base font-semibold tabular-nums ${getOjtRatioTextClass(record.band)}`}>
                                            {formatOjtRatio(record.ratio)}
                                        </span>
                                        {' '}hrs/day needed
                                    </span>
                                )}
                            </div>

                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                                <div
                                    className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
                                    style={{ width: `${percent}%` }}
                                />
                            </div>

                            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300 md:text-xs">
                                <span className="tabular-nums">
                                    {formatOjtHours(record.performedHours)} / {formatOjtHours(record.requiredHours)} hrs
                                    {' · '}
                                    {formatOjtHours(record.hoursLeft)} left
                                </span>
                                <span>
                                    {formatOjtDate(record.deadline)} · {formatDaysLeft(record.daysLeft)}
                                </span>
                            </div>

                            {record.requiresGmExtension && (
                                <GmExtensionAlert progress={record} audience="employee" />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
