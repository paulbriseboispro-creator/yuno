/**
 * Acceptation des documents de Yuno CRM par le TITULAIRE d'un espace, d'un
 * seul geste, juste après la création du compte : les Conditions Yuno CRM,
 * l'Accord de sous-traitance (chapitre 12 « Yuno CRM ») et la politique de
 * confidentialité (liste : `CRM_LEGAL_DOCS`, plus l'« Accord marketing » = l'article 7 des Conditions mis en avant). Une fois par version
 * (LEGAL_VERSIONS), preuve dans legal_acceptances (version, empreinte du texte,
 * IP, user-agent, espace) — une ligne par document.
 *
 * Plein écran à la DA du CRM, pas une fenêtre : c'est la première chose que le
 * pro voit de sa Console. Seul le titulaire engage le compte : l'équipe n'est
 * jamais bloquée. Jamais en aperçu démo (lecture seule), en accès assisté (Yuno
 * n'accepte pas à la place du pro) ni sur un compte démo @womber.fr. La lecture
 * est fail-open (hasAcceptedLegal rend vrai sur une erreur) : une panne ne mure
 * pas la Console. Un ENREGISTREMENT raté, lui, se dit (« Réessayer » / « Plus
 * tard ») : sans lui, aucun e-mail CRM ne part.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { isSupportSessionActive } from '@/lib/supportSession';
import { isDemoEmail } from '@/lib/demoPlan';
import { hasAcceptedLegal, recordLegalAcceptance, type LegalDocType } from '@/lib/legal';
import { legalContent } from '@/data/legalContent';
import { Wordmark } from '@/components/brand/Wordmark';
import { useCrmScope } from '@/crm/scope';
import { useCrmT } from '@/crm/i18n';
import { CRM_LEGAL_DOCS, CRM_LEGAL_RECORDED, actingName, fillWord, legalGateNeeded, recordContext } from '@/crm/lib/legalGate';
import { Check, CtaButton, Portal, useFocusTrap } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';

// Sur place : crm.yunoapp.eu sert les textes légaux à la DA du CRM (CrmLegalPage).
const LEGAL_ORIGIN = '';
const LEAVE_MS = 460;
const GRAD_TEXT = { paddingRight: '.06em', marginRight: '-.06em', background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } as const;

export function CrmLegalGate() {
  const { user, signOut } = useAuth();
  const { space } = useCrmScope();
  const { t, lang } = useCrmT();
  const navigate = useNavigate();
  const [needed, setNeeded] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  // L'enregistrement a échoué : l'écran reste, dit pourquoi, et propose de réessayer.
  const [failed, setFailed] = useState(false);
  // Tout est enregistré : l'écran se retire en douceur.
  const [done, setDone] = useState(false);
  // Le Portail monte après le premier rendu : le piège de focus attend l'élément.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const trapRef = useMemo(() => ({ current: node }), [node]);

  const holder = space.role === 'owner';
  const exempt = !user || !holder || isPreviewActive() || isSupportSessionActive() || isDemoEmail(user.email);
  const open = !exempt && needed;
  useFocusTrap(trapRef, open && !!node);

  useEffect(() => {
    if (exempt) return;
    let active = true;
    void (async () => {
      // Seuls les documents contractuels décident d'ouvrir l'écran (legalGateNeeded).
      const contractual = CRM_LEGAL_DOCS.filter((d) => d.contractual);
      const answers = await Promise.all(contractual.map((d) => hasAcceptedLegal(d.docType)));
      const accepted: Partial<Record<LegalDocType, boolean>> = {};
      contractual.forEach((d, i) => { accepted[d.docType] = answers[i]; });
      if (active && legalGateNeeded(accepted)) setNeeded(true);
    })();
    return () => { active = false; };
  }, [exempt, user?.id]);

  // Le fond ne défile pas derrière l'écran.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const accept = async () => {
    if (!checked || saving || done) return;
    setSaving(true);
    setFailed(false);
    const email = user?.email ?? undefined;
    const context = { surface: 'crm_gate', scope: space.key };
    const results = await Promise.all(
      CRM_LEGAL_RECORDED.map((d) => recordLegalAcceptance({ docType: d.docType, docContent: legalContent[d.section][lang].content, email, context: recordContext(d, context) })),
    );
    setSaving(false);
    // L'enregistrement est la preuve, et c'est lui que lit l'identité de
    // l'expéditeur (aucun e-mail CRM ne part sans). Avant, un échec fermait la
    // fenêtre comme si tout était fait (audit du 18/10, UI-05) : on le dit,
    // on propose de réessayer, et « Plus tard » ne mure pas la Console.
    if (results.every(Boolean)) {
      setDone(true);
      window.setTimeout(() => setNeeded(false), LEAVE_MS);
      return;
    }
    setFailed(true);
  };

  const leave = async () => {
    await signOut();
    navigate('/auth');
  };

  const org = actingName(space.name, t('yc.legal.gate.org'));
  const [titleBefore, titleAfter = ''] = t('yc.legal.gate.h').split('{w}');
  const rise = (i: number) => ({ animation: `yc-lgl-rise 700ms ${EASE} both`, animationDelay: `${120 + i * 80}ms` }) as const;

  return (
    <Portal>
      <div
        ref={setNode}
        role="dialog"
        aria-modal="true"
        aria-labelledby="yc-lgl-title"
        tabIndex={-1}
        style={{
          position: 'fixed', inset: 0, zIndex: 100, overflowY: 'auto', outline: 'none', color: 'var(--ink)',
          background: 'radial-gradient(50% 40% at 85% 0%,rgba(255,107,53,.16),transparent 70%),radial-gradient(40% 40% at 0% 0%,rgba(227,20,27,.08),transparent 70%),var(--paper)',
          opacity: done ? 0 : 1, transition: `opacity ${LEAVE_MS}ms ${EASE}`, animation: 'yc-fade 320ms both',
        }}
      >
        <style>{'@keyframes yc-lgl-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}.yc-lgl-grid{display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"intro" "card" "ess";gap:28px;align-items:start}.yc-lgl-intro{grid-area:intro}.yc-lgl-card{grid-area:card}.yc-lgl-ess{grid-area:ess}@media (min-width:900px){.yc-lgl-grid{grid-template-columns:minmax(0,5fr) minmax(0,6fr);grid-template-areas:"intro card" "ess card";grid-template-rows:auto 1fr;column-gap:clamp(40px,5vw,72px);row-gap:28px}}@media (prefers-reduced-motion:reduce){.yc-lgl{animation:none!important}}'}</style>

        <header style={{ padding: '0 clamp(16px,3vw,40px)', height: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <Wordmark height={26} tone="dark" alt="Yuno" />
            <span style={{ height: 26, padding: '0 10px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 12.5, fontWeight: 600, color: 'var(--sand-600)', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>Yuno CRM</span>
          </span>
          <Hv
            as="button" type="button" onClick={() => { void leave(); }}
            style={{ height: 40, padding: '0 16px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}
            hover={{ background: 'var(--sand-50)', borderColor: 'var(--sand-300)' }}
          >
            <Icon name="logout" size={16} />{t('yc.legal.gate.out')}
          </Hv>
        </header>

        <main className="yc-lgl-grid" style={{ maxWidth: 1120, margin: '0 auto', padding: '16px clamp(16px,3vw,40px) 56px' }}>
          {/* Ce que l'on dit au pro. */}
          <section className="yc-lgl yc-lgl-intro" style={{ display: 'flex', flexDirection: 'column', gap: 22, paddingTop: 'clamp(0px,3vw,28px)', ...rise(0) }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.legal.gate.kicker')}</span>
            <h1 id="yc-lgl-title" style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(34px,4.6vw,52px)', lineHeight: 1.03, letterSpacing: '-.04em', textWrap: 'balance' }}>
              {titleBefore}<span style={GRAD_TEXT}>{t('yc.legal.gate.hw')}</span>{titleAfter}
            </h1>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 480 }}>{t('yc.legal.gate.sub')}</p>

          </section>

          <section className="yc-lgl yc-lgl-ess" style={{ maxWidth: 480, ...rise(2) }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 22, borderTop: '1px solid var(--sand-200)' }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{t('yc.legal.gate.ess')}</span>
              {(['yc.legal.gate.p1', 'yc.legal.gate.p2', 'yc.legal.gate.p3'] as const).map((k) => (
                <div key={k} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>
                  <span style={{ flex: 'none', width: 22, height: 22, marginTop: 1, borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={13} stroke={3} /></span>
                  <span style={{ textWrap: 'pretty' }}>{t(k)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Ce que le pro accepte, d'un seul geste. */}
          <section className="yc-lgl yc-lgl-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(18px,2.4vw,26px)', borderRadius: 28, background: '#fff', boxShadow: 'var(--shadow-md), 0 0 0 1px var(--sand-200)', ...rise(1) }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {CRM_LEGAL_DOCS.map((d) => (
                <div
                  key={d.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px 12px 14px', borderRadius: 18,
                    background: checked ? 'var(--green-50)' : 'var(--sand-50)',
                    boxShadow: `inset 0 0 0 1px ${checked ? 'rgba(23,163,74,.28)' : 'var(--sand-200)'}`,
                    transition: 'background 280ms, box-shadow 280ms',
                  }}
                >
                  <span style={{ flex: 'none', width: 42, height: 42, borderRadius: 13, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'grid', placeItems: 'center', color: 'var(--red-500)' }}>
                    <Icon name={d.icon} size={20} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, rowGap: 2 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.2 }}>{t(d.titleKey)}</span>
                      <Hv
                        as="a" href={`${LEGAL_ORIGIN}${d.path}`} target="_blank" rel="noopener noreferrer"
                        aria-label={`${t('yc.legal.gate.read')} : ${t(d.titleKey)}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--sand-500)', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--sand-300)' }}
                        hover={{ color: 'var(--red-600)', textDecorationColor: 'var(--red-600)' }}
                      >
                        {t('yc.legal.gate.read')}<Icon name="maximize" size={11} />
                      </Hv>
                    </span>
                    <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(d.summaryKey)}</span>
                  </span>
                  <span
                    aria-hidden
                    style={{
                      flex: 'none', alignSelf: 'flex-start', width: 24, height: 24, borderRadius: 99, display: 'grid', placeItems: 'center',
                      background: checked ? 'var(--green-500)' : 'transparent', color: '#fff',
                      boxShadow: checked ? 'none' : 'inset 0 0 0 1.5px var(--sand-300)', transition: `background 280ms, box-shadow 280ms, transform 360ms ${EASE}`,
                      transform: checked ? 'scale(1)' : 'scale(.92)',
                    }}
                  >
                    {checked && <Icon name="check" size={14} stroke={3} />}
                  </span>
                </div>
              ))}
            </div>

            {/* Pas de <label> : il renverrait le clic au bouton Check et la case basculerait deux fois. */}
            <div
              onClick={() => setChecked((c) => !c)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 18px', borderRadius: 18, cursor: 'pointer', background: '#fff', boxShadow: `inset 0 0 0 1.5px ${checked ? 'var(--ink)' : 'var(--sand-200)'}`, transition: 'box-shadow 200ms' }}
            >
              <span style={{ paddingTop: 2 }}><Check on={checked} onChange={setChecked} label={t('yc.legal.gate.t')} /></span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 15.5, lineHeight: 1.5, fontWeight: 600 }}>{fillWord(t('yc.legal.gate.all'), org)}</span>
                <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('yc.legal.gate.proof')}</span>
              </span>
            </div>

            {failed && (
              <div role="alert" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 13.5, lineHeight: 1.45, fontWeight: 500 }}>
                {t('yc.legal.gate.fail')}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              {failed && (
                <button type="button" onClick={() => setNeeded(false)} style={{ height: 40, padding: '0 16px', border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-600)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  {t('yc.legal.gate.later')}
                </button>
              )}
              <CtaButton size="lg" onClick={() => { void accept(); }} disabled={!checked || saving} icon="check">
                {saving ? t('yc.legal.gate.busy') : done ? t('yc.legal.gate.done') : t('yc.legal.gate.cta')}
              </CtaButton>
            </div>
          </section>
        </main>
      </div>
    </Portal>
  );
}
