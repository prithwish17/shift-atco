import { useState, useMemo, useCallback } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Shield, Heart, MapPin, AlertTriangle, Plus, Users, GraduationCap, RefreshCw, Search, CheckCircle2, XCircle, Pencil, Save, X, Calendar, Award, Eye, Languages, Stethoscope } from 'lucide-react';
import { format, differenceInDays, startOfDay } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---------- Types ----------
interface LicenseRow {
    id: string;
    user_id: string;
    license_type: string;
    issue_date: string | null;
    expiry_date: string | null;
    license_number?: string;
    status?: string;
    profile?: { full_name: string; employee_id: string };
}

interface EndorsementRow {
    id: string;
    employee_id: string;
    airport: string;
    position: string;
    issue_date: string | null;
    expiry_date: string | null;
    status: string;
    profile?: { full_name: string; employee_id: string };
}

interface TrainingRecord {
    emp_id: string;
    name: string;
    license_number: string;
    ojti: Record<string, boolean>;
    examiner: Record<string, boolean>;
    completion_dates: Record<string, string>;
    instructor_validity: Record<string, string>;
    examiner_validity: Record<string, string>;
}

interface ElpaRecord {
    emp_id: string;
    name: string;
    level: string | null;
    valid_upto: string | null;
    endorsed_upto: string | null;
}

interface MedicalSyncRecord {
    emp_id: string;
    name: string;
    last_medical: string | null;
    endorsed_upto: string | null;
    status: string | null;
    history: Record<string, string>;
}



// ---------- Hooks ----------
function useAllLicenses() {
    return useQuery({
        queryKey: ['all-licenses'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_licenses')
                .select('*')
                .order('expiry_date', { ascending: true });
            if (error) throw error;
            const licenses = (data || []) as unknown as LicenseRow[];

            const userIds = new Set<string>();
            for (const l of licenses) { if (l.user_id) userIds.add(l.user_id); }

            let profileMap: Record<string, { full_name: string; employee_id: string }> = {};
            if (userIds.size > 0) {
                const { data: profiles } = await supabase.from('profiles').select('id, full_name, employee_id').in('id', Array.from(userIds));
                if (profiles) { for (const p of profiles) { profileMap[p.id] = { full_name: p.full_name, employee_id: p.employee_id }; } }
            }

            return licenses.map((l) => ({ ...l, profile: profileMap[l.user_id] || undefined }));
        },
        staleTime: 5 * 60 * 1000,
    });
}

function useAllEndorsements() {
    return useQuery({
        queryKey: ['all-endorsements'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('unit_endorsements' as any)
                .select('*')
                .order('expiry_date', { ascending: true });
            if (error) throw error;
            const endorsements = (data || []) as unknown as EndorsementRow[];

            const empIds = new Set<string>();
            for (const e of endorsements) { if (e.employee_id) empIds.add(e.employee_id); }

            let profileMap: Record<string, { full_name: string; employee_id: string }> = {};
            if (empIds.size > 0) {
                const { data: profiles } = await supabase.from('profiles').select('id, full_name, employee_id').in('id', Array.from(empIds));
                if (profiles) { for (const p of profiles) { profileMap[p.id] = { full_name: p.full_name, employee_id: p.employee_id }; } }
            }

            return endorsements.map((e) => ({ ...e, profile: profileMap[e.employee_id] || undefined }));
        },
        staleTime: 5 * 60 * 1000,
    });
}

function useTrainingData() {
    return useQuery<TrainingRecord[]>({
        queryKey: ['training-data'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_training_records' as any)
                .select('emp_id, employee_name, license_number, ojti, examiner, completion_dates, instructor_validity, examiner_validity')
                .order('employee_name', { ascending: true });

            if (error) throw error;

            return ((data || []) as unknown as Array<{
                emp_id: string;
                employee_name: string;
                license_number: string | null;
                ojti: Record<string, boolean> | null;
                examiner: Record<string, boolean> | null;
                completion_dates: Record<string, string> | null;
                instructor_validity: Record<string, string> | null;
                examiner_validity: Record<string, string> | null;
            }>).map((row) => ({
                emp_id: row.emp_id,
                name: row.employee_name,
                license_number: row.license_number || '',
                ojti: row.ojti || {},
                examiner: row.examiner || {},
                completion_dates: row.completion_dates || {},
                instructor_validity: row.instructor_validity || {},
                examiner_validity: row.examiner_validity || {},
            }));
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
}

function useSyncTrainingData() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            const { data, error } = await supabase.functions.invoke('fetch-training-data', { body: {} });
            if (!error) return data;

            if (import.meta.env.DEV) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw error;

                const base =
                    import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL ||
                    'https://shift-atco.vercel.app';

                const res = await fetch(`${base}/api/functions/fetch-training-data`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                });

                if (res.ok) return res.json();

                const errBody = await res.json().catch(() => ({}));
                throw new Error(
                    errBody.error ||
                    error.message ||
                    `Edge function failed via proxy: HTTP ${res.status}`,
                );
            }

            throw error;
        },
        onSuccess: async (result: { upserted?: number } | undefined) => {
            await qc.invalidateQueries({ queryKey: ['training-data'] });
            toast.success(`Training data synced${result?.upserted ? ` (${result.upserted} records)` : ''}`);
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to sync training data');
        },
    });
}

function useUpdateTrainingRecord() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (record: {
            emp_id: string;
            completion_dates: Record<string, string>;
            instructor_validity: Record<string, string>;
            examiner_validity: Record<string, string>;
            ojti: Record<string, boolean>;
            examiner: Record<string, boolean>;
        }) => {
            const { error } = await supabase
                .from('employee_training_records' as any)
                .update({
                    completion_dates: record.completion_dates,
                    instructor_validity: record.instructor_validity,
                    examiner_validity: record.examiner_validity,
                    ojti: record.ojti,
                    examiner: record.examiner,
                } as any)
                .eq('emp_id', record.emp_id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['training-data'] });
            toast.success('Training record updated');
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to update training record');
        },
    });
}

function useUpdateElpaRecord() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (record: { emp_id: string; elpa_level: string | null; elpa_valid_upto: string | null; elpa_endorsed_upto: string | null }) => {
            const { error } = await supabase
                .from('employee_training_records' as any)
                .update({
                    elpa_level: record.elpa_level,
                    elpa_valid_upto: record.elpa_valid_upto || null,
                    elpa_endorsed_upto: record.elpa_endorsed_upto || null,
                } as any)
                .eq('emp_id', record.emp_id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['elpa-data'] });
            toast.success('ELPA record updated');
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to update ELPA record'),
    });
}

function useUpdateMedicalRecord() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (record: { emp_id: string; med_last_date: string | null; med_endorsed_upto: string | null; med_status: string | null }) => {
            const { error } = await supabase
                .from('employee_training_records' as any)
                .update({
                    med_last_date: record.med_last_date || null,
                    med_endorsed_upto: record.med_endorsed_upto || null,
                    med_status: record.med_status || null,
                } as any)
                .eq('emp_id', record.emp_id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['medical-sync-data'] });
            toast.success('Medical record updated');
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to update medical record'),
    });
}

function useElpaData() {
    return useQuery<ElpaRecord[]>({
        queryKey: ['elpa-data'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_training_records' as any)
                .select('emp_id, employee_name, elpa_level, elpa_valid_upto, elpa_endorsed_upto')
                .not('elpa_level', 'is', null)
                .order('employee_name', { ascending: true });

            if (error) throw error;

            return ((data || []) as unknown as Array<{
                emp_id: string;
                employee_name: string;
                elpa_level: string | null;
                elpa_valid_upto: string | null;
                elpa_endorsed_upto: string | null;
            }>).map((row) => ({
                emp_id: row.emp_id,
                name: row.employee_name,
                level: row.elpa_level,
                valid_upto: row.elpa_valid_upto,
                endorsed_upto: row.elpa_endorsed_upto,
            }));
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
}

function useSyncElpaData() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            const { data, error } = await supabase.functions.invoke('fetch-elpa-data', { body: {} });
            if (!error) return data;

            if (import.meta.env.DEV) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw error;

                const base =
                    import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL ||
                    'https://shift-atco.vercel.app';

                const res = await fetch(`${base}/api/functions/fetch-elpa-data`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                });

                if (res.ok) return res.json();

                const errBody = await res.json().catch(() => ({}));
                throw new Error(
                    errBody.error ||
                    error.message ||
                    `Edge function failed via proxy: HTTP ${res.status}`,
                );
            }

            throw error;
        },
        onSuccess: async (result: { upserted?: number } | undefined) => {
            await qc.invalidateQueries({ queryKey: ['elpa-data'] });
            toast.success(`ELPA data synced${result?.upserted ? ` (${result.upserted} records)` : ''}`);
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to sync ELPA data');
        },
    });
}

function useMedicalSyncData() {
    return useQuery<MedicalSyncRecord[]>({
        queryKey: ['medical-sync-data'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_training_records' as any)
                .select('emp_id, employee_name, med_last_date, med_endorsed_upto, med_status, med_history')
                .not('med_status', 'is', null)
                .order('employee_name', { ascending: true });

            if (error) throw error;

            return ((data || []) as unknown as Array<{
                emp_id: string;
                employee_name: string;
                med_last_date: string | null;
                med_endorsed_upto: string | null;
                med_status: string | null;
                med_history: Record<string, string> | null;
            }>).map((row) => ({
                emp_id: row.emp_id,
                name: row.employee_name,
                last_medical: row.med_last_date,
                endorsed_upto: row.med_endorsed_upto,
                status: row.med_status,
                history: row.med_history || {},
            }));
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
}

function useSyncMedicalData() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            const { data, error } = await supabase.functions.invoke('fetch-medical-data', { body: {} });
            if (!error) return data;

            if (import.meta.env.DEV) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw error;

                const base =
                    import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL ||
                    'https://shift-atco.vercel.app';

                const res = await fetch(`${base}/api/functions/fetch-medical-data`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                });

                if (res.ok) return res.json();

                const errBody = await res.json().catch(() => ({}));
                throw new Error(
                    errBody.error ||
                    error.message ||
                    `Edge function failed via proxy: HTTP ${res.status}`,
                );
            }

            throw error;
        },
        onSuccess: async (result: { upserted?: number } | undefined) => {
            await qc.invalidateQueries({ queryKey: ['medical-sync-data'] });
            toast.success(`Medical data synced${result?.upserted ? ` (${result.upserted} records)` : ''}`);
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to sync medical data');
        },
    });
}

