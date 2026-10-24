/**
 * Assistant d'import en quatre étapes : Fichier → Colonnes → Vérification →
 * Terminé. Rien n'est écrit avant « Ajouter » ; la comparaison à la base
 * passe par tix_import_check, l'écriture par tix_import_commit (lots de
 * 1 000, annulés en entier si un lot échoue).
 */
import { useEffect, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useTixToast } from '@/tickets/clients/toast';
import { EASE, SPRING, prefersReducedMotion } from '@/crm/ui/motion';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixScope } from '@/tickets/clients/scope';
import { useTixClientRoutes } from '@/tickets/clients/routes';
import { downloadText } from '@/crm/lib/csv';
import { CrmRpcError } from '@/crm/lib/rpc';
import {
  COL_FIELDS, MAX_BYTES, MAX_LINES, SAMPLE_CSV, TEMPLATE_CSV, autoMap, parseCsv, prepareLines, readContactFile, splitWithBase, toImportRow,
} from '@/crm/lib/fileImport';
import type { Analysis, ColField, ParsedFile } from '@/crm/lib/fileImport';
import { CONSENT_SOURCES, checkAgainstBase, commitImport, useInvalidateBase } from '@/tickets/clients/data/imports';
import type { ConsentSource } from '@/tickets/clients/data/imports';
import { NightPanelRules } from './ImportsHome';
import { SegmentsNextStep } from '@/tickets/clients/SegmentCatalog';
import { NIGHT_BG, useZeroRules } from './zeroRules';

type ReadErr = 'bad' | 'size';
type Bucket = 'fresh' | 'exist' | 'dup' | 'bad' | 'out';

/** Anime une valeur de 0 à 1 (ease-out) ; se coupe sans animations. */
/** Libellés des origines d'un accord : ceux de l'import de la Console (em.import.src.*). */
const SOURCE_LABEL: Record<ConsentSource, string> = {
  in_person: 'em.import.src.inPerson', website_form: 'em.import.src.websiteForm', ticketing: 'em.import.src.ticketing',
  social: 'em.import.src.social', other_tool: 'em.import.src.otherTool', other: 'em.import.src.other',
};

const fieldStyle: React.CSSProperties = {
  height: 44, padding: '0 12px', borderRadius: 12, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-card)',
  color: 'var(--ya-ink)', fontSize: 14.5, outline: 'none', width: '100%', fontFamily: 'var(--ya-font-body)',
};

function animate(dur: number, onStep: (p: number) => void): Promise<void> {
  return new Promise((resolve) => {
    if (prefersReducedMotion()) { onStep(1); resolve(); return; }
    const t0 = performance.now();
    const f = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      onStep(p);
      if (p < 1) requestAnimationFrame(f); else resolve();
    };
    requestAnimationFrame(f);
  });
}

const sizeTxt = (b: number) => (b < 1024 ? `${b} o` : b < 1024 * 1024 ? `${Math.round(b / 1024)} Ko` : `${(b / 1024 / 1024).toFixed(1)} Mo`);

