/**
 * Démo Yuno CRM : pose un VRAI contenu (blocs du Studio) sur les e-mails semés
 * de crm@womber.fr — envois passés (seed-crm-messages.sql) et brouillon /
 * planifié de Soirées (seed-crm-nights.sql). Sans lui, les vignettes, les
 * aperçus et la page Résultats montrent un objet sur une trame.
 *
 * Le contenu vient du MÊME constructeur que l'écran Modèles
 * (`buildCrmTemplate`), en français, relié à la soirée que l'e-mail annonce
 * (titre contenu dans le nom de la campagne), sinon à la prochaine soirée
 * après l'envoi. Rejouable : n'écrit que blocs, thème (le marqueur `seed`
 * est gardé), pré-en-tête et soirée reliée, sur les lignes semées du compte.
 *
 *   npx esbuild scripts/demo/seed-crm-email-content.ts --bundle --platform=node --format=esm \
 *     --alias:@=./src --external:./lib.mjs --outfile=scripts/demo/.content.mjs \
 *     && node scripts/demo/.content.mjs; rm -f scripts/demo/.content.mjs
 */
// @ts-expect-error -- module JS du dossier démo, sans déclarations de types.
import { rest, mintSession, SUPABASE_URL, ANON_KEY } from './lib.mjs';
import { buildCrmTemplate, CRM_TEMPLATE_KINDS, type CrmTemplateKind, type TemplateNight } from '@/crm/lib/emailTemplates';
import crmFr from '@/i18n/locales/crm/fr';

interface Night { id: string; title: string; start_at: string; url: string | null; cover_url: string | null; lineup: string[] | null }
interface Row { id: string; name: string | null; template_kind: string | null; sent_at: string | null; created_at: string; scheduled_at: string | null; theme_json: Record<string, unknown> | null }

const EMAIL = 'crm@womber.fr';
const VENUE_NAME = 'Nuits Démo';

const t = (key: string, vars?: Record<string, string | number>) =>
  (crmFr[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (vars && vars[k] !== undefined ? String(vars[k]) : m));

const toNight = (n: Night | null | undefined): TemplateNight | null =>
  (n ? { id: n.id, title: n.title, coverUrl: n.cover_url, url: n.url, lineup: n.lineup ?? [] } : null);

function kindOf(r: Row): CrmTemplateKind {
  if (r.template_kind && (CRM_TEMPLATE_KINDS as readonly string[]).includes(r.template_kind)) return r.template_kind as CrmTemplateKind;
  const name = (r.name ?? '').toLowerCase();
  if (name.startsWith('last call')) return 'lastcall';
  return 'annonce';
}

async function main() {
  const session = await mintSession(EMAIL);
  const uid: string = session.user.id;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/crm_nights`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_venue_id: null, p_organizer_user_id: uid }),
  });
  if (!res.ok) throw new Error(`crm_nights → ${res.status} ${(await res.text()).slice(0, 300)}`);
  const nights = ((await res.json()) as { nights: Night[] }).nights.slice().sort((a, b) => a.start_at.localeCompare(b.start_at));

  const rows: Row[] = await rest.get(
    `email_campaigns?select=id,name,template_kind,sent_at,created_at,scheduled_at,theme_json&organizer_user_id=eq.${uid}&venue_id=is.null&theme_json->>seed=in.(crm-messages,crm-nights)`,
  );

  let n = 0;
  for (const r of rows) {
    const kind = kindOf(r);
    const at = r.sent_at ?? r.scheduled_at ?? r.created_at;
    const named = nights.filter((x) => (r.name ?? '').includes(x.title)).sort((a, b) => b.title.length - a.title.length)[0];
    const after = nights.filter((x) => x.start_at > at);
    const night = named ?? after[0] ?? null;
    const second = after.find((x) => x.id !== night?.id) ?? null;
    const last = nights.filter((x) => x.start_at < at).pop() ?? null;
    const content = buildCrmTemplate(kind, { venueName: VENUE_NAME, lang: 'fr', t, night: toNight(night), second: toNight(second), last: toNight(last) });
    const seed = r.theme_json?.seed;
    await rest.patch(`email_campaigns?id=eq.${r.id}&organizer_user_id=eq.${uid}`, {
      blocks_json: content.blocks,
      blocks_version: 2,
      theme_json: { ...content.theme, seed },
      preheader: content.preheader ?? '',
      social_links_json: content.socialLinks,
      template_kind: kind,
      // Relié seulement à la soirée qu'il nomme, comme un brouillon créé à l'écran.
      ...(named ? { event_id: named.id } : {}),
    });
    n += 1;
  }
  console.log(`contenu posé sur ${n} e-mails démo`);
}

main().catch((e) => { console.error(e); process.exit(1); });
