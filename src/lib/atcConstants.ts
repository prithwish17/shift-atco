// ATC Duty Grid Constants
// Ported from duty-grid-master-main, adapted for forge-app

export const DEPARTMENTS = ['RSR', 'ACC-PLR', 'ACC-A'] as const;

export const ATC_DESIGNATIONS = ['SM', 'DGM', 'MGR', 'JE', 'AM', 'AGM'] as const;

export const ATC_SHIFTS = ['Morning', 'AFTERNOON', 'Night'] as const;

export const ATC_RATING_OPTIONS = [
    'RSR+UBN', 'RSR+UKN', 'RSR+UKW', 'RSR+URP', 'RSR+UBS', 'RSR+UKE', 'RSR+UGT',
    'ACC-PLR', 'ACC-A',
    'ADC', 'SMC', 'ADC/SMC',
    'APP', 'APP-A', 'CORR',
    'FMP', 'AIS', 'SAR',
    'TWR', 'CLD', 'ARO', 'MCD', 'TSO',
    'OCCN', 'OCC-S',
    'ARR+DEP', 'SEQ',
    'SMC-N', 'SMC-S',
] as const;

export type PositionRow = {
    key: string;
    label: string;
    editable: boolean;
    sectionType: 'sector' | 'flow' | 'tower' | 'info';
    sectionLabel: string;
    sectionColor: string;
    /** Number of department columns this position uses (1, 2, or 3). Defaults to 3 if omitted. */
    deptCount?: 1 | 2 | 3;
    /** If true, the "Remark" column becomes a "Reliever" employee dropdown. */
    hasReliever?: boolean;
    /** If true, this row only appears in Night shift grid. */
    nightOnly?: boolean;
};

