import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  Monitor, Smartphone, Eye, Loader2, Plus, Settings2, Code, LayoutGrid, MousePointerClick,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  buildPreviewHtml, newBlock,
  type EmailBlock, type EmailTheme, type SocialLinks,
} from '@/lib/emailCampaign';
import { BLOCK_TYPES } from './templates';
import BlockTypePicker from './BlockTypePicker';
import BlockInspector from './BlockInspector';
import GlobalSettings from './GlobalSettings';

export interface EmailEditorProps {
  blocks: EmailBlock[];
  onBlocksChange: (b: EmailBlock[]) => void;
  theme: Required<EmailTheme>;
  onThemeChange: (t: Required<EmailTheme>) => void;
  socialLinks: SocialLinks;
  onSocialLinksChange: (v: SocialLinks) => void;
  logoUrl: string | null;
  onLogoUrlChange: (v: string | null) => void;
  subject: string;
  onSubjectChange: (v: string) => void;
  preheader: string;
  onPreheaderChange: (v: string) => void;
  name?: string;
  onNameChange?: (v: string) => void;
  variables?: { key: string; label: string }[];
  bucketFolder: string;
  events?: { id: string; title: string; start_at: string }[];
  preview: { venueName: string; city?: string | null; emailType: 'promotional' | 'informational' };
  /** Omit campaign footer/social/unsubscribe (transactional admin templates). */
  omitFooter?: boolean;
  onSendTest?: () => void;
  sending?: boolean;
  // Code mode (admin transactional templates with conditional logic)
  allowCodeMode?: boolean;
  codeMode?: boolean;
  onCodeModeChange?: (v: boolean) => void;
  rawHtml?: string;
  onRawHtmlChange?: (v: string) => void;
}

