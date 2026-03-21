import { useState } from 'react';
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
import { Shield, RefreshCw, Search, X, Eye } from 'lucide-react';
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
    ratings: Record<string, RatingEntry>;
}

// ---------- Hooks ----------
function useRatingSyncData() {
    return useQuery<RatingSyncRecord[]>({
        queryKey: ['rating-sync-data'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_training_records' as any)
                .select('emp_id, employee_name, rating_data, rating_designation')
                .not('rating_data', 'eq', '{}')
                .order('employee_name', { ascending: true });

            if (error) throw error;

            return ((data || []) as unknown as Array<{
                emp_id: string;
                employee_name: string;
                rating_data: Record<string, RatingEntry> | null;
                rating_designation: string | null;
            }>).map((row) => ({
                emp_id: row.emp_id,
                name: row.employee_name,
                designation: row.rating_designation,
                ratings: row.rating_data || {},
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

// ---------- Helpers ----------
const RATING_TYPES = ['ADC', 'APP', 'ACC', 'ACC(S)', 'OCC', 'PLR'] as const;
type RatingType = typeof RATING_TYPES[number];

function getProfValidity(entry: RatingEntry, today: Date) {
    if (!entry.last_proficiency?.date) return null;
    const profDate = new Date(entry.last_proficiency.date);
    const validUpto = addDays(profDate, 364);
    const daysLeft = differenceInDays(validUpto, today);
    return { validUpto, daysLeft };
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

// ---------- Sub-components ----------

/** Overview tab — shows all employees with all their active ratings */
function OverviewTab({
    data, syncMutation, refetch, isLoading
}: { data: RatingSyncRecord[]; syncMutation: ReturnType<typeof useSyncRatingData>; refetch: () => void; isLoading: boolean }) {
    const today = startOfDay(new Date());
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<'name' | 'designation'>('name');
    const [viewingRecord, setViewingRecord] = useState<RatingSyncRecord | null>(null);

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
            <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search name, ID or designation..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 md:h-8 text-xs md:text-sm" />
                    {search && (
                        <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5" onClick={() => setSearch('')}>
                            <X className="h-3 w-3" />
                        </Button>
                    )}
                </div>
                <Button size="sm" className="h-7 md:h-8 text-xs md:text-sm gap-1" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                    <RefreshCw className={`h-3 w-3 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                    {syncMutation.isPending ? 'Syncing...' : 'Fetch & Save'}
                </Button>
                <div className="flex items-center gap-1">
                    <Label className="text-[10px] md:text-xs text-muted-foreground">Sort</Label>
                    <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                        <SelectTrigger className="h-6 md:h-7 text-[10px] md:text-xs w-[130px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="name">Name A-Z</SelectItem>
                            <SelectItem value="designation">Designation</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7" onClick={() => refetch()}>
                    <RefreshCw className="h-3 w-3" />
                </Button>
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
                        const borderClass = worstStatus === 'expired' ? 'border-red-400' : worstStatus === 'warning' ? 'border-amber-400' : worstStatus === 'valid' ? 'border-emerald-300' : '';

                        return (
                            <Card key={record.emp_id} className={`p-3 md:p-4 space-y-2.5 ${borderClass}`}>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-xs md:text-sm font-semibold leading-tight truncate">{record.name}</p>
                                        <p className="text-[10px] md:text-xs text-muted-foreground">{record.emp_id}</p>
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
                                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setViewingRecord(record)}>
                                        <Eye className="h-3 w-3 mr-0.5" /> Details
                                    </Button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Detail Dialog */}
            <RatingDetailDialog record={viewingRecord} onClose={() => setViewingRecord(null)} />
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
    const [viewingRecord, setViewingRecord] = useState<RatingSyncRecord | null>(null);

    // Only employees that have this rating type
    const withThisRating = data.filter((r) => r.ratings[ratingType]);
    const active = withThisRating.filter((r) => r.ratings[ratingType]?.status === '1');
    const inactive = withThisRating.filter((r) => r.ratings[ratingType]?.status !== '1');

    let profExpired = 0, profWarning = 0, profValid = 0;
    active.forEach((r) => {
        const pv = getProfValidity(r.ratings[ratingType], today);
        if (!pv || pv.daysLeft < 0) profExpired++;
        else if (pv.daysLeft <= 90) profWarning++;
        else profValid++;
    });

    const filtered = [...withThisRating]
        .filter((r) => {
            if (!search.trim()) return true;
            const q = search.trim().toLowerCase();
            return r.name.toLowerCase().includes(q) || r.emp_id.toLowerCase().includes(q) || (r.designation || '').toLowerCase().includes(q);
        })
        .sort((a, b) => {
            if (sort === 'designation') return (a.designation || '').localeCompare(b.designation || '');
            if (sort === 'prof-expiry') {
                const pvA = getProfValidity(a.ratings[ratingType], today);
                const pvB = getProfValidity(b.ratings[ratingType], today);
                return (pvA?.daysLeft ?? -9999) - (pvB?.daysLeft ?? -9999);
            }
            return a.name.localeCompare(b.name);
        });

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search name, ID or designation..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 md:h-8 text-xs md:text-sm" />
                    {search && (
                        <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5" onClick={() => setSearch('')}>
                            <X className="h-3 w-3" />
                        </Button>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <Label className="text-[10px] md:text-xs text-muted-foreground">Sort</Label>
                    <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                        <SelectTrigger className="h-6 md:h-7 text-[10px] md:text-xs w-[140px]">
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

            {/* Summary */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <Card className="border-0 bg-gradient-to-br from-slate-700 to-slate-900 text-white">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-white/75">Total</span>
                        <span className="text-lg md:text-xl font-bold">{withThisRating.length}</span>
                    </CardContent>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50/30">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-emerald-600">Active</span>
                        <span className="text-lg md:text-xl font-bold text-emerald-600">{active.length}</span>
                    </CardContent>
                </Card>
                <Card className="border-muted">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-muted-foreground">Inactive</span>
                        <span className="text-lg md:text-xl font-bold">{inactive.length}</span>
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
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Shield className="h-10 w-10 mb-2 opacity-30" />
                    <p className="text-sm">No employees with {ratingType} rating.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
                    {filtered.map((record) => {
                        const entry = record.ratings[ratingType];
                        const isActive = entry.status === '1';
                        const pv = isActive ? getProfValidity(entry, today) : null;
                        const profLabel = pv ? format(pv.validUpto, 'd MMM yy') : null;
                        const profDaysText = !pv ? null
                            : pv.daysLeft < 0 ? `${Math.abs(pv.daysLeft)}d overdue`
                                : `${pv.daysLeft}d left`;
                        const borderClass = !isActive ? 'border-muted'
                            : !pv || pv.daysLeft < 0 ? 'border-red-400'
                                : pv.daysLeft <= 90 ? 'border-amber-400'
                                    : 'border-emerald-300';
                        const statusBadge = isActive
                            ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[9px] px-1.5 py-0">Active</Badge>
                            : <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-[9px] px-1.5 py-0">Inactive</Badge>;

                        const profEntries = Object.entries(entry.proficiency_history || {}).sort(([a], [b]) => b.localeCompare(a));

                        return (
                            <Card key={record.emp_id} className={`p-3 md:p-4 space-y-2 ${borderClass}`}>
                                {/* Header */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-xs md:text-sm font-semibold leading-tight truncate">{record.name}</p>
                                        <p className="text-[10px] md:text-xs text-muted-foreground">{record.emp_id}</p>
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
                                        <span className="text-muted-foreground">Endorsement</span>
                                        <p className="font-medium">{entry.endorsement_date ? format(new Date(entry.endorsement_date), 'd MMM yyyy') : '-'}</p>
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
                                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setViewingRecord(record)}>
                                        <Eye className="h-3 w-3 mr-0.5" /> Details
                                    </Button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Detail Dialog — shows all ratings for selected employee */}
            <RatingDetailDialog record={viewingRecord} onClose={() => setViewingRecord(null)} />
        </div>
    );
}

/** Shared detail dialog */
function RatingDetailDialog({ record, onClose }: { record: RatingSyncRecord | null; onClose: () => void }) {
    const today = startOfDay(new Date());

    return (
        <Dialog open={!!record} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
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
                                    <div className="grid grid-cols-2 gap-2 text-sm">
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
                                        <div className="grid grid-cols-2 gap-2 text-sm">
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
                                                        <div key={pKey} className="flex justify-between text-sm">
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

// ---------- Main Component ----------
export default function RatingsManagement() {
    const { data: ratingSyncData = [], isLoading, refetch } = useRatingSyncData();
    const syncRatingData = useSyncRatingData();

    return (
        <DashboardLayout role="supervisor">
            <div className="space-y-4 p-4 md:p-6">
                <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-indigo-600" />
                    <h1 className="text-lg md:text-xl font-bold">Ratings Management</h1>
                </div>

                <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="flex h-auto flex-wrap">
                        <TabsTrigger value="overview">
                            <Shield className="h-3.5 w-3.5 mr-1" /> Overview
                        </TabsTrigger>
                        {RATING_TYPES.map((rt) => (
                            <TabsTrigger key={rt} value={rt}>
                                {rt}
                            </TabsTrigger>
                        ))}
                    </TabsList>

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