// ---------- Helpers ----------
function formatDays(totalDays: number): string {
    const abs = Math.abs(totalDays);
    if (abs <= 365) return `${abs}d`;
    const years = Math.floor(abs / 365);
    const remaining = abs % 365;
    const months = Math.floor(remaining / 30);
    const days = remaining % 30;
    const parts: string[] = [];
    if (years > 0) parts.push(`${years}y`);
    if (months > 0) parts.push(`${months}m`);
    if (days > 0) parts.push(`${days}d`);
    return parts.join(' ') || '0d';
}

const RATING_LABELS: Record<string, string> = {
    rdr: 'Radar', app: 'Approach', plr: 'Precision',
    adc: 'Aerodrome', alpha: 'Alpha', occ: 'Oceanic',
};

const POSITION_LABELS: Record<string, string> = {
    ADC: 'ADC',
    APP: 'APP',
    ACC: 'ACC',
    'ACC(S)': 'ACC(S)',
    OCC: 'OCC',
    PLR: 'PLR',
    SCC: 'SCC',
    ART: 'ART',
};

const TRAINING_VALIDITY_OPTIONS = ['ADC', 'APP+APP(S)', 'ACC', 'ACC+ACC(S)', 'OCC', 'PLR'] as const;

function getExpiryBadge(expiryDate: string | null) {
    if (!expiryDate) return <Badge variant="secondary" className="text-[10px]">N/A</Badge>;
    const days = differenceInDays(new Date(expiryDate), startOfDay(new Date()));
    if (days < 0) return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Expired</Badge>;
    if (days <= 30) return <Badge className="bg-red-100 text-red-600 border-red-200 text-[10px]">{days}d left</Badge>;
    if (days <= 90) return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">{days}d left</Badge>;
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Valid</Badge>;
}

