import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronUp, ChevronDown, X, Rocket, SkipForward,
  ChevronRight, ArrowLeft, ExternalLink, HelpCircle,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useOrganizerOnboarding } from '@/hooks/useOrganizerOnboarding';

const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

interface Sub {
  fr: string; en: string; es: string;
  page: string;
  descFr?: string; descEn?: string; descEs?: string;
}
interface StepDef { key: string; fr: string; en: string; es: string; page: string; subs: Sub[] }

const STEP_DEFS: StepDef[] = [
  {
    key: '1', fr: 'Organisation & ville', en: 'Organization & city', es: 'Organización y ciudad',
    page: '/organizer-app/organization',
    subs: [
      { fr: "Nom & description de l'orga", en: 'Org name & description', es: 'Nombre y descripción', page: '/organizer-app/organization' },
      { fr: 'Ville principale des soirées', en: 'Your main event city', es: 'Ciudad principal', page: '/organizer-app/organization' },
    ],
  },
  {
    key: '2', fr: 'Profil public', en: 'Public profile', es: 'Perfil público',
    page: '/organizer-app/profile',
    subs: [
      { fr: 'Photo & bio publique', en: 'Photo & public bio', es: 'Foto y bio pública', page: '/organizer-app/profile' },
      { fr: 'Instagram & réseaux sociaux', en: 'Instagram & social links', es: 'Instagram y redes', page: '/organizer-app/profile' },
    ],
  },
  {
    key: '3', fr: 'Premier événement', en: 'First event', es: 'Primer evento',
    page: '/organizer-app/events',
    subs: [
      { fr: 'Créer une soirée', en: 'Create an event', es: 'Crear un evento', page: '/organizer-app/events' },
      {
        fr: 'Configurer la billetterie', en: 'Set up tickets', es: 'Configurar entradas',
        page: '/organizer-app/ticketing',
        descFr: "Créez des types de billets (normal, VIP, early bird) avec prix, quantités et dates de prévente. Chaque acheteur reçoit un QR code unique scannable à l'entrée par votre bouncer.",
        descEn: 'Create ticket tiers (standard, VIP, early bird) with prices, quantities and presale dates. Each buyer gets a unique QR code your bouncer scans at the door.',
        descEs: 'Crea tipos de entradas (normal, VIP, preventa) con precios, cantidades y fechas. Cada comprador recibe un QR único que el portero escanea en la puerta.',
      },
      {
        fr: 'Ouvrir la guest list', en: 'Open the guest list', es: 'Abrir la lista de invitados',
        page: '/organizer-app/guest-list',
        descFr: "La guest list permet à vos invités de s'inscrire gratuitement via un lien partageable. Le jour J, votre bouncer valide les noms en un clic depuis son téléphone — pas de papier, pas d'impression.",
        descEn: 'The guest list lets invitees register for free via a shareable link. On the night, your bouncer validates names in one tap from their phone — no paper, no printing.',
        descEs: 'La lista de invitados permite inscribirse gratis con un enlace. El portero valida los nombres con un toque desde su móvil, sin papel.',
      },
    ],
  },
  {
    key: '4', fr: 'Équipe & promoteurs', en: 'Team & promoters', es: 'Equipo y promotores',
    page: '/organizer-app/team',
    subs: [
      { fr: 'Inviter un collaborateur', en: 'Invite a collaborator', es: 'Invitar colaborador', page: '/organizer-app/team' },
      {
        fr: 'Créer des liens promoteurs', en: 'Create promoter links', es: 'Crear links de promotores',
        page: '/organizer-app/promoters',
        descFr: "Chaque promoteur reçoit un lien de tracking unique. Quand un client achète un billet via ce lien, sa commission est calculée automatiquement — vous gardez la main sur les taux.",
        descEn: 'Each promoter gets a unique tracking link. When a customer buys through it, their commission is calculated automatically — you control the rates.',
        descEs: 'Cada promotor tiene un enlace único. Cuando alguien compra a través de él, la comisión se calcula automáticamente.',
      },
    ],
  },
  {
    key: '5', fr: 'Paiements Stripe', en: 'Stripe payments', es: 'Pagos Stripe',
    page: '/organizer-app/payments',
    subs: [
      { fr: 'Connecter votre compte Stripe', en: 'Connect your Stripe account', es: 'Conectar cuenta Stripe', page: '/organizer-app/payments' },
    ],
  },
  {
    key: '6', fr: "Découvrir l'app", en: 'Explore the app', es: 'Explorar la app',
    page: '/organizer-app',
    subs: [
      {
        fr: 'QR Check-in en soirée', en: 'QR Check-in at events', es: 'QR Check-in en eventos',
        page: '/organizer-app/checkin',
        descFr: "Le jour de la soirée, votre bouncer ouvre cette page sur son téléphone et scanne les QR codes des billets. Il voit instantanément si le billet est valide, déjà utilisé ou frauduleux. Aucune app à installer.",
        descEn: "On the night, your bouncer opens this page on their phone and scans ticket QR codes. They see instantly if a ticket is valid, already used, or fake. No app to install.",
        descEs: 'El portero abre esta página en su móvil y escanea los QR de las entradas. Ve al instante si son válidas. Sin apps.',
      },
      {
        fr: 'Tables VIP & bouteilles', en: 'VIP tables & bottles', es: 'Mesas VIP y botellas',
        page: '/organizer-app/tables',
        descFr: "Proposez des réservations de tables avec packages bouteilles. Le client choisit sa table, sélectionne ses bouteilles et diluants, puis paye en ligne. Le paiement va directement sur votre compte Stripe.",
        descEn: 'Offer table bookings with bottle packages. Customers pick their table, choose bottles and mixers, then pay online. Payment goes directly to your Stripe account.',
        descEs: 'Ofrece reservas de mesa con packs de botellas. El cliente elige su mesa, botellas y mezcladores, y paga online.',
      },
      {
        fr: 'Campagnes email', en: 'Email campaigns', es: 'Campañas de email',
        page: '/organizer-app/campaigns',
        descFr: "Envoyez des emails à votre base clients : annonce de soirée, promo de billets, newsletter mensuelle. Les stats d'ouverture et de clic sont disponibles après chaque envoi.",
        descEn: 'Send emails to your customer base: event announcements, ticket promos, monthly newsletters. Open and click stats available after each send.',
        descEs: 'Envía emails a tus clientes: anuncios, promos, newsletters. Estadísticas de apertura y clics disponibles.',
      },
      {
        fr: 'Analytique post-soirée', en: 'Post-event analytics', es: 'Analítica post-evento',
        page: '/organizer-app/analytics',
        descFr: "Après chaque soirée : billets vendus par type, revenus nets, taux de no-show, provenance géographique des acheteurs, et évolution sur la saison.",
        descEn: "After each event: tickets sold by tier, net revenue, no-show rate, buyer geography, and season trend.",
        descEs: 'Después de cada evento: entradas por tipo, ingresos netos, tasa de no-show, origen de compradores y tendencia de temporada.',
      },
      {
        fr: 'Collaborer avec un club', en: 'Collaborate with a venue', es: 'Colaborar con un club',
        page: '/organizer-app/collaborations',
        descFr: "Co-organisez une soirée avec un club partenaire. Vous définissez le partage des revenus (billets, tables, boissons) et les virements sont automatiques — chacun reçoit sa part directement.",
        descEn: "Co-host an event with a partner venue. Set the revenue split (tickets, tables, drinks) and payouts are automatic — each party receives their share directly.",
        descEs: 'Co-organiza un evento con un club. Acordáis el reparto de ingresos y los pagos son automáticos.',
      },
    ],
  },
];

