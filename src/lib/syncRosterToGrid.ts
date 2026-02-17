import { supabase } from '@/integrations/supabase/client';
import { POSITION_ROWS } from '@/lib/atcConstants';
import { format, parse } from 'date-fns';

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
): Promise<{ synced: number; unmatched: string[] }> {

    // Convert ISO date (2026-02-17) to the format stored in rosters table (17-Feb-2026)
    const parsedDate = parse(date, 'yyyy-MM-dd', new Date());
    const rosterDateStr = format(parsedDate, 'dd-MMM-yyyy'); // "17-Feb-2026"

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
        .select('id, full_name');

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
    // Group roster rows by unit+department (position key + dept in the grid)
    // Each (unit, dept) combo can hold 2 employees: Name (employee_id) + Reliever (remark)
    const DEPT_ORDER = ['RSR', 'ACC-PLR', 'ACC-A'];

    // Helper: normalize position strings for comparison
    const normalizePos = (s: string) => s.toUpperCase().trim().replace(/\s+/g, '-');

    // Helper: map position field to preferred department
    const posToDept = (rawPosition: string): string => {
        const np = normalizePos(rawPosition);
        if (np.includes('ACC-PLR') || np === 'PLR') return 'ACC-PLR';
        if (np.includes('ACC-A') || np === 'ACC') return 'ACC-A';
        return 'RSR';
    };

    // Known designation suffixes that may be appended to names with a hyphen
    const DESIGNATION_SUFFIXES = ['SM', 'DGM', 'MGR', 'JE', 'AM', 'AGM'];
    const designationPattern = new RegExp(`-(${DESIGNATION_SUFFIXES.join('|')})$`, 'i');

    // Helper: parse employee name (strip role suffix after "/" and trailing designation/hyphens)
    const parseName = (raw: string): string => {
        let name = (raw || '').split('/')[0].trim();
        // Strip trailing designation suffix like "-AM", "-JE", "-SM"
        name = name.replace(designationPattern, '').trim();
        // Strip any remaining trailing hyphens
        name = name.replace(/[-]+$/, '').trim();
        return name;
    };

    // Helper: normalize name for fuzzy matching (collapse whitespace, lowercase)
    const normalizeName = (s: string): string =>
        s.toLowerCase().replace(/\s+/g, ' ').trim();

    // Group by unit → department → list of employee names
    const grid = new Map<string, Map<string, string[]>>();
    for (const row of rosterRows as any[]) {
        let rawUnit = (row.unit || '').toUpperCase().trim();
        // Map HQ → WSO so it maps to the WSO row in the grid
        if (rawUnit === 'HQ') rawUnit = 'WSO';
        const rawEmpName = parseName(row.employee_name || '');
        if (!rawUnit || !rawEmpName) continue;

        const dept = posToDept(row.position || '');
        if (!grid.has(rawUnit)) grid.set(rawUnit, new Map());
        const deptMap = grid.get(rawUnit)!;
        if (!deptMap.has(dept)) deptMap.set(dept, []);
        deptMap.get(dept)!.push(rawEmpName);
    }

    const assignments: any[] = [];
    const unmatched: string[] = [];

    for (const [unitKey, deptMap] of grid) {
        const posRow = POSITION_ROWS.find(
            (p) => p.key.toUpperCase() === unitKey || p.label.toUpperCase() === unitKey
        );
        const sectionType = posRow?.sectionType || 'sector';
        const positionName = posRow?.key || unitKey;
        const maxDepts = posRow?.deptCount || 3;
        const canReliever = posRow?.hasReliever || false;
        const availableDepts = DEPT_ORDER.slice(0, maxDepts);

        // Track overflow employees (3rd+ for same dept) to reassign to other depts
        const overflow: string[] = [];

        for (const dept of availableDepts) {
            const empNames = deptMap.get(dept) || [];

            // Slot 1: Name → employee_id
            const firstName = empNames[0] || null;
            // Slot 2: Reliever → remark (only for hasReliever positions)
            const secondName = canReliever ? (empNames[1] || null) : null;

            // Any extras beyond 2 (or beyond 1 for non-reliever) go to overflow
            const startOverflow = canReliever ? 2 : 1;
            for (let i = startOverflow; i < empNames.length; i++) {
                overflow.push(empNames[i]);
            }

            if (!firstName) continue;

            // Try exact match first, then fallback to whitespace-normalized match
            let resolvedProfile1 = nameMap.get(firstName.toLowerCase()) || null;
            if (!resolvedProfile1) {
                const norm = normalizeName(firstName);
                for (const [k, v] of nameMap) {
                    if (normalizeName(k) === norm) { resolvedProfile1 = v; break; }
                }
            }
            if (!resolvedProfile1) unmatched.push(firstName);

            let remarkValue: string | null = null;
            if (secondName) {
                // For reliever: store the second employee's name in remark
                let resolvedProfile2 = nameMap.get(secondName.toLowerCase()) || null;
                if (!resolvedProfile2) {
                    const norm = normalizeName(secondName);
                    for (const [k, v] of nameMap) {
                        if (normalizeName(k) === norm) { resolvedProfile2 = v; break; }
                    }
                }
                if (!resolvedProfile2) unmatched.push(secondName);
                // Store reliever as their display name (profile name or raw name)
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

        // Try to place overflow employees into empty department slots
        for (const empName of overflow) {
            const emptyDept = availableDepts.find(
                (d) => !assignments.some((a) => a.position_name === positionName && a.department === d)
            );
            if (!emptyDept) continue;

            const profile = nameMap.get(empName.toLowerCase());
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

    // 6. Bulk upsert assignments
    if (assignments.length > 0) {
        const { error: insertErr } = await supabase
            .from('roster_assignments' as any)
            .upsert(assignments, { onConflict: 'roster_id,position_name,department' });
        if (insertErr) throw insertErr;
    }

    return {
        synced: assignments.length,
        unmatched: [...new Set(unmatched)], // deduplicate
    };
}

