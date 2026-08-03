import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { errorToast } from '@/lib/errorToast';
import { Megaphone, Plus, Trash2, X, Send } from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, SectionLabel, FieldLabel,
  T1, T2, T3, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

type Announcement = { id: string; title: string; content: string; created_at: string };

export default function AgencyAnnouncements() {
  const { agency } = useAgency();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const db = supabase as any;

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agency?.id) return;
    setLoading(true);
    const { data, error } = await db.from('promoter_announcements')
      .select('id, title, content, created_at')
      .eq('agency_id', agency.id)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('announcements load error:', error);
      toast.error(tt('Impossible de charger les annonces. Réessaie.', "Couldn't load announcements. Try again.", 'No se pudieron cargar los anuncios. Reintenta.'));
    }
    setItems((data ?? []) as Announcement[]);
    setLoading(false);
  }, [agency?.id]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!title.trim() || !content.trim()) { toast.error(tt('Titre et message requis', 'Title and message required')); return; }
    setBusy(true);
    const { error } = await db.from('promoter_announcements')
      .insert({ agency_id: agency!.id, title: title.trim(), content: content.trim() });
    setBusy(false);
    if (error) { errorToast(error); return; }
    toast.success(tt('Annonce envoyée à vos promoteurs', 'Announcement sent to your promoters'));
    setTitle(''); setContent(''); setOpen(false);
    load();
  };

  const del = async (id: string) => {
    const { error } = await db.from('promoter_announcements').delete().eq('id', id);
    if (error) { errorToast(error); return; }
    setConfirmDel(null);
    load();
  };

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel>{tt('Annonces à l\'équipe', 'Team announcements')}</SectionLabel>
        <PromoButton size="sm" onClick={() => setOpen(o => !o)} disabled={open}>
          <Plus className="h-4 w-4" /> {tt('Nouvelle', 'New')}
        </PromoButton>
      </div>

      <PromoCard style={{ padding: '11px 13px' }}>
        <p style={{ color: T2, fontSize: 12, lineHeight: 1.5 }}>
          {tt('Un message envoyé ici part en notification à tous vos promoteurs (app Yuno Pro) et s\'affiche dans leur fil. Idéal pour un brief avant une soirée.',
            'A message sent here is pushed to all your promoters (Yuno Pro app) and shows in their feed. Perfect for a pre-event brief.')}
        </p>
      </PromoCard>

      {open && (
        <PromoCard>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>{tt('Nouvelle annonce', 'New announcement')}</SectionLabel>
            <button onClick={() => setOpen(false)} style={{ color: T3, cursor: 'pointer', background: 'none', border: 'none' }}><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-3">
            <div>
              <FieldLabel>{tt('Titre', 'Title')}</FieldLabel>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder={tt('ex. Brief samedi', 'e.g. Saturday brief')}
                className="w-full outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 12px', color: T1, fontSize: 13.5 }} />
            </div>
            <div>
              <FieldLabel>{tt('Message', 'Message')}</FieldLabel>
              <textarea value={content} onChange={e => setContent(e.target.value)} rows={4} placeholder={tt('Votre message à l\'équipe…', 'Your message to the team…')}
                className="w-full outline-none resize-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 12px', color: T1, fontSize: 13.5, fontFamily: 'inherit' }} />
            </div>
            <PromoButton onClick={send} disabled={busy} full>
              <Send className="h-4 w-4" /> {busy ? tt('Envoi…', 'Sending…') : tt('Envoyer à l\'équipe', 'Send to the team')}
            </PromoButton>
          </div>
        </PromoCard>
      )}

      {loading ? (
        <div className="py-12 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>
      ) : items.length === 0 && !open ? (
        <PromoEmpty icon={Megaphone} title={tt('Aucune annonce', 'No announcements')}
          description={tt('Envoyez un brief ou une consigne à tous vos promoteurs en un message.', 'Send a brief or instruction to all your promoters in one message.')} />
      ) : (
        <div className="space-y-2">
          {items.map(a => (
            <PromoCard key={a.id} style={{ padding: '12px 14px' }}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{a.title}</p>
                  <p style={{ color: T2, fontSize: 12.5, marginTop: 3, whiteSpace: 'pre-wrap' }}>{a.content}</p>
                  <p style={{ color: T3, fontSize: 10.5, marginTop: 6 }}>{fmt(a.created_at)}</p>
                </div>
                <button onClick={() => setConfirmDel(a.id)} style={{ color: T3, cursor: 'pointer', background: 'none', border: 'none', padding: 4 }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {confirmDel === a.id && (
                <div className="flex gap-2 mt-2">
                  <PromoButton size="sm" variant="danger" onClick={() => del(a.id)}>{tt('Supprimer', 'Delete')}</PromoButton>
                  <PromoButton size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>{tt('Annuler', 'Cancel')}</PromoButton>
                </div>
              )}
            </PromoCard>
          ))}
        </div>
      )}
    </div>
  );
}
