/**
 * Inviter sur Yuno CRM, offre d'essai ou offre fondateurs : le formulaire de
 * l'ex-Admin CRM réécrit avec le kit. Même RPC (crm_admin_invite_create, puis
 * crm_admin_demo_link_create quand un accès démo est demandé), même
 * pré-profil, même proposition d'accès assisté. Les places de l'offre
 * fondateurs se lisent dans crm_admin_invites (seats).
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { inviteErr, useAdminInvites, type CrmInvite, type InvitesData } from '@/crm/admin/inviteData';
import type { InviteLang } from '@/crm/lib/crmInvites';
import { fmtNum } from '@/lib/adminFormat';
import { Badge, Card, Section, useAdminT } from '@/admin/ui';
import { Field } from '../gestures';
import { Check, Phone, Seg } from '../demo/fields';
import { PROS_QK } from '../data';

type Kind = 'club' | 'organizer';
interface Draft { org: string; contact: string; email: string; phone: string; city: string; lang: InviteLang; support: boolean; demo: boolean; note: string }
const EMPTY: Draft = { org: '', contact: '', email: '', phone: '', city: '', lang: 'fr', support: true, demo: false, note: '' };

export function CrmInviteForm({ kind, founder, onCreated }: { kind: Kind; founder: boolean; onCreated: (id: string) => void }) {
  const { t, lang } = useAdminT();
  const q = useAdminInvites();
  const qc = useQueryClient();
  const [f, setF] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  const full = founder && (d?.seats.left ?? 0) <= 0;
  const ok = !!f.org.trim() && !busy && !!d && !full;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setF((s) => ({ ...s, [k]: v })); setErr(null); };

  const submit = async () => {
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const inv = await rpc<CrmInvite>('crm_admin_invite_create', { p: {
        offer: founder ? 'founder' : 'standard', kind, org_name: f.org.trim(), contact_name: f.contact.trim() || null,
        email: f.email.trim() || null, phone: f.phone || null, city: f.city.trim() || null, lang: f.lang,
        note: f.note.trim() || null, support_offer: f.support,
      } });
      if (f.demo) {
        try { await rpc('crm_admin_demo_link_create', { p: { invite_id: inv.id } }); } catch { toast.error(t('adm.pros.ci.demoFailed')); }
      }
      toast.success(t('adm.pros.ci.created', { name: inv.org_name }));
      setF({ ...EMPTY, lang: f.lang });
      await Promise.all([qc.invalidateQueries({ queryKey: ['crm-admin'] }), qc.invalidateQueries({ queryKey: [PROS_QK] })]);
      onCreated(inv.id);
    } catch (e) {
      setErr(inviteErr(t, e instanceof Error ? e.message : ''));
    } finally { setBusy(false); }
  };

  return (
    <Section title={t(founder ? 'adm.pros.inv.founderTitle' : 'adm.pros.inv.crmTitle')} description={founder ? <Seats d={d} /> : d ? t('adm.pros.ci.standardSub', { days: d.trial.days, yunits: fmtNum(d.trial.yunits, lang), price: fmtNum(d.price_month, lang) }) : t('adm.pros.inv.crmSub')}>
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t(kind === 'club' ? 'adm.pros.ci.orgClub' : 'adm.pros.ci.orgOrg')}><input className="a-input" value={f.org} maxLength={120} onChange={(e) => set('org', e.target.value)} /></Field>
          <Field label={t('adm.pros.ci.contact')}><input className="a-input" value={f.contact} maxLength={120} autoComplete="off" onChange={(e) => set('contact', e.target.value)} /></Field>
          <Field label={t('adm.pros.f.email')}><input className="a-input" type="email" value={f.email} maxLength={254} autoComplete="off" onChange={(e) => set('email', e.target.value)} /></Field>
          <div className="flex flex-col gap-1.5">
            <span className="a-t1 text-[12.5px] font-medium">{t('adm.pros.dl.f.phone')}</span>
            <Phone value={f.phone} onChange={(v) => set('phone', v)} country={f.lang === 'es' ? 'ES' : f.lang === 'fr' ? 'FR' : null} />
          </div>
          <Field label={t('adm.pros.f.city')}><input className="a-input" value={f.city} maxLength={120} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label={t('adm.pros.dl.f.lang')}>
            <Seg<InviteLang> label={t('adm.pros.dl.f.lang')} value={f.lang} onChange={(v) => set('lang', v)} options={(['fr', 'en', 'es'] as const).map((l) => ({ v: l, label: t(`adm.pros.dl.lang.${l}`) }))} />
          </Field>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <Check checked={f.support} onChange={(v) => set('support', v)} hint={t('adm.pros.ci.supportHint')}>{t('adm.pros.ci.support')}</Check>
          <Check checked={f.demo} onChange={(v) => set('demo', v)} hint={t('adm.pros.ci.demoHint')}>{t('adm.pros.ci.demo')}</Check>
          <Field label={t('adm.pros.ci.note')}><textarea className="a-input" rows={2} maxLength={500} value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
        </div>
        {err && <p role="alert" className="mt-3 text-[12.5px]" style={{ color: 'var(--a-neg)' }}>{err}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="a-btn a-btn--primary" disabled={!ok} onClick={() => void submit()}>{t(busy ? 'adm.ui.working' : 'adm.pros.ci.create')}</button>
          {full && <Badge tone="warning">{t('adm.pros.ci.full')}</Badge>}
        </div>
      </Card>
    </Section>
  );
}

/** Les places de l'offre fondateurs : prises, en attente, libres. */
function Seats({ d }: { d: InvitesData | undefined }) {
  const { t, lang } = useAdminT();
  if (!d) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{t('adm.pros.ci.founderSub', { months: d.config.free_months, yunits: fmtNum(d.config.yunits, lang), price: fmtNum(d.price_month, lang) })}</span>
      <span className="inline-flex items-center gap-1" aria-hidden>
        {Array.from({ length: d.seats.total }, (_, i) => {
          const s = i < d.seats.claimed ? 'claimed' : i < d.seats.claimed + d.seats.pending ? 'pending' : 'free';
          return <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: s === 'claimed' ? 'var(--a-accent)' : 'transparent', border: `1.5px solid ${s === 'free' ? 'var(--a-border-strong)' : 'var(--a-accent)'}` }} />;
        })}
      </span>
      <span className="a-t2">{t('adm.pros.ci.seats', { claimed: d.seats.claimed, pending: d.seats.pending, left: d.seats.left })}</span>
    </span>
  );
}
