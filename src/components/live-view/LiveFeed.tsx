import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardList, Eye, Sofa, Ticket, Wine } from 'lucide-react';
import type { LiveFeedItem } from '@/lib/liveView';
import { fmtEuro, fmtInt, placeLabel, timeAgoLabel } from '@/lib/liveView';
import { LV, Mono } from './liveViewUi';

const ICONS = { visit: Eye, ticket: Ticket, table: Sofa, guestlist: ClipboardList, order: Wine } as const;

const KNOWN_SOURCES = new Set(['direct', 'social', 'search', 'email', 'qr', 'paid_social', 'paid_search', 'paid', 'affiliate', 'referral', 'internal', 'promoter']);

function headline(item: LiveFeedItem, t: (k: string) => string, language: string): string {
  switch (item.kind) {
    case 'visit': return item.returning ? t('lv.item.visitReturning') : t('lv.item.visit');
    case 'ticket': {
      const n = Math.max(1, item.qty ?? 1);
      return (n > 1 ? t('lv.item.tickets') : t('lv.item.ticket')).replace('{n}', fmtInt(n, language));
    }
    case 'table': return t('lv.item.table');
    case 'guestlist': return t('lv.item.guestlist');
    case 'order': return t('lv.item.order');
  }
}

function details(item: LiveFeedItem, t: (k: string) => string, language: string): string[] {
  const parts: string[] = [];
  if (item.kind === 'table' && item.qty) parts.push(t('lv.item.tableGuests').replace('{n}', fmtInt(item.qty, language)));
  if (item.kind === 'order' && item.qty) parts.push(t('lv.item.orderItems').replace('{n}', fmtInt(item.qty, language)));
  if (item.source) parts.push(KNOWN_SOURCES.has(item.source) ? t(`lv.source.${item.source}`) : item.source);
  if (item.device && ['mobile', 'desktop', 'tablet'].includes(item.device)) parts.push(t(`lv.device.${item.device}`));
  return parts;
}

export function LiveFeed({ items, freshIds, nowMs, t, language, reducedMotion }: {
  items: LiveFeedItem[];
  freshIds: Set<string>;
  nowMs: number;
  t: (k: string) => string;
  language: string;
  reducedMotion: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="m-0 text-[13px] leading-relaxed" style={{ color: LV.gray2 }}>{t('lv.feed.empty')}</p>
    );
  }
  return (
    <ul className="m-0 list-none p-0" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          const sale = item.kind !== 'visit';
          const fresh = freshIds.has(item.id);
          const place = placeLabel(item, t('lv.unknownPlace'));
          const meta = [place, ...details(item, t, language)];
          return (
            <motion.li
              key={item.id}
              layout={reducedMotion ? false : 'position'}
              initial={fresh && !reducedMotion ? { opacity: 0, y: -10 } : { opacity: 1, y: 0 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="relative flex items-start gap-3 py-3"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              {/* Filet rouge de fraîcheur : 8 s après l'apparition */}
              <span
                aria-hidden="true"
                className="absolute left-[-20px] top-3 bottom-3 w-[2px]"
                style={{ background: LV.red, opacity: fresh ? 1 : 0, transition: `opacity 1.2s ${LV.ease}` }}
              />
              <span
                className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center"
                style={{
                  borderRadius: 2,
                  background: sale ? 'rgba(232,25,44,0.10)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${sale ? 'rgba(232,25,44,0.32)' : LV.border}`,
                  color: sale ? LV.red : LV.gray2,
                }}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="m-0 truncate text-[13.5px] font-semibold" style={{ color: sale ? LV.white : LV.gray1, letterSpacing: '-0.005em' }}>
                    {headline(item, t, language)}
                  </p>
                  {item.amount != null && item.amount > 0 && (
                    <span className="flex-none font-display font-bold tabular-nums" style={{ color: LV.red, fontSize: 14, letterSpacing: '-0.02em' }}>
                      {fmtEuro(item.amount, language)}
                    </span>
                  )}
                </div>
                {item.eventTitle && (
                  <p className="m-0 mt-0.5 truncate text-[12px]" style={{ color: LV.gray2 }}>{item.eventTitle}</p>
                )}
                <Mono className="mt-1 block truncate" color={LV.gray3} size={9.5} tracking="0.10em">
                  {meta.join(' · ')} · {timeAgoLabel(item.ts, nowMs, t)}
                </Mono>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
