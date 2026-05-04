import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_EMPLOYEE_PAGE_NOTICE_STATE,
  EMPLOYEE_PAGE_NOTICE_SETTING_KEY,
  EmployeePageNoticeState,
  parseEmployeePageNoticeState,
} from "@/lib/employeePageNotices";

const EMPLOYEE_PAGE_NOTICE_QUERY_KEY = ["employee-page-notice-settings"];

export function useEmployeePageNoticeSettings() {
  return useQuery({
    queryKey: EMPLOYEE_PAGE_NOTICE_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("value")
        .eq("key", EMPLOYEE_PAGE_NOTICE_SETTING_KEY)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return parseEmployeePageNoticeState((data as { value?: string | null } | null)?.value);
    },
    staleTime: 30_000,
  });
}

export function useSaveEmployeePageNoticeSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (nextState: EmployeePageNoticeState) => {
      const { error } = await supabase
        .from("app_settings" as any)
        .upsert(
          {
            key: EMPLOYEE_PAGE_NOTICE_SETTING_KEY,
            value: JSON.stringify(nextState),
            label: "Employee page implementation notices",
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: "key" },
        );

      if (error) {
        throw error;
      }

      return nextState;
    },
    onMutate: async (nextState) => {
      await queryClient.cancelQueries({ queryKey: EMPLOYEE_PAGE_NOTICE_QUERY_KEY });

      const previousState =
        queryClient.getQueryData<EmployeePageNoticeState>(EMPLOYEE_PAGE_NOTICE_QUERY_KEY) ||
        DEFAULT_EMPLOYEE_PAGE_NOTICE_STATE;

      queryClient.setQueryData<EmployeePageNoticeState>(EMPLOYEE_PAGE_NOTICE_QUERY_KEY, nextState);

      return { previousState };
    },
    onError: (_error, _nextState, context) => {
      if (context?.previousState) {
        queryClient.setQueryData<EmployeePageNoticeState>(
          EMPLOYEE_PAGE_NOTICE_QUERY_KEY,
          context.previousState,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: EMPLOYEE_PAGE_NOTICE_QUERY_KEY });
    },
  });
}
