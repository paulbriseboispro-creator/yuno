/**
 * Kit commun des écrans d'analyse (Console Club et Console Organisateur).
 *
 * La grammaire qui rend Shotgun lisible, appliquée à Yuno : chaque total porte
 * ce qui a bougé AUJOURD'HUI, chaque chiffre dit d'où il vient (ⓘ), chaque
 * écran dit quand il a été lu, et une donnée partielle dit sur combien de
 * personnes elle est connue. Un écran d'analyse nouveau passe par ces briques
 * plutôt que de redessiner les siennes — c'est ce qui fera qu'on lit tous les
 * écrans de la même façon.
 *
 * Tokens du design system pro (`docs/DESIGN_SYSTEM.md`) : encre `--ink`,
 * jamais un blanc en dur, pour suivre le thème clair.
 */
import { useState } from 'react';
import { ArrowUp, ChevronDown, Clock, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { KIT, useNumberFormat, type DeltaFormat } from './kitFormat';

/**
 * « ▲ 6 aujourd'hui » sous un total. Rien aujourd'hui = une ligne grise, pas
 * un zéro vert : « est-ce que ça bouge ? » doit se lire d'un coup d'œil.
 */
export function TodayDelta({ value, display, size = 11.5 }: { value: number; display?: string; size?: number }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  if (value <= 0) {
    return <span className="whitespace-nowrap" style={{ color: KIT.T3, fontSize: size }}>{t('ak.nothingToday')}</span>;
  }
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap tabular-nums" style={{ color: KIT.POS, fontSize: size, fontWeight: 600 }}>
      <ArrowUp className="h-3 w-3 flex-none" aria-hidden />
      {t('ak.today').replace('{value}', display ?? n(value))}
    </span>
  );
}

/** « Mis à jour à 16:05 » : dit quand l'écran a lu la base. */
export function UpdatedAt({ at }: { at: Date | null }) {
  const { t } = useLanguage();
  const { time } = useNumberFormat();
  if (!at) return null;
  return (
    <span className="inline-flex items-center gap-1" style={{ color: KIT.T3, fontSize: 11 }}>
      <Clock className="h-3 w-3" aria-hidden />
      {t('ak.updatedAt').replace('{time}', time(at))}
    </span>
  );
}

/**
 * ⓘ à côté d'un libellé : la définition exacte du chiffre, au survol, au
 * focus ou au toucher. Une définition, pas un mode d'emploi — une phrase.
 */
export function MetricHint({ text, label }: { text: string; label?: string }) {
  const { t } = useLanguage();
  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ? `${t('ak.definition')} : ${label}` : t('ak.definition')}
          className="pointer-events-auto inline-flex h-4 w-4 items-center justify-center rounded-full cursor-help focus-visible:outline focus-visible:outline-2"
          style={{ color: KIT.T3 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3 w-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-[260px] border-0 text-[12px] leading-snug"
        style={{ background: 'var(--sf-111113)', color: KIT.T1, boxShadow: '0 10px 30px -12px rgb(0 0 0/.6)', border: `1px solid ${KIT.BORDER}` }}
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * « Connu pour 11 560 contacts sur 13 930 » : toute donnée partielle (âge,
 * sexe, ville, visites consenties) dit sur combien de personnes elle repose.
 */
export function CoverageNote({ known, total, unit }: { known: number; total: number; unit?: string }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  if (total <= 0) return null;
  const text = known >= total
    ? t('ak.coverageAll').replace('{total}', n(total)).replace('{unit}', unit ?? t('ak.people'))
    : t('ak.coverage').replace('{known}', n(known)).replace('{total}', n(total)).replace('{unit}', unit ?? t('ak.people'));
  return (
    <p className="inline-flex items-center gap-1.5" style={{ color: KIT.T3, fontSize: 11 }}>
      <Info className="h-3 w-3 flex-none" aria-hidden />
      {text}
    </p>
  );
}

/** Jauge fine de remplissage, rouge une fois pleine. */
export function FillBar({ pct, soldOut = false, height = 4 }: { pct: number | null; soldOut?: boolean; height?: number }) {
  const value = soldOut ? 100 : pct ?? 0;
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: KIT.TRACK }} aria-hidden>
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{ width: `${value}%`, background: soldOut || value >= 100 ? KIT.RED : 'rgb(var(--ink)/0.72)' }}
      />
    </div>
  );
}

/**
 * Vue en cours de chargement, sous la navigation de l'Analytics : la page
 * reste en place (familles, vues) et seule la zone de la vue attend.
 */
