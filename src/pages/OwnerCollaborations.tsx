import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenuePartnerships, type VenueOrganizerPartnership } from '@/hooks/useOrganizerPartnerships';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { isCollabPlan } from '@/lib/planFeatures';
import { OwnerHeader } from '@/components/OwnerHeader';
import { ProPageSkeleton } from '@/components/DashboardSkeleton';
import { PRO_PAGE } from '@/lib/proLayout';
import { ClubProposeEventDialog } from '@/components/owner/ClubProposeEventDialog';
import { CollabProposalsInbox } from '@/components/collab/CollabProposalsInbox';
import { CollabPendingAmendments } from '@/components/collab/CollabPendingAmendments';
import { CollabSeriesContracts } from '@/components/collab/CollabSeriesContracts';
import { CoorgInvitesInbox, CoorgPartnersSection } from '@/components/coorg/CoorgHubParts';
import { CollabHub } from '@/components/collab-hub/CollabHub';
import { ClubInviteDealFields, type ClubInviteDeal } from '@/components/collab/ClubInviteDealFields';
import { PartnershipSplitEditor, PartnershipProposalBanner } from '@/components/organizer-app/PartnershipSplitEditor';
import { getPartnershipProposalStatus } from '@/hooks/useOrganizerPartnerships';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Send, Check, X, Trash2, Inbox, Search, Settings2,
  Mail, Sparkles, ExternalLink, ChevronDown,
} from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { ticketRevenue, tableRevenue, orderRevenue } from '@/utils/fees';
import { useNumberFormat } from '@/components/analytics/kitFormat';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED       = '#E8192C';
const POS       = 'var(--acc-34d399)';
const AMBER     = 'var(--acc-f5a623)';
const NEG       = 'var(--acc-ff5c63)';
const T1        = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2        = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3        = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER    = 'rgb(var(--ink)/0.085)';
const F_BORDER  = 'rgb(var(--ink)/0.055)';
const C_FAINT   = 'rgb(var(--ink)/0.06)';
const INNER_BG  = 'rgb(var(--ink)/0.032)';
const TILE_BG   = 'rgb(var(--ink)/0.025)';
const CARD_BG   = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

