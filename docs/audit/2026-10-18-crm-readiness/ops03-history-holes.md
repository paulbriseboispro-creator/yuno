# OPS-03 — objets de la prod qu'aucune migration du dépôt ne crée (2026-10-18T12:29Z)

Catalogue de la prod (lecture seule) contre un relevé statique des 1231 fichiers de `supabase/migrations`
(`CREATE TABLE/VIEW/TYPE/TRIGGER/POLICY`, `cron.schedule`, renommages). Méthode et limites : en-tête de
`scripts/crm-bench/history-holes.mjs`. « Nommé ailleurs » = le nom apparaît dans un fichier du dépôt (création
dynamique probable par `EXECUTE`, ou objet seulement modifié) ; « nulle part » = trou certain de l'historique.

| Objets | En prod | Sans création dans le dépôt | dont nommés ailleurs | dont trouvés sur une autre branche |
|---|---|---|---|---|
| tables | 400 | 4 | 4 | 2 |
| vues | 19 | 0 | 0 | 0 |
| vues matérialisées | 1 | 0 | 0 | 0 |
| types | 15 | 0 | 0 | 0 |
| triggers | 354 | 12 | 0 | 2 |
| policies | 844 | 6 | 0 | 0 |
| crons | 64 | 11 | 11 | 1 |

## tables (4)

- `private.secrets` — nommé dans le dépôt (création dynamique ?)
- `public.contact_base_cache` — branche : 20260929260000_contact_base_cache.sql (origin/claude/dashboard-perf-fullscreen-szl3ft)
- `public.contact_base_cache_state` — branche : 20260929260000_contact_base_cache.sql (origin/claude/dashboard-perf-fullscreen-szl3ft)
- `public.email_templates` — nommé dans le dépôt (création dynamique ?)

## triggers (12)

- `public.affiliate_clicks trg_affiliate_clicks_require_target` — branche : 20260925230000_affiliate_clicks_survive_event_purge.sql (origin/claude/nifty-cori-dcjxgd)
- `public.contact_engagement contact_base_cache_del` — **nulle part**
- `public.contact_engagement contact_base_cache_ins` — **nulle part**
- `public.contact_engagement contact_base_cache_upd` — **nulle part**
- `public.contact_list_imports contact_base_cache_del` — **nulle part**
- `public.contact_list_imports contact_base_cache_ins` — **nulle part**
- `public.contact_list_imports contact_base_cache_upd` — **nulle part**
- `public.email_campaigns trg_b_crm_practical_email` — branche : 20261019150000_crm_practical_email.sql (claude/elastic-bhaskara-96eee4)
- `public.email_templates trg_email_templates_updated_at` — **nulle part**
- `public.imported_contacts contact_base_cache_del` — **nulle part**
- `public.imported_contacts contact_base_cache_ins` — **nulle part**
- `public.imported_contacts contact_base_cache_upd` — **nulle part**

## policies (6)

- `public.email_templates Super admins manage email templates` — **nulle part**
- `storage.objects Admins manage email assets` — **nulle part**
- `storage.objects Organizers manage own org folder` — **nulle part**
- `storage.objects Public read all yuno buckets` — **nulle part**
- `storage.objects Users manage own profile photos` — **nulle part**
- `storage.objects Venue staff manage venue files` — **nulle part**

## crons (11)

- `cart-abandonment-check` — nommé dans le dépôt (création dynamique ?)
- `cleanup-pending-purchases` — nommé dans le dépôt (création dynamique ?)
- `contact-base-cache-refresh` — branche : 20260929270000_contact_base_cache_swr.sql (origin/claude/dashboard-perf-fullscreen-szl3ft)
- `event-reminder-hourly` — nommé dans le dépôt (création dynamique ?)
- `inactivity-reminder-weekly` — nommé dans le dépôt (création dynamique ?)
- `process-scheduled-campaigns` — nommé dans le dépôt (création dynamique ?)
- `send-low-ticket-alert-hourly` — nommé dans le dépôt (création dynamique ?)
- `send-missed-you-weekly` — nommé dans le dépôt (création dynamique ?)
- `send-next-event-recommendation` — nommé dans le dépôt (création dynamique ?)
- `send-pre-night-checklist` — nommé dans le dépôt (création dynamique ?)
- `weekly-digest` — nommé dans le dépôt (création dynamique ?)
