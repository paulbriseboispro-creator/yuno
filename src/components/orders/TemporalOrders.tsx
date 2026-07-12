/* ============================================================
   Yuno — Mes Commandes (temporal layout)
   Segmented control: En attente (ce soir) / À venir / Passés
   Three card styles + full-screen QR scan overlay.

   Design system: app PUBLIQUE / éditorial nightlife
   (docs/DESIGN_SYSTEM_PUBLIC.md). Hex durs, mono uppercase tracké,
   radius tranchant, rouge unique #E8192C comme seul accent.
   ============================================================ */
import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { transitions, useReducedMotion } from '@/lib/motion';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { haptics } from '@/lib/haptics';
import {
  Ticket, Crown, Wine, Users, Gift, Bell, QrCode, ArrowRight, CheckCircle2,
  X, CreditCard, User, ChevronLeft, ChevronRight, Clock, type LucideIcon,
} from 'lucide-react';

export type OrderKind = 'ticket' | 'vip' | 'guestlist' | 'reward' | 'drink' | 'waitlist';

export type OrderBucket = 'pending' | 'upcoming' | 'past';

export interface UnifiedOrderEntry {
  id: string;
  kind: OrderKind;
  bucket: OrderBucket;
  title: string;
  venueName: string;
  /** sortable timestamp (ISO) */
  sortAt: number;
  /** short date badge, e.g. "14 JUN" */
  dateLabel?: string;
  /** "23:00" */
  time?: string;
  /** secondary line e.g. "2× billet" / "Carré VIP · 4 pers." */
  subtitle?: string;
  price: number;
  free: boolean;
  scanned?: boolean;
  pastStatus?: 'scanned' | 'used' | 'refunded';
  /** override the CTA label (pending bucket) */
  ctaLabel?: string;
  /** 'pay' swaps the QR icon for a card icon */
  ctaIcon?: 'qr' | 'pay' | 'arrow';
  onAction?: () => void;
}

/* ---- palette publique (hex durs, cf. DESIGN_SYSTEM_PUBLIC.md) ---- */
const RED = '#E8192C';
const CARD = '#141414';
const CARD2 = '#1B1B1E';
const ELEV = '#222226';
const WHITE = '#FFFFFF';
const G1 = '#E5E5E5';
const G2 = '#9A9A9A';
const G3 = '#5A5A5E';
const BORDER = 'rgba(255,255,255,0.08)';
const BORDER_STRONG = 'rgba(255,255,255,0.14)';
const RED_TINT = 'rgba(232,25,44,0.06)';
const RED_SOFT = 'rgba(232,25,44,0.18)';

const FREE_LABEL = 'Gratuit';

/* ---- per-kind icon (couleur = rouge si urgent, sinon gris) ---- */
const KIND: Record<OrderKind, LucideIcon> = {
  ticket: Ticket,
  vip: Crown,
  guestlist: Users,
  reward: Gift,
  drink: Wine,
  waitlist: Bell,
};

/* ---- type badge (icon tile éditorial, monochrome) ----
   `imageUrl` : affiche de la soirée dans une tuile 1:1 — image ENTIÈRE centrée
   (contain, jamais recadrée/zoomée) sur un fond flouté de la même affiche.
   L'icône reste rendue dessous en fallback si l'image ne charge pas.
   `kindBadge` : pastille d'angle avec l'icône du type, pour que la nature de
   la commande (boisson vs billet) reste lisible même quand l'affiche recouvre
   l'icône principale. */
