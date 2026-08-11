import { useRef, useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Camera, CameraOff, Keyboard } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgButton, DarkInput, T3, BORDER } from '@/components/org-ui';
import { classifyCameraError } from '@/lib/cameraPermission';
import { CameraPermissionNotice } from '@/components/pro/CameraPermissionNotice';

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
  const [cameraIssue, setCameraIssue] = useState<'denied' | 'unavailable' | null>(null);
  const [scannerKey, setScannerKey] = useState(0);
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
        className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl"
        style={{ background: '#000', border: `1px solid ${BORDER}` }}
      >
        {active ? (
          <Scanner
            key={scannerKey}
            onScan={handleScan}
            onError={(err: unknown) => {
              setCameraIssue(classifyCameraError(err) === 'denied' ? 'denied' : 'unavailable');
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
        {active && cameraIssue && (
          <CameraPermissionNotice
            className="absolute inset-0"
            denied={cameraIssue === 'denied'}
            onRetry={() => { setCameraIssue(null); setScannerKey((k) => k + 1); }}
            title={cameraIssue === 'denied'
              ? t('Caméra désactivée', 'Camera turned off', 'Cámara desactivada')
              : t('Caméra indisponible', 'Camera unavailable', 'Cámara no disponible')}
            body={cameraIssue === 'denied'
              ? t('L\'accès à la caméra est nécessaire pour scanner les billets.', 'Camera access is required to scan tickets.', 'Se necesita acceso a la cámara para escanear entradas.')
              : t('Aucune caméra détectée, ou elle est utilisée par une autre app.', 'No camera detected, or it\'s in use by another app.', 'No se detecta ninguna cámara o está en uso por otra app.')}
            openSettingsLabel={t('Ouvrir les Réglages', 'Open Settings', 'Abrir Ajustes')}
            retryLabel={t('Réessayer', 'Try again', 'Reintentar')}
            webHint={t('Autorisez la caméra dans les réglages de votre navigateur, puis réessayez.', 'Allow camera access in your browser settings, then try again.', 'Permite el acceso a la cámara en los ajustes del navegador y vuelve a intentarlo.')}
          />
        )}
      </div>
      {!active ? (
        <OrgButton variant="primary" onClick={() => { setCameraIssue(null); setActive(true); }} className="w-full !py-3">
          <Camera className="h-4 w-4" />
          {t('Activer le scanner', 'Start scanner')}
        </OrgButton>
      ) : (
        <OrgButton variant="secondary" onClick={() => { setActive(false); setCameraIssue(null); }} className="w-full !py-3">
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
