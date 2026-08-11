import { Badge } from '@/components/ui/badge';
import {
    getTraineeStatusBadgeClass,
    getTraineeStatusLabel,
} from '@/lib/traineeMilestones';
import type { TraineeStatus } from '@/lib/traineeMilestones';

import { formatOjtDate } from './formatOjtDate';

/**
 * The pre-board / board milestone carried over from Trainee Details.
 *
 * Renders nothing when there is no status. 'training_continue' never reaches
 * here — get_ojt_progress_records() filters it out server-side, since "still
 * training" is not a milestone a supervisor can act on.
 */
export function TraineeMilestoneChip({
    status,
    date,
    className = '',
}: {
    status: string | null | undefined;
    date: string | null | undefined;
    className?: string;
}) {
    if (!status) return null;

    return (
        <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
            <Badge
                variant="outline"
                className={`rounded-full text-[10px] font-medium ${getTraineeStatusBadgeClass(status as TraineeStatus)}`}
            >
                {getTraineeStatusLabel(status as TraineeStatus)}
            </Badge>
            {date && (
                <span className="text-[10px] text-muted-foreground">{formatOjtDate(date)}</span>
            )}
        </span>
    );
}
