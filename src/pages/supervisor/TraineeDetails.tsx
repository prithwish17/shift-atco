import { useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GraduationCap, Plus } from 'lucide-react';
import { SupervisorTraineePanel } from './RatingsManagement';

export default function TraineeDetails() {
    const [addDialogOpen, setAddDialogOpen] = useState(false);

    return (
        <DashboardLayout role="supervisor">
            <div className="space-y-4 p-3 sm:p-4 md:p-6">
                <div className="relative overflow-hidden rounded-[22px] border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-indigo-50/70 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.95)_45%,rgba(30,27,75,0.9)_100%)] sm:rounded-[28px]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(99,102,241,0.16),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.12),_transparent_28%)] dark:bg-[radial-gradient(circle_at_top_right,_rgba(99,102,241,0.2),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.12),_transparent_24%)]" />
                    <div className="absolute right-0 top-0 h-28 w-28 translate-x-8 -translate-y-8 rounded-full bg-indigo-200/30 blur-3xl dark:bg-indigo-500/20 sm:h-40 sm:w-40 sm:translate-x-10 sm:-translate-y-10" />
                    <div className="absolute bottom-0 left-0 h-24 w-24 -translate-x-6 translate-y-6 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-500/20 sm:h-32 sm:w-32 sm:-translate-x-8 sm:translate-y-8" />

                    <div className="relative space-y-3 p-4 sm:space-y-4 sm:p-5 md:p-7">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
                            <div className="space-y-3 sm:space-y-4">
                                <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-700 shadow-sm backdrop-blur dark:border-indigo-500/30 dark:bg-white/10 dark:text-indigo-200 sm:px-3 sm:text-[11px] sm:tracking-[0.24em]">
                                    <GraduationCap className="h-3.5 w-3.5" />
                                    Supervisor Console
                                </div>
                                <div className="space-y-1.5 sm:space-y-2">
                                    <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-2xl md:text-3xl">Trainee Details</h1>
                                    <p className="max-w-2xl text-[13px] leading-5 text-slate-600 dark:text-slate-300 sm:text-sm sm:leading-6 md:text-[15px]">
                                        Track trainee unit marking, required hours, and supervisor status updates from one dedicated workspace.
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                    <Badge variant="secondary" className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
                                        Trainee sync enabled
                                    </Badge>
                                </div>
                            </div>

                            <Button
                                type="button"
                                onClick={() => setAddDialogOpen(true)}
                                className="h-9 w-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 sm:h-10 sm:w-auto"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Add Employee
                            </Button>
                        </div>
                    </div>
                </div>

                <SupervisorTraineePanel addDialogOpen={addDialogOpen} onAddDialogOpenChange={setAddDialogOpen} />
            </div>
        </DashboardLayout>
    );
}