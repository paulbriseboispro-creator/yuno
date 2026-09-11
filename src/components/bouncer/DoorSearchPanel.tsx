// Recherche par nom à la porte — le filet de sécurité quand le QR ne marche pas.
//
// Trois cas réels d'une nuit : téléphone déchargé, invité qui n'a jamais ouvert
// son mail, ajout de dernière minute par un promoteur. Le videur tape trois
// lettres, voit le nom, appuie dessus : la personne entre.
//
// Sans recherche, le panneau montre TOUTE la liste de la soirée, classée A→Z
// et découpée par initiale, avec l'index alphabétique à droite — le geste du
// carnet d'adresses. Il s'ouvrait autrefois sur un champ vide et zéro nom : à
// la porte, on en concluait que la soirée n'avait personne.
//
// Ce panneau ne valide RIEN lui-même. Il trouve le QR et le passe à
// `onPick`, que Bouncer branche sur son pipeline de scan existant — donc mêmes
// règles (heure limite, doublon, mauvais club), même écriture en base, même
// conversion promoteur, même file offline. Une entrée manuelle et un scan
// laissent exactement la même trace.

import { useMemo, useRef, useState } from 'react';
import { Search, Loader2, Check, Ticket, Crown, ClipboardList, WifiOff, RotateCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDoorRoster, type DoorRosterPerson } from '@/hooks/useDoorRoster';

const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

/** Colonne d'index : le « # » ramasse tout ce qui ne commence pas par une lettre. */
const INDEX_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

const KIND_ICON = {
  guest_list: ClipboardList,
  ticket: Ticket,
  table: Crown,
} as const;

