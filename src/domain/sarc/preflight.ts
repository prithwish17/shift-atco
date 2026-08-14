/**
 * Dataset-level validation, run before the engine.
 *
 * The engine's own warnings are per-employee: this file catches the problems
 * that only show up across the whole roster — an IAMATC extract for the wrong
 * period, a schedule sync that half-ran, duplicate employee IDs.
 *
 * Nothing here blocks calculation. The sheet's failure mode was that bad data
 * silently became a number; the fix is to compute anyway and put the problem
 * where an operator can see it, not to refuse.
 */

import { isKnownDutyCode, normaliseDutyCode } from './codes';
import { enumeratePeriodDates } from './period';
import type { SarcInput } from './types';

export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightFinding {
    /** Stable identifier, for tests and for suppressing a known-accepted finding. */
    code: string;
    severity: PreflightSeverity;
    message: string;
    /** Employees the finding concerns, when it concerns specific ones. */
    empIds: string[];
}

export interface PreflightOptions {
    /** Employee IDs present in the imported IAMATC extract, for orphan detection. */
    iamatcEmpIds?: readonly string[];
}

export function preflight(
    input: SarcInput,
    options: PreflightOptions = {},
): PreflightFinding[] {
    const findings: PreflightFinding[] = [];
    const add = (
        code: string,
        severity: PreflightSeverity,
        message: string,
        empIds: string[] = [],
    ) => findings.push({ code, severity, message, empIds });

    const { employees, period } = input;
    const dates = enumeratePeriodDates(period);
    const totalDays = dates.length;

    if (employees.length === 0) {
        add('empty-roster', 'error', 'No employees found for this period.');
        return findings;
    }

    /* ── Identity ─────────────────────────────────────────────────────────── */

    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const employee of employees) {
        if (seen.has(employee.empId)) duplicates.add(employee.empId);
        seen.add(employee.empId);
    }
    if (duplicates.size > 0) {
        add(
            'duplicate-emp-id',
            'error',
            `${duplicates.size} employee ID${duplicates.size > 1 ? 's appear' : ' appears'} more than once. Each would be evaluated twice.`,
            [...duplicates],
        );
    }

    /* ── Roster coverage ──────────────────────────────────────────────────── */

    const noRoster: string[] = [];
    const partialRoster: string[] = [];
    const unknownCodes = new Map<string, number>();
    const outOfPeriod: string[] = [];

    for (const employee of employees) {
        let covered = 0;
        for (const [date, code] of Object.entries(employee.dutyCodes)) {
            if (!dates.includes(date)) {
                if (!outOfPeriod.includes(employee.empId)) outOfPeriod.push(employee.empId);
                continue;
            }
            const normalised = normaliseDutyCode(code);
            if (normalised === '') continue;
            covered += 1;
            if (!isKnownDutyCode(normalised)) {
                unknownCodes.set(normalised, (unknownCodes.get(normalised) ?? 0) + 1);
            }
        }

        if (covered === 0) noRoster.push(employee.empId);
        else if (covered < totalDays) partialRoster.push(employee.empId);
    }

    if (noRoster.length > 0) {
        add(
            'no-roster-days',
            'warning',
            `${noRoster.length} employee${noRoster.length > 1 ? 's have' : ' has'} no duty codes in this period and will accrue nothing. Check the schedule sync ran for both months.`,
            noRoster,
        );
    }
    if (partialRoster.length > 0) {
        add(
            'partial-roster',
            'info',
            `${partialRoster.length} employee${partialRoster.length > 1 ? 's are' : ' is'} on roster for only part of the period. Absent days accrue nothing, which pro-rates joiners and leavers automatically.`,
            partialRoster,
        );
    }
    if (outOfPeriod.length > 0) {
        add(
            'duty-code-outside-period',
            'warning',
            `${outOfPeriod.length} employee${outOfPeriod.length > 1 ? 's carry' : ' carries'} duty codes dated outside the period. They are ignored.`,
            outOfPeriod,
        );
    }
    if (unknownCodes.size > 0) {
        const summary = [...unknownCodes.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => `${code} (${count})`)
            .join(', ');
        add(
            'unknown-duty-code',
            'warning',
            `Unrecognised duty codes, charged as shift duty: ${summary}. Add them to the code table if that is wrong.`,
        );
    }

    /* ── Team ─────────────────────────────────────────────────────────────── */

    const noTeam = employees.filter((e) => !(e.team ?? '').trim()).map((e) => e.empId);
    if (noTeam.length > 0) {
        add(
            'no-team',
            'warning',
            `${noTeam.length} employee${noTeam.length > 1 ? 's have' : ' has'} no roster team and defaults to the shift rate. The team sets the home rate, so a wrong default moves hours.`,
            noTeam,
        );
    }

    /* ── Rating and endorsement dates ─────────────────────────────────────── */

    // Both dates gate the requirement: the rating date anchors the proration,
    // the endorsement date decides eligibility. Either one missing means the
    // employee carries no requirement at all.
    const noJoiningDate = employees.filter((e) => !e.kolkataJoiningDate);
    if (noJoiningDate.length > 0) {
        add(
            'no-kolkata-joining-date',
            'error',
            `${noJoiningDate.length} employee${noJoiningDate.length > 1 ? 's have' : ' has'} no Kolkata joining date, so no rating of theirs can be confirmed as earned here and they carry no requirement. That is a gap in the ATCO master sync, not an exemption — run fetch-atco-master before issuing.`,
            noJoiningDate.map((e) => e.empId),
        );
    }

    const ratedElsewhereOnly = employees.filter(
        (e) => e.kolkataJoiningDate && !e.oldestRatingDate && e.oldestRatingDateAnyStation,
    );
    if (ratedElsewhereOnly.length > 0) {
        add(
            'rated-before-joining-kolkata',
            'info',
            `${ratedElsewhereOnly.length} employee${ratedElsewhereOnly.length > 1 ? 's hold' : ' holds'} a rating earned before joining Kolkata and none since, so no requirement is raised.`,
            ratedElsewhereOnly.map((e) => e.empId),
        );
    }

    const noRating = employees.filter(
        (e) => !e.oldestRatingDate && e.kolkataJoiningDate && !e.oldestRatingDateAnyStation,
    );
    const ratedNotEndorsed = employees.filter(
        (e) => e.oldestRatingDate && !e.oldestEndorsementDate,
    );
    const exemptCount = noRating.length + ratedNotEndorsed.length;

    if (noRating.length > 0) {
        add(
            'exempt-no-rating',
            'info',
            `${noRating.length} of ${employees.length} employees have no rating date on file and carry no requirement.`,
            noRating.map((e) => e.empId),
        );
    }

    if (ratedNotEndorsed.length > 0) {
        add(
            'rated-not-endorsed',
            'warning',
            `${ratedNotEndorsed.length} employee${ratedNotEndorsed.length > 1 ? 's are' : ' is'} rated but ${ratedNotEndorsed.length > 1 ? 'have' : 'has'} no endorsement date, so no requirement is raised for them. Nobody on the reference roster was in that state, so check the endorsement is genuinely outstanding rather than missing from the rating sync.`,
            ratedNotEndorsed.map((e) => e.empId),
        );
    }

    // Some exemptions are normal — trainees and the unrated. Nearly all of them
    // is not policy, it is a broken rating sync, and it presents as a statement
    // where nobody owes anything and every recovery reads zero.
    if (employees.length > 0 && exemptCount / employees.length >= 0.9) {
        const percent = Math.round((exemptCount / employees.length) * 100);
        add(
            'almost-everyone-exempt',
            'error',
            `${exemptCount} of ${employees.length} employees (${percent}%) carry no requirement, so every recovery will read zero. That is far more than expected — check employee_training_records.rating_data holds both rating_date and endorsement_date, and that fetch-rating-data has run.`,
        );
    }

    /* ── IAMATC extract ───────────────────────────────────────────────────── */

    const missingPerformed = employees
        .filter((e) => e.performed == null && e.oldestRatingDate && e.oldestEndorsementDate)
        .map((e) => e.empId);
    if (missingPerformed.length > 0) {
        add(
            'missing-from-extract',
            'error',
            `${missingPerformed.length} employee${missingPerformed.length > 1 ? 's carry' : ' carries'} a requirement but ${missingPerformed.length > 1 ? 'are' : 'is'} absent from the IAMATC extract. Recovery cannot be computed for them — check the extract covers this period.`,
            missingPerformed,
        );
    }

    if (options.iamatcEmpIds) {
        const roster = new Set(employees.map((e) => e.empId));
        const orphans = [...new Set(options.iamatcEmpIds)].filter((id) => !roster.has(id));
        if (orphans.length > 0) {
            add(
                'extract-orphan',
                'warning',
                `${orphans.length} row${orphans.length > 1 ? 's' : ''} in the IAMATC extract match no employee on this roster and are ignored.`,
                orphans,
            );
        }
    }

    return findings;
}

/** True when nothing blocks issuing the statement. */
export function isPreflightClean(findings: readonly PreflightFinding[]): boolean {
    return !findings.some((finding) => finding.severity === 'error');
}
