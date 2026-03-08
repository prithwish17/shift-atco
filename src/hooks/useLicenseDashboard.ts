import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';
import { differenceInDays, startOfDay } from 'date-fns';

// ---------- Types ----------

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

// ---------- Queries ----------

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

// ---------- Derived ----------

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

/** Compute overall license validity from ratings + medical + endorsements */
export function useLicenseValidity(
    licenses: LicenseWithExtras[],
    medical: MedicalCertificate | null | undefined,
    endorsements: UnitEndorsement[]
) {
    return useMemo(() => {
        const reasons: string[] = [];
        const today = startOfDay(new Date());

        // Check ratings
        for (const lic of licenses) {
            if (lic.expiry_date && new Date(lic.expiry_date) < today) {
                reasons.push(`${getRatingLabel(lic.license_type)} rating expired`);
            }
        }

        // Check medical
        if (!medical) {
            reasons.push('No medical certificate on record');
        } else if (medical.expiry_date && new Date(medical.expiry_date) < today) {
            reasons.push('Medical certificate expired');
        }

        // Check endorsements
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

/** Collect all upcoming expirations across ratings, medical, endorsements */
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

        // Sort: expired first, then by days until
        alerts.sort((a, b) => a.daysUntil - b.daysUntil);
        return alerts;
    }, [licenses, medical, endorsements]);
}
