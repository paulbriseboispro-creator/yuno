/**
 * CreditNotePage — /avoir/:token
 *
 * L'avoir d'un remboursement (D15), ouvert depuis le lien de l'e-mail de remboursement, sans compte : le jeton de l'URL
 * (32 hex aléatoires) est la clé (RPC get_credit_note_by_token, migration 20261227110000). DA publique : fond noir,
 * métadonnées en mono. Le PDF est dessiné par le même module que les autres documents (drawCreditNote).
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Wordmark } from '@/components/brand/Wordmark';
import { Seo } from '@/components/Seo';
import { deliverCreditNote } from '@/lib/generateCreditNotePDF';
import type { CreditNoteDoc } from '@/lib/creditNote';
import type { DocLang } from '@/lib/generateDocuments';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const GROTESK = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
const mono = (size = 10, color = '#9A9A9A'): React.CSSProperties => ({
  fontFamily: MONO, fontSize: size, letterSpacing: '0.14em', textTransform: 'uppercase', color,
});

export default function CreditNotePage() {
  const { token } = useParams<{ token: string }>();
  const { t, language } = useLanguage();
  const [doc, setDoc] = useState<CreditNoteDoc | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    if (!token || !/^[0-9a-f]{32}$/.test(token)) { setDoc(null); return; }
    supabase.rpc('get_credit_note_by_token', { p_token: token }).then(({ data, error }) => {
      if (live) setDoc(error ? null : ((data as unknown as CreditNoteDoc | null) ?? null));
    });
    return () => { live = false; };
  }, [token]);

  const download = useCallback(async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const outcome = await deliverCreditNote(doc, language as DocLang);
      if (outcome === 'failed') toast.error(t('credit.downloadError'));
    } catch {
      toast.error(t('credit.downloadError'));
    } finally {
      setBusy(false);
    }
  }, [doc, language, t]);

  const loc = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const money = new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR' });
  const page: React.CSSProperties = { minHeight: '100dvh', background: '#0A0A0A', color: '#FFFFFF', fontFamily: 'Inter, sans-serif' };
  const column: React.CSSProperties = {
    maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24,
    padding: 'calc(env(safe-area-inset-top, 0px) + 20px) 16px calc(env(safe-area-inset-bottom, 0px) + 40px)',
  };

  return (
    <div style={page} lang={language}>
      <Seo title="Yuno" noindex />
      <div style={column}>
        <Wordmark height={20} tone="white" alt="Yuno" />
        {doc === undefined && <div className="animate-pulse" style={{ height: 180, background: '#141414', borderRadius: 4 }} />}
        {doc === null && (
          <div>
            <h1 style={{ fontFamily: GROTESK, fontSize: 28, textTransform: 'uppercase', margin: 0 }}>{t('credit.notFoundTitle')}</h1>
            <p style={{ color: '#9A9A9A', marginTop: 12 }}>{t('credit.notFoundBody')}</p>
          </div>
        )}
        {doc && (
          <>
            <div>
              <div style={mono(10)}>{t('credit.title')}</div>
              <h1 style={{ fontFamily: GROTESK, fontSize: 32, textTransform: 'uppercase', margin: '8px 0 0', lineHeight: 1.05 }}>
                {money.format(-Number(doc.amount))}
              </h1>
              {doc.event_name && <p style={{ color: '#D0D0D0', marginTop: 10 }}>{doc.event_name}</p>}
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 16px', margin: 0 }}>
              <dt style={mono(10)}>{t('credit.number')}</dt><dd style={{ margin: 0, fontFamily: MONO, fontSize: 13 }}>{doc.credit_number}</dd>
              <dt style={mono(10)}>{t('credit.date')}</dt><dd style={{ margin: 0 }}>{new Date(doc.created_at).toLocaleDateString(loc, { timeZone: 'Europe/Paris' })}</dd>
              <dt style={mono(10)}>{t('credit.invoice')}</dt><dd style={{ margin: 0, fontFamily: MONO, fontSize: 13 }}>{doc.invoice_number}</dd>
              {doc.seller?.name && (<><dt style={mono(10)}>{t('credit.issuer')}</dt><dd style={{ margin: 0 }}>{doc.seller.name}</dd></>)}
              {doc.reason && (<><dt style={mono(10)}>{t('credit.reason')}</dt><dd style={{ margin: 0 }}>{doc.reason}</dd></>)}
            </dl>
            <button className="btn btn--primary w-full" onClick={download} disabled={busy}>
              {busy
                ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                : <FileText className="h-4 w-4 mr-2" />}
              {t('credit.downloadPdf')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
