import { type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Award,
  Briefcase,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  Clock3,
  FileText,
  Globe,
  GraduationCap,
  Heart,
  Lock,
  Mail,
  MapPin,
  Phone,
  Radio,
  Shield,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile, useUsers } from "@/hooks/useUsers";
import { buildEmployeeLicenseHealth, getHealthStatusLabel, type LicenseWithExtras } from "@/hooks/useLicenseDashboard";
import { cn } from "@/lib/utils";
import ProfilePictureUpload from "@/components/ProfilePictureUpload";
import type { ProfilePictureUploadHandle } from "@/components/ProfilePictureUpload";

const ICAO_LEVELS = [
  { value: "1", label: "Level 1 - Pre-Elementary" },
  { value: "2", label: "Level 2 - Elementary" },
  { value: "3", label: "Level 3 - Pre-Operational" },
  { value: "4", label: "Level 4 - Operational" },
  { value: "5", label: "Level 5 - Extended" },
  { value: "6", label: "Level 6 - Expert" },
];

const MEDICAL_CLASSES = [
  { value: "Class 1", label: "Class 1" },
  { value: "Class 2", label: "Class 2" },
  { value: "Class 3", label: "Class 3" },
];

const SECURITY_STATUSES = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

interface ProfileDetails {
  atc_license_number: string;
  atc_license_type: string;
  atc_license_expiry: string;
  issuing_authority: string;
  medical_cert_class: string;
  medical_cert_validity: string;
  unit_endorsements: string;
  equipment_qualifications: string;
  initial_training_institute: string;
  initial_training_year: string;
  last_recurrent_training_date: string;
  security_clearance_status: string;
  icao_english_proficiency_level: string;
}

const DEFAULT_DETAILS: ProfileDetails = {
  atc_license_number: "",
  atc_license_type: "",
  atc_license_expiry: "",
  issuing_authority: "",
  medical_cert_class: "",
  medical_cert_validity: "",
  unit_endorsements: "",
  equipment_qualifications: "",
  initial_training_institute: "",
  initial_training_year: "",
  last_recurrent_training_date: "",
  security_clearance_status: "",
  icao_english_proficiency_level: "",
};

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const formatProfileDate = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
};

const formatCourseLabel = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());

