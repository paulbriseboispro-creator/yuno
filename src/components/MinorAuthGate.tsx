import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Check, Upload, Loader2, FileCheck2, FileText, AlertTriangle, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

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
}

// Age in full years from a YYYY-MM-DD string, or null if unparseable.
function ageFromDate(dateStr: string): number | null {
  const birth = new Date(dateStr);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export function MinorAuthGate({ userId, eventId, acceptsMinors, template, onReady, onDocUploaded, onMinorInfo }: MinorAuthGateProps) {
  const { t } = useLanguage();
  const [birthDate, setBirthDate] = useState('');
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const age = birthDate ? ageFromDate(birthDate) : null;
  const isAdult = age !== null && age >= 18;
  const isMinor = age !== null && age < 18;

  // Branches of the decision tree.
  const minorRejected = isMinor && !acceptsMinors;                 // minors not allowed → must be adult
  const minorNeedsDoc = isMinor && acceptsMinors && !!template;    // minor + venue requires a signed doc
  const minorNoDoc = isMinor && acceptsMinors && !template;        // minor ticket, no doc required

  // Reuse a birth date already on the profile — never ask twice for the same person.
  useEffect(() => {
    if (!userId) return;
    supabase
      .from('profiles')
      .select('birth_date')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.birth_date) setBirthDate(data.birth_date);
      });
  }, [userId]);

  // Drive the readiness gate + the attached document from the decision tree.
  useEffect(() => {
    // No valid date yet → can't classify → block.
    if (age === null) { onReady(false); onDocUploaded(null); onMinorInfo?.(null); return; }
    // Adult → normal ticket.
    if (isAdult) { onReady(true); onDocUploaded(null); onMinorInfo?.({ isMinor: false, birthDate, docUrl: null, docName: null }); return; }
    // Minor on an event that forbids minors → hard block.
    if (minorRejected) { onReady(false); onDocUploaded(null); onMinorInfo?.({ isMinor: true, birthDate, docUrl: null, docName: null }); return; }
    // Minor allowed, no document required → minor ticket OK.
    if (minorNoDoc) { onReady(true); onDocUploaded(null); onMinorInfo?.({ isMinor: true, birthDate, docUrl: null, docName: null }); return; }
    // Minor allowed, document required → only proceed once the signed doc is uploaded.
    onReady(!!uploadedUrl);
    onDocUploaded(uploadedUrl);
    onMinorInfo?.({ isMinor: true, birthDate, docUrl: uploadedUrl, docName: uploadedName });
  }, [birthDate, uploadedUrl, acceptsMinors, template]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist a valid birth date for logged-in users so we remember it next time.
  useEffect(() => {
    if (!userId || age === null) return;
    supabase.from('profiles').update({ birth_date: birthDate }).eq('id', userId).then(() => {});
  }, [birthDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
      const path = `${eventId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('minor-auth-uploads')
        .upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
      if (error) throw error;
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

  return (
    <div className="space-y-3 p-4 rounded-[10px] border border-white/[0.08] bg-[#141414]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-white">{t('minorAuth.title')}</span>
        </div>
        <span
          className="font-mono uppercase text-[9px] font-bold tracking-[0.12em] text-primary px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(232,25,44,0.10)' }}
        >
          {t('consent.required')}
        </span>
      </div>

      {/* Date of birth — the single input that drives everything. */}
      <div className="space-y-1.5">
        <Label className="font-mono uppercase text-[10px] tracking-[0.10em] text-[#5A5A5E]">{t('minorAuth.birthDate')}</Label>
        <Input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          max={new Date().toISOString().split('T')[0]}
          className="h-11 rounded-lg bg-[#1F1F22] border-white/[0.08] text-white focus-visible:ring-0 focus-visible:border-primary/50"
        />
      </div>

      {/* Adult → normal ticket. */}
      {isAdult && (
        <div className="flex items-center gap-2 text-[11px] text-emerald-400">
          <Check className="h-3.5 w-3.5 shrink-0" />
          <span>{t('minorAuth.adultOk')}</span>
        </div>
      )}

      {/* Minor on an event that forbids minors → invalid, must be of legal age. */}
      {minorRejected && (
        <div className="flex items-start gap-2 text-[11px] text-primary">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{t('minorAuth.mustBeAdult')}</span>
        </div>
      )}

      {/* Minor allowed, no document required → minor ticket OK. */}
      {minorNoDoc && (
        <div className="flex items-center gap-2 text-[11px] text-emerald-400">
          <Check className="h-3.5 w-3.5 shrink-0" />
          <span>{t('minorAuth.minorTicketOk')}</span>
        </div>
      )}

      {/* Minor allowed, document required → download the attached form, sign it, upload it back. */}
      {minorNeedsDoc && template && (
        <div className="space-y-3 pt-1">
          <p className="text-xs text-primary leading-relaxed">{t('minorAuth.minorNotice')}</p>

          {/* 1. The blank document the venue/organizer attached (PDF or TXT). */}
          <a
            href={template.url}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="flex items-center gap-2.5 rounded-lg border border-white/[0.08] bg-[#1F1F22] px-3 py-2.5 transition-colors hover:border-primary/40"
          >
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm text-white truncate flex-1">{template.name || t('minorAuth.downloadFallback')}</span>
            <Download className="h-4 w-4 text-[#9A9A9A] shrink-0" />
          </a>

          {/* 2. Upload the filled & signed copy (PDF or TXT). */}
          {uploadedUrl ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] px-3 py-2.5">
              <FileCheck2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="text-sm text-white truncate flex-1">{uploadedName}</span>
              <label className="font-mono uppercase text-[9px] tracking-[0.12em] text-[#9A9A9A] cursor-pointer hover:text-white">
                {t('minorAuth.replace')}
                <input type="file" accept="application/pdf,.pdf,text/plain,.txt" className="hidden" disabled={uploading} onChange={handleUpload} />
              </label>
            </div>
          ) : (
            <label
              className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-primary/50 bg-primary/[0.05] px-3 py-3 cursor-pointer transition-colors hover:bg-primary/[0.10]"
              style={{ color: uploading ? '#5A5A5E' : '#FFFFFF' }}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm font-medium">{t('minorAuth.uploading')}</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{t('minorAuth.uploadLabel')}</span>
                </>
              )}
              <input type="file" accept="application/pdf,.pdf,text/plain,.txt" className="hidden" disabled={uploading} onChange={handleUpload} />
            </label>
          )}

          {!uploadedUrl && (
            <div className="flex items-center gap-1.5 text-[11px] text-[#9A9A9A]">
              <AlertTriangle className="h-3 w-3 text-primary shrink-0" />
              <span>{t('minorAuth.uploadHint')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
