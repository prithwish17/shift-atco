import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Upload,
    FileText,
    CheckCircle,
    XCircle,
    AlertTriangle,
    Download,
    Loader2,
    UserPlus,
    Copy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/* ---------- types ---------- */
interface ParsedEmployee {
    sl_no: string;
    employee_id: string;
    initials: string;
    full_name: string;
    designation: string;
    stream: string;
    mobile: string;
    email: string;
    gender: string;
    alternate_email: string;
    current_shift: string;
    valid: boolean;
    error?: string;
    isDuplicate?: boolean;
    duplicateReason?: string;
}

interface ImportResult {
    created: string[];
    updated: string[];
    skipped: { employee_id: string; reason: string }[];
    failed: { employee_id: string; error: string }[];
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/* ---------- CSV column header mapping ---------- */
// Maps the raw header text (lowercased & trimmed) to the internal field key.
const HEADER_MAP: Record<string, keyof ParsedEmployee> = {
    "sl. no": "sl_no",
    "sl.no": "sl_no",
    "sl no": "sl_no",
    "slno": "sl_no",
    "serial": "sl_no",
    "emp. id": "employee_id",
    "emp.id": "employee_id",
    "emp id": "employee_id",
    "empid": "employee_id",
    "employee_id": "employee_id",
    "employee id": "employee_id",
    initials: "initials",
    "employee name": "full_name",
    "full_name": "full_name",
    "full name": "full_name",
    name: "full_name",
    designation: "designation",
    "stream alloted": "stream",
    "stream allotted": "stream",
    stream: "stream",
    "contact no.": "mobile",
    "contact no": "mobile",
    "contact": "mobile",
    mobile: "mobile",
    phone: "mobile",
    "email id": "email",
    "email": "email",
    "email address": "email",
    gender: "gender",
    "alternate mail address": "alternate_email",
    "alternate email": "alternate_email",
    "alternate_email": "alternate_email",
    "alt email": "alternate_email",
    "shift name": "current_shift",
    "shift": "current_shift",
    "current_shift": "current_shift",
};

const SAMPLE_CSV = `SL. No,Emp. ID,Initials,Employee Name,Designation,Stream Alloted,Contact No.,Email id,Gender,ALTERNATE MAIL ADDRESS,Shift Name
1,EMP001,JD,John Doe,ATC Officer,Stream A,9876543210,john.doe@example.com,Male,john.alt@example.com,A
2,EMP002,JS,Jane Smith,ATC Officer,Stream B,9876543211,jane.smith@example.com,Female,jane.alt@example.com,B`;

/* ---------- component ---------- */
export function EmployeeCSVImport({ open, onOpenChange }: Props) {
    const [rows, setRows] = useState<ParsedEmployee[]>([]);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [skipDuplicates, setSkipDuplicates] = useState(true);
    const [updateDuplicates, setUpdateDuplicates] = useState(false);
    const [existingEmpIds, setExistingEmpIds] = useState<Set<string>>(new Set());
    const [loadingExisting, setLoadingExisting] = useState(false);

    /* --- fetch existing employee IDs from DB when dialog opens --- */
    useEffect(() => {
        if (!open) return;
        const fetchExisting = async () => {
            setLoadingExisting(true);
            try {
                const { data } = await supabase
                    .from("profiles")
                    .select("employee_id");
                if (data) {
                    setExistingEmpIds(new Set(data.map((p) => p.employee_id).filter(Boolean)));
                }
            } catch {
                // non-critical — duplicates just won't be flagged against DB
            }
            setLoadingExisting(false);
        };
        fetchExisting();
    }, [open]);

    /* --- parse CSV --- */
    const handleFile = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            const lines = text.split(/\r?\n/).filter((l) => l.trim());
            if (lines.length < 2) {
                toast.error("CSV must contain at least a header row and one data row");
                return;
            }

            // Parse headers
            const rawHeaders = lines[0].split(",").map((h) => h.trim());
            const mappedHeaders = rawHeaders.map(
                (h) => HEADER_MAP[h.toLowerCase()] ?? null
            );

            const parsed: ParsedEmployee[] = lines.slice(1).map((line) => {
                // Simple CSV split — handles unquoted values
                const cols = line.split(",").map((c) => c.trim());

                const obj: Partial<ParsedEmployee> = {};
                mappedHeaders.forEach((key, i) => {
                    if (key && key !== "sl_no") {
                        (obj as any)[key] = cols[i] || "";
                    }
                });
                // sl_no is display-only but store anyway
                const slIdx = mappedHeaders.indexOf("sl_no");
                obj.sl_no = slIdx >= 0 ? cols[slIdx] || "" : "";

                // Validation
                const errors: string[] = [];
                if (!obj.employee_id) errors.push("Missing Emp. ID");
                if (!obj.full_name) errors.push("Missing Employee Name");
                if (!obj.email) errors.push("Missing Email");
                if (!obj.current_shift) errors.push("Missing Shift Name");
                // Basic email check
                if (obj.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj.email))
                    errors.push("Invalid email format");

                return {
                    sl_no: obj.sl_no || "",
                    employee_id: obj.employee_id || "",
                    initials: obj.initials || "",
                    full_name: obj.full_name || "",
                    designation: obj.designation || "",
                    stream: obj.stream || "",
                    mobile: obj.mobile || "",
                    email: obj.email || "",
                    gender: obj.gender || "",
                    alternate_email: obj.alternate_email || "",
                    current_shift: obj.current_shift || "",
                    valid: errors.length === 0,
                    error: errors.length > 0 ? errors.join("; ") : undefined,
                };
            });

