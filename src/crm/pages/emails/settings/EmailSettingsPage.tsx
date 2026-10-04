/**
 * E-mails › Réglages d'envoi (`/crm/emails/settings`) — « comment vos e-mails
 * partent-ils ? ». Expéditeur (nom affiché, adresse fixée par Yuno, réponse),
 * domaine vérifié (celui de Yuno ; « votre propre domaine » en Bientôt), pied
 * de page (adresse postale, rendue comme à l'envoi), valeurs par défaut des
 * campagnes (heures calmes 23 h → 9 h, vagues, accusé de fin), adresses de
 * test. Une barre « Modifications non enregistrées » porte Annuler /
 * Enregistrer (`crm_email_settings_set`).
 */
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope, useCrmCaps } from '@/crm/scope';
import { useEmailCampaigns, useEmailSettings, useSaveEmailSettings, type EmailSettings } from '@/crm/data/emails';
import { useFeatureWaitlist } from '@/crm/data/soon';
import { MARKETING_DOMAIN } from '@/crm/lib/emails';
import { EmailsShell } from '../EmailsShell';
import { Toggle48 } from '../send/sendUi';

interface Form { sender_name: string; reply_to: string; postal_address: string; quiet_hours: boolean; waves: boolean; notify_done: boolean; test_emails: string[] }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rise = (d: number): CSSProperties => ({ animation: `yc-rise 800ms ${EASE} ${d}ms both` });
const card: CSSProperties = { display: 'flex', flexDirection: 'column', padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' };
const input: CSSProperties = { height: 46, boxSizing: 'border-box', padding: '0 16px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, color: 'var(--ink)', outline: 'none', width: '100%' };

function toForm(s: EmailSettings): Form {
  return {
    sender_name: s.sender_name ?? '', reply_to: s.reply_to ?? '', postal_address: s.postal_address ?? '',
    quiet_hours: s.quiet_hours, waves: s.waves, notify_done: s.notify_done, test_emails: s.test_emails ?? [],
  };
}

export default function EmailSettingsPage() {
  const { t } = useCrmT();
  const q = useEmailSettings();
  const list = useEmailCampaigns();
  const drafts = (list.data?.campaigns ?? []).filter((c) => c.status === 'draft').length;
  const title = (
    <>
      {t('yc.em.rg.h.a')}
      <span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('yc.em.rg.h.b')}</span>
      {t('yc.em.rg.h.c')}
    </>
  );
  return (
    <EmailsShell tab="settings" title={title} sub={t('yc.em.rg.sub')} drafts={drafts} kicker={t('yc.em.rg.kick')} hideNew>
      {q.isLoading || !q.data ? (
        q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
            {[260, 300, 240].map((h, i) => <Skel key={i} h={h} r={28} />)}
          </div>
        )
      ) : <SettingsForm settings={q.data} />}
    </EmailsShell>
  );
}

