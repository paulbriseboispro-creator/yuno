/**
 * Clients › Pages d'inscription (`/crm/signup-pages`) — « Combien de fans
 * attendent vos soirées ? ». La liste des pages (statut, visites, inscrits,
 * confirmés) et « Nouvelle page ». Une page s'ouvre dans l'éditeur
 * (`/crm/signup-pages/:id`), avec l'aperçu téléphone, ses liens et QR, ses
 * chiffres. Plan : docs/designs/CRM_SIGNUP_PAGES_PLAN.md.
 */
import { useNavigate } from 'react-router-dom';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { Badge, CtaButton, Panel, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { EASE } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useSignupMutations, useSignupPages } from '@/crm/data/signupPages';
import type { SignupPageRow } from '@/crm/data/signupPages';

export function statusTone(p: Pick<SignupPageRow, 'status' | 'open'>): 'done' | 'warn' | 'wait' {
  return p.status === 'live' ? (p.open ? 'done' : 'warn') : 'wait';
}

export default function SignupPagesPage() {
  const { t, n } = useCrmT();
  const caps = useCrmCaps();
  const nav = useNavigate();
  const toast = useCrmToast();
  const q = useSignupPages();
  const m = useSignupMutations();
  const pages = q.data?.pages ?? [];
  const tot = pages.reduce((a, p) => ({ v: a.v + p.visits, e: a.e + p.entries, c: a.c + p.confirmed }), { v: 0, e: 0, c: 0 });

  const create = () => {
    m.save.mutate({ id: null, patch: { title: t('yc.spg.defTitle'), button_label: t('yc.fan.buttonPh'), tagline: t('yc.spg.defTagline') } }, {
      onSuccess: (id) => nav(`/crm/signup-pages/${id}`),
      onError: () => toast(t('yc.spg.err')),
    });
  };

  return (
    <main style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(20px,3vw,40px) clamp(16px,3vw,40px) 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, animation: `yc-rise 600ms ${EASE} both` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 720 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.spg.kicker')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(30px,3.4vw,42px)', letterSpacing: '-.045em', lineHeight: 1.05 }}>{t('yc.spg.title')}</h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.spg.sub')}</p>
        </div>
        {caps.write && <CtaButton icon="plus" onClick={create} disabled={m.save.isPending}>{t('yc.spg.new')}</CtaButton>}
      </header>

      {q.isError && !q.data ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /> : !q.data ? <Skel h={320} r={28} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
            {([['visits', tot.v], ['entries', tot.e], ['confirmed', tot.c]] as const).map(([k, v], i) => (
              <Panel key={k} pad={22} hover={false} style={{ gap: 6, animation: `yc-rise 600ms ${EASE} ${i * 60}ms both` }}>
                <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t(`yc.spg.k.${k}`)}</span>
                <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 36, letterSpacing: '-.04em' }}>{n(v)}</b>
                <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t(`yc.spg.k.${k}Sub`)}</span>
              </Panel>
            ))}
          </div>
          <Panel hover={false} pad={0} style={{ gap: 0, overflow: 'hidden' }}>
            {pages.length === 0 ? (
              <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
                <b style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-.03em' }}>{t('yc.spg.emptyT')}</b>
                <span style={{ fontSize: 15, color: 'var(--sand-600)', maxWidth: 440 }}>{t('yc.spg.emptyS')}</span>
              </div>
            ) : pages.map((p, i) => (
              <Hv key={p.id} as="div" role="link" tabIndex={0} onClick={() => nav(`/crm/signup-pages/${p.id}`)} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') nav(`/crm/signup-pages/${p.id}`); }}
                style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) repeat(3, 90px)', gap: 12, alignItems: 'center', padding: '16px 24px', borderTop: i ? '1px solid var(--sand-100)' : 0, cursor: 'pointer' }}
                hover={{ background: 'var(--sand-50)' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 15.5 }}>{p.title || t('yc.fan.titlePh')}</b>
                    <Badge tone={statusTone(p)}>{t(`yc.spg.st.${p.status === 'live' && !p.open ? 'liveShut' : p.status}`)}</Badge>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{p.event ? p.event.title : t('yc.spg.community')} · /j/{p.slug}</span>
                </span>
                {([p.visits, p.entries, p.confirmed] as const).map((v, k) => (
                  <span key={k} style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
                    <b style={{ fontVariantNumeric: 'tabular-nums' }}>{n(v)}</b>
                    <span style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>{t(`yc.spg.col.${['visits', 'entries', 'confirmed'][k]}`)}</span>
                  </span>
                ))}
              </Hv>
            ))}
          </Panel>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('yc.spg.how')}</p>
        </>
      )}
    </main>
  );
}
