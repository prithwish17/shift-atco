import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, Heart, MapPin, AlertTriangle, CheckCircle2, XCircle, Clock, Award } from 'lucide-react';
import { format, differenceInDays, startOfDay } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useLicenses } from '@/hooks/useLicenses';
import {
    useMedicalCertificate,
    useUnitEndorsements,
    useLicenseValidity,
    useExpiryAlerts,
    getRatingLabel,
    type LicenseWithExtras,
} from '@/hooks/useLicenseDashboard';

function getStatusBadge(expiryDate: string | null) {
    if (!expiryDate) return <Badge variant="secondary" className="text-[10px]">No expiry</Badge>;
    const days = differenceInDays(new Date(expiryDate), startOfDay(new Date()));
    if (days < 0) return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Expired</Badge>;
    if (days <= 30) return <Badge className="bg-red-100 text-red-600 border-red-200 text-[10px]">Expires in {days}d</Badge>;
    if (days <= 90) return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Expires in {days}d</Badge>;
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Valid</Badge>;
}

function getSeverityColor(severity: string) {
    switch (severity) {
        case 'expired': return 'bg-red-50 border-red-200 text-red-700';
        case 'critical': return 'bg-red-50 border-red-200 text-red-600';
        case 'warning': return 'bg-amber-50 border-amber-200 text-amber-700';
        default: return 'bg-gray-50 border-gray-200 text-gray-600';
    }
}

function getSeverityIcon(severity: string) {
    switch (severity) {
        case 'expired': return <XCircle className="h-4 w-4 text-red-500" />;
        case 'critical': return <AlertTriangle className="h-4 w-4 text-red-500" />;
        case 'warning': return <Clock className="h-4 w-4 text-amber-500" />;
        default: return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }
}

