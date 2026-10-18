/**
 * Admin CRM › Clients › tiroir latéral d'un compte (« Fiche compte » du design
 * Admin Clients) : résumé, santé et onboarding, achats de Yunits, gestes rapides
 * (WhatsApp, e-mail, accès assisté, Yunits offerts, essai prolongé, gel), notes
 * internes. « Ouvrir la fiche complète » mène à la fiche actuelle. S'ouvre au
 * clic d'une ligne (`?open=<compte>` : le lien se partage et Retour le ferme).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { HEALTH_MAX, initials, OB_STEPS } from '@/crm/lib/admin';
import type { AdminAccount } from '@/crm/lib/admin';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Portal, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminAccount } from '../data';
import { GestureDialog, SupportConsoleButton } from '../gestures';
import type { Gesture } from '../gestures';
import { Avatar, HealthRing, StateBadge, useAgo } from '../ui';
import { NoteCard } from './AccountPage';
import { AnalysisCard } from './AnalysisCard';

const box = { display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 18, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' } as const;

export default function ClientDrawer({ account, onClose }: { account: AdminAccount; onClose: () => void }) {
  const { t, n, eur, dShort } = useCrmT();
  const ago = useAgo();
  const q = useAdminAccount(account.id);
  const [gesture, setGesture] = useState<Gesture>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape' && !gesture) onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose, gesture]);

  const a = q.data?.account ?? account;
  const d = q.data;
  const wa = a.phone ? `https://wa.me/${a.phone.replace(/[^\d]/g, '')}` : null;
  const danger = a.frozen_at ? t('adm.crm.dr.dFrozen', { reason: a.frozen_reason ?? '' })
    : a.state === 'late' ? t('adm.crm.dr.dLate')
      : a.sync === 'error' ? t('adm.crm.dr.dSync', { error: a.sync_error ?? '' })
        : a.state === 'trial' && (a.trial_left ?? 9) <= 2 ? t('adm.crm.dr.dTrial', { n: a.trial_left ?? 0 }) : null;
  const btn = { height: 38, padding: '0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', cursor: 'pointer' } as const;
  const hov = { borderColor: 'var(--sand-300)', color: 'var(--ink)', textDecoration: 'none', background: 'var(--sand-50)' } as const;
  const facts: [string, string][] = [
    [t('adm.crm.dr.f.contacts'), a.contacts ? n(a.contacts) : '—'],
    [t('adm.crm.dr.f.reach'), a.reach ? n(a.reach) : '—'],
    [t('adm.crm.dr.f.sends'), n(a.sends30)],
    [t('adm.crm.dr.f.balance'), n(a.balance)],
    [t('adm.crm.dr.f.bought'), a.buys_eur ? eur(a.buys_eur) : '—'],
    [t('adm.crm.dr.f.mrr'), a.mrr ? eur(a.mrr) : '—'],
    [t('adm.crm.dr.f.login'), ago(a.last_login)],
    [t('adm.crm.dr.f.recipes'), String(a.recipes)],
  ];
  const buys = (d?.moves ?? []).filter((m) => m.kind === 'credit' && m.lot_kind === 'purchase').slice(0, 5);
  const obDone = a.ob.filter(Boolean).length;
  const canExtend = (a.state === 'trial' || a.state === 'paused' || a.state === 'churned') && !a.paid;

  return (
    <Portal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(26,20,18,.28)', animation: `yc-fade 200ms ${EASE} both` }} />
      <aside role="dialog" aria-modal="true" aria-label={a.name} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 61, width: 'min(600px,100vw)', boxSizing: 'border-box', background: 'var(--paper, #faf8f7)', boxShadow: '-24px 0 60px -20px rgba(26,20,18,.3)', display: 'flex', flexDirection: 'column', animation: `ydrw 260ms ${EASE} both` }}>
        <style>{'@keyframes ydrw{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}'}</style>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '22px 24px 18px', background: '#fff', borderBottom: '1px solid var(--sand-100)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <Avatar text={initials(a.name)} size={52} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.1 }}>{a.name}</span>
                <StateBadge a={a} />
                {a.is_demo && <em style={{ fontStyle: 'normal', fontSize: 12, fontWeight: 600, color: 'var(--amber-700)' }}>{t('adm.crm.demoTag')}</em>}
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{[a.city, t(`adm.crm.type.${a.type}`), a.signup_at ? t('adm.crm.ac.since', { date: dShort(a.signup_at) }) : null].filter(Boolean).join(' · ')}</span>
              {(a.contact || a.email) && <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{[a.contact, a.email].filter(Boolean).join(' · ')}</span>}
            </div>
            <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.common.close')} style={{ flex: 'none', width: 38, height: 38, border: 0, borderRadius: 12, background: 'var(--sand-50)', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--ink)' }} hover={{ background: 'var(--sand-100)' }}>
              <Icon name="x" size={16} stroke={2.4} />
            </Hv>
          </div>
          {danger && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'var(--red-50)', color: 'var(--red-800)', fontSize: 13.5, fontWeight: 500 }}>
              <i style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)', flex: 'none' }} />{danger}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {wa && <Hv as="a" href={wa} target="_blank" rel="noreferrer" style={{ ...btn, border: 0, background: 'var(--gradient-brand)', color: '#fff', boxShadow: 'var(--shadow-cta)' }} hover={{ color: '#fff', textDecoration: 'none' }}>WhatsApp</Hv>}
            {a.email && <Hv as="a" href={`mailto:${a.email}`} style={btn} hover={hov}>{t('adm.crm.ac.mail')}</Hv>}
            {d && <SupportConsoleButton ownerId={d.owner_id} name={a.name} style={btn} hover={hov} />}
            <Hv as="button" type="button" onClick={() => setGesture('grant')} style={btn} hover={hov}>{t('adm.crm.ac.grant')}</Hv>
            {canExtend && <Hv as="button" type="button" onClick={() => setGesture('extend')} style={btn} hover={hov}>{t('adm.crm.ac.extend')}</Hv>}
            <Hv as="button" type="button" onClick={() => setGesture(a.frozen_at ? 'unfreeze' : 'freeze')} style={{ ...btn, color: a.frozen_at ? 'var(--ink)' : 'var(--red-700)' }} hover={hov}>{t(a.frozen_at ? 'adm.crm.ac.unfreeze' : 'adm.crm.ac.freeze')}</Hv>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {q.isError && !d ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /> : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(118px,1fr))', gap: 8 }}>
                {facts.map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 12, borderRadius: 14, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>{l}</span>
                    <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</b>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ ...box, flex: '1 1 240px' }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, fontWeight: 600 }}><span>{t('adm.crm.dr.health')}</span><HealthRing score={a.health} size={34} /></span>
                  {([0, 1, 2, 3] as const).map((i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 70px 44px', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                      <span style={{ color: 'var(--sand-600)' }}>{t(`adm.crm.h.${i}`)}</span>
                      <span style={{ height: 6, borderRadius: 99, background: 'var(--sand-50)', overflow: 'hidden' }}><span style={{ display: 'block', width: `${(a.h[i] / HEALTH_MAX[i]) * 100}%`, height: '100%', background: 'var(--gradient-brand)' }} /></span>
                      <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.h[i]}/{HEALTH_MAX[i]}</b>
                    </div>
                  ))}
                </div>
                <div style={{ ...box, flex: '1 1 220px', gap: 6 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600 }}><span>{t('adm.crm.dr.ob')}</span><span style={{ color: 'var(--sand-500)', fontWeight: 500 }}>{obDone} / {OB_STEPS.length}</span></span>
                  {OB_STEPS.map((s, i) => (
                    <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: a.ob[i] ? 'var(--ink)' : 'var(--sand-500)' }}>
                      <span style={{ flex: 'none', width: 16, height: 16, borderRadius: 99, boxSizing: 'border-box', background: a.ob[i] ? 'var(--green-500)' : '#fff', border: `1.5px solid ${a.ob[i] ? 'var(--green-500)' : 'var(--sand-300)'}`, display: 'grid', placeItems: 'center', color: '#fff' }}>{a.ob[i] ? <Icon name="check" size={10} stroke={3.4} /> : null}</span>
                      {t(`adm.crm.ob.${i}`)}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ ...box, gap: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, paddingBottom: 4 }}>{t('adm.crm.dr.buys')} <span style={{ color: 'var(--sand-500)', fontWeight: 500 }}>· {a.buys ? `${eur(a.buys_eur)} · ${t('adm.crm.ac.u.buys', { n: a.buys })}` : '—'}</span></span>
                {!d && <Skel h={40} r={10} />}
                {d && buys.length === 0 && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('adm.crm.dr.noBuy', { n: n(a.balance) })}</span>}
                {buys.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderTop: '1px solid var(--sand-100)', fontSize: 13 }}>
                    <span style={{ color: 'var(--sand-500)' }}>{dShort(m.at)}</span>
                    <b style={{ fontVariantNumeric: 'tabular-nums' }}>+{n(m.delta)} Yunits</b>
                  </div>
                ))}
              </div>
              <AnalysisCard scopeKey={a.id} />
              {d ? <NoteCard d={d} compact /> : <Skel h={140} r={18} />}
              <Link to={ADMIN_ROUTES.account(a.id)} style={{ alignSelf: 'flex-start', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{t('adm.crm.dr.full')}</Link>
            </>
          )}
        </div>
      </aside>
      <GestureDialog gesture={gesture} account={a} ext={d?.trial_ext} onClose={() => setGesture(null)} />
    </Portal>
  );
}
