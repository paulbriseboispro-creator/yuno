import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Users, Mail, MapPin, Calendar, Download, Search, Trash2, Send } from 'lucide-react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

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

  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t('adminWaitlist.title')}</h1>
          <p className="text-muted-foreground">{t('adminWaitlist.subtitle')}</p>
        </div>
        <Button onClick={exportToCsv} className="gap-2"><Download className="h-4 w-4" />{t('adminWaitlist.exportCSV')}</Button>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><Users className="h-8 w-8 text-primary opacity-50" /><div><p className="text-2xl font-bold">{stats.total}</p><p className="text-xs text-muted-foreground">{t('adminWaitlist.registered')}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><Mail className="h-8 w-8 text-accent opacity-50" /><div><p className="text-2xl font-bold">{stats.withName}</p><p className="text-xs text-muted-foreground">{t('adminWaitlist.withName')}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><MapPin className="h-8 w-8 text-emerald-500 opacity-50" /><div><p className="text-2xl font-bold">{stats.withCity}</p><p className="text-xs text-muted-foreground">{t('adminWaitlist.withCity')}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><Send className="h-8 w-8 text-violet-500 opacity-50" /><div><p className="text-2xl font-bold">{stats.notified}</p><p className="text-xs text-muted-foreground">{t('adminWaitlist.notified')}</p></div></div></CardContent></Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder={t('adminWaitlist.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center justify-between"><span>{t('adminWaitlist.registrations')} ({filteredEntries.length})</span></CardTitle></CardHeader>
        <CardContent>
          {filteredEntries.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{search ? t('adminWaitlist.noResults') : t('adminWaitlist.noRegistrations')}</p>
          ) : (
            <div className="space-y-2">
              {filteredEntries.map((entry, index) => (
                <motion.div key={entry.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }} className="flex items-center justify-between p-3 sm:p-4 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{entry.email}</p>
                      {entry.notified_at && <Badge variant="secondary" className="text-xs">{t('adminWaitlist.notified')}</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs sm:text-sm text-muted-foreground">
                      {entry.first_name && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{entry.first_name}</span>}
                      {entry.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{entry.city}</span>}
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(entry.created_at), 'dd MMM yyyy', { locale: dateLocale })}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(entry.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></Button>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
