import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables, TablesInsert } from "@/integrations/supabase/types";

type BaTest = Tables<"ba_tests">;
type BaTestInsert = TablesInsert<"ba_tests">;

export function useBaTests() {
  return useQuery({
    queryKey: ["ba_tests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ba_tests")
        .select("*")
        .order("test_date", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as BaTest[];
    },
  });
}

export function useCreateBaTest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (test: BaTestInsert) => {
      const { data, error } = await supabase
        .from("ba_tests")
        .insert(test)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ba_tests"] });
    },
  });
}