            // --- Duplicate detection ---
            const seenIds = new Map<string, number>(); // emp_id -> first occurrence index
            parsed.forEach((row, idx) => {
                if (!row.employee_id) return;
                const id = row.employee_id.trim().toUpperCase();

                // Check against existing DB employees
                if (existingEmpIds.has(row.employee_id)) {
                    row.isDuplicate = true;
                    row.duplicateReason = "Already exists in database";
                }
                // Check within-CSV duplicates
                else if (seenIds.has(id)) {
                    row.isDuplicate = true;
                    row.duplicateReason = `Duplicate of row ${(seenIds.get(id)! + 1)}`;
                    // Also mark the first occurrence if not already marked
                } else {
                    seenIds.set(id, idx);
                }
            });

            setRows(parsed);
            setResult(null);
        };
        reader.readAsText(file);
    }, [existingEmpIds]);

    /* --- drag & drop / file pick --- */
    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith(".csv")) handleFile(file);
            else toast.error("Please drop a .csv file");
        },
        [handleFile]
    );

    /* --- invoke edge function --- */
    const handleImport = async () => {
        let validRows = rows.filter((r) => r.valid);
        // In "skip" mode, remove duplicates from the payload
        // In "update" mode, keep duplicates — they'll be updated server-side
        if (skipDuplicates && !updateDuplicates) {
            validRows = validRows.filter((r) => !r.isDuplicate);
        }
        if (validRows.length === 0) return;

        setImporting(true);

        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (!session) {
                toast.error("You must be logged in to import employees");
                setImporting(false);
                return;
            }

            const payload = validRows.map((r) => ({
                employee_id: r.employee_id,
                initials: r.initials || null,
                full_name: r.full_name,
                designation: r.designation || null,
                stream: r.stream || null,
                mobile: r.mobile || null,
                email: r.email,
                gender: r.gender || null,
                alternate_email: r.alternate_email || null,
                current_shift: r.current_shift || "general",
            }));

            const { data, error } = await supabase.functions.invoke(
                "import-employees",
                {
                    body: {
                        employees: payload,
                        update_duplicates: updateDuplicates,
                    },
                }
            );

            if (error) {
                toast.error(`Import failed: ${error.message}`);
                setImporting(false);
                return;
            }

            setResult(data as ImportResult);

            const res = data as ImportResult;
            if (res.created.length > 0) {
                toast.success(
                    `Successfully created ${res.created.length} employee(s)`
                );
            }
            if (res.updated && res.updated.length > 0) {
                toast.success(
                    `Successfully updated ${res.updated.length} employee(s)`
                );
            }
            if (res.skipped.length > 0) {
                toast.info(`Skipped ${res.skipped.length} duplicate(s)`);
            }
            if (res.failed.length > 0) {
                toast.error(`Failed to create ${res.failed.length} employee(s)`);
            }
        } catch (err: any) {
            toast.error(err.message || "Import failed unexpectedly");
        }

        setImporting(false);
    };

    /* --- download sample --- */
    const downloadSample = () => {
        const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "employee_import_template.csv";
        a.click();
        URL.revokeObjectURL(url);
    };

    /* --- reset --- */
    const reset = () => {
        setRows([]);
        setResult(null);
    };

    const validCount = rows.filter((r) => r.valid).length;
    const invalidCount = rows.filter((r) => !r.valid).length;
    const duplicateCount = rows.filter((r) => r.isDuplicate).length;
    const importableCount = (skipDuplicates && !updateDuplicates)
        ? rows.filter((r) => r.valid && !r.isDuplicate).length
        : validCount;

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!v) reset();
                onOpenChange(v);
            }}
        >
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserPlus className="h-5 w-5" />
                        Bulk Employee Import
                    </DialogTitle>
                    <DialogDescription>
                        Upload a CSV file to register employees in bulk. Login credentials
                        will be: <strong>Email</strong> as login ID and{" "}
                        <strong>ShiftPlan@&#123;Emp. ID&#125;</strong> as password.
                    </DialogDescription>
                </DialogHeader>

                {rows.length === 0 && !result ? (
                    <div className="space-y-4">
                        {/* Drop zone */}
                        <div
                            onDrop={handleDrop}
                            onDragOver={(e) => e.preventDefault()}
                            className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-all"
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
                            <p className="font-medium text-lg">
                                Drop CSV file here or click to browse
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Supports .csv files
                            </p>
                        </div>

                        {/* Sample & Expected columns */}
                        <div className="flex items-center justify-between border rounded-lg p-3 bg-muted/30">
                            <div className="text-sm text-muted-foreground">
                                <strong>Expected columns:</strong> SL. No, Emp. ID, Initials,
                                Employee Name, Designation, Stream Alloted, Contact No., Email
                                id, Gender, ALTERNATE MAIL ADDRESS, Shift Name
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={downloadSample}
                                className="shrink-0"
                            >
                                <Download className="h-4 w-4 mr-1" />
                                Sample CSV
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
                        {/* Summary badges + skip toggle */}
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div className="flex items-center gap-3 flex-wrap">
                                <Badge variant="outline" className="gap-1">
                                    <FileText className="h-3 w-3" />
                                    {rows.length} rows
                                </Badge>
                                <Badge className="gap-1 bg-green-600 hover:bg-green-700">
                                    <CheckCircle className="h-3 w-3" />
                                    {validCount} valid
                                </Badge>
                                {invalidCount > 0 && (
                                    <Badge variant="destructive" className="gap-1">
                                        <XCircle className="h-3 w-3" />
                                        {invalidCount} invalid
                                    </Badge>
                                )}
                                {duplicateCount > 0 && (
                                    <Badge className="gap-1 bg-yellow-500 hover:bg-yellow-600 text-white">
                                        <Copy className="h-3 w-3" />
                                        {duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""}
                                    </Badge>
                                )}
                            </div>
                            {duplicateCount > 0 && (
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            id="skip-duplicates"
                                            checked={skipDuplicates}
                                            onCheckedChange={(v) => {
                                                setSkipDuplicates(v);
                                                if (v) setUpdateDuplicates(false);
                                            }}
                                        />
                                        <Label htmlFor="skip-duplicates" className="text-sm cursor-pointer">
                                            Skip
                                        </Label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            id="update-duplicates"
                                            checked={updateDuplicates}
                                            onCheckedChange={(v) => {
                                                setUpdateDuplicates(v);
                                                if (v) setSkipDuplicates(false);
                                            }}
                                        />
                                        <Label htmlFor="update-duplicates" className="text-sm cursor-pointer">
                                            Update
                                        </Label>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Preview table */}
                        <ScrollArea className="flex-1 rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-12">Status</TableHead>
                                        <TableHead>Emp. ID</TableHead>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Shift</TableHead>
                                        <TableHead>Designation</TableHead>
                                        <TableHead className="min-w-[140px]">Error</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((row, i) => (
                                        <TableRow
                                            key={i}
                                            className={
                                                !row.valid
                                                    ? "bg-destructive/10"
                                                    : row.isDuplicate
                                                        ? "bg-yellow-500/10"
                                                        : ""
                                            }
                                        >
                                            <TableCell>
                                                {row.isDuplicate ? (
                                                    <Copy className="h-4 w-4 text-yellow-600" />
                                                ) : row.valid ? (
                                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                                ) : (
                                                    <AlertTriangle className="h-4 w-4 text-destructive" />
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {row.employee_id || "—"}
                                            </TableCell>
                                            <TableCell>{row.full_name || "—"}</TableCell>
                                            <TableCell className="text-xs">
                                                {row.email || "—"}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="uppercase text-xs">
                                                    {row.current_shift || "—"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {row.designation || "—"}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {row.isDuplicate ? (
                                                    <span className="text-yellow-600">{row.duplicateReason}</span>
                                                ) : row.error ? (
                                                    <span className="text-destructive">{row.error}</span>
                                                ) : null}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>

                        {/* Result card */}
                        {result && (
                            <Card>
                                <CardContent className="pt-4 space-y-1">
                                    {result.created.length > 0 && (
                                        <p className="text-sm text-green-600">
                                            ✅ {result.created.length} employee(s) created
                                            successfully
                                        </p>
                                    )}
                                    {result.skipped.length > 0 && (
                                        <div>
                                            <p className="text-sm text-yellow-600">
                                                ⏭ {result.skipped.length} skipped (already exist)
                                            </p>
                                            <ul className="text-xs text-muted-foreground ml-5 list-disc">
                                                {result.skipped.map((s, i) => (
                                                    <li key={i}>
                                                        {s.employee_id}: {s.reason}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {result.failed.length > 0 && (
                                        <div>
                                            <p className="text-sm text-destructive">
                                                ❌ {result.failed.length} failed
                                            </p>
                                            <ul className="text-xs text-destructive/80 ml-5 list-disc">
                                                {result.failed.map((f, i) => (
                                                    <li key={i}>
                                                        {f.employee_id}: {f.error}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" onClick={reset}>
                                Reset
                            </Button>
                            <Button
                                onClick={handleImport}
                                disabled={importing || importableCount === 0 || !!result}
                            >
                                {importing ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Importing...
                                    </>
                                ) : (
                                    <>
                                        <UserPlus className="h-4 w-4 mr-2" />
                                        Import {importableCount} Employee{importableCount !== 1 ? "s" : ""}
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