const getProfileHealthBadgeClass = (status: "valid" | "warning" | "expired" | "info") => {
  if (status === "expired") return "border-red-200 bg-red-50 text-red-700";
  if (status === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "valid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
};

const getSecurityTone = (status: string) => {
  const normalized = status.trim().toLowerCase();
  if (normalized === "active") {
    return {
      badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      panelClass: "border-emerald-200/80 bg-emerald-50/80",
      icon: CheckCircle2,
      label: "Clearance active",
    };
  }
  if (normalized === "pending") {
    return {
      badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
      panelClass: "border-amber-200/80 bg-amber-50/80",
      icon: Clock3,
      label: "Awaiting clearance update",
    };
  }
  return {
    badgeClass: "border-red-200 bg-red-50 text-red-700",
    panelClass: "border-red-200/80 bg-red-50/80",
    icon: AlertTriangle,
    label: normalized ? "Needs attention" : "Not configured",
  };
};

const getDaysUntil = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.ceil((parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
};

const pickProfileDetails = (rawDetails: unknown): ProfileDetails => {
  const source = (rawDetails && typeof rawDetails === "object" ? rawDetails : {}) as Record<string, unknown>;

  return {
    atc_license_number: typeof source.atc_license_number === "string" ? source.atc_license_number : "",
    atc_license_type: typeof source.atc_license_type === "string" ? source.atc_license_type : "",
    atc_license_expiry: typeof source.atc_license_expiry === "string" ? source.atc_license_expiry : "",
    issuing_authority: typeof source.issuing_authority === "string" ? source.issuing_authority : "",
    medical_cert_class: typeof source.medical_cert_class === "string" ? source.medical_cert_class : "",
    medical_cert_validity: typeof source.medical_cert_validity === "string" ? source.medical_cert_validity : "",
    unit_endorsements: typeof source.unit_endorsements === "string" ? source.unit_endorsements : "",
    equipment_qualifications: typeof source.equipment_qualifications === "string" ? source.equipment_qualifications : "",
    initial_training_institute: typeof source.initial_training_institute === "string" ? source.initial_training_institute : "",
    initial_training_year: typeof source.initial_training_year === "string" ? source.initial_training_year : "",
    last_recurrent_training_date: typeof source.last_recurrent_training_date === "string" ? source.last_recurrent_training_date : "",
    security_clearance_status: typeof source.security_clearance_status === "string" ? source.security_clearance_status : "",
    icao_english_proficiency_level: typeof source.icao_english_proficiency_level === "string" ? source.icao_english_proficiency_level : "",
  };
};

const PROFILE_TABS: Array<{ value: string; icon: ComponentType<{ className?: string }>; label: string }> = [
  { value: "personal", icon: User, label: "Personal" },
  { value: "employment", icon: Briefcase, label: "Employment" },
  { value: "license", icon: Award, label: "License" },
  { value: "medical", icon: Heart, label: "Medical" },
  { value: "operational", icon: Radio, label: "Operational" },
  { value: "training", icon: GraduationCap, label: "Training" },
  { value: "language", icon: Globe, label: "Language" },
];

const LABEL_CLASS = "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300";
const HELPER_TEXT_CLASS = "text-sm text-slate-700 dark:text-slate-300";
const SUBTLE_TEXT_CLASS = "text-xs text-slate-600 dark:text-slate-300";

const SectionCard = ({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: string;
  badge?: string;
  children: ReactNode;
}) => (
  <div className="rounded-[22px] border border-slate-200/80 bg-white p-3 shadow-sm shadow-slate-200/40 sm:rounded-3xl sm:p-5 dark:border-slate-800 dark:bg-slate-950 dark:shadow-none">
    <div className="mb-3 space-y-1.5 sm:mb-4 sm:space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-slate-950 dark:text-slate-50 sm:text-sm">{title}</h3>
        {badge ? (
          <Badge className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300 sm:px-2.5 sm:py-1 sm:text-[11px]">
            {badge}
          </Badge>
        ) : null}
      </div>
      {description ? <p className="text-xs text-slate-700 dark:text-slate-300 sm:text-sm">{description}</p> : null}
    </div>
    {children}
  </div>
);

const ReadOnlyField = ({
  icon: Icon,
  label,
  value,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
}) => (
  <div className="space-y-2">
    <Label className={`${LABEL_CLASS} text-[10px] sm:text-[11px]`}>
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {label}
    </Label>
    <div className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 sm:min-h-11 sm:rounded-2xl sm:px-3.5 sm:py-2.5 sm:text-sm">
      {value ? value : <span className="italic text-slate-500 dark:text-slate-400">Not set</span>}
    </div>
  </div>
);

const EditableField = ({
  icon: Icon,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled = false,
  isEditing,
  onActivateEdit,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  isEditing: boolean;
  onActivateEdit: () => void;
}) => (
  <div className="space-y-2">
    <Label className={`${LABEL_CLASS} text-[10px] sm:text-[11px]`}>
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {label}
    </Label>
    <Input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => {
        if (!disabled && !isEditing) {
          onActivateEdit();
        }
      }}
      placeholder={placeholder}
      className={cn(
        "h-10 rounded-xl border-slate-300 bg-white text-[13px] text-slate-950 shadow-none placeholder:text-slate-500 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 dark:placeholder:text-slate-400 sm:h-11 sm:rounded-2xl sm:text-sm",
        !isEditing && !disabled && "bg-slate-50 dark:bg-slate-900",
        disabled && "cursor-not-allowed opacity-70"
      )}
      disabled={disabled}
    />
  </div>
);

export default function EmployeeProfile() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { profile, isLoading } = useUserProfile(user?.id);
  const { updateProfile, isUpdating } = useUsers();
  const [isEditing, setIsEditing] = useState(false);
  const photoUploadRef = useRef<ProfilePictureUploadHandle>(null);

  const [profileData, setProfileData] = useState({
    fullName: "",
    employeeId: "",
    email: "",
    mobile: "",
    designation: "",
    emergencyContact: "",
    currentShift: "",
    gender: "",
    dateOfBirth: "",
    department: "",
    station: "",
    dateOfJoining: "",
    stream: "",
  });

  const [details, setDetails] = useState<ProfileDetails>(DEFAULT_DETAILS);

  useEffect(() => {
    if (!profile) return;

    setProfileData({
      fullName: profile.full_name || "",
      employeeId: profile.employee_id || "",
      email: profile.email || "",
      mobile: profile.mobile || "",
      designation: profile.designation || "",
      emergencyContact: profile.emergency_contact || "",
      currentShift: profile.current_shift || "",
      gender: profile.gender || "",
      dateOfBirth: profile.date_of_birth || "",
      department: profile.department || "",
      station: profile.station || "",
      dateOfJoining: profile.date_of_joining || "",
      stream: profile.stream || "",
    });
    setDetails(pickProfileDetails(profile.profile_details));
  }, [profile]);

  const updateDetail = (key: keyof ProfileDetails, value: string) => {
    setDetails((previous) => ({ ...previous, [key]: value }));
  };

  const handleCancel = () => {
    if (profile) {
      setProfileData({
        fullName: profile.full_name || "",
        employeeId: profile.employee_id || "",
        email: profile.email || "",
        mobile: profile.mobile || "",
        designation: profile.designation || "",
        emergencyContact: profile.emergency_contact || "",
        currentShift: profile.current_shift || "",
        gender: profile.gender || "",
        dateOfBirth: profile.date_of_birth || "",
        department: profile.department || "",
        station: profile.station || "",
        dateOfJoining: profile.date_of_joining || "",
        stream: profile.stream || "",
      });
      setDetails(pickProfileDetails(profile.profile_details));
    }
    setIsEditing(false);
  };

  const handleSave = () => {
    if (!user?.id) return;

    updateProfile({
      userId: user.id,
      updates: {
        full_name: profileData.fullName,
        email: profileData.email,
        mobile: profileData.mobile || null,
        emergency_contact: profileData.emergencyContact || null,
        gender: profileData.gender || null,
        date_of_birth: profileData.dateOfBirth || null,
        department: profileData.department || null,
        station: profileData.station || null,
        date_of_joining: profileData.dateOfJoining || null,
        profile_details: {
          ...((profile?.profile_details as Record<string, unknown> | null) || {}),
          ...details,
        },
      },
    });

    setIsEditing(false);
  };

  const completionDates = useMemo(
    () =>
      Object.entries((profile?.linked_training_record?.completion_dates as Record<string, string> | undefined) || {})
        .filter(([, value]) => Boolean(value))
        .sort(([first], [second]) => first.localeCompare(second)),
    [profile?.linked_training_record?.completion_dates]
  );

  const trainingRecord = profile?.linked_training_record as Record<string, unknown> | null | undefined;
  const licenseHealth = useMemo(
    () => buildEmployeeLicenseHealth(profile, ((profile?.licenses || []) as LicenseWithExtras[])),
    [profile]
  );
  const activeRatings = licenseHealth.ratings.filter((rating) => rating.isActive);
  const currentLicenseNumber = String(trainingRecord?.license_number || details.atc_license_number || "").trim();
  const currentElpaLevel = String(trainingRecord?.elpa_level || details.icao_english_proficiency_level || "").trim();
  const highestRating = String(profile?.highest_rating || trainingRecord?.highest_rating || "").trim();

  const profileCompletion = useMemo(() => {
    const fields = [
      profileData.fullName,
      profileData.email,
      profileData.mobile,
      profileData.emergencyContact,
      profileData.station,
      profileData.department,
      profileData.dateOfBirth,
      profileData.dateOfJoining,
      details.atc_license_number,
      details.medical_cert_validity,
      details.security_clearance_status,
      details.icao_english_proficiency_level,
    ];
    const filled = fields.filter((value) => Boolean(String(value || "").trim())).length;
    return Math.round((filled / fields.length) * 100);
  }, [details, profileData]);

  const medicalDaysUntil = getDaysUntil(details.medical_cert_validity || String(trainingRecord?.med_endorsed_upto || ""));
  const licenseDaysUntil = getDaysUntil(details.atc_license_expiry);
  const elpaDaysUntil = getDaysUntil(String(trainingRecord?.elpa_valid_upto || ""));
  const nearestRenewal = [
    { label: "Medical", days: medicalDaysUntil, date: details.medical_cert_validity || String(trainingRecord?.med_endorsed_upto || "") },
    { label: "ATC license", days: licenseDaysUntil, date: details.atc_license_expiry },
    { label: "ELPA", days: elpaDaysUntil, date: String(trainingRecord?.elpa_valid_upto || "") },
  ]
    .filter((item) => item.days !== null)
    .sort((first, second) => Number(first.days) - Number(second.days))[0];

  const securityTone = getSecurityTone(details.security_clearance_status || "");
  const SecurityToneIcon = securityTone.icon;

  const summaryCards = [
    {
      label: "Profile completion",
      value: `${profileCompletion}%`,
      detail: profileCompletion >= 80 ? "Strong profile readiness" : "Complete the remaining essentials",
      accent: "from-sky-500/15 via-cyan-500/10 to-transparent",
    },
    {
      label: "Active ratings",
      value: String(activeRatings.length),
      detail: activeRatings.length > 0 ? "Live operational qualifications" : "No active ratings linked",
      accent: "from-emerald-500/15 via-green-500/10 to-transparent",
    },
    {
      label: "License records",
      value: String(licenseHealth.licenses.length),
      detail: currentLicenseNumber ? `License ${currentLicenseNumber}` : "No current license number",
      accent: "from-amber-500/15 via-orange-500/10 to-transparent",
    },
    {
      label: "Next renewal",
      value: nearestRenewal ? nearestRenewal.label : "None",
      detail: nearestRenewal ? `${formatProfileDate(nearestRenewal.date)}${nearestRenewal.days !== null ? ` · ${nearestRenewal.days} days` : ""}` : "No tracked renewal date",
      accent: "from-violet-500/15 via-fuchsia-500/10 to-transparent",
    },
  ];

  const complianceItems = [
    {
      title: "Medical certificate",
      value: details.medical_cert_validity ? formatProfileDate(details.medical_cert_validity) : "No validity date",
      helper:
        medicalDaysUntil === null
          ? "Needs update"
          : medicalDaysUntil < 0
            ? "Expired"
            : medicalDaysUntil <= 30
              ? `Renews in ${medicalDaysUntil} days`
              : `${medicalDaysUntil} days remaining`,
      badgeClass:
        medicalDaysUntil === null
          ? "border-slate-200 bg-slate-50 text-slate-700"
          : medicalDaysUntil < 0
            ? "border-red-200 bg-red-50 text-red-700"
            : medicalDaysUntil <= 30
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    {
      title: "ELPA",
      value: currentElpaLevel ? `Level ${currentElpaLevel}` : "Not configured",
      helper: trainingRecord?.elpa_valid_upto ? `Valid until ${formatProfileDate(String(trainingRecord.elpa_valid_upto))}` : "No ELPA validity date",
      badgeClass:
        currentElpaLevel && Number(currentElpaLevel) >= 4
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700",
    },
  ];

  if (isLoading) {
    return (
      <DashboardLayout role="employee">
        <div className="mx-auto max-w-[1480px] space-y-5">
          <Skeleton className="h-56 w-full rounded-[28px]" />
          <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
            <Skeleton className="h-[520px] w-full rounded-[28px]" />
            <Skeleton className="h-[720px] w-full rounded-[28px]" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="employee">
      <div className="mx-auto max-w-[1480px] space-y-4 text-slate-900 dark:text-slate-100 sm:space-y-5">
        <Card className="overflow-hidden rounded-[24px] border-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.16),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.18),_transparent_30%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(241,245,249,0.94))] shadow-[0_22px_60px_-24px_rgba(15,23,42,0.28)] sm:rounded-[30px] dark:bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.14),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.14),_transparent_30%),linear-gradient(135deg,_rgba(2,6,23,0.98),_rgba(15,23,42,0.96))]">
          <CardContent className="p-3 sm:p-6 lg:p-7">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-5">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/75 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm backdrop-blur sm:gap-2 sm:px-3 sm:text-[11px] sm:tracking-[0.22em] dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300">
                  <Sparkles className="h-3 w-3 text-emerald-500 sm:h-3.5 sm:w-3.5" />
                  Employee Profile Workspace
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:items-center sm:gap-4">
                  <ProfilePictureUpload
                    ref={photoUploadRef}
                    employeeId={user?.id || ""}
                    currentUrl={profile?.photo_url || undefined}
                    onUpload={(url) => {
                      if (!user?.id) return;
                      updateProfile({
                        userId: user.id,
                        updates: { photo_url: url },
                      });
                    }}
                  />

                  <div className="space-y-2 sm:space-y-3">
                    <div>
                      <h1 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                        {profileData.fullName || "My Profile"}
                      </h1>
                      <p className="mt-1 max-w-2xl text-xs text-slate-600 dark:text-slate-300 sm:text-base">
                        Personal identity, operational credentials, training history, and compliance data in one place.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      <Badge className="rounded-full border-slate-200 bg-white/85 px-2.5 py-0.5 text-[11px] text-slate-700 sm:px-3 sm:py-1 sm:text-xs dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100">
                        ID {profileData.employeeId || "-"}
                      </Badge>
                      <Badge className="rounded-full border-slate-200 bg-white/85 px-2.5 py-0.5 text-[11px] text-slate-700 sm:px-3 sm:py-1 sm:text-xs dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100">
                        {profileData.designation || "Designation pending"}
                      </Badge>
                      <Badge className="rounded-full border-slate-200 bg-white/85 px-2.5 py-0.5 text-[11px] text-slate-700 sm:px-3 sm:py-1 sm:text-xs dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100">
                        Shift {profileData.currentShift ? profileData.currentShift.toUpperCase() : "-"}
                      </Badge>
                      <Badge className="rounded-full border-slate-200 bg-white/85 px-2.5 py-0.5 text-[11px] text-slate-700 sm:px-3 sm:py-1 sm:text-xs dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100">
                        {highestRating || "Highest rating pending"}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:gap-3 xl:flex-col xl:items-end">
                {!isEditing ? (
                  <Button
                    onClick={() => setIsEditing(true)}
                    className="h-10 rounded-xl bg-slate-950 px-4 text-xs font-medium text-white hover:bg-slate-800 sm:h-11 sm:rounded-2xl sm:px-5 sm:text-sm dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    Edit Profile
                  </Button>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 xl:w-full xl:justify-end">
                    <Button variant="outline" onClick={handleCancel} className="h-10 rounded-xl border-slate-300 px-4 text-xs sm:h-11 sm:rounded-2xl sm:px-5 sm:text-sm dark:border-slate-700">
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={isUpdating}
                      className="h-10 rounded-xl bg-emerald-600 px-4 text-xs text-white hover:bg-emerald-700 sm:h-11 sm:rounded-2xl sm:px-5 sm:text-sm"
                    >
                      {isUpdating ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((card) => (
                <div
                  key={card.label}
                  className={cn(
                    "rounded-[24px] border border-white/70 bg-white/82 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/72",
                    "bg-[linear-gradient(135deg,rgba(255,255,255,0.86),rgba(255,255,255,0.7)),var(--tw-gradient-stops)]",
                    card.accent
                  )}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{card.label}</p>
                  <p className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">{card.value}</p>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{card.detail}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,760px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,840px)_minmax(0,1fr)]">
          <div className="grid gap-5 xl:grid-cols-2 xl:self-start">
            <Card className="rounded-[22px] border-slate-200/80 bg-white shadow-[0_18px_45px_-28px_rgba(15,23,42,0.28)] sm:rounded-[28px] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm sm:text-base">Profile Snapshot</CardTitle>
                <CardDescription className="text-sm text-slate-700 dark:text-slate-300">Core identity and contact data used across employee workflows.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4">
                <Button
                  variant="outline"
                  className="h-9 w-full justify-center rounded-xl border-dashed text-xs sm:h-10 sm:rounded-2xl sm:text-sm"
                  onClick={() => photoUploadRef.current?.openFilePicker()}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Update Photo
                </Button>

                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-900 sm:gap-3 sm:rounded-2xl sm:py-3">
                    <Mail className="h-4 w-4 text-slate-500" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">Email</p>
                      <p className="truncate text-[13px] font-medium sm:text-sm">{profileData.email || "Not set"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-900 sm:gap-3 sm:rounded-2xl sm:py-3">
                    <Phone className="h-4 w-4 text-slate-500" />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">Mobile</p>
                      <p className="text-[13px] font-medium sm:text-sm">{profileData.mobile || "Not set"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-900 sm:gap-3 sm:rounded-2xl sm:py-3">
                    <MapPin className="h-4 w-4 text-slate-500" />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">Station</p>
                      <p className="text-[13px] font-medium sm:text-sm">{profileData.station || "Not set"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-900 sm:gap-3 sm:rounded-2xl sm:py-3">
                    <Building2 className="h-4 w-4 text-slate-500" />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">Department</p>
                      <p className="text-[13px] font-medium sm:text-sm">{profileData.department || "Not set"}</p>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200/80 p-3 dark:border-slate-800">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">Joined</p>
                    <p className="mt-1 text-sm font-semibold">{formatProfileDate(profileData.dateOfJoining)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200/80 p-3 dark:border-slate-800">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">Stream</p>
                    <p className="mt-1 text-sm font-semibold">{profileData.stream || "Not set"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[22px] border-slate-200/80 bg-white shadow-[0_18px_45px_-28px_rgba(15,23,42,0.28)] sm:rounded-[28px] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm sm:text-base">Compliance Watch</CardTitle>
                <CardDescription className="text-sm text-slate-700 dark:text-slate-300">A quick read of the fields that drive approvals and audits.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 sm:space-y-3">
                {complianceItems.map((item) => (
                  <div key={item.title} className="rounded-xl border border-slate-200/80 p-2.5 dark:border-slate-800 sm:rounded-2xl sm:p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100 sm:text-sm">{item.title}</p>
                        <p className="mt-1 text-[13px] font-medium text-slate-800 dark:text-slate-200 sm:text-sm">{item.value}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{item.helper}</p>
                      </div>
                      <Badge className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium sm:px-2.5 sm:py-1 sm:text-[11px]", item.badgeClass)}>
                        Live
                      </Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-[22px] border-slate-200/80 bg-white shadow-[0_18px_45px_-28px_rgba(15,23,42,0.28)] sm:rounded-[28px] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none xl:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm sm:text-base">Account Tools</CardTitle>
                <CardDescription className="text-sm text-slate-700 dark:text-slate-300">Supporting actions for identity and data ownership.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 sm:space-y-3">
                <Button
                  variant="outline"
                  className="h-10 w-full justify-start rounded-xl text-xs sm:h-11 sm:rounded-2xl sm:text-sm"
                  onClick={() =>
                    toast({
                      title: "Password change",
                      description: "Route the user to the shared password flow when that screen is added for employees.",
                    })
                  }
                >
                  <Lock className="mr-2 h-4 w-4" />
                  Change Password
                </Button>
                <Button
                  variant="outline"
                  className="h-10 w-full justify-start rounded-xl text-xs sm:h-11 sm:rounded-2xl sm:text-sm"
                  onClick={() =>
                    toast({
                      title: "Data export",
                      description: "Personal data export can be wired to a backend report or downloadable PDF later.",
                    })
                  }
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Export My Data
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-[22px] border-slate-200/80 bg-white shadow-[0_18px_45px_-28px_rgba(15,23,42,0.28)] sm:rounded-[28px] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none">
            <CardHeader className="pb-4">
              <CardTitle className="text-base sm:text-lg">Profile Details</CardTitle>
              <CardDescription className="text-xs text-slate-700 dark:text-slate-300 sm:text-sm">Structured the way a modern HR and compliance product would present employee records.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="personal" className="space-y-5">
                <TabsList className="flex h-auto flex-wrap justify-start gap-1.5 rounded-[18px] bg-slate-100/80 p-1.5 sm:gap-2 sm:rounded-[24px] sm:p-2 dark:bg-slate-900">
                  {PROFILE_TABS.map(({ value, icon: Icon, label }) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="rounded-xl border border-transparent px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 data-[state=active]:border-slate-200 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm sm:rounded-2xl sm:px-3.5 sm:py-2 sm:text-xs dark:text-slate-200 dark:data-[state=active]:border-slate-800 dark:data-[state=active]:bg-slate-950 dark:data-[state=active]:text-white"
                    >
                      <Icon className="mr-1 h-3 w-3 sm:mr-1.5 sm:h-3.5 sm:w-3.5" />
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="personal" className="space-y-4">
                  <SectionCard title="Identity" description="Personal information that defines the employee record." badge="Editable in edit mode">
                    <div className="grid gap-4 md:grid-cols-2">
                      <EditableField icon={User} label="Full Name" value={profileData.fullName} onChange={(value) => setProfileData({ ...profileData, fullName: value })} isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <EditableField icon={Calendar} label="Date of Birth" type="date" value={profileData.dateOfBirth} onChange={(value) => setProfileData({ ...profileData, dateOfBirth: value })} isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <div className="space-y-2">
                        <Label className={LABEL_CLASS}>
                          <User className="h-3.5 w-3.5" />
                          Gender
                        </Label>
                        <Select
                          value={profileData.gender}
                          onValueChange={(value) => setProfileData({ ...profileData, gender: value })}
                          onOpenChange={(open) => {
                            if (open && !isEditing) setIsEditing(true);
                          }}
                        >
                          <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Male">Male</SelectItem>
                            <SelectItem value="Female">Female</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <ReadOnlyField icon={Briefcase} label="Employee ID" value={profileData.employeeId} />
                    </div>
                  </SectionCard>

                  <SectionCard title="Contact Channels" description="Make sure people can reach you during roster changes, emergencies, or audits." badge="Editable in edit mode">
                    <div className="grid gap-4 md:grid-cols-2">
                      <EditableField icon={Mail} label="Email" type="email" value={profileData.email} onChange={(value) => setProfileData({ ...profileData, email: value })} isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <EditableField icon={Phone} label="Mobile" value={profileData.mobile} onChange={(value) => setProfileData({ ...profileData, mobile: value })} isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <EditableField icon={Phone} label="Emergency Contact" value={profileData.emergencyContact} onChange={(value) => setProfileData({ ...profileData, emergencyContact: value })} isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <EditableField icon={MapPin} label="Station" value={profileData.station} onChange={(value) => setProfileData({ ...profileData, station: value })} isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                    </div>
                  </SectionCard>
                </TabsContent>

                <TabsContent value="employment" className="space-y-4">
                  <SectionCard title="Role and Assignment" description="Employment-facing attributes sourced by staffing and roster tools." badge="Department and joining editable">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <ReadOnlyField icon={Briefcase} label="Designation" value={profileData.designation} />
                      <EditableField icon={Building2} label="Department" value={profileData.department} onChange={(value) => setProfileData({ ...profileData, department: value })} placeholder="e.g. ATC Operations" isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <ReadOnlyField icon={Award} label="Highest Rating" value={highestRating} />
                      <EditableField icon={Calendar} label="Date of Joining" type="date" value={profileData.dateOfJoining} onChange={(value) => setProfileData({ ...profileData, dateOfJoining: value })} isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <ReadOnlyField icon={Calendar} label="Current Shift" value={profileData.currentShift ? `Shift ${profileData.currentShift.toUpperCase()}` : "-"} />
                      <ReadOnlyField icon={Building2} label="Stream" value={profileData.stream} />
                    </div>
                  </SectionCard>
                </TabsContent>

                <TabsContent value="license" className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <SectionCard title="Current License" description="Headline license identity visible to operations leadership.">
                      <div className="space-y-3">
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-900">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">License number</p>
                          <p className="mt-1 text-base font-semibold">{currentLicenseNumber || "-"}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-900">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">Highest rating</p>
                          <p className="mt-1 text-base font-semibold">{highestRating || "-"}</p>
                        </div>
                      </div>
                    </SectionCard>

                    <SectionCard title="Ratings Health" description="Backend-linked active operational ratings.">
                      <div className="space-y-2">
                        {activeRatings.length > 0 ? (
                          activeRatings.slice(0, 3).map((rating) => (
                            <div key={rating.id} className="flex items-center justify-between rounded-2xl border border-slate-200/80 px-3 py-3 dark:border-slate-800">
                              <div>
                                <p className="text-sm font-medium">{rating.label}</p>
                                <p className={SUBTLE_TEXT_CLASS}>{rating.issueDate ? `Issued ${formatProfileDate(rating.issueDate)}` : "No issue date"}</p>
                              </div>
                              <Badge className={cn("rounded-full border text-[11px]", getProfileHealthBadgeClass(rating.status))}>{getHealthStatusLabel(rating)}</Badge>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-slate-500 dark:text-slate-400">No active operational ratings found.</p>
                        )}
                      </div>
                    </SectionCard>

                    <SectionCard title="Renewal Outlook" description="A quick view of the nearest credential pressure point.">
                      <div className="space-y-3">
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-900">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">Next renewal</p>
                          <p className="mt-1 text-base font-semibold">{nearestRenewal ? nearestRenewal.label : "No renewal date"}</p>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{nearestRenewal ? `${formatProfileDate(nearestRenewal.date)}${nearestRenewal.days !== null ? ` · ${nearestRenewal.days} days` : ""}` : "Add license, medical, or ELPA validity data to track this automatically."}</p>
                        </div>
                      </div>
                    </SectionCard>
                  </div>

                  <SectionCard title="Editable License Details" description="Reference fields you can maintain directly from the employee profile." badge="Editable in edit mode">
                    <div className="grid gap-4 md:grid-cols-2">
                      <EditableField label="ATC License Number" value={details.atc_license_number} onChange={(value) => updateDetail("atc_license_number", value)} placeholder="e.g. ATC-12345" isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <EditableField label="License Type" value={details.atc_license_type} onChange={(value) => updateDetail("atc_license_type", value)} placeholder="e.g. ATCO, AFISO" isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <EditableField label="License Expiry Date" type="date" value={details.atc_license_expiry} onChange={(value) => updateDetail("atc_license_expiry", value)} isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <div className="space-y-2">
                        <Label className={LABEL_CLASS}>Issuing Authority</Label>
                        <Select
                          value={details.issuing_authority}
                          onValueChange={(value) => updateDetail("issuing_authority", value)}
                          onOpenChange={(open) => {
                            if (open && !isEditing) setIsEditing(true);
                          }}
                        >
                          <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                            <SelectValue placeholder="Select authority" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DGCA">DGCA</SelectItem>
                            <SelectItem value="FAA">FAA</SelectItem>
                            <SelectItem value="EASA">EASA</SelectItem>
                            <SelectItem value="ICAO">ICAO</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard title="License Register" description="All linked license rows coming from the backend register.">
                    <div className="space-y-3">
                      {licenseHealth.licenses.length > 0 ? (
                        licenseHealth.licenses.map((license) => (
                          <div key={license.id} className="rounded-3xl border border-slate-200/80 p-4 dark:border-slate-800">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <Shield className="h-4 w-4 text-slate-500" />
                                  <h4 className="text-sm font-semibold">{license.label}</h4>
                                  {license.meta ? <Badge variant="secondary" className="rounded-full text-[11px]">{license.meta}</Badge> : null}
                                </div>
                                <div className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                                  <p>{license.issueDate ? `Issued ${formatProfileDate(license.issueDate)}` : "No issue date"}</p>
                                  <p>{license.expiryDate ? `Expires ${formatProfileDate(license.expiryDate)}` : "No expiry date recorded"}</p>
                                </div>
                              </div>
                              <Badge className={cn("rounded-full border text-[11px]", getProfileHealthBadgeClass(license.status))}>{getHealthStatusLabel(license)}</Badge>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400">No license records found.</p>
                      )}
                    </div>
                  </SectionCard>
                </TabsContent>

                <TabsContent value="medical" className="space-y-4">
                  <SectionCard title="Medical Fitness" description="Certificate class and validity used for operational readiness checks.">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          <Heart className="h-3.5 w-3.5" />
                          Medical Certificate Class
                        </Label>
                        <Select
                          value={details.medical_cert_class}
                          onValueChange={(value) => updateDetail("medical_cert_class", value)}
                          onOpenChange={(open) => {
                            if (open && !isEditing) setIsEditing(true);
                          }}
                        >
                          <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                            <SelectValue placeholder="Select class" />
                          </SelectTrigger>
                          <SelectContent>
                            {MEDICAL_CLASSES.map((medicalClass) => (
                              <SelectItem key={medicalClass.value} value={medicalClass.value}>
                                {medicalClass.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <EditableField icon={Calendar} label="Certificate Validity" type="date" value={details.medical_cert_validity} onChange={(value) => updateDetail("medical_cert_validity", value)} isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900">
                      <p className="text-sm font-medium">Medical status</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {medicalDaysUntil === null ? (
                          <Badge className="rounded-full border border-slate-200 bg-white text-slate-700">Update required</Badge>
                        ) : medicalDaysUntil < 0 ? (
                          <Badge className="rounded-full border border-red-200 bg-red-50 text-red-700">Expired</Badge>
                        ) : medicalDaysUntil <= 30 ? (
                          <Badge className="rounded-full border border-amber-200 bg-amber-50 text-amber-700">Expires in {medicalDaysUntil} days</Badge>
                        ) : (
                          <Badge className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">Valid for {medicalDaysUntil} days</Badge>
                        )}
                        <span className="text-sm text-slate-500 dark:text-slate-400">{details.medical_cert_validity ? formatProfileDate(details.medical_cert_validity) : "No validity date recorded"}</span>
                      </div>
                    </div>
                  </SectionCard>
                </TabsContent>

                <TabsContent value="operational" className="space-y-4">
                  <SectionCard title="Operational Capability" description="Free-form operational endorsements and platform qualifications.">
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          <Radio className="h-3.5 w-3.5" />
                          Unit Endorsements
                        </Label>
                        <Textarea
                          value={details.unit_endorsements}
                          onChange={(event) => updateDetail("unit_endorsements", event.target.value)}
                          onFocus={() => {
                            if (!isEditing) setIsEditing(true);
                          }}
                          placeholder="e.g. TWR - DEL, APP - CCU, ACC - Mumbai FIR"
                          rows={4}
                          className={cn(
                            "rounded-2xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
                            !isEditing && "cursor-text bg-slate-50 dark:bg-slate-900"
                          )}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          <Radio className="h-3.5 w-3.5" />
                          Equipment Qualifications
                        </Label>
                        <Textarea
                          value={details.equipment_qualifications}
                          onChange={(event) => updateDetail("equipment_qualifications", event.target.value)}
                          onFocus={() => {
                            if (!isEditing) setIsEditing(true);
                          }}
                          placeholder="e.g. PSR, SSR, MSSR, ADS-B, VHF, HF"
                          rows={4}
                          className={cn(
                            "rounded-2xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
                            !isEditing && "cursor-text bg-slate-50 dark:bg-slate-900"
                          )}
                        />
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard title="Linked Operational Ratings" description="System-linked qualification rows sourced from backend records.">
                    <div className="space-y-3">
                      {activeRatings.length > 0 ? (
                        activeRatings.map((rating) => (
                          <div key={rating.id} className="rounded-3xl border border-slate-200/80 p-4 dark:border-slate-800">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <ShieldCheck className="h-4 w-4 text-slate-500" />
                                  <h4 className="text-sm font-semibold">{rating.label}</h4>
                                  <Badge variant="secondary" className="rounded-full text-[11px]">{rating.ratingKey.toUpperCase()}</Badge>
                                </div>
                                <div className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                                  {rating.issueDate ? <p>Issued {formatProfileDate(rating.issueDate)}</p> : null}
                                  {rating.expiryDate ? <p>Expires {formatProfileDate(rating.expiryDate)}</p> : null}
                                  {rating.lastProficiencyDate ? <p>Last proficiency {formatProfileDate(rating.lastProficiencyDate)}</p> : null}
                                </div>
                              </div>
                              <Badge className={cn("rounded-full border text-[11px]", getProfileHealthBadgeClass(rating.status))}>{getHealthStatusLabel(rating)}</Badge>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400">No operational ratings found in backend records.</p>
                      )}
                    </div>
                  </SectionCard>
                </TabsContent>

                <TabsContent value="training" className="space-y-4">
                  <SectionCard title="Training Record" description="Institution, recurrence, and course completion data.">
                    <div className="grid gap-4 md:grid-cols-2">
                      <EditableField icon={GraduationCap} label="Initial Training Institute" value={details.initial_training_institute} onChange={(value) => updateDetail("initial_training_institute", value)} placeholder="e.g. CATC Allahabad" isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <EditableField icon={Calendar} label="Initial Training Year" value={details.initial_training_year} onChange={(value) => updateDetail("initial_training_year", value)} placeholder="e.g. 2015" isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <EditableField icon={Calendar} label="Last Recurrent Training Date" type="date" value={details.last_recurrent_training_date} onChange={(value) => updateDetail("last_recurrent_training_date", value)} isEditing={isEditing} onActivateEdit={() => setIsEditing(true)} />
                      <ReadOnlyField icon={Clock3} label="Training Sync" value={profile?.rating_synced_at ? formatProfileDate(String(profile.rating_synced_at)) : "Not synced"} />
                    </div>
                  </SectionCard>

                  <SectionCard title="Course Completion Dates" description="Imported completions from linked training records.">
                    {completionDates.length > 0 ? (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {completionDates.map(([course, date]) => (
                          <div key={course} className="rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{formatCourseLabel(course)}</p>
                            <p className="mt-1 text-sm font-semibold">{formatProfileDate(date)}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">No course completion dates found in training records.</p>
                    )}
                  </SectionCard>
                </TabsContent>

                <TabsContent value="language" className="space-y-4">
                  <SectionCard title="Language Proficiency" description="ELPA status and editable ICAO English proficiency level.">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">ELPA Level</p>
                        <p className="mt-1 text-sm font-semibold">{currentElpaLevel ? `Level ${currentElpaLevel}` : "-"}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Valid Until</p>
                        <p className="mt-1 text-sm font-semibold">{trainingRecord?.elpa_valid_upto ? formatProfileDate(String(trainingRecord.elpa_valid_upto)) : "-"}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Endorsed Until</p>
                        <p className="mt-1 text-sm font-semibold">{trainingRecord?.elpa_endorsed_upto ? formatProfileDate(String(trainingRecord.elpa_endorsed_upto)) : "-"}</p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          <Globe className="h-3.5 w-3.5" />
                          ICAO English Proficiency Level
                        </Label>
                        <Select
                          value={details.icao_english_proficiency_level}
                          onValueChange={(value) => updateDetail("icao_english_proficiency_level", value)}
                          onOpenChange={(open) => {
                            if (open && !isEditing) setIsEditing(true);
                          }}
                        >
                          <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                            <SelectValue placeholder="Select level" />
                          </SelectTrigger>
                          <SelectContent>
                            {ICAO_LEVELS.map((level) => (
                              <SelectItem key={level.value} value={level.value}>
                                {level.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-sm font-medium">Language readiness</p>
                        {details.icao_english_proficiency_level ? (
                          <>
                            <Badge
                              className={cn(
                                "mt-3 rounded-full border",
                                Number(details.icao_english_proficiency_level) >= 4
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                              )}
                            >
                              Level {details.icao_english_proficiency_level}
                            </Badge>
                            {Number(details.icao_english_proficiency_level) < 4 ? (
                              <p className="mt-2 text-xs text-amber-700">ICAO Level 4 is the operational baseline for international ATC operations.</p>
                            ) : null}
                          </>
                        ) : (
                          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Select a level to surface language readiness clearly.</p>
                        )}
                      </div>
                    </div>
                  </SectionCard>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
