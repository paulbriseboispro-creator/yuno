// Première migration de l'analyse client : tout ce qui est à partir d'elle est
// rejoué depuis le dépôt, tout ce qui est avant vient de schema/base.sql.
export const FIRST_MIGRATION = '20261010100000';

// Points d'entrée mesurés par le banc mais que les migrations de l'analyse ne
// citent pas : ajoutés (avec ce qu'ils appellent) à schema/base.sql.
export const EXTRA_ROOTS = ['crm_automations'];
