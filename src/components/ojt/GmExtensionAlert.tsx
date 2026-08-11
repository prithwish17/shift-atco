import { AlertTriangle } from 'lucide-react';

import { buildGmExtensionMessage } from '@/domain/ojt';
import type { OjtProgress } from '@/domain/ojt';
import { formatOjtDate } from './formatOjtDate';

/**
 * The GM (ATM) escalation. Rendered identically on the supervisor console and
 * the employee panel so both sides read the same instruction.
 */
export function GmExtensionAlert({
    progress,
    audience,
    className = '',
}: {
    progress: Pick<OjtProgress, 'hoursLeft' | 'daysLeft' | 'ratio' | 'deadline'>;
    audience: 'employee' | 'supervisor';
    className?: string;
}) {
    return (
        <div
            role="alert"
            className={`rounded-xl border border-rose-300 bg-rose-50 p-3 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-100 ${className}`}
        >
            <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide">
                        {audience === 'employee'
                            ? 'Action needed — request additional OJT hours'
                            : 'Extension needed — advise the trainee'}
                    </p>
                    <p className="text-[13px] leading-5">
                        {audience === 'employee' ? 'You have ' : 'They have '}
                        {buildGmExtensionMessage(progress, formatOjtDate)}
                    </p>
                </div>
            </div>
        </div>
    );
}
