/**
 * Block detection (§1.3).
 *
 * A block is a maximal run of one duty type. The run survives bridging and
 * skipped days and terminates on a duty of the *other* type, so a general run
 * and a shift run can never overlap — which is what makes "which rate does
 * this leave day take" always answerable: a bridging day sits inside at most
 * one span.
 *
 * A block qualifies at five duties *of its own type*, counted as duties rather
 * than calendar days. `G G G · L L L · G G` is five general duties and
 * qualifies; the three leave days bridge it without counting.
 */

import type { DayClass, DutyBlock } from './types';

/** Duties of one type needed before a block sets a rate. */
export const QUALIFYING_DUTY_COUNT = 5;

const DUTY_TYPES = ['general', 'shift'] as const;

/**
 * All blocks in the period, ordered by start index.
 *
 * A block's span is `[startIndex, endIndex]` — first duty of its type to last.
 * Trailing bridging days fall outside the span, which is why they draw the
 * home rate rather than the block's.
 */
export function detectBlocks(classes: readonly DayClass[]): DutyBlock[] {
    const blocks: DutyBlock[] = [];

    for (const type of DUTY_TYPES) {
        let index = 0;
        while (index < classes.length) {
            if (classes[index] !== type) {
                index += 1;
                continue;
            }

            let dutyCount = 0;
            let endIndex = index;
            let cursor = index;

            while (cursor < classes.length) {
                const dayClass = classes[cursor];
                if (dayClass === type) {
                    dutyCount += 1;
                    endIndex = cursor;
                } else if (dayClass !== 'bridging' && dayClass !== 'skipped') {
                    break; // a duty of the other type ends the run
                }
                cursor += 1;
            }

            blocks.push({
                type,
                startIndex: index,
                endIndex,
                dutyCount,
                qualifies: dutyCount >= QUALIFYING_DUTY_COUNT,
            });

            index = endIndex + 1;
        }
    }

    return blocks.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Which qualifying span covers each day, or null outside them all.
 *
 * Only qualifying blocks are projected — a run of four general duties leaves
 * its days on the home rate.
 */
export function resolveSpans(
    blocks: readonly DutyBlock[],
    length: number,
): (('general' | 'shift') | null)[] {
    const spans: (('general' | 'shift') | null)[] = new Array(length).fill(null);

    for (const block of blocks) {
        if (!block.qualifies) continue;
        for (let i = block.startIndex; i <= block.endIndex && i < length; i += 1) {
            spans[i] = block.type;
        }
    }

    return spans;
}

export function hasQualifyingBlock(
    blocks: readonly DutyBlock[],
    type: 'general' | 'shift',
): boolean {
    return blocks.some((block) => block.type === type && block.qualifies);
}