export function ImportWizard({ initialFile, startSample, onLeave }: { initialFile: File | null; startSample: boolean; onLeave: () => void }) {
  const T = useTixT();
  const { t, tp, n } = T;
  const toast = useTixToast();
  const { rpc: args } = useTixScope();
  const refresh = useInvalidateBase();
  const rules = useZeroRules();
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [drag, setDrag] = useState(false);
  const [reading, setReading] = useState<{ name: string; size: string; p: number; err: ReadErr | null } | null>(null);
  const [file, setFile] = useState<{ name: string; size: string; sample: boolean } | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [map, setMap] = useState<ColField[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [consent, setConsent] = useState<'no' | 'yes'>('no');
  // L'attestation de Yuno Tickets (décision de Paul du 22/10) : d'où vient
  // l'accord, depuis quand, et l'engagement du pro. Exigée pour « oui ».
  const [source, setSource] = useState<ConsentSource | ''>('');
  const [since, setSince] = useState('');
  const [details, setDetails] = useState('');
  const [attested, setAttested] = useState(false);
  const attestOk = consent === 'no' || (!!source && attested);
  const [mode, setMode] = useState<'complete' | 'keep'>('complete');
  const [scan, setScan] = useState(0);
  const [scanErr, setScanErr] = useState(false);
  const [an, setAn] = useState<Analysis | null>(null);
  const [open, setOpen] = useState<Bucket | null>('fresh');
  const [prog, setProg] = useState(0);
  const [finished, setFinished] = useState(false);
  const [failed, setFailed] = useState<'cnx' | 'rights' | null>(null);
  const [shown, setShown] = useState<Analysis | null>(null);

  const loadText = (meta: { name: string; size: string; sample: boolean }, text: string) => {
    const r = parseCsv(text);
    if (!r.head.length || !r.rows.length) { setErr(t('ya.imp.w1.empty')); setStep(1); return; }
    applyParsed(meta, r);
  };
  const applyParsed = (meta: { name: string; size: string; sample: boolean }, r: ParsedFile) => {
    setFile(meta); setParsed(r); setMap(autoMap(r.head, r.rows)); setErr(null); setOpen('fresh'); setAn(null);
    setStep(2);
  };

  const handleFile = async (f: File | null | undefined) => {
    if (!f) return;
    const meta = { name: f.name, size: sizeTxt(f.size), sample: false };
    setErr(null);
    setReading({ name: f.name, size: meta.size, p: 0, err: null });
    if (f.size > MAX_BYTES) { setReading({ name: f.name, size: meta.size, p: 0.3, err: 'size' }); return; }
    let r: ParsedFile;
    const anim = animate(900, (p) => setReading((x) => (x && !x.err ? { ...x, p: p * 0.9 } : x)));
    try {
      r = await readContactFile(f);
    } catch {
      await anim;
      setReading({ name: f.name, size: meta.size, p: 0.55, err: 'bad' });
      return;
    }
    await anim;
    if (r.rows.length > MAX_LINES) { setReading({ name: f.name, size: meta.size, p: 0.3, err: 'size' }); return; }
    if (!r.head.length || !r.rows.length) { setReading(null); setErr(t('ya.imp.w1.empty')); return; }
    setReading((x) => (x ? { ...x, p: 1 } : x));
    setTimeout(() => { setReading(null); applyParsed(meta, r); }, 150);
  };
  const loadSample = () => {
    setReading(null);
    loadText({ name: t('ya.imp.sampleName'), size: '1 Ko', sample: true }, SAMPLE_CSV);
  };
  const pick = () => { if (inputRef.current) { inputRef.current.value = ''; inputRef.current.click(); } };

  // Fichier déposé depuis l'accueil, ou exemple demandé : une seule fois, à l'ouverture.
  const opening = useRef({ initialFile, startSample, handleFile, loadSample, done: false });
  useEffect(() => {
    const o = opening.current;
    if (o.done) return;
    o.done = true;
    if (o.initialFile) void o.handleFile(o.initialFile);
    else if (o.startSample) o.loadSample();
  }, []);

  const hasKey = map.includes('email') || map.includes('tel');
  const setCol = (i: number, v: ColField) => {
    setMap((m) => {
      const next = m.slice();
      if (v !== 'skip') next.forEach((x, j) => { if (x === v) next[j] = 'skip'; });
      next[i] = v;
      return next;
    });
  };

  const runCheck = async () => {
    if (!parsed) return;
    setStep(3); setScanErr(false); setScan(0); setAn(null); setOpen('fresh');
    const prep = prepareLines(parsed, map);
    await animate(700, (p) => setScan(p * 0.67));
    try {
      const { byEmail, byPhone } = await checkAgainstBase(args, prep.emails, prep.phones);
      const res = splitWithBase(prep, byEmail, byPhone);
      await animate(500, (p) => setScan(0.67 + p * 0.33));
      setAn(res);
    } catch {
      setScanErr(true);
    }
  };

  const toSend = an ? (mode === 'complete' ? [...an.fresh, ...an.exist] : an.fresh) : [];
  const canAdd = !!an && !file?.sample && (an.fresh.length > 0 || (mode === 'complete' && an.exist.length > 0));
  const addLabel = !an ? '' : an.fresh.length > 0 ? tp('ya.imp.w3.add', an.fresh.length, { n: n(an.fresh.length) })
    : mode === 'complete' && an.exist.length > 0 ? tp('ya.imp.w3.complete', an.exist.length, { n: n(an.exist.length) }) : t('ya.imp.w3.nothing');

  const startAdd = async () => {
    if (!an || !file || !canAdd) return;
    setStep(4); setProg(0); setFinished(false); setFailed(null); setShown(an);
    try {
      await commitImport(args, {
        rows: toSend.map(toImportRow),
        consent, mode, title: file.name,
        attestation: consent === 'yes' && source ? { source, since: since || null, details } : null,
        // Les désabonnés du fichier comptent avec les lignes non ajoutées.
        stats: { new: an.fresh.length, existing: an.exist.length, dup: an.dup.length, bad: an.bad.length + an.out.length },
        onProgress: (p) => setProg(p * 0.95),
      });
      await animate(300, (p) => setProg(0.95 + p * 0.05));
      setFinished(true);
      refresh();
    } catch (e) {
      const m = e instanceof CrmRpcError ? e.message : '';
      setFailed(/unauthorized|forbidden/i.test(m) ? 'rights' : 'cnx');
    }
  };

  const reset = () => { setStep(1); setFile(null); setParsed(null); setMap([]); setErr(null); setAn(null); setProg(0); setFinished(false); setFailed(null); setScanErr(false); };

  const dlBad = () => {
    if (!an) return;
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    downloadText('lignes-a-corriger.csv', [`${t('ya.imp.it.line', { l: '' }).trim()};${t('ya.imp.b.bad')}`, ...an.bad.map((b) => `${b.line};${esc(badText(b))}`)].join('\r\n'));
    toast(t('ya.imp.w3.badDone'));
  };
  const badText = (b: Analysis['bad'][number]) => (b.why === 'email' ? t('ya.imp.it.badEmail', { l: b.line, v: b.value })
    : b.why === 'tel' ? t('ya.imp.it.badTel', { l: b.line, v: b.value }) : t('ya.imp.it.badNone', { l: b.line }));

  const steps = [t('ya.imp.st.file'), t('ya.imp.st.cols'), t('ya.imp.st.check'), t('ya.imp.st.done')];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, animation: `ya-rise 600ms ${EASE} both` }}>
      <input ref={inputRef} type="file" accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) { setStep(1); void handleFile(f); } }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <Hv as="button" type="button" onClick={onLeave} style={{ height: 36, padding: '0 14px 0 8px', border: 0, borderRadius: 99, background: 'none', color: 'var(--ya-sand-600)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} hover={{ background: 'var(--ya-sand-100)', color: 'var(--ya-ink)' }}>
          <Icon name="chevronLeft" size={16} stroke={2.4} />{t('ya.imp.back')}
        </Hv>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px' }}>
          {steps.map((l, i) => {
            const s = i + 1;
            const cur = step === s;
            const done = step > s || (s === 4 && finished);
            return (
              <li key={l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 99, background: done ? 'var(--ya-green-500)' : cur ? 'var(--ya-ink)' : 'var(--ya-sand-100)', color: done ? '#fff' : cur ? 'var(--ya-on-ink)' : 'var(--ya-sand-500)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, transition: 'background 200ms,color 200ms' }}>
                  {done ? <Icon name="check" size={14} stroke={3} /> : s}
                </span>
                <span style={{ fontSize: 14, fontWeight: cur ? 600 : 500, color: cur ? 'var(--ya-ink)' : 'var(--ya-sand-500)' }}>{l}</span>
                {i < 3 && <span style={{ width: 24, height: 1, background: 'var(--ya-sand-300)', marginLeft: 2 }} />}
              </li>
            );
          })}
        </ol>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <section style={{ flex: '1.7 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 26, padding: 'clamp(22px,2.6vw,36px)', borderRadius: 28, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)' }}>
          {step === 1 && (
            <div key="s1" style={{ display: 'flex', flexDirection: 'column', gap: 24, animation: `ya-rise 600ms ${EASE} both` }}>
              <Head title={t('ya.imp.w1.title')} sub={t('ya.imp.w1.sub')} />
              {!reading && (
                <Hv
                  role="button"
                  tabIndex={0}
                  onClick={pick}
                  onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
                  onDragOver={(e: DragEvent) => { e.preventDefault(); if (!drag) setDrag(true); }}
                  onDragLeave={(e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
                  onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); void handleFile(e.dataTransfer?.files?.[0]); }}
                  style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '44px 24px', borderRadius: 24, border: `2px dashed ${drag ? 'var(--ya-red-400)' : 'var(--ya-sand-300)'}`, background: drag ? 'var(--ya-red-50)' : 'var(--ya-paper)', textAlign: 'center', transition: 'background 200ms,border-color 200ms', outline: 0 }}
                  hover={{ borderColor: 'var(--ya-sand-400)', background: 'var(--ya-sand-50)' }}
                >
                  <span style={{ width: 64, height: 64, borderRadius: 99, background: drag ? 'var(--ya-gradient-brand)' : 'var(--ya-ink)', color: drag ? '#fff' : 'var(--ya-on-ink)', display: 'grid', placeItems: 'center', boxShadow: 'var(--ya-shadow-sm)', animation: 'ya-float 2.4s ease-in-out infinite' }}><Icon name="upload" size={26} stroke={2.2} /></span>
                  <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t(drag ? 'ya.imp.w1.dragOn' : 'ya.imp.w1.drag')}</span>
                  <span style={{ fontSize: 14.5, color: 'var(--ya-sand-600)' }}>{t('ya.imp.w1.or')}<span style={{ fontWeight: 600, color: 'var(--ya-red-600)', textDecoration: 'underline', textUnderlineOffset: 3 }}>{t('ya.imp.w1.browse')}</span>{t('ya.imp.w1.formats')}</span>
                </Hv>
              )}
              {reading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 24, borderRadius: 24, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)', animation: `ya-pop 240ms ${EASE} both` }}>
                  <FileChip name={reading.name} meta={reading.size} />
                  <Progress p={reading.p} bad={!!reading.err} label={t(reading.err ? 'ya.imp.w1.readStop' : 'ya.imp.w1.reading')} />
                  {reading.err && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, animation: `ya-pop 260ms ${EASE} both` }}>
                      <Alert bold={reading.err === 'bad' ? t('ya.imp.e.bad.b', { name: reading.name }) : t('ya.imp.e.size.b')} text={t(reading.err === 'bad' ? 'ya.imp.e.bad.t' : 'ya.imp.e.size.t')} />
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px' }}>
                        <InkBtn onClick={() => { setReading(null); setTimeout(pick, 30); }}>{t('ya.imp.e.otherFile')}</InkBtn>
                        <TextBtn onClick={loadSample}>{t('ya.imp.w1.useSample')}</TextBtn>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {err && <Alert text={err} round />}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px', paddingTop: 20, borderTop: '1px solid var(--ya-sand-100)' }}>
                <Hv as="button" type="button" onClick={loadSample} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-card)', fontSize: 14.5, fontWeight: 600, color: 'var(--ya-ink)', cursor: 'pointer', boxShadow: 'var(--ya-shadow-xs)' }} hover={{ borderColor: 'var(--ya-sand-300)', background: 'var(--ya-paper)' }}>{t('ya.imp.w1.sample')}</Hv>
                <TextBtn onClick={() => { downloadText('modele-import-yuno.csv', TEMPLATE_CSV); toast(t('ya.imp.templateDone')); }}><Icon name="download" size={16} stroke={2.2} />{t('ya.imp.w1.dlTemplate')}</TextBtn>
              </div>
            </div>
          )}

          {step === 2 && parsed && file && (
            <div key="s2" style={{ display: 'flex', flexDirection: 'column', gap: 24, animation: `ya-rise 600ms ${EASE} both` }}>
              <Head title={t('ya.imp.w2.title')} sub={t('ya.imp.w2.sub')} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px 10px 14px', borderRadius: 16, background: 'var(--ya-sand-50)' }}>
                <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 10, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', display: 'grid', placeItems: 'center', color: 'var(--ya-sand-700)' }}><Icon name="file" size={18} stroke={2} /></span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                  <span style={{ fontSize: 13, color: 'var(--ya-sand-500)' }}>{file.size} · {tp('ya.imp.w2.lines', parsed.rows.length, { n: n(parsed.rows.length) })}</span>
                </span>
                <Hv as="button" type="button" onClick={reset} style={{ flex: 'none', height: 34, padding: '0 14px', border: 0, borderRadius: 99, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', fontSize: 13.5, fontWeight: 600, color: 'var(--ya-sand-700)', cursor: 'pointer' }} hover={{ background: 'var(--ya-paper)', color: 'var(--ya-ink)' }}>{t('ya.imp.w2.change')}</Hv>
              </div>
              <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '2px 2px 10px', margin: '0 -2px' }}>
                {parsed.head.map((h, i) => {
                  const v = map[i] ?? 'skip';
                  const key = v === 'email' || v === 'tel';
                  const sk = v === 'skip';
                  return (
                    <div key={i} style={{ flex: '1 0 168px', minWidth: 168, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ya-sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h || '—'}</span>
                      <div style={{ position: 'relative' }}>
                        <select value={v} onChange={(e) => setCol(i, e.target.value as ColField)} aria-label={t('ya.imp.w2.fieldAria', { h })} style={{ appearance: 'none', WebkitAppearance: 'none', width: '100%', height: 46, padding: '0 38px 0 14px', borderRadius: 12, border: `1px solid ${key ? 'var(--ya-ink)' : sk ? 'var(--ya-sand-200)' : 'var(--ya-sand-400)'}`, background: key ? 'var(--ya-sand-50)' : 'var(--ya-card)', fontSize: 14.5, fontWeight: 600, color: sk ? 'var(--ya-sand-500)' : 'var(--ya-ink)', cursor: 'pointer', outline: 0, transition: 'border-color 160ms,background 160ms' }}>
                          {COL_FIELDS.map((f) => <option key={f} value={f}>{t(`ya.imp.f.${f}`)}</option>)}
                        </select>
                        <Icon name="chevronDown" size={16} stroke={2.4} color="var(--ya-sand-500)" style={{ position: 'absolute', right: 13, top: 15, pointerEvents: 'none' }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: sk ? 0.45 : 1, transition: 'opacity 200ms' }}>
                        {parsed.rows.slice(0, 3).map((r, k) => (
                          <span key={k} style={{ height: 34, padding: '0 12px', borderRadius: 10, background: 'var(--ya-sand-50)', fontSize: 13.5, color: 'var(--ya-sand-700)', display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(r[i] ?? '').trim() || '—'}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!hasKey && (
                <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14, background: 'var(--ya-amber-50)', fontSize: 14.5, lineHeight: 1.45, color: 'var(--ya-amber-700)', animation: `ya-pop 240ms ${EASE} both` }}>
                  <Icon d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01" size={18} stroke={2} style={{ flex: 'none', marginTop: 1 }} />
                  <span><b style={{ fontWeight: 600 }}>{t('ya.imp.w2.noKey')}</b> {t('ya.imp.w2.noKeyS')}</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-400)' }}>{t('ya.imp.w2.consentQ')}</span>
                <div role="radiogroup" aria-label={t('ya.imp.w2.consentAria')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 10 }}>
                  {(['no', 'yes'] as const).map((c) => {
                    const on = consent === c;
                    return (
                      <Hv key={c} as="button" type="button" role="radio" aria-checked={on} onClick={() => setConsent(c)} style={{ textAlign: 'left', display: 'flex', gap: 12, padding: 16, borderRadius: 16, border: 0, background: on ? 'var(--ya-sand-50)' : 'var(--ya-card)', boxShadow: `inset 0 0 0 ${on ? '2px' : '1px'} ${on ? 'var(--ya-ink)' : 'var(--ya-sand-200)'}`, cursor: 'pointer', transition: 'background 160ms,box-shadow 160ms', color: 'var(--ya-ink)' }} hover={on ? undefined : { boxShadow: 'inset 0 0 0 1.5px var(--ya-sand-400)' }}>
                        <span style={{ flex: 'none', marginTop: 1, width: 20, height: 20, borderRadius: 99, border: `1.5px solid ${on ? 'var(--ya-ink)' : 'var(--ya-sand-300)'}`, background: 'var(--ya-card)', display: 'grid', placeItems: 'center' }}>
                          <span style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--ya-ink)', transform: `scale(${on ? 1 : 0})`, transition: `transform 200ms ${SPRING}` }} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontSize: 15, fontWeight: 600 }}>{t(c === 'no' ? 'ya.imp.w2.consentNo' : 'ya.imp.w2.consentYes')}</span>
                          <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--ya-sand-600)' }}>{t(c === 'no' ? 'ya.imp.w2.consentNoS' : 'ya.imp.w2.consentYesS')}</span>
                        </span>
                      </Hv>
                    );
                  })}
                </div>
              </div>
              {consent === 'yes' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 18, borderRadius: 18, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', animation: `ya-pop 240ms ${EASE} both` }}>
                  <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.imp.att.title')}</span>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{t('em.import.consentSource')}</span>
                    <select value={source} onChange={(e) => setSource(e.target.value as ConsentSource)} style={fieldStyle}>
                      <option value="" disabled>{t('em.import.consentPlaceholder')}</option>
                      {CONSENT_SOURCES.map((v) => <option key={v} value={v}>{t(SOURCE_LABEL[v])}</option>)}
                    </select>
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{t('em.import.collectedSince')}</span>
                      <input type="date" value={since} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setSince(e.target.value)} style={fieldStyle} />
                      <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{t('em.import.collectedSinceHint')}</span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{t('em.import.consentDetails')}</span>
                      <textarea value={details} rows={2} maxLength={500} placeholder={t('em.import.consentDetailsPlaceholder')} onChange={(e) => setDetails(e.target.value)} style={{ ...fieldStyle, height: 'auto', padding: '10px 12px', resize: 'vertical', lineHeight: 1.4 }} />
                    </label>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--ya-red-500)', flex: 'none' }} />
                    <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--ya-sand-700)' }}>{t('cimp.attestation')}</span>
                  </label>
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', borderTop: '1px solid var(--ya-sand-100)', paddingTop: 22 }}>
                <BrandBtn onClick={() => void runCheck()} disabled={!hasKey || !attestOk}>{t('ya.imp.w2.check')}</BrandBtn>
                <TextBtn onClick={reset}>{t('ya.imp.back2')}</TextBtn>
              </div>
            </div>
          )}

          {step === 3 && parsed && (!an ? (
            <div key="s3a" style={{ display: 'flex', flexDirection: 'column', gap: 26, animation: `ya-rise 500ms ${EASE} both` }}>
              <Head title={scanErr ? t('ya.imp.e.check.b') : t('ya.imp.w3.scanTitle')} sub={scanErr ? t('ya.imp.w4.subFail') : t('ya.imp.w3.scanSub')} />
              <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 7, padding: 18, borderRadius: 20, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)' }}>
                {parsed.rows.slice(0, 7).map((r, i) => {
                  const hit = scan * 8 > i + 0.5;
                  const get = (f: ColField) => { const j = map.indexOf(f); return j >= 0 ? String(r[j] ?? '').trim() : ''; };
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 30, padding: '0 12px', borderRadius: 10, background: hit ? 'var(--ya-seg-on)' : 'transparent', boxShadow: hit ? 'inset 0 0 0 1px var(--ya-sand-200)' : 'none', transition: 'background 200ms,box-shadow 200ms' }}>
                      <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: hit ? 'var(--ya-green-500)' : 'var(--ya-sand-300)', transition: 'background 200ms' }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, color: 'var(--ya-sand-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{get('email') || get('tel') || String(r[0] ?? '') || '—'}</span>
                    </div>
                  );
                })}
                {!scanErr && <span style={{ position: 'absolute', left: 0, right: 0, top: `${(scan * 100).toFixed(1)}%`, height: 56, marginTop: -28, background: 'linear-gradient(180deg,transparent,rgba(227,20,27,.10),transparent)', borderBottom: '2px solid rgba(227,20,27,.55)', pointerEvents: 'none' }} />}
              </div>
              <Progress p={scan} bad={scanErr} label={t(scanErr ? 'ya.imp.w3.scanStop' : 'ya.imp.w3.scanning')} track="var(--ya-sand-100)" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[t('ya.imp.w3.s1', { lines: tp('ya.imp.w2.lines', parsed.rows.length, { n: n(parsed.rows.length) }) }), t('ya.imp.w3.s2'), t('ya.imp.w3.s3')].map((l, i) => {
                  const lo = [0, 0.34, 0.67][i];
                  const hi = [0.34, 0.67, 1][i];
                  const done = scan >= hi;
                  const act = !done && scan >= lo;
                  const er = act && scanErr;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15, color: done || act ? 'var(--ya-ink)' : 'var(--ya-sand-500)', fontWeight: act ? 600 : 500, transition: 'color 200ms' }}>
                      <span style={{ flex: 'none', width: 24, height: 24, borderRadius: 99, background: done ? 'var(--ya-green-500)' : er ? 'var(--ya-red-500)' : '#fff', boxShadow: done || er ? 'none' : 'inset 0 0 0 1.5px var(--ya-sand-300)', color: '#fff', display: 'grid', placeItems: 'center' }}>
                        {done && <Icon name="check" size={13} stroke={3} />}
                        {act && !er && <span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid var(--ya-sand-300)', borderTopColor: 'var(--ya-ink)', animation: 'ya-spin 700ms linear infinite' }} />}
                        {er && <Icon name="x" size={12} stroke={3.2} />}
                      </span>
                      {l}
                    </div>
                  );
                })}
              </div>
              {scanErr && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: `ya-pop 260ms ${EASE} both` }}>
                  <Alert bold={t('ya.imp.e.check.b')} text={t('ya.imp.e.check.t')} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', borderTop: '1px solid var(--ya-sand-100)', paddingTop: 22 }}>
                    <InkBtn onClick={() => void runCheck()}>{t('ya.imp.e.retryCheck')}</InkBtn>
                    <TextBtn onClick={() => setStep(2)}>{t('ya.imp.back2')}</TextBtn>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Verify an={an} total={parsed.rows.length} hasStatus={map.includes('statut')} mode={mode} setMode={setMode} open={open} setOpen={setOpen}
              sample={!!file?.sample} canAdd={canAdd} addLabel={addLabel} onAdd={() => void startAdd()} onBack={() => setStep(2)} onPick={pick}
              onBad={dlBad} badText={badText} />
          ))}

          {step === 4 && shown && (
            <Done an={shown} prog={prog} finished={finished} failed={failed} onRetry={() => void startAdd()} onAnother={reset} />
          )}
        </section>

        <aside style={{ flex: '1 1 300px', minWidth: 0, position: 'relative', overflow: 'hidden', isolation: 'isolate', display: 'flex', flexDirection: 'column', gap: 20, padding: 28, borderRadius: 28, color: 'var(--ya-text-on-night)', background: NIGHT_BG, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)' }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-text-on-night-2)' }}>{t('ya.imp.zero')}</span>
          <NightPanelRules rules={rules} small />
        </aside>
      </div>
    </div>
  );
}