export const POSITION_ROWS: PositionRow[] = [
    // WSO at the top — only 1 department column
    { key: 'WSO', label: 'WSO', editable: false, deptCount: 1, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },

    // Section: UNIT / Sector Operational Positions (Editable labels, with reliever)
    { key: 'UBN', label: 'UBN', editable: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'UKN', label: 'UKN', editable: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'UKW', label: 'UKW', editable: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'URP', label: 'URP', editable: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'UBS', label: 'UBS', editable: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'UKE', label: 'UKE', editable: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'UGT', label: 'UGT', editable: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'OCCN_OCC-S', label: 'OCCN & OCC-S', editable: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'SECTOR_EXTRA_1', label: '', editable: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'SECTOR_EXTRA_2', label: '', editable: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'UKN+UKW', label: 'UKN+UKW', editable: false, nightOnly: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'UGT+UKE', label: 'UGT+UKE', editable: false, nightOnly: true, hasReliever: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    // Night Relievers — only shown in Night shift
    { key: 'NIGHT Reliever-1', label: 'Night Reliever 1', editable: false, nightOnly: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    { key: 'NIGHT Reliever-2', label: 'Night Reliever 2', editable: false, nightOnly: true, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    // FMP — 2 dept columns, NO reliever (keeps remark)
    { key: 'FMP', label: 'FMP', editable: false, deptCount: 2, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },
    // WSO-ALPHA — 2 dept columns, NO reliever
    { key: 'WSO-ALPHA', label: 'WSO- ALPHA', editable: false, deptCount: 2, sectionType: 'sector', sectionLabel: 'UNIT / Sector Operational Positions', sectionColor: 'hsl(142 50% 45%)' },

    // Section: Flow & Sequencing (Fixed labels)
    { key: 'ARR+DEP_SEQ', label: 'ARR+DEP & SEQ', editable: false, sectionType: 'flow', sectionLabel: 'Flow & Sequencing', sectionColor: 'hsl(210 60% 50%)' },
    { key: 'CORR_APP-A', label: 'CORR / APP-A', editable: false, sectionType: 'flow', sectionLabel: 'Flow & Sequencing', sectionColor: 'hsl(210 60% 50%)' },

    // Section: Tower / Aerodrome (Fixed labels) — all 2 dept columns
    { key: 'TSO', label: 'TSO', editable: false, deptCount: 2, sectionType: 'tower', sectionLabel: 'Tower / Aerodrome', sectionColor: 'hsl(30 80% 55%)' },
    { key: 'TWR', label: 'TWR', editable: false, deptCount: 2, sectionType: 'tower', sectionLabel: 'Tower / Aerodrome', sectionColor: 'hsl(30 80% 55%)' },
    { key: 'CLD', label: 'CLD', editable: false, deptCount: 2, sectionType: 'tower', sectionLabel: 'Tower / Aerodrome', sectionColor: 'hsl(30 80% 55%)' },
    // SMC-N & SMC-S moved here from Flow & Sequencing — 2 dept columns
    { key: 'SMC-N_SMC-S', label: 'SMC-N & SMC-S', editable: false, deptCount: 2, sectionType: 'tower', sectionLabel: 'Tower / Aerodrome', sectionColor: 'hsl(30 80% 55%)' },
    { key: 'TWR-A/ AIMS', label: 'TWR-A/ AIMS', editable: false, deptCount: 2, sectionType: 'tower', sectionLabel: 'Tower / Aerodrome', sectionColor: 'hsl(30 80% 55%)' },
    { key: 'TOWER_EXTRA_1', label: '', editable: true, deptCount: 2, sectionType: 'tower', sectionLabel: 'Tower / Aerodrome', sectionColor: 'hsl(30 80% 55%)' },

    { key: 'AIS', label: 'AIS', editable: false, deptCount: 2, sectionType: 'info', sectionLabel: 'Information & Support', sectionColor: 'hsl(270 50% 55%)' },
    { key: 'ARO', label: 'ARO', editable: false, deptCount: 2, sectionType: 'info', sectionLabel: 'Information & Support', sectionColor: 'hsl(270 50% 55%)' },
    { key: 'MCD', label: 'MCD', editable: false, deptCount: 2, sectionType: 'info', sectionLabel: 'Information & Support', sectionColor: 'hsl(270 50% 55%)' },
    { key: 'SAR', label: 'SAR', editable: false, deptCount: 2, sectionType: 'info', sectionLabel: 'Information & Support', sectionColor: 'hsl(270 50% 55%)' },
    { key: 'INFO_EXTRA_1', label: '', editable: true, deptCount: 2, sectionType: 'info', sectionLabel: 'Information & Support', sectionColor: 'hsl(270 50% 55%)' },
];

export const EXTRA_DUTY_TYPES = ['OPE', 'Familiarization', 'Refresher', 'Other'] as const;

// ---------- Night Shift Grid Constants ----------

/** Night grid — two halves, 3 departments each */
export const NIGHT_DEPARTMENTS_N1 = ['RSR-N1', 'ACC-D-N1', 'ACC-A-N1'] as const;
export const NIGHT_DEPARTMENTS_N2 = ['RSR-N2', 'ACC-D-N2', 'ACC-A-N2'] as const;
export const ALL_NIGHT_DEPARTMENTS = [...NIGHT_DEPARTMENTS_N1, ...NIGHT_DEPARTMENTS_N2] as const;

export const NIGHT_DEPT_LABELS: Record<string, string> = {
    'RSR-N1': 'RSR (N-1)',
    'ACC-D-N1': 'ACC D (N-1)',
    'ACC-A-N1': 'ACC A (N-1)',
    'RSR-N2': 'RSR (N-2)',
    'ACC-D-N2': 'ACC D (N-2)',
    'ACC-A-N2': 'ACC A (N-2)',
};

/** Positions that show a single dropdown spanning all 3 cols per half in the night grid */
export const NIGHT_SPAN_POSITIONS = new Set([
    'CORR_APP-A', 'SMC-N_SMC-S', 'FMP', 'AIS', 'TSO', 'TWR', 'CLD', 'ARO', 'MCD',
    'WSO-ALPHA', 'TWR-A/ AIMS'
]);

/** Positions that span ALL 6 columns with a single dropdown (no N1/N2 split) */
export const NIGHT_FULL_SPAN_POSITIONS = new Set(['WSO']);

/** Positions that span ALL 6 columns with 3 separate dropdowns (no N1/N2 split) */
export const NIGHT_TRIPLE_FULL_POSITIONS = new Set(['ARR+DEP_SEQ']);

/** Department keys for triple-full positions (3 dropdowns across 6 cols) */
export const NIGHT_FULL_DEPARTMENTS = ['RSR-FULL', 'ACC-D-FULL', 'ACC-A-FULL'] as const;
