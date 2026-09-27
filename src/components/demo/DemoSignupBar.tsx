// Barre « Crée le compte de <orga> » en haut de la démo.
//
// Visible dans l'onglet d'un prospect entré par un lien d'aperçu démo dont le
// super admin a préparé le compte (AdminDemoAccess → « Compte à créer »).
// Personnalisée à son prénom et au nom de sa structure ; le bouton ouvre
// DemoSignupDialog, qui crée le vrai compte. La pastille d'aperçu du bas
// (PreviewModeBanner) porte le même bouton, toujours à portée de pouce.
//
// La barre est DANS le flux, pas fixe : elle pousse la page au lieu de
// recouvrir les en-têtes collants des dashboards, et part au défilement. Seule
// la barre latérale fixe des Consoles doit la connaître : on publie sa hauteur
// visible dans `--app-top-offset` (lue par ui/sidebar.tsx, 0 par défaut).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { usePreviewMode } from '@/contexts/PreviewModeContext';
import { Wordmark } from '@/components/brand/Wordmark';
import { leaveDemoToAccount, parseDemoSignup } from '@/lib/demoSignup';
import { DEMO_SIGNUP_COPY, demoLang } from './demoSignupCopy';
import { DemoSignupDialog } from './DemoSignupDialog';

const RED = '#E8192C';
const OPEN_EVENT = 'yuno-demo-signup-open';
const OFFSET_VAR = '--app-top-offset';

/** Ouvre le dialogue de création depuis n'importe où (pastille d'aperçu). */
export function openDemoSignupDialog(): void {
  try { window.dispatchEvent(new Event(OPEN_EVENT)); } catch { /* pas de window */ }
}

export function DemoSignupBar() {
  const { isPreview, kind, signup: raw, language: linkLanguage } = usePreviewMode();
  const prefill = useMemo(() => (isPreview && kind === 'demo' ? parseDemoSignup(raw) : null), [isPreview, kind, raw]);
  // La langue du LIEN (choisie par Paul pour ce prospect), pas celle du
  // compte démo, que LanguageContext resynchronise depuis son profil.
  const lang = demoLang(linkLanguage);
  const c = DEMO_SIGNUP_COPY[lang];
  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!prefill || prefill.created) return;
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [prefill]);

  // Hauteur encore visible de la barre → --app-top-offset (barre latérale fixe).
  useLayoutEffect(() => {
    const el = barRef.current;
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty(OFFSET_VAR);
      return;
    }
    let frame = 0;
    const publish = () => {
      frame = 0;
      const bottom = Math.max(0, Math.round(el.getBoundingClientRect().bottom));
      root.style.setProperty(OFFSET_VAR, `${bottom}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(publish); };
    publish();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      root.style.removeProperty(OFFSET_VAR);
    };
  }, [prefill]);

  if (!prefill) return null;

  const org = prefill.orgName || c.fallbackOrg[prefill.kind];

  return (
    <>
      <div
        ref={barRef}
        data-theme-island="dark"
        data-demo-signup-bar=""
        className="relative z-[45] w-full"
        style={{
          background: 'linear-gradient(90deg,#1a0508 0%,#0a0a0c 55%,#0a0a0c 100%)',
          borderBottom: `1px solid ${RED}40`,
          color: '#fff',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(60% 140% at 0% 50%, ${RED}33, transparent 70%)` }}
        />
        <div className="relative mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
          <span className="hidden shrink-0 sm:inline-flex"><Wordmark height={15} /></span>
          <span
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:flex"
            style={{ background: `${RED}26`, border: `1px solid ${RED}55` }}
          >
            <Sparkles className="h-3.5 w-3.5" style={{ color: RED }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug sm:truncate sm:text-[14px]">
              {prefill.created ? c.barCreatedTitle(org) : c.barTitle(prefill.firstName, org)}
            </p>
            <p className="hidden truncate text-[12px] leading-snug md:block" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {prefill.created ? c.barCreatedSub : c.barSub(prefill.kind)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => (prefill.created ? void leaveDemoToAccount() : setOpen(true))}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition hover:brightness-110 sm:px-4 sm:text-[13px]"
            style={{ background: RED, color: '#fff', boxShadow: `0 0 22px -8px ${RED}` }}
          >
            <span className="sm:hidden">{prefill.created ? c.barCreatedCta : c.barCtaShort}</span>
            <span className="hidden max-w-[260px] truncate sm:inline">
              {prefill.created ? c.barCreatedCta : c.barCta(org)}
            </span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!prefill.created && (
        <DemoSignupDialog open={open} onOpenChange={setOpen} prefill={prefill} lang={lang} />
      )}
    </>
  );
}
