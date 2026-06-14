import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Mail, Save, Eye, Edit2, ArrowLeft, Code, FileText, RefreshCw, Folder, FolderOpen, Send, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EmailEditor from '@/components/email-editor/EmailEditor';
import {
  buildPreviewHtml, DEFAULT_THEME,
  type EmailBlock, type EmailTheme, type SocialLinks,
} from '@/lib/emailCampaign';

const ADMIN_VARIABLES = [
  { key: 'venue_name', label: 'Nom du lieu' },
  { key: 'event_name', label: 'Nom de l\'événement' },
  { key: 'event_date', label: 'Date de l\'événement' },
  { key: 'first_name', label: 'Prénom' },
  { key: 'visit_count', label: 'Nb de visites' },
  { key: 'tier', label: 'Palier' },
  { key: 'total_lifetime_points', label: 'Points cumulés' },
  { key: 'stats_section', label: 'Bloc statistiques' },
];

interface EmailTemplate { id: string; slug: string; name: string; subject: string; html_content: string; preview_text: string | null; is_active: boolean; category: string; created_at: string; updated_at: string; blocks_json?: EmailBlock[] | null; theme_json?: EmailTheme | null; editor_mode?: string | null; }

export default function AdminEmailTemplates() {
  const { t } = useLanguage();

  const CATEGORIES: Record<string, { name: string; icon: string; color: string }> = {
    recap: { name: t('adminEmails.catRecap'), icon: '🌙', color: 'bg-purple-500/20 text-purple-400' },
    auth: { name: t('adminEmails.catAuth'), icon: '🔐', color: 'bg-blue-500/20 text-blue-400' },
    order: { name: t('adminEmails.catOrder'), icon: '🍸', color: 'bg-amber-500/20 text-amber-400' },
    ticket: { name: t('adminEmails.catTicket'), icon: '🎫', color: 'bg-pink-500/20 text-pink-400' },
    loyalty: { name: t('adminEmails.catLoyalty'), icon: '⭐', color: 'bg-yellow-500/20 text-yellow-400' },
    general: { name: t('adminEmails.catGeneral'), icon: '📧', color: 'bg-gray-500/20 text-gray-400' },
  };

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendTestOpen, setSendTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['recap']));
  const [formData, setFormData] = useState({
    name: '', subject: '', html_content: '', preview_text: '', is_active: true, category: 'general',
    blocks_json: [] as EmailBlock[], theme_json: { ...DEFAULT_THEME } as Required<EmailTheme>, editor_mode: 'code',
  });

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase.from('email_templates').select('*').order('category').order('name');
      if (error) throw error;
      setTemplates((data || []) as unknown as EmailTemplate[]);
    } catch (error) { console.error('Error:', error); toast.error(t('adminEmails.loadError')); }
    finally { setLoading(false); }
  };

  const handleSelectTemplate = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setFormData({
      name: template.name, subject: template.subject, html_content: template.html_content,
      preview_text: template.preview_text || '', is_active: template.is_active, category: template.category || 'general',
      blocks_json: (template.blocks_json as EmailBlock[]) || [],
      theme_json: { ...DEFAULT_THEME, ...(template.theme_json || {}) },
      editor_mode: template.editor_mode || 'code',
    });
    setEditMode(false);
  };

  const handleSave = async () => {
    if (!selectedTemplate) return;
    setSaving(true);
    try {
      // In visual mode, the blocks are the source of truth — compile them to the
      // html_content the transactional send pipeline reads. No campaign footer.
      const html_content = formData.editor_mode === 'visual'
        ? buildPreviewHtml({
            blocks: formData.blocks_json, preheader: formData.preview_text,
            emailType: 'informational', venueName: '', theme: formData.theme_json,
            omitFooter: true, flush: true,
          })
        : formData.html_content;
      const { error } = await supabase.from('email_templates').update({
        name: formData.name, subject: formData.subject, html_content,
        preview_text: formData.preview_text || null, is_active: formData.is_active, category: formData.category,
        blocks_json: formData.editor_mode === 'visual' ? formData.blocks_json : null,
        theme_json: formData.editor_mode === 'visual' ? formData.theme_json : null,
        editor_mode: formData.editor_mode,
        updated_at: new Date().toISOString(),
      } as any).eq('id', selectedTemplate.id);
      if (error) throw error;
      toast.success(t('adminEmails.templateSaved'));
      setEditMode(false); fetchTemplates();
      setSelectedTemplate({ ...selectedTemplate, ...formData, html_content, updated_at: new Date().toISOString() });
    } catch (error) { toast.error(t('adminEmails.saveError')); }
    finally { setSaving(false); }
  };

  const handleSendTest = async () => {
    if (!selectedTemplate || !testEmail) return;
    setSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-test-email', { body: { templateId: selectedTemplate.id, recipientEmail: testEmail } });
      if (error) throw error;
      if ((data as any)?.success === false) throw new Error((data as any)?.error || t('adminEmails.sendError'));
      toast.success((data as any)?.message || `Email sent to ${testEmail}`);
      setSendTestOpen(false); setTestEmail('');
    } catch (error) { toast.error(error instanceof Error ? error.message : t('adminEmails.sendError')); }
    finally { setSendingTest(false); }
  };

  const toggleCategory = (category: string) => { setExpandedCategories(prev => { const next = new Set(prev); if (next.has(category)) next.delete(category); else next.add(category); return next; }); };

  const groupedTemplates = templates.reduce((acc, tpl) => { const cat = tpl.category || 'general'; if (!acc[cat]) acc[cat] = []; acc[cat].push(tpl); return acc; }, {} as Record<string, EmailTemplate[]>);

  const getPreviewHtml = () => {
    const statsHtml = `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="background:rgba(255,255,255,0.05);border-radius:12px;padding:20px;text-align:center;width:33%"><p style="color:#dc2626;margin:0;font-size:28px;font-weight:800">3</p><p style="color:#9ca3af;margin:4px 0 0;font-size:13px">drinks</p></td><td style="width:8px"></td><td style="background:rgba(255,255,255,0.05);border-radius:12px;padding:20px;text-align:center;width:33%"><p style="color:#22c55e;margin:0;font-size:28px;font-weight:800">45€</p><p style="color:#9ca3af;margin:4px 0 0;font-size:13px">spent</p></td><td style="width:8px"></td><td style="background:rgba(255,255,255,0.05);border-radius:12px;padding:20px;text-align:center;width:33%"><p style="color:#dc2626;margin:0;font-size:28px;font-weight:800">+45</p><p style="color:#9ca3af;margin:4px 0 0;font-size:13px">points</p></td></tr></table>`;
    return formData.html_content.replace(/\{\{venue_name\}\}/g, 'Casanova Club').replace(/\{\{venue_slug\}\}/g, 'casanova').replace(/\{\{event_name\}\}/g, 'Saturday Night Fever').replace(/\{\{event_date\}\}/g, '21 Jan 2026').replace(/\{\{first_name\}\}/g, 'Alex').replace(/\{\{visit_count\}\}/g, '5').replace(/\{\{tier\}\}/g, 'Gold').replace(/\{\{total_lifetime_points\}\}/g, '450').replace(/\{\{stats_section\}\}/g, statsHtml).replace(/\{\{#if first_name\}\}/g, '').replace(/\{\{\/if\}\}/g, '');
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2"><Mail className="h-6 w-6 text-primary" />{t('adminEmails.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('adminEmails.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-2">
            <h2 className="font-semibold text-foreground mb-3">{t('adminEmails.folders')}</h2>
            {Object.entries(CATEGORIES).map(([catKey, catInfo]) => {
              const catTemplates = groupedTemplates[catKey] || [];
              if (catTemplates.length === 0) return null;
              const isExpanded = expandedCategories.has(catKey);
              return (
                <div key={catKey} className="space-y-1">
                  <button onClick={() => toggleCategory(catKey)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left">
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    {isExpanded ? <FolderOpen className="h-5 w-5 text-primary" /> : <Folder className="h-5 w-5 text-muted-foreground" />}
                    <span className="flex-1 font-medium">{catInfo.icon} {catInfo.name}</span>
                    <Badge variant="secondary" className="text-xs">{catTemplates.length}</Badge>
                  </button>
                  {isExpanded && <div className="ml-6 space-y-1">{catTemplates.map((tpl) => (
                    <button key={tpl.id} onClick={() => handleSelectTemplate(tpl)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-left text-sm ${selectedTemplate?.id === tpl.id ? 'bg-primary/10 text-primary border border-primary/20' : 'hover:bg-muted/50 text-foreground'}`}>
                      <FileText className="h-4 w-4 flex-shrink-0" /><span className="flex-1 truncate">{tpl.name}</span>{!tpl.is_active && <Badge variant="outline" className="text-xs opacity-50">{t('adminEmails.inactive')}</Badge>}
                    </button>
                  ))}</div>}
                </div>
              );
            })}
          </div>

          <div className="lg:col-span-2">
            {selectedTemplate ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{editMode ? t('adminEmails.editTemplate') : selectedTemplate.name}</CardTitle>
                      <CardDescription className="flex items-center gap-2 mt-1">
                        <Badge className={CATEGORIES[selectedTemplate.category]?.color || ''}>{CATEGORIES[selectedTemplate.category]?.icon} {CATEGORIES[selectedTemplate.category]?.name}</Badge>
                        <span>•</span><span>{new Date(selectedTemplate.updated_at).toLocaleDateString()}</span>
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {editMode ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => { setEditMode(false); handleSelectTemplate(selectedTemplate); }}><ArrowLeft className="h-4 w-4 mr-1 sm:mr-2" /><span className="hidden sm:inline">{t('adminEmails.cancel')}</span></Button>
                          <Button size="sm" onClick={handleSave} disabled={saving}><Save className="h-4 w-4 mr-1 sm:mr-2" />{saving ? t('adminEmails.saving') : t('adminEmails.save')}</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setSendTestOpen(true)} className="text-primary border-primary/20 hover:bg-primary/10"><Send className="h-4 w-4 mr-1 sm:mr-2" /><span className="hidden sm:inline">{t('adminEmails.sendTest')}</span></Button>
                          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4 mr-1 sm:mr-2" /><span className="hidden sm:inline">{t('adminEmails.preview')}</span></Button>
                          <Button size="sm" onClick={() => setEditMode(true)}><Edit2 className="h-4 w-4 mr-1 sm:mr-2" /><span className="hidden sm:inline">{t('adminEmails.editBtn')}</span></Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {editMode ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>{t('adminEmails.templateName')}</Label><Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
                        <div className="space-y-2"><Label>{t('adminEmails.categoryLabel')}</Label><select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">{Object.entries(CATEGORIES).map(([key, cat]) => <option key={key} value={key}>{cat.icon} {cat.name}</option>)}</select></div>
                      </div>
                      <div className="flex items-center space-x-2"><Switch checked={formData.is_active} onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })} /><Label>{t('adminEmails.templateActive')}</Label></div>
                      <div className="space-y-2"><Label>{t('adminEmails.emailSubject')}</Label><Input value={formData.subject} onChange={(e) => setFormData({ ...formData, subject: e.target.value })} /></div>
                      <div className="space-y-2"><Label>{t('adminEmails.previewText')}</Label><Input value={formData.preview_text} onChange={(e) => setFormData({ ...formData, preview_text: e.target.value })} /></div>
                      <EmailEditor
                        blocks={formData.blocks_json}
                        onBlocksChange={(b) => setFormData(f => ({ ...f, blocks_json: b }))}
                        theme={formData.theme_json}
                        onThemeChange={(tm) => setFormData(f => ({ ...f, theme_json: tm }))}
                        socialLinks={{} as SocialLinks}
                        onSocialLinksChange={() => {}}
                        logoUrl={null}
                        onLogoUrlChange={() => {}}
                        subject={formData.subject}
                        onSubjectChange={(v) => setFormData(f => ({ ...f, subject: v }))}
                        preheader={formData.preview_text}
                        onPreheaderChange={(v) => setFormData(f => ({ ...f, preview_text: v }))}
                        variables={ADMIN_VARIABLES}
                        bucketFolder="admin/templates"
                        preview={{ venueName: 'Yuno', emailType: 'informational' }}
                        omitFooter
                        allowCodeMode
                        codeMode={formData.editor_mode === 'code'}
                        onCodeModeChange={(code) => setFormData(f => ({ ...f, editor_mode: code ? 'code' : 'visual' }))}
                        rawHtml={formData.html_content}
                        onRawHtmlChange={(v) => setFormData(f => ({ ...f, html_content: v }))}
                      />
                    </div>
                  ) : (
                    <Tabs defaultValue="info">
                      <TabsList><TabsTrigger value="info">{t('adminEmails.info')}</TabsTrigger><TabsTrigger value="code">{t('adminEmails.htmlCode')}</TabsTrigger></TabsList>
                      <TabsContent value="info" className="space-y-4 pt-4">
                        <div><Label className="text-muted-foreground">{t('adminEmails.subject')}</Label><p className="font-medium">{selectedTemplate.subject}</p></div>
                        <div><Label className="text-muted-foreground">{t('adminEmails.previewText')}</Label><p className="font-medium">{selectedTemplate.preview_text || '-'}</p></div>
                        <div><Label className="text-muted-foreground">{t('adminEmails.slug')}</Label><p className="font-mono text-sm">{selectedTemplate.slug}</p></div>
                      </TabsContent>
                      <TabsContent value="code" className="pt-4"><pre className="bg-muted/50 p-4 rounded-lg overflow-auto max-h-[400px] text-xs font-mono">{selectedTemplate.html_content}</pre></TabsContent>
                    </Tabs>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground"><Folder className="h-12 w-12 mb-4 opacity-50" /><p>{t('adminEmails.selectTemplate')}</p></CardContent></Card>
            )}
          </div>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader><DialogTitle>{t('adminEmails.previewTitle')}</DialogTitle><DialogDescription>{t('adminEmails.previewDesc')}</DialogDescription></DialogHeader>
          <div className="mt-4 bg-[hsl(0,0%,4%)] rounded-lg p-4"><div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(getPreviewHtml(), { ALLOWED_TAGS: ['p','div','span','table','tr','td','th','thead','tbody','a','img','strong','em','br','h1','h2','h3','h4','ul','ol','li','hr','b','i','u','center','font'], ALLOWED_ATTR: ['style','href','src','alt','width','height','cellpadding','cellspacing','border','align','valign','bgcolor','color','class','target','rel'] }) }} className="email-preview" /></div>
        </DialogContent>
      </Dialog>

      <Dialog open={sendTestOpen} onOpenChange={setSendTestOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-primary" />{t('adminEmails.sendTestTitle')}</DialogTitle><DialogDescription>{t('adminEmails.sendTestDesc')}</DialogDescription></DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2"><Label>{t('adminEmails.emailAddress')}</Label><Input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="your@email.com" /></div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setSendTestOpen(false)}>{t('adminEmails.cancel')}</Button>
              <Button onClick={handleSendTest} disabled={sendingTest || !testEmail}>{sendingTest ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />{t('adminEmails.sendingTest')}</> : <><Send className="h-4 w-4 mr-2" />{t('adminEmails.send')}</>}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
