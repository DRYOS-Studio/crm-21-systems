export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_configs: {
        Row: {
          business_context: string | null
          company_name: string | null
          created_at: string
          enabled: boolean
          followup_inactivity_minutes: number | null
          followup_max_per_conversation: number
          groq_api_key: string | null
          groq_model: string
          outreach_daily_cap: number
          outreach_enabled: boolean
          outreach_instance_id: string | null
          outreach_last_tick_at: string | null
          outreach_paused_reason: string | null
          outreach_ramp_start: string | null
          outreach_saturday_morning: boolean
          outreach_weekdays_only: boolean
          owner_notify_phone: string | null
          system_prompt: string
          updated_at: string
          user_id: string
        }
        Insert: {
          business_context?: string | null
          company_name?: string | null
          created_at?: string
          enabled?: boolean
          followup_inactivity_minutes?: number | null
          followup_max_per_conversation?: number
          groq_api_key?: string | null
          groq_model?: string
          outreach_daily_cap?: number
          outreach_enabled?: boolean
          outreach_instance_id?: string | null
          outreach_last_tick_at?: string | null
          outreach_paused_reason?: string | null
          outreach_ramp_start?: string | null
          outreach_saturday_morning?: boolean
          outreach_weekdays_only?: boolean
          owner_notify_phone?: string | null
          system_prompt?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          business_context?: string | null
          company_name?: string | null
          created_at?: string
          enabled?: boolean
          followup_inactivity_minutes?: number | null
          followup_max_per_conversation?: number
          groq_api_key?: string | null
          groq_model?: string
          outreach_daily_cap?: number
          outreach_enabled?: boolean
          outreach_instance_id?: string | null
          outreach_last_tick_at?: string | null
          outreach_paused_reason?: string | null
          outreach_ramp_start?: string | null
          outreach_saturday_morning?: boolean
          outreach_weekdays_only?: boolean
          owner_notify_phone?: string | null
          system_prompt?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_configs_outreach_instance_id_fkey"
            columns: ["outreach_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          ai_enabled: boolean
          ai_stage: string
          ai_summary: string | null
          auto_followup_count: number
          confirmacoes: number
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          human_takeover_at: string | null
          id: string
          inactivity_followup_at: string | null
          instance_id: string | null
          last_message_at: string
          optout: boolean
          optout_motivo: string | null
          qualification: Json
          stage_id: string | null
          updated_at: string
          user_id: string
          wa_phone: string | null
        }
        Insert: {
          ai_enabled?: boolean
          ai_stage?: string
          ai_summary?: string | null
          auto_followup_count?: number
          confirmacoes?: number
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          human_takeover_at?: string | null
          id?: string
          inactivity_followup_at?: string | null
          instance_id?: string | null
          last_message_at?: string
          optout?: boolean
          optout_motivo?: string | null
          qualification?: Json
          stage_id?: string | null
          updated_at?: string
          user_id: string
          wa_phone?: string | null
        }
        Update: {
          ai_enabled?: boolean
          ai_stage?: string
          ai_summary?: string | null
          auto_followup_count?: number
          confirmacoes?: number
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          human_takeover_at?: string | null
          id?: string
          inactivity_followup_at?: string | null
          instance_id?: string | null
          last_message_at?: string
          optout?: boolean
          optout_motivo?: string | null
          qualification?: Json
          stage_id?: string | null
          updated_at?: string
          user_id?: string
          wa_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      followups: {
        Row: {
          conversation_id: string
          created_at: string
          error: string | null
          id: string
          kind: string
          send_at: string
          sent_at: string | null
          status: string
          text_override: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          send_at: string
          sent_at?: string | null
          status?: string
          text_override?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          send_at?: string
          sent_at?: string | null
          status?: string
          text_override?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "followups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          content: string
          created_at: string
          id: string
          title: string | null
          topic: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          title?: string | null
          topic: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          title?: string | null
          topic?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          address: string | null
          category: string | null
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          google_url: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string | null
          phone: string | null
          phone_normalized: string | null
          rating: number | null
          raw: Json | null
          reviews_count: number | null
          search_id: string
          state: string | null
          user_id: string
          website: string | null
        }
        Insert: {
          address?: string | null
          category?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          google_url?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          rating?: number | null
          raw?: Json | null
          reviews_count?: number | null
          search_id: string
          state?: string | null
          user_id: string
          website?: string | null
        }
        Update: {
          address?: string | null
          category?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          google_url?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          rating?: number | null
          raw?: Json | null
          reviews_count?: number | null
          search_id?: string
          state?: string | null
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "searches"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          direction: string
          external_id: string | null
          id: string
          processed_at: string | null
          sender: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          direction: string
          external_id?: string | null
          id?: string
          processed_at?: string | null
          sender: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          processed_at?: string | null
          sender?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_openers: {
        Row: {
          active: boolean
          id: string
          text: string
          user_id: string
        }
        Insert: {
          active?: boolean
          id?: string
          text: string
          user_id: string
        }
        Update: {
          active?: boolean
          id?: string
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      outreach_sends: {
        Row: {
          cadencia_aplicada: boolean
          id: string
          prospect_id: string
          reserved_at: string
          sent_at: string | null
          status: string
          toque: number
          user_id: string
        }
        Insert: {
          cadencia_aplicada?: boolean
          id?: string
          prospect_id: string
          reserved_at?: string
          sent_at?: string | null
          status: string
          toque: number
          user_id: string
        }
        Update: {
          cadencia_aplicada?: boolean
          id?: string
          prospect_id?: string
          reserved_at?: string
          sent_at?: string | null
          status?: string
          toque?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_sends_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approved: boolean
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          onboarding_completed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      prospects: {
        Row: {
          city: string | null
          company: string | null
          conversation_id: string | null
          created_at: string
          estado: string
          extra: Json
          id: string
          name: string | null
          optout: boolean
          origem: string | null
          phone: string
          proximo_toque: string | null
          tentativas: number
          ultima_falha_em: string | null
          ultima_falha_motivo: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          city?: string | null
          company?: string | null
          conversation_id?: string | null
          created_at?: string
          estado?: string
          extra?: Json
          id?: string
          name?: string | null
          optout?: boolean
          origem?: string | null
          phone: string
          proximo_toque?: string | null
          tentativas?: number
          ultima_falha_em?: string | null
          ultima_falha_motivo?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string | null
          company?: string | null
          conversation_id?: string | null
          created_at?: string
          estado?: string
          extra?: Json
          id?: string
          name?: string | null
          optout?: boolean
          origem?: string | null
          phone?: string
          proximo_toque?: string | null
          tentativas?: number
          ultima_falha_em?: string | null
          ultima_falha_motivo?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospects_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      searches: {
        Row: {
          apify_run_id: string | null
          cost_credits: number | null
          created_at: string
          duplicates_skipped: number
          error_message: string | null
          filters: Json
          id: string
          location: string | null
          max_results: number
          niche: string | null
          parent_search_id: string | null
          results_count: number
          search_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          apify_run_id?: string | null
          cost_credits?: number | null
          created_at?: string
          duplicates_skipped?: number
          error_message?: string | null
          filters?: Json
          id?: string
          location?: string | null
          max_results?: number
          niche?: string | null
          parent_search_id?: string | null
          results_count?: number
          search_type?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          apify_run_id?: string | null
          cost_credits?: number | null
          created_at?: string
          duplicates_skipped?: number
          error_message?: string | null
          filters?: Json
          id?: string
          location?: string | null
          max_results?: number
          niche?: string | null
          parent_search_id?: string | null
          results_count?: number
          search_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "searches_parent_search_id_fkey"
            columns: ["parent_search_id"]
            isOneToOne: false
            referencedRelation: "searches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          apify_token: string | null
          apify_validated_at: string | null
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          apify_token?: string | null
          apify_validated_at?: string | null
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          apify_token?: string | null
          apify_validated_at?: string | null
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_instances: {
        Row: {
          created_at: string
          id: string
          instance_token: string | null
          last_disconnected_at: string | null
          name: string
          phone: string | null
          profile_name: string | null
          server_url: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          instance_token?: string | null
          last_disconnected_at?: string | null
          name: string
          phone?: string | null
          profile_name?: string | null
          server_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          instance_token?: string | null
          last_disconnected_at?: string | null
          name?: string
          phone?: string | null
          profile_name?: string | null
          server_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      brain_bump_confirmacoes: {
        Args: { p_conv: string; p_delta: number; p_user: string }
        Returns: number
      }
      brain_claim_inbound: {
        Args: { p_conv: string; p_user: string }
        Returns: {
          content: string
          conversation_id: string
          created_at: string
          direction: string
          external_id: string | null
          id: string
          processed_at: string | null
          sender: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      brain_commit_turn: {
        Args: {
          p_conv: string
          p_desligar: boolean
          p_motivo: string
          p_optout: boolean
          p_qualification_delta: Json
          p_stage: string
          p_summary: string
          p_user: string
        }
        Returns: {
          ai_enabled: boolean
          flipped_off: boolean
          flipped_optout: boolean
          optout: boolean
        }[]
      }
      canon_phone: { Args: { p_phone: string }; Returns: string }
      canon_phone_input: { Args: { p_phone: string }; Returns: string }
      canon_phone_input_batch: {
        Args: { p_phones: string[] }
        Returns: string[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      my_webhook_secret: { Args: { p_instance: string }; Returns: string }
      outreach_day_stats: {
        Args: { p_user: string }
        Returns: {
          enviados: number
          responderam: number
        }[]
      }
      outreach_mark_sent: {
        Args: {
          p_proximo_toque: string
          p_send: string
          p_tentativas: number
          p_user: string
        }
        Returns: undefined
      }
      outreach_mark_uncertain: {
        Args: {
          p_proximo_toque: string
          p_send: string
          p_tentativas: number
          p_user: string
        }
        Returns: undefined
      }
      outreach_release: {
        Args: { p_motivo: string; p_send: string; p_user: string }
        Returns: undefined
      }
      outreach_reserve: {
        Args: { p_intervalo: string; p_teto: number; p_user: string }
        Returns: {
          conversation: Json
          prospect: Json
          send_id: string
        }[]
      }
      save_openers: { Args: { p_texts: string[] }; Returns: undefined }
      seed_pipeline_stages: { Args: { _user_id: string }; Returns: undefined }
      webhook_confirm: { Args: { p_instance: string }; Returns: undefined }
      webhook_is_confirmed: { Args: { p_instance: string }; Returns: boolean }
      webhook_resolve: {
        Args: { p_secret: string }
        Returns: {
          confirmed_at: string
          instance_id: string
          user_id: string
        }[]
      }
      webhook_rotate_begin: {
        Args: { p_instance: string; p_user: string }
        Returns: string
      }
      webhook_rotate_commit: {
        Args: { p_instance: string; p_novo: string; p_user: string }
        Returns: undefined
      }
      webhook_secret_for: {
        Args: { p_instance: string; p_user: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const