export default function EmployeeLicenses() {
    const { user } = useAuth();
    const { licenses = [], isLoading } = useLicenses(user?.id);
    const { data: medical, isLoading: medLoading } = useMedicalCertificate(user?.id);
    const { data: endorsements = [], isLoading: endLoading } = useUnitEndorsements(user?.id);

    const typedLicenses = (licenses || []) as unknown as LicenseWithExtras[];
    const validity = useLicenseValidity(typedLicenses, medical, endorsements);
    const alerts = useExpiryAlerts(typedLicenses, medical, endorsements);

    const loading = isLoading || medLoading || endLoading;

    if (loading) {
        return (
            <DashboardLayout role="employee">
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
                </div>
            </DashboardLayout>
        );
    }

    // License overview
    const licenseNumber = typedLicenses[0]?.license_number || '—';
    const issuedBy = typedLicenses[0]?.issued_by || 'AAI';

    return (
        <DashboardLayout role="employee">
            <div className="space-y-5">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Shield className="h-6 w-6 text-indigo-600" />
                        License Status
                    </h1>
                    <p className="text-muted-foreground text-sm">ATC license, ratings, medical & unit endorsements</p>
                </div>

                {/* Top Row: Overall Status + License Info + Medical */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Overall Status */}
                    <Card className={`border-0 shadow-lg ${validity.valid
                        ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white'
                        : 'bg-gradient-to-br from-red-500 to-rose-600 text-white'
                        }`}>
                        <CardContent className="pt-5 pb-5">
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    {validity.valid
                                        ? <CheckCircle2 className="h-5 w-5 opacity-80" />
                                        : <XCircle className="h-5 w-5 opacity-80" />
                                    }
                                    <span className="text-xs font-medium uppercase tracking-wide opacity-80">Overall Status</span>
                                </div>
                                <p className="text-2xl font-bold">{validity.valid ? 'VALID' : 'INVALID'}</p>
                                {!validity.valid && (
                                    <div className="space-y-1 mt-2">
                                        {validity.reasons.map((r, i) => (
                                            <p key={i} className="text-xs opacity-90">• {r}</p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* License Info */}
                    <Card>
                        <CardContent className="pt-5 pb-5">
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Award className="h-4 w-4 text-indigo-500" />
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ATC License</span>
                                </div>
                                <div>
                                    <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{licenseNumber}</p>
                                    <p className="text-xs text-muted-foreground">Issued by {issuedBy}</p>
                                </div>
                                <p className="text-xs text-muted-foreground">{typedLicenses.length} active ratings</p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Medical Certificate */}
                    <Card>
                        <CardContent className="pt-5 pb-5">
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Heart className="h-4 w-4 text-rose-500" />
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Medical</span>
                                </div>
                                {medical ? (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{medical.medical_class}</p>
                                            {getStatusBadge(medical.expiry_date)}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {medical.expiry_date
                                                ? `Valid until ${format(new Date(medical.expiry_date), 'd MMM yyyy')}`
                                                : 'No expiry set'}
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-sm text-muted-foreground">No medical certificate on record</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Expiry Alerts */}
                {alerts.length > 0 && (
                    <Card className="border-amber-200 bg-amber-50/50">
                        <CardHeader className="py-2.5 px-4">
                            <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-amber-700">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Expiry Alerts ({alerts.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-3">
                            <div className="space-y-1.5">
                                {alerts.map((alert, i) => (
                                    <div key={i} className={`flex items-center justify-between p-2 rounded-md border text-xs ${getSeverityColor(alert.severity)}`}>
                                        <div className="flex items-center gap-2">
                                            {getSeverityIcon(alert.severity)}
                                            <span className="font-medium">{alert.label}</span>
                                        </div>
                                        <span>
                                            {alert.daysUntil < 0
                                                ? `Expired ${Math.abs(alert.daysUntil)}d ago`
                                                : `${alert.daysUntil}d remaining`}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Ratings Grid + Endorsements */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Ratings */}
                    <Card>
                        <CardHeader className="py-2.5 px-4 bg-indigo-50/50">
                            <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                                <Shield className="h-3.5 w-3.5 text-indigo-500" />
                                ATC Ratings ({typedLicenses.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 py-2">
                            <div className="divide-y">
                                {typedLicenses.length > 0 ? typedLicenses.map((lic) => (
                                    <div key={lic.id} className="py-2.5 flex justify-between items-center">
                                        <div>
                                            <p className="text-sm font-medium">{getRatingLabel(lic.license_type)}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {lic.issue_date ? `Issued ${format(new Date(lic.issue_date), 'd MMM yyyy')}` : 'No issue date'}
                                                {lic.expiry_date ? ` • Expires ${format(new Date(lic.expiry_date), 'd MMM yyyy')}` : ''}
                                            </p>
                                        </div>
                                        {getStatusBadge(lic.expiry_date)}
                                    </div>
                                )) : (
                                    <p className="py-4 text-center text-xs text-muted-foreground">No ratings on record</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Unit Endorsements */}
                    <Card>
                        <CardHeader className="py-2.5 px-4 bg-blue-50/50">
                            <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                                <MapPin className="h-3.5 w-3.5 text-blue-500" />
                                Unit Endorsements ({endorsements.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 py-2">
                            <div className="divide-y">
                                {endorsements.length > 0 ? endorsements.map((end) => (
                                    <div key={end.id} className="py-2.5 flex justify-between items-center">
                                        <div>
                                            <p className="text-sm font-medium">{end.airport} — {end.position}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {end.issue_date ? `Issued ${format(new Date(end.issue_date), 'd MMM yyyy')}` : 'No issue date'}
                                                {end.expiry_date ? ` • Expires ${format(new Date(end.expiry_date), 'd MMM yyyy')}` : ''}
                                            </p>
                                        </div>
                                        {getStatusBadge(end.expiry_date)}
                                    </div>
                                )) : (
                                    <p className="py-4 text-center text-xs text-muted-foreground">No endorsements on record</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}
