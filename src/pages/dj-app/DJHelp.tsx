import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import {
  LifeBuoy, Search, ChevronDown, Send, Bug, HelpCircle, Lightbulb, MoreHorizontal,
  Clock, CheckCircle, Loader2, LayoutDashboard, CalendarDays, MousePointerClick,
  BarChart2, User, Users, Bell,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDJData } from '@/contexts/DJDataContext';
import { useAuth } from '@/hooks/useAuth';
import { makeDjT } from '@/i18n/djTranslate';
import { supabase } from '@/integrations/supabase/client';
import {
  DJPage, DJHeading, PCard, ZoneHeading,
  RED, POS, WARN, T1, T2, T3, INNER_BG, BORDER,
} from '@/components/dj/dj-ui';

interface Article { id: string; icon: typeof LayoutDashboard; q: string; a: string; }
interface FeedbackRow {
  id: string; title: string; description: string | null;
  category: string; status: string; created_at: string;
}

const SUPPORT_CATS = [
  { value: 'bug',      icon: Bug,            priority: 'high',   label: ['Bug', 'Bug', 'Error'] },
  { value: 'question', icon: HelpCircle,     priority: 'medium', label: ['Question', 'Question', 'Pregunta'] },
  { value: 'feature',  icon: Lightbulb,      priority: 'low',    label: ['Idée', 'Idea', 'Idea'] },
  { value: 'other',    icon: MoreHorizontal, priority: 'medium', label: ['Autre', 'Other', 'Otro'] },
] as const;

