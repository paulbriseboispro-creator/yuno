# API Shotgun — ce qu'elle rend vraiment (relevé du 2026-10-05)

> Source : les deux pages officielles liées depuis le centre d'aide pro de
> Shotgun (« Find your Organizer id and API token ») :
> - Tickets : https://shotguntheapp.notion.site/tickets-API-2a2655f4cc2a80bfa811f3b93a889666
> - Events : https://shotguntheapp.notion.site/Organizer-events-API-e2bb2f2c63fa4caf827a9d4949ae62ae
>
> Le 02/10, la page Tickets ne documentait pas la réponse : le connecteur a donc
> été écrit en lecture TOLÉRANTE. Le schéma est désormais publié, champ par champ.
> **Toute métrique Yuno CRM bâtie sur un billet Shotgun doit sortir d'un champ de
> cette liste.** Un champ absent ici n'existe pas : on ne l'affiche pas.

## Tickets — `GET https://api.shotgun.live/tickets`

Auth organisateur : `Authorization: Bearer <token>` (ou `?token=`). Partenaire :
`?key=`. Quota : **100 requêtes / minute / IP**. Paramètres : `organizer_id`
(obligatoire), `event_id`, `include_cohosted_events=1`, `after` (ISO, ou
`<date>_<ticket_id>`). Tri : mise à jour croissante puis id. 100 billets par
page, `pagination.next`, pas de total. Réponse : `{ params, pagination, data: [...] }`.

**Un objet = UN billet** (pas de quantité). Montants **en centimes**.

| Champ | Type | Null | Sens |
|---|---|---|---|
| `ticket_id` | int | non | id du billet |
| `ticket_scan_code` | string | non | valeur du QR (jamais stockée chez Yuno) |
| `ticket_scanned_at` | ISO | oui | scan à l'entrée ; null si pas scanné **ou scanné par un prestataire externe** |
| `ticket_updated_at` | ISO | non | dernière mise à jour (curseur) |
| `ticket_canceled_at` | ISO | oui | date d'annulation |
| `ticket_status` | enum | non | `valid`, `resold`, `refunded`, `canceled`, `payment_plan_pending`, `pending_approval`, `rejected` |
| `ticket_seating` | objet | oui | `{id, type: Booth/GeneralAdmissionArea/Seat/Table, entrance, section, row, seat}` |
| `user_id` | int | oui | compte Shotgun du détenteur |
| `deal_id` | int | non | tarif (produit) |
| `deal_sub_category` | string | oui | catégorie du tarif |
| `deal_title` | string | non | nom du tarif |
| `deal_channel` | enum | non | `online`, `invitation`, `onsite`, `venue`, `distributor`, `duplicata`, `offline`, `pass_culture`, `reseller` |
| `deal_visibilities` | string[] | non | `public`, `private`, `promoters`, `xpress_door` |
| `deal_price` | int | non | **prix en centimes** |
| `deal_service_fee` | int | non | frais organisateur, centimes |
| `deal_user_service_fee` | int | non | frais payés par le client, centimes |
| `deal_producer_cost` | int | non | DL prod (France), centimes |
| `deal_vat_rate` | float | non | taux de TVA |
| `order_id` | int | non | commande (plusieurs billets possibles) |
| `currency` | enum | non | `eur`, `usd`, `brl` |
| `payment_method` | string | oui | `card`, `cash`, `physical_card`, `installments`… null si importé |
| `utm_source` | string | oui | `shotgun` (app / site Shotgun), `direct`, ou **le nom de l'origine** (ex. `instagram`, ou la source d'un lien de suivi) ; null si importé |
| `utm_medium` | string | oui | **`website`, `app` ou `widget`** pour une commande en ligne (la PLATEFORME, pas le support marketing) ; null sinon |
| `ordered_at` | ISO | non | création de la commande |
| `event_id`, `event_start_time`, `event_end_time`, `event_created_at`, `event_published_at`, `event_launched_at`, `event_canceled_at` | | | la soirée du billet |
| `contact_id` | int | oui | contact (DÉTENTEUR du billet) |
| `contact_email` | string | oui | email du détenteur |
| `contact_phone` | string | oui | téléphone |
| `contact_first_name`, `contact_last_name` | string | oui | nom |
| `contact_gender` | enum | oui | `female`, `male`, `other` |
| `contact_company_name` | string | oui | société |
| `contact_birthday` | YYYY-MM-DD | oui | **hors Brésil, seule l'ANNÉE est demandée** (jour et mois = 01) : l'âge est donc à ±1 an |
| `contact_newsletter_optin` | bool | oui | abonné à la newsletter de l'organisateur ; false = désinscrit ; null = jamais demandé |
| `contact_country` | string | oui | **NOM** du pays (« France »), pas un code ISO |
| `contact_postal_code` | string | oui | code postal |
| `contact_locality` | string | oui | ville |

**Ce que l'API ne rend PAS** (donc aucun écran Yuno CRM ne peut l'afficher pour
une soirée Shotgun) : `utm_campaign`, `utm_content`, `utm_term` ; le canal
précis d'une vente au-delà de `utm_source` ; les VISITES de la page de vente
(Shotgun les montre dans son Smartboard « Event Traffic », pas dans l'API) ; le
panier abandonné ; l'acheteur distinct du détenteur ; les remboursements partiels.

Le centre d'aide Shotgun précise aussi : « Resold / transferred tickets are
currently not counted in sales tracking metrics ».

## Events — `GET https://smartboard-api.shotgun.live/api/shotgun/organizers/{ID}/events`

Auth : `?key=` (`?token=` déprécié). À venir par défaut ; `past_events=true` +
`page` / `limit` (défaut 0 / 20) ; `updated_after` ; `name`.

Champs : `id, name, startTime, endTime, slug, timezone, artists[]{id, name, slug,
avatar, url}, genres[]{name}, leftTicketsCount, description, coverUrl,
coverThumbnailUrl, trailerUrl, url, addressVisibility, geolocation{street,
latitude, longitude, city, cityId, zipCode, country, countryIsoCode, countryId},
publishedAt, launchedAt, cancelledAt, organizer{name, slug}, role, deals[]{name,
product_id, description, quantity, target, subcategory_id, subcategory{id, name,
start_time}, visiblity, sales_channel, price, organizer_fees, user_fees},
typeOfPlace`.

**Montants des `deals` en EUROS** (`price: 10`, `organizer_fees: 0.99`),
contrairement aux billets (centimes). `deals[].quantity` = stock du tarif ;
`leftTicketsCount` = places restantes de la soirée.

## Liens suivis vers Shotgun (centre d'aide, « Tracking Links »)

Un lien de suivi Shotgun est l'URL de la page de soirée avec un paramètre de
source ; la source se retrouve dans la colonne `utm_source` de l'export des
commandes, et dans le champ `utm_source` de l'API Tickets. Conséquence pour
Yuno : **un lien Yuno qui redirige vers Shotgun doit porter TOUT son
identifiant dans `utm_source`** — c'est le seul champ que l'API rend tel quel
(`utm_medium` est écrasé par la plateforme, `utm_campaign` n'est pas rendu).
