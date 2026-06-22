import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Users, Music, Megaphone, Clock, Star, CheckSquare, Building2, Ticket, Wine, Crown, Eye, Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { GuestListTemplate, TemplateInput, TemplateHolderType, TargetMode, EntryKind } from '@/hooks/useGuestListTemplates';
import { RED, T1, T2, T3, BORDER, F_BORDER, INNER_BG, TILE_BG, CARD_BG, CARD_SHADOW, YunoSwitch } from './ui';

const TYPES: { value: TemplateHolderType; icon: typeof Users; key: string }[] = [
  { value: 'club',     icon: Users,     key: 'guestList.holderType.club' },
  { value: 'dj',       icon: Music,     key: 'guestList.holderType.dj' },
  { value: 'promoter', icon: Megaphone, key: 'guestList.holderType.promoter' },
];

interface Props {
  editing: GuestListTemplate | null;
  initial?: Partial<TemplateInput>;
  t: (key: string) => string;
  onClose: () => void;
  onSave: (input: TemplateInput, id: string | null) => Promise<void>;
}

const inputStyle = { background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 12px', color: T1, fontSize: 14, fontFamily: 'inherit' } as const;
const labelStyle = { color: T2, fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 } as const;

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; icon: typeof Users; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(opt => {
        const on = value === opt.value;
        return (
          <button key={opt.value} type="button" onClick={() => onChange(opt.value)} className="flex items-center justify-center gap-1.5"
            style={{ padding: '9px 6px', borderRadius: 10, cursor: 'pointer', background: on ? 'rgba(232,25,44,0.14)' : TILE_BG, border: `1px solid ${on ? RED : F_BORDER}`, color: on ? '#ff4d5a' : T2, fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
            <opt.icon className="h-3.5 w-3.5 flex-none" />{opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function GuestListPresetDialog({ editing, initial, t, onClose, onSave }: Props) {
  const seed = editing ?? initial ?? {};
  const [name, setName] = useState(editing?.name ?? '');
  const [holderType, setHolderType] = useState<TemplateHolderType>(editing?.holder_type ?? (initial?.holder_type as TemplateHolderType) ?? 'club');
  const [targetMode, setTargetMode] = useState<TargetMode>(editing?.target_mode ?? 'all');
  // Per-type allocation: a list can mix kinds (e.g. 10 normal + 2 VIP). Total = sum.
  const [qNormal, setQNormal] = useState<number>(seed.quota_normal ?? seed.quota ?? 100);
  const [qDrink, setQDrink] = useState<number>(seed.quota_drink ?? 0);
  const [qTable, setQTable] = useState<number>(seed.quota_table ?? 0);
  const [enableGender, setEnableGender] = useState((seed.quota_female ?? null) !== null || (seed.quota_male ?? null) !== null);
  const [quotaFemale, setQuotaFemale] = useState<number>(seed.quota_female ?? 70);
  const [quotaMale, setQuotaMale] = useState<number>(seed.quota_male ?? 30);
  const [freeBefore, setFreeBefore] = useState((seed.free_before_time ?? '02:00').substring(0, 5));
  const [entryDeadline, setEntryDeadline] = useState((seed.entry_deadline ?? '')?.substring(0, 5) || '');
  const [visible, setVisible] = useState(seed.visible_on_club_page ?? false);
  const [isDefault, setIsDefault] = useState(editing?.is_default ?? false);
  const [saving, setSaving] = useState(false);

  const isClub = holderType === 'club';
  // Targeting: club has no targeting (it IS the club list); DJ = all|select; promoter
  // adds 'agency' (a global contract delegated to a named agency).
  const targetOptions = holderType === 'dj'
    ? [{ value: 'all' as TargetMode, icon: Users, label: t('guestList.presets.targetAllDjs') }, { value: 'select' as TargetMode, icon: CheckSquare, label: t('guestList.presets.targetSelect') }]
    : [{ value: 'all' as TargetMode, icon: Users, label: t('guestList.presets.targetAllPromoters') }, { value: 'select' as TargetMode, icon: CheckSquare, label: t('guestList.presets.targetSelect') }, { value: 'agency' as TargetMode, icon: Building2, label: t('guestList.presets.targetAgency') }];

  const total = qNormal + qDrink + qTable;
  const primaryKind: EntryKind = qNormal > 0 ? 'normal' : qDrink > 0 ? 'drink' : qTable > 0 ? 'table' : 'normal';

  const handleSave = async () => {
    if (!name.trim()) { toast.error(t('guestList.presets.name')); return; }
    if (total < 1) { toast.error(t('guestList.presets.entryKind')); return; }
    setSaving(true);
    const input: TemplateInput = {
      name: name.trim(),
      holder_type: holderType,
      target_mode: isClub ? 'all' : targetMode,
      entry_kind: primaryKind,
      is_default: isClub ? isDefault : false,
      quota: total,
      quota_normal: qNormal,
      quota_drink: qDrink,
      quota_table: qTable,
      quota_female: enableGender ? quotaFemale : null,
      quota_male: enableGender ? quotaMale : null,
      free_before_time: freeBefore,
      entry_deadline: entryDeadline || null,
      includes_drink: qDrink > 0,
      visible_on_club_page: visible,
    };
    try {
      await onSave(input, editing?.id ?? null);
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('guestList.saveError')); setSaving(false); }
  };

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.15 }}
          onClick={e => e.stopPropagation()}
          style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px', width: '100%', maxWidth: 460, maxHeight: '88vh', overflowY: 'auto' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ color: T1, fontSize: 16, fontWeight: 600, margin: 0 }}>{editing ? t('guestList.presets.edit') : t('guestList.presets.create')}</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3 }}><X className="h-4 w-4" /></button>
          </div>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label style={labelStyle}>{t('guestList.presets.name')}</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t('guestList.presets.namePlaceholder')} autoFocus className="w-full outline-none" style={inputStyle} />
            </div>

            {/* Holder type */}
            <div>
              <label style={labelStyle}>{t('guestList.presets.forType')}</label>
              <Segmented value={holderType} onChange={setHolderType} options={TYPES.map(ty => ({ value: ty.value, icon: ty.icon, label: t(ty.key) }))} />
            </div>

            {/* Targeting — DJ & promoter only */}
            {!isClub && (
              <div>
                <label style={labelStyle}>{t('guestList.presets.targetLabel')}</label>
                <Segmented value={targetMode} onChange={setTargetMode} options={targetOptions} />
              </div>
            )}

            {/* Entry types & quantities — a list can mix kinds (e.g. 10 normal + 2 VIP). 0 = not offered. */}
            <div>
              <label style={labelStyle}>{t('guestList.presets.entryKind')}</label>
              <div className="space-y-2">
                {[
                  { icon: Ticket, key: 'guestList.presets.entryNormal', val: qNormal, set: setQNormal },
                  { icon: Wine,   key: 'guestList.presets.entryDrink',  val: qDrink,  set: setQDrink },
                  { icon: Crown,  key: 'guestList.presets.entryVip',    val: qTable,  set: setQTable },
                ].map((row, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 flex-1" style={{ color: row.val > 0 ? T1 : T3, fontSize: 13, fontWeight: 500 }}><row.icon className="h-3.5 w-3.5" />{t(row.key)}</span>
                    <input type="number" min={0} max={10000} value={row.val} onChange={e => row.set(Math.max(0, Number(e.target.value)))} className="outline-none" style={{ ...inputStyle, width: 96, textAlign: 'center' }} />
                  </div>
                ))}
              </div>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{t('guestList.presets.totalSpots').replace('{n}', String(total))}</p>
            </div>

            {/* Gender split */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>{t('guestList.genderQuotas')}</label>
                <YunoSwitch checked={enableGender} onChange={setEnableGender} />
              </div>
              {enableGender && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p style={{ color: T3, fontSize: 11.5, marginBottom: 4 }}>{t('guestList.female')}</p>
                    <input type="number" min={0} value={quotaFemale} onChange={e => setQuotaFemale(Math.max(0, Number(e.target.value)))} className="w-full outline-none" style={inputStyle} />
                  </div>
                  <div>
                    <p style={{ color: T3, fontSize: 11.5, marginBottom: 4 }}>{t('guestList.male')}</p>
                    <input type="number" min={0} value={quotaMale} onChange={e => setQuotaMale(Math.max(0, Number(e.target.value)))} className="w-full outline-none" style={inputStyle} />
                  </div>
                </div>
              )}
            </div>

            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flex items-center gap-1.5" style={labelStyle}><Clock className="h-3.5 w-3.5" style={{ color: T3 }} />{t('guestList.freeBeforeTime')}</label>
                <input type="time" value={freeBefore} onChange={e => setFreeBefore(e.target.value)} className="w-full outline-none" style={{ ...inputStyle, colorScheme: 'dark' }} />
              </div>
              <div>
                <label className="flex items-center gap-1.5" style={labelStyle}><Clock className="h-3.5 w-3.5" style={{ color: T3 }} />{t('guestList.entryDeadline')}</label>
                <input type="time" value={entryDeadline} onChange={e => setEntryDeadline(e.target.value)} className="w-full outline-none" style={{ ...inputStyle, colorScheme: 'dark' }} />
              </div>
            </div>

            {/* Visibility — public selection page (via link) vs private */}
            <div>
              <label style={labelStyle}>{t('guestList.presets.visibilityLabel')}</label>
              <Segmented value={visible ? 'public' : 'private'} onChange={(v) => setVisible(v === 'public')}
                options={[{ value: 'public', icon: Eye, label: t('guestList.presets.visPublic') }, { value: 'private', icon: Lock, label: t('guestList.presets.visPrivate') }]} />
            </div>

            {/* Default — club only (drives the events-page Guest list toggle) */}
            {isClub && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2" style={{ color: T2, fontSize: 13, fontWeight: 500 }}><Star className="h-4 w-4" style={{ color: T3 }} />{t('guestList.presets.setDefault')}</span>
                  <YunoSwitch checked={isDefault} onChange={setIsDefault} />
                </div>
                <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{t('guestList.presets.setDefaultHint')}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 1, background: saving ? INNER_BG : RED, border: 'none', borderRadius: 12, padding: '12px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? '…' : editing ? t('owner.save') : t('guestList.presets.create')}
              </button>
              <button type="button" onClick={onClose}
                style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 18px', color: T1, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
