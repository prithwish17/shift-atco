import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tables, TablesInsert } from "@/integrations/supabase/types";

export type License = Tables<"employee_licenses">;
export type LicenseInsert = Omit<TablesInsert<"employee_licenses">, "id" | "created_at">;

export function useLicenses(userId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: licenses, isLoading } = useQuery({
    queryKey: ["licenses", userId],
    queryFn: async () => {
      let query = supabase.from("employee_licenses").select("*");

      if (userId) {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query.order("created_at");

      if (error) throw error;
      return data as License[];
    },
  });

  const addLicense = useMutation({
    mutationFn: async (license: LicenseInsert) => {
      const { error } = await supabase.from("employee_licenses").insert(license);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["licenses"] });
      toast({
        title: "License added",
        description: "License has been successfully added.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error adding license",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateLicense = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<License> }) => {
      const { error } = await supabase
        .from("employee_licenses")
        .update(updates)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["licenses"] });
      toast({
        title: "License updated",
        description: "License has been successfully updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating license",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteLicense = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_licenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["licenses"] });
      toast({
        title: "License deleted",
        description: "License has been successfully deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting license",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    licenses,
    isLoading,
    addLicense: addLicense.mutate,
    updateLicense: updateLicense.mutate,
    deleteLicense: deleteLicense.mutate,
    isAdding: addLicense.isPending,
    isUpdating: updateLicense.isPending,
    isDeleting: deleteLicense.isPending,
  };
}
