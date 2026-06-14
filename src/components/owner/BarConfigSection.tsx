import { useState, useEffect } from 'react';
import { Plus, Trash2, Wine, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const INNER_BG = 'rgba(255,255,255,0.032)';

export function BarConfigSection({ venueId }: { venueId: string }) {
  const { t } = useLanguage();
  const [barNames, setBarNames] = useState<string[]>(['Bar Principal']);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (venueId) fetchBarConfig(); }, [venueId]);

  const fetchBarConfig = async () => {
    try {
      const { data, error } = await supabase.from('venues').select('bar_count, bar_names').eq('id', venueId).maybeSingle();
      if (error) throw error;
      if (data) setBarNames((data.bar_names as string[]) || ['Bar Principal']);
    } catch { console.error('Error fetching bar config'); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('venues').update({ bar_count: barNames.length, bar_names: barNames }).eq('id', venueId);
      if (error) throw error;
      toast.success(t('owner.barConfigSaved'));
    } catch { toast.error(t('owner.barConfigError')); }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Wine className="w-4 h-4" style={{ color: T3 }} />
        <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('owner.barConfigTitle')}</p>
      </div>
      <p style={{ color: T3, fontSize: 12, marginBottom: 12 }}>{t('owner.barConfigDescription')}</p>

      <div className="space-y-2">
        {barNames.map((name, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>
                {t('owner.barLabel').replace('{n}', String(i + 1))}
              </p>
              <input
                value={name}
                onChange={e => { const n = [...barNames]; n[i] = e.target.value; setBarNames(n); }}
                placeholder={t('owner.barPlaceholder').replace('{n}', String(i + 1))}
                className="w-full px-3 py-2.5 rounded-xl text-[13px] transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
                onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
                onBlur={e => (e.target.style.borderColor = BORDER)}
              />
            </div>
            {barNames.length > 1 && (
              <button
                type="button"
                onClick={() => setBarNames(barNames.filter((_, j) => j !== i))}
                className="mt-6 w-8 h-8 flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150"
                style={{ background: 'rgba(232,25,44,0.08)', border: `1px solid rgba(232,25,44,0.15)`, color: RED }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setBarNames([...barNames, `Bar ${barNames.length + 1}`])}
        className="w-full py-2.5 rounded-xl text-[13px] font-medium cursor-pointer flex items-center justify-center gap-2 transition-all duration-150"
        style={{ background: INNER_BG, border: `1px solid ${F_BORDER}`, color: T2 }}
      >
        <Plus className="w-4 h-4" />{t('owner.addBar')}
      </button>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-5 py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150 disabled:opacity-50 flex items-center gap-2"
        style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` }}
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {saving ? t('owner.savingConfig') : t('owner.saveConfig')}
      </button>
    </div>
  );
}
