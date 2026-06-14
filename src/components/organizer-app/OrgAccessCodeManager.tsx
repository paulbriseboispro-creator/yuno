import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Lock, RefreshCcw, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgCard, OrgButton, FieldLabel, RED, T1, T3, BORDER, INNER_BG } from '@/components/org-ui';

interface Props {
  eventId: string;
  initialCode: string | null;
  initialRequired: boolean;
  onUpdate?: () => void;
}

const generateCode = () =>
  Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

export default function OrgAccessCodeManager({ eventId, initialCode, initialRequired, onUpdate }: Props) {
  const { language } = useLanguage();
  const [code, setCode] = useState(initialCode ?? '');
  const [required, setRequired] = useState(initialRequired);
  const [saving, setSaving] = useState(false);
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const save = async (newCode: string, newRequired: boolean) => {
    setSaving(true);
    const { error } = await supabase
      .from('events')
      .update({ access_code: newCode || null, requires_access_code: newRequired })
      .eq('id', eventId);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success(t('Mis à jour', 'Updated')); onUpdate?.(); }
  };

  const regenerate = () => {
    // Regenerating invalidates every code already shared with buyers — confirm first.
    if (code && !confirm(t(
      'Régénérer le code ? Les codes déjà partagés ne fonctionneront plus.',
      'Regenerate the code? Codes already shared will stop working.'
    ))) return;
    const c = generateCode();
    setCode(c);
    save(c, required);
  };

  const toggle = (v: boolean) => {
    setRequired(v);
    if (v && !code) {
      const c = generateCode();
      setCode(c);
      save(c, v);
    } else {
      save(code, v);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(code);
    toast.success(t('Code copié', 'Code copied'));
  };

  return (
    <OrgCard style={{ padding: 20 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg p-2" style={{ background: 'rgba(232,25,44,0.1)' }}><Lock className="h-4 w-4" style={{ color: RED }} /></div>
          <div>
            <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t("Code d'accès", 'Access code')}</h3>
            <p className="mt-0.5" style={{ color: T3, fontSize: 11.5 }}>{t("Protégez l'achat de billets par un code partagé en privé.", 'Gate ticket purchase behind a code shared privately.')}</p>
          </div>
        </div>
        <Switch checked={required} onCheckedChange={toggle} disabled={saving} />
      </div>

      {required && (
        <div className="mt-4 space-y-2">
          <FieldLabel>{t('Code actuel', 'Current code')}</FieldLabel>
          <div className="flex gap-2">
            <div
              className="flex-1 rounded-xl px-3 py-2.5 text-center font-mono text-lg tracking-widest"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}
            >
              {code}
            </div>
            <OrgButton variant="secondary" className="!px-3" onClick={copy}><Copy className="h-4 w-4" /></OrgButton>
            <OrgButton variant="secondary" className="!px-3" onClick={regenerate}><RefreshCcw className="h-4 w-4" /></OrgButton>
          </div>
        </div>
      )}
    </OrgCard>
  );
}
