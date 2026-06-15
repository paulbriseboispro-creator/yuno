import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Mail, Save, Eye, Edit2, ArrowLeft, FileText, RefreshCw, Folder, FolderOpen, Send, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import EmailEditor from '@/components/email-editor/EmailEditor';
import {
  buildPreviewHtml, DEFAULT_THEME,
  type EmailBlock, type EmailTheme, type SocialLinks,
} from '@/lib/emailCampaign';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
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

const labelStyle: React.CSSProperties = { color: T2, fontSize: 12.5, fontWeight: 560 };

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 14px',
  borderRadius: 10, background: RED, border: '1px solid rgba(232,25,44,0.5)',
  color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px',
  borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`,
  color: T2, fontSize: 12.5, fontWeight: 560, cursor: 'pointer',
};

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

  const CATEGORIES: Record<string, { name: string; icon: string }> = {
    recap: { name: t('adminEmails.catRecap'), icon: '🌙' },
    auth: { name: t('adminEmails.catAuth'), icon: '🔐' },
    order: { name: t('adminEmails.catOrder'), icon: '🍸' },
    ticket: { name: t('adminEmails.catTicket'), icon: '🎫' },
    loyalty: { name: t('adminEmails.catLoyalty'), icon: '⭐' },
    general: { name: t('adminEmails.catGeneral'), icon: '📧' },
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
  const [infoTab, setInfoTab] = useState<'info' | 'code'>('info');
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
    setInfoTab('info');
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
      } as Record<string, unknown>).eq('id', selectedTemplate.id);
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
      const res = data as { success?: boolean; error?: string; message?: string } | null;
      if (res?.success === false) throw new Error(res?.error || t('adminEmails.sendError'));
      toast.success(res?.message || `Email sent to ${testEmail}`);
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <RefreshCw className="h-8 w-8 animate-spin" style={{ color: RED }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="flex items-center gap-2" style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
            <Mail className="h-6 w-6" style={{ color: RED }} />{t('adminEmails.title')}
          </h1>
          <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminEmails.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Folder tree */}
          <div className="space-y-2">
            <h2 className="mb-3" style={{ color: T3, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{t('adminEmails.folders')}</h2>
            {Object.entries(CATEGORIES).map(([catKey, catInfo]) => {
              const catTemplates = groupedTemplates[catKey] || [];
              if (catTemplates.length === 0) return null;
              const isExpanded = expandedCategories.has(catKey);
              return (
                <div key={catKey} className="space-y-1">
                  <button onClick={() => toggleCategory(catKey)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-left cursor-pointer" style={{ background: 'transparent', border: 'none' }}>
                    <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} style={{ color: T3 }} />
                    {isExpanded ? <FolderOpen className="h-5 w-5" style={{ color: RED }} /> : <Folder className="h-5 w-5" style={{ color: T3 }} />}
                    <span className="flex-1" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{catInfo.icon} {catInfo.name}</span>
                    <span className="tabular-nums" style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, background: C_FAINT, border: `1px solid ${F_BORDER}`, color: T3, fontSize: 11, fontWeight: 600 }}>{catTemplates.length}</span>
                  </button>
                  {isExpanded && (
                    <div className="ml-6 space-y-1">
                      {catTemplates.map((tpl) => {
                        const isSel = selectedTemplate?.id === tpl.id;
                        return (
                          <button
                            key={tpl.id}
                            onClick={() => handleSelectTemplate(tpl)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-left cursor-pointer"
                            style={isSel
                              ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED, fontSize: 13 }
                              : { background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 13 }}
                          >
                            <FileText className="h-4 w-4 flex-shrink-0" />
                            <span className="flex-1 truncate">{tpl.name}</span>
                            {!tpl.is_active && <span style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 7px', borderRadius: 999, border: `1px solid ${BORDER}`, color: T3, fontSize: 10.5, fontWeight: 600 }}>{t('adminEmails.inactive')}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selectedTemplate ? (
              <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden' }}>
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                  <div>
                    <h3 className="flex items-center gap-2" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                      <FileText className="h-5 w-5" style={{ color: T2 }} />{editMode ? t('adminEmails.editTemplate') : selectedTemplate.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-2">
                      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 999, background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 11, fontWeight: 600 }}>{CATEGORIES[selectedTemplate.category]?.icon} {CATEGORIES[selectedTemplate.category]?.name}</span>
                      <span style={{ color: T3, fontSize: 11.5 }}>•</span>
                      <span style={{ color: T3, fontSize: 11.5 }}>{new Date(selectedTemplate.updated_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {editMode ? (
                      <>
                        <button onClick={() => { setEditMode(false); handleSelectTemplate(selectedTemplate); }} style={secondaryBtn} className="transition-all duration-150"><ArrowLeft className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">{t('adminEmails.cancel')}</span></button>
                        <button onClick={handleSave} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.5 : 1 }} className="transition-all duration-150"><Save className="h-4 w-4 sm:mr-1" />{saving ? t('adminEmails.saving') : t('adminEmails.save')}</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setSendTestOpen(true)} className="transition-all duration-150" style={{ ...secondaryBtn, background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.22)', color: RED }}><Send className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">{t('adminEmails.sendTest')}</span></button>
                        <button onClick={() => setPreviewOpen(true)} style={secondaryBtn} className="transition-all duration-150"><Eye className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">{t('adminEmails.preview')}</span></button>
                        <button onClick={() => setEditMode(true)} style={primaryBtn} className="transition-all duration-150"><Edit2 className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">{t('adminEmails.editBtn')}</span></button>
                      </>
                    )}
                  </div>
                </div>

                {/* Body */}
                {editMode ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><label style={labelStyle}>{t('adminEmails.templateName')}</label><input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} style={inputStyle} /></div>
                      <div className="space-y-2"><label style={labelStyle}>{t('adminEmails.categoryLabel')}</label><select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' }}>{Object.entries(CATEGORIES).map(([key, cat]) => <option key={key} value={key}>{cat.icon} {cat.name}</option>)}</select></div>
                    </div>
                    <div className="flex items-center gap-2"><Switch checked={formData.is_active} onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })} /><label style={labelStyle}>{t('adminEmails.templateActive')}</label></div>
                    <div className="space-y-2"><label style={labelStyle}>{t('adminEmails.emailSubject')}</label><input value={formData.subject} onChange={(e) => setFormData({ ...formData, subject: e.target.value })} style={inputStyle} /></div>
                    <div className="space-y-2"><label style={labelStyle}>{t('adminEmails.previewText')}</label><input value={formData.preview_text} onChange={(e) => setFormData({ ...formData, preview_text: e.target.value })} style={inputStyle} /></div>
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
                  <div>
                    {/* Info / code tab bar */}
                    <div className="flex gap-0.5 mb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                      {([
                        { id: 'info' as const, label: t('adminEmails.info') },
                        { id: 'code' as const, label: t('adminEmails.htmlCode') },
                      ]).map(tab => {
                        const isActive = infoTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            onClick={() => setInfoTab(tab.id)}
                            className="relative inline-flex items-center gap-2 px-4 py-2.5 transition-colors duration-150 cursor-pointer"
                            style={{ color: isActive ? T1 : T3, fontSize: 13, fontWeight: 560, background: 'transparent', border: 'none' }}
                          >
                            {tab.label}
                            {isActive && <span className="absolute left-3 right-3 rounded-full" style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }} />}
                          </button>
                        );
                      })}
                    </div>
                    {infoTab === 'info' ? (
                      <div className="space-y-4 pt-1">
                        <div><label style={{ color: T3, fontSize: 12.5 }}>{t('adminEmails.subject')}</label><p style={{ color: T1, fontSize: 13.5, fontWeight: 560, marginTop: 2 }}>{selectedTemplate.subject}</p></div>
                        <div><label style={{ color: T3, fontSize: 12.5 }}>{t('adminEmails.previewText')}</label><p style={{ color: T1, fontSize: 13.5, fontWeight: 560, marginTop: 2 }}>{selectedTemplate.preview_text || '-'}</p></div>
                        <div><label style={{ color: T3, fontSize: 12.5 }}>{t('adminEmails.slug')}</label><p className="font-mono" style={{ color: T1, fontSize: 13, marginTop: 2 }}>{selectedTemplate.slug}</p></div>
                      </div>
                    ) : (
                      <pre className="p-4 rounded-xl overflow-auto max-h-[400px] font-mono" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 12 }}>{selectedTemplate.html_content}</pre>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '48px 22px', overflow: 'hidden' }}>
                <Folder className="h-9 w-9 mb-3" style={{ color: 'rgba(255,255,255,0.12)' }} />
                <p style={{ color: T3, fontSize: 13 }}>{t('adminEmails.selectTemplate')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
          <DialogHeader><DialogTitle style={{ color: T1 }}>{t('adminEmails.previewTitle')}</DialogTitle><DialogDescription style={{ color: T3 }}>{t('adminEmails.previewDesc')}</DialogDescription></DialogHeader>
          <div className="mt-4 rounded-lg p-4" style={{ background: 'hsl(0,0%,4%)' }}><div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(getPreviewHtml(), { ALLOWED_TAGS: ['p','div','span','table','tr','td','th','thead','tbody','a','img','strong','em','br','h1','h2','h3','h4','ul','ol','li','hr','b','i','u','center','font'], ALLOWED_ATTR: ['style','href','src','alt','width','height','cellpadding','cellspacing','border','align','valign','bgcolor','color','class','target','rel'] }) }} className="email-preview" /></div>
        </DialogContent>
      </Dialog>

      {/* Send test dialog */}
      <Dialog open={sendTestOpen} onOpenChange={setSendTestOpen}>
        <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
          <DialogHeader><DialogTitle className="flex items-center gap-2" style={{ color: T1 }}><Send className="h-5 w-5" style={{ color: RED }} />{t('adminEmails.sendTestTitle')}</DialogTitle><DialogDescription style={{ color: T3 }}>{t('adminEmails.sendTestDesc')}</DialogDescription></DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2"><label style={labelStyle}>{t('adminEmails.emailAddress')}</label><input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="your@email.com" style={inputStyle} /></div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setSendTestOpen(false)} style={secondaryBtn} className="transition-all duration-150">{t('adminEmails.cancel')}</button>
              <button onClick={handleSendTest} disabled={sendingTest || !testEmail} style={{ ...primaryBtn, opacity: (sendingTest || !testEmail) ? 0.5 : 1 }} className="transition-all duration-150">{sendingTest ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" />{t('adminEmails.sendingTest')}</> : <><Send className="h-4 w-4 mr-1" />{t('adminEmails.send')}</>}</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