// ─── Inline chip ──────────────────────────────────────────────────────────────
function Chip({ label, color, bg, border, className }: { label: string; color: string; bg: string; border: string; className?: string }) {
  return (
    <span className={className} style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 6,
      fontSize: 10.5, fontWeight: 600, color, background: bg, border: `1px solid ${border}`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

// ─── Inline action buttons ────────────────────────────────────────────────────
function PrimaryBtn({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-1.5 cursor-pointer transition-all duration-150 ${className ?? ''}`}
      style={{ padding: '7px 14px', borderRadius: 10, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: RED, fontSize: 12.5, fontWeight: 600, opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

function SecondaryBtn({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-1.5 cursor-pointer transition-all duration-150 ${className ?? ''}`}
      style={{ padding: '7px 14px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12.5, fontWeight: 600, opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

function DangerBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 cursor-pointer transition-all duration-150"
      style={{ padding: '7px 10px', borderRadius: 10, background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.20)', color: NEG, fontSize: 12.5, fontWeight: 600 }}>
      {children}
    </button>
  );
}

function GhostLinkBtn({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-1.5" style={{ padding: '6px 10px', borderRadius: 9, background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 11.5, fontWeight: 560, textDecoration: 'none' }}>
      {children}
    </Link>
  );
}

// ─── Native input/textarea ────────────────────────────────────────────────────
function YunoInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const { label, ...rest } = props;
  return (
    <div>
      {label && <p style={{ color: T3, fontSize: 11.5, marginBottom: 6 }}>{label}</p>}
      <input
        {...rest}
        className="w-full outline-none"
        style={{
          background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
          padding: '10px 12px', color: T1, fontSize: 13, fontFamily: 'inherit',
          ...rest.style,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgb(var(--ink)/0.18)'; rest.onFocus?.(e); }}
        onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; rest.onBlur?.(e); }}
      />
    </div>
  );
}

function YunoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const { label, ...rest } = props;
  return (
    <div>
      {label && <p style={{ color: T3, fontSize: 11.5, marginBottom: 6 }}>{label}</p>}
      <textarea
        {...rest}
        className="w-full outline-none resize-none"
        style={{
          background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
          padding: '10px 12px', color: T1, fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5,
          ...rest.style,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgb(var(--ink)/0.18)'; rest.onFocus?.(e); }}
        onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; rest.onBlur?.(e); }}
      />
    </div>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────────
interface OrganizerSearchResult {
  id: string; first_name: string | null; last_name: string | null;
  organization_name: string | null; avatar_url: string | null;
}

/**
 * Collaborations — Console Club. Même hub que l'organisateur (`CollabHub`,
 * plan `docs/designs/COLLAB_SIMPLIFICATION_PLAN.md`) : Soirées (à traiter +
 * une seule liste, contrats ET co-organisations) et Partenaires, une seule
 * action « Nouvelle collaboration ».
 */
export default function OwnerCollaborations() {
  const { user } = useAuth();
  const { plan } = useSubscriptionPlan();
  // Un club au plan Collaboration reçoit des soirées ; il n'en propose pas.
  const isCollab = isCollabPlan(plan);
  const { t } = useLanguage();

  const [venueId, setVenueId]   = useState<string | undefined>(undefined);
  const [venueName, setVenueName] = useState('');
  const [venueLookupError, setVenueLookupError] = useState(false);
  const [venueLookupNonce, setVenueLookupNonce] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase.from('venues').select('id, name').eq('owner_id', user.id).limit(1).maybeSingle();
      if (error) { console.error('venue lookup error:', error); setVenueLookupError(true); return; }
      setVenueLookupError(false);
      if (data) { setVenueId(data.id); setVenueName(data.name); }
    })();
  }, [user, venueLookupNonce]);

  const { partnerships } = useVenuePartnerships(venueId);
  const active = partnerships.filter((p) => p.status === 'active');
  // Un organisateur déjà partenaire n'apparaît qu'une fois : dans la liste des partenariats.
  const covered = new Set(active.map((p) => `org:${p.organizer_user_id}`));

  // Chargement du club : le squelette de la page (en-tête réel + cartes).
  if (!venueId && !venueLookupError) return <ProPageSkeleton variant="cards" title="Collaborations" />;

  if (!venueId) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--sf-000000)' }}>
        <OwnerHeader title="Collaborations" />
        <div className={`${PRO_PAGE} py-6`}>
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, padding: '32px', textAlign: 'center' }}>
            <p style={{ color: T3, fontSize: 13 }}>
              {venueLookupError ? t('collab.loadError') : t('collab.loading')}
            </p>
            {venueLookupError && (
              <button
                onClick={() => setVenueLookupNonce((n) => n + 1)}
                style={{ marginTop: 14, color: T1, fontSize: 13, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 18px', cursor: 'pointer' }}
              >
                {t('collab.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const scope = { venueId };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sf-000000)' }}>
      <OwnerHeader title="Collaborations" />
      <div className={`${PRO_PAGE} py-4 sm:py-8`}>
        <CollabHub
          side="venue"
          scope={scope}
          basePath="/owner"
          showTitle={false}
          subtitle={`${venueName} · ${t('collab.subtitle')}`}
          canStart
          canPropose={!isCollab}
          hasActivePartners={active.length > 0}
          todo={(reload) => (
            <>
              <CollabProposalsInbox role="venue" venueId={venueId} onChanged={reload} />
              <CollabPendingAmendments role="venue" venueId={venueId} onChanged={reload} />
              <CoorgInvitesInbox scope={scope} basePath="/owner" onChanged={reload} />
            </>
          )}
          partners={
            <>
              <OrganizersTab venueId={venueId} canPropose={!isCollab} />
              <CollabSeriesContracts role="venue" venueId={venueId} />
              <CoorgPartnersSection scope={scope} basePath="/owner" excludeKeys={covered} />
            </>
          }
          renderPropose={(p) => (
            <ClubProposeEventDialog open={p.open} onOpenChange={p.onOpenChange} venueId={venueId} preselectedOrganizerId={p.preselect} onCreated={p.onCreated} />
          )}
          renderInvite={(onSent) => <InviteTab venueId={venueId} onSent={onSent} />}
        />
      </div>
    </div>
  );
}

/* =========================================================================
 * TAB 2 — Partner organizers
 * ========================================================================= */
function OrganizersTab({ venueId, canPropose }: { venueId: string; canPropose: boolean }) {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const [showHistory, setShowHistory] = useState(false);
  const { partnerships, isLoading, inviteOrganizer, respond, proposeSplitUpdate, respondToSplitProposal, revoke } = useVenuePartnerships(venueId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<OrganizerSearchResult[]>([]);
  const [selected, setSelected] = useState<OrganizerSearchResult | null>(null);
  const [message, setMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const [splitDialog, setSplitDialog] = useState<VenueOrganizerPartnership | null>(null);

  // « Nouvelle collaboration › Ajouter un organisateur déjà sur Yuno » arrive
  // ici avec `?request=1` : on ouvre la recherche, puis on nettoie l'adresse.
  const requestParam = params.get('request');
  useEffect(() => {
    if (requestParam !== '1') return;
    setInviteOpen(true);
    const next = new URLSearchParams(params);
    next.delete('request');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestParam]);

  const incoming = partnerships.filter((p) => p.status === 'pending' && p.initiated_by === 'organizer');
  const outgoing = partnerships.filter((p) => p.status === 'pending' && p.initiated_by === 'venue');
  const active   = partnerships.filter((p) => p.status === 'active');
  const past     = partnerships.filter((p) => ['declined', 'revoked'].includes(p.status));

  const handleSearch = async () => {
    if (search.trim().length < 2) return;
    setSearching(true);
    const term = search.trim();
    // RPC SECURITY DEFINER : la RLS de `profiles` n'expose pas les profils orga
    // aux owners (filtrage silencieux -> 0 résultat). Voir migration
    // 20260623120000_search_organizers_rpc.sql.
    const { data, error } = await supabase.rpc('search_organizers', { search_term: term });
    setSearching(false);
    if (error) {
      sonnerToast.error(t('common.error'), { description: error.message });
      return;
    }
    setResults((data || []) as OrganizerSearchResult[]);
  };

  const handleSend = async () => {
    if (!selected) return;
    await inviteOrganizer.mutateAsync({ organizerUserId: selected.id, message });
    setInviteOpen(false); setSelected(null); setMessage(''); setSearch(''); setResults([]);
  };

  if (isLoading) return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, padding: '32px', textAlign: 'center' }}>
      <p style={{ color: T3, fontSize: 13 }}>{t('collab.loading')}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {incoming.length > 0 && (
        <section>
          <h3 className="flex items-center gap-1.5 mb-3" style={{ color: T3, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <Inbox className="h-4 w-4" /> {t('collab.organizers.incoming')} ({incoming.length})
          </h3>
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3 lg:items-start">
            {incoming.map((p) => (
              <PartnershipCard key={p.id} partnership={p} showAccept
                onAccept={() => respond.mutate({ id: p.id, accept: true })}
                onDecline={() => respond.mutate({ id: p.id, accept: false })} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3" style={{ color: T3, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {t('collab.organizers.active')} ({active.length})
        </h3>
        {active.length === 0 ? (
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '40px 24px', textAlign: 'center' }}>
            <User className="h-10 w-10 mx-auto mb-3" style={{ color: T3 }} />
            <p style={{ color: T3, fontSize: 13 }}>{t('collab.organizers.emptyActive')}</p>
            <div className="mt-4 flex justify-center">
              <SecondaryBtn onClick={() => setInviteOpen(true)}><Search className="h-3.5 w-3.5" /> {t('collab.organizers.inviteBtn')}</SecondaryBtn>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3 lg:items-start">
            {active.map((p) => (
              <PartnershipCard key={p.id} partnership={p} venueId={venueId}
                onEditSplit={() => setSplitDialog(p)}
                onProposeEvent={canPropose ? () => setParams({ tab: 'nights', propose: p.organizer_user_id }) : undefined}
                onAcceptProposal={() => respondToSplitProposal.mutate({ partnership: p, accept: true })}
                onDeclineProposal={() => respondToSplitProposal.mutate({ partnership: p, accept: false })}
                proposalPending={respondToSplitProposal.isPending}
                onRevoke={() => { if (confirm(t('collab.organizers.revokeConfirm'))) revoke.mutate(p.id); }} />
            ))}
          </div>
        )}
      </section>

      {outgoing.length > 0 && (
        <section>
          <h3 className="mb-3" style={{ color: T3, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('collab.organizers.outgoing')} ({outgoing.length})</h3>
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3 lg:items-start">
            {outgoing.map((p) => <PartnershipCard key={p.id} partnership={p} onRevoke={() => revoke.mutate(p.id)} />)}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="mb-3 flex cursor-pointer items-center gap-1.5" style={{ color: T3, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('collab.organizers.history')} ({past.length})
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
          {showHistory && (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3 lg:items-start" style={{ opacity: 0.65 }}>
              {past.map((p) => <PartnershipCard key={p.id} partnership={p} />)}
            </div>
          )}
        </section>
      )}

      {/* Invite modal */}
      <AnimatePresence>
        {inviteOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40"
              style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setInviteOpen(false)}
            />
            {/* Flex wrapper centers reliably — framer-motion writes an inline
                `transform` for the `y` animation, which would override Tailwind's
                `-translate-x-1/2 -translate-y-1/2` centering and push the modal
                into the lower-right quadrant. */}
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pointer-events-none">
            <motion.div
              className="pointer-events-auto w-full sm:max-w-lg"
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.22 }}
              style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${BORDER}`, borderRadius: 18, padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}
            >
              <h2 style={{ color: T1, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{t('collab.inviteModal.title')}</h2>
              <p style={{ color: T3, fontSize: 12.5, marginBottom: 20 }}>{t('collab.inviteModal.subtitle')}</p>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    placeholder={t('collab.inviteModal.searchPlaceholder')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="flex-1 outline-none"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 12px', color: T1, fontSize: 13, fontFamily: 'inherit' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'rgb(var(--ink)/0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; }}
                  />
                  <button
                    onClick={handleSearch} disabled={searching}
                    className="flex items-center justify-center cursor-pointer transition-all duration-150 flex-none"
                    style={{ width: 42, height: 42, borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
                  >
                    <Search className="h-4 w-4" />
                  </button>
                </div>

                {results.length > 0 && !selected && (
                  <div className="max-h-60 overflow-auto rounded-xl" style={{ border: `1px solid ${BORDER}`, background: TILE_BG }}>
                    {results.map((o) => (
                      <button key={o.id} onClick={() => setSelected(o)}
                        className="w-full flex items-center gap-3 p-3 text-left cursor-pointer transition-all duration-150"
                        style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                        {o.avatar_url
                          ? <img src={o.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover flex-none" />
                          : <div className="h-8 w-8 rounded-full flex items-center justify-center flex-none" style={{ background: C_FAINT }}><User className="h-4 w-4" style={{ color: T3 }} /></div>
                        }
                        <span style={{ color: T1, fontSize: 13 }}>{o.organization_name ?? `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim()}</span>
                      </button>
                    ))}
                  </div>
                )}

                {selected && (
                  <>
                    <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.20)' }}>
                      <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{selected.organization_name ?? `${selected.first_name ?? ''} ${selected.last_name ?? ''}`.trim()}</span>
                      <button onClick={() => setSelected(null)} style={{ color: T3, fontSize: 12, cursor: 'pointer' }}>{t('collab.inviteModal.change')}</button>
                    </div>
                    <YunoTextarea rows={3} label={t('collab.inviteModal.messageOptional')} value={message} onChange={(e) => setMessage(e.target.value)} />
                  </>
                )}
              </div>

              <div className="flex gap-2 mt-5">
                <SecondaryBtn onClick={() => setInviteOpen(false)} className="flex-1 justify-center">{t('collab.inviteModal.cancel')}</SecondaryBtn>
                <PrimaryBtn onClick={handleSend} disabled={!selected || inviteOrganizer.isPending} className="flex-1 justify-center">
                  <Send className="h-3.5 w-3.5" /> {t('collab.inviteModal.send')}
                </PrimaryBtn>
              </div>
            </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {splitDialog && (
        <PartnershipSplitEditor
          open={!!splitDialog}
          onOpenChange={(o) => !o && setSplitDialog(null)}
          partnership={splitDialog}
          side="venue"
          onPropose={async (rules) => { await proposeSplitUpdate.mutateAsync({ id: splitDialog.id, rules }); }}
          isPending={proposeSplitUpdate.isPending}
        />
      )}
    </div>
  );
}