function SettingsForm({ settings }: { settings: EmailSettings }) {
  const { t } = useCrmT();
  const { space } = useCrmScope();
  const toast = useCrmToast();
  const save = useSaveEmailSettings();
  const canWrite = useCrmCaps().write;
  const [base, setBase] = useState<Form>(() => toForm(settings));
  const [f, setF] = useState<Form>(base);
  const [newTest, setNewTest] = useState('');
  useEffect(() => { const b = toForm(settings); setBase(b); setF(b); }, [settings]);
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(base), [f, base]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const replyBad = f.reply_to.trim() !== '' && !EMAIL_RE.test(f.reply_to.trim());

  const addTest = () => {
    const v = newTest.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) { toast(t('yc.em.rg.test.bad')); return; }
    if (f.test_emails.includes(v)) { toast(t('yc.em.rg.test.dup')); return; }
    if (f.test_emails.length >= 5) { toast(t('yc.em.rg.test.max')); return; }
    set('test_emails', [...f.test_emails, v]);
    setNewTest('');
  };

  const onSave = async () => {
    if (replyBad || save.isPending) return;
    try {
      await save.mutateAsync({
        sender_name: f.sender_name, reply_to: f.reply_to, postal_address: f.postal_address,
        quiet_hours: f.quiet_hours, waves: f.waves, notify_done: f.notify_done, test_emails: f.test_emails,
      });
      toast(t('yc.em.rg.saved'));
    } catch {
      toast(t('yc.em.rg.err'));
    }
  };

  const shownName = f.sender_name.trim() || settings.defaults.sender_name || space.name;

  return (
    <>
      {/* Un lecteur lit les réglages : le fieldset désactive tous les champs d'un coup. */}
      <fieldset disabled={!canWrite} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900, paddingBottom: dirty ? 80 : 0 }}>
        {!canWrite && <div style={{ padding: '12px 16px', borderRadius: 16, background: 'var(--sand-50)', color: 'var(--sand-600)', fontSize: 14, lineHeight: 1.45 }}>{t('yc.common.readOnly')}</div>}
        <Sender f={f} set={set} shownName={shownName} from={`${settings.from_local}@${MARKETING_DOMAIN}`} defaults={settings.defaults} replyBad={replyBad} />
        <Domain />
        <Footer f={f} set={set} defaults={settings.defaults} />
        <When f={f} set={set} />
        <section style={{ ...card, gap: 16, ...rise(620) }}>
          <Head title={t('yc.em.rg.test.t')} sub={t('yc.em.rg.test.s')} />
          {f.test_emails.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {f.test_emails.map((a) => (
                <span key={a} style={{ height: 38, padding: '0 6px 0 16px', borderRadius: 99, background: 'var(--sand-100)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 }}>
                  {a}
                  <Hv as="button" type="button" onClick={() => set('test_emails', f.test_emails.filter((x) => x !== a))} aria-label={t('yc.em.rg.test.rm', { a })} style={{ width: 26, height: 26, border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)', color: 'var(--ink)' }}>
                    <Icon name="x" size={13} stroke={2.6} />
                  </Hv>
                </span>
              ))}
            </div>
          ) : <div style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.em.rg.test.none')}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input
              value={newTest}
              onChange={(e) => setNewTest(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTest(); } }}
              placeholder={t('yc.em.rg.test.ph')}
              aria-label={t('yc.em.rg.test.label')}
              type="email"
              className="yc-field"
              style={{ ...input, flex: '1 1 240px', maxWidth: 340, width: 'auto', height: 44, borderRadius: 99, fontSize: 14.5 }}
            />
            <Hv as="button" type="button" onClick={addTest} disabled={f.test_emails.length >= 5} style={{ height: 44, padding: '0 20px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', opacity: f.test_emails.length >= 5 ? 0.45 : 1 }} hover={{ background: 'var(--sand-700)' }}>
              {t('yc.em.rg.test.add')}
            </Hv>
          </div>
        </section>
      </div>
      </fieldset>
      {dirty && canWrite && (
        <div role="region" aria-label={t('yc.em.rg.dirty')} style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 8px 8px 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', boxShadow: 'var(--shadow-md)', maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box', animation: `yc-toast-in 260ms ${EASE} both` }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('yc.em.rg.dirty')}</span>
          <Hv as="button" type="button" onClick={() => setF(base)} style={{ flex: 'none', height: 38, padding: '0 16px', border: 0, borderRadius: 99, background: 'rgba(255,255,255,.12)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'rgba(255,255,255,.22)' }}>
            {t('yc.em.rg.reset')}
          </Hv>
          <Hv as="button" type="button" onClick={onSave} disabled={replyBad || save.isPending} style={{ flex: 'none', height: 38, padding: '0 20px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: replyBad ? 'not-allowed' : 'pointer', opacity: replyBad || save.isPending ? 0.6 : 1 }} hover={{ filter: 'brightness(1.08)' }}>
            {t('yc.em.rg.save')}
          </Hv>
        </div>
      )}
    </>
  );
}

function Head({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{title}</h2>
        <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, maxWidth: 560, textWrap: 'pretty' }}>{sub}</div>
      </div>
      {right}
    </div>
  );
}

