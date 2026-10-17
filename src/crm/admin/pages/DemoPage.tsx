/**
 * Admin CRM › Démo : ouvrir le compte démo de Yuno CRM (crm@womber.fr) à un
 * prospect (migration 20261019420000). Un accès = un lien d'aperçu ordinaire
 * (demo_preview_links, lecture seule imposée par le serveur) + un mot de passe,
 * ouvert sur https://crm.yunoapp.eu/crm/preview. On l'envoie par e-mail ou
 * WhatsApp, on voit quand il est ouvert, on le coupe. Lié à une invitation,
 * le bouton « Créer mon compte » de la démo mène au lien de l'invitation.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { crmDemoWhatsAppText, crmLang, demoIsLive, initialsOf, whatsAppUrl, type InviteLang } from '@/crm/lib/crmInvites';
import type { DemoStatus } from '@/crm/lib/crmInvites';
import { Modal, Segmented, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { useAdminGesture } from '../data';
import { invokeAdminAction, inviteErr, useAdminDemoLinks, type DemoAccess, type DemoData } from '../inviteData';
import { Avatar, Chip, EmptyNote, PageHead, RowLine, Section, pageWrap, twoCols, useAgo } from '../ui';
import { CopyField, ErrorLine, Opt, Pill, Spinner, box, btn, btnInk, ctaBig, h2, inputCss, lbl, mono } from '../forms';
import type { PillTone } from '../forms';

const codeOf = (e: unknown) => (e as { message?: string } | null)?.message ?? '';
const TONE: Record<DemoStatus, PillTone> = { ready: 'sand', opened: 'green', revoked: 'red', expired: 'faded', locked: 'amber' };
const DAYS = ['7', '14', '30', '60'] as const;
type Filter = 'live' | 'all';

export default function DemoPage() {
  const { t } = useCrmT();
  const q = useAdminDemoLinks();
  const [sp, setSp] = useSearchParams();
  const [share, setShare] = useState<string | null>(null);
  const [cut, setCut] = useState<DemoAccess | null>(null);
  const filter: Filter = sp.get('f') === 'all' ? 'all' : 'live';
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  const d = q.data;
  const shared = d?.links.find((x) => x.id === share) ?? null;
  const rows = (d?.links ?? []).filter((x) => filter === 'all' || demoIsLive(x.status));
  return (
    <main style={pageWrap}>
      <PageHead kicker={t('adm.crm.dm.kicker')} title={t('adm.crm.dm.title')} sub={t('adm.crm.dm.sub')} />
      {!d ? <Skel h={420} r={28} /> : (
        <div style={twoCols}>
          <NewDemo d={d} onCreated={setShare} initialInvite={sp.get('invite')} />
          <Section title={t('adm.crm.dm.list')} sub={t('adm.crm.dm.listSub')} pad={24} gap={8}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <Chip on={filter === 'live'} onClick={() => setSp({}, { replace: true })} n={d.links.filter((x) => demoIsLive(x.status)).length}>{t('adm.crm.dm.f_live')}</Chip>
              <Chip on={filter === 'all'} onClick={() => setSp({ f: 'all' }, { replace: true })} n={d.links.length}>{t('adm.crm.dm.f_all')}</Chip>
            </div>
            {rows.length === 0 && <EmptyNote>{t('adm.crm.dm.none')}</EmptyNote>}
            {rows.map((x, i) => <DemoRow key={x.id} x={x} first={i === 0} onShare={() => setShare(x.id)} onCut={() => setCut(x)} />)}
          </Section>
        </div>
      )}
      {shared && <ShareDemo x={shared} onClose={() => setShare(null)} />}
      {cut && <CutDialog x={cut} onClose={() => setCut(null)} />}
    </main>
  );
}

function NewDemo({ d, onCreated, initialInvite }: { d: DemoData; onCreated: (id: string) => void; initialInvite: string | null }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const create = useAdminGesture<{ p: Record<string, unknown> }>('crm_admin_demo_link_create');
  const first = d.invites.find((i) => i.id === initialInvite) ?? null;
  const [f, setF] = useState(() => ({
    invite: first?.id ?? '', label: first?.org_name ?? '', contact: first?.contact_name ?? '', email: first?.email ?? '',
    phone: first?.phone ?? '', lang: (first?.lang ?? 'fr') as InviteLang, days: '30' as (typeof DAYS)[number], password: '',
  }));
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setErr(null); };
  const pickInvite = (id: string) => {
    const i = d.invites.find((x) => x.id === id);
    setF((s) => ({ ...s, invite: id, label: i?.org_name ?? s.label, contact: i?.contact_name ?? s.contact, email: i?.email ?? s.email, phone: i?.phone ?? s.phone, lang: i?.lang ?? s.lang }));
    setErr(null);
  };
  const ok = f.label.trim().length > 0 && (!f.password || f.password.trim().length >= 4) && !create.isPending;
  const submit = () => {
    if (!ok) return;
    create.mutate({ p: {
      label: f.label.trim(), contact_name: f.contact.trim() || null, email: f.email.trim() || null, phone: f.phone || null,
      lang: f.lang, days: Number(f.days), invite_id: f.invite || null, password: f.password.trim() || null,
    } }, {
      onSuccess: (r) => {
        const x = r as DemoAccess;
        toast(t('adm.crm.dm.created', { name: x.label }));
        setF((s) => ({ ...s, invite: '', label: '', contact: '', email: '', phone: '', password: '' }));
        onCreated(x.id);
      },
      onError: (e) => setErr(inviteErr(t, codeOf(e))),
    });
  };
  return (
    <Section title={t('adm.crm.dm.new')} sub={t('adm.crm.dm.newSub')} pad={24} gap={14}>
      {d.invites.length > 0 && (
        <label style={lbl}><span>{t('adm.crm.dm.f.invite')} <Opt /></span>
          <select value={f.invite} onChange={(e) => pickInvite(e.target.value)} style={{ ...inputCss, appearance: 'auto' }}>
            <option value="">{t('adm.crm.dm.f.noInvite')}</option>
            {d.invites.map((i) => <option key={i.id} value={i.id}>{i.org_name}{i.contact_name ? ` · ${i.contact_name}` : ''}{i.offer === 'founder' ? ` · ${t('adm.crm.iv.offer.founder')}` : ''}</option>)}
          </select>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--sand-500)' }}>{t('adm.crm.dm.f.inviteHint')}</span>
        </label>
      )}
      <label style={lbl}>{t('adm.crm.dm.f.label')}<input value={f.label} onChange={(e) => set('label', e.target.value)} maxLength={120} placeholder="3AM" style={inputCss} />
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--sand-500)' }}>{t('adm.crm.dm.f.labelHint')}</span>
      </label>
      <label style={lbl}><span>{t('adm.crm.iv.f.contact')} <Opt /></span><input value={f.contact} onChange={(e) => set('contact', e.target.value)} maxLength={120} autoComplete="off" placeholder={t('adm.crm.iv.f.contactPh')} style={inputCss} /></label>
      <label style={lbl}><span>{t('adm.crm.fo.f.email')} <Opt /></span><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} maxLength={254} autoComplete="off" style={inputCss} /></label>
      <div style={lbl}><span>{t('adm.crm.fo.f.phone')} <Opt /></span>
        <PhoneInputWithCountry tone="light" value={f.phone} onChange={(v) => set('phone', v)} defaultCountry={f.lang === 'es' ? 'ES' : f.lang === 'fr' ? 'FR' : null} inputStyle={{ height: 46, borderRadius: 14, fontSize: 15 }} triggerStyle={{ height: 46, borderRadius: 14 }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <div style={lbl}>{t('adm.crm.fo.f.lang')}
          <Segmented<InviteLang> value={f.lang} onChange={(v) => set('lang', v)} options={(['fr', 'en', 'es'] as const).map((l) => ({ value: l, label: t(`adm.crm.fo.lang.${l}`) }))} />
        </div>
        <div style={lbl}>{t('adm.crm.dm.f.days')}
          <Segmented<(typeof DAYS)[number]> value={f.days} onChange={(v) => set('days', v)} options={DAYS.map((v) => ({ value: v, label: t('adm.crm.dm.daysN', { n: v }) }))} />
        </div>
      </div>
      <label style={lbl}><span>{t('adm.crm.dm.f.password')} <Opt /></span><input value={f.password} onChange={(e) => set('password', e.target.value)} maxLength={64} autoComplete="off" placeholder={t('adm.crm.dm.f.passwordPh')} style={inputCss} /></label>
      {err && <ErrorLine>{err}</ErrorLine>}
      <div>
        <Hv as="button" type="button" onClick={submit} disabled={!ok} style={{ ...ctaBig, cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.45 }} hover={ok ? { filter: 'brightness(1.05)' } : undefined}>
          {create.isPending ? <Spinner /> : <Icon name="eye" size={17} stroke={2.4} />}{t('adm.crm.dm.create')}
        </Hv>
      </div>
    </Section>
  );
}

function DemoRow({ x, first, onShare, onCut }: { x: DemoAccess; first: boolean; onShare: () => void; onCut: () => void }) {
  const { t, dShort } = useCrmT();
  const ago = useAgo();
  const live = demoIsLive(x.status);
  const meta: string[] = [t('adm.crm.fo.m.created', { ago: ago(x.created_at) })];
  if (x.emailed_at) meta.push(t('adm.crm.fo.m.emailed', { ago: ago(x.emailed_at) }));
  if (x.shared_at) meta.push(t('adm.crm.fo.m.shared', { ago: ago(x.shared_at) }));
  if (x.used_count > 0) meta.push(t(x.used_count === 1 ? 'adm.crm.dm.m.openedOne' : 'adm.crm.dm.m.opened', { n: x.used_count, ago: ago(x.last_used_at) }));
  if (live && x.expires_at) meta.push(t('adm.crm.fo.m.expires', { date: dShort(x.expires_at) }));
  const who = [x.contact_name, x.email, x.phone].filter(Boolean).join(' · ');
  return (
    <RowLine first={first}>
      <Avatar text={initialsOf(x.label)} size={38} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 2 }}>{x.label}</b>
          <Pill tone={TONE[x.status]}>{t(`adm.crm.dm.st.${x.status}`)}</Pill>
          {x.invite && <Pill tone={x.invite.offer === 'founder' ? 'brand' : 'faded'} icon="send">{t('adm.crm.dm.linked', { name: x.invite.org_name })}</Pill>}
          {!x.managed && <Pill tone="faded">{t('adm.crm.dm.fromSuite')}</Pill>}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--sand-500)', lineHeight: 1.45 }}>{who}{who ? <br /> : null}{meta.join(' · ')}</span>
      </span>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {live && x.managed && <Hv as="button" type="button" onClick={onShare} style={btnInk} hover={{ background: 'var(--sand-700)' }}><Icon name="send" size={14} stroke={2.4} />{t('adm.crm.fo.send')}</Hv>}
        {live && <Hv as="button" type="button" onClick={onCut} style={btn} hover={{ background: 'var(--red-50)', color: 'var(--red-700)' }}>{t('adm.crm.dm.cut')}</Hv>}
      </span>
    </RowLine>
  );
}

function ShareDemo({ x, onClose }: { x: DemoAccess; onClose: () => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const mark = useAdminGesture<{ p_id: string; p_channel: 'whatsapp' | 'copy' }>('crm_admin_demo_link_mark');
  const update = useAdminGesture<{ p_id: string; p_patch: Record<string, unknown> }>('crm_admin_demo_link_update');
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const lang = crmLang(x.lang);
  const text = crmDemoWhatsAppText({ lang, contactName: x.contact_name, url: x.url, password: x.password ?? '', expiresAt: x.expires_at ?? new Date().toISOString() });
  const copyMsg = async () => {
    try { await navigator.clipboard.writeText(text); toast(t('adm.crm.fo.copied')); mark.mutate({ p_id: x.id, p_channel: 'copy' }); } catch { /* le presse-papier peut être refusé */ }
  };
  const sendEmail = async () => {
    if (sending) return;
    setSending(true); setErr(null);
    const r = await invokeAdminAction<{ email?: string }>('crm-demo-email', { linkId: x.id });
    setSending(false);
    if (!r.ok) { setErr(inviteErr(t, r.code)); return; }
    toast(t('adm.crm.fo.emailSent', { email: r.data.email ?? x.email ?? '' }));
    void qc.invalidateQueries({ queryKey: ['crm-admin'] });
    onClose();
  };
  return (
    <Modal open onClose={onClose} width={620} label={t('adm.crm.dm.shareT', { name: x.label })}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={h2}>{t('adm.crm.dm.shareT', { name: x.label })}</h2>
          <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t('adm.crm.dm.shareSub')}</p>
        </div>
        <CopyField label={t('adm.crm.dm.link')} value={x.url} onCopied={() => mark.mutate({ p_id: x.id, p_channel: 'copy' })} />
        {x.password && <CopyField label={t('adm.crm.dm.password')} value={x.password} />}

        <div style={box}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><Icon name="mail" size={17} stroke={2.2} />{t('adm.crm.fo.byEmail')}</span>
          <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('adm.crm.dm.byEmailSub')}</span>
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
          <Hv as="a" href={whatsAppUrl(x.phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => mark.mutate({ p_id: x.id, p_channel: 'whatsapp' })}
            style={{ ...btnInk, height: 44, padding: '0 18px', fontSize: 14.5, alignSelf: 'flex-start', background: '#1f8f4e' }} hover={{ filter: 'brightness(1.08)', textDecoration: 'none', color: '#fff' }}>
            <Icon name="whatsapp" size={16} stroke={2.2} />{x.phone ? t('adm.crm.fo.openWaTo', { phone: x.phone }) : t('adm.crm.fo.openWa')}
          </Hv>
          <span style={{ ...mono, marginTop: 4 }}>{t('adm.crm.fo.message')}</span>
          <pre style={{ margin: 0, padding: 14, borderRadius: 14, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--sand-700)', maxHeight: 200, overflowY: 'auto' }}>{text}</pre>
          <Hv as="button" type="button" onClick={() => void copyMsg()} style={{ ...btn, alignSelf: 'flex-start' }} hover={{ background: 'var(--sand-50)' }}>
            <Icon name="copy" size={14} stroke={2.4} />{t('adm.crm.fo.copyMsg')}
          </Hv>
        </div>
        <p style={{ margin: 0, padding: '12px 14px', borderRadius: 14, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 13, lineHeight: 1.5 }}>{t('adm.crm.dm.selfWarn')}</p>
        {err && <ErrorLine>{err}</ErrorLine>}
      </div>
    </Modal>
  );
}

function CutDialog({ x, onClose }: { x: DemoAccess; onClose: () => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const cut = useAdminGesture<{ p_id: string }>('crm_admin_demo_link_revoke');
  return (
    <Modal open onClose={onClose} width={460} label={t('adm.crm.dm.cutT', { name: x.label })}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ ...h2, fontSize: 22 }}>{t('adm.crm.dm.cutT', { name: x.label })}</h2>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t('adm.crm.dm.cutB')}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
          <Hv as="button" type="button" disabled={cut.isPending}
            onClick={() => cut.mutate({ p_id: x.id }, { onSuccess: () => { toast(t('adm.crm.dm.cutDone')); onClose(); }, onError: () => toast(t('adm.crm.iv.err.x')) })}
            style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--red-600)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>{t('adm.crm.dm.cut')}</Hv>
        </div>
      </div>
    </Modal>
  );
}
