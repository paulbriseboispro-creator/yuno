/**
 * Clients · Imports (« Imports » du design) : l'accueil (synchro Shotgun,
 * fichier, zéro doublon, derniers ajouts) et l'assistant d'import.
 * `?wizard=1` ouvre l'assistant, `?sample=1` le lance sur le fichier d'exemple.
 */
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIntro } from '@/crm/ui/motion';
import { useImportsOverview } from '@/crm/data/imports';
import { useClientsList } from '@/crm/data/clients';
import { ImportsHome } from './ImportsHome';
import { ImportWizard } from './ImportWizard';

const FIRST_CLIENT = { seg: 'all' as const, f: { rc: ['mail' as const] } };

export default function ImportsPage() {
  const [sp, setSp] = useSearchParams();
  const ov = useImportsOverview();
  const intro = useIntro(!!ov.data);
  const wizard = sp.get('wizard') === '1';
  const sample = sp.get('sample') === '1';
  const [file, setFile] = useState<File | null>(null);
  const [run, setRun] = useState(0);
  const pickRef = useRef<HTMLInputElement>(null);
  // Une vraie adresse de la base pour le testeur (« Déjà dans votre base »).
  const one = useClientsList(FIRST_CLIENT, 'last', 1, 1);
  const sampleEmail = one.data?.rows[0]?.email ?? null;

  const openWizard = (f: File | null, withSample = false) => {
    setFile(f);
    setRun((r) => r + 1);
    setSp((prev) => {
      const q = new URLSearchParams(prev);
      q.set('wizard', '1');
      if (withSample) q.set('sample', '1'); else q.delete('sample');
      return q;
    });
  };
  const leave = () => {
    setFile(null);
    setSp((prev) => { const q = new URLSearchParams(prev); q.delete('wizard'); q.delete('sample'); return q; });
  };

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 96px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <input
        ref={pickRef}
        type="file"
        accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) openWizard(f); }}
      />
      {wizard ? (
        <ImportWizard key={run} initialFile={file} startSample={sample && !file} onLeave={leave} />
      ) : (
        <ImportsHome
          data={ov.data}
          intro={intro}
          onFile={(f) => openWizard(f)}
          onOpenWizard={() => { if (pickRef.current) { pickRef.current.value = ''; pickRef.current.click(); } }}
          sampleEmail={sampleEmail}
        />
      )}
    </main>
  );
}