export function AnalyticsLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] rounded-2xl animate-pulse" style={{ background: KIT.TRACK }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-[180px] rounded-2xl animate-pulse" style={{ background: KIT.TRACK }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Briques de lecture (plan de simplification, 2026-09-25). Une vue d'analyse
// se lit toujours dans le même ordre : la réponse en une phrase (`AnswerLine`),
// quatre chiffres comparés (`KpiRow` + `KpiTile`), UN graphique, une liste
// classée (`RankedList`) ou un tableau court, le reste replié (`MoreDetail`).
// ─────────────────────────────────────────────────────────────────────────────

/** La réponse de la vue, en une phrase. Les chiffres importants en <strong>. */
export function AnswerLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1" style={{ color: KIT.T1, fontSize: 15.5, lineHeight: 1.5, maxWidth: '72ch', textWrap: 'pretty' }}>
      {children}
    </p>
  );
}

/**
 * « ▲ +12 % » / « ▼ −3 € » signé, jamais la couleur seule. Au-delà de ±300 %
 * ou sans base, on montre l'écart absolu (« ▲ +84 ») : « +2 810 % » depuis
 * presque rien n'informe personne. `lowerIsBetter` inverse les couleurs
 * (temps de service, absents, remboursements).
 */
export function DeltaBadge({ current, previous, format, lowerIsBetter = false, vs, size = 12 }: {
  current: number | null; previous: number | null; format: DeltaFormat;
  lowerIsBetter?: boolean; vs?: string; size?: number;
}) {
  const { n, eur, locale } = useNumberFormat();
  if (current === null || previous === null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) {
    return <span style={{ color: KIT.T3, fontSize: size }}>= {vs}</span>;
  }
  const up = diff > 0;
  const good = lowerIsBetter ? !up : up;
  let text: string;
  if (format === 'pct') {
    // Écart de pourcentages = des points, pas des %.
    text = `${up ? '+' : '−'}${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.abs(diff))} pt`;
  } else {
    const rel = previous > 0 ? (diff / previous) * 100 : null;
    if (rel !== null && Math.abs(rel) <= 300 && format !== 'min') {
      text = `${up ? '+' : '−'}${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.abs(rel))} %`;
    } else {
      const abs = Math.abs(diff);
      const body = format === 'eur' ? eur(abs) : format === 'min' ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(abs)} min` : n(abs);
      text = `${up ? '+' : '−'}${body}`;
    }
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums" style={{ fontSize: size }}>
      <span style={{ color: good ? KIT.POS : 'var(--acc-ff5c63)', fontWeight: 600 }}>{up ? '▲' : '▼'} {text}</span>
      {vs && <span style={{ color: KIT.T3 }}>{vs}</span>}
    </span>
  );
}

/** Rangée de quatre tuiles au plus : 2 × 2 sur téléphone, 4 de front ailleurs. */
export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/**
 * Une tuile : libellé + ⓘ, valeur, comparaison. Cliquable quand elle pilote
 * le graphique (`onSelect`) — la tuile active porte le liseré rouge.
 */
export function KpiTile({ label, hint, value, delta, sub, active = false, onSelect }: {
  label: string; hint?: string; value: string; delta?: React.ReactNode; sub?: React.ReactNode;
  active?: boolean; onSelect?: () => void;
}) {
  // Une div à rôle de bouton : l'ⓘ de la définition est lui-même un bouton,
  // et un <button> ne peut pas en contenir un autre.
  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } } : undefined}
      aria-pressed={onSelect ? active : undefined}
      className={`min-w-0 text-left flex flex-col gap-1.5 rounded-2xl p-4 transition-colors ${onSelect ? 'cursor-pointer focus-visible:outline focus-visible:outline-2' : ''}`}
      style={{
        background: 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)',
        border: `1px solid ${active ? KIT.RED : KIT.BORDER}`,
        boxShadow: active ? `0 0 0 1px ${KIT.RED} inset` : undefined,
      }}
    >
      <span className="inline-flex items-center gap-1" style={{ color: KIT.T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        <span className="truncate">{label}</span>
        {hint && <MetricHint text={hint} label={label} />}
      </span>
      <span className="tabular-nums leading-none truncate" style={{ color: KIT.T1, fontSize: 'clamp(22px,2.4vw,28px)', fontWeight: 650, letterSpacing: '-0.025em' }}>
        {value}
      </span>
      {(delta || sub) && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ fontSize: 12, color: KIT.T3 }}>
          {delta}
          {sub}
        </span>
      )}
    </div>
  );
}

/**
 * Vendu / capacité avec un repère (bullet graph) : la barre, la capacité, et
 * un trait « la référence en était là ». Remplace les anneaux décoratifs.
 */
export function BulletBar({ label, value, display, capacity, reference, referenceLabel, soldOut = false }: {
  label: string; value: number; display: string; capacity: number | null;
  reference?: number | null; referenceLabel?: string; soldOut?: boolean;
}) {
  const { n } = useNumberFormat();
  const cap = capacity && capacity > 0 ? capacity : null;
  const pct = cap ? Math.min(100, (value / cap) * 100) : 0;
  const refPct = cap && reference != null ? Math.min(100, (reference / cap) * 100) : null;
  return (
    <div className="grid items-center gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'minmax(84px,auto) 1fr auto' }}>
      <span className="truncate" style={{ color: KIT.T2, fontSize: 13 }}>{label}</span>
      <span className="relative h-2.5 rounded-full" style={{ background: KIT.TRACK }} aria-hidden>
        {cap && <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${soldOut ? 100 : pct}%`, background: KIT.RED }} />}
        {refPct !== null && (
          <span className="absolute -top-1 -bottom-1 w-[2px] rounded-full" style={{ left: `calc(${refPct}% - 1px)`, background: KIT.T1 }}
            title={referenceLabel} />
        )}
      </span>
      <span className="whitespace-nowrap tabular-nums text-right" style={{ color: KIT.T1, fontSize: 13, fontWeight: 600 }}>
        {display}{cap && <span style={{ color: KIT.T3, fontWeight: 400 }}> / {n(cap)}</span>}
      </span>
    </div>
  );
}

