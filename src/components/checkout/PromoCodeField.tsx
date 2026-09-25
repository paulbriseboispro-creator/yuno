/**
 * « J'ai un code promo » sur les pages de paiement (billets, tables).
 *
 * Aperçu seulement : `check_promo_code` dit si le code s'applique à cette
 * soirée / ce palier et de combien, sans rien retenir. Le serveur redécide au
 * paiement (`claim_promo_code`, sous verrou et quota). Design public : même
 * grammaire que le reste du tunnel (mono en capitales, vert pour la remise).
 */
import { useState } from 'react';
import { Loader2, Tag, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { normalizePromoCode, promoReasonKey, type AppliedPromo, type PromoPillar } from '@/lib/promoCode';
import { capturePosthog } from '@/lib/posthog';
import { marketProps } from '@/lib/geo';

interface Props {
  eventId: string;
  pillar: PromoPillar;
  ticketRoundId?: string | null;
  applied: AppliedPromo | null;
  onChange: (promo: AppliedPromo | null) => void;
  /** Remise en euros déjà calculée pour l'affichage (null = code sans effet ici). */
  discount: number;
  /** Une remise promoteur plus forte l'emporte : on le dit plutôt que de laisser croire au cumul. */
  outranked?: boolean;
}

export function PromoCodeField({ eventId, pillar, ticketRoundId, applied, onChange, discount, outranked }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Jamais le code lui-même (saisie libre) : le résultat et la raison serveur.
  const track = (result: 'applied' | 'rejected', reason: string | null) =>
    capturePosthog('promo_code_applied', { pillar, result, reason, source: 'typed', ...marketProps({ eventId }) });

  const apply = async () => {
    const code = normalizePromoCode(value);
    if (!code) { setError(t('promo.reason.not_found')); return; }
    setChecking(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('check_promo_code' as never, {
        p_code: code, p_event_id: eventId, p_pillar: pillar, p_ticket_round_id: ticketRoundId ?? null,
      } as never);
      if (rpcError) throw rpcError;
      const res = data as { ok: boolean; reason?: string; code?: string; discountType?: 'percentage' | 'fixed'; discountValue?: number } | null;
      if (!res?.ok || !res.discountType || res.discountValue == null) {
        track('rejected', res?.reason ?? 'not_found');
        setError(t(promoReasonKey(res?.reason)));
        return;
      }
      track('applied', null);
      onChange({ code: res.code ?? code, discountType: res.discountType, discountValue: Number(res.discountValue) });
      setOpen(false);
      setValue('');
    } catch {
      track('rejected', 'unavailable');
      setError(t('promo.reason.unavailable'));
    } finally {
      setChecking(false);
    }
  };

  if (applied) {
    return (
      <div
        className="mt-3 flex items-center gap-2.5 p-3 border border-emerald-500/20"
        style={{ backgroundColor: 'rgba(16,185,129,0.06)', borderRadius: 4 }}
      >
        <Tag className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
        <span className="min-w-0 flex-1 font-mono uppercase text-emerald-400" style={{ fontSize: '11px', letterSpacing: '0.04em' }}>
          {t('promo.applied')} <span className="font-bold">{applied.code}</span>
          {applied.discountType === 'percentage' ? ` (-${applied.discountValue}%)` : discount > 0 ? ` (-${discount.toFixed(2)}€)` : ''}
          {outranked && <span className="mt-1 block normal-case text-[#9A9A9A]" style={{ letterSpacing: 0 }}>{t('promo.outranked')}</span>}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t('promo.remove')}
          className="shrink-0 p-1 text-[#9A9A9A] transition-colors hover:text-white"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-2 font-mono uppercase text-[#9A9A9A] transition-colors hover:text-white"
        style={{ fontSize: '11px', letterSpacing: '0.08em' }}
      >
        <Tag className="h-3.5 w-3.5" aria-hidden />
        {t('promo.have')}
      </button>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value.toUpperCase()); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void apply(); } }}
          placeholder={t('promo.placeholder')}
          aria-label={t('promo.label')}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          className="min-w-0 flex-1 border border-white/[0.12] bg-[#141414] px-3 py-2.5 font-mono uppercase text-white outline-none placeholder:text-[#5A5A5E] focus:border-white/30"
          style={{ fontSize: '13px', letterSpacing: '0.06em', borderRadius: 4 }}
        />
        <button
          type="button"
          onClick={() => void apply()}
          disabled={checking || !value.trim()}
          className="inline-flex items-center gap-1.5 border border-white/[0.16] px-4 font-mono uppercase text-white transition-opacity disabled:opacity-40"
          style={{ fontSize: '11px', letterSpacing: '0.08em', borderRadius: 4 }}
        >
          {checking && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {t('promo.apply')}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-[#FF6B75]" role="alert">{error}</p>}
    </div>
  );
}
