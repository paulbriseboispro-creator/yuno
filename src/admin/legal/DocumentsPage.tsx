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
import { Badge, Card, DataTable, Grid, Page, Section, useAdminT, type ColumnDef } from '@/admin/ui';
import { LEGAL_VERSIONS } from '@/lib/legal';
import { SourceNote } from './ui';

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

  const dcols: ColumnDef<(typeof docs)[number], unknown>[] = [
    { accessorKey: 'doc', header: t('adm.lg2.tm.col.doc'), cell: (c) => <span className="a-t1 font-medium">{t(`adm.lg2.doc.${c.getValue<string>()}`)}</span> },
    { accessorKey: 'version', header: t('adm.lg2.tm.col.version'), cell: (c) => <span className="a-mono">{c.getValue<string>()}</span> },
    { id: 'who', accessorFn: (r) => r.doc, header: t('adm.lg2.dc.col.who'), cell: (c) => t(`adm.lg2.dc.who.${c.getValue<string>()}`) },
    { accessorKey: 'page', header: t('adm.lg2.dc.col.page'),
      cell: (c) => (c.getValue<string | null>()
        ? <a className="a-t1 inline-flex items-center gap-1 underline-offset-2 hover:underline" href={c.getValue<string>()} target="_blank" rel="noreferrer">{c.getValue<string>()}<ExternalLink className="h-3 w-3" /></a>
        : <span className="a-t3">—</span>) },
  ];
  const scols: ColumnDef<(typeof SUBPROCESSORS)[number], unknown>[] = [
    { accessorKey: 'name', header: t('adm.lg2.dc.col.name'), cell: (c) => <span className="a-t1 font-medium">{c.getValue<string>()}</span> },
    { accessorKey: 'use', header: t('adm.lg2.dc.col.use'), cell: (c) => t(`adm.lg2.dc.use.${c.getValue<string>()}`) },
    { id: 'products', accessorFn: (r) => r.products.join(','), header: t('adm.lg2.col.products'),
      cell: (c) => <span className="flex gap-1">{c.row.original.products.map((p) => <Badge key={p}>{t(`adm.lg2.product.${p}`)}</Badge>)}</span> },
    { accessorKey: 'outsideEu', header: t('adm.lg2.dc.col.eu'),
      cell: (c) => (c.getValue<boolean>() ? <Badge tone="warning">{t('adm.lg2.dc.outEu')}</Badge> : <Badge tone="positive">{t('adm.lg2.dc.inEu')}</Badge>) },
  ];

  return (
    <Page title={t('adm.lg2.dc.title')} subtitle={t('adm.lg2.dc.sub')}>
      <Section title={t('adm.lg2.dc.texts')} description={t('adm.lg2.dc.textsSub')}>
        <DataTable data={docs} columns={dcols} getRowId={(r) => r.doc} pageSize={20} />
      </Section>
      <Section title={t('adm.lg2.dc.subs')} description={t('adm.lg2.dc.subsSub')}>
        <DataTable data={SUBPROCESSORS} columns={scols} getRowId={(r) => r.name} pageSize={20} />
      </Section>
      <Grid cols={2}>
        <Card title={t('adm.lg2.dc.other')}>
          <ul className="flex flex-col gap-2 text-[13px]">
            {[['/legal/mentions-legales', 'mentions'], ['/legal/cookies', 'cookies'], ['/legal/cgv-crm', 'cgvCrm']].map(([href, k]) => (
              <li key={href}><a className="a-t1 inline-flex items-center gap-1 underline-offset-2 hover:underline" href={href} target="_blank" rel="noreferrer">{t(`adm.lg2.dc.page.${k}`)}<ExternalLink className="h-3 w-3" /></a></li>
            ))}
          </ul>
        </Card>
        <Card title={t('adm.lg2.dc.internal')}>
          <ul className="flex flex-col gap-1.5">
            {INTERNAL.map((p) => <li key={p} className="a-mono a-t2 text-[12px]">{p}</li>)}
          </ul>
          <p className="a-t3 mt-3 text-[12px]">{t('adm.lg2.dc.internalSub')}</p>
        </Card>
      </Grid>
      <SourceNote>{t('adm.lg2.dc.note')}</SourceNote>
    </Page>
  );
}
