import { Check, Loader2, MapPin, Calendar, Users, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { OrgButton, RED, BORDER } from '@/components/org-ui';
import { PartyAvatar, useCoorgT } from './coorgUi';
import type { CohostInvite } from '@/lib/coorg';

/**
 * L'invitation en plein écran : l'affiche en toile de fond, la soirée, qui
 * l'invite, ce qu'on attend de toi (rôle, argent) et deux boutons. Le pro
 * décide en voyant la soirée, pas sur une ligne de texte.
 */
export function CoorgInvitePreview({ invite, roleLine, dateLabel, busy, onAccept, onDecline, onClose }: {
  invite: CohostInvite | null;
  roleLine: string;
  dateLabel: string;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  const { t } = useCoorgT();
  const inv = invite;
  return (
    <Dialog open={!!inv} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:rounded-none"
        style={{ background: 'var(--sf-0a0a0c)' }}
      >
        {inv && (
          <>
            <DialogTitle className="sr-only">{inv.event_title}</DialogTitle>
            <DialogDescription className="sr-only">{roleLine}</DialogDescription>
            <div className="relative min-h-0 flex-1 overflow-y-auto" data-theme-island="dark">
              {inv.poster_url && (
                <>
                  <img src={inv.poster_url} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl" />
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,10,12,0.35) 0%, rgba(10,10,12,0.92) 70%, #0a0a0c 100%)' }} />
                </>
              )}
              <div className="relative mx-auto flex min-h-full w-full max-w-4xl flex-col items-center gap-8 px-6 py-14 md:flex-row md:items-center md:gap-12">
                {inv.poster_url ? (
                  <img src={inv.poster_url} alt={inv.event_title}
                    className="w-56 flex-none rounded-2xl object-cover shadow-2xl md:w-72"
                    style={{ aspectRatio: '4 / 5', border: '1px solid rgba(255,255,255,0.12)' }} />
                ) : (
                  <div className="flex w-56 flex-none items-center justify-center rounded-2xl md:w-72" style={{ aspectRatio: '4 / 5', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <Calendar className="h-10 w-10" style={{ color: 'rgba(255,255,255,0.4)' }} />
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-5 text-center md:text-left">
                  <p className="uppercase" style={{ color: RED, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.14em' }}>
                    {t('Invitation', 'Invitation', 'Invitación')}
                  </p>
                  <h2 style={{ color: '#fff', fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05 }}>{inv.event_title}</h2>
                  <div className="space-y-2" style={{ color: 'rgba(255,255,255,0.72)', fontSize: 14.5 }}>
                    <p className="flex items-center justify-center gap-2 md:justify-start"><Calendar className="h-4 w-4 flex-none" />{dateLabel}</p>
                    {(inv.location || inv.city) && (
                      <p className="flex items-center justify-center gap-2 md:justify-start"><MapPin className="h-4 w-4 flex-none" />{[inv.location, inv.city].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <div className="rounded-2xl p-4 text-left" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em' }} className="uppercase">
                      {t('Invité par', 'Invited by', 'Invitado por')}
                    </p>
                    <p style={{ color: '#fff', fontSize: 16, fontWeight: 650, marginTop: 2 }}>{inv.invited_by_name}</p>
                    <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 1.55, marginTop: 8 }}>{roleLine}</p>
                    {inv.message && <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: 13, fontStyle: 'italic', marginTop: 8 }}>« {inv.message} »</p>}
                  </div>
                  {inv.parties && inv.parties.length > 0 && (
                    <div>
                      <p className="mb-2 flex items-center justify-center gap-1.5 md:justify-start" style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5, fontWeight: 600 }}>
                        <Users className="h-3.5 w-3.5" /> {t('Déjà sur la soirée', 'Already on the event', 'Ya en el evento')}
                      </p>
                      <div className="flex flex-wrap justify-center gap-2 md:justify-start">
                        {inv.parties.map((p) => (
                          <span key={`${p.kind}:${p.name}`} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 12.5 }}>
                            <PartyAvatar name={p.name} kind={p.kind} size={22} />{p.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-none flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ borderTop: `1px solid ${BORDER}`, background: 'var(--sf-0a0a0c)' }}>
              <OrgButton size="sm" variant="ghost" onClick={onClose}>{t('Plus tard', 'Later', 'Más tarde')}</OrgButton>
              <div className="flex gap-2">
                <OrgButton size="sm" variant="secondary" disabled={busy} onClick={onDecline}>
                  <X className="h-3.5 w-3.5" /> {t('Décliner', 'Decline', 'Rechazar')}
                </OrgButton>
                <OrgButton size="sm" variant="primary" disabled={busy} onClick={onAccept}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {t('Accepter l’invitation', 'Accept invitation', 'Aceptar invitación')}
                </OrgButton>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
