import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { Layers, Send, Mail, Trash2, Loader2, Users } from 'lucide-react';
import { motion } from 'framer-motion';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Définition v1 d'un segment sauvegardé — liste plate de conditions en AND.
// Résolue à l'envoi par resolve_venue_segment ; jamais de snapshot.
export type SegmentDefinition = {
  version: 1;
  match: 'all';
  conditions: Array<Record<string, unknown>>;
};

type SavedSegment = {
  id: string;
  name: string;
  definition: SegmentDefinition;
};

/**
 * Carte « Mes segments » de la page Clients : liste les segments sauvegardés
 * du club avec leur taille LIVE (count_venue_segment), et les rend actionnables
 * en push (/owner/push?segment=<id>) et en email (audience « custom_segment »
 * du builder de campagnes).
 *
 * `reloadKey` : incrémenté par le parent après une sauvegarde pour recharger.
 */
export function SavedSegments({ venueId, reloadKey = 0 }: { venueId: string; reloadKey?: number }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('venue_segments' as never)
        .select('id, name, definition')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = ((data as unknown) as SavedSegment[]) || [];
      setSegments(rows);
      // Tailles live, en parallèle — best-effort : un échec laisse le tiret.
      const entries = await Promise.all(rows.map(async (seg) => {
        const { data: n } = await supabase.rpc('count_venue_segment' as never, {
          p_venue_id: venueId, p_definition: seg.definition,
        } as never);
        return [seg.id, typeof n === 'number' ? n : -1] as const;
      }));
      setCounts(Object.fromEntries(entries.filter(([, n]) => n >= 0)));
    } catch {
      /* la carte reste vide — la page Clients garde toute sa valeur sans elle */
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { if (venueId) load(); }, [venueId, load, reloadKey]);

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      const { error } = await supabase.from('venue_segments' as never).delete().eq('id', id);
      if (error) throw error;
      setSegments((list) => list.filter((s) => s.id !== id));
      toast({ title: t('segments.deleted') });
    } catch {
      toast({ title: t('customers.error'), variant: 'destructive' });
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  // Pas de segments et rien à charger : la carte ne s'affiche pas du tout —
  // elle apparaît à la première sauvegarde depuis le panneau de filtres.
  if (!loading && segments.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}
    >
      <div className="flex items-center gap-2.5 mb-4">
        <Layers className="h-4 w-4" style={{ color: RED }} />
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {t('segments.myTitle')}
        </h3>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} />
        </div>
      ) : (
        <div className="space-y-2">
          {segments.map((seg, i) => (
            <motion.div
              key={seg.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="flex items-center justify-between gap-3 p-3 rounded-xl"
              style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}
            >
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{seg.name}</p>
                <p className="flex items-center gap-1.5 tabular-nums" style={{ color: T3, fontSize: 11, marginTop: 2 }}>
                  <Users className="h-3 w-3" />
                  {seg.id in counts
                    ? t('segments.count').replace('{count}', String(counts[seg.id]))
                    : '—'}
                  <span style={{ color: T3 }}>
                    · {t('segments.conditions').replace('{count}', String(seg.definition?.conditions?.length ?? 0))}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => navigate(`/owner/push?segment=${seg.id}`)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150"
                  style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.22)', color: RED, fontSize: 11, fontWeight: 600 }}
                >
                  <Send className="h-3 w-3" />
                  {t('segments.usePush')}
                </button>
                <button
                  onClick={() => navigate('/owner/campaigns')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150"
                  style={{ background: TILE_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 11, fontWeight: 600 }}
                >
                  <Mail className="h-3 w-3" />
                  {t('segments.useEmail')}
                </button>
                {confirmDeleteId === seg.id ? (
                  <button
                    onClick={() => remove(seg.id)}
                    disabled={deletingId === seg.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150"
                    style={{ background: 'rgba(232,25,44,0.15)', border: '1px solid rgba(232,25,44,0.4)', color: RED, fontSize: 11, fontWeight: 700 }}
                  >
                    {deletingId === seg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    {t('segments.deleteConfirm')}
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(seg.id)}
                    onBlur={() => setConfirmDeleteId((v) => (v === seg.id ? null : v))}
                    className="inline-flex items-center p-1.5 rounded-lg cursor-pointer transition-all duration-150"
                    style={{ color: T3 }}
                    aria-label={t('segments.delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <p style={{ color: T3, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>{t('segments.dynamicNote')}</p>
    </motion.div>
  );
}
