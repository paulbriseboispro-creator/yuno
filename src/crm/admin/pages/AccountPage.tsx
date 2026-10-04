/**
 * Admin CRM › Clients › fiche d'un compte (« Admin Compte » du design) : statut,
 * santé et ses parts, mise en route, grand livre de Yunits, journal de la
 * billetterie, derniers envois, notes, journal d'audit — et les gestes admin
 * (Yunits offerts, essai prolongé, gel d'envoi), tous audités avec un motif.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { HEALTH_MAX, initials, OB_STEPS } from '@/crm/lib/admin';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Modal, Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminAccount, useAdminGesture } from '../data';
import type { AdminAccountDetail } from '../data';
import { Avatar, card, EmptyNote, HealthRing, StateBadge, useAgo } from '../ui';

type Gesture = null | 'grant' | 'extend' | 'freeze' | 'unfreeze';

export default function AccountPage() {
  const { t } = useCrmT();
  const { id } = useParams();
  const q = useAdminAccount(id ? decodeURIComponent(id) : undefined);
  const [gesture, setGesture] = useState<Gesture>(null);

  if (q.isError && !q.data) {
    const nf = (q.error as { code?: string } | null)?.code === 'P0002';
    return <main style={{ padding: 32 }}>{nf ? <EmptyNote>{t('adm.crm.ac.notFound')} <Link to={ADMIN_ROUTES.clients}>{t('adm.crm.ac.back')}</Link></EmptyNote> : <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />}</main>;
  }
  const d = q.data;
  return (
    <main style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(20px,3vw,40px) clamp(16px,3vw,40px) 64px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Link to={ADMIN_ROUTES.clients} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--sand-600)', textDecoration: 'none' }}>
        <Icon name="arrowLeft" size={15} stroke={2.4} />{t('adm.crm.ac.all')}
      </Link>
      {!d ? <><Skel h={150} r={28} /><Skel h={360} r={28} /></> : <Fiche d={d} onGesture={setGesture} />}
      {d && <GestureDialog gesture={gesture} d={d} onClose={() => setGesture(null)} />}
    </main>
  );
}

function Fiche({ d, onGesture }: { d: AdminAccountDetail; onGesture: (g: Gesture) => void }) {
  const { t, n, eur, dShort, time } = useCrmT();
  const ago = useAgo();
  const a = d.account;
  const frozen = !!a.frozen_at;
  const wa = a.phone ? `https://wa.me/${a.phone.replace(/[^\d]/g, '')}` : null;
  const btn = { height: 40, padding: '0 16px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap' } as const;
  const hov = { background: 'var(--sand-50)', borderColor: 'var(--sand-300)', color: 'var(--ink)', textDecoration: 'none' } as const;
  return (
    <>
      {frozen && (
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, padding: '14px 20px', borderRadius: 20, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 14.5 }}>
          <Icon name="lock" size={18} stroke={2.2} />
          <span style={{ flex: '1 1 320px', lineHeight: 1.45 }}>{t('adm.crm.ac.frozen')}{a.frozen_reason ? ` ${t('adm.crm.ac.frozenWhy', { reason: a.frozen_reason })}` : ''}</span>
          <Hv as="button" type="button" onClick={() => onGesture('unfreeze')} style={{ ...btn, borderColor: 'var(--red-200)' }} hover={hov}>{t('adm.crm.ac.unfreeze')}</Hv>
        </div>
      )}
      <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
        <Avatar text={initials(a.name)} size={64} />
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 34, letterSpacing: '-.04em', lineHeight: 1.05 }}>{a.name}{a.is_demo && <em style={{ marginLeft: 10, fontStyle: 'normal', fontSize: 12, fontWeight: 600, color: 'var(--amber-700)', verticalAlign: 'middle' }}>{t('adm.crm.demoTag')}</em>}</h1>
          <span style={{ fontSize: 15, color: 'var(--sand-600)' }}>{[a.city, t(`adm.crm.type.${a.type}`), a.contact, a.email].filter(Boolean).join(' · ')}</span>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--sand-500)' }}>
            <StateBadge a={a} />
            {a.state === 'paid' && a.interval && <span>{t(`adm.crm.ac.plan.${a.interval}`)}{a.founder ? ` · ${t('adm.crm.ac.launchPrice')}` : ''}</span>}
            {a.cancel_at_end && <span style={{ color: 'var(--red-600)', fontWeight: 600 }}>{t('adm.crm.ac.cancelsAtEnd')}</span>}
            {a.signup_at && <span>{t('adm.crm.ac.since', { date: dShort(a.signup_at) })}</span>}
          </span>
        </div>
        <HealthRing score={a.health} size={72} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: '1 1 100%' }}>
          {wa && <Hv as="a" href={wa} target="_blank" rel="noreferrer" style={btn} hover={hov}>WhatsApp</Hv>}
          {a.email && <Hv as="a" href={`mailto:${a.email}`} style={btn} hover={hov}><Icon name="mail" size={16} stroke={2.2} />{t('adm.crm.ac.mail')}</Hv>}
          <Hv as={Link} to="/admin/support" style={btn} hover={hov}>{t('adm.crm.ac.assist')}</Hv>
          <Hv as="button" type="button" onClick={() => onGesture('grant')} style={btn} hover={hov}>{t('adm.crm.ac.grant')}</Hv>
          {(a.state === 'trial' || a.state === 'paused' || a.state === 'churned') && !a.paid && <Hv as="button" type="button" onClick={() => onGesture('extend')} style={btn} hover={hov}>{t('adm.crm.ac.extend')}</Hv>}
          {!frozen && <Hv as="button" type="button" onClick={() => onGesture('freeze')} style={{ ...btn, color: 'var(--red-700)' }} hover={hov}>{t('adm.crm.ac.freeze')}</Hv>}
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 20, alignItems: 'start' }}>
        <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={h2}>{t('adm.crm.ac.health', { score: a.health })}</h2>
          {([0, 1, 2, 3] as const).map((i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600 }}><span>{t(`adm.crm.h.${i}`)}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{a.h[i]} / {HEALTH_MAX[i]}</span></span>
              <span style={{ height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${(a.h[i] / HEALTH_MAX[i]) * 100}%`, borderRadius: 99, background: 'var(--gradient-brand)', transition: `width 900ms ${EASE}` }} /></span>
            </div>
          ))}
          <h3 style={{ ...h2, fontSize: 16, marginTop: 8 }}>{t('adm.crm.ac.start')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {OB_STEPS.map((s, i) => (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: a.ob[i] ? 'var(--ink)' : 'var(--sand-500)' }}>
                <span style={{ width: 20, height: 20, borderRadius: 99, display: 'grid', placeItems: 'center', background: a.ob[i] ? 'var(--green-50)' : 'var(--sand-100)', color: a.ob[i] ? 'var(--green-700)' : 'var(--sand-400)' }}>{a.ob[i] ? <Icon name="check" size={12} stroke={3} /> : null}</span>
                {t(`adm.crm.ob.${i}`)}
              </span>
            ))}
          </div>
        </section>

        <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={h2}>{t('adm.crm.ac.usage')}</h2>
          {([
            [t('adm.crm.ac.u.contacts'), a.contacts ? `${n(a.contacts)} · ${t('adm.crm.ac.u.reach', { n: n(a.reach) })}` : '—'],
            [t('adm.crm.ac.u.sends'), t('adm.crm.ac.u.sendsV', { n: a.sends30, last: ago(a.last_send_at) })],
            [t('adm.crm.ac.u.recipes'), String(a.recipes)],
            [t('adm.crm.ac.u.team'), String(a.team)],
            [t('adm.crm.ac.u.balance'), `${n(a.balance)} Yunits`],
            [t('adm.crm.ac.u.bought'), a.buys ? `${eur(a.buys_eur)} · ${t('adm.crm.ac.u.buys', { n: a.buys })}` : '—'],
            [t('adm.crm.ac.u.login'), ago(a.last_login)],
            [t('adm.crm.ac.u.source'), a.source ?? '—'],
            [t('adm.crm.ac.u.conn'), a.provider ? `${a.provider} · ${t(`adm.crm.sync.${a.sync}`)}${a.sync_at ? ` · ${dShort(a.sync_at)} ${time(a.sync_at)}` : ''}` : t('adm.crm.sync.none')],
          ] as [string, string][]).map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '8px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 14 }}>
              <span style={{ color: 'var(--sand-500)' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 20, alignItems: 'start' }}>
        <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={h2}>{t('adm.crm.ac.ledger')}</h2>
          {d.moves.length === 0 && <EmptyNote>{t('adm.crm.ac.ledgerNone')}</EmptyNote>}
          {d.moves.slice(0, 12).map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 14 }}>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600 }}>{m.label ?? t(`adm.crm.ac.move.${m.kind}`)}</span>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{dShort(m.at)} {time(m.at)}{m.channel ? ` · ${m.channel}` : ''}</span>
              </span>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: m.delta >= 0 ? 'var(--green-700)' : 'var(--ink)' }}>{m.delta >= 0 ? '+' : ''}{n(m.delta)}</span>
            </div>
          ))}
        </section>
        <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={h2}>{t('adm.crm.ac.runs')}</h2>
          {d.runs.length === 0 && <EmptyNote>{t('adm.crm.ac.runsNone')}</EmptyNote>}
          {d.runs.slice(0, 10).map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 14 }}>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{dShort(r.at)} {time(r.at)}</span>
                <span style={{ fontSize: 12.5, color: r.error ? 'var(--red-600)' : 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.error ?? t('adm.crm.ac.runTickets', { n: r.tickets ?? 0, req: r.requests ?? 0 })}</span>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: r.status === 'ok' || r.status === 'success' ? 'var(--green-700)' : 'var(--red-600)' }}>{r.status}</span>
            </div>
          ))}
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 20, alignItems: 'start' }}>
        <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={h2}>{t('adm.crm.ac.sends')}</h2>
          {d.sends.length === 0 && <EmptyNote>{t('adm.crm.ac.sendsNone')}</EmptyNote>}
          {d.sends.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 14 }}>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{dShort(s.at)} · {t('adm.crm.ac.sendRecipients', { n: n(s.recipients ?? 0) })}</span>
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)', textAlign: 'right' }}>{s.status}{s.bounced ? ` · ${s.bounced} bounces` : ''}{s.complained ? ` · ${s.complained} ⚠` : ''}</span>
            </div>
          ))}
        </section>
        <NoteCard d={d} />
      </div>

      <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={h2}>{t('adm.crm.ac.audit')}</h2>
        {d.audit.length === 0 && <EmptyNote>{t('adm.crm.ac.auditNone')}</EmptyNote>}
        {d.audit.map((x, i) => (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 14 }}>
            <span><b>{t(`adm.crm.ac.a.${x.action}`)}</b>{x.meta?.reason ? <span style={{ color: 'var(--sand-600)' }}> · {String(x.meta.reason)}</span> : null}</span>
            <span style={{ color: 'var(--sand-500)', fontSize: 12.5 }}>{dShort(x.at)} {time(x.at)}</span>
          </div>
        ))}
      </section>
    </>
  );
}

const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.03em' } as const;

/** Notes internes : enregistrées toutes seules, une seconde après la dernière frappe. */
function NoteCard({ d }: { d: AdminAccountDetail }) {
  const { t } = useCrmT();
  const save = useAdminGesture<{ p_scope_key: string; p_body: string }>('crm_admin_note_save');
  const [text, setText] = useState(d.note);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setState('saving');
    const id = setTimeout(() => { save.mutate({ p_scope_key: d.account.id, p_body: text }, { onSuccess: () => setState('saved') }); }, 1000);
    return () => clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={h2}>{t('adm.crm.ac.notes')}</h2>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={4000} aria-label={t('adm.crm.ac.notes')} style={{ width: '100%', boxSizing: 'border-box', borderRadius: 16, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: 14, font: 'inherit', fontSize: 14.5, lineHeight: 1.5, resize: 'vertical', outline: 'none' }} />
      <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t(state === 'saving' ? 'adm.crm.ac.noteSaving' : 'adm.crm.ac.noteAuto')}</span>
    </section>
  );
}

