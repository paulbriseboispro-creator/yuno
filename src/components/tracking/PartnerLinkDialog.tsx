/**
 * PartnerLinkDialog — créer ou modifier un lien partenaire (un promoteur, un
 * DJ, une amie qui fait vendre…) pour UNE soirée, sans compte.
 *
 * Le lien est une ligne `tracked_links` ordinaire qui porte `partner_*` ; le
 * serveur pose le jeton de la page de stats (trigger
 * tracked_links_partner_normalize). Après la création, le dialogue montre les
 * deux liens à transmettre et le bouton d'envoi.
 */
import { useEffect, useState } from 'react';
import { Check, Copy, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  PARTNER_ROLES, PARTNER_NAME_MAX, type PartnerRole, cleanPartnerName, contactKindOf,
  isReservedPartnerName, isValidPartnerCode, isValidPartnerContact, buildPartnerShare,
  sanitizePartnerCodeInput, slugifyPart, suggestPartnerCode,
} from '@/lib/partnerLinks';

export interface PartnerLinkRow {
  id: string;
  code: string;
  partner_name: string;
  partner_role: PartnerRole;
  partner_contact: string | null;
  partner_token: string;
  partner_shows_revenue: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = création */
  editing: PartnerLinkRow | null;
  ownerKind: 'venue' | 'organizer';
  venueId?: string | null;
  organizerUserId?: string | null;
  eventId: string;
  eventTitle?: string | null;
  /** L'appelant voit-il l'argent ? null = inconnu (le serveur tranche). */
  canSeeMoney: boolean | null;
  onSaved: () => void;
}

