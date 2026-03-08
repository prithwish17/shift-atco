import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHolidays, useCreateHoliday, useUpdateHoliday, useDeleteHoliday } from "@/hooks/useHolidays";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar as CalendarIcon,
  Plus,
  Edit,
  Trash2,
  Upload,
  ChevronDown,
  ChevronUp,
  LayoutList,
} from "lucide-react";
import {
  format,
  startOfDay,
  parseISO,
  isBefore,
  isSameDay,
  startOfMonth,
  getDay,
  getDaysInMonth,
  getMonth,
} from "date-fns";
import { Switch } from "@/components/ui/switch";
import { HolidayCSVImport } from "@/components/HolidayCSVImport";
import {
  useHolidaysByYear,
  useNextHoliday,
  useHolidaysByType,
  type Holiday,
} from "@/hooks/useHolidayDashboard";

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// ── Color system ──
const TYPE_DOT: Record<string, string> = { NH: 'bg-red-500', CH: 'bg-emerald-500', RH: 'bg-amber-500' };
const TYPE_CHIP_BG: Record<string, string> = {
  NH: 'bg-red-100 dark:bg-red-900/30',
  CH: 'bg-emerald-100 dark:bg-emerald-900/30',
  RH: 'bg-amber-100 dark:bg-amber-900/30',
};
const TYPE_CHIP_TEXT: Record<string, string> = {
  NH: 'text-red-700 dark:text-red-400',
  CH: 'text-emerald-700 dark:text-emerald-400',
  RH: 'text-amber-700 dark:text-amber-400',
};
const TYPE_BORDER: Record<string, string> = {
  NH: 'border-red-300 dark:border-red-800',
  CH: 'border-emerald-300 dark:border-emerald-800',
  RH: 'border-amber-300 dark:border-amber-800',
};

function getTypeBadge(type: string) {
  const bg = TYPE_CHIP_BG[type] || 'bg-gray-100';
  const text = TYPE_CHIP_TEXT[type] || 'text-gray-700';
  return <Badge className={`${bg} ${text} border-0 text-[10px] font-bold`}>{type}</Badge>;
}

