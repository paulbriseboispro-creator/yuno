// Recherche par nom à la porte — le filet de sécurité quand le QR ne marche pas.
//
// Trois cas réels d'une nuit : téléphone déchargé, invité qui n'a jamais ouvert
// son mail, ajout de dernière minute par un promoteur. Le videur tape trois
// lettres, voit le nom, appuie dessus : la personne entre.
//
// Ce panneau ne valide RIEN lui-même. Il trouve le QR et le passe à
// `onPick`, que Bouncer branche sur son pipeline de scan existant — donc mêmes
// règles (heure limite, doublon, mauvais club), même écriture en base, même
// conversion promoteur, même file offline. Une entrée manuelle et un scan
// laissent exactement la même trace.

import { useState } from 'react';
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

const KIND_ICON = {
  guest_list: ClipboardList,
  ticket: Ticket,
  table: Crown,
} as const;

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

  const results = roster.search(query);
  const tooShort = query.trim().length > 0 && query.trim().length < 2;

  const pick = async (p: DoorRosterPerson) => {
    if (picking) return;
    setPicking(p.qr);
    try {
      if (await onPick(p.qr, p)) roster.markScannedLocally(p.qr);
    } finally {
      setPicking(null);
    }
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

      {!tooShort && query.trim().length >= 2 && results.length === 0 && !roster.loading && (
        <p style={{ color: T3, fontSize: 13 }} className="py-6 text-center">{t('door.noMatch')}</p>
      )}

      <div className="space-y-1.5">
        {results.map((p) => {
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
        })}
      </div>
    </div>
  );
}
