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
      ba_tests: {
        Row: {
          completed: boolean
          created_at: string
          generated_by: string
          id: string
          notes: string | null
          selected_users: string[]
          shift_type: Database["public"]["Enums"]["shift_type"]
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
          test_date?: string
          test_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      duty_exchanges: {
        Row: {
          created_at: string
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
      employee_licenses: {
        Row: {
          created_at: string
          expiry_date: string | null
          id: string
          issue_date: string | null
          license_type: Database["public"]["Enums"]["license_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          license_type: Database["public"]["Enums"]["license_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          license_type?: Database["public"]["Enums"]["license_type"]
          user_id?: string
        }
        Relationships: []
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
          type: Database["public"]["Enums"]["holiday_type"]
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
          type: Database["public"]["Enums"]["holiday_type"]
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
          type?: Database["public"]["Enums"]["holiday_type"]
          year?: number
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
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
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
      profiles: {
        Row: {
          address: string | null
          alternate_email: string | null
          created_at: string
          current_shift: Database["public"]["Enums"]["shift_type"]
          designation: string | null
          email: string
          emergency_contact: string | null
          employee_id: string
          full_name: string
          gender: string | null
          id: string
          initials: string | null
          mobile: string | null
          photo_url: string | null
          stream: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          alternate_email?: string | null
          created_at?: string
          current_shift?: Database["public"]["Enums"]["shift_type"]
          designation?: string | null
          email: string
          emergency_contact?: string | null
          employee_id: string
          full_name: string
          gender?: string | null
          id: string
          initials?: string | null
          mobile?: string | null
          photo_url?: string | null
          stream?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          alternate_email?: string | null
          created_at?: string
          current_shift?: Database["public"]["Enums"]["shift_type"]
          designation?: string | null
          email?: string
          emergency_contact?: string | null
          employee_id?: string
          full_name?: string
          gender?: string | null
          id?: string
          initials?: string | null
          mobile?: string | null
          photo_url?: string | null
          stream?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rosters: {
        Row: {
          created_at: string | null
          date: string
          employee_name: string
          id: string
          position: string
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
          shift?: string
          team?: string
          unit?: string
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
          shift_date: string
          shift_type: Database["public"]["Enums"]["shift_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duty_position?: Database["public"]["Enums"]["duty_position"] | null
          duty_type: Database["public"]["Enums"]["duty_type"]
          id?: string
          is_ope?: boolean
          notes?: string | null
          shift_date: string
          shift_type: Database["public"]["Enums"]["shift_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duty_position?: Database["public"]["Enums"]["duty_position"] | null
          duty_type?: Database["public"]["Enums"]["duty_type"]
          id?: string
          is_ope?: boolean
          notes?: string | null
          shift_date?: string
          shift_type?: Database["public"]["Enums"]["shift_type"]
          updated_at?: string
          user_id?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
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
      holiday_type: "NH" | "RH" | "CH"
      leave_status:
      | "pending_wso"
      | "pending_supervisor"
      | "approved"
      | "rejected"
      leave_type: "cl" | "rh" | "el" | "hpl" | "comp_off"
      license_type: "rdr" | "app" | "plr" | "adc" | "alpha" | "occ"
      shift_type: "general" | "a" | "b" | "c" | "d" | "e"
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
      ],
      holiday_type: ["NH", "RH", "CH"],
      leave_status: [
        "pending_wso",
        "pending_supervisor",
        "approved",
        "rejected",
      ],
      leave_type: ["cl", "rh", "el", "hpl", "comp_off"],
      license_type: ["rdr", "app", "plr", "adc", "alpha", "occ"],
      shift_type: ["general", "a", "b", "c", "d", "e"],
    },
  },
} as const