/**
 * Classement horizontal trié : libellé, valeur, barre de part. Sept lignes
 * puis « Voir tout » — jamais de donut au-delà de trois parts.
 */
export function RankedList({ rows, limit = 7, moreLabel, lessLabel }: {
  rows: { key: string; label: React.ReactNode; value: string; note?: string; share: number }[];
  limit?: number; moreLabel: string; lessLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, limit);
  const max = Math.max(1, ...rows.map((r) => r.share));
  return (
    <div className="flex flex-col gap-3">
      {shown.map((r) => (
        <div key={r.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3" style={{ fontSize: 13 }}>
            <span className="min-w-0 truncate" style={{ color: KIT.T2 }}>{r.label}</span>
            <span className="whitespace-nowrap tabular-nums" style={{ color: KIT.T1 }}>
              {r.value}{r.note && <span style={{ color: KIT.T3 }}> · {r.note}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: KIT.TRACK }}>
            <div className="h-full rounded-full" style={{ width: `${(r.share / max) * 100}%`, background: 'rgb(var(--ink)/0.72)' }} />
          </div>
        </div>
      ))}
      {rows.length > limit && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="self-start text-[12.5px] font-medium" style={{ color: KIT.T2 }}>
          {open ? lessLabel : moreLabel.replace('{n}', String(rows.length))}
        </button>
      )}
    </div>
  );
}

/** Répartition en deux ou trois parts : une barre empilée + légende chiffrée. */
export function StackBar({ parts, format }: {
  parts: { key: string; label: string; value: number; color: string }[];
  format: (v: number) => string;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) return null;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: KIT.TRACK }}>
        {shown.map((p) => (
          <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1" style={{ fontSize: 12, color: KIT.T2 }}>
        {shown.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5 tabular-nums">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label} <span style={{ color: KIT.T1, fontWeight: 600 }}>{format(p.value)}</span>
            <span style={{ color: KIT.T3 }}>{Math.round((p.value / total) * 100)} %</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Une vue sans donnée : UNE phrase et, s'il y en a, les gestes utiles. */
export function EmptyAnswer({ title, body, actions }: { title: string; body?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl p-6" style={{ border: `1px dashed ${KIT.BORDER}` }}>
      <p style={{ color: KIT.T1, fontSize: 15, fontWeight: 600 }}>{title}</p>
      {body && <p style={{ color: KIT.T3, fontSize: 13, maxWidth: '64ch' }}>{body}</p>}
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Le reste de la vue, replié : un seul niveau, jamais de repli dans un repli. */
export function MoreDetail({ label, children, defaultOpen = false }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl" style={{ border: `1px solid ${KIT.BORDER}` }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span style={{ color: KIT.T2, fontSize: 13.5, fontWeight: 560 }}>{label}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: KIT.T3 }} aria-hidden />
      </button>
      {open && <div className="space-y-4 px-3 pb-4 sm:px-5">{children}</div>}
    </div>
  );
}

/** Pastilles de choix (pilier, période) — un seul choix actif. */
export function ChoicePills<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)}
            className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-2"
            style={active
              ? { background: KIT.RED, color: '#fff' }
              : { background: 'rgb(var(--ink)/0.05)', color: KIT.T2, border: `1px solid ${KIT.BORDER}` }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
