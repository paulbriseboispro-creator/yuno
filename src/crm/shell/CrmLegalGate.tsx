/**
 * Acceptation des Conditions Yuno CRM et de l'Accord de sous-traitance (chapitre
 * 12 « Yuno CRM ») par le TITULAIRE d'un espace, comme LegalConsentGate dans la
 * Billetterie : une fois par version (LEGAL_VERSIONS), preuve dans
 * legal_acceptances (version, empreinte du texte, IP, user-agent, espace).
 *
 * Seul le titulaire engage le compte : l'équipe n'est jamais bloquée. Jamais en
 * aperçu démo (lecture seule), en accès assisté (Yuno n'accepte pas à la place
 * du pro) ni sur un compte démo @womber.fr. La lecture est fail-open
 * (hasAcceptedLegal rend vrai sur une erreur) : une panne ne mure pas la Console.
 * Un ENREGISTREMENT raté, lui, se dit (« Réessayer » / « Plus tard ») : sans
 * lui, aucun e-mail CRM ne part.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { isSupportSessionActive } from '@/lib/supportSession';
import { isDemoEmail } from '@/lib/demoPlan';
import { hasAcceptedLegal, recordLegalAcceptance } from '@/lib/legal';
import { legalContent } from '@/data/legalContent';
import { useCrmScope } from '@/crm/scope';
import { useCrmT } from '@/crm/i18n';
import { Check, CtaButton, Modal } from '@/crm/ui/kit';

const LEGAL_ORIGIN = 'https://yunoapp.eu';
const noop = () => {};

export function CrmLegalGate() {
  const { user } = useAuth();
  const { space } = useCrmScope();
  const { t, lang } = useCrmT();
  const [needed, setNeeded] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  // L'enregistrement a échoué : la fenêtre reste, dit pourquoi, et propose de réessayer.
  const [failed, setFailed] = useState(false);

  const holder = space.role === 'owner';
  const exempt = !user || !holder || isPreviewActive() || isSupportSessionActive() || isDemoEmail(user.email);

  useEffect(() => {
    if (exempt) return;
    let active = true;
    void (async () => {
      const [terms, dpa] = await Promise.all([hasAcceptedLegal('terms_crm'), hasAcceptedLegal('dpa')]);
      if (active && !(terms && dpa)) setNeeded(true);
    })();
    return () => { active = false; };
  }, [exempt, user?.id]);

  if (exempt || !needed) return null;

  const accept = async () => {
    if (!checked || saving) return;
    setSaving(true);
    const email = user?.email ?? undefined;
    const context = { surface: 'crm_gate', scope: space.key };
    const terms = await recordLegalAcceptance({ docType: 'terms_crm', docContent: legalContent['cgv-crm'][lang].content, email, context });
    const dpa = await recordLegalAcceptance({ docType: 'dpa', docContent: legalContent.dpa[lang].content, email, context });
    setSaving(false);
    // L'enregistrement est la preuve, et c'est lui que lit l'identité de
    // l'expéditeur (aucun e-mail CRM ne part sans). Avant, un échec fermait la
    // fenêtre comme si tout était fait (audit du 18/10, UI-05) : on le dit,
    // on propose de réessayer, et « Plus tard » ne mure pas la Console.
    if (terms && dpa) { setNeeded(false); return; }
    setFailed(true);
  };

  const link = (path: string, label: string) => (
    <a href={`${LEGAL_ORIGIN}${path}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'underline' }}>{label}</a>
  );

  return (
    <Modal open onClose={noop} width={540} label={t('yc.legal.gate.t')}>
      <div style={{ padding: '30px 30px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{t('yc.legal.gate.t')}</span>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.legal.gate.s')}</p>
        <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>
          <li>{t('yc.legal.gate.p1')}</li>
          <li>{t('yc.legal.gate.p2')}</li>
          <li>{t('yc.legal.gate.p3')}</li>
        </ul>
        {/* Pas de <label> : il renverrait le clic au bouton Check et la case basculerait deux fois. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 14.5, lineHeight: 1.5, cursor: 'pointer', padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)' }}>
          <span style={{ paddingTop: 2 }}><Check on={checked} onChange={setChecked} label={t('yc.legal.gate.t')} /></span>
          <span onClick={() => setChecked((c) => !c)}>
            {t('yc.legal.gate.accept1')} {link('/legal/cgv-crm', t('yc.legal.doc.terms'))}{t('yc.legal.gate.accept2')}{link('/legal/dpa', t('yc.legal.doc.dpa'))}{t('yc.legal.gate.accept3')}
          </span>
        </div>
        {failed && (
          <div role="alert" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 13.5, lineHeight: 1.45, fontWeight: 500 }}>
            {t('yc.legal.gate.fail')}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          {failed && (
            <button type="button" onClick={() => setNeeded(false)} style={{ height: 40, padding: '0 16px', border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-600)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {t('yc.legal.gate.later')}
            </button>
          )}
          <CtaButton onClick={() => { void accept(); }} disabled={!checked || saving} icon="check">{t('yc.legal.gate.cta')}</CtaButton>
        </div>
      </div>
    </Modal>
  );
}
