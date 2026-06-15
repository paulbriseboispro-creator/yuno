import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Users, Mail, MapPin, Calendar, Download, Search, Trash2, Send } from 'lucide-react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const NEG        = '#FF5C63';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const TILE_BG    = 'rgba(255,255,255,0.025)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface WaitlistEntry {
  id: string;
  email: string;
  first_name: string | null;
  city: string | null;
  created_at: string;
  notified_at: string | null;
}

export default function AdminWaitlist() {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { fetchWaitlist(); }, []);

  const fetchWaitlist = async () => {
    try {
      const { data, error } = await supabase.from('launch_waitlist').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setEntries(data || []);
    } catch (error) {
      console.error('Error fetching waitlist:', error);
      toast.error(t('adminWaitlist.loadError'));
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('adminWaitlist.confirmDelete'))) return;
    try {
      const { error } = await supabase.from('launch_waitlist').delete().eq('id', id);
      if (error) throw error;
      setEntries(entries.filter(e => e.id !== id));
      toast.success(t('adminWaitlist.deleted'));
    } catch (error) {
      toast.error(t('adminWaitlist.deleteError'));
    }
  };

  const exportToCsv = () => {
    const headers = ['Email', t('adminWaitlist.withName'), t('adminWaitlist.withCity'), 'Date', t('adminWaitlist.notified')];
    const rows = entries.map(e => [e.email, e.first_name || '', e.city || '', format(new Date(e.created_at), 'dd/MM/yyyy HH:mm'), e.notified_at ? '✓' : '']);
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `yuno-waitlist-${format(new Date(), 'yyyy-MM-dd')}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  const filteredEntries = entries.filter(e => e.email.toLowerCase().includes(search.toLowerCase()) || (e.first_name?.toLowerCase().includes(search.toLowerCase())) || (e.city?.toLowerCase().includes(search.toLowerCase())));
  const stats = { total: entries.length, withName: entries.filter(e => e.first_name).length, withCity: entries.filter(e => e.city).length, notified: entries.filter(e => e.notified_at).length };

  const statCards = [
    { label: t('adminWaitlist.registered'), value: stats.total, icon: Users },
    { label: t('adminWaitlist.withName'), value: stats.withName, icon: Mail },
    { label: t('adminWaitlist.withCity'), value: stats.withCity, icon: MapPin },
    { label: t('adminWaitlist.notified'), value: stats.notified, icon: Send, tone: 'pos' as const },
  ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-2 mx-auto" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          <p className="text-sm" style={{ color: T3 }}>{t('adminWaitlist.title')}…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              {t('adminWaitlist.title')}
            </h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminWaitlist.subtitle')}</p>
          </div>
          <button
            onClick={exportToCsv}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12.5px] font-medium cursor-pointer transition-all duration-150"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
          >
            <Download className="h-3.5 w-3.5" />
            {t('adminWaitlist.exportCSV')}
          </button>
        </div>

        {/* KPI tiles */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {statCards.map((c, i) => {
            const Icon = c.icon;
            const valueColor = c.tone === 'pos' ? POS : T1;
            return (
              <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '16px 18px', height: '100%' }}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{c.label}</p>
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-lg flex-none"
                      style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: T2 }} />
                    </div>
                  </div>
                  <p className="tabular-nums" style={{ color: valueColor, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>{c.value}</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
          <input
            placeholder={t('adminWaitlist.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 12, color: T1, fontSize: 13, padding: '10px 12px 10px 38px', width: '100%', outline: 'none' }}
          />
        </div>

        {/* Registrations list */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden' }}>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
            {t('adminWaitlist.registrations')} ({filteredEntries.length})
          </h3>
          {filteredEntries.length === 0 ? (
            <div className="text-center py-10 px-4">
              <Users className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
              <p className="text-xs" style={{ color: T3 }}>{search ? t('adminWaitlist.noResults') : t('adminWaitlist.noRegistrations')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredEntries.map((entry, index) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.02, 0.3) }}
                  className="flex items-center justify-between gap-3 p-3 sm:p-3.5 rounded-xl transition-colors"
                  style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-[560] truncate" style={{ color: T1, fontSize: 13.5 }}>{entry.email}</p>
                      {entry.notified_at && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS, fontSize: 10, fontWeight: 600 }}
                        >
                          {t('adminWaitlist.notified')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap" style={{ color: T3, fontSize: 12 }}>
                      {entry.first_name && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{entry.first_name}</span>}
                      {entry.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{entry.city}</span>}
                      <span className="flex items-center gap-1 tabular-nums"><Calendar className="h-3 w-3" />{format(new Date(entry.created_at), 'dd MMM yyyy', { locale: dateLocale })}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg flex-none cursor-pointer transition-colors"
                    style={{ color: T3, background: 'transparent', border: '1px solid transparent' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = NEG; e.currentTarget.style.background = 'rgba(255,92,99,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,92,99,0.25)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = T3; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
