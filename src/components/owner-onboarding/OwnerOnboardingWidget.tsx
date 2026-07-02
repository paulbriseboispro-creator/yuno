import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronUp, ChevronDown, X, Rocket, SkipForward,
  ChevronRight, ArrowLeft, ExternalLink, HelpCircle,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerOnboarding } from '@/hooks/useOwnerOnboarding';

const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

interface Sub { fr: string; en: string; es: string; page: string; descFr?: string; descEn?: string; descEs?: string }
interface StepDef { key: string; fr: string; en: string; es: string; page: string; subs: Sub[] }

const STEP_DEFS: StepDef[] = [
  {
    key: '1', fr: 'Piliers & bienvenue', en: 'Pillars & welcome', es: 'Pilares y bienvenida',
    page: '/owner/onboarding',
    subs: [
      {
        fr: 'Billets, tables VIP ou boissons ?', en: 'Tickets, VIP tables or drinks?', es: '¿Entradas, mesas VIP o bebidas?',
        page: '/owner/onboarding',
        descFr: "Yuno a 3 piliers : la billetterie (vente en ligne + QR check-in), les tables VIP (réservation + package bouteilles), et les boissons (commande depuis le téléphone pour éviter la queue au bar). Activez les piliers qui correspondent à votre établissement.",
        descEn: "Yuno has 3 pillars: ticketing (online sales + QR check-in), VIP tables (booking + bottle packages), and drinks (order from phone to skip the bar queue). Enable the pillars that match your venue.",
        descEs: 'Yuno tiene 3 pilares: entradas (venta online + QR check-in), mesas VIP (reserva + packs de botellas) y bebidas (pedido desde el móvil). Activa los que corresponden a tu local.',
      },
    ],
  },
  {
    key: '2', fr: 'Votre établissement', en: 'Your venue', es: 'Tu establecimiento',
    page: '/owner/venue',
    subs: [
      { fr: 'Nom, ville, adresse', en: 'Name, city, address', es: 'Nombre, ciudad, dirección', page: '/owner/venue' },
      { fr: 'Informations légales (SIRET)', en: 'Legal info (registration no.)', es: 'Información legal', page: '/owner/venue' },
    ],
  },
  {
    key: '3', fr: 'Votre offre', en: 'Your offer', es: 'Tu oferta',
    page: '/owner/events',
    subs: [
      { fr: 'Créer un événement', en: 'Create an event', es: 'Crear un evento', page: '/owner/events' },
      {
        fr: 'Tables VIP & bouteilles', en: 'VIP tables & bottles', es: 'Mesas VIP y botellas',
        page: '/owner/tables',
        descFr: "Configurez votre plan de salle, créez des tables avec capacité et prix minimum. Associez des packages bouteilles avec diluants. Le client réserve en ligne et paye — vous recevez un virement direct sur votre Stripe.",
        descEn: "Set up your floorplan, create tables with capacity and minimum spend, add bottle packages with mixers. Customers book and pay online — you receive a direct transfer to your Stripe.",
        descEs: 'Configura tu plano con mesas y gasto mínimo. Añade packs de botellas. El cliente reserva y paga online, tú recibes transferencia directa a tu Stripe.',
      },
      {
        fr: 'Carte des boissons', en: 'Drinks menu', es: 'Carta de bebidas',
        page: '/owner/menu',
        descFr: "Créez votre carte avec catégories, photos et prix. La nuit de l'événement, vos clients scannent un QR code, commandent et paient depuis leur téléphone. La commande arrive en temps réel sur l'écran du barman.",
        descEn: "Create your menu with categories, photos and prices. On the night, customers scan a QR code and order from their phone. The order arrives in real-time on the bartender's screen.",
        descEs: 'Crea tu carta con categorías, fotos y precios. Los clientes escanean un QR y piden desde el móvil. El pedido llega al barman en tiempo real.',
      },
    ],
  },
  {
    key: '4', fr: 'Image de marque', en: 'Branding', es: 'Imagen de marca',
    page: '/owner/venue',
    subs: [
      { fr: 'Photo de couverture', en: 'Cover photo', es: 'Foto de portada', page: '/owner/venue' },
      { fr: 'Description & ambiance', en: 'Description & vibe', es: 'Descripción y ambiente', page: '/owner/venue' },
      { fr: 'Instagram & réseaux', en: 'Instagram & socials', es: 'Instagram y redes', page: '/owner/venue' },
    ],
  },
  {
    key: '5', fr: 'Votre équipe', en: 'Your team', es: 'Tu equipo',
    page: '/owner/staff',
    subs: [
      { fr: 'Inviter le staff (bouncer, barman…)', en: 'Invite staff (bouncer, bartender…)', es: 'Invitar staff', page: '/owner/staff' },
      {
        fr: 'Hôte VIP & vestiaire', en: 'VIP host & cloakroom', es: 'Anfitrión VIP y guardarropa',
        page: '/owner/staff',
        descFr: "L'hôte VIP accueille les clients en réservation de table et les accompagne. Le vestiaire gère les entrées. Chacun reçoit un PIN unique et accède à son interface depuis n'importe quel téléphone — aucun compte à créer.",
        descEn: "The VIP host greets table booking customers and escorts them. The cloakroom manages check-ins. Each gets a unique PIN and accesses their interface from any phone — no account to create.",
        descEs: 'El anfitrión VIP recibe a los clientes con reserva de mesa. El guardarropa gestiona entradas. Cada uno tiene un PIN único y accede desde cualquier móvil.',
      },
    ],
  },
  {
    key: '6', fr: 'Paiements Stripe', en: 'Stripe payments', es: 'Pagos Stripe',
    page: '/owner/billing',
    subs: [
      { fr: 'Connecter votre compte Stripe', en: 'Connect your Stripe account', es: 'Conectar cuenta Stripe', page: '/owner/billing' },
      { fr: 'Choisir votre abonnement Yuno', en: 'Choose your Yuno plan', es: 'Elegir tu plan Yuno', page: '/owner/billing' },
    ],
  },
  {
    key: '7', fr: 'Mise en ligne', en: 'Go live', es: 'Publicar',
    page: '/owner/events',
    subs: [
      { fr: 'Publier votre premier événement', en: 'Publish your first event', es: 'Publicar tu primer evento', page: '/owner/events' },
      {
        fr: 'Rendre votre club visible', en: 'Make your venue visible', es: 'Hacer tu club visible',
        page: '/owner/venue',
        descFr: "Activez la visibilité de votre établissement depuis la page Établissement. Votre club apparaît dans l'espace Explore de l'app Yuno et dans les résultats de recherche — les clients de votre ville verront vos soirées.",
        descEn: "Activate your venue visibility from the Venue page. Your club appears in the Yuno app's Explore section and search results — customers in your city will see your events.",
        descEs: 'Activa la visibilidad de tu local desde la página Establecimiento. Aparecerás en el Explore de Yuno y en los resultados de búsqueda.',
      },
    ],
  },
];

