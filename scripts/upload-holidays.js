/**
 * Holiday CSV Upload Script
 * 
 * Usage:
 *   node scripts/upload-holidays.js ./holidays.csv
 * 
 * Expected CSV format:
 *   date,name,type,year,station,selectable,comp_off_eligible
 *   2026-01-26,Republic Day,NH,2026,ALL,false,false
 *   2026-03-14,Holi,RH,2026,ALL,true,false
 * 
 * Environment variables required:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (or VITE_SUPABASE_ANON_KEY for dev)
 */

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });
config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TYPE_MAP = {
    nh: 'NH', national: 'NH',
    rh: 'RH', reserved: 'RH',
    ch: 'CH', closed: 'CH',
};

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV must have header + at least 1 row');

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

    return lines.slice(1).map((line, idx) => {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i] || ''; });

        const name = obj.name || obj.holiday_name || '';
        const date = obj.date || obj.holiday_date || '';
        const rawType = (obj.type || obj.category || '').toLowerCase().trim();
        const type = TYPE_MAP[rawType];
        const year = obj.year ? parseInt(obj.year) : (date ? parseInt(date.substring(0, 4)) : 0);
        const station = obj.station || obj.region || 'ALL';
        const selectable = ['true', 'yes', '1'].includes((obj.selectable || obj.is_optional || '').toLowerCase());
        const compOff = ['true', 'yes', '1'].includes((obj.comp_off_eligible || obj.comp_off || '').toLowerCase());

        const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
        const errors = [];
        if (!name) errors.push('missing name');
        if (!dateValid) errors.push(`invalid date "${date}"`);
        if (!type) errors.push(`unknown type "${rawType}"`);

        return {
            row: idx + 2,
            name, date, type, year, station, selectable, compOff,
            valid: errors.length === 0,
            errors,
        };
    });
}

async function main() {
    const csvPath = process.argv[2];
    if (!csvPath) {
        console.error('Usage: node scripts/upload-holidays.js <path-to-csv>');
        process.exit(1);
    }

    if (!fs.existsSync(csvPath)) {
        console.error(`❌ File not found: ${csvPath}`);
        process.exit(1);
    }

    console.log(`📄 Reading ${csvPath}...`);
    const text = fs.readFileSync(csvPath, 'utf-8');
    const rows = parseCSV(text);

    const valid = rows.filter(r => r.valid);
    const invalid = rows.filter(r => !r.valid);

    console.log(`\n📊 Parsed ${rows.length} rows: ${valid.length} valid, ${invalid.length} invalid`);

    if (invalid.length > 0) {
        console.log('\n⚠  Invalid rows:');
        invalid.forEach(r => {
            console.log(`   Row ${r.row}: ${r.errors.join(', ')} (${r.name || 'unnamed'})`);
        });
    }

    if (valid.length === 0) {
        console.log('\n❌ No valid rows to import');
        process.exit(1);
    }

    const payload = valid.map(r => ({
        name: r.name,
        holiday_date: r.date,
        type: r.type,
        year: r.year,
        station: r.station,
        selectable: r.selectable,
        comp_off_eligible: r.compOff,
    }));

    console.log(`\n⬆  Upserting ${payload.length} holidays...`);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < payload.length; i += 50) {
        const chunk = payload.slice(i, i + 50);
        const { error, data } = await supabase
            .from('holidays')
            .upsert(chunk, { onConflict: 'holiday_date,station' })
            .select('id');

        if (error) {
            console.error(`   ❌ Chunk ${Math.floor(i / 50) + 1} failed: ${error.message}`);
            failed += chunk.length;
        } else {
            success += data?.length || chunk.length;
        }
    }

    console.log(`\n✅ Done: ${success} inserted/updated, ${failed} failed`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
