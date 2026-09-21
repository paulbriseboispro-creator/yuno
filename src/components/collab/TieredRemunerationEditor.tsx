import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { tierFor, validateTiers } from '@/lib/splitRules';
import type { CollabRemuneration, CollabTier } from '@/hooks/useOrganizerPartnerships';

const formatEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);

export type RemunerationMode = 'per_pillar' | 'tiered_total';

/** Barème vide de départ : deux lignes, pour que l'idée « à partir de » se lise tout de suite. */
export const DEFAULT_TIERS: CollabTier[] = [
  { from: 0, pct: 0 },
  { from: 3500, pct: 7 },
];

/**
 * Sélecteur du MODE de rémunération d'un contrat collab : partage par pilier
 * (historique, un % sur chaque vente) ou barème sur le CA total de la soirée
 * (calculé une fois après la soirée, fonds Yuno retenus jusqu'au décompte).
 */
export function RemunerationModeSwitch({ value, onChange, disabled }: {
  value: RemunerationMode;
  onChange: (m: RemunerationMode) => void;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const opts: { key: RemunerationMode; label: string; hint: string }[] = [
    {
      key: 'per_pillar',
      label: t('Partage par pilier', 'Split per pillar', 'Reparto por pilar'),
      hint: t('Un % sur chaque vente, versé automatiquement.', 'A % on every sale, paid out automatically.', 'Un % en cada venta, pagado automáticamente.'),
    },
    {
      key: 'tiered_total',
      label: t('Barème sur le CA de la soirée', "Tiers on the night's revenue", 'Escala sobre la facturación de la noche'),
      hint: t('Un taux selon le total de la nuit, bar compris, réglé après la soirée.', "A rate set by the night's total, bar included, settled after the night.", 'Una tasa según el total de la noche, barra incluida, liquidada tras la noche.'),
    },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key} type="button" disabled={disabled} onClick={() => onChange(o.key)}
            className={`rounded-xl border p-3 text-left transition-colors ${active ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-muted/40'} ${disabled ? 'opacity-60' : ''}`}
          >
            <p className="text-xs font-semibold text-foreground">{o.label}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{o.hint}</p>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Éditeur du barème : une ligne par palier (« à partir de X € → Y % »), et le
 * mode de calcul. `flat` = le taux du palier atteint s'applique à tout le total
 * (lecture littérale d'un barème « 3,5k–5,5k = 7 % ») ; `marginal` = chaque
 * tranche à son taux, sans effet de seuil. L'exemple chiffré sous le barème
 * montre la différence sur un total réel.
 */
export function TieredRemunerationEditor({ value, onChange, disabled }: {
  value: CollabRemuneration;
  onChange: (v: CollabRemuneration) => void;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const tiers = value.tiers;
  const mode = value.tiers_mode ?? 'flat';
  const error = validateTiers(tiers);

  const setTier = (i: number, patch: Partial<CollabTier>) => {
    const next = tiers.map((tier, idx) => (idx === i ? { ...tier, ...patch } : tier));
    onChange({ ...value, tiers: next });
  };
  const addTier = () => {
    const last = tiers[tiers.length - 1];
    onChange({ ...value, tiers: [...tiers, { from: (last?.from ?? 0) + 2000, pct: Math.min(100, (last?.pct ?? 0) + 4) }] });
  };
  const removeTier = (i: number) => onChange({ ...value, tiers: tiers.filter((_, idx) => idx !== i) });

  const errorLabel: Record<string, string> = {
    empty: t('Ajoute au moins un palier.', 'Add at least one tier.', 'Añade al menos un tramo.'),
    first_from_not_zero: t('Le premier palier doit partir de 0 € (son taux peut être 0 %).', 'The first tier must start at €0 (its rate can be 0%).', 'El primer tramo debe empezar en 0 € (su tasa puede ser 0 %).'),
    from_not_increasing: t('Les seuils doivent être strictement croissants.', 'Thresholds must be strictly increasing.', 'Los umbrales deben ser estrictamente crecientes.'),
    bad_pct: t('Un taux va de 0 à 100 %.', 'A rate goes from 0 to 100%.', 'Una tasa va de 0 a 100 %.'),
    bad_from: t('Seuil invalide.', 'Invalid threshold.', 'Umbral inválido.'),
    all_zero: t('Tous les taux sont à 0 % : l\'organisateur ne toucherait rien.', 'Every rate is 0%: the organizer would get nothing.', 'Todas las tasas son 0 %: el organizador no cobraría nada.'),
  };

  // Exemple sur le seuil le plus élevé + 10 % : c'est là que flat et marginal divergent.
  const sample = Math.max(1000, Math.round(((tiers[tiers.length - 1]?.from ?? 0) * 1.1) / 100) * 100);
  const flat = tierFor({ ...value, tiers_mode: 'flat' }, sample);
  const marginal = tierFor({ ...value, tiers_mode: 'marginal' }, sample);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <span>{t('À partir de (€ TTC)', 'From (€ incl. VAT)', 'A partir de (€ IVA incl.)')}</span>
          <span>{t('Part organisateur (%)', 'Organizer share (%)', 'Parte organizador (%)')}</span>
          <span className="w-8" />
        </div>
        {tiers.map((tier, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <Input
              type="number" min={0} step={100} inputMode="decimal" disabled={disabled || i === 0}
              value={tier.from}
              onChange={(e) => setTier(i, { from: Math.max(0, Number(e.target.value) || 0) })}
              className="h-8 text-xs"
            />
            <Input
              type="number" min={0} max={100} step={0.5} inputMode="decimal" disabled={disabled}
              value={tier.pct}
              onChange={(e) => setTier(i, { pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              className="h-8 text-xs"
            />
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={disabled || tiers.length <= 1 || i === 0}
              onClick={() => removeTier(i)} aria-label={t('Supprimer le palier', 'Remove tier', 'Eliminar tramo')}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={disabled} onClick={addTier}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {t('Ajouter un palier', 'Add a tier', 'Añadir un tramo')}
        </Button>
        {error && <p className="text-[11px] text-destructive">{errorLabel[error] ?? error}</p>}
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">{t('Comment le taux s\'applique', 'How the rate applies', 'Cómo se aplica la tasa')}</p>
        <div className="flex gap-2">
          {([
            { key: 'flat' as const, label: t('Sur tout le total', 'On the whole total', 'Sobre todo el total') },
            { key: 'marginal' as const, label: t('Par tranche', 'Per bracket', 'Por tramo') },
          ]).map((o) => (
            <button
              key={o.key} type="button" disabled={disabled}
              onClick={() => onChange({ ...value, tiers_mode: o.key })}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-[11.5px] ${mode === o.key ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 text-muted-foreground hover:bg-muted/40'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t('Ex.', 'E.g.', 'Ej.')} {formatEur(sample)} {t('de CA total', 'total revenue', 'de facturación total')} → {' '}
          <span className={mode === 'flat' ? 'font-semibold text-foreground' : ''}>
            {t('sur tout le total', 'whole total', 'todo el total')} {flat.pct}% = {formatEur(flat.amount)}
          </span>
          {' · '}
          <span className={mode === 'marginal' ? 'font-semibold text-foreground' : ''}>
            {t('par tranche', 'per bracket', 'por tramo')} = {formatEur(marginal.amount)}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Récapitulatif lisible d'un barème (bannière, avenant, panneau Argent). */
export function TiersRecap({ rem, className }: { rem: CollabRemuneration; className?: string }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const tiers = [...rem.tiers].sort((a, b) => a.from - b.from);
  return (
    <div className={className}>
      <ul className="space-y-0.5 text-xs">
        {tiers.map((tier, i) => {
          const next = tiers[i + 1];
          const range = next
            ? `${formatEur(tier.from)} – ${formatEur(next.from)}`
            : `≥ ${formatEur(tier.from)}`;
          return (
            <li key={i} className="flex items-center justify-between gap-3 tabular-nums">
              <span className="text-muted-foreground">{range}</span>
              <span className="font-semibold text-foreground">{tier.pct}% {t('orga', 'organizer', 'orga')}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {rem.tiers_mode === 'marginal'
          ? t('Chaque tranche à son taux (par tranche).', 'Each bracket at its own rate (per bracket).', 'Cada tramo a su tasa (por tramo).')
          : t('Le taux du palier atteint s\'applique à tout le total.', 'The rate of the tier reached applies to the whole total.', 'La tasa del tramo alcanzado se aplica a todo el total.')}
        {' '}
        {t('Assiette : billets + tables + bar (via Yuno et déclarés par le club), TTC hors frais Yuno.', 'Base: tickets + tables + bar (via Yuno and declared by the club), incl. VAT excl. Yuno fees.', 'Base: entradas + mesas + barra (vía Yuno y declarados por el club), IVA incl. sin comisiones Yuno.')}
      </p>
    </div>
  );
}

export default TieredRemunerationEditor;