export default function HolidayManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(getMonth(new Date()));
  const [tab, setTab] = useState<'calendar' | 'timeline'>('calendar');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<any>(null);
  const [formData, setFormData] = useState({ name: "", holiday_date: "", type: "", comp_off_eligible: false });
  const [csvOpen, setCsvOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [showRH, setShowRH] = useState(false);

  // Data hooks
  const { data: holidays = [], isLoading } = useHolidays();
  const { data: yearHolidays = [] } = useHolidaysByYear(selectedYear);
  const createHoliday = useCreateHoliday();
  const updateHoliday = useUpdateHoliday();
  const deleteHoliday = useDeleteHoliday();

  const today = startOfDay(new Date());
  const nextHoliday = useNextHoliday(yearHolidays);
  const { national, closed, restricted } = useHolidaysByType(yearHolidays);

  // ── Calendar logic ──
  const monthHolidays = useMemo(() =>
    yearHolidays.filter((h) => {
      const d = new Date(h.holiday_date);
      return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
    }), [yearHolidays, selectedMonth, selectedYear]);

  const holidayDateSet = useMemo(() => {
    const map = new Map<number, Holiday>();
    monthHolidays.forEach((h) => map.set(new Date(h.holiday_date).getDate(), h));
    return map;
  }, [monthHolidays]);

  const calendarGrid = useMemo(() => {
    const firstDay = startOfMonth(new Date(selectedYear, selectedMonth));
    const daysInMonth = getDaysInMonth(firstDay);
    const start = getDay(firstDay);
    const cells: (number | null)[] = [];
    for (let i = 0; i < start; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [selectedYear, selectedMonth]);

  const todayDate = today.getDate();
  const isCurrentMonth = today.getMonth() === selectedMonth && today.getFullYear() === selectedYear;

  // ── Timeline logic ──
  const sorted = useMemo(() =>
    [...(holidays as any[])]
      .filter((h) => showRH || h.type !== 'RH')
      .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)),
    [holidays, showRH]);

  const { pastHolidays, upcomingHolidays } = useMemo(() => {
    const past: any[] = [], upcoming: any[] = [];
    for (const h of sorted) {
      const d = parseISO(h.holiday_date);
      if (isBefore(d, today) && !isSameDay(d, today)) past.push(h);
      else upcoming.push(h);
    }
    return { pastHolidays: past, upcomingHolidays: upcoming };
  }, [sorted, today]);

  const groupByMonth = (list: any[]) => {
    const g: Record<string, any[]> = {};
    for (const h of list) { const k = h.holiday_date.substring(0, 7); if (!g[k]) g[k] = []; g[k].push(h); }
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  };
  const upcomingGroups = groupByMonth(upcomingHolidays);
  const pastGroups = groupByMonth(pastHolidays);

  // ── Form handlers ──
  const resetForm = () => ({ name: "", holiday_date: "", type: "", comp_off_eligible: false });
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const year = formData.holiday_date ? parseInt(formData.holiday_date.substring(0, 4)) : currentYear;
    try {
      if (editingHoliday) {
        await updateHoliday.mutateAsync({ id: editingHoliday.id, ...formData, type: formData.type as any, year });
      } else {
        await createHoliday.mutateAsync({ ...formData, type: formData.type as any, year, station: 'ALL', selectable: formData.type === 'RH', created_by: user.id });
      }
      toast({ title: editingHoliday ? "Holiday updated" : "Holiday created" });
      setDialogOpen(false); setEditingHoliday(null); setFormData(resetForm());
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };
  const handleEdit = (h: any) => { setEditingHoliday(h); setFormData({ name: h.name, holiday_date: h.holiday_date, type: h.type, comp_off_eligible: h.comp_off_eligible }); setDialogOpen(true); };
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this holiday?")) return;
    try { await deleteHoliday.mutateAsync(id); toast({ title: "Deleted" }); }
    catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  // ── Timeline Holiday Card ──
  const TimelineCard = ({ holiday, isNext }: { holiday: any; isNext: boolean }) => {
    const d = parseISO(holiday.holiday_date);
    const monthIdx = d.getMonth();
    const day = d.getDate();
    const dayName = format(d, 'EEEE').toUpperCase();
    const typeColor = TYPE_CHIP_BG[holiday.type] || TYPE_CHIP_BG.NH;
    const typeText = TYPE_CHIP_TEXT[holiday.type] || TYPE_CHIP_TEXT.NH;
    const borderColor = isNext ? (TYPE_BORDER[holiday.type] || 'border-red-400') : 'border-slate-200 dark:border-neutral-800';

    return (
      <div className={`relative group ${isNext ? 'mt-4' : ''}`}>
        <div className="absolute -left-[23px] top-1/2 -translate-y-1/2 w-4 h-[1px] bg-slate-200 dark:bg-neutral-800" />

        {isNext && (
          <div className="absolute -top-3 left-3 z-20">
            <span className={`flex items-center gap-1.5 px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-full leading-none shadow-lg ${holiday.type === 'NH' ? 'bg-red-500 shadow-red-500/40' :
              holiday.type === 'CH' ? 'bg-emerald-500 shadow-emerald-500/40' :
                'bg-amber-500 shadow-amber-500/40'
              } text-white`}>
              Next Holiday in {nextHoliday?.daysUntil === 0 ? 'Today' : `${nextHoliday?.daysUntil} ${nextHoliday?.daysUntil === 1 ? 'Day' : 'Days'}`}
            </span>
          </div>
        )}

        <div className={`relative rounded-[16px] overflow-hidden flex h-[80px] border-2 transition-all ${borderColor} bg-white dark:bg-neutral-900`}>
          <div className="relative z-10 flex flex-col items-center justify-center py-2 w-[74px] shrink-0">
            <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${typeText}`}>{MONTH_SHORT[monthIdx]}</span>
            <span className="text-xl font-bold leading-none tracking-tighter text-slate-900 dark:text-white">{String(day).padStart(2, '0')}</span>
          </div>
          <div className={`relative z-10 my-auto w-[1.5px] shrink-0 h-8 bg-slate-200 dark:bg-neutral-700`} />
          <div className="relative z-10 flex-1 flex flex-col justify-center py-2 px-4 min-w-0">
            <h3 className="text-sm font-bold leading-tight mb-0.5 text-slate-900 dark:text-white truncate">{holiday.name}</h3>
            <div className="flex items-center gap-1.5">
              <div className={`px-2 py-0.5 rounded-full flex items-center gap-1 ${typeColor}`}>
                <span className={`text-[8px] font-bold uppercase tracking-wider ${typeText}`}>{dayName}</span>
              </div>
              {getTypeBadge(holiday.type)}
            </div>
          </div>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
            <button onClick={(e) => { e.stopPropagation(); handleEdit(holiday); }} className="p-1.5 rounded-lg bg-white/90 dark:bg-neutral-800/90 border border-slate-200 dark:border-neutral-700 hover:bg-slate-100 dark:hover:bg-neutral-700 transition-colors">
              <Edit className="h-3 w-3 text-slate-600 dark:text-neutral-400" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleDelete(holiday.id); }} className="p-1.5 rounded-lg bg-white/90 dark:bg-neutral-800/90 border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
              <Trash2 className="h-3 w-3 text-red-500" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <DashboardLayout role="supervisor">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="supervisor">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight uppercase">Holidays</h1>
            <p className="text-sm text-muted-foreground">Holiday calendar, comp-off & RH management</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)}>
              <Upload className="h-3.5 w-3.5 mr-1" /> CSV
            </Button>
            <HolidayCSVImport open={csvOpen} onOpenChange={setCsvOpen} createdBy={user?.id || ''} />
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => { setEditingHoliday(null); setFormData(resetForm()); }}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingHoliday ? "Edit Holiday" : "Add New Holiday"}</DialogTitle>
                  <DialogDescription>{editingHoliday ? "Update holiday" : "Create a new holiday"}</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2"><Label htmlFor="name">Holiday Name</Label><Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required /></div>
                  <div className="space-y-2"><Label htmlFor="holiday_date">Date</Label><Input id="holiday_date" type="date" value={formData.holiday_date} onChange={(e) => setFormData({ ...formData, holiday_date: e.target.value })} required /></div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NH">National Holiday (NH)</SelectItem>
                        <SelectItem value="RH">Restricted Holiday (RH)</SelectItem>
                        <SelectItem value="CH">Closed Holiday (CH)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch id="comp_off" checked={formData.comp_off_eligible} onCheckedChange={(c) => setFormData({ ...formData, comp_off_eligible: c })} />
                    <Label htmlFor="comp_off">Comp Off Eligible</Label>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={createHoliday.isPending || updateHoliday.isPending}>
                      {createHoliday.isPending || updateHoliday.isPending ? "Saving..." : editingHoliday ? "Update" : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>


        {/* ── Tab Toggle: Calendar | Timeline + RH Toggle ── */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setTab('calendar')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full border transition-all ${tab === 'calendar'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                : 'bg-white dark:bg-neutral-800 text-slate-600 dark:text-neutral-400 border-slate-200 dark:border-neutral-700 hover:bg-slate-100 dark:hover:bg-neutral-700'
                }`}
            >
              <CalendarIcon className="h-3.5 w-3.5" /> Calendar
            </button>
            <button
              onClick={() => setTab('timeline')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full border transition-all ${tab === 'timeline'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                : 'bg-white dark:bg-neutral-800 text-slate-600 dark:text-neutral-400 border-slate-200 dark:border-neutral-700 hover:bg-slate-100 dark:hover:bg-neutral-700'
                }`}
            >
              <LayoutList className="h-3.5 w-3.5" /> Timeline
            </button>
          </div>
          {tab === 'timeline' && (
            <button
              onClick={() => setShowRH(!showRH)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-full border transition-all ${showRH
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white dark:bg-neutral-800 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              RH {showRH ? 'ON' : 'OFF'}
            </button>
          )}
        </div>

        {/* ══════════════════════════════════════ */}
        {/* ── CALENDAR VIEW ── */}
        {/* ══════════════════════════════════════ */}
        {tab === 'calendar' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ── Left Column: Calendar + Closed Holidays ── */}
            <div className="space-y-4">
              {/* Mini Calendar */}
              <Card>
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">Calendar</CardTitle>
                    <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                      <SelectTrigger className="w-[90px] h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTH_NAMES.map((m, i) => (
                          <SelectItem key={i} value={String(i)}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {DAY_LABELS.map((d) => (
                      <div key={d} className="text-[10px] font-medium text-muted-foreground py-1">{d}</div>
                    ))}
                    {calendarGrid.map((day, i) => {
                      const holiday = day ? holidayDateSet.get(day) : null;
                      const isToday = isCurrentMonth && day === todayDate;
                      return (
                        <div
                          key={i}
                          className={`
                            aspect-square flex flex-col items-center justify-center rounded-md text-xs relative
                            ${!day ? '' : 'cursor-default'}
                            ${isToday ? 'bg-indigo-600 text-white font-bold' : ''}
                            ${holiday && !isToday ? 'font-semibold' : ''}
                            ${holiday && !isToday && holiday.type === 'NH' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400' : ''}
                            ${holiday && !isToday && holiday.type === 'CH' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : ''}
                            ${holiday && !isToday && holiday.type === 'RH' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' : ''}
                          `}
                          title={holiday ? `${holiday.name} (${holiday.type})` : undefined}
                        >
                          {day || ''}
                          {holiday && (
                            <div className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${isToday ? 'bg-white' : (TYPE_DOT[holiday.type] || 'bg-gray-400')}`} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> NH</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> CH</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> RH</span>
                  </div>
                </CardContent>
              </Card>

              {/* Closed Holidays */}
              <Card>
                <CardHeader className="py-2.5 px-4 bg-blue-50/50 dark:bg-blue-900/10">
                  <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    Closed Holidays ({closed.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 py-2">
                  <div className="divide-y">
                    {closed.map((h) => (
                      <div key={h.id} className="py-2 flex justify-between items-center group">
                        <div>
                          <p className="text-sm font-medium">{h.name}</p>
                          <p className="text-xs text-muted-foreground">{format(new Date(h.holiday_date), 'EEEE, d MMM')}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {getTypeBadge('CH')}
                          <button onClick={() => handleEdit(h)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-100 dark:hover:bg-neutral-800 transition"><Edit className="h-3 w-3 text-slate-500" /></button>
                          <button onClick={() => handleDelete(h.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition"><Trash2 className="h-3 w-3 text-red-500" /></button>
                        </div>
                      </div>
                    ))}
                    {closed.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No closed holidays</p>}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── Right Column: National + Restricted Holidays ── */}
            <div className="space-y-4">
              {/* National */}
              <Card>
                <CardHeader className="py-2.5 px-4 bg-red-50/50 dark:bg-red-900/10">
                  <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    National Holidays ({national.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 py-2">
                  <div className="divide-y">
                    {national.map((h) => (
                      <div key={h.id} className="py-2 flex justify-between items-center group">
                        <div>
                          <p className="text-sm font-medium">{h.name}</p>
                          <p className="text-xs text-muted-foreground">{format(new Date(h.holiday_date), 'EEEE, d MMM')}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {getTypeBadge('NH')}
                          <button onClick={() => handleEdit(h)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-100 dark:hover:bg-neutral-800 transition"><Edit className="h-3 w-3 text-slate-500" /></button>
                          <button onClick={() => handleDelete(h.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition"><Trash2 className="h-3 w-3 text-red-500" /></button>
                        </div>
                      </div>
                    ))}
                    {national.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No national holidays</p>}
                  </div>
                </CardContent>
              </Card>

              {/* Restricted */}
              <Card>
                <CardHeader className="py-2.5 px-4 bg-amber-50/50 dark:bg-amber-900/10">
                  <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    Restricted Holidays ({restricted.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 py-2">
                  <div className="divide-y">
                    {restricted.map((h) => (
                      <div key={h.id} className="py-2 flex justify-between items-center group">
                        <div>
                          <p className="text-sm font-medium">{h.name}</p>
                          <p className="text-xs text-muted-foreground">{format(new Date(h.holiday_date), 'EEEE, d MMM')}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {getTypeBadge('RH')}
                          <button onClick={() => handleEdit(h)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-100 dark:hover:bg-neutral-800 transition"><Edit className="h-3 w-3 text-slate-500" /></button>
                          <button onClick={() => handleDelete(h.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition"><Trash2 className="h-3 w-3 text-red-500" /></button>
                        </div>
                      </div>
                    ))}
                    {restricted.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No restricted holidays</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════ */}
        {/* ── TIMELINE VIEW ── */}
        {/* ══════════════════════════════════════ */}
        {tab === 'timeline' && (
          <div className="relative pb-8">
            {/* Global vertical line */}
            <div className="absolute left-[3px] top-0 bottom-0 w-[1px] bg-slate-200 dark:bg-neutral-800" />

            {/* Today */}
            <div className="relative pl-8 mb-8 flex items-center">
              <div className="absolute -left-[5px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-indigo-500 ring-4 ring-indigo-500/20 z-10" />
              <div className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800/30 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">
                  Today • {format(today, 'dd MMM yyyy')}
                </span>
              </div>
            </div>

            {/* Upcoming months */}
            {upcomingGroups.map(([monthKey, items], groupIdx) => {
              const [, monthStr] = monthKey.split('-');
              const monthName = format(new Date(parseInt(monthKey), parseInt(monthStr) - 1), 'MMMM').toUpperCase();
              const isFirstGroup = groupIdx === 0;

              return (
                <div key={monthKey} className="pb-8 relative pl-8">
                  <div className="sticky top-[200px] z-20 flex items-center py-2 relative mb-3 bg-background/95 backdrop-blur-sm -mx-2 px-2 rounded-lg">
                    <div className="absolute -left-[31px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500 ring-4 ring-white dark:ring-neutral-950" />
                    <span className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-[0.15em]">
                      {monthName} <span className="mx-1 text-slate-300 dark:text-neutral-700">/</span> {items.length} {items.length === 1 ? 'HOLIDAY' : 'HOLIDAYS'}
                    </span>
                  </div>
                  <div className="space-y-3 relative">
                    {items.map((h: any, idx: number) => (
                      <TimelineCard key={h.id} holiday={h} isNext={!showRH && isFirstGroup && idx === 0 && !!nextHoliday} />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {upcomingGroups.length === 0 && pastHolidays.length === 0 && (
              <div className="py-12 text-center pl-8">
                <CalendarIcon className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-500">No holidays found</p>
              </div>
            )}

            {/* Past holidays */}
            {pastHolidays.length > 0 && (
              <div className="relative mt-4 bg-slate-100/50 dark:bg-black/20 -mx-4 px-4 pt-6 pb-6 border-t border-slate-200 dark:border-neutral-800/50 rounded-b-xl">
                <div className="absolute left-[7px] top-0 bottom-0 w-[1px] bg-slate-300 dark:bg-neutral-800" />
                <div className="flex items-center justify-end pb-4">
                  <button onClick={() => setShowPast(!showPast)} className="flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest hover:underline">
                    ({pastHolidays.length} Past Holidays) {showPast ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </div>
                {showPast && pastGroups.map(([monthKey, items]) => {
                  const [, monthStr] = monthKey.split('-');
                  const monthName = format(new Date(parseInt(monthKey), parseInt(monthStr) - 1), 'MMMM').toUpperCase();
                  return (
                    <div key={monthKey} className="pb-6 relative pl-8">
                      <div className="flex items-center relative mb-3">
                        <div className="absolute -left-[31px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-slate-400 dark:bg-neutral-600 ring-4 ring-slate-100/80 dark:ring-neutral-900/80" />
                        <span className="text-xs font-bold text-slate-500 dark:text-neutral-400 uppercase tracking-[0.15em]">
                          {monthName} <span className="mx-1 text-slate-300 dark:text-neutral-700">/</span> {items.length} {items.length === 1 ? 'HOLIDAY' : 'HOLIDAYS'}
                        </span>
                      </div>
                      <div className="space-y-3 opacity-60">{items.map((h: any) => <TimelineCard key={h.id} holiday={h} isNext={false} />)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
