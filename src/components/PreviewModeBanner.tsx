// Bannière persistante affichée pendant un aperçu (preview) en lecture seule.
// Rappelle au prospect qu'il est en démo et permet de quitter proprement.

import { useNavigate } from 'react-router-dom';
import { Eye, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePreviewMode, disablePreviewMode } from '@/contexts/PreviewModeContext';
import { clearDemoBypass } from '@/lib/demoSession';

const RED = '#E8192C';

export function PreviewModeBanner() {
  const { isPreview, label } = usePreviewMode();
  const navigate = useNavigate();

  if (!isPreview) return null;

  const quit = async () => {
    disablePreviewMode();
    clearDemoBypass();
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    navigate('/', { replace: true });
  };

  return (
    <div
      className="fixed left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-white shadow-lg"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
        background: 'rgba(10,10,12,0.92)',
        border: `1px solid ${RED}55`,
        backdropFilter: 'blur(12px)',
        boxShadow: `0 10px 40px -12px ${RED}55`,
      }}
    >
      <Eye className="h-4 w-4" style={{ color: RED }} />
      <span className="text-[12.5px] font-medium">
        Aperçu — lecture seule{label ? <span className="text-white/55"> · {label}</span> : null}
      </span>
      <button
        type="button"
        onClick={quit}
        className="ml-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition hover:brightness-110"
        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
      >
        <X className="h-3 w-3" />
        Quitter
      </button>
    </div>
  );
}
