/**
 * Admin CRM › Réglages › E-mails du cycle de vie : les e-mails que Yuno envoie
 * LUI-MÊME aux pros (bienvenue, billetterie à connecter, base prête, essai qui se
 * termine, paiement échoué, pause, solde bas, reconquête). Tous ÉTEINTS par
 * défaut ; allumer ou couper demande un motif et s'écrit au journal d'audit.
 * L'aperçu rend le MÊME HTML que l'envoi (module pur partagé avec l'edge). La
 * base ne suit ni ouvertures ni clics pour ces e-mails : l'écran ne les invente pas.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { rpc } from '@/crm/lib/rpc';
import { Modal, Skel, Switch } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { renderLifecycleEmail } from '@/crm/lib/lifecycleEmail';
import type { LifecycleCopy, LifecycleKey, LifecycleLang } from '@/crm/lib/lifecycleEmail';
import { useAdminGesture } from '../data';
import { EmptyNote, RowLine, Section, useAgo } from '../ui';

interface LcEmail {
  key: LifecycleKey; family: 'onboarding' | 'billing'; enabled: boolean; enabled_at: string | null;
  copy: Record<LifecycleLang, LifecycleCopy>; sent30: number; sent: number; skipped30: number; failed30: number; last_at: string | null;
}
interface Lc { at: string; emails: LcEmail[]; log: { at: string; key: LifecycleKey; scope: string; status: string; reason: string | null; name: string | null }[] }

export function useAdminLifecycle() {
  return useQuery({ queryKey: ['crm-admin', 'lifecycle'], staleTime: 15_000, queryFn: () => rpc<Lc>('crm_admin_lifecycle') });
}

export default function LifecycleTab() {
  const { t, n, lang } = useCrmT();
  const ago = useAgo();
  const toast = useCrmToast();
  const q = useAdminLifecycle();
  const toggle = useAdminGesture<{ p_key: string; p_enabled: boolean; p_reason: string }>('crm_admin_lifecycle_toggle');
  const [ask, setAsk] = useState<{ key: LifecycleKey; on: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<LcEmail | null>(null);
  const [pl, setPl] = useState<LifecycleLang>((['fr', 'en', 'es'] as const).find((x) => x === lang) ?? 'fr');
  const html = useMemo(() => (preview ? renderLifecycleEmail({ copy: preview.copy[pl], lang: pl, key: preview.key, origin: window.location.origin, vars: { balance: '740' } }).html : ''), [preview, pl]);

  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  if (!q.data) return <Skel h={480} r={28} />;
  const d = q.data;
  const on = d.emails.filter((e) => e.enabled).length;

  const submit = () => {
    if (!ask) return;
    toggle.mutate({ p_key: ask.key, p_enabled: ask.on, p_reason: reason }, {
      onSuccess: () => { toast(t(ask.on ? 'adm.crm.lc.onDone' : 'adm.crm.lc.offDone')); setAsk(null); setReason(''); void q.refetch(); },
      onError: () => toast(t('adm.crm.ac.err.x')),
    });
  };

  return (
    <>
      <p style={{ margin: 0, padding: '14px 18px', borderRadius: 16, background: on ? 'var(--green-50)' : 'var(--sand-100)', color: on ? 'var(--green-700)' : 'var(--sand-700)', fontSize: 14, lineHeight: 1.5 }}>
        {on ? t('adm.crm.lc.someOn', { n: on }) : t('adm.crm.lc.allOff')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {d.emails.map((e) => {
          const c = e.copy[pl] ?? e.copy.fr;
          return (
            <section key={e.key} style={{ background: '#fff', borderRadius: 22, boxShadow: 'inset 0 0 0 1px var(--sand-200)', padding: '18px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, opacity: e.enabled ? 1 : 0.72 }}>
              <span style={{ minWidth: 92, height: 30, padding: '0 12px', borderRadius: 99, background: e.family === 'onboarding' ? 'var(--red-50)' : 'var(--sand-100)', color: e.family === 'onboarding' ? 'var(--red-700)' : 'var(--sand-700)', fontSize: 12.5, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{t(`adm.crm.lc.when.${e.key}`)}</span>
              <span style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <b style={{ fontSize: 15.5 }}>{c.subject}</b>
                <span style={{ fontSize: 13.5, color: 'var(--sand-500)', lineHeight: 1.45 }}>{t(`adm.crm.lc.trig.${e.key}`)}</span>
              </span>
              <span style={{ display: 'flex', gap: 18, fontSize: 13, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>
                <span><b style={{ fontSize: 16, color: 'var(--ink)' }}>{n(e.sent30)}</b> {t('adm.crm.lc.sent30')}</span>
                {e.skipped30 > 0 && <span><b style={{ fontSize: 16, color: 'var(--ink)' }}>{n(e.skipped30)}</b> {t('adm.crm.lc.skipped30')}</span>}
                {e.failed30 > 0 && <span style={{ color: 'var(--red-600)' }}><b style={{ fontSize: 16 }}>{n(e.failed30)}</b> {t('adm.crm.lc.failed30')}</span>}
              </span>
              <Hv as="button" type="button" onClick={() => setPreview(e)} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('adm.crm.lc.preview')}</Hv>
              <Switch on={e.enabled} onChange={(v) => { setReason(''); setAsk({ key: e.key, on: v }); }} label={c.subject} />
            </section>
          );
        })}
      </div>
      <Section title={t('adm.crm.lc.log')} sub={t('adm.crm.lc.logSub')} pad={24} gap={4}>
        {d.log.length === 0 && <EmptyNote>{t('adm.crm.lc.logNone')}</EmptyNote>}
        {d.log.map((l, i) => (
          <RowLine key={`${l.at}${i}`} first={i === 0}>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <b>{l.name ?? l.scope}</b>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t(`adm.crm.lc.when.${l.key}`)} · {l.reason ? t(`adm.crm.lc.reason.${l.reason}`) === `adm.crm.lc.reason.${l.reason}` ? l.reason : t(`adm.crm.lc.reason.${l.reason}`) : ''}</span>
            </span>
            <span style={{ textAlign: 'right', fontSize: 13 }}>
              <b style={{ color: l.status === 'sent' ? 'var(--green-700)' : l.status === 'failed' ? 'var(--red-600)' : 'var(--sand-600)' }}>{t(`adm.crm.lc.st.${l.status}`)}</b><br />
              <span style={{ color: 'var(--sand-500)' }}>{ago(l.at)}</span>
            </span>
          </RowLine>
        ))}
      </Section>

      <Modal open={!!ask} onClose={() => setAsk(null)} width={500} label={t('adm.crm.lc.confirm')}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t(ask?.on ? 'adm.crm.lc.confirmOn' : 'adm.crm.lc.confirmOff')}</h2>
          <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.55 }}>{ask ? t(ask.on ? 'adm.crm.lc.confirmOnB' : 'adm.crm.lc.confirmOffB', { what: d.emails.find((x) => x.key === ask.key)?.copy[pl]?.subject ?? '' }) : ''}</p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600 }}>{t('adm.crm.ac.reason')}
            <textarea value={reason} onChange={(ev) => setReason(ev.target.value)} rows={3} maxLength={300} style={{ borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: 12, font: 'inherit', fontSize: 15, outline: 'none', resize: 'vertical' }} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Hv as="button" type="button" onClick={() => setAsk(null)} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
            <Hv as="button" type="button" disabled={reason.trim().length < 3 || toggle.isPending} onClick={submit} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: reason.trim().length >= 3 ? 'pointer' : 'not-allowed', opacity: reason.trim().length >= 3 ? 1 : 0.5 }}>{t('adm.crm.lc.confirm')}</Hv>
          </div>
        </div>
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} width={640} label={t('adm.crm.lc.preview')}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ flex: 1, fontSize: 15 }}>{preview?.copy[pl]?.subject}</b>
            {(['fr', 'en', 'es'] as const).map((x) => (
              <Hv key={x} as="button" type="button" onClick={() => setPl(x)} style={{ height: 32, padding: '0 12px', borderRadius: 99, border: 0, background: pl === x ? 'var(--ink)' : 'var(--sand-100)', color: pl === x ? '#fff' : 'var(--ink)', fontWeight: 600, fontSize: 13, cursor: 'pointer', textTransform: 'uppercase' }}>{x}</Hv>
            ))}
          </div>
          <iframe title={t('adm.crm.lc.preview')} srcDoc={html} sandbox="" style={{ width: '100%', height: 520, border: 0, borderRadius: 16, background: '#f7f4f3' }} />
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('adm.crm.lc.previewNote')}</span>
        </div>
      </Modal>
    </>
  );
}