/** Initiale de classement : accents retirés, chiffres et symboles sous « # ». */
function initialOf(name: string): string {
  const first = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

interface Props {
  eventId: string | null;
  /**
   * Reçoit le QR de la personne choisie — l'appelant le passe à son pipeline de
   * scan et renvoie `true` si l'entrée a été acceptée, pour que la ligne bascule
   * en « entré » sous le doigt sans attendre un rechargement.
   */
  onPick: (qr: string, person: DoorRosterPerson) => Promise<boolean> | boolean;
}

export function DoorSearchPanel({ eventId, onPick }: Props) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const roster = useDoorRoster(eventId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const searching = query.trim().length >= 2;
  const tooShort = query.trim().length > 0 && !searching;
  const results = searching ? roster.search(query, 60) : [];

  /** Liste complète découpée par initiale (vue par défaut). */
  const sections = useMemo(() => {
    if (searching) return [];
    const bucket = new Map<string, DoorRosterPerson[]>();
    for (const p of roster.all) {
      const letter = initialOf(p.name);
      const list = bucket.get(letter);
      if (list) list.push(p);
      else bucket.set(letter, [p]);
    }
    return INDEX_LETTERS.filter((l) => bucket.has(l)).map((letter) => ({
      letter,
      people: bucket.get(letter)!,
    }));
  }, [roster.all, searching]);

  const presentLetters = useMemo(() => new Set(sections.map((s) => s.letter)), [sections]);

  /**
   * Saut à une lettre. On défile le conteneur de la liste, jamais la page :
   * l'index doit rester sous le pouce pendant qu'on le parcourt.
   */
  const jumpTo = (letter: string) => {
    const target = sectionRefs.current[letter];
    const box = scrollRef.current;
    if (!target || !box) return;
    box.scrollTo({ top: target.offsetTop - box.offsetTop, behavior: 'auto' });
  };

  /** Glissé du pouce le long de l'index, comme dans un carnet d'adresses. */
  const onIndexTouch = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
    const letter = el?.dataset?.doorLetter;
    if (letter && presentLetters.has(letter)) jumpTo(letter);
  };

  const pick = async (p: DoorRosterPerson) => {
    if (picking) return;
    setPicking(p.qr);
    try {
      if (await onPick(p.qr, p)) roster.markScannedLocally(p.qr);
    } finally {
      setPicking(null);
    }
  };

  const row = (p: DoorRosterPerson) => {
    const Icon = KIND_ICON[p.kind];
    const busy = picking === p.qr;
    return (
      <button
        key={p.qr}
        type="button"
        onClick={() => pick(p)}
        disabled={!!picking}
        className="flex w-full items-center gap-3 rounded-xl px-3 text-left"
        style={{
          minHeight: 56,
          background: p.scanned ? 'rgba(52,211,153,0.07)' : INNER_BG,
          border: `1px solid ${p.scanned ? 'rgba(52,211,153,0.25)' : BORDER}`,
          opacity: picking && !busy ? 0.5 : 1,
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <Icon className="h-4 w-4 shrink-0" style={{ color: p.scanned ? POS : T3 }} />
        <div className="min-w-0 flex-1">
          <p style={{ color: T1, fontSize: 15, fontWeight: 600, margin: 0 }} className="truncate">
            {p.name}
          </p>
          {(p.detail || p.scanned) && (
            <p style={{ color: p.scanned ? POS : T3, fontSize: 11.5, margin: 0 }} className="truncate">
              {p.scanned ? t('door.alreadyIn') : p.detail}
            </p>
          )}
        </div>
        {busy
          ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: T2 }} />
          : p.scanned
            ? <Check className="h-4 w-4 shrink-0" style={{ color: POS }} />
            : <span style={{ color: T2, fontSize: 12, fontWeight: 600 }} className="shrink-0">{t('door.letIn')}</span>}
      </button>
    );
  };

  return (
    <div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('door.searchPlaceholder')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          className="w-full rounded-xl py-3 pl-10 pr-3 outline-none"
          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, fontSize: 16 }}
        />
      </div>

      <div className="mb-3 flex items-center gap-2" style={{ fontSize: 11.5, color: T3 }}>
        {roster.loading ? (
          <><Loader2 className="h-3 w-3 animate-spin" /> {t('door.loading')}</>
        ) : roster.error ? (
          <span style={{ color: RED }}>{t('door.unavailable')}</span>
        ) : (
          <>
            <span>{roster.stats.total} {t('door.onList')}</span>
            <span>·</span>
            <span>{roster.stats.scanned} {t('door.checkedIn')}</span>
            {roster.fromCache && (
              <span className="inline-flex items-center gap-1" style={{ color: T2 }}>
                <WifiOff className="h-3 w-3" /> {t('door.offlineList')}
              </span>
            )}
            <button
              type="button"
              onClick={roster.reload}
              className="ml-auto inline-flex items-center gap-1"
              style={{ color: T2 }}
            >
              <RotateCw className="h-3 w-3" /> {t('door.refresh')}
            </button>
          </>
        )}
      </div>

      {tooShort && <p style={{ color: T3, fontSize: 12.5 }}>{t('door.typeMore')}</p>}

      {searching && (
        results.length === 0 && !roster.loading ? (
          <p style={{ color: T3, fontSize: 13 }} className="py-6 text-center">{t('door.noMatch')}</p>
        ) : (
          <div className="space-y-1.5">{results.map(row)}</div>
        )
      )}

      {!searching && sections.length === 0 && !roster.loading && !roster.error && (
        <p style={{ color: T3, fontSize: 13 }} className="py-6 text-center">{t('door.empty')}</p>
      )}

      {!searching && sections.length > 0 && (
        <div className="relative">
          {/* Conteneur de défilement propre à la liste : sans lui, l'index
              alphabétique partirait avec la page et ne serait plus atteignable
              une fois descendu dans les M. */}
          <div
            ref={scrollRef}
            className="overflow-y-auto pr-8"
            style={{ maxHeight: '58vh', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
          >
            {sections.map((section) => (
              <div
                key={section.letter}
                ref={(el) => { sectionRefs.current[section.letter] = el; }}
              >
                <div
                  className="sticky top-0 z-10 px-1 py-1.5"
                  style={{
                    background: 'rgba(10,10,10,0.94)',
                    backdropFilter: 'blur(8px)',
                    color: T2,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                  }}
                >
                  {section.letter}
                </div>
                <div className="space-y-1.5 pb-2">{section.people.map(row)}</div>
              </div>
            ))}
          </div>

          {/* Index alphabétique. Les lettres absentes restent affichées mais
              éteintes : une colonne qui change de longueur d'une soirée à
              l'autre ne se vise plus au pouce. */}
          <div
            className="absolute right-0 top-0 bottom-0 flex w-7 select-none flex-col items-center justify-center gap-px"
            onTouchStart={onIndexTouch}
            onTouchMove={onIndexTouch}
            style={{ touchAction: 'none' }}
            aria-hidden
          >
            {INDEX_LETTERS.map((letter) => {
              const present = presentLetters.has(letter);
              return (
                <button
                  key={letter}
                  type="button"
                  data-door-letter={letter}
                  disabled={!present}
                  onClick={() => jumpTo(letter)}
                  className="flex h-full w-full items-center justify-center"
                  style={{
                    color: present ? T2 : 'rgba(255,255,255,0.14)',
                    fontSize: 9.5,
                    fontWeight: 700,
                    lineHeight: 1,
                    minHeight: 13,
                  }}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