export default function EmailEditor(props: EmailEditorProps) {
  const {
    blocks, onBlocksChange, theme, onThemeChange, socialLinks, onSocialLinksChange,
    logoUrl, onLogoUrlChange, subject, onSubjectChange, preheader, onPreheaderChange,
    name, onNameChange, variables, bucketFolder, events = [], preview, omitFooter,
    onSendTest, sending, allowCodeMode, codeMode, onCodeModeChange, rawHtml = '', onRawHtmlChange,
  } = props;
  const { t } = useLanguage();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [insertTarget, setInsertTarget] = useState<null | 'end' | { afterId: string }>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const blockContext = { venue_name: preview.venueName, logo_url: logoUrl };

  // ── Block operations ────────────────────────────────────────────────
  const updateBlock = useCallback((id: string, patch: Record<string, unknown>) => {
    onBlocksChange(blocks.map(b => b.id === id ? { ...b, ...patch } as EmailBlock : b));
  }, [blocks, onBlocksChange]);

  const removeBlock = useCallback((id: string) => {
    onBlocksChange(blocks.filter(b => b.id !== id));
    if (selectedRef.current === id) setSelectedId(null);
  }, [blocks, onBlocksChange]);

  const duplicateBlock = useCallback((id: string) => {
    const i = blocks.findIndex(b => b.id === id);
    if (i < 0) return;
    const copy = { ...blocks[i], id: crypto.randomUUID() } as EmailBlock;
    onBlocksChange([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)]);
    setSelectedId(copy.id);
  }, [blocks, onBlocksChange]);

  const moveBlock = useCallback((id: string, dir: -1 | 1) => {
    const i = blocks.findIndex(b => b.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const c = [...blocks];
    [c[i], c[j]] = [c[j], c[i]];
    onBlocksChange(c);
  }, [blocks, onBlocksChange]);

  const insertBlock = useCallback((block: EmailBlock, target: 'end' | { afterId: string }) => {
    if (target === 'end') {
      onBlocksChange([...blocks, block]);
    } else {
      const i = blocks.findIndex(b => b.id === target.afterId);
      const at = i < 0 ? blocks.length : i + 1;
      onBlocksChange([...blocks.slice(0, at), block, ...blocks.slice(at)]);
    }
    setSelectedId(block.id);
  }, [blocks, onBlocksChange]);

  // ── Canvas <-> parent messaging ─────────────────────────────────────
  const pushSelection = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'setSelected', id: selectedRef.current }, '*');
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== 'yuno-email-editor') return;
      if (d.type === 'select') setSelectedId(d.id || null);
      else if (d.type === 'insertAfter') setInsertTarget({ afterId: d.id });
      else if (d.type === 'ready') pushSelection();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [pushSelection]);

  // Re-assert highlight whenever selection changes (no iframe reload).
  useEffect(() => { pushSelection(); }, [selectedId, pushSelection]);

  // Inject the campaign-level logo into header blocks for the live canvas only
  // (stored blocks stay clean; the send pipeline injects the same way).
  const blocksWithLogo = useMemo(() => blocks.map(b => (
    b.type === 'header' && !(b as any).logo_url && logoUrl ? { ...b, logo_url: logoUrl } : b
  )), [blocks, logoUrl]);

  const previewHtml = useMemo(() => buildPreviewHtml({
    blocks: blocksWithLogo, preheader, emailType: preview.emailType,
    venueName: preview.venueName, city: preview.city,
    theme, socialLinks, flush: true, editable: true, omitFooter,
  }), [blocksWithLogo, preheader, preview.emailType, preview.venueName, preview.city, theme, socialLinks, omitFooter]);

  const selectedBlock = blocks.find(b => b.id === selectedId) || null;

  // ── Code mode (admin) ───────────────────────────────────────────────
  const insertVariable = (key: string) => {
    const ta = codeRef.current;
    if (!ta || !onRawHtmlChange) return;
    const start = ta.selectionStart ?? rawHtml.length;
    const end = ta.selectionEnd ?? rawHtml.length;
    const tag = `{{${key}}}`;
    onRawHtmlChange(rawHtml.slice(0, start) + tag + rawHtml.slice(end));
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + tag.length; });
  };

  const isCode = !!codeMode;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {!isCode && (
            <BlockTypePicker onAdd={(b) => insertBlock(b, 'end')} blockContext={blockContext} align="start">
              <Button size="sm" variant="default" className="gap-1.5"><Plus className="w-4 h-4" /> {t('em.ed.block')}</Button>
            </BlockTypePicker>
          )}
          {allowCodeMode && (
            <div className="flex gap-0.5 p-0.5 bg-muted rounded-md">
              <Button size="sm" variant={!isCode ? 'default' : 'ghost'} className="h-7 px-2 gap-1 text-xs" onClick={() => onCodeModeChange?.(false)}>
                <LayoutGrid className="w-3.5 h-3.5" /> {t('em.ed.visual')}
              </Button>
              <Button size="sm" variant={isCode ? 'default' : 'ghost'} className="h-7 px-2 gap-1 text-xs" onClick={() => onCodeModeChange?.(true)}>
                <Code className="w-3.5 h-3.5" /> {t('em.ed.code')}
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isCode && (
            <div className="flex gap-1 p-0.5 bg-muted rounded-md">
              <Button size="sm" variant={previewMode === 'desktop' ? 'default' : 'ghost'} className="h-7 px-2" onClick={() => setPreviewMode('desktop')}><Monitor className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant={previewMode === 'mobile' ? 'default' : 'ghost'} className="h-7 px-2" onClick={() => setPreviewMode('mobile')}><Smartphone className="w-3.5 h-3.5" /></Button>
            </div>
          )}
          {onSendTest && (
            <Button size="sm" variant="outline" onClick={onSendTest} disabled={sending} className="h-7 text-xs gap-1">
              {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />} {t('em.ed.test')}
            </Button>
          )}
        </div>
      </div>

      {isCode ? (
        /* ── CODE MODE ── */
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs"><Code className="w-3.5 h-3.5" /> {t('em.ed.htmlContent')}</Label>
            <Textarea ref={codeRef} value={rawHtml} onChange={e => onRawHtmlChange?.(e.target.value)} className="font-mono text-xs min-h-[480px]" />
            {variables && variables.length > 0 && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium mb-2">{t('em.ed.varsAvailable')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {variables.map(v => (
                    <button key={v.key} onClick={() => insertVariable(v.key)}
                      className="font-mono text-[11px] bg-background px-2 py-1 rounded border hover:border-primary/60 transition-colors">
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div>
            <Label className="mb-2 block text-xs">{t('em.ed.preview')}</Label>
            <div className="border rounded-lg overflow-hidden bg-muted/30 p-3 flex justify-center">
              <iframe srcDoc={rawHtml} className="bg-white rounded shadow-sm w-full" style={{ height: 600, maxWidth: 600 }} title="preview-code" />
            </div>
          </div>
        </div>
      ) : (
        /* ── VISUAL MODE ── */
        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
          {/* Interactive canvas */}
          <div className="border rounded-lg overflow-hidden bg-muted/30 p-4 flex justify-center min-w-0">
            <iframe
              ref={iframeRef}
              srcDoc={previewHtml}
              className="bg-white rounded shadow-sm w-full transition-[max-width]"
              style={{ height: 720, maxWidth: previewMode === 'mobile' ? 360 : 600 }}
              title="email-canvas"
            />
          </div>

          {/* Contextual panel */}
          <div className="lg:sticky lg:top-4 lg:self-start min-w-0">
            <div className="border rounded-lg bg-card">
              {selectedBlock ? (
                <div className="p-4">
                  <button onClick={() => setSelectedId(null)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3">
                    <Settings2 className="w-3.5 h-3.5" /> {t('em.ed.globalSettings')}
                  </button>
                  <BlockInspector
                    block={selectedBlock}
                    theme={theme}
                    events={events}
                    bucketFolder={bucketFolder}
                    variables={variables}
                    isFirst={blocks[0]?.id === selectedBlock.id}
                    isLast={blocks[blocks.length - 1]?.id === selectedBlock.id}
                    onUpdate={(patch) => updateBlock(selectedBlock.id, patch)}
                    onMoveUp={() => moveBlock(selectedBlock.id, -1)}
                    onMoveDown={() => moveBlock(selectedBlock.id, 1)}
                    onDuplicate={() => duplicateBlock(selectedBlock.id)}
                    onRemove={() => removeBlock(selectedBlock.id)}
                  />
                </div>
              ) : (
                <ScrollArea className="max-h-[680px]">
                  <div className="p-4">
                    {blocks.length > 0 && (
                      <p className="text-xs text-muted-foreground mb-4 inline-flex items-center gap-1.5">
                        <MousePointerClick className="w-3.5 h-3.5" /> {t('em.ed.clickHint')}
                      </p>
                    )}
                    <GlobalSettings
                      subject={subject} onSubjectChange={onSubjectChange}
                      preheader={preheader} onPreheaderChange={onPreheaderChange}
                      name={name} onNameChange={onNameChange}
                      logoUrl={logoUrl} onLogoUrlChange={onLogoUrlChange}
                      theme={theme} onThemeChange={onThemeChange}
                      socialLinks={socialLinks} onSocialLinksChange={onSocialLinksChange}
                      bucketFolder={bucketFolder}
                      showLogo={!omitFooter} showSocial={!omitFooter}
                    />
                  </div>
                </ScrollArea>
              )}
            </div>

            {blocks.length === 0 && (
              <div className="mt-3">
                <BlockTypePicker onAdd={(b) => insertBlock(b, 'end')} blockContext={blockContext} align="start">
                  <Button variant="outline" className="w-full gap-1.5"><Plus className="w-4 h-4" /> {t('em.ed.addFirstBlock')}</Button>
                </BlockTypePicker>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inline insert picker (triggered by the "+" zones inside the canvas) */}
      <Dialog open={insertTarget !== null} onOpenChange={(o) => !o && setInsertTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>{t('em.ed.addBlock')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {BLOCK_TYPES.map(({ type, labelKey, Icon }) => (
              <button
                key={type}
                onClick={() => {
                  if (insertTarget) insertBlock(newBlock(type, blockContext), insertTarget);
                  setInsertTarget(null);
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-lg border border-border py-3 hover:border-primary/60 hover:bg-primary/5 transition-colors"
              >
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-[10px] text-center leading-tight">{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
