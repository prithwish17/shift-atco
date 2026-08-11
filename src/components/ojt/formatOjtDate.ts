import { format } from 'date-fns';

import { parseIsoDate } from '@/domain/ojt';

/** ISO `YYYY-MM-DD` → `dd MMM yyyy`, matching formatTraineeDate elsewhere. */
export function formatOjtDate(value: string | null | undefined): string {
    const parsed = parseIsoDate(value);
    if (!parsed) return value || '—';
    return format(parsed, 'dd MMM yyyy');
}
