// « Mes modèles » sur la page Campagnes : voir, modifier, supprimer.
//
// Les modèles n'étaient visibles que dans la galerie « Nouvelle campagne »,
// où l'on vient pour créer, pas pour ranger. Un pro qui a créé un modèle de
// soirée et un modèle de relance ne les retrouvait pas. Ici ils vivent sous
// les campagnes, avec un aperçu réel (même rendu que l'envoi), le bouton qui
// ouvre le studio en mode modèle, et la corbeille.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, LayoutTemplate, Loader2, PenLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { renderEmailHtml, type EmailTemplate } from '@/lib/email';
import { useEmailTemplates, type StudioScope } from '@/components/email-studio/hooks';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const RED = '#E8192C';

function useTemplateHtml(tpl: EmailTemplate | null, scope: StudioScope, omitFooter: boolean): string {
  return useMemo(() => {
    if (!tpl) return '';
    return renderEmailHtml(tpl.blocks, tpl.theme, {
      venueName: scope.name,
      logoUrl: scope.logoUrl,
      emailType: tpl.type,
      subject: tpl.subject,
      recipient: { email: 'apercu@exemple.com', firstName: 'Camille' },
      socialLinks: tpl.socialLinks,
      baseUrl: 'https://yunoapp.eu',
      ignoreConds: true,
    }, { omitFooter });
  }, [tpl, scope.name, scope.logoUrl, omitFooter]);
}

function Thumb({ tpl, scope }: { tpl: EmailTemplate; scope: StudioScope }) {
  const html = useTemplateHtml(tpl, scope, true);
  return (
    <div style={{ height: 188, overflow: 'hidden', background: tpl.theme.bg, borderBottom: `1px solid ${BORDER}` }}>
      <iframe
        title={tpl.name} srcDoc={html} tabIndex={-1} aria-hidden="true" loading="lazy"
        style={{ width: 620, height: 470, border: 0, pointerEvents: 'none', transform: 'scale(0.4)', transformOrigin: 'top left' }}
      />
    </div>
  );
}

function FullPreview({ tpl, scope, onClose }: { tpl: EmailTemplate | null; scope: StudioScope; onClose: () => void }) {
  const html = useTemplateHtml(tpl, scope, false);
  return (
    <Dialog open={!!tpl} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}` }}>
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle style={{ color: T1, fontSize: 15 }}>{tpl?.name}</DialogTitle>
          {tpl?.subject && <div style={{ color: T3, fontSize: 12 }}>{tpl.subject}</div>}
        </DialogHeader>
        <iframe
          title={tpl?.name || 'preview'} srcDoc={html}
          style={{ width: '100%', height: '70vh', border: 0, display: 'block', background: tpl?.theme.bg }}
        />
      </DialogContent>
    </Dialog>
  );
}

export default function TemplatesSection({ scope, basePath }: { scope: StudioScope; basePath: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { templates, loading, remove } = useEmailTemplates(scope);
  const [viewing, setViewing] = useState<EmailTemplate | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EmailTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const ok = await remove(pendingDelete.id);
    setDeleting(false);
    setPendingDelete(null);
    if (!ok) { toast.error(t('studio.tpl.deleteError')); return; }
    toast.success(t('studio.tpl.deleted'));
  };

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, cursor: 'pointer',
    background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T2, fontSize: 11.5, fontWeight: 600,
  };

  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 15, fontWeight: 600, margin: 0 }}>
            <LayoutTemplate className="w-4 h-4" style={{ color: RED }} />
            {t('studio.tpl.mine')}
            {templates.length > 0 && <span style={{ color: T3, fontWeight: 400, fontSize: 12.5 }}>· {templates.length}</span>}
          </h2>
          <p style={{ color: T3, fontSize: 12, margin: '3px 0 0' }}>{t('studio.tpl.sectionHint')}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: T3 }} /></div>
      ) : templates.length === 0 ? (
        <div style={{ border: `1px dashed ${BORDER}`, borderRadius: 14, padding: '18px 20px', color: T2, fontSize: 12.5, lineHeight: 1.6 }}>
          {t('studio.tpl.emptyList')}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {templates.map((tpl) => (
            <div key={tpl.id} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Thumb tpl={tpl} scope={scope} />
              <div className="p-3 flex flex-col gap-2" style={{ flex: 1 }}>
                <div>
                  <div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{tpl.name}</div>
                  <div className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{tpl.description || t('studio.tpl.noDesc')}</div>
                  <div style={{ color: T3, fontSize: 11, marginTop: 4 }}>
                    {t('studio.tpl.blocks').replace('{n}', String(tpl.blocks.length))}
                    {' · '}
                    {tpl.useCount > 0 ? t('studio.tpl.usedCount').replace('{n}', String(tpl.useCount)) : t('studio.tpl.neverUsed')}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap mt-auto">
                  <button type="button" style={btn} onClick={() => setViewing(tpl)}>
                    <Eye className="w-3.5 h-3.5" /> {t('studio.tpl.view')}
                  </button>
                  <button type="button" style={{ ...btn, color: T1, borderColor: 'rgba(232,25,44,0.35)', background: 'rgba(232,25,44,0.10)' }} onClick={() => navigate(`${basePath}/templates/${tpl.id}`)}>
                    <PenLine className="w-3.5 h-3.5" /> {t('studio.tpl.edit')}
                  </button>
                  <button type="button" style={{ ...btn, marginLeft: 'auto', color: '#FF5C63' }} aria-label={t('studio.tpl.delete')} title={t('studio.tpl.delete')} onClick={() => setPendingDelete(tpl)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <FullPreview tpl={viewing} scope={scope} onClose={() => setViewing(null)} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('studio.tpl.deleteTitle').replace('{name}', pendingDelete?.name || '')}</AlertDialogTitle>
            <AlertDialogDescription>{t('studio.tpl.deleteHelp')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(e) => { e.preventDefault(); void confirmDelete(); }}>
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('studio.tpl.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