function randomSuffix(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function PartnerLinkDialog({
  open, onOpenChange, editing, ownerKind, venueId, organizerUserId, eventId, eventTitle,
  canSeeMoney, onSaved,
}: Props) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [role, setRole] = useState<PartnerRole>('promoter');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [contactMode, setContactMode] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [showsRevenue, setShowsRevenue] = useState(true);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<PartnerLinkRow | null>(null);
  const [copied, setCopied] = useState<'link' | 'page' | null>(null);
  const [suffix, setSuffix] = useState(randomSuffix);

  useEffect(() => {
    if (!open) return;
    setSuffix(randomSuffix());
    setCreated(null);
    setCopied(null);
    setSaving(false);
    if (editing) {
      setName(editing.partner_name);
      setRole(editing.partner_role);
      setCode(editing.code);
      setCodeTouched(true);
      const kind = contactKindOf(editing.partner_contact);
      setContactMode(kind === 'email' ? 'email' : 'phone');
      setPhone(kind === 'phone' ? editing.partner_contact ?? '' : '');
      setEmail(kind === 'email' ? editing.partner_contact ?? '' : '');
      setShowsRevenue(editing.partner_shows_revenue);
    } else {
      setName('');
      setRole('promoter');
      setCode('');
      setCodeTouched(false);
      setContactMode('phone');
      setPhone('');
      setEmail('');
      setShowsRevenue(true);
    }
  }, [open, editing]);

  // Le code suit le nom tant que le pro ne l'a pas réécrit.
  useEffect(() => {
    if (editing || codeTouched) return;
    setCode(name.trim() ? suggestPartnerCode(name, eventTitle ?? '', suffix) : '');
  }, [name, eventTitle, suffix, codeTouched, editing]);

  const contact = contactMode === 'phone' ? phone : email.trim();
  const cleanName = cleanPartnerName(name);

  const copy = async (value: string, which: 'link' | 'page') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      toast.success(t('tlink.copied'));
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
    } catch {
      toast.error(t('tlink.copyError'));
    }
  };

  const save = async () => {
    if (!cleanName) { toast.error(t('plink.nameRequired')); return; }
    if (isReservedPartnerName(cleanName)) { toast.error(t('plink.nameReserved')); return; }
    if (!editing && !isValidPartnerCode(code)) { toast.error(t('plink.codeInvalid')); return; }
    if (!isValidPartnerContact(contact)) { toast.error(t('plink.contactInvalid')); return; }
    setSaving(true);

    const fields = {
      partner_name: cleanName,
      partner_role: role,
      partner_contact: contact || null,
      ...(canSeeMoney === false ? {} : { partner_shows_revenue: showsRevenue }),
    };

    if (editing) {
      const { error } = await supabase.from('tracked_links').update(fields).eq('id', editing.id);
      setSaving(false);
      if (error) { toast.error(t('tlink.saveError')); return; }
      toast.success(t('tlink.saved'));
      onSaved();
      onOpenChange(false);
      return;
    }

    const { data, error } = await supabase
      .from('tracked_links')
      .insert({
        code,
        label: cleanName,
        owner_kind: ownerKind,
        venue_id: ownerKind === 'venue' ? venueId ?? null : null,
        organizer_user_id: ownerKind === 'organizer' ? organizerUserId ?? null : null,
        target_kind: 'event',
        event_id: eventId,
        utm_source: slugifyPart(cleanName) || 'partner',
        utm_medium: 'partner_link',
        ...fields,
      })
      .select('id, code, partner_name, partner_role, partner_contact, partner_token, partner_shows_revenue')
      .single();
    setSaving(false);
    if (error || !data) {
      if (error?.code === '23505') toast.error(t('plink.codeTaken'));
      else if (error?.message?.includes('partner_name_reserved')) toast.error(t('plink.nameReserved'));
      else toast.error(t('tlink.saveError'));
      return;
    }
    setCreated(data as PartnerLinkRow);
    onSaved();
  };

  const createdShare = created ? buildPartnerShare(created, t, eventTitle) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-neutral-950 border-white/10 text-white sm:max-w-[520px] [&>*]:min-w-0">
        {created && createdShare ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('plink.createdTitle').replace('{name}', created.partner_name)}</DialogTitle>
              <DialogDescription className="text-white/55">{t('plink.createdDesc')}</DialogDescription>
            </DialogHeader>
            <div className="min-w-0 space-y-3 py-1">
              {([['link', t('plink.saleLink'), createdShare.link], ['page', t('plink.statsPage'), createdShare.page]] as const).map(([key, label, url]) => (
                <div key={key} className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
                  <div className="text-xs font-medium text-white/55">{label}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-sm text-white/90">{url.replace(/^https?:\/\//, '')}</code>
                    <button
                      type="button"
                      onClick={() => copy(url, key)}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-medium text-white/80 hover:bg-white/10"
                    >
                      {copied === key ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {t('plink.copy')}
                    </button>
                  </div>
                </div>
              ))}
              <p className="text-xs leading-relaxed text-white/50">{t('plink.pagePrivate')}</p>
            </div>
            <DialogFooter className="flex-wrap gap-2 sm:gap-2">
              {createdShare.href ? (
                <a
                  href={createdShare.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-paper hover:bg-white/90"
                >
                  <Send className="h-4 w-4" />
                  {contactKindOf(created.partner_contact) === 'email' ? t('plink.sendEmail') : t('plink.sendWhatsapp')}
                </a>
              ) : (
                <Button onClick={() => copy(createdShare.message, 'link')} className="bg-white text-paper hover:bg-white/90">
                  <Copy className="mr-1.5 h-4 w-4" />{t('plink.copyMessage')}
                </Button>
              )}
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-white/60 hover:text-white">
                {t('plink.done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{editing ? t('plink.editTitle') : t('plink.createTitle')}</DialogTitle>
              {!editing && <DialogDescription className="text-white/55">{t('plink.intro')}</DialogDescription>}
            </DialogHeader>
            <div className="min-w-0 space-y-4 py-1">
              <div className="space-y-1.5">
                <label htmlFor="plink-name" className="text-[13px] font-medium text-white/85">{t('plink.name')}</label>
                <Input
                  id="plink-name"
                  autoFocus
                  value={name}
                  maxLength={PARTNER_NAME_MAX}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('plink.namePlaceholder')}
                  className="bg-white/5 border-white/15 text-white"
                />
              </div>

              <div className="space-y-2">
                <span className="text-[13px] font-medium text-white/85">{t('plink.role')}</span>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('plink.role')}>
                  {PARTNER_ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={role === r}
                      onClick={() => setRole(r)}
                      className={`h-8 rounded-full px-3.5 text-xs font-medium transition-colors ${
                        role === r
                          ? 'bg-white text-paper'
                          : 'border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {t(`plink.role.${r}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="plink-code" className="text-[13px] font-medium text-white/85">{t('plink.link')}</label>
                <div className={`flex h-10 items-center overflow-hidden rounded-md border border-white/15 bg-white/5 ${editing ? 'opacity-60' : ''}`}>
                  <span className="whitespace-nowrap pl-3 pr-0.5 text-sm text-white/45">yunoapp.eu/l/</span>
                  <input
                    id="plink-code"
                    value={code}
                    disabled={!!editing}
                    onChange={(e) => { setCodeTouched(true); setCode(sanitizePartnerCodeInput(e.target.value)); }}
                    className="h-full min-w-0 flex-1 bg-transparent pr-3 text-sm font-medium text-white outline-none"
                  />
                </div>
                {editing && <p className="text-xs text-white/45">{t('plink.codeLocked')}</p>}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium text-white/85">
                    {t('plink.contact')} <span className="font-normal text-white/45">{t('plink.optional')}</span>
                  </span>
                  <div className="flex rounded-lg bg-white/5 p-0.5" role="radiogroup" aria-label={t('plink.contact')}>
                    {(['phone', 'email'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={contactMode === m}
                        onClick={() => setContactMode(m)}
                        className={`h-7 rounded-md px-2.5 text-xs font-medium ${contactMode === m ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'}`}
                      >
                        {m === 'phone' ? 'WhatsApp' : 'Email'}
                      </button>
                    ))}
                  </div>
                </div>
                {contactMode === 'phone' ? (
                  <PhoneInputWithCountry value={phone} onChange={setPhone} size="sm" />
                ) : (
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="prenom@email.com"
                    className="bg-white/5 border-white/15 text-white"
                  />
                )}
                <p className="text-xs text-white/45">{t('plink.contactHint')}</p>
              </div>

              {canSeeMoney !== false && (
                <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-white/[0.04] px-3.5 py-3">
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium text-white/90">{t('plink.showRevenue')}</span>
                    <span className="block text-xs text-white/50">{t('plink.showRevenueHint')}</span>
                  </span>
                  <Switch checked={showsRevenue} onCheckedChange={setShowsRevenue} aria-label={t('plink.showRevenue')} />
                </label>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-white/60 hover:text-white">
                {t('tlink.cancel')}
              </Button>
              <Button onClick={save} disabled={saving} className="bg-white text-paper hover:bg-white/90">
                {saving
                  ? t('tlink.saving')
                  : editing
                    ? t('tlink.save')
                    : cleanName ? t('plink.createFor').replace('{name}', cleanName.split(' ')[0]) : t('plink.create')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
