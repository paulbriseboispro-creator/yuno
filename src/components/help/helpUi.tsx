import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Rocket, Settings, Moon, KeyRound, Users, Smartphone, Shield, Lightbulb, BookOpen, Map,
  LayoutDashboard, FileText, CheckCircle, Building2, CreditCard, UserPlus, Wine, CalendarDays,
  Ticket, GlassWater, ClipboardList, Star, BarChart3, ClipboardCheck, Music, Sun, Wrench,
  TrendingUp, UserCog, Lock, DoorOpen, Shirt, RefreshCw, Megaphone, Headphones, Plug, Search,
  Hash, ShieldCheck, ListOrdered, Undo2, AlertTriangle, QrCode, Zap, Wallet, Package, Globe,
  Bell, Receipt, Settings2, Sparkles, MessageCircle, Calendar, Crown, Gift, Handshake, Heart,
  LayoutGrid, Mail, Martini, MessageSquare, Music2, Radio, ShoppingCart, Store, UserCheck, Wand,
  ChevronRight, type LucideIcon,
} from 'lucide-react';
import type { OwnerHelpArticle } from '@/data/ownerHelpContent';
import { readingMinutes } from '@/lib/helpText';

// ─── Yuno Design Tokens (docs/DESIGN_SYSTEM.md) ───────────────────────────────
export const RED = '#E8192C';
export const POS = 'var(--acc-34d399)';
export const NEG = 'var(--acc-ff5c63)';
export const AMBER = 'var(--acc-f2b23c)';
export const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
export const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
export const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
export const C_FAINT = 'rgb(var(--ink)/0.06)';
export const BORDER = 'rgb(var(--ink)/0.085)';
export const F_BORDER = 'rgb(var(--ink)/0.055)';
export const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
export const INNER_BG = 'rgb(var(--ink)/0.032)';
export const TILE_BG = 'rgb(var(--ink)/0.025)';
export const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

/**
 * Couleur → même couleur à l'opacité `a`. Accepte `#RRGGBB`, une chaîne rgba
 * déjà formée, un accent de thème `var(--acc-RRGGBB)` (la teinte d'origine sert
 * aux fonds translucides) et l'encre `rgb(var(--ink)/…)`.
 */
export function rgba(color: string, a: number): string {
  if (color.startsWith('rgba')) return color.replace(/[\d.]+\)$/, `${a})`);
  if (color.startsWith('rgb(var(--ink)')) return `rgb(var(--ink)/${a})`;
  const acc = color.match(/^var\(--acc-([0-9a-f]{6})\)$/i);
  const n = parseInt(acc ? acc[1] : color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Une couleur par thème, la même dans tout le centre d'aide (tuile du thème,
 * icône de l'article, pastille du fil d'Ariane). Le rouge reste au premier
 * thème et à l'IA ; les autres reçoivent une teinte franche mais posée sur le
 * même noir, comme les pastilles d'icônes des centres d'aide de référence.
 * Accents de thème (`var(--acc-…)`) : assombris en thème clair, et `rgba()`
 * sait en tirer un fond translucide.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  'getting-started': RED,
  overview: 'var(--acc-5b9cff)',
  events: 'var(--acc-a78bfa)',
  'marketing-crm': 'var(--acc-f472b6)',
  operations: 'var(--acc-f2b23c)',
  settings: 'var(--acc-22d3ee)',
  ecosystem: 'var(--acc-34d399)',
  finance: 'var(--acc-2dd4bf)',
  showcase: 'var(--acc-f472b6)',
  team: 'var(--acc-f2b23c)',
  'yuno-clubs': 'var(--acc-5b9cff)',
  external: 'var(--acc-a78bfa)',
};
export const AI_COLOR = RED;
export const CONTACT_COLOR = 'var(--acc-5b9cff)';
export const EMAIL_COLOR = 'var(--acc-a78bfa)';

export function categoryColor(id: string | null | undefined): string {
  return (id && CATEGORY_COLORS[id]) || 'rgb(var(--ink)/var(--ink-a62,0.62))';
}

