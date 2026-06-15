import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Plus, Bug, Lightbulb, MessageSquare, AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

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

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', width: '100%', outline: 'none',
};

const selectTriggerStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, height: 'auto', padding: '9px 12px',
};

interface Feedback {
  id: string;
  venue_id: string | null;
  venue_name?: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

interface Venue { id: string; name: string; }

// ─── Pill primitives ──────────────────────────────────────────────────────────
function pillStyle(color: string, bg: string, border: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
    borderRadius: 999, fontSize: 11, fontWeight: 600, color, background: bg, border: `1px solid ${border}`,
  };
}

export default function AdminFeedback() {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [formData, setFormData] = useState({ title: '', description: '', category: 'bug', priority: 'medium', venue_id: '' });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [feedbackRes, venuesRes] = await Promise.all([
        supabase.from('feedback_issues').select('*').order('created_at', { ascending: false }),
        supabase.from('venues').select('id, name'),
      ]);
      setVenues(venuesRes.data || []);
      setFeedbacks((feedbackRes.data || []).map(f => ({ ...f, venue_name: venuesRes.data?.find(v => v.id === f.venue_id)?.name })));
    } catch (error) { console.error('Error fetching data:', error); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!formData.title) { toast.error(t('adminFeedback.titleRequired')); return; }
    try {
      const { error } = await supabase.from('feedback_issues').insert({ title: formData.title, description: formData.description || null, category: formData.category, priority: formData.priority, venue_id: formData.venue_id || null });
      if (error) throw error;
      toast.success(t('adminFeedback.issueCreated'));
      setDialogOpen(false);
      setFormData({ title: '', description: '', category: 'bug', priority: 'medium', venue_id: '' });
      fetchData();
    } catch (error: any) { toast.error(error.message || 'Error'); }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const updates: any = { status };
      if (status === 'resolved') updates.resolved_at = new Date().toISOString();
      const { error } = await supabase.from('feedback_issues').update(updates).eq('id', id);
      if (error) throw error;
      toast.success(t('adminFeedback.statusUpdated'));
      fetchData();
    } catch (error: any) { toast.error(error.message || 'Error'); }
  };

  const updatePriority = async (id: string, priority: string) => {
    try {
      const { error } = await supabase.from('feedback_issues').update({ priority }).eq('id', id);
      if (error) throw error;
      toast.success(t('adminFeedback.priorityUpdated'));
      fetchData();
    } catch (error: any) { toast.error(error.message || 'Error'); }
  };

  const deleteFeedback = async (id: string) => {
    if (!confirm(t('adminFeedback.confirmDelete'))) return;
    try {
      const { error } = await supabase.from('feedback_issues').delete().eq('id', id);
      if (error) throw error;
      toast.success(t('adminFeedback.issueDeleted'));
      fetchData();
    } catch (error: any) { toast.error(error.message || 'Error'); }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'bug': return <Bug className="h-3.5 w-3.5" />;
      case 'feature': return <Lightbulb className="h-3.5 w-3.5" />;
      case 'complaint': return <MessageSquare className="h-3.5 w-3.5" />;
      default: return <AlertTriangle className="h-3.5 w-3.5" />;
    }
  };

  const getCategoryBadge = (category: string) => {
    const labels: Record<string, string> = { bug: 'Bug', feature: 'Feature', complaint: t('adminFeedback.complaint'), other: t('adminFeedback.other') };
    // single-accent: bug → RED, everything else neutral
    const style = category === 'bug'
      ? pillStyle(RED, 'rgba(232,25,44,0.1)', 'rgba(232,25,44,0.3)')
      : pillStyle(T1, C_FAINT, BORDER);
    return <span style={style}>{getCategoryIcon(category)}<span>{labels[category] || category}</span></span>;
  };

  const getPriorityBadge = (priority: string) => {
    const labels: Record<string, string> = { low: t('adminFeedback.low'), medium: t('adminFeedback.medium'), high: t('adminFeedback.high'), critical: t('adminFeedback.critical') };
    // single-accent: critical/high emphasis → RED, medium → faint, low → faint
    const style = (priority === 'critical' || priority === 'high')
      ? pillStyle(RED, 'rgba(232,25,44,0.1)', 'rgba(232,25,44,0.3)')
      : pillStyle(T2, C_FAINT, BORDER);
    return <span style={style}>{labels[priority] || priority}</span>;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open': return <Clock className="h-4 w-4" style={{ color: NEG }} />;
      case 'in_progress': return <AlertTriangle className="h-4 w-4" style={{ color: RED }} />;
      case 'resolved': return <CheckCircle className="h-4 w-4" style={{ color: POS }} />;
      case 'closed': return <XCircle className="h-4 w-4" style={{ color: T3 }} />;
      default: return <Clock className="h-4 w-4" style={{ color: T3 }} />;
    }
  };

  const filteredFeedbacks = feedbacks.filter(f => {
    if (filterStatus !== 'all' && f.status !== filterStatus) return false;
    if (filterCategory !== 'all' && f.category !== filterCategory) return false;
    return true;
  });

  const openCount = feedbacks.filter(f => f.status === 'open').length;
  const inProgressCount = feedbacks.filter(f => f.status === 'in_progress').length;
  const resolvedCount = feedbacks.filter(f => f.status === 'resolved').length;

  const statCards = [
    { label: t('adminFeedback.opened'), value: openCount, icon: Clock, color: NEG },
    { label: t('adminFeedback.inProgress'), value: inProgressCount, icon: AlertTriangle, color: RED },
    { label: t('adminFeedback.resolved'), value: resolvedCount, icon: CheckCircle, color: POS },
  ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-2 mx-auto" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          <p className="text-sm" style={{ color: T3 }}>{t('adminFeedback.title')}…</p>
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
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              {t('adminFeedback.title')}
            </h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminFeedback.subtitle')}</p>
          </div>
          <button
            onClick={() => setDialogOpen(true)}
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
            style={{ background: RED, color: '#fff', padding: '10px 16px', boxShadow: `0 0 18px -6px ${RED}88`, cursor: 'pointer' }}
          >
            <Plus className="h-4 w-4" />{t('adminFeedback.newIssue')}
          </button>
        </div>

        {/* KPI tiles */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          {statCards.map((c, i) => {
            const Icon = c.icon;
            return (
              <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '16px 18px', height: '100%' }} className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl flex-none" style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
                    <Icon className="h-5 w-5" style={{ color: c.color }} />
                  </div>
                  <div>
                    <p className="tabular-nums" style={{ color: c.color, fontSize: 24, fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>{c.value}</p>
                    <p style={{ color: T3, fontSize: 11, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{c.label}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[150px]" style={selectTriggerStyle}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('adminFeedback.allStatuses')}</SelectItem>
              <SelectItem value="open">{t('adminFeedback.open')}</SelectItem>
              <SelectItem value="in_progress">{t('adminFeedback.inProgress')}</SelectItem>
              <SelectItem value="resolved">{t('adminFeedback.resolved')}</SelectItem>
              <SelectItem value="closed">{t('adminFeedback.closed')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-full sm:w-[150px]" style={selectTriggerStyle}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('adminFeedback.allCategories')}</SelectItem>
              <SelectItem value="bug">Bug</SelectItem>
              <SelectItem value="feature">Feature</SelectItem>
              <SelectItem value="complaint">{t('adminFeedback.complaint')}</SelectItem>
              <SelectItem value="other">{t('adminFeedback.other')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Issues list */}
        <div className="space-y-3">
          {filteredFeedbacks.length === 0 ? (
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }} className="text-center py-12 px-4">
              <MessageSquare className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
              <p className="text-xs" style={{ color: T3 }}>{t('adminFeedback.noIssues')}</p>
            </div>
          ) : (
            filteredFeedbacks.map((feedback, index) => (
              <motion.div key={feedback.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.04, 0.3) }}>
                <div
                  onClick={() => setSelectedFeedback(feedback)}
                  className="cursor-pointer transition-all duration-150"
                  style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: 18, overflow: 'hidden' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">{getStatusIcon(feedback.status)}<h3 className="truncate" style={{ color: T1, fontSize: 14.5, fontWeight: 600 }}>{feedback.title}</h3></div>
                      {feedback.description && <p className="line-clamp-2 mb-2.5" style={{ color: T2, fontSize: 13, lineHeight: 1.5 }}>{feedback.description}</p>}
                      <div className="flex flex-wrap gap-2 items-center">
                        {getCategoryBadge(feedback.category)}
                        {getPriorityBadge(feedback.priority)}
                        {feedback.venue_name && <span style={pillStyle(T2, TILE_BG, BORDER)}>{feedback.venue_name}</span>}
                        <span className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>{format(new Date(feedback.created_at), 'dd MMM yyyy', { locale: dateLocale })}</span>
                      </div>
                    </div>
                    <Select value={feedback.status} onValueChange={(value) => { event?.stopPropagation(); updateStatus(feedback.id, value); }}>
                      <SelectTrigger className="w-[130px]" style={selectTriggerStyle} onClick={(e) => e.stopPropagation()}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">{t('adminFeedback.open')}</SelectItem>
                        <SelectItem value="in_progress">{t('adminFeedback.inProgress')}</SelectItem>
                        <SelectItem value="resolved">{t('adminFeedback.resolved')}</SelectItem>
                        <SelectItem value="closed">{t('adminFeedback.closed')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
            <DialogHeader>
              <DialogTitle style={{ color: T1 }}>{t('adminFeedback.newIssueTitle')}</DialogTitle>
              <DialogDescription style={{ color: T3 }}>{t('adminFeedback.newIssueDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div><Label htmlFor="title" style={{ color: T2 }}>{t('adminFeedback.issueTitle')}</Label><input id="title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder={t('adminFeedback.issueTitlePlaceholder')} style={{ ...inputStyle, marginTop: 6 }} /></div>
              <div><Label htmlFor="description" style={{ color: T2 }}>{t('adminFeedback.description')}</Label><textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder={t('adminFeedback.descriptionPlaceholder')} rows={4} style={{ ...inputStyle, marginTop: 6, resize: 'none', lineHeight: 1.5 }} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label style={{ color: T2 }}>{t('adminFeedback.category')}</Label><Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}><SelectTrigger style={{ ...selectTriggerStyle, marginTop: 6 }}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bug">Bug</SelectItem><SelectItem value="feature">Feature</SelectItem><SelectItem value="complaint">{t('adminFeedback.complaint')}</SelectItem><SelectItem value="other">{t('adminFeedback.other')}</SelectItem></SelectContent></Select></div>
                <div><Label style={{ color: T2 }}>{t('adminFeedback.priority')}</Label><Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}><SelectTrigger style={{ ...selectTriggerStyle, marginTop: 6 }}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">{t('adminFeedback.low')}</SelectItem><SelectItem value="medium">{t('adminFeedback.medium')}</SelectItem><SelectItem value="high">{t('adminFeedback.high')}</SelectItem><SelectItem value="critical">{t('adminFeedback.critical')}</SelectItem></SelectContent></Select></div>
              </div>
              <div><Label style={{ color: T2 }}>{t('adminFeedback.relatedClub')}</Label><Select value={formData.venue_id} onValueChange={(value) => setFormData({ ...formData, venue_id: value })}><SelectTrigger style={{ ...selectTriggerStyle, marginTop: 6 }}><SelectValue placeholder={t('adminFeedback.none')} /></SelectTrigger><SelectContent><SelectItem value="">{t('adminFeedback.none')}</SelectItem>{venues.map(venue => (<SelectItem key={venue.id} value={venue.id}>{venue.name}</SelectItem>))}</SelectContent></Select></div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setDialogOpen(false)} className="flex-1 inline-flex items-center justify-center rounded-xl text-[13px] font-medium cursor-pointer transition-all duration-150" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, padding: '10px 16px' }}>{t('adminFeedback.cancel')}</button>
                <button onClick={handleCreate} className="flex-1 inline-flex items-center justify-center rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150" style={{ background: RED, color: '#fff', padding: '10px 16px', boxShadow: `0 0 18px -6px ${RED}88` }}>{t('adminFeedback.createBtn')}</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!selectedFeedback} onOpenChange={() => setSelectedFeedback(null)}>
          <DialogContent className="max-w-2xl" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
            <DialogHeader>
              <DialogTitle style={{ color: T1 }}>{selectedFeedback?.title}</DialogTitle>
              <DialogDescription style={{ color: T3 }}>
                {selectedFeedback && format(new Date(selectedFeedback.created_at), 'dd MMMM yyyy HH:mm', { locale: dateLocale })}
              </DialogDescription>
            </DialogHeader>
            {selectedFeedback && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">{getCategoryBadge(selectedFeedback.category)}{getPriorityBadge(selectedFeedback.priority)}{selectedFeedback.venue_name && <span style={pillStyle(T2, TILE_BG, BORDER)}>{selectedFeedback.venue_name}</span>}</div>
                {selectedFeedback.description && <div><Label style={{ color: T3 }}>{t('adminFeedback.description')}</Label><p className="mt-1 whitespace-pre-wrap" style={{ color: T1, fontSize: 13.5, lineHeight: 1.5 }}>{selectedFeedback.description}</p></div>}
                <div className="grid grid-cols-2 gap-4">
                  <div><Label style={{ color: T2 }}>{t('adminFeedback.status')}</Label><Select value={selectedFeedback.status} onValueChange={(value) => { updateStatus(selectedFeedback.id, value); setSelectedFeedback({ ...selectedFeedback, status: value }); }}><SelectTrigger style={{ ...selectTriggerStyle, marginTop: 6 }}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">{t('adminFeedback.open')}</SelectItem><SelectItem value="in_progress">{t('adminFeedback.inProgress')}</SelectItem><SelectItem value="resolved">{t('adminFeedback.resolved')}</SelectItem><SelectItem value="closed">{t('adminFeedback.closed')}</SelectItem></SelectContent></Select></div>
                  <div><Label style={{ color: T2 }}>{t('adminFeedback.priority')}</Label><Select value={selectedFeedback.priority} onValueChange={(value) => { updatePriority(selectedFeedback.id, value); setSelectedFeedback({ ...selectedFeedback, priority: value }); }}><SelectTrigger style={{ ...selectTriggerStyle, marginTop: 6 }}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">{t('adminFeedback.low')}</SelectItem><SelectItem value="medium">{t('adminFeedback.medium')}</SelectItem><SelectItem value="high">{t('adminFeedback.high')}</SelectItem><SelectItem value="critical">{t('adminFeedback.critical')}</SelectItem></SelectContent></Select></div>
                </div>
                {selectedFeedback.resolved_at && <p style={{ color: POS, fontSize: 13 }}>{t('adminFeedback.resolvedOn').replace('{date}', format(new Date(selectedFeedback.resolved_at), 'dd MMMM yyyy HH:mm', { locale: dateLocale }))}</p>}
                <div className="flex gap-2 pt-2">
                  <button onClick={() => { deleteFeedback(selectedFeedback.id); setSelectedFeedback(null); }} className="inline-flex items-center justify-center rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150" style={{ background: 'rgba(255,92,99,0.12)', border: '1px solid rgba(255,92,99,0.3)', color: NEG, padding: '10px 16px' }}>{t('adminFeedback.delete')}</button>
                  <button onClick={() => setSelectedFeedback(null)} className="ml-auto inline-flex items-center justify-center rounded-xl text-[13px] font-medium cursor-pointer transition-all duration-150" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, padding: '10px 16px' }}>{t('adminFeedback.close')}</button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}
