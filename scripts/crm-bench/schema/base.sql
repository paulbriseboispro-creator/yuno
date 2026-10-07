-- GÉNÉRÉ par scripts/crm-bench/dump-base.mjs — ne pas éditer à la main.
-- Prod lue le 2026-10-07T15:19:17.444Z ; 92 tables, 192 fonctions.

DO $$ BEGIN CREATE TYPE public.app_role AS ENUM ('client', 'barman', 'owner', 'bouncer', 'promoter', 'dj', 'manager', 'admin', 'vip_host', 'cloakroom', 'organizer', 'affiliate', 'affiliate_member', 'agency'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.discovery_status AS ENUM ('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.event_kind AS ENUM ('club_event', 'organizer_event', 'private_event', 'public_event'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.event_mode AS ENUM ('solo_venue', 'solo_organizer', 'co_event', 'venue_rental', 'org_hosted'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.event_visibility AS ENUM ('public', 'private', 'unlisted'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.partnership_initiator AS ENUM ('venue', 'organizer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.partnership_status AS ENUM ('pending', 'active', 'revoked', 'declined'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.profile_type AS ENUM ('club', 'organizer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.promoter_condition_type AS ENUM ('tickets', 'drinks', 'tables', 'revenue'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.promoter_reward_type AS ENUM ('money', 'free_entry', 'vip', 'drinks'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sms_campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'paused', 'sent', 'failed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sms_credit_tx_type AS ENUM ('purchase', 'consume', 'refund', 'bonus', 'admin_adjust'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sms_purpose AS ENUM ('ticket_confirm', 'reminder_j1', 'guest_list', 'vip_confirm', 'campaign', 'manual', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sms_status AS ENUM ('queued', 'sent', 'delivered', 'failed', 'undelivered'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.subscription_plan_source AS ENUM ('paid', 'collab_auto'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  "id" uuid DEFAULT gen_random_uuid(),
  "admin_id" uuid DEFAULT auth.uid(),
  "action" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  "id" uuid DEFAULT gen_random_uuid(),
  "scope" text DEFAULT 'platform'::text,
  "event_id" uuid,
  "notification_type" text NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "reference_type" text,
  "reference_id" text,
  "priority" text DEFAULT 'normal'::text,
  "dedup_key" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "read_at" timestamp with time zone,
  "read_by" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.admin_support_sessions (
  "id" uuid DEFAULT gen_random_uuid(),
  "grant_id" uuid NOT NULL,
  "admin_id" uuid NOT NULL,
  "target_user_id" uuid NOT NULL,
  "auth_session_id" uuid,
  "status" text DEFAULT 'pending'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "registered_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "expires_at" timestamp with time zone DEFAULT (now() + '12:00:00'::interval)
);
CREATE TABLE IF NOT EXISTS public.agencies (
  "id" uuid DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "slug" text,
  "city" text,
  "logo_url" text,
  "bio" text,
  "instagram_url" text,
  "whatsapp_number" text,
  "website_url" text,
  "contact_email" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "tiktok_url" text,
  "name_changed_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.contact_base_cache (
  "scope_key" text,
  "id" uuid,
  "list_import_id" uuid,
  "venue_id" text,
  "organizer_user_id" uuid,
  "email" text,
  "phone_e164" text,
  "first_name" text,
  "last_name" text,
  "country_code" text,
  "country" text,
  "region" text,
  "city" text,
  "postal_code" text,
  "zone" text,
  "age" integer,
  "gender" text,
  "newsletter_opt_in" boolean,
  "added_at" timestamp with time zone,
  "last_purchase_at" timestamp with time zone,
  "total_spent" numeric,
  "event_count" integer,
  "extra" jsonb,
  "created_at" timestamp with time zone,
  "origin" text,
  "user_id" uuid,
  "imported_spent" numeric,
  "imported_events" integer,
  "yuno_spent" numeric,
  "yuno_events" integer,
  "yuno_first_at" timestamp with time zone,
  "yuno_last_at" timestamp with time zone,
  "ticket_count" integer,
  "table_count" integer,
  "order_count" integer,
  "guest_list_count" integer,
  "last_seen_at" timestamp with time zone,
  "eng_status" text,
  "emails_sent" integer,
  "opens" integer,
  "clicks" integer,
  "last_opened_at" timestamp with time zone,
  "last_clicked_at" timestamp with time zone,
  "unsubscribed_at" timestamp with time zone,
  "bounced" boolean,
  "subscribed" boolean,
  "has_account" boolean
);
CREATE TABLE IF NOT EXISTS public.contact_base_cache_state (
  "scope_key" text NOT NULL,
  "built_at" timestamp with time zone NOT NULL,
  "dirty_at" timestamp with time zone,
  "last_read_at" timestamp with time zone,
  "venue_id" text,
  "organizer_user_id" uuid,
  "row_count" integer
);
CREATE TABLE IF NOT EXISTS public.contact_engagement (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "organizer_user_id" uuid,
  "scope_key" text,
  "email" text NOT NULL,
  "user_id" uuid,
  "origin" text DEFAULT 'import'::text,
  "emails_sent" integer DEFAULT 0,
  "emails_delivered" integer DEFAULT 0,
  "opens" integer DEFAULT 0,
  "clicks" integer DEFAULT 0,
  "click_events" integer DEFAULT 0,
  "opens_90d" integer DEFAULT 0,
  "clicks_90d" integer DEFAULT 0,
  "first_sent_at" timestamp with time zone,
  "last_sent_at" timestamp with time zone,
  "last_opened_at" timestamp with time zone,
  "last_clicked_at" timestamp with time zone,
  "bounced_at" timestamp with time zone,
  "complained_at" timestamp with time zone,
  "unsubscribed_at" timestamp with time zone,
  "suppressed" boolean DEFAULT false,
  "subscribed" boolean DEFAULT false,
  "status" text DEFAULT 'new'::text,
  "status_changed_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.contact_segments (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "organizer_user_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "definition" jsonb DEFAULT '{"match": "all", "version": 1, "conditions": []}'::jsonb,
  "origin" text DEFAULT 'suggested'::text,
  "suggestion_key" text,
  "list_import_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.crm_contact_notes (
  "scope_key" text NOT NULL,
  "email" text NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "tags" text[] DEFAULT '{}'::text[],
  "note" text,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.crm_email_settings (
  "scope_key" text NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "sender_name" text,
  "reply_to" text,
  "postal_address" text,
  "quiet_hours" boolean DEFAULT true,
  "waves" boolean DEFAULT false,
  "notify_done" boolean DEFAULT true,
  "test_emails" text[] DEFAULT '{}'::text[],
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.crm_import_journal (
  "list_import_id" uuid NOT NULL,
  "email" text NOT NULL,
  "prev_opted_in" boolean NOT NULL,
  "prev_import_id" uuid,
  "prev_first_name" text,
  "prev_last_name" text
);
CREATE TABLE IF NOT EXISTS public.crm_imports (
  "list_import_id" uuid NOT NULL,
  "scope_key" text NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "kind" text DEFAULT 'file'::text,
  "title" text,
  "consent" text NOT NULL,
  "mode" text DEFAULT 'complete'::text,
  "new_count" integer DEFAULT 0,
  "existing_count" integer DEFAULT 0,
  "file_dup_count" integer DEFAULT 0,
  "bad_count" integer DEFAULT 0,
  "status" text DEFAULT 'running'::text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "finished_at" timestamp with time zone,
  "undone_at" timestamp with time zone,
  "undone_by" uuid
);
CREATE TABLE IF NOT EXISTS public.crm_pricing (
  "id" boolean DEFAULT true,
  "config" jsonb NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.crm_segment_counts (
  "scope_key" text NOT NULL,
  "seg_key" text NOT NULL,
  "day" date NOT NULL,
  "n" integer NOT NULL,
  "reachable" integer NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.crm_segments (
  "id" uuid DEFAULT gen_random_uuid(),
  "scope_key" text NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "template" text,
  "definition" jsonb DEFAULT '{}'::jsonb,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.crm_settings (
  "scope_key" text NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "regular_min_nights" smallint DEFAULT 3,
  "regular_window_months" smallint DEFAULT 6,
  "lapse_months" smallint DEFAULT 4,
  "night_end_hour" smallint DEFAULT 6,
  "retention_months" smallint,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  "business_type" text,
  "deletion_requested_at" timestamp with time zone,
  "deletion_requested_by" uuid,
  "sending_frozen_at" timestamp with time zone,
  "sending_frozen_reason" text,
  "sending_frozen_by" uuid,
  "learning_contrib" boolean DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.crm_signup_entries (
  "id" uuid DEFAULT gen_random_uuid(),
  "page_id" uuid NOT NULL,
  "first_name" text NOT NULL,
  "email" text,
  "phone" text,
  "answers" jsonb DEFAULT '{}'::jsonb,
  "src" text,
  "lang" text DEFAULT 'fr'::text,
  "consent_text" text NOT NULL,
  "visitor_hash" text,
  "confirm_hash" text,
  "confirm_sent_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone,
  "subscribed" boolean,
  "created_at" timestamp with time zone DEFAULT now(),
  "last_name" text,
  "birthdate" date,
  "instagram" text,
  "city" text,
  "was_known" boolean,
  "party_size" smallint
);
CREATE TABLE IF NOT EXISTS public.crm_signup_pages (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "organizer_user_id" uuid,
  "slug" text NOT NULL,
  "status" text DEFAULT 'draft'::text,
  "occasion" text DEFAULT 'night'::text,
  "event_id" uuid,
  "title" text DEFAULT ''::text,
  "tagline" text DEFAULT ''::text,
  "button_label" text DEFAULT ''::text,
  "thanks_message" text DEFAULT ''::text,
  "poster_url" text,
  "theme" jsonb DEFAULT '{"bg": "#0A0A0A", "font": "display", "accent": "#E3141B"}'::jsonb,
  "fields" jsonb DEFAULT '{"extra": {}, "contact": "both", "questions": []}'::jsonb,
  "show_count" boolean DEFAULT true,
  "reward" jsonb,
  "opens_at" timestamp with time zone,
  "sale_opens_at" timestamp with time zone,
  "closes_at" timestamp with time zone,
  "contact_import_id" uuid,
  "email_import_id" uuid,
  "published_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "kind" text DEFAULT 'prevente'::text,
  "design" jsonb DEFAULT '{"bg": "", "acc": "", "pal": "red", "tpl": "soiree", "font": ""}'::jsonb,
  "countdown" boolean DEFAULT true,
  "closes_mode" text DEFAULT 'date'::text,
  "relance" jsonb DEFAULT '{}'::jsonb,
  "notified_at" timestamp with time zone,
  "lang" text DEFAULT 'fr'::text,
  "custom_design" jsonb,
  "ai_author" text,
  "mcp_grant_id" uuid,
  "ai_updated_at" timestamp with time zone,
  "ai_proposal" jsonb
);
CREATE TABLE IF NOT EXISTS public.crm_signup_visits (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY,
  "page_id" uuid NOT NULL,
  "day" date DEFAULT CURRENT_DATE,
  "visitor_hash" text NOT NULL,
  "src" text,
  "at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.crm_sms_settings (
  "scope_key" text NOT NULL,
  "sender_name" text,
  "quiet_from" smallint DEFAULT 20,
  "quiet_to" smallint DEFAULT 8,
  "no_sunday" boolean DEFAULT true,
  "weekly_cap" smallint DEFAULT 1,
  "test_phone" text,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.crm_subscriptions (
  "scope_key" text NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "plan" text DEFAULT 'base'::text,
  "status" text DEFAULT 'none'::text,
  "billing_interval" text,
  "founder" boolean DEFAULT false,
  "founder_until" timestamp with time zone,
  "trial_ends_at" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "granted_by" uuid,
  "last_event_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "trial_extensions_used" integer DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.crm_yunit_lots (
  "id" uuid DEFAULT gen_random_uuid(),
  "scope_key" text NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "kind" text NOT NULL,
  "amount" integer NOT NULL,
  "remaining" integer NOT NULL,
  "expires_at" timestamp with time zone,
  "source_ref" text,
  "label" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.customer_loyalty (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_customer_id" uuid NOT NULL,
  "venue_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "total_points_earned" integer DEFAULT 0,
  "total_points_spent" integer DEFAULT 0,
  "current_balance" integer DEFAULT 0,
  "tier" text DEFAULT 'bronze'::text,
  "last_points_earned_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.discovery_selections (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "notification_key" text DEFAULT 'taste_discovery'::text,
  "event_ids" uuid[] DEFAULT '{}'::uuid[],
  "affiliate_event_ids" uuid[] DEFAULT '{}'::uuid[],
  "city" text,
  "genres" text[] DEFAULT '{}'::text[],
  "created_at" timestamp with time zone DEFAULT now(),
  "opened_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.dj_team_members (
  "id" uuid DEFAULT gen_random_uuid(),
  "dj_user_id" uuid NOT NULL,
  "member_user_id" uuid NOT NULL,
  "role" text DEFAULT 'manager'::text,
  "status" text DEFAULT 'active'::text,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.djs_public (
  "id" uuid,
  "venue_id" text,
  "first_name" text,
  "last_name" text,
  "stage_name" text,
  "instagram_url" text,
  "tiktok_url" text,
  "music_genres" text[],
  "bio" text,
  "description" text,
  "profile_image_url" text,
  "cover_image_url" text,
  "soundcloud_url" text,
  "spotify_url" text,
  "youtube_url" text,
  "country" text,
  "city" text,
  "is_verified" boolean,
  "is_active" boolean,
  "slug" text,
  "handle" text,
  "search_stage_name" text,
  "search_first_name" text,
  "search_last_name" text
);
CREATE TABLE IF NOT EXISTS public.email_automation_sends (
  "id" uuid DEFAULT gen_random_uuid(),
  "automation_id" uuid NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "kind" text NOT NULL,
  "trigger_key" text NOT NULL,
  "trigger_event_id" uuid,
  "bind_event_id" uuid,
  "email" text NOT NULL,
  "campaign_id" uuid,
  "status" text NOT NULL,
  "skip_reason" text,
  "due_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.email_automations (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "organizer_user_id" uuid,
  "kind" text NOT NULL,
  "enabled" boolean DEFAULT false,
  "enabled_at" timestamp with time zone,
  "delay_hours" integer DEFAULT 24,
  "template_id" uuid,
  "subject" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "threshold_pct" integer DEFAULT 85,
  "sms_enabled" boolean DEFAULT false,
  "sms_body" text,
  "sms_delay_days" integer DEFAULT 5
);
CREATE TABLE IF NOT EXISTS public.email_campaign_events (
  "id" uuid DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL,
  "recipient_email" text NOT NULL,
  "event_type" text NOT NULL,
  "resend_email_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "svix_id" text
);
CREATE TABLE IF NOT EXISTS public.email_campaign_followups (
  "id" uuid DEFAULT gen_random_uuid(),
  "parent_campaign_id" uuid NOT NULL,
  "followup_campaign_id" uuid,
  "event_id" uuid NOT NULL,
  "email" text NOT NULL,
  "clicked_at" timestamp with time zone NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "skip_reason" text,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
  "id" uuid DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL,
  "email" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "user_id" uuid,
  "unsubscribe_token" uuid,
  "status" text DEFAULT 'pending'::text,
  "resend_email_id" text,
  "error_message" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "attempts" integer DEFAULT 0,
  "claimed_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone,
  "ab_variant" text
);
CREATE TABLE IF NOT EXISTS public.email_campaign_templates (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "organizer_user_id" uuid,
  "name" text NOT NULL,
  "description" text DEFAULT ''::text,
  "type" text DEFAULT 'promotional'::text,
  "subject" text DEFAULT ''::text,
  "preheader" text DEFAULT ''::text,
  "blocks_json" jsonb DEFAULT '[]'::jsonb,
  "blocks_version" integer DEFAULT 2,
  "theme_json" jsonb DEFAULT '{}'::jsonb,
  "social_links_json" jsonb DEFAULT '{}'::jsonb,
  "logo_url" text,
  "use_count" integer DEFAULT 0,
  "last_used_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "name" text NOT NULL,
  "type" text,
  "subject" text NOT NULL,
  "status" text DEFAULT 'draft'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "scheduled_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "preheader" text,
  "blocks_json" jsonb DEFAULT '[]'::jsonb,
  "html_body" text,
  "audience_type" text DEFAULT 'all_subscribers'::text,
  "event_id" uuid,
  "organizer_user_id" uuid,
  "recipients_count" integer DEFAULT 0,
  "opens_count" integer DEFAULT 0,
  "clicks_count" integer DEFAULT 0,
  "unsubscribes_count" integer DEFAULT 0,
  "error_message" text,
  "theme_json" jsonb DEFAULT '{}'::jsonb,
  "social_links_json" jsonb DEFAULT '{}'::jsonb,
  "logo_url" text,
  "created_by" uuid,
  "segment_id" uuid,
  "total_recipients" integer DEFAULT 0,
  "delivered_count" integer DEFAULT 0,
  "bounced_count" integer DEFAULT 0,
  "complained_count" integer DEFAULT 0,
  "failed_count" integer DEFAULT 0,
  "suppressed_count" integer DEFAULT 0,
  "paused_reason" text,
  "send_started_at" timestamp with time zone,
  "last_slice_at" timestamp with time zone,
  "blocks_version" integer DEFAULT 1,
  "subject_b" text,
  "ab_enabled" boolean DEFAULT false,
  "ab_split_pct" integer DEFAULT 20,
  "ab_window_minutes" integer DEFAULT 240,
  "ab_winner" text,
  "audiences_json" jsonb DEFAULT '[]'::jsonb,
  "exclusions_json" jsonb DEFAULT '{}'::jsonb,
  "throttle_per_hour" integer,
  "quiet_hours" boolean DEFAULT false,
  "throttle_window_minutes" integer DEFAULT 60,
  "throttle_plan" jsonb,
  "followup_enabled" boolean DEFAULT false,
  "followup_delay_hours" integer DEFAULT 24,
  "followup_template_id" uuid,
  "followup_campaign_id" uuid,
  "parent_campaign_id" uuid,
  "clickers_count" integer DEFAULT 0,
  "child_kind" text,
  "automation_id" uuid,
  "automation_trigger_event_id" uuid,
  "resend_enabled" boolean DEFAULT false,
  "resend_delay_hours" integer DEFAULT 48,
  "resend_subject" text,
  "resend_campaign_id" uuid,
  "resend_done_at" timestamp with time zone,
  "policy_skipped_count" integer DEFAULT 0,
  "sent_via_support" boolean DEFAULT false,
  "template_kind" text,
  "product" text,
  "language" text,
  "ai_author" text,
  "mcp_grant_id" uuid,
  "ai_updated_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.email_list_imports (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "organizer_user_id" uuid,
  "filename" text,
  "consent_source" text NOT NULL,
  "consent_details" text,
  "collected_since" date,
  "attested_by" uuid,
  "attested_at" timestamp with time zone DEFAULT now(),
  "submitted_count" integer DEFAULT 0,
  "inserted_count" integer DEFAULT 0,
  "reactivated_count" integer DEFAULT 0,
  "duplicate_count" integer DEFAULT 0,
  "invalid_count" integer DEFAULT 0,
  "suppressed_count" integer DEFAULT 0,
  "unchanged_count" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "list_name" text,
  "attested_via_support" boolean DEFAULT false,
  "fingerprint" text,
  "superseded_by" uuid,
  "superseded_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.email_opt_outs (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "organizer_user_id" uuid,
  "email" text NOT NULL,
  "reason" text NOT NULL,
  "import_id" uuid,
  "opted_out_at" timestamp with time zone,
  "purged_at" timestamp with time zone DEFAULT now(),
  "purged_by" uuid
);
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  "id" uuid DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "reason" text NOT NULL,
  "source" text,
  "scope_venue_id" text,
  "scope_organizer_user_id" uuid,
  "campaign_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.event_cohosts (
  "id" uuid DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL,
  "organizer_user_id" uuid,
  "venue_id" text,
  "access" text DEFAULT 'editor'::text,
  "share_crm" boolean DEFAULT true,
  "status" text DEFAULT 'pending'::text,
  "message" text,
  "invited_by" uuid,
  "invited_by_party" text,
  "invited_at" timestamp with time zone DEFAULT now(),
  "responded_at" timestamp with time zone,
  "responded_by" uuid,
  "ended_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "role" text DEFAULT 'cohost'::text,
  "principal_terms" jsonb
);
CREATE TABLE IF NOT EXISTS public.event_coorg_deals (
  "event_id" uuid NOT NULL,
  "shares" jsonb DEFAULT '{}'::jsonb,
  "formal" boolean DEFAULT false,
  "clauses" text,
  "terms_version" text DEFAULT '2026-09-28'::text,
  "version" integer DEFAULT 1,
  "signatures" jsonb DEFAULT '{}'::jsonb,
  "status" text DEFAULT 'pending'::text,
  "activated_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "payment_terms_days" integer DEFAULT 15,
  "stripe_split" boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.event_djs (
  "id" uuid DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL,
  "dj_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.event_funnel_events (
  "id" bigint NOT NULL,
  "session_id" text NOT NULL,
  "event_id" uuid NOT NULL,
  "step" text NOT NULL,
  "pillar" text,
  "ref_id" text,
  "quantity" integer,
  "amount_cents" integer,
  "reason" text,
  "device" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "source" text
);
CREATE TABLE IF NOT EXISTS public.event_guest_artists (
  "id" uuid DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL,
  "name" text NOT NULL,
  "photo_url" text,
  "instagram_url" text,
  "instagram_handle" text,
  "position" integer DEFAULT 0,
  "instagram_clicks" integer DEFAULT 0,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.event_waitlist (
  "id" uuid DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL,
  "email" text NOT NULL,
  "full_name" text,
  "user_id" uuid,
  "presale_access" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "show_in_orders" boolean DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.events (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "title" text NOT NULL,
  "start_at" timestamp with time zone NOT NULL,
  "end_at" timestamp with time zone NOT NULL,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "description" text,
  "image_url" text,
  "ticketing_enabled" boolean DEFAULT false,
  "max_tickets" integer,
  "tables_enabled" boolean DEFAULT false,
  "poster_url" text,
  "poster_position" jsonb,
  "banner_position" jsonb,
  "music_genre" text DEFAULT 'Open Format'::text,
  "event_type" text DEFAULT 'club'::text,
  "ticket_selling_mode" text DEFAULT 'rounds'::text,
  "presale_start_at" timestamp with time zone,
  "public_sale_start_at" timestamp with time zone,
  "waitlist_enabled" boolean DEFAULT false,
  "music_genres" text[] DEFAULT ARRAY['Open Format'::text],
  "organizer_user_id" uuid,
  "event_kind" event_kind DEFAULT 'club_event'::event_kind,
  "visibility" event_visibility DEFAULT 'public'::event_visibility,
  "is_discoverable" boolean DEFAULT true,
  "discovery_status" discovery_status DEFAULT 'approved'::discovery_status,
  "location_name" text,
  "location_address" text,
  "location_city" text,
  "access_code" text,
  "requires_access_code" boolean DEFAULT false,
  "event_mode" event_mode,
  "partner_venue_id" text,
  "partner_organizer_id" uuid,
  "revenue_split_rules" jsonb,
  "revenue_split_proposal" jsonb,
  "split_proposed_by" uuid,
  "split_proposed_at" timestamp with time zone,
  "split_approved_by_venue" boolean DEFAULT false,
  "split_approved_by_organizer" boolean DEFAULT false,
  "split_locked_at" timestamp with time zone,
  "tables_mode" text,
  "tables_owner_user_id" uuid,
  "location_is_secret" boolean DEFAULT false,
  "rounds_visibility" text DEFAULT 'sequential'::text,
  "recurring_template_id" uuid,
  "minors_disabled" boolean DEFAULT false,
  "alcohol_free" boolean DEFAULT false,
  "max_tickets_per_person" integer,
  "sale_password_enabled" boolean DEFAULT false,
  "hide_yuno_navigation" boolean DEFAULT false,
  "status" text DEFAULT 'active'::text,
  "cancelled_at" timestamp with time zone,
  "cancellation_reason" text,
  "reveal_address_in_email" boolean DEFAULT true,
  "collab_paused_at" timestamp with time zone,
  "collab_goal_type" text,
  "collab_goal_value" numeric,
  "is_bde" boolean DEFAULT false,
  "tables_locked_to_venue" boolean DEFAULT false,
  "slug" text,
  "search_title" text,
  "collab_responsibilities" jsonb,
  "timezone" text,
  "location_logo_url" text,
  "published_at" timestamp with time zone,
  "video_url" text,
  "tickets_sold_out" boolean DEFAULT false,
  "tables_sold_out" boolean DEFAULT false,
  "guest_list_sold_out" boolean DEFAULT false,
  "sold_out_pack_ids" uuid[] DEFAULT '{}'::uuid[],
  "entry_target" integer,
  "money_agreement" text,
  "partner_visibility" text DEFAULT 'full'::text,
  "vip_room_id" uuid,
  "external_source" text,
  "external_ticket_url" text
);
CREATE TABLE IF NOT EXISTS public.external_events (
  "id" uuid DEFAULT gen_random_uuid(),
  "connection_id" uuid NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "provider" text NOT NULL,
  "external_id" text NOT NULL,
  "name" text,
  "slug" text,
  "url" text,
  "start_at" timestamp with time zone,
  "end_at" timestamp with time zone,
  "timezone" text,
  "description" text,
  "cover_url" text,
  "street" text,
  "city" text,
  "zip_code" text,
  "country_code" text,
  "latitude" double precision,
  "longitude" double precision,
  "address_visibility" text,
  "genres" text[] DEFAULT '{}'::text[],
  "artists" jsonb DEFAULT '[]'::jsonb,
  "deals" jsonb DEFAULT '[]'::jsonb,
  "left_tickets" integer,
  "published_at" timestamp with time zone,
  "launched_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "external_role" text,
  "type_of_place" text,
  "event_id" uuid,
  "raw" jsonb,
  "first_seen_at" timestamp with time zone DEFAULT now(),
  "synced_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.external_tickets (
  "id" uuid DEFAULT gen_random_uuid(),
  "connection_id" uuid NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "provider" text NOT NULL,
  "external_id" text NOT NULL,
  "external_order_id" text,
  "external_event_id" text,
  "deal_id" text,
  "deal_name" text,
  "status" text DEFAULT 'valid'::text,
  "raw_status" text,
  "quantity" integer DEFAULT 1,
  "price" numeric(12,2),
  "fees" numeric(12,2),
  "currency" text,
  "buyer_email" text,
  "buyer_first_name" text,
  "buyer_last_name" text,
  "buyer_phone" text,
  "buyer_ref" text,
  "holder_email" text,
  "holder_first_name" text,
  "holder_last_name" text,
  "newsletter_optin" boolean,
  "age" integer,
  "gender" text,
  "city" text,
  "zip_code" text,
  "country_code" text,
  "purchased_at" timestamp with time zone,
  "scanned_at" timestamp with time zone,
  "refunded_at" timestamp with time zone,
  "source_updated_at" timestamp with time zone,
  "utm" jsonb,
  "raw" jsonb,
  "first_seen_at" timestamp with time zone DEFAULT now(),
  "synced_at" timestamp with time zone DEFAULT now(),
  "event_id" uuid
);
CREATE TABLE IF NOT EXISTS public.favorites (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "favorite_type" text NOT NULL,
  "venue_id" text,
  "event_id" uuid,
  "drink_id" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "dj_id" uuid,
  "affiliate_event_id" uuid,
  "affiliate_venue_id" uuid,
  "notify_all_locations" boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.guest_list_entries (
  "id" uuid DEFAULT gen_random_uuid(),
  "guest_list_id" uuid NOT NULL,
  "user_id" uuid,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text NOT NULL,
  "gender" text,
  "qr_code" text NOT NULL,
  "status" text DEFAULT 'reserved'::text,
  "entry_scanned" boolean DEFAULT false,
  "entry_scanned_at" timestamp with time zone,
  "entry_scanned_by" uuid,
  "promoter_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "entry_type" text DEFAULT 'normal'::text,
  "reservation_code" text,
  "entry_deadline" time without time zone,
  "invite_id" uuid,
  "tracked_link_id" uuid,
  "newsletter_opt_in" boolean DEFAULT false,
  "sms_opt_in" boolean DEFAULT false,
  "platform_opt_in" boolean DEFAULT false,
  "attribution_source" text,
  "attribution_ref" text
);
CREATE TABLE IF NOT EXISTS public.guest_lists (
  "id" uuid DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL,
  "venue_id" text,
  "quota" integer DEFAULT 100,
  "quota_female" integer,
  "quota_male" integer,
  "free_before_time" time without time zone DEFAULT '02:00:00'::time without time zone,
  "includes_drink" boolean DEFAULT false,
  "visible_on_club_page" boolean DEFAULT false,
  "is_active" boolean DEFAULT true,
  "share_token" text DEFAULT encode(gen_random_bytes(16), 'hex'::text),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "entry_deadline" time without time zone,
  "organizer_user_id" uuid,
  "dj_id" uuid,
  "holder_type" text DEFAULT 'club'::text,
  "holder_label" text,
  "promoter_id" uuid,
  "entry_kind" text DEFAULT 'normal'::text,
  "quota_normal" integer DEFAULT 0,
  "quota_drink" integer DEFAULT 0,
  "quota_table" integer DEFAULT 0,
  "show_remaining" boolean DEFAULT true,
  "public_entry_types" text[],
  "agency_id" uuid,
  "agency_distribution_mode" text,
  "manually_sold_out" boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.imported_contacts (
  "id" uuid DEFAULT gen_random_uuid(),
  "list_import_id" uuid NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "email" text,
  "phone_e164" text,
  "first_name" text,
  "last_name" text,
  "country_code" text,
  "country" text,
  "region" text,
  "city" text,
  "postal_code" text,
  "zone" text,
  "age" integer,
  "gender" text,
  "newsletter_opt_in" boolean,
  "added_at" timestamp with time zone,
  "last_purchase_at" timestamp with time zone,
  "total_spent" numeric(12,2),
  "event_count" integer,
  "extra" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.live_visitor_pings (
  "id" uuid DEFAULT gen_random_uuid(),
  "session_id" text NOT NULL,
  "venue_id" text,
  "event_id" uuid,
  "organizer_user_id" uuid,
  "page_path" text,
  "stage" text DEFAULT 'browsing'::text,
  "cart_value_cents" integer DEFAULT 0,
  "user_id" uuid,
  "last_seen" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.manager_permissions (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "can_manage_events" boolean DEFAULT false,
  "can_manage_menu" boolean DEFAULT false,
  "can_manage_staff" boolean DEFAULT false,
  "can_manage_promoters" boolean DEFAULT false,
  "can_manage_djs" boolean DEFAULT false,
  "can_manage_tables" boolean DEFAULT false,
  "can_manage_tickets" boolean DEFAULT false,
  "can_view_analytics" boolean DEFAULT false,
  "can_view_orders" boolean DEFAULT false,
  "can_view_finance" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "can_view_customers" boolean DEFAULT false,
  "can_manage_loyalty" boolean DEFAULT false,
  "can_manage_upsell" boolean DEFAULT false,
  "can_manage_guest_list" boolean DEFAULT false,
  "can_manage_invoices" boolean DEFAULT false,
  "can_manage_venue" boolean DEFAULT false,
  "can_manage_refunds" boolean DEFAULT false,
  "can_manage_crm" boolean DEFAULT false,
  "can_view_hype" boolean DEFAULT false,
  "can_manage_scarcity" boolean DEFAULT false,
  "can_manage_organizations" boolean DEFAULT false,
  "can_view_live" boolean DEFAULT false,
  "can_manage_vip_service" boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.marketing_consent_events (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "email" text,
  "phone_e164" text,
  "channel" text NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "action" text NOT NULL,
  "wording_key" text,
  "wording_text" text NOT NULL,
  "locale" text,
  "source" text DEFAULT 'checkout'::text,
  "occurred_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.marketing_email_log (
  "id" uuid DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "kind" text NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "sent_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mcp_email_images (
  "id" uuid DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "grant_id" uuid,
  "user_id" uuid NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "name" text,
  "source" text DEFAULT 'upload'::text,
  "status" text DEFAULT 'waiting'::text,
  "storage_name" text,
  "url" text,
  "mime" text,
  "bytes" integer,
  "width" integer,
  "height" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "ready_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.mcp_grants (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "client_id" text NOT NULL,
  "client_name" text NOT NULL,
  "spaces" text[] NOT NULL,
  "level" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "last_used_at" timestamp with time zone,
  "calls_count" integer DEFAULT 0,
  "revoked_at" timestamp with time zone,
  "revoked_by" uuid,
  "revoked_reason" text,
  "can_draft" boolean DEFAULT false,
  "can_pages" boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  "token_hash" text NOT NULL,
  "kind" text NOT NULL,
  "grant_id" uuid NOT NULL,
  "client_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.mcp_tool_calls (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY,
  "grant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "tool" text NOT NULL,
  "space_key" text,
  "args" jsonb,
  "status" text DEFAULT 'ok'::text,
  "error" text,
  "duration_ms" integer,
  "result_bytes" integer,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.newsletter_subscriptions (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "venue_id" text,
  "organizer_user_id" uuid,
  "email" text NOT NULL,
  "opted_in" boolean DEFAULT true,
  "unsubscribe_token" uuid DEFAULT gen_random_uuid(),
  "opted_out_at" timestamp with time zone,
  "source" text DEFAULT 'manual'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "import_id" uuid,
  "consent_source" text,
  "consent_recorded_at" timestamp with time zone,
  "first_name" text,
  "last_name" text
);
CREATE TABLE IF NOT EXISTS public.orders (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "user_email" text,
  "venue_id" text NOT NULL,
  "items" jsonb NOT NULL,
  "total" numeric(10,2) NOT NULL,
  "status" text NOT NULL,
  "token" text,
  "token_used" boolean DEFAULT false,
  "token_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "paid_at" timestamp with time zone,
  "served_at" timestamp with time zone,
  "event_id" uuid,
  "prep_requested" boolean DEFAULT false,
  "prep_status" text DEFAULT 'queue'::text,
  "prep_claimed_by" uuid,
  "prep_claimed_at" timestamp with time zone,
  "ready_at" timestamp with time zone,
  "notify_status" text DEFAULT 'none'::text,
  "archived" boolean DEFAULT false,
  "refund_reason" text,
  "refunded_by" uuid,
  "post_visit_notified" boolean DEFAULT false,
  "selected_bar" text,
  "assigned_bar" text,
  "stripe_session_id" text,
  "stripe_payment_intent_id" text,
  "refunded_at" timestamp with time zone,
  "service_fee" numeric DEFAULT 0,
  "order_number" text,
  "guest_first_name" text,
  "guest_last_name" text,
  "guest_phone" text,
  "is_guest" boolean DEFAULT false,
  "claimed_at" timestamp with time zone,
  "claimed_by_user_id" uuid,
  "refund_amount" numeric,
  "tracked_link_id" uuid,
  "stripe_connected_account_id" text,
  "fee_absorbed" boolean DEFAULT false,
  "age_declared_at" timestamp with time zone,
  "age_declaration_birth_date" date,
  "age_declaration_ip" text,
  "purchase_source" text,
  "served_by" uuid,
  "attribution_source" text,
  "attribution_ref" text
);
CREATE TABLE IF NOT EXISTS public.org_members (
  "id" uuid DEFAULT gen_random_uuid(),
  "organizer_user_id" uuid NOT NULL,
  "member_user_id" uuid,
  "member_email" text NOT NULL,
  "role" text DEFAULT 'editor'::text,
  "invited_by" uuid NOT NULL,
  "invitation_token" uuid DEFAULT gen_random_uuid(),
  "invitation_status" text DEFAULT 'pending'::text,
  "expires_at" timestamp with time zone DEFAULT (now() + '14 days'::interval),
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "can_view_finance" boolean DEFAULT false,
  "can_refund" boolean DEFAULT false,
  "can_export" boolean DEFAULT false,
  "can_manage_team" boolean DEFAULT false,
  "scanner_pin_hash" text,
  "scanner_pin_set_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.organizer_profile_followers (
  "id" uuid DEFAULT gen_random_uuid(),
  "organizer_user_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.organizer_profiles (
  "user_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "slug" text,
  "bio" text,
  "avatar_url" text,
  "cover_url" text,
  "instagram_url" text,
  "website_url" text,
  "is_public" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "legal_name" text,
  "legal_address" text,
  "siret" text,
  "vat_number" text,
  "billing_email" text,
  "minors_allowed" boolean DEFAULT false,
  "minor_auth_doc_url" text,
  "minor_auth_doc_name" text,
  "city" text,
  "absorb_yuno_fees" boolean DEFAULT false,
  "can_sell_alcohol" boolean DEFAULT false,
  "can_sell_alcohol_confirmed_at" timestamp with time zone,
  "bde_verified" boolean DEFAULT false,
  "bde_verified_at" timestamp with time zone,
  "search_display_name" text,
  "name_changed_at" timestamp with time zone,
  "is_showcase_shadow" boolean DEFAULT false,
  "home_banner" jsonb,
  "rna_number" text,
  "vat_regime" text,
  "cloakroom_price" numeric(8,2),
  "product" text DEFAULT 'suite'::text,
  "extra_products" text[] DEFAULT '{}'::text[]
);
CREATE TABLE IF NOT EXISTS public.platform_notification_settings (
  "notification_key" text NOT NULL,
  "enabled" boolean DEFAULT true,
  "category" text DEFAULT 'transactional'::text,
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" uuid,
  "params" jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.profiles (
  "id" uuid NOT NULL,
  "email" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "first_name" text,
  "last_name" text,
  "venue_id" text,
  "employee_pin" text,
  "is_click_collect_manager" boolean DEFAULT false,
  "push_token" text,
  "mfa_enabled" boolean DEFAULT false,
  "mfa_enforced" boolean DEFAULT false,
  "mfa_verified_at" timestamp with time zone,
  "mfa_recovery_codes" text[],
  "birth_date" date,
  "age_verified_at" timestamp with time zone,
  "phone" text,
  "avatar_url" text,
  "city" text,
  "party_persona" text,
  "preferred_language" text,
  "background_url" text,
  "profile_type" profile_type DEFAULT 'club'::profile_type,
  "organization_name" text,
  "organization_logo_url" text,
  "onboarding_completed" boolean DEFAULT false,
  "stripe_connect_account_id" text,
  "stripe_connect_status" text DEFAULT 'none'::text,
  "stripe_connect_charges_enabled" boolean DEFAULT false,
  "stripe_connect_payouts_enabled" boolean DEFAULT false,
  "stripe_connect_onboarded_at" timestamp with time zone,
  "invoice_prefix" text,
  "phone_sms_opt_in" boolean DEFAULT false,
  "is_suspended" boolean DEFAULT false,
  "suspended_at" timestamp with time zone,
  "suspended_by" uuid,
  "suspension_reason" text,
  "gender" text,
  "personalization_opt_out" boolean DEFAULT false,
  "staff_display_name" text,
  "staff_title" text,
  "staff_emoji" text,
  "staff_accent" text,
  "staff_avatar_url" text,
  "staff_since" date,
  "staff_onboarded_at" timestamp with time zone,
  "discovery_opt_out" boolean DEFAULT false,
  "mfa_exempt" boolean DEFAULT false,
  "notification_prefs" jsonb DEFAULT '{}'::jsonb,
  "mfa_deferred_until" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.promoter_conversions (
  "id" uuid DEFAULT gen_random_uuid(),
  "promoter_id" uuid NOT NULL,
  "order_id" uuid,
  "ticket_id" uuid,
  "table_reservation_id" uuid,
  "conversion_type" text NOT NULL,
  "amount" numeric DEFAULT 0,
  "commission" numeric DEFAULT 0,
  "status" text DEFAULT 'pending'::text,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "event_id" uuid,
  "guest_list_entry_id" uuid,
  "parent_conversion_id" uuid,
  "override_amount" numeric DEFAULT 0,
  "discount_amount" numeric DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.promoters (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "venue_id" text,
  "promo_code" text NOT NULL,
  "instagram_url" text,
  "whatsapp_number" text,
  "iban" text,
  "bic" text,
  "ticket_commission_type" text DEFAULT 'percentage'::text,
  "ticket_commission_value" numeric DEFAULT 0,
  "table_commission_type" text DEFAULT 'percentage'::text,
  "table_commission_value" numeric DEFAULT 0,
  "pending_amount" numeric DEFAULT 0,
  "total_paid" numeric DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "customer_discount_type" text DEFAULT 'percentage'::text,
  "customer_discount_value" numeric DEFAULT 0,
  "profile_image_url" text,
  "first_name" text,
  "last_name" text,
  "phone" text,
  "reward_type" text DEFAULT 'money'::text,
  "reward_config" jsonb DEFAULT '{}'::jsonb,
  "min_condition_type" text,
  "min_condition_value" integer DEFAULT 0,
  "condition_met" boolean DEFAULT false,
  "default_commission_template_id" uuid,
  "team_id" uuid,
  "can_scan_entries" boolean DEFAULT false,
  "guest_list_template_id" uuid,
  "client_discount_template_id" uuid,
  "organizer_user_id" uuid,
  "drink_discount_type" text DEFAULT 'percentage'::text,
  "drink_discount_value" numeric DEFAULT 0,
  "table_discount_type" text DEFAULT 'percentage'::text,
  "table_discount_value" numeric DEFAULT 0,
  "ticket_discount_type" text DEFAULT 'percentage'::text,
  "ticket_discount_value" numeric DEFAULT 0,
  "agency_id" uuid,
  "agency_group_id" uuid,
  "agency_can_sell_tickets" boolean DEFAULT true,
  "agency_can_sell_tables" boolean DEFAULT true,
  "agency_ticket_cap" integer,
  "agency_table_cap" integer,
  "agency_rule_template_id" uuid,
  "agency_guestlist_quota" integer,
  "auto_assign_events" boolean DEFAULT false,
  "iban_changed_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.push_campaign_events (
  "id" uuid DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "platform" text,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.push_campaigns (
  "id" uuid DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "body" text NOT NULL,
  "url" text DEFAULT '/'::text,
  "segment" text DEFAULT 'all'::text,
  "sent_count" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "created_by" uuid,
  "venue_id" text,
  "event_id" uuid,
  "audience" jsonb DEFAULT '{}'::jsonb,
  "status" text DEFAULT 'sent'::text,
  "scheduled_at" timestamp with time zone,
  "template_key" text,
  "targeted_count" integer DEFAULT 0,
  "failed_count" integer DEFAULT 0,
  "source" text DEFAULT 'manual'::text,
  "title_i18n" jsonb,
  "body_i18n" jsonb,
  "agency_id" uuid,
  "organizer_user_id" uuid
);
CREATE TABLE IF NOT EXISTS public.push_candidates (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY,
  "dedup_key" text NOT NULL,
  "user_id" uuid NOT NULL,
  "rule_key" text NOT NULL,
  "variant" text DEFAULT 'default'::text,
  "family" text NOT NULL,
  "event_id" uuid,
  "reason" text NOT NULL,
  "reason_party" text,
  "score" numeric DEFAULT 0,
  "vars" jsonb DEFAULT '{}'::jsonb,
  "not_before" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'pending'::text,
  "hold_reason" text,
  "attempts" integer DEFAULT 0,
  "claimed_at" timestamp with time zone,
  "decided_at" timestamp with time zone,
  "campaign_id" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.push_event_settings (
  "event_id" uuid NOT NULL,
  "announce_at" timestamp with time zone,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text,
  "auth" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "platform" text DEFAULT 'web'::text
);
CREATE TABLE IF NOT EXISTS public.sms_campaign_recipients (
  "id" uuid DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL,
  "contact_id" uuid,
  "user_id" uuid,
  "phone_e164" text NOT NULL,
  "full_name" text,
  "lang" text,
  "status" text DEFAULT 'pending'::text,
  "attempts" integer DEFAULT 0,
  "claimed_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone,
  "provider_message_id" text,
  "sms_log_id" uuid,
  "credits" integer DEFAULT 0,
  "error_code" text,
  "error_message" text,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "provider_request_id" text,
  "first_name" text
);
CREATE TABLE IF NOT EXISTS public.sms_campaigns (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "organizer_id" uuid,
  "created_by" uuid NOT NULL,
  "name" text NOT NULL,
  "body_template" text NOT NULL,
  "segment_filters" jsonb DEFAULT '{}'::jsonb,
  "estimated_recipients" integer DEFAULT 0,
  "estimated_credits" integer DEFAULT 0,
  "scheduled_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "sent_count" integer DEFAULT 0,
  "delivered_count" integer DEFAULT 0,
  "failed_count" integer DEFAULT 0,
  "status" sms_campaign_status DEFAULT 'draft'::sms_campaign_status,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "body_i18n" jsonb,
  "event_id" uuid,
  "sender_name" text,
  "quiet_hours" boolean DEFAULT true,
  "total_recipients" integer DEFAULT 0,
  "undelivered_count" integer DEFAULT 0,
  "credits_consumed" integer DEFAULT 0,
  "credits_refunded" integer DEFAULT 0,
  "segments_per_message" integer DEFAULT 1,
  "tracked_link_id" uuid,
  "paused_reason" text,
  "error_message" text,
  "send_started_at" timestamp with time zone,
  "last_slice_at" timestamp with time zone,
  "test_sent_at" timestamp with time zone,
  "sender_id" text
);
CREATE TABLE IF NOT EXISTS public.sms_stop_list (
  "phone_e164" text NOT NULL,
  "source" text DEFAULT 'stop'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "scope_key" text,
  "campaign_id" uuid,
  "provider_message_id" text
);
CREATE TABLE IF NOT EXISTS public.table_packs (
  "id" uuid DEFAULT gen_random_uuid(),
  "zone_id" uuid NOT NULL,
  "venue_id" text,
  "name" text NOT NULL,
  "description" text,
  "base_price" numeric NOT NULL,
  "base_capacity" integer DEFAULT 6,
  "extra_person_price" numeric DEFAULT 0,
  "max_extra_persons" integer DEFAULT 0,
  "deposit" numeric DEFAULT 0,
  "included_items" text,
  "position" integer DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deposit_type" text DEFAULT 'fixed'::text,
  "tables_count" integer DEFAULT 1,
  "included_bottles_quota" integer DEFAULT 0,
  "minimum_spend" numeric DEFAULT 0,
  "event_id" uuid,
  "created_by_user_id" uuid,
  "arrival_deadline" text,
  "payment_mode" text DEFAULT 'online'::text,
  "limit_tables" boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.table_reservations (
  "id" uuid DEFAULT gen_random_uuid(),
  "table_id" uuid,
  "event_id" uuid NOT NULL,
  "user_id" uuid,
  "user_email" text NOT NULL,
  "total_price" numeric NOT NULL,
  "service_fee" numeric DEFAULT 0,
  "status" text DEFAULT 'pending'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "paid_at" timestamp with time zone,
  "pack_id" uuid,
  "zone_id" uuid,
  "guest_count" integer DEFAULT 1,
  "deposit" numeric DEFAULT 0,
  "full_name" text,
  "phone" text,
  "remarks" text,
  "newsletter_opt_in" boolean DEFAULT false,
  "management_fee" numeric DEFAULT 0,
  "qr_code" text,
  "entry_scanned" boolean DEFAULT false,
  "entry_scanned_at" timestamp with time zone,
  "entry_scanned_by" uuid,
  "refund_reason" text,
  "refunded_by" uuid,
  "refund_amount" numeric(10,2),
  "vip_status" text DEFAULT 'waiting'::text,
  "placed_at" timestamp with time zone,
  "placed_by" uuid,
  "assigned_table_id" uuid,
  "finished_at" timestamp with time zone,
  "minimum_spend" numeric DEFAULT 0,
  "checked_in_at" timestamp with time zone,
  "stripe_session_id" text,
  "stripe_payment_intent_id" text,
  "refunded_at" timestamp with time zone,
  "requested_table_id" uuid,
  "placement_status" text DEFAULT 'none'::text,
  "placement_reviewed_by" uuid,
  "placement_reviewed_at" timestamp with time zone,
  "placement_note" text,
  "is_guest" boolean DEFAULT false,
  "claimed_at" timestamp with time zone,
  "claimed_by_user_id" uuid,
  "guest_first_name" text,
  "guest_last_name" text,
  "guest_phone" text,
  "purchase_source" text,
  "sms_opt_in" boolean DEFAULT false,
  "tracked_link_id" uuid,
  "reference_code" text,
  "stripe_connected_account_id" text,
  "fee_absorbed" boolean DEFAULT false,
  "age_declared_at" timestamp with time zone,
  "age_declaration_birth_date" date,
  "age_declaration_ip" text,
  "payment_mode" text DEFAULT 'online'::text,
  "promo_code_id" uuid,
  "promo_discount" numeric(10,2),
  "collab_split" jsonb,
  "attribution_source" text,
  "attribution_ref" text
);
CREATE TABLE IF NOT EXISTS public.table_zones (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "name" text NOT NULL,
  "price" numeric,
  "color" text DEFAULT '#3b82f6'::text,
  "position" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "tables_count" integer DEFAULT 1,
  "last_tables_threshold" integer DEFAULT 20,
  "event_id" uuid,
  "created_by_user_id" uuid
);
CREATE TABLE IF NOT EXISTS public.ticket_attendees (
  "id" uuid DEFAULT gen_random_uuid(),
  "ticket_id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "email" text,
  "phone" text,
  "qr_code" text NOT NULL,
  "entry_scanned" boolean DEFAULT false,
  "entry_scanned_at" timestamp with time zone,
  "entry_scanned_by" uuid,
  "drink_redeemed" boolean DEFAULT false,
  "drink_redeemed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ticket_rounds (
  "id" uuid DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "price" numeric NOT NULL,
  "max_tickets" integer NOT NULL,
  "tickets_sold" integer DEFAULT 0,
  "position" integer DEFAULT 0,
  "is_active" boolean DEFAULT false,
  "auto_activate" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "last_tickets_threshold" integer DEFAULT 20,
  "includes_drink" boolean DEFAULT false,
  "drink_deadline_hours" integer DEFAULT 2,
  "allowed_drink_collections" text[] DEFAULT ARRAY['drink'::text, 'shot'::text],
  "drink_cutoff_time" time without time zone,
  "drink_deadline_type" text DEFAULT 'hours_after_start'::text,
  "ticket_type" text DEFAULT 'standard'::text,
  "entry_deadline" time without time zone,
  "is_group" boolean DEFAULT false,
  "group_size" integer,
  "group_label" text,
  "manually_sold_out" boolean DEFAULT false,
  "audience" text DEFAULT 'everyone'::text,
  "hidden" boolean DEFAULT false,
  "visible_from" timestamp with time zone,
  "sale_starts_at" timestamp with time zone,
  "sale_ends_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.ticketing_connections (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "organizer_user_id" uuid,
  "provider" text NOT NULL,
  "external_org_id" text NOT NULL,
  "external_org_name" text,
  "vault_secret_id" uuid,
  "token_hint" text,
  "status" text DEFAULT 'active'::text,
  "include_cohosted" boolean DEFAULT true,
  "tickets_cursor" text,
  "events_synced_at" timestamp with time zone,
  "initial_import_done_at" timestamp with time zone,
  "next_sync_at" timestamp with time zone DEFAULT now(),
  "sync_interval_minutes" integer DEFAULT 60,
  "locked_until" timestamp with time zone,
  "last_sync_started_at" timestamp with time zone,
  "last_ok_at" timestamp with time zone,
  "last_error_at" timestamp with time zone,
  "last_error" text,
  "fail_count" integer DEFAULT 0,
  "amount_divisor" numeric DEFAULT 1,
  "schema_sample" jsonb,
  "stats" jsonb DEFAULT '{}'::jsonb,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tickets (
  "id" uuid DEFAULT gen_random_uuid(),
  "ticket_round_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "user_id" uuid,
  "user_email" text NOT NULL,
  "quantity" integer DEFAULT 1,
  "unit_price" numeric NOT NULL,
  "total_price" numeric NOT NULL,
  "service_fee" numeric DEFAULT 0,
  "status" text DEFAULT 'pending'::text,
  "qr_code" text,
  "used" boolean DEFAULT false,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "paid_at" timestamp with time zone,
  "drink_redeemed" boolean DEFAULT false,
  "drink_redeemed_at" timestamp with time zone,
  "drink_id" text,
  "drink_name" text,
  "entry_scanned" boolean DEFAULT false,
  "entry_scanned_at" timestamp with time zone,
  "entry_scanned_by" uuid,
  "has_insurance" boolean DEFAULT false,
  "insurance_fee" numeric DEFAULT 0,
  "cancelled_at" timestamp with time zone,
  "refund_amount" numeric,
  "full_name" text,
  "phone" text,
  "newsletter_opt_in" boolean DEFAULT false,
  "refund_reason" text,
  "refunded_by" uuid,
  "is_loyalty_reward" boolean DEFAULT false,
  "ticket_type" text DEFAULT 'standard'::text,
  "stripe_session_id" text,
  "stripe_payment_intent_id" text,
  "refunded_at" timestamp with time zone,
  "upgraded_from_ticket_id" uuid,
  "is_upgrade" boolean DEFAULT false,
  "is_guest" boolean DEFAULT false,
  "claimed_at" timestamp with time zone,
  "claimed_by_user_id" uuid,
  "guest_first_name" text,
  "guest_last_name" text,
  "guest_phone" text,
  "purchase_source" text,
  "reservation_id" uuid,
  "sms_opt_in" boolean DEFAULT false,
  "minor_auth_doc_url" text,
  "tracked_link_id" uuid,
  "reference_code" text,
  "stripe_connected_account_id" text,
  "fee_absorbed" boolean DEFAULT false,
  "promo_code_id" uuid,
  "promo_discount" numeric(10,2),
  "collab_split" jsonb,
  "attribution_source" text,
  "attribution_ref" text
);
CREATE TABLE IF NOT EXISTS public.tracked_link_clicks (
  "id" uuid DEFAULT gen_random_uuid(),
  "tracked_link_id" uuid NOT NULL,
  "clicked_at" timestamp with time zone DEFAULT now(),
  "ip_hash" text,
  "user_agent" text,
  "referrer" text,
  "visitor_id" text,
  "device_type" text,
  "country" text
);
CREATE TABLE IF NOT EXISTS public.tracked_links (
  "id" uuid DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "label" text NOT NULL,
  "owner_kind" text NOT NULL,
  "venue_id" text,
  "organizer_user_id" uuid,
  "promoter_id" uuid,
  "created_by" uuid DEFAULT auth.uid(),
  "target_kind" text NOT NULL,
  "event_id" uuid,
  "target_venue_id" text,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "clicks_count" integer DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "dj_id" uuid,
  "guest_list_id" uuid,
  "archived_at" timestamp with time zone,
  "image_url" text
);
CREATE TABLE IF NOT EXISTS public.user_roles (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "role" app_role NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "email" text
);
CREATE TABLE IF NOT EXISTS public.user_taste_profiles (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "music_style" text NOT NULL,
  "drink_preference" text NOT NULL,
  "vibe_preference" text NOT NULL,
  "crowd_size" text NOT NULL,
  "night_type" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "genres" text[] DEFAULT '{}'::text[],
  "energy" text,
  "taste_embedding" text,
  "taste_content_hash" text,
  "frequency" text,
  "budget" text,
  "booking_pref" text
);
CREATE TABLE IF NOT EXISTS public.venue_customers (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "email" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "phone" text,
  "first_visit_at" timestamp with time zone DEFAULT now(),
  "last_visit_at" timestamp with time zone DEFAULT now(),
  "total_spent" numeric(10,2) DEFAULT 0,
  "ticket_count" integer DEFAULT 0,
  "order_count" integer DEFAULT 0,
  "table_count" integer DEFAULT 0,
  "is_banned" boolean DEFAULT false,
  "banned_at" timestamp with time zone,
  "banned_by" uuid,
  "ban_reason" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "favorite_drink_category" text,
  "average_spend" numeric DEFAULT 0,
  "customer_segment" text DEFAULT 'new'::text
);
CREATE TABLE IF NOT EXISTS public.venue_segments (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text NOT NULL,
  "name" text NOT NULL,
  "definition" jsonb DEFAULT '{"match": "all", "version": 1, "conditions": []}'::jsonb,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.venue_sms_contacts (
  "id" uuid DEFAULT gen_random_uuid(),
  "venue_id" text,
  "user_id" uuid,
  "phone_e164" text NOT NULL,
  "full_name" text NOT NULL,
  "email" text,
  "sms_consent_at" timestamp with time zone DEFAULT now(),
  "consent_source" text DEFAULT 'checkout'::text,
  "source_event_id" uuid,
  "is_vip" boolean DEFAULT false,
  "unsubscribed" boolean DEFAULT false,
  "unsubscribed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "organizer_user_id" uuid,
  "import_id" uuid
);
CREATE TABLE IF NOT EXISTS public.venues (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "city" text NOT NULL,
  "cover_url" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "logo_url" text,
  "address" text,
  "cover_position" jsonb DEFAULT '{"x": 50, "y": 50}'::jsonb,
  "click_collect_mode" boolean DEFAULT false,
  "owner_id" uuid,
  "floor_plan_url" text,
  "latitude" numeric,
  "longitude" numeric,
  "instagram_url" text,
  "facebook_url" text,
  "tiktok_url" text,
  "twitter_url" text,
  "gallery_images" jsonb DEFAULT '[]'::jsonb,
  "whatsapp_number" text,
  "stripe_account_id" text,
  "stripe_onboarding_complete" boolean DEFAULT false,
  "stripe_charges_enabled" boolean DEFAULT false,
  "stripe_payouts_enabled" boolean DEFAULT false,
  "custom_domain" text,
  "legal_name" text,
  "siret" text,
  "vat_number" text,
  "legal_address" text,
  "invoice_prefix" text DEFAULT 'FAC'::text,
  "is_hidden" boolean DEFAULT false,
  "bar_count" integer DEFAULT 1,
  "bar_names" text[] DEFAULT ARRAY['Bar Principal'::text],
  "cancellation_insurance_enabled" boolean DEFAULT true,
  "cloakroom_price" numeric DEFAULT 4,
  "description" text,
  "vip_placement_enabled" boolean DEFAULT false,
  "free_drink_mode" text DEFAULT 'bouncer_notify'::text,
  "menu_enabled" boolean DEFAULT false,
  "hidden_from_map" boolean DEFAULT false,
  "short_description" text,
  "music_genre" text,
  "min_age" integer,
  "minors_allowed" boolean DEFAULT false,
  "minor_auth_doc_url" text,
  "minor_auth_doc_name" text,
  "absorb_yuno_fees" boolean DEFAULT false,
  "vip_menu_visibility" text DEFAULT 'hidden'::text,
  "vip_preorder_enabled" boolean DEFAULT false,
  "vip_menu_display_mode" text DEFAULT 'text'::text,
  "live_mode_enabled" boolean DEFAULT false,
  "solo_bottle_sale_enabled" boolean DEFAULT false,
  "post_checkout_upsell_enabled" boolean DEFAULT false,
  "search_name" text,
  "search_city" text,
  "slug" text,
  "name_changed_at" timestamp with time zone,
  "timezone" text,
  "decommissioned_at" timestamp with time zone,
  "purge_at" timestamp with time zone,
  "showcase_shadow_owner_id" uuid,
  "home_banner" jsonb,
  "product" text DEFAULT 'suite'::text,
  "extra_products" text[] DEFAULT '{}'::text[]
);
CREATE TABLE IF NOT EXISTS public.vip_consumptions (
  "id" uuid DEFAULT gen_random_uuid(),
  "table_reservation_id" uuid NOT NULL,
  "venue_id" text NOT NULL,
  "event_id" uuid,
  "item_name" text NOT NULL,
  "item_type" text DEFAULT 'bottle'::text,
  "quantity" integer DEFAULT 1,
  "unit_price" numeric(10,2) DEFAULT 0,
  "total_price" numeric(10,2) DEFAULT 0,
  "served_by" uuid,
  "served_at" timestamp with time zone DEFAULT now(),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "category" text,
  "photo_url" text,
  "special_request" text,
  "staff_id" uuid,
  "menu_item_id" uuid,
  "brand" text,
  "source" text DEFAULT 'staff'::text,
  "parent_consumption_id" uuid
);
CREATE TABLE IF NOT EXISTS public.vip_table_orders (
  "id" uuid DEFAULT gen_random_uuid(),
  "table_reservation_id" uuid NOT NULL,
  "venue_id" text NOT NULL,
  "user_id" uuid,
  "status" text DEFAULT 'pending'::text,
  "total_amount" numeric(10,2) DEFAULT 0,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "confirmed_at" timestamp with time zone,
  "confirmed_by" uuid,
  "served_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.visitor_sessions (
  "id" uuid DEFAULT gen_random_uuid(),
  "session_id" text NOT NULL,
  "venue_id" text,
  "referrer" text,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "user_agent" text,
  "ip_address" text,
  "visited_at" timestamp with time zone DEFAULT now(),
  "added_to_cart" boolean DEFAULT false,
  "proceeded_to_checkout" boolean DEFAULT false,
  "completed_order" boolean DEFAULT false,
  "order_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "duration_seconds" integer,
  "user_id" uuid,
  "entry_page" text,
  "entry_page_type" text,
  "device_type" text,
  "referrer_domain" text,
  "event_id" uuid,
  "organizer_user_id" uuid,
  "last_activity_at" timestamp with time zone DEFAULT now(),
  "cart_value_cents" integer DEFAULT 0,
  "utm_term" text,
  "utm_content" text,
  "gclid" text,
  "fbclid" text,
  "landing_page_full" text,
  "referrer_category" text,
  "visitor_id" text,
  "is_returning" boolean DEFAULT false,
  "visit_number" integer DEFAULT 1,
  "language" text,
  "viewport_w" integer,
  "viewport_h" integer,
  "connection_type" text,
  "country" text,
  "region" text,
  "city" text,
  "pages_viewed" integer DEFAULT 1,
  "scroll_depth_max" integer DEFAULT 0,
  "country_code" text,
  "latitude" double precision,
  "longitude" double precision
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_audit_log_pkey ON public.admin_audit_log USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS admin_notifications_pkey ON public.admin_notifications USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_notifications_dedup ON public.admin_notifications USING btree (dedup_key) WHERE (dedup_key IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS admin_support_sessions_pkey ON public.admin_support_sessions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS agencies_pkey ON public.agencies USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS agencies_slug_key ON public.agencies USING btree (slug);
CREATE UNIQUE INDEX IF NOT EXISTS contact_base_cache_state_pkey ON public.contact_base_cache_state USING btree (scope_key);
CREATE UNIQUE INDEX IF NOT EXISTS contact_engagement_pkey ON public.contact_engagement USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_engagement_scope_email ON public.contact_engagement USING btree (scope_key, email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_segments_platform_name ON public.contact_segments USING btree (lower(name)) WHERE ((venue_id IS NULL) AND (organizer_user_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS contact_segments_pkey ON public.contact_segments USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_segments_venue_name ON public.contact_segments USING btree (venue_id, lower(name)) WHERE (venue_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_segments_org_name ON public.contact_segments USING btree (organizer_user_id, lower(name)) WHERE (organizer_user_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS crm_contact_notes_pkey ON public.crm_contact_notes USING btree (scope_key, email);
CREATE UNIQUE INDEX IF NOT EXISTS crm_email_settings_pkey ON public.crm_email_settings USING btree (scope_key);
CREATE UNIQUE INDEX IF NOT EXISTS crm_import_journal_pkey ON public.crm_import_journal USING btree (list_import_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS crm_imports_pkey ON public.crm_imports USING btree (list_import_id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_pricing_pkey ON public.crm_pricing USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_segment_counts_pkey ON public.crm_segment_counts USING btree (scope_key, seg_key, day);
CREATE UNIQUE INDEX IF NOT EXISTS crm_segments_pkey ON public.crm_segments USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_settings_pkey ON public.crm_settings USING btree (scope_key);
CREATE UNIQUE INDEX IF NOT EXISTS crm_signup_entries_pkey ON public.crm_signup_entries USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_signup_entries_email_uidx ON public.crm_signup_entries USING btree (page_id, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS crm_signup_entries_phone_uidx ON public.crm_signup_entries USING btree (page_id, phone) WHERE (email IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS crm_signup_pages_pkey ON public.crm_signup_pages USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_signup_pages_slug_key ON public.crm_signup_pages USING btree (slug);
CREATE UNIQUE INDEX IF NOT EXISTS crm_signup_visits_pkey ON public.crm_signup_visits USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_signup_visits_page_id_day_visitor_hash_key ON public.crm_signup_visits USING btree (page_id, day, visitor_hash);
CREATE UNIQUE INDEX IF NOT EXISTS crm_sms_settings_pkey ON public.crm_sms_settings USING btree (scope_key);
CREATE UNIQUE INDEX IF NOT EXISTS crm_subscriptions_pkey ON public.crm_subscriptions USING btree (scope_key);
CREATE UNIQUE INDEX IF NOT EXISTS crm_subscriptions_stripe_customer_id_key ON public.crm_subscriptions USING btree (stripe_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_subscriptions_stripe_subscription_id_key ON public.crm_subscriptions USING btree (stripe_subscription_id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_yunit_lots_pkey ON public.crm_yunit_lots USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_yunit_lots_ref ON public.crm_yunit_lots USING btree (scope_key, kind, source_ref) WHERE (source_ref IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS customer_loyalty_pkey ON public.customer_loyalty USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_loyalty_venue_id_user_id_key ON public.customer_loyalty USING btree (venue_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS discovery_selections_pkey ON public.discovery_selections USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dj_team_members_pkey ON public.dj_team_members USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dj_team_members_dj_user_id_member_user_id_key ON public.dj_team_members USING btree (dj_user_id, member_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_automation_sends_event_kind_email ON public.email_automation_sends USING btree (kind, trigger_event_id, lower(email)) WHERE ((status = 'queued'::text) AND (trigger_event_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS email_automation_sends_pkey ON public.email_automation_sends USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_automation_sends_key ON public.email_automation_sends USING btree (automation_id, trigger_key, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_automations_platform_kind ON public.email_automations USING btree (kind) WHERE ((venue_id IS NULL) AND (organizer_user_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS email_automations_pkey ON public.email_automations USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_automations_venue_kind ON public.email_automations USING btree (venue_id, kind) WHERE (venue_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_automations_org_kind ON public.email_automations USING btree (organizer_user_id, kind) WHERE (organizer_user_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_events_pkey ON public.email_campaign_events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_events_svix_id_key ON public.email_campaign_events USING btree (svix_id) WHERE (svix_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_followups_pkey ON public.email_campaign_followups USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_campaign_followups_parent_email ON public.email_campaign_followups USING btree (parent_campaign_id, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_campaign_followups_event_email ON public.email_campaign_followups USING btree (event_id, lower(email)) WHERE (status = 'queued'::text);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_recipients_pkey ON public.email_campaign_recipients USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_recipient_email ON public.email_campaign_recipients USING btree (campaign_id, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_templates_pkey ON public.email_campaign_templates USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaigns_pkey ON public.email_campaigns USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS email_list_imports_pkey ON public.email_list_imports USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS email_opt_outs_pkey ON public.email_opt_outs USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_opt_outs_venue ON public.email_opt_outs USING btree (lower(email), venue_id) WHERE (venue_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_opt_outs_organizer ON public.email_opt_outs USING btree (lower(email), organizer_user_id) WHERE (organizer_user_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_opt_outs_platform ON public.email_opt_outs USING btree (lower(email)) WHERE ((venue_id IS NULL) AND (organizer_user_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_suppressions_email ON public.email_suppressions USING btree (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_pkey ON public.email_suppressions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS event_cohosts_pkey ON public.event_cohosts USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS event_cohosts_live_org_idx ON public.event_cohosts USING btree (event_id, organizer_user_id) WHERE ((organizer_user_id IS NOT NULL) AND (status = ANY (ARRAY['pending'::text, 'accepted'::text])));
CREATE UNIQUE INDEX IF NOT EXISTS event_cohosts_live_venue_idx ON public.event_cohosts USING btree (event_id, venue_id) WHERE ((venue_id IS NOT NULL) AND (status = ANY (ARRAY['pending'::text, 'accepted'::text])));
CREATE UNIQUE INDEX IF NOT EXISTS event_coorg_deals_pkey ON public.event_coorg_deals USING btree (event_id);
CREATE UNIQUE INDEX IF NOT EXISTS event_djs_pkey ON public.event_djs USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS event_djs_event_id_dj_id_key ON public.event_djs USING btree (event_id, dj_id);
CREATE UNIQUE INDEX IF NOT EXISTS event_funnel_events_pkey ON public.event_funnel_events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS event_guest_artists_pkey ON public.event_guest_artists USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_guest_artists_event_name ON public.event_guest_artists USING btree (event_id, lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS event_waitlist_pkey ON public.event_waitlist USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS event_waitlist_event_id_email_key ON public.event_waitlist USING btree (event_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_waitlist_event_user ON public.event_waitlist USING btree (event_id, user_id) WHERE (user_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS events_pkey ON public.events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_recurring_template_date ON public.events USING btree (recurring_template_id, (((start_at AT TIME ZONE 'Europe/Paris'::text))::date)) WHERE (recurring_template_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS external_events_pkey ON public.external_events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS external_events_uq ON public.external_events USING btree (connection_id, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS external_tickets_pkey ON public.external_tickets USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS external_tickets_uq ON public.external_tickets USING btree (connection_id, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_pkey ON public.favorites USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_id_favorite_type_venue_id_key ON public.favorites USING btree (user_id, favorite_type, venue_id);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_id_favorite_type_event_id_key ON public.favorites USING btree (user_id, favorite_type, event_id);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_id_favorite_type_drink_id_key ON public.favorites USING btree (user_id, favorite_type, drink_id);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_id_favorite_type_dj_id_key ON public.favorites USING btree (user_id, favorite_type, dj_id);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_id_favorite_type_affiliate_event_id_key ON public.favorites USING btree (user_id, favorite_type, affiliate_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_id_favorite_type_affiliate_venue_id_key ON public.favorites USING btree (user_id, favorite_type, affiliate_venue_id);
CREATE UNIQUE INDEX IF NOT EXISTS guest_list_entries_pkey ON public.guest_list_entries USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS guest_list_entries_qr_code_key ON public.guest_list_entries USING btree (qr_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_list_entries_reservation_code ON public.guest_list_entries USING btree (reservation_code) WHERE (reservation_code IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_list_entries_list_email ON public.guest_list_entries USING btree (guest_list_id, lower(email)) WHERE ((email IS NOT NULL) AND (email <> ''::text) AND (status <> 'cancelled'::text));
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_pkey ON public.guest_lists USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_share_token_key ON public.guest_lists USING btree (share_token);
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_dj_uniq ON public.guest_lists USING btree (event_id, dj_id) WHERE (dj_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_club_uniq ON public.guest_lists USING btree (event_id) WHERE (holder_type = 'club'::text);
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_promoter_uniq ON public.guest_lists USING btree (event_id, promoter_id) WHERE (holder_type = 'promoter'::text);
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_organizer_uniq ON public.guest_lists USING btree (event_id, organizer_user_id) WHERE (holder_type = 'organizer'::text);
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_agency_uniq ON public.guest_lists USING btree (event_id, agency_id) WHERE (holder_type = 'agency'::text);
CREATE UNIQUE INDEX IF NOT EXISTS imported_contacts_pkey ON public.imported_contacts USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_imported_contacts_identity ON public.imported_contacts USING btree (list_import_id, COALESCE(email, ''::text), COALESCE(phone_e164, ''::text));
CREATE UNIQUE INDEX IF NOT EXISTS live_visitor_pings_pkey ON public.live_visitor_pings USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS live_visitor_pings_session_id_key ON public.live_visitor_pings USING btree (session_id);
CREATE UNIQUE INDEX IF NOT EXISTS manager_permissions_pkey ON public.manager_permissions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS manager_permissions_venue_id_user_id_key ON public.manager_permissions USING btree (venue_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_consent_events_pkey ON public.marketing_consent_events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_email_log_pkey ON public.marketing_email_log USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_email_images_pkey ON public.mcp_email_images USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_email_images_code_key ON public.mcp_email_images USING btree (code);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_grants_pkey ON public.mcp_grants USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_pkey ON public.mcp_tokens USING btree (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tool_calls_pkey ON public.mcp_tool_calls USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscriptions_pkey ON public.newsletter_subscriptions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscriptions_unsubscribe_token_key ON public.newsletter_subscriptions USING btree (unsubscribe_token);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subs_email_platform ON public.newsletter_subscriptions USING btree (lower(email)) WHERE ((venue_id IS NULL) AND (organizer_user_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subs_email_venue ON public.newsletter_subscriptions USING btree (lower(email), venue_id) WHERE (venue_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subs_email_organizer ON public.newsletter_subscriptions USING btree (lower(email), organizer_user_id) WHERE (organizer_user_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS orders_pkey ON public.orders USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS orders_token_key ON public.orders USING btree (token);
CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_key ON public.orders USING btree (order_number);
CREATE UNIQUE INDEX IF NOT EXISTS org_members_pkey ON public.org_members USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS org_members_invitation_token_key ON public.org_members USING btree (invitation_token);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_members_orga_member ON public.org_members USING btree (organizer_user_id, member_user_id) WHERE (member_user_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_profile_followers_pkey ON public.organizer_profile_followers USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_profile_followers_organizer_user_id_user_id_key ON public.organizer_profile_followers USING btree (organizer_user_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_profiles_pkey ON public.organizer_profiles USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_profiles_slug_key ON public.organizer_profiles USING btree (slug);
CREATE UNIQUE INDEX IF NOT EXISTS platform_notification_settings_pkey ON public.platform_notification_settings USING btree (notification_key);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_pkey ON public.profiles USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS promoter_conversions_pkey ON public.promoter_conversions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_promoter_conversions_ticket_unique ON public.promoter_conversions USING btree (ticket_id) WHERE (ticket_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_promoter_conversions_table_unique ON public.promoter_conversions USING btree (table_reservation_id) WHERE (table_reservation_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_promoter_conversions_order_unique ON public.promoter_conversions USING btree (order_id) WHERE (order_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_promoter_conversions_guestlist_unique ON public.promoter_conversions USING btree (guest_list_entry_id) WHERE (guest_list_entry_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS promoters_pkey ON public.promoters USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS promoters_venue_id_promo_code_key ON public.promoters USING btree (venue_id, promo_code);
CREATE UNIQUE INDEX IF NOT EXISTS promoters_user_id_venue_id_key ON public.promoters USING btree (user_id, venue_id);
CREATE UNIQUE INDEX IF NOT EXISTS promoters_organizer_promo_code_unique ON public.promoters USING btree (organizer_user_id, lower(promo_code)) WHERE (organizer_user_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS promoters_user_organizer_unique ON public.promoters USING btree (user_id, organizer_user_id) WHERE (organizer_user_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS push_campaign_events_pkey ON public.push_campaign_events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS push_campaign_events_campaign_id_user_id_event_type_key ON public.push_campaign_events USING btree (campaign_id, user_id, event_type);
CREATE UNIQUE INDEX IF NOT EXISTS push_campaigns_pkey ON public.push_campaigns USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_campaigns_auto_event ON public.push_campaigns USING btree (event_id, template_key) WHERE ((source = 'auto'::text) AND (event_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS push_candidates_pkey ON public.push_candidates USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS push_candidates_dedup_key_key ON public.push_candidates USING btree (dedup_key);
CREATE UNIQUE INDEX IF NOT EXISTS push_event_settings_pkey ON public.push_event_settings USING btree (event_id);
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_pkey ON public.push_subscriptions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_id_endpoint_key ON public.push_subscriptions USING btree (user_id, endpoint);
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_native_endpoint_key ON public.push_subscriptions USING btree (endpoint, platform) WHERE (platform = ANY (ARRAY['ios'::text, 'ios_pro'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS sms_campaign_recipients_pkey ON public.sms_campaign_recipients USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS sms_campaign_recipients_unique ON public.sms_campaign_recipients USING btree (campaign_id, phone_e164);
CREATE UNIQUE INDEX IF NOT EXISTS sms_campaigns_pkey ON public.sms_campaigns USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS sms_stop_list_pkey ON public.sms_stop_list USING btree (phone_e164);
CREATE UNIQUE INDEX IF NOT EXISTS table_packs_pkey ON public.table_packs USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS table_reservations_pkey ON public.table_reservations USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS table_reservations_table_id_event_id_key ON public.table_reservations USING btree (table_id, event_id);
CREATE UNIQUE INDEX IF NOT EXISTS table_reservations_qr_code_key ON public.table_reservations USING btree (qr_code);
CREATE UNIQUE INDEX IF NOT EXISTS table_reservations_reference_code_key ON public.table_reservations USING btree (reference_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_table_reservations_live_table ON public.table_reservations USING btree (event_id, assigned_table_id) WHERE ((assigned_table_id IS NOT NULL) AND (vip_status = ANY (ARRAY['placed'::text, 'active'::text])) AND (status <> ALL (ARRAY['cancelled'::text, 'refunded'::text])));
CREATE UNIQUE INDEX IF NOT EXISTS table_zones_pkey ON public.table_zones USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_attendees_pkey ON public.ticket_attendees USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_rounds_pkey ON public.ticket_rounds USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS ticketing_connections_org_uq ON public.ticketing_connections USING btree (provider, organizer_user_id) WHERE (organizer_user_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ticketing_connections_pkey ON public.ticketing_connections USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS ticketing_connections_venue_uq ON public.ticketing_connections USING btree (provider, venue_id) WHERE (venue_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_pkey ON public.tickets USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_reference_code_key ON public.tickets USING btree (reference_code);
CREATE UNIQUE INDEX IF NOT EXISTS tracked_link_clicks_pkey ON public.tracked_link_clicks USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS tracked_links_pkey ON public.tracked_links USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS tracked_links_code_key ON public.tracked_links USING btree (code);
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_pkey ON public.user_roles USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_id_role_key ON public.user_roles USING btree (user_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS user_taste_profiles_pkey ON public.user_taste_profiles USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS user_taste_profiles_user_id_key ON public.user_taste_profiles USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS venue_customers_pkey ON public.venue_customers USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS venue_customers_venue_id_user_id_key ON public.venue_customers USING btree (venue_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS venue_segments_pkey ON public.venue_segments USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_venue_segments_name ON public.venue_segments USING btree (venue_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS venue_sms_contacts_pkey ON public.venue_sms_contacts USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS venue_sms_contacts_unique_phone ON public.venue_sms_contacts USING btree (venue_id, phone_e164);
CREATE UNIQUE INDEX IF NOT EXISTS venue_sms_contacts_unique_org_phone ON public.venue_sms_contacts USING btree (organizer_user_id, phone_e164);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sms_contacts_platform_phone ON public.venue_sms_contacts USING btree (phone_e164) WHERE ((venue_id IS NULL) AND (organizer_user_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS venues_pkey ON public.venues USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS venues_slug_key ON public.venues USING btree (slug);
CREATE UNIQUE INDEX IF NOT EXISTS vip_consumptions_pkey ON public.vip_consumptions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS vip_table_orders_pkey ON public.vip_table_orders USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS visitor_sessions_pkey ON public.visitor_sessions USING btree (id);

CREATE OR REPLACE FUNCTION public._an3_comparables(p_event_id uuid, p_scope_ids uuid[], p_limit integer DEFAULT 5)
 RETURNS TABLE(event_id uuid, rank integer, comparable boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT e.id, e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris') AS tz,
           e.recurring_template_id, coalesce(e.event_type, 'club') AS event_type
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE e.id = p_event_id
  ),
  cands AS (
    SELECT e.id, e.start_at,
           (extract(isodow FROM (e.start_at AT TIME ZONE t.tz)) = extract(isodow FROM (t.start_at AT TIME ZONE t.tz))
            AND CASE WHEN t.recurring_template_id IS NOT NULL THEN e.recurring_template_id = t.recurring_template_id
                     ELSE coalesce(e.event_type, 'club') = t.event_type END) AS comparable
      FROM public.events e CROSS JOIN target t
     WHERE e.id = ANY(p_scope_ids) AND e.id <> t.id
       AND e.start_at < t.start_at
       AND coalesce(e.end_at, e.start_at + interval '8 hours') <= now()
       AND e.cancelled_at IS NULL AND coalesce(e.status, 'active') <> 'cancelled'
  ),
  strict AS (
    SELECT c.id, row_number() OVER (ORDER BY c.start_at DESC)::int AS rn FROM cands c WHERE c.comparable
  ),
  loose AS (
    SELECT c.id, row_number() OVER (ORDER BY c.start_at DESC)::int AS rn FROM cands c
  )
  SELECT s.id, s.rn, true FROM strict s WHERE s.rn <= greatest(p_limit, 1)
  UNION ALL
  SELECT l.id, l.rn, false FROM loose l
   WHERE l.rn <= greatest(p_limit, 1) AND NOT EXISTS (SELECT 1 FROM strict)
$function$;

CREATE OR REPLACE FUNCTION public._an3_curve(p_ids uuid[], p_venue_id text, p_money boolean, p_days integer DEFAULT 30)
 RETURNS TABLE(event_id uuid, d integer, revenue numeric, tickets integer, heads integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id, public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris')) AS night,
           coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris') AS tz,
           (p_money AND (p_venue_id IS NULL OR e.venue_id = p_venue_id)) AS show_money
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE e.id = ANY(coalesce(p_ids, '{}'))
  ),
  sales AS (
    SELECT p.event_id,
           greatest(0, least(p_days, ev.night - public.night_date(p.at_ts, ev.tz))) AS d,
           CASE WHEN ev.show_money THEN p.amount ELSE 0 END AS amount,
           CASE WHEN p.pillar = 'tickets' THEN p.units ELSE 0 END AS tickets,
           CASE WHEN p.pillar = 'tickets' THEN p.units WHEN p.pillar = 'guest_list' THEN 1 ELSE 0 END AS heads
      FROM public._an3_people(coalesce(p_ids, '{}'), p_venue_id) p
      JOIN ev ON ev.id = p.event_id
  ),
  grid AS (
    SELECT ev.id AS event_id, g.d FROM ev CROSS JOIN generate_series(p_days, 0, -1) AS g(d)
  ),
  daily AS (
    SELECT g.event_id, g.d,
           coalesce(sum(s.amount), 0) AS amount, coalesce(sum(s.tickets), 0)::int AS tickets, coalesce(sum(s.heads), 0)::int AS heads
      FROM grid g LEFT JOIN sales s ON s.event_id = g.event_id AND s.d = g.d
     GROUP BY g.event_id, g.d
  )
  SELECT daily.event_id, daily.d,
         round(sum(daily.amount) OVER (PARTITION BY daily.event_id ORDER BY daily.d DESC), 2),
         sum(daily.tickets) OVER (PARTITION BY daily.event_id ORDER BY daily.d DESC)::int,
         sum(daily.heads) OVER (PARTITION BY daily.event_id ORDER BY daily.d DESC)::int
    FROM daily
$function$;

CREATE OR REPLACE FUNCTION public._an3_nights(p_event_ids uuid[], p_venue_id text, p_money boolean)
 RETURNS TABLE(event_id uuid, title text, start_at timestamp with time zone, end_ts timestamp with time zone, tz text, night date, poster text, weekday integer, format_key text, cap integer, show_money boolean, tickets integer, ticket_orders integer, tables integer, table_guests integer, tables_arrived integer, bar_orders integer, gl_registered integer, gl_entered integer, entries integer, expected integer, rev_tickets numeric, rev_tables numeric, rev_bar numeric, revenue numeric, refunds numeric, deposits numeric, customers integer, first_sale_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id, e.title, e.start_at,
           coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts,
           coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris') AS tz,
           coalesce(e.poster_url, e.image_url) AS poster,
           e.max_tickets, e.venue_id, e.recurring_template_id, e.event_type,
           (p_money AND (p_venue_id IS NULL OR e.venue_id = p_venue_id)) AS show_money
      FROM public.events e
      LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE e.id = ANY(p_event_ids)
  ),
  tk AS (
    SELECT t.event_id,
           sum(greatest(coalesce(t.quantity, 1), 1))::int AS sold,
           count(*)::int AS orders,
           sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS amount,
           sum(least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS refunds,
           min(coalesce(t.paid_at, t.created_at)) AS first_at
      FROM public.tickets t
     WHERE t.event_id = ANY(p_event_ids) AND t.status IN ('paid', 'used')
     GROUP BY t.event_id
  ),
  tb AS (
    SELECT r.event_id,
           count(*)::int AS booked,
           sum(greatest(coalesce(r.guest_count, 0), 0))::int AS guests,
           count(*) FILTER (WHERE coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)::int AS arrived,
           sum(greatest(r.total_price - coalesce(r.service_fee, 0)
                        - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0)
                                - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) AS amount,
           sum(least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0)
                              - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) AS refunds,
           sum(CASE WHEN coalesce(r.payment_mode, 'online') <> 'on_site' THEN greatest(coalesce(r.deposit, 0), 0) ELSE 0 END) AS deposits,
           min(coalesce(r.paid_at, r.created_at)) AS first_at
      FROM public.table_reservations r
     WHERE r.event_id = ANY(p_event_ids) AND r.status IN ('paid', 'confirmed')
     GROUP BY r.event_id
  ),
  dr AS (
    SELECT o.event_id,
           count(*)::int AS orders,
           sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
               - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) AS amount,
           sum(least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) AS refunds
      FROM public.orders o
     WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id
       AND o.event_id = ANY(p_event_ids) AND o.status IN ('paid', 'served')
     GROUP BY o.event_id
  ),
  gl AS (
    SELECT g.event_id,
           count(*)::int AS registered,
           count(*) FILTER (WHERE coalesce(x.entry_scanned, false))::int AS entered
      FROM public.guest_list_entries x
      JOIN public.guest_lists g ON g.id = x.guest_list_id
     WHERE g.event_id = ANY(p_event_ids) AND x.status IS DISTINCT FROM 'cancelled'
     GROUP BY g.event_id
  ),
  people AS (
    SELECT p.event_id, count(DISTINCT p.email)::int AS n
      FROM (
        SELECT t.event_id, lower(trim(t.user_email)) AS email FROM public.tickets t
         WHERE t.event_id = ANY(p_event_ids) AND t.status IN ('paid', 'used')
        UNION ALL
        SELECT r.event_id, lower(trim(r.user_email)) FROM public.table_reservations r
         WHERE r.event_id = ANY(p_event_ids) AND r.status IN ('paid', 'confirmed')
        UNION ALL
        SELECT o.event_id, lower(trim(o.user_email)) FROM public.orders o
         WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id
           AND o.event_id = ANY(p_event_ids) AND o.status IN ('paid', 'served')
        UNION ALL
        SELECT g.event_id, lower(trim(x.email)) FROM public.guest_list_entries x
          JOIN public.guest_lists g ON g.id = x.guest_list_id
         WHERE g.event_id = ANY(p_event_ids) AND x.status IS DISTINCT FROM 'cancelled'
      ) p
     WHERE nullif(p.email, '') IS NOT NULL
     GROUP BY p.event_id
  ),
  caps AS (
    SELECT ev.id AS event_id,
           CASE WHEN coalesce(ev.max_tickets, 0) > 0 THEN ev.max_tickets
                WHEN EXISTS (SELECT 1 FROM public.ticket_rounds tr WHERE tr.event_id = ev.id)
                 AND NOT EXISTS (SELECT 1 FROM public.ticket_rounds tr WHERE tr.event_id = ev.id AND coalesce(tr.max_tickets, 0) <= 0)
                  THEN (SELECT sum(tr.max_tickets)::int FROM public.ticket_rounds tr WHERE tr.event_id = ev.id)
                ELSE NULL END AS cap
      FROM ev
  )
  SELECT ev.id, ev.title, ev.start_at, ev.end_ts, ev.tz,
         public.night_date(ev.start_at, ev.tz),
         ev.poster,
         extract(isodow FROM (ev.start_at AT TIME ZONE ev.tz))::int,
         coalesce('tpl:' || ev.recurring_template_id::text, 'type:' || coalesce(ev.event_type, 'club')),
         caps.cap, ev.show_money,
         coalesce(tk.sold, 0), coalesce(tk.orders, 0),
         coalesce(tb.booked, 0), coalesce(tb.guests, 0), coalesce(tb.arrived, 0),
         coalesce(dr.orders, 0),
         coalesce(gl.registered, 0), coalesce(gl.entered, 0),
         coalesce((h.j ->> 'entered')::int, 0), coalesce((h.j ->> 'expected')::int, 0),
         CASE WHEN ev.show_money THEN coalesce(tk.amount, 0) ELSE 0 END,
         CASE WHEN ev.show_money THEN coalesce(tb.amount, 0) ELSE 0 END,
         CASE WHEN ev.show_money THEN coalesce(dr.amount, 0) ELSE 0 END,
         CASE WHEN ev.show_money THEN coalesce(tk.amount, 0) + coalesce(tb.amount, 0) + coalesce(dr.amount, 0) ELSE 0 END,
         CASE WHEN ev.show_money THEN coalesce(tk.refunds, 0) + coalesce(tb.refunds, 0) + coalesce(dr.refunds, 0) ELSE 0 END,
         CASE WHEN ev.show_money THEN coalesce(tb.deposits, 0) ELSE 0 END,
         coalesce(people.n, 0),
         least(tk.first_at, tb.first_at)
    FROM ev
    LEFT JOIN tk ON tk.event_id = ev.id
    LEFT JOIN tb ON tb.event_id = ev.id
    LEFT JOIN dr ON dr.event_id = ev.id
    LEFT JOIN gl ON gl.event_id = ev.id
    LEFT JOIN people ON people.event_id = ev.id
    LEFT JOIN caps ON caps.event_id = ev.id
    LEFT JOIN LATERAL (SELECT public._door_headcount(ARRAY[ev.id]) AS j) h ON true
$function$;

CREATE OR REPLACE FUNCTION public._an3_people(p_scope_ids uuid[], p_venue_id text)
 RETURNS TABLE(event_id uuid, email text, user_id uuid, at_ts timestamp with time zone, pillar text, units integer, amount numeric, first_seen timestamp with time zone, first_event uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sale_rows AS (
    SELECT t.event_id, lower(trim(t.user_email)) AS email, t.user_id, coalesce(t.paid_at, t.created_at) AS at_ts, 'tickets'::text AS pillar, greatest(coalesce(t.quantity, 1), 1)::int AS units,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t WHERE t.event_id = ANY(p_scope_ids) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT r.event_id, lower(trim(r.user_email)), r.user_id, coalesce(r.paid_at, r.created_at), 'tables', 1,
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r WHERE r.event_id = ANY(p_scope_ids) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT o.event_id, lower(trim(o.user_email)), o.user_id, coalesce(o.paid_at, o.created_at), 'drinks', 0,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
      FROM public.orders o
     WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id AND o.event_id = ANY(p_scope_ids) AND o.status IN ('paid', 'served')
    UNION ALL
    SELECT g.event_id, lower(trim(x.email)), x.user_id, x.created_at, 'guest_list', 1, 0
      FROM public.guest_list_entries x JOIN public.guest_lists g ON g.id = x.guest_list_id
     WHERE g.event_id = ANY(p_scope_ids) AND x.status IS DISTINCT FROM 'cancelled'
  ),
  firsts AS (
    SELECT r.email, min(r.at_ts) AS first_seen,
           (array_agg(r.event_id ORDER BY r.at_ts ASC))[1] AS first_event
      FROM sale_rows r WHERE nullif(r.email, '') IS NOT NULL GROUP BY r.email
  )
  SELECT r.event_id, r.email, r.user_id, r.at_ts, r.pillar, r.units, r.amount, f.first_seen, f.first_event
    FROM sale_rows r JOIN firsts f ON f.email = r.email
   WHERE nullif(r.email, '') IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public._an3_subject_ids(p_scope_ids uuid[], p_tz text, p_event_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_event_id IS NOT NULL THEN
      CASE WHEN p_event_id = ANY(coalesce(p_scope_ids, '{}')) THEN ARRAY[p_event_id] ELSE '{}'::uuid[] END
    ELSE coalesce((
      SELECT array_agg(e.id)
        FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id
       WHERE e.id = ANY(coalesce(p_scope_ids, '{}')) AND e.cancelled_at IS NULL AND coalesce(e.status, 'active') <> 'cancelled'
         AND public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, p_tz))
             BETWEEN public.night_date(coalesce(p_from, coalesce(p_to, now()) - interval '30 days'), p_tz)
                 AND public.night_date(coalesce(p_to, now()), p_tz)), '{}'::uuid[])
  END
$function$;

CREATE OR REPLACE FUNCTION public._contact_base_cache_build(p_key text, p_venue_id text, p_organizer_user_id uuid, p_read boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_n integer;
BEGIN
  DELETE FROM public.contact_base_cache WHERE scope_key = p_key;
  INSERT INTO public.contact_base_cache
    SELECT p_key, r.* FROM public.contact_rows(p_venue_id, p_organizer_user_id) r;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.contact_base_cache_state AS s
         (scope_key, built_at, dirty_at, last_read_at, venue_id, organizer_user_id, row_count)
  VALUES (p_key, v_started, NULL, CASE WHEN p_read THEN now() END, p_venue_id, p_organizer_user_id, v_n)
  ON CONFLICT (scope_key) DO UPDATE SET
    built_at = EXCLUDED.built_at,
    -- Une écriture arrivée PENDANT la reconstruction reste à rattraper.
    dirty_at = CASE WHEN s.dirty_at > EXCLUDED.built_at THEN s.dirty_at END,
    last_read_at = COALESCE(EXCLUDED.last_read_at, s.last_read_at),
    venue_id = EXCLUDED.venue_id,
    organizer_user_id = EXCLUDED.organizer_user_id,
    row_count = EXCLUDED.row_count;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_ana_bucket(p_meta jsonb, p_ts timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_mode text := p_meta->>'mode';
  v_n int := (p_meta->>'n')::int;
  v_nd date := public._crm_night_date(p_ts, p_meta->>'tz', (p_meta->>'night_end_hour')::int);
  v_i int;
BEGIN
  IF v_mode = 'hour' THEN
    v_i := floor(extract(epoch FROM p_ts - (p_meta->>'start')::timestamptz) / 3600)::int;
  ELSIF v_mode = 'day' THEN
    v_i := v_nd - (p_meta->>'start')::date;
  ELSIF v_mode = 'month' THEN
    v_i := ((extract(year FROM v_nd) - extract(year FROM (p_meta->>'start')::date)) * 12
            + extract(month FROM v_nd) - extract(month FROM (p_meta->>'start')::date))::int;
  ELSE
    v_i := 21 - ((p_meta->'event'->>'night')::date - v_nd);
  END IF;
  RETURN CASE WHEN v_i BETWEEN 0 AND v_n - 1 THEN v_i END;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_ana_curve(p_event uuid, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'id', e.id, 'title', e.title, 'start_at', e.start_at, 'night', e.night, 'upcoming', e.upcoming,
      'sold', COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.event_id = e.id AND a.ok), 0),
      'cap', public._crm_night_capacity(e.left_tickets, e.deals,
               COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.event_id = e.id AND a.ok), 0)::int),
      'days_left', GREATEST(0, e.night - p_today),
      'curve', (SELECT jsonb_agg(CASE WHEN e.night - k > p_today THEN NULL
                       ELSE COALESCE((SELECT sum(a.qty) FROM _atk_all a
                                       WHERE a.event_id = e.id AND a.ok AND a.nd <= e.night - k), 0) END ORDER BY k DESC)
                  FROM generate_series(0, 21) k))
      FROM _aev e WHERE e.id = p_event);
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_ana_sends(p_venue_id text, p_organizer_user_id uuid, p_meta jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('i', public._crm_ana_bucket(p_meta, c.sent_at), 'at', c.sent_at, 'name', c.name, 'channel', 'email', 'id', c.id) AS x
      FROM public.email_campaigns c
     WHERE c.sent_at IS NOT NULL AND c.status IN ('sent', 'sending')
       AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND c.sent_at > now() - interval '13 months'
       AND public._crm_ana_bucket(p_meta, c.sent_at) IS NOT NULL
       AND (p_meta->>'mode' <> 'event' OR c.event_id IS NULL OR c.event_id = (p_meta->'event'->>'id')::uuid)
    UNION ALL
    SELECT jsonb_build_object('i', public._crm_ana_bucket(p_meta, s.sent_at), 'at', s.sent_at, 'name', s.name, 'channel', 'sms', 'id', s.id)
      FROM public.sms_campaigns s
     WHERE s.sent_at IS NOT NULL AND s.status IN ('sent', 'sending')
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
       AND s.sent_at > now() - interval '13 months'
       AND public._crm_ana_bucket(p_meta, s.sent_at) IS NOT NULL
  ) q;
$function$;

CREATE OR REPLACE FUNCTION public._crm_ana_setup(p_venue_id text, p_organizer_user_id uuid, p_period text, p_event uuid, p_seg text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_rules record;
  v_eh integer;
  v_now timestamptz := now();
  v_today date;
  v_mode text;
  v_n integer;
  v_start timestamptz; v_end timestamptz;
  v_d0 date; v_m0 date;
  v_ev_id uuid; v_ev_title text; v_ev_start timestamptz; v_ev_night date; v_ev_upcoming boolean; v_ev_series text;
  v_pev_id uuid; v_pev_title text; v_pev_start timestamptz; v_pev_night date;
  v_seg text := CASE WHEN p_seg IN ('hab', 'occ', 'nou', 'end', 'none') THEN p_seg ELSE 'all' END;
  v_labels jsonb;
BEGIN
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  v_eh := v_rules.night_end_hour;
  v_today := public._crm_night_date(v_now, v_tz, v_eh);

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _aev;
  CREATE TEMP TABLE _aev ON COMMIT DROP AS
  SELECT e.id, e.title, COALESCE(public._crm_night_series(e.title), e.title) AS series, e.start_at,
         COALESCE(e.end_at, e.start_at + interval '6 hours') > v_now AS upcoming,
         public._crm_night_date(e.start_at, COALESCE(NULLIF(e.timezone, ''), v_tz), v_eh) AS night,
         x.left_tickets, x.deals
    FROM public.events e
    LEFT JOIN public.external_events x ON x.event_id = e.id
   WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  IF p_event IS NOT NULL THEN
    SELECT id, title, start_at, night, upcoming, series
      INTO v_ev_id, v_ev_title, v_ev_start, v_ev_night, v_ev_upcoming, v_ev_series
      FROM _aev WHERE id = p_event;
    IF v_ev_id IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023'; END IF;
    SELECT id, title, start_at, night INTO v_pev_id, v_pev_title, v_pev_start, v_pev_night
      FROM _aev
     WHERE start_at < v_ev_start AND id <> v_ev_id
     ORDER BY (series = v_ev_series) DESC, start_at DESC LIMIT 1;
    v_mode := 'event'; v_n := 22;
  ELSIF p_period IN ('24h', '48h') THEN
    v_mode := 'hour'; v_n := CASE p_period WHEN '24h' THEN 24 ELSE 48 END;
    v_end := date_trunc('hour', v_now) + interval '1 hour';
    v_start := v_end - make_interval(hours => v_n);
  ELSIF p_period = '12m' THEN
    v_mode := 'month'; v_n := 12;
    v_m0 := (date_trunc('month', v_today) - interval '11 months')::date;
  ELSE
    v_mode := 'day'; v_n := CASE p_period WHEN '7d' THEN 7 WHEN '90d' THEN 90 ELSE 30 END;
    v_d0 := v_today - (v_n - 1);
  END IF;

  DROP TABLE IF EXISTS _atk_all;
  CREATE TEMP TABLE _atk_all ON COMMIT DROP AS
  SELECT q.*,
         CASE v_mode
           WHEN 'hour' THEN CASE WHEN q.bought_at >= v_start AND q.bought_at < v_end
                                 THEN floor(extract(epoch FROM q.bought_at - v_start) / 3600)::int END
           WHEN 'day' THEN CASE WHEN q.nd BETWEEN v_d0 AND v_today THEN q.nd - v_d0 END
           WHEN 'month' THEN CASE WHEN q.nd >= v_m0 AND q.nd <= v_today
                                  THEN ((extract(year FROM q.nd) - extract(year FROM v_m0)) * 12
                                        + extract(month FROM q.nd) - extract(month FROM v_m0))::int END
           ELSE CASE WHEN q.event_id = v_ev_id THEN 21 - LEAST(21, GREATEST(0, v_ev_night - q.nd)) END
         END AS ci,
         CASE v_mode
           WHEN 'hour' THEN CASE WHEN q.bought_at >= v_start - make_interval(hours => v_n) AND q.bought_at < v_start
                                 THEN floor(extract(epoch FROM q.bought_at - (v_start - make_interval(hours => v_n))) / 3600)::int END
           WHEN 'day' THEN CASE WHEN q.nd BETWEEN v_d0 - v_n AND v_d0 - 1 THEN q.nd - (v_d0 - v_n) END
           WHEN 'month' THEN CASE WHEN q.nd >= (v_m0 - interval '12 months')::date AND q.nd < v_m0
                                  THEN ((extract(year FROM q.nd) - extract(year FROM v_m0 - interval '12 months')) * 12
                                        + extract(month FROM q.nd) - extract(month FROM v_m0 - interval '12 months'))::int END
           ELSE CASE WHEN q.event_id = v_pev_id THEN 21 - LEAST(21, GREATEST(0, v_pev_night - q.nd)) END
         END AS pi
    FROM (
      SELECT t.id, lower(t.buyer_email) AS email, GREATEST(t.quantity, 1) AS qty,
             COALESCE(t.price, 0) * GREATEST(t.quantity, 1) AS amount,
             public._crm_ticket_is_sale(t.status, t.raw) AS ok, t.status = 'refunded' AS refunded,
             COALESCE(t.purchased_at, t.first_seen_at) AS bought_at, t.event_id,
             NULLIF(btrim(t.deal_name), '') AS deal, COALESCE(t.external_order_id, t.id::text) AS ord, t.price, public._crm_ticket_source(t.utm) AS src,
             t.scanned_at, t.age, NULLIF(btrim(t.city), '') AS city,
             public._crm_night_date(COALESCE(t.purchased_at, t.first_seen_at), v_tz, v_eh) AS nd,
             extract(hour FROM COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::int AS hr
        FROM public.external_tickets t
       WHERE t.status IN ('valid', 'transferred', 'refunded')
         AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
    ) q;
  CREATE INDEX ON _atk_all (event_id);
  CREATE INDEX ON _atk_all (email);

  DROP TABLE IF EXISTS _atk;
  IF v_seg = 'all' THEN
    CREATE TEMP TABLE _atk ON COMMIT DROP AS SELECT * FROM _atk_all;
  ELSE
    CREATE TEMP TABLE _atk ON COMMIT DROP AS
    SELECT a.* FROM _atk_all a JOIN _cp p ON p.email = a.email AND p.lifecycle = v_seg;
  END IF;

  -- Libellés des cases : l'instant de début (heures), la date (jours, mois),
  -- J-k et la date de la nuit (soirée).
  SELECT jsonb_agg(CASE v_mode
           WHEN 'hour' THEN to_jsonb(v_start + make_interval(hours => g))
           WHEN 'day' THEN to_jsonb(v_d0 + g)
           WHEN 'month' THEN to_jsonb((v_m0 + make_interval(months => g))::date)
           ELSE to_jsonb(v_ev_night - (21 - g)) END ORDER BY g)
    INTO v_labels FROM generate_series(0, v_n - 1) g;

  RETURN jsonb_build_object(
    'mode', v_mode, 'n', v_n, 'period', p_period, 'seg', v_seg, 'tz', v_tz, 'night_end_hour', v_eh,
    'today', v_today, 'now', v_now, 'labels', v_labels,
    'start', CASE v_mode WHEN 'hour' THEN to_jsonb(v_start) WHEN 'day' THEN to_jsonb(v_d0)
                         WHEN 'month' THEN to_jsonb(v_m0) ELSE to_jsonb(v_ev_night - 21) END,
    'event', CASE WHEN v_mode = 'event' THEN jsonb_build_object(
        'id', v_ev_id, 'title', v_ev_title, 'start_at', v_ev_start, 'night', v_ev_night, 'upcoming', v_ev_upcoming,
        'days_left', GREATEST(0, v_ev_night - v_today)) END,
    'prev_event', CASE WHEN v_pev_id IS NOT NULL THEN jsonb_build_object(
        'id', v_pev_id, 'title', v_pev_title, 'start_at', v_pev_start, 'night', v_pev_night) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_area_key(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(public.unaccent_safe(btrim(COALESCE(p, '')))), '[-_''’.,/()]+', ' ', 'g'),
               '^[0-9]{4,5}\s+', ''),
             '\s+([0-9]{4,5}|cedex(\s+[0-9]+)?|[0-9]{1,2}\s*(e|er|eme)?(\s+arr(ondissement)?)?)\s*$', ''),
           '\s+', ' ', 'g')), '');
$function$;

CREATE OR REPLACE FUNCTION public._crm_email_attrib(p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_hosts text[];
  v_n integer;
BEGIN
  SELECT array_agg(DISTINCT lower(substring(e.external_ticket_url FROM '^https?://([^/:?#]+)')))
    INTO v_hosts
    FROM public.events e
   WHERE e.external_ticket_url IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  DROP TABLE IF EXISTS _cmc;
  CREATE TEMP TABLE _cmc ON COMMIT DROP AS
    SELECT c.id, c.name, c.sent_at, c.audiences_json
      FROM public.email_campaigns c
     WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  DROP TABLE IF EXISTS _cmk;
  CREATE TEMP TABLE _cmk ON COMMIT DROP AS
    SELECT ev.campaign_id, lower(ev.recipient_email) AS email, ev.created_at AS at,
           public._crm_is_ticketing_link(ev.metadata->'click'->>'link', v_hosts) AS ticketing
      FROM public.email_campaign_events ev
      JOIN _cmc c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL;
  CREATE INDEX ON _cmk (campaign_id, email);
  CREATE INDEX ON _cmk (email, at);

  DROP TABLE IF EXISTS _cma;
  CREATE TEMP TABLE _cma ON COMMIT DROP AS
    SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, k.campaign_id
      FROM public._crm_tickets(p_venue_id, p_organizer_user_id) t
      JOIN _cmk k ON k.email = t.email AND k.at <= t.bought_at AND k.at > t.bought_at - interval '7 days'
     ORDER BY t.id, k.at DESC;
  CREATE INDEX ON _cma (campaign_id, email);
  SELECT count(*) INTO v_n FROM _cma;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_file_history(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(email text, f_nights integer, f_spent numeric, f_paid integer, f_first timestamp with time zone, f_last timestamp with time zone, f_asof timestamp with time zone, f_list uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (lower(c.email))
         lower(c.email),
         GREATEST(COALESCE(c.event_count, 0),
                  CASE WHEN COALESCE(c.total_spent, 0) > 0 OR c.last_purchase_at IS NOT NULL THEN 1 ELSE 0 END),
         COALESCE(c.total_spent, 0),
         CASE WHEN COALESCE(c.total_spent, 0) > 0 THEN GREATEST(COALESCE(c.event_count, 0), 1) ELSE 0 END,
         LEAST(c.added_at, c.last_purchase_at),
         c.last_purchase_at,
         COALESCE(c.last_purchase_at, c.created_at),
         c.list_import_id
    FROM public.imported_contacts c
   WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND c.email IS NOT NULL
     AND (COALESCE(c.event_count, 0) > 0 OR COALESCE(c.total_spent, 0) > 0 OR c.last_purchase_at IS NOT NULL)
     AND c.created_at <= COALESCE(p_at, now())
     AND (c.last_purchase_at IS NULL OR c.last_purchase_at <= COALESCE(p_at, now()))
   ORDER BY lower(c.email), c.created_at DESC,
            ((c.event_count IS NOT NULL)::int + (c.total_spent IS NOT NULL)::int + (c.last_purchase_at IS NOT NULL)::int) DESC,
            c.id;
$function$;

CREATE OR REPLACE FUNCTION public._crm_is_ticketing_link(p_link text, p_hosts text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_link IS NOT NULL
     AND p_link !~* '/unsubscribe'
     AND (p_link ~* '^https?://(www\.)?yunoapp\.eu/(l|event|events|e)/'
       OR p_link ~* '^https?://([a-z0-9-]+\.)*shotgun\.live'
       OR lower(substring(p_link FROM '^https?://([^/:?#]+)')) = ANY (COALESCE(p_hosts, '{}')));
$function$;

CREATE OR REPLACE FUNCTION public._crm_money_gate(p jsonb, p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public.crm_scope_sees_money(p_venue_id, p_organizer_user_id) THEN p ELSE public._crm_null_money(p) END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_msg_build(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_hosts text[];
  v_n integer;
BEGIN
  SELECT array_agg(DISTINCT lower(substring(e.external_ticket_url FROM '^https?://([^/:?#]+)')))
    INTO v_hosts
    FROM public.events e
   WHERE e.external_ticket_url IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  DROP TABLE IF EXISTS _cmc;
  CREATE TEMP TABLE _cmc ON COMMIT DROP AS
    SELECT c.id, c.name, c.sent_at, c.audiences_json
      FROM public.email_campaigns c
     WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  -- Clics e-mail de la portée (toutes dates : un clic d'avant la période
  -- peut porter un achat de la période, il reste rattaché à SON envoi).
  DROP TABLE IF EXISTS _cmk;
  CREATE TEMP TABLE _cmk ON COMMIT DROP AS
    SELECT ev.campaign_id, lower(ev.recipient_email) AS email, ev.created_at AS at,
           public._crm_is_ticketing_link(ev.metadata->'click'->>'link', v_hosts) AS ticketing
      FROM public.email_campaign_events ev
      JOIN _cmc c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL;
  CREATE INDEX ON _cmk (campaign_id, email);
  CREATE INDEX ON _cmk (email, at);

  -- Billets attribués : dernier clic dans les 7 jours avant l'achat.
  DROP TABLE IF EXISTS _cma;
  CREATE TEMP TABLE _cma ON COMMIT DROP AS
    SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, k.campaign_id
      FROM public._crm_tickets(p_venue_id, p_organizer_user_id) t
      JOIN _cmk k ON k.email = t.email AND k.at <= t.bought_at AND k.at > t.bought_at - interval '7 days'
     ORDER BY t.id, k.at DESC;
  CREATE INDEX ON _cma (campaign_id, email);

  DROP TABLE IF EXISTS _cm0;
  CREATE TEMP TABLE _cm0 ON COMMIT DROP AS
    SELECT r.campaign_id, 'email'::text AS channel, lower(r.email) AS email, c.sent_at,
           EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email)) AS clicked,
           EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email) AND k.ticketing) AS ticketing,
           COALESCE((SELECT sum(a.amount) FROM _cma a WHERE a.campaign_id = r.campaign_id AND a.email = lower(r.email)), 0) AS revenue
      FROM public.email_campaign_recipients r
      JOIN _cmc c ON c.id = r.campaign_id
     WHERE r.status IN ('sent', 'complained')
       AND c.sent_at >= p_from AND c.sent_at < p_to;

  -- SMS reçus, rattachés à la personne par son numéro.
  INSERT INTO _cm0 (campaign_id, channel, email, sent_at, clicked, ticketing, revenue)
  SELECT r.campaign_id, 'sms', p.email, COALESCE(s.sent_at, r.sent_at), false, false, 0
    FROM public.sms_campaign_recipients r
    JOIN public.sms_campaigns s ON s.id = r.campaign_id
    JOIN _cp p ON p.phone IS NOT NULL
             AND regexp_replace(p.phone, '\D', '', 'g') = regexp_replace(r.phone_e164, '\D', '', 'g')
   WHERE r.status::text IN ('sent', 'delivered')
     AND s.venue_id IS NOT DISTINCT FROM p_venue_id
     AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND COALESCE(s.sent_at, r.sent_at) >= p_from AND COALESCE(s.sent_at, r.sent_at) < p_to;

  DROP TABLE IF EXISTS _cm;
  CREATE TEMP TABLE _cm ON COMMIT DROP AS SELECT m.*, m.revenue > 0 AS bought FROM _cm0 m;
  CREATE INDEX ON _cm (email);
  SELECT count(*) INTO v_n FROM _cm;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_night_capacity(p_left integer, p_deals jsonb, p_sold bigint)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_left IS NOT NULL AND p_left >= 0 THEN (COALESCE(p_sold, 0) + p_left)::integer
    ELSE (SELECT CASE WHEN count(*) > 0 AND count(*) = count(*) FILTER (WHERE d->>'quantity' ~ '^[0-9]+$')
                      THEN sum((d->>'quantity')::integer)::integer END
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_deals) = 'array' THEN p_deals ELSE '[]'::jsonb END) d)
  END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_night_date(p_ts timestamp with time zone, p_tz text, p_end_hour integer)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT ((p_ts AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'Europe/Paris')) - make_interval(hours => COALESCE(p_end_hour, 6)))::date;
$function$;

CREATE OR REPLACE FUNCTION public._crm_night_series(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT NULLIF(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(COALESCE(p_name, ''),
               '\s*[-–—:|·,]?\s*\(?\d{1,2}[./]\d{1,2}([./]\d{2,4})?\)?\s*$', ''),
             '\s*[-–—:|·,]?\s*([#№]\s*\d+|(vol|n°|no|ep|episode|chapitre|chapter|part|partie|edition|édition)\.?\s*\d+)\s*$', '', 'i'),
           '\s+', ' ', 'g')), '');
$function$;

CREATE OR REPLACE FUNCTION public._crm_null_money(j jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_keys text[] := ARRAY['revenue', 'prev_revenue', 'attributed_revenue', 'spent', 'amount'];
  v_idx int[];
  v_out jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(j) = 'object' THEN
    -- Tableau positionnel (export : columns + rows).
    IF j ? 'columns' AND j ? 'rows' AND jsonb_typeof(j->'columns') = 'array' AND jsonb_typeof(j->'rows') = 'array' THEN
      SELECT array_agg((c.ord - 1)::int) INTO v_idx
        FROM jsonb_array_elements_text(j->'columns') WITH ORDINALITY c(name, ord) WHERE c.name = ANY (v_keys);
      IF v_idx IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg((SELECT jsonb_agg(CASE WHEN (e.ord - 1)::int = ANY (v_idx) THEN 'null'::jsonb ELSE e.val END ORDER BY e.ord)
                                     FROM jsonb_array_elements(r.val) WITH ORDINALITY e(val, ord)) ORDER BY r.ord), '[]'::jsonb)
          INTO v_out FROM jsonb_array_elements(j->'rows') WITH ORDINALITY r(val, ord);
        RETURN jsonb_set(j, '{rows}', v_out);
      END IF;
    END IF;
    SELECT COALESCE(jsonb_object_agg(e.key, CASE WHEN e.key = ANY (v_keys) THEN 'null'::jsonb ELSE public._crm_null_money(e.value) END), '{}'::jsonb)
      INTO v_out FROM jsonb_each(j) e;
    RETURN v_out;
  ELSIF jsonb_typeof(j) = 'array' THEN
    SELECT COALESCE(jsonb_agg(public._crm_null_money(a.value) ORDER BY a.ord), '[]'::jsonb)
      INTO v_out FROM jsonb_array_elements(j) WITH ORDINALITY a(value, ord);
    RETURN v_out;
  END IF;
  RETURN j;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_segment_counts_write(p_venue_id text, p_organizer_user_id uuid, p_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_seg record;
  v_n integer;
  v_r integer;
BEGIN
  FOR v_seg IN SELECT * FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE p.email_ok OR p.phone_ok) FROM _cp p WHERE %s',
                   public._crm_filter_sql(v_seg.def, 'p'))
      INTO v_n, v_r;
    INSERT INTO public.crm_segment_counts (scope_key, seg_key, day, n, reachable, computed_at)
    VALUES (v_scope, v_seg.seg_key, p_day, v_n, v_r, now())
    ON CONFLICT (scope_key, seg_key, day) DO UPDATE SET n = EXCLUDED.n, reachable = EXCLUDED.reachable, computed_at = now();
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_segment_defs(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(seg_key text, kind text, name text, description text, template text, def jsonb, created_at timestamp with time zone, sort integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT x.k, 'auto', NULL::text, NULL::text, NULL::text, jsonb_build_object('seg', x.k), NULL::timestamptz, x.o
    FROM (VALUES ('hab', 1), ('occ', 2), ('nou', 3), ('end', 4), ('none', 5)) AS x(k, o)
  UNION ALL
  SELECT s.id::text, 'custom', s.name, s.description, s.template, s.definition, s.created_at,
         100 + row_number() OVER (ORDER BY s.created_at)::integer
    FROM public.crm_segments s
   WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public._crm_send_target(p_aud jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_aud IS NULL OR jsonb_typeof(p_aud) <> 'array' OR jsonb_array_length(p_aud) = 0 THEN 'all'
    WHEN jsonb_array_length(p_aud) > 1 THEN 'custom'
    WHEN p_aud->0->>'kind' = 'crm' AND p_aud->0->>'segmentId' ~ '^[0-9a-f-]{36}$' THEN p_aud->0->>'segmentId'
    WHEN p_aud->0->>'kind' = 'crm'
         AND COALESCE(p_aud->0->'def'->>'seg', 'all') IN ('hab', 'occ', 'nou', 'end', 'none')
         AND COALESCE(p_aud->0->'def'->'f', '{}'::jsonb) = '{}'::jsonb
         AND COALESCE(p_aud->0->'def'->>'q', '') = '' THEN p_aud->0->'def'->>'seg'
    WHEN p_aud->0->>'kind' IN ('all', 'everyone') THEN 'all'
    WHEN p_aud->0->>'kind' = 'crm'
         AND COALESCE(p_aud->0->'def'->>'seg', 'all') = 'all'
         AND COALESCE(p_aud->0->'def'->'f', '{}'::jsonb) = '{}'::jsonb
         AND COALESCE(p_aud->0->'def'->>'q', '') = '' THEN 'all'
    ELSE 'custom' END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_signup_close_at(p crm_signup_pages)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE p.closes_mode
    WHEN 'date' THEN p.closes_at
    WHEN 'sale' THEN p.sale_opens_at
    WHEN 'eve' THEN CASE WHEN p.event_id IS NOT NULL THEN public._crm_signup_night_at(p.event_id, 1, time '18:00') END
    WHEN 'manual' THEN CASE WHEN p.notified_at IS NOT NULL THEN p.notified_at END
    ELSE NULL END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_signup_event(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
           'id', e.id, 'title', e.title, 'start_at', e.start_at,
           'end_at', COALESCE(e.end_at, e.start_at + interval '6 hours'),
           'tz', COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'),
           'ticket_url', COALESCE(e.external_ticket_url, CASE WHEN e.external_source IS NULL THEN 'https://yunoapp.eu/event/' || e.id END),
           'cover_url', COALESCE(e.poster_url, e.image_url, x.cover_url),
           'venue', COALESCE(NULLIF(e.location_name, ''), (SELECT v.name FROM public.venues v WHERE v.id = e.venue_id)),
           'city', COALESCE(x.city, e.location_city),
           'street', COALESCE(x.street, e.location_address),
           'country', x.country_code,
           'sold_out', COALESCE(e.tickets_sold_out, false) OR COALESCE(x.left_tickets = 0, false),
           'night_date', ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')::date)
    FROM public.events e
    LEFT JOIN public.external_events x ON x.event_id = e.id
   WHERE e.id = p_event_id;
$function$;

CREATE OR REPLACE FUNCTION public._crm_signup_night_at(p_event_id uuid, p_days_before integer, p_time time without time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ((((e.start_at AT TIME ZONE z.tz) - interval '8 hours')::date - p_days_before) + p_time) AT TIME ZONE z.tz
    FROM public.events e
   CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris') AS tz) z
   WHERE e.id = p_event_id;
$function$;

CREATE OR REPLACE FUNCTION public._crm_signup_owner(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND COALESCE(CASE WHEN p_venue_id IS NOT NULL
    THEN EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = auth.uid())
    ELSE p_organizer_user_id = auth.uid() END, false);
$function$;

CREATE OR REPLACE FUNCTION public._crm_signup_state(p crm_signup_pages)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p.status = 'draft' THEN 'draft'
    WHEN p.status = 'closed' THEN 'closed'
    WHEN public._crm_signup_close_at(p) IS NOT NULL AND public._crm_signup_close_at(p) <= now() THEN 'closed'
    WHEN p.opens_at IS NOT NULL AND p.opens_at > now() THEN 'scheduled'
    ELSE 'open' END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_ticket_gl_kind(p_status text, p_price numeric, p_raw jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_status IS DISTINCT FROM 'valid' THEN NULL
    -- Un duplicata est la copie d'un billet existant : ni vente, ni guest list.
    WHEN jsonb_typeof(p_raw) = 'object' AND p_raw->>'deal_channel' = 'duplicata' THEN NULL
    WHEN jsonb_typeof(p_raw) = 'object' AND p_raw->>'deal_channel' = 'invitation' THEN 'inv'
    WHEN p_price = 0 THEN 'free'
  END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_ticket_is_sale(p_status text, p_raw jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- Ni une invitation, ni un duplicata (copie d'un billet déjà vendu).
  SELECT p_status = 'valid' AND COALESCE(p_raw->>'deal_channel', '') NOT IN ('invitation', 'duplicata');
$function$;

CREATE OR REPLACE FUNCTION public._crm_ticket_source(p_utm jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN s = '' THEN 'of'
    WHEN s = 'yuno' OR s LIKE 'yuno-m-%' THEN 'em'
    WHEN s LIKE 'yuno-s-%' THEN 'sm'
    WHEN s LIKE 'yuno-d-%' THEN 'dm'
    WHEN s LIKE 'yuno-%' THEN COALESCE((
      SELECT CASE
               WHEN tl.utm_source = 'instagram' AND tl.utm_medium = 'story' THEN 'ys'
               WHEN tl.utm_source = 'instagram' AND tl.utm_medium = 'bio' THEN 'yb'
               WHEN tl.utm_source = 'tiktok' AND tl.utm_medium = 'bio' THEN 'yt'
             END
        FROM public.tracked_links tl WHERE lower(tl.code) = substr(s, 6) LIMIT 1), 'yl')
    WHEN s = 'shotgun' THEN 'sg'
    WHEN s = 'direct' THEN 'di'
    WHEN s IN ('instagram', 'ig', 'facebook', 'fb', 'tiktok', 'snapchat', 'twitter', 'x', 'threads', 'linkedin', 'youtube', 'pinterest', 'messenger') THEN 'so'
    ELSE 'au' END
  FROM (SELECT lower(btrim(COALESCE(CASE WHEN jsonb_typeof(p_utm) = 'object' THEN p_utm->>'utm_source' END, ''))) AS s) x;
$function$;

CREATE OR REPLACE FUNCTION public._crm_tickets(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(id uuid, email text, qty integer, amount numeric, bought_at timestamp with time zone, event_id uuid, event_start timestamp with time zone, scanned_at timestamp with time zone, deal_name text, price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, lower(t.buyer_email), GREATEST(t.quantity, 1),
         COALESCE(t.price, 0) * GREATEST(t.quantity, 1),
         COALESCE(t.purchased_at, t.first_seen_at),
         t.event_id, e.start_at, t.scanned_at, t.deal_name, t.price
    FROM public.external_tickets t
    LEFT JOIN public.events e ON e.id = t.event_id
   WHERE public._crm_ticket_is_sale(t.status, t.raw)
     AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id));
$function$;

CREATE OR REPLACE FUNCTION public._door_headcount(p_event_ids uuid[], p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT tk.id, tk.quantity, tk.entry_scanned, tk.entry_scanned_at,
           EXISTS (SELECT 1 FROM public.ticket_attendees a WHERE a.ticket_id = tk.id) AS nominative
      FROM public.tickets tk
     WHERE tk.event_id = ANY(p_event_ids) AND tk.status = 'paid'
  ), gle AS (
    SELECT g.entry_scanned, g.entry_scanned_at
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id = ANY(p_event_ids) AND g.status IS DISTINCT FROM 'cancelled'
  ), tr AS (
    SELECT GREATEST(COALESCE(r.guest_count, 1), 1) AS guests, r.entry_scanned, r.entry_scanned_at
      FROM public.table_reservations r
     WHERE r.event_id = ANY(p_event_ids) AND r.status = 'paid'
  )
  SELECT jsonb_build_object(
    'entered',
      (SELECT count(*) FROM public.ticket_attendees a JOIN t ON t.id = a.ticket_id
        WHERE a.entry_scanned AND (p_since IS NULL OR a.entry_scanned_at >= p_since))
    + (SELECT COALESCE(sum(t.quantity), 0) FROM t
        WHERE NOT t.nominative AND t.entry_scanned AND (p_since IS NULL OR t.entry_scanned_at >= p_since))
    + (SELECT COALESCE(sum(tr.guests), 0) FROM tr
        WHERE tr.entry_scanned AND (p_since IS NULL OR tr.entry_scanned_at >= p_since))
    + (SELECT count(*) FROM gle
        WHERE gle.entry_scanned AND (p_since IS NULL OR gle.entry_scanned_at >= p_since)),
    'expected',
      (SELECT COALESCE(sum(t.quantity), 0) FROM t)
    + (SELECT COALESCE(sum(tr.guests), 0) FROM tr)
    + (SELECT count(*) FROM gle)
  )
$function$;

CREATE OR REPLACE FUNCTION public._email_automation_enabled(p_venue_id text, p_organizer_user_id uuid, p_kind text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.email_automations a
     WHERE a.kind = p_kind AND a.enabled
       AND ((p_venue_id IS NOT NULL AND a.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND a.organizer_user_id = p_organizer_user_id))
  );
$function$;

CREATE OR REPLACE FUNCTION public._email_automation_next_event(p_venue_id text, p_organizer_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT e.id
    FROM public.events e
   WHERE e.status = 'active'
     AND (e.is_active OR e.external_source IS NOT NULL)
     AND e.cancelled_at IS NULL
     AND e.start_at > now()
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
   ORDER BY e.start_at ASC
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public._email_automation_suggestions(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  out jsonb := '[]'::jsonb;
  v_base integer := 0;
  n integer;
  v_event_id uuid;
  v_title text;
  v_start timestamptz;
  v_pct integer;
BEGIN
  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN RETURN out; END IF;
  -- La démo n'est pas un chiffre.
  IF p_venue_id IS NOT NULL AND p_venue_id = ANY (public.demo_venue_ids()) THEN RETURN out; END IF;
  IF p_organizer_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_organizer_user_id AND public.is_demo_email(p.email)
  ) THEN RETURN out; END IF;

  SELECT count(*) INTO v_base
    FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL;

  -- Panier abandonné : ≥ 3 paiements commencés et jamais finis sur 30 j.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'abandoned_checkout') THEN
    SELECT count(*) INTO n FROM (
      SELECT DISTINCT lower(x.em), x.event_id FROM (
        SELECT t.user_email AS em, t.event_id FROM public.tickets t JOIN public.events e ON e.id = t.event_id
         WHERE t.status = 'pending' AND t.user_email IS NOT NULL AND t.created_at >= now() - interval '30 days'
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        UNION ALL
        SELECT r.user_email, r.event_id FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
         WHERE r.status = 'pending' AND r.user_email IS NOT NULL AND r.created_at >= now() - interval '30 days'
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
      ) x
      WHERE NOT public._email_event_holder(x.event_id, x.em)
    ) y;
    IF n >= 3 THEN
      out := out || jsonb_build_object('kind', 'abandoned_checkout', 'reason_key', 'em.auto.sug.abandoned',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Dernier appel : prochaine soirée sous 10 j qui vend encore, base ≥ 50.
  IF v_base >= 50 AND NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'last_call') THEN
    SELECT e.id, e.title, e.start_at INTO v_event_id, v_title, v_start
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '2 hours' AND e.start_at <= now() + interval '10 days'
       AND (((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out) OR (e.tables_enabled AND NOT e.tables_sold_out)
            OR (NOT e.guest_list_sold_out AND EXISTS (SELECT 1 FROM public.guest_lists gl WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out)))
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(*) INTO n FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL AND NOT public._email_event_holder(v_event_id, s.email);
      out := out || jsonb_build_object('kind', 'last_call', 'reason_key', 'em.auto.sug.lastCall',
               'reason_vars', jsonb_build_object('event', v_title, 'd', GREATEST(0, floor(extract(epoch FROM (v_start - now())) / 86400))::integer, 'n', n),
               'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Passe en table : prochaine soirée avec tables libres et ≥ 20 billets vendus.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'table_upsell') THEN
    v_event_id := NULL;
    SELECT e.id, e.title INTO v_event_id, v_title
      FROM public.events e
      JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.tables_enabled AND NOT e.tables_sold_out AND COALESCE(tl.n, 0) > 0
       AND e.start_at > now() + interval '2 hours'
       AND (SELECT count(DISTINCT lower(t.user_email)) FROM public.tickets t WHERE t.event_id = e.id AND t.status IN ('paid', 'used')) >= 20
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(DISTINCT lower(t.user_email)) INTO n FROM public.tickets t
       WHERE t.event_id = v_event_id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = v_event_id AND lower(r.user_email) = lower(t.user_email) AND r.status IN ('paid', 'used', 'confirmed', 'pending'));
      out := out || jsonb_build_object('kind', 'table_upsell', 'reason_key', 'em.auto.sug.tableUpsell',
               'reason_vars', jsonb_build_object('event', v_title, 'n', n), 'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Nouvelle soirée : ≥ 1 soirée publiée sur 30 j sans aucune campagne reliée.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'new_event') THEN
    SELECT count(*) INTO n FROM public.events e
     WHERE e.status = 'active' AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.published_at >= now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM public.email_campaigns c WHERE c.event_id = e.id
                         AND public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id));
    IF n >= 1 THEN
      out := out || jsonb_build_object('kind', 'new_event', 'reason_key', 'em.auto.sug.newEvent',
               'reason_vars', jsonb_build_object('n', n), 'reach', v_base);
    END IF;
  END IF;

  -- Merci / On t'a manqué : ≥ 1 soirée passée avec scans sur 30 j.
  SELECT count(*) INTO n FROM public.events e
   WHERE e.status = 'active' AND e.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
     AND (EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)))
       OR EXISTS (SELECT 1 FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id AND ge.entry_scanned)
       OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = e.id AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL))
         OR EXISTS (SELECT 1 FROM public.external_tickets xt WHERE xt.event_id = e.id AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')));
  IF n >= 1 THEN
    IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'post_event_thanks') THEN
      out := out || jsonb_build_object('kind', 'post_event_thanks', 'reason_key', 'em.auto.sug.thanks',
               'reason_vars', jsonb_build_object('n', n), 'reach', (
                 SELECT count(DISTINCT em) FROM (
                   SELECT lower(t.user_email) AS em FROM public.tickets t JOIN public.events e ON e.id = t.event_id
                    WHERE (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)) AND t.user_email IS NOT NULL
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                   UNION
                   SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
                    WHERE ge.entry_scanned AND ge.email IS NOT NULL
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                   UNION
                   SELECT lower(xt.buyer_email) FROM public.external_tickets xt JOIN public.events e ON e.id = xt.event_id
                    WHERE xt.scanned_at IS NOT NULL AND xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                 ) c));
    END IF;
    IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'post_event_missed') THEN
      out := out || jsonb_build_object('kind', 'post_event_missed', 'reason_key', 'em.auto.sug.missed',
               'reason_vars', jsonb_build_object('n', n), 'reach', (
                 SELECT count(DISTINCT lower(t.user_email)) FROM public.tickets t JOIN public.events e ON e.id = t.event_id
                  WHERE t.status = 'paid' AND NOT t.used AND NOT COALESCE(t.entry_scanned, false) AND t.user_email IS NOT NULL
                    AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                    AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))));
    END IF;
  END IF;

  -- L'habitué décroche : ≥ 3 habitués (deux sorties par mois) silencieux
  -- depuis six semaines, que personne n'a encore relancés.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'regular_lapse') THEN
    SELECT count(*) INTO n
      FROM public._regular_lapse_candidates(p_venue_id, p_organizer_user_id, interval '42 days') r
     WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                    WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
                      AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id));
    IF n >= 3 THEN
      out := out || jsonb_build_object('kind', 'regular_lapse', 'reason_key', 'em.auto.sug.regularLapse',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Reconquête : ≥ 30 clients silencieux depuis 60 j (dernière venue entre 60 et 240 j).
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'win_back') THEN
    SELECT count(*) INTO n
      FROM public.newsletter_subscriptions s
      JOIN LATERAL (
        SELECT max(x.at) AS last_at FROM (
          SELECT t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE lower(t.user_email) = lower(s.email) AND t.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT ge.entry_scanned_at FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
           WHERE lower(ge.email) = lower(s.email) AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
           WHERE lower(xt.buyer_email) = lower(s.email) AND xt.status IN ('valid', 'transferred')
             AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
        ) x
      ) act ON true
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND act.last_at IS NOT NULL
       AND act.last_at <= now() - interval '60 days'
       AND act.last_at > now() - interval '240 days';
    IF n >= 30 THEN
      out := out || jsonb_build_object('kind', 'win_back', 'reason_key', 'em.auto.sug.winBack',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Bienvenue : ≥ 10 nouvelles inscriptions sur 30 j (hors imports, checkout, plateforme).
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'welcome') THEN
    SELECT count(*) INTO n FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL AND s.import_id IS NULL
       AND COALESCE(s.source, '') NOT LIKE 'import%' AND COALESCE(s.source, '') NOT LIKE 'platform%' AND COALESCE(s.source, '') NOT LIKE 'checkout%' AND COALESCE(s.source, '') NOT LIKE 'connector%'
       AND s.created_at >= now() - interval '30 days';
    IF n >= 10 THEN
      out := out || jsonb_build_object('kind', 'welcome', 'reason_key', 'em.auto.sug.welcome',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Le tarif monte : une soirée en paliers dont le palier ouvert dépasse 70 %, avec un palier plus cher ensuite.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'tier_closing') THEN
    v_event_id := NULL;
    SELECT e.id, e.title, cur.pct INTO v_event_id, v_title, v_pct
      FROM public.events e
      JOIN LATERAL (
        SELECT r.position, r.price, (r.tickets_sold * 100 / r.max_tickets)::integer AS pct
          FROM public.ticket_rounds r
         WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
           AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
           AND r.tickets_sold * 100 >= r.max_tickets * 70
         ORDER BY r.position LIMIT 1
      ) cur ON true
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
       AND e.ticketing_enabled AND NOT e.tickets_sold_out
       AND e.start_at > now() + interval '2 hours'
       AND EXISTS (SELECT 1 FROM public.ticket_rounds nx WHERE nx.event_id = e.id AND nx.position > cur.position AND nx.price > cur.price AND NOT nx.manually_sold_out AND nx.tickets_sold < nx.max_tickets)
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(*) INTO n FROM (
        SELECT lower(x.recipient_email) AS em
          FROM public.email_campaigns c JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
         WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND x.created_at > now() - interval '60 days' AND x.recipient_email IS NOT NULL
           AND (c.event_id = v_event_id OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || v_event_id::text || '%')
        UNION
        SELECT lower(w.email) FROM public.event_waitlist w WHERE w.event_id = v_event_id AND w.email IS NOT NULL
      ) i WHERE NOT public._email_event_holder(v_event_id, i.em);
      out := out || jsonb_build_object('kind', 'tier_closing', 'reason_key', 'em.auto.sug.tier',
               'reason_vars', jsonb_build_object('event', v_title, 'p', v_pct), 'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Les plus larges d'abord.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'reach')::integer DESC), '[]'::jsonb) INTO out
    FROM jsonb_array_elements(out) x;
  RETURN out;
END;
$function$;

CREATE OR REPLACE FUNCTION public._email_blocks_without_live(p_blocks jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_agg(b) FROM jsonb_array_elements(COALESCE(p_blocks, '[]'::jsonb)) b
      WHERE COALESCE(b->>'type', '') NOT IN ('event', 'tickets', 'guestlist', 'table', 'countdown', 'lineup')),
    '[]'::jsonb
  )
$function$;

CREATE OR REPLACE FUNCTION public._email_engagement_rank(p_email text, p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- (a) a ouvert ou cliqué un email marketing sous 90 j (tous expéditeurs).
    WHEN EXISTS (
      SELECT 1 FROM public.email_campaign_events ev
       WHERE lower(ev.recipient_email) = lower(p_email)
         AND ev.event_type IN ('opened', 'clicked')
         AND ev.created_at > now() - interval '90 days'
    ) THEN 0
    -- (b) est venu sous 180 j : billet payé, table payée ou scan de liste invités, dans la portée.
    WHEN EXISTS (
      SELECT 1 FROM public.tickets t JOIN public.events e ON e.id = t.event_id
       WHERE lower(t.user_email) = lower(p_email) AND t.status IN ('paid', 'used')
         AND t.created_at > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
    ) OR EXISTS (
      SELECT 1 FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
       WHERE lower(r.user_email) = lower(p_email) AND r.status IN ('paid', 'used')
         AND r.created_at > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
    ) OR EXISTS (
      SELECT 1 FROM public.guest_list_entries ge
        JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
        JOIN public.events e ON e.id = gl.event_id
       WHERE lower(ge.email) = lower(p_email) AND ge.entry_scanned
         AND ge.entry_scanned_at > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
    ) OR EXISTS (
      SELECT 1 FROM public.external_tickets xt
       WHERE lower(xt.buyer_email) = lower(p_email) AND xt.status IN ('valid', 'transferred')
         AND COALESCE(xt.purchased_at, xt.first_seen_at) > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
    ) THEN 1
    -- (c) inscrit au registre de la portée sous 30 j.
    WHEN EXISTS (
      SELECT 1 FROM public.newsletter_subscriptions s
       WHERE lower(s.email) = lower(p_email)
         AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.created_at > now() - interval '30 days'
    ) THEN 2
    ELSE 3
  END;
$function$;

CREATE OR REPLACE FUNCTION public._email_engagement_ranks(p_emails text[], p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(email text, rnk integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH e AS (
    SELECT DISTINCT lower(x) AS em FROM unnest(p_emails) AS x WHERE x IS NOT NULL
  ),
  r0 AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '90 days'
       AND lower(ev.recipient_email) IN (SELECT em FROM e)
  ),
  r1 AS (
    SELECT lower(t.user_email) AS em
      FROM public.tickets t JOIN public.events ev ON ev.id = t.event_id
     WHERE t.status IN ('paid', 'used') AND t.created_at > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND lower(t.user_email) IN (SELECT em FROM e)
    UNION
    SELECT lower(r.user_email)
      FROM public.table_reservations r JOIN public.events ev ON ev.id = r.event_id
     WHERE r.status IN ('paid', 'used') AND r.created_at > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND lower(r.user_email) IN (SELECT em FROM e)
    UNION
    SELECT lower(ge.email)
      FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
      JOIN public.events ev ON ev.id = gl.event_id
     WHERE ge.entry_scanned AND ge.entry_scanned_at > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND lower(ge.email) IN (SELECT em FROM e)
    UNION
    SELECT lower(xt.buyer_email)
      FROM public.external_tickets xt
     WHERE xt.status IN ('valid', 'transferred')
       AND COALESCE(xt.purchased_at, xt.first_seen_at) > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
       AND lower(xt.buyer_email) IN (SELECT em FROM e)
  ),
  r2 AS (
    SELECT DISTINCT lower(s.email) AS em
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.created_at > now() - interval '30 days'
       AND lower(s.email) IN (SELECT em FROM e)
  )
  SELECT e.em,
         CASE WHEN r0.em IS NOT NULL THEN 0
              WHEN r1.em IS NOT NULL THEN 1
              WHEN r2.em IS NOT NULL THEN 2
              ELSE 3 END
    FROM e
    LEFT JOIN r0 ON r0.em = e.em
    LEFT JOIN (SELECT DISTINCT em FROM r1) r1 ON r1.em = e.em
    LEFT JOIN r2 ON r2.em = e.em;
$function$;

CREATE OR REPLACE FUNCTION public._email_event_holder(p_event_id uuid, p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.tickets t
                  WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = lower(p_email))
      OR EXISTS (SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed', 'used') AND lower(r.user_email) = lower(p_email))
      OR EXISTS (SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = p_event_id AND lower(ge.email) = lower(p_email)
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected'))
      OR EXISTS (SELECT 1 FROM public.external_tickets xt
                  WHERE xt.event_id = p_event_id AND xt.status IN ('valid', 'transferred') AND lower(xt.buyer_email) = lower(p_email));
$function$;

CREATE OR REPLACE FUNCTION public._email_scope_guard(p_venue_id text, p_organizer_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT COALESCE(public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin(), false) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT COALESCE(p_organizer_user_id = auth.uid() OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin') OR public.is_super_admin(), false) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._email_send_policy_many(p_emails text[], p_kind text)
 RETURNS TABLE(email text, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH e AS (
    SELECT DISTINCT lower(x) AS em FROM unnest(p_emails) AS x WHERE x IS NOT NULL
  ),
  cfg AS (
    SELECT k.tier,
           CASE k.tier WHEN 'campaign' THEN 3 WHEN 'urgent' THEN 2 ELSE 1 END AS cap24,
           CASE k.tier WHEN 'campaign' THEN 8 WHEN 'urgent' THEN 5 ELSE 3 END AS cap7
      FROM (SELECT CASE
              WHEN p_kind IN ('campaign', 'resend') THEN 'campaign'
              WHEN p_kind IN ('abandoned_checkout', 'upsell', 'tier_closing', 'click_no_buy') THEN 'urgent'
              ELSE 'automation' END AS tier) k
  ),
  sends AS (
    SELECT lower(r.email) AS em, r.sent_at
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
     WHERE r.status = 'sent' AND r.sent_at > now() - interval '90 days'
       AND COALESCE(c.type, 'promotional') = 'promotional'
       AND lower(r.email) IN (SELECT em FROM e)
    UNION ALL
    SELECT lower(l.email), l.sent_at
      FROM public.marketing_email_log l
     WHERE l.sent_at > now() - interval '90 days'
       AND lower(l.email) IN (SELECT em FROM e)
  ),
  agg AS (
    SELECT s.em,
           count(*) FILTER (WHERE s.sent_at > now() - interval '24 hours') AS n24,
           count(*) FILTER (WHERE s.sent_at > now() - interval '7 days') AS n7d,
           count(*) AS sent90
      FROM sends s
     GROUP BY s.em
  ),
  eng AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '90 days'
       AND lower(ev.recipient_email) IN (SELECT em FROM e)
  ),
  oo AS (
    SELECT lower(s.email) AS em, count(*) AS n
      FROM public.newsletter_subscriptions s
     WHERE s.opted_out_at > now() - interval '30 days'
       AND lower(s.email) IN (SELECT em FROM e)
     GROUP BY lower(s.email)
  ),
  sup AS (
    SELECT DISTINCT lower(s.email) AS em
      FROM public.email_suppressions s
     WHERE lower(s.email) IN (SELECT em FROM e)
  )
  SELECT e.em,
         CASE
           WHEN position('@' in e.em) <= 1 THEN 'suppressed'
           WHEN sup.em IS NOT NULL THEN 'suppressed'
           WHEN COALESCE(a.sent90, 0) >= 8 AND eng.em IS NULL THEN 'fatigue'
           WHEN cfg.tier <> 'campaign' AND COALESCE(oo.n, 0) >= 2 THEN 'averse'
           WHEN COALESCE(a.n24, 0) >= cfg.cap24 THEN 'pressure_24h'
           WHEN COALESCE(a.n7d, 0) >= cfg.cap7 THEN 'pressure_7d'
         END
    FROM e
    CROSS JOIN cfg
    LEFT JOIN agg a ON a.em = e.em
    LEFT JOIN eng ON eng.em = e.em
    LEFT JOIN oo ON oo.em = e.em
    LEFT JOIN sup ON sup.em = e.em;
$function$;

CREATE OR REPLACE FUNCTION public._event_tables_left(p_event_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH e AS (
    SELECT id, COALESCE(venue_id, partner_venue_id) AS vid, COALESCE(sold_out_pack_ids, '{}'::uuid[]) AS closed
      FROM public.events WHERE id = p_event_id
  ),
  total AS (
    SELECT COALESCE(sum(p.tables_count), 0)::integer AS n
      FROM public.table_packs p, e
     WHERE p.is_active
       AND (p.event_id = e.id OR (p.event_id IS NULL AND e.vid IS NOT NULL AND p.venue_id = e.vid))
       AND NOT (p.id = ANY (e.closed))
  ),
  taken AS (
    SELECT count(*)::integer AS n FROM public.table_reservations r
     WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed')
  )
  SELECT CASE WHEN (SELECT n FROM total) <= 0 THEN NULL
              ELSE GREATEST(0, (SELECT n FROM total) - (SELECT n FROM taken)) END;
$function$;

CREATE OR REPLACE FUNCTION public._link_base(p_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(rtrim(regexp_replace(regexp_replace(lower(btrim(COALESCE(p_url, ''))), '^https?://(www\.)?', ''), '[?#].*$', ''), '/'), '');
$function$;

CREATE OR REPLACE FUNCTION public._mcp_access(p_access_hash text)
 RETURNS TABLE(grant_id uuid, user_id uuid, level text, client_name text, spaces text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT g.id, g.user_id, g.level, g.client_name, g.spaces
    FROM public.mcp_tokens t
    JOIN public.mcp_grants g ON g.id = t.grant_id
    JOIN auth.users u ON u.id = g.user_id
    LEFT JOIN public.profiles p ON p.id = g.user_id
   WHERE t.token_hash = p_access_hash AND t.kind = 'access'
     AND t.revoked_at IS NULL AND t.expires_at > now()
     AND g.revoked_at IS NULL
     AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until < now())
     AND NOT coalesce(p.is_suspended, false)
$function$;

CREATE OR REPLACE FUNCTION public._mcp_customer_tool(p_tool text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT p_tool IN ('list_customers', 'list_customers_by_segment', 'get_customer_profile') $function$;

CREATE OR REPLACE FUNCTION public._mcp_draft_version(p_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT (floor(extract(epoch FROM p_at) * 1000000))::bigint::text $function$;

CREATE OR REPLACE FUNCTION public._mcp_email_audience(p_id text, p_product text, p_venue_id text, p_organizer_user_id uuid, p_lang text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id   text := lower(btrim(coalesce(p_id, '')));
  v_i    integer := CASE WHEN p_lang = 'en' THEN 1 WHEN p_lang = 'es' THEN 3 ELSE 2 END;
  v_uuid uuid;
  v_name text;
  v_def  jsonb;
  v_lbl  text[];
BEGIN
  IF p_product = 'crm' THEN
    IF v_id = 'all' THEN
      RETURN (SELECT jsonb_agg(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', k), 'label', lbl[v_i]) ORDER BY o)
                FROM (VALUES (1, 'hab', ARRAY['Regulars', 'Habitués', 'Habituales']),
                             (2, 'occ', ARRAY['Occasional', 'Occasionnels', 'Ocasionales']),
                             (3, 'nou', ARRAY['New', 'Nouveaux', 'Nuevos']),
                             (4, 'end', ARRAY['Dormant', 'Endormis', 'Dormidos']),
                             (5, 'none', ARRAY['Never came', 'Jamais venus', 'Nunca vinieron'])) x(o, k, lbl));
    END IF;
    IF v_id ~ '^lifecycle:(hab|occ|nou|end|none)$' THEN
      v_lbl := CASE split_part(v_id, ':', 2)
        WHEN 'hab' THEN ARRAY['Regulars', 'Habitués', 'Habituales']
        WHEN 'occ' THEN ARRAY['Occasional', 'Occasionnels', 'Ocasionales']
        WHEN 'nou' THEN ARRAY['New', 'Nouveaux', 'Nuevos']
        WHEN 'end' THEN ARRAY['Dormant', 'Endormis', 'Dormidos']
        ELSE ARRAY['Never came', 'Jamais venus', 'Nunca vinieron'] END;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', split_part(v_id, ':', 2)), 'label', v_lbl[v_i]));
    END IF;
    IF v_id ~ '^segment:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_uuid := split_part(v_id, ':', 2)::uuid;
      SELECT s.name INTO v_name FROM public.crm_segments s
       WHERE s.id = v_uuid
         AND ((p_venue_id IS NOT NULL AND s.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id));
      IF NOT FOUND THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'segmentId', v_uuid, 'label', v_name));
    END IF;
    IF v_id ~ '^preset:' THEN
      SELECT d, l INTO v_def, v_lbl FROM (VALUES
        ('preset:vip', '{"seg":"all","f":{"sp":"200+"}}'::jsonb, ARRAY['Big spenders', 'Gros dépensiers', 'Grandes gastadores']),
        ('preset:loyal', '{"seg":"all","f":{"nb_min":4}}'::jsonb, ARRAY['Loyal customers (4 nights or more)', 'Fidèles (4 soirées ou plus)', 'Fieles (4 fiestas o más)']),
        ('preset:buyers', '{"seg":"all","f":{"paid_min":1}}'::jsonb, ARRAY['Ticket buyers', 'Acheteurs de billets', 'Compradores de entradas']),
        ('preset:recent', '{"seg":"all","f":{"last_lt_days":90}}'::jsonb, ARRAY['Came in the last 3 months', 'Venus ces 3 derniers mois', 'Vinieron en los últimos 3 meses']),
        ('preset:lapsed', '{"seg":"all","f":{"last_gt_days":90,"last_lt_days":365}}'::jsonb, ARRAY['To reactivate (3 to 12 months)', 'À réactiver (3 à 12 mois)', 'Por reactivar (3 a 12 meses)']),
        ('preset:has_upcoming', '{"seg":"all","f":{"up":"yes"}}'::jsonb, ARRAY['Already have their place', 'Ont déjà leur place', 'Ya tienen su entrada']),
        ('preset:no_upcoming', '{"seg":"all","f":{"up":"no"}}'::jsonb, ARRAY['No place yet for what’s next', 'Pas encore de place pour la suite', 'Sin entrada aún para lo próximo']),
        ('preset:clickers', '{"seg":"all","f":{"click_lt_days":90}}'::jsonb, ARRAY['Clicked in the last 3 months', 'Ont cliqué ces 3 derniers mois', 'Hicieron clic en los últimos 3 meses']),
        ('preset:gl_loyal', '{"seg":"all","f":{"gl":"loyal"}}'::jsonb, ARRAY['Guest list regulars', 'Habitués de la guest list', 'Habituales de la lista de invitados'])
      ) x(k, d, l) WHERE x.k = v_id;
      IF v_def IS NULL THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'def', v_def, 'label', v_lbl[v_i]));
    END IF;
    RETURN NULL;
  END IF;

  -- Billetterie (Suite) : audiences v2 du moteur d'envoi (resolve_campaign_audience).
  IF v_id IN ('all', 'kind:all_subscribers') THEN RETURN jsonb_build_array(jsonb_build_object('kind', 'all_subscribers')); END IF;
  IF v_id ~ '^kind:(vip|big_spenders|regulars|new_customers|dormant)$' THEN
    RETURN jsonb_build_array(jsonb_build_object('kind', split_part(v_id, ':', 2)));
  END IF;
  IF v_id ~ '^(segment|contact_segment|import):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := split_part(v_id, ':', 2)::uuid;
    IF v_id LIKE 'segment:%' THEN
      IF p_venue_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.venue_segments s WHERE s.id = v_uuid AND s.venue_id = p_venue_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'segment', 'segmentId', v_uuid));
    ELSIF v_id LIKE 'contact_segment:%' THEN
      IF NOT EXISTS (SELECT 1 FROM public.contact_segments s WHERE s.id = v_uuid
                      AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'contact_segment', 'segmentId', v_uuid));
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.email_list_imports i WHERE i.id = v_uuid AND i.superseded_at IS NULL
                      AND i.venue_id IS NOT DISTINCT FROM p_venue_id AND i.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'import', 'importId', v_uuid));
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_email_event_facts(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  e        public.events%ROWTYPE;
  v_vname  text;
  v_vcity  text;
  v_tz     text;
  v_host   text;
  v_tiers  jsonb;
  v_ext    record;
  v_lineup jsonb;
  v_gl     record;
  v_left   integer;
  v_packs  jsonb;
  v_out    jsonb;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT v.name, v.city INTO v_vname, v_vcity FROM public.venues v WHERE v.id = coalesce(e.venue_id, e.partner_venue_id);
  v_tz := coalesce(nullif(btrim(e.timezone), ''), 'Europe/Paris');

  SELECT coalesce(jsonb_agg(a ORDER BY ord), '[]'::jsonb) INTO v_lineup
    FROM public.get_event_lineup_live(ARRAY[e.id]) l,
         jsonb_array_elements(coalesce(l.artists, '[]'::jsonb)) WITH ORDINALITY AS x(a, ord);

  v_out := jsonb_build_object(
    'id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at, 'timezone', v_tz,
    'local_start', to_char(e.start_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI'),
    'weekday_iso', extract(isodow FROM e.start_at AT TIME ZONE v_tz)::integer,
    'venue', coalesce(nullif(concat_ws(' — ', coalesce(v_vname, e.location_name), coalesce(v_vcity, e.location_city)), ''), NULL),
    'poster_url', coalesce(e.poster_url, e.image_url),
    'lineup', v_lineup,
    'music_genres', to_jsonb(e.music_genres),
    'description', left(coalesce(e.description, ''), 600));

  IF e.external_source IS NOT NULL THEN
    SELECT * INTO v_ext FROM public.get_external_event_live(ARRAY[e.id]) LIMIT 1;
    RETURN v_out || jsonb_build_object(
      'sales', 'external', 'ticketing', e.external_source,
      'ticket_url', coalesce(v_ext.ticket_url, e.external_ticket_url),
      'sold_out', coalesce(v_ext.sold_out, e.tickets_sold_out, false),
      'venue', coalesce(nullif(v_ext.venue_label, ''), v_out->>'venue'),
      'tiers', coalesce((SELECT jsonb_agg(jsonb_build_object('name', d->>'name', 'price', (d->>'price')::numeric,
                                   'sold_out', coalesce((d->>'out')::boolean, false)))
                           FROM jsonb_array_elements(coalesce(v_ext.deals, '[]'::jsonb)) d), '[]'::jsonb),
      'tables', jsonb_build_object('on_sale', false),
      'guest_list', jsonb_build_object('open', false));
  END IF;

  v_host := public.event_host_slug(e.id);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', r.name, 'price', r.price, 'detail', nullif(btrim(coalesce(r.description, '')), ''),
           'open', r.is_active AND NOT (r.manually_sold_out OR (r.max_tickets IS NOT NULL AND coalesce(r.tickets_sold, 0) >= r.max_tickets)),
           'sold_out', coalesce(r.manually_sold_out, false) OR (r.max_tickets IS NOT NULL AND coalesce(r.tickets_sold, 0) >= r.max_tickets),
           'includes_drink', r.includes_drink) ORDER BY r.position, r.price), '[]'::jsonb)
    INTO v_tiers
    FROM public.ticket_rounds r
   WHERE r.event_id = e.id AND NOT coalesce(r.hidden, false) AND (r.visible_from IS NULL OR r.visible_from <= now());

  SELECT g.free_before_time, g.includes_drink, coalesce(g.manually_sold_out, false) AS closed INTO v_gl
    FROM public.guest_lists g
   WHERE g.event_id = e.id AND g.is_active AND g.visible_on_club_page
   ORDER BY (g.holder_type = 'club') DESC, g.created_at
   LIMIT 1;

  v_left := CASE WHEN e.tables_enabled IS FALSE THEN NULL ELSE public._event_tables_left(e.id) END;
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'price', p.base_price, 'guests', p.base_capacity,
           'bottles', p.included_bottles_quota, 'pay_on_site', p.payment_mode = 'on_site') ORDER BY coalesce(p.base_price, p.minimum_spend), p.position), '[]'::jsonb)
    INTO v_packs
    FROM public.table_packs p
   WHERE v_left IS NOT NULL AND p.is_active
     AND (p.event_id = e.id OR (p.event_id IS NULL AND coalesce(e.venue_id, e.partner_venue_id) IS NOT NULL AND p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
     AND NOT (p.id = ANY (coalesce(e.sold_out_pack_ids, '{}'::uuid[])));

  RETURN v_out || jsonb_build_object(
    'sales', 'yuno',
    'page_url', 'https://yunoapp.eu' || CASE WHEN e.slug IS NOT NULL AND v_host IS NOT NULL THEN '/events/' || v_host || '/' || e.slug ELSE '/event/' || e.id END,
    'public', e.is_active AND coalesce(e.is_discoverable, true),
    'ticketing_open', e.ticketing_enabled IS NOT FALSE AND NOT coalesce(e.tickets_sold_out, false),
    'sold_out', coalesce(e.tickets_sold_out, false) OR (jsonb_array_length(v_tiers) > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_tiers) t WHERE (t->>'open')::boolean)),
    'tiers', CASE WHEN e.ticketing_enabled IS FALSE THEN '[]'::jsonb ELSE v_tiers END,
    'tables', jsonb_build_object('on_sale', v_left IS NOT NULL AND v_left > 0 AND NOT coalesce(e.tables_sold_out, false),
                                 'left', CASE WHEN coalesce(e.tables_sold_out, false) THEN 0 ELSE v_left END, 'packs', v_packs),
    'guest_list', CASE WHEN v_gl IS NULL THEN jsonb_build_object('open', false)
                       ELSE jsonb_build_object('open', NOT (v_gl.closed OR coalesce(e.guest_list_sold_out, false)),
                                               'free_before', left(v_gl.free_before_time::text, 5), 'drink', coalesce(v_gl.includes_drink, false)) END);
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_email_kind_label(p_kind text, p_lang text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT (CASE p_kind
    WHEN 'all_subscribers' THEN ARRAY['Whole base', 'Toute la base', 'Toda la base']
    WHEN 'vip' THEN ARRAY['VIP (500 € or more)', 'VIP (500 € et plus)', 'VIP (500 € o más)']
    WHEN 'big_spenders' THEN ARRAY['Big spenders (1,000 € or more)', 'Gros dépensiers (1 000 € et plus)', 'Grandes gastadores (1.000 € o más)']
    WHEN 'regulars' THEN ARRAY['Regulars (2 to 4 visits)', 'Habitués (2 à 4 venues)', 'Habituales (2 a 4 visitas)']
    WHEN 'new_customers' THEN ARRAY['New customers', 'Nouveaux clients', 'Nuevos clientes']
    WHEN 'dormant' THEN ARRAY['Dormant (90 days)', 'Endormis (90 jours)', 'Dormidos (90 días)']
    ELSE ARRAY[p_kind, p_kind, p_kind] END)[CASE WHEN p_lang = 'en' THEN 1 WHEN p_lang = 'es' THEN 3 ELSE 2 END]
$function$;

CREATE OR REPLACE FUNCTION public._mcp_email_products(p_venue_id text, p_organizer_user_id uuid, p_space_product text)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_space_product = 'crm' THEN ARRAY['crm']
    WHEN public.crm_scope_has_crm(public.crm_scope_key(p_venue_id, p_organizer_user_id)) THEN ARRAY['suite', 'crm']
    ELSE ARRAY['suite'] END
$function$;

CREATE OR REPLACE FUNCTION public._mcp_email_scope_events(p_venue_id text, p_organizer_user_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(x.id), '{}') FROM public.events x
   WHERE x.cancelled_at IS NULL AND (
     (p_organizer_user_id IS NOT NULL AND (x.organizer_user_id = p_organizer_user_id OR x.partner_organizer_id = p_organizer_user_id
        OR x.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id))))
     OR (p_venue_id IS NOT NULL AND (x.venue_id = p_venue_id OR x.partner_venue_id = p_venue_id
        OR x.id IN (SELECT public.cohost_event_ids_venue(p_venue_id)))))
$function$;

CREATE OR REPLACE FUNCTION public._mcp_email_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue    text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org      uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_products text[] := public._mcp_email_products(v_venue, v_org, p_product);
  v_product  text;
  gate       record;
  v_ids      uuid[];
  v_event    uuid;
  v          jsonb;
  v_aud      jsonb := '[]'::jsonb;
  v_n        integer;
  v_all      integer := 0;
  r          record;
  v_lang     text;
BEGIN
  SELECT * INTO gate FROM public.analytics_scope_gate(v_venue, v_org);
  IF NOT coalesce(gate.ok, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'reason', gate.reason);
  END IF;
  v_product := coalesce(nullif(p_args->>'product', ''), CASE WHEN p_product = 'crm' THEN 'crm' ELSE 'suite' END);
  IF NOT (v_product = ANY (v_products)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_available', 'products', to_jsonb(v_products));
  END IF;
  SELECT CASE WHEN preferred_language IN ('fr', 'en', 'es') THEN preferred_language ELSE 'fr' END INTO v_lang FROM public.profiles WHERE id = p_uid;
  v_lang := coalesce(v_lang, 'fr');

  CASE p_tool
  -- ── Kit de design ─────────────────────────────────────────────────────────
  WHEN 'get_email_design_kit' THEN
    v_ids := public._mcp_email_scope_events(v_venue, v_org);
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NOT NULL THEN
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'product', v_product,
      'products_available', to_jsonb(v_products),
      'can_create_drafts', public._mcp_space_can_draft(p_uid, v_venue, v_org, v_product),
      'language_hint', v_lang,
      'brand', CASE WHEN v_venue IS NOT NULL THEN (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', vv.name, 'logo_url', vv.logo_url, 'city', vv.city,
                   'cover_url', vv.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', vv.instagram_url, 'tiktok', vv.tiktok_url,
                                                'facebook', vv.facebook_url, 'x', vv.twitter_url))))
            FROM public.venues vv WHERE vv.id = v_venue)
        ELSE (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', op.display_name, 'logo_url', op.avatar_url, 'city', op.city,
                   'cover_url', op.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', op.instagram_url, 'website', op.website_url))))
            FROM public.organizer_profiles op WHERE op.user_id = v_org) END,
      'sender', (SELECT jsonb_strip_nulls(jsonb_build_object('name', cs.sender_name, 'postal_address', cs.postal_address,
                          'quiet_hours', cs.quiet_hours))
                   FROM public.crm_email_settings cs WHERE cs.scope_key = public.crm_scope_key(v_venue, v_org)),
      'recent_email_themes', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('campaign', x.name, 'status', x.status,
                   'background', x.theme_json->>'bg', 'card', x.theme_json->>'card', 'text', x.theme_json->>'text',
                   'accent', x.theme_json->>'accent', 'dark', x.theme_json->'dark', 'radius', x.theme_json->'radius')))
            FROM (SELECT ec.name, ec.status, ec.theme_json FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.blocks_version >= 2 AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                     AND jsonb_typeof(ec.theme_json) = 'object'
                   ORDER BY ec.updated_at DESC LIMIT 3) x), '[]'::jsonb),
      'upcoming_events', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
                   'sales', CASE WHEN x.external_source IS NOT NULL THEN 'external' ELSE 'yuno' END,
                   'has_poster', coalesce(x.poster_url, x.image_url) IS NOT NULL) ORDER BY x.start_at)
            FROM (SELECT e.* FROM public.events e
                   WHERE e.id = ANY (v_ids)
                     AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
                     AND (v_product = 'crm' OR e.external_source IS NULL)
                     AND (e.is_active OR e.external_source IS NOT NULL)
                   ORDER BY e.start_at LIMIT 12) x), '[]'::jsonb),
      'event', CASE WHEN v_event IS NOT NULL THEN public._mcp_email_event_facts(v_event) END,
      'recent_drafts', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('draft_id', x.id, 'name', x.name, 'subject', nullif(x.subject, '—'),
                   'product', coalesce(x.product, 'suite'), 'prepared_by', x.ai_author, 'edited', to_char(x.updated_at, 'YYYY-MM-DD HH24:MI'))))
            FROM (SELECT ec.* FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.status = 'draft' AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                   ORDER BY ec.updated_at DESC LIMIT 8) x), '[]'::jsonb));

  -- ── Audiences ─────────────────────────────────────────────────────────────
  WHEN 'list_email_audiences' THEN
    IF v_product = 'crm' THEN
      v := public.crm_email_send_options(v_venue, v_org);   -- construit _cso (joignables)
      FOR r IN SELECT x FROM jsonb_array_elements(coalesce(v->'auto', '[]'::jsonb)) x LOOP
        v_all := v_all + coalesce((r.x->>'reach')::integer, 0);
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', 'lifecycle:' || (r.x->>'key'),
          'label', (public._mcp_email_audience('lifecycle:' || (r.x->>'key'), 'crm', v_venue, v_org, v_lang)->0->>'label'),
          'reachable', coalesce((r.x->>'reach')::integer, 0),
          'open_rate_pct', r.x->'open_pct', 'click_rate_pct', r.x->'click_pct',
          'rule', CASE r.x->>'key'
            WHEN 'hab' THEN 'Regulars: came to several nights recently (the account''s regular rule).'
            WHEN 'occ' THEN 'Occasional: came, but not often enough to be a regular.'
            WHEN 'nou' THEN 'New: first night recently, or a ticket for an upcoming night and no night yet.'
            WHEN 'end' THEN 'Dormant: used to come, has not come back for several months.'
            ELSE 'Known contacts who never came to a night (imports, signups).' END)));
      END LOOP;
      v_aud := jsonb_build_array(jsonb_build_object('id', 'all',
                 'label', CASE v_lang WHEN 'en' THEN 'Whole base' WHEN 'es' THEN 'Toda la base' ELSE 'Toute la base' END,
                 'reachable', v_all, 'rule', 'Every contact who accepted your emails (all lifecycle groups). Use it for a global announcement.'))
               || v_aud;
      FOR r IN SELECT x FROM jsonb_array_elements(coalesce(v->'saved', '[]'::jsonb)) x LOOP
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', 'segment:' || (r.x->>'id'), 'label', r.x->>'name', 'reachable', coalesce((r.x->>'reach')::integer, 0),
          'open_rate_pct', r.x->'open_pct', 'click_rate_pct', r.x->'click_pct',
          'rule', coalesce(nullif(r.x->>'description', ''), 'Saved segment of the account.'))));
      END LOOP;
      FOR r IN SELECT * FROM (VALUES
          ('preset:vip', 'Spent 200 € or more in total.'),
          ('preset:loyal', 'Came to 4 nights or more.'),
          ('preset:buyers', 'Bought at least one paid ticket.'),
          ('preset:recent', 'Came in the last 3 months.'),
          ('preset:lapsed', 'Last night 3 to 12 months ago.'),
          ('preset:has_upcoming', 'Already have a ticket or an invitation for an upcoming night.'),
          ('preset:no_upcoming', 'No ticket yet for an upcoming night.'),
          ('preset:clickers', 'Clicked an email link in the last 3 months.'),
          ('preset:gl_loyal', 'Came on the guest list 3 nights or more, never paid.')) p(k, rule)
      LOOP
        BEGIN
          EXECUTE format('SELECT count(*)::integer FROM _cso p WHERE (%s)',
                         public._crm_filter_sql(public._mcp_email_audience(r.k, 'crm', v_venue, v_org, v_lang)->0->'def', 'p'))
            INTO v_n;
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', r.k, 'label', public._mcp_email_audience(r.k, 'crm', v_venue, v_org, v_lang)->0->>'label',
          'reachable', v_n, 'rule', r.rule, 'kind', 'yuno_preset')));
      END LOOP;
      RETURN jsonb_build_object('ok', true, 'product', 'crm', 'audiences', v_aud,
        'reachable_means', 'Contacts with an email who accepted your emails (newsletter opt-in) and are not suppressed. Yuno sending rules may still protect some at send time.',
        'exclusions', jsonb_build_object(
          'exclude_event_buyers', 'Skip people who already bought a ticket for the linked night (recommended for a last call, not for a first announcement).',
          'exclude_recent_days', 'Skip people who received an email from this account in the last N days (default 3).'));
    END IF;

    -- Billetterie
    IF v_venue IS NOT NULL THEN
      FOR r IN SELECT * FROM (VALUES
          ('all_subscribers', 'Every contact who accepted your emails.'),
          ('vip', 'Customers who spent 500 € or more.'),
          ('big_spenders', 'Customers who spent 1,000 € or more.'),
          ('regulars', 'Customers who came 2 to 4 times.'),
          ('new_customers', 'Customers who came once or never.'),
          ('dormant', 'Customers with no purchase for 90 days.')) k(kind, rule)
      LOOP
        BEGIN
          v_n := public.count_campaign_recipients(v_venue, 'promotional', r.kind, NULL, NULL);
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', CASE WHEN r.kind = 'all_subscribers' THEN 'all' ELSE 'kind:' || r.kind END,
          'label', public._mcp_email_kind_label(r.kind, v_lang), 'reachable', v_n, 'rule', r.rule)));
      END LOOP;
      FOR r IN SELECT s.id, s.name FROM public.venue_segments s WHERE s.venue_id = v_venue ORDER BY s.created_at DESC LIMIT 20 LOOP
        BEGIN
          v_n := public.count_campaign_recipients(v_venue, 'promotional', 'custom_segment', NULL, r.id);
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'segment:' || r.id, 'label', r.name, 'reachable', v_n, 'rule', 'Saved customer segment.')));
      END LOOP;
    ELSE
      BEGIN
        v := public.count_organizer_audience_kinds(v_org, NULL);
      EXCEPTION WHEN others THEN v := '{}'::jsonb;
      END;
      FOR r IN SELECT * FROM (VALUES
          ('all_subscribers', 'Every contact who accepted your emails.'),
          ('vip', 'Customers who spent 500 € or more.'),
          ('big_spenders', 'Customers who spent 1,000 € or more.'),
          ('regulars', 'Customers who came 2 to 4 times.'),
          ('new_customers', 'Customers who came once or never.'),
          ('dormant', 'Customers with no purchase for 90 days.')) k(kind, rule)
      LOOP
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', CASE WHEN r.kind = 'all_subscribers' THEN 'all' ELSE 'kind:' || r.kind END,
          'label', public._mcp_email_kind_label(r.kind, v_lang), 'reachable', (v->>r.kind)::integer, 'rule', r.rule)));
      END LOOP;
    END IF;
    FOR r IN SELECT s.id, s.name, s.description FROM public.contact_segments s
              WHERE s.venue_id IS NOT DISTINCT FROM v_venue AND s.organizer_user_id IS NOT DISTINCT FROM v_org
              ORDER BY s.created_at DESC LIMIT 20 LOOP
      v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'contact_segment:' || r.id, 'label', r.name,
                 'rule', coalesce(nullif(r.description, ''), 'Segment of the contact base (imports and Yuno customers).'))));
    END LOOP;
    FOR r IN SELECT i.id, coalesce(nullif(i.list_name, ''), i.filename) AS name, i.inserted_count FROM public.email_list_imports i
              WHERE i.venue_id IS NOT DISTINCT FROM v_venue AND i.organizer_user_id IS NOT DISTINCT FROM v_org AND i.superseded_at IS NULL
              ORDER BY i.created_at DESC LIMIT 20 LOOP
      v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'import:' || r.id, 'label', r.name,
                 'imported', r.inserted_count, 'rule', 'Imported contact list (only its opted-in contacts receive).')));
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'product', 'suite', 'audiences', v_aud,
      'reachable_means', 'Contacts who accepted your emails (newsletter opt-in) and are not suppressed.',
      'exclusions', jsonb_build_object(
        'exclude_event_buyers', 'Skip people who already bought a ticket for the linked night.',
        'exclude_recent_days', 'Skip people who received an email from this account in the last N days (default 3).'));

  -- ── Relire un brouillon ou une campagne ───────────────────────────────────
  WHEN 'get_email_draft' THEN
    IF coalesce(p_args->>'draft_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found');
    END IF;
    SELECT jsonb_build_object(
        'ok', true, 'draft_id', ec.id, 'name', ec.name, 'status', ec.status,
        'product', coalesce(ec.product, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(ec.audiences_json) a WHERE a->>'kind' = 'crm') THEN 'crm' ELSE 'suite' END),
        'subject', nullif(ec.subject, '—'), 'subject_b', ec.subject_b, 'ab_test', ec.ab_enabled, 'preheader', ec.preheader,
        'language', coalesce(ec.language, 'fr'), 'prepared_by', ec.ai_author,
        'event', CASE WHEN ec.event_id IS NOT NULL THEN (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) FROM public.events e WHERE e.id = ec.event_id) END,
        'audience', ec.audiences_json, 'exclusions', ec.exclusions_json,
        'theme', ec.theme_json, 'social_links', ec.social_links_json,
        'blocks_version', ec.blocks_version, 'sections', ec.blocks_json,
        'version', public._mcp_draft_version(ec.updated_at), 'edited_at', ec.updated_at, 'ai_edited_at', ec.ai_updated_at,
        'sent_at', ec.sent_at, 'recipients', CASE WHEN ec.status IN ('sent', 'sending') THEN ec.recipients_count END,
        'venue_id', ec.venue_id, 'organizer_user_id', ec.organizer_user_id)
      INTO v
      FROM public.email_campaigns ec
     WHERE ec.id = (p_args->>'draft_id')::uuid
       AND ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
       AND ec.automation_id IS NULL;
    IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found'); END IF;
    RETURN v;

  -- ── Images ajoutées par l'IA (emplacements d'envoi et images prêtes) ─────
  WHEN 'list_email_images' THEN
    RETURN jsonb_build_object('ok', true, 'images', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'image_id', i.id, 'name', i.name,
               'status', CASE WHEN i.status = 'waiting' AND i.expires_at <= now() THEN 'expired' ELSE i.status END,
               'url', i.url, 'width', i.width, 'height', i.height, 'source', i.source,
               'upload_page', CASE WHEN i.status = 'waiting' AND i.expires_at > now() THEN 'https://yunoapp.eu/ai/image/' || i.code END,
               'added', to_char(i.created_at AT TIME ZONE coalesce(p_tz, 'Europe/Paris'), 'YYYY-MM-DD HH24:MI')))
             ORDER BY i.created_at DESC)
        FROM (SELECT m.* FROM public.mcp_email_images m
               WHERE m.venue_id IS NOT DISTINCT FROM v_venue AND m.organizer_user_id IS NOT DISTINCT FROM v_org
                 AND m.created_at > now() - interval '30 days'
                 AND (m.status = 'ready' OR (m.status = 'waiting' AND m.expires_at > now() - interval '1 hour'))
               ORDER BY m.created_at DESC LIMIT 20) i), '[]'::jsonb));

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END CASE;
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_redact(p jsonb, p_people boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  k text; v jsonb; o jsonb;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  CASE jsonb_typeof(p)
    WHEN 'object' THEN
      o := '{}'::jsonb;
      FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
        IF lower(k) ~ '^(lat|lng|lon|latitude|longitude|ip|ip_address|ip_hash|user_agent|visitor_hash|session_id|unsubscribe_token|qr_code|token)$' THEN CONTINUE; END IF;
        IF p_people AND lower(k) ~ '^(email|buyer_email|customer_email|guest_email|phone|phone_e164|first_name|last_name|full_name|firstname|lastname|customer_name|guest_name|buyer_name|notes|ban_reason|birthday|birth_date|postal_code|address)$' THEN CONTINUE; END IF;
        o := o || jsonb_build_object(k, public._mcp_redact(v, p_people));
      END LOOP;
      RETURN o;
    WHEN 'array' THEN
      RETURN coalesce((SELECT jsonb_agg(public._mcp_redact(e, p_people) ORDER BY n)
                         FROM jsonb_array_elements(p) WITH ORDINALITY AS x(e, n)), '[]'::jsonb);
    ELSE
      RETURN p;
  END CASE;
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_resolve_event(p_ref text, p_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref text := btrim(coalesce(p_ref, ''));
  v_id  uuid;
BEGIN
  IF v_ref = '' OR p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN NULL; END IF;
  IF v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_id := v_ref::uuid;
    RETURN CASE WHEN v_id = ANY (p_ids) THEN v_id END;
  END IF;
  IF lower(v_ref) IN ('last', 'latest', 'previous', 'derniere', 'dernière', 'ultima', 'última') THEN
    SELECT e.id INTO v_id FROM public.events e
     WHERE e.id = ANY (p_ids) AND e.cancelled_at IS NULL
       AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
     ORDER BY e.start_at DESC LIMIT 1;
    RETURN v_id;
  END IF;
  IF lower(v_ref) IN ('next', 'upcoming', 'prochaine', 'proxima', 'próxima', 'tonight', 'ce soir', 'esta noche') THEN
    SELECT e.id INTO v_id FROM public.events e
     WHERE e.id = ANY (p_ids) AND e.cancelled_at IS NULL
       AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
     ORDER BY e.start_at ASC LIMIT 1;
    RETURN v_id;
  END IF;
  SELECT e.id INTO v_id FROM public.events e
   WHERE e.id = ANY (p_ids) AND e.cancelled_at IS NULL
     AND lower(e.title) LIKE '%' || lower(v_ref) || '%'
   ORDER BY abs(extract(epoch FROM e.start_at - now())) ASC LIMIT 1;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_signup_events(p_venue_id text, p_organizer_user_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(e.id), '{}') FROM public.events e
   WHERE e.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
$function$;

CREATE OR REPLACE FUNCTION public._mcp_signup_page_view(p crm_signup_pages)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'page_id', p.id, 'slug', p.slug, 'status', p.status, 'state', public._crm_signup_state(p),
    'kind', p.kind, 'lang', p.lang,
    'title', p.title, 'tagline', p.tagline, 'button_label', p.button_label, 'thanks_message', p.thanks_message,
    'poster_url', p.poster_url,
    'event', CASE WHEN p.event_id IS NOT NULL THEN (
        SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at,
                 'sales', CASE WHEN e.external_source IS NOT NULL THEN 'external' ELSE 'yuno' END)
          FROM public.events e WHERE e.id = p.event_id) END,
    'fields', p.fields, 'reward', p.reward, 'show_count', p.show_count, 'countdown', p.countdown,
    'opens_at', p.opens_at, 'sale_opens_at', p.sale_opens_at, 'closes_mode', p.closes_mode, 'closes_at', p.closes_at,
    'closes_effective', public._crm_signup_close_at(p),
    'design_mode', CASE WHEN p.custom_design IS NOT NULL THEN 'custom' ELSE 'template' END,
    'template', p.design - 'migrated',
    'custom_design', p.custom_design,
    'proposal', p.ai_proposal,
    'prepared_by', p.ai_author,
    'version', public._mcp_draft_version(p.updated_at),
    'edited_at', p.updated_at, 'ai_edited_at', p.ai_updated_at, 'published_at', p.published_at,
    'signups', (SELECT count(*) FROM public.crm_signup_entries x WHERE x.page_id = p.id),
    'visits', (SELECT count(*) FROM public.crm_signup_visits x WHERE x.page_id = p.id)))
$function$;

CREATE OR REPLACE FUNCTION public._mcp_signup_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org   uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_ids   uuid[];
  v_event uuid;
  v_lang  text;
  p       public.crm_signup_pages%ROWTYPE;
BEGIN
  IF NOT coalesce(public.crm_scope_allowed(v_venue, v_org), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF NOT ('crm' = ANY (public._mcp_email_products(v_venue, v_org, p_product))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_not_active');
  END IF;
  SELECT CASE WHEN preferred_language IN ('fr', 'en', 'es') THEN preferred_language ELSE 'fr' END INTO v_lang FROM public.profiles WHERE id = p_uid;

  IF p_tool = 'get_signup_page_kit' THEN
    v_ids := public._mcp_signup_events(v_venue, v_org);
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NOT NULL THEN
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'can_create', public._mcp_space_can_draft(p_uid, v_venue, v_org, 'crm'),
      'can_publish', public._crm_signup_owner(v_venue, v_org),
      'language_hint', coalesce(v_lang, 'fr'),
      'brand', CASE WHEN v_venue IS NOT NULL THEN (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', vv.name, 'logo_url', vv.logo_url, 'city', vv.city,
                   'cover_url', vv.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', vv.instagram_url, 'tiktok', vv.tiktok_url,
                                                'facebook', vv.facebook_url, 'x', vv.twitter_url))))
            FROM public.venues vv WHERE vv.id = v_venue)
        ELSE (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', op.display_name, 'logo_url', op.avatar_url, 'city', op.city,
                   'cover_url', op.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', op.instagram_url, 'website', op.website_url))))
            FROM public.organizer_profiles op WHERE op.user_id = v_org) END,
      'recent_email_themes', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('campaign', x.name,
                   'background', x.theme_json->>'bg', 'card', x.theme_json->>'card', 'text', x.theme_json->>'text',
                   'accent', x.theme_json->>'accent', 'dark', x.theme_json->'dark')))
            FROM (SELECT ec.name, ec.theme_json FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.blocks_version >= 2 AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                     AND jsonb_typeof(ec.theme_json) = 'object'
                   ORDER BY ec.updated_at DESC LIMIT 3) x), '[]'::jsonb),
      'upcoming_events', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
                   'sales', CASE WHEN x.external_source IS NOT NULL THEN 'external' ELSE 'yuno' END,
                   'has_poster', coalesce(x.poster_url, x.image_url) IS NOT NULL OR EXISTS (
                      SELECT 1 FROM public.external_events xe WHERE xe.event_id = x.id AND xe.cover_url IS NOT NULL),
                   'sold_out', coalesce(x.tickets_sold_out, false))) ORDER BY x.start_at)
            FROM (SELECT e.* FROM public.events e
                   WHERE e.id = ANY (v_ids) AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
                   ORDER BY e.start_at LIMIT 12) x), '[]'::jsonb),
      'event', CASE WHEN v_event IS NOT NULL THEN public._crm_signup_event(v_event) END,
      'pages', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'page_id', x.id, 'title', nullif(x.title, ''), 'kind', x.kind, 'state', public._crm_signup_state(x),
                   'design', CASE WHEN x.custom_design IS NOT NULL THEN 'custom' ELSE x.design->>'tpl' END,
                   'prepared_by', x.ai_author, 'proposal_pending', CASE WHEN x.ai_proposal IS NOT NULL THEN true END,
                   'public_url', CASE WHEN x.status <> 'draft' THEN 'https://crm.yunoapp.eu/j/' || x.slug END,
                   'event', (SELECT e.title FROM public.events e WHERE e.id = x.event_id),
                   'signups', (SELECT count(*) FROM public.crm_signup_entries y WHERE y.page_id = x.id),
                   'edited', to_char(x.updated_at AT TIME ZONE coalesce(p_tz, 'Europe/Paris'), 'YYYY-MM-DD HH24:MI'))) ORDER BY x.updated_at DESC)
            FROM (SELECT * FROM public.crm_signup_pages sp
                   WHERE sp.venue_id IS NOT DISTINCT FROM v_venue AND sp.organizer_user_id IS NOT DISTINCT FROM v_org
                   ORDER BY sp.updated_at DESC LIMIT 20) x), '[]'::jsonb));
  ELSIF p_tool = 'get_signup_page' THEN
    IF coalesce(p_args->>'page_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'page_not_found');
    END IF;
    SELECT * INTO p FROM public.crm_signup_pages sp
     WHERE sp.id = (p_args->>'page_id')::uuid
       AND sp.venue_id IS NOT DISTINCT FROM v_venue AND sp.organizer_user_id IS NOT DISTINCT FROM v_org;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'page_not_found'); END IF;
    RETURN jsonb_build_object('ok', true,
        'can_publish', public._crm_signup_owner(v_venue, v_org),
        'event_facts', CASE WHEN p.event_id IS NOT NULL THEN public._crm_signup_event(p.event_id) END)
      || public._mcp_signup_page_view(p);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_space_can_draft(p_uid uuid, p_venue_id text, p_organizer_user_id uuid, p_product text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(CASE
    WHEN p_product = 'crm' THEN
      public.crm_scope_has_crm(public.crm_scope_key(p_venue_id, p_organizer_user_id))
      AND public.crm_scope_writable(p_venue_id, p_organizer_user_id)
    ELSE
      (p_venue_id IS NOT NULL AND public.is_venue_owner(p_uid, p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND p_organizer_user_id = p_uid)
  END, false)
$function$;

CREATE OR REPLACE FUNCTION public._mcp_unavailable(p_state text, p_msg text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT jsonb_build_object('unavailable',
    CASE WHEN p_state = '42501' OR p_msg ILIKE ANY (ARRAY['%unauthorized%', '%forbidden%', '%not allowed%'])
         THEN 'Not shown: in the Yuno Console this detail is reserved to the club owner or the organization founder, and this person''s role does not include it.'
         ELSE 'Not available right now: this part could not be computed.' END)
$function$;

CREATE OR REPLACE FUNCTION public._mcp_user_spaces(p_uid uuid)
 RETURNS TABLE(space_key text, kind text, space_id text, name text, product text, timezone text, role text, money boolean, customers boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'venue:' || v.id, 'venue', v.id, v.name, coalesce(v.product, 'suite'),
         coalesce(v.timezone, 'Europe/Paris'), 'owner', true, true
    FROM public.venues v
   WHERE v.owner_id = p_uid AND v.decommissioned_at IS NULL
  UNION ALL
  SELECT 'venue:' || v.id, 'venue', v.id, v.name, coalesce(v.product, 'suite'),
         coalesce(v.timezone, 'Europe/Paris'), 'manager',
         coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false),
         coalesce(mp.can_view_customers, false) OR coalesce(mp.can_manage_crm, false)
    FROM public.manager_permissions mp
    JOIN public.venues v ON v.id = mp.venue_id
   WHERE mp.user_id = p_uid AND v.decommissioned_at IS NULL
     AND v.owner_id IS DISTINCT FROM p_uid
     AND (coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false)
          OR coalesce(mp.can_view_customers, false) OR coalesce(mp.can_manage_crm, false))
  UNION ALL
  SELECT 'org:' || op.user_id, 'organizer', op.user_id::text, coalesce(nullif(op.display_name, ''), 'Organisation'),
         coalesce(op.product, 'suite'), 'Europe/Paris', 'founder', true, true
    FROM public.organizer_profiles op
   WHERE op.user_id = p_uid
  UNION ALL
  SELECT 'org:' || m.organizer_user_id, 'organizer', m.organizer_user_id::text,
         coalesce(nullif(op.display_name, ''), 'Organisation'), coalesce(op.product, 'suite'), 'Europe/Paris', m.role,
         public.org_member_has_permission(p_uid, m.organizer_user_id, 'view_finance'), m.role = 'admin'
    FROM public.org_members m
    JOIN public.organizer_profiles op ON op.user_id = m.organizer_user_id
   WHERE m.member_user_id = p_uid AND m.invitation_status = 'accepted' AND m.role IN ('admin', 'editor')
     AND m.organizer_user_id <> p_uid
$function$;

CREATE OR REPLACE FUNCTION public._mcp_window(p_args jsonb, p_default_days integer)
 RETURNS TABLE(w_from timestamp with time zone, w_to timestamp with time zone, w_days integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_to   timestamptz := now();
  v_from timestamptz;
  v_days integer;
BEGIN
  BEGIN
    IF nullif(p_args->>'to', '') IS NOT NULL THEN
      v_to := least(now(), ((p_args->>'to')::date + 1)::timestamptz);
    END IF;
    IF nullif(p_args->>'from', '') IS NOT NULL THEN
      v_from := (p_args->>'from')::date::timestamptz;
    END IF;
  EXCEPTION WHEN others THEN
    v_from := NULL; v_to := now();
  END;
  IF v_from IS NULL THEN
    v_days := greatest(1, least(coalesce(nullif(p_args->>'days', '')::integer, p_default_days), 1095));
    v_from := v_to - make_interval(days => v_days);
  END IF;
  IF v_from > v_to THEN v_from := v_to - interval '1 day'; END IF;
  v_days := greatest(1, ceil(extract(epoch FROM v_to - v_from) / 86400)::integer);
  RETURN QUERY SELECT v_from, v_to, v_days;
END;
$function$;

CREATE OR REPLACE FUNCTION public._regular_lapse_candidates(p_venue_id text, p_organizer_user_id uuid, p_gap interval)
 RETURNS TABLE(em text, user_id uuid, last_at timestamp with time zone, nights integer, pick_event_id uuid, pick_reason text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scope_ev AS (
    SELECT e.id, e.start_at, e.recurring_template_id,
           ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')::date AS night,
           ARRAY(
             SELECT DISTINCT lower(btrim(g))
               FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g
              WHERE g IS NOT NULL AND btrim(g) <> ''
           ) AS genres
      FROM public.events e
     WHERE e.cancelled_at IS NULL
       AND e.start_at < now()
       AND e.start_at > now() - p_gap - interval '120 days'
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
  ),
  visits AS (
    SELECT lower(t.user_email) AS em, t.user_id, t.event_id
      FROM public.tickets t JOIN scope_ev ev ON ev.id = t.event_id
     WHERE t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
    UNION
    SELECT lower(r.user_email), r.user_id, r.event_id
      FROM public.table_reservations r JOIN scope_ev ev ON ev.id = r.event_id
     WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'used', 'confirmed')
    UNION
    SELECT lower(ge.email), ge.user_id, gl.event_id
      FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
      JOIN scope_ev ev ON ev.id = gl.event_id
     WHERE ge.email IS NOT NULL AND ge.entry_scanned
    UNION
    -- Yuno CRM : billets de la billetterie connectée.
    SELECT lower(xt.buyer_email), NULL::uuid, xt.event_id
      FROM public.external_tickets xt JOIN scope_ev ev ON ev.id = xt.event_id
     WHERE xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
  ),
  v AS (
    SELECT x.em, x.user_id, ev.id AS event_id, ev.start_at, ev.night, ev.recurring_template_id, ev.genres
      FROM visits x JOIN scope_ev ev ON ev.id = x.event_id
     WHERE position('@' in x.em) > 1
  ),
  last_v AS (
    SELECT v.em, max(v.start_at) AS last_at,
           (array_agg(v.user_id) FILTER (WHERE v.user_id IS NOT NULL))[1] AS user_id
      FROM v GROUP BY v.em
  ),
  lapsed AS (
    SELECT l.em, l.user_id, l.last_at,
           count(DISTINCT v.night)::integer AS nights,
           array_agg(DISTINCT v.recurring_template_id) FILTER (WHERE v.recurring_template_id IS NOT NULL) AS series,
           mode() WITHIN GROUP (ORDER BY extract(isodow FROM v.night)) AS dow
      FROM last_v l
      JOIN v ON v.em = l.em AND v.start_at > l.last_at - interval '60 days' AND v.start_at <= l.last_at
     WHERE l.last_at <= now() - p_gap
       AND l.last_at > now() - p_gap - interval '30 days'
     GROUP BY l.em, l.user_id, l.last_at
    HAVING count(DISTINCT v.night) >= 4
  ),
  -- Ses goûts : les genres des soirées où il est venu (toute la fenêtre),
  -- plus ceux de son quiz Yuno s'il a un compte.
  tastes AS (
    SELECT p.em,
           ARRAY(
             SELECT DISTINCT g FROM (
               SELECT unnest(v.genres) AS g FROM v WHERE v.em = p.em
               UNION ALL
               SELECT lower(btrim(tg)) FROM public.user_taste_profiles tp, unnest(COALESCE(tp.genres, '{}'::text[])) tg
                WHERE p.user_id IS NOT NULL AND tp.user_id = p.user_id
             ) z WHERE g IS NOT NULL AND g <> ''
           ) AS genres
      FROM lapsed p
  ),
  upcoming AS (
    SELECT e.id, e.start_at, e.recurring_template_id,
           extract(isodow FROM ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')) AS dow,
           ARRAY(
             SELECT DISTINCT lower(btrim(g))
               FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g
              WHERE g IS NOT NULL AND btrim(g) <> ''
           ) AS genres
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '24 hours'
       AND e.start_at <= now() + interval '35 days'
       AND (
         ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
         OR (e.tables_enabled AND NOT e.tables_sold_out)
         OR (NOT e.guest_list_sold_out AND EXISTS (
               SELECT 1 FROM public.guest_lists gl
                WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
       )
  )
  SELECT p.em, p.user_id, p.last_at, p.nights, pick.id, pick.reason
    FROM lapsed p
    JOIN tastes ts ON ts.em = p.em
    LEFT JOIN LATERAL (
      SELECT u.id,
             CASE WHEN u.series_hit THEN 'series' WHEN u.genre_hits > 0 THEN 'genre'
                  WHEN u.dow_hit THEN 'weekday' ELSE 'next' END AS reason
        FROM (
          SELECT up.id, up.start_at,
                 (up.recurring_template_id IS NOT NULL AND up.recurring_template_id = ANY (COALESCE(p.series, '{}'::uuid[]))) AS series_hit,
                 (SELECT count(*) FROM unnest(up.genres) g WHERE g = ANY (ts.genres))::integer AS genre_hits,
                 (up.dow = p.dow) AS dow_hit
            FROM upcoming up
        ) u
       ORDER BY (CASE WHEN u.series_hit THEN 4 ELSE 0 END) + 2 * LEAST(2, u.genre_hits) + (CASE WHEN u.dow_hit THEN 1 ELSE 0 END) DESC,
                u.start_at ASC
       LIMIT 1
    ) pick ON true
   -- Il revient déjà : une place pour une soirée à venir de la portée.
   WHERE NOT EXISTS (
     SELECT 1 FROM public.events e
      WHERE e.start_at > now() AND e.cancelled_at IS NULL
        AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        AND public._email_event_holder(e.id, p.em)
   )
$function$;

CREATE OR REPLACE FUNCTION public._sales_period_nights(p_scope_ids uuid[], p_scope_venue text, p_money boolean, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(id uuid, title text, start_at timestamp with time zone, tz text, bucket text, show_money boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.id, e.title, e.start_at,
         coalesce(e.timezone, v.timezone, 'Europe/Paris'),
         case when e.start_at >= p_from then 'cur' else 'prev' end,
         case when p_scope_venue is null then p_money else p_money and e.venue_id = p_scope_venue end
  from public.events e
  left join public.venues v on v.id = coalesce(e.venue_id, e.partner_venue_id)
  where e.id = any(p_scope_ids)
    and e.cancelled_at is null and coalesce(e.status, 'active') <> 'cancelled'
    and e.start_at < p_to
    and e.start_at >= p_from - (p_to - p_from)
$function$;

CREATE OR REPLACE FUNCTION public._sales_period_tx(p_event_ids uuid[], p_scope_venue text)
 RETURNS TABLE(event_id uuid, pillar text, id uuid, email text, user_id uuid, at_ts timestamp with time zone, units integer, heads integer, amount numeric, source text, tracked_link_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.event_id, 'tickets'::text, t.id, lower(t.user_email), t.user_id,
         coalesce(t.paid_at, t.created_at),
         greatest(coalesce(t.quantity, 1), 1)::integer,
         greatest(coalesce(t.quantity, 1), 1)::integer,
         greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
           - least(greatest(coalesce(t.refund_amount, 0), 0),
                   greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)),
         coalesce(nullif(t.purchase_source, ''), 'direct'),
         t.tracked_link_id
  from public.tickets t
  where t.event_id = any(p_event_ids) and t.status in ('paid', 'used')
  union all
  select r.event_id, 'tables', r.id, lower(r.user_email), r.user_id,
         coalesce(r.paid_at, r.created_at),
         1,
         greatest(coalesce(r.guest_count, 0), 1)::integer,
         greatest(r.total_price - coalesce(r.service_fee, 0) - (case when coalesce(r.fee_absorbed, false) then coalesce(r.management_fee, 0) else 0 end), 0)
           - least(greatest(coalesce(r.refund_amount, 0), 0),
                   greatest(r.total_price - coalesce(r.service_fee, 0) - (case when coalesce(r.fee_absorbed, false) then coalesce(r.management_fee, 0) else 0 end), 0)),
         coalesce(nullif(r.purchase_source, ''), 'direct'),
         r.tracked_link_id
  from public.table_reservations r
  where r.event_id = any(p_event_ids) and r.status in ('paid', 'confirmed')
  union all
  select o.event_id, 'drinks', o.id, lower(o.user_email), o.user_id,
         coalesce(o.paid_at, o.created_at),
         1, 0,
         greatest(o.total - coalesce(o.service_fee, 0), 0)
           - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)),
         coalesce(nullif(o.purchase_source, ''), 'direct'),
         o.tracked_link_id
  from public.orders o
  where o.event_id = any(p_event_ids) and o.status in ('paid', 'served')
    and p_scope_venue is not null and o.venue_id = p_scope_venue
  union all
  select gl.event_id, 'guestlist', g.id, lower(nullif(btrim(g.email), '')), g.user_id,
         g.created_at, 0, 1, 0, 'guestlist', g.tracked_link_id
  from public.guest_list_entries g
  join public.guest_lists gl on gl.id = g.guest_list_id
  where gl.event_id = any(p_event_ids) and g.status <> 'cancelled'
$function$;

CREATE OR REPLACE FUNCTION public._venue_customer_rfm(p_venue_id text)
 RETURNS TABLE(id uuid, user_id uuid, email text, first_name text, last_name text, phone text, first_visit_at timestamp with time zone, last_visit_at timestamp with time zone, total_spent numeric, ticket_count integer, order_count integer, table_count integer, is_banned boolean, banned_at timestamp with time zone, ban_reason text, notes text, revenue_30d numeric, revenue_90d numeric, revenue_prev_90d numeric, avg_basket numeric, visit_nights integer, visits_per_month numeric, last_activity_at timestamp with time zone, preferred_dow integer, preferred_event_title text, recency_days integer, rfm_r integer, rfm_f integer, rfm_m integer, rfm_segment text, rfm_tier text, churn_risk boolean, is_guest boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Fonction INTERNE : aucune garde ici, droits révoqués plus bas.
  RETURN QUERY
  WITH venue_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
  ),
  -- Revenu club = montant facturé − frais Yuno. La part Yuno n'est jamais comptée.
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id
    FROM tickets t JOIN venue_events ve ON ve.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(o.user_email),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id
    FROM orders o
    WHERE o.venue_id = p_venue_id AND o.user_email IS NOT NULL AND o.status = 'paid'
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END))::numeric,
           tr.created_at, tr.event_id
    FROM table_reservations tr JOIN venue_events ve ON ve.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(avg(a.amount), 0) AS avg_basket,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  event_activity AS (
    SELECT a.em, a.event_id, ve.start_at, ve.title, count(*) AS cnt
    FROM activity a JOIN venue_events ve ON ve.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, ve.start_at, ve.title
  ),
  pref_event AS (
    SELECT DISTINCT ON (ea.em) ea.em, ea.title AS preferred_event_title
    FROM event_activity ea ORDER BY ea.em, ea.cnt DESC, ea.start_at DESC
  ),
  pref_dow AS (
    SELECT s.em, s.dow FROM (
      SELECT ea.em, extract(dow FROM ea.start_at)::int AS dow,
             row_number() OVER (PARTITION BY ea.em ORDER BY sum(ea.cnt) DESC) AS rn
      FROM event_activity ea GROUP BY ea.em, extract(dow FROM ea.start_at)
    ) s WHERE s.rn = 1
  ),
  -- Ventes brutes par email : sémantique gross (= increment_venue_customer_stats),
  -- identité (nom/tél du dernier achat qui en porte), compteurs par pilier.
  guest_sales AS (
    SELECT lower(t.user_email) AS em, t.total_price::numeric AS gross, t.created_at,
           'ticket'::text AS kind, t.full_name, t.phone AS ph
    FROM tickets t JOIN venue_events ve ON ve.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(o.user_email), o.total::numeric, o.created_at, 'order', NULL, NULL
    FROM orders o
    WHERE o.venue_id = p_venue_id AND o.user_email IS NOT NULL AND o.status = 'paid'
    UNION ALL
    SELECT lower(tr.user_email), tr.total_price::numeric, tr.created_at, 'table', tr.full_name, tr.phone
    FROM table_reservations tr JOIN venue_events ve ON ve.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  -- Dernière valeur NON NULLE de chaque champ (et non la dernière ligne) : un
  -- achat sans numéro ne doit pas effacer le numéro laissé la fois d'avant.
  guest_identity AS (
    SELECT gs.em,
      (array_agg(gs.full_name ORDER BY gs.created_at DESC) FILTER (WHERE gs.full_name IS NOT NULL))[1] AS full_name,
      (array_agg(gs.ph ORDER BY gs.created_at DESC) FILTER (WHERE gs.ph IS NOT NULL))[1] AS ph
    FROM guest_sales gs GROUP BY gs.em
  ),
  guest_agg AS (
    SELECT gs.em,
      sum(gs.gross) AS total_spent,
      count(*) FILTER (WHERE gs.kind = 'ticket') AS ticket_count,
      count(*) FILTER (WHERE gs.kind = 'order')  AS order_count,
      count(*) FILTER (WHERE gs.kind = 'table')  AS table_count,
      min(gs.created_at) AS first_at,
      max(gs.created_at) AS last_at
    FROM guest_sales gs
    -- Anti-jointure : seuls les emails SANS ligne venue_customers deviennent invités.
    WHERE NOT EXISTS (
      SELECT 1 FROM venue_customers vc
      WHERE vc.venue_id = p_venue_id AND lower(vc.email) = gs.em
    )
    GROUP BY gs.em
  ),
  base AS (
    -- Clients à compte (lignes venue_customers)
    SELECT
      vc.id, vc.user_id, vc.email,
      COALESCE(vc.first_name, pr.first_name) AS first_name,
      COALESCE(vc.last_name, pr.last_name) AS last_name,
      COALESCE(NULLIF(btrim(COALESCE(vc.phone, '')), ''), pr.phone) AS phone,
      vc.first_visit_at, vc.last_visit_at, vc.total_spent,
      vc.ticket_count, vc.order_count, vc.table_count,
      vc.is_banned, vc.banned_at, vc.ban_reason, vc.notes,
      ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS visits_per_month,
      ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, vc.last_visit_at, vc.first_visit_at, now()))) / 86400)::int AS recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE COALESCE(vc.ticket_count, 0) + COALESCE(vc.order_count, 0) + COALESCE(vc.table_count, 0)
      END AS rfm_freq,
      COALESCE(vc.total_spent, 0)::numeric AS rfm_money,
      false AS is_guest
    FROM venue_customers vc
    LEFT JOIN agg ag ON ag.em = lower(vc.email)
    LEFT JOIN pref_event pe ON pe.em = lower(vc.email)
    LEFT JOIN pref_dow pd ON pd.em = lower(vc.email)
    -- Repli sur le profil du compte : le fichier client doit porter le
    -- téléphone du client, même quand l'achat qui l'a créé n'en portait pas.
    LEFT JOIN LATERAL (
      SELECT p.first_name, p.last_name, NULLIF(btrim(COALESCE(p.phone, '')), '') AS phone
      FROM profiles p WHERE p.id = vc.user_id LIMIT 1
    ) pr ON true
    WHERE vc.venue_id = p_venue_id

    UNION ALL

    -- Invités (lignes synthétiques par email)
    SELECT
      md5('guest:' || ga.em)::uuid AS id,
      -- user_id reste NULL : un invité n'est pas un compte, et c'est ce NULL
      -- qui l'exclut d'office du ciblage push de resolve_venue_segment.
      NULL::uuid AS user_id,
      ga.em AS email,
      NULLIF(split_part(COALESCE(gi.full_name, ''), ' ', 1), '') AS first_name,
      NULLIF(regexp_replace(COALESCE(gi.full_name, ''), '^\S+\s*', ''), '') AS last_name,
      NULLIF(btrim(COALESCE(gi.ph, '')), '') AS phone,
      ga.first_at AS first_visit_at,
      ga.last_at AS last_visit_at,
      COALESCE(ga.total_spent, 0) AS total_spent,
      ga.ticket_count::int, ga.order_count::int, ga.table_count::int,
      (vbe.email IS NOT NULL) AS is_banned,
      vbe.banned_at,
      vbe.ban_reason,
      NULL::text AS notes,
      ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS visits_per_month,
      ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, ga.last_at, ga.first_at, now()))) / 86400)::int AS recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE (ga.ticket_count + ga.order_count + ga.table_count)::int
      END AS rfm_freq,
      COALESCE(ga.total_spent, 0)::numeric AS rfm_money,
      true AS is_guest
    FROM guest_agg ga
    LEFT JOIN guest_identity gi ON gi.em = ga.em
    LEFT JOIN agg ag ON ag.em = ga.em
    LEFT JOIN pref_event pe ON pe.em = ga.em
    LEFT JOIN pref_dow pd ON pd.em = ga.em
    LEFT JOIN venue_banned_emails vbe ON vbe.venue_id = p_venue_id AND lower(vbe.email) = ga.em
  ),
  ranked AS (
    SELECT b.*,
      count(*) OVER () AS n_total,
      (rank() OVER (ORDER BY b.rfm_freq) - 1)::numeric  AS freq_below,
      (rank() OVER (ORDER BY b.rfm_money) - 1)::numeric AS mon_below
    FROM base b
  ),
  scored AS (
    SELECT rk.*,
      -- R n'est PLUS relatif : la récence est un fait de calendrier, pas une
      -- opinion sur la population. C'est là qu'était le mensonge — sur un
      -- fichier de deux personnes, la moins récente des deux tombait à 1/5 et
      -- passait « Perdue » alors qu'elle s'était inscrite l'avant-veille. Les
      -- paliers sont ceux annoncés au client dans le mode d'emploi.
      CASE WHEN rk.recency_days <= 14 THEN 5
           WHEN rk.recency_days <= 30 THEN 4
           WHEN rk.recency_days <= 60 THEN 3
           WHEN rk.recency_days <= 90 THEN 2
           ELSE 1 END AS s_r,
      -- F : bande absolue en nuits, affinée ±1 par la position dans le fichier
      -- (un club qui tourne chaque semaine n'a pas le rythme d'une soirée
      -- mensuelle). M reste purement relatif : « gros dépensier » ne veut rien
      -- dire hors du contexte du lieu.
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.freq_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS rel_f,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.mon_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_m,
      CASE WHEN rk.rfm_freq >= 10 THEN 5
           WHEN rk.rfm_freq >= 6 THEN 4
           WHEN rk.rfm_freq >= 3 THEN 3
           WHEN rk.rfm_freq >= 2 THEN 2
           ELSE 1 END AS abs_f
    FROM ranked rk
  ),
  blended AS (
    SELECT s.*,
      least(5, greatest(1, least(greatest(s.rel_f, s.abs_f - 1), s.abs_f + 1))) AS s_f
    FROM scored s
  )
  SELECT
    s.id, s.user_id, s.email, s.first_name, s.last_name, s.phone,
    s.first_visit_at, s.last_visit_at, s.total_spent,
    s.ticket_count, s.order_count, s.table_count,
    s.is_banned, s.banned_at, s.ban_reason, s.notes,
    s.revenue_30d, s.revenue_90d, s.revenue_prev_90d, s.avg_basket,
    s.visit_nights, s.visits_per_month,
    s.last_activity_at, s.preferred_dow, s.preferred_event_title,
    s.recency_days,
    s.s_r::int AS rfm_r, s.s_f::int AS rfm_f, s.s_m::int AS rfm_m,
    (CASE
      WHEN s.s_r >= 4 AND s.s_f >= 4 THEN 'champions'
      -- « Était régulier, se met en silence » passe AVANT « fidèle » : un
      -- habitué muet depuis trois mois est le client à rappeler ce soir, pas
      -- une ligne rassurante dans le camembert. L'ordre inverse le rangeait en
      -- « Fidèles » et le club ne le voyait jamais partir.
      WHEN s.s_r <= 2 AND s.s_f >= 3 THEN 'at_risk'
      WHEN s.s_f >= 4 THEN 'loyal'
      WHEN s.s_r >= 4 AND s.s_f <= 2 THEN CASE WHEN s.s_m >= 3 THEN 'promising' ELSE 'new' END
      WHEN s.s_r >= 3 THEN 'loyal'
      WHEN s.s_r = 2 THEN 'dormant'
      ELSE 'lost'
    END)::text AS rfm_segment,
    (CASE
      WHEN s.s_m >= 5 THEN 'platinum'
      WHEN s.s_m >= 4 THEN 'gold'
      WHEN s.s_m >= 2 THEN 'silver'
      ELSE 'bronze'
    END)::text AS rfm_tier,
    (s.s_f >= 3 AND s.recency_days > 45 AND s.recency_days <= 180) AS churn_risk,
    s.is_guest
  FROM blended s
  ORDER BY s.last_visit_at DESC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.account_products(p_scope_key text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v text[];
BEGIN
  IF p_scope_key LIKE 'venue:%' THEN
    SELECT ARRAY[product] || extra_products INTO v FROM public.venues WHERE id = substr(p_scope_key, 7);
  ELSIF p_scope_key ~ '^org:[0-9a-fA-F-]{36}$' THEN
    SELECT ARRAY[product] || extra_products INTO v FROM public.organizer_profiles WHERE user_id = substr(p_scope_key, 5)::uuid;
  END IF;
  RETURN COALESCE(v, '{}'::text[]);
END;
$function$;

CREATE OR REPLACE FUNCTION public.analytics_scope_gate(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(ok boolean, reason text, scope_venue text, scope_org uuid, money boolean, tz text, scope_ids uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_money boolean := false;
  v_tz    text := 'Europe/Paris';
  v_ids   uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, null::text, null::uuid, false, v_tz, '{}'::uuid[]; RETURN;
  END IF;
  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT (v_uid = p_organizer_user_id OR public.is_super_admin()
            OR public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')) THEN
      RETURN QUERY SELECT false, 'forbidden'::text, null::text, null::uuid, false, v_tz, '{}'::uuid[]; RETURN;
    END IF;
    v_money := v_uid = p_organizer_user_id OR public.is_super_admin()
               OR public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ids FROM public.events x
     WHERE (x.organizer_user_id = p_organizer_user_id OR x.partner_organizer_id = p_organizer_user_id
        OR x.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id)))
       AND x.external_source IS NULL;
    RETURN QUERY SELECT true, null::text, null::text, p_organizer_user_id, v_money, v_tz, v_ids; RETURN;
  END IF;
  IF p_venue_id IS NULL OR NOT (public.can_manage_venue(v_uid, p_venue_id) OR public.is_super_admin()) THEN
    RETURN QUERY SELECT false, 'forbidden'::text, null::text, null::uuid, false, v_tz, '{}'::uuid[]; RETURN;
  END IF;
  v_money := public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                  AND (coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false)));
  SELECT coalesce(v.timezone, 'Europe/Paris') INTO v_tz FROM public.venues v WHERE v.id = p_venue_id;
  SELECT coalesce(array_agg(x.id), '{}') INTO v_ids FROM public.events x
   WHERE (x.venue_id = p_venue_id OR x.partner_venue_id = p_venue_id
      OR x.id IN (SELECT public.cohost_event_ids_venue(p_venue_id)))
     AND x.external_source IS NULL;
  RETURN QUERY SELECT true, null::text, p_venue_id, null::uuid, v_money, coalesce(v_tz, 'Europe/Paris'), v_ids;
END;
$function$;

CREATE OR REPLACE FUNCTION public.attribution_from_session(p_referrer_category text, p_referrer_domain text, p_utm_source text, p_utm_medium text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN lower(coalesce(p_utm_medium, '')) = 'paid_social' OR lower(coalesce(p_utm_source, '')) IN ('meta', 'meta_ads', 'facebook_ads') THEN 'meta_ads'
    WHEN lower(coalesce(p_utm_medium, '')) IN ('party_link', 'coorg') THEN 'partner'
    WHEN lower(coalesce(p_utm_source, '')) IN ('newsletter', 'email', 'mail') OR lower(coalesce(p_utm_medium, '')) IN ('email', 'newsletter') OR p_referrer_category = 'email' THEN 'email'
    WHEN lower(coalesce(p_utm_source, '')) IN ('instagram', 'tiktok', 'facebook', 'whatsapp') THEN lower(p_utm_source)
    WHEN nullif(p_utm_source, '') IS NOT NULL THEN 'link'
    WHEN p_referrer_category = 'internal' THEN 'marketplace'
    WHEN p_referrer_category = 'paid_social' THEN 'meta_ads'
    WHEN p_referrer_category = 'social' THEN CASE
      WHEN p_referrer_domain ILIKE '%instagram%' THEN 'instagram'
      WHEN p_referrer_domain ILIKE '%tiktok%' THEN 'tiktok'
      WHEN p_referrer_domain ILIKE '%facebook%' OR p_referrer_domain ILIKE 'fb.%' THEN 'facebook'
      WHEN p_referrer_domain ILIKE '%whatsapp%' THEN 'whatsapp'
      ELSE 'social' END
    WHEN p_referrer_category IN ('search', 'referral') THEN p_referrer_category
    ELSE 'direct' END
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_event_design(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM events e
    LEFT JOIN venues v ON (v.id = e.venue_id OR v.id = e.partner_venue_id)
    WHERE e.id = _event_id
      AND (
        is_super_admin()
        OR (v.owner_id = _user_id
            AND collab_domain_holder(e.collab_responsibilities, e.event_mode, 'design')
                = ANY (ARRAY['venue', 'both']))
        OR ((e.organizer_user_id = _user_id OR e.partner_organizer_id = _user_id)
            AND collab_domain_holder(e.collab_responsibilities, e.event_mode, 'design')
                = ANY (ARRAY['organizer', 'both']))
        OR is_org_team_member(_user_id, COALESCE(e.organizer_user_id, e.partner_organizer_id), 'editor')
      )
  ) OR public.is_event_cohost(_event_id, _user_id, 'editor');
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_organizer(p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    is_super_admin()
    OR p_organizer_user_id = auth.uid()
    OR is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_venue(_user_id uuid, _venue_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id = _venue_id AND v.owner_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.manager_permissions mp
      WHERE mp.user_id = _user_id
        AND mp.venue_id = _venue_id
        AND (
          COALESCE(mp.can_manage_events, false)
          OR COALESCE(mp.can_manage_menu, false)
          OR COALESCE(mp.can_manage_staff, false)
          OR COALESCE(mp.can_view_orders, false)
          OR COALESCE(mp.can_manage_tickets, false)
          OR COALESCE(mp.can_manage_tables, false)
          OR COALESCE(mp.can_manage_djs, false)
          OR COALESCE(mp.can_manage_promoters, false)
          OR COALESCE(mp.can_view_analytics, false)
          OR COALESCE(mp.can_view_finance, false)
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_read_audience(p_subject_type text, p_subject_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN p_subject_type = 'dj' THEN
      p_subject_id::uuid = auth.uid()
      OR public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.dj_team_members
         WHERE member_user_id = auth.uid()
           AND dj_user_id = p_subject_id::uuid
           AND status = 'active'
      )
    WHEN p_subject_type = 'venue' THEN
      public.is_venue_owner(auth.uid(), p_subject_id) OR public.is_super_admin()
    WHEN p_subject_type = 'organizer' THEN
      public.can_manage_organizer(p_subject_id::uuid)
    WHEN p_subject_type = 'agency' THEN
      public.is_agency_owner(auth.uid(), p_subject_id::uuid) OR public.is_super_admin()
    ELSE false
  END
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.canonical_music_genre(p_raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.music_genre_key(p_raw);
BEGIN
  IF v_key = '' THEN
    RETURN NULL;
  END IF;

  RETURN CASE v_key
    WHEN 'house'            THEN 'House'
    WHEN 'deep house'       THEN 'House'
    WHEN 'tech house'       THEN 'House'
    WHEN 'afro house'       THEN 'House'

    WHEN 'techno'           THEN 'Techno'
    WHEN 'hard techno'      THEN 'Techno'

    WHEN 'rap'              THEN 'Rap / Hip-Hop'
    WHEN 'hip hop'          THEN 'Rap / Hip-Hop'
    WHEN 'hiphop'           THEN 'Rap / Hip-Hop'
    WHEN 'rap hip hop'      THEN 'Rap / Hip-Hop'
    WHEN 'r b'              THEN 'Rap / Hip-Hop'
    WHEN 'rnb'              THEN 'Rap / Hip-Hop'
    WHEN 'urban'            THEN 'Rap / Hip-Hop'
    WHEN 'trap'             THEN 'Rap / Hip-Hop'

    WHEN 'afro'             THEN 'Afro / Shatta'
    WHEN 'afro shatta'      THEN 'Afro / Shatta'
    WHEN 'afrobeat'         THEN 'Afro / Shatta'
    WHEN 'afrobeats'        THEN 'Afro / Shatta'
    WHEN 'shatta'           THEN 'Afro / Shatta'
    WHEN 'dancehall'        THEN 'Afro / Shatta'
    WHEN 'amapiano'         THEN 'Afro / Shatta'

    WHEN 'reggaeton'        THEN 'Reggaeton / Latino'
    WHEN 'reggaeton latino' THEN 'Reggaeton / Latino'
    WHEN 'latino'           THEN 'Reggaeton / Latino'
    WHEN 'latin'            THEN 'Reggaeton / Latino'
    WHEN 'latina'           THEN 'Reggaeton / Latino'
    WHEN 'salsa'            THEN 'Reggaeton / Latino'
    WHEN 'bachata'          THEN 'Reggaeton / Latino'

    WHEN 'commercial'       THEN 'Commercial / Hits'
    WHEN 'commercial hits'  THEN 'Commercial / Hits'
    WHEN 'hits'             THEN 'Commercial / Hits'
    WHEN 'mainstream'       THEN 'Commercial / Hits'
    WHEN 'pop'              THEN 'Commercial / Hits'
    WHEN 'top 40'           THEN 'Commercial / Hits'
    WHEN 'disco'            THEN 'Commercial / Hits'

    WHEN 'electro'          THEN 'Electro / EDM'
    WHEN 'electro edm'      THEN 'Electro / EDM'
    WHEN 'electronic'       THEN 'Electro / EDM'
    WHEN 'electronique'     THEN 'Electro / EDM'
    WHEN 'edm'              THEN 'Electro / EDM'
    WHEN 'trance'           THEN 'Electro / EDM'
    WHEN 'drum bass'        THEN 'Electro / EDM'
    WHEN 'drum and bass'    THEN 'Electro / EDM'
    WHEN 'dnb'              THEN 'Electro / EDM'

    WHEN 'open'             THEN 'Open Format'
    WHEN 'open format'      THEN 'Open Format'
    WHEN 'openformat'       THEN 'Open Format'
    WHEN 'all styles'       THEN 'Open Format'
    WHEN 'varie'            THEN 'Open Format'
    WHEN 'multi'            THEN 'Open Format'

    ELSE btrim(p_raw)
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_music_genres(p_raw text[])
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_raw IS NULL THEN NULL
    ELSE coalesce(
      (SELECT array_agg(g ORDER BY ord)
         FROM (
           SELECT public.canonical_music_genre(v) AS g, min(o) AS ord
             FROM unnest(p_raw) WITH ORDINALITY AS t(v, o)
            WHERE public.canonical_music_genre(v) IS NOT NULL
            GROUP BY 1
         ) s),
      '{}'::text[]
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.cohost_event_ids_org(p_org uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.event_id FROM public.event_cohosts c
   WHERE c.organizer_user_id = p_org AND c.status = 'accepted';
$function$;

CREATE OR REPLACE FUNCTION public.cohost_event_ids_subject(p_subject text)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org uuid;
BEGIN
  BEGIN v_org := p_subject::uuid; EXCEPTION WHEN others THEN RETURN; END;
  RETURN QUERY SELECT c.event_id FROM public.event_cohosts c
                WHERE c.organizer_user_id = v_org AND c.status = 'accepted';
END;
$function$;

CREATE OR REPLACE FUNCTION public.cohost_event_ids_venue(p_venue text)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.event_id FROM public.event_cohosts c
   WHERE c.venue_id = p_venue AND c.status = 'accepted';
$function$;

CREATE OR REPLACE FUNCTION public.contact_base_cache_fresh(p_built_at timestamp with time zone, p_dirty_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT p_built_at > now() - interval '3 minutes'
     AND (p_dirty_at IS NULL OR p_dirty_at < p_built_at);
$function$;

CREATE OR REPLACE FUNCTION public.contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
$function$;

CREATE OR REPLACE FUNCTION public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_n integer;
  v_key text := public.contact_base_scope_key(p_venue_id, p_organizer_user_id);
  v_state public.contact_base_cache_state%ROWTYPE;
  v_have boolean;
  v_use_cache boolean;
  v_read_only boolean := COALESCE(current_setting('transaction_read_only', true), 'off') = 'on';
BEGIN
  DROP TABLE IF EXISTS _cr;

  SELECT * INTO v_state FROM public.contact_base_cache_state s WHERE s.scope_key = v_key;
  v_have := FOUND;

  IF NOT v_read_only
     AND NOT (v_have AND public.contact_base_cache_fresh(v_state.built_at, v_state.dirty_at))
     AND (NOT v_have OR COALESCE(v_state.row_count, 0) <= 3000) THEN
    -- Première lecture, ou petite portée : on reconstruit tout de suite (un
    -- import de 200 contacts se voit à l'écran suivant). Un seul reconstructeur
    -- par portée : l'appel parallèle attend ici puis trouve le cache frais.
    PERFORM pg_advisory_xact_lock(hashtext('contact_base_cache:' || v_key));
    SELECT * INTO v_state FROM public.contact_base_cache_state s WHERE s.scope_key = v_key;
    IF NOT (FOUND AND public.contact_base_cache_fresh(v_state.built_at, v_state.dirty_at)) THEN
      PERFORM public._contact_base_cache_build(v_key, p_venue_id, p_organizer_user_id, true);
    END IF;
    v_have := true;
  ELSIF v_have AND NOT v_read_only
        AND (v_state.last_read_at IS NULL OR v_state.last_read_at < now() - interval '1 minute') THEN
    -- Grande portée périmée : on sert le cache tel quel, et on signale la
    -- lecture — le cron la reconstruit dans la minute. SKIP LOCKED : une
    -- reconstruction en cours ne fait jamais attendre la page.
    UPDATE public.contact_base_cache_state s SET last_read_at = now()
     WHERE s.scope_key IN (SELECT s2.scope_key FROM public.contact_base_cache_state s2
                            WHERE s2.scope_key = v_key FOR UPDATE SKIP LOCKED);
  END IF;
  -- Aperçu démo (transaction en lecture seule) : le cache s'il existe, sinon
  -- le calcul en direct comme avant.
  v_use_cache := v_have;

  CREATE TEMP TABLE _cr ON COMMIT DROP AS
  WITH base AS (
    SELECT c.id,
           c.list_import_id,
           c.venue_id,
           c.organizer_user_id,
           c.email,
           c.phone_e164,
           c.first_name,
           c.last_name,
           c.country_code,
           c.country,
           c.region,
           c.city,
           c.postal_code,
           c.zone,
           c.age,
           c.gender,
           c.newsletter_opt_in,
           c.added_at,
           c.last_purchase_at,
           c.total_spent,
           c.event_count,
           c.extra,
           c.created_at,
           c.origin,
           c.user_id,
           c.imported_spent,
           c.imported_events,
           c.yuno_spent,
           c.yuno_events,
           c.yuno_first_at,
           c.yuno_last_at,
           c.ticket_count,
           c.table_count,
           c.order_count,
           c.guest_list_count,
           c.last_seen_at,
           c.eng_status,
           c.emails_sent,
           c.opens,
           c.clicks,
           c.last_opened_at,
           c.last_clicked_at,
           c.unsubscribed_at,
           c.bounced,
           c.subscribed,
           c.has_account
      FROM public.contact_base_cache c
     WHERE v_use_cache AND c.scope_key = v_key
    UNION ALL
    SELECT r.* FROM public.contact_rows(p_venue_id, p_organizer_user_id) r
     WHERE NOT v_use_cache
  ), ok_e AS (
    SELECT DISTINCT lower(ns.email) AS e
      FROM public.newsletter_subscriptions ns
     WHERE ns.opted_in
       AND (public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id))
  ), sup AS (
    SELECT DISTINCT lower(s.email) AS e FROM public.email_suppressions s
  ), ok_p AS (
    SELECT DISTINCT vc.phone_e164 AS p
      FROM public.venue_sms_contacts vc
     WHERE NOT vc.unsubscribed
       AND vc.sms_consent_at > now() - interval '36 months'
       AND (public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id))
  )
  SELECT b.*,
         (b.email IS NOT NULL AND oe.e IS NOT NULL AND s.e IS NULL) AS email_ok,
         (b.phone_e164 IS NOT NULL AND op.p IS NOT NULL) AS phone_ok
    FROM base b
    LEFT JOIN ok_e oe ON oe.e = b.email
    LEFT JOIN sup s ON s.e = b.email
    LEFT JOIN ok_p op ON op.p = b.phone_e164;
  SELECT count(*) INTO v_n FROM _cr;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.contact_definition_predicate(p_definition jsonb, p_alias text DEFAULT 'c'::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  c jsonb;
  parts text[] := '{}';
  a text := quote_ident(COALESCE(p_alias, 'c'));
  t text; op text; sqlop text; v text; lst text; vmin text; vmax text;
BEGIN
  IF p_definition IS NULL OR jsonb_typeof(p_definition->'conditions') <> 'array' THEN
    RETURN 'false';
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(p_definition->'conditions') LOOP
    t := c->>'type';
    op := c->>'op';
    sqlop := CASE op WHEN 'gte' THEN '>=' WHEN 'gt' THEN '>' WHEN 'lte' THEN '<=' WHEN 'lt' THEN '<' WHEN 'eq' THEN '=' ELSE NULL END;
    v := c->>'value';
    IF t IN ('country','country_not','zone','city','region','gender','list','engagement','origin') THEN
      SELECT string_agg(format('%L', CASE
                 WHEN t IN ('country','country_not') THEN upper(btrim(x))
                 WHEN t IN ('zone','city','region') THEN lower(btrim(x))
                 ELSE x END), ',')
        INTO lst
        FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c->'in') = 'array' THEN c->'in' ELSE '[]'::jsonb END) x;
      IF lst IS NULL THEN parts := array_append(parts, 'false'); CONTINUE; END IF;
    END IF;

    CASE t
      WHEN 'country' THEN
        parts := parts || format('(upper(COALESCE(%s.country_code, '''')) IN (%s))', a, lst);
      WHEN 'country_not' THEN
        parts := parts || format('(%s.country_code IS NOT NULL AND upper(%s.country_code) NOT IN (%s))', a, a, lst);
      WHEN 'zone' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.zone, ''''))) IN (%s))', a, lst);
      WHEN 'city' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.city, ''''))) IN (%s))', a, lst);
      WHEN 'region' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.region, ''''))) IN (%s))', a, lst);
      WHEN 'gender' THEN
        parts := parts || format('(COALESCE(%s.gender, '''') IN (%s))', a, lst);
      WHEN 'list' THEN
        parts := parts || format('(%s.list_import_id::text IN (%s))', a, lst);
      WHEN 'engagement' THEN
        parts := parts || format('(COALESCE(%s.eng_status, ''new'') IN (%s))', a, lst);
      WHEN 'origin' THEN
        parts := parts || format('(COALESCE(%s.origin, '''') IN (%s))', a, lst);
      WHEN 'spent' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.total_spent %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'spent_per_event' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((%s.total_spent / NULLIF(%s.event_count, 0)) %s %s::numeric, false)', a, a, sqlop, v); END IF;
      WHEN 'events' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.event_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'tables' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.table_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'tickets' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.ticket_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'orders' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.order_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_seen_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_seen_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'guest_lists' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.guest_list_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'emails_received' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.emails_sent %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'opens' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.opens %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'clicks' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.clicks %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_purchase_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_purchase_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_open_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_opened_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_click_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_clicked_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'added_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.added_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'age' THEN
        vmin := COALESCE(c->>'min', '0'); vmax := COALESCE(c->>'max', '200');
        IF vmin !~ '^[0-9]{1,3}$' OR vmax !~ '^[0-9]{1,3}$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.age BETWEEN %s AND %s, false)', a, vmin, vmax); END IF;
      WHEN 'newsletter_opt_in' THEN
        parts := parts || format('COALESCE(%s.newsletter_opt_in = %L::boolean, false)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_email' THEN
        parts := parts || format('((%s.email IS NOT NULL) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_phone' THEN
        parts := parts || format('((%s.phone_e164 IS NOT NULL) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      WHEN 'yuno_customer' THEN
        parts := parts || format('((COALESCE(%s.origin, '''') IN (''yuno'',''both'')) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_account' THEN
        parts := parts || format('(COALESCE(%s.has_account, false) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      ELSE
        parts := array_append(parts, 'false');
    END CASE;
  END LOOP;
  IF array_length(parts, 1) IS NULL THEN RETURN 'true'; END IF;
  RETURN '(' || array_to_string(parts, ' AND ') || ')';
END;
$function$;

CREATE OR REPLACE FUNCTION public.contact_rows(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(id uuid, list_import_id uuid, venue_id text, organizer_user_id uuid, email text, phone_e164 text, first_name text, last_name text, country_code text, country text, region text, city text, postal_code text, zone text, age integer, gender text, newsletter_opt_in boolean, added_at timestamp with time zone, last_purchase_at timestamp with time zone, total_spent numeric, event_count integer, extra jsonb, created_at timestamp with time zone, origin text, user_id uuid, imported_spent numeric, imported_events integer, yuno_spent numeric, yuno_events integer, yuno_first_at timestamp with time zone, yuno_last_at timestamp with time zone, ticket_count integer, table_count integer, order_count integer, guest_list_count integer, last_seen_at timestamp with time zone, eng_status text, emails_sent integer, opens integer, clicks integer, last_opened_at timestamp with time zone, last_clicked_at timestamp with time zone, unsubscribed_at timestamp with time zone, bounced boolean, subscribed boolean, has_account boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
  WITH imp AS (
    SELECT DISTINCT ON (COALESCE(c.email, c.phone_e164)) c.*
      FROM public.imported_contacts c
     WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY COALESCE(c.email, c.phone_e164),
              c.created_at DESC,
              ((c.phone_e164 IS NOT NULL)::int + (c.total_spent IS NOT NULL)::int + (c.event_count IS NOT NULL)::int
               + (c.last_purchase_at IS NOT NULL)::int + (c.zone IS NOT NULL)::int + (c.city IS NOT NULL)::int
               + (c.country_code IS NOT NULL)::int + (c.age IS NOT NULL)::int + (c.gender IS NOT NULL)::int) DESC,
              c.id
  ), yc AS (
    SELECT * FROM public.contact_scope_customers(p_venue_id, p_organizer_user_id)
  ), eng AS (
    SELECT ce.* FROM public.contact_engagement ce
     WHERE public.marketing_scope_match(ce.venue_id, ce.organizer_user_id, p_venue_id, p_organizer_user_id)
  )
  SELECT
    COALESCE(i.id, md5('yuno:' || y.email)::uuid) AS id,
    i.list_import_id,
    COALESCE(i.venue_id, p_venue_id) AS venue_id,
    COALESCE(i.organizer_user_id, p_organizer_user_id) AS organizer_user_id,
    COALESCE(i.email, y.email) AS email,
    COALESCE(i.phone_e164, CASE WHEN y.phone ~ '^\+[1-9][0-9]{6,14}$' THEN y.phone END) AS phone_e164,
    COALESCE(y.first_name, i.first_name) AS first_name,
    COALESCE(y.last_name, i.last_name) AS last_name,
    i.country_code, i.country, i.region,
    COALESCE(i.city, y.city) AS city,
    i.postal_code, i.zone,
    COALESCE(i.age, y.age) AS age,
    COALESCE(i.gender, y.gender) AS gender,
    COALESCE(i.newsletter_opt_in, CASE WHEN y.subscribed THEN true END) AS newsletter_opt_in,
    LEAST(i.added_at, y.first_at) AS added_at,
    GREATEST(i.last_purchase_at, y.last_paid_at) AS last_purchase_at,
    CASE WHEN i.total_spent IS NULL AND y.spent IS NULL THEN NULL
         ELSE COALESCE(i.total_spent, 0) + COALESCE(y.spent, 0) END AS total_spent,
    CASE WHEN i.event_count IS NULL AND y.event_count IS NULL THEN NULL
         ELSE COALESCE(i.event_count, 0) + COALESCE(y.event_count, 0) END AS event_count,
    i.extra,
    COALESCE(i.created_at, y.first_at, now()) AS created_at,
    CASE WHEN i.id IS NOT NULL AND y.email IS NOT NULL THEN 'both'
         WHEN i.id IS NOT NULL THEN 'import'
         ELSE 'yuno' END AS origin,
    COALESCE(y.user_id, e.user_id) AS user_id,
    i.total_spent AS imported_spent,
    i.event_count AS imported_events,
    y.spent AS yuno_spent,
    y.event_count AS yuno_events,
    y.first_at AS yuno_first_at,
    y.last_at AS yuno_last_at,
    COALESCE(y.ticket_count, 0) AS ticket_count,
    COALESCE(y.table_count, 0) AS table_count,
    COALESCE(y.order_count, 0) AS order_count,
    COALESCE(y.guest_list_count, 0) AS guest_list_count,
    GREATEST(i.last_purchase_at, y.last_at, e.last_clicked_at, e.last_opened_at) AS last_seen_at,
    COALESCE(e.status, 'new') AS eng_status,
    COALESCE(e.emails_sent, 0) AS emails_sent,
    COALESCE(e.opens, 0) AS opens,
    COALESCE(e.clicks, 0) AS clicks,
    e.last_opened_at, e.last_clicked_at, e.unsubscribed_at,
    (e.bounced_at IS NOT NULL) AS bounced,
    COALESCE(e.subscribed, y.subscribed, false) AS subscribed,
    (COALESCE(y.user_id, e.user_id) IS NOT NULL) AS has_account
  FROM imp i
  FULL OUTER JOIN yc y ON y.email = i.email
  LEFT JOIN eng e ON e.email = COALESCE(i.email, y.email);
$function$;

CREATE OR REPLACE FUNCTION public.contact_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.sms_scope_allowed(p_venue_id, p_organizer_user_id)
      OR (auth.uid() IS NOT NULL AND p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL
          AND public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin'));
$function$;

CREATE OR REPLACE FUNCTION public.contact_scope_customers(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(email text, user_id uuid, first_name text, last_name text, phone text, spent numeric, event_count integer, paid_count integer, ticket_count integer, table_count integer, order_count integer, guest_list_count integer, first_at timestamp with time zone, last_at timestamp with time zone, last_paid_at timestamp with time zone, city text, age integer, gender text, subscribed boolean, sub_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id
      FROM public.events e
     WHERE (p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
        OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id))
  ), act AS (
    SELECT lower(btrim(t.user_email)) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind, t.user_id,
           COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS fn,
           COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS ln,
           NULLIF(btrim(COALESCE(t.phone, t.guest_phone, '')), '') AS ph
      FROM public.tickets t JOIN ev ON ev.id = t.event_id
     WHERE t.user_email IS NOT NULL AND btrim(t.user_email) <> '' AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(btrim(tr.user_email)),
           (tr.total_price - COALESCE(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END))::numeric,
           tr.created_at, tr.event_id, 'table', tr.user_id,
           COALESCE(tr.guest_first_name, NULLIF(split_part(btrim(COALESCE(tr.full_name, '')), ' ', 1), '')),
           COALESCE(tr.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(tr.full_name, ''), '^\S+\s*', '')), '')),
           NULLIF(btrim(COALESCE(tr.phone, tr.guest_phone, '')), '')
      FROM public.table_reservations tr JOIN ev ON ev.id = tr.event_id
     WHERE tr.user_email IS NOT NULL AND btrim(tr.user_email) <> ''
       AND (tr.paid_at IS NOT NULL OR tr.status IN ('paid', 'confirmed'))
    UNION ALL
    SELECT lower(btrim(o.user_email)),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id, 'order', o.user_id,
           o.guest_first_name, o.guest_last_name,
           NULLIF(btrim(COALESCE(o.guest_phone, '')), '')
      FROM public.orders o
     WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id
       AND o.user_email IS NOT NULL AND btrim(o.user_email) <> '' AND o.status = 'paid'
    UNION ALL
    SELECT lower(btrim(gle.email)),
           0::numeric,
           gle.created_at, gl.event_id, 'guestlist', gle.user_id,
           NULLIF(split_part(btrim(COALESCE(gle.full_name, '')), ' ', 1), ''),
           NULLIF(btrim(regexp_replace(COALESCE(gle.full_name, ''), '^\S+\s*', '')), ''),
           NULLIF(btrim(COALESCE(gle.phone, '')), '')
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
      JOIN ev ON ev.id = gl.event_id
     WHERE gle.email IS NOT NULL AND btrim(gle.email) <> '' AND gle.status <> 'cancelled'
    UNION ALL
    -- Yuno CRM : billets d'une billetterie connectée (Shotgun), comptés comme
    -- des billets. Valeur faciale hors frais ; remboursés / annulés exclus.
    SELECT xt.buyer_email,
           (COALESCE(xt.price, 0) * GREATEST(xt.quantity, 1))::numeric,
           COALESCE(xt.purchased_at, xt.first_seen_at), xt.event_id, 'ticket', NULL::uuid,
           xt.buyer_first_name, xt.buyer_last_name, xt.buyer_phone
      FROM public.external_tickets xt
     WHERE ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
       AND xt.buyer_email IS NOT NULL
       AND xt.status IN ('valid', 'transferred')
  ), agg AS (
    SELECT a.em,
           COALESCE(sum(a.amount), 0) AS spent,
           count(DISTINCT a.event_id) AS event_count,
           count(*) FILTER (WHERE a.kind <> 'guestlist') AS paid_count,
           count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
           count(*) FILTER (WHERE a.kind = 'table') AS table_count,
           count(*) FILTER (WHERE a.kind = 'order') AS order_count,
           count(*) FILTER (WHERE a.kind = 'guestlist') AS guest_list_count,
           min(a.created_at) AS first_at,
           max(a.created_at) AS last_at,
           max(a.created_at) FILTER (WHERE a.kind <> 'guestlist') AS last_paid_at,
           (array_agg(a.user_id ORDER BY a.created_at DESC) FILTER (WHERE a.user_id IS NOT NULL))[1] AS uid,
           (array_agg(a.fn ORDER BY a.created_at DESC) FILTER (WHERE a.fn IS NOT NULL))[1] AS fn,
           (array_agg(a.ln ORDER BY a.created_at DESC) FILTER (WHERE a.ln IS NOT NULL))[1] AS ln,
           (array_agg(a.ph ORDER BY a.created_at DESC) FILTER (WHERE a.ph IS NOT NULL))[1] AS ph
      FROM act a
     GROUP BY a.em
  ), subs AS (
    -- Abonnés entrés par une surface Yuno (jamais par un fichier importé).
    SELECT lower(ns.email) AS em,
           bool_or(ns.opted_in AND ns.opted_out_at IS NULL) AS subscribed,
           max(ns.source) AS src,
           (array_agg(ns.user_id) FILTER (WHERE ns.user_id IS NOT NULL))[1] AS uid,
           max(ns.first_name) AS fn, max(ns.last_name) AS ln
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ns.import_id IS NULL
       AND COALESCE(ns.source, '') NOT LIKE '%import%'
     GROUP BY lower(ns.email)
  ), merged AS (
    SELECT COALESCE(a.em, s.em) AS em,
           COALESCE(a.uid, s.uid) AS uid,
           a.spent, a.event_count, a.paid_count, a.ticket_count, a.table_count, a.order_count, a.guest_list_count,
           a.first_at, a.last_at, a.last_paid_at,
           COALESCE(a.fn, s.fn) AS fn, COALESCE(a.ln, s.ln) AS ln, a.ph,
           COALESCE(s.subscribed, false) AS subscribed, s.src
      FROM agg a
      FULL OUTER JOIN subs s ON s.em = a.em
  )
  SELECT m.em::text AS email,
         COALESCE(m.uid, p.id) AS user_id,
         COALESCE(p.first_name, m.fn)::text AS first_name,
         COALESCE(p.last_name, m.ln)::text AS last_name,
         COALESCE(m.ph, p.phone)::text AS phone,
         m.spent, m.event_count::int, m.paid_count::int, m.ticket_count::int, m.table_count::int,
         m.order_count::int, m.guest_list_count::int, m.first_at, m.last_at, m.last_paid_at,
         NULLIF(btrim(COALESCE(p.city, '')), '')::text AS city,
         CASE WHEN p.birth_date IS NOT NULL THEN date_part('year', age(p.birth_date))::int END AS age,
         CASE
           WHEN lower(COALESCE(p.gender, '')) IN ('female', 'f', 'femme', 'woman', 'mujer') THEN 'female'
           WHEN lower(COALESCE(p.gender, '')) IN ('male', 'm', 'homme', 'man', 'hombre') THEN 'male'
           WHEN lower(COALESCE(p.gender, '')) IN ('other', 'autre', 'otro', 'non-binary', 'nb') THEN 'other'
         END::text AS gender,
         m.subscribed, m.src::text AS sub_source
    FROM merged m
    LEFT JOIN public.profiles p ON p.id = m.uid AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.uid AND u.deleted_at IS NULL)
   WHERE m.em IS NOT NULL AND position('@' in m.em) > 1;
$function$;

CREATE OR REPLACE FUNCTION public.coorg_cohost_sees_money(p_event_id uuid, p_party text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.partner_visibility = 'full')
     AND EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p
                  WHERE p.party_key = p_party AND p.role = 'cohost');
$function$;

CREATE OR REPLACE FUNCTION public.coorg_marketing_event_ids(p_venue text, p_org uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.id FROM (
    SELECT e.id FROM public.events e
     WHERE (p_venue IS NOT NULL AND e.partner_venue_id = p_venue)
        OR (p_org IS NOT NULL AND e.partner_organizer_id = p_org)
    UNION
    SELECT c.event_id FROM public.event_cohosts c
     WHERE c.status = 'accepted' AND c.share_crm
       AND ((p_venue IS NOT NULL AND c.venue_id = p_venue)
         OR (p_org IS NOT NULL AND c.organizer_user_id = p_org))
  ) u(id)
  -- Une soirée démo n'est jamais annoncée par la recette d'un vrai compte.
  WHERE NOT (u.id = ANY (public.demo_event_ids()));
$function$;

CREATE OR REPLACE FUNCTION public.coorg_party_level(p_uid uuid, p_party text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text := split_part(p_party, ':', 1);
  v_id   text := substr(p_party, length(split_part(p_party, ':', 1)) + 2);
  v_org  uuid;
BEGIN
  IF p_uid IS NULL OR p_party IS NULL OR v_id = '' THEN RETURN 0; END IF;
  -- Depuis l'API, on ne se renseigne que sur soi-même.
  IF session_user = 'authenticator' AND p_uid IS DISTINCT FROM auth.uid() THEN RETURN 0; END IF;
  IF v_kind = 'org' THEN
    BEGIN v_org := v_id::uuid; EXCEPTION WHEN others THEN RETURN 0; END;
    IF p_uid = v_org OR public.is_org_team_member(p_uid, v_org, 'admin') THEN RETURN 3; END IF;
    IF public.is_org_team_member(p_uid, v_org, 'editor') THEN RETURN 1; END IF;
    RETURN 0;
  ELSIF v_kind = 'venue' THEN
    IF EXISTS (SELECT 1 FROM public.venues v WHERE v.id = v_id AND v.owner_id = p_uid) THEN RETURN 3; END IF;
    IF EXISTS (SELECT 1 FROM public.manager_permissions mp
                WHERE mp.user_id = p_uid AND mp.venue_id = v_id AND COALESCE(mp.can_view_finance, false)) THEN
      RETURN 3;
    END IF;
    IF EXISTS (SELECT 1 FROM public.manager_permissions mp
                WHERE mp.user_id = p_uid AND mp.venue_id = v_id AND COALESCE(mp.can_manage_events, false)) THEN
      RETURN 2;
    END IF;
    IF public.can_manage_venue(p_uid, v_id) THEN RETURN 1; END IF;
    RETURN 0;
  END IF;
  RETURN 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.coorg_sees_event_money(p_event_id uuid, p_party text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p
                  WHERE p.party_key = p_party AND p.role IN ('lead', 'partner'))
      OR EXISTS (SELECT 1 FROM public.event_coorg_deals d
                  WHERE d.event_id = p_event_id AND d.status = 'active'
                    AND COALESCE((d.shares ->> p_party)::numeric, 0) > 0)
      OR public.coorg_cohost_sees_money(p_event_id, p_party);
$function$;

CREATE OR REPLACE FUNCTION public.count_campaign_recipients(p_venue_id text, p_type text, p_audience_type text, p_event_id uuid DEFAULT NULL::uuid, p_segment_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer := 0;
BEGIN
  IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Informational: acheteurs ticket d'un événement
  IF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.tickets
    WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL;
    RETURN v_count;
  END IF;

  -- Informational: réservations table d'un événement
  IF p_type = 'informational' AND p_audience_type = 'event_table_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.table_reservations
    WHERE event_id = p_event_id AND status = 'confirmed' AND user_email IS NOT NULL;
    RETURN v_count;
  END IF;

  -- Informational: tous les acheteurs (ticket + table)
  IF p_type = 'informational' AND p_audience_type = 'event_all_buyers' AND p_event_id IS NOT NULL THEN
    WITH emails AS (
      SELECT LOWER(user_email) AS e FROM public.tickets WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL
      UNION
      SELECT LOWER(user_email) FROM public.table_reservations WHERE event_id = p_event_id AND status = 'confirmed' AND user_email IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM emails;
    RETURN v_count;
  END IF;

  -- Marketing: filtrage commun = abonnés opt-in venue
  IF p_type = 'promotional' THEN
    IF p_audience_type = 'all_subscribers' THEN
      SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
      WHERE venue_id = p_venue_id AND opted_in = true;
    ELSIF p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
      FROM public.tickets t
      JOIN public.newsletter_subscriptions ns
        ON LOWER(ns.email) = LOWER(t.user_email) AND ns.venue_id = p_venue_id
      WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true;
    ELSIF p_audience_type = 'custom_segment' AND p_segment_id IS NOT NULL THEN
      -- Segment sauvegardé ∩ opt-in : même intersection que resolve_campaign_audience.
      SELECT COUNT(DISTINCT LOWER(ns.email)) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN public.resolve_venue_segment(
             p_venue_id,
             (SELECT vs.definition FROM public.venue_segments vs
               WHERE vs.id = p_segment_id AND vs.venue_id = p_venue_id)
           ) seg ON LOWER(seg.email) = LOWER(ns.email)
      WHERE ns.venue_id = p_venue_id AND ns.opted_in = true;
    ELSIF p_audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
      SELECT COUNT(*) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc
        ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = p_venue_id
      WHERE ns.venue_id = p_venue_id AND ns.opted_in = true
        AND CASE p_audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
    END IF;
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_contact_segment_def(p_venue_id text, p_organizer_user_id uuid, p_definition jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v_n integer; v_e integer; v_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);
  EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                 public.contact_definition_predicate(p_definition, 'c'))
    INTO v_n, v_e, v_p;
  DROP TABLE IF EXISTS _cr;
  RETURN jsonb_build_object('contacts', COALESCE(v_n,0), 'emails', COALESCE(v_e,0), 'phones', COALESCE(v_p,0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_organizer_audience_kinds(p_organizer_user_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF p_organizer_user_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF NOT (COALESCE(auth.role(), '') = 'service_role'
          OR p_organizer_user_id = auth.uid()
          OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Mêmes seuils que resolve_campaign_audience (portée organisateur) : ce que
  -- l'écran affiche est ce que l'envoi résoudra.
  WITH cust AS (
    SELECT c.email, COALESCE(c.spent, 0) AS spent, COALESCE(c.event_count, 0) AS visits, c.last_at
      FROM public.contact_scope_customers(NULL, p_organizer_user_id) c
  ), subs AS (
    SELECT DISTINCT ON (LOWER(ns.email)) LOWER(ns.email) AS addr, cu.spent, cu.visits, cu.last_at
      FROM public.newsletter_subscriptions ns
      LEFT JOIN cust cu ON cu.email = LOWER(ns.email)
     WHERE ns.organizer_user_id = p_organizer_user_id AND ns.opted_in = true
     ORDER BY LOWER(ns.email)
  )
  SELECT jsonb_build_object(
    'all_subscribers', count(*),
    'vip',           count(*) FILTER (WHERE COALESCE(s.spent, 0) >= 500),
    'big_spenders',  count(*) FILTER (WHERE COALESCE(s.spent, 0) >= 1000),
    'regulars',      count(*) FILTER (WHERE COALESCE(s.visits, 0) BETWEEN 2 AND 4),
    'new_customers', count(*) FILTER (WHERE COALESCE(s.visits, 0) <= 1),
    'dormant',       count(*) FILTER (WHERE s.last_at IS NOT NULL AND s.last_at < now() - interval '90 days'),
    'event_subscribers', CASE WHEN p_event_id IS NULL THEN 0 ELSE
      count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.tickets t
          WHERE t.event_id = p_event_id AND t.status = 'paid' AND LOWER(t.user_email) = s.addr)) END
  ) INTO v
  FROM subs s;
  RETURN COALESCE(v, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_ana_community(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._crm_money_gate(public.crm_ana_community__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.crm_ana_community__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_seg text;
  v_today date;
  v_series jsonb; v_lc jsonb; v_reach jsonb; v_stats jsonb; v_spark jsonb; v_cohort jsonb; v_hist jsonb;
  v_aud jsonb; v_age jsonb; v_city jsonb; v_top jsonb; v_wake jsonb; v_base_total int; v_base_prev int;
  v_next uuid;
  v_rules record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  v_n := (m->>'n')::int;
  v_seg := m->>'seg';
  v_today := (m->>'today')::date;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  -- Les personnes regardées : toute la base, ou le segment ; pour une soirée,
  -- ses acheteurs.
  DROP TABLE IF EXISTS _apeo;
  CREATE TEMP TABLE _apeo ON COMMIT DROP AS
  WITH fb AS (
    SELECT a.email, min(a.bought_at) AS first_buy FROM _atk_all a WHERE a.ok GROUP BY a.email
  ), cr AS (
    -- La fiche (âge, ville) : une ligne par adresse, jointe d'un coup.
    SELECT DISTINCT ON (lower(x.email)) lower(x.email) AS em, x.age, x.city
      FROM _cr x WHERE x.email IS NOT NULL
     ORDER BY lower(x.email), (x.age IS NULL), (x.city IS NULL)
  )
  SELECT p.*, LEAST(p.first_night, p.added_at, fb.first_buy) AS joined_at,
         c.age AS c_age, c.city AS c_city
    FROM _cp p
    LEFT JOIN fb ON fb.email = p.email
    LEFT JOIN cr c ON c.em = p.email
   WHERE (v_seg = 'all' OR p.lifecycle = v_seg)
     AND (m->>'mode' <> 'event' OR EXISTS (SELECT 1 FROM _atk_all a WHERE a.email = p.email AND a.ok
                                            AND a.event_id = (m->'event'->>'id')::uuid));

  -- Courbe : la base au total à la fin de chaque case, et les nouveaux venus.
  -- Pour une soirée : ses acheteurs, jour après jour.
  IF m->>'mode' = 'event' THEN
    SELECT jsonb_agg(jsonb_build_object(
             'total', (SELECT count(DISTINCT a.email) FROM _atk_all a JOIN _apeo p ON p.email = a.email
                        WHERE a.ok AND a.ci IS NOT NULL AND a.ci <= g),
             'new', (SELECT count(DISTINCT a.email) FROM _atk_all a JOIN _apeo p ON p.email = a.email
                      WHERE a.ok AND a.ci = g
                        AND NOT EXISTS (SELECT 1 FROM _atk_all b WHERE b.email = a.email AND b.ok AND b.bought_at < a.bought_at)),
             'prev_total', (SELECT count(DISTINCT a.email) FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL AND a.pi <= g),
             'prev_new', (SELECT count(DISTINCT a.email) FROM _atk_all a WHERE a.ok AND a.pi = g
                           AND NOT EXISTS (SELECT 1 FROM _atk_all b WHERE b.email = a.email AND b.ok AND b.bought_at < a.bought_at))
           ) ORDER BY g)
      INTO v_series FROM generate_series(0, v_n - 1) g;
  ELSE
    SELECT jsonb_agg(jsonb_build_object(
             'total', (SELECT count(*) FROM _apeo p WHERE p.joined_at IS NOT NULL
                        AND public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int)
                            <= CASE m->>'mode'
                                 WHEN 'hour' THEN public._crm_night_date((m->>'start')::timestamptz + make_interval(hours => g + 1), m->>'tz', (m->>'night_end_hour')::int)
                                 WHEN 'month' THEN ((m->>'start')::date + make_interval(months => g + 1) - interval '1 day')::date
                                 ELSE (m->>'start')::date + g END),
             'new', (SELECT count(*) FROM _apeo p WHERE public._crm_ana_bucket(m, p.joined_at) = g),
             'prev_new', (SELECT count(*) FROM _apeo p WHERE p.joined_at IS NOT NULL AND CASE m->>'mode'
                             WHEN 'hour' THEN p.joined_at >= (m->>'start')::timestamptz - make_interval(hours => v_n - g)
                                              AND p.joined_at < (m->>'start')::timestamptz - make_interval(hours => v_n - g - 1)
                             WHEN 'month' THEN public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int)
                                               >= ((m->>'start')::date - interval '12 months' + make_interval(months => g))::date
                                               AND public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int)
                                               < ((m->>'start')::date - interval '12 months' + make_interval(months => g + 1))::date
                             ELSE public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int) = (m->>'start')::date - v_n + g END)
           ) ORDER BY g)
      INTO v_series FROM generate_series(0, v_n - 1) g;
  END IF;

  SELECT count(*) INTO v_base_total FROM _apeo;

  -- Cycle de vie (toute la base, ou les acheteurs de la soirée).
  SELECT jsonb_build_object(
           'hab', count(*) FILTER (WHERE lifecycle = 'hab'), 'occ', count(*) FILTER (WHERE lifecycle = 'occ'),
           'nou', count(*) FILTER (WHERE lifecycle = 'nou'), 'end', count(*) FILTER (WHERE lifecycle = 'end'),
           'none', count(*) FILTER (WHERE lifecycle = 'none'))
    INTO v_lc
    FROM _cp p
   WHERE m->>'mode' <> 'event' OR EXISTS (SELECT 1 FROM _atk_all a WHERE a.email = p.email AND a.ok
                                           AND a.event_id = (m->'event'->>'id')::uuid);

  SELECT jsonb_build_object(
           'total', count(*),
           'email_sms', count(*) FILTER (WHERE email_ok AND phone_ok),
           'email', count(*) FILTER (WHERE email_ok AND NOT phone_ok),
           'sms', count(*) FILTER (WHERE phone_ok AND NOT email_ok),
           'none', count(*) FILTER (WHERE NOT email_ok AND NOT phone_ok))
    INTO v_reach FROM _apeo;

  SELECT jsonb_build_object(
           'came', count(*) FILTER (WHERE nights > 0),
           'returning', count(*) FILTER (WHERE nights >= 2),
           'avg_nights', round(avg(nights) FILTER (WHERE nights > 0), 2),
           'spent', round(avg(spent) FILTER (WHERE nights > 0), 2))
    INTO v_stats FROM _apeo;

  -- Les mêmes mesures à la fin des six derniers mois (étincelles, écart).
  SELECT jsonb_agg(jsonb_build_object('returning_pct', q.rp, 'avg_nights', q.an, 'spent', q.sp) ORDER BY q.k DESC)
    INTO v_spark FROM (
      SELECT k,
             round(100.0 * count(*) FILTER (WHERE n >= 2) / NULLIF(count(*), 0), 1) AS rp,
             round(avg(n), 2) AS an, round(avg(s), 2) AS sp
        FROM generate_series(0, 5) k
        CROSS JOIN LATERAL (
          SELECT a.email, count(DISTINCT a.event_id) AS n, sum(a.amount) AS s
            FROM _atk_all a JOIN _apeo p ON p.email = a.email
           WHERE a.ok AND a.event_id IS NOT NULL
             AND a.bought_at < CASE WHEN k = 0 THEN now()
                                    ELSE (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => k - 1)) AT TIME ZONE 'Europe/Paris' END
           GROUP BY a.email) x
       GROUP BY k) q;

  -- Qui revient : les cinq dernières soirées passées, et la part de leurs
  -- acheteurs revenus aux soirées suivantes (+1 à +4).
  WITH evs AS (
    SELECT e.id, e.title, e.start_at, e.night, row_number() OVER (ORDER BY e.start_at) AS rn
      FROM _aev e WHERE EXISTS (SELECT 1 FROM _atk_all a WHERE a.event_id = e.id AND a.ok)
  ), last5 AS (
    SELECT * FROM evs WHERE start_at < now() ORDER BY start_at DESC LIMIT 5
  ), buyers AS (
    SELECT DISTINCT a.event_id, a.email FROM _atk_all a JOIN _apeo p ON p.email = a.email WHERE a.ok AND a.email IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'title', l.title, 'night', l.night,
           'buyers', (SELECT count(*) FROM buyers b WHERE b.event_id = l.id),
           'back', (SELECT jsonb_agg(CASE WHEN nx.id IS NULL THEN NULL ELSE
                       (SELECT round(100.0 * count(*) / NULLIF((SELECT count(*) FROM buyers b0 WHERE b0.event_id = l.id), 0), 0)
                          FROM buyers b WHERE b.event_id = l.id
                           AND EXISTS (SELECT 1 FROM buyers b2 WHERE b2.event_id = nx.id AND b2.email = b.email)) END ORDER BY s)
                     FROM generate_series(1, 4) s LEFT JOIN evs nx ON nx.rn = l.rn + s)
         ) ORDER BY l.start_at), '[]'::jsonb)
    INTO v_cohort FROM last5 l;

  SELECT jsonb_build_object(
           'n1', count(*) FILTER (WHERE nights = 1), 'n2', count(*) FILTER (WHERE nights = 2),
           'n3', count(*) FILTER (WHERE nights BETWEEN 3 AND 4), 'n5', count(*) FILTER (WHERE nights BETWEEN 5 AND 9),
           'n10', count(*) FILTER (WHERE nights >= 10))
    INTO v_hist FROM _apeo;

  -- Qui vient : les acheteurs de la fenêtre, par cycle de vie.
  SELECT jsonb_build_object(
           'buyers', count(DISTINCT a.email),
           'groups', (SELECT jsonb_object_agg(g.k, jsonb_build_object(
                          'buyers', (SELECT count(DISTINCT x.email) FROM _atk x JOIN _cp p ON p.email = x.email
                                      WHERE x.ok AND x.ci IS NOT NULL AND p.lifecycle = g.k),
                          'revenue', (SELECT COALESCE(round(sum(x.amount), 2), 0) FROM _atk x JOIN _cp p ON p.email = x.email
                                      WHERE x.ok AND x.ci IS NOT NULL AND p.lifecycle = g.k)))
                        FROM unnest(ARRAY['nou', 'occ', 'hab', 'end']) g(k)))
    INTO v_aud
    FROM _atk a WHERE a.ok AND a.ci IS NOT NULL;

  -- Âge et lieu : billets d'abord (déclarés à l'achat), sinon la fiche.
  WITH pa AS (
    SELECT p.email,
           COALESCE((SELECT max(a.age) FROM _atk_all a WHERE a.email = p.email AND a.age BETWEEN 14 AND 99), NULLIF(p.c_age, 0)) AS age,
           COALESCE((SELECT a.city FROM _atk_all a WHERE a.email = p.email AND a.city IS NOT NULL ORDER BY a.bought_at DESC LIMIT 1),
                    NULLIF(btrim(p.c_city), '')) AS city
      FROM _apeo p
  )
  SELECT jsonb_build_object(
           'known', count(*) FILTER (WHERE age IS NOT NULL), 'total', count(*),
           'b', jsonb_build_array(count(*) FILTER (WHERE age BETWEEN 14 AND 21), count(*) FILTER (WHERE age BETWEEN 22 AND 25),
                                  count(*) FILTER (WHERE age BETWEEN 26 AND 30), count(*) FILTER (WHERE age BETWEEN 31 AND 35),
                                  count(*) FILTER (WHERE age >= 36))),
         jsonb_build_object(
           'known', count(*) FILTER (WHERE city IS NOT NULL), 'total', count(*),
           'top', (SELECT COALESCE(jsonb_agg(jsonb_build_object('city', c, 'n', k) ORDER BY k DESC), '[]'::jsonb) FROM (
                     SELECT initcap(lower(city)) AS c, count(*) AS k FROM pa WHERE city IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t))
    INTO v_age, v_city FROM pa;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
           'nights', p.nights, 'spent', p.spent, 'last_night', p.last_night) ORDER BY p.spent DESC), '[]'::jsonb)
    INTO v_top FROM (SELECT * FROM _apeo WHERE nights > 0 ORDER BY spent DESC, nights DESC LIMIT 5) p;

  -- À réveiller : endormis, venus une seule fois (il y a plus d'un mois),
  -- habitués sans place pour la prochaine soirée.
  SELECT id INTO v_next FROM _aev WHERE upcoming ORDER BY start_at LIMIT 1;
  SELECT jsonb_build_object(
           'end', jsonb_build_object('n', count(*) FILTER (WHERE lifecycle = 'end'),
                                     'reachable', count(*) FILTER (WHERE lifecycle = 'end' AND (email_ok OR phone_ok))),
           'once', jsonb_build_object('n', count(*) FILTER (WHERE nights = 1 AND last_night < now() - interval '30 days'),
                                      'reachable', count(*) FILTER (WHERE nights = 1 AND last_night < now() - interval '30 days' AND (email_ok OR phone_ok))),
           'hab_no_ticket', CASE WHEN v_next IS NOT NULL THEN jsonb_build_object(
               'event_id', v_next, 'title', (SELECT title FROM _aev WHERE id = v_next),
               'n', count(*) FILTER (WHERE lifecycle = 'hab' AND NOT EXISTS (
                      SELECT 1 FROM _atk_all a WHERE a.email = _cp.email AND a.ok AND a.event_id = v_next)),
               'reachable', count(*) FILTER (WHERE lifecycle = 'hab' AND (email_ok OR phone_ok) AND NOT EXISTS (
                      SELECT 1 FROM _atk_all a WHERE a.email = _cp.email AND a.ok AND a.event_id = v_next))) END)
    INTO v_wake FROM _cp;

  RETURN jsonb_build_object(
    'meta', m,
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months),
    'series', COALESCE(v_series, '[]'::jsonb),
    'base', v_base_total,
    'lifecycle', v_lc,
    'reach', v_reach,
    'stats', v_stats,
    'spark', COALESCE(v_spark, '[]'::jsonb),
    'cohort', v_cohort,
    'hist', v_hist,
    'audience', v_aud,
    'age', v_age,
    'city', v_city,
    'top', v_top,
    'wake', v_wake,
    'has_any', EXISTS (SELECT 1 FROM _cp)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_ana_sales(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._crm_money_gate(public.crm_ana_sales__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.crm_ana_sales__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_today date;
  v_series jsonb; v_tot jsonb; v_msg jsonb; v_deals jsonb; v_fill jsonb; v_ref jsonb; v_seg_share numeric;
  v_target uuid; v_refs uuid[]; v_goal jsonb;
  v_heat jsonb; v_tariffs jsonb; v_events jsonb; v_other jsonb;
  v_heat_from date; v_heat_to date;
  v_cur_from date; v_prev_from date; v_prev_to date;
  v_cut int;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  v_n := (m->>'n')::int;
  v_today := (m->>'today')::date;

  -- Une soirée encore en vente se compare à la précédente AU MÊME JOUR (J-k) :
  -- au-delà d'aujourd'hui, la précédente n'est pas dans les totaux.
  v_cut := CASE WHEN m->>'mode' = 'event' AND COALESCE((m->'event'->>'upcoming')::boolean, false)
                THEN 21 - COALESCE((m->'event'->>'days_left')::int, 0) ELSE v_n - 1 END;

  SELECT jsonb_agg(jsonb_build_object(
           'revenue', COALESCE((SELECT round(sum(a.amount), 2) FROM _atk a WHERE a.ok AND a.ci = g), 0),
           'tickets', COALESCE((SELECT sum(a.qty) FROM _atk a WHERE a.ok AND a.ci = g), 0),
           'prev_revenue', COALESCE((SELECT round(sum(a.amount), 2) FROM _atk a WHERE a.ok AND a.pi = g), 0),
           'prev_tickets', COALESCE((SELECT sum(a.qty) FROM _atk a WHERE a.ok AND a.pi = g), 0)
         ) ORDER BY g)
    INTO v_series FROM generate_series(0, v_n - 1) g;

  SELECT jsonb_build_object(
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND ci IS NOT NULL), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL), 0),
           'buyers', count(DISTINCT email) FILTER (WHERE ok AND ci IS NOT NULL),
           'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND pi <= v_cut), 2), 0),
           'prev_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut), 0),
           'has_prev', bool_or(pi IS NOT NULL),
           'prev_same_day', v_cut < v_n - 1,
           -- Remboursés : part des billets de la fenêtre rendus (montant brut).
           'refund_pct', CASE WHEN sum(amount) FILTER (WHERE ci IS NOT NULL) > 0
                              THEN round(100 * sum(amount) FILTER (WHERE refunded AND ci IS NOT NULL)
                                         / sum(amount) FILTER (WHERE ci IS NOT NULL), 1) END,
           'prev_refund_pct', CASE WHEN sum(amount) FILTER (WHERE pi <= v_cut) > 0
                                   THEN round(100 * sum(amount) FILTER (WHERE refunded AND pi <= v_cut)
                                              / sum(amount) FILTER (WHERE pi <= v_cut), 1) END,
           'refunds', jsonb_build_object(
               'amount', COALESCE(round(sum(amount) FILTER (WHERE refunded AND ci IS NOT NULL), 2), 0),
               'revenue', COALESCE(round(sum(amount) FILTER (WHERE ci IS NOT NULL), 2), 0))
         )
    INTO v_tot FROM _atk;

  -- Ce qui a fait vendre : la part venue d'un message Yuno (UTM).
  SELECT jsonb_build_object(
           'share', CASE WHEN sum(amount) > 0 THEN round(100 * sum(amount) FILTER (WHERE src IN ('em', 'sm', 'dm')) / sum(amount), 1) END,
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE src IN ('em', 'sm', 'dm')), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE src IN ('em', 'sm', 'dm')), 0),
           'by', jsonb_build_object(
             'em', COALESCE(sum(qty) FILTER (WHERE src = 'em'), 0),
             'sm', COALESCE(sum(qty) FILTER (WHERE src = 'sm'), 0),
             'dm', COALESCE(sum(qty) FILTER (WHERE src = 'dm'), 0)))
    INTO v_msg FROM _atk WHERE ok AND ci IS NOT NULL;

  -- Tarifs de la fenêtre.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('deal', d.deal, 'price', d.price, 'tickets', d.tickets, 'revenue', d.revenue)
                            ORDER BY d.tickets DESC), '[]'::jsonb)
    INTO v_tariffs FROM (
      SELECT COALESCE(a.deal, '—') AS deal, round(avg(a.price), 2) AS price, sum(a.qty) AS tickets, round(sum(a.amount), 2) AS revenue
        FROM _atk a WHERE a.ok AND a.ci IS NOT NULL GROUP BY 1 ORDER BY 3 DESC LIMIT 8) d;

  -- Remplissage des soirées TENUES dans la fenêtre (nuit déjà venue), contre
  -- celles de la fenêtre d'avant ; pour une soirée, elle contre la précédente.
  -- Une soirée encore en vente ne tire pas le remplissage vers le bas.
  IF m->>'mode' = 'hour' THEN
    v_cur_from := public._crm_night_date((m->>'start')::timestamptz, m->>'tz', (m->>'night_end_hour')::int);
    v_prev_from := public._crm_night_date((m->>'start')::timestamptz - make_interval(hours => v_n), m->>'tz', (m->>'night_end_hour')::int);
  ELSIF m->>'mode' = 'month' THEN
    v_cur_from := (m->>'start')::date;
    v_prev_from := ((m->>'start')::date - interval '12 months')::date;
  ELSIF m->>'mode' = 'day' THEN
    v_cur_from := (m->>'start')::date;
    v_prev_from := v_cur_from - v_n;
  END IF;
  v_prev_to := v_cur_from - 1;
  WITH capx AS (
    SELECT e.id, e.night, COALESCE(s.sold, 0) AS sold,
           public._crm_night_capacity(e.left_tickets, e.deals, COALESCE(s.sold, 0)::int) AS cap
      FROM _aev e
      LEFT JOIN (SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok GROUP BY 1) s ON s.event_id = e.id
  ), cur AS (
    SELECT * FROM capx WHERE cap > 0 AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'event'->>'id')::uuid
                                              ELSE night BETWEEN v_cur_from AND v_today END
  ), prv AS (
    SELECT * FROM capx WHERE cap > 0 AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'prev_event'->>'id')::uuid
                                              ELSE night BETWEEN v_prev_from AND v_prev_to END
  )
  SELECT jsonb_build_object(
           'sold', (SELECT sum(sold) FROM cur), 'cap', (SELECT sum(cap) FROM cur), 'nights', (SELECT count(*) FROM cur),
           'prev_sold', (SELECT sum(sold) FROM prv), 'prev_cap', (SELECT sum(cap) FROM prv))
    INTO v_fill;

  IF (m->>'seg') <> 'all' THEN
    SELECT CASE WHEN (SELECT sum(amount) FROM _atk_all WHERE ok AND ci IS NOT NULL) > 0
                THEN round(100 * (SELECT sum(amount) FROM _atk WHERE ok AND ci IS NOT NULL)
                           / (SELECT sum(amount) FROM _atk_all WHERE ok AND ci IS NOT NULL), 1) END
      INTO v_seg_share;
  END IF;

  -- Objectif et courbe : la soirée choisie, sinon la prochaine, sinon la dernière.
  v_target := (m->'event'->>'id')::uuid;
  IF v_target IS NULL THEN
    SELECT id INTO v_target FROM _aev WHERE upcoming ORDER BY start_at LIMIT 1;
  END IF;
  IF v_target IS NULL THEN
    SELECT id INTO v_target FROM _aev ORDER BY start_at DESC LIMIT 1;
  END IF;
  IF v_target IS NOT NULL THEN
    SELECT array_agg(id ORDER BY ord) INTO v_refs FROM (
      SELECT e.id, row_number() OVER (ORDER BY (e.series = t.series) DESC, e.start_at DESC) AS ord
        FROM _aev e, _aev t
       WHERE t.id = v_target AND e.id <> t.id AND NOT e.upcoming AND e.start_at < t.start_at
         AND EXISTS (SELECT 1 FROM _atk_all a WHERE a.event_id = e.id AND a.ok)
    ) r WHERE ord <= 2;
    v_goal := jsonb_build_object(
      'target', public._crm_ana_curve(v_target, v_today),
      'refs', COALESCE((SELECT jsonb_agg(public._crm_ana_curve(x, v_today) ORDER BY o) FROM unnest(v_refs) WITH ORDINALITY u(x, o)), '[]'::jsonb),
      'week_sold', COALESCE((SELECT sum(qty) FROM _atk_all WHERE event_id = v_target AND ok AND nd > v_today - 7), 0));
  END IF;

  -- Quand achètent-ils : jour (règle de nuit) × tranche de 2 h, 10 h → 2 h.
  IF m->>'mode' = 'hour' THEN
    v_heat_from := v_today - 29; v_heat_to := v_today;
  END IF;
  WITH h AS (
    SELECT (extract(isodow FROM a.nd)::int - 1) AS r,
           CASE WHEN a.hr >= 10 THEN (a.hr - 10) / 2 WHEN a.hr < 2 THEN 7 END AS c,
           a.qty, a.amount
      FROM _atk a
     WHERE a.ok
       AND CASE WHEN v_heat_from IS NOT NULL THEN a.nd BETWEEN v_heat_from AND v_heat_to ELSE a.ci IS NOT NULL END
  )
  SELECT jsonb_build_object(
           'cells', (SELECT jsonb_agg((SELECT jsonb_agg(jsonb_build_object(
                         'n', COALESCE((SELECT count(*) FROM h WHERE h.r = rr AND h.c = cc), 0),
                         'amount', COALESCE((SELECT round(sum(h.amount), 2) FROM h WHERE h.r = rr AND h.c = cc), 0)) ORDER BY cc)
                       FROM generate_series(0, 7) cc) ORDER BY rr)
                     FROM generate_series(0, 6) rr),
           'outside', (SELECT count(*) FROM h WHERE h.c IS NULL),
           'days30', v_heat_from IS NOT NULL)
    INTO v_heat;

  -- Soirées qui ont vendu dans la fenêtre (les 7 premières, puis le reste).
  WITH per AS (
    SELECT a.event_id, sum(a.qty) AS tickets, round(sum(a.amount), 2) AS revenue
      FROM _atk a WHERE a.ok AND a.ci IS NOT NULL AND a.event_id IS NOT NULL GROUP BY 1
  ), tot AS (
    SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok AND event_id IS NOT NULL GROUP BY 1
  ), rows AS (
    SELECT e.id, e.title, e.start_at, e.night, e.upcoming, p.tickets, p.revenue, COALESCE(t.sold, 0) AS sold,
           public._crm_night_capacity(e.left_tickets, e.deals, COALESCE(t.sold, 0)::int) AS cap,
           (SELECT COALESCE(t2.sold, 0) FROM _aev e2 LEFT JOIN tot t2 ON t2.event_id = e2.id
             WHERE e2.start_at < e.start_at AND e2.id <> e.id AND NOT e2.upcoming
             ORDER BY (e2.series = e.series) DESC, e2.start_at DESC LIMIT 1) AS prev_sold,
           row_number() OVER (ORDER BY p.revenue DESC, p.tickets DESC) AS rk
      FROM per p JOIN _aev e ON e.id = p.event_id LEFT JOIN tot t ON t.event_id = e.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'start_at', start_at, 'night', night, 'upcoming', upcoming,
           'state', CASE WHEN night = v_today THEN 'tonight' WHEN upcoming THEN 'presale' ELSE 'past' END,
           'tickets', tickets, 'revenue', revenue, 'sold', sold, 'cap', cap, 'prev_sold', prev_sold
         ) ORDER BY start_at DESC) FILTER (WHERE rk <= 7), '[]'::jsonb),
         CASE WHEN count(*) > 7 THEN jsonb_build_object('count', count(*) FILTER (WHERE rk > 7),
                'tickets', sum(tickets) FILTER (WHERE rk > 7), 'revenue', sum(revenue) FILTER (WHERE rk > 7)) END
    INTO v_events, v_other
    FROM rows;

  RETURN jsonb_build_object(
    'meta', m,
    'series', COALESCE(v_series, '[]'::jsonb),
    'totals', v_tot,
    'msg', v_msg,
    'tariffs', v_tariffs,
    'fill', v_fill,
    'seg_share', v_seg_share,
    'goal', v_goal,
    'heat', v_heat,
    'events', v_events,
    'events_other', v_other,
    'sends', public._crm_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_ana_traffic(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._crm_money_gate(public.crm_ana_traffic__core(p_venue_id, p_organizer_user_id, p_period, p_event), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.crm_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_series jsonb; v_sources jsonb; v_clicks jsonb; v_new jsonb; v_events jsonb; v_first jsonb; v_gained jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, 'all');
  v_n := (m->>'n')::int;

  -- Premier achat de chaque client dans l'espace (toutes époques).
  DROP TABLE IF EXISTS _afirst;
  CREATE TEMP TABLE _afirst ON COMMIT DROP AS
  SELECT DISTINCT ON (a.email) a.email, a.id, a.bought_at, a.src, a.ci, a.pi
    FROM _atk_all a WHERE a.ok AND a.email IS NOT NULL
   ORDER BY a.email, a.bought_at, a.id;

  -- Clics sur les messages Yuno (un clic = une personne et une campagne).
  DROP TABLE IF EXISTS _aclk;
  CREATE TEMP TABLE _aclk ON COMMIT DROP AS
  SELECT k.campaign_id, k.email, k.at, k.event_id,
         public._crm_ana_bucket(m, k.at) AS ci,
         CASE m->>'mode'
           WHEN 'hour' THEN CASE WHEN k.at >= (m->>'start')::timestamptz - make_interval(hours => v_n) AND k.at < (m->>'start')::timestamptz THEN 0 END
           WHEN 'day' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                     BETWEEN (m->>'start')::date - v_n AND (m->>'start')::date - 1 THEN 0 END
           WHEN 'month' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                       >= ((m->>'start')::date - interval '12 months')::date
                                   AND public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int) < (m->>'start')::date THEN 0 END
           ELSE NULL END AS pi
    FROM (
      SELECT ev.campaign_id, lower(ev.recipient_email) AS email, min(ev.created_at) AS at, c.event_id
        FROM public.email_campaign_events ev
        JOIN public.email_campaigns c ON c.id = ev.campaign_id
       WHERE ev.event_type = 'clicked'
         AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
         AND ev.created_at > now() - interval '25 months'
       GROUP BY ev.campaign_id, lower(ev.recipient_email), c.event_id
    ) k;

  SELECT jsonb_agg(jsonb_build_object(
           'revenue', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT round(sum(a.amount), 2) FROM _atk_all a WHERE a.ok AND a.ci = g AND a.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of']) s(k)),
           'tickets', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.ci = g AND a.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of']) s(k)),
           'clicks', COALESCE((SELECT count(*) FROM _aclk c WHERE c.ci = g), 0),
           'new_buyers', COALESCE((SELECT count(*) FROM _afirst f WHERE f.ci = g), 0)
         ) ORDER BY g)
    INTO v_series FROM generate_series(0, v_n - 1) g;

  -- Par source : achats, acheteurs, nouveaux clients (premier achat ici), ventes.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'k', s.k,
           'orders', (SELECT count(DISTINCT a.ord) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k),
           'tickets', COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k), 0),
           'buyers', (SELECT count(DISTINCT a.email) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k),
           'new_buyers', (SELECT count(*) FROM _afirst f WHERE f.ci IS NOT NULL AND f.src = s.k),
           'revenue', COALESCE((SELECT round(sum(a.amount), 2) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k), 0),
           'prev_tickets', COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL AND a.src = s.k), 0)
         )), '[]'::jsonb)
    INTO v_sources FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of']) s(k);

  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE ci IS NOT NULL),
           'prev', count(*) FILTER (WHERE pi IS NOT NULL))
    INTO v_clicks FROM _aclk;

  SELECT jsonb_build_object(
           'buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND ci IS NOT NULL),
           'new', (SELECT count(*) FROM _afirst WHERE ci IS NOT NULL),
           'prev_buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND pi IS NOT NULL),
           'prev_new', (SELECT count(*) FROM _afirst WHERE pi IS NOT NULL))
    INTO v_new;

  -- Contacts gagnés : entrés dans la base pendant la fenêtre (premier achat,
  -- import, inscription), quelle que soit la porte.
  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE public._crm_ana_bucket(m, j.at) IS NOT NULL),
           'series', (SELECT jsonb_agg((SELECT count(*) FROM (
                         SELECT LEAST(f.bought_at, COALESCE(c.added_at, c.created_at)) AS at
                           FROM _cr c LEFT JOIN _afirst f ON f.email = lower(c.email)
                          WHERE c.email IS NOT NULL) z
                        WHERE public._crm_ana_bucket(m, z.at) = g) ORDER BY g)
                       FROM generate_series(0, v_n - 1) g))
    INTO v_gained
    FROM (SELECT LEAST(f.bought_at, COALESCE(c.added_at, c.created_at)) AS at
            FROM _cr c LEFT JOIN _afirst f ON f.email = lower(c.email)
           WHERE c.email IS NOT NULL) j;

  -- Soirées : acheteurs, part de nouveaux, clics de vos messages vers elles.
  WITH per AS (
    SELECT a.event_id, count(DISTINCT a.email) AS buyers,
           count(DISTINCT a.email) FILTER (WHERE EXISTS (SELECT 1 FROM _afirst f WHERE f.id = a.id)) AS new_buyers
      FROM _atk_all a WHERE a.ok AND a.event_id IS NOT NULL
       AND (m->>'mode' = 'event' AND a.event_id = (m->'event'->>'id')::uuid OR m->>'mode' <> 'event' AND a.ci IS NOT NULL)
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'title', e.title, 'start_at', e.start_at, 'night', e.night, 'upcoming', e.upcoming,
           'state', CASE WHEN e.night = (m->>'today')::date THEN 'tonight' WHEN e.upcoming THEN 'presale' ELSE 'past' END,
           'buyers', p.buyers, 'new_buyers', p.new_buyers,
           'clicks', (SELECT count(*) FROM _aclk c WHERE c.event_id = e.id)
         ) ORDER BY p.buyers DESC), '[]'::jsonb)
    INTO v_events
    FROM (SELECT * FROM per ORDER BY buyers DESC LIMIT 7) p JOIN _aev e ON e.id = p.event_id;

  RETURN jsonb_build_object(
    'meta', m,
    'series', COALESCE(v_series, '[]'::jsonb),
    'sources', v_sources,
    'clicks', v_clicks,
    'buyers', v_new,
    'gained', v_gained,
    'events', v_events,
    'sends', public._crm_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_automations(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._crm_money_gate(public.crm_automations__core(p_venue_id, p_organizer_user_id, p_period),
                                p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.crm_clients_list(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_def jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'last'::text, p_dir integer DEFAULT 1, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._crm_money_gate(public.crm_clients_list__core(p_venue_id, p_organizer_user_id, p_def, p_sort, p_dir, p_limit, p_offset), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.crm_clients_list__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_def jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'last'::text, p_dir integer DEFAULT 1, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pred text;
  v_order text;
  v_total integer;
  v_rows jsonb;
  v_counts jsonb;
  v_desc text := CASE WHEN COALESCE(p_dir, 1) >= 0 THEN 'DESC' ELSE 'ASC' END;
  v_asc text := CASE WHEN COALESCE(p_dir, 1) >= 0 THEN 'ASC' ELSE 'DESC' END;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  v_pred := public._crm_filter_sql(p_def, 'p');
  v_order := CASE p_sort
    WHEN 'name' THEN format('lower(COALESCE(p.first_name, p.email)) %s, p.email', v_asc)
    WHEN 'n' THEN format('p.nights %s, p.email', v_desc)
    WHEN 'sp' THEN format('p.spent %s, p.email', v_desc)
    ELSE format('p.last_night %s NULLS LAST, p.added_at %s, p.email', v_desc, v_desc) END;

  EXECUTE format('SELECT count(*) FROM _cp p WHERE %s', v_pred) INTO v_total;
  EXECUTE format($q$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'email', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
             'lifecycle', p.lifecycle, 'nights', p.nights, 'last_night', p.last_night, 'added_at', p.added_at,
             'spent', p.spent, 'email_ok', p.email_ok, 'phone_ok', p.phone_ok, 'tonight', p.tonight,
             'tag', (p.tags)[1], 'source', p.source,
             'gl', p.gl_n, 'gl_only', (p.gl_n > 0 AND p.paid_n = 0)) ORDER BY rn), '[]'::jsonb)
      FROM (SELECT p.*, row_number() OVER (ORDER BY %s) AS rn FROM _cp p WHERE %s ORDER BY %s LIMIT %s OFFSET %s) p
  $q$, v_order, v_pred, v_order, GREATEST(1, LEAST(COALESCE(p_limit, 12), 500)), GREATEST(0, COALESCE(p_offset, 0)))
  INTO v_rows;

  SELECT jsonb_build_object(
           'all', count(*), 'hab', count(*) FILTER (WHERE lifecycle = 'hab'), 'occ', count(*) FILTER (WHERE lifecycle = 'occ'),
           'nou', count(*) FILTER (WHERE lifecycle = 'nou'), 'end', count(*) FILTER (WHERE lifecycle = 'end'),
           'none', count(*) FILTER (WHERE lifecycle = 'none'))
    INTO v_counts FROM _cp;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows, 'counts', v_counts);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_clients_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rules record;
  v_now timestamptz := now();
  v_tz text := 'Europe/Paris';
  v_today timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
  v_cur jsonb;
  v_prev jsonb;
  v_spark jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  -- Il y a 30 jours (écarts « vs le mois dernier »).
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, v_now - interval '30 days');
  SELECT jsonb_build_object(
           'total', count(*),
           'returning_pct', CASE WHEN count(*) FILTER (WHERE nights >= 1) > 0
             THEN round(count(*) FILTER (WHERE nights >= 2)::numeric * 100 / count(*) FILTER (WHERE nights >= 1), 1) END,
           'avg_spend', CASE WHEN count(*) FILTER (WHERE spent > 0) > 0
             THEN round(avg(spent) FILTER (WHERE spent > 0), 2) END)
    INTO v_prev FROM _cp;

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, v_now);
  SELECT jsonb_agg(c ORDER BY d) INTO v_spark FROM (
    SELECT d, (SELECT count(*) FROM _cp x WHERE x.added_at < ((date_trunc('day', v_now AT TIME ZONE v_tz) - (29 - d) * interval '1 day' + interval '1 day') AT TIME ZONE v_tz)) AS c
      FROM generate_series(0, 29) d) s;

  SELECT jsonb_build_object(
           'total', count(*),
           'today', count(*) FILTER (WHERE added_at >= v_today),
           'month', count(*) FILTER (WHERE added_at >= v_now - interval '30 days'),
           'lifecycle', jsonb_build_object(
              'hab', count(*) FILTER (WHERE lifecycle = 'hab'),
              'occ', count(*) FILTER (WHERE lifecycle = 'occ'),
              'nou', count(*) FILTER (WHERE lifecycle = 'nou'),
              'end', count(*) FILTER (WHERE lifecycle = 'end'),
              'none', count(*) FILTER (WHERE lifecycle = 'none')),
           'end_reachable', count(*) FILTER (WHERE lifecycle = 'end' AND (email_ok OR phone_ok)),
           'reachable', count(*) FILTER (WHERE email_ok OR phone_ok),
           'unreachable', count(*) FILTER (WHERE NOT email_ok AND NOT phone_ok),
           'returning_pct', CASE WHEN count(*) FILTER (WHERE nights >= 1) > 0
             THEN round(count(*) FILTER (WHERE nights >= 2)::numeric * 100 / count(*) FILTER (WHERE nights >= 1), 1) END,
           'once', count(*) FILTER (WHERE nights = 1),
           'avg_spend', CASE WHEN count(*) FILTER (WHERE spent > 0) > 0
             THEN round(avg(spent) FILTER (WHERE spent > 0), 2) END)
    INTO v_cur FROM _cp;

  RETURN v_cur || jsonb_build_object(
    'spark', COALESCE(v_spark, '[]'::jsonb),
    'prev', v_prev,
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months),
    'updated_at', v_now);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_effective_plan(p_scope_key text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.crm_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.crm_subscriptions WHERE scope_key = p_scope_key;
  IF NOT FOUND THEN RETURN 'paused'; END IF;
  IF s.status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now() THEN
    RETURN 'base';
  END IF;
  IF s.status IN ('active', 'past_due') THEN
    -- Offre accordée à la main (sans Stripe) : elle s'éteint à sa date.
    IF s.stripe_subscription_id IS NULL AND s.current_period_end IS NOT NULL AND s.current_period_end < now() THEN
      RETURN 'paused';
    END IF;
    RETURN 'base';
  END IF;
  RETURN 'paused';
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_send_options(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_auto jsonb;
  v_saved jsonb := '[]'::jsonb;
  s record;
  r record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

  -- Joignables : la même porte que l'envoi (opt-in newsletter de la portée).
  DROP TABLE IF EXISTS _cso;
  CREATE TEMP TABLE _cso ON COMMIT DROP AS
  SELECT p.*, 0::integer AS open_n FROM _cp p
   WHERE p.email_ok AND EXISTS (
     SELECT 1 FROM public.newsletter_subscriptions ns
      WHERE lower(ns.email) = p.email AND ns.opted_in
        AND ns.venue_id IS NOT DISTINCT FROM p_venue_id
        AND ns.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id);

  WITH c AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.status IN ('sent', 'sending') AND ec.sent_at > now() - interval '12 months'
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id
       AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ), o AS (
    SELECT lower(ev.recipient_email) AS em, count(DISTINCT ev.campaign_id)::integer AS n
      FROM public.email_campaign_events ev JOIN c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'opened' AND ev.recipient_email IS NOT NULL
     GROUP BY 1
  )
  UPDATE _cso p SET open_n = o.n FROM o WHERE o.em = p.email;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', k.key, 'reach', COALESCE(a.reach, 0),
           'open_pct', CASE WHEN COALESCE(a.rec, 0) >= 20 THEN round(100.0 * a.op / a.rec) END,
           'click_pct', CASE WHEN COALESCE(a.rec, 0) >= 20 THEN round(100.0 * a.cl / a.rec) END)
         ORDER BY k.ord), '[]'::jsonb)
    INTO v_auto
    FROM (VALUES ('hab', 1), ('occ', 2), ('nou', 3), ('end', 4), ('none', 5)) k(key, ord)
    LEFT JOIN (
      SELECT lifecycle, count(*)::integer AS reach, sum(msg_n) AS rec, sum(LEAST(open_n, msg_n)) AS op, sum(LEAST(click_n, msg_n)) AS cl
        FROM _cso GROUP BY lifecycle
    ) a ON a.lifecycle = k.key;

  FOR s IN
    SELECT id, name, description, definition FROM public.crm_segments
     WHERE venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY created_at DESC LIMIT 40
  LOOP
    EXECUTE format('SELECT count(*)::integer AS reach, sum(msg_n) AS rec, sum(LEAST(open_n, msg_n)) AS op, sum(LEAST(click_n, msg_n)) AS cl FROM _cso p WHERE (%s)',
                   public._crm_filter_sql(s.definition, 'p'))
      INTO r;
    v_saved := v_saved || jsonb_build_array(jsonb_build_object(
      'id', s.id, 'name', s.name, 'description', s.description, 'reach', COALESCE(r.reach, 0),
      'open_pct', CASE WHEN COALESCE(r.rec, 0) >= 20 THEN round(100.0 * r.op / r.rec) END,
      'click_pct', CASE WHEN COALESCE(r.rec, 0) >= 20 THEN round(100.0 * r.cl / r.rec) END));
  END LOOP;

  RETURN jsonb_build_object('auto', v_auto, 'saved', v_saved,
    'rules', (SELECT to_jsonb(sr) FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) sr));
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_org_role(p_user_id uuid, p_organizer_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN p_user_id IS NULL OR p_organizer_user_id IS NULL THEN NULL
              WHEN p_user_id = p_organizer_user_id THEN 'owner'
              ELSE (SELECT m.role FROM public.org_members m
                     WHERE m.organizer_user_id = p_organizer_user_id AND m.member_user_id = p_user_id
                       AND m.invitation_status = 'accepted' AND m.role IN ('admin', 'editor', 'viewer')
                     ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END LIMIT 1) END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_plan_limits(p_plan text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- MIROIR EXACT de CRM_PLAN_LIMITS (src/lib/crmPlans.ts).
  -- NULL = sans limite. Le socle n'a ni quota d'emails ni plafond : le Yunit
  -- fait la limite. En pause : lecture et export seulement.
  SELECT CASE p_plan
    WHEN 'base' THEN jsonb_build_object('send', true, 'sync', true, 'emails_month', NULL, 'sync_minutes', 15,
      'members', NULL, 'automations', NULL, 'ab_resend', true, 'meta', true, 'segment_export', true, 'yuno_badge', false)
    ELSE jsonb_build_object('send', false, 'sync', false, 'emails_month', 0, 'sync_minutes', NULL,
      'members', NULL, 'automations', NULL, 'ab_resend', true, 'meta', false, 'segment_export', true, 'yuno_badge', false)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_pricing_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT config FROM public.crm_pricing WHERE id;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ((p_venue_id IS NULL) <> (p_organizer_user_id IS NULL)) AND (
    COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND public.crm_org_role(auth.uid(), p_organizer_user_id) IS NOT NULL)
    )));
$function$;

CREATE OR REPLACE FUNCTION public.crm_scope_has_crm(p_scope_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'crm' = ANY (public.account_products(p_scope_key));
$function$;

CREATE OR REPLACE FUNCTION public.crm_scope_is_crm(p_scope_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_scope_key LIKE 'venue:%' THEN
    RETURN EXISTS (SELECT 1 FROM public.venues
                    WHERE id = substr(p_scope_key, 7) AND product = 'crm' AND NOT ('suite' = ANY (extra_products)));
  ELSIF p_scope_key ~ '^org:[0-9a-fA-F-]{36}$' THEN
    RETURN EXISTS (SELECT 1 FROM public.organizer_profiles
                    WHERE user_id = substr(p_scope_key, 5)::uuid AND product = 'crm' AND NOT ('suite' = ANY (extra_products)));
  END IF;
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scope_key(p_venue_id text, p_organizer_user_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id
    WHEN p_organizer_user_id IS NOT NULL THEN 'org:' || p_organizer_user_id::text
  END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scope_limits(p_scope_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public.crm_scope_is_crm(p_scope_key)
              THEN public.crm_plan_limits(public.crm_effective_plan(p_scope_key)) END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scope_rules(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(regular_min_nights integer, regular_window_months integer, lapse_months integer, night_end_hour integer, retention_months integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(s.regular_min_nights, 3)::int,
         COALESCE(s.regular_window_months, 6)::int,
         COALESCE(s.lapse_months, 4)::int,
         COALESCE(s.night_end_hour, 6)::int,
         s.retention_months::int
    FROM (SELECT 1) one
    LEFT JOIN public.crm_settings s
      ON s.scope_key = CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id
                            ELSE 'org:' || p_organizer_user_id::text END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scope_sees_money(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid())
            OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                        WHERE mp.venue_id = p_venue_id AND mp.user_id = auth.uid()
                          AND (COALESCE(mp.can_view_analytics, false) OR COALESCE(mp.can_view_finance, false)))))
      OR (p_organizer_user_id IS NOT NULL AND (
            public.crm_org_role(auth.uid(), p_organizer_user_id) IN ('owner', 'admin')
            OR public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'view_finance')))
    )), false);
$function$;

CREATE OR REPLACE FUNCTION public.crm_scope_writable(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(((p_venue_id IS NULL) <> (p_organizer_user_id IS NULL)) AND (
    COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND public.crm_org_role(auth.uid(), p_organizer_user_id) IN ('owner', 'admin', 'editor'))
    ))), false);
$function$;

CREATE OR REPLACE FUNCTION public.crm_segments_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._crm_money_gate(public.crm_segments_overview__core(p_venue_id, p_organizer_user_id, p_period), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.crm_segments_overview__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tz text := 'Europe/Paris';
  v_days integer := CASE p_period WHEN '90d' THEN 91 WHEN '12m' THEN 360 ELSE 30 END;
  v_step integer := CASE p_period WHEN '90d' THEN 7 WHEN '12m' THEN 30 ELSE 1 END;
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_from timestamptz;
  v_pfrom timestamptz;
  v_anchor date;
  v_missing boolean;
  v_seg record;
  v_pred text;
  v_stats jsonb;
  v_msg jsonb;
  v_segs jsonb := '[]'::jsonb;
  v_tot jsonb;
  v_prev numeric;
  v_series jsonb;
  v_sends jsonb;
  v_builds integer := 0;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := v_now - make_interval(days => v_days);
  v_pfrom := v_from - make_interval(days => v_days);

  -- Dates repères manquantes : rejeu de la base à cette date (3 au plus).
  FOREACH v_anchor IN ARRAY ARRAY[v_today - v_days, v_today - (v_days * 2 / 3), v_today - (v_days / 3)] LOOP
    SELECT EXISTS (
      SELECT 1 FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) d
       WHERE NOT EXISTS (SELECT 1 FROM public.crm_segment_counts c
                          WHERE c.scope_key = v_scope AND c.seg_key = d.seg_key AND c.day = v_anchor))
      INTO v_missing;
    IF v_missing THEN
      PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id,
                                       ((v_anchor + 1)::timestamp AT TIME ZONE v_tz) - interval '1 second');
      PERFORM public._crm_segment_counts_write(p_venue_id, p_organizer_user_id, v_anchor);
      v_builds := v_builds + 1;
    END IF;
  END LOOP;

  -- La base d'aujourd'hui, puis les messages de la période (et de la précédente).
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM public._crm_segment_counts_write(p_venue_id, p_organizer_user_id, v_today);
  PERFORM public._crm_msg_build(p_venue_id, p_organizer_user_id, v_pfrom, v_now);

  -- Une ligne par segment.
  FOR v_seg IN SELECT * FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) ORDER BY sort LOOP
    v_pred := public._crm_filter_sql(v_seg.def, 'p');
    EXECUTE format($q$
      SELECT jsonb_build_object(
        'n', count(*),
        'reachable', count(*) FILTER (WHERE p.email_ok OR p.phone_ok),
        'email', count(*) FILTER (WHERE p.email_ok),
        'sms', count(*) FILTER (WHERE p.phone_ok),
        'avg_spend', CASE WHEN count(*) > 0 THEN round(sum(p.spent) / count(*), 2) END,
        'avg_nights', CASE WHEN count(*) > 0 THEN round(avg(p.nights)::numeric, 1) END,
        'sources', jsonb_build_object(
          'shotgun', count(*) FILTER (WHERE p.source = 'shotgun'),
          'utm', count(*) FILTER (WHERE p.source = 'utm'),
          'import', count(*) FILTER (WHERE p.source = 'import'),
          'other', count(*) FILTER (WHERE p.source NOT IN ('shotgun', 'utm', 'import'))))
        FROM _cp p WHERE %s $q$, v_pred) INTO v_stats;
    EXECUTE format($q$
      SELECT jsonb_build_object(
        'received', count(*),
        'clicked', count(*) FILTER (WHERE m.clicked),
        'ticketing', count(*) FILTER (WHERE m.ticketing),
        'bought', count(*) FILTER (WHERE m.bought),
        'buyers', count(DISTINCT m.email) FILTER (WHERE m.bought),
        'revenue', COALESCE(round(sum(m.revenue), 2), 0))
        FROM _cm m JOIN _cp p ON p.email = m.email
       WHERE m.sent_at >= %L AND %s $q$, v_from, v_pred) INTO v_msg;

    v_segs := v_segs || jsonb_build_array(
      jsonb_build_object('key', v_seg.seg_key, 'kind', v_seg.kind, 'name', v_seg.name, 'description', v_seg.description,
                         'template', v_seg.template, 'definition', v_seg.def, 'created_at', v_seg.created_at)
      || v_stats
      || jsonb_build_object('msg', v_msg,
           'n_start', (SELECT c.n FROM public.crm_segment_counts c
                        WHERE c.scope_key = v_scope AND c.seg_key = v_seg.seg_key AND c.day = v_today - v_days),
           'spark', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', c.day, 'n', c.n) ORDER BY c.day), '[]'::jsonb)
                       FROM public.crm_segment_counts c
                      WHERE c.scope_key = v_scope AND c.seg_key = v_seg.seg_key
                        AND c.day >= v_today - v_days AND c.day <= v_today)));
  END LOOP;

  -- Totaux de la période et ventes de la période précédente.
  SELECT jsonb_build_object(
           'received', count(*),
           'sends', count(DISTINCT m.campaign_id),
           'clicked', count(*) FILTER (WHERE m.clicked),
           'ticketing', count(*) FILTER (WHERE m.ticketing),
           'bought', count(*) FILTER (WHERE m.bought),
           'buyers', count(DISTINCT m.email) FILTER (WHERE m.bought),
           'revenue', COALESCE(round(sum(m.revenue), 2), 0))
    INTO v_tot
    FROM _cm m WHERE m.sent_at >= v_from;
  SELECT COALESCE(round(sum(m.revenue), 2), 0) INTO v_prev FROM _cm m WHERE m.sent_at < v_from;

  -- Ventes attribuées par tranche (jour / semaine / mois), date d'achat ;
  -- les envois de chaque tranche pour les points du graphique.
  WITH b AS (
    SELECT g AS i, v_now - make_interval(days => v_days - g * v_step) AS lo,
           v_now - make_interval(days => v_days - (g + 1) * v_step) AS hi
      FROM generate_series(0, v_days / v_step - 1) g
  ), att AS (
    SELECT a.amount, a.bought_at FROM _cma a
     WHERE EXISTS (SELECT 1 FROM _cm m WHERE m.campaign_id = a.campaign_id AND m.email = a.email AND m.sent_at >= v_from)
  )
  SELECT jsonb_agg(jsonb_build_object(
           't', b.lo,
           'v', COALESCE((SELECT round(sum(att.amount), 2) FROM att WHERE att.bought_at >= b.lo AND att.bought_at < b.hi), 0),
           'sends', COALESCE((SELECT jsonb_agg(c.name ORDER BY c.sent_at) FROM _cmc c WHERE c.sent_at >= b.lo AND c.sent_at < b.hi), '[]'::jsonb))
           ORDER BY b.i)
    INTO v_series FROM b;

  -- Les envois de la période (e-mail et SMS), du plus récent au plus ancien.
  WITH s AS (
    SELECT m.campaign_id, m.channel, min(m.sent_at) AS sent_at,
           count(*) AS received, count(*) FILTER (WHERE m.clicked) AS clicked,
           count(*) FILTER (WHERE m.ticketing) AS ticketing, count(*) FILTER (WHERE m.bought) AS bought,
           count(DISTINCT m.email) FILTER (WHERE m.bought) AS buyers, COALESCE(round(sum(m.revenue), 2), 0) AS revenue
      FROM _cm m WHERE m.sent_at >= v_from
     GROUP BY m.campaign_id, m.channel
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.campaign_id, 'channel', s.channel,
           'name', COALESCE(c.name, sc.name), 'sent_at', s.sent_at,
           'target', CASE WHEN s.channel = 'email' THEN public._crm_send_target(c.audiences_json) ELSE 'custom' END,
           'received', s.received, 'clicked', s.clicked, 'ticketing', s.ticketing, 'bought', s.bought,
           'buyers', s.buyers, 'revenue', s.revenue) ORDER BY s.sent_at DESC), '[]'::jsonb)
    INTO v_sends
    FROM s
    LEFT JOIN _cmc c ON s.channel = 'email' AND c.id = s.campaign_id
    LEFT JOIN public.sms_campaigns sc ON s.channel = 'sms' AND sc.id = s.campaign_id;

  RETURN jsonb_build_object(
    'period', p_period, 'from', v_from, 'to', v_now, 'step_days', v_step,
    'totals', v_tot || jsonb_build_object('prev_revenue', v_prev,
                         'has_prev', EXISTS (SELECT 1 FROM _cm m WHERE m.sent_at < v_from)),
    'series', COALESCE(v_series, '[]'::jsonb),
    'segments', v_segs,
    'sends', v_sends,
    'rules', (SELECT to_jsonb(r) FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) r),
    'computed_at', v_now,
    'rebuilt_anchors', v_builds);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_yunits_balance(p_scope_key text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(remaining), 0)::int
    FROM public.crm_yunit_lots
   WHERE scope_key = p_scope_key AND remaining > 0 AND (expires_at IS NULL OR expires_at > now());
$function$;

CREATE OR REPLACE FUNCTION public.demo_event_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH dv AS MATERIALIZED (SELECT public.demo_venue_ids() AS ids)
  SELECT COALESCE(array_agg(e.id), '{}'::uuid[])
  FROM public.events e
  CROSS JOIN dv
  LEFT JOIN public.profiles op ON op.id = e.organizer_user_id
  LEFT JOIN public.organizer_profiles o ON o.user_id = e.organizer_user_id
  WHERE e.venue_id = ANY (dv.ids)
     OR e.partner_venue_id = ANY (dv.ids)
     OR public.is_demo_email(op.email)
     OR COALESCE(o.is_showcase_shadow, false);
$function$;

CREATE OR REPLACE FUNCTION public.demo_venue_ids()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(v.id), '{}'::text[])
  FROM public.venues v
  LEFT JOIN public.profiles p ON p.id = v.owner_id
  WHERE public.is_demo_email(p.email)
     OR v.showcase_shadow_owner_id IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.emit_admin_notification(p_type text, p_title text, p_message text, p_priority text DEFAULT 'normal'::text, p_reference_type text DEFAULT NULL::text, p_reference_id text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_dedup_key text DEFAULT NULL::text, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.admin_notifications (
    notification_type, title, message, priority,
    reference_type, reference_id, metadata, dedup_key, event_id
  ) VALUES (
    p_type, p_title, p_message, COALESCE(p_priority, 'normal'),
    p_reference_type, p_reference_id, COALESCE(p_metadata, '{}'::jsonb),
    p_dedup_key, p_event_id
  )
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_analytics_scope(p_event_id uuid)
 RETURNS TABLE(ok boolean, reason text, scope_venue text, scope_org uuid, money boolean, scope_ids uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  e       record;
  v_venue text := null;
  v_org   uuid := null;
  v_money boolean := false;
  v_ids   uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, null::text, null::uuid, false, '{}'::uuid[]; RETURN;
  END IF;
  SELECT ev.* INTO e FROM public.events ev WHERE ev.id = p_event_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::text, null::text, null::uuid, false, '{}'::uuid[]; RETURN;
  END IF;

  IF e.venue_id IS NOT NULL AND (public.can_manage_venue(v_uid, e.venue_id) OR public.is_super_admin()) THEN
    v_venue := e.venue_id;
  ELSIF e.partner_venue_id IS NOT NULL AND public.can_manage_venue(v_uid, e.partner_venue_id) THEN
    v_venue := e.partner_venue_id;
  ELSIF e.organizer_user_id IS NOT NULL AND (
          v_uid = e.organizer_user_id
          OR public.is_super_admin()
          OR public.is_org_team_member(v_uid, e.organizer_user_id, 'editor')) THEN
    v_org := e.organizer_user_id;
  ELSIF e.partner_organizer_id IS NOT NULL AND (
          v_uid = e.partner_organizer_id
          OR public.is_org_team_member(v_uid, e.partner_organizer_id, 'editor')) THEN
    v_org := e.partner_organizer_id;
  ELSIF EXISTS (SELECT 1 FROM public.event_cohosts c
                 WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.organizer_user_id IS NOT NULL
                   AND (c.organizer_user_id = v_uid OR public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))) THEN
    SELECT c.organizer_user_id INTO v_org FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.organizer_user_id IS NOT NULL
       AND (c.organizer_user_id = v_uid OR public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))
     ORDER BY (c.organizer_user_id = v_uid) DESC LIMIT 1;
  ELSIF EXISTS (SELECT 1 FROM public.event_cohosts c
                 WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.venue_id IS NOT NULL
                   AND public.can_manage_venue(v_uid, c.venue_id)) THEN
    SELECT c.venue_id INTO v_venue FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.venue_id IS NOT NULL
       AND public.can_manage_venue(v_uid, c.venue_id)
     LIMIT 1;
  ELSE
    RETURN QUERY SELECT false, 'forbidden'::text, null::text, null::uuid, false, '{}'::uuid[]; RETURN;
  END IF;

  IF v_venue IS NOT NULL THEN
    v_money := (coalesce(v_venue = e.venue_id, false)
                OR public.coorg_cohost_sees_money(p_event_id, 'venue:' || v_venue)) AND (
      public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = v_venue AND v.owner_id = v_uid)
      OR EXISTS (
        SELECT 1 FROM public.manager_permissions mp
         WHERE mp.user_id = v_uid AND mp.venue_id = v_venue
           AND (coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false))
      ));
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ids
      FROM public.events x
     WHERE x.venue_id = v_venue OR x.partner_venue_id = v_venue
        OR x.id IN (SELECT public.cohost_event_ids_venue(v_venue));
  ELSE
    v_money := (v_uid = v_org
      OR public.is_super_admin()
      OR public.org_member_has_permission(v_uid, v_org, 'view_finance'))
      AND (public.is_super_admin() OR public.coorg_sees_event_money(p_event_id, 'org:' || v_org::text));
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ids
      FROM public.events x
     WHERE x.organizer_user_id = v_org OR x.partner_organizer_id = v_org
        OR x.id IN (SELECT public.cohost_event_ids_org(v_org));
  END IF;

  RETURN QUERY SELECT true, null::text, v_venue, v_org, v_money, v_ids;
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_host_slug(p_event_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN e.organizer_user_id IS NOT NULL
             THEN (SELECT o.slug FROM public.organizer_profiles o WHERE o.user_id = e.organizer_user_id)
           ELSE (SELECT COALESCE(NULLIF(v.slug, ''), v.id) FROM public.venues v WHERE v.id = e.venue_id)
         END
    FROM public.events e WHERE e.id = p_event_id;
$function$;

CREATE OR REPLACE FUNCTION public.event_parties(p_event_id uuid)
 RETURNS TABLE(party_key text, kind text, venue_id text, organizer_user_id uuid, role text, access text, share_crm boolean, cohost_id uuid, display_name text, slug text, avatar_url text, city text, ord integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH e AS (SELECT * FROM public.events WHERE id = p_event_id),
  raw AS (
    SELECT 'venue:' || e.venue_id AS party_key, 'venue'::text AS kind, e.venue_id AS venue_id,
           NULL::uuid AS organizer_user_id, 'lead'::text AS role, 'owner'::text AS access,
           true AS share_crm, NULL::uuid AS cohost_id, 1 AS ord
      FROM e WHERE e.venue_id IS NOT NULL
    UNION ALL
    SELECT 'org:' || e.organizer_user_id, 'org', NULL, e.organizer_user_id,
           CASE WHEN e.venue_id IS NULL THEN 'lead' ELSE 'partner' END, 'owner', true, NULL,
           CASE WHEN e.venue_id IS NULL THEN 1 ELSE 2 END
      FROM e WHERE e.organizer_user_id IS NOT NULL
    UNION ALL
    SELECT 'venue:' || e.partner_venue_id, 'venue', e.partner_venue_id, NULL, 'partner', 'owner', true, NULL, 2
      FROM e WHERE e.partner_venue_id IS NOT NULL
    UNION ALL
    SELECT 'org:' || e.partner_organizer_id, 'org', NULL, e.partner_organizer_id, 'partner', 'owner', true, NULL, 2
      FROM e WHERE e.partner_organizer_id IS NOT NULL
    UNION ALL
    SELECT CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END,
           CASE WHEN c.venue_id IS NOT NULL THEN 'venue' ELSE 'org' END,
           c.venue_id, c.organizer_user_id, 'cohost', c.access, c.share_crm, c.id, 3
      FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted'
  ),
  dedup AS (
    SELECT DISTINCT ON (party_key) * FROM raw ORDER BY party_key, ord
  )
  SELECT d.party_key, d.kind, d.venue_id, d.organizer_user_id, d.role, d.access, d.share_crm, d.cohost_id,
         COALESCE(v.name, op.display_name, pr.organization_name, 'Organisateur') AS display_name,
         COALESCE(v.slug, op.slug) AS slug,
         COALESCE(v.logo_url, op.avatar_url, pr.organization_logo_url) AS avatar_url,
         COALESCE(v.city, op.city) AS city,
         d.ord
    FROM dedup d
    LEFT JOIN public.venues v ON v.id = d.venue_id
    LEFT JOIN public.organizer_profiles op ON op.user_id = d.organizer_user_id
    LEFT JOIN public.profiles pr ON pr.id = d.organizer_user_id
   ORDER BY d.ord, d.party_key;
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_cohorts(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_months integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g record; v_rows jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  WITH pp AS MATERIALIZED (
    SELECT p.email, p.at_ts, p.amount, p.first_seen FROM public._an3_people(g.scope_ids, g.scope_venue) p
     WHERE p.pillar <> 'guest_list'
  ),
  cohort AS (
    SELECT date_trunc('month', pp.first_seen AT TIME ZONE g.tz)::date AS month, pp.email,
           (extract(year FROM age(date_trunc('month', pp.at_ts AT TIME ZONE g.tz), date_trunc('month', pp.first_seen AT TIME ZONE g.tz))) * 12
            + extract(month FROM age(date_trunc('month', pp.at_ts AT TIME ZONE g.tz), date_trunc('month', pp.first_seen AT TIME ZONE g.tz))))::int AS m,
           pp.amount
      FROM pp
     WHERE pp.first_seen >= (date_trunc('month', now() AT TIME ZONE g.tz) - make_interval(months => greatest(p_months, 1)))
  ),
  agg AS (
    SELECT month, count(DISTINCT email)::int AS people,
           round(sum(amount) FILTER (WHERE m = 0), 2) AS m0,
           round(sum(amount) FILTER (WHERE m = 1), 2) AS m1, round(sum(amount) FILTER (WHERE m = 2), 2) AS m2,
           round(sum(amount) FILTER (WHERE m = 3), 2) AS m3, round(sum(amount) FILTER (WHERE m = 6), 2) AS m6,
           count(DISTINCT email) FILTER (WHERE m = 1)::int AS p1, count(DISTINCT email) FILTER (WHERE m = 2)::int AS p2,
           count(DISTINCT email) FILTER (WHERE m = 3)::int AS p3, count(DISTINCT email) FILTER (WHERE m = 6)::int AS p6,
           (date_trunc('month', now() AT TIME ZONE g.tz)::date - month) / 30 AS age_months
      FROM cohort GROUP BY month
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'month', to_char(a.month, 'YYYY-MM'), 'people', a.people, 'masked', a.people < 10,
    'm0', CASE WHEN g.money AND a.people >= 10 THEN a.m0 END,
    'm1', CASE WHEN g.money AND a.people >= 10 AND a.age_months >= 1 THEN coalesce(a.m1, 0) END,
    'm2', CASE WHEN g.money AND a.people >= 10 AND a.age_months >= 2 THEN coalesce(a.m2, 0) END,
    'm3', CASE WHEN g.money AND a.people >= 10 AND a.age_months >= 3 THEN coalesce(a.m3, 0) END,
    'm6', CASE WHEN g.money AND a.people >= 10 AND a.age_months >= 6 THEN coalesce(a.m6, 0) END,
    'r1', CASE WHEN a.people >= 10 AND a.age_months >= 1 THEN round(100.0 * a.p1 / a.people, 1) END,
    'r2', CASE WHEN a.people >= 10 AND a.age_months >= 2 THEN round(100.0 * a.p2 / a.people, 1) END,
    'r3', CASE WHEN a.people >= 10 AND a.age_months >= 3 THEN round(100.0 * a.p3 / a.people, 1) END,
    'r6', CASE WHEN a.people >= 10 AND a.age_months >= 6 THEN round(100.0 * a.p6 / a.people, 1) END
  ) ORDER BY a.month), '[]'::jsonb) INTO v_rows FROM agg a;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'rows', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_door(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g           record;
  v_ids       uuid[];
  v_now       timestamptz := now();
  v_arrivals  jsonb;
  v_marks     jsonb;
  v_types     jsonb;
  v_gl        jsonb;
  v_tables    jsonb;
  v_totals    jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  WITH ev AS (
    SELECT e.id, e.start_at, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts,
           coalesce(nullif(e.timezone, ''), v.timezone, g.tz) AS tz,
           public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz)) AS night,
           (g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)) AS show_money
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = ANY(v_ids)
  ),
  -- Midi de la nuit, en timestamptz, pour mesurer chaque scan en minutes.
  noon AS (
    SELECT ev.id, ((ev.night::timestamp + interval '12 hours') AT TIME ZONE ev.tz) AS noon_ts FROM ev
  ),
  scans AS (
    -- Billets : nominatifs par personne, sinon la quantité du billet.
    SELECT t.event_id, a.entry_scanned_at AS at_ts, 1 AS heads, 'tickets'::text AS kind
      FROM public.tickets t JOIN public.ticket_attendees a ON a.ticket_id = t.id
     WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used') AND a.entry_scanned AND a.entry_scanned_at IS NOT NULL
    UNION ALL
    SELECT t.event_id, coalesce(t.entry_scanned_at, t.used_at), greatest(coalesce(t.quantity, 1), 1), 'tickets'
      FROM public.tickets t
     WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used')
       AND (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used')
       AND coalesce(t.entry_scanned_at, t.used_at) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.ticket_attendees a WHERE a.ticket_id = t.id)
    UNION ALL
    SELECT g2.event_id, x.entry_scanned_at, 1, 'guest_list'
      FROM public.guest_list_entries x JOIN public.guest_lists g2 ON g2.id = x.guest_list_id
     WHERE g2.event_id = ANY(v_ids) AND x.status IS DISTINCT FROM 'cancelled' AND coalesce(x.entry_scanned, false) AND x.entry_scanned_at IS NOT NULL
    UNION ALL
    SELECT r.event_id, coalesce(r.entry_scanned_at, r.checked_in_at), greatest(coalesce(r.guest_count, 1), 1), 'tables'
      FROM public.table_reservations r
     WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')
       AND (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL) AND coalesce(r.entry_scanned_at, r.checked_in_at) IS NOT NULL
  ),
  slots AS (
    SELECT (floor(extract(epoch FROM (s.at_ts - n.noon_ts)) / 900) * 15)::int AS m, s.kind, sum(s.heads)::int AS heads
      FROM scans s JOIN noon n ON n.id = s.event_id
     WHERE s.at_ts >= n.noon_ts AND s.at_ts < n.noon_ts + interval '24 hours'
     GROUP BY 1, 2
  )
  SELECT
    coalesce((SELECT jsonb_agg(jsonb_build_object('m', x.m, 'n', x.n, 'tickets', x.t, 'guest_list', x.gl, 'tables', x.tb) ORDER BY x.m)
              FROM (SELECT m, sum(heads)::int AS n, sum(heads) FILTER (WHERE kind = 'tickets')::int AS t,
                           sum(heads) FILTER (WHERE kind = 'guest_list')::int AS gl, sum(heads) FILTER (WHERE kind = 'tables')::int AS tb
                      FROM slots GROUP BY m) x), '[]'::jsonb),
    jsonb_build_object(
      'nights', (SELECT count(*) FROM ev),
      'scanned_nights', (SELECT count(DISTINCT event_id) FROM scans),
      'doors_open_m', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (ev.start_at - n.noon_ts)) / 60))
                         FROM ev JOIN noon n ON n.id = ev.id),
      'gl_deadline_m', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY
                          CASE WHEN gl.entry_deadline < time '12:00' THEN extract(epoch FROM gl.entry_deadline) / 60 + 720 ELSE extract(epoch FROM gl.entry_deadline) / 60 - 720 END))
                          FROM public.guest_lists gl WHERE gl.event_id = ANY(v_ids) AND gl.entry_deadline IS NOT NULL),
      'peak_m', (SELECT x.m FROM (SELECT m, sum(heads) AS n FROM slots GROUP BY m ORDER BY n DESC, m LIMIT 1) x))
    INTO v_arrivals, v_marks;

  -- ── Présence par type (soirées terminées où la porte a scanné) ────────────
  WITH ev AS (
    SELECT e.id, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts FROM public.events e WHERE e.id = ANY(v_ids)
  ),
  judged AS (
    SELECT n.event_id FROM public._an3_nights(v_ids, g.scope_venue, g.money) n WHERE n.end_ts <= v_now AND n.entries > 0
  ),
  tk AS (
    SELECT t.id, t.event_id, greatest(coalesce(t.quantity, 1), 1) AS units,
           EXISTS (SELECT 1 FROM public.ticket_attendees a WHERE a.ticket_id = t.id) AS nominative,
           (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used') AS scanned
      FROM public.tickets t WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used')
  ),
  tk_agg AS (
    SELECT coalesce(sum(units) FILTER (WHERE event_id IN (SELECT event_id FROM judged)), 0)::int AS expected,
           (coalesce((SELECT count(*) FROM public.ticket_attendees a JOIN tk ON tk.id = a.ticket_id WHERE a.entry_scanned AND tk.event_id IN (SELECT event_id FROM judged)), 0)
            + coalesce(sum(units) FILTER (WHERE NOT nominative AND scanned AND event_id IN (SELECT event_id FROM judged)), 0))::int AS entered,
           coalesce(sum(units), 0)::int AS expected_all
      FROM tk
  ),
  gl_agg AS (
    SELECT count(*) FILTER (WHERE g2.event_id IN (SELECT event_id FROM judged))::int AS expected,
           count(*) FILTER (WHERE coalesce(x.entry_scanned, false) AND g2.event_id IN (SELECT event_id FROM judged))::int AS entered,
           count(*)::int AS expected_all
      FROM public.guest_list_entries x JOIN public.guest_lists g2 ON g2.id = x.guest_list_id
     WHERE g2.event_id = ANY(v_ids) AND x.status IS DISTINCT FROM 'cancelled'
  ),
  tb_agg AS (
    SELECT count(*) FILTER (WHERE r.event_id IN (SELECT event_id FROM judged))::int AS booked,
           count(*) FILTER (WHERE (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL) AND r.event_id IN (SELECT event_id FROM judged))::int AS arrived,
           coalesce(sum(greatest(coalesce(r.guest_count, 1), 1)) FILTER (WHERE r.event_id IN (SELECT event_id FROM judged)), 0)::int AS guests_expected,
           coalesce(sum(greatest(coalesce(r.guest_count, 1), 1)) FILTER (WHERE (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL) AND r.event_id IN (SELECT event_id FROM judged)), 0)::int AS guests_arrived,
           count(*)::int AS booked_all
      FROM public.table_reservations r WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')
  )
  SELECT jsonb_build_object(
    'judged_nights', (SELECT count(*) FROM judged),
    'tickets', (SELECT jsonb_build_object('expected', expected, 'entered', entered, 'expected_all', expected_all,
                  'rate', CASE WHEN expected >= 10 THEN round(100.0 * entered / expected, 1) END) FROM tk_agg),
    'guest_list', (SELECT jsonb_build_object('expected', expected, 'entered', entered, 'expected_all', expected_all,
                  'rate', CASE WHEN expected >= 10 THEN round(100.0 * entered / expected, 1) END) FROM gl_agg),
    'tables', (SELECT jsonb_build_object('booked', booked, 'arrived', arrived, 'booked_all', booked_all,
                  'guests_expected', guests_expected, 'guests_arrived', guests_arrived,
                  'rate', CASE WHEN booked >= 5 THEN round(100.0 * arrived / booked, 1) END) FROM tb_agg))
    INTO v_types;

  -- ── Guest list → achat payant sous 90 jours (dans la portée) ─────────────
  WITH gl_people AS (
    SELECT DISTINCT lower(trim(x.email)) AS email, e.start_at
      FROM public.guest_list_entries x JOIN public.guest_lists g2 ON g2.id = x.guest_list_id JOIN public.events e ON e.id = g2.event_id
     WHERE g2.event_id = ANY(v_ids) AND x.status IS DISTINCT FROM 'cancelled' AND nullif(trim(x.email), '') IS NOT NULL
  ),
  paid AS MATERIALIZED (
    SELECT p.email, p.at_ts FROM public._an3_people(g.scope_ids, g.scope_venue) p
     WHERE p.pillar IN ('tickets', 'tables') AND p.email IN (SELECT email FROM gl_people)
  ),
  conv AS (
    SELECT gp.email,
           EXISTS (SELECT 1 FROM paid p WHERE p.email = gp.email AND p.at_ts > gp.start_at AND p.at_ts <= gp.start_at + interval '90 days') AS converted
      FROM gl_people gp
  )
  SELECT jsonb_build_object(
    'people', count(*), 'converted', count(*) FILTER (WHERE converted),
    'rate', CASE WHEN count(*) >= 10 THEN round(100.0 * count(*) FILTER (WHERE converted) / count(*), 1) END,
    'matured', (SELECT count(*) FROM gl_people WHERE start_at <= v_now - interval '90 days'))
    INTO v_gl FROM conv;

  -- ── Tables par zone ───────────────────────────────────────────────────────
  WITH ev AS (
    SELECT e.id, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts,
           (g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)) AS show_money
      FROM public.events e WHERE e.id = ANY(v_ids)
  ),
  res AS (
    SELECT r.id, r.event_id, r.zone_id, r.pack_id, r.status, r.placement_status, r.guest_count,
           (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL) AS arrived,
           ev.end_ts <= v_now AS finished, ev.show_money,
           CASE WHEN ev.show_money THEN greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)) ELSE 0 END AS amount,
           CASE WHEN ev.show_money AND coalesce(r.payment_mode, 'online') <> 'on_site' THEN greatest(coalesce(r.deposit, 0), 0) ELSE 0 END AS deposit,
           coalesce(r.minimum_spend, 0) AS minimum,
           CASE WHEN ev.show_money THEN coalesce((SELECT sum(o.total_amount) FROM public.vip_table_orders o WHERE o.table_reservation_id = r.id AND o.status IS DISTINCT FROM 'cancelled'), 0) ELSE 0 END AS spent
      FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
  ),
  scanned_nights AS (
    SELECT DISTINCT event_id FROM res WHERE arrived
  ),
  zones AS (
    SELECT coalesce(z.name, '—') AS zone, z.id AS zone_id,
           count(*) FILTER (WHERE res.status IN ('paid', 'confirmed'))::int AS booked,
           count(*) FILTER (WHERE res.status = 'pending' OR res.placement_status = 'requested')::int AS requests,
           coalesce(sum(greatest(coalesce(res.guest_count, 1), 1)) FILTER (WHERE res.status IN ('paid', 'confirmed')), 0)::int AS guests,
           count(*) FILTER (WHERE res.status IN ('paid', 'confirmed') AND res.arrived)::int AS arrived,
           count(*) FILTER (WHERE res.status IN ('paid', 'confirmed') AND res.finished AND NOT res.arrived AND res.event_id IN (SELECT event_id FROM scanned_nights))::int AS no_show,
           round(sum(res.amount) FILTER (WHERE res.status IN ('paid', 'confirmed')), 2) AS revenue,
           round(sum(res.deposit) FILTER (WHERE res.status IN ('paid', 'confirmed')), 2) AS deposits,
           round(sum(res.minimum) FILTER (WHERE res.status IN ('paid', 'confirmed') AND res.show_money), 2) AS minimum,
           round(sum(res.spent) FILTER (WHERE res.status IN ('paid', 'confirmed')), 2) AS spent,
           count(*) FILTER (WHERE res.status IN ('paid', 'confirmed') AND res.spent > 0)::int AS with_spend
      FROM res LEFT JOIN public.table_zones z ON z.id = res.zone_id
     GROUP BY z.id, z.name
  )
  SELECT jsonb_build_object(
    'zones', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'zone', zone, 'zone_id', zone_id, 'booked', booked, 'requests', requests, 'guests', guests, 'arrived', arrived, 'no_show', no_show,
        'revenue', CASE WHEN g.money THEN revenue END, 'deposits', CASE WHEN g.money THEN deposits END,
        'revenue_per_table', CASE WHEN g.money AND booked > 0 THEN round(revenue / booked, 2) END,
        'minimum', CASE WHEN g.money THEN minimum END, 'spent', CASE WHEN g.money THEN spent END, 'with_spend', with_spend,
        'spend_vs_min', CASE WHEN g.money AND with_spend >= 3 AND minimum > 0 THEN round(spent / nullif(minimum, 0), 2) END
      ) ORDER BY coalesce(revenue, 0) DESC, booked DESC) FROM zones), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
        'booked', coalesce(sum(booked), 0), 'requests', coalesce(sum(requests), 0), 'arrived', coalesce(sum(arrived), 0), 'no_show', coalesce(sum(no_show), 0),
        'guests', coalesce(sum(guests), 0),
        'revenue', CASE WHEN g.money THEN round(coalesce(sum(revenue), 0), 2) END,
        'deposits', CASE WHEN g.money THEN round(coalesce(sum(deposits), 0), 2) END,
        'spent', CASE WHEN g.money THEN round(coalesce(sum(spent), 0), 2) END,
        'minimum', CASE WHEN g.money THEN round(coalesce(sum(minimum), 0), 2) END) FROM zones))
    INTO v_tables;

  -- ── Revenu par personne présente ─────────────────────────────────────────
  SELECT jsonb_build_object(
    'revenue', CASE WHEN g.money THEN round(coalesce(sum(n.revenue) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0), 0), 2) END,
    'entries', coalesce(sum(n.entries) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0), 0),
    'expected', coalesce(sum(n.expected) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0), 0),
    'per_head', CASE WHEN g.money AND coalesce(sum(n.entries) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0), 0) > 0
                     THEN round(sum(n.revenue) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0) / sum(n.entries) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0), 2) END,
    'scanned_nights', count(*) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0),
    'finished_nights', count(*) FILTER (WHERE n.end_ts <= v_now))
    INTO v_totals
    FROM public._an3_nights(v_ids, g.scope_venue, g.money) n;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'tz', g.tz, 'nights', cardinality(v_ids),
    'arrivals', v_arrivals, 'marks', v_marks, 'by_type', v_types, 'gl_to_paid', v_gl, 'tables', v_tables, 'totals', v_totals);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_event_rail(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g record;
  v_now timestamptz := now();
  v_rows jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  WITH ev AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, COALESCE(e.end_at, e.start_at + interval '8 hours') AS end_ts,
           COALESCE(e.poster_url, e.image_url) AS poster,
           (g.scope_venue IS NOT NULL AND e.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND e.organizer_user_id = g.scope_org) AS hosted
      FROM public.events e
     WHERE e.id = ANY (g.scope_ids) AND e.cancelled_at IS NULL AND COALESCE(e.status, 'active') <> 'cancelled'
     ORDER BY e.start_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 80), 200))
  ),
  tx AS MATERIALIZED (
    SELECT t.event_id, lower(btrim(t.user_email)) AS email, greatest(COALESCE(t.quantity, 1), 1) AS units, 'tickets' AS pillar,
           greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0), greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t WHERE t.event_id IN (SELECT id FROM ev) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT r.event_id, lower(btrim(r.user_email)), 1, 'tables',
           greatest(r.total_price - COALESCE(r.service_fee, 0) - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(r.total_price - COALESCE(r.service_fee, 0) - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r WHERE r.event_id IN (SELECT id FROM ev) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT gl.event_id, lower(nullif(btrim(ge.email), '')), 1, 'guests', 0::numeric
      FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM ev) AND ge.status <> 'cancelled'
    UNION ALL
    SELECT o.event_id, null, 0, 'drinks',
           greatest(o.total - COALESCE(o.service_fee, 0), 0)
             - least(greatest(COALESCE(o.refund_amount, 0), 0), greatest(o.total - COALESCE(o.service_fee, 0), 0))
      FROM public.orders o
     WHERE g.scope_venue IS NOT NULL AND o.venue_id = g.scope_venue AND o.event_id IN (SELECT id FROM ev) AND o.status IN ('paid', 'served')
  ),
  agg AS (
    SELECT event_id,
           sum(units) FILTER (WHERE pillar = 'tickets') AS tickets,
           count(*) FILTER (WHERE pillar = 'tables') AS tables,
           count(*) FILTER (WHERE pillar = 'guests') AS guests,
           count(DISTINCT email) FILTER (WHERE pillar <> 'drinks') AS people,
           sum(amount) AS revenue
      FROM tx GROUP BY event_id
  ),
  vis AS (SELECT s.event_id, count(*) AS n FROM public.visitor_sessions s WHERE s.event_id IN (SELECT id FROM ev) GROUP BY s.event_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ev.id, 'title', ev.title, 'startAt', ev.start_at, 'endAt', ev.end_ts, 'poster', ev.poster,
           'phase', CASE WHEN v_now < ev.start_at THEN 'before' WHEN v_now < ev.end_ts THEN 'live' ELSE 'after' END,
           'tickets', COALESCE(a.tickets, 0), 'tables', COALESCE(a.tables, 0), 'guests', COALESCE(a.guests, 0),
           'people', COALESCE(a.people, 0), 'visits', COALESCE(v.n, 0),
           'revenue', CASE WHEN g.money AND ev.hosted THEN round(COALESCE(a.revenue, 0), 2) END
         ) ORDER BY ev.start_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM ev LEFT JOIN agg a ON a.event_id = ev.id LEFT JOIN vis v ON v.event_id = ev.id;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'now', v_now, 'events', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_insights(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_compare text DEFAULT 'median5'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g        record;
  v_ids    uuid[];
  v_out    jsonb := '[]'::jsonb;
  v_pace   jsonb;
  v_sales  jsonb;
  v_door   jsonb;
  v_src    jsonb;
  v_row    jsonb;
  v_ev     record;
  v_n      numeric; v_m numeric; v_a numeric; v_b numeric;
  v_top    jsonb; v_worst jsonb;
  v_pillars int;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);

  -- 1. Rythme (soirée à venir, ≥ 3 comparables).
  IF p_event_id IS NOT NULL THEN
    v_pace := public.get_analytics_pacing(p_event_id, CASE WHEN p_compare IN ('comparable', 'previous') THEN 'median5' ELSE p_compare END, 30);
    IF (v_pace ->> 'ok')::boolean AND (v_pace #>> '{compare,n}')::int >= 3 AND (v_pace #>> '{event,status}') <> 'past'
       AND (v_pace #>> '{at_d,ref_tickets}')::numeric >= 20 AND v_pace ->> 'status' IN ('bad', 'warn') THEN
      v_n := (v_pace #>> '{at_d,tickets}')::numeric; v_m := (v_pace #>> '{at_d,ref_tickets}')::numeric;
      v_out := v_out || jsonb_build_object('key', 'pacing_behind', 'level', CASE WHEN v_pace ->> 'status' = 'bad' THEN 'critical' ELSE 'warn' END, 'tab', 'sales',
        'params', jsonb_build_object('d', (v_pace ->> 'today_d')::int, 'pct', round(100.0 * (v_m - v_n) / v_m), 'n', (v_pace #>> '{compare,n}')::int, 'tickets', v_n, 'ref', round(v_m)));
    ELSIF (v_pace ->> 'ok')::boolean AND (v_pace #>> '{compare,n}')::int >= 3 AND (v_pace #>> '{event,status}') <> 'past'
       AND (v_pace #>> '{at_d,ref_tickets}')::numeric >= 20 AND v_pace ->> 'status' = 'good'
       AND (v_pace #>> '{at_d,tickets}')::numeric >= 1.15 * (v_pace #>> '{at_d,ref_tickets}')::numeric THEN
      v_n := (v_pace #>> '{at_d,tickets}')::numeric; v_m := (v_pace #>> '{at_d,ref_tickets}')::numeric;
      v_out := v_out || jsonb_build_object('key', 'pacing_ahead', 'level', 'info', 'tab', 'sales',
        'params', jsonb_build_object('d', (v_pace ->> 'today_d')::int, 'pct', round(100.0 * (v_n - v_m) / v_m), 'n', (v_pace #>> '{compare,n}')::int));
    END IF;
  END IF;

  -- 2. Paliers (soirée) : un palier épuisé en moins de 24 h.
  v_sales := public.get_analytics_sales(p_venue_id, p_organizer_user_id, p_event_id, p_from, p_to);
  IF (v_sales ->> 'ok')::boolean THEN
    IF p_event_id IS NOT NULL THEN
      SELECT x INTO v_row FROM jsonb_array_elements(v_sales -> 'rounds') x
       WHERE (x ->> 'status') = 'sold_out' AND (x ->> 'hours_to_sell_out')::numeric < 24 AND (x ->> 'qty')::int >= 20
       ORDER BY (x ->> 'hours_to_sell_out')::numeric LIMIT 1;
      IF v_row IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('key', 'tier_gone_fast', 'level', 'info', 'tab', 'sales',
          'params', jsonb_build_object('name', v_row ->> 'name', 'hours', round((v_row ->> 'hours_to_sell_out')::numeric), 'qty', (v_row ->> 'qty')::int));
      END IF;
    END IF;
    -- 4. Timing : ≥ 20 achats, un jour qui pèse ≥ 25 %.
    IF (v_sales #>> '{heatmap,total}')::int >= 20 THEN
      SELECT x INTO v_row FROM jsonb_array_elements(v_sales #> '{heatmap,by_weekday}') x ORDER BY (x ->> 'n')::int DESC LIMIT 1;
      IF v_row IS NOT NULL AND (v_row ->> 'n')::numeric >= 0.25 * (v_sales #>> '{heatmap,total}')::numeric THEN
        SELECT y INTO v_top FROM jsonb_array_elements(v_sales #> '{heatmap,by_hour}') y ORDER BY (y ->> 'n')::int DESC LIMIT 1;
        v_out := v_out || jsonb_build_object('key', 'buy_timing', 'level', 'info', 'tab', 'sales',
          'params', jsonb_build_object('weekday', (v_row ->> 'w')::int, 'hour', (v_top ->> 'h')::int, 'pct', round(100.0 * (v_row ->> 'n')::numeric / (v_sales #>> '{heatmap,total}')::numeric), 'n', (v_sales #>> '{heatmap,total}')::int));
      END IF;
    END IF;
  END IF;

  -- 3 et 8. Canal et tunnel.
  v_src := public.get_analytics_sources(p_venue_id, p_organizer_user_id, p_event_id, p_from, p_to);
  IF (v_src ->> 'ok')::boolean THEN
    IF (v_src #>> '{totals,sessions}')::int >= 100 AND (v_src #>> '{totals,orders}')::int >= 20 THEN
      -- Une source qui pèse ≥ 20 % des visites mais moins de la moitié de cette part en ventes.
      SELECT x INTO v_row FROM jsonb_array_elements(v_src -> 'sources') x
       WHERE (x ->> 'sessions')::numeric >= 0.2 * (v_src #>> '{totals,sessions}')::numeric
         AND (x ->> 'orders')::numeric / (v_src #>> '{totals,orders}')::numeric < 0.5 * ((x ->> 'sessions')::numeric / (v_src #>> '{totals,sessions}')::numeric)
       ORDER BY (x ->> 'sessions')::int DESC LIMIT 1;
      IF v_row IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('key', 'channel_gap', 'level', 'warn', 'tab', 'sources',
          'params', jsonb_build_object('source', v_row ->> 'source',
            'visits_pct', round(100.0 * (v_row ->> 'sessions')::numeric / (v_src #>> '{totals,sessions}')::numeric),
            'sales_pct', round(100.0 * (v_row ->> 'orders')::numeric / (v_src #>> '{totals,orders}')::numeric)));
      END IF;
    END IF;
    SELECT (x ->> 'n')::numeric INTO v_a FROM jsonb_array_elements(v_src -> 'funnel') x WHERE x ->> 'step' = 'checkout';
    SELECT (x ->> 'n')::numeric INTO v_b FROM jsonb_array_elements(v_src -> 'funnel') x WHERE x ->> 'step' = 'paid';
    IF v_a >= 20 AND v_b IS NOT NULL AND v_b / v_a < 0.6 THEN
      v_out := v_out || jsonb_build_object('key', 'checkout_leak', 'level', 'warn', 'tab', 'sources',
        'params', jsonb_build_object('pct', round(100.0 * v_b / v_a), 'checkouts', v_a::int));
    END IF;
  END IF;

  -- 6 et 7. Porte et tables.
  v_door := public.get_analytics_door(p_venue_id, p_organizer_user_id, p_event_id, p_from, p_to);
  IF (v_door ->> 'ok')::boolean THEN
    v_a := (v_door #>> '{by_type,guest_list,rate}')::numeric; v_b := (v_door #>> '{by_type,tickets,rate}')::numeric;
    IF v_a IS NOT NULL AND v_b IS NOT NULL AND (v_door #>> '{by_type,guest_list,expected}')::int >= 20 AND (v_door #>> '{by_type,tickets,expected}')::int >= 20
       AND v_b - v_a >= 20 THEN
      v_out := v_out || jsonb_build_object('key', 'guest_list_no_show', 'level', 'warn', 'tab', 'door',
        'params', jsonb_build_object('gl', round(v_a), 'tickets', round(v_b), 'factor', round(v_b / greatest(v_a, 1), 1)));
    END IF;
    SELECT x INTO v_top FROM jsonb_array_elements(v_door #> '{tables,zones}') x WHERE (x ->> 'spend_vs_min') IS NOT NULL ORDER BY (x ->> 'spend_vs_min')::numeric DESC LIMIT 1;
    SELECT x INTO v_worst FROM jsonb_array_elements(v_door #> '{tables,zones}') x WHERE (x ->> 'spend_vs_min') IS NOT NULL ORDER BY (x ->> 'spend_vs_min')::numeric ASC LIMIT 1;
    IF v_top IS NOT NULL AND v_worst IS NOT NULL AND (v_top ->> 'zone') <> (v_worst ->> 'zone')
       AND (v_top ->> 'spend_vs_min')::numeric >= 1.2 AND (v_worst ->> 'spend_vs_min')::numeric <= 0.9 THEN
      v_out := v_out || jsonb_build_object('key', 'zone_minimums', 'level', 'info', 'tab', 'door',
        'params', jsonb_build_object('top', v_top ->> 'zone', 'top_x', (v_top ->> 'spend_vs_min')::numeric, 'low', v_worst ->> 'zone', 'low_x', (v_worst ->> 'spend_vs_min')::numeric));
    END IF;
  END IF;

  -- 5. Audience : des piliers / fidèles qui n'ont pas encore pris leur place pour une soirée à venir.
  IF p_event_id IS NOT NULL AND g.money THEN
    SELECT e.id, e.title, e.start_at INTO v_ev FROM public.events e WHERE e.id = p_event_id;
    IF v_ev.start_at > now() THEN
      SELECT count(*) INTO v_pillars FROM (
        SELECT r.email FROM public._venue_customer_rfm(g.scope_venue) r WHERE g.scope_venue IS NOT NULL AND r.rfm_segment IN ('champions', 'loyal')
        UNION
        SELECT r.email FROM public.get_organizer_customer_segments(g.scope_org) r WHERE g.scope_org IS NOT NULL AND r.rfm_segment IN ('champions', 'loyal')
      ) x
      WHERE nullif(x.email, '') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = lower(x.email))
        AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr WHERE tr.event_id = p_event_id AND tr.status IN ('paid', 'confirmed') AND lower(tr.user_email) = lower(x.email));
      IF v_pillars >= 20 THEN
        v_out := v_out || jsonb_build_object('key', 'pillars_not_booked', 'level', 'info', 'tab', 'audience',
          'params', jsonb_build_object('n', v_pillars, 'title', v_ev.title, 'event_id', v_ev.id));
      END IF;
    END IF;
  END IF;

  -- Au plus trois, du plus grave au plus doux.
  SELECT coalesce(jsonb_agg(x ORDER BY CASE x ->> 'level' WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END), '[]'::jsonb)
    INTO v_out FROM (SELECT x FROM jsonb_array_elements(v_out) x
                     ORDER BY CASE x ->> 'level' WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END LIMIT 3) y;
  RETURN jsonb_build_object('ok', true, 'insights', v_out);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_pacing(p_event_id uuid, p_compare text DEFAULT 'median5'::text, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g          record;
  v_now      timestamptz := now();
  v_event    record;
  v_ref      uuid[] := '{}';
  v_comparable boolean := false;
  v_today_d  integer;
  v_days     integer := least(greatest(coalesce(p_days, 30), 7), 90);
  v_curve    jsonb;
  v_refs     jsonb;
  v_status   text := 'unknown';
  v_cur_at_d integer;
  v_ref_at_d numeric;
  v_ref_final numeric;
  v_forecast jsonb := NULL;
  v_markers  jsonb;
BEGIN
  SELECT * INTO g FROM public.event_analytics_scope(p_event_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  SELECT e.id, e.title, e.start_at, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts,
         coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris') AS tz, e.published_at, e.max_tickets,
         public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris')) AS night
    INTO v_event FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = p_event_id;

  -- d d'aujourd'hui : nuits pleines restantes avant la soirée (0 le jour J et après).
  v_today_d := greatest(0, least(v_days, v_event.night - public.night_date(v_now, v_event.tz)));

  IF p_compare = 'none' THEN
    v_ref := '{}';
  ELSIF p_compare = 'yoy' THEN
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ref FROM (
      SELECT e.id FROM public.events e
       WHERE e.id = ANY(g.scope_ids) AND e.id <> p_event_id
         AND e.start_at BETWEEN v_event.start_at - interval '1 year' - interval '10 days' AND v_event.start_at - interval '1 year' + interval '10 days'
       ORDER BY abs(extract(epoch FROM (e.start_at - (v_event.start_at - interval '1 year')))) LIMIT 1) x;
    v_comparable := false;
  ELSE
    SELECT coalesce(array_agg(c.event_id), '{}'), coalesce(bool_and(c.comparable), false)
      INTO v_ref, v_comparable
      FROM public._an3_comparables(p_event_id, g.scope_ids, CASE WHEN p_compare IN ('comparable', 'previous') THEN 1 ELSE 5 END) c;
  END IF;

  -- La courbe de la soirée, arrêtée à aujourd'hui (les jours à venir restent NULL).
  SELECT coalesce(jsonb_agg(jsonb_build_object('d', c.d,
           'revenue', CASE WHEN c.d >= v_today_d THEN c.revenue END,
           'tickets', CASE WHEN c.d >= v_today_d THEN c.tickets END,
           'heads', CASE WHEN c.d >= v_today_d THEN c.heads END) ORDER BY c.d DESC), '[]'::jsonb)
    INTO v_curve FROM public._an3_curve(ARRAY[p_event_id], g.scope_venue, g.money, v_days) c;

  -- Les comparables : médiane, min et max par d.
  SELECT coalesce(jsonb_agg(jsonb_build_object('d', x.d,
           'tickets_med', x.t_med, 'tickets_min', x.t_min, 'tickets_max', x.t_max,
           'revenue_med', x.r_med, 'revenue_min', x.r_min, 'revenue_max', x.r_max,
           'heads_med', x.h_med) ORDER BY x.d DESC), '[]'::jsonb)
    INTO v_refs
    FROM (
      SELECT c.d,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY c.tickets) AS t_med, min(c.tickets) AS t_min, max(c.tickets) AS t_max,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY c.revenue) AS r_med, min(c.revenue) AS r_min, max(c.revenue) AS r_max,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY c.heads) AS h_med
        FROM public._an3_curve(v_ref, g.scope_venue, g.money, v_days) c GROUP BY c.d) x;

  -- Statut à aujourd'hui : billets cumulés vs médiane des comparables au même d.
  SELECT c.tickets INTO v_cur_at_d FROM public._an3_curve(ARRAY[p_event_id], g.scope_venue, g.money, v_days) c WHERE c.d = v_today_d;
  SELECT (x ->> 'tickets_med')::numeric INTO v_ref_at_d FROM jsonb_array_elements(v_refs) x WHERE (x ->> 'd')::int = v_today_d;
  SELECT (x ->> 'tickets_med')::numeric INTO v_ref_final FROM jsonb_array_elements(v_refs) x WHERE (x ->> 'd')::int = 0;
  IF cardinality(v_ref) > 0 AND v_ref_at_d IS NOT NULL AND v_ref_at_d > 0 THEN
    v_status := CASE WHEN v_cur_at_d >= 0.95 * v_ref_at_d THEN 'good'
                     WHEN v_cur_at_d >= 0.80 * v_ref_at_d THEN 'warn'
                     ELSE 'bad' END;
    -- Projection de fin = cumul ÷ part médiane vendue à J-n (fourchette sur min/max).
    IF v_ref_final > 0 AND v_today_d > 0 THEN
      v_forecast := (
        SELECT jsonb_build_object(
          'tickets', round(v_cur_at_d / nullif((x ->> 'tickets_med')::numeric / v_ref_final, 0)),
          'tickets_low', round(v_cur_at_d / nullif((x ->> 'tickets_max')::numeric / nullif((SELECT max((y ->> 'tickets_max')::numeric) FROM jsonb_array_elements(v_refs) y WHERE (y ->> 'd')::int = 0), 0), 0)),
          'tickets_high', round(v_cur_at_d / nullif((x ->> 'tickets_min')::numeric / nullif((SELECT max((y ->> 'tickets_min')::numeric) FROM jsonb_array_elements(v_refs) y WHERE (y ->> 'd')::int = 0), 0), 0)),
          'share_sold_at_d', round(100.0 * (x ->> 'tickets_med')::numeric / v_ref_final, 1))
          FROM jsonb_array_elements(v_refs) x WHERE (x ->> 'd')::int = v_today_d);
    END IF;
  ELSIF cardinality(v_ref) > 0 AND v_today_d > 0 THEN
    v_status := 'no_reference_yet';
  END IF;

  -- Repères : publication, premier billet de chaque palier après le premier, emails et push de la soirée.
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', m.kind, 'd', m.d, 'at', m.at_ts, 'label', m.label) ORDER BY m.at_ts), '[]'::jsonb)
    INTO v_markers
    FROM (
      SELECT 'published'::text AS kind, v_event.published_at AS at_ts, NULL::text AS label,
             greatest(0, least(v_days, v_event.night - public.night_date(v_event.published_at, v_event.tz))) AS d
       WHERE v_event.published_at IS NOT NULL
      UNION ALL
      SELECT 'tier', x.first_at, x.name, greatest(0, least(v_days, v_event.night - public.night_date(x.first_at, v_event.tz)))
        FROM (
          SELECT tr.name, tr.position, min(coalesce(t.paid_at, t.created_at)) AS first_at
            FROM public.ticket_rounds tr JOIN public.tickets t ON t.ticket_round_id = tr.id AND t.status IN ('paid', 'used')
           WHERE tr.event_id = p_event_id GROUP BY tr.id, tr.name, tr.position) x
       WHERE x.position > (SELECT min(tr2.position) FROM public.ticket_rounds tr2 WHERE tr2.event_id = p_event_id)
      UNION ALL
      SELECT 'email', c.sent_at, c.name, greatest(0, least(v_days, v_event.night - public.night_date(c.sent_at, v_event.tz)))
        FROM public.email_campaigns c
       WHERE c.sent_at IS NOT NULL AND (c.event_id = p_event_id OR c.automation_trigger_event_id = p_event_id)
         AND ((g.scope_venue IS NOT NULL AND c.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND c.organizer_user_id = g.scope_org))
      UNION ALL
      SELECT 'push', coalesce(pc.scheduled_at, pc.created_at), pc.title, greatest(0, least(v_days, v_event.night - public.night_date(coalesce(pc.scheduled_at, pc.created_at), v_event.tz)))
        FROM public.push_campaigns pc
       WHERE pc.event_id = p_event_id AND pc.status IN ('sent', 'completed', 'done')
         AND ((g.scope_venue IS NOT NULL AND pc.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND pc.organizer_user_id = g.scope_org))
    ) m;

  RETURN jsonb_build_object(
    'ok', true, 'money', g.money,
    'event', jsonb_build_object('id', v_event.id, 'title', v_event.title, 'start_at', v_event.start_at, 'end_at', v_event.end_ts,
                                'tz', v_event.tz, 'night', v_event.night, 'cap', nullif(v_event.max_tickets, 0),
                                'status', CASE WHEN v_event.end_ts <= v_now THEN 'past' WHEN v_event.start_at - interval '6 hours' <= v_now THEN 'live' ELSE 'upcoming' END),
    'days', v_days, 'today_d', v_today_d,
    'compare', jsonb_build_object('mode', p_compare, 'n', cardinality(v_ref), 'comparable', v_comparable,
      'refs', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) ORDER BY e.start_at DESC), '[]'::jsonb)
                 FROM public.events e WHERE e.id = ANY(v_ref))),
    'curve', v_curve, 'reference', v_refs,
    'status', v_status, 'at_d', jsonb_build_object('tickets', v_cur_at_d, 'ref_tickets', v_ref_at_d, 'ref_final', v_ref_final),
    'forecast', v_forecast, 'markers', v_markers);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_promoters(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g       record;
  v_ids   uuid[];
  v_now   timestamptz := now();
  v_from  timestamptz;
  v_to    timestamptz;
  v_rows  jsonb;
  v_tot   jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- Fenêtre des clics : la période, ou pour une soirée les 60 jours avant sa fin.
  IF p_event_id IS NOT NULL THEN
    SELECT e.start_at - interval '60 days', coalesce(e.end_at, e.start_at + interval '8 hours') INTO v_from, v_to
      FROM public.events e WHERE e.id = p_event_id;
  ELSE
    v_to := coalesce(p_to, v_now); v_from := coalesce(p_from, v_to - interval '30 days');
  END IF;

  WITH firsts AS MATERIALIZED (
    SELECT DISTINCT p.email, p.first_event FROM public._an3_people(g.scope_ids, g.scope_venue) p
  ),
  ev AS (
    SELECT e.id, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts
      FROM public.events e WHERE e.id = ANY(v_ids)
  ),
  conv AS (
    SELECT pc.promoter_id, pc.id, pc.event_id, pc.status, coalesce(pc.amount, 0) AS amount, coalesce(pc.commission, 0) AS commission,
           CASE WHEN pc.ticket_id IS NOT NULL THEN greatest(coalesce(t.quantity, 1), 1) ELSE 0 END AS tickets,
           CASE WHEN pc.ticket_id IS NOT NULL THEN 'tickets' WHEN pc.table_reservation_id IS NOT NULL THEN 'tables'
                WHEN pc.guest_list_entry_id IS NOT NULL THEN 'guest_list' WHEN pc.order_id IS NOT NULL THEN 'drinks' ELSE 'other' END AS pillar,
           lower(trim(coalesce(t.user_email, r.user_email, gl.email))) AS email,
           CASE WHEN pc.ticket_id IS NOT NULL THEN (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used')
                WHEN pc.table_reservation_id IS NOT NULL THEN (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
                WHEN pc.guest_list_entry_id IS NOT NULL THEN coalesce(gl.entry_scanned, false)
                ELSE NULL END AS scanned,
           ev.end_ts <= v_now AS finished
      FROM public.promoter_conversions pc
      JOIN ev ON ev.id = pc.event_id
      LEFT JOIN public.tickets t ON t.id = pc.ticket_id
      LEFT JOIN public.table_reservations r ON r.id = pc.table_reservation_id
      LEFT JOIN public.guest_list_entries gl ON gl.id = pc.guest_list_entry_id
     WHERE pc.status IS DISTINCT FROM 'cancelled'
  ),
  -- Une soirée « scannée » = au moins une entrée à la porte : sans scan, absent ne veut pas dire pas venu.
  scanned_events AS (
    SELECT n.event_id FROM public._an3_nights(v_ids, g.scope_venue, g.money) n WHERE n.end_ts <= v_now AND n.entries > 0
  ),
  clicks AS (
    SELECT tl.promoter_id, count(*)::int AS clicks, count(DISTINCT coalesce(nullif(c.visitor_id, ''), c.ip_hash, c.id::text))::int AS visitors
      FROM public.tracked_link_clicks c JOIN public.tracked_links tl ON tl.id = c.tracked_link_id
     WHERE tl.promoter_id IS NOT NULL
       AND (tl.event_id = ANY(v_ids) OR (tl.event_id IS NULL AND c.clicked_at BETWEEN v_from AND v_to))
       AND ((g.scope_venue IS NOT NULL AND (tl.venue_id = g.scope_venue OR tl.event_id = ANY(v_ids)))
            OR (g.scope_org IS NOT NULL AND (tl.organizer_user_id = g.scope_org OR tl.event_id = ANY(v_ids))))
     GROUP BY tl.promoter_id
  ),
  per AS (
    SELECT pr.id, trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')) AS name, pr.promo_code, pr.is_active, pr.agency_id,
           coalesce(cl.clicks, 0) AS clicks, coalesce(cl.visitors, 0) AS visitors,
           count(cv.id)::int AS orders,
           coalesce(sum(cv.tickets), 0)::int AS tickets,
           count(cv.id) FILTER (WHERE cv.pillar = 'tables')::int AS tables,
           count(cv.id) FILTER (WHERE cv.pillar = 'guest_list')::int AS guest_list,
           round(sum(cv.amount), 2) AS attributed,
           round(sum(cv.commission) FILTER (WHERE cv.status IN ('pending', 'approved', 'disputed')), 2) AS commission_due,
           round(sum(cv.commission) FILTER (WHERE cv.status = 'paid'), 2) AS commission_paid,
           count(cv.id) FILTER (WHERE cv.scanned IS NOT NULL AND cv.event_id IN (SELECT event_id FROM scanned_events))::int AS judged,
           count(cv.id) FILTER (WHERE cv.scanned AND cv.event_id IN (SELECT event_id FROM scanned_events))::int AS present,
           count(DISTINCT cv.email) FILTER (WHERE cv.email IS NOT NULL)::int AS people,
           count(DISTINCT cv.email) FILTER (WHERE cv.email IS NOT NULL AND f.first_event = cv.event_id)::int AS new_people
      FROM public.promoters pr
      LEFT JOIN conv cv ON cv.promoter_id = pr.id
      LEFT JOIN firsts f ON f.email = cv.email
      LEFT JOIN clicks cl ON cl.promoter_id = pr.id
     WHERE ((g.scope_venue IS NOT NULL AND pr.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND pr.organizer_user_id = g.scope_org)
            OR cv.id IS NOT NULL)
     GROUP BY pr.id, pr.first_name, pr.last_name, pr.promo_code, pr.is_active, pr.agency_id, cl.clicks, cl.visitors
  )
  SELECT
    coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', per.id, 'name', nullif(per.name, ''), 'promo_code', per.promo_code, 'active', per.is_active, 'agency_id', per.agency_id,
      'clicks', per.clicks, 'visitors', per.visitors, 'orders', per.orders, 'tickets', per.tickets, 'tables', per.tables, 'guest_list', per.guest_list,
      'attributed', CASE WHEN g.money THEN per.attributed END,
      'conversion', CASE WHEN per.clicks >= 10 THEN round(100.0 * per.orders / per.clicks, 1) END,
      'attendance', CASE WHEN per.judged >= 5 THEN round(100.0 * per.present / per.judged, 1) END,
      'judged', per.judged, 'present', per.present,
      'new_share', CASE WHEN per.people >= 5 THEN round(100.0 * per.new_people / per.people, 1) END,
      'people', per.people, 'new_people', per.new_people,
      'commission_due', CASE WHEN g.money THEN per.commission_due END,
      'commission_paid', CASE WHEN g.money THEN per.commission_paid END
    ) ORDER BY coalesce(per.attributed, 0) DESC, per.orders DESC, per.clicks DESC)
      FROM per WHERE per.orders > 0 OR per.clicks > 0), '[]'::jsonb),
    jsonb_build_object(
      'promoters', (SELECT count(*) FROM per WHERE per.orders > 0 OR per.clicks > 0),
      'clicks', (SELECT coalesce(sum(clicks), 0) FROM per),
      'orders', (SELECT coalesce(sum(orders), 0) FROM per),
      'tickets', (SELECT coalesce(sum(tickets), 0) FROM per),
      'attributed', CASE WHEN g.money THEN (SELECT round(coalesce(sum(attributed), 0), 2) FROM per) END,
      'commission_due', CASE WHEN g.money THEN (SELECT round(coalesce(sum(commission_due), 0), 2) FROM per) END,
      'present', (SELECT coalesce(sum(present), 0) FROM per), 'judged', (SELECT coalesce(sum(judged), 0) FROM per))
    INTO v_rows, v_tot;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'nights', cardinality(v_ids), 'from', v_from, 'to', v_to,
                            'promoters', v_rows, 'totals', v_tot);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_rfm(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g record;
  v_rows jsonb;
  v_total int;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  -- Mêmes règles RFM que la page Clients (jamais recalculées ici), regroupées :
  --   champions → piliers · loyal → fidèles · promising (récent, peu fréquent, dépense haute)
  --   → gros dépensiers occasionnels · new → nouveaux prometteurs · at_risk → à risque
  --   · dormant + lost → perdus.
  WITH base AS (
    SELECT r.email, r.rfm_segment, coalesce(r.total_spent, 0) AS spent, coalesce(r.visit_nights, 0) AS nights, r.last_visit_at
      FROM public._venue_customer_rfm(g.scope_venue) r WHERE g.scope_venue IS NOT NULL
    UNION ALL
    SELECT r.email, r.rfm_segment, coalesce(r.total_spent, 0), coalesce(r.visit_nights, 0), r.last_visit_at
      FROM public.get_organizer_customer_segments(g.scope_org) r WHERE g.scope_org IS NOT NULL
  ),
  mapped AS (
    SELECT CASE b.rfm_segment
             WHEN 'champions' THEN 'pillars' WHEN 'loyal' THEN 'loyal' WHEN 'promising' THEN 'big_occasional'
             WHEN 'new' THEN 'new_promising' WHEN 'at_risk' THEN 'at_risk' ELSE 'lost' END AS seg,
           b.rfm_segment AS raw, b.spent, b.nights
      FROM base b
  )
  SELECT jsonb_agg(jsonb_build_object('segment', x.seg, 'n', x.n, 'revenue', CASE WHEN g.money THEN x.spent END, 'raw', x.raws) ORDER BY x.ord), coalesce(sum(x.n), 0)
    INTO v_rows, v_total
    FROM (
      SELECT s.seg, s.ord, coalesce(count(m.seg), 0)::int AS n, round(coalesce(sum(m.spent), 0), 2) AS spent,
             coalesce(array_agg(DISTINCT m.raw) FILTER (WHERE m.raw IS NOT NULL), '{}') AS raws
        FROM (VALUES ('pillars', 1), ('loyal', 2), ('big_occasional', 3), ('new_promising', 4), ('at_risk', 5), ('lost', 6)) s(seg, ord)
        LEFT JOIN mapped m ON m.seg = s.seg
       GROUP BY s.seg, s.ord) x;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'total', v_total, 'segments', coalesce(v_rows, '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_sales(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g        record;
  v_ids    uuid[];
  v_now    timestamptz := now();
  v_rounds jsonb;
  v_last   jsonb;
  v_lead   jsonb;
  v_heat   jsonb;
  v_small  jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- ── Paliers ───────────────────────────────────────────────────────────────
  WITH ev AS (
    SELECT e.id, e.published_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz) AS tz,
           public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz)) AS night,
           (g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)) AS show_money
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = ANY(v_ids)
  ),
  tx AS (
    SELECT t.id, t.event_id, t.ticket_round_id, coalesce(t.paid_at, t.created_at) AS at_ts,
           greatest(coalesce(t.quantity, 1), 1) AS units,
           CASE WHEN ev.show_money THEN greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) ELSE 0 END AS amount,
           sum(greatest(coalesce(t.quantity, 1), 1)) OVER (PARTITION BY t.ticket_round_id ORDER BY coalesce(t.paid_at, t.created_at), t.id) AS cum
      FROM public.tickets t JOIN ev ON ev.id = t.event_id
     WHERE t.status IN ('paid', 'used')
  ),
  per_round AS (
    SELECT tr.id, tr.event_id, tr.name, tr.price, coalesce(tr.position, 0) AS position, nullif(tr.max_tickets, 0) AS cap,
           tr.is_active, coalesce(tr.manually_sold_out, false) AS manual_sold_out,
           coalesce(sum(tx.units), 0)::int AS qty, round(coalesce(sum(tx.amount), 0), 2) AS amount,
           min(tx.at_ts) AS first_sale_at,
           min(tx.at_ts) FILTER (WHERE nullif(tr.max_tickets, 0) IS NOT NULL AND tx.cum >= tr.max_tickets) AS sold_out_at,
           ev.published_at AS opened_at
      FROM public.ticket_rounds tr JOIN ev ON ev.id = tr.event_id
      LEFT JOIN tx ON tx.ticket_round_id = tr.id
     GROUP BY tr.id, tr.event_id, tr.name, tr.price, tr.position, tr.max_tickets, tr.is_active, tr.manually_sold_out, ev.published_at
  )
  SELECT CASE WHEN p_event_id IS NOT NULL THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'price', r.price, 'qty', r.qty, 'revenue', CASE WHEN g.money THEN r.amount END, 'cap', r.cap,
        'sell_through', CASE WHEN r.cap > 0 THEN round(100.0 * r.qty / r.cap, 1) END,
        'status', CASE WHEN r.manual_sold_out OR (r.cap > 0 AND r.qty >= r.cap) THEN 'sold_out' WHEN r.is_active THEN 'on_sale' ELSE 'closed' END,
        'first_sale_at', r.first_sale_at, 'sold_out_at', r.sold_out_at, 'opened_at', r.opened_at,
        'hours_to_sell_out', CASE WHEN r.sold_out_at IS NOT NULL AND coalesce(r.opened_at, r.first_sale_at) IS NOT NULL
                                  THEN round(extract(epoch FROM (r.sold_out_at - coalesce(r.opened_at, r.first_sale_at))) / 3600.0, 1) END
      ) ORDER BY r.position, r.price) FROM per_round r), '[]'::jsonb)
  ELSE
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'name', x.name, 'price', x.price, 'qty', x.qty, 'revenue', CASE WHEN g.money THEN x.amount END, 'rounds', x.rounds,
        'sold_out_rounds', x.sold_out_rounds, 'sell_through', x.sell_through,
        'hours_to_sell_out', x.hours_med
      ) ORDER BY x.qty DESC)
      FROM (
        SELECT r.name, min(r.price) AS price, sum(r.qty)::int AS qty, round(sum(r.amount), 2) AS amount, count(*)::int AS rounds,
               count(*) FILTER (WHERE r.sold_out_at IS NOT NULL)::int AS sold_out_rounds,
               CASE WHEN sum(r.cap) FILTER (WHERE r.cap > 0) > 0 THEN round(100.0 * sum(r.qty) FILTER (WHERE r.cap > 0) / sum(r.cap) FILTER (WHERE r.cap > 0), 1) END AS sell_through,
               round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (r.sold_out_at - coalesce(r.opened_at, r.first_sale_at))) / 3600.0)
                 FILTER (WHERE r.sold_out_at IS NOT NULL AND coalesce(r.opened_at, r.first_sale_at) IS NOT NULL))::numeric, 1) AS hours_med
          FROM per_round r GROUP BY r.name) x), '[]'::jsonb)
  END INTO v_rounds;

  -- ── Last-minute, délai d'achat, heatmap ───────────────────────────────────
  WITH ev AS (
    SELECT e.id, e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz) AS tz,
           public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz)) AS night
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = ANY(v_ids)
  ),
  sales AS (
    SELECT p.event_id, p.at_ts, p.units, p.pillar, ev.tz,
           (ev.night - public.night_date(p.at_ts, ev.tz)) AS d,
           (ev.start_at - p.at_ts) AS before
      FROM public._an3_people(v_ids, g.scope_venue) p JOIN ev ON ev.id = p.event_id
     WHERE p.pillar IN ('tickets', 'tables')
  ),
  tickets_only AS (SELECT * FROM sales WHERE pillar = 'tickets')
  SELECT
    jsonb_build_object(
      'units', coalesce(sum(units), 0),
      'last_7d', coalesce(sum(units) FILTER (WHERE d <= 7), 0),
      'last_48h', coalesce(sum(units) FILTER (WHERE before <= interval '48 hours'), 0),
      'day_of', coalesce(sum(units) FILTER (WHERE d <= 0), 0)),
    jsonb_build_object(
      'median_days', percentile_disc(0.5) WITHIN GROUP (ORDER BY greatest(d, 0)),
      'buckets', jsonb_build_array(
        jsonb_build_object('key', 'd0', 'units', coalesce(sum(units) FILTER (WHERE d <= 0), 0)),
        jsonb_build_object('key', 'd1_2', 'units', coalesce(sum(units) FILTER (WHERE d BETWEEN 1 AND 2), 0)),
        jsonb_build_object('key', 'd3_6', 'units', coalesce(sum(units) FILTER (WHERE d BETWEEN 3 AND 6), 0)),
        jsonb_build_object('key', 'd7_13', 'units', coalesce(sum(units) FILTER (WHERE d BETWEEN 7 AND 13), 0)),
        jsonb_build_object('key', 'd14_29', 'units', coalesce(sum(units) FILTER (WHERE d BETWEEN 14 AND 29), 0)),
        jsonb_build_object('key', 'd30', 'units', coalesce(sum(units) FILTER (WHERE d >= 30), 0))))
    INTO v_last, v_lead
    FROM tickets_only;

  WITH ev AS (
    SELECT e.id, coalesce(nullif(e.timezone, ''), v.timezone, g.tz) AS tz
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = ANY(v_ids)
  ),
  cells AS (
    SELECT extract(isodow FROM (p.at_ts AT TIME ZONE ev.tz))::int AS w,
           extract(hour FROM (p.at_ts AT TIME ZONE ev.tz))::int AS h,
           sum(CASE WHEN p.pillar = 'tickets' THEN p.units ELSE 1 END)::int AS n
      FROM public._an3_people(v_ids, g.scope_venue) p JOIN ev ON ev.id = p.event_id
     WHERE p.pillar IN ('tickets', 'tables')
     GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'total', coalesce((SELECT sum(n) FROM cells), 0),
    'cells', coalesce((SELECT jsonb_agg(jsonb_build_object('w', w, 'h', h, 'n', n) ORDER BY w, h) FROM cells), '[]'::jsonb),
    'by_weekday', coalesce((SELECT jsonb_agg(jsonb_build_object('w', w, 'n', n) ORDER BY w) FROM (SELECT w, sum(n)::int AS n FROM cells GROUP BY w) x), '[]'::jsonb),
    'by_hour', coalesce((SELECT jsonb_agg(jsonb_build_object('h', h, 'n', n) ORDER BY h) FROM (SELECT h, sum(n)::int AS n FROM cells GROUP BY h) x), '[]'::jsonb))
    INTO v_heat;

  -- ── Petites courbes (période : les 12 dernières soirées) ──────────────────
  IF p_event_id IS NULL THEN
    WITH last12 AS (
      SELECT e.id, e.title, e.start_at, coalesce(e.max_tickets, 0) AS cap
        FROM public.events e WHERE e.id = ANY(v_ids) ORDER BY e.start_at DESC LIMIT 12
    ),
    curve AS (
      SELECT c.event_id, jsonb_agg(jsonb_build_object('d', c.d, 'tickets', c.tickets, 'revenue', c.revenue) ORDER BY c.d DESC) AS pts,
             max(c.tickets) AS final_tickets, max(c.revenue) AS final_revenue
        FROM public._an3_curve((SELECT array_agg(id) FROM last12), g.scope_venue, g.money, 14) c GROUP BY c.event_id
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'start_at', l.start_at, 'cap', nullif(l.cap, 0),
             'tickets', curve.final_tickets, 'revenue', CASE WHEN g.money THEN curve.final_revenue END, 'curve', curve.pts) ORDER BY l.start_at DESC), '[]'::jsonb)
      INTO v_small FROM last12 l LEFT JOIN curve ON curve.event_id = l.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'tz', g.tz, 'nights', cardinality(v_ids),
    'rounds', v_rounds, 'last_minute', v_last, 'lead_time', v_lead, 'heatmap', v_heat, 'small_multiples', v_small);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_sources(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g        record;
  v_ids    uuid[];
  v_now    timestamptz := now();
  v_from   timestamptz;
  v_to     timestamptz;
  v_funnel jsonb;
  v_rows   jsonb;
  v_yuno   jsonb;
  v_totals jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- Fenêtre des visites : la période, ou pour une soirée de sa publication (ou 60 j avant) à sa fin.
  IF p_event_id IS NOT NULL THEN
    SELECT coalesce(e.published_at, e.start_at - interval '60 days'), coalesce(e.end_at, e.start_at + interval '8 hours')
      INTO v_from, v_to FROM public.events e WHERE e.id = p_event_id;
  ELSE
    v_to := coalesce(p_to, v_now); v_from := coalesce(p_from, v_to - interval '30 days');
  END IF;

  -- ── Tunnel ────────────────────────────────────────────────────────────────
  WITH club_views AS (
    SELECT count(DISTINCT s.session_id)::int AS n
      FROM public.visitor_sessions s
     WHERE s.visited_at BETWEEN v_from AND v_to
       AND s.entry_page_type IN ('venue_page', 'organizer_profile')
       AND ((g.scope_venue IS NOT NULL AND s.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND s.organizer_user_id = g.scope_org))
  ),
  -- Les étapes du tunnel se comptent en SESSIONS du tunnel (même espace d'ids que
  -- les étapes suivantes) ; sans tunnel, on retombe sur les visites de la page.
  ev_views AS (
    SELECT greatest(
      (SELECT count(DISTINCT f.session_id) FROM public.event_funnel_events f WHERE f.event_id = ANY(v_ids) AND f.step = 'viewed'),
      (SELECT count(DISTINCT s.session_id) FROM public.visitor_sessions s WHERE s.event_id = ANY(v_ids)))::int AS n
  ),
  steps AS (
    SELECT f.step, count(DISTINCT f.session_id)::int AS n
      FROM public.event_funnel_events f WHERE f.event_id = ANY(v_ids) AND f.step IN ('selected', 'checkout', 'payment', 'purchased')
     GROUP BY f.step
  ),
  -- Payé et scanné se comptent en COMMANDES (billets, tables), comme les étapes d'avant.
  paid AS (
    SELECT (SELECT count(*) FROM public.tickets t WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used'))
         + (SELECT count(*) FROM public.table_reservations r WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')) AS n
  ),
  scanned AS (
    SELECT (SELECT count(*) FROM public.tickets t WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used')
              AND (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used'))
         + (SELECT count(*) FROM public.table_reservations r WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')
              AND (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)) AS n
  )
  SELECT jsonb_build_array(
    jsonb_build_object('step', 'club_page', 'n', (SELECT n FROM club_views)),
    jsonb_build_object('step', 'event_page', 'n', (SELECT n FROM ev_views)),
    jsonb_build_object('step', 'selected', 'n', coalesce((SELECT n FROM steps WHERE step = 'selected'), 0)),
    jsonb_build_object('step', 'checkout', 'n', coalesce((SELECT n FROM steps WHERE step = 'checkout'), 0)),
    jsonb_build_object('step', 'paid', 'n', (SELECT n FROM paid)),
    jsonb_build_object('step', 'scanned', 'n', (SELECT n FROM scanned)))
    INTO v_funnel;

  -- ── Par source : visites ET ventes nommées pareil ────────────────────────
  WITH visits AS (
    SELECT public.attribution_from_session(s.referrer_category, s.referrer_domain, s.utm_source, s.utm_medium) AS source,
           count(DISTINCT s.session_id)::int AS sessions,
           count(DISTINCT coalesce(nullif(s.visitor_id, ''), s.session_id))::int AS visitors
      FROM public.visitor_sessions s
     WHERE s.event_id = ANY(v_ids)
     GROUP BY 1
  ),
  sales AS (
    SELECT coalesce(x.source, 'direct') AS source, count(*)::int AS orders, count(DISTINCT x.email)::int AS buyers,
           round(sum(x.amount), 2) AS revenue, sum(x.units)::int AS tickets
      FROM (
        SELECT t.attribution_source AS source, lower(trim(t.user_email)) AS email, greatest(coalesce(t.quantity, 1), 1) AS units,
               CASE WHEN g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)
                    THEN greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                       - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) ELSE 0 END AS amount
          FROM public.tickets t JOIN public.events e ON e.id = t.event_id
         WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used')
        UNION ALL
        SELECT r.attribution_source, lower(trim(r.user_email)), 0,
               CASE WHEN g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)
                    THEN greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                       - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)) ELSE 0 END
          FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
         WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')
      ) x
     GROUP BY 1
  ),
  gl AS (
    SELECT coalesce(x.attribution_source, 'direct') AS source, count(*)::int AS signups
      FROM public.guest_list_entries x JOIN public.guest_lists l ON l.id = x.guest_list_id
     WHERE l.event_id = ANY(v_ids) AND x.status IS DISTINCT FROM 'cancelled'
     GROUP BY 1
  ),
  all_sources AS (
    SELECT source FROM visits UNION SELECT source FROM sales UNION SELECT source FROM gl
  )
  SELECT
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'source', a.source,
        'sessions', coalesce(v.sessions, 0), 'visitors', coalesce(v.visitors, 0),
        'orders', coalesce(s.orders, 0), 'buyers', coalesce(s.buyers, 0), 'tickets', coalesce(s.tickets, 0), 'signups', coalesce(gl.signups, 0),
        'revenue', CASE WHEN g.money THEN coalesce(s.revenue, 0) END,
        'conversion', CASE WHEN coalesce(v.visitors, 0) >= 10 THEN round(100.0 * coalesce(s.buyers, 0) / v.visitors, 1) END,
        'revenue_per_visitor', CASE WHEN g.money AND coalesce(v.visitors, 0) >= 10 THEN round(coalesce(s.revenue, 0) / v.visitors, 2) END
      ) ORDER BY coalesce(s.revenue, 0) DESC, coalesce(s.orders, 0) DESC, coalesce(v.sessions, 0) DESC)
      FROM all_sources a LEFT JOIN visits v ON v.source = a.source LEFT JOIN sales s ON s.source = a.source LEFT JOIN gl ON gl.source = a.source), '[]'::jsonb),
    jsonb_build_object(
      'sessions', (SELECT coalesce(sum(sessions), 0) FROM visits), 'visitors', (SELECT coalesce(sum(visitors), 0) FROM visits),
      'orders', (SELECT coalesce(sum(orders), 0) FROM sales), 'buyers', (SELECT coalesce(sum(buyers), 0) FROM sales),
      'revenue', CASE WHEN g.money THEN (SELECT round(coalesce(sum(revenue), 0), 2) FROM sales) END,
      'signups', (SELECT coalesce(sum(signups), 0) FROM gl))
    INTO v_rows, v_totals;

  -- ── Ce que Yuno t'a apporté : ventes venues de la marketplace, et nouveaux clients parmi elles ──
  WITH mk AS (
    SELECT lower(trim(t.user_email)) AS email, coalesce(t.paid_at, t.created_at) AS at_ts, t.event_id,
           CASE WHEN g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)
                THEN greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                   - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) ELSE 0 END AS amount
      FROM public.tickets t JOIN public.events e ON e.id = t.event_id
     WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used') AND t.attribution_source = 'marketplace'
    UNION ALL
    SELECT lower(trim(r.user_email)), coalesce(r.paid_at, r.created_at), r.event_id,
           CASE WHEN g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)
                THEN greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                   - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)) ELSE 0 END
      FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
     WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed') AND r.attribution_source = 'marketplace'
  ),
  firsts AS (
    SELECT DISTINCT p.email, p.first_event FROM public._an3_people(g.scope_ids, g.scope_venue) p WHERE p.email IN (SELECT email FROM mk)
  )
  SELECT jsonb_build_object(
    'orders', count(*), 'buyers', count(DISTINCT mk.email),
    'revenue', CASE WHEN g.money THEN round(coalesce(sum(mk.amount), 0), 2) END,
    'new_customers', count(DISTINCT mk.email) FILTER (WHERE f.first_event = mk.event_id),
    'visits', (SELECT coalesce(sum(1), 0) FROM public.visitor_sessions s WHERE s.event_id = ANY(v_ids) AND public.attribution_from_session(s.referrer_category, s.referrer_domain, s.utm_source, s.utm_medium) = 'marketplace'))
    INTO v_yuno
    FROM mk LEFT JOIN firsts f ON f.email = mk.email;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'nights', cardinality(v_ids), 'from', v_from, 'to', v_to,
    'funnel', v_funnel, 'sources', v_rows, 'totals', v_totals, 'yuno', v_yuno);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_campaign_ab_stats(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
  v_auth boolean := false;
  v_sent_a integer := 0;
  v_sent_b integer := 0;
  v_opens_a integer := 0;
  v_opens_b integer := 0;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF c.venue_id IS NOT NULL THEN
    v_auth := public.is_venue_owner(auth.uid(), c.venue_id) OR public.is_super_admin();
  ELSIF c.organizer_user_id IS NOT NULL THEN
    v_auth := COALESCE((c.organizer_user_id = auth.uid()) OR public.is_super_admin(), false);
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN v_auth := true; END IF;
  IF NOT COALESCE(v_auth, false) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF NOT c.ab_enabled OR COALESCE(c.subject_b, '') = '' THEN
    RETURN jsonb_build_object('supported', false);
  END IF;

  SELECT count(*) FILTER (WHERE ab_variant = 'a'),
         count(*) FILTER (WHERE ab_variant = 'b')
    INTO v_sent_a, v_sent_b
    FROM public.email_campaign_recipients
   WHERE campaign_id = p_campaign_id AND status = 'sent';

  SELECT count(DISTINCT lower(ev.recipient_email)) FILTER (WHERE r.ab_variant = 'a'),
         count(DISTINCT lower(ev.recipient_email)) FILTER (WHERE r.ab_variant = 'b')
    INTO v_opens_a, v_opens_b
    FROM public.email_campaign_events ev
    JOIN public.email_campaign_recipients r
      ON r.campaign_id = ev.campaign_id AND lower(r.email) = lower(ev.recipient_email)
   WHERE ev.campaign_id = p_campaign_id AND ev.event_type = 'opened';

  RETURN jsonb_build_object(
    'supported', true,
    'winner', c.ab_winner,
    'sent_a', v_sent_a, 'sent_b', v_sent_b,
    'opens_a', v_opens_a, 'opens_b', v_opens_b
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_campaign_followup_stats(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
  parent_id uuid;
  child RECORD;
  parent RECORD;
  v_skips jsonb;
  v_seen integer;
  v_queued integer;
  v_pending integer;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  IF c.venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), c.venue_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  ELSIF c.organizer_user_id IS NOT NULL THEN
    IF NOT COALESCE(c.organizer_user_id = auth.uid() OR public.is_super_admin(), false) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  ELSIF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  parent_id := COALESCE(c.parent_campaign_id, c.id);
  SELECT id, name, followup_enabled, followup_delay_hours, followup_campaign_id
    INTO parent FROM public.email_campaigns WHERE id = parent_id;
  IF NOT parent.followup_enabled AND parent.followup_campaign_id IS NULL THEN RETURN NULL; END IF;

  -- Un premier clic repéré = une ligne du registre, quelle que soit l'issue.
  SELECT count(*),
         count(*) FILTER (WHERE status = 'queued'),
         count(*) FILTER (WHERE status = 'queued' AND followup_campaign_id IS NULL)
    INTO v_seen, v_queued, v_pending
    FROM public.email_campaign_followups f WHERE f.parent_campaign_id = parent_id;
  SELECT COALESCE(jsonb_object_agg(skip_reason, n), '{}'::jsonb) INTO v_skips
    FROM (SELECT skip_reason, count(*) AS n FROM public.email_campaign_followups
           WHERE parent_campaign_id = parent_id AND status = 'skipped' GROUP BY skip_reason) s;

  SELECT id, name, status, recipients_count, delivered_count, opens_count,
         clicks_count, clickers_count, unsubscribes_count, bounced_count
    INTO child FROM public.email_campaigns WHERE id = parent.followup_campaign_id;

  RETURN jsonb_build_object(
    'parent_id', parent.id,
    'parent_name', parent.name,
    'is_child', c.parent_campaign_id IS NOT NULL,
    'enabled', COALESCE(parent.followup_enabled, false),
    'delay_hours', parent.followup_delay_hours,
    'clicks_seen', COALESCE(v_seen, 0),
    'queued', COALESCE(v_queued, 0),
    'pending', COALESCE(v_pending, 0),
    'skipped', v_skips,
    'child', CASE WHEN child.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', child.id, 'name', child.name, 'status', child.status,
      'sent', COALESCE(child.recipients_count, 0), 'delivered', COALESCE(child.delivered_count, 0),
      'opens', COALESCE(child.opens_count, 0), 'clicks', COALESCE(child.clicks_count, 0),
      'clickers', COALESCE(child.clickers_count, 0),
      'unsubscribes', COALESCE(child.unsubscribes_count, 0),
      'bounced', COALESCE(child.bounced_count, 0)
    ) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_campaign_resend_stats(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
  parent RECORD;
  child RECORD;
  parent_id uuid;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  PERFORM public._email_scope_guard(c.venue_id, c.organizer_user_id);

  parent_id := CASE WHEN c.child_kind = 'resend' THEN c.parent_campaign_id ELSE c.id END;
  SELECT id, name, resend_enabled, resend_delay_hours, resend_subject, resend_campaign_id, resend_done_at, status, sent_at
    INTO parent FROM public.email_campaigns WHERE id = parent_id;
  IF parent.id IS NULL THEN RETURN NULL; END IF;

  SELECT id, name, status, recipients_count, delivered_count, opens_count, clicks_count, clickers_count,
         unsubscribes_count, bounced_count
    INTO child FROM public.email_campaigns WHERE id = parent.resend_campaign_id;

  RETURN jsonb_build_object(
    'parent_id', parent.id,
    'parent_name', parent.name,
    'is_child', c.child_kind = 'resend',
    'enabled', parent.resend_enabled,
    'delay_hours', parent.resend_delay_hours,
    'subject', parent.resend_subject,
    'done_at', parent.resend_done_at,
    'parent_sent_at', parent.sent_at,
    'nobody', parent.resend_done_at IS NOT NULL AND parent.resend_campaign_id IS NULL,
    'child', CASE WHEN child.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', child.id, 'name', child.name, 'status', child.status,
      'sent', COALESCE(child.recipients_count, 0), 'delivered', COALESCE(child.delivered_count, 0),
      'opens', COALESCE(child.opens_count, 0), 'clicks', COALESCE(child.clicks_count, 0),
      'clickers', COALESCE(child.clickers_count, 0), 'unsubscribes', COALESCE(child.unsubscribes_count, 0),
      'bounced', COALESCE(child.bounced_count, 0)
    ) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_collab_party_breakdown(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_admin boolean := public.is_super_admin();
  v_mine  text[];
  v_money boolean;
  v_rows  jsonb;
  v_other jsonb;
  v_total jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT array_agg(p.party_key) INTO v_mine FROM public.event_parties(p_event_id) p
   WHERE public.coorg_party_level(v_uid, p.party_key) >= 1;
  IF v_mine IS NULL AND NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  v_money := v_admin OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_mine, '{}'::text[])) k
     WHERE public.coorg_party_level(v_uid, k) >= 3 AND public.coorg_sees_event_money(p_event_id, k));

  -- Une seule requête (fonction STABLE, et une session d'aperçu démo est en
  -- lecture seule : pas de table temporaire).
  WITH promo AS (
    SELECT pr.id,
           CASE WHEN pr.organizer_user_id IS NOT NULL THEN 'org:' || pr.organizer_user_id
                WHEN pr.venue_id IS NOT NULL THEN 'venue:' || pr.venue_id END AS pkey
      FROM public.promoters pr
  ),
  links AS (
    SELECT tl.id, COALESCE(tl.clicks_count, 0) AS clicks,
           COALESCE((SELECT pm.pkey FROM promo pm WHERE pm.id = tl.promoter_id),
                    CASE WHEN tl.organizer_user_id IS NOT NULL THEN 'org:' || tl.organizer_user_id
                         WHEN tl.venue_id IS NOT NULL THEN 'venue:' || tl.venue_id END) AS pkey
      FROM public.tracked_links tl
     WHERE tl.event_id = p_event_id
  ),
  sales (pkey, tickets, tables, table_guests, guests, entered, ca) AS (
    SELECT COALESCE(l.pkey,
             (SELECT pm.pkey FROM public.promoter_conversions c JOIN promo pm ON pm.id = c.promoter_id
               WHERE c.ticket_id = t.id AND pm.pkey IS NOT NULL LIMIT 1)),
           COALESCE(t.quantity, 1), 0, 0, 0,
           CASE WHEN COALESCE(t.entry_scanned, false) OR COALESCE(t.used, false) THEN COALESCE(t.quantity, 1) ELSE 0 END,
           greatest(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0),
                     greatest(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0))
      FROM public.tickets t
      LEFT JOIN links l ON l.id = t.tracked_link_id
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used', 'served')
    UNION ALL
    SELECT COALESCE(l.pkey,
             (SELECT pm.pkey FROM public.promoter_conversions c JOIN promo pm ON pm.id = c.promoter_id
               WHERE c.table_reservation_id = r.id AND pm.pkey IS NOT NULL LIMIT 1)),
           0, 1, COALESCE(r.guest_count, 0), 0,
           CASE WHEN COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL THEN greatest(COALESCE(r.guest_count, 1), 1) ELSE 0 END,
           greatest(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                    - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                              - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0))
      FROM public.table_reservations r
      LEFT JOIN links l ON l.id = r.tracked_link_id
     WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed', 'served')
    UNION ALL
    SELECT COALESCE(l.pkey,
             (SELECT pm.pkey FROM promo pm WHERE pm.id = g.promoter_id),
             (SELECT pm.pkey FROM promo pm WHERE pm.id = gl.promoter_id),
             CASE WHEN gl.organizer_user_id IS NOT NULL THEN 'org:' || gl.organizer_user_id
                  WHEN gl.venue_id IS NOT NULL THEN 'venue:' || gl.venue_id END),
           0, 0, 0, 1,
           CASE WHEN COALESCE(g.entry_scanned, false) OR g.status = 'entered' THEN 1 ELSE 0 END,
           0
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
      LEFT JOIN links l ON l.id = g.tracked_link_id
     WHERE gl.event_id = p_event_id AND g.status <> 'cancelled'
  ),
  parties AS (
    SELECT p.party_key, p.display_name, p.kind, p.role, p.avatar_url, p.ord
      FROM public.event_parties(p_event_id) p
  ),
  clicks AS (SELECT pkey, sum(clicks)::int AS clicks FROM links GROUP BY pkey),
  agg AS (
    SELECT pkey, sum(tickets)::int AS tickets, sum(tables)::int AS tables, sum(table_guests)::int AS table_guests,
           sum(guests)::int AS guests, sum(entered)::int AS entered, round(sum(ca), 2) AS ca
      FROM sales GROUP BY pkey
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'party', p.party_key, 'name', p.display_name, 'kind', p.kind, 'role', p.role, 'avatar_url', p.avatar_url,
              'mine', p.party_key = ANY (COALESCE(v_mine, '{}'::text[])),
              'clicks', COALESCE(c.clicks, 0),
              'tickets', COALESCE(a.tickets, 0), 'tables', COALESCE(a.tables, 0),
              'table_guests', COALESCE(a.table_guests, 0), 'guests', COALESCE(a.guests, 0),
              'entered', COALESCE(a.entered, 0),
              'revenue', CASE WHEN v_money THEN COALESCE(a.ca, 0) END
            ) ORDER BY p.ord, p.party_key), '[]'::jsonb)
       FROM parties p
       LEFT JOIN agg a ON a.pkey = p.party_key
       LEFT JOIN clicks c ON c.pkey = p.party_key),
    (SELECT jsonb_build_object(
              'tickets', COALESCE(sum(s.tickets), 0)::int, 'tables', COALESCE(sum(s.tables), 0)::int,
              'table_guests', COALESCE(sum(s.table_guests), 0)::int, 'guests', COALESCE(sum(s.guests), 0)::int,
              'entered', COALESCE(sum(s.entered), 0)::int,
              'revenue', CASE WHEN v_money THEN round(COALESCE(sum(s.ca), 0), 2) END)
       FROM sales s
      WHERE s.pkey IS NULL OR NOT EXISTS (SELECT 1 FROM parties p WHERE p.party_key = s.pkey)),
    (SELECT jsonb_build_object(
              'tickets', COALESCE(sum(s.tickets), 0)::int, 'tables', COALESCE(sum(s.tables), 0)::int,
              'table_guests', COALESCE(sum(s.table_guests), 0)::int, 'guests', COALESCE(sum(s.guests), 0)::int,
              'entered', COALESCE(sum(s.entered), 0)::int,
              'revenue', CASE WHEN v_money THEN round(COALESCE(sum(s.ca), 0), 2) END)
       FROM sales s)
    INTO v_rows, v_other, v_total;

  RETURN jsonb_build_object('ok', true, 'money', v_money, 'parties', v_rows, 'unattributed', v_other, 'totals', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_community_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_venue  text;
  v_org    uuid;
  v_tz     text := 'Europe/Paris';
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_org := p_organizer_user_id;
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_venue := p_venue_id;
    select coalesce(v.timezone, 'Europe/Paris') into v_tz from public.venues v where v.id = p_venue_id;
    v_tz := coalesce(v_tz, 'Europe/Paris');
  end if;

  with
  c as materialized (
    select cr.email, cr.event_count, cr.last_purchase_at, cr.added_at, cr.origin,
           cr.subscribed, cr.bounced, cr.unsubscribed_at
    from public.contact_rows(v_venue, v_org) cr
  ),
  f as materialized (
    select x.user_id, min(x.created_at) as created_at
    from (
      select fv.user_id, fv.created_at
      from public.favorites fv
      where v_venue is not null and fv.favorite_type = 'club' and fv.venue_id = v_venue
      union all
      select opf.user_id, opf.created_at
      from public.organizer_profile_followers opf
      where v_org is not null and opf.organizer_user_id = v_org
    ) x
    where x.user_id is not null
    group by x.user_id
  ),
  ev as materialized (
    select e.id, e.title, e.start_at
    from public.events e
    where ((v_venue is not null and (e.venue_id = v_venue or e.partner_venue_id = v_venue or e.id in (select public.cohost_event_ids_venue(v_venue))))
        or (v_org is not null and (e.organizer_user_id = v_org or e.partner_organizer_id = v_org or e.id in (select public.cohost_event_ids_org(v_org)))))
  ),
  -- Qui est venu à quelle soirée (mêmes sources que contact_scope_customers).
  act as materialized (
    select distinct x.em, x.event_id
    from (
      select lower(btrim(t.user_email)) as em, t.event_id
      from public.tickets t join ev on ev.id = t.event_id
      where t.user_email is not null and btrim(t.user_email) <> '' and t.paid_at is not null
      union all
      select lower(btrim(r.user_email)), r.event_id
      from public.table_reservations r join ev on ev.id = r.event_id
      where r.user_email is not null and btrim(r.user_email) <> ''
        and (r.paid_at is not null or r.status in ('paid', 'confirmed'))
      union all
      select lower(btrim(g.email)), gl.event_id
      from public.guest_list_entries g
      join public.guest_lists gl on gl.id = g.guest_list_id
      join ev on ev.id = gl.event_id
      where g.email is not null and btrim(g.email) <> '' and g.status <> 'cancelled'
    ) x
  ),
  first_ev as materialized (
    select a.em, (array_agg(a.event_id order by e.start_at, a.event_id))[1] as event_id
    from act a join ev e on e.id = a.event_id
    group by a.em
  ),
  recent as (
    select e.id, e.title, e.start_at
    from ev e
    join public.events full_e on full_e.id = e.id
    where e.start_at <= v_now and full_e.cancelled_at is null
      -- Une date récurrente sans aucun public n'apprend rien : la liste montre
      -- les 10 dernières soirées qui ont eu du monde.
      and exists (select 1 from act a where a.event_id = e.id)
    order by e.start_at desc
    limit 10
  ),
  months as (
    select generate_series(
      date_trunc('month', v_now at time zone v_tz) - interval '23 months',
      date_trunc('month', v_now at time zone v_tz),
      interval '1 month'
    ) as m
  )
  select jsonb_build_object(
    'ok', true,
    'now', v_now,
    'totals', jsonb_build_object(
      'contacts', (select count(*) from c),
      'emailReachable', (select count(*) from c
                         where c.email is not null and c.subscribed and not c.bounced and c.unsubscribed_at is null),
      'yunoCustomers', (select count(*) from c where c.origin in ('yuno', 'both')),
      'imported', (select count(*) from c where c.origin in ('import', 'both')),
      'followers', (select count(*) from f),
      'pushReachable', (select count(*) from f
                        where exists (select 1 from public.push_subscriptions ps
                                      where ps.user_id = f.user_id and ps.platform = 'ios')),
      'newFollowers30d', (select count(*) from f where f.created_at >= v_now - interval '30 days'),
      'newContacts30d', (select count(*) from c where c.added_at >= v_now - interval '30 days')
    ),
    'participation', jsonb_build_object(
      'known', (select count(*) from c where c.event_count is not null),
      'avg', (select round(avg(c.event_count)::numeric, 2) from c where c.event_count is not null),
      'buckets', (
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(n.n, 0)) order by b.ord)
        from (values ('0', 0), ('1', 1), ('2', 2), ('3', 3), ('4+', 4)) as b(bucket, ord)
        left join (
          select case when c.event_count >= 4 then '4+' else c.event_count::text end as bucket, count(*) as n
          from c where c.event_count is not null and c.event_count >= 0
          group by 1
        ) n on n.bucket = b.bucket
      )
    ),
    'lastPurchase', jsonb_build_object(
      'known', (select count(*) from c where c.last_purchase_at is not null),
      'buckets', (
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(n.n, 0)) order by b.ord)
        from (values ('lt3', 0), ('3to6', 1), ('6to12', 2), ('12to24', 3), ('gt24', 4)) as b(bucket, ord)
        left join (
          select case
                   when c.last_purchase_at >= v_now - interval '3 months' then 'lt3'
                   when c.last_purchase_at >= v_now - interval '6 months' then '3to6'
                   when c.last_purchase_at >= v_now - interval '12 months' then '6to12'
                   when c.last_purchase_at >= v_now - interval '24 months' then '12to24'
                   else 'gt24'
                 end as bucket,
                 count(*) as n
          from c where c.last_purchase_at is not null
          group by 1
        ) n on n.bucket = b.bucket
      )
    ),
    'growth', jsonb_build_object(
      'known', (select count(*) from c where c.added_at is not null),
      'series', (
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(mo.m, 'YYYY-MM'),
                 'contacts', (select count(*) from c
                              where c.added_at is not null
                                and (c.added_at at time zone v_tz) < mo.m + interval '1 month'),
                 'followers', (select count(*) from f
                               where (f.created_at at time zone v_tz) < mo.m + interval '1 month')
               ) order by mo.m)
        from months mo
      )
    ),
    'byEvent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'title', r.title,
               'startAt', r.start_at,
               'participants', (select count(*) from act a where a.event_id = r.id),
               'newContacts', (select count(*) from first_ev fe where fe.event_id = r.id)
             ) order by r.start_at desc)
      from recent r
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_community_tastes(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_venue     text;
  v_org       uuid;
  v_threshold integer := 10;
  v_result    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_org := p_organizer_user_id;
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_venue := p_venue_id;
  end if;

  with
  ev as materialized (
    select e.id
    from public.events e
    where ((v_venue is not null and (e.venue_id = v_venue or e.partner_venue_id = v_venue or e.id in (select public.cohost_event_ids_venue(v_venue))))
        or (v_org is not null and (e.organizer_user_id = v_org or e.partner_organizer_id = v_org or e.id in (select public.cohost_event_ids_org(v_org)))))
  ),
  people as materialized (
    select distinct x.user_id
    from (
      select t.user_id from public.tickets t join ev on ev.id = t.event_id
      where t.user_id is not null and t.status in ('paid', 'used')
      union all
      select r.user_id from public.table_reservations r join ev on ev.id = r.event_id
      where r.user_id is not null and r.status in ('paid', 'confirmed')
      union all
      select g.user_id from public.guest_list_entries g
      join public.guest_lists gl on gl.id = g.guest_list_id
      join ev on ev.id = gl.event_id
      where g.user_id is not null and g.status <> 'cancelled'
      union all
      select fv.user_id from public.favorites fv
      where v_venue is not null and fv.favorite_type = 'club' and fv.venue_id = v_venue
      union all
      select opf.user_id from public.organizer_profile_followers opf
      where v_org is not null and opf.organizer_user_id = v_org
    ) x
    join public.profiles p on p.id = x.user_id
    where not coalesce(p.personalization_opt_out, false)
  ),
  declared as (
    select distinct utp.user_id, g.genre
    from public.user_taste_profiles utp
    join people pp on pp.user_id = utp.user_id
    cross join lateral unnest(public.canonical_music_genres(coalesce(utp.genres, '{}'::text[]))) as g(genre)
  ),
  -- Où la personne est allée sur TOUT Yuno (le « réseau ») depuis 18 mois.
  went as materialized (
    select distinct y.user_id, y.event_id
    from (
      select t.user_id, t.event_id from public.tickets t
      join people pp on pp.user_id = t.user_id
      where t.status in ('paid', 'used') and coalesce(t.paid_at, t.created_at) > now() - interval '18 months'
      union all
      select r.user_id, r.event_id from public.table_reservations r
      join people pp on pp.user_id = r.user_id
      where r.status in ('paid', 'confirmed') and coalesce(r.paid_at, r.created_at) > now() - interval '18 months'
      union all
      select g.user_id, gl.event_id from public.guest_list_entries g
      join public.guest_lists gl on gl.id = g.guest_list_id
      join people pp on pp.user_id = g.user_id
      where g.status <> 'cancelled' and g.created_at > now() - interval '18 months'
    ) y
  ),
  attended as (
    select distinct w.user_id, g.genre
    from went w
    join public.events e on e.id = w.event_id and e.cancelled_at is null
    cross join lateral unnest(public.canonical_music_genres(coalesce(e.music_genres, '{}'::text[]))) as g(genre)
  ),
  person_genre as (
    select z.user_id, z.genre, bool_or(z.src = 'd') as is_declared, bool_or(z.src = 'a') as is_attended
    from (
      select d.user_id, d.genre, 'd'::text as src from declared d
      union all
      select a.user_id, a.genre, 'a'::text from attended a
    ) z
    where z.genre is not null and btrim(z.genre) <> ''
    group by 1, 2
  ),
  per_genre as (
    select pg.genre,
           count(*) as n,
           count(*) filter (where pg.is_declared) as n_declared,
           count(*) filter (where pg.is_attended) as n_attended
    from person_genre pg
    group by pg.genre
  )
  select jsonb_build_object(
    'ok', true,
    'threshold', v_threshold,
    'people', (select count(*) from people),
    'known', (select count(distinct pg.user_id) from person_genre pg),
    'declaredKnown', (select count(distinct d.user_id) from declared d),
    'genres', coalesce((
      select jsonb_agg(jsonb_build_object(
               'genre', g.genre,
               'n', g.n,
               'declared', case when g.n_declared >= v_threshold then g.n_declared end,
               'attended', case when g.n_attended >= v_threshold then g.n_attended end
             ) order by g.n desc, g.genre)
      from per_genre g
      where g.n >= v_threshold
    ), '[]'::jsonb),
    'hidden', (select count(*) from per_genre g where g.n < v_threshold)
  )
  into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_crm_night_report(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND (public.crm_scope_sees_money(e.venue_id, NULL) OR public.crm_scope_sees_money(NULL, e.organizer_user_id))) THEN public.get_crm_night_report__core(p_event_id) ELSE public._crm_null_money(public.get_crm_night_report__core(p_event_id)) END;
$function$;

CREATE OR REPLACE FUNCTION public.get_crm_night_report__core(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e public.events%ROWTYPE;
  v_tz text;
  v_prev uuid;
  v_totals jsonb;
  v_curve jsonb;
  v_prev_curve jsonb;
  v_prev_info jsonb;
  v_deals jsonb;
  v_audience jsonb;
  v_campaigns jsonb;
  v_utm jsonb;
  v_ext jsonb;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR e.external_source IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.crm_scope_allowed(e.venue_id, e.organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tz := COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris');

  SELECT jsonb_build_object('left_tickets', ee.left_tickets, 'deals_offered', jsonb_array_length(COALESCE(ee.deals, '[]'::jsonb)),
                            'launched_at', ee.launched_at, 'published_at', ee.published_at, 'artists', ee.artists, 'genres', ee.genres)
    INTO v_ext FROM public.external_events ee WHERE ee.event_id = e.id LIMIT 1;

  -- Totaux. Nouveaux = première soirée de la personne dans la portée.
  WITH mine AS (
    SELECT t.* FROM public.external_tickets t WHERE t.event_id = e.id
  ), scope_first AS (
    SELECT lower(t.buyer_email) AS em, min(COALESCE(t.purchased_at, t.first_seen_at)) AS first_at
      FROM public.external_tickets t
     WHERE t.buyer_email IS NOT NULL AND t.status IN ('valid', 'transferred')
       AND ((e.venue_id IS NOT NULL AND t.venue_id = e.venue_id)
         OR (e.organizer_user_id IS NOT NULL AND t.organizer_user_id = e.organizer_user_id))
       AND lower(t.buyer_email) IN (SELECT lower(m.buyer_email) FROM mine m WHERE m.buyer_email IS NOT NULL)
     GROUP BY lower(t.buyer_email)
  ), my_buyers AS (
    SELECT lower(m.buyer_email) AS em, min(COALESCE(m.purchased_at, m.first_seen_at)) AS at
      FROM mine m WHERE m.buyer_email IS NOT NULL AND m.status IN ('valid', 'transferred')
     GROUP BY lower(m.buyer_email)
  )
  SELECT jsonb_build_object(
    'tickets', (SELECT COALESCE(sum(GREATEST(quantity, 1)), 0) FROM mine WHERE status IN ('valid', 'transferred')),
    'revenue', (SELECT COALESCE(round(sum(COALESCE(price, 0) * GREATEST(quantity, 1)), 2), 0) FROM mine WHERE status IN ('valid', 'transferred')),
    'fees', (SELECT COALESCE(round(sum(COALESCE(fees, 0) * GREATEST(quantity, 1)), 2), 0) FROM mine WHERE status IN ('valid', 'transferred')),
    'buyers', (SELECT count(*) FROM my_buyers),
    'new_buyers', (SELECT count(*) FROM my_buyers b JOIN scope_first f ON f.em = b.em WHERE f.first_at >= b.at),
    'scanned', (SELECT count(*) FROM mine WHERE scanned_at IS NOT NULL),
    'scan_known', (SELECT bool_or(scanned_at IS NOT NULL) FROM mine),
    'refunded', (SELECT count(*) FROM mine WHERE status IN ('refunded', 'cancelled')),
    'with_email', (SELECT count(*) FROM mine WHERE buyer_email IS NOT NULL),
    'all_tickets', (SELECT count(*) FROM mine),
    'optin_buyers', (SELECT count(DISTINCT lower(buyer_email)) FROM mine WHERE newsletter_optin IS TRUE AND status IN ('valid', 'transferred'))
  ) INTO v_totals;

  -- Courbe J-N : billets vendus par jour calendaire avant la soirée (fuseau de la soirée).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'tickets', n) ORDER BY d DESC), '[]'::jsonb) INTO v_curve FROM (
    SELECT GREATEST(((e.start_at AT TIME ZONE v_tz)::date - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::date), 0) AS d,
           sum(GREATEST(t.quantity, 1)) AS n
      FROM public.external_tickets t
     WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')
     GROUP BY 1
  ) c;

  -- Soirée de comparaison : la précédente de la portée (billetterie connectée).
  SELECT p.id INTO v_prev FROM public.events p
   WHERE p.external_source IS NOT NULL AND p.id <> e.id AND p.start_at < e.start_at AND p.cancelled_at IS NULL
     AND ((e.venue_id IS NOT NULL AND p.venue_id = e.venue_id)
       OR (e.organizer_user_id IS NOT NULL AND p.organizer_user_id = e.organizer_user_id))
     AND EXISTS (SELECT 1 FROM public.external_tickets t WHERE t.event_id = p.id)
   ORDER BY p.start_at DESC LIMIT 1;
  IF v_prev IS NOT NULL THEN
    SELECT jsonb_build_object('event_id', p.id, 'title', p.title, 'start_at', p.start_at,
             'tickets', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t WHERE t.event_id = p.id AND t.status IN ('valid', 'transferred')),
             'revenue', (SELECT COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0) FROM public.external_tickets t WHERE t.event_id = p.id AND t.status IN ('valid', 'transferred')))
      INTO v_prev_info FROM public.events p WHERE p.id = v_prev;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'tickets', n) ORDER BY d DESC), '[]'::jsonb) INTO v_prev_curve FROM (
      SELECT GREATEST(((p.start_at AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'Europe/Paris'))::date
                     - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'Europe/Paris'))::date), 0) AS d,
             sum(GREATEST(t.quantity, 1)) AS n
        FROM public.external_tickets t JOIN public.events p ON p.id = t.event_id
       WHERE t.event_id = v_prev AND t.status IN ('valid', 'transferred')
       GROUP BY 1
    ) c;
  END IF;

  -- Tarifs.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'tickets')::int DESC), '[]'::jsonb) INTO v_deals FROM (
    SELECT jsonb_build_object('name', COALESCE(t.deal_name, '—'),
             'tickets', sum(GREATEST(t.quantity, 1)),
             'revenue', round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2)) AS x
      FROM public.external_tickets t
     WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')
     GROUP BY COALESCE(t.deal_name, '—')
  ) q;

  -- Public (ce que la billetterie a transmis ; la couverture est rendue).
  SELECT jsonb_build_object(
    'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'n', n) ORDER BY n DESC) FROM (
                SELECT initcap(lower(t.city)) AS city, count(DISTINCT lower(COALESCE(t.buyer_email, t.external_id))) AS n
                  FROM public.external_tickets t
                 WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND NULLIF(btrim(t.city), '') IS NOT NULL
                 GROUP BY 1 ORDER BY 2 DESC LIMIT 6) c), '[]'::jsonb),
    'ages', COALESCE((SELECT jsonb_agg(jsonb_build_object('band', band, 'n', n) ORDER BY band) FROM (
                SELECT CASE WHEN t.age < 21 THEN '18-20' WHEN t.age < 25 THEN '21-24' WHEN t.age < 30 THEN '25-29'
                            WHEN t.age < 35 THEN '30-34' ELSE '35+' END AS band, count(*) AS n
                  FROM public.external_tickets t
                 WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.age IS NOT NULL
                 GROUP BY 1) a), '[]'::jsonb),
    'genders', COALESCE((SELECT jsonb_object_agg(g, n) FROM (
                SELECT t.gender AS g, count(*) AS n FROM public.external_tickets t
                 WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.gender IS NOT NULL
                 GROUP BY 1) g), '{}'::jsonb),
    'with_city', (SELECT count(*) FROM public.external_tickets t WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND NULLIF(btrim(t.city), '') IS NOT NULL),
    'with_age', (SELECT count(*) FROM public.external_tickets t WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.age IS NOT NULL)
  ) INTO v_audience;

  -- Emails de la soirée et ventes attribuées (1er clic → achat de CETTE soirée < 72 h).
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sent_at' DESC NULLS LAST), '[]'::jsonb) INTO v_campaigns FROM (
    SELECT jsonb_build_object(
             'campaign_id', c.id, 'name', c.name, 'subject', c.subject, 'sent_at', c.sent_at, 'status', c.status,
             'automation', c.automation_id IS NOT NULL,
             'recipients', COALESCE(c.total_recipients, c.recipients_count, 0),
             'opens', COALESCE(c.opens_count, 0), 'clicks', COALESCE(c.clicks_count, 0),
             'attributed_tickets', COALESCE(att.tickets, 0), 'attributed_revenue', COALESCE(att.revenue, 0)
           ) AS x
      FROM public.email_campaigns c
      LEFT JOIN LATERAL (
        SELECT sum(GREATEST(t.quantity, 1)) AS tickets, round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2) AS revenue
          FROM (SELECT lower(ce.recipient_email) AS em, min(ce.created_at) AS click_at
                  FROM public.email_campaign_events ce
                 WHERE ce.campaign_id = c.id AND ce.event_type = 'clicked' AND ce.recipient_email IS NOT NULL
                 GROUP BY 1) k
          JOIN public.external_tickets t ON t.event_id = e.id AND lower(t.buyer_email) = k.em
               AND t.status IN ('valid', 'transferred')
               AND COALESCE(t.purchased_at, t.first_seen_at) >= k.click_at
               AND COALESCE(t.purchased_at, t.first_seen_at) < k.click_at + interval '72 hours'
      ) att ON true
     WHERE (c.event_id = e.id OR c.automation_trigger_event_id = e.id)
       AND c.status IN ('sent', 'sending', 'completed')
  ) q;

  -- Sources UTM rapportées par la billetterie.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'tickets')::int DESC), '[]'::jsonb) INTO v_utm FROM (
    SELECT jsonb_build_object('source', COALESCE(t.utm->>'utm_source', '—'), 'medium', t.utm->>'utm_medium',
             'tickets', sum(GREATEST(t.quantity, 1)),
             'revenue', round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2)) AS x
      FROM public.external_tickets t
     WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.utm IS NOT NULL
     GROUP BY COALESCE(t.utm->>'utm_source', '—'), t.utm->>'utm_medium'
     ORDER BY sum(GREATEST(t.quantity, 1)) DESC LIMIT 8
  ) q;

  RETURN jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
                                'timezone', v_tz, 'cover_url', COALESCE(e.poster_url, e.image_url),
                                'url', e.external_ticket_url, 'cancelled', e.cancelled_at IS NOT NULL,
                                'sold_out', e.tickets_sold_out, 'location_city', e.location_city,
                                'entry_target', e.entry_target, 'external', v_ext),
    'totals', v_totals, 'curve', v_curve,
    'compare', CASE WHEN v_prev IS NULL THEN NULL ELSE jsonb_build_object('event', v_prev_info, 'curve', v_prev_curve) END,
    'deals', v_deals, 'audience', v_audience, 'campaigns', v_campaigns, 'utm', v_utm
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_crm_nights(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._crm_money_gate(public.get_crm_nights__core(p_venue_id, p_organizer_user_id, p_limit, p_offset), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_crm_nights__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_total integer;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.events e
   WHERE e.external_source IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  WITH ev AS (
    SELECT e.* FROM public.events e
     WHERE e.external_source IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     ORDER BY e.start_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
  ), firsts AS (
    -- Première soirée de chaque acheteur dans la portée (billetterie connectée).
    SELECT DISTINCT ON (lower(t.buyer_email)) lower(t.buyer_email) AS em, t.event_id
      FROM public.external_tickets t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.buyer_email IS NOT NULL AND t.status IN ('valid', 'transferred') AND t.event_id IS NOT NULL
     ORDER BY lower(t.buyer_email), COALESCE(t.purchased_at, t.first_seen_at)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'event_id', ev.id, 'title', ev.title, 'start_at', ev.start_at, 'end_at', ev.end_at,
           'cover_url', COALESCE(ev.poster_url, ev.image_url), 'url', ev.external_ticket_url,
           'cancelled', ev.cancelled_at IS NOT NULL, 'sold_out', ev.tickets_sold_out,
           'upcoming', ev.end_at > now(),
           'tickets', st.tickets, 'revenue', st.revenue, 'buyers', st.buyers,
           'new_buyers', (SELECT count(*) FROM firsts f WHERE f.event_id = ev.id),
           'scanned', st.scanned, 'refunded', st.refunded,
           'first_sale_at', st.first_sale_at
         ) ORDER BY ev.start_at DESC), '[]'::jsonb) INTO v
    FROM ev
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(GREATEST(t.quantity, 1)) FILTER (WHERE t.status IN ('valid', 'transferred')), 0) AS tickets,
             COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)) FILTER (WHERE t.status IN ('valid', 'transferred')), 2), 0) AS revenue,
             count(DISTINCT lower(t.buyer_email)) FILTER (WHERE t.status IN ('valid', 'transferred')) AS buyers,
             count(*) FILTER (WHERE t.scanned_at IS NOT NULL) AS scanned,
             count(*) FILTER (WHERE t.status IN ('refunded', 'cancelled')) AS refunded,
             min(COALESCE(t.purchased_at, t.first_seen_at)) AS first_sale_at
        FROM public.external_tickets t WHERE t.event_id = ev.id
    ) st ON true;

  RETURN jsonb_build_object('total', v_total, 'nights', v);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_crm_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._crm_money_gate(public.get_crm_overview__core(p_venue_id, p_organizer_user_id), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_crm_overview__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conn jsonb;
  v_base jsonb;
  v_sales jsonb;
  v_upcoming jsonb;
  v_recent jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('provider', c.provider, 'status', c.status, 'external_org_name', c.external_org_name,
                            'last_ok_at', c.last_ok_at, 'initial_import_done_at', c.initial_import_done_at,
                            'running', c.locked_until IS NOT NULL AND c.locked_until > now(), 'stats', c.stats)
    INTO v_conn
    FROM public.ticketing_connections c
   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
   ORDER BY c.created_at LIMIT 1;

  WITH subs AS (
    SELECT lower(s.email) AS em, bool_or(s.opted_in AND s.opted_out_at IS NULL) AS ok,
           bool_or(COALESCE(s.source, '') LIKE 'connector:%') AS from_ticketing
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     GROUP BY lower(s.email)
  ), buyers AS (
    SELECT DISTINCT lower(t.buyer_email) AS em
      FROM public.external_tickets t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.buyer_email IS NOT NULL AND t.status IN ('valid', 'transferred')
  )
  SELECT jsonb_build_object(
           'contacts', (SELECT count(*) FROM (SELECT em FROM subs UNION SELECT em FROM buyers) u),
           'reachable', (SELECT count(*) FROM subs WHERE ok AND NOT public.is_email_suppressed(em)),
           'reachable_from_ticketing', (SELECT count(*) FROM subs WHERE ok AND from_ticketing),
           'buyers', (SELECT count(*) FROM buyers)
         ) INTO v_base;

  SELECT jsonb_build_object(
           'tickets', COALESCE(sum(GREATEST(t.quantity, 1)), 0),
           'revenue', COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0),
           'buyers', count(DISTINCT lower(t.buyer_email)),
           'nights', count(DISTINCT t.event_id)
         ) INTO v_sales
    FROM public.external_tickets t
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND t.status IN ('valid', 'transferred')
     AND COALESCE(t.purchased_at, t.first_seen_at) > now() - interval '90 days';

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'start_at'), '[]'::jsonb) INTO v_upcoming FROM (
    SELECT jsonb_build_object(
             'event_id', e.id, 'title', e.title, 'start_at', e.start_at,
             'cover_url', COALESCE(e.poster_url, e.image_url), 'url', e.external_ticket_url,
             'sold_out', e.tickets_sold_out, 'cancelled', e.cancelled_at IS NOT NULL,
             'tickets', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
                          WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')),
             'tickets_today', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
                          WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')
                            AND COALESCE(t.purchased_at, t.first_seen_at) >= date_trunc('day', now() AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')),
             'revenue', (SELECT COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0) FROM public.external_tickets t
                          WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred'))
           ) AS x
      FROM public.events e
     WHERE e.external_source IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.end_at > now()
     ORDER BY e.start_at ASC
     LIMIT 5
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'start_at' DESC), '[]'::jsonb) INTO v_recent FROM (
    SELECT jsonb_build_object(
             'event_id', e.id, 'title', e.title, 'start_at', e.start_at,
             'cover_url', COALESCE(e.poster_url, e.image_url),
             'tickets', COALESCE(sum(GREATEST(t.quantity, 1)) FILTER (WHERE t.status IN ('valid', 'transferred')), 0),
             'buyers', count(DISTINCT lower(t.buyer_email)) FILTER (WHERE t.status IN ('valid', 'transferred')),
             'scanned', count(*) FILTER (WHERE t.scanned_at IS NOT NULL),
             'revenue', COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)) FILTER (WHERE t.status IN ('valid', 'transferred')), 2), 0)
           ) AS x
      FROM public.events e
      LEFT JOIN public.external_tickets t ON t.event_id = e.id
     WHERE e.external_source IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.end_at <= now()
     GROUP BY e.id
     ORDER BY e.start_at DESC
     LIMIT 5
  ) q;

  RETURN jsonb_build_object('connection', v_conn, 'base', v_base, 'sales_90d', v_sales,
                            'upcoming', v_upcoming, 'recent', v_recent);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_automation_emails(p_venue_id text, p_organizer_user_id uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);
  IF p_email IS NULL OR position('@' in p_email) <= 1 THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb) INTO result
    FROM (
      SELECT l.kind, l.status, l.skip_reason, l.created_at, l.due_at, l.campaign_id,
             e.title AS event_title,
             r.sent_at,
             (r.sent_at IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.email_campaign_events ev
                WHERE ev.campaign_id = l.campaign_id AND lower(ev.recipient_email) = lower(l.email) AND ev.event_type = 'opened')) AS opened,
             (r.sent_at IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.email_campaign_events ev
                WHERE ev.campaign_id = l.campaign_id AND lower(ev.recipient_email) = lower(l.email) AND ev.event_type = 'clicked')) AS clicked
        FROM public.email_automation_sends l
        LEFT JOIN public.events e ON e.id = COALESCE(l.trigger_event_id, l.bind_event_id)
        LEFT JOIN public.email_campaign_recipients r
          ON r.campaign_id = l.campaign_id AND lower(r.email) = lower(l.email)
       WHERE lower(l.email) = lower(p_email)
         AND ((p_venue_id IS NOT NULL AND l.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND l.organizer_user_id = p_organizer_user_id))
       ORDER BY l.created_at DESC
       LIMIT 50
    ) x;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_automation_stats(p_venue_id text, p_organizer_user_id uuid, p_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_from timestamptz := CASE WHEN p_days IS NULL THEN '-infinity'::timestamptz ELSE now() - make_interval(days => p_days) END;
  v_all boolean := p_days IS NULL;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.kind), '[]'::jsonb) INTO result
    FROM (
      SELECT a.id, a.kind, a.enabled, a.enabled_at, a.delay_hours, a.threshold_pct, a.template_id, a.subject,
             (SELECT count(*) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL) AS pending,
             -- En attente d'envoi dans une campagne enfant (file, quota, nuit).
             (SELECT count(*) FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c ON c.id = r.campaign_id
               WHERE c.automation_id = a.id AND r.status = 'pending') AS in_flight,
             (SELECT count(*) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued' AND l.created_at >= v_from) AS queued,
             (SELECT COALESCE(jsonb_object_agg(x.skip_reason, x.n), '{}'::jsonb)
                FROM (SELECT l.skip_reason, count(*) AS n FROM public.email_automation_sends l
                       WHERE l.automation_id = a.id AND l.status = 'skipped' AND l.created_at >= v_from
                       GROUP BY l.skip_reason) x) AS skipped,
             (SELECT max(l.created_at) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued') AS last_queued_at,
             (SELECT count(*) FROM public.email_campaigns c
               WHERE c.automation_id = a.id
                 AND (v_all OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                        WHERE r.campaign_id = c.id AND r.status = 'sent' AND r.sent_at >= v_from))) AS campaigns,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.recipients_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id = r.campaign_id
                         WHERE c.automation_id = a.id AND r.status = 'sent' AND r.sent_at >= v_from) END AS sent,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.delivered_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'delivered' AND ev.created_at >= v_from) END AS delivered,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.opens_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'opened' AND ev.created_at >= v_from) END AS opens,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.clickers_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(DISTINCT lower(ev.recipient_email)) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'clicked' AND ev.created_at >= v_from) END AS clickers,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.unsubscribes_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'unsubscribed' AND ev.created_at >= v_from) END AS unsubscribes,
             (SELECT COALESCE(jsonb_agg(c.id), '[]'::jsonb) FROM public.email_campaigns c
               WHERE c.automation_id = a.id
                 AND (v_all OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                        WHERE r.campaign_id = c.id AND r.status = 'sent' AND r.sent_at >= v_from))) AS campaign_ids
        FROM public.email_automations a
       WHERE (p_venue_id IS NOT NULL AND a.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND a.organizer_user_id = p_organizer_user_id)
          OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL AND a.venue_id IS NULL AND a.organizer_user_id IS NULL)
    ) s;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_automation_suggestions(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);
  RETURN public._email_automation_suggestions(p_venue_id, p_organizer_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_campaign_attribution(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  IF p_subject_type NOT IN ('venue', 'organizer') THEN
    RETURN jsonb_build_object('ok', true, 'supported', false);
  END IF;

  WITH scoped_events AS (
    SELECT e.id FROM public.events e
     WHERE CASE WHEN p_subject_type = 'venue'
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id OR e.id in (select public.cohost_event_ids_venue(p_subject_id)))
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id OR e.id in (select public.cohost_event_ids_subject(p_subject_id)))
           END
  ),
  -- 1er clic par (campagne, email) sur les campagnes email du sujet (90 j)
  clicks AS (
    SELECT ece.campaign_id, lower(ece.recipient_email) AS em, min(ece.created_at) AS click_at
      FROM public.email_campaign_events ece
      JOIN public.email_campaigns ec ON ec.id = ece.campaign_id
     WHERE ece.event_type = 'clicked'
       AND ece.recipient_email IS NOT NULL
       AND ec.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN ec.venue_id = p_subject_id
                ELSE ec.organizer_user_id::text = p_subject_id
           END
     GROUP BY ece.campaign_id, lower(ece.recipient_email)
  ),
  -- Actions du sujet avec NET (fees.ts), matchées par email. `units` = ce que
  -- le pilier compte vraiment : billets vendus, convives attablés, 1 inscrit.
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, 'ticket'::text AS kind,
           lower(t.user_email) AS em, t.created_at,
           (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS net,
           GREATEST(coalesce(t.quantity, 1), 1)::int AS units
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
       AND t.created_at >= now() - interval '90 days'
    UNION ALL
    SELECT 'table:' || r.id::text, 'table', lower(r.user_email), r.created_at,
           (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))),
           GREATEST(coalesce(r.guest_count, 0), 0)::int
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
       AND r.created_at >= now() - interval '90 days'
    UNION ALL
    -- Boissons : périmètre venue = tout le bar du club ; périmètre organizer =
    -- les commandes rattachées à ses soirées.
    SELECT 'order:' || o.id::text, 'order', lower(o.user_email), o.created_at,
           (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))),
           0
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND o.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events)
           END
    UNION ALL
    -- Liste invités : zéro euro, mais c'est une entrée gagnée. Sur une soirée
    -- sans billetterie c'est la SEULE chose que l'email peut produire — la
    -- taire revenait à afficher « 0 € » sur une campagne qui a rempli la porte.
    SELECT 'guestlist:' || gle.id::text, 'guestlist', lower(gle.email), gle.created_at,
           0::numeric, 1
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM scoped_events)
       AND gle.status <> 'cancelled'
       AND gle.email IS NOT NULL AND btrim(gle.email) <> ''
       AND gle.created_at >= now() - interval '90 days'
    UNION ALL
    -- Yuno CRM : achat sur la billetterie connectée (valeur faciale, hors frais).
    SELECT 'external:' || xt.id::text, 'ticket', lower(xt.buyer_email), COALESCE(xt.purchased_at, xt.first_seen_at),
           (COALESCE(xt.price, 0) * GREATEST(xt.quantity, 1))::numeric, GREATEST(xt.quantity, 1)
      FROM public.external_tickets xt
     WHERE xt.event_id IN (SELECT id FROM scoped_events) AND xt.status IN ('valid', 'transferred') AND xt.buyer_email IS NOT NULL
       AND COALESCE(xt.purchased_at, xt.first_seen_at) >= now() - interval '90 days'
  ),
  attributed AS (
    SELECT c.campaign_id, s.sale_key, s.kind, s.em, s.net, s.units
      FROM clicks c
      JOIN sales s
        ON s.em = c.em
       AND s.created_at >= c.click_at
       AND s.created_at <  c.click_at + interval '72 hours'
  ),
  per_campaign AS (
    SELECT campaign_id,
           round(sum(net)::numeric, 2)                                   AS revenue,
           count(DISTINCT em) FILTER (WHERE kind <> 'guestlist')         AS buyers,
           count(*)           FILTER (WHERE kind = 'ticket')             AS ticket_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'ticket'), 0)        AS ticket_units,
           round(coalesce(sum(net) FILTER (WHERE kind = 'ticket'), 0)::numeric, 2)    AS ticket_revenue,
           count(*)           FILTER (WHERE kind = 'table')              AS table_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'table'), 0)         AS table_guests,
           round(coalesce(sum(net) FILTER (WHERE kind = 'table'), 0)::numeric, 2)     AS table_revenue,
           count(*)           FILTER (WHERE kind = 'guestlist')          AS gl_entries,
           count(DISTINCT em) FILTER (WHERE kind = 'guestlist')          AS gl_people,
           count(*)           FILTER (WHERE kind = 'order')              AS drink_orders,
           round(coalesce(sum(net) FILTER (WHERE kind = 'order'), 0)::numeric, 2)     AS drink_revenue
      FROM attributed
     GROUP BY campaign_id
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', campaign_id,
        'revenue', revenue,
        'buyers', buyers,
        'tickets',   jsonb_build_object('orders', ticket_orders, 'units', ticket_units, 'revenue', ticket_revenue),
        'tables',    jsonb_build_object('orders', table_orders,  'guests', table_guests, 'revenue', table_revenue),
        'guestlist', jsonb_build_object('entries', gl_entries,   'people', gl_people),
        'drinks',    jsonb_build_object('orders', drink_orders,  'revenue', drink_revenue)
      ))
      FROM per_campaign
    ), '[]'::jsonb),
    'total_90d', COALESCE((
      SELECT round(sum(net)::numeric, 2)
      FROM (SELECT DISTINCT sale_key, net FROM attributed) d
    ), 0)
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_lists_health(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_email_lists_health: une seule portée à la fois';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT COALESCE(p_organizer_user_id = auth.uid() OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin') OR public.is_super_admin(), false) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH imports AS (
    SELECT i.id, i.filename, i.list_name, i.created_at
      FROM public.email_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.superseded_by IS NULL
     ORDER BY i.created_at DESC
     LIMIT 50
  ),
  subs AS (
    SELECT s.import_id,
           count(*) AS total,
           count(*) FILTER (WHERE s.opted_in AND s.opted_out_at IS NULL AND NOT public.is_email_suppressed(s.email)) AS active,
           count(*) FILTER (WHERE public.is_email_suppressed(s.email)) AS dead,
           count(*) FILTER (WHERE NOT public.is_email_suppressed(s.email) AND (NOT s.opted_in OR s.opted_out_at IS NOT NULL)) AS unsubscribed
      FROM public.newsletter_subscriptions s
     WHERE s.import_id IN (SELECT id FROM imports)
     GROUP BY s.import_id
  ),
  purged AS (
    SELECT o.import_id, count(*) AS n
      FROM public.email_opt_outs o
     WHERE o.import_id IN (SELECT id FROM imports)
     GROUP BY o.import_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'import_id', i.id,
           'filename', i.filename,
           'list_name', i.list_name,
           'created_at', i.created_at,
           'total', COALESCE(s.total, 0),
           'active', COALESCE(s.active, 0),
           'unsubscribed', COALESCE(s.unsubscribed, 0),
           'dead', COALESCE(s.dead, 0),
           'purged', COALESCE(p.n, 0)
         ) ORDER BY i.created_at DESC), '[]'::jsonb)
    INTO v_out
    FROM imports i
    LEFT JOIN subs s ON s.import_id = i.id
    LEFT JOIN purged p ON p.import_id = i.id;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_send_time_insights(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);

  WITH opens AS (
    SELECT extract(hour from (ev.created_at AT TIME ZONE 'Europe/Paris'))::integer AS h,
           extract(isodow from (ev.created_at AT TIME ZONE 'Europe/Paris'))::integer AS d
      FROM public.email_campaign_events ev
      JOIN public.email_campaigns c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'opened'
       AND ev.created_at > now() - interval '120 days'
       AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
  ),
  by_hour AS (
    SELECT g.h, count(o.h) AS n FROM generate_series(0, 23) AS g(h) LEFT JOIN opens o ON o.h = g.h GROUP BY g.h
  ),
  by_dow AS (
    SELECT g.d, count(o.d) AS n FROM generate_series(1, 7) AS g(d) LEFT JOIN opens o ON o.d = g.d GROUP BY g.d
  ),
  windows AS (
    -- Fenêtre glissante de 2 h : l'heure h compte ses ouvertures et celles de h+1.
    SELECT a.h, a.n + b.n AS n
      FROM by_hour a JOIN by_hour b ON b.h = (a.h + 1) % 24
  ),
  totals AS (SELECT count(*) AS sample FROM opens)
  SELECT jsonb_build_object(
    'sample', t.sample,
    'by_hour', (SELECT jsonb_agg(n ORDER BY h) FROM by_hour),
    'by_dow', (SELECT jsonb_agg(n ORDER BY d) FROM by_dow),
    'best_hour', CASE WHEN t.sample >= 30 THEN (SELECT h FROM windows ORDER BY n DESC, h ASC LIMIT 1) END,
    'best_dow', CASE WHEN t.sample >= 30 THEN (SELECT d FROM by_dow ORDER BY n DESC, d ASC LIMIT 1) END
  ) INTO result
  FROM totals t;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_lineup_live(p_event_ids uuid[])
 RETURNS TABLE(event_id uuid, artists jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id,
         CASE WHEN e.external_source IS NOT NULL THEN
           -- Soirée d'une billetterie connectée : ses artistes, dans son ordre.
           COALESCE((
             SELECT jsonb_agg(a.j ORDER BY a.ord)
               FROM (
                 SELECT t.ord,
                        jsonb_build_object(
                          'name', left(btrim(t.a->>'name'), 120),
                          'photo', CASE WHEN t.a->>'avatar' ~ '^https://[^\s"<>]+$' THEN left(t.a->>'avatar', 1000) END) AS j
                   FROM public.external_events ee,
                        jsonb_array_elements(CASE WHEN jsonb_typeof(ee.artists) = 'array' THEN ee.artists ELSE '[]'::jsonb END)
                          WITH ORDINALITY AS t(a, ord)
                  WHERE ee.event_id = e.id
                    AND NULLIF(btrim(t.a->>'name'), '') IS NOT NULL
                  ORDER BY t.ord
                  LIMIT 24
               ) a
           ), '[]'::jsonb)
         ELSE
           -- Soirée Yuno : les DJ du line-up, puis les artistes invités.
           COALESCE((
             SELECT jsonb_agg(u.j ORDER BY u.grp, u.pos, u.at)
               FROM (SELECT * FROM (
                 SELECT 0 AS grp, 0 AS pos, ed.created_at AS at,
                        jsonb_build_object(
                          'name', left(btrim(d.stage_name), 120),
                          'photo', CASE WHEN d.profile_image_url ~ '^https://[^\s"<>]+$' THEN d.profile_image_url END) AS j
                   FROM public.event_djs ed
                   JOIN public.djs_public d ON d.id = ed.dj_id
                  WHERE ed.event_id = e.id
                    AND NULLIF(btrim(d.stage_name), '') IS NOT NULL
                 UNION ALL
                 SELECT 1, COALESCE(g.position, 0), g.created_at,
                        jsonb_build_object(
                          'name', left(btrim(g.name), 120),
                          'photo', CASE WHEN g.photo_url ~ '^https://[^\s"<>]+$' THEN g.photo_url END)
                   FROM public.event_guest_artists g
                  WHERE g.event_id = e.id
                    AND NULLIF(btrim(g.name), '') IS NOT NULL
               ) v ORDER BY v.grp, v.pos, v.at LIMIT 24) u
           ), '[]'::jsonb)
         END
    FROM public.events e
   WHERE e.id = ANY (p_event_ids)
     AND (COALESCE(auth.role(), '') = 'service_role'
          OR public.is_super_admin()
          OR (auth.uid() IS NOT NULL AND public.can_manage_event_design(auth.uid(), e.id)));
$function$;

CREATE OR REPLACE FUNCTION public.get_event_report(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid        uuid := auth.uid();
  v_now        timestamptz := now();
  e            record;
  v_tz         text;
  v_day_start  timestamptz;
  v_scope_venue text := null;
  v_scope_org  uuid := null;
  v_money      boolean := false;
  v_scope_ids  uuid[];
  v_result     jsonb;
  v_take       jsonb := '[]'::jsonb;
  v_tx_total   integer;
  v_expected   integer;
  v_entered    integer;
  v_heads_d0   integer;
  v_heads      integer;
  v_row        record;
  v_ref        record;
  v_ref_d      integer;
  v_ref_final  integer;
  v_ref_at     integer;
  v_pace       jsonb := null;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select ev.*, coalesce(ev.timezone, v.timezone, 'Europe/Paris') as tz, v.name as venue_name
    into e
  from public.events ev
  left join public.venues v on v.id = coalesce(ev.venue_id, ev.partner_venue_id)
  where ev.id = p_event_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── Portée + droit de voir l'argent ───────────────────────────────────
  if e.venue_id is not null and (public.can_manage_venue(v_uid, e.venue_id) or public.is_super_admin()) then
    v_scope_venue := e.venue_id;
  elsif e.partner_venue_id is not null and public.can_manage_venue(v_uid, e.partner_venue_id) then
    v_scope_venue := e.partner_venue_id;
  elsif e.organizer_user_id is not null and (
          v_uid = e.organizer_user_id
          or public.is_super_admin()
          or public.is_org_team_member(v_uid, e.organizer_user_id, 'editor')) then
    v_scope_org := e.organizer_user_id;
  elsif e.partner_organizer_id is not null and (
          v_uid = e.partner_organizer_id
          or public.is_org_team_member(v_uid, e.partner_organizer_id, 'editor')) then
    v_scope_org := e.partner_organizer_id;
  -- Co-hôte accepté : la soirée se lit dans SA portée (orga d'abord).
  elsif exists (select 1 from public.event_cohosts c
                 where c.event_id = p_event_id and c.status = 'accepted' and c.organizer_user_id is not null
                   and (c.organizer_user_id = v_uid or public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))) then
    select c.organizer_user_id into v_scope_org from public.event_cohosts c
     where c.event_id = p_event_id and c.status = 'accepted' and c.organizer_user_id is not null
       and (c.organizer_user_id = v_uid or public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))
     order by (c.organizer_user_id = v_uid) desc limit 1;
  elsif exists (select 1 from public.event_cohosts c
                 where c.event_id = p_event_id and c.status = 'accepted' and c.venue_id is not null
                   and public.can_manage_venue(v_uid, c.venue_id)) then
    select c.venue_id into v_scope_venue from public.event_cohosts c
     where c.event_id = p_event_id and c.status = 'accepted' and c.venue_id is not null
       and public.can_manage_venue(v_uid, c.venue_id)
     limit 1;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_scope_venue is not null then
    -- Club hôte, ou club CO-HÔTE quand l'organisateur principal partage les
    -- montants (« Tout », défaut) ; jamais un club qui ne fait qu'accueillir.
    v_money := (coalesce(v_scope_venue = e.venue_id, false)
                or public.coorg_cohost_sees_money(p_event_id, 'venue:' || v_scope_venue)) and (
      public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = v_scope_venue and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = v_scope_venue
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      ));
    select coalesce(array_agg(x.id), '{}') into v_scope_ids
    from public.events x
    where x.venue_id = v_scope_venue or x.partner_venue_id = v_scope_venue or x.id in (select public.cohost_event_ids_venue(v_scope_venue));
  else
    v_money := (v_uid = v_scope_org
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, v_scope_org, 'view_finance'))
      -- Un co-hôte voit l'argent si l'organisateur principal le partage (défaut)
      -- ou s'il a une part dans un accord actif (coorg_sees_event_money).
      and (public.is_super_admin() or public.coorg_sees_event_money(p_event_id, 'org:' || v_scope_org::text));
    select coalesce(array_agg(x.id), '{}') into v_scope_ids
    from public.events x
    where x.organizer_user_id = v_scope_org or x.partner_organizer_id = v_scope_org or x.id in (select public.cohost_event_ids_org(v_scope_org));
  end if;

  v_tz := e.tz;
  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;

  with
  -- ── Les ventes de la soirée, une ligne par transaction ────────────────
  tx as materialized (
    select 'tickets'::text as pillar, t.id, lower(t.user_email) as email, t.user_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           greatest(coalesce(t.quantity, 1), 1) as units,
           greatest(coalesce(t.quantity, 1), 1) as heads,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount,
           coalesce(nullif(t.purchase_source, ''), 'direct') as source,
           t.tracked_link_id, t.ticket_round_id as line_id
    from public.tickets t
    where t.event_id = p_event_id and t.status in ('paid', 'used')
    union all
    select 'tables', r.id, lower(r.user_email), r.user_id,
           coalesce(r.paid_at, r.created_at),
           1,
           greatest(coalesce(r.guest_count, 0), 1),
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)),
           coalesce(nullif(r.purchase_source, ''), 'direct'),
           r.tracked_link_id, r.pack_id
    from public.table_reservations r
    where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
    union all
    select 'drinks', o.id, lower(o.user_email), o.user_id,
           coalesce(o.paid_at, o.created_at),
           1,
           0,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)),
           coalesce(nullif(o.purchase_source, ''), 'direct'),
           o.tracked_link_id, null::uuid
    from public.orders o
    where o.event_id = p_event_id and o.status in ('paid', 'served')
      and v_scope_venue is not null and o.venue_id = v_scope_venue
  ),
  gle as materialized (
    select g.id, lower(nullif(btrim(g.email), '')) as email, g.user_id, g.created_at as at_ts,
           g.guest_list_id as line_id, g.tracked_link_id
    from public.guest_list_entries g
    join public.guest_lists gl on gl.id = g.guest_list_id
    where gl.event_id = p_event_id and g.status <> 'cancelled'
  ),
  vis as materialized (
    select s.visited_at, coalesce(nullif(s.referrer_category, ''), 'direct') as source,
           coalesce(s.completed_order, false) as done
    from public.visitor_sessions s
    where s.event_id = p_event_id
  ),

  -- ── Contacts de la soirée, et ceux déjà vus à une soirée PRÉCÉDENTE ────
  people as (
    select distinct email from (
      select email from tx where pillar in ('tickets', 'tables') and email is not null
      union all
      select email from gle where email is not null
    ) p
  ),
  prior_events as materialized (
    select x.id from public.events x
    where x.id = any(v_scope_ids) and x.id <> p_event_id and x.start_at < e.start_at
  ),
  seen_before as (
    select distinct p.email
    from people p
    where exists (select 1 from public.tickets t
                  where t.event_id in (select id from prior_events)
                    and t.status in ('paid', 'used') and lower(t.user_email) = p.email)
       or exists (select 1 from public.table_reservations r
                  where r.event_id in (select id from prior_events)
                    and r.status in ('paid', 'confirmed') and lower(r.user_email) = p.email)
       or exists (select 1 from public.guest_list_entries g
                  join public.guest_lists gl on gl.id = g.guest_list_id
                  where gl.event_id in (select id from prior_events)
                    and g.status <> 'cancelled' and lower(g.email) = p.email)
  ),

  -- ── Série jour par jour, clé d = jours calendaires avant la soirée ─────
  day_rows as (
    select (e.start_at at time zone v_tz)::date - (at_ts at time zone v_tz)::date as d,
           case when pillar = 'tickets' then units else 0 end as tickets,
           case when pillar = 'tables' then 1 else 0 end as tables,
           0 as guests, amount, 0 as visits,
           heads as people
    from tx
    union all
    select (e.start_at at time zone v_tz)::date - (at_ts at time zone v_tz)::date, 0, 0, 1, 0, 0, 1 from gle
    union all
    select (e.start_at at time zone v_tz)::date - (visited_at at time zone v_tz)::date, 0, 0, 0, 0, 1, 0 from vis
  ),
  series as (
    select d, sum(tickets) as tickets, sum(tables) as tables, sum(guests) as guests,
           sum(amount) as amount, sum(visits) as visits, sum(people) as people
    from day_rows group by d
  ),

  -- ── Messages qui parlaient de CETTE soirée ────────────────────────────
  emails as (
    select ec.id, coalesce(nullif(ec.subject, ''), ec.name) as title, ec.sent_at,
           coalesce(ec.recipients_count, ec.total_recipients, 0) as reach,
           coalesce(ec.opens_count, 0) as opens, coalesce(ec.clickers_count, ec.clicks_count, 0) as clicks,
           ec.automation_id is not null as auto
    from public.email_campaigns ec
    where (ec.event_id = p_event_id or ec.automation_trigger_event_id = p_event_id)
      and ec.status in ('sent', 'sending', 'paused')
      and ((v_scope_venue is not null and ec.venue_id = v_scope_venue)
        or (v_scope_org is not null and ec.organizer_user_id = v_scope_org))
    order by ec.sent_at desc nulls last
    limit 30
  ),
  email_clicks as (
    select ece.campaign_id, lower(ece.recipient_email) as email, min(ece.created_at) as click_at
    from public.email_campaign_events ece
    where ece.campaign_id in (select id from emails)
      and ece.event_type = 'clicked' and ece.recipient_email is not null
    group by 1, 2
  ),
  email_attr as (
    select c.campaign_id,
           count(distinct x.id) filter (where x.pillar <> 'guestlist') as orders,
           coalesce(sum(x.amount), 0) as amount,
           count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
    from email_clicks c
    join (
      select pillar, id, email, at_ts, amount from tx where pillar in ('tickets', 'tables')
      union all
      select 'guestlist', id, email, at_ts, 0 from gle
    ) x on x.email = c.email and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
    group by c.campaign_id
  ),
  pushes as (
    select pc.id, coalesce(pc.title, pc.template_key) as title, pc.created_at as sent_at,
           coalesce(pc.sent_count, 0) as reach, pc.source = 'auto' as auto, pc.template_key
    from public.push_campaigns pc
    where pc.event_id = p_event_id
      and pc.status in ('sent', 'sending', 'completed')
      and ((v_scope_venue is not null and pc.venue_id = v_scope_venue)
        or (v_scope_org is not null and pc.venue_id is null and pc.agency_id is null))
    order by pc.created_at desc
    limit 30
  ),
  push_clicks as (
    select pce.campaign_id, pce.user_id, min(pce.created_at) as click_at
    from public.push_campaign_events pce
    where pce.campaign_id in (select id from pushes)
      and pce.event_type = 'clicked' and pce.user_id is not null
    group by 1, 2
  ),
  push_attr as (
    select c.campaign_id,
           count(*) as clicks,
           count(distinct x.id) filter (where x.pillar <> 'guestlist') as orders,
           coalesce(sum(x.amount), 0) as amount,
           count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
    from push_clicks c
    left join (
      select pillar, id, user_id, at_ts, amount from tx where pillar in ('tickets', 'tables')
      union all
      select 'guestlist', id, user_id, at_ts, 0 from gle
    ) x on x.user_id = c.user_id and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
    group by c.campaign_id
  )

  select jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'dayStart', v_day_start,
    'money', v_money,
    'scope', case when v_scope_venue is not null then 'venue' else 'organizer' end,
    'event', jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', e.end_at,
      'poster', coalesce(e.poster_url, e.image_url), 'status', e.status,
      'cancelled', e.cancelled_at is not null,
      'publishedAt', e.published_at, 'createdAt', e.created_at,
      'venueName', e.venue_name,
      'entryTarget', e.entry_target,
      'phase', case when v_now >= e.end_at then 'after' when v_now >= e.start_at then 'live' else 'before' end
    ),

    -- 1. Où en sont mes ventes ?
    'totals', jsonb_build_object(
      'tickets', jsonb_build_object(
        'sold', (select coalesce(sum(units), 0) from tx where pillar = 'tickets'),
        'today', (select coalesce(sum(units), 0) from tx where pillar = 'tickets' and at_ts >= v_day_start),
        'orders', (select count(*) from tx where pillar = 'tickets'),
        'capacity', case
          when coalesce(e.max_tickets, 0) > 0 then e.max_tickets
          when exists (select 1 from public.ticket_rounds tr where tr.event_id = p_event_id)
           and not exists (select 1 from public.ticket_rounds tr where tr.event_id = p_event_id and coalesce(tr.max_tickets, 0) <= 0)
            then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = p_event_id)
          else null end,
        'enabled', coalesce(e.ticketing_enabled, false),
        'soldOut', coalesce(e.tickets_sold_out, false)
      ),
      'tables', jsonb_build_object(
        'booked', (select count(*) from tx where pillar = 'tables'),
        'today', (select count(*) from tx where pillar = 'tables' and at_ts >= v_day_start),
        'guests', (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 0)), 0)
                   from public.table_reservations r where r.event_id = p_event_id and r.status in ('paid', 'confirmed')),
        'capacity', nullif((
          select coalesce(sum(p.tables_count), 0)
          from public.table_packs p
          where p.is_active
            and (p.event_id = p_event_id
                 or (p.event_id is null and coalesce(e.venue_id, e.partner_venue_id) is not null
                     and p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
            and not (p.id = any (coalesce(e.sold_out_pack_ids, '{}'::uuid[])))
        ), 0),
        'enabled', coalesce(e.tables_enabled, false),
        'soldOut', coalesce(e.tables_sold_out, false)
      ),
      'guestList', jsonb_build_object(
        'registered', (select count(*) from gle),
        'today', (select count(*) from gle where at_ts >= v_day_start),
        'capacity', (
          select case when count(*) > 0 and count(*) filter (where coalesce(gl.quota, 0) <= 0) = 0
                      then sum(gl.quota) else null end
          from public.guest_lists gl where gl.event_id = p_event_id and gl.is_active
        ),
        'enabled', exists (select 1 from public.guest_lists gl where gl.event_id = p_event_id and gl.is_active),
        'soldOut', coalesce(e.guest_list_sold_out, false)
      ),
      'drinks', case when v_scope_venue is not null then jsonb_build_object(
        'orders', (select count(*) from tx where pillar = 'drinks'),
        'today', (select count(*) from tx where pillar = 'drinks' and at_ts >= v_day_start)
      ) else null end,
      'revenue', case when v_money then jsonb_build_object(
        'total', round((select coalesce(sum(amount), 0) from tx)::numeric, 2),
        'today', round((select coalesce(sum(amount), 0) from tx where at_ts >= v_day_start)::numeric, 2),
        'tickets', round((select coalesce(sum(amount), 0) from tx where pillar = 'tickets')::numeric, 2),
        'tables', round((select coalesce(sum(amount), 0) from tx where pillar = 'tables')::numeric, 2),
        'drinks', round((select coalesce(sum(amount), 0) from tx where pillar = 'drinks')::numeric, 2)
      ) else null end,
      'visits', jsonb_build_object(
        'total', (select count(*) from vis),
        'today', (select count(*) from vis where visited_at >= v_day_start),
        'withOrder', (select count(*) from vis where done)
      ),
      -- La porte : personnes scannées (billets en quantité, convives d'une
      -- table scannée ou arrivée, inscrits guest list) et attendus. Même
      -- définition que « Entrées » dans get_sales_overview.
      'door', jsonb_build_object(
        'entered',
          (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
            where t.event_id = p_event_id and t.status in ('paid', 'used')
              and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
        + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
            where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
              and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
        + (select count(*) from public.guest_list_entries g2 join public.guest_lists l2 on l2.id = g2.guest_list_id
            where l2.event_id = p_event_id and g2.status <> 'cancelled' and coalesce(g2.entry_scanned, false)),
        'expected',
          (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
            where t.event_id = p_event_id and t.status in ('paid', 'used'))
        + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
            where r.event_id = p_event_id and r.status in ('paid', 'confirmed'))
        + (select count(*) from public.guest_list_entries g2 join public.guest_lists l2 on l2.id = g2.guest_list_id
            where l2.event_id = p_event_id and g2.status <> 'cancelled')
      )
    ),

    'lines', coalesce((
      select jsonb_agg(l.obj order by l.pillar_ord, l.ord)
      from (
        -- Paliers de billets
        select 1 as pillar_ord, coalesce(tr.position, 0) * 1000 + row_number() over (order by tr.position, tr.created_at) as ord,
               jsonb_build_object(
                 'pillar', 'tickets', 'id', tr.id, 'name', tr.name, 'price', tr.price,
                 'sold', coalesce((select sum(units) from tx where pillar = 'tickets' and line_id = tr.id), 0),
                 'capacity', nullif(tr.max_tickets, 0),
                 'status', case
                   when coalesce(e.tickets_sold_out, false) or coalesce(tr.manually_sold_out, false)
                     or (coalesce(tr.max_tickets, 0) > 0 and coalesce((select sum(units) from tx where pillar = 'tickets' and line_id = tr.id), 0) >= tr.max_tickets)
                     then 'sold_out'
                   when tr.is_active then 'on_sale'
                   when coalesce(tr.auto_activate, false) then 'upcoming'
                   else 'closed' end,
                 'amount', case when v_money then round(coalesce((select sum(amount) from tx where pillar = 'tickets' and line_id = tr.id), 0)::numeric, 2) else null end
               ) as obj
        from public.ticket_rounds tr where tr.event_id = p_event_id
        union all
        -- Formules de table (de la soirée, ou du club quand elles ne sont pas event-scopées)
        select 2, coalesce(p.position, 0) * 1000 + row_number() over (order by p.position, p.created_at),
               jsonb_build_object(
                 'pillar', 'tables', 'id', p.id, 'name', p.name, 'price', p.base_price,
                 'sold', (select count(*) from tx where pillar = 'tables' and line_id = p.id),
                 'capacity', nullif(p.tables_count, 0),
                 'status', case
                   when coalesce(e.tables_sold_out, false) or p.id = any (coalesce(e.sold_out_pack_ids, '{}'::uuid[])) then 'sold_out'
                   when coalesce(p.tables_count, 0) > 0 and (select count(*) from tx where pillar = 'tables' and line_id = p.id) >= p.tables_count then 'sold_out'
                   when coalesce(e.tables_enabled, false) then 'on_sale'
                   else 'closed' end,
                 'amount', case when v_money then round(coalesce((select sum(amount) from tx where pillar = 'tables' and line_id = p.id), 0)::numeric, 2) else null end
               )
        from public.table_packs p
        where p.is_active
          and (p.event_id = p_event_id
               or (p.event_id is null and coalesce(e.venue_id, e.partner_venue_id) is not null
                   and p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
        union all
        -- Parts de guest list
        select 3, row_number() over (order by gl.created_at),
               jsonb_build_object(
                 'pillar', 'guestList', 'id', gl.id,
                 'name', nullif(btrim(coalesce(gl.holder_label, '')), ''),
                 'holderType', gl.holder_type,
                 'price', null,
                 'sold', (select count(*) from gle where line_id = gl.id),
                 'capacity', nullif(gl.quota, 0),
                 'status', case
                   when coalesce(e.guest_list_sold_out, false) or coalesce(gl.manually_sold_out, false) then 'sold_out'
                   when coalesce(gl.quota, 0) > 0 and (select count(*) from gle where line_id = gl.id) >= gl.quota then 'sold_out'
                   when gl.is_active then 'on_sale'
                   else 'closed' end,
                 'amount', null
               )
        from public.guest_lists gl where gl.event_id = p_event_id
      ) l
    ), '[]'::jsonb),

    -- 2. Comment évoluent-elles ?
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               'd', s.d, 'tickets', s.tickets, 'tables', s.tables, 'guests', s.guests,
               'amount', case when v_money then round(s.amount::numeric, 2) else null end,
               'visits', s.visits, 'people', s.people
             ) order by s.d desc)
      from series s
    ), '[]'::jsonb),

    -- 3. Est-ce qu'on voit ma soirée ?
    'visitSources', coalesce((
      select jsonb_agg(jsonb_build_object('source', v.source, 'sessions', v.sessions, 'orders', v.orders) order by v.sessions desc)
      from (select source, count(*) as sessions, count(*) filter (where done) as orders
            from vis group by source order by 2 desc limit 8) v
    ), '[]'::jsonb),

    -- 4. Qui achète ?
    'audience', jsonb_build_object(
      'people', (select count(*) from people),
      'returning', (select count(*) from seen_before),
      'new', (select count(*) from people) - (select count(*) from seen_before),
      'buyers', (select count(distinct email) from tx where pillar in ('tickets', 'tables') and email is not null),
      'priorEvents', (select count(*) from prior_events)
    ),

    -- 5. Qu'est-ce qui a fait vendre ?
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('source', c.source, 'n', c.n,
               'amount', case when v_money then round(c.amount::numeric, 2) else null end) order by c.n desc)
      from (
        select case when source in ('venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct') then source
                    when source in ('manual', 'manual_open') then 'manual'
                    else 'other' end as source,
               count(*) as n, sum(amount) as amount
        from tx where pillar in ('tickets', 'tables')
        group by 1
      ) c
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'label', coalesce(nullif(btrim(k.label), ''), k.utm_source, k.code), 'code', k.code,
               'clicks', coalesce(k.clicks_count, 0), 'n', k.n, 'entries', k.entries,
               'amount', case when v_money then round(k.amount::numeric, 2) else null end
             ) order by k.n + k.entries desc, k.clicks_count desc nulls last)
      from (
        select tl.id, tl.label, tl.utm_source, tl.code, tl.clicks_count,
               (select count(*) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as n,
               (select count(*) from gle where gle.tracked_link_id = tl.id) as entries,
               (select coalesce(sum(amount), 0) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as amount
        from public.tracked_links tl
        where tl.event_id = p_event_id
           or tl.id in (select tracked_link_id from tx where tracked_link_id is not null)
           or tl.id in (select tracked_link_id from gle where tracked_link_id is not null)
      ) k
      where k.n > 0 or k.entries > 0 or coalesce(k.clicks_count, 0) > 0
    ), '[]'::jsonb),
    -- Repères de la courbe J-N : publication, ouverture d'un tarif (première
    -- vente d'un palier qui n'est pas le premier), emails et push de la soirée.
    'markers', coalesce((
      select jsonb_agg(jsonb_build_object('kind', mk.kind, 'd', mk.d, 'at', mk.at_ts, 'label', mk.label)
                       order by mk.at_ts)
      from (
        select 'published'::text as kind, e.published_at as at_ts, null::text as label,
               (e.start_at at time zone v_tz)::date - (e.published_at at time zone v_tz)::date as d
        where e.published_at is not null
        union all
        select 'round', r.first_at, r.name,
               (e.start_at at time zone v_tz)::date - (r.first_at at time zone v_tz)::date
        from (
          select tr.name, min(tx.at_ts) as first_at,
                 row_number() over (order by min(tx.at_ts)) as rn
          from public.ticket_rounds tr
          join tx on tx.pillar = 'tickets' and tx.line_id = tr.id
          where tr.event_id = p_event_id
          group by tr.id, tr.name
        ) r
        where r.rn > 1
        union all
        select 'email', em.sent_at, em.title,
               (e.start_at at time zone v_tz)::date - (em.sent_at at time zone v_tz)::date
        from emails em where em.sent_at is not null
        union all
        select 'push', pu.sent_at, pu.title,
               (e.start_at at time zone v_tz)::date - (pu.sent_at at time zone v_tz)::date
        from pushes pu where pu.sent_at is not null
      ) mk
      where mk.at_ts <= v_now
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(m.obj order by m.sent_at desc nulls last)
      from (
        select em.sent_at, jsonb_build_object(
                 'kind', 'email', 'id', em.id, 'title', em.title, 'sentAt', em.sent_at, 'auto', em.auto,
                 'reach', em.reach, 'opens', em.opens, 'clicks', em.clicks,
                 'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                 'amount', case when v_money then round(coalesce(a.amount, 0)::numeric, 2) else null end
               ) as obj
        from emails em left join email_attr a on a.campaign_id = em.id
        union all
        select pu.sent_at, jsonb_build_object(
                 'kind', 'push', 'id', pu.id, 'title', pu.title, 'sentAt', pu.sent_at, 'auto', pu.auto,
                 'templateKey', pu.template_key,
                 'reach', pu.reach, 'opens', null, 'clicks', coalesce(a.clicks, 0),
                 'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                 'amount', case when v_money then round(coalesce(a.amount, 0)::numeric, 2) else null end
               )
        from pushes pu left join push_attr a on a.campaign_id = pu.id
      ) m
    ), '[]'::jsonb)
  )
  into v_result;

  -- ── À retenir : 0 à 3 constats, chacun avec son seuil et sa section ──────
  -- Clé + paramètres ; le texte est traduit côté front (er.tk.*). Une base
  -- mince ne dit rien : chaque constat porte un minimum de volume.
  v_entered  := coalesce((v_result #>> '{totals,door,entered}')::int, 0);
  v_expected := coalesce((v_result #>> '{totals,door,expected}')::int, 0);
  v_tx_total := coalesce((v_result #>> '{totals,tickets,orders}')::int, 0)
              + coalesce((v_result #>> '{totals,tables,booked}')::int, 0)
              + coalesce((v_result #>> '{totals,guestList,registered}')::int, 0);

  -- 1. Soirée passée : la porte n'a pas vu tout le monde.
  if v_result #>> '{event,phase}' = 'after' and v_expected >= 30 and v_entered > 0
     and v_entered::numeric / v_expected < 0.7 then
    v_take := v_take || jsonb_build_object('key', 'no_show', 'tone', 'bad', 'section', 'sales',
      'params', jsonb_build_object('pct', round(100.0 * v_entered / v_expected), 'missing', v_expected - v_entered));
  end if;

  -- 2. Un message a fait une bonne part des ventes.
  select m.value into v_row from jsonb_array_elements(v_result -> 'messages') m
   order by (m.value ->> 'orders')::int + (m.value ->> 'entries')::int desc limit 1;
  if found and v_tx_total >= 10
     and ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int) >= 5
     and ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int)::numeric / v_tx_total >= 0.2 then
    v_take := v_take || jsonb_build_object('key', 'msg_drove', 'tone', 'good', 'section', 'reach',
      'params', jsonb_build_object('kind', v_row.value ->> 'kind', 'title', v_row.value ->> 'title',
        'n', (v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int,
        'pct', round(100.0 * ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int) / v_tx_total)));
  end if;

  -- 3. Beaucoup de visites, peu d'achats.
  if coalesce((v_result #>> '{totals,visits,total}')::int, 0) >= 100
     and (v_result #>> '{totals,visits,withOrder}')::numeric / (v_result #>> '{totals,visits,total}')::int < 0.02 then
    v_take := v_take || jsonb_build_object('key', 'low_conversion', 'tone', 'bad', 'section', 'reach',
      'params', jsonb_build_object('visits', (v_result #>> '{totals,visits,total}')::int,
        'pct', round(100.0 * (v_result #>> '{totals,visits,withOrder}')::numeric / (v_result #>> '{totals,visits,total}')::int, 1)));
  end if;

  -- 4. Soirée passée : une grosse part des attendus a acheté le jour J.
  select coalesce(sum((x.value ->> 'people')::int) filter (where (x.value ->> 'd')::int <= 0), 0),
         coalesce(sum((x.value ->> 'people')::int), 0)
    into v_heads_d0, v_heads
  from jsonb_array_elements(v_result -> 'series') x;
  if v_result #>> '{event,phase}' = 'after' and v_heads >= 30 and v_heads_d0::numeric / v_heads >= 0.3 then
    v_take := v_take || jsonb_build_object('key', 'day_of', 'tone', 'info', 'section', 'curve',
      'params', jsonb_build_object('pct', round(100.0 * v_heads_d0 / v_heads)));
  end if;

  -- 5. D'où viennent les visites.
  select s.value into v_row from jsonb_array_elements(v_result -> 'visitSources') s
   order by (s.value ->> 'sessions')::int desc limit 1;
  if found and coalesce((v_result #>> '{totals,visits,total}')::int, 0) >= 30
     and (v_row.value ->> 'sessions')::numeric / (v_result #>> '{totals,visits,total}')::int >= 0.5 then
    v_take := v_take || jsonb_build_object('key', 'visit_source', 'tone', 'info', 'section', 'reach',
      'params', jsonb_build_object('source', v_row.value ->> 'source',
        'pct', round(100.0 * (v_row.value ->> 'sessions')::int / (v_result #>> '{totals,visits,total}')::int)));
  end if;

  -- 6. Public neuf ou public d'habitués (seulement s'il y a eu des soirées avant).
  if coalesce((v_result #>> '{audience,people}')::int, 0) >= 20
     and coalesce((v_result #>> '{audience,priorEvents}')::int, 0) >= 1 then
    if (v_result #>> '{audience,new}')::numeric / (v_result #>> '{audience,people}')::int >= 0.6 then
      v_take := v_take || jsonb_build_object('key', 'mostly_new', 'tone', 'info', 'section', 'who',
        'params', jsonb_build_object('pct', round(100.0 * (v_result #>> '{audience,new}')::int / (v_result #>> '{audience,people}')::int)));
    elsif (v_result #>> '{audience,returning}')::numeric / (v_result #>> '{audience,people}')::int >= 0.5 then
      v_take := v_take || jsonb_build_object('key', 'mostly_returning', 'tone', 'good', 'section', 'who',
        'params', jsonb_build_object('pct', round(100.0 * (v_result #>> '{audience,returning}')::int / (v_result #>> '{audience,people}')::int)));
    end if;
  end if;

  -- ── Rythme : la dernière soirée TERMINÉE de la portée (≥ 20 attendus), et
  --    la part de ses attendus qu'elle avait au même J-N. Le front applique
  --    cette part aux attendus d'aujourd'hui pour dire où finira la soirée.
  if v_result #>> '{event,phase}' = 'before' then
    v_ref_d := (e.start_at at time zone v_tz)::date - (v_now at time zone v_tz)::date;
    for v_ref in
      select x.id, x.title, x.start_at, coalesce(x.timezone, v.timezone, 'Europe/Paris') as tz
      from public.events x
      left join public.venues v on v.id = coalesce(x.venue_id, x.partner_venue_id)
      where x.id = any(v_scope_ids) and x.id <> p_event_id
        and x.cancelled_at is null and x.end_at < v_now and x.start_at < e.start_at
      order by x.start_at desc
      limit 6
    loop
      select coalesce(sum(h.n), 0),
             -- Jours ENTIERS avant ce J-N (strictement) : aujourd'hui n'est pas
             -- fini ici, on ne le compare pas à une journée complète là-bas.
             coalesce(sum(h.n) filter (where (v_ref.start_at at time zone v_ref.tz)::date - (h.at_ts at time zone v_ref.tz)::date > v_ref_d), 0)
        into v_ref_final, v_ref_at
      from (
        select greatest(coalesce(t.quantity, 1), 1) as n, coalesce(t.paid_at, t.created_at) as at_ts
        from public.tickets t where t.event_id = v_ref.id and t.status in ('paid', 'used')
        union all
        select greatest(coalesce(r.guest_count, 0), 1), coalesce(r.paid_at, r.created_at)
        from public.table_reservations r where r.event_id = v_ref.id and r.status in ('paid', 'confirmed')
        union all
        select 1, g.created_at
        from public.guest_list_entries g join public.guest_lists gl on gl.id = g.guest_list_id
        where gl.event_id = v_ref.id and g.status <> 'cancelled'
      ) h;
      if v_ref_final >= 20 then
        v_pace := jsonb_build_object('refId', v_ref.id, 'refTitle', v_ref.title, 'd', v_ref_d,
                                     'final', v_ref_final, 'atSameD', v_ref_at);
        exit;
      end if;
    end loop;
  end if;
  v_result := v_result || jsonb_build_object('pace', v_pace);

  v_result := v_result || jsonb_build_object('takeaways',
    coalesce((select jsonb_agg(x.value) from (select value from jsonb_array_elements(v_take) limit 3) x), '[]'::jsonb));

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_traffic(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g           record;
  e           record;
  v_now       timestamptz := now();
  v_tz        text;
  v_day_start timestamptz;
  v_end       timestamptz;
  v_phase     text;
  v_result    jsonb;
  v_take      jsonb := '[]'::jsonb;
  v_sess      integer;
  v_sel       integer;
  v_co        integer;
  v_de        integer;
  v_pu        integer;
  v_lost      integer;
  v_best_lost integer := 0;
  v_key       text;
  v_pct       numeric;
  v_row       record;
  v_conv_all  numeric;
  v_mob       jsonb;
  v_desk      jsonb;
  v_ab        jsonb;
BEGIN
  SELECT * INTO g FROM public.event_analytics_scope(p_event_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  SELECT ev.*, COALESCE(ev.timezone, v.timezone, 'Europe/Paris') AS tz
    INTO e
    FROM public.events ev
    LEFT JOIN public.venues v ON v.id = COALESCE(ev.venue_id, ev.partner_venue_id)
   WHERE ev.id = p_event_id;

  v_tz := e.tz;
  v_day_start := date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_end := COALESCE(e.end_at, e.start_at + interval '8 hours');
  v_phase := CASE WHEN v_now < e.start_at THEN 'before' WHEN v_now < v_end THEN 'live' ELSE 'after' END;

  WITH
  -- ── Visites de la page (une ligne par visite, comme le Rapport) ───────────
  vis AS MATERIALIZED (
    SELECT s.session_id, s.visited_at, s.visitor_id, COALESCE(s.is_returning, false) AS is_returning,
           COALESCE(NULLIF(s.referrer_category, ''), 'direct') AS source,
           s.device_type, s.duration_seconds, s.scroll_depth_max, s.city, s.country_code
      FROM public.visitor_sessions s
     WHERE s.event_id = p_event_id
  ),
  -- ── Le tunnel : rang de chaque étape, une ligne par événement ─────────────
  fn AS MATERIALIZED (
    SELECT f.session_id, f.step, f.pillar, f.ref_id, f.quantity, f.amount_cents, f.reason, f.device, f.source, f.created_at,
           CASE f.step WHEN 'viewed' THEN 1 WHEN 'selected' THEN 2 WHEN 'checkout' THEN 3
                       WHEN 'details' THEN 4 WHEN 'payment' THEN 4 WHEN 'purchased' THEN 5 END AS rk
      FROM public.event_funnel_events f
     WHERE f.event_id = p_event_id
  ),
  -- Une ligne par session : l'étape la plus avancée et quand.
  sess AS MATERIALIZED (
    SELECT f.session_id,
           min(f.created_at) AS first_at,
           COALESCE(max(f.rk), 1) AS rk,
           min(f.created_at) FILTER (WHERE f.step = 'checkout') AS checkout_at,
           min(f.created_at) FILTER (WHERE f.step = 'purchased') AS purchased_at,
           bool_or(f.step = 'failed') AS failed,
           (array_agg(f.device) FILTER (WHERE f.device IS NOT NULL))[1] AS device,
           (array_agg(f.source) FILTER (WHERE f.source IS NOT NULL))[1] AS source
      FROM fn f
     GROUP BY f.session_id
  ),
  -- Une ligne par (session, pilier) : le tunnel de chaque pilier.
  sess_p AS MATERIALIZED (
    SELECT f.session_id, f.pillar, COALESCE(max(f.rk), 2) AS rk
      FROM fn f
     WHERE f.pillar IS NOT NULL AND f.rk IS NOT NULL
     GROUP BY f.session_id, f.pillar
  ),

  stage AS (
    SELECT count(*) AS sessions,
           count(*) FILTER (WHERE rk >= 2) AS selected,
           count(*) FILTER (WHERE rk >= 3) AS checkout,
           count(*) FILTER (WHERE rk >= 4) AS details,
           count(*) FILTER (WHERE rk >= 5) AS purchased,
           count(*) FILTER (WHERE rk < 5 AND failed) AS failed_open
      FROM sess
  ),
  stage_p AS (
    SELECT pillar,
           count(*) FILTER (WHERE rk >= 2) AS selected,
           count(*) FILTER (WHERE rk >= 3) AS checkout,
           count(*) FILTER (WHERE rk >= 4) AS details,
           count(*) FILTER (WHERE rk >= 5) AS purchased
      FROM sess_p GROUP BY pillar
  ),

  -- ── Les refus, avec leur motif et l'étape où ils tombent ──────────────────
  fail_reasons AS (
    SELECT COALESCE(NULLIF(f.reason, ''), 'server') AS reason, count(DISTINCT f.session_id) AS sessions
      FROM fn f WHERE f.step = 'failed'
     GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  ),

  -- ── Choix des paliers / formules, face aux ventes réelles ─────────────────
  sel AS (
    SELECT f.pillar, f.ref_id, count(DISTINCT f.session_id) AS sessions, COALESCE(sum(f.quantity), 0) AS units
      FROM fn f
     WHERE f.step = 'selected' AND f.pillar IN ('tickets', 'tables') AND f.ref_id IS NOT NULL
     GROUP BY f.pillar, f.ref_id
  ),
  sold_t AS (
    SELECT t.ticket_round_id::text AS ref_id, sum(greatest(COALESCE(t.quantity, 1), 1)) AS sold
      FROM public.tickets t
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')
     GROUP BY 1
  ),
  sold_r AS (
    SELECT r.pack_id::text AS ref_id, count(*) AS sold
      FROM public.table_reservations r
     WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed')
     GROUP BY 1
  ),
  sel_rows AS (
    SELECT s.pillar, s.ref_id, s.sessions, s.units,
           COALESCE(tr.name, tp.name) AS name,
           CASE WHEN s.pillar = 'tickets' THEN COALESCE(st.sold, 0) ELSE COALESCE(sr.sold, 0) END AS sold
      FROM sel s
      LEFT JOIN public.ticket_rounds tr ON s.pillar = 'tickets' AND tr.id::text = s.ref_id
      LEFT JOIN public.table_packs tp ON s.pillar = 'tables' AND tp.id::text = s.ref_id
      LEFT JOIN sold_t st ON s.pillar = 'tickets' AND st.ref_id = s.ref_id
      LEFT JOIN sold_r sr ON s.pillar = 'tables' AND sr.ref_id = s.ref_id
     ORDER BY s.sessions DESC
     LIMIT 12
  ),

  -- ── Sources : visites, puis ce qu'elles deviennent dans le tunnel ─────────
  src_v AS (SELECT source, count(*) AS visits FROM vis GROUP BY source),
  src_f AS (
    SELECT COALESCE(s.source, 'unknown') AS source,
           count(*) AS sessions,
           count(*) FILTER (WHERE s.rk >= 3) AS checkout,
           count(*) FILTER (WHERE s.rk >= 5) AS purchased
      FROM sess s
     GROUP BY 1
  ),
  sources AS (
    SELECT COALESCE(a.source, b.source) AS source, COALESCE(a.visits, 0) AS visits,
           COALESCE(b.sessions, 0) AS sessions, COALESCE(b.checkout, 0) AS checkout, COALESCE(b.purchased, 0) AS purchased
      FROM src_v a FULL JOIN src_f b ON a.source = b.source
     ORDER BY COALESCE(a.visits, 0) DESC, COALESCE(b.sessions, 0) DESC
     LIMIT 10
  ),

  -- ── Appareils : visites, et conversion du tunnel (l'appareil y est posé) ──
  dev_v AS (SELECT COALESCE(device_type, 'unknown') AS device, count(*) AS visits FROM vis GROUP BY 1),
  dev_f AS (
    SELECT COALESCE(device, 'unknown') AS device,
           count(*) AS sessions,
           count(*) FILTER (WHERE rk >= 3) AS checkout,
           count(*) FILTER (WHERE rk >= 5) AS purchased
      FROM sess GROUP BY 1
  ),
  devices AS (
    SELECT COALESCE(a.device, b.device) AS device, COALESCE(a.visits, 0) AS visits,
           COALESCE(b.sessions, 0) AS sessions, COALESCE(b.checkout, 0) AS checkout, COALESCE(b.purchased, 0) AS purchased
      FROM dev_v a FULL JOIN dev_f b ON a.device = b.device
     ORDER BY COALESCE(a.visits, 0) DESC
  ),

  -- ── Temps : vue → achat, paiement → achat (médianes, en secondes) ─────────
  timing AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (purchased_at - first_at)))
             FILTER (WHERE purchased_at IS NOT NULL AND purchased_at >= first_at) AS view_to_buy,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (purchased_at - checkout_at)))
             FILTER (WHERE purchased_at IS NOT NULL AND checkout_at IS NOT NULL AND purchased_at >= checkout_at) AS checkout_to_buy,
           count(*) FILTER (WHERE purchased_at IS NOT NULL) AS buyers
      FROM sess
  ),

  -- ── Valeur des paniers abandonnés (entrés au paiement, pas d'achat) ───────
  cart_last AS (
    SELECT f.session_id, f.pillar, (array_agg(f.amount_cents ORDER BY f.created_at DESC))[1] AS cents
      FROM fn f
     WHERE f.step = 'selected' AND f.amount_cents IS NOT NULL
     GROUP BY f.session_id, f.pillar
  ),
  abandoned AS (
    SELECT count(*) AS sessions, COALESCE(sum(c.cents), 0) AS cents
      FROM sess s
      JOIN (SELECT session_id, sum(cents) AS cents FROM cart_last GROUP BY session_id) c ON c.session_id = s.session_id
     WHERE s.rk IN (3, 4)
  ),

  -- ── Engagement de la page (visites mesurées) ──────────────────────────────
  eng AS (
    SELECT count(*) AS visits,
           count(*) FILTER (WHERE visited_at >= v_day_start) AS today,
           count(DISTINCT visitor_id) AS visitors,
           count(*) FILTER (WHERE is_returning) AS returning_n,
           avg(duration_seconds) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600) AS avg_duration,
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600) AS duration_n,
           -- Le défilement est écrit avec la durée, à la sortie de la page : une
           -- visite sans durée n'a pas été mesurée, son 0 ne veut pas dire « n'a pas défilé ».
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600) AS scroll_n,
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600 AND scroll_depth_max >= 50) AS scroll_half,
           count(*) FILTER (WHERE duration_seconds BETWEEN 1 AND 3600 AND scroll_depth_max >= 90) AS scroll_full
      FROM vis
  ),
  cities AS (
    SELECT city, count(*) AS visits FROM vis WHERE city IS NOT NULL AND city <> '' GROUP BY city ORDER BY 2 DESC LIMIT 6
  ),

  -- ── Jour par jour (d = jours calendaires avant la soirée) ─────────────────
  day_rows AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (visited_at AT TIME ZONE v_tz)::date AS d, 1 AS visits, 0 AS checkout, 0 AS purchased FROM vis
    UNION ALL
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (checkout_at AT TIME ZONE v_tz)::date, 0, 1, 0 FROM sess WHERE checkout_at IS NOT NULL
    UNION ALL
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (purchased_at AT TIME ZONE v_tz)::date, 0, 0, 1 FROM sess WHERE purchased_at IS NOT NULL
  ),
  series AS (
    SELECT d, sum(visits) AS visits, sum(checkout) AS checkout, sum(purchased) AS purchased
      FROM day_rows WHERE d BETWEEN -3 AND 120 GROUP BY d
  ),

  -- ── En ce moment ──────────────────────────────────────────────────────────
  live AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE stage = 'cart') AS cart,
           count(*) FILTER (WHERE stage = 'checkout') AS checkout
      FROM public.live_visitor_pings p
     WHERE p.event_id = p_event_id AND p.last_seen > v_now - interval '75 seconds'
  )
  SELECT jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'money', g.money,
    'scope', CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    'event', jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', v_end, 'poster', e.poster_url,
      'cancelled', e.cancelled_at IS NOT NULL, 'phase', v_phase
    ),
    'visits', (SELECT jsonb_build_object(
        'total', visits, 'today', today, 'visitors', visitors, 'returning', returning_n,
        'avgDuration', CASE WHEN duration_n >= 10 THEN round(avg_duration)::int END,
        'scrollSample', scroll_n, 'scrollHalf', scroll_half, 'scrollFull', scroll_full
      ) FROM eng),
    'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'visits', visits)) FROM cities), '[]'::jsonb),
    'funnel', (SELECT jsonb_build_object(
        'tracked', sessions > 0,
        'sessions', sessions, 'selected', selected, 'checkout', checkout, 'details', details, 'purchased', purchased,
        'failedOpen', failed_open
      ) FROM stage),
    'pillars', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'pillar', pillar, 'selected', selected, 'checkout', checkout, 'details', details, 'purchased', purchased
      ) ORDER BY pillar) FROM stage_p), '[]'::jsonb),
    'failures', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'sessions', sessions)) FROM fail_reasons), '[]'::jsonb),
    'selections', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'pillar', pillar, 'ref', ref_id, 'name', name, 'sessions', sessions, 'units', units, 'sold', sold
      ) ORDER BY sessions DESC) FROM sel_rows), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'source', source, 'visits', visits, 'sessions', sessions, 'checkout', checkout, 'purchased', purchased
      )) FROM sources), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'device', device, 'visits', visits, 'sessions', sessions, 'checkout', checkout, 'purchased', purchased
      )) FROM devices), '[]'::jsonb),
    'timing', (SELECT jsonb_build_object(
        'buyers', buyers,
        'viewToBuy', CASE WHEN buyers >= 5 THEN round(view_to_buy)::int END,
        'checkoutToBuy', CASE WHEN buyers >= 5 THEN round(checkout_to_buy)::int END
      ) FROM timing),
    'abandoned', (SELECT jsonb_build_object(
        'sessions', sessions, 'amount', CASE WHEN g.money THEN round(cents / 100.0, 2) END
      ) FROM abandoned),
    'series', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', d, 'visits', visits, 'checkout', checkout, 'purchased', purchased) ORDER BY d DESC) FROM series), '[]'::jsonb),
    'live', (SELECT jsonb_build_object('total', total, 'cart', cart, 'checkout', checkout) FROM live)
  ) INTO v_result;

  RETURN v_result || jsonb_build_object('takeaways', public.lens_traffic_takeaways(v_result));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_events_sales_summary(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_money  boolean := false;
  v_events jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
  end if;

  with
  ev as materialized (
    select e.id, e.title, e.start_at, e.end_at, e.status, e.is_active, e.cancelled_at,
           e.published_at, coalesce(e.poster_url, e.image_url) as poster,
           e.ticketing_enabled, e.tables_enabled,
           e.tickets_sold_out, e.tables_sold_out, e.guest_list_sold_out,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           coalesce(e.sold_out_pack_ids, '{}'::uuid[]) as closed_packs,
           date_trunc('day', v_now at time zone coalesce(e.timezone, v.timezone, 'Europe/Paris'))
             at time zone coalesce(e.timezone, v.timezone, 'Europe/Paris') as day_start,
           case
             when p_organizer_user_id is not null then v_money
               and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id
                    or public.coorg_sees_event_money(e.id, 'org:' || p_organizer_user_id::text))
             else v_money and (e.venue_id = p_venue_id
                               or public.coorg_cohost_sees_money(e.id, 'venue:' || p_venue_id))
           end as show_money
    from public.events e
    left join public.venues v on v.id = coalesce(e.venue_id, e.partner_venue_id)
    where e.end_at > v_now - interval '12 hours'
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and e.external_source is null
      and (
           (p_venue_id is not null and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id or e.id in (select public.cohost_event_ids_venue(p_venue_id))))
        or (p_organizer_user_id is not null
            and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))))
      )
    order by e.start_at
    limit 60
  ),

  tk as (
    select t.event_id,
           coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) as sold,
           coalesce(sum(greatest(coalesce(t.quantity, 1), 1))
             filter (where coalesce(t.paid_at, t.created_at) >= ev.day_start), 0) as sold_today,
           coalesce(sum(
             greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
           ) filter (where coalesce(t.paid_at, t.created_at) >= ev.day_start), 0) as amount_today
    from public.tickets t
    join ev on ev.id = t.event_id
    where t.status in ('paid', 'used')
    group by t.event_id
  ),

  rounds as (
    select tr.event_id,
           count(*) as n,
           count(*) filter (where coalesce(tr.max_tickets, 0) <= 0) as unbounded,
           coalesce(sum(greatest(coalesce(tr.max_tickets, 0), 0)), 0) as cap
    from public.ticket_rounds tr
    join ev on ev.id = tr.event_id
    group by tr.event_id
  ),

  tb as (
    select r.event_id,
           count(*) as booked,
           count(*) filter (where coalesce(r.paid_at, r.created_at) >= ev.day_start) as booked_today,
           coalesce(sum(greatest(coalesce(r.guest_count, 0), 0)), 0) as guests,
           coalesce(sum(
             greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
           ) filter (where coalesce(r.paid_at, r.created_at) >= ev.day_start), 0) as amount_today
    from public.table_reservations r
    join ev on ev.id = r.event_id
    where r.status in ('paid', 'confirmed')
    group by r.event_id
  ),

  -- Même inventaire que `_event_tables_left` : formules actives de la soirée,
  -- ou du club quand la formule n'est pas event-scopée, formules « complètes »
  -- exclues.
  packs as (
    select ev.id as event_id, coalesce(sum(p.tables_count), 0)::integer as cap
    from ev
    join public.table_packs p
      on p.is_active
     and (p.event_id = ev.id
          or (p.event_id is null and coalesce(ev.venue_id, ev.partner_venue_id) is not null
              and p.venue_id = coalesce(ev.venue_id, ev.partner_venue_id)))
     and not (p.id = any (ev.closed_packs))
    group by ev.id
  ),

  gls as (
    select gl.event_id,
           count(*) filter (where gl.is_active) as lists,
           count(*) filter (where gl.is_active and coalesce(gl.quota, 0) <= 0) as unbounded,
           coalesce(sum(greatest(coalesce(gl.quota, 0), 0)) filter (where gl.is_active), 0) as cap,
           bool_and(coalesce(gl.manually_sold_out, false)) filter (where gl.is_active) as all_closed
    from public.guest_lists gl
    join ev on ev.id = gl.event_id
    group by gl.event_id
  ),

  gle as (
    select gl.event_id,
           count(*) as registered,
           count(*) filter (where e2.created_at >= ev.day_start) as registered_today
    from public.guest_list_entries e2
    join public.guest_lists gl on gl.id = e2.guest_list_id
    join ev on ev.id = gl.event_id
    where e2.status <> 'cancelled'
    group by gl.event_id
  ),

  dr as (
    select o.event_id,
           count(*) as orders,
           count(*) filter (where coalesce(o.paid_at, o.created_at) >= ev.day_start) as orders_today,
           coalesce(sum(
             greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
           ) filter (where coalesce(o.paid_at, o.created_at) >= ev.day_start), 0) as amount_today
    from public.orders o
    join ev on ev.id = o.event_id
    where p_venue_id is not null
      and o.venue_id = p_venue_id
      and o.status in ('paid', 'served')
    group by o.event_id
  ),

  vis as (
    select s.event_id,
           count(*) as total,
           count(*) filter (where s.visited_at >= ev.day_start) as today
    from public.visitor_sessions s
    join ev on ev.id = s.event_id
    group by s.event_id
  )

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ev.id,
           'title', ev.title,
           'startAt', ev.start_at,
           'endAt', ev.end_at,
           'poster', ev.poster,
           'status', ev.status,
           'isActive', ev.is_active,
           'publishedAt', ev.published_at,
           'dayStart', ev.day_start,
           'tickets', jsonb_build_object(
             'enabled', coalesce(ev.ticketing_enabled, false),
             'soldOut', coalesce(ev.tickets_sold_out, false),
             'sold', coalesce(tk.sold, 0),
             'today', coalesce(tk.sold_today, 0),
             'capacity', case
               when coalesce(ev.max_tickets, 0) > 0 then ev.max_tickets
               when rounds.n > 0 and rounds.unbounded = 0 then rounds.cap
               else null end
           ),
           'tables', jsonb_build_object(
             'enabled', coalesce(ev.tables_enabled, false),
             'soldOut', coalesce(ev.tables_sold_out, false),
             'booked', coalesce(tb.booked, 0),
             'today', coalesce(tb.booked_today, 0),
             'guests', coalesce(tb.guests, 0),
             'capacity', case when coalesce(packs.cap, 0) > 0 then packs.cap else null end
           ),
           'guestList', jsonb_build_object(
             'enabled', coalesce(gls.lists, 0) > 0,
             'soldOut', coalesce(ev.guest_list_sold_out, false) or coalesce(gls.all_closed, false),
             'registered', coalesce(gle.registered, 0),
             'today', coalesce(gle.registered_today, 0),
             'capacity', case when coalesce(gls.lists, 0) > 0 and gls.unbounded = 0 and gls.cap > 0
                              then gls.cap else null end
           ),
           'drinks', case when p_venue_id is not null then jsonb_build_object(
             'orders', coalesce(dr.orders, 0),
             'today', coalesce(dr.orders_today, 0)
           ) else null end,
           'visits', jsonb_build_object(
             'total', coalesce(vis.total, 0),
             'today', coalesce(vis.today, 0)
           ),
           'revenue', case when ev.show_money then jsonb_build_object(
             'total', round((coalesce(tk.amount, 0) + coalesce(tb.amount, 0) + coalesce(dr.amount, 0))::numeric, 2),
             'today', round((coalesce(tk.amount_today, 0) + coalesce(tb.amount_today, 0) + coalesce(dr.amount_today, 0))::numeric, 2),
             'tickets', round(coalesce(tk.amount, 0)::numeric, 2),
             'tables', round(coalesce(tb.amount, 0)::numeric, 2),
             'drinks', round(coalesce(dr.amount, 0)::numeric, 2)
           ) else null end
         ) order by ev.start_at), '[]'::jsonb)
    into v_events
  from ev
  left join tk     on tk.event_id = ev.id
  left join rounds on rounds.event_id = ev.id
  left join tb     on tb.event_id = ev.id
  left join packs  on packs.event_id = ev.id
  left join gls    on gls.event_id = ev.id
  left join gle    on gle.event_id = ev.id
  left join dr     on dr.event_id = ev.id
  left join vis    on vis.event_id = ev.id;

  return jsonb_build_object(
    'ok', true,
    'now', v_now,
    'money', v_money,
    'events', v_events
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_external_event_live(p_event_ids uuid[])
 RETURNS TABLE(event_id uuid, ticket_url text, deals jsonb, left_tickets integer, sold_out boolean, venue_label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id, e.external_ticket_url, e.tickets_sold_out, e.location_name, e.location_city,
           ee.url, ee.deals, ee.left_tickets, ee.city, ee.address_visibility,
           -- Rue montrée seulement quand Shotgun la dit publique (une valeur
           -- inconnue la cache : un lieu secret ne fuit jamais par l'email).
           CASE WHEN COALESCE(lower(btrim(ee.address_visibility)), 'public') IN ('public', 'visible', 'always', 'everyone', 'all')
                THEN NULLIF(btrim(ee.street), '') END AS street
      FROM public.events e
      LEFT JOIN public.external_events ee ON ee.event_id = e.id
     WHERE e.id = ANY (p_event_ids)
       AND e.external_source IS NOT NULL
       AND (COALESCE(auth.role(), '') = 'service_role'
            OR public.is_super_admin()
            OR (auth.uid() IS NOT NULL AND public.can_manage_event_design(auth.uid(), e.id)))
  ), d AS (
    SELECT ev.id AS event_id, x.ord,
           NULLIF(btrim(x.j->>'id'), '') AS did,
           btrim(x.j->>'name') AS name,
           CASE WHEN x.j->>'price' ~ '^[0-9]+(\.[0-9]+)?$' THEN (x.j->>'price')::numeric END AS price,
           CASE WHEN x.j->>'quantity' ~ '^[0-9]+$' THEN (x.j->>'quantity')::integer END AS q
      FROM ev,
           jsonb_array_elements(CASE WHEN jsonb_typeof(ev.deals) = 'array' THEN ev.deals ELSE '[]'::jsonb END)
             WITH ORDINALITY AS x(j, ord)
     WHERE COALESCE(lower(x.j->>'visibility'), 'public') = 'public'
       AND COALESCE(lower(x.j->>'sales_channel'), 'online') = 'online'
       AND NULLIF(btrim(x.j->>'name'), '') IS NOT NULL
  ), sold AS (
    -- Billets vendus par tarif : même rapprochement que _crm_night_tiers
    -- (id Shotgun, sinon nom), mêmes ventes (_crm_ticket_is_sale).
    SELECT d.event_id, d.ord,
           COALESCE((SELECT sum(GREATEST(t.quantity, 1))
                       FROM public.external_tickets t
                      WHERE t.event_id = d.event_id
                        AND public._crm_ticket_is_sale(t.status, t.raw)
                        AND ((d.did IS NOT NULL AND t.deal_id = d.did)
                          OR (lower(btrim(t.deal_name)) = lower(d.name)
                              AND (d.did IS NULL OR t.deal_id IS DISTINCT FROM d.did)))), 0) AS n
      FROM d
  )
  SELECT ev.id,
         COALESCE(ev.url, ev.external_ticket_url),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', d.did,
                    'name', d.name,
                    'price', d.price,
                    'out', (d.q IS NOT NULL AND d.q > 0 AND s.n >= d.q))
                  ORDER BY d.price NULLS LAST, d.ord)
             FROM d JOIN sold s ON s.event_id = d.event_id AND s.ord = d.ord
            WHERE d.event_id = ev.id
         ), '[]'::jsonb),
         ev.left_tickets,
         COALESCE(ev.tickets_sold_out, false),
         NULLIF(concat_ws(' — ',
           NULLIF(btrim(ev.location_name), ''),
           CASE
             WHEN ev.street IS NULL THEN NULLIF(btrim(COALESCE(ev.city, ev.location_city)), '')
             WHEN NULLIF(btrim(COALESCE(ev.city, ev.location_city)), '') IS NOT NULL
              AND position(lower(btrim(COALESCE(ev.city, ev.location_city))) IN lower(ev.street)) = 0
               THEN ev.street || ', ' || btrim(COALESCE(ev.city, ev.location_city))
             ELSE ev.street
           END), '')
    FROM ev;
$function$;

CREATE OR REPLACE FUNCTION public.get_guest_list_analytics(p_venue_id text DEFAULT NULL::text, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_tz text DEFAULT 'Europe/Paris'::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with lists as (
    select
      gl.id,
      gl.event_id,
      gl.quota,
      gl.is_active,
      coalesce(gl.holder_type, 'venue')            as holder_type,
      coalesce(nullif(gl.holder_label, ''), '—')   as holder_label,
      gl.promoter_id,
      gl.dj_id,
      gl.entry_kind,
      gl.includes_drink,
      coalesce(
        gl.promoter_id::text,
        gl.dj_id::text,
        gl.organizer_user_id::text,
        nullif(gl.holder_label, ''),
        coalesce(gl.holder_type, 'venue')
      ) as holder_key,
      e.title      as event_title,
      e.start_at,
      e.end_at,
      -- La porte est ouverte : la présence devient mesurable.
      (e.start_at <= now()) as night_started,
      -- La soirée est fermée : le no-show est figé, plus personne n'arrivera.
      ((coalesce(e.end_at, e.start_at + interval '8 hours') + interval '2 hours') <= now()) as night_over
    from public.guest_lists gl
    join public.events e on e.id = gl.event_id
    where (
          (p_venue_id is not null and coalesce(gl.venue_id, e.venue_id, e.partner_venue_id) = p_venue_id)
       or (p_organizer_user_id is not null and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))))
      )
      and (p_event_id is null or gl.event_id = p_event_id)
      -- Une liste est dans la période si sa soirée y tombe OU si elle a reçu
      -- une inscription pendant la période : les inscrits d'une soirée à venir
      -- comptent le jour où ils s'inscrivent, pas le jour de la soirée.
      and (
        ((p_from is null or e.start_at >= p_from) and (p_to is null or e.start_at <= p_to))
        or exists (
          select 1 from public.guest_list_entries x
          where x.guest_list_id = gl.id
            and x.status <> 'cancelled'
            and (p_from is null or x.created_at >= p_from)
            and (p_to   is null or x.created_at <= p_to)
        )
      )
  ),
  -- Un invité = une ligne. Identité normalisée pour le rattachement à la dépense.
  guests as (
    select
      ge.id            as entry_id,
      ge.user_id,
      lower(trim(ge.email))                              as email_norm,
      nullif(regexp_replace(coalesce(ge.phone, ''), '\D', '', 'g'), '') as phone_norm,
      ge.entry_scanned,
      ge.entry_scanned_at,
      ge.created_at,
      coalesce(nullif(ge.entry_type, ''), 'normal')      as entry_type,
      lower(coalesce(nullif(ge.gender, ''), 'unknown'))  as gender,
      l.id             as list_id,
      l.quota          as list_quota,
      l.event_id,
      l.event_title,
      l.start_at,
      l.end_at,
      l.night_started,
      l.night_over,
      l.holder_type,
      l.holder_label,
      l.holder_key,
      l.promoter_id,
      l.dj_id
    from public.guest_list_entries ge
    join lists l on l.id = ge.guest_list_id
    where ge.status <> 'cancelled'
  ),
  arrived as (
    select * from guests where entry_scanned
  ),
  -- Le no-show n'existe que sur une soirée fermée. Une soirée à venir ou en
  -- cours n'en produit aucun : ses inscrits sont « en attente ».
  no_shows as (
    select * from guests where night_over and not entry_scanned
  ),
  -- ── Dépense bar rattachée aux invités entrés ──────────────────────────────
  guest_orders as (
    select distinct on (o.id)
      o.id,
      g.entry_id,
      g.event_id,
      g.entry_type,
      g.gender,
      g.list_id,
      g.holder_key,
      (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) as amount
    from arrived g
    join public.orders o
      on o.venue_id = p_venue_id
     and o.status in ('paid', 'served')
     and (
          o.event_id = g.event_id
          or (o.event_id is null
              and o.created_at >= g.start_at - interval '6 hours'
              and o.created_at <= g.end_at   + interval '6 hours')
         )
     and (
          (g.user_id is not null and o.user_id = g.user_id)
          or lower(trim(coalesce(o.user_email, ''))) = g.email_norm
          or (g.phone_norm is not null
              and nullif(regexp_replace(coalesce(o.guest_phone, ''), '\D', '', 'g'), '') = g.phone_norm)
         )
    order by o.id, g.entry_id
  ),
  -- ── Dépense VIP (table réservée par un invité guest list) ─────────────────
  guest_tables as (
    select distinct on (r.id)
      r.id,
      g.entry_id,
      g.event_id,
      g.entry_type,
      g.gender,
      g.list_id,
      g.holder_key,
      (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) as amount
    from arrived g
    join public.table_reservations r
      on r.event_id = g.event_id
     and r.status in ('paid', 'confirmed')
     and (
          (g.user_id is not null and r.user_id = g.user_id)
          or lower(trim(coalesce(r.user_email, ''))) = g.email_norm
          or (g.phone_norm is not null
              and nullif(regexp_replace(coalesce(r.phone, r.guest_phone, ''), '\D', '', 'g'), '') = g.phone_norm)
         )
    order by r.id, g.entry_id
  ),
  -- Conso servie en table pour ces mêmes invités (bouteilles, deux sauts via la résa)
  guest_vip_items as (
    select vc.id, vc.quantity, vc.total_price, vc.item_type
    from public.vip_consumptions vc
    join guest_tables gt on gt.id = vc.table_reservation_id
  ),
  -- Dépense agrégée par invité, séparée bar / VIP pour le détail par propriétaire
  spend_per_guest as (
    select
      entry_id,
      sum(bar)         as bar,
      sum(vip)         as vip,
      sum(bar + vip)   as amount
    from (
      select entry_id, amount as bar, 0::numeric as vip from guest_orders
      union all
      select entry_id, 0::numeric, amount from guest_tables
    ) s
    group by entry_id
  ),
  -- ── Benchmark : détenteurs de billets payants entrés aux mêmes soirées ────
  paid_entrants as (
    select distinct on (tk.id)
      tk.id,
      tk.user_id,
      lower(trim(coalesce(tk.user_email, ''))) as email_norm,
      tk.event_id
    from public.tickets tk
    join (select distinct event_id from lists) l on l.event_id = tk.event_id
    where tk.status = 'paid'
      and coalesce(tk.entry_scanned, false)
      and coalesce(tk.total_price, 0) > 0
    order by tk.id
  ),
  paid_orders as (
    select distinct on (o.id) o.id, (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) as amount
    from paid_entrants p
    join public.orders o
      on o.venue_id = p_venue_id
     and o.event_id = p.event_id
     and o.status in ('paid', 'served')
     and (
          (p.user_id is not null and o.user_id = p.user_id)
          or lower(trim(coalesce(o.user_email, ''))) = p.email_norm
         )
    order by o.id
  ),
  -- ── Agrégats par propriétaire de liste ───────────────────────────────────
  holder_list_agg as (
    select
      holder_key,
      min(holder_type)  as holder_type,
      min(holder_label) as holder_label,
      count(*)          as lists_n,
      count(distinct event_id) as events_n,
      coalesce(sum(quota) filter (where quota is not null), 0) as quota_total,
      count(*) filter (where quota is not null) as capped_lists
    from lists
    group by holder_key
  ),
  holder_guest_agg as (
    select
      g.holder_key,
      count(*)                                       as signups,
      count(*) filter (where g.entry_scanned)        as arrived,
      count(*) filter (where not g.night_started)    as upcoming,
      count(*) filter (where g.night_started)        as started,
      count(*) filter (where g.night_over)           as settled,
      count(*) filter (where g.night_over and not g.entry_scanned) as no_show,
      count(*) filter (where g.list_quota is not null) as capped_signups,
      coalesce(sum(sp.bar), 0)                       as bar_revenue,
      coalesce(sum(sp.vip), 0)                       as vip_revenue,
      coalesce(sum(sp.amount), 0)                    as revenue,
      count(*) filter (where coalesce(sp.amount, 0) > 0) as spenders
    from guests g
    left join spend_per_guest sp on sp.entry_id = g.entry_id
    group by g.holder_key
  ),
  holder_order_agg as (
    select holder_key, count(*) as bar_orders from guest_orders group by holder_key
  ),
  holder_table_agg as (
    select holder_key, count(*) as vip_reservations from guest_tables group by holder_key
  )
  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'lists',           (select count(*) from lists),
      'active_lists',    (select count(*) from lists where is_active),
      'events',          (select count(distinct event_id) from lists),
      'upcoming_events', (select count(distinct event_id) from lists where not night_started),
      'settled_events',  (select count(distinct event_id) from lists where night_over),
      'signups',         (select count(*) from guests),
      'arrived',         (select count(*) from arrived),
      -- Inscrits en attente : leur soirée n'a pas encore ouvert ses portes.
      'upcoming',        (select count(*) from guests where not night_started),
      -- Inscrits dont la porte est ouverte (soirée en cours ou terminée).
      'started',         (select count(*) from guests where night_started),
      -- Inscrits dont la soirée est fermée : la seule base du no-show.
      'settled',         (select count(*) from guests where night_over),
      'no_show',         (select count(*) from no_shows),
      'no_show_rate',    coalesce((select round((select count(*) from no_shows)::numeric * 100
                                    / nullif(count(*), 0), 1) from guests where night_over), 0),
      'show_rate',       coalesce((select round((count(*) filter (where entry_scanned))::numeric * 100
                                    / nullif(count(*), 0), 1) from guests where night_started), 0),
      -- Rappel : quota NULL = illimité → exclu du calcul de remplissage
      'quota_total',     coalesce((select sum(quota) from lists where quota is not null), 0),
      'capped_lists',    (select count(*) from lists where quota is not null),
      'unlimited_lists', (select count(*) from lists where quota is null),
      'fill_rate',       coalesce((
        select round(count(g.entry_id)::numeric * 100 / nullif(sum_q.q, 0), 1)
        from guests g
        join lists l on l.id = g.list_id and l.quota is not null
        cross join (select sum(quota)::numeric q from lists where quota is not null) sum_q
        group by sum_q.q), 0)
    ),
    'spend', jsonb_build_object(
      'bar_revenue',       coalesce((select sum(amount) from guest_orders), 0),
      'vip_revenue',       coalesce((select sum(amount) from guest_tables), 0),
      'total_revenue',     coalesce((select sum(amount) from spend_per_guest), 0),
      'bar_orders',        (select count(*) from guest_orders),
      'vip_reservations',  (select count(*) from guest_tables),
      'bottles',           coalesce((select sum(quantity) from guest_vip_items where item_type = 'bottle'), 0),
      'guests_with_spend', (select count(*) from spend_per_guest where amount > 0),
      'conversion_rate',   coalesce((
        select round((select count(*) from spend_per_guest where amount > 0)::numeric * 100
               / nullif((select count(*) from arrived), 0), 1)), 0),
      -- La métrique qui justifie la guest list : ce que rapporte un invité entré
      'avg_per_arrived',   coalesce((
        select round(coalesce((select sum(amount) from spend_per_guest), 0)
               / nullif((select count(*) from arrived), 0), 2)), 0),
      'avg_per_spender',   coalesce((
        select round(avg(amount)::numeric, 2) from spend_per_guest where amount > 0), 0),
      -- Ce que « coûte » un no-show : place bloquée, zéro consommation. Sur
      -- soirées fermées uniquement — une place encore à venir n'est pas perdue.
      'lost_value',        coalesce((
        select round(
          coalesce((select sum(amount) from spend_per_guest), 0)
          / nullif((select count(*) from arrived), 0)
          * (select count(*) from no_shows), 2)), 0)
    ),
    'benchmark', jsonb_build_object(
      'guest_avg',   coalesce((
        select round(coalesce((select sum(amount) from spend_per_guest), 0)
               / nullif((select count(*) from arrived), 0), 2)), 0),
      'ticket_avg',  coalesce((
        select round(coalesce((select sum(amount) from paid_orders), 0)
               / nullif((select count(*) from paid_entrants), 0), 2)), 0),
      'ticket_entrants', (select count(*) from paid_entrants),
      'ticket_bar_revenue', coalesce((select sum(amount) from paid_orders), 0)
    ),
    'arrivals_by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'arrivals', arrivals) order by hour)
      from (
        select extract(hour from (entry_scanned_at at time zone p_tz))::int as hour,
               count(*) as arrivals
        from arrived
        where entry_scanned_at is not null
        group by 1
      ) ah), '[]'::jsonb),
    'peak_hour', (
      select extract(hour from (entry_scanned_at at time zone p_tz))::int
      from arrived where entry_scanned_at is not null
      group by 1 order by count(*) desc, 1 limit 1),
    -- Délai d'inscription avant la soirée : mesure l'anticipation réelle du
    -- public. Soirées ouvertes uniquement — la présence d'une soirée à venir
    -- n'est pas encore une donnée.
    'signup_lead', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket, 'signups', n, 'arrived', a) order by ord)
      from (
        select
          case
            when start_at - created_at >= interval '7 days'  then '7d+'
            when start_at - created_at >= interval '3 days'  then '3-7d'
            when start_at - created_at >= interval '1 day'   then '1-3d'
            when start_at - created_at >= interval '6 hours' then '6-24h'
            else '<6h'
          end as bucket,
          case
            when start_at - created_at >= interval '7 days'  then 1
            when start_at - created_at >= interval '3 days'  then 2
            when start_at - created_at >= interval '1 day'   then 3
            when start_at - created_at >= interval '6 hours' then 4
            else 5
          end as ord,
          count(*) as n,
          count(*) filter (where entry_scanned) as a
        from guests
        where night_started
        group by 1, 2
      ) sl), '[]'::jsonb),
    'by_entry_type', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_type', entry_type, 'signups', n, 'arrived', a, 'upcoming', upc,
        'no_show_rate', nsr, 'revenue', rev, 'avg_per_arrived', apa) order by n desc)
      from (
        select
          g.entry_type,
          count(*) as n,
          count(*) filter (where g.entry_scanned) as a,
          count(*) filter (where not g.night_started) as upc,
          round((count(*) filter (where g.night_over and not g.entry_scanned))::numeric * 100
                / nullif(count(*) filter (where g.night_over), 0), 1) as nsr,
          coalesce(sum(sp.amount), 0) as rev,
          round(coalesce(sum(sp.amount), 0) / nullif(count(*) filter (where g.entry_scanned), 0), 2) as apa
        from guests g
        left join spend_per_guest sp on sp.entry_id = g.entry_id
        group by g.entry_type
      ) bt), '[]'::jsonb),
    'by_gender', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gender', gender, 'signups', n, 'arrived', a, 'upcoming', upc,
        'no_show_rate', nsr, 'revenue', rev, 'avg_per_arrived', apa) order by n desc)
      from (
        select
          g.gender,
          count(*) as n,
          count(*) filter (where g.entry_scanned) as a,
          count(*) filter (where not g.night_started) as upc,
          round((count(*) filter (where g.night_over and not g.entry_scanned))::numeric * 100
                / nullif(count(*) filter (where g.night_over), 0), 1) as nsr,
          coalesce(sum(sp.amount), 0) as rev,
          round(coalesce(sum(sp.amount), 0) / nullif(count(*) filter (where g.entry_scanned), 0), 2) as apa
        from guests g
        left join spend_per_guest sp on sp.entry_id = g.entry_id
        group by g.gender
      ) bg), '[]'::jsonb),
    -- Détail complet par propriétaire de liste (alimente le menu déroulant)
    'by_holder', coalesce((
      select jsonb_agg(jsonb_build_object(
        'holder_key',      holder_key,
        'holder_type',     holder_type,
        'holder_label',    holder_label,
        'lists',           lists_n,
        'events',          events_n,
        'signups',         signups,
        'arrived',         arrived_n,
        'upcoming',        upcoming_n,
        'settled',         settled_n,
        'no_show',         no_show_n,
        'no_show_rate',    no_show_rate,
        'show_rate',       show_rate,
        'quota_total',     quota_total,
        'capped_lists',    capped_lists,
        'fill_rate',       fill_rate,
        'revenue',         revenue,
        'bar_revenue',     bar_revenue,
        'vip_revenue',     vip_revenue,
        'bar_orders',      bar_orders,
        'vip_reservations', vip_reservations,
        'spenders',        spenders,
        'conversion_rate', conversion_rate,
        'avg_per_arrived', avg_per_arrived,
        'avg_per_spender', avg_per_spender,
        'peak_hour',       peak_hour,
        'arrivals_by_hour', arrivals_by_hour,
        'by_entry_type',   by_entry_type,
        'top_event',       top_event
      ) order by revenue desc, signups desc)
      from (
        select
          hla.holder_key,
          hla.holder_type,
          hla.holder_label,
          hla.lists_n,
          hla.events_n,
          hla.quota_total,
          hla.capped_lists,
          coalesce(hga.signups, 0)      as signups,
          coalesce(hga.arrived, 0)      as arrived_n,
          coalesce(hga.upcoming, 0)     as upcoming_n,
          coalesce(hga.settled, 0)      as settled_n,
          coalesce(hga.no_show, 0)      as no_show_n,
          coalesce(hga.revenue, 0)      as revenue,
          coalesce(hga.bar_revenue, 0)  as bar_revenue,
          coalesce(hga.vip_revenue, 0)  as vip_revenue,
          coalesce(hga.spenders, 0)     as spenders,
          coalesce(hoa.bar_orders, 0)   as bar_orders,
          coalesce(hta.vip_reservations, 0) as vip_reservations,
          -- No-show : soirées fermées de ce propriétaire uniquement.
          round(coalesce(hga.no_show, 0)::numeric * 100
                / nullif(hga.settled, 0), 1) as no_show_rate,
          -- Présence : soirées dont la porte a ouvert.
          round(coalesce(hga.arrived, 0)::numeric * 100
                / nullif(hga.started, 0), 1) as show_rate,
          -- Remplissage : uniquement les listes plafonnées de ce propriétaire
          round(coalesce(hga.capped_signups, 0)::numeric * 100
                / nullif(hla.quota_total, 0), 1) as fill_rate,
          round(coalesce(hga.spenders, 0)::numeric * 100
                / nullif(hga.arrived, 0), 1) as conversion_rate,
          round(coalesce(hga.revenue, 0) / nullif(hga.arrived, 0), 2)  as avg_per_arrived,
          round(coalesce(hga.revenue, 0) / nullif(hga.spenders, 0), 2) as avg_per_spender,
          (select extract(hour from (g3.entry_scanned_at at time zone p_tz))::int
             from guests g3
            where g3.holder_key = hla.holder_key
              and g3.entry_scanned and g3.entry_scanned_at is not null
            group by 1 order by count(*) desc, 1 limit 1) as peak_hour,
          coalesce((
            select jsonb_agg(jsonb_build_object('hour', hour, 'arrivals', n) order by hour)
            from (
              select extract(hour from (g4.entry_scanned_at at time zone p_tz))::int as hour,
                     count(*) as n
              from guests g4
              where g4.holder_key = hla.holder_key
                and g4.entry_scanned and g4.entry_scanned_at is not null
              group by 1
            ) ha), '[]'::jsonb) as arrivals_by_hour,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'entry_type', et, 'signups', n, 'arrived', a, 'revenue', rev) order by n desc)
            from (
              select g5.entry_type as et,
                     count(*) as n,
                     count(*) filter (where g5.entry_scanned) as a,
                     coalesce(sum(sp5.amount), 0) as rev
              from guests g5
              left join spend_per_guest sp5 on sp5.entry_id = g5.entry_id
              where g5.holder_key = hla.holder_key
              group by g5.entry_type
            ) et), '[]'::jsonb) as by_entry_type,
          (select jsonb_build_object(
             'event_id', ev.event_id, 'title', ev.title, 'start_at', ev.start_at,
             'signups', ev.n, 'arrived', ev.a, 'revenue', ev.rev)
             from (
               select g6.event_id,
                      min(g6.event_title) as title,
                      min(g6.start_at)    as start_at,
                      count(*) as n,
                      count(*) filter (where g6.entry_scanned) as a,
                      coalesce(sum(sp6.amount), 0) as rev
               from guests g6
               left join spend_per_guest sp6 on sp6.entry_id = g6.entry_id
               where g6.holder_key = hla.holder_key
               group by g6.event_id
               order by coalesce(sum(sp6.amount), 0) desc, count(*) desc
               limit 1
             ) ev) as top_event
        from holder_list_agg hla
        left join holder_guest_agg hga on hga.holder_key = hla.holder_key
        left join holder_order_agg hoa on hoa.holder_key = hla.holder_key
        left join holder_table_agg hta on hta.holder_key = hla.holder_key
        order by coalesce(hga.revenue, 0) desc, coalesce(hga.signups, 0) desc
        limit 30
      ) bh), '[]'::jsonb),
    'by_event', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id', event_id, 'title', title, 'start_at', start_at,
        'signups', n, 'arrived', a, 'no_show_rate', nsr,
        'night_started', started, 'night_over', over_,
        'revenue', rev, 'avg_per_arrived', apa) order by start_at desc)
      from (
        select
          g.event_id,
          max(g.event_title) as title,
          max(g.start_at) as start_at,
          bool_or(g.night_started) as started,
          bool_or(g.night_over)    as over_,
          count(*) as n,
          count(*) filter (where g.entry_scanned) as a,
          round((count(*) filter (where g.night_over and not g.entry_scanned))::numeric * 100
                / nullif(count(*) filter (where g.night_over), 0), 1) as nsr,
          coalesce(sum(sp.amount), 0) as rev,
          round(coalesce(sum(sp.amount), 0) / nullif(count(*) filter (where g.entry_scanned), 0), 2) as apa
        from guests g
        left join spend_per_guest sp on sp.entry_id = g.entry_id
        group by g.event_id
        order by max(g.start_at) desc
        limit 20
      ) be), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_live_view(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now        timestamptz := now();
  v_tz         text := 'Europe/Paris';
  v_day_start  timestamptz;
  v_event_ids  uuid[];
  v_gl_ids     uuid[];
  v_recent_ids uuid[];
  v_home       jsonb := null;
  v_release_id uuid;
  v_release    jsonb := null;
  v_visitors_now integer := 0;
  v_sessions_today integer := 0;
  v_points     jsonb := '[]'::jsonb;
  v_behavior   jsonb;
  v_pages      jsonb := '[]'::jsonb;
  v_locations  jsonb := '[]'::jsonb;
  v_sales      jsonb;
  v_feed       jsonb := '[]'::jsonb;
  v_lat        double precision;
  v_lng        double precision;
  v_home_name  text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
      or public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'view_finance')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.can_manage_venue(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ── Portée : les soirées du club / de l'organisateur ────────────────────
  select coalesce(array_agg(e.id), '{}')
    into v_event_ids
  from public.events e
  where (p_venue_id is not null and e.venue_id = p_venue_id)
     or (p_organizer_user_id is not null
         and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))));

  -- Soirées « vivantes » (pas finies depuis plus d'un jour) : ce sont celles
  -- que le front écoute en Realtime — une liste courte, jamais tout l'historique.
  select coalesce(array_agg(x.id order by x.start_at), '{}')
    into v_recent_ids
  from (
    select e.id, e.start_at
    from public.events e
    where e.id = any(v_event_ids)
      and e.end_at > v_now - interval '1 day'
    order by e.start_at
    limit 60
  ) x;

  select coalesce(array_agg(gl.id), '{}')
    into v_gl_ids
  from public.guest_lists gl
  where gl.event_id = any(v_recent_ids);

  -- ── Fuseau + point d'ancrage (le club) ────────────────────────────────
  if p_venue_id is not null then
    select coalesce(v.timezone, 'Europe/Paris'), v.latitude, v.longitude, v.name
      into v_tz, v_lat, v_lng, v_home_name
    from public.venues v where v.id = p_venue_id;
  else
    -- Organisateur : le club de sa prochaine soirée (ou de la dernière), s'il y en a un.
    select coalesce(e.timezone, v.timezone, 'Europe/Paris'), v.latitude, v.longitude, v.name
      into v_tz, v_lat, v_lng, v_home_name
    from public.events e
    left join public.venues v on v.id = e.venue_id
    where e.id = any(v_event_ids)
    order by (e.end_at > v_now) desc, abs(extract(epoch from (e.start_at - v_now)))
    limit 1;
    v_tz := coalesce(v_tz, 'Europe/Paris');
  end if;
  if v_lat is not null and v_lng is not null then
    v_home := jsonb_build_object('lat', v_lat, 'lng', v_lng, 'name', v_home_name);
  end if;
  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;

  -- ── Visiteurs en ce moment (battement < 75 s) + leurs points ───────────
  select count(distinct p.session_id)
    into v_visitors_now
  from public.live_visitor_pings p
  where p.last_seen > v_now - interval '75 seconds'
    and (
         (p_venue_id is not null and p.venue_id = p_venue_id)
      or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
      or p.event_id = any(v_event_ids)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
           'session', x.session_id,
           'stage', x.stage,
           'path', x.page_path,
           'seen', x.last_seen,
           'eventTitle', x.event_title,
           'city', x.city,
           'country', x.country,
           'countryCode', x.country_code,
           'lat', x.latitude,
           'lng', x.longitude,
           'device', x.device_type,
           'source', x.referrer_category
         ) order by x.last_seen desc), '[]'::jsonb)
    into v_points
  from (
    select distinct on (p.session_id)
           p.session_id, p.stage, p.page_path, p.last_seen, e.title as event_title,
           vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude, vs.device_type, vs.referrer_category
    from public.live_visitor_pings p
    left join public.events e on e.id = p.event_id
    left join lateral (
      select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
      from public.visitor_sessions s
      where s.session_id = p.session_id
      order by s.visited_at desc
      limit 1
    ) vs on true
    where p.last_seen > v_now - interval '75 seconds'
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    order by p.session_id, p.last_seen desc
  ) x;

  -- ── Comportement des 10 dernières minutes (une session = son dernier stade) ──
  select jsonb_build_object(
           'browsing', count(*) filter (where x.stage = 'browsing'),
           'cart',     count(*) filter (where x.stage = 'cart'),
           'checkout', count(*) filter (where x.stage = 'checkout'),
           'paid',     count(*) filter (where x.stage = 'paid')
         )
    into v_behavior
  from (
    select distinct on (p.session_id) p.session_id, p.stage
    from public.live_visitor_pings p
    where p.last_seen > v_now - interval '10 minutes'
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    order by p.session_id, p.last_seen desc
  ) x;

  -- ── Pages regardées en ce moment ───────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', x.page_path, 'n', x.n, 'eventTitle', x.event_title
         ) order by x.n desc, x.page_path), '[]'::jsonb)
    into v_pages
  from (
    select p.page_path, count(distinct p.session_id) as n, max(e.title) as event_title
    from public.live_visitor_pings p
    left join public.events e on e.id = p.event_id
    where p.last_seen > v_now - interval '75 seconds'
      and p.page_path is not null
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    group by p.page_path
    order by n desc
    limit 6
  ) x;

  -- ── Sessions du jour + villes ─────────────────────────────────────────
  select count(*)
    into v_sessions_today
  from public.visitor_sessions s
  where s.visited_at >= v_day_start
    and (
         (p_venue_id is not null and s.venue_id = p_venue_id)
      or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
      or s.event_id = any(v_event_ids)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
           'city', x.city, 'country', x.country, 'countryCode', x.country_code,
           'n', x.n, 'lat', x.lat, 'lng', x.lng
         ) order by x.n desc), '[]'::jsonb)
    into v_locations
  from (
    select coalesce(s.city, s.region, s.country) as city,
           s.country,
           max(s.country_code) as country_code,
           count(*) as n,
           avg(s.latitude) as lat,
           avg(s.longitude) as lng
    from public.visitor_sessions s
    where s.visited_at >= v_day_start
      and coalesce(s.city, s.region, s.country) is not null
      and (
           (p_venue_id is not null and s.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
        or s.event_id = any(v_event_ids)
      )
    group by coalesce(s.city, s.region, s.country), s.country
    order by n desc
    limit 8
  ) x;

  -- ── Ventes du jour (CA club, formules de fees.ts) ───────────────────────
  select jsonb_build_object(
    'tickets', (
      select jsonb_build_object(
        'orders', count(*),
        'qty', coalesce(sum(t.quantity), 0),
        'amount', coalesce(sum(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)), 0)
      )
      from public.tickets t
      where t.event_id = any(v_event_ids)
        and t.status in ('paid', 'used')
        and coalesce(t.paid_at, t.created_at) >= v_day_start
    ),
    'tables', (
      select jsonb_build_object(
        'orders', count(*),
        'guests', coalesce(sum(coalesce(r.guest_count, 0)), 0),
        'amount', coalesce(sum(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END)), 0)
      )
      from public.table_reservations r
      where r.event_id = any(v_event_ids)
        and r.status in ('paid', 'confirmed')
        and coalesce(r.paid_at, r.created_at) >= v_day_start
    ),
    'guestlist', (
      select jsonb_build_object('orders', count(*))
      from public.guest_list_entries gle
      join public.guest_lists gl on gl.id = gle.guest_list_id
      where gl.event_id = any(v_event_ids)
        and gle.status <> 'cancelled'
        and gle.created_at >= v_day_start
    ),
    'drinks', (
      select jsonb_build_object(
        'orders', count(*),
        'amount', coalesce(sum(o.total - coalesce(o.service_fee, 0)), 0)
      )
      from public.orders o
      where p_venue_id is not null
        and o.venue_id = p_venue_id
        and o.status in ('paid', 'served')
        and coalesce(o.paid_at, o.created_at) >= v_day_start
    )
  ) into v_sales;

  -- ── Flux d'activité : les 40 derniers faits des 24 dernières heures ────
  select coalesce(jsonb_agg(to_jsonb(f) order by f.ts desc), '[]'::jsonb)
    into v_feed
  from (
    select * from (
      (
        select 'visit'::text as kind,
               'visit:' || s.id::text as id,
               s.visited_at as ts,
               s.city, s.country, s.country_code as "countryCode",
               s.latitude as lat, s.longitude as lng,
               s.referrer_category as source,
               s.device_type as device,
               s.entry_page_type as "pageType",
               e.title as "eventTitle",
               null::numeric as amount,
               null::integer as qty,
               coalesce(s.is_returning, false) as returning
        from public.visitor_sessions s
        left join public.events e on e.id = s.event_id
        where s.visited_at > v_now - interval '24 hours'
          and (
               (p_venue_id is not null and s.venue_id = p_venue_id)
            or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
            or s.event_id = any(v_event_ids)
          )
        order by s.visited_at desc
        limit 40
      )
      union all
      (
        select 'ticket', 'ticket:' || t.id::text, coalesce(t.paid_at, t.created_at),
               vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude,
               coalesce(t.purchase_source, vs.referrer_category), vs.device_type, 'ticket',
               e.title,
               t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0),
               t.quantity, false
        from public.tickets t
        join public.events e on e.id = t.event_id
        left join lateral (
          select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
          from public.visitor_sessions s
          where s.order_id is not null and s.order_id::text = t.id::text
          order by s.visited_at desc limit 1
        ) vs on true
        where t.event_id = any(v_event_ids)
          and t.status in ('paid', 'used')
          and coalesce(t.paid_at, t.created_at) > v_now - interval '24 hours'
        order by coalesce(t.paid_at, t.created_at) desc
        limit 40
      )
      union all
      (
        select 'table', 'table:' || r.id::text, coalesce(r.paid_at, r.created_at),
               vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude,
               coalesce(r.purchase_source, vs.referrer_category), vs.device_type, 'table',
               e.title,
               r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END),
               coalesce(r.guest_count, 0), false
        from public.table_reservations r
        join public.events e on e.id = r.event_id
        left join lateral (
          select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
          from public.visitor_sessions s
          where s.order_id is not null and s.order_id::text = r.id::text
          order by s.visited_at desc limit 1
        ) vs on true
        where r.event_id = any(v_event_ids)
          and r.status in ('paid', 'confirmed')
          and coalesce(r.paid_at, r.created_at) > v_now - interval '24 hours'
        order by coalesce(r.paid_at, r.created_at) desc
        limit 40
      )
      union all
      (
        select 'guestlist', 'gl:' || gle.id::text, gle.created_at,
               null::text, null::text, null::text, null::double precision, null::double precision,
               case when gle.promoter_id is not null then 'promoter' else null end, null::text, 'guestlist',
               e.title, null::numeric, 1, false
        from public.guest_list_entries gle
        join public.guest_lists gl on gl.id = gle.guest_list_id
        join public.events e on e.id = gl.event_id
        where gl.event_id = any(v_event_ids)
          and gle.status <> 'cancelled'
          and gle.created_at > v_now - interval '24 hours'
        order by gle.created_at desc
        limit 40
      )
      union all
      (
        select 'order', 'order:' || o.id::text, coalesce(o.paid_at, o.created_at),
               null::text, null::text, null::text, null::double precision, null::double precision,
               o.purchase_source, null::text, 'order',
               e.title,
               o.total - coalesce(o.service_fee, 0),
               coalesce(jsonb_array_length(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end), 0),
               false
        from public.orders o
        left join public.events e on e.id = o.event_id
        where p_venue_id is not null
          and o.venue_id = p_venue_id
          and o.status in ('paid', 'served')
          and coalesce(o.paid_at, o.created_at) > v_now - interval '24 hours'
        order by coalesce(o.paid_at, o.created_at) desc
        limit 40
      )
    ) u
    order by u.ts desc
    limit 40
  ) f;

  -- ── Release en cours : la soirée qui vend le plus depuis une heure ──────
  select t.event_id
    into v_release_id
  from public.tickets t
  join public.events e on e.id = t.event_id
  where t.event_id = any(v_event_ids)
    and t.status in ('paid', 'used')
    and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'
  group by t.event_id, e.start_at
  order by sum(t.quantity) desc, e.start_at
  limit 1;

  if v_release_id is null then
    -- Rien ne vend à l'instant : on suit la prochaine soirée qui a une billetterie.
    select e.id into v_release_id
    from public.events e
    where e.id = any(v_event_ids)
      and e.ticketing_enabled
      and e.status = 'active' and e.is_active and e.cancelled_at is null
      and e.end_at > v_now
    order by e.start_at
    limit 1;
  end if;

  if v_release_id is not null then
    select jsonb_build_object(
      'eventId', e.id,
      'title', e.title,
      'startAt', e.start_at,
      'endAt', e.end_at,
      'publishedAt', e.published_at,
      'poster', coalesce(e.poster_url, e.image_url),
      'ticketsSoldOut', e.tickets_sold_out,
      'maxTickets', e.max_tickets,
      'sales10m', (select coalesce(sum(t.quantity), 0) from public.tickets t
                   where t.event_id = e.id and t.status in ('paid', 'used')
                     and coalesce(t.paid_at, t.created_at) > v_now - interval '10 minutes'),
      'sales60m', (select coalesce(sum(t.quantity), 0) from public.tickets t
                   where t.event_id = e.id and t.status in ('paid', 'used')
                     and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'),
      'salesToday', (select coalesce(sum(t.quantity), 0) from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')
                       and coalesce(t.paid_at, t.created_at) >= v_day_start),
      'salesTotal', (select coalesce(sum(t.quantity), 0) from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')),
      'revenue60m', (select coalesce(sum(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)), 0)
                     from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')
                       and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'),
      'tables60m', (select count(*) from public.table_reservations r
                    where r.event_id = e.id and r.status in ('paid', 'confirmed')
                      and coalesce(r.paid_at, r.created_at) > v_now - interval '60 minutes'),
      'guests60m', (select count(*) from public.guest_list_entries gle
                    join public.guest_lists gl on gl.id = gle.guest_list_id
                    where gl.event_id = e.id and gle.status <> 'cancelled'
                      and gle.created_at > v_now - interval '60 minutes'),
      'viewersNow', (select count(distinct p.session_id) from public.live_visitor_pings p
                     where p.event_id = e.id and p.last_seen > v_now - interval '75 seconds'),
      -- 60 cases : billets par minute, de la plus ancienne (il y a 59 min) à maintenant.
      'series', (
        select jsonb_agg(coalesce(c.n, 0) order by g.m desc)
        from generate_series(59, 0, -1) as g(m)
        left join (
          select floor(extract(epoch from (v_now - coalesce(t.paid_at, t.created_at))) / 60)::int as m,
                 sum(t.quantity) as n
          from public.tickets t
          where t.event_id = e.id and t.status in ('paid', 'used')
            and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'
          group by 1
        ) c on c.m = g.m
      ),
      'rounds', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', tr.id, 'name', tr.name, 'price', tr.price,
                 'sold', tr.tickets_sold, 'max', tr.max_tickets,
                 'active', tr.is_active, 'soldOut', tr.manually_sold_out or (tr.max_tickets > 0 and tr.tickets_sold >= tr.max_tickets)
               ) order by tr.position, tr.created_at), '[]'::jsonb)
        from public.ticket_rounds tr where tr.event_id = e.id
      )
    )
    into v_release
    from public.events e
    where e.id = v_release_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'dayStart', v_day_start,
    'home', v_home,
    'visitorsNow', v_visitors_now,
    'sessionsToday', v_sessions_today,
    'points', v_points,
    'behavior', v_behavior,
    'pages', v_pages,
    'locations', v_locations,
    'sales', v_sales,
    'feed', v_feed,
    'release', v_release,
    'watch', jsonb_build_object(
      'eventIds', to_jsonb(v_recent_ids),
      'guestListIds', to_jsonb(v_gl_ids)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_organizer_customer_segments(p_organizer_user_id uuid)
 RETURNS TABLE(id text, user_id uuid, email text, first_name text, last_name text, phone text, first_visit_at timestamp with time zone, last_visit_at timestamp with time zone, total_spent numeric, ticket_count integer, order_count integer, table_count integer, is_banned boolean, banned_at timestamp with time zone, ban_reason text, notes text, revenue_30d numeric, revenue_90d numeric, revenue_prev_90d numeric, avg_basket numeric, visit_nights integer, visits_per_month numeric, last_activity_at timestamp with time zone, preferred_dow integer, preferred_event_title text, recency_days integer, rfm_r integer, rfm_f integer, rfm_m integer, rfm_segment text, rfm_tier text, churn_risk boolean, guest_list_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT can_manage_organizer(p_organizer_user_id) THEN
    RAISE EXCEPTION 'Not authorized for organizer %', p_organizer_user_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH organizer_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id
  ),
  -- Revenu organisateur = montant facturé − frais Yuno (billets + tables).
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind,
           t.user_id, t.full_name, t.guest_first_name, t.guest_last_name,
           NULLIF(btrim(COALESCE(t.phone, t.guest_phone, '')), '') AS phone
    FROM tickets t JOIN organizer_events oe ON oe.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END))::numeric,
           tr.created_at, tr.event_id, 'table'::text,
           tr.user_id, tr.full_name, tr.guest_first_name, tr.guest_last_name,
           NULLIF(btrim(COALESCE(tr.phone, tr.guest_phone, '')), '')
    FROM table_reservations tr JOIN organizer_events oe ON oe.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
    UNION ALL
    -- Guest list : montant 0, mais c'est une PERSONNE de plus dans le fichier
    -- client. Sur une soirée en entrée libre (aucune billetterie, aucune table)
    -- c'est la SEULE activité qui existe : sans cette branche, l'organisateur
    -- terminait sa soirée avec un fichier client vide.
    SELECT lower(gle.email),
           0::numeric,
           gle.created_at, gl.event_id, 'guestlist'::text,
           gle.user_id, gle.full_name, NULL::text, NULL::text,
           NULLIF(btrim(COALESCE(gle.phone, '')), '')
    FROM guest_list_entries gle
    JOIN guest_lists gl ON gl.id = gle.guest_list_id
    JOIN organizer_events oe ON oe.id = gl.event_id
    WHERE gle.email IS NOT NULL
      AND btrim(gle.email) <> ''
      AND gle.status <> 'cancelled'
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(sum(a.amount), 0) AS total_spent,
      COALESCE(avg(a.amount) FILTER (WHERE a.kind <> 'guestlist'), 0) AS avg_basket,
      count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
      count(*) FILTER (WHERE a.kind = 'table') AS table_count,
      count(*) FILTER (WHERE a.kind = 'guestlist') AS guest_list_count,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  -- Dernière valeur NON NULLE de chaque champ, jamais « la dernière ligne » :
  -- une inscription guest list sans numéro effaçait le téléphone laissé lors
  -- d'un achat précédent, et la fiche client s'ouvrait sans coordonnées.
  ident AS (
    SELECT a.em,
      (array_agg(a.user_id ORDER BY a.created_at DESC) FILTER (WHERE a.user_id IS NOT NULL))[1] AS user_id,
      (array_agg(a.full_name ORDER BY a.created_at DESC) FILTER (WHERE a.full_name IS NOT NULL))[1] AS full_name,
      (array_agg(a.guest_first_name ORDER BY a.created_at DESC) FILTER (WHERE a.guest_first_name IS NOT NULL))[1] AS guest_first_name,
      (array_agg(a.guest_last_name ORDER BY a.created_at DESC) FILTER (WHERE a.guest_last_name IS NOT NULL))[1] AS guest_last_name,
      (array_agg(a.phone ORDER BY a.created_at DESC) FILTER (WHERE a.phone IS NOT NULL))[1] AS phone
    FROM activity a GROUP BY a.em
  ),
  event_activity AS (
    SELECT a.em, a.event_id, oe.start_at, oe.title, count(*) AS cnt
    FROM activity a JOIN organizer_events oe ON oe.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, oe.start_at, oe.title
  ),
  pref_event AS (
    SELECT DISTINCT ON (ea.em) ea.em, ea.title AS preferred_event_title
    FROM event_activity ea ORDER BY ea.em, ea.cnt DESC, ea.start_at DESC
  ),
  pref_dow AS (
    SELECT s.em, s.dow FROM (
      SELECT ea.em, extract(dow FROM ea.start_at)::int AS dow,
             row_number() OVER (PARTITION BY ea.em ORDER BY sum(ea.cnt) DESC) AS rn
      FROM event_activity ea GROUP BY ea.em, extract(dow FROM ea.start_at)
    ) s WHERE s.rn = 1
  ),
  base AS (
    SELECT
      ag.em AS c_id,
      COALESCE(id_.user_id, p.id) AS c_user_id,
      ag.em AS c_email,
      COALESCE(p.first_name, id_.guest_first_name,
               NULLIF(split_part(COALESCE(id_.full_name, ''), ' ', 1), '')) AS c_first_name,
      COALESCE(p.last_name, id_.guest_last_name,
               NULLIF(substr(COALESCE(id_.full_name, ''), strpos(COALESCE(id_.full_name, '') || ' ', ' ') + 1), '')) AS c_last_name,
      COALESCE(id_.phone, p.phone) AS c_phone,
      ag.first_activity_at AS c_first_visit_at,
      ag.last_activity_at AS c_last_visit_at,
      round(ag.total_spent, 2) AS c_total_spent,
      ag.ticket_count::int AS c_ticket_count,
      ag.table_count::int AS c_table_count,
      ag.guest_list_count::int AS c_guest_list_count,
      (b.email IS NOT NULL) AS c_is_banned, b.banned_at AS c_banned_at, b.ban_reason AS c_ban_reason,
      n.notes AS c_notes,
      ag.revenue_30d AS c_revenue_30d, ag.revenue_90d AS c_revenue_90d,
      ag.revenue_prev_90d AS c_revenue_prev_90d, ag.avg_basket AS c_avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS c_visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS c_visits_per_month,
      ag.last_activity_at AS c_last_activity_at,
      pd.dow AS c_preferred_dow, pe.preferred_event_title AS c_preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, ag.first_activity_at, now()))) / 86400)::int AS c_recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE (ag.ticket_count + ag.table_count + ag.guest_list_count)::int
      END AS c_rfm_freq,
      round(ag.total_spent, 2) AS c_rfm_money
    FROM agg ag
    LEFT JOIN ident id_ ON id_.em = ag.em
    -- Un email peut porter PLUSIEURS profils (comptes orphelins, comptes
    -- vitrine). Un LEFT JOIN direct dupliquait alors la ligne client. On n'en
    -- retient qu'un : celui qui a réellement fait l'activité, sinon le plus récent.
    LEFT JOIN LATERAL (
      SELECT pr.id, pr.first_name, pr.last_name, NULLIF(btrim(COALESCE(pr.phone, '')), '') AS phone
      FROM profiles pr
      WHERE lower(pr.email) = ag.em
      ORDER BY (pr.id = id_.user_id) DESC NULLS LAST, pr.created_at DESC
      LIMIT 1
    ) p ON true
    LEFT JOIN organizer_banned_emails b ON b.organizer_user_id = p_organizer_user_id AND b.email = ag.em
    LEFT JOIN organizer_customer_notes n ON n.organizer_user_id = p_organizer_user_id AND n.email = ag.em
    LEFT JOIN pref_event pe ON pe.em = ag.em
    LEFT JOIN pref_dow pd ON pd.em = ag.em
  ),
  ranked AS (
    SELECT b.*,
      count(*) OVER () AS n_total,
      (rank() OVER (ORDER BY b.c_rfm_freq) - 1)::numeric  AS freq_below,
      (rank() OVER (ORDER BY b.c_rfm_money) - 1)::numeric AS mon_below
    FROM base b
  ),
  scored AS (
    -- Règle identique au club, au mot près (cf. _venue_customer_rfm).
    SELECT rk.*,
      CASE WHEN rk.c_recency_days <= 14 THEN 5
           WHEN rk.c_recency_days <= 30 THEN 4
           WHEN rk.c_recency_days <= 60 THEN 3
           WHEN rk.c_recency_days <= 90 THEN 2
           ELSE 1 END AS s_r,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.freq_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS rel_f,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.mon_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_m,
      CASE WHEN rk.c_rfm_freq >= 10 THEN 5
           WHEN rk.c_rfm_freq >= 6 THEN 4
           WHEN rk.c_rfm_freq >= 3 THEN 3
           WHEN rk.c_rfm_freq >= 2 THEN 2
           ELSE 1 END AS abs_f
    FROM ranked rk
  ),
  blended AS (
    SELECT s.*,
      least(5, greatest(1, least(greatest(s.rel_f, s.abs_f - 1), s.abs_f + 1))) AS s_f
    FROM scored s
  )
  SELECT
    s.c_id, s.c_user_id, s.c_email, s.c_first_name, s.c_last_name, s.c_phone,
    s.c_first_visit_at, s.c_last_visit_at, s.c_total_spent,
    s.c_ticket_count, 0 AS order_count, s.c_table_count,
    s.c_is_banned, s.c_banned_at, s.c_ban_reason, s.c_notes,
    s.c_revenue_30d, s.c_revenue_90d, s.c_revenue_prev_90d, s.c_avg_basket,
    s.c_visit_nights, s.c_visits_per_month,
    s.c_last_activity_at, s.c_preferred_dow, s.c_preferred_event_title,
    s.c_recency_days,
    s.s_r::int, s.s_f::int, s.s_m::int,
    (CASE
      WHEN s.s_r >= 4 AND s.s_f >= 4 THEN 'champions'
      -- « Était régulier, se met en silence » passe AVANT « fidèle » : un
      -- habitué muet depuis trois mois est le client à rappeler ce soir, pas
      -- une ligne rassurante dans le camembert. L'ordre inverse le rangeait en
      -- « Fidèles » et le club ne le voyait jamais partir.
      WHEN s.s_r <= 2 AND s.s_f >= 3 THEN 'at_risk'
      WHEN s.s_f >= 4 THEN 'loyal'
      WHEN s.s_r >= 4 AND s.s_f <= 2 THEN CASE WHEN s.s_m >= 3 THEN 'promising' ELSE 'new' END
      WHEN s.s_r >= 3 THEN 'loyal'
      WHEN s.s_r = 2 THEN 'dormant'
      ELSE 'lost'
    END)::text,
    (CASE
      WHEN s.s_m >= 5 THEN 'platinum'
      WHEN s.s_m >= 4 THEN 'gold'
      WHEN s.s_m >= 2 THEN 'silver'
      ELSE 'bronze'
    END)::text,
    (s.s_f >= 3 AND s.c_recency_days > 45 AND s.c_recency_days <= 180),
    s.c_guest_list_count
  FROM blended s
  ORDER BY s.c_last_visit_at DESC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_page_traffic(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_now       timestamptz := now();
  v_venue     text;
  v_org       uuid;
  v_tz        text := 'Europe/Paris';
  v_days      integer := least(greatest(coalesce(p_days, 90), 7), 365);
  v_from      timestamptz;
  v_day_start timestamptz;
  v_result    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_org := p_organizer_user_id;
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_venue := p_venue_id;
    select coalesce(v.timezone, 'Europe/Paris') into v_tz from public.venues v where v.id = p_venue_id;
    v_tz := coalesce(v_tz, 'Europe/Paris');
  end if;

  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;
  v_from := v_day_start - make_interval(days => v_days - 1);

  with
  page as materialized (
    select s.session_id, coalesce(s.visitor_id::text, s.session_id) as visitor,
           s.visited_at, coalesce(nullif(s.referrer_category, ''), 'direct') as source,
           coalesce(s.is_returning, false) as is_ret,
           coalesce(s.completed_order, false) as ordered
    from public.visitor_sessions s
    where s.visited_at >= v_from
      and ((v_venue is not null and s.venue_id = v_venue and s.entry_page_type = 'venue_page')
        or (v_org is not null and s.organizer_user_id = v_org and s.entry_page_type = 'organizer_profile'))
  ),
  days as (
    select generate_series(
      (v_from at time zone v_tz)::date,
      (v_now at time zone v_tz)::date,
      interval '1 day'
    )::date as d
  ),
  ev as materialized (
    select e.id, e.title, e.start_at
    from public.events e
    where e.cancelled_at is null
      and ((v_venue is not null and (e.venue_id = v_venue or e.partner_venue_id = v_venue or e.id in (select public.cohost_event_ids_venue(v_venue))))
        or (v_org is not null and (e.organizer_user_id = v_org or e.partner_organizer_id = v_org or e.id in (select public.cohost_event_ids_org(v_org)))))
  ),
  evs as materialized (
    select s.event_id, s.visited_at, coalesce(s.completed_order, false) as ordered
    from public.visitor_sessions s
    join ev on ev.id = s.event_id
    where s.visited_at >= v_from
  )
  select jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'days', v_days,
    'from', v_from,
    'page', jsonb_build_object(
      'kind', case when v_venue is not null then 'venue' else 'organizer' end,
      'total', (select count(*) from page),
      'today', (select count(*) from page where visited_at >= v_day_start),
      'visitors', (select count(distinct visitor) from page),
      'returning', (select count(*) from page where is_ret),
      'ordered', (select count(*) from page where ordered),
      -- Une seule passe sur les visites, regroupées par jour, puis collées
      -- aux jours de la période (un count par jour relisait toute la page
      -- 90 fois : 2,3 s sur 35 000 sessions).
      'series', (
        select jsonb_agg(jsonb_build_object(
                 'date', to_char(d.d, 'YYYY-MM-DD'),
                 'visits', coalesce(c.n, 0)
               ) order by d.d)
        from days d
        left join (
          select (p.visited_at at time zone v_tz)::date as d, count(*) as n
          from page p group by 1
        ) c on c.d = d.d
      ),
      'sources', coalesce((
        select jsonb_agg(jsonb_build_object('source', x.source, 'visits', x.n, 'ordered', x.o) order by x.n desc)
        from (select source, count(*) as n, count(*) filter (where ordered) as o from page group by source) x
      ), '[]'::jsonb)
    ),
    'events', jsonb_build_object(
      'total', (select count(*) from evs),
      'today', (select count(*) from evs where visited_at >= v_day_start),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', x.id, 'title', x.title, 'startAt', x.start_at,
                 'visits', x.visits, 'today', x.today, 'ordered', x.ordered
               ) order by x.visits desc, x.start_at desc)
        from (
          select ev.id, ev.title, ev.start_at,
                 count(*) as visits,
                 count(*) filter (where evs.visited_at >= v_day_start) as today,
                 count(*) filter (where evs.ordered) as ordered
          from evs join ev on ev.id = evs.event_id
          group by ev.id, ev.title, ev.start_at
          order by count(*) desc, ev.start_at desc
          limit 30
        ) x
      ), '[]'::jsonb)
    )
  )
  into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_purchase_behavior(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now       timestamptz := now();
  v_from      timestamptz := coalesce(p_from, '2020-01-01'::timestamptz);
  v_to        timestamptz := coalesce(p_to, now());
  v_tz        text := 'Europe/Paris';
  v_event_ids uuid[];
  v_drinks    boolean := p_venue_id is not null;
  v_result    jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
      or public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'view_finance')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.can_manage_venue(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ── Portée : les soirées du club / de l'organisateur ────────────────────
  select coalesce(array_agg(e.id), '{}')
    into v_event_ids
  from public.events e
  where (p_venue_id is not null and e.venue_id = p_venue_id)
     or (p_organizer_user_id is not null
         and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))));

  if p_venue_id is not null then
    select coalesce(v.timezone, 'Europe/Paris') into v_tz
    from public.venues v where v.id = p_venue_id;
    v_tz := coalesce(v_tz, 'Europe/Paris');
  end if;

  with
  ev as materialized (
    select e.id, e.start_at, e.end_at
    from public.events e
    where e.id = any(v_event_ids)
  ),

  -- ── Toutes les ventes de la période, une ligne par transaction ─────────
  tx as materialized (
    select 'tickets'::text as pillar,
           t.id,
           lower(t.user_email) as buyer,
           t.event_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           ev.start_at, ev.end_at,
           greatest(coalesce(t.quantity, 1), 1) as units,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount,
           coalesce(t.is_guest, false) as is_guest,
           coalesce(nullif(t.purchase_source, ''), 'direct') as source,
           t.tracked_link_id is not null as tracked,
           coalesce(t.has_insurance, false) as insurance,
           t.drink_id is not null as bundled_drink,
           coalesce(t.drink_redeemed, false) as drink_redeemed,
           coalesce(t.is_upgrade, false) as upgrade,
           coalesce(t.is_loyalty_reward, false) as loyalty,
           coalesce(t.newsletter_opt_in, false) as newsletter,
           coalesce(t.sms_opt_in, false) as sms,
           t.ticket_round_id as round_id,
           (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used') as scanned,
           t.entry_scanned_at as scanned_at,
           null::integer as guests,
           null::integer as items,
           false as deposit_only,
           false as on_site
    from public.tickets t
    join ev on ev.id = t.event_id
    where t.status in ('paid', 'used')
      and coalesce(t.paid_at, t.created_at) >= v_from
      and coalesce(t.paid_at, t.created_at) < v_to

    union all

    select 'tables',
           r.id,
           lower(r.user_email),
           r.event_id,
           coalesce(r.paid_at, r.created_at),
           ev.start_at, ev.end_at,
           1,
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)),
           coalesce(r.is_guest, false),
           coalesce(nullif(r.purchase_source, ''), 'direct'),
           r.tracked_link_id is not null,
           false, false, false, false, false,
           coalesce(r.newsletter_opt_in, false),
           coalesce(r.sms_opt_in, false),
           null::uuid,
           (coalesce(r.entry_scanned, false) or r.checked_in_at is not null),
           coalesce(r.entry_scanned_at, r.checked_in_at),
           greatest(coalesce(r.guest_count, 0), 0),
           null::integer,
           (coalesce(r.deposit, 0) > 0 and coalesce(r.deposit, 0) < r.total_price),
           coalesce(r.payment_mode, 'online') = 'on_site'
    from public.table_reservations r
    join ev on ev.id = r.event_id
    where r.status in ('paid', 'confirmed')
      and coalesce(r.paid_at, r.created_at) >= v_from
      and coalesce(r.paid_at, r.created_at) < v_to

    union all

    select 'drinks',
           o.id,
           coalesce(lower(o.user_email), o.user_id::text, o.id::text),
           o.event_id,
           coalesce(o.paid_at, o.created_at),
           ev.start_at, ev.end_at,
           1,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)),
           coalesce(o.is_guest, false),
           coalesce(nullif(o.purchase_source, ''), 'direct'),
           o.tracked_link_id is not null,
           false, false, false, false, false, false, false,
           null::uuid,
           false,
           null::timestamptz,
           null::integer,
           (select coalesce(sum(case when (i->>'qty') ~ '^[0-9]+$' then (i->>'qty')::integer else 1 end), 0)::integer
              from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) i),
           false, false
    from public.orders o
    left join ev on ev.id = o.event_id
    where v_drinks
      and o.venue_id = p_venue_id
      and o.status in ('paid', 'served')
      and coalesce(o.paid_at, o.created_at) >= v_from
      and coalesce(o.paid_at, o.created_at) < v_to
  ),

  -- Achats à l'avance (billets + tables) : ceux qui ont un « avant la soirée ».
  pre as materialized (
    select tx.*,
           extract(epoch from (tx.start_at - tx.at_ts)) / 3600.0 as lead_h,
           case
             when tx.at_ts >= tx.start_at then 'after_start'
             when tx.start_at - tx.at_ts < interval '24 hours' then 'h24'
             when tx.start_at - tx.at_ts < interval '4 days' then 'd1_3'
             when tx.start_at - tx.at_ts < interval '8 days' then 'd4_7'
             when tx.start_at - tx.at_ts < interval '15 days' then 'd8_14'
             when tx.start_at - tx.at_ts < interval '31 days' then 'd15_30'
             else 'd30p'
           end as lead_bucket
    from tx
    where tx.pillar in ('tickets', 'tables') and tx.start_at is not null
  ),

  gl as materialized (
    select gle.id, lower(gle.email) as buyer, gl0.event_id, gle.created_at as at_ts,
           coalesce(gle.entry_scanned, false) as scanned,
           coalesce(gle.newsletter_opt_in, false) as newsletter,
           ev.start_at, ev.end_at
    from public.guest_list_entries gle
    join public.guest_lists gl0 on gl0.id = gle.guest_list_id
    join ev on ev.id = gl0.event_id
    where gle.status <> 'cancelled'
      and gle.created_at >= v_from
      and gle.created_at < v_to
  ),

  -- Acheteurs de la période (payants) et leur historique complet dans la portée.
  buyers as materialized (
    select tx.buyer, sum(tx.amount) as spent, count(*) as tx_count, min(tx.at_ts) as first_in_period
    from tx
    where tx.buyer is not null
    group by tx.buyer
  ),
  hist as materialized (
    select h.buyer, h.night_key, min(h.at_ts) as at_ts
    from (
      select lower(t.user_email) as buyer, t.event_id::text as night_key, coalesce(t.paid_at, t.created_at) as at_ts
      from public.tickets t
      where t.event_id = any(v_event_ids) and t.status in ('paid', 'used')
        and coalesce(t.paid_at, t.created_at) < v_to
      union all
      select lower(r.user_email), r.event_id::text, coalesce(r.paid_at, r.created_at)
      from public.table_reservations r
      where r.event_id = any(v_event_ids) and r.status in ('paid', 'confirmed')
        and coalesce(r.paid_at, r.created_at) < v_to
      union all
      select coalesce(lower(o.user_email), o.user_id::text, o.id::text),
             coalesce(o.event_id::text,
                      to_char((coalesce(o.paid_at, o.created_at) at time zone v_tz) - interval '6 hours', 'YYYY-MM-DD')),
             coalesce(o.paid_at, o.created_at)
      from public.orders o
      where v_drinks and o.venue_id = p_venue_id and o.status in ('paid', 'served')
        and coalesce(o.paid_at, o.created_at) < v_to
      union all
      select lower(gle.email), gl0.event_id::text, gle.created_at
      from public.guest_list_entries gle
      join public.guest_lists gl0 on gl0.id = gle.guest_list_id
      where gl0.event_id = any(v_event_ids) and gle.status <> 'cancelled'
        and gle.created_at < v_to
    ) h
    where h.buyer in (select b.buyer from buyers b)
    group by h.buyer, h.night_key
  ),
  buyer_hist as materialized (
    select h.buyer, count(*) as nights, min(h.at_ts) as first_ever
    from hist h
    group by h.buyer
  ),
  gaps as (
    select extract(epoch from (h.at_ts - lag(h.at_ts) over (partition by h.buyer order by h.at_ts))) / 86400.0 as gap_d
    from hist h
  ),
  ranked as (
    select b.spent,
           row_number() over (order by b.spent desc) as rn,
           count(*) over () as n
    from buyers b
  ),

  -- Paires (client, soirée) — pour les parcours croisés sur une même nuit.
  pairs as materialized (
    select distinct tx.pillar, tx.buyer, tx.event_id, tx.start_at
    from tx
    where tx.pillar in ('tickets', 'tables') and tx.buyer is not null and tx.start_at < v_now
    union
    select 'guestlist', gl.buyer, gl.event_id, gl.start_at
    from gl
    where gl.scanned and gl.buyer is not null and gl.start_at < v_now
  ),
  pairs_x as (
    select p.pillar, p.buyer, p.event_id,
           d.orders as drink_orders, d.amount as drink_amount,
           exists (
             select 1 from public.table_reservations r
             where r.event_id = p.event_id and lower(r.user_email) = p.buyer
               and r.status in ('paid', 'confirmed')
           ) as has_table
    from pairs p
    left join lateral (
      select count(*) as orders,
             sum(greatest(o.total - coalesce(o.service_fee, 0), 0)) as amount
      from public.orders o
      where v_drinks
        and o.event_id = p.event_id
        and lower(o.user_email) = p.buyer
        and o.status in ('paid', 'served')
    ) d on true
  ),

  -- Soirées terminées où la porte a scanné au moins une entrée.
  scanned_events as materialized (
    select ev.id
    from ev
    where ev.end_at < v_now
      and (
        exists (select 1 from public.tickets t where t.event_id = ev.id
                  and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
        or exists (select 1 from public.guest_list_entries gle
                     join public.guest_lists gl0 on gl0.id = gle.guest_list_id
                     where gl0.event_id = ev.id and coalesce(gle.entry_scanned, false))
        or exists (select 1 from public.table_reservations r where r.event_id = ev.id
                     and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
      )
  ),

  vs as materialized (
    select s.device_type, s.referrer_category, s.is_returning, s.visit_number,
           coalesce(s.added_to_cart, false) as cart,
           coalesce(s.proceeded_to_checkout, false) as checkout,
           coalesce(s.completed_order, false) as done,
           s.duration_seconds, s.cart_value_cents
    from public.visitor_sessions s
    where s.visited_at >= v_from and s.visited_at < v_to
      and (
           (p_venue_id is not null and s.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
        or s.event_id = any(v_event_ids)
      )
  )

  select jsonb_build_object(
    'ok', true,
    'tz', v_tz,
    'hasDrinks', v_drinks,
    'from', v_from,
    'to', v_to,

    -- ── Vue d'ensemble ───────────────────────────────────────────────────
    'summary', (
      select jsonb_build_object(
        'transactions', (select count(*) from tx),
        'buyers', (select count(*) from buyers),
        'amount', coalesce((select sum(amount) from tx), 0),
        'avgBasket', coalesce((select avg(amount) from tx where amount > 0), 0),
        'avgPerBuyer', coalesce((select avg(spent) from buyers), 0),
        'avgTxPerBuyer', coalesce((select avg(tx_count) from buyers), 0),
        'repeatBuyers', (select count(*) from buyer_hist where nights >= 2),
        'newBuyers', (select count(*) from buyer_hist where first_ever >= v_from),
        'medianLeadHours', (select percentile_cont(0.5) within group (order by lead_h) from pre where lead_h > 0),
        'guestCheckouts', (select count(*) from tx where is_guest),
        'guestlist', (select count(*) from gl),
        'guestlistScanned', (select count(*) from gl where scanned)
      )
    ),

    'pillars', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pillar', p.pillar, 'transactions', p.n, 'units', p.units,
        'buyers', p.buyers, 'amount', p.amount, 'avgBasket', p.avg_basket
      ) order by p.amount desc)
      from (
        select pillar, count(*) as n, sum(units) as units, count(distinct buyer) as buyers,
               sum(amount) as amount, avg(amount) as avg_basket
        from tx group by pillar
      ) p
    ), '[]'::jsonb),

    -- ── Quand achètent-ils ? ──────────────────────────────────────────────
    'leadTime', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucket', b.bucket,
        'tickets', coalesce(c.tickets, 0), 'tables', coalesce(c.tables, 0),
        'ticketUnits', coalesce(c.ticket_units, 0), 'amount', coalesce(c.amount, 0)
      ) order by b.ord)
      from (values ('d30p', 1), ('d15_30', 2), ('d8_14', 3), ('d4_7', 4), ('d1_3', 5), ('h24', 6), ('after_start', 7)) b(bucket, ord)
      left join (
        select lead_bucket,
               count(*) filter (where pillar = 'tickets') as tickets,
               count(*) filter (where pillar = 'tables') as tables,
               sum(units) filter (where pillar = 'tickets') as ticket_units,
               sum(amount) as amount
        from pre group by lead_bucket
      ) c on c.lead_bucket = b.bucket
    ), '[]'::jsonb),

    'leadMedian', jsonb_build_object(
      'tickets', (select percentile_cont(0.5) within group (order by lead_h) from pre where pillar = 'tickets' and lead_h > 0),
      'tables', (select percentile_cont(0.5) within group (order by lead_h) from pre where pillar = 'tables' and lead_h > 0)
    ),

    -- Jour × heure de l'achat, dans le fuseau du club (lundi = 0).
    'heatmap', coalesce((
      select jsonb_agg(jsonb_build_array(h.pillar, h.dow, h.hr, h.n))
      from (
        select pillar,
               (extract(isodow from (at_ts at time zone v_tz))::integer - 1) as dow,
               extract(hour from (at_ts at time zone v_tz))::integer as hr,
               count(*) as n
        from tx
        group by 1, 2, 3
      ) h
    ), '[]'::jsonb),

    -- Boissons : à quelle heure de la nuit (heures écoulées depuis l'ouverture).
    'nightDrinks', coalesce((
      select jsonb_agg(jsonb_build_object('h', d.h, 'orders', d.n, 'amount', d.amount) order by d.h)
      from (
        select greatest(-1, least(8, floor(extract(epoch from (at_ts - start_at)) / 3600.0)::integer)) as h,
               count(*) as n, sum(amount) as amount
        from tx
        where pillar = 'drinks' and start_at is not null
        group by 1
      ) d
    ), '[]'::jsonb),

    'drinkRhythm', (
      select jsonb_build_object(
        'drinkersPerNight', count(*),
        'avgOrdersPerNight', avg(x.n),
        'avgSpendPerNight', avg(x.amount),
        'multiOrderShare', case when count(*) > 0 then (count(*) filter (where x.n >= 2))::numeric / count(*) else null end,
        'medianMinutesEntryToFirstDrink', (
          select percentile_cont(0.5) within group (order by m.mins)
          from (
            select extract(epoch from (min(d.at_ts) - min(t.scanned_at))) / 60.0 as mins
            from tx d
            join tx t on t.pillar = 'tickets' and t.buyer = d.buyer and t.event_id = d.event_id
                     and t.scanned_at is not null
            where d.pillar = 'drinks' and d.event_id is not null
            group by d.buyer, d.event_id
          ) m
          where m.mins between 0 and 600
        )
      )
      from (
        select buyer, event_id, count(*) as n, sum(amount) as amount
        from tx
        where pillar = 'drinks' and event_id is not null
        group by buyer, event_id
      ) x
    ),

    -- ── Combien achètent-ils ? ────────────────────────────────────────────
    'groupSize', jsonb_build_object(
      'tickets', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(c.n, 0), 'units', coalesce(c.units, 0)) order by b.ord)
        from (values ('1', 1), ('2', 2), ('3_4', 3), ('5p', 4)) b(bucket, ord)
        left join (
          select case when units = 1 then '1' when units = 2 then '2' when units <= 4 then '3_4' else '5p' end as bucket,
                 count(*) as n, sum(units) as units
          from tx where pillar = 'tickets' group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'avgTicketsPerOrder', (select avg(units) from tx where pillar = 'tickets'),
      'tables', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(c.n, 0)) order by b.ord)
        from (values ('1_4', 1), ('5_8', 2), ('9_12', 3), ('13p', 4)) b(bucket, ord)
        left join (
          select case when guests <= 4 then '1_4' when guests <= 8 then '5_8' when guests <= 12 then '9_12' else '13p' end as bucket,
                 count(*) as n
          from tx where pillar = 'tables' and guests > 0 group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'avgGuestsPerTable', (select avg(guests) from tx where pillar = 'tables' and guests > 0),
      'avgPerHead', (select sum(amount) / nullif(sum(guests), 0) from tx where pillar = 'tables' and guests > 0),
      'drinks', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(c.n, 0)) order by b.ord)
        from (values ('1', 1), ('2', 2), ('3_4', 3), ('5p', 4)) b(bucket, ord)
        left join (
          select case when items <= 1 then '1' when items = 2 then '2' when items <= 4 then '3_4' else '5p' end as bucket,
                 count(*) as n
          from tx where pillar = 'drinks' group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'avgItemsPerOrder', (select avg(items) from tx where pillar = 'drinks' and items > 0)
    ),

    'basketBands', coalesce((
      select jsonb_agg(jsonb_build_object('pillar', c.pillar, 'band', c.band, 'n', c.n))
      from (
        select pillar,
               case when amount < 15 then 'b0_15' when amount < 30 then 'b15_30' when amount < 60 then 'b30_60'
                    when amount < 120 then 'b60_120' when amount < 300 then 'b120_300' else 'b300p' end as band,
               count(*) as n
        from tx where amount > 0
        group by 1, 2
      ) c
    ), '[]'::jsonb),

    -- Palier de prix auquel les billets partent (1er palier = le moins cher publié).
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object('rank', r.rnk, 'units', r.units, 'amount', r.amount) order by r.rnk)
      from (
        select least(rk.rnk, 3) as rnk, sum(t.units) as units, sum(t.amount) as amount
        from tx t
        join (
          select tr.id, dense_rank() over (partition by tr.event_id order by tr.position, tr.price) as rnk
          from public.ticket_rounds tr
          where tr.event_id = any(v_event_ids)
        ) rk on rk.id = t.round_id
        where t.pillar = 'tickets'
        group by 1
      ) r
    ), '[]'::jsonb),

    -- ── Ce qu'ils prennent en plus ────────────────────────────────────────
    'attach', (
      select jsonb_build_object(
        'ticketOrders', count(*) filter (where pillar = 'tickets'),
        'insurance', count(*) filter (where pillar = 'tickets' and insurance),
        'bundledDrink', count(*) filter (where pillar = 'tickets' and bundled_drink),
        'bundledDrinkRedeemed', count(*) filter (where pillar = 'tickets' and bundled_drink and drink_redeemed),
        'upgrades', count(*) filter (where pillar = 'tickets' and upgrade),
        'loyaltyRewards', count(*) filter (where pillar = 'tickets' and loyalty),
        'optinBase', count(*) filter (where pillar in ('tickets', 'tables')),
        'newsletter', count(*) filter (where pillar in ('tickets', 'tables') and newsletter),
        'sms', count(*) filter (where pillar in ('tickets', 'tables') and sms),
        'tableOrders', count(*) filter (where pillar = 'tables'),
        'tableDeposit', count(*) filter (where pillar = 'tables' and deposit_only),
        'tableOnSite', count(*) filter (where pillar = 'tables' and on_site)
      )
      from tx
    ),

    -- ── Qui achète ? ─────────────────────────────────────────────────────
    'loyalty', jsonb_build_object(
      'frequency', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'buyers', coalesce(c.n, 0)) order by b.ord)
        from (values ('1', 1), ('2', 2), ('3_4', 3), ('5p', 4)) b(bucket, ord)
        left join (
          select case when nights <= 1 then '1' when nights = 2 then '2' when nights <= 4 then '3_4' else '5p' end as bucket,
                 count(*) as n
          from buyer_hist group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'medianDaysBetween', (select percentile_cont(0.5) within group (order by gap_d) from gaps where gap_d > 0.5),
      'top10Share', (
        select case when sum(spent) > 0 then sum(spent) filter (where rn <= greatest(1, ceil(n * 0.1))) / sum(spent) else null end
        from ranked
      ),
      'newAmount', coalesce((select sum(b.spent) from buyers b join buyer_hist h on h.buyer = b.buyer where h.first_ever >= v_from), 0),
      'returningAmount', coalesce((select sum(b.spent) from buyers b join buyer_hist h on h.buyer = b.buyer where h.first_ever < v_from), 0)
    ),

    -- Même nuit : billet → bar, table → bar, guest list → bar, billet → table.
    'crossSell', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pillar', c.pillar, 'pairs', c.pairs, 'withDrinks', c.with_drinks,
        'drinkSpend', c.drink_spend, 'withTable', c.with_table
      ))
      from (
        select pillar, count(*) as pairs,
               count(*) filter (where coalesce(drink_orders, 0) > 0) as with_drinks,
               avg(drink_amount) filter (where coalesce(drink_orders, 0) > 0) as drink_spend,
               count(*) filter (where pillar <> 'tables' and has_table) as with_table
        from pairs_x
        group by pillar
      ) c
    ), '[]'::jsonb),

    -- ── Par quel canal ? ─────────────────────────────────────────────────
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('source', c.source, 'n', c.n, 'amount', c.amount) order by c.n desc)
      from (
        select case when source in ('venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct') then source
                    when source in ('manual', 'manual_open') then 'manual'
                    else 'other' end as source,
               count(*) as n, sum(amount) as amount
        from tx where pillar in ('tickets', 'tables')
        group by 1
      ) c
    ), '[]'::jsonb),
    'trackedShare', (
      select case when count(*) > 0 then (count(*) filter (where tracked))::numeric / count(*) else null end
      from tx where pillar in ('tickets', 'tables')
    ),

    -- ── Passage à l'achat (visites consenties) ───────────────────────────
    'funnel', (
      select jsonb_build_object(
        'sessions', count(*),
        'carts', count(*) filter (where cart),
        'checkouts', count(*) filter (where checkout),
        'orders', count(*) filter (where done),
        'abandonedCarts', count(*) filter (where cart and not done),
        'abandonedValue', coalesce(sum(cart_value_cents) filter (where cart and not done), 0) / 100.0,
        'medianVisitAtPurchase', percentile_cont(0.5) within group (order by visit_number) filter (where done and visit_number > 0),
        'medianDurationBuyers', percentile_cont(0.5) within group (order by duration_seconds) filter (where done and duration_seconds > 0),
        'medianDurationOthers', percentile_cont(0.5) within group (order by duration_seconds) filter (where not done and duration_seconds > 0),
        'newSessions', count(*) filter (where not coalesce(is_returning, false)),
        'newOrders', count(*) filter (where done and not coalesce(is_returning, false)),
        'returningSessions', count(*) filter (where coalesce(is_returning, false)),
        'returningOrders', count(*) filter (where done and coalesce(is_returning, false)),
        'devices', coalesce((
          select jsonb_agg(jsonb_build_object('device', d.device, 'sessions', d.sessions, 'orders', d.orders) order by d.sessions desc)
          from (
            select coalesce(nullif(device_type, ''), 'unknown') as device,
                   count(*) as sessions, count(*) filter (where done) as orders
            from vs group by 1
          ) d
        ), '[]'::jsonb),
        'sources', coalesce((
          select jsonb_agg(jsonb_build_object('source', d.source, 'sessions', d.sessions, 'orders', d.orders) order by d.sessions desc)
          from (
            select coalesce(nullif(referrer_category, ''), 'direct') as source,
                   count(*) as sessions, count(*) filter (where done) as orders
            from vs group by 1
            order by 2 desc
            limit 8
          ) d
        ), '[]'::jsonb)
      )
      from vs
    ),

    -- ── Achat ≠ venue : présence des acheteurs ───────────────────────────
    'attendance', jsonb_build_object(
      'nights', (select count(*) from scanned_events se where se.id in (select event_id from tx union select event_id from gl)),
      'ticketOrders', (select count(*) from tx where pillar = 'tickets' and event_id in (select id from scanned_events)),
      'ticketScanned', (select count(*) from tx where pillar = 'tickets' and scanned and event_id in (select id from scanned_events)),
      'tableOrders', (select count(*) from tx where pillar = 'tables' and event_id in (select id from scanned_events)),
      'tableScanned', (select count(*) from tx where pillar = 'tables' and scanned and event_id in (select id from scanned_events)),
      'guestlist', (select count(*) from gl where event_id in (select id from scanned_events)),
      'guestlistScanned', (select count(*) from gl where scanned and event_id in (select id from scanned_events)),
      'byLead', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'orders', coalesce(c.n, 0), 'scanned', coalesce(c.s, 0)) order by b.ord)
        from (values ('d30p', 1), ('d15_30', 2), ('d8_14', 3), ('d4_7', 4), ('d1_3', 5), ('h24', 6), ('after_start', 7)) b(bucket, ord)
        left join (
          select lead_bucket, count(*) as n, count(*) filter (where scanned) as s
          from pre
          where pillar = 'tickets' and event_id in (select id from scanned_events)
          group by lead_bucket
        ) c on c.lead_bucket = b.bucket
      ), '[]'::jsonb)
    )
  )
  into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_push_campaigns(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filter text DEFAULT 'all'::text, p_event_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_money     boolean := false;
  v_event_ids uuid[];
  v_limit     integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset    integer := greatest(coalesce(p_offset, 0), 0);
  v_result    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    -- Marketing d'une organisation : fondateur ou admin d'équipe (capacité
    -- `marketing` de capabilitiesFor), comme l'envoi.
    if not (v_uid = p_organizer_user_id
            or public.is_super_admin()
            or public.is_org_team_member(v_uid, p_organizer_user_id, 'admin')) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
    select coalesce(array_agg(e.id), '{}') into v_event_ids
    from public.events e
    where e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id));
  elsif p_venue_id is not null then
    if not (public.is_super_admin()
            or public.is_venue_owner(v_uid, p_venue_id)
            or exists (
              select 1 from public.manager_permissions mp
              where mp.user_id = v_uid and mp.venue_id = p_venue_id
                and (coalesce(mp.can_manage_crm, false) or coalesce(mp.can_view_analytics, false))
            )) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
    select coalesce(array_agg(e.id), '{}') into v_event_ids
    from public.events e
    where e.venue_id = p_venue_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with
  scoped as materialized (
    select pc.*
    from public.push_campaigns pc
    where ((p_venue_id is not null and pc.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and pc.organizer_user_id = p_organizer_user_id))
  ),
  filtered as (
    select s.* from scoped s
    where (p_event_id is null or s.event_id = p_event_id)
      and case coalesce(p_filter, 'all')
            when 'manual' then coalesce(s.source, 'manual') <> 'auto'
            when 'auto' then s.source = 'auto'
            when 'scheduled' then s.status = 'scheduled'
            else true end
  ),
  page as materialized (
    select f.* from filtered f
    order by coalesce(f.scheduled_at, f.created_at) desc, f.created_at desc
    limit v_limit offset v_offset
  ),
  -- Ventes de la portée, une ligne par transaction, attribuables par user_id.
  sales as materialized (
    select 'tickets'::text as pillar, t.id, t.user_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount
    from public.tickets t
    where t.event_id = any(v_event_ids) and t.status in ('paid', 'used') and t.user_id is not null
      and coalesce(t.paid_at, t.created_at) > now() - interval '400 days'
    union all
    select 'tables', r.id, r.user_id, coalesce(r.paid_at, r.created_at),
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
    from public.table_reservations r
    where r.event_id = any(v_event_ids) and r.status in ('paid', 'confirmed') and r.user_id is not null
      and coalesce(r.paid_at, r.created_at) > now() - interval '400 days'
    union all
    select 'drinks', o.id, o.user_id, coalesce(o.paid_at, o.created_at),
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
    from public.orders o
    where p_venue_id is not null and o.venue_id = p_venue_id
      and o.status in ('paid', 'served') and o.user_id is not null
      and coalesce(o.paid_at, o.created_at) > now() - interval '400 days'
    union all
    select 'guestlist', g.id, g.user_id, g.created_at, 0
    from public.guest_list_entries g
    join public.guest_lists gl on gl.id = g.guest_list_id
    where gl.event_id = any(v_event_ids) and g.status <> 'cancelled' and g.user_id is not null
      and g.created_at > now() - interval '400 days'
  ),
  -- Premier tap par (campagne, personne) : sur la page ET sur les 30 derniers jours.
  taps as materialized (
    select pce.campaign_id, pce.user_id, min(pce.created_at) as tap_at
    from public.push_campaign_events pce
    where pce.event_type = 'clicked' and pce.user_id is not null
      and (pce.campaign_id in (select id from page)
           or pce.campaign_id in (select id from scoped where created_at >= now() - interval '30 days'))
    group by 1, 2
  ),
  attributed as materialized (
    select t.campaign_id, s.pillar, s.id as sale_id, s.user_id, s.amount
    from taps t
    join sales s on s.user_id = t.user_id
                and s.at_ts >= t.tap_at and s.at_ts < t.tap_at + interval '72 hours'
  )
  select jsonb_build_object(
    'ok', true,
    'money', v_money,
    'total', (select count(*) from filtered),
    'limit', v_limit,
    'offset', v_offset,
    'summary', (
      select jsonb_build_object(
        'campaigns', count(*),
        'sent', coalesce(sum(sc.sent_count), 0),
        'taps', (select count(*) from taps t where t.campaign_id in (select id from scoped where created_at >= now() - interval '30 days')),
        'buyers', (select count(distinct a.user_id) from attributed a
                   where a.pillar <> 'guestlist' and a.campaign_id in (select id from scoped where created_at >= now() - interval '30 days')),
        'revenue', case when v_money then round(coalesce((
                     select sum(d.amount) from (
                       select distinct a.sale_id, a.amount from attributed a
                       where a.campaign_id in (select id from scoped where created_at >= now() - interval '30 days')
                     ) d), 0)::numeric, 2) else null end
      )
      from scoped sc
      where sc.created_at >= now() - interval '30 days' and sc.status <> 'scheduled'
    ),
    'followers', (
      with f as (
        select fv.user_id, fv.created_at
        from public.favorites fv
        where p_venue_id is not null and fv.favorite_type = 'club' and fv.venue_id = p_venue_id
        union
        select opf.user_id, opf.created_at
        from public.organizer_profile_followers opf
        where p_organizer_user_id is not null and opf.organizer_user_id = p_organizer_user_id
      )
      select jsonb_build_object(
        'total', count(distinct f.user_id),
        'reachable', count(distinct f.user_id) filter (where exists (
          select 1 from public.push_subscriptions ps where ps.user_id = f.user_id and ps.platform = 'ios')),
        'new30d', count(distinct f.user_id) filter (where f.created_at >= now() - interval '30 days')
      ) from f
    ),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'title', p.title,
               'body', p.body,
               'templateKey', p.template_key,
               'source', coalesce(p.source, 'manual'),
               'status', p.status,
               'createdAt', p.created_at,
               'scheduledAt', p.scheduled_at,
               'eventId', p.event_id,
               'eventTitle', e.title,
               'targeted', coalesce(p.targeted_count, 0),
               'sent', coalesce(p.sent_count, 0),
               'failed', coalesce(p.failed_count, 0),
               'taps', coalesce((select count(*) from taps t where t.campaign_id = p.id), 0),
               'buyers', coalesce((select count(distinct a.user_id) from attributed a where a.campaign_id = p.id and a.pillar <> 'guestlist'), 0),
               'orders', coalesce((select count(*) from attributed a where a.campaign_id = p.id and a.pillar <> 'guestlist'), 0),
               'entries', coalesce((select count(*) from attributed a where a.campaign_id = p.id and a.pillar = 'guestlist'), 0),
               'revenue', case when v_money then round(coalesce((select sum(a.amount) from attributed a where a.campaign_id = p.id), 0)::numeric, 2) else null end
             ) order by coalesce(p.scheduled_at, p.created_at) desc, p.created_at desc)
      from page p
      left join public.events e on e.id = p.event_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_push_center(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid       uuid := auth.uid();
  v_money     boolean := false;
  v_party     text;
  v_event_ids uuid[];
  v_days      integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 120);
  v_from      timestamptz;
  v_result    jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  v_from := now() - make_interval(days => v_days);

  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT (v_uid = p_organizer_user_id OR public.is_super_admin()
            OR public.is_org_team_member(v_uid, p_organizer_user_id, 'admin')) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    v_money := v_uid = p_organizer_user_id OR public.is_super_admin()
      OR public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
    v_party := 'org:' || p_organizer_user_id::text;
    SELECT COALESCE(array_agg(e.id), '{}') INTO v_event_ids
      FROM public.events e
     WHERE e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id
        OR e.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id));
  ELSIF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_super_admin() OR public.is_venue_owner(v_uid, p_venue_id)
            OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                        WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                          AND (COALESCE(mp.can_manage_crm, false) OR COALESCE(mp.can_view_analytics, false)))) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    v_money := public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = v_uid)
      OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                  WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                    AND (COALESCE(mp.can_view_analytics, false) OR COALESCE(mp.can_view_finance, false)));
    v_party := 'venue:' || p_venue_id;
    SELECT COALESCE(array_agg(e.id), '{}') INTO v_event_ids
      FROM public.events e
     WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
        OR e.id IN (SELECT public.cohost_event_ids_venue(p_venue_id));
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  WITH
  ev AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, COALESCE(e.poster_url, e.image_url) AS image, e.published_at,
           COALESCE(e.visibility::text, 'public') AS visibility
      FROM public.events e
     WHERE e.id = ANY (v_event_ids) AND e.cancelled_at IS NULL
       AND e.start_at >= v_from AND e.start_at < now() + interval '180 days'
  ),
  camp AS MATERIALIZED (
    SELECT pc.id, pc.event_id, pc.created_at, COALESCE(pc.sent_count, 0) AS sent_count,
           CASE pc.template_key
             WHEN 'almost_sold_out' THEN 'last_tickets' WHEN 'thank_you' THEN 'after_thanks'
             WHEN 'reminder_day_of' THEN 'event_day_reminder' WHEN 'drinks_preorder' THEN 'event_day_reminder'
             WHEN 'event_live' THEN 'doors_open' ELSE pc.template_key END AS rule
      FROM public.push_campaigns pc
     WHERE pc.source = 'auto' AND pc.event_id IN (SELECT ev.id FROM ev)
  ),
  recv AS MATERIALIZED (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS at
      FROM public.push_campaign_events pce
     WHERE pce.event_type = 'sent' AND pce.campaign_id IN (SELECT camp.id FROM camp)
     GROUP BY 1, 2
  ),
  taps AS MATERIALIZED (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS at
      FROM public.push_campaign_events pce
     WHERE pce.event_type = 'clicked' AND pce.campaign_id IN (SELECT camp.id FROM camp)
     GROUP BY 1, 2
  ),
  sales AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, t.id, t.user_id, t.event_id, COALESCE(t.paid_at, t.created_at) AS at,
           GREATEST(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - LEAST(GREATEST(COALESCE(t.refund_amount, 0), 0),
                     GREATEST(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t
     WHERE t.event_id IN (SELECT ev.id FROM ev) AND t.status IN ('paid', 'used') AND t.user_id IS NOT NULL
    UNION ALL
    SELECT 'tables', r.id, r.user_id, r.event_id, COALESCE(r.paid_at, r.created_at),
           GREATEST(r.total_price - COALESCE(r.service_fee, 0)
                    - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0),
                     GREATEST(r.total_price - COALESCE(r.service_fee, 0)
                              - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT ev.id FROM ev) AND r.status IN ('paid', 'confirmed') AND r.user_id IS NOT NULL
    UNION ALL
    SELECT 'guestlist', g.id, g.user_id, gl.event_id, g.created_at, 0
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id IN (SELECT ev.id FROM ev) AND g.status <> 'cancelled' AND g.user_id IS NOT NULL
  ),
  touch AS MATERIALIZED (
    SELECT DISTINCT ON (s.pillar, s.id) s.pillar, s.id AS sale_id, s.user_id, s.event_id, s.amount,
           c.rule, tp.campaign_id
      FROM sales s
      JOIN taps tp ON tp.user_id = s.user_id
      JOIN camp c ON c.id = tp.campaign_id AND c.event_id = s.event_id
     WHERE s.at >= tp.at AND s.at < tp.at + interval '72 hours'
     ORDER BY s.pillar, s.id, tp.at DESC
  ),
  infl AS MATERIALIZED (
    SELECT DISTINCT rv.campaign_id, rv.user_id
      FROM recv rv
      JOIN camp c ON c.id = rv.campaign_id
      JOIN sales s ON s.user_id = rv.user_id AND s.event_id = c.event_id AND s.pillar <> 'guestlist'
     WHERE s.at >= rv.at AND s.at < rv.at + interval '72 hours'
  ),
  cand AS MATERIALIZED (
    SELECT c.rule_key, c.event_id, c.status, COALESCE(c.hold_reason, '') AS hold, c.reason_party,
           c.user_id, c.campaign_id, c.not_before
      FROM public.push_candidates c
     WHERE c.event_id IN (SELECT ev.id FROM ev)
  ),
  per_camp AS MATERIALIZED (
    SELECT c.id, c.event_id, c.rule, c.created_at, c.sent_count,
           (SELECT count(*) FROM taps t WHERE t.campaign_id = c.id) AS taps,
           (SELECT count(DISTINCT t.user_id) FROM touch t WHERE t.campaign_id = c.id AND t.pillar <> 'guestlist') AS buyers,
           (SELECT count(*) FROM touch t WHERE t.campaign_id = c.id AND t.pillar = 'guestlist') AS entries,
           (SELECT COALESCE(sum(t.amount), 0) FROM touch t WHERE t.campaign_id = c.id) AS revenue,
           (SELECT count(*) FROM infl i WHERE i.campaign_id = c.id) AS influenced
      FROM camp c
  ),
  steps AS MATERIALIZED (
    SELECT k.event_id, k.rule,
           COALESCE(sum(pc.sent_count), 0) AS sent,
           COALESCE(sum(pc.taps), 0) AS taps,
           COALESCE(sum(pc.buyers), 0) AS buyers,
           COALESCE(sum(pc.entries), 0) AS entries,
           COALESCE(sum(pc.revenue), 0) AS revenue,
           COALESCE(sum(pc.influenced), 0) AS influenced,
           max(pc.created_at) AS last_at,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status IN ('pending', 'claimed')) AS queued,
           (SELECT min(x.not_before) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status = 'pending') AS next_at,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status IN ('skipped', 'expired')
               AND x.hold IN ('daily_cap', 'weekly_cap', 'fatigue', 'quiet_hours', 'event_budget',
                                  'lower_priority', 'awaiting_announcement', 'window_passed')) AS held,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.hold = 'already_bought') AS bought_before
      FROM (SELECT DISTINCT camp.event_id, camp.rule FROM camp
            UNION SELECT DISTINCT cand.event_id, cand.rule_key FROM cand) k
      LEFT JOIN per_camp pc ON pc.event_id = k.event_id AND pc.rule = k.rule
     GROUP BY k.event_id, k.rule
  ),
  mine AS MATERIALIZED (
    SELECT x.user_id, x.campaign_id FROM cand x WHERE x.status = 'sent' AND x.reason_party = v_party
  ),
  disc AS (
    SELECT count(*) AS selections, count(DISTINCT ds.user_id) AS people,
           count(*) FILTER (WHERE ds.opened_at IS NOT NULL) AS opened
      FROM public.discovery_selections ds
     WHERE ds.created_at >= v_from AND ds.event_ids && v_event_ids
  ),
  evj AS (
    SELECT e.*, ps.announce_at,
           (SELECT count(*) FROM public.event_parties(e.id)) AS parties,
           EXISTS (SELECT 1 FROM steps st WHERE st.event_id = e.id AND st.rule = 'new_event' AND st.sent > 0) AS announced,
           (e.start_at > now() + interval '3 hours'
            AND e.visibility = 'public'
            AND NOT EXISTS (SELECT 1 FROM steps st WHERE st.event_id = e.id AND st.rule = 'new_event' AND st.sent > 0)
            AND (public.is_super_admin() OR EXISTS (
                  SELECT 1 FROM public.event_parties(e.id) p
                   WHERE p.role IN ('lead', 'partner') AND public.coorg_party_level(v_uid, p.party_key) >= 2))) AS can_schedule
      FROM ev e
      LEFT JOIN public.push_event_settings ps ON ps.event_id = e.id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'money', v_money,
    'days', v_days,
    'party', v_party,
    'summary', jsonb_build_object(
      'sent',       (SELECT COALESCE(sum(pc.sent_count), 0) FROM per_camp pc),
      'people',     (SELECT count(DISTINCT rv.user_id) FROM recv rv),
      'taps',       (SELECT count(*) FROM taps),
      'buyers',     (SELECT count(DISTINCT t.user_id) FROM touch t WHERE t.pillar <> 'guestlist'),
      'entries',    (SELECT count(*) FROM touch t WHERE t.pillar = 'guestlist'),
      'influenced', (SELECT count(DISTINCT i.user_id) FROM infl i),
      'revenue',    CASE WHEN v_money THEN round((SELECT COALESCE(sum(t.amount), 0) FROM touch t)::numeric, 2) END,
      'held',       (SELECT COALESCE(sum(st.held), 0) FROM steps st),
      'boughtBefore', (SELECT COALESCE(sum(st.bought_before), 0) FROM steps st),
      'queued',     (SELECT COALESCE(sum(st.queued), 0) FROM steps st)
    ),
    'viaMe', jsonb_build_object(
      'multiParty', EXISTS (SELECT 1 FROM evj WHERE evj.parties > 1),
      'sent',  (SELECT count(*) FROM mine),
      'taps',  (SELECT count(*) FROM mine m JOIN taps t ON t.campaign_id = m.campaign_id AND t.user_id = m.user_id),
      'buyers', (SELECT count(DISTINCT m.user_id) FROM mine m
                   JOIN touch t ON t.campaign_id = m.campaign_id AND t.user_id = m.user_id AND t.pillar <> 'guestlist')
    ),
    'rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key', s.notification_key, 'enabled', s.enabled, 'params', s.params,
               'sent',    (SELECT COALESCE(sum(st.sent), 0) FROM steps st WHERE st.rule = s.notification_key),
               'taps',    (SELECT COALESCE(sum(st.taps), 0) FROM steps st WHERE st.rule = s.notification_key),
               'buyers',  (SELECT COALESCE(sum(st.buyers), 0) FROM steps st WHERE st.rule = s.notification_key),
               'revenue', CASE WHEN v_money THEN round((SELECT COALESCE(sum(st.revenue), 0) FROM steps st WHERE st.rule = s.notification_key)::numeric, 2) END,
               'held',    (SELECT COALESCE(sum(st.held), 0) FROM steps st WHERE st.rule = s.notification_key),
               'queued',  (SELECT COALESCE(sum(st.queued), 0) FROM steps st WHERE st.rule = s.notification_key)
             ) ORDER BY s.notification_key)
        FROM public.platform_notification_settings s WHERE s.category = 'event_engine'
    ), '[]'::jsonb),
    'discovery', (SELECT jsonb_build_object('selections', d.selections, 'people', d.people, 'opened', d.opened) FROM disc d),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'title', e.title, 'startAt', e.start_at, 'image', e.image,
               'publishedAt', e.published_at, 'visibility', e.visibility,
               'upcoming', e.start_at > now(),
               'announceAt', e.announce_at, 'announced', e.announced,
               'canSchedule', e.can_schedule, 'parties', e.parties,
               'steps', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'rule', st.rule, 'sent', st.sent, 'taps', st.taps, 'buyers', st.buyers,
                          'entries', st.entries, 'influenced', st.influenced,
                          'revenue', CASE WHEN v_money THEN round(st.revenue::numeric, 2) END,
                          'queued', st.queued, 'nextAt', st.next_at, 'held', st.held,
                          'boughtBefore', st.bought_before, 'lastAt', st.last_at))
                   FROM steps st WHERE st.event_id = e.id), '[]'::jsonb)
             ) ORDER BY (e.start_at < now()), CASE WHEN e.start_at >= now() THEN e.start_at END ASC, e.start_at DESC)
        FROM (SELECT * FROM evj
               ORDER BY (evj.start_at < now()), CASE WHEN evj.start_at >= now() THEN evj.start_at END ASC, evj.start_at DESC
               LIMIT 30) e
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT 'last4'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_money  boolean := false;
  v_is_org boolean := p_organizer_user_id is not null;
  v_tz     text := 'Europe/Paris';
  v_from   timestamptz;
  v_by_end boolean := false;
  v_limit  integer;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if v_is_org then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
    select coalesce(v.timezone, 'Europe/Paris') into v_tz from public.venues v where v.id = p_venue_id;
  end if;

  -- Périodes en temps (24 h, 48 h, 7 j, 30 j, 90 j) : les soirées TERMINÉES
  -- dont la fin tombe dans la fenêtre ; la période d'avant = le même nombre de
  -- soirées juste avant (règle inchangée : on ne compare qu'à nombre égal).
  v_by_end := p_period in ('d1', 'd2', 'd7', 'd30', 'd90');
  v_from := case p_period
    when 'month' then date_trunc('month', v_now at time zone v_tz) at time zone v_tz
    when 'year'  then date_trunc('year',  v_now at time zone v_tz) at time zone v_tz
    when 'd1'    then v_now - interval '24 hours'
    when 'd2'    then v_now - interval '48 hours'
    when 'd7'    then v_now - interval '7 days'
    when 'd30'   then v_now - interval '30 days'
    when 'd90'   then v_now - interval '90 days'
    else null
  end;
  v_limit := case p_period when 'last' then 1 when 'last4' then 4 else null end;

  with
  -- Toutes les soirées commencées de la portée, de la plus récente à la plus
  -- ancienne ; `rn` numérote cette file.
  scope as materialized (
    select e.id, e.title, e.start_at, coalesce(e.end_at, e.start_at + interval '8 hours') as end_ts, coalesce(e.poster_url, e.image_url) as poster,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           case when v_is_org then v_money else v_money and e.venue_id = p_venue_id end as show_money,
           row_number() over (order by e.start_at desc) as rn
    from public.events e
    -- Soirées TERMINÉES : une soirée en cours (entrées partielles) n'est pas
    -- « la dernière soirée ».
    where coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and e.external_source is null
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
    order by e.start_at desc
    limit 1000
  ),
  cur_n as (
    select count(*)::integer as n from scope s
    where (v_limit is null or s.rn <= v_limit)
      and (v_from is null or (case when v_by_end then s.end_ts else s.start_at end) >= v_from)
  ),
  -- Période courante = les N premières ; précédente = les N suivantes.
  -- « Tout » n'a pas de période précédente.
  nights as materialized (
    select s.*, case when s.rn <= c.n then 'cur' else 'prev' end as bucket
    from scope s cross join cur_n c
    where s.rn <= c.n
       or (p_period <> 'all' and c.n > 0 and s.rn > c.n and s.rn <= 2 * c.n)
  ),

  tk as (
    select t.event_id,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           count(*) as orders,
           sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) as amount,
           sum(case when coalesce(t.total_price, 0) > 0 then round(t.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           sum(greatest(coalesce(t.quantity, 1), 1))
             filter (where coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used') as entered
    from public.tickets t
    join nights n on n.id = t.event_id
    where t.status in ('paid', 'used')
    group by t.event_id
  ),
  tb as (
    select r.event_id,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) as amount,
           sum(case when coalesce(r.payment_mode, 'online') <> 'on_site' and coalesce(r.total_price, 0) > 0
                    then round(r.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           count(*) filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as arrived,
           sum(greatest(coalesce(r.guest_count, 0), 1))
             filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as entered
    from public.table_reservations r
    join nights n on n.id = r.event_id
    where r.status in ('paid', 'confirmed')
    group by r.event_id
  ),
  dr as (
    select o.event_id,
           count(*) as orders,
           sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
               - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) as amount,
           sum(case when coalesce(o.total, 0) > 0 then round(o.total * 0.015 + 0.25, 2) else 0 end) as stripe
    from public.orders o
    join nights n on n.id = o.event_id
    where not v_is_org
      and o.status in ('paid', 'served')
    group by o.event_id
  ),
  gl as (
    select g.event_id,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id
    where e2.status <> 'cancelled'
    group by g.event_id
  ),
  caps as (
    select n.id as event_id,
           -- Même capacité que get_event_report : un palier illimité rend la
           -- jauge sans capacité (pas un remplissage au-delà de 100 %).
           case when coalesce(n.max_tickets, 0) > 0 then n.max_tickets
                when exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id)
                 and not exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id and coalesce(tr.max_tickets, 0) <= 0)
                  then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = n.id)
                else null end as cap
    from nights n
  ),
  -- Personnes distinctes par soirée et par période (tous piliers).
  people as (
    select n.bucket, n.id as event_id, lower(trim(x.email)) as email
    from nights n
    join lateral (
      select t.user_email as email from public.tickets t where t.event_id = n.id and t.status in ('paid', 'used')
      union all
      select r.user_email from public.table_reservations r where r.event_id = n.id and r.status in ('paid', 'confirmed')
      union all
      select o.user_email from public.orders o where not v_is_org and o.event_id = n.id and o.status in ('paid', 'served')
      union all
      select e2.email from public.guest_list_entries e2 join public.guest_lists g on g.id = e2.guest_list_id
       where g.event_id = n.id and e2.status <> 'cancelled'
    ) x on true
    where nullif(trim(x.email), '') is not null
  ),
  per_night as (
    select n.id, n.title, n.start_at, n.poster, n.bucket, n.rn, n.show_money,
           coalesce(tk.sold, 0) as tickets, coalesce(tk.orders, 0) as ticket_orders,
           coalesce(tb.booked, 0) as tables, coalesce(tb.guests, 0) as table_guests, coalesce(tb.arrived, 0) as tables_arrived,
           coalesce(dr.orders, 0) as bar_orders,
           coalesce(gl.registered, 0) as gl_registered, coalesce(gl.entered, 0) as gl_entered,
           coalesce(tk.entered, 0) + coalesce(tb.entered, 0) + coalesce(gl.entered, 0) as entries,
           coalesce(tk.entered, 0) as ticket_entries,
           case when n.show_money then coalesce(tk.amount, 0) else 0 end as rev_tickets,
           case when n.show_money then coalesce(tb.amount, 0) else 0 end as rev_tables,
           case when n.show_money then coalesce(dr.amount, 0) else 0 end as rev_bar,
           case when n.show_money then coalesce(tk.stripe, 0) + coalesce(tb.stripe, 0) + coalesce(dr.stripe, 0) else 0 end as stripe,
           caps.cap,
           (select count(distinct p.email) from people p where p.event_id = n.id) as customers
    from nights n
    left join tk on tk.event_id = n.id
    left join tb on tb.event_id = n.id
    left join dr on dr.event_id = n.id
    left join gl on gl.event_id = n.id
    left join caps on caps.event_id = n.id
  ),
  totals as (
    select b.bucket,
           count(pn.id) as nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar), 0) as revenue,
           coalesce(sum(pn.rev_tickets), 0) as rev_tickets,
           coalesce(sum(pn.rev_tables), 0) as rev_tables,
           coalesce(sum(pn.rev_bar), 0) as rev_bar,
           coalesce(sum(pn.stripe), 0) as stripe,
           coalesce(sum(pn.entries), 0) as entries,
           coalesce(sum(pn.ticket_entries), 0) as ticket_entries,
           coalesce(sum(pn.tickets), 0) as tickets,
           coalesce(sum(pn.ticket_orders), 0) as ticket_orders,
           coalesce(sum(pn.tables), 0) as tables,
           coalesce(sum(pn.table_guests), 0) as table_guests,
           coalesce(sum(pn.tables_arrived), 0) as tables_arrived,
           coalesce(sum(pn.bar_orders), 0) as bar_orders,
           coalesce(sum(pn.gl_registered), 0) as gl_registered,
           coalesce(sum(pn.gl_entered), 0) as gl_entered,
           coalesce(sum(pn.cap) filter (where pn.cap > 0), 0) as ticket_cap,
           coalesce(sum(pn.tickets) filter (where pn.cap > 0), 0) as tickets_with_cap,
           -- Dénominateurs justes (revue du 25/09) : la dépense par tête ne
           -- compte que les soirées dont on voit l'argent ET où la porte a
           -- scanné ; la présence, que les soirées où la porte a scanné (sans
           -- scan, « pas scanné » ne veut pas dire « pas venu ») ; prix moyens
           -- sur les soirées dont on voit l'argent.
           count(pn.id) filter (where pn.show_money) as money_nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar) filter (where pn.show_money and pn.entries > 0), 0) as spend_revenue,
           coalesce(sum(pn.entries) filter (where pn.show_money and pn.entries > 0), 0) as spend_entries,
           coalesce(sum(pn.entries) filter (where pn.entries > 0), 0) as presence_entries,
           coalesce(sum(pn.tickets + pn.table_guests + pn.gl_registered) filter (where pn.entries > 0), 0) as presence_expected,
           coalesce(sum(pn.gl_registered) filter (where pn.gl_entered > 0), 0) as gl_presence_registered,
           coalesce(sum(pn.gl_entered) filter (where pn.gl_entered > 0), 0) as gl_presence_entered,
           coalesce(sum(pn.tables) filter (where pn.tables_arrived > 0), 0) as tables_presence_booked,
           coalesce(sum(pn.tables_arrived) filter (where pn.tables_arrived > 0), 0) as tables_presence_arrived,
           coalesce(sum(pn.tickets) filter (where pn.show_money), 0) as money_tickets,
           coalesce(sum(pn.tables) filter (where pn.show_money), 0) as money_tables,
           coalesce(sum(pn.bar_orders) filter (where pn.show_money), 0) as money_bar_orders,
           (select count(distinct p.email) from people p where p.bucket = b.bucket) as customers
    from (values ('cur'), ('prev')) b(bucket)
    left join per_night pn on pn.bucket = b.bucket
    group by b.bucket
  ),
  -- Détail des piliers, période courante seulement.
  rounds_list as (
    select tr.name,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           sum(case when n.show_money then
               greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
               else 0 end) as amount
    from public.tickets t
    join nights n on n.id = t.event_id and n.bucket = 'cur'
    join public.ticket_rounds tr on tr.id = t.ticket_round_id
    where t.status in ('paid', 'used')
    group by tr.name
    order by 2 desc
    limit 12
  ),
  packs_list as (
    select coalesce(p.name, '—') as name,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(case when n.show_money then
               greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
               else 0 end) as amount
    from public.table_reservations r
    join nights n on n.id = r.event_id and n.bucket = 'cur'
    left join public.table_packs p on p.id = r.pack_id
    where r.status in ('paid', 'confirmed')
    group by 1
    order by 4 desc, 2 desc
    limit 12
  ),
  -- Montant d'un produit = sa part du CA CLUB de la commande (fees.ts : total
  -- − frais Yuno, remboursement déduit), au prorata du prix carte : la somme
  -- des produits retombe exactement sur le CA du bar, jamais au-dessus.
  order_lines as (
    select o.id as order_id,
           it.value ->> 'name' as name,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1) as qty,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1)
             * greatest(coalesce((it.value ->> 'price')::numeric, 0), 0) as gross,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)) as order_net
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur' and n.show_money
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
    where not v_is_org and o.status in ('paid', 'served')
      and nullif(it.value ->> 'name', '') is not null
  ),
  products_list as (
    select l.name,
           sum(l.qty) as qty,
           round(sum(case when t.gross_total > 0 then l.order_net * l.gross / t.gross_total else 0 end), 2) as amount
    from order_lines l
    join (select order_id, sum(gross) as gross_total from order_lines group by 1) t on t.order_id = l.order_id
    group by 1
    order by 2 desc
    limit 10
  ),
  bar_service as (
    select percentile_cont(0.5) within group (
             order by extract(epoch from (o.served_at - coalesce(o.paid_at, o.created_at))) / 60.0
           ) as median_min,
           count(*) as sample
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur'
    where not v_is_org and o.status = 'served' and o.served_at is not null
      and o.served_at > coalesce(o.paid_at, o.created_at)
      and o.served_at < coalesce(o.paid_at, o.created_at) + interval '3 hours'
  ),
  holders_list as (
    select case g.holder_type
             when 'club' then 'club' when 'organizer' then 'organizer' else coalesce(nullif(g.holder_label, ''), g.holder_type)
           end as name,
           g.holder_type as kind,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id and n.bucket = 'cur'
    where e2.status <> 'cancelled'
    group by 1, 2
    order by 3 desc
    limit 12
  ),
  -- Déjà vendu pour les soirées À VENIR (renvoie vers les prochaines soirées).
  upcoming as (
    select count(distinct e.id) as nights,
           coalesce(sum(
             case when (v_is_org and v_money) or (not v_is_org and v_money and e.venue_id = p_venue_id) then x.amount else 0 end
           ), 0) as amount
    from public.events e
    left join lateral (
      select coalesce(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                          - least(greatest(coalesce(t.refund_amount, 0), 0),
                                  greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 0)
           + coalesce((select sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                          - least(greatest(coalesce(r.refund_amount, 0), 0),
                                  greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)))
                       from public.table_reservations r where r.event_id = e.id and r.status in ('paid', 'confirmed')), 0) as amount
      from public.tickets t where t.event_id = e.id and t.status in ('paid', 'used')
    ) x on true
    where e.start_at > v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and e.external_source is null
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
  )
  select jsonb_build_object(
    'ok', true,
    'money', v_money,
    'has_bar', not v_is_org,
    'period', p_period,
    'generated_at', v_now,
    'current', (select to_jsonb(t) - 'bucket' from totals t where t.bucket = 'cur'),
    'previous', case when p_period = 'all' then null
                     -- Une comparaison n'a de sens qu'à nombre de soirées égal.
                     else (select case when t.nights > 0 and t.nights = (select n from cur_n) then to_jsonb(t) - 'bucket' end
                           from totals t where t.bucket = 'prev') end,
    'nights', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pn.id, 'title', pn.title, 'start_at', pn.start_at, 'poster', pn.poster,
               'revenue', case when pn.show_money then pn.rev_tickets + pn.rev_tables + pn.rev_bar end,
               'rev_tickets', case when pn.show_money then pn.rev_tickets end,
               'rev_tables', case when pn.show_money then pn.rev_tables end,
               'rev_bar', case when pn.show_money then pn.rev_bar end,
               'entries', pn.entries, 'customers', pn.customers,
               'tickets', pn.tickets, 'ticket_cap', pn.cap, 'tables', pn.tables,
               'table_guests', pn.table_guests, 'tables_arrived', pn.tables_arrived,
               'bar_orders', pn.bar_orders,
               'gl_registered', pn.gl_registered, 'gl_entered', pn.gl_entered
             ) order by pn.start_at desc)
      from per_night pn where pn.bucket = 'cur'
    ), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'sold', r.sold,
                         'amount', case when v_money then r.amount end)) from rounds_list r), '[]'::jsonb),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'booked', p.booked, 'guests', p.guests,
                        'amount', case when v_money then p.amount end)) from packs_list p), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'qty', p.qty,
                           'amount', case when v_money then p.amount end)) from products_list p), '[]'::jsonb),
    'bar_service_min', (select case when b.sample >= 5 then round(b.median_min::numeric, 1) end from bar_service b),
    'holders', coalesce((select jsonb_agg(jsonb_build_object('name', h.name, 'kind', h.kind,
                          'registered', h.registered, 'entered', h.entered)) from holders_list h), '[]'::jsonb),
    'upcoming', (select jsonb_build_object('nights', u.nights, 'amount', case when v_money then u.amount end) from upcoming u)
  ) into v_result;

  -- Sans l'argent, aucun montant ne sort, même agrégé.
  if not v_money then
    v_result := jsonb_set(v_result, '{current}',
      (v_result -> 'current') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    if v_result -> 'previous' is not null and jsonb_typeof(v_result -> 'previous') = 'object' then
      v_result := jsonb_set(v_result, '{previous}',
        (v_result -> 'previous') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    end if;
  end if;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_period_audience(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT (now() - '7 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g record;
begin
  select * into g from public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  if not g.ok then return jsonb_build_object('ok', false, 'reason', g.reason); end if;

  return (
    with nights as materialized (
      select * from public._sales_period_nights(g.scope_ids, g.scope_venue, g.money, p_from, p_to)
      where bucket = 'cur'
    ),
    tx as materialized (
      select x.email, x.pillar, n.start_at
      from public._sales_period_tx((select coalesce(array_agg(id), '{}') from nights), g.scope_venue) x
      join nights n on n.id = x.event_id
      where x.email is not null and x.pillar in ('tickets', 'tables', 'guestlist')
    ),
    people as (
      select email, min(start_at) as first_at from tx group by email
    ),
    seen_before as (
      select p.email
      from people p
      where exists (select 1 from public.tickets t join public.events e on e.id = t.event_id
                    where e.id = any(g.scope_ids) and e.start_at < p.first_at
                      and t.status in ('paid', 'used') and lower(t.user_email) = p.email)
         or exists (select 1 from public.table_reservations r join public.events e on e.id = r.event_id
                    where e.id = any(g.scope_ids) and e.start_at < p.first_at
                      and r.status in ('paid', 'confirmed') and lower(r.user_email) = p.email)
         or exists (select 1 from public.guest_list_entries gg join public.guest_lists gl on gl.id = gg.guest_list_id
                    join public.events e on e.id = gl.event_id
                    where e.id = any(g.scope_ids) and e.start_at < p.first_at
                      and gg.status <> 'cancelled' and lower(gg.email) = p.email)
    )
    select jsonb_build_object(
      'ok', true,
      'nights', (select count(*) from nights),
      'people', (select count(*) from people),
      'returning', (select count(*) from seen_before),
      'new', (select count(*) from people) - (select count(*) from seen_before),
      'buyers', (select count(distinct email) from tx where pillar in ('tickets', 'tables')),
      'priorEvents', (select count(*) from public.events e
                      where e.id = any(g.scope_ids) and e.cancelled_at is null
                        and e.start_at < coalesce((select min(start_at) from nights), p_from))
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_period_curve(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT (now() - '7 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g record;
begin
  select * into g from public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  if not g.ok then return jsonb_build_object('ok', false, 'reason', g.reason); end if;

  return (
    with nights as materialized (
      select * from public._sales_period_nights(g.scope_ids, g.scope_venue, g.money, p_from, p_to)
    ),
    tx as materialized (
      select x.*, n.bucket, n.show_money,
             (n.start_at at time zone n.tz)::date - (x.at_ts at time zone n.tz)::date as d
      from public._sales_period_tx((select coalesce(array_agg(id), '{}') from nights), g.scope_venue) x
      join nights n on n.id = x.event_id
    ),
    vis as (
      select n.bucket, (n.start_at at time zone n.tz)::date - (s.visited_at at time zone n.tz)::date as d, count(*) as visits
      from public.visitor_sessions s join nights n on n.id = s.event_id
      group by 1, 2
    ),
    day_rows as (
      select bucket, d,
             case when pillar = 'tickets' then units else 0 end as tickets,
             case when pillar = 'tables' then 1 else 0 end as tables,
             case when pillar = 'guestlist' then 1 else 0 end as guests,
             case when show_money and pillar in ('tickets', 'tables', 'drinks') then amount else 0 end as amount,
             0 as visits,
             case when pillar in ('tickets', 'tables', 'guestlist') then heads else 0 end as people
      from tx
      union all
      select bucket, d, 0, 0, 0, 0, visits, 0 from vis
    ),
    series as (
      select bucket, d, sum(tickets) as tickets, sum(tables) as tables, sum(guests) as guests,
             sum(amount) as amount, sum(visits) as visits, sum(people) as people
      from day_rows group by bucket, d
    ),
    per_bucket as (
      select b.bucket,
             (select count(*) from nights n where n.bucket = b.bucket) as nights,
             coalesce((
               select jsonb_agg(jsonb_build_object(
                        'd', s.d, 'tickets', s.tickets, 'tables', s.tables, 'guests', s.guests,
                        'amount', case when g.money then round(s.amount::numeric, 2) else null end,
                        'visits', s.visits, 'people', s.people) order by s.d desc)
               from series s where s.bucket = b.bucket
             ), '[]'::jsonb) as series
      from (values ('cur'), ('prev')) b(bucket)
    )
    select jsonb_build_object(
      'ok', true, 'money', g.money, 'tz', g.tz, 'from', p_from, 'to', p_to,
      'cur', (select jsonb_build_object('nights', nights, 'series', series) from per_bucket where bucket = 'cur'),
      'prev', (select jsonb_build_object('nights', nights, 'series', series) from per_bucket where bucket = 'prev')
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_period_drivers(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT (now() - '7 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g record;
begin
  select * into g from public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  if not g.ok then return jsonb_build_object('ok', false, 'reason', g.reason); end if;

  return (
    with nights as materialized (
      select * from public._sales_period_nights(g.scope_ids, g.scope_venue, g.money, p_from, p_to)
      where bucket = 'cur'
    ),
    tx as materialized (
      select x.*, case when n.show_money then x.amount else 0 end as money_amount
      from public._sales_period_tx((select coalesce(array_agg(id), '{}') from nights), g.scope_venue) x
      join nights n on n.id = x.event_id
    ),
    emails as (
      select ec.id, coalesce(nullif(ec.subject, ''), ec.name) as title, ec.sent_at,
             coalesce(ec.recipients_count, ec.total_recipients, 0) as reach,
             coalesce(ec.opens_count, 0) as opens, coalesce(ec.clickers_count, ec.clicks_count, 0) as clicks,
             ec.automation_id is not null as auto
      from public.email_campaigns ec
      where (ec.event_id in (select id from nights) or ec.automation_trigger_event_id in (select id from nights))
        and ec.status in ('sent', 'sending', 'paused')
        and ((g.scope_venue is not null and ec.venue_id = g.scope_venue)
          or (g.scope_org is not null and ec.organizer_user_id = g.scope_org))
      order by ec.sent_at desc nulls last
      limit 30
    ),
    email_clicks as (
      select ece.campaign_id, lower(ece.recipient_email) as email, min(ece.created_at) as click_at
      from public.email_campaign_events ece
      where ece.campaign_id in (select id from emails)
        and ece.event_type = 'clicked' and ece.recipient_email is not null
      group by 1, 2
    ),
    email_attr as (
      select c.campaign_id,
             count(distinct x.id) filter (where x.pillar in ('tickets', 'tables')) as orders,
             coalesce(sum(x.money_amount) filter (where x.pillar in ('tickets', 'tables')), 0) as amount,
             count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
      from email_clicks c
      join tx x on x.email = c.email and x.pillar in ('tickets', 'tables', 'guestlist')
                and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
      group by c.campaign_id
    ),
    pushes as (
      select pc.id, coalesce(pc.title, pc.template_key) as title, pc.created_at as sent_at,
             coalesce(pc.sent_count, 0) as reach, pc.source = 'auto' as auto, pc.template_key,
             pc.event_id
      from public.push_campaigns pc
      where pc.event_id in (select id from nights)
        and pc.status in ('sent', 'sending', 'completed')
        and ((g.scope_venue is not null and pc.venue_id = g.scope_venue)
          or (g.scope_org is not null and pc.venue_id is null and pc.agency_id is null))
      order by pc.created_at desc
      limit 30
    ),
    push_clicks as (
      select pce.campaign_id, pce.user_id, min(pce.created_at) as click_at
      from public.push_campaign_events pce
      where pce.campaign_id in (select id from pushes)
        and pce.event_type = 'clicked' and pce.user_id is not null
      group by 1, 2
    ),
    push_attr as (
      select c.campaign_id,
             count(*) as clicks,
             count(distinct x.id) filter (where x.pillar in ('tickets', 'tables')) as orders,
             coalesce(sum(x.money_amount) filter (where x.pillar in ('tickets', 'tables')), 0) as amount,
             count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
      from push_clicks c
      left join tx x on x.user_id = c.user_id and x.pillar in ('tickets', 'tables', 'guestlist')
                     and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
      group by c.campaign_id
    )
    select jsonb_build_object(
      'ok', true, 'money', g.money, 'nights', (select count(*) from nights),
      'channels', coalesce((
        select jsonb_agg(jsonb_build_object('source', c.source, 'n', c.n,
                 'amount', case when g.money then round(c.amount::numeric, 2) else null end) order by c.n desc)
        from (
          select case when source in ('venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct') then source
                      when source in ('manual', 'manual_open') then 'manual'
                      else 'other' end as source,
                 count(*) as n, sum(money_amount) as amount
          from tx where pillar in ('tickets', 'tables')
          group by 1
        ) c
      ), '[]'::jsonb),
      'links', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', k.id, 'label', coalesce(nullif(btrim(k.label), ''), k.utm_source, k.code), 'code', k.code,
                 'clicks', coalesce(k.clicks_count, 0), 'n', k.n, 'entries', k.entries,
                 'amount', case when g.money then round(k.amount::numeric, 2) else null end
               ) order by k.n + k.entries desc, k.clicks_count desc nulls last)
        from (
          select tl.id, tl.label, tl.utm_source, tl.code, tl.clicks_count,
                 (select count(*) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as n,
                 (select count(*) from tx where tx.tracked_link_id = tl.id and pillar = 'guestlist') as entries,
                 (select coalesce(sum(money_amount), 0) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as amount
          from public.tracked_links tl
          where tl.event_id in (select id from nights)
             or tl.id in (select tracked_link_id from tx where tracked_link_id is not null)
        ) k
        where k.n > 0 or k.entries > 0
        limit 12
      ), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(m.obj order by m.sent_at desc nulls last)
        from (
          select em.sent_at, jsonb_build_object(
                   'kind', 'email', 'id', em.id, 'title', em.title, 'sentAt', em.sent_at, 'auto', em.auto,
                   'reach', em.reach, 'opens', em.opens, 'clicks', em.clicks,
                   'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                   'amount', case when g.money then round(coalesce(a.amount, 0)::numeric, 2) else null end
                 ) as obj
          from emails em left join email_attr a on a.campaign_id = em.id
          union all
          select pu.sent_at, jsonb_build_object(
                   'kind', 'push', 'id', pu.id, 'title', pu.title, 'sentAt', pu.sent_at, 'auto', pu.auto,
                   'templateKey', pu.template_key,
                   'eventTitle', (select n.title from nights n where n.id = pu.event_id),
                   'reach', pu.reach, 'opens', null, 'clicks', coalesce(a.clicks, 0),
                   'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                   'amount', case when g.money then round(coalesce(a.amount, 0)::numeric, 2) else null end
                 )
          from pushes pu left join push_attr a on a.campaign_id = pu.id
        ) m
      ), '[]'::jsonb)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_takeaways(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT 'last4'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o          jsonb;
  c          jsonb;
  p          jsonb;
  v_take     jsonb := '[]'::jsonb;
  v_money    boolean;
  v_expected numeric;
  v_entries  numeric;
  v_ids      uuid[];
  v_d0       numeric;
  v_all      numeric;
  v_best     text;
  v_best_now numeric;
  v_best_prev numeric;
  v_best_gap numeric := 0;
  v_pillar   text;
  v_now_s    numeric;
  v_prev_s   numeric;
  v_sph_now  numeric;
  v_sph_prev numeric;
begin
  -- Même porte, même période et mêmes chiffres que l'écran.
  o := public.get_sales_overview(p_venue_id, p_organizer_user_id, p_period);
  if not coalesce((o ->> 'ok')::boolean, false) then
    return o;
  end if;
  c := o -> 'current';
  p := o -> 'previous';
  v_money := coalesce((o ->> 'money')::boolean, false);
  if coalesce((c ->> 'nights')::int, 0) = 0 then
    return o || jsonb_build_object('takeaways', '[]'::jsonb);
  end if;

  -- Présence : seules les soirées où la porte a scanné (pas scanné ≠ pas venu).
  v_expected := coalesce((c ->> 'presence_expected')::numeric, 0);
  v_entries  := coalesce((c ->> 'presence_entries')::numeric, 0);

  -- 1. La guest list ne vient pas (le no-show le plus fréquent), sinon la
  --    présence générale.
  if coalesce((c ->> 'gl_presence_registered')::int, 0) >= 30
     and coalesce((c ->> 'gl_presence_entered')::numeric, 0) / (c ->> 'gl_presence_registered')::int < 0.5 then
    v_take := v_take || jsonb_build_object('key', 'gl_no_show', 'tone', 'bad', 'pillar', 'guestList',
      'params', jsonb_build_object(
        'pct', round(100.0 * coalesce((c ->> 'gl_presence_entered')::int, 0) / (c ->> 'gl_presence_registered')::int),
        'missing', (c ->> 'gl_presence_registered')::int - coalesce((c ->> 'gl_presence_entered')::int, 0)));
  elsif v_expected >= 50 and v_entries > 0 and v_entries / v_expected < 0.7 then
    v_take := v_take || jsonb_build_object('key', 'presence_low', 'tone', 'bad', 'pillar', 'all',
      'params', jsonb_build_object('pct', round(100.0 * v_entries / v_expected), 'missing', (v_expected - v_entries)::int));
  end if;

  -- 2. La dépense par tête bouge d'au moins 10 % (base ≥ 50 entrées des deux côtés).
  -- Dépense par tête : soirées dont on voit l'argent ET où la porte a scanné.
  if v_money and p is not null and coalesce((c ->> 'spend_entries')::numeric, 0) >= 50
     and coalesce((p ->> 'spend_entries')::numeric, 0) >= 50
     and coalesce((p ->> 'spend_revenue')::numeric, 0) > 0 then
    v_sph_now  := coalesce((c ->> 'spend_revenue')::numeric, 0) / (c ->> 'spend_entries')::numeric;
    v_sph_prev := (p ->> 'spend_revenue')::numeric / (p ->> 'spend_entries')::numeric;
    if abs(v_sph_now - v_sph_prev) / v_sph_prev >= 0.1 then
      v_take := v_take || jsonb_build_object(
        'key', case when v_sph_now > v_sph_prev then 'spend_up' else 'spend_down' end,
        'tone', case when v_sph_now > v_sph_prev then 'good' else 'bad' end, 'pillar', 'all',
        'params', jsonb_build_object('now', round(v_sph_now, 2), 'prev', round(v_sph_prev, 2),
          'pct', round(100 * abs(v_sph_now - v_sph_prev) / v_sph_prev)));
    end if;
  end if;

  -- 3. Le mix change : un pilier gagne ou perd au moins 10 points de CA.
  if v_money and p is not null and coalesce((c ->> 'revenue')::numeric, 0) > 0
     and coalesce((p ->> 'revenue')::numeric, 0) > 0 and (c ->> 'nights')::int >= 2 then
    foreach v_pillar in array array['tickets', 'tables', 'bar'] loop
      v_now_s  := 100 * coalesce((c ->> ('rev_' || v_pillar))::numeric, 0) / (c ->> 'revenue')::numeric;
      v_prev_s := 100 * coalesce((p ->> ('rev_' || v_pillar))::numeric, 0) / (p ->> 'revenue')::numeric;
      if abs(v_now_s - v_prev_s) > v_best_gap then
        v_best_gap := abs(v_now_s - v_prev_s); v_best := v_pillar; v_best_now := v_now_s; v_best_prev := v_prev_s;
      end if;
    end loop;
    if v_best_gap >= 10 then
      v_take := v_take || jsonb_build_object('key', 'mix_shift', 'tone', 'info',
        'pillar', v_best,
        'params', jsonb_build_object('pillar', v_best, 'pct', round(v_best_now), 'prev', round(v_best_prev)));
    end if;
  end if;

  -- 4. Les billets s'achètent le jour J (heure de la soirée).
  select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_ids
  from jsonb_array_elements(o -> 'nights') x;
  select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)) filter (
           where (coalesce(t.paid_at, t.created_at) at time zone coalesce(e.timezone, v.timezone, 'Europe/Paris'))::date
              >= (e.start_at at time zone coalesce(e.timezone, v.timezone, 'Europe/Paris'))::date), 0),
         coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0)
    into v_d0, v_all
  from public.tickets t
  join public.events e on e.id = t.event_id
  left join public.venues v on v.id = coalesce(e.venue_id, e.partner_venue_id)
  where t.event_id = any (v_ids) and t.status in ('paid', 'used');
  if v_all >= 50 and v_d0 / v_all >= 0.35 then
    v_take := v_take || jsonb_build_object('key', 'day_of', 'tone', 'info', 'pillar', 'tickets',
      'params', jsonb_build_object('pct', round(100 * v_d0 / v_all)));
  end if;

  -- L'écran Ventes appelle cette fonction seule : elle rend la vue d'ensemble
  -- ET ses constats, pour ne pas calculer la période deux fois.
  return o || jsonb_build_object('takeaways',
    coalesce((select jsonb_agg(x.value) from (select value from jsonb_array_elements(v_take) limit 3) x), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_sms_sender_readiness(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_legal   text;
  v_siret   text;
  v_rna     text;
  v_vat     text;
  v_has_id  boolean;
  v_missing text[] := ARRAY[]::text[];
  v_last    text;
BEGIN
  -- Lecture : qui gère le SMS de la portée, ou un membre de la Console CRM.
  IF NOT (public.sms_scope_allowed(p_venue_id, p_organizer_user_id)
          OR (COALESCE(p_venue_id, p_organizer_user_id::text) IS NOT NULL
              AND public.crm_scope_allowed(p_venue_id, p_organizer_user_id))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN
    RETURN jsonb_build_object('identity_ok', true, 'missing', '[]'::jsonb, 'last_sender_id', 'YUNO');
  END IF;

  IF p_venue_id IS NOT NULL THEN
    SELECT v.legal_name, v.siret, NULL::text, v.vat_number
      INTO v_legal, v_siret, v_rna, v_vat
      FROM public.venues v WHERE v.id = p_venue_id;
  ELSE
    SELECT o.legal_name, o.siret, o.rna_number, o.vat_number
      INTO v_legal, v_siret, v_rna, v_vat
      FROM public.organizer_profiles o WHERE o.user_id = p_organizer_user_id;
  END IF;

  v_has_id := length(regexp_replace(COALESCE(v_siret, ''), '[^0-9]', '', 'g')) = 14
           OR upper(regexp_replace(COALESCE(v_rna, ''), '\s', '', 'g')) ~ '^W[0-9]{9}$'
           OR length(btrim(COALESCE(v_vat, ''))) >= 6;

  IF length(btrim(COALESCE(v_legal, ''))) < 2 THEN v_missing := array_append(v_missing, 'legal_name'); END IF;
  IF NOT v_has_id THEN v_missing := array_append(v_missing, 'registration'); END IF;

  -- Nom d'expéditeur à proposer : celui des Réglages SMS de la Console, sinon
  -- le dernier utilisé par la portée (colonne , ou 
  -- quand il suit déjà les règles, comme dans la Console CRM).
  SELECT s.sender_name INTO v_last FROM public.crm_sms_settings s
   WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id)
     AND s.sender_name ~ '^[A-Za-z0-9]{3,11}$';
  IF v_last IS NULL THEN
    SELECT COALESCE(c.sender_id, c.sender_name) INTO v_last
      FROM public.sms_campaigns c
     WHERE (c.sender_id IS NOT NULL OR c.sender_name ~ '^[A-Za-z0-9]{3,11}$')
       AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
         OR (p_venue_id IS NULL AND c.organizer_id = p_organizer_user_id))
     ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'identity_ok', cardinality(v_missing) = 0,
    'missing', to_jsonb(v_missing),
    'last_sender_id', v_last
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_venue_customer_segments(p_venue_id text)
 RETURNS TABLE(id uuid, user_id uuid, email text, first_name text, last_name text, phone text, first_visit_at timestamp with time zone, last_visit_at timestamp with time zone, total_spent numeric, ticket_count integer, order_count integer, table_count integer, is_banned boolean, banned_at timestamp with time zone, ban_reason text, notes text, revenue_30d numeric, revenue_90d numeric, revenue_prev_90d numeric, avg_basket numeric, visit_nights integer, visits_per_month numeric, last_activity_at timestamp with time zone, preferred_dow integer, preferred_event_title text, recency_days integer, rfm_r integer, rfm_f integer, rfm_m integer, rfm_segment text, rfm_tier text, churn_risk boolean, is_guest boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role'
          OR is_super_admin()
          OR is_venue_owner(auth.uid(), p_venue_id)
          OR manager_has_permission(auth.uid(), p_venue_id, 'analytics')) THEN
    RAISE EXCEPTION 'Not authorized for venue %', p_venue_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT * FROM public._venue_customer_rfm(p_venue_id)
  ORDER BY 8 DESC NULLS LAST; -- last_visit_at (position : noms = variables de sortie en plpgsql)
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_vip_table_analytics(p_venue_id text DEFAULT NULL::text, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_tz text DEFAULT 'Europe/Paris'::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with res as (
    select
      r.id,
      r.zone_id,
      r.total_price,
      coalesce(r.service_fee, 0)     as service_fee,
      coalesce(r.management_fee, 0)   as management_fee,
      -- CA Club (Yuno fees exclus), avant remboursement — foote avec tableAnalytics.totalRevenue.
      greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) as gross,
      coalesce(r.guest_count, 0)      as guest_count,
      coalesce(r.deposit, 0)          as deposit,
      coalesce(r.minimum_spend, 0)    as minimum_spend,
      r.created_at,
      r.placed_at,
      r.finished_at,
      (r.checked_in_at is not null or coalesce(r.entry_scanned, false)) as arrived,
      e.start_at as event_start
    from public.table_reservations r
    join public.events e on e.id = r.event_id
    where (
          (p_venue_id is not null and e.venue_id = p_venue_id)
       or (p_organizer_user_id is not null and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
      and r.status = 'paid'
      and (p_event_id is null or r.event_id = p_event_id)
      and (p_from is null or r.created_at >= p_from)
      and (p_to   is null or r.created_at <= p_to)
  ),
  buckets as (
    select
      id, gross, guest_count,
      case
        when guest_count <= 2 then '1-2'
        when guest_count <= 4 then '3-4'
        when guest_count <= 6 then '5-6'
        when guest_count <= 8 then '7-8'
        else '9+'
      end as party_bucket,
      case
        when event_start is null then 'J-0'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 1 then 'J-0'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 2 then 'J-1'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 4 then 'J-2-3'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 8 then 'J-4-7'
        else 'J-8+'
      end as lead_bucket
    from res
  )
  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'booking_revenue', coalesce((select sum(gross) from res), 0),
      'reservations',    (select count(*) from res),
      'guests',          coalesce((select sum(guest_count) from res), 0),
      'avg_per_table',   coalesce((select round(avg(gross)::numeric, 2) from res), 0),
      'revenue_per_head', coalesce((
        select round((sum(gross) / nullif(sum(guest_count), 0))::numeric, 2) from res), 0),
      'avg_party_size',  coalesce((
        select round(avg(nullif(guest_count, 0))::numeric, 1) from res), 0),
      'total_deposit',   coalesce((select sum(deposit) from res), 0),
      'total_minimum',   coalesce((select sum(minimum_spend) from res where minimum_spend > 0), 0),
      'arrived_tables',  (select count(*) from res where arrived),
      'no_show_rate',    coalesce((
        select round((100.0 * (count(*) filter (where not arrived)) / nullif(count(*), 0))::numeric, 1)
        from res), 0),
      'avg_rotation_min', coalesce((
        select round(avg(extract(epoch from (finished_at - placed_at)) / 60.0)::numeric, 0)
        from res where placed_at is not null and finished_at is not null and finished_at > placed_at), 0),
      'median_rotation_min', coalesce((
        select round(percentile_cont(0.5) within group (
          order by extract(epoch from (finished_at - placed_at)) / 60.0)::numeric, 0)
        from res where placed_at is not null and finished_at is not null and finished_at > placed_at), 0),
      'rotation_sample', (select count(*) from res where placed_at is not null and finished_at is not null and finished_at > placed_at)
    ),
    'party_size', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', party_bucket, 'count', cnt, 'revenue', rev) order by ord)
      from (
        select party_bucket, count(*) cnt, sum(gross) rev,
               min(case party_bucket when '1-2' then 1 when '3-4' then 2 when '5-6' then 3 when '7-8' then 4 else 5 end) ord
        from buckets group by party_bucket
      ) p), '[]'::jsonb),
    'lead_time', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', lead_bucket, 'count', cnt, 'revenue', rev) order by ord)
      from (
        select lead_bucket, count(*) cnt, sum(gross) rev,
               min(case lead_bucket when 'J-0' then 1 when 'J-1' then 2 when 'J-2-3' then 3 when 'J-4-7' then 4 else 5 end) ord
        from buckets group by lead_bucket
      ) l), '[]'::jsonb),
    'by_zone', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zone_id', zone_id, 'zone_name', zone_name,
        'reservations', reservations, 'revenue', revenue, 'guests', guests,
        'avg_per_table', avg_per_table) order by revenue desc)
      from (
        select r.zone_id, coalesce(tz.name, 'Zone') as zone_name,
               count(*) reservations, sum(r.gross) revenue, sum(r.guest_count) guests,
               round(avg(r.gross)::numeric, 2) avg_per_table
        from res r
        left join public.table_zones tz on tz.id = r.zone_id
        group by r.zone_id, tz.name
      ) z), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'reservations', reservations, 'revenue', revenue) order by hour)
      from (
        select extract(hour from (created_at at time zone p_tz))::int as hour,
               count(*) reservations, sum(gross) revenue
        from res
        group by 1
      ) h), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_agency_owner(_user_id uuid, _agency_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.agencies a
    WHERE a.id = _agency_id AND a.owner_user_id = _user_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_demo_email(p_email text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT p_email IS NOT NULL AND (
       lower(p_email) LIKE '%@womber.fr'
    OR lower(p_email) LIKE 'vitrine+%@yunoapp.eu'
    OR lower(p_email) LIKE 'deleted-%@deleted.local'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_demo_marketing_scope(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(p_venue_id = any (public.demo_venue_ids()), false)
      or coalesce((select public.is_demo_email(p.email) from public.profiles p where p.id = p_organizer_user_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.is_email_suppressed(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.email_suppressions s
    WHERE lower(s.email) = lower(COALESCE(p_email, ''))
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_event_cohost(p_event_id uuid, p_uid uuid, p_min text DEFAULT 'viewer'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted'
       AND (p_min = 'viewer' OR c.access = 'editor')
       AND p_uid IS NOT NULL
       -- Depuis l'API, on ne se renseigne que sur soi-même.
       AND (session_user <> 'authenticator' OR p_uid = auth.uid())
       AND (
         (c.organizer_user_id IS NOT NULL
          AND (c.organizer_user_id = p_uid OR public.is_org_team_member(p_uid, c.organizer_user_id, 'editor')))
         OR (c.venue_id IS NOT NULL
             AND CASE WHEN p_min = 'viewer' THEN public.can_manage_venue(p_uid, c.venue_id)
                      ELSE public.coorg_party_level(p_uid, 'venue:' || c.venue_id) >= 2 END)
       )
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_org_team_member(_user_id uuid, _organizer_user_id uuid, _min_role text DEFAULT 'scanner'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE organizer_user_id = _organizer_user_id
      AND member_user_id = _user_id
      AND invitation_status = 'accepted'
      AND CASE _min_role
        WHEN 'admin' THEN role = 'admin'
        WHEN 'editor' THEN role IN ('admin', 'editor')
        WHEN 'scanner' THEN role IN ('admin', 'editor', 'scanner')
        ELSE TRUE
      END
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'admin'::app_role
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_support_session()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.admin_support_sessions s
     WHERE s.auth_session_id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_venue_owner(_user_id uuid, _venue_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.venues 
    WHERE id = _venue_id 
    AND owner_id = _user_id
  )
$function$;

CREATE OR REPLACE FUNCTION public.lens_traffic_takeaways(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_result    jsonb := p_result;
  v_take      jsonb := '[]'::jsonb;
  v_sess      integer;
  v_sel       integer;
  v_co        integer;
  v_de        integer;
  v_pu        integer;
  v_lost      integer;
  v_best_lost integer := 0;
  v_key       text;
  v_pct       numeric;
  v_row       record;
  v_conv_all  numeric;
  v_mob       jsonb;
  v_desk      jsonb;
  v_ab        jsonb;
BEGIN
  -- ── « À retenir » : 0 à 3 constats, chacun avec son seuil de volume ────────
  -- (calculés ici, jamais au front : un constat nouveau se pose en SQL.)
  IF COALESCE((v_result #>> '{funnel,tracked}')::boolean, false) THEN
    v_sess := (v_result #>> '{funnel,sessions}')::int;
    v_sel  := (v_result #>> '{funnel,selected}')::int;
    v_co   := (v_result #>> '{funnel,checkout}')::int;
    v_de   := (v_result #>> '{funnel,details}')::int;
    v_pu   := (v_result #>> '{funnel,purchased}')::int;

    -- La plus grosse fuite parmi les trois passages après le choix.
    FOR v_row IN
      SELECT * FROM (VALUES ('leak_checkout', v_sel, v_co), ('leak_details', v_co, v_de), ('leak_payment', v_de, v_pu)) AS x(k, a, b)
    LOOP
      v_lost := v_row.a - v_row.b;
      IF v_row.a >= 10 AND v_lost >= 10 AND v_lost::numeric / v_row.a >= 0.3 AND v_lost > v_best_lost THEN
        v_best_lost := v_lost;
        v_key := v_row.k;
        v_pct := round(v_lost::numeric / v_row.a * 100);
      END IF;
    END LOOP;
    IF v_key IS NOT NULL THEN
      v_take := v_take || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'tone', 'bad', 'section', 'funnel', 'params', jsonb_build_object('lost', v_best_lost, 'pct', v_pct)));
    END IF;

    -- Mobile contre ordinateur : un écart de conversion du simple au double et demi.
    SELECT d INTO v_mob FROM jsonb_array_elements(v_result -> 'devices') d WHERE d ->> 'device' = 'mobile' LIMIT 1;
    SELECT d INTO v_desk FROM jsonb_array_elements(v_result -> 'devices') d WHERE d ->> 'device' = 'desktop' LIMIT 1;
    IF v_mob IS NOT NULL AND v_desk IS NOT NULL
       AND (v_mob ->> 'sessions')::int >= 10 AND (v_desk ->> 'sessions')::int >= 10 THEN
      DECLARE
        v_cm numeric := (v_mob ->> 'purchased')::numeric / (v_mob ->> 'sessions')::numeric * 100;
        v_cd numeric := (v_desk ->> 'purchased')::numeric / (v_desk ->> 'sessions')::numeric * 100;
      BEGIN
        IF v_cd > 0 AND v_cm < v_cd / 1.5 THEN
          v_take := v_take || jsonb_build_array(jsonb_build_object(
            'key', 'mobile_gap', 'tone', 'bad', 'section', 'audience',
            'params', jsonb_build_object('a', round(v_cm, 1), 'b', round(v_cd, 1))));
        ELSIF v_cm > 0 AND v_cd < v_cm / 1.5 THEN
          v_take := v_take || jsonb_build_array(jsonb_build_object(
            'key', 'desktop_gap', 'tone', 'bad', 'section', 'audience',
            'params', jsonb_build_object('a', round(v_cd, 1), 'b', round(v_cm, 1))));
        END IF;
      END;
    END IF;

    -- Les paniers abandonnés.
    v_ab := v_result -> 'abandoned';
    IF (v_ab ->> 'sessions')::int >= 5 THEN
      v_take := v_take || jsonb_build_array(jsonb_build_object(
        'key', 'abandoned', 'tone', 'info', 'section', 'funnel',
        'params', jsonb_build_object('n', (v_ab ->> 'sessions')::int, 'amount', v_ab -> 'amount')));
    END IF;

    -- La source qui convertit le mieux, au moins une fois et demie la moyenne.
    IF v_sess >= 10 AND v_pu > 0 THEN
      v_conv_all := v_pu::numeric / v_sess * 100;
      SELECT s ->> 'source' AS src, round((s ->> 'purchased')::numeric / (s ->> 'sessions')::numeric * 100, 1) AS pct
        INTO v_row
        FROM jsonb_array_elements(v_result -> 'sources') s
       WHERE (s ->> 'sessions')::int >= 10 AND (s ->> 'source') <> 'unknown'
         AND (s ->> 'purchased')::numeric / (s ->> 'sessions')::numeric * 100 >= v_conv_all * 1.5
       ORDER BY (s ->> 'purchased')::numeric / (s ->> 'sessions')::numeric DESC
       LIMIT 1;
      IF FOUND THEN
        v_take := v_take || jsonb_build_array(jsonb_build_object(
          'key', 'best_source', 'tone', 'good', 'section', 'audience',
          'params', jsonb_build_object('source', v_row.src, 'pct', v_row.pct)));
      END IF;
    END IF;
  END IF;

  RETURN (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_take) x LIMIT 3) z);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_contact_base(p_venue_id text, p_organizer_user_id uuid, p_search text DEFAULT NULL::text, p_segment_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_origin text DEFAULT NULL::text, p_list_import_id uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_where text := 'true';
  v_order text;
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_def jsonb;
  v_q text;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'list_contact_base: une seule portée à la fois';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);

  IF p_segment_id IS NOT NULL THEN
    SELECT cs.definition INTO v_def FROM public.contact_segments cs
     WHERE cs.id = p_segment_id
       AND public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id);
    v_where := v_where || ' AND ' || COALESCE(public.contact_definition_predicate(v_def, 'c'), 'false');
  END IF;
  IF p_status IS NOT NULL AND p_status IN ('active','passive','silent','new','unreachable','unsubscribed') THEN
    v_where := v_where || format(' AND c.eng_status = %L', p_status);
  END IF;
  IF p_origin IS NOT NULL AND p_origin IN ('import','yuno','both') THEN
    v_where := v_where || format(' AND c.origin = %L', p_origin);
  END IF;
  IF p_list_import_id IS NOT NULL THEN
    v_where := v_where || format(' AND c.list_import_id = %L::uuid', p_list_import_id);
  END IF;
  IF NULLIF(btrim(COALESCE(p_search, '')), '') IS NOT NULL THEN
    v_q := '%' || replace(replace(replace(lower(btrim(p_search)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_where := v_where || format(' AND (c.email ILIKE %L OR lower(COALESCE(c.first_name, '''') || '' '' || COALESCE(c.last_name, '''')) LIKE %L OR COALESCE(c.phone_e164, '''') LIKE %L OR lower(COALESCE(c.city, '''')) LIKE %L)', v_q, v_q, v_q, v_q);
  END IF;

  v_order := CASE COALESCE(p_sort, 'recent')
    WHEN 'spent' THEN 'c.total_spent DESC NULLS LAST, c.email'
    WHEN 'engaged' THEN 'c.last_clicked_at DESC NULLS LAST, c.last_opened_at DESC NULLS LAST, c.email'
    WHEN 'name' THEN 'lower(COALESCE(c.last_name, '''')), lower(COALESCE(c.first_name, '''')), c.email'
    WHEN 'events' THEN 'c.event_count DESC NULLS LAST, c.email'
    ELSE 'c.last_seen_at DESC NULLS LAST, c.created_at DESC, c.email'
  END;

  EXECUTE format('SELECT count(*) FROM _cr c WHERE %s', v_where) INTO v_total;
  EXECUTE format($q$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
      SELECT c.id, c.email, c.phone_e164, c.first_name, c.last_name, c.origin, c.eng_status AS status,
             c.emails_sent, c.opens, c.clicks, c.last_opened_at, c.last_clicked_at, c.unsubscribed_at, c.bounced,
             c.total_spent, c.event_count, c.last_purchase_at, c.yuno_spent, c.yuno_events, c.imported_spent, c.imported_events,
             c.ticket_count, c.table_count, c.order_count, c.guest_list_count, c.last_seen_at,
             c.city, c.zone, c.country_code, c.age, c.gender, c.added_at,
             c.email_ok, c.phone_ok, c.has_account, c.list_import_id
        FROM _cr c WHERE %s ORDER BY %s LIMIT %s OFFSET %s) t
  $q$, v_where, v_order, GREATEST(1, LEAST(COALESCE(p_limit, 50), 200)), GREATEST(0, COALESCE(p_offset, 0)))
    INTO v_rows;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.marketing_scope_match(p_row_venue_id text, p_row_organizer_user_id uuid, p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN p_venue_id IS NOT NULL         THEN p_row_venue_id = p_venue_id
    WHEN p_organizer_user_id IS NOT NULL THEN p_row_organizer_user_id = p_organizer_user_id
    ELSE p_row_venue_id IS NULL AND p_row_organizer_user_id IS NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.music_genre_key(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT btrim(regexp_replace(
    lower(public.unaccent_music_genre(p_raw)),
    '[^a-z0-9]+', ' ', 'g'
  ));
$function$;

CREATE OR REPLACE FUNCTION public.night_date(p_ts timestamp with time zone, p_tz text DEFAULT 'Europe/Paris'::text)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT ((p_ts AT TIME ZONE coalesce(nullif(p_tz, ''), 'Europe/Paris')) - interval '12 hours')::date
$function$;

CREATE OR REPLACE FUNCTION public.org_member_has_permission(_user_id uuid, _organizer_user_id uuid, _permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE organizer_user_id = _organizer_user_id
      AND member_user_id = _user_id
      AND invitation_status = 'accepted'
      AND (
        role = 'admin'
        OR (_permission = 'view_finance' AND can_view_finance = true)
        OR (_permission = 'refund' AND can_refund = true)
        OR (_permission = 'export' AND can_export = true)
        OR (_permission = 'manage_team' AND can_manage_team = true)
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.resolve_venue_segment(p_venue_id text, p_definition jsonb)
 RETURNS TABLE(user_id uuid, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role'
          OR is_super_admin()
          OR is_venue_owner(auth.uid(), p_venue_id)
          OR manager_has_permission(auth.uid(), p_venue_id, 'analytics')
          OR EXISTS (
            SELECT 1 FROM manager_permissions mp
            WHERE mp.user_id = auth.uid() AND mp.venue_id = p_venue_id AND mp.can_manage_crm = true
          )) THEN
    RAISE EXCEPTION 'Not authorized for venue %', p_venue_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.user_id, r.email
  FROM public._venue_customer_rfm(p_venue_id) r
  LEFT JOIN public.profiles pr ON pr.id = r.user_id
  LEFT JOIN public.customer_loyalty cl ON cl.venue_id = p_venue_id AND cl.user_id = r.user_id
  LEFT JOIN public.user_taste_profiles utp ON utp.user_id = r.user_id
  WHERE r.is_banned = false
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_definition->'conditions', '[]'::jsonb)) AS c
      WHERE NOT CASE c->>'type'
        WHEN 'rfm_segment' THEN
          r.rfm_segment IN (SELECT jsonb_array_elements_text(c->'in'))
        WHEN 'rfm_tier' THEN
          r.rfm_tier IN (SELECT jsonb_array_elements_text(c->'in'))
        WHEN 'churn_risk' THEN
          r.churn_risk = COALESCE((c->>'value')::boolean, true)
        WHEN 'total_spent' THEN
          CASE WHEN c->>'op' = 'lte' THEN COALESCE(r.total_spent, 0) <= (c->>'value')::numeric
               ELSE COALESCE(r.total_spent, 0) >= (c->>'value')::numeric END
        WHEN 'avg_basket' THEN
          CASE WHEN c->>'op' = 'lte' THEN COALESCE(r.avg_basket, 0) <= (c->>'value')::numeric
               ELSE COALESCE(r.avg_basket, 0) >= (c->>'value')::numeric END
        WHEN 'last_visit_days' THEN
          CASE WHEN c->>'op' = 'gt' THEN r.recency_days > (c->>'value')::int
               ELSE r.recency_days <= (c->>'value')::int END
        WHEN 'pillar' THEN
          ((CASE c->>'pillar'
              WHEN 'tickets' THEN COALESCE(r.ticket_count, 0)
              WHEN 'drinks'  THEN COALESCE(r.order_count, 0)
              WHEN 'tables'  THEN COALESCE(r.table_count, 0)
              ELSE 0 END) > 0) = COALESCE((c->>'has')::boolean, true)
        WHEN 'event' THEN
          CASE WHEN c->>'kind' = 'scanned' THEN
            EXISTS (
              SELECT 1 FROM public.tickets t
              WHERE t.event_id = (c->>'event_id')::uuid AND t.status = 'paid'
                AND t.entry_scanned = true AND lower(t.user_email) = lower(r.email)
            ) OR EXISTS (
              SELECT 1 FROM public.table_reservations tr
              WHERE tr.event_id = (c->>'event_id')::uuid AND tr.entry_scanned = true
                AND lower(tr.user_email) = lower(r.email)
            )
          ELSE
            EXISTS (
              SELECT 1 FROM public.tickets t
              WHERE t.event_id = (c->>'event_id')::uuid AND t.status = 'paid'
                AND lower(t.user_email) = lower(r.email)
            ) OR EXISTS (
              SELECT 1 FROM public.table_reservations tr
              WHERE tr.event_id = (c->>'event_id')::uuid AND tr.status = 'paid'
                AND lower(tr.user_email) = lower(r.email)
            )
          END
        WHEN 'follower' THEN
          (r.user_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.favorites f
            WHERE f.venue_id = p_venue_id AND f.user_id = r.user_id
          )) = COALESCE((c->>'value')::boolean, true)
        WHEN 'language' THEN
          COALESCE(pr.preferred_language, '') IN (SELECT jsonb_array_elements_text(c->'in'))
        WHEN 'city' THEN
          pr.city ILIKE '%' || (c->>'value') || '%'
        WHEN 'loyalty_tier' THEN
          COALESCE(cl.tier, '') IN (SELECT jsonb_array_elements_text(c->'in'))
        WHEN 'genres' THEN
          utp.genres && (SELECT COALESCE(array_agg(g), '{}'::text[])
                         FROM jsonb_array_elements_text(c->'any') AS g)
        ELSE false
      END
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sms_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND (
            p_organizer_user_id = auth.uid()
            OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
          ))
    ));
$function$;

CREATE OR REPLACE FUNCTION public.sms_tariff_zone(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_phone ~ '^\+33' THEN 'fr'
    WHEN p_phone ~ '^\+1' THEN 'blocked'
    ELSE 'intl'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.suggest_basket_threshold(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payers integer := 0;
  v_p75 numeric;
  v_median numeric;
  v_max_ticket numeric;
  v_min_table_pp numeric;
  v_threshold integer;
  v_basis text;
BEGIN
  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN
    RETURN jsonb_build_object('threshold', 60, 'basis', 'default');
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 1. Historique : dépense par soirée des clients payeurs (billets, tables,
  --    boissons — net des frais Yuno, comme la base de contacts).
  SELECT count(*),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY c.spent / c.event_count),
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY c.spent / c.event_count)
    INTO v_payers, v_p75, v_median
    FROM public.contact_scope_customers(p_venue_id, p_organizer_user_id) c
   WHERE COALESCE(c.spent, 0) > 0 AND COALESCE(c.event_count, 0) > 0;

  -- 2. L'offre, sur les soirées des 12 derniers mois et à venir.
  WITH ev AS (
    SELECT e.id, COALESCE(e.venue_id, e.partner_venue_id) AS vid
      FROM public.events e
     WHERE e.start_at > now() - interval '12 months'
       AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id OR e.id in (select public.cohost_event_ids_venue(p_venue_id))))
         OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id OR e.id in (select public.cohost_event_ids_org(p_organizer_user_id)))))
  )
  SELECT (SELECT max(r.price) FROM public.ticket_rounds r JOIN ev ON ev.id = r.event_id WHERE COALESCE(r.price, 0) > 0),
         (SELECT min(COALESCE(NULLIF(p.base_price, 0), NULLIF(p.minimum_spend, 0)) / GREATEST(COALESCE(p.base_capacity, 1), 1))
            FROM public.table_packs p
           WHERE p.is_active
             AND COALESCE(NULLIF(p.base_price, 0), NULLIF(p.minimum_spend, 0)) IS NOT NULL
             AND (p.event_id IN (SELECT id FROM ev)
               OR (p.event_id IS NULL AND p.venue_id IN (SELECT vid FROM ev WHERE vid IS NOT NULL))))
    INTO v_max_ticket, v_min_table_pp;

  IF v_payers >= 20 AND COALESCE(v_p75, 0) > 0 THEN
    v_threshold := GREATEST(5, ceil(v_p75 / 5.0)::integer * 5);
    v_basis := 'history';
  ELSIF COALESCE(v_min_table_pp, 0) > 0 THEN
    v_threshold := GREATEST(5, ceil(v_min_table_pp / 5.0)::integer * 5);
    v_basis := 'offer_tables';
  ELSIF COALESCE(v_max_ticket, 0) > 0 THEN
    v_threshold := GREATEST(5, ceil(v_max_ticket * 1.5 / 5.0)::integer * 5);
    v_basis := 'offer_tickets';
  ELSE
    v_threshold := 60;
    v_basis := 'default';
  END IF;

  RETURN jsonb_build_object(
    'threshold', v_threshold,
    'basis', v_basis,
    'payers', COALESCE(v_payers, 0),
    'p75', round(COALESCE(v_p75, 0), 2),
    'median', round(COALESCE(v_median, 0), 2),
    'max_ticket', round(COALESCE(v_max_ticket, 0), 2),
    'min_table_pp', round(COALESCE(v_min_table_pp, 0), 2)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.unaccent_music_genre(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT translate(
    coalesce(p_raw, ''),
    'àáâãäåèéêëìíîïòóôõöùúûüýÿñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ',
    'aaaaaaeeeeiiiiooooouuuuyyncAAAAAAEEEEIIIIOOOOOUUUUYNC'
  );
$function$;

CREATE OR REPLACE FUNCTION public.unaccent_safe(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  RETURN translate(p,
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñŠšŽžÝýÿ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnSsZzYyy');
END;
$function$;
