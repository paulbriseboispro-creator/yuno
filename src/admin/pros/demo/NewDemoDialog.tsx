/**
 * « Nouveau lien de démo » : UN dialogue, le produit d'abord, puis les champs
 * utiles. Mêmes appels qu'avant :
 *   - Yuno Tickets : create_demo_preview_link (+ admin_set_demo_link_signup
 *     quand un compte est à créer depuis la démo), lien copié ;
 *   - Yuno CRM : crm_admin_demo_link_create (contact, langue, durée, invitation
 *     liée, mot de passe tiré au sort s'il est laissé vide).
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { ALL_TARGET_ACCOUNTS, type TargetAccount } from '@/lib/demoSession';
import { inviteErr, type DemoAccess, type DemoData } from '@/crm/admin/inviteData';
import type { InviteLang } from '@/crm/lib/crmInvites';
import { Dialog, useAdminT } from '@/admin/ui';
import { Field } from '@/admin/ui';
import { previewUrl, useDemoRefresh, type ShowcaseOrg, type ShowcaseVenue } from './data';
import { AccountPicker, Phone, SignupFields } from './fields';
import { Checkbox, Segmented } from '@/admin/ui';
import { EMPTY_SIGNUP, signupPayload, type SignupDraft } from './signup';

export type DemoProduct = 'tickets' | 'crm';
const LANGS = ['fr', 'en', 'es'] as const;
const DAYS = ['7', '14', '30', '60'] as const;
/** Yuno CRM a son propre chemin (accès géré, mot de passe gardé) : il n'est pas proposé ici. */
const TICKET_ACCOUNTS = ALL_TARGET_ACCOUNTS.filter((a) => a !== 'crm');

