import { useState, useEffect } from "react";
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
import {
  User, Camera, Lock, FileText, Mail, Phone, Shield,
  Briefcase, GraduationCap, Heart, Globe, Radio, Calendar,
  Building, MapPin, Award, ShieldCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile, useUsers } from "@/hooks/useUsers";
import { buildEmployeeLicenseHealth, getHealthStatusLabel, type LicenseWithExtras } from "@/hooks/useLicenseDashboard";
import { Skeleton } from "@/components/ui/skeleton";

const LICENSE_LABELS: { [key: string]: string } = {
  rdr: "Radar",
  app: "Approach",
  plr: "Precision",
  adc: "Aerodrome",
  alpha: "Alpha",
  occ: "Oceanic",
};

const ICAO_LEVELS = [
  { value: "1", label: "Level 1 — Pre-Elementary" },
  { value: "2", label: "Level 2 — Elementary" },
  { value: "3", label: "Level 3 — Pre-Operational" },
  { value: "4", label: "Level 4 — Operational" },
  { value: "5", label: "Level 5 — Extended" },
  { value: "6", label: "Level 6 — Expert" },
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

export default function EmployeeProfile() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const { profile, isLoading } = useUserProfile(user?.id);
  const { updateProfile, isUpdating } = useUsers();

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
      if (profile.profile_details) {
        setDetails({ ...DEFAULT_DETAILS, ...(profile.profile_details as any) });
      }
    }
  }, [profile]);

  const updateDetail = (key: keyof ProfileDetails, value: string) => {
    setDetails((prev) => ({ ...prev, [key]: value }));
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
          ...((profile?.profile_details as any) || {}),
          ...details,
        },
      },
    });

    setIsEditing(false);
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  const completionDates = Object.entries((profile?.linked_training_record?.completion_dates as Record<string, string> | undefined) || {})
    .filter(([, value]) => Boolean(value))
    .sort(([first], [second]) => first.localeCompare(second));
  const trainingRecord = profile?.linked_training_record as Record<string, any> | null | undefined;
  const licenseHealth = buildEmployeeLicenseHealth(profile, ((profile?.licenses || []) as LicenseWithExtras[]));
  const activeRatings = licenseHealth.ratings.filter((rating) => rating.isActive);
  const currentLicenseNumber = String(trainingRecord?.license_number || details.atc_license_number || "").trim();
  const currentElpaLevel = String(trainingRecord?.elpa_level || details.icao_english_proficiency_level || "").trim();
  const highestRating = String(profile?.highest_rating || trainingRecord?.highest_rating || "").trim();

  const formatCourseLabel = (value: string) =>
    value
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const formatProfileDate = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  };

  const getProfileHealthBadgeClass = (status: "valid" | "warning" | "expired" | "info") => {
    if (status === "expired") return "bg-red-600 text-xs";
    if (status === "warning") return "bg-amber-500 text-white text-xs";
    if (status === "valid") return "bg-green-600 text-xs";
    return "bg-slate-500 text-white text-xs";
  };

  if (isLoading) {
    return (
      <DashboardLayout role="employee">
        <div className="space-y-6">
          <Skeleton className="h-12 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full md:col-span-2" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // --- Reusable field components ---
  const ReadOnlyField = ({ icon: Icon, label, value }: { icon?: any; label: string; value: string }) => (
    <div className="space-y-2">
      <Label className="flex items-center gap-1 text-muted-foreground text-xs uppercase tracking-wider">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </Label>
      <p className="text-sm font-medium px-3 py-2 bg-muted/50 rounded-md min-h-[36px] flex items-center">
        {value || <span className="text-muted-foreground italic">Not set</span>}
      </p>
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
  }: {
    icon?: any;
    label: string;
    value: string;
    onChange: (val: string) => void;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <div className="space-y-2">
      <Label className="flex items-center gap-1 text-muted-foreground text-xs uppercase tracking-wider">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!isEditing || disabled}
        placeholder={placeholder}
        className="h-9"
      />
    </div>
  );

  return (
    <DashboardLayout role="employee">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Profile</h1>
            <p className="text-muted-foreground">Manage your personal and professional information</p>
          </div>
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)}>Edit Profile</Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isUpdating}>
                {isUpdating ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left sidebar — Profile Photo & Quick Info */}
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>Profile Photo</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center space-y-4">
              <Avatar className="h-32 w-32">
                <AvatarImage src={undefined} />
                <AvatarFallback className="text-2xl">
                  {getInitials(profileData.fullName || "U")}
                </AvatarFallback>
              </Avatar>
              <Button variant="outline" size="sm">
                <Camera className="mr-2 h-4 w-4" />
                Upload Photo
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                JPG or PNG. Max size 2MB
              </p>

              <Separator />

              {/* Quick info card */}
              <div className="w-full space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">ID:</span>
                  <span className="font-mono font-medium">{profileData.employeeId}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Building className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Designation:</span>
                  <span className="font-medium">{profileData.designation || "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Station:</span>
                  <span className="font-medium">{profileData.station || "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Contact:</span>
                  <span className="font-medium">{profileData.mobile || "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Highest Rating:</span>
                  <span className="font-medium">{highestRating || "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="uppercase text-xs">
                    Shift {profileData.currentShift}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Right Panel — Tabs */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Profile Details</CardTitle>
              <CardDescription>Your complete personal and professional information</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="personal">
                <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
                  <TabsTrigger value="personal" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs px-3 py-1.5 rounded-full border">
                    <User className="h-3.5 w-3.5 mr-1" /> Personal
                  </TabsTrigger>
                  <TabsTrigger value="employment" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs px-3 py-1.5 rounded-full border">
                    <Briefcase className="h-3.5 w-3.5 mr-1" /> Employment
                  </TabsTrigger>
                  <TabsTrigger value="license" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs px-3 py-1.5 rounded-full border">
                    <Award className="h-3.5 w-3.5 mr-1" /> License
                  </TabsTrigger>
                  <TabsTrigger value="medical" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs px-3 py-1.5 rounded-full border">
                    <Heart className="h-3.5 w-3.5 mr-1" /> Medical
                  </TabsTrigger>
                  <TabsTrigger value="operational" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs px-3 py-1.5 rounded-full border">
                    <Radio className="h-3.5 w-3.5 mr-1" /> Operational
                  </TabsTrigger>
                  <TabsTrigger value="training" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs px-3 py-1.5 rounded-full border">
                    <GraduationCap className="h-3.5 w-3.5 mr-1" /> Training
                  </TabsTrigger>
                  <TabsTrigger value="security" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs px-3 py-1.5 rounded-full border">
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Security
                  </TabsTrigger>
                  <TabsTrigger value="language" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs px-3 py-1.5 rounded-full border">
                    <Globe className="h-3.5 w-3.5 mr-1" /> Language
                  </TabsTrigger>
                </TabsList>

                {/* ============ PERSONAL ============ */}
                <TabsContent value="personal" className="space-y-4 mt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <EditableField
                      icon={User}
                      label="Full Name"
                      value={profileData.fullName}
                      onChange={(v) => setProfileData({ ...profileData, fullName: v })}
                    />
                    <EditableField
                      icon={Calendar}
                      label="Date of Birth"
                      type="date"
                      value={profileData.dateOfBirth}
                      onChange={(v) => setProfileData({ ...profileData, dateOfBirth: v })}
                    />
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1 text-muted-foreground text-xs uppercase tracking-wider">
                        <User className="h-3.5 w-3.5" />
                        Gender
                      </Label>
                      <Select
                        value={profileData.gender}
                        onValueChange={(v) => setProfileData({ ...profileData, gender: v })}
                        disabled={!isEditing}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <EditableField
                      icon={Mail}
                      label="Email"
                      type="email"
                      value={profileData.email}
                      onChange={(v) => setProfileData({ ...profileData, email: v })}
                    />
                    <EditableField
                      icon={Phone}
                      label="Mobile"
                      value={profileData.mobile}
                      onChange={(v) => setProfileData({ ...profileData, mobile: v })}
                    />
                    <EditableField
                      icon={Phone}
                      label="Emergency Contact"
                      value={profileData.emergencyContact}
                      onChange={(v) => setProfileData({ ...profileData, emergencyContact: v })}
                    />
                  </div>
                </TabsContent>

                {/* ============ EMPLOYMENT ============ */}
                <TabsContent value="employment" className="space-y-4 mt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ReadOnlyField
                      icon={Briefcase}
                      label="Employee ID"
                      value={profileData.employeeId}
                    />
                    <ReadOnlyField
                      icon={Building}
                      label="Designation"
                      value={profileData.designation}
                    />
                    <EditableField
                      icon={Building}
                      label="Department"
                      value={profileData.department}
                      onChange={(v) => setProfileData({ ...profileData, department: v })}
                      placeholder="e.g. ATC Operations"
                    />
                    <EditableField
                      icon={MapPin}
                      label="Current Station"
                      value={profileData.station}
                      onChange={(v) => setProfileData({ ...profileData, station: v })}
                      placeholder="e.g. VECC"
                    />
                    <ReadOnlyField
                      icon={Phone}
                      label="Contact No"
                      value={profileData.mobile}
                    />
                    <ReadOnlyField
                      icon={Award}
                      label="Highest Rating"
                      value={highestRating}
                    />
                    <EditableField
                      icon={Calendar}
                      label="Date of Joining"
                      type="date"
                      value={profileData.dateOfJoining}
                      onChange={(v) => setProfileData({ ...profileData, dateOfJoining: v })}
                    />
                    <ReadOnlyField
                      label="Current Shift"
                      value={profileData.currentShift ? `Shift ${profileData.currentShift.toUpperCase()}` : ""}
                    />
                    <ReadOnlyField
                      label="Stream"
                      value={profileData.stream}
                    />
                  </div>
                </TabsContent>

                {/* ============ LICENSE & CERTIFICATION ============ */}
                <TabsContent value="license" className="space-y-6 mt-2">
                  {/* ATC License fields */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Award className="h-4 w-4" /> ATC License Details
                    </h3>
                    <div className="grid grid-cols-1 gap-3 mb-4 md:grid-cols-3">
                      <div className="rounded-lg border bg-muted/20 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Current License Number</p>
                        <p className="mt-1 text-sm font-medium">{currentLicenseNumber || "—"}</p>
                      </div>
                      <div className="rounded-lg border bg-muted/20 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Highest Rating</p>
                        <p className="mt-1 text-sm font-medium">{highestRating || "—"}</p>
                      </div>
                      <div className="rounded-lg border bg-muted/20 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Current Station</p>
                        <p className="mt-1 text-sm font-medium">{profileData.station || "—"}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <EditableField
                        label="ATC License Number"
                        value={details.atc_license_number}
                        onChange={(v) => updateDetail("atc_license_number", v)}
                        placeholder="e.g. ATC-12345"
                      />
                      <EditableField
                        label="License Type"
                        value={details.atc_license_type}
                        onChange={(v) => updateDetail("atc_license_type", v)}
                        placeholder="e.g. ATCO, AFISO"
                      />
                      <EditableField
                        label="License Expiry Date"
                        type="date"
                        value={details.atc_license_expiry}
                        onChange={(v) => updateDetail("atc_license_expiry", v)}
                      />
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1 text-muted-foreground text-xs uppercase tracking-wider">
                          Issuing Authority
                        </Label>
                        <Select
                          value={details.issuing_authority}
                          onValueChange={(v) => updateDetail("issuing_authority", v)}
                          disabled={!isEditing}
                        >
                          <SelectTrigger className="h-9">
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
                  </div>

                  <Separator />

                  {/* Backend-linked operational ratings */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Radio className="h-4 w-4" /> Operational Ratings
                    </h3>
                    <div className="space-y-3">
                      {activeRatings.length > 0 ? (
                        activeRatings.map((rating) => (
                          <Card key={rating.id}>
                            <CardContent className="pt-4 pb-4">
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Shield className="h-4 w-4 text-primary" />
                                    <h4 className="font-semibold text-sm">
                                      {rating.label}
                                    </h4>
                                    <Badge variant="secondary" className="text-xs">
                                      {rating.ratingKey.toUpperCase()}
                                    </Badge>
                                  </div>
                                  <div className="text-xs text-muted-foreground space-y-0.5">
                                    {rating.issueDate && (
                                      <p>Issued: {new Date(rating.issueDate).toLocaleDateString()}</p>
                                    )}
                                    {rating.expiryDate && (
                                      <p>Expires: {new Date(rating.expiryDate).toLocaleDateString()}</p>
                                    )}
                                    {rating.lastProficiencyDate && (
                                      <p>Last Proficiency: {new Date(rating.lastProficiencyDate).toLocaleDateString()}</p>
                                    )}
                                  </div>
                                </div>
                                <Badge className={getProfileHealthBadgeClass(rating.status)}>
                                  {getHealthStatusLabel(rating)}
                                </Badge>
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">No operational ratings found in backend records.</p>
                      )}
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Shield className="h-4 w-4" /> License Register
                    </h3>
                    <div className="space-y-3">
                      {licenseHealth.licenses.length > 0 ? (
                        licenseHealth.licenses.map((license) => (
                          <Card key={license.id}>
                            <CardContent className="pt-4 pb-4">
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Shield className="h-4 w-4 text-primary" />
                                    <h4 className="font-semibold text-sm">{license.label}</h4>
                                    {license.meta && (
                                      <Badge variant="secondary" className="text-xs">{license.meta}</Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground space-y-0.5">
                                    {license.issueDate && <p>Issued: {new Date(license.issueDate).toLocaleDateString()}</p>}
                                    {license.expiryDate ? (
                                      <p>Expires: {new Date(license.expiryDate).toLocaleDateString()}</p>
                                    ) : (
                                      <p>No expiry date recorded</p>
                                    )}
                                  </div>
                                </div>
                                <Badge className={getProfileHealthBadgeClass(license.status)}>
                                  {getHealthStatusLabel(license)}
                                </Badge>
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">No license records found.</p>
                      )}
                    </div>
                  </div>
                </TabsContent>

                {/* ============ MEDICAL ============ */}
                <TabsContent value="medical" className="space-y-4 mt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1 text-muted-foreground text-xs uppercase tracking-wider">
                        <Heart className="h-3.5 w-3.5" />
                        Medical Certificate Class
                      </Label>
                      <Select
                        value={details.medical_cert_class}
                        onValueChange={(v) => updateDetail("medical_cert_class", v)}
                        disabled={!isEditing}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select class" />
                        </SelectTrigger>
                        <SelectContent>
                          {MEDICAL_CLASSES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <EditableField
                      icon={Calendar}
                      label="Certificate Validity"
                      type="date"
                      value={details.medical_cert_validity}
                      onChange={(v) => updateDetail("medical_cert_validity", v)}
                    />
                  </div>
                  {details.medical_cert_validity && (
                    <div className="mt-2">
                      {(() => {
                        const expiry = new Date(details.medical_cert_validity);
                        const now = new Date();
                        const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        if (daysUntil < 0) return <Badge variant="destructive">Medical Certificate Expired</Badge>;
                        if (daysUntil <= 30) return <Badge className="bg-amber-500 text-white">Expires in {daysUntil} days</Badge>;
                        return <Badge className="bg-green-600">Valid — {daysUntil} days remaining</Badge>;
                      })()}
                    </div>
                  )}
                </TabsContent>

                {/* ============ OPERATIONAL RATINGS ============ */}
                <TabsContent value="operational" className="space-y-4 mt-2">
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1 text-muted-foreground text-xs uppercase tracking-wider">
                        <Radio className="h-3.5 w-3.5" />
                        Unit Endorsements
                      </Label>
                      <Textarea
                        value={details.unit_endorsements}
                        onChange={(e) => updateDetail("unit_endorsements", e.target.value)}
                        disabled={!isEditing}
                        placeholder="e.g. TWR – DEL, APP – CCU, ACC – Mumbai FIR"
                        rows={3}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1 text-muted-foreground text-xs uppercase tracking-wider">
                        <Radio className="h-3.5 w-3.5" />
                        Equipment Qualifications
                      </Label>
                      <Textarea
                        value={details.equipment_qualifications}
                        onChange={(e) => updateDetail("equipment_qualifications", e.target.value)}
                        disabled={!isEditing}
                        placeholder="e.g. PSR, SSR, MSSR, ADS-B, VHF, HF"
                        rows={3}
                      />
                    </div>
                  </div>
                </TabsContent>

                {/* ============ TRAINING ============ */}
                <TabsContent value="training" className="space-y-4 mt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <EditableField
                      icon={GraduationCap}
                      label="Initial Training Institute"
                      value={details.initial_training_institute}
                      onChange={(v) => updateDetail("initial_training_institute", v)}
                      placeholder="e.g. CATC Allahabad, NIAER Fursatganj"
                    />
                    <EditableField
                      icon={Calendar}
                      label="Initial Training Year"
                      value={details.initial_training_year}
                      onChange={(v) => updateDetail("initial_training_year", v)}
                      placeholder="e.g. 2015"
                    />
                    <EditableField
                      icon={Calendar}
                      label="Last Recurrent Training Date"
                      type="date"
                      value={details.last_recurrent_training_date}
                      onChange={(v) => updateDetail("last_recurrent_training_date", v)}
                    />
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Course Completion Dates
                    </h3>
                    {completionDates.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {completionDates.map(([course, date]) => (
                          <div key={course} className="rounded-lg border bg-muted/20 px-4 py-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              {formatCourseLabel(course)}
                            </p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {formatProfileDate(date)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No course completion dates found in training records.</p>
                    )}
                  </div>
                </TabsContent>

                {/* ============ SECURITY ============ */}
                <TabsContent value="security" className="space-y-6 mt-2">
                  {/* Security Clearance */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4" /> Security Clearance
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1 text-muted-foreground text-xs uppercase tracking-wider">
                          Clearance Status
                        </Label>
                        <Select
                          value={details.security_clearance_status}
                          onValueChange={(v) => updateDetail("security_clearance_status", v)}
                          disabled={!isEditing}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            {SECURITY_STATUSES.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Account Security */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Lock className="h-4 w-4" /> Account Security
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center gap-3">
                            <Lock className="h-5 w-5 text-muted-foreground" />
                            <div className="flex-1">
                              <p className="text-sm font-medium">Password</p>
                              <p className="text-xs text-muted-foreground">Change your account password</p>
                            </div>
                            <Button variant="outline" size="sm">Change</Button>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center gap-3">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                            <div className="flex-1">
                              <p className="text-sm font-medium">Data Export</p>
                              <p className="text-xs text-muted-foreground">Download your personal data</p>
                            </div>
                            <Button variant="outline" size="sm">Export</Button>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </TabsContent>

                {/* ============ LANGUAGE ============ */}
                <TabsContent value="language" className="space-y-4 mt-2">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-lg border bg-muted/20 px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">ICAO ELPA Level</p>
                      <p className="mt-1 text-sm font-medium">{currentElpaLevel ? `Level ${currentElpaLevel}` : "—"}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">ELPA Valid Upto</p>
                      <p className="mt-1 text-sm font-medium">{trainingRecord?.elpa_valid_upto ? formatProfileDate(String(trainingRecord.elpa_valid_upto)) : "—"}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">ELPA Endorsed Upto</p>
                      <p className="mt-1 text-sm font-medium">{trainingRecord?.elpa_endorsed_upto ? formatProfileDate(String(trainingRecord.elpa_endorsed_upto)) : "—"}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1 text-muted-foreground text-xs uppercase tracking-wider">
                        <Globe className="h-3.5 w-3.5" />
                        ICAO English Proficiency Level
                      </Label>
                      <Select
                        value={details.icao_english_proficiency_level}
                        onValueChange={(v) => updateDetail("icao_english_proficiency_level", v)}
                        disabled={!isEditing}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select level" />
                        </SelectTrigger>
                        <SelectContent>
                          {ICAO_LEVELS.map((l) => (
                            <SelectItem key={l.value} value={l.value}>
                              {l.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {details.icao_english_proficiency_level && (
                    <div className="mt-2">
                      <Badge
                        className={
                          parseInt(details.icao_english_proficiency_level) >= 4
                            ? "bg-green-600"
                            : "bg-amber-500 text-white"
                        }
                      >
                        Level {details.icao_english_proficiency_level} —{" "}
                        {ICAO_LEVELS.find((l) => l.value === details.icao_english_proficiency_level)?.label.split("—")[1]?.trim() || ""}
                      </Badge>
                      {parseInt(details.icao_english_proficiency_level) < 4 && (
                        <p className="text-xs text-amber-600 mt-1">
                          ⚠ ICAO Level 4 (Operational) is the minimum for international ATC operations
                        </p>
                      )}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
