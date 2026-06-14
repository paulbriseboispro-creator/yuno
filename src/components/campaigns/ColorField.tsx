import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RotateCcw, Pipette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  defaultValue?: string;
  /** Optional swatches shown for quick picking */
  swatches?: string[];
}

const DEFAULT_SWATCHES = [
  '#000000', '#0a0a0a', '#ffffff', '#f3f4f6',
  '#dc2626', '#ea580c', '#d4af37', '#16a34a',
  '#0ea5e9', '#6366f1', '#a855f7', '#ec4899',
];

export default function ColorField({ label, value, onChange, defaultValue, swatches = DEFAULT_SWATCHES }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const tryEyedropper = async () => {
    const w: any = window;
    if (typeof w.EyeDropper === 'undefined') return;
    try {
      const ed = new w.EyeDropper();
      const res = await ed.open();
      if (res?.sRGBHex) onChange(res.sRGBHex);
    } catch { /* user cancelled */ }
  };

  const hasEyedropper = typeof (window as any).EyeDropper !== 'undefined';
  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(value);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs flex items-center justify-between gap-2">
        <span>{label}</span>
        {defaultValue && value.toLowerCase() !== defaultValue.toLowerCase() && (
          <button
            type="button"
            onClick={() => onChange(defaultValue)}
            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            title={t('em.cf.reset')}
          >
            <RotateCcw className="w-2.5 h-2.5" /> {t('em.cf.reset')}
          </button>
        )}
      </Label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="h-9 w-12 rounded-md border border-border cursor-pointer relative overflow-hidden shrink-0"
          style={{ background: isValidHex ? value : 'transparent' }}
          aria-label={`${t('em.cf.choose')} ${label}`}
        >
          {!isValidHex && <span className="absolute inset-0 flex items-center justify-center text-xs">?</span>}
        </button>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`font-mono text-xs h-9 ${!isValidHex ? 'border-destructive' : ''}`}
          maxLength={7}
        />
        {hasEyedropper && (
          <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={tryEyedropper} title={t('em.cf.eyedropper')}>
            <Pipette className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      {open && (
        <div className="grid grid-cols-6 gap-1.5 p-2 rounded-md border border-border bg-popover">
          <input
            type="color"
            value={isValidHex ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="col-span-6 h-8 w-full rounded cursor-pointer bg-transparent border border-border"
          />
          {swatches.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setOpen(false); }}
              className="h-7 w-full rounded border border-border hover:scale-110 transition-transform"
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}
