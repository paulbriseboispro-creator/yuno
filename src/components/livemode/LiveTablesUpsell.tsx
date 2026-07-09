// Mode Live — upsell tables VIP : « X tables restantes ce soir », compte en
// temps réel (useTableAvailability écoute déjà table_reservations de
// l'événement). Tap → bottom sheet zones/packs → tunnel TableCheckout
// existant. Zéro nouveau flux de paiement.
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Armchair, X, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTableAvailability } from '@/hooks/useTableAvailability';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLiveMode } from '@/contexts/LiveModeContext';
import { transitions, EASE_DRAWER } from '@/lib/motion';

interface Zone {
  id: string;
  name: string;
  color: string;
  tablesCount: number;
  position: number;
}

interface Pack {
  id: string;
  zoneId: string;
  name: string;
  basePrice: number;
  baseCapacity: number;
}

export function LiveTablesUpsell() {
  const { session } = useLiveMode();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [zones, setZones] = useState<Zone[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [tablesEnabled, setTablesEnabled] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { reservationsByZone } = useTableAvailability(
    tablesEnabled ? session?.eventId : undefined
  );

  const eventId = session?.eventId;
  const venueId = session?.venueId;

  useEffect(() => {
    if (!eventId || !venueId) return;
    const fetchTables = async () => {
      const { data: eventData } = await supabase
        .from('events')
        .select('tables_enabled, tables_mode')
        .eq('id', eventId)
        .maybeSingle();
      if (!eventData?.tables_enabled) return;
      setTablesEnabled(true);

      const isBasic = (eventData as { tables_mode?: string }).tables_mode === 'basic';
      const zoneQuery = isBasic
        ? supabase.from('table_zones').select('*').eq('event_id', eventId)
        : supabase.from('table_zones').select('*').eq('venue_id', venueId);
      const packQuery = isBasic
        ? supabase.from('table_packs').select('*').eq('event_id', eventId).eq('is_active', true)
        : supabase.from('table_packs').select('*').eq('venue_id', venueId).eq('is_active', true);

      const [{ data: zonesData }, { data: packsData }, { data: settings }] = await Promise.all([
        zoneQuery.order('position', { ascending: true }),
        packQuery.order('position', { ascending: true }),
        supabase.from('event_table_settings').select('*').eq('event_id', eventId).maybeSingle(),
      ]);

      // Overrides de prix par soirée (preset ou custom) — miroir d'EventDetails.
      const overrides: Record<string, number> = {};
      if (settings?.preset_id) {
        const { data: preset } = await supabase
          .from('table_pack_presets')
          .select('packs')
          .eq('id', settings.preset_id)
          .maybeSingle();
        ((preset?.packs ?? []) as { packId: string; customPrice: number | null }[]).forEach((pp) => {
          if (pp.customPrice !== null) overrides[pp.packId] = pp.customPrice;
        });
      } else if (settings?.custom_prices) {
        (settings.custom_prices as { packId: string; customPrice: number | null }[]).forEach((cp) => {
          if (cp.customPrice !== null) overrides[cp.packId] = cp.customPrice;
        });
      }

      setZones(
        (zonesData ?? []).map((z: Record<string, unknown>) => ({
          id: z.id as string,
          name: z.name as string,
          color: (z.color as string) || '#E8192C',
          tablesCount: (z.tables_count as number) || 1,
          position: (z.position as number) || 0,
        }))
      );
      setPacks(
        (packsData ?? []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          zoneId: p.zone_id as string,
          name: p.name as string,
          basePrice: overrides[p.id as string] ?? Number(p.base_price),
          baseCapacity: (p.base_capacity as number) || 1,
        }))
      );
    };
    fetchTables();
  }, [eventId, venueId]);

  const zonesWithAvailability = useMemo(
    () =>
      zones
        .map((zone) => ({
          zone,
          remaining: Math.max(0, zone.tablesCount - (reservationsByZone[zone.id] || 0)),
          packs: packs.filter((p) => p.zoneId === zone.id).sort((a, b) => a.basePrice - b.basePrice),
        }))
        .filter((z) => z.packs.length > 0),
    [zones, packs, reservationsByZone]
  );

  const totalRemaining = zonesWithAvailability.reduce((sum, z) => sum + z.remaining, 0);

  if (!tablesEnabled || totalRemaining <= 0 || !session) return null;

  const goToPack = (packId: string) => {
    setSheetOpen(false);
    navigate(`/club/${venueId}/event/${eventId}/table/${packId}`);
  };

  return (
    <>
      <section className="mx-4 mt-4">
        <motion.button
          type="button"
          onClick={() => setSheetOpen(true)}
          whileTap={{ scale: 0.98 }}
          transition={transitions.pressFeedback}
          className="flex w-full items-center gap-3 p-4 text-left"
          style={{
            background: 'linear-gradient(135deg, rgba(232,25,44,0.14), rgba(20,20,20,0.9))',
            border: '1px solid rgba(232,25,44,0.45)',
            borderRadius: 10,
          }}
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'rgba(232,25,44,0.18)' }}
          >
            <Armchair className="h-5 w-5" style={{ color: '#E8192C' }} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block font-display font-bold uppercase text-white"
              style={{ fontSize: 15, letterSpacing: '-0.005em' }}
            >
              {t('live.tablesLeft.title').replace('{count}', String(totalRemaining))}
            </span>
            <span
              className="mt-0.5 block font-mono uppercase"
              style={{ fontSize: 10, letterSpacing: '0.08em', color: '#9A9A9A' }}
            >
              {t('live.tablesLeft.subtitle')}
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0" style={{ color: '#E8192C' }} />
        </motion.button>
      </section>

      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setSheetOpen(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.32, ease: EASE_DRAWER }}
              className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-3xl border-t"
              style={{ background: '#0A0A0A', borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <div className="flex justify-center pt-3 pb-1">
                <div className="h-1 w-10 rounded-full bg-white/15" />
              </div>
              <div className="px-5 pb-8" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>
                <div className="mb-4 flex items-center justify-between">
                  <h3
                    className="font-display font-bold uppercase text-white"
                    style={{ fontSize: 19, letterSpacing: '-0.01em' }}
                  >
                    {t('live.tablesLeft.cta')}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06]"
                  >
                    <X className="h-4 w-4 text-white" />
                  </button>
                </div>

                <div className="space-y-3">
                  {zonesWithAvailability.map(({ zone, remaining, packs: zonePacks }) => (
                    <div
                      key={zone.id}
                      className="p-4"
                      style={{
                        background: '#141414',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 10,
                        opacity: remaining === 0 ? 0.45 : 1,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: zone.color }}
                        />
                        <span
                          className="font-display font-bold uppercase text-white"
                          style={{ fontSize: 14 }}
                        >
                          {zone.name}
                        </span>
                        <span
                          className="ml-auto font-mono font-bold uppercase"
                          style={{
                            fontSize: 10,
                            letterSpacing: '0.08em',
                            color: remaining > 0 && remaining <= 3 ? '#E8192C' : '#9A9A9A',
                          }}
                        >
                          {t('live.tablesLeft.zoneRemaining').replace('{count}', String(remaining))}
                        </span>
                      </div>
                      {remaining > 0 && (
                        <div className="mt-3 space-y-2">
                          {zonePacks.map((pack) => (
                            <button
                              key={pack.id}
                              type="button"
                              onClick={() => goToPack(pack.id)}
                              className="flex w-full items-center justify-between border px-3 py-2.5 text-left transition-all active:scale-[0.98]"
                              style={{
                                background: 'rgba(255,255,255,0.03)',
                                borderColor: 'rgba(255,255,255,0.06)',
                                borderRadius: 8,
                              }}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-bold text-white">
                                  {pack.name}
                                </span>
                                <span
                                  className="font-mono uppercase"
                                  style={{ fontSize: 9, letterSpacing: '0.05em', color: '#9A9A9A' }}
                                >
                                  {pack.baseCapacity} pers.
                                </span>
                              </span>
                              <span className="ml-3 shrink-0 font-mono font-bold text-white" style={{ fontSize: 14 }}>
                                {pack.basePrice}€
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
