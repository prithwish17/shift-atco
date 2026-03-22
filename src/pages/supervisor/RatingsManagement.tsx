import { useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Shield, RefreshCw, Search, X, Eye, Pencil, Save, Plus, Trash2 } from 'lucide-react';
import { format, differenceInDays, startOfDay, addDays } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---------- Types ----------
interface RatingEntry {
    status: string | null;
    rating_date: string | null;
    endorsement_date: string | null;
    last_proficiency: {
        date: string | null;
        instructor: string | null;
    };
    proficiency_history: Record<string, { date: string | null; instructor: string | null }>;
}

interface RatingSyncRecord {
    emp_id: string;
    name: string;
    designation: string | null;
    contact_no: string | null;
    current_station: string | null;
    license_number: string | null;
    elpa_level: string | null;
    highest_rating: string | null;
    ratings: Record<string, RatingEntry>;
}

type EditableRatingRecord = {
    emp_id: string;
    name: string;
    designation: string | null;
    contact_no: string | null;
    current_station: string | null;
    license_number: string | null;
    elpa_level: string | null;
    highest_rating: string | null;
    ratings: Record<string, RatingEntry>;
};

// ---------- Hooks ----------
function useRatingSyncData() {
    return useQuery<RatingSyncRecord[]>({
        queryKey: ['rating-sync-data'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_training_records' as any)
                .select('emp_id, employee_name, license_number, elpa_level, highest_rating, rating_data, rating_designation')
                .not('rating_data', 'eq', '{}')
                .order('employee_name', { ascending: true });

            if (error) throw error;

            const rows = ((data || []) as unknown as Array<{
                emp_id: string;
                employee_name: string;
                license_number: string | null;
                elpa_level: string | null;
                highest_rating: string | null;
                rating_data: Record<string, RatingEntry> | null;
                rating_designation: string | null;
            }>);

            const employeeIds = rows.map((row) => row.emp_id).filter(Boolean);
            let profileMeta = new Map<string, { mobile: string | null; station: string | null }>();

            if (employeeIds.length > 0) {
                const { data: profiles, error: profilesError } = await supabase
                    .from('profiles')
                    .select('employee_id, mobile, station')
                    .in('employee_id', employeeIds);

                if (profilesError) throw profilesError;

                profileMeta = new Map(
                    ((profiles || []) as Array<{ employee_id: string | null; mobile: string | null; station: string | null }>)
                        .filter((row): row is { employee_id: string; mobile: string | null; station: string | null } => Boolean(row.employee_id))
                        .map((row) => [row.employee_id, { mobile: row.mobile, station: row.station }]),
                );
            }

            return rows.map((row) => ({
                emp_id: row.emp_id,
                name: row.employee_name,
                designation: row.rating_designation,
                contact_no: profileMeta.get(row.emp_id)?.mobile ?? null,
                current_station: profileMeta.get(row.emp_id)?.station ?? null,
                license_number: row.license_number,
                elpa_level: row.elpa_level,
                highest_rating: row.highest_rating,
                ratings: Object.fromEntries(
                    Object.entries(row.rating_data || {}).map(([ratingKey, entry]) => [
                        ratingKey,
                        normalizeRatingEntry(entry),
                    ]),
                ),
            }));
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
}

function useSyncRatingData() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            const { data, error } = await supabase.functions.invoke('fetch-rating-data', { body: {} });
            if (!error) return data;

            if (import.meta.env.DEV) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw error;

                const base =
                    import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL ||
                    'https://shift-atco.vercel.app';

                const res = await fetch(`${base}/api/functions/fetch-rating-data`, {
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
            await qc.invalidateQueries({ queryKey: ['rating-sync-data'] });
            toast.success(`Rating data synced${result?.upserted ? ` (${result.upserted} records)` : ''}`);
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to sync rating data');
        },
    });
}

async function invokeUpdateTrainingRecord(empId: string, updates: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('update-training-record', {
        body: { emp_id: empId, updates },
    });

    if (error) {
        // Dev fallback via Vercel proxy
        if (import.meta.env.DEV) {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw error;
            const base = import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL || 'https://shift-atco.vercel.app';
            const res = await fetch(`${base}/api/functions/update-training-record`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ emp_id: empId, updates }),
            });
            if (res.ok) return res.json();
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || error.message || `Edge function failed: HTTP ${res.status}`);
        }
        throw error;
    }

    if (data?.error) throw new Error(data.error);
    return data;
}

function useUpdateRatingRecord() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (record: EditableRatingRecord) => {
            const cleanedRatings: Record<string, RatingEntry> = {};

            for (const [key, value] of Object.entries(record.ratings)) {
                const cleanedHistory: Record<string, { date: string | null; instructor: string | null }> = {};

                for (const [historyKey, history] of Object.entries(value.proficiency_history || {})) {
                    if (history.date || history.instructor) {
                        cleanedHistory[historyKey] = {
                            date: history.date || null,
                            instructor: history.instructor || null,
                        };
                    }
                }

                const cleanedEntry = normalizeRatingEntry({
                    status: value.status ?? null,
                    rating_date: value.rating_date || null,
                    endorsement_date: value.endorsement_date || null,
                    last_proficiency: {
                        date: value.last_proficiency?.date || null,
                        instructor: value.last_proficiency?.instructor || null,
                    },
                    proficiency_history: cleanedHistory,
                });

                const hasValue =
                    (cleanedEntry.status !== null && cleanedEntry.status !== undefined) ||
                    cleanedEntry.rating_date ||
                    cleanedEntry.endorsement_date ||
                    cleanedEntry.last_proficiency.date ||
                    cleanedEntry.last_proficiency.instructor ||
                    Object.keys(cleanedEntry.proficiency_history).length > 0;

                if (hasValue) {
                    cleanedRatings[key] = cleanedEntry;
                }
            }

            await invokeUpdateTrainingRecord(record.emp_id, {
                rating_data: cleanedRatings,
                rating_designation: record.designation || null,
                rating_synced_at: new Date().toISOString(),
            });
        },
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: ['rating-sync-data'] });
            toast.success('Rating record updated');
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to update rating record');
        },
    });
}

// ---------- Helpers ----------
const RATING_TYPES = ['ADC', 'APP', 'ACC', 'ACC(S)', 'OCC', 'PLR'] as const;
type RatingType = typeof RATING_TYPES[number];

