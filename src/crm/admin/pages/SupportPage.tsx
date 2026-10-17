/**
 * Admin CRM › Accès assisté : entrer dans le compte Yuno CRM d'un client pour
 * l'aider à tout mettre en place, avec SON accord (admin_support_grants,
 * migration 20260824120000 ; vue crm_admin_support, 20261019420000). Le
 * super admin demande (motif obligatoire), le titulaire accepte depuis sa
 * Console (Compte › Accès Yuno), puis la session s'ouvre ici. Facturation,
 * e-mail de connexion et 2FA restent verrouillés côté serveur ; chaque action
 * est journalisée sous ses yeux.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { initialsOf } from '@/crm/lib/crmInvites';
import { Modal, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { ADMIN_ROUTES } from '../adminNav';
import { OpenConsoleDialog, RequestSupportDialog, useSupportActions } from '../gestures';
import { useAdminSupport, type SupportAccount, type SupportData } from '../inviteData';
import { Avatar, EmptyNote, Kpi, PageHead, RowLine, Section, kpiGrid, pageWrap, twoCols, useAgo } from '../ui';
import { Pill, btn, btnInk, h2, inputCss } from '../forms';

const LOG_ACTIONS = ['grant_approved', 'grant_revoked', 'session_opened', 'session_ended', 'help_requested', 'insert', 'update', 'delete'];

export default function SupportPage() {
  const { t, n } = useCrmT();
  const q = useAdminSupport();
  const actions = useSupportActions();
  const [ask, setAsk] = useState<SupportAccount | null>(null);
  const [enter, setEnter] = useState<SupportAccount | null>(null);
  const [cancel, setCancel] = useState<SupportAccount | null>(null);
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  const d = q.data;
  const active = d?.accounts.filter((a) => a.grant?.status === 'active') ?? [];
  const pending = d?.accounts.filter((a) => a.grant?.status === 'pending') ?? [];
  const sessions = d?.accounts.reduce((s, a) => s + a.sessions_90, 0) ?? 0;
  return (
    <main style={pageWrap}>
      <PageHead kicker={t('adm.crm.sp.kicker')} title={t('adm.crm.sp.title')} sub={t('adm.crm.sp.sub')} />
      {!d ? <Skel h={420} r={28} /> : (
        <>
          <div style={kpiGrid}>
            <Kpi label={t('adm.crm.sp.k.active')} value={n(active.length)} dot="var(--green-500)" sub={t('adm.crm.sp.k.activeSub')} />
            <Kpi label={t('adm.crm.sp.k.pending')} value={n(pending.length)} dot="var(--amber-500)" sub={t('adm.crm.sp.k.pendingSub')} delay={60} />
            <Kpi label={t('adm.crm.sp.k.sessions')} value={n(sessions)} sub={t('adm.crm.sp.k.sessionsSub')} delay={120} />
          </div>
          <div style={twoCols}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
              <Section title={t('adm.crm.sp.active')} sub={t('adm.crm.sp.activeSub')} pad={24} gap={4}>
                {active.length === 0 && <EmptyNote>{t('adm.crm.sp.noneActive')}</EmptyNote>}
                {active.map((a, i) => <AccountRow key={a.id} a={a} first={i === 0} onEnter={() => setEnter(a)} onCancel={() => setCancel(a)} />)}
              </Section>
              <Section title={t('adm.crm.sp.pending')} sub={t('adm.crm.sp.pendingSub')} pad={24} gap={4}>
                {pending.length === 0 && <EmptyNote>{t('adm.crm.sp.nonePending')}</EmptyNote>}
                {pending.map((a, i) => <AccountRow key={a.id} a={a} first={i === 0} onAsk={() => setAsk(a)} onCancel={() => setCancel(a)} />)}
              </Section>
              <AllAccounts d={d} onAsk={setAsk} onEnter={setEnter} />
            </div>
            <Journal d={d} />
          </div>
        </>
      )}
      {enter && enter.grant && <OpenConsoleDialog name={enter.name} open busy={actions.busy} onClose={() => setEnter(null)} onConfirm={() => { if (enter.grant) void actions.open(enter.grant.id, enter.name); }} />}
      {ask && ask.owner_id && <RequestSupportDialog name={ask.name} open pending={ask.grant?.status === 'pending'} busy={actions.busy} onClose={() => setAsk(null)} onSend={(r) => { if (ask.owner_id) void actions.request(ask.owner_id, r).then((ok) => { if (ok) setAsk(null); }); }} />}
      {cancel && cancel.grant && <CancelDialog a={cancel} onClose={() => setCancel(null)} />}
    </main>
  );
}

function AccountRow({ a, first, onEnter, onAsk, onCancel }: { a: SupportAccount; first: boolean; onEnter?: () => void; onAsk?: () => void; onCancel?: () => void }) {
  const { t, time } = useCrmT();
  const ago = useAgo();
  const g = a.grant;
  const meta: string[] = [];
  if (g?.status === 'active') meta.push(t(g.initiated_by === 'client' ? 'adm.crm.sp.m.askedByPro' : 'adm.crm.sp.m.approved', { ago: ago(g.approved_at ?? g.created_at) }));
  if (g?.status === 'pending') meta.push(t('adm.crm.sp.m.requested', { ago: ago(g.created_at) }));
  if (a.live_until) meta.push(t('adm.crm.sp.m.live', { time: time(a.live_until) }));
  else if (a.last_session_at) meta.push(t('adm.crm.sp.m.lastSession', { ago: ago(a.last_session_at) }));
  return (
    <RowLine first={first}>
      <Avatar text={initialsOf(a.name)} size={38} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Hv as={Link} to={ADMIN_ROUTES.account(a.id)} style={{ fontWeight: 700, color: 'var(--ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} hover={{ textDecoration: 'underline' }}>{a.name}</Hv>
          {a.live_until && <Pill tone="green" icon="eye">{t('adm.crm.sp.liveNow')}</Pill>}
          {g?.status === 'pending' && <Pill tone="amber">{t('adm.crm.sp.st.pending')}</Pill>}
          {g?.status === 'active' && !a.live_until && <Pill tone="green">{t('adm.crm.sp.st.active')}</Pill>}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--sand-500)', lineHeight: 1.45 }}>
          {[a.contact, a.email, a.city].filter(Boolean).join(' · ')}{(a.contact || a.email || a.city) ? <br /> : null}
          {meta.join(' · ')}{g?.reason ? <><br />{t('adm.crm.sp.m.reason', { reason: g.reason })}</> : null}
        </span>
      </span>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {onEnter && <Hv as="button" type="button" onClick={onEnter} style={btnInk} hover={{ background: 'var(--sand-700)' }}><Icon name="arrowRight" size={14} stroke={2.4} />{t('adm.crm.sup.open')}</Hv>}
        {onAsk && <Hv as="button" type="button" onClick={onAsk} style={btn} hover={{ background: 'var(--sand-50)' }}><Icon name="refresh" size={14} stroke={2.4} />{t('adm.crm.sp.remind')}</Hv>}
        {onCancel && <Hv as="button" type="button" onClick={onCancel} style={btn} hover={{ background: 'var(--red-50)', color: 'var(--red-700)' }}>{t(g?.status === 'active' ? 'adm.crm.sp.cut' : 'adm.crm.sp.withdraw')}</Hv>}
      </span>
    </RowLine>
  );
}

function AllAccounts({ d, onAsk, onEnter }: { d: SupportData; onAsk: (a: SupportAccount) => void; onEnter: (a: SupportAccount) => void }) {
  const { t } = useCrmT();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = d.accounts.filter((a) => !s || `${a.name} ${a.city ?? ''} ${a.contact ?? ''} ${a.email ?? ''}`.toLowerCase().includes(s));
    return list.slice(0, 40);
  }, [d.accounts, q]);
  return (
    <Section title={t('adm.crm.sp.all')} sub={t('adm.crm.sp.allSub')} pad={24} gap={8}
      right={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('adm.crm.sp.search')} style={{ ...inputCss, width: 240, height: 40 }} />}>
      {rows.length === 0 && <EmptyNote>{t('adm.crm.sp.noneFound')}</EmptyNote>}
      {rows.map((a, i) => (
        <RowLine key={a.id} first={i === 0}>
          <Avatar text={initialsOf(a.name)} size={34} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</b>
              <Pill tone="faded">{t(`adm.crm.type.${a.type}`)}</Pill>
              {a.grant && <Pill tone={a.grant.status === 'active' ? 'green' : 'amber'}>{t(`adm.crm.sp.st.${a.grant.status}`)}</Pill>}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{[a.contact, a.email, a.city].filter(Boolean).join(' · ')}</span>
          </span>
          {!a.owner_id ? <span style={{ fontSize: 12.5, color: 'var(--sand-400)' }}>{t('adm.crm.sp.noOwner')}</span>
            : a.grant?.status === 'active'
              ? <Hv as="button" type="button" onClick={() => onEnter(a)} style={btnInk} hover={{ background: 'var(--sand-700)' }}>{t('adm.crm.sup.open')}</Hv>
              : <Hv as="button" type="button" onClick={() => onAsk(a)} style={btn} hover={{ background: 'var(--sand-50)' }}>{t(a.grant?.status === 'pending' ? 'adm.crm.sp.remind' : 'adm.crm.sup.ask')}</Hv>}
        </RowLine>
      ))}
    </Section>
  );
}

function Journal({ d }: { d: SupportData }) {
  const { t, dShort, time } = useCrmT();
  return (
    <Section title={t('adm.crm.sp.log')} sub={t('adm.crm.sp.logSub')} pad={24} gap={4}>
      {d.log.length === 0 && <EmptyNote>{t('adm.crm.sp.noLog')}</EmptyNote>}
      {d.log.map((l, i) => {
        const action = LOG_ACTIONS.includes(l.action) ? l.action : 'update';
        return (
          <RowLine key={`${l.at}-${i}`} first={i === 0}>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {t(`adm.crm.sp.a.${action}`)}{l.table ? <span style={{ fontWeight: 500, color: 'var(--sand-500)' }}> · {l.table}</span> : null}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>
                {l.account_id ? <Link to={ADMIN_ROUTES.account(l.account_id)} style={{ color: 'inherit' }}>{l.account ?? '—'}</Link> : (l.account ?? '—')}
                {' · '}{t(l.by_admin ? 'adm.crm.sp.byYuno' : 'adm.crm.sp.byPro')}
              </span>
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{dShort(l.at)} · {time(l.at)}</span>
          </RowLine>
        );
      })}
    </Section>
  );
}

function CancelDialog({ a, onClose }: { a: SupportAccount; onClose: () => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const active = a.grant?.status === 'active';
  const go = async () => {
    if (!a.grant || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('revoke_support_grant', { _grant_id: a.grant.id });
    setBusy(false);
    if (error) { toast(t('adm.crm.iv.err.x')); return; }
    toast(t(active ? 'adm.crm.sp.cutDone' : 'adm.crm.sp.withdrawDone'));
    void qc.invalidateQueries({ queryKey: ['crm-admin'] });
    onClose();
  };
  return (
    <Modal open onClose={onClose} width={460} label={t(active ? 'adm.crm.sp.cutT' : 'adm.crm.sp.withdrawT', { name: a.name })}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ ...h2, fontSize: 22 }}>{t(active ? 'adm.crm.sp.cutT' : 'adm.crm.sp.withdrawT', { name: a.name })}</h2>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t(active ? 'adm.crm.sp.cutB' : 'adm.crm.sp.withdrawB')}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
          <Hv as="button" type="button" disabled={busy} onClick={() => void go()} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--red-600)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{t(active ? 'adm.crm.sp.cut' : 'adm.crm.sp.withdraw')}</Hv>
        </div>
      </div>
    </Modal>
  );
}
