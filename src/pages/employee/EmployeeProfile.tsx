import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, Camera, Lock, FileText, Mail, Phone, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useLicenses } from "@/hooks/useLicenses";
import { Skeleton } from "@/components/ui/skeleton";

const LICENSE_LABELS: { [key: string]: string } = {
  rdr: "Radar",
  app: "Approach",
  plr: "Precision",
  adc: "Aerodrome",
  alpha: "Alpha",
  occ: "Oceanic",
};

export default function EmployeeProfile() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const { profile, isLoading } = useUserProfile(user?.id);
  const { licenses } = useLicenses(user?.id);

  const [profileData, setProfileData] = useState({
    fullName: "",
    employeeId: "",
    email: "",
    mobile: "",
    designation: "",
    emergencyContact: "",
    currentShift: "",
  });

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
      });
    }
  }, [profile]);

  const handleSave = () => {
    // TODO: Implement profile update logic
    setIsEditing(false);
    toast({
      title: "Profile Updated",
      description: "Your profile information has been saved successfully",
    });
  };

  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase();
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

  return (
    <DashboardLayout role="employee">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Profile</h1>
            <p className="text-muted-foreground">Manage your personal information</p>
          </div>
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)}>
              Edit Profile
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                Save Changes
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>Profile Photo</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center space-y-4">
              <Avatar className="h-32 w-32">
                <AvatarImage src={undefined} />
                <AvatarFallback className="text-2xl">{getInitials(profileData.fullName)}</AvatarFallback>
              </Avatar>
              <Button variant="outline" size="sm">
                <Camera className="mr-2 h-4 w-4" />
                Upload Photo
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                JPG or PNG. Max size 2MB
              </p>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Your basic profile details</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="personal">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="personal">Personal</TabsTrigger>
                  <TabsTrigger value="licenses">Licenses</TabsTrigger>
                  <TabsTrigger value="security">Security</TabsTrigger>
                </TabsList>

                <TabsContent value="personal" className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="fullName">
                        <User className="inline h-4 w-4 mr-1" />
                        Full Name
                      </Label>
                      <Input
                        id="fullName"
                        value={profileData.fullName}
                        onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                        disabled={!isEditing}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="employeeId">Employee ID</Label>
                      <Input
                        id="employeeId"
                        value={profileData.employeeId}
                        className="font-mono"
                        disabled
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">
                        <Mail className="inline h-4 w-4 mr-1" />
                        Email
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        value={profileData.email}
                        onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                        disabled={!isEditing}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mobile">
                        <Phone className="inline h-4 w-4 mr-1" />
                        Mobile
                      </Label>
                      <Input
                        id="mobile"
                        value={profileData.mobile}
                        onChange={(e) => setProfileData({ ...profileData, mobile: e.target.value })}
                        disabled={!isEditing}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="designation">Designation</Label>
                      <Input
                        id="designation"
                        value={profileData.designation}
                        disabled
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="emergencyContact">Emergency Contact</Label>
                      <Input
                        id="emergencyContact"
                        value={profileData.emergencyContact}
                        onChange={(e) => setProfileData({ ...profileData, emergencyContact: e.target.value })}
                        disabled={!isEditing}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Current Shift</Label>
                      <div>
                        <Badge variant="outline" className="uppercase text-base">
                          Shift {profileData.currentShift}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="licenses" className="space-y-4">
                  <div className="space-y-3">
                    {licenses && licenses.length > 0 ? (
                      licenses.map((license) => (
                        <Card key={license.id}>
                          <CardContent className="pt-6">
                            <div className="flex items-start justify-between">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Shield className="h-5 w-5 text-primary" />
                                  <h4 className="font-semibold">
                                    {LICENSE_LABELS[license.license_type] || license.license_type.toUpperCase()}
                                  </h4>
                                  <Badge variant="secondary">{license.license_type.toUpperCase()}</Badge>
                                </div>
                                <div className="text-sm text-muted-foreground space-y-1">
                                  {license.issue_date && (
                                    <p>Issue Date: {new Date(license.issue_date).toLocaleDateString()}</p>
                                  )}
                                  {license.expiry_date && (
                                    <p>Expiry Date: {new Date(license.expiry_date).toLocaleDateString()}</p>
                                  )}
                                </div>
                              </div>
                              {(() => {
                                if (!license.expiry_date) return <Badge className="bg-green-600">Valid</Badge>;
                                const expiry = new Date(license.expiry_date);
                                const now = new Date();
                                const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                                if (daysUntil < 0) return <Badge variant="destructive">Expired</Badge>;
                                if (daysUntil <= 30) return <Badge className="bg-amber-500 text-white">Expiring Soon</Badge>;
                                return <Badge className="bg-green-600">Valid</Badge>;
                              })()}
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">No licenses found</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="security" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Lock className="h-4 w-4" />
                        Password
                      </CardTitle>
                      <CardDescription>
                        Manage your account password
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline">
                        Change Password
                      </Button>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Data Export
                      </CardTitle>
                      <CardDescription>
                        Download your personal data
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline">
                        Export My Data
                      </Button>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
