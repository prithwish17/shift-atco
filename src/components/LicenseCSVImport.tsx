import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CSVRow {
  employee_id: string;
  license_name: string;
  issue_date: string;
  expiry_date: string;
  notes: string;
  valid: boolean;
  error?: string;
}

const LICENSE_MAP: Record<string, string> = {
  rdr: "rdr", radar: "rdr",
  app: "app", approach: "app",
  plr: "plr", precision: "plr",
  adc: "adc", aerodrome: "adc",
  alpha: "alpha",
  occ: "occ", oceanic: "occ",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LicenseCSVImport({ open, onOpenChange }: Props) {
  const [rows, setRows] = useState<CSVRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; skipped: number } | null>(null);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter(l => l.trim());
      if (lines.length < 2) return;

      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
      const parsed: CSVRow[] = lines.slice(1).map(line => {
        const cols = line.split(",").map(c => c.trim());
        const obj: any = {};
        headers.forEach((h, i) => { obj[h] = cols[i] || ""; });

        const licenseKey = LICENSE_MAP[(obj.license_name || "").toLowerCase()];
        const valid = !!obj.employee_id && !!licenseKey;
        return {
          employee_id: obj.employee_id || "",
          license_name: licenseKey || obj.license_name || "",
          issue_date: obj.issue_date || "",
          expiry_date: obj.expiry_date || "",
          notes: obj.notes || "",
          valid,
          error: !obj.employee_id ? "Missing employee_id" : !licenseKey ? "Invalid license_name" : undefined,
        };
      });
      setRows(parsed);
      setResult(null);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) handleFile(file);
  }, [handleFile]);

  const handleImport = async () => {
    const validRows = rows.filter(r => r.valid);
    if (validRows.length === 0) return;

    setImporting(true);
    let success = 0;
    let skipped = 0;

    // Look up user IDs by employee_id
    const empIds = [...new Set(validRows.map(r => r.employee_id))];
    const { data: profiles } = await supabase.from("profiles").select("id, employee_id").in("employee_id", empIds);
    const idMap = new Map((profiles || []).map(p => [p.employee_id, p.id]));

    for (const row of validRows) {
      const userId = idMap.get(row.employee_id);
      if (!userId) { skipped++; continue; }

      const { error } = await supabase.from("employee_licenses").insert({
        user_id: userId,
        license_type: row.license_name as any,
        issue_date: row.issue_date || null,
        expiry_date: row.expiry_date || null,
      });

      if (error) { skipped++; } else { success++; }
    }

    setResult({ success, skipped });
    setImporting(false);
    toast.success(`Imported ${success} licenses, skipped ${skipped}`);
  };

  const reset = () => { setRows([]); setResult(null); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk License Import</DialogTitle>
          <DialogDescription>Upload a CSV file with columns: employee_id, license_name, issue_date, expiry_date, notes</DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".csv";
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) handleFile(file);
              };
              input.click();
            }}
          >
            <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">Drop CSV file here or click to browse</p>
            <p className="text-sm text-muted-foreground mt-1">Supports .csv files</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="gap-1">
                <FileText className="h-3 w-3" />
                {rows.length} rows
              </Badge>
              <Badge className="gap-1 bg-green-600">
                <CheckCircle className="h-3 w-3" />
                {rows.filter(r => r.valid).length} valid
              </Badge>
              {rows.some(r => !r.valid) && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" />
                  {rows.filter(r => !r.valid).length} invalid
                </Badge>
              )}
            </div>

            <div className="rounded-md border max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>License</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead>Expiry Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i} className={row.valid ? "" : "bg-destructive/10"}>
                      <TableCell>
                        {row.valid ? <CheckCircle className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                      </TableCell>
                      <TableCell className="font-mono">{row.employee_id}</TableCell>
                      <TableCell>{row.license_name.toUpperCase()}</TableCell>
                      <TableCell>{row.issue_date || "—"}</TableCell>
                      <TableCell>{row.expiry_date || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {result && (
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm">✅ {result.success} imported, ⏭ {result.skipped} skipped</p>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={reset}>Reset</Button>
              <Button onClick={handleImport} disabled={importing || rows.filter(r => r.valid).length === 0}>
                {importing ? "Importing..." : `Import ${rows.filter(r => r.valid).length} Licenses`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
