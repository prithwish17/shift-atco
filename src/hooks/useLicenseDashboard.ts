import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';
import { differenceInDays, startOfDay } from 'date-fns';

export interface MedicalCertificate {
    id: string;
    employee_id: string;
    medical_class: string;
    issue_date: string | null;
    expiry_date: string | null;
    status: 'valid' | 'expired' | 'pending_renewal';
    created_at: string;
    updated_at: string;
}

export interface UnitEndorsement {
    id: string;
    employee_id: string;
    airport: string;
    position: string;
    issue_date: string | null;
    expiry_date: string | null;
    status: 'valid' | 'expired' | 'pending_renewal';
    created_at: string;
    updated_at: string;
}

export interface LicenseWithExtras {
    id: string;
    user_id: string;
    license_type: string;
    issue_date: string | null;
    expiry_date: string | null;
    license_number?: string;
    issued_by?: string;
    status?: string;
    created_at: string;
}

export type ExpiryAlert = {
    type: 'rating' | 'medical' | 'endorsement';
    label: string;
    expiryDate: string;
    daysUntil: number;
    severity: 'expired' | 'critical' | 'warning' | 'ok';
};

export type HealthStatus = 'valid' | 'warning' | 'expired' | 'info';

export interface LicenseHealthItem {
    id: string;
    kind: 'license' | 'rating' | 'medical' | 'elpa' | 'qualification';
    label: string;
    subtitle: string;
    expiryDate: string | null;
    issueDate?: string | null;
    status: HealthStatus;
    daysUntil: number | null;
    meta?: string | null;
}

export interface RatingHealthItem extends LicenseHealthItem {
    ratingKey: string;
    isActive: boolean;
    lastProficiencyDate: string | null;
    lastInstructor: string | null;
    endorsementDate: string | null;
}

export interface EmployeeLicenseHealth {
    licenseNumber: string;
    highestRating: string;
    overallStatus: HealthStatus;
    overallLabel: string;
    summary: string;
    activeRatingsCount: number;
    expiredCount: number;
    warningCount: number;
    nextExpiry: LicenseHealthItem | null;
    licenses: LicenseHealthItem[];
    ratings: RatingHealthItem[];
    compliance: LicenseHealthItem[];
    qualifications: LicenseHealthItem[];
    watchlist: LicenseHealthItem[];
}

