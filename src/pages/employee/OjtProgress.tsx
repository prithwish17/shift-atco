import { GraduationCap, Info } from 'lucide-react';

import { DashboardLayout } from '@/components/DashboardLayout';
import { OjtProgressCard } from '@/components/ojt/OjtProgressCard';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyOjtProgress } from '@/hooks/useMyOjtProgress';

export default function EmployeeOjtProgress() {
    const { data: records = [], isLoading, error } = useMyOjtProgress();

    return (
        <DashboardLayout role="employee">
            <div className="space-y-4 p-3 sm:p-4 md:p-6">
                <div className="space-y-1.5">
                    <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-950/40 dark:text-indigo-200">
                        <GraduationCap className="h-3.5 w-3.5" />
                        Training
                    </div>
                    <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">My OJT Progress</h1>
                    <p className="max-w-2xl text-[13px] leading-5 text-muted-foreground">
                        Hours logged against your OJT requirement, and the rate you need to keep to finish before the deadline.
                    </p>
                </div>

                {error && (
                    <Card>
                        <CardContent className="p-6 text-center text-sm text-destructive">
                            {error instanceof Error ? error.message : 'Failed to load your OJT progress'}
                        </CardContent>
                    </Card>
                )}

                {isLoading && (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Skeleton className="h-64 w-full" />
                        <Skeleton className="h-64 w-full" />
                    </div>
                )}

                {!isLoading && !error && records.length === 0 && (
                    <Card>
                        <CardContent className="p-8 text-center">
                            <p className="text-sm font-medium">No OJT record found</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                You are not currently marked for OJT in any unit. If that looks wrong, speak to your supervisor.
                            </p>
                        </CardContent>
                    </Card>
                )}

                {!isLoading && !error && records.length > 0 && (
                    <>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {records.map((record) => (
                                <OjtProgressCard
                                    key={`${record.empId}|${record.unit}`}
                                    record={record}
                                    audience="employee"
                                />
                            ))}
                        </div>

                        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-[11px] leading-5 text-muted-foreground">
                            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <p>
                                Hours and duty days come from the training sheet and refresh twice a day, at 13:00 and 19:00 IST.
                                <span className="ml-1">
                                    &ldquo;Required rate&rdquo; is the hours per day you need from today to finish by the deadline.
                                </span>{' '}
                                Raise anything that looks wrong with your supervisor — OJT records are edited there.
                            </p>
                        </div>
                    </>
                )}
            </div>
        </DashboardLayout>
    );
}
