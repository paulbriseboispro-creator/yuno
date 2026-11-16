/**
 * Un groupe de réglages numériques du moteur de notifications : un champ par
 * réglage avec sa phrase d'aide, un bouton « Enregistrer » (RPC
 * `admin_set_push_engine_settings`). Partagé par Politique et Crédits.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, useAdminT } from '@/admin/ui';
import { COMMS_KEY } from './data';
import { rpc } from '../system/data';
import { Field } from './form';

/** Formulaire de réglages numériques : « Enregistrer » ne s'allume que si un champ a changé. */
export function SettingsGroup({ title, hint, fields, settings, hintPrefix }: {
  title: string; hint?: string; fields: readonly string[]; settings: Record<string, number>; hintPrefix: string;
}) {
  const { t } = useAdminT();
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => { setValues(Object.fromEntries(fields.map((f) => [f, String(settings?.[f] ?? '')]))); }, [fields, settings]);
  const dirty = fields.filter((f) => values[f] !== undefined && values[f] !== String(settings?.[f] ?? ''));
  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, number> = {};
      for (const f of dirty) {
        const n = Number(values[f]);
        if (!Number.isFinite(n)) throw new Error(t('adm.engine.badNumber'));
        patch[f] = Math.round(n);
      }
      await rpc('admin_set_push_engine_settings', { p_patch: patch });
    },
    onSuccess: () => { toast.success(t('adm.engine.saved')); void qc.invalidateQueries({ queryKey: COMMS_KEY }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card title={title}
      actions={<button type="button" className="a-btn a-btn--primary a-btn--sm" disabled={dirty.length === 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? t('adm.ui.working') : t('adm.engine.save')}</button>}>
      {hint && <p className="a-t2 mb-4 max-w-[70ch] text-[13px]">{hint}</p>}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
        {fields.map((f) => (
          <Field key={f} label={t(`adm.engine.set.${f}`)} hint={t(`${hintPrefix}.${f}`)}>
            <input className="a-input a-num" type="number" inputMode="numeric" value={values[f] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} />
          </Field>
        ))}
      </div>
    </Card>
  );
}

