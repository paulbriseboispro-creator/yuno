# Séparation entre espaces — banc, 2026-10-18T12:25Z

206 fonctions (définitions de la prod), appelées par A (titulaire) puis par B (autre compte CRM), arguments visant l'espace A — couple de CLUBS (`venue:bench-club-a` contre `venue:bench-club-b`, chacun propriétaire du sien).

| Verdict | Fonctions |
|---|---|
| refused | 156 |
| silent | 9 |
| SAME | 8 |
| inconclus | 33 |
| non testée | 0 |


| Fonction | Verdict | A | B |
|---|---|---|---|
| `analyze_contact_list_import(p_list_import_id uuid)` | refused | ok n=1 ("{""facts"": {""age"": {""avg"": null,  | 42501 Unauthorized |
| `analyze_contact_lists(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""facts"": {""age"": {""avg"": null,  | 42501 Unauthorized |
| `campaign_scope_is_event_principal(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | SAME | ok n=1 (t) | ok n=1 (t) |
| `check_contact_import(p_venue_id text, p_organizer_user_id uuid, p_emails text[], )` | refused | ok n=1 ("{""emails"": 1, ""phones"": 0, ""overl | P0001 Unauthorized |
| `contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid)` | SAME | ok n=1 (v:bench-club-a) | ok n=1 (v:bench-club-a) |
| `contact_scope_allowed(p_venue_id text, p_organizer_user_id uuid)` | silent | ok n=1 (t) | ok n=1 (f) |
| `contact_scope_allowed_or_internal(p_venue_id text, p_organizer_user_id uuid)` | silent | ok n=1 (t) | ok n=1 (f) |
| `count_campaign_audience(p_campaign_id uuid)` | refused | ok n=1 ("{""net"": 4, ""gross"": 4, ""suppresse | P0001 Unauthorized |
| `count_campaign_recipients(p_venue_id text, p_type text, p_audience_type text, p_event_)` | refused | ok n=1 (0) | P0001 Unauthorized |
| `count_campaign_recipients_org(p_organizer_user_id uuid, p_type text, p_audience_type text,)` | inconclus (même erreur) | P0001 Unauthorized | P0001 Unauthorized |
| `count_contact_segment(p_segment_id uuid)` | refused | ok n=1 ("{""emails"": 4, ""phones"": 0, ""conta | 42501 Unauthorized |
| `count_contact_segment_def(p_venue_id text, p_organizer_user_id uuid, p_definition json)` | refused | ok n=1 ("{""emails"": 4, ""phones"": 0, ""conta | 42501 Unauthorized |
| `crm_admin_account(p_scope_key text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_analysis(p_scope_key text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_demo_link_mark(p_id uuid, p_channel text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_demo_link_revoke(p_id uuid)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_demo_link_update(p_id uuid, p_patch jsonb)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_extend_trial(p_scope_key text, p_days integer, p_reason text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_freeze(p_scope_key text, p_frozen boolean, p_reason text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_grant_yunits(p_scope_key text, p_amount integer, p_reason text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_incident_pros(p_id uuid)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_incident_save(p_id uuid, p_patch jsonb, p_reason text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_invite_extend(p_id uuid)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_note_save(p_scope_key text, p_body text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_offer_invite_mark(p_id uuid, p_channel text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_offer_invite_revoke(p_id uuid, p_reason text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_offer_invite_update(p_id uuid, p_patch jsonb)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_prospect_delete(p_id uuid)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_prospect_log(p_id uuid, p_text text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_admin_prospect_save(p_id uuid, p_patch jsonb)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_ana_community(p_venue_id text, p_organizer_user_id uuid, p_period text, p_)` | refused | ok n=1 ("{""age"": {""b"": [0, 0, 0, 0, 0], ""k | 42501 forbidden |
| `crm_ana_guestlist(p_venue_id text, p_organizer_user_id uuid, p_period text)` | refused | ok n=1 ("{""conv"": {""revenue"": 0.00, ""eligi | 42501 forbidden |
| `crm_ana_sales(p_venue_id text, p_organizer_user_id uuid, p_period text, p_)` | refused | ok n=1 ("{""msg"": {""by"": {""dm"": 0, ""em"": | 42501 forbidden |
| `crm_ana_traffic(p_venue_id text, p_organizer_user_id uuid, p_period text, p_)` | refused | ok n=1 ("{""meta"": {""n"": 22, ""tz"": ""Europ | 42501 forbidden |
| `crm_analysis_overview(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""once"": {""n"": 0, ""local"": 0, "" | 42501 forbidden |
| `crm_artists_analysis(p_venue_id text, p_organizer_user_id uuid, p_limit integer)` | refused | ok n=1 ("{""total"": 0, ""family"": null, ""art | 42501 forbidden |
| `crm_audience_count(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_em)` | refused | ok n=1 ("{""sms"": 0, ""email"": 1, ""total"":  | 42501 forbidden |
| `crm_audience_counts(p_venue_id text, p_organizer_user_id uuid, p_defs jsonb)` | refused | ok n=1 ([]) | 42501 forbidden |
| `crm_automation_save(p_venue_id text, p_organizer_user_id uuid, p_kind text, p_en)` | refused | 22023 bad_kind | 42501 forbidden |
| `crm_automation_sms_save(p_venue_id text, p_organizer_user_id uuid, p_kind text, p_en)` | refused | 22023 bad_kind | 42501 forbidden |
| `crm_automations(p_venue_id text, p_organizer_user_id uuid, p_period text)` | refused | ok n=1 ("{""now"": ""2026-10-18T12:25:45.612+00 | 42501 forbidden |
| `crm_client(p_venue_id text, p_organizer_user_id uuid, p_email text)` | refused | ok n=1 ("{""gl"": {""n"": 0, ""came"": 0, ""con | 42501 forbidden |
| `crm_client_analysis(p_venue_id text, p_organizer_user_id uuid, p_email text)` | refused | ok n=1 ("{""profile"": false, ""excluded"": fal | 42501 forbidden |
| `crm_client_save(p_venue_id text, p_organizer_user_id uuid, p_email text, p_t)` | refused | ok n=1 ("{""ok"": true}") | 42501 forbidden |
| `crm_clients_export(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_em)` | refused | ok n=1 ("{""rows"": [[""client0@a.test"", ""Cli | 42501 forbidden |
| `crm_clients_list(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_so)` | refused | ok n=1 ("{""rows"": [], ""total"": 4, ""counts" | 42501 forbidden |
| `crm_clients_overview(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""once"": 0, ""prev"": {""total"": 0, | 42501 forbidden |
| `crm_demo_link_for_email(p_id uuid)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_email_analysis(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""grid"": [], ""audience"": {""unsub" | 42501 forbidden |
| `crm_email_audience_preview(p_venue_id text, p_organizer_user_id uuid, p_audiences jsonb)` | refused | ok n=1 ("{""net"": 0, ""reach"": 0, ""x_buyers" | 42501 forbidden |
| `crm_email_audience_sizes(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[])` | refused | ok n=1 ({}) | 42501 forbidden |
| `crm_email_campaigns(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""campaigns"": [{""id"": ""cccccccc-0 | 42501 forbidden |
| `crm_email_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer)` | refused | ok n=1 ("{""to"": ""2026-10-18T12:25:45.756+00: | 42501 forbidden |
| `crm_email_recipient_emails(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uui)` | refused | ok n=1 ("{""emails"": [""client0@a.test""]}") | 42501 forbidden |
| `crm_email_recipients(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uui)` | refused | ok n=1 ("{""rows"": [], ""total"": 1, ""counts" | 42501 forbidden |
| `crm_email_result(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uui)` | refused | ok n=1 ("{""id"": ""cccccccc-0000-4000-8000-000 | 42501 forbidden |
| `crm_email_result_segments(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uui)` | refused | ok n=1 ([]) | 42501 forbidden |
| `crm_email_send_options(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""auto"": [{""key"": ""hab"", ""reach | 42501 forbidden |
| `crm_email_sender_readiness(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""demo"": false, ""ready"": false, "" | 42501 forbidden |
| `crm_email_settings_get(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""waves"": false, ""defaults"": {""ci | 42501 forbidden |
| `crm_email_settings_set(p_venue_id text, p_organizer_user_id uuid, p_patch jsonb)` | refused | ok n=1 ("{""waves"": false, ""defaults"": {""ci | 42501 forbidden |
| `crm_events_brief(p_venue_id text, p_organizer_user_id uuid, p_limit integer)` | silent | ok n=1 ("[{""id"": ""eeeeeeee-0000-4000-8000-00 | ok n=1 () |
| `crm_feature_request_submit(p_venue_id text, p_organizer_user_id uuid, p_body text)` | refused | 22023 too_short | 42501 forbidden |
| `crm_feature_waitlist_get(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ({}) | 42501 forbidden |
| `crm_feature_waitlist_set(p_venue_id text, p_organizer_user_id uuid, p_feature text, p)` | refused | 22023 unknown_feature | 42501 forbidden |
| `crm_holdout_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer)` | refused | ok n=1 ("{""pct"": 10, ""sends"": []}") | 42501 forbidden |
| `crm_holdout_set(p_venue_id text, p_organizer_user_id uuid, p_pct integer)` | refused | ok n=1 ("{""ok"": true, ""pct"": 10}") | 42501 forbidden |
| `crm_holdout_settings(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""pct"": 10, ""can_edit"": true}") | 42501 forbidden |
| `crm_home(p_venue_id text, p_organizer_user_id uuid, p_period text)` | refused | ok n=1 ("{""tz"": ""Europe/Paris"", ""kpi"": {" | 42501 forbidden |
| `crm_import_check(p_venue_id text, p_organizer_user_id uuid, p_emails text[], )` | refused | ok n=1 ("{""emails"": [{""e"": ""client0@a.test | 42501 forbidden |
| `crm_import_commit(p_venue_id text, p_organizer_user_id uuid, p_list_import_id )` | refused | 22023 invalid_rows | 42501 forbidden |
| `crm_import_undo(p_venue_id text, p_organizer_user_id uuid, p_list_import_id )` | refused | P0002 import_not_found | 42501 forbidden |
| `crm_imports_overview(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""sync"": {""day"": ""2026-10-18"", " | 42501 forbidden |
| `crm_instagram_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer)` | refused | ok n=1 ("{""at"": ""2026-10-18T12:25:45.882+00: | 42501 forbidden |
| `crm_instagram_rule_delete(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | P0002 not_found | 42501 forbidden |
| `crm_instagram_rule_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patc)` | refused | 22023 bad_keyword | 42501 forbidden |
| `crm_journey(p_venue_id text, p_organizer_user_id uuid, p_period text, p_)` | refused | ok n=1 ("{""to"": ""2026-10-18T12:25:45.887+00: | 42501 forbidden |
| `crm_learning_contrib_get(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""demo"": false, ""holder"": true, "" | 42501 forbidden |
| `crm_learning_contrib_set(p_venue_id text, p_organizer_user_id uuid, p_on boolean)` | refused | ok n=1 ("{""global_enabled"": false, ""learning | 42501 forbidden |
| `crm_link_create(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid, )` | inconclus (même erreur) | 2201B invalid regular expression: invalid repetition count(s) | 2201B invalid regular expression: invalid repetition count(s) |
| `crm_link_update(p_venue_id text, p_organizer_user_id uuid, p_link_id uuid, p)` | refused | 22023 link_not_found | 42501 forbidden |
| `crm_night_analysis(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | refused | ok n=1 ("{""profile"": false}") | 42501 forbidden |
| `crm_night_detail(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | refused | ok n=1 ("{""id"": ""eeeeeeee-0000-4000-8000-000 | 42501 forbidden |
| `crm_night_guestlist(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | refused | ok n=1 ("{""who"": {""gl"": 0, ""first"": 0, "" | 42501 forbidden |
| `crm_night_links(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | refused | ok n=1 ("{""error"": ""not_found""}") | 42501 forbidden |
| `crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | refused | ok n=1 ("{""ok"": false, ""error"": ""not_upcom | 42501 forbidden |
| `crm_night_targets(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | refused | ok n=1 ("{""ok"": false, ""error"": ""not_upcom | 42501 forbidden |
| `crm_nights(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""now"": ""2026-10-18T12:25:45.939+00 | 42501 forbidden |
| `crm_notif_prefs_get(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""kinds"": {""prog"": {""a"": true, " | 42501 forbidden |
| `crm_notif_prefs_set(p_venue_id text, p_organizer_user_id uuid, p_patch jsonb)` | refused | ok n=1 ("{""kinds"": {""prog"": {""a"": true, " | 42501 forbidden |
| `crm_notifications_mark(p_venue_id text, p_organizer_user_id uuid, p_ids text[], p_a)` | refused | 22023 bad_action | 42501 forbidden |
| `crm_nps_should_ask(p_venue_id text, p_organizer_user_id uuid)` | inconclus (réponse vide pour A aussi) | ok n=1 (f) | ok n=1 (f) |
| `crm_nps_submit(p_venue_id text, p_organizer_user_id uuid, p_score integer, )` | refused | ok n=1 ("") | 42501 forbidden |
| `crm_offer_claim(p_token text, p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""ok"": false, ""reason"": ""unknown" | 42501 not_account_owner |
| `crm_offer_invite_for_email(p_id uuid)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_org_role(p_user_id uuid, p_organizer_user_id uuid)` | inconclus (réponse vide pour A aussi) | ok n=1 () | ok n=1 () |
| `crm_practical_email_check(p_campaign_id uuid)` | refused | 3F000 schema "extensions" does not exist | 42501 forbidden |
| `crm_practical_night(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)` | refused | ok n=1 ("{""max"": 3, ""role"": null, ""sent"": | 42501 forbidden |
| `crm_profile_optout(p_venue_id text, p_organizer_user_id uuid, p_email text, p_o)` | refused | ok n=1 ("{""email"": ""client0@a.test"", ""excl | 42501 forbidden |
| `crm_request_trial_extension(p_venue_id text, p_organizer_user_id uuid)` | refused | 22023 no_extension_left | 42501 forbidden |
| `crm_rules_preview(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""at"": ""2026-10-18T12:25:45.961+00: | 42501 forbidden |
| `crm_scenario(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | P0002 not_found | 42501 forbidden |
| `crm_scenario_counts(p_venue_id text, p_organizer_user_id uuid, p_tree jsonb, p_e)` | refused | ok n=1 ("{""total"": 4, ""errors"": [{""code"": | 42501 forbidden |
| `crm_scenario_delete(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | P0002 not_found | 42501 forbidden |
| `crm_scenario_duplicate(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name)` | refused | P0002 not_found | 42501 forbidden |
| `crm_scenario_preview(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | P0002 not_found | 42501 forbidden |
| `crm_scenario_publish(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_expe)` | refused | P0002 not_found | 42501 forbidden |
| `crm_scenario_report(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | P0002 not_found | 42501 forbidden |
| `crm_scenario_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name)` | refused | 22023 bad_graph | 42501 forbidden |
| `crm_scenario_set_status(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_stat)` | refused | P0002 not_found | 42501 forbidden |
| `crm_scenarios(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""can_edit"": true, ""scenarios"": [] | 42501 forbidden |
| `crm_scope_allowed(p_venue_id text, p_organizer_user_id uuid)` | silent | ok n=1 (t) | ok n=1 (f) |
| `crm_scope_has_crm(p_scope_key text)` | SAME | ok n=1 (t) | ok n=1 (t) |
| `crm_scope_key(p_venue_id text, p_organizer_user_id uuid)` | SAME | ok n=1 (venue:bench-club-a) | ok n=1 (venue:bench-club-a) |
| `crm_scope_paused(p_scope_key text)` | inconclus (réponse vide pour A aussi) | ok n=1 (f) | ok n=1 (f) |
| `crm_scope_sees_money(p_venue_id text, p_organizer_user_id uuid)` | silent | ok n=1 (t) | ok n=1 (f) |
| `crm_scope_writable(p_venue_id text, p_organizer_user_id uuid)` | silent | ok n=1 (t) | ok n=1 (f) |
| `crm_search(p_venue_id text, p_organizer_user_id uuid, p_q text)` | refused | ok n=1 ("{""nights"": [], ""clients"": [{""emai | 42501 forbidden |
| `crm_segment_catalog(p_venue_id text, p_organizer_user_id uuid, p_items jsonb)` | refused | ok n=1 ("{""home"": null, ""items"": [], ""tota | 42501 forbidden |
| `crm_segment_delete(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | ok n=1 (f) | 42501 forbidden |
| `crm_segment_detail(p_venue_id text, p_organizer_user_id uuid, p_seg_key text, p)` | refused | ok n=1 () | 42501 forbidden |
| `crm_segment_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name)` | refused | ok n=1 ("{""id"": ""4ddf75a0-a54f-4a53-8d0e-4e5 | 42501 forbidden |
| `crm_segments_brief(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ([]) | 42501 forbidden |
| `crm_segments_create_many(p_venue_id text, p_organizer_user_id uuid, p_items jsonb)` | refused | 22023 invalid_items | 42501 forbidden |
| `crm_segments_fill_anchors(p_venue_id text, p_organizer_user_id uuid, p_period text)` | refused | ok n=1 ("{""filled"": ""2026-09-18"", ""remaini | 42501 forbidden |
| `crm_segments_overview(p_venue_id text, p_organizer_user_id uuid, p_period text)` | refused | ok n=1 ("{""to"": ""2026-10-18T12:25:46.065+00: | 42501 forbidden |
| `crm_signal_coverage(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""totals"": {""sales"": 6, ""valid"": | 42501 forbidden |
| `crm_signup_page_ai_proposal(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_acti)` | refused | P0002 not_found | 42501 forbidden |
| `crm_signup_page_delete(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | 22023 not_deletable | 42501 forbidden |
| `crm_signup_page_detail(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | P0002 not_found | 42501 forbidden |
| `crm_signup_page_emails(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | ok n=1 ([]) | 42501 forbidden |
| `crm_signup_page_export(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | ok n=1 ([]) | 42501 forbidden |
| `crm_signup_page_notify_now(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | P0002 not_found | 42501 forbidden |
| `crm_signup_page_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patc)` | refused | ok n=1 (521df181-445f-4b02-93a6-75c3e5edeb64) | 42501 forbidden |
| `crm_signup_page_set_status(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_stat)` | refused | P0002 not_found | 42501 owner_only |
| `crm_signup_page_stats(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | P0002 not_found | 42501 forbidden |
| `crm_signup_pages_list(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""at"": ""2026-10-18T12:25:46.118+00: | 42501 forbidden |
| `crm_sms_analysis(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""campaigns"": []}") | 42501 forbidden |
| `crm_sms_audience_preview(p_venue_id text, p_organizer_user_id uuid, p_audiences jsonb)` | refused | ok n=1 ("{""net"": 0, ""reach"": 0, ""x_cap"":  | 42501 forbidden |
| `crm_sms_campaigns(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""campaigns"": [{""id"": ""88888888-0 | 42501 forbidden |
| `crm_sms_delete(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[])` | refused | ok n=1 ("{""deleted"": 0}") | 42501 forbidden |
| `crm_sms_draft_sizes(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[])` | refused | ok n=1 ({}) | 42501 forbidden |
| `crm_sms_duplicate(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name)` | refused | P0002 not_found | 42501 forbidden |
| `crm_sms_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer)` | refused | ok n=1 ("{""to"": ""2026-10-18T12:25:46.14+00:0 | 42501 forbidden |
| `crm_sms_result(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uui)` | refused | ok n=1 ("{""error"": ""not_found""}") | 42501 forbidden |
| `crm_sms_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patc)` | refused | ok n=1 ("{""id"": ""64cab068-5642-48da-9faf-dd3 | 42501 forbidden |
| `crm_sms_schedule(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_at t)` | refused | P0002 not_found | 42501 forbidden |
| `crm_sms_send_options(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""auto"": [{""key"": ""hab"", ""reach | 42501 forbidden |
| `crm_sms_settings_get(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""people"": 4, ""sms_ok"": 0, ""quiet | 42501 forbidden |
| `crm_sms_settings_set(p_venue_id text, p_organizer_user_id uuid, p_patch jsonb)` | refused | ok n=1 ("{""ok"": true}") | 42501 forbidden |
| `crm_sms_unschedule(p_venue_id text, p_organizer_user_id uuid, p_id uuid)` | refused | ok n=1 ("{""ok"": false}") | 42501 forbidden |
| `crm_team_get(p_venue_id text, p_organizer_user_id uuid)` | refused | 42703 column u.last_sign_in_at does not exist | 42501 forbidden |
| `crm_team_remove(p_organizer_user_id uuid, p_member_id uuid)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_team_set_role(p_organizer_user_id uuid, p_member_id uuid, p_role text)` | inconclus (même erreur) | 42501 forbidden | 42501 forbidden |
| `crm_ticketing_set_cohosted(p_venue_id text, p_organizer_user_id uuid, p_on boolean)` | refused | ok n=1 ("{""ok"": true, ""include_cohosted"": f | 42501 forbidden |
| `crm_user_in_scope(p_user_id uuid, p_venue_id text, p_organizer_user_id uuid)` | SAME | ok n=1 (t) | ok n=1 (t) |
| `crm_user_manages_team(p_user_id uuid, p_venue_id text, p_organizer_user_id uuid)` | SAME | ok n=1 (t) | ok n=1 (t) |
| `crm_weekly_review(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""ok"": true, ""to"": ""2026-10-11T21 | 42501 forbidden |
| `email_automation_covers_event(p_event_id uuid, p_kind text)` | inconclus (réponse vide pour A aussi) | ok n=1 (f) | ok n=1 (f) |
| `email_sender_daily_cap(p_scope_key text)` | SAME | ok n=1 (300) | ok n=1 (300) |
| `email_sender_monthly_free(p_scope_key text)` | SAME | ok n=1 (1000000000) | ok n=1 (1000000000) |
| `export_contact_base(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""rows"": [[""client0@a.test"", null, | 42501 Unauthorized |
| `get_campaign_ab_stats(p_campaign_id uuid)` | refused | ok n=1 ("{""supported"": false}") | P0001 Unauthorized |
| `get_campaign_followup_stats(p_campaign_id uuid)` | refused | ok n=1 () | P0001 Unauthorized |
| `get_campaign_list_impact(p_campaign_id uuid)` | refused | ok n=1 () | 42501 Unauthorized |
| `get_campaign_resend_stats(p_campaign_id uuid)` | refused | ok n=1 ("{""child"": null, ""nobody"": false, " | P0001 Unauthorized |
| `get_campaign_send_progress(p_campaign_id uuid)` | refused | ok n=1 ("{""sent"": 0, ""opens"": 0, ""total"": | P0001 Unauthorized |
| `get_contact_intelligence_overview(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""lists"": [{""id"": ""11111111-0000- | 42501 Unauthorized |
| `get_contact_segment_panel(p_venue_id text, p_organizer_user_id uuid, p_presets jsonb)` | refused | 22023 cannot extract elements from an object | 42501 Unauthorized |
| `get_crm_billing(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""usage"": {""members"": 0, ""sync_mi | 42501 forbidden |
| `get_crm_limits(p_venue_id text, p_organizer_user_id uuid)` | silent | ok n=1 ("{""meta"": true, ""plan"": ""base"", " | ok n=1 () |
| `get_crm_night_report(p_event_id uuid)` | refused | ok n=1 ("{""utm"": [], ""curve"": [], ""deals"" | 42501 forbidden |
| `get_crm_nights(p_venue_id text, p_organizer_user_id uuid, p_limit integer, )` | refused | ok n=1 ("{""total"": 2, ""nights"": []}") | 42501 forbidden |
| `get_crm_notifications(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("[{""at"": ""2026-10-12T06:00:00+00:00" | 42501 forbidden |
| `get_crm_overview(p_venue_id text, p_organizer_user_id uuid)` | refused | 42803 column "e.title" must appear in the GROUP BY clause or be used in an aggregate function | 42501 forbidden |
| `get_crm_settings(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""can"": {""edit"": true, ""delete"": | 42501 forbidden |
| `get_crm_shell(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""badges"": {""clients"": 0, ""campai | 42501 forbidden |
| `get_crm_wallet(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""lots"": [], ""moves"": [], ""rates" | 42501 forbidden |
| `get_customer_automation_emails(p_venue_id text, p_organizer_user_id uuid, p_email text)` | refused | ok n=1 ([]) | P0001 Unauthorized |
| `get_customer_timeline(p_user_id uuid, p_venue_id text, p_organizer_user_id uuid, p)` | inconclus (réponse vide pour A aussi) | ok n=0  | ok n=0  |
| `get_email_automation_stats(p_venue_id text, p_organizer_user_id uuid, p_days integer)` | refused | ok n=1 ("[{""id"": ""77777777-0000-4000-8000-00 | P0001 Unauthorized |
| `get_email_automation_suggestions(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ([]) | P0001 Unauthorized |
| `get_email_lists_health(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("[{""dead"": 0, ""total"": 0, ""active" | P0001 Unauthorized |
| `get_email_quota_status(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""free"": 1000000000, ""paid"": 0, "" | P0001 Unauthorized |
| `get_email_send_time_insights(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""by_dow"": [0, 0, 0, 0, 0, 0, 0], "" | P0001 Unauthorized |
| `get_external_event_live(p_event_ids uuid[])` | inconclus (réponse vide pour A aussi) | ok n=0  | ok n=0  |
| `get_organizer_customer_segments(p_organizer_user_id uuid)` | inconclus (même erreur) | 42501 Not authorized for organizer <NULL> | 42501 Not authorized for organizer <NULL> |
| `get_sms_campaign_report(p_campaign_id uuid)` | inconclus (réponse vide pour A aussi) | ok n=1 () | ok n=1 () |
| `get_sms_contacts_overview(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""vip"": 0, ""active"": 0, ""events"" | P0001 Unauthorized |
| `get_sms_sender_readiness(p_venue_id text, p_organizer_user_id uuid)` | refused | ok n=1 ("{""missing"": [""legal_name"", ""regis | 42501 forbidden |
| `get_venue_customer_segments(p_venue_id text)` | refused | ok n=1 ("(9f303f63-21dc-48f9-96f0-3e2318d4cc17, | 42501 Not authorized for venue bench-club-a |
| `import_contact_list(p_rows jsonb, p_consent_source text, p_venue_id text, p_orga)` | refused | P0001 Origine du consentement requise | P0001 Unauthorized |
| `import_email_contacts(p_contacts jsonb, p_consent_source text, p_venue_id text, p_)` | refused | P0001 Origine du consentement requise | P0001 Unauthorized |
| `import_sms_contacts(p_contacts jsonb, p_consent_source text, p_venue_id text, p_)` | refused | P0001 Origine du consentement requise | P0001 Unauthorized |
| `preview_email_automation(p_venue_id text, p_organizer_user_id uuid, p_kind text)` | refused | ok n=1 ("{""base"": 4, ""eligible"": 0, ""next_ | P0001 Unauthorized |
| `purge_email_list(p_import_id uuid)` | refused | ok n=1 ("{""dead"": 0, ""removed"": 0, ""remain | P0001 Unauthorized |
| `rename_email_list_import(p_import_id uuid, p_name text)` | refused | ok n=1 ("Nom B") | P0001 Unauthorized |
| `rename_sms_list_import(p_import_id uuid, p_name text)` | refused | ok n=1 ("Nom B") | P0001 Unauthorized |
| `resolve_campaign_ab_winner(p_campaign_id uuid, p_force boolean)` | inconclus (même erreur) | P0001 resolve_campaign_ab_winner: service_role only | P0001 resolve_campaign_ab_winner: service_role only |
| `resolve_campaign_audience(p_campaign_id uuid)` | refused | ok n=4 ("(client0@a.test,,,,50cf0b98-e96b-48a6- | P0001 Unauthorized |
| `resolve_contact_segment(p_segment_id uuid)` | refused | ok n=4 ("(client0@a.test,,Client0,)")/("(client | 42501 Unauthorized |
| `resolve_contact_segment_def(p_venue_id text, p_organizer_user_id uuid, p_definition json)` | refused | ok n=4 ("(client0@a.test,,Client0,)")/("(client | 42501 Unauthorized |
| `save_contact_segments(p_venue_id text, p_organizer_user_id uuid, p_segments jsonb,)` | refused | P0001 p_segments doit être un tableau | 42501 Unauthorized |
| `set_email_campaign_send_state(p_campaign_id uuid, p_action text)` | refused | ok n=1 ("{""ok"": true, ""status"": ""draft""}" | P0001 Unauthorized |
| `sms_scope_allowed(p_venue_id text, p_organizer_user_id uuid)` | silent | ok n=1 (t) | ok n=1 (f) |
| `ticketing_scope_allowed(p_venue_id text, p_organizer_user_id uuid)` | silent | ok n=1 (t) | ok n=1 (f) |
