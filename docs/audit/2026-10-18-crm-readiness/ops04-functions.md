# OPS-04 — fonctions de la prod ≠ dépôt (2026-10-18T12:18Z)

Lecture seule de la prod (`pg_proc`, schémas public, private, analytics_wh, analytics_wh_private, hors extensions), comparée aux
1228 fichiers de migration du dépôt dont la version est appliquée en prod
(1229 versions en prod, dernière 20261020200000). Méthode : en-tête de
`scripts/crm-bench/prod-functions-reference.mjs`.

| Statut | Fonctions |
|---|---|
| absent | 13 |
| older | 2 |
| rewritten | 35 |
| same | 1609 |
| **total** | 1659 |

Versions appliquées en prod absentes du dépôt : `20261019150000` (crm_practical_email).

Fichiers du dépôt pas encore appliqués en prod (ignorés) : `20261021100000_audit_security_revokes.sql`, `20261021110000_audit_claim_recheck_consent.sql`, `20261021120000_audit_ticketing_purge_and_retry.sql`.

Migration de référence : `supabase/reference/20261018_prod_functions_reference.sql` (50 fonctions).

## absent (13)

| Fonction | Dernière définition du dépôt | Texte de la prod trouvé dans git | Réécrite en place par (probable) |
|---|---|---|---|
| `public._crm_practical_audience(p_campaign_id uuid)` | — | 20261019150000_crm_practical_email.sql sur claude/elastic-bhaskara-96eee4, crm/s11-practical-email (+1) | — |
| `public._crm_practical_content_issues(p_blocks jsonb, p_subject text, p_preheader text, p_event_id uuid, p_e)` | — | 20261019150000_crm_practical_email.sql sur claude/elastic-bhaskara-96eee4, crm/s11-practical-email (+1) | — |
| `public._crm_practical_link_issue(p_url text, p_event_url text)` | — | 20261019150000_crm_practical_email.sql sur claude/elastic-bhaskara-96eee4, crm/s11-practical-email (+1) | — |
| `public._crm_practical_night_state(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid, p_campaign)` | — | 20261019150000_crm_practical_email.sql sur claude/elastic-bhaskara-96eee4, crm/s11-practical-email (+1) | — |
| `public._crm_practical_text_issue(p_text text)` | — | 20261019150000_crm_practical_email.sql sur claude/elastic-bhaskara-96eee4, crm/s11-practical-email (+1) | — |
| `public.affiliate_clicks_require_target()` | — | 20260925230000_affiliate_clicks_survive_event_purge.sql sur origin/claude/nifty-cori-dcjxgd | — |
| `public.contact_base_cache_fresh(p_built_at timestamp with time zone, p_dirty_at timestamp with time zo)` | — | 20260929270000_contact_base_cache_swr.sql sur origin/claude/dashboard-perf-fullscreen-szl3ft | — |
| `public.contact_base_cache_invalidate()` | — | 20260929270000_contact_base_cache_swr.sql sur origin/claude/dashboard-perf-fullscreen-szl3ft | — |
| `public.contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid)` | — | 20260929260000_contact_base_cache.sql sur origin/claude/dashboard-perf-fullscreen-szl3ft | 20261019310000_ticketing_erasure_from_provider.sql, 20261019420000_crm_admin_invites_demo_support.sql |
| `public.crm_practical_email_check(p_campaign_id uuid)` | — | 20261019150000_crm_practical_email.sql sur claude/elastic-bhaskara-96eee4, crm/s11-practical-email (+1) | — |
| `public.crm_practical_email_rules()` | — | 20261019150000_crm_practical_email.sql sur claude/elastic-bhaskara-96eee4, crm/s11-practical-email (+1) | — |
| `public.crm_practical_night(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | — | 20261019150000_crm_practical_email.sql sur claude/elastic-bhaskara-96eee4, crm/s11-practical-email (+1) | — |
| `public.guard_crm_practical_email()` | — | 20261019150000_crm_practical_email.sql sur claude/elastic-bhaskara-96eee4, crm/s11-practical-email (+1) | — |

## older (2)

| Fonction | Dernière définition du dépôt | Texte de la prod trouvé dans git | Réécrite en place par (probable) |
|---|---|---|---|
| `public.get_visitor_stats(p_venue_id text, p_start timestamp with time zone, p_end timestamp wit)` | 20260220150837_8bd7fb9d-c710-4249-98b8-7c5b93ef125e.sql (dernière : 20260503133945_c61ab1fe-3f39-458e-ab3d-9071980e11a5.sql) | nulle part | — |
| `public.is_event_partner_venue_owner(_user_id uuid, _event_id uuid)` | 20260421103841_b3bf8afe-d0f7-4959-92e5-3d085868dac0.sql (dernière : 20260503132722_df478593-422f-4445-b572-f0e2e981b309.sql) | nulle part | — |

## rewritten (35)

| Fonction | Dernière définition du dépôt | Texte de la prod trouvé dans git | Réécrite en place par (probable) |
|---|---|---|---|
| `public._crm_an_load(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zo)` | 20261013100000_crm_analysis_speed.sql | nulle part | 20261014100000_crm_score_timing.sql, 20261019300000_external_tickets_raw_minimized.sql |
| `public._crm_cond_leaf_check(p_k text, p_v jsonb, p_ctx text)` | 20261016100000_crm_scenario_conditions.sql | nulle part | 20261018100000_crm_shotgun_country_source_people.sql |
| `public._crm_cond_leaf_sql(p_k text, p_v jsonb, p_p text, p_r text)` | 20261016100000_crm_scenario_conditions.sql | nulle part | — |
| `public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[])` | 20261016130000_crm_scenario_engine.sql | nulle part | 20261019300000_external_tickets_raw_minimized.sql, 20261019310000_ticketing_erasure_from_provider.sql |
| `public._crm_filter_sql(p_def jsonb, p_alias text)` | 20261012110000_crm_prediction_reads.sql | nulle part | 20261016230000_crm_segments_anchors_async.sql, 20261018100000_crm_shotgun_country_source_people.sql |
| `public._crm_night_tiers(p_event_id uuid, p_deals jsonb)` | 20261006210000_crm_sales_truth.sql | nulle part | 20261018210000_crm_screens_set_based.sql, 20261020200000_crm_door_rule_free_entries.sql |
| `public._crm_scenario_advance(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_started tim)` | 20261016130000_crm_scenario_engine.sql | nulle part | — |
| `public._crm_scenario_candidates(p_s crm_scenarios, p_graph jsonb, p_published timestamp with time zone)` | 20261016130000_crm_scenario_engine.sql | nulle part | 20261020200000_crm_door_rule_free_entries.sql |
| `public._crm_score_journal(p_scope text, p_venue_id text, p_organizer_user_id uuid)` | 20261013110000_crm_prediction_journal.sql | nulle part | 20261014100000_crm_score_timing.sql |
| `public._crm_score_settle(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_now timesta)` | 20261013110000_crm_prediction_journal.sql | nulle part | 20261014100000_crm_score_timing.sql |
| `public._crm_score_targets(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_cfg jsonb, )` | 20261014100000_crm_score_timing.sql | nulle part | — |
| `public._crm_signal_coverage(p_venue_id text, p_organizer_user_id uuid)` | 20261010100000_crm_analysis_coverage.sql | nulle part | 20261019300000_external_tickets_raw_minimized.sql |
| `public._crm_signup_buyer_ids(p_page_id uuid)` | 20261007193500_crm_signup_pages_v2.sql | nulle part | — |
| `public._crm_signup_known(p crm_signup_pages, p_email text, p_phone text)` | 20261007193500_crm_signup_pages_v2.sql | nulle part | — |
| `public.auto_dispute_stale_promoter_payouts()` | 20260721090000_promoter_payout_reference_dispute.sql | nulle part | — |
| `public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid)` | 20260915180000_contact_base_engagement.sql | 20260929270000_contact_base_cache_swr.sql sur origin/claude/dashboard-perf-fullscreen-szl3ft | 20261018210000_crm_screens_set_based.sql, 20261020200000_crm_door_rule_free_entries.sql |
| `public.crm_admin_analysis(p_scope_key text)` | 20261013110000_crm_prediction_journal.sql | nulle part | — |
| `public.crm_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text, p_event uuid)` | 20261016210000_crm_screens_at_scale.sql | nulle part | 20261018100000_crm_shotgun_country_source_people.sql |
| `public.crm_client__core(p_venue_id text, p_organizer_user_id uuid, p_email text)` | 20261008210000_crm_file_history.sql | nulle part | — |
| `public.crm_holdout_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer)` | 20261013120000_crm_holdout.sql | nulle part | 20261016120000_crm_scenarios.sql |
| `public.crm_night_guestlist__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | 20261008111000_crm_guest_list_min_sample.sql | nulle part | — |
| `public.crm_night_links(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | 20261007120000_crm_link_story_photo.sql | nulle part | 20261019300000_external_tickets_raw_minimized.sql |
| `public.crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | 20261016155000_crm_night_plan.sql | nulle part | 20261016230000_crm_segments_anchors_async.sql |
| `public.crm_night_targets(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | 20261014130000_crm_night_targets_order.sql | nulle part | 20261016140000_crm_scenario_editor.sql, 20261016230000_crm_segments_anchors_async.sql |
| `public.crm_weekly_review(p_venue_id text, p_organizer_user_id uuid)` | 20261016175000_crm_weekly_review.sql | nulle part | — |
| `public.dispute_promoter_payout(p_payout_id uuid, p_reason text)` | 20260721090000_promoter_payout_reference_dispute.sql | nulle part | — |
| `public.dj_remind_unpaid_fee(p_dj_set_id uuid)` | 20260621100000_dj_remind_unpaid_fee.sql | 20260925233000_dj_fee_reminder_dj_id.sql sur origin/claude/dazzling-euler-e0j51j | — |
| `private.get_cron_secret()` | 20260430181933_e97dbd86-9f94-4c91-b691-7fa1ce395821.sql | nulle part | — |
| `public.get_external_event_live(p_event_ids uuid[])` | 20261008150000_email_yuno_blocks_live.sql | nulle part | 20261009150000_mcp_email_drafts.sql |
| `public.guard_promoter_payout_write()` | 20260721090000_promoter_payout_reference_dispute.sql | nulle part | 20261005212000_payout_agency_guards_anon.sql |
| `public.preview_unsubscribe(p_token uuid)` | 20260428103535_7d3d4017-3702-4465-ab18-765d9bada90d.sql | nulle part | — |
| `public.record_campaign_list_baseline(p_campaign_id uuid)` | 20260915180000_contact_base_engagement.sql | nulle part | 20260915181000_contact_engagement_internal_context.sql |
| `public.resolve_campaign_audience(p_campaign_id uuid)` | 20261005211000_email_push_guards_anon.sql | 20261019150000_crm_practical_email.sql sur claude/elastic-bhaskara-96eee4, crm/s11-practical-email (+1) | 20261009150000_mcp_email_drafts.sql |
| `public.ticketing_after_sync(p_connection_id uuid)` | 20261018220000_ticketing_after_sync_incremental.sql | nulle part | 20261019310000_ticketing_erasure_from_provider.sql |
| `public.unsubscribe_by_token(p_token uuid)` | 20260428101010_d5087a63-fd12-4621-8a2a-1650e2b6dd59.sql | nulle part | — |

## Créées par le dépôt, absentes de la prod (11)

Une reconstruction depuis le dépôt les créerait ; la prod ne les a pas (supprimées hors migration, ou relevé imparfait : à lire avant d'en tirer quoi que ce soit).

- `public._deliver_contest_reward` — 20260612150000_leaderboard_fixes.sql
- `public._leaderboard_user_activity` — 20260612150000_leaderboard_fixes.sql
- `public._sync_contest_winner_redeemed` — 20260612150000_leaderboard_fixes.sql
- `public.auto_finalize_leaderboard_contests` — 20260407154801_eaa35d9e-1a74-4871-8dc5-76dd01bedbe8.sql
- `public.calculate_client_scores` — 20260612150000_leaderboard_fixes.sql
- `public.calculate_contest_scores` — 20260612150000_leaderboard_fixes.sql
- `public.finalize_leaderboard_contest` — 20260612150000_leaderboard_fixes.sql
- `public.guard_promoter_conversion_settlement` — 20260721090000_promoter_payout_reference_dispute.sql
- `public.recalc_all_leaderboards` — 20260612150000_leaderboard_fixes.sql
- `public.sync_organizer_role_from_profile` — 20260421150210_b3a649d6-33b5-47ee-a660-6a037e6e7e94.sql
- `public.upsert_staff_pin_rate_limit` — 20260512100000_staff_pin_rate_limit_table.sql
