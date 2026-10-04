/**
 * Démo Yuno CRM : règle les automatisations de crm@womber.fr comme le ferait
 * l'écran — un modèle CRM par recette (même constructeur que l'écran Modèles,
 * sans soirée figée), puis `crm_automation_save` appelée AVEC la session du
 * compte démo (la vraie porte d'écriture, gardée par rôle). Le moteur
 * n'envoie jamais rien pour la démo (is_demo_marketing_scope) : l'historique
 * d'envois se pose ensuite par seed-crm-automations.sql.
 *
 * Rejouable : les modèles marqués theme_json.seed = 'crm-automations' sont
 * remplacés. « On vous a manqué » reste à activer (modèle proposé à l'écran).
 *
 *   npx esbuild scripts/demo/seed-crm-automations.ts --bundle --platform=node --format=esm \
 *     --alias:@=./src --external:./lib.mjs --outfile=scripts/demo/.auto.mjs \
 *     && node scripts/demo/.auto.mjs; rm -f scripts/demo/.auto.mjs
 *   supabase db query --linked -f scripts/demo/seed-crm-automations.sql
 */
// @ts-expect-error -- module JS du dossier démo, sans déclarations de types.
import { rest, mintSession, SUPABASE_URL, ANON_KEY } from './lib.mjs';
import { buildCrmTemplate } from '@/crm/lib/emailTemplates';
import { stripEventBindings, templateContentToRow } from '@/lib/email/templates';
import { CRM_AUTO_META, type CrmAutoKind } from '@/crm/lib/automations';
import crmFr from '@/i18n/locales/crm/fr';

const EMAIL = 'crm@womber.fr';
const VENUE_NAME = 'Nuits Démo';
/** Recettes réglées, avec leur délai (heures). La reconquête sera mise en pause par le SQL. */
const PLAN: [CrmAutoKind, number][] = [
  ['new_event', 6], ['last_call', 24], ['post_event_thanks', 12], ['regular_lapse', 1008], ['win_back', 2160],
];

const t = (key: string, vars?: Record<string, string | number>) =>
  (crmFr[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (vars && vars[k] !== undefined ? String(vars[k]) : m));

async function main() {
  const session = await mintSession(EMAIL);
  const uid: string = session.user.id;
  const old: { id: string }[] = await rest.get(
    `email_campaign_templates?select=id&organizer_user_id=eq.${uid}&venue_id=is.null&theme_json->>seed=eq.crm-automations`,
  );

  for (const [kind, delay] of PLAN) {
    const content = buildCrmTemplate(CRM_AUTO_META[kind].tpl, { venueName: VENUE_NAME, lang: 'fr', t, night: null });
    const row = {
      ...templateContentToRow({ ...content, blocks: stripEventBindings(content.blocks) }),
      theme_json: { ...content.theme, seed: 'crm-automations' },
      name: t(`yc.au.r.${kind}.name`),
      description: t(`yc.au.r.${kind}.desc`),
      organizer_user_id: uid,
      created_by: uid,
    };
    const [tpl] = (await rest.post('email_campaign_templates', row)) as { id: string }[];
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/crm_automation_save`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_venue_id: null, p_organizer_user_id: uid, p_kind: kind, p_enabled: true, p_delay_hours: delay, p_subject: '', p_template_id: tpl.id }),
    });
    if (!res.ok) throw new Error(`crm_automation_save ${kind} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  if (old.length) {
    await rest.del(`email_campaign_templates?organizer_user_id=eq.${uid}&id=in.(${old.map((x) => x.id).join(',')})`);
  }
  console.log(`automatisations démo réglées : ${PLAN.length} recettes, ${old.length} anciens modèles remplacés`);
}

main().catch((e) => { console.error(e); process.exit(1); });