function PartnershipCard({ partnership, venueId, showAccept, onAccept, onDecline, onRevoke, onEditSplit, onProposeEvent, onAcceptProposal, onDeclineProposal, proposalPending }: {
  partnership: VenueOrganizerPartnership;
  venueId?: string;
  showAccept?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onRevoke?: () => void;
  onEditSplit?: () => void;
  onProposeEvent?: () => void;
  onAcceptProposal?: () => void;
  onDeclineProposal?: () => void;
  proposalPending?: boolean;
}) {
  const { t } = useLanguage();
  const statusStyles: Record<string, { label: string; color: string; bg: string; border: string }> = {
    pending:  { label: t('collab.status.pending'),  color: T3,  bg: INNER_BG,                    border: BORDER },
    active:   { label: t('collab.status.active'),   color: POS, bg: 'rgba(52,211,153,0.10)',      border: 'rgba(52,211,153,0.25)' },
    declined: { label: t('collab.status.declined'), color: T3,  bg: TILE_BG,                     border: F_BORDER },
    revoked:  { label: t('collab.status.revoked'),  color: NEG, bg: 'rgba(255,92,99,0.08)',       border: 'rgba(255,92,99,0.20)' },
  };
  const statusStyle = statusStyles[partnership.status] ?? statusStyles.pending;
  const proposalStatus = getPartnershipProposalStatus(partnership);
  const orgName = (partnership.organizer?.organization_name
    ?? `${partnership.organizer?.first_name ?? ''} ${partnership.organizer?.last_name ?? ''}`.trim())
    || t('collab.organizer');
  const slug = partnership.organizer?.slug;
  const hasActions = showAccept || onProposeEvent || onEditSplit || onRevoke;
  const canRevoke = onRevoke && partnership.status !== 'revoked' && partnership.status !== 'declined';

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 16 }}>
      {/* ── Header : identity ─────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        {partnership.organizer?.avatar_url ? (
          <img src={partnership.organizer.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover flex-none" style={{ border: `1px solid ${F_BORDER}` }} />
        ) : (
          <div className="h-12 w-12 rounded-full flex items-center justify-center flex-none" style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
            <User className="h-5 w-5" style={{ color: T3 }} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="truncate" style={{ color: T1, fontSize: 15, fontWeight: 680, letterSpacing: '-0.01em' }}>{orgName}</h3>
            {partnership.status !== 'active' && (
              <Chip label={statusStyle.label} color={statusStyle.color} bg={statusStyle.bg} border={statusStyle.border} />
            )}
          </div>

          {slug && (
            <Link to={`/o/${slug}`} className="inline-flex items-center gap-1" style={{ color: T3, fontSize: 11.5, textDecoration: 'none' }}>
              {t('collab.organizers.viewProfile')} <ExternalLink className="h-3 w-3" />
            </Link>
          )}

          {partnership.invitation_message && (
            <p className="italic line-clamp-2" style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>« {partnership.invitation_message} »</p>
          )}
        </div>
      </div>

      {/* ── Revenue split — full width, readable ──────────────────────── */}
      {partnership.status === 'active' && (
        <div className="mt-4">
          <p style={{ color: T3, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 8 }}>
            {t('collab.organizers.splitTitle')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <SplitChip label={t('collab.organizers.splitTickets')} orgLabel={t('collab.organizers.splitOrgPct')} youLabel={t('collab.organizers.splitYouPct')} pct={partnership.default_split_rules?.tickets?.organizer_pct ?? 0} />
            <SplitChip label={t('collab.organizers.splitTables')}  orgLabel={t('collab.organizers.splitOrgPct')} youLabel={t('collab.organizers.splitYouPct')} pct={partnership.default_split_rules?.tables?.organizer_pct ?? 0} />
            <SplitChip label={t('collab.organizers.splitDrinks')}  orgLabel={t('collab.organizers.splitOrgPct')} youLabel={t('collab.organizers.splitYouPct')} pct={partnership.default_split_rules?.drinks?.organizer_pct ?? 0} />
          </div>
          {proposalStatus !== 'no_proposal' && onAcceptProposal && onDeclineProposal && (
            <div className="mt-3">
              <PartnershipProposalBanner partnership={partnership} side="venue"
                onAccept={onAcceptProposal} onDecline={onDeclineProposal} isPending={proposalPending} />
            </div>
          )}
        </div>
      )}

      {/* ── Track record — what this club and org built together ──────── */}
      {partnership.status === 'active' && venueId && partnership.organizer_user_id && (
        <PartnershipTrackRecord venueId={venueId} organizerUserId={partnership.organizer_user_id} />
      )}

      {/* ── Actions — full width row ──────────────────────────────────── */}
      {hasActions && (
        <div className="flex flex-wrap items-center gap-2 mt-4" style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 14 }}>
          {showAccept && (
            <>
              <PrimaryBtn onClick={onAccept}><Check className="h-3.5 w-3.5" />{t('collab.organizers.accept')}</PrimaryBtn>
              <SecondaryBtn onClick={onDecline}><X className="h-3.5 w-3.5" />{t('collab.organizers.decline')}</SecondaryBtn>
            </>
          )}
          {onProposeEvent && (
            <PrimaryBtn onClick={onProposeEvent}><Sparkles className="h-3.5 w-3.5" />{t('collab.organizers.proposeEventBtn')}</PrimaryBtn>
          )}
          {onEditSplit && proposalStatus === 'no_proposal' && (
            <SecondaryBtn onClick={onEditSplit}><Settings2 className="h-3.5 w-3.5" />{t('collab.organizers.editSplit')}</SecondaryBtn>
          )}
          {canRevoke && (
            <>
              <div className="flex-1" />
              <DangerBtn onClick={onRevoke}><Trash2 className="h-3.5 w-3.5" />{t('collab.organizers.revoke')}</DangerBtn>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SplitChip({ label, pct, orgLabel, youLabel }: { label: string; pct: number; orgLabel: string; youLabel: string }) {
  return (
    <div style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 10, padding: '10px 11px' }}>
      <p className="truncate" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 7 }}>{label}</p>
      <div className="flex items-baseline justify-between gap-1">
        <span style={{ color: T2, fontSize: 11.5 }}>{orgLabel}</span>
        <span className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 700 }}>{pct}%</span>
      </div>
      <div className="flex items-baseline justify-between gap-1" style={{ marginTop: 3 }}>
        <span style={{ color: T2, fontSize: 11.5 }}>{youLabel}</span>
        <span className="tabular-nums" style={{ color: RED, fontSize: 14, fontWeight: 700 }}>{100 - pct}%</span>
      </div>
    </div>
  );
}