function TypeBadge({ kind, size = 50, accent = false, imageUrl, kindBadge = false }: { kind: OrderKind; size?: number; accent?: boolean; imageUrl?: string; kindBadge?: boolean }) {
  const Icon = KIND[kind];
  const optimized = imageUrl ? getOptimizedImageUrl(imageUrl, { width: 128, quality: 75 }) : undefined;
  return (
    <div
      style={{
        width: size, height: size, flex: 'none', borderRadius: 8,
        display: 'grid', placeItems: 'center', position: 'relative',
        background: accent ? RED_TINT : CARD2,
        border: `1px solid ${accent ? RED_SOFT : BORDER_STRONG}`,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, borderRadius: 7, overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
        <Icon style={{ width: size * 0.42, height: size * 0.42, color: accent ? RED : G1 }} strokeWidth={1.9} />
        {optimized && (
          <>
            {/* fond : la même affiche floutée en cover — comble les marges du contain */}
            <img
              src={optimized}
              alt=""
              aria-hidden
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', filter: 'blur(6px) brightness(0.55)', transform: 'scale(1.3)' }}
            />
            {/* premier plan : l'affiche entière, centrée, sans zoom */}
            <img
              src={optimized}
              alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
            />
          </>
        )}
      </div>
      {kindBadge && imageUrl && (
        <div
          style={{
            position: 'absolute', right: -5, bottom: -5, width: Math.round(size * 0.44), height: Math.round(size * 0.44),
            borderRadius: 6, display: 'grid', placeItems: 'center',
            background: '#0A0A0A', border: `1px solid ${BORDER_STRONG}`,
          }}
        >
          <Icon style={{ width: size * 0.24, height: size * 0.24, color: RED }} strokeWidth={2.1} />
        </div>
      )}
    </div>
  );
}

/* ================================================================
   SEGMENTED CONTROL — 3 états
   ================================================================ */
export function SegControl({
  active, setActive, counts, labels,
}: {
  active: OrderBucket;
  setActive: (b: OrderBucket) => void;
  counts: Record<OrderBucket, number>;
  labels: Record<OrderBucket, string>;
}) {
  const segs: OrderBucket[] = ['pending', 'upcoming', 'past'];
  return (
    <div
      className="flex gap-1 p-1"
      style={{ background: CARD, border: `1px solid ${BORDER_STRONG}`, borderRadius: 10 }}
    >
      {segs.map((id) => {
        const on = id === active;
        const hot = id !== 'past';
        return (
          <button
            key={id}
            onClick={() => { if (id !== active) haptics.selection(); setActive(id); }}
            className="flex-1 flex flex-col items-center gap-0.5 border-0 cursor-pointer"
            style={{
              padding: '8px 4px 7px', borderRadius: 7,
              transition: 'background .18s, box-shadow .18s',
              background: on ? (hot ? RED : ELEV) : 'transparent',
              boxShadow: on && hot ? '0 6px 18px -8px rgba(232,25,44,0.55)' : 'none',
            }}
          >
            <span
              className="font-display leading-none"
              style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em', color: on ? '#fff' : G2 }}
            >
              {counts[id]}
            </span>
            <span
              className="font-mono leading-none uppercase"
              style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.08em', color: on ? 'rgba(255,255,255,.82)' : G3 }}
            >
              {labels[id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- chip de type inline (icône + libellé) — différencie boisson / billet /
   VIP / guest list d'un coup d'œil sur les cartes de liste ---- */
export type KindLabels = Partial<Record<OrderKind, string>>;

function KindChip({ kind, label }: { kind: OrderKind; label?: string }) {
  if (!label) return null;
  const Icon = KIND[kind];
  return (
    <span className="inline-flex items-center gap-1 font-mono uppercase" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.1em', color: RED, flexShrink: 0 }}>
      <Icon style={{ width: 10, height: 10 }} strokeWidth={2.2} />
      {label}
    </span>
  );
}

/* ================================================================
   CARD — EN ATTENTE (ce soir, urgent)
   ================================================================ */
export function PendingCard({ o, tonightLabel, index = 0, kindLabels }: { o: UnifiedOrderEntry; tonightLabel: string; index?: number; kindLabels?: KindLabels }) {
  const CtaIcon = o.ctaIcon === 'pay' ? CreditCard : QrCode;
  const kindLabel = kindLabels?.[o.kind];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 12px 28px -18px rgba(0,0,0,.8)',
      }}
    >
      {/* Bandeau urgence */}
      <div
        className="flex items-center gap-2"
        style={{ padding: '7px 12px', background: RED_TINT, borderBottom: `1px solid ${RED_SOFT}` }}
      >
        <span
          className="yuno-qr-pulse"
          style={{ width: 5, height: 5, borderRadius: '50%', background: RED, flexShrink: 0 }}
        />
        <span className="font-mono flex-1 uppercase" style={{ fontSize: 9.5, fontWeight: 600, color: RED, letterSpacing: '.12em' }}>
          {tonightLabel}{o.time ? ` · ${o.time}` : ''}
        </span>
        <span className="font-mono truncate uppercase" style={{ fontSize: 9.5, color: G2, letterSpacing: '.06em', maxWidth: 120 }}>
          {o.venueName}
        </span>
      </div>

      {/* Contenu */}
      <div className="flex items-center gap-3" style={{ padding: '11px 12px 9px' }}>
        <TypeBadge kind={o.kind} size={42} accent />
        <div className="flex-1 min-w-0">
          <div className="font-display uppercase truncate" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.12, letterSpacing: '-.005em', color: WHITE, marginBottom: 4 }}>{o.title}</div>
          {(o.subtitle || kindLabel) && (
            <div className="flex items-center gap-1.5 min-w-0">
              <KindChip kind={o.kind} label={kindLabel} />
              {o.subtitle && (
                <span className="font-mono truncate" style={{ fontSize: 10.5, color: G2, lineHeight: 1.4 }}>{kindLabel ? '· ' : ''}{o.subtitle}</span>
              )}
            </div>
          )}
        </div>
        <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, color: o.free ? G1 : RED }}>
          {o.free ? FREE_LABEL : `${o.price}€`}
        </span>
      </div>

      {/* CTA pleine largeur — bouton d'affiche tranchant */}
      {o.onAction && (
        <div style={{ padding: '0 12px 12px' }}>
          <button
            onClick={o.onAction}
            className="w-full flex items-center justify-center gap-2 border-0 cursor-pointer font-mono font-bold uppercase"
            style={{ padding: '11px 12px', background: RED, color: '#fff', fontSize: 11, letterSpacing: '.1em', borderRadius: 3, boxShadow: '0 10px 28px -12px rgba(232,25,44,.6)' }}
          >
            <CtaIcon style={{ width: 14, height: 14 }} strokeWidth={2} />
            {o.ctaLabel}
            <ArrowRight style={{ width: 13, height: 13, color: 'rgba(255,255,255,.55)' }} strokeWidth={2} />
          </button>
        </div>
      )}
    </motion.div>
  );
}

/* ================================================================
   CARD — À VENIR (futur, calme)
   ================================================================ */
export function UpcomingCard({ o, index = 0, kindLabels }: { o: UnifiedOrderEntry; index?: number; kindLabels?: KindLabels }) {
  const [d0, d1] = (o.dateLabel || ' ').split(' ');
  const isNav = o.kind === 'waitlist';
  const kindLabel = kindLabels?.[o.kind];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}
      className="flex items-center gap-3"
      style={{
        padding: '11px 12px',
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        boxShadow: '0 10px 24px -18px rgba(0,0,0,.8)',
      }}
    >
      {/* Badge date typographique */}
      <div
        className="flex flex-col items-center justify-center"
        style={{ width: 46, flex: 'none', gap: 2, background: CARD2, border: `1px solid ${BORDER_STRONG}`, borderRadius: 8, padding: '7px 4px' }}
      >
        <span className="font-display" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, letterSpacing: '-.02em', color: WHITE }}>{d0}</span>
        <span className="font-mono uppercase" style={{ fontSize: 8, letterSpacing: '.12em', color: G2 }}>{d1}</span>
      </div>

      {/* Infos */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0" style={{ marginBottom: 3 }}>
          <KindChip kind={o.kind} label={kindLabel} />
          <span className="font-mono uppercase truncate" style={{ fontSize: 9.5, color: G2, letterSpacing: '.06em' }}>{kindLabel ? '· ' : ''}{o.venueName}</span>
        </div>
        <div className="font-display uppercase truncate" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.12, letterSpacing: '-.005em', color: WHITE, marginBottom: 4 }}>{o.title}</div>
        <div className="flex items-center gap-1.5">
          {o.time && <span className="font-mono" style={{ fontSize: 10.5, color: G2 }}>{o.time}</span>}
          {o.subtitle && <span className="font-mono truncate" style={{ fontSize: 10.5, color: G3 }}>{o.time ? '· ' : ''}{o.subtitle}</span>}
        </div>
      </div>

      {/* Prix + bouton */}
      <div className="flex flex-col items-end gap-2">
        {!isNav && (
          <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: o.free ? G1 : WHITE }}>
            {o.free ? FREE_LABEL : `${o.price}€`}
          </span>
        )}
        {o.onAction && (
          <button
            onClick={o.onAction}
            className="grid place-items-center cursor-pointer"
            style={{ width: 34, height: 34, borderRadius: 8, background: RED_TINT, border: `1px solid ${RED_SOFT}` }}
          >
            {isNav
              ? <ArrowRight style={{ width: 16, height: 16, color: RED }} strokeWidth={1.9} />
              : <QrCode style={{ width: 16, height: 16, color: RED }} strokeWidth={1.8} />}
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ================================================================
   CARD — PASSÉ (archivé, utilisé)
   ================================================================ */
export function PastCard({ o, statusLabels, index = 0, kindLabels }: { o: UnifiedOrderEntry; statusLabels: Record<'scanned' | 'used' | 'refunded', string>; index?: number; kindLabels?: KindLabels }) {
  const status = o.pastStatus || 'used';
  const kindLabel = kindLabels?.[o.kind];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}
      className="flex items-center gap-3"
      style={{ padding: '10px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, opacity: 0.5 }}
    >
      <div
        className="grid place-items-center"
        style={{ width: 40, height: 40, flex: 'none', borderRadius: 8, background: CARD2, border: `1px solid ${BORDER_STRONG}` }}
      >
        <CheckCircle2 style={{ width: 18, height: 18, color: status === 'refunded' ? RED : G3 }} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-mono uppercase truncate" style={{ fontSize: 9.5, color: G2, letterSpacing: '.06em', marginBottom: 3 }}>
          {kindLabel ? `${kindLabel} · ` : ''}{o.venueName}{o.dateLabel ? ` · ${o.dateLabel}` : ''}
        </div>
        <div className="font-display uppercase truncate" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.12, letterSpacing: '-.005em', color: G1 }}>{o.title}</div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: '.06em', color: status === 'refunded' ? RED : G2 }}>{statusLabels[status]}</span>
        <span className="font-mono" style={{ fontSize: 11.5, fontWeight: 700, color: G2 }}>{o.free ? '0€' : `${o.price}€`}</span>
      </div>
    </motion.div>
  );
}

