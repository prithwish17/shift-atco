// ATC Duty Grid Constants
// Ported from duty-grid-master-main, adapted for forge-app

export const DEPARTMENTS = ['RSR', 'ACC-PLR', 'ACC-A'] as const;

export const ATC_DESIGNATIONS = ['SM', 'DGM', 'MGR', 'JE', 'AM', 'AGM'] as const;

export const ATC_SHIFTS = ['Morning', 'Evening', 'Night'] as const;

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
    { key: 'MCD', label: 'MCD', editable: false, deptCount: 2, sectionType: 'tower', sectionLabel: 'Tower / Aerodrome', sectionColor: 'hsl(30 80% 55%)' },
    // SMC-N & SMC-S moved here from Flow & Sequencing — 2 dept columns
    { key: 'SMC-N_SMC-S', label: 'SMC-N & SMC-S', editable: false, deptCount: 2, sectionType: 'tower', sectionLabel: 'Tower / Aerodrome', sectionColor: 'hsl(30 80% 55%)' },

    // Section: Information & Support (Fixed labels) — all 2 dept columns
    { key: 'AIS', label: 'AIS', editable: false, deptCount: 2, sectionType: 'info', sectionLabel: 'Information & Support', sectionColor: 'hsl(270 50% 55%)' },
    { key: 'ARO', label: 'ARO', editable: false, deptCount: 2, sectionType: 'info', sectionLabel: 'Information & Support', sectionColor: 'hsl(270 50% 55%)' },
    { key: 'SAR', label: 'SAR', editable: false, deptCount: 2, sectionType: 'info', sectionLabel: 'Information & Support', sectionColor: 'hsl(270 50% 55%)' },
];

export const EXTRA_DUTY_TYPES = ['OPE', 'Familiarization', 'Refresher', 'Other'] as const;
