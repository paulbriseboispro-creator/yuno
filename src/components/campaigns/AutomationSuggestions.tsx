// « Yuno te propose d'allumer… » — les recettes ÉTEINTES que les faits des 30
// derniers jours justifient (RPC get_email_automation_suggestions : paniers
// abandonnés sans relance, soirée proche avec une base sans billet, tables
// libres et billets vendus, soirée publiée sans email, soirées scannées sans
// merci, clients silencieux, inscriptions sans bienvenue, palier presque
// plein). Un bouton « Allumer » crée le modèle Yuno et active la recette.
//
// Deux habits : `banner` en tête de la page Automatisations, `card` sur la
// page Campagnes (club et organisateur). Jamais en portée Yuno.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { type AutomationKind, type AutomationSuggestion } from '@/lib/email';
import { useEmailTemplates, type StudioScope } from '@/components/email-studio/hooks';
import { turnOnAutomation } from './automationSwitch';

const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'radial-gradient(ellipse 70% 60% at 90% -20%, rgba(232,25,44,0.10) 0%, transparent 65%),linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const nf = (n: number) => n.toLocaleString('fr-FR');

export default function AutomationSuggestions({ scope, basePath, variant, onEnabled }: {
  scope: StudioScope;
  /** Racine des campagnes de la portée (`/owner/campaigns`, `/organizer-app/campaigns`). */
  basePath: string;
  variant: 'banner' | 'card';
  /** Appelé après une activation réussie (la page Automatisations relit ses recettes). */
  onEnabled?: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { create } = useEmailTemplates(scope);
  const [items, setItems] = useState<AutomationSuggestion[] | null>(null);
  const [busy, setBusy] = useState<AutomationKind | null>(null);
  const isPlatform = scope.kind === 'platform';

  const load = useCallback(async () => {
    if (isPlatform) { setItems([]); return; }
    const { data } = await supabase.rpc('get_email_automation_suggestions' as never, {
      p_venue_id: scope.kind === 'venue' ? scope.venueId : null,
      p_organizer_user_id: scope.kind === 'organizer' ? scope.organizerId : null,
    } as never);
    setItems(Array.isArray(data) ? (data as unknown as AutomationSuggestion[]) : []);
  }, [scope, isPlatform]);

  useEffect(() => { void load(); }, [load]);

  const fill = (key: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), t(key));

  const turnOn = async (kind: AutomationKind) => {
    setBusy(kind);
    try {
      const res = await turnOnAutomation({ scope, kind, t, createTemplate: create });
      if (res.ok === false) { toast.error(res.error === 'template' ? t('em.auto.createError') : res.error); return; }
      toast.success(fill('em.auto.sug.enabled', { r: t(`em.auto.kind.${kind}.title`) }));
      setItems((prev) => (prev || []).filter((s) => s.kind !== kind));
      onEnabled?.();
    } finally {
      setBusy(null);
    }
  };

  if (isPlatform || !items || items.length === 0) return null;

  return (
    <div style={{ background: CARD_BG, border: '1px solid rgba(232,25,44,0.22)', borderRadius: 16, boxShadow: CARD_SHADOW, padding: '14px 18px' }}>
      <div className="flex items-center gap-2.5">
        <div style={{ width: 30, height: 30, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.25)', color: RED, flex: 'none' }}>
          <Sparkles className="w-4 h-4" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('em.auto.sug.title')}</div>
          <div style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>{t('em.auto.sug.subtitle')}</div>
        </div>
        {variant === 'card' && (
          <button
            type="button" onClick={() => navigate(`${basePath}/automations`)} className="cursor-pointer hidden sm:inline-flex items-center gap-1"
            style={{ background: 'none', border: 'none', padding: 0, color: RED, fontSize: 11.5, fontWeight: 600, flex: 'none' }}
          >
            {t('em.auto.sug.seeAll')} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {items.map((s) => (
          <div
            key={s.kind}
            className="flex flex-wrap items-center gap-3"
            style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.032)', border: `1px solid ${BORDER}` }}
          >
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t(`em.auto.kind.${s.kind}.title`)}</div>
              <div style={{ color: T2, fontSize: 11.5, marginTop: 2, lineHeight: 1.5 }}>
                {fill(s.reason_key, s.reason_vars || {})}
                {s.reach > 0 && (
                  <span style={{ color: T3 }}>{' · '}{fill(s.reach === 1 ? 'em.auto.sug.reachOne' : 'em.auto.sug.reach', { n: nf(s.reach) })}</span>
                )}
              </div>
            </div>
            <button
              type="button" disabled={busy != null} onClick={() => void turnOn(s.kind)}
              className="inline-flex items-center gap-1.5 cursor-pointer"
              style={{ padding: '8px 14px', borderRadius: 10, background: RED, color: '#fff', fontSize: 12, fontWeight: 600, border: 'none', boxShadow: '0 0 18px -6px #E8192C', opacity: busy && busy !== s.kind ? 0.5 : 1, flex: 'none' }}
            >
              {busy === s.kind ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {t('em.auto.sug.turnOn')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
