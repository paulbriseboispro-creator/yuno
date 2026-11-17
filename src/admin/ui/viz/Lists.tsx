/**
 * Les listes sans boîte du kit (v3) :
 *   Spine      la frise d'un compte ou d'une personne, groupée par mois ;
 *   Ledger     un registre de lignes séparées par des filets (LedgerRow) ;
 *   DenseRows  des lignes denses à colonnes mono (un petit tableau sans carte) ;
 *   GoTo       « ouvrir » au bout d'une ligne ;
 *   EmptyLine  la phrase quand il n'y a rien à dessiner (jamais une forme vide) ;
 *   Note       la règle d'un chiffre, en gris, sous le bloc.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { fmtDate } from '@/lib/adminFormat';
import { useAdminT } from '../i18n';

// ── Frise ────────────────────────────────────────────────────────────────────
export interface SpineItem {
  id: string;
  /** ISO 8601 ; un élément sans date valide est écarté. */
  at: string;
  /** Famille : décide du point et de l'étiquette mono. */
  family: string;
  title: ReactNode;
  body?: ReactNode;
  /** Valeur à droite (montant, nombre). */
  value?: ReactNode;
  /** Un élément qui compte (première vente, accès ouvert) : point plus fort. */
  strong?: boolean;
}

/** La frise : groupée par mois, plus récent en haut ; `familyLabel` donne le mot mono. */
export function Spine({ items, familyLabel, familyColor, empty, limit, onMore }: {
  items: SpineItem[];
  familyLabel: (f: string) => string;
  familyColor?: (f: string) => string;
  empty: ReactNode;
  limit?: number;
  onMore?: () => void;
}) {
  const { lang } = useAdminT();
  const valid = items.filter((x) => x.at && !Number.isNaN(new Date(x.at).getTime()))
    .sort((a, b) => b.at.localeCompare(a.at));
  if (valid.length === 0) return <p className="a-t3 text-[13px]">{empty}</p>;
  const shown = limit ? valid.slice(0, limit) : valid;
  const month = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' });
  const dayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
  const groups: Array<{ m: string; label: string; rows: SpineItem[] }> = [];
  for (const it of shown) {
    const m = it.at.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.m === m) last.rows.push(it);
    else groups.push({ m, label: month.format(new Date(`${m}-15T12:00:00Z`)), rows: [it] });
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.m} className="flex flex-col">
          <h3 className="a-kicker mb-1.5">{g.label}</h3>
          <ol className="flex flex-col">
            {g.rows.map((it, i) => (
              <li key={it.id} className="grid grid-cols-[3.75rem_0.75rem_minmax(0,1fr)_auto] items-start gap-x-3 py-1.5">
                <time className="a-mono a-t3 whitespace-nowrap pt-[1px] text-[11px]" dateTime={it.at} title={fmtDate(it.at, lang, 'datetime')}>{dayFmt.format(new Date(it.at))}</time>
                <span className="relative flex h-full justify-center">
                  <span className="mt-[5px] h-2 w-2 flex-none rounded-full"
                    style={{ background: familyColor?.(it.family) ?? 'var(--a-text-3)', boxShadow: it.strong ? '0 0 0 3px color-mix(in srgb, var(--a-text) 10%, transparent)' : undefined }} />
                  {i < g.rows.length - 1 && <span aria-hidden className="absolute bottom-[-8px] top-[15px] w-px" style={{ background: 'var(--a-border)' }} />}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={`text-[13px] ${it.strong ? 'a-t1 font-medium' : 'a-t1'}`}>{it.title}</span>
                    <span className="a-mono a-t3 text-[10.5px] uppercase tracking-[0.04em]">{familyLabel(it.family)}</span>
                  </div>
                  {it.body && <div className="a-t2 mt-0.5 text-[12.5px] leading-relaxed">{it.body}</div>}
                </div>
                {it.value != null ? <span className="a-num a-t2 text-right text-[12.5px]">{it.value}</span> : <span />}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {limit && valid.length > limit && onMore && (
        <button type="button" className="a-btn a-btn--sm self-start" onClick={onMore}>+ {valid.length - limit}</button>
      )}
    </div>
  );
}

/** Un registre : des lignes séparées par des filets, jamais une carte par ligne. */
export function Ledger({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col divide-y border-y ${className ?? ''}`}>{children}</div>;
}

export function LedgerRow({ to, onClick, selected, children, className }: { to?: string; onClick?: () => void; selected?: boolean; children: ReactNode; className?: string }) {
  const cls = `a-focus grid items-center gap-x-4 gap-y-1 px-1 py-3 text-left no-underline ${selected ? 'bg-[var(--a-hover)]' : 'hover:bg-[var(--a-hover)]'} ${className ?? ''}`;
  if (to) return <Link to={to} className={cls}>{children}</Link>;
  if (onClick) return <button type="button" className={`${cls} w-full`} onClick={onClick}>{children}</button>;
  return <div className={cls}>{children}</div>;
}

export function GoTo({ children }: { children: ReactNode }) {
  return <span className="a-t2 inline-flex items-center gap-1 whitespace-nowrap text-[12.5px]">{children}<ArrowUpRight className="h-3.5 w-3.5" /></span>;
}

// ── Lignes denses ───────────────────────────────────────────────────────────
/** Lignes denses à colonnes mono (tableau sans boîte). */
export function DenseRows({ rows, head, empty }: { rows: Array<{ key: string; main: ReactNode; cells: string[]; flag?: ReactNode }>; head: string[]; empty: string }) {
  if (rows.length === 0) return <p className="a-t2 text-[13px]">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] border-collapse text-[13px]">
        <thead><tr><th />{head.map((h) => <th key={h} className="a-kicker pb-2 text-right font-normal">{h}</th>)}<th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="min-w-[9rem] py-1.5 pr-3">{r.main}</td>
              {r.cells.map((c, i) => <td key={i} className="a-mono a-t1 py-1.5 pl-4 text-right text-[12px]">{c}</td>)}
              <td className="py-1.5 pl-4 text-right">{r.flag}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** La phrase quand il n'y a rien à dessiner : jamais une forme vide. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="a-t3 max-w-[68ch] text-[13px] leading-relaxed">{children}</p>;
}

/** La règle d'un chiffre, en gris, sous le bloc. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="a-t3 text-[12px] leading-relaxed">{children}</p>;
}
