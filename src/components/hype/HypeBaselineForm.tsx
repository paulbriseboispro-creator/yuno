import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Users, DoorOpen, Clock3, CalendarCheck, Flame, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { VenueHypeBaseline } from '@/hooks/useHypeBaseline';
import { EMPTY_BASELINE } from '@/hooks/useHypeBaseline';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const TILE_BG  = 'rgba(255,255,255,0.025)';

interface Props {
  open: boolean;
  initial: VenueHypeBaseline | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: VenueHypeBaseline) => Promise<boolean> | boolean;
}

type Timing = NonNullable<VenueHypeBaseline['sales_timing']>;
type Freq = NonNullable<VenueHypeBaseline['sellout_frequency']>;

export function HypeBaselineForm({ open, initial, saving, onClose, onSubmit }: Props) {
  const { t } = useLanguage();
  const [values, setValues] = useState<VenueHypeBaseline>(initial ?? EMPTY_BASELINE);

  useEffect(() => {
    if (open) setValues(initial ?? EMPTY_BASELINE);
  }, [open, initial]);

  const set = <K extends keyof VenueHypeBaseline>(k: K, v: VenueHypeBaseline[K]) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  const numField = (k: keyof VenueHypeBaseline, val: string) =>
    set(k, val === '' ? null : (Math.max(0, parseInt(val, 10) || 0) as VenueHypeBaseline[typeof k]));

  const timingOpts: { key: Timing; label: string; icon: typeof DoorOpen }[] = [
    { key: 'door',    label: t('baseline.timingDoor'),    icon: DoorOpen },
    { key: 'mixed',   label: t('baseline.timingMixed'),   icon: Clock3 },
    { key: 'advance', label: t('baseline.timingAdvance'), icon: CalendarCheck },
  ];

  const freqOpts: { key: Freq; label: string }[] = [
    { key: 'never',     label: t('baseline.freqNever') },
    { key: 'rarely',    label: t('baseline.freqRarely') },
    { key: 'sometimes', label: t('baseline.freqSometimes') },
    { key: 'often',     label: t('baseline.freqOften') },
    { key: 'always',    label: t('baseline.freqAlways') },
  ];

  const inputStyle: React.CSSProperties = {
    background: INNER_BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    padding: '11px 14px',
    color: T1,
    fontSize: 15,
    fontFamily: 'inherit',
    width: '100%',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    color: T2,
    fontSize: 13,
    fontWeight: 560,
    display: 'block',
    marginBottom: 8,
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto"
            style={{
              background: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
              border: `1px solid ${BORDER}`,
              borderRadius: 20,
              boxShadow: '0 1px 0 rgba(255,255,255,.05) inset,0 30px 60px -20px rgba(0,0,0,.95)',
              margin: '0 0 env(safe-area-inset-bottom)',
            }}
          >
            {/* Header */}
            <div
              className="sticky top-0 z-10 flex items-start justify-between gap-3 px-6 pt-6 pb-4"
              style={{ background: '#0a0a0c', borderBottom: `1px solid ${F_BORDER}` }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 flex items-center justify-center rounded-xl flex-none"
                  style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
                >
                  <Flame className="w-4 h-4" style={{ color: RED }} />
                </div>
                <div>
                  <h3 style={{ color: T1, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
                    {t('baseline.title')}
                  </h3>
                  <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{t('baseline.subtitle')}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg flex-none cursor-pointer transition-colors"
                style={{ background: TILE_BG, border: `1px solid ${BORDER}`, color: T3 }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Capacity + attendance */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={labelStyle}>{t('baseline.capacity')}</label>
                  <input
                    type="number" inputMode="numeric" min={0} placeholder="—"
                    value={values.capacity ?? ''}
                    onChange={(e) => numField('capacity', e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t('baseline.avgPrice')}</label>
                  <input
                    type="number" inputMode="numeric" min={0} placeholder="—"
                    value={values.avg_ticket_price ?? ''}
                    onChange={(e) => numField('avg_ticket_price', e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={labelStyle}>
                    <Users className="inline w-3.5 h-3.5 mr-1 -mt-0.5" style={{ color: T3 }} />
                    {t('baseline.typical')}
                  </label>
                  <input
                    type="number" inputMode="numeric" min={0} placeholder="—"
                    value={values.typical_attendance ?? ''}
                    onChange={(e) => numField('typical_attendance', e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t('baseline.slow')}</label>
                  <input
                    type="number" inputMode="numeric" min={0} placeholder="—"
                    value={values.slow_attendance ?? ''}
                    onChange={(e) => numField('slow_attendance', e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Sales timing — segment */}
              <div>
                <label style={labelStyle}>{t('baseline.timingQ')}</label>
                <div
                  className="grid grid-cols-3 gap-0.5 p-1 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}
                >
                  {timingOpts.map((o) => {
                    const Icon = o.icon;
                    const active = values.sales_timing === o.key;
                    return (
                      <button
                        key={o.key}
                        onClick={() => set('sales_timing', active ? null : o.key)}
                        className="flex flex-col items-center gap-1.5 py-2.5 rounded-lg cursor-pointer transition-all duration-150"
                        style={
                          active
                            ? {
                                color: T1,
                                background: 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))',
                                boxShadow: '0 1px 0 rgba(255,255,255,.08) inset,0 4px 10px -6px #000',
                              }
                            : { color: T3, background: 'transparent' }
                        }
                      >
                        <Icon className="w-4 h-4" />
                        <span style={{ fontSize: 12, fontWeight: 560 }}>{o.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sellout frequency — pills */}
              <div>
                <label style={labelStyle}>{t('baseline.freqQ')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {freqOpts.map((o) => {
                    const active = values.sellout_frequency === o.key;
                    return (
                      <button
                        key={o.key}
                        onClick={() => set('sellout_frequency', active ? null : o.key)}
                        className="px-3 py-2 rounded-lg cursor-pointer transition-all duration-150"
                        style={
                          active
                            ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88`, fontSize: 12.5, fontWeight: 600 }
                            : { color: T3, background: TILE_BG, border: `1px solid ${BORDER}`, fontSize: 12.5, fontWeight: 560 }
                        }
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              className="sticky bottom-0 flex items-center gap-3 px-6 py-4"
              style={{ background: '#0a0a0c', borderTop: `1px solid ${F_BORDER}` }}
            >
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-xl cursor-pointer transition-all duration-150"
                style={{ background: TILE_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 14, fontWeight: 560 }}
              >
                {t('baseline.cancel')}
              </button>
              <button
                disabled={saving}
                onClick={async () => {
                  const ok = await onSubmit(values);
                  if (ok) onClose();
                }}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl cursor-pointer transition-all duration-150 disabled:opacity-60"
                style={{ background: RED, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 0 18px -6px ${RED}` }}
              >
                <Check className="w-4 h-4" />
                {saving ? t('baseline.saving') : t('baseline.save')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
