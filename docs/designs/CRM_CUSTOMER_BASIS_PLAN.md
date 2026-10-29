# Yuno CRM — écrire aux acheteurs de ses soirées (exception « clients »)

Plan du 29/10/2026. **État des lots** :
- **Lot 1** (base, déclaration, éligibilité, garde, contenu) : `20261114100000`, **appliqué en prod le 29/10**, commité.
- **Entrées gratuites comptées** (décision de Paul du 29/10, l'avocat confirmera) : `20261114110000`, écrit, testé, **pas appliqué**.
- **Lot 2** (moteur d'envoi) : `20261114120000` + `send-campaign` + pied de page des deux moteurs, banc vert (86), répétition sur les vraies données de 3 AM annulée (file en 0,6 s : 634 à l'accord + 1 439 clients, lots jamais mélangés, campagne à l'accord inchangée), **pas appliqué, pas déployé**.
- **Lot 2 appliqué en prod et `send-campaign` déployé le 29/10** (prod = origin/main avant le déploiement) ; répétition sur les fonctions vivantes : campagne « Vos clients » de 3 AM et copie de la prochaine campagne Billetterie (462 personnes) mises en file comme attendu. Aucun vrai e-mail envoyé depuis (rien n'était en cours).
- **Lot 3, code** : clé et domaine par lot, webhook à deux secrets (§ 6), commité, **pas déployé** ; le reste du lot 3 est l'achat du domaine et le compte Resend (pas à pas § 6).
- Lots 4 à 6 : à faire.
Origine : tous les premiers clients veulent écrire à toute leur base Shotgun,
alors que l'accord newsletter de Shotgun ne couvre que quelques pour cent des
acheteurs. On ouvre une deuxième base légale, l'exception « clients » de
l'article L34-5 du CPCE (soft opt-in), choisie par le pro, encadrée par le
code, avec un risque isolé pour Yuno.

**Noms décidés par Paul le 29/10** (« Vos acheteurs » remplacé par « Vos clients » le même jour) : à l'écran, **« Vos clients »**
(audience « Tous vos clients » face à « Ceux qui ont donné leur accord »,
carte « Écrire à vos clients ») ; domaine d'envoi à part **`yunonews.eu`**
(« Amoris <amoris@yunonews.eu> »), à acheter par Paul. Identifiant technique :
`customer` (la base légale, jamais affiché). Dans ce document, « base clients »
désigne la même chose : c'est le nom juridique de l'exception, pas celui de l'écran.

---

## 0. En une page

| | Aujourd'hui | Après |
|---|---|---|
| Qui reçoit un e-mail marketing du CRM | celui qui a coché l'accord (Shotgun, page `/j/`, fichier attesté) | **en plus**, l'acheteur d'une soirée DU pro, s'il ne s'est jamais opposé |
| Qui décide | Yuno lit l'accord | le pro choisit la base légale, signe une déclaration ; Yuno fait respecter les conditions par le code |
| Ce qu'un e-mail « clients » peut dire | — | seulement les soirées du pro (pas de partenaire, pas d'autre marque) |
| Infrastructure | un compte Resend pour tout | un compte Resend + un domaine **à part** pour la base clients ; les billets n'y touchent jamais |
| Si ça tourne mal | disjoncteur à 0,2 % de plaintes | disjoncteur plus serré (0,1 %), montée progressive, suspension de la base clients du seul compte en cause |

Trois choses ne changent jamais : on lit toujours l'accord Shotgun (finement,
voir § 2), un désabonné ou une opposition n'est jamais recontacté, et le SMS
reste à l'accord seul.

Décisions ouvertes, à prendre par Paul :

1. ~~Nom visible~~ : « Vos clients » (29/10). La page Clients compte plus de monde (co-organisé, invitations) : l'écran le dira.
2. ~~Domaine d'envoi~~ : `yunonews.eu` (29/10). Le domaine de chaque pro reste le lot 6.
3. Consultation d'un avocat (1 h) sur TROIS questions : (a) une case newsletter Shotgun jamais cochée empêche-t-elle l'exception clients ? (b) une entrée gratuite ou une invitation vaut-elle « vente ou prestation de services » ? (c) un co-organisateur (rôle `editor` chez Shotgun) peut-il invoquer l'exception pour les acheteurs de la soirée commune ? Les réponses (b) et (c) changent la taille de la base d'un facteur 5 à 15 (§ 1). L'interrupteur `CRM_CUSTOMER_BASIS_LIVE` passe à true pour tous après sa réponse ; avant, comptes en bêta seulement (choisis par Paul).
4. Plafonds de départ de la montée progressive (§ 5.6), proposés ici.

---

## 1. Ce que la base contient aujourd'hui (mesuré le 29/10)

Personnes distinctes par compte CRM, billets Shotgun non effacés, dernier signal
newsletter du billet le plus récent :

| Compte | Acheteurs | Accord aujourd'hui | A retiré son accord | N'a jamais coché | Champ absent chez Shotgun | Dernier achat < 3 ans |
|---|---:|---:|---:|---:|---:|---:|
| A | 18 355 | 302 (1,6 %) | 0 | 2 349 | 15 704 | 16 393 |
| B | 3 644 | 638 (17,5 %) | 0 | 347 | 2 659 | 3 644 |
| C | 1 976 | 1 100 (55,7 %) | 70 | 806 | 0 | 1 976 |

**Ce que la règle retient vraiment** (répétition du lot 1 sur la prod, annulée, 29/10) :

| Compte | Personnes connues | Acheteurs PAYANTS < 3 ans (tout rôle) | dont soirées où le compte est VENDEUR | Avec accord | **En plus avec « Vos clients »** | Exclus (retrait, désabonné, adresse en échec) |
|---|---:|---:|---:|---:|---:|---:|
| A | 18 357 | 4 057 | 801 | 301 | **784** | 9 |
| B | 3 645 | 538 | 227 | 639 | **198** | 0 |
| C | 1 976 | 1 470 | 1 470 | 1 736 | **498** | 90 |

Lecture : la base de A ne passe pas de 302 à 16 000, mais de 301 à ~1 085. Deux
filtres font presque tout l'écart, et ce sont deux questions de droit, pas de code :

1. **Les entrées gratuites et invitations** (~14 000 personnes chez A) : l'exception
   vise une adresse recueillie « à l'occasion d'une vente ou d'une prestation de
   services ». Une entrée gratuite en est-elle une ? Le code dit **non** aujourd'hui
   (`_crm_ticket_is_paid`). Si l'avocat dit oui, c'est un réglage de la règle.
2. **Les soirées co-organisées** (3 261 acheteurs chez A, 80 soirées sur 284) : le
   compte y est `editor` / `viewer` chez Shotgun, donc pas le vendeur. Le code les
   **exclut**. Si un contrat de co-organisation fait des deux parties des co-vendeurs,
   l'avocat peut l'ouvrir.

Ces deux réponses décident de la taille de la base bien plus que tout le reste.

---

## 2. Le principe juridique, tel que le code l'applique

Article L34-5 du CPCE, alinéa 2 (exception « clients ») : sans accord
préalable, on peut écrire par e-mail à une personne si

1. son adresse a été recueillie **à l'occasion d'une vente** ;
2. le message porte sur des **produits ou services analogues fournis par la même personne** ;
3. elle a été **informée et mise en mesure de s'opposer**, simplement et sans frais, à la collecte, puis **dans chaque message**.

Traduction en règles de code :

| Condition légale | Règle Yuno |
|---|---|
| 1. recueillie lors d'une vente | un **billet, payant OU entrée gratuite** (`_crm_ticket_is_sale` : vente valide, hors invitation et duplicata) d'une soirée miroir de la portée — décision de Paul du 29/10, l'entrée gratuite lue comme « prestation de services », à confirmer par l'avocat (question (b)). Une invitation, un duplicata, un billet remboursé : **non**. Un fichier importé : **non** (il reste à l'accord attesté). |
| 1 bis. par ce vendeur | soirée dont le rôle Shotgun n'est PAS co-organisé (`NOT _ticketing_role_is_cohosted(external_role)`). Un acheteur qui n'a acheté que des soirées co-organisées n'est pas un client du pro. |
| 2. produits analogues du même vendeur | contrôle de contenu `_crm_customer_content_issues` (§ 5.4) : seuls les blocs Yuno et liens vers les soirées **propres** de la portée ; jamais une autre billetterie, un code promo d'un tiers, une soirée co-organisée. La marque et le sujet libre relèvent de la déclaration du pro. |
| 3a. informé à la collecte | déclaration du pro (case 3 de la fenêtre) + mention fournie par Yuno à poser chez Shotgun et dans sa politique de confidentialité (§ 7.3). |
| 3b. a pu s'opposer | **tout signal d'opposition exclut, pour toujours** : accord coché puis décoché (`withdrawn`), désabonnement dans Yuno (les deux produits), `email_opt_outs`, liste de suppression, opposition transmise par le pro. |
| 3c. opposition dans chaque message | lien de désinscription en un clic + en-tête List-Unsubscribe + phrase « pourquoi vous recevez cet e-mail » en tête de pied de page. |
| durée raisonnable (recommandation CNIL : 3 ans) | dernier achat de moins de 3 ans ; au-delà, la personne sort seule de la base. |

Le point non tranché (décision 3) : « n'a jamais coché » / « champ absent »
traités comme éligibles. C'est l'interprétation que le pro **déclare** et
assume ; l'avocat confirme ou infirme. S'il infirme, on éteint
l'interrupteur, rien d'autre à défaire.

---

## 3. Modèle de données (migration A)

### 3.1 La déclaration du compte

```sql
-- Une ligne par portée CRM : la base clients est-elle ouverte, par qui, sur quel texte.
CREATE TABLE public.crm_customer_basis (
  scope_key        text PRIMARY KEY,               -- même clé que crm_settings
  venue_id         text REFERENCES venues(id) ON DELETE CASCADE,
  organizer_user_id uuid,
  status           text NOT NULL DEFAULT 'off'
                   CHECK (status IN ('off','active','suspended')),
  declared_by      uuid,                           -- le TITULAIRE (space.role = 'owner')
  declared_at      timestamptz,
  declaration_version text,                        -- LEGAL_VERSIONS.crm_customer_basis
  acceptance_id    uuid REFERENCES legal_acceptances(id),
  signatory_name   text,                           -- tapé dans la fenêtre
  signatory_role   text,                           -- « gérant », « président »…
  expires_at       timestamptz,                    -- declared_at + 12 mois
  suspended_at     timestamptz,
  suspended_reason text,                           -- 'complaints' | 'admin' | 'version' | 'expired'
  suspended_by     uuid,
  ramp_day         int NOT NULL DEFAULT 0,         -- montée progressive (§ 5.6)
  ramp_cap         int NOT NULL DEFAULT 1500,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(venue_id, organizer_user_id) = 1)
);
ALTER TABLE public.crm_customer_basis ENABLE ROW LEVEL SECURITY;   -- aucune policy : tout par RPC
```

`legal_acceptances.doc_type` : ajouter `'crm_customer_basis'` au CHECK. La
déclaration est une acceptation comme les Conditions : texte exact haché
(`doc_hash`), version, IP, user-agent, `context = {scope_key, counts}`.

### 3.2 Les personnes de la base clients

On ne met **pas** ces personnes dans `newsletter_subscriptions` : `opted_in`
y veut dire « a donné son accord » et une vingtaine de lecteurs (Billetterie,
SMS, segments, audiences pub, comptage) le lisent comme tel. Une table à part,
lue par un seul résolveur :

```sql
CREATE TABLE public.crm_customer_contacts (
  scope_key         text NOT NULL,
  email             text NOT NULL,                 -- lower(btrim())
  first_name        text, last_name text,
  first_sale_at     timestamptz NOT NULL,          -- preuve de la condition 1
  last_sale_at      timestamptz NOT NULL,          -- borne des 3 ans
  last_event_id     uuid,                          -- soirée propre la plus récente (raison affichée)
  sales             int NOT NULL,
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  state             text NOT NULL DEFAULT 'eligible'
                    CHECK (state IN ('eligible','objected','expired')),
  objected_at       timestamptz,
  objected_source   text,                          -- 'unsubscribe' | 'provider_withdrawn' | 'pro_reported' | 'complaint' | 'suppressed'
  refreshed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, email)
);
ALTER TABLE public.crm_customer_contacts ENABLE ROW LEVEL SECURITY;  -- aucune policy
```

- Remplie par `crm_customer_contacts_refresh(scope)` à chaque
  `ticketing_after_sync` (incrémental, mêmes adresses touchées) et par une
  passe complète par nuit. Elle **n'est construite que si la base est
  `active`** : un compte qui n'a rien déclaré n'a aucune ligne.
- `state = 'objected'` est définitif. Une ligne `objected` n'est jamais
  remise à `eligible`, même si la personne rachète (un nouvel accord passe
  par la case Shotgun ou une page `/j/`, jamais par la base clients).
- Effacement : `_crm_erase_contacts`, effacement venu de la billetterie
  (`ticketing_apply_erasures`), suppression du compte et déconnexion de la
  billetterie suppriment les lignes. Opposition au profilage : sans effet
  (ce n'est pas du profilage).

### 3.3 Qui est éligible (la règle unique)

Esquisse ci-dessous ; la version qui fait foi est `_crm_customer_eligible_rows` dans la migration du lot 1 (une seule agrégation par personne, requête planifiée à chaque appel : 0,6 s sur 46 000 billets).

```sql
-- Une personne est éligible à la base clients de la portée si :
--   au moins une VENTE d'une soirée propre (rôle non co-organisé) ;
--   dernier achat propre < 36 mois ;
--   aucun signal d'opposition, nulle part.
CREATE FUNCTION public._crm_customer_eligible_rows(p_venue text, p_orga uuid)
RETURNS TABLE (email text, first_name text, last_name text,
               first_sale_at timestamptz, last_sale_at timestamptz,
               last_event_id uuid, sales int, objected_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH own AS (
    SELECT lower(btrim(xt.buyer_email)) AS email, xt.*
      FROM external_tickets xt
      JOIN external_events ee ON ee.connection_id = xt.connection_id AND ee.external_id = xt.external_event_id
     WHERE marketing_scope_match(xt.venue_id, xt.organizer_user_id, p_venue, p_orga)
       AND xt.erased_at IS NULL AND xt.buyer_email IS NOT NULL
       AND _crm_ticket_is_sale(xt.status, xt.deal_channel)
       AND NOT _ticketing_role_is_cohosted(ee.external_role)
  ), last_signal AS (
    -- même règle que ticketing_after_sync : le billet le plus récemment mis à jour décide
    SELECT DISTINCT ON (email) email, newsletter_optin
      FROM own WHERE newsletter_optin IS NOT NULL
     ORDER BY email, coalesce(source_updated_at, purchased_at) DESC NULLS LAST
  ), ever_yes AS (
    SELECT email FROM own GROUP BY email HAVING bool_or(newsletter_optin)
  )
  SELECT ...,
    CASE
      WHEN ey.email IS NOT NULL AND ls.newsletter_optin = false THEN 'provider_withdrawn'
      WHEN EXISTS (SELECT 1 FROM email_suppressions s WHERE lower(s.email) = o.email) THEN 'suppressed'
      WHEN EXISTS (SELECT 1 FROM email_opt_outs x WHERE lower(x.email) = o.email
                     AND marketing_scope_match(x.venue_id, x.organizer_user_id, p_venue, p_orga)) THEN 'unsubscribe'
      WHEN EXISTS (SELECT 1 FROM newsletter_subscriptions ns WHERE lower(ns.email) = o.email
                     AND marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue, p_orga)
                     AND ns.opted_out_at IS NOT NULL) THEN 'unsubscribe'      -- les DEUX produits
    END AS objected_source
  FROM ... GROUP BY ...
  HAVING max(purchased_at) > now() - interval '36 months';
$$;
```

Les désabonnements valent pour les deux outils d'un même pro (règle de la
séparation : un « stop » est transverse), donc les deux produits sont lus.
Une personne qui A l'accord reste dans le registre de consentement et passe
par lui ; la base clients ne double jamais un envoi (§ 5.2).

### 3.4 La campagne

```sql
ALTER TABLE public.email_campaigns
  ADD COLUMN legal_basis text NOT NULL DEFAULT 'consent'
             CHECK (legal_basis IN ('consent','customer'));
```

- `consent` : rien ne change.
- `customer` : la campagne vise le registre de consentement **et** la base
  clients de la portée, et tout son contenu passe le contrôle « clients ».
- Posé seulement sur une campagne CRM (`product = 'crm'`), jamais pratique,
  jamais plateforme (trigger de garde, § 5.3).
- Recettes et scénarios : `email_automations.legal_basis` et
  `crm_scenarios.legal_basis`, même règle, lot 5.

---

## 4. RPC (migration A)

| RPC | Qui | Rôle |
|---|---|---|
| `crm_customer_basis_get(venue, orga)` | `crm_scope_allowed` | état, version, échéance, chiffres (accord / clients éligibles / exclus par raison), montée progressive, taux de plaintes 30 j |
| `crm_customer_basis_declare(venue, orga, version, doc_hash, signatory_name, signatory_role, checks jsonb)` | **titulaire seul**, jamais en accès assisté ni en aperçu démo, jamais un compte démo | écrit `legal_acceptances` puis `crm_customer_basis` (`active`, `expires_at = +12 mois`), lance le premier remplissage, alerte super admin `admin_crm_customer_basis_on`. `checks` doit contenir les cinq clés à `true`, sinon refus `customer_basis_checks`. |
| `crm_customer_basis_off(venue, orga)` | titulaire | `status = 'off'`, purge `crm_customer_contacts` de la portée (sauf les lignes `objected`, gardées comme repoussoir), campagnes `customer` en brouillon ou programmées remises en `draft` avec `paused_reason = 'customer_basis_off'` |
| `crm_customer_report_objection(venue, orga, emails[])` | éditeur+ | le pro transmet des oppositions reçues ailleurs (`pro_reported`) |
| `crm_customer_audience_preview(campaign)` | `crm_scope_allowed` | ce qui partira : accord / clients / écartés par raison, et la part que la montée progressive retient aujourd'hui |
| `crm_admin_customer_basis(include_demo)` | super admin | par compte : état, signataire, version, envois 30 j, plaintes, rebonds, suspensions |
| `crm_admin_customer_basis_suspend(scope, reason)` / `_resume` | super admin, motif obligatoire, audit `admin_audit_log` | suspendre / rouvrir la base d'un compte |

Toutes SECURITY DEFINER finissent par leurs REVOKE / GRANT explicites ;
`_crm_customer_*` jamais exécutables par `anon` ni `authenticated`.

---

## 5. Le moteur d'envoi

### 5.1 Résolution d'audience

Nouvelle branche dans `resolve_campaign_audience`, avant la branche CRM
actuelle :

```sql
IF v_prod = 'crm' AND v_campaign.legal_basis = 'customer' THEN
  RETURN QUERY SELECT * FROM public._crm_customer_campaign_audience(p_campaign_id);
  RETURN;
END IF;
```

`_crm_customer_campaign_audience` = copie de `_crm_campaign_audience` dont la
jointure finale devient l'UNION de deux sources, une ligne par adresse :

```sql
-- source 1 : le registre de consentement (comme aujourd'hui), priorité
SELECT p.email, ..., ns.user_id, ns.unsubscribe_token, 'consent' AS basis
  FROM _cp p JOIN newsletter_subscriptions ns ON ... AND ns.opted_in AND ns.product = 'crm'
 WHERE p.email_ok AND (<filtre>)
UNION ALL
-- source 2 : la base clients, seulement qui n'est pas déjà en source 1
SELECT p.email, ..., NULL, cc.unsubscribe_token, 'customer'
  FROM _cp p JOIN crm_customer_contacts cc
    ON cc.scope_key = <scope> AND cc.email = p.email AND cc.state = 'eligible'
 WHERE (<filtre>)
   AND NOT EXISTS (SELECT 1 FROM newsletter_subscriptions ns WHERE ... ns.opted_in AND ns.product = 'crm')
   AND crm_customer_basis_open(<scope>)
```

- Mêmes filtres de segment (`_crm_filter_sql`), mêmes exclusions (reçu
  depuis N jours, acheteurs de la soirée). **`p.email_ok` n'est pas exigé en
  source 2** (il veut dire « a l'accord ») ; à la place, l'état `eligible`.
- Le type de retour garde ses cinq colonnes : `send-campaign` ne change pas
  de contrat. La base de chaque destinataire est écrite sur sa ligne de file :
  `email_campaign_recipients.legal_basis` (nouvelle colonne, posée par
  `enqueue_campaign_recipients` depuis une sixième colonne interne, ou relue
  par jointure : à trancher à l'écriture, sans changer la signature publique).
- `crm_customer_basis_open(scope)` = `status = 'active' AND expires_at > now()
  AND declaration_version = version courante`. Faux ⇒ la source 2 est vide,
  jamais une erreur.

### 5.2 À l'envoi : tout se relit

- `claim_campaign_recipients` relit déjà la suppression et le désabonnement
  depuis la mise en file. Ajout : une ligne `legal_basis = 'customer'` est
  écartée (`skipped`, `policy:customer_basis_closed` ou
  `policy:customer_objected`, Yunit rendu) si la base a été coupée,
  suspendue, ou si la personne est passée `objected` entre-temps.
- `email_send_policy` s'applique pareil (pression, fatigue, aversion). Une
  personne de la base clients est en plus soumise à : **au plus 4 e-mails
  « clients » par 30 jours et par portée** (`pressure_customer_30d`), pour
  qu'un pro ne transforme pas l'exception en martèlement.

### 5.3 Garde au passage en `sending` / `scheduled`

Trigger `trg_b_guard_crm_customer_basis` (INVOKER, même famille que la garde
de l'e-mail pratique et de l'identité) sur `email_campaigns` :

- `legal_basis = 'customer'` sur une campagne non CRM, pratique, plateforme
  ou « informative » ⇒ refus `crm_customer_basis_scope`.
- base pas ouverte ⇒ refus `crm_customer_basis_closed` (campagne manuelle),
  pause `paused_reason = 'customer_basis'` (enfant d'automatisation ou de
  scénario), reprise seule quand la base rouvre.
- contenu ⇒ `_crm_customer_content_issues` non vide ⇒ refus
  `crm_customer_content` avec les motifs (comme l'e-mail pratique) ; revérifié
  à chaque retouche pendant l'envoi.
- identité de l'expéditeur incomplète ⇒ garde existante (elle passe après).

`send-campaign` revérifie avant un TEST et avant la mise en file
(`crm_customer_email_check`, 402 + motifs), comme `crm_practical_email_check`.

### 5.4 Contrôle de contenu « clients »

`_crm_customer_content_issues(blocks, subject, preheader, venue, orga)`,
plus souple que l'e-mail pratique (on a le droit de vendre), plus strict
qu'une campagne à l'accord :

| Règle | Code |
|---|---|
| Bloc Yuno (`event`, `tickets`, `countdown`, `lineup`) relié à une soirée qui n'est pas une soirée miroir **propre** de la portée (co-organisée, autre compte) | `not_own_event` |
| Lien vers une page Shotgun qui n'est pas celle d'une soirée propre de la portée | `not_own_event_link` |
| Lien vers une autre billetterie (Dice, Fever, Eventbrite, Weezevent, Billetweb, Xceed, Resident Advisor tickets…) | `other_ticketing` |
| Lien `/go/` d'une soirée qui n'est pas propre | `not_own_event_link` |
| Lien vers `yunoapp.eu` hors pages publiques de la portée | `foreign_page` |
| Bloc HTML d'IA (`html`) : liens contrôlés avec les mêmes règles | idem |

Les liens génériques (Instagram du pro, son site) passent. La marque
mentionnée dans le texte libre n'est pas lue par la machine : c'est la case 2
de la déclaration.

Liste des domaines de billetterie dans une fonction
`_crm_other_ticketing_host(host)`, testée en SQL et en TS (cas partagés
`customer-content.json`).

### 5.5 Rendu : dire pourquoi, laisser partir

- Pied de page d'un destinataire `customer` : ligne en tête, avant les
  mentions légales :
  « Cet email a été envoyé à {adresse} car vous avez pris une place pour « {soirée} » ({mois année}) : nous vous annonçons nos prochaines soirées, et vous pouvez vous désinscrire en un clic. » (« pris une place » : les entrées gratuites comptent.)
  Résolue par lot à l'envoi : `get_recipient_customer_reasons(campaign, emails[])`
  (service_role), comme `get_recipient_crm_vars`. Rendu : `RenderCtx.customerReason`
  dans `render.ts` ⇄ port Deno `email-studio-html.ts`, testés ensemble.
- Désinscription : `unsubscribe_by_token` et `unsubscribe-newsletter` (en-tête
  List-Unsubscribe, un clic) reconnaissent un jeton de `crm_customer_contacts` :
  `state = 'objected'` (`unsubscribe`), ligne `email_opt_outs` produit `crm`
  ET la règle transverse (« stop » pour les deux outils), trace
  `marketing_consent_events` action `objected`, source `customer_basis`.
- Plainte (Resend `email.complained`) d'un destinataire `customer` :
  suppression globale (comme aujourd'hui) + `objected` (`complaint`).

### 5.6 Montée progressive et disjoncteur

La première fois qu'un compte écrit à sa base clients, on commence par les
plus susceptibles d'ouvrir et on n'élargit que si ça se passe bien :

- Ordre : acheteurs des 6 derniers mois d'abord, puis 12, 24, 36
  (`_email_engagement_rank` en départage).
- Plafond par jour de la base clients du compte : `ramp_cap`, départ 1 500,
  ×2 chaque jour d'envoi si, sur les 48 h écoulées, plaintes < 0,08 % et
  rebonds durs < 2 %, sinon on reste au palier. Le reste attend le lendemain
  (comme le warm-up actuel : une attente, jamais un échec).
- Disjoncteur propre à la base clients : 0,1 % de plaintes ou 4 % de rebonds
  (échantillon ≥ 300) ⇒ la campagne se met en pause et la base du compte
  passe `suspended` (`complaints`), alerte super admin
  `admin_crm_customer_basis_suspended` + notification au pro. Rouvrir =
  geste du super admin avec motif.
- Le disjoncteur actuel (0,2 % / 5 %) reste au-dessus pour tout le monde.

---

## 6. Infrastructure d'envoi à part (lot 3, AVANT toute ouverture)

Le vrai risque de Yuno n'est pas une amende, c'est un compte Resend coupé :
les billets de tous les clients ne partiraient plus.

- **Un deuxième compte Resend** réservé aux envois `legal_basis = 'customer'`
  (et, plus tard, à tout le marketing CRM). Secrets `RESEND_API_KEY_CRM_CUSTOMER`,
  `RESEND_WEBHOOK_SECRET_CRM_CUSTOMER`. `send-campaign` choisit la clé par
  destinataire (`legal_basis`) : un même lot n'en mélange jamais deux (les
  lots sont coupés par base).
- **Un domaine d'envoi à part**, jamais `yunoapp.eu` ni un de ses sous-domaines
  pour cette base (décision 2). SPF, DKIM, DMARC `p=none` puis `quarantine`
  après 30 jours propres. Adresse de retour = `reply_to` du pro.
- `resend-webhook` accepte les deux secrets (essai de l'un puis de l'autre) et
  sait de quel compte vient l'événement (tag `yuno_basis`).
- **Code (fait le 29/10)** : `send-campaign` envoie un lot « clients » par
  `RESEND_API_KEY_CRM_CUSTOMER`, depuis `<adresse locale>@<CRM_CUSTOMER_EMAIL_DOMAIN>`,
  avec le tag `yuno_basis = customer` ; sans ces deux secrets, une campagne « clients »
  est refusée à la mise en file (`crm_customer_infra`) et mise en pause si elle draine
  (`paused_reason = 'customer_infra'`) : jamais par le compte principal. `resend-webhook`
  vérifie la signature avec `RESEND_WEBHOOK_SECRET`, puis `RESEND_WEBHOOK_SECRET_CRM_CUSTOMER`.
- **Mise en service, pas à pas (Paul)** :
  1. Acheter `yunonews.eu`.
  2. Créer une deuxième équipe Resend (« Yuno — clients »), offre Pro ; y ajouter le
     domaine `yunonews.eu`, poser chez le registrar les enregistrements SPF, DKIM et
     MX de retour qu'elle affiche, puis `_dmarc.yunonews.eu` = `v=DMARC1; p=none;
     rua=mailto:dmarc@yunoapp.eu` (passer à `quarantine` après 30 jours propres).
  3. Dans cette équipe : une clé API « envoi » (droit Sending, domaine yunonews.eu) et
     un webhook vers `https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/resend-webhook`
     (événements delivered, opened, clicked, bounced, complained, delivery_delayed).
  4. Secrets Supabase : `RESEND_API_KEY_CRM_CUSTOMER`, `CRM_CUSTOMER_EMAIL_DOMAIN=yunonews.eu`,
     `RESEND_WEBHOOK_SECRET_CRM_CUSTOMER` (le `whsec_…` du webhook).
  5. Admin CRM : `crm_admin_customer_basis_settings_set('{"sending_ready":true}', motif)`
     (écran au lot 4), puis la base bêta d'un compte, sa signature, un premier envoi suivi.
- Lot 6 (plus tard) : domaine du pro lui-même (DKIM sur son domaine), qui met
  la réputation chez lui.
- Sans clé ni domaine configurés, `crm_customer_basis_open` reste faux pour
  tous : impossible d'ouvrir la base par erreur.

---

## 7. Les textes

Versions : `LEGAL_VERSIONS.terms_crm` monte (`2026-11-XX`) et
`LEGAL_VERSIONS.crm_customer_basis = '2026-11-XX'` est créé. Changer la
déclaration de façon importante = monter sa version : toutes les bases
ouvertes passent `suspended` (`version`) jusqu'à une nouvelle signature, et le
pro est prévenu (notification + bandeau). Trois langues, comme les Conditions.

### 7.1 Article des Conditions Yuno CRM (nouvel article 7 bis, sans renuméroter)

> **7 bis. Écrire aux acheteurs de ses propres soirées**
>
> **7 bis.1 Principe.** Par défaut, Yuno CRM n'adresse un message commercial qu'aux personnes dont l'accord a été recueilli (case cochée chez la billetterie, page d'inscription, fichier dont le Client atteste l'accord). Le Client peut en outre choisir d'écrire par e-mail aux personnes qui lui ont acheté un billet, sur le fondement de l'exception prévue à l'article L34-5, alinéa 2, du Code des postes et des communications électroniques (la « base clients »). Ce choix est le sien : il le fait en qualité de responsable de traitement, par une déclaration signée dans la Console.
>
> **7 bis.2 Conditions.** La base clients ne comprend que les personnes ayant acheté un billet payant d'une soirée organisée par le Client lui-même, au cours des trente-six derniers mois, et ne s'étant jamais opposées à recevoir ses messages. Elle ne sert qu'à présenter les soirées du Client. Elle exclut toute soirée co-organisée, toute autre marque, tout partenaire et tout produit sans rapport. Elle ne concerne que l'e-mail ; les SMS restent soumis à l'accord préalable.
>
> **7 bis.3 Engagements du Client.** Le Client déclare et garantit : (a) être le vendeur des billets concernés ; (b) avoir informé ses acheteurs, au moment de l'achat, de l'usage de leur adresse pour lui présenter ses prochaines soirées et de leur droit de s'y opposer, notamment par la politique de confidentialité de sa billetterie ou de son site, dont Yuno fournit un modèle en annexe ; (c) n'écrire, par la base clients, qu'au sujet de ses propres soirées ; (d) transmettre sans délai à Yuno toute opposition reçue par un autre canal ; (e) ne jamais demander à Yuno d'écrire à une personne qui s'est opposée.
>
> **7 bis.4 Ce que fait Yuno.** Yuno applique ces conditions dans la mesure où ses données le permettent : il n'inscrit dans la base clients que les acheteurs de soirées propres du Client dans la limite de trente-six mois ; il en exclut toute personne désinscrite, ayant retiré son accord auprès de la billetterie, signalée comme opposée ou dont l'adresse est en échec ; il refuse l'envoi d'un message qui renvoie vers une soirée qui n'est pas celle du Client ou vers une autre billetterie ; il ajoute à chaque message la raison de sa réception et un moyen de désinscription en un clic, et rend toute désinscription effective immédiatement et définitivement. Ces contrôles n'ont pas pour effet de transférer à Yuno la responsabilité du choix de la base légale, qui demeure celle du Client.
>
> **7 bis.5 Suspension.** Yuno peut suspendre la base clients d'un compte, sans préavis et sans indemnité, en cas de taux de plaintes ou d'échecs anormal, de contenu contraire au 7 bis.2, de déclaration inexacte, de demande d'une autorité, ou de risque pour la réputation d'envoi de la plateforme. Il en informe le Client et lui indique la raison. Les envois fondés sur l'accord ne sont pas affectés.
>
> **7 bis.6 Durée et retrait.** La déclaration vaut douze mois et doit être renouvelée ; elle tombe si Yuno modifie le présent article. Le Client peut fermer la base clients à tout moment ; les oppositions enregistrées sont conservées pour qu'aucune personne opposée ne soit recontactée.
>
> **7 bis.7 Garantie.** Le Client garantit Yuno contre toute réclamation, action ou sanction d'une personne concernée, d'une autorité ou d'un tiers résultant d'un envoi fait par la base clients en méconnaissance de ses déclarations et engagements, et l'indemnise des sommes, frais et honoraires raisonnables qui en résulteraient.

### 7.2 Accord de sous-traitance (chapitre 12, ajout 12.7)

> **12.7 Base clients.** Lorsque le Client ouvre la base clients (article 7 bis des Conditions Yuno CRM), il donne instruction à Yuno de constituer, à partir des billets importés, la liste des acheteurs éligibles, et de leur adresser les messages qu'il compose. Le Client détermine seul la base légale de ces envois. Yuno conserve, pour chaque acheteur, la date de son premier et de son dernier achat et, le cas échéant, la date et l'origine de son opposition, afin de démontrer le respect des conditions et d'empêcher tout nouvel envoi. Si Yuno estime qu'une instruction du Client méconnaît la réglementation, il l'en informe et peut suspendre la base clients.

### 7.3 Annexe : la mention que le pro pose (nouvelle annexe des Conditions, copiable depuis la Console)

Deux textes, avec bouton « Copier » :

**Dans la description de chaque soirée chez Shotgun (ou toute billetterie)** :

> En achetant un billet, vous pourrez recevoir par e-mail l'annonce de nos prochaines soirées. Vous pouvez vous y opposer à tout moment, gratuitement, depuis le lien présent dans chaque e-mail ou en écrivant à {adresse de réponse}.

**Dans sa politique de confidentialité (paragraphe à ajouter)** :

> **Annonce de nos soirées.** Lorsque vous achetez un billet pour l'une de nos soirées, nous utilisons votre adresse e-mail pour vous annoncer nos prochaines soirées, sur le fondement de l'article L34-5 du Code des postes et des communications électroniques. Nous ne vous écrivons qu'au sujet de nos propres soirées, au plus quelques fois par mois, et pendant trois ans après votre dernier achat. Vous pouvez vous y opposer à tout moment, sans frais : par le lien de désinscription de chaque e-mail, ou en écrivant à {adresse}. Ces envois sont réalisés pour notre compte par notre prestataire Yuno.

### 7.4 Politique de confidentialité de Yuno (§ 14, une phrase)

> Lorsqu'un organisateur ouvre sa base clients, Yuno lui permet d'écrire aux personnes qui lui ont acheté un billet ; chaque message indique pourquoi il est reçu et permet de se désinscrire en un clic.

---

## 8. Les écrans

### 8.1 Réglages › Envoi : la carte « base clients » (nom à valider)

- Fermée : chiffres réels (`crm_customer_basis_get`) — « 639 personnes ont donné leur accord. 1 441 autres ont pris une place à vos soirées ces trois dernières années. » — et un bouton « Écrire aussi à mes clients », qui ouvre la fenêtre (§ 8.2). Visible du titulaire ; un éditeur voit la carte et « Demandez au titulaire du compte ».
- Ouverte : signataire, date, échéance (« à renouveler le … »), montée progressive (« aujourd'hui jusqu'à 3 000 personnes »), plaintes et désinscriptions 30 j, les deux mentions à copier (§ 7.3), « Signaler des oppositions » (coller une liste), « Fermer la base clients ».
- Suspendue : la raison, en clair, et « Contacter Yuno ».

### 8.2 La fenêtre à cocher

S'ouvre depuis la carte, ou depuis l'étape Audience quand le pro choisit
« Toute ma base » alors que la base est fermée. Jamais au chargement.
Titulaire seul ; refusée en accès assisté et en aperçu démo.

```
┌────────────────────────────────────────────────────────────┐
│  Écrire aussi à vos clients                         ✕    │
│                                                            │
│  Aujourd'hui, vos e-mails partent aux 302 personnes qui    │
│  ont coché l'accord chez Shotgun. La loi vous permet aussi │
│  d'écrire à ceux qui vous ont acheté un billet, pour leur  │
│  annoncer VOS prochaines soirées, s'ils ont pu refuser et  │
│  peuvent se désinscrire à tout moment.                     │
│                                                            │
│   302      avec leur accord                                │
│ +    784   acheteurs de vos soirées (3 dernières années)   │
│ −     0    jamais contactés : ils ont retiré leur accord   │
│ −     9    jamais contactés : désinscrits ou en échec      │
│                                                            │
│  Pour l'ouvrir, vous vous engagez à :                      │
│  ☐ être l'organisateur qui a vendu ces billets            │
│     (pas un partenaire ni un co-organisateur) ;            │
│  ☐ ne parler, dans ces e-mails, que de vos propres        │
│     soirées : pas d'autre marque, pas de partenaire ;      │
│  ☐ avoir prévenu vos acheteurs de cet usage, ou ajouter   │
│     dès aujourd'hui la mention que Yuno vous donne ;       │
│  ☐ transmettre à Yuno toute personne qui vous demande     │
│     de ne plus lui écrire ;                                │
│  ☐ avoir lu l'article 7 bis des Conditions : ce choix     │
│     est le vôtre, Yuno peut le suspendre, et vous le       │
│     garantissez contre toute réclamation qui en découle.   │
│                                                            │
│  Signé par  [ Prénom Nom          ]  en qualité de [gérant]│
│                                                            │
│  Yuno ajoute à chaque e-mail la raison de sa réception et  │
│  un lien de désinscription. Vous pourrez fermer la base    │
│  clients à tout moment dans Réglages › Envoi.              │
│                                                            │
│                       [ Plus tard ]  [ J'ouvre ma base ]   │
└────────────────────────────────────────────────────────────┘
```

- Le bouton reste actif ; au clic, ce qui manque est dit sous la case (règle
  « jamais grisé pour un oubli » du paiement).
- Le texte exact (cases comprises, langue du pro) est haché et enregistré
  (`legal_acceptances`), avec les chiffres affichés dans `context` : c'est la
  preuve de ce que le pro a vu.
- Écran suivant : les deux mentions à copier (§ 7.3), avec « C'est fait ».

### 8.3 Étape Audience de l'e-mail

- Un choix en tête : « Qui peut recevoir cet e-mail ? » — « Ceux qui ont donné leur accord (302) » / « Tous vos clients (16 006) ». Le second est grisé avec « Ouvrir la base clients » si elle est fermée.
- L'effectif recompté par `crm_customer_audience_preview` : accord / clients / écartés, et « Aujourd'hui, 1 500 partent ; les autres les jours suivants » pendant la montée progressive.

### 8.4 Vérification avant envoi

Nouvelle ligne de la checklist : « Ne parle que de vos soirées » (motifs du
§ 5.4, traduits `yc.em.st.cust.*`), et rappel de la ligne de pied de page
ajoutée.

### 8.5 Rapport de campagne

Résultats séparés par base (accord / clients) : envoyés, ouverts, cliqués,
désinscriptions, plaintes. C'est ce qui permet au pro de voir que sa base
clients se désinscrit plus, et à Yuno de tenir le disjoncteur.

### 8.6 Admin CRM

Plateforme › « Base clients » (`crm_admin_customer_basis`) : comptes
ouverts, signataire et version, montée, plaintes / rebonds 30 j par base,
suspensions ; tiroir d'un compte : suspendre / rouvrir (motif). Bilan du jour
(`crm_admin_daily`) : comptes dont la base clients dépasse 0,06 % de plaintes.

### 8.7 Aide et assistant

FAQ `yc.faq.customerBasis.*` (qu'est-ce que c'est, qui est dedans, pourquoi
quelqu'un n'y est pas, ce que je dois mettre chez Shotgun, fermer), article
assistant `crm-customer-basis` (redéployer `owner-assistant`). MCP : l'IA peut
lire l'état et préparer un brouillon `legal_basis = 'customer'`, jamais ouvrir
la base ni signer (`INSTRUCTIONS`).

---

## 9. Maintenir le légal dans le temps

| Quoi | Comment |
|---|---|
| Renouvellement | `expires_at` = +12 mois. J-30 et J-7 : notification + bandeau. Échu : base `suspended` (`expired`), campagnes en pause, rouvrir = nouvelle signature. |
| Changement de texte | version qui monte ⇒ toutes les bases `suspended` (`version`) jusqu'à nouvelle signature. |
| 3 ans | passe nocturne : `last_sale_at` > 36 mois ⇒ `expired`, ligne supprimée après 30 j (les `objected` restent). |
| Oppositions | jamais effacées tant que le compte existe (repoussoir), même base fermée. Effacées avec le compte. |
| Preuve | `legal_acceptances` (texte haché, chiffres vus), `crm_customer_contacts.first_sale_at` (vente d'origine), `marketing_consent_events` (oppositions), `email_campaign_recipients.legal_basis` (qui a reçu quoi, à quel titre). Export CSV de ces preuves pour le titulaire et pour Yuno (`crm_customer_basis_export`, jamais en accès assisté). |
| Surveillance | disjoncteur § 5.6, Bilan du jour, alerte `admin_crm_customer_basis_suspended`. |
| Interrupteur global | `CRM_CUSTOMER_BASIS_LIVE` (front, `src/crm/lib/customerBasis.ts`) + `crm_pricing.config.customer_basis_enabled` (serveur) : éteint, la source 2 est vide partout en une écriture. |
| Revue | une relecture juridique à l'ouverture, puis à chaque évolution du texte ou de la règle d'éligibilité. |

---

## 10. Lots et ordre de mise en ligne

| Lot | Contenu | Dépend de |
|---|---|---|
| 0 | Décisions 1-4 de Paul ; RDV avocat pris | — |
| 1 | Migration A : tables, `legal_basis`, éligibilité, RPC, garde, contrôle de contenu (sans lecteur front) ; banc PGlite | 0 (noms) |
| 2 | Envoi : branche du résolveur, relecture au claim, pression 30 j, pied de page « pourquoi », désinscription par jeton, plaintes, montée progressive, disjoncteur ; `send-campaign`, `unsubscribe-newsletter`, `resend-webhook` | 1 |
| 3 | Infrastructure : second compte Resend, domaine à part, DNS, secrets, choix de la clé par lot | 0 (domaine) |
| 4 | Textes : article 7 bis, DPA 12.7, annexe, privacy § 14 ×3 langues ; versions ; fenêtre, carte Réglages, étape Audience, vérification, rapport, Admin CRM, aide, assistant | 1, 2 |
| 5 | Recettes et scénarios en base clients (`legal_basis` sur `email_automations` et `crm_scenarios`) | 2 |
| 6 | Domaine du pro (DKIM chez lui) | 3 |

Mise en ligne : migration (sans effet : aucune base ouverte) → fonctions
edge → front avec `CRM_CUSTOMER_BASIS_LIVE = false` → secrets et domaine →
ouverture pour un compte bêta choisi par Paul (titulaire qui signe lui-même,
premier envoi suivi en direct) → après l'avis de l'avocat, interrupteur à true.

---

## 11. Tests

- Cas partagés SQL ⇄ TS : éligibilité (`customer-eligibility.json` : vente /
  invitation / duplicata / soirée co-organisée / 37 mois / retiré / désabonné
  dans l'autre outil / supprimé / signalé par le pro / déjà à l'accord),
  contenu (`customer-content.json`), pied de page (render ⇄ port Deno).
- Banc PGlite `scripts/crm-bench/customer-basis.mjs` sur les trois comptes
  synthétiques : effectifs, aucune adresse `objected` mise en file, aucune
  campagne `consent` qui change d'audience (md5 avant / après).
- Répétition sur la prod en transaction annulée (`rehearse.mjs`) des
  migrations et d'une mise en file, UNE à la fois.
- `isolation.mjs` : la base clients d'un espace n'apparaît jamais dans un autre,
  ni dans Yuno Tickets.
- Smoke de bout en bout sur la démo : ouverture refusée (compte démo),
  `demo_no_send` intact.

---

## 12. Ce qu'on ne fait pas

- Ne plus lire l'accord Shotgun, ou le lire sans en tenir compte : jamais. Le retrait d'un accord est la seule opposition que Yuno voit venir de la billetterie.
- Envoyer un e-mail pour « demander l'accord » à des personnes qui ne l'ont pas donné : c'est lui-même un e-mail commercial.
- SMS sur la base clients (l'exception existe en droit, mais la réputation SMS d'Octopush et le coût d'une plainte ne le justifient pas en v1).
- Base clients sur un fichier importé : un fichier passe par l'accord attesté, jamais par l'exception (Yuno ne peut pas prouver la vente).
- Base clients en portée plateforme (Yuno n'a rien vendu).
- Laisser un éditeur, un accès assisté ou l'IA signer la déclaration.
