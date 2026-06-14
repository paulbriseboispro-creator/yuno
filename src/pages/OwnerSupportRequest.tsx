import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { ArrowLeft, Send, Bug, HelpCircle, Lightbulb, MoreHorizontal, Clock, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

const CATEGORIES = [
  { value: 'bug', icon: Bug, labelKey: 'support.catBug', priority: 'high' },
  { value: 'question', icon: HelpCircle, labelKey: 'support.catQuestion', priority: 'medium' },
  { value: 'feature', icon: Lightbulb, labelKey: 'support.catFeature', priority: 'low' },
  { value: 'other', icon: MoreHorizontal, labelKey: 'support.catOther', priority: 'medium' },
] as const;

interface FeedbackRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  created_at: string;
}

export default function OwnerSupportRequest() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { basePath } = useDashboardMode();
  const { user } = useAuth();
  const { venueId } = useOwnerVenue();

  const [category, setCategory] = useState<string>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);

  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const fetchHistory = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('feedback_issues')
      .select('id, title, description, category, priority, status, created_at')
      .eq('reported_by', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setHistory((data as FeedbackRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchHistory();
  }, [user]);

  const handleSubmit = async () => {
    if (!title.trim() || !user) return;
    setSending(true);
    const cat = CATEGORIES.find(c => c.value === category);
    const { error } = await supabase.from('feedback_issues').insert({
      title: title.trim(),
      description: description.trim() || null,
      category,
      priority: cat?.priority || 'medium',
      reported_by: user.id,
      venue_id: venueId || null,
    });
    setSending(false);
    if (error) {
      toast.error(t('support.errorSending'));
      return;
    }
    toast.success(t('support.sent'));
    setTitle('');
    setDescription('');
    fetchHistory();
  };

  const statusConfig: Record<string, { icon: typeof Clock; className: string; label: string }> = {
    open: { icon: Clock, className: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: t('support.statusOpen') },
    in_progress: { icon: Loader2, className: 'bg-blue-500/15 text-blue-400 border-blue-500/30', label: t('support.statusProgress') },
    resolved: { icon: CheckCircle, className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: t('support.statusResolved') },
    closed: { icon: CheckCircle, className: 'bg-muted text-muted-foreground border-border', label: t('support.statusClosed') },
  };

  return (
    <div className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <button onClick={() => navigate(`${basePath}/help`)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <AlertCircle className="w-5 h-5 text-primary" />
        <h1 className="text-sm font-bold">{t('support.title')}</h1>
      </div>

      <div className="max-w-2xl mx-auto p-4 sm:p-6 pb-24 space-y-6">
        {/* Category chips */}
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">{t('support.categoryLabel')}</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const active = category === cat.value;
              return (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                    active
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t(cat.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Subject */}
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">{t('support.subjectLabel')}</label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('support.subjectPlaceholder')}
            maxLength={200}
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">{t('support.descLabel')}</label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('support.descPlaceholder')}
            rows={4}
            maxLength={2000}
          />
        </div>

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={!title.trim() || sending}
          className="w-full"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
          {t('support.send')}
        </Button>

        {/* History */}
        <div>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{t('support.history')}</h2>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t('support.noHistory')}</p>
          ) : (
            <div className="space-y-2">
              {history.map(item => {
                const s = statusConfig[item.status] || statusConfig.open;
                const StatusIcon = s.icon;
                return (
                  <div key={item.id} className="p-3 rounded-lg border border-border bg-muted/20 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium flex-1">{item.title}</p>
                      <Badge variant="outline" className={cn('text-[10px] flex-shrink-0', s.className)}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {s.label}
                      </Badge>
                    </div>
                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground/60">
                      {format(new Date(item.created_at), 'dd MMM yyyy · HH:mm', { locale })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
