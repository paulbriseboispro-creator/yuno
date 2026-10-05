# Yuno CRM — Pages d'inscription (plan, 05/10)

Design : `Pages inscription.dc.html` (constructeur), `FanPage.dc.html` (page
publique), `Pages inscription Fan.dc.html` (variante). Une page = un lien et un QR
où un fan laisse son contact AVANT d'acheter ; il rejoint les Clients du pro.

## Données

- `crm_signup_pages` : portée (club OU organisateur), `slug` unique, statut
  `draft | live | closed`, occasion (`night` lié à une soirée, `community` sans
  date), soirée liée (`events.id`, miroir Shotgun compris), affiche, couleurs
  (fond + accent), police des titres, textes (titre ≤ 40, accroche ≤ 140, bouton,
  « C'est noté »), champs (`contact` = `email` | `email_phone` ; deux questions
  au plus), compteur d'inscrits affiché ou non, récompense (texte, comment la
  récupérer), dates (ouverture, ouverture de la vente → compte à rebours,
  fermeture), et les deux groupes de contacts créés à la publication
  (`contact_list_imports` + `email_list_imports`, source `website_form`).
- `crm_signup_entries` : une inscription = prénom, e-mail, téléphone facultatif,
  réponses, provenance (`src` du lien), empreinte du visiteur (jour), jeton de
  confirmation HACHÉ, `confirmed_at`, et la ligne de preuve
  `marketing_consent_events` une fois confirmée.
- `crm_signup_visits` : une visite = page, jour, empreinte, provenance (pour
  visites → inscrits par provenance). RLS sans policy partout : tout passe par
  des RPC.

## Route publique

`/j/<slug>` (`?src=<lieu>` pour la provenance), hors coquille de la Console, DA
publique (`docs/DESIGN_SYSTEM_PUBLIC.md`). **Pas `/p/<slug>`** : ce chemin est
déjà le linktree public des agences. Confirmation : `/j/<slug>/ok?t=<jeton>`.

## Inscription (anti-abus)

`submit_crm_signup` (anon, SECURITY DEFINER) : page en ligne et dans ses dates ;
empreinte salée du jour (`links_visitor_context`), 10 inscriptions / heure /
visiteur, 300 / heure / page ; e-mail valide, domaine jetable refusé (liste en
base `crm_disposable_domains`), même e-mail déjà inscrit sur la page = « déjà
inscrit » (sans révéler plus) ; case d'accord OBLIGATOIRE ; le texte exact
affiché à côté de la case est envoyé et conservé.

## RGPD

- Double confirmation : rien n'entre au registre avant le clic sur le lien de
  confirmation (e-mail « Confirmez votre inscription », DA e-mail Yuno CRM,
  file `crm_signup_entries.confirm_sent_at`, envoyé par
  `process-scheduled-campaigns` toutes les 5 minutes, idempotence Resend).
- À la confirmation : preuve dans `marketing_consent_events` (texte exact,
  langue, `source = signup_page:<id>`), contact versé dans `imported_contacts`
  (groupe de la page) et `newsletter_subscriptions` (opt-in) **sans jamais
  réveiller un désabonné** (ligne `opted_in = false`, liste repoussoir
  `email_opt_outs`, adresse supprimée → la preuve est gardée, l'abonnement non).
- Le téléphone est conservé sur l'inscription mais n'entre PAS au registre SMS
  (le SMS est hors périmètre de ce chantier) : l'écran le dit.
- Démo : une page d'une portée démo répond « page de démonstration » et
  n'enregistre aucune adresse ; aucun e-mail ne part vers une adresse démo.

## Constructeur (Console › Clients › Pages d'inscription)

Liste (statut, visites, inscrits, confirmés), création en un écran avec
l'aperçu téléphone en direct (le même composant que la page publique), lien
et QR (`qrcode`, déjà dans le projet) avec un lien par provenance (flyer, bar,
porte, story, message privé), chiffres de la page (visites → inscrits →
confirmés par provenance), export CSV des confirmés. Publier / fermer = geste
du titulaire (droit d'écriture CRM). Rien n'est publié tout seul ; l'ouverture
programmée est une date que le titulaire pose.

## Hors périmètre de cette version

Dix mises en page (une seule, réglable), messages automatiques « C'est
ouvert » aux inscrits (passent par les automatisations existantes), SMS.
