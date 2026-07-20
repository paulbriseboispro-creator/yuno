import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenuePartnerships, DEFAULT_PARTNERSHIP_SPLIT, type PartnershipSplitRules, type VenueOrganizerPartnership, getPartnershipProposalStatus } from '@/hooks/useOrganizerPartnerships';
import { PartnershipSplitEditor, PartnershipProposalBanner } from '@/components/organizer-app/PartnershipSplitEditor';
import { PartnershipResponsibilitiesDialog } from '@/components/collab/PartnershipResponsibilitiesDialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { User, Send, Check, X, Trash2, Inbox, Handshake, Search, ArrowLeft, Settings2, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

const dfLocale = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);

interface OrganizerSearchResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  avatar_url: string | null;
  profile_type: string | null;
}

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  pending: { label: 'partnerships.status.pending', variant: 'secondary' },
  active: { label: 'partnerships.status.active', variant: 'default' },
  declined: { label: 'partnerships.status.declined', variant: 'outline' },
  revoked: { label: 'partnerships.status.revoked', variant: 'destructive' },
};

export default function OwnerPartnerships() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [venueId, setVenueId] = useState<string | undefined>(undefined);
  const [venueName, setVenueName] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('venues')
        .select('id, name')
        .eq('owner_id', user.id)
        .limit(1)
        .maybeSingle();
      if (data) {
        setVenueId(data.id);
        setVenueName(data.name);
      }
    })();
  }, [user]);

  const { partnerships, isLoading, inviteOrganizer, respond, proposeSplitUpdate, respondToSplitProposal, revoke, updateResponsibilities } = useVenuePartnerships(venueId);
  // Répartition « Qui fait quoi » par défaut de ce partenariat (pré-remplissage).
  const [respDialogPartnership, setRespDialogPartnership] = useState<VenueOrganizerPartnership | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<OrganizerSearchResult[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<OrganizerSearchResult | null>(null);
  const [message, setMessage] = useState('');
  const [searching, setSearching] = useState(false);

  const [splitDialogPartnership, setSplitDialogPartnership] = useState<VenueOrganizerPartnership | null>(null);

  const incoming = partnerships.filter((p) => p.status === 'pending' && p.initiated_by === 'organizer');
  const outgoing = partnerships.filter((p) => p.status === 'pending' && p.initiated_by === 'venue');
  const active = partnerships.filter((p) => p.status === 'active');
  const past = partnerships.filter((p) => ['declined', 'revoked'].includes(p.status));

  const handleSearch = async () => {
    if (search.trim().length < 2) return;
    setSearching(true);
    const term = search.trim();
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, organization_name, avatar_url, profile_type')
      .eq('profile_type', 'organizer')
      .or(`organization_name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
      .limit(10);
    setSearching(false);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
      return;
    }
    setResults((data || []) as unknown as OrganizerSearchResult[]);
  };

  const handleSend = async () => {
    if (!selectedOrg) return;
    await inviteOrganizer.mutateAsync({ organizerUserId: selectedOrg.id, message });
    setInviteOpen(false);
    setSelectedOrg(null);
    setMessage('');
    setSearch('');
    setResults([]);
  };

  if (!venueId && !isLoading) {
    return (
      <div className="container mx-auto p-6 max-w-3xl">
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">{t('partnerships.noClub')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/owner/dashboard')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Handshake className="h-6 w-6 text-primary" />
            {t('partnerships.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {venueName} · {t('partnerships.headerDesc')}
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="gap-2">
          <Send className="h-4 w-4" /> {t('partnerships.inviteOrganizer')}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">{t('common.loading')}</div>
      ) : (
        <div className="space-y-6">
          {incoming.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <Inbox className="h-4 w-4" /> {t('partnerships.incomingRequests')} ({incoming.length})
              </h2>
              <div className="grid gap-3">
                {incoming.map((p) => (
                  <PartnershipCard
                    key={p.id}
                    partnership={p}
                    showAccept
                    onAccept={() => respond.mutate({ id: p.id, accept: true })}
                    onDecline={() => respond.mutate({ id: p.id, accept: false })}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3">
              {t('partnerships.activePartnerships')} ({active.length})
            </h2>
            {active.length === 0 ? (
              <Card className="p-8 text-center bg-card/40">
                <User className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {t('partnerships.noActive')}
                </p>
              </Card>
            ) : (
              <div className="grid gap-3">
                {active.map((p) => (
                  <PartnershipCard
                    key={p.id}
                    partnership={p}
                    onEditSplit={() => setSplitDialogPartnership(p)}
                    onEditResponsibilities={() => setRespDialogPartnership(p)}
                    onAcceptProposal={() => respondToSplitProposal.mutate({ partnership: p, accept: true })}
                    onDeclineProposal={() => respondToSplitProposal.mutate({ partnership: p, accept: false })}
                    proposalPending={respondToSplitProposal.isPending}
                    onRevoke={() => {
                      if (confirm(t('partnerships.confirmRevoke'))) {
                        revoke.mutate(p.id);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          {outgoing.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3">
                {t('partnerships.outgoingInvites')} ({outgoing.length})
              </h2>
              <div className="grid gap-3">
                {outgoing.map((p) => (
                  <PartnershipCard key={p.id} partnership={p} onRevoke={() => revoke.mutate(p.id)} />
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3">{t('partnerships.history')}</h2>
              <div className="grid gap-3 opacity-70">
                {past.map((p) => <PartnershipCard key={p.id} partnership={p} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('partnerships.inviteOrganizer')}</DialogTitle>
            <DialogDescription>
              {t('partnerships.inviteDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder={t('partnerships.orgNamePlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={searching} variant="secondary" size="icon">
                <Search className="h-4 w-4" />
              </Button>
            </div>

            {results.length > 0 && !selectedOrg && (
              <div className="space-y-1 max-h-60 overflow-auto border border-border/40 rounded-lg p-2">
                {results.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setSelectedOrg(o)}
                    className="w-full flex items-center gap-3 p-2 rounded hover:bg-card/60 text-left"
                  >
                    {o.avatar_url ? (
                      <img src={o.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-medium">
                        {o.organization_name ?? `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('partnerships.organizerRole')}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {selectedOrg && (
              <div className="border border-primary/30 rounded-lg p-3 bg-primary/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedOrg.avatar_url ? (
                      <img src={selectedOrg.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <User className="h-10 w-10 p-2 rounded-full bg-muted" />
                    )}
                    <div>
                      <div className="font-medium">
                        {selectedOrg.organization_name ?? `${selectedOrg.first_name ?? ''} ${selectedOrg.last_name ?? ''}`.trim()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('partnerships.organizerRole')}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedOrg(null)}>{t('partnerships.change')}</Button>
                </div>
              </div>
            )}

            {selectedOrg && (
              <div className="space-y-2">
                <Label>{t('partnerships.messageOptional')}</Label>
                <Textarea
                  placeholder={t('partnerships.conditionsPlaceholder')}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSend} disabled={!selectedOrg || inviteOrganizer.isPending}>
              <Send className="h-4 w-4 mr-2" /> {t('common.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Split rules dialog */}
      {splitDialogPartnership && (
        <PartnershipSplitEditor
          open={!!splitDialogPartnership}
          onOpenChange={(o) => !o && setSplitDialogPartnership(null)}
          partnership={splitDialogPartnership}
          side="venue"
          onPropose={async (rules) => {
            await proposeSplitUpdate.mutateAsync({ id: splitDialogPartnership.id, rules });
          }}
          isPending={proposeSplitUpdate.isPending}
        />
      )}

      {/* Qui fait quoi par défaut — pré-remplit les futures collaborations avec
          ce partenaire. Pas de flux de proposition : ça n'engage rien. */}
      {respDialogPartnership && (
        <PartnershipResponsibilitiesDialog
          open={!!respDialogPartnership}
          onOpenChange={(o) => !o && setRespDialogPartnership(null)}
          current={respDialogPartnership.default_responsibilities}
          partnerName={respDialogPartnership.organizer?.organization_name ?? null}
          isPending={updateResponsibilities.isPending}
          onSave={async (responsibilities) => {
            await updateResponsibilities.mutateAsync({ id: respDialogPartnership.id, responsibilities });
            setRespDialogPartnership(null);
          }}
        />
      )}
    </div>
  );
}

function PartnershipCard({
  partnership,
  showAccept,
  onAccept,
  onDecline,
  onRevoke,
  onEditSplit,
  onEditResponsibilities,
  onAcceptProposal,
  onDeclineProposal,
  proposalPending,
}: {
  partnership: VenueOrganizerPartnership;
  showAccept?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onRevoke?: () => void;
  onEditSplit?: () => void;
  onEditResponsibilities?: () => void;
  onAcceptProposal?: () => void;
  onDeclineProposal?: () => void;
  proposalPending?: boolean;
}) {
  const { t, language } = useLanguage();
  const status = statusLabels[partnership.status];
  const proposalStatus = getPartnershipProposalStatus(partnership);
  const orgName =
    partnership.organizer?.organization_name ??
    `${partnership.organizer?.first_name ?? ''} ${partnership.organizer?.last_name ?? ''}`.trim() ??
    'Organisateur';
  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        {partnership.organizer?.avatar_url ? (
          <img src={partnership.organizer.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <User className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium truncate">{orgName}</h3>
            <Badge variant={status.variant}>{t(status.label)}</Badge>
            <Badge variant="outline" className="text-[10px]">
              {partnership.initiated_by === 'venue' ? t('partnerships.initiatedByYou') : t('partnerships.initiatedByOrg')}
            </Badge>
          </div>
          {partnership.invitation_message && (
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2 italic">
              « {partnership.invitation_message} »
            </p>
          )}
          <div className="text-[11px] text-muted-foreground mt-2">
            {partnership.status === 'active' && partnership.accepted_at
              ? `${t('partnerships.activeSince')} ${format(new Date(partnership.accepted_at), 'd MMM yyyy', { locale: dfLocale(language) })}`
              : `${t('partnerships.requestedOn')} ${format(new Date(partnership.requested_at), 'd MMM yyyy', { locale: dfLocale(language) })}`}
          </div>

          {partnership.status === 'active' && (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <SplitChip label={t('partnerships.splitTickets')} pct={partnership.default_split_rules?.tickets?.organizer_pct ?? 0} you={t('partnerships.you')} org={t('partnerships.org')} />
                <SplitChip label={t('partnerships.splitTables')} pct={partnership.default_split_rules?.tables?.organizer_pct ?? 0} you={t('partnerships.you')} org={t('partnerships.org')} />
                <SplitChip label={t('partnerships.splitDrinks')} pct={partnership.default_split_rules?.drinks?.organizer_pct ?? 0} you={t('partnerships.you')} org={t('partnerships.org')} />
              </div>
              {proposalStatus !== 'no_proposal' && onAcceptProposal && onDeclineProposal && (
                <div className="mt-3">
                  <PartnershipProposalBanner
                    partnership={partnership}
                    side="venue"
                    onAccept={onAcceptProposal}
                    onDecline={onDeclineProposal}
                    isPending={proposalPending}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          {showAccept && (
            <>
              <Button size="sm" onClick={onAccept} className="gap-1">
                <Check className="h-3.5 w-3.5" /> {t('common.accept')}
              </Button>
              <Button size="sm" variant="outline" onClick={onDecline} className="gap-1">
                <X className="h-3.5 w-3.5" /> {t('common.decline')}
              </Button>
            </>
          )}
          {onEditSplit && proposalStatus === 'no_proposal' && (
            <Button size="sm" variant="outline" onClick={onEditSplit} className="gap-1">
              <Settings2 className="h-3.5 w-3.5" /> {t('partnerships.splits')}
            </Button>
          )}
          {/* Pendant de « Partages » pour les responsabilités : l'argent d'un côté,
              qui décide de l'autre, réglés une fois pour ce partenaire. */}
          {onEditResponsibilities && partnership.status === 'active' && (
            <Button size="sm" variant="outline" onClick={onEditResponsibilities} className="gap-1">
              <Users className="h-3.5 w-3.5" /> {t('partnerships.responsibilities')}
            </Button>
          )}
          {onRevoke && partnership.status !== 'revoked' && partnership.status !== 'declined' && (
            <Button size="sm" variant="ghost" onClick={onRevoke} className="text-destructive gap-1">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function SplitChip({ label, pct, org, you }: { label: string; pct: number; org: string; you: string }) {
  return (
    <div className="rounded border border-border/40 px-2 py-1 bg-card/40">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono">{org} {pct}% · {you} {100 - pct}%</div>
    </div>
  );
}

function SplitRulesDialog({
  partnership,
  onClose,
  onSave,
}: {
  partnership: VenueOrganizerPartnership;
  onClose: () => void;
  onSave: (rules: PartnershipSplitRules) => void;
}) {
  const initial: PartnershipSplitRules = partnership.default_split_rules ?? DEFAULT_PARTNERSHIP_SPLIT;
  const [tickets, setTickets] = useState(initial.tickets.organizer_pct);
  const [tables, setTables] = useState(initial.tables.organizer_pct);
  const [drinks, setDrinks] = useState(initial.drinks?.organizer_pct ?? 0);
  // Drinks stay 100% club UNLESS the organizer attested their alcohol-sale licence.
  const [orgCanSellAlcohol, setOrgCanSellAlcohol] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('organizer_profiles')
        .select('can_sell_alcohol')
        .eq('user_id', partnership.organizer_user_id)
        .maybeSingle();
      if (active) setOrgCanSellAlcohol(Boolean((data as { can_sell_alcohol?: boolean } | null)?.can_sell_alcohol));
    })();
    return () => { active = false; };
  }, [partnership.organizer_user_id]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Règles de partage par défaut</DialogTitle>
          <DialogDescription>
            Pourcentage qui revient à l'organisateur. Le reste est pour ton club. Ces valeurs serviront de base pour chaque event co-organisé (modifiables au cas par cas).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <SplitSlider label="Billets" value={tickets} onChange={setTickets} />
          <SplitSlider label="Tables VIP" value={tables} onChange={setTables} />
          {orgCanSellAlcohol ? (
            <SplitSlider label="Boissons" value={drinks} onChange={setDrinks} />
          ) : (
            <div className="space-y-2 opacity-80">
              <div className="flex items-center justify-between">
                <Label>Boissons</Label>
                <div className="text-sm font-mono text-muted-foreground">
                  100% club <span className="text-[10px] uppercase ml-1 text-primary">politique Yuno</span>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                La carte des boissons appartient au club. L'organisateur peut attester ses documents légaux d'alcool dans son profil pour négocier une part.
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            ℹ️ Les frais Yuno et Stripe sont prélevés avant le split. Toute modification après acceptation par l'organisateur déclenchera une nouvelle proposition à valider.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button
            onClick={() =>
              onSave({
                tickets: { organizer_pct: tickets, venue_pct: 100 - tickets },
                tables: { organizer_pct: tables, venue_pct: 100 - tables },
                drinks: orgCanSellAlcohol
                  ? { organizer_pct: drinks, venue_pct: 100 - drinks }
                  : { organizer_pct: 0, venue_pct: 100 },
              })
            }
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SplitSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <div className="text-sm font-mono text-muted-foreground">
          Orga <span className="text-foreground font-semibold">{value}%</span> · Club <span className="text-foreground font-semibold">{100 - value}%</span>
        </div>
      </div>
      <Slider value={[value]} onValueChange={(v) => onChange(v[0])} min={0} max={100} step={5} />
    </div>
  );
}
