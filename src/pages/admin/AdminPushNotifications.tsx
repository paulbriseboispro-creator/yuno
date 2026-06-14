import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Bell, Send, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface Campaign {
  id: string;
  title: string;
  body: string;
  url: string;
  segment: string;
  sent_count: number;
  created_at: string;
}

export default function AdminPushNotifications() {
  const { t } = useLanguage();
  
  const SEGMENTS = [
    { value: 'all', label: t('adminPush.segAll') },
    { value: 'active_30d', label: t('adminPush.segActive30d') },
    { value: 'inactive_30d', label: t('adminPush.segInactive30d') },
    { value: 'ticket_holders', label: t('adminPush.segTicketHolders') },
    { value: 'vip', label: t('adminPush.segVip') },
    { value: 'loyal', label: t('adminPush.segLoyal') },
  ];

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [segment, setSegment] = useState('all');
  const [sending, setSending] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
    const { data } = await supabase
      .from('push_campaigns' as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    setCampaigns((data as any) || []);
    setLoading(false);
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error(t('adminPush.titleAndMsgRequired'));
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-push-campaign', {
        body: { title: title.trim(), body: body.trim(), url: url.trim() || '/', segment }
      });

      if (error) throw error;

      toast.success(t('adminPush.notificationsSent').replace('{count}', String(data?.sent || 0)));
      setTitle('');
      setBody('');
      setUrl('/');
      setSegment('all');
      fetchCampaigns();
    } catch (error: any) {
      toast.error(error.message || t('adminPush.sendError'));
    } finally {
      setSending(false);
    }
  };

  const segmentLabel = (val: string) => SEGMENTS.find(s => s.value === val)?.label || val;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{t('adminPush.title')}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('adminPush.newCampaign')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>{t('adminPush.titleLabel')}</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="🔥 Ce soir à 23h..." className="mt-1" maxLength={80} />
          </div>
          <div>
            <Label>{t('adminPush.messageLabel')}</Label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Casanova ouvre ses portes..." className="mt-1" maxLength={200} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t('adminPush.ctaLink')}</Label>
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="/" className="mt-1" />
            </div>
            <div>
              <Label>{t('adminPush.segment')}</Label>
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEGMENTS.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleSend} disabled={sending} className="w-full">
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            {t('adminPush.sendNotification')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('adminPush.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t('adminPush.noCampaigns')}</p>
          ) : (
            <div className="space-y-3">
              {campaigns.map(c => (
                <div key={c.id} className="flex items-start justify-between p-3 rounded-lg border border-border/50">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{c.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.body}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-[10px]">{segmentLabel(c.segment)}</Badge>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(c.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <Badge className="ml-2 shrink-0">{t('adminPush.sent').replace('{count}', String(c.sent_count))}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
