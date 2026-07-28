import { useMemo } from 'react';
import { Crown, Users, TrendingDown, Wallet, Plus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { haptics } from '@/lib/haptics';
import {
  ServiceReservation, ServiceMenuItem, TableServiceInfo, ComposerSection,
  menuSection, fmtEuro,
} from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.085)';
const RED = '#E8192C';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

const SECTION_ORDER: ComposerSection[] = ['bottles', 'softs', 'extras'];
const SECTION_KEY: Record<ComposerSection, string> = {
  bottles: 'vipnight.bottles',
  softs: 'vipnight.softsMixers',
  extras: 'vipnight.extras',
};

interface VipLivePanelProps {
  reservations: ServiceReservation[];
  serviceInfo: Map<string, TableServiceInfo>;
  menuItems: ServiceMenuItem[];
  isPlanning: boolean;
  disabled: boolean;
  /** Démarre une commande : ouvre le choix de table, puis le composeur
      (pré-rempli avec l'article si un id est passé). */
  onStartOrder: (seedItemId?: string | null) => void;
}

/**
 * Ce qui vit SOUS le plan de salle en direct : le pouls du service (chiffres qui
 * comptent vraiment pour l'hôte VIP — pas les entrées porte) et la carte VIP en
 * référence rapide (« combien la Grey Goose ? » sans ouvrir de commande). En
 * préparation, seule la carte s'affiche : le pouls n'a de sens qu'en service.
 */
export function VipLivePanel({ reservations, serviceInfo, menuItems, isPlanning, disabled, onStartOrder }: VipLivePanelProps) {
  const { t } = useLanguage();

  const pulse = useMemo(() => {
    let active = 0, arrivedGuests = 0, underMin = 0, creditLeft = 0, consumed = 0;
    reservations.forEach(r => {
      const info = serviceInfo.get(r.id);
      if (!info) return;
      const seated = r.vipStatus === 'placed' || r.vipStatus === 'active';
      if (r.vipStatus === 'active') active++;
      if (seated) {
        creditLeft += info.creditLeft;
        consumed += info.consumed;
        if (info.minimum > 0 && !info.minReached) underMin++;
      }
      if (r.hasArrived && !['no_show', 'denied', 'finished'].includes(r.vipStatus)) {
        arrivedGuests += r.guestCount;
      }
    });
    return { active, arrivedGuests, underMin, creditLeft, consumed };
  }, [reservations, serviceInfo]);

  const grouped = useMemo(() => {
    const g: Record<ComposerSection, ServiceMenuItem[]> = { bottles: [], softs: [], extras: [] };
    menuItems.forEach(m => g[menuSection(m.category)].push(m));
    return g;
  }, [menuItems]);

  return (
    <div className="space-y-3">
      {!isPlanning && (
        <div className="rounded-2xl p-3.5" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
          <p className="mb-2.5" style={{ color: T2, fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('vipnight.livePulse')}
          </p>
          <div className="grid grid-cols-4 gap-2">
            <PulseTile icon={Crown} label={t('vipnight.pulseActive')} value={pulse.active} />
            <PulseTile icon={Users} label={t('vipnight.pulseArrived')} value={pulse.arrivedGuests} />
            <PulseTile icon={TrendingDown} label={t('vipnight.pulseUnderMin')} value={pulse.underMin} hot={pulse.underMin > 0} />
            <PulseTile icon={Wallet} label={t('vipnight.pulseCreditLeft')} value={fmtEuro(pulse.creditLeft)} />
          </div>
        </div>
      )}

      {menuItems.length > 0 && (
        <div className="rounded-2xl p-3.5" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p style={{ color: T2, fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('vipnight.menuTitle')}
            </p>
            <button
              type="button"
              disabled={disabled}
              onClick={() => { haptics.selection(); onStartOrder(null); }}
              className="flex min-h-[32px] cursor-pointer items-center gap-1.5 rounded-full px-3 transition-transform active:scale-95 disabled:opacity-40"
              style={{ background: RED, color: '#fff', fontSize: 12, fontWeight: 700 }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('vipnight.newOrder')}
            </button>
          </div>
          <p className="mb-2" style={{ color: T3, fontSize: 11 }}>{t('vipnight.menuTapHint')}</p>
          <div className="space-y-3">
            {SECTION_ORDER.map(section => {
              const items = grouped[section];
              if (items.length === 0) return null;
              return (
                <div key={section}>
                  <p className="mb-1.5 px-0.5" style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {t(SECTION_KEY[section])}
                  </p>
                  <div className="space-y-1">
                    {items.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => { haptics.selection(); onStartOrder(m.id); }}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all duration-150 active:scale-[0.99] disabled:opacity-40"
                        style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}
                      >
                        <span className="min-w-0 flex-1 truncate" style={{ color: T1, fontSize: 12.5, fontWeight: 500 }}>
                          {m.name}
                          {m.volumeCl ? <span style={{ color: T3, fontSize: 11 }}> · {m.volumeCl}cl</span> : null}
                        </span>
                        <span className="shrink-0 tabular-nums" style={{ color: m.price === 0 ? T3 : T1, fontSize: 12.5, fontWeight: 700 }}>
                          {m.price === 0 ? t('vipnight.included') : fmtEuro(m.price)}
                        </span>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.35)' }}>
                          <Plus className="h-3.5 w-3.5" style={{ color: '#FCA5A5' }} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PulseTile({
  icon: Icon,
  label,
  value,
  hot,
}: {
  icon: typeof Crown;
  label: string;
  value: number | string;
  hot?: boolean;
}) {
  return (
    <div className="rounded-xl p-2.5" style={{ background: hot ? 'rgba(232,25,44,0.07)' : C_FAINT, border: `1px solid ${hot ? 'rgba(232,25,44,0.3)' : BORDER}` }}>
      <div className="mb-1 flex items-center gap-1">
        <Icon className="h-3 w-3 flex-none" style={{ color: hot ? RED : T3 }} />
        <span className="truncate" style={{ color: T3, fontSize: 9.5 }}>{label}</span>
      </div>
      <p className="tabular-nums" style={{ color: hot ? '#FF5C63' : T1, fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>{value}</p>
    </div>
  );
}
