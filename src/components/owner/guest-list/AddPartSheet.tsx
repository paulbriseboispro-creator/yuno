import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music, Megaphone, UserPlus, Users, X, ChevronLeft, Check, Ticket, Wine, Crown, Infinity as InfinityIcon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getEventPresenters } from '@/lib/coorg';
import { loadGuestArtists } from '@/lib/guestArtists';
import type { HolderType } from '@/hooks/useGuestListParts';
import type { GuestListTemplate } from '@/hooks/useGuestListTemplates';
import { RED, T1, T2, T3, BORDER, F_BORDER, INNER_BG, TILE_BG, CARD_BG, CARD_SHADOW, YunoSwitch } from './ui';

interface Picklist { id: string; name: string }

interface AddPartSheetProps {
  eventId: string;
  ctx: { isOrganizerScope: boolean; venueId: string | null; organizerUserId: string | null };
  existingDjIds: string[];
  existingPromoterIds: string[];
  t: (key: string) => string;
  onClose: () => void;
  onCreateDj: (djId: string, quota: number | null, extra?: Record<string, unknown>) => Promise<void>;
  onCreatePromoter: (promoterId: string, label: string, quota: number | null, extra?: Record<string, unknown>) => Promise<void>;
  onCreateCustom: (label: string, quota: number | null, extra?: Record<string, unknown>) => Promise<void>;
  presets?: GuestListTemplate[];
}

/** A preset's reusable config (everything the part insert can carry, minus quota). */
function presetExtraOf(tpl: GuestListTemplate): Record<string, unknown> {
  return {
    quota_female: tpl.quota_female, quota_male: tpl.quota_male,
    quota_normal: tpl.quota_normal, quota_drink: tpl.quota_drink, quota_table: tpl.quota_table,
    free_before_time: tpl.free_before_time, entry_deadline: tpl.entry_deadline,
    includes_drink: tpl.includes_drink, visible_on_club_page: tpl.visible_on_club_page,
    entry_kind: tpl.entry_kind,
  };
}

type Step = Exclude<HolderType, 'club'> | 'party';

const TYPE_OPTIONS: { type: Step; icon: typeof Music; labelKey: string }[] = [
  // Une partie de la soirée (orga partenaire, co-hôte) : sur une soirée à
  // plusieurs, c'est la part qu'on veut donner d'abord. Club seulement — seul le
  // club peut créer une part au nom d'une autre partie (RLS guest_lists).
  { type: 'party',    icon: Users,     labelKey: 'guestList.holderType.party' },
  { type: 'custom',   icon: UserPlus,  labelKey: 'guestList.holderType.custom' },
  { type: 'dj',       icon: Music,     labelKey: 'guestList.holderType.dj' },
  { type: 'promoter', icon: Megaphone, labelKey: 'guestList.holderType.promoter' },
];