function GestureDialog({ gesture, d, onClose }: { gesture: Gesture; d: AdminAccountDetail; onClose: () => void }) {
  const { t, n, dShort } = useCrmT();
  const toast = useCrmToast();
  const id = d.account.id;
  const grant = useAdminGesture<{ p_scope_key: string; p_amount: number; p_reason: string }>('crm_admin_grant_yunits');
  const extend = useAdminGesture<{ p_scope_key: string; p_days: number; p_reason: string }>('crm_admin_extend_trial');
  const freeze = useAdminGesture<{ p_scope_key: string; p_frozen: boolean; p_reason: string }>('crm_admin_freeze');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(2000);
  const [days, setDays] = useState(7);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setReason(''); setErr(null); }, [gesture]);
  if (!gesture) return null;
  const busy = grant.isPending || extend.isPending || freeze.isPending;
  const ok = reason.trim().length >= 3;
  const fail = (e: unknown) => {
    const code = (e as { message?: string } | null)?.message ?? '';
    const known = ['reason_required', 'bad_amount', 'bad_days', 'not_extendable', 'not_found'].includes(code);
    setErr(t(`adm.crm.ac.err.${known ? code : 'x'}`));
  };
  const submit = () => {
    if (!ok || busy) return;
    const done = (msg: string) => () => { toast(msg); onClose(); };
    if (gesture === 'grant') grant.mutate({ p_scope_key: id, p_amount: amount, p_reason: reason }, { onSuccess: done(t('adm.crm.ac.doneGrant', { n: n(amount) })), onError: fail });
    else if (gesture === 'extend') extend.mutate({ p_scope_key: id, p_days: days, p_reason: reason }, { onSuccess: done(t('adm.crm.ac.doneExtend', { n: days })), onError: fail });
    else freeze.mutate({ p_scope_key: id, p_frozen: gesture === 'freeze', p_reason: reason }, { onSuccess: done(t(gesture === 'freeze' ? 'adm.crm.ac.doneFreeze' : 'adm.crm.ac.doneUnfreeze')), onError: fail });
  };
  const title = { grant: 'adm.crm.ac.grant', extend: 'adm.crm.ac.extend', freeze: 'adm.crm.ac.freeze', unfreeze: 'adm.crm.ac.unfreeze' }[gesture];
  const input = { height: 44, borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 14px', font: 'inherit', fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box' } as const;
  return (
    <Modal open onClose={onClose} width={500} label={t(title)}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ ...h2, fontSize: 24 }}>{t(title)} · {d.account.name}</h2>
        {gesture === 'grant' && <label style={lbl}>{t('adm.crm.ac.amount')}<input type="number" min={1} max={100000} step={500} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} style={input} /></label>}
        {gesture === 'extend' && <label style={lbl}>{t('adm.crm.ac.days')}<input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value))))} style={input} /></label>}
        {gesture === 'freeze' && <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t('adm.crm.ac.freezeBody')}</p>}
        {gesture === 'extend' && d.account.trial_ends_at && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--sand-500)' }}>{t('adm.crm.ac.trialEnds', { date: dShort(d.account.trial_ends_at) })}</p>}
        <label style={lbl}>{t('adm.crm.ac.reason')}<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} style={{ ...input, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
        {err && <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{err}</span>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
          <Hv as="button" type="button" onClick={submit} disabled={!ok || busy} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: gesture === 'freeze' ? 'var(--red-600)' : 'var(--ink)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: ok && !busy ? 'pointer' : 'default', opacity: ok && !busy ? 1 : 0.45 }}>{t('adm.crm.ac.confirm')}</Hv>
        </div>
      </div>
    </Modal>
  );
}
const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600 } as const;
