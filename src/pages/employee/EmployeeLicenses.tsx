import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Clock3, FileStack, HeartPulse, Radar, Shield, Sparkles, UserRoundCheck, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUsers';
import { buildEmployeeLicenseHealth, getHealthStatusLabel, type HealthStatus, type LicenseHealthItem, type LicenseWithExtras } from '@/hooks/useLicenseDashboard';

function formatDisplayDate(value?: string | null) {
    if (!value) return 'Not available';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'd MMM yyyy');
}

function getStatusBadgeClasses(status: HealthStatus) {
    if (status === 'expired') return 'border-red-200 bg-red-50 text-red-700';
    if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
    if (status === 'valid') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    return 'border-slate-200 bg-slate-50 text-slate-600';
}

function getStatusPillClasses(status: HealthStatus) {
    if (status === 'expired') return 'bg-red-600 text-white';
    if (status === 'warning') return 'bg-amber-500 text-white';
    if (status === 'valid') return 'bg-emerald-500 text-white';
    return 'bg-slate-500 text-white';
}

function getStatusIcon(status: HealthStatus) {
    if (status === 'expired') return <XCircle className="h-4 w-4" />;
    if (status === 'warning') return <AlertTriangle className="h-4 w-4" />;
    if (status === 'valid') return <CheckCircle2 className="h-4 w-4" />;
    return <Clock3 className="h-4 w-4" />;
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
    return (
        <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
            <p className="text-[11px] uppercase tracking-[0.22em] text-white/70">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p>
            <p className="mt-1 text-sm text-white/70">{hint}</p>
        </div>
    );
}

function WatchItem({ item }: { item: LicenseHealthItem }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-black/20">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.label}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</p>
                </div>
                <Badge variant="outline" className={getStatusBadgeClasses(item.status)}>
                    {getHealthStatusLabel(item)}
                </Badge>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{item.kind.toUpperCase()}</span>
                <span>{formatDisplayDate(item.expiryDate)}</span>
            </div>
        </div>
    );
}