export function AddPartSheet({ eventId, ctx, existingDjIds, existingPromoterIds, t, onClose, onCreateDj, onCreatePromoter, onCreateCustom, presets }: AddPartSheetProps) {
  const [step, setStep] = useState<'pick' | Step>('pick');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<Picklist[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [customName, setCustomName] = useState('');
  // Per-type allocation — a part can mix kinds (e.g. 10 standard + 2 VIP). 0 = not offered.
  const [qNormal, setQNormal] = useState(20);
  const [qDrink, setQDrink] = useState(0);
  const [qTable, setQTable] = useState(0);
  // Sans limite : quota NULL en base — le détenteur ajoute autant d'invités qu'il veut.
  const [unlimited, setUnlimited] = useState(false);
  const [presetId, setPresetId] = useState<string>('');
  // DJ hors Yuno : artistes invités du line-up (sans compte) + saisie libre.
  const [externalDjs, setExternalDjs] = useState<Picklist[]>([]);
  const [externalName, setExternalName] = useState('');
  const [saving, setSaving] = useState(false);

  const quota = qNormal + qDrink + qTable;

  // Presets matching the current holder step, offered as one-tap config fill.
  const stepPresets = (presets || []).filter(p => p.holder_type === step);

  const applyPreset = (tpl: GuestListTemplate) => {
    setPresetId(tpl.id);
    setQNormal(tpl.quota_normal ?? tpl.quota ?? 0);
    setQDrink(tpl.quota_drink ?? 0);
    setQTable(tpl.quota_table ?? 0);
  };

  useEffect(() => {
    if (step === 'dj') loadDjs();
    if (step === 'promoter') loadPromoters();
    if (step === 'party') loadParties();
    setSelected('');
    setPresetId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const loadDjs = async () => {
    setLoading(true);
    setExternalName('');
    const [{ data: ed }, { data: ds }, guests, { data: taken }] = await Promise.all([
      supabase.from('event_djs').select('dj_id').eq('event_id', eventId),
      supabase.from('dj_sets').select('dj_id').eq('event_id', eventId),
      loadGuestArtists(eventId).catch(() => []),
      supabase.from('guest_lists').select('holder_label').eq('event_id', eventId),
    ]);
    const takenLabels = new Set((taken || []).map(r => (r.holder_label || '').trim().toLowerCase()).filter(Boolean));
    setExternalDjs(guests
      .filter(g => g.id && !takenLabels.has(g.name.trim().toLowerCase()))
      .map(g => ({ id: `ga:${g.id}`, name: g.name })));
    const ids = [...new Set([...(ed || []).map(r => r.dj_id), ...(ds || []).map(r => r.dj_id)].filter(Boolean))] as string[];
    const fresh = ids.filter(id => !existingDjIds.includes(id));
    if (!fresh.length) { setList([]); setLoading(false); return; }
    const { data: djRows } = await supabase.from('djs').select('id, stage_name, first_name, last_name').in('id', fresh);
    setList((djRows || []).map(d => ({ id: d.id, name: d.stage_name || `${d.first_name || ''} ${d.last_name || ''}`.trim() || 'DJ' })));
    setLoading(false);
  };

  // Organisateurs de la soirée (hors soi) qui n'ont pas encore de part à leur nom.
  const [partiesAvailable, setPartiesAvailable] = useState<boolean>(false);
  useEffect(() => {
    if (ctx.isOrganizerScope) { setPartiesAvailable(false); return; }
    let active = true;
    getEventPresenters(eventId)
      .then((rows) => { if (active) setPartiesAvailable((rows ?? []).some((r) => r.kind === 'org' && r.organizer_user_id)); })
      .catch(() => { if (active) setPartiesAvailable(false); });
    // Soirée en collab : l'option reste visible même si le partenaire n'est pas encore listé.
    supabase.from('events').select('partner_organizer_id, event_mode').eq('id', eventId).maybeSingle()
      .then(({ data }) => { if (active && (data?.partner_organizer_id || data?.event_mode === 'co_event')) setPartiesAvailable(true); });
    return () => { active = false; };
  }, [eventId, ctx.isOrganizerScope]);

  const loadParties = async () => {
    setLoading(true);
    try {
      const [presenters, { data: owned }, { data: ev }] = await Promise.all([
        getEventPresenters(eventId),
        supabase.from('guest_lists').select('organizer_user_id').eq('event_id', eventId).neq('holder_type', 'club'),
        supabase.from('events').select('partner_organizer_id').eq('id', eventId).maybeSingle(),
      ]);
      const taken = new Set((owned || []).map((r) => r.organizer_user_id).filter(Boolean));
      const parties = (presenters ?? [])
        .filter((r) => r.kind === 'org' && r.organizer_user_id && !taken.has(r.organizer_user_id))
        .map((r) => ({ id: r.organizer_user_id as string, name: r.name }));
      const partner = ev?.partner_organizer_id as string | null | undefined;
      if (partner && !taken.has(partner) && !parties.some(p => p.id === partner)) {
        const { data: op } = await supabase.from('organizer_profiles').select('display_name').eq('user_id', partner).maybeSingle();
        parties.push({ id: partner, name: (op as { display_name?: string } | null)?.display_name || 'Partner' });
      }
      setList(parties);
    } catch { setList([]); }
    setLoading(false);
  };

  const loadPromoters = async () => {
    setLoading(true);
    const q = supabase.from('promoters').select('id, user_id, promo_code').eq('is_active', true);
    const { data: promoters } = ctx.isOrganizerScope
      ? await q.eq('organizer_user_id', ctx.organizerUserId)
      : await q.eq('venue_id', ctx.venueId);
    const fresh = (promoters || []).filter(p => !existingPromoterIds.includes(p.id));
    if (!fresh.length) { setList([]); setLoading(false); return; }
    const { data: profiles } = await supabase.from('profiles').select('id, first_name, last_name').in('id', fresh.map(p => p.user_id));
    const nameMap = new Map((profiles || []).map(p => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
    setList(fresh.map(p => ({ id: p.id, name: nameMap.get(p.user_id) || p.promo_code })));
    setLoading(false);
  };

  const confirm = async () => {
    if (!unlimited && quota < 1) { toast.error(t('guestList.presets.entryKind')); return; }
    setSaving(true);
    try {
      const chosen = stepPresets.find(p => p.id === presetId);
      // Per-type allocation set here takes precedence over the preset's quotas.
      // Illimité : quota NULL, aucun plafond par type (le trigger de capacité
      // ignore les quotas NULL/0).
      const extra = unlimited
        ? {
            ...(chosen ? presetExtraOf(chosen) : {}),
            quota_normal: 0, quota_drink: 0, quota_table: 0,
            includes_drink: false,
            entry_kind: 'normal',
          }
        : {
            ...(chosen ? presetExtraOf(chosen) : {}),
            quota_normal: qNormal, quota_drink: qDrink, quota_table: qTable,
            includes_drink: qDrink > 0,
            entry_kind: qNormal > 0 ? 'normal' : qDrink > 0 ? 'drink' : qTable > 0 ? 'table' : 'normal',
          };
      const effQuota = unlimited ? null : quota;
      if (step === 'custom') {
        if (!customName.trim()) { toast.error(t('guestList.parts.customName')); setSaving(false); return; }
        await onCreateCustom(customName.trim(), effQuota, extra);
      } else if (step === 'party') {
        // Part au nom de la partie : elle la gère depuis sa Console et « Qui fait
        // vendre ? » lui attribue ses inscrits (organizer_user_id de la part).
        const label = list.find(l => l.id === selected)?.name || '';
        await onCreateCustom(label, effQuota, { ...extra, organizer_user_id: selected, visible_on_club_page: false });
      } else if (step === 'dj') {
        if (selected.startsWith('ga:') || (!selected && externalName.trim())) {
          // DJ hors Yuno : une part libre au nom de l'artiste, sans compte.
          const label = selected ? (externalDjs.find(l => l.id === selected)?.name || '') : externalName.trim();
          await onCreateCustom(label, effQuota, extra);
        } else {
          await onCreateDj(selected, effQuota, extra);
        }
      } else if (step === 'promoter') {
        const label = list.find(l => l.id === selected)?.name || '';
        await onCreatePromoter(selected, label, effQuota, extra);
      }
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('guestList.saveError')); setSaving(false); }
  };

  const canConfirm = (step === 'custom' ? customName.trim().length > 0 : step === 'dj' ? (!!selected || externalName.trim().length > 0) : !!selected) && (unlimited || quota >= 1);

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.15 }}
          onClick={e => e.stopPropagation()}
          style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px', width: '100%', maxWidth: 420, maxHeight: '80vh', overflowY: 'auto' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {step !== 'pick' && (
                <button onClick={() => setStep('pick')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3 }}><ChevronLeft className="h-4 w-4" /></button>
              )}
              <h3 style={{ color: T1, fontSize: 15, fontWeight: 600, margin: 0 }}>
                {step === 'pick' ? t('guestList.parts.pickHolder') : t(`guestList.holderType.${step}`)}
              </h3>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3 }}><X className="h-4 w-4" /></button>
          </div>

          {step === 'pick' && (
            <div className="space-y-2">
              {TYPE_OPTIONS.filter(opt => opt.type !== 'party' || partiesAvailable).map(opt => (
                <button key={opt.type} onClick={() => setStep(opt.type)} className="w-full flex items-center gap-3 text-left"
                  style={{ padding: '14px', borderRadius: 12, background: TILE_BG, border: `1px solid ${F_BORDER}`, cursor: 'pointer' }}>
                  <div className="h-9 w-9 rounded-full flex items-center justify-center flex-none" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                    <opt.icon className="h-4 w-4" style={{ color: RED }} />
                  </div>
                  <div>
                    <p style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>{t(opt.labelKey)}</p>
                    <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>{t(`guestList.parts.hint.${opt.type}`)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 'custom' && (
            <div className="space-y-3">
              <div>
                <p style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t('guestList.parts.customName')}</p>
                <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder={t('guestList.parts.customNamePlaceholder')} autoFocus
                  className="w-full outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 14px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
              </div>
            </div>
          )}

          {(step === 'dj' || step === 'promoter' || step === 'party') && (
            <div className="space-y-2">
              {step === 'dj' && !loading && externalDjs.length > 0 && (
                <div>
                  <p style={{ color: T3, fontSize: 11.5, marginBottom: 6 }}>{t('guestList.parts.externalDjs')}</p>
                  <div className="space-y-1.5">
                    {externalDjs.map(item => (
                      <button key={item.id} onClick={() => { setSelected(item.id); setExternalName(''); }} className="w-full flex items-center justify-between text-left"
                        style={{ padding: '11px 12px', borderRadius: 10, background: selected === item.id ? 'rgba(232,25,44,0.12)' : TILE_BG, border: `1px solid ${selected === item.id ? RED : F_BORDER}`, cursor: 'pointer' }}>
                        <span style={{ color: T1, fontSize: 13.5, fontWeight: selected === item.id ? 600 : 500 }}>{item.name}</span>
                        {selected === item.id && <Check className="h-4 w-4" style={{ color: RED }} />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {step === 'dj' && !loading && (
                <div>
                  <p style={{ color: T3, fontSize: 11.5, marginBottom: 6 }}>{t('guestList.parts.externalDjName')}</p>
                  <input value={externalName} onChange={e => { setExternalName(e.target.value); if (e.target.value) setSelected(''); }} placeholder={t('guestList.parts.externalDjPlaceholder')}
                    className="w-full outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 14px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
                </div>
              )}
              {loading ? (
                <div className="flex justify-center py-6"><div className="h-6 w-6 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} /></div>
              ) : list.length === 0 ? (
                step === 'dj' ? null : <p className="text-center py-6" style={{ color: T3, fontSize: 13 }}>{step === 'party' ? t('guestList.parts.noParties') : t('guestList.parts.noPromoters')}</p>
              ) : (
                <div className="space-y-1.5" style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {list.map(item => (
                    <button key={item.id} onClick={() => { setSelected(item.id); setExternalName(''); }} className="w-full flex items-center justify-between text-left"
                      style={{ padding: '11px 12px', borderRadius: 10, background: selected === item.id ? 'rgba(232,25,44,0.12)' : TILE_BG, border: `1px solid ${selected === item.id ? RED : F_BORDER}`, cursor: 'pointer' }}>
                      <span style={{ color: T1, fontSize: 13.5, fontWeight: selected === item.id ? 600 : 500 }}>{item.name}</span>
                      {selected === item.id && <Check className="h-4 w-4" style={{ color: RED }} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quota + confirm (any flow except the empty list states) */}
          {(step === 'custom' || step === 'dj' || ((step === 'promoter' || step === 'party') && list.length > 0)) && (
            <div className="mt-4 space-y-3">
              {(step === 'dj' || step === 'promoter') && stepPresets.length > 0 && (
                <div>
                  <p style={{ color: T3, fontSize: 11.5, marginBottom: 6 }}>{t('guestList.presets.applyTitle')}</p>
                  <div className="flex flex-wrap gap-2">
                    {stepPresets.map(tpl => {
                      const on = presetId === tpl.id;
                      return (
                        <button key={tpl.id} type="button" onClick={() => applyPreset(tpl)}
                          style={{ padding: '6px 10px', borderRadius: 8, background: on ? 'rgba(232,25,44,0.14)' : TILE_BG, border: `1px solid ${on ? RED : F_BORDER}`, color: on ? '#ff4d5a' : T2, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          {tpl.name} <span style={{ color: T3, fontWeight: 400 }}>· {tpl.quota}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Sans limite — quota NULL : le détenteur ajoute autant d'invités qu'il veut. */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5" style={{ color: unlimited ? T1 : T3, fontSize: 13, fontWeight: 500 }}>
                  <InfinityIcon className="h-3.5 w-3.5" />{t('guestList.unlimited')}
                </span>
                <YunoSwitch checked={unlimited} onChange={setUnlimited} />
              </div>
              {unlimited && (
                <p style={{ color: T3, fontSize: 11.5 }}>{t('guestList.unlimitedHint')}</p>
              )}

              {/* Per-type allocation — a part can mix kinds (e.g. 10 standard + 2 VIP). 0 = not offered. */}
              {!unlimited && (
              <div>
                <p style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{t('guestList.presets.entryKind')}</p>
                <div className="space-y-2">
                  {[
                    { icon: Ticket, key: 'guestList.presets.entryNormal', val: qNormal, set: setQNormal },
                    { icon: Wine,   key: 'guestList.presets.entryDrink',  val: qDrink,  set: setQDrink },
                    { icon: Crown,  key: 'guestList.presets.entryVip',    val: qTable,  set: setQTable },
                  ].map((row, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="flex items-center gap-1.5 flex-1" style={{ color: row.val > 0 ? T1 : T3, fontSize: 13, fontWeight: 500 }}><row.icon className="h-3.5 w-3.5" />{t(row.key)}</span>
                      <input type="number" min={0} max={10000} value={row.val} onChange={e => row.set(Math.max(0, Number(e.target.value)))}
                        className="outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 10px', color: T1, fontSize: 13, fontFamily: 'inherit', width: 90, textAlign: 'center' }} />
                    </div>
                  ))}
                </div>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{t('guestList.presets.totalSpots').replace('{n}', String(quota))}</p>
              </div>
              )}
              <button onClick={confirm} disabled={!canConfirm || saving}
                style={{ width: '100%', background: (!canConfirm || saving) ? INNER_BG : RED, border: 'none', borderRadius: 12, padding: '12px', color: (!canConfirm || saving) ? T1 : '#fff', fontSize: 14, fontWeight: 600, cursor: (!canConfirm || saving) ? 'not-allowed' : 'pointer', opacity: (!canConfirm || saving) ? 0.6 : 1 }}>
                {saving ? '…' : t('guestList.parts.addPart')}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