function Verify({
  an, total, hasStatus, mode, setMode, open, setOpen, sample, canAdd, addLabel, onAdd, onBack, onPick, onBad, badText,
}: {
  an: Analysis; total: number; hasStatus: boolean; mode: 'complete' | 'keep'; setMode: (m: 'complete' | 'keep') => void;
  open: Bucket | null; setOpen: (b: Bucket | null) => void; sample: boolean; canAdd: boolean; addLabel: string;
  onAdd: () => void; onBack: () => void; onPick: () => void; onBad: () => void; badText: (b: Analysis['bad'][number]) => string;
}) {
  const { t, tp, n } = useTixT();
  const by = (b: 'email' | 'tel') => t(`ya.imp.it.by.${b}`);
  const BK: { k: Bucket; c: string; fg: string; items: { t: string; s: string }[] }[] = [
    { k: 'fresh', c: 'var(--ya-green-500)', fg: 'var(--ya-green-700)', items: an.fresh.map((l) => ({ t: l.name || t('ya.imp.it.noName'), s: l.email ?? l.phone ?? '' })) },
    { k: 'exist', c: 'var(--ya-sand-400)', fg: 'var(--ya-ink)', items: an.exist.map((l) => ({ t: l.name || t('ya.imp.it.noName'), s: t('ya.imp.it.sameAs', { by: by(l.by), name: l.who }) })) },
    { k: 'dup', c: 'var(--ya-sand-300)', fg: 'var(--ya-ink)', items: an.dup.map((d) => ({ t: d.name || t('ya.imp.it.noName'), s: t('ya.imp.it.sameLine', { l: d.line, by: by(d.by), o: d.other }) })) },
    { k: 'bad', c: 'var(--ya-amber-500)', fg: 'var(--ya-amber-700)', items: an.bad.map((b) => ({ t: b.name || t('ya.imp.it.line', { l: b.line }), s: badText(b) })) },
    // Seulement quand le fichier dit qui s'est désabonné : sinon la rangée n'a rien à dire.
    ...(hasStatus || an.out.length ? [{ k: 'out' as const, c: 'var(--ya-red-400)', fg: 'var(--ya-red-700)', items: an.out.map((o) => ({ t: o.name || t('ya.imp.it.line', { l: o.line }), s: t('ya.imp.it.out', { l: o.line, v: o.value }) })) }] : []),
  ];
  const sub = (k: Bucket) => (k === 'fresh' ? t('ya.imp.b.freshS') : k === 'exist' ? t(mode === 'complete' ? 'ya.imp.b.existComplete' : 'ya.imp.b.existKeep') : k === 'dup' ? t('ya.imp.b.dupS') : k === 'out' ? t('ya.imp.b.outS') : t('ya.imp.b.badS'));
  const label = (k: Bucket) => t(`ya.imp.b.${k}`);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, animation: `ya-rise 600ms ${EASE} both` }}>
      <Head title={t('ya.imp.w3.title')} sub={t('ya.imp.w3.sub', { lines: tp('ya.imp.w2.lines', total, { n: n(total) }) })} />
      <div style={{ display: 'flex', height: 14, gap: 3, borderRadius: 99, overflow: 'hidden' }}>
        {BK.filter((b) => b.items.length > 0).map((b, i) => (
          <span key={b.k} style={{ flex: `${b.items.length} 1 0`, minWidth: 6, background: b.c, transformOrigin: 'left', animation: `ya-rise 700ms ${EASE} both`, animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {BK.map((b) => {
          const cnt = b.items.length;
          const o = open === b.k && cnt > 0;
          return (
            <div key={b.k} style={{ borderRadius: 18, background: o ? 'var(--ya-card)' : 'var(--ya-sand-50)', boxShadow: `inset 0 0 0 1px ${o ? 'var(--ya-sand-300)' : 'transparent'}`, overflow: 'hidden', transition: 'background 200ms,box-shadow 200ms' }}>
              <Hv as="button" type="button" onClick={() => { if (cnt) setOpen(o ? null : b.k); }} aria-expanded={o} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', border: 0, background: 'none', textAlign: 'left', cursor: cnt ? 'pointer' : 'default', color: 'var(--ya-ink)' }} hover={cnt ? { background: 'rgb(var(--ink) / .025)' } : undefined}>
                <span style={{ flex: 'none', width: 12, height: 12, borderRadius: 4, background: b.c }} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15.5, fontWeight: 600 }}>{label(b.k)}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--ya-sand-600)' }}>{sub(b.k)}</span>
                </span>
                <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums', color: cnt ? b.fg : 'var(--ya-sand-300)' }}>{n(cnt)}</span>
                <Icon name="chevronDown" size={18} stroke={2.4} color="var(--ya-sand-400)" style={{ flex: 'none', opacity: cnt ? 1 : 0, transform: `rotate(${o ? 180 : 0}deg)`, transition: `transform 220ms ${EASE}` }} />
              </Hv>
              {o && (
                <div style={{ display: 'flex', flexDirection: 'column', padding: '0 18px 14px 44px', animation: `ya-rise 320ms ${EASE} both` }}>
                  {b.items.slice(0, 5).map((it, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px 16px', flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid var(--ya-sand-100)' }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600 }}>{it.t}</span>
                      <span style={{ fontSize: 13.5, color: 'var(--ya-sand-600)', overflowWrap: 'anywhere' }}>{it.s}</span>
                    </div>
                  ))}
                  {cnt > 5 && <span style={{ paddingTop: 10, borderTop: '1px solid var(--ya-sand-100)', fontSize: 13.5, color: 'var(--ya-sand-500)' }}>{t('ya.imp.b.more', { n: n(cnt - 5) })}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {an.exist.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-400)' }}>{t('ya.imp.w3.existFor', { n: n(an.exist.length) })}</span>
          <div role="radiogroup" aria-label={t('ya.imp.b.exist')} style={{ display: 'inline-flex', alignSelf: 'flex-start', padding: 3, gap: 2, background: 'var(--ya-sand-100)', borderRadius: 99, flexWrap: 'wrap' }}>
            {(['complete', 'keep'] as const).map((m) => {
              const on = mode === m;
              return (
                <button key={m} type="button" role="radio" aria-checked={on} onClick={() => setMode(m)} style={{ height: 38, padding: '0 18px', border: 0, borderRadius: 99, background: on ? 'var(--ya-seg-on)' : 'transparent', color: on ? 'var(--ya-ink)' : 'var(--ya-sand-600)', boxShadow: on ? 'var(--ya-shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'background 180ms,color 180ms,box-shadow 180ms' }}>
                  {t(m === 'complete' ? 'ya.imp.w3.mComplete' : 'ya.imp.w3.mKeep')}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {sample && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)' }}>
          <Icon name="eye" size={18} stroke={2} color="var(--ya-sand-600)" />
          <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--ya-sand-700)' }}>{t('ya.imp.w3.sampleNote')}</span>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', borderTop: '1px solid var(--ya-sand-100)', paddingTop: 22 }}>
        {sample ? <BrandBtn onClick={onPick}>{t('ya.imp.w3.sampleCta')}</BrandBtn> : <BrandBtn onClick={onAdd} disabled={!canAdd}>{addLabel}</BrandBtn>}
        <TextBtn onClick={onBack}>{t('ya.imp.back2')}</TextBtn>
        {an.bad.length > 0 && (
          <Hv as="button" type="button" onClick={onBad} style={{ marginLeft: 'auto', height: 46, padding: '0 6px', border: 0, background: 'none', fontSize: 14.5, fontWeight: 600, color: 'var(--ya-sand-600)', display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} hover={{ color: 'var(--ya-ink)' }}>
            <Icon name="download" size={15} stroke={2.2} />{t('ya.imp.w3.badDl')}
          </Hv>
        )}
      </div>
    </div>
  );
}

function Done({ an, prog, finished, failed, onRetry, onAnother }: { an: Analysis; prog: number; finished: boolean; failed: 'cnx' | 'rights' | null; onRetry: () => void; onAnother: () => void }) {
  const TIX_ROUTES = useTixClientRoutes();
  const { t, tp, n } = useTixT();
  const ease = 1 - Math.pow(1 - prog, 3);
  const cols = [
    { l: t('ya.imp.w4.cFresh'), v: an.fresh.length, fg: 'var(--ya-green-700)' },
    { l: t('ya.imp.w4.cExist'), v: an.exist.length, fg: 'var(--ya-ink)' },
    { l: t('ya.imp.w4.cDup'), v: an.dup.length, fg: 'var(--ya-ink)' },
    { l: t('ya.imp.w4.cBad'), v: an.bad.length + an.out.length, fg: an.bad.length + an.out.length ? 'var(--ya-amber-700)' : 'var(--ya-ink)' },
  ];
  const title = failed ? t('ya.imp.w4.titleFail') : finished ? (an.fresh.length ? tp('ya.imp.w4.titleDone', an.fresh.length, { n: n(an.fresh.length) }) : t('ya.imp.w4.titleNothing')) : t('ya.imp.w4.titleRun');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26, animation: `ya-rise 600ms ${EASE} both` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 22px' }}>
        <span aria-hidden style={{ flex: 'none', width: 72, height: 72, borderRadius: 99, display: 'grid', placeItems: 'center', color: '#fff', background: failed ? 'var(--ya-red-600)' : finished ? 'var(--ya-green-500)' : 'var(--ya-gradient-brand)', boxShadow: 'var(--ya-shadow-md)' }}>
          <Icon name={failed ? 'alert' : finished ? 'check' : 'upload'} size={30} stroke={2.4} style={{ animation: !failed && !finished ? 'ya-float 1.2s ease-in-out infinite' : undefined }} />
        </span>
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: failed ? 'var(--ya-red-600)' : finished ? 'var(--ya-green-700)' : 'var(--ya-sand-500)' }}>{t(failed ? 'ya.imp.w4.eyeFail' : finished ? 'ya.imp.w4.eyeDone' : 'ya.imp.w4.eyeRun')}</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance' }}>{title}</h2>
          <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--ya-sand-600)' }}>{t(failed ? 'ya.imp.w4.subFail' : finished ? 'ya.imp.w4.subDone' : 'ya.imp.w4.subRun')}</span>
        </div>
      </div>
      <Progress p={failed ? Math.max(prog, 0.4) : ease} bad={!!failed} label={t(failed ? 'ya.imp.w4.progFail' : finished ? 'ya.imp.w4.progDone' : 'ya.imp.w4.progRun')} track="var(--ya-sand-100)" />
      {failed && <Alert bold={t(failed === 'rights' ? 'ya.imp.e.rights.b' : 'ya.imp.e.cnx.b')} text={t(failed === 'rights' ? 'ya.imp.e.rights.t' : 'ya.imp.e.cnx.t')} />}
      {!failed && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,160px),1fr))', gap: 12 }}>
          {cols.map((c) => (
            <div key={c.l} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 18px', borderRadius: 18, background: 'var(--ya-sand-50)' }}>
              <span style={{ fontSize: 13.5, lineHeight: 1.3, color: 'var(--ya-sand-600)' }}>{c.l}</span>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 34, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums', color: c.fg }}>{n(c.v * ease)}</span>
            </div>
          ))}
        </div>
      )}
      {finished && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--ya-green-50)', animation: `ya-rise 500ms ${EASE} both` }}>
          <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--ya-green-500)' }} />
          <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{t('ya.imp.w4.noDup')}</span>
        </div>
      )}
      {finished && <SegmentsNextStep context="file" autoOpen />}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', borderTop: '1px solid var(--ya-sand-100)', paddingTop: 22 }}>
        {failed === 'cnx' && <InkBtn onClick={onRetry}>{t('ya.imp.w4.retry')}</InkBtn>}
        {!failed && (
          <Hv as={Link} to={TIX_ROUTES.clients} style={{ height: 46, padding: '0 5px 0 22px', borderRadius: 99, background: 'var(--ya-gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--ya-shadow-cta)', textDecoration: 'none', whiteSpace: 'nowrap', opacity: finished ? 1 : 0.35, pointerEvents: finished ? 'auto' : 'none', transition: 'opacity 300ms' }} hover={{ filter: 'brightness(1.05)', color: '#fff', textDecoration: 'none' }}>
            {t('ya.imp.w4.clients')}<span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--ya-red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={16} stroke={2.4} /></span>
          </Hv>
        )}
        <TextBtn onClick={onAnother} style={{ opacity: finished || failed ? 1 : 0.35, pointerEvents: finished || failed ? 'auto' : 'none' }}>{t(failed ? 'ya.imp.w4.changeFile' : 'ya.imp.w4.another')}</TextBtn>
      </div>
    </div>
  );
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1 }}>{title}</h2>
      <span style={{ fontSize: 14.5, color: 'var(--ya-sand-600)' }}>{sub}</span>
    </div>
  );
}