function parseTrainingDate(raw: string | undefined): string | null {
    if (!raw) return null;

    const trimmed = raw.trim();
    const dashMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dashMatch) {
        return `${dashMatch[3]}-${dashMatch[2]}-${dashMatch[1]}`;
    }

    const jsDateMatch = trimmed.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\b/);
    if (jsDateMatch) {
        const months: Record<string, string> = {
            Jan: '01',
            Feb: '02',
            Mar: '03',
            Apr: '04',
            May: '05',
            Jun: '06',
            Jul: '07',
            Aug: '08',
            Sep: '09',
            Oct: '10',
            Nov: '11',
            Dec: '12',
        };
        const month = months[jsDateMatch[1]];
        if (month) {
            return `${jsDateMatch[3]}-${month}-${String(jsDateMatch[2]).padStart(2, '0')}`;
        }
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function ValidityBadge({ dateStr, label }: { dateStr?: string; label?: string }) {
    if (!dateStr) return <span className="text-xs text-muted-foreground">-</span>;

    const parsed = parseTrainingDate(dateStr);
    if (!parsed) return <span className="text-xs">{dateStr}</span>;

    const days = differenceInDays(new Date(parsed), startOfDay(new Date()));

    if (label) {
        // Compact badge with label for card summary display
        const colorCls = days < 0 ? 'bg-red-100 text-red-700 border-red-200' : days <= 90 ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200';
        return (
            <Badge className={`${colorCls} text-[10px] font-normal`}>
                {label}: {format(new Date(parsed), 'd MMM yy')}
            </Badge>
        );
    }

    return (
        <span className="text-xs">
            {format(new Date(parsed), 'd MMM yyyy')}
            {days < 0 ? (
                <Badge className="ml-1 bg-red-100 text-red-700 border-red-200 text-[10px]">Expired</Badge>
            ) : days <= 90 ? (
                <Badge className="ml-1 bg-amber-100 text-amber-700 border-amber-200 text-[10px]">{days}d</Badge>
            ) : (
                <Badge className="ml-1 bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Valid</Badge>
            )}
        </span>
    );
}

// ---------- Component ----------
export default function LicenseManagement() {
    const qc = useQueryClient();
    const { data: licenses = [] } = useAllLicenses();

    const { data: endorsements = [] } = useAllEndorsements();
    const { data: trainingData = [], isLoading: trainingLoading, error: trainingError, refetch: refetchTraining } = useTrainingData();
    const syncTrainingData = useSyncTrainingData();
    const updateTrainingRecord = useUpdateTrainingRecord();
    const { data: elpaData = [], isLoading: elpaLoading, refetch: refetchElpa } = useElpaData();
    const syncElpaData = useSyncElpaData();
    const { data: medSyncData = [], isLoading: medSyncLoading, refetch: refetchMedSync } = useMedicalSyncData();
    const syncMedicalData = useSyncMedicalData();
    const updateElpaRecord = useUpdateElpaRecord();
    const updateMedicalRecord = useUpdateMedicalRecord();

    const [elpaSearch, setElpaSearch] = useState('');
    const [elpaSort, setElpaSort] = useState<'name' | 'expiry-soonest' | 'expiry-latest' | 'level-high' | 'level-low'>('expiry-soonest');
    const [medSearch, setMedSearch] = useState('');
    const [medSort, setMedSort] = useState<'name' | 'severity' | 'expiry-soonest' | 'expiry-latest'>('severity');
    const [medFilter, setMedFilter] = useState<'all' | 'endorsement-pending' | 'pending' | 'tu' | 'ca35'>('all');
    const [viewingMedRecord, setViewingMedRecord] = useState<MedicalSyncRecord | null>(null);
    const [editingElpa, setEditingElpa] = useState<ElpaRecord | null>(null);
    const [elpaEditForm, setElpaEditForm] = useState<{ level: string; valid_upto: string; endorsed_upto: string }>({ level: '', valid_upto: '', endorsed_upto: '' });
    const [editingMed, setEditingMed] = useState<MedicalSyncRecord | null>(null);
    const [medEditForm, setMedEditForm] = useState<{ last_medical: string; endorsed_upto: string; status: string }>({ last_medical: '', endorsed_upto: '', status: '' });

    const [trainingSearch, setTrainingSearch] = useState('');
    const [trainingFilter, setTrainingFilter] = useState<'all' | 'has-ojti' | 'has-examiner' | 'expired' | 'no-qualification'>('all');
    const [trainingSort, setTrainingSort] = useState<'name' | 'expiry-soonest' | 'expiry-latest'>('expiry-soonest');
    const [editingRecord, setEditingRecord] = useState<TrainingRecord | null>(null);
    const [editForm, setEditForm] = useState<{
        completion_dates: Record<string, string>;
        instructor_validity: Record<string, string>;
        examiner_validity: Record<string, string>;
        ojti: Record<string, boolean>;
        examiner: Record<string, boolean>;
    } | null>(null);
    const [viewingRecord, setViewingRecord] = useState<TrainingRecord | null>(null);
    const [newFieldKey, setNewFieldKey] = useState('');
    const [newInstructorValidityKey, setNewInstructorValidityKey] = useState<string>('');
    const [newInstructorValidityDate, setNewInstructorValidityDate] = useState('');
    const [newExaminerValidityKey, setNewExaminerValidityKey] = useState<string>('');
    const [newExaminerValidityDate, setNewExaminerValidityDate] = useState('');

    const openEditDialog = useCallback((record: TrainingRecord) => {
        setEditingRecord(record);
        setEditForm({
            completion_dates: { ...record.completion_dates },
            instructor_validity: { ...record.instructor_validity },
            examiner_validity: { ...record.examiner_validity },
            ojti: { ...record.ojti },
            examiner: { ...record.examiner },
        });
        setNewFieldKey('');
        setNewInstructorValidityKey('');
        setNewInstructorValidityDate('');
        setNewExaminerValidityKey('');
        setNewExaminerValidityDate('');
    }, []);

    const handleSaveEdit = useCallback(() => {
        if (!editingRecord || !editForm) return;
        updateTrainingRecord.mutate({
            emp_id: editingRecord.emp_id,
            ...editForm,
        }, {
            onSuccess: () => {
                setEditingRecord(null);
                setEditForm(null);
            },
        });
    }, [editingRecord, editForm, updateTrainingRecord]);

    const filteredTraining = useMemo(() => {
        const query = trainingSearch.trim().toLowerCase();
        const today = startOfDay(new Date());

        const getRecordSummary = (record: TrainingRecord) => {
            const ojtiPositions = Object.entries(record.ojti || {}).filter(([, value]) => value).map(([key]) => key);
            const examinerPositions = Object.entries(record.examiner || {}).filter(([, value]) => value).map(([key]) => key);
            const validityDates = [...Object.values(record.instructor_validity || {}), ...Object.values(record.examiner_validity || {})]
                .map((value) => parseTrainingDate(value))
                .filter((value): value is string => Boolean(value));
            const expiryOffsets = validityDates.map((value) => differenceInDays(new Date(value), today));
            const nextExpiryDays = expiryOffsets.length > 0 ? Math.min(...expiryOffsets) : Number.POSITIVE_INFINITY;
            const hasExpired = expiryOffsets.some((days) => days < 0);
            const hasNoQualification = ojtiPositions.length === 0 && examinerPositions.length === 0;

            return {
                ojtiPositions,
                examinerPositions,
                hasExpired,
                hasNoQualification,
                nextExpiryDays,
            };
        };

        return [...trainingData]
            .filter((record) => {
                if (query && !(
                    record.name.toLowerCase().includes(query)
                    || record.emp_id.toLowerCase().includes(query)
                    || record.license_number.toLowerCase().includes(query)
                )) {
                    return false;
                }

                const summary = getRecordSummary(record);

                switch (trainingFilter) {
                    case 'has-ojti':
                        return summary.ojtiPositions.length > 0;
                    case 'has-examiner':
                        return summary.examinerPositions.length > 0;
                    case 'expired':
                        return summary.hasExpired;
                    case 'no-qualification':
                        return summary.hasNoQualification;
                    default:
                        return true;
                }
            })
            .sort((left, right) => {
                const leftSummary = getRecordSummary(left);
                const rightSummary = getRecordSummary(right);

                if (trainingSort === 'expiry-soonest') {
                    if (leftSummary.nextExpiryDays !== rightSummary.nextExpiryDays) {
                        return leftSummary.nextExpiryDays - rightSummary.nextExpiryDays;
                    }
                }

                if (trainingSort === 'expiry-latest') {
                    if (leftSummary.nextExpiryDays !== rightSummary.nextExpiryDays) {
                        return rightSummary.nextExpiryDays - leftSummary.nextExpiryDays;
                    }
                }

                return left.name.localeCompare(right.name);
            });
    }, [trainingData, trainingSearch, trainingFilter, trainingSort]);

    // Expiry heatmap
    const expiryStats = useMemo(() => {
        const today = startOfDay(new Date());
        const all = [
            ...licenses.map((l) => ({ type: 'rating', expiry: l.expiry_date, name: l.profile?.full_name })),
            ...endorsements.map((e) => ({ type: 'endorsement', expiry: e.expiry_date, name: e.profile?.full_name })),
        ];
        const expired = all.filter((i) => i.expiry && new Date(i.expiry) < today);
        const in30 = all.filter((i) => {
            if (!i.expiry) return false;
            const d = differenceInDays(new Date(i.expiry), today);
            return d >= 0 && d <= 30;
        });
        const in90 = all.filter((i) => {
            if (!i.expiry) return false;
            const d = differenceInDays(new Date(i.expiry), today);
            return d > 30 && d <= 90;
        });
        return { expired, in30, in90, total: all.length };
    }, [licenses, endorsements]);



    // Endorsement form
    const [endDialogOpen, setEndDialogOpen] = useState(false);
    const [endForm, setEndForm] = useState({ employee_id: '', airport: 'VECC', position: '', issue_date: '', expiry_date: '' });

    // Profiles for dropdowns
    const { data: profiles = [] } = useQuery({
        queryKey: ['profiles-list'],
        queryFn: async () => {
            const { data } = await supabase.from('profiles').select('id, full_name, employee_id').order('full_name');
            return (data || []) as { id: string; full_name: string; employee_id: string }[];
        },
        staleTime: 10 * 60 * 1000,
    });

    // Mutations


    const addEndorsement = useMutation({
        mutationFn: async (form: typeof endForm) => {
            const { error } = await supabase.from('unit_endorsements' as any)
                .upsert({
                    employee_id: form.employee_id,
                    airport: form.airport,
                    position: form.position,
                    issue_date: form.issue_date || null,
                    expiry_date: form.expiry_date || null,
                    status: 'valid',
                } as any, { onConflict: 'employee_id,airport,position' });
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['all-endorsements'] });
            toast.success('Endorsement saved');
            setEndDialogOpen(false);
        },
        onError: (e: any) => toast.error(e.message),
    });

    return (
        <DashboardLayout role="supervisor">
            <div className="space-y-5">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Shield className="h-6 w-6 text-indigo-600" />
                        License Management
                    </h1>
                    <p className="text-muted-foreground text-sm">Ratings, medical certificates, unit endorsements and training data</p>
                </div>

                {/* Expiry Heatmap */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Card className="border-0 bg-gradient-to-br from-slate-700 to-slate-900 text-white">
                        <CardContent className="flex items-center justify-between py-3">
                            <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-white/75">
                                <Users className="h-4 w-4 opacity-70" />
                                <span>Total Records</span>
                            </div>
                            <div className="text-2xl font-bold">{expiryStats.total}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-red-900 bg-red-900/95">
                        <CardContent className="flex items-center justify-between py-3">
                            <div className="text-sm font-medium uppercase tracking-wide text-red-100">Expired</div>
                            <div className="text-2xl font-bold text-white">{expiryStats.expired.length}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-rose-200 bg-rose-50">
                        <CardContent className="flex items-center justify-between py-3">
                            <div className="text-sm font-medium uppercase tracking-wide text-rose-500">Expiring ≤ 30 days</div>
                            <div className="text-2xl font-bold text-rose-600">{expiryStats.in30.length}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-yellow-200 bg-yellow-50">
                        <CardContent className="flex items-center justify-between py-3">
                            <div className="text-sm font-medium uppercase tracking-wide text-yellow-600">Expiring ≤ 90 days</div>
                            <div className="text-2xl font-bold text-yellow-700">{expiryStats.in90.length}</div>
                        </CardContent>
                    </Card>
                </div>

                {/* Tabs */}
                <Tabs defaultValue="endorsements" className="w-full">
                    <TabsList className="flex h-auto flex-wrap">
                        <TabsTrigger value="endorsements">
                            <MapPin className="h-3.5 w-3.5 mr-1" /> Endorsements ({endorsements.length})
                        </TabsTrigger>
                        <TabsTrigger value="training">
                            <GraduationCap className="h-3.5 w-3.5 mr-1" /> Training ({trainingData.length})
                        </TabsTrigger>
                        <TabsTrigger value="elpa">
                            <Languages className="h-3.5 w-3.5 mr-1" /> ELPA ({elpaData.length})
                        </TabsTrigger>
                        <TabsTrigger value="medical">
                            <Stethoscope className="h-3.5 w-3.5 mr-1" /> Medical ({medSyncData.length})
                        </TabsTrigger>
                    </TabsList>

                    {/* Endorsements Tab */}
                    <TabsContent value="endorsements">
                        <Card>
                            <CardHeader className="py-2 px-4 flex flex-row items-center justify-between">
                                <CardTitle className="text-sm font-semibold">Unit Endorsements</CardTitle>
                                <Dialog open={endDialogOpen} onOpenChange={setEndDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button size="sm" onClick={() => setEndForm({ employee_id: '', airport: 'VECC', position: '', issue_date: '', expiry_date: '' })}>
                                            <Plus className="h-3.5 w-3.5 mr-1" /> Add Endorsement
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader><DialogTitle>Add / Update Unit Endorsement</DialogTitle></DialogHeader>
                                        <form onSubmit={(e) => { e.preventDefault(); addEndorsement.mutate(endForm); }} className="space-y-3">
                                            <div className="space-y-1">
                                                <Label>Employee</Label>
                                                <Select value={endForm.employee_id} onValueChange={(v) => setEndForm({ ...endForm, employee_id: v })}>
                                                    <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                                                    <SelectContent>
                                                        {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name} ({p.employee_id})</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <Label>Airport (ICAO)</Label>
                                                    <Input value={endForm.airport} onChange={(e) => setEndForm({ ...endForm, airport: e.target.value.toUpperCase() })} placeholder="VECC" />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label>Position</Label>
                                                    <Select value={endForm.position} onValueChange={(v) => setEndForm({ ...endForm, position: v })}>
                                                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="TWR">TWR</SelectItem>
                                                            <SelectItem value="APP">APP</SelectItem>
                                                            <SelectItem value="ACC">ACC</SelectItem>
                                                            <SelectItem value="SMC">SMC</SelectItem>
                                                            <SelectItem value="GND">GND</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <Label>Issue Date</Label>
                                                    <Input type="date" value={endForm.issue_date} onChange={(e) => setEndForm({ ...endForm, issue_date: e.target.value })} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label>Expiry Date</Label>
                                                    <Input type="date" value={endForm.expiry_date} onChange={(e) => setEndForm({ ...endForm, expiry_date: e.target.value })} />
                                                </div>
                                            </div>
                                            <Button type="submit" className="w-full" disabled={addEndorsement.isPending || !endForm.employee_id || !endForm.position}>
                                                {addEndorsement.isPending ? 'Saving...' : 'Save'}
                                            </Button>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b bg-muted/50">
                                                <th className="px-4 py-2 text-left font-medium">Employee</th>
                                                <th className="px-4 py-2 text-left font-medium">Airport</th>
                                                <th className="px-4 py-2 text-left font-medium">Position</th>
                                                <th className="px-4 py-2 text-left font-medium">Issued</th>
                                                <th className="px-4 py-2 text-left font-medium">Expires</th>
                                                <th className="px-4 py-2 text-center font-medium">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {endorsements.map((e) => (
                                                <tr key={e.id} className="border-b hover:bg-muted/30">
                                                    <td className="px-4 py-2.5">
                                                        <div className="font-medium">{e.profile?.full_name || '—'}</div>
                                                        <div className="text-xs text-muted-foreground">{e.profile?.employee_id}</div>
                                                    </td>
                                                    <td className="px-4 py-2.5">{e.airport}</td>
                                                    <td className="px-4 py-2.5">{e.position}</td>
                                                    <td className="px-4 py-2.5 text-muted-foreground">
                                                        {e.issue_date ? format(new Date(e.issue_date), 'd MMM yyyy') : '—'}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-muted-foreground">
                                                        {e.expiry_date ? format(new Date(e.expiry_date), 'd MMM yyyy') : '—'}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-center">{getExpiryBadge(e.expiry_date)}</td>
                                                </tr>
                                            ))}
                                            {endorsements.length === 0 && (
                                                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No endorsements</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="training">
                        <Card>
                            <CardHeader className="space-y-2.5 px-3 py-3 md:space-y-3 md:px-4">
                                <CardTitle className="text-xs font-semibold md:text-base">OJTI & Examiner Training Records</CardTitle>

                                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground md:top-3 md:h-3.5 md:w-3.5" />
                                        <Input
                                            value={trainingSearch}
                                            onChange={(e) => setTrainingSearch(e.target.value)}
                                            placeholder="Search name, ID or license"
                                            className="h-7 w-full pl-7 pr-8 text-xs md:h-10 md:pl-8 md:text-[15px]"
                                        />
                                        {trainingSearch && (
                                            <Button
                                                type="button"
                                                size="icon"
                                                variant="ghost"
                                                className="absolute right-1 top-0.5 h-6 w-6 text-muted-foreground hover:text-foreground md:top-1.5 md:h-7 md:w-7"
                                                onClick={() => setTrainingSearch('')}
                                            >
                                                <X className="h-3 w-3 md:h-3.5 md:w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                    <Button size="sm" className="h-8 text-xs md:h-10 md:px-4 md:text-[15px]" onClick={() => syncTrainingData.mutate()} disabled={syncTrainingData.isPending}>
                                        <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncTrainingData.isPending ? 'animate-spin' : ''}`} />
                                        {syncTrainingData.isPending ? 'Syncing...' : 'Fetch & Save'}
                                    </Button>
                                </div>

                                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-end">
                                    <div className="space-y-1 md:w-[190px]">
                                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">Filter</Label>
                                        <Select value={trainingFilter} onValueChange={(value) => setTrainingFilter(value as typeof trainingFilter)}>
                                            <SelectTrigger className="h-7 w-full text-xs md:h-9 md:text-[15px]">
                                                <SelectValue placeholder="Filter records" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">All records</SelectItem>
                                                <SelectItem value="has-ojti">Has OJTI</SelectItem>
                                                <SelectItem value="has-examiner">Has Examiner</SelectItem>
                                                <SelectItem value="expired">Expired validity</SelectItem>
                                                <SelectItem value="no-qualification">No OJTI or Examiner</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1 md:w-[205px]">
                                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">Sort</Label>
                                        <Select value={trainingSort} onValueChange={(value) => setTrainingSort(value as typeof trainingSort)}>
                                            <SelectTrigger className="h-7 w-full text-xs md:h-9 md:text-[15px]">
                                                <SelectValue placeholder="Sort records" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="expiry-soonest">Expiring soonest first</SelectItem>
                                                <SelectItem value="expiry-latest">Expiring latest first</SelectItem>
                                                <SelectItem value="name">Name A-Z</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">Actions</Label>
                                        <Button size="sm" variant="outline" className="h-8 w-full text-xs md:h-9 md:px-4 md:text-[15px]" onClick={() => refetchTraining()} disabled={trainingLoading}>
                                            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${trainingLoading ? 'animate-spin' : ''}`} />
                                            Reload
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-3 md:p-5">
                                {trainingError ? (
                                    <div className="py-10 text-center text-sm text-red-600">
                                        <AlertTriangle className="mx-auto mb-2 h-5 w-5" />
                                        {(trainingError as Error).message}
                                    </div>
                                ) : trainingLoading ? (
                                    <div className="py-10 text-center text-sm text-muted-foreground">
                                        <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
                                        Loading saved training data...
                                    </div>
                                ) : filteredTraining.length === 0 ? (
                                    <div className="py-10 text-center text-muted-foreground text-sm">
                                        {trainingData.length === 0 ? 'No training data available. Click "Fetch & Save" to sync from webapp.' : 'No matching employees found'}
                                    </div>
                                ) : (
                                    <div className="grid gap-2 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3 md:gap-3">
                                        {filteredTraining.map((record) => {
                                            const ojtiPositions = Object.entries(record.ojti || {}).filter(([, v]) => v).map(([k]) => k);
                                            const examinerPositions = Object.entries(record.examiner || {}).filter(([, v]) => v).map(([k]) => k);
                                            const completionCount = Object.keys(record.completion_dates || {}).length;
                                            const instrCount = Object.keys(record.instructor_validity || {}).length;
                                            const examValCount = Object.keys(record.examiner_validity || {}).length;
                                            const validityEntries = [
                                                ...Object.entries(record.instructor_validity || {}),
                                                ...Object.entries(record.examiner_validity || {}),
                                            ]
                                                .map(([unit, value]) => {
                                                    const parsed = parseTrainingDate(value);
                                                    if (!parsed) return null;

                                                    return {
                                                        unit,
                                                        days: differenceInDays(new Date(parsed), startOfDay(new Date())),
                                                    };
                                                })
                                                .filter((entry): entry is { unit: string; days: number } => Boolean(entry));
                                            const minValidityEntry = validityEntries.length > 0
                                                ? validityEntries.reduce((currentMin, entry) => entry.days < currentMin.days ? entry : currentMin)
                                                : null;
                                            const minValidityDays = minValidityEntry?.days ?? null;

                                            // Check for any expired validity
                                            const hasExpired = minValidityDays !== null && minValidityDays < 0;
                                            const hasCriticalExpiry = minValidityDays !== null && !hasExpired && minValidityDays < 30;

                                            const hasExpiring = minValidityDays !== null && !hasExpired && minValidityDays <= 90;

                                            return (
                                                <Card
                                                    key={record.emp_id}
                                                    className={`relative transition-shadow hover:shadow-md ${hasExpired ? 'border-red-700' : hasCriticalExpiry ? 'border-red-200' : hasExpiring ? 'border-amber-200' : ''}`}
                                                >
                                                    <CardContent className="space-y-2.5 p-3 md:space-y-3.5 md:p-5">
                                                        {(hasExpired || hasExpiring) && minValidityDays !== null && (
                                                            <div className="flex justify-start">
                                                                <Badge
                                                                    className={
                                                                        minValidityDays < 0
                                                                            ? 'border-red-800 bg-red-800 text-white'
                                                                            : minValidityDays < 30
                                                                                ? 'border-red-200 bg-red-100 text-red-700'
                                                                                : minValidityDays <= 90
                                                                                ? 'border-amber-200 bg-amber-100 text-amber-700'
                                                                                : 'border-emerald-200 bg-emerald-100 text-emerald-700'
                                                                    }
                                                                >
                                                                    {minValidityDays < 0
                                                                        ? `${minValidityEntry?.unit}: ${formatDays(minValidityDays)} overdue`
                                                                        : `${minValidityEntry?.unit}: ${formatDays(minValidityDays)} left`}
                                                                </Badge>
                                                            </div>
                                                        )}
                                                        {/* Header */}
                                                        <div className="flex items-start justify-between">
                                                            <div>
                                                                <div className="text-xs font-semibold md:text-base">{record.name}</div>
                                                                <div className="text-[11px] text-muted-foreground md:text-sm">{record.emp_id} · {record.license_number || 'No license'}</div>
                                                            </div>
                                                            <div className="flex gap-1">
                                                                <TooltipProvider>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <Button size="icon" variant="ghost" className="h-6 w-6 md:h-8 md:w-8" onClick={() => setViewingRecord(record)}>
                                                                                <Eye className="h-3 w-3 md:h-3.5 md:w-3.5" />
                                                                            </Button>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent>View details</TooltipContent>
                                                                    </Tooltip>
                                                                </TooltipProvider>
                                                                <TooltipProvider>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <Button size="icon" variant="ghost" className="h-6 w-6 md:h-8 md:w-8" onClick={() => openEditDialog(record)}>
                                                                                <Pencil className="h-3 w-3 md:h-3.5 md:w-3.5" />
                                                                            </Button>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent>Edit record</TooltipContent>
                                                                    </Tooltip>
                                                                </TooltipProvider>
                                                            </div>
                                                        </div>

                                                        {/* OJTI & Examiner badges */}
                                                        <div className="space-y-1">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="w-12 shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground md:w-16 md:text-xs">OJTI</span>
                                                                {ojtiPositions.length > 0 ? ojtiPositions.map((pos) => (
                                                                    <Badge key={pos} className="border-indigo-200 bg-indigo-100 px-1.5 py-0 text-[9px] font-medium text-indigo-700 md:text-xs">{pos}</Badge>
                                                                )) : <span className="text-[11px] text-muted-foreground md:text-sm">None</span>}
                                                            </div>
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="w-12 shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground md:w-16 md:text-xs">Examiner</span>
                                                                {examinerPositions.length > 0 ? examinerPositions.map((pos) => (
                                                                    <Badge key={pos} className="border-purple-200 bg-purple-100 px-1.5 py-0 text-[9px] font-medium text-purple-700 md:text-xs">{pos}</Badge>
                                                                )) : <span className="text-[11px] text-muted-foreground md:text-sm">None</span>}
                                                            </div>
                                                        </div>

                                                        {/* Quick validity summary */}
                                                        {(instrCount > 0 || examValCount > 0) && (
                                                            <>
                                                                <Separator />
                                                                <div className="space-y-1">
                                                                    {instrCount > 0 && (
                                                                        <div className="flex items-center gap-2">
                                                                                            <span className="w-20 shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground md:w-28 md:text-xs">Instructor Validity</span>
                                                                            <div className="flex flex-wrap gap-1">
                                                                                {Object.entries(record.instructor_validity).map(([key, val]) => (
                                                                                    <ValidityBadge key={key} label={key} dateStr={val} />
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {instrCount > 0 && examValCount > 0 && <Separator className="my-2" />}
                                                                    {examValCount > 0 && (
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="w-20 shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground md:w-28 md:text-xs">Examiner Validity</span>
                                                                            <div className="flex flex-wrap gap-1">
                                                                                {Object.entries(record.examiner_validity).map(([key, val]) => (
                                                                                    <ValidityBadge key={key} label={key} dateStr={val} />
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </>
                                                        )}

                                                        {/* Completion dates summary */}
                                                        {completionCount > 0 && (
                                                            <>
                                                                <Separator />
                                                                <div>
                                                                    <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground md:text-xs">Date of Completion</span>
                                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                                        {Object.entries(record.completion_dates).map(([key, val]) => {
                                                                            const parsed = parseTrainingDate(val);
                                                                            return (
                                                                                <Badge key={key} variant="outline" className="px-1.5 py-0 text-[9px] font-normal md:text-xs">
                                                                                    {key}: {parsed ? format(new Date(parsed), 'd MMM yyyy') : val}
                                                                                </Badge>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            </>
                                                        )}
                                                    </CardContent>
                                                </Card>
                                            );
                                        })}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* View Details Dialog */}
                        <Dialog open={!!viewingRecord} onOpenChange={(open) => { if (!open) setViewingRecord(null); }}>
                            <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2">
                                        <GraduationCap className="h-5 w-5 text-indigo-600" />
                                        {viewingRecord?.name}
                                    </DialogTitle>
                                    <DialogDescription>
                                        {viewingRecord?.emp_id} · License: {viewingRecord?.license_number || 'N/A'}
                                    </DialogDescription>
                                </DialogHeader>
                                {viewingRecord && (
                                    <ScrollArea className="flex-1 -mx-6 px-6">
                                        <div className="space-y-5 pb-4">
                                            {/* OJTI Qualifications */}
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                                                    <Award className="h-3.5 w-3.5" /> OJTI Qualifications
                                                </h4>
                                                <div className="flex flex-wrap gap-2">
                                                    {Object.entries(viewingRecord.ojti || {}).map(([key, val]) => (
                                                        <div key={key} className="flex items-center gap-1.5">
                                                            {val ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-slate-300" />}
                                                            <span className="text-sm">{key}</span>
                                                        </div>
                                                    ))}
                                                    {Object.keys(viewingRecord.ojti || {}).length === 0 && <span className="text-sm text-muted-foreground">No OJTI qualifications</span>}
                                                </div>
                                            </div>

                                            {/* Examiner Qualifications */}
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                                                    <Award className="h-3.5 w-3.5" /> Examiner Qualifications
                                                </h4>
                                                <div className="flex flex-wrap gap-2">
                                                    {Object.entries(viewingRecord.examiner || {}).map(([key, val]) => (
                                                        <div key={key} className="flex items-center gap-1.5">
                                                            {val ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-slate-300" />}
                                                            <span className="text-sm">{key}</span>
                                                        </div>
                                                    ))}
                                                    {Object.keys(viewingRecord.examiner || {}).length === 0 && <span className="text-sm text-muted-foreground">No Examiner qualifications</span>}
                                                </div>
                                            </div>

                                            <Separator />

                                            {/* Completion Dates */}
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                                                    <Calendar className="h-3.5 w-3.5" /> Completion Dates
                                                </h4>
                                                {Object.keys(viewingRecord.completion_dates || {}).length > 0 ? (
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {Object.entries(viewingRecord.completion_dates).map(([key, val]) => {
                                                            const parsed = parseTrainingDate(val);
                                                            return (
                                                                <div key={key} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-1.5">
                                                                    <span className="text-xs font-medium">{POSITION_LABELS[key] || key}</span>
                                                                    <span className="text-xs text-muted-foreground">{parsed ? format(new Date(parsed), 'd MMM yyyy') : val}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : <span className="text-sm text-muted-foreground">No completion dates recorded</span>}
                                            </div>

                                            {/* Instructor Validity */}
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                                                    <Shield className="h-3.5 w-3.5" /> Instructor Validity
                                                </h4>
                                                {Object.keys(viewingRecord.instructor_validity || {}).length > 0 ? (
                                                    <div className="space-y-1.5">
                                                        {Object.entries(viewingRecord.instructor_validity).map(([key, val]) => (
                                                            <div key={key} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-1.5">
                                                                <span className="text-xs font-medium">{key}</span>
                                                                <ValidityBadge label={key} dateStr={val} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : <span className="text-sm text-muted-foreground">No instructor validity data</span>}
                                            </div>

                                            {/* Examiner Validity */}
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                                                    <Shield className="h-3.5 w-3.5" /> Examiner Validity
                                                </h4>
                                                {Object.keys(viewingRecord.examiner_validity || {}).length > 0 ? (
                                                    <div className="space-y-1.5">
                                                        {Object.entries(viewingRecord.examiner_validity).map(([key, val]) => (
                                                            <div key={key} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-1.5">
                                                                <span className="text-xs font-medium">{key}</span>
                                                                <ValidityBadge label={key} dateStr={val} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : <span className="text-sm text-muted-foreground">No examiner validity data</span>}
                                            </div>
                                        </div>
                                    </ScrollArea>
                                )}
                            </DialogContent>
                        </Dialog>

                        {/* Edit Dialog */}
                        <Dialog open={!!editingRecord} onOpenChange={(open) => { if (!open) { setEditingRecord(null); setEditForm(null); } }}>
                            <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2">
                                        <Pencil className="h-4 w-4 text-indigo-600" />
                                        Edit Training — {editingRecord?.name}
                                    </DialogTitle>
                                    <DialogDescription>
                                        {editingRecord?.emp_id} · License: {editingRecord?.license_number || 'N/A'}
                                    </DialogDescription>
                                </DialogHeader>
                                {editForm && editingRecord && (
                                    <ScrollArea className="flex-1 -mx-6 px-6">
                                        <div className="space-y-6 pb-4">
                                            {/* OJTI Toggles */}
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">OJTI Qualifications</h4>
                                                <div className="flex flex-wrap gap-2">
                                                    {Object.entries(editForm.ojti).map(([key, val]) => (
                                                        <Button
                                                            key={key}
                                                            size="sm"
                                                            variant={val ? 'default' : 'outline'}
                                                            className={`text-xs ${val ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                                                            onClick={() => setEditForm({ ...editForm, ojti: { ...editForm.ojti, [key]: !val } })}
                                                        >
                                                            {val ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
                                                            {key}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Examiner Toggles */}
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Examiner Qualifications</h4>
                                                <div className="flex flex-wrap gap-2">
                                                    {Object.entries(editForm.examiner).map(([key, val]) => (
                                                        <Button
                                                            key={key}
                                                            size="sm"
                                                            variant={val ? 'default' : 'outline'}
                                                            className={`text-xs ${val ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                                                            onClick={() => setEditForm({ ...editForm, examiner: { ...editForm.examiner, [key]: !val } })}
                                                        >
                                                            {val ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
                                                            {key}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>

                                            <Separator />

                                            {/* Completion Dates */}
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                                                    <Calendar className="h-3.5 w-3.5" /> Completion Dates
                                                </h4>
                                                <div className="grid grid-cols-2 gap-3">
                                                    {Object.entries(editForm.completion_dates).map(([key, val]) => {
                                                        const parsed = parseTrainingDate(val);
                                                        return (
                                                            <div key={key} className="space-y-1">
                                                                <div className="flex items-center justify-between">
                                                                    <Label className="text-xs">{POSITION_LABELS[key] || key}</Label>
                                                                    <Button
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-5 w-5 text-muted-foreground hover:text-red-500"
                                                                        onClick={() => {
                                                                            const updated = { ...editForm.completion_dates };
                                                                            delete updated[key];
                                                                            setEditForm({ ...editForm, completion_dates: updated });
                                                                        }}
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                    </Button>
                                                                </div>
                                                                <Input
                                                                    type="date"
                                                                    className="h-8 text-xs"
                                                                    value={parsed || ''}
                                                                    onChange={(e) => setEditForm({ ...editForm, completion_dates: { ...editForm.completion_dates, [key]: e.target.value } })}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <div className="flex items-center gap-2 mt-2">
                                                    <Input
                                                        placeholder="New key (e.g. ART)"
                                                        className="h-8 text-xs w-32"
                                                        value={newFieldKey}
                                                        onChange={(e) => setNewFieldKey(e.target.value.toUpperCase())}
                                                    />
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8 text-xs"
                                                        disabled={!newFieldKey.trim() || newFieldKey.trim() in editForm.completion_dates}
                                                        onClick={() => {
                                                            const key = newFieldKey.trim();
                                                            if (key) {
                                                                setEditForm({ ...editForm, completion_dates: { ...editForm.completion_dates, [key]: '' } });
                                                                setNewFieldKey('');
                                                            }
                                                        }}
                                                    >
                                                        <Plus className="mr-1 h-3 w-3" /> Add Completion
                                                    </Button>
                                                </div>
                                            </div>

                                            {/* Instructor Validity */}
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                                                    <Shield className="h-3.5 w-3.5" /> Instructor Validity
                                                </h4>
                                                <div className="grid grid-cols-2 gap-3">
                                                    {Object.entries(editForm.instructor_validity).map(([key, val]) => {
                                                        const parsed = parseTrainingDate(val);
                                                        return (
                                                            <div key={key} className="space-y-1">
                                                                <div className="flex items-center justify-between">
                                                                    <Label className="text-xs">{key}</Label>
                                                                    <Button
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-5 w-5 text-muted-foreground hover:text-red-500"
                                                                        onClick={() => {
                                                                            const updated = { ...editForm.instructor_validity };
                                                                            delete updated[key];
                                                                            setEditForm({ ...editForm, instructor_validity: updated });
                                                                        }}
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                    </Button>
                                                                </div>
                                                                <Input
                                                                    type="date"
                                                                    className="h-8 text-xs"
                                                                    value={parsed || ''}
                                                                    onChange={(e) => setEditForm({ ...editForm, instructor_validity: { ...editForm.instructor_validity, [key]: e.target.value } })}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[180px_160px_auto]">
                                                    <Select value={newInstructorValidityKey} onValueChange={setNewInstructorValidityKey}>
                                                        <SelectTrigger className="h-8 text-xs">
                                                            <SelectValue placeholder="Select validity type" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {TRAINING_VALIDITY_OPTIONS
                                                                .filter((option) => !(option in editForm.instructor_validity))
                                                                .map((option) => (
                                                                    <SelectItem key={option} value={option}>{option}</SelectItem>
                                                                ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <Input
                                                        type="date"
                                                        className="h-8 text-xs"
                                                        value={newInstructorValidityDate}
                                                        onChange={(e) => setNewInstructorValidityDate(e.target.value)}
                                                    />
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8 text-xs"
                                                        disabled={!newInstructorValidityKey || !newInstructorValidityDate || newInstructorValidityKey in editForm.instructor_validity}
                                                        onClick={() => {
                                                            if (newInstructorValidityKey && newInstructorValidityDate) {
                                                                setEditForm({
                                                                    ...editForm,
                                                                    instructor_validity: {
                                                                        ...editForm.instructor_validity,
                                                                        [newInstructorValidityKey]: newInstructorValidityDate,
                                                                    },
                                                                });
                                                                setNewInstructorValidityKey('');
                                                                setNewInstructorValidityDate('');
                                                            }
                                                        }}
                                                    >
                                                        <Plus className="mr-1 h-3 w-3" /> Add Instructor
                                                    </Button>
                                                </div>
                                            </div>

                                            {/* Examiner Validity */}
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                                                    <Shield className="h-3.5 w-3.5" /> Examiner Validity
                                                </h4>
                                                <div className="grid grid-cols-2 gap-3">
                                                    {Object.entries(editForm.examiner_validity).map(([key, val]) => {
                                                        const parsed = parseTrainingDate(val);
                                                        return (
                                                            <div key={key} className="space-y-1">
                                                                <div className="flex items-center justify-between">
                                                                    <Label className="text-xs">{key}</Label>
                                                                    <Button
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-5 w-5 text-muted-foreground hover:text-red-500"
                                                                        onClick={() => {
                                                                            const updated = { ...editForm.examiner_validity };
                                                                            delete updated[key];
                                                                            setEditForm({ ...editForm, examiner_validity: updated });
                                                                        }}
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                    </Button>
                                                                </div>
                                                                <Input
                                                                    type="date"
                                                                    className="h-8 text-xs"
                                                                    value={parsed || ''}
                                                                    onChange={(e) => setEditForm({ ...editForm, examiner_validity: { ...editForm.examiner_validity, [key]: e.target.value } })}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[180px_160px_auto]">
                                                    <Select value={newExaminerValidityKey} onValueChange={setNewExaminerValidityKey}>
                                                        <SelectTrigger className="h-8 text-xs">
                                                            <SelectValue placeholder="Select validity type" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {TRAINING_VALIDITY_OPTIONS
                                                                .filter((option) => !(option in editForm.examiner_validity))
                                                                .map((option) => (
                                                                    <SelectItem key={option} value={option}>{option}</SelectItem>
                                                                ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <Input
                                                        type="date"
                                                        className="h-8 text-xs"
                                                        value={newExaminerValidityDate}
                                                        onChange={(e) => setNewExaminerValidityDate(e.target.value)}
                                                    />
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8 text-xs"
                                                        disabled={!newExaminerValidityKey || !newExaminerValidityDate || newExaminerValidityKey in editForm.examiner_validity}
                                                        onClick={() => {
                                                            if (newExaminerValidityKey && newExaminerValidityDate) {
                                                                setEditForm({
                                                                    ...editForm,
                                                                    examiner_validity: {
                                                                        ...editForm.examiner_validity,
                                                                        [newExaminerValidityKey]: newExaminerValidityDate,
                                                                    },
                                                                });
                                                                setNewExaminerValidityKey('');
                                                                setNewExaminerValidityDate('');
                                                            }
                                                        }}
                                                    >
                                                        <Plus className="mr-1 h-3 w-3" /> Add Examiner
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    </ScrollArea>
                                )}
                                <div className="flex justify-end gap-2 pt-2 border-t">
                                    <Button variant="outline" onClick={() => { setEditingRecord(null); setEditForm(null); setNewInstructorValidityKey(''); setNewInstructorValidityDate(''); setNewExaminerValidityKey(''); setNewExaminerValidityDate(''); }}>Cancel</Button>
                                    <Button onClick={handleSaveEdit} disabled={updateTrainingRecord.isPending}>
                                        <Save className="mr-1 h-3.5 w-3.5" />
                                        {updateTrainingRecord.isPending ? 'Saving...' : 'Save Changes'}
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </TabsContent>

                    {/* ELPA Tab */}
                    <TabsContent value="elpa">
                        {(() => {
                            const today = startOfDay(new Date());

                            const getElpaDays = (record: ElpaRecord) => {
                                if (!record.valid_upto) return Number.POSITIVE_INFINITY;
                                return differenceInDays(new Date(record.valid_upto), today);
                            };

                            const filteredElpa = [...elpaData]
                                .filter((r) => {
                                    if (!elpaSearch.trim()) return true;
                                    const q = elpaSearch.trim().toLowerCase();
                                    return r.name.toLowerCase().includes(q) || r.emp_id.toLowerCase().includes(q) || (r.level || '').toLowerCase().includes(q);
                                })
                                .sort((a, b) => {
                                    if (elpaSort === 'expiry-soonest') return getElpaDays(a) - getElpaDays(b);
                                    if (elpaSort === 'expiry-latest') return getElpaDays(b) - getElpaDays(a);
                                    if (elpaSort === 'level-high') return Number(b.level || 0) - Number(a.level || 0);
                                    if (elpaSort === 'level-low') return Number(a.level || 0) - Number(b.level || 0);
                                    return a.name.localeCompare(b.name);
                                });

                            const elpaExpired = elpaData.filter((r) => r.valid_upto && getElpaDays(r) < 0).length;
                            const elpaExpiring = elpaData.filter((r) => { const d = getElpaDays(r); return d >= 0 && d <= 90; }).length;

                            const LEVEL_COLORS: Record<string, string> = {
                                '6': 'bg-emerald-100 text-emerald-700 border-emerald-200',
                                '5': 'bg-blue-100 text-blue-700 border-blue-200',
                                '4': 'bg-amber-100 text-amber-700 border-amber-200',
                                '3': 'bg-orange-100 text-orange-700 border-orange-200',
                                '2': 'bg-red-100 text-red-700 border-red-200',
                                '1': 'bg-red-200 text-red-800 border-red-300',
                            };

                            return (
                                <div className="space-y-3">
                                    {/* ELPA Header */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm md:text-base font-semibold flex items-center gap-1.5">
                                                <Languages className="h-4 w-4 text-indigo-600" /> ELPA Data
                                            </h3>
                                        </div>
                                        <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
                                            <div className="relative flex-1 max-w-xs">
                                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                                <Input
                                                    placeholder="Search name or ID..."
                                                    value={elpaSearch}
                                                    onChange={(e) => setElpaSearch(e.target.value)}
                                                    className="pl-7 h-7 md:h-8 text-xs md:text-sm"
                                                />
                                                {elpaSearch && (
                                                    <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5" onClick={() => setElpaSearch('')}>
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                            <Button
                                                size="sm"
                                                className="h-7 md:h-8 text-xs md:text-sm gap-1"
                                                onClick={() => syncElpaData.mutate()}
                                                disabled={syncElpaData.isPending}
                                            >
                                                <RefreshCw className={`h-3 w-3 ${syncElpaData.isPending ? 'animate-spin' : ''}`} />
                                                {syncElpaData.isPending ? 'Syncing...' : 'Fetch & Save'}
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1">
                                                <Label className="text-[10px] md:text-xs text-muted-foreground w-8 md:w-10">Sort</Label>
                                                <Select value={elpaSort} onValueChange={(v) => setElpaSort(v as typeof elpaSort)}>
                                                    <SelectTrigger className="h-6 md:h-7 text-[10px] md:text-xs w-[130px] md:w-[150px]">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="expiry-soonest">Expiry soonest</SelectItem>
                                                        <SelectItem value="expiry-latest">Expiry latest</SelectItem>
                                                        <SelectItem value="level-high">Level high → low</SelectItem>
                                                        <SelectItem value="level-low">Level low → high</SelectItem>
                                                        <SelectItem value="name">Name A-Z</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7" onClick={() => refetchElpa()}>
                                                <RefreshCw className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* ELPA Summary Cards */}
                                    <div className="grid grid-cols-3 gap-2">
                                        <Card className="border-0 bg-gradient-to-br from-slate-700 to-slate-900 text-white">
                                            <CardContent className="flex items-center justify-between py-2 px-3">
                                                <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-white/75">Total</span>
                                                <span className="text-lg md:text-xl font-bold">{elpaData.length}</span>
                                            </CardContent>
                                        </Card>
                                        <Card className={elpaExpired > 0 ? 'border-red-900 bg-red-900/95' : 'border-muted'}>
                                            <CardContent className="flex items-center justify-between py-2 px-3">
                                                <span className={`text-[10px] md:text-xs font-medium uppercase tracking-wide ${elpaExpired > 0 ? 'text-red-100' : 'text-muted-foreground'}`}>Expired</span>
                                                <span className={`text-lg md:text-xl font-bold ${elpaExpired > 0 ? 'text-white' : ''}`}>{elpaExpired}</span>
                                            </CardContent>
                                        </Card>
                                        <Card className={elpaExpiring > 0 ? 'border-amber-200 bg-amber-50' : 'border-muted'}>
                                            <CardContent className="flex items-center justify-between py-2 px-3">
                                                <span className={`text-[10px] md:text-xs font-medium uppercase tracking-wide ${elpaExpiring > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>≤ 90 days</span>
                                                <span className={`text-lg md:text-xl font-bold ${elpaExpiring > 0 ? 'text-amber-700' : ''}`}>{elpaExpiring}</span>
                                            </CardContent>
                                        </Card>
                                    </div>

                                    {/* ELPA Cards Grid */}
                                    {elpaLoading ? (
                                        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading ELPA data...</div>
                                    ) : filteredElpa.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                            <Languages className="h-10 w-10 mb-2 opacity-30" />
                                            <p className="text-sm">{elpaData.length === 0 ? 'No ELPA data yet. Click "Fetch & Save" to sync.' : 'No matching records.'}</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
                                            {filteredElpa.map((record) => {
                                                const days = getElpaDays(record);
                                                const hasExpired = days < 0;
                                                const hasCritical = days >= 0 && days < 30;
                                                const hasWarning = days >= 30 && days <= 90;

                                                const borderCls = hasExpired
                                                    ? 'border-red-700'
                                                    : hasCritical
                                                        ? 'border-red-200'
                                                        : hasWarning
                                                            ? 'border-amber-200'
                                                            : '';

                                                const levelCls = LEVEL_COLORS[record.level || ''] || 'bg-gray-100 text-gray-700 border-gray-200';

                                                return (
                                                    <Card key={record.emp_id} className={`p-3 md:p-4 space-y-2 ${borderCls}`}>
                                                        {/* Top badge */}
                                                        {(hasExpired || hasCritical || hasWarning) && (
                                                            <div>
                                                                <Badge className={`text-[9px] md:text-[10px] px-1.5 py-0 ${hasExpired ? 'bg-red-700 text-white border-red-800' : hasCritical ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                                                                    {hasExpired ? `Expired ${formatDays(days)} ago` : `${formatDays(days)} left`}
                                                                </Badge>
                                                            </div>
                                                        )}

                                                        {/* Name + ID */}
                                                        <div>
                                                            <p className="text-xs md:text-sm font-semibold leading-tight truncate">{record.name}</p>
                                                            <p className="text-[10px] md:text-xs text-muted-foreground">{record.emp_id}</p>
                                                        </div>

                                                        {/* Level badge */}
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[10px] md:text-xs text-muted-foreground">Level:</span>
                                                            <Badge className={`${levelCls} text-xs md:text-sm font-bold px-2 py-0`}>
                                                                {record.level || '-'}
                                                            </Badge>
                                                        </div>

                                                        <Separator />

                                                        {/* Dates */}
                                                        <div className="space-y-1 text-[10px] md:text-xs">
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">Valid upto</span>
                                                                <span className="font-medium">
                                                                    {record.valid_upto ? format(new Date(record.valid_upto), 'd MMM yyyy') : <span className="text-muted-foreground">-</span>}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">Endorsed upto</span>
                                                                <span className="font-medium">
                                                                    {record.endorsed_upto ? format(new Date(record.endorsed_upto), 'd MMM yyyy') : <span className="text-muted-foreground">-</span>}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Edit button */}
                                                        <div className="flex justify-end pt-1">
                                                            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => {
                                                                setEditingElpa(record);
                                                                setElpaEditForm({
                                                                    level: record.level || '',
                                                                    valid_upto: record.valid_upto ? record.valid_upto.slice(0, 10) : '',
                                                                    endorsed_upto: record.endorsed_upto ? record.endorsed_upto.slice(0, 10) : '',
                                                                });
                                                            }}>
                                                                <Pencil className="h-3 w-3 mr-0.5" /> Edit
                                                            </Button>
                                                        </div>
                                                    </Card>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* ELPA Edit Dialog */}
                                    <Dialog open={!!editingElpa} onOpenChange={(open) => { if (!open) setEditingElpa(null); }}>
                                        <DialogContent className="max-w-sm">
                                            <DialogHeader>
                                                <DialogTitle className="text-base flex items-center gap-1.5">
                                                    <Languages className="h-4 w-4" /> Edit ELPA
                                                </DialogTitle>
                                                <DialogDescription>
                                                    {editingElpa?.name} ({editingElpa?.emp_id})
                                                </DialogDescription>
                                            </DialogHeader>
                                            <form onSubmit={(e) => {
                                                e.preventDefault();
                                                if (!editingElpa) return;
                                                updateElpaRecord.mutate({
                                                    emp_id: editingElpa.emp_id,
                                                    elpa_level: elpaEditForm.level || null,
                                                    elpa_valid_upto: elpaEditForm.valid_upto || null,
                                                    elpa_endorsed_upto: elpaEditForm.endorsed_upto || null,
                                                }, {
                                                    onSuccess: () => setEditingElpa(null),
                                                });
                                            }} className="space-y-3">
                                                <div className="space-y-1">
                                                    <Label>Level</Label>
                                                    <Select value={elpaEditForm.level} onValueChange={(v) => setElpaEditForm({ ...elpaEditForm, level: v })}>
                                                        <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                                                        <SelectContent>
                                                            {['1', '2', '3', '4', '5', '6'].map((l) => (
                                                                <SelectItem key={l} value={l}>Level {l}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1">
                                                    <Label>Valid Upto</Label>
                                                    <Input type="date" value={elpaEditForm.valid_upto} onChange={(e) => setElpaEditForm({ ...elpaEditForm, valid_upto: e.target.value })} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label>Endorsed Upto</Label>
                                                    <Input type="date" value={elpaEditForm.endorsed_upto} onChange={(e) => setElpaEditForm({ ...elpaEditForm, endorsed_upto: e.target.value })} />
                                                </div>
                                                <Button type="submit" className="w-full" disabled={updateElpaRecord.isPending}>
                                                    {updateElpaRecord.isPending ? 'Saving...' : 'Save'}
                                                </Button>
                                            </form>
                                        </DialogContent>
                                    </Dialog>
                                </div>
                            );
                        })()}
                    </TabsContent>
                    <TabsContent value="medical">
                        {(() => {
                            const today = startOfDay(new Date());

                            const getMedDays = (record: MedicalSyncRecord) => {
                                if (!record.endorsed_upto) return Number.POSITIVE_INFINITY;
                                return differenceInDays(new Date(record.endorsed_upto), today);
                            };

                            const getSeverity = (r: MedicalSyncRecord) => {
                                const d = getMedDays(r);
                                if (d < 0 && r.status?.toUpperCase() !== 'CA35') return 0; // expired (red)
                                if (d < 0 && r.status?.toUpperCase() === 'CA35') return 1; // endorsement pending (amber)
                                if (d >= 0 && d <= 90) return 2; // expiring soon
                                return 3; // ok
                            };

                            const filteredMed = [...medSyncData]
                                .filter((r) => {
                                    if (medFilter === 'endorsement-pending') {
                                        return getMedDays(r) < 0 && r.status?.toUpperCase() === 'CA35';
                                    }
                                    if (medFilter === 'pending') return r.status?.toUpperCase() === 'PENDING';
                                    if (medFilter === 'tu') return r.status?.toUpperCase() === 'TU';
                                    if (medFilter === 'ca35') return r.status?.toUpperCase() === 'CA35';
                                    return true;
                                })
                                .filter((r) => {
                                    if (!medSearch.trim()) return true;
                                    const q = medSearch.trim().toLowerCase();
                                    return r.name.toLowerCase().includes(q) || r.emp_id.toLowerCase().includes(q) || (r.status || '').toLowerCase().includes(q);
                                })
                                .sort((a, b) => {
                                    if (medSort === 'severity') {
                                        const diff = getSeverity(a) - getSeverity(b);
                                        if (diff !== 0) return diff;
                                        return getMedDays(a) - getMedDays(b);
                                    }
                                    if (medSort === 'expiry-soonest') return getMedDays(a) - getMedDays(b);
                                    if (medSort === 'expiry-latest') return getMedDays(b) - getMedDays(a);
                                    return a.name.localeCompare(b.name);
                                });

                            const medExpired = medSyncData.filter((r) => r.endorsed_upto && getMedDays(r) < 0 && r.status?.toUpperCase() !== 'CA35').length;
                            const medDocPending = medSyncData.filter((r) => r.endorsed_upto && getMedDays(r) < 0 && r.status?.toUpperCase() === 'CA35').length;
                            const medExpiring = medSyncData.filter((r) => { const d = getMedDays(r); return d >= 0 && d <= 90; }).length;
                            const medUnfit = medSyncData.filter((r) => r.status && r.status.toUpperCase() !== 'FIT' && r.status.toUpperCase() !== 'CA35').length;

                            return (
                                <div className="space-y-3">
                                    {/* Medical Header */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm md:text-base font-semibold flex items-center gap-1.5">
                                                <Stethoscope className="h-4 w-4 text-indigo-600" /> Medical Data
                                            </h3>
                                        </div>
                                        <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
                                            <div className="relative flex-1 max-w-xs">
                                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                                <Input
                                                    placeholder="Search name or ID..."
                                                    value={medSearch}
                                                    onChange={(e) => setMedSearch(e.target.value)}
                                                    className="pl-7 h-7 md:h-8 text-xs md:text-sm"
                                                />
                                                {medSearch && (
                                                    <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5" onClick={() => setMedSearch('')}>
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                            <Button
                                                size="sm"
                                                className="h-7 md:h-8 text-xs md:text-sm gap-1"
                                                onClick={() => syncMedicalData.mutate()}
                                                disabled={syncMedicalData.isPending}
                                            >
                                                <RefreshCw className={`h-3 w-3 ${syncMedicalData.isPending ? 'animate-spin' : ''}`} />
                                                {syncMedicalData.isPending ? 'Syncing...' : 'Fetch & Save'}
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <div className="flex items-center gap-1">
                                                <Label className="text-[10px] md:text-xs text-muted-foreground w-8 md:w-10">Filter</Label>
                                                <Select value={medFilter} onValueChange={(v) => setMedFilter(v as typeof medFilter)}>
                                                    <SelectTrigger className="h-6 md:h-7 text-[10px] md:text-xs w-[150px] md:w-[170px]">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">All</SelectItem>
                                                        <SelectItem value="endorsement-pending">Endorsement Pending</SelectItem>
                                                        <SelectItem value="pending">Pending</SelectItem>
                                                        <SelectItem value="tu">TU</SelectItem>
                                                        <SelectItem value="ca35">CA35</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Label className="text-[10px] md:text-xs text-muted-foreground w-8 md:w-10">Sort</Label>
                                                <Select value={medSort} onValueChange={(v) => setMedSort(v as typeof medSort)}>
                                                    <SelectTrigger className="h-6 md:h-7 text-[10px] md:text-xs w-[130px] md:w-[150px]">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="severity">Severity</SelectItem>
                                                        <SelectItem value="expiry-soonest">Expiry soonest</SelectItem>
                                                        <SelectItem value="expiry-latest">Expiry latest</SelectItem>
                                                        <SelectItem value="name">Name A-Z</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7" onClick={() => refetchMedSync()}>
                                                <RefreshCw className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Medical Summary Cards */}
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                        <Card className="border-0 bg-gradient-to-br from-slate-700 to-slate-900 text-white">
                                            <CardContent className="flex items-center justify-between py-2 px-3">
                                                <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-white/75">Total</span>
                                                <span className="text-lg md:text-xl font-bold">{medSyncData.length}</span>
                                            </CardContent>
                                        </Card>
                                        <Card className={medExpired > 0 ? 'border-red-900 bg-red-900/95' : 'border-muted'}>
                                            <CardContent className="flex items-center justify-between py-2 px-3">
                                                <span className={`text-[10px] md:text-xs font-medium uppercase tracking-wide ${medExpired > 0 ? 'text-red-100' : 'text-muted-foreground'}`}>Expired</span>
                                                <span className={`text-lg md:text-xl font-bold ${medExpired > 0 ? 'text-white' : ''}`}>{medExpired}</span>
                                            </CardContent>
                                        </Card>
                                        <Card className={medDocPending > 0 ? 'border-amber-400 bg-amber-100' : 'border-muted'}>
                                            <CardContent className="flex items-center justify-between py-2 px-3">
                                                <span className={`text-[10px] md:text-xs font-medium uppercase tracking-wide ${medDocPending > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>Doc Pending</span>
                                                <span className={`text-lg md:text-xl font-bold ${medDocPending > 0 ? 'text-amber-800' : ''}`}>{medDocPending}</span>
                                            </CardContent>
                                        </Card>
                                        <Card className={medExpiring > 0 ? 'border-amber-200 bg-amber-50' : 'border-muted'}>
                                            <CardContent className="flex items-center justify-between py-2 px-3">
                                                <span className={`text-[10px] md:text-xs font-medium uppercase tracking-wide ${medExpiring > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>≤ 90 days</span>
                                                <span className={`text-lg md:text-xl font-bold ${medExpiring > 0 ? 'text-amber-700' : ''}`}>{medExpiring}</span>
                                            </CardContent>
                                        </Card>
                                        <Card className={medUnfit > 0 ? 'border-rose-200 bg-rose-50' : 'border-muted'}>
                                            <CardContent className="flex items-center justify-between py-2 px-3">
                                                <span className={`text-[10px] md:text-xs font-medium uppercase tracking-wide ${medUnfit > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>Not FIT</span>
                                                <span className={`text-lg md:text-xl font-bold ${medUnfit > 0 ? 'text-rose-700' : ''}`}>{medUnfit}</span>
                                            </CardContent>
                                        </Card>
                                    </div>

                                    {/* Medical Cards Grid */}
                                    {medSyncLoading ? (
                                        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading medical data...</div>
                                    ) : filteredMed.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                            <Stethoscope className="h-10 w-10 mb-2 opacity-30" />
                                            <p className="text-sm">{medSyncData.length === 0 ? 'No medical data yet. Click "Fetch & Save" to sync.' : 'No matching records.'}</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
                                            {filteredMed.map((record) => {
                                                const days = getMedDays(record);
                                                const hasExpired = days < 0;
                                                const isCA35 = hasExpired && record.status?.toUpperCase() === 'CA35';
                                                const hasCritical = days >= 0 && days < 30;
                                                const hasWarning = days >= 30 && days <= 90;
                                                const isUnfit = record.status && record.status.toUpperCase() !== 'FIT' && record.status.toUpperCase() !== 'CA35';

                                                const borderCls = isCA35
                                                    ? 'border-amber-400'
                                                    : hasExpired
                                                        ? 'border-red-700'
                                                        : isUnfit
                                                            ? 'border-rose-400'
                                                            : hasCritical
                                                                ? 'border-red-200'
                                                                : hasWarning
                                                                    ? 'border-amber-200'
                                                                    : '';

                                                const statusCls = isCA35
                                                    ? 'bg-amber-100 text-amber-700 border-amber-300'
                                                    : isUnfit
                                                        ? 'bg-rose-100 text-rose-700 border-rose-200'
                                                        : 'bg-emerald-100 text-emerald-700 border-emerald-200';

                                                const historyEntries = Object.entries(record.history || {}).sort(([a], [b]) => a.localeCompare(b));

                                                return (
                                                    <Card key={record.emp_id} className={`p-3 md:p-4 space-y-2 ${borderCls}`}>
                                                        {/* Top badge */}
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-1">
                                                                {isCA35 ? (
                                                                    <Badge className="text-[9px] md:text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-300">
                                                                        Endorsement Pending
                                                                    </Badge>
                                                                ) : (hasExpired || hasCritical || hasWarning) && (
                                                                    <Badge className={`text-[9px] md:text-[10px] px-1.5 py-0 ${hasExpired ? 'bg-red-700 text-white border-red-800' : hasCritical ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                                                                        {hasExpired ? `Expired ${formatDays(days)} ago` : `${formatDays(days)} left`}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <Badge className={`${statusCls} text-[9px] md:text-[10px] px-1.5 py-0`}>
                                                                {record.status || '-'}
                                                            </Badge>
                                                        </div>

                                                        {/* Name + ID */}
                                                        <div>
                                                            <p className="text-xs md:text-sm font-semibold leading-tight truncate">{record.name}</p>
                                                            <p className="text-[10px] md:text-xs text-muted-foreground">{record.emp_id}</p>
                                                        </div>

                                                        <Separator />

                                                        {/* Dates */}
                                                        <div className="space-y-1 text-[10px] md:text-xs">
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">Last Medical</span>
                                                                <span className="font-medium">
                                                                    {record.last_medical ? format(new Date(record.last_medical), 'd MMM yyyy') : <span className="text-muted-foreground">-</span>}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">Endorsed upto</span>
                                                                <span className="font-medium">
                                                                    {record.endorsed_upto ? format(new Date(record.endorsed_upto), 'd MMM yyyy') : <span className="text-muted-foreground">-</span>}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* History peek + view/edit buttons */}
                                                        <Separator />
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[10px] md:text-xs text-muted-foreground">
                                                                {historyEntries.length > 0 ? `${historyEntries.length} medical record${historyEntries.length !== 1 ? 's' : ''}` : ''}
                                                            </span>
                                                            <div className="flex items-center gap-1">
                                                                {historyEntries.length > 0 && (
                                                                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setViewingMedRecord(record)}>
                                                                        <Eye className="h-3 w-3 mr-0.5" /> View
                                                                    </Button>
                                                                )}
                                                                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => {
                                                                    setEditingMed(record);
                                                                    setMedEditForm({
                                                                        last_medical: record.last_medical || '',
                                                                        endorsed_upto: record.endorsed_upto || '',
                                                                        status: record.status || '',
                                                                    });
                                                                }}>
                                                                    <Pencil className="h-3 w-3 mr-0.5" /> Edit
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </Card>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Medical History View Dialog */}
                                    <Dialog open={!!viewingMedRecord} onOpenChange={(open) => { if (!open) setViewingMedRecord(null); }}>
                                        <DialogContent className="max-w-md">
                                            <DialogHeader>
                                                <DialogTitle className="text-base flex items-center gap-1.5">
                                                    <Stethoscope className="h-4 w-4" /> Medical History
                                                </DialogTitle>
                                                <DialogDescription>
                                                    {viewingMedRecord?.name} ({viewingMedRecord?.emp_id})
                                                </DialogDescription>
                                            </DialogHeader>
                                            {viewingMedRecord && (
                                                <div className="space-y-3">
                                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                                        <div>
                                                            <span className="text-muted-foreground text-xs">Status</span>
                                                            <p className="font-medium">{viewingMedRecord.status || '-'}</p>
                                                        </div>
                                                        <div>
                                                            <span className="text-muted-foreground text-xs">Last Medical</span>
                                                            <p className="font-medium">{viewingMedRecord.last_medical ? format(new Date(viewingMedRecord.last_medical), 'd MMM yyyy') : '-'}</p>
                                                        </div>
                                                        <div>
                                                            <span className="text-muted-foreground text-xs">Endorsed Upto</span>
                                                            <p className="font-medium">{viewingMedRecord.endorsed_upto ? format(new Date(viewingMedRecord.endorsed_upto), 'd MMM yyyy') : '-'}</p>
                                                        </div>
                                                    </div>
                                                    <Separator />
                                                    <div>
                                                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">History</h4>
                                                        <div className="space-y-1">
                                                            {Object.entries(viewingMedRecord.history || {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => (
                                                                <div key={key} className="flex justify-between text-sm">
                                                                    <span className="text-muted-foreground">{key}</span>
                                                                    <span className="font-medium">{val ? format(new Date(val), 'd MMM yyyy') : '-'}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </DialogContent>
                                    </Dialog>

                                    {/* Medical Edit Dialog */}
                                    <Dialog open={!!editingMed} onOpenChange={(open) => { if (!open) setEditingMed(null); }}>
                                        <DialogContent className="max-w-sm">
                                            <DialogHeader>
                                                <DialogTitle className="text-base flex items-center gap-1.5">
                                                    <Stethoscope className="h-4 w-4" /> Edit Medical
                                                </DialogTitle>
                                                <DialogDescription>
                                                    {editingMed?.name} ({editingMed?.emp_id})
                                                </DialogDescription>
                                            </DialogHeader>
                                            <form onSubmit={(e) => {
                                                e.preventDefault();
                                                if (!editingMed) return;
                                                updateMedicalRecord.mutate({
                                                    emp_id: editingMed.emp_id,
                                                    med_last_date: medEditForm.last_medical || null,
                                                    med_endorsed_upto: medEditForm.endorsed_upto || null,
                                                    med_status: medEditForm.status || null,
                                                }, {
                                                    onSuccess: () => setEditingMed(null),
                                                });
                                            }} className="space-y-3">
                                                <div className="space-y-1">
                                                    <Label>Status</Label>
                                                    <Input value={medEditForm.status} onChange={(e) => setMedEditForm({ ...medEditForm, status: e.target.value })} placeholder="FIT, TU, CA35, PENDING..." />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label>Last Medical</Label>
                                                    <Input type="date" value={medEditForm.last_medical} onChange={(e) => setMedEditForm({ ...medEditForm, last_medical: e.target.value })} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label>Endorsed Upto</Label>
                                                    <Input type="date" value={medEditForm.endorsed_upto} onChange={(e) => setMedEditForm({ ...medEditForm, endorsed_upto: e.target.value })} />
                                                </div>
                                                <Button type="submit" className="w-full" disabled={updateMedicalRecord.isPending}>
                                                    {updateMedicalRecord.isPending ? 'Saving...' : 'Save'}
                                                </Button>
                                            </form>
                                        </DialogContent>
                                    </Dialog>
                                </div>
                            );
                        })()}
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