/* ---- scanner corner ---- */
function ScanCorner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const bw = 2.5, sz = 22, off = -7;
  const c = RED;
  const top = pos[0] === 't';
  const left = pos[1] === 'l';
  return (
    <div
      style={{
        position: 'absolute', width: sz, height: sz, pointerEvents: 'none',
        [top ? 'top' : 'bottom']: off, [left ? 'left' : 'right']: off,
        borderTop: top ? `${bw}px solid ${c}` : 'none',
        borderBottom: !top ? `${bw}px solid ${c}` : 'none',
        borderLeft: left ? `${bw}px solid ${c}` : 'none',
        borderRight: !left ? `${bw}px solid ${c}` : 'none',
        borderRadius: top && left ? '3px 0 0 0' : top && !left ? '0 3px 0 0' : !top && left ? '0 0 0 3px' : '0 0 3px 0',
      } as React.CSSProperties}
    />
  );
}

/* ================================================================
   QR OVERLAY — grande QR + ligne de scan + infos en bas
   ================================================================ */
export interface QRSlide {
  qrImage?: string;
  /** attendee name shown above the QR */
  caption?: string;
  scanned?: boolean;
}

/** A quick-action tile rendered in the overlay's bottom action bar. */
export interface QRAction {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** highlight in red (primary action, e.g. directions) */
  accent?: boolean;
}

