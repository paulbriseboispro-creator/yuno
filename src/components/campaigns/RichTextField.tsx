import { useRef, useEffect, useState } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, Link as LinkIcon, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, User, Quote, Type,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  value: string;
  onChange: (html: string) => void;
  /** Merge tags offered in the "Variable" menu. Defaults to prénom/nom. */
  variables?: { key: string; label: string }[];
}

const SIZES = [
  { labelKey: 'em.rt.sizeSm', px: '13px' },
  { labelKey: 'em.rt.sizeNormal', px: '16px' },
  { labelKey: 'em.rt.sizeLg', px: '20px' },
  { labelKey: 'em.rt.sizeXl', px: '26px' },
];

const DEFAULT_VARIABLES = [
  { key: 'prenom', label: 'Prénom' },
  { key: 'nom', label: 'Nom' },
];

export default function RichTextField({ value, onChange, variables = DEFAULT_VARIABLES }: Props) {
  const { t } = useLanguage();
  const VARIABLES = variables;
  const ref = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);

  const sync = () => { if (ref.current) onChange(ref.current.innerHTML); };

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    sync();
  };

  const wrapSelection = (style: string) => {
    ref.current?.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    const span = document.createElement('span');
    span.setAttribute('style', style);
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(span);
      sel.addRange(r);
      sync();
    } catch { /* selection across blocks */ }
  };

  const setSize = (px: string) => wrapSelection(`font-size:${px};`);
  const setColor = (color: string) => exec('foreColor', color);
  const setHighlight = (color: string) => exec('hiliteColor', color);

  const insertVariable = (v: string) => {
    ref.current?.focus();
    document.execCommand('insertText', false, `{{${v}}}`);
    sync();
  };

  const openLinkDialog = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange();
    setLinkUrl('https://');
    setLinkOpen(true);
  };

  const confirmLink = () => {
    setLinkOpen(false);
    if (!linkUrl || linkUrl === 'https://') return;
    ref.current?.focus();
    if (savedRange.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
    }
    document.execCommand('createLink', false, linkUrl);
    sync();
  };

  const headingBlock = (tag: 'h2' | 'h3' | 'p' | 'blockquote') => {
    exec('formatBlock', tag.toUpperCase());
  };

  const Btn = ({ onClick, title, children, active }: any) => (
    <Button type="button" size="sm" variant={active ? 'secondary' : 'ghost'} className="h-7 w-7 p-0" onClick={onClick} title={title}>
      {children}
    </Button>
  );

  return (
    <>
      <div className="border border-border rounded-md bg-background">
        <div className="flex items-center gap-0.5 p-1.5 border-b border-border flex-wrap">
          <Btn onClick={() => exec('bold')} title={t('em.rt.bold')}><Bold className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => exec('italic')} title={t('em.rt.italic')}><Italic className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => exec('underline')} title={t('em.rt.underline')}><Underline className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => exec('strikeThrough')} title={t('em.rt.strike')}><Strikethrough className="w-3.5 h-3.5" /></Btn>

          <div className="w-px h-5 bg-border mx-1" />

          <Btn onClick={() => exec('justifyLeft')} title={t('em.rt.alignLeft')}><AlignLeft className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => exec('justifyCenter')} title={t('em.rt.alignCenter')}><AlignCenter className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => exec('justifyRight')} title={t('em.rt.alignRight')}><AlignRight className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => exec('justifyFull')} title={t('em.rt.justify')}><AlignJustify className="w-3.5 h-3.5" /></Btn>

          <div className="w-px h-5 bg-border mx-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 gap-1" title={t('em.rt.size')}>
                <Type className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {SIZES.map(s => (
                <DropdownMenuItem key={s.px} onClick={() => setSize(s.px)}>
                  <span style={{ fontSize: s.px, lineHeight: 1 }}>{t(s.labelKey)}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => headingBlock('h2')}><b>{t('em.rt.h2')}</b></DropdownMenuItem>
              <DropdownMenuItem onClick={() => headingBlock('h3')}><b>{t('em.rt.h3')}</b></DropdownMenuItem>
              <DropdownMenuItem onClick={() => headingBlock('p')}>{t('em.rt.paragraph')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <label className="relative h-7 w-7 flex items-center justify-center cursor-pointer rounded hover:bg-muted" title={t('em.rt.textColor')}>
            <span className="text-[10px] font-bold">A</span>
            <span className="absolute bottom-1 left-1 right-1 h-0.5 bg-foreground rounded-full" />
            <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="relative h-7 w-7 flex items-center justify-center cursor-pointer rounded hover:bg-muted" title={t('em.rt.highlight')}>
            <span className="text-[10px] font-bold bg-yellow-300 text-black px-1 rounded">A</span>
            <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => setHighlight(e.target.value)} />
          </label>

          <div className="w-px h-5 bg-border mx-1" />

          <Btn onClick={() => exec('insertUnorderedList')} title={t('em.rt.bulletList')}><List className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => exec('insertOrderedList')} title={t('em.rt.numberList')}><ListOrdered className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => headingBlock('blockquote')} title={t('em.rt.quote')}><Quote className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={openLinkDialog} title={t('em.rt.link')}><LinkIcon className="w-3.5 h-3.5" /></Btn>

          <div className="w-px h-5 bg-border mx-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1">
                <User className="w-3 h-3" /> {t('em.rt.variable')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {VARIABLES.map(v => (
                <DropdownMenuItem key={v.key} onClick={() => insertVariable(v.key)}>
                  {v.label} — <span className="font-mono ml-1 text-muted-foreground">{`{{${v.key}}}`}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
              e.preventDefault(); openLinkDialog();
            }
          }}
          className="min-h-[140px] p-3 text-sm focus:outline-none prose prose-sm max-w-none [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground"
          style={{ wordBreak: 'break-word' }}
        />
      </div>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('em.rt.insertLink')}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>{t('em.rt.url')}</Label>
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === 'Enter' && confirmLink()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>{t('em.common.cancel')}</Button>
            <Button onClick={confirmLink}>{t('em.rt.insert')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
