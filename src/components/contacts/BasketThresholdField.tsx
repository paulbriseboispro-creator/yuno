// Le seuil du « panier moyen élevé » : la valeur établie par Yuno pour CETTE
// portée (historique de paniers, sinon formules de table, sinon billets) par
// défaut, remplaçable par celle du pro. Partagé par l'écran Audience du
// studio et le dialogue Segments — même geste, même libellé.
import { RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  BASKET_THRESHOLD_MAX, BASKET_THRESHOLD_MIN, describeBasketBasis, normalizeBasketThreshold,
  type BasketSuggestion,
} from '@/lib/contactSegments';

const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER = 'rgb(var(--ink)/0.085)';
const RED = '#E8192C';

export default function BasketThresholdField({ value, onChange, suggestion, compact }: {
  value: number;
  onChange: (next: number) => void;
  /** La valeur Yuno de la portée ; null tant qu'elle charge. */
  suggestion: BasketSuggestion | null;
  /** true = une ligne serrée sous une carte de segment (écran Audience). */
  compact?: boolean;
}) {
  const { t, language } = useLanguage();
  const yuno = suggestion?.threshold ?? null;
  const isYuno = yuno != null && value === yuno;
  const basis = suggestion ? describeBasketBasis(suggestion, t, language) : '';
  return (
    <div
      className="flex flex-wrap items-center"
      style={{ gap: 8, padding: compact ? '2px 12px 6px' : '8px 0', fontSize: 11.5, color: T3 }}
    >
      <label htmlFor="basket-threshold" style={{ whiteSpace: 'nowrap' }}>{t('cseg.basket.label')}</label>
      <input
        id="basket-threshold"
        type="number"
        inputMode="numeric"
        min={BASKET_THRESHOLD_MIN}
        max={BASKET_THRESHOLD_MAX}
        step={5}
        value={value}
        onChange={(e) => onChange(normalizeBasketThreshold(e.target.value))}
        onClick={(e) => e.stopPropagation()}
        aria-label={t('cseg.basket.label')}
        style={{
          width: 76, padding: '4px 8px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: T1,
          background: 'rgb(var(--ink)/0.05)', border: `1px solid ${isYuno ? BORDER : 'rgba(232,25,44,0.4)'}`,
          outline: 'none', fontVariantNumeric: 'tabular-nums',
        }}
      />
      <span>{t('cseg.basket.unit')}</span>
      {yuno == null ? null : isYuno ? (
        <span style={{ color: T3 }}>
          · {t('cseg.basket.yuno').replace('{n}', String(yuno))}{basis ? ` — ${basis}` : ''}
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange(yuno); }}
          className="inline-flex items-center gap-1 cursor-pointer"
          style={{ background: 'none', border: 'none', padding: 0, color: RED, fontSize: 11.5, fontWeight: 600 }}
          title={basis || undefined}
        >
          <RotateCcw size={11} strokeWidth={2} />
          {t('cseg.basket.reset').replace('{n}', String(yuno))}
        </button>
      )}
    </div>
  );
}