const STEP_COUNT = STEP_DEFS.length;

interface Props { userId: string }

export function OrgOnboardingWidget({ userId }: Props) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const l = (s: { fr: string; en: string; es: string }) =>
    language === 'fr' ? s.fr : language === 'es' ? s.es : s.en;

  const { loading, stepStatuses } = useOrganizerOnboarding(userId);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [popup, setPopup] = useState<Sub | null>(null);
  const initRef = useRef(false);
  const [isDismissed, setIsDismissed] = useState(() =>
    sessionStorage.getItem('org_widget_dismissed') === '1',
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

  if (loading || isDismissed || doneCount >= STEP_COUNT) return null;

  const progressPct = Math.round((doneCount / STEP_COUNT) * 100);
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (progressPct / 100) * circ;

  const goTo = (page: string) => { navigate(page); setIsExpanded(false); };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    sessionStorage.setItem('org_widget_dismissed', '1');
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
                    <span style={{ fontSize: 12 }}>{tt('Retour', 'Back', 'Volver')}</span>
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
                      {tt('Finaliser la configuration', 'Complete your setup', 'Finaliza la configuración')}
                    </p>
                    <p style={{ color: T3, fontSize: 11, marginTop: 1 }} className="tabular-nums">
                      {doneCount}/{STEP_COUNT} {tt('étapes', 'steps', 'pasos')} · {progressPct}%
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

            {/* Progress bar (step list only) */}
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
                  {tt('Aller sur la page', 'Go to page', 'Ir a la página')}
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
                      {/* Step header row — toggle accordion */}
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

                      {/* Sub-step accordion */}
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
                                /* Each sub-step: two separate hit areas */
                                <div key={si} className="flex items-center gap-1 my-0.5">
                                  {/* Nav button */}
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
                                  {/* Help / popup button */}
                                  {sub.descEn && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setPopup(sub); }}
                                      className="flex-none flex items-center justify-center w-6 h-6 rounded cursor-pointer transition-colors hover:bg-white/[0.08]"
                                      title={tt("En savoir plus", "Learn more", "Más info")}
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
          {tt('Config.', 'Setup', 'Config.')}
        </span>
        {isExpanded
          ? <ChevronDown className="w-3.5 h-3.5 flex-none" style={{ color: T2 }} />
          : <ChevronUp className="w-3.5 h-3.5 flex-none" style={{ color: T2 }} />
        }
      </button>
    </div>
  );
}
