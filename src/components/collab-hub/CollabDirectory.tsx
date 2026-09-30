import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, es, fr } from 'date-fns/locale';
import { BookUser, Loader2, Mail, Plus, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { OrgButton, OrgCard, OrgEmptyState, OrgPill, OrgSectionLabel, DarkInput, T1, T2, T3 } from '@/components/org-ui';
import { PartyAvatar, useCoorgT } from '@/components/coorg/coorgUi';
import type { CoorgScope } from '@/lib/coorg';
import type { CollabPreselect } from './NewCollabDialog';

interface DirectoryPending { dir: 'in' | 'out'; event_id: string; title: string; start_at: string; role: 'cohost' | 'principal' }
interface DirectoryPerson {
  key: string;
  kind: 'org' | 'venue';
  name: string;
  avatar_url: string | null;
  city: string | null;
  events_total: number;
  events_upcoming: number;
  next_event: { id: string; title: string; start_at: string } | null;
  last_at: string | null;
  pending: DirectoryPending[];
}
interface DirectoryEmail { email: string; name: string | null; kind: 'org' | 'venue'; event_id: string | null; title: string | null; start_at: string | null; sent_at: string }

/**
 * L'annuaire des collaborations — remplace les partenariats (demande +
 * pourcentages, devenus inutiles depuis que l'accord d'argent est facultatif).
 * Il se remplit tout seul : chaque club et organisation avec qui on a fait,
 * fait ou prépare une soirée. Trois questions, dans cet ordre : avec qui j'ai
 * une soirée en ce moment, qui attend une réponse, avec qui j'ai déjà travaillé.
 * UNE action par ligne : « Inviter sur une soirée ». Lecture : `get_collab_directory`.
 */
export function CollabDirectory({ scope, canInvite, onInvite }: {
  scope: CoorgScope | null;
  canInvite: boolean;
  onInvite: (p: CollabPreselect) => void;
}) {
  const { t, language } = useCoorgT();
  const [people, setPeople] = useState<DirectoryPerson[] | null>(null);
  const [emails, setEmails] = useState<DirectoryEmail[]>([]);
  const [query, setQuery] = useState('');
  const scopeKey = scope?.venueId ?? scope?.organizerUserId ?? '';

  const load = useCallback(async () => {
    if (!scope) return;
    const { data, error } = await supabase.rpc('get_collab_directory' as never, {
      p_venue_id: scope.venueId ?? null, p_organizer_user_id: scope.organizerUserId ?? null,
    } as never);
    if (error) { console.warn('[collab] directory', error.message); setPeople([]); return; }
    const d = (data ?? {}) as { people?: DirectoryPerson[]; emails?: DirectoryEmail[] };
    setPeople(d.people ?? []);
    setEmails(d.emails ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  useEffect(() => { void load(); }, [load]);

  const dfLocale = language === 'en' ? enUS : language === 'es' ? es : fr;
  const day = (d: string) => formatInTimeZone(new Date(d), PARIS_TIMEZONE, 'EEE d MMM', { locale: dfLocale });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || (p.city ?? '').toLowerCase().includes(q));
  }, [people, query]);
  const active = filtered.filter((p) => p.events_upcoming > 0);
  const waiting = filtered.filter((p) => p.events_upcoming === 0 && p.pending.length > 0);
  const worked = filtered.filter((p) => p.events_upcoming === 0 && p.pending.length === 0);

  if (people === null) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>;

  if (people.length === 0 && emails.length === 0) {
    return (
      <OrgEmptyState
        icon={BookUser}
        title={t('Ton annuaire est vide pour l’instant', 'Your directory is empty for now', 'Tu directorio está vacío por ahora')}
        description={t(
          'Il se remplit tout seul : chaque club et organisation avec qui tu fais une soirée y apparaît.',
          'It fills itself: every club and organization you run an event with shows up here.',
          'Se llena solo: cada club y organización con quien haces un evento aparece aquí.',
        )}
      />
    );
  }

  const kindLabel = (k: 'org' | 'venue') => (k === 'venue' ? t('Club', 'Club', 'Club') : t('Organisation', 'Organization', 'Organización'));
  const pendingText = (pd: DirectoryPending) => pd.dir === 'in'
    ? t(`T’invite sur « ${pd.title} » · à accepter dans Soirées`, `Invites you to “${pd.title}” · accept it in Events`, `Te invita a «${pd.title}» · acéptalo en Eventos`)
    : t(`Invitation envoyée · « ${pd.title} »`, `Invitation sent · “${pd.title}”`, `Invitación enviada · «${pd.title}»`);

  const Row = ({ p }: { p: DirectoryPerson }) => (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid rgb(var(--ink)/0.055)' }}>
      <PartyAvatar name={p.name} url={p.avatar_url} kind={p.kind} />
      <div className="min-w-0 flex-1">
        <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 620 }}>{p.name}</p>
        <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>
          {kindLabel(p.kind)}{p.city ? ` · ${p.city}` : ''}
          {p.events_total > 0
            ? ` · ${t(`${p.events_total} soirée${p.events_total > 1 ? 's' : ''} ensemble`, `${p.events_total} event${p.events_total > 1 ? 's' : ''} together`, `${p.events_total} evento${p.events_total > 1 ? 's' : ''} juntos`)}`
            : ''}
        </p>
        {p.next_event ? (
          <p className="truncate" style={{ color: T2, fontSize: 12, marginTop: 1 }}>
            {t('Prochaine', 'Next', 'Próximo')} : {p.next_event.title} · {day(p.next_event.start_at)}
          </p>
        ) : p.last_at ? (
          <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('Dernière soirée', 'Last event', 'Último evento')} · {day(p.last_at)}</p>
        ) : null}
        {p.pending.map((pd) => (
          <p key={`${pd.dir}:${pd.event_id}`} className="truncate" style={{ color: pd.dir === 'in' ? T1 : T3, fontSize: 11.5, marginTop: 2 }}>
            {pendingText(pd)}
          </p>
        ))}
      </div>
      {canInvite && (
        <OrgButton size="sm" variant="secondary" onClick={() => onInvite({ key: p.key, name: p.name })}>
          <Plus className="h-3.5 w-3.5" /> {t('Inviter sur une soirée', 'Invite to an event', 'Invitar a un evento')}
        </OrgButton>
      )}
    </div>
  );

  const Section = ({ label, rows }: { label: string; rows: DirectoryPerson[] }) => rows.length === 0 ? null : (
    <section>
      <div className="mb-2"><OrgSectionLabel>{label} ({rows.length})</OrgSectionLabel></div>
      <OrgCard style={{ overflow: 'hidden' }}>
        <div style={{ marginTop: -1 }}>{rows.map((p) => <Row key={p.key} p={p} />)}</div>
      </OrgCard>
    </section>
  );

  return (
    <div className="space-y-5">
      {(people.length > 6) && (
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: T3 }} />
          <DarkInput value={query} onChange={setQuery} className="pl-9" placeholder={t('Chercher un nom, une ville…', 'Search a name, a city…', 'Buscar un nombre, una ciudad…')} />
        </div>
      )}
      <Section label={t('Une soirée en cours ensemble', 'An event in progress together', 'Un evento en curso juntos')} rows={active} />
      <Section label={t('En attente de réponse', 'Waiting for an answer', 'Esperando respuesta')} rows={waiting} />
      {emails.length > 0 && (
        <section>
          <div className="mb-2"><OrgSectionLabel>{t('Invités par email', 'Invited by email', 'Invitados por email')} ({emails.length})</OrgSectionLabel></div>
          <OrgCard style={{ overflow: 'hidden' }}>
            <div style={{ marginTop: -1 }}>
              {emails.map((e) => (
                <div key={`${e.email}:${e.event_id ?? ''}`} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid rgb(var(--ink)/0.055)' }}>
                  <Mail className="h-4 w-4 flex-none" style={{ color: T3 }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{e.name || e.email}</p>
                    <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>
                      {kindLabel(e.kind)} · {e.email}{e.title ? ` · « ${e.title} »` : ''}
                    </p>
                  </div>
                  <OrgPill tone="muted">{t('Pas encore inscrit', 'Not signed up yet', 'Aún sin registrarse')}</OrgPill>
                </div>
              ))}
            </div>
          </OrgCard>
        </section>
      )}
      <Section label={t('Déjà travaillé ensemble', 'Worked together before', 'Ya trabajasteis juntos')} rows={worked} />
      {filtered.length === 0 && query && (
        <p style={{ color: T3, fontSize: 12.5 }}>{t('Personne ne correspond.', 'No match.', 'Nadie coincide.')}</p>
      )}
    </div>
  );
}
