# Mode d'emploi — correctif email / newsletter / cron

## Pourquoi tu as eu ces erreurs

Tu n'as rien cassé. Les erreurs viennent du fait que certaines migrations ont été lancées alors que leur base n'était pas encore prête.

- `cannot change name of input parameter p_function_name` : la fonction automatique existait déjà, mais avec un ancien nom de paramètre. PostgreSQL veut qu'on la supprime avant de la recréer.
- `audience_type does not exist` : la table `email_campaigns` existait sans cette colonne, ou la migration de création n'était pas passée avant.
- `c.organizer_user_id does not exist` : même problème, une fonction lisait une colonne pas encore ajoutée.
- `newsletter_subscriptions does not exist` : la table newsletter n'avait pas encore été créée.

## Document à utiliser maintenant

Utilise ce fichier :

`migration-kit/10_FIX_EMAIL_NEWSLETTER_CRON_COMPAT.sql`

## Ce que tu dois faire

1. Ouvre `migration-kit/10_FIX_EMAIL_NEWSLETTER_CRON_COMPAT.sql` dans VS Code.
2. Copie tout le contenu du fichier.
3. Va dans le SQL Editor de ton backend.
4. Colle le contenu.
5. Clique sur **Run** et pas sur **Explain**.
6. À la fin, tu dois voir une ligne avec :
   - `email_templates = OK`
   - `email_campaigns = OK`
   - `newsletter_subscriptions = OK`
   - `reschedule_edge_cron = OK`

## Est-ce que ça supprime des données ?

Non. Le fichier ne supprime pas tes clients, tickets, events, commandes ou lieux.

Il fait seulement :
- recréer proprement la fonction de planning automatique,
- créer les tables manquantes si elles n'existent pas,
- ajouter les colonnes manquantes,
- remettre les règles de sécurité,
- remettre les fonctions newsletter/campagnes,
- relancer les tâches automatiques Yuno.

## Après ce fichier

Si le run passe sans erreur, relance uniquement les anciennes migrations qui avaient échoué à cause de :
- `private.reschedule_edge_cron`,
- `email_campaigns`,
- `email_templates`,
- `newsletter_subscriptions`,
- `audience_type`,
- `organizer_user_id`.

Si une ancienne migration retourne une erreur de doublon ou “already exists”, ce n'est généralement pas grave : ça veut dire que le correctif a déjà créé l'objet.
