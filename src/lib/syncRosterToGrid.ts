import { supabase } from '@/integrations/supabase/client';
import { POSITION_ROWS, NIGHT_SPAN_POSITIONS, NIGHT_FULL_SPAN_POSITIONS, NIGHT_TRIPLE_FULL_POSITIONS, NIGHT_FULL_DEPARTMENTS } from '@/lib/atcConstants';
import { format, parse, addDays } from 'date-fns';

/**
 * Sync roster management data (flat rows from Google Sheets)
 * into the ATC duty grid (normalized duty_rosters + roster_assignments).
 *
 * Returns { synced: number, unmatched: string[] }
 */
export async function syncRosterToGrid(
    date: string,        // ISO format: "2026-02-17"
    shift: string,       // UI format: "Morning"
    team: string         // "A" / "B" / "C" / "D" / "E"
): Promise<{ synced: number; unmatched: string[]; compOffsGenerated?: number; qualificationWarnings?: string[] }> {

    // Convert ISO date (2026-02-17) to the format stored in rosters table (17-Feb-2026)
    const parsedDate = parse(date, 'yyyy-MM-dd', new Date());
    const rosterDateStr = format(parsedDate, 'd-MMM-yyyy'); // "6-Mar-2026"

    // Shift is stored as uppercase in rosters table (MORNING, EVENING, NIGHT)
    const rosterShift = shift.toUpperCase();

    // 1. Fetch flat roster rows for this date/shift/team
    const { data: rosterRows, error: rosterErr } = await supabase
        .from('rosters' as any)
        .select('*')
        .eq('date', rosterDateStr)
        .eq('shift', rosterShift)
        .eq('team', team);

    if (rosterErr) throw rosterErr;
    if (!rosterRows || rosterRows.length === 0) {
        throw new Error(`No roster data found for ${rosterDateStr} / ${rosterShift} / Team ${team}. Sync from Roster Management first.`);
    }

    // 2. Fetch all employee profiles for name→ID mapping
    const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, full_name')
        .neq('is_hidden' as any, true);

    if (profErr) throw profErr;

    // Build a case-insensitive lookup: normalized name → profile
    const nameMap = new Map<string, { id: string; full_name: string }>();
    (profiles || []).forEach((p: any) => {
        if (p.full_name) {
            nameMap.set(p.full_name.toLowerCase().trim(), p);
        }
    });

    // Debug: log available profile names vs roster names for troubleshooting
    console.log('[SyncRoster] Profile names available:', Array.from(nameMap.keys()).slice(0, 20));
    console.log('[SyncRoster] Total profiles:', nameMap.size);

    // 3. Create or get the duty roster row (uses ISO date for the grid tables)
    const { data: existingRoster } = await supabase
        .from('duty_rosters' as any)
        .select('*')
        .eq('roster_date', date)
        .eq('shift', shift)
        .eq('team', team)
        .maybeSingle();

    let rosterId: string;
    if (existingRoster) {
        rosterId = (existingRoster as any).id;
        // Update team if needed
        await supabase
            .from('duty_rosters' as any)
            .update({ team } as any)
            .eq('id', rosterId);
    } else {
        const { data: newRoster, error: createErr } = await supabase
            .from('duty_rosters' as any)
            .insert({ roster_date: date, shift, team } as any)
            .select()
            .single();
        if (createErr) throw createErr;
        rosterId = (newRoster as any).id;
    }

    // 4. Delete existing assignments for this roster (clean slate)
    await supabase
        .from('roster_assignments' as any)
        .delete()
        .eq('roster_id', rosterId);

    // 5. Map flat rows → grid assignments
    const isNightShift = shift === 'Night';

    // Known designation suffixes that may be appended to names with a hyphen
    const DESIGNATION_SUFFIXES = ['SM', 'DGM', 'MGR', 'JE', 'AM', 'AGM'];
    const designationPattern = new RegExp(`-(${DESIGNATION_SUFFIXES.join('|')})$`, 'i');

    // Helper: parse employee name (strip role suffix after "/" and trailing designation/hyphens)
    const parseName = (raw: string): string => {
        let name = (raw || '').split('/')[0].trim();
        name = name.replace(designationPattern, '').trim();
        name = name.replace(/[-]+$/, '').trim();
        return name;
    };

    // Helper: normalize name for fuzzy matching (collapse whitespace, lowercase)
    const normalizeName = (s: string): string =>
        s.toLowerCase().replace(/\s+/g, ' ').trim();

    // Helper: resolve employee name to profile
    const resolveProfile = (empName: string): { id: string; full_name: string } | null => {
        let profile = nameMap.get(empName.toLowerCase()) || null;
        if (!profile) {
            const norm = normalizeName(empName);
            for (const [k, v] of nameMap) {
                if (normalizeName(k) === norm) { profile = v; break; }
            }
        }
        return profile;
    };

    const assignments: any[] = [];
    const unmatched: string[] = [];


    if (isNightShift) {
        // ---------- NIGHT SHIFT SYNC ----------
        // Roster `position` field contains half info: "ACC-PLR (1st Half)", "RSR+UBN (2nd Half)"
        // Night grid department keys: RSR-N1, ACC-D-N1, ACC-A-N1, RSR-N2, ACC-D-N2, ACC-A-N2
        // Span positions use RSR-N1-SPAN / RSR-N2-SPAN (single dropdown per half)
        //
        // Strategy: group roster rows by (positionKey + half), then distribute
        // employees across the 3 department columns per half — same pattern as
        // the morning/afternoon path does with DEPT_ORDER.

        const NIGHT_DEPT_ORDER_N1 = ['RSR-N1', 'ACC-D-N1', 'ACC-A-N1'];
        const NIGHT_DEPT_ORDER_N2 = ['RSR-N2', 'ACC-D-N2', 'ACC-A-N2'];

        // Extract half from position string — returns 'N1' | 'N2' | null
        const extractHalf = (rawPosition: string): 'N1' | 'N2' | null => {
            const pos = (rawPosition || '').toLowerCase();
            if (pos.includes('1st half')) return 'N1';
            if (pos.includes('2nd half')) return 'N2';
            return null;
        };

        // Group: composite key "positionKey::half" → list of employee names
        // For full-span and triple-full positions, half is always 'FULL' (no N1/N2 split)
        const nightGrid = new Map<string, string[]>();
        // Track position metadata per key
        const posMetaMap = new Map<string, { posRow: typeof POSITION_ROWS[0] | undefined; positionName: string; sectionType: string }>();

        for (const row of rosterRows as any[]) {
            let rawUnit = (row.unit || '').toUpperCase().trim();
            if (rawUnit === 'HQ') rawUnit = 'WSO';
            const rawEmpName = parseName(row.employee_name || '');
            if (!rawUnit || !rawEmpName) continue;

            const posRow = POSITION_ROWS.find(
                (p) => p.key.toUpperCase() === rawUnit || p.label.toUpperCase() === rawUnit
            );
            const positionName = posRow?.key || rawUnit;
            const sectionType = posRow?.sectionType || 'sector';

            // Full-span and triple-full positions have no half division
            const isNoHalf = NIGHT_FULL_SPAN_POSITIONS.has(positionName) || NIGHT_TRIPLE_FULL_POSITIONS.has(positionName);
            const half = isNoHalf ? 'FULL' : (extractHalf(row.position || '') || 'N1');

            const groupKey = `${positionName}::${half}`;
            if (!nightGrid.has(groupKey)) nightGrid.set(groupKey, []);
            nightGrid.get(groupKey)!.push(rawEmpName);

            if (!posMetaMap.has(groupKey)) {
                posMetaMap.set(groupKey, { posRow, positionName, sectionType });
            }
        }


        // Now generate assignments from grouped data
        for (const [groupKey, empNames] of nightGrid) {
            const [positionName, half] = groupKey.split('::');
            const meta = posMetaMap.get(groupKey)!;
            const isFullSpan = NIGHT_FULL_SPAN_POSITIONS.has(positionName);
            const isTripleFull = NIGHT_TRIPLE_FULL_POSITIONS.has(positionName);
            const isSpan = NIGHT_SPAN_POSITIONS.has(positionName);

            if (isFullSpan) {
                // Full span: 1 dropdown across all 6 cols → use FULL-SPAN dept key
                const firstName = empNames[0];
                const profile = resolveProfile(firstName);
                if (!profile) unmatched.push(firstName);

                assignments.push({
                    roster_id: rosterId,
                    position_name: positionName,
                    position_label: meta.posRow?.label || positionName,
                    department: 'FULL-SPAN',
                    employee_id: profile?.id || null,
                    remark: profile ? null : firstName,
                    section_type: meta.sectionType,
                });

                for (let i = 1; i < empNames.length; i++) {
                    console.warn(`[SyncRoster] Night full-span overflow — extra employee "${empNames[i]}" at ${positionName} has no slot`);
                }
            } else if (isTripleFull) {
                // Triple full: 3 dropdowns across 6 cols → distribute across NIGHT_FULL_DEPARTMENTS
                const deptOrder = [...NIGHT_FULL_DEPARTMENTS];

                for (let i = 0; i < empNames.length; i++) {
                    if (i >= deptOrder.length) {
                        console.warn(`[SyncRoster] Night triple-full overflow — extra employee "${empNames[i]}" at ${positionName} exceeds ${deptOrder.length} columns`);
                        continue;
                    }

                    const empName = empNames[i];
                    const profile = resolveProfile(empName);
                    if (!profile) unmatched.push(empName);

                    assignments.push({
                        roster_id: rosterId,
                        position_name: positionName,
                        position_label: meta.posRow?.label || positionName,
                        department: deptOrder[i],
                        employee_id: profile?.id || null,
                        remark: profile ? null : empName,
                        section_type: meta.sectionType,
                    });
                }
            } else if (isSpan) {
                // Span positions: one dropdown per half → use RSR-Nx-SPAN key
                const deptKey = `RSR-${half}-SPAN`;
                const firstName = empNames[0];
                const profile = resolveProfile(firstName);
                if (!profile) unmatched.push(firstName);

                assignments.push({
                    roster_id: rosterId,
                    position_name: positionName,
                    position_label: meta.posRow?.label || positionName,
                    department: deptKey,
                    employee_id: profile?.id || null,
                    remark: profile ? null : firstName,
                    section_type: meta.sectionType,
                });

                for (let i = 1; i < empNames.length; i++) {
                    console.warn(`[SyncRoster] Night span overflow — extra employee "${empNames[i]}" at ${positionName} ${half} has no slot`);
                }
            } else {
                // Non-span positions: distribute across 3 department columns per half
                const deptOrder = half === 'N2' ? NIGHT_DEPT_ORDER_N2 : NIGHT_DEPT_ORDER_N1;

                for (let i = 0; i < empNames.length; i++) {
                    if (i >= deptOrder.length) {
                        console.warn(`[SyncRoster] Night overflow — extra employee "${empNames[i]}" at ${positionName} ${half} exceeds ${deptOrder.length} columns`);
                        continue;
                    }

                    const empName = empNames[i];
                    const profile = resolveProfile(empName);
                    if (!profile) unmatched.push(empName);

                    assignments.push({
                        roster_id: rosterId,
                        position_name: positionName,
                        position_label: meta.posRow?.label || positionName,
                        department: deptOrder[i],
                        employee_id: profile?.id || null,
                        remark: profile ? null : empName,
                        section_type: meta.sectionType,
                    });
                }
            }
        }
    } else {
        // ---------- MORNING / AFTERNOON SHIFT SYNC ----------
        // (existing logic unchanged)
        const DEPT_ORDER = ['RSR', 'ACC-PLR', 'ACC-A'];

        const normalizePos = (s: string) => s.toUpperCase().trim().replace(/\s+/g, '-');

        const posToDept = (rawPosition: string): string => {
            const np = normalizePos(rawPosition);
            if (np.includes('ACC-PLR') || np === 'PLR') return 'ACC-PLR';
            if (np.includes('ACC-A') || np === 'ACC') return 'ACC-A';
            return 'RSR';
        };

        // Group by unit → department → list of employee names
        const grid = new Map<string, Map<string, string[]>>();
        for (const row of rosterRows as any[]) {
            let rawUnit = (row.unit || '').toUpperCase().trim();
            if (rawUnit === 'HQ') rawUnit = 'WSO';
            const rawEmpName = parseName(row.employee_name || '');
            if (!rawUnit || !rawEmpName) continue;

            const dept = posToDept(row.position || '');
            if (!grid.has(rawUnit)) grid.set(rawUnit, new Map());
            const deptMap = grid.get(rawUnit)!;
            if (!deptMap.has(dept)) deptMap.set(dept, []);
            deptMap.get(dept)!.push(rawEmpName);
        }


        for (const [unitKey, deptMap] of grid) {
            const posRow = POSITION_ROWS.find(
                (p) => p.key.toUpperCase() === unitKey || p.label.toUpperCase() === unitKey
            );
            const sectionType = posRow?.sectionType || 'sector';
            const positionName = posRow?.key || unitKey;
            const maxDepts = posRow?.deptCount || 3;
            const canReliever = posRow?.hasReliever || false;
            const availableDepts = DEPT_ORDER.slice(0, maxDepts);

            const overflow: string[] = [];

            for (const dept of availableDepts) {
                const empNames = deptMap.get(dept) || [];

                const firstName = empNames[0] || null;
                const secondName = canReliever ? (empNames[1] || null) : null;

                const startOverflow = canReliever ? 2 : 1;
                for (let i = startOverflow; i < empNames.length; i++) {
                    overflow.push(empNames[i]);
                }

                if (!firstName) continue;

                const resolvedProfile1 = resolveProfile(firstName);
                if (!resolvedProfile1) unmatched.push(firstName);

                let remarkValue: string | null = null;
                if (secondName) {
                    const resolvedProfile2 = resolveProfile(secondName);
                    if (!resolvedProfile2) unmatched.push(secondName);
                    remarkValue = resolvedProfile2?.full_name || secondName;
                }

                assignments.push({
                    roster_id: rosterId,
                    position_name: positionName,
                    position_label: posRow?.label || unitKey,
                    department: dept,
                    employee_id: resolvedProfile1?.id || null,
                    remark: resolvedProfile1 ? remarkValue : firstName,
                    section_type: sectionType,
                });
            }

            for (const empName of overflow) {
                const emptyDept = availableDepts.find(
                    (d) => !assignments.some((a) => a.position_name === positionName && a.department === d)
                );
                if (!emptyDept) continue;

                const profile = resolveProfile(empName);
                if (!profile) unmatched.push(empName);

                assignments.push({
                    roster_id: rosterId,
                    position_name: positionName,
                    position_label: posRow?.label || unitKey,
                    department: emptyDept,
                    employee_id: profile?.id || null,
                    remark: profile ? null : empName,
                    section_type: sectionType,
                });
            }
        }
    }

    // 6. Bulk upsert assignments
    if (assignments.length > 0) {
        const { error: insertErr } = await supabase
            .from('roster_assignments' as any)
            .upsert(assignments, { onConflict: 'roster_id,position_name,department' });
        if (insertErr) throw insertErr;
    }

    // 7. Auto-generate comp-off entries if duty date is a comp-off-eligible holiday
    let compOffsGenerated = 0;
    try {
        const { data: holidayMatch } = await supabase
            .from('holidays')
            .select('id, name, comp_off_eligible')
            .eq('holiday_date', date)
            .eq('comp_off_eligible', true)
            .maybeSingle();

        if (holidayMatch) {
            // Collect unique employee IDs that were assigned duty
            const employeeIds = [...new Set(
                assignments
                    .filter((a: any) => a.employee_id)
                    .map((a: any) => a.employee_id as string)
            )];

            if (employeeIds.length > 0) {
                const expiryDate = format(addDays(new Date(date), 90), 'yyyy-MM-dd');
                const compOffEntries = employeeIds.map((empId) => ({
                    employee_id: empId,
                    holiday_id: (holidayMatch as any).id,
                    duty_date: date,
                    days_granted: 1,
                    expiry_date: expiryDate,
                    status: 'available',
                }));

                const { error: compErr } = await supabase
                    .from('comp_off_ledger' as any)
                    .upsert(compOffEntries as any, { onConflict: 'employee_id,holiday_id,duty_date' });

                if (!compErr) {
                    compOffsGenerated = employeeIds.length;
                    console.log(`[SyncRoster] Auto-generated ${compOffsGenerated} comp-off entries for ${(holidayMatch as any).name}`);
                } else {
                    console.warn('[SyncRoster] Comp-off generation failed:', compErr.message);
                }
            }
        }
    } catch (e) {
        // Non-critical — don't fail the sync if comp-off generation fails
        console.warn('[SyncRoster] Comp-off check failed:', e);
    }
    // 8. License qualification check (non-blocking warnings)
    const qualificationWarnings: string[] = [];
    try {
        const { isQualifiedForPosition } = await import('@/lib/licenseValidator');
        // Get unique employee+position combos
        const checks = new Map<string, string>(); // employeeId → positionName
        for (const a of assignments) {
            if (a.employee_id && a.position_name) {
                checks.set(a.employee_id, a.position_name);
            }
        }
        for (const [empId, posName] of checks) {
            const result = await isQualifiedForPosition(empId, posName);
            if (!result.qualified) {
                // Find employee name from assignments
                const empAssignment = assignments.find((a: any) => a.employee_id === empId);
                qualificationWarnings.push(
                    `${empAssignment?.position_label || posName}: ${result.reasons.join(', ')}`
                );
            }
        }
        if (qualificationWarnings.length > 0) {
            console.warn(`[SyncRoster] ${qualificationWarnings.length} qualification warning(s):`);
            qualificationWarnings.forEach((w) => console.warn(`  ⚠ ${w}`));
        }
    } catch (e) {
        console.warn('[SyncRoster] License check skipped:', e);
    }

    return {
        synced: assignments.length,
        unmatched: [...new Set(unmatched)],
        compOffsGenerated,
        qualificationWarnings,
    };
}
