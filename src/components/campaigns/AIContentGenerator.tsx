import { useState } from 'react';
import { Sparkles, Loader2, RefreshCw, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

export type AIGeneratedContent = { title: string; preheader: string; body: string };
type Lang = 'en' | 'fr' | 'es';
type Variant = Record<Lang, AIGeneratedContent>;

interface Props {
  channel: 'push' | 'email' | 'sms';
  eventId?: string | null;
  segment?: string | null;
  onApply: (content: AIGeneratedContent, lang: Lang) => void;
  // Optionnel : applique la variante dans les 3 langues (envoi multi-langue
  // par destinataire). La langue active sert d'aperçu/fallback.
  onApplyAll?: (variant: Record<Lang, AIGeneratedContent>, activeLang: Lang) => void;
}

const TONES = ['hype', 'elegant', 'friendly', 'urgent'] as const;
const LANGS: Lang[] = ['en', 'fr', 'es'];

// Génération de contenu marketing via l'action generate_marketing_content
// d'owner-assistant : 3 variantes × 3 langues, le résultat choisi remplit le
// formulaire parent via onApply — l'owner reste l'éditeur final.
export default function AIContentGenerator({ channel, eventId, segment, onApply, onApplyAll }: Props) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<string>('hype');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [activeLang, setActiveLang] = useState<Lang>((LANGS.includes(language as Lang) ? language : 'en') as Lang);

  const generate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('owner-assistant', {
        body: {
          action: 'generate_marketing_content',
          channel,
          eventId: eventId || undefined,
          segment: segment || undefined,
          tone,
          customInstructions: instructions.trim() || undefined,
        },
      });
      if (error) throw error;
      if (!Array.isArray(data?.variants) || data.variants.length === 0) throw new Error('empty');
      setVariants(data.variants as Variant[]);
    } catch {
      toast.error(t('aigen.error'));
    } finally {
      setLoading(false);
    }
  };

  const apply = (v: Variant) => {
    onApply(v[activeLang], activeLang);
    setOpen(false);
    toast.success(t('aigen.applied'));
  };

  const applyAll = (v: Variant) => {
    onApplyAll?.(v, activeLang);
    setOpen(false);
    toast.success(t('aigen.appliedAll'));
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 hover:bg-muted"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {t('aigen.button')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {t('aigen.title')}
            </DialogTitle>
            <DialogDescription>{t(`aigen.subtitle.${channel}`)}</DialogDescription>
          </DialogHeader>

          {/* Ton */}
          <div className="flex flex-wrap gap-2">
            {TONES.map((tn) => (
              <button
                key={tn}
                type="button"
                onClick={() => setTone(tn)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  tone === tn
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {t(`aigen.tone.${tn}`)}
              </button>
            ))}
          </div>

          {/* Instruction libre */}
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={t('aigen.instructionsPlaceholder')}
            maxLength={500}
            rows={2}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none resize-none placeholder:text-muted-foreground"
          />

          <Button type="button" onClick={generate} disabled={loading} className="w-full gap-2">
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : variants.length > 0
                ? <RefreshCw className="h-4 w-4" />
                : <Sparkles className="h-4 w-4" />}
            {variants.length > 0 ? t('aigen.regenerate') : t('aigen.generate')}
          </Button>

          {variants.length > 0 && (
            <div className="space-y-3">
              {/* Sélecteur de langue */}
              <div className="flex gap-1.5">
                {LANGS.map((lg) => (
                  <button
                    key={lg}
                    type="button"
                    onClick={() => setActiveLang(lg)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold uppercase border transition-colors ${
                      activeLang === lg
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {lg}
                  </button>
                ))}
              </div>

              {variants.map((v, i) => {
                const c = v[activeLang];
                return (
                  <div key={i} className="rounded-lg border border-border p-3 space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t('aigen.variant')} {i + 1}
                    </p>
                    {c.title && <p className="text-sm font-semibold">{c.title}</p>}
                    {c.preheader && <p className="text-xs text-muted-foreground">{c.preheader}</p>}
                    <p className="text-sm whitespace-pre-line leading-relaxed">{c.body}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => apply(v)}
                        className="gap-1.5"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {t('aigen.use')}
                      </Button>
                      {onApplyAll && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => applyAll(v)}
                          className="gap-1.5 hover:bg-muted"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t('aigen.useAll')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed">{t('aigen.disclaimer')}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