function getRatingEditTheme(ratingKey: string) {
    switch (ratingKey) {
        case 'ADC':
            return {
                panelClass: 'border-sky-200 bg-sky-50/40',
                headerClass: 'border-sky-200 bg-sky-100/70',
                badgeClass: 'border-sky-200 bg-sky-600 text-white',
                accentClass: 'bg-sky-500',
                sectionClass: 'border-sky-200/80 bg-white/80',
            };
        case 'APP':
            return {
                panelClass: 'border-emerald-200 bg-emerald-50/40',
                headerClass: 'border-emerald-200 bg-emerald-100/70',
                badgeClass: 'border-emerald-200 bg-emerald-600 text-white',
                accentClass: 'bg-emerald-500',
                sectionClass: 'border-emerald-200/80 bg-white/80',
            };
        case 'ACC':
            return {
                panelClass: 'border-amber-200 bg-amber-50/40',
                headerClass: 'border-amber-200 bg-amber-100/70',
                badgeClass: 'border-amber-200 bg-amber-500 text-white',
                accentClass: 'bg-amber-500',
                sectionClass: 'border-amber-200/80 bg-white/80',
            };
        case 'ACC(S)':
            return {
                panelClass: 'border-violet-200 bg-violet-50/40',
                headerClass: 'border-violet-200 bg-violet-100/70',
                badgeClass: 'border-violet-200 bg-violet-600 text-white',
                accentClass: 'bg-violet-500',
                sectionClass: 'border-violet-200/80 bg-white/80',
            };
        case 'OCC':
            return {
                panelClass: 'border-rose-200 bg-rose-50/40',
                headerClass: 'border-rose-200 bg-rose-100/70',
                badgeClass: 'border-rose-200 bg-rose-600 text-white',
                accentClass: 'bg-rose-500',
                sectionClass: 'border-rose-200/80 bg-white/80',
            };
        case 'PLR':
            return {
                panelClass: 'border-slate-300 bg-slate-50/70',
                headerClass: 'border-slate-300 bg-slate-100/80',
                badgeClass: 'border-slate-300 bg-slate-700 text-white',
                accentClass: 'bg-slate-500',
                sectionClass: 'border-slate-200/90 bg-white/85',
            };
        default:
            return {
                panelClass: 'border-border bg-muted/20',
                headerClass: 'border-border bg-muted/40',
                badgeClass: 'border-border bg-foreground text-background',
                accentClass: 'bg-foreground',
                sectionClass: 'border-border bg-background/90',
            };
    }
}

function getProfValidity(entry: RatingEntry, today: Date) {
    if (!entry.last_proficiency?.date) return null;
    const profDate = new Date(entry.last_proficiency.date);
    const validUpto = addDays(profDate, 364);
    const daysLeft = differenceInDays(validUpto, today);
    return { validUpto, daysLeft };
}

function getLatestProficiencyFromHistory(entry: Pick<RatingEntry, 'last_proficiency' | 'proficiency_history'>) {
    const latestHistory = Object.entries(entry.proficiency_history || {})
        .filter(([, history]) => history.date)
        .map(([historyKey, history]) => ({
            historyKey,
            date: history.date as string,
            instructor: history.instructor || null,
            time: new Date(history.date as string).getTime(),
        }))
        .filter((history) => !Number.isNaN(history.time))
        .sort((first, second) => second.time - first.time || second.historyKey.localeCompare(first.historyKey, undefined, { numeric: true }))[0];

    if (latestHistory) {
        return {
            date: latestHistory.date,
            instructor: latestHistory.instructor,
        };
    }

    return {
        date: entry.last_proficiency?.date || null,
        instructor: entry.last_proficiency?.instructor || null,
    };
}

function normalizeRatingEntry(entry: RatingEntry): RatingEntry {
    return {
        status: entry.status ?? null,
        rating_date: entry.rating_date || null,
        endorsement_date: entry.endorsement_date || null,
        last_proficiency: getLatestProficiencyFromHistory(entry),
        proficiency_history: Object.fromEntries(
            Object.entries(entry.proficiency_history || {}).map(([historyKey, history]) => [historyKey, {
                date: history.date || null,
                instructor: history.instructor || null,
            }]),
        ),
    };
}

function getWorstProfStatus(record: RatingSyncRecord, today: Date): 'valid' | 'warning' | 'expired' | 'none' {
    const active = Object.entries(record.ratings).filter(([, v]) => v.status === '1');
    let worst: 'valid' | 'warning' | 'expired' | 'none' = 'none';
    for (const [, entry] of active) {
        const pv = getProfValidity(entry, today);
        if (!pv) { if (worst === 'none') worst = 'expired'; continue; }
        if (pv.daysLeft < 0) return 'expired';
        if (pv.daysLeft <= 90 && worst !== 'expired') worst = 'warning';
        if (pv.daysLeft > 90 && worst === 'none') worst = 'valid';
    }
    return worst;
}

function getTopCardExpiryBadge(daysLeft: number | null) {
    if (daysLeft === null) {
        return {
            className: 'bg-red-100 text-red-700 border-red-200',
            label: 'No prof date',
        };
    }

    if (daysLeft < 0) {
        return {
            className: 'bg-red-100 text-red-700 border-red-200',
            label: `${Math.abs(daysLeft)}d overdue`,
        };
    }

    if (daysLeft <= 90) {
        return {
            className: 'bg-amber-100 text-amber-700 border-amber-200',
            label: `${daysLeft}d left`,
        };
    }

    return {
        className: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        label: `${daysLeft}d left`,
    };
}

function getRecordSoonestExpiryDays(record: RatingSyncRecord, today: Date) {
    const activeEntries = Object.values(record.ratings).filter((entry) => entry.status === '1');
    if (activeEntries.length === 0) return undefined;

    let soonestDaysLeft: number | null | undefined;

    for (const entry of activeEntries) {
        const validity = getProfValidity(entry, today);
        if (!validity) return null;

        if (soonestDaysLeft === undefined || validity.daysLeft < soonestDaysLeft) {
            soonestDaysLeft = validity.daysLeft;
        }
    }

    return soonestDaysLeft;
}

function getRatingDisplayStatus(entry: RatingEntry, today: Date): 'active' | 'expired' | 'inactive' {
    if (entry.status !== '1') return 'inactive';

    const validity = getProfValidity(entry, today);
    if (!validity || validity.daysLeft < 0) return 'expired';

    return 'active';
}

function getInstructorSuggestions(records: RatingSyncRecord[]) {
    const suggestions = new Set<string>();

    records.forEach((record) => {
        if (record.name?.trim()) {
            suggestions.add(record.name.trim());
        }
    });

    return [...suggestions].sort((first, second) => first.localeCompare(second));
}

function createEmptyRatingEntry(): RatingEntry {
    return {
        status: null,
        rating_date: null,
        endorsement_date: null,
        last_proficiency: {
            date: null,
            instructor: null,
        },
        proficiency_history: {},
    };
}