export function useMedicalCertificate(userId?: string) {
    return useQuery({
        queryKey: ['medical-certificate', userId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('medical_certificates' as any)
                .select('*')
                .eq('employee_id', userId!)
                .order('expiry_date', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            return data as unknown as MedicalCertificate | null;
        },
        enabled: !!userId,
        staleTime: 10 * 60 * 1000,
    });
}

export function useUnitEndorsements(userId?: string) {
    return useQuery({
        queryKey: ['unit-endorsements', userId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('unit_endorsements' as any)
                .select('*')
                .eq('employee_id', userId!)
                .order('position', { ascending: true });
            if (error) throw error;
            return (data || []) as unknown as UnitEndorsement[];
        },
        enabled: !!userId,
        staleTime: 10 * 60 * 1000,
    });
}

function getExpirySeverity(expiryDate: string | null): ExpiryAlert['severity'] {
    if (!expiryDate) return 'ok';
    const days = differenceInDays(new Date(expiryDate), startOfDay(new Date()));
    if (days < 0) return 'expired';
    if (days <= 30) return 'critical';
    if (days <= 90) return 'warning';
    return 'ok';
}

const RATING_LABELS: Record<string, string> = {
    rdr: 'Radar (RSR)',
    app: 'Approach (APP)',
    plr: 'Precision (PLR)',
    adc: 'Aerodrome (ADC)',
    alpha: 'Alpha',
    occ: 'Oceanic (OCC)',
};

export function getRatingLabel(type: string): string {
    return RATING_LABELS[type] || type.toUpperCase();
}

function getHealthFromDate(expiryDate: string | null | undefined): { status: HealthStatus; daysUntil: number | null } {
    if (!expiryDate) return { status: 'info', daysUntil: null };
    const daysUntil = differenceInDays(new Date(expiryDate), startOfDay(new Date()));
    if (daysUntil < 0) return { status: 'expired', daysUntil };
    if (daysUntil <= 30) return { status: 'warning', daysUntil };
    return { status: 'valid', daysUntil };
}

function statusRank(status: HealthStatus) {
    if (status === 'expired') return 3;
    if (status === 'warning') return 2;
    if (status === 'valid') return 1;
    return 0;
}

function compareByUrgency(first: LicenseHealthItem, second: LicenseHealthItem) {
    const statusDiff = statusRank(second.status) - statusRank(first.status);
    if (statusDiff !== 0) return statusDiff;

    if (first.daysUntil === null && second.daysUntil === null) {
        return first.label.localeCompare(second.label);
    }
    if (first.daysUntil === null) return 1;
    if (second.daysUntil === null) return -1;
    if (first.daysUntil !== second.daysUntil) return first.daysUntil - second.daysUntil;
    return first.label.localeCompare(second.label);
}

function buildDatedItem(item: Omit<LicenseHealthItem, 'status' | 'daysUntil'>): LicenseHealthItem {
    const health = getHealthFromDate(item.expiryDate);
    return {
        ...item,
        status: health.status,
        daysUntil: health.daysUntil,
    };
}

function toTitleLabel(value: string) {
    return value
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getHealthStatusLabel(item: { status: HealthStatus; daysUntil: number | null }) {
    if (item.status === 'expired' && item.daysUntil !== null) return `Expired ${Math.abs(item.daysUntil)}d ago`;
    if (item.status === 'warning' && item.daysUntil !== null) return `${item.daysUntil}d left`;
    if (item.status === 'valid') return 'Current';
    return 'No expiry';
}

export function buildEmployeeLicenseHealth(profile: any, licensesInput: LicenseWithExtras[] = []): EmployeeLicenseHealth {
    const trainingRecord = (profile?.linked_training_record || {}) as Record<string, any>;
    const licenses = licensesInput.length ? licensesInput : ((profile?.licenses || []) as LicenseWithExtras[]);
    const licensesByType = new Map(licenses.map((license) => [String(license.license_type || '').toLowerCase(), license]));

    const licensesList = licenses
        .map((license) => buildDatedItem({
            id: String(license.id),
            kind: 'license',
            label: getRatingLabel(String(license.license_type || '')),
            subtitle: license.issue_date ? `Issued ${license.issue_date}` : 'License record available',
            expiryDate: license.expiry_date || null,
            issueDate: license.issue_date || null,
            meta: String(license.license_type || '').toUpperCase(),
        }))
        .sort(compareByUrgency);

    const ratingData = (trainingRecord?.rating_data || {}) as Record<string, any>;
    const ratings = Object.entries(ratingData)
        .map(([ratingKey, rawEntry]) => {
            const entry = (rawEntry || {}) as Record<string, any>;
            const linkedLicense = licensesByType.get(String(ratingKey).toLowerCase());
            const licenseHealth = getHealthFromDate(linkedLicense?.expiry_date || null);
            const isActive = String(entry.status || '') === '1';
            const status: HealthStatus = !isActive ? 'info' : (linkedLicense?.expiry_date ? licenseHealth.status : 'valid');

            return {
                id: `rating-${ratingKey}`,
                kind: 'rating' as const,
                ratingKey,
                label: getRatingLabel(ratingKey),
                subtitle: isActive ? 'Operational rating on record' : 'Inactive rating record',
                expiryDate: linkedLicense?.expiry_date || null,
                issueDate: linkedLicense?.issue_date || entry.rating_date || null,
                status,
                daysUntil: linkedLicense?.expiry_date ? licenseHealth.daysUntil : null,
                meta: trainingRecord?.rating_designation || null,
                isActive,
                lastProficiencyDate: entry.last_proficiency?.date || null,
                lastInstructor: entry.last_proficiency?.instructor || null,
                endorsementDate: entry.endorsement_date || null,
            };
        })
        .sort(compareByUrgency);

    const compliance: LicenseHealthItem[] = [
        buildDatedItem({
            id: 'medical',
            kind: 'medical',
            label: 'Medical Fitness',
            subtitle: trainingRecord?.med_status || 'Medical record synced from backend',
            expiryDate: trainingRecord?.med_endorsed_upto || null,
            issueDate: trainingRecord?.med_last_date || null,
            meta: trainingRecord?.med_last_date ? `Examined ${trainingRecord.med_last_date}` : null,
        }),
        buildDatedItem({
            id: 'elpa',
            kind: 'elpa',
            label: trainingRecord?.elpa_level ? `ELPA Level ${trainingRecord.elpa_level}` : 'ELPA',
            subtitle: trainingRecord?.elpa_level ? `ICAO language proficiency level ${trainingRecord.elpa_level}` : 'Language proficiency record',
            expiryDate: trainingRecord?.elpa_endorsed_upto || trainingRecord?.elpa_valid_upto || null,
            issueDate: null,
            meta: trainingRecord?.elpa_endorsed_upto ? `Endorsed until ${trainingRecord.elpa_endorsed_upto}` : null,
        }),
    ].sort(compareByUrgency);

    const instructorValidity = (trainingRecord?.instructor_validity || {}) as Record<string, string>;
    const examinerValidity = (trainingRecord?.examiner_validity || {}) as Record<string, string>;
    const qualifications: LicenseHealthItem[] = [
        ...Object.entries(instructorValidity).map(([key, expiryDate]) => buildDatedItem({
            id: `ojti-${key}`,
            kind: 'qualification',
            label: `${getRatingLabel(key)} OJTI`,
            subtitle: 'Instructor validity',
            expiryDate: expiryDate || null,
            issueDate: null,
            meta: null,
        })),
        ...Object.entries(examinerValidity).map(([key, expiryDate]) => buildDatedItem({
            id: `examiner-${key}`,
            kind: 'qualification',
            label: `${getRatingLabel(key)} Examiner`,
            subtitle: 'Examiner validity',
            expiryDate: expiryDate || null,
            issueDate: null,
            meta: null,
        })),
    ].sort(compareByUrgency);

    const watchlist = [...licensesList, ...compliance, ...qualifications]
        .filter((item) => item.expiryDate)
        .sort(compareByUrgency);

    const activeRatingsCount = ratings.filter((item) => item.isActive).length;
    const expiredCount = watchlist.filter((item) => item.status === 'expired').length;
    const warningCount = watchlist.filter((item) => item.status === 'warning').length;
    const nextExpiry = [...watchlist]
        .filter((item) => item.daysUntil !== null)
        .sort((first, second) => (first.daysUntil ?? 0) - (second.daysUntil ?? 0))[0] || null;

    let overallStatus: HealthStatus = 'info';
    let overallLabel = 'No expiry data';
    if (expiredCount > 0) {
        overallStatus = 'expired';
        overallLabel = 'Action required';
    } else if (warningCount > 0) {
        overallStatus = 'warning';
        overallLabel = 'Renewal window';
    } else if (activeRatingsCount > 0 || watchlist.length > 0) {
        overallStatus = 'valid';
        overallLabel = 'Current';
    }

    let summary = 'Backend records are available for review.';
    if (expiredCount > 0) {
        summary = `${expiredCount} item${expiredCount > 1 ? 's are' : ' is'} expired in the backend record.`;
    } else if (warningCount > 0) {
        summary = `${warningCount} item${warningCount > 1 ? 's are' : ' is'} due soon.`;
    } else if (nextExpiry?.label) {
        summary = `${nextExpiry.label} is the next upcoming expiry.`;
    }

    return {
        licenseNumber: trainingRecord?.license_number || profile?.profile_details?.atc_license_number || 'Not assigned',
        highestRating: trainingRecord?.highest_rating || profile?.highest_rating || toTitleLabel(String(profile?.profile_details?.atc_license_type || '')) || 'Not available',
        overallStatus,
        overallLabel,
        summary,
        activeRatingsCount,
        expiredCount,
        warningCount,
        nextExpiry,
        licenses: licensesList,
        ratings,
        compliance,
        qualifications,
        watchlist,
    };
}

export function useLicenseValidity(
    licenses: LicenseWithExtras[],
    medical: MedicalCertificate | null | undefined,
    endorsements: UnitEndorsement[]
) {
    return useMemo(() => {
        const reasons: string[] = [];
        const today = startOfDay(new Date());

        for (const lic of licenses) {
            if (lic.expiry_date && new Date(lic.expiry_date) < today) {
                reasons.push(`${getRatingLabel(lic.license_type)} rating expired`);
            }
        }

        if (!medical) {
            reasons.push('No medical certificate on record');
        } else if (medical.expiry_date && new Date(medical.expiry_date) < today) {
            reasons.push('Medical certificate expired');
        }

        for (const end of endorsements) {
            if (end.expiry_date && new Date(end.expiry_date) < today) {
                reasons.push(`${end.airport} ${end.position} endorsement expired`);
            }
        }

        return {
            valid: reasons.length === 0,
            reasons,
        };
    }, [licenses, medical, endorsements]);
}

export function useExpiryAlerts(
    licenses: LicenseWithExtras[],
    medical: MedicalCertificate | null | undefined,
    endorsements: UnitEndorsement[]
): ExpiryAlert[] {
    return useMemo(() => {
        const alerts: ExpiryAlert[] = [];
        const today = startOfDay(new Date());

        for (const lic of licenses) {
            if (lic.expiry_date) {
                const days = differenceInDays(new Date(lic.expiry_date), today);
                const severity = getExpirySeverity(lic.expiry_date);
                if (severity !== 'ok') {
                    alerts.push({
                        type: 'rating',
                        label: getRatingLabel(lic.license_type),
                        expiryDate: lic.expiry_date,
                        daysUntil: days,
                        severity,
                    });
                }
            }
        }

        if (medical?.expiry_date) {
            const days = differenceInDays(new Date(medical.expiry_date), today);
            const severity = getExpirySeverity(medical.expiry_date);
            if (severity !== 'ok') {
                alerts.push({
                    type: 'medical',
                    label: `Medical (${medical.medical_class})`,
                    expiryDate: medical.expiry_date,
                    daysUntil: days,
                    severity,
                });
            }
        }

        for (const end of endorsements) {
            if (end.expiry_date) {
                const days = differenceInDays(new Date(end.expiry_date), today);
                const severity = getExpirySeverity(end.expiry_date);
                if (severity !== 'ok') {
                    alerts.push({
                        type: 'endorsement',
                        label: `${end.airport} ${end.position}`,
                        expiryDate: end.expiry_date,
                        daysUntil: days,
                        severity,
                    });
                }
            }
        }

        alerts.sort((a, b) => a.daysUntil - b.daysUntil);
        return alerts;
    }, [licenses, medical, endorsements]);
}
