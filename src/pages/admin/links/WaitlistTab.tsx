import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Calendar, Download, MapPin, Send, Trash2, Users } from 'lucide-react';
import { Card, Stat, Btn, Pill, EmptyState, Spinner, TILE_BG, F_BORDER, T1, T3 } from '@/components/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { SearchBox } from '../directory/Paginator';

/**
 * Liste d'attente de lancement — onglet de /admin/links.
 *
 * La table `launch_waitlist` est alimentée par la landing ET par la page bio
 * (`source = 'links'`) : les deux surfaces vivent donc au même endroit.
 */
interface Entry { id: string; email: string; first_name: string | null; last_name: string | null; city: string | null; phone: string | null; source: string | null; lang: string | null; created_at: string; notified_at: string | null }

export default function WaitlistTab() {
  const { t, language } = useLanguage();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<'all' | 'links' | 'other'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('launch_waitlist')
      .select('id, email, first_name, last_name, city, phone, source, lang, created_at, notified_at')
      .order('created_at', { ascending: false });
    if (error) { toast.error(t('adminWaitlist.loadError')); setLoading(false); return; }
    setEntries((data ?? []) as Entry[]);
    setLoading(false);
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    if (!window.confirm(t('adminWaitlist.confirmDelete'))) return;
    const { error } = await supabase.from('launch_waitlist').delete().eq('id', id);
    if (error) { toast.error(t('adminWaitlist.deleteError')); return; }
    setEntries((prev) => prev.filter((e) => e.id !== id));
    toast.success(t('adminWaitlist.deleted'));
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (source === 'links' && e.source !== 'links') return false;
      if (source === 'other' && e.source === 'links') return false;
      if (!s) return true;
      return e.email.toLowerCase().includes(s) || (e.first_name ?? '').toLowerCase().includes(s) || (e.city ?? '').toLowerCase().includes(s);
    });
  }, [entries, search, source]);

  const stats = {
    total: entries.length,
    fromLinks: entries.filter((e) => e.source === 'links').length,
    withCity: entries.filter((e) => e.city).length,
    notified: entries.filter((e) => e.notified_at).length,
  };

  const exportCsv = () => {
    // Séparateur « ; » + BOM UTF-8 : Excel FR ouvre le fichier sans réglage, et
    // chaque cellule est échappée (une ville avec une virgule cassait l'export).
    const q = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const head = ['email', 'first_name', 'last_name', 'city', 'phone', 'lang', 'source', 'created_at', 'notified_at'].join(';');
    const rows = filtered.map((e) => [q(e.email), q(e.first_name), q(e.last_name), q(e.city), q(e.phone), q(e.lang), q(e.source), q(e.created_at), q(e.notified_at)].join(';'));
    const blob = new Blob([`\uFEFF${[head, ...rows].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `yuno-waitlist-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat compact label={t('adminWaitlist.registered')} value={fmtNum(stats.total, language)} icon={Users} highlight />
        <Stat compact label={t('adm.links.fromBio')} value={fmtNum(stats.fromLinks, language)} icon={Send} />
        <Stat compact label={t('adminWaitlist.withCity')} value={fmtNum(stats.withCity, language)} icon={MapPin} />
        <Stat compact label={t('adminWaitlist.notified')} value={fmtNum(stats.notified, language)} icon={Send} tone={stats.notified > 0 ? 'pos' : undefined} />
      </div>

      <SearchBox value={search} onChange={setSearch} placeholder={t('adminWaitlist.searchPlaceholder')} right={<>
        <Pill tone={source === 'all' ? 'hot' : 'muted'}><button type="button" onClick={() => setSource('all')} className="cursor-pointer">{t('adm.common.all')}</button></Pill>
        <Pill tone={source === 'links' ? 'hot' : 'muted'}><button type="button" onClick={() => setSource('links')} className="cursor-pointer">{t('adm.links.fromBio')}</button></Pill>
        <Pill tone={source === 'other' ? 'hot' : 'muted'}><button type="button" onClick={() => setSource('other')} className="cursor-pointer">{t('adm.links.fromLanding')}</button></Pill>
        <Btn size="sm" icon={Download} onClick={exportCsv} disabled={filtered.length === 0}>{t('adm.common.exportCsv')}</Btn>
      </>} />

      <Card title={`${t('adminWaitlist.registrations')} (${fmtNum(filtered.length, language)})`} icon={Users}>
        {loading ? <Spinner /> : filtered.length === 0 ? <EmptyState icon={Users} text={search ? t('adminWaitlist.noResults') : t('adminWaitlist.noRegistrations')} /> : (
          <div className="space-y-2">
            {filtered.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 p-3 rounded-xl" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{e.email}</span>
                    {e.source === 'links' && <Pill size="xs" tone="muted">{t('adm.links.fromBio')}</Pill>}
                    {e.lang && <Pill size="xs" tone="muted">{e.lang.toUpperCase()}</Pill>}
                    {e.notified_at && <Pill size="xs" tone="pos">{t('adminWaitlist.notified')}</Pill>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap" style={{ color: T3, fontSize: 12 }}>
                    {e.first_name && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{e.first_name}{e.last_name ? ` ${e.last_name}` : ''}</span>}
                    {e.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{e.city}</span>}
                    <span className="flex items-center gap-1 tabular-nums"><Calendar className="h-3 w-3" />{fmtDate(e.created_at, language)}</span>
                  </div>
                </div>
                <Btn size="sm" variant="subtle" icon={Trash2} onClick={() => remove(e.id)} title={t('adm.common.delete')} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
