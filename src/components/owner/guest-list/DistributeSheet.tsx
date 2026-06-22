import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Music, Megaphone, Building2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { GuestListTemplate, TargetMode } from '@/hooks/useGuestListTemplates';
import { RED, T1, T2, T3, BORDER, F_BORDER, INNER_BG, TILE_BG, CARD_BG, CARD_SHADOW } from './ui';

interface Target { id: string; name: string }

interface Props {
  tpl: GuestListTemplate;
  holderType: 'dj' | 'promoter';
  mode: TargetMode;
  ctx: { isOrganizerScope: boolean; venueId: string | null; organizerUserId: string | null };
  eventId: string;
  existingIds: string[];
  t: (key: string) => string;
  onClose: () => void;
  onConfirmTargets: (items: { id: string; label: string }[]) => Promise<void>;
  onConfirmAgency: (name: string) => Promise<void>;
}

/**
 * Distributes a delegated preset to its targets, LOCKED to the mode set in the template:
 * 'all' (everyone in the lineup / every active promoter), 'select' (pick), or 'agency'
 * (promoter only — one global list delegated to a named agency).
 */
export function DistributeSheet({ tpl, holderType, mode, ctx, eventId, existingIds, t, onClose, onConfirmTargets, onConfirmAgency }: Props) {
  const [loading, setLoading] = useState(mode !== 'agency');
  const [targets, setTargets] = useState<Target[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [agencyName, setAgencyName] = useState('');
  const [saving, setSaving] = useState(false);
  const Icon = holderType === 'dj' ? Music : Megaphone;

  useEffect(() => {
    if (mode === 'agency') return;
    (async () => {
      setLoading(true);
      let fresh: Target[] = [];
      if (holderType === 'dj') {
        // 'all' = this event's line-up ; 'select' = the whole club's DJ roster (every DJ
        // who's been on the venue's / organizer's events), so you can really pick anyone.
        let eventIds = [eventId];
        if (mode === 'select') {
          const evQ = supabase.from('events').select('id');
          const { data: evs } = ctx.isOrganizerScope ? await evQ.eq('organizer_user_id', ctx.organizerUserId as string) : await evQ.eq('venue_id', ctx.venueId as string);
          eventIds = (evs || []).map(e => e.id);
        }
        if (eventIds.length) {
          const [{ data: ed }, { data: ds }] = await Promise.all([
            supabase.from('event_djs').select('dj_id').in('event_id', eventIds),
            supabase.from('dj_sets').select('dj_id').in('event_id', eventIds),
          ]);
          const ids = [...new Set([...(ed || []).map(r => r.dj_id), ...(ds || []).map(r => r.dj_id)].filter(Boolean))].filter(id => !existingIds.includes(id as string)) as string[];
          if (ids.length) {
            const { data: djs } = await supabase.from('djs').select('id, stage_name, first_name, last_name').in('id', ids);
            fresh = (djs || []).map(d => ({ id: d.id, name: d.stage_name || `${d.first_name || ''} ${d.last_name || ''}`.trim() || 'DJ' }));
          }
        }
      } else {
        const q = supabase.from('promoters').select('id, user_id, promo_code').eq('is_active', true);
        const { data: rows } = ctx.isOrganizerScope ? await q.eq('organizer_user_id', ctx.organizerUserId as string) : await q.eq('venue_id', ctx.venueId as string);
        const freshRows = (rows || []).filter(p => !existingIds.includes(p.id));
        const { data: profiles } = freshRows.length ? await supabase.from('profiles').select('id, first_name, last_name').in('id', freshRows.map(p => p.user_id)) : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };
        const nameMap = new Map((profiles || []).map(p => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
        fresh = freshRows.map(p => ({ id: p.id, name: nameMap.get(p.user_id) || p.promo_code }));
      }
      setTargets(fresh);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedItems = targets.filter(p => selected[p.id]);

  const confirm = async () => {
    setSaving(true);
    try {
      if (mode === 'agency') {
        if (!agencyName.trim()) { toast.error(t('guestList.promoDist.agencyName')); setSaving(false); return; }
        await onConfirmAgency(agencyName.trim());
      } else {
        await onConfirmTargets((mode === 'all' ? targets : selectedItems).map(p => ({ id: p.id, label: p.name })));
      }
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('guestList.saveError')); setSaving(false); }
  };

  const canConfirm = mode === 'agency' ? agencyName.trim().length > 0 : (mode === 'all' ? targets.length > 0 : selectedItems.length > 0);
  const noneKey = holderType === 'dj' ? 'guestList.dj.noLineup' : 'guestList.promoDist.noneLeft';

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.15 }}
          onClick={e => e.stopPropagation()}
          style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px', width: '100%', maxWidth: 440, maxHeight: '84vh', overflowY: 'auto' }}>
          <div className="flex items-center justify-between mb-1">
            <h3 className="flex items-center gap-2" style={{ color: T1, fontSize: 15, fontWeight: 600, margin: 0 }}>
              {mode === 'agency' ? <Building2 className="h-4 w-4" style={{ color: RED }} /> : <Icon className="h-4 w-4" style={{ color: RED }} />}
              {mode === 'agency' ? t('guestList.promoDist.agency') : mode === 'all' ? t('guestList.promoDist.all') : t('guestList.promoDist.select')}
            </h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3 }}><X className="h-4 w-4" /></button>
          </div>
          <p style={{ color: T3, fontSize: 12, marginBottom: 14 }}>{tpl.name} · {tpl.quota} {t('guestList.presets.spots')}</p>

          {mode === 'agency' ? (
            <div className="space-y-2">
              <label style={{ color: T2, fontSize: 13, fontWeight: 500, display: 'block' }}>{t('guestList.promoDist.agencyName')}</label>
              <input value={agencyName} onChange={e => setAgencyName(e.target.value)} placeholder={t('guestList.promoDist.agencyPlaceholder')} autoFocus
                className="w-full outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 12px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
              <p style={{ color: T3, fontSize: 11.5 }}>{t('guestList.promoDist.agencyHint').replace('{n}', String(tpl.quota))}</p>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-6"><div className="h-6 w-6 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} /></div>
          ) : targets.length === 0 ? (
            <p className="text-center py-6" style={{ color: T3, fontSize: 13 }}>{t(noneKey)}</p>
          ) : mode === 'all' ? (
            <p style={{ color: T2, fontSize: 13 }}>{t('guestList.promoDist.allHint').replace('{n}', String(targets.length)).replace('{q}', String(tpl.quota))}</p>
          ) : (
            <div className="space-y-1.5" style={{ maxHeight: 240, overflowY: 'auto' }}>
              {targets.map(p => {
                const on = !!selected[p.id];
                return (
                  <button key={p.id} type="button" onClick={() => setSelected(s => ({ ...s, [p.id]: !on }))} className="w-full flex items-center justify-between text-left"
                    style={{ padding: '10px 12px', borderRadius: 10, background: on ? 'rgba(232,25,44,0.12)' : TILE_BG, border: `1px solid ${on ? RED : F_BORDER}`, cursor: 'pointer' }}>
                    <span style={{ color: T1, fontSize: 13.5, fontWeight: on ? 600 : 500 }}>{p.name}</span>
                    {on && <Check className="h-4 w-4" style={{ color: RED }} />}
                  </button>
                );
              })}
            </div>
          )}

          <button onClick={confirm} disabled={!canConfirm || saving} className="mt-4"
            style={{ width: '100%', background: (!canConfirm || saving) ? INNER_BG : RED, border: 'none', borderRadius: 12, padding: '12px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: (!canConfirm || saving) ? 'not-allowed' : 'pointer', opacity: (!canConfirm || saving) ? 0.6 : 1 }}>
            {saving ? '…' : mode === 'select' ? t('guestList.promoDist.confirmSelect').replace('{n}', String(selectedItems.length)) : mode === 'agency' ? t('guestList.promoDist.confirmAgency') : t('guestList.promoDist.confirmAll')}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
