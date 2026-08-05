import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { ClipboardList, ChevronDown, Check } from 'lucide-react';
import { RED, T1, T2, T3, BORDER, INNER_BG } from './ui';

// Octroi PAR SOIRÉE d'une enveloppe guest list à une agence partenaire (côté
// club/organisateur qui tient la porte). Écrase l'enveloppe standing du contrat
// pour CETTE soirée. L'agence la répartit ensuite dans son cockpit.
// N'apparaît que s'il existe au moins un contrat agence actif sur le périmètre.

type Row = {
  agency_id: string;
  name: string;
  quota: string;                       // brouillon (vide = ne pas toucher)
  mode: 'partition' | 'pool';
  granted: number | null;              // enveloppe déjà accordée ce soir
};

export function AgencyEnvelopeGrant({
  eventId, venueId, organizerUserId, isOrganizerScope,
}: {
  eventId: string;
  venueId: string | null;
  organizerUserId: string | null;
  isOrganizerScope: boolean;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const db = supabase as any;
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const scopeCol = isOrganizerScope ? 'organizer_user_id' : 'venue_id';
    const scopeVal = isOrganizerScope ? organizerUserId : venueId;
    if (!scopeVal || !eventId) { setRows([]); return; }

    const [cRes, envRes] = await Promise.all([
      db.from('agency_venue_contracts')
        .select('agency_id, gl_default_quota, gl_default_mode, agencies(name)')
        .eq(scopeCol, scopeVal).eq('status', 'active'),
      db.from('guest_lists')
        .select('agency_id, quota, agency_distribution_mode')
        .eq('event_id', eventId).eq('holder_type', 'agency'),
    ]);

    const envByAgency = new Map<string, { quota: number | null; mode: string | null }>();
    for (const e of (envRes.data ?? []) as any[]) {
      envByAgency.set(e.agency_id, { quota: e.quota, mode: e.agency_distribution_mode });
    }
    const next: Row[] = ((cRes.data ?? []) as any[]).map(c => {
      const env = envByAgency.get(c.agency_id);
      const q = env ? env.quota : c.gl_default_quota;
      return {
        agency_id: c.agency_id,
        name: c.agencies?.name || tt('Agence', 'Agency'),
        quota: q == null ? '' : String(q),
        mode: (env?.mode as 'partition' | 'pool') || (c.gl_default_mode as 'partition' | 'pool') || 'partition',
        granted: env ? env.quota : null,
      };
    });
    setRows(next);
  }, [eventId, venueId, organizerUserId, isOrganizerScope]);

  useEffect(() => { load(); }, [load]);

  if (rows.length === 0) return null;

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => r.agency_id === id ? { ...r, ...patch } : r));

  const grant = async (r: Row) => {
    if (r.quota.trim() === '') { toast.error(tt('Indiquez un nombre de places', 'Enter a number of spots')); return; }
    const q = Math.max(0, parseInt(r.quota) || 0);
    setBusy(r.agency_id);
    const { error } = await db.rpc('grant_agency_guestlist_allocation', {
      p_event_id: eventId, p_agency_id: r.agency_id, p_quota: q, p_mode: r.mode,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(tt('Enveloppe accordée pour cette soirée', 'Envelope granted for this event'));
    load();
  };

  return (
    <div style={{ borderRadius: 14, background: INNER_BG, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2" style={{ padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer' }}>
        <ClipboardList className="h-4 w-4" style={{ color: RED }} />
        <span style={{ color: T1, fontSize: 13.5, fontWeight: 600, flex: 1, textAlign: 'left' }}>
          {tt('Enveloppe guest list agence', 'Agency guest list envelope')}
        </span>
        <ChevronDown className="h-4 w-4" style={{ color: T3, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>

      {open && (
        <div style={{ padding: '0 14px 12px' }}>
          <p style={{ color: T3, fontSize: 11, marginBottom: 8 }}>
            {tt('Accordez des places à une agence pour cette soirée (écrase le défaut du contrat). Elle les répartit entre ses promoteurs.',
              'Grant spots to an agency for this event (overrides the contract default). It distributes them among its promoters.')}
          </p>
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.agency_id} className="flex items-center gap-2 flex-wrap" style={{ padding: '8px 0', borderTop: `1px solid rgba(255,255,255,0.05)` }}>
                <span className="flex-1 min-w-0 truncate" style={{ color: T1, fontSize: 13 }}>
                  {r.name}
                  {r.granted != null && <span style={{ color: T3, fontSize: 11 }}> · {tt('accordé', 'granted')} {r.granted === 0 ? '∞' : r.granted}</span>}
                </span>
                <input
                  type="number" min={0} value={r.quota} onChange={e => setRow(r.agency_id, { quota: e.target.value })}
                  placeholder={tt('places', 'spots')}
                  className="outline-none text-center" style={{ width: 74, background: '#111', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 8px', color: T1, fontSize: 13 }}
                />
                <select value={r.mode} onChange={e => setRow(r.agency_id, { mode: e.target.value as 'partition' | 'pool' })}
                  className="outline-none" style={{ background: '#111', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 8px', color: T1, fontSize: 12.5 }}>
                  <option value="partition" style={{ background: '#111' }}>{tt('Partition', 'Partition')}</option>
                  <option value="pool" style={{ background: '#111' }}>{tt('Pool', 'Pool')}</option>
                </select>
                <button onClick={() => grant(r)} disabled={busy === r.agency_id}
                  className="flex items-center gap-1" style={{ padding: '7px 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: RED, color: '#fff', border: 'none', opacity: busy === r.agency_id ? 0.5 : 1 }}>
                  <Check className="h-3.5 w-3.5" /> {tt('Accorder', 'Grant')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
