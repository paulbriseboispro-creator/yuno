// Bannière persistante affichée pendant un aperçu (preview) en lecture seule.
// Rappelle au prospect qu'il est en démo, permet de basculer entre les rôles
// accordés par le lien, et de quitter proprement.
//
// Variante VITRINE (kind === 'showcase') : le prospect est connecté au compte
// fantôme de SA venue — le switcher de rôles démo est remplacé par deux pills
// de navigation (page publique ↔ dashboard) et le CTA « Activer mon compte ».

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, X, ChevronDown, Loader2, Check, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePreviewMode, disablePreviewMode, setPreviewCurrentRole } from '@/contexts/PreviewModeContext';
import { clearDemoBypass, switchToDemoRole, DEMO_ACCOUNTS, type TargetAccount } from '@/lib/demoSession';
import { ShowcaseClaimDialog } from '@/components/showcase/ShowcaseClaimDialog';

const RED = '#E8192C';

// COPY local (la surface preview vit hors du i18n t(), comme PreviewGate).
const SHOWCASE_COPY: Record<'en' | 'fr' | 'es', {
  preview: string; publicPage: string; dashboard: string; activate: string; quit: string;
}> = {
  en: { preview: 'Preview', publicPage: 'Public page', dashboard: 'Dashboard', activate: 'Activate my account', quit: 'Quit' },
  fr: { preview: 'Aperçu', publicPage: 'Page publique', dashboard: 'Dashboard', activate: 'Activer mon compte', quit: 'Quitter' },
  es: { preview: 'Vista previa', publicPage: 'Página pública', dashboard: 'Panel', activate: 'Activar mi cuenta', quit: 'Salir' },
};

export function PreviewModeBanner() {
  const { isPreview, label, roles, current, kind, showcaseTarget, entitySlug, entityName, language } = usePreviewMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);

  if (!isPreview) return null;

  const multi = roles.length > 1;
  const currentMeta = DEMO_ACCOUNTS[current as TargetAccount];

  const switchTo = async (role: TargetAccount) => {
    if (role === current || switching) { setOpen(false); return; }
    setSwitching(true);
    const ok = await switchToDemoRole(role);
    if (ok) {
      setPreviewCurrentRole(role);
      setOpen(false);
      navigate(DEMO_ACCOUNTS[role].route, { replace: true });
    } else {
      toast.error('Bascule impossible');
    }
    setSwitching(false);
  };

  const quit = async () => {
    disablePreviewMode();
    clearDemoBypass();
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    navigate('/', { replace: true });
  };

  // ── Variante VITRINE (club ou organisateur) ────────────────────────────────
  if (kind === 'showcase') {
    const sc = SHOWCASE_COPY[language === 'fr' || language === 'es' ? language : 'en'];
    const isOrg = showcaseTarget === 'organizer';
    const publicPath = entitySlug ? (isOrg ? `/o/${entitySlug}` : `/club/${entitySlug}`) : '/';
    const dashboardPath = isOrg ? '/organizer-app' : '/owner/dashboard';
    const onDashboard = location.pathname.startsWith(isOrg ? '/organizer-app' : '/owner');
    const pill = (active: boolean) => ({
      background: active ? 'rgba(232,25,44,0.18)' : 'rgba(255,255,255,0.08)',
      border: `1px solid ${active ? `${RED}66` : 'rgba(255,255,255,0.12)'}`,
    });

    return (
      <>
        <div
          className="fixed left-1/2 z-[70] flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-2 text-white shadow-lg max-w-[calc(100vw-1.5rem)]"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
            background: 'rgba(10,10,12,0.94)',
            border: `1px solid ${RED}55`,
            backdropFilter: 'blur(12px)',
            boxShadow: `0 10px 40px -12px ${RED}55`,
          }}
        >
          <Eye className="h-4 w-4 shrink-0" style={{ color: RED }} />
          <span className="hidden sm:inline text-[12.5px] font-medium whitespace-nowrap">
            {sc.preview}{entityName ? <span className="text-white/55"> · {entityName}</span> : null}
          </span>

          <button
            type="button"
            onClick={() => navigate(publicPath)}
            className="ml-1 inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition hover:brightness-110 whitespace-nowrap"
            style={pill(!onDashboard)}
          >
            {sc.publicPage}
          </button>
          <button
            type="button"
            onClick={() => navigate(dashboardPath)}
            className="inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition hover:brightness-110 whitespace-nowrap"
            style={pill(onDashboard)}
          >
            {sc.dashboard}
          </button>

          <button
            type="button"
            onClick={() => setClaimOpen(true)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition hover:brightness-110 whitespace-nowrap"
            style={{ background: RED, boxShadow: `0 0 18px -6px ${RED}` }}
          >
            <Rocket className="h-3 w-3" />
            {sc.activate}
          </button>

          <button
            type="button"
            onClick={quit}
            aria-label={sc.quit}
            className="ml-0.5 inline-flex items-center rounded-full p-1.5 transition hover:brightness-110"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <ShowcaseClaimDialog
          open={claimOpen}
          onOpenChange={setClaimOpen}
          language={language}
          entityName={entityName}
        />
      </>
    );
  }

  return (
    <div
      className="fixed left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-2 text-white shadow-lg"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
        background: 'rgba(10,10,12,0.94)',
        border: `1px solid ${RED}55`,
        backdropFilter: 'blur(12px)',
        boxShadow: `0 10px 40px -12px ${RED}55`,
      }}
    >
      <Eye className="h-4 w-4 shrink-0" style={{ color: RED }} />
      <span className="text-[12.5px] font-medium whitespace-nowrap">
        Aperçu{label ? <span className="text-white/55"> · {label}</span> : null}
      </span>

      {multi && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={switching}
            className="ml-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition hover:brightness-110"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            {switching ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {currentMeta?.label ?? current}
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>

          {open && (
            <div
              className="absolute bottom-[calc(100%+8px)] left-0 min-w-[190px] overflow-hidden rounded-xl py-1"
              style={{ background: '#0a0a0c', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 50px -20px rgba(0,0,0,.9)' }}
            >
              <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                Voir en tant que
              </p>
              {(roles as TargetAccount[]).map((r) => {
                const meta = DEMO_ACCOUNTS[r];
                const active = r === current;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => switchTo(r)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition hover:bg-white/[0.06]"
                    style={{ color: active ? '#fff' : 'rgba(255,255,255,0.7)' }}
                  >
                    {meta?.label ?? r}
                    {active && <Check className="h-3.5 w-3.5" style={{ color: RED }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={quit}
        className="ml-0.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition hover:brightness-110"
        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
      >
        <X className="h-3 w-3" />
        Quitter
      </button>
    </div>
  );
}
