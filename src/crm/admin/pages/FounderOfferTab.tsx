/**
 * Admin CRM › Vente › Offre fondateurs : les 5 comptes que le fondateur choisit
 * lui-même ({months} mois offerts dès l'ouverture, {yunits} Yunits, puis le prix
 * de lancement garanti). On crée l'invitation, on l'envoie par e-mail (edge
 * admin-account-recovery, crm-founder-offer-email) ou par WhatsApp (lien wa.me
 * avec le message prêt), et on suit qui l'a ouverte et qui a ouvert son compte.
 * Tout passe par les RPC crm_admin_offer_* (migration 20261017230000).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { rpc } from '@/crm/lib/rpc';
import { founderOfferWhatsAppText, founderLang, inviteBadge, whatsAppUrl, type FounderLang } from '@/crm/lib/founderOffer';
import { Modal, Segmented, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminGesture } from '../data';
import { EmptyNote, RowLine, Section, card, useAgo } from '../ui';

export type InviteStatus = 'pending' | 'claimed' | 'expired' | 'revoked';

export interface FounderInvite {
  id: string; url: string; org_name: string; contact_name: string | null; email: string | null; phone: string | null;
  lang: FounderLang; note: string | null; free_months: number; yunits: number; status: InviteStatus;
  expires_at: string; created_at: string; emailed_at: string | null; email_count: number; shared_at: string | null;
  opened_at: string | null; claimed_at: string | null; scope_key: string | null;
  account: { name: string | null; offer_until: string | null; status: string; has_stripe: boolean; yunits_balance: number } | null;
}

export interface FounderOffer {
  config: { seats: number; free_months: number; yunits: number; link_days: number };
  price_month: number;
  seats: { total: number; claimed: number; pending: number; left: number };
  invites: FounderInvite[];
}

function useFounderOffer() {
  return useQuery({ queryKey: ['crm-admin', 'founder-offer'], staleTime: 15_000, queryFn: () => rpc<FounderOffer>('crm_admin_offer_invites') });
}

const ERR = ['offer_full', 'org_name_required', 'bad_email', 'not_pending', 'no_email', 'email_failed', 'reason_required'];
const inputCss = { height: 46, borderRadius: 14, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 14px', font: 'inherit', fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box', background: '#fff' } as const;
const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600 } as const;
const mono = { fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' } as const;

const BADGE: Record<ReturnType<typeof inviteBadge>, { bg: string; fg: string }> = {
  pending: { bg: 'var(--sand-100)', fg: 'var(--sand-700)' },
  opened: { bg: 'var(--amber-50)', fg: 'var(--amber-700)' },
  claimed: { bg: 'var(--green-50)', fg: 'var(--green-700)' },
  expired: { bg: 'var(--sand-100)', fg: 'var(--sand-500)' },
  revoked: { bg: 'var(--red-50)', fg: 'var(--red-700)' },
};

function errText(t: (k: string) => string, e: unknown): string {
  const code = (e as { message?: string; code?: string } | null)?.message ?? '';
  return t(`adm.crm.fo.err.${ERR.includes(code) ? code : 'x'}`);
}

export default function FounderOfferTab() {
  const { t } = useCrmT();
  const q = useFounderOffer();
  const [share, setShare] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<FounderInvite | null>(null);
  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  if (!q.data) return <Skel h={420} r={28} />;
  const d = q.data;
  const shared = d.invites.find((x) => x.id === share) ?? null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Seats d={d} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20, alignItems: 'start' }}>
        <NewInvite d={d} onCreated={setShare} />
        <Section title={t('adm.crm.fo.list')} sub={t('adm.crm.fo.seatsNote')} pad={24} gap={4}>
          {d.invites.length === 0 && <EmptyNote>{t('adm.crm.fo.none')}</EmptyNote>}
          {d.invites.map((x, i) => <InviteRow key={x.id} x={x} first={i === 0} onShare={() => setShare(x.id)} onRevoke={() => setRevoke(x)} />)}
        </Section>
      </div>
      {shared && <ShareDialog x={shared} price={d.price_month} onClose={() => setShare(null)} />}
      {revoke && <RevokeDialog x={revoke} onClose={() => setRevoke(null)} />}
      <span style={{ fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('adm.crm.fo.stripe')}</span>
    </div>
  );
}

function Seats({ d }: { d: FounderOffer }) {
  const { t, n } = useCrmT();
  const dots = Array.from({ length: d.seats.total }, (_, i) => (i < d.seats.claimed ? 'claimed' : i < d.seats.claimed + d.seats.pending ? 'pending' : 'free'));
  return (
    <section style={{ ...card, borderRadius: 28, padding: '24px 28px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 32px', background: 'radial-gradient(60% 80% at 100% 0%,rgba(255,107,53,.08),transparent 70%),#fff' }}>
      <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <span style={{ ...mono, color: 'var(--red-600)' }}>{t('adm.crm.fo.title')}</span>
        <span style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--sand-700)', textWrap: 'pretty' }}>
          {t('adm.crm.fo.sub', { months: d.config.free_months, yunits: n(d.config.yunits), price: n(d.price_month) })}
        </span>
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

function NewInvite({ d, onCreated }: { d: FounderOffer; onCreated: (id: string) => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const create = useAdminGesture<{ p_org_name: string; p_contact_name: string | null; p_email: string | null; p_phone: string | null; p_lang: FounderLang; p_note: string | null }>('crm_admin_offer_invite_create');
  const [f, setF] = useState({ org: '', contact: '', email: '', phone: '', lang: 'fr' as FounderLang, note: '' });
  const [err, setErr] = useState<string | null>(null);
  const full = d.seats.left <= 0;
  const ok = f.org.trim().length > 0 && !full && !create.isPending;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setErr(null); };
  const submit = () => {
    if (!ok) return;
    create.mutate(
      { p_org_name: f.org.trim(), p_contact_name: f.contact.trim() || null, p_email: f.email.trim() || null, p_phone: f.phone || null, p_lang: f.lang, p_note: f.note.trim() || null },
      {
        onSuccess: (r) => {
          const inv = r as FounderInvite;
          toast(t('adm.crm.fo.created', { name: inv.org_name }));
          setF({ org: '', contact: '', email: '', phone: '', lang: f.lang, note: '' });
          onCreated(inv.id);
        },
        onError: (e) => setErr(errText(t, e)),
      },
    );
  };
  return (
    <Section title={t('adm.crm.fo.new')} sub={full ? t('adm.crm.fo.full') : t('adm.crm.fo.newSub')} pad={24} gap={14}>
      <fieldset disabled={full} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14, opacity: full ? 0.5 : 1 }}>
        <label style={lbl}>{t('adm.crm.fo.f.org')}<input value={f.org} onChange={(e) => set('org', e.target.value)} maxLength={120} placeholder="3AM" style={inputCss} /></label>
        <label style={lbl}><span>{t('adm.crm.fo.f.contact')} <Opt /></span><input value={f.contact} onChange={(e) => set('contact', e.target.value)} maxLength={120} autoComplete="off" style={inputCss} /></label>
        <label style={lbl}><span>{t('adm.crm.fo.f.email')} <Opt /></span><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} maxLength={254} autoComplete="off" style={inputCss} /></label>
        <div style={lbl}><span>{t('adm.crm.fo.f.phone')} <Opt /></span>
          <PhoneInputWithCountry tone="light" value={f.phone} onChange={(v) => set('phone', v)} defaultCountry={f.lang === 'es' ? 'ES' : f.lang === 'fr' ? 'FR' : null} inputStyle={{ height: 46, borderRadius: 14, fontSize: 15 }} triggerStyle={{ height: 46, borderRadius: 14 }} />
        </div>
        <div style={lbl}>{t('adm.crm.fo.f.lang')}
          <Segmented<FounderLang> value={f.lang} onChange={(v) => set('lang', v)} options={(['fr', 'en', 'es'] as const).map((l) => ({ value: l, label: t(`adm.crm.fo.lang.${l}`) }))} />
        </div>
        <label style={lbl}><span>{t('adm.crm.fo.f.note')} <Opt /></span><textarea value={f.note} onChange={(e) => set('note', e.target.value)} rows={2} maxLength={500} style={{ ...inputCss, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
      </fieldset>
      {err && <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{err}</span>}
      <div>
        <Hv as="button" type="button" onClick={submit} disabled={!ok}
          style={{ height: 48, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontWeight: 600, fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 10, cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.45, boxShadow: 'var(--shadow-cta)' }}
          hover={ok ? { filter: 'brightness(1.05)' } : undefined}>
          <Icon name="link" size={17} stroke={2.4} />{t('adm.crm.fo.create')}
        </Hv>
      </div>
    </Section>
  );
}

function Opt() {
  const { t } = useCrmT();
  return <span style={{ fontWeight: 500, color: 'var(--sand-400)' }}>· {t('adm.crm.fo.optional')}</span>;
}

function InviteRow({ x, first, onShare, onRevoke }: { x: FounderInvite; first: boolean; onShare: () => void; onRevoke: () => void }) {
  const { t, n, dShort } = useCrmT();
  const ago = useAgo();
  const b = inviteBadge(x);
  const meta: string[] = [];
  if (x.status === 'claimed' && x.account) {
    if (x.account.offer_until) meta.push(t('adm.crm.fo.m.until', { date: dShort(x.account.offer_until) }));
    meta.push(t('adm.crm.fo.m.balance', { n: n(x.account.yunits_balance) }));
    meta.push(t(x.account.has_stripe ? 'adm.crm.fo.m.card' : 'adm.crm.fo.m.noCard'));
  } else {
    meta.push(t('adm.crm.fo.m.created', { ago: ago(x.created_at) }));
    if (x.emailed_at) meta.push(t('adm.crm.fo.m.emailed', { ago: ago(x.emailed_at) }));
    if (x.shared_at) meta.push(t('adm.crm.fo.m.shared', { ago: ago(x.shared_at) }));
    if (x.opened_at) meta.push(t('adm.crm.fo.m.opened', { ago: ago(x.opened_at) }));
    if (x.status === 'pending') meta.push(t('adm.crm.fo.m.expires', { date: dShort(x.expires_at) }));
  }
  const btn = { height: 36, padding: '0 14px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink)', textDecoration: 'none' } as const;
  return (
    <RowLine first={first}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.account?.name ?? x.org_name}</b>
          <span style={{ height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: BADGE[b].bg, color: BADGE[b].fg }}>{t(`adm.crm.fo.st.${b}`)}</span>
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--sand-500)', lineHeight: 1.45 }}>
          {[x.contact_name, x.email, x.phone].filter(Boolean).join(' · ')}
          {(x.contact_name || x.email || x.phone) ? <br /> : null}
          {meta.join(' · ')}
        </span>
      </span>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {x.status === 'pending' && <Hv as="button" type="button" onClick={onShare} style={{ ...btn, border: 0, background: 'var(--ink)', color: '#fff' }} hover={{ background: 'var(--sand-700)' }}><Icon name="send" size={14} stroke={2.4} />{t('adm.crm.fo.send')}</Hv>}
        {x.status === 'pending' && <Hv as="button" type="button" onClick={onRevoke} style={btn} hover={{ background: 'var(--red-50)', color: 'var(--red-700)' }}>{t('adm.crm.fo.revoke')}</Hv>}
        {x.status === 'claimed' && x.scope_key && <Hv as={Link} to={ADMIN_ROUTES.account(x.scope_key)} style={btn} hover={{ background: 'var(--sand-50)', textDecoration: 'none' }}>{t('adm.crm.fo.account')}<Icon name="arrowRight" size={14} stroke={2.4} /></Hv>}
      </span>
    </RowLine>
  );
}

function ShareDialog({ x, price, onClose }: { x: FounderInvite; price: number; onClose: () => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const mark = useAdminGesture<{ p_id: string; p_channel: 'whatsapp' | 'copy' }>('crm_admin_offer_invite_mark');
  const update = useAdminGesture<{ p_id: string; p_patch: Record<string, unknown> }>('crm_admin_offer_invite_update');
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const lang = founderLang(x.lang);
  const text = founderOfferWhatsAppText({ lang, orgName: x.org_name, contactName: x.contact_name, url: x.url, freeMonths: x.free_months, yunits: x.yunits, priceMonth: price, expiresAt: x.expires_at });
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast(t('adm.crm.fo.copied')); mark.mutate({ p_id: x.id, p_channel: 'copy' }); } catch { /* le presse-papier peut être refusé */ }
  };
  const sendEmail = async () => {
    if (sending) return;
    setSending(true); setErr(null);
    const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'crm-founder-offer-email', inviteId: x.id } });
    let body = data as { error?: string; code?: string; email?: string } | null;
    const ctx = (error as { context?: Response } | null)?.context;
    if (ctx && typeof ctx.json === 'function') { try { body = await ctx.clone().json(); } catch { /* corps illisible */ } }
    setSending(false);
    if (error || body?.error) { setErr(errText(t, { message: body?.code ?? body?.error ?? '' })); return; }
    toast(t('adm.crm.fo.emailSent', { email: body?.email ?? x.email ?? '' }));
    void qc.invalidateQueries({ queryKey: ['crm-admin'] });
    onClose();
  };
  const saveEmail = () => {
    update.mutate({ p_id: x.id, p_patch: { email } }, { onError: (e) => setErr(errText(t, e)) });
  };
  const box = { borderRadius: 20, background: 'var(--sand-50)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 } as const;
  const ink = { height: 44, padding: '0 18px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontWeight: 600, fontSize: 14.5, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', textDecoration: 'none', alignSelf: 'flex-start' } as const;
  return (
    <Modal open onClose={onClose} width={620} label={t('adm.crm.fo.shareT', { name: x.org_name })}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '86vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('adm.crm.fo.shareT', { name: x.org_name })}</h2>
          <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t('adm.crm.fo.shareSub')}</p>
        </div>

        <div style={box}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><Icon name="mail" size={17} stroke={2.2} />{t('adm.crm.fo.byEmail')}</span>
          <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('adm.crm.fo.byEmailSub')}</span>
          {x.email ? (
            <Hv as="button" type="button" onClick={() => void sendEmail()} disabled={sending} style={{ ...ink, opacity: sending ? 0.6 : 1 }} hover={{ background: 'var(--sand-700)' }}>
              {sending ? <span style={{ width: 15, height: 15, borderRadius: 99, border: '2.2px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'yc-spin 700ms linear infinite' }} /> : <Icon name="send" size={15} stroke={2.4} />}
              {t(x.emailed_at ? 'adm.crm.fo.resendTo' : 'adm.crm.fo.sendTo', { email: x.email })}
            </Hv>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(null); }} placeholder={t('adm.crm.fo.addEmail')} style={{ ...inputCss, flex: '1 1 240px', width: 'auto' }} />
              <Hv as="button" type="button" onClick={saveEmail} disabled={!email.trim() || update.isPending} style={{ ...ink, opacity: email.trim() ? 1 : 0.45 }} hover={{ background: 'var(--sand-700)' }}>{t('adm.crm.fo.saveEmail')}</Hv>
            </div>
          )}
        </div>

        <div style={box}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><Icon name="whatsapp" size={17} stroke={2.2} />{t('adm.crm.fo.byWa')}</span>
          <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('adm.crm.fo.byWaSub')}</span>
          <Hv as="a" href={whatsAppUrl(x.phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => mark.mutate({ p_id: x.id, p_channel: 'whatsapp' })}
            style={{ ...ink, background: '#1f8f4e' }} hover={{ filter: 'brightness(1.08)', textDecoration: 'none', color: '#fff' }}>
            <Icon name="whatsapp" size={16} stroke={2.2} />{x.phone ? t('adm.crm.fo.openWaTo', { phone: x.phone }) : t('adm.crm.fo.openWa')}
          </Hv>
          <span style={{ ...mono, marginTop: 4 }}>{t('adm.crm.fo.message')}</span>
          <pre style={{ margin: 0, padding: 14, borderRadius: 14, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--sand-700)' }}>{text}</pre>
          <Hv as="button" type="button" onClick={() => void copy(text)} style={{ height: 38, padding: '0 14px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', alignSelf: 'flex-start' }} hover={{ background: 'var(--sand-50)' }}>
            <Icon name="copy" size={14} stroke={2.4} />{t('adm.crm.fo.copyMsg')}
          </Hv>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={mono}>{t('adm.crm.fo.link')}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input readOnly value={x.url} onFocus={(e) => e.currentTarget.select()} style={{ ...inputCss, flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--sand-600)' }} />
            <Hv as="button" type="button" onClick={() => void copy(x.url)} style={{ height: 46, padding: '0 16px', borderRadius: 14, border: '1.5px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 'none' }} hover={{ background: 'var(--sand-50)' }}>
              <Icon name="copy" size={14} stroke={2.4} />{t('adm.crm.fo.copyLink')}
            </Hv>
          </div>
        </div>
        {err && <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{err}</span>}
      </div>
    </Modal>
  );
}

function RevokeDialog({ x, onClose }: { x: FounderInvite; onClose: () => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const revoke = useAdminGesture<{ p_id: string; p_reason: string }>('crm_admin_offer_invite_revoke');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const ok = reason.trim().length >= 3 && !revoke.isPending;
  return (
    <Modal open onClose={onClose} width={480} label={t('adm.crm.fo.revokeT', { name: x.org_name })}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('adm.crm.fo.revokeT', { name: x.org_name })}</h2>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t('adm.crm.fo.revokeB')}</p>
        <label style={lbl}>{t('adm.crm.ac.reason')}<textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} rows={3} maxLength={300} style={{ ...inputCss, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
        {err && <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{err}</span>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
          <Hv as="button" type="button" disabled={!ok}
            onClick={() => revoke.mutate({ p_id: x.id, p_reason: reason }, { onSuccess: () => { toast(t('adm.crm.fo.revoked')); onClose(); }, onError: (e) => setErr(errText(t, e)) })}
            style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--red-600)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.45 }}>{t('adm.crm.fo.revoke')}</Hv>
        </div>
      </div>
    </Modal>
  );
}
