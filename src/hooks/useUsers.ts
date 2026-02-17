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
  created_at: string;
}

export function useUsers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");

      if (profilesError) throw profilesError;

      const userIds = profiles.map(p => p.id);
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("*")
        .in("user_id", userIds);

      if (rolesError) throw rolesError;

      return profiles.map(profile => {
        const userRole = roles?.find(r => r.user_id === profile.id);
        return {
          ...profile,
          role: userRole?.role || null,
          approved: userRole?.approved || false,
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

  return {
    users,
    isLoading,
    error,
    approveUser: approveUser.mutate,
    deleteUser: deleteUser.mutate,
    updateProfile: updateProfile.mutate,
    updateUserRole: updateUserRole.mutate,
    isApproving: approveUser.isPending,
    isDeleting: deleteUser.isPending,
    isUpdating: updateProfile.isPending,
    isUpdatingRole: updateUserRole.isPending,
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

      return { ...data, licenses: licenses || [], role: role?.role };
    },
    enabled: !!userId || undefined,
  });

  return { profile, isLoading };
}
