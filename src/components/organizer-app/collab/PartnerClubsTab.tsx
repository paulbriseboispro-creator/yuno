import { useState } from 'react';
import { useOrganizerPartnerships, type VenueOrganizerPartnership, type PartnershipSplitRules, getPartnershipProposalStatus } from '@/hooks/useOrganizerPartnerships';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Building2, Send, Check, X, Trash2, Inbox, Search, Settings2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { PartnershipSplitEditor, PartnershipProposalBanner } from '@/components/organizer-app/PartnershipSplitEditor';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import {
  OrgCard, OrgPill, OrgButton, OrgSectionLabel, OrgEmptyState,
  FieldLabel, DarkInput, DarkTextarea,
  T1, T2, T3, BORDER, INNER_BG,
} from '@/components/org-ui';

const dateFnsLocale = (language: string) => (language === 'fr' ? fr : language === 'es' ? es : enUS);

type PillTone = 'default' | 'success' | 'danger' | 'warn' | 'info' | 'muted';

interface VenueSearchResult {
  id: string;
  name: string;
  city: string | null;
  logo_url: string | null;
}

const statusMeta: Record<string, { fr: string; en: string; es: string; tone: PillTone }> = {
  pending: { fr: 'En attente', en: 'Pending', es: 'Pendiente', tone: 'warn' },
  active: { fr: 'Actif', en: 'Active', es: 'Activo', tone: 'success' },
  declined: { fr: 'Refusé', en: 'Declined', es: 'Rechazado', tone: 'muted' },
  revoked: { fr: 'Révoqué', en: 'Revoked', es: 'Revocado', tone: 'danger' },
};

const dialogStyle = { background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18 } as const;

/**
 * "Clubs partenaires" tab of the organizer Collaborations hub — parity with the
 * club's /owner/collaborations?tab=organizers. Manage partnerships with Yuno clubs:
 * received invitations, active partnerships (with editable revenue splits), pending
 * requests, and history. Inviting a brand-new club not yet on Yuno lives in the
 * separate "Inviter" tab.
 */
