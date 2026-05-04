import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tables, TablesInsert } from "@/integrations/supabase/types";
import { logSupervisorEdit } from "@/lib/supervisorAuditLog";

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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["licenses"] });
      toast({
        title: "License added",
        description: "License has been successfully added.",
      });
      logSupervisorEdit({
        action: "insert",
        table: "employee_licenses",
        description: `Added license: ${(variables as any).license_type || "unknown type"} for user ${(variables as any).user_id || "unknown"}`,
        after: variables as Record<string, unknown>,
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["licenses"] });
      toast({
        title: "License updated",
        description: "License has been successfully updated.",
      });
      logSupervisorEdit({
        action: "update",
        table: "employee_licenses",
        description: `Updated license ${variables.id}`,
        recordId: variables.id,
        after: variables.updates as Record<string, unknown>,
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
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["licenses"] });
      toast({
        title: "License deleted",
        description: "License has been successfully deleted.",
      });
      logSupervisorEdit({
        action: "delete",
        table: "employee_licenses",
        description: `Deleted license ${id}`,
        recordId: id,
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