export default function DJHelp() {
  const { language } = useLanguage();
  const tt = makeDjT(language);
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const { dj } = useDJData();
  const { user } = useAuth();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const [category, setCategory] = useState<string>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<FeedbackRow[]>([]);
  const [loadingHist, setLoadingHist] = useState(true);

  const articles = useMemo<Article[]>(() => [
    { id: 'overview', icon: LayoutDashboard,
      q: tt("À quoi sert l'aperçu ?", 'What is the Overview for?', '¿Para qué sirve el Resumen?'),
      a: tt(
        "L'aperçu réunit tes chiffres clés : prochaines dates, cachets en attente et reçus, et ta carte de profil partageable. C'est ton point de départ chaque fois que tu ouvres Yuno.",
        'The Overview gathers your key numbers: upcoming gigs, fees pending and received, and your shareable profile card. It is your starting point every time you open Yuno.',
        'El Resumen reúne tus cifras clave: próximas fechas, cachés pendientes y recibidos, y tu tarjeta de perfil para compartir. Es tu punto de partida cada vez que abres Yuno.',
      ) },
    { id: 'planning', icon: CalendarDays,
      q: tt('Comment lire mon planning ?', 'How do I read my schedule?', '¿Cómo leo mi agenda?'),
      a: tt(
        "Le planning rassemble toutes tes dates, tous clubs confondus, dans un seul calendrier. Si tu joues dans plusieurs établissements, le sélecteur en haut à droite filtre par scène.",
        'The Schedule gathers every gig across all your clubs into one calendar. If you play several venues, the selector at the top right filters by venue.',
        'La agenda reúne todas tus fechas, de todos los clubs, en un solo calendario. Si tocas en varias salas, el selector arriba a la derecha filtra por sala.',
      ) },
    { id: 'audience', icon: MousePointerClick,
      q: tt('À quoi servent les liens trackés ?', 'What are tracked links for?', '¿Para qué sirven los enlaces?'),
      a: tt(
        "Chaque event où tu joues te donne un lien personnel. Partage-le sur tes réseaux : Yuno compte les clics, les conversions et le revenu que tu génères. C'est la preuve concrète de ta valeur pour décrocher d'autres dates.",
        'Each event you play gives you a personal link. Share it on your socials: Yuno counts clicks, conversions and the revenue you drive. It is hard proof of your value when booking more gigs.',
        'Cada evento donde tocas te da un enlace personal. Compártelo en tus redes: Yuno cuenta los clics, las conversiones y los ingresos que generas. Es la prueba concreta de tu valor para conseguir más fechas.',
      ) },
    { id: 'payments', icon: BarChart2,
      q: tt('Comment relancer un cachet impayé ?', 'How do I chase an unpaid fee?', '¿Cómo reclamo un caché impago?'),
      a: tt(
        "Dans Paiements (ou via une notification), chaque date non réglée affiche un bouton « Relancer le club ». Un seul appui envoie un rappel poli au club — limité à une fois par 24h pour rester pro.",
        'In Payments (or from a notification), each unpaid gig shows a "Remind club" button. One tap sends a polite nudge to the club — limited to once per 24h to stay professional.',
        'En Pagos (o desde una notificación), cada fecha sin pagar muestra un botón «Avisar al club». Un toque envía un recordatorio amable al club, limitado a una vez cada 24h para ser profesional.',
      ) },
    { id: 'analytics', icon: BarChart2,
      q: tt('Que montrent mes statistiques ?', 'What do my analytics show?', '¿Qué muestran mis estadísticas?'),
      a: tt(
        "Tes statistiques résument ta carrière sur Yuno : rythme de bookings mois par mois, scènes où tu joues le plus, styles dominants et cachet moyen. Idéal à montrer à un programmateur.",
        'Your analytics sum up your career on Yuno: month-by-month booking momentum, the venues you play most, your dominant genres and your average fee. Great to show a booker.',
        'Tus estadísticas resumen tu carrera en Yuno: ritmo de bookings mes a mes, salas donde más tocas, estilos dominantes y caché medio. Ideal para enseñar a un programador.',
      ) },
    { id: 'notifications', icon: Bell,
      q: tt('Comment marchent les notifications ?', 'How do notifications work?', '¿Cómo funcionan las notificaciones?'),
      a: tt(
        "Le centre de notifications réunit ce qui demande ton attention : cachets en attente, dates dans les 14 jours, paiements reçus et profil à compléter. Marque-les comme lues une par une ou toutes d'un coup.",
        'The notifications center gathers what needs your attention: pending fees, gigs within 14 days, payments received and profile gaps. Mark them read one by one or all at once.',
        'El centro de notificaciones reúne lo que necesita tu atención: cachés pendientes, fechas en 14 días, pagos recibidos y perfil incompleto. Márcalas como leídas una a una o todas a la vez.',
      ) },
    { id: 'profile', icon: User,
      q: tt('Comment partager mon EPK ?', 'How do I share my press kit?', '¿Cómo comparto mi EPK?'),
      a: tt(
        "Depuis ton profil, ta carte partageable contient un lien EPK (press kit) avec ta bio, tes styles et tes réseaux. Partage-le aux clubs et programmateurs — pas besoin qu'ils aient un compte Yuno.",
        'From your profile, your shareable card holds an EPK (press kit) link with your bio, genres and socials. Share it with clubs and bookers — they do not need a Yuno account.',
        'Desde tu perfil, tu tarjeta para compartir incluye un enlace EPK (press kit) con tu bio, estilos y redes. Compártelo con clubs y programadores, no necesitan cuenta de Yuno.',
      ) },
    { id: 'team', icon: Users,
      q: tt('Puis-je donner accès à mon manager ?', 'Can I give my manager access?', '¿Puedo dar acceso a mi mánager?'),
      a: tt(
        "Oui. Dans Équipe, invite ton manager ou booker par email et choisis ce qu'il peut voir (planning, paiements) et s'il peut modifier. Tu peux révoquer l'accès à tout moment.",
        'Yes. In Team, invite your manager or booker by email and choose what they can see (schedule, payments) and whether they can edit. You can revoke access anytime.',
        'Sí. En Equipo, invita a tu mánager o booker por email y elige qué puede ver (agenda, pagos) y si puede editar. Puedes revocar el acceso cuando quieras.',
      ) },
  ], [tt]);

  const filteredArticles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter(a => a.q.toLowerCase().includes(q) || a.a.toLowerCase().includes(q));
  }, [articles, query]);

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('feedback_issues')
      .select('id, title, description, category, status, created_at')
      .eq('reported_by', user.id)
      .order('created_at', { ascending: false })
      .limit(15);
    setHistory((data as FeedbackRow[]) || []);
    setLoadingHist(false);
  }, [user]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const handleSubmit = async () => {
    if (!title.trim() || !user) return;
    setSending(true);
    const cat = SUPPORT_CATS.find(c => c.value === category);
    const { error } = await supabase.from('feedback_issues').insert({
      title: title.trim(),
      description: description.trim() || null,
      category,
      priority: cat?.priority || 'medium',
      reported_by: user.id,
      venue_id: dj?.venue_id || null,
    });
    setSending(false);
    if (error) { toast.error(tt('Échec de l\'envoi', 'Sending failed', 'Error al enviar')); return; }
    toast.success(tt('Message envoyé', 'Message sent', 'Mensaje enviado'));
    setTitle(''); setDescription('');
    fetchHistory();
  };

  const statusMeta: Record<string, { icon: typeof Clock; color: string; label: string }> = {
    open:        { icon: Clock,       color: WARN, label: tt('Ouvert', 'Open', 'Abierto') },
    in_progress: { icon: Loader2,     color: 'rgba(96,165,250,0.95)', label: tt('En cours', 'In progress', 'En curso') },
    resolved:    { icon: CheckCircle, color: POS,  label: tt('Résolu', 'Resolved', 'Resuelto') },
    closed:      { icon: CheckCircle, color: T3,   label: tt('Fermé', 'Closed', 'Cerrado') },
  };

  if (!dj) return null;

  return (
    <DJPage maxWidth={820}>
      <DJHeading
        title={tt('Aide & support', 'Help & support', 'Ayuda y soporte')}
        subtitle={tt('Guides rapides et contact direct', 'Quick guides and direct contact', 'Guías rápidas y contacto directo')}
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={tt('Rechercher une question…', 'Search a question…', 'Buscar una pregunta…')}
          className="w-full rounded-xl pl-10 pr-4 py-3 text-sm outline-none"
          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}
        />
      </div>

      {/* Articles */}
      <ZoneHeading icon={<LifeBuoy className="w-4 h-4" />} label={tt('Guides', 'Guides', 'Guías')} />
      <div className="space-y-2">
        {filteredArticles.map(a => {
          const Icon = a.icon;
          const isOpen = open === a.id;
          return (
            <div key={a.id} className="rounded-xl overflow-hidden"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <button onClick={() => setOpen(isOpen ? null : a.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03]">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T2 }}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1 text-[13.5px] font-[560]" style={{ color: T1 }}>{a.q}</span>
                <ChevronDown className="h-4 w-4 flex-none transition-transform"
                  style={{ color: T3, transform: isOpen ? 'rotate(180deg)' : 'none' }} />
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pl-11">
                  <p className="text-[13px] leading-relaxed" style={{ color: T2 }}>{a.a}</p>
                </div>
              )}
            </div>
          );
        })}
        {filteredArticles.length === 0 && (
          <p className="text-sm py-6 text-center" style={{ color: T3 }}>
            {tt('Aucun guide ne correspond.', 'No guide matches.', 'Ningún guía coincide.')}
          </p>
        )}
      </div>

      {/* Support form */}
      <ZoneHeading icon={<Send className="w-4 h-4" />} label={tt('Contacter le support', 'Contact support', 'Contactar soporte')} />
      <PCard>
        <div className="space-y-4">
          <div>
            <span className="block text-[12px] uppercase tracking-wider mb-2" style={{ color: T3 }}>
              {tt('Catégorie', 'Category', 'Categoría')}
            </span>
            <div className="flex flex-wrap gap-2">
              {SUPPORT_CATS.map(c => {
                const Icon = c.icon;
                const active = category === c.value;
                const label = c.label[language === 'fr' ? 0 : language === 'es' ? 2 : 1];
                return (
                  <button key={c.value} onClick={() => setCategory(c.value)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={active
                      ? { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.35)', color: RED }
                      : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="block text-[12px] uppercase tracking-wider mb-2" style={{ color: T3 }}>
              {tt('Sujet', 'Subject', 'Asunto')}
            </span>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
              placeholder={tt('Résume ta demande', 'Summarize your request', 'Resume tu solicitud')}
              className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }} />
          </div>

          <div>
            <span className="block text-[12px] uppercase tracking-wider mb-2" style={{ color: T3 }}>
              {tt('Détails', 'Details', 'Detalles')}
            </span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} maxLength={2000}
              placeholder={tt('Donne-nous le contexte…', 'Give us the context…', 'Danos el contexto…')}
              className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none resize-none"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }} />
          </div>

          <button onClick={handleSubmit} disabled={!title.trim() || sending}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: RED, color: '#fff' }}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {tt('Envoyer', 'Send', 'Enviar')}
          </button>
        </div>
      </PCard>

      {/* History */}
      {(loadingHist || history.length > 0) && (
        <>
          <ZoneHeading icon={<Clock className="w-4 h-4" />} label={tt('Mes demandes', 'My requests', 'Mis solicitudes')} />
          {loadingHist ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" style={{ color: T3 }} /></div>
          ) : (
            <div className="space-y-2">
              {history.map(item => {
                const s = statusMeta[item.status] || statusMeta.open;
                const SIcon = s.icon;
                return (
                  <div key={item.id} className="rounded-xl px-4 py-3 space-y-1.5"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-[560] flex-1" style={{ color: T1 }}>{item.title}</p>
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold flex-none"
                        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: s.color }}>
                        <SIcon className="w-3 h-3" /> {s.label}
                      </span>
                    </div>
                    {item.description && <p className="text-xs line-clamp-2" style={{ color: T3 }}>{item.description}</p>}
                    <p className="text-[10px]" style={{ color: T3 }}>
                      {format(new Date(item.created_at), 'dd MMM yyyy · HH:mm', { locale })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </DJPage>
  );
}
