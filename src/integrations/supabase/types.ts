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
    PostgrestVersion: "14.5"
  }
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
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          admin_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      affiliate_clicks: {
        Row: {
          affiliate_event_id: string
          affiliate_id: string
          affiliate_member_id: string | null
          affiliate_venue_id: string | null
          browser_id: string | null
          clicked_at: string
          device_type: string | null
          id: string
          ip_hash: string | null
          is_internal: boolean
          is_returning: boolean | null
          referrer: string | null
          referrer_category: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          visitor_id: string | null
        }
        Insert: {
          affiliate_event_id: string
          affiliate_id: string
          affiliate_member_id?: string | null
          affiliate_venue_id?: string | null
          browser_id?: string | null
          clicked_at?: string
          device_type?: string | null
          id?: string
          ip_hash?: string | null
          is_internal?: boolean
          is_returning?: boolean | null
          referrer?: string | null
          referrer_category?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string | null
        }
        Update: {
          affiliate_event_id?: string
          affiliate_id?: string
          affiliate_member_id?: string | null
          affiliate_venue_id?: string | null
          browser_id?: string | null
          clicked_at?: string
          device_type?: string | null
          id?: string
          ip_hash?: string | null
          is_internal?: boolean
          is_returning?: boolean | null
          referrer?: string | null
          referrer_category?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_clicks_affiliate_event_id_fkey"
            columns: ["affiliate_event_id"]
            isOneToOne: false
            referencedRelation: "affiliate_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_clicks_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_clicks_affiliate_member_id_fkey"
            columns: ["affiliate_member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_clicks_affiliate_venue_id_fkey"
            columns: ["affiliate_venue_id"]
            isOneToOne: false
            referencedRelation: "affiliate_venues"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_event_assignments: {
        Row: {
          affiliate_event_id: string
          assigned_at: string
          assigned_by: string | null
          id: string
          member_id: string | null
          status: string
          submitted_at: string | null
          submitted_url: string | null
        }
        Insert: {
          affiliate_event_id: string
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          member_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_url?: string | null
        }
        Update: {
          affiliate_event_id?: string
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          member_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_event_assignments_affiliate_event_id_fkey"
            columns: ["affiliate_event_id"]
            isOneToOne: false
            referencedRelation: "affiliate_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_event_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_members"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_event_briefs: {
        Row: {
          affiliate_event_id: string
          brief_flyer_url: string | null
          created_at: string
          door_time: string | null
          dress_code: string | null
          extra_info: string | null
          hashtags: string | null
          id: string
          instagram_caption: string | null
          is_auto_generated: boolean
          lineup_notes: string | null
          promo_notes: string | null
          updated_at: string
        }
        Insert: {
          affiliate_event_id: string
          brief_flyer_url?: string | null
          created_at?: string
          door_time?: string | null
          dress_code?: string | null
          extra_info?: string | null
          hashtags?: string | null
          id?: string
          instagram_caption?: string | null
          is_auto_generated?: boolean
          lineup_notes?: string | null
          promo_notes?: string | null
          updated_at?: string
        }
        Update: {
          affiliate_event_id?: string
          brief_flyer_url?: string | null
          created_at?: string
          door_time?: string | null
          dress_code?: string | null
          extra_info?: string | null
          hashtags?: string | null
          id?: string
          instagram_caption?: string | null
          is_auto_generated?: boolean
          lineup_notes?: string | null
          promo_notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_event_briefs_affiliate_event_id_fkey"
            columns: ["affiliate_event_id"]
            isOneToOne: true
            referencedRelation: "affiliate_events"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_events: {
        Row: {
          affiliate_id: string
          affiliate_venue_id: string | null
          created_at: string
          description: string | null
          dj_names: string[] | null
          end_time: string | null
          event_date: string
          external_ticket_url: string | null
          flyer_url: string | null
          gallery_urls: string[] | null
          genres: string[] | null
          id: string
          is_free: boolean
          is_sold_out: boolean
          name: string
          price_from: number | null
          recurring_template_id: string | null
          slug: string
          start_time: string | null
          status: string
          updated_at: string
        }
        Insert: {
          affiliate_id: string
          affiliate_venue_id?: string | null
          created_at?: string
          description?: string | null
          dj_names?: string[] | null
          end_time?: string | null
          event_date: string
          external_ticket_url?: string | null
          flyer_url?: string | null
          gallery_urls?: string[] | null
          genres?: string[] | null
          id?: string
          is_free?: boolean
          is_sold_out?: boolean
          name: string
          price_from?: number | null
          recurring_template_id?: string | null
          slug: string
          start_time?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          affiliate_id?: string
          affiliate_venue_id?: string | null
          created_at?: string
          description?: string | null
          dj_names?: string[] | null
          end_time?: string | null
          event_date?: string
          external_ticket_url?: string | null
          flyer_url?: string | null
          gallery_urls?: string[] | null
          genres?: string[] | null
          id?: string
          is_free?: boolean
          is_sold_out?: boolean
          name?: string
          price_from?: number | null
          recurring_template_id?: string | null
          slug?: string
          start_time?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_events_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_events_affiliate_venue_id_fkey"
            columns: ["affiliate_venue_id"]
            isOneToOne: false
            referencedRelation: "affiliate_venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_events_recurring_template_id_fkey"
            columns: ["recurring_template_id"]
            isOneToOne: false
            referencedRelation: "affiliate_recurring_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_invitations_meta: {
        Row: {
          affiliate_id: string | null
          affiliate_name: string
          affiliate_type: string
          city: string | null
          commission_rate: number
          created_at: string
          created_by: string | null
          first_name: string | null
          invitation_token: string
          last_name: string | null
          linktree_slug: string | null
          member_role: string | null
        }
        Insert: {
          affiliate_id?: string | null
          affiliate_name: string
          affiliate_type?: string
          city?: string | null
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          first_name?: string | null
          invitation_token: string
          last_name?: string | null
          linktree_slug?: string | null
          member_role?: string | null
        }
        Update: {
          affiliate_id?: string | null
          affiliate_name?: string
          affiliate_type?: string
          city?: string | null
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          first_name?: string | null
          invitation_token?: string
          last_name?: string | null
          linktree_slug?: string | null
          member_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_invitations_meta_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_linktree_events: {
        Row: {
          affiliate_event_id: string
          affiliate_id: string
          created_at: string
          id: string
          sort_order: number
        }
        Insert: {
          affiliate_event_id: string
          affiliate_id: string
          created_at?: string
          id?: string
          sort_order?: number
        }
        Update: {
          affiliate_event_id?: string
          affiliate_id?: string
          created_at?: string
          id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_linktree_events_affiliate_event_id_fkey"
            columns: ["affiliate_event_id"]
            isOneToOne: false
            referencedRelation: "affiliate_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_linktree_events_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_live_pings: {
        Row: {
          affiliate_event_id: string | null
          affiliate_id: string
          affiliate_member_id: string | null
          affiliate_venue_id: string | null
          last_seen: string
          page_path: string | null
          session_id: string
        }
        Insert: {
          affiliate_event_id?: string | null
          affiliate_id: string
          affiliate_member_id?: string | null
          affiliate_venue_id?: string | null
          last_seen?: string
          page_path?: string | null
          session_id: string
        }
        Update: {
          affiliate_event_id?: string | null
          affiliate_id?: string
          affiliate_member_id?: string | null
          affiliate_venue_id?: string | null
          last_seen?: string
          page_path?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_live_pings_affiliate_event_id_fkey"
            columns: ["affiliate_event_id"]
            isOneToOne: false
            referencedRelation: "affiliate_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_live_pings_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_live_pings_affiliate_member_id_fkey"
            columns: ["affiliate_member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_live_pings_affiliate_venue_id_fkey"
            columns: ["affiliate_venue_id"]
            isOneToOne: false
            referencedRelation: "affiliate_venues"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_members: {
        Row: {
          affiliate_id: string
          avatar_url: string | null
          created_at: string
          first_name: string | null
          id: string
          instagram: string | null
          invited_by: string | null
          is_active: boolean
          last_name: string | null
          linktree_slug: string | null
          linktree_sort_mode: string | null
          linktree_status: string
          role: string
          tiktok: string | null
          user_id: string
          website: string | null
          whatsapp: string | null
        }
        Insert: {
          affiliate_id: string
          avatar_url?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          instagram?: string | null
          invited_by?: string | null
          is_active?: boolean
          last_name?: string | null
          linktree_slug?: string | null
          linktree_sort_mode?: string | null
          linktree_status?: string
          role?: string
          tiktok?: string | null
          user_id: string
          website?: string | null
          whatsapp?: string | null
        }
        Update: {
          affiliate_id?: string
          avatar_url?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          instagram?: string | null
          invited_by?: string | null
          is_active?: boolean
          last_name?: string | null
          linktree_slug?: string | null
          linktree_sort_mode?: string | null
          linktree_status?: string
          role?: string
          tiktok?: string | null
          user_id?: string
          website?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_members_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_notification_automations: {
        Row: {
          affiliate_id: string
          automation_type: string
          config: Json
          created_at: string
          id: string
          is_enabled: boolean
          updated_at: string
        }
        Insert: {
          affiliate_id: string
          automation_type: string
          config?: Json
          created_at?: string
          id?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Update: {
          affiliate_id?: string
          automation_type?: string
          config?: Json
          created_at?: string
          id?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_notification_automations_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_notifications: {
        Row: {
          action_url: string | null
          affiliate_id: string
          automation_type: string | null
          body: string
          id: string
          read_count: number
          sent_at: string
          target_member_id: string | null
          title: string
          type: string
        }
        Insert: {
          action_url?: string | null
          affiliate_id: string
          automation_type?: string | null
          body: string
          id?: string
          read_count?: number
          sent_at?: string
          target_member_id?: string | null
          title: string
          type: string
        }
        Update: {
          action_url?: string | null
          affiliate_id?: string
          automation_type?: string | null
          body?: string
          id?: string
          read_count?: number
          sent_at?: string
          target_member_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_notifications_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_notifications_target_member_id_fkey"
            columns: ["target_member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_members"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_recurring_templates: {
        Row: {
          advance_days: number
          affiliate_id: string
          affiliate_venue_id: string | null
          created_at: string
          day_of_week: number
          end_time: string | null
          flyer_url: string | null
          genres: string[] | null
          id: string
          is_active: boolean
          is_free: boolean
          name: string
          price_from: number | null
          publication_url: string | null
          slug: string | null
          start_time: string | null
          updated_at: string
        }
        Insert: {
          advance_days?: number
          affiliate_id: string
          affiliate_venue_id?: string | null
          created_at?: string
          day_of_week: number
          end_time?: string | null
          flyer_url?: string | null
          genres?: string[] | null
          id?: string
          is_active?: boolean
          is_free?: boolean
          name: string
          price_from?: number | null
          publication_url?: string | null
          slug?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          advance_days?: number
          affiliate_id?: string
          affiliate_venue_id?: string | null
          created_at?: string
          day_of_week?: number
          end_time?: string | null
          flyer_url?: string | null
          genres?: string[] | null
          id?: string
          is_active?: boolean
          is_free?: boolean
          name?: string
          price_from?: number | null
          publication_url?: string | null
          slug?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_recurring_templates_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_recurring_templates_affiliate_venue_id_fkey"
            columns: ["affiliate_venue_id"]
            isOneToOne: false
            referencedRelation: "affiliate_venues"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_venues: {
        Row: {
          address: string | null
          affiliate_id: string
          city: string | null
          cover_image_url: string | null
          created_at: string
          description: string | null
          dress_code: string | null
          external_booking_url: string | null
          gallery_urls: string[] | null
          genres: string[] | null
          id: string
          instagram: string | null
          is_active: boolean
          lat: number | null
          lng: number | null
          logo_url: string | null
          min_age: number | null
          name: string
          neighborhood: string | null
          short_description: string | null
          slug: string
          sort_order: number
          tiktok: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          affiliate_id: string
          city?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          dress_code?: string | null
          external_booking_url?: string | null
          gallery_urls?: string[] | null
          genres?: string[] | null
          id?: string
          instagram?: string | null
          is_active?: boolean
          lat?: number | null
          lng?: number | null
          logo_url?: string | null
          min_age?: number | null
          name: string
          neighborhood?: string | null
          short_description?: string | null
          slug: string
          sort_order?: number
          tiktok?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          affiliate_id?: string
          city?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          dress_code?: string | null
          external_booking_url?: string | null
          gallery_urls?: string[] | null
          genres?: string[] | null
          id?: string
          instagram?: string | null
          is_active?: boolean
          lat?: number | null
          lng?: number | null
          logo_url?: string | null
          min_age?: number | null
          name?: string
          neighborhood?: string | null
          short_description?: string | null
          slug?: string
          sort_order?: number
          tiktok?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_venues_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_visitor_sessions: {
        Row: {
          affiliate_event_id: string | null
          affiliate_id: string
          affiliate_member_id: string | null
          affiliate_venue_id: string | null
          city: string | null
          connection_type: string | null
          country: string | null
          device_type: string | null
          duration_seconds: number | null
          entry_page: string | null
          entry_page_type: string | null
          id: string
          is_internal: boolean
          is_returning: boolean | null
          landing_page_full: string | null
          language: string | null
          last_activity_at: string | null
          referrer: string | null
          referrer_category: string | null
          referrer_domain: string | null
          scroll_depth_max: number | null
          session_id: string
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          viewport_h: number | null
          viewport_w: number | null
          visit_number: number | null
          visited_at: string
          visitor_id: string | null
        }
        Insert: {
          affiliate_event_id?: string | null
          affiliate_id: string
          affiliate_member_id?: string | null
          affiliate_venue_id?: string | null
          city?: string | null
          connection_type?: string | null
          country?: string | null
          device_type?: string | null
          duration_seconds?: number | null
          entry_page?: string | null
          entry_page_type?: string | null
          id?: string
          is_internal?: boolean
          is_returning?: boolean | null
          landing_page_full?: string | null
          language?: string | null
          last_activity_at?: string | null
          referrer?: string | null
          referrer_category?: string | null
          referrer_domain?: string | null
          scroll_depth_max?: number | null
          session_id: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          viewport_h?: number | null
          viewport_w?: number | null
          visit_number?: number | null
          visited_at?: string
          visitor_id?: string | null
        }
        Update: {
          affiliate_event_id?: string | null
          affiliate_id?: string
          affiliate_member_id?: string | null
          affiliate_venue_id?: string | null
          city?: string | null
          connection_type?: string | null
          country?: string | null
          device_type?: string | null
          duration_seconds?: number | null
          entry_page?: string | null
          entry_page_type?: string | null
          id?: string
          is_internal?: boolean
          is_returning?: boolean | null
          landing_page_full?: string | null
          language?: string | null
          last_activity_at?: string | null
          referrer?: string | null
          referrer_category?: string | null
          referrer_domain?: string | null
          scroll_depth_max?: number | null
          session_id?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          viewport_h?: number | null
          viewport_w?: number | null
          visit_number?: number | null
          visited_at?: string
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_visitor_sessions_affiliate_event_id_fkey"
            columns: ["affiliate_event_id"]
            isOneToOne: false
            referencedRelation: "affiliate_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_visitor_sessions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_visitor_sessions_affiliate_member_id_fkey"
            columns: ["affiliate_member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_visitor_sessions_affiliate_venue_id_fkey"
            columns: ["affiliate_venue_id"]
            isOneToOne: false
            referencedRelation: "affiliate_venues"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          allow_promoter_sort: boolean
          avatar_url: string | null
          bio: string | null
          city: string | null
          commission_rate: number
          created_at: string
          created_by: string | null
          id: string
          instagram: string | null
          is_active: boolean
          linktree_slug: string | null
          linktree_sort_mode: string
          name: string
          promoter_social_mode: string
          tiktok: string | null
          tracking_prefix: string | null
          trust_stats: Json
          type: string
          updated_at: string
          user_id: string
          website: string | null
          whatsapp: string | null
        }
        Insert: {
          allow_promoter_sort?: boolean
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          id?: string
          instagram?: string | null
          is_active?: boolean
          linktree_slug?: string | null
          linktree_sort_mode?: string
          name: string
          promoter_social_mode?: string
          tiktok?: string | null
          tracking_prefix?: string | null
          trust_stats?: Json
          type?: string
          updated_at?: string
          user_id: string
          website?: string | null
          whatsapp?: string | null
        }
        Update: {
          allow_promoter_sort?: boolean
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          id?: string
          instagram?: string | null
          is_active?: boolean
          linktree_slug?: string | null
          linktree_sort_mode?: string
          name?: string
          promoter_social_mode?: string
          tiktok?: string | null
          tracking_prefix?: string | null
          trust_stats?: Json
          type?: string
          updated_at?: string
          user_id?: string
          website?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      agencies: {
        Row: {
          bio: string | null
          city: string | null
          contact_email: string | null
          created_at: string
          id: string
          instagram_url: string | null
          is_active: boolean
          logo_url: string | null
          name: string
          owner_user_id: string
          slug: string | null
          updated_at: string
          website_url: string | null
          whatsapp_number: string | null
        }
        Insert: {
          bio?: string | null
          city?: string | null
          contact_email?: string | null
          created_at?: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean
          logo_url?: string | null
          name: string
          owner_user_id: string
          slug?: string | null
          updated_at?: string
          website_url?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          bio?: string | null
          city?: string | null
          contact_email?: string | null
          created_at?: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean
          logo_url?: string | null
          name?: string
          owner_user_id?: string
          slug?: string | null
          updated_at?: string
          website_url?: string | null
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      agency_conversions: {
        Row: {
          agency_id: string
          club_paid_at: string | null
          club_status: string
          created_at: string
          event_id: string | null
          gross_amount: number
          id: string
          margin_amount: number
          net_amount: number
          organizer_user_id: string | null
          promoter_id: string | null
          source_conversion_id: string | null
          venue_id: string | null
        }
        Insert: {
          agency_id: string
          club_paid_at?: string | null
          club_status?: string
          created_at?: string
          event_id?: string | null
          gross_amount?: number
          id?: string
          margin_amount?: number
          net_amount?: number
          organizer_user_id?: string | null
          promoter_id?: string | null
          source_conversion_id?: string | null
          venue_id?: string | null
        }
        Update: {
          agency_id?: string
          club_paid_at?: string | null
          club_status?: string
          created_at?: string
          event_id?: string | null
          gross_amount?: number
          id?: string
          margin_amount?: number
          net_amount?: number
          organizer_user_id?: string | null
          promoter_id?: string | null
          source_conversion_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_conversions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_conversions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_conversions_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_conversions_source_conversion_id_fkey"
            columns: ["source_conversion_id"]
            isOneToOne: true
            referencedRelation: "promoter_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_conversions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_payouts: {
        Row: {
          agency_id: string
          amount: number
          created_at: string
          id: string
          notes: string | null
          organizer_user_id: string | null
          paid_at: string | null
          paid_by: string | null
          period_label: string | null
          status: string
          venue_id: string | null
        }
        Insert: {
          agency_id: string
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          organizer_user_id?: string | null
          paid_at?: string | null
          paid_by?: string | null
          period_label?: string | null
          status?: string
          venue_id?: string | null
        }
        Update: {
          agency_id?: string
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          organizer_user_id?: string | null
          paid_at?: string | null
          paid_by?: string | null
          period_label?: string | null
          status?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_payouts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_payouts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_promoter_groups: {
        Row: {
          agency_id: string
          color: string
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_promoter_groups_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_rule_assignments: {
        Row: {
          agency_id: string
          assigned_at: string
          group_id: string | null
          id: string
          promoter_id: string | null
          target_type: string
          template_id: string
        }
        Insert: {
          agency_id: string
          assigned_at?: string
          group_id?: string | null
          id?: string
          promoter_id?: string | null
          target_type: string
          template_id: string
        }
        Update: {
          agency_id?: string
          assigned_at?: string
          group_id?: string | null
          id?: string
          promoter_id?: string | null
          target_type?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_rule_assignments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_rule_assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "agency_promoter_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_rule_assignments_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_rule_assignments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agency_rule_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_rule_templates: {
        Row: {
          agency_id: string
          can_scan_entries: boolean
          can_sell_tables: boolean
          can_sell_tickets: boolean
          color: string
          created_at: string
          customer_discount_type: string
          customer_discount_value: number
          description: string | null
          guestlist_quota: number | null
          id: string
          is_default: boolean
          name: string
          table_cap: number | null
          table_commission_type: string
          table_commission_value: number
          ticket_cap: number | null
          ticket_commission_type: string
          ticket_commission_value: number
          updated_at: string
        }
        Insert: {
          agency_id: string
          can_scan_entries?: boolean
          can_sell_tables?: boolean
          can_sell_tickets?: boolean
          color?: string
          created_at?: string
          customer_discount_type?: string
          customer_discount_value?: number
          description?: string | null
          guestlist_quota?: number | null
          id?: string
          is_default?: boolean
          name: string
          table_cap?: number | null
          table_commission_type?: string
          table_commission_value?: number
          ticket_cap?: number | null
          ticket_commission_type?: string
          ticket_commission_value?: number
          updated_at?: string
        }
        Update: {
          agency_id?: string
          can_scan_entries?: boolean
          can_sell_tables?: boolean
          can_sell_tickets?: boolean
          color?: string
          created_at?: string
          customer_discount_type?: string
          customer_discount_value?: number
          description?: string | null
          guestlist_quota?: number | null
          id?: string
          is_default?: boolean
          name?: string
          table_cap?: number | null
          table_commission_type?: string
          table_commission_value?: number
          ticket_cap?: number | null
          ticket_commission_type?: string
          ticket_commission_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_rule_templates_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_venue_contracts: {
        Row: {
          agency_id: string
          agency_signed_at: string | null
          agency_signed_by: string | null
          club_signed_at: string | null
          club_signed_by: string | null
          created_at: string
          created_by: string
          currency: string
          id: string
          notes: string | null
          organizer_user_id: string | null
          override_type: string | null
          override_value: number
          status: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          agency_id: string
          agency_signed_at?: string | null
          agency_signed_by?: string | null
          club_signed_at?: string | null
          club_signed_by?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          notes?: string | null
          organizer_user_id?: string | null
          override_type?: string | null
          override_value?: number
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          agency_id?: string
          agency_signed_at?: string | null
          agency_signed_by?: string | null
          club_signed_at?: string | null
          club_signed_by?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          notes?: string | null
          organizer_user_id?: string | null
          override_type?: string | null
          override_value?: number
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_venue_contracts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_venue_contracts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: string
          maintenance_message: string | null
          maintenance_mode: boolean
          maintenance_password: string | null
          maintenance_password_hash: string | null
          payments_disabled: boolean
          terms_url: string | null
          terms_version: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          maintenance_message?: string | null
          maintenance_mode?: boolean
          maintenance_password?: string | null
          maintenance_password_hash?: string | null
          payments_disabled?: boolean
          terms_url?: string | null
          terms_version?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          maintenance_message?: string | null
          maintenance_mode?: boolean
          maintenance_password?: string | null
          maintenance_password_hash?: string | null
          payments_disabled?: boolean
          terms_url?: string | null
          terms_version?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      attribution_touchpoints: {
        Row: {
          campaign: string | null
          event_id: string | null
          id: string
          medium: string | null
          organizer_user_id: string | null
          referrer_domain: string | null
          source: string | null
          touch_type: string
          ts: string
          user_id: string | null
          venue_id: string | null
          visitor_id: string | null
        }
        Insert: {
          campaign?: string | null
          event_id?: string | null
          id?: string
          medium?: string | null
          organizer_user_id?: string | null
          referrer_domain?: string | null
          source?: string | null
          touch_type: string
          ts?: string
          user_id?: string | null
          venue_id?: string | null
          visitor_id?: string | null
        }
        Update: {
          campaign?: string | null
          event_id?: string | null
          id?: string
          medium?: string | null
          organizer_user_id?: string | null
          referrer_domain?: string | null
          source?: string | null
          touch_type?: string
          ts?: string
          user_id?: string | null
          venue_id?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attribution_touchpoints_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_touchpoints_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_snapshots: {
        Row: {
          cart_data: Json
          converted: boolean | null
          created_at: string | null
          event_id: string | null
          id: string
          notified_at: string | null
          snapshot_type: string
          updated_at: string | null
          user_id: string
          venue_id: string | null
        }
        Insert: {
          cart_data?: Json
          converted?: boolean | null
          created_at?: string | null
          event_id?: string | null
          id?: string
          notified_at?: string | null
          snapshot_type?: string
          updated_at?: string | null
          user_id: string
          venue_id?: string | null
        }
        Update: {
          cart_data?: Json
          converted?: boolean | null
          created_at?: string | null
          event_id?: string | null
          id?: string
          notified_at?: string | null
          snapshot_type?: string
          updated_at?: string | null
          user_id?: string
          venue_id?: string | null
        }
        Relationships: []
      }
      cgv_acceptances: {
        Row: {
          accepted_at: string
          cgv_version: string
          id: string
          ip_address: string | null
          order_type: string
          reference_id: string | null
          user_email: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string
          cgv_version?: string
          id?: string
          ip_address?: string | null
          order_type: string
          reference_id?: string | null
          user_email: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string
          cgv_version?: string
          id?: string
          ip_address?: string | null
          order_type?: string
          reference_id?: string | null
          user_email?: string
          user_id?: string | null
        }
        Relationships: []
      }
      chatbot_training: {
        Row: {
          answer: string
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean | null
          question: string
          updated_at: string
        }
        Insert: {
          answer: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          question: string
          updated_at?: string
        }
        Update: {
          answer?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          question?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_scores: {
        Row: {
          created_at: string
          event_score: number
          id: string
          last_activity_at: string | null
          monthly_rank: number | null
          monthly_score: number
          rank: number | null
          recency_boost: number
          spend_score: number
          total_score: number
          updated_at: string
          user_id: string
          venue_id: string
          vip_score: number
          visit_score: number
          yearly_rank: number | null
          yearly_score: number
        }
        Insert: {
          created_at?: string
          event_score?: number
          id?: string
          last_activity_at?: string | null
          monthly_rank?: number | null
          monthly_score?: number
          rank?: number | null
          recency_boost?: number
          spend_score?: number
          total_score?: number
          updated_at?: string
          user_id: string
          venue_id: string
          vip_score?: number
          visit_score?: number
          yearly_rank?: number | null
          yearly_score?: number
        }
        Update: {
          created_at?: string
          event_score?: number
          id?: string
          last_activity_at?: string | null
          monthly_rank?: number | null
          monthly_score?: number
          rank?: number | null
          recency_boost?: number
          spend_score?: number
          total_score?: number
          updated_at?: string
          user_id?: string
          venue_id?: string
          vip_score?: number
          visit_score?: number
          yearly_rank?: number | null
          yearly_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_scores_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      cloakroom_transactions: {
        Row: {
          attendee_qr: string | null
          cloakroom_number: string
          created_at: string
          customer_name: string | null
          deposited_at: string
          event_id: string
          id: string
          items_count: number
          paid_on_site: boolean
          payment_confirmed: boolean
          price: number
          processed_by: string | null
          retrieved: boolean
          retrieved_at: string | null
          staff_id: string | null
          ticket_id: string | null
          venue_id: string
        }
        Insert: {
          attendee_qr?: string | null
          cloakroom_number: string
          created_at?: string
          customer_name?: string | null
          deposited_at?: string
          event_id: string
          id?: string
          items_count?: number
          paid_on_site?: boolean
          payment_confirmed?: boolean
          price?: number
          processed_by?: string | null
          retrieved?: boolean
          retrieved_at?: string | null
          staff_id?: string | null
          ticket_id?: string | null
          venue_id: string
        }
        Update: {
          attendee_qr?: string | null
          cloakroom_number?: string
          created_at?: string
          customer_name?: string | null
          deposited_at?: string
          event_id?: string
          id?: string
          items_count?: number
          paid_on_site?: boolean
          payment_confirmed?: boolean
          price?: number
          processed_by?: string | null
          retrieved?: boolean
          retrieved_at?: string | null
          staff_id?: string | null
          ticket_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloakroom_transactions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloakroom_transactions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloakroom_transactions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloakroom_transactions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloakroom_transactions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_drink_redemption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloakroom_transactions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_entry_scan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloakroom_transactions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_templates: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          organizer_user_id: string | null
          rules: Json
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          organizer_user_id?: string | null
          rules?: Json
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          organizer_user_id?: string | null
          rules?: Json
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_templates_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaigns: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          last_sent_at: string | null
          message: string
          name: string
          segment_config: Json | null
          sent_count: number | null
          target_segment: string
          trigger_config: Json | null
          trigger_type: string
          updated_at: string | null
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_sent_at?: string | null
          message: string
          name: string
          segment_config?: Json | null
          sent_count?: number | null
          target_segment: string
          trigger_config?: Json | null
          trigger_type: string
          updated_at?: string | null
          venue_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_sent_at?: string | null
          message?: string
          name?: string
          segment_config?: Json | null
          sent_count?: number | null
          target_segment?: string
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaigns_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notifications: {
        Row: {
          campaign_id: string | null
          id: string
          message: string
          metadata: Json | null
          notification_type: string
          read_at: string | null
          sent_at: string | null
          title: string | null
          user_id: string
          venue_customer_id: string
          venue_id: string
        }
        Insert: {
          campaign_id?: string | null
          id?: string
          message: string
          metadata?: Json | null
          notification_type: string
          read_at?: string | null
          sent_at?: string | null
          title?: string | null
          user_id: string
          venue_customer_id: string
          venue_id: string
        }
        Update: {
          campaign_id?: string | null
          id?: string
          message?: string
          metadata?: Json | null
          notification_type?: string
          read_at?: string | null
          sent_at?: string | null
          title?: string | null
          user_id?: string
          venue_customer_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notifications_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notifications_venue_customer_id_fkey"
            columns: ["venue_customer_id"]
            isOneToOne: false
            referencedRelation: "venue_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notifications_venue_customer_id_fkey"
            columns: ["venue_customer_id"]
            isOneToOne: false
            referencedRelation: "venue_customers_limited"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notifications_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_activity_log: {
        Row: {
          activity_type: string
          amount_cents: number | null
          event_id: string | null
          id: string
          metadata: Json | null
          organizer_user_id: string | null
          ref_id: string | null
          ref_type: string | null
          ts: string
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          activity_type: string
          amount_cents?: number | null
          event_id?: string | null
          id?: string
          metadata?: Json | null
          organizer_user_id?: string | null
          ref_id?: string | null
          ref_type?: string | null
          ts?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          activity_type?: string
          amount_cents?: number | null
          event_id?: string | null
          id?: string
          metadata?: Json | null
          organizer_user_id?: string | null
          ref_id?: string | null
          ref_type?: string | null
          ts?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_activity_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_activity_log_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_incidents: {
        Row: {
          created_at: string | null
          details: string | null
          id: string
          incident_type: string
          order_id: string | null
          reason: string
          reported_by: string
          table_reservation_id: string | null
          ticket_id: string | null
          venue_customer_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          details?: string | null
          id?: string
          incident_type: string
          order_id?: string | null
          reason: string
          reported_by: string
          table_reservation_id?: string | null
          ticket_id?: string | null
          venue_customer_id: string
          venue_id: string
        }
        Update: {
          created_at?: string | null
          details?: string | null
          id?: string
          incident_type?: string
          order_id?: string | null
          reason?: string
          reported_by?: string
          table_reservation_id?: string | null
          ticket_id?: string | null
          venue_customer_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_incidents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_incidents_table_reservation_id_fkey"
            columns: ["table_reservation_id"]
            isOneToOne: false
            referencedRelation: "table_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_incidents_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_incidents_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_drink_redemption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_incidents_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_entry_scan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_incidents_venue_customer_id_fkey"
            columns: ["venue_customer_id"]
            isOneToOne: false
            referencedRelation: "venue_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_incidents_venue_customer_id_fkey"
            columns: ["venue_customer_id"]
            isOneToOne: false
            referencedRelation: "venue_customers_limited"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_incidents_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_loyalty: {
        Row: {
          created_at: string | null
          current_balance: number | null
          id: string
          last_points_earned_at: string | null
          tier: string | null
          total_points_earned: number | null
          total_points_spent: number | null
          updated_at: string | null
          user_id: string
          venue_customer_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          current_balance?: number | null
          id?: string
          last_points_earned_at?: string | null
          tier?: string | null
          total_points_earned?: number | null
          total_points_spent?: number | null
          updated_at?: string | null
          user_id: string
          venue_customer_id: string
          venue_id: string
        }
        Update: {
          created_at?: string | null
          current_balance?: number | null
          id?: string
          last_points_earned_at?: string | null
          tier?: string | null
          total_points_earned?: number | null
          total_points_spent?: number | null
          updated_at?: string | null
          user_id?: string
          venue_customer_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_loyalty_venue_customer_id_fkey"
            columns: ["venue_customer_id"]
            isOneToOne: false
            referencedRelation: "venue_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_loyalty_venue_customer_id_fkey"
            columns: ["venue_customer_id"]
            isOneToOne: false
            referencedRelation: "venue_customers_limited"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_loyalty_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_preview_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          failed_attempts: number
          id: string
          is_active: boolean
          label: string
          last_used_at: string | null
          password_hash: string
          revoked_at: string | null
          target_account: string
          token: string
          used_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          failed_attempts?: number
          id?: string
          is_active?: boolean
          label: string
          last_used_at?: string | null
          password_hash: string
          revoked_at?: string | null
          target_account: string
          token?: string
          used_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          failed_attempts?: number
          id?: string
          is_active?: boolean
          label?: string
          last_used_at?: string | null
          password_hash?: string
          revoked_at?: string | null
          target_account?: string
          token?: string
          used_count?: number
        }
        Relationships: []
      }
      dj_availability: {
        Row: {
          blocked_date: string
          created_at: string
          id: string
          reason: string | null
          source: string
          user_id: string
        }
        Insert: {
          blocked_date: string
          created_at?: string
          id?: string
          reason?: string | null
          source?: string
          user_id: string
        }
        Update: {
          blocked_date?: string
          created_at?: string
          id?: string
          reason?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dj_availability_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_availability_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_booking_contracts: {
        Row: {
          acompte_cents: number
          acompte_released_at: string | null
          acompte_transfer_id: string | null
          auto_release_at: string | null
          balance_transfer_id: string | null
          booking_request_id: string | null
          cachet_cents: number
          cancellation_policy: string
          charge_id: string | null
          club_signed_at: string | null
          club_signed_by: string | null
          club_signed_ip: string | null
          club_signed_user_agent: string | null
          contract_pdf_url: string | null
          created_at: string
          created_by: string
          currency: string
          dj_id: string
          dj_set_id: string
          dj_signed_at: string | null
          dj_signed_by: string | null
          dj_signed_ip: string | null
          dj_signed_user_agent: string | null
          dj_user_id: string
          id: string
          organizer_user_id: string | null
          payment_intent_id: string | null
          refund_id: string | null
          refunded_at: string | null
          released_at: string | null
          status: string
          stripe_fee_cents: number
          terms_snapshot: Json | null
          updated_at: string
          venue_id: string | null
          yuno_fee_cents: number
        }
        Insert: {
          acompte_cents?: number
          acompte_released_at?: string | null
          acompte_transfer_id?: string | null
          auto_release_at?: string | null
          balance_transfer_id?: string | null
          booking_request_id?: string | null
          cachet_cents: number
          cancellation_policy?: string
          charge_id?: string | null
          club_signed_at?: string | null
          club_signed_by?: string | null
          club_signed_ip?: string | null
          club_signed_user_agent?: string | null
          contract_pdf_url?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          dj_id: string
          dj_set_id: string
          dj_signed_at?: string | null
          dj_signed_by?: string | null
          dj_signed_ip?: string | null
          dj_signed_user_agent?: string | null
          dj_user_id: string
          id?: string
          organizer_user_id?: string | null
          payment_intent_id?: string | null
          refund_id?: string | null
          refunded_at?: string | null
          released_at?: string | null
          status?: string
          stripe_fee_cents?: number
          terms_snapshot?: Json | null
          updated_at?: string
          venue_id?: string | null
          yuno_fee_cents?: number
        }
        Update: {
          acompte_cents?: number
          acompte_released_at?: string | null
          acompte_transfer_id?: string | null
          auto_release_at?: string | null
          balance_transfer_id?: string | null
          booking_request_id?: string | null
          cachet_cents?: number
          cancellation_policy?: string
          charge_id?: string | null
          club_signed_at?: string | null
          club_signed_by?: string | null
          club_signed_ip?: string | null
          club_signed_user_agent?: string | null
          contract_pdf_url?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          dj_id?: string
          dj_set_id?: string
          dj_signed_at?: string | null
          dj_signed_by?: string | null
          dj_signed_ip?: string | null
          dj_signed_user_agent?: string | null
          dj_user_id?: string
          id?: string
          organizer_user_id?: string | null
          payment_intent_id?: string | null
          refund_id?: string | null
          refunded_at?: string | null
          released_at?: string | null
          status?: string
          stripe_fee_cents?: number
          terms_snapshot?: Json | null
          updated_at?: string
          venue_id?: string | null
          yuno_fee_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "dj_booking_contracts_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "dj_booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_contracts_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_contracts_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_contracts_dj_set_id_fkey"
            columns: ["dj_set_id"]
            isOneToOne: false
            referencedRelation: "dj_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_contracts_dj_user_id_fkey"
            columns: ["dj_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_contracts_dj_user_id_fkey"
            columns: ["dj_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_contracts_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_contracts_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_contracts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_booking_requests: {
        Row: {
          agreed_fee: number | null
          created_at: string
          created_by: string
          created_dj_set_id: string | null
          currency: string
          dj_response_note: string | null
          dj_user_id: string
          end_time: string | null
          event_id: string | null
          expires_at: string
          id: string
          message: string | null
          organizer_user_id: string | null
          requested_date: string
          requested_genres: string[]
          responded_at: string | null
          start_time: string | null
          status: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          agreed_fee?: number | null
          created_at?: string
          created_by?: string
          created_dj_set_id?: string | null
          currency?: string
          dj_response_note?: string | null
          dj_user_id: string
          end_time?: string | null
          event_id?: string | null
          expires_at?: string
          id?: string
          message?: string | null
          organizer_user_id?: string | null
          requested_date: string
          requested_genres?: string[]
          responded_at?: string | null
          start_time?: string | null
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          agreed_fee?: number | null
          created_at?: string
          created_by?: string
          created_dj_set_id?: string | null
          currency?: string
          dj_response_note?: string | null
          dj_user_id?: string
          end_time?: string | null
          event_id?: string | null
          expires_at?: string
          id?: string
          message?: string | null
          organizer_user_id?: string | null
          requested_date?: string
          requested_genres?: string[]
          responded_at?: string | null
          start_time?: string | null
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dj_booking_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_requests_created_dj_set_id_fkey"
            columns: ["created_dj_set_id"]
            isOneToOne: false
            referencedRelation: "dj_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_requests_dj_user_id_fkey"
            columns: ["dj_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_requests_dj_user_id_fkey"
            columns: ["dj_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_requests_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_requests_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_booking_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_handle_aliases: {
        Row: {
          created_at: string
          handle: string
          user_id: string
        }
        Insert: {
          created_at?: string
          handle: string
          user_id: string
        }
        Update: {
          created_at?: string
          handle?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dj_handle_aliases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_handle_aliases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_handles: {
        Row: {
          created_at: string
          handle: string
          user_id: string
        }
        Insert: {
          created_at?: string
          handle: string
          user_id: string
        }
        Update: {
          created_at?: string
          handle?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dj_handles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_handles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          first_name: string | null
          id: string
          instagram_url: string | null
          invited_by: string
          last_name: string | null
          music_genres: string[] | null
          organizer_user_id: string | null
          stage_name: string | null
          status: string
          token: string
          venue_id: string | null
          whatsapp_number: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          first_name?: string | null
          id?: string
          instagram_url?: string | null
          invited_by: string
          last_name?: string | null
          music_genres?: string[] | null
          organizer_user_id?: string | null
          stage_name?: string | null
          status?: string
          token?: string
          venue_id?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          first_name?: string | null
          id?: string
          instagram_url?: string | null
          invited_by?: string
          last_name?: string | null
          music_genres?: string[] | null
          organizer_user_id?: string | null
          stage_name?: string | null
          status?: string
          token?: string
          venue_id?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dj_invitations_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_invitations_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_invitations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_lineup_notifications: {
        Row: {
          dj_id: string
          event_id: string
          id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          dj_id: string
          event_id: string
          id?: string
          sent_at?: string
          user_id: string
        }
        Update: {
          dj_id?: string
          event_id?: string
          id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dj_lineup_notifications_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_lineup_notifications_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_lineup_notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_payments: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          dj_id: string
          dj_set_id: string | null
          id: string
          paid_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          description?: string | null
          dj_id: string
          dj_set_id?: string | null
          id?: string
          paid_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          dj_id?: string
          dj_set_id?: string | null
          id?: string
          paid_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dj_payments_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_payments_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_payments_dj_set_id_fkey"
            columns: ["dj_set_id"]
            isOneToOne: false
            referencedRelation: "dj_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_photos: {
        Row: {
          created_at: string
          id: string
          sort_order: number
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          sort_order?: number
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          sort_order?: number
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dj_photos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_photos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_rate_card: {
        Row: {
          currency: string
          is_public: boolean
          max_fee: number | null
          min_fee: number | null
          rate_note: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          currency?: string
          is_public?: boolean
          max_fee?: number | null
          min_fee?: number | null
          rate_note?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          currency?: string
          is_public?: boolean
          max_fee?: number | null
          min_fee?: number | null
          rate_note?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dj_rate_card_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_rate_card_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_residencies: {
        Row: {
          created_at: string
          created_by: string
          dj_user_id: string
          ended_at: string | null
          id: string
          organizer_user_id: string | null
          started_at: string | null
          status: string
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string
          dj_user_id: string
          ended_at?: string | null
          id?: string
          organizer_user_id?: string | null
          started_at?: string | null
          status?: string
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          dj_user_id?: string
          ended_at?: string | null
          id?: string
          organizer_user_id?: string | null
          started_at?: string | null
          status?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dj_residencies_dj_user_id_fkey"
            columns: ["dj_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_residencies_dj_user_id_fkey"
            columns: ["dj_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_residencies_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_residencies_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_residencies_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_sets: {
        Row: {
          created_at: string | null
          dj_id: string
          end_time: string
          event_id: string | null
          fee: number | null
          fee_paid: boolean | null
          fee_paid_at: string | null
          id: string
          music_genre: string | null
          notes: string | null
          organizer_user_id: string | null
          show_on_profile: boolean
          start_time: string
          title: string | null
          updated_at: string | null
          venue_id: string | null
        }
        Insert: {
          created_at?: string | null
          dj_id: string
          end_time: string
          event_id?: string | null
          fee?: number | null
          fee_paid?: boolean | null
          fee_paid_at?: string | null
          id?: string
          music_genre?: string | null
          notes?: string | null
          organizer_user_id?: string | null
          show_on_profile?: boolean
          start_time: string
          title?: string | null
          updated_at?: string | null
          venue_id?: string | null
        }
        Update: {
          created_at?: string | null
          dj_id?: string
          end_time?: string
          event_id?: string | null
          fee?: number | null
          fee_paid?: boolean | null
          fee_paid_at?: string | null
          id?: string
          music_genre?: string | null
          notes?: string | null
          organizer_user_id?: string | null
          show_on_profile?: boolean
          start_time?: string
          title?: string | null
          updated_at?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dj_sets_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_sets_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_sets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_sets_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_sets_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_sets_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_stripe_accounts: {
        Row: {
          charges_enabled: boolean
          created_at: string
          onboarded_at: string | null
          onboarding_complete: boolean
          payouts_enabled: boolean
          status: string
          stripe_account_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          charges_enabled?: boolean
          created_at?: string
          onboarded_at?: string | null
          onboarding_complete?: boolean
          payouts_enabled?: boolean
          status?: string
          stripe_account_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          charges_enabled?: boolean
          created_at?: string
          onboarded_at?: string | null
          onboarding_complete?: boolean
          payouts_enabled?: boolean
          status?: string
          stripe_account_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dj_stripe_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dj_stripe_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dj_team_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          dj_user_id: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          member_user_id: string | null
          role: string
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          dj_user_id: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          member_user_id?: string | null
          role?: string
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          dj_user_id?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          member_user_id?: string | null
          role?: string
          status?: string
          token?: string
        }
        Relationships: []
      }
      dj_team_members: {
        Row: {
          created_at: string
          dj_user_id: string
          id: string
          member_user_id: string
          role: string
          status: string
        }
        Insert: {
          created_at?: string
          dj_user_id: string
          id?: string
          member_user_id: string
          role?: string
          status?: string
        }
        Update: {
          created_at?: string
          dj_user_id?: string
          id?: string
          member_user_id?: string
          role?: string
          status?: string
        }
        Relationships: []
      }
      djs: {
        Row: {
          bio: string | null
          city: string | null
          country: string | null
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          featured_track_title: string | null
          featured_track_url: string | null
          first_name: string
          id: string
          instagram_url: string | null
          is_active: boolean | null
          is_verified: boolean | null
          last_name: string
          latitude: number | null
          longitude: number | null
          music_genres: string[] | null
          organizer_user_id: string | null
          pending_amount: number | null
          profile_image_url: string | null
          slug: string | null
          soundcloud_url: string | null
          spotify_url: string | null
          stage_name: string | null
          tiktok_url: string | null
          total_paid: number | null
          updated_at: string | null
          user_id: string
          venue_id: string | null
          whatsapp_number: string | null
          youtube_url: string | null
        }
        Insert: {
          bio?: string | null
          city?: string | null
          country?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          featured_track_title?: string | null
          featured_track_url?: string | null
          first_name: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean | null
          is_verified?: boolean | null
          last_name: string
          latitude?: number | null
          longitude?: number | null
          music_genres?: string[] | null
          organizer_user_id?: string | null
          pending_amount?: number | null
          profile_image_url?: string | null
          slug?: string | null
          soundcloud_url?: string | null
          spotify_url?: string | null
          stage_name?: string | null
          tiktok_url?: string | null
          total_paid?: number | null
          updated_at?: string | null
          user_id: string
          venue_id?: string | null
          whatsapp_number?: string | null
          youtube_url?: string | null
        }
        Update: {
          bio?: string | null
          city?: string | null
          country?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          featured_track_title?: string | null
          featured_track_url?: string | null
          first_name?: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean | null
          is_verified?: boolean | null
          last_name?: string
          latitude?: number | null
          longitude?: number | null
          music_genres?: string[] | null
          organizer_user_id?: string | null
          pending_amount?: number | null
          profile_image_url?: string | null
          slug?: string | null
          soundcloud_url?: string | null
          spotify_url?: string | null
          stage_name?: string | null
          tiktok_url?: string | null
          total_paid?: number | null
          updated_at?: string | null
          user_id?: string
          venue_id?: string | null
          whatsapp_number?: string | null
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "djs_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "djs_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "djs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      drink_catalog: {
        Row: {
          alc_pct: number | null
          brand: string | null
          category: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          image_url: string | null
          name: string
          updated_at: string | null
        }
        Insert: {
          alc_pct?: number | null
          brand?: string | null
          category?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          updated_at?: string | null
        }
        Update: {
          alc_pct?: number | null
          brand?: string | null
          category?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      drink_requests: {
        Row: {
          admin_notes: string | null
          brand: string | null
          catalog_drink_id: string | null
          category: string
          created_at: string | null
          description: string | null
          drink_name: string
          id: string
          image_url: string | null
          requested_by: string
          status: string
          updated_at: string | null
          venue_id: string
        }
        Insert: {
          admin_notes?: string | null
          brand?: string | null
          catalog_drink_id?: string | null
          category?: string
          created_at?: string | null
          description?: string | null
          drink_name: string
          id?: string
          image_url?: string | null
          requested_by: string
          status?: string
          updated_at?: string | null
          venue_id: string
        }
        Update: {
          admin_notes?: string | null
          brand?: string | null
          catalog_drink_id?: string | null
          category?: string
          created_at?: string | null
          description?: string | null
          drink_name?: string
          id?: string
          image_url?: string | null
          requested_by?: string
          status?: string
          updated_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drink_requests_catalog_drink_id_fkey"
            columns: ["catalog_drink_id"]
            isOneToOne: false
            referencedRelation: "drink_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drink_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      drinks: {
        Row: {
          active: boolean
          alc_pct: number | null
          collection: string
          created_at: string
          description: string | null
          id: string
          img_url: string
          name: string
          position: number | null
          presale_active: boolean
          presale_price: number | null
          price: number
          promo_price: number | null
          venue_id: string
        }
        Insert: {
          active?: boolean
          alc_pct?: number | null
          collection?: string
          created_at?: string
          description?: string | null
          id: string
          img_url: string
          name: string
          position?: number | null
          presale_active?: boolean
          presale_price?: number | null
          price: number
          promo_price?: number | null
          venue_id: string
        }
        Update: {
          active?: boolean
          alc_pct?: number | null
          collection?: string
          created_at?: string
          description?: string | null
          id?: string
          img_url?: string
          name?: string
          position?: number | null
          presale_active?: boolean
          presale_price?: number | null
          price?: number
          promo_price?: number | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drinks_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_events: {
        Row: {
          campaign_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          recipient_email: string
          resend_email_id: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          recipient_email: string
          resend_email_id?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          recipient_email?: string
          resend_email_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_recipients: {
        Row: {
          campaign_id: string
          created_at: string
          email: string
          error_message: string | null
          first_name: string | null
          id: string
          last_name: string | null
          resend_email_id: string | null
          sent_at: string | null
          status: string
          unsubscribe_token: string | null
          user_id: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          email: string
          error_message?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string
          unsubscribe_token?: string | null
          user_id?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          email?: string
          error_message?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string
          unsubscribe_token?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          audience_type: string | null
          blocks_json: Json
          clicks_count: number
          created_at: string
          created_by: string | null
          error_message: string | null
          event_id: string | null
          html_body: string | null
          id: string
          logo_url: string | null
          name: string
          opens_count: number
          organizer_user_id: string | null
          preheader: string | null
          recipients_count: number
          scheduled_at: string | null
          sent_at: string | null
          social_links_json: Json | null
          status: string
          subject: string
          theme_json: Json | null
          type: string | null
          unsubscribes_count: number
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          audience_type?: string | null
          blocks_json?: Json
          clicks_count?: number
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          event_id?: string | null
          html_body?: string | null
          id?: string
          logo_url?: string | null
          name: string
          opens_count?: number
          organizer_user_id?: string | null
          preheader?: string | null
          recipients_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          social_links_json?: Json | null
          status?: string
          subject: string
          theme_json?: Json | null
          type?: string | null
          unsubscribes_count?: number
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          audience_type?: string | null
          blocks_json?: Json
          clicks_count?: number
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          event_id?: string | null
          html_body?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          opens_count?: number
          organizer_user_id?: string | null
          preheader?: string | null
          recipients_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          social_links_json?: Json | null
          status?: string
          subject?: string
          theme_json?: Json | null
          type?: string | null
          unsubscribes_count?: number
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      email_change_requests: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          new_email: string | null
          old_email: string
          status: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          new_email?: string | null
          old_email: string
          status?: string
          token?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          new_email?: string | null
          old_email?: string
          status?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          blocks_json: Json | null
          category: string | null
          created_at: string
          editor_mode: string
          html_content: string
          id: string
          is_active: boolean
          name: string
          preview_text: string | null
          slug: string
          subject: string
          theme_json: Json | null
          updated_at: string
        }
        Insert: {
          blocks_json?: Json | null
          category?: string | null
          created_at?: string
          editor_mode?: string
          html_content: string
          id?: string
          is_active?: boolean
          name: string
          preview_text?: string | null
          slug: string
          subject: string
          theme_json?: Json | null
          updated_at?: string
        }
        Update: {
          blocks_json?: Json | null
          category?: string | null
          created_at?: string
          editor_mode?: string
          html_content?: string
          id?: string
          is_active?: boolean
          name?: string
          preview_text?: string | null
          slug?: string
          subject?: string
          theme_json?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      event_collab_action_requests: {
        Row: {
          action: string
          created_at: string
          event_id: string
          id: string
          organizer_approved: boolean
          organizer_user_id: string
          requested_by: string
          requested_by_role: string
          resolved_at: string | null
          scheduled_for: string | null
          status: string
          updated_at: string
          venue_approved: boolean
          venue_id: string
        }
        Insert: {
          action: string
          created_at?: string
          event_id: string
          id?: string
          organizer_approved?: boolean
          organizer_user_id: string
          requested_by: string
          requested_by_role: string
          resolved_at?: string | null
          scheduled_for?: string | null
          status?: string
          updated_at?: string
          venue_approved?: boolean
          venue_id: string
        }
        Update: {
          action?: string
          created_at?: string
          event_id?: string
          id?: string
          organizer_approved?: boolean
          organizer_user_id?: string
          requested_by?: string
          requested_by_role?: string
          resolved_at?: string | null
          scheduled_for?: string | null
          status?: string
          updated_at?: string
          venue_approved?: boolean
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_collab_action_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_action_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      event_collab_contracts: {
        Row: {
          auto_release_at: string | null
          cancellation_policy: string
          closed_at: string | null
          contract_pdf_url: string | null
          created_at: string
          created_by: string
          currency: string
          event_id: string
          id: string
          org_signed_at: string | null
          org_signed_by: string | null
          org_signed_ip: string | null
          org_signed_user_agent: string | null
          organizer_user_id: string
          partnership_id: string | null
          split_rules: Json
          status: string
          terms_snapshot: Json | null
          updated_at: string
          venue_id: string
          venue_signed_at: string | null
          venue_signed_by: string | null
          venue_signed_ip: string | null
          venue_signed_user_agent: string | null
        }
        Insert: {
          auto_release_at?: string | null
          cancellation_policy?: string
          closed_at?: string | null
          contract_pdf_url?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          event_id: string
          id?: string
          org_signed_at?: string | null
          org_signed_by?: string | null
          org_signed_ip?: string | null
          org_signed_user_agent?: string | null
          organizer_user_id: string
          partnership_id?: string | null
          split_rules: Json
          status?: string
          terms_snapshot?: Json | null
          updated_at?: string
          venue_id: string
          venue_signed_at?: string | null
          venue_signed_by?: string | null
          venue_signed_ip?: string | null
          venue_signed_user_agent?: string | null
        }
        Update: {
          auto_release_at?: string | null
          cancellation_policy?: string
          closed_at?: string | null
          contract_pdf_url?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          event_id?: string
          id?: string
          org_signed_at?: string | null
          org_signed_by?: string | null
          org_signed_ip?: string | null
          org_signed_user_agent?: string | null
          organizer_user_id?: string
          partnership_id?: string | null
          split_rules?: Json
          status?: string
          terms_snapshot?: Json | null
          updated_at?: string
          venue_id?: string
          venue_signed_at?: string | null
          venue_signed_by?: string | null
          venue_signed_ip?: string | null
          venue_signed_user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_collab_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_contracts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_contracts_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_contracts_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_contracts_partnership_id_fkey"
            columns: ["partnership_id"]
            isOneToOne: false
            referencedRelation: "venue_organizer_partnerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_contracts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      event_collab_invitations: {
        Row: {
          created_at: string
          event_id: string
          id: string
          invited_by: string
          message: string | null
          responded_at: string | null
          status: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          invited_by: string
          message?: string | null
          responded_at?: string | null
          status?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          invited_by?: string
          message?: string | null
          responded_at?: string | null
          status?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_collab_invitations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_invitations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      event_collab_messages: {
        Row: {
          author_role: string
          author_user_id: string
          body: string
          created_at: string
          event_id: string
          id: string
        }
        Insert: {
          author_role: string
          author_user_id: string
          body: string
          created_at?: string
          event_id: string
          id?: string
        }
        Update: {
          author_role?: string
          author_user_id?: string
          body?: string
          created_at?: string
          event_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_collab_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_collab_series_contracts: {
        Row: {
          cancellation_policy: string
          contract_pdf_url: string | null
          created_at: string
          created_by: string
          currency: string
          id: string
          org_signed_at: string | null
          org_signed_by: string | null
          org_signed_ip: string | null
          org_signed_user_agent: string | null
          organizer_user_id: string
          partnership_id: string | null
          split_rules: Json
          status: string
          template_id: string
          terminated_at: string | null
          terminated_by: string | null
          terms_snapshot: Json | null
          updated_at: string
          venue_id: string
          venue_signed_at: string | null
          venue_signed_by: string | null
          venue_signed_ip: string | null
          venue_signed_user_agent: string | null
        }
        Insert: {
          cancellation_policy?: string
          contract_pdf_url?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          org_signed_at?: string | null
          org_signed_by?: string | null
          org_signed_ip?: string | null
          org_signed_user_agent?: string | null
          organizer_user_id: string
          partnership_id?: string | null
          split_rules: Json
          status?: string
          template_id: string
          terminated_at?: string | null
          terminated_by?: string | null
          terms_snapshot?: Json | null
          updated_at?: string
          venue_id: string
          venue_signed_at?: string | null
          venue_signed_by?: string | null
          venue_signed_ip?: string | null
          venue_signed_user_agent?: string | null
        }
        Update: {
          cancellation_policy?: string
          contract_pdf_url?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          org_signed_at?: string | null
          org_signed_by?: string | null
          org_signed_ip?: string | null
          org_signed_user_agent?: string | null
          organizer_user_id?: string
          partnership_id?: string | null
          split_rules?: Json
          status?: string
          template_id?: string
          terminated_at?: string | null
          terminated_by?: string | null
          terms_snapshot?: Json | null
          updated_at?: string
          venue_id?: string
          venue_signed_at?: string | null
          venue_signed_by?: string | null
          venue_signed_ip?: string | null
          venue_signed_user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_collab_series_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_series_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_series_contracts_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_series_contracts_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_series_contracts_partnership_id_fkey"
            columns: ["partnership_id"]
            isOneToOne: false
            referencedRelation: "venue_organizer_partnerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_series_contracts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: true
            referencedRelation: "owner_recurring_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collab_series_contracts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      event_djs: {
        Row: {
          created_at: string
          dj_id: string
          event_id: string
          id: string
        }
        Insert: {
          created_at?: string
          dj_id: string
          event_id: string
          id?: string
        }
        Update: {
          created_at?: string
          dj_id?: string
          event_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_djs_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_djs_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_djs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_notes: {
        Row: {
          created_at: string
          event_id: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_notes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_recap_sent: {
        Row: {
          email: string
          event_id: string
          id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          email: string
          event_id: string
          id?: string
          sent_at?: string
          user_id: string
        }
        Update: {
          email?: string
          event_id?: string
          id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_recap_sent_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_sale_access: {
        Row: {
          event_id: string
          granted_at: string
          guest_email: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          event_id: string
          granted_at?: string
          guest_email?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          event_id?: string
          granted_at?: string
          guest_email?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_sale_access_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_sale_protection: {
        Row: {
          event_id: string
          password_hash: string
          updated_at: string
        }
        Insert: {
          event_id: string
          password_hash: string
          updated_at?: string
        }
        Update: {
          event_id?: string
          password_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_sale_protection_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_scarcity_settings: {
        Row: {
          created_at: string | null
          display_cap_enabled: boolean | null
          display_cap_value: number | null
          display_caps_per_round: Json
          emoji_enabled: boolean
          event_id: string
          id: string
          low_stock_enabled: boolean | null
          low_stock_label: string | null
          low_stock_percent: number | null
          show_remaining_count: boolean | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_cap_enabled?: boolean | null
          display_cap_value?: number | null
          display_caps_per_round?: Json
          emoji_enabled?: boolean
          event_id: string
          id?: string
          low_stock_enabled?: boolean | null
          low_stock_label?: string | null
          low_stock_percent?: number | null
          show_remaining_count?: boolean | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_cap_enabled?: boolean | null
          display_cap_value?: number | null
          display_caps_per_round?: Json
          emoji_enabled?: boolean
          event_id?: string
          id?: string
          low_stock_enabled?: boolean | null
          low_stock_label?: string | null
          low_stock_percent?: number | null
          show_remaining_count?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_scarcity_settings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_table_settings: {
        Row: {
          created_at: string
          custom_prices: Json | null
          event_id: string
          id: string
          preset_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_prices?: Json | null
          event_id: string
          id?: string
          preset_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_prices?: Json | null
          event_id?: string
          id?: string
          preset_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_table_settings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_table_settings_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "table_pack_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      event_waitlist: {
        Row: {
          created_at: string | null
          email: string
          event_id: string
          full_name: string | null
          id: string
          presale_access: boolean | null
          show_in_orders: boolean
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          event_id: string
          full_name?: string | null
          id?: string
          presale_access?: boolean | null
          show_in_orders?: boolean
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          event_id?: string
          full_name?: string | null
          id?: string
          presale_access?: boolean | null
          show_in_orders?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_waitlist_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          access_code: string | null
          alcohol_free: boolean
          banner_position: Json | null
          cancellation_reason: string | null
          cancelled_at: string | null
          collab_goal_type: string | null
          collab_goal_value: number | null
          collab_paused_at: string | null
          created_at: string
          description: string | null
          discovery_status: Database["public"]["Enums"]["discovery_status"]
          end_at: string
          event_kind: Database["public"]["Enums"]["event_kind"]
          event_mode: Database["public"]["Enums"]["event_mode"] | null
          event_type: string
          hide_yuno_navigation: boolean
          id: string
          image_url: string | null
          is_active: boolean
          is_bde: boolean
          is_discoverable: boolean
          location_address: string | null
          location_city: string | null
          location_is_secret: boolean | null
          location_name: string | null
          max_tickets: number | null
          max_tickets_per_person: number | null
          minors_disabled: boolean
          music_genre: string
          music_genres: string[] | null
          organizer_user_id: string | null
          partner_organizer_id: string | null
          partner_venue_id: string | null
          poster_position: Json | null
          poster_url: string | null
          presale_start_at: string | null
          public_sale_start_at: string | null
          recurring_template_id: string | null
          requires_access_code: boolean
          reveal_address_in_email: boolean
          revenue_split_proposal: Json | null
          revenue_split_rules: Json | null
          rounds_visibility: string | null
          sale_password_enabled: boolean
          split_approved_by_organizer: boolean
          split_approved_by_venue: boolean
          split_locked_at: string | null
          split_proposed_at: string | null
          split_proposed_by: string | null
          start_at: string
          status: string
          tables_enabled: boolean
          tables_locked_to_venue: boolean
          tables_mode: string | null
          tables_owner_user_id: string | null
          ticket_selling_mode: string | null
          ticketing_enabled: boolean
          title: string
          updated_at: string
          venue_id: string | null
          visibility: Database["public"]["Enums"]["event_visibility"]
          waitlist_enabled: boolean | null
        }
        Insert: {
          access_code?: string | null
          alcohol_free?: boolean
          banner_position?: Json | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          collab_goal_type?: string | null
          collab_goal_value?: number | null
          collab_paused_at?: string | null
          created_at?: string
          description?: string | null
          discovery_status?: Database["public"]["Enums"]["discovery_status"]
          end_at: string
          event_kind?: Database["public"]["Enums"]["event_kind"]
          event_mode?: Database["public"]["Enums"]["event_mode"] | null
          event_type?: string
          hide_yuno_navigation?: boolean
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_bde?: boolean
          is_discoverable?: boolean
          location_address?: string | null
          location_city?: string | null
          location_is_secret?: boolean | null
          location_name?: string | null
          max_tickets?: number | null
          max_tickets_per_person?: number | null
          minors_disabled?: boolean
          music_genre?: string
          music_genres?: string[] | null
          organizer_user_id?: string | null
          partner_organizer_id?: string | null
          partner_venue_id?: string | null
          poster_position?: Json | null
          poster_url?: string | null
          presale_start_at?: string | null
          public_sale_start_at?: string | null
          recurring_template_id?: string | null
          requires_access_code?: boolean
          reveal_address_in_email?: boolean
          revenue_split_proposal?: Json | null
          revenue_split_rules?: Json | null
          rounds_visibility?: string | null
          sale_password_enabled?: boolean
          split_approved_by_organizer?: boolean
          split_approved_by_venue?: boolean
          split_locked_at?: string | null
          split_proposed_at?: string | null
          split_proposed_by?: string | null
          start_at: string
          status?: string
          tables_enabled?: boolean
          tables_locked_to_venue?: boolean
          tables_mode?: string | null
          tables_owner_user_id?: string | null
          ticket_selling_mode?: string | null
          ticketing_enabled?: boolean
          title: string
          updated_at?: string
          venue_id?: string | null
          visibility?: Database["public"]["Enums"]["event_visibility"]
          waitlist_enabled?: boolean | null
        }
        Update: {
          access_code?: string | null
          alcohol_free?: boolean
          banner_position?: Json | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          collab_goal_type?: string | null
          collab_goal_value?: number | null
          collab_paused_at?: string | null
          created_at?: string
          description?: string | null
          discovery_status?: Database["public"]["Enums"]["discovery_status"]
          end_at?: string
          event_kind?: Database["public"]["Enums"]["event_kind"]
          event_mode?: Database["public"]["Enums"]["event_mode"] | null
          event_type?: string
          hide_yuno_navigation?: boolean
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_bde?: boolean
          is_discoverable?: boolean
          location_address?: string | null
          location_city?: string | null
          location_is_secret?: boolean | null
          location_name?: string | null
          max_tickets?: number | null
          max_tickets_per_person?: number | null
          minors_disabled?: boolean
          music_genre?: string
          music_genres?: string[] | null
          organizer_user_id?: string | null
          partner_organizer_id?: string | null
          partner_venue_id?: string | null
          poster_position?: Json | null
          poster_url?: string | null
          presale_start_at?: string | null
          public_sale_start_at?: string | null
          recurring_template_id?: string | null
          requires_access_code?: boolean
          reveal_address_in_email?: boolean
          revenue_split_proposal?: Json | null
          revenue_split_rules?: Json | null
          rounds_visibility?: string | null
          sale_password_enabled?: boolean
          split_approved_by_organizer?: boolean
          split_approved_by_venue?: boolean
          split_locked_at?: string | null
          split_proposed_at?: string | null
          split_proposed_by?: string | null
          start_at?: string
          status?: string
          tables_enabled?: boolean
          tables_locked_to_venue?: boolean
          tables_mode?: string | null
          tables_owner_user_id?: string | null
          ticket_selling_mode?: string | null
          ticketing_enabled?: boolean
          title?: string
          updated_at?: string
          venue_id?: string | null
          visibility?: Database["public"]["Enums"]["event_visibility"]
          waitlist_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "events_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_partner_organizer_id_fkey"
            columns: ["partner_organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_partner_organizer_id_fkey"
            columns: ["partner_organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_partner_venue_id_fkey"
            columns: ["partner_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_recurring_template_id_fkey"
            columns: ["recurring_template_id"]
            isOneToOne: false
            referencedRelation: "owner_recurring_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          affiliate_event_id: string | null
          affiliate_venue_id: string | null
          created_at: string
          dj_id: string | null
          drink_id: string | null
          event_id: string | null
          favorite_type: string
          id: string
          notify_all_locations: boolean
          user_id: string
          venue_id: string | null
        }
        Insert: {
          affiliate_event_id?: string | null
          affiliate_venue_id?: string | null
          created_at?: string
          dj_id?: string | null
          drink_id?: string | null
          event_id?: string | null
          favorite_type: string
          id?: string
          notify_all_locations?: boolean
          user_id: string
          venue_id?: string | null
        }
        Update: {
          affiliate_event_id?: string | null
          affiliate_venue_id?: string | null
          created_at?: string
          dj_id?: string | null
          drink_id?: string | null
          event_id?: string | null
          favorite_type?: string
          id?: string
          notify_all_locations?: boolean
          user_id?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "favorites_affiliate_event_id_fkey"
            columns: ["affiliate_event_id"]
            isOneToOne: false
            referencedRelation: "affiliate_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_affiliate_venue_id_fkey"
            columns: ["affiliate_venue_id"]
            isOneToOne: false
            referencedRelation: "affiliate_venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_drink_id_fkey"
            columns: ["drink_id"]
            isOneToOne: false
            referencedRelation: "drinks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_issues: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          description: string | null
          id: string
          priority: string
          reported_by: string | null
          resolved_at: string | null
          status: string
          title: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          priority?: string
          reported_by?: string | null
          resolved_at?: string | null
          status?: string
          title: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          priority?: string
          reported_by?: string | null
          resolved_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_issues_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_claim_otps: {
        Row: {
          attempts: number
          created_at: string | null
          email: string
          expires_at: string
          id: string
          order_id: string
          otp_code: string
          verified: boolean | null
        }
        Insert: {
          attempts?: number
          created_at?: string | null
          email: string
          expires_at?: string
          id?: string
          order_id: string
          otp_code: string
          verified?: boolean | null
        }
        Update: {
          attempts?: number
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          order_id?: string
          otp_code?: string
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_claim_otps_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_list_entries: {
        Row: {
          created_at: string
          email: string
          entry_deadline: string | null
          entry_scanned: boolean
          entry_scanned_at: string | null
          entry_scanned_by: string | null
          entry_type: string | null
          full_name: string
          gender: string | null
          guest_list_id: string
          id: string
          phone: string
          promoter_id: string | null
          qr_code: string
          reservation_code: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          entry_deadline?: string | null
          entry_scanned?: boolean
          entry_scanned_at?: string | null
          entry_scanned_by?: string | null
          entry_type?: string | null
          full_name: string
          gender?: string | null
          guest_list_id: string
          id?: string
          phone: string
          promoter_id?: string | null
          qr_code: string
          reservation_code?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          entry_deadline?: string | null
          entry_scanned?: boolean
          entry_scanned_at?: string | null
          entry_scanned_by?: string | null
          entry_type?: string | null
          full_name?: string
          gender?: string | null
          guest_list_id?: string
          id?: string
          phone?: string
          promoter_id?: string | null
          qr_code?: string
          reservation_code?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_list_entries_guest_list_id_fkey"
            columns: ["guest_list_id"]
            isOneToOne: false
            referencedRelation: "guest_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_list_entries_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_list_templates: {
        Row: {
          created_at: string
          entry_deadline: string | null
          entry_kind: string
          free_before_time: string
          holder_type: string
          id: string
          includes_drink: boolean
          is_default: boolean
          name: string
          organizer_user_id: string | null
          quota: number
          quota_drink: number
          quota_female: number | null
          quota_male: number | null
          quota_normal: number
          quota_table: number
          target_mode: string
          venue_id: string | null
          visible_on_club_page: boolean
        }
        Insert: {
          created_at?: string
          entry_deadline?: string | null
          entry_kind?: string
          free_before_time?: string
          holder_type?: string
          id?: string
          includes_drink?: boolean
          is_default?: boolean
          name: string
          organizer_user_id?: string | null
          quota?: number
          quota_drink?: number
          quota_female?: number | null
          quota_male?: number | null
          quota_normal?: number
          quota_table?: number
          target_mode?: string
          venue_id?: string | null
          visible_on_club_page?: boolean
        }
        Update: {
          created_at?: string
          entry_deadline?: string | null
          entry_kind?: string
          free_before_time?: string
          holder_type?: string
          id?: string
          includes_drink?: boolean
          is_default?: boolean
          name?: string
          organizer_user_id?: string | null
          quota?: number
          quota_drink?: number
          quota_female?: number | null
          quota_male?: number | null
          quota_normal?: number
          quota_table?: number
          target_mode?: string
          venue_id?: string | null
          visible_on_club_page?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "guest_list_templates_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_lists: {
        Row: {
          created_at: string
          dj_id: string | null
          entry_deadline: string | null
          entry_kind: string
          event_id: string
          free_before_time: string
          holder_label: string | null
          holder_type: string
          id: string
          includes_drink: boolean
          is_active: boolean
          organizer_user_id: string | null
          promoter_id: string | null
          quota: number
          quota_drink: number
          quota_female: number | null
          quota_male: number | null
          quota_normal: number
          quota_table: number
          share_token: string
          updated_at: string
          venue_id: string | null
          visible_on_club_page: boolean
        }
        Insert: {
          created_at?: string
          dj_id?: string | null
          entry_deadline?: string | null
          entry_kind?: string
          event_id: string
          free_before_time?: string
          holder_label?: string | null
          holder_type?: string
          id?: string
          includes_drink?: boolean
          is_active?: boolean
          organizer_user_id?: string | null
          promoter_id?: string | null
          quota?: number
          quota_drink?: number
          quota_female?: number | null
          quota_male?: number | null
          quota_normal?: number
          quota_table?: number
          share_token?: string
          updated_at?: string
          venue_id?: string | null
          visible_on_club_page?: boolean
        }
        Update: {
          created_at?: string
          dj_id?: string | null
          entry_deadline?: string | null
          entry_kind?: string
          event_id?: string
          free_before_time?: string
          holder_label?: string | null
          holder_type?: string
          id?: string
          includes_drink?: boolean
          is_active?: boolean
          organizer_user_id?: string | null
          promoter_id?: string | null
          quota?: number
          quota_drink?: number
          quota_female?: number | null
          quota_male?: number | null
          quota_normal?: number
          quota_table?: number
          share_token?: string
          updated_at?: string
          venue_id?: string | null
          visible_on_club_page?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "guest_lists_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_lists_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_lists_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_lists_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_lists_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_numbers: {
        Row: {
          created_at: string | null
          id: string
          invoice_number: string
          order_id: string | null
          organizer_user_id: string | null
          table_reservation_id: string | null
          ticket_id: string | null
          venue_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_number: string
          order_id?: string | null
          organizer_user_id?: string | null
          table_reservation_id?: string | null
          ticket_id?: string | null
          venue_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_number?: string
          order_id?: string | null
          organizer_user_id?: string | null
          table_reservation_id?: string | null
          ticket_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_numbers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_numbers_table_reservation_id_fkey"
            columns: ["table_reservation_id"]
            isOneToOne: false
            referencedRelation: "table_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_numbers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_numbers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_drink_redemption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_numbers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_entry_scan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_numbers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          created_at: string
          customer_email: string
          customer_name: string | null
          customer_phone: string | null
          event_date: string | null
          event_id: string | null
          event_name: string | null
          event_poster: string | null
          expires_at: string
          id: string
          insurance_fee: number | null
          invoice_number: string
          items: Json | null
          management_fee: number | null
          order_id: string | null
          organizer_user_id: string | null
          qr_code: string | null
          service_fee: number | null
          table_reservation_id: string | null
          ticket_id: string | null
          total_ht: number
          tva: number
          type: string
          venue_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          customer_email: string
          customer_name?: string | null
          customer_phone?: string | null
          event_date?: string | null
          event_id?: string | null
          event_name?: string | null
          event_poster?: string | null
          expires_at?: string
          id?: string
          insurance_fee?: number | null
          invoice_number: string
          items?: Json | null
          management_fee?: number | null
          order_id?: string | null
          organizer_user_id?: string | null
          qr_code?: string | null
          service_fee?: number | null
          table_reservation_id?: string | null
          ticket_id?: string | null
          total_ht?: number
          tva?: number
          type: string
          venue_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          customer_email?: string
          customer_name?: string | null
          customer_phone?: string | null
          event_date?: string | null
          event_id?: string | null
          event_name?: string | null
          event_poster?: string | null
          expires_at?: string
          id?: string
          insurance_fee?: number | null
          invoice_number?: string
          items?: Json | null
          management_fee?: number | null
          order_id?: string | null
          organizer_user_id?: string | null
          qr_code?: string | null
          service_fee?: number | null
          table_reservation_id?: string | null
          ticket_id?: string | null
          total_ht?: number
          tva?: number
          type?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_waitlist: {
        Row: {
          city: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          notified_at: string | null
          phone: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          notified_at?: string | null
          phone?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          notified_at?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      leaderboard_contest_scores: {
        Row: {
          contest_id: string
          id: string
          order_count: number
          rank: number | null
          score: number
          spend: number
          table_count: number
          ticket_count: number
          updated_at: string
          user_id: string
          venue_id: string
        }
        Insert: {
          contest_id: string
          id?: string
          order_count?: number
          rank?: number | null
          score?: number
          spend?: number
          table_count?: number
          ticket_count?: number
          updated_at?: string
          user_id: string
          venue_id: string
        }
        Update: {
          contest_id?: string
          id?: string
          order_count?: number
          rank?: number | null
          score?: number
          spend?: number
          table_count?: number
          ticket_count?: number
          updated_at?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_contest_scores_contest_id_fkey"
            columns: ["contest_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_contests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboard_contest_scores_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_contest_winners: {
        Row: {
          contest_id: string
          created_at: string
          id: string
          rank: number
          redeemed: boolean
          redeemed_at: string | null
          redemption_id: string | null
          reward_config: Json | null
          reward_description: string | null
          reward_type: string
          score: number
          user_id: string
          venue_id: string
        }
        Insert: {
          contest_id: string
          created_at?: string
          id?: string
          rank: number
          redeemed?: boolean
          redeemed_at?: string | null
          redemption_id?: string | null
          reward_config?: Json | null
          reward_description?: string | null
          reward_type: string
          score?: number
          user_id: string
          venue_id: string
        }
        Update: {
          contest_id?: string
          created_at?: string
          id?: string
          rank?: number
          redeemed?: boolean
          redeemed_at?: string | null
          redemption_id?: string | null
          reward_config?: Json | null
          reward_description?: string | null
          reward_type?: string
          score?: number
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_contest_winners_contest_id_fkey"
            columns: ["contest_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_contests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboard_contest_winners_redemption_id_fkey"
            columns: ["redemption_id"]
            isOneToOne: false
            referencedRelation: "reward_redemptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboard_contest_winners_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_contests: {
        Row: {
          auto_reward: boolean
          contest_type: string
          created_at: string
          end_date: string
          event_id: string | null
          id: string
          name: string
          reward_preset_ids: string[] | null
          rewards_distributed: boolean
          scoring_config: Json | null
          start_date: string
          status: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          auto_reward?: boolean
          contest_type?: string
          created_at?: string
          end_date: string
          event_id?: string | null
          id?: string
          name?: string
          reward_preset_ids?: string[] | null
          rewards_distributed?: boolean
          scoring_config?: Json | null
          start_date?: string
          status?: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          auto_reward?: boolean
          contest_type?: string
          created_at?: string
          end_date?: string
          event_id?: string | null
          id?: string
          name?: string
          reward_preset_ids?: string[] | null
          rewards_distributed?: boolean
          scoring_config?: Json | null
          start_date?: string
          status?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_contests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboard_contests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_rewards: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          rank_max: number
          rank_min: number
          reward_config: Json | null
          reward_description: string | null
          reward_type: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          rank_max: number
          rank_min: number
          reward_config?: Json | null
          reward_description?: string | null
          reward_type?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          rank_max?: number
          rank_min?: number
          reward_config?: Json | null
          reward_description?: string | null
          reward_type?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_rewards_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_settings: {
        Row: {
          auto_reward: boolean
          contest_event_id: string | null
          created_at: string
          event_weight: number
          id: string
          is_enabled: boolean
          leaderboard_type: string
          recency_days: number
          recency_enabled: boolean
          show_top_count: number
          spend_weight: number
          updated_at: string
          venue_id: string
          vip_weight: number
          visit_weight: number
        }
        Insert: {
          auto_reward?: boolean
          contest_event_id?: string | null
          created_at?: string
          event_weight?: number
          id?: string
          is_enabled?: boolean
          leaderboard_type?: string
          recency_days?: number
          recency_enabled?: boolean
          show_top_count?: number
          spend_weight?: number
          updated_at?: string
          venue_id: string
          vip_weight?: number
          visit_weight?: number
        }
        Update: {
          auto_reward?: boolean
          contest_event_id?: string | null
          created_at?: string
          event_weight?: number
          id?: string
          is_enabled?: boolean
          leaderboard_type?: string
          recency_days?: number
          recency_enabled?: boolean
          show_top_count?: number
          spend_weight?: number
          updated_at?: string
          venue_id?: string
          vip_weight?: number
          visit_weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_settings_contest_event_id_fkey"
            columns: ["contest_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboard_settings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      live_visitor_pings: {
        Row: {
          cart_value_cents: number | null
          created_at: string
          event_id: string | null
          id: string
          last_seen: string
          organizer_user_id: string | null
          page_path: string | null
          session_id: string
          stage: string
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          cart_value_cents?: number | null
          created_at?: string
          event_id?: string | null
          id?: string
          last_seen?: string
          organizer_user_id?: string | null
          page_path?: string | null
          session_id: string
          stage?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          cart_value_cents?: number | null
          created_at?: string
          event_id?: string | null
          id?: string
          last_seen?: string
          organizer_user_id?: string | null
          page_path?: string | null
          session_id?: string
          stage?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: []
      }
      loyalty_rewards: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          max_redemptions: number | null
          name: string
          points_required: number
          position: number | null
          redemption_count: number | null
          reward_type: string
          reward_value: Json | null
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_redemptions?: number | null
          name: string
          points_required: number
          position?: number | null
          redemption_count?: number | null
          reward_type: string
          reward_value?: Json | null
          venue_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_redemptions?: number | null
          name?: string
          points_required?: number
          position?: number | null
          redemption_count?: number | null
          reward_type?: string
          reward_value?: Json | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_rewards_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_settings: {
        Row: {
          created_at: string | null
          id: string
          is_enabled: boolean | null
          points_per_euro: number | null
          post_visit_message: string | null
          post_visit_notification: boolean | null
          updated_at: string | null
          venue_id: string
          welcome_bonus: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          points_per_euro?: number | null
          post_visit_message?: string | null
          post_visit_notification?: boolean | null
          updated_at?: string | null
          venue_id: string
          welcome_bonus?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          points_per_euro?: number | null
          post_visit_message?: string | null
          post_visit_notification?: boolean | null
          updated_at?: string | null
          venue_id?: string
          welcome_bonus?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_settings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          created_at: string | null
          customer_loyalty_id: string
          description: string | null
          id: string
          points: number
          reference_id: string | null
          reference_type: string | null
          transaction_type: string
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          customer_loyalty_id: string
          description?: string | null
          id?: string
          points: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_type: string
          venue_id: string
        }
        Update: {
          created_at?: string | null
          customer_loyalty_id?: string
          description?: string | null
          id?: string
          points?: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_type?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_customer_loyalty_id_fkey"
            columns: ["customer_loyalty_id"]
            isOneToOne: false
            referencedRelation: "customer_loyalty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_permissions: {
        Row: {
          can_manage_crm: boolean | null
          can_manage_djs: boolean | null
          can_manage_events: boolean | null
          can_manage_guest_list: boolean | null
          can_manage_invoices: boolean | null
          can_manage_loyalty: boolean | null
          can_manage_menu: boolean | null
          can_manage_organizations: boolean
          can_manage_promoters: boolean | null
          can_manage_refunds: boolean | null
          can_manage_scarcity: boolean
          can_manage_staff: boolean | null
          can_manage_tables: boolean | null
          can_manage_tickets: boolean | null
          can_manage_upsell: boolean | null
          can_manage_venue: boolean | null
          can_manage_vip_service: boolean
          can_view_analytics: boolean | null
          can_view_customers: boolean | null
          can_view_finance: boolean | null
          can_view_hype: boolean | null
          can_view_live: boolean
          can_view_orders: boolean | null
          created_at: string | null
          id: string
          updated_at: string | null
          user_id: string
          venue_id: string
        }
        Insert: {
          can_manage_crm?: boolean | null
          can_manage_djs?: boolean | null
          can_manage_events?: boolean | null
          can_manage_guest_list?: boolean | null
          can_manage_invoices?: boolean | null
          can_manage_loyalty?: boolean | null
          can_manage_menu?: boolean | null
          can_manage_organizations?: boolean
          can_manage_promoters?: boolean | null
          can_manage_refunds?: boolean | null
          can_manage_scarcity?: boolean
          can_manage_staff?: boolean | null
          can_manage_tables?: boolean | null
          can_manage_tickets?: boolean | null
          can_manage_upsell?: boolean | null
          can_manage_venue?: boolean | null
          can_manage_vip_service?: boolean
          can_view_analytics?: boolean | null
          can_view_customers?: boolean | null
          can_view_finance?: boolean | null
          can_view_hype?: boolean | null
          can_view_live?: boolean
          can_view_orders?: boolean | null
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
          venue_id: string
        }
        Update: {
          can_manage_crm?: boolean | null
          can_manage_djs?: boolean | null
          can_manage_events?: boolean | null
          can_manage_guest_list?: boolean | null
          can_manage_invoices?: boolean | null
          can_manage_loyalty?: boolean | null
          can_manage_menu?: boolean | null
          can_manage_organizations?: boolean
          can_manage_promoters?: boolean | null
          can_manage_refunds?: boolean | null
          can_manage_scarcity?: boolean
          can_manage_staff?: boolean | null
          can_manage_tables?: boolean | null
          can_manage_tickets?: boolean | null
          can_manage_upsell?: boolean | null
          can_manage_venue?: boolean | null
          can_manage_vip_service?: boolean
          can_view_analytics?: boolean | null
          can_view_customers?: boolean | null
          can_view_finance?: boolean | null
          can_view_hype?: boolean | null
          can_view_live?: boolean
          can_view_orders?: boolean | null
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_permissions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_disable_requests: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          ip_address: string | null
          token: string
          used: boolean
          used_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          token: string
          used?: boolean
          used_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          token?: string
          used?: boolean
          used_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mfa_pending: {
        Row: {
          created_at: string
          secret: string
          user_id: string
        }
        Insert: {
          created_at?: string
          secret: string
          user_id: string
        }
        Update: {
          created_at?: string
          secret?: string
          user_id?: string
        }
        Relationships: []
      }
      mfa_recovery_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          used: boolean
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          used?: boolean
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          used?: boolean
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mfa_secrets: {
        Row: {
          created_at: string
          secret_encrypted: string | null
          user_id: string
          vault_secret_id: string | null
        }
        Insert: {
          created_at?: string
          secret_encrypted?: string | null
          user_id: string
          vault_secret_id?: string | null
        }
        Update: {
          created_at?: string
          secret_encrypted?: string | null
          user_id?: string
          vault_secret_id?: string | null
        }
        Relationships: []
      }
      minor_ticket_docs: {
        Row: {
          birth_date: string | null
          buyer_email: string
          buyer_name: string | null
          created_at: string
          doc_name: string | null
          doc_url: string | null
          event_id: string
          id: string
        }
        Insert: {
          birth_date?: string | null
          buyer_email: string
          buyer_name?: string | null
          created_at?: string
          doc_name?: string | null
          doc_url?: string | null
          event_id: string
          id?: string
        }
        Update: {
          birth_date?: string | null
          buyer_email?: string
          buyer_name?: string | null
          created_at?: string
          doc_name?: string | null
          doc_url?: string | null
          event_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "minor_ticket_docs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_subscriptions: {
        Row: {
          created_at: string
          email: string
          id: string
          opted_in: boolean
          opted_out_at: string | null
          organizer_user_id: string | null
          source: string | null
          unsubscribe_token: string
          updated_at: string
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          opted_in?: boolean
          opted_out_at?: string | null
          organizer_user_id?: string | null
          source?: string | null
          unsubscribe_token?: string
          updated_at?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          opted_in?: boolean
          opted_out_at?: string | null
          organizer_user_id?: string | null
          source?: string | null
          unsubscribe_token?: string
          updated_at?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_subscriptions_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_subscriptions_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_subscriptions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          id: string
          notification_type: string
          sent_at: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          id?: string
          notification_type: string
          sent_at?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          id?: string
          notification_type?: string
          sent_at?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      onboarding_link_redemptions: {
        Row: {
          id: string
          link_id: string
          redeemed_at: string
          role: string
          user_id: string
        }
        Insert: {
          id?: string
          link_id: string
          redeemed_at?: string
          role: string
          user_id: string
        }
        Update: {
          id?: string
          link_id?: string
          redeemed_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_link_redemptions_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "onboarding_links"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_links: {
        Row: {
          config: Json
          created_at: string
          created_by: string
          expires_at: string
          id: string
          is_active: boolean
          label: string | null
          max_uses: number | null
          organizer_user_id: string | null
          revoked_at: string | null
          role: string
          token: string
          used_count: number
          venue_id: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          max_uses?: number | null
          organizer_user_id?: string | null
          revoked_at?: string | null
          role: string
          token?: string
          used_count?: number
          venue_id?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          max_uses?: number | null
          organizer_user_id?: string | null
          revoked_at?: string | null
          role?: string
          token?: string
          used_count?: number
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_links_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      order_pack_credits: {
        Row: {
          created_at: string
          event_id: string | null
          expires_at: string | null
          id: string
          pack_id: string
          ticket_order_id: string | null
          total_credits: number
          used_credits: number
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          expires_at?: string | null
          id?: string
          pack_id: string
          ticket_order_id?: string | null
          total_credits: number
          used_credits?: number
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          expires_at?: string | null
          id?: string
          pack_id?: string
          ticket_order_id?: string | null
          total_credits?: number
          used_credits?: number
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_pack_credits_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_pack_credits_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          age_declaration_birth_date: string | null
          age_declaration_ip: string | null
          age_declared_at: string | null
          archived: boolean | null
          assigned_bar: string | null
          claimed_at: string | null
          claimed_by_user_id: string | null
          created_at: string
          event_id: string | null
          fee_absorbed: boolean
          guest_first_name: string | null
          guest_last_name: string | null
          guest_phone: string | null
          id: string
          is_guest: boolean | null
          items: Json
          notify_status: string | null
          order_number: string | null
          paid_at: string | null
          post_visit_notified: boolean
          prep_claimed_at: string | null
          prep_claimed_by: string | null
          prep_requested: boolean | null
          prep_status: string | null
          ready_at: string | null
          refund_amount: number | null
          refund_reason: string | null
          refunded_at: string | null
          refunded_by: string | null
          selected_bar: string | null
          served_at: string | null
          service_fee: number | null
          status: string
          stripe_connected_account_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          token: string | null
          token_expires_at: string | null
          token_used: boolean | null
          total: number
          tracked_link_id: string | null
          user_email: string | null
          user_id: string | null
          venue_id: string
        }
        Insert: {
          age_declaration_birth_date?: string | null
          age_declaration_ip?: string | null
          age_declared_at?: string | null
          archived?: boolean | null
          assigned_bar?: string | null
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          event_id?: string | null
          fee_absorbed?: boolean
          guest_first_name?: string | null
          guest_last_name?: string | null
          guest_phone?: string | null
          id?: string
          is_guest?: boolean | null
          items: Json
          notify_status?: string | null
          order_number?: string | null
          paid_at?: string | null
          post_visit_notified?: boolean
          prep_claimed_at?: string | null
          prep_claimed_by?: string | null
          prep_requested?: boolean | null
          prep_status?: string | null
          ready_at?: string | null
          refund_amount?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          selected_bar?: string | null
          served_at?: string | null
          service_fee?: number | null
          status: string
          stripe_connected_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          token?: string | null
          token_expires_at?: string | null
          token_used?: boolean | null
          total: number
          tracked_link_id?: string | null
          user_email?: string | null
          user_id?: string | null
          venue_id: string
        }
        Update: {
          age_declaration_birth_date?: string | null
          age_declaration_ip?: string | null
          age_declared_at?: string | null
          archived?: boolean | null
          assigned_bar?: string | null
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          event_id?: string | null
          fee_absorbed?: boolean
          guest_first_name?: string | null
          guest_last_name?: string | null
          guest_phone?: string | null
          id?: string
          is_guest?: boolean | null
          items?: Json
          notify_status?: string | null
          order_number?: string | null
          paid_at?: string | null
          post_visit_notified?: boolean
          prep_claimed_at?: string | null
          prep_claimed_by?: string | null
          prep_requested?: boolean | null
          prep_status?: string | null
          ready_at?: string | null
          refund_amount?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          selected_bar?: string | null
          served_at?: string | null
          service_fee?: number | null
          status?: string
          stripe_connected_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          token?: string | null
          token_expires_at?: string | null
          token_used?: boolean | null
          total?: number
          tracked_link_id?: string | null
          user_email?: string | null
          user_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tracked_link_id_fkey"
            columns: ["tracked_link_id"]
            isOneToOne: false
            referencedRelation: "tracked_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          accepted_at: string | null
          can_export: boolean
          can_manage_team: boolean
          can_refund: boolean
          can_view_finance: boolean
          created_at: string
          expires_at: string
          id: string
          invitation_status: string
          invitation_token: string
          invited_by: string
          member_email: string
          member_user_id: string | null
          organizer_user_id: string
          role: string
          scanner_pin_hash: string | null
          scanner_pin_set_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          can_export?: boolean
          can_manage_team?: boolean
          can_refund?: boolean
          can_view_finance?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          invitation_status?: string
          invitation_token?: string
          invited_by: string
          member_email: string
          member_user_id?: string | null
          organizer_user_id: string
          role?: string
          scanner_pin_hash?: string | null
          scanner_pin_set_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          can_export?: boolean
          can_manage_team?: boolean
          can_refund?: boolean
          can_view_finance?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          invitation_status?: string
          invitation_token?: string
          invited_by?: string
          member_email?: string
          member_user_id?: string | null
          organizer_user_id?: string
          role?: string
          scanner_pin_hash?: string | null
          scanner_pin_set_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_members_member_user_id_fkey"
            columns: ["member_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_member_user_id_fkey"
            columns: ["member_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      org_staff: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          invitation_expires_at: string | null
          invitation_status: string
          invitation_token: string | null
          organizer_user_id: string
          pin_hash: string | null
          pin_set_at: string | null
          role: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          invitation_expires_at?: string | null
          invitation_status?: string
          invitation_token?: string | null
          organizer_user_id: string
          pin_hash?: string | null
          pin_set_at?: string | null
          role: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          invitation_expires_at?: string | null
          invitation_status?: string
          invitation_token?: string | null
          organizer_user_id?: string
          pin_hash?: string | null
          pin_set_at?: string | null
          role?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      organizer_banned_emails: {
        Row: {
          ban_reason: string | null
          banned_at: string | null
          banned_by: string | null
          created_at: string | null
          email: string
          id: string
          organizer_user_id: string
        }
        Insert: {
          ban_reason?: string | null
          banned_at?: string | null
          banned_by?: string | null
          created_at?: string | null
          email: string
          id?: string
          organizer_user_id: string
        }
        Update: {
          ban_reason?: string | null
          banned_at?: string | null
          banned_by?: string | null
          created_at?: string | null
          email?: string
          id?: string
          organizer_user_id?: string
        }
        Relationships: []
      }
      organizer_claim_invitations: {
        Row: {
          accepted_at: string | null
          contact_first_name: string | null
          contact_last_name: string | null
          created_at: string
          created_organizer_user_id: string | null
          default_split_rules: Json | null
          event_id: string | null
          expires_at: string
          id: string
          invitation_message: string | null
          invited_by_user_id: string
          inviting_venue_id: string
          organizer_email: string
          organizer_name: string | null
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          created_at?: string
          created_organizer_user_id?: string | null
          default_split_rules?: Json | null
          event_id?: string | null
          expires_at?: string
          id?: string
          invitation_message?: string | null
          invited_by_user_id: string
          inviting_venue_id: string
          organizer_email: string
          organizer_name?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          created_at?: string
          created_organizer_user_id?: string | null
          default_split_rules?: Json | null
          event_id?: string | null
          expires_at?: string
          id?: string
          invitation_message?: string | null
          invited_by_user_id?: string
          inviting_venue_id?: string
          organizer_email?: string
          organizer_name?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_claim_invitations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizer_claim_invitations_inviting_venue_id_fkey"
            columns: ["inviting_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_customer_incidents: {
        Row: {
          created_at: string | null
          details: string | null
          email: string
          id: string
          incident_type: string
          organizer_user_id: string
          reason: string
          reported_by: string
        }
        Insert: {
          created_at?: string | null
          details?: string | null
          email: string
          id?: string
          incident_type: string
          organizer_user_id: string
          reason: string
          reported_by: string
        }
        Update: {
          created_at?: string | null
          details?: string | null
          email?: string
          id?: string
          incident_type?: string
          organizer_user_id?: string
          reason?: string
          reported_by?: string
        }
        Relationships: []
      }
      organizer_customer_notes: {
        Row: {
          email: string
          notes: string | null
          organizer_user_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          email: string
          notes?: string | null
          organizer_user_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          email?: string
          notes?: string | null
          organizer_user_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      organizer_notifications: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          message: string
          metadata: Json
          notification_type: string
          organizer_user_id: string
          priority: string
          read_at: string | null
          read_by: string | null
          reference_id: string | null
          reference_type: string | null
          title: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          message: string
          metadata?: Json
          notification_type: string
          organizer_user_id: string
          priority?: string
          read_at?: string | null
          read_by?: string | null
          reference_id?: string | null
          reference_type?: string | null
          title: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          message?: string
          metadata?: Json
          notification_type?: string
          organizer_user_id?: string
          priority?: string
          read_at?: string | null
          read_by?: string | null
          reference_id?: string | null
          reference_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_onboarding: {
        Row: {
          completed_at: string | null
          created_at: string
          current_step: number
          id: string
          steps: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          id?: string
          steps?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          id?: string
          steps?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      organizer_profile_followers: {
        Row: {
          created_at: string
          id: string
          organizer_user_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organizer_user_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organizer_user_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_profile_followers_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizer_profile_followers_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_profiles: {
        Row: {
          absorb_yuno_fees: boolean
          avatar_url: string | null
          bde_verified: boolean
          bde_verified_at: string | null
          billing_email: string | null
          bio: string | null
          can_sell_alcohol: boolean
          can_sell_alcohol_confirmed_at: string | null
          city: string | null
          cover_url: string | null
          created_at: string
          display_name: string
          instagram_url: string | null
          is_public: boolean
          legal_address: string | null
          legal_name: string | null
          minor_auth_doc_name: string | null
          minor_auth_doc_url: string | null
          minors_allowed: boolean
          siret: string | null
          slug: string | null
          updated_at: string
          user_id: string
          vat_number: string | null
          website_url: string | null
        }
        Insert: {
          absorb_yuno_fees?: boolean
          avatar_url?: string | null
          bde_verified?: boolean
          bde_verified_at?: string | null
          billing_email?: string | null
          bio?: string | null
          can_sell_alcohol?: boolean
          can_sell_alcohol_confirmed_at?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          display_name: string
          instagram_url?: string | null
          is_public?: boolean
          legal_address?: string | null
          legal_name?: string | null
          minor_auth_doc_name?: string | null
          minor_auth_doc_url?: string | null
          minors_allowed?: boolean
          siret?: string | null
          slug?: string | null
          updated_at?: string
          user_id: string
          vat_number?: string | null
          website_url?: string | null
        }
        Update: {
          absorb_yuno_fees?: boolean
          avatar_url?: string | null
          bde_verified?: boolean
          bde_verified_at?: string | null
          billing_email?: string | null
          bio?: string | null
          can_sell_alcohol?: boolean
          can_sell_alcohol_confirmed_at?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          display_name?: string
          instagram_url?: string | null
          is_public?: boolean
          legal_address?: string | null
          legal_name?: string | null
          minor_auth_doc_name?: string | null
          minor_auth_doc_url?: string | null
          minors_allowed?: boolean
          siret?: string | null
          slug?: string | null
          updated_at?: string
          user_id?: string
          vat_number?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizer_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizer_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_slug_aliases: {
        Row: {
          created_at: string
          slug: string
          user_id: string
        }
        Insert: {
          created_at?: string
          slug: string
          user_id: string
        }
        Update: {
          created_at?: string
          slug?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_slug_aliases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "organizer_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      owner_ai_audit_log: {
        Row: {
          created_at: string | null
          id: string
          result: string | null
          tool_args: Json | null
          tool_name: string
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          result?: string | null
          tool_args?: Json | null
          tool_name: string
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          result?: string | null
          tool_args?: Json | null
          tool_name?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_ai_audit_log_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          token: string
          venue_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          token?: string
          venue_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          token?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_invitations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_recurring_templates: {
        Row: {
          advance_days: number
          auto_enable_tables: boolean
          created_at: string
          day_of_week: number
          description: string | null
          end_time: string
          event_type: string
          id: string
          is_active: boolean
          music_genres: string[]
          name: string
          organizer_user_id: string | null
          partner_organizer_id: string | null
          poster_position: Json | null
          poster_url: string | null
          revenue_split_rules: Json | null
          start_time: string
          table_preset_id: string | null
          ticket_preset_id: string | null
          updated_at: string
          venue_id: string | null
          vip_preset_id: string | null
        }
        Insert: {
          advance_days?: number
          auto_enable_tables?: boolean
          created_at?: string
          day_of_week: number
          description?: string | null
          end_time: string
          event_type?: string
          id?: string
          is_active?: boolean
          music_genres?: string[]
          name: string
          organizer_user_id?: string | null
          partner_organizer_id?: string | null
          poster_position?: Json | null
          poster_url?: string | null
          revenue_split_rules?: Json | null
          start_time: string
          table_preset_id?: string | null
          ticket_preset_id?: string | null
          updated_at?: string
          venue_id?: string | null
          vip_preset_id?: string | null
        }
        Update: {
          advance_days?: number
          auto_enable_tables?: boolean
          created_at?: string
          day_of_week?: number
          description?: string | null
          end_time?: string
          event_type?: string
          id?: string
          is_active?: boolean
          music_genres?: string[]
          name?: string
          organizer_user_id?: string | null
          partner_organizer_id?: string | null
          poster_position?: Json | null
          poster_url?: string | null
          revenue_split_rules?: Json | null
          start_time?: string
          table_preset_id?: string | null
          ticket_preset_id?: string | null
          updated_at?: string
          venue_id?: string | null
          vip_preset_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_recurring_templates_partner_organizer_id_fkey"
            columns: ["partner_organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_recurring_templates_partner_organizer_id_fkey"
            columns: ["partner_organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_recurring_templates_table_preset_id_fkey"
            columns: ["table_preset_id"]
            isOneToOne: false
            referencedRelation: "table_pack_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_recurring_templates_ticket_preset_id_fkey"
            columns: ["ticket_preset_id"]
            isOneToOne: false
            referencedRelation: "ticket_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_recurring_templates_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_recurring_templates_vip_preset_id_fkey"
            columns: ["vip_preset_id"]
            isOneToOne: false
            referencedRelation: "ticket_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_reset_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      platform_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_name: string | null
          profile_type: string
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_name?: string | null
          profile_type: string
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_name?: string | null
          profile_type?: string
          status?: string
          token?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age_verified_at: string | null
          avatar_url: string | null
          background_url: string | null
          birth_date: string | null
          city: string | null
          created_at: string
          email: string
          employee_pin: string | null
          first_name: string | null
          gender: string | null
          id: string
          invoice_prefix: string | null
          is_click_collect_manager: boolean | null
          is_suspended: boolean
          last_name: string | null
          leaderboard_visibility: string
          mfa_enabled: boolean | null
          mfa_enforced: boolean | null
          mfa_recovery_codes: string[] | null
          mfa_verified_at: string | null
          onboarding_completed: boolean
          organization_logo_url: string | null
          organization_name: string | null
          party_persona: string | null
          phone: string | null
          phone_sms_opt_in: boolean
          preferred_language: string | null
          profile_type: Database["public"]["Enums"]["profile_type"]
          push_token: string | null
          stripe_connect_account_id: string | null
          stripe_connect_charges_enabled: boolean
          stripe_connect_onboarded_at: string | null
          stripe_connect_payouts_enabled: boolean
          stripe_connect_status: string
          suspended_at: string | null
          suspended_by: string | null
          suspension_reason: string | null
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          age_verified_at?: string | null
          avatar_url?: string | null
          background_url?: string | null
          birth_date?: string | null
          city?: string | null
          created_at?: string
          email: string
          employee_pin?: string | null
          first_name?: string | null
          gender?: string | null
          id: string
          invoice_prefix?: string | null
          is_click_collect_manager?: boolean | null
          is_suspended?: boolean
          last_name?: string | null
          leaderboard_visibility?: string
          mfa_enabled?: boolean | null
          mfa_enforced?: boolean | null
          mfa_recovery_codes?: string[] | null
          mfa_verified_at?: string | null
          onboarding_completed?: boolean
          organization_logo_url?: string | null
          organization_name?: string | null
          party_persona?: string | null
          phone?: string | null
          phone_sms_opt_in?: boolean
          preferred_language?: string | null
          profile_type?: Database["public"]["Enums"]["profile_type"]
          push_token?: string | null
          stripe_connect_account_id?: string | null
          stripe_connect_charges_enabled?: boolean
          stripe_connect_onboarded_at?: string | null
          stripe_connect_payouts_enabled?: boolean
          stripe_connect_status?: string
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          age_verified_at?: string | null
          avatar_url?: string | null
          background_url?: string | null
          birth_date?: string | null
          city?: string | null
          created_at?: string
          email?: string
          employee_pin?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          invoice_prefix?: string | null
          is_click_collect_manager?: boolean | null
          is_suspended?: boolean
          last_name?: string | null
          leaderboard_visibility?: string
          mfa_enabled?: boolean | null
          mfa_enforced?: boolean | null
          mfa_recovery_codes?: string[] | null
          mfa_verified_at?: string | null
          onboarding_completed?: boolean
          organization_logo_url?: string | null
          organization_name?: string | null
          party_persona?: string | null
          phone?: string | null
          phone_sms_opt_in?: boolean
          preferred_language?: string | null
          profile_type?: Database["public"]["Enums"]["profile_type"]
          push_token?: string | null
          stripe_connect_account_id?: string | null
          stripe_connect_charges_enabled?: boolean
          stripe_connect_onboarded_at?: string | null
          stripe_connect_payouts_enabled?: boolean
          stripe_connect_status?: string
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_announcements: {
        Row: {
          content: string
          created_at: string
          event_id: string | null
          id: string
          organizer_user_id: string | null
          title: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          event_id?: string | null
          id?: string
          organizer_user_id?: string | null
          title: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          event_id?: string | null
          id?: string
          organizer_user_id?: string | null
          title?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promoter_announcements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_announcements_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_clicks: {
        Row: {
          clicked_at: string
          event_id: string | null
          id: string
          ip_hash: string | null
          promoter_id: string
          referrer: string | null
          source: string | null
          user_agent: string | null
        }
        Insert: {
          clicked_at?: string
          event_id?: string | null
          id?: string
          ip_hash?: string | null
          promoter_id: string
          referrer?: string | null
          source?: string | null
          user_agent?: string | null
        }
        Update: {
          clicked_at?: string
          event_id?: string | null
          id?: string
          ip_hash?: string | null
          promoter_id?: string
          referrer?: string | null
          source?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promoter_clicks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_clicks_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_conversions: {
        Row: {
          amount: number
          commission: number
          conversion_type: string
          created_at: string
          event_id: string | null
          guest_list_entry_id: string | null
          id: string
          order_id: string | null
          override_amount: number
          paid_at: string | null
          parent_conversion_id: string | null
          promoter_id: string
          status: string
          table_reservation_id: string | null
          ticket_id: string | null
        }
        Insert: {
          amount?: number
          commission?: number
          conversion_type: string
          created_at?: string
          event_id?: string | null
          guest_list_entry_id?: string | null
          id?: string
          order_id?: string | null
          override_amount?: number
          paid_at?: string | null
          parent_conversion_id?: string | null
          promoter_id: string
          status?: string
          table_reservation_id?: string | null
          ticket_id?: string | null
        }
        Update: {
          amount?: number
          commission?: number
          conversion_type?: string
          created_at?: string
          event_id?: string | null
          guest_list_entry_id?: string | null
          id?: string
          order_id?: string | null
          override_amount?: number
          paid_at?: string | null
          parent_conversion_id?: string | null
          promoter_id?: string
          status?: string
          table_reservation_id?: string | null
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promoter_conversions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_conversions_guest_list_entry_id_fkey"
            columns: ["guest_list_entry_id"]
            isOneToOne: false
            referencedRelation: "guest_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_conversions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_conversions_parent_conversion_id_fkey"
            columns: ["parent_conversion_id"]
            isOneToOne: false
            referencedRelation: "promoter_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_conversions_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_conversions_table_reservation_id_fkey"
            columns: ["table_reservation_id"]
            isOneToOne: false
            referencedRelation: "table_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_conversions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_conversions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_drink_redemption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_conversions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_entry_scan"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_event_assignments: {
        Row: {
          assigned_at: string
          can_access_guestlist: boolean
          can_access_tables: boolean
          commission_template_id: string | null
          event_id: string
          goal_target: number | null
          id: string
          max_tickets: number | null
          promoter_id: string
          status: string
        }
        Insert: {
          assigned_at?: string
          can_access_guestlist?: boolean
          can_access_tables?: boolean
          commission_template_id?: string | null
          event_id: string
          goal_target?: number | null
          id?: string
          max_tickets?: number | null
          promoter_id: string
          status?: string
        }
        Update: {
          assigned_at?: string
          can_access_guestlist?: boolean
          can_access_tables?: boolean
          commission_template_id?: string | null
          event_id?: string
          goal_target?: number | null
          id?: string
          max_tickets?: number | null
          promoter_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "promoter_event_assignments_commission_template_id_fkey"
            columns: ["commission_template_id"]
            isOneToOne: false
            referencedRelation: "commission_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_event_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_event_assignments_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_invitations: {
        Row: {
          accepted_at: string | null
          agency_id: string | null
          commission_config: Json
          commission_rate: number | null
          created_at: string
          email: string
          expires_at: string
          first_name: string | null
          id: string
          invited_by: string
          last_name: string | null
          organizer_user_id: string | null
          phone: string | null
          promo_code: string
          status: string
          token: string
          venue_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          agency_id?: string | null
          commission_config?: Json
          commission_rate?: number | null
          created_at?: string
          email: string
          expires_at?: string
          first_name?: string | null
          id?: string
          invited_by: string
          last_name?: string | null
          organizer_user_id?: string | null
          phone?: string | null
          promo_code: string
          status?: string
          token?: string
          venue_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          agency_id?: string | null
          commission_config?: Json
          commission_rate?: number | null
          created_at?: string
          email?: string
          expires_at?: string
          first_name?: string | null
          id?: string
          invited_by?: string
          last_name?: string | null
          organizer_user_id?: string | null
          phone?: string | null
          promo_code?: string
          status?: string
          token?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promoter_invitations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_invitations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_linktree_events: {
        Row: {
          affiliate_event_id: string
          created_at: string
          id: string
          member_id: string
          promo_link: string | null
          sort_order: number
        }
        Insert: {
          affiliate_event_id: string
          created_at?: string
          id?: string
          member_id: string
          promo_link?: string | null
          sort_order?: number
        }
        Update: {
          affiliate_event_id?: string
          created_at?: string
          id?: string
          member_id?: string
          promo_link?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "promoter_linktree_events_affiliate_event_id_fkey"
            columns: ["affiliate_event_id"]
            isOneToOne: false
            referencedRelation: "affiliate_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_linktree_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_members"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          is_from_club: boolean
          is_read: boolean
          promoter_id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_from_club?: boolean
          is_read?: boolean
          promoter_id: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_from_club?: boolean
          is_read?: boolean
          promoter_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promoter_messages_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_payouts: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          notes: string | null
          organizer_user_id: string | null
          paid_at: string | null
          paid_by: string | null
          period_label: string | null
          promoter_id: string
          status: string
          venue_id: string | null
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organizer_user_id?: string | null
          paid_at?: string | null
          paid_by?: string | null
          period_label?: string | null
          promoter_id: string
          status?: string
          venue_id?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organizer_user_id?: string | null
          paid_at?: string | null
          paid_by?: string | null
          period_label?: string | null
          promoter_id?: string
          status?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promoter_payouts_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_payouts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      promoter_teams: {
        Row: {
          created_at: string
          id: string
          leader_promoter_id: string | null
          max_sales: number | null
          name: string
          organizer_user_id: string | null
          override_type: string | null
          override_value: number
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          leader_promoter_id?: string | null
          max_sales?: number | null
          name: string
          organizer_user_id?: string | null
          override_type?: string | null
          override_value?: number
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          leader_promoter_id?: string | null
          max_sales?: number | null
          name?: string
          organizer_user_id?: string | null
          override_type?: string | null
          override_value?: number
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promoter_teams_leader_promoter_id_fkey"
            columns: ["leader_promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoter_teams_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      promoters: {
        Row: {
          agency_can_sell_tables: boolean
          agency_can_sell_tickets: boolean
          agency_group_id: string | null
          agency_guestlist_quota: number | null
          agency_id: string | null
          agency_rule_template_id: string | null
          agency_table_cap: number | null
          agency_ticket_cap: number | null
          bic: string | null
          can_scan_entries: boolean
          client_discount_template_id: string | null
          condition_met: boolean | null
          created_at: string
          customer_discount_type: string | null
          customer_discount_value: number | null
          default_commission_template_id: string | null
          drink_discount_type: string | null
          drink_discount_value: number | null
          first_name: string | null
          guest_list_template_id: string | null
          iban: string | null
          id: string
          instagram_url: string | null
          is_active: boolean
          last_name: string | null
          min_condition_type: string | null
          min_condition_value: number | null
          organizer_user_id: string | null
          pending_amount: number
          phone: string | null
          profile_image_url: string | null
          promo_code: string
          reward_config: Json | null
          reward_type: string | null
          table_commission_type: string
          table_commission_value: number
          table_discount_type: string | null
          table_discount_value: number | null
          team_id: string | null
          ticket_commission_type: string
          ticket_commission_value: number
          ticket_discount_type: string | null
          ticket_discount_value: number | null
          total_paid: number
          updated_at: string
          user_id: string
          venue_id: string | null
          whatsapp_number: string | null
        }
        Insert: {
          agency_can_sell_tables?: boolean
          agency_can_sell_tickets?: boolean
          agency_group_id?: string | null
          agency_guestlist_quota?: number | null
          agency_id?: string | null
          agency_rule_template_id?: string | null
          agency_table_cap?: number | null
          agency_ticket_cap?: number | null
          bic?: string | null
          can_scan_entries?: boolean
          client_discount_template_id?: string | null
          condition_met?: boolean | null
          created_at?: string
          customer_discount_type?: string | null
          customer_discount_value?: number | null
          default_commission_template_id?: string | null
          drink_discount_type?: string | null
          drink_discount_value?: number | null
          first_name?: string | null
          guest_list_template_id?: string | null
          iban?: string | null
          id?: string
          instagram_url?: string | null
          is_active?: boolean
          last_name?: string | null
          min_condition_type?: string | null
          min_condition_value?: number | null
          organizer_user_id?: string | null
          pending_amount?: number
          phone?: string | null
          profile_image_url?: string | null
          promo_code: string
          reward_config?: Json | null
          reward_type?: string | null
          table_commission_type?: string
          table_commission_value?: number
          table_discount_type?: string | null
          table_discount_value?: number | null
          team_id?: string | null
          ticket_commission_type?: string
          ticket_commission_value?: number
          ticket_discount_type?: string | null
          ticket_discount_value?: number | null
          total_paid?: number
          updated_at?: string
          user_id: string
          venue_id?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          agency_can_sell_tables?: boolean
          agency_can_sell_tickets?: boolean
          agency_group_id?: string | null
          agency_guestlist_quota?: number | null
          agency_id?: string | null
          agency_rule_template_id?: string | null
          agency_table_cap?: number | null
          agency_ticket_cap?: number | null
          bic?: string | null
          can_scan_entries?: boolean
          client_discount_template_id?: string | null
          condition_met?: boolean | null
          created_at?: string
          customer_discount_type?: string | null
          customer_discount_value?: number | null
          default_commission_template_id?: string | null
          drink_discount_type?: string | null
          drink_discount_value?: number | null
          first_name?: string | null
          guest_list_template_id?: string | null
          iban?: string | null
          id?: string
          instagram_url?: string | null
          is_active?: boolean
          last_name?: string | null
          min_condition_type?: string | null
          min_condition_value?: number | null
          organizer_user_id?: string | null
          pending_amount?: number
          phone?: string | null
          profile_image_url?: string | null
          promo_code?: string
          reward_config?: Json | null
          reward_type?: string | null
          table_commission_type?: string
          table_commission_value?: number
          table_discount_type?: string | null
          table_discount_value?: number | null
          team_id?: string | null
          ticket_commission_type?: string
          ticket_commission_value?: number
          ticket_discount_type?: string | null
          ticket_discount_value?: number | null
          total_paid?: number
          updated_at?: string
          user_id?: string
          venue_id?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promoters_agency_group_id_fkey"
            columns: ["agency_group_id"]
            isOneToOne: false
            referencedRelation: "agency_promoter_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoters_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoters_agency_rule_template_id_fkey"
            columns: ["agency_rule_template_id"]
            isOneToOne: false
            referencedRelation: "agency_rule_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoters_client_discount_template_id_fkey"
            columns: ["client_discount_template_id"]
            isOneToOne: false
            referencedRelation: "commission_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoters_default_commission_template_id_fkey"
            columns: ["default_commission_template_id"]
            isOneToOne: false
            referencedRelation: "commission_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoters_guest_list_template_id_fkey"
            columns: ["guest_list_template_id"]
            isOneToOne: false
            referencedRelation: "commission_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoters_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "promoter_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promoters_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      push_campaigns: {
        Row: {
          body: string
          created_at: string | null
          created_by: string
          id: string
          segment: string
          sent_count: number | null
          title: string
          url: string | null
        }
        Insert: {
          body: string
          created_at?: string | null
          created_by: string
          id?: string
          segment?: string
          sent_count?: number | null
          title: string
          url?: string | null
        }
        Update: {
          body?: string
          created_at?: string | null
          created_by?: string
          id?: string
          segment?: string
          sent_count?: number | null
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string | null
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string | null
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      revenue_distributions: {
        Row: {
          checkout_session_id: string | null
          collab_contract_id: string | null
          created_at: string
          event_id: string | null
          gross_amount_cents: number
          id: string
          item_type: string
          metadata: Json | null
          order_id: string | null
          organizer_pct_applied: number | null
          partnership_id: string | null
          payment_intent_id: string
          primary_account_id: string | null
          primary_amount_cents: number
          primary_recipient_kind: string | null
          primary_recipient_organizer_id: string | null
          primary_recipient_venue_id: string | null
          primary_transfer_attempts: number
          primary_transfer_error: string | null
          primary_transfer_id: string | null
          primary_transfer_status: string
          secondary_account_id: string | null
          secondary_amount_cents: number
          secondary_recipient_kind: string | null
          secondary_recipient_organizer_id: string | null
          secondary_recipient_venue_id: string | null
          secondary_transfer_attempts: number
          secondary_transfer_error: string | null
          secondary_transfer_id: string | null
          secondary_transfer_status: string
          split_mode: string
          split_rules_applied: Json | null
          stripe_fee_charge_id: string | null
          stripe_fee_estimated_cents: number
          stripe_fee_real_cents: number | null
          table_reservation_id: string | null
          ticket_id: string | null
          transfer_group_id: string | null
          transfers_release_at: string | null
          updated_at: string
          venue_pct_applied: number | null
          yuno_fee_cents: number
        }
        Insert: {
          checkout_session_id?: string | null
          collab_contract_id?: string | null
          created_at?: string
          event_id?: string | null
          gross_amount_cents: number
          id?: string
          item_type: string
          metadata?: Json | null
          order_id?: string | null
          organizer_pct_applied?: number | null
          partnership_id?: string | null
          payment_intent_id: string
          primary_account_id?: string | null
          primary_amount_cents?: number
          primary_recipient_kind?: string | null
          primary_recipient_organizer_id?: string | null
          primary_recipient_venue_id?: string | null
          primary_transfer_attempts?: number
          primary_transfer_error?: string | null
          primary_transfer_id?: string | null
          primary_transfer_status?: string
          secondary_account_id?: string | null
          secondary_amount_cents?: number
          secondary_recipient_kind?: string | null
          secondary_recipient_organizer_id?: string | null
          secondary_recipient_venue_id?: string | null
          secondary_transfer_attempts?: number
          secondary_transfer_error?: string | null
          secondary_transfer_id?: string | null
          secondary_transfer_status?: string
          split_mode?: string
          split_rules_applied?: Json | null
          stripe_fee_charge_id?: string | null
          stripe_fee_estimated_cents?: number
          stripe_fee_real_cents?: number | null
          table_reservation_id?: string | null
          ticket_id?: string | null
          transfer_group_id?: string | null
          transfers_release_at?: string | null
          updated_at?: string
          venue_pct_applied?: number | null
          yuno_fee_cents?: number
        }
        Update: {
          checkout_session_id?: string | null
          collab_contract_id?: string | null
          created_at?: string
          event_id?: string | null
          gross_amount_cents?: number
          id?: string
          item_type?: string
          metadata?: Json | null
          order_id?: string | null
          organizer_pct_applied?: number | null
          partnership_id?: string | null
          payment_intent_id?: string
          primary_account_id?: string | null
          primary_amount_cents?: number
          primary_recipient_kind?: string | null
          primary_recipient_organizer_id?: string | null
          primary_recipient_venue_id?: string | null
          primary_transfer_attempts?: number
          primary_transfer_error?: string | null
          primary_transfer_id?: string | null
          primary_transfer_status?: string
          secondary_account_id?: string | null
          secondary_amount_cents?: number
          secondary_recipient_kind?: string | null
          secondary_recipient_organizer_id?: string | null
          secondary_recipient_venue_id?: string | null
          secondary_transfer_attempts?: number
          secondary_transfer_error?: string | null
          secondary_transfer_id?: string | null
          secondary_transfer_status?: string
          split_mode?: string
          split_rules_applied?: Json | null
          stripe_fee_charge_id?: string | null
          stripe_fee_estimated_cents?: number
          stripe_fee_real_cents?: number | null
          table_reservation_id?: string | null
          ticket_id?: string | null
          transfer_group_id?: string | null
          transfers_release_at?: string | null
          updated_at?: string
          venue_pct_applied?: number | null
          yuno_fee_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "revenue_distributions_collab_contract_id_fkey"
            columns: ["collab_contract_id"]
            isOneToOne: false
            referencedRelation: "event_collab_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_distributions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_distributions_partnership_id_fkey"
            columns: ["partnership_id"]
            isOneToOne: false
            referencedRelation: "venue_organizer_partnerships"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_redemptions: {
        Row: {
          contest_winner_id: string | null
          created_at: string | null
          customer_loyalty_id: string
          expires_at: string | null
          id: string
          metadata: Json | null
          points_spent: number
          qr_code: string | null
          reward_id: string | null
          reward_label: string | null
          source: string
          status: string | null
          used_at: string | null
          user_id: string
          validated_by: string | null
          venue_id: string
        }
        Insert: {
          contest_winner_id?: string | null
          created_at?: string | null
          customer_loyalty_id: string
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          points_spent: number
          qr_code?: string | null
          reward_id?: string | null
          reward_label?: string | null
          source?: string
          status?: string | null
          used_at?: string | null
          user_id: string
          validated_by?: string | null
          venue_id: string
        }
        Update: {
          contest_winner_id?: string | null
          created_at?: string | null
          customer_loyalty_id?: string
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          points_spent?: number
          qr_code?: string | null
          reward_id?: string | null
          reward_label?: string | null
          source?: string
          status?: string | null
          used_at?: string | null
          user_id?: string
          validated_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_contest_winner_id_fkey"
            columns: ["contest_winner_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_contest_winners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_customer_loyalty_id_fkey"
            columns: ["customer_loyalty_id"]
            isOneToOne: false
            referencedRelation: "customer_loyalty"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      security_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: string | null
          ip_hash: string | null
          success: boolean | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: string | null
          ip_hash?: string | null
          success?: boolean | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          ip_hash?: string | null
          success?: boolean | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      sms_campaigns: {
        Row: {
          body_template: string
          created_at: string
          created_by: string
          delivered_count: number
          estimated_credits: number
          estimated_recipients: number
          failed_count: number
          id: string
          name: string
          organizer_id: string | null
          scheduled_at: string | null
          segment_filters: Json
          sent_at: string | null
          sent_count: number
          status: Database["public"]["Enums"]["sms_campaign_status"]
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          body_template: string
          created_at?: string
          created_by: string
          delivered_count?: number
          estimated_credits?: number
          estimated_recipients?: number
          failed_count?: number
          id?: string
          name: string
          organizer_id?: string | null
          scheduled_at?: string | null
          segment_filters?: Json
          sent_at?: string | null
          sent_count?: number
          status?: Database["public"]["Enums"]["sms_campaign_status"]
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          body_template?: string
          created_at?: string
          created_by?: string
          delivered_count?: number
          estimated_credits?: number
          estimated_recipients?: number
          failed_count?: number
          id?: string
          name?: string
          organizer_id?: string | null
          scheduled_at?: string | null
          segment_filters?: Json
          sent_at?: string | null
          sent_count?: number
          status?: Database["public"]["Enums"]["sms_campaign_status"]
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_campaigns_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_credit_balances: {
        Row: {
          balance: number
          created_at: string
          id: string
          low_balance_alert_sent_at: string | null
          organizer_id: string | null
          total_consumed: number
          total_purchased: number
          total_refunded: number
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          low_balance_alert_sent_at?: string | null
          organizer_id?: string | null
          total_consumed?: number
          total_purchased?: number
          total_refunded?: number
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          low_balance_alert_sent_at?: string | null
          organizer_id?: string | null
          total_consumed?: number
          total_purchased?: number
          total_refunded?: number
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_credit_balances_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_credit_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          organizer_id: string | null
          pack_id: string | null
          sms_log_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          type: Database["public"]["Enums"]["sms_credit_tx_type"]
          venue_id: string | null
        }
        Insert: {
          amount: number
          balance_after: number
          balance_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organizer_id?: string | null
          pack_id?: string | null
          sms_log_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          type: Database["public"]["Enums"]["sms_credit_tx_type"]
          venue_id?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organizer_id?: string | null
          pack_id?: string | null
          sms_log_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          type?: Database["public"]["Enums"]["sms_credit_tx_type"]
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_credit_transactions_balance_id_fkey"
            columns: ["balance_id"]
            isOneToOne: false
            referencedRelation: "sms_credit_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_credit_transactions_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "sms_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_credit_transactions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_logs: {
        Row: {
          body: string
          campaign_id: string | null
          created_at: string
          credits_consumed: number
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          event_id: string | null
          id: string
          organizer_id: string | null
          purpose: Database["public"]["Enums"]["sms_purpose"]
          refunded: boolean
          sent_at: string | null
          status: Database["public"]["Enums"]["sms_status"]
          target_user_id: string | null
          to_phone: string
          twilio_sid: string | null
          venue_id: string | null
        }
        Insert: {
          body: string
          campaign_id?: string | null
          created_at?: string
          credits_consumed?: number
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          event_id?: string | null
          id?: string
          organizer_id?: string | null
          purpose?: Database["public"]["Enums"]["sms_purpose"]
          refunded?: boolean
          sent_at?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          target_user_id?: string | null
          to_phone: string
          twilio_sid?: string | null
          venue_id?: string | null
        }
        Update: {
          body?: string
          campaign_id?: string | null
          created_at?: string
          credits_consumed?: number
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          event_id?: string | null
          id?: string
          organizer_id?: string | null
          purpose?: Database["public"]["Enums"]["sms_purpose"]
          refunded?: boolean
          sent_at?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          target_user_id?: string | null
          to_phone?: string
          twilio_sid?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "sms_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_logs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_packs: {
        Row: {
          created_at: string
          credits_amount: number
          description: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          price_eur: number
          stripe_price_id: string | null
          stripe_product_id: string | null
          unit_cost_eur: number
          unit_margin_eur: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits_amount: number
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          position?: number
          price_eur: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          unit_cost_eur?: number
          unit_margin_eur?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits_amount?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          price_eur?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          unit_cost_eur?: number
          unit_margin_eur?: number
          updated_at?: string
        }
        Relationships: []
      }
      staff_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          display_name: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string
          manager_permissions: Json | null
          organizer_user_id: string | null
          role: string
          status: string
          token: string
          venue_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          manager_permissions?: Json | null
          organizer_user_id?: string | null
          role: string
          status?: string
          token?: string
          venue_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          manager_permissions?: Json | null
          organizer_user_id?: string | null
          role?: string
          status?: string
          token?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_invitations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notifications: {
        Row: {
          created_at: string | null
          event_id: string | null
          id: string
          message: string
          metadata: Json | null
          notification_type: string
          priority: string | null
          read_at: string | null
          read_by: string | null
          reference_id: string | null
          reference_type: string | null
          target_role: string
          title: string
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          event_id?: string | null
          id?: string
          message: string
          metadata?: Json | null
          notification_type: string
          priority?: string | null
          read_at?: string | null
          read_by?: string | null
          reference_id?: string | null
          reference_type?: string | null
          target_role: string
          title: string
          venue_id: string
        }
        Update: {
          created_at?: string | null
          event_id?: string | null
          id?: string
          message?: string
          metadata?: Json | null
          notification_type?: string
          priority?: string | null
          read_at?: string | null
          read_by?: string | null
          reference_id?: string | null
          reference_type?: string | null
          target_role?: string
          title?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_notifications_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      table_pack_presets: {
        Row: {
          created_at: string
          id: string
          name: string
          packs: Json
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          packs?: Json
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          packs?: Json
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_pack_presets_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      table_packs: {
        Row: {
          base_capacity: number
          base_price: number
          created_at: string
          created_by_user_id: string | null
          deposit: number | null
          deposit_type: string
          description: string | null
          event_id: string | null
          extra_person_price: number | null
          id: string
          included_bottles_quota: number
          included_items: string | null
          is_active: boolean
          max_extra_persons: number | null
          minimum_spend: number | null
          name: string
          position: number
          tables_count: number
          updated_at: string
          venue_id: string
          zone_id: string
        }
        Insert: {
          base_capacity?: number
          base_price: number
          created_at?: string
          created_by_user_id?: string | null
          deposit?: number | null
          deposit_type?: string
          description?: string | null
          event_id?: string | null
          extra_person_price?: number | null
          id?: string
          included_bottles_quota?: number
          included_items?: string | null
          is_active?: boolean
          max_extra_persons?: number | null
          minimum_spend?: number | null
          name: string
          position?: number
          tables_count?: number
          updated_at?: string
          venue_id: string
          zone_id: string
        }
        Update: {
          base_capacity?: number
          base_price?: number
          created_at?: string
          created_by_user_id?: string | null
          deposit?: number | null
          deposit_type?: string
          description?: string | null
          event_id?: string | null
          extra_person_price?: number | null
          id?: string
          included_bottles_quota?: number
          included_items?: string | null
          is_active?: boolean
          max_extra_persons?: number | null
          minimum_spend?: number | null
          name?: string
          position?: number
          tables_count?: number
          updated_at?: string
          venue_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_packs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_packs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_packs_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "table_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      table_reservations: {
        Row: {
          age_declaration_birth_date: string | null
          age_declaration_ip: string | null
          age_declared_at: string | null
          assigned_table_id: string | null
          checked_in_at: string | null
          claimed_at: string | null
          claimed_by_user_id: string | null
          created_at: string
          deposit: number | null
          entry_scanned: boolean | null
          entry_scanned_at: string | null
          entry_scanned_by: string | null
          event_id: string
          fee_absorbed: boolean
          finished_at: string | null
          full_name: string | null
          guest_count: number | null
          guest_first_name: string | null
          guest_last_name: string | null
          guest_phone: string | null
          id: string
          is_guest: boolean | null
          management_fee: number | null
          minimum_spend: number | null
          newsletter_opt_in: boolean | null
          pack_id: string | null
          paid_at: string | null
          phone: string | null
          placed_at: string | null
          placed_by: string | null
          placement_note: string | null
          placement_reviewed_at: string | null
          placement_reviewed_by: string | null
          placement_status: string | null
          purchase_source: string | null
          qr_code: string | null
          reference_code: string | null
          refund_amount: number | null
          refund_reason: string | null
          refunded_at: string | null
          refunded_by: string | null
          remarks: string | null
          requested_table_id: string | null
          service_fee: number
          sms_opt_in: boolean
          status: string
          stripe_connected_account_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          table_id: string | null
          total_price: number
          tracked_link_id: string | null
          user_email: string
          user_id: string | null
          vip_status: string | null
          zone_id: string | null
        }
        Insert: {
          age_declaration_birth_date?: string | null
          age_declaration_ip?: string | null
          age_declared_at?: string | null
          assigned_table_id?: string | null
          checked_in_at?: string | null
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          deposit?: number | null
          entry_scanned?: boolean | null
          entry_scanned_at?: string | null
          entry_scanned_by?: string | null
          event_id: string
          fee_absorbed?: boolean
          finished_at?: string | null
          full_name?: string | null
          guest_count?: number | null
          guest_first_name?: string | null
          guest_last_name?: string | null
          guest_phone?: string | null
          id?: string
          is_guest?: boolean | null
          management_fee?: number | null
          minimum_spend?: number | null
          newsletter_opt_in?: boolean | null
          pack_id?: string | null
          paid_at?: string | null
          phone?: string | null
          placed_at?: string | null
          placed_by?: string | null
          placement_note?: string | null
          placement_reviewed_at?: string | null
          placement_reviewed_by?: string | null
          placement_status?: string | null
          purchase_source?: string | null
          qr_code?: string | null
          reference_code?: string | null
          refund_amount?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          remarks?: string | null
          requested_table_id?: string | null
          service_fee?: number
          sms_opt_in?: boolean
          status?: string
          stripe_connected_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          table_id?: string | null
          total_price: number
          tracked_link_id?: string | null
          user_email: string
          user_id?: string | null
          vip_status?: string | null
          zone_id?: string | null
        }
        Update: {
          age_declaration_birth_date?: string | null
          age_declaration_ip?: string | null
          age_declared_at?: string | null
          assigned_table_id?: string | null
          checked_in_at?: string | null
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          deposit?: number | null
          entry_scanned?: boolean | null
          entry_scanned_at?: string | null
          entry_scanned_by?: string | null
          event_id?: string
          fee_absorbed?: boolean
          finished_at?: string | null
          full_name?: string | null
          guest_count?: number | null
          guest_first_name?: string | null
          guest_last_name?: string | null
          guest_phone?: string | null
          id?: string
          is_guest?: boolean | null
          management_fee?: number | null
          minimum_spend?: number | null
          newsletter_opt_in?: boolean | null
          pack_id?: string | null
          paid_at?: string | null
          phone?: string | null
          placed_at?: string | null
          placed_by?: string | null
          placement_note?: string | null
          placement_reviewed_at?: string | null
          placement_reviewed_by?: string | null
          placement_status?: string | null
          purchase_source?: string | null
          qr_code?: string | null
          reference_code?: string | null
          refund_amount?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          remarks?: string | null
          requested_table_id?: string | null
          service_fee?: number
          sms_opt_in?: boolean
          status?: string
          stripe_connected_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          table_id?: string | null
          total_price?: number
          tracked_link_id?: string | null
          user_email?: string
          user_id?: string | null
          vip_status?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_reservations_assigned_table_id_fkey"
            columns: ["assigned_table_id"]
            isOneToOne: false
            referencedRelation: "vip_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_reservations_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_reservations_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_reservations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_reservations_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "table_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_reservations_requested_table_id_fkey"
            columns: ["requested_table_id"]
            isOneToOne: false
            referencedRelation: "vip_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_reservations_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "vip_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_reservations_tracked_link_id_fkey"
            columns: ["tracked_link_id"]
            isOneToOne: false
            referencedRelation: "tracked_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_reservations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "table_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      table_zones: {
        Row: {
          color: string
          created_at: string
          created_by_user_id: string | null
          event_id: string | null
          id: string
          last_tables_threshold: number
          name: string
          position: number
          price: number | null
          tables_count: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by_user_id?: string | null
          event_id?: string | null
          id?: string
          last_tables_threshold?: number
          name: string
          position?: number
          price?: number | null
          tables_count?: number
          updated_at?: string
          venue_id: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by_user_id?: string | null
          event_id?: string | null
          id?: string
          last_tables_threshold?: number
          name?: string
          position?: number
          price?: number | null
          tables_count?: number
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_zones_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_zones_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      terms_acceptances: {
        Row: {
          accepted_at: string
          context: string | null
          created_at: string | null
          guest_email: string | null
          id: string
          ip_address: string | null
          order_id: string | null
          terms_version: string
          user_agent: string | null
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          accepted_at?: string
          context?: string | null
          created_at?: string | null
          guest_email?: string | null
          id?: string
          ip_address?: string | null
          order_id?: string | null
          terms_version: string
          user_agent?: string | null
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          accepted_at?: string
          context?: string | null
          created_at?: string | null
          guest_email?: string | null
          id?: string
          ip_address?: string | null
          order_id?: string | null
          terms_version?: string
          user_agent?: string | null
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "terms_acceptances_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_attendees: {
        Row: {
          created_at: string
          drink_redeemed: boolean | null
          drink_redeemed_at: string | null
          email: string | null
          entry_scanned: boolean | null
          entry_scanned_at: string | null
          entry_scanned_by: string | null
          full_name: string
          id: string
          phone: string | null
          qr_code: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          drink_redeemed?: boolean | null
          drink_redeemed_at?: string | null
          email?: string | null
          entry_scanned?: boolean | null
          entry_scanned_at?: string | null
          entry_scanned_by?: string | null
          full_name: string
          id?: string
          phone?: string | null
          qr_code: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          drink_redeemed?: boolean | null
          drink_redeemed_at?: string | null
          email?: string | null
          entry_scanned?: boolean | null
          entry_scanned_at?: string | null
          entry_scanned_by?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          qr_code?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_attendees_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_attendees_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_drink_redemption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_attendees_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_entry_scan"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_presets: {
        Row: {
          created_at: string
          drink_cutoff_time: string | null
          drink_deadline_hours: number | null
          drink_deadline_type: string | null
          id: string
          includes_drink: boolean | null
          name: string
          organizer_user_id: string | null
          rounds: Json
          selling_mode: string | null
          ticket_type: string
          total_capacity: number
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          drink_cutoff_time?: string | null
          drink_deadline_hours?: number | null
          drink_deadline_type?: string | null
          id?: string
          includes_drink?: boolean | null
          name: string
          organizer_user_id?: string | null
          rounds?: Json
          selling_mode?: string | null
          ticket_type?: string
          total_capacity?: number
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          drink_cutoff_time?: string | null
          drink_deadline_hours?: number | null
          drink_deadline_type?: string | null
          id?: string
          includes_drink?: boolean | null
          name?: string
          organizer_user_id?: string | null
          rounds?: Json
          selling_mode?: string | null
          ticket_type?: string
          total_capacity?: number
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_presets_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_presets_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_presets_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_reservations: {
        Row: {
          capacity_held: number
          confirmed_at: string | null
          created_at: string
          event_id: string
          expires_at: string
          guest_email: string | null
          id: string
          quantity: number
          status: string
          stripe_session_id: string | null
          ticket_round_id: string
          user_id: string | null
        }
        Insert: {
          capacity_held: number
          confirmed_at?: string | null
          created_at?: string
          event_id: string
          expires_at?: string
          guest_email?: string | null
          id?: string
          quantity: number
          status?: string
          stripe_session_id?: string | null
          ticket_round_id: string
          user_id?: string | null
        }
        Update: {
          capacity_held?: number
          confirmed_at?: string | null
          created_at?: string
          event_id?: string
          expires_at?: string
          guest_email?: string | null
          id?: string
          quantity?: number
          status?: string
          stripe_session_id?: string | null
          ticket_round_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_reservations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_reservations_ticket_round_id_fkey"
            columns: ["ticket_round_id"]
            isOneToOne: false
            referencedRelation: "ticket_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_rounds: {
        Row: {
          allowed_drink_collections: string[] | null
          auto_activate: boolean
          created_at: string
          description: string | null
          drink_cutoff_time: string | null
          drink_deadline_hours: number | null
          drink_deadline_type: string | null
          entry_deadline: string | null
          event_id: string
          group_label: string | null
          group_size: number | null
          id: string
          includes_drink: boolean | null
          is_active: boolean
          is_group: boolean | null
          last_tickets_threshold: number | null
          manually_sold_out: boolean
          max_tickets: number
          name: string
          position: number
          price: number
          ticket_type: string
          tickets_sold: number
          updated_at: string
        }
        Insert: {
          allowed_drink_collections?: string[] | null
          auto_activate?: boolean
          created_at?: string
          description?: string | null
          drink_cutoff_time?: string | null
          drink_deadline_hours?: number | null
          drink_deadline_type?: string | null
          entry_deadline?: string | null
          event_id: string
          group_label?: string | null
          group_size?: number | null
          id?: string
          includes_drink?: boolean | null
          is_active?: boolean
          is_group?: boolean | null
          last_tickets_threshold?: number | null
          manually_sold_out?: boolean
          max_tickets: number
          name: string
          position?: number
          price: number
          ticket_type?: string
          tickets_sold?: number
          updated_at?: string
        }
        Update: {
          allowed_drink_collections?: string[] | null
          auto_activate?: boolean
          created_at?: string
          description?: string | null
          drink_cutoff_time?: string | null
          drink_deadline_hours?: number | null
          drink_deadline_type?: string | null
          entry_deadline?: string | null
          event_id?: string
          group_label?: string | null
          group_size?: number | null
          id?: string
          includes_drink?: boolean | null
          is_active?: boolean
          is_group?: boolean | null
          last_tickets_threshold?: number | null
          manually_sold_out?: boolean
          max_tickets?: number
          name?: string
          position?: number
          price?: number
          ticket_type?: string
          tickets_sold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_rounds_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_upgrade_paths: {
        Row: {
          created_at: string | null
          event_id: string
          id: string
          is_active: boolean | null
          source_round_id: string
          target_round_id: string
        }
        Insert: {
          created_at?: string | null
          event_id: string
          id?: string
          is_active?: boolean | null
          source_round_id: string
          target_round_id: string
        }
        Update: {
          created_at?: string | null
          event_id?: string
          id?: string
          is_active?: boolean | null
          source_round_id?: string
          target_round_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_upgrade_paths_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_upgrade_paths_source_round_id_fkey"
            columns: ["source_round_id"]
            isOneToOne: false
            referencedRelation: "ticket_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_upgrade_paths_target_round_id_fkey"
            columns: ["target_round_id"]
            isOneToOne: false
            referencedRelation: "ticket_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_upsell_offers: {
        Row: {
          allowed_collections: string[] | null
          cloakroom_price: number | null
          cloakroom_regular_price: number | null
          combo_discount_percent: number | null
          combo_qty: number | null
          created_at: string
          description: string | null
          description_en: string | null
          description_es: string | null
          description_fr: string | null
          discounted_price: number | null
          drink_count: number | null
          id: string
          is_active: boolean
          name: string
          name_en: string | null
          name_es: string | null
          name_fr: string | null
          offer_type: string
          original_price: number | null
          pack_price: number | null
          priority: number
          regular_price: number | null
          venue_id: string
        }
        Insert: {
          allowed_collections?: string[] | null
          cloakroom_price?: number | null
          cloakroom_regular_price?: number | null
          combo_discount_percent?: number | null
          combo_qty?: number | null
          created_at?: string
          description?: string | null
          description_en?: string | null
          description_es?: string | null
          description_fr?: string | null
          discounted_price?: number | null
          drink_count?: number | null
          id?: string
          is_active?: boolean
          name: string
          name_en?: string | null
          name_es?: string | null
          name_fr?: string | null
          offer_type: string
          original_price?: number | null
          pack_price?: number | null
          priority?: number
          regular_price?: number | null
          venue_id: string
        }
        Update: {
          allowed_collections?: string[] | null
          cloakroom_price?: number | null
          cloakroom_regular_price?: number | null
          combo_discount_percent?: number | null
          combo_qty?: number | null
          created_at?: string
          description?: string | null
          description_en?: string | null
          description_es?: string | null
          description_fr?: string | null
          discounted_price?: number | null
          drink_count?: number | null
          id?: string
          is_active?: boolean
          name?: string
          name_en?: string | null
          name_es?: string | null
          name_fr?: string | null
          offer_type?: string
          original_price?: number | null
          pack_price?: number | null
          priority?: number
          regular_price?: number | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_upsell_offers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_upsell_selections: {
        Row: {
          cloakroom_deposited: boolean
          cloakroom_deposited_at: string | null
          cloakroom_number: string | null
          cloakroom_retrieved: boolean
          cloakroom_retrieved_at: string | null
          created_at: string
          credits_remaining: number | null
          id: string
          offer_id: string
          offer_type: string
          quantity: number
          ticket_id: string
          total_price: number
          unit_price: number
        }
        Insert: {
          cloakroom_deposited?: boolean
          cloakroom_deposited_at?: string | null
          cloakroom_number?: string | null
          cloakroom_retrieved?: boolean
          cloakroom_retrieved_at?: string | null
          created_at?: string
          credits_remaining?: number | null
          id?: string
          offer_id: string
          offer_type: string
          quantity?: number
          ticket_id: string
          total_price?: number
          unit_price?: number
        }
        Update: {
          cloakroom_deposited?: boolean
          cloakroom_deposited_at?: string | null
          cloakroom_number?: string | null
          cloakroom_retrieved?: boolean
          cloakroom_retrieved_at?: string | null
          created_at?: string
          credits_remaining?: number | null
          id?: string
          offer_id?: string
          offer_type?: string
          quantity?: number
          ticket_id?: string
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_upsell_selections_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "ticket_upsell_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_upsell_selections_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_upsell_selections_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_drink_redemption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_upsell_selections_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_entry_scan"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_waitlist: {
        Row: {
          created_at: string
          email: string
          event_id: string
          expired_at: string | null
          id: string
          notified_at: string | null
          position: number
          purchased: boolean | null
          ticket_round_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          event_id: string
          expired_at?: string | null
          id?: string
          notified_at?: string | null
          position?: number
          purchased?: boolean | null
          ticket_round_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          event_id?: string
          expired_at?: string | null
          id?: string
          notified_at?: string | null
          position?: number
          purchased?: boolean | null
          ticket_round_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_waitlist_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_waitlist_ticket_round_id_fkey"
            columns: ["ticket_round_id"]
            isOneToOne: false
            referencedRelation: "ticket_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          cancelled_at: string | null
          claimed_at: string | null
          claimed_by_user_id: string | null
          created_at: string
          drink_id: string | null
          drink_name: string | null
          drink_redeemed: boolean | null
          drink_redeemed_at: string | null
          entry_scanned: boolean | null
          entry_scanned_at: string | null
          entry_scanned_by: string | null
          event_id: string
          fee_absorbed: boolean
          full_name: string | null
          guest_first_name: string | null
          guest_last_name: string | null
          guest_phone: string | null
          has_insurance: boolean | null
          id: string
          insurance_fee: number | null
          is_guest: boolean | null
          is_loyalty_reward: boolean | null
          is_upgrade: boolean | null
          minor_auth_doc_url: string | null
          newsletter_opt_in: boolean | null
          paid_at: string | null
          phone: string | null
          purchase_source: string | null
          qr_code: string | null
          quantity: number
          reference_code: string | null
          refund_amount: number | null
          refund_reason: string | null
          refunded_at: string | null
          refunded_by: string | null
          reservation_id: string | null
          service_fee: number
          sms_opt_in: boolean
          status: string
          stripe_connected_account_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          ticket_round_id: string
          ticket_type: string
          total_price: number
          tracked_link_id: string | null
          unit_price: number
          upgraded_from_ticket_id: string | null
          used: boolean
          used_at: string | null
          user_email: string
          user_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          drink_id?: string | null
          drink_name?: string | null
          drink_redeemed?: boolean | null
          drink_redeemed_at?: string | null
          entry_scanned?: boolean | null
          entry_scanned_at?: string | null
          entry_scanned_by?: string | null
          event_id: string
          fee_absorbed?: boolean
          full_name?: string | null
          guest_first_name?: string | null
          guest_last_name?: string | null
          guest_phone?: string | null
          has_insurance?: boolean | null
          id?: string
          insurance_fee?: number | null
          is_guest?: boolean | null
          is_loyalty_reward?: boolean | null
          is_upgrade?: boolean | null
          minor_auth_doc_url?: string | null
          newsletter_opt_in?: boolean | null
          paid_at?: string | null
          phone?: string | null
          purchase_source?: string | null
          qr_code?: string | null
          quantity?: number
          reference_code?: string | null
          refund_amount?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          reservation_id?: string | null
          service_fee?: number
          sms_opt_in?: boolean
          status?: string
          stripe_connected_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          ticket_round_id: string
          ticket_type?: string
          total_price: number
          tracked_link_id?: string | null
          unit_price: number
          upgraded_from_ticket_id?: string | null
          used?: boolean
          used_at?: string | null
          user_email: string
          user_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          drink_id?: string | null
          drink_name?: string | null
          drink_redeemed?: boolean | null
          drink_redeemed_at?: string | null
          entry_scanned?: boolean | null
          entry_scanned_at?: string | null
          entry_scanned_by?: string | null
          event_id?: string
          fee_absorbed?: boolean
          full_name?: string | null
          guest_first_name?: string | null
          guest_last_name?: string | null
          guest_phone?: string | null
          has_insurance?: boolean | null
          id?: string
          insurance_fee?: number | null
          is_guest?: boolean | null
          is_loyalty_reward?: boolean | null
          is_upgrade?: boolean | null
          minor_auth_doc_url?: string | null
          newsletter_opt_in?: boolean | null
          paid_at?: string | null
          phone?: string | null
          purchase_source?: string | null
          qr_code?: string | null
          quantity?: number
          reference_code?: string | null
          refund_amount?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          reservation_id?: string | null
          service_fee?: number
          sms_opt_in?: boolean
          status?: string
          stripe_connected_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          ticket_round_id?: string
          ticket_type?: string
          total_price?: number
          tracked_link_id?: string | null
          unit_price?: number
          upgraded_from_ticket_id?: string | null
          used?: boolean
          used_at?: string | null
          user_email?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "ticket_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_ticket_round_id_fkey"
            columns: ["ticket_round_id"]
            isOneToOne: false
            referencedRelation: "ticket_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_tracked_link_id_fkey"
            columns: ["tracked_link_id"]
            isOneToOne: false
            referencedRelation: "tracked_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_upgraded_from_ticket_id_fkey"
            columns: ["upgraded_from_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_upgraded_from_ticket_id_fkey"
            columns: ["upgraded_from_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_drink_redemption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_upgraded_from_ticket_id_fkey"
            columns: ["upgraded_from_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_entry_scan"
            referencedColumns: ["id"]
          },
        ]
      }
      tracked_link_clicks: {
        Row: {
          clicked_at: string
          device_type: string | null
          id: string
          ip_hash: string | null
          referrer: string | null
          tracked_link_id: string
          user_agent: string | null
          visitor_id: string | null
        }
        Insert: {
          clicked_at?: string
          device_type?: string | null
          id?: string
          ip_hash?: string | null
          referrer?: string | null
          tracked_link_id: string
          user_agent?: string | null
          visitor_id?: string | null
        }
        Update: {
          clicked_at?: string
          device_type?: string | null
          id?: string
          ip_hash?: string | null
          referrer?: string | null
          tracked_link_id?: string
          user_agent?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracked_link_clicks_tracked_link_id_fkey"
            columns: ["tracked_link_id"]
            isOneToOne: false
            referencedRelation: "tracked_links"
            referencedColumns: ["id"]
          },
        ]
      }
      tracked_links: {
        Row: {
          clicks_count: number
          code: string
          created_at: string
          created_by: string
          dj_id: string | null
          event_id: string | null
          id: string
          is_active: boolean
          label: string
          organizer_user_id: string | null
          owner_kind: string
          promoter_id: string | null
          target_kind: string
          target_venue_id: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          venue_id: string | null
        }
        Insert: {
          clicks_count?: number
          code: string
          created_at?: string
          created_by?: string
          dj_id?: string | null
          event_id?: string | null
          id?: string
          is_active?: boolean
          label: string
          organizer_user_id?: string | null
          owner_kind: string
          promoter_id?: string | null
          target_kind: string
          target_venue_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          venue_id?: string | null
        }
        Update: {
          clicks_count?: number
          code?: string
          created_at?: string
          created_by?: string
          dj_id?: string | null
          event_id?: string | null
          id?: string
          is_active?: boolean
          label?: string
          organizer_user_id?: string | null
          owner_kind?: string
          promoter_id?: string | null
          target_kind?: string
          target_venue_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracked_links_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracked_links_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "djs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracked_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracked_links_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracked_links_target_venue_id_fkey"
            columns: ["target_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracked_links_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_clawbacks: {
        Row: {
          account_id: string | null
          amount_cents: number
          created_at: string
          error: string | null
          id: string
          payment_intent_id: string
          reason: string | null
          resolved_at: string | null
          revenue_distribution_id: string | null
          role: string
          status: string
          transfer_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount_cents?: number
          created_at?: string
          error?: string | null
          id?: string
          payment_intent_id: string
          reason?: string | null
          resolved_at?: string | null
          revenue_distribution_id?: string | null
          role: string
          status?: string
          transfer_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount_cents?: number
          created_at?: string
          error?: string | null
          id?: string
          payment_intent_id?: string
          reason?: string | null
          resolved_at?: string | null
          revenue_distribution_id?: string | null
          role?: string
          status?: string
          transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transfer_clawbacks_revenue_distribution_id_fkey"
            columns: ["revenue_distribution_id"]
            isOneToOne: false
            referencedRelation: "revenue_distributions"
            referencedColumns: ["id"]
          },
        ]
      }
      upsell_cart_rules: {
        Row: {
          addon_drink_id: string | null
          addon_fixed_price: number | null
          created_at: string | null
          description: string | null
          discount_percent: number | null
          free_qty: number
          id: string
          is_active: boolean
          name: string
          priority: number
          reward_collection: string | null
          reward_drink_id: string | null
          rule_type: string
          trigger_collection: string | null
          trigger_min_qty: number
          venue_id: string
        }
        Insert: {
          addon_drink_id?: string | null
          addon_fixed_price?: number | null
          created_at?: string | null
          description?: string | null
          discount_percent?: number | null
          free_qty?: number
          id?: string
          is_active?: boolean
          name: string
          priority?: number
          reward_collection?: string | null
          reward_drink_id?: string | null
          rule_type: string
          trigger_collection?: string | null
          trigger_min_qty?: number
          venue_id: string
        }
        Update: {
          addon_drink_id?: string | null
          addon_fixed_price?: number | null
          created_at?: string | null
          description?: string | null
          discount_percent?: number | null
          free_qty?: number
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
          reward_collection?: string | null
          reward_drink_id?: string | null
          rule_type?: string
          trigger_collection?: string | null
          trigger_min_qty?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upsell_cart_rules_addon_drink_id_fkey"
            columns: ["addon_drink_id"]
            isOneToOne: false
            referencedRelation: "drinks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_cart_rules_reward_drink_id_fkey"
            columns: ["reward_drink_id"]
            isOneToOne: false
            referencedRelation: "drinks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_cart_rules_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      upsell_drink_packs: {
        Row: {
          allowed_collections: string[] | null
          created_at: string
          description: string | null
          drink_count: number
          id: string
          is_active: boolean
          name: string
          original_price: number
          pack_price: number
          venue_id: string
        }
        Insert: {
          allowed_collections?: string[] | null
          created_at?: string
          description?: string | null
          drink_count?: number
          id?: string
          is_active?: boolean
          name: string
          original_price: number
          pack_price: number
          venue_id: string
        }
        Update: {
          allowed_collections?: string[] | null
          created_at?: string
          description?: string | null
          drink_count?: number
          id?: string
          is_active?: boolean
          name?: string
          original_price?: number
          pack_price?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upsell_drink_packs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_taste_profiles: {
        Row: {
          created_at: string
          crowd_size: string
          drink_preference: string
          id: string
          music_style: string
          night_type: string
          updated_at: string
          user_id: string
          vibe_preference: string
        }
        Insert: {
          created_at?: string
          crowd_size: string
          drink_preference: string
          id?: string
          music_style: string
          night_type: string
          updated_at?: string
          user_id: string
          vibe_preference: string
        }
        Update: {
          created_at?: string
          crowd_size?: string
          drink_preference?: string
          id?: string
          music_style?: string
          night_type?: string
          updated_at?: string
          user_id?: string
          vibe_preference?: string
        }
        Relationships: []
      }
      venue_access_documents: {
        Row: {
          created_at: string
          file_name: string
          file_url: string
          id: string
          is_active: boolean
          label: string
          position: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_url: string
          id?: string
          is_active?: boolean
          label: string
          position?: number
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_url?: string
          id?: string
          is_active?: boolean
          label?: string
          position?: number
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_access_documents_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_banned_emails: {
        Row: {
          ban_reason: string | null
          banned_at: string | null
          banned_by: string | null
          created_at: string | null
          email: string
          id: string
          venue_id: string
        }
        Insert: {
          ban_reason?: string | null
          banned_at?: string | null
          banned_by?: string | null
          created_at?: string | null
          email: string
          id?: string
          venue_id: string
        }
        Update: {
          ban_reason?: string | null
          banned_at?: string | null
          banned_by?: string | null
          created_at?: string | null
          email?: string
          id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_banned_emails_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_claim_invitations: {
        Row: {
          accepted_at: string | null
          club_address: string | null
          club_city: string | null
          club_email: string
          club_name: string
          contact_first_name: string | null
          contact_last_name: string | null
          created_at: string
          created_owner_user_id: string | null
          created_venue_id: string | null
          default_split_rules: Json
          event_id: string | null
          expires_at: string
          id: string
          invitation_message: string | null
          organizer_user_id: string
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          club_address?: string | null
          club_city?: string | null
          club_email: string
          club_name: string
          contact_first_name?: string | null
          contact_last_name?: string | null
          created_at?: string
          created_owner_user_id?: string | null
          created_venue_id?: string | null
          default_split_rules?: Json
          event_id?: string | null
          expires_at?: string
          id?: string
          invitation_message?: string | null
          organizer_user_id: string
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          club_address?: string | null
          club_city?: string | null
          club_email?: string
          club_name?: string
          contact_first_name?: string | null
          contact_last_name?: string | null
          created_at?: string
          created_owner_user_id?: string | null
          created_venue_id?: string | null
          default_split_rules?: Json
          event_id?: string | null
          expires_at?: string
          id?: string
          invitation_message?: string | null
          organizer_user_id?: string
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_claim_invitations_created_venue_id_fkey"
            columns: ["created_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_claim_invitations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_commissions: {
        Row: {
          commission_amount: number
          commission_rate: number
          created_at: string
          id: string
          paid_at: string | null
          period_end: string
          period_start: string
          status: string
          total_revenue: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          id?: string
          paid_at?: string | null
          period_end: string
          period_start: string
          status?: string
          total_revenue?: number
          updated_at?: string
          venue_id: string
        }
        Update: {
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          id?: string
          paid_at?: string | null
          period_end?: string
          period_start?: string
          status?: string
          total_revenue?: number
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_commissions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_customers: {
        Row: {
          average_spend: number | null
          ban_reason: string | null
          banned_at: string | null
          banned_by: string | null
          created_at: string | null
          customer_segment: string | null
          email: string
          favorite_drink_category: string | null
          first_name: string | null
          first_visit_at: string | null
          id: string
          is_banned: boolean | null
          last_name: string | null
          last_visit_at: string | null
          notes: string | null
          order_count: number | null
          phone: string | null
          table_count: number | null
          ticket_count: number | null
          total_spent: number | null
          updated_at: string | null
          user_id: string
          venue_id: string
        }
        Insert: {
          average_spend?: number | null
          ban_reason?: string | null
          banned_at?: string | null
          banned_by?: string | null
          created_at?: string | null
          customer_segment?: string | null
          email: string
          favorite_drink_category?: string | null
          first_name?: string | null
          first_visit_at?: string | null
          id?: string
          is_banned?: boolean | null
          last_name?: string | null
          last_visit_at?: string | null
          notes?: string | null
          order_count?: number | null
          phone?: string | null
          table_count?: number | null
          ticket_count?: number | null
          total_spent?: number | null
          updated_at?: string | null
          user_id: string
          venue_id: string
        }
        Update: {
          average_spend?: number | null
          ban_reason?: string | null
          banned_at?: string | null
          banned_by?: string | null
          created_at?: string | null
          customer_segment?: string | null
          email?: string
          favorite_drink_category?: string | null
          first_name?: string | null
          first_visit_at?: string | null
          id?: string
          is_banned?: boolean | null
          last_name?: string | null
          last_visit_at?: string | null
          notes?: string | null
          order_count?: number | null
          phone?: string | null
          table_count?: number | null
          ticket_count?: number | null
          total_spent?: number | null
          updated_at?: string | null
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_customers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_floor_plans: {
        Row: {
          background_image_url: string | null
          created_at: string
          event_id: string | null
          id: string
          layout: Json
          owner_user_id: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          background_image_url?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          layout?: Json
          owner_user_id?: string | null
          updated_at?: string
          venue_id: string
        }
        Update: {
          background_image_url?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          layout?: Json
          owner_user_id?: string | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_floor_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_floor_plans_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_hype_baseline: {
        Row: {
          avg_ticket_price: number | null
          capacity: number | null
          created_at: string
          sales_timing: string | null
          sellout_frequency: string | null
          slow_attendance: number | null
          typical_attendance: number | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          avg_ticket_price?: number | null
          capacity?: number | null
          created_at?: string
          sales_timing?: string | null
          sellout_frequency?: string | null
          slow_attendance?: number | null
          typical_attendance?: number | null
          updated_at?: string
          venue_id: string
        }
        Update: {
          avg_ticket_price?: number | null
          capacity?: number | null
          created_at?: string
          sales_timing?: string | null
          sellout_frequency?: string | null
          slow_attendance?: number | null
          typical_attendance?: number | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_hype_baseline_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_onboarding: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_step: number | null
          id: string
          owner_id: string
          steps: Json | null
          updated_at: string | null
          venue_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_step?: number | null
          id?: string
          owner_id: string
          steps?: Json | null
          updated_at?: string | null
          venue_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_step?: number | null
          id?: string
          owner_id?: string
          steps?: Json | null
          updated_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_onboarding_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_organizer_partnerships: {
        Row: {
          accepted_at: string | null
          created_at: string
          default_split_rules: Json
          id: string
          initiated_by: Database["public"]["Enums"]["partnership_initiator"]
          invitation_message: string | null
          organizer_user_id: string
          requested_at: string
          revoked_at: string | null
          revoked_by: string | null
          split_approved_by_organizer: boolean
          split_approved_by_venue: boolean
          split_proposal: Json | null
          split_proposed_at: string | null
          split_proposed_by: string | null
          status: Database["public"]["Enums"]["partnership_status"]
          updated_at: string
          venue_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          default_split_rules?: Json
          id?: string
          initiated_by: Database["public"]["Enums"]["partnership_initiator"]
          invitation_message?: string | null
          organizer_user_id: string
          requested_at?: string
          revoked_at?: string | null
          revoked_by?: string | null
          split_approved_by_organizer?: boolean
          split_approved_by_venue?: boolean
          split_proposal?: Json | null
          split_proposed_at?: string | null
          split_proposed_by?: string | null
          status?: Database["public"]["Enums"]["partnership_status"]
          updated_at?: string
          venue_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          default_split_rules?: Json
          id?: string
          initiated_by?: Database["public"]["Enums"]["partnership_initiator"]
          invitation_message?: string | null
          organizer_user_id?: string
          requested_at?: string
          revoked_at?: string | null
          revoked_by?: string | null
          split_approved_by_organizer?: boolean
          split_approved_by_venue?: boolean
          split_proposal?: Json | null
          split_proposed_at?: string | null
          split_proposed_by?: string | null
          status?: Database["public"]["Enums"]["partnership_status"]
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_organizer_partnerships_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_sms_contacts: {
        Row: {
          consent_source: string
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_vip: boolean
          phone_e164: string
          sms_consent_at: string
          source_event_id: string | null
          unsubscribed: boolean
          unsubscribed_at: string | null
          user_id: string | null
          venue_id: string
        }
        Insert: {
          consent_source?: string
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_vip?: boolean
          phone_e164: string
          sms_consent_at?: string
          source_event_id?: string | null
          unsubscribed?: boolean
          unsubscribed_at?: string | null
          user_id?: string | null
          venue_id: string
        }
        Update: {
          consent_source?: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_vip?: boolean
          phone_e164?: string
          sms_consent_at?: string
          source_event_id?: string | null
          unsubscribed?: boolean
          unsubscribed_at?: string | null
          user_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_sms_contacts_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_sms_contacts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_subscriptions: {
        Row: {
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          is_early_adopter: boolean
          plan_source: Database["public"]["Enums"]["subscription_plan_source"]
          price_locked: boolean
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_plan: string
          trial_end: string | null
          updated_at: string | null
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          is_early_adopter?: boolean
          plan_source?: Database["public"]["Enums"]["subscription_plan_source"]
          price_locked?: boolean
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_plan?: string
          trial_end?: string | null
          updated_at?: string | null
          venue_id: string
        }
        Update: {
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          is_early_adopter?: boolean
          plan_source?: Database["public"]["Enums"]["subscription_plan_source"]
          price_locked?: boolean
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_plan?: string
          trial_end?: string | null
          updated_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_subscriptions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          absorb_yuno_fees: boolean
          address: string | null
          bar_count: number | null
          bar_names: string[] | null
          cancellation_insurance_enabled: boolean
          city: string
          click_collect_mode: boolean | null
          cloakroom_price: number | null
          cover_position: Json | null
          cover_url: string | null
          created_at: string
          custom_domain: string | null
          description: string | null
          facebook_url: string | null
          floor_plan_url: string | null
          free_drink_mode: string | null
          gallery_images: Json | null
          hidden_from_map: boolean | null
          id: string
          instagram_url: string | null
          invoice_prefix: string | null
          is_hidden: boolean
          latitude: number | null
          legal_address: string | null
          legal_name: string | null
          logo_url: string | null
          longitude: number | null
          menu_enabled: boolean
          min_age: number | null
          minor_auth_doc_name: string | null
          minor_auth_doc_url: string | null
          minors_allowed: boolean
          music_genre: string | null
          name: string
          owner_id: string | null
          short_description: string | null
          siret: string | null
          stripe_account_id: string | null
          stripe_charges_enabled: boolean | null
          stripe_onboarding_complete: boolean | null
          stripe_payouts_enabled: boolean | null
          tiktok_url: string | null
          twitter_url: string | null
          vat_number: string | null
          vip_menu_display_mode: string
          vip_menu_visibility: string
          vip_placement_enabled: boolean | null
          vip_preorder_enabled: boolean
          whatsapp_number: string | null
        }
        Insert: {
          absorb_yuno_fees?: boolean
          address?: string | null
          bar_count?: number | null
          bar_names?: string[] | null
          cancellation_insurance_enabled?: boolean
          city: string
          click_collect_mode?: boolean | null
          cloakroom_price?: number | null
          cover_position?: Json | null
          cover_url?: string | null
          created_at?: string
          custom_domain?: string | null
          description?: string | null
          facebook_url?: string | null
          floor_plan_url?: string | null
          free_drink_mode?: string | null
          gallery_images?: Json | null
          hidden_from_map?: boolean | null
          id: string
          instagram_url?: string | null
          invoice_prefix?: string | null
          is_hidden?: boolean
          latitude?: number | null
          legal_address?: string | null
          legal_name?: string | null
          logo_url?: string | null
          longitude?: number | null
          menu_enabled?: boolean
          min_age?: number | null
          minor_auth_doc_name?: string | null
          minor_auth_doc_url?: string | null
          minors_allowed?: boolean
          music_genre?: string | null
          name: string
          owner_id?: string | null
          short_description?: string | null
          siret?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean | null
          stripe_onboarding_complete?: boolean | null
          stripe_payouts_enabled?: boolean | null
          tiktok_url?: string | null
          twitter_url?: string | null
          vat_number?: string | null
          vip_menu_display_mode?: string
          vip_menu_visibility?: string
          vip_placement_enabled?: boolean | null
          vip_preorder_enabled?: boolean
          whatsapp_number?: string | null
        }
        Update: {
          absorb_yuno_fees?: boolean
          address?: string | null
          bar_count?: number | null
          bar_names?: string[] | null
          cancellation_insurance_enabled?: boolean
          city?: string
          click_collect_mode?: boolean | null
          cloakroom_price?: number | null
          cover_position?: Json | null
          cover_url?: string | null
          created_at?: string
          custom_domain?: string | null
          description?: string | null
          facebook_url?: string | null
          floor_plan_url?: string | null
          free_drink_mode?: string | null
          gallery_images?: Json | null
          hidden_from_map?: boolean | null
          id?: string
          instagram_url?: string | null
          invoice_prefix?: string | null
          is_hidden?: boolean
          latitude?: number | null
          legal_address?: string | null
          legal_name?: string | null
          logo_url?: string | null
          longitude?: number | null
          menu_enabled?: boolean
          min_age?: number | null
          minor_auth_doc_name?: string | null
          minor_auth_doc_url?: string | null
          minors_allowed?: boolean
          music_genre?: string | null
          name?: string
          owner_id?: string | null
          short_description?: string | null
          siret?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean | null
          stripe_onboarding_complete?: boolean | null
          stripe_payouts_enabled?: boolean | null
          tiktok_url?: string | null
          twitter_url?: string | null
          vat_number?: string | null
          vip_menu_display_mode?: string
          vip_menu_visibility?: string
          vip_placement_enabled?: boolean | null
          vip_preorder_enabled?: boolean
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      vip_consumptions: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string
          event_id: string | null
          id: string
          item_name: string
          item_type: string
          menu_item_id: string | null
          notes: string | null
          parent_consumption_id: string | null
          photo_url: string | null
          quantity: number
          served_at: string
          served_by: string | null
          source: string
          special_request: string | null
          staff_id: string | null
          table_reservation_id: string
          total_price: number
          unit_price: number
          venue_id: string
        }
        Insert: {
          brand?: string | null
          category?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          item_name: string
          item_type?: string
          menu_item_id?: string | null
          notes?: string | null
          parent_consumption_id?: string | null
          photo_url?: string | null
          quantity?: number
          served_at?: string
          served_by?: string | null
          source?: string
          special_request?: string | null
          staff_id?: string | null
          table_reservation_id: string
          total_price?: number
          unit_price?: number
          venue_id: string
        }
        Update: {
          brand?: string | null
          category?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          item_name?: string
          item_type?: string
          menu_item_id?: string | null
          notes?: string | null
          parent_consumption_id?: string | null
          photo_url?: string | null
          quantity?: number
          served_at?: string
          served_by?: string | null
          source?: string
          special_request?: string | null
          staff_id?: string | null
          table_reservation_id?: string
          total_price?: number
          unit_price?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vip_consumptions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_consumptions_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "vip_menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_consumptions_parent_consumption_id_fkey"
            columns: ["parent_consumption_id"]
            isOneToOne: false
            referencedRelation: "vip_consumptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_consumptions_table_reservation_id_fkey"
            columns: ["table_reservation_id"]
            isOneToOne: false
            referencedRelation: "table_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_consumptions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_customer_notes: {
        Row: {
          created_at: string | null
          created_by: string
          id: string
          note: string
          note_type: string | null
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          created_by: string
          id?: string
          note: string
          note_type?: string | null
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string
          id?: string
          note?: string
          note_type?: string | null
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vip_customer_notes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_menu_eligibility: {
        Row: {
          created_at: string | null
          custom_price: number | null
          id: string
          included_quantity: number | null
          is_included: boolean | null
          menu_item_id: string
          pack_id: string | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          custom_price?: number | null
          id?: string
          included_quantity?: number | null
          is_included?: boolean | null
          menu_item_id: string
          pack_id?: string | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          custom_price?: number | null
          id?: string
          included_quantity?: number | null
          is_included?: boolean | null
          menu_item_id?: string
          pack_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vip_menu_eligibility_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "vip_menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_menu_eligibility_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "table_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_menu_eligibility_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "table_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_menu_items: {
        Row: {
          brand: string | null
          category: string
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          max_mixers: number
          name: string
          needs_mixer: boolean
          position: number | null
          price: number
          updated_at: string | null
          venue_id: string
          volume_cl: number | null
        }
        Insert: {
          brand?: string | null
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          max_mixers?: number
          name: string
          needs_mixer?: boolean
          position?: number | null
          price?: number
          updated_at?: string | null
          venue_id: string
          volume_cl?: number | null
        }
        Update: {
          brand?: string | null
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          max_mixers?: number
          name?: string
          needs_mixer?: boolean
          position?: number | null
          price?: number
          updated_at?: string | null
          venue_id?: string
          volume_cl?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vip_menu_items_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_quick_items: {
        Row: {
          created_at: string | null
          default_price: number | null
          id: string
          is_active: boolean | null
          item_type: string | null
          name: string
          position: number | null
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          default_price?: number | null
          id?: string
          is_active?: boolean | null
          item_type?: string | null
          name: string
          position?: number | null
          venue_id: string
        }
        Update: {
          created_at?: string | null
          default_price?: number | null
          id?: string
          is_active?: boolean | null
          item_type?: string | null
          name?: string
          position?: number | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vip_quick_items_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_service_moments: {
        Row: {
          created_at: string
          created_by: string | null
          done_at: string | null
          event_id: string | null
          id: string
          kind: string
          label: string | null
          scheduled_at: string | null
          status: string
          table_reservation_id: string | null
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          event_id?: string | null
          id?: string
          kind?: string
          label?: string | null
          scheduled_at?: string | null
          status?: string
          table_reservation_id?: string | null
          venue_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          event_id?: string | null
          id?: string
          kind?: string
          label?: string | null
          scheduled_at?: string | null
          status?: string
          table_reservation_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vip_service_moments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_service_moments_table_reservation_id_fkey"
            columns: ["table_reservation_id"]
            isOneToOne: false
            referencedRelation: "table_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_service_moments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_table_order_items: {
        Row: {
          created_at: string | null
          id: string
          is_included: boolean | null
          menu_item_id: string
          notes: string | null
          order_id: string
          parent_order_item_id: string | null
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_included?: boolean | null
          menu_item_id: string
          notes?: string | null
          order_id: string
          parent_order_item_id?: string | null
          quantity?: number
          unit_price: number
        }
        Update: {
          created_at?: string | null
          id?: string
          is_included?: boolean | null
          menu_item_id?: string
          notes?: string | null
          order_id?: string
          parent_order_item_id?: string | null
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "vip_table_order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "vip_menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_table_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vip_table_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_table_order_items_parent_order_item_id_fkey"
            columns: ["parent_order_item_id"]
            isOneToOne: false
            referencedRelation: "vip_table_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_table_orders: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          id: string
          notes: string | null
          served_at: string | null
          status: string
          table_reservation_id: string
          total_amount: number | null
          user_id: string | null
          venue_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          served_at?: string | null
          status?: string
          table_reservation_id: string
          total_amount?: number | null
          user_id?: string | null
          venue_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          served_at?: string | null
          status?: string
          table_reservation_id?: string
          total_amount?: number | null
          user_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vip_table_orders_table_reservation_id_fkey"
            columns: ["table_reservation_id"]
            isOneToOne: false
            referencedRelation: "table_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_table_orders_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_table_waitlist: {
        Row: {
          created_at: string
          email: string | null
          event_id: string | null
          full_name: string | null
          guest_count: number
          id: string
          note: string | null
          pack_id: string | null
          phone: string | null
          status: string
          updated_at: string
          user_id: string | null
          venue_id: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          event_id?: string | null
          full_name?: string | null
          guest_count?: number
          id?: string
          note?: string | null
          pack_id?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          venue_id: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          event_id?: string | null
          full_name?: string | null
          guest_count?: number
          id?: string
          note?: string | null
          pack_id?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          venue_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vip_table_waitlist_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_table_waitlist_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "table_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_table_waitlist_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_table_waitlist_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "table_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_tables: {
        Row: {
          capacity: number
          created_at: string
          id: string
          position_x: number
          position_y: number
          price: number | null
          table_number: string
          updated_at: string
          venue_id: string
          zone_id: string | null
        }
        Insert: {
          capacity?: number
          created_at?: string
          id?: string
          position_x?: number
          position_y?: number
          price?: number | null
          table_number: string
          updated_at?: string
          venue_id: string
          zone_id?: string | null
        }
        Update: {
          capacity?: number
          created_at?: string
          id?: string
          position_x?: number
          position_y?: number
          price?: number | null
          table_number?: string
          updated_at?: string
          venue_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vip_tables_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_tables_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "table_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_upsell_stats: {
        Row: {
          calculated_at: string
          created_at: string
          event_id: string | null
          id: string
          items_count: number
          minimum_spend: number
          reservation_id: string
          staff_id: string | null
          total_consumed: number
          upsell_amount: number
          venue_id: string
        }
        Insert: {
          calculated_at?: string
          created_at?: string
          event_id?: string | null
          id?: string
          items_count?: number
          minimum_spend?: number
          reservation_id: string
          staff_id?: string | null
          total_consumed?: number
          upsell_amount?: number
          venue_id: string
        }
        Update: {
          calculated_at?: string
          created_at?: string
          event_id?: string | null
          id?: string
          items_count?: number
          minimum_spend?: number
          reservation_id?: string
          staff_id?: string | null
          total_consumed?: number
          upsell_amount?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vip_upsell_stats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_upsell_stats_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "table_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_upsell_stats_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      visitor_events: {
        Row: {
          event_id: string | null
          event_type: string
          id: string
          organizer_user_id: string | null
          page_path: string | null
          payload: Json | null
          session_id: string
          target: string | null
          ts: string
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          event_id?: string | null
          event_type: string
          id?: string
          organizer_user_id?: string | null
          page_path?: string | null
          payload?: Json | null
          session_id: string
          target?: string | null
          ts?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          event_id?: string | null
          event_type?: string
          id?: string
          organizer_user_id?: string | null
          page_path?: string | null
          payload?: Json | null
          session_id?: string
          target?: string | null
          ts?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visitor_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitor_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      visitor_sessions: {
        Row: {
          added_to_cart: boolean | null
          cart_value_cents: number | null
          city: string | null
          completed_order: boolean | null
          connection_type: string | null
          country: string | null
          created_at: string
          device_type: string | null
          duration_seconds: number | null
          entry_page: string | null
          entry_page_type: string | null
          event_id: string | null
          fbclid: string | null
          gclid: string | null
          id: string
          ip_address: string | null
          is_returning: boolean | null
          landing_page_full: string | null
          language: string | null
          last_activity_at: string | null
          order_id: string | null
          organizer_user_id: string | null
          pages_viewed: number | null
          proceeded_to_checkout: boolean | null
          referrer: string | null
          referrer_category: string | null
          referrer_domain: string | null
          region: string | null
          scroll_depth_max: number | null
          session_id: string
          user_agent: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          venue_id: string | null
          viewport_h: number | null
          viewport_w: number | null
          visit_number: number | null
          visited_at: string
          visitor_id: string | null
        }
        Insert: {
          added_to_cart?: boolean | null
          cart_value_cents?: number | null
          city?: string | null
          completed_order?: boolean | null
          connection_type?: string | null
          country?: string | null
          created_at?: string
          device_type?: string | null
          duration_seconds?: number | null
          entry_page?: string | null
          entry_page_type?: string | null
          event_id?: string | null
          fbclid?: string | null
          gclid?: string | null
          id?: string
          ip_address?: string | null
          is_returning?: boolean | null
          landing_page_full?: string | null
          language?: string | null
          last_activity_at?: string | null
          order_id?: string | null
          organizer_user_id?: string | null
          pages_viewed?: number | null
          proceeded_to_checkout?: boolean | null
          referrer?: string | null
          referrer_category?: string | null
          referrer_domain?: string | null
          region?: string | null
          scroll_depth_max?: number | null
          session_id: string
          user_agent?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          venue_id?: string | null
          viewport_h?: number | null
          viewport_w?: number | null
          visit_number?: number | null
          visited_at?: string
          visitor_id?: string | null
        }
        Update: {
          added_to_cart?: boolean | null
          cart_value_cents?: number | null
          city?: string | null
          completed_order?: boolean | null
          connection_type?: string | null
          country?: string | null
          created_at?: string
          device_type?: string | null
          duration_seconds?: number | null
          entry_page?: string | null
          entry_page_type?: string | null
          event_id?: string | null
          fbclid?: string | null
          gclid?: string | null
          id?: string
          ip_address?: string | null
          is_returning?: boolean | null
          landing_page_full?: string | null
          language?: string | null
          last_activity_at?: string | null
          order_id?: string | null
          organizer_user_id?: string | null
          pages_viewed?: number | null
          proceeded_to_checkout?: boolean | null
          referrer?: string | null
          referrer_category?: string | null
          referrer_domain?: string | null
          region?: string | null
          scroll_depth_max?: number | null
          session_id?: string
          user_agent?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          venue_id?: string | null
          viewport_h?: number | null
          viewport_w?: number | null
          visit_number?: number | null
          visited_at?: string
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visitor_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitor_sessions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      analytics_daily_rollup: {
        Row: {
          avg_duration_s: number | null
          cart_value_cents_sum: number | null
          carts: number | null
          checkouts: number | null
          conversions: number | null
          day: string | null
          organizer_user_id: string | null
          returning_count: number | null
          source_diversity: number | null
          unique_visitors: number | null
          venue_id: string | null
          visits: number | null
        }
        Relationships: [
          {
            foreignKeyName: "visitor_sessions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings_public: {
        Row: {
          id: string | null
          maintenance_message: string | null
          maintenance_mode: boolean | null
          payments_disabled: boolean | null
          terms_url: string | null
          terms_version: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string | null
          maintenance_message?: string | null
          maintenance_mode?: boolean | null
          payments_disabled?: boolean | null
          terms_url?: string | null
          terms_version?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string | null
          maintenance_message?: string | null
          maintenance_mode?: boolean | null
          payments_disabled?: boolean | null
          terms_url?: string | null
          terms_version?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      djs_public: {
        Row: {
          bio: string | null
          city: string | null
          country: string | null
          cover_image_url: string | null
          description: string | null
          first_name: string | null
          handle: string | null
          id: string | null
          instagram_url: string | null
          is_active: boolean | null
          is_verified: boolean | null
          last_name: string | null
          music_genres: string[] | null
          profile_image_url: string | null
          slug: string | null
          soundcloud_url: string | null
          spotify_url: string | null
          stage_name: string | null
          tiktok_url: string | null
          venue_id: string | null
          youtube_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "djs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_public: {
        Row: {
          avatar_url: string | null
          city: string | null
          created_at: string | null
          first_name: string | null
          id: string | null
          last_name: string | null
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
        }
        Relationships: []
      }
      tickets_drink_redemption: {
        Row: {
          drink_id: string | null
          drink_name: string | null
          drink_redeemed: boolean | null
          drink_redeemed_at: string | null
          event_id: string | null
          id: string | null
          qr_code: string | null
          status: string | null
          ticket_type: string | null
          venue_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets_entry_scan: {
        Row: {
          entry_scanned: boolean | null
          entry_scanned_at: string | null
          entry_scanned_by: string | null
          event_id: string | null
          id: string | null
          qr_code: string | null
          status: string | null
          ticket_type: string | null
          venue_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles_with_email: {
        Row: {
          created_at: string | null
          email: string | null
          first_name: string | null
          id: string | null
          last_name: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          user_id: string | null
        }
        Relationships: []
      }
      venue_customers_limited: {
        Row: {
          customer_segment: string | null
          first_name: string | null
          first_visit_at: string | null
          id: string | null
          is_banned: boolean | null
          last_name: string | null
          last_visit_at: string | null
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          customer_segment?: string | null
          first_name?: string | null
          first_visit_at?: string | null
          id?: string | null
          is_banned?: boolean | null
          last_name?: string | null
          last_visit_at?: string | null
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          customer_segment?: string | null
          first_name?: string | null
          first_visit_at?: string | null
          id?: string | null
          is_banned?: boolean | null
          last_name?: string | null
          last_visit_at?: string | null
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venue_customers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_subscription_public: {
        Row: {
          status: string | null
          subscription_plan: string | null
          venue_id: string | null
        }
        Insert: {
          status?: string | null
          subscription_plan?: string | null
          venue_id?: string | null
        }
        Update: {
          status?: string | null
          subscription_plan?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venue_subscriptions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_consumption_facts: {
        Row: {
          brand: string | null
          category: string | null
          event_id: string | null
          id: string | null
          is_included: boolean | null
          item_name: string | null
          item_type: string | null
          menu_item_id: string | null
          parent_consumption_id: string | null
          quantity: number | null
          served_at: string | null
          served_by: string | null
          source: string | null
          table_reservation_id: string | null
          total_price: number | null
          unit_price: number | null
          venue_id: string | null
          zone_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _deliver_contest_reward: {
        Args: {
          p_contest_name: string
          p_reward_config: Json
          p_reward_description: string
          p_reward_type: string
          p_user_id: string
          p_venue_id: string
          p_winner_id: string
        }
        Returns: string
      }
      _execute_event_collab_action: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      _insert_recurring_rounds: {
        Args: {
          p_event_id: string
          p_preset_id: string
          p_start_position: number
        }
        Returns: number
      }
      _leaderboard_user_activity: {
        Args: {
          p_end: string
          p_event_id?: string
          p_start: string
          p_venue_id: string
        }
        Returns: {
          order_count: number
          spend: number
          table_count: number
          ticket_count: number
          user_id: string
        }[]
      }
      accept_dj_booking_request: {
        Args: { p_id: string; p_note?: string }
        Returns: string
      }
      add_sms_credits: {
        Args: {
          p_amount: number
          p_balance_id: string
          p_created_by?: string
          p_notes?: string
          p_pack_id?: string
          p_stripe_payment_intent_id?: string
          p_stripe_session_id?: string
          p_type: Database["public"]["Enums"]["sms_credit_tx_type"]
        }
        Returns: number
      }
      admin_cancel_event: {
        Args: { _event_id: string; _reason?: string }
        Returns: undefined
      }
      admin_delete_organizer: { Args: { _user_id: string }; Returns: undefined }
      admin_delete_venue: { Args: { _venue_id: string }; Returns: undefined }
      admin_log_action: {
        Args: {
          _action: string
          _entity_id?: string
          _entity_type?: string
          _metadata?: Json
        }
        Returns: undefined
      }
      admin_reset_user_mfa: { Args: { _user_id: string }; Returns: undefined }
      admin_set_dj_verified: {
        Args: { p_dj_user_id: string; p_reason?: string; p_verified: boolean }
        Returns: undefined
      }
      admin_set_event_discovery_status: {
        Args: {
          _event_id: string
          _reason?: string
          _status: Database["public"]["Enums"]["discovery_status"]
        }
        Returns: undefined
      }
      admin_set_event_published: {
        Args: { _event_id: string; _published: boolean }
        Returns: undefined
      }
      admin_set_organizer_bde_verified: {
        Args: {
          p_organizer_user_id: string
          p_reason?: string
          p_verified: boolean
        }
        Returns: undefined
      }
      admin_set_user_suspended: {
        Args: { _reason?: string; _suspended: boolean; _user_id: string }
        Returns: undefined
      }
      advance_dj_contracts_after_onboarding: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      amend_event_collab_contract: {
        Args: {
          p_cancellation_policy?: string
          p_contract_id: string
          p_split_rules: Json
        }
        Returns: string
      }
      apply_agency_rule_template: {
        Args: {
          p_target_id: string
          p_target_type: string
          p_template_id: string
        }
        Returns: Json
      }
      archive_expired_event_orders: { Args: never; Returns: undefined }
      assign_agency_promoter_to_event: {
        Args: { p_assign?: boolean; p_event_id: string; p_promoter_id: string }
        Returns: undefined
      }
      assign_promoters_to_group: {
        Args: { p_group_id: string; p_promoter_ids: string[] }
        Returns: undefined
      }
      auto_finalize_leaderboard_contests: { Args: never; Returns: number }
      award_loyalty_points: {
        Args: {
          p_amount: number
          p_description?: string
          p_reference_id: string
          p_reference_type: string
          p_user_id: string
          p_venue_id: string
        }
        Returns: number
      }
      backfill_missing_invoices: { Args: never; Returns: number }
      calculate_client_scores: {
        Args: { p_venue_id: string }
        Returns: undefined
      }
      calculate_contest_scores: {
        Args: { p_contest_id: string }
        Returns: undefined
      }
      calculate_customer_tier: {
        Args: { total_spent: number }
        Returns: string
      }
      calculate_vip_upsell: {
        Args: { p_reservation_id: string }
        Returns: {
          minimum_spend: number
          remaining_to_minimum: number
          total_consumed: number
          upsell_amount: number
          upsell_percent: number
        }[]
      }
      can_access_partnership: {
        Args: {
          _organizer_user_id: string
          _user_id: string
          _venue_id: string
        }
        Returns: boolean
      }
      can_manage_event_split: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_event_tables: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_organizer: {
        Args: { p_organizer_user_id: string }
        Returns: boolean
      }
      can_manage_venue: {
        Args: { _user_id: string; _venue_id: string }
        Returns: boolean
      }
      can_staff_flag_venue: { Args: { p_venue_id: string }; Returns: boolean }
      can_view_organizer_promoters: {
        Args: { _organizer_user_id: string; _user_id: string }
        Returns: boolean
      }
      cancel_dj_booking_contract: {
        Args: { p_contract_id: string }
        Returns: undefined
      }
      cancel_dj_booking_request: { Args: { p_id: string }; Returns: undefined }
      cancel_event_collab_contract: {
        Args: { p_contract_id: string }
        Returns: undefined
      }
      cancel_ticket_reservation: {
        Args: { _reservation_id: string }
        Returns: undefined
      }
      check_mfa_disable_rate_limit: {
        Args: { _user_id: string }
        Returns: boolean
      }
      cleanup_affiliate_invitation_meta: { Args: never; Returns: undefined }
      cleanup_expired_invoices: { Args: never; Returns: undefined }
      cleanup_expired_mfa_pending: { Args: never; Returns: undefined }
      cleanup_old_visitor_events: { Args: never; Returns: undefined }
      cleanup_stale_live_pings: { Args: never; Returns: undefined }
      clear_dj_availability_block: {
        Args: { p_date: string }
        Returns: undefined
      }
      collab_event_parties: {
        Args: { p_event_id: string }
        Returns: {
          organizer_user_id: string
          venue_id: string
        }[]
      }
      confirm_ticket_reservation: {
        Args: { _reservation_id: string }
        Returns: undefined
      }
      consume_pack_credit: {
        Args: { p_credit_id: string; p_want: number }
        Returns: number
      }
      consume_sms_credits: {
        Args: { p_amount: number; p_balance_id: string }
        Returns: boolean
      }
      count_campaign_recipients: {
        Args: {
          p_audience_type: string
          p_event_id?: string
          p_type: string
          p_venue_id: string
        }
        Returns: number
      }
      count_campaign_recipients_org: {
        Args: {
          p_audience_type: string
          p_event_id?: string
          p_organizer_user_id: string
          p_type: string
        }
        Returns: number
      }
      count_sms_campaign_recipients: {
        Args: {
          p_event_id?: string
          p_segment_type: string
          p_venue_id: string
        }
        Returns: number
      }
      create_agency: {
        Args: {
          p_city?: string
          p_contact_email?: string
          p_name: string
          p_owner_user_id?: string
          p_slug?: string
        }
        Returns: string
      }
      create_agency_venue_contract: {
        Args: {
          p_agency_id: string
          p_organizer_user_id?: string
          p_override_type?: string
          p_override_value?: number
          p_venue_id?: string
        }
        Returns: string
      }
      create_demo_preview_link: {
        Args: {
          p_expires_at?: string
          p_label: string
          p_password: string
          p_target_account: string
        }
        Returns: {
          id: string
          token: string
        }[]
      }
      create_dj_booking_contract: {
        Args: {
          p_acompte_cents?: number
          p_cachet_cents: number
          p_cancellation_policy?: string
          p_dj_set_id: string
        }
        Returns: string
      }
      create_dj_booking_request: {
        Args: {
          p_agreed_fee?: number
          p_dj_user_id: string
          p_end?: string
          p_event_id?: string
          p_message?: string
          p_organizer_user_id?: string
          p_requested_date: string
          p_requested_genres?: string[]
          p_start?: string
          p_venue_id?: string
        }
        Returns: string
      }
      create_event_collab_contract: {
        Args: {
          p_cancellation_policy?: string
          p_event_id: string
          p_split_rules?: Json
        }
        Returns: string
      }
      create_event_collab_series_contract: {
        Args: {
          p_cancellation_policy?: string
          p_split_rules?: Json
          p_template_id: string
        }
        Returns: string
      }
      current_affiliate_id: { Args: never; Returns: string }
      decline_dj_booking_request: {
        Args: { p_id: string; p_note?: string }
        Returns: undefined
      }
      decrement_balance: {
        Args: { amount: number; current_val: number }
        Returns: number
      }
      delete_mfa_totp_secret: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      demo_is_live: { Args: never; Returns: boolean }
      demo_set_live: { Args: { p_live: boolean }; Returns: boolean }
      dj_accept_team_invitation: { Args: { p_token: string }; Returns: Json }
      dj_audience_analytics: { Args: { p_dj_user_id?: string }; Returns: Json }
      dj_remind_unpaid_fee: { Args: { p_dj_set_id: string }; Returns: Json }
      dj_revoke_team_invitation: { Args: { p_id: string }; Returns: Json }
      dj_team_owner_ids: { Args: never; Returns: string[] }
      dj_user_from_slug: { Args: { p_slug: string }; Returns: string }
      enable_collab_basic_tables: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      enable_collab_tables: { Args: { p_event_id: string }; Returns: string }
      event_audience_demographics: {
        Args: {
          p_event_id?: string
          p_from?: string
          p_scope: string
          p_scope_id: string
          p_to?: string
        }
        Returns: Json
      }
      event_origin_cities: {
        Args: {
          p_event_id?: string
          p_from?: string
          p_scope: string
          p_scope_id: string
          p_to?: string
        }
        Returns: Json
      }
      expire_dj_booking_requests: { Args: never; Returns: undefined }
      expire_stale_ticket_reservations: { Args: never; Returns: number }
      finalize_leaderboard_contest: {
        Args: { p_contest_id: string }
        Returns: Json
      }
      gen_dj_handle: {
        Args: { p_exclude?: string; p_name: string }
        Returns: string
      }
      gen_organizer_slug: {
        Args: { p_exclude?: string; p_name: string }
        Returns: string
      }
      gen_tracked_link_code: { Args: never; Returns: string }
      generate_invoice_number:
        | { Args: { p_venue_id: string }; Returns: string }
        | {
            Args: { p_organizer_user_id?: string; p_venue_id?: string }
            Returns: string
          }
      generate_order_number: { Args: never; Returns: string }
      generate_recurring_events: {
        Args: { p_template_id?: string }
        Returns: number
      }
      generate_table_reference: { Args: never; Returns: string }
      generate_ticket_reference: { Args: never; Returns: string }
      get_agency_event_full_stats: {
        Args: { p_agency_id: string; p_date_from?: string; p_date_to?: string }
        Returns: {
          event_id: string
          event_start_at: string
          event_title: string
          guest_list_count: number
          promoter_count: number
          table_count: number
          table_gross: number
          ticket_count: number
          ticket_gross: number
          total_gross: number
          total_margin: number
          venue_id: string
          venue_name: string
        }[]
      }
      get_agency_promoter_full_stats: {
        Args: { p_agency_id: string; p_date_from?: string; p_date_to?: string }
        Returns: {
          agency_group_id: string
          events_covered: number
          first_conversion_at: string
          first_name: string
          guest_list_count: number
          last_conversion_at: string
          last_name: string
          organizer_user_id: string
          pending_amount: number
          profile_image_url: string
          promo_code: string
          promoter_id: string
          table_commission: number
          table_count: number
          table_gross: number
          ticket_commission: number
          ticket_count: number
          ticket_gross: number
          total_gross: number
          total_margin: number
          total_net: number
          total_paid: number
          venue_id: string
          venue_name: string
        }[]
      }
      get_agency_upcoming_events: {
        Args: { p_agency_id: string; p_days_ahead?: number }
        Returns: {
          assigned_promoter_count: number
          event_id: string
          is_active: boolean
          organizer_user_id: string
          start_at: string
          title: string
          venue_id: string
          venue_name: string
        }[]
      }
      get_customer_timeline: {
        Args: {
          p_limit?: number
          p_organizer_user_id?: string
          p_user_id: string
          p_venue_id?: string
        }
        Returns: {
          activity_type: string
          amount_cents: number
          event_id: string
          metadata: Json
          ref_id: string
          ref_type: string
          ts: string
        }[]
      }
      get_demo_preview_link_public: {
        Args: { p_token: string }
        Returns: {
          invalid_reason: string
          is_valid: boolean
          label: string
          target_account: string
        }[]
      }
      get_dj_audience: {
        Args: never
        Returns: {
          clicks: number
          conversions: number
          event_id: string
          event_title: string
          gl_id: string
          gl_quota: number
          gl_scanned: number
          gl_share_token: string
          gl_signups: number
          link_code: string
          location_name: string
          poster_url: string
          revenue: number
          start_at: string
        }[]
      }
      get_dj_availability: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: {
          d: string
          status: string
        }[]
      }
      get_dj_lineup_email_targets: {
        Args: { p_dj_id: string; p_event_id: string }
        Returns: {
          email: string
          first_name: string
          preferred_language: string
          unsubscribe_token: string
          user_id: string
        }[]
      }
      get_dj_lineup_notification_targets: {
        Args: { p_dj_id: string; p_event_id: string }
        Returns: {
          auth: string
          endpoint: string
          p256dh: string
          user_id: string
        }[]
      }
      get_dj_public_events: {
        Args: { p_slug: string }
        Returns: {
          end_at: string
          id: string
          poster_url: string
          start_at: string
          title: string
          venue_city: string
          venue_id: string
          venue_name: string
        }[]
      }
      get_dj_public_extras: { Args: { p_slug: string }; Returns: Json }
      get_dj_public_profile: { Args: { p_slug: string }; Returns: Json }
      get_dj_tiers: { Args: { p_user_id: string }; Returns: Json }
      get_dj_top_past_events: {
        Args: { p_slug: string }
        Returns: {
          id: string
          interest_count: number
          poster_url: string
          start_at: string
          title: string
          venue_city: string
          venue_id: string
          venue_name: string
        }[]
      }
      get_event_managing_organizer: {
        Args: { _event_id: string }
        Returns: string
      }
      get_guest_list_by_token: {
        Args: { _token: string }
        Returns: {
          created_at: string
          dj_id: string | null
          entry_deadline: string | null
          entry_kind: string
          event_id: string
          free_before_time: string
          holder_label: string | null
          holder_type: string
          id: string
          includes_drink: boolean
          is_active: boolean
          organizer_user_id: string | null
          promoter_id: string | null
          quota: number
          quota_drink: number
          quota_female: number | null
          quota_male: number | null
          quota_normal: number
          quota_table: number
          share_token: string
          updated_at: string
          venue_id: string | null
          visible_on_club_page: boolean
        }[]
        SetofOptions: {
          from: "*"
          to: "guest_lists"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_guest_list_public_fill: {
        Args: { _guest_list_id: string }
        Returns: {
          female_count: number
          male_count: number
          total_count: number
        }[]
      }
      get_mfa_totp_secret: { Args: { p_user_id: string }; Returns: string }
      get_onboarding_link_public: {
        Args: { p_token: string }
        Returns: {
          invalid_reason: string
          is_valid: boolean
          label: string
          organizer_name: string
          organizer_user_id: string
          role: string
          venue_cover: string
          venue_id: string
          venue_name: string
        }[]
      }
      get_or_create_customer_loyalty: {
        Args: {
          p_user_id: string
          p_venue_customer_id: string
          p_venue_id: string
        }
        Returns: string
      }
      get_or_create_sms_balance: {
        Args: { p_organizer_id?: string; p_venue_id?: string }
        Returns: string
      }
      get_or_create_venue_customer: {
        Args: {
          p_email: string
          p_first_name?: string
          p_last_name?: string
          p_phone?: string
          p_user_id: string
          p_venue_id: string
        }
        Returns: string
      }
      get_org_staff_organizer: { Args: { _user_id: string }; Returns: string }
      get_organizer_customer_segments: {
        Args: { p_organizer_user_id: string }
        Returns: {
          avg_basket: number
          ban_reason: string
          banned_at: string
          email: string
          first_name: string
          first_visit_at: string
          id: string
          is_banned: boolean
          last_activity_at: string
          last_name: string
          last_visit_at: string
          notes: string
          order_count: number
          phone: string
          preferred_dow: number
          preferred_event_title: string
          revenue_30d: number
          revenue_90d: number
          revenue_prev_90d: number
          table_count: number
          ticket_count: number
          total_spent: number
          user_id: string
          visit_nights: number
          visits_per_month: number
        }[]
      }
      get_owner_venue_ids: { Args: { _owner_id: string }; Returns: string[] }
      get_partner_venue_ticket_presets: {
        Args: { p_event_id: string }
        Returns: {
          created_at: string
          drink_cutoff_time: string | null
          drink_deadline_hours: number | null
          drink_deadline_type: string | null
          id: string
          includes_drink: boolean | null
          name: string
          organizer_user_id: string | null
          rounds: Json
          selling_mode: string | null
          ticket_type: string
          total_capacity: number
          updated_at: string
          venue_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ticket_presets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_platform_audience_stats: {
        Args: { p_from: string; p_to: string; p_venue_id?: string }
        Returns: Json
      }
      get_public_favorite_count: {
        Args: {
          _dj_id?: string
          _drink_id?: string
          _event_id?: string
          _favorite_type: string
          _venue_id?: string
        }
        Returns: number
      }
      get_public_favorite_counts: {
        Args: { _favorite_type: string }
        Returns: {
          target_id: string
          total_count: number
        }[]
      }
      get_reservation_venue_id: {
        Args: { _reservation_id: string }
        Returns: string
      }
      get_tracked_link_stats: {
        Args: {
          p_dj_id?: string
          p_event_id?: string
          p_organizer_user_id?: string
          p_owner_kind: string
          p_promoter_id?: string
          p_target_kind?: string
          p_venue_id?: string
        }
        Returns: {
          clicks: number
          code: string
          conversions: number
          created_at: string
          event_id: string
          id: string
          is_active: boolean
          label: string
          revenue: number
          target_kind: string
        }[]
      }
      get_user_nightlife_stats: {
        Args: { p_user_id: string }
        Returns: {
          drinks_ordered: number
          favorite_club_id: string
          favorite_club_logo: string
          favorite_club_name: string
          favorite_drink: string
          last_event_date: string
          last_event_id: string
          last_event_title: string
          last_event_venue_name: string
          most_active_hour: number
          next_event_date: string
          next_event_id: string
          next_event_title: string
          next_event_venue_name: string
          nights_attended: number
          total_spent: number
        }[]
      }
      get_user_venue_id: { Args: { _user_id: string }; Returns: string }
      get_venue_customer_segments: {
        Args: { p_venue_id: string }
        Returns: {
          avg_basket: number
          ban_reason: string
          banned_at: string
          email: string
          first_name: string
          first_visit_at: string
          id: string
          is_banned: boolean
          last_activity_at: string
          last_name: string
          last_visit_at: string
          notes: string
          order_count: number
          phone: string
          preferred_dow: number
          preferred_event_title: string
          revenue_30d: number
          revenue_90d: number
          revenue_prev_90d: number
          table_count: number
          ticket_count: number
          total_spent: number
          user_id: string
          visit_nights: number
          visits_per_month: number
        }[]
      }
      get_venue_user_ids: { Args: { _venue_id: string }; Returns: string[] }
      get_vip_consumption_analytics: {
        Args: {
          p_event_id?: string
          p_from?: string
          p_to?: string
          p_tz?: string
          p_venue_id: string
        }
        Returns: Json
      }
      get_vip_guest_profile: {
        Args: { p_email?: string; p_user_id?: string; p_venue_id: string }
        Returns: Json
      }
      get_vip_host_leaderboard: {
        Args: {
          p_event_id?: string
          p_from?: string
          p_to?: string
          p_venue_id: string
        }
        Returns: Json
      }
      get_visitor_stats: {
        Args: {
          p_compare_end: string
          p_compare_start: string
          p_end: string
          p_start: string
          p_venue_id: string
        }
        Returns: {
          current_converted: number
          current_visits: number
          previous_converted: number
          previous_visits: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hash_maintenance_password: { Args: { password: string }; Returns: string }
      increment_balance: {
        Args: { amount: number; current_val: number }
        Returns: number
      }
      increment_venue_customer_stats: {
        Args: {
          p_order_delta?: number
          p_spent_delta?: number
          p_table_delta?: number
          p_ticket_delta?: number
          p_user_id: string
          p_venue_id: string
        }
        Returns: undefined
      }
      is_account_suspended: { Args: { _user_id: string }; Returns: boolean }
      is_active_affiliate: { Args: never; Returns: boolean }
      is_agency_owner: {
        Args: { _agency_id: string; _user_id: string }
        Returns: boolean
      }
      is_customer_banned: {
        Args: { p_user_id: string; p_venue_id: string }
        Returns: boolean
      }
      is_email_banned: {
        Args: { p_email: string; p_venue_id: string }
        Returns: boolean
      }
      is_email_banned_org: {
        Args: { p_email: string; p_organizer_user_id: string }
        Returns: boolean
      }
      is_event_collab_participant: {
        Args: { p_event_id: string; p_user: string }
        Returns: boolean
      }
      is_event_organizer: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      is_event_partner_organizer: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      is_event_partner_venue_owner: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_staff: {
        Args: { _organizer_user_id: string; _role?: string; _user_id: string }
        Returns: boolean
      }
      is_org_staff_for_event: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_team_member: {
        Args: {
          _min_role?: string
          _organizer_user_id: string
          _user_id: string
        }
        Returns: boolean
      }
      is_organizer_promoter_admin: {
        Args: { _organizer_user_id: string; _user_id: string }
        Returns: boolean
      }
      is_owner_of_any_venue: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_venue_owner: {
        Args: { _user_id: string; _venue_id: string }
        Returns: boolean
      }
      is_venue_staff: {
        Args: { _user_id: string; _venue_id: string }
        Returns: boolean
      }
      log_admin_action: {
        Args: {
          _action: string
          _entity_id?: string
          _entity_type?: string
          _metadata?: Json
        }
        Returns: undefined
      }
      manage_event_collaboration: {
        Args: { p_action: string; p_event_id: string }
        Returns: undefined
      }
      manager_has_permission: {
        Args: { _permission: string; _user_id: string; _venue_id: string }
        Returns: boolean
      }
      normalize_split_rules: { Args: { rules: Json }; Returns: Json }
      notify_collab_party: {
        Args: {
          p_event_id: string
          p_message: string
          p_metadata: Json
          p_organizer_user_id: string
          p_priority: string
          p_recipient_role: string
          p_reference_id: string
          p_reference_type: string
          p_title: string
          p_type: string
          p_venue_id: string
        }
        Returns: undefined
      }
      org_member_has_permission: {
        Args: {
          _organizer_user_id: string
          _permission: string
          _user_id: string
        }
        Returns: boolean
      }
      organizer_ban_customer: {
        Args: { p_email: string; p_organizer_user_id: string; p_reason: string }
        Returns: undefined
      }
      organizer_save_customer_note: {
        Args: { p_email: string; p_notes: string; p_organizer_user_id: string }
        Returns: undefined
      }
      organizer_unban_customer: {
        Args: {
          p_email: string
          p_organizer_user_id: string
          p_reason?: string
        }
        Returns: undefined
      }
      organizer_warn_customer: {
        Args: {
          p_details?: string
          p_email: string
          p_organizer_user_id: string
          p_reason: string
        }
        Returns: undefined
      }
      preview_unsubscribe: {
        Args: { p_token: string }
        Returns: {
          already_unsubscribed: boolean
          email: string
          scope_name: string
        }[]
      }
      process_due_collab_actions: { Args: never; Returns: undefined }
      purge_expired_personal_data: { Args: never; Returns: undefined }
      recalc_all_leaderboards: { Args: never; Returns: number }
      record_promoter_conversion: {
        Args: {
          p_amount: number
          p_conversion_type: string
          p_event_id?: string
          p_guest_list_entry_id?: string
          p_order_id?: string
          p_promoter_id: string
          p_scan_at?: string
          p_table_reservation_id?: string
          p_ticket_id?: string
        }
        Returns: Json
      }
      record_tracked_link_click: {
        Args: {
          p_code: string
          p_device_type?: string
          p_ip_hash?: string
          p_referrer?: string
          p_user_agent?: string
          p_visitor_id?: string
        }
        Returns: Json
      }
      refresh_analytics_daily_rollup: { Args: never; Returns: undefined }
      refresh_analytics_rollup: { Args: never; Returns: undefined }
      refund_sms_credits: {
        Args: {
          p_amount: number
          p_balance_id: string
          p_notes?: string
          p_sms_log_id?: string
        }
        Returns: number
      }
      release_pack_credit: {
        Args: { p_amount: number; p_credit_id: string }
        Returns: undefined
      }
      request_event_collab_action: {
        Args: { p_action: string; p_event_id: string }
        Returns: string
      }
      reserve_table_slot: {
        Args: {
          _capacity_zone_id: string
          _deposit: number
          _event_id: string
          _fee_absorbed?: boolean
          _full_name: string
          _guest_count: number
          _is_guest: boolean
          _management_fee: number
          _newsletter_opt_in: boolean
          _pack_id: string
          _phone: string
          _placement_status: string
          _purchase_source: string
          _qr_code: string
          _remarks: string
          _requested_table_id: string
          _sms_opt_in: boolean
          _status: string
          _total_price: number
          _user_email: string
          _user_id: string
          _zone_id: string
        }
        Returns: string
      }
      reserve_ticket_capacity: {
        Args: {
          _capacity_per_unit?: number
          _event_id: string
          _guest_email: string
          _quantity: number
          _ticket_round_id: string
          _ttl_minutes?: number
          _user_id: string
        }
        Returns: {
          expires_at: string
          reservation_id: string
        }[]
      }
      resolve_campaign_audience: {
        Args: { p_campaign_id: string }
        Returns: {
          email: string
          first_name: string
          last_name: string
          unsubscribe_token: string
          user_id: string
        }[]
      }
      resolve_organizer_slug: { Args: { p_slug: string }; Returns: string }
      resolve_sms_campaign_recipients: {
        Args: {
          p_event_id?: string
          p_segment_type: string
          p_venue_id: string
        }
        Returns: {
          contact_id: string
          full_name: string
          phone_e164: string
          user_id: string
        }[]
      }
      resolve_venue_customer: {
        Args: { p_email: string; p_user_id: string; p_venue_id: string }
        Returns: string
      }
      respond_event_collab_action: {
        Args: { p_approve: boolean; p_request_id: string }
        Returns: string
      }
      search_djs_marketplace: {
        Args: {
          p_available_on?: string
          p_booker_mode?: boolean
          p_city?: string
          p_genre?: string
          p_limit?: number
          p_max_fee?: number
          p_min_fee?: number
          p_min_followers?: number
          p_offset?: number
          p_origin_lat?: number
          p_origin_lng?: number
          p_played_venue?: string
          p_radius_km?: number
        }
        Returns: {
          available: boolean
          city: string
          completeness_pct: number
          country: string
          currency: string
          followers_count: number
          handle: string
          is_verified: boolean
          max_fee: number
          min_fee: number
          music_genres: string[]
          profile_image_url: string
          rank_score: number
          rate_note: string
          resident: boolean
          resident_scopes: Json
          rising: boolean
          slug: string
          stage_name: string
          user_id: string
        }[]
      }
      search_organizers: {
        Args: { search_term: string }
        Returns: {
          avatar_url: string
          first_name: string
          id: string
          last_name: string
          organization_name: string
        }[]
      }
      search_venues_for_agency: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          city: string
          id: string
          name: string
        }[]
      }
      seed_dj_event_tracked_link: {
        Args: { p_dj_id: string; p_event_id: string }
        Returns: undefined
      }
      seed_event_tracked_links: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      seed_venue_tracked_links: {
        Args: { p_venue_id: string }
        Returns: undefined
      }
      set_agency_contract_status: {
        Args: { p_contract_id: string; p_status: string }
        Returns: string
      }
      set_dj_availability_block: {
        Args: { p_date: string; p_reason?: string }
        Returns: undefined
      }
      set_event_sale_password: {
        Args: { p_event_id: string; p_password: string }
        Returns: undefined
      }
      settle_agency_promoter_payout: {
        Args: { p_period_label?: string; p_promoter_id: string }
        Returns: Json
      }
      settle_club_to_agency: {
        Args: {
          p_agency_id: string
          p_organizer_user_id?: string
          p_period_label?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      settle_promoter_payout: {
        Args: { p_period_label?: string; p_promoter_id: string }
        Returns: Json
      }
      sign_agency_venue_contract: {
        Args: { p_contract_id: string }
        Returns: string
      }
      sign_dj_booking_contract: {
        Args: { p_contract_id: string; p_ip?: string; p_user_agent?: string }
        Returns: string
      }
      sign_event_collab_contract: {
        Args: {
          p_contract_id: string
          p_ip?: string
          p_terms_version?: string
          p_user_agent?: string
        }
        Returns: string
      }
      sign_event_collab_series_contract: {
        Args: {
          p_contract_id: string
          p_ip?: string
          p_terms_version?: string
          p_user_agent?: string
        }
        Returns: string
      }
      staff_ban_customer: {
        Args: {
          p_email: string
          p_first_name?: string
          p_last_name?: string
          p_reason: string
          p_user_id: string
          p_venue_id: string
        }
        Returns: string
      }
      staff_unban_customer: {
        Args: {
          p_email: string
          p_reason?: string
          p_user_id: string
          p_venue_id: string
        }
        Returns: string
      }
      staff_warn_customer: {
        Args: {
          p_details?: string
          p_email: string
          p_first_name?: string
          p_last_name?: string
          p_reason: string
          p_user_id: string
          p_venue_id: string
        }
        Returns: string
      }
      store_mfa_totp_secret: {
        Args: { p_secret: string; p_user_id: string }
        Returns: undefined
      }
      terminate_event_collab_series_contract: {
        Args: { p_contract_id: string }
        Returns: undefined
      }
      unlock_event_sale: {
        Args: { p_event_id: string; p_guest_email?: string; p_password: string }
        Returns: boolean
      }
      unsubscribe_by_token: {
        Args: { p_token: string }
        Returns: {
          email: string
          scope_name: string
          success: boolean
        }[]
      }
      update_agency_profile: {
        Args: {
          p_agency_id: string
          p_bio?: string
          p_city?: string
          p_contact_email?: string
          p_instagram_url?: string
          p_logo_url?: string
          p_name?: string
          p_website_url?: string
          p_whatsapp_number?: string
        }
        Returns: undefined
      }
      update_maintenance_password: {
        Args: { new_password: string }
        Returns: undefined
      }
      verify_demo_preview_password: {
        Args: { p_password: string; p_token: string }
        Returns: {
          ok: boolean
          reason: string
          target_account: string
        }[]
      }
      verify_invitation_token: {
        Args: { _email: string; _token: string }
        Returns: {
          invitation_id: string
          is_valid: boolean
          venue_id: string
        }[]
      }
      verify_maintenance_password: { Args: { plain: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "client"
        | "barman"
        | "owner"
        | "bouncer"
        | "promoter"
        | "dj"
        | "manager"
        | "admin"
        | "vip_host"
        | "cloakroom"
        | "organizer"
        | "affiliate"
        | "affiliate_member"
        | "agency"
      discovery_status: "pending" | "approved" | "rejected"
      event_kind:
        | "club_event"
        | "organizer_event"
        | "private_event"
        | "public_event"
      event_mode:
        | "solo_venue"
        | "solo_organizer"
        | "co_event"
        | "venue_rental"
        | "org_hosted"
      event_visibility: "public" | "private" | "unlisted"
      partnership_initiator: "venue" | "organizer"
      partnership_status: "pending" | "active" | "revoked" | "declined"
      profile_type: "club" | "organizer"
      promoter_condition_type: "tickets" | "drinks" | "tables" | "revenue"
      promoter_reward_type: "money" | "free_entry" | "vip" | "drinks"
      sms_campaign_status:
        | "draft"
        | "scheduled"
        | "sending"
        | "sent"
        | "failed"
        | "cancelled"
      sms_credit_tx_type:
        | "purchase"
        | "consume"
        | "refund"
        | "bonus"
        | "admin_adjust"
      sms_purpose:
        | "ticket_confirm"
        | "reminder_j1"
        | "guest_list"
        | "vip_confirm"
        | "campaign"
        | "manual"
        | "other"
      sms_status: "queued" | "sent" | "delivered" | "failed" | "undelivered"
      subscription_plan_source: "paid" | "collab_auto"
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
      app_role: [
        "client",
        "barman",
        "owner",
        "bouncer",
        "promoter",
        "dj",
        "manager",
        "admin",
        "vip_host",
        "cloakroom",
        "organizer",
        "affiliate",
        "affiliate_member",
        "agency",
      ],
      discovery_status: ["pending", "approved", "rejected"],
      event_kind: [
        "club_event",
        "organizer_event",
        "private_event",
        "public_event",
      ],
      event_mode: [
        "solo_venue",
        "solo_organizer",
        "co_event",
        "venue_rental",
        "org_hosted",
      ],
      event_visibility: ["public", "private", "unlisted"],
      partnership_initiator: ["venue", "organizer"],
      partnership_status: ["pending", "active", "revoked", "declined"],
      profile_type: ["club", "organizer"],
      promoter_condition_type: ["tickets", "drinks", "tables", "revenue"],
      promoter_reward_type: ["money", "free_entry", "vip", "drinks"],
      sms_campaign_status: [
        "draft",
        "scheduled",
        "sending",
        "sent",
        "failed",
        "cancelled",
      ],
      sms_credit_tx_type: [
        "purchase",
        "consume",
        "refund",
        "bonus",
        "admin_adjust",
      ],
      sms_purpose: [
        "ticket_confirm",
        "reminder_j1",
        "guest_list",
        "vip_confirm",
        "campaign",
        "manual",
        "other",
      ],
      sms_status: ["queued", "sent", "delivered", "failed", "undelivered"],
      subscription_plan_source: ["paid", "collab_auto"],
    },
  },
} as const
