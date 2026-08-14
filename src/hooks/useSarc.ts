/**
 * Stress Allowance Recovery — data assembly and evaluation.
 *
 * The three DB-backed inputs are queried; the IAMATC extract is uploaded and
 * lives in component state, so it is passed in rather than fetched. Evaluation
 * runs on the client through the same engine the tests exercise, so the figures
 * on screen and the figures under test come from one code path.
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
    assembleEmployees,
    buildAnnexure,
    evaluate,
    isPreflightClean,
    preflight,
    summariseAnnexure,
    type AnnexureReport,
    type AnnexureSummary,
    type AssembledEmployee,
    type IamatcHours,
    type PreflightFinding,
    type SarcPeriod,
    type SarcRow,
} from '@/domain/sarc';
import {
    fetchSarcSources,
    listSarcRuns,
    saveSarcRun,
    type SarcSources,
} from '@/data-access/sarc.repository';

export const SARC_QUERY_KEYS = {
    all: ['sarc'] as const,
    sources: (start: string, end: string) => ['sarc', 'sources', start, end] as const,
    runs: () => ['sarc', 'runs'] as const,
} as const;

/**
 * Roster and rating data change slowly and the period is historical, so this
 * does not poll. A stale window of five minutes covers the case where a sync
 * lands while the page is open.
 */
const SOURCES_QUERY_OPTIONS = {
    staleTime: 300_000,
    refetchOnWindowFocus: false,
} as const;

export function useSarcSources(period: SarcPeriod | null) {
    return useQuery<SarcSources>({
        queryKey: SARC_QUERY_KEYS.sources(period?.start ?? '', period?.end ?? ''),
        queryFn: () => fetchSarcSources(period!),
        enabled: Boolean(period?.start && period?.end),
        ...SOURCES_QUERY_OPTIONS,
    });
}

export interface SarcEvaluation {
    employees: AssembledEmployee[];
    rows: SarcRow[];
    report: AnnexureReport;
    summary: AnnexureSummary;
    findings: PreflightFinding[];
    /** False when a finding is severe enough that the statement should not be issued. */
    canIssue: boolean;
}

export interface UseSarcOptions {
    period: SarcPeriod | null;
    /** Time on position, keyed by employee ID, from the uploaded extract. */
    performed: ReadonlyMap<string, IamatcHours>;
    /** Employees held back by the master-data check. */
    excluded?: ReadonlySet<string>;
}

export function useSarc({ period, performed, excluded }: UseSarcOptions) {
    const query = useSarcSources(period);
    const sources = query.data;

    const evaluation = useMemo<SarcEvaluation | null>(() => {
        if (!period || !sources) return null;

        const employees = assembleEmployees({
            roster: sources.roster,
            metadata: sources.metadata,
            performed,
            excluded,
        });

        const input = { period, employees };
        const findings = preflight(input, { iamatcEmpIds: [...performed.keys()] });
        const rows = evaluate(input);
        const report = buildAnnexure(rows, period);

        return {
            employees,
            rows,
            report,
            summary: summariseAnnexure(report),
            findings,
            canIssue: isPreflightClean(findings) && report.rows.length > 0,
        };
    }, [period, sources, performed, excluded]);

    return {
        ...query,
        evaluation,
    };
}

/* ─── Issued statements ───────────────────────────────────────────────────── */

export function useSarcRuns() {
    return useQuery({
        queryKey: SARC_QUERY_KEYS.runs(),
        queryFn: listSarcRuns,
        staleTime: 60_000,
    });
}

export function useSaveSarcRun() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: saveSarcRun,
        onSuccess: (run) => {
            queryClient.invalidateQueries({ queryKey: SARC_QUERY_KEYS.runs() });
            toast.success('Statement issued', {
                description: `${run.title} — ${run.employeeCount} employees, ${run.inRecoveryCount} in recovery.`,
            });
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Unknown error';
            toast.error('Could not issue the statement', { description: message });
        },
    });
}
