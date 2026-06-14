import { useState, useEffect } from 'react';
import {
  Send,
  Users,
  Crown,
  UserCheck,
  UserX,
  Zap,
  TrendingUp,
  Mail,
  Loader2,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { EmailBuilder, EmailBlock } from './EmailBuilder';

interface CampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueId: string;
  venueName: string;
  venueLogo?: string | null;
  onSuccess?: () => void;
}

const CRM_SEGMENTS = [
  { value: 'all', icon: Users, color: 'text-blue-500' },
  { value: 'vip', icon: Crown, color: 'text-yellow-500' },
  { value: 'loyal', icon: UserCheck, color: 'text-green-500' },
  { value: 'inactive', icon: UserX, color: 'text-red-500' },
  { value: 'new', icon: Zap, color: 'text-purple-500' },
  { value: 'big_spenders', icon: TrendingUp, color: 'text-emerald-500' },
];

export function CampaignDialog({ 
  open, 
  onOpenChange, 
  venueId, 
  venueName, 
  venueLogo,
  onSuccess 
}: CampaignDialogProps) {
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState('design');
  const [sending, setSending] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);

  const [campaignForm, setCampaignForm] = useState({
    name: '',
    target_segment: 'all',
    blocks: [] as EmailBlock[],
  });

  // Segment labels
  const segmentLabels: Record<string, { en: string; es: string; fr: string }> = {
    all: { en: 'All Customers', es: 'Todos los Clientes', fr: 'Tous les Clients' },
    vip: { en: 'VIP (Gold & Platinum)', es: 'VIP (Oro y Platino)', fr: 'VIP (Or et Platine)' },
    loyal: { en: 'Loyal Customers', es: 'Clientes Fieles', fr: 'Clients Fidèles' },
    inactive: { en: 'Inactive (30+ days)', es: 'Inactivos (+30 días)', fr: 'Inactifs (+30 jours)' },
    new: { en: 'New Customers', es: 'Nuevos Clientes', fr: 'Nouveaux Clients' },
    big_spenders: { en: 'Big Spenders', es: 'Grandes Gastadores', fr: 'Gros Dépensiers' },
  };

  const getSegmentLabel = (segment: string) => {
    const labels = segmentLabels[segment];
    return labels?.[language as keyof typeof labels] || labels?.en || segment;
  };

  // Fetch recipient count when segment changes
  useEffect(() => {
    const fetchCount = async () => {
      if (!venueId) return;

      let query = supabase
        .from('customer_loyalty')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId);

      switch (campaignForm.target_segment) {
        case 'vip':
          query = query.in('tier', ['gold', 'platinum']);
          break;
        case 'loyal':
          query = query.gte('total_points_earned', 100);
          break;
        case 'new':
          query = query.lt('total_points_earned', 50);
          break;
        case 'big_spenders':
          query = query.gte('total_points_earned', 500);
          break;
      }

      const { count } = await query;
      setRecipientCount(count || 0);
    };

    fetchCount();
  }, [venueId, campaignForm.target_segment]);

  const handleSendTest = async () => {
    if (!testEmail || !campaignForm.name) {
      toast.error(t('owner.crm.fillRequired') || 'Please fill campaign name and test email');
      return;
    }

    setSendingTest(true);
    try {
      // First create/update campaign
      const { data: campaign, error: campaignError } = await supabase
        .from('crm_campaigns')
        .insert([{
          venue_id: venueId,
          name: campaignForm.name,
          target_segment: campaignForm.target_segment,
          message: getMessageFromBlocks(campaignForm.blocks),
          trigger_type: 'manual',
          segment_config: { blocks: campaignForm.blocks } as any,
        }])
        .select()
        .single();

      if (campaignError) throw campaignError;

      // Send test email
      const { data, error } = await supabase.functions.invoke('send-crm-campaign', {
        body: {
          campaignId: campaign.id,
          venueId,
          testEmail,
        },
      });

      if (error) throw error;

      toast.success(t('owner.crm.testSent') || 'Test email sent!');
    } catch (error) {
      console.error('Error sending test:', error);
      toast.error(t('owner.crm.testFailed') || 'Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  };

  const handleSendCampaign = async () => {
    if (!campaignForm.name || campaignForm.blocks.length === 0) {
      toast.error(t('owner.crm.fillRequired') || 'Please add a campaign name and at least one block');
      return;
    }

    setSending(true);
    try {
      // Create campaign
      const { data: campaign, error: campaignError } = await supabase
        .from('crm_campaigns')
        .insert([{
          venue_id: venueId,
          name: campaignForm.name,
          target_segment: campaignForm.target_segment,
          message: getMessageFromBlocks(campaignForm.blocks),
          trigger_type: 'manual',
          segment_config: { blocks: campaignForm.blocks } as any,
        }])
        .select()
        .single();

      if (campaignError) throw campaignError;

      // Send campaign
      const { data, error } = await supabase.functions.invoke('send-crm-campaign', {
        body: {
          campaignId: campaign.id,
          venueId,
        },
      });

      if (error) throw error;

      const sentCount = data?.sentCount || 0;
      toast.success(
        (t('owner.crm.campaignSent') || 'Campaign sent to {{count}} customers')
          .replace('{{count}}', String(sentCount))
      );

      onOpenChange(false);
      onSuccess?.();

      // Reset form
      setCampaignForm({
        name: '',
        target_segment: 'all',
        blocks: [],
      });
      setActiveTab('design');
    } catch (error) {
      console.error('Error sending campaign:', error);
      toast.error(t('owner.crm.sendFailed') || 'Failed to send campaign');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            {t('owner.crm.emailBuilder') || 'Email Builder'}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="design">
              {t('owner.crm.design') || 'Design'}
            </TabsTrigger>
            <TabsTrigger value="audience">
              {t('owner.crm.audience') || 'Audience'}
            </TabsTrigger>
            <TabsTrigger value="send">
              {t('owner.crm.sendTab') || 'Send'}
            </TabsTrigger>
          </TabsList>

          {/* Design Tab */}
          <TabsContent value="design" className="flex-1 overflow-hidden mt-4">
            <div className="space-y-4 h-full">
              <div>
                <Label>{t('owner.crm.campaignName') || 'Campaign Name'}</Label>
                <Input
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={t('owner.crm.campaignNamePlaceholder') || 'e.g. Weekend Special Offer'}
                />
              </div>
              
              <EmailBuilder
                blocks={campaignForm.blocks}
                onChange={(blocks) => setCampaignForm(prev => ({ ...prev, blocks }))}
                venueName={venueName}
                venueLogo={venueLogo}
              />
            </div>
          </TabsContent>

          {/* Audience Tab */}
          <TabsContent value="audience" className="mt-4">
            <div className="space-y-6">
              <div>
                <Label>{t('owner.crm.targetSegment') || 'Target Segment'}</Label>
                <Select
                  value={campaignForm.target_segment}
                  onValueChange={(value) => setCampaignForm(prev => ({ ...prev, target_segment: value }))}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRM_SEGMENTS.map(segment => {
                      const Icon = segment.icon;
                      return (
                        <SelectItem key={segment.value} value={segment.value}>
                          <div className="flex items-center gap-2">
                            <Icon className={`h-4 w-4 ${segment.color}`} />
                            <span>{getSegmentLabel(segment.value)}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t('owner.crm.estimatedRecipients') || 'Estimated recipients'}
                  </span>
                  <Badge variant="secondary" className="text-lg px-3">
                    {recipientCount !== null ? recipientCount : '...'}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {CRM_SEGMENTS.map(segment => {
                  const Icon = segment.icon;
                  const isSelected = campaignForm.target_segment === segment.value;
                  return (
                    <div
                      key={segment.value}
                      onClick={() => setCampaignForm(prev => ({ ...prev, target_segment: segment.value }))}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                        isSelected 
                          ? 'border-primary bg-primary/10' 
                          : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-5 w-5 ${segment.color}`} />
                        <span className="text-sm font-medium">{getSegmentLabel(segment.value)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          {/* Send Tab */}
          <TabsContent value="send" className="mt-4">
            <div className="space-y-6">
              {/* Summary */}
              <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-3">
                <h4 className="font-semibold">{t('owner.crm.summary') || 'Campaign Summary'}</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">{t('owner.crm.name') || 'Name'}:</span>
                    <p className="font-medium">{campaignForm.name || '-'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('owner.crm.segment') || 'Segment'}:</span>
                    <p className="font-medium">{getSegmentLabel(campaignForm.target_segment)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('owner.crm.blocksCount') || 'Blocks'}:</span>
                    <p className="font-medium">{campaignForm.blocks.length}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('owner.crm.recipients') || 'Recipients'}:</span>
                    <p className="font-medium">{recipientCount ?? '...'}</p>
                  </div>
                </div>
              </div>

              {/* Test Email */}
              <div className="space-y-2">
                <Label>{t('owner.crm.testEmailLabel') || 'Send a test email first'}</Label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="your@email.com"
                  />
                  <Button 
                    variant="outline" 
                    onClick={handleSendTest}
                    disabled={sendingTest || !testEmail}
                  >
                    {sendingTest ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t('owner.crm.sendTest') || 'Send Test'
                    )}
                  </Button>
                </div>
              </div>

              {/* Send Button */}
              <Button 
                className="w-full"
                size="lg"
                onClick={handleSendCampaign}
                disabled={sending || !campaignForm.name || campaignForm.blocks.length === 0}
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t('owner.crm.sending') || 'Sending...'}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    {(t('owner.crm.sendCampaign') || 'Send to {{count}} customers')
                      .replace('{{count}}', String(recipientCount ?? 0))}
                  </>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Helper to extract text message from blocks for backward compatibility
function getMessageFromBlocks(blocks: EmailBlock[]): string {
  const textBlocks = blocks.filter(b => b.type === 'text' || b.type === 'hero');
  const messages = textBlocks.map(b => b.content.text || b.content.title || '').filter(Boolean);
  return messages.join(' ');
}
