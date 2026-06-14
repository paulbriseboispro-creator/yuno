import { useState, useEffect, useRef } from 'react';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Send,
  Users,
  Monitor,
  Smartphone,
  TestTube,
  Loader2,
  GripVertical,
  Type,
  Image as ImageIcon,
  MousePointer,
  BarChart3,
  Minus,
  Sparkles,
  Mail,
  Eye,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { EmailCanvasBlock, type EmailBlock } from '@/components/crm/EmailCanvasBlock';

const SEGMENTS = [
  { value: 'all', labelKey: 'owner.crm.segmentAll' },
  { value: 'vip', labelKey: 'owner.crm.segmentVIP' },
  { value: 'loyal', labelKey: 'owner.crm.segmentLoyal' },
  { value: 'inactive', labelKey: 'owner.crm.segmentInactive' },
  { value: 'new', labelKey: 'owner.crm.segmentNew' },
  { value: 'big_spenders', labelKey: 'owner.crm.segmentBigSpenders' },
];

const BLOCK_TYPES = [
  { type: 'hero' as const, icon: Sparkles, labelKey: 'owner.crm.heroBlock' },
  { type: 'text' as const, icon: Type, labelKey: 'owner.crm.textBlock' },
  { type: 'cta' as const, icon: MousePointer, labelKey: 'owner.crm.ctaBlock' },
  { type: 'stats' as const, icon: BarChart3, labelKey: 'owner.crm.statsBlock' },
  { type: 'image' as const, icon: ImageIcon, labelKey: 'owner.crm.imageBlock' },
  { type: 'divider' as const, icon: Minus, labelKey: 'owner.crm.dividerBlock' },
];

// Yuno brand colors
const YUNO_COLORS = {
  background: '#0a0a0a',
  primary: '#dc2626',
  text: '#ffffff',
  textSecondary: '#9ca3af',
  border: 'rgba(255,255,255,0.1)',
};