function FileChip({ name, meta }: { name: string; meta: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 12, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', display: 'grid', placeItems: 'center', color: 'var(--ya-sand-700)' }}><Icon name="file" size={20} stroke={2} /></span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontSize: 13, color: 'var(--ya-sand-500)' }}>{meta}</span>
      </span>
    </div>
  );
}

function Progress({ p, bad, label, track = 'var(--ya-sand-200)' }: { p: number; bad: boolean; label: string; track?: string }) {
  const pc = `${Math.round(Math.max(0, Math.min(1, p)) * 100)} %`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ height: 10, borderRadius: 99, background: track, overflow: 'hidden' }}>
        <div style={{ width: `${(Math.max(0, Math.min(1, p)) * 100).toFixed(1)}%`, height: '100%', borderRadius: 99, background: bad ? 'var(--ya-red-500)' : 'var(--ya-gradient-brand)', transition: 'background 300ms' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--ya-sand-500)' }}>
        <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{pc}</span>
      </div>
    </div>
  );
}

function Alert({ bold, text, round }: { bold?: string; text: string; round?: boolean }) {
  return (
    <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: round ? '14px 16px' : '16px 18px', borderRadius: round ? 14 : 16, background: 'var(--ya-red-50)', boxShadow: 'inset 0 0 0 1px var(--ya-red-200)', fontSize: 14.5, lineHeight: 1.45, color: 'var(--ya-red-700)', animation: `ya-pop 240ms ${EASE} both` }}>
      <Icon name="alert" size={18} stroke={2} style={{ flex: 'none', marginTop: 1 }} />
      <span>{bold && <b style={{ fontWeight: 600, color: 'var(--ya-red-800)' }}>{bold}</b>} {text}</span>
    </div>
  );
}

