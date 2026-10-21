import { useEffect, useRef, useState } from 'react';
import { Bell, Check, Globe, Lock } from 'lucide-react';
import { Wordmark } from '@/components/brand/Wordmark';
import { BORDER, CARD_BG, INNER_BG, RED, T1, T2, T3 } from '@/components/org-ui';
import type { GuestNotification, GuestSpaceLanguage, GuestSpaceWords, GuestTab } from '@/lib/guestSpace';

const LANGS: { v: GuestSpaceLanguage; label: string }[] = [
  { v: 'es', label: 'Español' }, { v: 'fr', label: 'Français' }, { v: 'en', label: 'English' },
];

/** Popover fermé au clic à côté ou sur Échap. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

const iconBtn: React.CSSProperties = {
  height: 34, minWidth: 34, borderRadius: 10, border: `1px solid ${BORDER}`, background: INNER_BG, color: T2,
};

/**
 * Le haut de l'espace invité : marque (téléphone), « page privée », langue et
 * cloche. La langue part de celle choisie par l'organisateur ; l'invité la
 * change pour lui, sur son appareil.
 */
export function GuestTopBar({ w, lang, onLang, notifications, onOpenBell, go, date }: {
  w: GuestSpaceWords; lang: GuestSpaceLanguage; onLang: (l: GuestSpaceLanguage) => void;
  /** Les notifications du compte rattaché, « lu » par compte (marquées à la fermeture). */
  notifications: GuestNotification[]; onOpenBell: () => void;
  go: (t: GuestTab) => void; date: (iso: string, o: Intl.DateTimeFormatOptions) => string;
}) {
  const langPop = usePopover();
  const bell = usePopover();
  const count = notifications.filter((n) => !n.read).length;

  return (
    <div className="mb-4 flex items-center gap-2">
      <div className="lg:hidden"><Wordmark height={18} tone="white" alt="Yuno" /></div>
      <span className="ml-auto inline-flex items-center gap-1.5 lg:ml-0" style={{ color: T3, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        <Lock className="h-3 w-3" /> <span className="hidden sm:inline">{w('guestSpace.shell.private')}</span>
      </span>
      <div className="flex items-center gap-1.5 lg:ml-auto">
        <div className="relative" ref={langPop.ref}>
          <button type="button" aria-label={w('guestSpace.lang.label')} aria-expanded={langPop.open} onClick={() => langPop.setOpen(!langPop.open)}
            className="inline-flex items-center justify-center gap-1.5 px-2.5" style={{ ...iconBtn, fontSize: 12, fontWeight: 650 }}>
            <Globe className="h-3.5 w-3.5" /> {lang.toUpperCase()}
          </button>
          {langPop.open && (
            <div role="menu" className="absolute right-0 z-40 mt-1.5 w-40 overflow-hidden rounded-xl p-1" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}>
              {LANGS.map((l) => (
                <button key={l.v} type="button" role="menuitemradio" aria-checked={l.v === lang}
                  onClick={() => { onLang(l.v); langPop.setOpen(false); }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left"
                  style={{ color: l.v === lang ? T1 : T2, fontSize: 13, fontWeight: l.v === lang ? 620 : 520, background: l.v === lang ? 'rgb(var(--ink)/0.06)' : 'transparent' }}>
                  {l.label}{l.v === lang && <Check className="h-3.5 w-3.5" style={{ color: RED }} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative" ref={bell.ref}>
          <button type="button" aria-label={w('guestSpace.bell.title')} aria-expanded={bell.open}
            onClick={() => { const next = !bell.open; bell.setOpen(next); if (!next) onOpenBell(); }}
            className="relative inline-flex items-center justify-center" style={iconBtn}>
            <Bell className="h-4 w-4" />
            {count > 0 && (
              <span className="absolute -right-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full px-1"
                style={{ background: RED, color: '#fff', fontSize: 10, fontWeight: 700 }}>{count > 9 ? '9+' : count}</span>
            )}
          </button>
          {bell.open && (
            <div className="fixed inset-x-3 top-16 z-40 rounded-2xl p-1.5 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-1.5 sm:w-[340px]"
              style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}>
              <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1.5">
                <span style={{ color: T1, fontSize: 13.5, fontWeight: 650 }}>{w('guestSpace.bell.title')}</span>
                {count > 0 && (
                  <button type="button" onClick={onOpenBell} style={{ color: T3, fontSize: 11.5, fontWeight: 560 }}>{w('guestSpace.bell.markRead')}</button>
                )}
              </div>
              {notifications.length === 0 ? (
                <p className="px-2.5 pb-3 pt-1" style={{ color: T3, fontSize: 12.5 }}>{w('guestSpace.bell.empty')}</p>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto">
                  {notifications.map((n) => {
                    const fresh = !n.read;
                    return (
                      <button key={n.id} type="button" onClick={() => { go(n.tab); bell.setOpen(false); onOpenBell(); }}
                        className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors"
                        style={{ background: fresh ? 'rgb(var(--ink)/0.05)' : 'transparent' }}>
                        <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full" style={{ background: fresh ? RED : 'transparent' }} />
                        <span className="min-w-0 flex-1">
                          <span className="block" style={{ color: fresh ? T1 : T2, fontSize: 13, fontWeight: fresh ? 600 : 520, lineHeight: 1.4 }}>
                            {n.text}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2" style={{ color: T3, fontSize: 11.5 }}>
                            {date(n.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {n.action && <span style={{ color: 'var(--acc-fcd34d)', fontWeight: 600 }}>· {w('guestSpace.bell.todo')}</span>}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
