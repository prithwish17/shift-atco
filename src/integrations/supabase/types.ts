export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      api_call_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          endpoint: string
          error_stack: string | null
          id: string
          job_name: string | null
          log_level: string
          message: string | null
          metadata: Json | null
          method: string
          records_affected: number | null
          status: string
          trace_id: string | null
          triggered_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          endpoint: string
          error_stack?: string | null
          id?: string
          job_name?: string | null
          log_level?: string
          message?: string | null
          metadata?: Json | null
          method?: string
          records_affected?: number | null
          status: string
          trace_id?: string | null
          triggered_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          endpoint?: string
          error_stack?: string | null
          id?: string
          job_name?: string | null
          log_level?: string
          message?: string | null
          metadata?: Json | null
          method?: string
          records_affected?: number | null
          status?: string
          trace_id?: string | null
          triggered_by?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          label: string | null
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          label?: string | null
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          label?: string | null
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      attendance: {
        Row: {
          attendance_date: string
          comments: string | null
          created_at: string
          duty_position: Database["public"]["Enums"]["duty_position"] | null
          id: string
          marked_by: string
          shift_id: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          time_in: string | null
          time_out: string | null
          unit_assignment: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attendance_date: string
          comments?: string | null
          created_at?: string
          duty_position?: Database["public"]["Enums"]["duty_position"] | null
          id?: string
          marked_by: string
          shift_id?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          time_in?: string | null
          time_out?: string | null
          unit_assignment?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attendance_date?: string
          comments?: string | null
          created_at?: string
          duty_position?: Database["public"]["Enums"]["duty_position"] | null
          id?: string
          marked_by?: string
          shift_id?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          time_in?: string | null
          time_out?: string | null
          unit_assignment?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string
          actor_name: string | null
          actor_role: string
          correlation_id: string | null
          created_at: string
          diff_summary: string | null
          entity_id: string
          entity_type: string
          id: string
          new_data: Json | null
          old_data: Json | null
          source: string
        }
        Insert: {
          action: string
          actor_id: string
          actor_name?: string | null
          actor_role: string
          correlation_id?: string | null
          created_at?: string
          diff_summary?: string | null
          entity_id: string
          entity_type: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          source?: string
        }
        Update: {
          action?: string
          actor_id?: string
          actor_name?: string | null
          actor_role?: string
          correlation_id?: string | null
          created_at?: string
          diff_summary?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          source?: string
        }
        Relationships: []
      }
      ba_test_list: {
        Row: {
          created_at: string
          employee_code: string | null
          employee_name: string
          expires_at: string
          fetched_at: string
          id: string
          remarks: string | null
          shift: string | null
          sl_no: number | null
          test_date: string
          test_time: string | null
        }
        Insert: {
          created_at?: string
          employee_code?: string | null
          employee_name: string
          expires_at?: string
          fetched_at?: string
          id?: string
          remarks?: string | null
          shift?: string | null
          sl_no?: number | null
          test_date?: string
          test_time?: string | null
        }
        Update: {
          created_at?: string
          employee_code?: string | null
          employee_name?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          remarks?: string | null
          shift?: string | null
          sl_no?: number | null
          test_date?: string
          test_time?: string | null
        }
        Relationships: []
      }
      ba_tests: {
        Row: {
          completed: boolean
          created_at: string
          generated_by: string
          id: string
          notes: string | null
          selected_users: string[]
          shift_type: Database["public"]["Enums"]["shift_type"]
          team_code: string | null
          test_date: string
          test_time: string
          updated_at: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          generated_by: string
          id?: string
          notes?: string | null
          selected_users: string[]
          shift_type: Database["public"]["Enums"]["shift_type"]
          team_code?: string | null
          test_date: string
          test_time: string
          updated_at?: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          generated_by?: string
          id?: string
          notes?: string | null
          selected_users?: string[]
          shift_type?: Database["public"]["Enums"]["shift_type"]
          team_code?: string | null
          test_date?: string
          test_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      comp_off_ledger: {
        Row: {
          created_at: string
          days_granted: number
          duty_date: string
          employee_id: string
          expiry_date: string
          holiday_id: string
          id: string
          status: string
          used_leave_id: string | null
        }
        Insert: {
          created_at?: string
          days_granted?: number
          duty_date: string
          employee_id: string
          expiry_date: string
          holiday_id: string
          id?: string
          status?: string
          used_leave_id?: string | null
        }
        Update: {
          created_at?: string
          days_granted?: number
          duty_date?: string
          employee_id?: string
          expiry_date?: string
          holiday_id?: string
          id?: string
          status?: string
          used_leave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comp_off_ledger_holiday_id_fkey"
            columns: ["holiday_id"]
            isOneToOne: false
            referencedRelation: "holidays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comp_off_ledger_used_leave_id_fkey"
            columns: ["used_leave_id"]
            isOneToOne: false
            referencedRelation: "leaves"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          employee_id: string | null
          employee_name: string | null
          id: string
          rating: string | null
          reason: string | null
          rule_id: string | null
          score: number | null
          shift: string | null
          snapshot: Json | null
          target_date: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          employee_id?: string | null
          employee_name?: string | null
          id?: string
          rating?: string | null
          reason?: string | null
          rule_id?: string | null
          score?: number | null
          shift?: string | null
          snapshot?: Json | null
          target_date?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          employee_id?: string | null
          employee_name?: string | null
          id?: string
          rating?: string | null
          reason?: string | null
          rule_id?: string | null
          score?: number | null
          shift?: string | null
          snapshot?: Json | null
          target_date?: string | null
        }
        Relationships: []
      }
      compliance_rule_overrides: {
        Row: {
          approved_at: string
          approved_by: string
          created_at: string
          created_by: string | null
          effective_from: string | null
          effective_to: string | null
          enabled: boolean
          id: string
          params: Json | null
          reason: string
          rule_id: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          enabled?: boolean
          id?: string
          params?: Json | null
          reason: string
          rule_id: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          enabled?: boolean
          id?: string
          params?: Json | null
          reason?: string
          rule_id?: string
        }
        Relationships: []
      }
      compliance_rules: {
        Row: {
          blocking: boolean
          created_at: string
          description: string | null
          domain: string
          enabled: boolean
          id: string
          locked: boolean
          params: Json | null
          regulatory_ref: string | null
          sort_order: number
          tier: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          blocking?: boolean
          created_at?: string
          description?: string | null
          domain: string
          enabled?: boolean
          id: string
          locked?: boolean
          params?: Json | null
          regulatory_ref?: string | null
          sort_order?: number
          tier: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          blocking?: boolean
          created_at?: string
          description?: string | null
          domain?: string
          enabled?: boolean
          id?: string
          locked?: boolean
          params?: Json | null
          regulatory_ref?: string | null
          sort_order?: number
          tier?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      cron_job_queue: {
        Row: {
          completed_at: string | null
          created_at: string
          edge_function_name: string
          error_message: string | null
          id: string
          job_name: string
          payload: Json
          priority: number
          queued_at: string
          started_at: string | null
          status: string
          triggered_by: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          edge_function_name: string
          error_message?: string | null
          id?: string
          job_name: string
          payload?: Json
          priority?: number
          queued_at?: string
          started_at?: string | null
          status?: string
          triggered_by?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          edge_function_name?: string
          error_message?: string | null
          id?: string
          job_name?: string
          payload?: Json
          priority?: number
          queued_at?: string
          started_at?: string | null
          status?: string
          triggered_by?: string
        }
        Relationships: []
      }
      duty_exchange_approvals: {
        Row: {
          action_at: string | null
          approver_id: string | null
          approver_role: string
          created_at: string
          id: string
          remarks: string | null
          request_id: string
          sequence_order: number
          status: string
        }
        Insert: {
          action_at?: string | null
          approver_id?: string | null
          approver_role: string
          created_at?: string
          id?: string
          remarks?: string | null
          request_id: string
          sequence_order: number
          status?: string
        }
        Update: {
          action_at?: string | null
          approver_id?: string | null
          approver_role?: string
          created_at?: string
          id?: string
          remarks?: string | null
          request_id?: string
          sequence_order?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "duty_exchange_approvals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "duty_exchanges"
            referencedColumns: ["id"]
          },
        ]
      }
      duty_exchanges: {
        Row: {
          created_at: string
          duty_date: string | null
          exchange_partner_id: string
          exchange_partner_shift_id: string
          id: string
          reason: string
          requesting_user_id: string
          requesting_user_shift_id: string
          status: Database["public"]["Enums"]["exchange_status"]
          supervisor_approved_at: string | null
          supervisor_approved_by: string | null
          supervisor_comments: string | null
          updated_at: string
          wso_approved_at: string | null
          wso_approved_by: string | null
          wso_comments: string | null
        }
        Insert: {
          created_at?: string
          duty_date?: string | null
          exchange_partner_id: string
          exchange_partner_shift_id: string
          id?: string
          reason: string
          requesting_user_id: string
          requesting_user_shift_id: string
          status?: Database["public"]["Enums"]["exchange_status"]
          supervisor_approved_at?: string | null
          supervisor_approved_by?: string | null
          supervisor_comments?: string | null
          updated_at?: string
          wso_approved_at?: string | null
          wso_approved_by?: string | null
          wso_comments?: string | null
        }
        Update: {
          created_at?: string
          duty_date?: string | null
          exchange_partner_id?: string
          exchange_partner_shift_id?: string
          id?: string
          reason?: string
          requesting_user_id?: string
          requesting_user_shift_id?: string
          status?: Database["public"]["Enums"]["exchange_status"]
          supervisor_approved_at?: string | null
          supervisor_approved_by?: string | null
          supervisor_comments?: string | null
          updated_at?: string
          wso_approved_at?: string | null
          wso_approved_by?: string | null
          wso_comments?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "duty_exchanges_exchange_partner_shift_id_fkey"
            columns: ["exchange_partner_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duty_exchanges_requesting_user_shift_id_fkey"
            columns: ["requesting_user_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      duty_rosters: {
        Row: {
          created_at: string
          id: string
          roster_date: string
          shift: string
          team: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          roster_date: string
          shift?: string
          team?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          roster_date?: string
          shift?: string
          team?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      edge_function_errors: {
        Row: {
          created_at: string
          environment: string
          error_message: string
          error_stack: string | null
          fingerprint: string
          function_name: string
          id: string
          metadata: Json | null
          request_body: Json | null
          request_method: string | null
          request_path: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          trace_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          environment?: string
          error_message: string
          error_stack?: string | null
          fingerprint: string
          function_name: string
          id?: string
          metadata?: Json | null
          request_body?: Json | null
          request_method?: string | null
          request_path?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          trace_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          environment?: string
          error_message?: string
          error_stack?: string | null
          fingerprint?: string
          function_name?: string
          id?: string
          metadata?: Json | null
          request_body?: Json | null
          request_method?: string | null
          request_path?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          trace_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      email_logs: {
        Row: {
          created_at: string
          email_to: string
          error_message: string | null
          event_type: string
          id: string
          provider: string
          provider_id: string | null
          queue_id: string | null
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_to: string
          error_message?: string | null
          event_type: string
          id?: string
          provider: string
          provider_id?: string | null
          queue_id?: string | null
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_to?: string
          error_message?: string | null
          event_type?: string
          id?: string
          provider?: string
          provider_id?: string | null
          queue_id?: string | null
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "notification_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_el_records: {
        Row: {
          created_at: string
          emp_id: string
          employee_name: string
          id: string
          leave_from: string
          leave_to: string
          sync_batch_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          emp_id: string
          employee_name: string
          id?: string
          leave_from: string
          leave_to: string
          sync_batch_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          emp_id?: string
          employee_name?: string
          id?: string
          leave_from?: string
          leave_to?: string
          sync_batch_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      employee_leave_dates: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          leave_date: string
          leave_type: string
          remarks: string | null
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          leave_date: string
          leave_type?: string
          remarks?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          leave_date?: string
          leave_type?: string
          remarks?: string | null
        }
        Relationships: []
      }
      employee_leave_records: {
        Row: {
          created_at: string
          duty_code: string
          emp_id: string
          employee_name: string
          event_kind: string
          id: string
          leave_category: string
          leave_date: string
          leave_used_on: string | null
          metadata: Json | null
          raw_date_value: string | null
          raw_event: Json
          raw_leave_used_value: string | null
          raw_shift_value: string | null
          sl_no: number | null
          source: string
          source_event_type: string
          status: string | null
          sync_batch_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          duty_code?: string
          emp_id: string
          employee_name: string
          event_kind?: string
          id?: string
          leave_category: string
          leave_date: string
          leave_used_on?: string | null
          metadata?: Json | null
          raw_date_value?: string | null
          raw_event?: Json
          raw_leave_used_value?: string | null
          raw_shift_value?: string | null
          sl_no?: number | null
          source?: string
          source_event_type?: string
          status?: string | null
          sync_batch_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          duty_code?: string
          emp_id?: string
          employee_name?: string
          event_kind?: string
          id?: string
          leave_category?: string
          leave_date?: string
          leave_used_on?: string | null
          metadata?: Json | null
          raw_date_value?: string | null
          raw_event?: Json
          raw_leave_used_value?: string | null
          raw_shift_value?: string | null
          sl_no?: number | null
          source?: string
          source_event_type?: string
          status?: string | null
          sync_batch_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      employee_licenses: {
        Row: {
          created_at: string
          expiry_date: string | null
          id: string
          issue_date: string | null
          issued_by: string | null
          license_number: string | null
          license_type: Database["public"]["Enums"]["license_type"]
          status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          issued_by?: string | null
          license_number?: string | null
          license_type: Database["public"]["Enums"]["license_type"]
          status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          issued_by?: string | null
          license_number?: string | null
          license_type?: Database["public"]["Enums"]["license_type"]
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      employee_ojt_progress: {
        Row: {
          created_at: string
          deadline_override: string | null
          deadline_override_reason: string | null
          designation: string | null
          emp_id: string
          employee_name: string
          id: string
          is_archived: boolean
          override_note: string | null
          override_performed_days: number | null
          override_performed_hours: number | null
          override_required_days: number | null
          override_required_hours: number | null
          override_start_date: string | null
          override_updated_at: string | null
          override_updated_by: string | null
          profile_linked: boolean
          sheet_marking_date: string | null
          sheet_performed_days: number | null
          sheet_performed_hours: number | null
          sheet_required_days: number | null
          sheet_required_hours: number | null
          sheet_start_date: string | null
          sheet_synced_at: string | null
          sync_batch_id: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deadline_override?: string | null
          deadline_override_reason?: string | null
          designation?: string | null
          emp_id: string
          employee_name: string
          id?: string
          is_archived?: boolean
          override_note?: string | null
          override_performed_days?: number | null
          override_performed_hours?: number | null
          override_required_days?: number | null
          override_required_hours?: number | null
          override_start_date?: string | null
          override_updated_at?: string | null
          override_updated_by?: string | null
          profile_linked?: boolean
          sheet_marking_date?: string | null
          sheet_performed_days?: number | null
          sheet_performed_hours?: number | null
          sheet_required_days?: number | null
          sheet_required_hours?: number | null
          sheet_start_date?: string | null
          sheet_synced_at?: string | null
          sync_batch_id?: string | null
          unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deadline_override?: string | null
          deadline_override_reason?: string | null
          designation?: string | null
          emp_id?: string
          employee_name?: string
          id?: string
          is_archived?: boolean
          override_note?: string | null
          override_performed_days?: number | null
          override_performed_hours?: number | null
          override_required_days?: number | null
          override_required_hours?: number | null
          override_start_date?: string | null
          override_updated_at?: string | null
          override_updated_by?: string | null
          profile_linked?: boolean
          sheet_marking_date?: string | null
          sheet_performed_days?: number | null
          sheet_performed_hours?: number | null
          sheet_required_days?: number | null
          sheet_required_hours?: number | null
          sheet_start_date?: string | null
          sheet_synced_at?: string | null
          sync_batch_id?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      employee_schedules: {
        Row: {
          created_at: string
          duty_code: string
          duty_date: string
          duty_description: string
          employee_code: string
          employee_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duty_code?: string
          duty_date: string
          duty_description?: string
          employee_code: string
          employee_name: string
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duty_code?: string
          duty_date?: string
          duty_description?: string
          employee_code?: string
          employee_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      employee_training_records: {
        Row: {
          atco_master_synced_at: string | null
          completion_dates: Json
          created_at: string
          elpa_endorsed_upto: string | null
          elpa_level: string | null
          elpa_synced_at: string | null
          elpa_valid_upto: string | null
          emp_id: string
          employee_name: string
          examiner: Json
          examiner_validity: Json
          highest_rating: string | null
          id: string
          instructor_validity: Json
          kolkata_joining_date: string | null
          license_number: string | null
          med_endorsed_upto: string | null
          med_history: Json
          med_last_date: string | null
          med_status: string | null
          med_synced_at: string | null
          ojti: Json
          rating_data: Json
          rating_designation: string | null
          rating_summary: Json
          rating_synced_at: string | null
          raw_payload: Json
          source: string
          sync_batch_id: string | null
          trainee_board_scheduled_on: string | null
          trainee_designation: string | null
          trainee_hours_required: number | null
          trainee_hr_grade: string | null
          trainee_preboard_completed_on: string | null
          trainee_preboard_scheduled_on: string | null
          trainee_status: string | null
          trainee_synced_at: string | null
          trainee_unit: string | null
          transferred_out: boolean
          updated_at: string
          without_ratings: Json
        }
        Insert: {
          atco_master_synced_at?: string | null
          completion_dates?: Json
          created_at?: string
          elpa_endorsed_upto?: string | null
          elpa_level?: string | null
          elpa_synced_at?: string | null
          elpa_valid_upto?: string | null
          emp_id: string
          employee_name: string
          examiner?: Json
          examiner_validity?: Json
          highest_rating?: string | null
          id?: string
          instructor_validity?: Json
          kolkata_joining_date?: string | null
          license_number?: string | null
          med_endorsed_upto?: string | null
          med_history?: Json
          med_last_date?: string | null
          med_status?: string | null
          med_synced_at?: string | null
          ojti?: Json
          rating_data?: Json
          rating_designation?: string | null
          rating_summary?: Json
          rating_synced_at?: string | null
          raw_payload?: Json
          source?: string
          sync_batch_id?: string | null
          trainee_board_scheduled_on?: string | null
          trainee_designation?: string | null
          trainee_hours_required?: number | null
          trainee_hr_grade?: string | null
          trainee_preboard_completed_on?: string | null
          trainee_preboard_scheduled_on?: string | null
          trainee_status?: string | null
          trainee_synced_at?: string | null
          trainee_unit?: string | null
          transferred_out?: boolean
          updated_at?: string
          without_ratings?: Json
        }
        Update: {
          atco_master_synced_at?: string | null
          completion_dates?: Json
          created_at?: string
          elpa_endorsed_upto?: string | null
          elpa_level?: string | null
          elpa_synced_at?: string | null
          elpa_valid_upto?: string | null
          emp_id?: string
          employee_name?: string
          examiner?: Json
          examiner_validity?: Json
          highest_rating?: string | null
          id?: string
          instructor_validity?: Json
          kolkata_joining_date?: string | null
          license_number?: string | null
          med_endorsed_upto?: string | null
          med_history?: Json
          med_last_date?: string | null
          med_status?: string | null
          med_synced_at?: string | null
          ojti?: Json
          rating_data?: Json
          rating_designation?: string | null
          rating_summary?: Json
          rating_synced_at?: string | null
          raw_payload?: Json
          source?: string
          sync_batch_id?: string | null
          trainee_board_scheduled_on?: string | null
          trainee_designation?: string | null
          trainee_hours_required?: number | null
          trainee_hr_grade?: string | null
          trainee_preboard_completed_on?: string | null
          trainee_preboard_scheduled_on?: string | null
          trainee_status?: string | null
          trainee_synced_at?: string | null
          trainee_unit?: string | null
          transferred_out?: boolean
          updated_at?: string
          without_ratings?: Json
        }
        Relationships: []
      }
      extra_duties: {
        Row: {
          created_at: string
          duty_type: string
          employee_id: string | null
          id: string
          remarks: string | null
          roster_id: string
        }
        Insert: {
          created_at?: string
          duty_type?: string
          employee_id?: string | null
          id?: string
          remarks?: string | null
          roster_id: string
        }
        Update: {
          created_at?: string
          duty_type?: string
          employee_id?: string | null
          id?: string
          remarks?: string | null
          roster_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extra_duties_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "duty_rosters"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          comp_off_eligible: boolean
          created_at: string
          created_by: string
          holiday_date: string
          id: string
          name: string
          selectable: boolean
          station: string
          type: string
          updated_at: string
          year: number
        }
        Insert: {
          comp_off_eligible?: boolean
          created_at?: string
          created_by: string
          holiday_date: string
          id?: string
          name: string
          selectable?: boolean
          station?: string
          type: string
          updated_at?: string
          year: number
        }
        Update: {
          comp_off_eligible?: boolean
          created_at?: string
          created_by?: string
          holiday_date?: string
          id?: string
          name?: string
          selectable?: boolean
          station?: string
          type?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      leave_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          after: Json | null
          batch_id: string | null
          before: Json | null
          created_at: string
          employee_code: string | null
          employee_name: string | null
          end_date: string | null
          id: string
          leave_request_id: string | null
          leave_type: string | null
          reason: string | null
          start_date: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          after?: Json | null
          batch_id?: string | null
          before?: Json | null
          created_at?: string
          employee_code?: string | null
          employee_name?: string | null
          end_date?: string | null
          id?: string
          leave_request_id?: string | null
          leave_type?: string | null
          reason?: string | null
          start_date?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          after?: Json | null
          batch_id?: string | null
          before?: Json | null
          created_at?: string
          employee_code?: string | null
          employee_name?: string | null
          end_date?: string | null
          id?: string
          leave_request_id?: string | null
          leave_type?: string | null
          reason?: string | null
          start_date?: string | null
        }
        Relationships: []
      }
      leave_backfill_batches: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          entries_count: number
          id: string
          note: string | null
          status: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          entries_count?: number
          id?: string
          note?: string | null
          status?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          entries_count?: number
          id?: string
          note?: string | null
          status?: string
        }
        Relationships: []
      }
      leave_balances: {
        Row: {
          balance: number
          created_at: string
          expiry_date: string | null
          id: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          payload: Json | null
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          balance?: number
          created_at?: string
          expiry_date?: string | null
          id?: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          payload?: Json | null
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          balance?: number
          created_at?: string
          expiry_date?: string | null
          id?: string
          leave_type?: Database["public"]["Enums"]["leave_type"]
          payload?: Json | null
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      leave_balances_cache: {
        Row: {
          emp_id: string
          id: number
          name: string | null
          payload: Json
          status: string | null
          updated_at: string
        }
        Insert: {
          emp_id: string
          id?: number
          name?: string | null
          payload: Json
          status?: string | null
          updated_at?: string
        }
        Update: {
          emp_id?: string
          id?: number
          name?: string | null
          payload?: Json
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      leave_requests: {
        Row: {
          actual_rh_date: string | null
          actual_rh_date_2: string | null
          applied_at: string
          attachment_meta: Json | null
          attachment_path: string | null
          backfill_batch_id: string | null
          ch_comp_off_dates: Json | null
          comp_off_record_ids: Json | null
          created_at: string
          direct_supervisor_approved: boolean
          direct_supervisor_approved_at: string | null
          direct_supervisor_approved_by: string | null
          direct_supervisor_comments: string | null
          employee_id: string
          employee_name: string
          end_date: string
          id: string
          leave_type: string
          origin: string
          reason: string | null
          remarks: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sap_applied: boolean | null
          sap_updated: boolean | null
          start_date: string
          status: string
          superseded_by_id: string | null
          supersedes_id: string | null
          supervisor_approved_at: string | null
          supervisor_approved_by: string | null
          supervisor_comments: string | null
          team: string | null
          total_days: number
          updated_at: string
          wso_approved_at: string | null
          wso_approved_by: string | null
          wso_comments: string | null
        }
        Insert: {
          actual_rh_date?: string | null
          actual_rh_date_2?: string | null
          applied_at?: string
          attachment_meta?: Json | null
          attachment_path?: string | null
          backfill_batch_id?: string | null
          ch_comp_off_dates?: Json | null
          comp_off_record_ids?: Json | null
          created_at?: string
          direct_supervisor_approved?: boolean
          direct_supervisor_approved_at?: string | null
          direct_supervisor_approved_by?: string | null
          direct_supervisor_comments?: string | null
          employee_id: string
          employee_name: string
          end_date: string
          id?: string
          leave_type: string
          origin?: string
          reason?: string | null
          remarks?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sap_applied?: boolean | null
          sap_updated?: boolean | null
          start_date: string
          status?: string
          superseded_by_id?: string | null
          supersedes_id?: string | null
          supervisor_approved_at?: string | null
          supervisor_approved_by?: string | null
          supervisor_comments?: string | null
          team?: string | null
          total_days?: number
          updated_at?: string
          wso_approved_at?: string | null
          wso_approved_by?: string | null
          wso_comments?: string | null
        }
        Update: {
          actual_rh_date?: string | null
          actual_rh_date_2?: string | null
          applied_at?: string
          attachment_meta?: Json | null
          attachment_path?: string | null
          backfill_batch_id?: string | null
          ch_comp_off_dates?: Json | null
          comp_off_record_ids?: Json | null
          created_at?: string
          direct_supervisor_approved?: boolean
          direct_supervisor_approved_at?: string | null
          direct_supervisor_approved_by?: string | null
          direct_supervisor_comments?: string | null
          employee_id?: string
          employee_name?: string
          end_date?: string
          id?: string
          leave_type?: string
          origin?: string
          reason?: string | null
          remarks?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sap_applied?: boolean | null
          sap_updated?: boolean | null
          start_date?: string
          status?: string
          superseded_by_id?: string | null
          supersedes_id?: string | null
          supervisor_approved_at?: string | null
          supervisor_approved_by?: string | null
          supervisor_comments?: string | null
          team?: string | null
          total_days?: number
          updated_at?: string
          wso_approved_at?: string | null
          wso_approved_by?: string | null
          wso_comments?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_schedule_snapshots: {
        Row: {
          created_at: string
          duty_date: string
          employee_id: string
          had_schedule: boolean
          id: string
          leave_request_id: string
          original_duty_code: string | null
          original_duty_description: string | null
          original_employee_code: string | null
          original_employee_name: string | null
          restored_at: string | null
        }
        Insert: {
          created_at?: string
          duty_date: string
          employee_id: string
          had_schedule?: boolean
          id?: string
          leave_request_id: string
          original_duty_code?: string | null
          original_duty_description?: string | null
          original_employee_code?: string | null
          original_employee_name?: string | null
          restored_at?: string | null
        }
        Update: {
          created_at?: string
          duty_date?: string
          employee_id?: string
          had_schedule?: boolean
          id?: string
          leave_request_id?: string
          original_duty_code?: string | null
          original_duty_description?: string | null
          original_employee_code?: string | null
          original_employee_name?: string | null
          restored_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_schedule_snapshots_leave_request_id_fkey"
            columns: ["leave_request_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      leaves: {
        Row: {
          created_at: string
          days_count: number
          end_date: string
          id: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          reason: string
          start_date: string
          status: Database["public"]["Enums"]["leave_status"]
          supervisor_approved_at: string | null
          supervisor_approved_by: string | null
          supervisor_comments: string | null
          updated_at: string
          user_id: string
          wso_approved_at: string | null
          wso_approved_by: string | null
          wso_comments: string | null
        }
        Insert: {
          created_at?: string
          days_count: number
          end_date: string
          id?: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          reason: string
          start_date: string
          status?: Database["public"]["Enums"]["leave_status"]
          supervisor_approved_at?: string | null
          supervisor_approved_by?: string | null
          supervisor_comments?: string | null
          updated_at?: string
          user_id: string
          wso_approved_at?: string | null
          wso_approved_by?: string | null
          wso_comments?: string | null
        }
        Update: {
          created_at?: string
          days_count?: number
          end_date?: string
          id?: string
          leave_type?: Database["public"]["Enums"]["leave_type"]
          reason?: string
          start_date?: string
          status?: Database["public"]["Enums"]["leave_status"]
          supervisor_approved_at?: string | null
          supervisor_approved_by?: string | null
          supervisor_comments?: string | null
          updated_at?: string
          user_id?: string
          wso_approved_at?: string | null
          wso_approved_by?: string | null
          wso_comments?: string | null
        }
        Relationships: []
      }
      medical_certificates: {
        Row: {
          created_at: string
          employee_id: string
          expiry_date: string | null
          id: string
          issue_date: string | null
          medical_class: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          medical_class?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          medical_class?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          email: boolean
          event_type: string
          id: string
          in_app: boolean
          push: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: boolean
          event_type: string
          id?: string
          in_app?: boolean
          push?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: boolean
          event_type?: string
          id?: string
          in_app?: boolean
          push?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_queue: {
        Row: {
          attempts: number
          channel: string
          content_hash: string | null
          created_at: string
          event_type: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          payload: Json
          priority: number
          processed_at: string | null
          provider: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number
          channel: string
          content_hash?: string | null
          created_at?: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload?: Json
          priority?: number
          processed_at?: string | null
          provider?: string | null
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number
          channel?: string
          content_hash?: string | null
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload?: Json
          priority?: number
          processed_at?: string | null
          provider?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          category: string | null
          created_at: string
          id: string
          metadata: Json
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      position_requirements: {
        Row: {
          id: string
          position: string
          required_rating: string
        }
        Insert: {
          id?: string
          position: string
          required_rating: string
        }
        Update: {
          id?: string
          position?: string
          required_rating?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          alternate_email: string | null
          created_at: string
          current_shift: Database["public"]["Enums"]["shift_type"]
          date_of_birth: string | null
          date_of_joining: string | null
          department: string | null
          designation: string | null
          email: string
          emergency_contact: string | null
          employee_id: string
          full_name: string
          gender: string | null
          id: string
          initials: string | null
          is_hidden: boolean
          mobile: string | null
          photo_url: string | null
          profile_details: Json | null
          station: string | null
          stream: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          alternate_email?: string | null
          created_at?: string
          current_shift?: Database["public"]["Enums"]["shift_type"]
          date_of_birth?: string | null
          date_of_joining?: string | null
          department?: string | null
          designation?: string | null
          email: string
          emergency_contact?: string | null
          employee_id: string
          full_name: string
          gender?: string | null
          id: string
          initials?: string | null
          is_hidden?: boolean
          mobile?: string | null
          photo_url?: string | null
          profile_details?: Json | null
          station?: string | null
          stream?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          alternate_email?: string | null
          created_at?: string
          current_shift?: Database["public"]["Enums"]["shift_type"]
          date_of_birth?: string | null
          date_of_joining?: string | null
          department?: string | null
          designation?: string | null
          email?: string
          emergency_contact?: string | null
          employee_id?: string
          full_name?: string
          gender?: string | null
          id?: string
          initials?: string | null
          is_hidden?: boolean
          mobile?: string | null
          photo_url?: string | null
          profile_details?: Json | null
          station?: string | null
          stream?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      roster_assignments: {
        Row: {
          created_at: string
          department: string
          employee_id: string | null
          id: string
          position_label: string | null
          position_name: string
          remark: string | null
          roster_id: string
          section_type: string
        }
        Insert: {
          created_at?: string
          department: string
          employee_id?: string | null
          id?: string
          position_label?: string | null
          position_name: string
          remark?: string | null
          roster_id: string
          section_type?: string
        }
        Update: {
          created_at?: string
          department?: string
          employee_id?: string | null
          id?: string
          position_label?: string | null
          position_name?: string
          remark?: string | null
          roster_id?: string
          section_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_assignments_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "duty_rosters"
            referencedColumns: ["id"]
          },
        ]
      }
      rosters: {
        Row: {
          created_at: string | null
          date: string
          employee_name: string
          id: string
          position: string
          row_index: number | null
          shift: string
          team: string
          unit: string
        }
        Insert: {
          created_at?: string | null
          date: string
          employee_name: string
          id?: string
          position: string
          row_index?: number | null
          shift: string
          team: string
          unit: string
        }
        Update: {
          created_at?: string | null
          date?: string
          employee_name?: string
          id?: string
          position?: string
          row_index?: number | null
          shift?: string
          team?: string
          unit?: string
        }
        Relationships: []
      }
      sarc_runs: {
        Row: {
          created_at: string
          employee_count: number
          id: string
          in_recovery_count: number
          issued_at: string
          issued_by: string | null
          issued_by_name: string | null
          note: string | null
          period_end: string
          period_start: string
          rows: Json
          title: string
        }
        Insert: {
          created_at?: string
          employee_count?: number
          id?: string
          in_recovery_count?: number
          issued_at?: string
          issued_by?: string | null
          issued_by_name?: string | null
          note?: string | null
          period_end: string
          period_start: string
          rows?: Json
          title: string
        }
        Update: {
          created_at?: string
          employee_count?: number
          id?: string
          in_recovery_count?: number
          issued_at?: string
          issued_by?: string | null
          issued_by_name?: string | null
          note?: string | null
          period_end?: string
          period_start?: string
          rows?: Json
          title?: string
        }
        Relationships: []
      }
      sheet_sync_config: {
        Row: {
          direction: string
          domain: string
          export_url: string | null
          import_url: string | null
          last_diff_count: number | null
          last_export_at: string | null
          last_export_rows: number | null
          last_export_status: string | null
          notes: string | null
          sheet_locked: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          direction?: string
          domain: string
          export_url?: string | null
          import_url?: string | null
          last_diff_count?: number | null
          last_export_at?: string | null
          last_export_rows?: number | null
          last_export_status?: string | null
          notes?: string | null
          sheet_locked?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          direction?: string
          domain?: string
          export_url?: string | null
          import_url?: string | null
          last_diff_count?: number | null
          last_export_at?: string | null
          last_export_rows?: number | null
          last_export_status?: string | null
          notes?: string | null
          sheet_locked?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      shifts: {
        Row: {
          created_at: string
          created_by: string | null
          duty_position: Database["public"]["Enums"]["duty_position"] | null
          duty_type: Database["public"]["Enums"]["duty_type"]
          id: string
          is_ope: boolean
          notes: string | null
          schedule_status: string
          shift_date: string
          shift_type: Database["public"]["Enums"]["shift_type"]
          updated_at: string
          user_id: string
          wso_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duty_position?: Database["public"]["Enums"]["duty_position"] | null
          duty_type: Database["public"]["Enums"]["duty_type"]
          id?: string
          is_ope?: boolean
          notes?: string | null
          schedule_status?: string
          shift_date: string
          shift_type: Database["public"]["Enums"]["shift_type"]
          updated_at?: string
          user_id: string
          wso_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duty_position?: Database["public"]["Enums"]["duty_position"] | null
          duty_type?: Database["public"]["Enums"]["duty_type"]
          id?: string
          is_ope?: boolean
          notes?: string | null
          schedule_status?: string
          shift_date?: string
          shift_type?: Database["public"]["Enums"]["shift_type"]
          updated_at?: string
          user_id?: string
          wso_id?: string | null
        }
        Relationships: []
      }
      sync_jobs: {
        Row: {
          created_at: string
          cron_schedule: string
          edge_function_name: string
          id: string
          is_active: boolean
          job_name: string
          last_run_at: string | null
          last_run_status: string | null
          payload: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          cron_schedule: string
          edge_function_name: string
          id?: string
          is_active?: boolean
          job_name: string
          last_run_at?: string | null
          last_run_status?: string | null
          payload?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          cron_schedule?: string
          edge_function_name?: string
          id?: string
          is_active?: boolean
          job_name?: string
          last_run_at?: string | null
          last_run_status?: string | null
          payload?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      unit_endorsements: {
        Row: {
          airport: string
          created_at: string
          employee_id: string
          expiry_date: string | null
          id: string
          issue_date: string | null
          position: string
          status: string
          updated_at: string
        }
        Insert: {
          airport?: string
          created_at?: string
          employee_id: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          position: string
          status?: string
          updated_at?: string
        }
        Update: {
          airport?: string
          created_at?: string
          employee_id?: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          position?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      working_hours_cache: {
        Row: {
          avg_per_day: number | null
          computed_at: string
          current_shift: string | null
          daily_schedule: Json | null
          days_worked: number | null
          employee_code: string
          employee_name: string | null
          id: string
          month: string
          peak_15d_breached: boolean | null
          peak_15d_hours: number | null
          peak_30d_breached: boolean | null
          peak_30d_hours: number | null
          peak_7d_breached: boolean | null
          peak_7d_hours: number | null
          total_hours: number | null
        }
        Insert: {
          avg_per_day?: number | null
          computed_at?: string
          current_shift?: string | null
          daily_schedule?: Json | null
          days_worked?: number | null
          employee_code: string
          employee_name?: string | null
          id?: string
          month: string
          peak_15d_breached?: boolean | null
          peak_15d_hours?: number | null
          peak_30d_breached?: boolean | null
          peak_30d_hours?: number | null
          peak_7d_breached?: boolean | null
          peak_7d_hours?: number | null
          total_hours?: number | null
        }
        Update: {
          avg_per_day?: number | null
          computed_at?: string
          current_shift?: string | null
          daily_schedule?: Json | null
          days_worked?: number | null
          employee_code?: string
          employee_name?: string | null
          id?: string
          month?: string
          peak_15d_breached?: boolean | null
          peak_15d_hours?: number | null
          peak_30d_breached?: boolean | null
          peak_30d_hours?: number | null
          peak_7d_breached?: boolean | null
          peak_7d_hours?: number | null
          total_hours?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      monthly_roster_summary: {
        Row: {
          current_shift: Database["public"]["Enums"]["shift_type"] | null
          designation: string | null
          duty_code: string | null
          duty_date: string | null
          duty_description: string | null
          emp_id: string | null
          employee_code: string | null
          full_name: string | null
          roster_month: string | null
          user_id: string | null
        }
        Relationships: []
      }
      v_leave_approval_metrics: {
        Row: {
          approved: number | null
          avg_supervisor_hours: number | null
          avg_total_hours: number | null
          avg_wso_hours: number | null
          cancelled: number | null
          leave_type: string | null
          month: string | null
          p95_total_hours: number | null
          pending: number | null
          rejected: number | null
          total_requests: number | null
        }
        Relationships: []
      }
      v_ojt_progress: {
        Row: {
          band: string | null
          days_left: number | null
          days_requirement_met: boolean | null
          deadline: string | null
          deadline_is_overridden: boolean | null
          deadline_override: string | null
          deadline_override_reason: string | null
          designation: string | null
          emp_id: string | null
          employee_name: string | null
          hours_left: number | null
          id: string | null
          is_archived: boolean | null
          marking_date: string | null
          not_started: boolean | null
          override_is_newer: boolean | null
          override_note: string | null
          override_performed_days: number | null
          override_performed_hours: number | null
          override_required_days: number | null
          override_required_hours: number | null
          override_start_date: string | null
          override_updated_at: string | null
          override_updated_by: string | null
          performed_days: number | null
          performed_hours: number | null
          profile_linked: boolean | null
          ratio: number | null
          required_days: number | null
          required_hours: number | null
          required_months: number | null
          requires_gm_extension: boolean | null
          sheet_performed_days: number | null
          sheet_performed_hours: number | null
          sheet_required_days: number | null
          sheet_required_hours: number | null
          sheet_start_date: string | null
          sheet_synced_at: string | null
          start_date: string | null
          start_date_source: string | null
          unit: string | null
        }
        Relationships: []
      }
      v_ojt_progress_resolved: {
        Row: {
          deadline_override: string | null
          deadline_override_reason: string | null
          designation: string | null
          emp_id: string | null
          employee_name: string | null
          id: string | null
          is_archived: boolean | null
          marking_date: string | null
          override_is_newer: boolean | null
          override_note: string | null
          override_performed_days: number | null
          override_performed_hours: number | null
          override_required_days: number | null
          override_required_hours: number | null
          override_start_date: string | null
          override_updated_at: string | null
          override_updated_by: string | null
          performed_days: number | null
          performed_hours: number | null
          profile_linked: boolean | null
          required_days: number | null
          required_hours: number | null
          sheet_performed_days: number | null
          sheet_performed_hours: number | null
          sheet_required_days: number | null
          sheet_required_hours: number | null
          sheet_start_date: string | null
          sheet_synced_at: string | null
          start_date: string | null
          start_date_source: string | null
          unit: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      allocate_comp_off_for_leave: {
        Args: {
          p_employee_name: string
          p_end_date: string
          p_leave_dates: string[]
          p_leave_request_id: string
          p_record_ids: string[]
          p_start_date: string
        }
        Returns: Json
      }
      amend_leave_request: {
        Args: {
          p_actual_rh_date?: string
          p_allow_used_comp_off?: boolean
          p_audit_reason?: string
          p_ch_comp_off_dates?: Json
          p_comp_off_record_ids?: string[]
          p_end_date: string
          p_leave_request_id: string
          p_leave_type: string
          p_reason?: string
          p_start_date: string
          p_total_days: number
        }
        Returns: Json
      }
      apply_leave_to_schedule: {
        Args: {
          p_employee_code: string
          p_employee_id: string
          p_employee_name: string
          p_end_date: string
          p_leave_request_id: string
          p_leave_type?: string
          p_start_date: string
        }
        Returns: Json
      }
      approve_automation_suggestion: {
        Args: {
          p_notes?: string
          p_performed_by: string
          p_suggestion_id: string
        }
        Returns: Json
      }
      backfill_leave_entry: {
        Args: {
          p_actual_rh_date?: string
          p_allow_used_comp_off?: boolean
          p_applied_at?: string
          p_audit_reason?: string
          p_batch_id?: string
          p_ch_comp_off_dates?: Json
          p_comp_off_record_ids?: string[]
          p_employee_code: string
          p_end_date: string
          p_leave_type: string
          p_reason?: string
          p_start_date: string
          p_total_days: number
        }
        Returns: Json
      }
      can_manage_leave_backfill: { Args: never; Returns: boolean }
      claim_next_queue_job: {
        Args: never
        Returns: {
          completed_at: string | null
          created_at: string
          edge_function_name: string
          error_message: string | null
          id: string
          job_name: string
          payload: Json
          priority: number
          queued_at: string
          started_at: string | null
          status: string
          triggered_by: string
        }
        SetofOptions: {
          from: "*"
          to: "cron_job_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cleanup_stale_queue_jobs: {
        Args: { p_timeout_minutes?: number }
        Returns: number
      }
      clear_backfilled_leave_records: {
        Args: { p_leave_request_id: string }
        Returns: Json
      }
      clear_comp_off_for_leave: {
        Args: { p_employee_code: string; p_leave_request_id: string }
        Returns: Json
      }
      create_duty_exchange_request: {
        Args: {
          p_duty_date: string
          p_partner_id: string
          p_partner_shift_id: string
          p_reason: string
          p_requester_id: string
          p_requester_shift_id: string
        }
        Returns: string
      }
      current_user_emp_id: { Args: never; Returns: string }
      current_user_roles: { Args: never; Returns: string[] }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      dead_letter_exhausted_jobs: { Args: never; Returns: number }
      deduct_leave_balance: {
        Args: {
          p_days: number
          p_leave_type: string
          p_user_id: string
          p_year: number
        }
        Returns: undefined
      }
      execute_duty_swap: { Args: { p_request_id: string }; Returns: undefined }
      get_cron_job_health: {
        Args: never
        Returns: {
          cron_schedule: string
          edge_function_name: string
          health_status: string
          is_active: boolean
          is_registered: boolean
          job_name: string
          last_completed_at: string
          last_error: string
          last_queue_status: string
          last_queued_at: string
          last_run_at: string
          last_run_status: string
        }[]
      }
      get_exchange_approvals: {
        Args: { p_request_id: string }
        Returns: {
          action_at: string
          approver_id: string
          approver_name: string
          approver_role: string
          id: string
          remarks: string
          request_id: string
          sequence_order: number
          status: string
        }[]
      }
      get_my_ojt_progress: {
        Args: never
        Returns: {
          band: string
          days_left: number
          days_requirement_met: boolean
          deadline: string
          designation: string
          emp_id: string
          employee_name: string
          hours_left: number
          marking_date: string
          not_started: boolean
          performed_days: number
          performed_hours: number
          ratio: number
          required_days: number
          required_hours: number
          required_months: number
          requires_gm_extension: boolean
          sheet_synced_at: string
          start_date: string
          unit: string
        }[]
      }
      get_ojt_progress_records: {
        Args: never
        Returns: {
          band: string
          current_station: string
          days_left: number
          days_requirement_met: boolean
          deadline: string
          deadline_is_overridden: boolean
          designation: string
          emp_id: string
          employee_name: string
          highest_rating: string
          hours_left: number
          marking_date: string
          not_started: boolean
          override_note: string
          override_performed_days: number
          override_performed_hours: number
          override_required_days: number
          override_required_hours: number
          override_start_date: string
          override_updated_at: string
          override_updated_by_name: string
          performed_days: number
          performed_hours: number
          profile_linked: boolean
          ratio: number
          required_days: number
          required_hours: number
          required_months: number
          requires_gm_extension: boolean
          sheet_performed_days: number
          sheet_performed_hours: number
          sheet_required_days: number
          sheet_required_hours: number
          sheet_start_date: string
          sheet_synced_at: string
          start_date: string
          start_date_source: string
          trainee_status: string
          trainee_status_date: string
          unit: string
        }[]
      }
      get_supervisor_trainee_records: {
        Args: never
        Returns: {
          board_scheduled_on: string
          current_station: string
          designation: string
          emp_id: string
          highest_rating: string
          hours_required: number
          name: string
          ojt_band: string
          ojt_cycle_count: number
          ojt_days_left: number
          ojt_deadline: string
          ojt_hours_left: number
          ojt_ratio: number
          ojt_requires_gm_extension: boolean
          ojt_start_date: string
          ojt_unit: string
          preboard_completed_on: string
          preboard_scheduled_on: string
          source: string
          status: string
          unit: string
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_working_hours_summary: {
        Args: { p_month: string }
        Returns: {
          avg_per_day: number
          current_shift: string
          daily_schedule: Json
          days_worked: number
          employee_code: string
          employee_name: string
          peak_15d_breached: boolean
          peak_15d_hours: number
          peak_30d_breached: boolean
          peak_30d_hours: number
          peak_7d_breached: boolean
          peak_7d_hours: number
          total_hours: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_leave_duty_code: { Args: { p_duty_code: string }; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      log_audit_event: {
        Args: {
          p_action: string
          p_correlation_id?: string
          p_diff_summary?: string
          p_entity_id: string
          p_entity_type: string
          p_new_data?: Json
          p_old_data?: Json
          p_source?: string
        }
        Returns: string
      }
      manage_cron_job: {
        Args: {
          p_action: string
          p_cron_schedule?: string
          p_edge_function?: string
          p_job_name: string
          p_payload?: Json
        }
        Returns: Json
      }
      ojt_today: { Args: never; Returns: string }
      process_exchange_approval: {
        Args: {
          p_action: string
          p_approver_id: string
          p_remarks?: string
          p_request_id: string
        }
        Returns: Json
      }
      purge_old_data: {
        Args: {
          p_api_log_days?: number
          p_cron_queue_days?: number
          p_email_log_days?: number
          p_error_days?: number
          p_notification_days?: number
          p_wh_cache_keep_month?: number
        }
        Returns: Json
      }
      recompute_leave_balance: {
        Args: { p_dry_run?: boolean; p_user_id: string; p_year: number }
        Returns: Json
      }
      recover_stale_notification_jobs: { Args: never; Returns: number }
      refresh_roster_summary: { Args: never; Returns: undefined }
      refresh_working_hours_cache: { Args: { p_month: string }; Returns: Json }
      reject_automation_suggestion: {
        Args: {
          p_notes?: string
          p_performed_by: string
          p_suggestion_id: string
        }
        Returns: Json
      }
      resolve_leave_sheet_conflict: {
        Args: { p_reason?: string; p_record_id: string; p_resolution: string }
        Returns: Json
      }
      restore_leave_balance: {
        Args: {
          p_days: number
          p_leave_type: string
          p_user_id: string
          p_year: number
        }
        Returns: undefined
      }
      restore_schedule_after_cancellation: {
        Args: { p_employee_id: string; p_leave_request_id: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      try_parse_date: { Args: { p_value: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "supervisor" | "wso" | "employee"
      attendance_status: "present" | "absent" | "late" | "on_leave"
      duty_position: "RDR" | "APP" | "PLR" | "ADC" | "ALPHA" | "OCC"
      duty_type: "M" | "A" | "N" | "NO" | "CO" | "OFF" | "OPE"
      exchange_status:
        | "pending_wso"
        | "pending_supervisor"
        | "approved"
        | "rejected"
        | "cancelled"
        | "pending_partner"
        | "completed"
      holiday_category: "closed" | "reserved" | "national"
      leave_status:
        | "pending_wso"
        | "pending_supervisor"
        | "approved"
        | "rejected"
      leave_type: "cl" | "rh" | "el" | "hpl" | "comp_off"
      license_type: "rdr" | "app" | "plr" | "adc" | "alpha" | "occ"
      shift_type: "general" | "a" | "b" | "c" | "d" | "e" | "g"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "supervisor", "wso", "employee"],
      attendance_status: ["present", "absent", "late", "on_leave"],
      duty_position: ["RDR", "APP", "PLR", "ADC", "ALPHA", "OCC"],
      duty_type: ["M", "A", "N", "NO", "CO", "OFF", "OPE"],
      exchange_status: [
        "pending_wso",
        "pending_supervisor",
        "approved",
        "rejected",
        "cancelled",
        "pending_partner",
        "completed",
      ],
      holiday_category: ["closed", "reserved", "national"],
      leave_status: [
        "pending_wso",
        "pending_supervisor",
        "approved",
        "rejected",
      ],
      leave_type: ["cl", "rh", "el", "hpl", "comp_off"],
      license_type: ["rdr", "app", "plr", "adc", "alpha", "occ"],
      shift_type: ["general", "a", "b", "c", "d", "e", "g"],
    },
  },
} as const