function BrandBtn({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Hv
      as="button"
      type="button"
      onClick={() => { if (!disabled) onClick(); }}
      aria-disabled={disabled}
      style={{ height: 46, padding: `0 ${disabled ? '22px' : '5px'} 0 22px`, border: 0, borderRadius: 99, background: disabled ? 'var(--ya-sand-100)' : 'var(--ya-gradient-brand)', color: disabled ? 'var(--ya-sand-500)' : '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: disabled ? 'none' : 'var(--ya-shadow-cta)', cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms,background 200ms` }}
      hover={disabled ? undefined : { filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
      active={disabled ? undefined : { transform: 'scale(.97)' }}
    >
      {children}
      {!disabled && <span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--ya-red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={16} stroke={2.4} /></span>}
    </Hv>
  );
}

function InkBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Hv as="button" type="button" onClick={onClick} style={{ height: 46, padding: '0 22px', border: 0, borderRadius: 99, background: 'var(--ya-ink)', color: 'var(--ya-on-ink)', fontSize: 15, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }} hover={{ background: 'var(--ya-sand-700)' }}>
      {children}
    </Hv>
  );
}

function TextBtn({ children, onClick, style }: { children: ReactNode; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <Hv as="button" type="button" onClick={onClick} style={{ height: 46, padding: '0 6px', border: 0, background: 'none', fontSize: 15, fontWeight: 600, color: 'var(--ya-sand-600)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, ...style }} hover={{ color: 'var(--ya-ink)' }}>
      {children}
    </Hv>
  );
}