function cloneRecordForEdit(record: RatingSyncRecord): EditableRatingRecord {
    return {
        emp_id: record.emp_id,
        name: record.name,
        designation: record.designation,
        contact_no: record.contact_no,
        current_station: record.current_station,
        license_number: record.license_number,
        elpa_level: record.elpa_level,
        highest_rating: record.highest_rating,
        ratings: Object.fromEntries(
            [...new Set([...RATING_TYPES, ...Object.keys(record.ratings)])].map((key) => {
                const source = record.ratings[key] || createEmptyRatingEntry();
                return [key, normalizeRatingEntry(source) satisfies RatingEntry];
            }),
        ),
    };
}

// ---------- Sub-components ----------

/** Overview tab — shows all employees with all their active ratings */
function OverviewTab({
    data, syncMutation, refetch, isLoading
}: { data: RatingSyncRecord[]; syncMutation: ReturnType<typeof useSyncRatingData>; refetch: () => void; isLoading: boolean }) {
    const today = startOfDay(new Date());
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<'name' | 'designation'>('name');
    const [viewingRecord, setViewingRecord] = useState<RatingSyncRecord | null>(null);
    const [editingRecord, setEditingRecord] = useState<EditableRatingRecord | null>(null);
    const updateRatingRecord = useUpdateRatingRecord();
    const instructorSuggestions = getInstructorSuggestions(data);

    const filtered = [...data]
        .filter((r) => {
            if (!search.trim()) return true;
            const q = search.trim().toLowerCase();
            return r.name.toLowerCase().includes(q) || r.emp_id.toLowerCase().includes(q) || (r.designation || '').toLowerCase().includes(q);
        })
        .sort((a, b) => {
            if (sort === 'designation') return (a.designation || '').localeCompare(b.designation || '');
            return a.name.localeCompare(b.name);
        });

    const totalActive = data.reduce((sum, r) => sum + Object.values(r.ratings).filter(v => v.status === '1').length, 0);
    const withRatings = data.filter((r) => Object.values(r.ratings).some(v => v.status === '1')).length;

    let profExpired = 0, profWarning = 0, profValid = 0;
    data.forEach((r) => {
        Object.entries(r.ratings).filter(([, v]) => v.status === '1').forEach(([, entry]) => {
            const pv = getProfValidity(entry, today);
            if (!pv || pv.daysLeft < 0) profExpired++;
            else if (pv.daysLeft <= 90) profWarning++;
            else profValid++;
        });
    });

    return (
        <div className="space-y-3">
            {/* Header controls */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold md:text-base flex items-center gap-1.5">
                        <Shield className="h-4 w-4 text-indigo-600" /> Rating Records
                    </h3>
                </div>
                <div className="flex items-center gap-2 md:flex-row md:items-center">
                    <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground md:top-3 md:h-3.5 md:w-3.5" />
                        <Input
                            placeholder="Search name, ID or designation"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-7 w-full pl-7 pr-8 text-xs md:h-10 md:pl-8 md:text-[15px]"
                        />
                        {search && (
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="absolute right-1 top-0.5 h-6 w-6 text-muted-foreground hover:text-foreground md:top-1.5 md:h-7 md:w-7"
                                onClick={() => setSearch('')}
                            >
                                <X className="h-3 w-3 md:h-3.5 md:w-3.5" />
                            </Button>
                        )}
                    </div>
                    <Button
                        size="sm"
                        className="h-7 shrink-0 whitespace-nowrap px-3 text-xs md:h-10 md:px-4 md:text-[15px]"
                        onClick={() => syncMutation.mutate()}
                        disabled={syncMutation.isPending}
                    >
                        <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                        {syncMutation.isPending ? 'Syncing...' : 'Fetch & Save'}
                    </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 md:flex md:items-end md:justify-end">
                    <div className="min-w-0 space-y-1 md:w-[205px]">
                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">Sort</Label>
                        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                            <SelectTrigger className="h-7 w-full text-xs md:h-9 md:text-[15px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="name">Name A-Z</SelectItem>
                                <SelectItem value="designation">Designation</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="min-w-0 space-y-1 md:w-[160px]">
                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">Actions</Label>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-full text-xs md:h-9 md:px-4 md:text-[15px]"
                            onClick={() => refetch()}
                            disabled={isLoading}
                        >
                            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                            Reload
                        </Button>
                    </div>
                </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <Card className="border-0 bg-gradient-to-br from-slate-700 to-slate-900 text-white">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-white/75">Employees</span>
                        <span className="text-lg md:text-xl font-bold">{data.length}</span>
                    </CardContent>
                </Card>
                <Card className="border-muted">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-muted-foreground">With Rating</span>
                        <span className="text-lg md:text-xl font-bold">{withRatings}</span>
                    </CardContent>
                </Card>
                <Card className="border-muted">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-muted-foreground">Active</span>
                        <span className="text-lg md:text-xl font-bold">{totalActive}</span>
                    </CardContent>
                </Card>
                <Card className="border-red-200 bg-red-50/30">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-red-600">Prof Expired</span>
                        <span className="text-lg md:text-xl font-bold text-red-600">{profExpired}</span>
                    </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50/30">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-amber-600">Prof ≤90d</span>
                        <span className="text-lg md:text-xl font-bold text-amber-600">{profWarning}</span>
                    </CardContent>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50/30">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-emerald-600">Prof Valid</span>
                        <span className="text-lg md:text-xl font-bold text-emerald-600">{profValid}</span>
                    </CardContent>
                </Card>
            </div>

            {/* Cards */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading rating data...</div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Shield className="h-10 w-10 mb-2 opacity-30" />
                    <p className="text-sm">{data.length === 0 ? 'No rating data yet. Click "Fetch & Save" to sync.' : 'No matching records.'}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
                    {filtered.map((record) => {
                        const activeEntries = Object.entries(record.ratings).filter(([, v]) => v.status === '1');
                        const inactiveEntries = Object.entries(record.ratings).filter(([, v]) => v.status !== '1');
                        const worstStatus = getWorstProfStatus(record, today);
                        const soonestExpiryDays = getRecordSoonestExpiryDays(record, today);
                        const expiryBadge = soonestExpiryDays !== undefined ? getTopCardExpiryBadge(soonestExpiryDays) : null;
                        const borderClass = worstStatus === 'expired' ? 'border-red-400' : worstStatus === 'warning' ? 'border-amber-400' : worstStatus === 'valid' ? 'border-emerald-300' : '';

                        return (
                            <Card key={record.emp_id} className={`p-3 md:p-4 space-y-2.5 ${borderClass}`}>
                                {expiryBadge && (
                                    <div className="flex justify-start">
                                        <Badge variant="outline" className={`text-[9px] md:text-[10px] px-1.5 py-0 ${expiryBadge.className}`}>
                                            Expiry {expiryBadge.label}
                                        </Badge>
                                    </div>
                                )}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-xs md:text-sm font-semibold leading-tight truncate">{record.name}</p>
                                        <p className="text-[10px] md:text-xs text-muted-foreground">{record.emp_id}</p>
                                        <div className="mt-1 space-y-0.5 text-[10px] md:text-xs text-muted-foreground">
                                            <p>{record.contact_no || 'No contact'} · {record.current_station || 'No station'}</p>
                                            <p>{record.license_number ? `Lic ${record.license_number}` : 'No license'} · {record.elpa_level ? `ELPA ${record.elpa_level}` : 'No ELPA'} · {record.highest_rating || 'No highest rating'}</p>
                                        </div>
                                    </div>
                                    {record.designation && (
                                        <Badge variant="secondary" className="text-[9px] md:text-[10px] px-1.5 py-0 shrink-0">{record.designation}</Badge>
                                    )}
                                </div>
                                <Separator />
                                {activeEntries.length > 0 ? (
                                    <div className="space-y-0">
                                        <div className="grid grid-cols-[48px_1fr_1fr_1fr] gap-x-1 text-[9px] md:text-[10px] text-muted-foreground font-semibold uppercase tracking-wide pb-1 border-b mb-1">
                                            <span>Type</span><span>Rated</span><span>Last Prof</span><span>Prof Valid</span>
                                        </div>
                                        {activeEntries.map(([key, entry]) => {
                                            const pv = getProfValidity(entry, today);
                                            const profLabel = pv ? format(pv.validUpto, 'd MMM yy') : '-';
                                            const profBadgeClass = !pv || pv.daysLeft < 0
                                                ? 'bg-red-100 text-red-700 border-red-200'
                                                : pv.daysLeft <= 90
                                                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                                                    : 'bg-emerald-100 text-emerald-700 border-emerald-200';
                                            const profDaysText = !pv ? 'No Prof'
                                                : pv.daysLeft < 0 ? `${Math.abs(pv.daysLeft)}d over`
                                                    : `${pv.daysLeft}d left`;

                                            return (
                                                <div key={key} className="grid grid-cols-[48px_1fr_1fr_1fr] gap-x-1 items-center py-1 border-b border-dashed last:border-0 text-[10px] md:text-xs">
                                                    <span className="font-bold text-[10px]">{key}</span>
                                                    <span className="font-medium">{entry.rating_date ? format(new Date(entry.rating_date), 'd MMM yy') : '-'}</span>
                                                    <span className="font-medium">{entry.last_proficiency?.date ? format(new Date(entry.last_proficiency.date), 'd MMM yy') : '-'}</span>
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Badge variant="outline" className={`text-[8px] md:text-[9px] px-1 py-0 cursor-default ${profBadgeClass}`}>
                                                                    {profLabel}
                                                                </Badge>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="top" className="text-xs">
                                                                {profDaysText}
                                                                {entry.last_proficiency?.instructor ? ` · Instructor: ${entry.last_proficiency.instructor}` : ''}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-[10px] md:text-xs text-muted-foreground italic">No active ratings</p>
                                )}
                                <div className="flex items-center justify-between pt-1">
                                    <span className="text-[10px] md:text-xs text-muted-foreground">{inactiveEntries.length} inactive</span>
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setEditingRecord(cloneRecordForEdit(record))}>
                                            <Pencil className="h-3 w-3 mr-0.5" /> Edit
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setViewingRecord(record)}>
                                            <Eye className="h-3 w-3 mr-0.5" /> Details
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Detail Dialog */}
            <RatingDetailDialog record={viewingRecord} onClose={() => setViewingRecord(null)} />
            <RatingEditDialog
                record={editingRecord}
                onClose={() => setEditingRecord(null)}
                onSave={(record) => updateRatingRecord.mutate(record, { onSuccess: () => setEditingRecord(null) })}
                isSaving={updateRatingRecord.isPending}
                instructorSuggestions={instructorSuggestions}
                visibleRatingKeys={undefined}
            />
        </div>
    );
}

/** Individual rating type tab — e.g. only ADC entries */
function RatingTypeTab({
    data, ratingType, isLoading
}: { data: RatingSyncRecord[]; ratingType: RatingType; isLoading: boolean }) {
    const today = startOfDay(new Date());
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<'name' | 'designation' | 'prof-expiry'>('prof-expiry');
    const [statusFilter, setStatusFilter] = useState<'active-or-expired' | 'all' | 'active' | 'expired' | 'inactive'>('active-or-expired');
    const [viewingRecord, setViewingRecord] = useState<RatingSyncRecord | null>(null);
    const [editingRecord, setEditingRecord] = useState<EditableRatingRecord | null>(null);
    const updateRatingRecord = useUpdateRatingRecord();
    const instructorSuggestions = getInstructorSuggestions(data);

    const withThisRating = data.filter((r) => r.ratings[ratingType]);

    const recordsWithStatus = withThisRating.map((record) => ({
        record,
        displayStatus: getRatingDisplayStatus(record.ratings[ratingType], today),
    }));

    const visibleRecords = recordsWithStatus.filter(({ displayStatus }) => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'active-or-expired') return displayStatus === 'active' || displayStatus === 'expired';
        return displayStatus === statusFilter;
    });

    const filtered = [...visibleRecords]
        .filter(({ record }) => {
            if (!search.trim()) return true;
            const q = search.trim().toLowerCase();
            return record.name.toLowerCase().includes(q)
                || record.emp_id.toLowerCase().includes(q)
                || (record.designation || '').toLowerCase().includes(q)
                || (record.contact_no || '').toLowerCase().includes(q)
                || (record.current_station || '').toLowerCase().includes(q)
                || (record.license_number || '').toLowerCase().includes(q)
                || (record.highest_rating || '').toLowerCase().includes(q);
        })
        .sort((a, b) => {
            if (sort === 'designation') return (a.record.designation || '').localeCompare(b.record.designation || '');
            if (sort === 'prof-expiry') {
                const pvA = getProfValidity(a.record.ratings[ratingType], today);
                const pvB = getProfValidity(b.record.ratings[ratingType], today);
                return (pvA?.daysLeft ?? -9999) - (pvB?.daysLeft ?? -9999);
            }
            return a.record.name.localeCompare(b.record.name);
        });

    const activeCount = filtered.filter(({ displayStatus }) => displayStatus === 'active').length;
    const expiredCount = filtered.filter(({ displayStatus }) => displayStatus === 'expired').length;
    const inactiveCount = filtered.filter(({ displayStatus }) => displayStatus === 'inactive').length;

    let profExpired = 0, profWarning = 0, profValid = 0;
    filtered.forEach(({ record, displayStatus }) => {
        if (displayStatus === 'inactive') return;

        const pv = getProfValidity(record.ratings[ratingType], today);
        if (!pv || pv.daysLeft < 0) profExpired++;
        else if (pv.daysLeft <= 90) profWarning++;
        else profValid++;
    });

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold md:text-base flex items-center gap-1.5">
                        <Shield className="h-4 w-4 text-indigo-600" /> {ratingType} Rating Records
                    </h3>
                </div>
                <div className="flex items-center gap-2 md:flex-row md:items-center">
                    <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground md:top-3 md:h-3.5 md:w-3.5" />
                        <Input
                            placeholder="Search name, ID or designation"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-7 w-full pl-7 pr-8 text-xs md:h-10 md:pl-8 md:text-[15px]"
                        />
                        {search && (
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="absolute right-1 top-0.5 h-6 w-6 text-muted-foreground hover:text-foreground md:top-1.5 md:h-7 md:w-7"
                                onClick={() => setSearch('')}
                            >
                                <X className="h-3 w-3 md:h-3.5 md:w-3.5" />
                            </Button>
                        )}
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2 md:flex md:items-end md:justify-end">
                    <div className="min-w-0 space-y-1 md:w-[205px]">
                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">Filter</Label>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                            <SelectTrigger className="h-7 w-full text-xs md:h-9 md:text-[15px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="active-or-expired">Active or Expired</SelectItem>
                                <SelectItem value="all">All Employees</SelectItem>
                                <SelectItem value="active">Only Active Status</SelectItem>
                                <SelectItem value="expired">Only Expiry Status</SelectItem>
                                <SelectItem value="inactive">Only Inactive Status</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="min-w-0 space-y-1 md:w-[205px]">
                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">Sort</Label>
                        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                            <SelectTrigger className="h-7 w-full text-xs md:h-9 md:text-[15px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="prof-expiry">Prof Expiry (soonest)</SelectItem>
                                <SelectItem value="name">Name A-Z</SelectItem>
                                <SelectItem value="designation">Designation</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <Card className="border-0 bg-gradient-to-br from-slate-700 to-slate-900 text-white">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-white/75">Shown</span>
                        <span className="text-lg md:text-xl font-bold">{filtered.length}</span>
                    </CardContent>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50/30">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-emerald-600">Active</span>
                        <span className="text-lg md:text-xl font-bold text-emerald-600">{activeCount}</span>
                    </CardContent>
                </Card>
                <Card className="border-red-200 bg-red-50/30">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-red-600">Expired</span>
                        <span className="text-lg md:text-xl font-bold text-red-600">{expiredCount}</span>
                    </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50/30">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-amber-600">Prof ≤90d</span>
                        <span className="text-lg md:text-xl font-bold text-amber-600">{profWarning}</span>
                    </CardContent>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50/30">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-emerald-600">Prof Valid</span>
                        <span className="text-lg md:text-xl font-bold text-emerald-600">{profValid}</span>
                    </CardContent>
                </Card>
                <Card className="border-muted">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-muted-foreground">Inactive</span>
                        <span className="text-lg md:text-xl font-bold">{inactiveCount}</span>
                    </CardContent>
                </Card>
            </div>

            {/* Cards */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Shield className="h-10 w-10 mb-2 opacity-30" />
                    <p className="text-sm">No employees with {ratingType} rating.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
                    {filtered.map(({ record, displayStatus }) => {
                        const entry = record.ratings[ratingType];
                        const isActive = entry.status === '1';
                        const pv = isActive ? getProfValidity(entry, today) : null;
                        const expiryBadge = isActive ? getTopCardExpiryBadge(pv?.daysLeft ?? null) : null;
                        const profLabel = pv ? format(pv.validUpto, 'd MMM yy') : null;
                        const profDaysText = !pv ? null
                            : pv.daysLeft < 0 ? `${Math.abs(pv.daysLeft)}d overdue`
                                : `${pv.daysLeft}d left`;
                        const borderClass = !isActive ? 'border-muted'
                            : !pv || pv.daysLeft < 0 ? 'border-red-400'
                                : pv.daysLeft <= 90 ? 'border-amber-400'
                                    : 'border-emerald-300';
                        const statusBadge = displayStatus === 'expired'
                            ? <Badge className="bg-red-100 text-red-700 border-red-200 text-[9px] px-1.5 py-0">Expiry</Badge>
                            : displayStatus === 'active'
                                ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[9px] px-1.5 py-0">Active</Badge>
                                : <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-[9px] px-1.5 py-0">Inactive</Badge>;

                        const profEntries = Object.entries(entry.proficiency_history || {}).sort(([a], [b]) => b.localeCompare(a));

                        return (
                            <Card key={record.emp_id} className={`p-3 md:p-4 space-y-2 ${borderClass}`}>
                                {expiryBadge && (
                                    <div className="flex justify-start">
                                        <Badge variant="outline" className={`text-[9px] md:text-[10px] px-1.5 py-0 ${expiryBadge.className}`}>
                                            Expiry {expiryBadge.label}
                                        </Badge>
                                    </div>
                                )}
                                {/* Header */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-xs md:text-sm font-semibold leading-tight truncate">{record.name}</p>
                                        <p className="text-[10px] md:text-xs text-muted-foreground">{record.emp_id}</p>
                                        <div className="mt-1 space-y-0.5 text-[10px] md:text-xs text-muted-foreground">
                                            <p>{record.contact_no || 'No contact'} · {record.current_station || 'No station'}</p>
                                            <p>{record.license_number ? `Lic ${record.license_number}` : 'No license'} · {record.elpa_level ? `ELPA ${record.elpa_level}` : 'No ELPA'} · {record.highest_rating || 'No highest rating'}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {record.designation && (
                                            <Badge variant="secondary" className="text-[9px] md:text-[10px] px-1.5 py-0">{record.designation}</Badge>
                                        )}
                                        {statusBadge}
                                    </div>
                                </div>

                                <Separator />

                                {/* Rating details */}
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] md:text-xs">
                                    <div>
                                        <span className="text-muted-foreground">Rating Date</span>
                                        <p className="font-medium">{entry.rating_date ? format(new Date(entry.rating_date), 'd MMM yyyy') : '-'}</p>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Last Proficiency</span>
                                        <p className="font-medium">
                                            {entry.last_proficiency?.date ? format(new Date(entry.last_proficiency.date), 'd MMM yyyy') : '-'}
                                        </p>
                                        {entry.last_proficiency?.instructor && (
                                            <p className="text-[9px] text-muted-foreground">{entry.last_proficiency.instructor}</p>
                                        )}
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Endorsement</span>
                                        <p className="font-medium">{entry.endorsement_date ? format(new Date(entry.endorsement_date), 'd MMM yyyy') : '-'}</p>
                                    </div>
                                    {isActive && (
                                        <div>
                                            <span className="text-muted-foreground">Prof Valid Upto</span>
                                            {pv ? (
                                                <p className={`font-medium ${pv.daysLeft < 0 ? 'text-red-600' : pv.daysLeft <= 90 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                                    {profLabel}
                                                    <span className="text-[9px] ml-1">({profDaysText})</span>
                                                </p>
                                            ) : (
                                                <p className="font-medium text-red-600">No Prof</p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Prof history count + Details */}
                                <div className="flex items-center justify-between pt-1">
                                    <span className="text-[10px] md:text-xs text-muted-foreground">
                                        {profEntries.length} proficiency check{profEntries.length !== 1 ? 's' : ''}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setEditingRecord(cloneRecordForEdit(record))}>
                                            <Pencil className="h-3 w-3 mr-0.5" /> Edit
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setViewingRecord(record)}>
                                            <Eye className="h-3 w-3 mr-0.5" /> Details
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Detail Dialog — shows all ratings for selected employee */}
            <RatingDetailDialog record={viewingRecord} onClose={() => setViewingRecord(null)} />
            <RatingEditDialog
                record={editingRecord}
                onClose={() => setEditingRecord(null)}
                onSave={(record) => updateRatingRecord.mutate(record, { onSuccess: () => setEditingRecord(null) })}
                isSaving={updateRatingRecord.isPending}
                instructorSuggestions={instructorSuggestions}
                visibleRatingKeys={editingRecord ? [ratingType] : undefined}
            />
        </div>
    );
}

/** Shared detail dialog */
function RatingDetailDialog({ record, onClose }: { record: RatingSyncRecord | null; onClose: () => void }) {
    const today = startOfDay(new Date());

    return (
        <Dialog open={!!record} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg max-h-[85vh] overflow-y-auto sm:w-full">
                <DialogHeader>
                    <DialogTitle className="text-base flex items-center gap-1.5">
                        <Shield className="h-4 w-4" /> Rating Details
                    </DialogTitle>
                    <DialogDescription>
                        {record?.name} ({record?.emp_id}){record?.designation ? ` · ${record.designation}` : ''}
                    </DialogDescription>
                </DialogHeader>
                {record && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-2">
                            <div>
                                <span className="text-muted-foreground text-xs">Contact No</span>
                                <p className="font-medium">{record.contact_no || '-'}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground text-xs">Current Station</span>
                                <p className="font-medium">{record.current_station || '-'}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground text-xs">Current License Number</span>
                                <p className="font-medium">{record.license_number || '-'}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground text-xs">ICAO ELPA Level</span>
                                <p className="font-medium">{record.elpa_level || '-'}</p>
                            </div>
                            <div className="sm:col-span-2">
                                <span className="text-muted-foreground text-xs">Highest Rating</span>
                                <p className="font-medium">{record.highest_rating || '-'}</p>
                            </div>
                        </div>
                        {Object.entries(record.ratings).map(([key, entry]) => {
                            const isActive = entry.status === '1';
                            const profEntries = Object.entries(entry.proficiency_history || {}).sort(([a], [b]) => a.localeCompare(b));
                            return (
                                <div key={key} className={`rounded-md border p-3 space-y-2 ${isActive ? 'border-emerald-200 bg-emerald-50/30' : 'border-muted bg-muted/20'}`}>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-bold">{key}</span>
                                        <Badge className={`text-[10px] px-1.5 py-0 ${isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                                            {isActive ? 'Active' : 'Inactive'}
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                        <div>
                                            <span className="text-muted-foreground text-xs">Rating Date</span>
                                            <p className="font-medium">{entry.rating_date ? format(new Date(entry.rating_date), 'd MMM yyyy') : '-'}</p>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground text-xs">Endorsement Date</span>
                                            <p className="font-medium">{entry.endorsement_date ? format(new Date(entry.endorsement_date), 'd MMM yyyy') : '-'}</p>
                                        </div>
                                    </div>
                                    {entry.last_proficiency?.date && (
                                        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                            <div>
                                                <span className="text-muted-foreground text-xs">Last Proficiency</span>
                                                <p className="font-medium">
                                                    {format(new Date(entry.last_proficiency.date), 'd MMM yyyy')}
                                                    {entry.last_proficiency.instructor ? ` — ${entry.last_proficiency.instructor}` : ''}
                                                </p>
                                            </div>
                                            {isActive && (() => {
                                                const pvDialog = getProfValidity(entry, today);
                                                if (!pvDialog) return null;
                                                const pvClass = pvDialog.daysLeft < 0
                                                    ? 'text-red-600'
                                                    : pvDialog.daysLeft <= 90
                                                        ? 'text-amber-600'
                                                        : 'text-emerald-600';
                                                return (
                                                    <div>
                                                        <span className="text-muted-foreground text-xs">Prof Valid Upto</span>
                                                        <p className={`font-medium ${pvClass}`}>
                                                            {format(pvDialog.validUpto, 'd MMM yyyy')}
                                                            <span className="text-xs ml-1">
                                                                ({pvDialog.daysLeft < 0 ? `${Math.abs(pvDialog.daysLeft)}d overdue` : `${pvDialog.daysLeft}d left`})
                                                            </span>
                                                        </p>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                    {profEntries.length > 0 && (
                                        <>
                                            <Separator />
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Proficiency History</h4>
                                                <div className="space-y-1">
                                                    {profEntries.map(([pKey, pVal]) => (
                                                        <div key={pKey} className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                                                            <span className="text-muted-foreground">{pKey}</span>
                                                            <span className="font-medium">
                                                                {pVal.date ? format(new Date(pVal.date), 'd MMM yyyy') : '-'}
                                                                {pVal.instructor ? ` · ${pVal.instructor}` : ''}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function InstructorCombobox({ value, onChange, suggestions, placeholder = 'Instructor name' }: {
    value: string;
    onChange: (val: string) => void;
    suggestions: string[];
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const filtered = suggestions.filter((s) =>
        s.toLowerCase().includes((search || value || '').toLowerCase()),
    );

    return (
        <div ref={wrapperRef} className="relative z-20">
            <Input
                autoComplete="nope"
                name={`instructor-${Math.random()}`}
                className="h-8 text-xs"
                value={value}
                placeholder={placeholder}
                onChange={(e) => {
                    onChange(e.target.value);
                    setSearch(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
            />
            {open && filtered.length > 0 && (
                <ul className="absolute z-[80] mt-1 max-h-40 w-full overflow-auto rounded-md border bg-popover p-1 text-xs shadow-md">
                    {filtered.slice(0, 20).map((name) => (
                        <li
                            key={name}
                            className="cursor-pointer rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
                            onMouseDown={() => {
                                onChange(name);
                                setSearch('');
                                setOpen(false);
                            }}
                        >
                            {name}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function RatingEditDialog({
    record,
    onClose,
    onSave,
    isSaving,
    instructorSuggestions,
    visibleRatingKeys,
}: {
    record: EditableRatingRecord | null;
    onClose: () => void;
    onSave: (record: EditableRatingRecord) => void;
    isSaving: boolean;
    instructorSuggestions: string[];
    visibleRatingKeys?: string[];
}) {
    const [draft, setDraft] = useState<EditableRatingRecord | null>(null);


    useEffect(() => {
        if (record) {
            setDraft(record);

            return;
        }

        setDraft(null);
    }, [record]);

    const updateEntry = (ratingKey: string, updater: (entry: RatingEntry) => RatingEntry) => {
        setDraft((current) => {
            if (!current) return current;
            const entry = current.ratings[ratingKey] || createEmptyRatingEntry();
            return {
                ...current,
                ratings: {
                    ...current.ratings,
                    [ratingKey]: updater(entry),
                },
            };
        });
    };

    const allRatingKeys = draft ? [...new Set([...RATING_TYPES, ...Object.keys(draft.ratings)])] : [];
    const ratingKeys = visibleRatingKeys?.length
        ? allRatingKeys.filter((key) => visibleRatingKeys.includes(key))
        : allRatingKeys;

    const getNextHistoryLabel = (ratingKey: string): string | null => {
        if (!draft) return null;
        const used = new Set(Object.keys(draft.ratings[ratingKey]?.proficiency_history || {}));
        for (const label of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
            if (!used.has(label)) return label;
        }
        return null;
    };

    return (
        <Dialog open={!!record} onOpenChange={(open) => { if (!open) { setDraft(null); onClose(); } }}>
            <DialogContent className="w-[calc(100vw-1.5rem)] max-w-4xl max-h-[85vh] overflow-hidden flex flex-col sm:w-full">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Pencil className="h-4 w-4 text-indigo-600" />
                        Edit Rating Record
                    </DialogTitle>
                    <DialogDescription>
                        {draft?.name} ({draft?.emp_id}){draft?.designation ? ` · ${draft.designation}` : ''}
                    </DialogDescription>
                </DialogHeader>
                {draft && (
                    <div className="flex-1 overflow-y-auto pr-1">
                        <div className="space-y-5 pb-4">
                            <div className="grid grid-cols-1 gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact No</Label>
                                    <p className="mt-1 font-medium">{draft.contact_no || '-'}</p>
                                </div>
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Station</Label>
                                    <p className="mt-1 font-medium">{draft.current_station || '-'}</p>
                                </div>
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">License Number</Label>
                                    <p className="mt-1 font-medium">{draft.license_number || '-'}</p>
                                </div>
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ICAO ELPA Level</Label>
                                    <p className="mt-1 font-medium">{draft.elpa_level || '-'}</p>
                                </div>
                                <div className="sm:col-span-2 lg:col-span-2">
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Highest Rating</Label>
                                    <p className="mt-1 font-medium">{draft.highest_rating || '-'}</p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Designation</Label>
                                <Input
                                    value={draft.designation || ''}
                                    onChange={(e) => setDraft({ ...draft, designation: e.target.value || null })}
                                    placeholder="Designation"
                                    className="h-9"
                                />
                            </div>

                            {ratingKeys.map((ratingKey) => {
                                const entry = normalizeRatingEntry(draft.ratings[ratingKey] || createEmptyRatingEntry());
                                const historyEntries = Object.entries(entry.proficiency_history || {}).sort(([first], [second]) => first.localeCompare(second));
                                const theme = getRatingEditTheme(ratingKey);

                                return (
                                    <div key={ratingKey} className={`rounded-xl border shadow-sm ${theme.panelClass}`}>
                                        <div className={`border-b px-4 py-3 ${theme.headerClass}`}>
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="space-y-2">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Badge className={`border ${theme.badgeClass}`}>{ratingKey}</Badge>
                                                        <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                                                            Rating Track
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                        Edit rating dates, status, and proficiency history for {ratingKey}.
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 self-start sm:self-center">
                                                    <span className={`hidden h-8 w-1 rounded-full sm:block ${theme.accentClass}`} />
                                                    <Select
                                                        value={entry.status || '0'}
                                                        onValueChange={(value) => updateEntry(ratingKey, (current) => ({ ...current, status: value }))}
                                                    >
                                                        <SelectTrigger className="h-8 w-[132px] bg-background/90 text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="1">Active</SelectItem>
                                                            <SelectItem value="0">Inactive</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-4 p-4">
                                            <div className={`rounded-lg border p-3 ${theme.sectionClass}`}>
                                                <div className="mb-3 flex items-center gap-2">
                                                    <span className={`h-2.5 w-2.5 rounded-full ${theme.accentClass}`} />
                                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Core Dates</Label>
                                                </div>
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">Rating Date</Label>
                                                        <Input
                                                            type="date"
                                                            className="h-8 bg-background text-xs"
                                                            value={entry.rating_date || ''}
                                                            onChange={(e) => updateEntry(ratingKey, (current) => ({ ...current, rating_date: e.target.value || null }))}
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">Endorsement Date</Label>
                                                        <Input
                                                            type="date"
                                                            className="h-8 bg-background text-xs"
                                                            value={entry.endorsement_date || ''}
                                                            onChange={(e) => updateEntry(ratingKey, (current) => ({ ...current, endorsement_date: e.target.value || null }))}
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">Last Proficiency Date</Label>
                                                        <Input
                                                            type="text"
                                                            className="h-8 bg-background text-xs"
                                                            value={entry.last_proficiency?.date || ''}
                                                            placeholder="Auto from latest proficiency"
                                                            disabled
                                                        />
                                                    </div>
                                                    <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                                                        <Label className="text-xs">Last Proficiency Instructor</Label>
                                                        <Input
                                                            value={entry.last_proficiency?.instructor || ''}
                                                            placeholder="Auto from latest proficiency"
                                                            className="h-8 bg-background text-xs"
                                                            disabled
                                                        />
                                                        <p className="text-[11px] text-muted-foreground">
                                                            Auto-filled from the latest proficiency history date.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className={`rounded-lg border p-3 ${theme.sectionClass}`}>
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`h-2.5 w-2.5 rounded-full ${theme.accentClass}`} />
                                                        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proficiency History</Label>
                                                    </div>
                                                    {(() => {
                                                        const nextLabel = getNextHistoryLabel(ratingKey);
                                                        return nextLabel ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 bg-background text-xs"
                                                                onClick={() => {
                                                                    updateEntry(ratingKey, (current) => ({
                                                                        ...current,
                                                                        proficiency_history: {
                                                                            ...current.proficiency_history,
                                                                            [nextLabel]: { date: null, instructor: null },
                                                                        },
                                                                    }));
                                                                }}
                                                            >
                                                                <Plus className="mr-1 h-3 w-3" /> Add Proficiency Record
                                                            </Button>
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">All proficiency slots used</span>
                                                        );
                                                    })()}
                                                </div>

                                                {historyEntries.length === 0 ? (
                                                    <p className="mt-3 text-xs text-muted-foreground">No proficiency history entries.</p>
                                                ) : (
                                                    <div className="mt-3 space-y-2">
                                                        {historyEntries.map(([historyKey, historyValue]) => (
                                                            <div key={historyKey} className="grid grid-cols-1 gap-2 rounded-md border bg-background/90 p-3 sm:grid-cols-[1fr_160px_1fr_auto] sm:items-end">
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs">Label</Label>
                                                                    <Input value={historyKey} className="h-8 bg-background text-xs" disabled />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs">Date</Label>
                                                                    <Input
                                                                        type="date"
                                                                        className="h-8 bg-background text-xs"
                                                                        value={historyValue.date || ''}
                                                                        onChange={(e) => updateEntry(ratingKey, (current) => ({
                                                                            ...current,
                                                                            proficiency_history: {
                                                                                ...current.proficiency_history,
                                                                                [historyKey]: {
                                                                                    ...current.proficiency_history[historyKey],
                                                                                    date: e.target.value || null,
                                                                                },
                                                                            },
                                                                        }))}
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs">Instructor</Label>
                                                                    <InstructorCombobox
                                                                        value={historyValue.instructor || ''}
                                                                        onChange={(val) => updateEntry(ratingKey, (current) => ({
                                                                            ...current,
                                                                            proficiency_history: {
                                                                                ...current.proficiency_history,
                                                                                [historyKey]: {
                                                                                    ...current.proficiency_history[historyKey],
                                                                                    instructor: val || null,
                                                                                },
                                                                            },
                                                                        }))}
                                                                        suggestions={instructorSuggestions}
                                                                    />
                                                                </div>
                                                                <Button
                                                                    type="button"
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 text-muted-foreground hover:text-red-500"
                                                                    onClick={() => updateEntry(ratingKey, (current) => {
                                                                        const updatedHistory = { ...current.proficiency_history };
                                                                        delete updatedHistory[historyKey];
                                                                        return {
                                                                            ...current,
                                                                            proficiency_history: updatedHistory,
                                                                        };
                                                                    })}
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="flex flex-col-reverse justify-end gap-2 border-t pt-3 sm:flex-row">
                    <Button variant="outline" onClick={() => { setDraft(null); onClose(); }}>Cancel</Button>
                    <Button onClick={() => draft && onSave(draft)} disabled={!draft || isSaving}>
                        <Save className="mr-1 h-3.5 w-3.5" />
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ---------- Main Component ----------
export default function RatingsManagement() {
    const { data: ratingSyncData = [], isLoading, refetch } = useRatingSyncData();
    const syncRatingData = useSyncRatingData();
    const today = startOfDay(new Date());

    const totalEmployees = ratingSyncData.length;
    const activeRatings = ratingSyncData.reduce(
        (sum, record) => sum + Object.values(record.ratings).filter((entry) => entry.status === '1').length,
        0,
    );
    const expiredRatings = ratingSyncData.reduce(
        (sum, record) => sum + Object.values(record.ratings).filter((entry) => {
            if (entry.status !== '1') return false;
            const validity = getProfValidity(entry, today);
            return !validity || validity.daysLeft < 0;
        }).length,
        0,
    );
    const expiringSoonRatings = ratingSyncData.reduce(
        (sum, record) => sum + Object.values(record.ratings).filter((entry) => {
            if (entry.status !== '1') return false;
            const validity = getProfValidity(entry, today);
            return !!validity && validity.daysLeft >= 0 && validity.daysLeft <= 90;
        }).length,
        0,
    );

    return (
        <DashboardLayout role="supervisor">
            <div className="space-y-4 p-4 md:p-6">
                <Tabs defaultValue="overview" className="w-full">
                    <div className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-indigo-50/70 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)]">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(99,102,241,0.16),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.12),_transparent_28%)]" />
                        <div className="absolute right-0 top-0 h-40 w-40 translate-x-10 -translate-y-10 rounded-full bg-indigo-200/30 blur-3xl" />
                        <div className="absolute bottom-0 left-0 h-32 w-32 -translate-x-8 translate-y-8 rounded-full bg-sky-200/40 blur-3xl" />

                        <div className="relative space-y-6 p-5 md:p-7">
                            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                                <div className="max-w-2xl space-y-3">
                                    <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-indigo-700 shadow-sm backdrop-blur">
                                        <Shield className="h-3.5 w-3.5" />
                                        Supervisor Console
                                    </div>
                                    <div className="space-y-2">
                                        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">Ratings Management</h1>
                                        <p className="max-w-xl text-sm leading-6 text-slate-600 md:text-[15px]">
                                            Review operational ratings, isolate overdue proficiency checks, and switch between rating tracks from one control surface.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                        <Badge variant="secondary" className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-700 shadow-sm">
                                            {RATING_TYPES.length} rating tracks
                                        </Badge>
                                        <Badge variant="secondary" className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-700 shadow-sm">
                                            Live sync enabled
                                        </Badge>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[420px]">
                                    <div className="rounded-2xl border border-white/80 bg-white/75 px-4 py-3 shadow-sm backdrop-blur">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Employees</p>
                                        <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{totalEmployees}</p>
                                    </div>
                                    <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/80 px-4 py-3 shadow-sm">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-700">Active Ratings</p>
                                        <p className="mt-2 text-2xl font-semibold tracking-tight text-emerald-800">{activeRatings}</p>
                                    </div>
                                    <div className="rounded-2xl border border-red-200/80 bg-red-50/85 px-4 py-3 shadow-sm">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-red-700">Expired</p>
                                        <p className="mt-2 text-2xl font-semibold tracking-tight text-red-800">{expiredRatings}</p>
                                    </div>
                                    <div className="rounded-2xl border border-amber-200/80 bg-amber-50/85 px-4 py-3 shadow-sm">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-700">Due ≤90d</p>
                                        <p className="mt-2 text-2xl font-semibold tracking-tight text-amber-800">{expiringSoonRatings}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-white/80 bg-white/80 p-1.5 shadow-sm backdrop-blur">
                                <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
                                    <TabsTrigger
                                        value="overview"
                                        className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm"
                                    >
                                        <Shield className="mr-1.5 h-3.5 w-3.5" /> Overview
                                    </TabsTrigger>
                                    {RATING_TYPES.map((rt) => (
                                        <TabsTrigger
                                            key={rt}
                                            value={rt}
                                            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm"
                                        >
                                            {rt}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </div>
                        </div>
                    </div>

                    <TabsContent value="overview">
                        <OverviewTab
                            data={ratingSyncData}
                            syncMutation={syncRatingData}
                            refetch={refetch}
                            isLoading={isLoading}
                        />
                    </TabsContent>

                    {RATING_TYPES.map((rt) => (
                        <TabsContent key={rt} value={rt}>
                            <RatingTypeTab
                                data={ratingSyncData}
                                ratingType={rt}
                                isLoading={isLoading}
                            />
                        </TabsContent>
                    ))}
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
