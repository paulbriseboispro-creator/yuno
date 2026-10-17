/**
 * Admin CRM › Inviter : le super admin invite lui-même un club ou un
 * organisateur sur Yuno CRM (migration 20261019420000). L'invitation porte un
 * PRÉ-PROFIL (type, structure, contact, e-mail, téléphone, ville, langue) qui
 * remplit l'inscription ; elle part par e-mail (edge admin-account-recovery,
 * crm-invite-email) ou par WhatsApp. L'offre fondateurs (5 places, 6 mois,
 * 15 000 Yunits) s'y choisit en un clic ; l'accès démo et la proposition
 * d'accès assisté s'y ajoutent. Remplace l'onglet Vente › Offre fondateurs.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { crmInviteWhatsAppText, crmLang, initialsOf, inviteStage, whatsAppUrl, type InviteLang, type InviteStage } from '@/crm/lib/crmInvites';
import { Modal, Segmented, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminGesture } from '../data';
import { invokeAdminAction, inviteErr, useAdminInvites, type CrmInvite, type InvitesData } from '../inviteData';
import { Avatar, Chip, EmptyNote, PageHead, RowLine, Section, card, pageWrap, twoCols, useAgo } from '../ui';
import { CopyField, ErrorLine, Opt, Pill, Spinner, ToggleRow, box, btn, btnInk, ctaBig, h2, inputCss, lbl, mono } from '../forms';
import type { PillTone } from '../forms';

const codeOf = (e: unknown) => (e as { message?: string; code?: string } | null)?.message ?? '';

type Filter = 'all' | 'open' | 'claimed' | 'founder' | 'closed';
const STAGE_TONE: Record<InviteStage, PillTone> = { ready: 'sand', sent: 'sand', opened: 'amber', started: 'amber', claimed: 'green', expired: 'faded', revoked: 'red' };

export default function InvitePage() {
  const { t } = useCrmT();
  const q = useAdminInvites();
  const [sp, setSp] = useSearchParams();
  const [share, setShare] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<CrmInvite | null>(null);
  const filter = (['open', 'claimed', 'founder', 'closed'] as const).find((x) => x === sp.get('f')) ?? 'all';
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  const d = q.data;
  const shared = d?.invites.find((x) => x.id === share) ?? null;
  return (
    <main style={pageWrap}>
      <PageHead kicker={t('adm.crm.iv.kicker')} title={t('adm.crm.iv.title')} sub={t('adm.crm.iv.sub')} />
      {!d ? <Skel h={420} r={28} /> : (
        <>
          <Seats d={d} />
          <div style={twoCols}>
            <NewInvite d={d} onCreated={setShare} />
            <InviteList d={d} filter={filter} setFilter={(f) => setSp(f === 'all' ? {} : { f }, { replace: true })} onShare={setShare} onRevoke={setRevoke} />
          </div>
        </>
      )}
      {shared && d && <ShareDialog x={shared} d={d} onClose={() => setShare(null)} />}
      {revoke && <RevokeDialog x={revoke} onClose={() => setRevoke(null)} />}
    </main>
  );
}

function Seats({ d }: { d: InvitesData }) {
  const { t, n } = useCrmT();
  const dots = Array.from({ length: d.seats.total }, (_, i) => (i < d.seats.claimed ? 'claimed' : i < d.seats.claimed + d.seats.pending ? 'pending' : 'free'));
  return (
    <section style={{ ...card, borderRadius: 28, padding: '22px 28px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 32px', background: 'radial-gradient(60% 80% at 100% 0%,rgba(255,107,53,.08),transparent 70%),#fff' }}>
      <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <span style={{ ...mono, color: 'var(--red-600)' }}>{t('adm.crm.fo.title')}</span>
        <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--sand-700)', textWrap: 'pretty' }}>
          {t('adm.crm.fo.sub', { months: d.config.free_months, yunits: n(d.config.yunits), price: n(d.price_month) })}
        </span>
        <span style={{ fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.45 }}>{t('adm.crm.iv.seatsHow')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 8 }} aria-hidden>
          {dots.map((s, i) => (
            <span key={i} style={{
              width: 34, height: 34, borderRadius: 99, display: 'grid', placeItems: 'center', boxSizing: 'border-box',
              background: s === 'claimed' ? 'var(--gradient-brand)' : s === 'pending' ? '#fff' : 'var(--sand-100)',
              boxShadow: s === 'pending' ? 'inset 0 0 0 2px var(--red-400)' : 'none', color: '#fff',
            }}>{s === 'claimed' && <Icon name="check" size={16} stroke={2.6} />}</span>
          ))}
        </div>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t('adm.crm.fo.seats', { claimed: d.seats.claimed, pending: d.seats.pending, left: d.seats.left })}</span>
      </div>
    </section>
  );
}

// ── Nouvelle invitation ─────────────────────────────────────────────────────
interface Draft {
  kind: 'club' | 'organizer'; org: string; contact: string; email: string; phone: string; city: string;
  lang: InviteLang; offer: 'standard' | 'founder'; support: boolean; demo: boolean; note: string;
}
const EMPTY: Draft = { kind: 'club', org: '', contact: '', email: '', phone: '', city: '', lang: 'fr', offer: 'standard', support: true, demo: false, note: '' };

function NewInvite({ d, onCreated }: { d: InvitesData; onCreated: (id: string) => void }) {
  const { t, n } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const create = useAdminGesture<{ p: Record<string, unknown> }>('crm_admin_invite_create');
  const demo = useAdminGesture<{ p: Record<string, unknown> }>('crm_admin_demo_link_create');
  const [f, setF] = useState<Draft>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const full = d.seats.left <= 0;
  const busy = create.isPending || demo.isPending;
  const ok = f.org.trim().length > 0 && !busy && !(f.offer === 'founder' && full);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setF((s) => ({ ...s, [k]: v })); setErr(null); };
  const submit = () => {
    if (!ok) return;
    create.mutate({ p: {
      offer: f.offer, kind: f.kind, org_name: f.org.trim(), contact_name: f.contact.trim() || null, email: f.email.trim() || null,
      phone: f.phone || null, city: f.city.trim() || null, lang: f.lang, note: f.note.trim() || null, support_offer: f.support,
    } }, {
      onSuccess: (r) => {
        const inv = r as CrmInvite;
        const done = () => {
          toast(t('adm.crm.iv.created', { name: inv.org_name }));
          setF({ ...EMPTY, lang: f.lang, kind: f.kind });
          onCreated(inv.id);
        };
        if (!f.demo) { done(); return; }
        demo.mutate({ p: { invite_id: inv.id } }, {
          onSuccess: () => { void qc.invalidateQueries({ queryKey: ['crm-admin'] }); done(); },
          onError: () => { toast(t('adm.crm.iv.demoFailed')); done(); },
        });
      },
      onError: (e) => setErr(inviteErr(t, codeOf(e))),
    });
  };
  const offerCard = (o: Draft['offer']) => {
    const on = f.offer === o;
    const off = o === 'founder' && full;
    return (
      <Hv as="button" type="button" disabled={off} onClick={() => set('offer', o)} aria-pressed={on}
        style={{ flex: '1 1 200px', minWidth: 0, textAlign: 'left', padding: '14px 16px', borderRadius: 18, border: 0, cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.5 : 1,
          background: on ? (o === 'founder' ? 'linear-gradient(135deg,rgba(227,20,27,.07),rgba(255,107,53,.1))' : 'var(--sand-50)') : '#fff',
          boxShadow: on ? 'inset 0 0 0 2px var(--red-400)' : 'inset 0 0 0 1.5px var(--sand-200)', display: 'flex', flexDirection: 'column', gap: 4, font: 'inherit', color: 'var(--ink)' }}
        hover={off ? undefined : { boxShadow: on ? 'inset 0 0 0 2px var(--red-400)' : 'inset 0 0 0 1.5px var(--sand-300)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15 }}>
          {o === 'founder' ? <Icon name="sparkles" size={16} stroke={2.2} color="var(--red-600)" /> : <Icon name="clock" size={16} stroke={2.2} />}
          {t(o === 'founder' ? 'adm.crm.iv.offer.founder' : 'adm.crm.iv.offer.standard')}
        </span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)' }}>
          {o === 'founder'
            ? (full ? t('adm.crm.fo.full') : t('adm.crm.iv.offer.founderSub', { months: d.config.free_months, yunits: n(d.config.yunits), left: d.seats.left }))
            : t('adm.crm.iv.offer.standardSub', { days: d.trial.days, yunits: n(d.trial.yunits), price: n(d.price_month) })}
        </span>
      </Hv>
    );
  };
  return (
    <Section title={t('adm.crm.iv.new')} sub={t('adm.crm.iv.newSub')} pad={24} gap={14}>
      <div style={lbl}>{t('adm.crm.iv.f.kind')}
        <Segmented<Draft['kind']> value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'club', label: t('adm.crm.type.club') }, { value: 'organizer', label: t('adm.crm.type.organizer') }]} />
      </div>
      <label style={lbl}>{t(f.kind === 'club' ? 'adm.crm.iv.f.orgClub' : 'adm.crm.iv.f.orgOrg')}<input value={f.org} onChange={(e) => set('org', e.target.value)} maxLength={120} placeholder={f.kind === 'club' ? 'Le Rex' : '3AM'} style={inputCss} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
        <label style={lbl}><span>{t('adm.crm.iv.f.contact')} <Opt /></span><input value={f.contact} onChange={(e) => set('contact', e.target.value)} maxLength={120} autoComplete="off" placeholder={t('adm.crm.iv.f.contactPh')} style={inputCss} /></label>
        <label style={lbl}><span>{t('adm.crm.iv.f.city')} <Opt /></span><input value={f.city} onChange={(e) => set('city', e.target.value)} maxLength={120} autoComplete="off" style={inputCss} /></label>
      </div>
      <label style={lbl}><span>{t('adm.crm.fo.f.email')} <Opt /></span><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} maxLength={254} autoComplete="off" style={inputCss} /></label>
      <div style={lbl}><span>{t('adm.crm.fo.f.phone')} <Opt /></span>
        <PhoneInputWithCountry tone="light" value={f.phone} onChange={(v) => set('phone', v)} defaultCountry={f.lang === 'es' ? 'ES' : f.lang === 'fr' ? 'FR' : null} inputStyle={{ height: 46, borderRadius: 14, fontSize: 15 }} triggerStyle={{ height: 46, borderRadius: 14 }} />
      </div>
      <div style={lbl}>{t('adm.crm.fo.f.lang')}
        <Segmented<InviteLang> value={f.lang} onChange={(v) => set('lang', v)} options={(['fr', 'en', 'es'] as const).map((l) => ({ value: l, label: t(`adm.crm.fo.lang.${l}`) }))} />
      </div>
      <div style={lbl}>{t('adm.crm.iv.f.offer')}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{offerCard('standard')}{offerCard('founder')}</div>
      </div>
      <ToggleRow on={f.support} onChange={(v) => set('support', v)} title={t('adm.crm.iv.f.support')} hint={t('adm.crm.iv.f.supportHint')} />
      <ToggleRow on={f.demo} onChange={(v) => set('demo', v)} title={t('adm.crm.iv.f.demo')} hint={t('adm.crm.iv.f.demoHint')} />
      <label style={lbl}><span>{t('adm.crm.fo.f.note')} <Opt /></span><textarea value={f.note} onChange={(e) => set('note', e.target.value)} rows={2} maxLength={500} style={{ ...inputCss, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
      {err && <ErrorLine>{err}</ErrorLine>}
      <div>
        <Hv as="button" type="button" onClick={submit} disabled={!ok} style={{ ...ctaBig, cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.45 }} hover={ok ? { filter: 'brightness(1.05)' } : undefined}>
          {busy ? <Spinner /> : <Icon name="send" size={17} stroke={2.4} />}{t('adm.crm.iv.create')}
        </Hv>
      </div>
    </Section>
  );
}

// ── La liste ────────────────────────────────────────────────────────────────
function InviteList({ d, filter, setFilter, onShare, onRevoke }: { d: InvitesData; filter: Filter; setFilter: (f: Filter) => void; onShare: (id: string) => void; onRevoke: (x: CrmInvite) => void }) {
  const { t } = useCrmT();
  const counts = useMemo(() => ({
    all: d.invites.length,
    open: d.invites.filter((x) => x.status === 'pending').length,
    claimed: d.invites.filter((x) => x.status === 'claimed').length,
    founder: d.invites.filter((x) => x.offer === 'founder').length,
    closed: d.invites.filter((x) => x.status === 'expired' || x.status === 'revoked').length,
  }), [d.invites]);
  const rows = d.invites.filter((x) => filter === 'all' ? true : filter === 'open' ? x.status === 'pending' : filter === 'claimed' ? x.status === 'claimed' : filter === 'founder' ? x.offer === 'founder' : x.status === 'expired' || x.status === 'revoked');
  return (
    <Section title={t('adm.crm.iv.list')} sub={t('adm.crm.iv.listSub', { days: d.config.link_days })} pad={24} gap={8}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        {(['all', 'open', 'claimed', 'founder', 'closed'] as const).map((k) => <Chip key={k} on={filter === k} onClick={() => setFilter(k)} n={counts[k]}>{t(`adm.crm.iv.f_${k}`)}</Chip>)}
      </div>
      {rows.length === 0 && <EmptyNote>{t(d.invites.length ? 'adm.crm.iv.noneHere' : 'adm.crm.iv.none')}</EmptyNote>}
      {rows.map((x, i) => <InviteRow key={x.id} x={x} first={i === 0} onShare={() => onShare(x.id)} onRevoke={() => onRevoke(x)} />)}
    </Section>
  );
}

function InviteRow({ x, first, onShare, onRevoke }: { x: CrmInvite; first: boolean; onShare: () => void; onRevoke: () => void }) {
  const { t, n, dShort } = useCrmT();
  const toast = useCrmToast();
  const ago = useAgo();
  const extend = useAdminGesture<{ p_id: string }>('crm_admin_invite_extend');
  const stage = inviteStage(x);
  const meta: string[] = [];
  if (x.status === 'claimed' && x.account) {
    if (x.offer === 'founder' && x.account.offer_until) meta.push(t('adm.crm.fo.m.until', { date: dShort(x.account.offer_until) }));
    else if (x.account.trial_ends_at) meta.push(t('adm.crm.iv.m.trialUntil', { date: dShort(x.account.trial_ends_at) }));
    meta.push(t('adm.crm.fo.m.balance', { n: n(x.account.yunits_balance) }));
    meta.push(t(x.account.has_stripe ? 'adm.crm.fo.m.card' : 'adm.crm.fo.m.noCard'));
  } else {
    meta.push(t('adm.crm.fo.m.created', { ago: ago(x.created_at) }));
    if (x.emailed_at) meta.push(t('adm.crm.fo.m.emailed', { ago: ago(x.emailed_at) }));
    if (x.shared_at) meta.push(t('adm.crm.fo.m.shared', { ago: ago(x.shared_at) }));
    if (x.opened_at) meta.push(t('adm.crm.fo.m.opened', { ago: ago(x.opened_at) }));
    const step = x.journey?.last_step;
    if (step && ['role', 'structure', 'account', 'created'].includes(step)) meta.push(t('adm.crm.iv.m.step', { step: t(`adm.crm.ck.step.${step}`) }));
    if (x.status === 'pending') meta.push(t('adm.crm.fo.m.expires', { date: dShort(x.expires_at) }));
  }
  const who = [x.contact_name, x.email, x.phone, x.city].filter(Boolean).join(' · ');
  return (
    <RowLine first={first}>
      <Avatar text={initialsOf(x.account?.name ?? x.org_name)} size={38} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 2 }}>{x.account?.name ?? x.org_name}</b>
          <Pill tone={STAGE_TONE[stage]}>{t(`adm.crm.iv.st.${stage}`)}</Pill>
          {x.offer === 'founder' ? <Pill tone="brand" icon="sparkles">{t('adm.crm.iv.offer.founder')}</Pill> : <Pill tone="faded">{t('adm.crm.iv.offer.standardShort')}</Pill>}
          {x.kind && <Pill tone="faded">{t(`adm.crm.type.${x.kind}`)}</Pill>}
          {x.demo && <Pill tone="faded" icon="eye">{t('adm.crm.iv.hasDemo')}</Pill>}
          {x.support ? <Pill tone={x.support.status === 'active' ? 'green' : 'amber'} icon="shield">{t(`adm.crm.iv.support.${x.support.status === 'active' ? 'active' : 'pending'}`)}</Pill>
            : x.support_offer && x.status === 'pending' ? <Pill tone="faded" icon="shield">{t('adm.crm.iv.support.offered')}</Pill> : null}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--sand-500)', lineHeight: 1.45 }}>
          {who}{who ? <br /> : null}{meta.join(' · ')}
          {x.status === 'revoked' && x.revoked_reason ? <><br />{t('adm.crm.iv.m.revoked', { reason: x.revoked_reason })}</> : null}
        </span>
      </span>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {x.status === 'pending' && <Hv as="button" type="button" onClick={onShare} style={btnInk} hover={{ background: 'var(--sand-700)' }}><Icon name="send" size={14} stroke={2.4} />{t('adm.crm.fo.send')}</Hv>}
        {(x.status === 'expired' || (x.status === 'pending' && new Date(x.expires_at).getTime() - Date.now() < 7 * 86_400_000)) && (
          <Hv as="button" type="button" disabled={extend.isPending} onClick={() => extend.mutate({ p_id: x.id }, { onSuccess: () => toast(t('adm.crm.iv.extended')), onError: (e) => toast(inviteErr(t, codeOf(e))) })} style={btn} hover={{ background: 'var(--sand-50)' }}>
            <Icon name="refresh" size={14} stroke={2.4} />{t('adm.crm.iv.extend')}
          </Hv>
        )}
        {x.status === 'pending' && <Hv as="button" type="button" onClick={onRevoke} style={btn} hover={{ background: 'var(--red-50)', color: 'var(--red-700)' }}>{t('adm.crm.fo.revoke')}</Hv>}
        {x.status === 'claimed' && x.scope_key && <Hv as={Link} to={ADMIN_ROUTES.account(x.scope_key)} style={btn} hover={{ background: 'var(--sand-50)', textDecoration: 'none' }}>{t('adm.crm.fo.account')}<Icon name="arrowRight" size={14} stroke={2.4} /></Hv>}
      </span>
    </RowLine>
  );
}

// ── Envoyer ─────────────────────────────────────────────────────────────────
function ShareDialog({ x, d, onClose }: { x: CrmInvite; d: InvitesData; onClose: () => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const mark = useAdminGesture<{ p_id: string; p_channel: 'whatsapp' | 'copy' }>('crm_admin_offer_invite_mark');
  const update = useAdminGesture<{ p_id: string; p_patch: Record<string, unknown> }>('crm_admin_offer_invite_update');
  const addDemo = useAdminGesture<{ p: Record<string, unknown> }>('crm_admin_demo_link_create');
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const lang = crmLang(x.lang);
  const demoLive = x.demo && x.demo.password && (x.demo.status === 'ready' || x.demo.status === 'opened') ? { url: x.demo.url, password: x.demo.password } : null;
  const text = crmInviteWhatsAppText({
    lang, offer: x.offer, orgName: x.org_name, contactName: x.contact_name, url: x.url, freeMonths: x.free_months, yunits: x.yunits,
    priceMonth: d.price_month, trialDays: d.trial.days, trialYunits: d.trial.yunits, expiresAt: x.expires_at, supportOffer: x.support_offer, demo: demoLive,
  });
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast(t('adm.crm.fo.copied')); mark.mutate({ p_id: x.id, p_channel: 'copy' }); } catch { /* le presse-papier peut être refusé */ }
  };
  const sendEmail = async () => {
    if (sending) return;
    setSending(true); setErr(null);
    const r = await invokeAdminAction<{ email?: string }>('crm-invite-email', { inviteId: x.id });
    setSending(false);
    if (!r.ok) { setErr(inviteErr(t, r.code)); return; }
    toast(t('adm.crm.fo.emailSent', { email: r.data.email ?? x.email ?? '' }));
    void qc.invalidateQueries({ queryKey: ['crm-admin'] });
    onClose();
  };
  return (
    <Modal open onClose={onClose} width={640} label={t('adm.crm.fo.shareT', { name: x.org_name })}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={h2}>{t('adm.crm.fo.shareT', { name: x.org_name })}</h2>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {x.offer === 'founder' ? <Pill tone="brand" icon="sparkles">{t('adm.crm.iv.offer.founder')}</Pill> : <Pill tone="sand">{t('adm.crm.iv.offer.standard')}</Pill>}
            {x.support_offer && <Pill tone="sand" icon="shield">{t('adm.crm.iv.support.offered')}</Pill>}
            {demoLive && <Pill tone="sand" icon="eye">{t('adm.crm.iv.hasDemo')}</Pill>}
          </span>
          <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t('adm.crm.iv.shareSub')}</p>
        </div>

        <div style={box}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><Icon name="mail" size={17} stroke={2.2} />{t('adm.crm.fo.byEmail')}</span>
          <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('adm.crm.iv.byEmailSub')}</span>
          {x.email ? (
            <Hv as="button" type="button" onClick={() => void sendEmail()} disabled={sending} style={{ ...btnInk, height: 44, padding: '0 18px', fontSize: 14.5, alignSelf: 'flex-start', opacity: sending ? 0.6 : 1 }} hover={{ background: 'var(--sand-700)' }}>
              {sending ? <Spinner /> : <Icon name="send" size={15} stroke={2.4} />}
              {t(x.emailed_at ? 'adm.crm.fo.resendTo' : 'adm.crm.fo.sendTo', { email: x.email })}
            </Hv>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(null); }} placeholder={t('adm.crm.fo.addEmail')} style={{ ...inputCss, flex: '1 1 240px', width: 'auto' }} />
              <Hv as="button" type="button" onClick={() => update.mutate({ p_id: x.id, p_patch: { email } }, { onError: (e) => setErr(inviteErr(t, codeOf(e))) })} disabled={!email.trim() || update.isPending} style={{ ...btnInk, height: 46, padding: '0 18px', opacity: email.trim() ? 1 : 0.45 }} hover={{ background: 'var(--sand-700)' }}>{t('adm.crm.fo.saveEmail')}</Hv>
            </div>
          )}
        </div>

        <div style={box}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><Icon name="whatsapp" size={17} stroke={2.2} />{t('adm.crm.fo.byWa')}</span>
          <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('adm.crm.fo.byWaSub')}</span>
          <Hv as="a" href={whatsAppUrl(x.phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => mark.mutate({ p_id: x.id, p_channel: 'whatsapp' })}
            style={{ ...btnInk, height: 44, padding: '0 18px', fontSize: 14.5, alignSelf: 'flex-start', background: '#1f8f4e' }} hover={{ filter: 'brightness(1.08)', textDecoration: 'none', color: '#fff' }}>
            <Icon name="whatsapp" size={16} stroke={2.2} />{x.phone ? t('adm.crm.fo.openWaTo', { phone: x.phone }) : t('adm.crm.fo.openWa')}
          </Hv>
          <span style={{ ...mono, marginTop: 4 }}>{t('adm.crm.fo.message')}</span>
          <pre style={{ margin: 0, padding: 14, borderRadius: 14, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--sand-700)', maxHeight: 220, overflowY: 'auto' }}>{text}</pre>
          <Hv as="button" type="button" onClick={() => void copy(text)} style={{ ...btn, alignSelf: 'flex-start' }} hover={{ background: 'var(--sand-50)' }}>
            <Icon name="copy" size={14} stroke={2.4} />{t('adm.crm.fo.copyMsg')}
          </Hv>
        </div>

        <div style={box}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><Icon name="eye" size={17} stroke={2.2} />{t('adm.crm.iv.demoT')}</span>
          {demoLive ? (
            <>
              <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('adm.crm.iv.demoIn')}</span>
              <CopyField label={t('adm.crm.dm.link')} value={demoLive.url} />
              <CopyField label={t('adm.crm.dm.password')} value={demoLive.password} />
            </>
          ) : (
            <>
              <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('adm.crm.iv.demoAddSub')}</span>
              <Hv as="button" type="button" disabled={addDemo.isPending} onClick={() => addDemo.mutate({ p: { invite_id: x.id } }, { onSuccess: () => toast(t('adm.crm.iv.demoAdded')), onError: () => toast(t('adm.crm.iv.demoFailed')) })} style={{ ...btn, alignSelf: 'flex-start' }} hover={{ background: 'var(--sand-50)' }}>
                {addDemo.isPending ? <Spinner light={false} /> : <Icon name="plus" size={14} stroke={2.4} />}{t('adm.crm.iv.demoAdd')}
              </Hv>
            </>
          )}
        </div>

        <CopyField label={t('adm.crm.fo.link')} value={x.url} onCopied={() => mark.mutate({ p_id: x.id, p_channel: 'copy' })} />
        {err && <ErrorLine>{err}</ErrorLine>}
      </div>
    </Modal>
  );
}

