import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---------- Types ----------

interface CSVRow {
    name: string;
    holiday_date: string;
    type: string;       // NH / RH / CH
    year: number;
    station: string;
    selectable: boolean;
    comp_off_eligible: boolean;
    valid: boolean;
    error?: string;
}

// Flexible type mapping
const TYPE_MAP: Record<string, string> = {
    nh: 'NH', national: 'NH', 'national holiday': 'NH',
    rh: 'RH', reserved: 'RH', 'restricted holiday': 'RH',
    ch: 'CH', closed: 'CH', 'closed holiday': 'CH',
};

const TYPE_DISPLAY: Record<string, { label: string; color: string }> = {
    NH: { label: 'NH', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    CH: { label: 'CH', color: 'bg-red-100 text-red-700 border-red-200' },
    RH: { label: 'RH', color: 'bg-amber-100 text-amber-700 border-amber-200' },
};

// ---------- Props ----------

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    createdBy: string;
}

// ---------- Component ----------

export function HolidayCSVImport({ open, onOpenChange, createdBy }: Props) {
    const [rows, setRows] = useState<CSVRow[]>([]);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<{ success: number; skipped: number; errors: string[] } | null>(null);

    const handleFile = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            const lines = text.split('\n').filter((l) => l.trim());
            if (lines.length < 2) {
                toast.error('CSV must have at least a header row and one data row');
                return;
            }

            const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));

            const parsed: CSVRow[] = lines.slice(1).map((line) => {
                // Proper CSV split: respect quoted fields, split only on commas
                const cols: string[] = [];
                let current = '';
                let inQuotes = false;
                for (let ci = 0; ci < line.length; ci++) {
                    const ch = line[ci];
                    if (ch === '"') { inQuotes = !inQuotes; }
                    else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
                    else { current += ch; }
                }
                cols.push(current.trim());

                const obj: Record<string, string> = {};
                headers.forEach((h, i) => { obj[h] = cols[i] || ''; });

                // Flexible field mapping — accepts any header naming
                const name = obj.name || obj.holiday_name || '';
                const date = obj.date || obj.holiday_date || '';
                const rawType = (obj.type || obj.category || '').toLowerCase().trim();
                const type = TYPE_MAP[rawType];
                const yearStr = obj.year || '';
                const station = obj.station || obj.region || 'ALL';
                const selectable = ['true', 'yes', '1'].includes((obj.selectable || obj.is_optional || '').toLowerCase());
                const compOff = ['true', 'yes', '1'].includes((obj.comp_off_eligible || obj.comp_off || '').toLowerCase());

                const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
                const year = yearStr ? parseInt(yearStr, 10) : (dateValid ? parseInt(date.substring(0, 4), 10) : 0);

                const valid = !!name && dateValid && !!type;
                let error: string | undefined;
                if (!name) error = 'Missing name';
                else if (!dateValid) error = `Invalid date "${date}" (use YYYY-MM-DD)`;
                else if (!type) error = `Unknown type "${rawType}" — use NH/RH/CH`;

                return { name, holiday_date: date, type: type || rawType.toUpperCase(), year, station, selectable, comp_off_eligible: compOff, valid, error };
            });

            setRows(parsed);
            setResult(null);
        };
        reader.readAsText(file);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.csv')) handleFile(file);
    }, [handleFile]);

    const handleImport = async () => {
        const validRows = rows.filter((r) => r.valid);
        if (validRows.length === 0) return;

        setImporting(true);
        let success = 0;
        let skipped = 0;
        const errors: string[] = [];

        // Deduplicate by (holiday_date + station) — last occurrence wins
        const deduped = new Map<string, typeof validRows[0]>();
        for (const row of validRows) {
            deduped.set(`${row.holiday_date}|${row.station}`, row);
        }
        const uniqueRows = Array.from(deduped.values());

        const payload = uniqueRows.map((row) => ({
            name: row.name,
            holiday_date: row.holiday_date,
            type: row.type,
            year: row.year,
            station: row.station,
            selectable: row.selectable,
            comp_off_eligible: row.comp_off_eligible,
            created_by: createdBy,
        }));

        // Upsert in chunks of 50
        for (let i = 0; i < payload.length; i += 50) {
            const chunk = payload.slice(i, i + 50);
            const { error, data } = await supabase
                .from('holidays')
                .upsert(chunk as any, { onConflict: 'holiday_date,station' })
                .select('id');

            if (error) {
                errors.push(`Chunk ${Math.floor(i / 50) + 1}: ${error.message}`);
                skipped += chunk.length;
            } else {
                success += data?.length || chunk.length;
            }
        }

        setResult({ success, skipped, errors });
        setImporting(false);

        if (errors.length > 0) {
            toast.warning(`Imported ${success}, skipped ${skipped}. ${errors.length} error(s).`);
        } else {
            toast.success(`Successfully imported ${success} holidays`);
        }
    };

    const reset = () => { setRows([]); setResult(null); };

    const validCount = rows.filter((r) => r.valid).length;
    const invalidCount = rows.filter((r) => !r.valid).length;

    const downloadTemplate = () => {
        const csv = `date,name,type,year,station,selectable,comp_off_eligible\n2026-01-01,New Year's Day,NH,2026,ALL,false,false\n2026-01-26,Republic Day,NH,2026,ALL,false,false\n2026-03-14,Holi,RH,2026,ALL,true,false\n2026-08-15,Independence Day,NH,2026,ALL,false,true\n2026-10-02,Gandhi Jayanti,NH,2026,ALL,false,true`;
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'holidays_template.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Bulk Holiday Import</DialogTitle>
                    <DialogDescription>
                        Upload a CSV: <code className="text-xs bg-muted px-1 rounded">date, name, type (NH/RH/CH), year, station, selectable</code>
                    </DialogDescription>
                </DialogHeader>

                {rows.length === 0 ? (
                    <div className="space-y-3">
                        <div
                            onDrop={handleDrop}
                            onDragOver={(e) => e.preventDefault()}
                            className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 transition-colors"
                            onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = '.csv';
                                input.onchange = (e) => {
                                    const file = (e.target as HTMLInputElement).files?.[0];
                                    if (file) handleFile(file);
                                };
                                input.click();
                            }}
                        >
                            <Upload className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
                            <p className="font-medium text-sm">Drop CSV file here or click to browse</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Accepts any CSV with date, name, type (NH/RH/CH) columns
                            </p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={downloadTemplate} className="w-full text-xs">
                            <Download className="h-3.5 w-3.5 mr-1" /> Download CSV Template
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <Badge variant="outline" className="gap-1"><FileText className="h-3 w-3" /> {rows.length} rows</Badge>
                            <Badge className="gap-1 bg-green-600"><CheckCircle className="h-3 w-3" /> {validCount} valid</Badge>
                            {invalidCount > 0 && (
                                <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> {invalidCount} invalid</Badge>
                            )}
                        </div>

                        <div className="rounded-md border max-h-64 overflow-y-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10"></TableHead>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Station</TableHead>
                                        <TableHead className="text-center">Opt</TableHead>
                                        <TableHead className="text-center">CO</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((row, i) => {
                                        const display = TYPE_DISPLAY[row.type];
                                        return (
                                            <TableRow key={i} className={row.valid ? '' : 'bg-destructive/10'}>
                                                <TableCell>
                                                    {row.valid
                                                        ? <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                                                        : <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                                                </TableCell>
                                                <TableCell className="font-medium text-xs">
                                                    {row.name || '—'}
                                                    {row.error && <p className="text-[10px] text-destructive">{row.error}</p>}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">{row.holiday_date}</TableCell>
                                                <TableCell>
                                                    {display
                                                        ? <Badge variant="outline" className={`text-[10px] ${display.color}`}>{display.label}</Badge>
                                                        : <span className="text-xs text-destructive">{row.type || '?'}</span>}
                                                </TableCell>
                                                <TableCell className="text-xs">{row.station}</TableCell>
                                                <TableCell className="text-center text-xs">{row.selectable ? '✓' : ''}</TableCell>
                                                <TableCell className="text-center text-xs">{row.comp_off_eligible ? '✓' : ''}</TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>

                        {result && (
                            <Card className={result.errors.length > 0 ? 'border-amber-200' : 'border-green-200'}>
                                <CardContent className="pt-3 pb-3">
                                    <p className="text-sm font-medium">✅ {result.success} imported &nbsp; ⏭ {result.skipped} skipped</p>
                                    {result.errors.map((e, i) => (
                                        <p key={i} className="text-xs text-destructive">• {e}</p>
                                    ))}
                                </CardContent>
                            </Card>
                        )}

                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" onClick={reset}>Reset</Button>
                            <Button onClick={handleImport} disabled={importing || validCount === 0}>
                                {importing ? 'Importing...' : `Import ${validCount} Holidays`}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
