import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, Send, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
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

const labelStyle: React.CSSProperties = {
  display: 'block', color: T3, fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
};

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
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
          >
            <Bell className="h-4 w-4" style={{ color: RED }} />
          </div>
          <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
            {t('adminPush.title')}
          </h1>
        </div>

        {/* New campaign form */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden' }}>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 18 }}>
            {t('adminPush.newCampaign')}
          </h3>
          <div className="space-y-4">
            <div>
              <label style={labelStyle}>{t('adminPush.titleLabel')}</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ce soir à 23h..." maxLength={80} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('adminPush.messageLabel')}</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Casanova ouvre ses portes..." maxLength={200} rows={3} style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label style={labelStyle}>{t('adminPush.ctaLink')}</label>
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder="/" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('adminPush.segment')}</label>
                <Select value={segment} onValueChange={setSegment}>
                  <SelectTrigger style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 13, height: 'auto', padding: '9px 12px' }}>
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
            <button
              onClick={handleSend}
              disabled={sending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
              style={{ background: RED, color: '#fff', padding: '11px 16px', boxShadow: `0 0 18px -6px ${RED}88`, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.6 : 1 }}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t('adminPush.sendNotification')}
            </button>
          </div>
        </div>

        {/* History */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden' }}>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 18 }}>
            {t('adminPush.history')}
          </h3>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-10 px-4">
              <Bell className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
              <p className="text-xs" style={{ color: T3 }}>{t('adminPush.noCampaigns')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {campaigns.map(c => (
                <div
                  key={c.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-xl"
                  style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-[560] truncate" style={{ color: T1, fontSize: 13 }}>{c.title}</p>
                    <p className="truncate" style={{ color: T3, fontSize: 12, marginTop: 2 }}>{c.body}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full"
                        style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 10, fontWeight: 600 }}
                      >
                        {segmentLabel(c.segment)}
                      </span>
                      <span className="flex items-center gap-1 tabular-nums" style={{ color: T3, fontSize: 10 }}>
                        <Clock className="h-3 w-3" />
                        {new Date(c.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <span
                    className="inline-flex items-center shrink-0 px-2.5 py-1 rounded-full tabular-nums"
                    style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS, fontSize: 11, fontWeight: 600 }}
                  >
                    {t('adminPush.sent').replace('{count}', String(c.sent_count))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