/* =========================================================================
 * Partnership track record — "what you built together" across all co-events
 * Frontend-only aggregation: counts the co-events for THIS club + org pair and
 * sums attendance and gross revenue. Makes a long-running collab feel like a
 * relationship with a history, not a one-off dashboard.
 * ========================================================================= */
function PartnershipTrackRecord({ venueId, organizerUserId }: { venueId: string; organizerUserId: string }) {
  const { language } = useLanguage();
  const fmt = useNumberFormat();
  const tt = (frv: string, en: string, es?: string) => translate(language, frv, en, es);
  const [stats, setStats] = useState<{ events: number; participants: number; gross: number; sinceYear: number | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Co-events for this exact club+org pair, in either direction (club-led or org-led).
      const { data: evs } = await supabase.from('events')
        .select('id, start_at')
        .or(`and(venue_id.eq.${venueId},partner_organizer_id.eq.${organizerUserId}),and(partner_venue_id.eq.${venueId},organizer_user_id.eq.${organizerUserId})`);
      if (cancelled) return;
      const events = evs || [];
      const ids = events.map((e) => e.id);
      if (ids.length === 0) { setStats({ events: 0, participants: 0, gross: 0, sinceYear: null }); return; }

      const [tk, tr, gl, dr] = await Promise.all([
        supabase.from('tickets').select('total_price, quantity, service_fee, insurance_fee').eq('status', 'paid').in('event_id', ids),
        // guest_count (sans s) + status 'paid' : guests_count n'existe pas (la
        // requête entière échouait en 400) et 'confirmed' n'est jamais écrit.
        supabase.from('table_reservations').select('total_price, guest_count, service_fee, management_fee, fee_absorbed').eq('status', 'paid').in('event_id', ids),
        supabase.from('guest_list_entries').select('id, guest_lists!inner(event_id)').in('guest_lists.event_id', ids),
        supabase.from('orders').select('total, service_fee, refund_amount').eq('status', 'paid').in('event_id', ids),
      ]);
      if (cancelled) return;

      const tickets = tk.data || [];
      const tables = tr.data || [];
      const entries = gl.data || [];
      const drinks = dr.data || [];
      const ticketsSold = tickets.reduce((a, x) => a + (x.quantity || 1), 0);
      const tableGuests = tables.reduce((a, x) => a + (x.guest_count || 0), 0);
      // CA = montant client − frais Yuno (jamais le TTC : les frais Yuno ne sont pas du revenu).
      // Boissons incluses, comme le caSoiree du dashboard co-event — sinon le
      // même partenariat affiche deux CA différents selon la surface.
      const gross = tickets.reduce((a, x) => a + ticketRevenue(x).gross, 0)
        + tables.reduce((a, x) => a + tableRevenue(x).gross, 0)
        + drinks.reduce((a, x) => a + orderRevenue(x).gross, 0);
      const participants = ticketsSold + tableGuests + entries.length;
      const sinceYear = events.reduce<number | null>((min, e) => {
        const y = new Date(e.start_at).getFullYear();
        return min === null || y < min ? y : min;
      }, null);
      setStats({ events: events.length, participants, gross, sinceYear });
    })();
    return () => { cancelled = true; };
  }, [venueId, organizerUserId]);

  if (!stats || stats.events === 0) return null;

  const items = [
    { label: tt('Soirées ensemble', 'Nights together', 'Noches juntos'), value: String(stats.events) },
    { label: tt('Participants', 'Guests', 'Asistentes'), value: fmt.n(stats.participants) },
    { label: tt('CA généré', 'Revenue generated', 'Ingresos generados'), value: fmt.eur(Math.round(stats.gross)) },
  ];

  return (
    <div className="mt-4">
      <p style={{ color: T3, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 8 }}>
        {tt('Ce que vous avez construit ensemble', 'What you built together', 'Lo que han construido juntos')}
        {stats.sinceYear ? ` · ${tt('depuis', 'since', 'desde')} ${stats.sinceYear}` : ''}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {items.map((it) => (
          <div key={it.label} style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 10, padding: '10px 11px' }}>
            <p className="tabular-nums" style={{ color: T1, fontSize: 16, fontWeight: 700 }}>{it.value}</p>
            <p className="truncate" style={{ color: T3, fontSize: 10.5, marginTop: 2 }}>{it.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================================
 * TAB 3 — Invite (external organizer by email)
 * ========================================================================= */
/** Invitation par email d'un organisateur hors Yuno — ouverte depuis « Nouvelle collaboration » (ce n'est plus un onglet). */
function InviteTab({ venueId, onSent }: { venueId: string; onSent?: () => void }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    organizer_email: '', organizer_name: '',
    contact_first_name: '', contact_last_name: '', invitation_message: '',
  });
  const [sending, setSending] = useState(false);
  // Le deal part AVEC l'invitation : soirée, conditions, Stripe Oui / Non.
  const [deal, setDeal] = useState<ClubInviteDeal>({ eventId: null, rules: null, lang: 'fr', invalid: false });
  const onDeal = useCallback((d: ClubInviteDeal) => setDeal(d), []);

  const handleSend = async () => {
    if (!form.organizer_email.trim()) { sonnerToast.error(t('collab.external.emailRequired')); return; }
    if (deal.invalid) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-organizer-collab', {
        body: {
          ...form, venue_id: venueId, event_id: deal.eventId, default_split_rules: deal.rules,
          lang: deal.lang, origin: window.location.origin,
        },
      });
      if (error) {
        // Un refus serveur (4xx) porte son message dans le corps de la réponse.
        let msg = error.message;
        try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* corps illisible */ }
        throw new Error(msg);
      }
      if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
      sonnerToast.success(t('collab.external.inviteSentTitle'), { description: `${t('collab.external.inviteSentDesc')} ${form.organizer_email}.` });
      setForm({ organizer_email: '', organizer_name: '', contact_first_name: '', contact_last_name: '', invitation_message: '' });
      onSent?.();
    } catch (err) {
      sonnerToast.error((err instanceof Error && err.message) || 'Error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px' }}>
        <h3 className="flex items-center gap-2 mb-1" style={{ color: T1, fontSize: 15, fontWeight: 640 }}>
          <Mail className="h-4 w-4 flex-none" style={{ color: RED }} />
          {t('collab.external.title')}
        </h3>
        <p style={{ color: T3, fontSize: 12, marginBottom: 20 }}>
          {t('collab.external.desc')}
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <YunoInput type="email" label={t('collab.external.emailLabel')} value={form.organizer_email}
                onChange={(e) => setForm((f) => ({ ...f, organizer_email: e.target.value }))}
                placeholder="contact@vidaevents.fr" />
            </div>
            <div className="col-span-2">
              <YunoInput label={t('collab.external.orgNameLabel')} value={form.organizer_name}
                onChange={(e) => setForm((f) => ({ ...f, organizer_name: e.target.value }))}
                placeholder="Vida Events" />
            </div>
            <YunoInput label={t('collab.external.firstNameLabel')} value={form.contact_first_name}
              onChange={(e) => setForm((f) => ({ ...f, contact_first_name: e.target.value }))} />
            <YunoInput label={t('collab.external.lastNameLabel')} value={form.contact_last_name}
              onChange={(e) => setForm((f) => ({ ...f, contact_last_name: e.target.value }))} />
            <div className="col-span-2">
              <ClubInviteDealFields venueId={venueId} onChange={onDeal} />
            </div>
            <div className="col-span-2">
              <YunoTextarea rows={4} label={t('collab.external.messageLabel')} value={form.invitation_message}
                onChange={(e) => setForm((f) => ({ ...f, invitation_message: e.target.value }))}
                placeholder={t('collab.external.messagePlaceholder')} />
            </div>
          </div>

          <button
            onClick={handleSend} disabled={sending || deal.invalid}
            className="w-full flex items-center justify-center gap-2 cursor-pointer transition-all duration-150"
            style={{ padding: '11px 20px', borderRadius: 12, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: RED, fontSize: 13.5, fontWeight: 640, opacity: sending ? 0.6 : 1 }}
          >
            <Mail className="h-4 w-4" />
            {sending ? t('collab.external.sending') : t('collab.external.sendInvitation')}
          </button>
        </div>
      </div>

</div>
  );
}
