/**
 * Admin CRM › Légal (« Admin Legal » du design) : Yuno est sous-traitant de chaque
 * pro. Ce qui est LU en base : acceptations (CGU, confidentialité…) par titulaire,
 * preuve de consentement des contacts, attestations d'import, accès assisté,
 * demandes de suppression, et le registre des incidents (CNIL 72 h). La liste des sous-traitants ultérieurs est celle de la
 * pile technique de Yuno (fixe, relue à chaque changement de fournisseur).
 */
import { Link } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Skel } from '@/crm/ui/kit';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminLegal } from '../data';
import IncidentsSection from './IncidentsSection';
import { EmptyNote, Kpi, PageHead, RowLine, Section, kpiGrid, pageWrap, twoCols } from '../ui';

const DOCS = ['terms_pro', 'confidentiality', 'dpa'] as const;
/** Les sous-traitants ultérieurs de l'accord de traitement des données (DPA, `legalContent.ts`) : même liste, mêmes mots. */
const SUBPROCESSORS: [string, string, boolean][] = [
  ['Supabase', 'db', false], ['Stripe', 'pay', true], ['Resend', 'email', true], ['Mapbox', 'maps', true], ['Cloudflare', 'host', true], ['PostHog', 'analytics', false],
];

export default function LegalPage() {
  const { t, n, pct, dShort, time } = useCrmT();
  const q = useAdminLegal();
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  const d = q.data;
  const proof = d && d.proof.reachable ? Math.min(100, (d.proof.with_proof / d.proof.reachable) * 100) : null;
  return (
    <main style={pageWrap}>
      <PageHead kicker={t('adm.crm.lg.kicker')} title={t('adm.crm.lg.title')} sub={t('adm.crm.lg.sub')} />
      <IncidentsSection />
      {!d ? <><div style={kpiGrid}>{[0, 1, 2].map((i) => <Skel key={i} h={118} r={24} />)}</div><Skel h={320} r={28} /></> : (
        <>
          <div style={kpiGrid}>
            <Kpi label={t('adm.crm.lg.k.proof')} value={proof === null ? '—' : pct(proof)} sub={t('adm.crm.lg.k.proofSub', { n: n(d.proof.with_proof), m: n(d.proof.reachable) })} dot="var(--green-500)" />
            <Kpi delay={60} label={t('adm.crm.lg.k.imports')} value={n(d.imports.length)} sub={t('adm.crm.lg.k.importsSub')} />
            <Kpi delay={120} label={t('adm.crm.lg.k.purge')} value={n(d.purge.length)} sub={t('adm.crm.lg.k.purgeSub')} />
          </div>
          <Section title={t('adm.crm.lg.accept')} sub={t('adm.crm.lg.acceptSub')} pad={24} gap={4}>
            {d.accept.length === 0 && <EmptyNote>{t('adm.crm.lg.acceptNone')}</EmptyNote>}
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 720 }}>
                {d.accept.map((a, i) => (
                  <RowLine key={a.id} first={i === 0}>
                    <Link to={ADMIN_ROUTES.account(a.id)} style={{ flex: 1, minWidth: 160, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{a.name}</Link>
                    {DOCS.map((doc) => {
                      const x = a.docs[doc];
                      return <span key={doc} style={{ width: 150, fontSize: 13, color: x ? 'var(--ink)' : 'var(--red-600)' }}>{x ? `${t(`adm.crm.lg.doc.${doc}`)} v${x.v} · ${dShort(x.at)}${x.ip ? ` · ${x.ip}` : ''}` : `${t(`adm.crm.lg.doc.${doc}`)} · ${t('adm.crm.lg.missing')}`}</span>;
                    })}
                  </RowLine>
                ))}
              </div>
            </div>
          </Section>
          <div style={twoCols}>
            <Section title={t('adm.crm.lg.imports')} sub={t('adm.crm.lg.importsSub')} pad={24} gap={4}>
              {d.imports.length === 0 && <EmptyNote>{t('adm.crm.lg.importsNone')}</EmptyNote>}
              {d.imports.map((x, i) => (
                <RowLine key={`${x.id}${x.at}`} first={i === 0}>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <b>{x.name} · {x.title ?? '—'}</b>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{dShort(x.at)} {time(x.at)} · {x.consent === 'yes' ? t('adm.crm.lg.attested') : t('adm.crm.lg.noAttest')}</span>
                  </span>
                  <span style={{ fontWeight: 600, color: x.undone ? 'var(--sand-500)' : 'var(--green-700)' }}>{x.undone ? t('adm.crm.lg.undone') : t('adm.crm.lg.imported', { n: n(x.new) })}</span>
                </RowLine>
              ))}
            </Section>
            <Section title={t('adm.crm.lg.grants')} sub={t('adm.crm.lg.grantsSub')} pad={24} gap={4}>
              {d.grants.length === 0 && <EmptyNote>{t('adm.crm.lg.grantsNone')}</EmptyNote>}
              {d.grants.map((g, i) => (
                <RowLine key={`${g.at}${i}`} first={i === 0}>
                  <span style={{ display: 'flex', flexDirection: 'column' }}><b>{g.name ?? '—'}</b><span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{dShort(g.at)}{g.reason ? ` · ${g.reason}` : ''}</span></span>
                  <span style={{ fontWeight: 600, color: g.revoked ? 'var(--sand-500)' : 'var(--amber-700)' }}>{g.revoked ? t('adm.crm.lg.revoked') : g.status}</span>
                </RowLine>
              ))}
            </Section>
          </div>
          <div style={twoCols}>
            <Section title={t('adm.crm.lg.erase')} sub={t('adm.crm.lg.eraseSub')} pad={24} gap={4}>
              {d.purge.length === 0 && <EmptyNote>{t('adm.crm.lg.eraseNone')}</EmptyNote>}
              {d.purge.map((p, i) => (
                <RowLine key={p.id} first={i === 0}>
                  <Link to={ADMIN_ROUTES.account(p.id)} style={{ flex: 1, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{p.name}</Link>
                  <span style={{ color: 'var(--sand-600)', fontSize: 13.5 }}>{t('adm.crm.lg.purgeAt', { date: dShort(p.purge_at) })}</span>
                </RowLine>
              ))}
            </Section>
            <Section title={t('adm.crm.lg.subs')} sub={t('adm.crm.lg.subsSub')} pad={24} gap={4}>
              {SUBPROCESSORS.map(([name, use, outside], i) => (
                <RowLine key={name} first={i === 0}>
                  <b style={{ width: 100 }}>{name}</b>
                  <span style={{ flex: 1, color: 'var(--sand-600)', fontSize: 13.5 }}>{t(`adm.crm.lg.use.${use}`)}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: outside ? 'var(--amber-700)' : 'var(--green-700)' }}>{t(outside ? 'adm.crm.lg.outEu' : 'adm.crm.lg.inEu')}</span>
                </RowLine>
              ))}
            </Section>
          </div>
        </>
      )}
    </main>
  );
}
