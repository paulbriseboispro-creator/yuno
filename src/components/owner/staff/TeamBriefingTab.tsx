/**
 * Onglet « Briefing » du hub équipe owner.
 *
 * Le geste quotidien du patron avant l'ouverture : écrire la consigne du soir
 * (celle qui partait sur WhatsApp), voir qui l'a lue, qui est en poste en ce
 * moment, et envoyer un bravo nominatif. Tout est branché sur le pouls de
 * nuit (get_staff_night_pulse) — la même source que les écrans staff.
 */

import { useEffect, useMemo, useState } from 'react';
import { Megaphone, Loader2, Check, Eye, Users, Heart, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStaffNightPulse } from '@/hooks/useStaffNightPulse';
import { staffInitials } from '@/lib/staffIdentity';
import { useToast } from '@/hooks/use-toast';

const RED     = '#E8192C';
const POS     = '#34D399';
const T1      = 'rgba(255,255,255,0.96)';
const T2      = 'rgba(255,255,255,0.58)';
const T3      = 'rgba(255,255,255,0.36)';
const BORDER  = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface StaffOption {
  id: string;
  name: string;
}

interface Props {
  venueId: string;
  /** Membres du staff (cibles possibles d'un bravo). */
  staff: StaffOption[];
}

export function TeamBriefingTab({ venueId, staff }: Props) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { pulse, loading, refetch } = useStaffNightPulse(venueId);

  const [body, setBody] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);

  const [kudosTarget, setKudosTarget] = useState<string | null>(null);
  const [kudosBody, setKudosBody] = useState('');
  const [kudosSending, setKudosSending] = useState(false);

  // Hydrate le composer avec la consigne du soir existante — une seule fois,
  // sinon chaque poll de 25 s écraserait la frappe en cours.
  useEffect(() => {
    if (hydrated || loading) return;
    setBody(pulse?.brief?.body ?? '');
    setHydrated(true);
  }, [pulse, loading, hydrated]);

  const readerNames = useMemo(
    () => (pulse?.brief?.readers ?? []).map((r) => r.name).filter(Boolean),
    [pulse?.brief],
  );

  const onShift = (pulse?.team ?? []).filter((m) => !m.ended_at);
  const fieldStaffCount = staff.length;

  const saveBrief = async (clear = false) => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('upsert_staff_brief', {
        p_venue_id: venueId,
        p_body: clear ? '' : body,
      });
      if (error) throw error;
      if (clear) setBody('');
      toast({ title: clear ? t('ownerteam.briefCleared') : t('ownerteam.briefSaved') });
      refetch();
    } catch {
      toast({ title: t('common.error'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const sendKudos = async () => {
    if (!kudosTarget) return;
    setKudosSending(true);
    try {
      const { error } = await supabase.rpc('send_staff_kudos', {
        p_to_user: kudosTarget,
        p_body: kudosBody.trim() || null,
      });
      if (error) throw error;
      toast({ title: t('ownerteam.kudosSent') });
      setKudosTarget(null);
      setKudosBody('');
      refetch();
    } catch {
      toast({ title: t('common.error'), variant: 'destructive' });
    } finally {
      setKudosSending(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* ── La consigne du soir ── */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
        <div className="mb-1 flex items-center gap-2">
          <Megaphone className="h-4 w-4" style={{ color: RED }} />
          <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('ownerteam.briefTitle')}</h3>
        </div>
        <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5, marginBottom: 12 }}>{t('ownerteam.briefHint')}</p>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 800))}
          placeholder={t('ownerteam.briefPlaceholder')}
          rows={4}
          className="w-full resize-none rounded-xl px-3 py-2.5 text-[13px] outline-none"
          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, lineHeight: 1.5 }}
        />
        <div className="mt-1 flex items-center justify-between">
          <span style={{ color: T3, fontSize: 10.5 }} className="tabular-nums">{body.length}/800</span>
          {pulse?.brief && (
            <span className="flex items-center gap-1" style={{ color: readerNames.length > 0 ? POS : T3, fontSize: 10.5 }}>
              <Eye className="h-3 w-3" />
              {readerNames.length > 0
                ? t('ownerteam.briefReadBy')
                    .replace('{read}', String(readerNames.length))
                    .replace('{total}', String(Math.max(fieldStaffCount, readerNames.length)))
                : t('ownerteam.briefNobody')}
            </span>
          )}
        </div>
        {readerNames.length > 0 && (
          <p className="mt-1 truncate" style={{ color: T3, fontSize: 10.5 }}>{readerNames.join(', ')}</p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => saveBrief(false)}
            disabled={saving || !body.trim()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold transition-all duration-150 disabled:opacity-40"
            style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` }}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t('ownerteam.briefSave')}
          </button>
          {pulse?.brief && (
            <button
              onClick={() => saveBrief(true)}
              disabled={saving}
              className="flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px]"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('ownerteam.briefClear')}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {/* ── En poste maintenant ── */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4" style={{ color: POS }} />
            <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('ownerteam.onShift')}</h3>
            <span className="tabular-nums" style={{ color: T3, fontSize: 12 }}>{onShift.length}</span>
          </div>
          {onShift.length === 0 ? (
            <p style={{ color: T3, fontSize: 12.5 }}>{t('ownerteam.nooneOnShift')}</p>
          ) : (
            <div className="space-y-2">
              {onShift.map((m) => (
                <div key={m.user_id} className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-lg" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span style={{ color: T2, fontSize: 10, fontWeight: 700 }}>{staffInitials(m.name)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 550 }}>{m.name}</p>
                    <p className="truncate" style={{ color: T3, fontSize: 10.5 }}>
                      {[m.title || m.role, new Date(m.started_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="inline-block h-1.5 w-1.5 flex-none rounded-full" style={{ background: POS }} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Envoyer un bravo ── */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
          <div className="mb-1 flex items-center gap-2">
            <Heart className="h-4 w-4" style={{ color: '#F472B6' }} />
            <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('ownerteam.kudosSend')}</h3>
          </div>
          <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5, marginBottom: 12 }}>{t('ownerteam.kudosHint')}</p>

          <div className="mb-2 flex flex-wrap gap-1.5">
            {staff.map((s) => (
              <button
                key={s.id}
                onClick={() => setKudosTarget(kudosTarget === s.id ? null : s.id)}
                className="rounded-full px-3 py-1.5 text-[12px] font-medium transition-all duration-150"
                style={{
                  background: kudosTarget === s.id ? 'rgba(244,114,182,0.12)' : INNER_BG,
                  border: `1px solid ${kudosTarget === s.id ? 'rgba(244,114,182,0.4)' : BORDER}`,
                  color: kudosTarget === s.id ? '#F472B6' : T2,
                }}
              >
                {s.name}
              </button>
            ))}
          </div>

          <input
            value={kudosBody}
            onChange={(e) => setKudosBody(e.target.value.slice(0, 140))}
            placeholder={t('ownerteam.kudosPlaceholder')}
            className="mb-2 w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}
          />
          <button
            onClick={sendKudos}
            disabled={!kudosTarget || kudosSending}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold transition-all duration-150 disabled:opacity-40"
            style={{ background: 'rgba(244,114,182,0.12)', border: '1px solid rgba(244,114,182,0.35)', color: '#F472B6' }}
          >
            {kudosSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {t('ownerteam.kudosSend')}
          </button>

          {(pulse?.kudos.length ?? 0) > 0 && (
            <div className="mt-3 space-y-1.5 border-t pt-3" style={{ borderColor: BORDER }}>
              <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {t('ownerteam.kudosTonight')}
              </p>
              {pulse!.kudos.map((k) => (
                <p key={k.id} style={{ color: T2, fontSize: 12 }}>
                  <span style={{ color: T1, fontWeight: 550 }}>{k.from_name}</span>
                  {' → '}
                  <span style={{ color: T1, fontWeight: 550 }}>{k.to_name}</span>
                  {k.body ? ` — ${k.body}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