export function OrderQROverlay({
  kind, title, venueName, qrImage, idLabel, scanned, footer, labels, onClose, slides, actions, whenLabel, instant, posterUrl, posterThumb, kindLabel,
}: {
  kind: OrderKind;
  title: string;
  venueName: string;
  qrImage?: string;
  idLabel?: string;
  scanned?: boolean;
  /** extra info rows shown above the action bar */
  footer?: React.ReactNode;
  labels: { scanThisQR: string; shareThisQR?: string; valid: string; scanned: string };
  onClose: () => void;
  /** optional per-attendee carousel — when 2+ entries, shows swipe + dots */
  slides?: QRSlide[];
  /** interactive quick actions (directions, event page, calendar…) */
  actions?: QRAction[];
  /** date + time line shown inside the info card, e.g. "SAT 14 JUN · 23:00" */
  whenLabel?: string;
  /** skip the fade-in mount animation (used when restored from history) */
  instant?: boolean;
  /** event poster used as a blurred full-screen colour backdrop behind the QR */
  posterUrl?: string;
  /** event poster shown as a 1:1 thumbnail in the info card (replaces the kind icon) */
  posterThumb?: string;
  /** localized kind label ("Billet", "Boisson"…) — shown as the header chip so a
      drink QR never looks identical to a ticket QR */
  kindLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const reduceMotion = useReducedMotion();

  const total = slides && slides.length > 0 ? slides.length : 1;
  const active = slides && slides.length > 0 ? slides[Math.min(index, slides.length - 1)] : undefined;
  const activeQr = active ? active.qrImage : qrImage;
  const activeScanned = active ? active.scanned : scanned;
  const caption = active?.caption;
  const hasCarousel = total > 1;
  const KindIcon = KIND[kind];

  // Haptique success UNE fois quand le QR devient visible — le « billet qui
  // sort de la poche ». Pas lors d'une restauration d'historique (`instant`).
  const hapticFired = useRef(false);
  useEffect(() => {
    if (activeQr && !hapticFired.current) {
      hapticFired.current = true;
      if (!instant) haptics.success();
    }
  }, [activeQr, instant]);

  const goNext = () => setIndex(i => Math.min(i + 1, total - 1));
  const goPrev = () => setIndex(i => Math.max(i - 1, 0));
  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    if (diff > 50) goNext();
    else if (diff < -50) goPrev();
  };

  return (
    <motion.div
      initial={instant ? false : { opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: '#0A0A0A' }}
    >
      {/* Fond : affiche de la soirée floutée plein écran → dégradé des couleurs
          de l'affiche. Voile sombre par-dessus pour garder le QR + textes lisibles. */}
      {posterUrl && (
        <>
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0, zIndex: 0,
              backgroundImage: `url(${getOptimizedImageUrl(posterUrl, { width: 480, quality: 50 })})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(80px) saturate(1.5)',
              transform: 'scale(1.25)',
              opacity: 0.6,
            }}
          />
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0, zIndex: 0,
              background:
                'radial-gradient(120% 90% at 50% 0%, rgba(10,10,10,0.35) 0%, rgba(10,10,10,0.72) 55%, rgba(10,10,10,0.92) 100%)',
            }}
          />
        </>
      )}

      {/* Barre supérieure — sous la safe-area (encoche/heure), jamais dessous */}
      <div
        className="flex items-center justify-between w-full max-w-md mx-auto"
        style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 20px 8px', position: 'relative', zIndex: 1 }}
      >
        <button
          onClick={onClose}
          className="grid place-items-center cursor-pointer"
          style={{ width: 36, height: 36, borderRadius: 2, background: CARD, border: `1px solid ${BORDER_STRONG}`, color: '#fff' }}
        >
          <X style={{ width: 16, height: 16 }} strokeWidth={2} />
        </button>
        {/* Chip d'identité : type de commande (billet / boisson / VIP…) */}
        {kindLabel ? (
          <span
            className="flex items-center gap-1.5 font-mono uppercase"
            style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '.16em', color: RED,
              padding: '6px 12px', borderRadius: 999, background: RED_TINT, border: `1px solid ${RED_SOFT}`,
            }}
          >
            <KindIcon style={{ width: 12, height: 12 }} strokeWidth={2.2} />
            {kindLabel}
          </span>
        ) : (
          <span className="font-mono uppercase" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.2em', color: RED }}>{labels.scanThisQR}</span>
        )}
        <div style={{ width: 36 }} />
      </div>

      {/* Zone QR */}
      <div className="flex-1 flex flex-col items-center justify-center relative w-full max-w-md mx-auto" style={{ padding: '0 32px', zIndex: 1 }}>
        <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,25,44,0.15) 0%, transparent 70%)' }} />

        {/* Nom du participant (carousel billets) */}
        {caption && (
          <div className="flex items-center justify-center gap-1.5" style={{ position: 'relative', marginBottom: 18 }}>
            <User style={{ width: 14, height: 14, color: G2 }} strokeWidth={2} />
            <span className="font-mono uppercase" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', color: G1 }}>{caption}</span>
            {activeScanned && <CheckCircle2 style={{ width: 14, height: 14, color: '#10B981' }} strokeWidth={2} />}
          </div>
        )}

        <div
          style={{ position: 'relative' }}
          onTouchStart={e => { touchStartX.current = e.touches[0].clientX; touchEndX.current = e.touches[0].clientX; }}
          onTouchMove={e => { touchEndX.current = e.touches[0].clientX; }}
          onTouchEnd={handleTouchEnd}
        >
          {/* Entrée célébratoire du QR (spring overshoot) — un billet qui sort
              de la poche, pas un simple fondu. instant/reduced → opacité seule. */}
          <motion.div
            initial={instant ? false : reduceMotion ? { opacity: 0 } : { scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={reduceMotion ? transitions.pop : transitions.celebrate}
            style={{ background: '#fff', borderRadius: 6, padding: 16, position: 'relative', boxShadow: '0 32px 70px -20px rgba(0,0,0,.95), 0 0 0 1px rgba(255,255,255,.05)' }}
          >
            {activeQr
              ? <img src={activeQr} alt="QR" style={{ display: 'block', width: 216, height: 216 }} />
              : <div style={{ width: 216, height: 216, display: 'grid', placeItems: 'center' }}><QrCode style={{ width: 72, height: 72, color: '#bbb' }} /></div>}
          </motion.div>
          <ScanCorner pos="tl" /><ScanCorner pos="tr" /><ScanCorner pos="bl" /><ScanCorner pos="br" />
        </div>

        {/* Consigne de scan — sous le QR quand le chip de type occupe le header */}
        {kindLabel && (
          <span className="font-mono uppercase" style={{ position: 'relative', marginTop: 20, fontSize: 9.5, fontWeight: 600, letterSpacing: '.2em', color: G2 }}>
            {labels.scanThisQR}
          </span>
        )}

        {/* Navigation carousel (flèches + points) */}
        {hasCarousel && (
          <div className="flex items-center justify-center gap-4" style={{ position: 'relative', marginTop: 22 }}>
            <button
              onClick={goPrev}
              disabled={index === 0}
              className="grid place-items-center cursor-pointer"
              style={{ width: 30, height: 30, borderRadius: 999, background: CARD, border: `1px solid ${BORDER_STRONG}`, color: index === 0 ? G3 : G1, opacity: index === 0 ? 0.4 : 1 }}
            >
              <ChevronLeft style={{ width: 16, height: 16 }} strokeWidth={2} />
            </button>
            <div className="flex items-center gap-1.5">
              {slides!.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIndex(i)}
                  className="cursor-pointer"
                  style={{ height: 6, width: i === index ? 20 : 6, borderRadius: 999, border: 'none', background: i === index ? RED : 'rgba(255,255,255,0.20)', transition: 'all .2s' }}
                />
              ))}
            </div>
            <button
              onClick={goNext}
              disabled={index === total - 1}
              className="grid place-items-center cursor-pointer"
              style={{ width: 30, height: 30, borderRadius: 999, background: CARD, border: `1px solid ${BORDER_STRONG}`, color: index === total - 1 ? G3 : G1, opacity: index === total - 1 ? 0.4 : 1 }}
            >
              <ChevronRight style={{ width: 16, height: 16 }} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

      {/* Infos bas — remonté au-dessus de la safe-area (home indicator) */}
      <div className="w-full max-w-md mx-auto" style={{ padding: '16px 24px calc(env(safe-area-inset-bottom, 0px) + 24px)', position: 'relative', zIndex: 1 }}>
        {idLabel && (
          <div className="font-mono text-center uppercase" style={{ fontSize: 10.5, letterSpacing: '.14em', color: G2, marginBottom: 12 }}>
            {idLabel}
          </div>
        )}
        <div
          className="flex items-center gap-3"
          style={{ background: CARD, border: `1px solid ${BORDER_STRONG}`, borderRadius: 8, padding: '10px 12px', marginBottom: footer ? 10 : 12 }}
        >
          <TypeBadge kind={kind} size={44} imageUrl={posterThumb} kindBadge />
          <div className="flex-1 min-w-0">
            <div className="font-mono uppercase" style={{ fontSize: 9.5, color: G2, letterSpacing: '.06em', marginBottom: 3 }}>{venueName}</div>
            <div className="font-display uppercase truncate" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.12, letterSpacing: '-.005em', color: WHITE }}>{title}</div>
            {whenLabel && (
              <div className="flex items-center gap-1.5" style={{ marginTop: 5 }}>
                <Clock style={{ width: 11, height: 11, color: G3, flexShrink: 0 }} strokeWidth={2} />
                <span className="font-mono uppercase truncate" style={{ fontSize: 9.5, color: G2, letterSpacing: '.06em' }}>{whenLabel}</span>
              </div>
            )}
          </div>
          <span
            className="font-mono uppercase self-start"
            style={{
              fontSize: 9.5, fontWeight: 600, letterSpacing: '.1em', padding: '4px 9px', borderRadius: 999, flexShrink: 0,
              color: activeScanned ? G2 : RED,
              background: activeScanned ? 'rgba(255,255,255,0.06)' : RED_TINT,
              border: `1px solid ${activeScanned ? BORDER_STRONG : RED_SOFT}`,
            }}
          >
            {activeScanned ? labels.scanned : labels.valid}
          </span>
        </div>

        {footer}

        {/* Barre d'actions — wallet / itinéraire / soirée / agenda */}
        {actions && actions.length > 0 && (
          <div
            style={{
              display: 'grid', gridTemplateColumns: `repeat(${actions.length}, 1fr)`, gap: 8,
              marginTop: footer ? 10 : 0,
            }}
          >
            {actions.map((a, i) => (
              <motion.button
                key={i}
                whileTap={{ scale: 0.95 }}
                onClick={a.onClick}
                className="flex flex-col items-center justify-start gap-1.5 cursor-pointer border-0"
                style={{
                  padding: '11px 4px 10px', borderRadius: 10, minHeight: 62,
                  background: a.accent ? RED_TINT : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${a.accent ? RED_SOFT : BORDER_STRONG}`,
                }}
              >
                <a.icon style={{ width: 18, height: 18, color: a.accent ? RED : G1 }} strokeWidth={1.9} />
                <span
                  className="font-mono uppercase text-center"
                  style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '.05em', lineHeight: 1.2, color: a.accent ? RED : G2 }}
                >
                  {a.label}
                </span>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
