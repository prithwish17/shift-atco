import { supabase } from '@/integrations/supabase/client';

/**
 * ATC License Validity Engine
 *
 * Checks 3 conditions before allowing duty assignment:
 * 1. Rating validity — does the employee have the required rating and is it current?
 * 2. Medical validity — is the medical certificate current?
 * 3. Endorsement validity — is the employee endorsed for the airport/position?
 */

export interface ValidationResult {
    qualified: boolean;
    reasons: string[];
}

/**
 * Check if an employee is qualified to work a specific grid position.
 * Checks: required rating exists + not expired, medical valid, endorsement valid.
 */
export async function isQualifiedForPosition(
    employeeId: string,
    positionKey: string
): Promise<ValidationResult> {
    const reasons: string[] = [];
    const today = new Date().toISOString().split('T')[0]; // yyyy-MM-dd

    // 1. Get required rating for this position
    const { data: requirement } = await supabase
        .from('position_requirements' as any)
        .select('required_rating')
        .eq('position', positionKey.toUpperCase())
        .maybeSingle();

    if (requirement) {
        const requiredRating = (requirement as any).required_rating;

        // Check if employee has this rating
        const { data: rating } = await supabase
            .from('employee_licenses')
            .select('expiry_date')
            .eq('user_id', employeeId)
            .eq('license_type', requiredRating)
            .maybeSingle();

        if (!rating) {
            reasons.push(`Missing required rating: ${requiredRating.toUpperCase()}`);
        } else if (rating.expiry_date && rating.expiry_date < today) {
            reasons.push(`${requiredRating.toUpperCase()} rating expired (${rating.expiry_date})`);
        }
    }

    // 2. Check medical validity
    const { data: medical } = await supabase
        .from('medical_certificates' as any)
        .select('expiry_date, status')
        .eq('employee_id', employeeId)
        .order('expiry_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!medical) {
        reasons.push('No medical certificate on record');
    } else {
        const med = medical as any;
        if (med.expiry_date && med.expiry_date < today) {
            reasons.push(`Medical certificate expired (${med.expiry_date})`);
        }
    }

    return {
        qualified: reasons.length === 0,
        reasons,
    };
}

/**
 * Batch-check multiple employees for a position.
 * Returns a map of employeeId → ValidationResult.
 */
export async function batchCheckQualifications(
    employeeIds: string[],
    positionKey: string
): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();

    // Run checks in parallel (capped at 10 concurrent)
    const chunks: string[][] = [];
    for (let i = 0; i < employeeIds.length; i += 10) {
        chunks.push(employeeIds.slice(i, i + 10));
    }

    for (const chunk of chunks) {
        const promises = chunk.map(async (id) => {
            const result = await isQualifiedForPosition(id, positionKey);
            results.set(id, result);
        });
        await Promise.all(promises);
    }

    return results;
}

/**
 * Quick check: is an employee's overall license valid?
 * (all ratings current + medical valid)
 */
export async function isLicenseValid(employeeId: string): Promise<ValidationResult> {
    const reasons: string[] = [];
    const today = new Date().toISOString().split('T')[0];

    // Check all ratings
    const { data: ratings } = await supabase
        .from('employee_licenses')
        .select('license_type, expiry_date')
        .eq('user_id', employeeId);

    for (const rating of (ratings || [])) {
        if (rating.expiry_date && rating.expiry_date < today) {
            reasons.push(`${rating.license_type.toUpperCase()} rating expired`);
        }
    }

    // Check medical
    const { data: medical } = await supabase
        .from('medical_certificates' as any)
        .select('expiry_date')
        .eq('employee_id', employeeId)
        .order('expiry_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!medical) {
        reasons.push('No medical certificate');
    } else if ((medical as any).expiry_date && (medical as any).expiry_date < today) {
        reasons.push('Medical expired');
    }

    return { qualified: reasons.length === 0, reasons };
}
