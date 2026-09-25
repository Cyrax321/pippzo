export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: string;
          created_at: string;
          details: Json;
          error: string | null;
          id: string;
          related_id: string | null;
          related_type: string | null;
          status: string;
          summary: string;
          workspace_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type: string;
          created_at?: string;
          details?: Json;
          error?: string | null;
          id?: string;
          related_id?: string | null;
          related_type?: string | null;
          status?: string;
          summary: string;
          workspace_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          details?: Json;
          error?: string | null;
          id?: string;
          related_id?: string | null;
          related_type?: string | null;
          status?: string;
          summary?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_log_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_memory: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          kind: string;
          last_used_at: string | null;
          related_id: string | null;
          related_type: string | null;
          source: string | null;
          tags: string[];
          updated_at: string;
          weight: number;
          workspace_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          kind?: string;
          last_used_at?: string | null;
          related_id?: string | null;
          related_type?: string | null;
          source?: string | null;
          tags?: string[];
          updated_at?: string;
          weight?: number;
          workspace_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          last_used_at?: string | null;
          related_id?: string | null;
          related_type?: string | null;
          source?: string | null;
          tags?: string[];
          updated_at?: string;
          weight?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_memory_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_guideline: {
        Row: {
          audience_profile: string;
          color_palette: Json;
          content_pillars: string[];
          custom_instructions: string;
          do_examples: string[];
          dont_examples: string[];
          emotional_tone: string;
          hashtag_style: string;
          logo_asset_id: string | null;
          personality: string;
          platform_guidance: string;
          preferred_ctas: string[];
          recurring_themes: string[];
          tone_of_voice: string;
          typography: Json;
          updated_at: string;
          visual_direction: string;
          vocabulary_avoid: string[];
          vocabulary_use: string[];
          workspace_id: string;
          writing_style: string;
        };
        Insert: {
          audience_profile?: string;
          color_palette?: Json;
          content_pillars?: string[];
          custom_instructions?: string;
          do_examples?: string[];
          dont_examples?: string[];
          emotional_tone?: string;
          hashtag_style?: string;
          logo_asset_id?: string | null;
          personality?: string;
          platform_guidance?: string;
          preferred_ctas?: string[];
          recurring_themes?: string[];
          tone_of_voice?: string;
          typography?: Json;
          updated_at?: string;
          visual_direction?: string;
          vocabulary_avoid?: string[];
          vocabulary_use?: string[];
          workspace_id: string;
          writing_style?: string;
        };
        Update: {
          audience_profile?: string;
          color_palette?: Json;
          content_pillars?: string[];
          custom_instructions?: string;
          do_examples?: string[];
          dont_examples?: string[];
          emotional_tone?: string;
          hashtag_style?: string;
          logo_asset_id?: string | null;
          personality?: string;
          platform_guidance?: string;
          preferred_ctas?: string[];
          recurring_themes?: string[];
          tone_of_voice?: string;
          typography?: Json;
          updated_at?: string;
          visual_direction?: string;
          vocabulary_avoid?: string[];
          vocabulary_use?: string[];
          workspace_id?: string;
          writing_style?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_guideline_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_images: {
        Row: {
          analysis: string | null;
          approved: boolean;
          created_at: string;
          duration_sec: number | null;
          id: string;
          kind: string;
          mime_type: string | null;
          name: string;
          poster_url: string | null;
          size_bytes: number | null;
          storage_path: string | null;
          storage_path_video: string | null;
          url: string;
          video_url: string | null;
          workspace_id: string;
        };
        Insert: {
          analysis?: string | null;
          approved?: boolean;
          created_at?: string;
          duration_sec?: number | null;
          id?: string;
          kind?: string;
          mime_type?: string | null;
          name?: string;
          poster_url?: string | null;
          size_bytes?: number | null;
          storage_path?: string | null;
          storage_path_video?: string | null;
          url: string;
          video_url?: string | null;
          workspace_id: string;
        };
        Update: {
          analysis?: string | null;
          approved?: boolean;
          created_at?: string;
          duration_sec?: number | null;
          id?: string;
          kind?: string;
          mime_type?: string | null;
          name?: string;
          poster_url?: string | null;
          size_bytes?: number | null;
          storage_path?: string | null;
          storage_path_video?: string | null;
          url?: string;
          video_url?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_images_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_profile: {
        Row: {
          audience: string;
          industry: string;
          name: string;
          own_handles: Json;
          products_services: string;
          socials: string;
          tone_notes: string;
          updated_at: string;
          website: string;
          workspace_id: string;
        };
        Insert: {
          audience?: string;
          industry?: string;
          name?: string;
          own_handles?: Json;
          products_services?: string;
          socials?: string;
          tone_notes?: string;
          updated_at?: string;
          website?: string;
          workspace_id: string;
        };
        Update: {
          audience?: string;
          industry?: string;
          name?: string;
          own_handles?: Json;
          products_services?: string;
          socials?: string;
          tone_notes?: string;
          updated_at?: string;
          website?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_profile_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      buffer_connection: {
        Row: {
          access_token: string;
          access_token_enc: string | null;
          channels: Json;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          access_token: string;
          access_token_enc?: string | null;
          channels?: Json;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          access_token?: string;
          access_token_enc?: string | null;
          channels?: Json;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "buffer_connection_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      competitors: {
        Row: {
          created_at: string;
          handles: Json;
          id: string;
          name: string;
          snapshot: Json | null;
          socials: Json;
          website: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          handles?: Json;
          id?: string;
          name: string;
          snapshot?: Json | null;
          socials?: Json;
          website?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          handles?: Json;
          id?: string;
          name?: string;
          snapshot?: Json | null;
          socials?: Json;
          website?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "competitors_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      cron_jobs: {
        Row: {
          config: Json;
          created_at: string;
          created_by: string | null;
          enabled: boolean;
          id: string;
          last_run_at: string | null;
          name: string;
          next_run_at: string;
          schedule: string;
          task_type: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          config?: Json;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          last_run_at?: string | null;
          name: string;
          next_run_at?: string;
          schedule: string;
          task_type: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          config?: Json;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          last_run_at?: string | null;
          name?: string;
          next_run_at?: string;
          schedule?: string;
          task_type?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cron_jobs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      cron_runs: {
        Row: {
          error: string | null;
          finished_at: string | null;
          id: string;
          job_id: string;
          result: Json;
          started_at: string;
          status: string;
          workspace_id: string;
        };
        Insert: {
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          job_id: string;
          result?: Json;
          started_at?: string;
          status?: string;
          workspace_id: string;
        };
        Update: {
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          job_id?: string;
          result?: Json;
          started_at?: string;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cron_runs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "cron_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cron_runs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      engagement_accounts: {
        Row: {
          created_at: string;
          external_account_id: string;
          id: string;
          last_synced_at: string | null;
          name: string;
          network: string;
          provider: string;
          status: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          external_account_id: string;
          id?: string;
          last_synced_at?: string | null;
          name?: string;
          network: string;
          provider?: string;
          status?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          external_account_id?: string;
          id?: string;
          last_synced_at?: string | null;
          name?: string;
          network?: string;
          provider?: string;
          status?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "engagement_accounts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      engagement_items: {
        Row: {
          author_avatar_url: string | null;
          author_handle: string | null;
          author_name: string;
          author_url: string | null;
          classification: Json;
          created_at: string;
          external_account_id: string;
          external_id: string;
          id: string;
          intent: string | null;
          kind: string;
          network: string;
          occurred_at: string | null;
          permalink: string | null;
          post_excerpt: string | null;
          post_id: string | null;
          provider: string;
          raw: Json;
          sentiment: string | null;
          should_reply: boolean | null;
          status: string;
          text: string;
          thread_id: string | null;
          updated_at: string;
          urgency: string | null;
          workspace_id: string;
        };
        Insert: {
          author_avatar_url?: string | null;
          author_handle?: string | null;
          author_name?: string;
          author_url?: string | null;
          classification?: Json;
          created_at?: string;
          external_account_id?: string;
          external_id: string;
          id?: string;
          intent?: string | null;
          kind?: string;
          network?: string;
          occurred_at?: string | null;
          permalink?: string | null;
          post_excerpt?: string | null;
          post_id?: string | null;
          provider?: string;
          raw?: Json;
          sentiment?: string | null;
          should_reply?: boolean | null;
          status?: string;
          text?: string;
          thread_id?: string | null;
          updated_at?: string;
          urgency?: string | null;
          workspace_id: string;
        };
        Update: {
          author_avatar_url?: string | null;
          author_handle?: string | null;
          author_name?: string;
          author_url?: string | null;
          classification?: Json;
          created_at?: string;
          external_account_id?: string;
          external_id?: string;
          id?: string;
          intent?: string | null;
          kind?: string;
          network?: string;
          occurred_at?: string | null;
          permalink?: string | null;
          post_excerpt?: string | null;
          post_id?: string | null;
          provider?: string;
          raw?: Json;
          sentiment?: string | null;
          should_reply?: boolean | null;
          status?: string;
          text?: string;
          thread_id?: string | null;
          updated_at?: string;
          urgency?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "engagement_items_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      engagement_replies: {
        Row: {
          created_at: string;
          created_by: string | null;
          error: string | null;
          external_id: string | null;
          id: string;
          item_id: string;
          mode: string;
          sent_at: string | null;
          status: string;
          text: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          error?: string | null;
          external_id?: string | null;
          id?: string;
          item_id: string;
          mode?: string;
          sent_at?: string | null;
          status?: string;
          text?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          error?: string | null;
          external_id?: string | null;
          id?: string;
          item_id?: string;
          mode?: string;
          sent_at?: string | null;
          status?: string;
          text?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "engagement_replies_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "engagement_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "engagement_replies_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      generated_images: {
        Row: {
          created_at: string;
          id: string;
          prompt: string | null;
          storage_path: string | null;
          url: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          prompt?: string | null;
          storage_path?: string | null;
          url: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          prompt?: string | null;
          storage_path?: string | null;
          url?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "generated_images_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      image_providers: {
        Row: {
          api_key: string;
          api_key_enc: string | null;
          base_url: string | null;
          created_at: string;
          default_model: string | null;
          id: string;
          is_default: boolean;
          label: string;
          provider: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          api_key: string;
          api_key_enc?: string | null;
          base_url?: string | null;
          created_at?: string;
          default_model?: string | null;
          id?: string;
          is_default?: boolean;
          label: string;
          provider: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          api_key?: string;
          api_key_enc?: string | null;
          base_url?: string | null;
          created_at?: string;
          default_model?: string | null;
          id?: string;
          is_default?: boolean;
          label?: string;
          provider?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "image_providers_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      llm_providers: {
        Row: {
          api_key: string;
          api_key_enc: string | null;
          base_url: string | null;
          created_at: string;
          default_model: string | null;
          id: string;
          is_default: boolean;
          label: string;
          provider: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          api_key?: string;
          api_key_enc?: string | null;
          base_url?: string | null;
          created_at?: string;
          default_model?: string | null;
          id?: string;
          is_default?: boolean;
          label: string;
          provider: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          api_key?: string;
          api_key_enc?: string | null;
          base_url?: string | null;
          created_at?: string;
          default_model?: string | null;
          id?: string;
          is_default?: boolean;
          label?: string;
          provider?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "llm_providers_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_settings: {
        Row: {
          email_to: string | null;
          on_approval: boolean;
          on_cap: boolean;
          on_digest: boolean;
          on_dm: boolean;
          on_engagement_digest: boolean;
          on_failure: boolean;
          on_negative: boolean;
          on_opportunity: boolean;
          on_support: boolean;
          slack_webhook_enc: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          email_to?: string | null;
          on_approval?: boolean;
          on_cap?: boolean;
          on_digest?: boolean;
          on_dm?: boolean;
          on_engagement_digest?: boolean;
          on_failure?: boolean;
          on_negative?: boolean;
          on_opportunity?: boolean;
          on_support?: boolean;
          slack_webhook_enc?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          email_to?: string | null;
          on_approval?: boolean;
          on_cap?: boolean;
          on_digest?: boolean;
          on_dm?: boolean;
          on_engagement_digest?: boolean;
          on_failure?: boolean;
          on_negative?: boolean;
          on_opportunity?: boolean;
          on_support?: boolean;
          slack_webhook_enc?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_settings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      post_metrics: {
        Row: {
          buffer_post_id: string;
          channel_id: string | null;
          clicks: number;
          comments: number;
          created_at: string;
          engagement_rate: number;
          fetched_at: string;
          id: string;
          impressions: number;
          likes: number;
          media_type: string | null;
          media_url: string | null;
          permalink: string | null;
          raw: Json;
          reach: number;
          sent_at: string | null;
          service: string | null;
          shares: number;
          text: string;
          workspace_id: string;
        };
        Insert: {
          buffer_post_id: string;
          channel_id?: string | null;
          clicks?: number;
          comments?: number;
          created_at?: string;
          engagement_rate?: number;
          fetched_at?: string;
          id?: string;
          impressions?: number;
          likes?: number;
          media_type?: string | null;
          media_url?: string | null;
          permalink?: string | null;
          raw?: Json;
          reach?: number;
          sent_at?: string | null;
          service?: string | null;
          shares?: number;
          text?: string;
          workspace_id: string;
        };
        Update: {
          buffer_post_id?: string;
          channel_id?: string | null;
          clicks?: number;
          comments?: number;
          created_at?: string;
          engagement_rate?: number;
          fetched_at?: string;
          id?: string;
          impressions?: number;
          likes?: number;
          media_type?: string | null;
          media_url?: string | null;
          permalink?: string | null;
          raw?: Json;
          reach?: number;
          sent_at?: string | null;
          service?: string | null;
          shares?: number;
          text?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_metrics_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          onboarding_completed: boolean;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          onboarding_completed?: boolean;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          onboarding_completed?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      scheduled_posts: {
        Row: {
          buffer_channel_id: string | null;
          buffer_id: string | null;
          created_at: string;
          id: string;
          image_storage_path: string | null;
          image_url: string | null;
          note: string | null;
          post: Json;
          publish_claimed_at: string | null;
          scheduled_at: string | null;
          status: string;
          video_url: string | null;
          workspace_id: string;
        };
        Insert: {
          buffer_channel_id?: string | null;
          buffer_id?: string | null;
          created_at?: string;
          id?: string;
          image_storage_path?: string | null;
          image_url?: string | null;
          note?: string | null;
          post: Json;
          publish_claimed_at?: string | null;
          scheduled_at?: string | null;
          status?: string;
          video_url?: string | null;
          workspace_id: string;
        };
        Update: {
          buffer_channel_id?: string | null;
          buffer_id?: string | null;
          created_at?: string;
          id?: string;
          image_storage_path?: string | null;
          image_url?: string | null;
          note?: string | null;
          post?: Json;
          publish_claimed_at?: string | null;
          scheduled_at?: string | null;
          status?: string;
          video_url?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      service_credentials: {
        Row: {
          api_key: string;
          api_key_enc: string | null;
          created_at: string;
          id: string;
          label: string;
          service: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          api_key?: string;
          api_key_enc?: string | null;
          created_at?: string;
          id?: string;
          label?: string;
          service: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          api_key?: string;
          api_key_enc?: string | null;
          created_at?: string;
          id?: string;
          label?: string;
          service?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_credentials_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      social_posts: {
        Row: {
          author: string | null;
          caption: string | null;
          competitor_id: string | null;
          external_id: string;
          fetched_at: string;
          id: string;
          media_type: string | null;
          metrics: Json;
          network: string;
          note: string | null;
          published_at: string | null;
          source: string;
          url: string | null;
          workspace_id: string;
        };
        Insert: {
          author?: string | null;
          caption?: string | null;
          competitor_id?: string | null;
          external_id: string;
          fetched_at?: string;
          id?: string;
          media_type?: string | null;
          metrics?: Json;
          network: string;
          note?: string | null;
          published_at?: string | null;
          source: string;
          url?: string | null;
          workspace_id: string;
        };
        Update: {
          author?: string | null;
          caption?: string | null;
          competitor_id?: string | null;
          external_id?: string;
          fetched_at?: string;
          id?: string;
          media_type?: string | null;
          metrics?: Json;
          network?: string;
          note?: string | null;
          published_at?: string | null;
          source?: string;
          url?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_posts_competitor_id_fkey";
            columns: ["competitor_id"];
            isOneToOne: false;
            referencedRelation: "competitors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_posts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      video_providers: {
        Row: {
          api_key: string;
          api_key_enc: string | null;
          base_url: string | null;
          created_at: string;
          default_model: string | null;
          id: string;
          label: string;
          provider: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          api_key: string;
          api_key_enc?: string | null;
          base_url?: string | null;
          created_at?: string;
          default_model?: string | null;
          id?: string;
          label: string;
          provider: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          api_key?: string;
          api_key_enc?: string | null;
          base_url?: string | null;
          created_at?: string;
          default_model?: string | null;
          id?: string;
          label?: string;
          provider?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "video_providers_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          role: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_playbooks: {
        Row: {
          body: string;
          created_at: string;
          enabled: boolean;
          id: string;
          slug: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          body?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          slug: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          slug?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_playbooks_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          allow_platform_fallback: boolean;
          automations_enabled: boolean;
          created_at: string;
          engagement_daily_limit: number;
          engagement_reply_mode: string;
          engagement_safe_categories: string[];
          heartbeat_interval: string;
          heartbeat_last_run_at: string | null;
          id: string;
          monthly_token_cap: number;
          name: string;
          owner_id: string;
          require_approval: boolean;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          allow_platform_fallback?: boolean;
          automations_enabled?: boolean;
          created_at?: string;
          engagement_daily_limit?: number;
          engagement_reply_mode?: string;
          engagement_safe_categories?: string[];
          heartbeat_interval?: string;
          heartbeat_last_run_at?: string | null;
          id?: string;
          monthly_token_cap?: number;
          name: string;
          owner_id: string;
          require_approval?: boolean;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          allow_platform_fallback?: boolean;
          automations_enabled?: boolean;
          created_at?: string;
          engagement_daily_limit?: number;
          engagement_reply_mode?: string;
          engagement_safe_categories?: string[];
          heartbeat_interval?: string;
          heartbeat_last_run_at?: string | null;
          id?: string;
          monthly_token_cap?: number;
          name?: string;
          owner_id?: string;
          require_approval?: boolean;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      ai_usage_month_total: { Args: { ws: string }; Returns: number };
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string };
        Returns: boolean;
      };
      is_workspace_owner: {
        Args: { _user_id: string; _workspace_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      workspace_role: "owner" | "admin" | "editor" | "viewer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      workspace_role: ["owner", "admin", "editor", "viewer"],
    },
  },
} as const;
