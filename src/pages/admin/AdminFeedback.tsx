import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
      case 'bug': return <Bug className="h-4 w-4" />;
      case 'feature': return <Lightbulb className="h-4 w-4" />;
      case 'complaint': return <MessageSquare className="h-4 w-4" />;
      default: return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getCategoryBadge = (category: string) => {
    const colors: Record<string, string> = { bug: 'bg-red-500/20 text-red-500', feature: 'bg-blue-500/20 text-blue-500', complaint: 'bg-yellow-500/20 text-yellow-500', other: 'bg-gray-500/20 text-gray-500' };
    const labels: Record<string, string> = { bug: 'Bug', feature: 'Feature', complaint: t('adminFeedback.complaint'), other: t('adminFeedback.other') };
    return <Badge className={colors[category] || colors.other}>{getCategoryIcon(category)}<span className="ml-1">{labels[category] || category}</span></Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = { low: 'bg-gray-500/20 text-gray-500', medium: 'bg-yellow-500/20 text-yellow-500', high: 'bg-orange-500/20 text-orange-500', critical: 'bg-red-500/20 text-red-500' };
    const labels: Record<string, string> = { low: t('adminFeedback.low'), medium: t('adminFeedback.medium'), high: t('adminFeedback.high'), critical: t('adminFeedback.critical') };
    return <Badge className={colors[priority] || colors.medium}>{labels[priority] || priority}</Badge>;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open': return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'in_progress': return <AlertTriangle className="h-4 w-4 text-blue-500" />;
      case 'resolved': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'closed': return <XCircle className="h-4 w-4 text-gray-500" />;
      default: return <Clock className="h-4 w-4" />;
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

  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t('adminFeedback.title')}</h1>
          <p className="text-muted-foreground">{t('adminFeedback.subtitle')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="w-full sm:w-auto"><Plus className="h-4 w-4 mr-2" />{t('adminFeedback.newIssue')}</Button>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-3">
        <Card className="border-yellow-500/20"><CardContent className="p-4 flex items-center gap-3"><Clock className="h-8 w-8 text-yellow-500" /><div><p className="text-sm text-muted-foreground">{t('adminFeedback.opened')}</p><p className="text-2xl font-bold text-yellow-500">{openCount}</p></div></CardContent></Card>
        <Card className="border-blue-500/20"><CardContent className="p-4 flex items-center gap-3"><AlertTriangle className="h-8 w-8 text-blue-500" /><div><p className="text-sm text-muted-foreground">{t('adminFeedback.inProgress')}</p><p className="text-2xl font-bold text-blue-500">{inProgressCount}</p></div></CardContent></Card>
        <Card className="border-green-500/20"><CardContent className="p-4 flex items-center gap-3"><CheckCircle className="h-8 w-8 text-green-500" /><div><p className="text-sm text-muted-foreground">{t('adminFeedback.resolved')}</p><p className="text-2xl font-bold text-green-500">{resolvedCount}</p></div></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminFeedback.allStatuses')}</SelectItem>
            <SelectItem value="open">{t('adminFeedback.open')}</SelectItem>
            <SelectItem value="in_progress">{t('adminFeedback.inProgress')}</SelectItem>
            <SelectItem value="resolved">{t('adminFeedback.resolved')}</SelectItem>
            <SelectItem value="closed">{t('adminFeedback.closed')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminFeedback.allCategories')}</SelectItem>
            <SelectItem value="bug">Bug</SelectItem>
            <SelectItem value="feature">Feature</SelectItem>
            <SelectItem value="complaint">{t('adminFeedback.complaint')}</SelectItem>
            <SelectItem value="other">{t('adminFeedback.other')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {filteredFeedbacks.length === 0 ? (
          <Card><CardContent className="py-12 text-center"><p className="text-muted-foreground">{t('adminFeedback.noIssues')}</p></CardContent></Card>
        ) : (
          filteredFeedbacks.map((feedback, index) => (
            <motion.div key={feedback.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedFeedback(feedback)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">{getStatusIcon(feedback.status)}<h3 className="font-semibold truncate">{feedback.title}</h3></div>
                      {feedback.description && <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{feedback.description}</p>}
                      <div className="flex flex-wrap gap-2 items-center">
                        {getCategoryBadge(feedback.category)}
                        {getPriorityBadge(feedback.priority)}
                        {feedback.venue_name && <Badge variant="outline">{feedback.venue_name}</Badge>}
                        <span className="text-xs text-muted-foreground">{format(new Date(feedback.created_at), 'dd MMM yyyy', { locale: dateLocale })}</span>
                      </div>
                    </div>
                    <Select value={feedback.status} onValueChange={(value) => { event?.stopPropagation(); updateStatus(feedback.id, value); }}>
                      <SelectTrigger className="w-[130px]" onClick={(e) => e.stopPropagation()}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">{t('adminFeedback.open')}</SelectItem>
                        <SelectItem value="in_progress">{t('adminFeedback.inProgress')}</SelectItem>
                        <SelectItem value="resolved">{t('adminFeedback.resolved')}</SelectItem>
                        <SelectItem value="closed">{t('adminFeedback.closed')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('adminFeedback.newIssueTitle')}</DialogTitle>
            <DialogDescription>{t('adminFeedback.newIssueDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label htmlFor="title">{t('adminFeedback.issueTitle')}</Label><Input id="title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder={t('adminFeedback.issueTitlePlaceholder')} /></div>
            <div><Label htmlFor="description">{t('adminFeedback.description')}</Label><Textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder={t('adminFeedback.descriptionPlaceholder')} rows={4} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>{t('adminFeedback.category')}</Label><Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bug">Bug</SelectItem><SelectItem value="feature">Feature</SelectItem><SelectItem value="complaint">{t('adminFeedback.complaint')}</SelectItem><SelectItem value="other">{t('adminFeedback.other')}</SelectItem></SelectContent></Select></div>
              <div><Label>{t('adminFeedback.priority')}</Label><Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">{t('adminFeedback.low')}</SelectItem><SelectItem value="medium">{t('adminFeedback.medium')}</SelectItem><SelectItem value="high">{t('adminFeedback.high')}</SelectItem><SelectItem value="critical">{t('adminFeedback.critical')}</SelectItem></SelectContent></Select></div>
            </div>
            <div><Label>{t('adminFeedback.relatedClub')}</Label><Select value={formData.venue_id} onValueChange={(value) => setFormData({ ...formData, venue_id: value })}><SelectTrigger><SelectValue placeholder={t('adminFeedback.none')} /></SelectTrigger><SelectContent><SelectItem value="">{t('adminFeedback.none')}</SelectItem>{venues.map(venue => (<SelectItem key={venue.id} value={venue.id}>{venue.name}</SelectItem>))}</SelectContent></Select></div>
            <div className="flex gap-2 pt-4">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">{t('adminFeedback.cancel')}</Button>
              <Button onClick={handleCreate} className="flex-1">{t('adminFeedback.createBtn')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedFeedback} onOpenChange={() => setSelectedFeedback(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedFeedback?.title}</DialogTitle>
            <DialogDescription>
              {selectedFeedback && format(new Date(selectedFeedback.created_at), 'dd MMMM yyyy HH:mm', { locale: dateLocale })}
            </DialogDescription>
          </DialogHeader>
          {selectedFeedback && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">{getCategoryBadge(selectedFeedback.category)}{getPriorityBadge(selectedFeedback.priority)}{selectedFeedback.venue_name && <Badge variant="outline">{selectedFeedback.venue_name}</Badge>}</div>
              {selectedFeedback.description && <div><Label className="text-muted-foreground">{t('adminFeedback.description')}</Label><p className="mt-1 whitespace-pre-wrap">{selectedFeedback.description}</p></div>}
              <div className="grid grid-cols-2 gap-4">
                <div><Label>{t('adminFeedback.status')}</Label><Select value={selectedFeedback.status} onValueChange={(value) => { updateStatus(selectedFeedback.id, value); setSelectedFeedback({ ...selectedFeedback, status: value }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">{t('adminFeedback.open')}</SelectItem><SelectItem value="in_progress">{t('adminFeedback.inProgress')}</SelectItem><SelectItem value="resolved">{t('adminFeedback.resolved')}</SelectItem><SelectItem value="closed">{t('adminFeedback.closed')}</SelectItem></SelectContent></Select></div>
                <div><Label>{t('adminFeedback.priority')}</Label><Select value={selectedFeedback.priority} onValueChange={(value) => { updatePriority(selectedFeedback.id, value); setSelectedFeedback({ ...selectedFeedback, priority: value }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">{t('adminFeedback.low')}</SelectItem><SelectItem value="medium">{t('adminFeedback.medium')}</SelectItem><SelectItem value="high">{t('adminFeedback.high')}</SelectItem><SelectItem value="critical">{t('adminFeedback.critical')}</SelectItem></SelectContent></Select></div>
              </div>
              {selectedFeedback.resolved_at && <p className="text-sm text-green-500">{t('adminFeedback.resolvedOn').replace('{date}', format(new Date(selectedFeedback.resolved_at), 'dd MMMM yyyy HH:mm', { locale: dateLocale }))}</p>}
              <div className="flex gap-2 pt-4">
                <Button variant="destructive" onClick={() => { deleteFeedback(selectedFeedback.id); setSelectedFeedback(null); }}>{t('adminFeedback.delete')}</Button>
                <Button variant="outline" onClick={() => setSelectedFeedback(null)} className="ml-auto">{t('adminFeedback.close')}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