function RevokeDialog({ x, onClose }: { x: CrmInvite; onClose: () => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const revoke = useAdminGesture<{ p_id: string; p_reason: string }>('crm_admin_offer_invite_revoke');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const ok = reason.trim().length >= 3 && !revoke.isPending;
  return (
    <Modal open onClose={onClose} width={480} label={t('adm.crm.fo.revokeT', { name: x.org_name })}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ ...h2, fontSize: 22 }}>{t('adm.crm.fo.revokeT', { name: x.org_name })}</h2>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t(x.offer === 'founder' ? 'adm.crm.fo.revokeB' : 'adm.crm.iv.revokeB')}</p>
        <label style={lbl}>{t('adm.crm.ac.reason')}<textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} rows={3} maxLength={300} style={{ ...inputCss, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
        {err && <ErrorLine>{err}</ErrorLine>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
          <Hv as="button" type="button" disabled={!ok}
            onClick={() => revoke.mutate({ p_id: x.id, p_reason: reason }, { onSuccess: () => { toast(t('adm.crm.fo.revoked')); onClose(); }, onError: (e) => setErr(inviteErr(t, codeOf(e))) })}
            style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--red-600)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.45 }}>{t('adm.crm.fo.revoke')}</Hv>
        </div>
      </div>
    </Modal>
  );
}