export const HELP_ICONS: Record<string, LucideIcon> = {
  Rocket, Settings, Moon, KeyRound, Users, Smartphone, Shield, Lightbulb, BookOpen, Map,
  LayoutDashboard, FileText, CheckCircle, Building2, CreditCard, UserPlus, Wine, CalendarDays,
  Ticket, GlassWater, ClipboardList, Star, BarChart3, ClipboardCheck, Music, Sun, Wrench,
  TrendingUp, UserCog, Lock, DoorOpen, Shirt, RefreshCw, Megaphone, Headphones, Plug, Search,
  Hash, ShieldCheck, ListOrdered, Undo2, AlertTriangle, QrCode, Zap, Wallet, Package, Globe,
  Bell, Receipt, Settings2, Sparkles, MessageCircle, Calendar, Crown, Gift, Handshake, Heart,
  LayoutGrid, Mail, Martini, MessageSquare, Music2, Radio, ShoppingCart, Store, UserCheck, Wand,
};

export function HelpIcon({ name, className, style }: { name: string; className?: string; style?: CSSProperties }) {
  const Icon = HELP_ICONS[name] ?? FileText;
  return <Icon className={className} style={style} aria-hidden="true" />;
}

/** `{n}` / `{q}` → valeurs. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), template);
}

export function articleCountLabel(t: (k: string) => string, n: number): string {
  return n === 1 ? t('ohelp.ui.articleCountOne') : fmt(t('ohelp.ui.articleCount'), { n });
}

export function articleReadMinutes(article: OwnerHelpArticle, t: (k: string) => string): number {
  return readingMinutes([t(article.descKey), ...article.sections.map((s) => t(s.bodyKey))]);
}

// ─── Surfaces ─────────────────────────────────────────────────────────────────

/** Carte principale (DESIGN_SYSTEM §3.1). `glow` ajoute le halo rouge ambiant (§3.5). */
export function HCard({ children, className, style, glow }: { children: ReactNode; className?: string; style?: CSSProperties; glow?: boolean }) {
  return (
    <div
      className={className}
      style={{
        background: glow
          ? `radial-gradient(ellipse 70% 50% at 90% -20%, rgba(232,25,44,0.08) 0%, transparent 65%), linear-gradient(180deg,rgb(var(--sheen)/.03) 0%,rgb(var(--sheen)/.005) 100%),var(--sf-0a0a0c)`
          : CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
        overflow: 'hidden',
        position: 'relative',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Libellé majuscule (§4). */
export function Kicker({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', ...style }}>
      {children}
    </span>
  );
}

/** En-tête de section : titre + sous-titre + slot droit (§5). */
export function SectionHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 style={{ color: T1, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, fontFamily: 'inherit' }}>{title}</h2>
        {sub && <p style={{ color: T3, fontSize: 12, marginTop: 3 }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Tuile d'icône : blanche par défaut, rouge en accent (§5). */
export function IconTile({ name, size = 36, accent = false, color, className }: { name: string; size?: number; accent?: boolean; color?: string; className?: string }) {
  // `color` = teinte du thème (toujours affichée) ; `accent` = état fort
  // (survol, page courante) qui pousse la teinte en plein et ajoute le halo.
  const tint = color ?? (accent ? RED : null);
  const strong = accent || Boolean(color);
  return (
    <div
      className={`flex items-center justify-center flex-none transition-all duration-150 ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: tint ? rgba(tint, accent ? 0.18 : 0.12) : C_FAINT,
        border: `1px solid ${tint ? rgba(tint, accent ? 0.42 : 0.26) : BORDER}`,
        color: tint ? (strong ? tint : T2) : T2,
        boxShadow: accent && tint ? `0 0 18px -6px ${rgba(tint, 0.65)}` : undefined,
      }}
    >
      <HelpIcon name={name} style={{ width: Math.round(size * 0.46), height: Math.round(size * 0.46) }} />
    </div>
  );
}

/** Pastille de statut (§7.3) — `hot` = rouge, sinon blanc faible. */
export function Pill({ children, hot, color, style }: { children: ReactNode; hot?: boolean; color?: string; style?: CSSProperties }) {
  const tint = color ?? (hot ? RED : null);
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '0.01em',
        border: `1px solid ${tint ? rgba(tint, 0.35) : BORDER}`,
        background: tint ? rgba(tint, 0.10) : C_FAINT,
        color: tint ?? T2,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Surligne les mots d'une requête dans un texte (recherche). */
export function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  const folded = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Les positions sont calculées sur le texte plié : les accents décomposés
  // décalent les index, on repasse donc par une carte caractère → position.
  const map: number[] = [];
  let fi = 0;
  for (let i = 0; i < text.length; i++) {
    const n = text[i].normalize('NFD').replace(/[̀-ͯ]/g, '').length;
    for (let k = 0; k < Math.max(1, n); k++) map[fi++] = i;
  }
  const ranges: Array<[number, number]> = [];
  for (const tk of tokens) {
    let from = 0;
    while (from < folded.length) {
      const at = folded.indexOf(tk, from);
      if (at < 0) break;
      ranges.push([map[at] ?? at, (map[at + tk.length - 1] ?? at + tk.length - 1) + 1]);
      from = at + tk.length;
    }
  }
  if (ranges.length === 0) return <>{text}</>;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([s, e], i) => {
    if (s > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, s)}</span>);
    out.push(
      <mark key={`m${i}`} style={{ background: 'rgba(232,25,44,0.22)', color: T1, borderRadius: 3, padding: '0 1px' }}>
        {text.slice(s, e)}
      </mark>,
    );
    cursor = e;
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{out}</>;
}

/** Ligne d'article (accueil, catégorie, résultats, articles liés). */
export function ArticleRow({
  icon, title, desc, meta, onClick, accent, compact, color,
}: {
  icon: string; title: ReactNode; desc?: ReactNode; meta?: ReactNode; onClick: () => void; accent?: boolean; compact?: boolean; color?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group w-full flex items-center gap-3 text-left cursor-pointer transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#E8192C]/60"
      style={{
        padding: compact ? '11px 12px' : '14px 16px',
        borderRadius: 14,
        background: hover ? 'rgb(var(--ink)/0.05)' : INNER_BG,
        border: `1px solid ${hover ? (color ? rgba(color, 0.35) : 'rgb(var(--ink)/0.14)') : BORDER}`,
      }}
    >
      <IconTile name={icon} size={compact ? 32 : 36} accent={accent || hover} color={color} />
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ color: T1, fontSize: compact ? 13.5 : 14, fontWeight: 600, letterSpacing: '-0.005em' }}>{title}</div>
        {desc && <div className="truncate" style={{ color: T3, fontSize: 12, marginTop: 2 }}>{desc}</div>}
        {meta && <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6 }}>{meta}</div>}
      </div>
      <ChevronRight
        className="w-4 h-4 flex-none transition-transform duration-150 group-hover:translate-x-0.5"
        style={{ color: hover ? T1 : T3 }}
        aria-hidden="true"
      />
    </button>
  );
}

// ─── Mémoire locale : articles récemment ouverts, avis « utile ? » ────────────

const RECENT_MAX = 6;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible (navigation privée) : la liste vit en mémoire */
  }
}

export function useRecentArticles(scope: string): [string[], (id: string) => void] {
  const key = `yuno.help.recent.${scope}`;
  const [ids, setIds] = useState<string[]>(() => readJson<string[]>(key, []));
  useEffect(() => { setIds(readJson<string[]>(key, [])); }, [key]);
  const push = useCallback((id: string) => {
    setIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_MAX);
      writeJson(key, next);
      return next;
    });
  }, [key]);
  return [ids, push];
}

export function useHelpfulVote(articleId: string): ['yes' | 'no' | null, (v: 'yes' | 'no') => void] {
  const key = `yuno.help.helpful.${articleId}`;
  const [vote, setVote] = useState<'yes' | 'no' | null>(() => readJson<'yes' | 'no' | null>(key, null));
  useEffect(() => { setVote(readJson<'yes' | 'no' | null>(key, null)); }, [key]);
  const cast = useCallback((v: 'yes' | 'no') => { setVote(v); writeJson(key, v); }, [key]);
  return [vote, cast];
}
