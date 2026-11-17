/**
 * Légal › Sous-traitants et documents (`/admin/legal/documents`).
 *
 * Les textes publics et leur version en vigueur (LEGAL_VERSIONS, seule source),
 * les sous-traitants ultérieurs tels que l'Accord de sous-traitance les nomme
 * (`src/data/legalContent.ts`, DPA articles 5 et 6, chapitre 12.7 pour Yuno CRM),
 * et les documents internes du dépôt (`docs/legal/`). Une ligne ajoutée ici se
 * recopie d'abord dans le texte public : l'écran ne fait que le refléter.
 */
import { ExternalLink } from 'lucide-react';
import { Block, Page, useAdminT } from '@/admin/ui';
import { LEGAL_VERSIONS } from '@/lib/legal';
import { SourceNote } from './ui';
import { Cutoff, Ledger, StateMark } from './parts';

/** Document → page publique (`/legal/:section`, src/lib/legal.ts). */
const PUBLIC_PAGE: Record<string, string> = {
  cgu: '/legal/cgu', cgv_users: '/legal/cgv-utilisateurs', terms_pro: '/legal/cgv-clubs', confidentiality: '/legal/confidentialite',
  demo_confidentiality: '/legal/confidentialite', privacy: '/legal/privacy', terms_crm: '/legal/cgv-crm', dpa: '/legal/dpa',
};

/**
 * [nom, usage, produits, hors UE possible] — DPA art. 5 (liste générale), art. 6
 * (« Stripe, Resend, Cloudflare, Mapbox, OpenAI peuvent réaliser des traitements
 * hors UE »), et 12.7 (sous-traitants de Yuno CRM).
 */
const SUBPROCESSORS: { name: string; use: string; products: ('tickets' | 'crm')[]; outsideEu: boolean }[] = [
  { name: 'Supabase', use: 'db', products: ['tickets', 'crm'], outsideEu: false },
  { name: 'Stripe', use: 'pay', products: ['tickets', 'crm'], outsideEu: true },
  { name: 'Resend', use: 'email', products: ['tickets', 'crm'], outsideEu: true },
  { name: 'Octopush', use: 'sms', products: ['tickets', 'crm'], outsideEu: false },
  { name: 'OpenAI', use: 'ai', products: ['tickets', 'crm'], outsideEu: true },
  { name: 'Mapbox', use: 'maps', products: ['tickets'], outsideEu: true },
  { name: 'Cloudflare', use: 'host', products: ['tickets', 'crm'], outsideEu: true },
  { name: 'PostHog', use: 'analytics', products: ['tickets'], outsideEu: false },
];

const INTERNAL = [
  'docs/legal/REGISTRE_TRAITEMENTS_RGPD.md',
  'docs/legal/PLAN_ACTION_JURIDIQUE.md',
  'docs/legal/CRM_ANALYSE_CLIENT_REVUE_JURIDIQUE.md',
  'docs/legal/CRM_AIPD_MODELE.md',
  'docs/legal/NDA_Yuno_FR.md',
];

export default function DocumentsPage() {
  const { t } = useAdminT();
  const docs = Object.entries(LEGAL_VERSIONS).map(([doc, version]) => ({ doc, version, page: PUBLIC_PAGE[doc] ?? null }));
  const out = SUBPROCESSORS.filter((s) => s.outsideEu).length;

  return (
    <Page title={t('adm.lg2.dc.title')} subtitle={t('adm.lg2.dc.sub')}>
      <Block title={t('adm.lg2.dc.texts')} meta={t('adm.lg3.dc.textsMeta', { n: docs.length })}>
        <Cutoff>{t('adm.lg2.dc.textsSub')}</Cutoff>
        <Ledger>
          {docs.map((d) => (
            <div key={d.doc} className="grid grid-cols-1 items-center gap-x-4 px-1 py-2.5 md:grid-cols-[minmax(0,1.3fr)_70px_minmax(0,1.2fr)_minmax(0,1fr)]">
              <span className="a-t1 text-[13.5px] font-medium">{t(`adm.lg2.doc.${d.doc}`)}</span>
              <span className="a-mono a-t2 text-[12px]">v{d.version}</span>
              <span className="a-t2 text-[12.5px]">{t(`adm.lg2.dc.who.${d.doc}`)}</span>
              {d.page ? <a className="a-t1 a-focus inline-flex items-center gap-1 rounded text-[12.5px] underline-offset-2 hover:underline" href={d.page} target="_blank" rel="noreferrer">{d.page}<ExternalLink className="h-3 w-3" /></a> : <span className="a-t3">—</span>}
            </div>
          ))}
        </Ledger>
      </Block>

      <Block title={t('adm.lg2.dc.subs')} meta={t('adm.lg3.dc.subsMeta', { n: SUBPROCESSORS.length, o: out })}>
        <Cutoff>{t('adm.lg2.dc.subsSub')}</Cutoff>
        <Ledger>
          {SUBPROCESSORS.map((s) => (
            <div key={s.name} className="grid grid-cols-1 items-center gap-x-4 px-1 py-2.5 md:grid-cols-[130px_minmax(0,1.2fr)_minmax(0,1fr)_150px]">
              <span className="a-t1 text-[13.5px] font-medium">{s.name}</span>
              <span className="a-t2 text-[12.5px]">{t(`adm.lg2.dc.use.${s.use}`)}</span>
              <span className="a-t3 text-[12px]">{s.products.map((p) => t(`adm.lg2.product.${p}`)).join(' · ')}</span>
              <StateMark tone={s.outsideEu ? 'todo' : 'ok'}>{s.outsideEu ? t('adm.lg2.dc.outEu') : t('adm.lg2.dc.inEu')}</StateMark>
            </div>
          ))}
        </Ledger>
      </Block>

      <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-2">
        <Block title={t('adm.lg2.dc.other')}>
          <ul className="flex flex-col gap-2 text-[13px]">
            {[['/legal/mentions-legales', 'mentions'], ['/legal/cookies', 'cookies'], ['/legal/cgv-crm', 'cgvCrm']].map(([href, k]) => (
              <li key={href}><a className="a-t1 inline-flex items-center gap-1 underline-offset-2 hover:underline" href={href} target="_blank" rel="noreferrer">{t(`adm.lg2.dc.page.${k}`)}<ExternalLink className="h-3 w-3" /></a></li>
            ))}
          </ul>
        </Block>
        <Block title={t('adm.lg2.dc.internal')}>
          <ul className="flex flex-col gap-1.5">{INTERNAL.map((p) => <li key={p} className="a-mono a-t2 text-[12px]">{p}</li>)}</ul>
          <p className="a-t3 text-[12px]">{t('adm.lg2.dc.internalSub')}</p>
        </Block>
      </div>
      <SourceNote>{t('adm.lg2.dc.note')}</SourceNote>
    </Page>
  );
}
