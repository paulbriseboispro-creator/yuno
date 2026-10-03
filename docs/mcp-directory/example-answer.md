# Exemple réel — Claude avec le connecteur Yuno de production

Réponse obtenue le 2026-10-03 avec Claude (Claude Code, mode non interactif),
connecteur `https://yunoapp.eu/mcp`, compte démo `owner@womber.fr` (données
fictives), niveau « Chiffres et analyses ». Question posée :

> Fais-moi le bilan de ma dernière soirée par rapport à la précédente, puis
> donne-moi les 3 actions les plus utiles pour vendre plus la semaine
> prochaine, avec où cliquer dans Yuno.

Outils appelés par Claude (journal `mcp_tool_calls`) : `get_account_overview`,
`get_event_report` (« last »), `get_recommendations`, `compare_events`
(2 dernières), plus `search_yuno_help` (outil local, non journalisé ; c'est en
le lisant que Claude a signalé l'absence d'article sur les liens suivis,
ajouté depuis). Sur la démo, les automatisations n'envoient jamais (garde
démo) et la porte n'est pas scannée : ce sont ces faits que Claude relève.

À réutiliser pour la vidéo de démonstration OpenAI et comme référence de
qualité quand on modifie les consignes (`worker/mcp/guide.ts`).

---

Voici le bilan, d'après les données Yuno de ton espace « Yuno ».

## Bilan : Yuno Electronic Body (ven. 2/10) vs The Revival (jeu. 1/10)

Le CA club baisse de 11,7 % : **1 352 €** contre 1 532 €. Toute la différence vient des billets. Les tables font exactement le même chiffre.

| | Electronic Body | The Revival | Écart |
|---|---|---|---|
| CA club | 1 352 € | 1 532 € | −180 € |
| Billets vendus | 46 | 61 | −15 |
| CA billets | 552 € | 732 € | −180 € |
| Tables (CA) | 2 (800 €) | 2 (800 €) | = |
| Convives en table | 13 | 19 | −6 |
| Guest list inscrits | 27 | 27 | = |
| Attendus à la porte | 86 | 107 | −21 |
| Visites / visites qui achètent | 144 / 26 (18 %) | 144 / 21 (15 %) | +5 commandes |

**Ce qui ressort :**
1. **La page a mieux converti, mais avec moins de billets par commande.** Il y a eu plus de commandes (26 contre 21) pour moins de billets (46 contre 61). Seul l'Early Bird à 12 € s'est vendu (46 sur 150). Les tarifs Regular et Last Tickets ne se sont jamais ouverts.
2. **La recherche a rapporté pour la première fois.** Sur 22 visites venues d'un moteur de recherche, 7 ont acheté, contre 0 sur 22 pour The Revival.
3. **La courbe de ventes s'arrête à J-5.** Le meilleur jour a été J-5 (17 personnes, 51 visites), puis plus aucune vente n'est enregistrée jusqu'au jour de la soirée. Le dernier appel n'a donc rien produit.
4. **La tendance de fond est mauvaise.** Sur les 4 dernières soirées, tu fais 5 636 € de CA, contre 13 669 € sur les 4 d'avant (−59 %). Les billets passent de 629 à 203.

⚠️ **La porte n'enregistre plus aucune entrée scannée sur les 4 dernières soirées**, contre 336 sur les 4 d'avant. Soit le scan n'est plus fait, soit les données ne remontent plus. Sans scan, les emails « Merci d'être venu » et « On t'a manqué » ne partent pas.

Attention aussi : ces deux soirées n'ont pas le même concept et ne tombent pas le même jour. La comparaison la plus juste serait avec l'Electronic Body précédente.

## Les 3 actions pour la semaine prochaine

Tes 6 soirées du lun. 5 au sam. 10 octobre sont toutes à **0 billet vendu**.

**1. Envoie un email aux clients « à risque » et aux « fidèles » pour Electronic Body (9/10) et Reggaeton (10/10).**
Tu as 80 clients à risque, qui ont déjà dépensé 62 396 € au total, et 3 777 fidèles.
- Où : **Campagnes** (yunoapp.eu/owner/campaigns), puis **Nouvelle campagne**.
  - Dans le **Studio**, ajoute un bloc **Billetterie** relié à la soirée.
  - Dans **Audience**, coche les segments « À risque » et « Fidèles », puis exclus les personnes qui ont déjà acheté.
  - Dans **Planification**, active **Relance ciblée après clic**.
- Ça marche si : la colonne **Revenu** de la campagne monte, et le nombre de clients à risque baisse.

**2. Vérifie pourquoi les automatisations n'envoient rien.**
Les 9 automatisations sont allumées, mais chacune affiche **0 envoi**, y compris Panier abandonné, Dernier appel et Passe en table. Ça peut expliquer pourquoi plus rien ne se vend après J-5.
- Où : **Campagnes → Automatisations** (yunoapp.eu/owner/campaigns/automations).
  - Sur chaque automatisation, lis la ligne « Yuno cible : … » et la liste des exclus avec leur raison.
  - Lance **Aperçu et test** pour voir l'email tel qu'il partira.
- En parallèle, refais scanner les QR à la porte.
- Ça marche si : le nombre d'envois et le revenu attribué dépassent 0 avant vendredi.

**3. Comprends pourquoi Instagram ne vend pas.**
Sur 30 jours, Instagram apporte 29 % des visites mais 0 % des ventes.
- Où :
  - **Paramètres → Intégrations → carte Meta** (yunoapp.eu/owner/integrations) : connecte ton pixel Meta pour que tes publicités visent de vrais acheteurs.
  - **Analytics → Trafic → Sources** : suis l'évolution de cette source.
- Je n'ai pas trouvé dans l'aide Yuno les étapes exactes pour créer un lien suivi pour ta bio et tes stories.
- Ça marche si : la part d'Instagram dans les ventes dépasse 0 %.

Tu veux que je compare plutôt avec l'Electronic Body précédente, pour voir si le concept lui-même est en perte de vitesse ?