function Field({ label, help, children, error }: { label: string; help: string; children: ReactNode; error?: string | null }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      {children}
      <span style={{ fontSize: 12.5, color: error ? 'var(--red-600)' : 'var(--sand-500)' }}>{error || help}</span>
    </label>
  );
}

type Setter = <K extends keyof Form>(k: K, v: Form[K]) => void;

function Sender({ f, set, shownName, from, defaults, replyBad }: { f: Form; set: Setter; shownName: string; from: string; defaults: EmailSettings['defaults']; replyBad: boolean }) {
  const { t } = useCrmT();
  const { space } = useCrmScope();
  return (
    <section style={{ ...card, gap: 20, ...rise(380) }}>
      <Head title={t('yc.em.rg.who.t')} sub={t('yc.em.rg.who.s')} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 18, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
        {space.logoUrl
          ? <img src={space.logoUrl} alt="" style={{ width: 44, height: 44, borderRadius: 12, flex: 'none', objectFit: 'cover' }} />
          : <span style={{ width: 44, height: 44, borderRadius: 12, flex: 'none', background: 'var(--gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18 }}>{shownName.charAt(0).toUpperCase()}</span>}
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <b style={{ fontSize: 15.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shownName}</b>
          <span style={{ fontSize: 13.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{from} · {t('yc.em.rg.who.subject')}</span>
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--sand-400)' }}>{t('yc.em.rg.who.preview')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 16 }}>
        <Field label={t('yc.em.rg.who.name')} help={t('yc.em.rg.who.nameD')}>
          <input value={f.sender_name} onChange={(e) => set('sender_name', e.target.value)} placeholder={defaults.sender_name ?? space.name} maxLength={80} className="yc-field" style={input} />
        </Field>
        <Field label={t('yc.em.rg.who.from')} help={t('yc.em.rg.who.fromD')}>
          <span style={{ ...input, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sand-50)', color: 'var(--sand-700)', overflow: 'hidden' }}>
            <Icon name="lock" size={15} stroke={2.2} style={{ color: 'var(--sand-400)' }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{from}</span>
          </span>
        </Field>
        <Field label={t('yc.em.rg.who.reply')} help={t('yc.em.rg.who.replyD')} error={replyBad ? t('yc.em.rg.who.replyBad') : null}>
          <input value={f.reply_to} onChange={(e) => set('reply_to', e.target.value)} placeholder={defaults.reply_to ?? ''} type="email" className="yc-field" style={{ ...input, borderColor: replyBad ? 'var(--red-400)' : 'var(--sand-200)' }} />
        </Field>
      </div>
    </section>
  );
}

function Domain() {
  const { t } = useCrmT();
  const wl = useFeatureWaitlist();
  const on = wl.features.includes('brand_domain');
  const rows: { k: 'spf' | 'dkim' | 'dmarc'; type: string; host: string }[] = [
    { k: 'spf', type: 'TXT', host: `send.${MARKETING_DOMAIN}` },
    { k: 'dkim', type: 'TXT', host: `resend._domainkey.${MARKETING_DOMAIN.split('.')[0]}` },
    { k: 'dmarc', type: 'TXT', host: '_dmarc.yunoapp.eu' },
  ];
  return (
    <section style={{ ...card, gap: 18, ...rise(440) }}>
      <Head title={t('yc.em.rg.dom.t')} sub={t('yc.em.rg.dom.s')} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => (
          <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderRadius: 18, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', flexWrap: 'wrap' }}>
            <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: 'var(--green-500)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="check" size={17} stroke={3} /></span>
            <span style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <b style={{ fontSize: 15.5 }}>{r.k.toUpperCase()}</b>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t(`yc.em.rg.dom.${r.k}`)}</span>
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em', color: 'var(--sand-500)', textTransform: 'uppercase' }}>{r.type} · {r.host}</span>
            <span style={{ height: 24, padding: '0 10px', borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t('yc.em.rg.dom.ok')}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '16px 18px', borderRadius: 18, background: 'var(--sand-50)' }}>
        <span style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <b style={{ fontSize: 15 }}>{t('yc.em.rg.dom.ownT')}</b>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.em.rg.dom.ownS')}</span>
        </span>
        <Hv
          as="button"
          type="button"
          disabled={!wl.loaded || wl.pending}
          onClick={() => { void wl.set({ feature: 'brand_domain', on: !on }); }}
          aria-pressed={on}
          style={{ flex: 'none', height: 40, padding: '0 16px', borderRadius: 99, border: on ? 0 : '1px solid var(--sand-200)', background: on ? 'var(--green-50)' : '#fff', color: on ? 'var(--green-700)' : 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          hover={{ borderColor: 'var(--sand-300)' }}
        >
          {on && <Icon name="check" size={15} stroke={2.6} />}
          {t(on ? 'yc.em.rg.dom.notified' : 'yc.em.rg.dom.notify')}
        </Hv>
      </div>
    </section>
  );
}

function Footer({ f, set, defaults }: { f: Form; set: Setter; defaults: EmailSettings['defaults'] }) {
  const { t } = useCrmT();
  const { space } = useCrmScope();
  // Même règle que l'envoi (footerPlace) : l'adresse si elle est réglée, sinon la ville.
  const place = f.postal_address.trim() || (space.city ?? '');
  return (
    <section style={{ ...card, gap: 18, ...rise(500) }}>
      <Head title={t('yc.em.rg.foot.t')} sub={t('yc.em.rg.foot.s')} />
      <Field label={t('yc.em.rg.foot.addr')} help={t('yc.em.rg.foot.addrD')}>
        <input value={f.postal_address} onChange={(e) => set('postal_address', e.target.value)} placeholder={defaults.address ?? ''} maxLength={200} className="yc-field" style={input} />
      </Field>
      <div style={{ padding: 18, borderRadius: 16, background: 'var(--sand-50)', textAlign: 'center', fontSize: 12.5, lineHeight: 1.7, color: 'var(--sand-500)' }}>
        <b style={{ display: 'block', fontSize: 13, color: 'var(--sand-700)' }}>{space.name}{place ? ` — ${place}` : ''}</b>
        {t('yc.em.rg.foot.sent')}<br />
        {t('yc.em.rg.foot.rights', { year: new Date().getFullYear(), name: space.name })}<br />
        <span style={{ textDecoration: 'underline' }}>{t('yc.em.rg.foot.unsub')}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)' }}>
        <Icon name="check" size={18} stroke={2.4} color="var(--green-700)" style={{ marginTop: 1 }} />
        {t('yc.em.rg.foot.oneClick')}
      </div>
    </section>
  );
}

function When({ f, set }: { f: Form; set: Setter }) {
  const { t } = useCrmT();
  const rows: { k: 'quiet_hours' | 'waves' | 'notify_done'; l: string; d: string }[] = [
    { k: 'quiet_hours', l: t('yc.em.rg.quiet'), d: t('yc.em.rg.quietD') },
    { k: 'waves', l: t('yc.em.rg.waves'), d: t('yc.em.rg.wavesD') },
    { k: 'notify_done', l: t('yc.em.rg.notify'), d: t('yc.em.rg.notifyD') },
  ];
  return (
    <section style={{ ...card, gap: 18, ...rise(560) }}>
      <Head title={t('yc.em.rg.when.t')} sub={t('yc.em.rg.when.s')} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderTop: i ? '1px solid var(--sand-100)' : 'none' }}>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontSize: 15 }}>{r.l}</b>
              <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-500)', textWrap: 'pretty' }}>{r.d}</span>
            </span>
            <Toggle48 on={f[r.k]} onChange={(v) => set(r.k, v)} label={r.l} />
          </div>
        ))}
      </div>
      {f.quiet_hours && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 18, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', fontSize: 14.5, lineHeight: 1.45, animation: `yc-rise 360ms ${EASE} both` }}>
          <Icon name="moon" size={18} stroke={2.2} style={{ color: 'var(--sand-500)' }} />
          {t('yc.em.rg.quietWin')}
        </div>
      )}
    </section>
  );
}
