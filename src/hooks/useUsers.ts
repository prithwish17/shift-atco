import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface UserWithRole {
  id: string;
  full_name: string;
  employee_id: string;
  email: string;
  mobile: string | null;
  designation: string | null;
  current_shift: string;
  photo_url: string | null;
  role: string | null;
  approved: boolean;
  is_hidden: boolean;
  created_at: string;
}

const PROFILE_LICENSE_LABELS: Record<string, string> = {
  rdr: "Radar",
  app: "Approach",
  plr: "Precision",
  adc: "Aerodrome",
  alpha: "Alpha",
  occ: "Oceanic",
};

function normalizeDateString(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function getLatestDateValue(records: Array<Record<string, string> | null | undefined>) {
  const values = records
    .flatMap((record) => Object.values(record || {}))
    .filter(Boolean)
    .map((value) => {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    })
    .filter((value): value is Date => value instanceof Date)
    .sort((first, second) => second.getTime() - first.getTime());

  return values[0] ? values[0].toISOString().slice(0, 10) : "";
}

function buildMergedProfileDetails(
  existingProfileDetails: Record<string, any> | null | undefined,
  licenses: Array<Record<string, any>>,
  trainingRecord: Record<string, any> | null,
  employeeDataSync: Record<string, any> | null,
) {
  const existing = existingProfileDetails || {};
  const licenseLabels = licenses.map((license) => PROFILE_LICENSE_LABELS[license.license_type] || String(license.license_type || "").toUpperCase()).filter(Boolean);
  const nearestLicenseExpiry = licenses
    .map((license) => normalizeDateString(license.expiry_date))
    .filter(Boolean)
    .sort((first, second) => first.localeCompare(second))[0] || "";

  const ratingQualified = Object.entries(trainingRecord?.rating_summary || {})
    .filter(([, value]) => String(value).toLowerCase() === "yes")
    .map(([key]) => key);
  const ojtiQualified = Object.entries(trainingRecord?.ojti || {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => `${key} OJTI`);
  const examinerQualified = Object.entries(trainingRecord?.examiner || {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => `${key} Examiner`);
  const equipmentQualifications = [...ratingQualified, ...ojtiQualified, ...examinerQualified]
    .filter((value, index, arr) => value && arr.indexOf(value) === index)
    .join(", ");

  return {
    ...existing,
    atc_license_number: existing.atc_license_number || trainingRecord?.license_number || "",
    atc_license_type: existing.atc_license_type || employeeDataSync?.highest_rating || licenseLabels[0] || "",
    atc_license_expiry: existing.atc_license_expiry || nearestLicenseExpiry,
    issuing_authority: existing.issuing_authority || "",
    medical_cert_class: existing.medical_cert_class || "",
    medical_cert_validity: existing.medical_cert_validity || normalizeDateString(trainingRecord?.med_endorsed_upto),
    unit_endorsements: existing.unit_endorsements || licenseLabels.join(", "),
    equipment_qualifications: existing.equipment_qualifications || equipmentQualifications,
    initial_training_institute: existing.initial_training_institute || "",
    initial_training_year: existing.initial_training_year || "",
    last_recurrent_training_date: existing.last_recurrent_training_date || getLatestDateValue([
      trainingRecord?.completion_dates,
      trainingRecord?.instructor_validity,
      trainingRecord?.examiner_validity,
    ]),
    security_clearance_status: existing.security_clearance_status || "",
    icao_english_proficiency_level: existing.icao_english_proficiency_level || trainingRecord?.elpa_level || "",
    employee_data_sync: employeeDataSync,
  };
}

export function useUsers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      let allProfiles: any[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error: profilesError } = await supabase
          .from("profiles")
          .select("*")
          .order("full_name")
          .range(from, from + PAGE_SIZE - 1);

        if (profilesError) throw profilesError;

        const rows = pageData || [];
        allProfiles = allProfiles.concat(rows);
        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      const profiles = allProfiles;

      const userIds = profiles.map(p => p.id);
      let allRoles: any[] = [];
      const CHUNK_SIZE = 500;

      for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
        const chunk = userIds.slice(i, i + CHUNK_SIZE);
        const { data: rolesChunk, error: rolesError } = await supabase
          .from("user_roles")
          .select("*")
          .in("user_id", chunk);

        if (rolesError) throw rolesError;
        if (rolesChunk) {
          allRoles = allRoles.concat(rolesChunk);
        }
      }

      const roles = allRoles;

      return profiles.map(profile => {
        const userRole = roles?.find(r => r.user_id === profile.id);
        return {
          ...profile,
          role: userRole?.role || null,
          approved: userRole?.approved || false,
          is_hidden: profile.is_hidden || false,
        } as UserWithRole;
      });
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
  });

  const approveUser = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("user_roles")
        .update({
          approved: true,
          approved_at: new Date().toISOString(),
          approved_by: (await supabase.auth.getUser()).data.user?.id
        })
        .eq("user_id", userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({
        title: "User approved",
        description: "User has been successfully approved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error approving user",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      // TODO: This only deletes the profile (cascades to user_roles).
      // The auth.users entry persists — user can still log in.
      // Create a Supabase Edge Function that calls
      // adminClient.auth.admin.deleteUser(userId) for complete deletion.
      const { error } = await supabase
        .from("profiles")
        .delete()
        .eq("id", userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({
        title: "User deleted",
        description: "User has been successfully deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting user",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateUserRole = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: string }) => {
      const currentUser = (await supabase.auth.getUser()).data.user;
      const { error } = await supabase
        .from("user_roles")
        .update({
          role: newRole as any,
          approved: true,
          approved_at: new Date().toISOString(),
          approved_by: currentUser?.id,
        })
        .eq("user_id", userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({
        title: "Role updated",
        description: "User role has been successfully updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateProfile = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast({
        title: "Profile updated",
        description: "Profile has been successfully updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating profile",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleHideUser = useMutation({
    mutationFn: async ({ userId, hidden }: { userId: string; hidden: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_hidden: hidden } as any)
        .eq("id", userId);

      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["grid-employees"] });
      toast({
        title: variables.hidden ? "User hidden" : "User unhidden",
        description: variables.hidden
          ? "User will no longer appear in schedules, leaves, or other views."
          : "User is now visible across all views.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating visibility",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    users,
    isLoading,
    error,
    approveUser: approveUser.mutate,
    deleteUser: deleteUser.mutate,
    updateProfile: updateProfile.mutate,
    updateUserRole: updateUserRole.mutate,
    toggleHideUser: toggleHideUser.mutate,
    isApproving: approveUser.isPending,
    isDeleting: deleteUser.isPending,
    isUpdating: updateProfile.isPending,
    isUpdatingRole: updateUserRole.isPending,
    isTogglingHide: toggleHideUser.isPending,
  };
}

export function useUserProfile(userId?: string) {
  const { toast } = useToast();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const id = userId || (await supabase.auth.getUser()).data.user?.id;
      if (!id) throw new Error("No user ID");

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;

      const { data: licenses } = await supabase
        .from("employee_licenses")
        .select("*")
        .eq("user_id", id);

      const { data: role } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", id)
        .single();

      const linkedEmployeeData = ((data as any)?.profile_details?.employee_data_sync || null) as Record<string, any> | null;

      let trainingRecord: Record<string, any> | null = null;
      if ((data as any)?.employee_id) {
        const { data: trainingData } = await supabase
          .from("employee_training_records" as any)
          .select("emp_id, employee_name, license_number, ojti, examiner, completion_dates, instructor_validity, examiner_validity, elpa_level, elpa_valid_upto, elpa_endorsed_upto, med_last_date, med_endorsed_upto, med_status, med_history, rating_designation, highest_rating, rating_summary, without_ratings, rating_data, rating_synced_at")
          .eq("emp_id", (data as any).employee_id)
          .maybeSingle();
        trainingRecord = (trainingData as Record<string, any> | null) || null;
      }

      const mergedProfileDetails = buildMergedProfileDetails(
        (data as any)?.profile_details || null,
        (licenses || []) as Array<Record<string, any>>,
        trainingRecord,
        linkedEmployeeData,
      );

      return {
        ...data,
        licenses: licenses || [],
        role: role?.role,
        profile_details: mergedProfileDetails,
        employee_data_sync: linkedEmployeeData,
        linked_training_record: trainingRecord,
        highest_rating: trainingRecord?.highest_rating ?? linkedEmployeeData?.highest_rating ?? null,
        rating_summary: trainingRecord?.rating_summary ?? linkedEmployeeData?.rating_summary ?? {},
        without_ratings: trainingRecord?.without_ratings ?? linkedEmployeeData?.without_ratings ?? {},
        rating_designation: trainingRecord?.rating_designation ?? (data as any)?.designation ?? linkedEmployeeData?.designation ?? null,
        rating_synced_at: trainingRecord?.rating_synced_at ?? null,
      };
    },
    enabled: !!userId || undefined,
  });

  return { profile, isLoading };
}