export function PartnerClubsTab() {
  const { partnerships, isLoading, requestPartnership, respond, revoke, proposeSplitUpdate, respondToSplitProposal } = useOrganizerPartnerships();
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [editSplitFor, setEditSplitFor] = useState<VenueOrganizerPartnership | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<VenueSearchResult[]>([]);
  const [selectedVenue, setSelectedVenue] = useState<VenueSearchResult | null>(null);
  const [message, setMessage] = useState('');
  const [searching, setSearching] = useState(false);

  const incoming = partnerships.filter((p) => p.status === 'pending' && p.initiated_by === 'venue');
  const outgoing = partnerships.filter((p) => p.status === 'pending' && p.initiated_by === 'organizer');
  const active = partnerships.filter((p) => p.status === 'active');
  const past = partnerships.filter((p) => ['declined', 'revoked'].includes(p.status));

  const handleSearch = async () => {
    if (!search.trim() || search.trim().length < 2) return;
    setSearching(true);
    const { data, error } = await supabase
      .from('venues')
      .select('id, name, city, logo_url')
      .ilike('name', `%${search.trim()}%`)
      .limit(10);
    setSearching(false);
    if (error) {
      toast({ title: t('Erreur', 'Error', 'Error'), description: error.message, variant: 'destructive' });
      return;
    }
    setResults((data || []) as VenueSearchResult[]);
  };

  const handleSend = async () => {
    if (!selectedVenue) return;
    await requestPartnership.mutateAsync({ venueId: selectedVenue.id, message });
    setRequestOpen(false);
    setSelectedVenue(null);
    setMessage('');
    setSearch('');
    setResults([]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p style={{ color: T3, fontSize: 13 }}>
          {t(
            'Connecte-toi à des clubs Yuno et gère vos partenariats et règles de partage.',
            'Connect with Yuno clubs and manage your partnerships and split rules.',
            'Conéctate con clubes Yuno y gestiona vuestros partenariados y reglas de reparto.',
          )}
        </p>
        <OrgButton variant="primary" size="sm" onClick={() => setRequestOpen(true)}>
          <Send className="h-4 w-4" /> {t('Demander un partenariat', 'Request a partnership', 'Solicitar un partenariado')}
        </OrgButton>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
      ) : (
        <div className="space-y-6">
          {incoming.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Inbox className="h-4 w-4" style={{ color: T3 }} />
                <OrgSectionLabel>{t('Invitations reçues', 'Received invitations', 'Invitaciones recibidas')} ({incoming.length})</OrgSectionLabel>
              </div>
              <div className="grid gap-3">
                {incoming.map((p) => (
                  <PartnershipCard key={p.id} partnership={p} showAccept
                    onAccept={() => respond.mutate({ id: p.id, accept: true })}
                    onDecline={() => respond.mutate({ id: p.id, accept: false })} />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-3"><OrgSectionLabel>{t('Partenariats actifs', 'Active partnerships', 'Partenariados activos')} ({active.length})</OrgSectionLabel></div>
            {active.length === 0 ? (
              <OrgEmptyState icon={Building2} title={t('Aucun partenariat actif pour le moment.', 'No active partnerships yet.', 'Aún no hay partenariados activos.')} />
            ) : (
              <div className="grid gap-3">
                {active.map((p) => (
                  <PartnershipCard
                    key={p.id}
                    partnership={p}
                    onEditSplit={() => setEditSplitFor(p)}
                    onAcceptProposal={() => respondToSplitProposal.mutate({ partnership: p, accept: true })}
                    onDeclineProposal={() => respondToSplitProposal.mutate({ partnership: p, accept: false })}
                    proposalPending={respondToSplitProposal.isPending}
                    onRevoke={() => { if (confirm(t('Révoquer ce partenariat ? Cette action est définitive.', 'Revoke this partnership? This action is permanent.', '¿Revocar este partenariado? Esta acción es definitiva.'))) revoke.mutate(p.id); }}
                  />
                ))}
              </div>
            )}
          </section>

          {outgoing.length > 0 && (
            <section>
              <div className="mb-3"><OrgSectionLabel>{t('Demandes en attente', 'Pending requests', 'Solicitudes pendientes')} ({outgoing.length})</OrgSectionLabel></div>
              <div className="grid gap-3">
                {outgoing.map((p) => <PartnershipCard key={p.id} partnership={p} onRevoke={() => revoke.mutate(p.id)} />)}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <div className="mb-3"><OrgSectionLabel>{t('Historique', 'History', 'Historial')}</OrgSectionLabel></div>
              <div className="grid gap-3 opacity-70">
                {past.map((p) => <PartnershipCard key={p.id} partnership={p} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Request dialog */}
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="border-0 p-0" style={{ ...dialogStyle, maxWidth: 512 }}>
          <div className="p-6">
            <DialogHeader>
              <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('Demander un partenariat', 'Request a partnership', 'Solicitar un partenariado')}</DialogTitle>
              <DialogDescription style={{ color: T3, fontSize: 12 }}>
                {t(
                  'Recherche un club Yuno pour proposer une collaboration. Le club devra accepter.',
                  'Search for a Yuno club to propose a collaboration. The club will need to accept.',
                  'Busca un club Yuno para proponer una colaboración. El club deberá aceptar.',
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <DarkInput placeholder={t('Nom du club…', 'Club name…', 'Nombre del club…')} value={search} onChange={setSearch} />
                </div>
                <OrgButton variant="secondary" onClick={handleSearch} disabled={searching}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </OrgButton>
              </div>

              {results.length > 0 && !selectedVenue && (
                <div className="max-h-60 space-y-1 overflow-auto rounded-xl p-2" style={{ border: `1px solid ${BORDER}` }}>
                  {results.map((v) => (
                    <button key={v.id} onClick={() => setSelectedVenue(v)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-white/[0.04]">
                      {v.logo_url ? <img src={v.logo_url} alt="" className="h-8 w-8 rounded object-cover" /> : (
                        <div className="flex h-8 w-8 items-center justify-center rounded" style={{ background: INNER_BG }}><Building2 className="h-4 w-4" style={{ color: T3 }} /></div>
                      )}
                      <div>
                        <div style={{ color: T1, fontSize: 13, fontWeight: 540 }}>{v.name}</div>
                        {v.city && <div style={{ color: T3, fontSize: 11 }}>{v.city}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {selectedVenue && (
                <div className="rounded-xl p-3" style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.25)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {selectedVenue.logo_url ? <img src={selectedVenue.logo_url} alt="" className="h-10 w-10 rounded object-cover" /> : (
                        <div className="flex h-10 w-10 items-center justify-center rounded" style={{ background: INNER_BG }}><Building2 className="h-5 w-5" style={{ color: T3 }} /></div>
                      )}
                      <div>
                        <div style={{ color: T1, fontWeight: 560 }}>{selectedVenue.name}</div>
                        {selectedVenue.city && <div style={{ color: T3, fontSize: 11 }}>{selectedVenue.city}</div>}
                      </div>
                    </div>
                    <button onClick={() => setSelectedVenue(null)} style={{ color: T2, fontSize: 12 }}>{t('Changer', 'Change', 'Cambiar')}</button>
                  </div>
                </div>
              )}

              {selectedVenue && (
                <div>
                  <FieldLabel>{t('Message (optionnel)', 'Message (optional)', 'Mensaje (opcional)')}</FieldLabel>
                  <DarkTextarea placeholder={t("Présente ton projet, ta communauté, le type d'événement envisagé…", 'Introduce your project, your community, the kind of event you have in mind…', 'Presenta tu proyecto, tu comunidad, el tipo de evento que tienes en mente…')} value={message} onChange={setMessage} rows={4} />
                </div>
              )}
            </div>

            <DialogFooter className="mt-5 gap-2">
              <OrgButton variant="secondary" onClick={() => setRequestOpen(false)}>{t('Annuler', 'Cancel', 'Cancelar')}</OrgButton>
              <OrgButton variant="primary" onClick={handleSend} disabled={!selectedVenue || requestPartnership.isPending}>
                <Send className="h-4 w-4" /> {t('Envoyer', 'Send', 'Enviar')}
              </OrgButton>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {editSplitFor && (
        <PartnershipSplitEditor
          open={!!editSplitFor}
          onOpenChange={(o) => !o && setEditSplitFor(null)}
          partnership={editSplitFor}
          side="organizer"
          onPropose={async (rules: PartnershipSplitRules) => { await proposeSplitUpdate.mutateAsync({ id: editSplitFor.id, rules }); }}
          isPending={proposeSplitUpdate.isPending}
        />
      )}
    </div>
  );
}

function PartnershipCard({
  partnership, showAccept, onAccept, onDecline, onRevoke, onEditSplit, onAcceptProposal, onDeclineProposal, proposalPending,
}: {
  partnership: VenueOrganizerPartnership;
  showAccept?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onRevoke?: () => void;
  onEditSplit?: () => void;
  onAcceptProposal?: () => void;
  onDeclineProposal?: () => void;
  proposalPending?: boolean;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const status = statusMeta[partnership.status];
  const proposalStatus = getPartnershipProposalStatus(partnership);
  return (
    <OrgCard>
      <div className="flex items-start gap-4 p-4">
        {partnership.venue?.logo_url ? (
          <img src={partnership.venue.logo_url} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg" style={{ background: INNER_BG }}>
            <Building2 className="h-5 w-5" style={{ color: T3 }} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 560 }}>{partnership.venue?.name ?? t('Club', 'Club', 'Club')}</h3>
            {status && <OrgPill tone={status.tone}>{t(status.fr, status.en, status.es)}</OrgPill>}
            <OrgPill tone="muted">{partnership.initiated_by === 'venue' ? t('Initié par le club', 'Initiated by the club', 'Iniciado por el club') : t('Initié par toi', 'Initiated by you', 'Iniciado por ti')}</OrgPill>
          </div>
          {partnership.venue?.city && <div className="mt-0.5" style={{ color: T3, fontSize: 11.5 }}>{partnership.venue.city}</div>}
          {partnership.invitation_message && (
            <p className="mt-2 line-clamp-2 italic" style={{ color: T2, fontSize: 13 }}>« {partnership.invitation_message} »</p>
          )}
          <div className="mt-2" style={{ color: T3, fontSize: 11 }}>
            {partnership.status === 'active' && partnership.accepted_at
              ? `${t('Actif depuis le', 'Active since', 'Activo desde el')} ${format(new Date(partnership.accepted_at), 'd MMM yyyy', { locale: dateFnsLocale(language) })}`
              : `${t('Demandé le', 'Requested on', 'Solicitado el')} ${format(new Date(partnership.requested_at), 'd MMM yyyy', { locale: dateFnsLocale(language) })}`}
          </div>

          {partnership.status === 'active' && (
            <>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="grid min-w-[280px] flex-1 grid-cols-3 gap-2">
                  <SplitChip label={t('Billets', 'Tickets', 'Entradas')} pct={partnership.default_split_rules?.tickets?.organizer_pct ?? 0} />
                  <SplitChip label={t('Tables', 'Tables', 'Mesas')} pct={partnership.default_split_rules?.tables?.organizer_pct ?? 0} />
                  <SplitChip label={t('Boissons', 'Drinks', 'Bebidas')} pct={partnership.default_split_rules?.drinks?.organizer_pct ?? 0} />
                </div>
                {onEditSplit && proposalStatus === 'no_proposal' && (
                  <OrgButton size="sm" variant="secondary" onClick={onEditSplit}>
                    <Settings2 className="h-3.5 w-3.5" /> {t('Modifier', 'Edit', 'Editar')}
                  </OrgButton>
                )}
              </div>

              {proposalStatus !== 'no_proposal' && onAcceptProposal && onDeclineProposal && (
                <div className="mt-3">
                  <PartnershipProposalBanner partnership={partnership} side="organizer" onAccept={onAcceptProposal} onDecline={onDeclineProposal} isPending={proposalPending} />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          {showAccept && (
            <>
              <OrgButton size="sm" variant="primary" onClick={onAccept}><Check className="h-3.5 w-3.5" /> {t('Accepter', 'Accept', 'Aceptar')}</OrgButton>
              <OrgButton size="sm" variant="secondary" onClick={onDecline}><X className="h-3.5 w-3.5" /> {t('Refuser', 'Decline', 'Rechazar')}</OrgButton>
            </>
          )}
          {onRevoke && partnership.status !== 'revoked' && partnership.status !== 'declined' && (
            <OrgButton size="sm" variant="danger" onClick={onRevoke}><Trash2 className="h-3.5 w-3.5" /></OrgButton>
          )}
        </div>
      </div>
    </OrgCard>
  );
}

function SplitChip({ label, pct }: { label: string; pct: number }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  return (
    <div className="rounded-lg px-2 py-1" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div style={{ color: T3, fontSize: 10 }}>{label}</div>
      <div className="font-mono" style={{ color: T2, fontSize: 11.5 }}>{t('Toi', 'You', 'Tú')} {pct}% · {t('Club', 'Club', 'Club')} {100 - pct}%</div>
    </div>
  );
}
