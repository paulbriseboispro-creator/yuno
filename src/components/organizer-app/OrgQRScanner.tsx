import { useRef, useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Camera, CameraOff, Keyboard } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgButton, DarkInput, RED_SOFT, T3, BORDER } from '@/components/org-ui';

interface Props {
  onScan: (text: string) => void | Promise<void>;
}

/**
 * QR scanner used inside the organizer app. Shares the exact same library
 * (@yudiel/react-qr-scanner) as the bouncer / barman / cloakroom scanners
 * so we keep one battle-tested camera pipeline across the platform.
 */
export default function OrgQRScanner({ onScan }: Props) {
  const { language } = useLanguage();
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const lastCodeRef = useRef<string | null>(null);
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const submitManual = async () => {
    const code = manualCode.trim();
    if (!code || submitting) return;
    setSubmitting(true);
    try {
      await onScan(code);
      setManualCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleScan = async (result: unknown) => {
    let code: string | undefined;

    if (typeof result === 'string') {
      code = result;
    } else if (Array.isArray(result) && result[0]) {
      code = (result[0] as any).rawValue ?? String(result[0]);
    } else if (typeof (result as any)?.rawValue === 'string') {
      code = (result as any).rawValue;
    }

    code = code?.trim();
    if (!code) return;
    if (code === lastCodeRef.current) return;

    lastCodeRef.current = code;
    setActive(false);
    await onScan(code);
    setTimeout(() => {
      lastCodeRef.current = null;
    }, 2500);
  };

  return (
    <div className="space-y-3">
      <div
        className="mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl"
        style={{ background: '#000', border: `1px solid ${BORDER}` }}
      >
        {active ? (
          <Scanner
            onScan={handleScan}
            onError={(err: any) => {
              setError(err?.message ?? t('Caméra inaccessible', 'Camera unavailable'));
            }}
            constraints={{ facingMode: 'environment' }}
            formats={['qr_code']}
            scanDelay={50}
            styles={{
              container: { width: '100%', height: '100%' },
              video: { width: '100%', height: '100%', objectFit: 'cover' },
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ color: T3, fontSize: 13 }}>
            {t('Scanner désactivé', 'Scanner off')}
          </div>
        )}
      </div>
      {error && (
        <p className="text-center" style={{ color: RED_SOFT, fontSize: 13 }}>
          {error} · {t('Utilisez la saisie manuelle ci-dessous.', 'Use manual entry below.')}
        </p>
      )}
      {!active ? (
        <OrgButton variant="primary" onClick={() => { setError(null); setActive(true); }} className="w-full !py-3">
          <Camera className="h-4 w-4" />
          {t('Activer le scanner', 'Start scanner')}
        </OrgButton>
      ) : (
        <OrgButton variant="secondary" onClick={() => setActive(false)} className="w-full !py-3">
          <CameraOff className="h-4 w-4" />
          {t('Arrêter', 'Stop')}
        </OrgButton>
      )}

      {/* Manual fallback — keeps the door moving when the camera fails or a code won't scan. */}
      {!manualOpen ? (
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="mx-auto flex items-center gap-1.5"
          style={{ color: T3, fontSize: 12.5 }}
        >
          <Keyboard className="h-3.5 w-3.5" />
          {t('Saisir le code manuellement', 'Enter code manually')}
        </button>
      ) : (
        <div className="space-y-2">
          <DarkInput
            value={manualCode}
            onChange={setManualCode}
            placeholder={t('Code du billet', 'Ticket code')}
            disabled={submitting}
          />
          <div className="flex gap-2">
            <OrgButton variant="secondary" onClick={() => { setManualOpen(false); setManualCode(''); }} className="flex-1">
              {t('Fermer', 'Close')}
            </OrgButton>
            <OrgButton variant="primary" onClick={submitManual} disabled={!manualCode.trim() || submitting} className="flex-1">
              {submitting ? t('Validation…', 'Checking…') : t('Valider', 'Validate')}
            </OrgButton>
          </div>
        </div>
      )}
    </div>
  );
}