export default function OwnerEmailCampaign() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { venueId, venue, loading: venueLoading } = useVenueContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Campaign state
  const [campaignName, setCampaignName] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [segment, setSegment] = useState('all');
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  
  // UI state
  const [recipientCount, setRecipientCount] = useState(0);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [sending, setSending] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showSendConfirmDialog, setShowSendConfirmDialog] = useState(false);

  // Fetch recipient count based on segment
  useEffect(() => {
    if (!venueId) return;
    
    const fetchRecipientCount = async () => {
      setLoadingRecipients(true);
      try {
        let query = supabase
          .from('customer_loyalty')
          .select('id', { count: 'exact', head: true })
          .eq('venue_id', venueId);
        
        switch (segment) {
          case 'vip':
            query = query.in('tier', ['gold', 'platinum']);
            break;
          case 'loyal':
            query = query.gte('total_points_earned', 100);
            break;
          case 'inactive':
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            query = query.lt('last_points_earned_at', thirtyDaysAgo.toISOString());
            break;
          case 'new':
            query = query.lt('total_points_earned', 50);
            break;
          case 'big_spenders':
            query = query.gte('total_points_earned', 500);
            break;
        }
        
        const { count, error } = await query;
        if (!error) {
          setRecipientCount(count || 0);
        }
      } catch (error) {
        console.error('Error fetching recipients:', error);
      }
      setLoadingRecipients(false);
    };
    
    fetchRecipientCount();
  }, [venueId, segment]);

  // Add block
  const handleAddBlock = (type: EmailBlock['type']) => {
    const newBlock: EmailBlock = {
      id: `block-${Date.now()}`,
      type,
      content: getDefaultContent(type),
    };
    setBlocks([...blocks, newBlock]);
    setSelectedBlockId(newBlock.id);
  };

  const getDefaultContent = (type: EmailBlock['type']): EmailBlock['content'] => {
    switch (type) {
      case 'hero':
        return { title: t('owner.crm.heroTitlePlaceholder'), subtitle: t('owner.crm.heroSubtitlePlaceholder') };
      case 'text':
        return { text: t('owner.crm.textPlaceholder') };
      case 'cta':
        return { buttonText: t('owner.crm.ctaPlaceholder'), buttonUrl: '' };
      case 'image':
        return { imageUrl: '', altText: '' };
      case 'stats':
        return {};
      case 'divider':
        return {};
      default:
        return {};
    }
  };

  // Update block
  const handleUpdateBlock = (blockId: string, updates: Partial<EmailBlock['content']>) => {
    setBlocks(blocks.map(b => 
      b.id === blockId ? { ...b, content: { ...b.content, ...updates } } : b
    ));
  };

  // Delete block
  const handleDeleteBlock = (blockId: string) => {
    setBlocks(blocks.filter(b => b.id !== blockId));
    if (selectedBlockId === blockId) {
      setSelectedBlockId(null);
    }
  };

  // Move block
  const handleMoveBlock = (blockId: string, direction: 'up' | 'down') => {
    const index = blocks.findIndex(b => b.id === blockId);
    if (index === -1) return;
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= blocks.length) return;
    
    const newBlocks = [...blocks];
    [newBlocks[index], newBlocks[newIndex]] = [newBlocks[newIndex], newBlocks[index]];
    setBlocks(newBlocks);
  };

  // Image upload
  const handleImageUpload = async (file: File) => {
    if (!venueId || !selectedBlockId) return;
    
    setUploadingImage(true);
    try {
      const fileName = `crm-images/${venueId}/${Date.now()}-${file.name}`;
      
      const { error: uploadError } = await supabase.storage
        .from('venue-assets')
        .upload(fileName, file);
      
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage
        .from('venue-assets')
        .getPublicUrl(fileName);
      
      handleUpdateBlock(selectedBlockId, { imageUrl: publicUrl });
      toast.success(t('owner.crm.imageUploaded'));
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error(t('owner.crm.imageUploadError'));
    }
    setUploadingImage(false);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error(t('owner.crm.imageTooLarge'));
        return;
      }
      handleImageUpload(file);
    }
  };

  // Save campaign
  const handleSaveCampaign = async (): Promise<string | null> => {
    if (!venueId || !campaignName.trim()) {
      toast.error(t('owner.crm.missingCampaignName'));
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('crm_campaigns')
        .insert([{
          venue_id: venueId,
          name: emailSubject || campaignName,
          message: blocks.find(b => b.type === 'text')?.content.text || '',
          target_segment: segment,
          trigger_type: 'manual',
          segment_config: { blocks, emailSubject } as any,
        }])
        .select('id')
        .single();
      
      if (error) throw error;
      return data.id;
    } catch (error) {
      console.error('Error saving campaign:', error);
      toast.error(t('owner.crm.saveError'));
      return null;
    }
  };

  // Send test email
  const handleSendTest = async () => {
    if (!testEmail.trim()) return;
    
    setSendingTest(true);
    try {
      const campaignId = await handleSaveCampaign();
      if (!campaignId) {
        setSendingTest(false);
        return;
      }

      const { error } = await supabase.functions.invoke('send-crm-campaign', {
        body: { campaignId, venueId, testEmail },
      });
      
      if (error) throw error;
      
      toast.success(t('owner.crm.testSent'));
      setShowTestDialog(false);
    } catch (error) {
      console.error('Error sending test:', error);
      toast.error(t('owner.crm.testError'));
    }
    setSendingTest(false);
  };

  // Send campaign to all recipients
  const handleSendCampaign = async () => {
    if (recipientCount === 0) {
      toast.error(t('owner.crm.noRecipients'));
      return;
    }
    
    setSending(true);
    try {
      const campaignId = await handleSaveCampaign();
      if (!campaignId) {
        setSending(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('send-crm-campaign', {
        body: { campaignId, venueId },
      });
      
      if (error) throw error;
      
      toast.success(t('owner.crm.campaignSent').replace('{{count}}', String(data?.sentCount || 0)));
      setShowSendConfirmDialog(false);
      navigate('/owner/loyalty');
    } catch (error) {
      console.error('Error sending campaign:', error);
      toast.error(t('owner.crm.sendError'));
    }
    setSending(false);
  };

  if (venueLoading) return <OwnerPageSkeleton />;

  return (
    <TooltipProvider>
      <div className="min-h-screen dashboard-gradient-bg flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate('/owner/loyalty')}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="font-semibold">{t('owner.crm.emailEditor')}</h1>
                <p className="text-xs text-muted-foreground">{venue?.name}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowTestDialog(true)}>
                <TestTube className="h-4 w-4 mr-1.5" />
                {t('owner.crm.sendTest')}
              </Button>
              <Button 
                size="sm"
                onClick={() => setShowSendConfirmDialog(true)}
                disabled={recipientCount === 0 || !campaignName.trim()}
              >
                <Send className="h-4 w-4 mr-1.5" />
                {t('owner.crm.sendTo').replace('{{count}}', String(recipientCount))}
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content - 3 Column Layout */}
        <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
          
          {/* Left Panel - Blocks Palette */}
          <div className="col-span-3 border-r border-border bg-card/50 flex flex-col">
            <div className="p-4 border-b border-border">
              <h3 className="font-medium text-sm mb-3">{t('owner.crm.addBlocks')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {BLOCK_TYPES.map(({ type, icon: Icon, labelKey }) => (
                  <button
                    key={type}
                    onClick={() => handleAddBlock(type)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border bg-background hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <span className="text-xs">{t(labelKey)}</span>
                  </button>
                ))}
              </div>
            </div>
            
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                {/* Campaign Settings */}
                <div className="space-y-3">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t('owner.crm.campaignSettings')}
                  </Label>
                  
                  <div className="space-y-2">
                    <Label className="text-xs">{t('owner.crm.campaignName')}</Label>
                    <Input
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                      placeholder={t('owner.crm.campaignNamePlaceholder')}
                      className="h-9 text-sm"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-xs">{t('owner.crm.emailSubject')}</Label>
                    <Input
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder={t('owner.crm.emailSubjectPlaceholder')}
                      className="h-9 text-sm"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-xs">{t('owner.crm.audience')}</Label>
                    <Select value={segment} onValueChange={setSegment}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEGMENTS.map(seg => (
                          <SelectItem key={seg.value} value={seg.value}>
                            {t(seg.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {loadingRecipients ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span>{t('owner.crm.recipientsCount').replace('{{count}}', String(recipientCount))}</span>
                      )}
                    </div>
                  </div>
                </div>

                <Separator />
                
                {/* Block List */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {t('owner.crm.emailBlocks')}
                    </Label>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">{t('owner.crm.clickToEdit')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  
                  {blocks.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      {t('owner.crm.noBlocksYet')}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {blocks.map((block, index) => (
                        <motion.div
                          key={block.id}
                          layout
                          className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                            selectedBlockId === block.id 
                              ? 'border-primary bg-primary/5' 
                              : 'border-border hover:border-primary/30'
                          }`}
                          onClick={() => setSelectedBlockId(block.id)}
                        >
                          <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                          <div className="flex-1 flex items-center gap-2">
                            {BLOCK_TYPES.find(bt => bt.type === block.type)?.icon && (
                              <span className="text-muted-foreground">
                                {(() => {
                                  const BlockIcon = BLOCK_TYPES.find(bt => bt.type === block.type)?.icon;
                                  return BlockIcon ? <BlockIcon className="h-3.5 w-3.5" /> : null;
                                })()}
                              </span>
                            )}
                            <span className="text-xs font-medium capitalize">{block.type}</span>
                          </div>
                          <Badge variant="secondary" className="text-xs px-1.5">
                            {index + 1}
                          </Badge>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </div>
          
          {/* Center - Email Preview with Inline Editing */}
          <div className="col-span-6 bg-muted/30 flex flex-col overflow-hidden">
            <div className="flex items-center justify-center gap-2 p-3 border-b border-border">
              <Button
                variant={previewMode === 'desktop' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setPreviewMode('desktop')}
              >
                <Monitor className="h-4 w-4 mr-1.5" />
                Desktop
              </Button>
              <Button
                variant={previewMode === 'mobile' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setPreviewMode('mobile')}
              >
                <Smartphone className="h-4 w-4 mr-1.5" />
                Mobile
              </Button>
            </div>
            
            <ScrollArea className="flex-1 p-4">
              <div className={`mx-auto ${previewMode === 'mobile' ? 'max-w-[375px]' : 'max-w-[600px]'}`}>
                {/* Email Preview */}
                <div 
                  className="rounded-lg overflow-hidden shadow-xl"
                  style={{ backgroundColor: YUNO_COLORS.background }}
                >
                  {/* Club Header */}
                  <div 
                    className="p-6 text-center border-b"
                    style={{ borderColor: YUNO_COLORS.border }}
                  >
                    {venue?.logoUrl && (
                      <img 
                        src={venue.logoUrl} 
                        alt={venue.name} 
                        className="h-12 mx-auto mb-3 rounded-lg object-contain"
                      />
                    )}
                    <h2
                      className="font-bold text-lg"
                      style={{ color: YUNO_COLORS.text }}
                    >
                      {venue?.name}
                    </h2>
                  </div>
                  
                  {/* Email Content - Inline Editable Blocks */}
                  <div className="p-4">
                    {blocks.length === 0 ? (
                      <div className="text-center py-12">
                        <Mail className="h-12 w-12 mx-auto mb-3 opacity-20" style={{ color: YUNO_COLORS.textSecondary }} />
                        <p style={{ color: YUNO_COLORS.textSecondary }} className="text-sm">
                          {t('owner.crm.addBlocksToStart')}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {blocks.map((block, index) => (
                          <EmailCanvasBlock
                            key={block.id}
                            block={block}
                            index={index}
                            totalBlocks={blocks.length}
                            isSelected={selectedBlockId === block.id}
                            onSelect={() => setSelectedBlockId(block.id)}
                            onUpdate={(updates) => handleUpdateBlock(block.id, updates)}
                            onMoveUp={() => handleMoveBlock(block.id, 'up')}
                            onMoveDown={() => handleMoveBlock(block.id, 'down')}
                            onDelete={() => handleDeleteBlock(block.id)}
                            onImageClick={() => fileInputRef.current?.click()}
                            uploadingImage={uploadingImage && selectedBlockId === block.id}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Yuno Footer */}
                  <div 
                    className="p-4 text-center border-t"
                    style={{ borderColor: YUNO_COLORS.border }}
                  >
                    <p style={{ color: YUNO_COLORS.textSecondary }} className="text-xs">
                      Powered by Yuno
                    </p>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
          
          {/* Right Panel - Contextual Help */}
          <div className="col-span-3 border-l border-border bg-card/50 flex flex-col">
            <div className="p-4 border-b border-border">
              <h3 className="font-medium text-sm">
                {selectedBlockId ? t('owner.crm.editBlock') : t('owner.crm.selectBlockToEdit')}
              </h3>
            </div>
            
            <ScrollArea className="flex-1">
              {selectedBlockId ? (
                <div className="p-4 space-y-4">
                  {/* Variables Quick Insert */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">{t('owner.crm.insertVariable')}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {['{{first_name}}', '{{venue_name}}', '{{total_points}}', '{{tier}}'].map(v => (
                        <Badge
                          key={v}
                          variant="secondary"
                          className="cursor-pointer hover:bg-primary/20 text-xs transition-colors"
                          onClick={() => {
                            const block = blocks.find(b => b.id === selectedBlockId);
                            if (block?.type === 'text') {
                              handleUpdateBlock(selectedBlockId, { 
                                text: (block.content.text || '') + ' ' + v 
                              });
                            }
                          }}
                        >
                          {v}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('owner.crm.clickToInsert')}
                    </p>
                  </div>

                  <Separator />

                  {/* Block Type Info */}
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">
                      {t('owner.crm.editInline')}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center">
                  <Eye className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    {t('owner.crm.selectBlockToEditDesc')}
                  </p>
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Test Email Dialog */}
        <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('owner.crm.sendTestEmail')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>{t('owner.crm.testEmailAddress')}</Label>
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="email@example.com"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowTestDialog(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSendTest} disabled={!testEmail.trim() || sendingTest}>
                {sendingTest && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('owner.crm.sendTest')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Send Confirm Dialog */}
        <Dialog open={showSendConfirmDialog} onOpenChange={setShowSendConfirmDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('owner.crm.confirmSend')}</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('owner.crm.campaignName')}</span>
                  <span className="text-sm font-medium">{campaignName || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('owner.crm.audience')}</span>
                  <span className="text-sm font-medium">{t(SEGMENTS.find(s => s.value === segment)?.labelKey || '')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('owner.crm.blocksCount')}</span>
                  <span className="text-sm font-medium">{blocks.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('owner.crm.recipients')}</span>
                  <span className="text-sm font-medium">{recipientCount}</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('owner.crm.sendConfirmDesc')}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSendConfirmDialog(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSendCampaign} disabled={sending}>
                {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Send className="h-4 w-4 mr-2" />
                {t('owner.crm.sendTo').replace('{{count}}', String(recipientCount))}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