export function NewDemoDialog({ open, onOpenChange, showcaseVenues, showcaseOrgs, crmInvites, initialProduct, initialInvite, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  showcaseVenues: ShowcaseVenue[];
  showcaseOrgs: ShowcaseOrg[];
  crmInvites: DemoData['invites'];
  initialProduct?: DemoProduct;
  initialInvite?: string | null;
  /** L'id du lien créé : la page ouvre son tiroir pour l'envoyer. */
  onCreated: (id: string) => void;
}) {
  const { t } = useAdminT();
  const refresh = useDemoRefresh();
  const first = crmInvites.find((i) => i.id === initialInvite) ?? null;
  const [product, setProduct] = useState<DemoProduct>(first ? 'crm' : initialProduct ?? 'tickets');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Yuno Tickets
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [showcase, setShowcase] = useState('');
  const [accounts, setAccounts] = useState<TargetAccount[]>(['owner']);
  const [lang, setLang] = useState<InviteLang>('en');
  const [expires, setExpires] = useState('');
  const [signup, setSignup] = useState<SignupDraft>(EMPTY_SIGNUP);

  // Yuno CRM
  const [c, setC] = useState(() => ({
    invite: first?.id ?? '', label: first?.org_name ?? '', contact: first?.contact_name ?? '', email: first?.email ?? '',
    phone: first?.phone ?? '', lang: (first?.lang ?? 'fr') as InviteLang, days: '30' as (typeof DAYS)[number], password: '',
  }));
  const setCrm = <K extends keyof typeof c>(k: K, v: (typeof c)[K]) => { setC((s) => ({ ...s, [k]: v })); setErr(null); };
  const pickInvite = (id: string) => {
    const i = crmInvites.find((x) => x.id === id);
    setC((s) => ({ ...s, invite: id, label: i?.org_name ?? s.label, contact: i?.contact_name ?? s.contact, email: i?.email ?? s.email, phone: i?.phone ?? s.phone, lang: i?.lang ?? s.lang }));
  };

  const venueId = showcase.startsWith('v:') ? showcase.slice(2) : '';
  const orgId = showcase.startsWith('o:') ? showcase.slice(2) : '';
  const withSignup = !showcase && signup.enabled;
  const okTickets = !!label.trim() && !!password && (!!showcase || accounts.length > 0);
  const okCrm = !!c.label.trim() && (!c.password || c.password.trim().length >= 4);
  const ok = !busy && (product === 'tickets' ? okTickets : okCrm);

  const reset = () => {
    setLabel(''); setPassword(''); setShowcase(''); setAccounts(['owner']); setLang('en'); setExpires(''); setSignup(EMPTY_SIGNUP);
    setC((s) => ({ ...s, invite: '', label: '', contact: '', email: '', phone: '', password: '' }));
    setErr(null);
  };

  const submitTickets = async () => {
    if (withSignup && !signup.orgName.trim()) { setErr(t('adm.demo.signup.orgRequired')); return; }
    const { data, error } = await supabase.rpc('create_demo_preview_link', {
      p_label: label.trim(), p_password: password, p_target_accounts: venueId ? ['owner'] : orgId ? ['organizer'] : accounts,
      p_language: lang, p_expires_at: expires ? new Date(expires).toISOString() : null,
      p_venue_id: venueId || null, p_organizer_user_id: orgId || null,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as { id?: string; token?: string } | null;
    if (withSignup && row?.id) {
      const { error: e } = await supabase.rpc('admin_set_demo_link_signup' as never, { p_link_id: row.id, p_data: signupPayload(signup) } as never);
      // Le lien existe déjà : un brouillon refusé se reprend depuis son tiroir.
      if (e) toast.error(t('adm.demo.signup.failed', { error: e.message }));
    }
    if (row?.token) { try { await navigator.clipboard.writeText(previewUrl(row.token)); } catch { /* presse-papier refusé */ } }
    toast.success(t('adm.pros.dl.createdCopied', { name: label.trim() }));
    return row?.id ?? null;
  };

  const submitCrm = async () => {
    const x = await rpc<DemoAccess>('crm_admin_demo_link_create', { p: {
      label: c.label.trim(), contact_name: c.contact.trim() || null, email: c.email.trim() || null, phone: c.phone || null,
      lang: c.lang, days: Number(c.days), invite_id: c.invite || null, password: c.password.trim() || null,
    } });
    toast.success(t('adm.pros.dl.created', { name: x.label }));
    return x.id;
  };

  const submit = async () => {
    if (busy) return;
    // Le Dialog du kit n'a pas de bouton désactivé : le bouton reste là, le manque se dit en une phrase.
    if (!ok) { setErr(t(product === 'tickets' ? 'adm.pros.dl.missingTickets' : 'adm.pros.dl.missingCrm')); return; }
    setBusy(true); setErr(null);
    try {
      const id = product === 'tickets' ? await submitTickets() : await submitCrm();
      if (id === undefined) return;
      await refresh();
      reset();
      onOpenChange(false);
      if (id) onCreated(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setErr(product === 'crm' ? inviteErr(t, msg) : msg || t('adm.ui.error.title'));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }} title={t('adm.pros.dl.new')} description={t('adm.pros.dl.newSub')}
      confirmLabel={t(product === 'tickets' ? 'adm.pros.dl.createCopy' : 'adm.pros.dl.create')} busy={busy} onConfirm={() => void submit()}>
      <div className="flex flex-col gap-4 pb-1">
        <Field label={t('adm.pros.dl.product')}>
          <Segmented<DemoProduct> label={t('adm.pros.dl.product')} value={product} onChange={(v) => { setProduct(v); setErr(null); }}
            options={[{ value: 'tickets', label: t('adm.pros.product.tickets') }, { value: 'crm', label: t('adm.pros.product.crm') }]} />
        </Field>

        {product === 'tickets' ? (
          <>
            <Field label={t('adm.pros.dl.f.person')} hint={t('adm.pros.dl.f.personHint')}>
              <input className="a-input" value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label={t('adm.pros.dl.f.password')} hint={t('adm.pros.dl.f.passwordHint')}>
              <input className="a-input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label={t('adm.pros.dl.f.showcase')} hint={t('adm.pros.dl.f.showcaseHint')}>
              <select className="a-input" value={showcase} onChange={(e) => setShowcase(e.target.value)}>
                <option value="">{t('adm.pros.dl.f.plain')}</option>
                {showcaseVenues.length > 0 && (
                  <optgroup label={t('adm.pros.dl.f.showcaseClubs')}>
                    {showcaseVenues.map((v) => <option key={v.id} value={`v:${v.id}`}>{v.name}</option>)}
                  </optgroup>
                )}
                {showcaseOrgs.length > 0 && (
                  <optgroup label={t('adm.pros.dl.f.showcaseOrgs')}>
                    {showcaseOrgs.map((o) => <option key={o.user_id} value={`o:${o.user_id}`}>{o.display_name}</option>)}
                  </optgroup>
                )}
              </select>
            </Field>
            {!showcase && (
              <div className="flex flex-col gap-2">
                <span className="a-t1 text-[12.5px] font-medium">{t('adm.pros.dl.f.roles', { n: accounts.length })}</span>
                <span className="a-t3 text-[12px]">{t('adm.pros.dl.f.rolesHint')}</span>
                <AccountPicker options={TICKET_ACCOUNTS} selected={accounts}
                  onToggle={(a) => setAccounts((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]))} />
              </div>
            )}
            {!showcase && (
              <div className="a-subtle flex flex-col gap-3 rounded-lg p-3">
                <Checkbox checked={signup.enabled} onChange={(v) => setSignup((d) => ({ ...d, enabled: v, firstName: d.firstName || label }))}
                  hint={t('adm.pros.dl.f.signupHint')}>{t('adm.demo.signup.enable')}</Checkbox>
                {signup.enabled && <SignupFields draft={signup} onChange={setSignup} />}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('adm.pros.dl.f.lang')}>
                <select className="a-input" value={lang} onChange={(e) => setLang(e.target.value as InviteLang)}>
                  {LANGS.map((l) => <option key={l} value={l}>{t(`adm.pros.dl.lang.${l}`)}</option>)}
                </select>
              </Field>
              <Field label={t('adm.pros.dl.f.expires')}><input className="a-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
            </div>
          </>
        ) : (
          <>
            {crmInvites.length > 0 && (
              <Field label={t('adm.pros.dl.f.invite')} hint={t('adm.pros.dl.f.inviteHint')}>
                <select className="a-input" value={c.invite} onChange={(e) => pickInvite(e.target.value)}>
                  <option value="">{t('adm.pros.dl.f.noInvite')}</option>
                  {crmInvites.map((i) => (
                    <option key={i.id} value={i.id}>{[i.org_name, i.contact_name, i.offer === 'founder' ? t('adm.pros.inv.p.founder') : null].filter(Boolean).join(' · ')}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={t('adm.pros.dl.f.label')} hint={t('adm.pros.dl.f.labelHint')}>
              <input className="a-input" value={c.label} maxLength={120} placeholder="3AM" onChange={(e) => setCrm('label', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('adm.pros.dl.f.contact')}><input className="a-input" value={c.contact} maxLength={120} autoComplete="off" onChange={(e) => setCrm('contact', e.target.value)} /></Field>
              <Field label={t('adm.pros.dl.f.email')}><input className="a-input" type="email" value={c.email} maxLength={254} autoComplete="off" onChange={(e) => setCrm('email', e.target.value)} /></Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adm.pros.dl.f.phone')}</span>
              <Phone value={c.phone} onChange={(v) => setCrm('phone', v)} country={c.lang === 'es' ? 'ES' : c.lang === 'fr' ? 'FR' : null} />
            </div>
            <div className="flex flex-wrap gap-4">
              <Field label={t('adm.pros.dl.f.lang')}>
                <Segmented<InviteLang> label={t('adm.pros.dl.f.lang')} value={c.lang} onChange={(v) => setCrm('lang', v)} options={LANGS.map((l) => ({ value: l, label: l.toUpperCase() }))} />
              </Field>
              <Field label={t('adm.pros.dl.f.days')}>
                <Segmented<(typeof DAYS)[number]> label={t('adm.pros.dl.f.days')} value={c.days} onChange={(v) => setCrm('days', v)} options={DAYS.map((d) => ({ value: d, label: t('adm.pros.dl.daysN', { n: d }) }))} />
              </Field>
            </div>
            <Field label={t('adm.pros.dl.f.passwordOpt')} hint={t('adm.pros.dl.f.passwordOptHint')}>
              <input className="a-input" value={c.password} maxLength={64} autoComplete="off" onChange={(e) => setCrm('password', e.target.value)} />
            </Field>
          </>
        )}
        {err && <p role="alert" className="text-[12.5px]" style={{ color: 'var(--a-neg)' }}>{err}</p>}
      </div>
    </Dialog>
  );
}