const STEP_COUNT = STEP_DEFS.length;

interface Props { venueId: string }

export function OwnerOnboardingWidget({ venueId }: Props) {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const l = (s: { fr: string; en: string; es: string }) =>
    language === 'fr' ? s.fr : language === 'es' ? s.es : s.en;

  const { loading, stepStatuses, isComplete } = useOwnerOnboarding(venueId);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [popup, setPopup] = useState<Sub | null>(null);
  const initRef = useRef(false);
  const [isDismissed, setIsDismissed] = useState(() =>
    sessionStorage.getItem('owner_widget_dismissed') === '1',
  );

  const doneCount = Object.values(stepStatuses).filter(
    s => s.status === 'completed' || s.status === 'skipped',
  ).length;

  const nextKey = STEP_DEFS.find(s => {
    const st = stepStatuses[s.key]?.status;
    return st !== 'completed' && st !== 'skipped';
  })?.key ?? null;

  useEffect(() => {
    if (!loading && nextKey && !initRef.current) {
      initRef.current = true;
      setExpandedStep(nextKey);
    }
  }, [loading, nextKey]);

  useEffect(() => { if (!isExpanded) setPopup(null); }, [isExpanded]);

  if (loading || isDismissed || isComplete || doneCount >= STEP_COUNT) return null;

  const progressPct = Math.round((doneCount / STEP_COUNT) * 100);
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (progressPct / 100) * circ;

  const goTo = (page: string) => { navigate(page); setIsExpanded(false); };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    sessionStorage.setItem('owner_widget_dismissed', '1');
    setIsDismissed(true);
  };

  const popupDesc = popup
    ? (language === 'fr' ? popup.descFr : language === 'es' ? popup.descEs : popup.descEn) ?? ''
    : '';

  return (
    <div className="fixed z-50 flex flex-col items-end gap-2" style={{ bottom: 24, right: 24 }}>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            style={{
              background: CARD_BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 16,
              width: 310,
              maxHeight: 'calc(100dvh - 120px)',
              overflowY: 'auto',
              boxShadow: '0 24px 60px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
            }}
          >
            {/* ── Sticky header ── */}
            <div
              className="flex items-center gap-3 px-4 py-3 sticky top-0 z-10"
              style={{ background: '#0a0a0c', borderBottom: `1px solid ${BORDER}` }}
            >
              {popup ? (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPopup(null); }}
                    className="flex items-center gap-1.5 cursor-pointer hover:opacity-70"
                    style={{ color: T2 }}
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span style={{ fontSize: 12 }}>{t('common.back') || 'Retour'}</span>
                  </button>
                  <div className="flex-1" />
                </>
              ) : (
                <>
                  <div
                    className="flex items-center justify-center rounded-lg flex-none"
                    style={{ width: 30, height: 30, background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
                  >
                    <Rocket className="w-4 h-4" style={{ color: RED }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ color: T1, fontSize: 13, fontWeight: 600, margin: 0 }}>
                      {t('onboarding.completeSetup')}
                    </p>
                    <p style={{ color: T3, fontSize: 11, marginTop: 1 }} className="tabular-nums">
                      {doneCount}/{STEP_COUNT} {t('onboarding.steps')} · {progressPct}%
                    </p>
                  </div>
                </>
              )}
              <button
                onClick={popup ? (e) => { e.stopPropagation(); setPopup(null); } : handleDismiss}
                className="flex items-center justify-center w-6 h-6 rounded-md cursor-pointer hover:bg-white/[0.06] flex-none"
                style={{ color: T3 }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {!popup && (
              <div style={{ height: 2, background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ height: '100%', width: `${progressPct}%`, background: RED, boxShadow: `0 0 8px -1px ${RED}`, transition: 'width 0.4s ease' }} />
              </div>
            )}

            {/* ── Popup view ── */}
            {popup ? (
              <div className="px-4 py-4">
                <p style={{ color: T1, fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>{l(popup)}</p>
                <p style={{ color: T2, fontSize: 12, lineHeight: 1.65, marginBottom: 16 }}>{popupDesc}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); goTo(popup.page); }}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl cursor-pointer"
                  style={{ background: RED, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 0 16px -4px ${RED}88` }}
                >
                  {t('onboarding.goToPage') || 'Aller sur la page'}
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              /* ── Step list view ── */
              <div className="py-1">
                {STEP_DEFS.map((step) => {
                  const status = stepStatuses[step.key]?.status ?? 'not_started';
                  const done = status === 'completed' || status === 'skipped';
                  const isNext = step.key === nextKey;
                  const open = expandedStep === step.key;

                  return (
                    <div key={step.key}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedStep(prev => prev === step.key ? null : step.key);
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 cursor-pointer transition-colors hover:bg-white/[0.03] text-left"
                      >
                        <div
                          className="flex-none w-5 h-5 rounded-full flex items-center justify-center"
                          style={
                            done
                              ? { background: status === 'skipped' ? 'rgba(255,255,255,0.06)' : POS }
                              : isNext
                              ? { border: `1.5px solid ${RED}`, background: 'rgba(232,25,44,0.08)' }
                              : { border: `1px solid ${BORDER}` }
                          }
                        >
                          {done ? (
                            status === 'skipped'
                              ? <SkipForward className="w-2.5 h-2.5" style={{ color: T3 }} />
                              : <Check className="w-3 h-3" style={{ color: '#04130d' }} />
                          ) : (
                            <span style={{ fontSize: 9, fontWeight: 700, color: isNext ? RED : T3 }}>{step.key}</span>
                          )}
                        </div>
                        <span style={{
                          flex: 1, fontSize: 12.5,
                          fontWeight: isNext && !done ? 600 : 400,
                          color: done ? T2 : isNext ? T1 : T2,
                          textDecoration: done ? 'line-through' : 'none',
                          textDecorationColor: 'rgba(255,255,255,0.2)',
                        }}>
                          {l(step)}
                        </span>
                        {open
                          ? <ChevronDown className="w-3.5 h-3.5 flex-none" style={{ color: T3 }} />
                          : <ChevronRight className="w-3.5 h-3.5 flex-none" style={{ color: isNext && !done ? RED : T3 }} />
                        }
                      </button>

                      <AnimatePresence>
                        {open && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.14 }}
                            style={{ overflow: 'hidden' }}
                          >
                            <div
                              style={{
                                borderLeft: `1.5px solid ${isNext && !done ? 'rgba(232,25,44,0.3)' : BORDER}`,
                                marginLeft: 28,
                                marginRight: 12,
                                paddingBottom: 4,
                              }}
                            >
                              {step.subs.map((sub, si) => (
                                <div key={si} className="flex items-center gap-1 my-0.5">
                                  {/* Navigate button */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); goTo(sub.page); }}
                                    className="flex items-center gap-2 flex-1 px-2 py-1.5 cursor-pointer transition-colors hover:bg-white/[0.05] text-left rounded-lg min-w-0"
                                  >
                                    <ChevronRight
                                      className="w-3 h-3 flex-none"
                                      style={{ color: isNext && !done ? RED : T3 }}
                                    />
                                    <span style={{ fontSize: 11.5, color: done ? T3 : T2 }}>{l(sub)}</span>
                                  </button>
                                  {/* Help popup button */}
                                  {sub.descEn && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setPopup(sub); }}
                                      className="flex-none flex items-center justify-center w-6 h-6 rounded cursor-pointer transition-colors hover:bg-white/[0.08]"
                                      title={language === 'fr' ? 'En savoir plus' : language === 'es' ? 'Más info' : 'Learn more'}
                                    >
                                      <HelpCircle
                                        className="w-3.5 h-3.5"
                                        style={{ color: isNext && !done ? RED : T3 }}
                                      />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle pill */}
      <button
        onClick={(e) => { e.stopPropagation(); setIsExpanded(v => !v); }}
        className="flex items-center gap-2.5 cursor-pointer transition-all hover:scale-105 active:scale-95"
        style={{
          background: '#0a0a0c',
          border: `1px solid ${BORDER}`,
          borderRadius: 999,
          padding: '8px 14px 8px 10px',
          boxShadow: '0 8px 24px -4px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        }}
      >
        <svg width={36} height={36} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
          <circle cx={18} cy={18} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3} />
          <circle cx={18} cy={18} r={r} fill="none" stroke={RED} strokeWidth={3}
            strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ / 4}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.4s ease', filter: `drop-shadow(0 0 4px ${RED})` }}
          />
          <text x={18} y={22} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: T1 }}>
            {doneCount}/{STEP_COUNT}
          </text>
        </svg>
        <span style={{ color: T1, fontSize: 13, fontWeight: 600 }}>
          {t('onboarding.setup')}
        </span>
        {isExpanded
          ? <ChevronDown className="w-3.5 h-3.5 flex-none" style={{ color: T2 }} />
          : <ChevronUp className="w-3.5 h-3.5 flex-none" style={{ color: T2 }} />
        }
      </button>
    </div>
  );
}
