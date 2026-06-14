import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePromoterScope } from '@/hooks/usePromoterScope';
import { getScopeFilter, scopeId, scopeEventsOr } from '@/lib/promoterScopeHelpers';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Megaphone, Trash2, Calendar, Edit2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import {
  PromoHeader, PromoPage, PromoCard, SectionLabel, PromoPill, PromoButton, PromoEmpty,
  T1, T2, T3, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

interface Announcement {
  id: string;
  title: string;
  content: string;
  event_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Event { id: string; title: string; start_at: string; }

export default function OwnerPromoterAnnouncements() {
  const scope = usePromoterScope();
  const sid = scopeId(scope);
  const scopeFilter = getScopeFilter(scope);
  const venueLoading = scope.loading;
  const { basePath } = useDashboardMode();
  const { language, t } = useLanguage();
  const dfLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [formData, setFormData] = useState({ title: '', content: '', event_id: '' });

  useEffect(() => {
    if (sid) { fetchAnnouncements(); fetchEvents(); }
  }, [sid]);

  const fetchAnnouncements = async () => {
    if (!sid) return;
    try {
      const { data, error } = await supabase
        .from('promoter_announcements').select('*')
        .eq(scopeFilter.column, sid).order('created_at', { ascending: false });
      if (error) throw error;
      setAnnouncements(data || []);
    } catch (error) {
      console.error('Error fetching announcements:', error);
      toast.error(t('promoAnnounce.loadError'));
    } finally { setLoading(false); }
  };

  const fetchEvents = async () => {
    if (!sid) return;
    try {
      const orClause = scopeEventsOr(scope);
      let q = supabase.from('events').select('id, title, start_at')
        .eq('is_active', true).gte('end_at', new Date().toISOString())
        .order('start_at', { ascending: true });
      if (orClause) q = q.or(orClause);
      const { data, error } = await q;
      if (error) throw error;
      setEvents(data || []);
    } catch (error) { console.error('Error fetching events:', error); }
  };

  const handleSubmit = async () => {
    if (!sid || !formData.title || !formData.content) {
      toast.error(t('promoAnnounce.requiredFields'));
      return;
    }
    try {
      if (editingAnnouncement) {
        const { error } = await supabase.from('promoter_announcements').update({
          title: formData.title, content: formData.content,
          event_id: formData.event_id || null, updated_at: new Date().toISOString(),
        }).eq('id', editingAnnouncement.id);
        if (error) throw error;
        toast.success(t('promoAnnounce.updated'));
      } else {
        const { error } = await supabase.from('promoter_announcements').insert({
          ...scopeFilter.payload, title: formData.title, content: formData.content,
          event_id: formData.event_id || null,
        });
        if (error) throw error;
        toast.success(t('promoAnnounce.created'));
      }
      setDialogOpen(false); resetForm(); fetchAnnouncements();
    } catch (error) {
      console.error('Error saving announcement:', error);
      toast.error(t('promoAnnounce.saveError'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette annonce ?')) return;
    try {
      const { error } = await supabase.from('promoter_announcements').delete().eq('id', id);
      if (error) throw error;
      toast.success(t('promoAnnounce.deleted'));
      fetchAnnouncements();
    } catch (error) {
      console.error('Error deleting announcement:', error);
      toast.error(t('promoAnnounce.deleteError'));
    }
  };

  const openEditDialog = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    setFormData({ title: announcement.title, content: announcement.content, event_id: announcement.event_id || '' });
    setDialogOpen(true);
  };

  const resetForm = () => { setFormData({ title: '', content: '', event_id: '' }); setEditingAnnouncement(null); };

  const getEventTitle = (eventId: string | null) => {
    if (!eventId) return null;
    return events.find(e => e.id === eventId)?.title;
  };

  if (venueLoading || loading) return <OwnerPageSkeleton />;

  return (
    <>
      <PromoHeader
        title={t('promoAnnounce.title')}
        subtitle={t('promoAnnounce.subtitle')}
        backTo={`${basePath}/promoters`}
        right={<PromoButton size="sm" onClick={() => { resetForm(); setDialogOpen(true); }}><Plus className="h-4 w-4" />{t('promoAnnounce.newShort')}</PromoButton>}
      />

      <PromoPage maxWidth={720}>
        {announcements.length === 0 ? (
          <PromoEmpty
            icon={Megaphone}
            title={t('promoAnnounce.emptyTitle')}
            description={t('promoAnnounce.emptyDesc')}
            action={<PromoButton onClick={() => { resetForm(); setDialogOpen(true); }}><Plus className="h-4 w-4" />{t('promoAnnounce.createAnnouncement')}</PromoButton>}
          />
        ) : (
          <>
            <SectionLabel action={<span style={{ color: T3, fontSize: 11.5 }}>{announcements.length}</span>}>{t('promoAnnounce.title')}</SectionLabel>
            <div className="space-y-2.5">
              {announcements.map((a) => (
                <PromoCard key={a.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 style={{ color: T1, fontSize: 15, fontWeight: 640, margin: 0 }}>{a.title}</h3>
                      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 5 }}>
                        <span className="flex items-center gap-1" style={{ color: T3, fontSize: 11 }}>
                          <Calendar className="h-3 w-3" />
                          {format(new Date(a.created_at), 'dd MMM yyyy · HH:mm', { locale: dfLocale })}
                        </span>
                        {a.event_id && getEventTitle(a.event_id) && <PromoPill tone="red">{getEventTitle(a.event_id)}</PromoPill>}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-none">
                      <button onClick={() => openEditDialog(a)} aria-label="Modifier"
                        style={{ width: 30, height: 30, borderRadius: 8, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(a.id)} aria-label="Supprimer"
                        style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.2)', color: '#FF5C63', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p style={{ color: T2, fontSize: 13, lineHeight: 1.55, margin: 0, marginTop: 10, whiteSpace: 'pre-wrap' }}>{a.content}</p>
                </PromoCard>
              ))}
            </div>
          </>
        )}
      </PromoPage>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAnnouncement ? t('promoAnnounce.editTitle') : t('promoAnnounce.newTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="title">{t('promoAnnounce.fieldTitle')} *</Label>
              <Input id="title" value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder={t('promoAnnounce.titlePlaceholder')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">{t('promoAnnounce.content')} *</Label>
              <Textarea id="content" value={formData.content}
                onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                placeholder={t('promoAnnounce.contentPlaceholder')} rows={4} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event">{t('promoAnnounce.linkedEvent')}</Label>
              <Select value={formData.event_id || 'none'}
                onValueChange={(value) => setFormData(prev => ({ ...prev, event_id: value === 'none' ? '' : value }))}>
                <SelectTrigger><SelectValue placeholder={t('promoAnnounce.noEvent')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('promoAnnounce.noEvent')}</SelectItem>
                  {events.map((event) => (
                    <SelectItem key={event.id} value={event.id}>
                      {event.title} - {format(new Date(event.start_at), 'dd MMM', { locale: dfLocale })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <PromoButton variant="secondary" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</PromoButton>
              <PromoButton onClick={handleSubmit}>{editingAnnouncement ? t('common.save') : t('common.create')}</PromoButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
