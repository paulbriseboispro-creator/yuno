/**
 * Réglages › Envoi › « Écrire à vos clients » (exception clients, article L34-5
 * alinéa 2 ; plan docs/designs/CRM_CUSTOMER_BASIS_PLAN.md § 8) : ce que la base
 * gagnerait, la fenêtre à cocher que seul le TITULAIRE signe, puis l'état de la
 * base ouverte (signataire, échéance, mentions à poser chez la billetterie,
 * oppositions transmises, fermeture). Tout est décidé par la base : l'écran
 * montre `crm_customer_basis_get` et ne fait que demander.
 */
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Check, CtaButton, Modal, Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { isSupportSessionActive } from '@/lib/supportSession';
import {
  CUSTOMER_CHECKS, useCloseCustomerBasis, useCustomerBasis, useDeclareCustomerBasis, useReportCustomerObjections,
  type CustomerBasis, type CustomerCheckKey,
} from '@/crm/data/customerBasis';

const LEGAL_URL = '/legal/cgv-crm';
const YUNO_CONTACT = 'contact@yunoapp.eu';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const card: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-rise 800ms ${EASE} 560ms both` };
const field: CSSProperties = { height: 44, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, color: 'var(--ink)', outline: 'none', width: '100%' };
const ghost: CSSProperties = { height: 40, padding: '0 16px', border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer' };

export function CustomerBasisCard({ contact: rawContact }: { contact: string }) {
  const { t } = useCrmT();
  const contact = rawContact || t('yc.cb.contactPh');
  const q = useCustomerBasis();
  const [open, setOpen] = useState(false);
  if (q.isLoading) return <Skel h={220} r={28} />;
  if (!q.data) return null;   // lecture en échec : la carte se tait, le reste des réglages vit
  const b = q.data;
  return (
    <section style={card} aria-label={t('yc.cb.t')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700, letterSpacing: '-.02em' }}>{t('yc.cb.t')}</h2>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.cb.s')}</p>
      </div>
      {b.status === 'active' ? <ActiveBody b={b} contact={contact} onResign={() => setOpen(true)} />
        : b.status === 'suspended' ? <SuspendedBody b={b} onResign={() => setOpen(true)} />
          : <OffBody b={b} onOpen={() => setOpen(true)} />}
      {open && <CustomerBasisModal basis={b} contact={contact} onClose={() => setOpen(false)} />}
    </section>
  );
}

/** Ce que la base gagnerait (ou gagne) : accord, clients en plus, jamais contactés. */
function Counts({ b }: { b: CustomerBasis }) {
  const { t, n } = useCrmT();
  const x = b.counts.excluded;
  const never = [
    [x.provider_withdrawn, 'yc.cb.x.withdrawn'], [x.unsubscribe, 'yc.cb.x.unsub'],
    [x.suppressed, 'yc.cb.x.suppressed'], [x.reported, 'yc.cb.x.reported'],
  ].filter(([v]) => Number(v) > 0) as [number, string][];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', borderRadius: 18, background: 'var(--sand-50)', fontVariantNumeric: 'tabular-nums' }}>
      <Line big={n(b.counts.consent)} text={t('yc.cb.n.consent')} />
      <Line big={`+ ${n(b.counts.extra)}`} text={t('yc.cb.n.extra', { m: b.eligibility_months })} strong />
      {never.map(([v, k]) => <Line key={k} big={`− ${n(v)}`} text={t('yc.cb.n.neverX', { x: t(k) })} muted />)}
    </div>
  );
}

function Line({ big, text, strong, muted }: { big: string; text: string; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 14.5, color: muted ? 'var(--sand-500)' : 'var(--ink)' }}>
      <span style={{ minWidth: 76, textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: strong ? 700 : 600, fontSize: strong ? 20 : 16 }}>{big}</span>
      <span style={{ lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}

function OffBody({ b, onOpen }: { b: CustomerBasis; onOpen: () => void }) {
  const { t } = useCrmT();
  const blocked = isPreviewActive() || isSupportSessionActive();
  return (
    <>
      <Counts b={b} />
      {!b.can_declare ? (
        <Note>
          {t('yc.cb.beta')}{' '}
          <a href={`mailto:${YUNO_CONTACT}?subject=${encodeURIComponent(t('yc.cb.askSubject'))}`} style={{ color: 'var(--ink)', fontWeight: 600 }}>{t('yc.cb.ask')}</a>
        </Note>
      ) : !b.is_owner ? <Note>{t('yc.cb.ownerOnly')}</Note> : (
        <div style={{ display: 'flex' }}>
          <CtaButton onClick={onOpen} disabled={blocked} icon="arrowRight">{t('yc.cb.open')}</CtaButton>
        </div>
      )}
    </>
  );
}

function SuspendedBody({ b, onResign }: { b: CustomerBasis; onResign: () => void }) {
  const { t } = useCrmT();
  const resign = (b.suspended_reason === 'version' || b.suspended_reason === 'expired') && b.is_owner && b.can_declare;
  return (
    <>
      <div role="status" style={{ padding: '12px 16px', borderRadius: 16, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14.5, lineHeight: 1.5 }}>
        <b>{t('yc.cb.susp.t')}</b> — {t(`yc.cb.susp.${b.suspended_reason ?? 'admin'}`)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {resign ? <CtaButton onClick={onResign} icon="check">{t('yc.cb.resign')}</CtaButton>
          : <Hv as="a" href={`mailto:${YUNO_CONTACT}?subject=${encodeURIComponent(t('yc.cb.susp.t'))}`} style={{ ...ghost, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.cb.contact')}</Hv>}
      </div>
    </>
  );
}

function ActiveBody({ b, contact, onResign }: { b: CustomerBasis; contact: string; onResign: () => void }) {
  const { t, locale } = useCrmT();
  // Avec l'année : l'échéance tombe l'année suivante.
  const dLong = (d: Date) => d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const toast = useCrmToast();
  const close = useCloseCustomerBasis();
  const [confirm, setConfirm] = useState(false);
  const renew = !!b.needs_renewal && b.expires_at;
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 16px', borderRadius: 16, background: 'var(--green-50)', color: 'var(--green-700)', fontSize: 14.5, lineHeight: 1.5 }}>
        <b>{t('yc.cb.on.t')}</b>
        <span>{t('yc.cb.on.s', { name: b.signatory_name ?? '', role: b.signatory_role ?? '', date: b.declared_at ? dLong(new Date(b.declared_at)) : '', exp: b.expires_at ? dLong(new Date(b.expires_at)) : '' })}</span>
      </div>
      {!b.sending_ready && <Note>{t('yc.cb.notReady')}</Note>}
      {renew && b.is_owner && (
        <Note>
          {t('yc.cb.renewSoon', { exp: dLong(new Date(b.expires_at!)) })}{' '}
          <button type="button" onClick={onResign} style={{ border: 0, background: 'none', padding: 0, color: 'var(--ink)', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>{t('yc.cb.resign')}</button>
        </Note>
      )}
      <Counts b={b} />
      <Mentions contact={contact} />
      <ReportObjections />
      {b.is_owner && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          {!confirm ? (
            <Hv as="button" type="button" onClick={() => setConfirm(true)} style={ghost} hover={{ background: 'var(--sand-200)' }}>{t('yc.cb.close')}</Hv>
          ) : (
            <>
              <span style={{ flex: '1 1 260px', fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)' }}>{t('yc.cb.close.confirm')}</span>
              <Hv as="button" type="button" onClick={() => setConfirm(false)} style={ghost} hover={{ background: 'var(--sand-200)' }}>{t('yc.cb.m.later')}</Hv>
              <Hv as="button" type="button" disabled={close.isPending} onClick={() => close.mutate(undefined, { onSuccess: () => { toast(t('yc.cb.closed')); setConfirm(false); }, onError: () => toast(t('yc.cb.err')) })}
                style={{ ...ghost, background: 'var(--ink)', color: '#fff' }} hover={{ background: 'var(--sand-700)' }}>{t('yc.cb.close')}</Hv>
            </>
          )}
        </div>
      )}
    </>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div style={{ padding: '12px 16px', borderRadius: 16, background: 'var(--sand-50)', color: 'var(--sand-700)', fontSize: 14.5, lineHeight: 1.5, textWrap: 'pretty' }}>{children}</div>;
}

/** Les deux textes à poser chez la billetterie (annexe 2 des Conditions Yuno CRM). */
export function Mentions({ contact }: { contact: string }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const texts: [string, string][] = [
    [t('yc.cb.mention.eventL'), t('yc.cb.mention.event', { contact })],
    [t('yc.cb.mention.privacyL'), t('yc.cb.mention.privacy', { contact })],
  ];
  const copy = async (v: string) => {
    try { await navigator.clipboard.writeText(v); toast(t('yc.cb.copied')); } catch { toast(t('yc.cb.err')); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ fontSize: 15 }}>{t('yc.cb.mentions.t')}</b>
        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.cb.mentions.s')}</span>
      </div>
      {texts.map(([label, v]) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 14, boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{label}</span>
            <Hv as="button" type="button" onClick={() => { void copy(v); }} style={{ ...ghost, height: 32, padding: '0 12px', fontSize: 13 }} hover={{ background: 'var(--sand-200)' }}>{t('yc.cb.copy')}</Hv>
          </div>
          <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-700)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function ReportObjections() {
  const { t, tp } = useCrmT();
  const toast = useCrmToast();
  const report = useReportCustomerObjections();
  const [shown, setShown] = useState(false);
  const [text, setText] = useState('');
  const emails = [...new Set(text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => EMAIL_RE.test(x)))];
  if (!shown) {
    return <div><Hv as="button" type="button" onClick={() => setShown(true)} style={ghost} hover={{ background: 'var(--sand-200)' }}>{t('yc.cb.report.t')}</Hv></div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b style={{ fontSize: 15 }}>{t('yc.cb.report.t')}</b>
      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.cb.report.s')}</span>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('yc.cb.report.ph')} aria-label={t('yc.cb.report.t')} rows={4}
        className="yc-field" style={{ ...field, height: 'auto', padding: 12, resize: 'vertical', fontFamily: 'inherit' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <Hv as="button" type="button" disabled={report.isPending}
          onClick={() => {
            if (!emails.length) { toast(t('yc.cb.report.none')); return; }
            report.mutate(emails, { onSuccess: (r) => { toast(tp('yc.cb.report.done', r.objected)); setText(''); setShown(false); }, onError: () => toast(t('yc.cb.err')) });
          }}
          style={{ ...ghost, background: 'var(--ink)', color: '#fff' }} hover={{ background: 'var(--sand-700)' }}>{t('yc.cb.report.cta')}</Hv>
        <Hv as="button" type="button" onClick={() => { setShown(false); setText(''); }} style={ghost} hover={{ background: 'var(--sand-200)' }}>{t('yc.cb.m.later')}</Hv>
      </div>
    </div>
  );
}

/**
 * La fenêtre à cocher (plan § 8.2) : les chiffres réels, cinq engagements, le
 * signataire. Le texte EXACT affiché (dans la langue du pro) est haché et
 * enregistré avec les chiffres vus : c'est la preuve de ce qu'il a signé.
 * Jamais au chargement d'une page : elle s'ouvre sur un clic du titulaire.
 */
export function CustomerBasisModal({ basis, contact, onClose }: { basis: CustomerBasis; contact: string; onClose: () => void }) {
  const { t, n, lang } = useCrmT();
  const declare = useDeclareCustomerBasis();
  const [checks, setChecks] = useState<Record<CustomerCheckKey, boolean>>(() => Object.fromEntries(CUSTOMER_CHECKS.map((k) => [k, false])) as Record<CustomerCheckKey, boolean>);
  const [name, setName] = useState(basis.signatory_name ?? '');
  const [role, setRole] = useState(basis.signatory_role ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const all = CUSTOMER_CHECKS.every((k) => checks[k]);
  const nameOk = name.trim().length >= 2 && role.trim().length >= 2;

  const intro = t('yc.cb.m.s', { consent: n(basis.counts.consent) });
  const docText = [
    t('yc.cb.m.t'), intro,
    `${n(basis.counts.consent)} ${t('yc.cb.n.consent')} / + ${n(basis.counts.extra)} ${t('yc.cb.n.extra', { m: basis.eligibility_months })}`,
    t('yc.cb.m.engage'), ...CUSTOMER_CHECKS.map((k) => `☑ ${t(`yc.cb.m.c.${k}`)}`),
    `${t('yc.cb.m.name')} ${name.trim()} — ${t('yc.cb.m.role')} ${role.trim()}`, t('yc.cb.m.foot'), `${LEGAL_URL} · ${basis.version}`,
  ].join('\n');

  const submit = () => {
    if (!all) { setProblem(t('yc.cb.m.missChecks')); return; }
    if (!nameOk) { setProblem(t('yc.cb.m.missName')); return; }
    setProblem(null);
    declare.mutate({ version: basis.version, text: docText, name: name.trim(), role: role.trim(), lang, shown: basis.counts }, {
      onSuccess: () => setDone(true),
      onError: (e) => setProblem(String((e as Error).message).includes('customer_basis_version') ? t('yc.cb.m.errVersion') : t('yc.cb.err')),
    });
  };

  return (
    <Modal open onClose={onClose} width={600} label={t('yc.cb.m.t')}>
      <div style={{ padding: '28px 28px 24px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '86vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        {done ? (
          <>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{t('yc.cb.m.done.t')}</span>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--sand-600)' }}>{t('yc.cb.m.done.s')}</p>
            <Mentions contact={contact} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><CtaButton onClick={onClose} icon="check">{t('yc.cb.m.done.cta')}</CtaButton></div>
          </>
        ) : (
          <>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{t('yc.cb.m.t')}</span>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--sand-600)', textWrap: 'pretty' }}>{intro}</p>
            <Counts b={basis} />
            <b style={{ fontSize: 15 }}>{t('yc.cb.m.engage')}</b>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {CUSTOMER_CHECKS.map((k) => (
                // Pas de <label> : il renverrait le clic au bouton Check et la case basculerait deux fois.
                <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 14.5, lineHeight: 1.5, cursor: 'pointer' }}>
                  <span style={{ paddingTop: 2 }}><Check on={checks[k]} onChange={(v) => setChecks((c) => ({ ...c, [k]: v }))} label={t(`yc.cb.m.c.${k}`)} /></span>
                  <span onClick={() => setChecks((c) => ({ ...c, [k]: !c[k] }))}>
                    {t(`yc.cb.m.c.${k}`)}
                    {k === 'terms_read' && <> <a href={LEGAL_URL} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--ink)', fontWeight: 600 }}>{t('yc.cb.m.terms')}</a></>}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600 }}>
                {t('yc.cb.m.name')}
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" className="yc-field" style={field} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600 }}>
                {t('yc.cb.m.role')}
                <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} placeholder={t('yc.cb.m.rolePh')} className="yc-field" style={field} />
              </label>
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.cb.m.foot')}</p>
            {problem && <div role="alert" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 13.5, lineHeight: 1.45, fontWeight: 500 }}>{problem}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
              <button type="button" onClick={onClose} style={{ height: 40, padding: '0 16px', border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-600)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{t('yc.cb.m.later')}</button>
              {/* Jamais grisé pour un oubli : au clic, ce qui manque est dit. */}
              <CtaButton onClick={submit} disabled={declare.isPending} icon="check">{t('yc.cb.m.cta')}</CtaButton>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
