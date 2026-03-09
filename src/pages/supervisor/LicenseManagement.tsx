import { useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Heart, MapPin, AlertTriangle, Plus, Users } from 'lucide-react';
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

interface MedicalRow {
    id: string;
    employee_id: string;
    medical_class: string;
    issue_date: string | null;
    expiry_date: string | null;
    status: string;
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

function useAllMedicals() {
    return useQuery({
        queryKey: ['all-medicals'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('medical_certificates' as any)
                .select('*')
                .order('expiry_date', { ascending: true });
            if (error) throw error;
            const medicals = (data || []) as unknown as MedicalRow[];

            const empIds = new Set<string>();
            for (const m of medicals) { if (m.employee_id) empIds.add(m.employee_id); }

            let profileMap: Record<string, { full_name: string; employee_id: string }> = {};
            if (empIds.size > 0) {
                const { data: profiles } = await supabase.from('profiles').select('id, full_name, employee_id').in('id', Array.from(empIds));
                if (profiles) { for (const p of profiles) { profileMap[p.id] = { full_name: p.full_name, employee_id: p.employee_id }; } }
            }

            return medicals.map((m) => ({ ...m, profile: profileMap[m.employee_id] || undefined }));
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

// ---------- Helpers ----------
const RATING_LABELS: Record<string, string> = {
    rdr: 'Radar', app: 'Approach', plr: 'Precision',
    adc: 'Aerodrome', alpha: 'Alpha', occ: 'Oceanic',
};

function getExpiryBadge(expiryDate: string | null) {
    if (!expiryDate) return <Badge variant="secondary" className="text-[10px]">N/A</Badge>;
    const days = differenceInDays(new Date(expiryDate), startOfDay(new Date()));
    if (days < 0) return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Expired</Badge>;
    if (days <= 30) return <Badge className="bg-red-100 text-red-600 border-red-200 text-[10px]">{days}d left</Badge>;
    if (days <= 90) return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">{days}d left</Badge>;
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Valid</Badge>;
}

// ---------- Component ----------
export default function LicenseManagement() {
    const qc = useQueryClient();
    const { data: licenses = [] } = useAllLicenses();
    const { data: medicals = [] } = useAllMedicals();
    const { data: endorsements = [] } = useAllEndorsements();

    // Expiry heatmap
    const expiryStats = useMemo(() => {
        const today = startOfDay(new Date());
        const all = [
            ...licenses.map((l) => ({ type: 'rating', expiry: l.expiry_date, name: l.profile?.full_name })),
            ...medicals.map((m) => ({ type: 'medical', expiry: m.expiry_date, name: m.profile?.full_name })),
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
    }, [licenses, medicals, endorsements]);

    // Medical form
    const [medDialogOpen, setMedDialogOpen] = useState(false);
    const [medForm, setMedForm] = useState({ employee_id: '', medical_class: 'Class 3', issue_date: '', expiry_date: '' });

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
    const addMedical = useMutation({
        mutationFn: async (form: typeof medForm) => {
            const { error } = await supabase.from('medical_certificates' as any)
                .upsert({
                    employee_id: form.employee_id,
                    medical_class: form.medical_class,
                    issue_date: form.issue_date || null,
                    expiry_date: form.expiry_date || null,
                    status: 'valid',
                } as any, { onConflict: 'employee_id,medical_class' });
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['all-medicals'] });
            toast.success('Medical certificate saved');
            setMedDialogOpen(false);
        },
        onError: (e: any) => toast.error(e.message),
    });

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
                    <p className="text-muted-foreground text-sm">Ratings, medical certificates & unit endorsements</p>
                </div>

                {/* Expiry Heatmap */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Card className="border-0 bg-gradient-to-br from-slate-700 to-slate-900 text-white">
                        <CardContent className="pt-4 pb-4 text-center">
                            <Users className="h-5 w-5 mx-auto mb-1 opacity-70" />
                            <div className="text-2xl font-bold">{expiryStats.total}</div>
                            <div className="text-[10px] uppercase tracking-wide opacity-70">Total Records</div>
                        </CardContent>
                    </Card>
                    <Card className="border-red-200 bg-red-50">
                        <CardContent className="pt-4 pb-4 text-center">
                            <div className="text-2xl font-bold text-red-700">{expiryStats.expired.length}</div>
                            <div className="text-[10px] uppercase tracking-wide text-red-600">Expired</div>
                        </CardContent>
                    </Card>
                    <Card className="border-amber-200 bg-amber-50">
                        <CardContent className="pt-4 pb-4 text-center">
                            <div className="text-2xl font-bold text-amber-700">{expiryStats.in30.length}</div>
                            <div className="text-[10px] uppercase tracking-wide text-amber-600">Expiring ≤ 30 days</div>
                        </CardContent>
                    </Card>
                    <Card className="border-yellow-200 bg-yellow-50">
                        <CardContent className="pt-4 pb-4 text-center">
                            <div className="text-2xl font-bold text-yellow-700">{expiryStats.in90.length}</div>
                            <div className="text-[10px] uppercase tracking-wide text-yellow-600">Expiring ≤ 90 days</div>
                        </CardContent>
                    </Card>
                </div>

                {/* Tabs */}
                <Tabs defaultValue="ratings" className="w-full">
                    <TabsList>
                        <TabsTrigger value="ratings">
                            <Shield className="h-3.5 w-3.5 mr-1" /> Ratings ({licenses.length})
                        </TabsTrigger>
                        <TabsTrigger value="medical">
                            <Heart className="h-3.5 w-3.5 mr-1" /> Medical ({medicals.length})
                        </TabsTrigger>
                        <TabsTrigger value="endorsements">
                            <MapPin className="h-3.5 w-3.5 mr-1" /> Endorsements ({endorsements.length})
                        </TabsTrigger>
                    </TabsList>

                    {/* Ratings Tab */}
                    <TabsContent value="ratings">
                        <Card>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b bg-muted/50">
                                                <th className="px-4 py-2 text-left font-medium">Employee</th>
                                                <th className="px-4 py-2 text-left font-medium">Rating</th>
                                                <th className="px-4 py-2 text-left font-medium">Issued</th>
                                                <th className="px-4 py-2 text-left font-medium">Expires</th>
                                                <th className="px-4 py-2 text-center font-medium">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {licenses.map((lic) => (
                                                <tr key={lic.id} className="border-b hover:bg-muted/30">
                                                    <td className="px-4 py-2.5">
                                                        <div className="font-medium">{lic.profile?.full_name || '—'}</div>
                                                        <div className="text-xs text-muted-foreground">{lic.profile?.employee_id}</div>
                                                    </td>
                                                    <td className="px-4 py-2.5">{RATING_LABELS[lic.license_type] || lic.license_type}</td>
                                                    <td className="px-4 py-2.5 text-muted-foreground">
                                                        {lic.issue_date ? format(new Date(lic.issue_date), 'd MMM yyyy') : '—'}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-muted-foreground">
                                                        {lic.expiry_date ? format(new Date(lic.expiry_date), 'd MMM yyyy') : '—'}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-center">{getExpiryBadge(lic.expiry_date)}</td>
                                                </tr>
                                            ))}
                                            {licenses.length === 0 && (
                                                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No ratings found</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Medical Tab */}
                    <TabsContent value="medical">
                        <Card>
                            <CardHeader className="py-2 px-4 flex flex-row items-center justify-between">
                                <CardTitle className="text-sm font-semibold">Medical Certificates</CardTitle>
                                <Dialog open={medDialogOpen} onOpenChange={setMedDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button size="sm" onClick={() => setMedForm({ employee_id: '', medical_class: 'Class 3', issue_date: '', expiry_date: '' })}>
                                            <Plus className="h-3.5 w-3.5 mr-1" /> Add Medical
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader><DialogTitle>Add / Update Medical Certificate</DialogTitle></DialogHeader>
                                        <form onSubmit={(e) => { e.preventDefault(); addMedical.mutate(medForm); }} className="space-y-3">
                                            <div className="space-y-1">
                                                <Label>Employee</Label>
                                                <Select value={medForm.employee_id} onValueChange={(v) => setMedForm({ ...medForm, employee_id: v })}>
                                                    <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                                                    <SelectContent>
                                                        {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name} ({p.employee_id})</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1">
                                                <Label>Medical Class</Label>
                                                <Select value={medForm.medical_class} onValueChange={(v) => setMedForm({ ...medForm, medical_class: v })}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="Class 3">Class 3 (ATC)</SelectItem>
                                                        <SelectItem value="Class 2">Class 2</SelectItem>
                                                        <SelectItem value="Class 1">Class 1</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <Label>Issue Date</Label>
                                                    <Input type="date" value={medForm.issue_date} onChange={(e) => setMedForm({ ...medForm, issue_date: e.target.value })} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label>Expiry Date</Label>
                                                    <Input type="date" value={medForm.expiry_date} onChange={(e) => setMedForm({ ...medForm, expiry_date: e.target.value })} />
                                                </div>
                                            </div>
                                            <Button type="submit" className="w-full" disabled={addMedical.isPending || !medForm.employee_id}>
                                                {addMedical.isPending ? 'Saving...' : 'Save'}
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
                                                <th className="px-4 py-2 text-left font-medium">Class</th>
                                                <th className="px-4 py-2 text-left font-medium">Issued</th>
                                                <th className="px-4 py-2 text-left font-medium">Expires</th>
                                                <th className="px-4 py-2 text-center font-medium">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {medicals.map((m) => (
                                                <tr key={m.id} className="border-b hover:bg-muted/30">
                                                    <td className="px-4 py-2.5">
                                                        <div className="font-medium">{m.profile?.full_name || '—'}</div>
                                                        <div className="text-xs text-muted-foreground">{m.profile?.employee_id}</div>
                                                    </td>
                                                    <td className="px-4 py-2.5">{m.medical_class}</td>
                                                    <td className="px-4 py-2.5 text-muted-foreground">
                                                        {m.issue_date ? format(new Date(m.issue_date), 'd MMM yyyy') : '—'}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-muted-foreground">
                                                        {m.expiry_date ? format(new Date(m.expiry_date), 'd MMM yyyy') : '—'}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-center">{getExpiryBadge(m.expiry_date)}</td>
                                                </tr>
                                            ))}
                                            {medicals.length === 0 && (
                                                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No medical certificates</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

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
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
