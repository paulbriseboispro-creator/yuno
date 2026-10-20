import { useState, useEffect, type Ref } from 'react';
import { Upload, Loader2, FileCheck2, FileText, AlertTriangle, Download, Wine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { ageOn, readBirthDate, splitIsoBirthDate, type BirthDateField, type BirthDateParts, type BirthDateState } from '@/lib/birthDate';
import { BirthDateFields } from '@/components/checkout/BirthDateFields';
import { FieldError, FieldHint } from '@/components/checkout/checkoutFieldUi';
import { CHECKOUT_ERROR } from '@/components/checkout/checkoutFieldStyle';

interface MinorAuthGateProps {
  userId?: string | null;
  eventId: string;
  /** Whether the venue/organizer accepts minors on this event (alcohol-free). */
  acceptsMinors: boolean;
  /** The blank authorization template the venue/organizer attached in their settings, if any. */
  template: { url: string; name: string } | null;
  /** Reports whether the purchase may proceed. */
  onReady: (ready: boolean) => void;
  /** The buyer's uploaded, filled-in document URL (null until uploaded / not needed). */
  onDocUploaded: (url: string | null) => void;
  /** Full minor classification, so the checkout can record a minor-ticket row.
   *  null until a valid date of birth is entered. */
  onMinorInfo?: (info: { isMinor: boolean; birthDate: string; docUrl: string | null; docName: string | null } | null) => void;
  /** True only while a minor on a minors-allowed event still owes their signed
   *  authorization upload. */
  onDocPending?: (pending: boolean) => void;
  /** Ce que la personne a tapé, lu par le formulaire de la page ; null = date
   *  déjà connue par le profil, rien à demander. */
  onBirthState?: (state: BirthDateState | null) => void;
  /** Message de saisie posé par la page (au tap, ou en quittant les cases). */
  error?: string | null;
  invalidField?: BirthDateField | 'all' | null;
  onBlur?: () => void;
  /** Le document signé manque alors que la personne a tapé « payer » : la zone d'envoi passe au rouge. */
  highlightDoc?: boolean;
  /** Ancre : la page y descend quand la date est le premier oubli. */
  anchorRef?: Ref<HTMLFieldSetElement>;
  /** Ligne sous la date (défaut : celle du billet, selon que la soirée accepte les mineurs). */
  hint?: string;
}

// Single age gate of the ticket checkout. A birth date is required to buy; once
// entered by a logged-in buyer it is saved on the profile and never asked again.
//   no date                                 → blocked (date of birth required)
//   adult                                   → normal ticket, nothing more shown
//   minor + event forbids minors            → blocked ("must be of legal age")
//   minor + event allows minors + needs doc → download + upload the signed form
//   minor + event allows minors + no doc    → minor ticket OK
export function MinorAuthGate({
  userId, eventId, acceptsMinors, template, onReady, onDocUploaded, onMinorInfo, onDocPending,
  onBirthState, error, invalidField, onBlur, highlightDoc, anchorRef, hint,
}: MinorAuthGateProps) {
  const { t } = useLanguage();
  const [parts, setParts] = useState<BirthDateParts>({ day: '', month: '', year: '' });
  // True once we've loaded a birth date already saved on the user's profile.
  // We then never ask again — the field stays hidden on every future event.
  const [prefilled, setPrefilled] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const birthState = readBirthDate(parts);
  const birthDate = birthState.status === 'valid' ? birthState.iso : '';
  const age = birthDate ? ageOn(birthDate) : null;
  const isAdult = age !== null && age >= 18;
  const isMinor = age !== null && age < 18;

  // Branches of the decision tree (only reached once a valid date is known).
  const minorRejected = isMinor && !acceptsMinors;
  const minorNeedsDoc = isMinor && acceptsMinors && !!template;
  const minorNoDoc = isMinor && acceptsMinors && !template;
  const docRequired = minorNeedsDoc && !uploadedUrl;

  // Reuse a birth date already on the profile — never ask twice for the same person.
  useEffect(() => {
    if (!userId) return;
    supabase
      .from('profiles')
      .select('birth_date')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.birth_date) {
          setParts(splitIsoBirthDate(data.birth_date));
          setPrefilled(true);
        }
      });
  }, [userId]);

  // La page lit la saisie pour son contrôle au tap ; une date du profil n'en a
  // pas. Clé texte : l'objet est recréé à chaque rendu, la lecture non.
  // `onBirthState` doit être stable (un setter de useState).
  const stateKey = JSON.stringify(birthState);
  useEffect(() => {
    onBirthState?.(prefilled ? null : (JSON.parse(stateKey) as BirthDateState));
  }, [prefilled, stateKey, onBirthState]);

  // Drive the readiness gate + the attached document from the decision tree.
  useEffect(() => {
    onDocPending?.(docRequired);
    if (age === null) { onReady(false); onDocUploaded(null); onMinorInfo?.(null); return; }
    if (isAdult) { onReady(true); onDocUploaded(null); onMinorInfo?.({ isMinor: false, birthDate, docUrl: null, docName: null }); return; }
    if (minorRejected) { onReady(false); onDocUploaded(null); onMinorInfo?.({ isMinor: true, birthDate, docUrl: null, docName: null }); return; }
    if (minorNoDoc) { onReady(true); onDocUploaded(null); onMinorInfo?.({ isMinor: true, birthDate, docUrl: null, docName: null }); return; }
    onReady(!!uploadedUrl);
    onDocUploaded(uploadedUrl);
    onMinorInfo?.({ isMinor: true, birthDate, docUrl: uploadedUrl, docName: uploadedName });
  }, [birthDate, uploadedUrl, acceptsMinors, template]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist a freshly entered birth date so future events never ask again. Skip
  // when it came from the profile (already saved) or there's no logged-in user.
  useEffect(() => {
    if (!userId || prefilled || age === null) return;
    supabase.from('profiles').update({ birth_date: birthDate }).eq('id', userId).then(() => {});
  }, [birthDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
      const path = `${eventId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('minor-auth-uploads')
        .upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('minor-auth-uploads').getPublicUrl(path);
      setUploadedUrl(data.publicUrl);
      setUploadedName(file.name);
    } catch (err) {
      console.error('Minor doc upload error:', err);
      toast.error(t('minorAuth.uploadError'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Returning adult, already verified from their profile → ask nothing, show nothing.
  if (prefilled && isAdult) return null;

  const hintId = 'ck-birth-hint';
  const shownError = error && !prefilled ? error : null;

  return (
    <fieldset ref={anchorRef} className="m-0 min-w-0 scroll-mt-24 border-0 p-0">
      {!prefilled && (
        <>
          <legend
            className="p-0 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: shownError || minorRejected ? CHECKOUT_ERROR : '#9A9A9A' }}
          >
            {t('minorAuth.birthDate')}
          </legend>
          <div className="mt-[7px]">
            <BirthDateFields
              idPrefix="ck-birth"
              value={parts}
              onChange={setParts}
              onBlur={onBlur}
              invalid={shownError ? (invalidField ?? 'all') : minorRejected ? 'all' : null}
              describedBy={hintId}
            />
          </div>
        </>
      )}

      <div id={hintId} className="mt-[7px] space-y-2">
        {/* Only a date that blocks the purchase gets a message: it is invalid for
            this event. No reference to minors or documents. */}
        {minorRejected ? (
          <FieldError>{t('minorAuth.mustBeAdult')}</FieldError>
        ) : shownError ? (
          <FieldError>{shownError}</FieldError>
        ) : !prefilled ? (
          <FieldHint>{hint ?? (acceptsMinors ? t('ticketCheckout.birthHint') : t('ticketCheckout.birthHintAdults'))}</FieldHint>
        ) : null}

        {/* A minor on a minors-allowed event is the ONLY case where the event's
            alcohol-free nature is ever shown to a buyer: one quiet line. */}
        {isMinor && acceptsMinors && (
          <div className="flex items-start gap-2 text-[12px] text-sky-300/80">
            <Wine className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t('minorAuth.noAlcoholNote')}</span>
          </div>
        )}
      </div>

      {/* Minor allowed, document required → download the attached form, sign it, upload it back. */}
      {minorNeedsDoc && template && (
        <div className="mt-3 space-y-3">
          <p className="text-[13px] leading-relaxed text-[#E5E5E5]">{t('minorAuth.minorNotice')}</p>

          <a
            href={template.url}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="flex items-center gap-2.5 rounded-lg border border-white/[0.10] bg-[#1F1F22] px-3.5 py-3 transition-colors hover:border-white/30"
          >
            <FileText className="h-4 w-4 shrink-0 text-[#E5E5E5]" aria-hidden />
            <span className="flex-1 truncate text-sm text-white">{template.name || t('minorAuth.downloadFallback')}</span>
            <Download className="h-4 w-4 shrink-0 text-[#9A9A9A]" aria-hidden />
          </a>

          {uploadedUrl ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] px-3.5 py-3">
              <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
              <span className="flex-1 truncate text-sm text-white">{uploadedName}</span>
              <label className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-[#9A9A9A] hover:text-white">
                {t('minorAuth.replace')}
                <input type="file" accept="application/pdf,.pdf,text/plain,.txt" className="hidden" disabled={uploading} onChange={handleUpload} />
              </label>
            </div>
          ) : (
            <label
              className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3.5 py-3.5 transition-colors hover:bg-white/[0.04]"
              style={{ borderColor: highlightDoc ? CHECKOUT_ERROR : 'rgba(255,255,255,0.28)', color: uploading ? '#9A9A9A' : '#FFFFFF' }}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  <span className="text-sm font-medium">{t('minorAuth.uploading')}</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" aria-hidden />
                  <span className="text-sm font-medium">{t('minorAuth.uploadLabel')}</span>
                </>
              )}
              <input type="file" accept="application/pdf,.pdf,text/plain,.txt" className="hidden" disabled={uploading} onChange={handleUpload} />
            </label>
          )}

          {!uploadedUrl && (
            <div className="flex items-center gap-1.5 text-[12px] text-[#9A9A9A]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: highlightDoc ? CHECKOUT_ERROR : '#FBBF24' }} aria-hidden />
              <span>{t('minorAuth.uploadHint')}</span>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
