# Billetterie libre — plan et état (2026-09-30)

Demande de Paul : un type de billetterie « libre », une liste de billets reliés
à un titre, sans règle imposée, avec une boisson offerte en option ; le pro
garde la main sur la mise en vente, et billet par billet sur l'affichage et
l'achat (un billet qui apparaît avant les autres, tous en vente, ou tous
visibles mais seulement certains achetables), idem pour l'horaire ; le tout
enregistrable en modèle. Méthode : skill `simplification`.

## Diagnostic (ce qui existait)

| Bloc | Question | Constat |
|---|---|---|
| Mode de vente (Simple / Tours / Créneaux) | « Comment mes billets se vendent ? » | Chaque mode impose une règle : jauge unique, paliers qui s'enchaînent, heure d'entrée. Aucun ne laisse décider billet par billet. |
| Visibilité des tours | « Qu'est-ce que le public voit ? » | Réglage de SOIRÉE (séquentiel / aperçu / tous ouverts), pas de billet. |
| Épuisé manuel | « Fermer un billet ? » | Existe, par billet. Réutilisé tel quel. |
| Mise en vente (privé / prévente / normal), mot de passe, limite par personne | « Quand la soirée ouvre ? » | Réglages de soirée, valent pour tous les modes. Réutilisés tels quels. |
| Modèles | « Rejouer la billetterie ? » | Dates impossibles à rejouer (un modèle n'a pas de date de soirée). |

## Décision : un 4ᵉ mode, rien de plus

Ranger, pas ajouter : « Libre » devient la 4ᵉ valeur de `ticket_selling_mode`,
avec le même interrupteur, le même assistant d'activation, le même onglet
Modèles, les mêmes réglages de mise en vente. Un billet libre = une ligne
`ticket_rounds` ordinaire (checkout, porte, compta, Wallet, remboursements
inchangés). Deux questions par billet, trois réponses chacune :

- **Quand le voit-on ?** tout de suite · à une date (`visible_from`) · caché (`hidden`)
- **Quand peut-on l'acheter ?** tout de suite · à une date (`sale_starts_at`) · plus tard (`is_active = false`, « Ouvrir la vente » d'un clic)
- \+ fin de vente facultative (`sale_ends_at`, le billet reste affiché « Vente terminée »)
- \+ heure limite d'entrée facultative (`entry_deadline`, colonne existante du mode Créneaux : la porte prévient et le staff accepte ou refuse ; gardée dans le modèle en « HH:MM »)

Règle de lecture unique : `ticketPhase` (`src/lib/freeTicketing.ts`, miroir
octet pour octet `supabase/functions/_shared/free-ticketing.ts`, testé).
Les colonnes valent dans tous les modes mais restent à leur défaut hors du
mode libre.

Modèle libre : `ticket_presets.selling_mode = 'free'`, billets dans `rounds`
avec des dates RELATIVES (`{daysBefore, time}`, jours calendaires avant le
jour de la soirée, fuseau de la soirée) — rejouable sur n'importe quelle date,
séries récurrentes comprises. Une porte front `applyFreePreset`
(Billetterie, Soirées, dialogue Billetterie orga), une porte serveur
(`create-owner-recurring-events`).

## Table de destination

| Surface | Ce qui change |
|---|---|
| Base | Migration `20260930120000` : `hidden`, `visible_from`, `sale_starts_at`, `sale_ends_at` + CHECK fenêtre de vente. |
| Checkout (`create-ticket-checkout`) | Refuse un billet caché / pas encore en vente (`checkout.tierNotAvailable`) / terminé (`checkout.saleEnded`). Jauge globale : simple ET libre. |
| Console Billetterie | Mode « Libre » (sélecteur, assistant, modèles) ; liste unique `FreeTicketRow` (statut, flèches d'ordre, « Ouvrir la vente ») ; `FreeTicketDialog` ; « Enregistrer comme modèle » ; `FreePresetDialog` ; jauge facultative. Bloc boisson factorisé (`DrinkOptionsFields`). |
| Pages publiques | `TicketSelection` et `EventDetails` : cachés absents, « En vente le … », « Vente terminée ». Prix « à partir de » (8 écrans, `forPublicPricing`) sans les cachés. |
| Emails, assistant client | Bloc Billetterie sans les cachés ; l'assistant ne cite que les billets en vente. |
| Aide / IA | `ohelp.ev.ticketing.s4*`, nouvelle section `s9*`, `ohelp.org.ticketing.s3*/s4b` ; article `ticketing-modes` de l'Assistant Console. |

## Reste à faire

- Rapport de soirée (`get_event_report`) : le statut d'une ligne libre reste
  « En vente » dès que `is_active`, même si elle est cachée ou programmée.
- Jouer le parcours sur la démo (création, modèle, page publique, achat simulé)
  puis pousser le front.