export default function EmployeeLicenses() {
    const { user } = useAuth();
    const { profile, isLoading } = useUserProfile(user?.id);

    if (isLoading) {
        return (
            <DashboardLayout role="employee">
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
                </div>
            </DashboardLayout>
        );
    }

    const health = buildEmployeeLicenseHealth(profile, ((profile?.licenses || []) as LicenseWithExtras[]));
    const watchlistPreview = health.watchlist.slice(0, 4);

    return (
        <DashboardLayout role="employee">
            <div className="space-y-6">
                <section className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_45%,#14b8a6_100%)] shadow-xl shadow-sky-200/40 dark:border-slate-800 dark:shadow-black/30">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.2),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.18),transparent_26%)]" />
                    <div className="relative grid gap-6 p-6 md:p-8 xl:grid-cols-[1.35fr_0.95fr]">
                        <div className="space-y-5">
                            <div className="space-y-3">
                                <div className="flex items-center gap-3 text-white">
                                    <Shield className="h-6 w-6" />
                                    <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">License Status</h1>
                                </div>
                                <p className="max-w-2xl text-sm leading-6 text-white/75 md:text-base">
                                    Find all the details of license, ratings, expiry dates, and related validity records.
                                </p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                <MetricCard label="License Number" value={health.licenseNumber} hint="Stored in training records" />
                                <MetricCard label="Highest Rating" value={health.highestRating} hint="Latest backend-linked rating" />
                                <MetricCard label="Active Ratings" value={String(health.activeRatingsCount)} hint="Operational rating cards below" />
                                <MetricCard label="Next Review" value={health.nextExpiry ? formatDisplayDate(health.nextExpiry.expiryDate) : 'No date'} hint={health.nextExpiry ? health.nextExpiry.label : 'Nothing scheduled yet'} />
                            </div>
                        </div>

                        <div className="rounded-[26px] border border-white/20 bg-white/12 p-5 backdrop-blur-md">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-white/70">Overall Readiness</p>
                                    <p className="mt-2 text-3xl font-semibold text-white">{health.overallLabel}</p>
                                </div>
                                <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${getStatusPillClasses(health.overallStatus)}`}>
                                    {getStatusIcon(health.overallStatus)}
                                    {health.overallStatus.toUpperCase()}
                                </div>
                            </div>

                            <p className="mt-4 text-sm leading-6 text-white/80">{health.summary}</p>

                            <div className="mt-6 grid grid-cols-3 gap-3">
                                <div className="rounded-2xl bg-black/15 p-4 text-white">
                                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/65">Expired</p>
                                    <p className="mt-2 text-2xl font-semibold">{health.expiredCount}</p>
                                </div>
                                <div className="rounded-2xl bg-black/15 p-4 text-white">
                                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/65">Due Soon</p>
                                    <p className="mt-2 text-2xl font-semibold">{health.warningCount}</p>
                                </div>
                                <div className="rounded-2xl bg-black/15 p-4 text-white">
                                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/65">Last Sync</p>
                                    <p className="mt-2 text-sm font-semibold leading-5">{formatDisplayDate(profile?.rating_synced_at)}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {watchlistPreview.length > 0 && (
                    <section className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Clock3 className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">Watchlist</h2>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            {watchlistPreview.map((item) => (
                                <WatchItem key={item.id} item={item} />
                            ))}
                        </div>
                    </section>
                )}

                <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
                    <Card className="overflow-hidden border-slate-200 shadow-lg shadow-slate-200/50 dark:border-slate-800 dark:shadow-black/20">
                        <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fafc_65%,#f0fdfa_100%)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(30,41,59,0.92)_0%,rgba(15,23,42,0.96)_100%)]">
                            <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                                <Radar className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                                Operational Ratings
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 md:p-5">
                            {health.ratings.length > 0 ? (
                                <div className="grid gap-4 md:grid-cols-2">
                                    {health.ratings.map((rating) => (
                                        <div key={rating.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-950 dark:shadow-black/20">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{rating.label}</p>
                                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{rating.subtitle}</p>
                                                </div>
                                                <div className="flex flex-col items-end gap-2">
                                                    <Badge variant="outline" className={getStatusBadgeClasses(rating.status)}>
                                                        {getHealthStatusLabel(rating)}
                                                    </Badge>
                                                    <Badge variant="secondary" className={rating.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                                                        {rating.isActive ? 'Active' : 'Inactive'}
                                                    </Badge>
                                                </div>
                                            </div>

                                            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                                                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                                                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Expiry Date</p>
                                                    <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{formatDisplayDate(rating.expiryDate)}</p>
                                                </div>
                                                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                                                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Endorsement</p>
                                                    <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{formatDisplayDate(rating.endorsementDate)}</p>
                                                </div>
                                                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                                                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Last Proficiency</p>
                                                    <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{formatDisplayDate(rating.lastProficiencyDate)}</p>
                                                </div>
                                                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                                                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Instructor</p>
                                                    <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{rating.lastInstructor || 'Not recorded'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                                    No operational ratings are linked to this employee yet.
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="space-y-6">
                        <Card className="overflow-hidden border-slate-200 shadow-lg shadow-slate-200/40 dark:border-slate-800 dark:shadow-black/20">
                            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#ecfeff_0%,#f8fafc_100%)] dark:border-slate-800 dark:bg-slate-950">
                                <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                                    <HeartPulse className="h-5 w-5 text-rose-600" />
                                    Compliance
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 p-4">
                                {health.compliance.map((item) => (
                                    <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-slate-100">{item.label}</p>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</p>
                                            </div>
                                            <Badge variant="outline" className={getStatusBadgeClasses(item.status)}>
                                                {getHealthStatusLabel(item)}
                                            </Badge>
                                        </div>
                                        <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                                            <p>Expiry: {formatDisplayDate(item.expiryDate)}</p>
                                            {item.meta && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.meta}</p>}
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card className="overflow-hidden border-slate-200 shadow-lg shadow-slate-200/40 dark:border-slate-800 dark:shadow-black/20">
                            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#fff7ed_0%,#f8fafc_100%)] dark:border-slate-800 dark:bg-slate-950">
                                <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                                    <UserRoundCheck className="h-5 w-5 text-amber-600" />
                                    Instructor And Examiner Privileges
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 p-4">
                                {health.qualifications.length > 0 ? health.qualifications.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
                                        <div>
                                            <p className="font-medium text-slate-900 dark:text-slate-100">{item.label}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">{formatDisplayDate(item.expiryDate)}</p>
                                        </div>
                                        <Badge variant="outline" className={getStatusBadgeClasses(item.status)}>
                                            {getHealthStatusLabel(item)}
                                        </Badge>
                                    </div>
                                )) : (
                                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                                        No instructor or examiner validity records available.
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>

                <Card className="overflow-hidden border-slate-200 shadow-lg shadow-slate-200/40 dark:border-slate-800 dark:shadow-black/20">
                    <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#f0fdf4_100%)] dark:border-slate-800 dark:bg-slate-950">
                        <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                            <FileStack className="h-5 w-5 text-emerald-600" />
                            License Register
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 md:p-5">
                        {health.licenses.length > 0 ? (
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {health.licenses.map((license) => (
                                    <div key={license.id} className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-slate-100">{license.label}</p>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{license.meta || 'License entry'}</p>
                                            </div>
                                            <Badge variant="outline" className={getStatusBadgeClasses(license.status)}>
                                                {getHealthStatusLabel(license)}
                                            </Badge>
                                        </div>
                                        <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                                            <p>Issued: {formatDisplayDate(license.issueDate)}</p>
                                            <p>Expires: {formatDisplayDate(license.expiryDate)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                                No license rows are stored for this employee in the backend database yet.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
