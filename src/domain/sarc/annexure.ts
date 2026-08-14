/**
 * Annexure-2 assembly (§1.5).
 *
 * The statement carries only the three figures an employee can be asked about:
 * what they owed, what they performed, and the shortfall. Everything used to
 * derive them stays on the `SarcRow` so the UI can show its working — the
 * sheet's worst property was that no figure could be traced back to the days
 * that produced it.
 */

import { annexureTitle } from './period';
import type {
    AnnexureReport,
    AnnexureRow,
    SarcPeriod,
    SarcRow,
} from './types';

function toAnnexureRow(row: SarcRow): AnnexureRow {
    return {
        empId: row.empId,
        name: row.name,
        designation: row.designation,
        requirement: row.requirement,
        performed: row.performed,
        recovery: row.recovery,
    };
}

/**
 * Split evaluated rows into the statement and the employees held back by the
 * master-data check.
 *
 * Exclusion has never changed a number — both employees excluded in the
 * reference period were already exempt for want of a rating date (§2.11) — so
 * the excluded rows are returned rather than discarded, and the UI can show
 * who was held back and why.
 */
export function buildAnnexure(
    rows: readonly SarcRow[],
    period: SarcPeriod,
): AnnexureReport {
    return {
        title: annexureTitle(period),
        period,
        rows: rows.filter((row) => row.included).map(toAnnexureRow),
        excluded: rows.filter((row) => !row.included),
    };
}

export interface AnnexureSummary {
    /** Rows on the statement. */
    total: number;
    /** Rows carrying a requirement — the rest are exempt. */
    withRequirement: number;
    /** Rows whose performed hours fall short. */
    inRecovery: number;
    /** Mean recovery across rows with a requirement, 0–1. */
    meanRecovery: number;
    /**
     * Hours owed and hours performed, both across **employees carrying a
     * requirement**. Deliberately the same population, so the difference
     * between them is the aggregate shortfall and nothing else; totalling
     * performed hours over exempt employees too would make the pair look
     * subtractable while quietly not being.
     */
    totalRequirement: number;
    totalPerformed: number;
}

export function summariseAnnexure(report: AnnexureReport): AnnexureSummary {
    const withRequirement = report.rows.filter(
        (row) => row.requirement != null && row.requirement > 0,
    );

    const recoverySum = withRequirement.reduce(
        (sum, row) => sum + (row.recovery ?? 0),
        0,
    );

    return {
        total: report.rows.length,
        withRequirement: withRequirement.length,
        inRecovery: withRequirement.filter((row) => (row.recovery ?? 0) > 0).length,
        meanRecovery: withRequirement.length ? recoverySum / withRequirement.length : 0,
        totalRequirement: withRequirement.reduce((sum, row) => sum + (row.requirement ?? 0), 0),
        totalPerformed: withRequirement.reduce((sum, row) => sum + (row.performed ?? 0), 0),
    };
}
